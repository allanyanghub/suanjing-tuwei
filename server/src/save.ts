/** 存档的校验与合并。存档内容与客户端 SaveData 对应，但不含各设备自己的设置（灵敏度、画质等）。 */
import type { Db } from './db.ts';
import { cleanRank, mergeRank, seedRank, type RankState } from './rank.ts';

export interface WrongEntry {
  q: { text: string; [k: string]: unknown };
  picked: number;
  time: number;
  levelId: string;
}

export interface SaveBlob {
  stars: Record<string, number>;
  wrong: WrongEntry[];
  agent: string;
  mapChoice: Record<string, string>;
  stats: { answered: number; correct: number; kills: number; wins: number };
  /** 段位（server/src/rank.ts）；老存档没有时按胜场和星星补 */
  rank: RankState;
}

export const MAX_WRONG = 200;

export function emptySave(): SaveBlob {
  return { stars: {}, wrong: [], agent: 'ling', mapChoice: {}, stats: { answered: 0, correct: 0, kills: 0, wins: 0 }, rank: { pts: 0, best: 0, n: 0 } };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** 把任意输入清洗成合法存档；结构不对的部分丢弃而不是报错 */
export function sanitize(input: unknown): SaveBlob {
  const out = emptySave();
  if (!isObj(input)) return out;
  if (isObj(input.stars))
    for (const [k, v] of Object.entries(input.stars)) {
      if (k.length <= 16 && typeof v === 'number') out.stars[k] = Math.max(0, Math.min(3, Math.floor(v)));
    }
  if (Array.isArray(input.wrong))
    for (const w of input.wrong) {
      if (!isObj(w) || !isObj(w.q) || typeof w.q.text !== 'string') continue;
      if (JSON.stringify(w.q).length > 20000) continue;
      out.wrong.push({ q: w.q as WrongEntry['q'], picked: num(w.picked), time: num(w.time), levelId: typeof w.levelId === 'string' ? w.levelId.slice(0, 16) : '' });
      if (out.wrong.length >= MAX_WRONG) break;
    }
  if (typeof input.agent === 'string') out.agent = input.agent.slice(0, 16);
  if (isObj(input.mapChoice))
    for (const [k, v] of Object.entries(input.mapChoice)) if (k.length <= 16 && typeof v === 'string') out.mapChoice[k] = v.slice(0, 16);
  if (isObj(input.stats)) {
    out.stats.answered = num(input.stats.answered);
    out.stats.correct = Math.min(out.stats.answered, num(input.stats.correct));
    out.stats.kills = num(input.stats.kills);
    out.stats.wins = num(input.stats.wins);
  }
  out.rank = cleanRank(input.rank, () => seedRank(out.stats, out.stars));
  return out;
}

const wrongKey = (w: WrongEntry) => `${w.time}|${w.q.text}`;

/**
 * 合并服务器上的存档和客户端提交的存档。
 * - fastForward = true：客户端是在服务器当前版本的基础上改的，以客户端为准（这样在错题本里订正掉的题不会复活）；
 *   但星级和累计统计仍取较大值，进度永远不会倒退。
 * - fastForward = false：两台设备各自改过，取并集。
 */
export function mergeSaves(server: SaveBlob, client: SaveBlob, fastForward: boolean): SaveBlob {
  const out = emptySave();
  for (const k of new Set([...Object.keys(server.stars), ...Object.keys(client.stars)]))
    out.stars[k] = Math.max(server.stars[k] ?? 0, client.stars[k] ?? 0);
  out.stats = {
    answered: Math.max(server.stats.answered, client.stats.answered),
    correct: Math.max(server.stats.correct, client.stats.correct),
    kills: Math.max(server.stats.kills, client.stats.kills),
    wins: Math.max(server.stats.wins, client.stats.wins),
  };
  out.rank = mergeRank(server.rank, client.rank);
  out.agent = client.agent || server.agent;
  out.mapChoice = fastForward ? { ...client.mapChoice } : { ...server.mapChoice, ...client.mapChoice };
  if (fastForward) out.wrong = client.wrong.slice(0, MAX_WRONG);
  else {
    const seen = new Set<string>();
    for (const w of [...client.wrong, ...server.wrong]) {
      const k = wrongKey(w);
      if (seen.has(k)) continue;
      seen.add(k);
      out.wrong.push(w);
    }
    out.wrong.sort((a, b) => b.time - a.time);
    out.wrong.length = Math.min(out.wrong.length, MAX_WRONG);
  }
  return out;
}

/** 给家长页面用的摘要 */
export function summarize(s: SaveBlob): { stars: number; cleared: number; answered: number; correct: number; wins: number; wrong: number; rank: number } {
  const vals = Object.values(s.stars);
  return {
    stars: vals.reduce((a, b) => a + b, 0),
    cleared: vals.filter((v) => v >= 1).length,
    answered: s.stats.answered,
    correct: s.stats.correct,
    wins: s.stats.wins,
    wrong: s.wrong.length,
    rank: s.rank.pts,
  };
}

/** 从数据库读出并清洗某位玩家的存档；没有存档时返回空存档（版本 0） */
export function loadSave(db: Db, playerId: number): { data: SaveBlob; version: number; updatedAt: number } {
  const row = db.getSave(playerId);
  if (!row) return { data: emptySave(), version: 0, updatedAt: 0 };
  let data: SaveBlob;
  try {
    data = sanitize(JSON.parse(row.data));
  } catch {
    data = emptySave();
  }
  return { data, version: row.version, updatedAt: row.updated_at };
}
