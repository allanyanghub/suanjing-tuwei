/// <reference types="node" />
/** 合作模式客户端：连接地址、鉴权、房间、开局产生 CoopLink、消息顺序、成员离开、房间关闭、断线 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoopClient, coopUrl, type WSLike } from '../../src/net/coop.ts';
import type { CoopLink, CoopMember, CoopMode, CoopStart, CoopTeam } from '../../src/net/coop-link.ts';
import { flushMicro } from './helpers.ts';

class FakeSocket implements WSLike {
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;
  url: string;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code?: number): void {
    this.closedWith = code ?? 1000;
    this.readyState = 3;
  }
  // ---- 测试控制
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  recv(o: unknown): void {
    this.onmessage?.({ data: JSON.stringify(o) });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  types(): unknown[] {
    return this.sent.map((m) => m.t);
  }
}

const mem = (seat: number, name: string, grade: 3 | 4 | 5 | 6, agentId = 'a', isHost = seat === 0, team: CoopTeam = 0): CoopMember => ({ seat, playerId: 100 + seat, name, grade, agentId, isHost, team });
const roomOf = (members: CoopMember[], state: 'lobby' | 'playing' = 'lobby', mode: CoopMode = 'coop') => ({ id: '4821', state, mode, levelId: '3-1', mapId: 'm1', members });

async function connected(): Promise<{ c: CoopClient; s: FakeSocket }> {
  const c = new CoopClient({ url: 'ws://x/api/coop', token: 'tok', WebSocket: FakeSocket });
  const p = c.connect();
  const s = FakeSocket.last!;
  s.open();
  s.recv({ t: 'welcome', you: { playerId: 101, name: '小红', grade: 4 } });
  await p;
  return { c, s };
}

test('coopUrl：同源用页面地址（https → wss），开发时由 ?api= 地址换成 ws', () => {
  assert.equal(coopUrl('', { protocol: 'http:', host: 'nas.local:8080' }), 'ws://nas.local:8080/api/coop');
  assert.equal(coopUrl('', { protocol: 'https:', host: 'nas.local' }), 'wss://nas.local/api/coop');
  assert.equal(coopUrl('http://127.0.0.1:18096/', null), 'ws://127.0.0.1:18096/api/coop');
  assert.equal(coopUrl('https://home.example', null), 'wss://home.example/api/coop');
});

test('连接：先发 hello + 令牌，收到 welcome 才算连上', async () => {
  const { c, s } = await connected();
  assert.deepEqual(s.sent[0], { t: 'hello', token: 'tok' });
  assert.equal(c.ready, true);
  assert.deepEqual(c.you, { playerId: 101, name: '小红', grade: 4 });
});

test('连接：令牌无效 → 中文错误；连不上 → 中文错误', async () => {
  const c = new CoopClient({ url: 'ws://x', token: 'bad', WebSocket: FakeSocket });
  const p = c.connect();
  const s = FakeSocket.last!;
  s.open();
  s.recv({ t: 'error', code: 'auth', message: '请先登录' });
  await assert.rejects(p, /登录/);

  const c2 = new CoopClient({ url: 'ws://x', token: 't', WebSocket: FakeSocket });
  const p2 = c2.connect();
  FakeSocket.last!.drop(1006);
  await assert.rejects(p2, /连不上/);
  assert.equal(c2.ready, false);
});

test('连接超时：reject 并关闭套接字', async () => {
  let fire: (() => void) | null = null;
  const c = new CoopClient({ url: 'ws://x', token: 't', WebSocket: FakeSocket, setTimeout: (fn) => ((fire = fn), 1), clearTimeout: () => undefined });
  const p = c.connect();
  const s = FakeSocket.last!;
  fire!();
  await assert.rejects(p, /超时/);
  assert.equal(s.closedWith, 1000);
});

test('大厅：房间列表、建房、进房、换角色 / 关卡、开局、结束、离开都按协议发送', async () => {
  const { c, s } = await connected();
  const lists: number[] = [];
  c.on('rooms', (r) => lists.push(r.length));
  c.subscribeRooms();
  s.recv({ t: 'rooms', rooms: [roomOf([mem(0, '小明', 3)])] });
  assert.deepEqual(lists, [1]);
  assert.equal(c.rooms[0].id, '4821');

  c.join('4821', 'nova');
  s.recv({ t: 'room', room: roomOf([mem(0, '小明', 3), mem(1, '小红', 4, 'nova')]), selfSeat: 1 });
  assert.equal(c.selfSeat, 1);
  assert.equal(c.isHost, false);
  assert.equal(c.room?.members.length, 2);
  c.setAgent('blaze');
  c.leave();
  assert.equal(c.room, null);

  c.create('3-2', 'm2', 'nova');
  s.recv({ t: 'room', room: roomOf([mem(0, '小红', 4)]), selfSeat: 0 });
  assert.equal(c.isHost, true);
  c.setLevel('3-3', 'm3');
  c.start('3-3', 'm3', { roundsToWin: 3 }, 12345);
  c.end();
  assert.deepEqual(s.sent.slice(1), [
    { t: 'rooms' },
    { t: 'join', roomId: '4821', agentId: 'nova' },
    { t: 'agent', agentId: 'blaze' },
    { t: 'leave' },
    { t: 'create', levelId: '3-2', mapId: 'm2', agentId: 'nova', mode: 'coop' },
    { t: 'level', levelId: '3-3', mapId: 'm3' },
    { t: 'start', seed: 12345, levelId: '3-3', mapId: 'm3', opts: { roundsToWin: 3 } },
    { t: 'end' },
  ]);
});

test('非房主不发 end；错误码换成孩子能看懂的中文', async () => {
  const { c, s } = await connected();
  const errs: string[] = [];
  c.on('error', (e) => errs.push(`${e.code}:${e.message}`));
  c.join('1', 'a');
  s.recv({ t: 'error', code: 'full', message: 'room full' });
  s.recv({ t: 'error', code: 'weird', message: '服务器说的话' });
  assert.deepEqual(errs, ['full:这个房间已经满了（最多 4 个人）', 'weird:服务器说的话']);
  s.recv({ t: 'room', room: roomOf([mem(0, '小明', 3), mem(1, '小红', 4)]), selfSeat: 1 });
  c.end();
  assert.ok(!s.types().includes('end'));
});

function startMsg(members: CoopMember[]): { t: 'start'; start: CoopStart } {
  return { t: 'start', start: { mode: 'coop', seed: 7, levelId: '3-1', mapId: 'm1', opts: {}, members } };
}

test('开局：产生 CoopLink（selfSeat / isHost / members），send → {t:msg,to,d}', async () => {
  const { c, s } = await connected();
  c.join('4821', 'a');
  const ms = [mem(0, '小明', 3), mem(1, '小红', 4), mem(2, '小刚', 6)];
  s.recv({ t: 'room', room: roomOf(ms), selfSeat: 1 });
  const got: { link: CoopLink; start: CoopStart }[] = [];
  c.on('start', (v) => got.push(v));
  s.recv(startMsg(ms));
  assert.equal(got.length, 1);
  const { link, start } = got[0];
  assert.equal(start.seed, 7);
  assert.equal(link.selfSeat, 1);
  assert.equal(link.isHost, false);
  assert.deepEqual(link.members().map((m) => m.seat), [0, 1, 2]);
  assert.equal(c.room?.state, 'playing');
  link.send({ k: 'pos', x: 1 });
  link.send({ k: 'hit' }, 'host');
  link.send({ k: 'p' }, 2);
  assert.deepEqual(s.sent.slice(-3), [
    { t: 'msg', to: 'all', d: { k: 'pos', x: 1 } },
    { t: 'msg', to: 'host', d: { k: 'hit' } },
    { t: 'msg', to: 2, d: { k: 'p' } },
  ]);
});

test('消息按到达顺序交付；对局订阅前到达的消息先存着、订阅时按顺序补发', async () => {
  const { c, s } = await connected();
  c.create('3-1', 'm1', 'a');
  const ms = [mem(0, '小红', 4), mem(1, '小明', 3)];
  s.recv({ t: 'room', room: roomOf(ms), selfSeat: 0 });
  s.recv(startMsg(ms));
  const link = c.link!;
  assert.equal(link.isHost, true);
  s.recv({ t: 'msg', from: 1, d: 1 });
  s.recv({ t: 'msg', from: 1, d: 2 });
  const got: [number, unknown][] = [];
  const off = link.onMessage((f, d) => got.push([f, d]));
  s.recv({ t: 'msg', from: 1, d: 3 });
  for (let i = 4; i <= 50; i++) s.recv({ t: 'msg', from: 1, d: i });
  assert.deepEqual(
    got.map((x) => x[1]),
    Array.from({ length: 50 }, (_, i) => i + 1),
  );
  assert.ok(got.every((x) => x[0] === 1));
  off();
  s.recv({ t: 'msg', from: 1, d: 'after' });
  assert.equal(got.length, 50);
});

test('有人离开：onMemberLeft + members() 变少；新的 room 推送同步成员', async () => {
  const { c, s } = await connected();
  c.create('3-1', 'm1', 'a');
  const ms = [mem(0, '小红', 4), mem(1, '小明', 3), mem(2, '小刚', 6)];
  s.recv({ t: 'room', room: roomOf(ms), selfSeat: 0 });
  s.recv(startMsg(ms));
  const link = c.link!;
  const left: number[] = [];
  link.onMemberLeft((seat) => left.push(seat));
  s.recv({ t: 'left', seat: 2 });
  assert.deepEqual(left, [2]);
  assert.deepEqual(link.members().map((m) => m.seat), [0, 1]);
  s.recv({ t: 'room', room: roomOf([mem(0, '小红', 4), mem(1, '小明', 3, 'blaze')], 'playing') });
  assert.equal(link.members()[1].agentId, 'blaze');
});

test('房主离开：link.onClosed 收到原因，之后不再收发；客户端回到"不在房间"', async () => {
  const { c, s } = await connected();
  c.join('4821', 'a');
  const ms = [mem(0, '小明', 3), mem(1, '小红', 4)];
  s.recv({ t: 'room', room: roomOf(ms), selfSeat: 1 });
  s.recv(startMsg(ms));
  const link = c.link!;
  const reasons: string[] = [];
  const roomClosed: string[] = [];
  link.onClosed((r) => reasons.push(r));
  c.on('roomClosed', (r) => roomClosed.push(r));
  s.recv({ t: 'closed', reason: '房主离开了房间' });
  assert.deepEqual(reasons, ['房主离开了房间']);
  assert.deepEqual(roomClosed, ['房主离开了房间']);
  assert.equal(c.room, null);
  assert.equal(c.link, null);
  const n = s.sent.length;
  link.send('x');
  assert.equal(s.sent.length, n);
  // 关闭后才订阅的也能收到（异步一次）
  const late: string[] = [];
  link.onClosed((r) => late.push(r));
  await flushMicro();
  assert.deepEqual(late, ['房主离开了房间']);
});

test('对局中掉线：link.onClosed 收到友好原因；客户端 disconnected', async () => {
  const { c, s } = await connected();
  c.create('3-1', 'm1', 'a');
  const ms = [mem(0, '小红', 4)];
  s.recv({ t: 'room', room: roomOf(ms), selfSeat: 0 });
  s.recv(startMsg(ms));
  const reasons: string[] = [];
  const disc: string[] = [];
  c.link!.onClosed((r) => reasons.push(r));
  c.on('disconnected', (r) => disc.push(r));
  s.drop(1006);
  assert.deepEqual(reasons, ['和家里的服务器断开连接了']);
  assert.deepEqual(disc, ['和家里的服务器断开连接了']);
  assert.equal(c.ready, false);
});

test('link.leave()：发 leave，客户端离开房间，之后的消息不再交付', async () => {
  const { c, s } = await connected();
  c.join('4821', 'a');
  const ms = [mem(0, '小明', 3), mem(1, '小红', 4)];
  s.recv({ t: 'room', room: roomOf(ms), selfSeat: 1 });
  s.recv(startMsg(ms));
  const link = c.link!;
  const got: unknown[] = [];
  const closed: string[] = [];
  link.onMessage((_f, d) => got.push(d));
  link.onClosed((r) => closed.push(r));
  link.leave();
  assert.equal(s.sent.at(-1)?.t, 'leave');
  assert.equal(c.room, null);
  s.recv({ t: 'msg', from: 0, d: 'late' });
  // 离开后服务器可能还推一次旧房间：忽略
  s.recv({ t: 'room', room: roomOf(ms) });
  assert.equal(c.room, null);
  assert.deepEqual(got, []);
  assert.deepEqual(closed, [], '自己离开不算房间关闭');
  link.leave();
  assert.equal(s.types().filter((t) => t === 'leave').length, 1);
});

test('再开一局：旧 link 作废，新 link 接手消息', async () => {
  const { c, s } = await connected();
  c.create('3-1', 'm1', 'a');
  const ms = [mem(0, '小红', 4), mem(1, '小明', 3)];
  s.recv({ t: 'room', room: roomOf(ms), selfSeat: 0 });
  s.recv(startMsg(ms));
  const a = c.link!;
  const ga: unknown[] = [];
  a.onMessage((_f, d) => ga.push(d));
  c.end();
  s.recv({ t: 'room', room: roomOf(ms) });
  assert.equal(c.room?.state, 'lobby');
  s.recv(startMsg(ms));
  const b = c.link!;
  assert.notEqual(a, b);
  const gb: unknown[] = [];
  b.onMessage((_f, d) => gb.push(d));
  s.recv({ t: 'msg', from: 1, d: 'x' });
  assert.deepEqual(ga, []);
  assert.deepEqual(gb, ['x']);
});

test('close()：在房间里先发 leave，再关套接字；不发 disconnected', async () => {
  const { c, s } = await connected();
  c.create('3-1', 'm1', 'a');
  s.recv({ t: 'room', room: roomOf([mem(0, '小红', 4)]), selfSeat: 0 });
  const disc: string[] = [];
  c.on('disconnected', (r) => disc.push(r));
  c.close();
  assert.equal(s.sent.at(-1)?.t, 'leave');
  assert.equal(s.closedWith, 1000);
  assert.deepEqual(disc, []);
  assert.equal(c.ready, false);
});

test('对战：建房带 mode、换队（自己 / 房主换别人）按协议发送；room / start 原样带 mode 和 team', async () => {
  const { c, s } = await connected();
  c.create('3-1', 'm1', 'a', 'versus');
  const ms = [mem(0, '小红', 4, 'a', true, 0), mem(1, '小明', 3, 'b', false, 1)];
  s.recv({ t: 'room', room: roomOf(ms, 'lobby', 'versus'), selfSeat: 0 });
  assert.equal(c.room?.mode, 'versus');
  assert.deepEqual(c.room?.members.map((m) => m.team), [0, 1]);
  c.setTeam(1);
  c.setTeam(0, 1);
  assert.deepEqual(s.sent.slice(1), [
    { t: 'create', levelId: '3-1', mapId: 'm1', agentId: 'a', mode: 'versus' },
    { t: 'team', team: 1 },
    { t: 'team', team: 0, seat: 1 },
  ]);
  const got: CoopStart[] = [];
  c.on('start', (v) => got.push(v.start));
  s.recv({ t: 'start', start: { mode: 'versus', seed: 1, levelId: '3-1', mapId: 'm1', opts: {}, members: ms } });
  assert.equal(got[0].mode, 'versus');
  assert.deepEqual(got[0].members.map((m) => m.team), [0, 1]);
  const errs: string[] = [];
  c.on('error', (e) => errs.push(e.code));
  s.recv({ t: 'error', code: 'teams', message: '红队还没有人' });
  assert.deepEqual(errs, ['teams']);
});

test('老服务器不发 mode / team：rooms / room / start 补成合作模式、team 0；合作房间里的 team 一律当 0', async () => {
  const { c, s } = await connected();
  const old = (m: CoopMember) => {
    const { team: _t, ...rest } = m;
    return rest;
  };
  const oldRoom = { id: '1', state: 'lobby', levelId: '3-1', mapId: 'm1', members: [old(mem(0, '小明', 3))] };
  s.recv({ t: 'rooms', rooms: [oldRoom, null] });
  assert.equal(c.rooms.length, 1);
  assert.equal(c.rooms[0].mode, 'coop');
  assert.equal(c.rooms[0].members[0].team, 0);
  c.join('1', 'a');
  s.recv({ t: 'room', room: { ...oldRoom, members: [old(mem(0, '小明', 3)), { ...old(mem(1, '小红', 4)), team: 1 }] }, selfSeat: 1 });
  assert.equal(c.room?.mode, 'coop');
  assert.deepEqual(c.room?.members.map((m) => m.team), [0, 0]);
  const got: CoopStart[] = [];
  c.on('start', (v) => got.push(v.start));
  s.recv({ t: 'start', start: { seed: 3, levelId: '3-1', mapId: 'm1', members: [old(mem(0, '小明', 3)), old(mem(1, '小红', 4))] } });
  assert.equal(got[0].mode, 'coop');
  assert.deepEqual(got[0].opts, {});
  assert.deepEqual(got[0].members.map((m) => m.team), [0, 0]);
});
