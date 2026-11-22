/**
 * 输入：键鼠 + 指针锁定（桌面），以及触屏模式的统一抽象。
 * - 桌面：指针锁定后 active = true，鼠标位移进 mouseDX/DY。
 * - 触屏：没有指针锁定；游戏进行中（gameplay 由界面层设置）active = true，
 *   虚拟摇杆写 moveX/moveY（模拟量），拖动视角写 touchDX/touchDY（像素），虚拟按钮写入与按键相同的集合。
 * - 同时有鼠标和触屏的设备按“最后一次使用的输入类型”切换模式。
 */
export type InputMode = 'desktop' | 'touch';

export class Input {
  keys = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  /** 触屏拖动视角的位移（CSS 像素，本帧累计） */
  touchDX = 0;
  touchDY = 0;
  /** 本帧是否有正在移动的视角手指（用于辅助瞄准的“吸附”只在手指移动时生效） */
  touchLooking = false;
  /** 模拟移动轴：x 右为正，y 前为正，长度 ≤ 1（虚拟摇杆） */
  moveX = 0;
  moveY = 0;
  /** 触屏的开镜 / 蹲下是“点按切换”，状态记在这里 */
  adsToggle = false;
  crouchToggle = false;
  buttons = [false, false, false];
  private btnPressed = [false, false, false];
  wheel = 0;
  /** 本帧滚轮向上 / 向下的格数 */
  wheelUp = 0;
  wheelDown = 0;
  locked = false;
  /** 游戏处于需要锁定鼠标的状态时为 true（由外部设置），用于决定点击是否申请锁定 */
  wantLock = false;
  /** 对局正在进行且没有菜单遮挡（由界面层每帧设置）；触屏模式据此判定 active */
  gameplay = false;
  mode: InputMode;
  onLockChange: ((locked: boolean) => void) | null = null;
  onModeChange: ((mode: InputMode) => void) | null = null;

  constructor(private el: HTMLElement) {
    this.mode = initialMode();
    document.documentElement.classList.toggle('touch', this.mode === 'touch');

    window.addEventListener('keydown', (e) => {
      if (this.locked && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'KeyG' || e.code === 'CapsLock')) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    el.addEventListener('mousedown', (e) => {
      if (this.mode === 'touch') return;
      if (this.wantLock && !this.locked) {
        this.requestLock();
        return;
      }
      if (e.button < 3) {
        this.buttons[e.button] = true;
        this.btnPressed[e.button] = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (this.mode === 'touch') return;
      if (e.button < 3) this.buttons[e.button] = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        const d = Math.sign(e.deltaY);
        this.wheel += d;
        if (d > 0) this.wheelDown++;
        else if (d < 0) this.wheelUp++;
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) {
        this.buttons = [false, false, false];
        this.keys.clear();
      }
      this.onLockChange?.(this.locked);
    });

    // 输入类型检测：最后一次按下的指针类型决定模式（触摸产生的兼容鼠标事件不会触发 pointerType=mouse）
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch') this.setMode('touch');
        else if (e.pointerType === 'mouse') this.setMode('desktop');
      },
      { capture: true, passive: true },
    );
    window.addEventListener('touchstart', () => this.setMode('touch'), { capture: true, passive: true });
  }

  get touchMode(): boolean {
    return this.mode === 'touch';
  }

  /** 玩家输入是否生效：桌面 = 已锁定指针；触屏 = 对局进行中 */
  get active(): boolean {
    return this.locked || (this.mode === 'touch' && this.gameplay);
  }

  setMode(m: InputMode): void {
    if (m === this.mode) return;
    this.mode = m;
    document.documentElement.classList.toggle('touch', m === 'touch');
    this.releaseAll();
    this.onModeChange?.(m);
  }

  /** 松开所有按键、按钮与摇杆 */
  releaseAll(): void {
    this.keys.clear();
    this.buttons[0] = this.buttons[1] = this.buttons[2] = false;
    this.moveX = this.moveY = 0;
    this.touchLooking = false;
  }

  requestLock(): void {
    if (this.mode === 'touch') return;
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* 浏览器拒绝时忽略 */
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---------------------------------------------------------------- 虚拟按键（触屏按钮调用）

  /** 按下一个虚拟按键（本帧 hit 为真，松开前 down 为真） */
  press(code: string): void {
    this.pressed.add(code);
    this.keys.add(code);
  }

  release(code: string): void {
    this.keys.delete(code);
  }

  /** 按下 / 松开虚拟鼠标键（触屏开火按钮用 0） */
  setButton(btn: number, down: boolean): void {
    if (down && !this.buttons[btn]) this.btnPressed[btn] = true;
    this.buttons[btn] = down;
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** 本帧刚按下 */
  hit(code: string): boolean {
    return this.pressed.has(code);
  }

  clicked(btn: number): boolean {
    return this.btnPressed[btn];
  }

  endFrame(): void {
    this.pressed.clear();
    this.btnPressed[0] = this.btnPressed[1] = this.btnPressed[2] = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.touchDX = 0;
    this.touchDY = 0;
    this.touchLooking = false;
    this.wheel = 0;
    this.wheelUp = this.wheelDown = 0;
  }
}

/** 首次判定：主指针是粗指针（手指）就用触屏模式 */
function initialMode(): InputMode {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return 'touch';
  } catch {
    /* 忽略 */
  }
  return 'desktop';
}

/** 设备是否以触屏为主（用于画质默认值等一次性判断） */
export function isTouchDevice(): boolean {
  try {
    return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
  } catch {
    return false;
  }
}
