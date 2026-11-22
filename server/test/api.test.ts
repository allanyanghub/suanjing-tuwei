import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { mergeSaves, sanitize, emptySave } from '../src/save.ts';

async function start(adminPassword = 'parent-pw') {
  const dir = mkdtempSync(join(tmpdir(), 'suanjing-'));
  mkdirSync(join(dir, 'www', 'assets'), { recursive: true });
  writeFileSync(join(dir, 'www', 'index.html'), '<h1>game</h1>');
  writeFileSync(join(dir, 'www', 'assets', 'a.glb'), 'GLB');
  writeFileSync(join(dir, 'secret.txt'), 'top secret');
  const db = new Db(join(dir, 'db.sqlite'));
  const server = createApp({ db, adminPassword, staticDir: join(dir, 'www') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  return { base, call, db, dir, stop: () => new Promise<void>((r) => server.close(() => { db.close(); rmSync(dir, { recursive: true, force: true }); r(); })) };
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const wrong = (time: number, text: string) => ({ q: { text, options: ['1', '2', '3', '4'], answer: 0, explain: 'e' }, picked: 1, time, levelId: '3-1' });

test('注册、登录、名字列表', async () => {
  const s = await start();
  try {
    assert.equal((await s.call('/api/health')).json.ok, true);
    const r = await s.call('/api/register', 'POST', { name: '小明', password: '1234', grade: 4 });
    assert.equal(r.status, 201);
    assert.equal(r.json.player.name, '小明');
    assert.equal(r.json.player.grade, 4);
    assert.ok(r.json.token.length >= 32);
    assert.equal((await s.call('/api/register', 'POST', { name: '小明', password: '9999' })).status, 409);
    assert.equal((await s.call('/api/register', 'POST', { name: '', password: '1234' })).status, 400);
    assert.equal((await s.call('/api/register', 'POST', { name: '小红', password: '12' })).status, 400);
    assert.equal((await s.call('/api/register', 'POST', { name: '<b>x', password: '1234' })).status, 400);
    assert.deepEqual((await s.call('/api/players')).json.players, [{ name: '小明', grade: 4 }]);
    assert.equal((await s.call('/api/login', 'POST', { name: '小明', password: 'nope' })).status, 401);
    const l = await s.call('/api/login', 'POST', { name: '小明', password: '1234' });
    assert.equal(l.status, 200);
    assert.equal((await s.call('/api/me', 'GET', undefined, bearer(l.json.token))).json.player.name, '小明');
    assert.equal((await s.call('/api/me')).status, 401);
    await s.call('/api/logout', 'POST', {}, bearer(l.json.token));
    assert.equal((await s.call('/api/me', 'GET', undefined, bearer(l.json.token))).status, 401);
    // 密码不以明文保存
    const row = s.db.playerByName('小明')!;
    assert.ok(!row.pass_hash.includes('1234') && row.pass_hash.length === 64);
  } finally { await s.stop(); }
});

test('连续输错密码会被暂时锁定', async () => {
  const s = await start();
  try {
    await s.call('/api/register', 'POST', { name: 'kid', password: '1234' });
    for (let i = 0; i < 5; i++) assert.equal((await s.call('/api/login', 'POST', { name: 'kid', password: 'bad!' })).status, 401);
    assert.equal((await s.call('/api/login', 'POST', { name: 'kid', password: '1234' })).status, 429);
  } finally { await s.stop(); }
});

test('存档：保存、读取、两台设备合并、进度不倒退', async () => {
  const s = await start();
  try {
    const t = (await s.call('/api/register', 'POST', { name: 'a', password: '1234' })).json.token;
    const h = bearer(t);
    const g0 = await s.call('/api/save', 'GET', undefined, h);
    assert.equal(g0.json.version, 0);
    assert.deepEqual(g0.json.data.stars, {});
    // 设备 1 在版本 0 的基础上保存
    const p1 = await s.call('/api/save', 'PUT', { baseVersion: 0, data: { stars: { '3-1': 2 }, wrong: [wrong(100, 'q1'), wrong(200, 'q2')], agent: 'yuan', mapChoice: {}, stats: { answered: 10, correct: 7, kills: 3, wins: 1 } } }, h);
    assert.equal(p1.json.version, 1);
    // 设备 2 没拿到版本 1，仍以版本 0 为基础保存：应取并集，星级取较大值
    const p2 = await s.call('/api/save', 'PUT', { baseVersion: 0, data: { stars: { '3-1': 1, '3-2': 3 }, wrong: [wrong(300, 'q3')], agent: 'heng', mapChoice: {}, stats: { answered: 4, correct: 4, kills: 9, wins: 0 } } }, h);
    assert.equal(p2.json.version, 2);
    assert.deepEqual(p2.json.data.stars, { '3-1': 2, '3-2': 3 });
    assert.deepEqual(p2.json.data.wrong.map((w: any) => w.q.text), ['q3', 'q2', 'q1']);
    assert.deepEqual(p2.json.data.stats, { answered: 10, correct: 7, kills: 9, wins: 1 });
    // 在最新版本基础上订正掉一道错题：以客户端为准，错题不会复活；星级即使传小了也不倒退
    const p3 = await s.call('/api/save', 'PUT', { baseVersion: 2, data: { ...p2.json.data, stars: { '3-1': 0 }, wrong: p2.json.data.wrong.filter((w: any) => w.q.text !== 'q2') } }, h);
    assert.deepEqual(p3.json.data.wrong.map((w: any) => w.q.text), ['q3', 'q1']);
    assert.deepEqual(p3.json.data.stars, { '3-1': 2, '3-2': 3 });
    const g = await s.call('/api/save', 'GET', undefined, h);
    assert.equal(g.json.version, 3);
    assert.deepEqual(g.json.data, p3.json.data);
    // 别的玩家看不到这份存档
    const t2 = (await s.call('/api/register', 'POST', { name: 'b', password: '1234' })).json.token;
    assert.deepEqual((await s.call('/api/save', 'GET', undefined, bearer(t2))).json.data.stars, {});
    assert.equal((await s.call('/api/save')).status, 401);
  } finally { await s.stop(); }
});

test('存档清洗：非法内容被丢弃而不是存进去', () => {
  const x = sanitize({ stars: { '3-1': 99, bad: 'x' }, wrong: [{ nope: 1 }, wrong(1, 'ok')], agent: 5, stats: { answered: 3, correct: 10, kills: -4, wins: 1.9 }, extra: 'ignored' });
  assert.deepEqual(x.stars, { '3-1': 3 });
  assert.equal(x.wrong.length, 1);
  assert.equal(x.agent, 'ling');
  assert.deepEqual(x.stats, { answered: 3, correct: 3, kills: 0, wins: 1 });
  assert.deepEqual(sanitize('garbage'), emptySave());
  const many = Array.from({ length: 300 }, (_, i) => wrong(i, 'q' + i));
  assert.equal(mergeSaves(sanitize({ wrong: many.slice(0, 200) }), sanitize({ wrong: many.slice(150) }), false).wrong.length, 200);
});

test('段位：清洗、补段位、合并取局数多的', () => {
  assert.deepEqual(sanitize({ stats: { wins: 4 }, stars: { a: 3, b: 3 } }).rank, { pts: 6, best: 6, n: 0 }, '老存档补段位');
  assert.deepEqual(sanitize({ stats: { wins: 99 } }).rank.pts, 18, '补段位最高到黄金 III');
  assert.deepEqual(sanitize({ rank: { pts: 7.6, best: 3, n: -2 } }).rank, { pts: 7, best: 7, n: 0 });
  assert.deepEqual(sanitize({ rank: 'x', stats: { wins: 2 } }).rank, { pts: 2, best: 2, n: 0 });
  const a = sanitize({ rank: { pts: 10, best: 20, n: 8 } });
  const b = sanitize({ rank: { pts: 25, best: 25, n: 7 } });
  // 掉星后的新存档（局数更多）不会被旧存档的高星数盖掉；历史最高取较大值
  assert.deepEqual(mergeSaves(b, a, true).rank, { pts: 10, best: 25, n: 8 });
  assert.deepEqual(mergeSaves(a, b, false).rank, { pts: 10, best: 25, n: 8 });
});

test('家长管理：需要密码，可看进度、重置密码、删除玩家', async () => {
  const s = await start('parent-pw');
  try {
    const t = (await s.call('/api/register', 'POST', { name: 'kid', password: '1234' })).json.token;
    await s.call('/api/save', 'PUT', { baseVersion: 0, data: { stars: { '3-1': 2, '3-2': 0 }, wrong: [wrong(1, 'q')], stats: { answered: 5, correct: 4, kills: 0, wins: 1 } } }, bearer(t));
    assert.equal((await s.call('/api/admin/players')).status, 403);
    assert.equal((await s.call('/api/admin/players', 'GET', undefined, { 'X-Admin-Password': 'wrong' })).status, 403);
    const a = { 'X-Admin-Password': 'parent-pw' };
    const list = await s.call('/api/admin/players', 'GET', undefined, a);
    assert.equal(list.json.players[0].name, 'kid');
    assert.deepEqual(list.json.players[0].summary, { stars: 2, cleared: 1, answered: 5, correct: 4, wins: 1, wrong: 1, rank: 1 }, '老存档按 胜场 1 + 星星 2/3 补段位');
    assert.equal((await s.call('/api/admin/wrong?name=kid', 'GET', undefined, a)).json.wrong.length, 1);
    assert.equal((await s.call('/api/admin/reset-password', 'POST', { name: 'kid', newPassword: 'newpw' }, a)).status, 200);
    assert.equal((await s.call('/api/me', 'GET', undefined, bearer(t))).status, 401, '重置密码后旧登录失效');
    assert.equal((await s.call('/api/login', 'POST', { name: 'kid', password: 'newpw' })).status, 200);
    assert.equal((await s.call('/api/admin/delete-player', 'POST', { name: 'kid' }, a)).status, 200);
    assert.deepEqual((await s.call('/api/players')).json.players, []);
    assert.equal((await s.call('/admin')).text.includes('家长管理'), true);
  } finally { await s.stop(); }
  const off = await start('');
  try {
    assert.equal((await off.call('/api/admin/players', 'GET', undefined, { 'X-Admin-Password': '' })).status, 403, '未设置管理密码时管理接口关闭');
  } finally { await off.stop(); }
});

test('静态文件：能取到网页和素材，不能越出网页目录', async () => {
  const s = await start();
  try {
    const i = await s.call('/');
    assert.equal(i.status, 200);
    assert.ok(i.text.includes('game'));
    const g = await s.call('/assets/a.glb');
    assert.equal(g.status, 200);
    assert.equal(g.headers.get('content-type'), 'model/gltf-binary');
    assert.equal((await s.call('/assets/missing.glb')).status, 404);
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/../../secret.txt']) {
      const r = await fetch(s.base + p);
      const body = await r.text();
      assert.ok(!body.includes('top secret'), `不应泄露：${p}`);
    }
    // 直接用原始请求再试一次（fetch 会规范化路径）
    const net = await import('node:net');
    const raw = await new Promise<string>((res) => {
      const u = new URL(s.base);
      const c = net.connect(Number(u.port), u.hostname, () => c.write('GET /../secret.txt HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
      let buf = '';
      c.on('data', (d) => (buf += d));
      c.on('end', () => res(buf));
    });
    assert.ok(!raw.includes('top secret'));
    assert.equal((await s.call('/api/nope')).status, 404);
    assert.equal((await s.call('/api/login', 'POST', undefined)).status, 400);
  } finally { await s.stop(); }
});
