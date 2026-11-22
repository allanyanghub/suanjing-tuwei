import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from './helpers.ts';

const pw = (p: string) => ({ 'X-Admin-Password': p });

test('家长改密码：旧密码失效、新密码生效、重启后仍有效；换 ADMIN_PASSWORD 可重置', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'suanjing-pw-'));
  const dbFile = join(dir, 'db.sqlite');
  try {
    let s = await start({ dbFile, adminPassword: 'env-pw-1' });
    try {
      assert.deepEqual((await s.call('/api/admin/password', 'GET', undefined, pw('env-pw-1'))).json, { source: 'env', changedAt: null });

      // 当前密码不对 / 新密码太短 / 首尾空格 → 拒绝，且不改变任何东西
      const change = (body: object) => s.call('/api/admin/password', 'POST', body, pw('env-pw-1'));
      assert.equal((await change({ currentPassword: 'nope', newPassword: 'abcdef' })).status, 400);
      assert.equal((await change({ newPassword: 'abcdef' })).status, 400);
      assert.equal((await change({ currentPassword: 'env-pw-1', newPassword: 'abc' })).status, 400);
      assert.equal((await change({ currentPassword: 'env-pw-1', newPassword: ' abcdef ' })).status, 400);
      assert.equal((await change({ currentPassword: 'env-pw-1', newPassword: '中文密码abcdef' })).status, 400, '请求头传不了中文');
      assert.equal((await s.call('/api/admin/players', 'GET', undefined, pw('env-pw-1'))).status, 200);

      const ok = await change({ currentPassword: 'env-pw-1', newPassword: 'New-pw.123' });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.source, 'custom');
      assert.equal(typeof ok.json.changedAt, 'number');
      assert.equal((await s.call('/api/admin/players', 'GET', undefined, pw('env-pw-1'))).status, 403, '旧密码失效');
      assert.equal((await s.call('/api/admin/players', 'GET', undefined, pw('New-pw.123'))).status, 200, '新密码生效');
      assert.ok(!/pass_hash|salt|env_hash/.test(ok.text));
    } finally {
      await s.stop();
    }

    // 重启，ADMIN_PASSWORD 没变：仍然用改过的密码
    s = await start({ dbFile, adminPassword: 'env-pw-1' });
    try {
      assert.equal((await s.call('/api/admin/players', 'GET', undefined, pw('env-pw-1'))).status, 403);
      assert.equal((await s.call('/api/admin/players', 'GET', undefined, pw('New-pw.123'))).status, 200);
    } finally {
      await s.stop();
    }

    // 忘了密码：换一个 ADMIN_PASSWORD 重启 → 新环境变量密码生效，改过的密码作废
    s = await start({ dbFile, adminPassword: 'env-pw-2' });
    try {
      assert.equal((await s.call('/api/admin/players', 'GET', undefined, pw('New-pw.123'))).status, 403);
      assert.equal((await s.call('/api/admin/players', 'GET', undefined, pw('env-pw-2'))).status, 200);
      assert.equal((await s.call('/api/admin/password', 'GET', undefined, pw('env-pw-2'))).json.source, 'env');
    } finally {
      await s.stop();
    }

    // ADMIN_PASSWORD 为空：管理功能关闭，数据库里的密码也不能用
    s = await start({ dbFile, adminPassword: '' });
    try {
      assert.equal((await s.call('/api/admin/players', 'GET', undefined, pw('env-pw-2'))).status, 403);
    } finally {
      await s.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
