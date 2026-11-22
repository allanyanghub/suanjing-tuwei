/**
 * 游戏时间（API.md §8、§15、§16）。服务器只记录和报告，由客户端执行限制：
 * - 只在对局进行中发心跳（每 ~30 秒，`seconds` = 距上次心跳实际玩了多少秒），暂停 / 页面隐藏时停表；
 * - 对局结束时补发剩余秒数（距上次心跳不足 5 秒会被服务器忽略，就并入下一局的第一次心跳）；
 * - 心跳不排队、不补发：离线期间的时长不计入服务器，只在本地递减 remaining；
 * - 能不能开新局只看 `allowedNow`（`remaining` 可能是 null = 不限，`null <= 0` 在 JS 里是 true，别直接比较）；
 * - 正在进行的对局不打断：到点时发 `limitReached` 事件，游戏打完这一局，但不能再开新局。
 */
import type { Api, HeartbeatResponse, PlaytimeStatus } from './api.ts';
import { Emitter, realTimers, type Timers } from './util.ts';

export interface PlaytimeView {
  /** 现在能不能开新局 */
  allowedNow: boolean;
  /** 今天剩余秒数；null = 不限时长（或家长没开启时间管理） */
  remaining: number | null;
  reason: null | 'daily_limit' | 'outside_window';
  /** 给孩子看的提示（不能玩时） */
  message: string;
  /** 不能玩时，下次可以玩的时刻（本机时钟）；未知为 null */
  nextAllowedAt: number | null;
  /** 当前时间段结束时刻（本机时钟）；全天可玩为 null */
  windowEndsAt: number | null;
  /** 家长开启了时间管理 */
  enabled: boolean;
  /** 数据来自服务器的最新状态（false = 离线时按本地时间推算 / 还没拿到过） */
  fresh: boolean;
}

export interface PlaytimeSnapshot {
  status: PlaytimeStatus;
  /** 拿到状态时的本机时间 */
  fetchedAt: number;
  /** 拿到状态之后本地又玩了多少秒（还没被服务器计入） */
  playedSince: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const dayOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
const minuteOf = (t: number) => {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
};
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/**
 * 纯函数：根据最后一次拿到的服务器状态和本地经过的时间，算出现在的限制。
 * - 没有任何状态（游客 / 从没联网）→ 不限制；
 * - 同一天：remaining 按本地已玩秒数递减；过了 windowEndsAt 视为不在时间段；到了 nextAllowedAt 视为可以玩；
 * - 跨过本地午夜：usedToday 视为归零（"今天用完了"解除），但时间段规则照旧（用 windowsToday 判断）。
 * 时刻都换算到本机时钟（用 serverTime 与 fetchedAt 估计时钟偏差）。
 */
export function evaluatePlaytime(snap: PlaytimeSnapshot | null, now: number, fresh = false): PlaytimeView {
  const open: PlaytimeView = { allowedNow: true, remaining: null, reason: null, message: '', nextAllowedAt: null, windowEndsAt: null, enabled: false, fresh };
  if (!snap) return open;
  const s = snap.status;
  if (!s.enabled) return { ...open, fresh };
  const skew = s.serverTime - snap.fetchedAt; // 服务器 - 本机
  const local = (t: number | null) => (t === null ? null : t - skew);
  const newDay = dayOf(now) !== dayOf(snap.fetchedAt) && now > snap.fetchedAt;

  let remaining: number | null;
  if (s.limitToday === null) remaining = null;
  else if (newDay) remaining = Math.max(0, s.limitToday - s.bonusMinutesToday * 60);
  else remaining = s.remaining === null ? null : Math.max(0, s.remaining - Math.max(0, Math.floor(snap.playedSince)));

  // 时间段
  let inWindow: boolean;
  let windowEndsAt: number | null = null;
  let nextAllowedAt: number | null = null;
  if (!newDay) {
    if (s.allowedNow || s.reason === 'daily_limit') {
      // 拿到状态时在时间段内（daily_limit 时服务器不说时间段，按 windowEndsAt 有无判断）
      const end = local(s.windowEndsAt);
      inWindow = end === null ? s.allowedNow || s.windowsToday.length === 0 || inWindows(s, now) : now < end;
      windowEndsAt = end;
      if (!inWindow) nextAllowedAt = null;
    } else {
      // 拿到状态时不在时间段内：到了 nextAllowedAt 才能玩
      const next = local(s.nextAllowedAt);
      inWindow = next !== null && now >= next;
      nextAllowedAt = inWindow ? null : next;
    }
  } else inWindow = inWindows(s, now);

  const limitHit = remaining !== null && remaining <= 0;
  if (!inWindow) {
    const msg = !newDay && s.reason === 'outside_window' && s.message ? s.message : nextAllowedAt ? `现在不是游戏时间，${hm(nextAllowedAt)} 可以玩` : '现在不是游戏时间';
    return { allowedNow: false, remaining, reason: 'outside_window', message: msg, nextAllowedAt, windowEndsAt: null, enabled: true, fresh };
  }
  if (limitHit) {
    const next = !newDay && s.reason === 'daily_limit' ? local(s.nextAllowedAt) : null;
    const msg = !newDay && s.reason === 'daily_limit' && s.message ? s.message : '今天的游戏时间用完啦';
    return { allowedNow: false, remaining: 0, reason: 'daily_limit', message: msg, nextAllowedAt: next, windowEndsAt: null, enabled: true, fresh };
  }
  return { allowedNow: true, remaining, reason: null, message: '', nextAllowedAt: null, windowEndsAt, enabled: true, fresh };
}

function inWindows(s: PlaytimeStatus, now: number): boolean {
  if (!s.windowsToday.length) return true;
  const m = minuteOf(now);
  return s.windowsToday.some((w) => toMin(w.start) <= m && m < (w.end === '24:00' ? 1440 : toMin(w.end)));
}

// ---------------------------------------------------------------- 运行时

export interface PlaytimeEvents extends Record<string, unknown> {
  /** 状态变了（拿到新状态 / 本地推算变化） */
  change: PlaytimeView;
  /** 对局进行中到达限制（打完这一局，之后不能再开新局） */
  limitReached: PlaytimeView;
}

export interface PlaytimeOptions {
  api: Api;
  now?: () => number;
  timers?: Timers;
  /** 心跳间隔（毫秒），默认 30 秒 */
  beatMs?: number;
  /** 本地检查间隔（毫秒），默认 5 秒 */
  tickMs?: number;
  /** 是否可以联网（已登录） */
  online: () => boolean;
  onError?: (e: unknown) => void;
}

/** 服务器：距上次心跳不足 5 秒的心跳会被整个忽略 */
export const MIN_BEAT_GAP_MS = 5000;
export const MAX_BEAT_SECONDS = 60;

export class Playtime {
  readonly ev = new Emitter<PlaytimeEvents>();
  snap: PlaytimeSnapshot | null = null;
  private api: Api;
  private now: () => number;
  private timers: Timers;
  private beatMs: number;
  private tickMs: number;
  private o: PlaytimeOptions;
  private running = false;
  private paused = false;
  /** 计时起点（上次心跳 / 恢复的时刻） */
  private segStart = 0;
  /** 还没发出去的秒数（暂停前累计的 + 上一局结尾不足 5 秒没发的） */
  private carry = 0;
  /** 上次心跳成功（被服务器收到）的时刻 */
  private lastBeatAt = 0;
  private tickT: unknown = null;
  private beating = false;
  private limitFired = false;
  private fresh = false;
  private lastKey = '';

  constructor(o: PlaytimeOptions) {
    this.o = o;
    this.api = o.api;
    this.now = o.now ?? Date.now;
    this.timers = o.timers ?? realTimers;
    this.beatMs = o.beatMs ?? 30_000;
    this.tickMs = o.tickMs ?? 5000;
  }

  /** 用缓存的状态（离线启动时） */
  restore(snap: PlaytimeSnapshot | null): void {
    this.snap = snap;
    this.fresh = false;
    this.emitChange(true);
  }

  /** 清空（切换玩家 / 游客） */
  reset(): void {
    this.stop(false);
    this.snap = null;
    this.carry = 0;
    this.lastBeatAt = 0;
    this.fresh = false;
    this.emitChange(true);
  }

  /** pending：服务器状态里还没包含的本地秒数（GET 时就是还没发心跳的那部分） */
  private adopt(s: PlaytimeStatus, pending = 0): void {
    this.snap = { status: s, fetchedAt: this.now(), playedSince: pending };
    this.fresh = true;
    this.emitChange();
  }

  /** 拉取最新状态；失败时保留缓存 */
  async refresh(timeoutMs?: number): Promise<PlaytimeView> {
    if (!this.o.online()) return this.view();
    try {
      const s = await this.api.playtime(timeoutMs);
      // GET 不含还没发心跳的本地时间（carry）；正在跑的那一段由 view() 另外加上
      this.adopt(s, this.carry);
    } catch (e) {
      this.fresh = false;
      this.o.onError?.(e);
    }
    return this.view();
  }

  /** 当前限制（含本地推算） */
  view(): PlaytimeView {
    const snap = this.snap ? { ...this.snap, playedSince: this.snap.playedSince + this.runningSeconds() } : null;
    return evaluatePlaytime(snap, this.now(), this.fresh);
  }

  private runningSeconds(): number {
    return this.running && !this.paused ? Math.max(0, (this.now() - this.segStart) / 1000) : 0;
  }

  private unsentSeconds(): number {
    return this.carry + this.runningSeconds();
  }

  /** 对局开始（含购买阶段） */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.limitFired = false;
    this.segStart = this.now();
    this.tickT = this.timers.setInterval(() => this.tick(), this.tickMs);
  }

  /** 暂停 / 页面隐藏时停表；恢复时继续 */
  pause(on: boolean): void {
    if (!this.running || on === this.paused) return;
    if (on) {
      this.carry += this.runningSeconds();
      this.paused = true;
    } else {
      this.paused = false;
      this.segStart = this.now();
    }
  }

  /**
   * 对局结束：补发剩余秒数（距上次心跳不足 5 秒时不发，并入下一局第一次心跳）。
   * sendRest = false 时只停表。
   */
  stop(sendRest = true): Promise<void> {
    if (!this.running) return Promise.resolve();
    const secs = this.unsentSeconds();
    this.running = false;
    this.paused = false;
    if (this.tickT !== null) this.timers.clearInterval(this.tickT);
    this.tickT = null;
    this.carry = secs;
    if (!sendRest) return Promise.resolve();
    if (this.now() - this.lastBeatAt < MIN_BEAT_GAP_MS || secs < 1) return Promise.resolve();
    return this.beat();
  }

  private tick(): void {
    if (!this.running) return;
    const since = this.lastBeatAt ? this.now() - this.lastBeatAt : Infinity;
    if (!this.paused && this.unsentSeconds() * 1000 >= this.beatMs - 500 && since >= MIN_BEAT_GAP_MS) void this.beat();
    else this.emitChange();
  }

  /** 发一次心跳（失败就丢掉这段时间在服务器上的记录，只在本地递减） */
  private async beat(): Promise<void> {
    if (this.beating) return;
    const secs = this.unsentSeconds();
    // 这段时间从"未发"转为"本地已玩"
    if (this.snap) this.snap.playedSince += secs;
    this.carry = 0;
    if (this.running) this.segStart = this.now();
    if (!this.o.online()) {
      this.emitChange();
      return;
    }
    this.beating = true;
    try {
      const r: HeartbeatResponse = await this.api.heartbeat(Math.min(MAX_BEAT_SECONDS, Math.round(secs)));
      this.lastBeatAt = this.now();
      // 请求期间又跑的时间仍在 segStart 之后，由 view() 计入
      this.adopt(r, this.carry);
    } catch (e) {
      this.fresh = false;
      this.o.onError?.(e);
      this.emitChange();
    } finally {
      this.beating = false;
    }
  }

  private emitChange(force = false): void {
    const v = this.view();
    const key = `${v.allowedNow}|${v.remaining === null ? 'n' : Math.ceil(v.remaining / 60)}|${v.reason}|${v.enabled}|${v.fresh}`;
    if (force || key !== this.lastKey) {
      this.lastKey = key;
      this.ev.emit('change', v);
    }
    if (this.running && !v.allowedNow && !this.limitFired) {
      this.limitFired = true;
      this.ev.emit('limitReached', v);
    }
  }
}
