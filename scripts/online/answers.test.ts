/// <reference types="node" />
/** 答题队列：分批、200 后删除、4xx 删除、401 保留、5xx/网络保留并重试、上限、发送中追加不丢 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnswerQueue, MAX_BATCH, MAX_QUEUE, toRecord, type SendFn } from '../../src/net/answers.ts';
import { ApiError, type AnswerRecord, type AnswersResponse } from '../../src/net/api.ts';
import { memoryKV } from '../../src/net/util.ts';
import { FakeClock, deferred } from './helpers.ts';

const ok = (n: number): AnswersResponse => ({ accepted: n, duplicates: 0, rejected: [], tasksCompleted: 0 });

function setup(send: SendFn, extra: Partial<ConstructorParameters<typeof AnswerQueue>[0]> = {}) {
  const kv = memoryKV();
  const clock = new FakeClock();
  const q = new AnswerQueue({ kv, send, now: clock.now, timers: clock, random: () => 0.5, ...extra });
  q.setProfile('p:小明');
  return { kv, clock, q };
}
const one = (i = 0) => ({ context: 'gate' as const, correct: i % 2 === 0, topicId: 'g3-hecha', grade: 3, difficulty: 2, ms: 1234.4, levelId: '3-1' });

test('toRecord：普通题与家长题的形状', () => {
  assert.deepEqual(toRecord('d-1', { ...one(), at: 5.7 }, 9), { id: 'd-1', correct: true, context: 'gate', at: 5, topicId: 'g3-hecha', grade: 3, difficulty: 2, ms: 1234, levelId: '3-1' });
  const c = toRecord('d-2', { context: 'gate', correct: false, topicId: 'custom', grade: 3, customId: 12, levelId: '3-1' }, 100);
  assert.deepEqual(c, { id: 'd-2', correct: false, context: 'custom', at: 100, customId: 12, levelId: '3-1' });
});

test('id 唯一且符合服务器格式，时间是答题当时', () => {
  const { q, clock } = setup(async () => ok(0));
  const a = q.log(one())!;
  clock.t += 5000;
  const b = q.log(one())!;
  assert.notEqual(a.id, b.id);
  for (const r of [a, b]) assert.match(r.id, /^[A-Za-z0-9_.:-]{1,64}$/);
  assert.equal(b.at - a.at, 5000);
});

test('游客（没有玩家）不记录', () => {
  const { q } = setup(async () => ok(0));
  q.setProfile(null);
  assert.equal(q.log(one()), null);
  assert.equal(q.size, 0);
});

test('按玩家分开保存：切换玩家后互不影响', () => {
  const { q } = setup(async () => ok(0));
  q.log(one());
  q.log(one());
  q.setProfile('p:小红');
  q.log(one());
  assert.equal(q.size, 1);
  q.setProfile('p:小明');
  assert.equal(q.size, 2);
});

test('分批 ≤ 200，200 响应后整批删除（含 duplicates / rejected）', async () => {
  const batches: number[] = [];
  const { q } = setup(async (b) => {
    batches.push(b.length);
    return { accepted: b.length - 2, duplicates: 1, rejected: ['x'], tasksCompleted: 0 };
  });
  for (let i = 0; i < 450; i++) q.log(one(i));
  const r = await q.flush();
  assert.deepEqual(batches, [MAX_BATCH, MAX_BATCH, 50]);
  assert.equal(r.sent, 450);
  assert.equal(q.size, 0);
});

test('4xx（401 除外）整批丢掉，继续发后面的', async () => {
  let n = 0;
  const { q } = setup(async (b) => {
    if (n++ === 0) throw new ApiError(400, '需要 answers 数组', 'http');
    return ok(b.length);
  });
  for (let i = 0; i < 250; i++) q.log(one(i));
  const r = await q.flush();
  assert.equal(q.size, 0);
  assert.equal(r.sent, 50);
});

test('401 保留并通知重新登录，不自动重试', async () => {
  let auth = 0;
  const { q, clock } = setup(async () => {
    throw new ApiError(401, '请先登录', 'http');
  }, { onAuthError: () => auth++ });
  q.log(one());
  const r = await q.flush();
  assert.equal(q.size, 1);
  assert.equal(auth, 1);
  assert.ok(r.error);
  assert.equal(clock.pending, 0);
});

test('网络错误 / 5xx 保留，指数退避后自动重试，成功后删除，恰好送达一次', async () => {
  const delivered: string[] = [];
  let fail = 3;
  let offline = 0;
  const { q, clock } = setup(async (b) => {
    if (fail-- > 0) throw fail % 2 ? new ApiError(0, '连不上服务器', 'network') : new ApiError(503, '服务器出错了', 'http');
    delivered.push(...b.map((x) => x.id));
    return ok(b.length);
  }, { onOffline: () => offline++ });
  for (let i = 0; i < 3; i++) q.log(one(i));
  await q.flush();
  assert.equal(q.size, 3);
  assert.equal(q.nextRetryAt - clock.t, 5000);
  await clock.advance(5000);
  assert.equal(q.nextRetryAt - clock.t, 10000, '第二次失败后等 10 秒');
  await clock.advance(10000);
  assert.equal(q.size, 3);
  await clock.advance(20000);
  assert.equal(q.size, 0);
  assert.equal(delivered.length, 3);
  assert.equal(new Set(delivered).size, 3);
  assert.equal(offline, 3);
});

test('发送中追加的记录不会被误删；同时调用 flush 不会重叠发送', async () => {
  const d = deferred<AnswersResponse>();
  let calls = 0;
  let inflight = 0;
  let maxInflight = 0;
  const { q } = setup(async (b) => {
    calls++;
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    const r = calls === 1 ? await d.promise : ok(b.length);
    inflight--;
    return r;
  });
  q.log(one(1));
  q.log(one(2));
  const p1 = q.flush();
  const p2 = q.flush();
  assert.equal(p1, p2);
  q.log(one(3));
  d.resolve(ok(2));
  await p1;
  assert.equal(maxInflight, 1);
  assert.equal(calls, 2, '第一批之后接着发新追加的那条');
  assert.equal(q.size, 0);
});

test('队列上限 5000，超出丢最旧的', () => {
  const { q } = setup(async () => ok(0));
  const first = q.log(one())!;
  for (let i = 0; i < MAX_QUEUE + 9; i++) q.log(one(i));
  const list = q.list();
  assert.equal(list.length, MAX_QUEUE);
  assert.ok(!list.some((r) => r.id === first.id));
});

test('tasksCompleted > 0 时回调（用于立即刷新任务播放庆祝）', async () => {
  let n = 0;
  const { q } = setup(async (b: AnswerRecord[]) => ({ ...ok(b.length), tasksCompleted: 2 }), { onTasksCompleted: (k) => (n += k) });
  q.log(one());
  await q.flush();
  assert.equal(n, 2);
});

test('队列持久化：新建队列对象（模拟刷新页面）后还在', () => {
  const kv = memoryKV();
  const a = new AnswerQueue({ kv, send: async () => ok(0) });
  a.setProfile('p:a');
  a.log(one());
  const b = new AnswerQueue({ kv, send: async () => ok(0) });
  b.setProfile('p:a');
  assert.equal(b.size, 1);
  assert.equal(a.device, b.device, '设备前缀固定');
});
