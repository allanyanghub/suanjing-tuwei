/** HTTP 服务：把各功能模块（features/*.ts）的路由组装起来，外加静态文件和家长页面。仅使用 Node 内置模块。 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import type { Db, PlayerRow } from './db.ts';
import { ADMIN_HTML } from './admin-page.ts';
import { HttpError, Reply, matchPath, readJson, send, type Ctx, type Env, type Route } from './http.ts';
import { CatalogStore, catalogRoutes } from './features/catalog.ts';
import { coreRoutes } from './features/core.ts';
import { answerRoutes } from './features/answers.ts';
import { TaskService, taskRoutes } from './features/tasks.ts';
import { PlaytimeService, playtimeRoutes } from './features/playtime.ts';
import { messageRoutes } from './features/messages.ts';
import { customRoutes } from './features/custom.ts';
import { settingsRoutes } from './features/settings.ts';
import { familyRoutes } from './features/family.ts';
import { AdminAuth, adminAuthRoutes } from './features/admin-auth.ts';
import { clientLogRoutes } from './features/clientlog.ts';
import { CoopHub, rejectUpgrade, type CoopOptions } from './coop.ts';

export interface AppOptions {
  db: Db;
  /** 家长管理的初始密码（环境变量 ADMIN_PASSWORD）；为空则关闭管理接口。家长可在管理页里改密码，见 features/admin-auth.ts */
  adminPassword: string;
  /** 游戏网页（vite build 的 dist 目录）；为空则只提供接口 */
  staticDir?: string;
  /** 时钟（毫秒时间戳），默认 Date.now；测试里注入假时钟来模拟时间流逝 */
  now?: () => number;
  /** 合作模式 WebSocket 的参数（心跳间隔、超时等），测试里可以调小；默认值见 coop.ts */
  coop?: CoopOptions;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** 旧设备被挤下线时看到的话（客户端按「另一台设备」识别，改的话两边一起改） */
export const REPLACED_TEXT = '这个账号在另一台设备上登录了，这台设备已自动退出';

export function createApp(opts: AppOptions): Server {
  const { db } = opts;
  const now = opts.now ?? Date.now;
  db.now = now;
  const env: Env = { db, now };
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : '';

  const catalog = new CatalogStore(env);
  const tasks = new TaskService(env, catalog);
  const playtime = new PlaytimeService(env);
  const adminAuth = new AdminAuth(db, opts.adminPassword);

  // 合作模式（WebSocket 房间）；登录挤下线时也要断开旧设备的合作连接
  const coop = new CoopHub(db, opts.coop);
  /** 因为同一账号在别的设备上登录而失效的令牌 → 失效时间（只为了给旧设备一句准确的提示；重启后忘掉也没关系） */
  const replaced = new Map<string, number>();

  const routes: Route[] = [
    ...coreRoutes(env, {
      afterSave: (id) => void tasks.evaluate(id),
      afterLogin: (id, oldTokens) => {
        for (const t of oldTokens) replaced.set(t, now());
        if (replaced.size > 500) for (const k of [...replaced.keys()].slice(0, replaced.size - 500)) replaced.delete(k);
        coop.kickPlayer(id, REPLACED_TEXT);
      },
    }),
    ...catalogRoutes(catalog),
    ...answerRoutes(env, catalog, { afterAnswers: (id) => tasks.evaluate(id) }),
    ...taskRoutes(env, catalog, tasks),
    ...playtimeRoutes(env, playtime),
    ...messageRoutes(env),
    ...customRoutes(env),
    ...settingsRoutes(env),
    ...familyRoutes(env, catalog, tasks, playtime),
    ...adminAuthRoutes(adminAuth),
    ...clientLogRoutes(env),
  ];

  const auth = (req: IncomingMessage): PlayerRow => {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const p = token ? db.playerBySession(token) : undefined;
    if (!p) throw new HttpError(401, replaced.has(token) ? REPLACED_TEXT : '请先登录');
    return p;
  };

  const admin = (req: IncomingMessage): void => adminAuth.verify(String(req.headers['x-admin-password'] ?? ''));

  async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    // 所有家长接口统一校验密码（在找路由之前，避免探测接口是否存在）
    if (path.startsWith('/api/admin/')) admin(req);
    const method = req.method ?? 'GET';
    let pathMatched = false;
    for (const r of routes) {
      const params = matchPath(r.path, path);
      if (!params) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const ctx: Ctx = {
        req,
        res,
        url: new URL(req.url ?? '/', 'http://localhost'),
        params,
        body: (limit) => readJson(req, limit),
        auth: () => auth(req),
      };
      const out = await r.handler(ctx);
      if (out instanceof Reply) return send(res, out.status, out.body);
      return send(res, 200, out);
    }
    if (pathMatched) throw new HttpError(405, '不支持的请求方式');
    throw new HttpError(404, '没有这个接口');
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): void {
    if (!staticRoot) throw new HttpError(404, '未找到');
    let rel: string;
    try {
      rel = decodeURIComponent(path);
    } catch {
      throw new HttpError(400, '地址不正确');
    }
    let file = normalize(join(staticRoot, rel));
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) throw new HttpError(403, '禁止访问');
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) {
      // 没有扩展名的地址回退到首页
      if (extname(rel)) throw new HttpError(404, '未找到');
      file = join(staticRoot, 'index.html');
      if (!existsSync(file)) throw new HttpError(404, '未找到');
    }
    const st = statSync(file);
    const ext = extname(file).toLowerCase();
    const hashed = /[\\/]assets[\\/].+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  }

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    // 开发时网页（5183 端口）和接口（8080 端口）不同源，这里放开跨域；登录用的是请求头里的令牌，不是 Cookie
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Password');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    (async () => {
      if (path.startsWith('/api/')) await api(req, res, path);
      else if (path === '/admin' || path === '/admin/') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'",
        });
        res.end(ADMIN_HTML);
      } else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, path);
      else throw new HttpError(405, '不支持的请求方式');
    })().catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (!(e instanceof HttpError)) console.error('[server] 未处理的错误', e);
      if (!res.headersSent) send(res, status, { error: e instanceof HttpError ? e.message : '服务器出错了' });
      else res.end();
    });
  });

  // 合作模式：只有 /api/coop 能升级成 WebSocket，其他地址一律拒绝
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/api/coop') coop.handleUpgrade(req, socket, head);
    else rejectUpgrade(socket, 404, 'Not Found');
  });
  // server.close() 会等所有连接结束，WebSocket 长连接要先关掉，否则停机 / 测试会卡住
  const close = server.close.bind(server);
  server.close = ((cb?: (err?: Error) => void) => {
    coop.shutdown();
    return close(cb);
  }) as typeof server.close;
  return server;
}
