/** 账号、登录、存档，以及最初的几个家长接口（按名字操作，保留兼容） */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { PlayerRow } from '../db.ts';
import { HttpError, Reply, intParam, type Env, type Route } from '../http.ts';
import { loadSave, mergeSaves, sanitize, summarize } from '../save.ts';
import { timeZoneInfo } from '../time.ts';

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex');
}

export function checkPassword(password: string, salt: string, expected: string): boolean {
  const a = Buffer.from(hashPassword(password, salt), 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validName(v: unknown): string {
  if (typeof v !== 'string') throw new HttpError(400, '请填写名字');
  const name = v.trim();
  // 用 Array.from 按字符计数，中文名一个字算一个
  const len = Array.from(name).length;
  if (len < 1 || len > 12) throw new HttpError(400, '名字长度需要 1 到 12 个字');
  if (/[\u0000-\u001f<>"'&\\/]/.test(name)) throw new HttpError(400, '名字里有不能使用的符号');
  return name;
}

export function validPassword(v: unknown): string {
  if (typeof v !== 'string' || v.length < 4 || v.length > 32) throw new HttpError(400, '密码长度需要 4 到 32 位');
  return v;
}

export function validGrade(v: unknown): number {
  const g = typeof v === 'number' ? v : 3;
  return g === 4 || g === 5 || g === 6 ? g : 3;
}

export const publicPlayer = (p: PlayerRow) => ({ name: p.name, grade: p.grade });

/** 家长接口里用编号找玩家 */
export function playerParam(env: Env, s: string | undefined): PlayerRow {
  const p = env.db.playerById(intParam(s, '玩家编号'));
  if (!p) throw new HttpError(404, '没有这个玩家');
  return p;
}

export interface CoreHooks {
  /** 存档变化后（星级可能变了）重新计算任务进度 */
  afterSave(playerId: number): void;
  /** 有人登录：同一个账号在别的设备上的登录已被退出（oldTokens = 被退出的令牌） */
  afterLogin?(playerId: number, oldTokens: string[]): void;
}

export function coreRoutes(env: Env, hooks: CoreHooks): Route[] {
  const { db } = env;
  /** 登录失败限速：名字 → { 连续失败次数, 解锁时间 } */
  const fails = new Map<string, { n: number; until: number }>();

  const newSession = (p: PlayerRow): string => {
    const token = randomBytes(24).toString('hex');
    db.createSession(token, p.id);
    return token;
  };

  const resetPassword = (row: PlayerRow, newPassword: unknown) => {
    const salt = randomBytes(16).toString('hex');
    db.setPassword(row.id, hashPassword(validPassword(newPassword), salt), salt);
    fails.delete(row.name.toLowerCase());
  };

  return [
    { method: 'GET', path: '/api/health', handler: () => ({ ok: true, time: env.now(), schemaVersion: db.schemaVersion(), ...timeZoneInfo(env.now()) }) },

    { method: 'GET', path: '/api/players', handler: () => ({ players: db.listPlayers() }) },

    {
      method: 'POST',
      path: '/api/register',
      handler: async (c) => {
        const b = await c.body();
        const name = validName(b.name);
        const password = validPassword(b.password);
        if (db.playerByName(name)) throw new HttpError(409, '这个名字已经有人用了，换一个吧');
        if (db.listPlayers().length >= 50) throw new HttpError(403, '玩家数量已达上限');
        const salt = randomBytes(16).toString('hex');
        const p = db.createPlayer(name, hashPassword(password, salt), salt, validGrade(b.grade));
        return new Reply(201, { token: newSession(p), player: publicPlayer(p) });
      },
    },

    {
      method: 'POST',
      path: '/api/login',
      handler: async (c) => {
        const b = await c.body();
        const name = validName(b.name);
        const key = name.toLowerCase();
        const now = env.now();
        // 锁定期过后重新计数，否则之后每输错一次都会立刻再锁 30 秒
        const f0 = fails.get(key);
        const f = f0 && f0.until > 0 && f0.until <= now ? undefined : f0;
        if (f && f.until > now) throw new HttpError(429, `密码错得太多了，请 ${Math.ceil((f.until - now) / 1000)} 秒后再试`);
        const p = db.playerByName(name);
        if (!p || typeof b.password !== 'string' || !checkPassword(b.password, p.salt, p.pass_hash)) {
          const n = (f?.n ?? 0) + 1;
          fails.set(key, { n, until: n >= 5 ? now + 30_000 : 0 });
          throw new HttpError(401, '名字或密码不对');
        }
        fails.delete(key);
        // 一个账号同一时间只能在一台设备上登录：新登录把其他设备上的登录挤下线
        const old = db.sessionTokensOf(p.id);
        db.deleteSessionsOf(p.id);
        const token = newSession(p);
        if (old.length) hooks.afterLogin?.(p.id, old);
        return { token, player: publicPlayer(p) };
      },
    },

    {
      method: 'POST',
      path: '/api/logout',
      handler: (c) => {
        const h = c.req.headers.authorization ?? '';
        if (h.startsWith('Bearer ')) db.deleteSession(h.slice(7).trim());
        return { ok: true };
      },
    },

    { method: 'GET', path: '/api/me', handler: (c) => ({ player: publicPlayer(c.auth()) }) },

    {
      method: 'PUT',
      path: '/api/me',
      handler: async (c) => {
        const p = c.auth();
        const b = await c.body();
        if (b.grade !== undefined) db.setGrade(p.id, validGrade(b.grade));
        if (b.newPassword !== undefined) {
          if (typeof b.password !== 'string' || !checkPassword(b.password, p.salt, p.pass_hash)) throw new HttpError(401, '原密码不对');
          const salt = randomBytes(16).toString('hex');
          db.setPassword(p.id, hashPassword(validPassword(b.newPassword), salt), salt);
          const fresh = db.playerById(p.id)!;
          return { token: newSession(fresh), player: publicPlayer(fresh) };
        }
        return { player: publicPlayer(db.playerById(p.id)!) };
      },
    },

    { method: 'GET', path: '/api/save', handler: (c) => loadSave(db, c.auth().id) },

    {
      method: 'PUT',
      path: '/api/save',
      handler: async (c) => {
        const p = c.auth();
        const b = await c.body(2_000_000);
        const cur = loadSave(db, p.id);
        const incoming = sanitize(b.data);
        const baseVersion = typeof b.baseVersion === 'number' ? b.baseVersion : -1;
        const merged = mergeSaves(cur.data, incoming, baseVersion === cur.version);
        const version = cur.version + 1;
        db.putSave(p.id, JSON.stringify(merged), version);
        hooks.afterSave(p.id);
        return { data: merged, version, updatedAt: env.now() };
      },
    },

    // ---- 家长：玩家列表与账号 ----
    {
      method: 'GET',
      path: '/api/admin/players',
      handler: () => ({
        players: db.allPlayerRows().map((row) => {
          const s = loadSave(db, row.id);
          return { id: row.id, name: row.name, grade: row.grade, createdAt: row.created_at, updatedAt: s.updatedAt, summary: summarize(s.data) };
        }),
      }),
    },

    {
      method: 'GET',
      path: '/api/admin/wrong',
      handler: (c) => {
        const row = db.playerByName(c.url.searchParams.get('name') ?? '');
        if (!row) throw new HttpError(404, '没有这个玩家');
        return { name: row.name, wrong: loadSave(db, row.id).data.wrong };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/players/:id/wrong',
      handler: (c) => {
        const row = playerParam(env, c.params.id);
        return { name: row.name, wrong: loadSave(db, row.id).data.wrong };
      },
    },

    {
      method: 'POST',
      path: '/api/admin/reset-password',
      handler: async (c) => {
        const b = await c.body();
        const row = db.playerByName(validName(b.name));
        if (!row) throw new HttpError(404, '没有这个玩家');
        resetPassword(row, b.newPassword);
        return { ok: true };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/players/:id/reset-password',
      handler: async (c) => {
        const row = playerParam(env, c.params.id);
        const b = await c.body();
        resetPassword(row, b.newPassword);
        return { ok: true };
      },
    },

    {
      method: 'POST',
      path: '/api/admin/delete-player',
      handler: async (c) => {
        const b = await c.body();
        const row = db.playerByName(validName(b.name));
        if (!row) throw new HttpError(404, '没有这个玩家');
        db.deletePlayer(row.id);
        return { ok: true };
      },
    },
    {
      method: 'DELETE',
      path: '/api/admin/players/:id',
      handler: (c) => {
        const row = playerParam(env, c.params.id);
        db.deletePlayer(row.id);
        return { ok: true };
      },
    },
  ];
}
