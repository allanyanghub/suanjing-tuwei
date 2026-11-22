/// <reference types="node" />
/**
 * 四年级新增专题（src/math/g4b.ts）自检：
 *  - 每个专题 × 难度 1..3 各生成 400 题，检查结构、选项、文本、配图
 *  - 带 verify 元数据的题目用独立的暴力 / 模拟 / 几何作图解法重新求解，并与标为正确的选项比对
 *  - 搜索型解法发现多解或无解时判为失败
 * 用法：node --experimental-strip-types scripts/verify-g4b.ts [--sample]
 */
import { topics, TL_NAMES, TL_PEOPLE, TL_ROLESETS } from '../src/math/g4b.ts';
import { mulberry32 } from '../src/math/types.ts';
import type { Difficulty, Question } from '../src/math/types.ts';
import type { CheckedQuestion } from '../src/math/helpers.ts';

const PER = 400;
const MAX_TEXT = 90;

const EXPECTED: [string, string][] = [
  ['g4-pingjun', '平均数问题'],
  ['g4-fangzhen', '方阵问题'],
  ['g4-xinyunsuan', '定义新运算'],
  ['g4-rongchi', '容斥问题'],
  ['g4-tuili', '逻辑推理'],
  ['g4-jiaodu', '角度与多边形'],
  ['g4-zuizhi', '最值与数字问题'],
];

/* ───────────── 工具 ───────────── */

function unique(sols: number[], what: string): number {
  const s = [...new Set(sols)];
  if (s.length !== 1) throw new Error(`${what}: 解不唯一或无解 [${s.slice(0, 6).join(',')}]`);
  return s[0];
}

function perms(n: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  const rec = () => {
    if (cur.length === n) {
      out.push(cur.slice());
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(i);
      rec();
      cur.pop();
      used[i] = false;
    }
  };
  rec();
  return out;
}
const PERM = [0, 1, 2, 3, 4, 5, 6].map(perms);

function triples(p: number[], from: number): number[][] {
  const out: number[][] = [];
  for (let i = from; i + 2 < p.length + 0.5 && i < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2]]);
  return out;
}

const digitSum = (x: number): number => String(x).split('').reduce((s, c) => s + Number(c), 0);

/* ── 几何作图（坐标法）── */
type P2 = [number, number];
const R = Math.PI / 180;
function angleAt(v: P2, a: P2, b: P2): number {
  const ux = a[0] - v[0], uy = a[1] - v[1], wx = b[0] - v[0], wy = b[1] - v[1];
  const c = (ux * wx + uy * wy) / (Math.hypot(ux, uy) * Math.hypot(wx, wy));
  return Math.acos(Math.max(-1, Math.min(1, c))) / R;
}
function dirPt(d: number): P2 {
  return [Math.cos(d * R), Math.sin(d * R)];
}
/** 以 A=(0,0)、B=(1,0) 为底，A 处角 a、B 处角 b 作三角形，返回第三个顶点 C */
function triC(a: number, b: number): P2 {
  // 射线 A + s(cos a, sin a) 与 B + t(cos(180−b), sin(180−b)) 求交
  const [dx1, dy1] = dirPt(a);
  const [dx2, dy2] = dirPt(180 - b);
  const det = dx1 * -dy2 - dy1 * -dx2;
  const s = (1 * -dy2 - 0 * -dx2) / det;
  return [s * dx1, s * dy1];
}
function rnd(x: number, what: string): number {
  const r = Math.round(x);
  if (Math.abs(x - r) > 1e-6) throw new Error(`${what}: 测得非整数角 ${x}`);
  return r;
}
const near = (x: number, y: number) => Math.abs(x - y) < 1e-6;
function regular(n: number): P2[] {
  return Array.from({ length: n }, (_, i) => [Math.cos((2 * Math.PI * i) / n), Math.sin((2 * Math.PI * i) / n)] as P2);
}
function polyInteriorSum(n: number): number {
  const pts = regular(n);
  let s = 0;
  for (let i = 0; i < n; i++) s += angleAt(pts[i], pts[(i + n - 1) % n], pts[(i + 1) % n]);
  return s;
}
/** 等腰三角形：顶角 x，返回 [A, B, C]，A 为顶点 */
function isoTri(x: number): [P2, P2, P2] {
  const A: P2 = [0, 0];
  const B: P2 = [Math.cos((270 - x / 2) * R), Math.sin((270 - x / 2) * R)];
  const C: P2 = [Math.cos((270 + x / 2) * R), Math.sin((270 + x / 2) * R)];
  return [A, B, C];
}

/* ── 方阵：在网格上数点 ── */
function countCells(n: number, pred: (layer: number) => boolean): number {
  let c = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (pred(Math.min(i, j, n - 1 - i, n - 1 - j))) c++;
  return c;
}

/* ── 纸条：在整数格上铺 ── */
function union(segs: [number, number][]): { u: number; both: number } {
  const cover = new Map<number, number>();
  for (const [s, len] of segs) for (let x = s; x < s + len; x++) cover.set(x, (cover.get(x) ?? 0) + 1);
  let both = 0;
  for (const v of cover.values()) if (v >= 2) both++;
  return { u: cover.size, both };
}

/* ── 新运算：独立实现规定的式子 ── */
function op(code: number, c1: number, c2: number, a: number, b: number): number {
  switch (code) {
    case 0:
      return c1 * a + c2 * b;
    case 1:
      return a * b + a + b;
    case 2:
      return a * b - a - b;
    case 3:
      return a * b + c1;
  }
  throw new Error(`op: 未知运算 ${code}`);
}
function form(f: number, k: number, a: number, b: number): number {
  return [k * a + b, a * b + k, a + k * b, k * a - b, (a + b) * k][f];
}

/* ───────────── 独立解法 ───────────── */

type Solver = (p: number[], q: Question) => number;

export const BRUTE_G4B: Record<string, Solver> = {
  /* 平均数 */
  pjAvg(p) {
    const s = p.reduce((a, b) => a + b, 0);
    const sols: number[] = [];
    for (let x = 0; x <= 2000; x++) if (x * p.length === s) sols.push(x);
    return unique(sols, 'pjAvg');
  },
  pjMove([a, b]) {
    const sols: number[] = [];
    for (let x = 0; x <= a; x++) if (a - x === b + x) sols.push(x);
    return unique(sols, 'pjMove');
  },
  pjMissing([n, A, ...k]) {
    const sols: number[] = [];
    for (let w = 0; w <= 2000; w++) if ([...k, w].reduce((s, x) => s + x, 0) === n * A && k.length === n - 1) sols.push(w);
    return unique(sols, 'pjMissing');
  },
  pjAdd([n0, A, n1, B]) {
    const sols: number[] = [];
    for (let x = 0; x <= 2000; x++) {
      const tot = n1 > n0 ? n0 * A + x : n0 * A - x;
      if (tot === n1 * B) sols.push(x);
    }
    return unique(sols, 'pjAdd');
  },
  pjFix([n, W, s, r]) {
    const sols: number[] = [];
    for (let a = 0; a <= 100; a++) if (a * n === W * n - r + s) sols.push(a);
    return unique(sols, 'pjFix');
  },
  pjWeighted([m, a, f, b]) {
    const sols: number[] = [];
    for (let x = 0; x <= 1000; x++) if (x * (m + f) === m * a + f * b) sols.push(x);
    return unique(sols, 'pjWeighted');
  },
  pjOv3a([A, B, C]) {
    const sols: number[] = [];
    for (let a = 0; a <= 300; a++)
      for (let b = 0; b <= 300; b++) {
        const c = 3 * A - a - b;
        if (c >= 0 && a + b === 2 * B && b + c === 2 * C) sols.push(b);
      }
    return unique(sols, 'pjOv3a');
  },
  pjOv3b([X, Y, Z]) {
    const sols: number[] = [];
    for (let a = 0; a <= 300; a++)
      for (let b = 0; b <= 300; b++) {
        const c = 2 * Z - a;
        if (c >= 0 && a + b === 2 * X && b + c === 2 * Y) sols.push(a);
      }
    return unique(sols, 'pjOv3b');
  },
  pjHL([n, A, B, C, mode]) {
    const sols: number[] = [];
    for (let h = 0; h <= 100; h++)
      for (let l = 0; l <= h; l++) {
        if (n * A - h !== (n - 1) * B || n * A - l !== (n - 1) * C) continue;
        const mid = n * A - h - l;
        if (mid < (n - 2) * l || mid > (n - 2) * h) continue;
        sols.push(mode === 0 ? h : h - l);
      }
    return unique(sols, 'pjHL');
  },
  pjWhich([A, X, B]) {
    const sols: number[] = [];
    for (let k = 2; k <= 200; k++) if (A * (k - 1) + X === B * k) sols.push(k);
    return unique(sols, 'pjWhich');
  },

  /* 方阵 */
  fzOuter([n]) {
    return countCells(n, (L) => L === 0);
  },
  fzTotal([T, mode]) {
    const ns: number[] = [];
    for (let n = 1; n <= 100; n++) if (countCells(n, () => true) === T) ns.push(n);
    const n = unique(ns, 'fzTotal');
    return mode === 1 ? countCells(n, (L) => L === 0) : n;
  },
  fzOuterTotal([P]) {
    const sols: number[] = [];
    for (let n = 2; n <= 100; n++) if (countCells(n, (L) => L === 0) === P) sols.push(countCells(n, () => true));
    return unique(sols, 'fzOuterTotal');
  },
  fzHollow([n, k]) {
    if (n - 2 * k < 1) throw new Error('fzHollow: 中间没有空');
    return countCells(n, (L) => L < k);
  },
  fzAddRow([A, mode]) {
    const sols: number[] = [];
    for (let n = 2; n <= 100; n++) {
      const d = mode === 0 ? countCells(n + 1, () => true) - countCells(n, () => true) : countCells(n, () => true) - countCells(n - 1, () => true);
      if (d === A) sols.push(n * n);
    }
    return unique(sols, 'fzAddRow');
  },
  fzLeft([r, s]) {
    const sols: number[] = [];
    for (let n = 1; n <= 100; n++)
      for (let T = 1; T <= 12000; T++) if (T - n * n === r && (n + 1) * (n + 1) - T === s) sols.push(T);
    return unique(sols, 'fzLeft');
  },
  fzLayers([T, n]) {
    const sols: number[] = [];
    for (let k = 1; 2 * k < n; k++) if (countCells(n, (L) => L < k) === T) sols.push(k);
    return unique(sols, 'fzLayers');
  },
  fzFill([n, k]) {
    if (n - 2 * k < 1) throw new Error('fzFill: 中间没有空');
    return countCells(n, (L) => L >= k);
  },

  /* 新运算 */
  xyOp([code, c1, c2, a, b]) {
    return op(code, c1, c2, a, b);
  },
  xyConsec([x, y]) {
    let s = 0;
    for (let i = x; i < x + y; i++) s += i;
    return s;
  },
  xyNest([code, c1, c2, a, b, c, right]) {
    return right ? op(code, c1, c2, a, op(code, c1, c2, b, c)) : op(code, c1, c2, op(code, c1, c2, a, b), c);
  },
  xyUnk([code, c1, c2, b, Rr]) {
    const sols: number[] = [];
    for (let x = 0; x <= 3000; x++) if (op(code, c1, c2, x, b) === Rr) sols.push(x);
    return unique(sols, 'xyUnk');
  },
  xyConsecUnk([y, Rr]) {
    const sols: number[] = [];
    for (let x = 0; x <= 3000; x++) {
      let s = 0;
      for (let i = 0; i < y; i++) s += x + i;
      if (s === Rr) sols.push(x);
    }
    return unique(sols, 'xyConsecUnk');
  },
  xyRep([a, n]) {
    let s = 0;
    for (let i = 1; i <= n; i++) s += Number(String(a).repeat(i));
    return s;
  },
  xyFindK([f, p, qq, Rr, u, w]) {
    const ks: number[] = [];
    for (let k = 0; k <= 300; k++) if (form(f, k, p, qq) === Rr) ks.push(k);
    return form(f, unique(ks, 'xyFindK'), u, w);
  },
  xyNestUnk([code, c1, c2, b, c, Rr]) {
    const sols: number[] = [];
    for (let x = 0; x <= 2000; x++) if (op(code, c1, c2, op(code, c1, c2, x, b), c) === Rr) sols.push(x);
    return unique(sols, 'xyNestUnk');
  },

  /* 容斥 */
  rc2([ask, ...kv]) {
    // 区域：只A oa、只B ob、都 c、都不 e；量：0 总数 1 A 2 B 3 都 4 都不 5 只A 6 只B 7 只一项 8 至少一项
    const known = new Map<number, number>();
    for (let i = 0; i < kv.length; i += 2) known.set(kv[i], kv[i + 1]);
    const M = Math.max(...kv) + 1;
    const val = (q: number, oa: number, ob: number, c: number, e: number): number =>
      [oa + ob + c + e, oa + c, ob + c, c, e, oa, ob, oa + ob, oa + ob + c][q];
    const sols: number[] = [];
    for (let oa = 0; oa <= M; oa++)
      for (let ob = 0; ob <= M; ob++)
        for (let c = 0; c <= M; c++) {
          let e = 0;
          if (known.has(0)) e = (known.get(0) as number) - oa - ob - c;
          else if (known.has(4)) e = known.get(4) as number;
          else if (ask === 0 || ask === 4) throw new Error('rc2: 缺少总数');
          if (e < 0) continue;
          let ok = true;
          for (const [q, v] of known) if (val(q, oa, ob, c, e) !== v) ok = false;
          if (ok) sols.push(val(ask, oa, ob, c, e));
        }
    return unique(sols, 'rc2');
  },
  rc3([ask, Nn, A, B, C, AB, AC, BC, T]) {
    const sols: number[] = [];
    const M = Math.max(AB, AC, BC) + 1;
    for (let t = 0; t <= M; t++)
      for (let ab = 0; ab <= M; ab++)
        for (let ac = 0; ac <= M; ac++)
          for (let bc = 0; bc <= M; bc++) {
            if (ab + t !== AB || ac + t !== AC || bc + t !== BC) continue;
            const oa = A - ab - ac - t, ob = B - ab - bc - t, oc = C - ac - bc - t;
            if (oa < 0 || ob < 0 || oc < 0) continue;
            const tot = oa + ob + oc + ab + ac + bc + t;
            if (ask === 0 && tot === Nn) sols.push(t);
            if (ask === 1 && t === T) sols.push(tot);
          }
    return unique(sols, 'rc3');
  },
  rcStrip([L1, L2, x, mode]) {
    if (mode === 0) return union([[0, L1], [L1 - x, L2]]).u;
    const sols: number[] = [];
    for (let s = 0; s <= L1; s++) {
      const r = union([[0, L1], [s, L2]]);
      if (r.u === x && s + L2 > L1) sols.push(r.both);
    }
    return unique(sols, 'rcStrip');
  },
  rcChain([k, L, x, mode]) {
    const lay = (o: number) => union(Array.from({ length: k }, (_, i) => [i * (L - o), L] as [number, number]));
    if (mode === 0) return lay(x).u;
    const sols: number[] = [];
    for (let o = 0; o < L; o++) if (lay(o).u === x) sols.push(o);
    return unique(sols, 'rcChain');
  },
  rcDiv([Nn, a, b, mode]) {
    let c = 0;
    for (let i = 1; i <= Nn; i++) {
      const hit = i % a === 0 || i % b === 0;
      if (mode === 0 ? hit : !hit) c++;
    }
    return c;
  },
  rcRect([a, b, c, d, e, f, mode]) {
    const cnt = new Map<string, number>();
    const add = (x0: number, y0: number, w: number, h: number) => {
      for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) cnt.set(`${x},${y}`, (cnt.get(`${x},${y}`) ?? 0) + 1);
    };
    add(0, 0, a, b);
    add(a - e, b - f, c, d);
    let one = 0;
    for (const v of cnt.values()) if (v === 1) one++;
    return mode === 0 ? cnt.size : one;
  },

  /* 逻辑推理 */
  tlMatch([ctx, askKind, askIdx, ...rest]) {
    const cl = triples(rest, 0);
    const sols: number[] = [];
    for (const job of PERM[3]) {
      // job[人] = 角色
      const who = (r: number) => job.indexOf(r);
      let feasible = false;
      for (const age of PERM[3]) {
        let ok = true;
        for (const [t, a, b] of cl) {
          if (t === 0 && job[a] === b) ok = false;
          if (t === 2 && !(who(b) !== a && age[a] > age[who(b)])) ok = false;
          if (t === 3 && !(who(b) !== a && age[a] < age[who(b)])) ok = false;
          if (t === 4 && !(age[who(a)] > age[who(b)])) ok = false;
        }
        if (ok) feasible = true;
      }
      if (feasible) sols.push(askKind === 0 ? job[askIdx] : who(askIdx));
    }
    if (!TL_ROLESETS[ctx]) throw new Error('tlMatch: ctx');
    // 要求整个分配唯一（不只是所问的那一项）
    let full = 0;
    for (const job of PERM[3]) {
      const who = (r: number) => job.indexOf(r);
      if (
        PERM[3].some((age) =>
          cl.every(([t, a, b]) =>
            t === 0 ? job[a] !== b : t === 2 ? who(b) !== a && age[a] > age[who(b)] : t === 3 ? who(b) !== a && age[a] < age[who(b)] : age[who(a)] > age[who(b)],
          ),
        )
      )
        full++;
    }
    if (full !== 1) throw new Error(`tlMatch: 可行分配 ${full} 种`);
    return unique(sols, 'tlMatch');
  },
  tlLiar([n, k, ...rest]) {
    const st = triples(rest, 0);
    if (st.length !== n) throw new Error('tlLiar: 话的条数不对');
    const sols: number[] = [];
    for (let c = 0; c < n; c++) {
      const truths = st.filter(([t, x, y]) => (t === 0 ? c === x : t === 1 ? c !== x : c === x || c === y)).length;
      if (truths === k) sols.push(c);
    }
    return unique(sols, 'tlLiar');
  },
  tlRank([n, askPos, ...rest]) {
    const cl = triples(rest, 0);
    const ok = PERM[n].filter((ord) =>
      cl.every(([t, a, b]) => {
        const pa = ord.indexOf(a), pb = ord.indexOf(b);
        return t === 0 ? pa < pb : t === 1 ? pa !== 0 : t === 2 ? pa !== n - 1 : t === 3 ? pa === pb + 1 : pa === b;
      }),
    );
    if (ok.length !== 1) throw new Error(`tlRank: 可行名次 ${ok.length} 种`);
    return askPos < 0 ? Number(ok[0].map((x) => x + 1).join('')) : ok[0][askPos];
  },
  tlGames([n, mode]) {
    if (mode === 3) {
      let left = n, g = 0;
      while (left > 1) {
        g += Math.floor(left / 2);
        left = Math.ceil(left / 2);
      }
      return g;
    }
    let c = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && (mode === 1 || i < j)) c++;
    return c;
  },
  tlWins([n, mode, ...given]) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
    const sols: number[] = [];
    for (let mask = 0; mask < 1 << pairs.length; mask++) {
      const w = new Array<number>(n).fill(0);
      pairs.forEach(([i, j], b) => w[(mask >> b) & 1 ? i : j]++);
      if (given.every((g, i) => w[i] === g)) sols.push(mode === 0 ? w[n - 1] : n - 1 - w[n - 1]);
    }
    return unique(sols, 'tlWins');
  },
  tlDraws([n, P]) {
    const m = (n * (n - 1)) / 2;
    const sols: number[] = [];
    for (let d = 0; d <= m; d++) if (3 * (m - d) + 2 * d === P) sols.push(d);
    return unique(sols, 'tlDraws');
  },
  tlTeam([g, z, y]) {
    const sols: number[] = [];
    for (let w = 0; w <= g; w++) for (let d = 0; d <= g; d++) if (w + d + z === g && 3 * w + d === y) sols.push(w);
    return unique(sols, 'tlTeam');
  },

  /* 角度（坐标作图后量角） */
  angLine([mode, x]) {
    const O: P2 = [0, 0];
    if (mode === 0) return rnd(angleAt(O, dirPt(x), dirPt(180)), 'angLine');
    if (mode === 1) return rnd(angleAt(O, dirPt(180), dirPt(180 + x)), 'angLine');
    return rnd(angleAt(O, dirPt(x), dirPt(180)), 'angLine');
  },
  angPoint([a, b]) {
    const O: P2 = [0, 0];
    const m = angleAt(O, dirPt(90 + a + b), dirPt(90));
    // 第三个角是从 90+a+b 转到 450 的那一块；若测得角与 a+b 之和不是 360 说明取到了另一侧
    const c = near(m + a + b, 360) ? m : 360 - m;
    return rnd(c, 'angPoint');
  },
  angTri([a, b]) {
    const C = triC(a, b);
    return rnd(angleAt(C, [0, 0], [1, 0]), 'angTri');
  },
  angIso([mode, v]) {
    if (mode === 0) {
      const [A, B, C] = isoTri(v);
      return rnd(angleAt(B, A, C), 'angIso');
    }
    const C = triC(v, v);
    return rnd(angleAt(C, [0, 0], [1, 0]), 'angIso');
  },
  angExt([mode, a, x]) {
    const ext = (aa: number, bb: number) => {
      // A 在原点处角 aa，B=(1,0) 处角 bb，第三点 C；延长 BC 到 D
      const C = triC(aa, bb);
      const D: P2 = [2 * C[0] - 1, 2 * C[1]];
      return angleAt(C, [0, 0], D);
    };
    if (mode === 0) return rnd(ext(a, x), 'angExt');
    const sols: number[] = [];
    for (let b = 1; b < 180 - a; b++) if (near(ext(a, b), x)) sols.push(b);
    return unique(sols, 'angExt');
  },
  angIsoExt([mode, v]) {
    const ext = (x: number) => {
      const [A, B, C] = isoTri(x);
      const D: P2 = [2 * C[0] - B[0], 2 * C[1] - B[1]];
      return angleAt(C, A, D);
    };
    if (mode === 0) return rnd(ext(v), 'angIsoExt');
    const sols: number[] = [];
    for (let x = 1; x < 180; x++) if (near(ext(x), v)) sols.push(x);
    return unique(sols, 'angIsoExt');
  },
  angTriDiff([, c, d]) {
    const sols: number[] = [];
    for (let A = 1; A < 180; A++) {
      const B = A - d;
      if (B <= 0 || A + B >= 180) continue;
      if (near(angleAt(triC(A, B), [0, 0], [1, 0]), c)) sols.push(A);
    }
    return unique(sols, 'angTriDiff');
  },
  angTriK([c, k]) {
    const sols: number[] = [];
    for (let B = 1; B < 180; B++) {
      const A = k * B;
      if (A + B >= 180) continue;
      if (near(angleAt(triC(A, B), [0, 0], [1, 0]), c)) sols.push(A);
    }
    return unique(sols, 'angTriK');
  },
  polySum([n]) {
    return rnd(polyInteriorSum(n), 'polySum');
  },
  polyEach([n]) {
    const p = regular(n);
    return rnd(angleAt(p[0], p[n - 1], p[1]), 'polyEach');
  },
  polyDiag([n]) {
    let c = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const adj = j === i + 1 || (i === 0 && j === n - 1);
        if (!adj) c++;
      }
    return c;
  },
  polyRev([mode, v]) {
    const sols: number[] = [];
    for (let n = 3; n <= 80; n++) {
      const S = polyInteriorSum(n);
      if (mode === 0 && near(S, v)) sols.push(n);
      if (mode === 1) {
        const p = regular(n);
        if (near(angleAt(p[0], p[n - 1], p[1]), v)) sols.push(n);
      }
      if (mode === 2) {
        const ext = n * 180 - S; // 每个顶点外角 = 180° − 内角
        if (near(S - ext, v)) sols.push(n);
      }
    }
    return unique(sols, 'polyRev');
  },

  /* 最值与数字 */
  zzProd([S]) {
    let best = 0;
    for (let a = 1; a < S; a++) best = Math.max(best, a * (S - a));
    return best;
  },
  zzMake([mode, ...ds]) {
    const vals = PERM[ds.length].filter((p) => ds[p[0]] !== 0).map((p) => Number(p.map((i) => ds[i]).join('')));
    return mode === 0 ? Math.max(...vals) : Math.min(...vals);
  },
  zzPageDigits([P]) {
    let c = 0;
    for (let i = 1; i <= P; i++) c += String(i).length;
    return c;
  },
  zzRect([C, mode]) {
    const areas: number[] = [];
    for (let l = 1; l <= C; l++) for (let w = 1; w <= l; w++) if (2 * (l + w) === C) areas.push(l * w);
    return mode === 0 ? Math.max(...areas) : Math.min(...areas);
  },
  zzTwo([mode, ...ds]) {
    let best = -1;
    for (const p of PERM[6]) {
      const d = p.map((i) => ds[i]);
      if (d[0] === 0 || d[3] === 0) continue;
      const a = d[0] * 100 + d[1] * 10 + d[2];
      const b = d[3] * 100 + d[4] * 10 + d[5];
      best = Math.max(best, mode === 0 ? a + b : a - b);
    }
    return best;
  },
  zzDigitMin([mode, s]) {
    if (mode === 0) {
      for (let x = 100; x <= 999; x++) if (digitSum(x) === s) return x;
    } else if (mode === 1) {
      for (let x = 1000; x <= 9999; x++) if (digitSum(x) === s) return x;
    } else {
      for (let x = 999; x >= 100; x--) if (digitSum(x) === s && new Set(String(x)).size === 3) return x;
    }
    throw new Error('zzDigitMin: 无解');
  },
  zzPagesRev([D]) {
    const sols: number[] = [];
    let c = 0;
    for (let P = 1; P <= 3000; P++) {
      c += String(P).length;
      if (c === D) sols.push(P);
    }
    return unique(sols, 'zzPagesRev');
  },
  zzDigitCount([P, d]) {
    let c = 0;
    for (let i = 1; i <= P; i++) for (const ch of String(i)) if (ch === String(d)) c++;
    return c;
  },
  zzDigitSumAll([Nn]) {
    let s = 0;
    for (let i = 1; i <= Nn; i++) s += digitSum(i);
    return s;
  },
  zzFence([L]) {
    let best = 0;
    for (let x = 1; x <= L; x++) for (let y = 1; y <= L; y++) if (x + 2 * y === L) best = Math.max(best, x * y);
    return best;
  },
};

/** 校验答案对应的选项文本；返回 null 表示按数值比较 */
export function expectedLabel(kind: string, p: number[], ans: number): string | null {
  if (kind === 'tlLiar') return TL_NAMES[ans];
  if (kind === 'tlMatch') return p[1] === 0 ? TL_ROLESETS[p[0]].opts[ans] : TL_PEOPLE[ans];
  if (kind === 'tlRank') {
    if (p[1] >= 0) return TL_NAMES[ans];
    return String(ans)
      .split('')
      .map((c) => TL_NAMES[Number(c) - 1])
      .join('、');
  }
  return null;
}

/* ───────────── 主流程 ───────────── */

const failures: string[] = [];
function fail(msg: string) {
  if (failures.length < 80) failures.push(msg);
  else if (failures.length === 80) failures.push('…（更多失败已省略）');
}

const BAD = ['NaN', 'undefined', 'Infinity', 'null', '[object'];

function checkQuestion(q: CheckedQuestion, topicId: string, d: number, tag: string): boolean {
  const where = `${tag} 「${q.text}」`;
  if (q.topicId !== topicId) fail(`${where}: topicId=${q.topicId}`);
  if (q.grade !== 4) fail(`${where}: grade=${q.grade}`);
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
    if (typeof s === 'string' && /−\s*−|\+\s*−/.test(s)) fail(`${where}: 可疑的负号：${s}`);
  }
  const correct = q.options?.[q.answer] ?? '';
  const core = /^[0-9][0-9.:/]*/.exec(correct)?.[0] ?? correct;
  if (!q.explain.includes(core)) fail(`${where}: 解析中未出现答案 ${core}｜${q.explain}`);
  if (q.figure !== undefined) {
    if (typeof q.figure !== 'string' || !q.figure.startsWith('<svg')) fail(`${where}: 配图不是 SVG`);
    else for (const b of ['NaN', 'undefined', 'Infinity']) if (q.figure.includes(b)) fail(`${where}: 配图含 ${b}`);
  }
  if (!q.verify) return false;
  const { kind, p, ans } = q.verify;
  const solver = BRUTE_G4B[kind];
  if (!solver) {
    fail(`${where}: 未知校验类型 ${kind}`);
    return false;
  }
  try {
    const got = solver(p, q);
    if (got !== ans) fail(`${where}: 暴力解 ${got} ≠ 答案 ${ans} (${kind} ${p.join(',')})`);
  } catch (e) {
    fail(`${where}: 校验异常 ${(e as Error).message} (${kind} ${p.join(',')})`);
  }
  const lab = expectedLabel(kind, p, ans);
  if (lab !== null) {
    if (correct !== lab) fail(`${where}: 正确选项 ${correct} ≠ ${lab}`);
  } else if (parseFloat(correct) !== ans) fail(`${where}: 正确选项 ${correct} 与校验答案 ${ans} 不符`);
  return true;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--sample')) {
    const seed = Number(args[args.indexOf('--sample') + 1]) || 1;
    for (const t of topics)
      for (const d of [2, 3] as Difficulty[]) {
        const rng = mulberry32(seed * 1000 + t.id.length * 97 + d);
        for (let i = 0; i < 2; i++) {
          const q = t.gen(d, rng);
          console.log(`\n[${t.id} 难度${d}] ${q.text}${q.figure ? '  [有图]' : ''}`);
          console.log(`  ${q.options.map((o, k) => `${k === q.answer ? '✔' : ' '}${'ABCD'[k]}. ${o}`).join('   ')}`);
          console.log(`  解析：${q.explain}`);
        }
      }
    return;
  }

  if (topics.length !== EXPECTED.length) fail(`专题数 ${topics.length} ≠ ${EXPECTED.length}`);
  EXPECTED.forEach(([id, name], i) => {
    const t = topics[i];
    if (!t || t.id !== id || t.name !== name || t.grade !== 4) fail(`专题 ${i} 应为 ${id}/${name}/4，实际 ${t?.id}/${t?.name}/${t?.grade}`);
    if (t && !t.hint.trim()) fail(`${id} 缺少 hint`);
  });

  const rows: string[] = [];
  let total = 0;
  let verified = 0;
  let maxText = 0;
  const kinds = new Map<string, number>();
  topics.forEach((t, ti) => {
    const cells: string[] = [];
    let tv = 0;
    let tf = 0;
    for (const d of [1, 2, 3] as Difficulty[]) {
      const rng = mulberry32((ti * 37 + d) * 104729 + 4242);
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
        if (checkQuestion(q, t.id, d, `${t.id} d${d} #${i}`)) {
          verified++;
          tv++;
          const k = q.verify?.kind ?? '';
          kinds.set(k, (kinds.get(k) ?? 0) + 1);
        }
        if (q.figure) tf++;
        texts.add(q.text);
        maxText = Math.max(maxText, q.text.length);
      }
      const min = t.id === 'g4-tuili' ? 15 : 25;
      if (texts.size < min) fail(`${t.id} d${d}: 不同题干仅 ${texts.size} 个（要求 ≥ ${min}）`);
      cells.push(String(texts.size).padStart(5));
    }
    rows.push(`  ${t.id.padEnd(15)}${cells.join(' ')}   ${String(tv).padStart(5)}/${PER * 3}   ${String(tf).padStart(5)}   ${t.name}`);
  });

  console.log(`不同题干数（每格 ${PER} 题），暴力复核数，带图数：`);
  console.log(`  ${'专题'.padEnd(13)}   d1    d2    d3    复核       带图`);
  for (const r of rows) console.log(r);
  console.log(`\n共生成 ${total} 题；其中 ${verified} 题经独立解法复核（${kinds.size} 类）。题干最长 ${maxText} 字。`);
  if (failures.length > 0) {
    console.error(`\n✗ 失败 ${failures.length} 项：`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\n✓ 全部通过');
}

if (process.argv[1] && /verify-g4b\.ts$/.test(process.argv[1])) main();
