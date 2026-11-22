/// <reference types="node" />
/** 游戏时间：remaining 可为 null 的规则、本地推算、心跳节奏、离线不排队、到点事件 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Playtime, evaluatePlaytime, type PlaytimeSnapshot } from '../../src/net/playtime.ts';
import { ApiError, type Api, type HeartbeatResponse, type PlaytimeStatus } from '../../src/net/api.ts';
import { FakeClock } from './helpers.ts';

const T = new Date('2026-11-16T17:00:00').getTime();
const MIN = 60_000;
const base = (o: Partial<PlaytimeStatus> = {}): PlaytimeStatus => ({
  enabled: true, usedToday: 0, bonusMinutesToday: 0, serverTime: T, limitToday: 3600, remaining: 3600, allowedNow: true,
  nextAllowedAt: null, windowEndsAt: null, reason: null, message: '', windowsToday: [], ...o,
});
const snap = (s: PlaytimeStatus, playedSince = 0, fetchedAt = T): PlaytimeSnapshot => ({ status: s, fetchedAt, playedSince });

test('没有状态（游客 / 从没联网）→ 不限制', () => {
  const v = evaluatePlaytime(null, T);
  assert.equal(v.allowedNow, true);
  assert.equal(v.remaining, null);
});

test('家长没开启 → 永远允许，remaining = null', () => {
  const v = evaluatePlaytime(snap(base({ enabled: false, limitToday: null, remaining: null })), T + 10 * 3600_000);
  assert.equal(v.allowedNow, true);
  assert.equal(v.remaining, null);
  assert.equal(v.enabled, false);
});

test('开启但不限时长：remaining = null 不能当成 0（null <= 0 陷阱）', () => {
  const v = evaluatePlaytime(snap(base({ limitToday: null, remaining: null }), 99999), T + MIN);
  assert.equal(v.allowedNow, true);
  assert.equal(v.remaining, null);
});

test('本地递减 remaining，用完后不允许', () => {
  const s = base({ remaining: 600 });
  assert.equal(evaluatePlaytime(snap(s, 100), T).remaining, 500);
  const v = evaluatePlaytime(snap(s, 600), T);
  assert.equal(v.allowedNow, false);
  assert.equal(v.reason, 'daily_limit');
  assert.equal(v.remaining, 0);
  assert.match(v.message, /用完/);
});

test('服务器说不能玩（daily_limit）→ 用服务器的 message', () => {
  const v = evaluatePlaytime(snap(base({ remaining: 0, allowedNow: false, reason: 'daily_limit', message: '今天的游戏时间用完啦，明天 16:00 再来吧', nextAllowedAt: T + 23 * 3600_000 })), T + MIN);
  assert.equal(v.allowedNow, false);
  assert.equal(v.message, '今天的游戏时间用完啦，明天 16:00 再来吧');
  assert.equal(v.nextAllowedAt, T + 23 * 3600_000);
});

test('过了 windowEndsAt 视为不在时间段', () => {
  const s = base({ windowEndsAt: T + 30 * MIN, windowsToday: [{ start: '16:00', end: '17:30' }], limitToday: null, remaining: null });
  assert.equal(evaluatePlaytime(snap(s), T + 29 * MIN).allowedNow, true);
  const v = evaluatePlaytime(snap(s), T + 31 * MIN);
  assert.equal(v.allowedNow, false);
  assert.equal(v.reason, 'outside_window');
});

test('不在时间段：到了 nextAllowedAt 才允许；时钟偏差按 serverTime 校正', () => {
  const skew = 5 * MIN; // 服务器比本机快 5 分钟
  const s = base({ serverTime: T + skew, allowedNow: false, reason: 'outside_window', message: '现在不是游戏时间，今天 18:00 可以玩', nextAllowedAt: T + skew + 60 * MIN, windowsToday: [{ start: '18:00', end: '20:00' }] });
  const before = evaluatePlaytime(snap(s, 0, T), T + 59 * MIN);
  assert.equal(before.allowedNow, false);
  assert.equal(before.message, '现在不是游戏时间，今天 18:00 可以玩');
  assert.equal(before.nextAllowedAt, T + 60 * MIN, '换算到本机时钟');
  assert.equal(evaluatePlaytime(snap(s, 0, T), T + 61 * MIN).allowedNow, true);
});

test('跨过本地午夜：用完的时长清零，但时间段规则照旧', () => {
  const s = base({ limitToday: 1800 + 600, bonusMinutesToday: 10, remaining: 0, allowedNow: false, reason: 'daily_limit', windowsToday: [{ start: '16:00', end: '20:00' }] });
  const nextMorning = new Date('2026-11-17T09:00:00').getTime();
  const v = evaluatePlaytime(snap(s, 0), nextMorning);
  assert.equal(v.allowedNow, false, '早上 9 点不在 16:00–20:00');
  assert.equal(v.reason, 'outside_window');
  const evening = new Date('2026-11-17T16:30:00').getTime();
  const v2 = evaluatePlaytime(snap(s, 0), evening);
  assert.equal(v2.allowedNow, true);
  assert.equal(v2.remaining, 1800, '新的一天不含昨天的临时加时');
});

// ---------------------------------------------------------------- 运行时

function setup(opts: { online?: () => boolean; fail?: () => boolean; status?: (sent: number) => PlaytimeStatus } = {}) {
  const clock = new FakeClock(T);
  const beats: { at: number; seconds: number }[] = [];
  let used = 0;
  const api = {
    heartbeat: async (seconds: number): Promise<HeartbeatResponse> => {
      if (opts.fail?.()) throw new ApiError(0, '连不上服务器', 'network');
      beats.push({ at: clock.t, seconds });
      used += seconds;
      const s = opts.status ? opts.status(used) : base({ usedToday: used, remaining: 3600 - used, serverTime: clock.t });
      return { ...s, credited: seconds, ignored: false };
    },
    playtime: async () => base({ usedToday: used, remaining: 3600 - used, serverTime: clock.t }),
  } as unknown as Api;
  const pt = new Playtime({ api, now: clock.now, timers: clock, online: opts.online ?? (() => true) });
  return { clock, pt, beats };
}

test('只在对局中每 ~30 秒发心跳，秒数 = 实际经过；结束时补发剩余', async () => {
  const { clock, pt, beats } = setup();
  await clock.advance(120_000);
  assert.equal(beats.length, 0, '没开局不发');
  pt.start();
  await clock.advance(95_000);
  assert.deepEqual(beats.map((b) => b.seconds), [30, 30, 30]);
  await pt.stop();
  assert.deepEqual(beats.map((b) => b.seconds), [30, 30, 30, 5]);
  await clock.advance(120_000);
  assert.equal(beats.length, 4, '结束后不再发');
});

test('结束时距上次心跳不足 5 秒：不发，并入下一局第一次心跳', async () => {
  const { clock, pt, beats } = setup();
  pt.start();
  await clock.advance(32_000);
  assert.equal(beats.length, 1);
  await pt.stop();
  assert.equal(beats.length, 1, '2 秒的尾巴（距上次心跳 2 秒）没发');
  await clock.advance(60_000);
  pt.start();
  await clock.advance(30_000);
  assert.equal(beats.length, 2);
  assert.equal(beats[1].seconds, 32, '上一局的 2 秒并入这一局第一次心跳');
  await pt.stop();
});

test('暂停时停表', async () => {
  const { clock, pt, beats } = setup();
  pt.start();
  await clock.advance(10_000);
  pt.pause(true);
  await clock.advance(300_000);
  assert.equal(beats.length, 0);
  pt.pause(false);
  await clock.advance(20_000);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].seconds, 30);
});

test('离线：心跳不排队、不补发，只在本地递减 remaining', async () => {
  let online = true;
  const { clock, pt, beats } = setup({ online: () => online });
  await pt.refresh();
  assert.equal(pt.view().remaining, 3600);
  online = false;
  pt.start();
  await clock.advance(90_000);
  assert.equal(beats.length, 0);
  assert.ok(Math.abs(pt.view().remaining! - 3510) <= 1, `本地推算剩余 ${pt.view().remaining}`);
  online = true;
  await clock.advance(30_000);
  assert.equal(beats.length, 1);
  assert.ok(beats[0].seconds <= 31, '离线那段时间没有补发');
});

test('心跳失败也不补发', async () => {
  let fail = true;
  const { clock, pt, beats } = setup({ fail: () => fail });
  pt.start();
  await clock.advance(61_000);
  fail = false;
  await clock.advance(30_000);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].seconds, 30);
});

test('对局中到达上限：发一次 limitReached，不打断（继续计时直到 stop）', async () => {
  const { clock, pt } = setup({ status: (used) => base({ usedToday: used, remaining: Math.max(0, 60 - used), allowedNow: used < 60, reason: used < 60 ? null : 'daily_limit', message: used < 60 ? '' : '今天的游戏时间用完啦', serverTime: clock.t }) });
  let fired = 0;
  pt.ev.on('limitReached', () => fired++);
  pt.start();
  await clock.advance(200_000);
  assert.equal(fired, 1);
  assert.equal(pt.view().allowedNow, false);
  await pt.stop();
});
