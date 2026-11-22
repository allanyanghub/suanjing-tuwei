/** 自定义题目（家长出题）：家长增删改题目，孩子在游戏里作答，答对指定次数后对该孩子"毕业" */
import { HttpError, Reply, bool, charLen, cleanText, intParam, num, optText, text, type Env, type Route } from '../http.ts';

const MAX_QUESTIONS = 500;

interface QRow {
  id: number;
  text: string;
  options: string;
  answer: number;
  explain: string;
  grade: number;
  topic_label: string;
  for_all: number;
  active: number;
  required_correct: number;
  created_at: number;
  updated_at: number;
}

const opts = (q: QRow): string[] => {
  try {
    const v: unknown = JSON.parse(q.options);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

function parseOptions(v: unknown): string[] {
  if (!Array.isArray(v) || v.length !== 4) throw new HttpError(400, '需要正好 4 个选项');
  const out = v.map((o, i) => {
    if (typeof o !== 'string') throw new HttpError(400, `第 ${i + 1} 个选项不正确`);
    const s = cleanText(o, false);
    if (!s) throw new HttpError(400, `第 ${i + 1} 个选项是空的`);
    if (charLen(s) > 60) throw new HttpError(400, `第 ${i + 1} 个选项最多 60 个字`);
    return s;
  });
  if (new Set(out).size !== 4) throw new HttpError(400, '4 个选项不能重复');
  return out;
}

export function customRoutes(env: Env): Route[] {
  const { db } = env;

  const qById = (s: string | undefined): QRow => {
    const q = db.q('SELECT * FROM custom_questions WHERE id = ?').get(intParam(s, '题目编号')) as QRow | undefined;
    if (!q) throw new HttpError(404, '没有这道题');
    return q;
  };

  const assigned = (qid: number): number[] =>
    (db.q('SELECT player_id FROM custom_assign WHERE question_id = ? ORDER BY player_id').all(qid) as { player_id: number }[]).map((r) => r.player_id);

  const parseBody = (b: Record<string, unknown>, cur?: QRow) => {
    const t = b.text !== undefined || !cur ? text(b.text, '题目', 300, { multiline: true }) : cur.text;
    const options = b.options !== undefined || !cur ? parseOptions(b.options) : opts(cur);
    const answer = b.answer !== undefined || !cur ? b.answer : cur.answer;
    if (answer !== 0 && answer !== 1 && answer !== 2 && answer !== 3) throw new HttpError(400, '请选择正确答案（0 到 3）');
    const explain = b.explain !== undefined ? optText(b.explain, '解析', 400, true) : cur?.explain ?? '';
    const grade = b.grade !== undefined || !cur ? num(b.grade, '年级', 3, 6) : cur.grade;
    const topicLabel = b.topicLabel !== undefined ? optText(b.topicLabel, '题目分类', 20) : cur?.topic_label ?? '';
    const active = b.active !== undefined ? bool(b.active, '启用开关') : cur ? cur.active === 1 : true;
    const requiredCorrect = b.requiredCorrect !== undefined && b.requiredCorrect !== null ? num(b.requiredCorrect, '需要答对次数', 1, 20) : cur?.required_correct ?? 1;
    let playerIds: number[] | null = cur ? (cur.for_all ? null : assigned(cur.id)) : null;
    if (b.playerIds !== undefined) {
      if (b.playerIds === null) playerIds = null;
      else {
        if (!Array.isArray(b.playerIds) || b.playerIds.length === 0 || b.playerIds.length > 50) throw new HttpError(400, '请选择要出给哪些孩子');
        const ids = new Set<number>();
        for (const v of b.playerIds) {
          if (typeof v !== 'number' || !Number.isInteger(v) || !db.playerById(v)) throw new HttpError(404, '没有这个玩家');
          ids.add(v);
        }
        playerIds = [...ids];
      }
    }
    return { text: t, options, answer, explain, grade, topicLabel, active, requiredCorrect, playerIds };
  };

  const write = (id: number, x: ReturnType<typeof parseBody>) => {
    db.q('DELETE FROM custom_assign WHERE question_id = ?').run(id);
    if (x.playerIds) for (const pid of x.playerIds) db.q('INSERT INTO custom_assign (question_id, player_id) VALUES (?, ?)').run(id, pid);
  };

  const adminView = (q: QRow) => {
    const players = q.for_all ? db.allPlayerRows() : assigned(q.id).map((id) => db.playerById(id)!).filter(Boolean);
    const stats = players.map((p) => {
      const r = db
        .q('SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS c, MAX(at) AS last FROM answers WHERE player_id = ? AND custom_id = ?')
        .get(p.id, q.id) as { n: number; c: number; last: number | null };
      return { playerId: p.id, name: p.name, answered: r.n, correct: r.c, wrong: r.n - r.c, lastAt: r.last, retired: r.c >= q.required_correct };
    });
    return {
      id: q.id,
      text: q.text,
      options: opts(q),
      answer: q.answer,
      explain: q.explain,
      grade: q.grade,
      topicLabel: q.topic_label,
      forAll: q.for_all === 1,
      playerIds: q.for_all ? null : assigned(q.id),
      active: q.active === 1,
      requiredCorrect: q.required_correct,
      createdAt: q.created_at,
      updatedAt: q.updated_at,
      stats,
      totals: { answered: stats.reduce((a, s) => a + s.answered, 0), correct: stats.reduce((a, s) => a + s.correct, 0) },
    };
  };

  return [
    {
      method: 'GET',
      path: '/api/custom-questions',
      handler: (c) => {
        const p = c.auth();
        const rows = db
          .q(
            `SELECT q.*, (SELECT COUNT(*) FROM answers a WHERE a.player_id = ? AND a.custom_id = q.id AND a.correct = 1) AS done
             FROM custom_questions q
             WHERE q.active = 1 AND (q.for_all = 1 OR EXISTS (SELECT 1 FROM custom_assign x WHERE x.question_id = q.id AND x.player_id = ?))
             ORDER BY q.created_at, q.id`,
          )
          .all(p.id, p.id) as unknown as (QRow & { done: number })[];
        return {
          questions: rows
            .filter((q) => q.done < q.required_correct)
            .map((q) => ({
              id: q.id,
              topicId: 'custom',
              grade: q.grade,
              difficulty: 1,
              text: q.text,
              options: opts(q),
              answer: q.answer,
              explain: q.explain,
              topicLabel: q.topic_label,
              remainingCorrect: q.required_correct - q.done,
            })),
        };
      },
    },

    { method: 'GET', path: '/api/admin/custom-questions', handler: () => ({ questions: (db.q('SELECT * FROM custom_questions ORDER BY created_at DESC, id DESC').all() as unknown as QRow[]).map(adminView) }) },

    {
      method: 'POST',
      path: '/api/admin/custom-questions',
      handler: async (c) => {
        const x = parseBody(await c.body());
        if ((db.q('SELECT COUNT(*) AS n FROM custom_questions').get() as { n: number }).n >= MAX_QUESTIONS) throw new HttpError(403, '题目太多了，请先删除一些');
        const now = env.now();
        const id = db.tx(() => {
          const r = db
            .q('INSERT INTO custom_questions (text, options, answer, explain, grade, topic_label, for_all, active, required_correct, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(x.text, JSON.stringify(x.options), x.answer, x.explain, x.grade, x.topicLabel, x.playerIds ? 0 : 1, x.active ? 1 : 0, x.requiredCorrect, now, now);
          const id = Number(r.lastInsertRowid);
          write(id, x);
          return id;
        });
        return new Reply(201, { question: adminView(qById(String(id))) });
      },
    },

    {
      method: 'PUT',
      path: '/api/admin/custom-questions/:id',
      handler: async (c) => {
        const cur = qById(c.params.id);
        const x = parseBody(await c.body(), cur);
        db.tx(() => {
          db.q('UPDATE custom_questions SET text = ?, options = ?, answer = ?, explain = ?, grade = ?, topic_label = ?, for_all = ?, active = ?, required_correct = ?, updated_at = ? WHERE id = ?')
            .run(x.text, JSON.stringify(x.options), x.answer, x.explain, x.grade, x.topicLabel, x.playerIds ? 0 : 1, x.active ? 1 : 0, x.requiredCorrect, env.now(), cur.id);
          write(cur.id, x);
        });
        return { question: adminView(qById(c.params.id)) };
      },
    },

    {
      method: 'DELETE',
      path: '/api/admin/custom-questions/:id',
      handler: (c) => {
        const q = qById(c.params.id);
        db.q('DELETE FROM custom_questions WHERE id = ?').run(q.id);
        return { ok: true };
      },
    },

    {
      method: 'GET',
      path: '/api/admin/custom-questions/:id/stats',
      handler: (c) => {
        const q = qById(c.params.id);
        const attempts = db
          .q('SELECT a.player_id, p.name, a.correct, a.ms, a.at FROM answers a JOIN players p ON p.id = a.player_id WHERE a.custom_id = ? ORDER BY a.at DESC LIMIT 100')
          .all(q.id) as { player_id: number; name: string; correct: number; ms: number | null; at: number }[];
        return {
          question: adminView(q),
          attempts: attempts.map((a) => ({ playerId: a.player_id, name: a.name, correct: a.correct === 1, ms: a.ms, at: a.at })),
        };
      },
    },
  ];
}
