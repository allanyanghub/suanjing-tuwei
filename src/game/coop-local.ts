/**
 * 开发 / 测试用：同一浏览器里多个标签页之间的合作对局通道（BroadcastChannel），
 * 行为尽量接近真正的联网层（src/net/coop.ts）：
 * - 消息经过 JSON 往返（不能序列化的值会暴露出来），单条超过 16 KB 报错；
 * - 心跳：3 秒没有消息视为离开；房主离开 = 房间关闭；
 * - 标签页关闭时发送 bye。
 * 只由 window.__game.coopLocal 使用，不进入正式流程。
 */
import type { CoopLink, CoopMember, CoopTarget } from '../net/coop-link.ts';

const HEARTBEAT_MS = 500;
const TIMEOUT_MS = 3000;
const MAX_BYTES = 16 * 1024;

interface Packet {
  k: 'm' | 'hb' | 'bye';
  from: number;
  to?: CoopTarget;
  d?: string;
}

export class LocalCoopLink implements CoopLink {
  readonly selfSeat: number;
  readonly isHost: boolean;
  private ch: BroadcastChannel;
  private list: CoopMember[];
  private hostSeat: number;
  private seen = new Map<number, number>();
  private msgFns = new Set<(from: number, d: unknown) => void>();
  private leftFns = new Set<(seat: number) => void>();
  private closedFns = new Set<(reason: string) => void>();
  private timer: number;
  private closed = false;
  private onHide = () => this.leave();
  /** 统计（测试用） */
  sentBytes = 0;
  sentCount = 0;

  constructor(room: string, selfSeat: number, members: CoopMember[]) {
    this.selfSeat = selfSeat;
    this.list = members.slice();
    const host = members.find((m) => m.isHost) ?? members[0];
    this.hostSeat = host.seat;
    this.isHost = host.seat === selfSeat;
    this.ch = new BroadcastChannel('suanjing-coop-' + room);
    const now = performance.now();
    for (const m of members) this.seen.set(m.seat, now);
    this.ch.onmessage = (e: MessageEvent<Packet>) => this.recv(e.data);
    this.timer = window.setInterval(() => this.tick(), HEARTBEAT_MS);
    window.addEventListener('pagehide', this.onHide);
  }

  members(): CoopMember[] {
    return this.list.slice();
  }

  send(d: unknown, to: CoopTarget = 'all'): void {
    if (this.closed) return;
    const s = JSON.stringify(d);
    if (s.length > MAX_BYTES) throw new Error(`[合作测试通道] 消息过大：${s.length} 字节`);
    this.sentBytes += s.length;
    this.sentCount++;
    this.post({ k: 'm', from: this.selfSeat, to, d: s });
  }

  onMessage(fn: (from: number, d: unknown) => void): () => void {
    this.msgFns.add(fn);
    return () => this.msgFns.delete(fn);
  }

  onMemberLeft(fn: (seat: number) => void): () => void {
    this.leftFns.add(fn);
    return () => this.leftFns.delete(fn);
  }

  onClosed(fn: (reason: string) => void): () => void {
    this.closedFns.add(fn);
    return () => this.closedFns.delete(fn);
  }

  leave(): void {
    if (this.closed) return;
    this.post({ k: 'bye', from: this.selfSeat });
    this.shutdown();
  }

  private post(p: Packet): void {
    try {
      this.ch.postMessage(p);
    } catch (e) {
      console.error('[合作测试通道] 发送失败', e);
    }
  }

  private shutdown(): void {
    this.closed = true;
    clearInterval(this.timer);
    window.removeEventListener('pagehide', this.onHide);
    this.ch.close();
  }

  private recv(p: Packet): void {
    if (this.closed || !p || p.from === this.selfSeat) return;
    if (!this.list.some((m) => m.seat === p.from)) return;
    this.seen.set(p.from, performance.now());
    if (p.k === 'bye') return this.drop(p.from);
    if (p.k !== 'm' || p.d === undefined) return;
    const to = p.to ?? 'all';
    if (to !== 'all' && to !== this.selfSeat && !(to === 'host' && this.isHost)) return;
    const d = JSON.parse(p.d) as unknown;
    for (const fn of this.msgFns) fn(p.from, d);
  }

  private tick(): void {
    if (this.closed) return;
    this.post({ k: 'hb', from: this.selfSeat });
    const now = performance.now();
    for (const m of this.list) if (m.seat !== this.selfSeat && now - (this.seen.get(m.seat) ?? now) > TIMEOUT_MS) this.drop(m.seat);
  }

  private drop(seat: number): void {
    if (!this.list.some((m) => m.seat === seat)) return;
    this.list = this.list.filter((m) => m.seat !== seat);
    if (seat === this.hostSeat) {
      this.shutdown();
      for (const fn of this.closedFns) fn('房主离开了，房间已关闭');
      return;
    }
    for (const fn of this.leftFns) fn(seat);
  }
}
