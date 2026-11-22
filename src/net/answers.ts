/**
 * 答题记录队列（API.md §5、§16）。
 * - 每答一题追加一条（客户端生成唯一 id、答题当时的时间戳），按玩家分开持久化；
 * - 在回合结束、对局结束、回到标题页、页面隐藏时批量发送，每批 ≤ 200；
 * - HTTP 200：整批删除（含 duplicates / rejected）；4xx（401 除外）：也删除，避免死循环；
 *   401：保留，重新登录后再发；5xx / 网络错误：保留，指数退避重试；
 * - 上限 5000 条，超出丢最旧的。服务器按 (玩家, id) 去重，"发了没收到响应"直接重发即可。
 */
import { ApiError, isAuthError, type AnswerContext, type AnswerRecord, type AnswersResponse } from './api.ts';
import { KEY_PREFIX, readJSON, realTimers, writeJSON, type KV, type Timers } from './util.ts';

export const MAX_BATCH = 200;
export const MAX_QUEUE = 5000;

const K_DEVICE = KEY_PREFIX + 'device';
const K_SEQ = KEY_PREFIX + 'answer-seq';
const queueKey = (profile: string) => KEY_PREFIX + 'answers:' + profile;

export type SendFn = (batch: AnswerRecord[], keepalive: boolean) => Promise<AnswersResponse>;

export interface AnswerQueueOptions {
  kv: KV;
  send: SendFn;
  now?: () => number;
  timers?: Timers;
  /** 随机数（生成设备前缀用） */
  random?: () => number;
  /** 服务器报告有任务新完成 */
  onTasksCompleted?: (n: number) => void;
  /** 401 */
  onAuthError?: (e: unknown) => void;
  /** 连不上 / 5xx */
  onOffline?: (e: unknown) => void;
}

export interface LogInput {
  context: AnswerContext;
  correct: boolean;
  topicId?: string;
  grade?: number;
  difficulty?: number;
  ms?: number | null;
  levelId?: string;
  customId?: number;
  /** 答题时刻；缺省为现在 */
  at?: number;
}

export interface FlushResult {
  sent: number;
  /** 本次因为错误被保留在队列里的条数 */
  kept: number;
  remaining: number;
  error?: unknown;
}

/** 把一条输入整理成服务器要求的形状（custom 题不带 topicId/grade） */
export function toRecord(id: string, a: LogInput, now: number): AnswerRecord {
  const r: AnswerRecord = { id, correct: !!a.correct, context: a.context, at: Math.floor(a.at ?? now) };
  if (a.customId !== undefined && a.customId !== null) {
    r.context = 'custom';
    r.customId = a.customId;
  } else {
    if (a.topicId !== undefined) r.topicId = a.topicId;
    if (a.grade !== undefined) r.grade = a.grade;
    if (a.difficulty !== undefined) r.difficulty = a.difficulty;
  }
  if (a.ms !== undefined && a.ms !== null && Number.isFinite(a.ms)) r.ms = Math.max(0, Math.round(a.ms));
  if (a.levelId) r.levelId = a.levelId;
  return r;
}

export class AnswerQueue {
  private kv: KV;
  private send: SendFn;
  private now: () => number;
  private timers: Timers;
  private o: AnswerQueueOptions;
  /** 当前玩家的档案键；null = 游客（不记录） */
  private profile: string | null = null;
  private inflight: Promise<FlushResult> | null = null;
  private retryT: unknown = null;
  private backoff = 5000;
  /** 下次自动重试的时刻 */
  nextRetryAt = 0;
  readonly device: string;

  constructor(o: AnswerQueueOptions) {
    this.o = o;
    this.kv = o.kv;
    this.send = o.send;
    this.now = o.now ?? Date.now;
    this.timers = o.timers ?? realTimers;
    let dev = this.kv.get(K_DEVICE);
    if (!dev || !/^[a-z0-9]{4,12}$/.test(dev)) {
      const rnd = o.random ?? Math.random;
      dev = Array.from({ length: 8 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(rnd() * 36)]).join('');
      this.kv.set(K_DEVICE, dev);
    }
    this.device = dev;
  }

  /** 切换玩家（档案键，见 util.profileKey；null = 游客，不记录答题） */
  setProfile(profile: string | null): void {
    if (profile === this.profile) return;
    this.profile = profile === 'guest' ? null : profile;
    this.cancelRetry();
    this.backoff = 5000;
  }

  list(profile = this.profile): AnswerRecord[] {
    return profile ? readJSON<AnswerRecord[]>(this.kv, queueKey(profile), []) : [];
  }

  get size(): number {
    return this.list().length;
  }

  private store(profile: string, list: AnswerRecord[]): void {
    if (list.length) writeJSON(this.kv, queueKey(profile), list);
    else this.kv.del(queueKey(profile));
  }

  private nextId(): string {
    const n = (Number(this.kv.get(K_SEQ)) || 0) + 1;
    this.kv.set(K_SEQ, String(n));
    return `${this.device}-${n.toString(36)}`;
  }

  /** 记一条答题；游客模式下什么也不做（返回 null） */
  log(a: LogInput): AnswerRecord | null {
    if (!this.profile) return null;
    const rec = toRecord(this.nextId(), a, this.now());
    const list = this.list();
    list.push(rec);
    if (list.length > MAX_QUEUE) list.splice(0, list.length - MAX_QUEUE);
    this.store(this.profile, list);
    return rec;
  }

  /**
   * 发送队列（一批批发，直到发完或出错）。与进行中的发送不重叠（返回同一个 Promise）。
   * keepalive：页面隐藏时用，请求在页面关闭后也尽量送达。
   */
  flush(keepalive = false): Promise<FlushResult> {
    if (this.inflight) return this.inflight;
    const p = this.run(keepalive).finally(() => {
      this.inflight = null;
    });
    this.inflight = p;
    return p;
  }

  private async run(keepalive: boolean): Promise<FlushResult> {
    const profile = this.profile;
    let sent = 0;
    if (!profile) return { sent, kept: 0, remaining: 0 };
    for (;;) {
      const all = this.list(profile);
      if (!all.length) {
        this.backoff = 5000;
        this.cancelRetry();
        return { sent, kept: 0, remaining: 0 };
      }
      const batch = all.slice(0, MAX_BATCH);
      let r: AnswersResponse;
      try {
        r = await this.send(batch, keepalive);
      } catch (e) {
        if (e instanceof ApiError && e.kind === 'http' && e.status >= 400 && e.status < 500 && !isAuthError(e)) {
          // 4xx（401 除外）：这一批再发也不会被接受，丢掉
          this.drop(profile, batch);
          continue;
        }
        if (isAuthError(e)) this.o.onAuthError?.(e);
        else {
          this.o.onOffline?.(e);
          this.scheduleRetry();
        }
        return { sent, kept: this.list(profile).length, remaining: this.list(profile).length, error: e };
      }
      this.drop(profile, batch);
      sent += batch.length;
      if (r && r.tasksCompleted > 0) this.o.onTasksCompleted?.(r.tasksCompleted);
      if (this.profile !== profile) return { sent, kept: 0, remaining: this.list(profile).length };
    }
  }

  /** 按 id 删除（发送期间新追加的记录不受影响） */
  private drop(profile: string, batch: AnswerRecord[]): void {
    const ids = new Set(batch.map((b) => b.id));
    this.store(
      profile,
      this.list(profile).filter((r) => !ids.has(r.id)),
    );
  }

  private scheduleRetry(): void {
    this.cancelRetry();
    const ms = this.backoff;
    this.backoff = Math.min(5 * 60_000, this.backoff * 2);
    this.nextRetryAt = this.now() + ms;
    this.retryT = this.timers.setTimeout(() => {
      this.retryT = null;
      void this.flush();
    }, ms);
  }

  private cancelRetry(): void {
    if (this.retryT !== null) this.timers.clearTimeout(this.retryT);
    this.retryT = null;
    this.nextRetryAt = 0;
  }
}
