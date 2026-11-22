/**
 * 家长管理密码。
 * - 第一次用的是环境变量 ADMIN_PASSWORD；
 * - 家长在管理页里改密码后，新密码（加盐哈希）存进数据库，从此以数据库为准；
 * - 忘了密码：在 docker-compose.yml 里把 ADMIN_PASSWORD 换成一个新值并重启容器，
 *   新的环境变量密码就重新生效（数据库里那条记录作废）；
 * - ADMIN_PASSWORD 为空时管理功能始终关闭（避免局域网里任何人抢先设密码）。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db.ts';
import { HttpError, type Route } from '../http.ts';
import { checkPassword, hashPassword } from './core.ts';

const sha = (s: string) => createHash('sha256').update(s).digest();

export class AdminAuth {
  /** 最近一次验证通过的密码（sha256），避免每个请求都跑一次 scrypt */
  private okCache: Buffer | null = null;

  private db: Db;
  private envPassword: string;

  constructor(db: Db, envPassword: string) {
    this.db = db;
    this.envPassword = envPassword;
  }

  get enabled(): boolean {
    return this.envPassword !== '';
  }

  /** 数据库里的密码仍然有效（ADMIN_PASSWORD 没换过）时返回那一行 */
  private custom() {
    const row = this.db.adminAuth();
    if (!row || !this.enabled) return undefined;
    return checkPassword(this.envPassword, row.salt, row.env_hash) ? row : undefined;
  }

  /** 校验请求头里的密码；不通过时抛 403 */
  verify(given: string): void {
    if (!this.enabled) throw new HttpError(403, '服务器没有设置家长管理密码，管理功能已关闭');
    const h = sha(given);
    if (this.okCache && timingSafeEqual(h, this.okCache)) return;
    const row = this.custom();
    let ok: boolean;
    if (row) ok = checkPassword(given, row.salt, row.pass_hash);
    else {
      const want = sha(this.envPassword);
      ok = timingSafeEqual(h, want);
    }
    if (!ok) throw new HttpError(403, '家长管理密码不正确');
    this.okCache = h;
  }

  info() {
    const row = this.custom();
    return { source: row ? 'custom' : 'env', changedAt: row ? row.changed_at : null };
  }

  change(current: unknown, next: unknown): void {
    if (typeof current !== 'string' || !current) throw new HttpError(400, '请填写当前密码');
    // 当前密码再核对一次：管理页登录状态可能是别人留下的
    try {
      this.okCache = null;
      this.verify(current);
    } catch {
      throw new HttpError(400, '当前密码不对');
    }
    if (typeof next !== 'string' || next.length < 6 || next.length > 64) throw new HttpError(400, '新密码需要 6 到 64 位');
    if (next.trim() !== next) throw new HttpError(400, '新密码开头和结尾不能是空格');
    // 密码放在请求头里传，请求头只能是 ASCII：中文等字符设上去以后就再也登录不了
    if (!/^[\x21-\x7e ]+$/.test(next)) throw new HttpError(400, '新密码只能用英文字母、数字和符号（不能用中文）');
    const salt = randomBytes(16).toString('hex');
    this.db.setAdminAuth(hashPassword(next, salt), salt, hashPassword(this.envPassword, salt));
    this.okCache = null;
  }
}

export function adminAuthRoutes(auth: AdminAuth): Route[] {
  return [
    { method: 'GET', path: '/api/admin/password', handler: () => auth.info() },
    {
      method: 'POST',
      path: '/api/admin/password',
      handler: async (c) => {
        const b = await c.body();
        auth.change(b.currentPassword, b.newPassword);
        return { ok: true, ...auth.info() };
      },
    },
  ];
}
