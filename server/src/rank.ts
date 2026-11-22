/**
 * 段位存档字段的校验 / 合并 / 老存档补段位。
 * 与客户端 src/core/rank.ts 的 cleanRank / mergeRank / seedRank 必须一致（服务器不引用客户端代码）。
 * 段位名称和加减星规则只在客户端；服务器只存星数 pts。
 */
export interface RankState {
  pts: number;
  best: number;
  n: number;
}

/** 黄金 III 的起点星数（青铜 3×3 + 白银 3×3）：老存档补段位最高补到这里 */
const SEED_CAP = 18;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

export function seedRank(stats: { wins: number }, stars: Record<string, number>): RankState {
  const total = Object.values(stars).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  const pts = Math.min(SEED_CAP, Math.max(0, Math.floor(stats.wins) + Math.floor(total / 3)));
  return { pts, best: pts, n: 0 };
}

export function cleanRank(v: unknown, fallback: () => RankState): RankState {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fallback();
  const o = v as Record<string, unknown>;
  const pts = Math.min(100000, num(o.pts));
  return { pts, best: Math.min(100000, Math.max(pts, num(o.best))), n: num(o.n) };
}

/** 取"打得多的那份"（n 只增不减）；局数相同取星多的 */
export function mergeRank(a: RankState, b: RankState): RankState {
  const pick = a.n !== b.n ? (a.n > b.n ? a : b) : a.pts >= b.pts ? a : b;
  return { pts: pick.pts, best: Math.max(a.best, b.best, pick.pts), n: pick.n };
}
