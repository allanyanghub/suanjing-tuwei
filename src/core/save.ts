import type { Question } from '../math/types.ts';
import { cleanRank, seedRank, type RankState } from './rank.ts';

export interface WrongEntry {
  q: Question;
  picked: number;
  time: number;
  levelId: string;
}

export interface SaveData {
  version: 1;
  stars: Record<string, number>;
  wrong: WrongEntry[];
  agent: string;
  /** 玩家为某一关自选的地图（关卡 id → 地图 id）；没有记录时用关卡默认地图 */
  mapChoice: Record<string, string>;
  settings: {
    sens: number;
    volume: number;
    quality: 'high' | 'medium' | 'low';
    fov: number;
    /** 画质仍是默认值（玩家没有手动选过）；触屏设备首次运行时据此自动降画质 */
    qualityAuto: boolean;
    /** 这台设备上自动画质的上限：画面丢失 / 持续卡顿时自动降低并记住（仅 qualityAuto 时生效；玩家手动选画质后不再使用） */
    qualityCap: 'high' | 'medium' | 'low';
    /** 触屏拖动视角的灵敏度 */
    touchSens: number;
    /** 触屏摇杆左右：true = 转向（默认，孩子更容易上手）；false = 侧身平移（射击游戏常见做法） */
    stickTurn: boolean;
    /** 触屏：准星停在敌人身上时自动开火 */
    autoFire: boolean;
    /** 触屏辅助瞄准强度 */
    assist: AssistLevel;
    /** 瞄准（开镜）方式：按住右键 / 点按切换（参考默认为按住） */
    adsMode: AimMode;
    /** 狙击开镜方式：按住 / 切换（切换时可在两档倍率间循环） */
    scopeMode: AimMode;
  };
  stats: { answered: number; correct: number; kills: number; wins: number };
  /** 段位（src/core/rank.ts） */
  rank: RankState;
}

export type AssistLevel = 'low' | 'medium' | 'high';
export type AimMode = 'hold' | 'toggle';

const KEY = 'suanjing-tuwei-save-v1';

function defaults(): SaveData {
  return {
    version: 1,
    stars: {},
    wrong: [],
    agent: 'ling',
    mapChoice: {},
    settings: { sens: 1, volume: 0.7, quality: 'high', fov: 78, qualityAuto: true, qualityCap: 'high', touchSens: 1, stickTurn: true, autoFire: true, assist: 'medium', adsMode: 'hold', scopeMode: 'toggle' },
    stats: { answered: 0, correct: 0, kills: 0, wins: 0 },
    rank: { pts: 0, best: 0, n: 0 },
  };
}

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const d = JSON.parse(raw) as Partial<SaveData>;
    const base = defaults();
    const stats = { ...base.stats, ...(d.stats ?? {}) };
    const stars = d.stars ?? {};
    return {
      ...base,
      ...d,
      settings: { ...base.settings, ...(d.settings ?? {}) },
      stats,
      rank: cleanRank(d.rank, () => seedRank(stats, stars)),
      version: 1,
    };
  } catch {
    return defaults();
  }
}

export const save: SaveData = load();

/** persist() 之后调用的钩子（联网层在启动时登记，用来同步存档；这里不引用联网层以免循环依赖） */
const persistHooks: (() => void)[] = [];

export function onPersist(fn: () => void): void {
  persistHooks.push(fn);
}

export function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* 存储不可用时忽略 */
  }
  for (const fn of persistHooks) {
    try {
      fn();
    } catch (e) {
      console.error('[存档] persist 钩子出错', e);
    }
  }
}

/** 从错题本移除一道题（按对象或题干匹配），返回是否移除了；调用方负责 persist() */
export function removeWrong(e: WrongEntry | { q: { text: string } }): boolean {
  let k = save.wrong.indexOf(e as WrongEntry);
  if (k < 0) k = save.wrong.findIndex((w) => w.q.text === e.q.text);
  if (k < 0) return false;
  save.wrong.splice(k, 1);
  return true;
}

export function recordWrong(q: Question, picked: number, levelId: string): void {
  save.wrong.unshift({ q, picked, time: Date.now(), levelId });
  if (save.wrong.length > 200) save.wrong.length = 200;
}

export function totalStars(): number {
  return Object.values(save.stars).reduce((a, b) => a + b, 0);
}
