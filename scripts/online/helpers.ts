/// <reference types="node" />
/** 单元测试公共部分：假定时器、假时钟、可控的假接口。 */
import type { Timers } from '../../src/net/util.ts';

export class FakeClock implements Timers {
  t: number;
  private seq = 0;
  private jobs = new Map<number, { at: number; fn: () => void; every?: number }>();
  constructor(t = new Date('2026-11-16T10:00:00').getTime()) {
    this.t = t;
  }
  now = (): number => this.t;
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.jobs.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(id: unknown): void {
    this.jobs.delete(id as number);
  }
  setInterval(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.jobs.set(id, { at: this.t + ms, fn, every: ms });
    return id;
  }
  clearInterval(id: unknown): void {
    this.jobs.delete(id as number);
  }
  get pending(): number {
    return this.jobs.size;
  }
  /** 推进时间，依次执行到期的任务（每个任务后让出微任务队列） */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void; every?: number }] | null = null;
      for (const e of this.jobs) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      const [id, job] = next;
      this.t = job.at;
      if (job.every) job.at += job.every;
      else this.jobs.delete(id);
      job.fn();
      await flushMicro();
    }
    this.t = end;
    await flushMicro();
  }
}

export async function flushMicro(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** 可以手动控制什么时候完成的 Promise */
export function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

/** 可复现随机数：按给定序列依次返回 */
export function seq(...vals: number[]): (() => number) & { used: number } {
  const f = (() => {
    if (f.used >= vals.length) throw new Error('rng 被多调用了一次');
    return vals[f.used++];
  }) as (() => number) & { used: number };
  f.used = 0;
  return f;
}
