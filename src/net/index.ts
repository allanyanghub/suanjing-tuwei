/**
 * 联网层门面 `online`：游戏其余部分只通过它和家庭服务器打交道。
 *
 * 设计原则：
 * - 所有方法在离线 / 游客模式下都是安全的空操作（不抛错、不阻塞），游戏照旧单机运行；
 * - 返回 Promise 的方法永不 reject；
 * - 服务器文本一律是纯文本，界面必须用 textContent 显示。
 *
 * 接入点（详见各方法注释）：
 *   启动            await online.init()；online.needsLogin 为 true 时先显示登录页（src/ui/online/login.ts）
 *   开局前          const r = await online.beforeMatch(level)；r.allowed 为 false 时不开局并显示 r.reason
 *   对局开始 / 暂停 online.matchStarted()；online.matchPaused(true/false)
 *   出门槛题        online.gateQuestion({ level, generate })
 *   每答一题        online.logAnswer({ q, correct, context, ms, levelId, customId })
 *   回合结束        online.roundEnded()
 *   对局结束        online.matchEnded()（在 persist() 之后）
 *   存档有改动      online.saveChanged()（每次 persist() 之后调用即可）
 *   回到标题页      online.refreshTitle()
 */
import { ALL_TOPICS } from '../math/index.ts';
import { LEVELS } from '../data/defs.ts';
import { Api, errorText, isAuthError, isOffline, resolveApiBase, type AnswerContext, type CustomQuestion, type Leaderboard, type MyReport, type ParentMessage, type Player, type ServerSettings, type Task } from './api.ts';
import { AnswerQueue } from './answers.ts';
import { buildCatalog } from './catalog.ts';
import { CustomStore } from './custom.ts';
import { gameLiveSave } from './live-save.ts';
import { leaderboardResource } from './leaderboard.ts';
import { MessageStore } from './messages.ts';
import { Playtime, type PlaytimeSnapshot, type PlaytimeView } from './playtime.ts';
import { matchOptionsFor, pickGateQuestion, questionRates, type GatePick, type MatchOptions, type QuestionLike } from './profile.ts';
import { reportResource } from './report.ts';
import { Resource } from './resource.ts';
import { Session, type OnlineState } from './session.ts';
import { SaveSync, progressSummary, type LiveSave, type SyncStatus } from './sync.ts';
import { TaskStore } from './tasks.ts';
import { Emitter, KEY_PREFIX, browserKV, profileKey, readJSON, writeJSON, type KV } from './util.ts';

export type { OnlineState } from './session.ts';
export type { SyncStatus, LiveSave } from './sync.ts';
export type { PlaytimeView } from './playtime.ts';
export type { MatchOptions, GatePick, GateSource } from './profile.ts';
export type { Player, Task, ParentMessage, MyReport, Leaderboard, CustomQuestion, ServerSettings, AnswerContext, BoardMetric } from './api.ts';
export { ApiError, errorText } from './api.ts';

/** 游客进度摘要（询问是否合并时显示） */
export type MergeOffer = ReturnType<typeof progressSummary>;

export interface OnlineEvents extends Record<string, unknown> {
  /** 联网状态 / 当前玩家变了 */
  state: { state: OnlineState; player: Player | null; guest: boolean };
  /** 存档同步状态（已同步 / 同步中 / 离线稍后同步 / 游客） */
  sync: SyncStatus;
  /** 游戏存档对象被换成了另一份（切换玩家、采用服务器合并结果）：标题页等应重新渲染 */
  saveSwapped: { reason: 'activate' | 'server' };
  tasks: Task[];
  /** 有任务刚完成，需要播放庆祝（播放后调用 online.celebrated(id)） */
  celebrate: Task[];
  messages: ParentMessage[];
  playtime: PlaytimeView;
  /** 对局进行中到达游戏时间限制：打完这一局，但不能再开新局 */
  limitReached: PlaytimeView;
  /** 登录失效（家长重置了密码等），需要重新登录 */
  authLost: { player: Player | null; reason: string | null };
  /** 刚登录的孩子可以合并这台设备上的离线进度（登录页会询问） */
  mergeOffer: MergeOffer;
  custom: CustomQuestion[];
  report: MyReport | null;
  leaderboard: Leaderboard | null;
}

export interface OnlineInitOptions {
  /** 游戏存档适配器；默认是 src/core/save.ts 的 save */
  live?: LiveSave;
  /** 接口地址前缀；默认按 ?api= / localStorage['suanjing-api-base'] / 同源 决定 */
  apiBase?: string;
  kv?: KV;
  fetch?: typeof fetch;
}

export interface SignInResult {
  player: Player;
  /** 非 null 时应询问"是否把这台设备上的离线进度合并到你的账号"，然后调用 resolveMerge */
  mergeOffer: MergeOffer | null;
}

export interface BeforeMatchResult {
  /** 能否开新局 */
  allowed: boolean;
  /** 不能开局时给孩子看的中文提示 */
  reason?: string;
  /** 开局参数（缺省字段 = 游戏默认） */
  options: MatchOptions;
  playtime: PlaytimeView;
}

export interface LogAnswerInput {
  /** 题目（取 topicId / grade / difficulty）；也可以直接给这三个字段 */
  q?: { topicId: string; grade: number; difficulty: number };
  topicId?: string;
  grade?: number;
  difficulty?: number;
  correct: boolean;
  /** gate 门槛题 · bonus 加分题 · plant 安放 · defuse 拆除 · revive 复活 · practice 练习/错题本 · custom 家长出题 */
  context: AnswerContext;
  /** 用时（毫秒） */
  ms?: number;
  levelId?: string;
  /** 家长出题的 id（gateQuestion 返回的 customId）；给了就按 custom 记录 */
  customId?: number;
  /** 答题时刻，缺省为现在 */
  at?: number;
}

export interface GateQuestionOptions<Q extends QuestionLike> {
  level: { id: string; topicIds: readonly string[] };
  /** 正常出题（例如 () => match.nextQuestion(1)） */
  generate: () => Q;
  rng?: () => number;
  /** 本回合 / 最近出过的题干，尽量不重复 */
  recentTexts?: readonly string[];
  recentCustomIds?: readonly number[];
}

const K_PLAYTIME = (p: string) => `${KEY_PREFIX}cache:playtime:${p}`;
const PROBE_MS = 20_000;
/** 已登录时每隔多久确认一次登录还有效（同一账号在别处登录会把这台挤下线） */
const SESSION_CHECK_MS = 20_000;

/** 最多等 ms 毫秒；超时返回 undefined（请求本身继续，结果进缓存） */
function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(undefined);
      },
    );
  });
}

class Online {
  private ev = new Emitter<OnlineEvents>();
  private inited = false;
  private kv!: KV;
  private live!: LiveSave;
  api!: Api;
  session!: Session;
  sync!: SaveSync;
  answers!: AnswerQueue;
  playtimeSvc!: Playtime;
  /** 任务（UI 组件用） */
  tasks!: TaskStore;
  /** 家长留言（UI 组件用） */
  messages!: MessageStore;
  /** 家长出题（UI / gateQuestion 用） */
  custom!: CustomStore;
  /** 个人设置缓存 */
  settingsRes!: Resource<ServerSettings>;
  /** 学习小结（UI 组件用） */
  report!: Resource<MyReport>;
  /** 排行榜（UI 组件用） */
  leaderboard!: Resource<Leaderboard>;
  private pendingMerge: string | null = null;
  private probeT: ReturnType<typeof setInterval> | null = null;
  private probing: Promise<OnlineState> | null = null;
  private catalogSent = new Set<string>();
  private inMatch = false;
  private gamePaused = false;
  private initPromise: Promise<OnlineState> | null = null;

  // ------------------------------------------------------------ 状态

  /** 联网状态：unknown（还没探测）/ offline / signedOut / signedIn */
  get state(): OnlineState {
    return this.inited ? this.session.state : 'unknown';
  }

  /** 当前玩家（离线但记得是谁时也有值）；游客为 null */
  get player(): Player | null {
    return this.inited && !this.session.guest && this.session.token ? this.session.player : null;
  }

  /**
   * 游戏存档里现在是谁的进度（登录失效后 player 为 null，但存档仍是他的，直到有人重新登录或选择离线游玩）
   */
  get profileName(): string | null {
    if (!this.inited || this.sync.activeKey === 'guest') return null;
    return this.session.player?.name ?? null;
  }

  /** 正在以离线游客身份玩（不保存到服务器） */
  get isGuest(): boolean {
    return !this.player;
  }

  /** 需要先显示登录页（服务器在、没登录、也没选离线游玩） */
  get needsLogin(): boolean {
    return this.inited && this.session.state === 'signedOut' && !this.session.guest;
  }

  /** 存档同步状态 */
  get syncStatus(): SyncStatus {
    if (!this.inited || this.isGuest) return 'guest';
    return this.sync.status;
  }

  /** 此设备上次登录的玩家名 */
  get lastPlayer(): string | null {
    return this.inited ? this.session.lastPlayer : null;
  }

  /** 当前设置（家长设置；游客为 null） */
  get settings(): ServerSettings | null {
    return this.inited && this.player ? this.settingsRes.data : null;
  }

  /** 订阅事件，返回取消订阅函数 */
  on<K extends keyof OnlineEvents>(k: K, cb: (v: OnlineEvents[K]) => void): () => void {
    return this.ev.on(k, cb);
  }

  // ------------------------------------------------------------ 启动

  /**
   * 启动：探测服务器（/api/health，有令牌时再 /api/me），切换到对应玩家的本地存档，
   * 已登录时在后台同步存档、上传目录、发送离线答题、拉取设置 / 留言 / 任务 / 游戏时间。
   * 重复调用返回同一个 Promise。永不 reject。
   */
  init(opts: OnlineInitOptions = {}): Promise<OnlineState> {
    if (!this.initPromise) this.initPromise = this.doInit(opts);
    return this.initPromise;
  }

  private async doInit(opts: OnlineInitOptions): Promise<OnlineState> {
    this.kv = opts.kv ?? browserKV();
    this.live = opts.live ?? gameLiveSave;
    const search = typeof location !== 'undefined' ? location.search : '';
    this.api = new Api({ base: opts.apiBase ?? resolveApiBase(search, this.kv), token: () => this.session?.token ?? null, fetch: opts.fetch });
    this.session = new Session(this.api, this.kv);
    // 离线状态下有请求成功了（例如答题队列的重试）：马上重新探测，恢复同步
    this.api.onReachable = () => {
      if (this.session?.state === 'offline' && !this.probing) setTimeout(() => void this.retryConnection(), 0);
    };
    this.sync = new SaveSync({ api: this.api, kv: this.kv, live: this.live, session: this.session });
    this.answers = new AnswerQueue({
      kv: this.kv,
      send: (b, keep) => this.api.postAnswers(b, keep),
      onTasksCompleted: () => void this.refreshTasks(),
      onAuthError: (e) => void this.session.handle(e),
      onOffline: (e) => this.session.handle(e),
    });
    this.playtimeSvc = new Playtime({ api: this.api, online: () => this.session.state === 'signedIn' && !!this.player, onError: (e) => this.session.handle(e) });
    this.tasks = new TaskStore(this.api, this.kv);
    this.messages = new MessageStore(this.api, this.kv);
    this.custom = new CustomStore(this.api, this.kv);
    this.custom.queueEmpty = () => this.answers.size === 0;
    this.settingsRes = new Resource<ServerSettings>('settings', this.kv, async () => (await this.api.settingsMe(5000)).settings);
    this.report = reportResource(this.api, this.kv);
    this.leaderboard = leaderboardResource(this.api, this.kv);
    for (const r of [this.tasks.res, this.messages.res, this.custom.res, this.settingsRes, this.report, this.leaderboard] as Resource<unknown>[])
      r.onError = (e) => this.session.handle(e);
    this.tasks.res.ev.on('change', (v) => this.ev.emit('tasks', v ?? []));
    this.messages.res.ev.on('change', (v) => this.ev.emit('messages', v ?? []));
    this.custom.res.ev.on('change', () => this.ev.emit('custom', this.custom.pending()));
    this.report.ev.on('change', (v) => this.ev.emit('report', v));
    this.leaderboard.ev.on('change', (v) => this.ev.emit('leaderboard', v));
    this.playtimeSvc.ev.on('change', (v) => {
      const p = this.player;
      if (p && this.playtimeSvc.snap) writeJSON(this.kv, K_PLAYTIME(profileKey(p.name)), this.playtimeSvc.snap);
      this.ev.emit('playtime', v);
    });
    this.playtimeSvc.ev.on('limitReached', (v) => this.ev.emit('limitReached', v));
    this.sync.ev.on('status', (s) => this.ev.emit('sync', this.isGuest ? 'guest' : s));
    this.sync.ev.on('swap', (s) => this.ev.emit('saveSwapped', { reason: s.reason }));
    this.session.ev.on('change', (s) => {
      this.ev.emit('state', { state: s.state, player: this.player, guest: this.isGuest });
      if (s.state === 'offline') this.startProbe();
      else this.stopProbe();
    });
    this.session.ev.on('authLost', (v) => {
      this.sync.stop();
      this.ev.emit('authLost', v);
      this.ev.emit('sync', this.syncStatus);
    });
    this.inited = true;

    // 记得的玩家：先切到他的本地存档（离线时也以他的身份继续玩）；否则是游客
    this.useProfile(this.session.token ? this.session.player?.name ?? null : null);
    this.installPageHooks();

    const st = await this.session.probe();
    if (st === 'offline' && !this.session.token) this.session.guest = true;
    if (st === 'signedOut' && this.sync.activeKey !== 'guest') this.useProfile(null);
    if (st === 'signedIn') void this.startOnline(false);
    this.ev.emit('state', { state: st, player: this.player, guest: this.isGuest });
    this.ev.emit('sync', this.syncStatus);
    return st;
  }

  /** 切换本地档案与各缓存到某位玩家（null = 游客） */
  private useProfile(name: string | null): void {
    const key = profileKey(name);
    this.sync.activate(name);
    this.answers.setProfile(name === null ? null : key);
    for (const s of [this.tasks, this.messages, this.custom]) s.setProfile(name === null ? null : key);
    for (const r of [this.settingsRes, this.report, this.leaderboard] as Resource<unknown>[]) r.setProfile(name === null ? null : key);
    this.playtimeSvc.reset();
    if (name !== null) this.playtimeSvc.restore(readJSON<PlaytimeSnapshot | null>(this.kv, K_PLAYTIME(key), null));
  }

  /** 已登录：对账存档 → 发送答题 → 上传目录 → 拉取设置 / 留言 / 任务 / 游戏时间 / 家长出题 */
  private async startOnline(mergeGuest: boolean): Promise<void> {
    const p = this.player;
    if (!p || this.session.state !== 'signedIn') return;
    const key = profileKey(p.name);
    if (!this.catalogSent.has(key)) {
      this.catalogSent.add(key);
      void this.api.putCatalog(buildCatalog(ALL_TOPICS, LEVELS)).catch((e: unknown) => {
        this.catalogSent.delete(key);
        this.session.handle(e);
      });
    }
    await this.sync.start(mergeGuest);
    await this.answers.flush();
    await Promise.all([this.settingsRes.refresh(), this.messages.refresh(), this.refreshTasks(), this.playtimeSvc.refresh(), this.custom.refresh()]);
  }

  private startProbe(): void {
    if (this.probeT !== null || typeof setInterval === 'undefined') return;
    this.probeT = setInterval(() => void this.retryConnection(), PROBE_MS);
  }

  private stopProbe(): void {
    if (this.probeT !== null) clearInterval(this.probeT);
    this.probeT = null;
  }

  /** 重新探测服务器（离线时自动每 20 秒一次；登录页的"重试"按钮也调用它） */
  retryConnection(): Promise<OnlineState> {
    if (!this.inited) return Promise.resolve('unknown');
    if (this.probing) return this.probing;
    const was = this.session.state;
    this.probing = (async () => {
      const st = await this.session.probe();
      if (st === 'signedIn' && was !== 'signedIn' && !this.pendingMerge) await this.startOnline(false);
      this.ev.emit('sync', this.syncStatus);
      return st;
    })().finally(() => {
      this.probing = null;
    });
    return this.probing;
  }

  /**
   * 问一下服务器这台设备的登录还有效没有（同一个账号在别的设备上登录后，这台会被挤下线）。
   * 失效 → authLost（界面回到登录页并说明原因）。连不上不算失效。
   */
  async checkSession(): Promise<void> {
    if (!this.inited || this.session.state !== 'signedIn' || !this.session.token) return;
    try {
      await this.api.me(5000);
    } catch (e) {
      this.session.handle(e);
    }
  }

  /** 登录页要显示的一句提示（被另一台设备挤下线时）；重新登录或选离线游玩后清掉 */
  get loginNotice(): string | null {
    return this.inited ? this.session.lostReason : null;
  }

  private installPageHooks(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    // 定时确认登录还有效：空闲在菜单里的设备也能很快发现自己被挤下线
    setInterval(() => {
      if (!document.hidden) void this.checkSession();
    }, SESSION_CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.playtimeSvc.pause(true);
        void this.answers.flush(true);
        void this.sync.push();
      } else {
        if (!this.gamePaused) this.playtimeSvc.pause(false);
        if (this.session.state === 'offline') void this.retryConnection();
        else void this.checkSession();
      }
    });
    window.addEventListener('pagehide', () => void this.answers.flush(true));
    window.addEventListener('online', () => void this.retryConnection());
  }

  // ------------------------------------------------------------ 登录

  /** 登录页的名字列表；连不上时返回本设备登录过的玩家（offline = true） */
  async listPlayers(): Promise<{ players: Player[]; offline: boolean; error?: string }> {
    if (!this.inited) await this.init();
    try {
      const r = await this.api.players();
      this.session.rememberPlayers(r.players);
      if (this.session.state === 'offline' || this.session.state === 'unknown') void this.retryConnection();
      return { players: r.players, offline: false };
    } catch (e) {
      return { players: this.session.knownPlayers, offline: true, error: errorText(e) };
    }
  }

  /** 登录。失败抛 ApiError（message 为服务器的中文说明，429 时含锁定秒数）。 */
  async signIn(name: string, password: string): Promise<SignInResult> {
    if (!this.inited) await this.init();
    await this.leaveCurrent();
    const p = await this.session.login(name, password);
    return this.afterAuth(p);
  }

  /** 注册新玩家并登录。失败抛 ApiError。 */
  async register(name: string, password: string, grade: number): Promise<SignInResult> {
    if (!this.inited) await this.init();
    await this.leaveCurrent();
    const p = await this.session.register(name, password, grade);
    return this.afterAuth(p);
  }

  /** 换人之前：把当前玩家的答题和存档尽量发出去（最多等 4 秒） */
  private async leaveCurrent(): Promise<void> {
    if (this.player && this.session.state === 'signedIn') await within(Promise.all([this.answers.flush(), this.sync.push()]), 4000);
  }

  private afterAuth(p: Player): SignInResult {
    const fresh = !this.sync.hasProfile(p.name);
    this.useProfile(p.name);
    const offer = fresh ? this.sync.guestOfferFor(p.name) : null;
    this.ev.emit('state', { state: this.session.state, player: this.player, guest: false });
    if (offer) {
      this.pendingMerge = p.name;
      this.ev.emit('mergeOffer', offer);
      return { player: p, mergeOffer: offer };
    }
    void this.startOnline(false);
    return { player: p, mergeOffer: null };
  }

  /**
   * 回答合并询问：accept = true 时把这台设备上的离线（游客）进度并入当前孩子的账号；
   * false 时游客进度原样保留在本设备（不会再问这个孩子）。等待首次同步完成。
   */
  async resolveMerge(accept: boolean): Promise<void> {
    const name = this.pendingMerge;
    this.pendingMerge = null;
    if (!name || !this.player || this.player.name !== name) return;
    if (!accept) this.sync.declineGuest(name);
    await within(this.startOnline(accept), 15000);
  }

  /** 退出登录：发送剩余数据，换回游客存档，显示登录页 */
  async signOut(): Promise<void> {
    if (!this.inited) return;
    await this.leaveCurrent();
    this.pendingMerge = null;
    this.sync.stop();
    await this.session.logout();
    this.useProfile(null);
    this.ev.emit('state', { state: this.session.state, player: null, guest: this.isGuest });
    this.ev.emit('sync', this.syncStatus);
  }

  /** 选择"离线游玩（不保存到服务器）" */
  playOffline(): void {
    if (!this.inited) return;
    this.pendingMerge = null;
    this.sync.stop();
    this.session.playAsGuest();
    this.useProfile(null);
    this.ev.emit('state', { state: this.session.state, player: null, guest: true });
    this.ev.emit('sync', 'guest');
  }

  // ------------------------------------------------------------ 对局

  /**
   * 开局前调用：拉取最新的个人设置、游戏时间、家长出题（最多等约 3.5 秒，超时用缓存）。
   * allowed = false 时不要开局，显示 reason。游客 / 离线时用缓存或游戏默认，一律允许（离线按缓存的时间限制）。
   */
  async beforeMatch(level: { boss: boolean }): Promise<BeforeMatchResult> {
    if (!this.inited || !this.player) {
      const pt = this.inited ? this.playtimeSvc.view() : { allowedNow: true, remaining: null, reason: null, message: '', nextAllowedAt: null, windowEndsAt: null, enabled: false, fresh: false };
      return { allowed: true, options: {}, playtime: pt as PlaytimeView };
    }
    if (this.session.state === 'signedIn')
      await within(Promise.all([this.settingsRes.refresh(), this.playtimeSvc.refresh(3000), this.custom.refresh()]), 3500);
    const v = this.playtimeSvc.view();
    return { allowed: v.allowedNow, reason: v.allowedNow ? undefined : v.message || '现在不能开始新的对局', options: matchOptionsFor(this.settingsRes.data, level), playtime: v };
  }

  /** 某关的开局参数（用缓存的设置，不发请求） */
  matchOptions(level: { boss: boolean }): MatchOptions {
    return this.inited && this.player ? matchOptionsFor(this.settingsRes.data, level) : {};
  }

  /** 对局开始（进入第一回合的购买阶段时）：开始计游戏时间 */
  matchStarted(): void {
    if (!this.inited) return;
    this.inMatch = true;
    this.gamePaused = false;
    if (this.player) this.playtimeSvc.start();
  }

  /** 暂停菜单打开 / 关闭（暂停时不计时） */
  matchPaused(paused: boolean): void {
    if (!this.inited) return;
    this.gamePaused = paused;
    this.playtimeSvc.pause(paused);
  }

  /** 回合结束：发送答题队列 */
  roundEnded(): void {
    if (!this.inited || !this.player) return;
    void this.answers.flush();
    this.sync.markDirty();
  }

  /**
   * 对局结束（结算页出现时，存档 persist() 之后）：停表并补发心跳 → 发送答题 → 推送存档 →
   * 拉取任务（播放新完成的庆祝）→ 游戏时间 → 家长出题。不等它也可以；永不 reject。
   * result 目前只用于将来扩展（例如上报通关事件），可以不传。
   */
  async matchEnded(_result?: unknown): Promise<void> {
    if (!this.inited) return;
    this.inMatch = false;
    this.gamePaused = false;
    if (!this.player) return;
    try {
      await this.playtimeSvc.stop(true);
      await this.answers.flush();
      await this.sync.push();
      if (this.session.state !== 'signedIn') return;
      await this.refreshTasks();
      await Promise.all([this.playtimeSvc.refresh(), this.custom.refresh()]);
    } catch (e) {
      console.warn('[online] matchEnded', e);
    }
  }

  /** 对局是否正在进行（matchStarted 与 matchEnded 之间） */
  get matchRunning(): boolean {
    return this.inMatch;
  }

  /**
   * 记一条答题（每答完一题调用一次，任何场景）。游客模式下什么也不做。
   * 给了 customId 就按家长出题记录（context 自动改为 custom），并在本地扣减该题剩余次数。
   */
  logAnswer(a: LogAnswerInput): void {
    // 不检查 this.player：令牌刚失效时答题仍记在该玩家的队列里，重新登录后再发
    if (!this.inited) return;
    const topicId = a.topicId ?? a.q?.topicId;
    const custom = a.customId !== undefined && a.customId !== null;
    if (!custom && (!topicId || topicId === 'custom')) return; // 没有 customId 的家长题服务器不收
    this.answers.log({
      context: custom ? 'custom' : a.context,
      correct: a.correct,
      topicId,
      grade: a.grade ?? a.q?.grade,
      difficulty: a.difficulty ?? a.q?.difficulty,
      ms: a.ms,
      levelId: a.levelId,
      customId: custom ? a.customId : undefined,
      at: a.at,
    });
    if (custom) this.customAnswered(a.customId!, a.correct);
  }

  /**
   * 家长出题作答后在本地扣减剩余次数（logAnswer 带 customId 时已经自动调用，一般不需要直接调用）。
   */
  customAnswered(customId: number, correct: boolean): void {
    if (!this.inited) return;
    this.custom.answered(customId, correct);
  }

  /**
   * 出一道门槛题：按家长设置的 customRate / reviewRate 决定用家长出题、重出错题本里的题，还是正常出题。
   * 游客模式下总是正常出题（与原来的单机游戏一致）。答完后把返回的 customId 传给 logAnswer。
   */
  gateQuestion<Q extends QuestionLike>(o: GateQuestionOptions<Q>): GatePick<Q> {
    if (!this.inited || !this.player) return { q: o.generate(), source: 'generated' };
    const rates = questionRates(this.settingsRes.data);
    let wrong: { q: QuestionLike; levelId?: string }[] = [];
    try {
      wrong = this.live.read().wrong as unknown as { q: QuestionLike; levelId?: string }[];
    } catch {
      wrong = [];
    }
    return pickGateQuestion<Q>({
      rng: o.rng ?? Math.random,
      reviewRate: rates.reviewRate,
      customRate: rates.customRate,
      custom: this.custom.pending(),
      wrong,
      generate: o.generate,
      topicIds: o.level.topicIds,
      recentTexts: o.recentTexts,
      recentCustomIds: o.recentCustomIds,
    });
  }

  /** 存档有改动（每次 persist() 之后调用即可；防抖后推送，离线时等联网） */
  saveChanged(): void {
    if (!this.inited) return;
    this.sync.markDirty();
  }

  /** 立刻发送答题队列并推送存档（页面隐藏时已自动调用） */
  async flush(): Promise<void> {
    if (!this.inited || !this.player) return;
    await Promise.all([this.answers.flush(), this.sync.push()]).catch(() => undefined);
  }

  // ------------------------------------------------------------ 标题页数据

  /** 回到标题页时调用：拉取留言、任务、游戏时间（不等也可以） */
  async refreshTitle(): Promise<void> {
    if (!this.inited || !this.player || this.pendingMerge) return;
    if (this.session.state === 'offline') void this.retryConnection();
    if (this.session.state !== 'signedIn') return;
    await this.answers.flush();
    // 顺便和服务器对账一次存档（别的设备可能有新进度；本地有改动时会推送）
    await this.sync.start(false);
    await Promise.all([this.messages.refresh(), this.refreshTasks(), this.playtimeSvc.refresh()]);
  }

  private async refreshTasks(): Promise<Task[]> {
    const list = await this.tasks.refresh();
    const pend = this.tasks.pendingCelebrations();
    if (pend.length) this.ev.emit('celebrate', pend);
    return list;
  }

  /** 当前游戏时间限制（含离线时的本地推算） */
  playtime(): PlaytimeView {
    if (!this.inited) return { allowedNow: true, remaining: null, reason: null, message: '', nextAllowedAt: null, windowEndsAt: null, enabled: false, fresh: false };
    return this.playtimeSvc.view();
  }

  /** 庆祝播放完调用：之后不再为这个任务庆祝 */
  celebrated(taskId: number): Promise<void> {
    if (!this.inited) return Promise.resolve();
    return this.tasks.markCelebrated(taskId);
  }

  /** 每回合开始额外给的金币（已完成任务的 bonusCredits 之和，产品待定） */
  taskBonusCredits(): number {
    return this.inited && this.player ? this.tasks.bonusCredits() : 0;
  }

  /** 把接口错误变成给孩子看的一句话 */
  errorText(e: unknown): string {
    return errorText(e);
  }

  /** 调试 / 测试用：接口错误是否是"连不上" */
  isOfflineError(e: unknown): boolean {
    return isOffline(e) && !isAuthError(e);
  }
}

/** 联网层单例 */
export const online = new Online();
export type { Online };
