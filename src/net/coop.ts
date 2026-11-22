/**
 * 合作模式 / 联机对战联网层：连家庭服务器的 WebSocket（协议见 server/API.md §18），
 * 管房间列表 / 建房 / 进房 / 换角色 / 换关卡 / 换队 / 开局 / 离开；开局时产生一个 CoopLink 交给对局。
 *
 * 老服务器不发 mode / team：解析 room / rooms / start 时补上默认值（'coop' / 0），对局拿到的 CoopStart 总是完整的。
 *
 * 不引用 DOM：WebSocket 构造函数通过参数注入，测试里用假的套接字（scripts/online/coop.test.ts）。
 * v1 不自动重连：连接断了就是断了，对局中会通过 link.onClosed 告诉孩子原因。
 */
import type { CoopLink, CoopMember, CoopMode, CoopStart, CoopTarget, CoopTeam } from './coop-link.ts';
import type { MatchOptions } from './profile.ts';
import { Emitter } from './util.ts';

/** 浏览器 WebSocket 里用到的那一小部分 */
export interface WSLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type WSCtor = new (url: string) => WSLike;

/** 服务器上的一个房间 */
export interface RoomInfo {
  id: string;
  state: 'lobby' | 'playing';
  /** 玩法（老服务器不发时按 'coop'） */
  mode: CoopMode;
  levelId: string;
  mapId: string;
  members: CoopMember[];
}

const asMode = (v: unknown): CoopMode => (v === 'versus' ? 'versus' : 'coop');

/** 补齐成员的 team：合作模式恒为 0，老服务器不发时按 0 */
function normMembers(v: unknown, mode: CoopMode): CoopMember[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is CoopMember => !!x && typeof x === 'object')
    .map((x) => ({ ...x, team: (mode === 'versus' && x.team === 1 ? 1 : 0) as CoopTeam }));
}

/** 服务器发来的房间信息 → 补齐默认值（不是对象返回 null） */
export function normRoom(v: unknown): RoomInfo | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<RoomInfo>;
  const mode = asMode(r.mode);
  return { ...(r as RoomInfo), mode, members: normMembers(r.members, mode) };
}

/** 服务器发来的开局信息 → 补齐默认值 */
export function normStart(v: unknown): CoopStart | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Partial<CoopStart>;
  const mode = asMode(s.mode);
  return { ...(s as CoopStart), mode, opts: s.opts ?? {}, members: normMembers(s.members, mode) };
}

export interface CoopYou {
  playerId: number;
  name: string;
  grade: number;
}

export interface CoopError {
  code: string;
  message: string;
}

export interface CoopClientEvents extends Record<string, unknown> {
  /** 房间列表（订阅期间每次变化都推） */
  rooms: RoomInfo[];
  /** 自己所在的房间变了（进房 / 有人进出 / 换角色 / 换关卡 / 回到大厅）；null = 不在房间里了 */
  room: RoomInfo | null;
  /** 房主开局：link 是这一局的消息通道 */
  start: { link: CoopLink; start: CoopStart };
  /** 服务器回的错误（进房失败等）；message 是给孩子看的中文 */
  error: CoopError;
  /** 房间被关闭（房主离开等），自己还连着服务器 */
  roomClosed: string;
  /** 和服务器的连接断开了（不会自动重连） */
  disconnected: string;
}

const WS_OPEN = 1;

/** 由接口地址前缀算出 WebSocket 地址：'' = 与网页同源 */
export function coopUrl(apiBase: string, loc: { protocol: string; host: string } | null): string {
  const base = apiBase.trim().replace(/\/+$/, '');
  if (base) return base.replace(/^http(s?):\/\//i, (_m, s: string) => `ws${s}://`) + '/api/coop';
  if (!loc) throw new Error('没有网页地址，算不出合作模式的连接地址');
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/api/coop`;
}

/** 已知错误码对应的孩子能看懂的说法 */
const ERROR_TEXT: Record<string, string> = {
  auth: '请先登录家庭账号',
  'not-found': '这个房间已经没有了',
  full: '这个房间已经满了（最多 4 个人）',
  started: '他们已经开始打了，等这一局结束再进吧',
  replaced: '这个账号在另一台设备上登录了，这台设备已自动退出',
  'host-gone': '建这个房间的设备已经掉线了，房间关了，请重新建一个房间',
  'in-room': '你已经在另一个房间里了，先离开那个房间吧',
  'not-host': '只有房主才能这样做',
  'no-room': '你现在不在房间里',
  teams: '蓝队和红队都要至少有一个人才能开始',
  'not-versus': '合作模式大家都在同一队，不用分队',
  'no-member': '这个人已经离开房间了',
};

export function coopErrorText(code: string, message?: string): string {
  return ERROR_TEXT[code] ?? (message && message.trim() ? message : '出了点问题，请再试一次');
}

/** 连接被关闭时给孩子看的说法 */
function closeText(code: number | undefined): string {
  switch (code) {
    case 4401:
      return '登录已失效，请重新登录';
    case 4409:
      return '这个账号在另一台设备上登录了，这台设备已自动退出';
    case 1009:
      return '消息太大，被服务器断开了';
    case 1008:
      return '发消息太快，被服务器断开了';
    default:
      return '和家里的服务器断开连接了';
  }
}

export interface CoopClientOptions {
  url: string;
  token: string;
  WebSocket?: WSCtor;
  /** 连接 + 鉴权的超时（毫秒） */
  timeoutMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

/** 一局的消息通道（实现 CoopLink） */
class Link implements CoopLink {
  readonly selfSeat: number;
  readonly isHost: boolean;
  /** false 之后不再收发（离开、房间关闭、下一局开始） */
  alive = true;
  private list: CoopMember[];
  private msgFns = new Set<(from: number, d: unknown) => void>();
  private leftFns = new Set<(seat: number) => void>();
  private closedFns = new Set<(reason: string) => void>();
  /** 还没有人订阅时先存起来，第一个订阅者按顺序全部收到（开局到对局建好之间不丢消息） */
  private msgBuf: [number, unknown][] = [];
  private leftBuf: number[] = [];
  private closedReason: string | null = null;
  private sendRaw: (o: unknown) => void;
  private onLeave: () => void;

  constructor(selfSeat: number, members: CoopMember[], sendRaw: (o: unknown) => void, onLeave: () => void) {
    this.selfSeat = selfSeat;
    this.list = members.slice();
    this.isHost = members.find((m) => m.seat === selfSeat)?.isHost ?? selfSeat === 0;
    this.sendRaw = sendRaw;
    this.onLeave = onLeave;
  }

  members(): CoopMember[] {
    return this.list.slice();
  }

  send(d: unknown, to: CoopTarget = 'all'): void {
    if (!this.alive) return;
    this.sendRaw({ t: 'msg', to, d });
  }

  onMessage(fn: (from: number, d: unknown) => void): () => void {
    this.msgFns.add(fn);
    if (this.msgBuf.length) for (const [f, d] of this.msgBuf.splice(0)) safe(() => fn(f, d));
    return () => void this.msgFns.delete(fn);
  }

  onMemberLeft(fn: (seat: number) => void): () => void {
    this.leftFns.add(fn);
    if (this.leftBuf.length) for (const s of this.leftBuf.splice(0)) safe(() => fn(s));
    return () => void this.leftFns.delete(fn);
  }

  onClosed(fn: (reason: string) => void): () => void {
    this.closedFns.add(fn);
    if (!this.alive && this.closedReason !== null) {
      const r = this.closedReason;
      queueMicrotask(() => {
        if (this.closedFns.has(fn)) safe(() => fn(r));
      });
    }
    return () => void this.closedFns.delete(fn);
  }

  leave(): void {
    if (!this.alive) return;
    this.alive = false;
    this.onLeave();
  }

  // ---- 由 CoopClient 调用

  deliver(from: number, d: unknown): void {
    if (!this.alive) return;
    if (!this.msgFns.size) {
      this.msgBuf.push([from, d]);
      return;
    }
    for (const fn of [...this.msgFns]) safe(() => fn(from, d));
  }

  setMembers(members: CoopMember[]): void {
    this.list = members.slice();
  }

  memberLeft(seat: number): void {
    if (!this.alive) return;
    this.list = this.list.filter((m) => m.seat !== seat);
    if (!this.leftFns.size) {
      this.leftBuf.push(seat);
      return;
    }
    for (const fn of [...this.leftFns]) safe(() => fn(seat));
  }

  close(reason: string): void {
    if (!this.alive) return;
    this.alive = false;
    this.closedReason = reason;
    for (const fn of [...this.closedFns]) safe(() => fn(reason));
  }

  /** 下一局开始了：旧通道静默作废 */
  retire(): void {
    this.alive = false;
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error('[coop] 事件处理出错', e);
  }
}

/**
 * 合作模式客户端：一个 WebSocket 连接。
 *   await c.connect()           连上并鉴权（失败时 reject，Error.message 是中文）
 *   c.subscribeRooms()          订阅房间列表（不在房间里时）
 *   c.create / join / setAgent / setLevel / start / end / leave
 *   c.on('start', ({link, start}) => app.startCoop(link, start))
 */
export class CoopClient {
  private ev = new Emitter<CoopClientEvents>();
  private ws: WSLike | null = null;
  private o: CoopClientOptions;
  private connecting: Promise<CoopYou> | null = null;
  /** 自己（服务器 welcome 里给的） */
  you: CoopYou | null = null;
  /** 当前所在的房间 */
  room: RoomInfo | null = null;
  selfSeat: number | null = null;
  /** 最近一次收到的房间列表 */
  rooms: RoomInfo[] = [];
  /** 当前一局的消息通道 */
  link: CoopLink | null = null;
  private linkImpl: Link | null = null;
  /** 连接已经关闭（断线 / 超时 / close()）：不能再用，要换一个新的 CoopClient */
  closed = false;

  constructor(o: CoopClientOptions) {
    this.o = o;
  }

  on<K extends keyof CoopClientEvents>(k: K, fn: (v: CoopClientEvents[K]) => void): () => void {
    return this.ev.on(k, fn);
  }

  /** 连接已建立并通过鉴权 */
  get ready(): boolean {
    return !!this.ws && !!this.you && !this.closed && this.ws.readyState === WS_OPEN;
  }

  get isHost(): boolean {
    return !!this.room && this.selfSeat !== null && !!this.room.members.find((m) => m.seat === this.selfSeat)?.isHost;
  }

  connect(): Promise<CoopYou> {
    if (this.connecting) return this.connecting;
    const Ctor = this.o.WebSocket ?? (globalThis as { WebSocket?: WSCtor }).WebSocket;
    const st = this.o.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const ct = this.o.clearTimeout ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
    this.connecting = new Promise<CoopYou>((resolve, reject) => {
      if (!Ctor) {
        reject(new Error('这个浏览器不支持合作模式'));
        return;
      }
      let settled = false;
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        ct(timer);
        reject(new Error(msg));
      };
      const timer = st(() => {
        fail('连不上家里的服务器（超时了）');
        this.shutdown('连不上家里的服务器（超时了）', false);
      }, this.o.timeoutMs ?? 8000);
      let ws: WSLike;
      try {
        ws = new Ctor(this.o.url);
      } catch {
        fail('连不上家里的服务器');
        this.closed = true;
        return;
      }
      this.ws = ws;
      ws.onopen = () => this.sendRaw({ t: 'hello', token: this.o.token });
      ws.onmessage = (e) => {
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(String(e.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        if (!m || typeof m !== 'object') return;
        if (!settled) {
          if (m.t === 'welcome') {
            settled = true;
            ct(timer);
            this.you = (m.you as CoopYou) ?? null;
            resolve(this.you as CoopYou);
            return;
          }
          if (m.t === 'error') {
            fail(coopErrorText(String(m.code ?? ''), typeof m.message === 'string' ? m.message : undefined));
            return;
          }
        }
        this.handle(m);
      };
      ws.onerror = () => undefined;
      ws.onclose = (e) => {
        const reason = closeText(e?.code);
        fail(e?.code === 4401 ? '请先登录家庭账号' : '连不上家里的服务器');
        this.shutdown(reason, true);
      };
    });
    return this.connecting;
  }

  // ------------------------------------------------------------ 大厅操作

  subscribeRooms(): void {
    this.sendRaw({ t: 'rooms' });
  }

  /** 建房；mode 建好后不能改 */
  create(levelId: string, mapId: string, agentId: string, mode: CoopMode = 'coop'): void {
    this.sendRaw({ t: 'create', levelId, mapId, agentId, mode });
  }

  join(roomId: string, agentId: string): void {
    this.sendRaw({ t: 'join', roomId, agentId });
  }

  setAgent(agentId: string): void {
    this.sendRaw({ t: 'agent', agentId });
  }

  /** 房主换关卡 */
  setLevel(levelId: string, mapId: string): void {
    this.sendRaw({ t: 'level', levelId, mapId });
  }

  /** 联机对战换队：不给 seat = 换自己；给别人的 seat = 房主把他换过去 */
  setTeam(team: CoopTeam, seat?: number): void {
    this.sendRaw(seat === undefined ? { t: 'team', team } : { t: 'team', team, seat });
  }

  /** 房主开局；seed 缺省为随机 32 位整数 */
  start(levelId: string, mapId: string, opts: MatchOptions, seed: number = randomSeed()): void {
    this.sendRaw({ t: 'start', seed, levelId, mapId, opts });
  }

  /** 房主：这局打完了，房间回到大厅（可以再开一局） */
  end(): void {
    if (this.isHost) this.sendRaw({ t: 'end' });
  }

  /** 离开房间（还连着服务器，可以进别的房间） */
  leave(): void {
    const had = !!this.room;
    this.linkImpl?.retire();
    this.linkImpl = null;
    this.link = null;
    this.room = null;
    this.selfSeat = null;
    if (had) {
      this.sendRaw({ t: 'leave' });
      this.ev.emit('room', null);
    }
  }

  /** 断开连接（离开合作模式时调用） */
  close(): void {
    if (this.closed) return;
    if (this.room) this.sendRaw({ t: 'leave' });
    this.shutdown('', false);
  }

  // ------------------------------------------------------------ 内部

  private sendRaw(o: unknown): void {
    const ws = this.ws;
    if (!ws || this.closed || ws.readyState !== WS_OPEN) return;
    try {
      ws.send(JSON.stringify(o));
    } catch {
      /* 连接正在关闭；onclose 会处理 */
    }
  }

  private handle(m: Record<string, unknown>): void {
    switch (m.t) {
      case 'rooms':
        this.rooms = Array.isArray(m.rooms) ? m.rooms.map(normRoom).filter((r): r is RoomInfo => !!r) : [];
        this.ev.emit('rooms', this.rooms);
        return;
      case 'room': {
        const room = normRoom(m.room);
        if (!room) return;
        if (typeof m.selfSeat === 'number') this.selfSeat = m.selfSeat;
        // 已经离开了还收到旧房间的推送：忽略
        if (this.selfSeat === null) return;
        this.room = room;
        this.linkImpl?.setMembers(room.members ?? []);
        this.ev.emit('room', room);
        return;
      }
      case 'start': {
        const start = normStart(m.start);
        if (!start || this.selfSeat === null) return;
        this.linkImpl?.retire();
        if (this.room) this.room = { ...this.room, state: 'playing', levelId: start.levelId, mapId: start.mapId, members: start.members };
        const link = new Link(this.selfSeat, start.members, (o) => this.sendRaw(o), () => this.leave());
        this.linkImpl = link;
        this.link = link;
        this.ev.emit('start', { link, start });
        return;
      }
      case 'msg':
        if (typeof m.from === 'number') this.linkImpl?.deliver(m.from, m.d);
        return;
      case 'left':
        if (typeof m.seat === 'number') {
          if (this.room) this.room = { ...this.room, members: this.room.members.filter((x) => x.seat !== m.seat) };
          this.linkImpl?.memberLeft(m.seat);
        }
        return;
      case 'closed': {
        const reason = typeof m.reason === 'string' && m.reason ? m.reason : '房间关闭了';
        this.linkImpl?.close(reason);
        this.linkImpl = null;
        this.link = null;
        this.room = null;
        this.selfSeat = null;
        this.ev.emit('roomClosed', reason);
        this.ev.emit('room', null);
        return;
      }
      case 'error':
        this.ev.emit('error', { code: String(m.code ?? ''), message: coopErrorText(String(m.code ?? ''), typeof m.message === 'string' ? m.message : undefined) });
        return;
      default:
        return;
    }
  }

  private shutdown(reason: string, notify: boolean): void {
    if (this.closed) return;
    this.closed = true;
    const ws = this.ws;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close(1000);
      } catch {
        /* 忽略 */
      }
    }
    const r = reason || '和家里的服务器断开连接了';
    this.linkImpl?.close(r);
    this.linkImpl = null;
    this.link = null;
    const hadRoom = !!this.room;
    this.room = null;
    this.selfSeat = null;
    if (notify) {
      if (hadRoom) this.ev.emit('room', null);
      this.ev.emit('disconnected', r);
    }
  }
}

export function randomSeed(): number {
  const c = (globalThis as { crypto?: { getRandomValues?<T extends ArrayBufferView>(a: T): T } }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] | 0;
  return (Math.random() * 0x1_0000_0000) | 0;
}
