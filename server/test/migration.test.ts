import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db, SCHEMA_VERSION } from '../src/db.ts';
import { hashPassword } from '../src/features/core.ts';
import { T0, ans, bearer, start } from './helpers.ts';

test('迁移：只有最初三张表的老数据库原地升级，数据不丢', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'suanjing-old-'));
  const file = join(dir, 'suanjing.sqlite');
  try {
    // 用最初版本的建表语句造一个老数据库
    const old = new DatabaseSync(file);
    old.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE players (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, pass_hash TEXT NOT NULL, salt TEXT NOT NULL, grade INTEGER NOT NULL DEFAULT 3, created_at INTEGER NOT NULL);
      CREATE TABLE sessions (token TEXT PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
      CREATE TABLE saves (player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE, data TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    `);
    const salt = 'abcd';
    old.prepare('INSERT INTO players (name, pass_hash, salt, grade, created_at) VALUES (?, ?, ?, ?, ?)').run('老玩家', hashPassword('1234', salt), salt, 5, 111);
    old.prepare('INSERT INTO sessions VALUES (?, 1, 1, 1)').run('oldtoken'.padEnd(48, '0'));
    old.prepare('INSERT INTO saves VALUES (1, ?, 7, 222)').run(JSON.stringify({ stars: { '5-1': 3, '5-2': 1 }, wrong: [], agent: 'yuan', mapChoice: {}, stats: { answered: 40, correct: 30, kills: 5, wins: 2 } }));
    old.close();

    // 用新代码打开两次（第二次验证迁移幂等）
    new Db(file).close();
    const s = await start({ dbFile: file });
    try {
      assert.equal(s.db.schemaVersion(), SCHEMA_VERSION);
      const p = s.db.playerByName('老玩家')!;
      assert.deepEqual([p.grade, p.created_at], [5, 111]);
      // 老令牌仍然有效，老存档仍在
      const h = bearer('oldtoken'.padEnd(48, '0'));
      const sv = await s.call('/api/save', 'GET', undefined, h);
      assert.deepEqual([sv.json.version, sv.json.data.stars['5-1'], sv.json.data.agent], [7, 3, 'yuan']);
      // 老密码能登录
      const lg = await s.call('/api/login', 'POST', { name: '老玩家', password: '1234' });
      assert.equal(lg.status, 200);
      // 重新登录后老令牌被挤下线（一个账号只能在一台设备上登录），后面用新令牌
      assert.equal((await s.call('/api/save', 'GET', undefined, h)).status, 401);
      Object.assign(h, bearer(lg.json.token));
      // 新功能在老玩家身上正常工作
      assert.equal((await s.call('/api/answers', 'POST', { answers: [ans('g5-x', true, T0, { grade: 5 })] }, h)).json.accepted, 1);
      assert.equal((await s.call('/api/settings/me', 'GET', undefined, h)).json.settings.passAccuracy, 60);
      const dash = await s.admin('/api/admin/dashboard');
      assert.deepEqual([dash.json.players[0].stars, dash.json.players[0].cleared, dash.json.players[0].wins], [4, 2, 2]);
    } finally {
      await s.stop();
    }
    // 再次打开：版本不变、数据还在
    const again = new Db(file);
    assert.equal(again.schemaVersion(), SCHEMA_VERSION);
    assert.equal((again.sql.prepare('SELECT COUNT(*) AS n FROM answers').get() as any).n, 1);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
