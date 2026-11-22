import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Db } from '../src/db.ts';
import { ClientLog, IP_LIMIT, IP_WINDOW, MAX_ENTRY, MAX_FILE, cleanReport } from '../src/features/clientlog.ts';
import { start } from './helpers.ts';

test('客户端错误日志：公开上报、逐条校验截断、家长查看（新的在前）', async () => {
  const s = await start();
  try {
    const r = await s.call('/api/client-log', 'POST', [
      { kind: 'error', msg: 'TypeError: x is undefined', stack: 'at a\nat b', ctx: { q: 'high', dpr: 2, lost: false, nested: { no: 1 }, bad: NaN } },
      { kind: 'context-lost', msg: '画面丢失', count: 3, t: 123.4 },
      { kind: 'hack', msg: '未知类型丢弃' },
      'not an object',
      { kind: 'perf', msg: 'x'.repeat(5000), stack: 'y'.repeat(5000) },
    ]);
    assert.equal(r.status, 200);
    assert.equal(r.json.accepted, 3);
    assert.equal(r.json.dropped, 2);
    // { reports: [...] } 的写法也接受；text/plain（sendBeacon）也行
    const r2 = await fetch(s.base + '/api/client-log', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ reports: [{ kind: 'info', msg: 'beacon' }] }) });
    assert.equal(r2.status, 200);
    const file = join(s.dir, 'client-errors.log');
    assert.ok(existsSync(file), '日志写在数据库文件旁边');
    assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 4);

    assert.equal((await s.call('/api/admin/client-log')).status, 403, '查看需要家长密码');
    const g = await s.admin('/api/admin/client-log?limit=10');
    assert.equal(g.status, 200);
    const es = g.json.entries;
    assert.deepEqual(
      es.map((e: any) => e.kind),
      ['info', 'perf', 'context-lost', 'error'],
    );
    assert.equal(es[3].ip, '127.0.0.1');
    assert.deepEqual(es[3].ctx, { q: 'high', dpr: 2, lost: false }, '上下文只留简单值');
    assert.equal(es[2].count, 3);
    assert.equal(es[2].t, 123);
    assert.ok(JSON.stringify(es[1]).length <= MAX_ENTRY, '超长记录被截断');
    assert.ok(es[1].msg.length <= 1001);
    assert.equal((await s.admin('/api/admin/client-log?limit=1')).json.entries.length, 1);

    for (const body of [{ kind: 'error' }, 'abc', 5]) assert.equal((await s.call('/api/client-log', 'POST', body)).status, 400, JSON.stringify(body));
    const bad = await fetch(s.base + '/api/client-log', { method: 'POST', body: '{oops' });
    assert.equal(bad.status, 400);
    const big = await fetch(s.base + '/api/client-log', { method: 'POST', body: JSON.stringify([{ kind: 'error', msg: 'z'.repeat(200_000) }]) });
    assert.equal(big.status, 413);
  } finally {
    await s.stop();
  }
});

test('客户端错误日志：按 IP 限流，窗口过后恢复', async () => {
  const s = await start();
  try {
    let accepted = 0;
    for (let i = 0; i < 5; i++) {
      const r = await s.call('/api/client-log', 'POST', Array.from({ length: 30 }, (_, k) => ({ kind: 'error', msg: `e${i}-${k}` })));
      if (r.status === 200) accepted += r.json.accepted;
      else assert.equal(r.status, 429);
    }
    assert.equal(accepted, IP_LIMIT, '每批最多 20 条，窗口内最多 IP_LIMIT 条');
    assert.equal((await s.call('/api/client-log', 'POST', [{ kind: 'error', msg: 'more' }])).status, 429);
    s.advance(IP_WINDOW + 1);
    assert.equal((await s.call('/api/client-log', 'POST', [{ kind: 'error', msg: 'later' }])).json.accepted, 1);
  } finally {
    await s.stop();
  }
});

test('客户端错误日志：文件超过上限时只保留较新的一半', async () => {
  const s = await start();
  try {
    const file = join(s.dir, 'rot.log');
    const log = new ClientLog({ db: s.db, now: () => 1 }, { file });
    // 先造一个接近上限的旧文件
    const old = JSON.stringify({ at: 0, ip: '', kind: 'error', msg: 'old'.padEnd(200, '.'), ctx: {} }) + '\n';
    writeFileSync(file, old.repeat(Math.ceil(MAX_FILE / old.length)));
    log.append([cleanReport({ kind: 'error', msg: 'newest' }, 2, '1.2.3.4')!]);
    const size = statSync(file).size;
    assert.ok(size <= MAX_FILE / 2 + 1000, `截断后 ${size} 字节`);
    const recent = log.recent(3);
    assert.equal(recent[0].msg, 'newest');
    assert.equal(recent[1].msg.slice(0, 3), 'old');
    // 每一行都是完整的 JSON
    for (const line of readFileSync(file, 'utf8').trim().split('\n')) JSON.parse(line);
  } finally {
    await s.stop();
  }
});

test('客户端错误日志：内存数据库且没有 DATA_DIR 时记在内存里', () => {
  const prev = process.env.DATA_DIR;
  delete process.env.DATA_DIR;
  const db = new Db(':memory:');
  try {
    const log = new ClientLog({ db, now: () => 1 });
    assert.equal(log.file, '');
    log.append([cleanReport({ kind: 'perf', msg: 'fps 12' }, 1, 'x')!]);
    assert.equal(log.recent(5)[0].msg, 'fps 12');
  } finally {
    db.close();
    if (prev !== undefined) process.env.DATA_DIR = prev;
  }
});
