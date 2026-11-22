import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, DAY, MIN, T0, ans, start } from './helpers.ts';

const save = (stars: Record<string, number>) => ({ baseVersion: -1, data: { stars, wrong: [], stats: { answered: 0, correct: 0, kills: 0, wins: 0 } } });

test('任务：每种类型的进度与自动完成，justCompleted 只出现一次', async () => {
  const s = await start();
  try {
    const a = await s.kid('甲');
    await a.call('/api/catalog', 'PUT', CATALOG);
    // 创建前的答题不计入
    await a.call('/api/answers', 'POST', { answers: Array.from({ length: 5 }, (_, i) => ans('g3-hecha', true, T0 - 10 * MIN + i)) });
    s.advance(MIN);
    const mk = async (body: Record<string, unknown>) => {
      const r = await s.admin('/api/admin/tasks', 'POST', { playerId: a.id, ...body });
      assert.equal(r.status, 201, r.text);
      return r.json.task;
    };
    const tLevel = await mk({ kind: 'clear_level', params: { levelId: '3-2' }, title: '通关植树', reward: '周末去游乐园', bonusCredits: 300 });
    const tCount = await mk({ kind: 'clear_count', params: { count: 2, grade: 3 } });
    const tTopic = await mk({ kind: 'correct_in_topic', params: { topicId: 'g3-hecha', count: 3 } });
    const tTotal = await mk({ kind: 'correct_total', params: { count: 4 } });
    const tAcc = await mk({ kind: 'accuracy', params: { percent: 80, minAnswers: 5, topicId: 'g3-zhishu' } });
    const tStreak = await mk({ kind: 'streak', params: { count: 3 } });
    assert.equal(tCount.title, '通关 2 个三年级关卡', '没填标题时自动生成');
    assert.equal(tTopic.players[0].progress.current, 0, '创建前的答题不算');
    assert.equal(tLevel.bonusCredits, 300);

    const status = async () => {
      const r = await a.call('/api/tasks');
      return new Map<number, any>(r.json.tasks.map((t: any) => [t.id, t]));
    };
    let m = await status();
    assert.equal(m.size, 6);
    assert.deepEqual(m.get(tAcc.id).progress, { current: 0, target: 5, unit: 'answers', accuracy: null, percent: 80 });

    // 星级 → clear_level / clear_count
    await a.call('/api/save', 'PUT', save({ '3-1': 1, '4-1': 2 }));
    m = await status();
    assert.equal(m.get(tCount.id).progress.current, 1, '4-1 不是三年级');
    assert.equal(m.get(tLevel.id).status, 'active');
    await a.call('/api/save', 'PUT', save({ '3-2': 3 }));
    m = await status();
    assert.equal(m.get(tLevel.id).status, 'done');
    assert.equal(m.get(tLevel.id).justCompleted, true);
    assert.equal(m.get(tCount.id).status, 'done');
    assert.ok(m.get(tLevel.id).completedAt >= T0);
    // 没确认前一直是 true；确认后再也不是
    assert.equal((await status()).get(tLevel.id).justCompleted, true);
    assert.equal((await a.call(`/api/tasks/${tLevel.id}/ack`, 'POST')).json.acked, true);
    assert.equal((await status()).get(tLevel.id).justCompleted, false);
    assert.equal((await a.call(`/api/tasks/${tLevel.id}/ack`, 'POST')).json.acked, true);
    assert.equal((await status()).get(tLevel.id).justCompleted, false);
    assert.equal((await a.call(`/api/tasks/${tStreak.id}/ack`, 'POST')).json.acked, false, '未完成的任务确认无效');

    // 答题 → topic / total / streak
    s.advance(MIN);
    const r = await a.call('/api/answers', 'POST', {
      answers: [ans('g3-hecha', true, s.clock.t), ans('g3-hecha', true, s.clock.t + 1), ans('g3-hecha', false, s.clock.t + 2), ans('g3-zhishu', true, s.clock.t + 3)],
    });
    assert.equal(r.json.tasksCompleted, 0);
    m = await status();
    assert.deepEqual(m.get(tTopic.id).progress, { current: 2, target: 3, unit: 'correct' });
    assert.deepEqual(m.get(tTotal.id).progress, { current: 3, target: 4, unit: 'correct' });
    assert.deepEqual(m.get(tStreak.id).progress, { current: 2, target: 3, unit: 'streak' });
    const t = s.clock.t + 10;
    const r2 = await a.call('/api/answers', 'POST', { answers: [ans('g3-hecha', true, t), ans('g3-hecha', true, t + 1)] });
    assert.equal(r2.json.tasksCompleted, 3, '专题答对、累计答对、连对同时完成');
    // 正确率：植树 5 题对 4 题 = 80%
    const r3 = await a.call('/api/answers', 'POST', { answers: [true, true, true, false].map((c, i) => ans('g3-zhishu', c, t + 10 + i)) });
    assert.equal(r3.json.tasksCompleted, 1);
    m = await status();
    for (const x of [tTopic, tTotal, tAcc, tStreak]) {
      assert.equal(m.get(x.id).status, 'done');
      assert.equal(m.get(x.id).justCompleted, true);
      assert.equal(m.get(x.id).progress.current, m.get(x.id).progress.target);
    }
    assert.equal(m.get(tAcc.id).progress.accuracy, 80);
    // 完成是锁定的：之后答错不会让任务回到未完成
    await a.call('/api/answers', 'POST', { answers: [ans('g3-zhishu', false, t + 20), ans('g3-zhishu', false, t + 21)] });
    assert.equal((await status()).get(tAcc.id).status, 'done');

    // 奖励兑现
    assert.equal((await s.admin(`/api/admin/tasks/${tStreak.id}/grant`, 'POST', { playerId: a.id })).status, 200);
    const adm = (await s.admin(`/api/admin/tasks?playerId=${a.id}`)).json.tasks.find((x: any) => x.id === tStreak.id);
    assert.equal(adm.players[0].rewardGranted, true);
    assert.equal((await status()).get(tStreak.id).rewardGranted, true);

    // 已完成任务：确认过的 7 天后不再出现在孩子列表里，没确认的一直在
    await a.call(`/api/tasks/${tTopic.id}/ack`, 'POST');
    s.advance(8 * DAY);
    m = await status();
    assert.equal(m.has(tTopic.id), false);
    assert.equal(m.has(tLevel.id), false);
    assert.equal(m.get(tTotal.id).justCompleted, true);
  } finally {
    await s.stop();
  }
});

test('任务：全体任务每人单独计算；隔离、归档、编辑、截止、删除、校验', async () => {
  const s = await start();
  try {
    const a = await s.kid('甲');
    const b = await s.kid('乙');
    await a.call('/api/catalog', 'PUT', CATALOG);
    const all = (await s.admin('/api/admin/tasks', 'POST', { playerId: null, kind: 'correct_total', params: { count: 2 }, title: '全家答对 2 题', dueDate: '2026-11-18' })).json.task;
    const onlyA = (await s.admin('/api/admin/tasks', 'POST', { playerId: a.id, kind: 'streak', params: { count: 2 } })).json.task;
    assert.equal(all.players.length, 2);
    // 乙看不到甲的专属任务，也不能确认它
    const bTasks = (await b.call('/api/tasks')).json.tasks;
    assert.deepEqual(bTasks.map((x: any) => x.id), [all.id]);
    assert.equal(bTasks[0].forAll, true);
    assert.equal((await b.call(`/api/tasks/${onlyA.id}/ack`, 'POST')).status, 404);
    assert.equal(JSON.stringify(bTasks).includes('甲'), false, '孩子的任务列表里没有别人的信息');
    // 甲完成全体任务，乙不受影响
    s.advance(MIN);
    await a.call('/api/answers', 'POST', { answers: [ans('g3-hecha', true, s.clock.t), ans('g3-hecha', true, s.clock.t + 1)] });
    const view = (await s.admin('/api/admin/tasks')).json.tasks.find((x: any) => x.id === all.id);
    const by = (v: any, name: string) => v.players.find((p: any) => p.name === name);
    assert.deepEqual([by(view, '甲').status, by(view, '乙').status], ['done', 'active']);
    // 兑现：全体任务要指明是谁；没完成的不能兑现
    assert.equal((await s.admin(`/api/admin/tasks/${all.id}/grant`, 'POST', {})).status, 400);
    assert.equal((await s.admin(`/api/admin/tasks/${all.id}/grant`, 'POST', { playerId: b.id })).status, 409);
    // 截止日期过后：未完成的变为 expired，截止后答的题不计
    s.clock.t = new Date('2026-11-19T09:00:00+08:00').getTime();
    await b.call('/api/answers', 'POST', { answers: [ans('g3-hecha', true, s.clock.t), ans('g3-hecha', true, s.clock.t + 1)] });
    const v2 = (await s.admin('/api/admin/tasks')).json.tasks.find((x: any) => x.id === all.id);
    assert.equal(by(v2, '乙').status, 'expired');
    assert.equal(v2.dueDate, '2026-11-18');
    assert.equal((await b.call('/api/tasks')).json.tasks.length, 0, '过期任务不显示给孩子');
    // 编辑目标：未兑现的完成记录作废并重新判定
    const ed = await s.admin(`/api/admin/tasks/${onlyA.id}`, 'PUT', { params: { count: 50 }, title: '连对 50' });
    assert.equal(ed.json.task.title, '连对 50');
    assert.equal(ed.json.task.players[0].status, 'active');
    // 只改备注不影响完成状态
    const ed2 = await s.admin(`/api/admin/tasks/${all.id}`, 'PUT', { note: '加油' });
    assert.equal(by(ed2.json.task, '甲').status, 'done');
    // 归档后孩子看不到
    await s.admin(`/api/admin/tasks/${onlyA.id}/archive`, 'POST', { archived: true });
    assert.equal((await a.call('/api/tasks')).json.tasks.some((x: any) => x.id === onlyA.id), false);
    assert.equal((await s.admin(`/api/admin/tasks/${onlyA.id}/archive`, 'POST', { archived: false })).json.task.archived, false);
    // 删除
    assert.equal((await s.admin(`/api/admin/tasks/${onlyA.id}`, 'DELETE')).status, 200);
    assert.equal((await s.admin(`/api/admin/tasks/${onlyA.id}`, 'DELETE')).status, 404);
    // 校验
    const bad = [
      { kind: 'fly', params: {} },
      { kind: 'clear_level', params: { levelId: '9-9' } },
      { kind: 'correct_in_topic', params: { topicId: 'nope', count: 3 } },
      { kind: 'correct_total', params: { count: 'many' } },
      { kind: 'accuracy', params: { percent: 80 } },
      { kind: 'streak', params: { count: 3 }, dueDate: '2026-13-40' },
      { kind: 'streak', params: { count: 3 }, playerId: 9999 },
      { kind: 'streak', params: { count: 3 }, title: 'x'.repeat(41) },
    ];
    for (const body of bad) assert.ok([400, 404].includes((await s.admin('/api/admin/tasks', 'POST', body)).status), JSON.stringify(body));
    const clamped = (await s.admin('/api/admin/tasks', 'POST', { kind: 'streak', params: { count: 999 }, bonusCredits: 5000 })).json.task;
    assert.deepEqual([clamped.params.count, clamped.bonusCredits], [200, 2000]);
    // 孩子不能调家长接口
    assert.equal((await a.call('/api/admin/tasks', 'POST', { kind: 'streak', params: { count: 3 } })).status, 403);
  } finally {
    await s.stop();
  }
});
