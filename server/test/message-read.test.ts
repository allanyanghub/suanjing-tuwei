import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.ts';

test('留言已读：孩子标记后不再返回给他，其他孩子不受影响；家长能看到谁读过', async () => {
  const s = await start();
  try {
    const a = await s.kid('甲');
    const b = await s.kid('乙');
    const all = (await s.admin('/api/admin/messages', 'POST', { text: '大家加油' })).json.message.id;
    const toA = (await s.admin('/api/admin/messages', 'POST', { text: '甲：今天早点睡', playerId: a.id })).json.message.id;
    const toB = (await s.admin('/api/admin/messages', 'POST', { text: '乙专属', playerId: b.id })).json.message.id;
    const ids = async (k: typeof a) => (await k.call('/api/messages')).json.messages.map((m: { id: number }) => m.id).sort();

    assert.deepEqual(await ids(a), [all, toA].sort());

    // 甲读了两条，还试图标记一条不是给他的（应被忽略）
    const r = await a.call('/api/messages/read', 'POST', { ids: [all, toA, toB, 99999] });
    assert.equal(r.status, 200);
    assert.equal(r.json.marked, 2);
    assert.deepEqual(await ids(a), []);
    assert.deepEqual(await ids(b), [all, toB].sort(), '乙不受影响');
    // 重复标记无副作用
    assert.equal((await a.call('/api/messages/read', 'POST', { ids: [all] })).json.marked, 0);

    // 参数校验与登录
    assert.equal((await a.call('/api/messages/read', 'POST', { ids: 'x' })).status, 400);
    assert.equal((await a.call('/api/messages/read', 'POST', { ids: [1.5] })).status, 400);
    assert.equal((await s.call('/api/messages/read', 'POST', { ids: [all] })).status, 401);

    // 家长端：谁读过
    const adm = (await s.admin('/api/admin/messages')).json.messages as { id: number; readBy: { name: string }[] }[];
    const by = (id: number) => adm.find((m) => m.id === id)!.readBy.map((x) => x.name);
    assert.deepEqual(by(all), ['甲']);
    assert.deepEqual(by(toA), ['甲']);
    assert.deepEqual(by(toB), []);

    // 删除留言时已读记录一起删
    assert.equal((await s.admin(`/api/admin/messages/${all}`, 'DELETE')).status, 200);
    assert.equal((s.db.sql.prepare('SELECT COUNT(*) AS n FROM message_reads WHERE message_id = ?').get(all) as { n: number }).n, 0);
  } finally {
    await s.stop();
  }
});
