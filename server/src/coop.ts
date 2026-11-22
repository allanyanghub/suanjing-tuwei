/**
 * 合作模式：WebSocket 房间与按座位转发（协议见 API.md §18）。
 *
 * 两部分：
 * - WsConn：极简 RFC 6455 服务端（握手、帧解析、掩码、分片、16/64 位长度、close/ping/pong，只发文本帧）；
 * - CoopHub：鉴权、房间列表订阅、建房 / 进房 / 换角色 / 换关卡 / 换队 / 开局 / 转发 / 结束 / 离开。
 *
 * 房间有两种玩法（建房时选定）：'coop' 合作（所有人同一队打电脑）、'versus' 对战（蓝队 0 / 红队 1 互相打）。
 *
 * 服务器不理解游戏内容，房间只在内存里。仅使用 Node 内置模块。
 */
import { createHash, randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Db } from './db.ts';

export interface CoopOptions {
  /** 服务器发 ping 的间隔，默认 15 秒 */
  pingIntervalMs?: number;
  /** 多久没收到对方任何数据（含 pong）就断开，默认 35 秒 */
  pongTimeoutMs?: number;
  /** 连上后多久内必须发 hello，默认 10 秒 */
  helloTimeoutMs?: number;
  /** 单条消息上限（字节），默认 16 KB */
  maxMessageBytes?: number;
  /** 每个连接每秒最多几条消息，默认 120 */
  maxPerSecond?: number;
  /** 同一个账号又来进房时，先 ping 一下房里那个旧连接，等这么久没回应就当它掉线了（默认 3 秒） */
  dupProbeMs?: number;
}

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MEMBERS = 4;
/** 联机对战：开局时每队至少几个真人（与 src/net/coop-link.ts 的 VERSUS_MIN_PER_TEAM 一致） */
const VERSUS_MIN_PER_TEAM = 1;
const TEAM_NAMES = ['蓝队', '红队'] as const;

type Mode = 'coop' | 'versus';
type Team = 0 | 1;
/** 发送缓冲积压超过这么多（对方网络太慢 / 不读）就直接断开，免得占满内存 */
const MAX_BUFFERED = 4 * 1024 * 1024;
const MAX_ID_LEN = 64;

// 关闭码
const CLOSE_NORMAL = 1000;
const CLOSE_GOING_AWAY = 1001;
const CLOSE_PROTOCOL = 1002;
const CLOSE_UNSUPPORTED = 1003;
const CLOSE_BAD_DATA = 1007;
const CLOSE_POLICY = 1008;
const CLOSE_TOO_BIG = 1009;
const CLOSE_AUTH = 4401;
/** 同一个账号在别的设备上登录了 */
const CLOSE_REPLACED = 4409;

/** 单调时钟（毫秒）：心跳和限流用真实时间，不受应用的假时钟影响 */
const mono = () => performance.now();

// ================================================================ WebSocket 连接

/** 一个已完成握手的 WebSocket 连接 */
class WsConn {
  socket: Duplex;
  maxMessage: number;
  /** 收到一条完整的文本消息 */
  onText: (s: string) => void = () => {};
  /** 连接彻底断开（只触发一次） */
  onClose: () => void = () => {};
  /** 最近一次收到对方数据的时间（mono） */
  lastSeen = mono();
  closing = false;
  private closed = false;
  private buf: Buffer = Buffer.alloc(0);
  /** 正在拼接的分片消息 */
  private frag: Buffer[] | null = null;
  private fragOp = 0;
  private fragLen = 0;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });

  constructor(socket: Duplex, head: Buffer, maxMessage: number) {
    this.socket = socket;
    this.maxMessage = maxMessage;
    socket.on('data', (c: Buffer) => this.feed(c));
    socket.on('error', () => {
      /* 随后会触发 close */
    });
    socket.on('close', () => this.finish());
    socket.on('end', () => socket.end());
    if (head.length) this.feed(head);
  }

  get alive(): boolean {
    return !this.closing && !this.closed;
  }

  sendText(s: string): void {
    if (!this.alive) return;
    this.writeFrame(0x1, Buffer.from(s, 'utf8'));
    if (this.socket.writableLength > MAX_BUFFERED) this.destroy();
  }

  ping(): void {
    if (this.alive) this.writeFrame(0x9, Buffer.alloc(0));
  }

  /** 发 close 帧并结束连接；对方不回应的话 2 秒后强制断开 */
  close(code: number, reason = ''): void {
    if (!this.alive) return;
    this.closing = true;
    let r = Buffer.from(reason, 'utf8');
    if (r.length > 123) r = r.subarray(0, 123);
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this.writeFrame(0x8, p);
    this.socket.end();
    setTimeout(() => this.destroy(), 2000).unref();
  }

  destroy(): void {
    this.closing = true;
    this.socket.destroy();
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.closing = true;
    this.onClose();
  }

  private writeFrame(op: number, payload: Buffer): void {
    const n = payload.length;
    let h: Buffer;
    if (n < 126) {
      h = Buffer.alloc(2);
      h[1] = n;
    } else if (n < 65536) {
      h = Buffer.alloc(4);
      h[1] = 126;
      h.writeUInt16BE(n, 2);
    } else {
      h = Buffer.alloc(10);
      h[1] = 127;
      h.writeBigUInt64BE(BigInt(n), 2);
    }
    h[0] = 0x80 | op; // FIN + opcode；服务器发出的帧不加掩码
    this.socket.write(n ? Buffer.concat([h, payload]) : h);
  }

  private feed(chunk: Buffer): void {
    if (this.closed) return;
    this.lastSeen = mono();
    if (this.closing) return; // 已经在关了，后续数据不再处理
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    this.parse();
  }

  private parse(): void {
    while (this.alive) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const rsv = b[0] & 0x70;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      // 没有协商任何扩展，RSV 必须为 0；客户端发来的帧必须加掩码
      if (rsv || !masked) return this.close(CLOSE_PROTOCOL);
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.maxMessage)) return this.close(CLOSE_TOO_BIG);
        len = Number(big);
        off = 10;
      }
      const control = op >= 0x8;
      if (control) {
        if (len > 125 || !fin) return this.close(CLOSE_PROTOCOL);
      } else if ((op === 0 ? this.fragLen : 0) + len > this.maxMessage) {
        // 在收齐之前就按声明的长度判断，不会为超大消息攒缓冲
        return this.close(CLOSE_TOO_BIG);
      }
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this.frame(op, fin, payload);
    }
  }

  private frame(op: number, fin: boolean, payload: Buffer): void {
    switch (op) {
      case 0x8: {
        // 对方要关：回同样的关闭码，然后结束
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : CLOSE_NORMAL;
        const valid = (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) || (code >= 3000 && code <= 4999);
        this.close(payload.length === 1 || (payload.length >= 2 && !valid) ? CLOSE_PROTOCOL : code);
        return;
      }
      case 0x9:
        this.writeFrame(0xa, payload);
        return;
      case 0xa:
        return; // pong：lastSeen 已更新
      case 0x1:
      case 0x2:
        if (this.frag) return this.close(CLOSE_PROTOCOL); // 上一条分片消息还没结束
        if (fin) return this.message(op, payload);
        this.frag = [payload];
        this.fragOp = op;
        this.fragLen = payload.length;
        return;
      case 0x0:
        if (!this.frag) return this.close(CLOSE_PROTOCOL);
        this.frag.push(payload);
        this.fragLen += payload.length;
        if (fin) {
          const all = Buffer.concat(this.frag);
          const fop = this.fragOp;
          this.frag = null;
          this.fragLen = 0;
          this.message(fop, all);
        }
        return;
      default:
        this.close(CLOSE_PROTOCOL);
    }
  }

  private message(op: number, data: Buffer): void {
    if (op !== 0x1) return this.close(CLOSE_UNSUPPORTED, '只接受文本消息');
    let s: string;
    try {
      s = this.decoder.decode(data);
    } catch {
      return this.close(CLOSE_BAD_DATA);
    }
    this.onText(s);
  }
}

/** 完成 WebSocket 握手；请求不合规则回 400 并返回 null */
function handshake(req: IncomingMessage, socket: Duplex): boolean {
  const key = String(req.headers['sec-websocket-key'] ?? '');
  const okUpgrade = String(req.headers.upgrade ?? '').toLowerCase() === 'websocket';
  const okVersion = String(req.headers['sec-websocket-version'] ?? '') === '13';
  if (req.method !== 'GET' || !okUpgrade || !okVersion || !/^[A-Za-z0-9+/]{22}==$/.test(key)) {
    rejectUpgrade(socket, 400, 'Bad Request', okVersion ? {} : { 'Sec-WebSocket-Version': '13' });
    return false;
  }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return true;
}

/** 拒绝升级请求（不是 /api/coop、或握手不合规） */
export function rejectUpgrade(socket: Duplex, status: number, text: string, headers: Record<string, string> = {}): void {
  const extra = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}\r\n`)
    .join('');
  socket.on('error', () => {});
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n${extra}\r\n`);
  setTimeout(() => socket.destroy(), 1000).unref();
}

// ================================================================ 房间

interface Member {
  seat: number;
  playerId: number;
  name: string;
  grade: number;
  agentId: string;
  isHost: boolean;
  team: Team;
}

interface Room {
  id: string;
  state: 'lobby' | 'playing';
  mode: Mode;
  levelId: string;
  mapId: string;
  /** seat → 连接 */
  clients: Map<number, Client>;
  nextSeat: number;
}

interface Client {
  ws: WsConn;
  you?: { playerId: number; name: string; grade: number };
  room?: Room;
  seat: number;
  agentId: string;
  /** 所在队伍（合作模式恒为 0） */
  team: Team;
  subscribed: boolean;
  rateStart: number;
  rateCount: number;
  helloTimer?: ReturnType<typeof setTimeout>;
  /** 正在探测房间里同账号的旧连接（见 probeDuplicate） */
  probing?: boolean;
}

type Msg = Record<string, unknown>;

class CoopError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const ERR = {
  badMessage: () => new CoopError('bad-message', '消息格式不对'),
  noRoom: () => new CoopError('no-room', '你还不在房间里'),
  notHost: () => new CoopError('not-host', '只有房主才能这样做'),
  started: () => new CoopError('started', '这个房间正在对局，等这局打完再来吧'),
  inRoom: () => new CoopError('in-room', '你已经在一个房间里了，先离开再进别的房间'),
  notVersus: () => new CoopError('not-versus', '合作模式大家都在同一队，不用分队'),
  noMember: () => new CoopError('no-member', '房间里没有这个人了'),
};

const isObj = (v: unknown): v is Msg => typeof v === 'object' && v !== null && !Array.isArray(v);

function idStr(v: unknown): string {
  if (typeof v !== 'string' || !v || v.length > MAX_ID_LEN) throw ERR.badMessage();
  return v;
}

export class CoopHub {
  private readonly db: Db;
  private readonly pingMs: number;
  private readonly timeoutMs: number;
  private readonly helloMs: number;
  private readonly maxMessage: number;
  private readonly maxPerSecond: number;
  private readonly dupProbeMs: number;
  private readonly clients = new Set<Client>();
  private readonly rooms = new Map<string, Room>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(db: Db, o: CoopOptions = {}) {
    this.db = db;
    this.pingMs = o.pingIntervalMs ?? 15_000;
    this.timeoutMs = o.pongTimeoutMs ?? 35_000;
    this.helloMs = o.helloTimeoutMs ?? 10_000;
    this.maxMessage = o.maxMessageBytes ?? 16 * 1024;
    this.maxPerSecond = o.maxPerSecond ?? 120;
    this.dupProbeMs = o.dupProbeMs ?? 3000;
  }

  /** 当前房间数（测试 / 调试用） */
  get roomCount(): number {
    return this.rooms.size;
  }

  /** 处理 HTTP upgrade（路径已确认是 /api/coop） */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!handshake(req, socket)) return;
    if ('setNoDelay' in socket && typeof socket.setNoDelay === 'function') socket.setNoDelay(true);
    const ws = new WsConn(socket, head, this.maxMessage);
    const c: Client = { ws, seat: -1, agentId: '', team: 0, subscribed: false, rateStart: mono(), rateCount: 0 };
    this.clients.add(c);
    c.helloTimer = setTimeout(() => {
      if (!c.you) this.authFail(c);
    }, this.helloMs);
    c.helloTimer.unref();
    ws.onText = (s) => this.onText(c, s);
    ws.onClose = () => this.onClose(c);
    this.ensurePing();
  }

  /** 这个玩家在别的设备上登录了：断开他现有的合作连接（在房间里的会离开房间；是房主则房间关闭） */
  kickPlayer(playerId: number, reason: string): void {
    for (const c of [...this.clients]) {
      if (c.you?.playerId !== playerId) continue;
      this.send(c, { t: 'error', code: 'replaced', message: reason });
      this.leave(c);
      c.ws.close(CLOSE_REPLACED, 'replaced');
    }
  }

  /** 关闭所有连接（服务器停机时调用） */
  shutdown(): void {
    for (const c of [...this.clients]) c.ws.close(CLOSE_GOING_AWAY, 'server shutdown');
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  // ---------------------------------------------------------------- 连接管理

  private ensurePing(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      const t = mono();
      for (const c of this.clients) {
        if (t - c.ws.lastSeen > this.timeoutMs) c.ws.destroy();
        else c.ws.ping();
      }
      if (!this.clients.size && this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
    }, this.pingMs);
    this.pingTimer.unref();
  }

  private onClose(c: Client): void {
    if (c.helloTimer) clearTimeout(c.helloTimer);
    this.clients.delete(c);
    this.leave(c);
  }

  private send(c: Client, m: Msg): void {
    c.ws.sendText(JSON.stringify(m));
  }

  private authFail(c: Client): void {
    this.send(c, { t: 'error', code: 'auth', message: '请先登录' });
    c.ws.close(CLOSE_AUTH, 'auth');
  }

  private onText(c: Client, s: string): void {
    // 限流：按 1 秒的时间窗计数
    const t = mono();
    if (t - c.rateStart >= 1000) {
      c.rateStart = t;
      c.rateCount = 0;
    }
    if (++c.rateCount > this.maxPerSecond) return c.ws.close(CLOSE_POLICY, 'rate limit');

    let m: unknown;
    try {
      m = JSON.parse(s);
    } catch {
      m = undefined;
    }
    if (!c.you) {
      // 鉴权前只认 hello
      if (!isObj(m) || m.t !== 'hello' || typeof m.token !== 'string') return this.authFail(c);
      const p = m.token ? this.db.playerBySession(m.token) : undefined;
      if (!p) return this.authFail(c);
      if (c.helloTimer) clearTimeout(c.helloTimer);
      c.you = { playerId: p.id, name: p.name, grade: p.grade };
      this.send(c, { t: 'welcome', you: c.you });
      return;
    }
    if (!isObj(m) || typeof m.t !== 'string') return this.sendError(c, ERR.badMessage());
    try {
      this.handle(c, m);
    } catch (e) {
      if (e instanceof CoopError) this.sendError(c, e);
      else {
        console.error('[coop] 处理消息出错', e);
        this.sendError(c, new CoopError('server', '服务器出错了'));
      }
    }
  }

  private sendError(c: Client, e: CoopError): void {
    this.send(c, { t: 'error', code: e.code, message: e.message });
  }

  // ---------------------------------------------------------------- 消息

  private handle(c: Client, m: Msg): void {
    switch (m.t) {
      case 'hello':
        this.send(c, { t: 'welcome', you: c.you });
        return;
      case 'ping':
        this.send(c, { t: 'pong' });
        return;
      case 'rooms':
        if (c.room) return; // 在房间里不订阅
        c.subscribed = true;
        this.send(c, { t: 'rooms', rooms: this.roomList() });
        return;
      case 'create':
        return this.create(c, m);
      case 'join':
        return this.join(c, m);
      case 'agent': {
        const r = this.need(c);
        const agentId = idStr(m.agentId);
        if (r.state !== 'lobby') throw ERR.started();
        c.agentId = agentId;
        this.changed(r);
        return;
      }
      case 'level': {
        const r = this.needHost(c);
        const levelId = idStr(m.levelId);
        const mapId = idStr(m.mapId);
        if (r.state !== 'lobby') throw ERR.started();
        r.levelId = levelId;
        r.mapId = mapId;
        this.changed(r);
        return;
      }
      case 'team':
        return this.setTeam(c, m);
      case 'start':
        return this.start(c, m);
      case 'msg':
        return this.forward(c, m);
      case 'end': {
        const r = this.needHost(c);
        if (r.state === 'lobby') return;
        r.state = 'lobby';
        this.changed(r);
        return;
      }
      case 'leave':
        this.leave(c);
        return;
      default:
        throw ERR.badMessage();
    }
  }

  private need(c: Client): Room {
    if (!c.room) throw ERR.noRoom();
    return c.room;
  }

  private needHost(c: Client): Room {
    const r = this.need(c);
    if (c.seat !== 0) throw ERR.notHost();
    return r;
  }

  private create(c: Client, m: Msg): void {
    if (c.room) throw ERR.inRoom();
    const levelId = idStr(m.levelId);
    const mapId = idStr(m.mapId);
    const agentId = idStr(m.agentId);
    // 老客户端不发 mode：按合作模式
    if (m.mode !== undefined && m.mode !== 'coop' && m.mode !== 'versus') throw ERR.badMessage();
    const mode: Mode = m.mode === 'versus' ? 'versus' : 'coop';
    let id = '';
    do id = String(randomInt(1000, 10000));
    while (this.rooms.has(id));
    const r: Room = { id, state: 'lobby', mode, levelId, mapId, clients: new Map(), nextSeat: 0 };
    this.rooms.set(id, r);
    this.seatIn(c, r, agentId);
    this.send(c, { t: 'room', room: this.info(r), selfSeat: c.seat });
    this.pushRooms();
  }

  private join(c: Client, m: Msg): void {
    if (c.room) throw ERR.inRoom();
    const roomId = typeof m.roomId === 'number' ? String(m.roomId) : m.roomId;
    if (typeof roomId !== 'string') throw ERR.badMessage();
    const agentId = idStr(m.agentId);
    const r = this.rooms.get(roomId.trim());
    if (!r) throw new CoopError('not-found', '没有找到这个房间，检查一下房间号');
    if (r.state !== 'lobby') throw ERR.started();
    if (r.clients.size >= MAX_MEMBERS) throw new CoopError('full', '这个房间已经满 4 个人了');
    const dup = [...r.clients.values()].find((o) => o.you!.playerId === c.you!.playerId);
    if (dup) return this.probeDuplicate(c, m, dup);
    this.seatIn(c, r, agentId);
    const info = this.info(r);
    for (const o of r.clients.values()) this.send(o, o === c ? { t: 'room', room: info, selfSeat: c.seat } : { t: 'room', room: info });
    this.pushRooms();
  }

  /**
   * 同一个账号已经在房间里了。常见的两种情况：
   * - 旧连接其实已经断了（平板锁屏 / 切后台 / 断 Wi-Fi，服务器要等 ping 超时才知道），房间里留着一个「影子」；
   * - 真的是另一台设备登录着同一个账号。
   * 先 ping 旧连接：dupProbeMs 内没有任何回应 → 当它掉线，踢掉后让新设备进房；有回应 → 告诉孩子换成自己的账号。
   */
  private probeDuplicate(c: Client, m: Msg, old: Client): void {
    if (c.probing) return; // 连点「加入」：等上一次探测的结果
    c.probing = true;
    const asked = mono();
    old.ws.ping();
    const timer = setTimeout(() => {
      c.probing = false;
      if (!c.ws.alive || !this.clients.has(c)) return;
      const ghostHost = old.ws.alive && !!old.room && old.ws.lastSeen < asked && old.seat === 0;
      if (old.ws.alive && old.room && old.ws.lastSeen < asked) old.ws.destroy(); // onClose → leave
      try {
        if (ghostHost) throw new CoopError('host-gone', '建这个房间的设备已经掉线，房间关了，请重新建一个房间');
        if (old.room && old.ws.alive) throw new CoopError('duplicate', `「${c.you!.name}」这个账号已经在这个房间里了（在另一台设备上）。每个人要用自己的账号：回首页点「切换玩家」换成你自己再来`);
        this.join(c, m);
      } catch (e) {
        if (e instanceof CoopError) this.sendError(c, e);
        else console.error('[coop] 处理消息出错', e);
      }
    }, this.dupProbeMs);
    timer.unref();
  }

  private seatIn(c: Client, r: Room, agentId: string): void {
    c.room = r;
    c.seat = r.nextSeat++;
    c.agentId = agentId;
    c.team = this.balancedTeam(r);
    c.subscribed = false; // 进房后自动退订房间列表
    r.clients.set(c.seat, c);
  }

  /** 新进房的人去哪一队：合作模式恒为 0；对战去真人少的那队（一样多去蓝队 0，所以房主在蓝队） */
  private balancedTeam(r: Room): Team {
    if (r.mode !== 'versus') return 0;
    const n = [0, 0];
    for (const o of r.clients.values()) n[o.team]++;
    return n[1] < n[0] ? 1 : 0;
  }

  /** 换队：不带 seat = 换自己；带 seat = 房主把别人换过去（只能在准备阶段、只限对战房间） */
  private setTeam(c: Client, m: Msg): void {
    const r = this.need(c);
    if (m.team !== 0 && m.team !== 1) throw ERR.badMessage();
    if (m.seat !== undefined && (typeof m.seat !== 'number' || !Number.isInteger(m.seat))) throw ERR.badMessage();
    if (r.mode !== 'versus') throw ERR.notVersus();
    if (r.state !== 'lobby') throw ERR.started();
    const seat = m.seat === undefined ? c.seat : m.seat;
    if (seat !== c.seat && c.seat !== 0) throw ERR.notHost();
    const o = r.clients.get(seat);
    if (!o) throw ERR.noMember();
    if (o.team === m.team) return;
    o.team = m.team;
    this.changed(r);
  }

  private start(c: Client, m: Msg): void {
    const r = this.needHost(c);
    if (typeof m.seed !== 'number' || !Number.isFinite(m.seed)) throw ERR.badMessage();
    const levelId = m.levelId === undefined ? r.levelId : idStr(m.levelId);
    const mapId = m.mapId === undefined ? r.mapId : idStr(m.mapId);
    if (m.opts !== undefined && !isObj(m.opts)) throw ERR.badMessage();
    if (r.state !== 'lobby') throw ERR.started();
    if (r.mode === 'versus') {
      const n = [0, 0];
      for (const o of r.clients.values()) n[o.team]++;
      const empty = ([0, 1] as const).filter((t) => n[t] < VERSUS_MIN_PER_TEAM);
      if (empty.length) {
        const who = empty.length === 2 ? '两队' : TEAM_NAMES[empty[0]];
        throw new CoopError('teams', `${who}还没有人：对战要蓝队和红队都至少有 ${VERSUS_MIN_PER_TEAM} 个人才能开始，换一个人过去吧`);
      }
    }
    r.levelId = levelId;
    r.mapId = mapId;
    r.state = 'playing';
    const start = { mode: r.mode, seed: m.seed, levelId, mapId, opts: m.opts ?? {}, members: this.members(r) };
    this.broadcast(r, { t: 'start', start });
    this.pushRooms();
  }

  private forward(c: Client, m: Msg): void {
    const r = this.need(c);
    const out = JSON.stringify({ t: 'msg', from: c.seat, d: m.d ?? null });
    const to = m.to ?? 'all';
    if (to === 'all') {
      for (const o of r.clients.values()) if (o !== c) o.ws.sendText(out);
      return;
    }
    const seat = to === 'host' ? 0 : to;
    if (typeof seat !== 'number' || !Number.isInteger(seat)) throw ERR.badMessage();
    const o = r.clients.get(seat);
    if (o && o !== c) o.ws.sendText(out); // 不存在的 seat、发给自己：静默丢弃
  }

  /** 离开所在房间（不在房间里则什么都不做） */
  private leave(c: Client): void {
    const r = c.room;
    if (!r) return;
    c.room = undefined;
    r.clients.delete(c.seat);
    const seat = c.seat;
    c.seat = -1;
    if (seat === 0) {
      // 房主离开：房间关闭
      this.rooms.delete(r.id);
      for (const o of r.clients.values()) {
        o.room = undefined;
        o.seat = -1;
        this.send(o, { t: 'closed', reason: '房主离开了房间' });
      }
      r.clients.clear();
    } else {
      this.broadcast(r, { t: 'left', seat });
      this.broadcast(r, { t: 'room', room: this.info(r) });
    }
    this.pushRooms();
  }

  // ---------------------------------------------------------------- 广播

  private members(r: Room): Member[] {
    return [...r.clients.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((o) => ({ seat: o.seat, playerId: o.you!.playerId, name: o.you!.name, grade: o.you!.grade, agentId: o.agentId, isHost: o.seat === 0, team: o.team }));
  }

  private info(r: Room) {
    return { id: r.id, state: r.state, mode: r.mode, levelId: r.levelId, mapId: r.mapId, members: this.members(r) };
  }

  private roomList() {
    return [...this.rooms.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => this.info(r));
  }

  private broadcast(r: Room, m: Msg): void {
    const s = JSON.stringify(m);
    for (const o of r.clients.values()) o.ws.sendText(s);
  }

  /** 房间内容变了：通知房间里的人和订阅房间列表的人 */
  private changed(r: Room): void {
    this.broadcast(r, { t: 'room', room: this.info(r) });
    this.pushRooms();
  }

  private pushRooms(): void {
    let s = '';
    for (const c of this.clients) {
      if (!c.subscribed || c.room) continue;
      s ||= JSON.stringify({ t: 'rooms', rooms: this.roomList() });
      c.ws.sendText(s);
    }
  }
}
