/**
 * 触屏操控层（只在触屏模式、且对局进行中显示）：
 * - 左侧约 40% 屏幕：手指落下处出现浮动摇杆（推满 = 跑，小幅 = 静步）；
 * - 其余空白处：拖动转视角；
 * - 按钮：开火（右大、左小，按住时还能拖动瞄准）、开镜（点按切换）、换弹、跳、蹲（切换）、
 *   以及 HUD 上带 data-act 的元素：技能、交互（安装 / 拆除）、换枪（武器栏）、计分板（比分条）、解题选项。
 * 每根手指按 identifier 单独跟踪；手指从按钮上开始时不会转动视角（开火键除外）。
 * 触摸处理函数只记录状态（被动监听，无分配的热路径），DOM 写入集中在每帧 update() 里并带缓存。
 */
import type { Input } from '../core/input.ts';
import type { Match } from '../game/match.ts';
import { type Bind, bind, h } from './dom.ts';

type Act =
  | 'fire'
  | 'ads'
  | 'reload'
  | 'jump'
  | 'crouch'
  | 'swap'
  | 'q'
  | 'e'
  | 'x'
  | 'f'
  | 'pause'
  | 'buy'
  | 'score'
  | 'map'
  | 'slot0'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'slot4'
  | 'drop'
  | 'a0'
  | 'a1'
  | 'a2'
  | 'a3'
  | 'none';

interface Finger {
  kind: 'stick' | 'look' | 'btn' | 'dead';
  act: Act | null;
  el: Element | null;
  /** 开火键：按住时也可拖动瞄准 */
  aim: boolean;
  x: number;
  y: number;
}

/** 摇杆半径（CSS 像素） */
const STICK_R = 58;
/** 摇杆死区（比例） */
const DEAD = 0.12;
/** 左侧摇杆区域占屏宽比例 */
const STICK_ZONE = 0.4;

const KEY_OF: Partial<Record<Act, string>> = {
  reload: 'KeyR',
  jump: 'Space',
  swap: 'Swap',
  q: 'KeyQ',
  e: 'KeyE',
  x: 'KeyX',
  f: 'KeyF',
  map: 'MapToggle',
  slot0: 'Slot0',
  slot1: 'Slot1',
  slot2: 'Slot2',
  slot3: 'Slot3',
  slot4: 'Slot4',
  drop: 'Drop',
};

/** 武器栏按钮（参考常见手游战术射击布局：主 / 副 / 近战 / 投掷物 / 熵核） */
const SLOT_BTNS: [Act, string][] = [
  ['slot0', '主'],
  ['slot1', '副'],
  ['slot2', '刀'],
  ['slot3', '投'],
  ['slot4', '核'],
];

export interface TouchCallbacks {
  pause(): void;
  buy(): void;
}

export class TouchControls {
  root = h('div', 'tc is-hidden');
  private rootB = bind(this.root);
  /** 计分板是否由触屏打开 */
  scoreOn = false;

  private fingers = new Map<number, Finger>();
  private stickId = -1;
  private stickOX = 0;
  private stickOY = 0;
  private stickKX = 0;
  private stickKY = 0;
  private fireCount = 0;
  private m: Match | null = null;
  private lastFocus: unknown = null;

  private stickBase = bind(h('div', 'tc-stick'));
  private stickKnob = bind(h('div', 'tc-knob'));
  private adsB = bind(this.mk('ads', 'tc-btn tc-ads', '开镜'));
  private crouchB = bind(this.mk('crouch', 'tc-btn tc-crouch', '蹲'));
  private buyB = bind(this.mk('buy', 'tc-btn tc-buy', '购买 · 出击'));
  private adsLbl = bind(this.adsB.el.querySelector('.tc-lbl') as HTMLElement);
  private slotBs: Bind[] = [];
  private slotCount: Bind | null = null;
  private dropB = bind(this.mk('drop', 'tc-btn tc-drop', '丢'));
  /** 开镜键当前是“副射击”（连发 / 重刺 / 近抛）而不是开镜切换 */
  private altPress = false;
  private altFingers = 0;
  private visible = false;

  constructor(
    private input: Input,
    private cb: TouchCallbacks,
    hudRoot: HTMLElement,
  ) {
    const R = this.root;
    this.stickBase.el.append(this.stickKnob.el);
    const fire = this.mk('fire', 'tc-btn tc-fire', '');
    fire.append(fireIcon());
    const fire2 = this.mk('fire', 'tc-btn tc-fire2', '');
    fire2.append(fireIcon());
    R.append(
      this.stickBase.el,
      fire,
      fire2,
      this.adsB.el,
      this.mk('reload', 'tc-btn tc-reload', '换弹'),
      this.mk('jump', 'tc-btn tc-jump', '跳'),
      this.crouchB.el,
      this.mk('pause', 'tc-btn tc-pause', 'Ⅱ'),
      this.buyB.el,
    );
    const strip = h('div', 'tc-slots');
    for (const [act, lbl] of SLOT_BTNS) {
      const b = this.mk(act, 'tc-btn tc-slot', lbl);
      if (act === 'slot3') {
        const n = h('span', 'tc-count', '');
        b.append(n);
        this.slotCount = bind(n);
      }
      strip.append(b);
      this.slotBs.push(bind(b));
    }
    strip.append(this.dropB.el);
    R.append(strip);

    const opt = { passive: true } as const;
    for (const el of [R, hudRoot]) {
      el.addEventListener('touchstart', (e) => this.onStart(e), opt);
      el.addEventListener('touchmove', (e) => this.onMove(e), opt);
      el.addEventListener('touchend', (e) => this.onEnd(e), opt);
      el.addEventListener('touchcancel', (e) => this.onEnd(e), opt);
    }
  }

  private mk(act: Act, cls: string, label: string): HTMLElement {
    const b = h('div', cls);
    b.dataset.act = act;
    if (label) b.append(h('span', 'tc-lbl', label));
    return b;
  }

  // ------------------------------------------------------------ 触摸事件（只记录状态）

  private onStart(e: TouchEvent): void {
    if (!this.visible || !this.m) return;
    const W = window.innerWidth;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const target = t.target instanceof Element ? t.target : null;
      const actEl = target?.closest('[data-act]') ?? null;
      const act = (actEl?.getAttribute('data-act') ?? null) as Act | null;
      const f: Finger = { kind: 'btn', act, el: actEl, aim: false, x: t.clientX, y: t.clientY };
      if (act) {
        this.press(act, f);
      } else if (this.canMove() && this.stickId < 0 && t.clientX < W * STICK_ZONE) {
        f.kind = 'stick';
        this.stickId = t.identifier;
        // 摇杆底座不能贴出屏幕
        this.stickOX = Math.max(STICK_R + 8, Math.min(W * STICK_ZONE, t.clientX));
        this.stickOY = Math.max(STICK_R + 8, Math.min(window.innerHeight - STICK_R - 8, t.clientY));
        this.stickKX = this.stickKY = 0;
        this.updateStick(t.clientX, t.clientY);
      } else {
        f.kind = 'look';
      }
      this.fingers.set(t.identifier, f);
    }
  }

  private onMove(e: TouchEvent): void {
    if (!this.visible) return;
    const input = this.input;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const f = this.fingers.get(t.identifier);
      if (!f) continue;
      if (f.kind === 'stick') this.updateStick(t.clientX, t.clientY);
      else if (f.kind === 'look' || f.aim) {
        input.touchDX += t.clientX - f.x;
        input.touchDY += t.clientY - f.y;
        input.touchLooking = true;
      }
      f.x = t.clientX;
      f.y = t.clientY;
    }
  }

  private onEnd(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const f = this.fingers.get(t.identifier);
      if (!f) continue;
      this.fingers.delete(t.identifier);
      if (f.kind === 'stick') this.clearStick();
      else if (f.kind === 'btn' && f.act) this.releaseAct(f, t);
    }
  }

  private press(act: Act, f: Finger): void {
    const input = this.input;
    const m = this.m;
    switch (act) {
      case 'fire':
        f.aim = true;
        this.fireCount++;
        input.setButton(0, true);
        break;
      case 'ads':
        if (this.altPress) {
          // 副射击：按下时按住鼠标右键，松开时放开
          this.altFingers++;
          input.setButton(2, true);
        } else input.adsToggle = !input.adsToggle;
        break;
      case 'crouch':
        input.crouchToggle = !input.crouchToggle;
        break;
      case 'pause':
        this.cb.pause();
        break;
      case 'buy':
        this.cb.buy();
        break;
      case 'score':
        this.scoreOn = !this.scoreOn;
        break;
      case 'a0':
      case 'a1':
      case 'a2':
      case 'a3':
      case 'none':
        // 解题选项在松手时作答；面板上的触摸不转视角也不开火
        break;
      default: {
        const k = KEY_OF[act];
        if (k) input.press(k);
        if (act === 'f' && m) this.neutralize();
      }
    }
  }

  private releaseAct(f: Finger, t: Touch): void {
    const act = f.act;
    if (!act) return;
    if (act === 'fire') {
      this.fireCount = Math.max(0, this.fireCount - 1);
      if (this.fireCount === 0) this.input.setButton(0, false);
      return;
    }
    if (act === 'ads' && this.altFingers > 0) {
      this.altFingers--;
      if (this.altFingers === 0) this.input.setButton(2, false);
      return;
    }
    const k = KEY_OF[act];
    if (k) {
      this.input.release(k);
      return;
    }
    if (act === 'a0' || act === 'a1' || act === 'a2' || act === 'a3') {
      // 松手时仍在该选项上才作答（手指滑开可以反悔）
      const r = f.el?.getBoundingClientRect();
      if (r && this.m && t.clientX >= r.left - 8 && t.clientX <= r.right + 8 && t.clientY >= r.top - 8 && t.clientY <= r.bottom + 8)
        this.m.answerFocus(Number(act[1]));
    }
  }

  private updateStick(x: number, y: number): void {
    let dx = x - this.stickOX,
      dy = y - this.stickOY;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      dx *= STICK_R / d;
      dy *= STICK_R / d;
    }
    this.stickKX = dx;
    this.stickKY = dy;
    const mag = Math.min(1, d / STICK_R);
    if (mag < DEAD) {
      this.input.moveX = this.input.moveY = 0;
      return;
    }
    // 去掉死区后重新映射到 0..1，方向不变
    const k = (mag - DEAD) / (1 - DEAD);
    const len = Math.hypot(dx, dy);
    this.input.moveX = (dx / len) * k;
    this.input.moveY = (-dy / len) * k;
  }

  private clearStick(): void {
    this.stickId = -1;
    this.stickKX = this.stickKY = 0;
    this.input.moveX = this.input.moveY = 0;
  }

  /** 让当前按住摇杆的手指失效（解题面板打开时，避免停在摇杆上的拇指立刻中断操作） */
  private neutralize(): void {
    if (this.stickId >= 0) {
      const f = this.fingers.get(this.stickId);
      if (f) f.kind = 'dead';
      this.clearStick();
    }
  }

  private canMove(): boolean {
    const m = this.m;
    return !!m && m.player.alive;
  }

  /** 松开所有手指（暂停、打开菜单、对局结束时） */
  reset(): void {
    this.fingers.clear();
    this.fireCount = 0;
    this.altFingers = 0;
    this.clearStick();
    this.input.setButton(0, false);
    this.input.setButton(2, false);
    for (const k of Object.values(KEY_OF)) this.input.release(k);
  }

  // ------------------------------------------------------------ 每帧（带缓存的 DOM 写入）

  update(m: Match | null, show: boolean): void {
    this.m = m;
    if (show !== this.visible) {
      this.visible = show;
      this.rootB.show(show);
      if (!show) {
        this.reset();
        this.scoreOn = false;
      }
    }
    if (!show || !m) {
      this.lastFocus = null;
      return;
    }
    const p = m.player;
    // 解题面板（安装 / 拆除）刚打开：让摇杆手指失效
    const fq = m.focus;
    if (fq !== this.lastFocus) {
      this.lastFocus = fq;
      if (fq && fq.kind !== 'revive') this.neutralize();
    }
    const buy = m.phase === 'buy';
    this.rootB.cls('is-dead', !p.alive);
    this.rootB.cls('is-buy', buy);
    this.rootB.cls('is-focus', !!fq);
    // 开镜键：能开镜的武器为切换开镜；手枪连发 / 匕首重刺 / 投掷物近抛时为“按住副射击”
    const def = p.weapon.def;
    const adsable = def.zoom > 0 && (def.alt === 'ads' || def.alt === 'adsBurst' || def.alt === 'scope');
    const alt = def.alt === 'burst' || def.alt === 'heavy' || def.alt === 'lob';
    if (this.altPress !== alt) {
      this.altPress = alt;
      if (!alt && this.altFingers > 0) {
        this.altFingers = 0;
        this.input.setButton(2, false);
      }
    }
    this.adsB.cls('is-on', adsable && this.input.adsToggle);
    this.adsB.show(adsable || alt);
    this.adsLbl.text(def.alt === 'burst' ? '连发' : def.alt === 'heavy' ? '重刺' : def.alt === 'lob' ? '近抛' : def.alt === 'scope' ? '开镜' : '机瞄');
    for (let i = 0; i < 5; i++) {
      const b = this.slotBs[i];
      const slot = i as 0 | 1 | 2 | 3 | 4;
      b.show(p.hasSlot(slot));
      b.cls('is-on', p.slot === slot);
    }
    this.slotCount?.text(p.totalNades() > 0 ? String(p.totalNades()) : '');
    this.dropB.show(p.slot === 0 || p.slot === 4 || (p.slot === 1 && p.slots[1].def.price > 0));
    this.crouchB.cls('is-on', this.input.crouchToggle);
    // 摇杆：按住时在手指处显示，否则在左下角淡淡提示位置
    const active = this.stickId >= 0;
    this.stickBase.cls('is-active', active);
    if (active) {
      this.stickBase.style('transform', `translate3d(${this.stickOX.toFixed(0)}px, ${this.stickOY.toFixed(0)}px, 0)`);
      this.stickKnob.style('transform', `translate3d(${this.stickKX.toFixed(0)}px, ${this.stickKY.toFixed(0)}px, 0)`);
    } else {
      this.stickBase.style('transform', '');
      this.stickKnob.style('transform', '');
    }
  }
}

function fireIcon(): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML =
    '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>';
  return s;
}
