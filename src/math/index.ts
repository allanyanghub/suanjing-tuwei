/** 题库入口：汇总全部专题并提供出题接口。 */
import type { Difficulty, Grade, Question, Topic } from './types.ts';
import { topics as g3 } from './g3.ts';
import { topics as g3b } from './g3b.ts';
import { topics as g4 } from './g4.ts';
import { topics as g4b } from './g4b.ts';
import { topics as g5 } from './g5.ts';
import { topics as g6 } from './g6.ts';

export type { Difficulty, Grade, Question, Topic } from './types.ts';

export const ALL_TOPICS: Topic[] = [...g3, ...g3b, ...g4, ...g4b, ...g5, ...g6];

const BY_ID = new Map<string, Topic>(ALL_TOPICS.map((t) => [t.id, t]));

export function topicById(id: string): Topic {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`未知专题：${id}`);
  return t;
}

export function topicsOfGrade(grade: Grade | number): Topic[] {
  return ALL_TOPICS.filter((t) => t.grade === grade);
}

/** 从给定专题中等概率选一个，按难度出一道题 */
export function makeQuestion(topicIds: string[], difficulty: Difficulty, rng: () => number): Question {
  if (topicIds.length === 0) throw new Error('makeQuestion: topicIds 不能为空');
  const id = topicIds[Math.min(topicIds.length - 1, Math.floor(rng() * topicIds.length))];
  return topicById(id).gen(difficulty, rng);
}
