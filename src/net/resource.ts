/**
 * 带本地缓存的只读数据（任务、留言、排行榜、学习小结、设置、家长出题）：
 * 联网时拉取并写入缓存（按玩家分开），离线时用最后一次缓存的数据显示。
 */
import { Emitter, KEY_PREFIX, readJSON, writeJSON, type KV } from './util.ts';

export interface Cached<T> {
  data: T;
  /** 拉取时刻（本机时钟） */
  at: number;
}

export class Resource<T> {
  readonly ev = new Emitter<{ change: T | null }>();
  private profile: string | null = null;
  private mem: Cached<T> | null = null;
  private inflight: Promise<T | null> | null = null;
  private name: string;
  private kv: KV;
  private load: () => Promise<T>;
  private now: () => number;
  /** 拉取失败时调用（交给会话统一处理 401 / 离线） */
  onError: (e: unknown) => void = () => undefined;
  /** 拉取成功后、写缓存前调用（可以加工数据） */
  transform: (v: T) => T = (v) => v;

  constructor(name: string, kv: KV, load: () => Promise<T>, now: () => number = Date.now) {
    this.name = name;
    this.kv = kv;
    this.load = load;
    this.now = now;
  }

  private key(p: string) {
    return `${KEY_PREFIX}cache:${this.name}:${p}`;
  }

  /** 切换玩家（null = 游客：没有数据） */
  setProfile(p: string | null): void {
    const np = p === 'guest' ? null : p;
    if (np === this.profile) return;
    this.profile = np;
    this.inflight = null;
    this.mem = np ? readJSON<Cached<T> | null>(this.kv, this.key(np), null) : null;
    this.ev.emit('change', this.data);
  }

  get data(): T | null {
    return this.mem?.data ?? null;
  }

  get fetchedAt(): number {
    return this.mem?.at ?? 0;
  }

  /** 拉取最新数据；失败返回缓存（可能为 null）。并发调用共用一次请求。 */
  refresh(): Promise<T | null> {
    if (!this.profile) return Promise.resolve(null);
    if (this.inflight) return this.inflight;
    const p = this.profile;
    const run = this.load()
      .then((v) => {
        if (this.profile !== p) return this.data;
        const d = this.transform(v);
        this.mem = { data: d, at: this.now() };
        writeJSON(this.kv, this.key(p), this.mem);
        this.ev.emit('change', d);
        return d;
      })
      .catch((e: unknown) => {
        this.onError(e);
        return this.profile === p ? this.data : null;
      })
      .finally(() => {
        if (this.inflight === run) this.inflight = null;
      });
    this.inflight = run;
    return run;
  }

  /** 本地修改缓存（例如离线时按 remainingCorrect 递减） */
  update(fn: (v: T) => T): void {
    if (!this.profile || !this.mem) return;
    this.mem = { data: fn(this.mem.data), at: this.mem.at };
    writeJSON(this.kv, this.key(this.profile), this.mem);
    this.ev.emit('change', this.mem.data);
  }
}
