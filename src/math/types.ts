/** 题库公共类型与工具。所有题目均为四选一。 */

export type Grade = 3 | 4 | 5 | 6;
/** 1 = 基础, 2 = 提高, 3 = 挑战 */
export type Difficulty = 1 | 2 | 3;

export interface Question {
  /** 题目所属专题 id，如 "g3-hecha" */
  topicId: string;
  grade: Grade;
  difficulty: Difficulty;
  /** 题干（纯文本，可含换行 \n） */
  text: string;
  /** 恰好 4 个互不相同的选项（已含单位，如 "24 棵"） */
  options: string[];
  /** 正确选项下标 0..3 */
  answer: number;
  /** 解析：2~4 句，写清思路和算式 */
  explain: string;
  /**
   * 可选配图：由 src/math/figure.ts 生成的 SVG 字符串（仅由本项目代码生成，不含外部内容）。
   * 界面会把它显示在题干下方。
   */
  figure?: string;
}

export interface Topic {
  id: string;
  grade: Grade;
  /** 专题名，如 "和差倍问题" */
  name: string;
  /** 一句话知识点提示 */
  hint: string;
  /** 按难度生成一道题。rng 返回 [0,1) */
  gen(difficulty: Difficulty, rng: () => number): Question;
}

/** 可复现随机数 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/** 最简分数文本，如 frac(6, 8) -> "3/4"，整数时返回整数 */
export function frac(n: number, d: number): string {
  const g = gcd(n, d) || 1;
  n /= g;
  d /= g;
  if (d < 0) {
    n = -n;
    d = -d;
  }
  return d === 1 ? String(n) : `${n}/${d}`;
}

/**
 * 用正确答案和若干干扰项组装四选一。
 * - correct: 正确选项文本
 * - distractors: 候选干扰项（会去重、去掉与正确答案相同的），不足 3 个时用 fallback 补齐
 * - fallback: 生成额外干扰项的函数（参数为第 k 次调用，从 0 起）
 */
export function buildOptions(
  rng: () => number,
  correct: string,
  distractors: string[],
  fallback: (k: number) => string,
): { options: string[]; answer: number } {
  const seen = new Set<string>([correct]);
  const wrong: string[] = [];
  for (const d of distractors) {
    if (wrong.length >= 3) break;
    if (!seen.has(d)) {
      seen.add(d);
      wrong.push(d);
    }
  }
  let k = 0;
  while (wrong.length < 3 && k < 200) {
    const d = fallback(k++);
    if (!seen.has(d)) {
      seen.add(d);
      wrong.push(d);
    }
  }
  const options = shuffle(rng, [correct, ...wrong]);
  return { options, answer: options.indexOf(correct) };
}

/** 数值型答案的便捷封装：自动生成邻近干扰项。unit 例如 " 棵"（带前导空格）或 "" */
export function numOptions(
  rng: () => number,
  correct: number,
  wrongs: number[],
  unit = '',
): { options: string[]; answer: number } {
  const fmt = (v: number) => `${Number.isInteger(v) ? v : +v.toFixed(2)}${unit}`;
  const cands = wrongs.filter((w) => w > 0 || correct <= 0).map(fmt);
  const step = Math.max(1, Math.round(Math.abs(correct) * 0.1));
  return buildOptions(rng, fmt(correct), cands, (k) => {
    const delta = (Math.floor(k / 2) + 1) * step * (k % 2 === 0 ? 1 : -1);
    const v = correct + delta;
    return fmt(v > 0 || correct <= 0 ? v : correct + Math.abs(delta) + step);
  });
}
