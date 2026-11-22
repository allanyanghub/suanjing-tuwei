/** 五年级：行程进阶、数论、几何面积、计数 */
import type { Topic } from './types.ts';
import { randInt, pick, gcd, lcm, shuffle, buildOptions } from './types.ts';
import type { Tpl } from './helpers.ts';
import { topic, N, two, until, isPrime, fact, NAMES } from './helpers.ts';

/* ───────────── 行程进阶 ───────────── */

const xjBoat: Tpl = (rng) => {
  const v = randInt(rng, 12, 30);
  const w = randInt(rng, 2, 6);
  const t = randInt(rng, 2, 8);
  const down = rng() < 0.5;
  const sp = down ? v + w : v - w;
  const D = sp * t;
  return {
    text: `一艘船在静水中每小时行 ${v} 千米，水流速度是每小时 ${w} 千米。它${down ? '顺' : '逆'}水航行 ${D} 千米需要几小时？`,
    o: N(rng, t, [D / v, D / (down ? v - w : v + w), t + 1, t - 1, t + 2], ' 小时'),
    explain: down
      ? `顺水速度 = 船速 + 水速 = ${v} + ${w} = ${sp} 千米/时。${D} ÷ ${sp} = ${t} 小时。`
      : `逆水速度 = 船速 − 水速 = ${v} − ${w} = ${sp} 千米/时。${D} ÷ ${sp} = ${t} 小时。`,
  };
};

const xjBridge: Tpl = (rng) => {
  const v = until(() => {
    const s = randInt(rng, 3, 6) * 5;
    const t = randInt(rng, 20, 60);
    const l = randInt(rng, 10, 30) * 10;
    const L = s * t - l;
    return L > l && L % 10 === 0 ? { s, t, l, L } : null;
  });
  const { s, t, l, L } = v;
  return {
    text: `一列火车长 ${l} 米，每秒行 ${s} 米，要完全通过一座长 ${L} 米的大桥，需要多少秒？`,
    o: N(rng, t, [L / s, (L - l) / s, t + 5, t - 5, t + 10], ' 秒'),
    explain: `完全通过要行的路程 = 桥长 + 车长 = ${L} + ${l} = ${L + l} 米。${L + l} ÷ ${s} = ${t} 秒。`,
  };
};

const xjRing: Tpl = (rng) => {
  const [A, B] = two(rng, NAMES);
  const opp = rng() < 0.5;
  const v = until(() => {
    const C = pick(rng, [200, 240, 300, 400, 480, 600, 800]);
    const a = randInt(rng, 3, 9);
    const b = randInt(rng, 2, a - 1);
    const sp = opp ? a + b : a - b;
    return C % sp === 0 ? { C, a, b, t: C / sp } : null;
  });
  const { C, a, b, t } = v;
  return {
    text: opp
      ? `环形跑道一圈 ${C} 米，${A}、${B}从同一地点同时背向而行，每秒分别跑 ${a} 米和 ${b} 米。几秒后两人第一次相遇？`
      : `环形跑道一圈 ${C} 米，${A}、${B}从同一地点同时同向而行，每秒分别跑 ${a} 米和 ${b} 米。几秒后${A}第一次追上${B}？`,
    o: N(rng, t, [C / (opp ? a - b : a + b), C / a, C / b, t + 10, t - 10, t * 2], ' 秒'),
    explain: opp
      ? `背向而行，第一次相遇时两人合跑一圈。${C} ÷ (${a} + ${b}) = ${t} 秒。`
      : `同向而行，追上时${A}比${B}多跑一圈。${C} ÷ (${a} − ${b}) = ${t} 秒。`,
  };
};

function boatInst(rng: () => number) {
  return until(() => {
    const v = randInt(rng, 8, 30);
    const w = randInt(rng, 2, 6);
    const vd = v + w;
    const vu = v - w;
    const D = lcm(vd, vu) * randInt(rng, 1, 3);
    const t1 = D / vd;
    const t2 = D / vu;
    if (D > 480 || t2 > 15 || t1 < 2) return null;
    return { v, w, vd, vu, D, t1, t2 };
  });
}

const xjBoatSpeeds: Tpl = (rng) => {
  const { v, w, vd, vu, D, t1, t2 } = boatInst(rng);
  const askW = rng() < 0.5;
  const base = `顺水速度 ${D} ÷ ${t1} = ${vd} 千米/时，逆水速度 ${D} ÷ ${t2} = ${vu} 千米/时。`;
  return {
    text: `一艘船顺水航行 ${D} 千米用 ${t1} 小时，逆水返回用 ${t2} 小时。${askW ? '水流速度' : '船在静水中的速度'}是每小时多少千米？`,
    o: N(rng, askW ? w : v, [askW ? v : w, vd - vu, vd, vu, vd + vu], ' 千米'),
    explain: askW
      ? `${base}水速 = (${vd} − ${vu}) ÷ 2 = ${w} 千米/时。`
      : `${base}静水速度 = (${vd} + ${vu}) ÷ 2 = ${v} 千米/时。`,
  };
};

const xjTrainLen: Tpl = (rng) => {
  const v = until(() => {
    const s = randInt(rng, 3, 6) * 5;
    const t = randInt(rng, 20, 60);
    const l = randInt(rng, 10, 30) * 10;
    const L = s * t - l;
    return L > l && L % 10 === 0 ? { s, t, l, L } : null;
  });
  const { s, t, l, L } = v;
  return {
    text: `一列火车每秒行 ${s} 米，完全通过一座长 ${L} 米的大桥用了 ${t} 秒。这列火车长多少米？`,
    o: N(rng, l, [s * t, s * t + L, L - l, l + 100, l - 50], ' 米'),
    explain: `${t} 秒火车共行 ${s} × ${t} = ${s * t} 米，这等于桥长 + 车长。车长 = ${s * t} − ${L} = ${l} 米。`,
  };
};

const xjRingDist: Tpl = (rng) => {
  const v = until(() => {
    const C = pick(rng, [300, 400, 600, 800]);
    const a = randInt(rng, 20, 32) * 10;
    const b = randInt(rng, 15, 28) * 10;
    if (a - b < 20 || C % (a - b) !== 0) return null;
    return { C, a, b, t: C / (a - b) };
  });
  const { C, a, b, t } = v;
  return {
    text: `环形跑道一圈 ${C} 米，甲每分钟跑 ${a} 米，乙每分钟跑 ${b} 米，两人同地同时同向出发。甲第一次追上乙时，甲跑了多少米？`,
    o: N(rng, a * t, [b * t, C, a * t + C, (a * C) / (a + b), (a - b) * t], ' 米'),
    explain: `追上时甲比乙多跑一圈 ${C} 米。追及时间 = ${C} ÷ (${a} − ${b}) = ${t} 分钟，甲跑了 ${a} × ${t} = ${a * t} 米。`,
  };
};

const xjBoatReturn: Tpl = (rng) => {
  const { w, vd, vu, D, t1, t2 } = boatInst(rng);
  return {
    text: `一艘船顺水航行 ${D} 千米用了 ${t1} 小时，水流速度是每小时 ${w} 千米。这艘船沿原路逆水返回需要几小时？`,
    o: N(rng, t2, [D / (vd - w), t1, t2 + 1, t2 - 1, t2 + 2, D / (vd + w)], ' 小时'),
    explain: `顺水速度 = ${D} ÷ ${t1} = ${vd} 千米/时。逆水速度比顺水速度少 2 个水速：${vd} − ${w} × 2 = ${vu} 千米/时。${D} ÷ ${vu} = ${t2} 小时。`,
  };
};

const xjTrainsPass: Tpl = (rng) => {
  const opp = rng() < 0.5;
  const v = until(() => {
    const s1 = randInt(rng, 18, 32);
    const s2 = randInt(rng, 10, 26);
    const l1 = randInt(rng, 12, 30) * 10;
    const l2 = randInt(rng, 12, 30) * 10;
    const sp = opp ? s1 + s2 : s1 - s2;
    if (sp < 3 || (l1 + l2) % sp !== 0) return null;
    const t = (l1 + l2) / sp;
    return t <= 120 ? { s1, s2, l1, l2, t } : null;
  });
  const { s1, s2, l1, l2, t } = v;
  const sum = l1 + l2;
  return {
    text: opp
      ? `两列火车相向而行，甲车长 ${l1} 米、每秒行 ${s1} 米，乙车长 ${l2} 米、每秒行 ${s2} 米。从车头相遇到车尾离开要多少秒？`
      : `快车长 ${l1} 米、每秒行 ${s1} 米，慢车长 ${l2} 米、每秒行 ${s2} 米，两车同向而行。快车从追上慢车到完全超过要多少秒？`,
    o: N(rng, t, [sum / (opp ? s1 - s2 : s1 + s2), l1 / (opp ? s1 + s2 : s1 - s2), sum / s1, t + 5, t - 2, t + 10], ' 秒'),
    explain: opp
      ? `错车时两车共行的路程 = 两车长度和 = ${l1} + ${l2} = ${sum} 米，速度用速度和。${sum} ÷ (${s1} + ${s2}) = ${t} 秒。`
      : `超车时快车比慢车多行两车长度和 = ${l1} + ${l2} = ${sum} 米，速度用速度差。${sum} ÷ (${s1} − ${s2}) = ${t} 秒。`,
  };
};

const xjRingBoth: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 4, 9);
    const b = randInt(rng, 2, a - 1);
    const C = lcm(a + b, a - b) * randInt(rng, 1, 40);
    if (C < 200 || C > 1200 || C % 20 !== 0) return null;
    return { a, b, C, t1: C / (a + b), t2: C / (a - b) };
  });
  const { a, b, C, t1, t2 } = v;
  const askA = rng() < 0.6;
  return {
    text: `一圈 ${C} 米的环形跑道上，甲、乙同地同时出发，甲比乙快。背向跑 ${t1} 秒相遇，同向跑 ${t2} 秒甲追上乙。${askA ? '甲' : '乙'}每秒跑多少米？`,
    o: N(rng, askA ? a : b, [askA ? b : a, a + b, a - b, (a + b) / 2, a + 1, b + 1], ' 米'),
    explain: `速度和 = ${C} ÷ ${t1} = ${a + b} 米/秒，速度差 = ${C} ÷ ${t2} = ${a - b} 米/秒。${askA ? `甲：(${a + b} + ${a - b}) ÷ 2 = ${a}` : `乙：(${a + b} − ${a - b}) ÷ 2 = ${b}`} 米/秒。`,
  };
};

/* ───────────── 数论 ───────────── */

const slGcd: Tpl = (rng) => {
  const v = until(() => {
    const g = randInt(rng, 2, 15);
    const m = randInt(rng, 2, 9);
    const n = randInt(rng, 2, 9);
    return m !== n && gcd(m, n) === 1 ? { g, a: g * m, b: g * n } : null;
  });
  const { g, a, b } = v;
  let sp = 2;
  while (g % sp !== 0) sp++;
  return {
    text: `${a} 和 ${b} 的最大公因数是多少？`,
    o: N(rng, g, [g / sp, g * 2, Math.abs(a - b), lcm(a, b), 1, g + 1]),
    explain: `${a} = ${g} × ${a / g}，${b} = ${g} × ${b / g}，而 ${a / g} 和 ${b / g} 互质，所以最大公因数是 ${g}。`,
    verify: { kind: 'gcd', p: [a, b], ans: g },
  };
};

const slLcm: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 4, 30);
    const b = randInt(rng, 4, 30);
    const g = gcd(a, b);
    return a !== b && g > 1 && a % b !== 0 && b % a !== 0 ? { a, b, g } : null;
  });
  const { a, b, g } = v;
  const l = lcm(a, b);
  return {
    text: `${a} 和 ${b} 的最小公倍数是多少？`,
    o: N(rng, l, [a * b, g, l * 2, l / 2, a + b]),
    explain: `${a} 和 ${b} 的最大公因数是 ${g}。最小公倍数 = ${a} × ${b} ÷ ${g} = ${l}。`,
    verify: { kind: 'lcm', p: [a, b], ans: l },
  };
};

const slPrimes: Tpl = (rng) => {
  const a = randInt(rng, 1, 50);
  const b = a + randInt(rng, 10, 20);
  const ps: number[] = [];
  for (let i = a; i <= b; i++) if (isPrime(i)) ps.push(i);
  const k = ps.length;
  return {
    text: `从 ${a} 到 ${b}（包括 ${a} 和 ${b}）的自然数中，质数有多少个？`,
    o: N(rng, k, [k + 1, k - 1, k + 2, k + 3], ' 个'),
    explain: `质数只有 1 和它本身两个因数（1 不是质数）。逐个判断，质数有 ${ps.join('、')}，共 ${k} 个。`,
    verify: { kind: 'primeCount', p: [a, b], ans: k },
  };
};

const slDivisors: Tpl = (rng) => {
  const v = until(() => {
    const n = randInt(rng, 12, 100);
    const pairs: string[] = [];
    let cnt = 0;
    for (let i = 1; i * i <= n; i++) {
      if (n % i === 0) {
        pairs.push(i * i === n ? `${i}×${i}` : `${i}×${n / i}`);
        cnt += i * i === n ? 1 : 2;
      }
    }
    return cnt >= 4 ? { n, pairs, cnt } : null;
  });
  const { n, pairs, cnt } = v;
  const sq = cnt % 2 === 1;
  return {
    text: `${n} 一共有多少个因数？`,
    o: N(rng, cnt, [cnt - 2, cnt - 1, cnt + 1, pairs.length, cnt + 2], ' 个'),
    explain: `成对列举：${n} = ${pairs.join(' = ')}。${sq ? `其中有一组两个因数相同，只算 1 个，` : ''}共 ${cnt} 个因数。`,
    verify: { kind: 'divCount', p: [n], ans: cnt },
  };
};

const slDigit9: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 1, 9);
    const b = randInt(rng, 0, 9);
    const d = randInt(rng, 0, 9);
    const s = a + b + d;
    return s % 9 === 0 ? null : { a, b, d, s, x: 9 - (s % 9) };
  });
  const { a, b, d, s, x } = v;
  return {
    text: `四位数 ${a}${b}□${d} 能被 9 整除，□ 里应填的数字是几？`,
    o: buildOptions(rng, String(x), [(x + 3) % 10, (x + 6) % 10, (x + 1) % 10, (x + 9) % 10].map(String), (k) => String(k % 10)),
    explain: `能被 9 整除的数，各位数字之和是 9 的倍数。已知三个数字的和是 ${a} + ${b} + ${d} = ${s}，${s} + ${x} = ${s + x} 是 9 的倍数，所以填 ${x}。`,
    verify: { kind: 'digit9', p: [a, b, d], ans: x },
  };
};

const slBus: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 4, 20);
    const b = randInt(rng, 4, 20);
    const l = lcm(a, b);
    return a < b && b % a !== 0 && l <= 120 && l !== a * b ? { a, b, l } : null;
  });
  const { a, b, l } = v;
  const ctx = pick(rng, [
    `1 路车每 ${a} 分钟发一班，2 路车每 ${b} 分钟发一班。两路车同时发车后，至少再过多少分钟又同时发车？`,
    `红灯每 ${a} 秒闪一次，绿灯每 ${b} 秒闪一次。两灯同时闪过后，至少再过多少秒又同时闪？`,
    `甲每 ${a} 天去一次图书馆，乙每 ${b} 天去一次。两人今天同时去了，至少再过多少天又同一天去？`,
  ]);
  const u = ctx.includes('秒') ? ' 秒' : ctx.includes('分钟') ? ' 分钟' : ' 天';
  return {
    text: ctx,
    o: N(rng, l, [a * b, gcd(a, b), a + b, l * 2, l / 2], u),
    explain: `再次同时发生的间隔必须同时是 ${a} 和 ${b} 的倍数，最少就是它们的最小公倍数。${a} 和 ${b} 的最小公倍数是 ${l}。`,
    verify: { kind: 'lcm', p: [a, b], ans: l },
  };
};

const slSquareCut: Tpl = (rng) => {
  const v = until(() => {
    const g = randInt(rng, 2, 12);
    const m = randInt(rng, 2, 9);
    const n = randInt(rng, 2, 9);
    return m > n && gcd(m, n) === 1 ? { g, m, n } : null;
  });
  const { g, m, n } = v;
  const a = g * m;
  const b = g * n;
  return {
    text: `把一张长 ${a} 厘米、宽 ${b} 厘米的长方形纸裁成同样大的正方形，且没有剩余。至少能裁多少个？`,
    o: N(rng, m * n, [g, m + n, a * b, (a * b) / g, m * n * 2], ' 个'),
    explain: `个数最少，正方形要最大，边长是 ${a} 和 ${b} 的最大公因数 ${g} 厘米。(${a} ÷ ${g}) × (${b} ÷ ${g}) = ${m} × ${n} = ${m * n} 个。`,
    verify: { kind: 'squareCut', p: [a, b], ans: m * n },
  };
};

const slCrt: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 3, 8);
    const b = randInt(rng, a + 1, 11);
    if (gcd(a, b) !== 1) return null;
    const r1 = randInt(rng, 1, a - 1);
    const r2 = randInt(rng, 1, b - 1);
    const list: number[] = [];
    for (let x = r2; x <= a * b + b; x += b) {
      list.push(x);
      if (x % a === r1) break;
    }
    const ans = list[list.length - 1];
    if (ans % a !== r1 || ans <= b || list.length < 2 || list.length > 7) return null;
    return { a, b, r1, r2, list, ans };
  });
  const { a, b, r1, r2, list, ans } = v;
  return {
    text: `一个自然数除以 ${a} 余 ${r1}，除以 ${b} 余 ${r2}。这个数最小是多少？`,
    o: N(rng, ans, [ans + b, ans + a, ans - b, ans + a * b, a * b + r1, ans - a]),
    explain: `先列出除以 ${b} 余 ${r2} 的数：${list.join('、')}、…。逐个检验，第一个除以 ${a} 余 ${r1} 的是 ${ans}，所以最小是 ${ans}。`,
    verify: { kind: 'crt', p: [a, r1, b, r2], ans },
  };
};

const slSameRem: Tpl = (rng) => {
  const v = until(() => {
    const n = randInt(rng, 6, 24);
    const r = randInt(rng, 1, n - 1);
    const p = randInt(rng, 2, 9);
    const q = randInt(rng, 2, 9);
    if (p >= q || gcd(p, q) !== 1) return null;
    return { n, r, A: n * p + r, B: n * q + r };
  });
  const { n, r, A, B } = v;
  const g0 = gcd(A, B);
  return {
    text: `${A} 和 ${B} 除以同一个自然数，余数都是 ${r}。这个自然数最大是多少？`,
    o: N(rng, n, [g0 > 1 ? g0 : n + r, B - A, r, n * 2, n + 1, n - 1]),
    explain: `去掉余数后就能整除：${A} − ${r} = ${A - r}，${B} − ${r} = ${B - r}。${A - r} 和 ${B - r} 的最大公因数是 ${n}，且 ${n} 大于余数 ${r}，所以最大是 ${n}。`,
    verify: { kind: 'sameRem', p: [A, B, r], ans: n },
  };
};

const slZeros: Tpl = (rng) => {
  const n = randInt(rng, 20, 130);
  const parts: number[] = [];
  const steps: string[] = [];
  for (let p = 5; p <= n; p *= 5) {
    parts.push(Math.floor(n / p));
    steps.push(`${p} 的倍数有 ${Math.floor(n / p)} 个`);
  }
  const ans = parts.reduce((x, y) => x + y, 0);
  return {
    text: `1 × 2 × 3 × … × ${n} 的积，末尾有多少个连续的 0？`,
    o: N(rng, ans, [parts[0], Math.floor(n / 10), ans + 1, ans - 1, ans + 2], ' 个'),
    explain: `末尾 0 的个数等于积里因数 5 的个数（因数 2 足够多）。1 到 ${n} 中，${steps.join('，')}${parts.length > 1 ? `，共 ${parts.join(' + ')} = ${ans} 个因数 5` : ''}，所以末尾有 ${ans} 个 0。`,
    verify: { kind: 'trailingZeros', p: [n], ans },
  };
};

const slTwoPrimes: Tpl = (rng) => {
  const p = until(() => {
    const x = randInt(rng, 5, 97);
    return isPrime(x) ? x : null;
  });
  const S = p + 2;
  return {
    text: `两个质数的和是 ${S}，这两个质数的积是多少？`,
    o: N(rng, 2 * p, [p, 2 * S, 2 * p + 2, 2 * p - 2, 3 * (S - 3)]),
    explain: `和 ${S} 是奇数，两个质数必是一奇一偶，而偶质数只有 2。另一个是 ${S} − 2 = ${p}，积 = 2 × ${p} = ${2 * p}。`,
    verify: { kind: 'twoPrimes', p: [S], ans: 2 * p },
  };
};

/* ───────────── 几何面积 ───────────── */

const LU = ['厘米', '分米', '米'] as const;

const jhTri: Tpl = (rng) => {
  const u = pick(rng, LU);
  const v = until(() => {
    const b = randInt(rng, 4, 30);
    const h = randInt(rng, 3, 20);
    return (b * h) % 2 === 0 ? { b, h } : null;
  });
  const { b, h } = v;
  return {
    text: `一个三角形的底是 ${b} ${u}，高是 ${h} ${u}，它的面积是多少平方${u}？`,
    o: N(rng, (b * h) / 2, [b * h, b + h, (b * h) / 4, 2 * (b + h)], ` 平方${u}`),
    explain: `三角形面积 = 底 × 高 ÷ 2。${b} × ${h} ÷ 2 = ${(b * h) / 2} 平方${u}。`,
  };
};

const jhTrap: Tpl = (rng) => {
  const u = pick(rng, LU);
  const v = until(() => {
    const a = randInt(rng, 3, 15);
    const b = a + randInt(rng, 2, 12);
    const h = randInt(rng, 3, 15);
    return ((a + b) * h) % 2 === 0 ? { a, b, h } : null;
  });
  const { a, b, h } = v;
  const S = ((a + b) * h) / 2;
  return {
    text: `一个梯形的上底是 ${a} ${u}，下底是 ${b} ${u}，高是 ${h} ${u}，它的面积是多少平方${u}？`,
    o: N(rng, S, [(a + b) * h, (a * b * h) / 2, b * h, a * h, S / 2], ` 平方${u}`),
    explain: `梯形面积 = (上底 + 下底) × 高 ÷ 2。(${a} + ${b}) × ${h} ÷ 2 = ${(a + b) * h} ÷ 2 = ${S} 平方${u}。`,
  };
};

const jhFindHeight: Tpl = (rng) => {
  const u = pick(rng, LU);
  const b = randInt(rng, 4, 25);
  const h = randInt(rng, 3, 20);
  if (rng() < 0.5) {
    const S = b * h;
    return {
      text: `一个平行四边形的面积是 ${S} 平方${u}，底是 ${b} ${u}，这条底上的高是多少${u}？`,
      o: N(rng, h, [h * 2, S - b, h + 1, h - 1, h + 2], ` ${u}`),
      explain: `平行四边形面积 = 底 × 高，所以高 = 面积 ÷ 底。${S} ÷ ${b} = ${h} ${u}。`,
    };
  }
  const v = until(() => {
    const bb = randInt(rng, 4, 25);
    const hh = randInt(rng, 3, 20);
    return (bb * hh) % 2 === 0 ? { bb, hh } : null;
  });
  const S = (v.bb * v.hh) / 2;
  return {
    text: `一个三角形的面积是 ${S} 平方${u}，底是 ${v.bb} ${u}，这条底上的高是多少${u}？`,
    o: N(rng, v.hh, [v.hh / 2, v.hh * 2, v.hh + 1, v.hh - 1, v.hh + 2], ` ${u}`),
    explain: `三角形面积 = 底 × 高 ÷ 2，所以高 = 面积 × 2 ÷ 底。${S} × 2 ÷ ${v.bb} = ${v.hh} ${u}。`,
  };
};

const jhRectCut: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 8, 20);
    const b = randInt(rng, 5, a - 1);
    const c = randInt(rng, 3, a - 1);
    const d = randInt(rng, 2, b - 1);
    return (c * d) % 2 === 0 ? { a, b, c, d } : null;
  });
  const { a, b, c, d } = v;
  const ans = a * b - (c * d) / 2;
  return {
    text: `长 ${a} 厘米、宽 ${b} 厘米的长方形纸，剪去一个两条直角边分别为 ${c} 厘米和 ${d} 厘米的直角三角形，剩下的面积是多少平方厘米？`,
    o: N(rng, ans, [a * b - c * d, a * b, a * b + (c * d) / 2, (c * d) / 2, (a * b - c * d) / 2], ' 平方厘米'),
    explain: `长方形面积 ${a} × ${b} = ${a * b}，直角三角形面积 ${c} × ${d} ÷ 2 = ${(c * d) / 2}。剩下 ${a * b} − ${(c * d) / 2} = ${ans} 平方厘米。`,
  };
};

const jhTrapHeight: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 3, 15);
    const b = a + randInt(rng, 2, 12);
    const h = randInt(rng, 4, 16);
    return ((a + b) * h) % 2 === 0 ? { a, b, h } : null;
  });
  const { a, b, h } = v;
  const S = ((a + b) * h) / 2;
  return {
    text: `一个梯形的面积是 ${S} 平方厘米，上底是 ${a} 厘米，下底是 ${b} 厘米，它的高是多少厘米？`,
    o: N(rng, h, [h / 2, h * 2, h + 1, h - 1, h + 2], ' 厘米'),
    explain: `高 = 面积 × 2 ÷ (上底 + 下底)。${S} × 2 ÷ (${a} + ${b}) = ${2 * S} ÷ ${a + b} = ${h} 厘米。`,
  };
};

const jhHypHeight: Tpl = (rng) => {
  const k = randInt(rng, 1, 15);
  const a = 3 * k;
  const b = 4 * k;
  const c = 5 * k;
  const area = 6 * k * k;
  const h = (12 * k) / 5;
  return {
    text: `直角三角形的两条直角边长 ${a} 厘米和 ${b} 厘米，斜边长 ${c} 厘米。斜边上的高是多少厘米？`,
    o: N(rng, h, [h / 2, (a + b) / 2, c / 2, h + 1, a * b / 2 / 10], ' 厘米', true),
    explain: `面积 = ${a} × ${b} ÷ 2 = ${area} 平方厘米。把斜边当作底：高 = ${area} × 2 ÷ ${c} = ${+h.toFixed(2)} 厘米。`,
  };
};

const jhEqualBase: Tpl = (rng) => {
  const form = randInt(rng, 0, 2);
  if (form === 0) {
    const S = randInt(rng, 12, 90) * 2;
    return {
      text: `一个三角形和一个平行四边形等底等高，平行四边形的面积是 ${S} 平方厘米。三角形的面积是多少平方厘米？`,
      o: N(rng, S / 2, [S, S * 2, S / 4, S / 2 + 2], ' 平方厘米'),
      explain: `等底等高时，三角形面积是平行四边形面积的一半。${S} ÷ 2 = ${S / 2} 平方厘米。`,
    };
  }
  if (form === 1) {
    const S = randInt(rng, 12, 90);
    return {
      text: `一个三角形和一个平行四边形等底等高，三角形的面积是 ${S} 平方厘米。平行四边形的面积是多少平方厘米？`,
      o: N(rng, S * 2, [S, S / 2, S * 4, S * 2 + 2], ' 平方厘米'),
      explain: `等底等高时，平行四边形面积是三角形面积的 2 倍。${S} × 2 = ${S * 2} 平方厘米。`,
    };
  }
  const h = randInt(rng, 3, 30);
  return {
    text: `一个三角形和一个平行四边形面积相等、底也相等，平行四边形的高是 ${h} 厘米。三角形的高是多少厘米？`,
    o: N(rng, h * 2, [h, h / 2, h * 4, h + 2], ' 厘米'),
    explain: `三角形面积 = 底 × 高 ÷ 2。面积和底都相等时，三角形的高必须是平行四边形高的 2 倍：${h} × 2 = ${h * 2} 厘米。`,
  };
};

const jhRatioSplit: Tpl = (rng) => {
  const k = randInt(rng, 2, 5);
  const u = randInt(rng, 4, 25);
  const S = (k + 1) * u;
  const askBig = rng() < 0.6;
  const base = `三角形 ABD 和 ADC 的高相同，面积的倍数等于底的倍数，ABD 是 ADC 的 ${k} 倍。ADC：${S} ÷ (${k} + 1) = ${u} 平方厘米`;
  return {
    text: `三角形 ABC 的面积是 ${S} 平方厘米，点 D 在边 BC 上，BD 的长是 DC 的 ${k} 倍。三角形 ${askBig ? 'ABD' : 'ADC'} 的面积是多少平方厘米？`,
    o: N(rng, askBig ? k * u : u, [askBig ? u : k * u, S / k, S / 2, S - k, S / (k + 2)], ' 平方厘米'),
    explain: askBig ? `${base}。ABD：${u} × ${k} = ${k * u} 平方厘米。` : `${base}。`,
  };
};

const jhRectPoint: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 6, 24);
    const b = randInt(rng, 4, 18);
    return a !== b && (a * b) % 2 === 0 ? { a, b } : null;
  });
  const { a, b } = v;
  const ans = (a * b) / 2;
  const f = (x: number) => `${x} 平方厘米`;
  return {
    text: `长方形 ABCD 中，AB = ${a} 厘米，BC = ${b} 厘米，E 是边 AB 上的任意一点。三角形 CDE 的面积是多少平方厘米？`,
    o: buildOptions(rng, f(ans), [f(a * b), '无法确定', (a * b) % 4 === 0 ? f(ans / 2) : f(a + b)], (k) => f(ans + k + 1)),
    explain: `以 CD 为底，CD = AB = ${a} 厘米；E 在 AB 上，到 CD 的距离总等于 BC = ${b} 厘米，与 E 的位置无关。面积 = ${a} × ${b} ÷ 2 = ${ans} 平方厘米。`,
  };
};

const jhTrapMaxTri: Tpl = (rng) => {
  const v = until(() => {
    const a = randInt(rng, 3, 14);
    const b = a + randInt(rng, 2, 10);
    const h = randInt(rng, 4, 16);
    return (a * h) % 2 === 0 && (b * h) % 2 === 0 ? { a, b, h } : null;
  });
  const { a, b, h } = v;
  const trap = ((a + b) * h) / 2;
  const tri = (b * h) / 2;
  return {
    text: `一个梯形上底 ${a} 厘米、下底 ${b} 厘米、高 ${h} 厘米。从中剪去一个最大的三角形，剩下部分的面积是多少平方厘米？`,
    o: N(rng, trap - tri, [tri, trap, a * h, ((b - a) * h) / 2, trap - (a * h) / 2], ' 平方厘米'),
    explain: `最大的三角形以下底 ${b} 厘米为底、高 ${h} 厘米，面积 ${b} × ${h} ÷ 2 = ${tri}。梯形面积 (${a} + ${b}) × ${h} ÷ 2 = ${trap}，剩下 ${trap} − ${tri} = ${trap - tri} 平方厘米。`,
  };
};

const jhMidSquare: Tpl = (rng) => {
  const a = randInt(rng, 2, 20) * 2;
  const half = a / 2;
  const sq = a * a;
  return {
    text: `正方形的边长是 ${a} 厘米，顺次连接四条边的中点得到一个小正方形。小正方形的面积是多少平方厘米？`,
    o: N(rng, sq / 2, [sq / 4, sq, half * 4, sq / 2 + half, (sq * 3) / 4], ' 平方厘米'),
    explain: `四个角各剪去一个直角边为 ${half} 厘米的直角三角形，四个共 ${half} × ${half} ÷ 2 × 4 = ${sq / 2}。小正方形面积 = ${a} × ${a} − ${sq / 2} = ${sq / 2} 平方厘米。`,
  };
};

/* ───────────── 计数 ───────────── */

const jsAdd: Tpl = (rng) => {
  const a = randInt(rng, 2, 9);
  const b = randInt(rng, 2, 9);
  const c = randInt(rng, 2, 6);
  return {
    text: `从甲地到乙地，每天有火车 ${a} 班、汽车 ${b} 班、轮船 ${c} 班。一天中从甲地到乙地共有多少种不同的走法？`,
    o: N(rng, a + b + c, [a * b * c, a * b + c, a + b, a * b], ' 种'),
    explain: `每一班车（船）都能独立到达，是分类，用加法原理。${a} + ${b} + ${c} = ${a + b + c} 种。`,
  };
};

const jsMul: Tpl = (rng) => {
  const a = randInt(rng, 2, 7);
  const b = randInt(rng, 2, 7);
  const c = randInt(rng, 2, 5);
  const form = randInt(rng, 0, 2);
  if (form === 0) {
    return {
      text: `小红有 ${a} 件上衣、${b} 条裤子和 ${c} 双鞋，各选一件搭配，共有多少种不同的穿法？`,
      o: N(rng, a * b * c, [a + b + c, a * b, a * b + c, (a + b) * c], ' 种'),
      explain: `选上衣、选裤子、选鞋是三个步骤，用乘法原理。${a} × ${b} × ${c} = ${a * b * c} 种。`,
      verify: { kind: 'product', p: [a, b, c], ans: a * b * c },
    };
  }
  if (form === 1) {
    return {
      text: `从 A 地到 B 地有 ${a} 条路，从 B 地到 C 地有 ${b} 条路。从 A 地经 B 地到 C 地，共有多少种不同的走法？`,
      o: N(rng, a * b, [a + b, a * b + 1, 2 * (a + b), a * b - 1], ' 种'),
      explain: `先从 A 到 B，再从 B 到 C，是分两步完成，用乘法原理。${a} × ${b} = ${a * b} 种。`,
      verify: { kind: 'product', p: [a, b], ans: a * b },
    };
  }
  return {
    text: `早餐店有 ${a} 种主食和 ${b} 种饮料，选一种主食配一种饮料，共有多少种不同的搭配？`,
    o: N(rng, a * b, [a + b, a * b + 1, 2 * (a + b), a * b - 1], ' 种'),
    explain: `先选主食，再选饮料，是分两步完成，用乘法原理。${a} × ${b} = ${a * b} 种。`,
    verify: { kind: 'product', p: [a, b], ans: a * b },
  };
};

const jsCards: Tpl = (rng) => {
  const m = randInt(rng, 3, 6);
  const ds = shuffle(rng, [1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, m).sort((x, y) => x - y);
  const ans = m * (m - 1);
  return {
    text: `用 ${ds.join('、')} 这 ${m} 张数字卡片，每次取两张摆成一个两位数，能摆出多少个不同的两位数？`,
    o: N(rng, ans, [m * m, ans / 2, 2 * m, m + m - 1], ' 个'),
    explain: `十位有 ${m} 种选法，个位从剩下的卡片中选，有 ${m - 1} 种。${m} × ${m - 1} = ${ans} 个。`,
    verify: { kind: 'digitNums', p: [0, 2, ...ds], ans },
  };
};

const jsArrange: Tpl = (rng) => {
  const n = randInt(rng, 4, 12);
  if (rng() < 0.5 || n > 9) {
    const ans = n * (n - 1);
    return {
      text: `从 ${n} 名同学中选出 2 人分别担任正、副班长，共有多少种不同的选法？`,
      o: N(rng, ans, [ans / 2, n * n, 2 * n, n + n - 1], ' 种'),
      explain: `正、副班长职务不同，有顺序。先选正班长有 ${n} 种，再选副班长有 ${n - 1} 种：${n} × ${n - 1} = ${ans} 种。`,
      verify: { kind: 'perm', p: [n, 2], ans },
    };
  }
  const ans = n * (n - 1) * (n - 2);
  return {
    text: `从 ${n} 名同学中选出 3 人分别担任班长、学习委员和体育委员，共有多少种不同的选法？`,
    o: N(rng, ans, [ans / 6, n * n * n, 3 * n, n * (n - 1)], ' 种'),
    explain: `三个职务不同，有顺序。依次选有 ${n}、${n - 1}、${n - 2} 种：${n} × ${n - 1} × ${n - 2} = ${ans} 种。`,
    verify: { kind: 'perm', p: [n, 3], ans },
  };
};

const jsHandshake: Tpl = (rng) => {
  const n = randInt(rng, 5, 20);
  const ans = (n * (n - 1)) / 2;
  const text = pick(rng, [
    `${n} 位朋友聚会，每两人握一次手，一共要握手多少次？`,
    `${n} 支球队进行单循环比赛（每两队之间赛一场），一共要赛多少场？`,
    `平面上有 ${n} 个点，任意三点不在同一直线上，每两点连一条线段，一共能连多少条？`,
  ]);
  const u = text.includes('握手') ? ' 次' : text.includes('球队') ? ' 场' : ' 条';
  return {
    text,
    o: N(rng, ans, [n * (n - 1), n * n, (n * (n + 1)) / 2, 2 * n, ans - n], u),
    explain: `每一个都要和其余 ${n - 1} 个配对，共 ${n} × ${n - 1} = ${n * (n - 1)}，但每一对被重复算了 2 次。${n * (n - 1)} ÷ 2 = ${ans}。`,
    verify: { kind: 'comb2', p: [n], ans },
  };
};

const jsRouteMix: Tpl = (rng) => {
  const a = randInt(rng, 2, 6);
  const b = randInt(rng, 2, 6);
  const c = randInt(rng, 2, 5);
  return {
    text: `从甲地到丙地，可以直达，有 ${c} 条路；也可以经过乙地：甲到乙有 ${a} 条路，乙到丙有 ${b} 条路。共有多少种不同的走法？`,
    o: N(rng, a * b + c, [a * b * c, a + b + c, (a + b) * c, a * b], ' 种'),
    explain: `分两类：直达有 ${c} 种；经过乙地分两步，有 ${a} × ${b} = ${a * b} 种。两类相加：${a * b} + ${c} = ${a * b + c} 种。`,
    verify: { kind: 'routeMix', p: [a, b, c], ans: a * b + c },
  };
};

/** 暴力数：用 ds 中的数字组成无重复数字的 len 位数；type 0 任意 / 1 偶数 / 2 奇数 */
function countNums(ds: number[], len: number, type: number): number {
  let cnt = 0;
  const lo = Math.pow(10, len - 1);
  for (let x = lo; x < lo * 10; x++) {
    const s = String(x).split('').map(Number);
    if (new Set(s).size !== len) continue;
    if (!s.every((d) => ds.includes(d))) continue;
    if (type === 1 && x % 2 !== 0) continue;
    if (type === 2 && x % 2 !== 1) continue;
    cnt++;
  }
  return cnt;
}

const jsDigitsZero: Tpl = (rng) => {
  const v = until(() => {
    const m = randInt(rng, 4, 5);
    const ds = [0, ...shuffle(rng, [1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, m - 1)].sort((x, y) => x - y);
    const type = randInt(rng, 0, 2);
    const E = ds.filter((d) => d !== 0 && d % 2 === 0).length;
    const O = ds.filter((d) => d % 2 === 1).length;
    if (type === 2 && O === 0) return null;
    return { m, ds, type, E, O };
  });
  const { m, ds, type, E, O } = v;
  const ans = countNums(ds, 3, type);
  let formula: number;
  let explain: string;
  if (type === 0) {
    formula = (m - 1) * (m - 1) * (m - 2);
    explain = `百位不能是 0，有 ${m - 1} 种；十位从剩下的 ${m - 1} 个数字中选，有 ${m - 1} 种；个位有 ${m - 2} 种。${m - 1} × ${m - 1} × ${m - 2} = ${formula} 个。`;
  } else if (type === 1) {
    const z = (m - 1) * (m - 2);
    const nz = E * (m - 2) * (m - 2);
    formula = z + nz;
    explain =
      `按个位分类。个位是 0：百位 ${m - 1} 种、十位 ${m - 2} 种，共 ${z} 个。` +
      (E > 0
        ? `个位是其余 ${E} 个偶数之一：百位不能是 0，有 ${m - 2} 种，十位 ${m - 2} 种，共 ${E} × ${m - 2} × ${m - 2} = ${nz} 个。合计 ${z} + ${nz} = ${formula} 个。`
        : `没有其他偶数数字，所以共 ${formula} 个。`);
  } else {
    formula = O * (m - 2) * (m - 2);
    explain = `个位必须是奇数，有 ${O} 种；百位不能是 0，也不能与个位相同，有 ${m - 2} 种；十位有 ${m - 2} 种。${O} × ${m - 2} × ${m - 2} = ${formula} 个。`;
  }
  if (formula !== ans) throw new Error(`jsDigitsZero: 公式 ${formula} 与枚举 ${ans} 不一致`);
  const typeName = ['三位数', '三位偶数', '三位奇数'][type];
  const naive = type === 0 ? m * (m - 1) * (m - 2) : type === 1 ? (E + 1) * (m - 1) * (m - 2) : O * (m - 1) * (m - 2);
  return {
    text: `用 ${ds.join('、')} 这 ${m} 个数字，能组成多少个没有重复数字的${typeName}？`,
    o: N(rng, ans, [naive, (m - 1) * (m - 1) * (m - 2), (m - 1) * (m - 2), ans + (m - 2), ans - (m - 2)], ' 个'),
    explain,
    verify: { kind: 'digitNums', p: [type, 3, ...ds], ans },
  };
};

const jsQueue: Tpl = (rng) => {
  const n = randInt(rng, 4, 6);
  const type = until(() => {
    const t = randInt(rng, 0, 3);
    return t === 3 && n !== 5 ? null : t;
  });
  const f1 = fact(n - 1);
  const cond = ['甲必须站在两端', '甲、乙两人必须相邻', '甲不能站在最左边', '甲必须站在正中间'][type];
  const ans = [2 * f1, 2 * f1, (n - 1) * f1, f1][type];
  const explain = [
    `甲站两端有 2 种选择，其余 ${n - 1} 人任意排，有 ${f1} 种。2 × ${f1} = ${ans} 种。`,
    `把甲、乙“捆”成一个整体，与其余 ${n - 2} 人共 ${n - 1} 个单位排列，有 ${f1} 种；甲、乙内部可交换，有 2 种。${f1} × 2 = ${ans} 种。`,
    `最左边不能是甲，有 ${n - 1} 种选择；其余 ${n - 1} 个位置任意排，有 ${f1} 种。${n - 1} × ${f1} = ${ans} 种。`,
    `甲的位置固定，其余 ${n - 1} 人在剩下的位置任意排：${Array.from({ length: n - 1 }, (_, i) => n - 1 - i).join(' × ')} = ${ans} 种。`,
  ][type];
  return {
    text: `${n} 个人站成一排照相，其中${cond}，共有多少种不同的站法？`,
    o: N(rng, ans, [fact(n), f1, fact(n) - f1, 2 * fact(n - 2), fact(n) / 2, ans * 2], ' 种'),
    explain,
    verify: { kind: 'queue', p: [n, type], ans },
  };
};

const jsPickMixed: Tpl = (rng) => {
  const a = randInt(rng, 3, 8);
  const b = randInt(rng, 2, 7);
  const type = randInt(rng, 0, 2);
  const all = ((a + b) * (a + b - 1)) / 2;
  const ca = (a * (a - 1)) / 2;
  const cb = (b * (b - 1)) / 2;
  const cond = ['要求至少有 1 名女生', '要求恰好 1 男 1 女', '要求 2 人性别相同'][type];
  const ans = [all - ca, a * b, ca + cb][type];
  const explain = [
    `任选 2 人有 ${a + b} × ${a + b - 1} ÷ 2 = ${all} 种，其中 2 人全是男生有 ${a} × ${a - 1} ÷ 2 = ${ca} 种。至少 1 名女生：${all} − ${ca} = ${ans} 种。`,
    `分两步：选 1 名男生有 ${a} 种，选 1 名女生有 ${b} 种。${a} × ${b} = ${ans} 种。`,
    `分两类：2 名男生有 ${a} × ${a - 1} ÷ 2 = ${ca} 种，2 名女生有 ${b} × ${b - 1} ÷ 2 = ${cb} 种。${ca} + ${cb} = ${ans} 种。`,
  ][type];
  return {
    text: `从 ${a} 名男生和 ${b} 名女生中选 2 人参加比赛，${cond}，共有多少种不同的选法？`,
    o: N(rng, ans, [all, a * b, ca + cb, all - cb, a + b, ca * cb, 2 * a * b], ' 种'),
    explain,
    verify: { kind: 'pickMixed', p: [a, b, type], ans },
  };
};

export const topics: Topic[] = [
  topic('g5-xingcheng', 5, '行程进阶', '流水行船：顺速=船速+水速；火车过桥：路程=桥长+车长；环形：相遇合跑一圈，追及多跑一圈', [
    [xjBoat, xjBridge, xjRing],
    [xjBoatSpeeds, xjTrainLen, xjRingDist],
    [xjBoatReturn, xjTrainsPass, xjRingBoth],
  ]),
  topic('g5-shulun', 5, '数论', '整除特征、质数与合数、最大公因数与最小公倍数、余数', [
    [slGcd, slLcm, slPrimes],
    [slDivisors, slDigit9, slBus, slSquareCut],
    [slCrt, slSameRem, slZeros, slTwoPrimes],
  ]),
  topic('g5-jihe', 5, '几何面积', '三角形=底×高÷2；梯形=(上底+下底)×高÷2；等底等高的三角形面积相等', [
    [jhTri, jhTrap, jhFindHeight],
    [jhRectCut, jhTrapHeight, jhHypHeight, jhEqualBase],
    [jhRatioSplit, jhRectPoint, jhTrapMaxTri, jhMidSquare],
  ]),
  topic('g5-jishu', 5, '计数', '分类用加法原理，分步用乘法原理；有顺序是排列，无顺序要除以重复', [
    [jsAdd, jsMul, jsCards],
    [jsArrange, jsHandshake, jsRouteMix],
    [jsDigitsZero, jsQueue, jsPickMixed],
  ]),
];
