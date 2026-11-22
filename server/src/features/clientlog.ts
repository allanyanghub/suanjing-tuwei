/**
 * 客户端错误日志：游戏网页把脚本报错、画面丢失（WebGL 上下文丢失）、长时间掉帧等情况批量上报，
 * 服务器追加写进数据目录下的 client-errors.log（每行一个 JSON），家长 / 开发者在管理接口里查看。
 * - POST /api/client-log：公开（不需要登录），请求体是报告数组（或 { reports: [...] }）；按 IP 限流，逐条校验、截断；
 * - GET /api/admin/client-log?limit=200：最近的记录，新的在前。
 * 日志文件超过 MAX_FILE 时只保留后一半，避免把家用 NAS 的硬盘写满。
 */
import type { IncomingMessage } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { HttpError, cleanText, isObj, type Env, type Route } from '../http.ts';

/** 日志文件上限（字节）；超过后截掉前面较旧的一半 */
export const MAX_FILE = 2 * 1024 * 1024;
/** 单条记录上限（字节，序列化后） */
export const MAX_ENTRY = 4096;
/** 一次请求最多几条 */
export const MAX_BATCH = 20;
/** 请求体上限 */
const MAX_BODY = 128 * 1024;
/** 每个 IP 每个窗口最多收几条（超出的静默丢弃） */
export const IP_LIMIT = 60;
export const IP_WINDOW = 10 * 60_000;

const KINDS = new Set(['error', 'rejection', 'loop', 'render', 'context-lost', 'context-restored', 'context-reload', 'perf', 'quality', 'info']);

export interface ClientLogOptions {
  /** 日志文件路径；默认放在数据库文件旁边（即 DATA_DIR），内存数据库时用环境变量 DATA_DIR，都没有则只存在内存里 */
  file?: string;
}

/** 数据库文件所在目录（:memory: 时为空串） */
function dbDir(env: Env): string {
  try {
    const rows = env.db.sql.prepare('PRAGMA database_list').all() as { name: string; file: string }[];
    const f = rows.find((r) => r.name === 'main')?.file ?? '';
    return f ? dirname(f) : '';
  } catch {
    return '';
  }
}

const str = (v: unknown, max: number): string => {
  if (v === undefined || v === null) return '';
  const s = cleanText(typeof v === 'string' ? v : String(v), true);
  return s.length > max ? s.slice(0, max) + '…' : s;
};

/** 上下文：只收简单值（字符串 / 数字 / 布尔），最多 30 个键 */
function cleanCtx(v: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!isObj(v)) return out;
  let n = 0;
  for (const [k, x] of Object.entries(v)) {
    if (n >= 30) break;
    const key = k.replace(/[^\w.-]/g, '').slice(0, 32);
    if (!key) continue;
    if (typeof x === 'number') {
      if (!Number.isFinite(x)) continue;
      out[key] = x;
    } else if (typeof x === 'boolean') out[key] = x;
    else if (typeof x === 'string') out[key] = str(x, 300);
    else continue;
    n++;
  }
  return out;
}

export interface ClientLogEntry {
  at: number;
  ip: string;
  kind: string;
  msg: string;
  stack?: string;
  count?: number;
  t?: number;
  ctx: Record<string, string | number | boolean>;
}

/** 校验一条报告；不合格返回 null */
export function cleanReport(r: unknown, at: number, ip: string): ClientLogEntry | null {
  if (!isObj(r)) return null;
  const kind = typeof r.kind === 'string' && KINDS.has(r.kind) ? r.kind : null;
  if (!kind) return null;
  const e: ClientLogEntry = { at, ip, kind, msg: str(r.msg, 1000), ctx: cleanCtx(r.ctx) };
  const stack = str(r.stack, 2000);
  if (stack) e.stack = stack;
  if (typeof r.count === 'number' && Number.isFinite(r.count)) e.count = Math.max(1, Math.min(1e6, Math.round(r.count)));
  if (typeof r.t === 'number' && Number.isFinite(r.t)) e.t = Math.round(r.t);
  // 序列化后超长：先砍调用栈，再砍上下文，最后砍消息
  if (JSON.stringify(e).length > MAX_ENTRY) delete e.stack;
  if (JSON.stringify(e).length > MAX_ENTRY) e.ctx = {};
  if (JSON.stringify(e).length > MAX_ENTRY) e.msg = e.msg.slice(0, 500) + '…';
  return e;
}

/** 读原始请求体（JSON 数组或对象都接受；http.ts 的 readJson 只收对象） */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_BODY) throw new HttpError(413, '提交的数据太大');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    size += buf.length;
    if (size > MAX_BODY) throw new HttpError(413, '提交的数据太大');
    chunks.push(buf);
  }
  if (!size) return [];
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, '数据格式不正确');
  }
}

const ipOf = (req: IncomingMessage): string => (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '').slice(0, 64);

export class ClientLog {
  readonly file: string;
  /** 没有文件时（内存数据库且没有 DATA_DIR）记在内存里 */
  private mem: string[] = [];
  private hits = new Map<string, { start: number; n: number }>();
  private now: () => number;

  constructor(env: Env, o: ClientLogOptions = {}) {
    this.now = env.now;
    const dir = dbDir(env) || (process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : '');
    this.file = o.file ?? (dir ? join(dir, 'client-errors.log') : '');
  }

  /** 这个 IP 还能收几条（同时扣掉 want 条） */
  take(ip: string, want: number): number {
    const t = this.now();
    let h = this.hits.get(ip);
    if (!h || t - h.start >= IP_WINDOW) {
      h = { start: t, n: 0 };
      this.hits.set(ip, h);
      // 顺手清理过期的 IP，防止表无限增长
      if (this.hits.size > 2000) for (const [k, v] of this.hits) if (t - v.start >= IP_WINDOW) this.hits.delete(k);
    }
    const ok = Math.max(0, Math.min(want, IP_LIMIT - h.n));
    h.n += ok;
    return ok;
  }

  append(entries: ClientLogEntry[]): void {
    if (!entries.length) return;
    const lines = entries.map((e) => JSON.stringify(e) + '\n').join('');
    if (!this.file) {
      this.mem.push(...lines.split('\n').filter(Boolean));
      if (this.mem.length > 2000) this.mem.splice(0, this.mem.length - 1000);
      return;
    }
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, lines);
      if (statSync(this.file).size > MAX_FILE) this.trim();
    } catch (e) {
      console.error('[client-log] 写日志失败', e);
    }
  }

  /** 只保留文件后一半（从完整的一行开始） */
  private trim(): void {
    const buf = readFileSync(this.file);
    let from = buf.length - Math.floor(MAX_FILE / 2);
    from = buf.indexOf(0x0a, from);
    writeFileSync(this.file, from < 0 ? Buffer.alloc(0) : buf.subarray(from + 1));
  }

  /** 最近 limit 条，新的在前 */
  recent(limit: number): ClientLogEntry[] {
    let lines: string[];
    if (!this.file) lines = this.mem;
    else if (!existsSync(this.file)) lines = [];
    else lines = readFileSync(this.file, 'utf8').split('\n');
    const out: ClientLogEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      if (!lines[i]) continue;
      try {
        out.push(JSON.parse(lines[i]) as ClientLogEntry);
      } catch {
        /* 截断时留下的半行，跳过 */
      }
    }
    return out;
  }
}

export function clientLogRoutes(env: Env, o: ClientLogOptions = {}): Route[] {
  const log = new ClientLog(env, o);
  return [
    {
      method: 'POST',
      path: '/api/client-log',
      handler: async (c) => {
        const body = await readBody(c.req);
        const list = Array.isArray(body) ? body : isObj(body) && Array.isArray(body.reports) ? body.reports : null;
        if (!list) throw new HttpError(400, '数据格式不正确');
        const ip = ipOf(c.req);
        const at = env.now();
        const valid = list
          .slice(0, MAX_BATCH)
          .map((r) => cleanReport(r, at, ip))
          .filter((e): e is ClientLogEntry => e !== null);
        const n = log.take(ip, valid.length);
        if (valid.length && n === 0) throw new HttpError(429, '上报太频繁，请稍后再试');
        log.append(valid.slice(0, n));
        return { accepted: n, dropped: list.length - n };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/client-log',
      handler: (c) => {
        const raw = Number(c.url.searchParams.get('limit') ?? 200);
        const limit = Number.isFinite(raw) ? Math.max(1, Math.min(1000, Math.round(raw))) : 200;
        return { entries: log.recent(limit) };
      },
    },
  ];
}
