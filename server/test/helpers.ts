/** 测试公共部分：带假时钟的服务器、HTTP 调用、造数据 */
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../src/db.ts';
import { createApp } from '../src/app.ts';

// 测试统一在东八区跑，日界线和时间段才有确定结果
process.env.TZ = 'Asia/Shanghai';

/** 2026-11-16 是周一 */
export const T0 = new Date('2026-11-16T10:00:00+08:00').getTime();
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const ADMIN = { 'X-Admin-Password': 'parent-pw' };
export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

export interface Resp {
  status: number;
  json: any;
  text: string;
  headers: Headers;
}

export async function start(o: { now?: number; adminPassword?: string; dbFile?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'suanjing-'));
  const clock = { t: o.now ?? T0 };
  const db = new Db(o.dbFile ?? join(dir, 'db.sqlite'));
  const server = createApp({ db, adminPassword: o.adminPassword ?? 'parent-pw', now: () => clock.t });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<Resp> => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 非 JSON */
    }
    return { status: r.status, json, text, headers: r.headers };
  };
  const admin = (path: string, method = 'GET', body?: unknown) => call(path, method, body, ADMIN);
  /** 注册一个孩子，返回 { id, token, h(授权头), call(带授权的调用) } */
  const kid = async (name: string, grade = 3) => {
    const r = await call('/api/register', 'POST', { name, password: '1234', grade });
    if (r.status !== 201) throw new Error('register failed ' + r.text);
    const token = r.json.token as string;
    const id = db.playerByName(name)!.id;
    const h = bearer(token);
    return { id, token, h, call: (path: string, method = 'GET', body?: unknown) => call(path, method, body, h) };
  };
  return {
    base,
    call,
    admin,
    kid,
    db,
    dir,
    clock,
    advance: (ms: number) => (clock.t += ms),
    stop: () =>
      new Promise<void>((r) =>
        server.close(() => {
          db.close();
          rmSync(dir, { recursive: true, force: true });
          r();
        }),
      ),
  };
}

let seq = 0;
/** 造一条答题记录 */
export function ans(topicId: string, correct: boolean, at: number, extra: Record<string, unknown> = {}) {
  return { id: `a${++seq}-${at}`, topicId, grade: 3, difficulty: 1, correct, ms: 5000, context: 'gate', levelId: '3-1', at, ...extra };
}

export const CATALOG = {
  topics: [
    { id: 'g3-hecha', grade: 3, name: '和差倍问题' },
    { id: 'g3-zhishu', grade: 3, name: '植树问题' },
    { id: 'g4-jitu', grade: 4, name: '鸡兔同笼' },
  ],
  levels: [
    { id: '3-1', grade: 3, name: '和差倍问题', topicIds: ['g3-hecha'], boss: false },
    { id: '3-2', grade: 3, name: '植树问题', topicIds: ['g3-zhishu'], boss: false },
    { id: '3-3', grade: 3, name: '三年级综合战', topicIds: ['g3-hecha', 'g3-zhishu'], boss: true },
    { id: '4-1', grade: 4, name: '鸡兔同笼', topicIds: ['g4-jitu'], boss: false },
  ],
};
