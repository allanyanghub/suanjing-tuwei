/** 家庭排行榜（API.md §11）：拉取 + 缓存，以及给界面用的榜单名称。 */
import type { Api, BoardMetric, Leaderboard } from './api.ts';
import { Resource } from './resource.ts';
import type { KV } from './util.ts';

export const BOARD_LABELS: Record<BoardMetric, { name: string; unit: string; hint: string }> = {
  rank: { name: '段位', unit: '', hint: '每打完一局按胜负和正确率加减星' },
  stars: { name: '星星', unit: '颗', hint: '所有关卡获得的星星' },
  cleared: { name: '通关', unit: '关', hint: '通关的关卡数' },
  weekCorrect: { name: '本周答对', unit: '题', hint: '从本周一开始答对的题数' },
  weekAccuracy: { name: '本周正确率', unit: '%', hint: '本周至少答 10 题才上榜' },
  bestStreak: { name: '最长连对', unit: '题', hint: '历史上最多连续答对' },
  wins: { name: '胜场', unit: '场', hint: '通关获胜的场次' },
};

export const BOARD_ORDER: BoardMetric[] = ['rank', 'stars', 'weekCorrect', 'weekAccuracy', 'bestStreak', 'cleared', 'wins'];

export function leaderboardResource(api: Api, kv: KV, now?: () => number): Resource<Leaderboard> {
  return new Resource<Leaderboard>('leaderboard', kv, () => api.leaderboard(), now);
}
