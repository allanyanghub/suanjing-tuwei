import * as THREE from 'three';
import type { AbilityId } from '../data/defs.ts';
import { audio } from '../core/audio.ts';
import { rayBoxes, segmentClear, segmentHitsSphere, type Box } from '../world/physics.ts';
import type { Combatant } from './combatant.ts';
import type { Match } from './match.ts';
import { buildWorldItem } from '../render/weapons.ts';

// ---------------------------------------------------------------- 常量

export const GRAVITY = 14;
const THROW_SPEED = 17;
const THROW_UP = 0.22;

const DASH_SPEED = 22;
const DASH_TIME = 0.18;

const FLASH_FUSE = 0.7;
const FLASH_RANGE = 25;
const FLASH_TIME = 2;

const SMOKE_R = 4;
const SMOKE_LIFT = 1.5;
const SMOKE_TIME = 12;
const SMOKE_FADE = 1.2;

const SLOW_R = 5;
const SLOW_TIME = 8;

const STRIKE_RANGE = 40;
const STRIKE_DELAY = 1.5;
const STRIKE_SPREAD = 3;
const STRIKE_R = 6;
const STRIKE_DMG = 150;

const HEAL_AMOUNT = 60;
const HEAL_RANGE = 8;

const WALL_W = 6;
const WALL_H = 3;
const WALL_T = 0.7;
const WALL_DIST = 4.5;
const WALL_TIME = 20;

const AMP_TIME = 8;
const SHIELD_AMOUNT = 50;

/** 投掷物最长飞行时间（烟幕 / 力场在此之后原地生效） */
const MAX_FLIGHT = 3;

// ---- 购买的投掷物（手雷 / 烟雾弹 / 闪光弹）
/** 左键远投、右键近抛的出手速度与上抬 */
export const NADE_LONG = { speed: 16, up: 0.2 };
export const NADE_SHORT = { speed: 7.5, up: 0.45 };
/** 破片手雷：第一次弹跳后 1.6 秒爆炸，最长 2.2 秒；中心伤害 120，6 米处为 0 */
const FRAG_AFTER_BOUNCE = 1.6;
const FRAG_MAX = 2.2;
const FRAG_DMG = 120;
const FRAG_R = 6;
/** 闪光弹出手后 0.9 秒爆闪；队友（非投掷者本人）致盲时间减半 */
const NADE_FLASH_FUSE = 0.9;
const NADE_FLASH_TEAM = 0.5;
/** 弹跳：法向反弹系数 / 切向摩擦 */
const BOUNCE_N = 0.42;
const BOUNCE_T = 0.7;
const SMOKE_GREY = 0xb8bfcc;

export type NadeKind = 'frag' | 'smoke' | 'flash';

// ---------------------------------------------------------------- 类型

export interface SmokeZone {
  x: number;
  y: number;
  z: number;
  r: number;
  /** 剩余时间（秒） */
  t: number;
  /** 已存在时间 */
  age: number;
  owner: Combatant;
  mesh: THREE.Group;
}

type ThrowKind = 'flash' | 'smoke' | 'slow';

interface Projectile {
  kind: ThrowKind | 'frag';
  /** 购买的投掷物（会在地面弹跳、按引信计时） */
  nade: boolean;
  /** 第一次弹跳的时刻（-1 = 尚未弹跳） */
  bounceAt: number;
  owner: Combatant;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  mesh: THREE.Object3D;
}

interface SlowField {
  x: number;
  y: number;
  z: number;
  r: number;
  t: number;
  age: number;
  owner: Combatant;
  mesh: THREE.Group;
}

interface Strike {
  owner: Combatant;
  x: number;
  y: number;
  z: number;
  /** 已过时间 */
  t: number;
  /** 三次爆炸的触发时刻（相对施放） */
  times: number[];
  fired: number;
  mesh: THREE.Group;
}

interface Barrier {
  box: Box;
  t: number;
  age: number;
  mesh: THREE.Group;
}

interface Dash {
  c: Combatant;
  vx: number;
  vz: number;
  t: number;
}

interface Aura {
  c: Combatant;
  mesh: THREE.Group;
  age: number;
}

/** 递归释放模型的几何体与材质 */
function disposeObj(obj: THREE.Object3D): void {
  obj.parent?.remove(obj);
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh || (o as THREE.LineSegments).isLineSegments) {
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const mm of mat) mm.dispose();
      else mat.dispose();
    }
  });
}

/** 为一组对象内所有材质设置透明度系数（以 userData.baseOpacity 为基准） */
function setGroupOpacity(g: THREE.Object3D, k: number): void {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(o as THREE.LineSegments).isLineSegments) return;
    const mat = mesh.material as THREE.Material;
    const base = (mat.userData.baseOpacity as number | undefined) ?? 1;
    mat.opacity = base * k;
  });
}

function glowMat(color: number, opacity: number, boost = 1.6): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(boost),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  m.userData.baseOpacity = opacity;
  return m;
}

// ---------------------------------------------------------------- 技能系统

/** 特工技能：投掷物、烟幕、减速力场、轨道轰击、屏障、冲刺等 */
export class AbilitySys {
  smokes: SmokeZone[] = [];
  private projectiles: Projectile[] = [];
  private fields: SlowField[] = [];
  private strikes: Strike[] = [];
  private barriers: Barrier[] = [];
  private dashes: Dash[] = [];
  private auras: Aura[] = [];
  private group = new THREE.Group();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();

  constructor(private m: Match) {
    this.group.name = 'abilities';
    m.group.add(this.group);
  }

  // ------------------------------------------------------------ 施放

  /** 使用技能；次数不足 / 大招未充满 / 阵亡 / 非对战阶段时返回 false */
  use(c: Combatant, slot: 'q' | 'e' | 'x'): boolean {
    const m = this.m;
    if (!c.alive) return false;
    if (m.phase !== 'live' && m.phase !== 'planted') {
      if (c.isPlayer && m.phase === 'buy') m.ui.toast('回合开始后才能使用技能');
      return false;
    }
    const def = c.agent[slot];
    if (slot === 'q' && c.chargeQ <= 0) {
      if (c.isPlayer) m.ui.toast(`「${def.name}」本回合次数已用完`);
      return false;
    }
    if (slot === 'e' && c.chargeE <= 0) {
      if (c.isPlayer) m.ui.toast(`「${def.name}」本回合次数已用完`);
      return false;
    }
    if (slot === 'x' && c.ult < c.agent.ultCost) {
      if (c.isPlayer) m.ui.toast(`大招尚未充满（${c.ult}/${c.agent.ultCost}）`);
      return false;
    }
    if (!this.cast(c, def.id)) return false;

    if (slot === 'q') c.chargeQ--;
    else if (slot === 'e') c.chargeE--;
    else c.ult = 0;

    if (slot === 'x' && (c.isPlayer || c.team === m.player.team)) audio.ult();
    else audio.ability(c.body.x, c.body.z);
    // 合作：把施放告诉其他设备（伤害仍由施放者所在的设备结算）
    if (m.coop && !c.remote) m.coop.sendCast(c, slot);
    return true;
  }

  /** 合作：重现别的设备上的施放（不检查次数 / 大招，只产生效果；伤害由施放者那边结算） */
  castNet(c: Combatant, slot: 'q' | 'e' | 'x'): void {
    if (!this.cast(c, c.agent[slot].id)) return;
    if (slot === 'x' && c.team === this.m.player.team) audio.ult();
    else audio.ability(c.body.x, c.body.z);
  }

  private cast(c: Combatant, id: AbilityId): boolean {
    switch (id) {
      case 'dash':
        this.castDash(c);
        return true;
      case 'flash':
      case 'smoke':
      case 'slow':
        this.throwProjectile(c, id);
        return true;
      case 'amp':
        this.castAmp(c);
        return true;
      case 'strike':
        this.castStrike(c);
        return true;
      case 'heal':
        this.castHeal(c);
        return true;
      case 'wall':
        return this.castWall(c);
      case 'shield':
        this.castShield(c);
        return true;
    }
  }

  /** 冲刺期间强制的水平速度（玩家 / 机器人控制器每帧读取并覆盖自身速度）；无冲刺时为 null */
  dashVelocity(c: Combatant): { x: number; z: number } | null {
    for (const d of this.dashes) if (d.c === c) return { x: d.vx, z: d.vz };
    return null;
  }

  private castDash(c: Combatant): void {
    let dx = c.body.vx;
    let dz = c.body.vz;
    let len = Math.hypot(dx, dz);
    if (len < 1) {
      dx = -Math.sin(c.yaw);
      dz = -Math.cos(c.yaw);
      len = 1;
    }
    dx /= len;
    dz /= len;
    this.dashes = this.dashes.filter((d) => d.c !== c);
    this.dashes.push({ c, vx: dx * DASH_SPEED, vz: dz * DASH_SPEED, t: DASH_TIME });
    const p = this.v1.set(c.body.x, c.body.y + 0.9, c.body.z);
    this.m.fx.spark(p, new THREE.Vector3(-dx, 0.2, -dz), c.agent.color, 18, 5, 0.4, 2);
    this.m.fx.ring(new THREE.Vector3(c.body.x, c.body.y, c.body.z), 1.6, c.agent.color, 0.35);
  }

  private throwProjectile(c: Combatant, kind: ThrowKind): void {
    let dx = c.dirX(),
      dy = c.dirY() + THROW_UP,
      dz = c.dirZ();
    const len = Math.hypot(dx, dy, dz);
    dx /= len;
    dy /= len;
    dz /= len;
    const color = kind === 'flash' ? 0xfff6c8 : c.agent.color;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(kind === 'flash' ? 0.12 : 0.16, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) }),
    );
    const x = c.body.x + dx * 0.4,
      y = c.eyeY() - 0.1,
      z = c.body.z + dz * 0.4;
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this.projectiles.push({
      kind,
      nade: false,
      bounceAt: -1,
      owner: c,
      x,
      y,
      z,
      vx: dx * THROW_SPEED + c.body.vx * 0.3,
      vy: dy * THROW_SPEED,
      vz: dz * THROW_SPEED + c.body.vz * 0.3,
      age: 0,
      mesh,
    });
  }

  /**
   * 扔出购买的投掷物：方向 (dx,dy,dz) 为视线方向（单位向量），long = 左键远投，否则为右键近抛。
   * 机器人与玩家共用。
   */
  throwNade(c: Combatant, kind: NadeKind, itemId: string, dx: number, dy: number, dz: number, long: boolean, raw = false): void {
    const t = long ? NADE_LONG : NADE_SHORT;
    let vx = dx,
      vy = dy + (raw ? 0 : t.up),
      vz = dz;
    const len = Math.hypot(vx, vy, vz) || 1;
    vx /= len;
    vy /= len;
    vz /= len;
    const mesh = buildWorldItem(itemId);
    const x = c.body.x + dx * 0.45,
      y = c.eyeY() - 0.15,
      z = c.body.z + dz * 0.45;
    // 出生点贴墙时退回到身体内，避免穿墙
    const sx = segmentClear(c.body.x, y, c.body.z, x, y, z, this.m.map.boxes) ? x : c.body.x;
    const sz = sx === x ? z : c.body.z;
    mesh.position.set(sx, y, sz);
    this.group.add(mesh);
    this.projectiles.push({
      kind: kind === 'frag' ? 'frag' : kind,
      nade: true,
      bounceAt: -1,
      owner: c,
      x: sx,
      y,
      z: sz,
      vx: vx * t.speed + c.body.vx * 0.3,
      vy: vy * t.speed,
      vz: vz * t.speed + c.body.vz * 0.3,
      age: 0,
      mesh,
    });
  }

  /** 进行中的投掷物数量（测试用） */
  get inFlight(): number {
    return this.projectiles.length;
  }

  private castAmp(c: Combatant): void {
    c.ampT = AMP_TIME;
    const p = new THREE.Vector3(c.body.x, c.body.y + 1, c.body.z);
    this.m.fx.shockwave(p, 2.2, c.agent.color, 0.45);
    this.m.fx.ring(new THREE.Vector3(c.body.x, c.body.y, c.body.z), 3, c.agent.accent, 0.6);
    // 跟随的光环
    this.auras = this.auras.filter((a) => {
      if (a.c !== c) return true;
      disposeObj(a.mesh);
      return false;
    });
    const g = new THREE.Group();
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 40), glowMat(c.agent.color, 0.85, 2));
    ring1.rotation.x = Math.PI / 2;
    ring1.name = 'r1';
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 8, 36), glowMat(c.agent.accent, 0.7, 1.6));
    ring2.rotation.x = Math.PI / 2;
    ring2.name = 'r2';
    g.add(ring1, ring2);
    this.group.add(g);
    this.auras.push({ c, mesh: g, age: 0 });
  }

  private castStrike(c: Combatant): void {
    const ox = c.body.x,
      oy = c.eyeY(),
      oz = c.body.z;
    const dx = c.dirX(),
      dy = c.dirY(),
      dz = c.dirZ();
    let t = rayBoxes(ox, oy, oz, dx, dy, dz, STRIKE_RANGE, this.m.map.boxes).t;
    if (dy < -1e-3) t = Math.min(t, -oy / dy);
    let x: number, y: number, z: number;
    if (t <= STRIKE_RANGE) {
      x = ox + dx * t;
      y = Math.max(0, oy + dy * t);
      z = oz + dz * t;
      // 打到墙面时贴回墙前，落到墙脚
      if (y > 0.2) {
        x -= dx * 0.4;
        z -= dz * 0.4;
        y = this.groundBelow(x, y, z);
      }
    } else {
      x = ox + dx * STRIKE_RANGE;
      z = oz + dz * STRIKE_RANGE;
      y = this.groundBelow(x, Math.max(oy, oy + dy * STRIKE_RANGE), z);
    }

    const g = new THREE.Group();
    g.position.set(x, y + 0.05, z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(STRIKE_R - 0.25, STRIKE_R, 64), glowMat(0xff5a3c, 0.8, 1.8));
    ring.rotation.x = -Math.PI / 2;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(STRIKE_R, 64), glowMat(0xff5a3c, 0.16, 1.4));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.01;
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), glowMat(c.agent.accent, 0.9, 2));
    inner.rotation.x = -Math.PI / 2;
    inner.name = 'inner';
    // π 字样的光柱
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 30, 12, 1, true), glowMat(c.agent.color, 0.35, 2));
    beam.position.y = 15;
    beam.name = 'beam';
    g.add(ring, disc, inner, beam);
    this.group.add(g);

    const base = STRIKE_DELAY;
    this.strikes.push({
      owner: c,
      x,
      y,
      z,
      t: 0,
      times: [base, base + 0.3, base + 0.6],
      fired: 0,
      mesh: g,
    });
    if (!c.isPlayer && c.team !== this.m.player.team) audio.beep(x, z, true);
  }

  private castHeal(c: Combatant): void {
    c.healLeft += HEAL_AMOUNT;
    this.healFx(c);
    let best: Combatant | null = null;
    let bd = HEAL_RANGE;
    for (const o of this.m.combatants) {
      if (o === c || !o.alive || o.team !== c.team) continue;
      const d = Math.hypot(o.body.x - c.body.x, o.body.y - c.body.y, o.body.z - c.body.z);
      if (d <= bd) {
        bd = d;
        best = o;
      }
    }
    if (best) {
      best.healLeft += HEAL_AMOUNT;
      this.healFx(best);
      if (c.isPlayer) this.m.ui.toast(`等式修复：同时治疗了 ${best.name}`);
    }
  }

  private healFx(c: Combatant): void {
    const fx = this.m.fx;
    fx.ring(new THREE.Vector3(c.body.x, c.body.y, c.body.z), 2.2, 0x4be3a4, 0.7);
    fx.spark(new THREE.Vector3(c.body.x, c.body.y + 0.6, c.body.z), new THREE.Vector3(0, 1, 0), 0x7dffc4, 22, 2.5, 0.9, -1.5);
  }

  private castShield(c: Combatant): void {
    const fx = this.m.fx;
    for (const o of this.m.combatants) {
      if (!o.alive || o.team !== c.team) continue;
      o.armor = Math.min(100, o.armor + SHIELD_AMOUNT);
      fx.ring(new THREE.Vector3(o.body.x, o.body.y, o.body.z), 2.4, c.agent.color, 0.8);
      fx.ring(new THREE.Vector3(o.body.x, o.body.y + 0.9, o.body.z), 1.4, c.agent.accent, 0.6);
      fx.spark(new THREE.Vector3(o.body.x, o.body.y + 1, o.body.z), new THREE.Vector3(0, 1, 0), c.agent.accent, 14, 2, 0.6, 0);
    }
    if (c.team === this.m.player.team && !c.isPlayer && this.m.player.alive) this.m.ui.toast(`${c.name} 施放了对称护盾`);
  }

  private castWall(c: Combatant): boolean {
    const m = this.m;
    const fx0 = -Math.sin(c.yaw),
      fz0 = -Math.cos(c.yaw);
    // 吸附到最接近的轴：沿 X 朝向 → 墙沿 Z 展开
    const alongX = Math.abs(fx0) >= Math.abs(fz0);
    const fx = alongX ? Math.sign(fx0) || 1 : 0;
    const fz = alongX ? 0 : Math.sign(fz0) || 1;
    const baseY = c.body.y;
    // 前方若有障碍，屏障放在障碍之前
    const hit = rayBoxes(c.body.x, baseY + 1, c.body.z, fx, 0, fz, WALL_DIST + WALL_T, m.map.boxes).t;
    let dist = Math.min(WALL_DIST, hit - WALL_T * 0.5 - 0.05);
    const make = (d: number): Box => {
      const cx = c.body.x + fx * d,
        cz = c.body.z + fz * d;
      const hx = alongX ? WALL_T / 2 : WALL_W / 2;
      const hz = alongX ? WALL_W / 2 : WALL_T / 2;
      return { x0: cx - hx, x1: cx + hx, y0: baseY, y1: baseY + WALL_H, z0: cz - hz, z1: cz + hz };
    };
    const blocked = (b: Box): boolean => {
      for (const o of m.combatants) {
        if (!o.alive) continue;
        const r = o.body.radius + 0.1;
        if (o.body.x + r > b.x0 && o.body.x - r < b.x1 && o.body.z + r > b.z0 && o.body.z - r < b.z1) {
          if (o.body.y + o.body.height > b.y0 && o.body.y < b.y1) return true;
        }
      }
      return false;
    };
    let box: Box | null = null;
    if (dist >= 1.0) {
      for (const off of [0, 1, -1, 2, -1.8]) {
        const d = dist + off;
        if (d < 1.0 || d > hit - WALL_T * 0.5 - 0.05) continue;
        const b = make(d);
        if (!blocked(b)) {
          box = b;
          dist = d;
          break;
        }
      }
    }
    if (!box) {
      if (c.isPlayer) m.ui.toast('前方空间不足，无法竖起屏障');
      return false;
    }
    m.map.addDynamicBox(box);

    const g = new THREE.Group();
    const w = box.x1 - box.x0,
      d = box.z1 - box.z0;
    g.position.set((box.x0 + box.x1) / 2, box.y0, (box.z0 + box.z1) / 2);
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(w, WALL_H, d),
      new THREE.MeshStandardMaterial({
        color: c.agent.color,
        emissive: c.agent.color,
        emissiveIntensity: 0.55,
        transparent: true,
        opacity: 0.55,
        roughness: 0.3,
        metalness: 0.1,
        depthWrite: false,
      }),
    );
    (core.material as THREE.Material).userData.baseOpacity = 0.55;
    core.position.y = WALL_H / 2;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, WALL_H, d)),
      new THREE.LineBasicMaterial({ color: new THREE.Color(c.agent.accent).multiplyScalar(1.6), transparent: true, opacity: 1 }),
    );
    edges.position.y = WALL_H / 2;
    // 坐标网格线
    const pts: number[] = [];
    const span = alongX ? d : w;
    const face = (alongX ? w : d) / 2 + 0.01;
    for (let i = 1; i < 6; i++) {
      const u = -span / 2 + (span * i) / 6;
      for (const s of [-face, face]) {
        if (alongX) pts.push(s, 0, u, s, WALL_H, u);
        else pts.push(u, 0, s, u, WALL_H, s);
      }
    }
    for (let j = 1; j < 3; j++) {
      const v = (WALL_H * j) / 3;
      for (const s of [-face, face]) {
        if (alongX) pts.push(s, v, -span / 2, s, v, span / 2);
        else pts.push(-span / 2, v, s, span / 2, v, s);
      }
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const gridMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(c.agent.accent).multiplyScalar(1.3),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    gridMat.userData.baseOpacity = 0.6;
    const grid = new THREE.LineSegments(gridGeo, gridMat);
    g.add(core, edges, grid);
    g.scale.set(1, 0.01, 1);
    this.group.add(g);
    this.barriers.push({ box, t: WALL_TIME, age: 0, mesh: g });
    m.fx.ring(new THREE.Vector3(g.position.x, box.y0, g.position.z), 3.4, c.agent.color, 0.5);
    return true;
  }

  // ------------------------------------------------------------ 生效

  private popFlash(p: Projectile): void {
    const m = this.m;
    const x = p.x,
      y = p.y,
      z = p.z;
    audio.flashPop(x, z);
    const pos = new THREE.Vector3(x, y, z);
    m.fx.shockwave(pos, 1.6, 0xfff6c8, 0.25);
    // 强光核心
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xffffff).multiplyScalar(4),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    core.position.copy(pos);
    m.fx.add(core, 0.35, (k) => {
      core.scale.setScalar(0.3 + 0.9 * Math.sin(Math.min(1, k * 2) * Math.PI * 0.5));
      (core.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    });

    for (const c of m.combatants) {
      if (!c.alive) continue;
      // 技能闪光不影响队友；购买的闪光弹影响所有人（队友时间减半）
      const mate = c.team === p.owner.team && c !== p.owner;
      if (mate && !p.nade) continue;
      const ex = c.body.x,
        ey = c.eyeY(),
        ez = c.body.z;
      const dx = x - ex,
        dy = y - ey,
        dz = z - ez;
      const d = Math.hypot(dx, dy, dz);
      if (d > FLASH_RANGE) continue;
      let dot = 1;
      if (d > 0.3) dot = (dx * c.dirX() + dy * c.dirY() + dz * c.dirZ()) / d;
      if (dot <= 0.2) continue;
      if (!segmentClear(ex, ey, ez, x, y, z, m.map.boxes)) continue;
      let smoked = false;
      for (const s of this.smokes) {
        if (segmentHitsSphere(ex, ey, ez, x, y, z, s.x, s.y, s.z, s.r)) {
          smoked = true;
          break;
        }
      }
      if (smoked) continue;
      const angK = Math.min(1, (dot - 0.2) / 0.6);
      const distK = 1 - (d / FLASH_RANGE) * 0.5;
      const k = Math.max(0.35, angK) * distK * (mate ? NADE_FLASH_TEAM : 1);
      c.flashT = Math.max(c.flashT, FLASH_TIME * k);
      c.brain?.onFlashed();
      if (c.isPlayer) m.ui.flash(Math.min(1, k + 0.15));
    }
  }

  private spawnSmoke(p: Projectile): void {
    const owner = p.owner;
    const y = p.y + SMOKE_LIFT;
    const g = new THREE.Group();
    g.position.set(p.x, y, p.z);
    const base = p.nade ? SMOKE_GREY : owner.agent.color;
    const col = new THREE.Color(base).lerp(new THREE.Color(0xdde0e8), 0.45);
    if (p.nade) audio.smokeHiss(p.x, p.z);
    const outerMat = new THREE.MeshLambertMaterial({
      color: col,
      emissive: new THREE.Color(base).multiplyScalar(p.nade ? 0.08 : 0.25),
      transparent: true,
      opacity: 0.93,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    outerMat.userData.baseOpacity = 0.93;
    const outer = new THREE.Mesh(new THREE.IcosahedronGeometry(SMOKE_R, 3), outerMat);
    outer.name = 'outer';
    g.add(outer);
    // 几团小球让轮廓更蓬松
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.random();
      const mat = new THREE.MeshLambertMaterial({
        color: col.clone().multiplyScalar(0.9 + Math.random() * 0.2),
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      mat.userData.baseOpacity = 0.85;
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(SMOKE_R * (0.45 + Math.random() * 0.15), 2), mat);
      puff.position.set(Math.cos(a) * SMOKE_R * 0.62, (Math.random() - 0.4) * SMOKE_R * 0.6, Math.sin(a) * SMOKE_R * 0.62);
      puff.userData.phase = Math.random() * Math.PI * 2;
      g.add(puff);
    }
    // 里面再放一层，从烟内部看时颜色更厚重
    const innerMat = new THREE.MeshBasicMaterial({
      color: col.clone().multiplyScalar(0.85),
      transparent: true,
      opacity: 0.6,
      side: THREE.BackSide,
      depthWrite: false,
    });
    innerMat.userData.baseOpacity = 0.6;
    const inner = new THREE.Mesh(new THREE.SphereGeometry(SMOKE_R * 0.8, 20, 14), innerMat);
    g.add(inner);
    g.scale.setScalar(0.05);
    this.group.add(g);
    this.smokes.push({ x: p.x, y, z: p.z, r: SMOKE_R, t: SMOKE_TIME, age: 0, owner, mesh: g });
    this.m.fx.ring(new THREE.Vector3(p.x, p.y, p.z), SMOKE_R + 0.5, base, 0.6);
  }

  private spawnSlow(p: Projectile): void {
    const owner = p.owner;
    const g = new THREE.Group();
    g.position.set(p.x, p.y + 0.05, p.z);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(SLOW_R, 64), glowMat(owner.agent.color, 0.18, 1.3));
    disc.rotation.x = -Math.PI / 2;
    const edge = new THREE.Mesh(new THREE.RingGeometry(SLOW_R - 0.18, SLOW_R, 64), glowMat(owner.agent.color, 0.9, 2));
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.01;
    // 方阵网格（裁剪在圆内）
    const pts: number[] = [];
    const step = 1;
    for (let u = -SLOW_R + step; u < SLOW_R - 1e-3; u += step) {
      const h = Math.sqrt(SLOW_R * SLOW_R - u * u);
      pts.push(u, 0.02, -h, u, 0.02, h);
      pts.push(-h, 0.02, u, h, 0.02, u);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const gridMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(owner.agent.accent).multiplyScalar(1.5),
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    gridMat.userData.baseOpacity = 0.7;
    const grid = new THREE.LineSegments(gridGeo, gridMat);
    grid.name = 'grid';
    // 竖起的薄光幕
    const curtain = new THREE.Mesh(new THREE.CylinderGeometry(SLOW_R, SLOW_R, 0.8, 64, 1, true), glowMat(owner.agent.color, 0.18, 1.5));
    curtain.position.y = 0.4;
    curtain.name = 'curtain';
    g.add(disc, edge, grid, curtain);
    g.scale.set(0.05, 1, 0.05);
    this.group.add(g);
    this.fields.push({ x: p.x, y: p.y, z: p.z, r: SLOW_R, t: SLOW_TIME, age: 0, owner, mesh: g });
    this.m.fx.ring(new THREE.Vector3(p.x, p.y, p.z), SLOW_R, owner.agent.color, 0.5);
    audio.ability(p.x, p.z);
  }

  private explodeStrike(s: Strike): void {
    const m = this.m;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * STRIKE_SPREAD;
    const x = s.x + Math.cos(a) * r,
      z = s.z + Math.sin(a) * r,
      y = s.y;
    const p = new THREE.Vector3(x, y + 0.4, z);
    m.fx.shockwave(p, STRIKE_R * 0.75, 0xff7a3c, 0.6);
    m.fx.ring(new THREE.Vector3(x, y, z), STRIKE_R, s.owner.agent.color, 0.7);
    audio.explosion(x, z, s.fired === 2);
    for (const v of m.combatants) {
      if (!v.alive || v.team === s.owner.team) continue;
      const d = Math.hypot(v.body.x - x, v.body.y + 0.9 - (y + 0.4), v.body.z - z);
      if (d > STRIKE_R) continue;
      const k = 1 - d / STRIKE_R;
      const dmg = STRIKE_DMG * (0.15 + 0.85 * k * k);
      m.damage(v, dmg, s.owner, false, 'π 轨道轰击');
    }
  }

  /** 破片手雷爆炸：伤害敌人与投掷者本人（不伤队友），墙体遮挡 */
  private explodeFrag(p: Projectile): void {
    const m = this.m;
    const x = p.x,
      y = p.y + 0.15,
      z = p.z;
    const pos = this.v1.set(x, y + 0.2, z);
    m.fx.shockwave(pos, FRAG_R * 0.7, 0xffa040, 0.5);
    m.fx.ring(this.v1.set(x, Math.max(0, y - 0.1), z), FRAG_R, 0xff7a3c, 0.6);
    m.fx.spark(this.v1.set(x, y + 0.2, z), this.v2.set(0, 1, 0), 0xffc070, 26, 7, 0.5, -6);
    audio.grenade(x, z);
    for (const v of m.combatants) {
      if (!v.alive) continue;
      if (v.team === p.owner.team && v !== p.owner) continue;
      const cy = v.body.y + 0.9;
      const d = Math.hypot(v.body.x - x, cy - y, v.body.z - z);
      if (d >= FRAG_R) continue;
      if (!segmentClear(x, y + 0.1, z, v.body.x, cy, v.body.z, m.map.boxes) && !segmentClear(x, y + 0.1, z, v.body.x, v.eyeY(), v.body.z, m.map.boxes))
        continue;
      m.damage(v, FRAG_DMG * (1 - d / FRAG_R), p.owner, false, '霹雳');
    }
  }

  // ------------------------------------------------------------ 更新

  update(g: number): void {
    if (g <= 0) return;
    const m = this.m;
    const boxes = m.map.boxes;

    // 冲刺
    for (let i = this.dashes.length - 1; i >= 0; i--) {
      const d = this.dashes[i];
      d.t -= g;
      if (d.t <= 0 || !d.c.alive) this.dashes.splice(i, 1);
    }

    // 投掷物
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.nade) {
        if (this.updateNade(p, g, boxes)) {
          this.dropProj(p);
          this.projectiles.splice(i, 1);
        }
        continue;
      }
      p.age += g;
      p.vy -= GRAVITY * g;
      let landed = false;
      let popped = false;
      const sx = p.vx * g,
        sy = p.vy * g,
        sz = p.vz * g;
      const len = Math.hypot(sx, sy, sz);
      if (len > 1e-6) {
        const hit = rayBoxes(p.x, p.y, p.z, sx / len, sy / len, sz / len, len, boxes);
        if (hit.t <= len) {
          const t = Math.max(0, hit.t - 0.05);
          p.x += (sx / len) * t;
          p.y += (sy / len) * t;
          p.z += (sz / len) * t;
          if (p.kind === 'flash') popped = true;
          else if (hit.ny > 0.5) {
            landed = true;
          } else {
            // 撞墙反弹并减速
            if (hit.nx !== 0) p.vx = -p.vx * 0.35;
            if (hit.nz !== 0) p.vz = -p.vz * 0.35;
            if (hit.ny < 0) p.vy = -Math.abs(p.vy) * 0.2;
            p.vx *= 0.6;
            p.vz *= 0.6;
          }
        } else {
          p.x += sx;
          p.y += sy;
          p.z += sz;
        }
      }
      if (p.y <= 0.1) {
        p.y = 0.1;
        if (p.kind === 'flash') popped = true;
        else landed = true;
      }
      if (p.kind === 'flash' && p.age >= FLASH_FUSE) popped = true;
      if (p.kind !== 'flash' && p.age >= MAX_FLIGHT) landed = true;
      p.mesh.position.set(p.x, p.y, p.z);

      if (popped || landed) {
        if (p.kind === 'flash') this.popFlash(p);
        else {
          // 落点贴地
          if (!landed || p.y > 0.15) p.y = this.groundBelow(p.x, p.y + 0.05, p.z);
          else p.y = Math.max(0, p.y - 0.1);
          if (p.kind === 'smoke') this.spawnSmoke(p);
          else this.spawnSlow(p);
        }
        this.dropProj(p);
        this.projectiles.splice(i, 1);
      } else if (Math.random() < 0.5) {
        m.fx.spark(p.mesh.position, new THREE.Vector3(0, 0, 0), p.kind === 'flash' ? 0xfff6c8 : p.owner.agent.color, 1, 0.4, 0.3, 0);
      }
    }

    // 烟幕
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t -= g;
      s.age += g;
      if (s.t <= 0) {
        disposeObj(s.mesh);
        this.smokes.splice(i, 1);
        continue;
      }
      const grow = Math.min(1, s.age / 0.6);
      const e = 1 - (1 - grow) ** 3;
      const fade = Math.min(1, s.t / SMOKE_FADE);
      const wob = 1 + Math.sin(s.age * 1.7) * 0.025;
      s.mesh.scale.set(e * wob, e * (2 - wob) * (0.85 + 0.15 * fade), e * wob);
      // 消散时视线遮挡半径同步缩小
      s.r = SMOKE_R * e * (0.6 + 0.4 * fade);
      setGroupOpacity(s.mesh, fade);
      s.mesh.rotation.y += g * 0.06;
      for (const ch of s.mesh.children) {
        const ph = ch.userData.phase as number | undefined;
        if (ph !== undefined) ch.scale.setScalar(1 + Math.sin(s.age * 1.3 + ph) * 0.06);
      }
    }

    // 减速力场
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i];
      f.t -= g;
      f.age += g;
      if (f.t <= 0) {
        disposeObj(f.mesh);
        this.fields.splice(i, 1);
        continue;
      }
      for (const c of m.combatants) {
        if (!c.alive || c.team === f.owner.team) continue;
        if (Math.abs(c.body.y - f.y) > 2.5) continue;
        if ((c.body.x - f.x) ** 2 + (c.body.z - f.z) ** 2 <= f.r * f.r) c.slowT = Math.max(c.slowT, 0.25);
      }
      const grow = Math.min(1, f.age / 0.35);
      const e = 1 - (1 - grow) ** 2;
      f.mesh.scale.set(e, 1, e);
      const fade = Math.min(1, f.t / 0.6);
      setGroupOpacity(f.mesh, fade * (0.8 + 0.2 * Math.sin(f.age * 6)));
      const grid = f.mesh.getObjectByName('grid');
      if (grid) grid.rotation.y = f.age * 0.15;
    }

    // 轨道轰击
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.t += g;
      while (s.fired < s.times.length && s.t >= s.times[s.fired]) {
        this.explodeStrike(s);
        s.fired++;
      }
      const pre = Math.min(1, s.t / STRIKE_DELAY);
      const inner = s.mesh.getObjectByName('inner');
      if (inner) inner.scale.setScalar(0.2 + (STRIKE_R - 0.2) * pre);
      const beam = s.mesh.getObjectByName('beam');
      if (beam) beam.scale.set(0.3 + pre * 1.5, 1, 0.3 + pre * 1.5);
      const end = s.times[s.times.length - 1];
      const blink = s.t < STRIKE_DELAY ? 0.6 + 0.4 * Math.abs(Math.sin(s.t * (6 + pre * 14))) : Math.max(0, 1 - (s.t - STRIKE_DELAY) / (end - STRIKE_DELAY + 0.3));
      setGroupOpacity(s.mesh, blink);
      if (s.fired >= s.times.length && s.t >= end + 0.3) {
        disposeObj(s.mesh);
        this.strikes.splice(i, 1);
      }
    }

    // 屏障
    for (let i = this.barriers.length - 1; i >= 0; i--) {
      const b = this.barriers[i];
      b.t -= g;
      b.age += g;
      if (b.t <= 0) {
        m.map.removeDynamicBox(b.box);
        disposeObj(b.mesh);
        this.barriers.splice(i, 1);
        continue;
      }
      const grow = Math.min(1, b.age / 0.35);
      b.mesh.scale.y = Math.max(0.01, 1 - (1 - grow) ** 3);
      const fade = Math.min(1, b.t / 0.8);
      setGroupOpacity(b.mesh, fade * (0.9 + 0.1 * Math.sin(b.age * 3)));
    }

    // 光环
    for (let i = this.auras.length - 1; i >= 0; i--) {
      const a = this.auras[i];
      a.age += g;
      if (!a.c.alive || a.c.ampT <= 0) {
        disposeObj(a.mesh);
        this.auras.splice(i, 1);
        continue;
      }
      a.mesh.position.set(a.c.body.x, a.c.body.y, a.c.body.z);
      a.mesh.visible = !a.c.isPlayer; // 第一人称下不挡视线
      const r1 = a.mesh.getObjectByName('r1');
      const r2 = a.mesh.getObjectByName('r2');
      if (r1) r1.position.y = 0.2 + ((a.age * 1.2) % 1) * 1.6;
      if (r2) r2.position.y = 0.2 + ((a.age * 1.2 + 0.5) % 1) * 1.6;
      setGroupOpacity(a.mesh, Math.min(1, a.c.ampT / 0.5));
    }
  }

  /** 移除投掷物模型：购买的投掷物与 GLB 模板共享几何 / 材质，只摘下不释放 */
  private dropProj(p: Projectile): void {
    if (p.nade) p.mesh.parent?.remove(p.mesh);
    else disposeObj(p.mesh);
  }

  /** 购买投掷物的飞行、弹跳与引信；返回 true 表示已生效并应移除 */
  private updateNade(p: Projectile, g: number, boxes: readonly Box[]): boolean {
    p.age += g;
    p.vy -= GRAVITY * g;
    const sx = p.vx * g,
      sy = p.vy * g,
      sz = p.vz * g;
    const len = Math.hypot(sx, sy, sz);
    let bounced = false;
    if (len > 1e-6) {
      const hit = rayBoxes(p.x, p.y, p.z, sx / len, sy / len, sz / len, len, boxes);
      if (hit.t <= len) {
        const t = Math.max(0, hit.t - 0.04);
        p.x += (sx / len) * t;
        p.y += (sy / len) * t;
        p.z += (sz / len) * t;
        if (hit.nx !== 0) p.vx = -p.vx * BOUNCE_N;
        if (hit.nz !== 0) p.vz = -p.vz * BOUNCE_N;
        if (hit.ny !== 0) p.vy = -p.vy * BOUNCE_N;
        if (hit.ny > 0.5) {
          p.vx *= BOUNCE_T;
          p.vz *= BOUNCE_T;
        }
        bounced = true;
      } else {
        p.x += sx;
        p.y += sy;
        p.z += sz;
      }
    }
    if (p.y <= 0.08) {
      p.y = 0.08;
      if (p.vy < 0) {
        p.vy = -p.vy * BOUNCE_N;
        p.vx *= BOUNCE_T;
        p.vz *= BOUNCE_T;
        if (Math.abs(p.vy) > 0.6) bounced = true;
        else p.vy = 0;
      }
    }
    if (bounced) {
      if (p.bounceAt < 0) p.bounceAt = p.age;
      if (Math.hypot(p.vx, p.vy, p.vz) > 1.2) audio.bounce(p.x, p.z);
    }
    p.mesh.position.set(p.x, p.y, p.z);
    p.mesh.rotation.x += g * Math.hypot(p.vx, p.vz) * 3;
    p.mesh.rotation.z += g * 4;
    const slow = Math.hypot(p.vx, p.vy, p.vz) < 0.5 && p.y < 0.2;
    if (p.kind === 'frag') {
      if (p.age >= FRAG_MAX || (p.bounceAt >= 0 && p.age - p.bounceAt >= FRAG_AFTER_BOUNCE)) {
        this.explodeFrag(p);
        return true;
      }
    } else if (p.kind === 'flash') {
      if (p.age >= NADE_FLASH_FUSE) {
        this.popFlash(p);
        return true;
      }
    } else if (p.kind === 'smoke') {
      if ((slow && p.bounceAt >= 0) || p.age >= MAX_FLIGHT) {
        p.y = this.groundBelow(p.x, p.y + 0.05, p.z);
        this.spawnSmoke(p);
        return true;
      }
    }
    return false;
  }

  /** 从 (x,y,z) 向下找地面高度 */
  private groundBelow(x: number, y: number, z: number): number {
    const t = rayBoxes(x, y, z, 0, -1, 0, y + 1, this.m.map.boxes).t;
    return t <= y ? Math.max(0, y - t) : 0;
  }

  /** 清除所有投掷物、烟幕、力场、屏障及其模型 */
  clear(): void {
    for (const p of this.projectiles) this.dropProj(p);
    for (const s of this.smokes) disposeObj(s.mesh);
    for (const f of this.fields) disposeObj(f.mesh);
    for (const s of this.strikes) disposeObj(s.mesh);
    for (const b of this.barriers) {
      this.m.map.removeDynamicBox(b.box);
      disposeObj(b.mesh);
    }
    for (const a of this.auras) disposeObj(a.mesh);
    this.projectiles = [];
    this.smokes = [];
    this.fields = [];
    this.strikes = [];
    this.barriers = [];
    this.dashes = [];
    this.auras = [];
  }
}
