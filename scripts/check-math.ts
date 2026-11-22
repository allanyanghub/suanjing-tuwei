/// <reference types="node" />
/**
 * 题库自检：npm run test:math
 *  - 每个专题 × 难度 1..3 各生成 400 题，检查结构、选项、文本合法性
 *  - 带 verify 元数据的题目，用独立的暴力/模拟解法重新求解并与答案比对
 *  - 统计每个专题 × 难度的不同题干数（须 ≥ 25）
 * 用法：node --experimental-strip-types scripts/check-math.ts [--sample [n]]
 */
import { topicById, makeQuestion } from '../src/math/index.ts';
import { topics as baseG3 } from '../src/math/g3.ts';
import { topics as baseG4 } from '../src/math/g4.ts';
import { topics as baseG5 } from '../src/math/g5.ts';
import { topics as baseG6 } from '../src/math/g6.ts';

// 本脚本只校验最初的 16 个专题；后来新增的专题各有独立脚本（verify-g3b.ts、verify-g4b.ts）。
const ALL_TOPICS = [...baseG3, ...baseG4, ...baseG5, ...baseG6];
const topicsOfGrade = (g: number) => ALL_TOPICS.filter((t) => t.grade === g);
import { mulberry32 } from '../src/math/types.ts';
import type { Difficulty, Question } from '../src/math/types.ts';
import type { CheckedQuestion } from '../src/math/helpers.ts';
import { COLORS, WEEK } from '../src/math/helpers.ts';

const PER = 400;
const MIN_DISTINCT = 25;
const MAX_TEXT = 90;

const EXPECTED: [string, string, number][] = [
  ['g3-hecha', '和差倍问题', 3],
  ['g3-zhishu', '植树问题', 3],
  ['g3-zhouqi', '周期问题', 3],
  ['g3-qiaosuan', '巧算与速算', 3],
  ['g4-jitu', '鸡兔同笼', 4],
  ['g4-nianling', '年龄问题', 4],
  ['g4-xingcheng', '行程入门', 4],
  ['g4-dengcha', '等差数列', 4],
  ['g5-xingcheng', '行程进阶', 5],
  ['g5-shulun', '数论', 5],
  ['g5-jihe', '几何面积', 5],
  ['g5-jishu', '计数', 5],
  ['g6-fenshu', '分数百分数应用题', 6],
  ['g6-gongcheng', '工程问题', 6],
  ['g6-nongdu', '浓度问题', 6],
  ['g6-bili', '比和比例', 6],
];

/* ───────────── 独立暴力解法 ───────────── */

function isPrimeB(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i < n; i++) if (n % i === 0) return false;
  return true;
}

/** 返回唯一解；无解或多解时抛错 */
function unique(sols: number[], what: string): number {
  const s = [...new Set(sols)];
  if (s.length !== 1) throw new Error(`${what}: 解不唯一或无解 [${s.join(',')}]`);
  return s[0];
}

function permutations(n: number): number[][] {
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

const BRUTE: Record<string, (p: number[], q: Question) => number> = {
  expr(_p, q) {
    const m = /巧算：(.+) = ？/.exec(q.text);
    if (!m) throw new Error('expr: 无法解析算式');
    const js = m[1].replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
    if (!/^[0-9+\-*/() ]+$/.test(js)) throw new Error(`expr: 非法字符 ${js}`);
    return Function(`"use strict";return (${js});`)() as number;
  },
  plant([L, g, mode]) {
    let n = 0;
    for (let x = 0; x <= L; x += g) {
      if (mode === 1 && x === L) continue; // 封闭：终点与起点重合
      if (mode === 2 && (x === 0 || x === L)) continue;
      n++;
    }
    if (L % g !== 0) throw new Error('plant: 不能整除');
    return mode === 3 ? 2 * n : n;
  },
  cycle([n, ...pat]) {
    let i = 0;
    for (let k = 1; k < n; k++) i = i + 1 === pat.length ? 0 : i + 1;
    return pat[i];
  },
  cycleColor(p, q) {
    return BRUTE.cycle(p, q);
  },
  weekday([w, n]) {
    let d = w;
    for (let k = 0; k < n; k++) d = d === 6 ? 0 : d + 1;
    return d;
  },
  cycleCount([n, ti, ...counts]) {
    const seq: number[] = [];
    while (seq.length < n) counts.forEach((c, i) => {
      for (let j = 0; j < c; j++) seq.push(i);
    });
    return seq.slice(0, n).filter((x) => x === ti).length;
  },
  cycleSum([n, ...pat]) {
    let s = 0;
    for (let k = 0; k < n; k++) s += pat[k % pat.length];
    return s;
  },
  powDigit([b, n]) {
    let d = 1;
    for (let k = 0; k < n; k++) d = (d * b) % 10;
    return d;
  },
  cycleKth([k, target, ...pat]) {
    let seen = 0;
    for (let i = 1; i < 100000; i++) {
      if (pat[(i - 1) % pat.length] === target && ++seen === k) return i;
    }
    throw new Error('cycleKth: 未找到');
  },
  jitu([H, L, la, lb, askB]) {
    const sols: number[] = [];
    for (let y = 0; y <= H; y++) if (la * (H - y) + lb * y === L) sols.push(askB ? y : H - y);
    return unique(sols, 'jitu');
  },
  jituMore([k, L, askRabbit]) {
    const sols: number[] = [];
    for (let r = 0; r <= 500; r++) if (4 * r + 2 * (r + k) === L) sols.push(askRabbit ? r : r + k);
    return unique(sols, 'jituMore');
  },
  score([n, a, b, S, askRight]) {
    const sols: number[] = [];
    for (let w = 0; w <= n; w++) if (a * (n - w) - b * w === S) sols.push(askRight ? n - w : w);
    return unique(sols, 'score');
  },
  jituLegDiff([H, D]) {
    const sols: number[] = [];
    for (let r = 0; r <= H; r++) if (4 * r - 2 * (H - r) === D) sols.push(r);
    return unique(sols, 'jituLegDiff');
  },
  ageTimes([F, s, k, later]) {
    const sols: number[] = [];
    for (let x = 1; x <= 100; x++) {
      if (later && F + x === k * (s + x)) sols.push(x);
      if (!later && s - x > 0 && F - x === k * (s - x)) sols.push(x);
    }
    return unique(sols, 'ageTimes');
  },
  ageSumLater([S, x, k]) {
    const sols: number[] = [];
    for (let s = 1; s < S; s++) if (S - s + x === k * (s + x)) sols.push(s);
    return unique(sols, 'ageSumLater');
  },
  ageTwoTimes([x, k1, k2, askChild]) {
    const sols: number[] = [];
    for (let s = x + 1; s <= 120; s++) if (k2 * s - x === k1 * (s - x)) sols.push(askChild ? s : k2 * s);
    return unique(sols, 'ageTwoTimes');
  },
  brothers([a, b, askOld]) {
    const sols: number[] = [];
    for (let y = 1; y <= 120; y++)
      for (let o = y + 1; o <= 120; o++) {
        const d = o - y;
        if (y - d === a && o + d === b) sols.push(askOld ? o : y);
      }
    return unique(sols, 'brothers');
  },
  family([S, T, x]) {
    const sols: number[] = [];
    for (let c = 0; c <= 40; c++) {
      const parents = S - c;
      const past = parents - 2 * x + (c >= x ? c - x : 0);
      if (past === T) sols.push(c);
    }
    return unique(sols, 'family');
  },
  apNth([a, d, n]) {
    let v = a;
    for (let i = 1; i < n; i++) v += d;
    return v;
  },
  apSum([a, d, n]) {
    let v = a;
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += v;
      v += d;
    }
    return s;
  },
  apCount([a, d, l]) {
    let c = 0;
    let v = a;
    for (; v < l; v += d) c++;
    if (v !== l) throw new Error('apCount: 末项不在数列中');
    return c + 1;
  },
  apSumTo([a, d, l]) {
    let s = 0;
    let v = a;
    for (; v <= l; v += d) s += v;
    if (v - d !== l) throw new Error('apSumTo: 末项不在数列中');
    return s;
  },
  apConsec([n, d, S, askMax]) {
    const sols: number[] = [];
    for (let st = 0; st <= S; st++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += st + i * d;
      if (s === S) sols.push(askMax ? st + (n - 1) * d : st);
    }
    return unique(sols, 'apConsec');
  },
  apTwoTerms([i, x, j, y, k]) {
    const sols: number[] = [];
    for (let d = 1; d <= 100; d++) {
      const a = x - (i - 1) * d;
      if (a + (j - 1) * d === y) sols.push(a + (k - 1) * d);
    }
    return unique(sols, 'apTwoTerms');
  },
  apDays([a, d, S]) {
    let s = 0;
    let v = a;
    for (let day = 1; day < 1000; day++) {
      s += v;
      v += d;
      if (s === S) return day;
      if (s > S) break;
    }
    throw new Error('apDays: 无法恰好做完');
  },
  gcd([a, b]) {
    for (let g = Math.min(a, b); g >= 1; g--) if (a % g === 0 && b % g === 0) return g;
    return 1;
  },
  lcm([a, b]) {
    for (let m = Math.max(a, b); ; m++) if (m % a === 0 && m % b === 0) return m;
  },
  primeCount([a, b]) {
    let c = 0;
    for (let i = a; i <= b; i++) if (isPrimeB(i)) c++;
    return c;
  },
  divCount([n]) {
    let c = 0;
    for (let i = 1; i <= n; i++) if (n % i === 0) c++;
    return c;
  },
  digit9([a, b, d]) {
    const sols: number[] = [];
    for (let x = 0; x <= 9; x++) if ((a * 1000 + b * 100 + x * 10 + d) % 9 === 0) sols.push(x);
    return unique(sols, 'digit9');
  },
  squareCut([a, b]) {
    for (let s = Math.min(a, b); s >= 1; s--) if (a % s === 0 && b % s === 0) return (a / s) * (b / s);
    return a * b;
  },
  crt([a, r1, b, r2]) {
    for (let x = 1; x < 100000; x++) if (x % a === r1 && x % b === r2) return x;
    throw new Error('crt: 无解');
  },
  sameRem([A, B, r]) {
    for (let n = Math.min(A, B); n >= 1; n--) if (A % n === r && B % n === r) return n;
    throw new Error('sameRem: 无解');
  },
  trailingZeros([n]) {
    let f = 1n;
    for (let i = 2n; i <= BigInt(n); i++) f *= i;
    let z = 0;
    while (f % 10n === 0n) {
      f /= 10n;
      z++;
    }
    return z;
  },
  twoPrimes([S]) {
    const sols: number[] = [];
    for (let p = 2; p <= S / 2; p++) if (isPrimeB(p) && isPrimeB(S - p)) sols.push(p * (S - p));
    return unique(sols, 'twoPrimes');
  },
  product(p) {
    let c = 0;
    const rec = (i: number) => {
      if (i === p.length) {
        c++;
        return;
      }
      for (let k = 0; k < p[i]; k++) rec(i + 1);
    };
    rec(0);
    return c;
  },
  routeMix([a, b, c]) {
    let n = 0;
    for (let i = 0; i < c; i++) n++;
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) n++;
    return n;
  },
  digitNums([type, len, ...ds]) {
    let c = 0;
    const cur: number[] = [];
    const rec = () => {
      if (cur.length === len) {
        const last = cur[len - 1];
        if (type === 1 && last % 2 !== 0) return;
        if (type === 2 && last % 2 !== 1) return;
        c++;
        return;
      }
      for (const d of ds) {
        if (cur.includes(d)) continue;
        if (cur.length === 0 && d === 0) continue;
        cur.push(d);
        rec();
        cur.pop();
      }
    };
    rec();
    return c;
  },
  perm([n, k]) {
    let c = 0;
    const cur: number[] = [];
    const rec = () => {
      if (cur.length === k) {
        c++;
        return;
      }
      for (let i = 0; i < n; i++) {
        if (cur.includes(i)) continue;
        cur.push(i);
        rec();
        cur.pop();
      }
    };
    rec();
    return c;
  },
  comb2([n]) {
    let c = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) c++;
    return c;
  },
  queue([n, type]) {
    let c = 0;
    for (const perm of permutations(n)) {
      const p0 = perm.indexOf(0); // 甲
      const p1 = perm.indexOf(1); // 乙
      const ok =
        type === 0 ? p0 === 0 || p0 === n - 1 : type === 1 ? Math.abs(p0 - p1) === 1 : type === 2 ? p0 !== 0 : p0 === (n - 1) / 2;
      if (ok) c++;
    }
    return c;
  },
  pickMixed([a, b, type]) {
    let c = 0;
    const n = a + b; // 前 a 个是男生
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const girls = (i >= a ? 1 : 0) + (j >= a ? 1 : 0);
        if (type === 0 ? girls >= 1 : type === 1 ? girls === 1 : girls !== 1) c++;
      }
    return c;
  },
  alternate([a, b]) {
    // 总量取 a×b：甲每天做 b，乙每天做 a
    let rem = a * b;
    let day = 0;
    while (rem > 0) {
      day++;
      rem -= day % 2 === 1 ? b : a;
    }
    if (rem !== 0) throw new Error('alternate: 最后一天不是整天');
    return day;
  },
};

/* ───────────── 主流程 ───────────── */

const failures: string[] = [];
function fail(msg: string) {
  if (failures.length < 60) failures.push(msg);
  else if (failures.length === 60) failures.push('…（更多失败已省略）');
}

const BAD = ['NaN', 'undefined', 'Infinity', 'null', '[object'];

function checkQuestion(q: CheckedQuestion, topicId: string, grade: number, d: number, tag: string): void {
  const where = `${tag} 「${q.text}」`;
  if (q.topicId !== topicId) fail(`${where}: topicId=${q.topicId}`);
  if (q.grade !== grade) fail(`${where}: grade=${q.grade}`);
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
  const correct = q.options?.[q.answer] ?? '';
  // 解析中必须出现正确答案的数值部分
  const core = /^[0-9][0-9.:/]*/.exec(correct)?.[0] ?? correct;
  if (!q.explain.includes(core)) fail(`${where}: 解析中未出现答案 ${core}｜${q.explain}`);

  if (q.verify) {
    const { kind, p, ans } = q.verify;
    const solver = BRUTE[kind];
    if (!solver) {
      fail(`${where}: 未知校验类型 ${kind}`);
      return;
    }
    try {
      const got = solver(p, q);
      if (got !== ans) fail(`${where}: 暴力解 ${got} ≠ 答案 ${ans} (${kind} ${p.join(',')})`);
    } catch (e) {
      fail(`${where}: 校验异常 ${(e as Error).message}`);
    }
    const expectOpt =
      kind === 'cycleColor' ? `${COLORS[ans]}色` : kind === 'weekday' ? `星期${WEEK[ans]}` : null;
    if (expectOpt !== null) {
      if (correct !== expectOpt) fail(`${where}: 正确选项 ${correct} ≠ ${expectOpt}`);
    } else if (parseFloat(correct) !== ans) {
      fail(`${where}: 正确选项 ${correct} 与校验答案 ${ans} 不符`);
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const si = args.indexOf('--sample');
  if (si >= 0) {
    const n = Number(args[si + 1]) || 1;
    for (const t of ALL_TOPICS) {
      for (const d of [2, 3] as Difficulty[]) {
        const rng = mulberry32(Date.now() % 100000 + t.id.length * 977 + d);
        for (let i = 0; i < n; i++) {
          const q = t.gen(d, rng);
          console.log(`\n[${t.id} ${t.name} 难度${d}] ${q.text}`);
          console.log(`  ${q.options.map((o, k) => `${k === q.answer ? '✔' : ' '}${'ABCD'[k]}. ${o}`).join('   ')}`);
          console.log(`  解析：${q.explain}`);
        }
      }
    }
    return;
  }

  // 专题清单
  if (ALL_TOPICS.length !== 16) fail(`专题数 ${ALL_TOPICS.length} ≠ 16`);
  EXPECTED.forEach(([id, name, grade], i) => {
    const t = ALL_TOPICS[i];
    if (!t || t.id !== id || t.name !== name || t.grade !== grade) fail(`专题 ${i} 应为 ${id}/${name}/${grade}，实际 ${t?.id}/${t?.name}/${t?.grade}`);
    else if (topicById(id) !== t) fail(`topicById(${id}) 不一致`);
    if (t && (!t.hint || t.hint.trim() === '')) fail(`专题 ${id} 缺少 hint`);
  });
  for (const g of [3, 4, 5, 6]) if (topicsOfGrade(g).length !== 4) fail(`${g} 年级专题数 ≠ 4`);
  let threw = false;
  try {
    topicById('no-such-topic');
  } catch {
    threw = true;
  }
  if (!threw) fail('topicById 对未知 id 未抛错');

  let total = 0;
  let verified = 0;
  let maxText = 0;
  let maxExplain = 0;
  const kinds = new Map<string, number>();
  const rows: string[] = [];

  ALL_TOPICS.forEach((t, ti) => {
    const cells: string[] = [];
    for (const d of [1, 2, 3] as Difficulty[]) {
      const rng = mulberry32((ti * 31 + d) * 7919 + 12345);
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
        checkQuestion(q, t.id, t.grade, d, `${t.id} d${d} #${i}`);
        texts.add(q.text);
        maxText = Math.max(maxText, q.text.length);
        maxExplain = Math.max(maxExplain, q.explain.length);
        if (q.verify) {
          verified++;
          kinds.set(q.verify.kind, (kinds.get(q.verify.kind) ?? 0) + 1);
        }
      }
      if (texts.size < MIN_DISTINCT) fail(`${t.id} d${d}: 不同题干仅 ${texts.size} 个（要求 ≥ ${MIN_DISTINCT}）`);
      cells.push(String(texts.size).padStart(4));
    }
    rows.push(`  ${t.id.padEnd(14)} ${cells.join('  ')}   ${t.name}`);
  });

  // makeQuestion 冒烟测试
  {
    const rng = mulberry32(2026);
    const ids = ['g3-hecha', 'g5-shulun', 'g6-bili'];
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const d = ((i % 3) + 1) as Difficulty;
      const q = makeQuestion(ids, d, rng) as CheckedQuestion;
      if (!ids.includes(q.topicId)) fail(`makeQuestion 返回了范围外的专题 ${q.topicId}`);
      checkQuestion(q, q.topicId, topicById(q.topicId).grade, d, `makeQuestion #${i}`);
      seen.add(q.topicId);
    }
    if (seen.size !== ids.length) fail(`makeQuestion 未覆盖全部专题：${[...seen].join(',')}`);
    // 同种子可复现
    const a = makeQuestion(ids, 2, mulberry32(7));
    const b = makeQuestion(ids, 2, mulberry32(7));
    if (a.text !== b.text || a.answer !== b.answer) fail('makeQuestion 同种子结果不一致');
  }

  console.log(`不同题干数（每格 ${PER} 题）：`);
  console.log(`  ${'专题'.padEnd(12)}   d1    d2    d3`);
  for (const r of rows) console.log(r);
  console.log(`\n共生成 ${total} 题；其中 ${verified} 题经独立暴力/模拟解法复核（${kinds.size} 类）。`);
  console.log(`题干最长 ${maxText} 字（上限 ${MAX_TEXT}），解析最长 ${maxExplain} 字。`);

  if (failures.length > 0) {
    console.error(`\n✗ 失败 ${failures.length} 项：`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\n✓ 全部通过');
}

main();
