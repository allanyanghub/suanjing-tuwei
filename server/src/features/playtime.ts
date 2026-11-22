/**
 * 游戏时间管理。客户端在对局进行中每 ~30 秒发一次心跳，服务器累计每天的游戏秒数，
 * 并根据家长设置报告"现在能不能开新局"。服务器只报告，由客户端执行限制。
 * 日界线与时间段按服务器本地时区（环境变量 TZ）计算。
 */
import { HttpError, bool, isObj, num, optNum, type Env, type Route } from '../http.ts';
import { DAY_MS, addDays, atMinute, dayKey, isWeekend, minuteOfDay, startOfDay } from '../time.ts';
import { playerParam } from './core.ts';

/** 单次心跳最多计入的秒数 */
export const MAX_BEAT_SECONDS = 60;
/** 两次心跳间隔小于这个值视为异常，不计时 */
export const MIN_BEAT_GAP_MS = 5_000;
/** 两次心跳间隔在这个范围内时，计入秒数不超过实际间隔（+2 秒容差） */
const CONTINUOUS_MS = 10 * 60_000;

export interface Window {
  start: string;
  end: string;
}

export interface PlaytimeSettings {
  enabled: boolean;
  /** 工作日 / 周末每天可玩分钟数；null = 不限时长 */
  weekdayMinutes: number | null;
  weekendMinutes: number | null;
  /** 允许玩的时间段；空数组 = 全天 */
  weekdayWindows: Window[];
  weekendWindows: Window[];
}

interface SettingsRow {
  enabled: number;
  weekday_minutes: number | null;
  weekend_minutes: number | null;
  weekday_windows: string;
  weekend_windows: string;
  last_beat_at: number | null;
}

const toMin = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const fromMin = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function parseWindows(v: unknown, label: string): Window[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 4) throw new HttpError(400, `${label}最多 4 段`);
  const out: { s: number; e: number }[] = [];
  for (const w of v) {
    if (!isObj(w) || typeof w.start !== 'string' || typeof w.end !== 'string') throw new HttpError(400, `${label}格式不正确`);
    const re = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!re.test(w.start) || !(re.test(w.end) || w.end === '24:00')) throw new HttpError(400, `${label}的时间应为 HH:MM`);
    const s = toMin(w.start);
    const e = toMin(w.end);
    if (e <= s) throw new HttpError(400, `${label}的结束时间要晚于开始时间`);
    out.push({ s, e });
  }
  out.sort((a, b) => a.s - b.s);
  for (let i = 1; i < out.length; i++) if (out[i].s < out[i - 1].e) throw new HttpError(400, `${label}有重叠`);
  return out.map((w) => ({ start: fromMin(w.s), end: fromMin(w.e) }));
}

const safeWindows = (json: string): Window[] => {
  try {
    return parseWindows(JSON.parse(json), '时间段');
  } catch {
    return [];
  }
};

export class PlaytimeService {
  private env: Env;
  constructor(env: Env) {
    this.env = env;
  }

  private row(playerId: number): SettingsRow | undefined {
    return this.env.db.q('SELECT * FROM playtime_settings WHERE player_id = ?').get(playerId) as SettingsRow | undefined;
  }

  settings(playerId: number): PlaytimeSettings {
    const r = this.row(playerId);
    if (!r) return { enabled: false, weekdayMinutes: null, weekendMinutes: null, weekdayWindows: [], weekendWindows: [] };
    return {
      enabled: r.enabled === 1,
      weekdayMinutes: r.weekday_minutes,
      weekendMinutes: r.weekend_minutes,
      weekdayWindows: safeWindows(r.weekday_windows),
      weekendWindows: safeWindows(r.weekend_windows),
    };
  }

  saveSettings(playerId: number, s: PlaytimeSettings): void {
    this.env.db
      .q(
        `INSERT INTO playtime_settings (player_id, enabled, weekday_minutes, weekend_minutes, weekday_windows, weekend_windows, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE SET enabled = excluded.enabled, weekday_minutes = excluded.weekday_minutes,
           weekend_minutes = excluded.weekend_minutes, weekday_windows = excluded.weekday_windows,
           weekend_windows = excluded.weekend_windows, updated_at = excluded.updated_at`,
      )
      .run(playerId, s.enabled ? 1 : 0, s.weekdayMinutes, s.weekendMinutes, JSON.stringify(s.weekdayWindows), JSON.stringify(s.weekendWindows), this.env.now());
  }

  usage(playerId: number, day: string): { seconds: number; bonusMinutes: number } {
    const r = this.env.db.q('SELECT seconds, bonus_minutes FROM playtime_usage WHERE player_id = ? AND day = ?').get(playerId, day) as
      | { seconds: number; bonus_minutes: number }
      | undefined;
    return { seconds: r?.seconds ?? 0, bonusMinutes: r?.bonus_minutes ?? 0 };
  }

  private addSeconds(playerId: number, day: string, seconds: number): void {
    if (seconds <= 0) return;
    this.env.db
      .q('INSERT INTO playtime_usage (player_id, day, seconds) VALUES (?, ?, ?) ON CONFLICT(player_id, day) DO UPDATE SET seconds = seconds + excluded.seconds')
      .run(playerId, day, seconds);
  }

  addBonus(playerId: number, minutes: number): number {
    const day = dayKey(this.env.now());
    const cur = this.usage(playerId, day).bonusMinutes;
    const next = Math.max(0, Math.min(600, cur + minutes));
    this.env.db
      .q('INSERT INTO playtime_usage (player_id, day, bonus_minutes) VALUES (?, ?, ?) ON CONFLICT(player_id, day) DO UPDATE SET bonus_minutes = excluded.bonus_minutes')
      .run(playerId, day, next);
    return next;
  }

  /** 记一次心跳；返回实际计入的秒数 */
  heartbeat(playerId: number, seconds: number): { credited: number; ignored: boolean } {
    const now = this.env.now();
    const r = this.row(playerId);
    const last = r?.last_beat_at ?? null;
    if (last !== null && now - last >= 0 && now - last < MIN_BEAT_GAP_MS) return { credited: 0, ignored: true };
    let credit = Math.min(MAX_BEAT_SECONDS, Math.max(0, Math.round(seconds)));
    if (last !== null && now - last >= 0 && now - last <= CONTINUOUS_MS) credit = Math.min(credit, Math.ceil((now - last) / 1000) + 2);
    this.env.db.tx(() => {
      if (r) this.env.db.q('UPDATE playtime_settings SET last_beat_at = ? WHERE player_id = ?').run(now, playerId);
      else
        this.env.db
          .q("INSERT INTO playtime_settings (player_id, enabled, weekday_windows, weekend_windows, last_beat_at, updated_at) VALUES (?, 0, '[]', '[]', ?, ?)")
          .run(playerId, now, now);
      // 跨过午夜的心跳按实际时间拆到前后两天
      const dayStart = startOfDay(now);
      const today = Math.min(credit, Math.floor((now - dayStart) / 1000));
      this.addSeconds(playerId, dayKey(now), today);
      this.addSeconds(playerId, dayKey(dayStart - 1), credit - today);
    });
    return { credited: credit, ignored: false };
  }

  /** 某天（dayStart 为该天 0 点）的允许时间段，单位分钟；全天可玩时返回 [[0, 1440]] */
  private windowsOf(s: PlaytimeSettings, dayStart: number): [number, number][] {
    const ws = isWeekend(dayStart) ? s.weekendWindows : s.weekdayWindows;
    return ws.length ? ws.map((w) => [toMin(w.start), toMin(w.end)]) : [[0, 1440]];
  }

  private limitOf(s: PlaytimeSettings, dayStart: number): number | null {
    return isWeekend(dayStart) ? s.weekendMinutes : s.weekdayMinutes;
  }

  status(playerId: number) {
    const now = this.env.now();
    const s = this.settings(playerId);
    const today = startOfDay(now);
    const u = this.usage(playerId, dayKey(now));
    const base = { enabled: s.enabled, usedToday: u.seconds, bonusMinutesToday: u.bonusMinutes, serverTime: now };
    if (!s.enabled)
      return { ...base, limitToday: null, remaining: null, allowedNow: true, nextAllowedAt: null, windowEndsAt: null, reason: null, message: '', windowsToday: [] as Window[] };

    const limitMin = this.limitOf(s, today);
    const limitToday = limitMin === null ? null : (limitMin + u.bonusMinutes) * 60;
    const remaining = limitToday === null ? null : Math.max(0, limitToday - u.seconds);
    const mod = minuteOfDay(now);
    const wins = this.windowsOf(s, today);
    const cur = wins.find(([a, b]) => a <= mod && mod < b);
    const limitHit = remaining !== null && remaining <= 0;
    const allowedNow = !!cur && !limitHit;
    const reason = limitHit ? 'daily_limit' : !cur ? 'outside_window' : null;

    let nextAllowedAt: number | null = null;
    if (!allowedNow) {
      for (let d = 0; d <= 7 && nextAllowedAt === null; d++) {
        const ds = addDays(today, d);
        if (d === 0 && limitHit) continue;
        if (d > 0 && this.limitOf(s, ds) === 0) continue;
        for (const [a, b] of this.windowsOf(s, ds)) {
          const startAt = Math.max(atMinute(ds, a), d === 0 ? now : 0);
          const endAt = b >= 1440 ? addDays(ds, 1) : atMinute(ds, b);
          if (startAt < endAt) {
            nextAllowedAt = startAt;
            break;
          }
        }
      }
    }
    const windowEndsAt = cur && cur[1] < 1440 ? atMinute(today, cur[1]) : null;
    const fmt = (t: number) => {
      const d = new Date(t);
      const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return t - today < DAY_MS ? `今天 ${hm}` : t - today < 2 * DAY_MS ? `明天 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
    };
    const message =
      reason === 'daily_limit'
        ? `今天的游戏时间用完啦${nextAllowedAt ? `，${fmt(nextAllowedAt)}再来吧` : ''}`
        : reason === 'outside_window'
          ? `现在不是游戏时间${nextAllowedAt ? `，${fmt(nextAllowedAt)}可以玩` : ''}`
          : '';
    const winsToday = (isWeekend(today) ? s.weekendWindows : s.weekdayWindows).slice();
    return { ...base, limitToday, remaining, allowedNow, nextAllowedAt, windowEndsAt, reason, message, windowsToday: winsToday };
  }

  history(playerId: number, days: number): { day: string; seconds: number; bonusMinutes: number }[] {
    const now = this.env.now();
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = dayKey(addDays(startOfDay(now), -i));
      out.push({ day, ...this.usage(playerId, day) });
    }
    return out;
  }
}

export function playtimeRoutes(env: Env, svc: PlaytimeService): Route[] {
  return [
    { method: 'GET', path: '/api/playtime', handler: (c) => svc.status(c.auth().id) },
    {
      method: 'POST',
      path: '/api/playtime/heartbeat',
      handler: async (c) => {
        const p = c.auth();
        const b = await c.body(4_000);
        const r = svc.heartbeat(p.id, num(b.seconds, '秒数', 0, MAX_BEAT_SECONDS));
        return { ...svc.status(p.id), credited: r.credited, ignored: r.ignored };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/players/:id/playtime',
      handler: (c) => {
        const p = playerParam(env, c.params.id);
        return { settings: svc.settings(p.id), status: svc.status(p.id), days: svc.history(p.id, 14) };
      },
    },
    {
      method: 'PUT',
      path: '/api/admin/players/:id/playtime',
      handler: async (c) => {
        const p = playerParam(env, c.params.id);
        const b = await c.body();
        const cur = svc.settings(p.id);
        const next: PlaytimeSettings = {
          enabled: b.enabled !== undefined ? bool(b.enabled, '开关') : cur.enabled,
          weekdayMinutes: b.weekdayMinutes !== undefined ? optNum(b.weekdayMinutes, '工作日时长', 0, 720) : cur.weekdayMinutes,
          weekendMinutes: b.weekendMinutes !== undefined ? optNum(b.weekendMinutes, '周末时长', 0, 720) : cur.weekendMinutes,
          weekdayWindows: b.weekdayWindows !== undefined ? parseWindows(b.weekdayWindows, '工作日时间段') : cur.weekdayWindows,
          weekendWindows: b.weekendWindows !== undefined ? parseWindows(b.weekendWindows, '周末时间段') : cur.weekendWindows,
        };
        svc.saveSettings(p.id, next);
        return { settings: next, status: svc.status(p.id), days: svc.history(p.id, 14) };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/players/:id/playtime/bonus',
      handler: async (c) => {
        const p = playerParam(env, c.params.id);
        const b = await c.body();
        const minutes = num(b.minutes, '分钟数', -240, 240);
        if (minutes === 0) throw new HttpError(400, '分钟数不能为 0');
        const total = svc.addBonus(p.id, minutes);
        return { bonusMinutesToday: total, status: svc.status(p.id) };
      },
    },
  ];
}
