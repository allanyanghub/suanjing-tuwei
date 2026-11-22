/// <reference types="node" />
/** 存档对账决策、三方合并、档案切换（兄妹共用一台设备）、离线后同步、不重叠推送。服务器合并用真实的 server/src/save.ts。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSaves, sanitize } from '../../server/src/save.ts';
import { ApiError, type Api, type SaveBlob, type SaveResponse } from '../../src/net/api.ts';
import { Session } from '../../src/net/session.ts';
import { SaveSync, emptyBlob, hasProgress, mergeIntervening, reconcile, unionBlobs, type LiveSave, type ProfileCache } from '../../src/net/sync.ts';
import { memoryKV, type KV } from '../../src/net/util.ts';
import { FakeClock, deferred, flushMicro } from './helpers.ts';

const blob = (o: Partial<SaveBlob> = {}): SaveBlob => ({ ...emptyBlob(), ...o, stats: { ...emptyBlob().stats, ...(o.stats ?? {}) } });
const W = (text: string, time: number) => ({ q: { text, topicId: 'g3-hecha', grade: 3, difficulty: 1, options: ['a', 'b', 'c', 'd'], answer: 0, explain: '' }, picked: 1, time, levelId: '3-1' });

// ---------------------------------------------------------------- 纯函数

test('reconcile：各种情况的决定', () => {
  const local = (o: Partial<ProfileCache>): ProfileCache => ({ data: blob({ stars: { '3-1': 1 } }), baseVersion: 3, dirty: false, ...o });
  assert.deepEqual(reconcile(null, 5, null), { kind: 'adopt' }, '本设备第一次：用服务器的');
  assert.deepEqual(reconcile(local({}), 5, null), { kind: 'adopt' }, '本地没改过、服务器更新：用服务器的');
  assert.deepEqual(reconcile(local({ baseVersion: 5 }), 5, null), { kind: 'adopt' });
  const ff = reconcile(local({ baseVersion: 5, dirty: true }), 5, null);
  assert.equal(ff.kind, 'push');
  assert.equal(ff.kind === 'push' && ff.baseVersion, 5, '同版本 → 快进');
  const st = reconcile(local({ baseVersion: 3, dirty: true }), 5, null);
  assert.equal(st.kind === 'push' && st.baseVersion, 3, '旧版本 → 服务器取并集');
  const behind = reconcile(local({ baseVersion: 9 }), 2, null);
  assert.equal(behind.kind === 'push' && behind.baseVersion, -1, '服务器比本地旧（恢复过备份）→ 取并集，不丢本地进度');
  const g = reconcile(null, 4, blob({ stars: { '3-2': 2 } }));
  assert.ok(g.kind === 'push' && g.baseVersion === -1 && g.data.stars['3-2'] === 2, '合并游客进度用过期版本');
});

test('unionBlobs：星级/统计取大，错题按 (时间,题干) 去重', () => {
  const a = blob({ stars: { '3-1': 1, '3-2': 3 }, stats: { answered: 10, correct: 5, kills: 1, wins: 0 }, wrong: [W('x', 1), W('y', 3)], mapChoice: { '3-1': 'g3-1' } });
  const b = blob({ stars: { '3-1': 2 }, stats: { answered: 4, correct: 4, kills: 9, wins: 2 }, wrong: [W('x', 1), W('z', 2)], mapChoice: { '3-1': 'g3-2', '3-3': 'g3-1' } });
  const u = unionBlobs(a, b);
  assert.deepEqual(u.stars, { '3-1': 2, '3-2': 3 });
  assert.deepEqual(u.stats, { answered: 10, correct: 5, kills: 9, wins: 2 });
  assert.deepEqual(u.wrong.map((w) => w.q.text), ['y', 'z', 'x']);
  assert.deepEqual(u.mapChoice, { '3-1': 'g3-1', '3-3': 'g3-1' });
});

test('mergeIntervening：只引入服务器新增的，本地刚订正掉的错题不复活', () => {
  const sent = blob({ wrong: [W('old', 1), W('fixed', 2)], stars: { '3-1': 1 } });
  const server = blob({ wrong: [W('other-device', 5), W('old', 1), W('fixed', 2)], stars: { '3-1': 1, '4-1': 2 }, stats: { answered: 50, correct: 40, kills: 0, wins: 1 } });
  const local = blob({ wrong: [W('new-local', 6), W('old', 1)], stars: { '3-1': 2 }, stats: { answered: 30, correct: 20, kills: 3, wins: 1 } });
  const m = mergeIntervening(sent, server, local);
  assert.deepEqual(m.wrong.map((w) => w.q.text), ['new-local', 'other-device', 'old']);
  assert.deepEqual(m.stars, { '3-1': 2, '4-1': 2 });
  assert.equal(m.stats.answered, 50);
  assert.equal(m.stats.kills, 3);
});

test('hasProgress', () => {
  assert.equal(hasProgress(emptyBlob()), false);
  assert.equal(hasProgress(blob({ stats: { answered: 1, correct: 0, kills: 0, wins: 0 } })), true);
});

// ---------------------------------------------------------------- 同步器（假服务器用真实合并规则）

class FakeServer {
  saves = new Map<string, { data: SaveBlob; version: number }>();
  down = false;
  puts: { player: string; baseVersion: number }[] = [];
  gate: Promise<void> | null = null;
  get(p: string) {
    return this.saves.get(p) ?? { data: sanitize({}) as SaveBlob, version: 0 };
  }
  api(player: () => string): Api {
    const self = this;
    return {
      async getSave(): Promise<SaveResponse> {
        if (self.down) throw new ApiError(0, '连不上服务器', 'network');
        const s = self.get(player());
        return { data: JSON.parse(JSON.stringify(s.data)), version: s.version, updatedAt: 1 };
      },
      async putSave(baseVersion: number, data: SaveBlob): Promise<SaveResponse> {
        if (self.down) throw new ApiError(0, '连不上服务器', 'network');
        if (self.gate) await self.gate;
        self.puts.push({ player: player(), baseVersion });
        const cur = self.get(player());
        const merged = mergeSaves(cur.data as never, sanitize(JSON.parse(JSON.stringify(data))), baseVersion === cur.version) as unknown as SaveBlob;
        const next = { data: merged, version: cur.version + 1 };
        self.saves.set(player(), next);
        return { data: JSON.parse(JSON.stringify(merged)), version: next.version, updatedAt: 2 };
      },
    } as unknown as Api;
  }
}

/** 一台"设备"：自己的 localStorage、游戏存档对象（含本机 settings）、会话 */
function device(server: FakeServer, kv: KV = memoryKV()) {
  // 游戏存档对象：和真实游戏一样从本机存储读出、写入后持久化（"刷新页面"后还在）
  const game = { ...emptyBlob(), settings: { volume: 0.3 }, ...JSON.parse(kv.get('game-save') ?? '{}') } as SaveBlob & { settings: { volume: number } };
  const live: LiveSave = {
    read: () => JSON.parse(JSON.stringify({ stars: game.stars, wrong: game.wrong, agent: game.agent, mapChoice: game.mapChoice, stats: game.stats })),
    write: (d) => {
      Object.assign(game, JSON.parse(JSON.stringify(d)));
      kv.set('game-save', JSON.stringify(game));
    },
  };
  const clock = new FakeClock();
  const sessionApi = { login: async () => ({}) } as unknown as Api;
  const session = new Session(sessionApi, kv);
  const api = server.api(() => session.player!.name);
  const sync = new SaveSync({ api, kv, live, session, timers: clock, debounceMs: 1000 });
  const signIn = (name: string) => {
    session.adopt('tok-' + name, { name, grade: 3 });
    sync.activate(name);
  };
  return { game, live, session, sync, clock, kv, signIn };
}

test('兄妹共用一台设备：登录 / 退出 / 切换，存档互不混；本机 settings 不动', async () => {
  const srv = new FakeServer();
  const d = device(srv);
  d.signIn('哥哥');
  await d.sync.start();
  d.game.stars['3-1'] = 3;
  d.game.stats.answered = 12;
  await d.sync.push();
  d.sync.stop();
  d.signIn('妹妹');
  assert.deepEqual(d.game.stars, {}, '切到妹妹后看不到哥哥的星星');
  await d.sync.start();
  d.game.stars['4-1'] = 1;
  await d.sync.push();
  d.signIn('哥哥');
  assert.deepEqual(d.game.stars, { '3-1': 3 });
  await d.sync.start();
  assert.deepEqual(d.game.stars, { '3-1': 3 });
  assert.deepEqual(srv.get('妹妹').data.stars, { '4-1': 1 });
  assert.deepEqual(srv.get('哥哥').data.stars, { '3-1': 3 });
  assert.equal(d.game.settings.volume, 0.3);
  d.sync.activate(null);
  assert.deepEqual(d.game.stars, {}, '游客档案是空的');
});

test('第一次登录且本机有单机进度：提供合并；同意后服务器取并集', async () => {
  const srv = new FakeServer();
  srv.saves.set('小明', { data: blob({ stars: { '5-1': 2 } }), version: 4 });
  const d = device(srv);
  d.game.stars['3-1'] = 2; // 原来单机玩的
  d.game.stats.answered = 7;
  assert.equal(d.sync.activeKey, 'guest');
  const fresh = !d.sync.hasProfile('小明');
  d.signIn('小明');
  assert.ok(fresh);
  const offer = d.sync.guestOfferFor('小明');
  assert.deepEqual(offer, { levels: 1, stars: 2, answered: 7, wrong: 0 });
  await d.sync.start(true);
  assert.deepEqual(d.game.stars, { '3-1': 2, '5-1': 2 });
  assert.equal(srv.puts.at(-1)!.baseVersion, -1);
  assert.equal(d.sync.guestOfferFor('小红'), null, '合并过一次就不再问别人');
  d.sync.activate(null);
  assert.deepEqual(d.game.stars, { '3-1': 2 }, '游客档案本身还在（没被删）');
});

test('拒绝合并：游客进度原样保留，服务器不受影响，不再问这个孩子', async () => {
  const srv = new FakeServer();
  const d = device(srv);
  d.game.stars['3-1'] = 1;
  d.signIn('小明');
  d.sync.declineGuest('小明');
  await d.sync.start(false);
  assert.deepEqual(d.game.stars, {});
  assert.equal(d.sync.guestOfferFor('小明'), null);
  assert.ok(d.sync.guestOfferFor('小红'), '别的孩子仍可选择合并');
  d.sync.activate(null);
  assert.deepEqual(d.game.stars, { '3-1': 1 });
});

test('离线时的进度：保持待上传，恢复联网后推送', async () => {
  const srv = new FakeServer();
  const d = device(srv);
  d.signIn('小明');
  await d.sync.start();
  srv.down = true;
  d.game.stars['3-1'] = 1;
  d.sync.markDirty();
  await d.clock.advance(1000);
  assert.equal(d.sync.status, 'pending');
  assert.equal(d.sync.dirty, true);
  assert.equal(d.session.state, 'offline', '连不上 → 会话转为离线');
  srv.down = false;
  d.session.adopt('tok-小明', { name: '小明', grade: 3 }); // 门面的探测发现重新联网
  await d.sync.start();
  assert.equal(d.sync.status, 'synced');
  assert.deepEqual(srv.get('小明').data.stars, { '3-1': 1 });
});

test('页面重开（本地档案已有改动，服务器在别的设备上前进了）→ 用旧版本推送取并集', async () => {
  const srv = new FakeServer();
  const kv = memoryKV();
  const a = device(srv, kv);
  a.signIn('小明');
  await a.sync.start();
  a.game.stars['3-1'] = 1;
  a.live.write(a.live.read()); // 游戏 persist()
  a.sync.capture(); // 离线改动，没推送
  // 另一台设备推进了服务器
  const b = device(srv);
  b.signIn('小明');
  await b.sync.start();
  b.game.stars['4-1'] = 3;
  await b.sync.push();
  // 第一台设备"刷新页面"：同一个 localStorage
  const a2 = device(srv, kv);
  a2.session.adopt('tok', { name: '小明', grade: 3 });
  a2.sync.activate('小明');
  assert.deepEqual(a2.game.stars, { '3-1': 1 }, '游戏读到的是本机存档');
  await a2.sync.start();
  assert.deepEqual(a2.game.stars, { '3-1': 1, '4-1': 3 });
});

test('两台设备各自进度 → 两边最后都是并集', async () => {
  const srv = new FakeServer();
  const a = device(srv);
  const b = device(srv);
  a.signIn('小明');
  b.signIn('小明');
  await a.sync.start();
  await b.sync.start();
  a.game.stars['3-1'] = 2;
  a.game.wrong.push(W('a题', 10));
  b.game.stars['3-2'] = 1;
  b.game.wrong.push(W('b题', 20));
  await a.sync.push();
  await b.sync.push();
  await a.sync.start(); // a 再次对账（例如回到标题页 / 重新联网）
  assert.deepEqual(a.game.stars, { '3-1': 2, '3-2': 1 });
  assert.deepEqual(b.game.stars, { '3-1': 2, '3-2': 1 });
  assert.deepEqual(a.game.wrong.map((w) => w.q.text).sort(), ['a题', 'b题']);
});

test('推送不重叠；请求途中的改动不丢，随后再推一次（快进）', async () => {
  const srv = new FakeServer();
  const d = device(srv);
  d.signIn('小明');
  await d.sync.start();
  const g = deferred<void>();
  srv.gate = g.promise;
  d.game.stars['3-1'] = 1;
  const p1 = d.sync.push();
  const p2 = d.sync.push();
  await flushMicro();
  d.game.stars['3-2'] = 2; // 请求在路上时又通关了一关
  d.sync.capture();
  srv.gate = null;
  g.resolve();
  await Promise.all([p1, p2]);
  assert.equal(srv.puts.length, 2);
  assert.equal(srv.puts[1].baseVersion, srv.puts[0].baseVersion + 1, '第二次推送是快进');
  assert.deepEqual(srv.get('小明').data.stars, { '3-1': 1, '3-2': 2 });
  assert.deepEqual(d.game.stars, { '3-1': 1, '3-2': 2 });
  assert.equal(d.sync.dirty, false);
});

test('5xx：保持待上传，退避后自动重试', async () => {
  const srv = new FakeServer();
  const d = device(srv);
  d.signIn('小明');
  await d.sync.start();
  const api = (d.sync as unknown as { api: Api }).api;
  const put = api.putSave.bind(api);
  let fails = 1;
  api.putSave = async (b, data) => {
    if (fails-- > 0) throw new ApiError(500, '服务器出错了', 'http');
    return put(b, data);
  };
  d.game.stars['3-1'] = 1;
  await d.sync.push();
  assert.equal(d.sync.status, 'pending');
  await d.clock.advance(5000);
  assert.equal(d.sync.status, 'synced');
  assert.deepEqual(srv.get('小明').data.stars, { '3-1': 1 });
});

test('游戏存档键被单独清空：以档案为准恢复，不把空存档推上去', () => {
  const srv = new FakeServer();
  const kv = memoryKV();
  const a = device(srv, kv);
  a.signIn('小明');
  a.game.stars['3-1'] = 2;
  a.live.write(a.live.read());
  a.sync.capture();
  kv.del('game-save');
  const a2 = device(srv, kv);
  assert.deepEqual(a2.game.stars, { '3-1': 2 });
});

test('没登录 / 游客：markDirty 与 push 不发请求', async () => {
  const srv = new FakeServer();
  const d = device(srv);
  d.game.stars['3-1'] = 1;
  d.sync.markDirty();
  await d.sync.push();
  await d.clock.advance(10_000);
  assert.equal(srv.puts.length, 0);
});

test('段位：掉星后的存档不会被旧存档的高星数盖回去；老存档按进度补段位', () => {
  const old = blob({ rank: { pts: 20, best: 20, n: 5 } });
  const lost = blob({ rank: { pts: 19, best: 20, n: 6 } });
  assert.deepEqual(unionBlobs(old, lost).rank, { pts: 19, best: 20, n: 6 });
  assert.deepEqual(mergeIntervening(old, old, lost).rank, { pts: 19, best: 20, n: 6 });
  assert.deepEqual(mergeIntervening(old, lost, old).rank, { pts: 19, best: 20, n: 6 }, '服务器上有别的设备多打的一局');
  // 服务器合并（真实的 server/src/save.ts）规则一致
  assert.deepEqual(mergeSaves(sanitize(lost), sanitize(old), true).rank, { pts: 19, best: 20, n: 6 });
  const legacy = { ...blob({ stars: { '3-1': 3 }, stats: { answered: 9, correct: 8, kills: 0, wins: 2 } }) } as SaveBlob;
  delete legacy.rank;
  assert.deepEqual(unionBlobs(legacy, blob()).rank, { pts: 3, best: 3, n: 0 });
  assert.equal(hasProgress(blob({ rank: { pts: 0, best: 0, n: 1 } })), true);
});
