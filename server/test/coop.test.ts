/** 合作模式 WebSocket（API.md §18） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, type Socket } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { start } from './helpers.ts';
import { Db } from '../src/db.ts';
import { createApp } from '../src/app.ts';

type M = Record<string, any>;

/** 测试用客户端：收到的消息排队，按条件取 */
class Client {
  ws: WebSocket;
  queue: M[] = [];
  waiters: { pred: (m: M) => boolean; res: (m: M) => void }[] = [];
  closed: Promise<{ code: number; reason: string }>;
  opened: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res());
      this.ws.addEventListener('error', () => rej(new Error('ws error')));
    });
    this.opened.catch(() => {});
    this.closed = new Promise((res) => this.ws.addEventListener('close', (e) => res({ code: e.code, reason: e.reason })));
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data)) as M;
      const i = this.waiters.findIndex((w) => w.pred(m));
      if (i >= 0) this.waiters.splice(i, 1)[0].res(m);
      else this.queue.push(m);
    });
  }

  send(m: unknown): void {
    this.ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  }

  /** 等下一条 t 类型（或满足条件）的消息 */
  next(t: string | ((m: M) => boolean), ms = 2000): Promise<M> {
    const pred = typeof t === 'string' ? (m: M) => m.t === t : t;
    const i = this.queue.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]);
    return new Promise((res, rej) => {
      const w = { pred, res: (m: M) => (clearTimeout(timer), res(m)) };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        rej(new Error(`等不到消息 ${String(t)}；已收到 ${JSON.stringify(this.queue)}`));
      }, ms);
      this.waiters.push(w);
    });
  }

  /** 发一条请求并等回复 */
  async req(m: M, t: string): Promise<M> {
    this.send(m);
    return this.next(t);
  }

  /** 断言一段时间内没有收到某类消息 */
  async none(t: string, ms = 150): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
    assert.equal(this.queue.filter((m) => m.t === t).length, 0, `不应收到 ${t}: ${JSON.stringify(this.queue)}`);
  }

  close(): void {
    this.ws.close();
  }
}

async function setup() {
  const s = await start();
  const url = s.base.replace('http', 'ws') + '/api/coop';
  const clients: Client[] = [];
  /** 注册一个孩子并连上、完成 hello */
  const player = async (name: string, grade = 3) => {
    const k = await s.kid(name, grade);
    const c = new Client(url);
    clients.push(c);
    await c.opened;
    const w = await c.req({ t: 'hello', token: k.token }, 'welcome');
    assert.deepEqual(w.you, { playerId: k.id, name, grade });
    return Object.assign(c, { kid: k });
  };
  const raw = () => {
    const c = new Client(url);
    clients.push(c);
    return c;
  };
  const stop = async () => {
    for (const c of clients) c.close();
    await s.stop();
  };
  return { s, url, player, raw, stop };
}

test('合作：鉴权失败 / 鉴权前发其他消息 → error auth 后关闭 4401', async () => {
  const t = await setup();
  try {
    const a = t.raw();
    await a.opened;
    a.send({ t: 'hello', token: 'nope' });
    assert.equal((await a.next('error')).code, 'auth');
    assert.equal((await a.closed).code, 4401);

    const b = t.raw();
    await b.opened;
    b.send({ t: 'rooms' });
    assert.deepEqual(await b.next('error'), { t: 'error', code: 'auth', message: '请先登录' });
    assert.equal((await b.closed).code, 4401);
  } finally {
    await t.stop();
  }
});

test('合作：其他地址不能升级成 WebSocket', async () => {
  const t = await setup();
  try {
    const c = new Client(t.s.base.replace('http', 'ws') + '/api/other');
    await assert.rejects(c.opened);
    assert.equal((await c.closed).code, 1006);
  } finally {
    await t.stop();
  }
});

test('合作：建房、进房、房间广播、各种进房错误', async () => {
  const t = await setup();
  try {
    const a = await t.player('甲', 3);
    const b = await t.player('乙', 5);
    const r0 = await a.req({ t: 'create', levelId: '3-1', mapId: 'arena', agentId: 'ag1' }, 'room');
    assert.equal(r0.selfSeat, 0);
    assert.match(r0.room.id, /^\d{4}$/);
    assert.equal(r0.room.state, 'lobby');
    assert.equal(r0.room.mode, 'coop', '老客户端不发 mode → 合作');
    assert.deepEqual(r0.room.members, [{ seat: 0, playerId: a.kid.id, name: '甲', grade: 3, agentId: 'ag1', isHost: true, team: 0 }]);
    const id = r0.room.id;

    // 已在房间里不能再建 / 进
    assert.equal((await a.req({ t: 'create', levelId: '3-1', mapId: 'arena', agentId: 'x' }, 'error')).code, 'in-room');
    assert.equal((await b.req({ t: 'join', roomId: '0000', agentId: 'ag2' }, 'error')).code, 'not-found');

    const rb = await b.req({ t: 'join', roomId: id, agentId: 'ag2' }, 'room');
    assert.equal(rb.selfSeat, 1);
    assert.equal(rb.room.members.length, 2);
    assert.deepEqual(rb.room.members[1], { seat: 1, playerId: b.kid.id, name: '乙', grade: 5, agentId: 'ag2', isHost: false, team: 0 });
    const ra = await a.next('room');
    assert.equal(ra.selfSeat, undefined, '其他人收到的 room 没有 selfSeat');
    assert.deepEqual(ra.room, rb.room);
    assert.equal((await b.req({ t: 'join', roomId: id, agentId: 'ag2' }, 'error')).code, 'in-room');

    // 同一个孩子用另一个设备进同一个房间
    const b2 = t.raw();
    await b2.opened;
    await b2.req({ t: 'hello', token: b.kid.token }, 'welcome');
    b2.send({ t: 'join', roomId: id, agentId: 'ag2' });
    const dupErr = await b2.next('error', 6000); // 先探测旧连接（3 秒），它还活着 → 拒绝
    assert.equal(dupErr.code, 'duplicate');
    assert.match(dupErr.message, /乙.*切换玩家/);

    // 换角色 → 全房间收到；非房主不能换关卡
    b.send({ t: 'agent', agentId: 'ag9' });
    assert.equal((await a.next('room')).room.members[1].agentId, 'ag9');
    assert.equal((await b.next('room')).room.members[1].agentId, 'ag9');
    assert.equal((await b.req({ t: 'level', levelId: '3-2', mapId: 'm2' }, 'error')).code, 'not-host');
    a.send({ t: 'level', levelId: '3-2', mapId: 'm2' });
    assert.equal((await b.next('room')).room.levelId, '3-2');
    assert.equal((await a.next('room')).room.mapId, 'm2');

    // 满员
    const c = await t.player('丙');
    const d = await t.player('丁');
    const e = await t.player('戊');
    assert.equal((await c.req({ t: 'join', roomId: id, agentId: 'x' }, 'room')).selfSeat, 2);
    assert.equal((await d.req({ t: 'join', roomId: id, agentId: 'x' }, 'room')).selfSeat, 3);
    const full = await e.req({ t: 'join', roomId: id, agentId: 'x' }, 'error');
    assert.equal(full.code, 'full');
    assert.equal(typeof full.message, 'string');

    // 不在房间里
    for (const tt of ['agent', 'level', 'start', 'msg', 'end']) assert.equal((await e.req({ t: tt, agentId: 'x', levelId: 'l', mapId: 'm', seed: 1, to: 'all' }, 'error')).code, 'no-room', tt);
    // 未知类型、坏 JSON 不断开
    assert.equal((await e.req({ t: 'whatever' }, 'error')).code, 'bad-message');
    assert.equal((await e.req('not json' as unknown as M, 'error')).code, 'bad-message');
    assert.deepEqual(await e.req({ t: 'ping' }, 'pong'), { t: 'pong' });

    // 对局中不能进
    a.send({ t: 'start', seed: 7, levelId: '3-2', mapId: 'm2', opts: {} });
    await a.next('start');
    assert.equal((await e.req({ t: 'join', roomId: id, agentId: 'x' }, 'error')).code, 'started');
    assert.equal((await b.req({ t: 'agent', agentId: 'y' }, 'error')).code, 'started');
  } finally {
    await t.stop();
  }
});

test('合作：房间列表订阅推送，进房后自动退订', async () => {
  const t = await setup();
  try {
    const a = await t.player('甲');
    const b = await t.player('乙');
    const c = await t.player('丙');
    assert.deepEqual((await b.req({ t: 'rooms' }, 'rooms')).rooms, []);
    assert.deepEqual((await c.req({ t: 'rooms' }, 'rooms')).rooms, []);

    const id = (await a.req({ t: 'create', levelId: '3-1', mapId: 'arena', agentId: 'ag1' }, 'room')).room.id;
    const pushed = await b.next('rooms');
    assert.equal(pushed.rooms.length, 1);
    assert.equal(pushed.rooms[0].id, id);
    assert.equal(pushed.rooms[0].members.length, 1);
    await c.next('rooms');

    // b 进房 → b 退订；c 收到成员变化
    await b.req({ t: 'join', roomId: id, agentId: 'ag2' }, 'room');
    assert.equal((await c.next('rooms')).rooms[0].members.length, 2);
    a.send({ t: 'level', levelId: '3-3', mapId: 'm3' });
    assert.equal((await c.next('rooms')).rooms[0].levelId, '3-3');
    await b.next('room');
    await b.none('rooms');

    // 房主离开 → 房间消失
    a.send({ t: 'leave' });
    assert.deepEqual((await c.next('rooms')).rooms, []);
    await b.next('closed');
    await b.none('rooms');
    // 离开后需要重新订阅
    assert.deepEqual((await b.req({ t: 'rooms' }, 'rooms')).rooms, []);
  } finally {
    await t.stop();
  }
});

test('合作：开局、按座位转发、结束回大厅', async () => {
  const t = await setup();
  try {
    const a = await t.player('甲', 3);
    const b = await t.player('乙', 4);
    const c = await t.player('丙', 5);
    const id = (await a.req({ t: 'create', levelId: '3-1', mapId: 'arena', agentId: 'ag1' }, 'room')).room.id;
    await b.req({ t: 'join', roomId: id, agentId: 'ag2' }, 'room');
    await c.req({ t: 'join', roomId: id, agentId: 'ag3' }, 'room');
    await a.next((m) => m.t === 'room' && m.room.members.length === 3);
    await b.next((m) => m.t === 'room' && m.room.members.length === 3);

    assert.equal((await b.req({ t: 'start', seed: 1 }, 'error')).code, 'not-host');
    const opts = { roundsToWin: 3, bots: 2 };
    a.send({ t: 'start', seed: 42, levelId: '3-2', mapId: 'm2', opts });
    const sa = await a.next('start');
    const sb = await b.next('start');
    const sc = await c.next('start');
    assert.deepEqual(sa, sb);
    assert.deepEqual(sa, sc);
    assert.deepEqual(sa.start, {
      mode: 'coop',
      seed: 42,
      levelId: '3-2',
      mapId: 'm2',
      opts,
      members: [
        { seat: 0, playerId: a.kid.id, name: '甲', grade: 3, agentId: 'ag1', isHost: true, team: 0 },
        { seat: 1, playerId: b.kid.id, name: '乙', grade: 4, agentId: 'ag2', isHost: false, team: 0 },
        { seat: 2, playerId: c.kid.id, name: '丙', grade: 5, agentId: 'ag3', isHost: false, team: 0 },
      ],
    });
    assert.equal((await a.req({ t: 'start', seed: 1 }, 'error')).code, 'started');

    // 转发
    b.send({ t: 'msg', to: 'host', d: { hit: 1 } });
    assert.deepEqual(await a.next('msg'), { t: 'msg', from: 1, d: { hit: 1 } });
    a.send({ t: 'msg', to: 2, d: 'only-c' });
    assert.deepEqual(await c.next('msg'), { t: 'msg', from: 0, d: 'only-c' });
    c.send({ t: 'msg', to: 'all', d: [1, 2, 3] });
    assert.deepEqual(await a.next('msg'), { t: 'msg', from: 2, d: [1, 2, 3] });
    assert.deepEqual(await b.next('msg'), { t: 'msg', from: 2, d: [1, 2, 3] });
    a.send({ t: 'msg', to: 9, d: 'nobody' }); // 不存在的 seat 静默丢弃
    await a.none('error');
    await a.none('msg', 0);
    await b.none('msg', 0);
    await c.none('msg', 0);

    // 结束 → 回大厅，可以再开
    assert.equal((await b.req({ t: 'end' }, 'error')).code, 'not-host');
    a.send({ t: 'end' });
    assert.equal((await b.next('room')).room.state, 'lobby');
    assert.equal((await a.next('room')).room.state, 'lobby');
    a.send({ t: 'start', seed: 43, opts: {} });
    const again = await c.next('start');
    assert.equal(again.start.seed, 43);
    assert.equal(again.start.levelId, '3-2');
  } finally {
    await t.stop();
  }
});

test('合作：非房主离开 / 掉线 → left + room；seat 不复用；房主离开 → closed', async () => {
  const t = await setup();
  try {
    const a = await t.player('甲');
    const b = await t.player('乙');
    const c = await t.player('丙');
    const id = (await a.req({ t: 'create', levelId: '3-1', mapId: 'arena', agentId: 'ag1' }, 'room')).room.id;
    await b.req({ t: 'join', roomId: id, agentId: 'ag2' }, 'room');
    await c.req({ t: 'join', roomId: id, agentId: 'ag3' }, 'room');
    a.queue.length = 0;
    c.queue.length = 0;

    b.send({ t: 'leave' });
    assert.deepEqual(await a.next('left'), { t: 'left', seat: 1 });
    assert.deepEqual(await c.next('left'), { t: 'left', seat: 1 });
    assert.deepEqual((await a.next('room')).room.members.map((m: M) => m.seat), [0, 2]);
    await c.next('room');
    // 回来后拿到新座位
    b.queue.length = 0;
    assert.equal((await b.req({ t: 'join', roomId: id, agentId: 'ag2' }, 'room')).selfSeat, 3);
    await a.next('room');
    await c.next('room');

    // 掉线 = 离开
    c.close();
    assert.deepEqual(await a.next('left'), { t: 'left', seat: 2 });
    assert.deepEqual((await b.next('room')).room.members.map((m: M) => m.seat), [0, 3]);

    // 房主掉线 → 房间关闭，其他人还连着，可以建新房
    a.close();
    assert.deepEqual(await b.next('closed'), { t: 'closed', reason: '房主离开了房间' });
    assert.equal((await b.req({ t: 'msg', to: 'all', d: 1 }, 'error')).code, 'no-room');
    assert.equal((await b.req({ t: 'join', roomId: id, agentId: 'x' }, 'error')).code, 'not-found');
    assert.equal((await b.req({ t: 'create', levelId: '3-1', mapId: 'arena', agentId: 'ag1' }, 'room')).selfSeat, 0);
  } finally {
    await t.stop();
  }
});

test('合作：超过 16 KB 关闭 1009，超过 120 条/秒关闭 1008', async () => {
  const t = await setup();
  try {
    const a = await t.player('甲');
    a.send({ t: 'msg', to: 'all', d: 'x'.repeat(17 * 1024) });
    assert.equal((await a.closed).code, 1009);

    const b = await t.player('乙');
    const big = await b.req({ t: 'ping', pad: 'y'.repeat(15 * 1024) }, 'pong'); // 16 KB 以内没问题
    assert.equal(big.t, 'pong');
    for (let i = 0; i < 130; i++) b.send({ t: 'ping' });
    assert.equal((await b.closed).code, 1008);
  } finally {
    await t.stop();
  }
});

// ---------------------------------------------------------------- 原始帧

/** 客户端帧（带掩码） */
function frame(op: number, payload: Buffer, fin = true): Buffer {
  const mask = randomBytes(4);
  const n = payload.length;
  const h = n < 126 ? Buffer.from([0, n]) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  if (n >= 126 && n < 65536) {
    h[1] = 126;
    h.writeUInt16BE(n, 2);
  } else if (n >= 65536) {
    h[1] = 127;
    h.writeBigUInt64BE(BigInt(n), 2);
  }
  h[0] = (fin ? 0x80 : 0) | op;
  h[1] |= 0x80;
  const body = Buffer.from(payload);
  for (let i = 0; i < n; i++) body[i] ^= mask[i & 3];
  return Buffer.concat([h, mask, body]);
}

/** 原始 TCP 连接：握手 + 解析服务器帧 */
async function rawConnect(base: string) {
  const { port } = new URL(base);
  const sock: Socket = connect(Number(port), '127.0.0.1');
  await new Promise<void>((r) => sock.once('connect', () => r()));
  const key = randomBytes(16).toString('base64');
  sock.write(`GET /api/coop HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  let buf = Buffer.alloc(0);
  const frames: { op: number; data: Buffer }[] = [];
  let wake: (() => void) | null = null;
  let headers = '';
  let ended = false;
  sock.on('data', (c: Buffer) => {
    buf = Buffer.concat([buf, c]);
    if (!headers) {
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      headers = buf.subarray(0, i).toString();
      buf = buf.subarray(i + 4);
    }
    while (buf.length >= 2) {
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) break;
        len = buf.readUInt16BE(2);
        off = 4;
      }
      if (buf.length < off + len) break;
      frames.push({ op: buf[0] & 0x0f, data: buf.subarray(off, off + len) });
      buf = buf.subarray(off + len);
    }
    wake?.();
  });
  sock.on('close', () => {
    ended = true;
    wake?.();
  });
  sock.on('error', () => {});
  const until = async (cond: () => boolean, ms = 2000) => {
    const deadline = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > deadline) throw new Error('timeout; frames=' + frames.map((f) => f.op).join(','));
      await new Promise<void>((r) => {
        wake = r;
        setTimeout(r, 50);
      });
    }
  };
  await until(() => !!headers);
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  return { sock, frames, until, headers, accept, isEnded: () => ended };
}

test('合作：原始帧——握手、分片消息中间夹 ping、扩展长度', async () => {
  const t = await setup();
  try {
    const k = await t.s.kid('甲');
    const r = await rawConnect(t.s.base);
    assert.match(r.headers, /^HTTP\/1\.1 101/);
    assert.ok(r.headers.includes(`Sec-WebSocket-Accept: ${r.accept}`));

    const hello = Buffer.from(JSON.stringify({ t: 'hello', token: k.token }));
    // 分三片发，中间夹一个 ping（控制帧可以插在分片之间），而且故意一个字节一个字节地写
    const bytes = Buffer.concat([
      frame(0x1, hello.subarray(0, 5), false),
      frame(0x9, Buffer.from('hi')),
      frame(0x0, hello.subarray(5, 20), false),
      frame(0x0, hello.subarray(20), true),
    ]);
    for (const b of bytes) r.sock.write(Buffer.from([b]));
    await r.until(() => r.frames.length >= 2);
    assert.deepEqual(r.frames[0], { op: 0xa, data: Buffer.from('hi') }, '先回 pong');
    assert.equal(r.frames[1].op, 0x1);
    assert.equal(JSON.parse(r.frames[1].data.toString()).t, 'welcome');

    // 16 位扩展长度（>125 字节）
    r.sock.write(frame(0x1, Buffer.from(JSON.stringify({ t: 'ping', pad: '中'.repeat(100) }))));
    await r.until(() => r.frames.length >= 3);
    assert.deepEqual(JSON.parse(r.frames[2].data.toString()), { t: 'pong' });

    // 64 位长度声明超过上限 → 立刻 1009，不等数据
    const h = Buffer.alloc(14);
    h[0] = 0x81;
    h[1] = 0x80 | 127;
    h.writeBigUInt64BE(1n << 40n, 2);
    r.sock.write(h);
    await r.until(() => r.frames.some((f) => f.op === 0x8));
    assert.equal(r.frames.find((f) => f.op === 0x8)!.data.readUInt16BE(0), 1009);
    await r.until(() => r.isEnded());
  } finally {
    await t.stop();
  }
});

test('合作：没有掩码的帧 → 1002；不回 pong 的连接会被断开', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'suanjing-'));
  const db = new Db(join(dir, 'db.sqlite'));
  const server = createApp({ db, adminPassword: '', coop: { pingIntervalMs: 40, pongTimeoutMs: 100, helloTimeoutMs: 5000 } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const a = await rawConnect(base);
    a.sock.write(Buffer.from([0x81, 0x02, 0x7b, 0x7d])); // 未加掩码的 "{}"
    await a.until(() => r8(a.frames));
    assert.equal(a.frames.find((f) => f.op === 0x8)!.data.readUInt16BE(0), 1002);

    const b = await rawConnect(base);
    await b.until(() => b.isEnded(), 1500);
    assert.ok(b.frames.some((f) => f.op === 0x9), '断开前收到过 ping');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

const r8 = (fs: { op: number }[]) => fs.some((f) => f.op === 0x8);

test('合作：hello 超时 → 4401；服务器停机时关闭所有连接', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'suanjing-'));
  const db = new Db(join(dir, 'db.sqlite'));
  const server = createApp({ db, adminPassword: '', coop: { helloTimeoutMs: 80 } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/coop`;
  try {
    const a = new Client(url);
    await a.opened;
    assert.equal((await a.next('error')).code, 'auth');
    assert.equal((await a.closed).code, 4401);
    const b = new Client(url);
    await b.opened;
    await new Promise<void>((r) => server.close(() => r()));
    assert.equal((await b.closed).code, 1001);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('合作：同账号旧连接已经掉线（不回 ping）→ 新设备进房时把「影子」踢掉；影子是房主 → 房间关闭并说明', async () => {
  const t = await setup();
  try {
    const a = await t.player('甲');
    const id = (await a.req({ t: 'create', levelId: '3-1', mapId: 'arena', agentId: 'ag1' }, 'room')).room.id;
    const kb = await t.s.kid('乙', 4);
    const send = (r: Awaited<ReturnType<typeof rawConnect>>, m: unknown) => r.sock.write(frame(0x1, Buffer.from(JSON.stringify(m))));
    const text = (r: Awaited<ReturnType<typeof rawConnect>>, tp: string) =>
      r.frames.some((f) => f.op === 0x1 && JSON.parse(f.data.toString()).t === tp);

    // 乙 的平板锁屏了：连接还挂在房间里，但不再回应任何东西
    const ghost = await rawConnect(t.s.base);
    send(ghost, { t: 'hello', token: kb.token });
    await ghost.until(() => text(ghost, 'welcome'));
    send(ghost, { t: 'join', roomId: id, agentId: 'ag2' });
    await ghost.until(() => text(ghost, 'room'));
    await a.next((m) => m.t === 'room' && m.room.members.length === 2);

    const b = await t.raw();
    await b.opened;
    await b.req({ t: 'hello', token: kb.token }, 'welcome');
    b.send({ t: 'join', roomId: id, agentId: 'ag2' });
    const rb = await b.next('room', 6000);
    assert.deepEqual(rb.room.members.map((m: M) => m.name), ['甲', '乙']);
    assert.equal((await a.next('left')).seat, 1, '影子离开');
    await ghost.until(() => ghost.isEnded());

    // 房主的设备掉线了，同一个账号想从另一台设备进自己的房间
    const kc = await t.s.kid('丙', 5);
    const ghostHost = await rawConnect(t.s.base);
    send(ghostHost, { t: 'hello', token: kc.token });
    await ghostHost.until(() => text(ghostHost, 'welcome'));
    send(ghostHost, { t: 'create', levelId: '3-1', mapId: 'arena', agentId: 'ag3' });
    await ghostHost.until(() => text(ghostHost, 'room'));
    const id2 = JSON.parse(ghostHost.frames.filter((f) => f.op === 0x1).map((f) => f.data.toString()).find((x) => x.includes('"room"'))!).room.id;
    const c = await t.raw();
    await c.opened;
    await c.req({ t: 'hello', token: kc.token }, 'welcome');
    c.send({ t: 'join', roomId: id2, agentId: 'ag3' });
    assert.equal((await c.next('error', 6000)).code, 'host-gone');
    await ghostHost.until(() => ghostHost.isEnded());
  } finally {
    await t.stop();
  }
});

test('一个账号只能在一台设备上登录：新登录让旧设备的令牌失效（带说明），旧设备的合作连接被断开、房间关闭', async () => {
  const t = await setup();
  try {
    const a = await t.player('甲'); // 旧设备上的 甲，建了房间
    const b = await t.player('乙');
    const id = (await a.req({ t: 'create', levelId: '3-1', mapId: 'arena', agentId: 'ag1' }, 'room')).room.id;
    await b.req({ t: 'join', roomId: id, agentId: 'ag2' }, 'room');
    await a.next('room');

    // 甲 在另一台设备上登录
    const lg = await t.s.call('/api/login', 'POST', { name: '甲', password: '1234' });
    assert.equal(lg.status, 200);
    const err = await a.next('error');
    assert.equal(err.code, 'replaced');
    assert.match(err.message, /另一台设备/);
    assert.equal((await a.closed).code, 4409);
    assert.equal((await b.next('closed')).reason, '房主离开了房间');

    // 旧令牌：401 并说明原因；新令牌可用；乙 不受影响
    const old = await a.kid.call('/api/me');
    assert.equal(old.status, 401);
    assert.match(old.json.error, /另一台设备/);
    assert.equal((await t.s.call('/api/me', 'GET', undefined, { Authorization: `Bearer ${lg.json.token}` })).status, 200);
    assert.equal((await b.kid.call('/api/me')).status, 200);
    // 普通的未登录仍是「请先登录」
    assert.equal((await t.s.call('/api/me', 'GET', undefined, { Authorization: 'Bearer nope' })).json.error, '请先登录');

    // 旧令牌连合作模式也进不来
    const c = t.raw();
    await c.opened;
    assert.equal((await c.req({ t: 'hello', token: a.kid.token }, 'error')).code, 'auth');
  } finally {
    await t.stop();
  }
});

// ---------------------------------------------------------------- 联机对战

test('对战：建房带 mode、进房自动分队、room / rooms 带 mode 和 team', async () => {
  const t = await setup();
  try {
    const a = await t.player('甲');
    const b = await t.player('乙');
    const c = await t.player('丙');
    const d = await t.player('丁');
    const w = await t.player('看');
    assert.equal((await a.req({ t: 'create', levelId: '3-1', mapId: 'arena', agentId: 'x', mode: 'nope' }, 'error')).code, 'bad-message');
    await w.req({ t: 'rooms' }, 'rooms');
    const r0 = await a.req({ t: 'create', levelId: '3-1', mapId: 'arena', agentId: 'ag1', mode: 'versus' }, 'room');
    assert.equal(r0.room.mode, 'versus');
    assert.equal(r0.room.members[0].team, 0, '房主在蓝队');
    const listed = await w.next('rooms');
    assert.equal(listed.rooms[0].mode, 'versus');
    const id = r0.room.id;

    // 真人少的队优先，一样多去蓝队
    assert.deepEqual((await b.req({ t: 'join', roomId: id, agentId: 'ag2' }, 'room')).room.members.map((m: M) => m.team), [0, 1]);
    assert.deepEqual((await c.req({ t: 'join', roomId: id, agentId: 'ag3' }, 'room')).room.members.map((m: M) => m.team), [0, 1, 0]);
    assert.deepEqual((await d.req({ t: 'join', roomId: id, agentId: 'ag4' }, 'room')).room.members.map((m: M) => m.team), [0, 1, 0, 1]);
    const l = await w.next((m) => m.t === 'rooms' && m.rooms[0].members.length === 4);
    assert.deepEqual(l.rooms[0].members.map((m: M) => m.team), [0, 1, 0, 1]);

    // 有人走了，空出来的队优先补
    b.send({ t: 'leave' });
    await a.next((m) => m.t === 'room' && m.room.members.length === 3);
    b.queue.length = 0;
    assert.deepEqual((await b.req({ t: 'join', roomId: id, agentId: 'ag2' }, 'room')).room.members.map((m: M) => [m.seat, m.team]), [[0, 0], [2, 0], [3, 1], [4, 1]]);

    // 合作房间：所有人都是 0，不能换队
    const e = await t.player('戊');
    const f = await t.player('己');
    const id2 = (await e.req({ t: 'create', levelId: '3-1', mapId: 'arena', agentId: 'x', mode: 'coop' }, 'room')).room.id;
    assert.deepEqual((await f.req({ t: 'join', roomId: id2, agentId: 'y' }, 'room')).room.members.map((m: M) => m.team), [0, 0]);
    assert.equal((await f.req({ t: 'team', team: 1 }, 'error')).code, 'not-versus');
  } finally {
    await t.stop();
  }
});

test('对战：换队（自己换 / 房主换别人）、各种错误、开局要两队都有人', async () => {
  const t = await setup();
  try {
    const a = await t.player('甲', 3);
    const b = await t.player('乙', 4);
    const c = await t.player('丙', 5);
    const id = (await a.req({ t: 'create', levelId: '3-1', mapId: 'arena', agentId: 'ag1', mode: 'versus' }, 'room')).room.id;
    assert.equal((await a.req({ t: 'team', team: 1 }, 'room')).room.members[0].team, 1, '房主也能换自己');

    // 只有一个人：开不了局
    const e1 = await a.req({ t: 'start', seed: 1 }, 'error');
    assert.equal(e1.code, 'teams');
    assert.match(e1.message, /蓝队还没有人/);

    await b.req({ t: 'join', roomId: id, agentId: 'ag2' }, 'room');
    await a.next((m) => m.t === 'room' && m.room.members.length === 2);
    await c.req({ t: 'join', roomId: id, agentId: 'ag3' }, 'room');
    const r3 = await a.next((m) => m.t === 'room' && m.room.members.length === 3);
    assert.deepEqual(r3.room.members.map((m: M) => m.team), [1, 0, 0]);
    b.queue.length = 0;
    c.queue.length = 0;

    // 坏参数
    for (const bad of [{ team: 2 }, { team: '1' }, {}, { team: 1, seat: 'x' }, { team: 1, seat: 1.5 }]) assert.equal((await b.req({ t: 'team', ...bad }, 'error')).code, 'bad-message', JSON.stringify(bad));
    // 非房主不能换别人（换自己时带上自己的 seat 可以）
    assert.equal((await b.req({ t: 'team', team: 1, seat: 2 }, 'error')).code, 'not-host');
    assert.equal((await b.req({ t: 'team', team: 1, seat: 1 }, 'room')).room.members[1].team, 1);
    await c.next('room');
    await a.next('room');
    // 房主换别人
    assert.equal((await a.req({ t: 'team', team: 1, seat: 2 }, 'room')).room.members[2].team, 1);
    assert.equal((await c.next('room')).room.members[2].team, 1);
    await b.next('room');
    assert.equal((await a.req({ t: 'team', team: 0, seat: 9 }, 'error')).code, 'no-member');
    // 换到已经在的队：什么都不发
    a.send({ t: 'team', team: 1 });
    await a.none('room');
    await a.none('error', 0);

    // 全在红队 → 不能开
    const e2 = await a.req({ t: 'start', seed: 1 }, 'error');
    assert.equal(e2.code, 'teams');
    assert.match(e2.message, /蓝队/);
    await c.req({ t: 'team', team: 0 }, 'room');
    await a.next('room');
    await b.next('room');

    // 不限每队人数：1 对 2 可以开
    const opts = { roundsToWin: 3 };
    a.send({ t: 'start', seed: 5, opts });
    const sa = await a.next('start');
    assert.deepEqual(await b.next('start'), sa);
    assert.deepEqual(await c.next('start'), sa);
    assert.deepEqual(sa.start, {
      mode: 'versus',
      seed: 5,
      levelId: '3-1',
      mapId: 'arena',
      opts,
      members: [
        { seat: 0, playerId: a.kid.id, name: '甲', grade: 3, agentId: 'ag1', isHost: true, team: 1 },
        { seat: 1, playerId: b.kid.id, name: '乙', grade: 4, agentId: 'ag2', isHost: false, team: 1 },
        { seat: 2, playerId: c.kid.id, name: '丙', grade: 5, agentId: 'ag3', isHost: false, team: 0 },
      ],
    });
    // 对局中不能换队；结束后可以
    assert.equal((await b.req({ t: 'team', team: 0 }, 'error')).code, 'started');
    a.send({ t: 'end' });
    await b.next('room');
    assert.equal((await b.req({ t: 'team', team: 0 }, 'room')).room.members[1].team, 0);
  } finally {
    await t.stop();
  }
});
