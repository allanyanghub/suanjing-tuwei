/**
 * 任务与奖励（API.md §7）。进度由服务器判定，孩子端只读。
 * 完成庆祝"恰好一次"：`justCompleted` 的任务播放庆祝 → 本地记下"已庆祝" → ack；
 * ack 失败也不会重复庆祝（本地记录挡住），下次拉取时再补发 ack。
 */
import type { Api, Task } from './api.ts';
import { Resource } from './resource.ts';
import { KEY_PREFIX, readJSON, writeJSON, type KV } from './util.ts';

const celebratedKey = (p: string) => `${KEY_PREFIX}celebrated:${p}`;

export class TaskStore {
  readonly res: Resource<Task[]>;
  private kv: KV;
  private api: Api;
  private profile: string | null = null;

  constructor(api: Api, kv: KV, now?: () => number) {
    this.api = api;
    this.kv = kv;
    this.res = new Resource<Task[]>('tasks', kv, async () => (await api.tasks()).tasks, now);
  }

  setProfile(p: string | null): void {
    this.profile = p === 'guest' ? null : p;
    this.res.setProfile(p);
  }

  get list(): Task[] {
    return this.res.data ?? [];
  }

  private celebrated(): number[] {
    return this.profile ? readJSON<number[]>(this.kv, celebratedKey(this.profile), []) : [];
  }

  /** 拉取任务；对已经在本地庆祝过但服务器还标着 justCompleted 的，补发 ack */
  async refresh(): Promise<Task[]> {
    const list = (await this.res.refresh()) ?? [];
    const done = new Set(this.celebrated());
    for (const t of list) if (t.justCompleted && done.has(t.id)) void this.api.ackTask(t.id).catch(() => undefined);
    return list;
  }

  /** 需要播放庆祝的任务（服务器 justCompleted 且本设备还没庆祝过） */
  pendingCelebrations(): Task[] {
    const done = new Set(this.celebrated());
    return this.list.filter((t) => t.justCompleted && !done.has(t.id));
  }

  /** 庆祝播放完调用：本地记住并通知服务器 */
  async markCelebrated(id: number): Promise<void> {
    if (!this.profile) return;
    const list = this.celebrated();
    if (!list.includes(id)) {
      list.push(id);
      writeJSON(this.kv, celebratedKey(this.profile), list.slice(-300));
    }
    try {
      await this.api.ackTask(id);
      this.res.update((ts) => ts.map((t) => (t.id === id ? { ...t, justCompleted: false } : t)));
    } catch {
      /* 下次拉取时补发 */
    }
  }

  /**
   * 游戏内奖励：已完成且仍在列表里的任务的 bonusCredits 之和（产品待定，见 API.md 文末问题 1；
   * 这里按文档建议的"完成后、仍在列表里时生效"计算，最多 2000）。
   */
  bonusCredits(): number {
    return Math.min(2000, this.list.filter((t) => t.status === 'done').reduce((a, t) => a + (t.bonusCredits || 0), 0));
  }
}
