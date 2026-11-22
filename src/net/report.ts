/** 孩子自己的学习小结（API.md §6）：拉取 + 缓存，以及给界面用的整理。 */
import type { Api, MyReport } from './api.ts';
import { Resource } from './resource.ts';
import type { KV } from './util.ts';

export function reportResource(api: Api, kv: KV, now?: () => number): Resource<MyReport> {
  return new Resource<MyReport>('report', kv, () => api.reportMe(), now);
}

/** 给孩子看的一句鼓励（按本周正确率和连对） */
export function encouragement(r: MyReport): string {
  if (!r.totals.answered) return '还没有答题记录，去闯一关吧！';
  if (r.streak.current >= 10) return `已经连续答对 ${r.streak.current} 题，太厉害了！`;
  const acc = r.week.accuracy;
  if (r.week.answered === 0) return '这周还没答题，今天来练几道吧！';
  if (acc !== null && acc >= 90) return '本周正确率超过 90%，继续保持！';
  if (acc !== null && acc >= 70) return '本周表现不错，再接再厉！';
  return '每道错题都是进步的机会，加油！';
}

/** 专题按正确率分档：给进度条上色 */
export function accuracyTier(acc: number | null): 'good' | 'ok' | 'low' | 'none' {
  if (acc === null) return 'none';
  return acc >= 85 ? 'good' : acc >= 60 ? 'ok' : 'low';
}
