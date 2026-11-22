/** 四年级（续）：平均数、方阵、定义新运算、容斥、逻辑推理、角度与多边形、最值与数字 */
import type { Topic } from './types.ts';
import { randInt, pick, shuffle, buildOptions } from './types.ts';
import type { Tpl, Rng, Opts } from './helpers.ts';
import { topic, N, two, until, NAMES } from './helpers.ts';
import { svg, line, polygon, rect, circle, arc, text, dot, rightAngle, FIG } from './figure.ts';

const sum = (a: readonly number[]): number => a.reduce((s, x) => s + x, 0);

/** 标签型选项（人名、名次等）：正确项 + 干扰项，不足时用 extra 补齐 */
function labelOpts(rng: Rng, correct: string, wrongs: string[], extra: string[]): Opts {
  const pool = [...wrongs, ...extra];
  return buildOptions(rng, correct, pool, (k) => `${correct}${'？'.repeat(k + 1)}`);
}

/* ═════════════ 平均数问题 ═════════════ */

interface AvgCtx {
  lo: number;
  hi: number;
  spread: number;
  max: number;
  u: string;
  text: (who: string, vals: string, n: number) => string;
}

const AVG_CTX: AvgCtx[] = [
  { lo: 80, hi: 92, spread: 7, max: 100, u: '分', text: (w, v, n) => `${w}前 ${n} 次数学测验的成绩分别是 ${v} 分，平均成绩是多少分？` },
  { lo: 110, hi: 160, spread: 15, max: 999, u: '下', text: (w, v, n) => `${w}练跳绳，${n} 次的成绩分别是 ${v} 下，平均每次跳多少下？` },
  { lo: 30, hi: 80, spread: 12, max: 999, u: '千克', text: (_w, v, n) => `水果店 ${n} 天分别卖出苹果 ${v} 千克，平均每天卖出多少千克？` },
  { lo: 40, hi: 90, spread: 15, max: 999, u: '本', text: (_w, v, n) => `图书角 ${n} 个书架分别放了 ${v} 本书，平均每个书架放多少本？` },
];

const pjBasic: Tpl = (rng) => {
  const c = pick(rng, AVG_CTX);
  const [P] = two(rng, NAMES);
  const n = randInt(rng, 3, 5);
  const A = randInt(rng, c.lo, c.hi);
  const vals = until(() => {
    const v: number[] = [];
    for (let i = 0; i < n - 1; i++) v.push(A + randInt(rng, -c.spread, c.spread));
    const last = n * A - sum(v);
    v.push(last);
    if (Math.abs(last - A) > c.spread + 2 || Math.max(...v) > c.max || new Set(v).size < n - 1) return null;
    return v;
  });
  const S = sum(vals);
  return {
    text: c.text(P, vals.join('、'), n),
    o: N(rng, A, [S / (n - 1), S / (n + 1), A + 1, A - 1, A + 2], ` ${c.u}`),
    explain: `平均数 = 总数 ÷ 个数。总数：${vals.join(' + ')} = ${S}，平均：${S} ÷ ${n} = ${A} ${c.u}。`,
    verify: { kind: 'pjAvg', p: vals, ans: A },
  };
};

const MOVE_CTX: { u: string; t: (a: number, b: number) => string }[] = [
  { u: '个', t: (a, b) => `甲筐有苹果 ${a} 个，乙筐有 ${b} 个。从甲筐拿多少个放进乙筐，两筐就一样多？` },
  { u: '本', t: (a, b) => `上层书架有 ${a} 本书，下层有 ${b} 本。从上层拿多少本到下层，两层就一样多？` },
  { u: '升', t: (a, b) => `甲桶有水 ${a} 升，乙桶有水 ${b} 升。从甲桶倒多少升到乙桶，两桶水就一样多？` },
  { u: '张', t: (a, b) => `哥哥有邮票 ${a} 张，弟弟有 ${b} 张。哥哥给弟弟多少张，两人的邮票就一样多？` },
];

const pjMove: Tpl = (rng) => {
  const c = pick(rng, MOVE_CTX);
  const x = randInt(rng, 3, 25);
  const b = randInt(rng, 8, 60);
  const a = b + 2 * x;
  return {
    text: c.t(a, b),
    o: N(rng, x, [2 * x, (a + b) / 2, x + 1, x + 2], ` ${c.u}`),
    explain: `两者相差 ${a} − ${b} = ${2 * x} ${c.u}。移多补少，只需移走相差数的一半：${2 * x} ÷ 2 = ${x} ${c.u}，这时两边都是 ${(a + b) / 2} ${c.u}。`,
    verify: { kind: 'pjMove', p: [a, b], ans: x },
  };
};

const pjMissing: Tpl = (rng) => {
  if (rng() < 0.5) {
    const [P] = two(rng, NAMES);
    const v = until(() => {
      const A = randInt(rng, 82, 94);
      const k = [0, 0, 0].map(() => A + randInt(rng, -8, 6));
      const w = 4 * A - sum(k);
      if (Math.max(...k) > 100 || w > 100 || w < A - 12 || new Set([...k, w]).size < 3) return null;
      return { A, k, w };
    });
    const { A, k, w } = v;
    return {
      text: `${P}语文、数学、英语、科学四门平均 ${A} 分，语文 ${k[0]} 分，数学 ${k[1]} 分，英语 ${k[2]} 分。科学多少分？`,
      o: N(rng, w, [A, w + 10, w - 10, w + 4], ' 分'),
      explain: `四门总分：${A} × 4 = ${4 * A} 分；已知三门共 ${k.join(' + ')} = ${sum(k)} 分。科学：${4 * A} − ${sum(k)} = ${w} 分。`,
      verify: { kind: 'pjMissing', p: [4, A, ...k], ans: w },
    };
  }
  const v = until(() => {
    const n = randInt(rng, 3, 5);
    const A = randInt(rng, 20, 60);
    const k: number[] = [];
    for (let i = 0; i < n - 1; i++) k.push(A + randInt(rng, -15, 15));
    const w = n * A - sum(k);
    if (w < 1 || new Set([...k, w]).size < n - 1) return null;
    return { n, A, k, w };
  });
  const { n, A, k, w } = v;
  return {
    text: `${n} 个数的平均数是 ${A}，其中 ${n - 1} 个数是 ${k.join('、')}，另一个数是多少？`,
    o: N(rng, w, [A, w + 10, w - 10, w + n]),
    explain: `${n} 个数的总和：${A} × ${n} = ${n * A}；已知 ${n - 1} 个数的和：${k.join(' + ')} = ${sum(k)}。另一个数：${n * A} − ${sum(k)} = ${w}。`,
    verify: { kind: 'pjMissing', p: [n, A, ...k], ans: w },
  };
};

const pjAdd: Tpl = (rng) => {
  const mode = randInt(rng, 0, 2);
  if (mode === 0) {
    const v = until(() => {
      const n = randInt(rng, 5, 10);
      const A = randInt(rng, 9, 12);
      const d = randInt(rng, 2, 4);
      const B = A + d;
      const x = B + n * d;
      return x >= 24 && x <= 50 ? { n, A, d, B, x } : null;
    });
    const { n, A, d, B, x } = v;
    return {
      text: `${n} 名同学的平均年龄是 ${A} 岁，加上一位老师后，平均年龄变成 ${B} 岁。老师多少岁？`,
      o: N(rng, x, [B + d, n * d, A + n * d, x + d], ' 岁'),
      explain: `原来 ${n} 人共 ${n} × ${A} = ${n * A} 岁，加入老师后 ${n + 1} 人共 ${n + 1} × ${B} = ${(n + 1) * B} 岁。老师：${(n + 1) * B} − ${n * A} = ${x} 岁。`,
      verify: { kind: 'pjAdd', p: [n, A, n + 1, B], ans: x },
    };
  }
  if (mode === 1) {
    const v = until(() => {
      const n = randInt(rng, 4, 9);
      const A = randInt(rng, 82, 92);
      const d = randInt(rng, 1, 2);
      const up = rng() < 0.5;
      const B = up ? A + d : A - d;
      const x = up ? B + n * d : B - n * d;
      return x >= 55 && x <= 100 ? { n, A, d, B, x } : null;
    });
    const { n, A, d, B, x } = v;
    const dw = B > A ? x - d : x + d;
    return {
      text: `一个小组 ${n} 人平均 ${A} 分，又来了一名同学后，全组平均分变成 ${B} 分。新同学考了多少分？`,
      o: N(rng, x, [dw, A + (B > A ? n * d : -n * d), n * A - (n - 1) * B, x + 1], ' 分'),
      explain: `原来总分 ${n} × ${A} = ${n * A} 分，现在 ${n + 1} 人总分 ${n + 1} × ${B} = ${(n + 1) * B} 分。新同学：${(n + 1) * B} − ${n * A} = ${x} 分。`,
      verify: { kind: 'pjAdd', p: [n, A, n + 1, B], ans: x },
    };
  }
  const v = until(() => {
    const n = randInt(rng, 5, 9);
    const A = randInt(rng, 30, 40);
    const d = randInt(rng, 1, 2);
    const B = rng() < 0.5 ? A + d : A - d;
    const x = n * A - (n - 1) * B;
    return x >= 22 && x <= 55 ? { n, A, B, x } : null;
  });
  const { n, A, B, x } = v;
  return {
    text: `${n} 名同学平均体重 ${A} 千克，走了一名同学后，其余同学平均体重 ${B} 千克。走的同学体重多少千克？`,
    o: N(rng, x, [A + (A - B), B, n * A - n * B, x + 2], ' 千克'),
    explain: `原来总体重 ${n} × ${A} = ${n * A} 千克，剩下 ${n - 1} 人共 ${n - 1} × ${B} = ${(n - 1) * B} 千克。走的同学：${n * A} − ${(n - 1) * B} = ${x} 千克。`,
    verify: { kind: 'pjAdd', p: [n, A, n - 1, B], ans: x },
  };
};

const pjFix: Tpl = (rng) => {
  const v = until(() => {
    const n = pick(rng, [5, 6, 8, 10]);
    const A = randInt(rng, 78, 92);
    const m = randInt(rng, 1, 2);
    const e = m * n * (rng() < 0.5 ? 1 : -1);
    const s = randInt(rng, 60, 100);
    const r = s + e;
    if (r < 50 || r > 100) return null;
    return { n, A, m, e, s, r, W: A + m * Math.sign(e) };
  });
  const { n, A, m, e, s, r, W } = v;
  const more = e > 0;
  return {
    text: `老师算出 ${n} 名同学的平均分是 ${W} 分，后来发现把一个同学的 ${s} 分错记成了 ${r} 分。正确的平均分是多少分？`,
    o: N(rng, A, [W, more ? W + m : W - m, more ? W - Math.abs(e) : W + Math.abs(e), A + 1], ' 分'),
    explain: `错记使总分${more ? '多' : '少'}算了 ${Math.abs(r - s)} 分，平均分就${more ? '多' : '少'}了 ${Math.abs(r - s)} ÷ ${n} = ${m} 分。正确的平均分：${W} ${more ? '−' : '+'} ${m} = ${A} 分。`,
    verify: { kind: 'pjFix', p: [n, W, s, r], ans: A },
  };
};

const pjWeighted: Tpl = (rng) => {
  const candy = rng() < 0.4;
  const v = until(() => {
    const m = candy ? randInt(rng, 2, 12) : randInt(rng, 12, 26);
    const f = candy ? randInt(rng, 2, 12) : randInt(rng, 12, 26);
    const a = candy ? randInt(rng, 10, 40) : randInt(rng, 80, 96);
    const b = candy ? randInt(rng, 10, 40) : randInt(rng, 80, 96);
    if (m === f || Math.abs(a - b) < 3) return null;
    const T = m * a + f * b;
    if (T % (m + f) !== 0) return null;
    return { m, f, a, b, T, avg: T / (m + f) };
  });
  const { m, f, a, b, T, avg } = v;
  const u = candy ? '元' : '分';
  return {
    text: candy
      ? `把 ${m} 千克每千克 ${a} 元的奶糖和 ${f} 千克每千克 ${b} 元的水果糖混合，混合糖每千克多少元？`
      : `某班男生 ${m} 人，平均 ${a} 分；女生 ${f} 人，平均 ${b} 分。全班的平均分是多少分？`,
    o: N(rng, avg, [(a + b) / 2, avg + 1, avg - 1, a, b], ` ${u}`),
    explain: `总数 = ${m} × ${a} + ${f} × ${b} = ${m * a} + ${f * b} = ${T}，总份数 ${m} + ${f} = ${m + f}，平均 ${T} ÷ ${m + f} = ${avg} ${u}。不能直接算 (${a} + ${b}) ÷ 2。`,
    verify: { kind: 'pjWeighted', p: [m, a, f, b], ans: avg },
  };
};

const pjOverlap: Tpl = (rng) => {
  if (rng() < 0.5) {
    const v = until(() => {
      const a = randInt(rng, 25, 60);
      const b = randInt(rng, 25, 60);
      const c = randInt(rng, 25, 60);
      if ((a + b) % 2 || (b + c) % 2 || (a + b + c) % 3 || new Set([a, b, c]).size < 3) return null;
      return { a, b, c, A: (a + b + c) / 3, B: (a + b) / 2, C: (b + c) / 2 };
    });
    const { a, b, c, A, B, C } = v;
    return {
      text: `甲、乙、丙三人平均体重 ${A} 千克，甲、乙平均 ${B} 千克，乙、丙平均 ${C} 千克。乙体重多少千克？`,
      o: N(rng, b, [B + C - A, a, c, (B + C) / 2, b + 3], ' 千克'),
      explain: `三人共 ${A} × 3 = ${3 * A} 千克，甲乙共 ${B} × 2 = ${2 * B} 千克，乙丙共 ${C} × 2 = ${2 * C} 千克。甲乙 + 乙丙 = 三人 + 乙，乙：${2 * B} + ${2 * C} − ${3 * A} = ${b} 千克。`,
      verify: { kind: 'pjOv3a', p: [A, B, C], ans: b },
    };
  }
  const v = until(() => {
    const a = randInt(rng, 10, 80);
    const b = randInt(rng, 10, 80);
    const c = randInt(rng, 10, 80);
    if ((a + b) % 2 || (b + c) % 2 || new Set([a, b, c]).size < 3) return null;
    return { a, b, c, X: (a + b) / 2, Y: (b + c) / 2, Z: (a + c) / 2 };
  });
  const { a, b, c, X, Y, Z } = v;
  const s = a + b + c;
  return {
    text: `甲、乙两数的平均数是 ${X}，乙、丙两数的平均数是 ${Y}，甲、丙两数的平均数是 ${Z}。甲是多少？`,
    o: N(rng, a, [b, c, X + Y - Z, (X + Y + Z) - Y, a + 2]),
    explain: `甲乙、乙丙、甲丙三个和相加是三数之和的 2 倍：(${2 * X} + ${2 * Y} + ${2 * Z}) ÷ 2 = ${s}。乙丙之和是 ${2 * Y}，甲：${s} − ${2 * Y} = ${a}。`,
    verify: { kind: 'pjOv3b', p: [X, Y, Z], ans: a },
  };
};

const pjHL: Tpl = (rng) => {
  const v = until(() => {
    const n = randInt(rng, 6, 9);
    const A = randInt(rng, 84, 92);
    const h = A + randInt(rng, 3, 8);
    const l = A - randInt(rng, 5, 14);
    if (h > 99) return null;
    if ((n * A - h) % (n - 1) !== 0 || (n * A - l) % (n - 1) !== 0) return null;
    const M = n * A - h - l;
    if (M < (n - 2) * l || M > (n - 2) * h) return null;
    return { n, A, h, l, B: (n * A - h) / (n - 1), C: (n * A - l) / (n - 1) };
  });
  const { n, A, h, l, B, C } = v;
  const askHigh = rng() < 0.5;
  const base = `${n} 位评委打分，平均 ${A} 分；去掉一个最高分，平均 ${B} 分；去掉一个最低分，平均 ${C} 分。`;
  if (askHigh)
    return {
      text: `${base}最高分是多少分？`,
      o: N(rng, h, [A + (A - B), l, A + n * (A - B) + 1, h + 1], ' 分'),
      explain: `总分 ${n} × ${A} = ${n * A} 分，去掉最高分后剩 ${n - 1} × ${B} = ${(n - 1) * B} 分。最高分：${n * A} − ${(n - 1) * B} = ${h} 分。`,
      verify: { kind: 'pjHL', p: [n, A, B, C, 0], ans: h },
    };
  const d = h - l;
  return {
    text: `${base}最高分比最低分高多少分？`,
    o: N(rng, d, [C - B, n * (C - B), (n - 2) * (C - B), d + 1], ' 分'),
    explain: `去掉最高分剩 ${n - 1} × ${B} = ${(n - 1) * B} 分，去掉最低分剩 ${n - 1} × ${C} = ${(n - 1) * C} 分，两者之差就是最高分与最低分之差：${(n - 1) * C} − ${(n - 1) * B} = ${d} 分。`,
    verify: { kind: 'pjHL', p: [n, A, B, C, 1], ans: d },
  };
};

const pjWhich: Tpl = (rng) => {
  const [P] = two(rng, NAMES);
  const v = until(() => {
    const m = randInt(rng, 3, 9);
    const A = randInt(rng, 80, 90);
    const d = randInt(rng, 1, 3);
    const B = A + d;
    const X = B + m * d;
    return X <= 100 ? { m, A, d, B, X } : null;
  });
  const { m, A, d, B, X } = v;
  return {
    text: `${P}前几次测验平均 ${A} 分，这次考了 ${X} 分，平均分提高到 ${B} 分。包括这次，${P}共考了几次？`,
    o: N(rng, m + 1, [m, m + 2, m + 3, X - B], ' 次'),
    explain: `这次比新平均分多 ${X} − ${B} = ${X - B} 分，这些分补给前面每次 ${B} − ${A} = ${d} 分，前面考了 ${X - B} ÷ ${d} = ${m} 次。加上这次共 ${m + 1} 次。`,
    verify: { kind: 'pjWhich', p: [A, X, B], ans: m + 1 },
  };
};

/* ═════════════ 方阵问题 ═════════════ */

const FZ_CTX: { s: string; u: string }[] = [
  { s: '同学们排成', u: '人' },
  { s: '用盆花摆成', u: '盆' },
  { s: '用棋子摆成', u: '枚' },
  { s: '士兵们排成', u: '人' },
];

/** 点阵方阵图：layers 为层数（≥ n/2 即实心）；mode=outer 只突出最外层，layers 按层交替着色 */
function dotSquare(n: number, layers: number, mode: 'outer' | 'layers', label: string): string {
  const sp = Math.min(13, 116 / (n - 1));
  const size = sp * (n - 1);
  const x0 = 130 - size / 2;
  const y0 = 76 - size / 2;
  const r = sp >= 11 ? 3.6 : 3;
  const parts: string[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const L = Math.min(i, j, n - 1 - i, n - 1 - j);
      if (L >= layers) continue;
      const col = mode === 'outer' ? (L === 0 ? FIG.accent : FIG.stroke) : L % 2 === 0 ? FIG.accent : FIG.accent2;
      parts.push(dot(x0 + j * sp, y0 + i * sp, r, col));
    }
  parts.push(text(130, 156, label, { size: 13, color: FIG.dim }));
  return svg(parts);
}

const fzOuter: Tpl = (rng) => {
  const c = pick(rng, FZ_CTX);
  const n = randInt(rng, 5, 16);
  const ans = 4 * n - 4;
  return {
    text: `${c.s}一个实心方阵，最外层每边 ${n} ${c.u}。最外层一共有多少${c.u}？`,
    o: N(rng, ans, [4 * n, n * n, 4 * n - 2, 4 * n - 8], ` ${c.u}`),
    explain: `四条边各 ${n} ${c.u}，但 4 个角上的${c.u === '人' ? '人' : '每个'}都被重复算了一次：${n} × 4 − 4 = ${ans} ${c.u}。`,
    verify: { kind: 'fzOuter', p: [n], ans },
    figure: n <= 10 ? dotSquare(n, Math.ceil(n / 2), 'outer', `每边 ${n} ${c.u}`) : undefined,
  };
};

const fzTotalOuter: Tpl = (rng) => {
  const c = pick(rng, FZ_CTX);
  const n = randInt(rng, 5, 16);
  const T = n * n;
  if (rng() < 0.5) {
    const ans = 4 * n - 4;
    return {
      text: `${c.s}一个实心方阵，共 ${T} ${c.u}。最外层有多少${c.u}？`,
      o: N(rng, ans, [4 * n, T / 4, 4 * n + 4, 4 * n - 2], ` ${c.u}`),
      explain: `${T} = ${n} × ${n}，所以每边 ${n} ${c.u}。最外层：${n} × 4 − 4 = ${ans} ${c.u}。`,
      verify: { kind: 'fzTotal', p: [T, 1], ans },
    };
  }
  return {
    text: `${c.s}一个实心方阵，共 ${T} ${c.u}。每边有多少${c.u}？`,
    o: N(rng, n, [T / 2, T / 4, n + 1, n - 1], ` ${c.u}`),
    explain: `实心方阵总数 = 每边数 × 每边数。因为 ${n} × ${n} = ${T}，所以每边 ${n} ${c.u}。`,
    verify: { kind: 'fzTotal', p: [T, 0], ans: n },
  };
};

const fzOuterTotal: Tpl = (rng) => {
  const c = pick(rng, FZ_CTX);
  const n = randInt(rng, 5, 16);
  const P = 4 * n - 4;
  const ans = n * n;
  return {
    text: `${c.s}一个实心方阵，最外层一共有 ${P} ${c.u}。这个方阵共有多少${c.u}？`,
    o: N(rng, ans, [(n - 1) * (n - 1), (n + 1) * (n + 1), (P / 4) * n, ans - P], ` ${c.u}`),
    explain: `最外层每边：${P} ÷ 4 + 1 = ${n} ${c.u}（角上的被算了两次，要加回 1）。总数：${n} × ${n} = ${ans} ${c.u}。`,
    verify: { kind: 'fzOuterTotal', p: [P], ans },
  };
};

const fzHollow: Tpl = (rng) => {
  const c = pick(rng, FZ_CTX);
  const n = randInt(rng, 6, 14);
  const k = randInt(rng, 2, Math.floor((n - 1) / 2));
  const ans = 4 * k * (n - k);
  const m = n - 2 * k;
  return {
    text: `${c.s}一个空心方阵，最外层每边 ${n} ${c.u}，共 ${k} 层。一共有多少${c.u}？`,
    o: N(rng, ans, [4 * k * n, 4 * k * (n - 1), n * n, 4 * k * (n - k) + 4 * k], ` ${c.u}`),
    explain: `空心方阵总数 = (每边数 − 层数) × 层数 × 4 = (${n} − ${k}) × ${k} × 4 = ${ans} ${c.u}。也可以用大正方形减中间空的：${n} × ${n} − ${m} × ${m} = ${ans}。`,
    verify: { kind: 'fzHollow', p: [n, k], ans },
    figure: n <= 10 ? dotSquare(n, k, 'layers', `每边 ${n} ${c.u}，共 ${k} 层`) : undefined,
  };
};

const fzAddRow: Tpl = (rng) => {
  const c = pick(rng, FZ_CTX);
  const n = randInt(rng, 5, 16);
  if (rng() < 0.5) {
    const A = 2 * n + 1;
    return {
      text: `${c.s}一个实心方阵，如果横、竖各增加一排，就要增加 ${A} ${c.u}。原来有多少${c.u}？`,
      o: N(rng, n * n, [(n + 1) * (n + 1), n * (n + 1), (n - 1) * (n - 1), A * 4], ` ${c.u}`),
      explain: `增加的一行一列共 原每边数 × 2 + 1 ${c.u}，原每边：(${A} − 1) ÷ 2 = ${n} ${c.u}。原来共 ${n} × ${n} = ${n * n} ${c.u}。`,
      verify: { kind: 'fzAddRow', p: [A, 0], ans: n * n },
    };
  }
  const A = 2 * n - 1;
  return {
    text: `${c.s}一个实心方阵，如果去掉一行和一列，就减少 ${A} ${c.u}。原来有多少${c.u}？`,
    o: N(rng, n * n, [(n - 1) * (n - 1), n * (n - 1), (n + 1) * (n + 1), A * 4], ` ${c.u}`),
    explain: `去掉的一行一列共 原每边数 × 2 − 1 ${c.u}（交叉处只算一次），原每边：(${A} + 1) ÷ 2 = ${n} ${c.u}。原来共 ${n} × ${n} = ${n * n} ${c.u}。`,
    verify: { kind: 'fzAddRow', p: [A, 1], ans: n * n },
  };
};

const fzLeftover: Tpl = (rng) => {
  const v = until(() => {
    const r = randInt(rng, 3, 20);
    const s = randInt(rng, 3, 20);
    if ((r + s) % 2 === 0) return null;
    const n = (r + s - 1) / 2;
    return n >= 5 ? { r, s, n } : null;
  });
  const { r, s, n } = v;
  const ans = n * n + r;
  const who = pick(rng, ['一群同学', '一队士兵', '一批运动员']);
  return {
    text: `${who}排成实心方阵，多出 ${r} 人；如果横、竖各增加一排，还差 ${s} 人。共有多少人？`,
    o: N(rng, ans, [n * n, (n + 1) * (n + 1), n * n + s, ans + 2 * n + 1], ' 人'),
    explain: `横竖各加一排需要 ${r} + ${s} = ${r + s} 人，它等于 原每边人数 × 2 + 1，原每边 (${r + s} − 1) ÷ 2 = ${n} 人。总人数：${n} × ${n} + ${r} = ${ans} 人。`,
    verify: { kind: 'fzLeft', p: [r, s], ans },
  };
};

const fzLayers: Tpl = (rng) => {
  const c = pick(rng, FZ_CTX);
  const n = randInt(rng, 8, 16);
  const k = randInt(rng, 2, Math.min(5, Math.floor((n - 1) / 2)));
  const T = 4 * k * (n - k);
  const layers: number[] = [];
  for (let i = 0; i < k; i++) layers.push(4 * (n - 2 * i) - 4);
  return {
    text: `${c.s}一个空心方阵，最外层每边 ${n} ${c.u}，一共 ${T} ${c.u}。这个方阵有几层？`,
    o: N(rng, k, [T / (4 * n), T / (4 * (n - 1)), k + 1, k - 1, k + 2], ' 层'),
    explain: `最外层 ${n} × 4 − 4 = ${layers[0]} ${c.u}，往里每层少 8 ${c.u}：${layers.join(' + ')} = ${T}，正好 ${k} 层。`,
    verify: { kind: 'fzLayers', p: [T, n], ans: k },
  };
};

const fzFill: Tpl = (rng) => {
  const c = pick(rng, FZ_CTX);
  const v = until(() => {
    const n = randInt(rng, 7, 15);
    const k = randInt(rng, 1, 4);
    const m = n - 2 * k;
    return m >= 2 ? { n, k, m } : null;
  });
  const { n, k, m } = v;
  const ans = m * m;
  return {
    text: `${c.s}一个空心方阵，最外层每边 ${n} ${c.u}，共 ${k} 层。要把中间空的地方也排满，还需要多少${c.u}？`,
    o: N(rng, ans, [(n - k) * (n - k), (m - 2) * (m - 2), (m + 2) * (m + 2), 4 * m - 4, (m - 1) * (m - 1)], ` ${c.u}`),
    explain: `每往里一层，每边少 2 ${c.u}。中间空的正方形每边 ${n} − ${k} × 2 = ${m} ${c.u}，还需要 ${m} × ${m} = ${ans} ${c.u}。`,
    verify: { kind: 'fzFill', p: [n, k], ans },
    figure: n <= 10 ? dotSquare(n, k, 'layers', `每边 ${n} ${c.u}，共 ${k} 层`) : undefined,
  };
};

/* ═════════════ 定义新运算 ═════════════ */

const SYM = ['※', '⊙', '△', '☆', '◎', '⊕'] as const;

/** code 0: c1×a + c2×b；1: a×b + a + b；2: a×b − a − b；3: a×b + c1 */
interface Op {
  code: number;
  c1: number;
  c2: number;
}

function randOp(rng: Rng, codes: number[], lo = 2, hi = 6): Op {
  const code = pick(rng, codes);
  const c1 = code === 3 ? randInt(rng, 2, 9) : randInt(rng, lo, hi);
  let c2 = randInt(rng, lo, hi);
  if (code === 0 && c2 === c1) c2 = c1 === hi ? c1 - 1 : c1 + 1;
  return { code, c1, c2 };
}

function opRhs(o: Op): string {
  if (o.code === 0) return `${o.c1}×a + ${o.c2}×b`;
  if (o.code === 1) return 'a×b + a + b';
  if (o.code === 2) return 'a×b − a − b';
  return `a×b + ${o.c1}`;
}

function opVal(o: Op, a: number, b: number): number {
  if (o.code === 0) return o.c1 * a + o.c2 * b;
  if (o.code === 1) return a * b + a + b;
  if (o.code === 2) return a * b - a - b;
  return a * b + o.c1;
}

function opSteps(o: Op, a: number, b: number): string {
  const v = opVal(o, a, b);
  if (o.code === 0) return `${o.c1}×${a} + ${o.c2}×${b} = ${o.c1 * a} + ${o.c2 * b} = ${v}`;
  if (o.code === 1) return `${a}×${b} + ${a} + ${b} = ${a * b} + ${a} + ${b} = ${v}`;
  if (o.code === 2) return `${a}×${b} − ${a} − ${b} = ${a * b} − ${a} − ${b} = ${v}`;
  return `${a}×${b} + ${o.c1} = ${a * b} + ${o.c1} = ${v}`;
}

/** 由 nm${S}b = R 反求 nm（nm 为未知数名） */
function opInv(o: Op, b: number, R: number, x: number, nm: string): string {
  if (o.code === 0) return `${o.c1}×${nm} + ${o.c2}×${b} = ${R}，${o.c1}×${nm} = ${R} − ${o.c2 * b} = ${R - o.c2 * b}，${nm} = ${R - o.c2 * b} ÷ ${o.c1} = ${x}`;
  if (o.code === 1) return `${nm}×${b} + ${nm} + ${b} = ${R}，即 ${nm}×${b + 1} = ${R} − ${b} = ${R - b}，${nm} = ${x}`;
  if (o.code === 2) return `${nm}×${b} − ${nm} − ${b} = ${R}，即 ${nm}×${b - 1} = ${R} + ${b} = ${R + b}，${nm} = ${x}`;
  return `${nm}×${b} + ${o.c1} = ${R}，${nm}×${b} = ${R - o.c1}，${nm} = ${x}`;
}

function opWrongs(o: Op, a: number, b: number): number[] {
  if (o.code === 0) return [o.c1 * b + o.c2 * a, o.c1 * a + b, a + o.c2 * b, (o.c1 + o.c2) * (a + b)];
  if (o.code === 1) return [a * b, (a + 1) * (b + 1), a * b + a];
  if (o.code === 2) return [a * b, (a - 1) * (b - 1), a * b - a];
  return [a * b, a + b + o.c1, a * b - o.c1];
}

const xyEval: Tpl = (rng) => {
  const S = pick(rng, SYM);
  const o = randOp(rng, [0, 1, 2, 3]);
  const lo = o.code === 2 ? 3 : 2;
  const a = randInt(rng, lo, 12);
  const b = until(() => {
    const y = randInt(rng, lo, 12);
    return y === a ? null : y;
  });
  const ans = opVal(o, a, b);
  return {
    text: `规定 a${S}b = ${opRhs(o)}，求 ${a}${S}${b}。`,
    o: N(rng, ans, opWrongs(o, a, b)),
    explain: `按规定把 a = ${a}、b = ${b} 代入：${a}${S}${b} = ${opSteps(o, a, b)}。`,
    verify: { kind: 'xyOp', p: [o.code, o.c1, o.c2, a, b], ans },
  };
};

function consecTerms(x: number, y: number): number[] {
  const t: number[] = [];
  for (let i = 0; i < y; i++) t.push(x + i);
  return t;
}

const xyConsec: Tpl = (rng) => {
  const S = pick(rng, SYM);
  const e1 = randInt(rng, 1, 6);
  const e2 = randInt(rng, 3, 4);
  const x = until(() => {
    const v = randInt(rng, 3, 20);
    return v === e1 ? null : v;
  });
  const y = randInt(rng, 3, 6);
  const t = consecTerms(x, y);
  const ans = sum(t);
  const et = consecTerms(e1, e2);
  return {
    text: `规定 a${S}b 表示从 a 开始的 b 个连续自然数之和，如 ${e1}${S}${e2} = ${et.join(' + ')} = ${sum(et)}。求 ${x}${S}${y}。`,
    o: N(rng, ans, [x * y, ans - (x + y - 1), ans + x + y, x + y, ans + 1]),
    explain: `${x}${S}${y} 表示从 ${x} 开始的 ${y} 个连续自然数相加：${t.join(' + ')} = ${ans}。`,
    verify: { kind: 'xyConsec', p: [x, y], ans },
  };
};

const xyNested: Tpl = (rng) => {
  const S = pick(rng, SYM);
  const v = until(() => {
    const o = randOp(rng, [0, 1, 2, 3], 2, 4);
    const lo = o.code === 2 ? 3 : 1;
    const a = randInt(rng, lo, 6);
    const b = randInt(rng, lo, 6);
    const c = randInt(rng, Math.max(lo, 2), 5);
    const right = rng() < 0.3;
    const inner = right ? opVal(o, b, c) : opVal(o, a, b);
    const ans = right ? opVal(o, a, inner) : opVal(o, inner, c);
    const other = right ? opVal(o, opVal(o, a, b), c) : opVal(o, a, opVal(o, b, c));
    if (o.code === 2 && inner < 3) return null;
    if (ans <= 0 || ans > 400 || other === ans) return null;
    return { o, a, b, c, right, inner, ans, other };
  });
  const { o, a, b, c, right, inner, ans, other } = v;
  const expr = right ? `${a}${S}(${b}${S}${c})` : `(${a}${S}${b})${S}${c}`;
  const step1 = right ? `${b}${S}${c} = ${opSteps(o, b, c)}` : `${a}${S}${b} = ${opSteps(o, a, b)}`;
  const step2 = right ? `${a}${S}${inner} = ${opSteps(o, a, inner)}` : `${inner}${S}${c} = ${opSteps(o, inner, c)}`;
  return {
    text: `规定 a${S}b = ${opRhs(o)}，求 ${expr}。`,
    o: N(rng, ans, [other, inner, ans + c, ans - 1]),
    explain: `先算括号里：${step1}；再算 ${step2}。`,
    verify: { kind: 'xyNest', p: [o.code, o.c1, o.c2, a, b, c, right ? 1 : 0], ans },
  };
};

const xyUnknown: Tpl = (rng) => {
  const S = pick(rng, SYM);
  const o = randOp(rng, [0, 1, 2, 3]);
  const b = randInt(rng, o.code === 2 ? 3 : 2, 9);
  const x = randInt(rng, o.code === 2 ? 3 : 2, 15);
  const R = opVal(o, x, b);
  const w: number[] =
    o.code === 0
      ? [R - o.c2 * b, (R - b) / o.c1, R / o.c1, x + 1]
      : o.code === 1
        ? [R - b, R / (b + 1), (R - b) / b, x + 1]
        : o.code === 2
          ? [R + b, (R - b) / (b - 1), R / (b - 1), x + 1]
          : [R - o.c1, R / b, x + 1];
  return {
    text: `规定 a${S}b = ${opRhs(o)}。如果 x${S}${b} = ${R}，那么 x 是多少？`,
    o: N(rng, x, [...w, x - 1, x + 2]),
    explain: `按规定：${opInv(o, b, R, x, 'x')}。检验：${x}${S}${b} = ${opSteps(o, x, b)}。`,
    verify: { kind: 'xyUnk', p: [o.code, o.c1, o.c2, b, R], ans: x },
  };
};

const xyConsecUnk: Tpl = (rng) => {
  const S = pick(rng, SYM);
  const y = randInt(rng, 3, 6);
  const x = randInt(rng, 3, 30);
  const tri = (y * (y - 1)) / 2;
  const R = y * x + tri;
  return {
    text: `规定 a${S}b 表示从 a 开始的 b 个连续自然数之和，如 2${S}3 = 2 + 3 + 4。若 x${S}${y} = ${R}，求 x。`,
    o: N(rng, x, [Math.floor(R / y), R - y, (R - y) / y, x + 1, x - 1]),
    explain: `x${S}${y} = x + (x + 1) + … + (x + ${y - 1})，是 ${y} 个 x 再加上 ${Array.from({ length: y - 1 }, (_, i) => i + 1).join(' + ')} = ${tri}。所以 ${y} × x = ${R} − ${tri} = ${R - tri}，x = ${x}。`,
    verify: { kind: 'xyConsecUnk', p: [y, R], ans: x },
  };
};

function repTerms(a: number, n: number): number[] {
  const t: number[] = [];
  let cur = 0;
  for (let i = 0; i < n; i++) {
    cur = cur * 10 + a;
    t.push(cur);
  }
  return t;
}

const xyRep: Tpl = (rng) => {
  const S = pick(rng, SYM);
  const a = randInt(rng, 1, 9);
  const n = randInt(rng, 3, 5);
  const v = until(() => {
    const d1 = randInt(rng, 1, 9);
    const d2 = randInt(rng, 1, 9);
    const n1 = randInt(rng, 3, 4);
    const n2 = randInt(rng, 2, 4);
    if (d1 === a || d2 === a || d1 === d2 || n1 === n2) return null;
    return { d1, d2, n1, n2 };
  });
  const { d1, d2, n1, n2 } = v;
  const t = repTerms(a, n);
  const ans = sum(t);
  return {
    text: `规定 ${d1}${S}${n1} = ${repTerms(d1, n1).join(' + ')}，${d2}${S}${n2} = ${repTerms(d2, n2).join(' + ')}。照此规定，${a}${S}${n} = ？`,
    o: N(rng, ans, [sum(repTerms(a, n - 1)), sum(repTerms(a, n + 1)), t[n - 1], a * n, ans + a]),
    explain: `a${S}n 表示 n 个数相加：第一个是 a，后面每个数比前一个多写一位 a。${a}${S}${n} = ${t.join(' + ')} = ${ans}。`,
    verify: { kind: 'xyRep', p: [a, n], ans },
  };
};

const FORMS = ['k×a + b', 'a×b + k', 'a + k×b', 'k×a − b', '(a + b)×k'] as const;
function formVal(f: number, k: number, a: number, b: number): number {
  if (f === 0) return k * a + b;
  if (f === 1) return a * b + k;
  if (f === 2) return a + k * b;
  if (f === 3) return k * a - b;
  return (a + b) * k;
}
function formSolve(f: number, p: number, q: number, R: number, k: number): string {
  if (f === 0) return `k×${p} + ${q} = ${R}，k×${p} = ${R - q}，k = ${k}`;
  if (f === 1) return `${p}×${q} + k = ${R}，k = ${R} − ${p * q} = ${k}`;
  if (f === 2) return `${p} + k×${q} = ${R}，k×${q} = ${R - p}，k = ${k}`;
  if (f === 3) return `k×${p} − ${q} = ${R}，k×${p} = ${R + q}，k = ${k}`;
  return `(${p} + ${q})×k = ${R}，k = ${R} ÷ ${p + q} = ${k}`;
}
function formSteps(f: number, k: number, a: number, b: number): string {
  const v = formVal(f, k, a, b);
  if (f === 0) return `${k}×${a} + ${b} = ${v}`;
  if (f === 1) return `${a}×${b} + ${k} = ${v}`;
  if (f === 2) return `${a} + ${k}×${b} = ${v}`;
  if (f === 3) return `${k}×${a} − ${b} = ${v}`;
  return `(${a} + ${b})×${k} = ${v}`;
}

const xyFindK: Tpl = (rng) => {
  const S = pick(rng, SYM);
  const v = until(() => {
    const f = randInt(rng, 0, 4);
    const k = randInt(rng, 2, 9);
    const p = randInt(rng, 2, 9);
    const q = randInt(rng, 2, 9);
    const u = randInt(rng, 2, 12);
    const w = randInt(rng, 2, 12);
    if (u === p && w === q) return null;
    const R = formVal(f, k, p, q);
    const ans = formVal(f, k, u, w);
    if (R <= 0 || ans <= 0) return null;
    return { f, k, p, q, u, w, R, ans };
  });
  const { f, k, p, q, u, w, R, ans } = v;
  return {
    text: `规定 a${S}b = ${FORMS[f]}（k 是一个固定的数）。已知 ${p}${S}${q} = ${R}，求 ${u}${S}${w}。`,
    o: N(rng, ans, [formVal(f, k + 1, u, w), formVal(f, k - 1, u, w), formVal(f, k, w, u), R, ans + k]),
    explain: `先求 k：${formSolve(f, p, q, R, k)}。再算：${u}${S}${w} = ${formSteps(f, k, u, w)}。`,
    verify: { kind: 'xyFindK', p: [f, p, q, R, u, w], ans },
  };
};

const xyNestUnk: Tpl = (rng) => {
  const S = pick(rng, SYM);
  const o = randOp(rng, [0, 1, 3], 2, 4);
  const x = randInt(rng, 2, 9);
  const b = randInt(rng, 2, 5);
  const c = randInt(rng, 2, 4);
  const u = opVal(o, x, b);
  const R = opVal(o, u, c);
  return {
    text: `规定 a${S}b = ${opRhs(o)}。如果 (x${S}${b})${S}${c} = ${R}，那么 x 是多少？`,
    o: N(rng, x, [u, x + 1, x - 1, x + 2]),
    explain: `把 x${S}${b} 看成一个数 m：${opInv(o, c, R, u, 'm')}。再由 x${S}${b} = ${u}：${opInv(o, b, u, x, 'x')}。`,
    verify: { kind: 'xyNestUnk', p: [o.code, o.c1, o.c2, b, c, R], ans: x },
  };
};

/* ═════════════ 容斥问题 ═════════════ */

const RC_PAIRS: [string, string, string][] = [
  ['语文', '数学', '喜欢'],
  ['足球', '篮球', '喜欢'],
  ['唱歌', '跳舞', '喜欢'],
  ['美术组', '书法组', '参加'],
  ['航模组', '编程组', '参加'],
  ['游泳', '跑步', '喜欢'],
];

type VennQ = 'both' | 'onlyA' | 'onlyB' | 'out' | null;

/** 两圆韦恩图：la/lb 是两个集合的标签（含人数），uni 为全集标签；q 标出所问区域；both 可标出交集人数 */
function venn2(la: string, lb: string, q: VennQ, uni?: string, bothLabel?: string): string {
  const parts: string[] = [];
  if (uni) {
    parts.push(rect(8, 18, 244, 146, { stroke: FIG.dim, width: 1.5 }));
    parts.push(text(244, 152, uni, { size: 13, color: FIG.dim, anchor: 'end' }));
  }
  parts.push(circle(100, 96, 52, { fill: FIG.fill }), circle(160, 96, 52, { fill: FIG.fill2 }));
  parts.push(text(80, 32, la, { size: 13, color: FIG.accent2 }), text(180, 32, lb, { size: 13, color: FIG.accent }));
  const pos: Record<string, [number, number]> = { both: [130, 96], onlyA: [74, 96], onlyB: [186, 96], out: [34, 146] };
  if (bothLabel) parts.push(text(130, 96, bothLabel, { size: 13 }));
  if (q) parts.push(text(pos[q][0], pos[q][1], '?', { size: 18, bold: true, color: FIG.accent }));
  return svg(parts);
}

function rcRegions(rng: Rng): { oa: number; ob: number; c: number } {
  return { oa: randInt(rng, 3, 22), ob: randInt(rng, 3, 22), c: randInt(rng, 2, 14) };
}

const rcBoth: Tpl = (rng) => {
  const [X, Y, vb] = pick(rng, RC_PAIRS);
  const { oa, ob, c } = rcRegions(rng);
  const A = oa + c;
  const B = ob + c;
  const Nn = A + B - c;
  return {
    text: `全班 ${Nn} 人，每人至少${vb}${X}和${Y}中的一项。${vb}${X}的有 ${A} 人，${vb}${Y}的有 ${B} 人。两项都${vb}的有多少人？`,
    o: N(rng, c, [Nn - A, Nn - B, Math.abs(A - B), c + 2], ' 人'),
    explain: `${A} + ${B} = ${A + B} 人，比全班多出 ${A + B} − ${Nn} = ${c} 人，多出的就是两项都${vb}、被算了两次的人，所以两项都${vb}的有 ${c} 人。`,
    verify: { kind: 'rc2', p: [3, 0, Nn, 1, A, 2, B, 4, 0], ans: c },
    figure: venn2(`${X} ${A} 人`, `${Y} ${B} 人`, 'both', `全班 ${Nn} 人`),
  };
};

const rcTotal: Tpl = (rng) => {
  const [X, Y, vb] = pick(rng, RC_PAIRS);
  const { oa, ob, c } = rcRegions(rng);
  const A = oa + c;
  const B = ob + c;
  const ans = A + B - c;
  return {
    text: `${vb}${X}的有 ${A} 人，${vb}${Y}的有 ${B} 人，两项都${vb}的有 ${c} 人。至少${vb}一项的共有多少人？`,
    o: N(rng, ans, [A + B, A + B + c, A + B - 2 * c, ans + 1], ' 人'),
    explain: `两项都${vb}的 ${c} 人在 ${A} 和 ${B} 里各被算了一次，多算了一次要减去：${A} + ${B} − ${c} = ${ans} 人。`,
    verify: { kind: 'rc2', p: [8, 1, A, 2, B, 3, c], ans },
    figure: venn2(`${X} ${A} 人`, `${Y} ${B} 人`, null, undefined, `${c} 人`),
  };
};

const rcNeither: Tpl = (rng) => {
  const [X, Y, vb] = pick(rng, RC_PAIRS);
  const { oa, ob, c } = rcRegions(rng);
  const E = randInt(rng, 2, 12);
  const A = oa + c;
  const B = ob + c;
  const Nn = oa + ob + c + E;
  if (rng() < 0.5) {
    return {
      text: `全班 ${Nn} 人，${vb}${X}的有 ${A} 人，${vb}${Y}的有 ${B} 人，两项都${vb}的有 ${c} 人。两项都不${vb}的有多少人？`,
      o: N(rng, E, [Nn - A - B, A + B - c, E + c, E + 2 * c, E + 1], ' 人'),
      explain: `至少${vb}一项的：${A} + ${B} − ${c} = ${A + B - c} 人。两项都不${vb}的：${Nn} − ${A + B - c} = ${E} 人。`,
      verify: { kind: 'rc2', p: [4, 0, Nn, 1, A, 2, B, 3, c], ans: E },
      figure: venn2(`${X} ${A} 人`, `${Y} ${B} 人`, 'out', `全班 ${Nn} 人`, `${c} 人`),
    };
  }
  return {
    text: `全班 ${Nn} 人，${vb}${X}的有 ${A} 人，${vb}${Y}的有 ${B} 人，两项都不${vb}的有 ${E} 人。两项都${vb}的有多少人？`,
    o: N(rng, c, [A + B - Nn, c + E, Nn - E - A, Nn - E - B, c + 1], ' 人'),
    explain: `至少${vb}一项的：${Nn} − ${E} = ${Nn - E} 人。${A} + ${B} = ${A + B} 人，多出 ${A + B} − ${Nn - E} = ${c} 人，就是两项都${vb}的人数。`,
    verify: { kind: 'rc2', p: [3, 0, Nn, 1, A, 2, B, 4, E], ans: c },
    figure: venn2(`${X} ${A} 人`, `${Y} ${B} 人`, 'both', `全班 ${Nn} 人`),
  };
};

const rcOnly: Tpl = (rng) => {
  const [X, Y, vb] = pick(rng, RC_PAIRS);
  const { oa, ob, c } = rcRegions(rng);
  const A = oa + c;
  const B = ob + c;
  if (rng() < 0.5) {
    return {
      text: `${vb}${X}的有 ${A} 人，${vb}${Y}的有 ${B} 人，其中两项都${vb}的有 ${c} 人。只${vb}${X}的有多少人？`,
      o: N(rng, oa, [A, ob, A + B - c, oa + 1], ' 人'),
      explain: `${vb}${X}的 ${A} 人里包含了两项都${vb}的 ${c} 人，只${vb}${X}的：${A} − ${c} = ${oa} 人。`,
      verify: { kind: 'rc2', p: [5, 1, A, 2, B, 3, c], ans: oa },
      figure: venn2(`${X} ${A} 人`, `${Y} ${B} 人`, 'onlyA', undefined, `${c} 人`),
    };
  }
  const ans = oa + ob;
  return {
    text: `${vb}${X}的有 ${A} 人，${vb}${Y}的有 ${B} 人，其中两项都${vb}的有 ${c} 人。只${vb}一项的有多少人？`,
    o: N(rng, ans, [A + B - c, A + B, A + B - 3 * c, ans + c], ' 人'),
    explain: `只${vb}${X}：${A} − ${c} = ${oa} 人；只${vb}${Y}：${B} − ${c} = ${ob} 人。只${vb}一项的共 ${oa} + ${ob} = ${ans} 人。`,
    verify: { kind: 'rc2', p: [7, 1, A, 2, B, 3, c], ans },
    figure: venn2(`${X} ${A} 人`, `${Y} ${B} 人`, null, undefined, `${c} 人`),
  };
};

/** 尺寸线：从 x1 到 x2，高度 y，标签写在 ly */
function hDim(x1: number, x2: number, y: number, label: string, ly: number, color: string = FIG.accent): string[] {
  return [
    line(x1, y, x2, y, { stroke: FIG.dim, width: 1.2 }),
    line(x1, y - 4, x1, y + 4, { stroke: FIG.dim, width: 1.2 }),
    line(x2, y - 4, x2, y + 4, { stroke: FIG.dim, width: 1.2 }),
    text((x1 + x2) / 2, ly, label, { size: 13, color }),
  ];
}

function stripFig(L1: number, L2: number, o: number, oLabel: string, tLabel: string): string {
  const total = L1 + L2 - o;
  const s = 196 / total;
  const x0 = 32;
  const a1 = x0;
  const a2 = x0 + L1 * s;
  const b1 = x0 + (L1 - o) * s;
  const b2 = x0 + total * s;
  const parts: string[] = [
    rect(a1, 50, a2 - a1, 20, { fill: FIG.fill, stroke: FIG.accent2 }),
    rect(b1, 62, b2 - b1, 20, { fill: FIG.fill2, stroke: FIG.accent }),
    ...hDim(a1, a2, 40, `${L1} 厘米`, 28),
    ...hDim(b1, b2, 92, `${L2} 厘米`, 104),
    line(b1, 50, b1, 122, { stroke: FIG.dim, width: 1, dash: true }),
    line(a2, 50, a2, 122, { stroke: FIG.dim, width: 1, dash: true }),
    ...hDim(b1, a2, 122, oLabel, 134, oLabel === '?' ? FIG.accent : FIG.stroke),
    ...hDim(a1, b2, 150, tLabel, 162, tLabel === '?' ? FIG.accent : FIG.stroke),
  ];
  return svg(parts, 260, 172);
}

const rcStrip: Tpl = (rng) => {
  const L1 = randInt(rng, 12, 40);
  const L2 = randInt(rng, 12, 40);
  const o = randInt(rng, 2, 8);
  const T = L1 + L2 - o;
  if (rng() < 0.5) {
    return {
      text: `两张纸条分别长 ${L1} 厘米和 ${L2} 厘米，粘在一起时重叠了 ${o} 厘米。粘好后的纸条长多少厘米？`,
      o: N(rng, T, [L1 + L2, L1 + L2 + o, L1 + L2 - 2 * o, T + 1], ' 厘米'),
      explain: `两张纸条长度相加，重叠的 ${o} 厘米被算了两次，要减去一次：${L1} + ${L2} − ${o} = ${T} 厘米。`,
      verify: { kind: 'rcStrip', p: [L1, L2, o, 0], ans: T },
      figure: stripFig(L1, L2, o, `重叠 ${o} 厘米`, '?'),
    };
  }
  return {
    text: `两张纸条分别长 ${L1} 厘米和 ${L2} 厘米，粘成一张长 ${T} 厘米的纸条。重叠部分长多少厘米？`,
    o: N(rng, o, [T - L1, T - L2, (L1 + L2 - T) * 2, o + 1, o + 2], ' 厘米'),
    explain: `两张纸条长度和是 ${L1} + ${L2} = ${L1 + L2} 厘米，比粘好后多 ${L1 + L2} − ${T} = ${o} 厘米，多出的就是重叠部分。`,
    verify: { kind: 'rcStrip', p: [L1, L2, T, 1], ans: o },
    figure: stripFig(L1, L2, o, '?', `共 ${T} 厘米`),
  };
};

const RC3: [string, string, string][] = [
  ['唱歌', '跳舞', '画画'],
  ['语文', '数学', '英语'],
  ['足球', '篮球', '排球'],
  ['航模', '编程', '书法'],
];

function venn3(la: string, lb: string, lc: string): string {
  const parts: string[] = [
    circle(104, 74, 46, { fill: FIG.fill }),
    circle(156, 74, 46, { fill: FIG.fill2 }),
    circle(130, 116, 46, { fill: 'rgba(160,255,140,0.18)' }),
    text(46, 24, la, { size: 13, color: FIG.accent2 }),
    text(214, 24, lb, { size: 13, color: FIG.accent }),
    text(218, 150, lc, { size: 13, color: '#9dff8c' }),
    text(130, 88, '?', { size: 16, bold: true, color: FIG.accent }),
  ];
  return svg(parts);
}

const rcThree: Tpl = (rng) => {
  const [X, Y, Z] = pick(rng, RC3);
  const t = randInt(rng, 1, 5);
  const ab = randInt(rng, 1, 6);
  const ac = randInt(rng, 1, 6);
  const bc = randInt(rng, 1, 6);
  const oa = randInt(rng, 2, 12);
  const ob = randInt(rng, 2, 12);
  const oc = randInt(rng, 2, 12);
  const A = oa + ab + ac + t;
  const B = ob + ab + bc + t;
  const C = oc + ac + bc + t;
  const AB = ab + t;
  const AC = ac + t;
  const BC = bc + t;
  const Nn = oa + ob + oc + ab + ac + bc + t;
  const fig = venn3(`${X} ${A} 人`, `${Y} ${B} 人`, `${Z} ${C} 人`);
  const pairs = `${X}${Y}都参加 ${AB} 人，${X}${Z}都参加 ${AC} 人，${Y}${Z}都参加 ${BC} 人`;
  const s1 = A + B + C;
  const s2 = AB + AC + BC;
  if (rng() < 0.55) {
    return {
      text: `全班 ${Nn} 人，每人至少参加一项，各项人数如图。${pairs}。三项都参加的有几人？`,
      o: N(rng, t, [s1 - Nn, Nn - s1 + s2 + 1, s2 - t, t + 1, t + 2], ' 人'),
      explain: `三集合容斥：总数 = ${X} + ${Y} + ${Z} − 两两都参加的 + 三项都参加的。${Nn} = ${s1} − ${s2} + 三项都参加，所以三项都参加的有 ${Nn} − ${s1 - s2} = ${t} 人。`,
      verify: { kind: 'rc3', p: [0, Nn, A, B, C, AB, AC, BC, t], ans: t },
      figure: fig,
    };
  }
  return {
    text: `每人至少参加一项，各项人数如图。${pairs}，三项都参加 ${t} 人。一共有多少人？`,
    o: N(rng, Nn, [s1 - s2, s1, s1 - s2 - t, s1 - s2 + 2 * t, Nn + 1], ' 人'),
    explain: `总数 = ${X} + ${Y} + ${Z} − 两两都参加的 + 三项都参加的 = ${s1} − ${s2} + ${t} = ${Nn} 人。三项都参加的人先被加 3 次又被减 3 次，所以要再加回来。`,
    verify: { kind: 'rc3', p: [1, Nn, A, B, C, AB, AC, BC, t], ans: Nn },
    figure: fig,
  };
};

const DIV_PAIRS: [number, number][] = [
  [2, 3], [2, 5], [3, 5], [3, 4], [4, 6], [2, 7], [3, 7], [4, 5], [6, 9], [4, 10], [6, 8], [5, 6],
];
function gcdB(a: number, b: number): number {
  return b === 0 ? a : gcdB(b, a % b);
}

const rcDiv: Tpl = (rng) => {
  const [a, b] = pick(rng, DIV_PAIRS);
  const Nn = randInt(rng, 30, 150);
  const l = (a * b) / gcdB(a, b);
  const fa = Math.floor(Nn / a);
  const fb = Math.floor(Nn / b);
  const fl = Math.floor(Nn / l);
  const fab = Math.floor(Nn / (a * b));
  const or = fa + fb - fl;
  const note = l !== a * b ? `（注意 ${a} 和 ${b} 的最小公倍数是 ${l}）` : '';
  const ex = `能被 ${a} 整除的有 ${fa} 个，能被 ${b} 整除的有 ${fb} 个，同时能被两数整除即能被 ${l} 整除的有 ${fl} 个${note}。`;
  if (rng() < 0.5) {
    return {
      text: `在 1 到 ${Nn} 这 ${Nn} 个自然数中，能被 ${a} 或 ${b} 整除的数有多少个？`,
      o: N(rng, or, [fa + fb, fa + fb - fab, or + 1, or - 1], ' 个'),
      explain: `${ex}能被 ${a} 或 ${b} 整除的：${fa} + ${fb} − ${fl} = ${or} 个。`,
      verify: { kind: 'rcDiv', p: [Nn, a, b, 0], ans: or },
    };
  }
  const ans = Nn - or;
  return {
    text: `在 1 到 ${Nn} 这 ${Nn} 个自然数中，既不能被 ${a} 整除也不能被 ${b} 整除的数有多少个？`,
    o: N(rng, ans, [Nn - fa - fb, Nn - (fa + fb - fab), or, ans + 1, ans - 1], ' 个'),
    explain: `${ex}能被 ${a} 或 ${b} 整除的有 ${fa} + ${fb} − ${fl} = ${or} 个，都不能的：${Nn} − ${or} = ${ans} 个。`,
    verify: { kind: 'rcDiv', p: [Nn, a, b, 1], ans },
  };
};

function chainFig(k: number, L: number, o: number, oLabel: string, tLabel: string): string {
  const total = k * L - (k - 1) * o;
  const s = 196 / total;
  const x0 = 32;
  const parts: string[] = [];
  for (let i = 0; i < k; i++) {
    const x = x0 + i * (L - o) * s;
    const y = i % 2 === 0 ? 50 : 62;
    parts.push(rect(x, y, L * s, 20, { fill: i % 2 === 0 ? FIG.fill : FIG.fill2, stroke: i % 2 === 0 ? FIG.accent2 : FIG.accent }));
  }
  parts.push(...hDim(x0, x0 + L * s, 40, `每张 ${L} 厘米`, 28));
  const ox1 = x0 + (L - o) * s;
  const ox2 = x0 + L * s;
  parts.push(line(ox1, 82, ox1, 104, { stroke: FIG.dim, width: 1, dash: true }), line(ox2, 70, ox2, 104, { stroke: FIG.dim, width: 1, dash: true }));
  parts.push(...hDim(ox1, ox2, 104, oLabel, 118, oLabel === '?' ? FIG.accent : FIG.stroke));
  parts.push(...hDim(x0, x0 + total * s, 142, tLabel, 156, tLabel === '?' ? FIG.accent : FIG.stroke));
  return svg(parts, 260, 170);
}

const rcChain: Tpl = (rng) => {
  const k = randInt(rng, 3, 6);
  const L = randInt(rng, 10, 25);
  const o = randInt(rng, 1, 4);
  const T = k * L - (k - 1) * o;
  if (rng() < 0.5) {
    return {
      text: `${k} 张同样的纸条，每张长 ${L} 厘米，依次粘成一长条，每两张之间重叠 ${o} 厘米。粘成的纸条长多少厘米？`,
      o: N(rng, T, [k * L - k * o, k * L, k * L - (k - 2) * o, T + 1], ' 厘米'),
      explain: `${k} 张纸条只有 ${k - 1} 处重叠。总长 = ${L} × ${k} − ${o} × ${k - 1} = ${k * L} − ${(k - 1) * o} = ${T} 厘米。`,
      verify: { kind: 'rcChain', p: [k, L, o, 0], ans: T },
      figure: chainFig(k, L, o, `重叠 ${o} 厘米`, '?'),
    };
  }
  return {
    text: `${k} 张同样的纸条，每张长 ${L} 厘米，依次粘成一条长 ${T} 厘米的纸条，每处重叠一样长。每处重叠多少厘米？`,
    o: N(rng, o, [(k * L - T) / k, k * L - T, o + 1, o + 2], ' 厘米'),
    explain: `${k} 张共长 ${L} × ${k} = ${k * L} 厘米，比粘好后多 ${k * L} − ${T} = ${k * L - T} 厘米。${k} 张纸条有 ${k - 1} 处重叠，每处：${k * L - T} ÷ ${k - 1} = ${o} 厘米。`,
    verify: { kind: 'rcChain', p: [k, L, T, 1], ans: o },
    figure: chainFig(k, L, o, '?', `共 ${T} 厘米`),
  };
};

function rectFig(a: number, b: number, c: number, d: number, e: number, f: number): string {
  const W = a + c - e;
  const H = b + d - f;
  const s = Math.min(170 / W, 118 / H);
  const ox = 130 - (W * s) / 2;
  const oy = 84 - (H * s) / 2;
  const x2 = ox + (a - e) * s;
  const y2 = oy + (b - f) * s;
  const parts: string[] = [
    rect(ox, oy, a * s, b * s, { fill: FIG.fill, stroke: FIG.accent2 }),
    rect(x2, y2, c * s, d * s, { fill: FIG.fill, stroke: FIG.accent }),
    rect(x2, y2, e * s, f * s, { fill: FIG.fill2, stroke: FIG.accent, width: 1 }),
    text(ox + (a * s) / 2, oy - 10, a, { size: 13, color: FIG.accent2 }),
    text(ox - 11, oy + (b * s) / 2, b, { size: 13, color: FIG.accent2 }),
    text(x2 + (c * s) / 2, y2 + d * s + 11, c, { size: 13, color: FIG.accent }),
    text(x2 + c * s + 11, y2 + (d * s) / 2, d, { size: 13, color: FIG.accent }),
    text(x2 + (e * s) / 2, y2 - 9, e, { size: 12, color: FIG.stroke }),
    text(x2 - 9, y2 + (f * s) / 2, f, { size: 12, color: FIG.stroke }),
  ];
  return svg(parts);
}

const rcRect: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 6, 14);
    const b = randInt(rng, 5, 12);
    const c = randInt(rng, 6, 14);
    const d = randInt(rng, 5, 12);
    const e = randInt(rng, 2, 6);
    const f = randInt(rng, 2, 6);
    if (e > a - 3 || e > c - 3 || f > b - 3 || f > d - 3) return null;
    return { a, b, c, d, e, f };
  });
  const { a, b, c, d, e, f } = v;
  const S1 = a * b;
  const S2 = c * d;
  const O = e * f;
  const fig = rectFig(a, b, c, d, e, f);
  if (rng() < 0.6) {
    const ans = S1 + S2 - O;
    return {
      text: `如图，两个长方形部分重叠（单位：厘米），重叠部分也是长方形。两个长方形一共盖住多大的面积？`,
      o: N(rng, ans, [S1 + S2, S1 + S2 - 2 * O, ans + e + f, (a + c - e) * (b + d - f)], ' 平方厘米'),
      explain: `两个长方形面积：${a} × ${b} = ${S1}，${c} × ${d} = ${S2}；重叠部分 ${e} × ${f} = ${O} 被算了两次。盖住的面积：${S1} + ${S2} − ${O} = ${ans} 平方厘米。`,
      verify: { kind: 'rcRect', p: [a, b, c, d, e, f, 0], ans },
      figure: fig,
    };
  }
  const ans = S1 + S2 - 2 * O;
  return {
    text: `如图，两个长方形部分重叠（单位：厘米），重叠部分也是长方形。两个长方形不重叠部分的面积一共是多少？`,
    o: N(rng, ans, [S1 + S2 - O, S1 + S2, ans + O + O / 2, ans - e - f], ' 平方厘米'),
    explain: `两个长方形面积：${a} × ${b} = ${S1}，${c} × ${d} = ${S2}；重叠部分 ${e} × ${f} = ${O}，它在两个长方形里各有一份。不重叠部分：${S1} + ${S2} − ${O} × 2 = ${ans} 平方厘米。`,
    verify: { kind: 'rcRect', p: [a, b, c, d, e, f, 1], ans },
    figure: fig,
  };
};

/* ═════════════ 逻辑推理 ═════════════ */

export const TL_NAMES = ['甲', '乙', '丙', '丁', '戊'] as const;
export const TL_PEOPLE = ['小王', '小张', '小李'] as const;

interface RoleSet {
  opts: string[];
  intro: string;
  neg: (p: string, r: string) => string;
  ask: (p: string) => string;
  askR: (r: string) => string;
  age: boolean;
}

export const TL_ROLESETS: RoleSet[] = [
  { opts: ['老师', '医生', '司机'], intro: '分别是老师、医生和司机', neg: (p, r) => `${p}不是${r}`, ask: (p) => `${p}是做什么的？`, askR: (r) => `谁是${r}？`, age: true },
  { opts: ['工人', '农民', '军人'], intro: '分别是工人、农民和军人', neg: (p, r) => `${p}不是${r}`, ask: (p) => `${p}是做什么的？`, askR: (r) => `谁是${r}？`, age: true },
  { opts: ['画家', '歌手', '作家'], intro: '分别是画家、歌手和作家', neg: (p, r) => `${p}不是${r}`, ask: (p) => `${p}是做什么的？`, askR: (r) => `谁是${r}？`, age: true },
  { opts: ['足球', '篮球', '排球'], intro: '分别喜欢足球、篮球、排球中的一种', neg: (p, r) => `${p}不喜欢${r}`, ask: (p) => `${p}喜欢什么球？`, askR: (r) => `谁喜欢${r}？`, age: false },
  { opts: ['红色', '黄色', '蓝色'], intro: '分别穿红、黄、蓝色的衣服', neg: (p, r) => `${p}没穿${r}衣服`, ask: (p) => `${p}穿什么颜色的衣服？`, askR: (r) => `谁穿${r}衣服？`, age: false },
];

function permsOf(n: number): number[][] {
  if (n === 0) return [[]];
  const out: number[][] = [];
  for (const p of permsOf(n - 1))
    for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), n - 1, ...p.slice(i)]);
  return out;
}
const PERMS: number[][][] = [0, 1, 2, 3, 4, 5].map(permsOf);

/* ── 对应关系 ── */

/** t 0: 人 a 不是 角色 b；2: 人 a 比 角色 b 年龄大；3: 人 a 比 角色 b 年龄小；4: 角色 a 比 角色 b 年龄大 */
interface MClue {
  t: number;
  a: number;
  b: number;
}

/** 返回所有可行的“人→角色”分配（存在某种年龄顺序使全部条件成立） */
function matchSolutions(clues: MClue[]): number[][] {
  const out: number[][] = [];
  for (const job of PERMS[3]) {
    const holder = [0, 0, 0];
    job.forEach((r, p) => (holder[r] = p));
    const ok = PERMS[3].some((age) =>
      clues.every((c) => {
        if (c.t === 0) return job[c.a] !== c.b;
        if (c.t === 2) return holder[c.b] !== c.a && age[c.a] > age[holder[c.b]];
        if (c.t === 3) return holder[c.b] !== c.a && age[c.a] < age[holder[c.b]];
        return age[holder[c.a]] > age[holder[c.b]];
      }),
    );
    if (ok) out.push(job);
  }
  return out;
}

function matchClueText(rs: RoleSet, c: MClue): string {
  const P = TL_PEOPLE;
  const R = rs.opts;
  if (c.t === 0) return rs.neg(P[c.a], R[c.b]);
  if (c.t === 2) return `${P[c.a]}比${R[c.b]}年龄大`;
  if (c.t === 3) return `${P[c.a]}比${R[c.b]}年龄小`;
  return `${R[c.a]}比${R[c.b]}年龄大`;
}

function genMatch(rng: Rng, withAge: boolean): { ctx: number; clues: MClue[]; job: number[] } {
  return until(() => {
    const ctx = withAge ? randInt(rng, 0, 2) : randInt(rng, 0, TL_ROLESETS.length - 1);
    const job = shuffle(rng, [0, 1, 2]);
    const age = shuffle(rng, [0, 1, 2]);
    const holder = [0, 0, 0];
    job.forEach((r, p) => (holder[r] = p));
    const pool: MClue[] = [];
    for (let p = 0; p < 3; p++)
      for (let r = 0; r < 3; r++) {
        if (job[p] !== r) pool.push({ t: 0, a: p, b: r });
        if (withAge && holder[r] !== p) pool.push({ t: age[p] > age[holder[r]] ? 2 : 3, a: p, b: r });
      }
    if (withAge)
      for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) if (r !== s && age[holder[r]] > age[holder[s]]) pool.push({ t: 4, a: r, b: s });
    const clues = shuffle(rng, pool).slice(0, withAge ? 3 : randInt(rng, 2, 3));
    if (withAge && clues.filter((c) => c.t !== 0).length < 2) return null;
    if (matchSolutions(clues).length !== 1) return null;
    // 去掉多余条件
    for (let i = 0; i < clues.length; i++) {
      const rest = clues.filter((_, j) => j !== i);
      if (matchSolutions(rest).length === 1) return null;
    }
    return { ctx, clues, job };
  });
}

function matchTpl(withAge: boolean): Tpl {
  return (rng) => {
    const { ctx, clues, job } = genMatch(rng, withAge);
    const rs = TL_ROLESETS[ctx];
    const P = TL_PEOPLE;
    const intro = `${P.join('、')}三人${rs.intro}。${clues.map((c) => matchClueText(rs, c)).join('，')}。`;
    const assign = P.map((p, i) => `${p}${rs.opts === TL_ROLESETS[3].opts ? '喜欢' : ctx === 4 ? '穿' : '是'}${rs.opts[job[i]]}`).join('，');
    const hints = clues
      .filter((c) => c.t === 2 || c.t === 3)
      .map((c) => `“${matchClueText(rs, c)}”说明${P[c.a]}不是${rs.opts[c.b]}`);
    const lead = hints.length > 0 ? `${hints.join('；')}。` : '把“不是”的条件逐一排除。';
    const tail = withAge ? '再结合年龄的大小关系，只有一种分配不矛盾：' : '每人只对应一种，排除后只剩一种分配：';
    if (rng() < 0.5) {
      const p = randInt(rng, 0, 2);
      return {
        text: `${intro}${rs.ask(P[p])}`,
        o: labelOpts(rng, rs.opts[job[p]], rs.opts.filter((r) => r !== rs.opts[job[p]]), ['无法确定']),
        explain: `${lead}${tail}${assign}。`,
        verify: { kind: 'tlMatch', p: [ctx, 0, p, ...clues.flatMap((c) => [c.t, c.a, c.b])], ans: job[p] },
      };
    }
    const r = randInt(rng, 0, 2);
    const who = job.indexOf(r);
    return {
      text: `${intro}${rs.askR(rs.opts[r])}`,
      o: labelOpts(rng, P[who], P.filter((x) => x !== P[who]), ['无法确定']),
      explain: `${lead}${tail}${assign}。`,
      verify: { kind: 'tlMatch', p: [ctx, 1, r, ...clues.flatMap((c) => [c.t, c.a, c.b])], ans: who },
    };
  };
}

/* ── 真假话 ── */

/** t 0: 是 x；1: 不是 x；2: 是 x 或 y */
interface LStmt {
  t: number;
  x: number;
  y: number;
}
function lTrue(s: LStmt, c: number): boolean {
  if (s.t === 0) return c === s.x;
  if (s.t === 1) return c !== s.x;
  return c === s.x || c === s.y;
}

const LIAR_CTX: { what: string; is: (w: string) => string; not: (w: string) => string; ask: string }[] = [
  { what: '打碎了花瓶', is: (w) => `是${w}打碎的`, not: (w) => `不是${w}打碎的`, ask: '花瓶是谁打碎的？' },
  { what: '吃了蛋糕', is: (w) => `是${w}吃的`, not: (w) => `不是${w}吃的`, ask: '蛋糕是谁吃的？' },
  { what: '得了第一名', is: (w) => `${w}得了第一`, not: (w) => `${w}没得第一`, ask: '谁得了第一名？' },
  { what: '做了好事', is: (w) => `是${w}做的`, not: (w) => `不是${w}做的`, ask: '好事是谁做的？' },
];

const TRUTH_TEXT = (n: number, k: number): string =>
  k === 1 ? '只有一人说了真话' : k === n - 1 ? '只有一人说了假话' : `只有${['', '一', '两', '三'][k]}人说了真话`;

function liarTpl(n: number, ks: number[], allowOr: boolean): Tpl {
  return (rng) => {
    const ctx = pick(rng, LIAR_CTX);
    const v = until(() => {
      const k = pick(rng, ks);
      const st: LStmt[] = [];
      for (let i = 0; i < n; i++) {
        const t = allowOr ? pick(rng, [0, 1, 1, 2]) : pick(rng, [0, 1]);
        const x = randInt(rng, 0, n - 1);
        let y = randInt(rng, 0, n - 2);
        if (y >= x) y++;
        st.push({ t, x, y: t === 2 ? y : 0 });
      }
      const counts = Array.from({ length: n }, (_, c) => st.filter((s) => lTrue(s, c)).length);
      const cands = counts.map((ct, c) => (ct === k ? c : -1)).filter((c) => c >= 0);
      if (cands.length !== 1) return null;
      return { k, st, counts, c: cands[0] };
    });
    const { k, st, counts, c } = v;
    const nm = TL_NAMES.slice(0, n);
    const say = (s: LStmt, i: number): string => {
      const w = (p: number) => (p === i ? '我' : nm[p]);
      if (s.t === 0) return ctx.is(w(s.x));
      if (s.t === 1) return ctx.not(w(s.x));
      return ctx.is(`${w(s.x)}或${w(s.y)}`);
    };
    const lines = st.map((s, i) => `${nm[i]}：${say(s, i)}。`).join('');
    const textQ = `${nm.join('、')}中有一人${ctx.what}。${lines}${TRUTH_TEXT(n, k)}，${ctx.ask}`;
    const tries = counts.map((ct, j) => `若是${nm[j]}，真话有 ${ct} 句`).join('；');
    return {
      text: textQ,
      o: labelOpts(rng, nm[c], nm.filter((x) => x !== nm[c]), ['无法确定']),
      explain: `逐个假设再数真话：${tries}。只有假设是${nm[c]}时恰好${k === n - 1 ? `只有一句假话` : `有 ${k} 句真话`}，所以是${nm[c]}。`,
      verify: { kind: 'tlLiar', p: [n, k, ...st.flatMap((s) => [s.t, s.x, s.y])], ans: c },
    };
  };
}

/* ── 排序与名次 ── */

/** t 0: a 在 b 前；1: a 不是第一；2: a 不是最后；3: a 紧跟在 b 后面；4: a 是第 b+1 名 */
interface RClue {
  t: number;
  a: number;
  b: number;
}

function rankOk(order: number[], cl: RClue): boolean {
  const pos = (p: number) => order.indexOf(p);
  const n = order.length;
  if (cl.t === 0) return pos(cl.a) < pos(cl.b);
  if (cl.t === 1) return pos(cl.a) !== 0;
  if (cl.t === 2) return pos(cl.a) !== n - 1;
  if (cl.t === 3) return pos(cl.a) === pos(cl.b) + 1;
  return pos(cl.a) === cl.b;
}

function rankSolutions(n: number, clues: RClue[]): number[][] {
  return PERMS[n].filter((o) => clues.every((c) => rankOk(o, c)));
}

function genRank(rng: Rng, n: number, types: number[]): { order: number[]; clues: RClue[] } {
  return until(() => {
    const order = shuffle(rng, Array.from({ length: n }, (_, i) => i));
    const pos = (p: number) => order.indexOf(p);
    const pool: RClue[] = [];
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) if (a !== b && types.includes(0) && pos(a) < pos(b)) pool.push({ t: 0, a, b });
      if (types.includes(1) && pos(a) !== 0) pool.push({ t: 1, a, b: 0 });
      if (types.includes(2) && pos(a) !== n - 1) pool.push({ t: 2, a, b: 0 });
      if (types.includes(3) && pos(a) > 0) pool.push({ t: 3, a, b: order[pos(a) - 1] });
      if (types.includes(4)) pool.push({ t: 4, a, b: pos(a) });
    }
    const clues: RClue[] = [];
    let fixed = 0;
    for (const c of shuffle(rng, pool)) {
      if (c.t === 4 && fixed >= 1) continue;
      clues.push(c);
      if (c.t === 4) fixed++;
      if (rankSolutions(n, clues).length === 1) break;
    }
    if (rankSolutions(n, clues).length !== 1) return null;
    for (let i = clues.length - 1; i >= 0; i--) {
      const rest = clues.filter((_, j) => j !== i);
      if (rankSolutions(n, rest).length === 1) clues.splice(i, 1);
    }
    if (types.length > 1 && new Set(clues.map((c) => c.t)).size < 2) return null;
    return { order, clues };
  });
}

const RANK_CMP: { intro: string; gt: (a: string, b: string) => string; lt: (a: string, b: string) => string; top: string; bot: string; ord: string }[] = [
  { intro: '比身高', gt: (a, b) => `${a}比${b}高`, lt: (a, b) => `${a}比${b}矮`, top: '谁最高？', bot: '谁最矮？', ord: '从高到矮' },
  { intro: '赛跑', gt: (a, b) => `${a}比${b}先到`, lt: (a, b) => `${a}比${b}后到`, top: '谁跑了第一？', bot: '谁跑了最后？', ord: '从先到后' },
  { intro: '比体重', gt: (a, b) => `${a}比${b}重`, lt: (a, b) => `${a}比${b}轻`, top: '谁最重？', bot: '谁最轻？', ord: '从重到轻' },
];

const tlRank: Tpl = (rng) => {
  const n = randInt(rng, 3, 4);
  const cx = pick(rng, RANK_CMP);
  const { order, clues } = genRank(rng, n, [0]);
  const nm = TL_NAMES.slice(0, n);
  const ct = clues.map((c) => (rng() < 0.5 ? cx.gt(nm[c.a], nm[c.b]) : cx.lt(nm[c.b], nm[c.a])));
  const top = rng() < 0.5;
  const ansP = top ? order[0] : order[n - 1];
  const seq = order.map((p) => nm[p]).join('、');
  return {
    text: `${nm.join('、')}${cx.intro}：${ct.join('，')}。${top ? cx.top : cx.bot}`,
    o: labelOpts(rng, nm[ansP], nm.filter((x) => x !== nm[ansP]), ['无法确定']),
    explain: `把条件串起来，${cx.ord}依次是：${seq}。所以答案是${nm[ansP]}。`,
    verify: { kind: 'tlRank', p: [n, top ? 0 : n - 1, ...clues.flatMap((c) => [c.t, c.a, c.b])], ans: ansP },
  };
};

const RACE_CTX: {
  intro: string;
  before: (a: string, b: string) => string;
  nf: (a: string) => string;
  nl: (a: string) => string;
  next: (a: string, b: string) => string;
  is: (a: string, k: number) => string;
}[] = [
  { intro: '赛跑，名次各不相同', before: (a, b) => `${a}比${b}先到`, nf: (a) => `${a}不是第一`, nl: (a) => `${a}不是最后`, next: (a, b) => `${a}紧跟在${b}后面到`, is: (a, k) => `${a}是第${k}名` },
  { intro: '考试，名次各不相同', before: (a, b) => `${a}比${b}考得好`, nf: (a) => `${a}不是第一`, nl: (a) => `${a}不是最后`, next: (a, b) => `${a}的名次紧接在${b}后面`, is: (a, k) => `${a}是第${k}名` },
];

export function orderCode(order: number[]): number {
  return order.reduce((s, p) => s * 10 + p + 1, 0);
}

const tlRace: Tpl = (rng) => {
  const cx = pick(rng, RACE_CTX);
  const v = until(() => {
    const n = randInt(rng, 4, 5);
    const g = genRank(rng, n, [0, 1, 2, 3, 4]);
    const nm = TL_NAMES.slice(0, n);
    const ct = g.clues.map((c) =>
      c.t === 0 ? cx.before(nm[c.a], nm[c.b]) : c.t === 1 ? cx.nf(nm[c.a]) : c.t === 2 ? cx.nl(nm[c.a]) : c.t === 3 ? cx.next(nm[c.a], nm[c.b]) : cx.is(nm[c.a], c.b + 1),
    );
    const head = `${nm.join('、')}${cx.intro}。${ct.join('，')}。`;
    if (head.length > 74) return null;
    return { n, ...g, nm, head, ct };
  });
  const { n, order, clues, nm, head, ct } = v;
  const lab = (o: number[]) => o.map((p) => nm[p]).join('、');
  const seq = lab(order);
  const near = shuffle(
    rng,
    PERMS[n].filter((o) => clues.filter((c) => !rankOk(o, c)).length === 1),
  ).map(lab);
  const others = shuffle(rng, PERMS[n].map(lab).filter((s) => s !== seq));
  const cite = ct.slice(0, 2).map((s) => `“${s}”`).join('、');
  if (n === 5 && rng() < 0.5) {
    const k = randInt(rng, 1, 3);
    const ansP = order[k];
    return {
      text: `${head}第${k + 1}名是谁？`,
      o: labelOpts(rng, nm[ansP], shuffle(rng, nm.filter((x) => x !== nm[ansP])), []),
      explain: `从${cite}等条件出发逐步定位，唯一满足全部条件的名次是：${seq}。所以第${k + 1}名是${nm[ansP]}。`,
      verify: { kind: 'tlRank', p: [n, k, ...clues.flatMap((c) => [c.t, c.a, c.b])], ans: ansP },
    };
  }
  return {
    text: `${head}名次从第一到最后依次是？`,
    o: labelOpts(rng, seq, near, others),
    explain: `从${cite}等条件出发逐步定位，再用先后关系排其余的人。唯一满足全部条件的名次是：${seq}。`,
    verify: { kind: 'tlRank', p: [n, -1, ...clues.flatMap((c) => [c.t, c.a, c.b])], ans: orderCode(order) },
  };
};

/* ── 比赛场次与得分 ── */

const tlGames: Tpl = (rng) => {
  const mode = randInt(rng, 0, 3);
  if (mode === 3) {
    const n = randInt(rng, 6, 40);
    return {
      text: `${n} 名选手参加淘汰赛，每场比赛淘汰一人，直到产生冠军。一共要赛多少场？`,
      o: N(rng, n - 1, [n, n / 2, n - 2, n + 1], ' 场'),
      explain: `每赛一场淘汰 1 人，最后只剩冠军，要淘汰 ${n} − 1 = ${n - 1} 人，所以要赛 ${n - 1} 场。`,
      verify: { kind: 'tlGames', p: [n, 3], ans: n - 1 },
    };
  }
  const n = randInt(rng, 4, 12);
  const c2 = (n * (n - 1)) / 2;
  if (mode === 1) {
    return {
      text: `${n} 支球队比赛，每两队之间都要在主场、客场各赛一场。一共要赛多少场？`,
      o: N(rng, 2 * c2, [c2, n * n, n * (n + 1), 2 * c2 - n], ' 场'),
      explain: `每支队都要在自己的主场和其余 ${n - 1} 支队各赛一场：${n} × ${n - 1} = ${2 * c2} 场（客场比赛就是别人的主场，已包含在内）。`,
      verify: { kind: 'tlGames', p: [n, 1], ans: 2 * c2 },
    };
  }
  const shake = mode === 2;
  return {
    text: shake ? `${n} 个同学见面，每两人都握一次手，一共握多少次手？` : `${n} 支球队进行单循环赛（每两队之间都赛一场），一共要赛多少场？`,
    o: N(rng, c2, [n * (n - 1), c2 + n, n * n, (n - 1) * (n - 1)], shake ? ' 次' : ' 场'),
    explain: `每${shake ? '人要和其余' : '队要和其余'} ${n - 1} ${shake ? '人' : '队'}各${shake ? '握一次' : '赛一场'}，${n} × ${n - 1} = ${n * (n - 1)}，但每${shake ? '次握手' : '场'}都被算了两次：${n * (n - 1)} ÷ 2 = ${c2} ${shake ? '次' : '场'}。`,
    verify: { kind: 'tlGames', p: [n, shake ? 2 : 0], ans: c2 },
  };
};

const tlWins: Tpl = (rng) => {
  const v = until(() => {
    const n = randInt(rng, 4, 5);
    const w = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) w[rng() < 0.5 ? i : j]++;
    const last = w[n - 1];
    if (last < 1 || last > n - 2) return null;
    return { n, w };
  });
  const { n, w } = v;
  const nm = TL_NAMES.slice(0, n);
  const m = (n * (n - 1)) / 2;
  const given = w.slice(0, n - 1);
  const x = w[n - 1];
  const head = `${nm.join('、')}${n === 4 ? '四' : '五'}人进行乒乓球单循环赛（每两人赛一场，没有平局）。${given.map((g, i) => `${nm[i]}胜 ${g} 场`).join('，')}。`;
  const base = `每场比赛产生 1 个胜场，共赛 ${n} × ${n - 1} ÷ 2 = ${m} 场，所以胜场总数是 ${m}。${nm[n - 1]}胜：${m} − (${given.join(' + ')}) = ${x} 场`;
  if (rng() < 0.5)
    return {
      text: `${head}${nm[n - 1]}胜了几场？`,
      o: N(rng, x, [n - 1 - x, x + 1, m - sum(given) + 1, x + 2], ' 场'),
      explain: `${base}。`,
      verify: { kind: 'tlWins', p: [n, 0, ...given], ans: x },
    };
  const l = n - 1 - x;
  return {
    text: `${head}${nm[n - 1]}输了几场？`,
    o: N(rng, l, [x, l + 1, n - x, l + 2], ' 场'),
    explain: `${base}。${nm[n - 1]}共赛 ${n - 1} 场，输了 ${n - 1} − ${x} = ${l} 场。`,
    verify: { kind: 'tlWins', p: [n, 1, ...given], ans: l },
  };
};

const tlDraws: Tpl = (rng) => {
  if (rng() < 0.5) {
    const n = randInt(rng, 4, 8);
    const m = (n * (n - 1)) / 2;
    const d = randInt(rng, 1, m - 1);
    const P = 3 * m - d;
    return {
      text: `${n} 支球队进行单循环赛，胜一场得 3 分，平一场两队各得 1 分，负一场得 0 分。最后各队总分之和是 ${P} 分。共有几场平局？`,
      o: N(rng, d, [m - d, P - 2 * m, d + 1, m - (P - 2 * m) + 1, d + 2], ' 场'),
      explain: `共赛 ${n} × ${n - 1} ÷ 2 = ${m} 场。分出胜负的一场产生 3 分，平局只产生 2 分。若全分胜负共 ${3 * m} 分，实际少 ${3 * m} − ${P} = ${d} 分，所以有 ${d} 场平局。`,
      verify: { kind: 'tlDraws', p: [n, P], ans: d },
    };
  }
  const v = until(() => {
    const w = randInt(rng, 1, 8);
    const dr = randInt(rng, 1, 6);
    const z = randInt(rng, 0, 4);
    return { w, dr, z, g: w + dr + z, y: 3 * w + dr };
  });
  const { w, dr, z, g, y } = v;
  const nz = g - z;
  return {
    text: `足球赛胜一场得 3 分，平一场得 1 分，负一场得 0 分。某队踢了 ${g} 场，输了 ${z} 场，共得 ${y} 分。这个队胜了几场？`,
    o: N(rng, w, [dr, Math.floor(y / 3), w + 1, w - 1, nz - w + 1], ' 场'),
    explain: `没输的 ${g} − ${z} = ${nz} 场不是胜就是平。假设都是平局，得 ${nz} 分，比实际少 ${y} − ${nz} = ${y - nz} 分；每把一场平换成胜多得 2 分，胜：${y - nz} ÷ 2 = ${w} 场。`,
    verify: { kind: 'tlTeam', p: [g, z, y], ans: w },
  };
};

/* ═════════════ 角度与多边形 ═════════════ */

type Pt = [number, number];
const RAD = Math.PI / 180;

/** 把数学坐标（y 向上）的点等比缩放进框内，返回屏幕坐标 */
function fitPts(pts: Pt[], box: [number, number, number, number] = [34, 22, 226, 146]): Pt[] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const [x0, y0, x1, y1] = box;
  const s = Math.min((x1 - x0) / (maxX - minX || 1), (y1 - y0) / (maxY - minY || 1));
  const cx = (x0 + x1) / 2 - ((minX + maxX) / 2) * s;
  const cy = (y0 + y1) / 2 + ((minY + maxY) / 2) * s;
  return pts.map((p) => [cx + p[0] * s, cy - p[1] * s]);
}

function dirOf(p: Pt, q: Pt): number {
  return Math.atan2(-(q[1] - p[1]), q[0] - p[0]) / RAD;
}

/** 在顶点 v 处标出 v→p1 与 v→p2 之间的角（取小于 180° 的那一侧） */
function angleMark(v: Pt, p1: Pt, p2: Pt, label: string, r = 15): string[] {
  const d1 = dirOf(v, p1);
  const d2 = dirOf(v, p2);
  let diff = (((d2 - d1) % 360) + 360) % 360;
  let a0 = d1;
  if (diff > 180) {
    a0 = d2;
    diff = 360 - diff;
  }
  const q = label === '?';
  const col = q ? FIG.accent : FIG.accent2;
  const mid = (a0 + diff / 2) * RAD;
  const dist = Math.min(58, 12 / Math.sin((diff / 2) * RAD) + 10);
  const out: string[] = [];
  if (Math.abs(diff - 90) < 0.5 && !q && label === '') {
    const u1: Pt = [Math.cos(d1 * RAD), -Math.sin(d1 * RAD)];
    const u2: Pt = [Math.cos(d2 * RAD), -Math.sin(d2 * RAD)];
    out.push(rightAngle(v[0], v[1], u1[0], u1[1], u2[0], u2[1], 10));
    return out;
  }
  out.push(arc(v[0], v[1], r, a0, a0 + diff, { stroke: col, width: 1.6 }));
  if (label) out.push(text(v[0] + dist * Math.cos(mid), v[1] - dist * Math.sin(mid), label, { size: q ? 15 : 13, color: col, bold: q }));
  return out;
}

/** 顶点名称标签：从参考点 c 向外偏移 */
function vName(p: Pt, c: Pt, s: string, off = 13): string {
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  const len = Math.hypot(dx, dy) || 1;
  return text(p[0] + (dx / len) * off, p[1] + (dy / len) * off, s, { size: 14, color: FIG.stroke, bold: true });
}

interface TriSpec {
  A: number;
  B: number;
  /** ∠A、∠B、∠C 处的标签，'' 表示不标 */
  la: string;
  lb: string;
  lc: string;
  names?: boolean;
  /** 延长 BC 到 D，并在 ∠ACD 处标注 */
  ext?: string;
  ticks?: boolean;
  /** 直角顶点（画直角标记） */
  right?: 'A' | 'B' | 'C';
}

function triFig(s: TriSpec): string {
  const C = 180 - s.A - s.B;
  const t = Math.sin(C * RAD) / Math.sin(s.A * RAD);
  const mB: Pt = [0, 0];
  const mC: Pt = [1, 0];
  const mA: Pt = [t * Math.cos(s.B * RAD), t * Math.sin(s.B * RAD)];
  const raw: Pt[] = [mA, mB, mC];
  if (s.ext !== undefined) raw.push([1.55, 0]);
  const [pA, pB, pC, pD] = fitPts(raw);
  const cen: Pt = [(pA[0] + pB[0] + pC[0]) / 3, (pA[1] + pB[1] + pC[1]) / 3];
  const parts: string[] = [polygon([pA, pB, pC], { fill: FIG.fill })];
  if (pD) parts.push(line(pC[0], pC[1], pD[0], pD[1]));
  const mark = (v: Pt, p1: Pt, p2: Pt, lab: string, isRight: boolean) => {
    if (isRight) {
      const u = (q: Pt): Pt => {
        const l = Math.hypot(q[0] - v[0], q[1] - v[1]);
        return [(q[0] - v[0]) / l, (q[1] - v[1]) / l];
      };
      const [ux, uy] = u(p1);
      const [wx, wy] = u(p2);
      parts.push(rightAngle(v[0], v[1], ux, uy, wx, wy, 10));
    } else if (lab) parts.push(...angleMark(v, p1, p2, lab));
  };
  mark(pA, pB, pC, s.la, s.right === 'A');
  mark(pB, pA, pC, s.lb, s.right === 'B');
  mark(pC, pA, pB, s.lc, s.right === 'C');
  if (pD && s.ext) parts.push(...angleMark(pC, pA, pD, s.ext, 13));
  if (s.ticks) {
    for (const q of [pB, pC]) {
      const mx = (pA[0] + q[0]) / 2;
      const my = (pA[1] + q[1]) / 2;
      const dx = q[0] - pA[0];
      const dy = q[1] - pA[1];
      const l = Math.hypot(dx, dy);
      const nx = -dy / l;
      const ny = dx / l;
      parts.push(line(mx - nx * 6, my - ny * 6, mx + nx * 6, my + ny * 6, { stroke: FIG.accent, width: 2 }));
    }
  }
  if (s.names !== false) {
    parts.push(vName(pA, cen, 'A'), vName(pB, cen, 'B'), pD ? text(pC[0] - 4, pC[1] + 15, 'C', { size: 14, bold: true }) : vName(pC, cen, 'C'));
    if (pD) parts.push(text(pD[0] + 4, pD[1] + 13, 'D', { size: 14, bold: true }));
  }
  return svg(parts);
}

/** 直线 + 射线 / 两直线相交 / 一点出发三条射线 */
function rayFig(dirs: number[], fullLines: boolean, labels: { a: number; b: number; s: string }[]): string {
  const O: Pt = [130, fullLines || dirs.length === 3 ? 86 : 122];
  const end = (d: number, r: number): Pt => [O[0] + r * Math.cos(d * RAD), O[1] - r * Math.sin(d * RAD)];
  const parts: string[] = [];
  if (fullLines) {
    for (const d of dirs) {
      const c = Math.abs(Math.cos(d * RAD));
      const s = Math.abs(Math.sin(d * RAD));
      const len = Math.min(c > 0.01 ? 112 / c : 999, s > 0.01 ? 76 / s : 999);
      const p = end(d, len);
      const q = end(d + 180, len);
      parts.push(line(q[0], q[1], p[0], p[1]));
    }
  } else if (dirs.length === 3) {
    for (const d of dirs) {
      const p = end(d, 78);
      parts.push(line(O[0], O[1], p[0], p[1]));
    }
  } else {
    parts.push(line(18, O[1], 242, O[1]));
    const p = end(dirs[0], 104);
    parts.push(line(O[0], O[1], p[0], p[1]));
  }
  parts.push(dot(O[0], O[1], 3));
  labels.forEach((l, i) => {
    const diff = (((l.b - l.a) % 360) + 360) % 360;
    const mid = (l.a + diff / 2) * RAD;
    const q = l.s === '?';
    const col = [FIG.accent2, FIG.accent, '#9dff8c'][i % 3];
    const r = 13 + 7 * i;
    parts.push(arc(O[0], O[1], r, l.a + 3, l.a + diff - 3, { stroke: col, width: 1.8 }));
    const dist = Math.max(r + 13, Math.min(44, 11 / Math.sin(Math.min(90, diff / 2) * RAD) + 14));
    parts.push(text(O[0] + dist * Math.cos(mid), O[1] - dist * Math.sin(mid), l.s, { size: q ? 16 : 14, color: col, bold: true }));
  });
  return svg(parts);
}

const jdLine: Tpl = (rng) => {
  if (rng() < 0.5) {
    const x = until(() => {
      const v = randInt(rng, 30, 150);
      return Math.abs(v - 90) < 10 ? null : v;
    });
    const ans = 180 - x;
    return {
      text: `如图，横线是一条直线，∠1 = ${x}°。∠2 是多少度？`,
      o: N(rng, ans, [360 - x, 90 - x, x, ans + 10], '°'),
      explain: `∠1 和 ∠2 合起来是一个平角，平角是 180°。∠2 = 180° − ${x}° = ${ans}°。`,
      verify: { kind: 'angLine', p: [0, x], ans },
      figure: rayFig([x], false, [
        { a: 0, b: x, s: '1' },
        { a: x, b: 180, s: '2' },
      ]),
    };
  }
  const x = until(() => {
    const v = randInt(rng, 35, 145);
    return Math.abs(v - 90) < 8 ? null : v;
  });
  const askOpp = rng() < 0.5;
  const ans = askOpp ? x : 180 - x;
  return {
    text: `如图，两条直线相交，∠1 = ${x}°。∠${askOpp ? 2 : 3} 是多少度？`,
    o: N(rng, ans, [askOpp ? 180 - x : x, 360 - x, Math.abs(90 - x), ans + 10], '°'),
    explain: askOpp
      ? `∠1 和 ∠2 是对顶角，对顶角相等，所以 ∠2 = ${x}°。`
      : `∠1 和 ∠3 合起来是一个平角（180°），所以 ∠3 = 180° − ${x}° = ${ans}°。`,
    verify: { kind: 'angLine', p: [askOpp ? 1 : 2, x], ans },
    figure: rayFig([0, x], true, [
      { a: 0, b: x, s: '1' },
      { a: 180, b: 180 + x, s: '2' },
      { a: x, b: 180, s: '3' },
    ]),
  };
};

const jdPoint: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 70, 160);
    const b = randInt(rng, 70, 160);
    const c = 360 - a - b;
    return c >= 70 && c <= 160 && a !== b ? { a, b, c } : null;
  });
  const { a, b, c } = v;
  const d0 = 90;
  return {
    text: `如图，三条射线从同一点出发，∠1 = ${a}°，∠2 = ${b}°。∠3 是多少度？`,
    o: N(rng, c, [360 - a, 360 - b, a + b, 180 - Math.abs(a - b), c + 10], '°'),
    explain: `围绕一点一周是 360°。∠3 = 360° − ${a}° − ${b}° = ${c}°。`,
    verify: { kind: 'angPoint', p: [a, b], ans: c },
    figure: rayFig([d0, d0 + a, d0 + a + b], false, [
      { a: d0, b: d0 + a, s: '1' },
      { a: d0 + a, b: d0 + a + b, s: '2' },
      { a: d0 + a + b, b: d0 + 360, s: '3' },
    ]),
  };
};

const jdTriangle: Tpl = (rng) => {
  if (rng() < 0.6) {
    const v = until(() => {
      const a = randInt(rng, 25, 110);
      const b = randInt(rng, 25, 110);
      const c = 180 - a - b;
      return c >= 25 && a !== b ? { a, b, c } : null;
    });
    const { a, b, c } = v;
    return {
      text: `如图，三角形 ABC 中，∠A = ${a}°，∠B = ${b}°。∠C 是多少度？`,
      o: N(rng, c, [180 - a, 180 - b, a + b, 360 - a - b, c + 10], '°'),
      explain: `三角形的内角和是 180°。∠C = 180° − ${a}° − ${b}° = ${c}°。`,
      verify: { kind: 'angTri', p: [a, b], ans: c },
      figure: triFig({ A: a, B: b, la: `${a}°`, lb: `${b}°`, lc: '?' }),
    };
  }
  const x = randInt(rng, 20, 70);
  const ans = 90 - x;
  if (ans === x) return jdTriangle(rng);
  return {
    text: `如图，直角三角形中一个锐角是 ${x}°，另一个锐角是多少度？`,
    o: N(rng, ans, [180 - x, 90 + x, x, ans + 10], '°'),
    explain: `直角是 90°，两个锐角的和是 180° − 90° = 90°。另一个锐角：90° − ${x}° = ${ans}°。`,
    verify: { kind: 'angTri', p: [90, x], ans },
    figure: triFig({ A: 90, B: x, la: '', lb: `${x}°`, lc: '?', right: 'A', names: false }),
  };
};

const jdIso: Tpl = (rng) => {
  if (rng() < 0.5) {
    const x = randInt(rng, 10, 50) * 2;
    const ans = (180 - x) / 2;
    return {
      text: `如图，等腰三角形 ABC 中 AB = AC，∠A = ${x}°。∠B 是多少度？`,
      o: N(rng, ans, [180 - x, x, 180 - 2 * x, (180 + x) / 2], '°'),
      explain: `等腰三角形两个底角相等。∠B = ∠C = (180° − ${x}°) ÷ 2 = ${ans}°。`,
      verify: { kind: 'angIso', p: [0, x], ans },
      figure: triFig({ A: x, B: ans, la: `${x}°`, lb: '?', lc: '', ticks: true }),
    };
  }
  const y = randInt(rng, 40, 80);
  const ans = 180 - 2 * y;
  return {
    text: `如图，等腰三角形 ABC 中 AB = AC，∠B = ${y}°。顶角 ∠A 是多少度？`,
    o: N(rng, ans, [180 - y, (180 - y) / 2, 2 * y, 90 - y, ans + 10], '°'),
    explain: `等腰三角形两个底角相等，∠C = ∠B = ${y}°。∠A = 180° − ${y}° × 2 = ${ans}°。`,
    verify: { kind: 'angIso', p: [1, y], ans },
    figure: triFig({ A: ans, B: y, la: '?', lb: `${y}°`, lc: '', ticks: true }),
  };
};

const jdExt: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 30, 100);
    const b = randInt(rng, 25, 80);
    return a + b <= 150 ? { a, b, e: a + b } : null;
  });
  const { a, b, e } = v;
  if (rng() < 0.5)
    return {
      text: `如图，三角形 ABC 中 ∠A = ${a}°，∠B = ${b}°，延长 BC 到 D。∠ACD 是多少度？`,
      o: N(rng, e, [180 - a - b, 180 - a, 180 - b, e + 10], '°'),
      explain: `∠ACB = 180° − ${a}° − ${b}° = ${180 - e}°，∠ACD 和 ∠ACB 组成平角：180° − ${180 - e}° = ${e}°。也就是三角形的外角等于不相邻的两个内角之和。`,
      verify: { kind: 'angExt', p: [0, a, b], ans: e },
      figure: triFig({ A: a, B: b, la: `${a}°`, lb: `${b}°`, lc: '', ext: '?' }),
    };
  return {
    text: `如图，延长三角形 ABC 的边 BC 到 D，∠ACD = ${e}°，∠A = ${a}°。∠B 是多少度？`,
    o: N(rng, b, [180 - e, e + a, 180 - a, b + 10], '°'),
    explain: `三角形的外角等于不相邻的两个内角之和：∠ACD = ∠A + ∠B。∠B = ${e}° − ${a}° = ${b}°。`,
    verify: { kind: 'angExt', p: [1, a, e], ans: b },
    figure: triFig({ A: a, B: b, la: `${a}°`, lb: '?', lc: '', ext: `${e}°` }),
  };
};

const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];

function polyFig(n: number): string {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (-90 + 180 / n + (360 * i) / n) * RAD;
    pts.push([130 + 68 * Math.cos(a), 86 - 68 * Math.sin(a)]);
  }
  const parts: string[] = [polygon(pts, { fill: FIG.fill })];
  // 在最下方的顶点标“?”
  let bi = 0;
  pts.forEach((p, i) => {
    if (p[1] > pts[bi][1] + 0.01) bi = i;
  });
  parts.push(...angleMark(pts[bi], pts[(bi + n - 1) % n], pts[(bi + 1) % n], '?', 14));
  return svg(parts);
}

const jdPolySum: Tpl = (rng) => {
  if (rng() < 0.5) {
    const n = randInt(rng, 5, 12);
    const ans = (n - 2) * 180;
    return {
      text: `一个${CN[n]}边形的内角和是多少度？`,
      o: N(rng, ans, [n * 180, (n - 1) * 180, (n - 3) * 180, (n - 2) * 90], '°'),
      explain: `从一个顶点出发画对角线，可以把${CN[n]}边形分成 ${n} − 2 = ${n - 2} 个三角形。内角和 = ${n - 2} × 180° = ${ans}°。`,
      verify: { kind: 'polySum', p: [n], ans },
    };
  }
  const n = pick(rng, [5, 6, 8, 9, 10, 12]);
  const S = (n - 2) * 180;
  const ans = S / n;
  return {
    text: `如图，正${CN[n]}边形的每个内角是多少度？`,
    o: N(rng, ans, [360 / n, S, 180 - 180 / n, ans + 10, ans - 10], '°'),
    explain: `内角和 = (${n} − 2) × 180° = ${S}°，${n} 个内角都相等：${S}° ÷ ${n} = ${ans}°。`,
    verify: { kind: 'polyEach', p: [n], ans },
    figure: polyFig(n),
  };
};

const jdDiag: Tpl = (rng) => {
  const n = randInt(rng, 5, 15);
  const ans = (n * (n - 3)) / 2;
  return {
    text: `一个${CN[n]}边形一共有多少条对角线？`,
    o: N(rng, ans, [n * (n - 3), (n * (n - 1)) / 2, n - 3, (n * (n - 2)) / 2, ans + n], ' 条'),
    explain: `每个顶点能和不相邻的 ${n} − 3 = ${n - 3} 个顶点连对角线，${n} × ${n - 3} = ${n * (n - 3)}，每条对角线被两端各算了一次：${n * (n - 3)} ÷ 2 = ${ans} 条。`,
    verify: { kind: 'polyDiag', p: [n], ans },
  };
};

const jdIsoExt: Tpl = (rng) => {
  if (rng() < 0.5) {
    const x = randInt(rng, 10, 50) * 2;
    const base = (180 - x) / 2;
    const ans = 180 - base;
    return {
      text: `如图，三角形 ABC 中 AB = AC，∠A = ${x}°，延长 BC 到 D。∠ACD 是多少度？`,
      o: N(rng, ans, [base, 180 - x, 90 + x, 2 * x, ans + 10], '°'),
      explain: `AB = AC，所以 ∠B = ∠ACB = (180° − ${x}°) ÷ 2 = ${base}°。∠ACD 与 ∠ACB 组成平角：180° − ${base}° = ${ans}°。`,
      verify: { kind: 'angIsoExt', p: [0, x], ans },
      figure: triFig({ A: x, B: base, la: `${x}°`, lb: '', lc: '', ext: '?', ticks: true }),
    };
  }
  const e = randInt(rng, 100, 140);
  const base = 180 - e;
  const ans = 180 - 2 * base;
  return {
    text: `如图，三角形 ABC 中 AB = AC，延长 BC 到 D，∠ACD = ${e}°。∠A 是多少度？`,
    o: N(rng, ans, [base, 2 * base, e - 90, 180 - base, ans + 10], '°'),
    explain: `∠ACB = 180° − ${e}° = ${base}°，等腰三角形两底角相等，∠B = ${base}°。∠A = 180° − ${base}° × 2 = ${ans}°。`,
    verify: { kind: 'angIsoExt', p: [1, e], ans },
    figure: triFig({ A: ans, B: base, la: '?', lb: '', lc: '', ext: `${e}°`, ticks: true }),
  };
};

const jdPolyRev: Tpl = (rng) => {
  const mode = randInt(rng, 0, 2);
  if (mode === 0) {
    const n = randInt(rng, 5, 14);
    const S = (n - 2) * 180;
    return {
      text: `一个多边形的内角和是 ${S}°，它有几条边？`,
      o: N(rng, n, [n - 2, n - 1, n + 2, n + 1], ' 条'),
      explain: `内角和 = (边数 − 2) × 180°。${S}° ÷ 180° = ${n - 2}，边数 = ${n - 2} + 2 = ${n}。`,
      verify: { kind: 'polyRev', p: [0, S], ans: n },
    };
  }
  if (mode === 1) {
    const n = pick(rng, [5, 6, 8, 9, 10, 12, 15, 18, 20]);
    const e = 180 - 360 / n;
    return {
      text: `一个正多边形的每个内角都是 ${e}°，它有几条边？`,
      o: N(rng, n, [180 / (180 - e), n - 2, n + 2, n - 1, n + 1], ' 条'),
      explain: `每个外角是 180° − ${e}° = ${180 - e}°，多边形的外角和是 360°，边数 = 360° ÷ ${180 - e}° = ${n}。`,
      verify: { kind: 'polyRev', p: [1, e], ans: n },
    };
  }
  const n = randInt(rng, 5, 12);
  const X = (n - 2) * 180 - 360;
  return {
    text: `一个多边形的内角和比 360° 多 ${X}°，它有几条边？`,
    o: N(rng, n, [n - 2, n - 4, n + 1, n - 1], ' 条'),
    explain: `内角和 = 360° + ${X}° = ${X + 360}°。${X + 360}° ÷ 180° = ${n - 2}，边数 = ${n - 2} + 2 = ${n}。`,
    verify: { kind: 'polyRev', p: [2, X], ans: n },
  };
};

const jdTriDiff: Tpl = (rng) => {
  if (rng() < 0.5) {
    const v = until(() => {
      const B = randInt(rng, 25, 70);
      const d = randInt(rng, 6, 50);
      const A = B + d;
      const c = 180 - A - B;
      return c >= 25 && A <= 125 ? { A, B, d, c } : null;
    });
    const { A, B, d, c } = v;
    const s = A + B;
    return {
      text: `如图，三角形 ABC 中 ∠C = ${c}°，∠A 比 ∠B 大 ${d}°。∠A 是多少度？`,
      o: N(rng, A, [B, s / 2, s - d, A + d, (180 - d) / 2], '°'),
      explain: `∠A + ∠B = 180° − ${c}° = ${s}°。和差问题：∠A = (${s}° + ${d}°) ÷ 2 = ${A}°。`,
      verify: { kind: 'angTriDiff', p: [0, c, d], ans: A },
      figure: triFig({ A, B, la: '?', lb: '', lc: `${c}°` }),
    };
  }
  const v = until(() => {
    const k = randInt(rng, 2, 4);
    const B = randInt(rng, 12, 40);
    const A = k * B;
    const c = 180 - A - B;
    return c >= 25 && A <= 125 ? { k, A, B, c } : null;
  });
  const { k, A, B, c } = v;
  const s = A + B;
  return {
    text: `如图，三角形 ABC 中 ∠C = ${c}°，∠A 是 ∠B 的 ${k} 倍。∠A 是多少度？`,
    o: N(rng, A, [B, s / k, s - B + k, (180 / (k + 1)) * k, A + 10], '°'),
    explain: `∠A + ∠B = 180° − ${c}° = ${s}°，正好是 ∠B 的 ${k} + 1 = ${k + 1} 倍。∠B = ${s}° ÷ ${k + 1} = ${B}°，∠A = ${B}° × ${k} = ${A}°。`,
    verify: { kind: 'angTriK', p: [c, k], ans: A },
    figure: triFig({ A, B, la: '?', lb: '', lc: `${c}°` }),
  };
};

/* ═════════════ 最值与数字问题 ═════════════ */

const zzProd: Tpl = (rng) => {
  const S = randInt(rng, 10, 40);
  const h = Math.floor(S / 2);
  const ans = h * (S - h);
  return {
    text: `两个非零自然数的和是 ${S}，它们的积最大是多少？`,
    o: N(rng, ans, [(h - 1) * (S - h + 1), (h - 2) * (S - h + 2), S - 1, 2 * S, ans + h]),
    explain: `和一定时，两个数越接近，积越大。${S % 2 === 0 ? `${S} = ${h} + ${h}，积最大是 ${h} × ${h}` : `${S} = ${h} + ${S - h}，积最大是 ${h} × ${S - h}`} = ${ans}。`,
    verify: { kind: 'zzProd', p: [S], ans },
  };
};

function numOf(ds: number[]): number {
  return ds.reduce((s, d) => s * 10 + d, 0);
}

const zzMake: Tpl = (rng) => {
  const v = until(() => {
    const ds = shuffle(rng, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4);
    if (rng() < 0.5 && !ds.includes(0)) return null;
    return ds;
  });
  const asc = [...v].sort((a, b) => a - b);
  const desc = [...asc].reverse();
  if (rng() < 0.5) {
    const ans = numOf(desc);
    return {
      text: `用 ${shuffle(rng, v).join('、')} 这四个数字组成四位数（每个数字只用一次），最大是多少？`,
      o: N(rng, ans, [numOf([desc[0], desc[1], desc[3], desc[2]]), numOf([desc[0], desc[2], desc[1], desc[3]]), numOf([desc[1], desc[0], desc[2], desc[3]])]),
      explain: `要使数最大，高位放大的数字：从大到小排 ${desc.join('、')}，最大的四位数是 ${ans}。`,
      verify: { kind: 'zzMake', p: [0, ...v], ans },
    };
  }
  const nz = asc.findIndex((d) => d > 0);
  const lead = asc[nz];
  const rest = asc.filter((_, i) => i !== nz);
  const best = [lead, ...rest];
  const ans = numOf(best);
  const zeroLead = asc[0] === 0 ? numOf(asc) : numOf([best[0], best[1], best[3], best[2]]);
  return {
    text: `用 ${shuffle(rng, v).join('、')} 这四个数字组成四位数（每个数字只用一次），最小是多少？`,
    o: N(rng, ans, [zeroLead, numOf([best[0], best[1], best[3], best[2]]), numOf([best[0], best[2], best[1], best[3]]), numOf([lead, ...[...rest].reverse()])]),
    explain: asc[0] === 0
      ? `要使数最小，高位放小的数字，但 0 不能放在最高位。最高位放 ${lead}，其余 ${rest.join('、')} 从小到大排，最小是 ${ans}。`
      : `要使数最小，高位放小的数字：从小到大排 ${asc.join('、')}，最小的四位数是 ${ans}。`,
    verify: { kind: 'zzMake', p: [1, ...v], ans },
  };
};

const BOOK = ['故事书', '练习册', '字典', '画册', '日记本'] as const;

function pageDigits(P: number): number {
  let d = 0;
  for (let i = 1; i <= P; i++) d += i < 10 ? 1 : i < 100 ? 2 : 3;
  return d;
}

const zzPages1: Tpl = (rng) => {
  const P = randInt(rng, 12, 99);
  const ans = 9 + 2 * (P - 9);
  return {
    text: `一本${pick(rng, BOOK)}共 ${P} 页，从第 1 页开始编页码，一共要用多少个数字？`,
    o: N(rng, ans, [2 * P, 2 * P - 10, 2 * P - 8, P + 9], ' 个'),
    explain: `1 ~ 9 页每页 1 个数字，共 9 个；10 ~ ${P} 页有 ${P - 9} 页，每页 2 个，共 ${2 * (P - 9)} 个。合计 9 + ${2 * (P - 9)} = ${ans} 个。`,
    verify: { kind: 'zzPageDigits', p: [P], ans },
  };
};

const zzPages2: Tpl = (rng) => {
  const P = randInt(rng, 100, 400);
  const ans = pageDigits(P);
  return {
    text: `一本${pick(rng, BOOK)}共 ${P} 页，从第 1 页开始编页码，一共要用多少个数字？`,
    o: N(rng, ans, [3 * P, 3 * P - 99, ans + 3, ans - 3, ans + 9], ' 个'),
    explain: `1 ~ 9 页共 9 个数字；10 ~ 99 页 90 页，共 180 个；100 ~ ${P} 页有 ${P - 99} 页，共 ${P - 99} × 3 = ${3 * (P - 99)} 个。合计 9 + 180 + ${3 * (P - 99)} = ${ans} 个。`,
    verify: { kind: 'zzPageDigits', p: [P], ans },
  };
};

const zzRect: Tpl = (rng) => {
  const C = randInt(rng, 8, 30) * 2;
  const s = C / 2;
  const h = Math.floor(s / 2);
  const thing = pick(rng, ['篱笆', '铁丝', '绳子']);
  if (rng() < 0.65) {
    const ans = h * (s - h);
    return {
      text: `用 ${C} 米长的${thing}围一个长方形（长、宽都是整米数），面积最大是多少平方米？`,
      o: N(rng, ans, [(h - 1) * (s - h + 1), (h - 2) * (s - h + 2), s * s / 2, s - 1, ans + s], ' 平方米'),
      explain: `长 + 宽 = ${C} ÷ 2 = ${s} 米。和一定时，长和宽越接近面积越大：${s % 2 === 0 ? `长 = 宽 = ${h} 米` : `长 ${s - h} 米、宽 ${h} 米`}时最大，${s - h} × ${h} = ${ans} 平方米。`,
      verify: { kind: 'zzRect', p: [C, 0], ans },
    };
  }
  const ans = s - 1;
  return {
    text: `用 ${C} 米长的${thing}围一个长方形（长、宽都是整米数），面积最小是多少平方米？`,
    o: N(rng, ans, [s, 2 * (s - 2), C - 1, h * (s - h), 1 + s], ' 平方米'),
    explain: `长 + 宽 = ${C} ÷ 2 = ${s} 米。长和宽相差越大面积越小：宽 1 米、长 ${s - 1} 米时最小，1 × ${s - 1} = ${ans} 平方米。`,
    verify: { kind: 'zzRect', p: [C, 1], ans },
  };
};

const zzTwo: Tpl = (rng) => {
  const ds = shuffle(rng, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 6);
  const D = [...ds].sort((a, b) => b - a);
  const show = shuffle(rng, ds).join('、');
  if (rng() < 0.5) {
    const a1 = numOf([D[0], D[2], D[4]]);
    const a2 = numOf([D[1], D[3], D[5]]);
    const ans = a1 + a2;
    return {
      text: `用 ${show} 这六个数字组成两个三位数（每个数字用一次），这两个三位数的和最大是多少？`,
      o: N(rng, ans, [numOf([D[0], D[1], D[2]]) + numOf([D[3], D[4], D[5]]), ans - 9, ans - 90, ans + 9]),
      explain: `要和最大，两个百位放最大的 ${D[0]}、${D[1]}，十位放 ${D[2]}、${D[3]}，个位放 ${D[4]}、${D[5]}。例如 ${a1} + ${a2} = ${ans}。`,
      verify: { kind: 'zzTwo', p: [0, ...ds], ans },
    };
  }
  const big = numOf([D[0], D[1], D[2]]);
  const r = [D[5], D[4], D[3]];
  const small = r[0] === 0 ? numOf([r[1], 0, r[2]]) : numOf(r);
  const ans = big - small;
  const wrongSmall = r[0] === 0 ? numOf(r) : numOf([r[0], r[2], r[1]]);
  return {
    text: `用 ${show} 这六个数字组成两个三位数（每个数字用一次），这两个三位数的差最大是多少？`,
    o: N(rng, ans, [big - wrongSmall, numOf([D[0], D[1], D[3]]) - numOf([D[5] === 0 ? D[4] : D[5], D[5] === 0 ? 0 : D[4], D[2]]), ans + 9, ans - 10]),
    explain: `要差最大，被减数尽量大、减数尽量小。被减数用最大的三个数字：${big}；减数用剩下的 ${[...r].reverse().join('、')} 组成最小的三位数 ${small}${r[0] === 0 ? '（0 不能放百位）' : ''}。差：${big} − ${small} = ${ans}。`,
    verify: { kind: 'zzTwo', p: [1, ...ds], ans },
  };
};

const zzDigitMin: Tpl = (rng) => {
  const mode = randInt(rng, 0, 2);
  if (mode === 0) {
    const s = randInt(rng, 5, 26);
    const lead = Math.max(1, s - 18);
    const rem = s - lead;
    const t = Math.max(0, rem - 9);
    const u = rem - t;
    const ans = 100 * lead + 10 * t + u;
    return {
      text: `各位数字之和是 ${s} 的三位数中，最小的是多少？`,
      o: N(rng, ans, [numOf([u, t, lead].sort((a, b) => b - a)), ans + 9, ans + 90, numOf([lead + 1, Math.max(0, t - 1), u])]),
      explain: `要最小，百位尽量小，个位、十位尽量大。${s > 19 ? `十位和个位最多 9 + 9 = 18，百位至少 ${s} − 18 = ${lead}` : '百位取 1'}；剩下 ${rem} 让十位尽量小、个位尽量大：十位 ${t}，个位 ${u}。最小是 ${ans}。`,
      verify: { kind: 'zzDigitMin', p: [0, s], ans },
    };
  }
  if (mode === 1) {
    const s = randInt(rng, 12, 35);
    const lead = Math.max(1, s - 27);
    const rem = s - lead;
    const hd = Math.max(0, rem - 18);
    const rem2 = rem - hd;
    const t = Math.max(0, rem2 - 9);
    const u = rem2 - t;
    const ans = numOf([lead, hd, t, u]);
    return {
      text: `各位数字之和是 ${s} 的四位数中，最小的是多少？`,
      o: N(rng, ans, [numOf([lead, hd, t, u].sort((a, b) => b - a)), ans + 9, ans + 90, ans + 900]),
      explain: `要最小，高位尽量小、低位尽量大。后三位最多 9 × 3 = 27，${s > 28 ? `千位至少 ${s} − 27 = ${lead}` : '千位取 1'}；剩下的 ${rem} 从个位起尽量放 9：百位 ${hd}、十位 ${t}、个位 ${u}。最小是 ${ans}。`,
      verify: { kind: 'zzDigitMin', p: [1, s], ans },
    };
  }
  const s = randInt(rng, 6, 24);
  let best = 0;
  let bh = 0;
  let bt = 0;
  let bu = 0;
  for (let h = 9; h >= 1 && !best; h--)
    for (let t = 9; t >= 0 && !best; t--) {
      const u = s - h - t;
      if (t === h || u < 0 || u > 9 || u === h || u === t) continue;
      best = numOf([h, t, u]);
      bh = h;
      bt = t;
      bu = u;
    }
  let rep = 0;
  for (let x = 999; x >= 100 && !rep; x--) if (Math.floor(x / 100) + (Math.floor(x / 10) % 10) + (x % 10) === s) rep = x;
  return {
    text: `三个数字各不相同、各位数字之和是 ${s} 的三位数中，最大的是多少？`,
    o: N(rng, best, [rep, numOf([bh, bu, bt]), best - 9, best - 90]),
    explain: `要最大，百位尽量大取 ${bh}，十位在剩下的数字中尽量大取 ${bt}，个位 ${s} − ${bh} − ${bt} = ${bu}，三个数字互不相同。最大是 ${best}。`,
    verify: { kind: 'zzDigitMin', p: [2, s], ans: best },
  };
};

const zzPagesRev: Tpl = (rng) => {
  const P = rng() < 0.35 ? randInt(rng, 30, 99) : randInt(rng, 100, 400);
  const D = pageDigits(P);
  const thing = pick(rng, BOOK);
  if (P <= 99) {
    return {
      text: `给一本${thing}编页码（从第 1 页开始），一共用了 ${D} 个数字。这本书有多少页？`,
      o: N(rng, P, [Math.floor(D / 2), P - 9, P + 1, P - 1, P + 9], ' 页'),
      explain: `1 ~ 9 页用 9 个数字，剩下 ${D} − 9 = ${D - 9} 个都是两位数页码：${D - 9} ÷ 2 = ${P - 9} 页。共 9 + ${P - 9} = ${P} 页。`,
      verify: { kind: 'zzPagesRev', p: [D], ans: P },
    };
  }
  return {
    text: `给一本${thing}编页码（从第 1 页开始），一共用了 ${D} 个数字。这本书有多少页？`,
    o: N(rng, P, [Math.floor(D / 3), P - 99, P + 1, P - 1, P + 10], ' 页'),
    explain: `1 ~ 99 页共用 9 + 180 = 189 个数字。剩下 ${D} − 189 = ${D - 189} 个是三位数页码：${D - 189} ÷ 3 = ${P - 99} 页。共 99 + ${P - 99} = ${P} 页。`,
    verify: { kind: 'zzPagesRev', p: [D], ans: P },
  };
};

const zzDigitCount: Tpl = (rng) => {
  const P = randInt(rng, 60, 250);
  const d = randInt(rng, 1, 9);
  let u = 0;
  let t = 0;
  let h = 0;
  let contain = 0;
  for (let i = 1; i <= P; i++) {
    const du = i % 10;
    const dt = Math.floor(i / 10) % 10;
    const dh = Math.floor(i / 100);
    if (du === d) u++;
    if (i >= 10 && dt === d) t++;
    if (i >= 100 && dh === d) h++;
    if (du === d || (i >= 10 && dt === d) || (i >= 100 && dh === d)) contain++;
  }
  const ans = u + t + h;
  const dd = d * 11 <= P ? `（${d}${d} 中的 ${d} 要算 2 次）` : '';
  return {
    text: `一本书共 ${P} 页，从第 1 页开始编页码，数字“${d}”一共出现了多少次？`,
    o: N(rng, ans, [contain, u, ans + 1, ans - 1, ans + 10], ' 次'),
    explain: `按数位分别数：个位上是 ${d} 的有 ${u} 次，十位上是 ${d} 的有 ${t} 次${h ? `，百位上是 ${d} 的有 ${h} 次` : ''}${dd}。合计 ${ans} 次。`,
    verify: { kind: 'zzDigitCount', p: [P, d], ans },
  };
};

const zzDigitSumAll: Tpl = (rng) => {
  const k = randInt(rng, 2, 10);
  const Nn = 10 * k - 1;
  const units = 45 * k;
  const tens = 5 * k * (k - 1);
  const ans = units + tens;
  const tensTxt = k === 2 ? '十位上 1 出现 10 次，和是 10' : `十位上 1 ~ ${k - 1} 各出现 10 次，和是 (1 + … + ${k - 1}) × 10 = ${tens}`;
  return {
    text: `把 1、2、3、…、${Nn} 依次写出来，写出的所有数字之和是多少？（如 12 算 1 + 2）`,
    o: N(rng, ans, [(Nn * (Nn + 1)) / 2, units, ans - 45, ans + 45, ans + 10]),
    explain: `个位上 0 ~ 9 各出现 ${k} 次，和是 45 × ${k} = ${units}；${tensTxt}。合计 ${units} + ${tens} = ${ans}。`,
    verify: { kind: 'zzDigitSumAll', p: [Nn], ans },
  };
};

const zzFence: Tpl = (rng) => {
  const L = randInt(rng, 12, 40);
  let best = 0;
  let by = 0;
  for (let y = 1; 2 * y < L; y++) {
    const a = y * (L - 2 * y);
    if (a > best) {
      best = a;
      by = y;
    }
  }
  const tries = [by - 1, by, by + 1].filter((y) => y >= 1 && 2 * y < L).map((y) => `宽 ${y} 米时 ${y} × ${L - 2 * y} = ${y * (L - 2 * y)}`);
  const s = Math.floor(L / 2);
  const h = Math.floor(s / 2);
  return {
    text: `用 ${L} 米长的篱笆靠墙围一块长方形菜地（靠墙一边不用篱笆，边长都是整米数）。菜地面积最大是多少平方米？`,
    o: N(rng, best, [h * (s - h), Math.floor(L / 3) * Math.floor(L / 3), best - by, best + by + 1], ' 平方米'),
    explain: `设垂直于墙的两条边各 y 米（宽），平行于墙的边就是 ${L} − 2y 米。试几个：${tries.join('，')}。最大面积是 ${best} 平方米。`,
    verify: { kind: 'zzFence', p: [L], ans: best },
  };
};

/* ═════════════ 专题清单 ═════════════ */

export const topics: Topic[] = [
  topic('g4-pingjun', 4, '平均数问题', '平均数 = 总数 ÷ 份数；先求总数，再看总数怎样变化', [
    [pjBasic, pjMove, pjMissing],
    [pjAdd, pjFix, pjWeighted],
    [pjOverlap, pjHL, pjWhich],
  ]),
  topic('g4-fangzhen', 4, '方阵问题', '实心方阵总数 = 每边数²；最外层 = 每边数×4−4；空心方阵 = (每边数−层数)×层数×4', [
    [fzOuter, fzTotalOuter],
    [fzOuterTotal, fzHollow, fzAddRow],
    [fzLeftover, fzLayers, fzFill],
  ]),
  topic('g4-xinyunsuan', 4, '定义新运算', '按规定的式子把数代进去；求未知数时把运算倒过来做', [
    [xyEval, xyConsec],
    [xyNested, xyUnknown, xyConsecUnk],
    [xyRep, xyFindK, xyNestUnk],
  ]),
  topic('g4-rongchi', 4, '容斥问题', '两项都有的被算了两次：A + B − 两者都有 = 至少有一项', [
    [rcBoth, rcTotal],
    [rcNeither, rcOnly, rcStrip],
    [rcThree, rcDiv, rcChain, rcRect],
  ]),
  topic('g4-tuili', 4, '逻辑推理', '先找确定的条件，再逐一假设、排除矛盾；单循环赛场数 = n×(n−1)÷2', [
    [tlRank, matchTpl(false), tlGames],
    [liarTpl(3, [1, 2], false), matchTpl(true), tlWins],
    [liarTpl(4, [1, 2, 3], true), tlRace, tlDraws],
  ]),
  topic('g4-jiaodu', 4, '角度与多边形', '平角 180°，周角 360°；三角形内角和 180°；n 边形内角和 = (n−2)×180°', [
    [jdLine, jdPoint, jdTriangle],
    [jdIso, jdExt, jdPolySum, jdDiag],
    [jdIsoExt, jdPolyRev, jdTriDiff],
  ]),
  topic('g4-zuizhi', 4, '最值与数字问题', '和一定，两数越接近积越大；编页码按一位数、两位数、三位数分段数', [
    [zzProd, zzMake, zzPages1],
    [zzRect, zzPages2, zzTwo, zzDigitMin],
    [zzPagesRev, zzDigitCount, zzDigitSumAll, zzFence],
  ]),
];
