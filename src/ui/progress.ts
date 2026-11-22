/** 关卡解锁与星级统计 */
import { LEVELS, type LevelDef } from '../data/defs.ts';
import type { Grade } from '../math/types.ts';
import { save } from '../core/save.ts';
import { LAYOUTS, type LayoutDef } from '../world/layouts.ts';

export const levelById = (id: string): LevelDef | undefined => LEVELS.find((l) => l.id === id);

export const starsOf = (id: string): number => save.stars[id] ?? 0;

export const levelsOfGrade = (g: Grade): LevelDef[] => LEVELS.filter((l) => l.grade === g);

/** 本年级满星数（各年级关卡数可以不同） */
export const gradeMaxStars = (g: Grade): number => levelsOfGrade(g).length * 3;

/** 每个年级第一关始终开放；第 k+1 关在第 k 关至少 1 星后解锁 */
export function isUnlocked(l: LevelDef): boolean {
  const list = levelsOfGrade(l.grade);
  const i = list.indexOf(l);
  if (i <= 0) return true;
  return starsOf(list[i - 1].id) >= 1;
}

export function gradeStars(g: Grade): number {
  return levelsOfGrade(g).reduce((s, l) => s + starsOf(l.id), 0);
}

/** 下一关：同年级的后一关；终局关（level.boss）之后进入下一个年级的第一关 */
export function nextLevel(l: LevelDef): LevelDef | null {
  const list = levelsOfGrade(l.grade);
  const i = list.indexOf(l);
  let n: LevelDef | undefined = !l.boss && i >= 0 ? list[i + 1] : undefined;
  if (!n) {
    const grades = [...new Set(LEVELS.map((x) => x.grade))];
    const g = grades[grades.indexOf(l.grade) + 1];
    n = g === undefined ? undefined : levelsOfGrade(g)[0];
  }
  return n && isUnlocked(n) ? n : null;
}

/** 推荐的年级：第一个还有未满星且已解锁关卡的年级 */
export function suggestedGrade(): Grade {
  for (const g of [3, 4, 5, 6] as Grade[]) if (levelsOfGrade(g).some((l) => isUnlocked(l) && starsOf(l.id) < 1)) return g;
  return 3;
}

/** 某年级已通关（至少 1 星）的关卡数 */
export function gradeCleared(g: Grade): number {
  return levelsOfGrade(g).filter((l) => starsOf(l.id) >= 1).length;
}

export interface MapUnlock {
  grade: Grade;
  /** 需要在该年级通关的关卡数 */
  need: number;
  have: number;
  unlocked: boolean;
}

/**
 * 地图是通关的奖励：每个年级的第一张图在通关该年级约四分之一的关卡后解锁，第二张在通关约一半后解锁。
 * 通关 = 打赢并且答题正确率达标（至少 1 星），所以想玩到全部地图，就必须学会各年级的新专题。
 * 注意：每一关自己的默认地图始终可用，不受此限制（否则关卡无法进行）。
 */
export function mapUnlock(d: LayoutDef): MapUnlock {
  const n = levelsOfGrade(d.grade).length;
  const second = LAYOUTS.filter((x) => x.grade === d.grade).indexOf(d) >= 1;
  const need = Math.max(1, Math.ceil(n * (second ? 0.5 : 0.25)));
  const have = gradeCleared(d.grade);
  return { grade: d.grade, need, have, unlocked: have >= need };
}

/** 这一关可以使用的地图：关卡默认地图，或已经解锁的地图 */
export function canUseMap(l: LevelDef, mapId: string): boolean {
  if (mapId === l.mapId) return true;
  const d = LAYOUTS.find((x) => x.id === mapId);
  return !!d && mapUnlock(d).unlocked;
}

export function unlockedMapIds(): string[] {
  return LAYOUTS.filter((d) => mapUnlock(d).unlocked).map((d) => d.id);
}
