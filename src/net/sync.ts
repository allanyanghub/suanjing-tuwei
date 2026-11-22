/**
 * 存档同步（服务器规则见 API.md §3：`baseVersion` 等于服务器当前版本时以客户端为准、星级和统计取较大值；
 * 否则两边取并集）。
 *
 * 本地存档分"档案"保存：每位玩家一份（键 `suanjing-online-save:p:<名字小写>`），离线游客一份（`…:guest`）。
 * 游戏本身只认识一个存档对象（`src/core/save.ts` 的 `save`），切换玩家时把当前存档收进它主人的档案，
 * 再把新玩家的档案写进 `save`（`settings` 是本设备的设置，从不上传，也不随玩家切换）。
 * 这样两个孩子共用一台平板时互相看不到、也覆盖不了对方的进度。
 *
 * 原来单机玩出来的进度属于"游客"档案。某个孩子第一次在这台设备上登录时，如果游客档案里有进度，
 * 会询问是否合并到他的账号（用过期的 baseVersion 提交，让服务器取并集）——绝不悄悄丢掉。
 */
import { cleanRank, mergeRank, seedRank, type RankState } from '../core/rank.ts';
import { isRetryable, type Api, type SaveBlob, type SaveResponse, type SaveWrong } from './api.ts';
import type { Session } from './session.ts';
import { Emitter, KEY_PREFIX, profileKey, readJSON, realTimers, writeJSON, type KV, type Timers } from './util.ts';

/** 游戏存档的读写适配器（见 live-save.ts）。write 只改进度字段，不碰 settings，并负责持久化。 */
export interface LiveSave {
  read(): SaveBlob;
  write(data: SaveBlob): void;
}

/** 某个档案在本设备上的缓存 */
export interface ProfileCache {
  data: SaveBlob;
  /** 这份数据基于服务器的哪个版本（从没同步过为 0） */
  baseVersion: number;
  /** 有还没传到服务器的本地改动 */
  dirty: boolean;
}

export type SyncStatus = 'guest' | 'idle' | 'syncing' | 'synced' | 'pending';

export interface SyncEvents extends Record<string, unknown> {
  status: SyncStatus;
  /** 游戏的存档对象被换成了另一份（切换玩家 / 采用了服务器合并后的数据）——界面应重新渲染 */
  swap: { key: string; reason: 'activate' | 'server' };
}

export const MAX_WRONG = 200;

export function emptyBlob(): SaveBlob {
  return { stars: {}, wrong: [], agent: 'ling', mapChoice: {}, stats: { answered: 0, correct: 0, kills: 0, wins: 0 }, rank: { pts: 0, best: 0, n: 0 } };
}

/** 存档里的段位（旧存档没有时按已有进度补一个起始段位） */
export const rankOf = (b: SaveBlob): RankState => cleanRank(b.rank, () => seedRank(b.stats, b.stars));

const sameBlob = (a: SaveBlob, b: SaveBlob): boolean => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function hasProgress(b: SaveBlob | null | undefined): boolean {
  if (!b) return false;
  return Object.values(b.stars).some((v) => v > 0) || b.stats.answered > 0 || b.stats.kills > 0 || b.stats.wins > 0 || b.wrong.length > 0 || (b.rank?.n ?? 0) > 0;
}

export function progressSummary(b: SaveBlob): { levels: number; stars: number; answered: number; wrong: number } {
  const v = Object.values(b.stars);
  return { levels: v.filter((x) => x > 0).length, stars: v.reduce((a, x) => a + x, 0), answered: b.stats.answered, wrong: b.wrong.length };
}

// ---------------------------------------------------------------- 纯函数（单元测试覆盖）

export type ReconcileDecision = { kind: 'adopt' } | { kind: 'push'; data: SaveBlob; baseVersion: number; why: string };

/**
 * 登录后拿到服务器存档时怎么做。
 * - 合并游客进度：用 -1 作 baseVersion 提交游客数据（服务器取并集）；
 * - 本地有未上传的改动：按本地的 baseVersion 提交（版本相同 = 快进，不同 = 服务器取并集）；
 * - 本地比服务器"还新"（服务器被恢复 / 重建过）：用 -1 提交取并集；
 * - 否则直接采用服务器版本。
 */
export function reconcile(local: ProfileCache | null, serverVersion: number, guest: SaveBlob | null): ReconcileDecision {
  if (guest) return { kind: 'push', data: local ? unionBlobs(local.data, guest) : clone(guest), baseVersion: -1, why: 'merge-guest' };
  if (!local) return { kind: 'adopt' };
  if (local.dirty) return { kind: 'push', data: local.data, baseVersion: local.baseVersion, why: local.baseVersion === serverVersion ? 'fast-forward' : 'stale' };
  if (local.baseVersion > serverVersion && hasProgress(local.data)) return { kind: 'push', data: local.data, baseVersion: -1, why: 'server-behind' };
  return { kind: 'adopt' };
}

const wrongKey = (w: SaveWrong) => `${w.time}|${w.q.text}`;

function sortCapWrong(list: SaveWrong[]): SaveWrong[] {
  const out = list.slice().sort((a, b) => b.time - a.time);
  out.length = Math.min(out.length, MAX_WRONG);
  return out;
}

/** 两份存档取并集（与服务器 mergeSaves(fastForward=false) 相同的规则） */
export function unionBlobs(a: SaveBlob, b: SaveBlob): SaveBlob {
  const out = emptyBlob();
  for (const k of new Set([...Object.keys(a.stars), ...Object.keys(b.stars)])) out.stars[k] = Math.max(a.stars[k] ?? 0, b.stars[k] ?? 0);
  out.stats = {
    answered: Math.max(a.stats.answered, b.stats.answered),
    correct: Math.max(a.stats.correct, b.stats.correct),
    kills: Math.max(a.stats.kills, b.stats.kills),
    wins: Math.max(a.stats.wins, b.stats.wins),
  };
  out.rank = mergeRank(rankOf(a), rankOf(b));
  out.agent = a.agent || b.agent;
  out.mapChoice = { ...b.mapChoice, ...a.mapChoice };
  const seen = new Set<string>();
  const wrong: SaveWrong[] = [];
  for (const w of [...a.wrong, ...b.wrong]) {
    const k = wrongKey(w);
    if (seen.has(k)) continue;
    seen.add(k);
    wrong.push(w);
  }
  out.wrong = sortCapWrong(wrong);
  return out;
}

/**
 * 提交存档的请求在路上时本地又有了改动：把服务器返回的结果（可能并入了别的设备的进度）
 * 与本地最新数据做三方合并——只引入服务器"新增"的东西（不在 sent 里的），本地删掉的错题不会复活。
 */
export function mergeIntervening(sent: SaveBlob, server: SaveBlob, local: SaveBlob): SaveBlob {
  const out = clone(local);
  for (const [k, v] of Object.entries(server.stars)) out.stars[k] = Math.max(out.stars[k] ?? 0, v);
  out.stats = {
    answered: Math.max(local.stats.answered, server.stats.answered),
    correct: Math.max(local.stats.correct, server.stats.correct),
    kills: Math.max(local.stats.kills, server.stats.kills),
    wins: Math.max(local.stats.wins, server.stats.wins),
  };
  out.rank = mergeRank(rankOf(local), rankOf(server));
  for (const [k, v] of Object.entries(server.mapChoice)) if (!(k in sent.mapChoice) && !(k in out.mapChoice)) out.mapChoice[k] = v;
  const sentKeys = new Set(sent.wrong.map(wrongKey));
  const localKeys = new Set(local.wrong.map(wrongKey));
  const added = server.wrong.filter((w) => !sentKeys.has(wrongKey(w)) && !localKeys.has(wrongKey(w)));
  out.wrong = sortCapWrong([...out.wrong, ...added]);
  return out;
}

// ---------------------------------------------------------------- 同步器

const K_ACTIVE = KEY_PREFIX + 'active-profile';
const K_GUEST_META = KEY_PREFIX + 'guest-meta';
const saveKey = (k: string) => KEY_PREFIX + 'save:' + k;

interface GuestMeta {
  /** 游客进度已经合并给了谁 */
  claimedBy: string | null;
  /** 哪些孩子选了"不合并"（不再问他们） */
  declinedBy: string[];
}

export interface SaveSyncOptions {
  api: Api;
  kv: KV;
  live: LiveSave;
  session: Session;
  timers?: Timers;
  /** markDirty 之后多久推送（毫秒） */
  debounceMs?: number;
}

export class SaveSync {
  readonly ev = new Emitter<SyncEvents>();
  status: SyncStatus = 'idle';
  /** 当前写在游戏存档里的是哪个档案 */
  activeKey: string;
  private api: Api;
  private kv: KV;
  private live: LiveSave;
  private session: Session;
  private timers: Timers;
  private debounceMs: number;
  /** 本档案已经和服务器对过账（之后才允许推送） */
  private started = false;
  private inflight: Promise<void> | null = null;
  private again = false;
  private debounceT: unknown = null;
  private retryT: unknown = null;
  private backoff = 5000;

  constructor(o: SaveSyncOptions) {
    this.api = o.api;
    this.kv = o.kv;
    this.live = o.live;
    this.session = o.session;
    this.timers = o.timers ?? realTimers;
    this.debounceMs = o.debounceMs ?? 3000;
    this.activeKey = o.kv.get(K_ACTIVE) ?? 'guest';
    this.boot();
  }

  /**
   * 启动时核对：游戏存档本应等于当前档案的缓存（每次写入都会 persist）。如果游戏存档是空的而档案里有进度
   * （游戏存档的键被改了 / 被单独清掉了），以档案为准写回去，避免把空存档当成"改动"推上服务器。
   */
  private boot(): void {
    const c = this.getCache(this.activeKey);
    if (c && hasProgress(c.data) && !hasProgress(this.live.read())) this.live.write(c.data);
  }

  // ---- 档案 ----

  getCache(key: string): ProfileCache | null {
    const c = readJSON<ProfileCache | null>(this.kv, saveKey(key), null);
    return c && c.data ? c : null;
  }

  private setCache(key: string, c: ProfileCache): void {
    writeJSON(this.kv, saveKey(key), c);
  }

  hasProfile(name: string | null): boolean {
    return this.getCache(profileKey(name)) !== null;
  }

  /** 把游戏存档的当前内容收进当前档案；有变化就记为待上传 */
  capture(): ProfileCache {
    const cur = this.live.read();
    const c = this.getCache(this.activeKey);
    if (!c) {
      const fresh = { data: cur, baseVersion: 0, dirty: this.activeKey !== 'guest' && hasProgress(cur) };
      this.setCache(this.activeKey, fresh);
      return fresh;
    }
    if (!sameBlob(c.data, cur)) {
      c.data = cur;
      c.dirty = true;
      this.setCache(this.activeKey, c);
    }
    return c;
  }

  /** 把游戏存档切换到某位玩家（null = 游客）的档案 */
  activate(name: string | null): void {
    const key = profileKey(name);
    if (key === this.activeKey) {
      this.capture();
      return;
    }
    this.cancelTimers();
    this.capture();
    const next = this.getCache(key);
    this.live.write(next ? next.data : emptyBlob());
    this.activeKey = key;
    this.kv.set(K_ACTIVE, key);
    if (!next) this.setCache(key, { data: this.live.read(), baseVersion: 0, dirty: false });
    this.started = false;
    this.setStatus(key === 'guest' ? 'guest' : 'idle');
    this.ev.emit('swap', { key, reason: 'activate' });
  }

  // ---- 游客进度合并 ----

  private guestMeta(): GuestMeta {
    return readJSON<GuestMeta>(this.kv, K_GUEST_META, { claimedBy: null, declinedBy: [] });
  }

  /** 这位（刚在本设备第一次登录的）玩家是否应该被询问合并游客进度；返回游客进度摘要 */
  guestOfferFor(name: string): ReturnType<typeof progressSummary> | null {
    const g = this.getCache('guest');
    const meta = this.guestMeta();
    if (!g || !hasProgress(g.data) || meta.claimedBy !== null || meta.declinedBy.includes(name.toLowerCase())) return null;
    return progressSummary(g.data);
  }

  declineGuest(name: string): void {
    const m = this.guestMeta();
    if (!m.declinedBy.includes(name.toLowerCase())) m.declinedBy.push(name.toLowerCase());
    writeJSON(this.kv, K_GUEST_META, m);
  }

  // ---- 和服务器对账 ----

  private canSync(): boolean {
    const p = this.session.player;
    return this.session.state === 'signedIn' && !!p && profileKey(p.name) === this.activeKey;
  }

  /**
   * 登录后（或断线重连后）调用：拉取服务器存档并与本地对账。
   * mergeGuest = true 时把游客档案并入（只在孩子同意后）。
   */
  async start(mergeGuest = false): Promise<void> {
    if (!this.canSync()) return;
    const key = this.activeKey;
    const name = this.session.player!.name;
    this.setStatus('syncing');
    let srv: SaveResponse;
    try {
      srv = await this.api.getSave();
    } catch (e) {
      this.session.handle(e);
      this.setStatus(this.activeKey === 'guest' ? 'guest' : 'pending');
      if (isRetryable(e)) this.scheduleRetry(() => void this.start(mergeGuest));
      return;
    }
    if (this.activeKey !== key) return;
    const local = this.capture();
    const guest = mergeGuest ? this.getCache('guest')?.data ?? null : null;
    const d = reconcile(local.baseVersion === 0 && !local.dirty && !hasProgress(local.data) ? null : local, srv.version, guest);
    if (mergeGuest) {
      const m = this.guestMeta();
      m.claimedBy = name.toLowerCase();
      writeJSON(this.kv, K_GUEST_META, m);
    }
    this.started = true;
    if (d.kind === 'adopt') {
      this.adoptServer(key, srv);
      this.setStatus('synced');
      return;
    }
    this.live.write(d.data);
    this.setCache(key, { data: this.live.read(), baseVersion: d.baseVersion, dirty: true });
    if (guest) this.ev.emit('swap', { key, reason: 'server' });
    await this.push();
  }

  private adoptServer(key: string, srv: SaveResponse): void {
    const before = this.live.read();
    this.live.write(srv.data);
    const data = this.live.read();
    this.setCache(key, { data, baseVersion: srv.version, dirty: false });
    if (!sameBlob(before, data)) this.ev.emit('swap', { key, reason: 'server' });
  }

  /** 游戏存档有改动（防抖后推送） */
  markDirty(): void {
    const c = this.capture();
    if (!this.canSync() || !this.started) {
      if (this.activeKey !== 'guest' && c.dirty) this.setStatus('pending');
      return;
    }
    if (this.debounceT !== null) this.timers.clearTimeout(this.debounceT);
    this.debounceT = this.timers.setTimeout(() => {
      this.debounceT = null;
      void this.push();
    }, this.debounceMs);
  }

  /** 立刻推送（对局结束、页面隐藏等时机）。不会与正在进行的推送重叠。 */
  async push(): Promise<void> {
    if (this.inflight) {
      this.again = true;
      return this.inflight;
    }
    const c = this.capture();
    if (!this.canSync() || !this.started) {
      if (this.activeKey !== 'guest' && c.dirty) this.setStatus('pending');
      return;
    }
    const key = this.activeKey;
    const entry = this.getCache(key)!;
    if (!entry.dirty) {
      this.setStatus('synced');
      return;
    }
    if (this.debounceT !== null) {
      this.timers.clearTimeout(this.debounceT);
      this.debounceT = null;
    }
    const sent = clone(entry.data);
    this.setStatus('syncing');
    const run = (async () => {
      let r: SaveResponse;
      try {
        r = await this.api.putSave(entry.baseVersion, sent);
      } catch (e) {
        this.session.handle(e);
        this.setStatus('pending');
        if (isRetryable(e)) this.scheduleRetry(() => void this.push());
        return;
      }
      this.backoff = 5000;
      if (this.activeKey === key) this.capture();
      const cur = this.getCache(key)!;
      if (sameBlob(cur.data, sent)) {
        if (this.activeKey === key) this.adoptServer(key, r);
        else this.setCache(key, { data: r.data, baseVersion: r.version, dirty: false });
      } else {
        const merged = mergeIntervening(sent, r.data, cur.data);
        if (this.activeKey === key) {
          this.live.write(merged);
          this.setCache(key, { data: this.live.read(), baseVersion: r.version, dirty: true });
          this.again = true;
        } else this.setCache(key, { data: merged, baseVersion: r.version, dirty: true });
      }
      if (this.activeKey === key) this.setStatus(this.getCache(key)!.dirty ? 'pending' : 'synced');
    })();
    this.inflight = run;
    try {
      await run;
    } finally {
      this.inflight = null;
    }
    if (this.again) {
      this.again = false;
      if (this.canSync()) await this.push();
    }
  }

  /** 登出 / 令牌失效：停止同步（本地档案保留） */
  stop(): void {
    this.started = false;
    this.cancelTimers();
    this.capture();
    this.setStatus(this.activeKey === 'guest' ? 'guest' : this.getCache(this.activeKey)?.dirty ? 'pending' : 'idle');
  }

  /** 当前档案有没有没传上去的改动 */
  get dirty(): boolean {
    return this.getCache(this.activeKey)?.dirty ?? false;
  }

  private scheduleRetry(fn: () => void): void {
    if (this.retryT !== null) this.timers.clearTimeout(this.retryT);
    const ms = this.backoff;
    this.backoff = Math.min(60_000, this.backoff * 2);
    this.retryT = this.timers.setTimeout(() => {
      this.retryT = null;
      fn();
    }, ms);
  }

  private cancelTimers(): void {
    if (this.debounceT !== null) this.timers.clearTimeout(this.debounceT);
    if (this.retryT !== null) this.timers.clearTimeout(this.retryT);
    this.debounceT = this.retryT = null;
  }

  private setStatus(s: SyncStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.ev.emit('status', s);
  }
}
