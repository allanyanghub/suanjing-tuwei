import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T0, start } from './helpers.ts';

const at = (s: string) => new Date(s + '+08:00').getTime();

test('游戏时间：心跳计时、防作弊、时间段、每日上限、加时、跨日', async () => {
  const s = await start({ now: T0 }); // 周一 10:00
  try {
    const a = await s.kid('甲');
    const b = await s.kid('乙');
    // 默认关闭：只记录不限制
    const g0 = (await a.call('/api/playtime')).json;
    assert.deepEqual([g0.enabled, g0.allowedNow, g0.limitToday, g0.remaining, g0.reason], [false, true, null, null, null]);
    assert.equal((await s.call('/api/playtime')).status, 401);
    assert.equal((await a.call('/api/playtime/heartbeat', 'POST', { seconds: 'x' })).status, 400);

    // 单次最多计 60 秒
    const h1 = (await a.call('/api/playtime/heartbeat', 'POST', { seconds: 999 })).json;
    assert.deepEqual([h1.credited, h1.usedToday], [60, 60]);
    // 2 秒后又来一次：不可能，忽略
    s.advance(2000);
    const h2 = (await a.call('/api/playtime/heartbeat', 'POST', { seconds: 30 })).json;
    assert.deepEqual([h2.credited, h2.ignored, h2.usedToday], [0, true, 60]);
    // 距上次 32 秒，报 60 秒也只算 34 秒
    s.advance(30_000);
    const h3 = (await a.call('/api/playtime/heartbeat', 'POST', { seconds: 60 })).json;
    assert.deepEqual([h3.credited, h3.usedToday], [34, 94]);
    // 别人的心跳不影响甲
    await b.call('/api/playtime/heartbeat', 'POST', { seconds: 30 });
    assert.equal((await a.call('/api/playtime')).json.usedToday, 94);

    // 家长开启：工作日 30 分钟、16:00–20:30；周末 60 分钟、全天
    const put = await s.admin(`/api/admin/players/${a.id}/playtime`, 'PUT', {
      enabled: true,
      weekdayMinutes: 30,
      weekendMinutes: 60,
      weekdayWindows: [{ start: '16:00', end: '20:30' }],
      weekendWindows: [],
    });
    assert.equal(put.status, 200, put.text);
    let st = (await a.call('/api/playtime')).json;
    assert.deepEqual([st.allowedNow, st.reason, st.nextAllowedAt, st.limitToday, st.remaining], [false, 'outside_window', at('2026-11-16T16:00:00'), 1800, 1706]);
    assert.match(st.message, /今天 16:00/);

    s.clock.t = at('2026-11-16T16:10:00');
    st = (await a.call('/api/playtime')).json;
    assert.deepEqual([st.allowedNow, st.reason, st.windowEndsAt], [true, null, at('2026-11-16T20:30:00')]);

    // 玩到时间用完
    for (let i = 0; i < 60 && st.remaining > 0; i++) {
      s.advance(30_000);
      st = (await a.call('/api/playtime/heartbeat', 'POST', { seconds: 30 })).json;
    }
    assert.deepEqual([st.remaining, st.allowedNow, st.reason], [0, false, 'daily_limit']);
    assert.equal(st.nextAllowedAt, at('2026-11-17T16:00:00'), '明天的时间段开始');
    assert.match(st.message, /明天 16:00/);

    // 家长加 15 分钟
    const bonus = await s.admin(`/api/admin/players/${a.id}/playtime/bonus`, 'POST', { minutes: 15 });
    assert.equal(bonus.json.bonusMinutesToday, 15);
    st = (await a.call('/api/playtime')).json;
    assert.deepEqual([st.allowedNow, st.limitToday, st.bonusMinutesToday], [true, 2700, 15]);
    assert.ok(st.remaining > 0 && st.remaining <= 900);
    assert.equal((await s.admin(`/api/admin/players/${a.id}/playtime/bonus`, 'POST', { minutes: 0 })).status, 400);

    // 跨过午夜的心跳拆到两天
    const usedMon = st.usedToday;
    s.clock.t = at('2026-11-16T23:59:40');
    await a.call('/api/playtime/heartbeat', 'POST', { seconds: 20 });
    s.clock.t = at('2026-11-17T00:00:10');
    st = (await a.call('/api/playtime/heartbeat', 'POST', { seconds: 30 })).json;
    assert.equal(st.usedToday, 10, '新的一天从 0 开始，只计午夜后的 10 秒');
    assert.equal(st.bonusMinutesToday, 0, '加时只当天有效');
    const hist = (await s.admin(`/api/admin/players/${a.id}/playtime`)).json;
    assert.equal(hist.days.length, 14);
    assert.equal(hist.days.at(-1).day, '2026-11-17');
    assert.equal(hist.days.at(-2).seconds, usedMon + 20 + 20);
    assert.equal(hist.days.at(-2).bonusMinutes, 15);

    // 周末：全天可玩，上限 60 分钟
    s.clock.t = at('2026-11-21T08:00:00');
    st = (await a.call('/api/playtime')).json;
    assert.deepEqual([st.allowedNow, st.limitToday, st.windowEndsAt], [true, 3600, null]);

    // 工作日 0 分钟：下次可玩是周六 0 点
    await s.admin(`/api/admin/players/${a.id}/playtime`, 'PUT', { weekdayMinutes: 0 });
    s.clock.t = at('2026-11-18T17:00:00');
    st = (await a.call('/api/playtime')).json;
    assert.deepEqual([st.allowedNow, st.reason, st.nextAllowedAt], [false, 'daily_limit', at('2026-11-21T00:00:00')]);

    // 乙没开启，不受影响
    assert.equal((await b.call('/api/playtime')).json.allowedNow, true);
  } finally {
    await s.stop();
  }
});

test('游戏时间：设置校验与权限', async () => {
  const s = await start();
  try {
    const a = await s.kid('甲');
    const url = `/api/admin/players/${a.id}/playtime`;
    const bad = [
      { weekdayWindows: [{ start: '20:00', end: '16:00' }] },
      { weekdayWindows: [{ start: '16:00', end: '25:00' }] },
      { weekdayWindows: [{ start: '4pm', end: '20:00' }] },
      { weekdayWindows: [{ start: '16:00', end: '18:00' }, { start: '17:00', end: '19:00' }] },
      { weekendWindows: Array.from({ length: 5 }, (_, i) => ({ start: `0${i}:00`, end: `0${i}:30` })) },
      { enabled: 'yes' },
      { weekdayMinutes: 'lots' },
    ];
    for (const body of bad) assert.equal((await s.admin(url, 'PUT', body)).status, 400, JSON.stringify(body));
    const ok = await s.admin(url, 'PUT', { weekdayMinutes: 9999, weekendWindows: [{ start: '18:00', end: '24:00' }, { start: '08:00', end: '10:00' }] });
    assert.equal(ok.json.settings.weekdayMinutes, 720);
    assert.deepEqual(ok.json.settings.weekendWindows.map((w: any) => w.start), ['08:00', '18:00'], '时间段按开始时间排序');
    assert.equal(ok.json.settings.enabled, false, '没给的字段保持不变');
    assert.equal((await a.call(url, 'PUT', { enabled: true })).status, 403);
    assert.equal((await s.admin('/api/admin/players/999/playtime')).status, 404);
  } finally {
    await s.stop();
  }
});
