/**
 * 家长出题（API.md §10）。作答结果和普通答题一样进答题队列（context: "custom", customId）。
 * 离线期间本地按 remainingCorrect 递减，避免同一题反复出现；联网发完答题后再拉取以服务器为准。
 */
import type { Api, CustomQuestion } from './api.ts';
import { Resource } from './resource.ts';
import { KEY_PREFIX, readJSON, writeJSON, type KV } from './util.ts';

const localKey = (p: string) => `${KEY_PREFIX}custom-local:${p}`;

export class CustomStore {
  readonly res: Resource<CustomQuestion[]>;
  private kv: KV;
  private profile: string | null = null;
  /** 答题队列是否已清空（清空后服务器的 remainingCorrect 已包含本地作答） */
  queueEmpty: () => boolean = () => true;

  constructor(api: Api, kv: KV, now?: () => number) {
    this.kv = kv;
    this.res = new Resource<CustomQuestion[]>('custom', kv, async () => (await api.customQuestions(6000)).questions, now);
    this.res.transform = (v) => {
      if (this.profile && this.queueEmpty()) this.kv.del(localKey(this.profile));
      return v;
    };
  }

  setProfile(p: string | null): void {
    this.profile = p === 'guest' ? null : p;
    this.res.setProfile(p);
  }

  refresh(): Promise<CustomQuestion[] | null> {
    return this.res.refresh();
  }

  private local(): Record<string, number> {
    return this.profile ? readJSON<Record<string, number>>(this.kv, localKey(this.profile), {}) : {};
  }

  /** 还需要做的家长题（扣掉本地还没被服务器计入的答对次数） */
  pending(): CustomQuestion[] {
    const loc = this.local();
    return (this.res.data ?? [])
      .map((q) => ({ ...q, remainingCorrect: q.remainingCorrect - (loc[q.id] ?? 0) }))
      .filter((q) => q.remainingCorrect > 0);
  }

  /** 记一次作答（只有答对才递减） */
  answered(id: number, correct: boolean): void {
    if (!this.profile || !correct) return;
    const loc = this.local();
    loc[id] = (loc[id] ?? 0) + 1;
    writeJSON(this.kv, localKey(this.profile), loc);
    this.res.ev.emit('change', this.res.data);
  }
}
