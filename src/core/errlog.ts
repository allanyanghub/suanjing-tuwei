/**
 * 客户端错误记录：把脚本报错、未处理的 Promise 拒绝、主循环异常、画面丢失 / 恢复、长时间掉帧等
 * 连同设备信息（浏览器、显卡、画质、屏幕、像素比、所在关卡）批量上报到服务器 POST /api/client-log。
 * - 相同的错误只上报一次（之后只累计次数，隔一段时间再带上次数补报一次）；
 * - 每次打开页面最多上报 MAX_REPORTS 条，单条不超过 MAX_BYTES；
 * - 服务器连不上时静默放弃，绝不影响游戏本身。
 * 这里不引用联网层和游戏层，所需信息由 initErrlog 传入的回调提供。
 */

export type ReportKind = 'error' | 'rejection' | 'loop' | 'render' | 'context-lost' | 'context-restored' | 'context-reload' | 'perf' | 'quality' | 'info';

interface Report {
  kind: ReportKind;
  msg: string;
  stack?: string;
  count?: number;
  t: number;
  ctx: Record<string, string | number | boolean>;
}

export interface ErrlogOptions {
  /** 接口地址前缀（'' = 同源）；返回 null 表示暂时不上报 */
  apiBase: () => string | null;
  /** 取 WebGL 上下文（读显卡型号） */
  gl?: () => WebGLRenderingContext | WebGL2RenderingContext | null;
  /** 额外的上下文（画质、关卡等），每条报告生成时调用 */
  context?: () => Record<string, string | number | boolean | undefined | null>;
}

const MAX_REPORTS = 50;
const MAX_BYTES = 4000;
/** 同一错误补报次数的最短间隔 */
const REPEAT_MS = 60_000;
/** 攒一会儿再发 */
const FLUSH_DELAY = 3000;

let opts: ErrlogOptions | null = null;
let queue: Report[] = [];
let sent = 0;
let failures = 0;
let waits = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let gpu: string | null = null;
/** 去重：键 → 已出现次数、上次上报时的次数和时间 */
const seen = new Map<string, { n: number; reportedN: number; at: number }>();
/** 测试 / 调试：最近的报告（不管有没有发出去） */
export const recentReports: Report[] = [];

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

function gpuName(): string {
  if (gpu !== null) return gpu;
  gpu = '';
  try {
    const gl = opts?.gl?.();
    if (!gl) return gpu;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    if (ext) gpu = `${gpu} / ${String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? '')}`;
  } catch {
    /* 拿不到就算了 */
  }
  return gpu;
}

function baseContext(): Record<string, string | number | boolean> {
  const c: Record<string, string | number | boolean> = {};
  try {
    c.ua = cut(navigator.userAgent, 280);
    c.gpu = cut(gpuName(), 200);
    c.scr = `${screen.width}x${screen.height}`;
    c.win = `${window.innerWidth}x${window.innerHeight}`;
    c.dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
    c.touch = navigator.maxTouchPoints > 0;
    c.up = Math.round(performance.now() / 1000);
    const mem = (navigator as { deviceMemory?: number }).deviceMemory;
    if (typeof mem === 'number') c.mem = mem;
    const extra = opts?.context?.() ?? {};
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null) c[k] = v;
  } catch {
    /* 上下文出错不能影响上报本身 */
  }
  return c;
}

/** 记一条报告（相同的 kind + msg + 栈顶 只记一次，之后累计次数） */
export function report(kind: ReportKind, msg: string, extra: { stack?: string; ctx?: Record<string, string | number | boolean> } = {}): void {
  try {
    const stack = extra.stack ? cut(extra.stack, 1500) : undefined;
    const key = `${kind}|${msg}|${(stack ?? '').split('\n', 2).join('|')}`;
    const now = Date.now();
    let s = seen.get(key);
    if (!s) {
      if (seen.size > 500) seen.clear();
      s = { n: 0, reportedN: 0, at: 0 };
      seen.set(key, s);
    }
    s.n++;
    // 已经报过：隔 REPEAT_MS 才带着累计次数再报一次
    if (s.reportedN > 0 && now - s.at < REPEAT_MS) return;
    if (s.reportedN === s.n) return;
    s.reportedN = s.n;
    s.at = now;
    const r: Report = { kind, msg: cut(msg, 800), t: now, ctx: { ...baseContext(), ...(extra.ctx ?? {}) } };
    if (stack) r.stack = stack;
    if (s.n > 1) r.count = s.n;
    // 单条大小上限：先砍栈，再砍上下文里的长字段
    if (JSON.stringify(r).length > MAX_BYTES && r.stack) r.stack = cut(r.stack, 600);
    if (JSON.stringify(r).length > MAX_BYTES) r.ctx = { gpu: String(r.ctx.gpu ?? ''), q: String(r.ctx.q ?? '') };
    recentReports.push(r);
    if (recentReports.length > 100) recentReports.shift();
    if (sent + queue.length >= MAX_REPORTS) return;
    queue.push(r);
    schedule();
  } catch {
    /* 记录器本身绝不抛错 */
  }
}

function schedule(): void {
  if (timer || !opts) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_DELAY);
}

function endpoint(): string | null {
  const base = opts?.apiBase();
  if (base === null || base === undefined) return null;
  return `${base}/api/client-log`;
}

/** 立刻发送队列（返回是否发出去了） */
export async function flush(): Promise<boolean> {
  const url = endpoint();
  if (!queue.length || failures >= 3) return false;
  if (!url) {
    // 联网层还没准备好：过一会儿再看
    if (++waits <= 20) {
      timer ??= setTimeout(() => {
        timer = null;
        void flush();
      }, 5000);
    }
    return false;
  }
  const batch = queue.splice(0, 20);
  try {
    // text/plain：跨域时不需要预检请求
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(batch), keepalive: true });
    if (!r.ok && r.status !== 429) throw new Error(String(r.status));
    sent += batch.length;
    failures = 0;
    if (queue.length) schedule();
    return true;
  } catch {
    // 连不上：放回队列稍后再试；连续失败 3 次就不再尝试（家里没开服务器、单机游戏）
    failures++;
    queue.unshift(...batch);
    if (failures < 3) {
      timer = setTimeout(() => {
        timer = null;
        void flush();
      }, 15_000 * failures);
    } else queue = [];
    return false;
  }
}

/** 页面关闭前用 sendBeacon 把剩下的发出去 */
function beacon(): void {
  try {
    const url = endpoint();
    if (!url || !queue.length || failures >= 3) return;
    const batch = queue.splice(0, 20);
    if (navigator.sendBeacon?.(url, new Blob([JSON.stringify(batch)], { type: 'text/plain' }))) sent += batch.length;
  } catch {
    /* 忽略 */
  }
}

const errText = (e: unknown): { msg: string; stack?: string } => {
  if (e instanceof Error) return { msg: `${e.name}: ${e.message}`, stack: e.stack };
  try {
    return { msg: typeof e === 'string' ? e : JSON.stringify(e) ?? String(e) };
  } catch {
    return { msg: String(e) };
  }
};

/** 记录一个捕获到的异常 */
export function reportError(kind: ReportKind, e: unknown, ctx?: Record<string, string | number | boolean>): void {
  const t = errText(e);
  report(kind, t.msg, { stack: t.stack, ctx });
}

/** 启动：挂上全局错误监听 */
export function initErrlog(o: ErrlogOptions): void {
  if (opts) return;
  opts = o;
  window.addEventListener('error', (ev) => {
    // 资源加载失败（img / script）也会走到这里，target 不是 window
    if (ev.error === undefined && ev.target && ev.target !== window) {
      const el = ev.target as { src?: string; href?: string; tagName?: string };
      report('error', `资源加载失败 ${el.tagName ?? ''} ${cut(el.src ?? el.href ?? '', 200)}`);
      return;
    }
    const t = errText(ev.error ?? ev.message);
    report('error', t.msg || String(ev.message), { stack: t.stack ?? `${ev.filename}:${ev.lineno}:${ev.colno}` });
  }, true);
  window.addEventListener('unhandledrejection', (ev) => reportError('rejection', ev.reason));
  window.addEventListener('pagehide', beacon);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) beacon();
  });
  if (queue.length) schedule();
}
