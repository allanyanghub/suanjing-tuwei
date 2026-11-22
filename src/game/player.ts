import * as THREE from 'three';
import { hasScope, type WeaponDef } from '../data/defs.ts';
import { ANSWER_CODES, actDown, actHit } from '../data/controls.ts';
import {
  ADS_TIME,
  AIR_ACCEL,
  CROUCH_MUL,
  GROUND_ACCEL,
  GROUND_FRICTION,
  JUMP_VY,
  LAND_RECOVER,
  PUNCH_K,
  PUNCH_RECOVER,
  RECOIL_MAX,
  RUN_SPEED,
  SCOPE_TIME,
  WALK_MUL,
} from '../data/handling.ts';
import { audio } from '../core/audio.ts';
import { save } from '../core/save.ts';
import { moveBody } from '../world/physics.ts';
import { recoilKick, type Match } from './match.ts';
import { SLOT_MELEE, SLOT_NADE, SLOT_PRIMARY, SLOT_SIDEARM, SLOT_SPIKE, type Combatant, type SlotIndex } from './combatant.ts';
import { AimAssist } from './assist.ts';

/** 第一人称玩家控制器：视角、移动、射击、后坐力、开镜、换枪、技能、观战镜头。按键全部来自 data/controls.ts */

const LOOK_K = 0.0022;
/** 触屏拖动：每 CSS 像素转动的弧度（灵敏度 1 时，横向划过约 1/3 个 iPad 屏幕转 90°） */
const TOUCH_LOOK_K = 0.0045;
/** 摇杆推到这个幅度以下为静步（无脚步声），以上逐渐加速到跑步 */
const STICK_WALK = 0.6;
/** 摇杆转向模式下，摇杆推满时的转身速度（弧度/秒，约 140°/秒；乘触屏灵敏度） */
const STICK_TURN_RATE = 2.4;
const PITCH_LIMIT = 1.5;
const BUY_PAD = 5;

type DashFn = (c: Combatant) => { x: number; z: number } | null;

const _look = new THREE.Vector3();
const _pull = { yaw: 0, pitch: 0 };
const _kick = { p: 0, y: 0 };
const SLOT_ORDER: SlotIndex[] = [0, 1, 2, 3, 4];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class PlayerController {
  /** 0..1，旧接口：准星扩散比例 */
  crosshairSpread = 0;
  /** 准星间隙（CSS 像素）：由真实散布换算，与弹道一致 */
  crosshairPx = 0;
  /** 小地图放大：M 切换、Caps Lock 按住 */
  mapToggle = false;
  mapBig = false;

  /** 后坐力造成的视角偏移（与玩家自身瞄准分离，停火后回正；影响弹道） */
  private recoilP = 0;
  private recoilY = 0;
  /** 镜头冲击（只影响画面） */
  private punch = 0;
  private punchV = 0;
  /** 距上次开火的时间（游戏时间） */
  private sinceShot = 10;
  /** 半自动武器：按住左键时缓冲一发 */
  private semiPending = false;
  /** 切换式开镜的状态（桌面） */
  private adsLatch = false;

  private wasOnGround = true;
  private landTarget = 0;
  private landDip = 0;
  private bobPhase = 0;
  private bobAmp = 0;

  private curFov = -1;
  private vmDef: WeaponDef | null = null;

  private wasAlive = true;
  private deathX = 0;
  private deathY = 0;
  private deathZ = 0;
  private specTarget: Combatant | null = null;
  private specPos = new THREE.Vector3();
  private specLook = new THREE.Vector3();
  private specInit = false;
  private assist: AimAssist;

  constructor(
    private m: Match,
    private p: Combatant,
  ) {
    this.assist = new AimAssist(m);
  }

  // ------------------------------------------------------------ 后坐力

  /** 每发：先竖直上抬，若干发后按固定节奏左右摆（可学习的弹道）；首发几乎无偏移 */
  recoil(def: WeaponDef, spray: number): void {
    recoilKick(def, spray, _kick);
    this.recoilP = Math.min(RECOIL_MAX, this.recoilP + _kick.p);
    this.recoilY = clamp(this.recoilY + _kick.y, -0.15, 0.15);
    this.punchV += _kick.p * PUNCH_K * 60;
    this.sinceShot = 0;
  }

  /** 当前准星方向（含后坐力偏移） */
  aimDir(out: { x: number; y: number; z: number }): void {
    const p = this.p;
    const ap = clamp(p.pitch + this.recoilP, -PITCH_LIMIT, PITCH_LIMIT);
    const ay = p.yaw + this.recoilY;
    const cp = Math.cos(ap);
    out.x = -Math.sin(ay) * cp;
    out.y = Math.sin(ap);
    out.z = -Math.cos(ay) * cp;
  }

  // ------------------------------------------------------------ 主更新

  update(dt: number, g: number): void {
    const m = this.m;
    const p = this.p;
    const input = m.input;
    // 桌面 = 指针已锁定；触屏 = 对局进行中且无菜单遮挡
    const locked = input.active;
    const touch = input.touchMode;

    // 外部（购买、回合重置、拾取）可能换了武器：同步视图模型
    if (p.weapon.def !== this.vmDef) this.syncWeapon();

    if (!p.alive) {
      if (this.wasAlive) this.onDeath();
      this.wasAlive = false;
      this.answerKeys();
      this.mapKeys(locked);
      this.updateDead(dt);
      return;
    }
    if (!this.wasAlive) {
      // 复活或新回合
      this.wasAlive = true;
      this.specInit = false;
      this.specTarget = null;
      this.recoilP = this.recoilY = this.punch = this.punchV = 0;
      this.assist.reset();
      input.adsToggle = input.crouchToggle = false;
      this.adsLatch = false;
    }
    m.viewModel.root.visible = true;

    const def = p.weapon.def;

    // ---------- 视角（真实时间）
    const baseFov = save.settings.fov;
    const zoomNow = 1 + (Math.max(1, this.zoomOf(def)) - 1) * p.ads;
    // 鼠标与触屏拖动走同一条路径：都换算成“等效鼠标像素”，各自有灵敏度
    const touchK = (TOUCH_LOOK_K / LOOK_K) * save.settings.touchSens;
    let mdx = locked ? input.mouseDX * save.settings.sens + input.touchDX * touchK : 0;
    let mdy = locked ? input.mouseDY * save.settings.sens + input.touchDY * touchK : 0;
    const assistOn = locked && touch && (m.phase === 'live' || m.phase === 'planted' || m.phase === 'end');
    if (assistOn) {
      this.assist.scan(p, p.yaw + this.recoilY, clamp(p.pitch + this.recoilP, -PITCH_LIMIT, PITCH_LIMIT), save.settings.assist);
      // 减速：只作用于手指拖动的部分
      const f = this.assist.friction(save.settings.assist);
      mdx *= f;
      mdy *= f;
    } else this.assist.target = null;
    if (locked) {
      const k = LOOK_K * (1 / zoomNow);
      p.yaw = wrapAngle(p.yaw - mdx * k);
      // 摇杆转向模式：摇杆左右推 = 转身（平方曲线：轻推慢转好瞄准，推满快速转身）
      if (touch && save.settings.stickTurn && input.moveX !== 0) {
        const t = input.moveX * Math.abs(input.moveX);
        p.yaw = wrapAngle(p.yaw - (t * STICK_TURN_RATE * save.settings.touchSens * dt) / zoomNow);
      }
      let dp = -mdy * k;
      // 吸附：手指正在拖动时，按拖动量把准星拉向目标
      if (assistOn && input.touchLooking) {
        this.assist.magnet(save.settings.assist, Math.hypot(mdx, mdy) * k, _pull);
        p.yaw = wrapAngle(p.yaw + _pull.yaw);
        dp += _pull.pitch;
      }
      // 向下压枪时先抵消后坐力偏移，避免回正后“压过头”
      if (dp < 0 && this.recoilP > 0) {
        const absorb = Math.min(this.recoilP, -dp);
        this.recoilP -= absorb;
        dp += absorb;
      }
      p.pitch = clamp(p.pitch + dp, -PITCH_LIMIT, PITCH_LIMIT);
    }

    // ---------- 后坐力回正（游戏时间）：停火超过一发间隔后，在 reset 时间内回正
    this.sinceShot += g;
    const holdT = 60 / def.rpm + 0.04;
    if (this.sinceShot > holdT) {
      const r = Math.min(1, g * (4 / Math.max(0.1, def.reset)));
      this.recoilP -= this.recoilP * r;
      this.recoilY -= this.recoilY * r;
    }
    // 镜头冲击：弹簧回正
    this.punchV -= this.punch * PUNCH_RECOVER * PUNCH_RECOVER * dt + this.punchV * 2 * PUNCH_RECOVER * dt;
    this.punch += this.punchV * dt;
    if (Math.abs(this.punch) < 1e-5 && Math.abs(this.punchV) < 1e-4) this.punch = this.punchV = 0;

    const phase = m.phase;
    const buy = phase === 'buy';
    const combat = phase === 'live' || phase === 'planted' || phase === 'end';
    const focusOpen = m.focus !== null;

    // ---------- 按键
    this.mapKeys(locked);
    if (locked) {
      if (focusOpen) this.answerKeys();
      else {
        if (actHit(input, 'slot1')) m.equipSlot(p, SLOT_PRIMARY);
        else if (actHit(input, 'slot2')) m.equipSlot(p, SLOT_SIDEARM);
        else if (actHit(input, 'slot3')) m.equipSlot(p, SLOT_MELEE);
        else if (actHit(input, 'slot4')) this.spikeKey();
        else if (actHit(input, 'slot5')) this.nadeKey();
        else if (actHit(input, 'next')) this.cycle(1);
        else if (input.hit('Swap')) this.quickSwap();
        // 触屏武器栏按钮
        else if (input.hit('Slot0')) m.equipSlot(p, SLOT_PRIMARY);
        else if (input.hit('Slot1')) m.equipSlot(p, SLOT_SIDEARM);
        else if (input.hit('Slot2')) m.equipSlot(p, SLOT_MELEE);
        else if (input.hit('Slot3')) this.nadeKey();
        else if (input.hit('Slot4')) this.spikeKey();
      }
      if (actHit(input, 'reload')) m.startReload(p);
      if (actHit(input, 'use')) m.interact();
      if (actHit(input, 'drop') || input.hit('Drop')) m.dropCurrent(p);
      if (actHit(input, 'inspect') && !focusOpen) this.inspect();
      if (combat) {
        if (actHit(input, 'abilityQ')) m.abilities.use(p, 'q');
        if (actHit(input, 'abilityE')) m.abilities.use(p, 'e');
        if (actHit(input, 'ult')) m.abilities.use(p, 'x');
      }
    }

    // ---------- 开镜 / 副射击
    const w2 = p.weapon;
    const def2 = w2.def;
    this.updateAds(dt, locked, touch);

    // ---------- 蹲伏（按住；触屏为切换）
    const crouchKey = locked && (actDown(input, 'crouch') || input.crouchToggle);
    const cr = g / 0.12;
    p.crouch = crouchKey ? Math.min(1, p.crouch + cr) : Math.max(0, p.crouch - cr);

    // ---------- 移动（游戏时间）
    const body = p.body;
    let fwd = 0,
      side = 0;
    if (locked) {
      if (actDown(input, 'forward')) fwd += 1;
      if (actDown(input, 'back')) fwd -= 1;
      if (actDown(input, 'right')) side += 1;
      if (actDown(input, 'left')) side -= 1;
      // 触屏摇杆（模拟量）：与键盘叠加后再限制长度
      if (touch && save.settings.stickTurn) {
        // 摇杆转向模式：左右分量用来转身，不平移；斜推时前后速度不要被"摊薄"成静步
        fwd += Math.max(-1, Math.min(1, input.moveY * 1.3));
      } else {
        fwd += input.moveY;
        side += input.moveX;
      }
    }
    const sy = Math.sin(p.yaw),
      cy = Math.cos(p.yaw);
    // 前 = (-sin, -cos)，右 = (cos, -sin)
    let wx = -sy * fwd + cy * side;
    let wz = -cy * fwd - sy * side;
    const wl = Math.hypot(wx, wz);
    // 摇杆幅度：小幅 = 静步，推满 = 跑步（键盘总是 1）
    const stick = Math.min(1, wl);
    if (wl > 0) {
      wx /= wl;
      wz /= wl;
    }
    // 没有冲刺键：持枪奔跑是默认速度；匕首更快、重武器更慢
    let maxSpeed = RUN_SPEED * def2.moveMul;
    const walkKey = locked && actDown(input, 'walk');
    p.walking = walkKey || (stick > 0 && stick <= STICK_WALK + 0.05 && (input.moveX !== 0 || input.moveY !== 0));
    if (walkKey) maxSpeed *= WALK_MUL;
    if (stick < 1) maxSpeed *= stick <= STICK_WALK ? (WALK_MUL * stick) / STICK_WALK : WALK_MUL + ((1 - WALK_MUL) * (stick - STICK_WALK)) / (1 - STICK_WALK);
    maxSpeed *= 1 - (1 - CROUCH_MUL) * p.crouch;
    if (p.slowT > 0) maxSpeed *= 0.5;
    if (p.ampT > 0) maxSpeed *= 1.2;
    // 开镜时移速降低（狙击镜更慢）
    if (p.ads > 0.5) maxSpeed *= def2.adsMove;

    const tvx = wx * maxSpeed,
      tvz = wz * maxSpeed;
    if (body.onGround) {
      // 松开按键几乎立刻停下（GROUND_FRICTION）
      const rate = wl > 0 ? GROUND_ACCEL : GROUND_FRICTION;
      const a = 1 - Math.exp(-rate * g);
      body.vx += (tvx - body.vx) * a;
      body.vz += (tvz - body.vz) * a;
      if (wl === 0 && Math.abs(body.vx) + Math.abs(body.vz) < 0.05) body.vx = body.vz = 0;
      if (locked && actHit(input, 'jump')) {
        body.vy = JUMP_VY;
        body.onGround = false;
      }
    } else if (wl > 0) {
      // 空中：只向目标方向微调，不超过当前与目标中较大的速度
      const a = 1 - Math.exp(-AIR_ACCEL * g);
      const before = Math.hypot(body.vx, body.vz);
      body.vx += (tvx - body.vx) * a;
      body.vz += (tvz - body.vz) * a;
      const cap = Math.max(before, maxSpeed);
      const after = Math.hypot(body.vx, body.vz);
      if (after > cap && after > 0) {
        body.vx *= cap / after;
        body.vz *= cap / after;
      }
    }

    // 技能冲刺：强制水平速度
    const dash = (m.abilities as { dashVelocity?: DashFn }).dashVelocity?.(p);
    if (dash) {
      body.vx = dash.x;
      body.vz = dash.z;
    }

    const prevVy = body.vy;
    if (g > 0) moveBody(body, g, m.map.boxes);

    // 准备阶段：限制在出生区附近
    if (buy) {
      const r = m.playerSide === 'attack' ? m.map.attackSpawn : m.map.defendSpawn;
      const nx = clamp(body.x, r.x0 - BUY_PAD, r.x1 + BUY_PAD);
      const nz = clamp(body.z, r.z0 - BUY_PAD, r.z1 + BUY_PAD);
      if (nx !== body.x) body.vx = 0;
      if (nz !== body.z) body.vz = 0;
      body.x = nx;
      body.z = nz;
    }
    p.speed = Math.hypot(body.vx, body.vz);

    // 落地：镜头下沉 + 短暂的落地散布
    if (body.onGround && !this.wasOnGround && prevVy < -2) {
      this.landTarget = Math.max(this.landTarget, Math.min(0.14, -prevVy * 0.012));
      p.landT = LAND_RECOVER;
      audio.land();
    }
    this.wasOnGround = body.onGround;

    // ---------- 射击
    const canFire = locked && combat && !focusOpen;
    const wf = p.weapon;
    const cls = wf.def.cls;
    if (canFire) {
      if (cls === 'spike') {
        // 手持熵核：在目标点左键开始解题安装
        if (input.clicked(0)) m.interact();
      } else if (wf.def.auto || cls === 'melee') {
        if (input.buttons[0]) this.tryFire(false);
        this.semiPending = false;
      } else {
        if (input.clicked(0)) this.semiPending = true;
        if (this.semiPending) {
          if (this.tryFire(false) || (wf.mag <= 0 && cls !== 'throwable')) this.semiPending = false;
          else if (!input.buttons[0] && !input.clicked(0)) this.semiPending = false;
        }
      }
      // 副射击：手枪连发、匕首重刺、投掷物近抛
      const alt = wf.def.alt;
      if (alt === 'burst' || alt === 'lob' ? input.clicked(2) : alt === 'heavy' ? input.buttons[2] : false) this.tryFire(true);
    } else this.semiPending = false;

    // ---------- 触屏自动开火：准星稳定停在可见敌人身上
    if (canFire && touch && save.settings.autoFire && (cls !== 'melee' && cls !== 'throwable' && cls !== 'spike')) {
      const ap = clamp(p.pitch + this.recoilP, -PITCH_LIMIT, PITCH_LIMIT);
      const ay = p.yaw + this.recoilY;
      const cp = Math.cos(ap);
      if (this.assist.autoFire(p, -Math.sin(ay) * cp, Math.sin(ap), -Math.cos(ay) * cp, wf.def.kind, dt)) this.tryFire(false);
    }

    // ---------- 镜头
    this.updateCamera(dt, g, baseFov, mdx, mdy);
  }

  // ------------------------------------------------------------ 内部

  /** 当前开镜倍率（狙击第二档） */
  private zoomOf(def: WeaponDef): number {
    if (def.alt === 'scope') return this.p.scopeLevel >= 2 && def.zoom2 > 0 ? def.zoom2 : def.zoom;
    return def.zoom;
  }

  /** 开镜：桌面按设置「按住 / 切换」，触屏点按切换；换弹时退出，换完自动恢复（切换模式） */
  private updateAds(dt: number, locked: boolean, touch: boolean): void {
    const p = this.p;
    const input = this.m.input;
    const w = p.weapon;
    const def = w.def;
    const adsable = def.zoom > 0 && (def.alt === 'ads' || def.alt === 'adsBurst' || def.alt === 'scope');
    if (!adsable) {
      input.adsToggle = false;
      this.adsLatch = false;
      p.scopeLevel = 0;
      p.ads = Math.max(0, p.ads - dt / ADS_TIME);
      return;
    }
    const scope = def.alt === 'scope';
    const mode = scope ? save.settings.scopeMode : save.settings.adsMode;
    let want: boolean;
    if (touch) want = input.adsToggle;
    else if (mode === 'hold') {
      want = locked && input.buttons[2];
      if (scope) p.scopeLevel = want ? 1 : 0;
    } else {
      if (locked && input.clicked(2)) {
        if (scope && def.zoom2 > 0) {
          // 狙击切换：第一档 → 第二档 → 关
          p.scopeLevel = (p.scopeLevel + 1) % 3;
          this.adsLatch = p.scopeLevel > 0;
          audio.scope(p.scopeLevel > 0);
        } else this.adsLatch = !this.adsLatch;
      }
      want = locked && this.adsLatch;
    }
    if (touch && scope) p.scopeLevel = want ? Math.max(1, p.scopeLevel) : 0;
    if (scope && !touch && mode === 'toggle' && !want) p.scopeLevel = 0;
    if (scope && want && p.scopeLevel === 0) p.scopeLevel = 1;
    want = want && w.reloadT <= 0 && p.equipT <= 0;
    const rate = dt / (scope ? SCOPE_TIME : ADS_TIME);
    p.ads = want ? Math.min(1, p.ads + rate) : Math.max(0, p.ads - rate);
  }

  private mapKeys(locked: boolean): void {
    const input = this.m.input;
    if (locked && actHit(input, 'map')) this.mapToggle = !this.mapToggle;
    if (input.hit('MapToggle')) this.mapToggle = !this.mapToggle;
    this.mapBig = this.mapToggle || (locked && actDown(input, 'mapHold'));
  }

  private spikeKey(): void {
    const m = this.m;
    const p = this.p;
    // 防守方在熵核旁、或进攻方在目标点：直接开始解题
    const hint = m.interactHint();
    if (hint.includes('熵核')) {
      m.interact();
      return;
    }
    if (p.hasSpike) m.equipSlot(p, SLOT_SPIKE);
  }

  private nadeKey(): void {
    const p = this.p;
    if (p.totalNades() <= 0) {
      this.m.ui.toast('没有投掷物（准备阶段可以在军械库购买）');
      return;
    }
    if (p.slot === SLOT_NADE) {
      // 再按一次：换下一种
      const before = p.nadeSel;
      p.pickNade(before);
      if (p.nadeSel !== before) this.m.equipSlot(p, SLOT_NADE, true);
      return;
    }
    this.m.equipSlot(p, SLOT_NADE);
  }

  /** 滚轮：按 1→5 顺序切换到下一个可用栏位 */
  private cycle(dir: number): void {
    const p = this.p;
    const i = SLOT_ORDER.indexOf(p.slot);
    for (let k = 1; k <= 5; k++) {
      const s = SLOT_ORDER[(i + dir * k + 50) % 5];
      if (p.hasSlot(s)) {
        this.m.equipSlot(p, s);
        return;
      }
    }
  }

  /** 触屏武器框：主 / 副武器互换 */
  private quickSwap(): void {
    const p = this.p;
    if (p.slot === SLOT_PRIMARY || !p.slots[0]) this.m.equipSlot(p, SLOT_SIDEARM);
    else this.m.equipSlot(p, SLOT_PRIMARY);
  }

  private inspect(): void {
    const p = this.p;
    const w = p.weapon;
    if (w.reloadT > 0 || p.ads > 0.1 || p.equipT > 0) return;
    this.m.viewModel.inspect();
  }

  private tryFire(alt: boolean): boolean {
    const p = this.p;
    const ap = clamp(p.pitch + this.recoilP, -PITCH_LIMIT, PITCH_LIMIT);
    const ay = p.yaw + this.recoilY;
    const cp = Math.cos(ap);
    return this.m.fire(p, -Math.sin(ay) * cp, Math.sin(ap), -Math.cos(ay) * cp, 0, alt);
  }

  private answerKeys(): void {
    const m = this.m;
    if (!m.focus || !m.input.active) return;
    for (let i = 0; i < 4; i++) {
      const keys = ANSWER_CODES[i];
      if (m.input.hit(keys[0]) || m.input.hit(keys[1])) {
        m.answerFocus(i);
        return;
      }
    }
  }

  private syncWeapon(): void {
    const p = this.p;
    const def = p.weapon.def;
    this.vmDef = def;
    this.semiPending = false;
    this.adsLatch = false;
    this.m.input.adsToggle = false;
    this.m.viewModel.setWeapon(def, p.equipT);
    this.m.syncModel(p);
  }

  private setFov(fov: number): void {
    if (Math.abs(fov - this.curFov) < 1e-3) return;
    this.curFov = fov;
    const cam = this.m.stage.camera;
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }

  private updateCamera(dt: number, g: number, baseFov: number, mdx: number, mdy: number): void {
    const p = this.p;
    const body = p.body;
    const cam = this.m.stage.camera;
    const w = p.weapon;
    const def = w.def;

    // FOV：在半角正切空间里按倍率缩放
    const zoom = 1 + (Math.max(1, this.zoomOf(def)) - 1) * p.ads;
    const halfTan = Math.tan(THREE.MathUtils.degToRad(baseFov) / 2) / zoom;
    this.setFov(THREE.MathUtils.radToDeg(2 * Math.atan(halfTan)));

    // 落地下沉（缓入缓出）
    this.landTarget *= Math.exp(-7 * g);
    this.landDip += (this.landTarget - this.landDip) * Math.min(1, g * 22);

    // 走路晃动
    const sf = Math.min(1, p.speed / RUN_SPEED);
    const ampT = body.onGround ? sf * (1 - p.ads * 0.85) : 0;
    this.bobAmp += (ampT - this.bobAmp) * Math.min(1, g * 10);
    this.bobPhase += g * p.speed * 1.9;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.028 * this.bobAmp;
    const bobX = Math.sin(this.bobPhase) * 0.012 * this.bobAmp;

    const rx = Math.cos(p.yaw),
      rz = -Math.sin(p.yaw);
    cam.position.set(body.x + rx * bobX, p.eyeY() - this.landDip - bobY, body.z + rz * bobX);
    const ap = clamp(p.pitch + this.recoilP + this.punch, -PITCH_LIMIT, PITCH_LIMIT);
    cam.rotation.set(ap, p.yaw + this.recoilY, 0);

    // 视图模型
    let reload01 = 0;
    if (w.reloadT > 0 && def.reload > 0) reload01 = Math.sin(Math.PI * clamp(1 - w.reloadT / def.reload, 0, 1));
    this.m.viewModel.scoped = hasScope(def);
    this.m.viewModel.update(dt, mdx, mdy, p.speed, p.ads, reload01, body.onGround);

    // 准星：真实散布换算成屏幕像素（与弹道一致）
    const spread = def.cls === 'melee' || def.cls === 'throwable' || def.cls === 'spike' ? 0.004 : this.m.spreadOf(p, w);
    const fovRad = THREE.MathUtils.degToRad(cam.fov);
    const px = (Math.tan(spread) / Math.tan(fovRad / 2)) * (window.innerHeight / 2);
    this.crosshairPx += (px - this.crosshairPx) * Math.min(1, dt * 30);
    this.crosshairSpread = clamp(spread / 0.1, 0, 1);

    audio.lx = cam.position.x;
    audio.lz = cam.position.z;
    audio.lyaw = cam.rotation.y;
  }

  private onDeath(): void {
    const p = this.p;
    const cam = this.m.stage.camera;
    this.deathX = p.body.x;
    this.deathY = p.body.y;
    this.deathZ = p.body.z;
    p.ads = 0;
    p.speed = 0;
    this.semiPending = false;
    this.recoilP = this.recoilY = this.punch = this.punchV = 0;
    this.landDip = this.landTarget = 0;
    this.specTarget = null;
    this.specPos.copy(cam.position);
    // 初始注视点：当前视线前方
    this.specLook.set(cam.position.x - Math.sin(p.yaw) * 4, cam.position.y, cam.position.z - Math.cos(p.yaw) * 4);
    this.specInit = true;
  }

  private updateDead(dt: number): void {
    const m = this.m;
    const p = this.p;
    const cam = m.stage.camera;
    m.viewModel.root.visible = false;
    p.speed = 0;
    p.body.vx = p.body.vz = 0;
    p.ads = 0;
    this.crosshairSpread = 0;
    this.setFov(save.settings.fov);

    if (!this.specInit) {
      this.specPos.copy(cam.position);
      this.specLook.set(this.deathX, this.deathY + 1, this.deathZ);
      this.specInit = true;
    }

    // 选择观战的队友（保持当前目标直到其阵亡）
    let t = this.specTarget;
    if (!t || !t.alive) {
      t = null;
      for (const c of m.combatants) {
        if (c.team === 0 && !c.isPlayer && c.alive) {
          t = c;
          break;
        }
      }
      this.specTarget = t;
    }

    let px: number, py: number, pz: number, lx: number, ly: number, lz: number;
    if (t) {
      const fx = -Math.sin(t.yaw),
        fz = -Math.cos(t.yaw);
      const ey = t.eyeY();
      px = t.body.x - fx * 3.2;
      py = ey + 1.3;
      pz = t.body.z - fz * 3.2;
      lx = t.body.x + fx * 5;
      ly = ey - 0.2;
      lz = t.body.z + fz * 5;
    } else {
      px = this.deathX;
      py = this.deathY + 10;
      pz = this.deathZ + 7;
      lx = this.deathX;
      ly = this.deathY + 0.5;
      lz = this.deathZ;
    }
    const a = 1 - Math.exp(-5 * dt);
    this.specPos.x += (px - this.specPos.x) * a;
    this.specPos.y += (py - this.specPos.y) * a;
    this.specPos.z += (pz - this.specPos.z) * a;
    const b = 1 - Math.exp(-7 * dt);
    this.specLook.x += (lx - this.specLook.x) * b;
    this.specLook.y += (ly - this.specLook.y) * b;
    this.specLook.z += (lz - this.specLook.z) * b;

    cam.position.copy(this.specPos);
    _look.copy(this.specLook);
    cam.lookAt(_look);

    m.viewModel.update(dt, 0, 0, 0, 0, 0, true);

    audio.lx = cam.position.x;
    audio.lz = cam.position.z;
    audio.lyaw = cam.rotation.y;
  }
}
