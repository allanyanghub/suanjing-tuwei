import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, DAY, HOUR, MIN, T0, ans, start } from './helpers.ts';

test('家长留言：给个人或全体，过期隐藏，别人看不到', async () => {
  const s = await start();
  try {
    const a = await s.kid('甲');
    const b = await s.kid('乙');
    const m1 = await s.admin('/api/admin/messages', 'POST', { text: '  今天表现很棒！\n继续加油 ', playerId: a.id });
    assert.equal(m1.status, 201);
    assert.equal(m1.json.message.text, '今天表现很棒！\n继续加油');
    await s.admin('/api/admin/messages', 'POST', { text: '<b>晚饭 6 点</b>', expiresInHours: 2 });
    const la = (await a.call('/api/messages')).json.messages;
    assert.equal(la.length, 2);
    assert.equal(la[0].text, '<b>晚饭 6 点</b>', '原样保存为纯文本，由显示端转义');
    assert.equal(la[0].forAll, true);
    const lb = (await b.call('/api/messages')).json.messages;
    assert.deepEqual(lb.map((m: any) => m.forAll), [true], '乙看不到给甲的留言');
    s.advance(3 * HOUR);
    assert.equal((await b.call('/api/messages')).json.messages.length, 0, '过期后不再返回');
    assert.equal((await s.admin('/api/admin/messages')).json.messages.find((m: any) => m.forAll).expired, true);
    for (const body of [{ text: '' }, { text: 'x'.repeat(201) }, { text: 5 }, { text: 'hi', playerId: 999 }, { text: 'hi', expiresInHours: 'soon' }])
      assert.ok([400, 404].includes((await s.admin('/api/admin/messages', 'POST', body)).status), JSON.stringify(body));
    assert.equal((await a.call('/api/admin/messages', 'POST', { text: 'hack' })).status, 403);
    assert.equal((await s.admin(`/api/admin/messages/${m1.json.message.id}`, 'DELETE')).status, 200);
    assert.equal((await a.call('/api/messages')).json.messages.length, 0);
    assert.equal((await s.admin(`/api/admin/messages/${m1.json.message.id}`, 'DELETE')).status, 404);
  } finally {
    await s.stop();
  }
});

test('自定义题目：增删改、校验、分配、答对 N 次后毕业、统计', async () => {
  const s = await start();
  try {
    const a = await s.kid('甲');
    const b = await s.kid('乙');
    const q = { text: '爸爸今年 36 岁，是你的 4 倍，你几岁？', options: ['8 岁', '9 岁', '10 岁', '12 岁'], answer: 1, explain: '36 ÷ 4 = 9', grade: 3, topicLabel: '家庭题' };
    const bad = [
      { ...q, options: ['1', '2', '3'] },
      { ...q, options: ['1', '1', '2', '3'] },
      { ...q, options: ['1', ' ', '2', '3'] },
      { ...q, options: ['1', 'x'.repeat(61), '2', '3'] },
      { ...q, answer: 4 },
      { ...q, text: '' },
      { ...q, text: 'x'.repeat(301) },
      { ...q, explain: 'x'.repeat(401) },
      { ...q, grade: 'three' },
      { ...q, playerIds: [] },
      { ...q, playerIds: [999] },
    ];
    for (const body of bad) assert.ok([400, 404].includes((await s.admin('/api/admin/custom-questions', 'POST', body)).status), JSON.stringify(body));
    const forA = (await s.admin('/api/admin/custom-questions', 'POST', { ...q, playerIds: [a.id], requiredCorrect: 2 })).json.question;
    const forAll = (await s.admin('/api/admin/custom-questions', 'POST', { ...q, text: '1 + 1 = ?', options: ['1', '2', '3', '4'], grade: 7 })).json.question;
    assert.equal(forAll.grade, 6, '年级夹到 3–6');
    assert.equal(forAll.forAll, true);

    const pa = (await a.call('/api/custom-questions')).json.questions;
    assert.equal(pa.length, 2);
    const qa = pa.find((x: any) => x.id === forA.id);
    assert.deepEqual([qa.topicId, qa.difficulty, qa.grade, qa.answer, qa.remainingCorrect, qa.figure], ['custom', 1, 3, 1, 2, undefined]);
    assert.deepEqual((await b.call('/api/custom-questions')).json.questions.map((x: any) => x.id), [forAll.id], '乙看不到只出给甲的题');
    // 乙提交甲的题的答案：拒收
    const rb = await b.call('/api/answers', 'POST', { answers: [{ ...ans('custom', true, T0), context: 'custom', customId: forA.id }] });
    assert.deepEqual([rb.json.accepted, rb.json.rejected.length], [0, 1]);

    const cans = (correct: boolean, t: number) => ({ ...ans('whatever', correct, t), context: 'custom', customId: forA.id });
    await a.call('/api/answers', 'POST', { answers: [cans(false, T0), cans(true, T0 + 1)] });
    assert.equal((await a.call('/api/custom-questions')).json.questions.find((x: any) => x.id === forA.id).remainingCorrect, 1);
    await a.call('/api/answers', 'POST', { answers: [cans(true, T0 + 2)] });
    assert.deepEqual((await a.call('/api/custom-questions')).json.questions.map((x: any) => x.id), [forAll.id], '答对 2 次后毕业');
    const row = s.db.sql.prepare('SELECT topic_id, grade FROM answers WHERE custom_id = ? LIMIT 1').get(forA.id) as any;
    assert.deepEqual([row.topic_id, row.grade], ['custom', 3], '自定义题的专题与年级以服务器为准');

    const st = (await s.admin(`/api/admin/custom-questions/${forA.id}/stats`)).json;
    assert.deepEqual([st.question.stats[0].answered, st.question.stats[0].correct, st.question.stats[0].wrong, st.question.stats[0].retired], [3, 2, 1, true]);
    assert.equal(st.attempts.length, 3);
    assert.equal(st.attempts[0].name, '甲');

    // 提高要求次数后重新出现；停用后消失；改成全体后乙也能看到
    await s.admin(`/api/admin/custom-questions/${forA.id}`, 'PUT', { requiredCorrect: 3 });
    assert.equal((await a.call('/api/custom-questions')).json.questions.some((x: any) => x.id === forA.id), true);
    await s.admin(`/api/admin/custom-questions/${forA.id}`, 'PUT', { active: false });
    assert.equal((await a.call('/api/custom-questions')).json.questions.some((x: any) => x.id === forA.id), false);
    const upd = await s.admin(`/api/admin/custom-questions/${forA.id}`, 'PUT', { active: true, playerIds: null, options: ['a', 'b', 'c', 'd'] });
    assert.deepEqual([upd.json.question.forAll, upd.json.question.options[3], upd.json.question.text], [true, 'd', q.text]);
    assert.equal((await b.call('/api/custom-questions')).json.questions.length, 2);
    assert.equal((await s.admin('/api/admin/custom-questions')).json.questions.length, 2);
    assert.equal((await s.admin(`/api/admin/custom-questions/${forA.id}`, 'DELETE')).status, 200);
    assert.equal((await s.admin(`/api/admin/custom-questions/${forA.id}`, 'PUT', { active: true })).status, 404);
    assert.equal((await a.call('/api/admin/custom-questions')).status, 403);
  } finally {
    await s.stop();
  }
});

test('排行榜：本周从周一开始，正确率至少 10 题才上榜，可隐藏孩子', async () => {
  const s = await start({ now: new Date('2026-11-15T20:00:00+08:00').getTime() }); // 周日晚上
  try {
    const a = await s.kid('甲');
    const b = await s.kid('乙');
    const c = await s.kid('丙');
    await a.call('/api/catalog', 'PUT', CATALOG);
    await a.call('/api/save', 'PUT', { baseVersion: 0, data: { stars: { '3-1': 3, '3-2': 2 }, stats: { answered: 0, correct: 0, kills: 0, wins: 4 } } });
    await b.call('/api/save', 'PUT', { baseVersion: 0, data: { stars: { '3-1': 1 }, stats: { answered: 0, correct: 0, kills: 0, wins: 9 } } });
    // 周日（上周）：甲答对 20 题
    await a.call('/api/answers', 'POST', { answers: Array.from({ length: 20 }, (_, i) => ans('g3-hecha', true, s.clock.t - HOUR + i)) });
    s.clock.t = T0; // 周一 10:00
    await a.call('/api/answers', 'POST', { answers: Array.from({ length: 5 }, (_, i) => ans('g3-hecha', true, T0 - MIN + i)) });
    await b.call('/api/answers', 'POST', { answers: Array.from({ length: 12 }, (_, i) => ans('g3-hecha', i % 4 !== 0, T0 - MIN + i)) });
    const lb = (await a.call('/api/leaderboard')).json;
    assert.equal(lb.weekStartsAt, new Date('2026-11-16T00:00:00+08:00').getTime());
    const pa = lb.players.find((p: any) => p.name === '甲');
    assert.deepEqual([pa.stars, pa.cleared, pa.wins, pa.weekCorrect, pa.weekAccuracy, pa.bestStreak, pa.isMe], [5, 2, 4, 5, null, 25, true]);
    const pb = lb.players.find((p: any) => p.name === '乙');
    assert.deepEqual([pb.weekCorrect, pb.weekAccuracy, pb.isMe], [9, 75, false]);
    assert.deepEqual(lb.boards.weekCorrect.map((x: any) => x.name), ['乙', '甲', '丙']);
    assert.deepEqual(lb.boards.weekAccuracy.map((x: any) => x.name), ['乙'], '不足 10 题不上正确率榜');
    assert.deepEqual(lb.boards.stars.map((x: any) => [x.name, x.rank]), [['甲', 1], ['乙', 2], ['丙', 3]]);
    // 段位：甲 4 胜 + 5 星 → 4+1=5；乙 9 胜 + 1 星 → 9；丙 0
    assert.deepEqual([pa.rank, pb.rank], [5, 9]);
    assert.deepEqual(lb.boards.rank.map((x: any) => [x.name, x.value]), [['乙', 9], ['甲', 5], ['丙', 0]]);
    assert.equal(JSON.stringify(lb).includes('pass_hash') || JSON.stringify(lb).includes('token'), false);
    // 下周一：本周数据清零
    s.advance(7 * DAY);
    assert.equal((await a.call('/api/leaderboard')).json.players.find((p: any) => p.name === '乙').weekCorrect, 0);
    // 隐藏丙
    await s.admin(`/api/admin/players/${c.id}/settings`, 'PUT', { hideFromLeaderboard: true });
    const lb2 = (await a.call('/api/leaderboard')).json;
    assert.equal(lb2.players.some((p: any) => p.name === '丙'), false);
    assert.equal((await c.call('/api/leaderboard')).json.meHidden, true);
    const adm = (await s.admin('/api/admin/leaderboard')).json;
    assert.equal(adm.players.find((p: any) => p.name === '丙').hidden, true);
    assert.equal(adm.boards.stars.some((x: any) => x.name === '丙'), false);
    assert.equal((await s.call('/api/leaderboard')).status, 401);
  } finally {
    await s.stop();
  }
});

test('个人设置：默认值、校验与夹取、出题频率、比赛长度、只看自己的', async () => {
  const s = await start();
  try {
    const a = await s.kid('甲', 4);
    const b = await s.kid('乙');
    const d = (await a.call('/api/settings/me')).json.settings;
    assert.deepEqual(d, {
      grade: 4, passAccuracy: 60, botStrength: 1, reviveSeconds: 60, gateRequired: true,
      gateCount: 1, bonusCount: 2, plantQuestions: 1, defuseQuestions: 1, reviewRate: 20, customRate: 100,
      roundsToWin: null, bossRoundsToWin: null,
    });
    const url = `/api/admin/players/${a.id}/settings`;
    const r = await s.admin(url, 'PUT', {
      passAccuracy: 10, botStrength: 1.234, reviveSeconds: 999, gateRequired: false, grade: 6,
      gateCount: 9, bonusCount: -1, plantQuestions: 0, defuseQuestions: 3.4, reviewRate: 80, customRate: 101,
      roundsToWin: 2, bossRoundsToWin: 99,
    });
    assert.equal(r.status, 200, r.text);
    const x = r.json.settings;
    assert.deepEqual(
      [x.passAccuracy, x.botStrength, x.reviveSeconds, x.gateRequired, x.grade, x.gateCount, x.bonusCount, x.plantQuestions, x.defuseQuestions, x.reviewRate, x.customRate, x.roundsToWin, x.bossRoundsToWin],
      [40, 1.25, 180, false, 6, 5, 0, 1, 3, 50, 100, 3, 13],
    );
    // 只改一项，其余不变；null 恢复默认比赛长度
    const r2 = (await s.admin(url, 'PUT', { roundsToWin: null, bonusCount: 4 })).json.settings;
    assert.deepEqual([r2.roundsToWin, r2.bossRoundsToWin, r2.bonusCount, r2.gateCount], [null, 13, 4, 5]);
    for (const body of [{ passAccuracy: 'high' }, { gateRequired: 1 }, { reviewRate: '20' }, { roundsToWin: 'five' }, { botStrength: null }])
      assert.equal((await s.admin(url, 'PUT', body)).status, 400, JSON.stringify(body));
    const me = (await a.call('/api/settings/me')).json.settings;
    assert.equal(me.grade, 6);
    assert.equal(me.hideFromLeaderboard, undefined, '孩子端不返回排行榜开关');
    assert.equal((await b.call('/api/settings/me')).json.settings.gateCount, 1, '乙的设置不受影响');
    assert.equal((await a.call(url, 'PUT', { passAccuracy: 40 })).status, 403);

    // 旧行（出题频率列加入之前写入的行）读出来是默认值
    s.db.sql.prepare('INSERT INTO player_settings (player_id, pass_accuracy, bot_strength, revive_seconds, gate_required, hide_from_leaderboard, updated_at) VALUES (?, 70, 0.8, 30, 1, 0, 0)').run(b.id);
    const old = (await b.call('/api/settings/me')).json.settings;
    assert.deepEqual([old.passAccuracy, old.gateCount, old.bonusCount, old.reviewRate, old.customRate, old.roundsToWin], [70, 1, 2, 20, 100, null]);
  } finally {
    await s.stop();
  }
});

test('权限：所有家长接口都要密码；孩子接口不泄露密码哈希和令牌', async () => {
  const s = await start();
  try {
    const a = await s.kid('甲');
    const id = a.id;
    const adminRoutes: [string, string][] = [
      ['GET', '/api/admin/players'], ['GET', '/api/admin/dashboard'], ['GET', '/api/admin/leaderboard'],
      ['GET', `/api/admin/players/${id}/report`], ['GET', `/api/admin/players/${id}/wrong`], ['GET', '/api/admin/wrong?name=甲'],
      ['GET', `/api/admin/players/${id}/settings`], ['PUT', `/api/admin/players/${id}/settings`],
      ['GET', `/api/admin/players/${id}/playtime`], ['PUT', `/api/admin/players/${id}/playtime`], ['POST', `/api/admin/players/${id}/playtime/bonus`],
      ['POST', `/api/admin/players/${id}/reset-password`], ['DELETE', `/api/admin/players/${id}`],
      ['POST', '/api/admin/reset-password'], ['POST', '/api/admin/delete-player'],
      ['GET', '/api/admin/tasks'], ['POST', '/api/admin/tasks'], ['PUT', '/api/admin/tasks/1'], ['DELETE', '/api/admin/tasks/1'],
      ['POST', '/api/admin/tasks/1/grant'], ['POST', '/api/admin/tasks/1/archive'],
      ['GET', '/api/admin/messages'], ['POST', '/api/admin/messages'], ['DELETE', '/api/admin/messages/1'],
      ['GET', '/api/admin/custom-questions'], ['POST', '/api/admin/custom-questions'], ['PUT', '/api/admin/custom-questions/1'],
      ['DELETE', '/api/admin/custom-questions/1'], ['GET', '/api/admin/custom-questions/1/stats'], ['GET', '/api/admin/not-a-route'],
      ['GET', '/api/admin/password'], ['POST', '/api/admin/password'],
    ];
    for (const [m, p] of adminRoutes) {
      assert.equal((await s.call(p, m, m === 'GET' ? undefined : {})).status, 403, `${m} ${p} 无密码`);
      assert.equal((await s.call(p, m, m === 'GET' ? undefined : {}, { ...a.h, 'X-Admin-Password': 'wrong' })).status, 403, `${m} ${p} 错密码`);
    }
    assert.equal(s.db.playerById(id)?.name, '甲', '没有任何家长操作生效');
    for (const p of ['/api/tasks', '/api/messages', '/api/custom-questions', '/api/leaderboard', '/api/settings/me', '/api/report/me', '/api/playtime', '/api/me', '/api/players']) {
      const r = await a.call(p);
      assert.equal(r.status, 200, p);
      assert.ok(!/pass_hash|salt|token/.test(r.text), `${p} 不应含敏感字段`);
    }
    const adm = await s.admin('/api/admin/players');
    assert.ok(!/pass_hash|salt/.test(adm.text));
    assert.equal(adm.json.players[0].id, id);
    assert.equal((await s.call('/api/tasks', 'PATCH')).status, 405);
    // 请求体过大
    const big = await fetch(s.base + '/api/admin/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Password': 'parent-pw' }, body: JSON.stringify({ text: 'x'.repeat(100_000) }) });
    assert.equal(big.status, 413);
    // 健康检查报告时区
    const h = (await s.call('/api/health')).json;
    assert.equal(h.tz, 'Asia/Shanghai');
    assert.equal(h.utcOffsetMinutes, 480);
    assert.equal(h.schemaVersion, 5);
  } finally {
    await s.stop();
  }
});

test('总览与删除玩家：删除会级联清除所有相关数据', async () => {
  const s = await start();
  try {
    const a = await s.kid('甲');
    const b = await s.kid('乙');
    await s.admin('/api/admin/tasks', 'POST', { playerId: a.id, kind: 'correct_total', params: { count: 1 }, reward: '冰淇淋' });
    await s.admin('/api/admin/tasks', 'POST', { playerId: null, kind: 'correct_total', params: { count: 1 } });
    await a.call('/api/answers', 'POST', { answers: [ans('g3-hecha', true, T0 + 1)] });
    await a.call('/api/playtime/heartbeat', 'POST', { seconds: 30 });
    await s.admin('/api/admin/messages', 'POST', { text: 'hi', playerId: a.id });
    await s.admin('/api/admin/custom-questions', 'POST', { text: 'q', options: ['1', '2', '3', '4'], answer: 0, grade: 3, playerIds: [a.id] });
    await s.admin(`/api/admin/players/${a.id}/settings`, 'PUT', { passAccuracy: 70 });
    await s.admin(`/api/admin/players/${a.id}/playtime`, 'PUT', { enabled: true });
    const dash = (await s.admin('/api/admin/dashboard')).json;
    const da = dash.players.find((p: any) => p.name === '甲');
    assert.deepEqual([da.todayAnswered, da.todaySeconds, da.rewardsToGrant, da.activeTasks, da.playtimeEnabled], [1, 30, 1, 0, true]);
    assert.equal(dash.tz, 'Asia/Shanghai');

    assert.equal((await s.admin(`/api/admin/players/${a.id}`, 'DELETE')).status, 200);
    for (const t of ['sessions', 'answers', 'task_progress', 'playtime_settings', 'playtime_usage', 'messages', 'custom_assign', 'player_settings']) {
      const n = (s.db.sql.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE player_id = ?`).get(a.id) as any).n;
      assert.equal(n, 0, t);
    }
    assert.equal((s.db.sql.prepare('SELECT COUNT(*) AS n FROM tasks WHERE player_id IS NULL').get() as any).n, 1, '全体任务保留');
    assert.equal((s.db.sql.prepare('SELECT COUNT(*) AS n FROM tasks WHERE player_id IS NOT NULL').get() as any).n, 0);
    assert.equal((await b.call('/api/tasks')).status, 200);
    assert.equal((await a.call('/api/me')).status, 401);
  } finally {
    await s.stop();
  }
});

test('家长页面：能打开，脚本语法正确，没有残留的模板插值', async () => {
  const s = await start();
  try {
    const r = await s.call('/admin');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /text\/html/);
    assert.ok(r.headers.get('content-security-policy')?.includes("default-src 'none'"));
    const html = r.text;
    for (const word of ['家长管理', '学习报告', '错题', '任务与奖励', '游戏时间', '留言', '难度设置', '出题频率', '账号', '自定义题目', '排行榜']) assert.ok(html.includes(word), word);
    const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
    assert.ok(!/\[object Object\]|\{\{|\}\}|\$\{|undefined|NaN/.test(markup), '页面标记里没有未替换的占位符');
    assert.ok(!/(src|href)=["']https?:/i.test(html), '不引用外部资源');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length >= 1);
    for (const js of scripts) assert.doesNotThrow(() => new Function(js), '内联脚本能被解析');
    assert.equal((await s.call('/admin/')).status, 200);
  } finally {
    await s.stop();
  }
});
