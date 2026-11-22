/** 四年级：鸡兔同笼、年龄问题、行程入门、等差数列 */
import type { Topic } from './types.ts';
import { randInt, pick } from './types.ts';
import type { Tpl, Rng, Draft } from './helpers.ts';
import { topic, N, two, until, NAMES } from './helpers.ts';

/* ───────────── 鸡兔同笼 ───────────── */

interface JituCtx {
  /** 每个“小”对象的量、每个“大”对象的量 */
  la: number;
  lb: number;
  na: string;
  nb: string;
  /** 对象的量词 */
  u: string;
  /** 总量的单位（腿、轮子、元…） */
  lu: string;
  text: (H: number, L: number) => string;
}

function jitu(rng: Rng, c: JituCtx): Draft {
  const x = randInt(rng, 3, 20);
  const y = randInt(rng, 3, 20);
  const H = x + y;
  const L = c.la * x + c.lb * y;
  const askB = rng() < 0.6;
  const diff = c.lb - c.la;
  const ans = askB ? y : x;
  const explain = askB
    ? `假设全是${c.na}，共 ${H} × ${c.la} = ${H * c.la} ${c.lu}，比实际少 ${L} − ${H * c.la} = ${L - H * c.la} ${c.lu}。每把一${c.u}${c.na}换成${c.nb}多 ${diff} ${c.lu}，${c.nb}：${L - H * c.la} ÷ ${diff} = ${y} ${c.u}。`
    : `假设全是${c.nb}，共 ${H} × ${c.lb} = ${H * c.lb} ${c.lu}，比实际多 ${H * c.lb} − ${L} = ${H * c.lb - L} ${c.lu}。每把一${c.u}${c.nb}换成${c.na}少 ${diff} ${c.lu}，${c.na}：${H * c.lb - L} ÷ ${diff} = ${x} ${c.u}。`;
  return {
    text: `${c.text(H, L)}${askB ? c.nb : c.na}有多少${c.u}？`,
    o: N(rng, ans, [askB ? x : y, L / c.lb, L - c.la * H, H / 2, ans + 1], ` ${c.u}`),
    explain,
    verify: { kind: 'jitu', p: [H, L, c.la, c.lb, askB ? 1 : 0], ans },
  };
}

const CTX_BASIC: JituCtx[] = [
  { la: 2, lb: 4, na: '鸡', nb: '兔', u: '只', lu: '条腿', text: (H, L) => `鸡和兔关在同一个笼子里，共有 ${H} 个头、${L} 条腿。` },
  { la: 2, lb: 3, na: '自行车', nb: '三轮车', u: '辆', lu: '个轮子', text: (H, L) => `停车场有自行车和三轮车共 ${H} 辆，一共 ${L} 个轮子。` },
  { la: 2, lb: 4, na: '鹤', nb: '龟', u: '只', lu: '条腿', text: (H, L) => `池塘边有鹤和龟共 ${H} 只，一共 ${L} 条腿。` },
];
const CTX_ADV: JituCtx[] = [
  { la: 2, lb: 5, na: '两元纸币', nb: '五元纸币', u: '张', lu: '元', text: (H, L) => `储蓄罐里有两元和五元的纸币共 ${H} 张，合计 ${L} 元。` },
  { la: 5, lb: 10, na: '五元纸币', nb: '十元纸币', u: '张', lu: '元', text: (H, L) => `钱包里有五元和十元的纸币共 ${H} 张，合计 ${L} 元。` },
  { la: 4, lb: 6, na: '小船', nb: '大船', u: '条', lu: '人', text: (H, L) => `${L} 人去划船，大船每条坐 6 人，小船每条坐 4 人，共租 ${H} 条船，正好坐满。` },
  { la: 3, lb: 8, na: '儿童票', nb: '成人票', u: '张', lu: '元', text: (H, L) => `成人票每张 8 元，儿童票每张 3 元，共卖出 ${H} 张，收入 ${L} 元。` },
  { la: 6, lb: 8, na: '蜻蜓', nb: '蜘蛛', u: '只', lu: '条腿', text: (H, L) => `蜘蛛有 8 条腿，蜻蜓有 6 条腿。蜘蛛和蜻蜓共 ${H} 只，一共 ${L} 条腿。` },
];

const jtBasic: Tpl = (rng) => jitu(rng, CTX_BASIC[0]);
const jtBasic2: Tpl = (rng) => jitu(rng, pick(rng, CTX_BASIC.slice(1)));
const jtAdv: Tpl = (rng) => jitu(rng, pick(rng, CTX_ADV));

const jtMore: Tpl = (rng) => {
  const r = randInt(rng, 3, 15);
  const k = randInt(rng, 2, 10);
  const L = 6 * r + 2 * k;
  const askRabbit = rng() < 0.5;
  const base = `先去掉多出的 ${k} 只鸡的 ${k} × 2 = ${2 * k} 条腿，剩 ${L} − ${2 * k} = ${L - 2 * k} 条。这时鸡兔同样多，一鸡一兔共 6 条腿，兔：${L - 2 * k} ÷ 6 = ${r} 只`;
  return {
    text: `笼子里鸡比兔多 ${k} 只，鸡和兔共有 ${L} 条腿。${askRabbit ? '兔' : '鸡'}有多少只？`,
    o: N(rng, askRabbit ? r : r + k, [askRabbit ? r + k : r, L / 6, (L - k) / 6, (L - 2 * k) / 4, r + 2 * k], ' 只'),
    explain: askRabbit ? `${base}。` : `${base}。鸡：${r} + ${k} = ${r + k} 只。`,
    verify: { kind: 'jituMore', p: [k, L, askRabbit ? 1 : 0], ans: askRabbit ? r : r + k },
  };
};

const jtScore: Tpl = (rng) => {
  const v = until(() => {
    const n = pick(rng, [10, 15, 20, 25, 30]);
    const a = pick(rng, [4, 5, 8, 10]);
    const b = randInt(rng, 1, 3);
    const w = randInt(rng, 1, Math.floor(n / 2));
    const S = a * (n - w) - b * w;
    return S > 0 ? { n, a, b, w, S } : null;
  });
  const { n, a, b, w, S } = v;
  const full = n * a;
  if (rng() < 0.5) {
    const [A] = two(rng, NAMES);
    return {
      text: `一次竞赛共 ${n} 题，答对一题得 ${a} 分，答错一题扣 ${b} 分。${A}全部作答，得了 ${S} 分。${A}答对了多少题？`,
      o: N(rng, n - w, [w, n - (full - S) / a, S / a, n - w + 1, n - w - 1], ' 题'),
      explain: `假设全对得 ${n} × ${a} = ${full} 分，实际少 ${full - S} 分。每错一题少 ${a} + ${b} = ${a + b} 分，错了 ${full - S} ÷ ${a + b} = ${w} 题，答对 ${n} − ${w} = ${n - w} 题。`,
      verify: { kind: 'score', p: [n, a, b, S, 1], ans: n - w },
    };
  }
  const item = pick(rng, ['花瓶', '玻璃杯', '瓷碗']);
  return {
    text: `搬运 ${n} 个${item}，每完好运到一个得运费 ${a} 元，打碎一个要赔 ${b} 元。最后得到 ${S} 元，打碎了多少个？`,
    o: N(rng, w, [n - w, (full - S) / a, (full - S) / b, w + 1, w + 2], ' 个'),
    explain: `假设全部完好，得 ${n} × ${a} = ${full} 元，实际少 ${full - S} 元。每打碎一个少得 ${a} + ${b} = ${a + b} 元，打碎了 ${full - S} ÷ ${a + b} = ${w} 个。`,
    verify: { kind: 'score', p: [n, a, b, S, 0], ans: w },
  };
};

const jtLegDiff: Tpl = (rng) => {
  const v = until(() => {
    const r = randInt(rng, 4, 18);
    const c = randInt(rng, 3, 18);
    const D = 4 * r - 2 * c;
    return D > 0 ? { r, c, D } : null;
  });
  const { r, c, D } = v;
  const H = r + c;
  return {
    text: `鸡和兔共 ${H} 只，兔的腿比鸡的腿多 ${D} 条。兔有多少只？`,
    o: N(rng, r, [c, (4 * H - D) / 2, D / 2, D / 4, r + 1, r - 1], ' 只'),
    explain: `假设全是兔，兔腿比鸡腿多 ${H} × 4 = ${4 * H} 条。每把一只兔换成鸡，差就减少 4 + 2 = 6 条。鸡：(${4 * H} − ${D}) ÷ 6 = ${c} 只，兔：${H} − ${c} = ${r} 只。`,
    verify: { kind: 'jituLegDiff', p: [H, D], ans: r },
  };
};

/* ───────────── 年龄问题 ───────────── */

const PARENT = ['爸爸', '妈妈'] as const;

const nlConstDiff: Tpl = (rng) => {
  const [A] = two(rng, NAMES);
  const P = pick(rng, PARENT);
  const s = randInt(rng, 6, 12);
  const d = randInt(rng, 24, 32);
  const M = s + d;
  const t = randInt(rng, s + 3, s + 15);
  return {
    text: `今年${P} ${M} 岁，${A} ${s} 岁。当${A} ${t} 岁时，${P}多少岁？`,
    o: N(rng, t + d, [M + t, d, M + s, t + d - s, M + t - 2 * s], ' 岁'),
    explain: `两人的年龄差不变：${M} − ${s} = ${d} 岁。${A} ${t} 岁时，${P}：${t} + ${d} = ${t + d} 岁。`,
  };
};

const nlSumDiff: Tpl = (rng) => {
  const [A] = two(rng, NAMES);
  const P = pick(rng, PARENT);
  const s = randInt(rng, 6, 14);
  const d = randInt(rng, 24, 32);
  const S = 2 * s + d;
  const askChild = rng() < 0.6;
  return {
    text: `${P}和${A}今年的年龄和是 ${S} 岁，${P}比${A}大 ${d} 岁。${askChild ? A : P}今年多少岁？`,
    o: N(rng, askChild ? s : s + d, [askChild ? s + d : s, S - d, S / 2, d], ' 岁'),
    explain: askChild
      ? `和差问题：小数 = (和 − 差) ÷ 2。${A}：(${S} − ${d}) ÷ 2 = ${s} 岁。`
      : `和差问题：大数 = (和 + 差) ÷ 2。${P}：(${S} + ${d}) ÷ 2 = ${s + d} 岁。`,
  };
};

const nlDiffTimes: Tpl = (rng) => {
  const [A] = two(rng, NAMES);
  const P = pick(rng, PARENT);
  const v = until(() => {
    const s = randInt(rng, 6, 13);
    const k = randInt(rng, 3, 5);
    const d = (k - 1) * s;
    return d >= 22 && d <= 36 ? { s, k, d } : null;
  });
  const { s, k, d } = v;
  const askChild = rng() < 0.6;
  const base = `年龄差是${A}年龄的 ${k} − 1 = ${k - 1} 倍。${A}：${d} ÷ ${k - 1} = ${s} 岁`;
  return {
    text: `${P}今年的年龄是${A}的 ${k} 倍，${P}比${A}大 ${d} 岁。${askChild ? A : P}今年多少岁？`,
    o: N(rng, askChild ? s : k * s, [askChild ? k * s : s, d / k, d / (k + 1), d, d + k], ' 岁'),
    explain: askChild ? `${base}。` : `${base}。${P}：${s} × ${k} = ${k * s} 岁。`,
  };
};

const nlYears: Tpl = (rng) => {
  const [A] = two(rng, NAMES);
  const P = pick(rng, PARENT);
  const later = rng() < 0.5;
  const v = until(() => {
    const k = randInt(rng, 2, 5);
    const s2 = randInt(rng, 4, 20);
    const x = randInt(rng, 2, 12);
    const s = later ? s2 - x : s2 + x;
    const d = (k - 1) * s2;
    const F = s + d;
    if (s < 3 || s > 16 || F < 27 || F > 50 || d < 20) return null;
    return { k, s2, x, s, d, F };
  });
  const { k, s2, x, s, d, F } = v;
  return {
    text: `今年${P} ${F} 岁，${A} ${s} 岁。几年${later ? '后' : '前'}${P}的年龄是${A}的 ${k} 倍？`,
    o: N(rng, x, [s2, d / k, x + 1, x - 1, x + 2, Math.abs(F - k * s)], ' 年'),
    explain:
      `年龄差不变：${F} − ${s} = ${d} 岁。${P}是${A}的 ${k} 倍时，${A}的年龄是 ${d} ÷ (${k} − 1) = ${s2} 岁。` +
      (later ? `${s2} − ${s} = ${x}，所以是 ${x} 年后。` : `${s} − ${s2} = ${x}，所以是 ${x} 年前。`),
    verify: { kind: 'ageTimes', p: [F, s, k, later ? 1 : 0], ans: x },
  };
};

const nlSumLater: Tpl = (rng) => {
  const v = until(() => {
    const k = randInt(rng, 3, 5);
    const s2 = randInt(rng, 7, 16);
    const x = randInt(rng, 2, 6);
    const s = s2 - x;
    const F2 = k * s2;
    if (s < 3 || F2 < 30 || F2 > 56 || F2 - s2 < 20) return null;
    return { k, s2, x, s, S: (k + 1) * s2 - 2 * x };
  });
  const { k, s2, x, s, S } = v;
  return {
    text: `父子二人今年的年龄和是 ${S} 岁，${x} 年后父亲的年龄是儿子的 ${k} 倍。儿子今年多少岁？`,
    o: N(rng, s, [s2, S / (k + 1), (S + x) / (k + 1) - x, s2 + x, s + 1], ' 岁'),
    explain: `${x} 年后两人的年龄和是 ${S} + ${x} × 2 = ${S + 2 * x} 岁。那时儿子：${S + 2 * x} ÷ (${k} + 1) = ${s2} 岁，今年：${s2} − ${x} = ${s} 岁。`,
    verify: { kind: 'ageSumLater', p: [S, x, k], ans: s },
  };
};

const nlTwoTimes: Tpl = (rng) => {
  const [A] = two(rng, NAMES);
  const P = pick(rng, PARENT);
  const v = until(() => {
    const s = randInt(rng, 6, 15);
    const k2 = randInt(rng, 2, 5);
    const F = k2 * s;
    const x = randInt(rng, 1, s - 1);
    if (F < 26 || F > 50 || F - s < 20) return null;
    if ((F - x) % (s - x) !== 0) return null;
    const k1 = (F - x) / (s - x);
    if (k1 > 9) return null;
    return { s, k2, F, x, k1 };
  });
  const { s, k2, F, x, k1 } = v;
  const askChild = rng() < 0.6;
  const base = `年龄差不变：差 = ${A}今年的 ${k2 - 1} 倍 = ${A} ${x} 年前的 ${k1 - 1} 倍。` + (k1 - k2 === 1 ? `两者相差的 1 倍正好是 ${k1 - 1} × ${x} = ${s} 岁，即${A}今年 ${s} 岁` : `所以${A}今年的 ${k1 - k2} 倍 = ${k1 - 1} × ${x} = ${(k1 - 1) * x}，${A}今年 ${(k1 - 1) * x} ÷ ${k1 - k2} = ${s} 岁`);
  return {
    text: `${x} 年前${P}的年龄是${A}的 ${k1} 倍，今年是${A}的 ${k2} 倍。${askChild ? A : P}今年多少岁？`,
    o: N(rng, askChild ? s : F, [askChild ? F : s, s - x, F - x, askChild ? s + x : F + x, askChild ? s + 1 : F - k2], ' 岁'),
    explain: askChild ? `${base}。` : `${base}。${P}：${s} × ${k2} = ${F} 岁。`,
    verify: { kind: 'ageTwoTimes', p: [x, k1, k2, askChild ? 1 : 0], ans: askChild ? s : F },
  };
};

const nlBrothers: Tpl = (rng) => {
  const a = randInt(rng, 2, 10);
  const d = randInt(rng, 2, 8);
  const b = a + 3 * d;
  const young = a + d;
  const old = a + 2 * d;
  const askOld = rng() < 0.5;
  const [E, Y] = pick(rng, [
    ['哥哥', '弟弟'],
    ['姐姐', '妹妹'],
  ] as [string, string][]);
  return {
    text: `${E}对${Y}说：“我像你这么大时，你才 ${a} 岁；你到我这么大时，我就 ${b} 岁了。”${askOld ? E : Y}今年多少岁？`,
    o: N(rng, askOld ? old : young, [askOld ? young : old, (a + b) / 2, b - a, a + 3 * d - 1, askOld ? old + d : young - 1], ' 岁'),
    explain: `两人年龄差不变，从 ${a} 岁到 ${b} 岁正好隔了 3 个年龄差：(${b} − ${a}) ÷ 3 = ${d} 岁。${Y}今年 ${a} + ${d} = ${young} 岁，${E}今年 ${young} + ${d} = ${old} 岁。`,
    verify: { kind: 'brothers', p: [a, b, askOld ? 1 : 0], ans: askOld ? old : young },
  };
};

const nlFamily: Tpl = (rng) => {
  const x = randInt(rng, 3, 8);
  const c = randInt(rng, 1, x - 1);
  const P = randInt(rng, 52, 72);
  const S = P + c;
  const T = P - 2 * x;
  const less = 3 * x - (S - T);
  return {
    text: `一家三口今年的年龄和是 ${S} 岁，${x} 年前全家的年龄和是 ${T} 岁。孩子今年多少岁？`,
    o: N(rng, c, [x - c, (S - T) / 3, x, S - T - x, c + 1], ' 岁'),
    explain: `若 ${x} 年前三人都已出生，年龄和应减少 ${x} × 3 = ${3 * x} 岁，实际只减少 ${S} − ${T} = ${S - T} 岁，少了 ${less} 岁。说明孩子 ${x} 年前还没出生，今年 ${x} − ${less} = ${c} 岁。`,
    verify: { kind: 'family', p: [S, T, x], ans: c },
  };
};

/* ───────────── 行程入门 ───────────── */

const xcMeetTime: Tpl = (rng) => {
  const t = randInt(rng, 2, 8);
  if (rng() < 0.5) {
    const a = randInt(rng, 7, 16) * 5;
    const b = randInt(rng, 6, 16) * 5;
    const D = (a + b) * t;
    return {
      text: `甲、乙两车同时从相距 ${D} 千米的两地相向而行，甲车每小时行 ${a} 千米，乙车每小时行 ${b} 千米。几小时后相遇？`,
      o: N(rng, t, [D / Math.abs(a - b), D / a, D / b, t + 1, t - 1], ' 小时'),
      explain: `相遇时间 = 路程 ÷ 速度和。${D} ÷ (${a} + ${b}) = ${D} ÷ ${a + b} = ${t} 小时。`,
    };
  }
  const [A, B] = two(rng, NAMES);
  const a = randInt(rng, 10, 18) * 5;
  const b = randInt(rng, 9, 16) * 5;
  const D = (a + b) * t;
  return {
    text: `${A}和${B}同时从相距 ${D} 米的两地相向而行，${A}每分钟走 ${a} 米，${B}每分钟走 ${b} 米。几分钟后相遇？`,
    o: N(rng, t, [D / Math.abs(a - b), D / a, D / b, t + 1, t - 1], ' 分钟'),
    explain: `相遇时间 = 路程 ÷ 速度和。${D} ÷ (${a} + ${b}) = ${D} ÷ ${a + b} = ${t} 分钟。`,
  };
};

const xcChaseTime: Tpl = (rng) => {
  const [A, B] = two(rng, NAMES);
  const b = randInt(rng, 10, 15) * 5;
  const diff = randInt(rng, 2, 8) * 5;
  const a = b + diff;
  const t = randInt(rng, 3, 15);
  const D = diff * t;
  return {
    text: `${A}在${B}前面 ${D} 米处，两人同时同向出发，${A}每分钟走 ${b} 米，${B}每分钟走 ${a} 米。${B}几分钟追上${A}？`,
    o: N(rng, t, [D / (a + b), D / a, D / b, t + 1, t - 1, t + 2], ' 分钟'),
    explain: `追及时间 = 路程差 ÷ 速度差。${D} ÷ (${a} − ${b}) = ${D} ÷ ${diff} = ${t} 分钟。`,
  };
};

const xcMeetDist: Tpl = (rng) => {
  const a = randInt(rng, 8, 16) * 5;
  const b = until(() => {
    const x = randInt(rng, 6, 16) * 5;
    return x === a ? null : x;
  });
  const t = randInt(rng, 2, 7);
  return {
    text: `甲、乙两车同时从两地相向而行，甲车每小时行 ${a} 千米，乙车每小时行 ${b} 千米，${t} 小时后相遇。两地相距多少千米？`,
    o: N(rng, (a + b) * t, [Math.abs(a - b) * t, a * t, b * t, a + b], ' 千米'),
    explain: `路程 = 速度和 × 相遇时间。(${a} + ${b}) × ${t} = ${a + b} × ${t} = ${(a + b) * t} 千米。`,
  };
};

const xcHeadStart: Tpl = (rng) => {
  const [A] = two(rng, NAMES);
  const P = pick(rng, PARENT);
  const v = until(() => {
    const a = randInt(rng, 5, 8) * 10;
    const h = randInt(rng, 3, 12);
    const b = randInt(rng, 15, 30) * 10;
    if ((a * h) % (b - a) !== 0) return null;
    return { a, h, b, t: (a * h) / (b - a) };
  });
  const { a, h, b, t } = v;
  return {
    text: `${A}以每分钟 ${a} 米的速度从家出发，${h} 分钟后${P}骑车以每分钟 ${b} 米的速度去追。${P}出发后几分钟追上？`,
    o: N(rng, t, [(a * h) / (a + b), t + h, (a * h) / b, h, t + 1, t + 2], ' 分钟'),
    explain: `${P}出发时${A}已走 ${a} × ${h} = ${a * h} 米。追及时间 = 路程差 ÷ 速度差：${a * h} ÷ (${b} − ${a}) = ${t} 分钟。`,
  };
};

const xcOtherSpeed: Tpl = (rng) => {
  const a = randInt(rng, 8, 16) * 5;
  const b = until(() => {
    const x = randInt(rng, 6, 16) * 5;
    return x === a ? null : x;
  });
  const t = randInt(rng, 2, 7);
  const D = (a + b) * t;
  return {
    text: `两地相距 ${D} 千米，甲、乙两车同时相向而行，${t} 小时相遇。甲车每小时行 ${a} 千米，乙车每小时行多少千米？`,
    o: N(rng, b, [a + b, a + b + a, a, D / t - b + 5, b + 5, b - 5], ' 千米'),
    explain: `速度和 = ${D} ÷ ${t} = ${a + b} 千米/时。乙车：${a + b} − ${a} = ${b} 千米/时。`,
  };
};

const xcRemaining: Tpl = (rng) => {
  const a = randInt(rng, 8, 16) * 5;
  const b = until(() => {
    const x = randInt(rng, 6, 16) * 5;
    return x === a ? null : x;
  });
  const t = randInt(rng, 2, 5);
  const r = randInt(rng, 2, 15) * 10;
  const D = (a + b) * t + r;
  return {
    text: `两地相距 ${D} 千米，甲、乙两车同时相向而行，甲每小时行 ${a} 千米，乙每小时行 ${b} 千米。${t} 小时后两车还相距多少千米？`,
    o: N(rng, r, [D - a * t, D - b * t, (a + b) * t, D - Math.abs(a - b) * t, r + 10], ' 千米'),
    explain: `${t} 小时两车共行 (${a} + ${b}) × ${t} = ${(a + b) * t} 千米。还相距 ${D} − ${(a + b) * t} = ${r} 千米。`,
  };
};

const xcMidpoint: Tpl = (rng) => {
  const v = until(() => {
    const b = randInt(rng, 8, 14) * 5;
    const a = b + randInt(rng, 1, 5) * 5;
    const t = randInt(rng, 2, 6);
    if (((a - b) * t) % 2 !== 0) return null;
    return { a, b, t, m: ((a - b) * t) / 2 };
  });
  const { a, b, t, m } = v;
  const D = (a + b) * t;
  return {
    text: `甲、乙两车同时从两地相向而行，甲每小时行 ${a} 千米，乙每小时行 ${b} 千米，相遇点距中点 ${m} 千米。两地相距多少千米？`,
    o: N(rng, D, [D / 2, D * 2, (a + b) * (t + 1), m * (a + b), (a - b) * t], ' 千米'),
    explain: `相遇时甲比乙多行 ${m} × 2 = ${2 * m} 千米，用时 ${2 * m} ÷ (${a} − ${b}) = ${t} 小时。两地相距 (${a} + ${b}) × ${t} = ${D} 千米。`,
  };
};

const xcRoundTrip: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 12, 24);
    const b = randInt(rng, 4, 10);
    const t = randInt(rng, 2, 6);
    if (((a + b) * t) % 2 !== 0) return null;
    return { a, b, t, D: ((a + b) * t) / 2 };
  });
  const { a, b, t, D } = v;
  return {
    text: `甲骑车、乙步行同时从 A 地去相距 ${D} 千米的 B 地，甲每小时行 ${a} 千米，乙每小时行 ${b} 千米。甲到 B 地后立即返回，出发后几小时与乙相遇？`,
    o: N(rng, t, [t / 2, (2 * D) / (a - b), D / (a - b), 2 * t, t + 1, t - 1], ' 小时'),
    explain: `从出发到相遇，两人合起来正好走了 2 个全程：${D} × 2 = ${2 * D} 千米。${2 * D} ÷ (${a} + ${b}) = ${t} 小时。`,
  };
};

const xcDog: Tpl = (rng) => {
  const a = randInt(rng, 10, 16) * 5;
  const b = randInt(rng, 9, 14) * 5;
  const t = randInt(rng, 4, 12);
  const c = randInt(rng, 15, 30) * 10;
  const D = (a + b) * t;
  return {
    text: `甲、乙从相距 ${D} 米的两地同时相向而行，每分钟分别走 ${a} 米和 ${b} 米。小狗以每分钟 ${c} 米在两人间来回跑，直到两人相遇。小狗共跑多少米？`,
    o: N(rng, c * t, [D, 2 * D, c * (t + 1), c * t * 2, (c * t) / 2, (a + b + c) * t], ' 米'),
    explain: `小狗跑的时间就是两人的相遇时间：${D} ÷ (${a} + ${b}) = ${t} 分钟。小狗共跑 ${c} × ${t} = ${c * t} 米。`,
  };
};

/* ───────────── 等差数列 ───────────── */

const dcNth: Tpl = (rng) => {
  const a = randInt(rng, 1, 20);
  const d = randInt(rng, 2, 9);
  const n = randInt(rng, 8, 30);
  const ans = a + (n - 1) * d;
  return {
    text: `等差数列 ${a}、${a + d}、${a + 2 * d}、… 的第 ${n} 项是多少？`,
    o: N(rng, ans, [a + n * d, a + (n - 2) * d, n * d, ans + 1]),
    explain: `第 n 项 = 首项 + (n − 1) × 公差，公差是 ${a + d} − ${a} = ${d}。${a} + (${n} − 1) × ${d} = ${a} + ${(n - 1) * d} = ${ans}。`,
    verify: { kind: 'apNth', p: [a, d, n], ans },
  };
};

const dcSum1n: Tpl = (rng) => {
  const n = randInt(rng, 10, 100);
  const ans = (n * (n + 1)) / 2;
  return {
    text: `1 + 2 + 3 + … + ${n} = ？`,
    o: N(rng, ans, [n * (n + 1), (n * n) / 2, (n * (n - 1)) / 2, ans + n, ans - 1]),
    explain: `等差数列求和 = (首项 + 末项) × 项数 ÷ 2。(1 + ${n}) × ${n} ÷ 2 = ${(n + 1) * n} ÷ 2 = ${ans}。`,
    verify: { kind: 'apSum', p: [1, 1, n], ans },
  };
};

const dcCount: Tpl = (rng) => {
  const a = randInt(rng, 1, 20);
  const d = randInt(rng, 2, 9);
  const n = randInt(rng, 8, 40);
  const l = a + (n - 1) * d;
  return {
    text: `等差数列 ${a}、${a + d}、${a + 2 * d}、…、${l} 一共有多少项？`,
    o: N(rng, n, [n - 1, n + 1, l / d, n + 2], ' 项'),
    explain: `项数 = (末项 − 首项) ÷ 公差 + 1。(${l} − ${a}) ÷ ${d} + 1 = ${n - 1} + 1 = ${n} 项。`,
    verify: { kind: 'apCount', p: [a, d, l], ans: n },
  };
};

const dcSum: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 1, 15);
    const d = randInt(rng, 2, 7);
    const n = randInt(rng, 8, 25);
    return { a, d, n, l: a + (n - 1) * d };
  });
  const { a, d, n, l } = v;
  const ans = ((a + l) * n) / 2;
  return {
    text: `${a} + ${a + d} + ${a + 2 * d} + … + ${l} = ？`,
    o: N(rng, ans, [((a + l) * (n - 1)) / 2, (a + l) * n, ((a + l) * (n + 1)) / 2, ans + d]),
    explain: `项数 = (${l} − ${a}) ÷ ${d} + 1 = ${n}。和 = (首项 + 末项) × 项数 ÷ 2 = (${a} + ${l}) × ${n} ÷ 2 = ${ans}。`,
    verify: { kind: 'apSumTo', p: [a, d, l], ans },
  };
};

const dcSeats: Tpl = (rng) => {
  const a = randInt(rng, 10, 25);
  const d = randInt(rng, 1, 3);
  const n = randInt(rng, 8, 20);
  const l = a + (n - 1) * d;
  const ans = ((a + l) * n) / 2;
  const [place] = pick(rng, [['剧场'], ['礼堂'], ['体育馆看台']] as [string][]);
  return {
    text: `${place}第一排有 ${a} 个座位，以后每排比前一排多 ${d} 个，共 ${n} 排。一共有多少个座位？`,
    o: N(rng, ans, [((a + l + d) * n) / 2, (a + l) * n, a * n, l * n, ans + n], ' 个'),
    explain: `最后一排：${a} + (${n} − 1) × ${d} = ${l} 个。总数 = (${a} + ${l}) × ${n} ÷ 2 = ${ans} 个。`,
    verify: { kind: 'apSum', p: [a, d, n], ans },
  };
};

const dcPipes: Tpl = (rng) => {
  const a = randInt(rng, 2, 9);
  const n = randInt(rng, 6, 16);
  const b = a + n - 1;
  const ans = ((a + b) * n) / 2;
  const [thing] = pick(rng, [['钢管'], ['圆木'], ['水管']] as [string][]);
  return {
    text: `一堆${thing}，最上层 ${a} 根，最下层 ${b} 根，每层比上一层多 1 根。这堆${thing}共多少根？`,
    o: N(rng, ans, [((a + b) * (n - 1)) / 2, (a + b) * n, ((a + b) * (n + 1)) / 2, a * b], ' 根'),
    explain: `层数 = ${b} − ${a} + 1 = ${n} 层。总数 = (${a} + ${b}) × ${n} ÷ 2 = ${ans} 根。`,
    verify: { kind: 'apSumTo', p: [a, 1, b], ans },
  };
};

const dcConsec: Tpl = (rng) => {
  const n = pick(rng, [5, 7, 9, 11]);
  const type = randInt(rng, 0, 2);
  const d = type === 0 ? 1 : 2;
  const name = ['自然数', '奇数', '偶数'][type];
  const half = (n - 1) / 2;
  const m = until(() => {
    const x = randInt(rng, half * d + 2, 60);
    if (type === 1 && x % 2 === 0) return null;
    if (type === 2 && x % 2 === 1) return null;
    return x;
  });
  const S = n * m;
  const askMax = rng() < 0.6;
  const ans = askMax ? m + half * d : m - half * d;
  return {
    text: `${n} 个连续${name}的和是 ${S}，其中最${askMax ? '大' : '小'}的一个是多少？`,
    o: N(rng, ans, [m, askMax ? m - half * d : m + half * d, askMax ? m + (n - 1) * d : m - half, askMax ? m + half : m + half * d + d, ans + d]),
    explain: `${n} 个数成等差数列，公差是 ${d}，中间数 = ${S} ÷ ${n} = ${m}。最${askMax ? '大' : '小'}数与中间数相差 ${half} 个公差：${m} ${askMax ? '+' : '−'} ${half} × ${d} = ${ans}。`,
    verify: { kind: 'apConsec', p: [n, d, S, askMax ? 1 : 0], ans },
  };
};

const dcTwoTerms: Tpl = (rng) => {
  const a = randInt(rng, 1, 20);
  const d = randInt(rng, 2, 9);
  const i = randInt(rng, 2, 6);
  const j = i + randInt(rng, 2, 8);
  const k = j + randInt(rng, 3, 20);
  const x = a + (i - 1) * d;
  const y = a + (j - 1) * d;
  const ans = a + (k - 1) * d;
  return {
    text: `一个等差数列的第 ${i} 项是 ${x}，第 ${j} 项是 ${y}，第 ${k} 项是多少？`,
    o: N(rng, ans, [y + (k - j + 1) * d, y + (k - j - 1) * d, x + (k - j) * d, y + k * d, y + (k - j) * (y - x)]),
    explain: `从第 ${i} 项到第 ${j} 项隔 ${j - i} 个公差：公差 = (${y} − ${x}) ÷ ${j - i} = ${d}。第 ${k} 项 = ${y} + (${k} − ${j}) × ${d} = ${ans}。`,
    verify: { kind: 'apTwoTerms', p: [i, x, j, y, k], ans },
  };
};

const dcDays: Tpl = (rng) => {
  const [A] = two(rng, NAMES);
  const a = randInt(rng, 2, 10);
  const d = randInt(rng, 1, 4);
  const n = randInt(rng, 5, 15);
  const l = a + (n - 1) * d;
  const S = ((a + l) * n) / 2;
  const [act, u] = pick(rng, [
    ['做', '道题'],
    ['读', '页书'],
    ['背', '个单词'],
  ] as [string, string][]);
  return {
    text: `${A}第一天${act} ${a} ${u}，以后每天比前一天多${act} ${d} ${u.slice(0, 1)}，一共${act}了 ${S} ${u}。共用了多少天？`,
    o: N(rng, n, [n - 1, n + 1, S / a, n + 2, n - 2], ' 天'),
    explain: `每天的数量成等差数列：${a}、${a + d}、${a + 2 * d}、…。试算：第 ${n} 天是 ${a} + (${n} − 1) × ${d} = ${l}，前 ${n} 天共 (${a} + ${l}) × ${n} ÷ 2 = ${S}，正好，所以用了 ${n} 天。`,
    verify: { kind: 'apDays', p: [a, d, S], ans: n },
  };
};

export const topics: Topic[] = [
  topic('g4-jitu', 4, '鸡兔同笼', '假设法：先假设全是一种，再用总差 ÷ 单个差求另一种的数量', [
    [jtBasic, jtBasic2],
    [jtAdv, jtMore],
    [jtScore, jtLegDiff],
  ]),
  topic('g4-nianling', 4, '年龄问题', '年龄差永远不变；几年后每人都要加上相同的年数', [
    [nlConstDiff, nlSumDiff, nlDiffTimes],
    [nlYears, nlSumLater],
    [nlTwoTimes, nlBrothers, nlFamily],
  ]),
  topic('g4-xingcheng', 4, '行程入门', '相遇：路程 ÷ 速度和；追及：路程差 ÷ 速度差', [
    [xcMeetTime, xcChaseTime, xcMeetDist],
    [xcHeadStart, xcOtherSpeed, xcRemaining],
    [xcMidpoint, xcRoundTrip, xcDog],
  ]),
  topic('g4-dengcha', 4, '等差数列', '第 n 项 = 首项 + (n−1)×公差；和 = (首项+末项)×项数÷2', [
    [dcNth, dcSum1n, dcCount],
    [dcSum, dcSeats, dcPipes],
    [dcConsec, dcTwoTerms, dcDays],
  ]),
];
