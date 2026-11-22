/// <reference types="node" />
/** 接口错误映射、接口地址、目录、任务庆祝恰好一次、留言看过后不再显示、家长题本地递减 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api, ApiError, errorText, isOffline, resolveApiBase, type Task } from '../../src/net/api.ts';
import { buildCatalog } from '../../src/net/catalog.ts';
import { TaskStore } from '../../src/net/tasks.ts';
import { MessageStore } from '../../src/net/messages.ts';
import { CustomStore } from '../../src/net/custom.ts';
import { memoryKV } from '../../src/net/util.ts';
import { ALL_TOPICS } from '../../src/math/index.ts';
import { LEVELS } from '../../src/data/defs.ts';

const fakeFetch = (fn: (url: string, init: RequestInit) => Response | Promise<Response>) => (async (url: string, init: RequestInit) => fn(url, init)) as unknown as typeof fetch;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('Api：服务器的中文错误 → ApiError(status, message)', async () => {
  const api = new Api({ base: 'http://x', token: () => 't', fetch: fakeFetch(() => json(429, { error: '密码错得太多了，请 30 秒后再试' })) });
  await assert.rejects(api.login('a', 'b'), (e: unknown) => e instanceof ApiError && e.status === 429 && e.kind === 'http' && e.message === '密码错得太多了，请 30 秒后再试');
});

test('Api：静态主机的 404 网页 / 200 网页都算"没有服务器"', async () => {
  const html = new Api({ base: '', token: () => null, fetch: fakeFetch(() => new Response('<html>404</html>', { status: 404 })) });
  await assert.rejects(html.health(), (e: unknown) => e instanceof ApiError && e.kind === 'bad-response' && e.status === 0 && isOffline(e));
  const spa = new Api({ base: '', token: () => null, fetch: fakeFetch(() => new Response('<!doctype html>', { status: 200 })) });
  await assert.rejects(spa.health(), (e: unknown) => isOffline(e));
});

test('Api：网络错误与超时区分开；带令牌和 JSON 请求头', async () => {
  const down = new Api({ base: '', token: () => null, fetch: fakeFetch(() => Promise.reject(new TypeError('Failed to fetch'))) });
  await assert.rejects(down.players(), (e: unknown) => e instanceof ApiError && e.kind === 'network');
  const slow = new Api({
    base: '', token: () => null, timeoutMs: 30,
    fetch: fakeFetch((_u, init) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))),
  });
  await assert.rejects(slow.players(), (e: unknown) => e instanceof ApiError && e.kind === 'timeout');
  assert.equal(errorText(new ApiError(0, 'x', 'timeout')), '服务器没有响应，请稍后再试');
  let seen: RequestInit | null = null;
  let seenUrl = '';
  const ok = new Api({ base: 'http://h:1', token: () => 'abc', fetch: fakeFetch((u, init) => ((seen = init), (seenUrl = u), json(200, { accepted: 0, duplicates: 0, rejected: [], tasksCompleted: 0 }))) });
  await ok.postAnswers([]);
  assert.equal(seenUrl, 'http://h:1/api/answers');
  const hd = (seen as unknown as RequestInit).headers as Record<string, string>;
  assert.equal(hd.Authorization, 'Bearer abc');
  assert.equal(hd['Content-Type'], 'application/json');
});

test('resolveApiBase：?api= > localStorage > 同源', () => {
  const kv = memoryKV({ 'suanjing-api-base': 'http://nas.local:8080/' });
  assert.equal(resolveApiBase('?api=http://127.0.0.1:9000', kv), 'http://127.0.0.1:9000');
  assert.equal(resolveApiBase('', kv), 'http://nas.local:8080');
  assert.equal(resolveApiBase('?api=javascript:alert(1)', memoryKV()), '');
  assert.equal(resolveApiBase('', null), '');
});

test('buildCatalog：由 ALL_TOPICS / LEVELS 生成且符合服务器限制', () => {
  const c = buildCatalog(ALL_TOPICS, LEVELS);
  assert.equal(c.topics.length, ALL_TOPICS.length);
  assert.equal(c.levels.length, LEVELS.length);
  for (const t of c.topics) assert.ok(/^[A-Za-z0-9_-]{1,40}$/.test(t.id) && [3, 4, 5, 6].includes(t.grade) && t.name.length >= 1);
  for (const l of c.levels) assert.ok(l.id.length <= 16 && l.topicIds.length <= 60 && typeof l.boss === 'boolean');
  assert.ok(c.levels.some((l) => l.boss));
  assert.ok(JSON.stringify(c).length < 256_000);
  const bad = buildCatalog([{ id: 'a b', grade: 3, name: 'x' }, { id: 'ok', grade: 7, name: 'x' }, { id: 'ok2', grade: 3, name: '' }], []);
  assert.deepEqual(bad.topics, [{ id: 'ok2', grade: 3, name: '未命名' }]);
});

const task = (id: number, o: Partial<Task> = {}): Task => ({
  id, kind: 'correct_total', title: `任务${id}`, description: '', note: '', reward: '', dueAt: null, dueDate: null, bonusCredits: 0, params: {},
  createdAt: 0, status: 'done', progress: { current: 1, target: 1, unit: 'correct' }, completedAt: 1, rewardGranted: false, forAll: false, justCompleted: true, ...o,
});

test('任务庆祝恰好一次：ack 失败也不重复庆祝，下次拉取时补发 ack', async () => {
  const kv = memoryKV();
  let serverJust = true;
  let ackFail = true;
  const acks: number[] = [];
  const api = {
    tasks: async () => ({ tasks: [task(7, { justCompleted: serverJust }), task(8, { status: 'active', justCompleted: false })] }),
    ackTask: async (id: number) => {
      if (ackFail) throw new ApiError(0, '连不上服务器', 'network');
      acks.push(id);
      serverJust = false;
      return { ok: true, acked: true };
    },
  } as unknown as Api;
  const s = new TaskStore(api, kv);
  s.setProfile('p:小明');
  await s.refresh();
  assert.deepEqual(s.pendingCelebrations().map((t) => t.id), [7]);
  await s.markCelebrated(7);
  assert.deepEqual(acks, []);
  await s.refresh();
  assert.deepEqual(s.pendingCelebrations(), [], '服务器仍是 justCompleted，但本机已经庆祝过');
  ackFail = false;
  await s.refresh();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(acks, [7], '补发了 ack');
  s.setProfile('p:小红');
  assert.deepEqual(s.pendingCelebrations(), [], '小红看不到小明的任务');
});

test('留言：看过后不再显示（按玩家），并告诉服务器；离线时下次刷新补发', async () => {
  const kv = memoryKV();
  let msgs = [{ id: 2, text: 'b', forAll: true, createdAt: 2, expiresAt: null }];
  const reads: number[][] = [];
  let offline = false;
  const api = {
    messages: async () => ({ messages: msgs }),
    markMessagesRead: async (ids: number[]) => {
      if (offline) throw new Error('offline');
      reads.push(ids);
      // 服务器：标为已读后不再返回
      msgs = msgs.filter((m) => !ids.includes(m.id));
      return { ok: true, marked: ids.length };
    },
  } as unknown as Api;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const m = new MessageStore(api, kv);
  m.setProfile('p:a');
  await m.refresh();
  assert.deepEqual(m.list.map((x) => x.id), [2]);
  m.markSeen([2]);
  assert.deepEqual(m.list, [], '本地立即隐藏');
  assert.equal(m.latest(), null);
  await tick();
  assert.deepEqual(reads, [[2]], '告诉了服务器');

  // 离线时看过：本地隐藏；联网后刷新发现服务器还返回它 → 补发
  msgs = [{ id: 3, text: '新的\n第二行', forAll: false, createdAt: 3, expiresAt: null }, ...msgs];
  await m.refresh();
  assert.equal(m.latest()!.text, '新的\n第二行');
  offline = true;
  m.markSeen([3]);
  await tick();
  assert.deepEqual(m.list, []);
  assert.equal(reads.length, 1);
  offline = false;
  await m.refresh();
  await tick();
  assert.deepEqual(reads, [[2], [3]], '补发了已读');
  assert.deepEqual(m.list, []);

  // 另一个孩子：服务器按人记录已读，这里用新的留言列表模拟
  msgs = [{ id: 4, text: 'c', forAll: true, createdAt: 4, expiresAt: null }];
  m.setProfile('p:b');
  await m.refresh();
  assert.deepEqual(m.unseen().map((x) => x.id), [4]);
});

test('家长题：离线答对后本地递减，队列发完后以服务器为准', async () => {
  const kv = memoryKV();
  let remaining = 2;
  const api = { customQuestions: async () => ({ questions: [{ id: 1, topicId: 'custom', grade: 3, difficulty: 1, text: 't', options: ['1', '2', '3', '4'], answer: 0, explain: '', topicLabel: '', remainingCorrect: remaining }] }) } as unknown as Api;
  const c = new CustomStore(api, kv);
  let queueEmpty = false;
  c.queueEmpty = () => queueEmpty;
  c.setProfile('p:a');
  await c.refresh();
  c.answered(1, false);
  assert.equal(c.pending()[0].remainingCorrect, 2, '答错不扣');
  c.answered(1, true);
  assert.equal(c.pending()[0].remainingCorrect, 1);
  await c.refresh(); // 队列还没发：服务器仍是 2，本地扣减保留
  assert.equal(c.pending()[0].remainingCorrect, 1);
  c.answered(1, true);
  assert.equal(c.pending().length, 0, '本地看来已经毕业');
  queueEmpty = true;
  remaining = 0;
  await c.refresh();
  assert.equal(c.pending().length, 0);
});
