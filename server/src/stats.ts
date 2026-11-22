/** 答题记录的读取与统计（学习报告、任务进度、排行榜共用） */
import type { Db } from './db.ts';

export interface AnswerRow {
  topic_id: string;
  grade: number;
  difficulty: number;
  correct: number;
  ms: number | null;
  context: string;
  level_id: string;
  custom_id: number | null;
  at: number;
}

const ORDER = 'ORDER BY at, received_at, rowid';

/** 某玩家在 [since, until] 内的答题记录，按时间先后 */
export function answersOf(db: Db, playerId: number, since = 0, until = Number.MAX_SAFE_INTEGER): AnswerRow[] {
  return db
    .q(`SELECT topic_id, grade, difficulty, correct, ms, context, level_id, custom_id, at FROM answers WHERE player_id = ? AND at >= ? AND at <= ? ${ORDER}`)
    .all(playerId, since, until) as unknown as AnswerRow[];
}

/** 连续答对：current = 最近一段（截至最后一题），best = 历史最长 */
export function streaks(rows: { correct: number }[]): { current: number; best: number } {
  let cur = 0;
  let best = 0;
  for (const r of rows) {
    cur = r.correct ? cur + 1 : 0;
    if (cur > best) best = cur;
  }
  return { current: cur, best };
}

/** 只取 correct 一列，算连对用 */
export function correctSeq(db: Db, playerId: number, since = 0, until = Number.MAX_SAFE_INTEGER): { correct: number }[] {
  return db.q(`SELECT correct FROM answers WHERE player_id = ? AND at >= ? AND at <= ? ${ORDER}`).all(playerId, since, until) as unknown as { correct: number }[];
}

export interface Tally {
  answered: number;
  correct: number;
}

export function countAnswers(db: Db, playerId: number, since: number, until = Number.MAX_SAFE_INTEGER, topicId?: string): Tally {
  const r = (
    topicId === undefined
      ? db.q('SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS c FROM answers WHERE player_id = ? AND at >= ? AND at <= ?').get(playerId, since, until)
      : db.q('SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS c FROM answers WHERE player_id = ? AND at >= ? AND at <= ? AND topic_id = ?').get(playerId, since, until, topicId)
  ) as { n: number; c: number };
  return { answered: Number(r.n), correct: Number(r.c) };
}

/** 正确率（整数百分比 0..100）；没有答题时为 null */
export const pct = (correct: number, answered: number): number | null => (answered > 0 ? Math.round((correct / answered) * 100) : null);
