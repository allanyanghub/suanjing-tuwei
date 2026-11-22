/** 家长留言：发给某个孩子或所有人的短消息（纯文本，可设过期时间）。孩子看过（标为已读）后不再返回给他。 */
import { HttpError, Reply, intParam, optNum, text, type Env, type Route } from '../http.ts';

const MAX_MESSAGES = 200;

interface MessageRow {
  id: number;
  player_id: number | null;
  text: string;
  created_at: number;
  expires_at: number | null;
}

const view = (m: MessageRow) => ({ id: m.id, text: m.text, forAll: m.player_id === null, createdAt: m.created_at, expiresAt: m.expires_at });

export function messageRoutes(env: Env): Route[] {
  const { db } = env;
  return [
    {
      method: 'GET',
      path: '/api/messages',
      handler: (c) => {
        const p = c.auth();
        const rows = db
          .q(
            `SELECT * FROM messages m WHERE (m.player_id = ? OR m.player_id IS NULL) AND (m.expires_at IS NULL OR m.expires_at > ?)
               AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.message_id = m.id AND r.player_id = ?)
             ORDER BY m.created_at DESC, m.id DESC LIMIT 20`,
          )
          .all(p.id, env.now(), p.id) as unknown as MessageRow[];
        return { messages: rows.map(view) };
      },
    },
    {
      // 孩子看过留言：{ ids: number[] }。只记录确实发给他的留言；重复标记无副作用
      method: 'POST',
      path: '/api/messages/read',
      handler: async (c) => {
        const p = c.auth();
        const b = await c.body();
        if (!Array.isArray(b.ids) || b.ids.length > 100 || !b.ids.every((x: unknown) => Number.isSafeInteger(x))) throw new HttpError(400, 'ids 需要是留言编号数组（最多 100 个）');
        const now = env.now();
        let marked = 0;
        db.tx(() => {
          for (const id of b.ids as number[]) {
            const r = db
              .q(
                `INSERT INTO message_reads (message_id, player_id, read_at)
                 SELECT id, ?, ? FROM messages WHERE id = ? AND (player_id = ? OR player_id IS NULL)
                 ON CONFLICT DO NOTHING`,
              )
              .run(p.id, now, id, p.id);
            marked += Number(r.changes);
          }
        });
        return { ok: true, marked };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/messages',
      handler: () => {
        const rows = db
          .q('SELECT m.*, p.name AS player_name FROM messages m LEFT JOIN players p ON p.id = m.player_id ORDER BY m.created_at DESC, m.id DESC LIMIT 200')
          .all() as unknown as (MessageRow & { player_name: string | null })[];
        const now = env.now();
        const reads = db
          .q('SELECT r.message_id, r.player_id, r.read_at, p.name FROM message_reads r JOIN players p ON p.id = r.player_id ORDER BY r.read_at')
          .all() as unknown as { message_id: number; player_id: number; read_at: number; name: string }[];
        const readBy = new Map<number, { playerId: number; name: string; readAt: number }[]>();
        for (const r of reads) {
          let a = readBy.get(r.message_id);
          if (!a) readBy.set(r.message_id, (a = []));
          a.push({ playerId: r.player_id, name: r.name, readAt: r.read_at });
        }
        return {
          messages: rows.map((m) => ({ ...view(m), playerId: m.player_id, playerName: m.player_name, expired: m.expires_at !== null && m.expires_at <= now, readBy: readBy.get(m.id) ?? [] })),
        };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/messages',
      handler: async (c) => {
        const b = await c.body();
        const t = text(b.text, '留言', 200, { multiline: true });
        let playerId: number | null = null;
        if (b.playerId !== undefined && b.playerId !== null) {
          if (typeof b.playerId !== 'number' || !db.playerById(b.playerId)) throw new HttpError(404, '没有这个玩家');
          playerId = b.playerId;
        }
        // 过期时间：expiresInHours（1 小时到 30 天），不填则一直有效直到删除
        const hours = optNum(b.expiresInHours, '有效时长', 1, 720);
        const now = env.now();
        const n = (db.q('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n;
        if (n >= MAX_MESSAGES) db.q('DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY created_at LIMIT ?)').run(n - MAX_MESSAGES + 1);
        const r = db.q('INSERT INTO messages (player_id, text, created_at, expires_at) VALUES (?, ?, ?, ?)').run(playerId, t, now, hours === null ? null : now + hours * 3_600_000);
        const row = db.q('SELECT * FROM messages WHERE id = ?').get(Number(r.lastInsertRowid)) as unknown as MessageRow;
        return new Reply(201, { message: view(row) });
      },
    },
    {
      method: 'DELETE',
      path: '/api/admin/messages/:id',
      handler: (c) => {
        const r = db.q('DELETE FROM messages WHERE id = ?').run(intParam(c.params.id, '留言编号'));
        if (!Number(r.changes)) throw new HttpError(404, '没有这条留言');
        return { ok: true };
      },
    },
  ];
}
