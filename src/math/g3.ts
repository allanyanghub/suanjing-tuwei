/** 三年级：和差倍、植树、周期、巧算 */
import type { Topic } from './types.ts';
import { randInt, pick, buildOptions, shuffle } from './types.ts';
import type { Tpl } from './helpers.ts';
import { topic, N, two, until, NAMES, COLORS, WEEK } from './helpers.ts';

/* ───────────── 和差倍问题 ───────────── */

const THINGS: [string, string][] = [
  ['邮票', '枚'],
  ['图书', '本'],
  ['铅笔', '支'],
  ['贴纸', '张'],
  ['弹珠', '颗'],
];
const PAIRS: [string, string, string, string][] = [
  ['果园里桃树和梨树', '桃树', '梨树', '棵'],
  ['书架上故事书和科技书', '故事书', '科技书', '本'],
  ['农场里鸭和鹅', '鸭', '鹅', '只'],
  ['停车场小汽车和大客车', '小汽车', '大客车', '辆'],
];

const hcSumDiff: Tpl = (rng) => {
  const [A, B] = two(rng, NAMES);
  const [thing, u] = pick(rng, THINGS);
  const small = randInt(rng, 8, 40);
  const d = randInt(rng, 2, 20);
  const big = small + d;
  const S = big + small;
  const askBig = rng() < 0.5;
  return {
    text: `${A}和${B}共有 ${S} ${u}${thing}，${A}比${B}多 ${d} ${u}。${askBig ? A : B}有多少${u}？`,
    o: N(rng, askBig ? big : small, [askBig ? small : big, S / 2, S - d, d], ` ${u}`),
    explain: askBig
      ? `大数 = (和 + 差) ÷ 2。${A}：(${S} + ${d}) ÷ 2 = ${big} ${u}。`
      : `小数 = (和 − 差) ÷ 2。${B}：(${S} − ${d}) ÷ 2 = ${small} ${u}。`,
  };
};

const hcSumTimes: Tpl = (rng) => {
  const [ctx, X, Y, u] = pick(rng, PAIRS);
  const b = randInt(rng, 6, 30);
  const k = randInt(rng, 2, 6);
  const S = (k + 1) * b;
  const askSmall = rng() < 0.5;
  const base = `把${Y}看作 1 份，${X}是 ${k} 份，共 ${k + 1} 份。${Y}：${S} ÷ ${k + 1} = ${b} ${u}`;
  return {
    text: `${ctx}共 ${S} ${u}，${X}的数量是${Y}的 ${k} 倍。${askSmall ? Y : X}有多少${u}？`,
    o: N(rng, askSmall ? b : k * b, [askSmall ? k * b : b, S / k, S / (k - 1), S / 2], ` ${u}`),
    explain: askSmall ? `${base}。` : `${base}。${X}：${b} × ${k} = ${k * b} ${u}。`,
  };
};

const hcDiffTimes: Tpl = (rng) => {
  const [, X, Y, u] = pick(rng, PAIRS);
  const b = randInt(rng, 5, 25);
  const k = randInt(rng, 2, 5);
  const D = (k - 1) * b;
  const askSmall = rng() < 0.5;
  const base = `把${Y}看作 1 份，${X}是 ${k} 份，多出 ${k - 1} 份正好是 ${D} ${u}。${Y}：${D} ÷ ${k - 1} = ${b} ${u}`;
  return {
    text: `${X}比${Y}多 ${D} ${u}，${X}的数量是${Y}的 ${k} 倍。${askSmall ? Y : X}有多少${u}？`,
    o: N(rng, askSmall ? b : k * b, [askSmall ? k * b : b, D / k, D / (k + 1), D * k, D], ` ${u}`),
    explain: askSmall ? `${base}。` : `${base}。${X}：${b} × ${k} = ${k * b} ${u}。`,
  };
};

const hcSumTimesRem: Tpl = (rng) => {
  const [A, B] = two(rng, NAMES);
  const [thing, u] = pick(rng, THINGS);
  const b = randInt(rng, 6, 25);
  const k = randInt(rng, 2, 4);
  const r = randInt(rng, 1, Math.min(9, b - 1));
  const big = k * b + r;
  const S = big + b;
  const askBig = rng() < 0.5;
  const base = `从总数中去掉多的 ${r} ${u}，剩下的正好是${B}的 ${k + 1} 倍。${B}：(${S} − ${r}) ÷ ${k + 1} = ${b} ${u}`;
  return {
    text: `${A}和${B}共有 ${S} ${u}${thing}，${A}的比${B}的 ${k} 倍还多 ${r} ${u}。${askBig ? A : B}有多少${u}？`,
    o: N(rng, askBig ? big : b, [askBig ? b : big, k * b, big - 2 * r, b + r, S - r], ` ${u}`),
    explain: askBig ? `${base}。${A}：${b} × ${k} + ${r} = ${big} ${u}。` : `${base}。`,
  };
};

const hcThree: Tpl = (rng) => {
  const c = randInt(rng, 10, 30);
  const a = randInt(rng, 2, 9);
  const b = randInt(rng, 2, 9);
  const S = 3 * c + 2 * b + a;
  const [act, u] = pick(rng, [
    ['植树', '棵'],
    ['捐书', '本'],
    ['做花', '朵'],
  ] as [string, string][]);
  return {
    text: `三个班共${act} ${S} ${u}，一班比二班多 ${a} ${u}，二班比三班多 ${b} ${u}。三班${act}多少${u}？`,
    o: N(rng, c, [c + b, c + a + b, (S - a - b) / 3, S / 3], ` ${u}`),
    explain: `以三班为标准：二班多 ${b} ${u}，一班多 ${b} + ${a} = ${a + b} ${u}。三班：(${S} − ${b} − ${a + b}) ÷ 3 = ${c} ${u}。`,
  };
};

const hcEqualize: Tpl = (rng) => {
  const [A, B] = two(rng, NAMES);
  const [thing, u] = pick(rng, THINGS);
  const b = randInt(rng, 10, 40);
  const g = randInt(rng, 3, 15);
  const a = b + 2 * g;
  return {
    text: `${A}有 ${a} ${u}${thing}，${B}有 ${b} ${u}。${A}给${B}多少${u}后，两人的${thing}一样多？`,
    o: N(rng, g, [a - b, (a + b) / 2, b, g + 1], ` ${u}`),
    explain: `${A}比${B}多 ${a} − ${b} = ${a - b} ${u}。把多出的平分，给出一半：${a - b} ÷ 2 = ${g} ${u}。`,
  };
};

const hcGiveEqual: Tpl = (rng) => {
  const [A, B] = two(rng, NAMES);
  const [thing, u] = pick(rng, THINGS);
  const half = randInt(rng, 20, 60);
  const g = randInt(rng, 3, 12);
  const S = half * 2;
  return {
    text: `${A}和${B}共有 ${S} ${u}${thing}，${A}给${B} ${g} ${u}后两人一样多。${A}原来有多少${u}？`,
    o: N(rng, half + g, [half - g, half, half + 2 * g, (S + g) / 2], ` ${u}`),
    explain: `给完后每人 ${S} ÷ 2 = ${half} ${u}。${A}给出了 ${g} ${u}，原来有 ${half} + ${g} = ${half + g} ${u}。`,
  };
};

const hcMoveTimes: Tpl = (rng) => {
  const m = randInt(rng, 8, 20);
  const k = randInt(rng, 2, 4);
  const t = randInt(rng, 2, Math.min(9, m - 3));
  const S = (k + 1) * m;
  const [fruit] = pick(rng, [['苹果'], ['橘子'], ['梨']] as [string][]);
  return {
    text: `甲、乙两筐${fruit}共 ${S} 千克，从甲筐取 ${t} 千克放入乙筐后，甲筐是乙筐的 ${k} 倍。甲筐原有多少千克？`,
    o: N(rng, k * m + t, [k * m, k * m - t, m + t, m, m - t], ' 千克'),
    explain: `总重不变。现在乙筐：${S} ÷ (${k} + 1) = ${m} 千克，甲筐：${m} × ${k} = ${k * m} 千克。甲筐原有 ${k * m} + ${t} = ${k * m + t} 千克。`,
  };
};

const hcRect: Tpl = (rng) => {
  const w = randInt(rng, 2, 9);
  const k = randInt(rng, 2, 4);
  const P = 2 * (k + 1) * w;
  const area = k * w * w;
  return {
    text: `一个长方形的周长是 ${P} 厘米，长是宽的 ${k} 倍。这个长方形的面积是多少平方厘米？`,
    o: N(rng, area, [4 * area, k * w, P / 2, 2 * area, w * w], ' 平方厘米'),
    explain: `长 + 宽 = ${P} ÷ 2 = ${P / 2} 厘米。宽：${P / 2} ÷ (${k} + 1) = ${w} 厘米，长：${w} × ${k} = ${k * w} 厘米。面积 = ${k * w} × ${w} = ${area} 平方厘米。`,
  };
};

/* ───────────── 植树问题 ───────────── */

const PLANT: [string, string, string][] = [
  ['种树', '种', '棵'],
  ['插彩旗', '插', '面'],
  ['装路灯', '装', '盏'],
];

const zsBoth: Tpl = (rng) => {
  const [full, v, u] = pick(rng, PLANT);
  const g = randInt(rng, 2, 10);
  const n = randInt(rng, 5, 30);
  const L = g * n;
  return {
    text: `在一条长 ${L} 米的小路一侧${full}，每隔 ${g} 米${v}一${u}，两端都${v}。一共要${v}多少${u}？`,
    o: N(rng, n + 1, [n, n - 1, 2 * (n + 1)], ` ${u}`),
    explain: `两端都${v}：${u}数 = 间隔数 + 1。间隔数 = ${L} ÷ ${g} = ${n}，所以 ${n} + 1 = ${n + 1} ${u}。`,
    verify: { kind: 'plant', p: [L, g, 0], ans: n + 1 },
  };
};

const zsClosed: Tpl = (rng) => {
  const g = randInt(rng, 2, 10);
  const n = randInt(rng, 6, 40);
  const L = g * n;
  const [place, tree] = pick(rng, [
    ['圆形池塘', '柳树'],
    ['圆形花坛', '月季'],
    ['环形跑道', '小树'],
  ] as [string, string][]);
  return {
    text: `${place}一周长 ${L} 米，沿着它每隔 ${g} 米种一棵${tree}。一共要种多少棵？`,
    o: N(rng, n, [n + 1, n - 1, 2 * n], ' 棵'),
    explain: `封闭路线首尾相接：棵数 = 间隔数。${L} ÷ ${g} = ${n} 棵。`,
    verify: { kind: 'plant', p: [L, g, 1], ans: n },
  };
};

const zsNeither: Tpl = (rng) => {
  const g = randInt(rng, 2, 10);
  const n = randInt(rng, 5, 30);
  const L = g * n;
  return {
    text: `两栋楼相距 ${L} 米，在两楼之间每隔 ${g} 米种一棵树（紧靠楼的两端不种）。一共要种多少棵？`,
    o: N(rng, n - 1, [n, n + 1, n - 2], ' 棵'),
    explain: `两端都不种：棵数 = 间隔数 − 1。间隔数 = ${L} ÷ ${g} = ${n}，所以 ${n} − 1 = ${n - 1} 棵。`,
    verify: { kind: 'plant', p: [L, g, 2], ans: n - 1 },
  };
};

const zsBothSides: Tpl = (rng) => {
  const g = randInt(rng, 2, 10);
  const n = randInt(rng, 5, 30);
  const L = g * n;
  return {
    text: `一条路长 ${L} 米，在路的两侧每隔 ${g} 米种一棵树，两端都种。一共要种多少棵？`,
    o: N(rng, 2 * (n + 1), [2 * n, n + 1, 2 * n + 1, 2 * (n - 1)], ' 棵'),
    explain: `一侧：${L} ÷ ${g} + 1 = ${n + 1} 棵。两侧：${n + 1} × 2 = ${2 * (n + 1)} 棵。`,
    verify: { kind: 'plant', p: [L, g, 3], ans: 2 * (n + 1) },
  };
};

const zsReverse: Tpl = (rng) => {
  const n = randInt(rng, 6, 30);
  const g = randInt(rng, 2, 12);
  const [thing, u] = pick(rng, [
    ['树', '棵'],
    ['电线杆', '根'],
    ['路灯', '盏'],
  ] as [string, string][]);
  return {
    text: `路边一排${thing}共 ${n} ${u}，相邻两${u}相距 ${g} 米。第一${u}到最后一${u}相距多少米？`,
    o: N(rng, (n - 1) * g, [n * g, (n + 1) * g, (n - 2) * g], ' 米'),
    explain: `${n} ${u}${thing}之间有 ${n} − 1 = ${n - 1} 个间隔。${n - 1} × ${g} = ${(n - 1) * g} 米。`,
  };
};

const zsSaw: Tpl = (rng) => {
  const n = randInt(rng, 4, 12);
  const t = randInt(rng, 2, 9);
  const [thing] = pick(rng, [['木头'], ['钢管'], ['竹竿']] as [string][]);
  return {
    text: `把一根${thing}锯成 ${n} 段，每锯一次用 ${t} 分钟。一共要用多少分钟？`,
    o: N(rng, (n - 1) * t, [n * t, (n + 1) * t, (n - 2) * t], ' 分钟'),
    explain: `锯成 ${n} 段只需锯 ${n} − 1 = ${n - 1} 次。${n - 1} × ${t} = ${(n - 1) * t} 分钟。`,
  };
};

const zsStairs: Tpl = (rng) => {
  const [A] = two(rng, NAMES);
  const per = randInt(rng, 8, 20);
  const a = randInt(rng, 3, 5);
  const b = randInt(rng, a + 2, 12);
  const T = per * (a - 1);
  const ans = per * (b - 1);
  return {
    text: `${A}从 1 楼走到 ${a} 楼用了 ${T} 秒。照这样的速度，从 1 楼走到 ${b} 楼要用多少秒？`,
    o: N(rng, ans, [per * b, (T / a) * b, per * (b - a), per * (b + 1)], ' 秒'),
    explain: `从 1 楼到 ${a} 楼只走 ${a - 1} 层，每层 ${T} ÷ ${a - 1} = ${per} 秒。到 ${b} 楼走 ${b - 1} 层：${per} × ${b - 1} = ${ans} 秒。`,
  };
};

const zsRespace: Tpl = (rng) => {
  const v = until(() => {
    const g = randInt(rng, 2, 8);
    const n = randInt(rng, 7, 25);
    const g2 = randInt(rng, 2, 12);
    const L = (n - 1) * g;
    if (g2 === g || L % g2 !== 0 || L / g2 < 3) return null;
    return { g, n, g2, L };
  });
  const ans = v.L / v.g2 + 1;
  return {
    text: `一条路的一侧种了 ${v.n} 棵树，每隔 ${v.g} 米一棵，两端都种。如果改为每隔 ${v.g2} 米种一棵，要种多少棵？`,
    o: N(rng, ans, [v.L / v.g2, (v.n * v.g) / v.g2 + 1, (v.n * v.g) / v.g2, ans + 1], ' 棵'),
    explain: `先求路长：(${v.n} − 1) × ${v.g} = ${v.L} 米。改为每隔 ${v.g2} 米：${v.L} ÷ ${v.g2} + 1 = ${ans} 棵。`,
    verify: { kind: 'plant', p: [v.L, v.g2, 0], ans },
  };
};

const zsSawRest: Tpl = (rng) => {
  const n = randInt(rng, 4, 9);
  const t = randInt(rng, 3, 8);
  const r = randInt(rng, 1, 3);
  const ans = (n - 1) * t + (n - 2) * r;
  return {
    text: `把一根木头锯成 ${n} 段，每锯一次用 ${t} 分钟，每锯完一次休息 ${r} 分钟。从开始到全部锯完共用多少分钟？`,
    o: N(rng, ans, [(n - 1) * (t + r), n * (t + r), n * t + (n - 1) * r, (n - 1) * t], ' 分钟'),
    explain: `锯成 ${n} 段要锯 ${n - 1} 次，中间休息 ${n - 2} 次（最后一次锯完就结束）。${n - 1} × ${t} + ${n - 2} × ${r} = ${ans} 分钟。`,
  };
};

/* ───────────── 周期问题 ───────────── */

function cycleExplain(n: number, p: number, what: string): string {
  const q = Math.floor(n / p);
  const r = n % p;
  return r === 0
    ? `${n} ÷ ${p} = ${q}，没有余数，是周期的最后一个：${what}。`
    : `${n} ÷ ${p} = ${q}……${r}，是周期的第 ${r} 个：${what}。`;
}

const zqColor: Tpl = (rng) => {
  const k = randInt(rng, 3, 4);
  const pat = shuffle(rng, [0, 1, 2, 3, 4]).slice(0, k);
  const n = randInt(rng, 20, 99);
  const idx = pat[(n - 1) % k];
  const [thing, u] = pick(rng, [
    ['彩灯', '盏'],
    ['气球', '个'],
    ['彩旗', '面'],
  ] as [string, string][]);
  const ds = [pat[n % k], pat[(n - 2 + k) % k], ...pat].map((i) => `${COLORS[i]}色`);
  return {
    text: `一串${thing}按“${pat.map((i) => COLORS[i]).join('、')}”的顺序重复排列，第 ${n} ${u}是什么颜色？`,
    o: buildOptions(rng, `${COLORS[idx]}色`, ds, (j) => `${COLORS[j % 5]}色`),
    explain: `每 ${k} ${u}一个周期。${cycleExplain(n, k, `${COLORS[idx]}色`)}`,
    verify: { kind: 'cycleColor', p: [n, ...pat], ans: idx },
  };
};

const zqWeekday: Tpl = (rng) => {
  const w = randInt(rng, 0, 6);
  const n = randInt(rng, 10, 60);
  const ans = (w + n) % 7;
  const r = n % 7;
  const ds = [(ans + 1) % 7, (ans + 6) % 7, r, w].map((i) => `星期${WEEK[i]}`);
  return {
    text: `今天是星期${WEEK[w]}，再过 ${n} 天是星期几？`,
    o: buildOptions(rng, `星期${WEEK[ans]}`, ds, (j) => `星期${WEEK[j % 7]}`),
    explain:
      `7 天一个周期。${n} ÷ 7 = ${Math.floor(n / 7)}` +
      (r === 0
        ? `，没有余数，正好是整周，还是星期${WEEK[ans]}。`
        : `……${r}，从星期${WEEK[w]}往后数 ${r} 天，是星期${WEEK[ans]}。`),
    verify: { kind: 'weekday', p: [w, n], ans },
  };
};

const zqCountColor: Tpl = (rng) => {
  const cols = shuffle(rng, [0, 1, 2, 3, 4]).slice(0, 3);
  const counts = until(() => {
    const c = [randInt(rng, 1, 3), randInt(rng, 1, 3), randInt(rng, 1, 3)];
    return c[0] + c[1] + c[2] >= 4 ? c : null;
  });
  const p = counts[0] + counts[1] + counts[2];
  const n = randInt(rng, 20, 80);
  const ti = randInt(rng, 0, 2);
  const seq: number[] = [];
  counts.forEach((c, i) => {
    for (let j = 0; j < c; j++) seq.push(i);
  });
  const q = Math.floor(n / p);
  const r = n % p;
  const per = counts[ti];
  let extra = 0;
  for (let i = 0; i < r; i++) if (seq[i] === ti) extra++;
  const ans = q * per + extra;
  const cn = COLORS[cols[ti]];
  return {
    text: `一串珠子按“${counts.map((c, i) => `${c} ${COLORS[cols[i]]}`).join('、')}”的顺序重复排列，前 ${n} 颗中${cn}珠有多少颗？`,
    o: N(rng, ans, [q * per, (q + 1) * per, q * per + r, ans + 1, ans - 1], ' 颗'),
    explain:
      `每 ${p} 颗一个周期，每个周期有 ${per} 颗${cn}珠。` +
      (r === 0
        ? `${n} ÷ ${p} = ${q}，正好 ${q} 个周期：${q} × ${per} = ${ans} 颗。`
        : `${n} ÷ ${p} = ${q}……${r}，余下的 ${r} 颗中有 ${extra} 颗${cn}珠：${q} × ${per} + ${extra} = ${ans} 颗。`),
    verify: { kind: 'cycleCount', p: [n, ti, ...counts], ans },
  };
};

const zqDigit: Tpl = (rng) => {
  const k = randInt(rng, 3, 5);
  const pat = shuffle(rng, [1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, k);
  const n = randInt(rng, 25, 99);
  const ans = pat[(n - 1) % k];
  return {
    text: `一列数按 ${pat.join('、')}、${pat.join('、')}、… 的规律排列，第 ${n} 个数是几？`,
    o: buildOptions(
      rng,
      String(ans),
      [pat[n % k], pat[(n - 2 + k) % k], ...pat].map(String),
      (j) => String(j % 10),
    ),
    explain: `每 ${k} 个数一个周期。${cycleExplain(n, k, String(ans))}`,
    verify: { kind: 'cycle', p: [n, ...pat], ans },
  };
};

const zqDate: Tpl = (rng) => {
  const M = pick(rng, [1, 3, 5, 7, 8, 10, 12]);
  const w = randInt(rng, 0, 6);
  const d = randInt(rng, 10, 31);
  const pass = d - 1;
  const ans = (w + pass) % 7;
  const r = pass % 7;
  const ds = [(w + d) % 7, (ans + 6) % 7, d % 7, w].map((i) => `星期${WEEK[i]}`);
  return {
    text: `某年 ${M} 月 1 日是星期${WEEK[w]}，这个月的 ${d} 日是星期几？`,
    o: buildOptions(rng, `星期${WEEK[ans]}`, ds, (j) => `星期${WEEK[j % 7]}`),
    explain:
      `从 1 日到 ${d} 日过了 ${d} − 1 = ${pass} 天。${pass} ÷ 7 = ${Math.floor(pass / 7)}` +
      (r === 0
        ? `，没有余数，还是星期${WEEK[ans]}。`
        : `……${r}，从星期${WEEK[w]}往后数 ${r} 天，是星期${WEEK[ans]}。`),
    verify: { kind: 'weekday', p: [w, pass], ans },
  };
};

const zqSum: Tpl = (rng) => {
  const k = randInt(rng, 3, 4);
  const pat = shuffle(rng, [1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, k);
  const n = randInt(rng, 22, 70);
  const s = pat.reduce((x, y) => x + y, 0);
  const q = Math.floor(n / k);
  const r = n % k;
  const rest = pat.slice(0, r);
  const e = rest.reduce((x, y) => x + y, 0);
  const ans = q * s + e;
  return {
    text: `一列数按 ${pat.join('、')}、${pat.join('、')}、… 的规律排列，前 ${n} 个数的和是多少？`,
    o: N(rng, ans, [q * s, (q + 1) * s, q * s + r, ans + pat[0], n * pat[0]]),
    explain:
      `每 ${k} 个数一个周期，一个周期的和是 ${pat.join(' + ')} = ${s}。` +
      (r === 0
        ? `${n} ÷ ${k} = ${q}，正好 ${q} 个周期：${q} × ${s} = ${ans}。`
        : `${n} ÷ ${k} = ${q}……${r}，余下 ${r} 个数的和是 ${rest.length > 1 ? `${rest.join(' + ')} = ` : ''}${e}：${q} × ${s} + ${e} = ${ans}。`),
    verify: { kind: 'cycleSum', p: [n, ...pat], ans },
  };
};

const zqPower: Tpl = (rng) => {
  const b = pick(rng, [2, 3, 7, 8]);
  const n = randInt(rng, 10, 60);
  const cyc = [b % 10, (b * b) % 10, (b * b * b) % 10, (b * b * b * b) % 10];
  const ans = cyc[(n - 1) % 4];
  const r = n % 4;
  return {
    text: `${n} 个 ${b} 连乘（${b} × ${b} × … × ${b}）的积，个位数字是几？`,
    o: buildOptions(rng, String(ans), cyc.map(String), (j) => String(j % 10)),
    explain:
      `积的个位按 ${cyc.join('、')} 循环，周期是 4。${n} ÷ 4 = ${Math.floor(n / 4)}` +
      (r === 0 ? `，没有余数，是周期的最后一个：${ans}。` : `……${r}，是周期的第 ${r} 个：${ans}。`),
    verify: { kind: 'powDigit', p: [b, n], ans },
  };
};

const zqKth: Tpl = (rng) => {
  const p = randInt(rng, 3, 5);
  const pat = shuffle(rng, [0, 1, 2, 3, 4]).slice(0, p);
  const pos = randInt(rng, 1, p);
  const k = randInt(rng, 5, 20);
  const c = COLORS[pat[pos - 1]];
  const ans = (k - 1) * p + pos;
  return {
    text: `彩旗按“${pat.map((i) => COLORS[i]).join('、')}”的顺序重复排成一行，第 ${k} 面${c}旗是从头数起的第几面？`,
    o: N(rng, ans, [k * p + pos, k * p, (k - 1) * p, k + pos, ans + 1]),
    explain: `每 ${p} 面一个周期，每个周期有 1 面${c}旗，在第 ${pos} 个位置。前 ${k - 1} 个周期共 ${k - 1} × ${p} = ${(k - 1) * p} 面，再数 ${pos} 面：${(k - 1) * p} + ${pos} = ${ans}。`,
    verify: { kind: 'cycleKth', p: [k, pat[pos - 1], ...pat], ans },
  };
};

/* ───────────── 巧算与速算 ───────────── */

const expr = (e: string, ans: number, o: ReturnType<typeof N>, explain: string) => ({
  text: `巧算：${e} = ？`,
  o,
  explain,
  verify: { kind: 'expr', p: [], ans },
});

const qsAddRound: Tpl = (rng) => {
  const h = pick(rng, [100, 200]);
  const a = until(() => {
    const x = randInt(rng, 11, h - 11);
    return x % 10 === 0 ? null : x;
  });
  const c = h - a;
  const b = randInt(rng, 12, 99);
  const ans = h + b;
  return expr(
    `${a} + ${b} + ${c}`,
    ans,
    N(rng, ans, [ans - 10, ans + 10, ans + 100, ans - 100]),
    `先把能凑整的两个数相加：${a} + ${c} = ${h}。再加 ${b}：${h} + ${b} = ${ans}。`,
  );
};

const qsMulRound: Tpl = (rng) => {
  const [x, y] = pick(rng, [
    [25, 4],
    [125, 8],
    [5, 20],
  ] as [number, number][]);
  const n = randInt(rng, 3, 39);
  const ans = x * y * n;
  return expr(
    `${x} × ${n} × ${y}`,
    ans,
    N(rng, ans, [ans / 10, ans * 10, x * y * (n + 1), x * n + y, x * y + n]),
    `先把能凑整的两个数相乘：${x} × ${y} = ${x * y}。再乘 ${n}：${x * y} × ${n} = ${ans}。`,
  );
};

const qsSubProp: Tpl = (rng) => {
  const h = pick(rng, [100, 200]);
  const b = until(() => {
    const x = randInt(rng, 11, h - 11);
    return x % 10 === 0 ? null : x;
  });
  const c = h - b;
  const a = randInt(rng, h + 50, 900);
  const ans = a - h;
  return expr(
    `${a} − ${b} − ${c}`,
    ans,
    N(rng, ans, [a - b + c, ans + 10, ans - 10, ans + 100]),
    `连续减去两个数，等于减去它们的和：${b} + ${c} = ${h}。${a} − ${h} = ${ans}。`,
  );
};

const qsDistrib: Tpl = (rng) => {
  const a = randInt(rng, 12, 89);
  const s = pick(rng, [10, 100]);
  const b = s === 10 ? randInt(rng, 2, 8) : randInt(rng, 11, 89);
  const c = s - b;
  const ans = a * s;
  return expr(
    `${a} × ${b} + ${a} × ${c}`,
    ans,
    N(rng, ans, [ans + a, ans - a, a * b + c, ans / 10, ans * 10]),
    `两个乘法有相同的因数 ${a}，用乘法分配律：${a} × (${b} + ${c}) = ${a} × ${s} = ${ans}。`,
  );
};

const qsNearHundred: Tpl = (rng) => {
  const x = randInt(rng, 123, 689);
  const h1 = randInt(rng, 1, 4) * 100;
  const d1 = randInt(rng, 1, 3);
  if (rng() < 0.5) {
    const h2 = randInt(rng, 1, 4) * 100;
    const d2 = randInt(rng, 1, 3);
    const round = x + h1 + h2;
    const ans = round - d1 - d2;
    return expr(
      `${x} + ${h1 - d1} + ${h2 - d2}`,
      ans,
      N(rng, ans, [round + d1 + d2, round, ans - 10, ans + 10]),
      `把 ${h1 - d1} 看作 ${h1} − ${d1}，${h2 - d2} 看作 ${h2} − ${d2}。${x} + ${h1} + ${h2} = ${round}，多加了 ${d1} + ${d2} = ${d1 + d2}，要减去：${round} − ${d1 + d2} = ${ans}。`,
    );
  }
  const big = x + 400;
  const ans = big - h1 + d1;
  return expr(
    `${big} − ${h1 - d1}`,
    ans,
    N(rng, ans, [big - h1 - d1, big - h1, ans + 10, ans - 10]),
    `把 ${h1 - d1} 看作 ${h1} − ${d1}。${big} − ${h1} = ${big - h1}，多减了 ${d1}，要加回来：${big - h1} + ${d1} = ${ans}。`,
  );
};

const qsSplit: Tpl = (rng) => {
  const [x, y] = pick(rng, [
    [25, 4],
    [25, 4],
    [125, 8],
  ] as [number, number][]);
  const k = x === 25 ? randInt(rng, 3, 24) : randInt(rng, 2, 12);
  const n = y * k;
  const ans = x * n;
  return expr(
    `${x} × ${n}`,
    ans,
    N(rng, ans, [ans / 10, x * y * (k + 1), x * y * (k - 1), ans + x, ans - x]),
    `把 ${n} 拆成 ${y} × ${k}：${x} × ${y} × ${k} = ${x * y} × ${k} = ${ans}。`,
  );
};

const qsTimes99: Tpl = (rng) => {
  const a = randInt(rng, 12, 98);
  const m = pick(rng, [99, 101, 999]);
  const h = m === 999 ? 1000 : 100;
  const ans = a * m;
  if (m === 101) {
    return expr(
      `${a} × 101`,
      ans,
      N(rng, ans, [a * 100 - a, a * 100 + 1, a * 100 + 101, a * 100]),
      `把 101 看作 100 + 1：${a} × 100 + ${a} × 1 = ${a * 100} + ${a} = ${ans}。`,
    );
  }
  return expr(
    `${a} × ${m}`,
    ans,
    N(rng, ans, [a * h + a, a * h - 1, a * h - m, a * h - 100]),
    `把 ${m} 看作 ${h} − 1：${a} × ${h} − ${a} × 1 = ${a * h} − ${a} = ${ans}。`,
  );
};

const qsHidden: Tpl = (rng) => {
  const a = randInt(rng, 12, 98);
  const form = randInt(rng, 0, 2);
  const ans = a * 100;
  const o = N(rng, ans, [ans + a, ans - a, ans + 100, ans - 100, ans / 10]);
  if (form === 0) {
    return expr(
      `${a} × 99 + ${a}`,
      ans,
      o,
      `把单独的 ${a} 看作 ${a} × 1，再用乘法分配律：${a} × (99 + 1) = ${a} × 100 = ${ans}。`,
    );
  }
  if (form === 1) {
    return expr(
      `${a} × 101 − ${a}`,
      ans,
      o,
      `把单独的 ${a} 看作 ${a} × 1，再用乘法分配律：${a} × (101 − 1) = ${a} × 100 = ${ans}。`,
    );
  }
  const c = randInt(rng, 12, 89);
  return expr(
    `${a} × ${100 + c} − ${a} × ${c}`,
    ans,
    o,
    `两个乘法有相同的因数 ${a}，用乘法分配律：${a} × (${100 + c} − ${c}) = ${a} × 100 = ${ans}。`,
  );
};

const qsMultiSub: Tpl = (rng) => {
  const X = randInt(rng, 5, 20) * 100;
  const pairUp = () =>
    until(() => {
      const x = randInt(rng, 11, 89);
      return x % 10 === 0 || x === 50 ? null : x;
    });
  const a = pairUp();
  const b = pairUp();
  const ans = X - 200;
  return expr(
    `${X} − ${a} − ${b} − ${100 - a} − ${100 - b}`,
    ans,
    N(rng, ans, [X - 100, X - 300, ans + 10, ans - 10]),
    `连减等于减去这些数的和，先凑整：(${a} + ${100 - a}) + (${b} + ${100 - b}) = 100 + 100 = 200。${X} − 200 = ${ans}。`,
  );
};

export const topics: Topic[] = [
  topic('g3-hecha', 3, '和差倍问题', '和差：(和±差)÷2；和倍：和÷(倍数+1)；差倍：差÷(倍数−1)', [
    [hcSumDiff, hcSumTimes, hcDiffTimes],
    [hcSumTimesRem, hcThree, hcEqualize],
    [hcGiveEqual, hcMoveTimes, hcRect],
  ]),
  topic('g3-zhishu', 3, '植树问题', '两端都种：棵数=间隔数+1；两端不种：间隔数−1；封闭：棵数=间隔数', [
    [zsBoth, zsClosed, zsNeither],
    [zsBothSides, zsReverse, zsSaw],
    [zsStairs, zsRespace, zsSawRest],
  ]),
  topic('g3-zhouqi', 3, '周期问题', '找出周期长度，用总数÷周期，看余数；余数为 0 对应周期最后一个', [
    [zqColor, zqWeekday],
    [zqCountColor, zqDigit, zqDate],
    [zqSum, zqPower, zqKth],
  ]),
  topic('g3-qiaosuan', 3, '巧算与速算', '凑整：25×4=100，125×8=1000；乘法分配律；连减=减去和', [
    [qsAddRound, qsMulRound, qsSubProp],
    [qsDistrib, qsNearHundred, qsSplit],
    [qsTimes99, qsHidden, qsMultiSub],
  ]),
];
