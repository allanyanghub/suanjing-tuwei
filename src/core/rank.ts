/**
 * 段位：青铜 → 白银 → 黄金 → 铂金 → 钻石 → 星耀 → 王者。
 *
 * - 段位只由一个数字决定：累计星数 pts（0 = 青铜 III 0 星）。
 * - 每打完一局（单人 / 合作 / 对战都算）按胜负和本局答题正确率加减星，见 matchDelta。
 * - 保段：只掉星不掉大段——星数不会低于当前大段的起点（到了黄金就不会再掉回白银）。
 * - 存档里记 { pts, best, n }；n = 计入段位的局数，只增不减，两台设备的存档合并时取 n 大的那份
 *   （服务器 server/src/save.ts 用同一规则，改这里要同步改那边）。
 */

export interface RankState {
  /** 累计星数 */
  pts: number;
  /** 历史最高星数 */
  best: number;
  /** 计入段位的局数 */
  n: number;
}

export interface TierDef {
  id: string;
  name: string;
  /** 小段数（III、II、I）；王者为 0，星数不封顶 */
  divisions: number;
  /** 每个小段几颗星 */
  stars: number;
  /** 徽章主色 */
  color: string;
}

export const TIERS: TierDef[] = [
  { id: 'bronze', name: '青铜', divisions: 3, stars: 3, color: '#c0834f' },
  { id: 'silver', name: '白银', divisions: 3, stars: 3, color: '#b9c4cf' },
  { id: 'gold', name: '黄金', divisions: 3, stars: 4, color: '#f2c14e' },
  { id: 'platinum', name: '铂金', divisions: 3, stars: 4, color: '#5fd3c4' },
  { id: 'diamond', name: '钻石', divisions: 3, stars: 5, color: '#6aa8ff' },
  { id: 'starlight', name: '星耀', divisions: 3, stars: 5, color: '#b07cff' },
  { id: 'king', name: '王者', divisions: 0, stars: 0, color: '#ff6b5a' },
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/** 每个大段的起点星数 */
export const TIER_START: number[] = (() => {
  const out: number[] = [];
  let s = 0;
  for (const t of TIERS) {
    out.push(s);
    s += t.divisions * t.stars;
  }
  return out;
})();

export const KING_START = TIER_START[TIERS.length - 1];

export interface RankView {
  pts: number;
  tierIndex: number;
  tier: TierDef;
  /** 小段号：3 = III（最低）… 1 = I；王者为 0 */
  division: number;
  /** 当前小段已有星数（王者 = 王者星数） */
  stars: number;
  /** 当前小段满星数（王者为 0） */
  starsMax: number;
  /** "黄金 II" / "王者" */
  label: string;
  /** "黄金 II · 2 星" / "王者 · 5 星" */
  full: string;
}

export function rankView(ptsIn: number): RankView {
  const pts = Math.max(0, Math.floor(ptsIn || 0));
  let ti = TIERS.length - 1;
  while (ti > 0 && pts < TIER_START[ti]) ti--;
  const tier = TIERS[ti];
  if (tier.divisions === 0) {
    const stars = pts - TIER_START[ti];
    return { pts, tierIndex: ti, tier, division: 0, stars, starsMax: 0, label: tier.name, full: `${tier.name} · ${stars} 星` };
  }
  const inTier = pts - TIER_START[ti];
  const step = Math.floor(inTier / tier.stars);
  const division = tier.divisions - step;
  const stars = inTier - step * tier.stars;
  const label = `${tier.name} ${ROMAN[division - 1]}`;
  return { pts, tierIndex: ti, tier, division, stars, starsMax: tier.stars, label, full: `${label} · ${stars} 星` };
}

/** 所有小段从低到高：{ label, start }（阶梯页用） */
export function allDivisions(): { tierIndex: number; division: number; label: string; start: number; stars: number }[] {
  const out: { tierIndex: number; division: number; label: string; start: number; stars: number }[] = [];
  TIERS.forEach((t, ti) => {
    if (t.divisions === 0) {
      out.push({ tierIndex: ti, division: 0, label: t.name, start: TIER_START[ti], stars: 0 });
      return;
    }
    for (let k = 0; k < t.divisions; k++)
      out.push({ tierIndex: ti, division: t.divisions - k, label: `${t.name} ${ROMAN[t.divisions - k - 1]}`, start: TIER_START[ti] + k * t.stars, stars: t.stars });
  });
  return out;
}

/** 本局答题达到这个正确率算"答得好" */
export const GOOD_ACC = 0.8;
/** 低于这个正确率算"答得差" */
export const BAD_ACC = 0.5;

export interface MatchDelta {
  delta: number;
  /** 给孩子看的原因 */
  why: string;
}

/**
 * 一局的星数变化：胜 +1 / 负 −1，答题好再 +1、答题差再 −1，结果限制在 −1…+2。
 *   赢 + 答得好 = +2；赢 = +1；赢但答得差 = 0；输但答得好 = 0（保星）；输 = −1；输又答得差 = −1。
 */
export function matchDelta(win: boolean, answered: number, correct: number): MatchDelta {
  const acc = answered > 0 ? correct / answered : 0;
  const good = answered > 0 && acc >= GOOD_ACC;
  const bad = answered === 0 || acc < BAD_ACC;
  const raw = (win ? 1 : -1) + (good ? 1 : bad ? -1 : 0);
  const delta = Math.max(-1, Math.min(2, raw));
  let why: string;
  if (win && good) why = '胜利 +1，答题正确率 ≥ 80% 再 +1';
  else if (win && bad) why = '虽然赢了，但答题正确率不到 50%，不加星';
  else if (win) why = '胜利 +1（正确率到 80% 还能多拿 1 颗）';
  else if (good) why = '虽然输了，但答题正确率 ≥ 80%，保住了星星';
  else why = '失败 −1（正确率到 80% 就不会掉星）';
  return { delta, why };
}

/** 应用一局结果（保段：不低于当前大段起点） */
export function applyDelta(r: RankState, delta: number): RankState {
  const floor = TIER_START[rankView(r.pts).tierIndex];
  const pts = Math.max(floor, r.pts + delta);
  return { pts, best: Math.max(r.best, pts), n: r.n + 1 };
}

/** 段位上线前的老存档：按已有胜场和星星给一个起始段位（最高到黄金 III 起点，留给孩子自己往上打） */
export function seedRank(stats: { wins: number }, stars: Record<string, number>): RankState {
  const total = Object.values(stars).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  const pts = Math.min(TIER_START[2], Math.max(0, Math.floor(stats.wins) + Math.floor(total / 3)));
  return { pts, best: pts, n: 0 };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

export function cleanRank(v: unknown, fallback: () => RankState): RankState {
  if (typeof v !== 'object' || v === null) return fallback();
  const o = v as Record<string, unknown>;
  const pts = num(o.pts);
  return { pts, best: Math.max(pts, num(o.best)), n: num(o.n) };
}

/** 两份段位取"打得多的那份"；局数相同取星多的 */
export function mergeRank(a: RankState, b: RankState): RankState {
  const pick = a.n !== b.n ? (a.n > b.n ? a : b) : a.pts >= b.pts ? a : b;
  return { pts: pick.pts, best: Math.max(a.best, b.best, pick.pts), n: pick.n };
}
