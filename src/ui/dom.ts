/** 轻量 DOM 工具：创建元素、带缓存的写入（避免每帧重复写 DOM） */
import { audio } from '../core/audio.ts';

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 依次追加子元素，返回父元素 */
export function add<T extends HTMLElement>(parent: T, ...kids: (Node | string | null | undefined | false)[]): T {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    parent.append(k);
  }
  return parent;
}

/** 带声音反馈的按钮 */
export function btn(label: string, cls: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const b = h('button', cls);
  b.type = 'button';
  const span = h('span', 'btn-label', label);
  b.append(span);
  b.addEventListener('click', (e) => {
    if (b.disabled) return;
    onClick(e);
  });
  b.addEventListener('mouseenter', () => {
    if (!b.disabled) audio.ui('hover');
  });
  return b;
}

/** 键帽 */
export function keycap(k: string, cls = ''): HTMLElement {
  return h('kbd', ('keycap ' + cls).trim(), k);
}

export const hexCss = (n: number): string => '#' + n.toString(16).padStart(6, '0');

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtDate(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 缓存上一次写入的值，只有变化时才真正写 DOM */
export class Bind {
  private last = new Map<string, string | boolean>();
  constructor(public el: HTMLElement) {}

  text(v: string | number): void {
    const s = String(v);
    if (this.last.get('#t') !== s) {
      this.last.set('#t', s);
      this.el.textContent = s;
    }
  }

  style(prop: string, v: string): void {
    if (this.last.get(prop) !== v) {
      this.last.set(prop, v);
      this.el.style.setProperty(prop, v);
    }
  }

  cls(c: string, on: boolean): void {
    const k = '.' + c;
    if (this.last.get(k) !== on) {
      this.last.set(k, on);
      this.el.classList.toggle(c, on);
    }
  }

  show(on: boolean): void {
    this.cls('is-hidden', !on);
  }
}

export function bind(el: HTMLElement): Bind {
  return new Bind(el);
}

/** 内联 SVG（全部为原创几何图形） */
const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(viewBox: string, cls: string, inner: string): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = inner;
  return s;
}

/** 五角星（用于星级） */
export function starIcon(cls = 'star'): SVGSVGElement {
  return svg('0 0 24 24', cls, '<path d="M12 1.8l3.1 6.6 7.1.9-5.2 4.9 1.3 7.1L12 17.8l-6.3 3.5 1.3-7.1L1.8 9.3l7.1-.9z"/>');
}

export function lockIcon(cls = 'lock-ico'): SVGSVGElement {
  return svg(
    '0 0 24 24',
    cls,
    '<path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="4.5" y="10" width="15" height="11" rx="1.5" fill="currentColor"/>',
  );
}

/** 「熵核」图标：菱形内嵌圆环 */
export function spikeIcon(cls = 'spike-ico'): SVGSVGElement {
  return svg(
    '0 0 24 24',
    cls,
    '<path d="M12 1.5 22.5 12 12 22.5 1.5 12z" fill="currentColor" opacity=".25"/><path d="M12 4.5 19.5 12 12 19.5 4.5 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  );
}

/** 信用点图标 */
export function creditIcon(cls = 'cr-ico'): SVGSVGElement {
  return svg(
    '0 0 24 24',
    cls,
    '<path d="M12 2 21 7v10l-9 5-9-5V7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7 16.5 12 12 17 7.5 12z" fill="currentColor"/>',
  );
}

/** 按需播放一次 Web Animation（不触发强制重排） */
export function pulse(el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): void {
  if (typeof el.animate !== 'function') return;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate(frames, opts);
}

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
