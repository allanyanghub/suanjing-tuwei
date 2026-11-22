/** HTTP 公共部分：错误类型、读请求体、发送 JSON、输入校验、简单路由。仅使用 Node 内置模块。 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db, PlayerRow } from './db.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function readJson(req: IncomingMessage, limit = 64_000): Promise<Record<string, unknown>> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new HttpError(413, '提交的数据太大');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    size += buf.length;
    if (size > limit) throw new HttpError(413, '提交的数据太大');
    chunks.push(buf);
  }
  if (!size) return {};
  try {
    const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, '数据格式不正确');
  }
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

// ---------------------------------------------------------------- 校验

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 去掉控制字符（保留换行），统一换行符，去掉首尾空白 */
export function cleanText(s: string, keepNewlines: boolean): string {
  const t = s.replace(/\r\n?/g, '\n');
  return (keepNewlines ? t.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '') : t.replace(/[\u0000-\u001f\u007f]/g, ' ')).trim();
}

/** 按字符（不是 UTF-16 单元）计算长度 */
export const charLen = (s: string): number => Array.from(s).length;

/** 必填文本 */
export function text(v: unknown, label: string, max: number, opts: { multiline?: boolean; min?: number } = {}): string {
  if (typeof v !== 'string') throw new HttpError(400, `请填写${label}`);
  const s = cleanText(v, !!opts.multiline);
  const n = charLen(s);
  if (n < (opts.min ?? 1)) throw new HttpError(400, `请填写${label}`);
  if (n > max) throw new HttpError(400, `${label}最多 ${max} 个字`);
  return s;
}

/** 可选文本：缺省 / null / 空串 ⇒ '' */
export function optText(v: unknown, label: string, max: number, multiline = false): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new HttpError(400, `${label}格式不正确`);
  const s = cleanText(v, multiline);
  if (charLen(s) > max) throw new HttpError(400, `${label}最多 ${max} 个字`);
  return s;
}

/** 数字：类型不对就报错，超出范围就夹到范围内 */
export function num(v: unknown, label: string, lo: number, hi: number, integer = true): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new HttpError(400, `${label}需要是数字`);
  const x = integer ? Math.round(v) : v;
  return Math.min(hi, Math.max(lo, x));
}

export function optNum(v: unknown, label: string, lo: number, hi: number, integer = true): number | null {
  if (v === undefined || v === null || v === '') return null;
  return num(v, label, lo, hi, integer);
}

export function bool(v: unknown, label: string): boolean {
  if (typeof v !== 'boolean') throw new HttpError(400, `${label}需要是 true 或 false`);
  return v;
}

/** 专题 / 关卡这类 id：字母数字和 - _ */
export function idText(v: unknown, label: string, max = 40): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]+$/.test(v) || v.length > max) throw new HttpError(400, `${label}不正确`);
  return v;
}

export function intParam(s: string | undefined, label = '编号'): number {
  if (!s || !/^\d{1,9}$/.test(s)) throw new HttpError(404, `${label}不正确`);
  return Number(s);
}

// ---------------------------------------------------------------- 路由

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  /** 读请求体（JSON 对象），limit 为字节上限 */
  body(limit?: number): Promise<Record<string, unknown>>;
  /** 校验登录令牌，返回当前玩家；未登录抛 401 */
  auth(): PlayerRow;
}

/** 返回非 200 状态码时用 */
export class Reply {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    this.status = status;
    this.body = body;
  }
}

export type Handler = (c: Ctx) => unknown | Promise<unknown>;

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** 例如 /api/admin/tasks/:id；以 /api/admin/ 开头的路由由 app.ts 统一要求家长密码 */
  path: string;
  handler: Handler;
}

/** 各功能模块共享的环境 */
export interface Env {
  db: Db;
  now: () => number;
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) {
      if (!b[i]) return null;
      params[a[i].slice(1)] = b[i];
    } else if (a[i] !== b[i]) return null;
  }
  return params;
}
