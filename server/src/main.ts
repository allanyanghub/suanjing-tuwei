/** 启动入口。配置全部来自环境变量。 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Db } from './db.ts';
import { createApp } from './app.ts';
import { timeZoneInfo } from './time.ts';

const port = Number(process.env.PORT ?? 8080);
const dataDir = resolve(process.env.DATA_DIR ?? './data');
const staticDir = resolve(process.env.STATIC_DIR ?? '../dist');
const adminPassword = process.env.ADMIN_PASSWORD ?? '';

const db = new Db(resolve(dataDir, 'suanjing.sqlite'));
const hasStatic = existsSync(resolve(staticDir, 'index.html'));
const server = createApp({ db, adminPassword, staticDir: hasStatic ? staticDir : undefined });

server.listen(port, '0.0.0.0', () => {
  console.log(`[算境突围] 服务已启动：端口 ${port}`);
  console.log(`[算境突围] 数据目录：${dataDir}`);
  console.log(hasStatic ? `[算境突围] 游戏网页：${staticDir}` : '[算境突围] 没有找到游戏网页目录，只提供接口');
  if (!adminPassword) console.log('[算境突围] 未设置 ADMIN_PASSWORD，家长管理页面已关闭');
  // 每天的游戏时间、"本周"排行榜都按这个时区计算；容器里请设置 TZ=Asia/Shanghai
  const tz = timeZoneInfo(Date.now());
  console.log(`[算境突围] 时区：${tz.tz}（UTC${tz.utcOffsetMinutes >= 0 ? '+' : ''}${tz.utcOffsetMinutes / 60}）${tz.tzEnv ? '' : '，未设置 TZ 环境变量，建议设置 TZ=Asia/Shanghai'}`);
});

const stop = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
