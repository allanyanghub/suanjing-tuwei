/// <reference types="node" />
/** 设置 → 开局参数映射、门槛题抽题 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customToQuestion, matchOptionsFor, pickGateQuestion, questionRates, type QuestionLike } from '../../src/net/profile.ts';
import type { CustomQuestion, ServerSettings } from '../../src/net/api.ts';
import { seq } from './helpers.ts';

const S: ServerSettings = {
  grade: 3, passAccuracy: 60, botStrength: 1, reviveSeconds: 60, gateRequired: true, gateCount: 1, bonusCount: 2,
  plantQuestions: 1, defuseQuestions: 1, reviewRate: 20, customRate: 100, roundsToWin: null, bossRoundsToWin: null,
};

test('matchOptionsFor：没有设置时全部用游戏默认', () => {
  assert.deepEqual(matchOptionsFor(null, { boss: false }), {});
  assert.deepEqual(matchOptionsFor(null, { boss: true }), {});
});

test('matchOptionsFor：null 回合数省略；passAccuracy 换成 0–1 小数', () => {
  const o = matchOptionsFor(S, { boss: false });
  assert.equal('roundsToWin' in o, false);
  assert.deepEqual(o, { passAccuracy: 0.6, botStrength: 1, reviveSeconds: 60, gateRequired: true, gateCount: 1, bonusCount: 2, plantQuestions: 1, defuseQuestions: 1 });
});

test('matchOptionsFor：boss 关用 bossRoundsToWin，普通关用 roundsToWin', () => {
  const s = { ...S, roundsToWin: 5, bossRoundsToWin: 9 };
  assert.equal(matchOptionsFor(s, { boss: false }).roundsToWin, 5);
  assert.equal(matchOptionsFor(s, { boss: true }).roundsToWin, 9);
  assert.equal('roundsToWin' in matchOptionsFor({ ...S, roundsToWin: 5 }, { boss: true }), false, '只设了普通关时 boss 关仍用默认');
  assert.equal(matchOptionsFor({ ...S, bossRoundsToWin: 7 }, { boss: false }).roundsToWin, undefined);
});

test('matchOptionsFor：数值夹到文档范围内', () => {
  const o = matchOptionsFor({ ...S, passAccuracy: 120, botStrength: 3, reviveSeconds: 5, gateCount: 9, bonusCount: -2, plantQuestions: 0, defuseQuestions: 7, roundsToWin: 99 }, { boss: false });
  assert.equal(o.passAccuracy, 1);
  assert.equal(o.botStrength, 1.5);
  assert.equal(o.reviveSeconds, 20);
  assert.equal(o.gateCount, 5);
  assert.equal(o.bonusCount, 0);
  assert.equal(o.plantQuestions, 1);
  assert.equal(o.defuseQuestions, 3);
  assert.equal(o.roundsToWin, 13);
  assert.equal(matchOptionsFor({ ...S, gateRequired: false }, { boss: false }).gateRequired, false);
});

test('questionRates：默认 20 / 100，并夹取', () => {
  assert.deepEqual(questionRates(null), { reviewRate: 20, customRate: 100 });
  assert.deepEqual(questionRates({ ...S, reviewRate: 80, customRate: -5 }), { reviewRate: 50, customRate: 0 });
});

// ---------------------------------------------------------------- 门槛题

const gen = (text = 'gen'): QuestionLike => ({ topicId: 'g3-hecha', grade: 3, difficulty: 1, text, options: ['1', '2', '3', '4'], answer: 0, explain: '' });
const cq = (id: number, remainingCorrect = 1): CustomQuestion => ({
  id, topicId: 'custom', grade: 4, difficulty: 1, text: `家长题${id}`, options: ['a', 'b', 'c', 'd'], answer: 2, explain: '解析', topicLabel: id === 1 ? '家庭题' : '', remainingCorrect,
});
const wq = (text: string, topicId = 'g3-hecha') => ({ q: { ...gen(text), topicId }, levelId: '3-1' });

test('pickGateQuestion：有家长题且命中 customRate → 家长题，带 customId 和标签', () => {
  const rng = seq(0.5);
  const r = pickGateQuestion({ rng, reviewRate: 20, customRate: 60, custom: [cq(1), cq(2)], wrong: [wq('w1')], generate: () => gen() });
  assert.equal(r.source, 'custom');
  assert.equal(r.customId, 1);
  assert.equal(r.label, '家庭题');
  assert.equal(r.q.topicId, 'custom');
  assert.equal(r.q.answer, 2);
  assert.equal(rng.used, 1);
});

test('pickGateQuestion：家长题没命中 → 错题命中 reviewRate → 错题', () => {
  const rng = seq(0.7, 0.1, 0.0);
  const r = pickGateQuestion({ rng, reviewRate: 20, customRate: 60, custom: [cq(1)], wrong: [wq('w1'), wq('w2')], generate: () => gen() });
  assert.equal(r.source, 'review');
  assert.equal(r.q.text, 'w1');
  assert.equal(r.customId, undefined);
  assert.equal(rng.used, 3);
});

test('pickGateQuestion：都没命中 → 正常出题；列表为空时不消耗随机数', () => {
  const rng = seq(0.99, 0.99);
  assert.equal(pickGateQuestion({ rng, reviewRate: 50, customRate: 100, custom: [cq(1)], wrong: [wq('w')], generate: () => gen('x') }).source, 'custom', 'customRate=100 总是命中');
  const rng2 = seq(0.99);
  const r2 = pickGateQuestion({ rng: rng2, reviewRate: 50, customRate: 100, custom: [], wrong: [wq('w')], generate: () => gen('x') });
  assert.equal(r2.source, 'generated');
  assert.equal(rng2.used, 1);
  const rng3 = seq();
  assert.equal(pickGateQuestion({ rng: rng3, reviewRate: 50, customRate: 100, custom: [], wrong: [], generate: () => gen('x') }).q.text, 'x');
  assert.equal(rng3.used, 0);
});

test('pickGateQuestion：customRate=0 / reviewRate=0 从不命中', () => {
  for (const v of [0, 0.3, 0.999]) {
    const r = pickGateQuestion({ rng: seq(v, v), reviewRate: 0, customRate: 0, custom: [cq(1)], wrong: [wq('w')], generate: () => gen() });
    assert.equal(r.source, 'generated');
  }
});

test('pickGateQuestion：已毕业（remainingCorrect ≤ 0）的家长题不出；最近出过的往后放', () => {
  const r = pickGateQuestion({ rng: seq(0), reviewRate: 0, customRate: 100, custom: [cq(1, 0), cq(2), cq(3)], wrong: [], generate: () => gen(), recentCustomIds: [2] });
  assert.equal(r.customId, 3);
  const r2 = pickGateQuestion({ rng: seq(0), reviewRate: 0, customRate: 100, custom: [cq(2)], wrong: [], generate: () => gen(), recentCustomIds: [2] });
  assert.equal(r2.customId, 2, '只剩最近出过的也照样出');
});

test('pickGateQuestion：错题优先本关专题、避开最近出过的；坏数据跳过', () => {
  const wrong = [wq('a', 'g4-jitu'), wq('b', 'g3-hecha'), wq('c', 'g3-hecha'), { q: { text: 'bad' } as unknown as QuestionLike }];
  const r = pickGateQuestion({ rng: seq(0.1, 0.0), reviewRate: 50, customRate: 100, custom: [], wrong, generate: () => gen(), topicIds: ['g3-hecha'], recentTexts: ['b'] });
  assert.equal(r.q.text, 'c');
  const r2 = pickGateQuestion({ rng: seq(0.0, 0.99), reviewRate: 50, customRate: 100, custom: [], wrong, generate: () => gen(), topicIds: ['g5-x'] });
  assert.ok(['a', 'b', 'c'].includes(r2.q.text), '本关专题没有错题时从全部错题里挑');
});

test('pickGateQuestion：同样的随机数序列结果完全一样', () => {
  const ctx = () => ({ reviewRate: 30, customRate: 40, custom: [cq(1), cq(2)], wrong: [wq('a'), wq('b'), wq('c')], generate: () => gen() });
  const vals = [0.35, 0.25, 0.5];
  const a = pickGateQuestion({ ...ctx(), rng: seq(...vals) });
  const b = pickGateQuestion({ ...ctx(), rng: seq(...vals) });
  assert.deepEqual(a, b);
});

test('customToQuestion：结构与 Question 兼容', () => {
  const q = customToQuestion({ ...cq(5), grade: 9 });
  assert.deepEqual(Object.keys(q).sort(), ['answer', 'difficulty', 'explain', 'grade', 'options', 'text', 'topicId']);
  assert.equal(q.grade, 3);
});
