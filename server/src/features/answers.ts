/** 答题记录（幂等批量上报）与学习报告 */
import { HttpError, isObj, type Env, type Route } from '../http.ts';
import { answersOf, pct, streaks, type AnswerRow } from '../stats.ts';
import { DAY_MS, addDays, dayKey, startOfDay, startOfWeek } from '../time.ts';
import type { CatalogStore } from './catalog.ts';
import { playerParam } from './core.ts';

export const CONTEXTS = ['gate', 'bonus', 'plant', 'defuse', 'revive', 'practice', 'custom'] as const;
export const MAX_BATCH = 200;
/** 客户端时间比服务器快超过这个值就按服务器时间记 */
const FUTURE_SLACK = 60_000;
/** 太久以前的记录不收（离线队列不会积压这么久） */
const MAX_AGE = 400 * DAY_MS;
/** 薄弱专题至少要有这么多题才算数 */
export const WEAK_MIN_SAMPLE = 8;

interface CleanAnswer {
  id: string;
  topicId: string;
  grade: number;
  difficulty: number;
  correct: boolean;
  ms: number | null;
  context: string;
  levelId: string;
  customId: number | null;
  at: number;
}

/** 校验一条答题记录；不合格返回 null（整批中的坏记录只跳过，不让整批失败） */
function cleanAnswer(env: Env, playerId: number, v: unknown, now: number): CleanAnswer | null {
  if (!isObj(v)) return null;
  if (typeof v.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(v.id)) return null;
  if (typeof v.correct !== 'boolean') return null;
  const context = typeof v.context === 'string' && (CONTEXTS as readonly string[]).includes(v.context) ? v.context : null;
  if (!context) return null;
  if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
  let at = Math.floor(v.at);
  if (at > now + FUTURE_SLACK) at = now;
  if (at < now - MAX_AGE) return null;
  const levelId = typeof v.levelId === 'string' && /^[A-Za-z0-9_-]{0,16}$/.test(v.levelId) ? v.levelId : '';
  const ms = typeof v.ms === 'number' && Number.isFinite(v.ms) && v.ms >= 0 ? Math.min(600_000, Math.round(v.ms)) : null;
  let difficulty = typeof v.difficulty === 'number' && Number.isFinite(v.difficulty) ? Math.round(v.difficulty) : 1;
  difficulty = Math.min(3, Math.max(1, difficulty));

  if (context === 'custom') {
    const cid = v.customId;
    if (typeof cid !== 'number' || !Number.isInteger(cid) || cid <= 0) return null;
    const q = env.db
      .q(
        `SELECT q.grade FROM custom_questions q WHERE q.id = ?
           AND (q.for_all = 1 OR EXISTS (SELECT 1 FROM custom_assign a WHERE a.question_id = q.id AND a.player_id = ?))`,
      )
      .get(cid, playerId) as { grade: number } | undefined;
    if (!q) return null;
    return { id: v.id, topicId: 'custom', grade: q.grade, difficulty: 1, correct: v.correct, ms, context, levelId, customId: cid, at };
  }

  if (typeof v.topicId !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(v.topicId) || v.topicId === 'custom') return null;
  const grade = v.grade;
  if (grade !== 3 && grade !== 4 && grade !== 5 && grade !== 6) return null;
  return { id: v.id, topicId: v.topicId, grade, difficulty, correct: v.correct, ms, context, levelId, customId: null, at };
}

interface Bucket {
  answered: number;
  correct: number;
}
const bump = (m: Map<string, Bucket>, k: string, ok: boolean) => {
  let b = m.get(k);
  if (!b) m.set(k, (b = { answered: 0, correct: 0 }));
  b.answered++;
  if (ok) b.correct++;
};
const withPct = (b: Bucket) => ({ answered: b.answered, correct: b.correct, accuracy: pct(b.correct, b.answered) });

/** 家长看的完整学习报告 */
export function buildReport(env: Env, catalog: CatalogStore, playerId: number) {
  const now = env.now();
  const rows = answersOf(env.db, playerId);
  const since7 = addDays(startOfDay(now), -6);
  const since30 = addDays(startOfDay(now), -29);

  const topic = new Map<string, Bucket & { last7: Bucket; msSum: number; msN: number; lastAt: number; grade: number }>();
  const byDiff = new Map<string, Bucket>();
  const byCtx = new Map<string, Bucket>();
  const byDay = new Map<string, Bucket>();
  const days = new Set<string>();
  const total: Bucket = { answered: 0, correct: 0 };
  const last7: Bucket = { answered: 0, correct: 0 };
  let msSum = 0;
  let msN = 0;

  for (const r of rows as AnswerRow[]) {
    const ok = r.correct === 1;
    total.answered++;
    if (ok) total.correct++;
    let t = topic.get(r.topic_id);
    if (!t) topic.set(r.topic_id, (t = { answered: 0, correct: 0, last7: { answered: 0, correct: 0 }, msSum: 0, msN: 0, lastAt: 0, grade: r.grade }));
    t.answered++;
    if (ok) t.correct++;
    t.lastAt = Math.max(t.lastAt, r.at);
    if (r.ms !== null) {
      t.msSum += r.ms;
      t.msN++;
      msSum += r.ms;
      msN++;
    }
    if (r.at >= since7) {
      last7.answered++;
      if (ok) last7.correct++;
      t.last7.answered++;
      if (ok) t.last7.correct++;
    }
    bump(byDiff, String(r.difficulty), ok);
    bump(byCtx, r.context, ok);
    const dk = dayKey(r.at);
    days.add(dk);
    if (r.at >= since30) bump(byDay, dk, ok);
  }

  const topics = [...topic.entries()]
    .map(([id, t]) => ({
      topicId: id,
      name: catalog.topicName(id),
      grade: catalog.topic(id)?.grade ?? t.grade,
      ...withPct(t),
      last7: withPct(t.last7),
      avgMs: t.msN ? Math.round(t.msSum / t.msN) : null,
      lastAt: t.lastAt,
    }))
    .sort((a, b) => a.grade - b.grade || a.topicId.localeCompare(b.topicId));

  const weakTopics = topics
    .filter((t) => t.answered >= WEAK_MIN_SAMPLE && (t.accuracy ?? 100) < 80)
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0) || b.answered - a.answered)
    .slice(0, 5)
    .map((t) => ({ topicId: t.topicId, name: t.name, answered: t.answered, accuracy: t.accuracy }));

  const daily: { day: string; answered: number; correct: number; accuracy: number | null }[] = [];
  for (let i = 0; i < 30; i++) {
    const dk = dayKey(addDays(since30, i));
    daily.push({ day: dk, ...withPct(byDay.get(dk) ?? { answered: 0, correct: 0 }) });
  }

  return {
    generatedAt: now,
    catalogLoaded: catalog.get() !== null,
    totals: { ...withPct(total), avgMs: msN ? Math.round(msSum / msN) : null, daysActive: days.size, firstAt: rows[0]?.at ?? null, lastAt: rows.at(-1)?.at ?? null },
    last7: withPct(last7),
    streak: streaks(rows),
    topics,
    weakTopics,
    weakMinSample: WEAK_MIN_SAMPLE,
    daily,
    byDifficulty: [1, 2, 3].map((d) => ({ difficulty: d, ...withPct(byDiff.get(String(d)) ?? { answered: 0, correct: 0 }) })),
    byContext: CONTEXTS.map((k) => ({ context: k, ...withPct(byCtx.get(k) ?? { answered: 0, correct: 0 }) })).filter((x) => x.answered > 0),
  };
}

export interface AnswerHooks {
  /** 新答题记录入库后重新计算任务进度，返回刚完成的任务数 */
  afterAnswers(playerId: number): number;
}

export function answerRoutes(env: Env, catalog: CatalogStore, hooks: AnswerHooks): Route[] {
  const { db } = env;
  return [
    {
      method: 'POST',
      path: '/api/answers',
      handler: async (c) => {
        const p = c.auth();
        const b = await c.body(256_000);
        if (!Array.isArray(b.answers)) throw new HttpError(400, '需要 answers 数组');
        if (b.answers.length > MAX_BATCH) throw new HttpError(413, `一次最多提交 ${MAX_BATCH} 条答题记录`);
        const now = env.now();
        let accepted = 0;
        let duplicates = 0;
        const rejected: (string | null)[] = [];
        db.tx(() => {
          const ins = db.q(
            `INSERT OR IGNORE INTO answers (player_id, client_id, topic_id, grade, difficulty, correct, ms, context, level_id, custom_id, at, received_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const raw of b.answers as unknown[]) {
            const a = cleanAnswer(env, p.id, raw, now);
            if (!a) {
              rejected.push(isObj(raw) && typeof raw.id === 'string' ? raw.id.slice(0, 64) : null);
              continue;
            }
            const r = ins.run(p.id, a.id, a.topicId, a.grade, a.difficulty, a.correct ? 1 : 0, a.ms, a.context, a.levelId, a.customId, a.at, now);
            if (Number(r.changes) > 0) accepted++;
            else duplicates++;
          }
        });
        const tasksCompleted = accepted > 0 ? hooks.afterAnswers(p.id) : 0;
        return { accepted, duplicates, rejected, tasksCompleted };
      },
    },

    {
      method: 'GET',
      path: '/api/report/me',
      handler: (c) => {
        const p = c.auth();
        const now = env.now();
        const rows = answersOf(db, p.id);
        const weekStart = startOfWeek(now);
        const todayStart = startOfDay(now);
        const topic = new Map<string, Bucket>();
        const week: Bucket = { answered: 0, correct: 0 };
        const today: Bucket = { answered: 0, correct: 0 };
        let correct = 0;
        for (const r of rows) {
          bump(topic, r.topic_id, r.correct === 1);
          if (r.correct) correct++;
          if (r.at >= weekStart) {
            week.answered++;
            if (r.correct) week.correct++;
          }
          if (r.at >= todayStart) {
            today.answered++;
            if (r.correct) today.correct++;
          }
        }
        return {
          totals: withPct({ answered: rows.length, correct }),
          week: { ...withPct(week), startsAt: weekStart },
          today: withPct(today),
          streak: streaks(rows),
          topics: [...topic.entries()]
            .map(([id, t]) => ({ topicId: id, name: catalog.topicName(id), ...withPct(t) }))
            .sort((a, b) => b.answered - a.answered),
        };
      },
    },

    { method: 'GET', path: '/api/admin/players/:id/report', handler: (c) => {
      const p = playerParam(env, c.params.id);
      return { player: { id: p.id, name: p.name, grade: p.grade }, ...buildReport(env, catalog, p.id) };
    } },
  ];
}
