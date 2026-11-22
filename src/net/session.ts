/**
 * 登录会话：当前玩家 + 令牌（存在 localStorage），以及联网状态机。
 *
 *   unknown ──探测──▶ offline    连不上服务器（或网页不在游戏服务器上）。有记住的玩家时继续以他的身份离线玩，
 *                               没有时是"离线游客"，游戏照旧单机运行。
 *            ├────▶ signedOut  服务器在，但没有有效登录（需要登录页；或孩子选了"离线游玩"= 游客）
 *            └────▶ signedIn   已登录
 *
 * 令牌失效（任何接口 401）时回到 signedOut，但本地进度保留在该玩家的本地存档里，重新登录后再同步。
 */
import { ApiError, isAuthError, isOffline, type Api, type Player } from './api.ts';
import { Emitter, KEY_PREFIX, readJSON, writeJSON, type KV } from './util.ts';

export type OnlineState = 'unknown' | 'offline' | 'signedOut' | 'signedIn';

export interface SessionEvents extends Record<string, unknown> {
  /** 状态或玩家变了 */
  change: { state: OnlineState; player: Player | null; guest: boolean };
  /** 令牌失效（被家长重置密码等），需要重新登录 */
  authLost: { player: Player | null; reason: string | null };
}

/** 服务器说这个账号在另一台设备上登录了（见 server/src/app.ts REPLACED_TEXT） */
export function replacedReason(e: unknown): string | null {
  return isAuthError(e) && e instanceof Error && e.message.includes('另一台设备') ? e.message : null;
}

const K_SESSION = KEY_PREFIX + 'session';
const K_LAST = KEY_PREFIX + 'last-player';
const K_KNOWN = KEY_PREFIX + 'known-players';

interface Stored {
  token: string;
  player: Player;
}

export class Session {
  readonly ev = new Emitter<SessionEvents>();
  state: OnlineState = 'unknown';
  player: Player | null = null;
  token: string | null = null;
  /** 正在以"离线游客"身份玩（不保存到服务器） */
  guest = false;
  /** 上次被退出登录的原因（被另一台设备挤下线时有值；重新登录 / 离线游玩后清掉） */
  lostReason: string | null = null;
  /** 服务器时间 - 本机时间（毫秒），来自 /api/health */
  clockSkew = 0;
  private kv: KV;
  private api: Api;
  private now: () => number;

  constructor(api: Api, kv: KV, now: () => number = Date.now) {
    this.api = api;
    this.kv = kv;
    this.now = now;
    const s = readJSON<Stored | null>(kv, K_SESSION, null);
    if (s && typeof s.token === 'string' && s.player && typeof s.player.name === 'string') {
      this.token = s.token;
      this.player = s.player;
    }
  }

  /** 此设备上次登录的玩家名字（登录页默认选中） */
  get lastPlayer(): string | null {
    return this.kv.get(K_LAST);
  }

  /** 此设备上登录过的玩家（服务器连不上时登录页用它显示名字） */
  get knownPlayers(): Player[] {
    return readJSON<Player[]>(this.kv, K_KNOWN, []);
  }

  rememberPlayers(list: Player[]): void {
    writeJSON(this.kv, K_KNOWN, list.slice(0, 50));
  }

  private set(state: OnlineState): void {
    this.state = state;
    this.ev.emit('change', { state, player: this.player, guest: this.guest });
  }

  /**
   * 启动探测：/api/health → 有令牌时 /api/me。
   * 永不抛错；返回最终状态。
   */
  async probe(): Promise<OnlineState> {
    try {
      const h = await this.api.health();
      this.clockSkew = h.time - this.now();
    } catch {
      this.set('offline');
      return this.state;
    }
    if (!this.token) {
      this.set('signedOut');
      return this.state;
    }
    try {
      const r = await this.api.me(5000);
      this.player = r.player;
      this.store();
      this.guest = false;
      this.set('signedIn');
    } catch (e) {
      if (isAuthError(e)) {
        this.lostReason = replacedReason(e);
        this.clear();
        this.set('signedOut');
      } else this.set(isOffline(e) ? 'offline' : 'signedOut');
    }
    return this.state;
  }

  private store(): void {
    if (this.token && this.player) {
      writeJSON(this.kv, K_SESSION, { token: this.token, player: this.player } satisfies Stored);
      this.kv.set(K_LAST, this.player.name);
    }
  }

  private clear(): void {
    this.token = null;
    this.kv.del(K_SESSION);
  }

  /** 登录 / 注册成功后调用 */
  adopt(token: string, player: Player): void {
    this.token = token;
    this.player = player;
    this.guest = false;
    this.store();
    this.set('signedIn');
  }

  async login(name: string, password: string): Promise<Player> {
    const r = await this.api.login(name, password);
    this.lostReason = null;
    this.adopt(r.token, r.player);
    return r.player;
  }

  async register(name: string, password: string, grade: number): Promise<Player> {
    const r = await this.api.register(name, password, grade);
    this.adopt(r.token, r.player);
    return r.player;
  }

  /** 退出登录：服务器删除令牌（失败也无所谓），本地清掉令牌 */
  async logout(): Promise<void> {
    if (this.token) await this.api.logout().catch(() => undefined);
    this.clear();
    this.player = null;
    this.guest = false;
    this.set(this.state === 'offline' ? 'offline' : 'signedOut');
  }

  /** 选择"离线游玩"：不登录，以游客身份玩 */
  playAsGuest(): void {
    this.lostReason = null;
    this.clear();
    this.player = null;
    this.guest = true;
    this.set(this.state === 'unknown' ? 'offline' : this.state === 'signedIn' ? 'signedOut' : this.state);
  }

  /** 任何带令牌的接口返回 401 时调用 */
  authLost(reason: string | null = null): void {
    if (!this.token) return;
    const p = this.player;
    this.lostReason = reason;
    this.clear();
    this.set('signedOut');
    this.ev.emit('authLost', { player: p, reason });
  }

  /** 接口调用发现连不上（只在已登录时把状态降为 offline） */
  markOffline(): void {
    if (this.state === 'signedIn') this.set('offline');
  }

  /** 统一处理接口错误：401 → authLost；连不上 → offline。返回原错误方便继续抛 */
  handle(e: unknown): unknown {
    if (isAuthError(e)) this.authLost(replacedReason(e));
    else if (e instanceof ApiError && isOffline(e)) this.markOffline();
    return e;
  }

  /** 已登录或"记得是谁但暂时离线"：此时进度属于这个玩家 */
  get activeName(): string | null {
    if (this.guest) return null;
    if (this.state === 'signedIn' || (this.state === 'offline' && this.token)) return this.player?.name ?? null;
    return null;
  }
}
