import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, DAY, HOUR, MIN, T0, ans, start } from './helpers.ts';

test('目录：登录后才能上传，校验格式，没有目录时显示原始 id', async () => {
  const s = await start();
  try {
    const a = await s.kid('甲');
    // 没目录时报告照常工作，专题名就是 id
    await a.call('/api/answers', 'POST', { answers: [ans('g3-hecha', true, T0 - MIN)] });
    const r0 = await s.admin(`/api/admin/players/${a.id}/report`);
    assert.equal(r0.json.catalogLoaded, false);
    assert.equal(r0.json.topics[0].name, 'g3-hecha');
    assert.equal((await s.call('/api/catalog', 'PUT', CATALOG)).status, 401);
    assert.equal((await a.call('/api/catalog', 'PUT', { topics: 'x', levels: [] })).status, 400);
    assert.equal((await a.call('/api/catalog', 'PUT', { topics: [{ id: 'bad id!', grade: 3, name: 'x' }], levels: [] })).status, 400);
    assert.equal((await a.call('/api/catalog', 'PUT', { topics: [{ id: 'a', grade: 9, name: 'x' }], levels: [] })).status, 400);
    const big = { topics: Array.from({ length: 401 }, (_, i) => ({ id: 't' + i, grade: 3, name: 'n' })), levels: [] };
    assert.equal((await a.call('/api/catalog', 'PUT', big)).status, 413);
    const huge = { topics: [{ id: 'a', grade: 3, name: 'x'.repeat(300_000) }], levels: [] };
    assert.equal((await a.call('/api/catalog', 'PUT', huge)).status, 413);
    const ok = await a.call('/api/catalog', 'PUT', CATALOG);
    assert.deepEqual([ok.status, ok.json.changed, ok.json.topics, ok.json.levels], [200, true, 3, 4]);
    assert.equal((await a.call('/api/catalog', 'PUT', CATALOG)).json.changed, false);
    assert.equal((await s.call('/api/catalog')).json.catalog.levels[2].boss, true);
    const r1 = await s.admin(`/api/admin/players/${a.id}/report`);
    assert.equal(r1.json.topics[0].name, '和差倍问题');
  } finally {
    await s.stop();
  }
});

test('答题记录：幂等、批量上限、坏记录跳过、时间校正', async () => {
  const s = await start();
  try {
    const a = await s.kid('甲');
    assert.equal((await s.call('/api/answers', 'POST', { answers: [] })).status, 401);
    const batch = [ans('g3-hecha', true, T0 - HOUR, { id: 'x1' }), ans('g3-hecha', false, T0 - HOUR, { id: 'x2' })];
    const r1 = await a.call('/api/answers', 'POST', { answers: batch });
    assert.deepEqual([r1.json.accepted, r1.json.duplicates], [2, 0]);
    const r2 = await a.call('/api/answers', 'POST', { answers: [...batch, ans('g3-hecha', true, T0, { id: 'x3' })] });
    assert.deepEqual([r2.json.accepted, r2.json.duplicates], [1, 2], '同一 id 重复提交不重复计数');
    // 不同玩家可以用相同的客户端 id
    const b = await s.kid('乙');
    assert.equal((await b.call('/api/answers', 'POST', { answers: [ans('g3-hecha', true, T0, { id: 'x1' })] })).json.accepted, 1);

    assert.equal((await a.call('/api/answers', 'POST', { answers: Array.from({ length: 201 }, (_, i) => ans('g3-hecha', true, T0, { id: 'big' + i })) })).status, 413);
    assert.equal((await a.call('/api/answers', 'POST', { nope: 1 })).status, 400);
    const bad = [
      { ...ans('g3-hecha', true, T0), id: '' },
      { ...ans('g3-hecha', true, T0), id: 'has space' },
      { ...ans('g3-hecha', true, T0), correct: 'yes' },
      { ...ans('g3-hecha', true, T0), context: 'cheat' },
      { ...ans('g3-hecha', true, T0), grade: 9 },
      { ...ans('bad topic', true, T0) },
      { ...ans('g3-hecha', true, T0 - 500 * DAY) },
      { ...ans('custom', true, T0), context: 'custom', customId: 999 },
      'garbage',
    ];
    const r3 = await a.call('/api/answers', 'POST', { answers: [...bad, ans('g3-hecha', true, T0 + 10 * DAY, { id: 'future', difficulty: 99, ms: 99_999_999 })] });
    assert.equal(r3.json.accepted, 1);
    assert.equal(r3.json.rejected.length, bad.length);
    const row = s.db.sql.prepare("SELECT * FROM answers WHERE client_id = 'future'").get() as any;
    assert.equal(row.at, T0, '未来时间按服务器时间记');
    assert.equal(row.difficulty, 3);
    assert.equal(row.ms, 600_000);
  } finally {
    await s.stop();
  }
});

test('学习报告：分专题、7 天、30 天、难度、场景、连对、薄弱专题；孩子只能看自己的', async () => {
  const s = await start();
  try {
    const a = await s.kid('甲');
    const b = await s.kid('乙');
    await a.call('/api/catalog', 'PUT', CATALOG);
    const list = [];
    // 10 天前：植树 10 题全错（薄弱）
    for (let i = 0; i < 10; i++) list.push(ans('g3-zhishu', false, T0 - 10 * DAY + i * MIN, { difficulty: 2, context: 'bonus' }));
    // 今天：和差 6 对 2 错，最后 4 题连对
    const seq = [true, true, false, true, false, true, true, true, true];
    seq.forEach((c, i) => list.push(ans('g3-hecha', c, T0 - HOUR + i * MIN, { ms: 4000 })));
    // 40 天前一题（不进 30 天图，但计入总数与活跃天数）
    list.push(ans('g4-jitu', true, T0 - 40 * DAY, { grade: 4, difficulty: 3 }));
    await a.call('/api/answers', 'POST', { answers: list });
    await b.call('/api/answers', 'POST', { answers: [ans('g3-hecha', false, T0)] });

    const r = (await s.admin(`/api/admin/players/${a.id}/report`)).json;
    assert.equal(r.player.name, '甲');
    assert.equal(r.totals.answered, 20);
    assert.equal(r.totals.correct, 8);
    assert.equal(r.totals.accuracy, 40);
    assert.equal(r.totals.daysActive, 3);
    assert.equal(r.last7.answered, 9);
    assert.deepEqual(r.streak, { current: 4, best: 4 });
    const hecha = r.topics.find((t: any) => t.topicId === 'g3-hecha');
    assert.deepEqual([hecha.answered, hecha.correct, hecha.accuracy, hecha.avgMs], [9, 7, 78, 4000]);
    assert.equal(r.weakTopics[0].topicId, 'g3-zhishu');
    assert.equal(r.weakTopics[0].accuracy, 0);
    assert.deepEqual(r.weakTopics.map((t: any) => t.topicId), ['g3-zhishu', 'g3-hecha'], '样本够且正确率低于 80% 的专题，从低到高');
    assert.ok(!r.weakTopics.some((t: any) => t.topicId === 'g4-jitu'), '样本太少的不算');
    assert.equal(r.daily.length, 30);
    assert.equal(r.daily.at(-1).day, '2026-11-16');
    assert.deepEqual([r.daily.at(-1).answered, r.daily.at(-1).correct], [9, 7]);
    assert.equal(r.daily.at(-11).answered, 10);
    assert.deepEqual(r.byDifficulty.map((d: any) => d.answered), [9, 10, 1]);
    assert.deepEqual(r.byContext.map((c: any) => [c.context, c.answered]), [['gate', 10], ['bonus', 10]]);
    assert.equal(r.totals.avgMs, Math.round((10 * 5000 + 9 * 4000 + 5000) / 20));

    // 孩子自己的简版报告
    const me = (await a.call('/api/report/me')).json;
    assert.deepEqual([me.totals.answered, me.week.answered, me.today.answered, me.streak.best], [20, 9, 9, 4]);
    assert.equal(me.topics[0].name, '植树问题');
    assert.equal(me.pass_hash, undefined);
    const meB = (await b.call('/api/report/me')).json;
    assert.equal(meB.totals.answered, 1, '乙只看到自己的');
    assert.equal((await s.call('/api/report/me')).status, 401);
    assert.equal((await b.call(`/api/admin/players/${a.id}/report`)).status, 403, '孩子不能调家长接口');
    assert.equal((await s.admin('/api/admin/players/9999/report')).status, 404);
  } finally {
    await s.stop();
  }
});
