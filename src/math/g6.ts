/** 六年级：分数百分数应用题、工程问题、浓度问题、比和比例 */
import type { Topic } from './types.ts';
import { randInt, pick, gcd, lcm, frac, buildOptions } from './types.ts';
import type { Tpl, Rng } from './helpers.ts';
import { topic, N, two, until, ratio, NAMES } from './helpers.ts';

/** 随机真分数 p/q（最简），q 在 [qlo, qhi] */
function properFrac(rng: Rng, qlo: number, qhi: number): [number, number] {
  return until(() => {
    const q = randInt(rng, qlo, qhi);
    const p = randInt(rng, 1, q - 1);
    return gcd(p, q) === 1 ? ([p, q] as [number, number]) : null;
  });
}

/* ───────────── 分数百分数应用题 ───────────── */

const fsPartOf: Tpl = (rng) => {
  const [p, q] = properFrac(rng, 3, 9);
  const u = randInt(rng, 6, 40);
  const T = q * u;
  const [A] = two(rng, NAMES);
  const [text, unit] = pick(rng, [
    [`一本书共 ${T} 页，${A}已经看了全书的 ${p}/${q}。${A}看了多少页？`, ' 页'],
    [`一条路长 ${T} 米，已经修了全长的 ${p}/${q}。已经修了多少米？`, ' 米'],
    [`果园里有果树 ${T} 棵，其中 ${p}/${q} 是苹果树。苹果树有多少棵？`, ' 棵'],
  ] as [string, string][]);
  return {
    text,
    o: N(rng, p * u, [T - p * u, (T * q) / p, u, p * u + u], unit),
    explain: `求一个数的几分之几用乘法。${T} × ${p}/${q} = ${T} ÷ ${q} × ${p} = ${p * u}${unit}。`,
  };
};

const fsWholeFrom: Tpl = (rng) => {
  const [p, q] = properFrac(rng, 3, 9);
  const u = randInt(rng, 4, 30);
  const X = p * u;
  const T = q * u;
  const [text, unit] = pick(rng, [
    [`一根绳子用去了全长的 ${p}/${q}，正好用去 ${X} 米。这根绳子全长多少米？`, ' 米'],
    [`一桶油用去了 ${p}/${q}，正好用去 ${X} 千克。这桶油原有多少千克？`, ' 千克'],
    [`六年级有女生 ${X} 人，正好占全年级人数的 ${p}/${q}。六年级共有多少人？`, ' 人'],
  ] as [string, string][]);
  return {
    text,
    o: N(rng, T, [(X * p) / q, T - X, T + X, X + q, (q - p) * u === X ? T + u : (X * q) / (q - p)], unit),
    explain: `已知一个数的 ${p}/${q} 是 ${X}，求这个数用除法。${X} ÷ ${p}/${q} = ${X} × ${q} ÷ ${p} = ${T}${unit}。`,
  };
};

const ZHE: [string, number][] = [
  ['六', 60],
  ['七', 70],
  ['八', 80],
  ['九', 90],
  ['七五', 75],
  ['八五', 85],
];

const fsPercent: Tpl = (rng) => {
  const item = pick(rng, ['件上衣', '个书包', '双球鞋', '盏台灯']);
  if (rng() < 0.5) {
    const [zn, pc] = pick(rng, ZHE);
    const P = randInt(rng, 2, 30) * 20;
    const ans = (P * pc) / 100;
    return {
      text: `一${item}原价 ${P} 元，现在打${zn}折出售。现价是多少元？`,
      o: N(rng, ans, [P - ans, P - pc / 10, P - pc, ans + 10, ans - 10], ' 元'),
      explain: `打${zn}折就是按原价的 ${pc}% 出售。${P} × ${pc}% = ${ans} 元。`,
    };
  }
  const pc = pick(rng, [10, 15, 20, 25, 30, 40]);
  const P = randInt(rng, 2, 30) * 20;
  const ans = (P * (100 - pc)) / 100;
  return {
    text: `一${item}原价 ${P} 元，现在降价 ${pc}% 出售。现价是多少元？`,
    o: N(rng, ans, [P - ans, P - pc, (P * (100 + pc)) / 100, ans + 10, ans - 10], ' 元'),
    explain: `降价 ${pc}% 后，现价是原价的 1 − ${pc}% = ${100 - pc}%。${P} × ${100 - pc}% = ${ans} 元。`,
  };
};

const fsRemainWhole: Tpl = (rng) => {
  const [p, q] = properFrac(rng, 3, 9);
  const u = randInt(rng, 5, 30);
  const X = (q - p) * u;
  const T = q * u;
  const [A] = two(rng, NAMES);
  const [text, unit] = pick(rng, [
    [`一本书，${A}看了全书的 ${p}/${q}，还剩 ${X} 页没看。这本书共有多少页？`, ' 页'],
    [`一条路，已经修了全长的 ${p}/${q}，还剩 ${X} 米没修。这条路全长多少米？`, ' 米'],
    [`一批货物，运走了 ${p}/${q}，还剩 ${X} 吨。这批货物原有多少吨？`, ' 吨'],
  ] as [string, string][]);
  return {
    text,
    o: N(rng, T, [(X * q) / p, (X * (q - p)) / q, X + p, T - X, T + u], unit),
    explain: `剩下的占全部的 1 − ${p}/${q} = ${q - p}/${q}，对应 ${X}${unit}。${X} ÷ ${q - p}/${q} = ${T}${unit}。`,
  };
};

const fsMoreThan: Tpl = (rng) => {
  const [p, q] = properFrac(rng, 2, 8);
  const u = randInt(rng, 3, 20);
  const more = rng() < 0.5;
  const base = q * u;
  const X = more ? (q + p) * u : (q - p) * u;
  const [a, b, unit] = pick(rng, [
    ['男生', '女生', ' 人'],
    ['苹果树', '梨树', ' 棵'],
    ['科技书', '故事书', ' 本'],
  ] as [string, string, string][]);
  const part = more ? q + p : q - p;
  return {
    text: `${a}有 ${X}${unit}，比${b}${more ? '多' : '少'} ${p}/${q}。${b}有多少${unit.trim()}？`,
    o: N(rng, base, [(X * (q - p)) / q, (X * (q + p)) / q, more ? X - p * u - u : X + p * u + u, (X * q) / p, base + u], unit),
    explain: `把${b}看作单位“1”，${a}是${b}的 1 ${more ? '+' : '−'} ${p}/${q} = ${part}/${q}。${b}：${X} ÷ ${part}/${q} = ${base}${unit}。`,
  };
};

const fsUpDown: Tpl = (rng) => {
  const v = until(() => {
    const pc = pick(rng, [10, 20, 25, 50]);
    const P = randInt(rng, 1, 20) * 100;
    const P1 = (P * (100 + pc)) / 100;
    const P2 = (P1 * (100 - pc)) / 100;
    return Number.isInteger(P1) && Number.isInteger(P2) ? { pc, P, P1, P2 } : null;
  });
  const { pc, P, P1, P2 } = v;
  return {
    text: `一件商品原价 ${P} 元，先涨价 ${pc}%，再降价 ${pc}%。现价是多少元？`,
    o: N(rng, P2, [P, P1, (P * (100 - pc)) / 100, P2 - pc], ' 元'),
    explain: `涨价后：${P} × (1 + ${pc}%) = ${P1} 元；再降价：${P1} × (1 − ${pc}%) = ${P2} 元。两次的单位“1”不同，所以回不到原价。`,
  };
};

const fsTwoDays: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 2, 6);
    const b = randInt(rng, 2, 6);
    const T = a * b * randInt(rng, 2, 12);
    return T >= 40 && T <= 480 ? { a, b, T } : null;
  });
  const { a, b, T } = v;
  const X = (T * (a - 1) * (b - 1)) / (a * b);
  const naive = a * b - a - b > 0 ? (X * a * b) / (a * b - a - b) : 0;
  return {
    text: `一本书，第一天看了全书的 1/${a}，第二天看了余下的 1/${b}，还剩 ${X} 页。这本书共多少页？`,
    o: N(rng, T, [naive, X * a, X * b, T + a * b, T - a * b, X + a * b], ' 页'),
    explain: `第一天后剩全书的 ${frac(a - 1, a)}；第二天看了全书的 ${frac(a - 1, a)} × 1/${b} = ${frac(a - 1, a * b)}，还剩全书的 ${frac((a - 1) * (b - 1), a * b)}。${X} ÷ ${frac((a - 1) * (b - 1), a * b)} = ${T} 页。`,
  };
};

const fsTwoParts: Tpl = (rng) => {
  const v = until(() => {
    const [p1, q1] = properFrac(rng, 2, 6);
    const [p2, q2] = properFrac(rng, 2, 6);
    const L = lcm(q1, q2);
    const restN = L - (p1 * L) / q1 - (p2 * L) / q2;
    if (restN <= 0) return null;
    const T = L * randInt(rng, 2, 12);
    if (T > 600) return null;
    return { p1, q1, p2, q2, L, restN, T, X: (T / L) * restN };
  });
  const { p1, q1, p2, q2, L, restN, T, X } = v;
  const f3 = frac(restN, L);
  return {
    text: `一桶油，第一次用去全桶的 ${p1}/${q1}，第二次用去 ${X} 千克，这时还剩全桶的 ${p2}/${q2}。这桶油原有多少千克？`,
    o: N(rng, T, [(X * q1) / (q1 - p1), (X * q2) / p2, (X * q1) / p1, T + L, T - L, X + L], ' 千克'),
    explain: `第二次用去的占全桶的 1 − ${p1}/${q1} − ${p2}/${q2} = ${f3}，对应 ${X} 千克。${X} ÷ ${f3} = ${T} 千克。`,
  };
};

const GIRL_FRACS: [number, number][] = [
  [1, 3],
  [3, 8],
  [2, 5],
  [3, 7],
  [4, 9],
  [1, 2],
  [5, 9],
  [4, 7],
  [3, 5],
];

const fsGirlsJoin: Tpl = (rng) => {
  const v = until(() => {
    const i = randInt(rng, 0, GIRL_FRACS.length - 2);
    const j = randInt(rng, i + 1, GIRL_FRACS.length - 1);
    const [p1, q1] = GIRL_FRACS[i];
    const [p2, q2] = GIRL_FRACS[j];
    const b1 = q1 - p1;
    const b2 = q2 - p2;
    const B = lcm(b1, b2) * randInt(rng, 1, 4);
    const g1 = (B * p1) / b1;
    const g2 = (B * p2) / b2;
    const T = B + g1;
    const k = g2 - g1;
    if (T < 20 || T > 60 || k > 20 || k < 1) return null;
    return { p1, q1, p2, q2, b1, b2, B, g1, T, k };
  });
  const { p1, q1, p2, q2, b1, b2, B, g1, T, k } = v;
  const r1 = frac(p1, b1);
  const r2 = frac(p2, b2);
  const dn = p2 * b1 - p1 * b2;
  const dd = b1 * b2;
  const naiveN = k * q1 * q2;
  const naiveD = p2 * q1 - p1 * q2;
  return {
    text: `某班女生占全班人数的 ${p1}/${q1}，转来 ${k} 名女生后，女生占全班人数的 ${p2}/${q2}。原来全班有多少人？`,
    o: N(rng, T, [B, T + k, g1, naiveN / naiveD, T + q1, T - q1], ' 人'),
    explain: `男生人数不变。女生原来是男生的 ${r1}，后来是男生的 ${r2}，多出的 ${k} 人占男生的 ${frac(dn, dd)}。男生：${k} ÷ ${frac(dn, dd)} = ${B} 人，原来全班：${B} ÷ ${frac(b1, q1)} = ${T} 人。`,
  };
};

/* ───────────── 工程问题 ───────────── */

const JOBS: [string, string, string, string][] = [
  ['一项工程', '甲队', '乙队', '天'],
  ['修一条路', '甲队', '乙队', '天'],
  ['打一份稿件', '甲', '乙', '小时'],
  ['加工一批零件', '师傅', '徒弟', '小时'],
];

/** 合作天数为整数的 (a, b) */
function intPair(rng: Rng): { a: number; b: number; T: number } {
  return until(() => {
    const a = randInt(rng, 3, 40);
    const b = randInt(rng, 4, 60);
    if (a >= b || (a * b) % (a + b) !== 0) return null;
    return { a, b, T: (a * b) / (a + b) };
  });
}

const gcTogether: Tpl = (rng) => {
  const { a, b, T } = intPair(rng);
  const [job, A, B, u] = pick(rng, JOBS);
  return {
    text: `${job}，${A}单独做 ${a} ${u}完成，${B}单独做 ${b} ${u}完成。两${A.length > 1 && A.endsWith('队') ? '队' : '人'}合作，多少${u}可以完成？`,
    o: N(rng, T, [a + b, (a + b) / 2, b - a, T + 1, T - 1, T + 2], ` ${u}`),
    explain: `把工作总量看作 1，效率和 = 1/${a} + 1/${b} = ${frac(a + b, a * b)}。合作时间 = 1 ÷ ${frac(a + b, a * b)} = ${T} ${u}。`,
  };
};

const gcFracDone: Tpl = (rng) => {
  const a = randInt(rng, 5, 30);
  const k = randInt(rng, 2, a - 1);
  const [job, A, , u] = pick(rng, JOBS);
  const askLeft = rng() < 0.6;
  const ans = askLeft ? frac(a - k, a) : frac(k, a);
  return {
    text: `${job}，${A}单独做 ${a} ${u}完成。${A}做了 ${k} ${u}后，${askLeft ? '还剩这项工作的几分之几没完成' : '完成了这项工作的几分之几'}？`,
    o: buildOptions(rng, ans, [askLeft ? frac(k, a) : frac(a - k, a), `1/${a}`, `1/${k + 1}`, frac(k, a + k)], (j) => frac(1, a + j + 1)),
    explain: askLeft
      ? `${A}每${u}完成 1/${a}，${k} ${u}完成 ${k} × 1/${a} = ${frac(k, a)}。还剩 1 − ${frac(k, a)} = ${frac(a - k, a)}。`
      : `${A}每${u}完成这项工作的 1/${a}。${k} ${u}完成 ${k} × 1/${a} = ${frac(k, a)}。`,
  };
};

const gcOtherAlone: Tpl = (rng) => {
  const { a, b, T } = intPair(rng);
  const [job, A, B, u] = pick(rng, JOBS);
  const giveA = rng() < 0.5;
  const known = giveA ? a : b;
  const ans = giveA ? b : a;
  return {
    text: `${job}，${A}和${B}合作 ${T} ${u}完成，${A}单独做 ${known} ${u}完成。${B}单独做需要多少${u}？`,
    o: N(rng, ans, [known - T, known + T, known * T, ans + T, ans + 1], ` ${u}`),
    explain: `${B}的效率 = 效率和 − ${A}的效率 = 1/${T} − 1/${known} = ${frac(known - T, known * T)}。所以${B}单独做需要 ${ans} ${u}。`,
  };
};

const gcFirstAlone: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 6, 30);
    const b = randInt(rng, 6, 40);
    const k = randInt(rng, 1, a - 2);
    if (a === b || ((a - k) * b) % (a + b) !== 0) return null;
    return { a, b, k, x: ((a - k) * b) / (a + b) };
  });
  const { a, b, k, x } = v;
  return {
    text: `一项工程，甲单独做 ${a} 天完成，乙单独做 ${b} 天完成。甲先单独做 ${k} 天，剩下的两人合作，还要多少天完成？`,
    o: N(rng, x, [x + k, (a * b) / (a + b), (a * b) / (a + b) - k, x + 1, x - 1, x + 2], ' 天'),
    explain: `甲 ${k} 天完成 ${frac(k, a)}，还剩 ${frac(a - k, a)}。合作效率 = 1/${a} + 1/${b} = ${frac(a + b, a * b)}。${frac(a - k, a)} ÷ ${frac(a + b, a * b)} = ${x} 天。`,
  };
};

const gcLeave: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 6, 30);
    const b = randInt(rng, 6, 40);
    const k = randInt(rng, 1, 10);
    if (a === b || (k * (a + b)) % a !== 0) return null;
    const y = b - (k * (a + b)) / a;
    return y >= 1 ? { a, b, k, y } : null;
  });
  const { a, b, k, y } = v;
  const done = frac(k * (a + b), a * b);
  const left = frac(a * b - k * (a + b), a * b);
  return {
    text: `一项工程，甲单独做 ${a} 天完成，乙单独做 ${b} 天完成。两人合作 ${k} 天后甲离开，剩下的由乙单独做，还要多少天？`,
    o: N(rng, y, [b - k, b - 2 * k, y + k, y + 1, y - 1, y + 2], ' 天'),
    explain: `合作 ${k} 天完成 (1/${a} + 1/${b}) × ${k} = ${done}，还剩 ${left}。乙单独做：${left} ÷ 1/${b} = ${y} 天。`,
  };
};

const gcPool: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 2, 20);
    const b = randInt(rng, 3, 40);
    if (b <= a || (a * b) % (b - a) !== 0) return null;
    const t = (a * b) / (b - a);
    return t <= 60 ? { a, b, t } : null;
  });
  const { a, b, t } = v;
  return {
    text: `一个水池，单开进水管 ${a} 小时注满，单开排水管 ${b} 小时把满池水排空。两管同时打开，多少小时能把空池注满？`,
    o: N(rng, t, [(a * b) / (a + b), b - a, a + b, t + 1, t - 1, t + 2], ' 小时'),
    explain: `进水同时排水，每小时净进水 1/${a} − 1/${b} = ${frac(b - a, a * b)}。注满需要 1 ÷ ${frac(b - a, a * b)} = ${t} 小时。`,
  };
};

const gcThreePairs: Tpl = (rng) => {
  const v = until(() => {
    const ra = randInt(rng, 1, 6);
    const rb = randInt(rng, 1, 6);
    const rc = randInt(rng, 1, 6);
    if (ra === rb && rb === rc) return null;
    const all = ra + rb + rc;
    const W = lcm(lcm(ra + rb, rb + rc), lcm(ra + rc, all)) * randInt(rng, 1, 2);
    const x = W / (ra + rb);
    const y = W / (rb + rc);
    const z = W / (ra + rc);
    if (Math.max(x, y, z) > 72) return null;
    return { x, y, z, W, all, t: W / all };
  });
  const { x, y, z, W, all, t } = v;
  return {
    text: `一项工程，甲乙合作 ${x} 天完成，乙丙合作 ${y} 天完成，甲丙合作 ${z} 天完成。甲、乙、丙三人合作需要多少天？`,
    o: N(rng, t, [t / 2, (x + y + z) / 3, (x + y + z) / 2, t + 1, t - 1, t + 2, Math.min(x, y, z)], ' 天'),
    explain: `三个效率和相加，每人被算了 2 次：1/${x} + 1/${y} + 1/${z} = ${frac(2 * all, W)}。三人效率和 = ${frac(2 * all, W)} ÷ 2 = ${frac(all, W)}，合作需要 ${t} 天。`,
  };
};

const gcThenAlone: Tpl = (rng) => {
  const v = until(() => {
    const { a, b, T } = intPair(rng);
    const k = randInt(rng, 1, T - 1);
    const who = rng() < 0.5 ? a : b;
    if (T < 3 || (who * (T - k)) % T !== 0) return null;
    return { a, b, T, k, who, m: (who * (T - k)) / T };
  });
  const { a, b, T, k, who, m } = v;
  const other = who === a ? b : a;
  const left = frac(T - k, T);
  return {
    text: `一项工程，甲、乙合作 ${T} 天完成。两人合作 ${k} 天后，剩下的由甲单独做 ${m} 天完成。甲单独做这项工程需要多少天？`,
    o: N(rng, who, [other, m + k, T + m, m * T, who + T, who + 1], ' 天'),
    explain: `合作 ${k} 天完成 ${frac(k, T)}，还剩 ${left}。甲 ${m} 天完成 ${left}，甲的效率 = ${left} ÷ ${m} = 1/${who}，所以单独做需要 ${who} 天。`,
  };
};

const gcAlternate: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 4, 30);
    const b = randInt(rng, 4, 30);
    if (a === b) return null;
    const W = lcm(a, b);
    const ra = W / a;
    const rb = W / b;
    const c = Math.floor(W / (ra + rb));
    const rem = W - c * (ra + rb);
    if (rem !== 0 && rem !== ra) return null;
    if (c < 2) return null;
    return { a, b, W, ra, rb, c, rem, days: rem === 0 ? 2 * c : 2 * c + 1 };
  });
  const { a, b, W, ra, rb, c, rem, days } = v;
  return {
    text: `一项工程，甲单独做 ${a} 天完成，乙单独做 ${b} 天完成。两人轮流做，甲先做一天，乙再做一天，这样交替下去，共需多少天完成？`,
    o: N(rng, days, [c, days + 1, days - 1, days + 2, (a + b) / 2, days - 2], ' 天'),
    explain:
      `设工作总量为 ${W}，甲每天做 ${ra}，乙每天做 ${rb}，两天一轮共做 ${ra + rb}。${c} 轮（${2 * c} 天）后完成 ${c * (ra + rb)}，` +
      (rem === 0 ? `正好做完，共 ${days} 天。` : `还剩 ${rem}，甲再做 1 天正好完成，共 ${2 * c} + 1 = ${days} 天。`),
    verify: { kind: 'alternate', p: [a, b], ans: days },
  };
};

/* ───────────── 浓度问题 ───────────── */

const SOL: [string, string][] = [
  ['盐', '盐水'],
  ['糖', '糖水'],
];

const ndConc: Tpl = (rng) => {
  const [s, sw] = pick(rng, SOL);
  const v = until(() => {
    const total = pick(rng, [100, 200, 250, 400, 500]);
    const p = randInt(rng, 4, 40);
    const salt = (total * p) / 100;
    return Number.isInteger(salt) ? { total, p, salt } : null;
  });
  const { total, p, salt } = v;
  const water = total - salt;
  return {
    text: `把 ${salt} 克${s}完全溶解在 ${water} 克水中，得到的${sw}浓度是多少？`,
    o: N(rng, p, [(salt / water) * 100, 100 - p, p + 5, p - 2, p + 2], '%', true),
    explain: `浓度 = ${s} ÷ ${sw}。${sw}共 ${salt} + ${water} = ${total} 克，${salt} ÷ ${total} = ${p}%。`,
  };
};

const ndSolute: Tpl = (rng) => {
  const [s, sw] = pick(rng, SOL);
  const v = until(() => {
    const m = randInt(rng, 2, 16) * 50;
    const p = randInt(rng, 2, 40);
    const salt = (m * p) / 100;
    return Number.isInteger(salt) ? { m, p, salt } : null;
  });
  const { m, p, salt } = v;
  const askWater = rng() < 0.4;
  return {
    text: `浓度为 ${p}% 的${sw} ${m} 克，其中含${askWater ? '水' : s}多少克？`,
    o: N(rng, askWater ? m - salt : salt, [askWater ? salt : m - salt, m - p, salt * 10, salt / 10, salt + p], ' 克'),
    explain: askWater
      ? `含${s}：${m} × ${p}% = ${salt} 克。含水：${m} − ${salt} = ${m - salt} 克。`
      : `${s}的质量 = ${sw}质量 × 浓度。${m} × ${p}% = ${salt} 克。`,
  };
};

const ndSolution: Tpl = (rng) => {
  const [s, sw] = pick(rng, SOL);
  const v = until(() => {
    const p = pick(rng, [4, 5, 8, 10, 12, 15, 16, 20, 25]);
    const salt = randInt(rng, 2, 60);
    const total = (salt * 100) / p;
    return Number.isInteger(total) ? { p, salt, total } : null;
  });
  const { p, salt, total } = v;
  return {
    text: `用 ${salt} 克${s}配制浓度为 ${p}% 的${sw}，需要加水多少克？`,
    o: N(rng, total - salt, [total, salt * p, (salt * (100 - p)) / 100, total + salt, total - 2 * salt], ' 克'),
    explain: `${sw}质量 = ${s} ÷ 浓度 = ${salt} ÷ ${p}% = ${total} 克。需要加水 ${total} − ${salt} = ${total - salt} 克。`,
  };
};

const ndDilute: Tpl = (rng) => {
  const [s, sw] = pick(rng, SOL);
  const v = until(() => {
    const m = randInt(rng, 2, 12) * 50;
    const p1 = randInt(rng, 2, 8) * 5;
    const p2 = randInt(rng, 2, 30);
    const salt = (m * p1) / 100;
    const t2 = (salt * 100) / p2;
    if (p2 >= p1 || !Number.isInteger(salt) || !Number.isInteger(t2) || t2 > 4 * m) return null;
    return { m, p1, p2, salt, t2 };
  });
  const { m, p1, p2, salt, t2 } = v;
  return {
    text: `有浓度为 ${p1}% 的${sw} ${m} 克，要加水多少克，才能使浓度变为 ${p2}%？`,
    o: N(rng, t2 - m, [t2, (m * (p1 - p2)) / 100, (m * p2) / p1, t2 - m + salt, m], ' 克'),
    explain: `加水前后${s}不变：${m} × ${p1}% = ${salt} 克。新${sw}：${salt} ÷ ${p2}% = ${t2} 克，加水 ${t2} − ${m} = ${t2 - m} 克。`,
  };
};

const ndAddSalt: Tpl = (rng) => {
  const [s, sw] = pick(rng, SOL);
  const v = until(() => {
    const m = randInt(rng, 2, 12) * 50;
    const p1 = randInt(rng, 1, 8) * 5;
    const p2 = randInt(rng, 2, 10) * 5;
    const water = (m * (100 - p1)) / 100;
    const t2 = (water * 100) / (100 - p2);
    if (p2 <= p1 || !Number.isInteger(water) || !Number.isInteger(t2)) return null;
    return { m, p1, p2, water, t2 };
  });
  const { m, p1, p2, water, t2 } = v;
  return {
    text: `有浓度为 ${p1}% 的${sw} ${m} 克，要加${s}多少克，才能使浓度变为 ${p2}%？`,
    o: N(rng, t2 - m, [(m * (p2 - p1)) / 100, t2, (m * p2) / 100, t2 - m + 10, t2 - water], ' 克'),
    explain: `加${s}前后水不变：${m} × (1 − ${p1}%) = ${water} 克。新${sw}：${water} ÷ (1 − ${p2}%) = ${t2} 克，加${s} ${t2} − ${m} = ${t2 - m} 克。`,
  };
};

const ndMix: Tpl = (rng) => {
  const [s, sw] = pick(rng, SOL);
  const v = until(() => {
    const a = randInt(rng, 1, 8) * 50;
    const b = randInt(rng, 1, 8) * 50;
    const p1 = randInt(rng, 1, 8) * 5;
    const p2 = randInt(rng, 1, 8) * 5;
    const s1 = (a * p1) / 100;
    const s2 = (b * p2) / 100;
    const p3 = ((s1 + s2) * 100) / (a + b);
    if (p1 >= p2 || a === b || !Number.isInteger(s1) || !Number.isInteger(s2) || !Number.isInteger(p3)) return null;
    return { a, b, p1, p2, s1, s2, p3 };
  });
  const { a, b, p1, p2, s1, s2, p3 } = v;
  return {
    text: `把浓度为 ${p1}% 的${sw} ${a} 克和浓度为 ${p2}% 的${sw} ${b} 克混合，混合后的浓度是多少？`,
    o: N(rng, p3, [(p1 + p2) / 2, p1 + p2, (a * p2 + b * p1) / (a + b), p3 + 2, p3 - 2], '%', true),
    explain: `${s}共 ${a} × ${p1}% + ${b} × ${p2}% = ${s1} + ${s2} = ${s1 + s2} 克，${sw}共 ${a} + ${b} = ${a + b} 克。浓度 = ${s1 + s2} ÷ ${a + b} = ${p3}%。`,
  };
};

const ndEvaporate: Tpl = (rng) => {
  const [s, sw] = pick(rng, SOL);
  const v = until(() => {
    const m = randInt(rng, 2, 12) * 50;
    const p1 = randInt(rng, 2, 30);
    const p2 = randInt(rng, 2, 10) * 5;
    const salt = (m * p1) / 100;
    const t2 = (salt * 100) / p2;
    if (p2 <= p1 || !Number.isInteger(salt) || !Number.isInteger(t2) || t2 * 4 < m) return null;
    return { m, p1, p2, salt, t2 };
  });
  const { m, p1, p2, salt, t2 } = v;
  return {
    text: `有浓度为 ${p1}% 的${sw} ${m} 克，蒸发掉多少克水后，浓度变为 ${p2}%？`,
    o: N(rng, m - t2, [t2, (m * (p2 - p1)) / 100, m - salt, m - t2 + salt, (m * p1) / p2 / 2], ' 克'),
    explain: `蒸发前后${s}不变：${m} × ${p1}% = ${salt} 克。新${sw}：${salt} ÷ ${p2}% = ${t2} 克，蒸发掉 ${m} − ${t2} = ${m - t2} 克水。`,
  };
};

const ndMixAmount: Tpl = (rng) => {
  const [s, sw] = pick(rng, SOL);
  const v = until(() => {
    const a = randInt(rng, 1, 8) * 50;
    const p1 = randInt(rng, 1, 9) * 5;
    const p2 = randInt(rng, 1, 9) * 5;
    const p3 = randInt(rng, 6, 40);
    const lo = Math.min(p1, p2);
    const hi = Math.max(p1, p2);
    if (p3 <= lo || p3 >= hi) return null;
    const d1 = Math.abs(p3 - p1);
    const d2 = Math.abs(p2 - p3);
    if ((a * d1) % d2 !== 0 || (a * d1) % 100 !== 0) return null;
    const b = (a * d1) / d2;
    if (b === a || b > 1000) return null;
    return { a, p1, p2, p3, d1, d2, b };
  });
  const { a, p1, p2, p3, d1, d2, b } = v;
  const low = p1 < p3;
  return {
    text: `在 ${a} 克浓度为 ${p1}% 的${sw}中，加入多少克浓度为 ${p2}% 的${sw}，才能得到浓度为 ${p3}% 的${sw}？`,
    o: N(rng, b, [a, (a * d2) / d1, (a * d1) / 100, b + 50, b + a, b * 2], ' 克'),
    explain: `与目标 ${p3}% 相比，${a} 克 ${p1}% 的${sw}${low ? '少' : '多'} ${a} × ${d1}% = ${(a * d1) / 100} 克${s}；每克 ${p2}% 的${sw}${low ? '多' : '少'} ${d2}%。两者正好抵消：${(a * d1) / 100} ÷ ${d2}% = ${b} 克。`,
  };
};

const ndPourRefill: Tpl = (rng) => {
  const [s, sw] = pick(rng, SOL);
  const v = until(() => {
    const m = randInt(rng, 2, 10) * 50;
    const p = randInt(rng, 2, 8) * 5;
    const x = randInt(rng, 1, 16) * 10;
    if (x >= m) return null;
    const sugar = ((m - x) * p) / 100;
    const p2 = (sugar * 100) / m;
    return Number.isInteger(sugar) && Number.isInteger(p2) ? { m, p, x, sugar, p2 } : null;
  });
  const { m, p, x, sugar, p2 } = v;
  return {
    text: `一杯 ${m} 克、浓度为 ${p}% 的${sw}，倒出 ${x} 克后再加水到 ${m} 克。这时${sw}的浓度是多少？`,
    o: N(rng, p2, [p, (p * x) / m, p - (x * 100) / m, p2 + 2, p2 - 1, p2 + 1], '%', true),
    explain: `倒出后剩 ${m} − ${x} = ${m - x} 克，含${s} ${m - x} × ${p}% = ${sugar} 克。加水后仍是 ${m} 克：${sugar} ÷ ${m} = ${p2}%。`,
  };
};

/* ───────────── 比和比例 ───────────── */

function coprimePair(rng: Rng, lo: number, hi: number): [number, number] {
  return until(() => {
    const a = randInt(rng, lo, hi);
    const b = randInt(rng, lo, hi);
    return a !== b && gcd(a, b) === 1 ? ([a, b] as [number, number]) : null;
  });
}

const blSplit: Tpl = (rng) => {
  const [a, b] = coprimePair(rng, 1, 7);
  const u = randInt(rng, 3, 25);
  const S = (a + b) * u;
  const [thing, unit] = pick(rng, [
    ['本书', ' 本'],
    ['棵树苗', ' 棵'],
    ['个篮球', ' 个'],
  ] as [string, string][]);
  const askA = rng() < 0.5;
  const part = askA ? a : b;
  return {
    text: `把 ${S} ${thing}按 ${a}:${b} 分给甲、乙两个班。${askA ? '甲' : '乙'}班分得多少${unit.trim()}？`,
    o: N(rng, part * u, [(askA ? b : a) * u, S / part, u, (S * a) / b, S / 2], unit),
    explain: `总份数 ${a} + ${b} = ${a + b}，每份 ${S} ÷ ${a + b} = ${u}。${askA ? '甲' : '乙'}班占 ${part} 份：${u} × ${part} = ${part * u}${unit}。`,
  };
};

const blSimplify: Tpl = (rng) => {
  const [a, b] = coprimePair(rng, 1, 9);
  const g = pick(rng, [4, 6, 8, 9, 10, 12, 15, 16, 18, 20]);
  let sp = 2;
  while (g % sp !== 0) sp++;
  const x = a * g;
  const y = b * g;
  return {
    text: `把 ${x}:${y} 化成最简整数比，结果是多少？`,
    o: buildOptions(rng, `${a}:${b}`, [`${b}:${a}`, `${a * sp}:${b * sp}`, ratio(a + 1, b), ratio(a, b + 1)], (k) => ratio(a + k + 2, b)),
    explain: `比的前项和后项同时除以它们的最大公因数 ${g}。${x} ÷ ${g} = ${a}，${y} ÷ ${g} = ${b}，所以是 ${a}:${b}。`,
  };
};

const blSolve: Tpl = (rng) => {
  const [a, b] = coprimePair(rng, 2, 9);
  const k = randInt(rng, 2, 12);
  const c = a * k;
  const x = b * k;
  return {
    text: `在比例 ${a}:${b} = ${c}:x 中，x 等于多少？`,
    o: N(rng, x, [(a * c) / b, c, c + (b - a), x + k, x + b, x + 1]),
    explain: `两个外项的积等于两个内项的积：${a} × x = ${b} × ${c} = ${b * c}。x = ${b * c} ÷ ${a} = ${x}。`,
  };
};

const blScale: Tpl = (rng) => {
  const v = until(() => {
    const Nn = pick(rng, [50000, 100000, 200000, 500000, 1000000, 2000000]);
    const d = randInt(rng, 2, 15);
    const km = (d * Nn) / 100000;
    return Number.isInteger(km) ? { Nn, d, km } : null;
  });
  const { Nn, d, km } = v;
  return {
    text: `在比例尺是 1:${Nn} 的地图上，量得两地相距 ${d} 厘米。两地的实际距离是多少千米？`,
    o: N(rng, km, [km * 10, km / 10, km * 100, km + d, km * 2], ' 千米', true),
    explain: `实际距离 = 图上距离 × ${Nn}。${d} × ${Nn} = ${d * Nn} 厘米，1 千米 = 100000 厘米，所以是 ${km} 千米。`,
  };
};

const blTriple: Tpl = (rng) => {
  const angle = rng() < 0.5;
  if (angle) {
    const v = until(() => {
      const a = randInt(rng, 1, 7);
      const b = randInt(rng, a, 8);
      const c = randInt(rng, b + 1, 9);
      const s = a + b + c;
      return 180 % s === 0 && gcd(gcd(a, b), c) === 1 ? { a, b, c, u: 180 / s } : null;
    });
    const { a, b, c, u } = v;
    return {
      text: `一个三角形三个内角的度数比是 ${a}:${b}:${c}，最大的内角是多少度？`,
      o: N(rng, c * u, [a * u, b * u, 180 / c, u, c * u + u], '°'),
      explain: `三角形内角和是 180°，共 ${a} + ${b} + ${c} = ${a + b + c} 份，每份 180 ÷ ${a + b + c} = ${u}°。最大角占 ${c} 份：${u} × ${c} = ${c * u}°。`,
    };
  }
  const v = until(() => {
    const a = randInt(rng, 1, 6);
    const b = randInt(rng, 1, 6);
    const c = randInt(rng, 1, 6);
    return a !== b && b !== c && a !== c && gcd(gcd(a, b), c) === 1 ? { a, b, c } : null;
  });
  const { a, b, c } = v;
  const u = randInt(rng, 3, 20);
  const S = (a + b + c) * u;
  const which = randInt(rng, 0, 2);
  const names = ['红', '黄', '蓝'];
  const part = [a, b, c][which];
  return {
    text: `袋子里红、黄、蓝三种颜色的球共 ${S} 个，个数比是 ${a}:${b}:${c}。${names[which]}球有多少个？`,
    o: N(rng, part * u, [a * u, b * u, c * u, S / part, u, S / 3], ' 个'),
    explain: `共 ${a} + ${b} + ${c} = ${a + b + c} 份，每份 ${S} ÷ ${a + b + c} = ${u} 个。${names[which]}球占 ${part} 份：${u} × ${part} = ${part * u} 个。`,
  };
};

const blChain: Tpl = (rng) => {
  const v = until(() => {
    const [a, b] = coprimePair(rng, 2, 9);
    const [c, d] = coprimePair(rng, 2, 9);
    if (b === c) return null;
    const l = lcm(b, c);
    const x = (a * l) / b;
    const z = (d * l) / c;
    return ratio(x, z) !== ratio(a, d) ? { a, b, c, d, l, x, z } : null;
  });
  const { a, b, c, d, l, x, z } = v;
  const ans = ratio(x, z);
  return {
    text: `已知甲:乙 = ${a}:${b}，乙:丙 = ${c}:${d}。甲:丙是多少？`,
    o: buildOptions(rng, ans, [ratio(a, d), ratio(a * d, b * c), ratio(a + c, b + d), ratio(z, x)], (k) => ratio(x + k + 1, z)),
    explain: `把乙统一成 ${b} 和 ${c} 的最小公倍数 ${l}：甲:乙 = ${x}:${l}，乙:丙 = ${l}:${z}。所以甲:丙 = ${x}:${z}${ans !== `${x}:${z}` ? ` = ${ans}` : ''}。`,
  };
};

const blCircle: Tpl = (rng) => {
  const [a, b] = coprimePair(rng, 1, 9);
  const form = randInt(rng, 0, 2);
  const sq = `${a * a}:${b * b}`;
  const lin = `${a}:${b}`;
  const wrongs = [`${b * b}:${a * a}`, `${2 * a}:${b}`, `${a}:${2 * b}`, `${a * a * a}:${b * b * b}`];
  const fb = (k: number) => ratio(a + k + 1, b + k + 2);
  if (form === 0) {
    return {
      text: `两个圆的半径比是 ${a}:${b}，它们的面积比是多少？`,
      o: buildOptions(rng, sq, [lin, ...wrongs], fb),
      explain: `圆面积 = π × 半径 × 半径，面积比等于半径平方的比。(${a} × ${a}):(${b} × ${b}) = ${sq}。`,
    };
  }
  if (form === 1) {
    return {
      text: `两个圆的周长比是 ${a}:${b}，它们的面积比是多少？`,
      o: buildOptions(rng, sq, [lin, ...wrongs], fb),
      explain: `周长比等于半径比，所以半径比是 ${a}:${b}。面积比等于半径平方的比：(${a} × ${a}):(${b} × ${b}) = ${sq}。`,
    };
  }
  return {
    text: `两个圆的直径比是 ${a}:${b}，它们的周长比是多少？`,
    o: buildOptions(rng, lin, [sq, ...wrongs], fb),
    explain: `圆周长 = π × 直径，周长比等于直径比，所以周长比是 ${a}:${b}。`,
  };
};

const blSector: Tpl = (rng) => {
  const n = pick(rng, [20, 30, 36, 40, 45, 60, 72, 80, 90, 100, 108, 120, 135, 144, 150, 160, 210, 240, 270]);
  const r = randInt(rng, 2, 12);
  const ans = frac(n, 360);
  return {
    text: `半径 ${r} 厘米的圆中，有一个圆心角为 ${n}° 的扇形。扇形面积是这个圆面积的几分之几？`,
    o: buildOptions(rng, ans, [n < 180 ? frac(n, 180) : frac(n, 720), frac(n, 100 * Math.ceil(n / 100) + 100), frac(360 - n, 360), `1/${r}`], (k) => frac(1, k + 2)),
    explain: `扇形面积占圆面积的比例 = 圆心角 ÷ 360°，与半径无关。${n}/360 = ${ans}。`,
  };
};

const blTransfer: Tpl = (rng) => {
  const v = until(() => {
    const [a, b] = coprimePair(rng, 1, 9);
    const [c, d] = coprimePair(rng, 1, 9);
    if (a * (c + d) <= c * (a + b)) return null;
    const L = lcm(a + b, c + d);
    const T = L * randInt(rng, 1, 10);
    if (T > 600 || T < 30) return null;
    const A1 = (T * a) / (a + b);
    const A2 = (T * c) / (c + d);
    return { a, b, c, d, T, A1, A2, k: A1 - A2 };
  });
  const { a, b, c, d, T, A1, A2, k } = v;
  const dn = a * (c + d) - c * (a + b);
  const dd = (a + b) * (c + d);
  return {
    text: `甲、乙两人的钱数比是 ${a}:${b}，甲给乙 ${k} 元后，两人钱数比变为 ${c}:${d}。甲原来有多少元？`,
    o: N(rng, A1, [T, T - A1, A2, k * a, A1 + k, A1 - 2 * k], ' 元'),
    explain: `两人钱数的总和不变。甲原来占总数的 ${frac(a, a + b)}，后来占 ${frac(c, c + d)}，相差 ${frac(dn, dd)}。总数：${k} ÷ ${frac(dn, dd)} = ${T} 元，甲原有 ${T} × ${frac(a, a + b)} = ${A1} 元。`,
  };
};

const blRing: Tpl = (rng) => {
  const v = until(() => {
    const [x, y] = coprimePair(rng, 1, 9);
    return x > y ? { a: x, b: y } : null;
  });
  const { a, b } = v;
  const A = a * a;
  const B = b * b;
  const ans = `${A - B}:${B}`;
  return {
    text: `大、小两个同心圆的半径比是 ${a}:${b}。两圆之间的圆环面积与小圆面积的比是多少？`,
    o: buildOptions(rng, ans, [ratio(a - b, b), `${A}:${B}`, ratio((a - b) * (a - b), B), `${A - B}:${A}`], (k) => `${A - B + k + 1}:${B}`),
    explain: `面积比等于半径平方的比：大圆:小圆 = ${A}:${B}。圆环占 ${A} − ${B} = ${A - B} 份，所以圆环:小圆 = ${ans}。`,
  };
};

const blSectorRatio: Tpl = (rng) => {
  const v = until(() => {
    const n = pick(rng, [30, 45, 60, 90, 120, 150]);
    const m = pick(rng, [30, 45, 60, 90, 120, 150]);
    const [a, b] = coprimePair(rng, 1, 5);
    if (n === m) return null;
    return { n, m, a, b };
  });
  const { n, m, a, b } = v;
  const X = n * a * a;
  const Y = m * b * b;
  const ans = ratio(X, Y);
  return {
    text: `甲扇形的圆心角是 ${n}°，乙扇形的圆心角是 ${m}°，甲、乙的半径比是 ${a}:${b}。甲、乙两个扇形的面积比是多少？`,
    o: buildOptions(rng, ans, [ratio(n * a, m * b), ratio(n, m), `${a * a}:${b * b}`, ratio(Y, X)], (k) => ratio(X + (k + 1) * Y, Y)),
    explain: `扇形面积 = 圆面积 × 圆心角/360，所以面积比 = (${n} × ${a} × ${a}):(${m} × ${b} × ${b}) = ${X}:${Y} = ${ans}。`,
  };
};

const blSpeed: Tpl = (rng) => {
  const v = until(() => {
    const [x, y] = coprimePair(rng, 2, 9);
    return x > y ? { a: x, b: y } : null;
  });
  const { a, b } = v;
  const u = randInt(rng, 3, 30);
  const k = (a - b) * u;
  const D = (a + b) * u;
  return {
    text: `甲、乙两车同时从两地相向而行，速度比是 ${a}:${b}，相遇时甲比乙多行 ${k} 千米。两地相距多少千米？`,
    o: N(rng, D, [k * (a + b), a * u, b * u, D + k, D - k, 2 * D], ' 千米'),
    explain: `时间相同，路程比等于速度比 ${a}:${b}。甲比乙多 ${a} − ${b} = ${a - b} 份，每份 ${k} ÷ ${a - b} = ${u} 千米。全程 ${a} + ${b} = ${a + b} 份：${u} × ${a + b} = ${D} 千米。`,
  };
};

export const topics: Topic[] = [
  topic('g6-fenshu', 6, '分数百分数应用题', '找准单位“1”：单位“1”已知用乘法，未知用除法（量 ÷ 对应分率）', [
    [fsPartOf, fsWholeFrom, fsPercent],
    [fsRemainWhole, fsMoreThan, fsUpDown],
    [fsTwoDays, fsTwoParts, fsGirlsJoin],
  ]),
  topic('g6-gongcheng', 6, '工程问题', '把工作总量看作 1：工作效率 = 1 ÷ 工作时间，合作时间 = 1 ÷ 效率和', [
    [gcTogether, gcFracDone, gcOtherAlone],
    [gcFirstAlone, gcLeave, gcPool],
    [gcThreePairs, gcThenAlone, gcAlternate],
  ]),
  topic('g6-nongdu', 6, '浓度问题', '浓度 = 溶质 ÷ 溶液；加水时溶质不变，加溶质时水不变', [
    [ndConc, ndSolute, ndSolution],
    [ndDilute, ndAddSalt, ndMix],
    [ndEvaporate, ndMixAmount, ndPourRefill],
  ]),
  topic('g6-bili', 6, '比和比例', '按比分配先求每份；圆的面积比 = 半径比的平方；扇形占圆的 圆心角/360', [
    [blSplit, blSimplify, blSolve, blScale],
    [blTriple, blChain, blCircle, blSector],
    [blTransfer, blRing, blSectorRatio, blSpeed],
  ]),
];
