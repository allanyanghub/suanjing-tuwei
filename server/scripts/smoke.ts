/**
 * 冒烟测试：用真实的 main.ts 在随机端口、临时数据目录起一个服务器进程，
 * 按一个真实家庭的使用流程把接口走一遍，最后打印摘要。用法：npm run smoke
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

const port = await freePort();
const dataDir = mkdtempSync(join(tmpdir(), 'suanjing-smoke-'));
const ADMIN = 'smoke-parent';
const child = spawn(process.execPath, ['src/main.ts'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_PASSWORD: ADMIN, STATIC_DIR: join(dataDir, 'no-web'), TZ: process.env.TZ ?? 'Asia/Shanghai' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));

const base = `http://127.0.0.1:${port}`;
let calls = 0;
async function call(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<any> {
  calls++;
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}
const A = { 'X-Admin-Password': ADMIN };
const check = (cond: unknown, msg: string) => {
  if (!cond) throw new Error('检查失败：' + msg);
};

const summary: string[] = [];
try {
  for (let i = 0; ; i++) {
    try {
      await fetch(base + '/api/health');
      break;
    } catch {
      if (i > 50) throw new Error('服务器没有启动：\n' + log);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const health = await call('/api/health');
  summary.push(`服务器：端口 ${port}，时区 ${health.tz}（UTC${health.utcOffsetMinutes >= 0 ? '+' : ''}${health.utcOffsetMinutes / 60}），数据库结构版本 ${health.schemaVersion}`);

  // 1. 两个孩子注册，游戏启动时上传目录
  const kids: Record<string, Record<string, string>> = {};
  for (const [name, grade] of [['小明', 3], ['小红', 4]] as const) {
    const r = await call('/api/register', 'POST', { name, password: '1234', grade });
    kids[name] = { Authorization: 'Bearer ' + r.token };
  }
  await call('/api/catalog', 'PUT', {
    topics: [{ id: 'g3-hecha', grade: 3, name: '和差倍问题' }, { id: 'g3-zhishu', grade: 3, name: '植树问题' }, { id: 'g4-jitu', grade: 4, name: '鸡兔同笼' }],
    levels: [{ id: '3-1', grade: 3, name: '和差倍问题', topicIds: ['g3-hecha'], boss: false }, { id: '3-2', grade: 3, name: '植树问题', topicIds: ['g3-zhishu'], boss: false }, { id: '4-1', grade: 4, name: '鸡兔同笼', topicIds: ['g4-jitu'], boss: false }],
  }, kids['小明']);
  const players = (await call('/api/admin/players', 'GET', undefined, A)).players;
  const id = (n: string) => players.find((p: any) => p.name === n).id;

  // 2. 家长：布置任务、出题、留言、设置难度和游戏时间
  const task = (await call('/api/admin/tasks', 'POST', { playerId: id('小明'), kind: 'correct_in_topic', params: { topicId: 'g3-zhishu', count: 5 }, reward: '周末去游乐园', bonusCredits: 200 }, A)).task;
  await call('/api/admin/tasks', 'POST', { playerId: null, kind: 'streak', params: { count: 3 }, title: '全家连对 3 题' }, A);
  const cq = (await call('/api/admin/custom-questions', 'POST', { text: '3 盒鸡蛋每盒 10 个，用了 7 个，还剩几个？', options: ['23 个', '27 个', '20 个', '13 个'], answer: 0, explain: '3 × 10 − 7 = 23', grade: 3 }, A)).question;
  await call('/api/admin/messages', 'POST', { text: '今天表现很棒！', playerId: id('小明') }, A);
  await call(`/api/admin/players/${id('小明')}/settings`, 'PUT', { passAccuracy: 70, gateCount: 2, roundsToWin: 4 }, A);
  await call(`/api/admin/players/${id('小明')}/playtime`, 'PUT', { enabled: true, weekdayMinutes: 40, weekendMinutes: 90 }, A);

  // 3. 小明打开游戏：拉设置、留言、任务、自定义题、游戏时间
  const h = kids['小明'];
  const settings = (await call('/api/settings/me', 'GET', undefined, h)).settings;
  check(settings.gateCount === 2 && settings.roundsToWin === 4, '设置下发');
  check((await call('/api/messages', 'GET', undefined, h)).messages.length === 1, '留言下发');
  check((await call('/api/custom-questions', 'GET', undefined, h)).questions[0].id === cq.id, '自定义题下发');
  check((await call('/api/playtime', 'GET', undefined, h)).enabled === true, '游戏时间');

  // 4. 打一局：答题、心跳、保存存档
  const now = Date.now();
  const answers = [true, true, true, false, true, true].map((c, i) => ({ id: `smoke-${i}`, topicId: 'g3-zhishu', grade: 3, difficulty: 1, correct: c, ms: 6000, context: 'gate', levelId: '3-2', at: now + i }));
  answers.push({ id: 'smoke-c', topicId: 'custom', grade: 3, difficulty: 1, correct: true, ms: 9000, context: 'custom', levelId: '3-2', at: now + 10, customId: cq.id } as any);
  const posted = await call('/api/answers', 'POST', { answers }, h);
  const again = await call('/api/answers', 'POST', { answers }, h);
  check(posted.accepted === 7 && again.duplicates === 7, '答题记录幂等');
  const hb1 = await call('/api/playtime/heartbeat', 'POST', { seconds: 30 }, h);
  await new Promise((r) => setTimeout(r, 5200));
  const hb2 = await call('/api/playtime/heartbeat', 'POST', { seconds: 30 }, h);
  check(hb2.credited <= 8, '心跳按实际间隔计时');
  await call('/api/save', 'PUT', { baseVersion: 0, data: { stars: { '3-1': 2, '3-2': 3 }, wrong: [], stats: { answered: 6, correct: 5, kills: 4, wins: 1 } } }, h);

  // 5. 赛后刷新
  const tasks = (await call('/api/tasks', 'GET', undefined, h)).tasks;
  const done = tasks.filter((t: any) => t.justCompleted);
  for (const t of done) await call(`/api/tasks/${t.id}/ack`, 'POST', {}, h);
  check((await call('/api/tasks', 'GET', undefined, h)).tasks.every((t: any) => !t.justCompleted), 'justCompleted 只出现一次');
  check((await call('/api/custom-questions', 'GET', undefined, h)).questions.length === 0, '自定义题答对后毕业');
  const me = await call('/api/report/me', 'GET', undefined, h);
  const lb = await call('/api/leaderboard', 'GET', undefined, h);

  // 6. 家长查看并兑现奖励
  await call(`/api/admin/tasks/${task.id}/grant`, 'POST', { playerId: id('小明') }, A);
  const report = await call(`/api/admin/players/${id('小明')}/report`, 'GET', undefined, A);
  const dash = await call('/api/admin/dashboard', 'GET', undefined, A);
  const pt = await call(`/api/admin/players/${id('小明')}/playtime`, 'GET', undefined, A);
  const page = await fetch(base + '/admin').then((r) => r.text());
  check(page.includes('家长管理'), '家长页面');
  check((await fetch(base + '/api/admin/dashboard')).status === 403, '无密码访问家长接口被拒');

  summary.push(`注册 2 个孩子；家长布置 2 个任务、1 道自定义题、1 条留言；小明的门槛题数 ${settings.gateCount}、先赢 ${settings.roundsToWin} 回合`);
  summary.push(`答题：提交 ${posted.accepted} 条，重复提交 ${again.duplicates} 条被识别；完成任务 ${done.length} 个：${done.map((t: any) => t.title).join('、')}`);
  summary.push(`心跳：第一次计 ${hb1.credited} 秒，5 秒后再报 30 秒只计 ${hb2.credited} 秒；今日已玩 ${pt.status.usedToday} 秒，剩余 ${pt.status.remaining} 秒`);
  summary.push(`孩子报告：共 ${me.totals.answered} 题，正确率 ${me.totals.accuracy}%，最佳连对 ${me.streak.best}；排行榜本周答对第一：${lb.boards.weekCorrect[0].name}`);
  summary.push(`家长报告：专题 ${report.topics.map((t: any) => `${t.name} ${t.accuracy}%`).join('，')}；总览卡片 ${dash.players.length} 张，待兑现奖励 ${dash.players.find((p: any) => p.name === '小明').rewardsToGrant}`);
  summary.push(`共 ${calls} 次接口调用，全部符合预期`);
  console.log('冒烟测试通过\n- ' + summary.join('\n- '));
} catch (e) {
  console.error('冒烟测试失败：', (e as Error).message);
  console.error(log);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  rmSync(dataDir, { recursive: true, force: true });
}
