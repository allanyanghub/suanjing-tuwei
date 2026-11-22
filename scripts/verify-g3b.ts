/// <reference types="node" />
/**
 * 三年级扩展专题（src/math/g3b.ts）自检：
 *  - 每个专题 × 难度 1..3 各生成 400 题，检查结构、选项、文本、配图
 *  - 带 verify 元数据的题目，用本文件里独立实现的暴力/模拟解法重新求解，并与标为正确的选项比对
 *    （搜索型解法若找到多个解则判失败）
 * 用法：node --experimental-strip-types scripts/verify-g3b.ts [--sample [n]]
 */
import { topics } from '../src/math/g3b.ts';
import { mulberry32 } from '../src/math/types.ts';
import type { Difficulty, Question } from '../src/math/types.ts';
import type { CheckedQuestion } from '../src/math/helpers.ts';

const PER = 400;
const MIN_DISTINCT = 25;
const MAX_TEXT = 90;

const EXPECTED: [string, string][] = [
  ['g3-guilv', '找规律'],
  ['g3-shutu', '数图形'],
  ['g3-yingkui', '盈亏问题'],
  ['g3-guiyi', '归一与归总'],
  ['g3-huanyuan', '还原问题'],
  ['g3-shuzhen', '数阵图与算式谜'],
  ['g3-zhouchang', '周长巧算'],
];

/* ───────────── 独立暴力解法 ───────────── */

function unique(sols: number[], what: string): number {
  const s = [...new Set(sols)];
  if (s.length !== 1) throw new Error(`${what}: 解不唯一或无解 [${s.slice(0, 8).join(',')}]`);
  return s[0];
}

/** 数列规则检测：0 等差 1 等比 2 二级等差 3 斐波那契型 */
function fits(x: number[], rule: number): boolean {
  const n = x.length;
  if (rule === 0) {
    for (let i = 2; i < n; i++) if (x[i] - x[i - 1] !== x[1] - x[0]) return false;
    return true;
  }
  if (rule === 1) {
    if (x.some((v) => v === 0)) return false;
    for (let i = 2; i < n; i++) if (x[i] * x[i - 2] !== x[i - 1] * x[i - 1]) return false;
    return true;
  }
  if (rule === 2) {
    if (n < 4) return false;
    const d = x.slice(1).map((v, i) => v - x[i]);
    for (let i = 2; i < d.length; i++) if (d[i] - d[i - 1] !== d[1] - d[0]) return false;
    return true;
  }
  for (let i = 2; i < n; i++) if (x[i] !== x[i - 1] + x[i - 2]) return false;
  return true;
}

/** 按规则把数列逐项延长到第 n 项 */
function extend(x: number[], rule: number, n: number): number {
  const s = x.slice();
  while (s.length < n) {
    const k = s.length;
    if (rule === 0) s.push(s[k - 1] + (s[1] - s[0]));
    else if (rule === 1) s.push((s[k - 1] * s[1]) / s[0]);
    else if (rule === 2) s.push(s[k - 1] + (s[k - 1] - s[k - 2]) + (s[2] - 2 * s[1] + s[0]));
    else s.push(s[k - 1] + s[k - 2]);
  }
  return s[n - 1];
}

function cellsOf(ops: number[]): Set<string> {
  const cells = new Set<string>();
  for (let i = 0; i < ops.length; i += 5) {
    const [sg, x, y, w, h] = ops.slice(i, i + 5);
    for (let a = x; a < x + w; a++)
      for (let b = y; b < y + h; b++) {
        if (sg === 1) cells.add(`${a},${b}`);
        else cells.delete(`${a},${b}`);
      }
  }
  return cells;
}

function perimeterOf(cells: Set<string>): number {
  let p = 0;
  for (const c of cells) {
    const [a, b] = c.split(',').map(Number);
    for (const [da, db] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      if (!cells.has(`${a + da},${b + db}`)) p++;
  }
  return p;
}

/** 回溯枚举 3×3 幻方（用给定九个数各一次），fixed: 下标→值 */
function magicSquares(nums: number[], fixed: Map<number, number>): number[][] {
  const out: number[][] = [];
  const g: number[] = new Array(9).fill(0);
  const used = new Array<boolean>(9).fill(false);
  const S = nums.reduce((a, b) => a + b, 0) / 3;
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  const rec = (k: number) => {
    if (k === 9) {
      if (lines.every((l) => g[l[0]] + g[l[1]] + g[l[2]] === S)) out.push(g.slice());
      return;
    }
    for (let i = 0; i < 9; i++) {
      if (used[i]) continue;
      if (fixed.has(k) && fixed.get(k) !== nums[i]) continue;
      g[k] = nums[i];
      // 剪枝：完成的行
      if ((k === 2 || k === 5 || k === 8) && g[k - 2] + g[k - 1] + g[k] !== S) continue;
      used[i] = true;
      rec(k + 1);
      used[i] = false;
    }
  };
  rec(0);
  return out;
}

function permsB(arr: number[]): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const used = arr.map(() => false);
  const rec = () => {
    if (cur.length === arr.length) {
      out.push(cur.slice());
      return;
    }
    arr.forEach((v, i) => {
      if (used[i]) return;
      used[i] = true;
      cur.push(v);
      rec();
      cur.pop();
      used[i] = false;
    });
  };
  rec();
  return out;
}

/** 有理数运算（分子/分母），用于填运算符的精确判定 */
type Q = [number, number];
const qn = (a: number): Q => [a, 1];
function qop(x: Q, o: number, y: Q): Q | null {
  if (o === 0) return [x[0] * y[1] + y[0] * x[1], x[1] * y[1]];
  if (o === 1) return [x[0] * y[1] - y[0] * x[1], x[1] * y[1]];
  if (o === 2) return [x[0] * y[0], x[1] * y[1]];
  if (y[0] === 0) return null;
  return [x[0] * y[1], x[1] * y[0]];
}
function evalPrec(nums: number[], ops: number[]): Q | null {
  // 先把乘除合并
  const vals: Q[] = [qn(nums[0])];
  const adds: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] >= 2) {
      const r = qop(vals[vals.length - 1], ops[i], qn(nums[i + 1]));
      if (!r) return null;
      vals[vals.length - 1] = r;
    } else {
      adds.push(ops[i]);
      vals.push(qn(nums[i + 1]));
    }
  }
  let acc = vals[0];
  for (let i = 0; i < adds.length; i++) acc = qop(acc, adds[i], vals[i + 1]) as Q;
  return acc;
}
const OPSYM = ['+', '−', '×', '÷'];

const BRUTE: Record<string, (p: number[], q: Question) => number> = {
  'g3b-fill'([m, ...terms]) {
    const sols: number[] = [];
    for (let v = 0; v <= 5000; v++) {
      const x = terms.slice();
      x[m] = v;
      for (let r = 0; r < 4; r++) if (fits(x, r)) sols.push(v);
    }
    return unique(sols, 'fill');
  },
  'g3b-ext'([n, ...shown]) {
    const sols: number[] = [];
    for (let r = 0; r < 4; r++) if (fits(shown, r)) sols.push(extend(shown, r, n));
    return unique(sols, 'ext');
  },
  'g3b-sticks'([shape, n]) {
    const seg = new Set<string>();
    const add = (x1: number, y1: number, x2: number, y2: number) => {
      const a = `${x1},${y1}`;
      const b = `${x2},${y2}`;
      seg.add(a < b ? `${a}-${b}` : `${b}-${a}`);
    };
    for (let t = 0; t < n; t++) {
      if (shape === 0) {
        add(t, 0, t + 1, 0);
        add(t, 1, t + 1, 1);
        add(t, 0, t, 1);
        add(t + 1, 0, t + 1, 1);
      } else {
        // 坐标放大 2 倍：底边点 (2j,0)，顶边点 (2j+1,1)
        const j = Math.floor(t / 2);
        if (t % 2 === 0) {
          add(2 * j, 0, 2 * j + 2, 0);
          add(2 * j, 0, 2 * j + 1, 1);
          add(2 * j + 2, 0, 2 * j + 1, 1);
        } else {
          add(2 * j + 1, 1, 2 * j + 3, 1);
          add(2 * j + 1, 1, 2 * j + 2, 0);
          add(2 * j + 3, 1, 2 * j + 2, 0);
        }
      }
    }
    return seg.size;
  },
  'g3b-alt'([n, ...shown]) {
    const odd = shown.filter((_, i) => i % 2 === 0);
    const even = shown.filter((_, i) => i % 2 === 1);
    if (!fits(odd, 0) || !fits(even, 0)) throw new Error('alt: 子数列不是等差');
    const sub = n % 2 === 1 ? odd : even;
    const k = n % 2 === 1 ? (n + 1) / 2 : n / 2;
    let v = sub[0];
    for (let i = 1; i < k; i++) v += sub[1] - sub[0];
    if (v < 0) throw new Error('alt: 出现负数');
    return v;
  },
  'g3b-ring'([mode, v]) {
    const count = (s: number) => {
      let c = 0;
      for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) if (i === 0 || j === 0 || i === s - 1 || j === s - 1) c++;
      return c;
    };
    if (mode === 0) return count(v);
    const sols: number[] = [];
    for (let s = 2; s <= 200; s++) if (count(s) === v) sols.push(s);
    return unique(sols, 'ring');
  },
  'g3b-group'([variant, n]) {
    const seq: number[] = [];
    for (let k = 1; seq.length < n; k++) for (let i = 1; i <= k; i++) seq.push(variant === 0 ? k : i);
    return seq[n - 1];
  },
  'g3b-segs'([n]) {
    let c = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) c++;
    return c;
  },
  'g3b-angles'([k]) {
    // 射线方向在 15°~165° 之间，任意两条的夹角都小于 180°
    let c = 0;
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) if (((j - i) * 150) / (k - 1) < 180) c++;
    return c;
  },
  'g3b-rects'([r, c]) {
    let n = 0;
    for (let x1 = 0; x1 <= c; x1++)
      for (let x2 = x1 + 1; x2 <= c; x2++) for (let y1 = 0; y1 <= r; y1++) for (let y2 = y1 + 1; y2 <= r; y2++) n++;
    return n;
  },
  'g3b-squares'([r, c]) {
    let n = 0;
    for (let x1 = 0; x1 <= c; x1++)
      for (let x2 = x1 + 1; x2 <= c; x2++)
        for (let y1 = 0; y1 <= r; y1++) for (let y2 = y1 + 1; y2 <= r; y2++) if (x2 - x1 === y2 - y1) n++;
    return n;
  },
  'g3b-shaded'([r, c, sr, sc]) {
    let n = 0;
    for (let x1 = 0; x1 <= c; x1++)
      for (let x2 = x1 + 1; x2 <= c; x2++)
        for (let y1 = 0; y1 <= r; y1++)
          for (let y2 = y1 + 1; y2 <= r; y2++) if (x1 < sc && sc <= x2 && y1 < sr && sr <= y2) n++;
    return n;
  },
  'g3b-segsum'(lens) {
    const pos = [0];
    for (const l of lens) pos.push(pos[pos.length - 1] + l);
    let s = 0;
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) s += pos[j] - pos[i];
    return s;
  },
  'g3b-tri'([m, h]) {
    // 点：0 = 顶点；其余为 (射线 i, 横线 j)
    const id = (i: number, j: number) => 1 + i * (h + 1) + j;
    const lines: Set<number>[] = [];
    for (let i = 0; i <= m; i++) {
      const s = new Set<number>([0]);
      for (let j = 0; j <= h; j++) s.add(id(i, j));
      lines.push(s);
    }
    for (let j = 0; j <= h; j++) {
      const s = new Set<number>();
      for (let i = 0; i <= m; i++) s.add(id(i, j));
      lines.push(s);
    }
    const P = 1 + (m + 1) * (h + 1);
    const joined = (a: number, b: number) => lines.some((l) => l.has(a) && l.has(b));
    const colin = (a: number, b: number, c: number) => lines.some((l) => l.has(a) && l.has(b) && l.has(c));
    let n = 0;
    for (let a = 0; a < P; a++)
      for (let b = a + 1; b < P; b++)
        for (let c = b + 1; c < P; c++) if (joined(a, b) && joined(b, c) && joined(a, c) && !colin(a, b, c)) n++;
    return n;
  },
  'g3b-yk'([a, s1, b, s2, ask]) {
    const sols: number[] = [];
    for (let x = 1; x <= 1000; x++) if (a * x + s1 === b * x + s2 && a * x + s1 > 0) sols.push(ask ? a * x + s1 : x);
    return unique(sols, 'yk');
  },
  'g3b-boat'([a, s, b, k, ask]) {
    const sols: number[] = [];
    for (let x = k + 1; x <= 1000; x++) if (a * x + s === b * (x - k)) sols.push(ask ? a * x + s : x);
    return unique(sols, 'boat');
  },
  'g3b-part'([a, s, b, r, ask]) {
    if (!(r > 0 && r < b)) throw new Error('part: r 不合法');
    const sols: number[] = [];
    for (let x = 2; x <= 1000; x++) if (a * x + s === b * (x - 1) + r) sols.push(ask ? a * x + s : x);
    return unique(sols, 'part');
  },
  'g3b-price'([a, s, b, t, askM]) {
    const sols: number[] = [];
    for (let p = 1; p <= 2000; p++) if (a * p - s === b * p + t) sols.push(askM ? b * p + t : p);
    return unique(sols, 'price');
  },
  'g3b-unit'([a, A, b]) {
    const sols: number[] = [];
    for (let u = 1; u <= A; u++) if (u * a === A) sols.push(u);
    const u = unique(sols, 'unit');
    let s = 0;
    for (let i = 0; i < b; i++) s += u;
    return s;
  },
  'g3b-unitRev'([a, A, B]) {
    let u = 0;
    for (let x = 1; x <= A; x++) if (x * a === A) u = x;
    let k = 0;
    let s = 0;
    while (s < B) {
      s += u;
      k++;
    }
    if (s !== B) throw new Error('unitRev: 不能整除');
    return k;
  },
  'g3b-dbl'([m1, d1, T, m2, d2]) {
    const sols: number[] = [];
    for (let u = 1; u <= T; u++) if (u * m1 * d1 === T) sols.push(u);
    return unique(sols, 'dbl') * m2 * d2;
  },
  'g3b-dblRev'([m1, d1, T, m2, T2]) {
    let u = 0;
    for (let x = 1; x <= T; x++) if (x * m1 * d1 === T) u = x;
    let done = 0;
    let day = 0;
    while (done < T2) {
      done += u * m2;
      day++;
    }
    if (done !== T2) throw new Error('dblRev: 不是整天');
    return day;
  },
  'g3b-tot'([a, b, c]) {
    let tot = 0;
    for (let i = 0; i < b; i++) tot += a;
    let k = 0;
    while (tot > 0) {
      tot -= c;
      k++;
    }
    if (tot !== 0) throw new Error('tot: 不能整除');
    return k;
  },
  'g3b-food'([a, b, k, c]) {
    let food = a * b;
    for (let d = 0; d < k; d++) food -= a;
    let days = 0;
    while (food > 0) {
      food -= a + c;
      days++;
    }
    if (food !== 0) throw new Error('food: 不是整天');
    return days;
  },
  'g3b-plan'([a, b, c, early]) {
    let road = 0;
    for (let d = 0; d < b; d++) road += a;
    let days = 0;
    while (road > 0) {
      road -= a + c;
      days++;
    }
    if (road !== 0) throw new Error('plan: 不是整天');
    return early ? b - days : days;
  },
  'g3b-chain'([R, ...ops]) {
    const sols: number[] = [];
    for (let x = 0; x <= 5000; x++) {
      let v = x;
      let ok = true;
      for (let i = 0; i < ops.length; i += 2) {
        const o = ops[i];
        const n = ops[i + 1];
        if (o === 3 && v % n !== 0) {
          ok = false;
          break;
        }
        v = o === 0 ? v + n : o === 1 ? v - n : o === 2 ? v * n : v / n;
        if (v < 0) {
          ok = false;
          break;
        }
      }
      if (ok && v === R) sols.push(x);
    }
    return unique(sols, 'chain');
  },
  'g3b-half'([c, ...st]) {
    const sols: number[] = [];
    for (let x = 1; x <= 5000; x++) {
      let v = x;
      let ok = true;
      for (let i = 0; i < st.length; i += 2) {
        if (v % 2 !== 0) {
          ok = false;
          break;
        }
        const used = st[i] ? v / 2 + st[i + 1] : v / 2 - st[i + 1];
        if (used <= 0 || used > v) {
          ok = false;
          break;
        }
        v -= used;
      }
      if (ok && v === c) sols.push(x);
    }
    return unique(sols, 'half');
  },
  'g3b-wrong'([wrong, right, k, r]) {
    const ap = (v: number, o: number) => (o === 0 ? v + k : o === 1 ? v - k : o === 2 ? v * k : v / k);
    const sols: number[] = [];
    for (let x = 0; x <= 10000; x++) {
      const w = ap(x, wrong);
      if (w === r) {
        const c = ap(x, right);
        if (Number.isInteger(c) && c >= 0) sols.push(c);
      }
    }
    return unique(sols, 'wrong');
  },
  'g3b-give3'([S, a, b, c, who]) {
    const sols: number[] = [];
    for (let x = 0; x <= S; x++)
      for (let y = 0; x + y <= S; y++) {
        let A = x;
        let B = y;
        let C = S - x - y;
        if (A < a) continue;
        A -= a;
        B += a;
        if (B < b) continue;
        B -= b;
        C += b;
        if (C < c) continue;
        C -= c;
        A += c;
        if (A === B && B === C) sols.push([x, y, S - x - y][who]);
      }
    return unique(sols, 'give3');
  },
  'g3b-dbl2'([p, q, who]) {
    const sols: number[] = [];
    for (let x = 0; x <= p + q; x++)
      for (let y = 0; x + y <= p + q; y++) {
        let A = x;
        let B = y;
        if (A < B) continue;
        A -= B;
        B *= 2;
        if (B < A) continue;
        B -= A;
        A *= 2;
        if (A === p && B === q) sols.push(who ? y : x);
      }
    return unique(sols, 'dbl2');
  },
  'g3b-magicSum'([a, d]) {
    const nums = Array.from({ length: 9 }, (_, i) => a + i * d);
    const sq = magicSquares(nums, new Map());
    if (sq.length === 0) throw new Error('magicSum: 无幻方');
    return unique(
      sq.map((g) => g[0] + g[1] + g[2]),
      'magicSum',
    );
  },
  'g3b-magic'([a, d, ask, ...gv]) {
    const nums = Array.from({ length: 9 }, (_, i) => a + i * d);
    const fixed = new Map<number, number>();
    for (let i = 0; i < gv.length; i += 2) fixed.set(gv[i], gv[i + 1]);
    const sq = magicSquares(nums, fixed);
    return unique(
      sq.map((g) => g[ask]),
      'magic',
    );
  },
  'g3b-triArr'([a, d, S, askMid]) {
    const nums = Array.from({ length: 6 }, (_, i) => a + i * d);
    // 0,1,2 顶点；3 在 0-1 边上，4 在 1-2 边上，5 在 2-0 边上
    const sols: number[] = [];
    for (const p of permsB(nums)) {
      if (p[0] + p[3] + p[1] === S && p[1] + p[4] + p[2] === S && p[2] + p[5] + p[0] === S)
        sols.push(askMid ? p[3] + p[4] + p[5] : p[0] + p[1] + p[2]);
    }
    return unique(sols, 'triArr');
  },
  'g3b-cross'([a, d, S]) {
    const nums = Array.from({ length: 5 }, (_, i) => a + i * d);
    const sols: number[] = [];
    // 0 上 1 左 2 中 3 右 4 下
    for (const p of permsB(nums)) if (p[1] + p[2] + p[3] === S && p[0] + p[2] + p[4] === S) sols.push(p[2]);
    return unique(sols, 'cross');
  },
  'g3b-vpuzzle'([ask], q) {
    const m = /竖式谜（如图）：([0-9□]+) ([+−×]) ([0-9□]+) = ([0-9□]+)/.exec(q.text);
    if (!m) throw new Error('vpuzzle: 无法解析');
    const pats = [m[1], m[3], m[4]];
    const op = m[2];
    const slots: [number, number][] = [];
    pats.forEach((p, i) => [...p].forEach((ch, j) => ch === '□' && slots.push([i, j])));
    const cur = pats.map((p) => [...p]);
    const full: number[][] = [];
    const rec = (k: number) => {
      if (k === slots.length) {
        const [x, y, z] = cur.map((r) => Number(r.join('')));
        const ok = op === '+' ? x + y === z : op === '−' ? x - y === z : x * y === z;
        if (ok) full.push([x, y, z]);
        return;
      }
      const [i, j] = slots[k];
      for (let v = j === 0 ? 1 : 0; v <= 9; v++) {
        cur[i][j] = String(v);
        rec(k + 1);
      }
      cur[i][j] = '□';
    };
    rec(0);
    if (full.length !== 1) throw new Error(`vpuzzle: 有 ${full.length} 组解`);
    return full[0][ask];
  },
  'g3b-opfill'(_p, q) {
    const m = /在 (\d+) □ (\d+) □ (\d+) □ (\d+) = (\d+) 的/.exec(q.text);
    if (!m) throw new Error('opfill: 无法解析');
    const nums = [m[1], m[2], m[3], m[4]].map(Number);
    const R = Number(m[5]);
    const sols: number[] = [];
    for (let a = 0; a < 4; a++)
      for (let b = 0; b < 4; b++)
        for (let c = 0; c < 4; c++) {
          const v = evalPrec(nums, [a, b, c]);
          if (v && v[0] === R * v[1]) sols.push(a * 16 + b * 4 + c);
        }
    return unique(sols, 'opfill');
  },
  'g3b-cells'(ops) {
    return perimeterOf(cellsOf(ops));
  },
  'g3b-rectW'([P, a]) {
    const sols: number[] = [];
    for (let b = 1; b <= P; b++) if (a === 0 ? 4 * b === P : 2 * (a + b) === P) sols.push(b);
    return unique(sols, 'rectW');
  },
  'g3b-cut'([askInc, W, H, ...pieces]) {
    let sum = 0;
    const all = new Set<string>();
    for (let i = 0; i < pieces.length; i += 4) {
      const c = cellsOf([1, ...pieces.slice(i, i + 4)]);
      for (const k of c) {
        if (all.has(k)) throw new Error('cut: 小块重叠');
        all.add(k);
      }
      sum += perimeterOf(c);
    }
    if (all.size !== W * H) throw new Error('cut: 小块没有拼满原长方形');
    return askInc ? sum - perimeterOf(cellsOf([1, 0, 0, W, H])) : sum;
  },
};

/* ───────────── 主流程 ───────────── */

const failures: string[] = [];
function fail(msg: string) {
  if (failures.length < 60) failures.push(msg);
  else if (failures.length === 60) failures.push('…（更多失败已省略）');
}

const BAD = ['NaN', 'undefined', 'Infinity', 'null', '[object'];

function checkQuestion(q: CheckedQuestion, topicId: string, d: number, tag: string): boolean {
  const where = `${tag} 「${q.text}」`;
  if (q.topicId !== topicId) fail(`${where}: topicId=${q.topicId}`);
  if (q.grade !== 3) fail(`${where}: grade=${q.grade}`);
  if (q.difficulty !== d) fail(`${where}: difficulty=${q.difficulty}`);
  if (!Array.isArray(q.options) || q.options.length !== 4) fail(`${where}: 选项数 ${q.options?.length}`);
  else if (new Set(q.options.map((o) => o.trim())).size !== 4) fail(`${where}: 选项重复 ${JSON.stringify(q.options)}`);
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) fail(`${where}: answer=${q.answer}`);
  if (typeof q.text !== 'string' || q.text.trim() === '') fail(`${tag}: 题干为空`);
  if (typeof q.explain !== 'string' || q.explain.trim() === '') fail(`${where}: 解析为空`);
  if (q.text.length > MAX_TEXT) fail(`${where}: 题干过长 ${q.text.length}`);
  for (const s of [q.text, q.explain, ...(q.options ?? [])]) {
    if (typeof s !== 'string' || s.trim() === '') fail(`${where}: 存在空字符串`);
    else for (const b of BAD) if (s.includes(b)) fail(`${where}: 字符串含 ${b}：${s}`);
    if (typeof s === 'string' && /-\d/.test(s.replace(/\d\s*-\s*\d/g, ''))) fail(`${where}: 出现负数：${s}`);
  }
  for (const o of q.options ?? []) {
    const v = parseFloat(o);
    if (!Number.isNaN(v) && (v <= 0 || !Number.isInteger(v)) && !/^[+−×÷]/.test(o)) fail(`${where}: 选项不是正整数 ${o}`);
  }
  if (q.topicId === 'g3-shutu' && !q.figure) fail(`${where}: 数图形题缺少配图`);
  if (q.figure !== undefined) {
    if (typeof q.figure !== 'string' || !q.figure.startsWith('<svg')) fail(`${where}: 配图不是 SVG`);
    else for (const b of ['NaN', 'undefined', 'Infinity']) if (q.figure.includes(b)) fail(`${where}: 配图含 ${b}`);
  }
  const correct = q.options?.[q.answer] ?? '';
  const core = /^[0-9][0-9.:/]*/.exec(correct)?.[0] ?? correct;
  if (!q.explain.includes(core)) fail(`${where}: 解析中未出现答案 ${core}｜${q.explain}`);

  if (!q.verify) return false;
  const { kind, p, ans } = q.verify;
  const solver = BRUTE[kind];
  if (!solver) {
    fail(`${where}: 未知校验类型 ${kind}`);
    return false;
  }
  try {
    const got = solver(p, q);
    if (got !== ans) fail(`${where}: 暴力解 ${got} ≠ 答案 ${ans} (${kind} ${p.join(',')})`);
  } catch (e) {
    fail(`${where}: 校验异常 ${(e as Error).message}`);
  }
  if (kind === 'g3b-opfill') {
    const expect = [Math.floor(ans / 16), Math.floor(ans / 4) % 4, ans % 4].map((o) => OPSYM[o]).join('、');
    if (correct !== expect) fail(`${where}: 正确选项 ${correct} ≠ ${expect}`);
  } else if (parseFloat(correct) !== ans) {
    fail(`${where}: 正确选项 ${correct} 与校验答案 ${ans} 不符`);
  }
  return true;
}

function main(): void {
  const args = process.argv.slice(2);
  const si = args.indexOf('--sample');
  if (si >= 0) {
    const n = Number(args[si + 1]) || 2;
    for (const t of topics) {
      for (const d of [2, 3] as Difficulty[]) {
        const rng = mulberry32((Date.now() % 100000) + t.id.length * 977 + d);
        for (let i = 0; i < n; i++) {
          const q = t.gen(d, rng);
          console.log(`\n[${t.id} ${t.name} 难度${d}] ${q.text}`);
          console.log(`  ${q.options.map((o, k) => `${k === q.answer ? '✔' : ' '}${'ABCD'[k]}. ${o}`).join('   ')}`);
          console.log(`  解析：${q.explain}${q.figure ? '  [有配图]' : ''}`);
        }
      }
    }
    return;
  }

  if (topics.length !== EXPECTED.length) fail(`专题数 ${topics.length} ≠ ${EXPECTED.length}`);
  EXPECTED.forEach(([id, name], i) => {
    const t = topics[i];
    if (!t || t.id !== id || t.name !== name || t.grade !== 3) fail(`专题 ${i} 应为 ${id}/${name}/3，实际 ${t?.id}/${t?.name}/${t?.grade}`);
    if (t && (!t.hint || t.hint.trim() === '')) fail(`专题 ${id} 缺少 hint`);
  });

  let total = 0;
  let verifiedAll = 0;
  let maxText = 0;
  const rows: string[] = [];
  topics.forEach((t, ti) => {
    const cells: string[] = [];
    let ver = 0;
    let figs = 0;
    let cnt = 0;
    for (const d of [1, 2, 3] as Difficulty[]) {
      const rng = mulberry32((ti * 31 + d) * 7919 + 4242);
      const texts = new Set<string>();
      for (let i = 0; i < PER; i++) {
        let q: CheckedQuestion;
        try {
          q = t.gen(d, rng) as CheckedQuestion;
        } catch (e) {
          fail(`${t.id} d${d} #${i}: gen 抛错 ${(e as Error).message}`);
          continue;
        }
        total++;
        cnt++;
        if (checkQuestion(q, t.id, d, `${t.id} d${d} #${i}`)) ver++;
        if (q.figure) figs++;
        texts.add(q.text);
        maxText = Math.max(maxText, q.text.length);
      }
      if (texts.size < MIN_DISTINCT) fail(`${t.id} d${d}: 不同题干仅 ${texts.size} 个（要求 ≥ ${MIN_DISTINCT}）`);
      cells.push(String(texts.size).padStart(4));
    }
    verifiedAll += ver;
    rows.push(`  ${t.id.padEnd(14)} ${cells.join('  ')}   ${String(ver).padStart(4)}/${cnt}  ${String(figs).padStart(5)}   ${t.name}`);
  });

  console.log(`每专题每难度生成 ${PER} 题：`);
  console.log(`  ${'专题'.padEnd(12)}   d1    d2    d3   暴力复核    配图`);
  for (const r of rows) console.log(r);
  console.log(`\n共生成 ${total} 题；其中 ${verifiedAll} 题经独立暴力/模拟解法复核。题干最长 ${maxText} 字（上限 ${MAX_TEXT}）。`);

  if (failures.length > 0) {
    console.error(`\n✗ 失败 ${failures.length} 项：`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\n✓ 全部通过');
}

main();
