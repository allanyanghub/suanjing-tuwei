/**
 * 移动端页面设置：竖屏提示、禁止缩放 / 回弹等系统手势、首次触摸尝试全屏、主屏幕图标。
 * 视口、apple-mobile-web-app-capable、manifest 等静态部分写在 index.html 里。
 */
import { h } from './dom.ts';

/** 是否已经以“添加到主屏幕”的独立应用方式运行 */
function standalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  try {
    return nav.standalone === true || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
  } catch {
    return false;
  }
}

/** 尝试进入全屏（iPad Safari / 安卓支持；iPhone Safari 不支持，静默失败） */
function tryFullscreen(): void {
  if (standalone()) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  if (document.fullscreenElement || doc.webkitFullscreenElement) return;
  try {
    if (typeof el.requestFullscreen === 'function') {
      void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    } else if (typeof el.webkitRequestFullscreen === 'function') {
      el.webkitRequestFullscreen();
    }
  } catch {
    /* 不支持时忽略 */
  }
}

export function setupMobilePage(uiRoot: HTMLElement): void {
  // 竖屏提示（只在触屏模式下由 CSS 显示）
  const tip = h('div', 'rotate-tip');
  tip.innerHTML =
    '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="20" y="6" width="24" height="40" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M10 50a24 24 0 0 0 38 6" fill="none" stroke="#ff8a3d" stroke-width="3"/><path d="M48 48v8h-8" fill="none" stroke="#ff8a3d" stroke-width="3"/></svg>';
  tip.append(h('div', 'rt-main', '请把设备横过来'), h('div', 'rt-sub', '算境突围需要横屏游玩'));
  uiRoot.append(tip);

  // iOS Safari 会忽略 user-scalable=no：手动拦截双指缩放手势
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  // 游戏画面 / 操控层上的滑动不应滚动或回弹页面；多指触摸一律不缩放。菜单里的滚动区域不受影响。
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) {
        e.preventDefault();
        return;
      }
      const t = e.target;
      if (t instanceof Element && t.closest('.tc, .hud, #game')) e.preventDefault();
    },
    { passive: false },
  );

  // 第一次触摸时尝试全屏（需要用户手势，touchend 才算激活）
  const first = () => {
    window.removeEventListener('touchend', first, true);
    tryFullscreen();
  };
  window.addEventListener('touchend', first, true);

  // 主屏幕图标：把内联 SVG 徽标画成 PNG（iOS 的 apple-touch-icon 只认位图）
  makeTouchIcon();
}

const ICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#ffd27a'/><stop offset='1' stop-color='#ff6a3d'/></linearGradient></defs><rect width='64' height='64' fill='#0b0f1a'/><path d='M32 7 54 19.5v25L32 57 10 44.5v-25z' fill='none' stroke='url(#g)' stroke-width='3.4'/><path d='M23 21h18l-10 11 10 11H23' fill='none' stroke='#fff' stroke-width='4.4'/></svg>";

function makeTouchIcon(): void {
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 180;
      const g = c.getContext('2d');
      if (!g) return;
      g.drawImage(img, 0, 0, 180, 180);
      const link = document.createElement('link');
      link.rel = 'apple-touch-icon';
      link.href = c.toDataURL('image/png');
      document.head.append(link);
    } catch {
      /* 忽略 */
    }
  };
  img.src = 'data:image/svg+xml,' + encodeURIComponent(ICON_SVG);
}
