/**
 * 联网层公共小工具：类型化事件、键值存储抽象、时钟。
 * 本目录下的模块不引用 DOM、不依赖 import.meta.env，可以直接用 `node --test` 做单元测试；
 * 浏览器相关的东西（localStorage、fetch、定时器）都通过参数注入。
 */

/** 极简的类型化事件发射器 */
export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<(v: never) => void>>();

  /** 订阅事件，返回取消订阅函数 */
  on<K extends keyof E>(k: K, cb: (v: E[K]) => void): () => void {
    let set = this.map.get(k);
    if (!set) this.map.set(k, (set = new Set()));
    set.add(cb as (v: never) => void);
    return () => {
      set.delete(cb as (v: never) => void);
    };
  }

  emit<K extends keyof E>(k: K, v: E[K]): void {
    const set = this.map.get(k);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        (cb as (v: E[K]) => void)(v);
      } catch (e) {
        console.error('[online] 事件处理出错', String(k), e);
      }
    }
  }
}

/** 键值存储（浏览器里是 localStorage，测试里是内存） */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  del(key: string): void;
}

export function memoryKV(init: Record<string, string> = {}): KV & { dump(): Record<string, string> } {
  const m = new Map(Object.entries(init));
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    del: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

/** 包一层 localStorage：隐私模式、存储满、被禁用时都不抛错 */
export function browserKV(): KV {
  const ls = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };
  return {
    get: (k) => {
      try {
        return ls()?.getItem(k) ?? null;
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        ls()?.setItem(k, v);
      } catch {
        /* 存储不可用时忽略 */
      }
    },
    del: (k) => {
      try {
        ls()?.removeItem(k);
      } catch {
        /* 忽略 */
      }
    },
  };
}

export function readJSON<T>(kv: KV, key: string, fallback: T): T {
  const raw = kv.get(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(kv: KV, key: string, v: unknown): void {
  kv.set(key, JSON.stringify(v));
}

/** 本地存储键名前缀（与游戏原有的 `suanjing-tuwei-save-v1` 区分开） */
export const KEY_PREFIX = 'suanjing-online-';

/** 每位玩家一份的本地数据用这个做键：名字不区分大小写（与服务器一致）；离线游客为 `guest` */
export function profileKey(name: string | null): string {
  return name === null ? 'guest' : 'p:' + name.trim().toLowerCase();
}

export type Clock = () => number;

/** 可注入的定时器（测试里换成假定时器） */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};
