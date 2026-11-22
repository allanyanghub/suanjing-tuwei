/**
 * 家庭服务器的类型化客户端（契约见 server/API.md，以 server/src 的实现为准）。
 * 只包含孩子端（玩家）用到的接口；家长接口（/api/admin/*）不在游戏里调用。
 *
 * - 默认同源：请求 `/api/...`（服务器在网站根目录同时提供网页和接口）；
 * - 开发时可用 `?api=http://127.0.0.1:8080` 或 `localStorage['suanjing-api-base']` 指向单独启动的服务器；
 * - 每个请求都有超时（AbortController）；
 * - 非 2xx 一律抛 `ApiError`，`message` 是服务器给的中文说明；连不上 / 超时 / 返回的不是 JSON
 *   时 `status = 0`，`kind` 区分原因（例如网页被放在普通静态主机的子目录下，`/api/health` 返回 404 网页）。
 */
import type { KV } from './util.ts';

// ---------------------------------------------------------------- 数据类型

export interface Player {
  name: string;
  grade: number;
}

export interface Health {
  ok: true;
  time: number;
  schemaVersion: number;
  tz: string;
  tzEnv: string | null;
  utcOffsetMinutes: number;
}

/** 存档里的错题（q 为客户端 Question，服务器原样保存） */
export interface SaveWrong {
  q: { text: string; [k: string]: unknown };
  picked: number;
  time: number;
  levelId: string;
}

/** 上传到服务器的存档（不含各设备自己的 settings） */
export interface SaveBlob {
  stars: Record<string, number>;
  wrong: SaveWrong[];
  agent: string;
  mapChoice: Record<string, string>;
  stats: { answered: number; correct: number; kills: number; wins: number };
  /** 段位（旧存档没有；客户端按 seedRank 补） */
  rank?: { pts: number; best: number; n: number };
}

export interface SaveResponse {
  data: SaveBlob;
  version: number;
  updatedAt: number;
}

export interface CatalogBody {
  topics: { id: string; grade: number; name: string }[];
  levels: { id: string; grade: number; name: string; topicIds: string[]; boss: boolean }[];
}

export type AnswerContext = 'gate' | 'bonus' | 'plant' | 'defuse' | 'revive' | 'practice' | 'custom';

export interface AnswerRecord {
  id: string;
  correct: boolean;
  context: AnswerContext;
  at: number;
  topicId?: string;
  grade?: number;
  difficulty?: number;
  ms?: number | null;
  levelId?: string;
  customId?: number;
}

export interface AnswersResponse {
  accepted: number;
  duplicates: number;
  rejected: (string | null)[];
  tasksCompleted: number;
}

export interface Tally {
  answered: number;
  correct: number;
  accuracy: number | null;
}

export interface MyReport {
  totals: Tally;
  week: Tally & { startsAt: number };
  today: Tally;
  streak: { current: number; best: number };
  topics: (Tally & { topicId: string; name: string })[];
}

export interface TaskProgress {
  current: number;
  target: number;
  unit: string;
  accuracy?: number | null;
  percent?: number;
}

export interface Task {
  id: number;
  kind: string;
  title: string;
  description: string;
  note: string;
  reward: string;
  dueAt: number | null;
  dueDate: string | null;
  bonusCredits: number;
  params: Record<string, unknown>;
  createdAt: number;
  status: 'active' | 'done';
  progress: TaskProgress;
  completedAt: number | null;
  rewardGranted: boolean;
  forAll: boolean;
  justCompleted: boolean;
}

export interface PlaytimeStatus {
  enabled: boolean;
  usedToday: number;
  bonusMinutesToday: number;
  serverTime: number;
  limitToday: number | null;
  remaining: number | null;
  allowedNow: boolean;
  nextAllowedAt: number | null;
  windowEndsAt: number | null;
  reason: null | 'daily_limit' | 'outside_window';
  message: string;
  windowsToday: { start: string; end: string }[];
}

export interface HeartbeatResponse extends PlaytimeStatus {
  credited: number;
  ignored: boolean;
}

export interface ParentMessage {
  id: number;
  text: string;
  forAll: boolean;
  createdAt: number;
  expiresAt: number | null;
}

export interface CustomQuestion {
  id: number;
  topicId: 'custom';
  grade: number;
  difficulty: number;
  text: string;
  options: string[];
  answer: number;
  explain: string;
  topicLabel: string;
  remainingCorrect: number;
}

export type BoardMetric = 'rank' | 'stars' | 'cleared' | 'weekCorrect' | 'weekAccuracy' | 'bestStreak' | 'wins';

export interface Leaderboard {
  weekStartsAt: number;
  weekAccuracyMin: number;
  meHidden: boolean;
  players: {
    name: string;
    grade: number;
    /** 段位累计星数（旧服务器没有这个字段） */
    rank?: number;
    stars: number;
    cleared: number;
    wins: number;
    weekAnswered: number;
    weekCorrect: number;
    weekAccuracy: number | null;
    bestStreak: number;
    isMe: boolean;
  }[];
  boards: Record<BoardMetric, { name: string; value: number; rank: number }[]>;
}

/** GET /api/settings/me 的 settings（家长设置，客户端应用） */
export interface ServerSettings {
  grade: number;
  passAccuracy: number;
  botStrength: number;
  reviveSeconds: number;
  gateRequired: boolean;
  gateCount: number;
  bonusCount: number;
  plantQuestions: number;
  defuseQuestions: number;
  reviewRate: number;
  customRate: number;
  roundsToWin: number | null;
  bossRoundsToWin: number | null;
}

// ---------------------------------------------------------------- 错误

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'bad-response';

export class ApiError extends Error {
  /** HTTP 状态码；连不上 / 超时 / 响应不是 JSON 时为 0 */
  readonly status: number;
  readonly kind: ApiErrorKind;
  constructor(status: number, message: string, kind: ApiErrorKind) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
  }
}

/** 连不上服务器类的错误（应当排队 / 稍后重试，而不是提示用户输入有误） */
export function isOffline(e: unknown): boolean {
  return e instanceof ApiError && e.kind !== 'http';
}

/** 值得稍后重试的错误：连不上 + 5xx */
export function isRetryable(e: unknown): boolean {
  return e instanceof ApiError && (e.kind !== 'http' || e.status >= 500);
}

export const isAuthError = (e: unknown): boolean => e instanceof ApiError && e.kind === 'http' && e.status === 401;

/** 把任意错误变成给孩子看的一句中文 */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.kind === 'timeout') return '服务器没有响应，请稍后再试';
    if (e.kind !== 'http') return '连不上家里的服务器';
    return e.message || '出错了，请稍后再试';
  }
  return '出错了，请稍后再试';
}

// ---------------------------------------------------------------- 地址

export const API_BASE_KEY = 'suanjing-api-base';

/**
 * 决定接口地址前缀：`?api=` > `localStorage['suanjing-api-base']` > 同源（空串，请求 `/api/...`）。
 * 只接受 http(s) 地址，末尾的 `/` 去掉。
 */
export function resolveApiBase(search: string, kv: KV | null): string {
  const clean = (s: string | null | undefined): string | null => {
    if (!s) return null;
    const t = s.trim().replace(/\/+$/, '');
    return /^https?:\/\/[^\s]+$/i.test(t) ? t : null;
  };
  let q: string | null = null;
  try {
    q = new URLSearchParams(search).get('api');
  } catch {
    q = null;
  }
  return clean(q) ?? clean(kv?.get(API_BASE_KEY)) ?? '';
}

// ---------------------------------------------------------------- 客户端

export interface ApiOptions {
  /** 地址前缀，例如 '' 或 'http://127.0.0.1:8080' */
  base: string;
  /** 当前登录令牌 */
  token: () => string | null;
  fetch?: typeof fetch;
  /** 默认超时（毫秒） */
  timeoutMs?: number;
}

interface ReqOpts {
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
  /** 页面关闭时仍尽量发出（fetch keepalive，请求体需 < 64 KB） */
  keepalive?: boolean;
}

export class Api {
  base: string;
  private token: () => string | null;
  private f: typeof fetch;
  timeoutMs: number;
  /** 任何请求拿到服务器的 JSON 响应（含 4xx）后调用：说明服务器连得上 */
  onReachable: () => void = () => undefined;

  constructor(o: ApiOptions) {
    this.base = o.base;
    this.token = o.token;
    this.f = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.timeoutMs = o.timeoutMs ?? 8000;
  }

  async request<T>(method: string, path: string, o: ReqOpts = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.auth !== false) {
      const t = this.token();
      if (t) headers.Authorization = `Bearer ${t}`;
    }
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl?.abort();
    }, o.timeoutMs ?? this.timeoutMs);
    let res: Response;
    try {
      res = await this.f(this.base + path, {
        method,
        headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        signal: ctl?.signal,
        keepalive: o.keepalive,
        cache: 'no-store',
      });
    } catch {
      clearTimeout(timer);
      throw timedOut ? new ApiError(0, '服务器没有响应', 'timeout') : new ApiError(0, '连不上服务器', 'network');
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      clearTimeout(timer);
      throw timedOut ? new ApiError(0, '服务器没有响应', 'timeout') : new ApiError(0, '连不上服务器', 'network');
    }
    clearTimeout(timer);
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    const isJson = typeof json === 'object' && json !== null;
    if (isJson) this.onReachable();
    if (!res.ok) {
      // 我们的服务器所有错误都是 { error }；不是这个形状说明对面不是游戏服务器（静态主机的 404 页等）
      const msg = isJson && typeof (json as { error?: unknown }).error === 'string' ? (json as { error: string }).error : '';
      if (!msg) throw new ApiError(0, '这里没有游戏服务器', 'bad-response');
      throw new ApiError(res.status, msg, 'http');
    }
    if (!isJson) throw new ApiError(0, '这里没有游戏服务器', 'bad-response');
    return json as T;
  }

  // ---- 公开 ----
  /** 探测服务器；返回的不是 `{ ok: true }` 时抛 bad-response */
  async health(timeoutMs = 4000): Promise<Health> {
    const r = await this.request<Health>('GET', '/api/health', { auth: false, timeoutMs });
    if (!r || r.ok !== true) throw new ApiError(0, '这里没有游戏服务器', 'bad-response');
    return r;
  }
  players(): Promise<{ players: Player[] }> {
    return this.request('GET', '/api/players', { auth: false });
  }
  register(name: string, password: string, grade: number): Promise<{ token: string; player: Player }> {
    return this.request('POST', '/api/register', { auth: false, body: { name, password, grade } });
  }
  login(name: string, password: string): Promise<{ token: string; player: Player }> {
    return this.request('POST', '/api/login', { auth: false, body: { name, password } });
  }
  logout(timeoutMs = 3000): Promise<{ ok: true }> {
    return this.request('POST', '/api/logout', { timeoutMs });
  }

  // ---- 孩子 ----
  me(timeoutMs?: number): Promise<{ player: Player }> {
    return this.request('GET', '/api/me', { timeoutMs });
  }
  getSave(): Promise<SaveResponse> {
    return this.request('GET', '/api/save', { timeoutMs: 15000 });
  }
  putSave(baseVersion: number, data: SaveBlob): Promise<SaveResponse> {
    return this.request('PUT', '/api/save', { body: { baseVersion, data }, timeoutMs: 20000 });
  }
  putCatalog(c: CatalogBody): Promise<{ ok: true; changed: boolean; topics: number; levels: number }> {
    return this.request('PUT', '/api/catalog', { body: c, timeoutMs: 15000 });
  }
  postAnswers(answers: AnswerRecord[], keepalive = false): Promise<AnswersResponse> {
    return this.request('POST', '/api/answers', { body: { answers }, keepalive, timeoutMs: 15000 });
  }
  reportMe(): Promise<MyReport> {
    return this.request('GET', '/api/report/me');
  }
  tasks(): Promise<{ tasks: Task[] }> {
    return this.request('GET', '/api/tasks');
  }
  ackTask(id: number): Promise<{ ok: true; acked: boolean }> {
    return this.request('POST', `/api/tasks/${id}/ack`);
  }
  playtime(timeoutMs?: number): Promise<PlaytimeStatus> {
    return this.request('GET', '/api/playtime', { timeoutMs });
  }
  heartbeat(seconds: number): Promise<HeartbeatResponse> {
    return this.request('POST', '/api/playtime/heartbeat', { body: { seconds }, timeoutMs: 6000 });
  }
  /** 未读的留言（孩子标为已读后服务器不再返回） */
  messages(): Promise<{ messages: ParentMessage[] }> {
    return this.request('GET', '/api/messages');
  }
  markMessagesRead(ids: number[]): Promise<{ ok: true; marked: number }> {
    return this.request('POST', '/api/messages/read', { body: { ids } });
  }
  customQuestions(timeoutMs?: number): Promise<{ questions: CustomQuestion[] }> {
    return this.request('GET', '/api/custom-questions', { timeoutMs });
  }
  leaderboard(): Promise<Leaderboard> {
    return this.request('GET', '/api/leaderboard');
  }
  settingsMe(timeoutMs?: number): Promise<{ settings: ServerSettings }> {
    return this.request('GET', '/api/settings/me', { timeoutMs });
  }
}
