/** 三年级（扩展）：找规律、数图形、盈亏、归一与归总、还原、数阵图与算式谜、周长巧算 */
import type { Topic } from './types.ts';
import { randInt, pick, buildOptions, shuffle } from './types.ts';
import type { Tpl, Rng, Opts } from './helpers.ts';
import { topic, N, two, until, NAMES } from './helpers.ts';
import { svg, line, polygon, rect, circle, text, dot, grid, FIG } from './figure.ts';

/* ───────────── 通用小工具 ───────────── */

const tri = (n: number): number => (n * (n + 1)) / 2;
const downFrom = (n: number): number[] => Array.from({ length: n }, (_, i) => n - i);
const sumOf = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
const seqStr = (xs: (number | null)[]): string => xs.map((x) => (x === null ? '□' : String(x))).join('、');
const LET = 'ABCDEFGHIJ';
/** 深色面板底色，用于遮住圆圈下方的线 */
const PANEL = '#0a1020';

/** 把 total 随机拆成 k 个不小于 min 的整数 */
function partition(rng: Rng, total: number, k: number, min: number): number[] {
  return until(() => {
    const cuts = new Set<number>();
    while (cuts.size < k - 1) cuts.add(randInt(rng, 1, total - 1));
    const cs = [0, ...[...cuts].sort((a, b) => a - b), total];
    const parts = cs.slice(1).map((c, i) => c - cs[i]);
    return parts.every((p) => p >= min) ? parts : null;
  });
}

/* ───────────── 找规律 ───────────── */

const glArith: Tpl = (rng) => {
  const len = 6;
  const d = randInt(rng, 2, 12);
  const inc = rng() < 0.65;
  const a = inc ? randInt(rng, 1, 40) : randInt(rng, d * (len - 1) + 1, d * (len - 1) + 40);
  const t = Array.from({ length: len }, (_, i) => (inc ? a + i * d : a - i * d));
  const m = randInt(rng, 2, len - 1);
  const ans = t[m];
  const prev = t[m - 1];
  const step = (k: number) => (inc ? prev + k : prev - k);
  return {
    text: `按规律填数：${seqStr(t.map((x, i) => (i === m ? null : x)))}。□ 里应填几？`,
    o: N(rng, ans, [step(d + 1), step(d - 1), step(2 * d), ans + 10]),
    explain: `相邻两个数依次${inc ? '增加' : '减少'} ${d}。□ = ${prev} ${inc ? '+' : '−'} ${d} = ${ans}。`,
    verify: { kind: 'g3b-fill', p: [m, ...t.map((x, i) => (i === m ? 0 : x))], ans },
  };
};

const glGeo: Tpl = (rng) => {
  const r = pick(rng, [2, 2, 3]);
  const len = r === 2 ? 6 : 5;
  const a = r === 2 ? randInt(rng, 1, 6) : randInt(rng, 1, 4);
  let t = Array.from({ length: len }, (_, i) => a * r ** i);
  const dec = rng() < 0.35;
  if (dec) t = t.reverse();
  const m = randInt(rng, 2, len - 1);
  const prev = t[m - 1];
  const ans = t[m];
  const arithGuess = 2 * prev - t[m - 2];
  return {
    text: `按规律填数：${seqStr(t.map((x, i) => (i === m ? null : x)))}。□ 里应填几？`,
    o: N(rng, ans, dec ? [arithGuess, prev - r, ans + r, ans - 1] : [arithGuess, prev + r, prev * (r + 1), ans + r]),
    explain: dec
      ? `后一个数是前一个数除以 ${r}（${t[0]} ÷ ${r} = ${t[1]}）。□ = ${prev} ÷ ${r} = ${ans}。`
      : `后一个数是前一个数的 ${r} 倍（${t[0]} × ${r} = ${t[1]}）。□ = ${prev} × ${r} = ${ans}。`,
    verify: { kind: 'g3b-fill', p: [m, ...t.map((x, i) => (i === m ? 0 : x))], ans },
  };
};

const glDiff2: Tpl = (rng) => {
  const a = randInt(rng, 1, 20);
  const d0 = randInt(rng, 1, 5);
  const dd = randInt(rng, 1, 3);
  const t = [a];
  for (let i = 1; i < 7; i++) t.push(t[i - 1] + d0 + (i - 1) * dd);
  const m = randInt(rng, 3, 6);
  const ans = t[m];
  const diffs = t.slice(1).map((x, i) => x - t[i]);
  return {
    text: `按规律填数：${seqStr(t.map((x, i) => (i === m ? null : x)))}。□ 里应填几？`,
    o: N(rng, ans, [t[m - 1] + diffs[m - 2], ans + dd, ans + 1, ans - 1]),
    explain: `相邻两数的差依次是 ${diffs.join('、')}，每次多 ${dd}。□ = ${t[m - 1]} + ${diffs[m - 1]} = ${ans}。`,
    verify: { kind: 'g3b-fill', p: [m, ...t.map((x, i) => (i === m ? 0 : x))], ans },
  };
};

const glFib: Tpl = (rng) => {
  const a = randInt(rng, 1, 6);
  const b = randInt(rng, 1, 9);
  const t = [a, b];
  for (let i = 2; i < 7; i++) t.push(t[i - 1] + t[i - 2]);
  const m = randInt(rng, 2, 6);
  const ans = t[m];
  return {
    text: `按规律填数：${seqStr(t.map((x, i) => (i === m ? null : x)))}。□ 里应填几？`,
    o: N(rng, ans, [2 * t[m - 1] - t[m - 2], 2 * t[m - 1], ans + 1, ans - 1]),
    explain: `从第三个数起，每个数都等于它前面两个数的和。□ = ${t[m - 2]} + ${t[m - 1]} = ${ans}。`,
    verify: { kind: 'g3b-fill', p: [m, ...t.map((x, i) => (i === m ? 0 : x))], ans },
  };
};

const glSquare: Tpl = (rng) => {
  const form = randInt(rng, 0, 2);
  const c = form === 1 ? randInt(rng, 1, 3) : 0;
  const f = (k: number) => (form === 2 ? k * (k + 1) : k * k + c);
  const n = randInt(rng, 8, 12);
  const shown = [1, 2, 3, 4, 5].map(f);
  const ans = f(n);
  const rule =
    form === 2
      ? `第 k 个数是 k × (k + 1)：1 × 2、2 × 3、3 × 4……第 ${n} 个：${n} × ${n + 1} = ${ans}。`
      : c === 0
        ? `第 k 个数是 k × k：1 × 1、2 × 2、3 × 3……第 ${n} 个：${n} × ${n} = ${ans}。`
        : `第 k 个数是 k × k + ${c}：1 × 1 + ${c}、2 × 2 + ${c}……第 ${n} 个：${n} × ${n} + ${c} = ${ans}。`;
  return {
    text: `一列数：${shown.join('、')}、…，按这个规律，第 ${n} 个数是多少？`,
    o: N(rng, ans, [f(n - 1), f(n + 1), 2 * n + c, ans + 1]),
    explain: rule,
    verify: { kind: 'g3b-ext', p: [n, ...shown], ans },
  };
};

function figSticks(shape: number): string {
  const parts: string[] = [];
  const st = { stroke: FIG.accent2, width: 3 };
  if (shape === 0) {
    const s = 26;
    let x = 22;
    const y = 58;
    for (let g = 1; g <= 3; g++) {
      for (let i = 0; i < g; i++) parts.push(rect(x + i * s, y, s, s, st));
      parts.push(text(x + (g * s) / 2, y + s + 24, `${g} 个`, { size: 13, color: FIG.dim }));
      x += g * s + 30;
    }
  } else {
    const s = 32;
    const yb = 88;
    const yt = yb - 28;
    let x = 30;
    for (let g = 1; g <= 3; g++) {
      for (let t = 0; t < g; t++) {
        const j = Math.floor(t / 2);
        const pts: [number, number][] =
          t % 2 === 0
            ? [
                [x + j * s, yb],
                [x + (j + 1) * s, yb],
                [x + (j + 0.5) * s, yt],
              ]
            : [
                [x + (j + 0.5) * s, yt],
                [x + (j + 1.5) * s, yt],
                [x + (j + 1) * s, yb],
              ];
        parts.push(polygon(pts, st));
      }
      const w = ((g + 1) / 2) * s;
      parts.push(text(x + w / 2, yb + 24, `${g} 个`, { size: 13, color: FIG.dim }));
      x += w + 30;
    }
  }
  return svg(parts);
}

const glMatch: Tpl = (rng) => {
  const shape = randInt(rng, 0, 1);
  const n = randInt(rng, 8, 30);
  if (shape === 0) {
    const ans = 3 * n + 1;
    return {
      text: `用小棒摆正方形（如图）：摆 1 个用 4 根，2 个用 7 根，3 个用 10 根。照这样摆 ${n} 个正方形要用多少根？`,
      o: N(rng, ans, [4 * n, 3 * n, 3 * n + 4, ans - 3], ' 根'),
      explain: `第 1 个正方形用 4 根，以后每多摆 1 个只多用 3 根。4 + 3 × (${n} − 1) = ${ans} 根。`,
      verify: { kind: 'g3b-sticks', p: [0, n], ans },
      figure: figSticks(0),
    };
  }
  const ans = 2 * n + 1;
  return {
    text: `用小棒摆三角形（如图）：摆 1 个用 3 根，2 个用 5 根，3 个用 7 根。照这样摆 ${n} 个三角形要用多少根？`,
    o: N(rng, ans, [3 * n, 2 * n, 2 * n + 3, ans - 2], ' 根'),
    explain: `第 1 个三角形用 3 根，以后每多摆 1 个只多用 2 根。3 + 2 × (${n} − 1) = ${ans} 根。`,
    verify: { kind: 'g3b-sticks', p: [1, n], ans },
    figure: figSticks(1),
  };
};

const glAlt: Tpl = (rng) => {
  const n = randInt(rng, 11, 20);
  const a = randInt(rng, 1, 10);
  const d1 = randInt(rng, 2, 5);
  const d2 = randInt(rng, 2, 5);
  const decEven = rng() < 0.6;
  const evenCount = Math.max(3, Math.floor(n / 2));
  const b = decEven ? randInt(rng, (evenCount - 1) * d2 + 1, (evenCount - 1) * d2 + 30) : randInt(rng, 11, 40);
  const term = (i: number) => (i % 2 === 1 ? a + ((i + 1) / 2 - 1) * d1 : decEven ? b - (i / 2 - 1) * d2 : b + (i / 2 - 1) * d2);
  const shown = [1, 2, 3, 4, 5, 6].map(term);
  const odd = n % 2 === 1;
  const k = odd ? (n + 1) / 2 : n / 2;
  const ans = term(n);
  const other = odd ? (decEven ? b - (k - 1) * d2 : b + (k - 1) * d2) : a + (k - 1) * d1;
  const sub = odd ? [a, d1, '+'] : [b, d2, decEven ? '−' : '+'];
  const wrongN = odd ? a + (n - 1) * d1 : decEven ? b - (n - 1) * d2 : b + (n - 1) * d2;
  return {
    text: `一列数：${shown.join('、')}、…，按这个规律，第 ${n} 个数是多少？`,
    o: N(rng, ans, [other, term(n + 2), term(n - 2), wrongN]),
    explain:
      `奇数位置上的数 ${shown[0]}、${shown[2]}、${shown[4]}…每次加 ${d1}；偶数位置上的数 ${shown[1]}、${shown[3]}、${shown[5]}…每次${decEven ? '减' : '加'} ${d2}。` +
      `第 ${n} 个是${odd ? '奇' : '偶'}数位置上的第 ${k} 个：${sub[0]} ${sub[2]} ${sub[1]} × ${k - 1} = ${ans}。`,
    verify: { kind: 'g3b-alt', p: [n, ...shown], ans },
  };
};

function figRing(): string {
  const parts: string[] = [];
  const sp = 15;
  const yb = 108;
  let x = 40;
  for (const k of [2, 3, 4]) {
    const top = yb - (k - 1) * sp;
    for (let i = 0; i < k; i++)
      for (let j = 0; j < k; j++)
        if (i === 0 || j === 0 || i === k - 1 || j === k - 1) parts.push(dot(x + j * sp, top + i * sp, 5, FIG.accent2));
    parts.push(text(x + ((k - 1) * sp) / 2, yb + 28, `每边 ${k} 枚`, { size: 12, color: FIG.dim }));
    x += (k - 1) * sp + 55;
  }
  return svg(parts);
}

const glRing: Tpl = (rng) => {
  if (rng() < 0.55) {
    const n = randInt(rng, 5, 25);
    const ans = 4 * n - 4;
    return {
      text: `用棋子摆空心正方形（如图）：每边 2 枚共 4 枚，每边 3 枚共 8 枚，每边 4 枚共 12 枚。每边 ${n} 枚共多少枚？`,
      o: N(rng, ans, [4 * n, n * n, 4 * n - 2, 4 * n - 8], ' 枚'),
      explain: `4 条边共 4 × ${n} = ${4 * n} 枚，但 4 个角上的棋子都被数了两次，要减去 4。${4 * n} − 4 = ${ans} 枚。`,
      verify: { kind: 'g3b-ring', p: [0, n], ans },
      figure: figRing(),
    };
  }
  const n = randInt(rng, 6, 30);
  const X = 4 * n - 4;
  return {
    text: `用棋子摆空心正方形（如图），每边 2 枚共 4 枚，每边 3 枚共 8 枚……照这样，共用 ${X} 枚时，每边有多少枚？`,
    o: N(rng, n, [X / 4, X / 4 - 1, n + 1, X / 2], ' 枚'),
    explain: `总数 = 每边枚数 × 4 − 4（四个角重复数了）。所以每边：(${X} + 4) ÷ 4 = ${n} 枚。`,
    verify: { kind: 'g3b-ring', p: [1, X], ans: n },
    figure: figRing(),
  };
};

const glGroup: Tpl = (rng) => {
  const B = rng() < 0.5;
  const n = B ? randInt(rng, 20, 60) : randInt(rng, 20, 70);
  let m = 1;
  while (tri(m) < n) m++;
  const before = tri(m - 1);
  if (!B) {
    return {
      text: `一列数：1、2、2、3、3、3、4、4、4、4、…，按这个规律，第 ${n} 个数是几？`,
      o: N(rng, m, [m + 1, m - 1, n - before, Math.floor(n / 2)]),
      explain: `数 k 连续写 k 个。1 + 2 + … + ${m - 1} = ${before}，1 + 2 + … + ${m} = ${tri(m)}，第 ${n} 个落在写 ${m} 的那一段，所以是 ${m}。`,
      verify: { kind: 'g3b-group', p: [0, n], ans: m },
    };
  }
  const ans = n - before;
  return {
    text: `一列数：1、1、2、1、2、3、1、2、3、4、1、…，按这个规律，第 ${n} 个数是几？`,
    o: N(rng, ans, [m, ans + 1, ans - 1, m - ans, m + 1]),
    explain: `分组：(1)、(1,2)、(1,2,3)…，第 k 组是 1 到 k。前 ${m - 1} 组共 ${before} 个数，第 ${n} 个是第 ${m} 组的第 ${n} − ${before} = ${ans} 个，就是 ${ans}。`,
    verify: { kind: 'g3b-group', p: [1, n], ans },
  };
};

/* ───────────── 数图形 ───────────── */

function figPoints(n: number, lens?: number[]): string {
  const x0 = 26;
  const x1 = 234;
  const y = 84;
  const w = lens ? lens.map((l) => l + 3) : Array.from({ length: n - 1 }, () => 1);
  const tot = sumOf(w);
  const xs = [x0];
  for (const wi of w) xs.push(xs[xs.length - 1] + ((x1 - x0) * wi) / tot);
  const parts = [line(x0, y, x1, y, { width: 2.5 })];
  xs.forEach((x, i) => {
    parts.push(dot(x, y, 4.5, FIG.accent2));
    parts.push(text(x, y - 20, LET[i], { size: 15 }));
  });
  if (lens) lens.forEach((l, i) => parts.push(text((xs[i] + xs[i + 1]) / 2, y + 20, l, { size: 13, color: FIG.accent })));
  return svg(parts);
}

function figRays(k: number): string {
  const cx = 130;
  const cy = 146;
  const L = 106;
  const parts: string[] = [];
  for (let i = 0; i < k; i++) {
    const ang = ((15 + (i * 150) / (k - 1)) * Math.PI) / 180;
    parts.push(line(cx, cy, cx + L * Math.cos(ang), cy - L * Math.sin(ang), { width: 2.2 }));
    parts.push(text(cx + (L + 13) * Math.cos(ang), cy - (L + 13) * Math.sin(ang), LET[i], { size: 14, color: FIG.accent2 }));
  }
  parts.push(dot(cx, cy, 3.5));
  parts.push(text(cx, cy + 14, 'O', { size: 14 }));
  return svg(parts);
}

function figStrip(n: number, squares: boolean): string {
  const parts: string[] = [];
  const W = squares ? Math.min(36 * n, 220) : 220;
  const cw = W / n;
  const H = squares ? cw : 56;
  const x = (260 - W) / 2;
  const y = (170 - H) / 2;
  parts.push(rect(x, y, W, H, { width: 2.2 }));
  for (let i = 1; i < n; i++) parts.push(line(x + i * cw, y, x + i * cw, y + H, { width: 2 }));
  return svg(parts);
}

/** 三角形：顶点向底边引线，把底边分成 m 段；再加 h 条平行于底边的横线 */
function figFan(m: number, h: number): string {
  const ax = 130;
  const ay = 16;
  const by = 152;
  const bl = 26;
  const br = 234;
  const parts: string[] = [];
  for (let j = 0; j <= h; j++) {
    const y = ay + ((by - ay) * (j + 1)) / (h + 1);
    const t = (y - ay) / (by - ay);
    parts.push(line(ax + (bl - ax) * t, y, ax + (br - ax) * t, y, { width: 2 }));
  }
  for (let i = 0; i <= m; i++) parts.push(line(ax, ay, bl + ((br - bl) * i) / m, by, { width: 2 }));
  return svg(parts);
}

function figGrid(r: number, c: number, shade?: [number, number]): string {
  const cell = Math.min(34, Math.floor(210 / c), Math.floor(132 / r));
  const x = (260 - c * cell) / 2;
  const y = (170 - r * cell) / 2;
  const parts: string[] = [];
  if (shade) parts.push(rect(x + (shade[1] - 1) * cell, y + (shade[0] - 1) * cell, cell, cell, { stroke: 'none', width: 0, fill: FIG.fill2 }));
  parts.push(grid(x, y, r, c, cell, { width: 2 }));
  return svg(parts);
}

const stSeg: Tpl = (rng) => {
  const n = randInt(rng, 4, 9);
  const ticket = rng() < 0.4;
  const ans = tri(n - 1);
  const sum = `${downFrom(n - 1).join(' + ')} = ${ans}`;
  return ticket
    ? {
        text: `如图，一条铁路上有 ${n} 个车站，往返票价相同。一共要准备多少种不同的票价？`,
        o: N(rng, ans, [n - 1, n, n * (n - 1), ans + 1], ' 种'),
        explain: `每两个车站之间有一种票价，就是数图中的线段。${sum} 种。`,
        verify: { kind: 'g3b-segs', p: [n], ans },
        figure: figPoints(n),
      }
    : {
        text: `如图，一条线段上共有 ${n} 个点（含两个端点）。图中一共有多少条线段？`,
        o: N(rng, ans, [n - 1, n, n * (n - 1), ans + 1], ' 条'),
        explain: `每两个点确定一条线段。从左边的点依次往右数：${sum} 条。`,
        verify: { kind: 'g3b-segs', p: [n], ans },
        figure: figPoints(n),
      };
};

const stAngle: Tpl = (rng) => {
  const k = randInt(rng, 3, 7);
  const ans = tri(k - 1);
  const v = rng() < 0.5;
  return {
    text: v
      ? `如图，从 O 点出发画了 ${k} 条射线。图中一共有多少个角？`
      : `如图，∠AO${LET[k - 1]} 内又画了 ${k - 2} 条射线。图中一共有多少个角？`,
    o: N(rng, ans, [k - 1, k, k * (k - 1), ans + 1], ' 个'),
    explain: `图中共 ${k} 条射线，每两条组成一个角。${downFrom(k - 1).join(' + ')} = ${ans} 个。`,
    verify: { kind: 'g3b-angles', p: [k], ans },
    figure: figRays(k),
  };
};

const stStrip: Tpl = (rng) => {
  const n = randInt(rng, 3, 8);
  const sq = rng() < 0.5;
  const ans = tri(n);
  return {
    text: sq
      ? `如图，${n} 个小正方形排成一排。图中一共有多少个长方形（含正方形）？`
      : `如图，一个长方形被竖线分成 ${n} 个小长方形。图中一共有多少个长方形？`,
    o: N(rng, ans, [n, n + 1, n * (n + 1), ans - 1], ' 个'),
    explain: `长方形的左右两条边从 ${n + 1} 条竖线中任选两条，就像数线段：${downFrom(n).join(' + ')} = ${ans} 个。`,
    verify: { kind: 'g3b-rects', p: [1, n], ans },
    figure: figStrip(n, sq),
  };
};

const stFan: Tpl = (rng) => {
  const m = randInt(rng, 2, 6);
  const ans = tri(m);
  const v = rng() < 0.5;
  return {
    text: v
      ? `如图，从三角形的顶点向底边画了 ${m - 1} 条线段。图中一共有多少个三角形？`
      : `如图，一个大三角形被分成了 ${m} 个小三角形。图中一共有多少个三角形？`,
    o: N(rng, ans, [m, m + 1, m * (m + 1), ans - 1], ' 个'),
    explain: `每个三角形都由顶点和底边上的一条线段组成。底边上有 ${m + 1} 个点，线段有 ${downFrom(m).join(' + ')} = ${ans} 条，所以有 ${ans} 个三角形。`,
    verify: { kind: 'g3b-tri', p: [m, 0], ans },
    figure: figFan(m, 0),
  };
};

const squaresIn = (r: number, c: number): number[] => {
  const out: number[] = [];
  for (let k = 1; k <= Math.min(r, c); k++) out.push((r - k + 1) * (c - k + 1));
  return out;
};

const stGridRect: Tpl = (rng) => {
  const r = randInt(rng, 2, 4);
  const c = randInt(rng, r, 5);
  const ans = tri(r) * tri(c);
  return {
    text:
      rng() < 0.5
        ? `如图是 ${r} 行 ${c} 列的方格。图中一共有多少个长方形（含正方形）？`
        : `如图，${r * c} 个同样的小正方形拼成 ${r} 行 ${c} 列。图中共有多少个长方形（含正方形）？`,
    o: N(rng, ans, [r * c, tri(r) + tri(c), sumOf(squaresIn(r, c)), ans - r * c], ' 个'),
    explain: `长方形由一条横边上的线段和一条竖边上的线段决定。横边上的线段有 ${downFrom(c).join(' + ')} = ${tri(c)} 条，竖边上有 ${downFrom(r).join(' + ')} = ${tri(r)} 条。${tri(c)} × ${tri(r)} = ${ans} 个。`,
    verify: { kind: 'g3b-rects', p: [r, c], ans },
    figure: figGrid(r, c),
  };
};

const stGridSquare: Tpl = (rng) => {
  const r = randInt(rng, 2, 4);
  const c = randInt(rng, r, 5);
  const parts = squaresIn(r, c);
  const ans = sumOf(parts);
  return {
    text:
      rng() < 0.5
        ? `如图是 ${r} 行 ${c} 列的方格。图中一共有多少个正方形？`
        : `如图，${r * c} 个同样的小正方形拼成 ${r} 行 ${c} 列。图中一共有多少个正方形？`,
    o: N(rng, ans, [r * c, ans - parts[parts.length - 1], tri(r) * tri(c), ans + 1], ' 个'),
    explain: `按大小分类数：${parts.map((p, i) => `边长 ${i + 1} 格的 ${p} 个`).join('，')}。共 ${parts.join(' + ')} = ${ans} 个。`,
    verify: { kind: 'g3b-squares', p: [r, c], ans },
    figure: figGrid(r, c),
  };
};

const stStack: Tpl = (rng) => {
  const m = randInt(rng, 2, 5);
  const h = randInt(rng, 1, 3);
  const one = tri(m);
  const ans = one * (h + 1);
  return {
    text: `如图，从三角形顶点向底边引了 ${m - 1} 条线段，又画了 ${h} 条与底边平行的横线。图中一共有多少个三角形？`,
    o: N(rng, ans, [one, one * h, m * (h + 1), ans + h + 1], ' 个'),
    explain: `每条横线（含底边）和顶点引出的 ${m + 1} 条线组成 ${downFrom(m).join(' + ')} = ${one} 个三角形。共 ${h + 1} 条横线：${one} × ${h + 1} = ${ans} 个。`,
    verify: { kind: 'g3b-tri', p: [m, h], ans },
    figure: figFan(m, h),
  };
};

const stShaded: Tpl = (rng) => {
  const r = randInt(rng, 1, 3);
  const c = randInt(rng, 3, 6);
  const sr = randInt(rng, 1, r);
  const sc = randInt(rng, 1, c);
  const L = sc;
  const R = c - sc + 1;
  const T = sr;
  const B = r - sr + 1;
  const ans = L * R * T * B;
  const all = tri(r) * tri(c);
  if (r === 1) {
    return {
      text: `如图，一排 ${c} 个小方格，左数第 ${sc} 格涂了色。包含涂色格的长方形（含正方形）有多少个？`,
      o: N(rng, ans, [all, L + R, ans + 1, all - ans], ' 个'),
      explain: `长方形要盖住涂色格：左边线可以选涂色格左边的 ${L} 条竖线之一，右边线可选 ${R} 条之一。${L} × ${R} = ${ans} 个。`,
      verify: { kind: 'g3b-shaded', p: [r, c, sr, sc], ans },
      figure: figGrid(r, c, [sr, sc]),
    };
  }
  return {
    text: `如图，${r} 行 ${c} 列的方格中，第 ${sr} 行左数第 ${sc} 格涂了色。包含涂色格的长方形（含正方形）有多少个？`,
    o: N(rng, ans, [all, L + R + T + B, L * R, T * B * c], ' 个'),
    explain: `要盖住涂色格：左边线有 ${L} 种选法，右边线 ${R} 种，上边线 ${T} 种，下边线 ${B} 种。${L} × ${R} × ${T} × ${B} = ${ans} 个。`,
    verify: { kind: 'g3b-shaded', p: [r, c, sr, sc], ans },
    figure: figGrid(r, c, [sr, sc]),
  };
};

const stSegSum: Tpl = (rng) => {
  const n = randInt(rng, 4, 5);
  const lens = Array.from({ length: n - 1 }, () => randInt(rng, 1, 6));
  const cnt = lens.map((_, i) => (i + 1) * (n - 1 - i));
  const ans = sumOf(lens.map((l, i) => l * cnt[i]));
  const total = sumOf(lens);
  const names = lens.map((_, i) => `${LET[i]}${LET[i + 1]}`);
  return {
    text: `如图，${LET.slice(0, n).split('').join('、')} 依次在一条直线上，${names.map((nm, i) => `${nm}=${lens[i]}`).join('，')}（厘米）。图中所有线段的长度和是多少厘米？`,
    o: N(rng, ans, [total, total * tri(n - 1), ans - total, total * (n - 1)], ' 厘米'),
    explain: `每条小线段被几条线段包含：${names.map((nm, i) => `${nm} ${cnt[i]} 次`).join('，')}。长度和 = ${lens.map((l, i) => `${l} × ${cnt[i]}`).join(' + ')} = ${ans} 厘米。`,
    verify: { kind: 'g3b-segsum', p: lens, ans },
    figure: figPoints(n, lens),
  };
};

/* ───────────── 盈亏问题 ───────────── */

const YK: [string, string][] = [
  ['苹果', '个'],
  ['练习本', '本'],
  ['铅笔', '支'],
  ['糖果', '颗'],
  ['贴纸', '张'],
];
const KIDS = ['小朋友', '同学', '学生'] as const;

const ykBasic: Tpl = (rng) => {
  const [th, u] = pick(rng, YK);
  const kid = pick(rng, KIDS);
  const { a, b, x, s1, s2 } = until(() => {
    const a = randInt(rng, 2, 8);
    const b = a + randInt(rng, 1, 4);
    const x = randInt(rng, 4, 25);
    const s1 = randInt(rng, 1, 20);
    const s2 = (b - a) * x - s1;
    return s2 >= 1 && s2 <= 30 ? { a, b, x, s1, s2 } : null;
  });
  const T = a * x + s1;
  const askT = rng() < 0.4;
  const base = `两种分法每人相差 ${b} − ${a} = ${b - a} ${u}，总数相差 ${s1} + ${s2} = ${s1 + s2} ${u}。人数：${s1 + s2} ÷ ${b - a} = ${x} 人`;
  return {
    text: `老师给${kid}分${th}，每人分 ${a} ${u}，多 ${s1} ${u}；每人分 ${b} ${u}，少 ${s2} ${u}。${askT ? `一共有多少${u}${th}？` : `一共有多少人？`}`,
    o: askT
      ? N(rng, T, [a * x, b * x, b * x + s2, T + s1], ` ${u}`)
      : N(rng, x, [s1 + s2, (s2 - s1) / (b - a), x + 1, x - 1], ' 人'),
    explain: askT ? `${base}；${th}：${a} × ${x} + ${s1} = ${T} ${u}。` : `${base}。`,
    verify: { kind: 'g3b-yk', p: [a, s1, b, -s2, askT ? 1 : 0], ans: askT ? T : x },
  };
};

const ykExact: Tpl = (rng) => {
  const [th, u] = pick(rng, YK);
  const kid = pick(rng, KIDS);
  const a = randInt(rng, 2, 8);
  const b = a + randInt(rng, 1, 4);
  const x = randInt(rng, 4, 20);
  const s = (b - a) * x;
  const surplus = rng() < 0.5;
  const askT = rng() < 0.4;
  const T = surplus ? b * x : a * x;
  const cond = surplus
    ? `每人分 ${a} ${u}，多 ${s} ${u}；每人分 ${b} ${u}，正好分完。`
    : `每人分 ${b} ${u}，少 ${s} ${u}；每人分 ${a} ${u}，正好分完。`;
  const base = surplus
    ? `每人多分 ${b} − ${a} = ${b - a} ${u}，正好用掉多出的 ${s} ${u}。人数：${s} ÷ ${b - a} = ${x} 人`
    : `每人少分 ${b} − ${a} = ${b - a} ${u}，正好省出缺少的 ${s} ${u}。人数：${s} ÷ ${b - a} = ${x} 人`;
  return {
    text: `把一些${th}分给${kid}，${cond}${askT ? `一共有多少${u}${th}？` : '一共有多少人？'}`,
    o: askT ? N(rng, T, [surplus ? a * x : b * x, T + s, s * b, T - x], ` ${u}`) : N(rng, x, [s, s / a, x + 1, x - 1], ' 人'),
    explain: askT ? `${base}；${th}：${surplus ? b : a} × ${x} = ${T} ${u}。` : `${base}。`,
    verify: surplus
      ? { kind: 'g3b-yk', p: [a, s, b, 0, askT ? 1 : 0], ans: askT ? T : x }
      : { kind: 'g3b-yk', p: [b, -s, a, 0, askT ? 1 : 0], ans: askT ? T : x },
  };
};

const ykTwoSur: Tpl = (rng) => {
  const [th, u] = pick(rng, YK);
  const kid = pick(rng, KIDS);
  const a = randInt(rng, 2, 7);
  const b = a + randInt(rng, 1, 3);
  const x = randInt(rng, 5, 20);
  const s2 = randInt(rng, 1, 15);
  const s1 = s2 + (b - a) * x;
  const T = a * x + s1;
  const askT = rng() < 0.4;
  const base = `两种分法每人相差 ${b} − ${a} = ${b - a} ${u}，多出的数相差 ${s1} − ${s2} = ${s1 - s2} ${u}。人数：${s1 - s2} ÷ ${b - a} = ${x} 人`;
  return {
    text: `给${kid}分${th}，每人分 ${a} ${u}，多 ${s1} ${u}；每人分 ${b} ${u}，还多 ${s2} ${u}。${askT ? `一共有多少${u}${th}？` : '一共有多少人？'}`,
    o: askT
      ? N(rng, T, [a * x, b * x, T - s2, T + s2], ` ${u}`)
      : N(rng, x, [(s1 + s2) / (b - a), s1 - s2, x + 1, x - 1], ' 人'),
    explain: askT ? `${base}；${th}：${a} × ${x} + ${s1} = ${T} ${u}。` : `${base}。`,
    verify: { kind: 'g3b-yk', p: [a, s1, b, s2, askT ? 1 : 0], ans: askT ? T : x },
  };
};

const ykTwoDef: Tpl = (rng) => {
  const [th, u] = pick(rng, YK);
  const kid = pick(rng, KIDS);
  const { a, b, x, s1, s2 } = until(() => {
    const a = randInt(rng, 3, 8);
    const b = a + randInt(rng, 1, 3);
    const x = randInt(rng, 5, 20);
    const s1 = randInt(rng, 1, 15);
    const s2 = s1 + (b - a) * x;
    return a * x - s1 >= 5 ? { a, b, x, s1, s2 } : null;
  });
  const T = a * x - s1;
  const askT = rng() < 0.4;
  const base = `两种分法每人相差 ${b} − ${a} = ${b - a} ${u}，不够的数相差 ${s2} − ${s1} = ${s2 - s1} ${u}。人数：${s2 - s1} ÷ ${b - a} = ${x} 人`;
  return {
    text: `给${kid}分${th}，每人分 ${a} ${u}，少 ${s1} ${u}；每人分 ${b} ${u}，少 ${s2} ${u}。${askT ? `一共有多少${u}${th}？` : '一共有多少人？'}`,
    o: askT
      ? N(rng, T, [a * x, b * x, T + s1 * 2, a * x + s1], ` ${u}`)
      : N(rng, x, [(s1 + s2) / (b - a), s2 - s1, x + 1, x - 1], ' 人'),
    explain: askT ? `${base}；${th}：${a} × ${x} − ${s1} = ${T} ${u}。` : `${base}。`,
    verify: { kind: 'g3b-yk', p: [a, -s1, b, -s2, askT ? 1 : 0], ans: askT ? T : x },
  };
};

const ykBoats: Tpl = (rng) => {
  const { a, b, k, x, s } = until(() => {
    const a = randInt(rng, 3, 6);
    const b = a + randInt(rng, 1, 3);
    const k = randInt(rng, 1, 2);
    const x = randInt(rng, k + 4, 20);
    const s = b * (x - k) - a * x;
    return s >= 1 && s <= 25 ? { a, b, k, x, s } : null;
  });
  const P = a * x + s;
  const askP = rng() < 0.4;
  const base = `空出 ${k} 条船，相当于少坐 ${b} × ${k} = ${b * k} 人。两种坐法每船相差 ${b - a} 人，总共相差 ${s} + ${b * k} = ${s + b * k} 人，船：${s + b * k} ÷ ${b - a} = ${x} 条`;
  return {
    text: `同学们去划船，每条船坐 ${a} 人，有 ${s} 人没船坐；每条船坐 ${b} 人，正好空出 ${k} 条船。${askP ? '一共有多少名同学？' : '一共有多少条船？'}`,
    o: askP
      ? N(rng, P, [a * x, b * x, P + b, b * (x + k)], ' 人')
      : N(rng, x, [(s + k) / (b - a), s / (b - a), x - k, x + k], ' 条'),
    explain: askP ? `${base}；人数：${a} × ${x} + ${s} = ${P} 人。` : `${base}。`,
    verify: { kind: 'g3b-boat', p: [a, s, b, k, askP ? 1 : 0], ans: askP ? P : x },
  };
};

const ykPartial: Tpl = (rng) => {
  const [th, u] = pick(rng, YK);
  const { a, b, r, x, s } = until(() => {
    const a = randInt(rng, 2, 7);
    const b = a + randInt(rng, 1, 3);
    const r = randInt(rng, 1, b - 1);
    const x = randInt(rng, 4, 20);
    const s = b * (x - 1) + r - a * x;
    return s >= 1 && s <= 30 ? { a, b, r, x, s } : null;
  });
  const T = a * x + s;
  const askT = rng() < 0.35;
  const base = `最后一人还差 ${b} − ${r} = ${b - r} ${u}，相当于“少 ${b - r} ${u}”。人数：(${s} + ${b - r}) ÷ (${b} − ${a}) = ${x} 人`;
  return {
    text: `分${th}时，每人分 ${a} ${u}，多 ${s} ${u}；每人分 ${b} ${u}，最后一人只能分到 ${r} ${u}。${askT ? `一共有多少${u}${th}？` : '一共有多少人？'}`,
    o: askT
      ? N(rng, T, [a * x, b * x, b * x + r, T + r], ` ${u}`)
      : N(rng, x, [(s + r) / (b - a), s / (b - a), x + 1, x - 1], ' 人'),
    explain: askT ? `${base}；${th}：${a} × ${x} + ${s} = ${T} ${u}。` : `${base}。`,
    verify: { kind: 'g3b-part', p: [a, s, b, r, askT ? 1 : 0], ans: askT ? T : x },
  };
};

const ykPrice: Tpl = (rng) => {
  const [item, u] = pick(rng, [
    ['笔记本', '本'],
    ['钢笔', '支'],
    ['足球', '个'],
    ['故事书', '本'],
  ] as [string, string][]);
  const [nm] = two(rng, NAMES);
  const { a, b, p, s, t } = until(() => {
    const b = randInt(rng, 2, 8);
    const a = b + randInt(rng, 1, 4);
    const p = randInt(rng, 3, 25);
    const s = randInt(rng, 1, Math.min(p * 2, 40));
    const t = (a - b) * p - s;
    return t >= 1 && t <= 60 ? { a, b, p, s, t } : null;
  });
  const M = b * p + t;
  const askM = rng() < 0.6;
  const base = `两种买法相差 ${a} − ${b} = ${a - b} ${u}，钱相差 ${s} + ${t} = ${s + t} 元，每${u} ${s + t} ÷ ${a - b} = ${p} 元`;
  return {
    text: `${nm}带钱买${item}，买 ${a} ${u}还差 ${s} 元，买 ${b} ${u}还剩 ${t} 元。${askM ? `${nm}带了多少元？` : `每${u}${item}多少元？`}`,
    o: askM ? N(rng, M, [b * p, a * p, M + s, p], ' 元') : N(rng, p, [(t - s) / (a - b), s + t, p + 1, p - 1], ' 元'),
    explain: askM ? `${base}；带的钱：${b} × ${p} + ${t} = ${M} 元。` : `${base}。`,
    verify: { kind: 'g3b-price', p: [a, s, b, t, askM ? 1 : 0], ans: askM ? M : p },
  };
};

/* ───────────── 归一与归总 ───────────── */

interface UCtx {
  fwd: (a: number, A: number, b: number) => string;
  rev: (a: number, A: number, B: number) => string;
  uf: string;
  ur: string;
  per: (A: number, a: number, u: number) => string;
}

const UCTX: UCtx[] = [
  {
    fwd: (a, A, b) => `${a} 支钢笔共 ${A} 元，买 ${b} 支同样的钢笔要多少元？`,
    rev: (a, A, B) => `${a} 支钢笔共 ${A} 元，${B} 元可以买多少支同样的钢笔？`,
    uf: '元',
    ur: '支',
    per: (A, a, u) => `每支：${A} ÷ ${a} = ${u} 元`,
  },
  {
    fwd: (a, A, b) => `一台织布机 ${a} 小时织布 ${A} 米。照这样，${b} 小时织布多少米？`,
    rev: (a, A, B) => `一台织布机 ${a} 小时织布 ${A} 米。照这样，织 ${B} 米布要多少小时？`,
    uf: '米',
    ur: '小时',
    per: (A, a, u) => `每小时：${A} ÷ ${a} = ${u} 米`,
  },
  {
    fwd: (a, A, b) => `小华 ${a} 分钟打字 ${A} 个。照这样，${b} 分钟能打字多少个？`,
    rev: (a, A, B) => `小华 ${a} 分钟打字 ${A} 个。照这样，打 ${B} 个字要多少分钟？`,
    uf: '个',
    ur: '分钟',
    per: (A, a, u) => `每分钟：${A} ÷ ${a} = ${u} 个`,
  },
  {
    fwd: (a, A, b) => `${a} 箱苹果重 ${A} 千克，${b} 箱同样的苹果重多少千克？`,
    rev: (a, A, B) => `${a} 箱苹果重 ${A} 千克，${B} 千克这样的苹果能装多少箱？`,
    uf: '千克',
    ur: '箱',
    per: (A, a, u) => `每箱：${A} ÷ ${a} = ${u} 千克`,
  },
];

const gyForward: Tpl = (rng) => {
  const c = pick(rng, UCTX);
  const u = randInt(rng, 2, 15);
  const a = randInt(rng, 2, 9);
  const b = until(() => {
    const v = randInt(rng, 2, 15);
    return v === a ? null : v;
  });
  const A = a * u;
  const ans = b * u;
  return {
    text: c.fwd(a, A, b),
    o: N(rng, ans, [u, A * b, A + (b > a ? b - a : a - b), ans + u], ` ${c.uf}`),
    explain: `先求一份：${c.per(A, a, u)}。再求 ${b} 份：${u} × ${b} = ${ans} ${c.uf}。`,
    verify: { kind: 'g3b-unit', p: [a, A, b], ans },
  };
};

const gyBackward: Tpl = (rng) => {
  const c = pick(rng, UCTX);
  const u = randInt(rng, 2, 15);
  const a = randInt(rng, 2, 9);
  const k = until(() => {
    const v = randInt(rng, 2, 20);
    return v === a ? null : v;
  });
  const A = a * u;
  const B = k * u;
  return {
    text: c.rev(a, A, B),
    o: N(rng, k, [B / a, B - A, k + 1, k - 1, u], ` ${c.ur}`),
    explain: `先求一份：${c.per(A, a, u)}。${B} 里有几个 ${u}：${B} ÷ ${u} = ${k} ${c.ur}。`,
    verify: { kind: 'g3b-unitRev', p: [a, A, B], ans: k },
  };
};

interface DCtx {
  M: string;
  Tu: string;
  verb: string;
  pu: string;
}
const DCTX: DCtx[] = [
  { M: '台机器', Tu: '天', verb: '生产零件', pu: '个' },
  { M: '头牛', Tu: '天', verb: '吃草', pu: '千克' },
  { M: '台抽水机', Tu: '小时', verb: '抽水', pu: '吨' },
  { M: '个工人', Tu: '天', verb: '修路', pu: '米' },
];

const gyDouble: Tpl = (rng) => {
  const c = pick(rng, DCTX);
  const u = randInt(rng, 2, 12);
  const m1 = randInt(rng, 2, 6);
  const d1 = randInt(rng, 2, 8);
  const [m2, d2] = until(() => {
    const x = randInt(rng, 2, 9);
    const y = randInt(rng, 2, 9);
    return x === m1 && y === d1 ? null : [x, y];
  });
  const T = u * m1 * d1;
  const ans = u * m2 * d2;
  return {
    text: `${m1} ${c.M} ${d1} ${c.Tu}${c.verb} ${T} ${c.pu}。照这样，${m2} ${c.M} ${d2} ${c.Tu}${c.verb}多少${c.pu}？`,
    o: N(rng, ans, [(T / m1) * m2, (T / d1) * d2, u * m2, u * (m2 + d2)], ` ${c.pu}`),
    explain: `先求 1 ${c.M} 1 ${c.Tu}：${T} ÷ ${m1} ÷ ${d1} = ${u} ${c.pu}。${m2} ${c.M} ${d2} ${c.Tu}：${u} × ${m2} × ${d2} = ${ans} ${c.pu}。`,
    verify: { kind: 'g3b-dbl', p: [m1, d1, T, m2, d2], ans },
  };
};

const gyDoubleRev: Tpl = (rng) => {
  const c = pick(rng, DCTX);
  const u = randInt(rng, 2, 12);
  const m1 = randInt(rng, 2, 6);
  const d1 = randInt(rng, 2, 8);
  const m2 = until(() => {
    const x = randInt(rng, 2, 9);
    return x === m1 ? null : x;
  });
  const days = until(() => {
    const x = randInt(rng, 2, 12);
    return x === d1 ? null : x;
  });
  const T = u * m1 * d1;
  const T2 = u * m2 * days;
  return {
    text: `${m1} ${c.M} ${d1} ${c.Tu}${c.verb} ${T} ${c.pu}。照这样，${m2} ${c.M}${c.verb} ${T2} ${c.pu}要多少${c.Tu}？`,
    o: N(rng, days, [T2 / u / m1, T2 / (T / d1), days + 1, T2 / m2 / d1], ` ${c.Tu}`),
    explain: `1 ${c.M} 1 ${c.Tu}：${T} ÷ ${m1} ÷ ${d1} = ${u} ${c.pu}；${m2} ${c.M} 1 ${c.Tu}：${u} × ${m2} = ${u * m2} ${c.pu}。${T2} ÷ ${u * m2} = ${days} ${c.Tu}。`,
    verify: { kind: 'g3b-dblRev', p: [m1, d1, T, m2, T2], ans: days },
  };
};

const gyTotal: Tpl = (rng) => {
  const form = randInt(rng, 0, 2);
  const { a, b, c } = until(() => {
    const a = randInt(rng, 3, 20);
    const b = randInt(rng, 3, 20);
    const c = randInt(rng, 2, 40);
    const tot = a * b;
    return c !== a && c !== b && tot % c === 0 && tot / c >= 2 && tot / c !== a ? { a, b, c } : null;
  });
  const tot = a * b;
  const ans = tot / c;
  const T = [
    { t: `一本书每天看 ${a} 页，${b} 天看完。如果每天看 ${c} 页，几天能看完？`, u: '天', what: '全书页数' },
    { t: `一项工程 ${a} 人做 ${b} 天完成。照这样的工效，要 ${c} 天完成，需要多少人？`, u: '人', what: '总工作量（1 人 1 天为 1 份）' },
    { t: `一批大米每袋装 ${a} 千克，正好装 ${b} 袋。如果每袋装 ${c} 千克，可以装多少袋？`, u: '袋', what: '大米总重' },
  ][form];
  return {
    text: T.t,
    o: N(rng, ans, [(b * c) / a, tot, ans + 1, ans - 1, b + c - a], ` ${T.u}`),
    explain: `${T.what}不变：${a} × ${b} = ${tot}。${tot} ÷ ${c} = ${ans} ${T.u}。`,
    verify: { kind: 'g3b-tot', p: [a, b, c], ans },
  };
};

const gyFood: Tpl = (rng) => {
  const { a, b, k, c } = until(() => {
    const a = randInt(rng, 3, 12);
    const b = randInt(rng, 6, 30);
    const k = randInt(rng, 1, b - 2);
    const c = randInt(rng, 1, 12);
    const rest = a * (b - k);
    return rest % (a + c) === 0 && rest / (a + c) >= 2 ? { a, b, k, c } : null;
  });
  const rest = a * (b - k);
  const ans = rest / (a + c);
  return {
    text: `一批粮食够 ${a} 人吃 ${b} 天。吃了 ${k} 天后又来了 ${c} 人，剩下的粮食还够吃几天？`,
    o: N(rng, ans, [(a * b) / (a + c), b - k, b - k - c, ans + k], ' 天'),
    explain: `剩下的粮食够 ${a} 人吃 ${b} − ${k} = ${b - k} 天，共 ${a} × ${b - k} = ${rest} 份（1 人 1 天的量）。现在有 ${a + c} 人：${rest} ÷ ${a + c} = ${ans} 天。`,
    verify: { kind: 'g3b-food', p: [a, b, k, c], ans },
  };
};

const gyPlan: Tpl = (rng) => {
  const { a, b, c } = until(() => {
    const a = randInt(rng, 4, 20) * 5;
    const b = randInt(rng, 4, 20);
    const c = randInt(rng, 1, Math.min(10, a / 5)) * 5;
    const tot = a * b;
    return tot % (a + c) === 0 && tot / (a + c) < b ? { a, b, c } : null;
  });
  const tot = a * b;
  const act = tot / (a + c);
  const early = rng() < 0.55;
  const ans = early ? b - act : act;
  return {
    text: `修一条路，原计划每天修 ${a} 米，${b} 天修完。实际每天多修 ${c} 米，${early ? '可以提前几天修完' : '实际几天修完'}？`,
    o: early ? N(rng, ans, [act, ans + 1, ans - 1, (c * b) / a], ' 天') : N(rng, ans, [b - act, act + 1, act - 1, tot / c], ' 天'),
    explain: `路长：${a} × ${b} = ${tot} 米。实际每天修 ${a} + ${c} = ${a + c} 米，要 ${tot} ÷ ${a + c} = ${act} 天${early ? `，提前 ${b} − ${act} = ${ans} 天` : ''}。`,
    verify: { kind: 'g3b-plan', p: [a, b, c, early ? 1 : 0], ans },
  };
};

/* ───────────── 还原问题 ───────────── */

const OPN = ['加上', '减去', '乘', '除以'];
const OPS = ['+', '−', '×', '÷'];
const INV = [1, 0, 3, 2];
const applyOp = (v: number, op: number, n: number): number => (op === 0 ? v + n : op === 1 ? v - n : op === 2 ? v * n : v / n);

function chainForward(rng: Rng, x: number, steps: number): { ops: [number, number][]; R: number } | null {
  let v = x;
  const ops: [number, number][] = [];
  for (let s = 0; s < steps; s++) {
    let done = false;
    for (const op of shuffle(rng, [0, 1, 2, 3])) {
      if (ops.length > 0 && (ops[ops.length - 1][0] === op || INV[ops[ops.length - 1][0]] === op)) continue;
      if (op === 0) {
        const n = randInt(rng, 2, 30);
        ops.push([0, n]);
        v += n;
      } else if (op === 1) {
        if (v < 5) continue;
        const n = randInt(rng, 2, Math.min(v - 2, 40));
        ops.push([1, n]);
        v -= n;
      } else if (op === 2) {
        if (v > 60) continue;
        const n = randInt(rng, 2, 5);
        ops.push([2, n]);
        v *= n;
      } else {
        const ds = [2, 3, 4, 5, 6, 7, 8, 9].filter((d) => v % d === 0 && v / d >= 2);
        if (ds.length === 0) continue;
        const n = pick(rng, ds);
        ops.push([3, n]);
        v /= n;
      }
      done = true;
      break;
    }
    if (!done) return null;
  }
  return { ops, R: v };
}

/** 把一串运算按顺序作用在 v 上；中途出现非自然数则返回 NaN */
function runChain(v: number, ops: [number, number][]): number {
  for (const [op, n] of ops) {
    v = applyOp(v, op, n);
    if (!Number.isInteger(v) || v < 0) return NaN;
  }
  return v;
}

const hyOps: Tpl = (rng) => {
  const steps = rng() < 0.5 ? 2 : 3;
  const { x, ops, R } = until(() => {
    const x = randInt(rng, 2, 30);
    const c = chainForward(rng, x, steps);
    return c && c.R >= 2 && c.R <= 500 ? { x, ...c } : null;
  });
  const words = ops.map(([o, n], i) => `${i === 0 ? '先' : i === ops.length - 1 ? '最后' : '再'}${OPN[o]} ${n}`);
  if (steps === 2) words[1] = words[1].replace('最后', '再');
  const back: string[] = [];
  let cur = R;
  for (let i = ops.length - 1; i >= 0; i--) {
    const [o, n] = ops[i];
    const prev = applyOp(cur, INV[o], n);
    back.push(`${cur} ${OPS[INV[o]]} ${n} = ${prev}`);
    cur = prev;
  }
  const sameOps = runChain(R, ops);
  const wrongOrder = runChain(
    R,
    ops.map(([o, n]) => [INV[o], n] as [number, number]),
  );
  return {
    text: `一个数${words.join('，')}，结果是 ${R}。这个数是多少？`,
    o: N(rng, x, [sameOps, wrongOrder, x + 1, x + 2, x - 1]),
    explain: `倒过来想，从结果往前用相反的运算：${back.join('，')}。这个数是 ${x}。`,
    verify: { kind: 'g3b-chain', p: [R, ...ops.flat()], ans: x },
  };
};

const hyStory: Tpl = (rng) => {
  const [nm] = two(rng, NAMES);
  const [th, u] = pick(rng, YK);
  if (rng() < 0.5) {
    const x = randInt(rng, 15, 80);
    const a = randInt(rng, 3, x - 3);
    const b = randInt(rng, 3, 30);
    const c = x - a + b;
    return {
      text: `${nm}有一些${th}，送给同学 ${a} ${u}后，又买来 ${b} ${u}，现在有 ${c} ${u}。${nm}原来有多少${u}？`,
      o: N(rng, x, [c + b - a, c + a + b, c - b - a, c], ` ${u}`),
      explain: `倒推：买来之前有 ${c} − ${b} = ${c - b} ${u}，送出之前有 ${c - b} + ${a} = ${x} ${u}。`,
      verify: { kind: 'g3b-chain', p: [c, 1, a, 0, b], ans: x },
    };
  }
  const h = randInt(rng, 5, 40);
  const x = h * 2;
  const b = randInt(rng, 3, 30);
  const c = h + b;
  return {
    text: `${nm}有一些${th}，送给同学一半后，又买来 ${b} ${u}，现在有 ${c} ${u}。${nm}原来有多少${u}？`,
    o: N(rng, x, [c * 2 + b, (c + b) * 2, c - b, c * 2 - b], ` ${u}`),
    explain: `倒推：买来之前有 ${c} − ${b} = ${h} ${u}，这是原来的一半，所以原来有 ${h} × 2 = ${x} ${u}。`,
    verify: { kind: 'g3b-chain', p: [c, 3, 2, 0, b], ans: x },
  };
};

/** 倒推“用去一半多/少 a”：more=1 表示一半多 a，more=0 表示一半少 a */
function halfBack(after: number, more: number, a: number): number {
  return more ? (after + a) * 2 : (after - a) * 2;
}

function halfChain(rng: Rng, steps: number): { c: number; st: [number, number][]; vals: number[] } {
  return until(() => {
    const c = randInt(rng, 2, 12);
    const st: [number, number][] = [];
    const vals = [c];
    let cur = c;
    for (let i = 0; i < steps; i++) {
      const more = rng() < 0.7 ? 1 : 0;
      const a = randInt(rng, 1, 6);
      if (!more && cur - 2 * a < 1) return null;
      cur = halfBack(cur, more, a);
      st.unshift([more, a]);
      vals.unshift(cur);
    }
    return cur <= 400 ? { c, st, vals } : null;
  });
}

const halfWord = ([more, a]: [number, number], u: string) => `一半${more ? '多' : '少'} ${a} ${u}`;

function halfExplain(st: [number, number][], vals: number[], u: string, labels: string[]): string {
  const parts: string[] = [];
  for (let i = st.length - 1; i >= 0; i--) {
    const [more, a] = st[i];
    parts.push(`${labels[i]}之前有 (${vals[i + 1]} ${more ? '+' : '−'} ${a}) × 2 = ${vals[i]} ${u}`);
  }
  return `倒推：${parts.join('；')}。`;
}

const hyHalf: Tpl = (rng) => {
  const { c, st, vals } = halfChain(rng, 2);
  const x = vals[0];
  const ctx = rng() < 0.5;
  const u = ctx ? '个' : '页';
  const [a1, a2] = [st[0][1], st[1][1]];
  const text = ctx
    ? `一筐苹果，第一次卖出${halfWord(st[0], u)}，第二次卖出剩下的${halfWord(st[1], u)}，还剩 ${c} 个。原来有多少个？`
    : `一本书，第一天看了全书的${halfWord(st[0], u)}，第二天看了剩下的${halfWord(st[1], u)}，还剩 ${c} 页。全书有多少页？`;
  return {
    text,
    o: N(rng, x, [c * 4 + a1 + a2, (c + a2) * 2 + a1, c * 4, x + 2, x - 2], ` ${u}`),
    explain: halfExplain(st, vals, u, ctx ? ['第一次卖', '第二次卖'] : ['第一天看', '第二天看']),
    verify: { kind: 'g3b-half', p: [c, ...st.flat()], ans: x },
  };
};

const hyHalf3: Tpl = (rng) => {
  const { c, st, vals } = halfChain(rng, 3);
  const x = vals[0];
  const ctx = rng() < 0.5;
  const u = ctx ? '千克' : '页';
  const text = ctx
    ? `一桶油，第一次倒出${halfWord(st[0], u)}，第二次倒出余下的${halfWord(st[1], u)}，第三次倒出余下的${halfWord(st[2], u)}，还剩 ${c} 千克。原有多少千克？`
    : `一本书，第一天看了${halfWord(st[0], u)}，第二天看了余下的${halfWord(st[1], u)}，第三天看了余下的${halfWord(st[2], u)}，还剩 ${c} 页。全书多少页？`;
  return {
    text,
    o: N(rng, x, [c * 8, vals[1], vals[1] * 2, x + 2, x - 2], ` ${u}`),
    explain: halfExplain(st, vals, u, ctx ? ['第一次倒', '第二次倒', '第三次倒'] : ['第一天', '第二天', '第三天']),
    verify: { kind: 'g3b-half', p: [c, ...st.flat()], ans: x },
  };
};

const hyWrong: Tpl = (rng) => {
  const [nm] = two(rng, NAMES);
  const v = randInt(rng, 0, 4);
  const k = randInt(rng, 2, 9);
  let x: number;
  let right: number;
  let wrong: number;
  if (v === 0) {
    x = k * randInt(rng, 2, 9);
    right = 2;
    wrong = 3;
  } else if (v === 1) {
    x = k * randInt(rng, 2, 12);
    right = 3;
    wrong = 2;
  } else if (v === 2) {
    x = randInt(rng, k + 5, 90);
    right = 0;
    wrong = 1;
  } else if (v === 3) {
    x = randInt(rng, 2 * k + 3, 90);
    right = 1;
    wrong = 0;
  } else {
    x = randInt(rng, 3, 20);
    right = 2;
    wrong = 0;
  }
  const r = applyOp(x, wrong, k);
  const ans = applyOp(x, right, k);
  return {
    text: `${nm}计算一个数${OPN[right]} ${k} 时，错算成了${OPN[wrong]} ${k}，得到 ${r}。正确的结果是多少？`,
    o: N(rng, ans, [x, applyOp(r, right, k), r, ans + k]),
    explain: `先倒推出这个数：${r} ${OPS[INV[wrong]]} ${k} = ${x}。再按正确的方法算：${x} ${OPS[right]} ${k} = ${ans}。`,
    verify: { kind: 'g3b-wrong', p: [wrong, right, k, r], ans },
  };
};

const hyGive3: Tpl = (rng) => {
  const [A, B, C] = shuffle(rng, [...NAMES]).slice(0, 3);
  const { m, a, b, c } = until(() => {
    const m = randInt(rng, 10, 40);
    const a = randInt(rng, 2, 15);
    const b = randInt(rng, 2, 15);
    const c = randInt(rng, 2, 15);
    const o = [m - c + a, m + b - a, m + c - b];
    if (c > m || o.some((y) => y < 1)) return null;
    if (o[0] === o[1] && o[1] === o[2]) return null;
    return { m, a, b, c };
  });
  const S = 3 * m;
  const orig = [m - c + a, m + b - a, m + c - b];
  const who = randInt(rng, 0, 2);
  const ans = orig[who];
  const head = `最后每人 ${S} ÷ 3 = ${m} 张。`;
  const ex = [
    `${head}倒推${A}：${C}给他 ${c} 张之前有 ${m} − ${c} = ${m - c} 张，他给出 ${a} 张之前有 ${m - c} + ${a} = ${ans} 张。`,
    `${head}倒推${B}：给${C} ${b} 张之前有 ${m} + ${b} = ${m + b} 张，收到${A}的 ${a} 张之前有 ${m + b} − ${a} = ${ans} 张。`,
    `${head}倒推${C}：给${A} ${c} 张之前有 ${m} + ${c} = ${m + c} 张，收到${B}的 ${b} 张之前有 ${m + c} − ${b} = ${ans} 张。`,
  ][who];
  return {
    text: `${A}、${B}、${C}共有 ${S} 张卡片。${A}给${B} ${a} 张，${B}再给${C} ${b} 张，${C}又给${A} ${c} 张，这时三人一样多。${[A, B, C][who]}原来有多少张？`,
    o: N(rng, ans, [m, orig[(who + 1) % 3], orig[(who + 2) % 3], ans + 2, [m + a, m - b + c, m - c + b][who]], ' 张'),
    explain: ex,
    verify: { kind: 'g3b-give3', p: [S, a, b, c, who], ans },
  };
};

const hyDouble: Tpl = (rng) => {
  const [A, B] = two(rng, NAMES);
  const [th, u] = pick(rng, [
    ['糖', '颗'],
    ['画片', '张'],
    ['弹珠', '颗'],
  ] as [string, string][]);
  const { p, q } = until(() => {
    const p = randInt(rng, 4, 30) * 2;
    const q = randInt(rng, 6, 60);
    return (q + p / 2) % 2 === 0 ? { p, q } : null;
  });
  const y1 = q + p / 2;
  const y0 = y1 / 2;
  const x0 = p / 2 + y0;
  const askA = rng() < 0.6;
  const ans = askA ? x0 : y0;
  return {
    text: `${A}先给${B}一些${th}，使${B}的${th}翻一倍；${B}再给${A}一些，使${A}的翻一倍。这时${A}有 ${p} ${u}，${B}有 ${q} ${u}。${askA ? A : B}原来有多少${u}？`,
    o: N(rng, ans, [askA ? y0 : x0, askA ? p / 2 : q / 2, (p + q) / 2, ans + 2], ` ${u}`),
    explain: `倒推：${B}给${A}之前，${A}有 ${p} ÷ 2 = ${p / 2} ${u}，${B}有 ${q} + ${p / 2} = ${y1} ${u}；${A}给${B}之前，${B}有 ${y1} ÷ 2 = ${y0} ${u}，${A}有 ${p / 2} + ${y0} = ${x0} ${u}。`,
    verify: { kind: 'g3b-dbl2', p: [p, q, askA ? 0 : 1], ans },
  };
};

/* ───────────── 数阵图与算式谜 ───────────── */

/** 洛书及其 8 种旋转/翻转 */
const LOSHU = [2, 7, 6, 9, 5, 1, 4, 3, 8];
const MAGIC8: number[][] = (() => {
  const out: number[][] = [];
  let g = LOSHU.slice();
  const rot = (s: number[]) => s.map((_, i) => s[(2 - (i % 3)) * 3 + Math.floor(i / 3)]);
  const flip = (s: number[]) => s.map((_, i) => s[Math.floor(i / 3) * 3 + (2 - (i % 3))]);
  for (let k = 0; k < 4; k++) {
    out.push(g, flip(g));
    g = rot(g);
  }
  return out;
})();
const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];
const CELL = ['左上角', '上中', '右上角', '左中', '中心', '右中', '左下角', '下中', '右下角'];

function setText(a: number, d: number, n: number): string {
  return d === 1 ? `${a}~${a + n - 1} 这${n === 9 ? '九' : n === 6 ? '六' : '五'}个数` : `${a}、${a + d}、${a + 2 * d}、…、${a + (n - 1) * d} 这${n === 9 ? '九' : n === 6 ? '六' : '五'}个数`;
}

function figMagic(vals: (number | null)[], ask: number): string {
  const cell = 42;
  const x0 = (260 - 3 * cell) / 2;
  const y0 = (170 - 3 * cell) / 2;
  const parts = [grid(x0, y0, 3, 3, cell, { width: 2 })];
  vals.forEach((v, i) => {
    const cx = x0 + (i % 3) * cell + cell / 2;
    const cy = y0 + Math.floor(i / 3) * cell + cell / 2;
    if (i === ask) parts.push(text(cx, cy, '?', { size: 20, color: FIG.accent, bold: true }));
    else if (v !== null) parts.push(text(cx, cy, v, { size: 18 }));
  });
  return svg(parts);
}

/** 由已知格推出 ask 格；返回推理步骤（不含中心数），推不出返回 null */
function deduce(givens: number[], ask: number): { idx: number; from: number[] }[] | null {
  // 按“轮”扩展：每轮同时推出所有能由一条线上另两格求出的格子，保证所用步数最少
  const known = new Set<number>([...givens, 4]);
  const how = new Map<number, number[]>();
  while (!known.has(ask)) {
    const fresh = new Map<number, number[]>();
    for (const ln of LINES) {
      const unk = ln.filter((i) => !known.has(i));
      if (unk.length === 1 && !fresh.has(unk[0])) fresh.set(unk[0], ln.filter((i) => i !== unk[0]));
    }
    if (fresh.size === 0) return null;
    for (const [k, v] of fresh) {
      known.add(k);
      how.set(k, v);
    }
  }
  // 只保留推出 ask 真正需要的步骤，按先后顺序排列
  const need: number[] = [];
  const visit = (i: number) => {
    const f = how.get(i);
    if (!f || need.includes(i)) return;
    f.forEach(visit);
    need.push(i);
  };
  visit(ask);
  return need.map((i) => ({ idx: i, from: how.get(i) as number[] }));
}

const szMagicSum: Tpl = (rng) => {
  const a = randInt(rng, 1, 15);
  const d = randInt(rng, 1, 3);
  const sq = pick(rng, MAGIC8).map((v) => a + (v - 1) * d);
  const tot = sumOf(sq);
  const ans = tot / 3;
  const shownIdx = shuffle(rng, [0, 1, 2, 3, 5, 6, 7, 8]).slice(0, 2);
  const vals = sq.map((v, i) => (shownIdx.includes(i) ? v : null));
  return {
    text: `把 ${setText(a, d, 9)}填入图中的 3×3 方格，使每行、每列、每条对角线上三个数的和都相等。这个和是多少？`,
    o: N(rng, ans, [tot / 9, tot, ans + 3 * d, ans - 3]),
    explain: `九个数的和是 ${tot}。三行正好把九个数都用上一次，所以每行的和 = ${tot} ÷ 3 = ${ans}。`,
    verify: { kind: 'g3b-magicSum', p: [a, d], ans },
    figure: figMagic(vals, -1),
  };
};

function magicCell(rng: Rng, nGiven: number, minSteps: number, maxSteps: number): Draft3 {
  return until(() => {
    const a = randInt(rng, 1, 15);
    const d = randInt(rng, 1, 3);
    const sq = pick(rng, MAGIC8).map((v) => a + (v - 1) * d);
    const ask = randInt(rng, 0, 8);
    const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => i !== ask && (nGiven === 2 ? i !== 4 : true));
    const givens = shuffle(rng, pool).slice(0, nGiven);
    const S = (sumOf(sq) / 3);
    const steps = deduce(givens, ask);
    if (!steps || steps.length < minSteps || steps.length > maxSteps) return null;
    if (ask === 4 && minSteps > 0) return null;
    return { a, d, sq, ask, givens, S, steps };
  });
}
interface Draft3 {
  a: number;
  d: number;
  sq: number[];
  ask: number;
  givens: number[];
  S: number;
  steps: { idx: number; from: number[] }[];
}

function magicDraft(rng: Rng, m: Draft3) {
  const { a, d, sq, ask, givens, S, steps } = m;
  const tot = sumOf(sq);
  const ans = sq[ask];
  const c = sq[4];
  const vals = sq.map((v, i) => (givens.includes(i) ? v : null));
  const name = (i: number) => (i === ask ? '“?”' : CELL[i]);
  const stepText = steps.map((s) => `${name(s.idx)} = ${S} − ${sq[s.from[0]]} − ${sq[s.from[1]]} = ${sq[s.idx]}`);
  const unused = sq.filter((_, i) => !givens.includes(i) && i !== ask);
  const firstStep = steps.length > 0 ? S - sq[steps[steps.length - 1].from[0]] : S - c;
  return {
    text: `把 ${setText(a, d, 9)}填入图中方格，使每行、每列、每条对角线上三个数的和都相等。“?”处应填几？`,
    o: N(rng, ans, [unused[0], unused[1], firstStep, ans + d, ans - d]),
    explain:
      `每行的和 = ${tot} ÷ 3 = ${S}，中心数 = ${S} ÷ 3 = ${c}。` +
      (ask === 4 ? `所以“?”处是 ${ans}。` : `${stepText.join('；')}。`),
    verify: { kind: 'g3b-magic', p: [a, d, ask, ...givens.flatMap((g) => [g, sq[g]])], ans },
    figure: figMagic(vals, ask),
  };
}

const szMagicCell: Tpl = (rng) => magicDraft(rng, magicCell(rng, 3, 0, 1));
const szMagic2: Tpl = (rng) => magicDraft(rng, magicCell(rng, 2, 2, 3));

/** 三角形数阵：顶点 0,1,2；中点 3(0-1),4(1-2),5(2-0) */
const TRI_SIDES = [
  [0, 3, 1],
  [1, 4, 2],
  [2, 5, 0],
];
function perms<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  arr.forEach((x, i) => {
    for (const p of perms([...arr.slice(0, i), ...arr.slice(i + 1)])) out.push([x, ...p]);
  });
  return out;
}

function figTriangle(): string {
  const P: [number, number][] = [
    [130, 24],
    [42, 146],
    [218, 146],
  ];
  const M: [number, number][] = [0, 1, 2].map((i) => {
    const j = (i + 1) % 3;
    return [(P[i][0] + P[j][0]) / 2, (P[i][1] + P[j][1]) / 2] as [number, number];
  });
  const parts = [polygon(P, { width: 2 })];
  for (const [x, y] of [...P, ...M]) parts.push(circle(x, y, 15, { stroke: FIG.accent2, width: 2.2, fill: PANEL }));
  return svg(parts);
}

function figCross(): string {
  const c = 40;
  const x = 110;
  const y = 65;
  const parts: string[] = [];
  for (const [dx, dy] of [
    [0, -1],
    [-1, 0],
    [0, 0],
    [1, 0],
    [0, 1],
  ])
    parts.push(rect(x + dx * c, y + dy * c, c, c, { stroke: FIG.accent2, width: 2.2 }));
  return svg(parts);
}

const szTriangle: Tpl = (rng) => {
  const { a, d, S, nums } = until(() => {
    const a = randInt(rng, 1, 10);
    const d = randInt(rng, 1, 2);
    const nums = Array.from({ length: 6 }, (_, i) => a + i * d);
    const sums = new Set<number>();
    for (const p of perms(nums)) {
      const s = TRI_SIDES.map((sd) => p[sd[0]] + p[sd[1]] + p[sd[2]]);
      if (s[0] === s[1] && s[1] === s[2]) sums.add(s[0]);
    }
    const list = [...sums];
    return list.length ? { a, d, S: pick(rng, list), nums } : null;
  });
  const tot = sumOf(nums);
  const V = 3 * S - tot;
  const askV = rng() < 0.6;
  const ans = askV ? V : tot - V;
  return {
    text: `把 ${setText(a, d, 6)}分别填入图中的圆圈，使三角形每条边上三个数的和都是 ${S}。${askV ? '三个顶点' : '三条边中间'}的数之和是多少？`,
    o: N(rng, ans, [3 * S, tot, askV ? tot - V : V, S, ans + d]),
    explain: askV
      ? `三条边的和相加是 ${S} × 3 = ${3 * S}，其中顶点上的数都被算了两次。所以顶点和 = ${3 * S} − ${tot} = ${V}（${tot} 是六个数的和）。`
      : `三条边的和相加是 ${S} × 3 = ${3 * S}，顶点数各多算一次，顶点和 = ${3 * S} − ${tot} = ${V}。中间三个数的和 = ${tot} − ${V} = ${ans}。`,
    verify: { kind: 'g3b-triArr', p: [a, d, S, askV ? 0 : 1], ans },
    figure: figTriangle(),
  };
};

const szCross: Tpl = (rng) => {
  const { a, d, S, nums } = until(() => {
    const a = randInt(rng, 1, 12);
    const d = randInt(rng, 1, 3);
    const nums = Array.from({ length: 5 }, (_, i) => a + i * d);
    const sums = new Set<number>();
    // 0 上 1 左 2 中 3 右 4 下
    for (const p of perms(nums)) if (p[1] + p[2] + p[3] === p[0] + p[2] + p[4]) sums.add(p[1] + p[2] + p[3]);
    const list = [...sums];
    return list.length ? { a, d, S: pick(rng, list), nums } : null;
  });
  const tot = sumOf(nums);
  const ans = 2 * S - tot;
  return {
    text: `把 ${setText(a, d, 5)}填入图中十字形的五个方格，使横行三个数的和与竖列三个数的和都是 ${S}。中间方格应填几？`,
    o: N(rng, ans, [S - tot / 5, tot / 5, 2 * S, ans + d, ans - d]),
    explain: `横行与竖列加起来是 ${S} × 2 = ${2 * S}，中间的数被算了两次，其余四个数各算一次。中间数 = ${2 * S} − ${tot} = ${ans}（${tot} 是五个数的和）。`,
    verify: { kind: 'g3b-cross', p: [a, d, S], ans },
    figure: figCross(),
  };
};

/* 竖式谜 */
type Row = (number | null)[];
const digitsOf = (n: number): number[] => String(n).split('').map(Number);
const maskStr = (r: Row): string => r.map((d) => (d === null ? '□' : String(d))).join('');
const PL = ['个位', '十位', '百位', '千位'];

/** 枚举所有 □ 的填法，返回使 check 成立的数字组（首位不为 0） */
function solveRows(rows: Row[], check: (nums: number[]) => boolean): number[][] {
  const slots: [number, number][] = [];
  rows.forEach((r, i) => r.forEach((d, j) => d === null && slots.push([i, j])));
  const out: number[][] = [];
  const cur = rows.map((r) => r.slice());
  const rec = (k: number) => {
    if (k === slots.length) {
      const nums = cur.map((r) => Number(r.join('')));
      if (check(nums)) out.push(nums);
      return;
    }
    const [i, j] = slots[k];
    for (let v = j === 0 ? 1 : 0; v <= 9; v++) {
      cur[i][j] = v;
      rec(k + 1);
    }
    cur[i][j] = null;
  };
  rec(0);
  return out;
}

function figVertical(rows: Row[], op: string): string {
  const colW = 26;
  const xr = 178;
  const maxLen = Math.max(...rows.map((r) => r.length));
  const ys = [34, 74, 128];
  const parts: string[] = [];
  rows.forEach((r, ri) => {
    r.forEach((d, i) => {
      const cx = xr - (r.length - 1 - i) * colW - colW / 2;
      const cy = ys[ri];
      if (d === null) parts.push(rect(cx - 10, cy - 13, 20, 26, { stroke: FIG.accent, width: 2 }));
      else parts.push(text(cx, cy, d, { size: 24 }));
    });
  });
  const left = xr - maxLen * colW;
  parts.push(text(left - 14, ys[1], op, { size: 24, color: FIG.accent2 }));
  parts.push(line(left - 28, 101, xr + 6, 101, { width: 2.2 }));
  return svg(parts);
}

/** 加法竖式 X + Y = Z 的逐位说明（只说含 □ 的列） */
function addSteps(full: number[], masked: Row[]): string[] {
  const ds = full.map((n) => digitsOf(n).reverse());
  const ms = masked.map((r) => r.slice().reverse());
  const out: string[] = [];
  let carry = 0;
  for (let col = 0; col < ds[2].length; col++) {
    const x = ds[0][col] ?? 0;
    const y = ds[1][col] ?? 0;
    const z = ds[2][col];
    const s = x + y + carry;
    const c = carry ? ' + 1（进位）' : '';
    const xs = ms[0][col] === null ? '□' : String(x);
    const ys = ms[1][col] === null ? '□' : String(y);
    if (ms[2][col] === null) out.push(`${PL[col]}：${xs} + ${ys}${c} = ${s}，□ 填 ${z}`);
    else if (ms[0][col] === null || ms[1][col] === null) out.push(`${PL[col]}：${xs} + ${ys}${c} 的个位是 ${z}，□ 填 ${ms[0][col] === null ? x : y}`);
    carry = s >= 10 ? 1 : 0;
  }
  return out;
}

function maskCols(rng: Rng, full: number[], nBox: number, rowsAllowed: number[]): Row[] {
  const rows: Row[] = full.map((n) => digitsOf(n));
  const minLen = Math.min(...rows.map((r) => r.length));
  const cols = shuffle(
    rng,
    Array.from({ length: minLen }, (_, i) => i),
  ).slice(0, nBox);
  for (const col of cols) {
    const ri = pick(rng, rowsAllowed);
    rows[ri][rows[ri].length - 1 - col] = null;
  }
  return rows;
}

const szAdd: Tpl = (rng) => {
  const v = until(() => {
    const A = randInt(rng, 102, 879);
    const B = randInt(rng, 102, 989 - A);
    const C = A + B;
    const rows = maskCols(rng, [A, B, C], 2, [0, 1, 2]);
    if (!rows[0].includes(null) && !rows[1].includes(null)) return null;
    const sols = solveRows(rows, ([x, y, z]) => x + y === z);
    if (sols.length !== 1) return null;
    const askable = [0, 1, 2].filter((r) => rows[r].includes(null));
    return { A, B, C, rows, ask: pick(rng, askable) };
  });
  const { A, B, C, rows, ask } = v;
  const full = [A, B, C];
  const ans = full[ask];
  const askName = ['第一个加数', '第二个加数', '和'][ask];
  const eq = `${maskStr(rows[0])} + ${maskStr(rows[1])} = ${maskStr(rows[2])}`;
  return {
    text: `竖式谜（如图）：${eq}，每个 □ 里填一个数字。${askName}是多少？`,
    o: N(rng, ans, [ans + 10, ans - 10, ans + 100, ans - 1, ans + 1]),
    explain: `从个位起逐位推：${addSteps(full, rows).join('；')}。所以${askName}是 ${ans}。`,
    verify: { kind: 'g3b-vpuzzle', p: [ask], ans },
    figure: figVertical(rows, '+'),
  };
};

const szSub: Tpl = (rng) => {
  const v = until(() => {
    const A = randInt(rng, 300, 999);
    const B = randInt(rng, 102, A - 100);
    const C = A - B;
    const rows = maskCols(rng, [A, B, C], 3, [0, 1, 2]);
    if (rows.filter((r) => r.includes(null)).length < 2) return null;
    const sols = solveRows(rows, ([x, y, z]) => x - y === z);
    if (sols.length !== 1) return null;
    // 至少有一次退位，避免太简单
    const da = digitsOf(A).reverse();
    const db = digitsOf(B).reverse();
    if (!da.some((d, i) => d < (db[i] ?? 0))) return null;
    const askable = [0, 1, 2].filter((r) => rows[r].includes(null));
    return { A, B, C, rows, ask: pick(rng, askable) };
  });
  const { A, B, C, rows, ask } = v;
  const full = [A, B, C];
  const ans = full[ask];
  const askName = ['被减数', '减数', '差'][ask];
  const eq = `${maskStr(rows[0])} − ${maskStr(rows[1])} = ${maskStr(rows[2])}`;
  // 看成加法：差 + 减数 = 被减数
  const steps = addSteps([C, B, A], [rows[2], rows[1], rows[0]]);
  return {
    text: `竖式谜（如图）：${eq}，每个 □ 里填一个数字。${askName}是多少？`,
    o: N(rng, ans, [ans + 10, ans - 10, ans + 100, ans - 100, ans + 1]),
    explain: `把减法看成加法：差 + 减数 = 被减数，从个位起逐位推：${steps.join('；')}。所以${askName}是 ${ans}。`,
    verify: { kind: 'g3b-vpuzzle', p: [ask], ans },
    figure: figVertical(rows, '−'),
  };
};

const szMul: Tpl = (rng) => {
  const v = until(() => {
    const A = rng() < 0.6 ? randInt(rng, 12, 99) : randInt(rng, 102, 329);
    const m = randInt(rng, 2, 9);
    const P = A * m;
    if (P > 999) return null;
    const ra: Row = digitsOf(A);
    const rp: Row = digitsOf(P);
    const ia = randInt(rng, 0, ra.length - 2);
    ra[ia] = null;
    const ip = randInt(rng, 0, rp.length - 2);
    rp[ip] = null;
    const rows: Row[] = [ra, [null], rp];
    const sols = solveRows(rows, ([x, y, z]) => x * y === z);
    if (sols.length !== 1) return null;
    return { A, m, P, rows, ask: rng() < 0.6 ? 2 : 0 };
  });
  const { A, m, P, rows, ask } = v;
  const ua = A % 10;
  const up = P % 10;
  const cands = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((k) => (ua * k) % 10 === up);
  const ans = ask === 2 ? P : A;
  const askName = ask === 2 ? '积' : '第一个因数';
  const eq = `${maskStr(rows[0])} × □ = ${maskStr(rows[2])}`;
  const tryText =
    cands.length === 1
      ? `乘数只能是 ${m}`
      : `乘数可能是 ${cands.join('、')}，逐个试，只有 ${m} 能让其余数位对上`;
  return {
    text: `竖式谜（如图）：${eq}，每个 □ 里填一个数字。${askName}是多少？`,
    o: N(rng, ans, ask === 2 ? [P + 10, P - 10, (A + 10) * m, A * (m + 1), P + 100] : [A + 10, A - 10, A + 1, P / m + 20]),
    explain: `看个位：${ua} × 乘数的个位是 ${up}，${tryText}。${A} × ${m} = ${P}，所以${askName}是 ${ans}。`,
    verify: { kind: 'g3b-vpuzzle', p: [ask], ans },
    figure: figVertical(rows, '×'),
  };
};

/* 填运算符 */
/** 按先乘除后加减计算，返回值和用于解析的中间式 */
function evalOps(nums: number[], ops: number[]): { v: number; mid: string | null; ok: boolean } {
  const terms: { v: number; sign: number; chain: boolean }[] = [];
  let cur = nums[0];
  let chain = false;
  let ok = true;
  let sign = 1;
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    const n = nums[i + 1];
    if (o === 2 || o === 3) {
      cur = o === 2 ? cur * n : cur / n;
      if (!Number.isInteger(cur)) ok = false;
      chain = true;
    } else {
      terms.push({ v: cur, sign, chain });
      cur = n;
      chain = false;
      sign = o === 0 ? 1 : -1;
    }
  }
  terms.push({ v: cur, sign, chain });
  let v = 0;
  for (const t of terms) {
    v += t.sign * t.v;
    if (v < 0) ok = false;
  }
  const anyChain = terms.some((t) => t.chain);
  const mid = anyChain && terms.length > 1 ? terms.map((t, i) => (i === 0 ? '' : t.sign > 0 ? ' + ' : ' − ') + String(t.v)).join('') : null;
  return { v, mid, ok };
}

function evalLeft(nums: number[], ops: number[]): number {
  let v = nums[0];
  ops.forEach((o, i) => (v = applyOp(v, o, nums[i + 1])));
  return v;
}

const opsText = (ops: number[]): string => ops.map((o) => OPS[o]).join('、');
const ALL_OPS: number[][] = (() => {
  const out: number[][] = [];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) out.push([a, b, c]);
  return out;
})();

const szOps: Tpl = (rng) => {
  const v = until(() => {
    const nums = Array.from({ length: 4 }, () => randInt(rng, 1, 9));
    const ops = [randInt(rng, 0, 3), randInt(rng, 0, 3), randInt(rng, 0, 3)];
    if (!ops.some((o) => o >= 2) || !ops.some((o) => o <= 1)) return null;
    const e = evalOps(nums, ops);
    if (!e.ok || e.v < 1 || e.v > 99) return null;
    const hits = ALL_OPS.filter((c) => Math.abs(evalOps(nums, c).v - e.v) < 1e-9);
    if (hits.length !== 1) return null;
    return { nums, ops, R: e.v, mid: e.mid };
  });
  const { nums, ops, R, mid } = v;
  const correct = opsText(ops);
  const trap = ALL_OPS.filter((c) => opsText(c) !== correct && Math.abs(evalLeft(nums, c) - R) < 1e-9).map(opsText);
  const near = ALL_OPS.filter((c) => opsText(c) !== correct)
    .map((c) => ({ c, d: Math.abs(evalOps(nums, c).v - R) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, 6)
    .map((x) => opsText(x.c));
  const expr = nums.map((n, i) => (i === 0 ? String(n) : ` ${OPS[ops[i - 1]]} ${n}`)).join('');
  const o: Opts = buildOptions(rng, correct, [...trap, ...shuffle(rng, near)], (k) => opsText(ALL_OPS[(k * 7 + 3) % 64]));
  return {
    text: `在 ${nums.map((n) => String(n)).join(' □ ')} = ${R} 的 □ 里填上 +、−、×、÷（可重复），使等式成立。依次应填什么？`,
    o,
    explain: `按“先乘除、后加减”计算：${expr}${mid ? ` = ${mid}` : ''} = ${R}。所以依次填 ${correct}。`,
    verify: { kind: 'g3b-opfill', p: [...nums, R], ans: ops[0] * 16 + ops[1] * 4 + ops[2] },
  };
};

/* ───────────── 周长巧算 ───────────── */

function scaler(W: number, H: number, maxW = 168, left = 50) {
  const s = Math.min(maxW / W, 104 / H);
  const ox = left + (maxW - W * s) / 2;
  const oy = 22 + (104 - H * s) / 2;
  return { X: (u: number) => ox + u * s, Y: (v: number) => oy + v * s, s };
}

const lab = (x: number, y: number, s: string | number) => text(x, y, s, { size: 13, color: FIG.accent });
const SHAPE = { fill: FIG.fill, width: 2.2 };

function figPoly(W: number, H: number, pts: [number, number][], labels: [number, number, string | number][], extra: (X: (u: number) => number, Y: (v: number) => number) => string[] = () => []): string {
  const { X, Y } = scaler(W, H);
  const parts = [polygon(pts.map(([u, v]) => [X(u), Y(v)] as [number, number]), SHAPE)];
  parts.push(...extra(X, Y));
  for (const [u, v, s] of labels) parts.push(lab(u, v, s));
  return svg(parts);
}

const zcRect: Tpl = (rng) => {
  if (rng() < 0.3) {
    const a = randInt(rng, 3, 30);
    const ans = 4 * a;
    const { X, Y } = scaler(1, 1);
    return {
      text: `如图，正方形的边长是 ${a} 厘米。它的周长是多少厘米？`,
      o: N(rng, ans, [a * a, 2 * a, 3 * a, ans + 4], ' 厘米'),
      explain: `正方形的周长 = 边长 × 4 = ${a} × 4 = ${ans} 厘米。`,
      verify: { kind: 'g3b-cells', p: [1, 0, 0, a, a], ans },
      figure: svg([polygon([[X(0), Y(0)], [X(1), Y(0)], [X(1), Y(1)], [X(0), Y(1)]], SHAPE), lab((X(0) + X(1)) / 2, Y(1) + 14, `${a} 厘米`)]),
    };
  }
  const a = randInt(rng, 4, 30);
  const b = randInt(rng, 2, a - 1);
  const ans = 2 * (a + b);
  const { X, Y } = scaler(a, b, 140, 36);
  return {
    text: `如图，长方形的长是 ${a} 厘米，宽是 ${b} 厘米。它的周长是多少厘米？`,
    o: N(rng, ans, [a + b, a * b, 2 * a + b, ans + 2], ' 厘米'),
    explain: `长方形的周长 = (长 + 宽) × 2 = (${a} + ${b}) × 2 = ${ans} 厘米。`,
    verify: { kind: 'g3b-cells', p: [1, 0, 0, a, b], ans },
    figure: svg([
      polygon([[X(0), Y(0)], [X(a), Y(0)], [X(a), Y(b)], [X(0), Y(b)]], SHAPE),
      lab((X(0) + X(a)) / 2, Y(b) + 14, `${a} 厘米`),
      text(X(a) + 8, (Y(0) + Y(b)) / 2, `${b} 厘米`, { size: 13, color: FIG.accent, anchor: 'start' }),
    ]),
  };
};

const zcRectRev: Tpl = (rng) => {
  if (rng() < 0.35) {
    const s = randInt(rng, 3, 25);
    const P = 4 * s;
    const { X, Y } = scaler(1, 1);
    return {
      text: `用一根长 ${P} 厘米的铁丝正好围成一个正方形（如图），这个正方形的边长是多少厘米？`,
      o: N(rng, s, [P / 2, P - 4, s + 1, s * 2], ' 厘米'),
      explain: `正方形 4 条边一样长，边长 = 周长 ÷ 4 = ${P} ÷ 4 = ${s} 厘米。`,
      verify: { kind: 'g3b-rectW', p: [P, 0], ans: s },
      figure: svg([polygon([[X(0), Y(0)], [X(1), Y(0)], [X(1), Y(1)], [X(0), Y(1)]], SHAPE), lab((X(0) + X(1)) / 2, Y(1) + 14, '?')]),
    };
  }
  const a = randInt(rng, 5, 30);
  const b = randInt(rng, 2, a - 1);
  const P = 2 * (a + b);
  const { X, Y } = scaler(a, b, 150, 40);
  return {
    text: `一个长方形的周长是 ${P} 厘米，长是 ${a} 厘米（如图）。它的宽是多少厘米？`,
    o: N(rng, b, [P - a, P / 2, (P - a) / 2, P - 2 * a], ' 厘米'),
    explain: `长 + 宽 = 周长 ÷ 2 = ${P} ÷ 2 = ${P / 2} 厘米，宽 = ${P / 2} − ${a} = ${b} 厘米。`,
    verify: { kind: 'g3b-rectW', p: [P, a], ans: b },
    figure: svg([
      polygon([[X(0), Y(0)], [X(a), Y(0)], [X(a), Y(b)], [X(0), Y(b)]], SHAPE),
      lab((X(0) + X(a)) / 2, Y(b) + 14, `${a} 厘米`),
      lab(X(a) + 14, (Y(0) + Y(b)) / 2, '?'),
    ]),
  };
};

const zcL: Tpl = (rng) => {
  const W = randInt(rng, 9, 20);
  const H = randInt(rng, 6, W - 1);
  const w = randInt(rng, 3, W - 3);
  const h = randInt(rng, 3, H - 2);
  const ans = 2 * (W + H);
  const { X, Y } = scaler(W, H);
  const pts: [number, number][] = [
    [0, 0],
    [W - w, 0],
    [W - w, h],
    [W, h],
    [W, H],
    [0, H],
  ];
  return {
    text: `如图（单位：厘米），从一个长 ${W}、宽 ${H} 的长方形的一角剪去一个小长方形。剩下图形的周长是多少厘米？`,
    o: N(rng, ans, [ans - w - h, ans - 2 * w - 2 * h, W + H + w + h, ans + w + h], ' 厘米'),
    explain: `用平移法：把缺口处的横边向上平移、竖边向右平移，正好补成原长方形的边，周长不变。(${W} + ${H}) × 2 = ${ans} 厘米。`,
    verify: { kind: 'g3b-cells', p: [1, 0, 0, W, H, 0, W - w, 0, w, h], ans },
    figure: figPoly(W, H, pts, [
      [(X(0) + X(W)) / 2, Y(H) + 14, W],
      [X(0) - 14, (Y(0) + Y(H)) / 2, H],
      [(X(W - w) + X(W)) / 2, Y(h) - 11, w],
      [X(W - w) + 12, (Y(0) + Y(h)) / 2, h],
    ]),
  };
};

const zcStair: Tpl = (rng) => {
  const k = randInt(rng, 3, 4);
  const W = randInt(rng, 3 * k, 20);
  const H = randInt(rng, 2 * k + 1, 15);
  const ws = partition(rng, W, k, 2);
  const hs = partition(rng, H, k, 2);
  const ans = 2 * (W + H);
  const pts: [number, number][] = [[0, 0]];
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < k; i++) {
    cx += ws[i];
    pts.push([cx, cy]);
    cy += hs[i];
    pts.push([cx, cy]);
  }
  pts.push([0, H]);
  const { X, Y } = scaler(W, H);
  const ops: number[] = [];
  let acc = 0;
  let accH = 0;
  for (let i = 0; i < k; i++) {
    acc += ws[i];
    ops.push(1, 0, accH, acc, H - accH);
    accH += hs[i];
  }
  return {
    text: `如图（单位：厘米），一个台阶形图形的底边长 ${W}，左边高 ${H}。它的周长是多少厘米？`,
    o: N(rng, ans, [W + H, 2 * W + H, ans + 2 * k, ans - 2], ' 厘米'),
    explain: `把各级台阶的横边都向上平移、竖边都向右平移，正好补成长 ${W}、宽 ${H} 的长方形。周长 = (${W} + ${H}) × 2 = ${ans} 厘米。`,
    verify: { kind: 'g3b-cells', p: ops, ans },
    figure: figPoly(W, H, pts, [
      [(X(0) + X(W)) / 2, Y(H) + 14, W],
      [X(0) - 14, (Y(0) + Y(H)) / 2, H],
    ]),
  };
};

const zcSquaresRow: Tpl = (rng) => {
  const n = randInt(rng, 2, 6);
  const s = randInt(rng, 2, 12);
  const L = n * s;
  const ans = 2 * (L + s);
  const { X, Y } = scaler(n, 1);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(rect(X(i), Y(0), X(1) - X(0), Y(1) - Y(0), SHAPE));
  parts.push(lab((X(0) + X(1)) / 2, Y(1) + 14, s));
  return {
    text: `把 ${n} 个边长 ${s} 厘米的正方形拼成一个长方形（如图）。拼成的长方形周长是多少厘米？`,
    o: N(rng, ans, [4 * s * n, L + s, 4 * s * n - s * (n - 1), 2 * L], ' 厘米'),
    explain: `拼成的长方形长 ${n} × ${s} = ${L} 厘米，宽 ${s} 厘米。周长 = (${L} + ${s}) × 2 = ${ans} 厘米。`,
    verify: { kind: 'g3b-cells', p: Array.from({ length: n }, (_, i) => [1, i * s, 0, s, s]).flat(), ans },
    figure: svg(parts),
  };
};

const zcNotch: Tpl = (rng) => {
  const W = randInt(rng, 10, 20);
  const H = randInt(rng, 7, 14);
  const w = randInt(rng, 3, W - 5);
  const d = randInt(rng, 3, H - 3);
  const x0 = randInt(rng, 2, W - w - 2);
  const base = 2 * (W + H);
  const ans = base + 2 * d;
  const pts: [number, number][] = [
    [0, 0],
    [x0, 0],
    [x0, d],
    [x0 + w, d],
    [x0 + w, 0],
    [W, 0],
    [W, H],
    [0, H],
  ];
  const { X, Y } = scaler(W, H);
  return {
    text: `如图（单位：厘米），从长 ${W}、宽 ${H} 的长方形上边挖去一个宽 ${w}、深 ${d} 的缺口。剩下图形的周长是多少厘米？`,
    o: N(rng, ans, [base, base + d, base + 2 * w, base - 2 * w + 2 * d], ' 厘米'),
    explain: `缺口的底边平移上去，正好补上被挖掉的那段上边；但缺口两侧多出 2 条长 ${d} 的边。周长 = (${W} + ${H}) × 2 + ${d} × 2 = ${ans} 厘米。`,
    verify: { kind: 'g3b-cells', p: [1, 0, 0, W, H, 0, x0, 0, w, d], ans },
    figure: figPoly(W, H, pts, [
      [(X(0) + X(W)) / 2, Y(H) + 14, W],
      [X(0) - 14, (Y(0) + Y(H)) / 2, H],
      [(X(x0) + X(x0 + w)) / 2, Y(d) + 13, w],
      [X(x0) + 11, (Y(0) + Y(d)) / 2, d],
    ]),
  };
};

const zcCut: Tpl = (rng) => {
  const W = randInt(rng, 8, 24);
  const H = randInt(rng, 4, Math.min(15, W - 1));
  const k = randInt(rng, 1, 3);
  const vert = rng() < 0.6;
  const along = vert ? W : H;
  if (along < 2 * (k + 1)) return zcCut(rng);
  const parts = partition(rng, along, k + 1, 2);
  const L = vert ? H : W;
  const inc = 2 * k * L;
  const askInc = rng() < 0.5;
  const base = 2 * (W + H);
  const ans = askInc ? inc : base + inc;
  const other = vert ? W : H;
  const { X, Y } = scaler(W, H);
  const pieces: number[] = [];
  const dash: string[] = [];
  let acc = 0;
  parts.forEach((p, i) => {
    pieces.push(...(vert ? [acc, 0, p, H] : [0, acc, W, p]));
    acc += p;
    if (i < parts.length - 1) dash.push(vert ? line(X(acc), Y(0), X(acc), Y(H), { stroke: FIG.accent, dash: true, width: 2 }) : line(X(0), Y(acc), X(W), Y(acc), { stroke: FIG.accent, dash: true, width: 2 }));
  });
  return {
    text: `把一个长 ${W} 厘米、宽 ${H} 厘米的长方形剪成 ${k + 1} 个小长方形（如图）。这些小长方形的周长之和${askInc ? '比原来多多少厘米' : '是多少厘米'}？`,
    o: askInc
      ? N(rng, ans, [k * L, 2 * k * other, 2 * (k + 1) * L, inc + L], ' 厘米')
      : N(rng, ans, [base, base + k * L, base + 2 * k * other, ans + L], ' 厘米'),
    explain: `每剪一刀，多出两条长 ${L} 厘米的边。剪了 ${k} 刀，多出 ${L} × ${2 * k} = ${inc} 厘米${askInc ? '' : `；周长之和 = (${W} + ${H}) × 2 + ${inc} = ${ans} 厘米`}。`,
    verify: { kind: 'g3b-cut', p: [askInc ? 1 : 0, W, H, ...pieces], ans },
    figure: svg([
      polygon([[X(0), Y(0)], [X(W), Y(0)], [X(W), Y(H)], [X(0), Y(H)]], SHAPE),
      ...dash,
      lab((X(0) + X(W)) / 2, Y(H) + 14, W),
      lab(X(0) - 14, (Y(0) + Y(H)) / 2, H),
    ]),
  };
};

const zcCorners: Tpl = (rng) => {
  const W = randInt(rng, 10, 22);
  const H = randInt(rng, 8, Math.min(16, W));
  const c = randInt(rng, 2, Math.floor((Math.min(W, H) - 2) / 2));
  const k = randInt(rng, 2, 4);
  const corners = shuffle(rng, [0, 1, 2, 3]).slice(0, k); // 0 左上 1 右上 2 右下 3 左下
  const has = (i: number) => corners.includes(i);
  const ans = 2 * (W + H);
  const pts: [number, number][] = [];
  if (has(0)) pts.push([0, c], [c, c], [c, 0]);
  else pts.push([0, 0]);
  if (has(1)) pts.push([W - c, 0], [W - c, c], [W, c]);
  else pts.push([W, 0]);
  if (has(2)) pts.push([W, H - c], [W - c, H - c], [W - c, H]);
  else pts.push([W, H]);
  if (has(3)) pts.push([c, H], [c, H - c], [0, H - c]);
  else pts.push([0, H]);
  const ops = [1, 0, 0, W, H];
  const cornerXY = [
    [0, 0],
    [W - c, 0],
    [W - c, H - c],
    [0, H - c],
  ];
  for (const i of corners) ops.push(0, cornerXY[i][0], cornerXY[i][1], c, c);
  const { X, Y } = scaler(W, H);
  const dimSt = { stroke: FIG.dim, width: 1.2 };
  const ci = corners[0];
  const [cxu, cyu] = cornerXY[ci];
  return {
    text: `从长 ${W} 厘米、宽 ${H} 厘米的长方形的 ${k} 个角上各剪去一个边长 ${c} 厘米的小正方形（如图）。剩下图形的周长是多少厘米？`,
    o: N(rng, ans, [ans - 2 * k * c, ans + 2 * k * c, ans - k * c, ans - 4 * c], ' 厘米'),
    explain: `每个缺角处，新露出的两条边平移后正好补上剪掉的两段边，所以周长不变：(${W} + ${H}) × 2 = ${ans} 厘米。`,
    verify: { kind: 'g3b-cells', p: ops, ans },
    figure: figPoly(W, H, pts, [
      [(X(0) + X(W)) / 2, Y(H) + 22, W],
      [X(0) - 22, (Y(0) + Y(H)) / 2, H],
      [(X(cxu) + X(cxu + c)) / 2, (Y(cyu) + Y(cyu + c)) / 2, c],
    ], (Xf, Yf) => [
      line(Xf(0), Yf(H) + 10, Xf(W), Yf(H) + 10, dimSt),
      line(Xf(0), Yf(H) + 5, Xf(0), Yf(H) + 15, dimSt),
      line(Xf(W), Yf(H) + 5, Xf(W), Yf(H) + 15, dimSt),
      line(Xf(0) - 10, Yf(0), Xf(0) - 10, Yf(H), dimSt),
      line(Xf(0) - 15, Yf(0), Xf(0) - 5, Yf(0), dimSt),
      line(Xf(0) - 15, Yf(H), Xf(0) - 5, Yf(H), dimSt),
      rect(Xf(cxu), Yf(cyu), Xf(c) - Xf(0), Yf(c) - Yf(0), { stroke: FIG.dim, width: 1.2, dash: true }),
    ]),
  };
};

/* ───────────── 导出 ───────────── */

export const topics: Topic[] = [
  topic('g3-guilv', 3, '找规律', '先看相邻两数的差或倍数，再看隔位、分组；图形规律看“每多一个多几个”', [
    [glArith, glGeo],
    [glDiff2, glFib, glSquare, glMatch],
    [glAlt, glRing, glGroup],
  ]),
  topic('g3-shutu', 3, '数图形', 'n 个点的线段数 = 1+2+…+(n−1)；长方形数 = 横向线段数 × 竖向线段数', [
    [stSeg, stAngle, stStrip],
    [stFan, stGridRect, stGridSquare],
    [stStack, stShaded, stSegSum],
  ]),
  topic('g3-yingkui', 3, '盈亏问题', '人数 = 两次总数差 ÷ 每人分配差；一盈一亏相加，两盈或两亏相减', [
    [ykBasic, ykExact],
    [ykTwoSur, ykTwoDef],
    [ykBoats, ykPartial, ykPrice],
  ]),
  topic('g3-guiyi', 3, '归一与归总', '归一：先求一份是多少；归总：先求总量，总量不变', [
    [gyForward, gyBackward],
    [gyDouble, gyTotal],
    [gyDoubleRev, gyFood, gyPlan],
  ]),
  topic('g3-huanyuan', 3, '还原问题', '从结果出发倒着推，加变减、减变加、乘变除、除变乘', [
    [hyOps, hyStory],
    [hyHalf, hyWrong],
    [hyGive3, hyDouble, hyHalf3],
  ]),
  topic('g3-shuzhen', 3, '数阵图与算式谜', '幻方每行和 = 总和 ÷ 3，中心 = 每行和 ÷ 3；重叠的数被多算了几次就减去几次', [
    [szMagicSum, szAdd],
    [szMagicCell, szTriangle, szCross, szSub],
    [szMagic2, szMul, szOps],
  ]),
  topic('g3-zhouchang', 3, '周长巧算', '长方形周长 =(长+宽)×2；平移法：把凹进去的边平移补齐，注意多出来的边', [
    [zcRect, zcRectRev],
    [zcL, zcStair, zcSquaresRow],
    [zcNotch, zcCut, zcCorners],
  ]),
];
