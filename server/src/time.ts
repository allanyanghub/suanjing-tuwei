/**
 * 本地时间工具。日界线、每周起点（周一）、时间段都按服务器所在时区计算，
 * 时区由环境变量 TZ 决定（容器里请设置 TZ=Asia/Shanghai）。
 */

export const DAY_MS = 86_400_000;

/** 当天 0 点的时间戳 */
export function startOfDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 向后/向前推 n 个自然日后的 0 点（夏令时也正确） */
export function addDays(t: number, n: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

/** 本周一 0 点 */
export function startOfWeek(t: number): number {
  const wd = (new Date(t).getDay() + 6) % 7; // 周一 = 0
  return addDays(t, -wd);
}

/** "YYYY-MM-DD"（本地日期） */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 解析 "YYYY-MM-DD" 为本地 0 点；格式不对返回 null */
export function parseDay(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d.getTime();
}

export const isWeekend = (t: number): boolean => {
  const wd = new Date(t).getDay();
  return wd === 0 || wd === 6;
};

/** 当天已过的分钟数（0..1439） */
export function minuteOfDay(t: number): number {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

/** 当天某分钟对应的时间戳 */
export function atMinute(dayStart: number, minute: number): number {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minute / 60), minute % 60).getTime();
}

export function timeZoneInfo(now: number): { tz: string; tzEnv: string | null; utcOffsetMinutes: number } {
  return {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tzEnv: process.env.TZ ?? null,
    utcOffsetMinutes: -new Date(now).getTimezoneOffset(),
  };
}
