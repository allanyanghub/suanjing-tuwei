/** 题库内部工具：模板组装、选项封装、可校验元数据。 */
import type { Grade, Question, Topic } from './types.ts';
import { pick, numOptions, gcd } from './types.ts';

export type Rng = () => number;

/** 供 scripts/check-math.ts 做独立暴力校验的元数据（游戏逻辑不使用） */
export interface Verify {
  kind: string;
  p: number[];
  ans: number;
}

export interface Opts {
  options: string[];
  answer: number;
}

export interface Draft {
  text: string;
  o: Opts;
  explain: string;
  verify?: Verify;
  /** 可选配图（用 figure.ts 生成的 SVG 字符串） */
  figure?: string;
}

export type Tpl = (rng: Rng) => Draft;

export interface CheckedQuestion extends Question {
  verify?: Verify;
}

/** 由三档难度的模板表构造一个专题 */
export function topic(
  id: string,
  grade: Grade,
  name: string,
  hint: string,
  tpls: [Tpl[], Tpl[], Tpl[]],
): Topic {
  return {
    id,
    grade,
    name,
    hint,
    gen(difficulty, rng) {
      const t = pick(rng, tpls[difficulty - 1]);
      const d = t(rng);
      const q: CheckedQuestion = {
        topicId: id,
        grade,
        difficulty,
        text: d.text,
        options: d.o.options,
        answer: d.o.answer,
        explain: d.explain,
      };
      if (d.verify) q.verify = d.verify;
      if (d.figure) q.figure = d.figure;
      return q;
    },
  };
}

/** 数值选项：过滤掉非正、非有限的干扰项；默认过滤非整数干扰项（dec=true 时保留小数） */
export function N(rng: Rng, correct: number, wrongs: number[], unit = '', dec = false): Opts {
  const keepDec = dec || !Number.isInteger(correct);
  const ws = wrongs.filter((w) => Number.isFinite(w) && w > 0 && (keepDec || Number.isInteger(w)));
  return numOptions(rng, correct, ws, unit);
}

/** 反复尝试直到构造出合法实例 */
export function until<T>(make: () => T | null): T {
  for (let i = 0; i < 20000; i++) {
    const v = make();
    if (v !== null) return v;
  }
  throw new Error('until: 无法构造合法实例');
}

export function two<T>(rng: Rng, arr: readonly T[]): [T, T] {
  const i = Math.floor(rng() * arr.length);
  let j = Math.floor(rng() * (arr.length - 1));
  if (j >= i) j++;
  return [arr[i], arr[j]];
}

/** 最简整数比文本 */
export function ratio(x: number, y: number): string {
  const g = gcd(x, y) || 1;
  return `${x / g}:${y / g}`;
}

export function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
}

export function fact(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

export const NAMES = ['小明', '小红', '小华', '小丽', '小刚', '小芳'] as const;
export const COLORS = ['红', '黄', '蓝', '绿', '紫'] as const;
export const WEEK = ['日', '一', '二', '三', '四', '五', '六'] as const;
