/**
 * 家长留言（API.md §9）。孩子看过（点"知道了"）后标为已读：
 * - 本设备立刻记住（离线也能马上隐藏）；
 * - 同时告诉服务器，服务器以后不再返回这条，换设备也不会再出现；
 * - 告诉服务器失败（离线）时，下次刷新发现它还在就补发一次。
 */
import type { Api, ParentMessage } from './api.ts';
import { Resource } from './resource.ts';
import { KEY_PREFIX, readJSON, writeJSON, type KV } from './util.ts';

const seenKey = (p: string) => `${KEY_PREFIX}seen-messages:${p}`;

export class MessageStore {
  readonly res: Resource<ParentMessage[]>;
  private api: Api;
  private kv: KV;
  private profile: string | null = null;
  private sending = false;

  constructor(api: Api, kv: KV, now?: () => number) {
    this.api = api;
    this.kv = kv;
    this.res = new Resource<ParentMessage[]>('messages', kv, async () => (await api.messages()).messages, now);
    // 服务器还返回本地已看过的留言 = 之前没能告诉服务器，补发
    this.res.ev.on('change', () => this.resend());
  }

  setProfile(p: string | null): void {
    this.profile = p === 'guest' ? null : p;
    this.res.setProfile(p);
  }

  refresh(): Promise<ParentMessage[] | null> {
    return this.res.refresh();
  }

  /** 还没看过的留言（最新在前）；看过的不再显示 */
  get list(): ParentMessage[] {
    const s = new Set(this.seen());
    return (this.res.data ?? []).filter((m) => !s.has(m.id));
  }

  latest(): ParentMessage | null {
    return this.list[0] ?? null;
  }

  private seen(): number[] {
    return this.profile ? readJSON<number[]>(this.kv, seenKey(this.profile), []) : [];
  }

  /** 还没看过的留言（同 list，保留旧名字） */
  unseen(): ParentMessage[] {
    return this.list;
  }

  /** 标为已看过：本地立即生效，并通知服务器 */
  markSeen(ids: number[]): void {
    if (!this.profile || !ids.length) return;
    const s = new Set(this.seen());
    for (const id of ids) s.add(id);
    writeJSON(this.kv, seenKey(this.profile), [...s].sort((a, b) => b - a).slice(0, 300));
    this.send(ids);
  }

  private resend(): void {
    const s = new Set(this.seen());
    const pending = (this.res.data ?? []).filter((m) => s.has(m.id)).map((m) => m.id);
    if (pending.length) this.send(pending);
  }

  private send(ids: number[]): void {
    if (this.sending || !this.profile) return;
    this.sending = true;
    this.api
      .markMessagesRead(ids.slice(0, 100))
      .catch(() => undefined) // 离线：下次刷新时补发
      .finally(() => {
        this.sending = false;
      });
  }
}
