/**
 * 画面保护：弱显卡 / 平板上的两类问题
 * 1. 显卡过载时浏览器会收回 WebGL 上下文（画面闪一下然后定住）。这里监听 webglcontextlost / restored，
 *    丢失期间显示「画面恢复中…」，恢复后由调用方重建渲染管线并降一档画质；5 秒内没恢复就提示点击重新加载。
 * 2. 长时间掉帧：对局中平均帧率持续低于阈值时自动降一档画质（只降不升，避免来回切换）。
 * 另外提供页面上的小提示条（toast）。
 */
import type { Quality } from './stage.ts';

/** 下一档更低的画质；已经是最低返回 null */
export const LOWER: Record<Quality, Quality | null> = { high: 'medium', medium: 'low', low: null };
const RANK: Record<Quality, number> = { low: 0, medium: 1, high: 2 };

/** 两档里较低的一档 */
export const minQuality = (a: Quality, b: Quality): Quality => (RANK[a] <= RANK[b] ? a : b);

// ---------------------------------------------------------------- 帧率监测

export interface FpsGovernorOptions {
  /** 平均帧率低于它算卡 */
  minFps?: number;
  /** 连续统计窗口（秒） */
  seconds?: number;
  /** 开局 / 换画质后先等几秒（着色器编译、贴图上传会短暂卡顿） */
  warmup?: number;
}

/**
 * 每秒一个桶，统计最近 seconds 秒的平均帧率。
 * sample() 返回 'step' 表示该降画质了；'slow' 表示已经卡了但没有更低画质可降（只用于上报）。
 */
export class FpsGovernor {
  readonly minFps: number;
  readonly seconds: number;
  readonly warmup: number;
  private acc = 0;
  private frames = 0;
  private buckets: { t: number; f: number }[] = [];
  private wait: number;
  /** 最近一次完整窗口的平均帧率（调试 / 上报用） */
  lastAvg = 0;

  constructor(o: FpsGovernorOptions = {}) {
    this.minFps = o.minFps ?? 24;
    this.seconds = o.seconds ?? 8;
    this.warmup = o.warmup ?? 5;
    this.wait = this.warmup;
  }

  /** 清空统计并重新等待 warmup 秒 */
  reset(wait = this.warmup): void {
    this.acc = this.frames = 0;
    this.buckets = [];
    this.wait = wait;
  }

  /**
   * @param dt 本帧真实耗时（秒，未截断）
   * @param live 是否在实际对局画面中（菜单、暂停、后台标签页都不算）
   * @param canStep 还能不能再降画质
   */
  sample(dt: number, live: boolean, canStep: boolean): 'step' | 'slow' | null {
    // 不在对局、或者一帧特别长（切后台回来、弹窗），这段数据作废
    if (!live || dt > 0.5 || !(dt >= 0)) {
      if (!live) this.reset(Math.max(this.wait, 2));
      else this.acc = this.frames = 0;
      return null;
    }
    if (this.wait > 0) {
      this.wait -= dt;
      return null;
    }
    this.acc += dt;
    this.frames++;
    if (this.acc < 1) return null;
    this.buckets.push({ t: this.acc, f: this.frames });
    this.acc = this.frames = 0;
    if (this.buckets.length > this.seconds) this.buckets.shift();
    if (this.buckets.length < this.seconds) return null;
    let T = 0,
      F = 0;
    for (const b of this.buckets) {
      T += b.t;
      F += b.f;
    }
    this.lastAvg = F / T;
    if (this.lastAvg >= this.minFps) return null;
    this.reset(canStep ? 10 : 60);
    return canStep ? 'step' : 'slow';
  }
}

// ---------------------------------------------------------------- 提示与遮罩

let toastEl: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** 屏幕上方的小提示，几秒后自动消失 */
export function showToast(text: string, ms = 3500): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'gfx-toast';
    toastEl.setAttribute('role', 'status');
    document.body.append(toastEl);
  }
  toastEl.textContent = text;
  toastEl.classList.add('on');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl?.classList.remove('on'), ms);
}

// ---------------------------------------------------------------- 上下文丢失

export interface ContextWatchHandlers {
  /** 上下文丢了 */
  lost(): void;
  /** 上下文回来了（Three.js 已重新初始化内部状态之后调用） */
  restored(): void;
  /** 等了 timeoutMs 还没恢复 */
  timeout?(): void;
}

/**
 * 监听画布的上下文丢失 / 恢复，并显示对应遮罩。
 * Three.js 的 WebGLRenderer 在构造时先注册了自己的监听（会 preventDefault 并在恢复时重建内部状态），
 * 这里注册在它之后，所以 restored() 被调用时渲染器已经可用。
 */
export function watchContext(canvas: HTMLCanvasElement, h: ContextWatchHandlers, timeoutMs = 5000): void {
  let overlay: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hide = () => {
    overlay?.remove();
    overlay = null;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const show = (html: string, stuck: boolean) => {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'gfx-overlay';
      overlay.addEventListener('click', () => {
        if (overlay?.classList.contains('stuck')) location.reload();
      });
      document.body.append(overlay);
    }
    overlay.classList.toggle('stuck', stuck);
    overlay.innerHTML = `<div class="gfx-box">${html}</div>`;
  };
  const stuck = () => show('<div class="gfx-text">画面出了问题，点这里重新加载</div><div class="gfx-sub">闯关进度已经自动保存</div>', true);
  canvas.addEventListener(
    'webglcontextlost',
    (ev) => {
      // 必须阻止默认行为，浏览器才会在之后尝试恢复上下文
      ev.preventDefault();
      hide();
      show('<div class="gfx-spin"></div><div class="gfx-text">画面恢复中…</div>', false);
      timer = setTimeout(() => {
        timer = null;
        stuck();
        h.timeout?.();
      }, timeoutMs);
      try {
        h.lost();
      } catch (e) {
        console.error('[画面] 处理上下文丢失出错', e);
      }
    },
    false,
  );
  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      hide();
      try {
        h.restored();
      } catch (e) {
        console.error('[画面] 恢复渲染出错', e);
        // 恢复失败：只能请孩子重新加载
        stuck();
      }
    },
    false,
  );
}
