/**
 * 联网界面的公共部分：组件类型、全屏层、弹窗、纯文本块、时间格式。
 * 服务器给的文本一律用 textContent（配合 white-space: pre-line 显示换行），从不进 innerHTML。
 */
import './online.css';
import { audio } from '../../core/audio.ts';
import { btn, h } from '../dom.ts';

/** 可挂载的组件：一个元素 + 卸载时调用的 destroy（取消订阅、停止定时器） */
export type Widget<T extends HTMLElement = HTMLElement> = T & { destroy(): void; onBack?: () => void };

export function widget<T extends HTMLElement>(el: T, cleanups: (() => void)[]): Widget<T> {
  const w = el as Widget<T>;
  let done = false;
  w.destroy = () => {
    if (done) return;
    done = true;
    for (const c of cleanups.splice(0)) {
      try {
        c();
      } catch {
        /* 忽略 */
      }
    }
    w.remove();
  };
  return w;
}

/** 服务器文本块（可能含 \n） */
export function textBlock(cls: string, text: string): HTMLElement {
  const e = h('div', ('ol-pre ' + cls).trim());
  e.textContent = text;
  return e;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const hm = (t: number) => {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** 给孩子看的时刻：今天 16:00 / 明天 16:00 / 11月26日 16:00 */
export function friendlyTime(t: number, now = Date.now()): string {
  const d0 = new Date(now);
  const start = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime();
  const day = 86_400_000;
  if (t >= start && t < start + day) return `今天 ${hm(t)}`;
  if (t >= start + day && t < start + 2 * day) return `明天 ${hm(t)}`;
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm(t)}`;
}

/** 多久以前：刚刚 / 5 分钟前 / 3 小时前 / 2 天前 / 11月3日 */
export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} 天前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export const GRADE_CN: Record<number, string> = { 3: '三年级', 4: '四年级', 5: '五年级', 6: '六年级' };

/** 名字的第一个字（头像用） */
export const initial = (name: string) => Array.from(name.trim())[0] ?? '?';

/** 由名字算出一个稳定的头像颜色 */
export function avatarHue(name: string): number {
  let x = 0;
  for (const ch of name) x = (x * 31 + ch.codePointAt(0)!) % 360;
  return x;
}

export function avatar(name: string, cls = ''): HTMLElement {
  const a = h('span', ('ol-avatar ' + cls).trim(), initial(name));
  a.style.setProperty('--hue', String(avatarHue(name)));
  a.setAttribute('aria-hidden', 'true');
  return a;
}

/** 全屏层（盖在游戏和菜单上，接收指针事件） */
export function layer(cls = ''): HTMLElement {
  return h('div', ('ol-layer ' + cls).trim());
}

/** 屏幕框架（与菜单界面相同的结构和样式） */
export function frame(title: string, kicker: string, back: (() => void) | null, cls = ''): { root: HTMLElement; body: HTMLElement; head: HTMLElement } {
  const root = h('section', ('screen ol-screen ' + cls).trim());
  const head = h('header', 'screen-head');
  if (back)
    head.append(
      btn('返回', 'btn btn-back', () => {
        audio.ui('click');
        back();
      }),
    );
  const t = h('div', 'screen-title');
  t.append(h('div', 'screen-kicker', kicker), h('h2', 'screen-h', title));
  head.append(t);
  const body = h('div', 'screen-body ol-body');
  root.append(head, body);
  return { root, body, head };
}

/** 按 Esc 时调用 fn（挂在 document 上，返回取消函数） */
export function onEscape(fn: () => void): () => void {
  const k = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      fn();
    }
  };
  document.addEventListener('keydown', k, true);
  return () => document.removeEventListener('keydown', k, true);
}

export interface ModalHandle {
  root: HTMLElement;
  panel: HTMLElement;
  close(): void;
  closed: Promise<void>;
}

/**
 * 弹窗（复用 .modal / .modal-panel 样式）。Esc 或点按钮关闭；打开时把焦点放到第一个按钮上。
 * parent 默认是 document.body。
 */
export function modal(build: (panel: HTMLElement, close: () => void) => void, o: { cls?: string; parent?: HTMLElement; dismissable?: boolean } = {}): ModalHandle {
  const root = h('div', 'modal ol-modal');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  const panel = h('div', ('panel modal-panel ' + (o.cls ?? '')).trim());
  root.append(panel);
  let resolve!: () => void;
  const closed = new Promise<void>((r) => (resolve = r));
  let open = true;
  const prevFocus = document.activeElement as HTMLElement | null;
  const offEsc = o.dismissable === false ? () => undefined : onEscape(() => close());
  const close = () => {
    if (!open) return;
    open = false;
    offEsc();
    root.remove();
    try {
      prevFocus?.focus?.();
    } catch {
      /* 忽略 */
    }
    resolve();
  };
  build(panel, close);
  (o.parent ?? document.body).append(root);
  const first = panel.querySelector<HTMLElement>('.btn-primary, button, input');
  first?.focus({ preventScroll: true });
  return { root, panel, close, closed };
}

/** 进度条 */
export function bar(frac: number, cls = ''): HTMLElement {
  const b = h('div', ('ol-bar ' + cls).trim());
  const i = h('i');
  i.style.setProperty('--p', String(Math.max(0, Math.min(1, frac))));
  b.append(i);
  b.setAttribute('role', 'progressbar');
  b.setAttribute('aria-valuemin', '0');
  b.setAttribute('aria-valuemax', '100');
  b.setAttribute('aria-valuenow', String(Math.round(Math.max(0, Math.min(1, frac)) * 100)));
  return b;
}
