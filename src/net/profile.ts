/**
 * 每个孩子的个人设置（家长在管理页设置，GET /api/settings/me），以及门槛题抽题。
 * 全部是纯函数，不引用游戏代码，方便单元测试。
 */
import type { CustomQuestion, ServerSettings } from './api.ts';

/**
 * 开局参数就是游戏自己的 MatchOptions（src/game/match.ts；只引用类型，运行时不加载游戏代码）。
 * 单位：passAccuracy 是 0–1 的小数（服务器给的是 40–100 的百分数，这里换算），
 * botStrength 是倍率，reviveSeconds 是秒。字段缺省 = 游戏默认（普通关 5 回合、终局 7 回合）。
 */
import type { MatchOptions } from '../game/match.ts';
export type { MatchOptions };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const okNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 把服务器设置映射成某一关的开局参数。boss 关用 bossRoundsToWin，其余用 roundsToWin；
 * 服务器的 null 表示"用游戏默认"，对应字段直接省略。settings 为 null（游客 / 从没拿到过）时返回 {}。
 * 数值再按 API.md 的范围夹一次，防止缓存被改坏。
 */
export function matchOptionsFor(settings: ServerSettings | null, level: { boss: boolean }): MatchOptions {
  if (!settings) return {};
  const s = settings;
  const o: MatchOptions = {};
  const rounds = level.boss ? s.bossRoundsToWin : s.roundsToWin;
  if (okNum(rounds)) o.roundsToWin = clamp(Math.round(rounds), 3, 13);
  if (okNum(s.passAccuracy)) o.passAccuracy = clamp(s.passAccuracy, 40, 100) / 100;
  if (okNum(s.botStrength)) o.botStrength = clamp(s.botStrength, 0.5, 1.5);
  if (okNum(s.reviveSeconds)) o.reviveSeconds = clamp(Math.round(s.reviveSeconds), 20, 180);
  if (typeof s.gateRequired === 'boolean') o.gateRequired = s.gateRequired;
  if (okNum(s.gateCount)) o.gateCount = clamp(Math.round(s.gateCount), 1, 5);
  if (okNum(s.bonusCount)) o.bonusCount = clamp(Math.round(s.bonusCount), 0, 4);
  if (okNum(s.plantQuestions)) o.plantQuestions = clamp(Math.round(s.plantQuestions), 1, 3);
  if (okNum(s.defuseQuestions)) o.defuseQuestions = clamp(Math.round(s.defuseQuestions), 1, 3);
  return o;
}

/** 出题频率（百分数）；没有设置时用服务器默认值 */
export function questionRates(settings: ServerSettings | null): { reviewRate: number; customRate: number } {
  return {
    reviewRate: settings && okNum(settings.reviewRate) ? clamp(settings.reviewRate, 0, 50) : 20,
    customRate: settings && okNum(settings.customRate) ? clamp(settings.customRate, 0, 100) : 100,
  };
}

// ---------------------------------------------------------------- 门槛题抽题

/** 题目（与 src/math/types.ts 的 Question 结构相同；这里不引用它以保持本模块独立） */
export interface QuestionLike {
  topicId: string;
  grade: number;
  difficulty: number;
  text: string;
  options: string[];
  answer: number;
  explain: string;
  figure?: string;
}

export type GateSource = 'custom' | 'review' | 'generated';

export interface GatePick<Q extends QuestionLike = QuestionLike> {
  q: Q;
  source: GateSource;
  /** 家长出题的 id（source = 'custom' 时） */
  customId?: number;
  /** 家长出题的分类标签（可显示在题卡上，如"家庭题"） */
  label?: string;
}

export interface GateContext<Q extends QuestionLike = QuestionLike> {
  /** [0,1) 随机数（注入，便于测试） */
  rng: () => number;
  /** 百分数 0–100 */
  reviewRate: number;
  customRate: number;
  /** 待做的家长出题（GET /api/custom-questions，已扣掉本地答对次数） */
  custom: readonly CustomQuestion[];
  /** 错题本（存档 wrong） */
  wrong: readonly { q: Q | QuestionLike; levelId?: string }[];
  /** 正常出题 */
  generate: () => Q;
  /** 本关的专题：错题优先挑这些专题的 */
  topicIds?: readonly string[];
  /** 最近出过的题干 / 家长题 id：尽量不重复 */
  recentTexts?: readonly string[];
  recentCustomIds?: readonly number[];
}

/** 家长出题 → 游戏题目结构 */
export function customToQuestion(c: CustomQuestion): QuestionLike {
  const g = c.grade === 4 || c.grade === 5 || c.grade === 6 ? c.grade : 3;
  return { topicId: 'custom', grade: g, difficulty: 1, text: c.text, options: c.options.slice(0, 4), answer: c.answer, explain: c.explain ?? '' };
}

const pickFrom = <T>(rng: () => number, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

/**
 * 决定下一道门槛题（API.md §12 的建议顺序）：
 * 1. 有待做的家长出题时，以 customRate% 的概率出家长题（优先没在最近出过的，按创建先后）；
 * 2. 否则错题本非空时，以 reviewRate% 的概率重出错题（优先本关专题、没在最近出过的）；
 * 3. 否则正常出题。
 * 随机数的消耗是确定的：每一步只有在候选非空时才各取一次 rng（再加一次挑选错题），便于测试复现。
 */
export function pickGateQuestion<Q extends QuestionLike>(ctx: GateContext<Q>): GatePick<Q> {
  const recentIds = new Set(ctx.recentCustomIds ?? []);
  const recentTexts = new Set(ctx.recentTexts ?? []);
  const custom = ctx.custom.filter((c) => c.remainingCorrect > 0 && Array.isArray(c.options) && c.options.length === 4);
  if (custom.length && ctx.rng() * 100 < ctx.customRate) {
    const c = custom.find((x) => !recentIds.has(x.id)) ?? custom[0];
    return { q: customToQuestion(c) as Q, source: 'custom', customId: c.id, label: c.topicLabel || '家长出题' };
  }
  const valid = ctx.wrong.filter((w) => w && w.q && typeof w.q.text === 'string' && Array.isArray(w.q.options) && w.q.options.length === 4);
  if (valid.length && ctx.rng() * 100 < ctx.reviewRate) {
    const topics = new Set(ctx.topicIds ?? []);
    const fresh = valid.filter((w) => !recentTexts.has(w.q.text));
    const pool0 = fresh.length ? fresh : valid;
    const inTopic = topics.size ? pool0.filter((w) => topics.has(w.q.topicId)) : [];
    const pool = inTopic.length ? inTopic : pool0;
    const w = pickFrom(ctx.rng, pool);
    return { q: w.q as Q, source: 'review' };
  }
  return { q: ctx.generate(), source: 'generated' };
}
