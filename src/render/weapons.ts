/**
 * 武器：第三人称枪模型（buildWorldGun）与第一人称视图模型（ViewModel）。
 *
 * 所有枪都是 public/assets/weapons/<id>.glb 中的真实建模 + PBR 贴图资源，统一约定：
 *   - 原点在右手握把点（grip_r），枪管朝 -Z，+Y 向上，单位米（真实尺寸）；
 *   - 可动部件为独立节点：magazine / slide / bolt / pump / trigger / hammer / shell；
 *   - 定位空节点：muzzle（枪口）、grip_l（左手托枪点）、sight（瞄准时眼睛对准的点）、eject（抛壳口）、magwell（弹匣口）。
 * 第一人称手臂来自 arms.glb：hand（戴手套的右手，握住沿 +Y 的圆柱，原点为圆柱中心）、
 * forearm（袖子，原点在手腕，沿 +Z 延伸）、band（腕带，用特工主题色着色）、wrist（手腕点）。
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { WEAPONS, type WeaponDef, type WeaponKind } from '../data/defs.ts';
import { INSPECT_TIME } from '../data/handling.ts';
import { registerPreload, loadGLB, getGLB, hasCached } from './assets.ts';

/* ============================================================================
 * 资源登记：每个武器 / 手持物一个 GLB（public/assets/weapons/<id>.glb），缺失时用程序化占位模型
 * ========================================================================== */

const fileOf = (id: string) => `weapons/${id}.glb`;
const ARMS_FILE = 'weapons/arms.glb';
/** 只登记有模型的手持物（熵核手持时用程序化模型） */
const MODEL_IDS = Object.keys(WEAPONS).filter((id) => id !== 'spike');
/** 第三人称：按握持类别的默认枪（旧接口 buildWorldGun(kind) 用） */
const DEFAULT_BY_KIND: Record<WeaponKind, string> = {
  pistol: 'qiming',
  smg: 'yuyan',
  shotgun: 'jingzhe',
  rifle: 'changgeng',
  sniper: 'tianshu',
};

// 缺失的文件不阻塞整体预载（回退到程序化占位模型）
for (const id of MODEL_IDS) registerPreload(() => loadGLB(fileOf(id)).catch(() => null));
registerPreload(() => loadGLB(ARMS_FILE).catch(() => null));

function glb(path: string): GLTF | null {
  return hasCached(`glb:${path}`) ? getGLB(path) : null;
}

/** 该 id 的 GLB 是否已加载（测试 / 报告用） */
export function hasModel(id: string): boolean {
  return !!glb(fileOf(id));
}

/** GLB 中的根节点（名为 <id> 的空节点；没有时用整个场景） */
function itemTemplate(id: string): THREE.Object3D | null {
  const g = glb(fileOf(id));
  if (!g) return null;
  return g.scene.children.length === 1 ? g.scene.children[0] : g.scene;
}

function prepTemplate(root: THREE.Object3D): void {
  if (root.userData.prepped) return;
  root.userData.prepped = true;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const s = mat as THREE.MeshStandardMaterial;
      if (s.transparent) {
        s.depthWrite = false;
        s.side = THREE.DoubleSide;
      } else s.side = THREE.FrontSide;
      if (s.map) s.map.anisotropy = 8;
      if (s.isMeshStandardMaterial) s.envMapIntensity = 1.0;
    }
  });
}

/* ============================================================================
 * 第三人称 / 地面上的物品
 * ========================================================================== */

/**
 * 角色模型（character.ts）只按握持类别调用 buildWorldGun(kind)。换成同类别的其它武器时，
 * 调用方先 setNextWorldGun(id)，这里就会构建那把武器的模型。
 */
let nextWorldGun: string | null = null;
export function setNextWorldGun(id: string | null): void {
  nextWorldGun = id;
}

/** 第三人称枪：原点在右手握把，枪管朝 -Z；含名为 muzzle、grip_l 的子节点。几何体与材质在所有实例间共享。 */
export function buildWorldGun(kind: WeaponKind): THREE.Object3D {
  return buildWorldItem(nextWorldGun ?? DEFAULT_BY_KIND[kind]);
}

/** 任意手持物 / 地上掉落物的模型（GLB 克隆，几何与材质共享；不要 dispose） */
export function buildWorldItem(id: string): THREE.Object3D {
  const tpl = itemTemplate(id);
  let g: THREE.Object3D;
  if (tpl) {
    prepTemplate(tpl);
    g = tpl.clone(true);
  } else g = placeholder(id);
  g.name = `gun_${id}`;
  g.position.set(0, 0, 0);
  g.rotation.set(0, 0, 0);
  g.scale.set(1, 1, 1);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const mat = m.material as THREE.Material;
      m.castShadow = !mat.transparent;
      m.receiveShadow = false;
    }
  });
  return g;
}

/* ---- 程序化占位模型（GLB 尚未导出时使用；共享几何与材质） ---- */

const phGeo = new Map<string, THREE.BufferGeometry>();
const phMat = new Map<number, THREE.MeshStandardMaterial>();
function pg(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = phGeo.get(key);
  if (!g) {
    g = make();
    phGeo.set(key, g);
  }
  return g;
}
function pm(color: number, metal = 0.6, rough = 0.5): THREE.MeshStandardMaterial {
  let m = phMat.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    phMat.set(color, m);
  }
  return m;
}
function node(name: string, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  return o;
}
function mesh(name: string, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.position.set(x, y, z);
  return m;
}

function placeholder(id: string): THREE.Object3D {
  const def = WEAPONS[id];
  const root = new THREE.Group();
  const cls = def?.cls ?? 'sidearm';
  if (cls === 'melee') {
    // 匕首：握柄 + 护手 + 刀身；定位点 grip_r / tip / edge_mid
    root.add(mesh('body', pg('kh', () => new THREE.CylinderGeometry(0.014, 0.016, 0.11, 10).rotateX(Math.PI / 2)), pm(0x2a2d33, 0.2, 0.7), 0, 0, 0.02));
    root.add(mesh('guard', pg('kg', () => new THREE.BoxGeometry(0.06, 0.012, 0.012)), pm(0x8a8f99), 0, 0, -0.04));
    const blade = new THREE.Shape();
    blade.moveTo(0, 0);
    blade.lineTo(0.016, 0);
    blade.lineTo(0.004, 0.17);
    blade.lineTo(-0.012, 0.02);
    blade.closePath();
    const bg = pg('kb', () => new THREE.ExtrudeGeometry(blade, { depth: 0.004, bevelEnabled: false }).rotateX(-Math.PI / 2).rotateZ(Math.PI / 2).translate(0.002, -0.004, -0.045));
    root.add(mesh('blade', bg, pm(0xd8dde6, 0.9, 0.25), 0, 0, 0));
    root.add(node('grip_r', 0, 0, 0), node('tip', 0, 0.003, -0.215), node('edge_mid', 0, -0.012, -0.13));
    return root;
  }
  if (cls === 'throwable') {
    const col = id === 'pili' ? 0x3d5a3a : id === 'yanwu' ? 0x7c838f : 0xe8e3d2;
    const body =
      id === 'pili'
        ? pg('np', () => new THREE.SphereGeometry(0.034, 16, 12))
        : pg('nc', () => new THREE.CylinderGeometry(0.028, 0.028, 0.1, 16));
    root.add(mesh('body', body, pm(col, 0.3, 0.6), 0, 0.045, 0));
    root.add(mesh('cap', pg('ncap', () => new THREE.CylinderGeometry(0.016, 0.02, 0.022, 12)), pm(0x55585f), 0, id === 'pili' ? 0.085 : 0.106, 0));
    root.add(mesh('lever', pg('nl', () => new THREE.BoxGeometry(0.012, 0.075, 0.006)), pm(0x9aa0a8), 0.018, 0.06, 0.02));
    root.add(mesh('pin', pg('npin', () => new THREE.TorusGeometry(0.012, 0.0025, 6, 16)), pm(0xd0b060, 0.9, 0.3), -0.02, id === 'pili' ? 0.09 : 0.11, 0));
    root.add(node('grip_r', 0, 0, 0));
    return root;
  }
  if (cls === 'spike') {
    // 手持熵核：小型六角装置（握在底部，顶上是发光的能量核）
    root.add(mesh('body', pg('sb', () => new THREE.CylinderGeometry(0.036, 0.042, 0.075, 6)), pm(0x2f3542, 0.3, 0.5), 0, 0.02, -0.01));
    root.add(mesh('band', pg('sband', () => new THREE.CylinderGeometry(0.043, 0.043, 0.012, 6)), pm(0xd6dde6, 0.1, 0.4), 0, 0.045, -0.01));
    const glow = new THREE.MeshStandardMaterial({ color: 0x401410, emissive: 0xff5a3c, emissiveIntensity: 1.8 });
    root.add(mesh('core', pg('sc', () => new THREE.OctahedronGeometry(0.018)), glow, 0, 0.075, -0.01));
    root.add(node('grip_r', 0, 0, 0));
    return root;
  }
  // 枪：简易枪身，仍提供 muzzle / grip_l / sight / magazine
  const kind = def?.kind ?? 'pistol';
  const len = kind === 'pistol' ? 0.2 : kind === 'smg' ? 0.5 : cls === 'lmg' ? 1.0 : 0.85;
  root.add(mesh('body', pg(`gb${len}`, () => new THREE.BoxGeometry(0.035, 0.06, len)), pm(0x23262b), 0, 0.06, -len * 0.35));
  root.add(mesh('magazine', pg('gm', () => new THREE.BoxGeometry(0.026, 0.1, 0.035)), pm(0x30343a), 0, 0.0, -0.06));
  root.add(node('muzzle', 0, 0.06, -len * 0.85), node('grip_l', 0, 0.03, kind === 'pistol' ? -0.01 : -len * 0.4));
  root.add(node('sight', 0, 0.1, -0.02), node('magwell', 0, 0.03, -0.06), node('eject', 0.02, 0.07, -0.05));
  return root;
}

/* ============================================================================
 * 第一人称
 * ========================================================================== */

const D = THREE.MathUtils.degToRad;
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** 0→1→0 的钟形 */
const bell = (a: number, b: number, x: number): number => {
  if (x <= a || x >= b) return 0;
  return Math.sin(((x - a) / (b - a)) * Math.PI);
};

type ReloadStyle = 'mag' | 'shells' | 'bolt' | 'cylinder' | 'box' | 'none';
/** gun = 双手持枪；knife / nade / spike = 单手持物 */
type HoldStyle = 'gun' | 'knife' | 'nade' | 'spike';
type LeftGrip = 'tube' | 'support';

interface VMConf {
  /** 腰射时右手握把点在相机空间的位置 */
  hip: THREE.Vector3;
  /** 腰射时整枪的偏航 / 俯仰 / 滚转（弧度） */
  hipYaw: number;
  hipPitch: number;
  hipRoll: number;
  /** 机瞄时 sight 点距眼睛的距离 */
  adsDist: number;
  /** 握把前倾角（右手绕 X 轴旋转） */
  rake: number;
  /** 右手相对 grip_r 的微调 */
  rOff: THREE.Vector3;
  /** 左手握法与微调 */
  lGrip: LeftGrip;
  lOff: THREE.Vector3;
  lRot: THREE.Euler;
  /** 肘部目标（相机空间） */
  elbowR: THREE.Vector3;
  elbowL: THREE.Vector3;
  reload: ReloadStyle;
  /** 后坐力强度 */
  kick: number;
  flash: number;
  casing: 'brass' | 'hull' | 'none';
  /** 手套缩放（短枪略小，避免遮挡枪身） */
  handScale: number;
  /** 机瞄时右手沿握把下移量（避免托腕握持的手挡住视线） */
  adsDrop?: number;
  style?: HoldStyle;
  /** 右手绕自身 Y 轴（握持轴）的旋转，单手持物用 */
  rTwist?: number;
  /** 抛壳方向（轻机枪向下） */
  ejectDown?: boolean;
  /** 瞄具里已经建模了分划（透过真实瞄准镜瞄准），不再加红点精灵 */
  modelReticle?: boolean;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const KIND_CONF: Record<WeaponKind, VMConf> = {
  pistol: {
    hip: v3(0.19, -0.135, -0.52), hipYaw: D(10), hipPitch: D(-3), hipRoll: D(-3), adsDist: 0.52, rake: D(16),
    rOff: v3(0, -0.004, 0.004), lGrip: 'support', lOff: v3(-0.01, -0.024, -0.01), lRot: new THREE.Euler(0, D(-34), D(-11)),
    elbowR: v3(0.26, -0.5, 0.05), elbowL: v3(-0.16, -0.5, 0.02), reload: 'mag', kick: 1.0, flash: 0.8, casing: 'brass', handScale: 0.76,
  },
  smg: {
    hip: v3(0.14, -0.175, -0.36), hipYaw: D(3), hipPitch: D(0), hipRoll: D(-4), adsDist: 0.235, rake: D(16),
    rOff: v3(0, 0, 0), lGrip: 'tube', lOff: v3(0, -0.012, 0), lRot: new THREE.Euler(0, 0, D(-25)),
    elbowR: v3(0.3, -0.5, 0.12), elbowL: v3(-0.2, -0.5, -0.1), reload: 'mag', kick: 0.6, flash: 0.75, casing: 'brass', handScale: 0.86,
  },
  shotgun: {
    hip: v3(0.14, -0.17, -0.36), hipYaw: D(3), hipPitch: D(0), hipRoll: D(-4), adsDist: 0.18, rake: D(42),
    rOff: v3(0.004, -0.02, 0.012), lGrip: 'tube', lOff: v3(0, -0.012, 0), lRot: new THREE.Euler(0, 0, D(-25)),
    elbowR: v3(0.42, -0.42, 0.1), elbowL: v3(-0.2, -0.5, -0.12), reload: 'shells', kick: 1.5, flash: 1.3, casing: 'hull', handScale: 0.82, adsDrop: 0.035,
  },
  rifle: {
    hip: v3(0.15, -0.19, -0.38), hipYaw: D(2.3), hipPitch: D(1), hipRoll: D(-4), adsDist: 0.36, rake: D(20),
    rOff: v3(0, 0, 0), lGrip: 'tube', lOff: v3(0, -0.012, 0), lRot: new THREE.Euler(0, 0, D(-25)),
    elbowR: v3(0.3, -0.5, 0.12), elbowL: v3(-0.2, -0.5, -0.12), reload: 'mag', kick: 0.75, flash: 1.0, casing: 'brass', handScale: 0.86,
  },
  sniper: {
    hip: v3(0.15, -0.185, -0.4), hipYaw: D(2), hipPitch: D(1), hipRoll: D(-4), adsDist: 0.24, rake: D(38),
    rOff: v3(0, 0, 0), lGrip: 'tube', lOff: v3(0, -0.02, 0), lRot: new THREE.Euler(0, 0, D(-25)),
    elbowR: v3(0.3, -0.5, 0.14), elbowL: v3(-0.2, -0.5, -0.12), reload: 'bolt', kick: 1.6, flash: 1.4, casing: 'brass', handScale: 0.86,
  },
};
/** 新武器 / 手持物的第一人称参数（以同类枪为基础微调） */
const NADE_CONF: Partial<VMConf> = {
  // 握持轴竖直、在 grip_r（弹体中心）处，手放大一些并略外移，让手指包住弹体
  style: 'nade', hip: v3(0.17, -0.14, -0.4), hipYaw: D(-6), hipPitch: D(4), hipRoll: D(-8), rake: 0, rOff: v3(0.008, 0, 0.004),
  reload: 'none', kick: 0, flash: 0, casing: 'none', handScale: 0.97,
};
const ID_CONF: Record<string, Partial<VMConf>> = {
  // 左轮：无套筒、不抛壳；换弹 = 弹巢摆出、倒空、快速装弹器装入、合上
  poxiao: { hip: v3(0.19, -0.14, -0.5), adsDist: 0.5, reload: 'cylinder', kick: 1.5, flash: 1.1, casing: 'none', handScale: 0.78 },
  yeying: {
    hip: v3(0.16, -0.16, -0.42), hipYaw: D(5), adsDist: 0.3, rake: D(14), lGrip: 'support', lOff: v3(-0.012, -0.03, -0.004),
    lRot: new THREE.Euler(0, D(-30), D(-12)), elbowL: v3(-0.16, -0.5, 0.0), kick: 0.55, handScale: 0.82,
  },
  // 2.5 倍镜：眼睛在 sight 视线点后方 8 厘米，透过真实建模的镜片与分划瞄准（不隐藏枪）
  beichen: { hip: v3(0.15, -0.19, -0.37), adsDist: 0.08, kick: 0.95, flash: 1.1, modelReticle: true },
  benlei: { hip: v3(0.16, -0.21, -0.36), adsDist: 0.3, reload: 'box', kick: 0.7, flash: 1.1, elbowL: v3(-0.22, -0.5, -0.16), ejectDown: true },
  // 匕首：手的握持轴（+Y）沿刀柄（刀的 −Z）
  cunmang: {
    style: 'knife', hip: v3(0.17, -0.15, -0.42), hipYaw: D(-14), hipPitch: D(18), hipRoll: D(-18), adsDist: 0.4, rake: D(90), rTwist: D(0),
    rOff: v3(0, 0, 0), reload: 'none', kick: 0, flash: 0, casing: 'none', handScale: 0.84, elbowR: v3(0.3, -0.48, 0.1),
  },
  pili: NADE_CONF,
  yanwu: NADE_CONF,
  shanguang: NADE_CONF,
  spike: { style: 'spike', hip: v3(0.18, -0.2, -0.46), hipYaw: D(-8), hipPitch: D(8), hipRoll: D(-6), rake: 0, rOff: v3(0.006, -0.005, 0), reload: 'none', kick: 0, flash: 0, casing: 'none', handScale: 0.84 },
};

function confFor(def: WeaponDef): VMConf {
  const base = KIND_CONF[def.kind];
  const o = ID_CONF[def.id];
  return o ? { ...base, ...o } : base;
}
/** 调试用：第一人称各武器参数 */
export const VM_CONF = KIND_CONF;

/* ---- 画布贴图：枪口焰 ---- */

let flashTex: THREE.CanvasTexture | null = null;
function getFlashTex(): THREE.CanvasTexture {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  if (x) {
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,250,235,1)');
    g.addColorStop(0.16, 'rgba(255,225,160,0.95)');
    g.addColorStop(0.42, 'rgba(255,150,60,0.35)');
    g.addColorStop(1, 'rgba(255,110,30,0)');
    x.fillStyle = g;
    x.beginPath();
    const n = 5;
    for (let i = 0; i <= n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      const r = i % 2 ? 20 : 64;
      const px = 64 + Math.cos(a) * r,
        py = 64 + Math.sin(a) * r;
      if (i) x.lineTo(px, py);
      else x.moveTo(px, py);
    }
    x.fill();
    const g2 = x.createRadialGradient(64, 64, 0, 64, 64, 26);
    g2.addColorStop(0, 'rgba(255,255,250,1)');
    g2.addColorStop(1, 'rgba(255,210,140,0)');
    x.fillStyle = g2;
    x.fillRect(0, 0, 128, 128);
  }
  flashTex = new THREE.CanvasTexture(c);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  return flashTex;
}

let flameTex: THREE.CanvasTexture | null = null;
function getFlameTex(): THREE.CanvasTexture {
  if (flameTex) return flameTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const x = c.getContext('2d');
  if (x) {
    const g = x.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, 'rgba(255,250,230,1)');
    g.addColorStop(0.3, 'rgba(255,205,130,0.85)');
    g.addColorStop(0.75, 'rgba(255,130,50,0.3)');
    g.addColorStop(1, 'rgba(255,90,30,0)');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(0, 26);
    x.quadraticCurveTo(40, 6, 128, 30);
    x.lineTo(128, 34);
    x.quadraticCurveTo(40, 58, 0, 38);
    x.closePath();
    x.fill();
  }
  flameTex = new THREE.CanvasTexture(c);
  flameTex.colorSpace = THREE.SRGBColorSpace;
  return flameTex;
}

let dotTex: THREE.CanvasTexture | null = null;
function getDotTex(): THREE.CanvasTexture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  if (x) {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.2)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
  }
  dotTex = new THREE.CanvasTexture(c);
  dotTex.colorSpace = THREE.SRGBColorSpace;
  return dotTex;
}

/* ---- 抛壳 ---- */

const CASINGS = 8;
interface Casing {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

let brassGeo: THREE.BufferGeometry | null = null;
let hullGeo: THREE.BufferGeometry | null = null;
const casingMats: { brass: THREE.MeshStandardMaterial | null; hull: THREE.MeshStandardMaterial | null } = { brass: null, hull: null };
function casingGeo(hull: boolean): THREE.BufferGeometry {
  if (hull) {
    if (!hullGeo) {
      hullGeo = new THREE.CylinderGeometry(0.0095, 0.0095, 0.065, 12);
      hullGeo.rotateZ(Math.PI / 2);
    }
    return hullGeo;
  }
  if (!brassGeo) {
    brassGeo = new THREE.CylinderGeometry(0.0048, 0.005, 0.021, 10);
    brassGeo.rotateZ(Math.PI / 2);
  }
  return brassGeo;
}
function casingMat(hull: boolean): THREE.MeshStandardMaterial {
  if (hull) return (casingMats.hull ??= new THREE.MeshStandardMaterial({ color: 0x6a1410, roughness: 0.5, metalness: 0.0 }));
  return (casingMats.brass ??= new THREE.MeshStandardMaterial({ color: 0xc8963c, roughness: 0.28, metalness: 1.0 }));
}

/* ---- 每把枪的第一人称实例 ---- */

interface Part {
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

interface VMGun {
  kind: WeaponKind;
  id: string;
  style: HoldStyle;
  conf: VMConf;
  group: THREE.Group;
  gun: THREE.Object3D;
  glbBased: boolean;
  /** gun 空间中的定位点 */
  gripL: THREE.Vector3;
  sight: THREE.Vector3;
  muzzle: THREE.Vector3;
  eject: THREE.Vector3;
  magwell: THREE.Vector3;
  mag: Part | null;
  slide: Part | null;
  bolt: Part | null;
  pump: Part | null;
  trigger: Part | null;
  hammer: Part | null;
  shell: Part | null;
  cylinder: Part | null;
  /** 左轮弹巢摆出的转轴点（gun 空间） */
  crane: THREE.Vector3;
  cover: Part | null;
  pin: Part | null;
  lever: Part | null;
  /** 投掷物 / 匕首的可见主体（出手后隐藏） */
  body: THREE.Object3D[];
  /** 右手 / 左手在 gun 空间的基础姿态 */
  rPos: THREE.Vector3;
  rQuat: THREE.Quaternion;
  lPos: THREE.Vector3;
  lQuat: THREE.Quaternion;
  /** 左手去拿弹匣时的姿态 */
  lMagQuat: THREE.Quaternion;
  reticle: THREE.Sprite | null;
}

function part(root: THREE.Object3D, name: string): Part | null {
  const o = root.getObjectByName(name);
  if (!o) return null;
  return { obj: o, pos: o.position.clone(), quat: o.quaternion.clone() };
}

function anchor(root: THREE.Object3D, name: string, fallback: THREE.Vector3): THREE.Vector3 {
  const o = root.getObjectByName(name);
  return o ? o.position.clone() : fallback.clone();
}

// 左手基准姿态
// tube：握住沿枪管方向的护木（手的握持轴 +Y → 枪的 -Z；手腕 +Z → 枪的 -Y；镜像后拇指在左侧）
const _basis = new THREE.Matrix4();
const Q_TUBE = new THREE.Quaternion().setFromRotationMatrix(
  _basis.makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0)),
);

// 模块级临时量（update 零分配）
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _Z = new THREE.Vector3(0, 0, 1);
const _Y = new THREE.Vector3(0, 1, 0);
const _X = new THREE.Vector3(1, 0, 0);
const _hipQ = new THREE.Quaternion();
const _hipP = new THREE.Vector3();
const _adsP = new THREE.Vector3();

const HAND_SCALE = 0.88;

/** 手 + 前臂（右手或镜像的左手） */
class Arm {
  hand: THREE.Object3D;
  forearm: THREE.Object3D;
  wrist: THREE.Vector3;
  constructor(arms: GLTF | null, left: boolean, bandMat: THREE.Material) {
    const src = arms ? (arms.scene.children.length === 1 ? arms.scene.children[0] : arms.scene) : null;
    const hand = src?.getObjectByName('hand');
    const fore = src?.getObjectByName('forearm');
    const band = src?.getObjectByName('band');
    const wrist = src?.getObjectByName('wrist');
    this.wrist = wrist ? wrist.position.clone() : new THREE.Vector3(0.016, -0.008, 0.085);
    if (hand && fore) {
      this.hand = hand.clone(true);
      this.hand.position.set(0, 0, 0);
      this.forearm = new THREE.Group();
      const f = fore.clone(true);
      f.position.set(0, 0, 0);
      this.forearm.add(f);
      if (band) {
        const b = band.clone(true) as THREE.Mesh;
        b.position.copy(band.position).sub(fore.position);
        b.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.material = bandMat;
        });
        this.forearm.add(b);
      }
    } else {
      // 资源缺失时的简易手臂
      const mat = new THREE.MeshStandardMaterial({ color: 0x2c2f2a, roughness: 0.8 });
      this.hand = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.05, 4, 10), mat);
      const g = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 12), mat);
      g.rotation.x = Math.PI / 2;
      g.position.z = 0.15;
      this.forearm = new THREE.Group();
      this.forearm.add(g);
    }
    // 手套略收窄，避免近距离（窄视场）下显得臃肿
    this.hand.scale.setScalar(HAND_SCALE);
    this.forearm.scale.setScalar(0.94);
    if (left) {
      this.hand.scale.x = -HAND_SCALE;
      this.forearm.scale.x = -0.94;
    }
    for (const o of [this.hand, this.forearm])
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) m.frustumCulled = false;
      });
  }
}

export class ViewModel {
  root = new THREE.Group();
  kind: WeaponKind = 'pistol';
  /** 当前手持物 id */
  id = '';
  private pose = new THREE.Group();
  private guns = new Map<string, VMGun>();
  /** 切枪动画总时长（= 拔枪时间） */
  private switchDur = 0.35;
  /** 检视、近战挥砍、投掷的进度（-1 = 未进行） */
  private inspectT = -1;
  private swingT = -1;
  private swingHeavy = false;
  private throwT = -1;
  private cylT = 0;
  private cylAng = 0;
  private cur: VMGun | null = null;
  private armR: Arm;
  private armL: Arm;
  private elbowR = new THREE.Vector3();
  private elbowL = new THREE.Vector3();
  private bandMat: THREE.MeshStandardMaterial;
  private flash = new THREE.Group();
  private flashCore: THREE.Mesh;
  private flashLight: THREE.PointLight;
  private casings: Casing[] = [];
  private casingNext = 0;
  private kick = 0;
  private kickRoll = 0;
  private kickYaw = 0;
  private slideT = 0;
  private boltT = -1;
  private pumpT = -1;
  private trigT = 0;
  private swayX = 0;
  private swayY = 0;
  private bob = 0;
  private bobAmt = 0;
  private air = 0;
  private time = 0;
  private flashT = 0;
  private switchT = 0;
  private rlPrev = 0;
  private rlProg = 0;
  private adsS = 0;
  /** 当前武器有倍镜：开镜后隐藏枪身（由 HUD 画瞄准镜） */
  scoped = false;

  constructor(private accent: number) {
    this.root.add(this.pose);
    this.bandMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accent).multiplyScalar(0.3),
      roughness: 0.55,
      metalness: 0.0,
      emissive: new THREE.Color(accent).multiplyScalar(0.03),
    });
    const arms = glb(ARMS_FILE);
    this.armR = new Arm(arms, false, this.bandMat);
    this.armL = new Arm(arms, true, this.bandMat);
    this.root.add(this.armR.forearm, this.armL.forearm);

    // 枪口焰：星芒 + 两片侧向火舌
    const add = (map: THREE.Texture) =>
      new THREE.MeshBasicMaterial({
        map,
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
    const star = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), add(getFlashTex()));
    this.flash.add(star);
    this.flashCore = star;
    const flameGeo = new THREE.PlaneGeometry(0.22, 0.09);
    flameGeo.translate(0.11, 0, 0);
    flameGeo.rotateY(Math.PI / 2);
    const flameMat = add(getFlameTex());
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Mesh(flameGeo, flameMat);
      f.rotation.z = (i * Math.PI) / 2;
      this.flash.add(f);
    }
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffc27a, 0, 3, 1.6);
    this.flash.add(this.flashLight);

    for (let i = 0; i < CASINGS; i++) {
      const m = new THREE.Mesh(casingGeo(false), casingMat(false));
      m.visible = false;
      m.frustumCulled = false;
      this.root.add(m);
      this.casings.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
  }

  private build(def: WeaponDef): VMGun {
    const kind = def.kind;
    const conf = confFor(def);
    const style: HoldStyle = conf.style ?? 'gun';
    const tpl = itemTemplate(def.id);
    let gun: THREE.Object3D;
    if (tpl) {
      prepTemplate(tpl);
      gun = tpl.clone(true);
      gun.position.set(0, 0, 0);
      gun.rotation.set(0, 0, 0);
    } else gun = buildWorldItem(def.id);
    gun.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.frustumCulled = false;
        m.castShadow = false;
      }
    });
    const group = new THREE.Group();
    group.add(gun);
    const muzzle = anchor(gun, 'muzzle', v3(0, 0.05, -0.4));
    const body: THREE.Object3D[] = [];
    for (const c of gun.children) if (c.name !== 'pin' && c.name !== 'lever') body.push(c);
    const vg: VMGun = {
      kind,
      id: def.id,
      style,
      conf,
      group,
      gun,
      glbBased: !!tpl,
      gripL: anchor(gun, 'grip_l', v3(0, 0.0, -0.2)),
      sight: anchor(gun, 'sight', v3(0, 0.1, -0.05)),
      muzzle,
      eject: anchor(gun, 'eject', v3(0.02, 0.07, -0.05)),
      magwell: anchor(gun, 'magwell', v3(0, -0.02, -0.06)),
      mag: part(gun, 'magazine'),
      slide: part(gun, 'slide'),
      bolt: part(gun, 'bolt'),
      pump: part(gun, 'pump'),
      trigger: part(gun, 'trigger'),
      hammer: part(gun, 'hammer'),
      shell: part(gun, 'shell'),
      cylinder: part(gun, 'cylinder'),
      crane: anchor(gun, 'crane_pivot', v3(-0.009, -0.02, 0)),
      cover: part(gun, 'cover'),
      pin: part(gun, 'pin'),
      lever: part(gun, 'lever'),
      body,
      rPos: new THREE.Vector3(),
      rQuat: new THREE.Quaternion(),
      lPos: new THREE.Vector3(),
      lQuat: new THREE.Quaternion(),
      lMagQuat: new THREE.Quaternion(),
      reticle: null,
    };
    if (vg.shell) vg.shell.obj.visible = false;
    // 右手：握把点，绕 X 前倾（单手持物：握持轴可沿刀柄方向）
    vg.rPos.copy(anchor(gun, 'grip_r', _v.set(0, 0, 0))).add(conf.rOff);
    vg.rQuat.setFromAxisAngle(_X, -conf.rake);
    if (conf.rTwist) vg.rQuat.multiply(_q.setFromAxisAngle(_Y, conf.rTwist));
    // 左手
    vg.lPos.copy(vg.gripL).add(conf.lOff);
    if (conf.lGrip === 'tube') vg.lQuat.copy(Q_TUBE).premultiply(_q.setFromEuler(conf.lRot));
    else vg.lQuat.setFromAxisAngle(_X, -conf.rake).multiply(_q.setFromEuler(conf.lRot));
    vg.lMagQuat.setFromAxisAngle(_X, D(-10)).multiply(_q.setFromEuler(_e.set(0, D(-50), D(-15))));
    // 红点：反射式 / 全息瞄具在 sight 处放一个发光点（铁瞄与狙击镜不放）
    if (style === 'gun' && !conf.modelReticle && (kind === 'smg' || kind === 'rifle')) {
      const r = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getDotTex(),
          color: new THREE.Color(1.0, 0.18, 0.12).multiplyScalar(2.2),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: false,
          toneMapped: false,
        }),
      );
      r.scale.setScalar(0.0022);
      r.position.copy(vg.sight);
      r.position.z -= 0.002;
      r.renderOrder = 10;
      gun.add(r);
      vg.reticle = r;
    }
    group.visible = false;
    this.pose.add(group);
    return vg;
  }

  /** 换到某件手持物；equip = 拔枪时间（秒，0 = 立即） */
  setWeapon(def: WeaponDef, equip = 0.35): void {
    this.kind = def.kind;
    this.id = def.id;
    let g = this.guns.get(def.id);
    if (!g) {
      g = this.build(def);
      this.guns.set(def.id, g);
    }
    if (this.cur) this.cur.group.visible = false;
    this.cur = g;
    g.group.visible = true;
    g.gun.add(this.armR.hand, this.armL.hand);
    const hs = g.conf.handScale;
    this.armR.hand.scale.set(hs, hs, hs);
    this.armL.hand.scale.set(-hs, hs, hs);
    g.gun.add(this.flash);
    this.flash.position.copy(g.muzzle);
    this.switchDur = Math.max(0.2, equip);
    this.switchT = this.switchDur;
    this.boltT = -1;
    this.pumpT = -1;
    this.slideT = 0;
    this.inspectT = -1;
    this.swingT = -1;
    this.throwT = -1;
    this.resetParts(g);
    for (const b of g.body) b.visible = true;
  }

  /** 检视动画 */
  inspect(): void {
    if (!this.cur || this.switchT > 0) return;
    this.inspectT = 0;
  }

  cancelInspect(): void {
    this.inspectT = -1;
  }

  /** 匕首：轻击 / 重击挥砍 */
  melee(heavy: boolean): void {
    this.swingT = 0;
    this.swingHeavy = heavy;
    this.inspectT = -1;
  }

  /** 投掷物出手 */
  throwNade(): void {
    this.throwT = 0;
    this.inspectT = -1;
  }

  private resetParts(g: VMGun): void {
    for (const p of [g.mag, g.slide, g.bolt, g.pump, g.trigger, g.hammer, g.cylinder, g.cover, g.pin, g.lever]) {
      if (!p) continue;
      p.obj.position.copy(p.pos);
      p.obj.quaternion.copy(p.quat);
      p.obj.visible = true;
    }
  }

  fire(): void {
    const g = this.cur;
    if (!g) return;
    const c = g.conf;
    this.kick = Math.min(2, this.kick + c.kick);
    this.kickRoll = (Math.random() - 0.5) * 0.08 * c.kick;
    this.kickYaw = (Math.random() - 0.5) * 0.03 * c.kick;
    this.flashT = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = c.flash * (0.8 + Math.random() * 0.4);
    this.flash.scale.set(s, s, s);
    this.flashCore.rotation.z = Math.random() * 6;
    this.trigT = 0.09;
    this.slideT = 0.11;
    if (g.kind === 'shotgun') this.pumpT = 0;
    else if (g.kind === 'sniper') this.boltT = 0;
    else this.eject(g, 0);
    if (g.cylinder) this.cylT = 0.16;
    this.inspectT = -1;
  }

  /** 抛出一枚弹壳（delay 秒后） */
  private eject(g: VMGun, delay: number): void {
    if (g.conf.casing === 'none') return;
    const c = this.casings[this.casingNext];
    this.casingNext = (this.casingNext + 1) % CASINGS;
    const hull = g.conf.casing === 'hull';
    c.mesh.geometry = casingGeo(hull);
    c.mesh.material = casingMat(hull);
    g.gun.updateMatrixWorld(true);
    c.mesh.position.copy(g.eject).applyMatrix4(g.gun.matrixWorld);
    this.root.worldToLocal(c.mesh.position);
    c.mesh.rotation.set(0, Math.random() * 0.5, 0);
    if (g.conf.ejectDown) c.vel.set((Math.random() - 0.5) * 0.3, -0.8 - Math.random() * 0.4, 0.2 + Math.random() * 0.2);
    else c.vel.set(1.1 + Math.random() * 0.5, 1.0 + Math.random() * 0.5, 0.25 + Math.random() * 0.3);
    if (hull) c.vel.multiplyScalar(0.7);
    c.spin.set(Math.random() * 20 - 10, Math.random() * 20 - 10, 15 + Math.random() * 10);
    c.life = 0.7 + delay;
    c.mesh.userData.delay = delay;
    c.mesh.visible = false;
  }

  update(dt: number, mouseDX: number, mouseDY: number, speed: number, ads: number, reloading: number, onGround: boolean): void {
    const g = this.cur;
    if (!g) return;
    const c = g.conf;
    this.time += dt;

    // ---- 换弹进度：调用方给的是 sin(π·t)，这里还原为 0→1 的线性进度
    const rl = reloading;
    if (rl <= 0) this.rlProg = 0;
    else {
      const a = Math.asin(Math.min(1, rl)) / Math.PI;
      if (rl > this.rlPrev + 1e-6) this.rlProg = Math.max(this.rlProg, a);
      else if (rl < this.rlPrev - 1e-6) this.rlProg = Math.max(this.rlProg, 1 - a);
    }
    this.rlPrev = rl;
    const rp = rl > 0 ? this.rlProg : 0;
    const inReload = rl > 0;

    // ---- 机瞄平滑（调用方已平滑，这里只做缓入缓出）
    this.adsS = ads * ads * (3 - 2 * ads);
    const A = this.adsS;
    const H = 1 - A;

    // ---- 晃动 / 摆动 / 呼吸
    this.kick = Math.max(0, this.kick - dt * (7 + this.kick * 5));
    const kr = Math.min(1, dt * 10);
    this.swayX += (-mouseDX * 0.00045 - this.swayX) * kr;
    this.swayY += (mouseDY * 0.00045 - this.swayY) * kr;
    this.swayX = Math.max(-0.035, Math.min(0.035, this.swayX));
    this.swayY = Math.max(-0.035, Math.min(0.035, this.swayY));
    const moveT = onGround ? Math.min(1, speed / 5.4) : 0;
    this.bobAmt += (moveT - this.bobAmt) * Math.min(1, dt * 8);
    this.bob += dt * speed * 1.9;
    this.air += ((onGround ? 0 : 1) - this.air) * Math.min(1, dt * 6);
    const bobA = this.bobAmt * (1 - A * 0.85);
    const bx = Math.sin(this.bob) * 0.012 * bobA;
    const by = -Math.abs(Math.cos(this.bob)) * 0.01 * bobA;
    const breathe = Math.sin(this.time * 1.5) * 0.0016 * (1 - A * 0.85);
    this.switchT = Math.max(0, this.switchT - dt);
    // 拔枪：前 60% 的时间把武器抬上来，剩余时间完成上膛等细节
    const swU = 1 - this.switchT / this.switchDur;
    const sw = 1 - smooth(0, 0.6, swU);
    const swayK = 1 - A * 0.7;
    const kickF = this.kick * (1 - A * 0.4);

    // ---- 换弹时整枪姿态
    let rTilt = 0,
      rRoll = 0,
      rDown = 0;
    if (inReload) {
      const k = smooth(0, 0.15, rp) * (1 - smooth(0.85, 1, rp));
      if (c.reload === 'mag') {
        rTilt = 0.1 * k;
        rRoll = 0.3 * k;
        rDown = 0.03 * k;
      } else if (c.reload === 'shells') {
        rTilt = 0.06 * k;
        rRoll = -0.45 * k;
        rDown = 0.03 * k;
      } else {
        rTilt = 0.12 * k;
        rRoll = 0.35 * k;
        rDown = 0.03 * k;
      }
    }

    // ---- 腰射姿态（相机空间：grip_r 位置 + 欧拉角）
    _e.set(c.hipPitch + rTilt, c.hipYaw, c.hipRoll + rRoll, 'YXZ');
    _hipQ.setFromEuler(_e);
    _hipP.copy(c.hip);
    _hipP.y -= rDown;
    // ---- 机瞄姿态：sight 正对视轴（零旋转）
    _adsP.set(-g.sight.x, -g.sight.y, -c.adsDist - g.sight.z);
    // 混合
    const P = this.pose.position;
    P.lerpVectors(_hipP, _adsP, A);
    this.pose.quaternion.slerpQuaternions(_hipQ, _q.identity(), A);
    // 动态叠加：后坐、晃动、走路、切枪
    P.x += bx + this.swayX * swayK;
    P.y += by + breathe + this.swayY * swayK + this.air * 0.012 - sw * 0.25 + kickF * 0.004;
    P.z += kickF * 0.035 * (g.kind === 'pistol' ? 0.6 : 1);
    _e.set(
      kickF * 0.07 - sw * 0.9 - this.swayY * 1.1 - this.air * 0.04 + Math.sin(this.bob * 2) * 0.006 * bobA,
      this.swayX * 1.6 + this.kickYaw * this.kick,
      this.kickRoll * this.kick + bx * 1.4 * H,
      'YXZ',
    );
    _q.setFromEuler(_e);
    this.pose.quaternion.multiply(_q);

    // ---- 动作：检视 / 挥砍 / 投掷（叠加在姿态上）
    this.actionPose(g, dt, P);

    // ---- 可动部件
    this.animateParts(g, dt, rp, inReload);

    // ---- 手：右手固定在握把，左手视换弹阶段移动
    const hR = this.armR.hand;
    hR.position.copy(g.rPos);
    if (c.adsDrop) hR.position.y -= c.adsDrop * A;
    hR.quaternion.copy(g.rQuat);
    const hL = this.armL.hand;
    hL.position.copy(g.lPos);
    hL.quaternion.copy(g.lQuat);
    if (g.pump && this.pumpT >= 0) hL.position.z += g.pump.obj.position.z - g.pump.pos.z;
    if (inReload) this.leftReload(g, rp, hL);
    // 单手持物：左手只在拔投掷物保险销时出现
    let leftOn = g.style === 'gun';
    if (g.style === 'nade') leftOn = this.pinPull(g, swU, hL);
    hL.visible = leftOn;

    // ---- 枪口焰
    this.flashT -= dt;
    const on = this.flashT > 0;
    this.flash.visible = on;
    this.flashLight.intensity = on ? 5 * c.flash : 0;

    // ---- 前臂：从手腕指向肘部目标（相机空间）
    this.root.updateMatrixWorld(true);
    this.elbowR.copy(c.elbowR);
    this.elbowL.copy(c.elbowL);
    this.elbowR.y -= sw * 0.25;
    this.elbowL.y -= sw * 0.25;
    if (inReload && c.reload === 'mag') this.elbowL.y -= 0.08 * bell(0.2, 0.9, rp);
    this.placeForearm(this.armR, this.elbowR);
    this.placeForearm(this.armL, this.elbowL);

    // ---- 弹壳
    this.updateCasings(dt);

    // 有倍镜的枪开镜后由 HUD 画瞄准镜（透明镜片 + 十字线），枪身不再挡视线
    const hide = (this.scoped || g.kind === 'sniper') && ads > 0.8;
    this.pose.visible = !hide;
    this.armR.forearm.visible = !hide;
    this.armL.forearm.visible = !hide && leftOn;
    if (g.reticle) g.reticle.visible = !inReload && sw < 0.5;
  }

  /** 检视、匕首挥砍、投掷出手：在当前姿态上叠加位移与旋转 */
  private actionPose(g: VMGun, dt: number, P: THREE.Vector3): void {
    let ox = 0,
      oy = 0,
      oz = 0,
      rx = 0,
      ry = 0,
      rz = 0;
    if (this.inspectT >= 0) {
      this.inspectT += dt;
      const u = this.inspectT / INSPECT_TIME;
      if (u >= 1) this.inspectT = -1;
      else if (g.style === 'knife') {
        // 抛起翻转一圈再接住
        const k = bell(0, 1, u);
        oy += 0.04 * k;
        ox -= 0.05 * k;
        ry += D(-35) * k;
        rz += Math.PI * 2 * smooth(0.25, 0.75, u);
      } else {
        // 侧过枪身看一侧，再转回来看另一侧
        const a = bell(0, 0.55, u),
          b = bell(0.45, 1, u);
        ox -= 0.07 * a + 0.03 * b;
        oy += 0.035 * (a + b);
        oz += 0.04 * a;
        ry += D(-55) * a + D(30) * b;
        rz += D(35) * a - D(20) * b;
        rx += D(10) * b;
      }
    }
    if (this.swingT >= 0) {
      const dur = this.swingHeavy ? 0.75 : 0.36;
      this.swingT += dt;
      const u = this.swingT / dur;
      if (u >= 1) this.swingT = -1;
      else if (this.swingHeavy) {
        // 重刺：后拉蓄力 → 向前突刺 → 收回
        const back = smooth(0, 0.35, u) * (1 - smooth(0.35, 0.5, u));
        const thrust = smooth(0.35, 0.5, u) * (1 - smooth(0.62, 1, u));
        oz += 0.1 * back - 0.26 * thrust;
        oy += 0.05 * back;
        ox -= 0.08 * thrust;
        rx += D(25) * back - D(10) * thrust;
        ry += D(8) * thrust;
      } else {
        // 快划：从右上向左下横扫
        const k = smooth(0, 0.45, u);
        const ret = smooth(0.55, 1, u);
        const sweep = k - ret;
        ox -= 0.22 * sweep;
        oy += 0.05 * bell(0, 0.6, u) - 0.03 * sweep;
        oz -= 0.08 * sweep;
        ry += D(70) * sweep - D(20) * (1 - k);
        rz += D(-55) * sweep;
      }
    }
    if (this.throwT >= 0) {
      this.throwT += dt;
      const u = this.throwT / 0.55;
      if (u >= 1) this.throwT = -1;
      // 后摆 → 向前送出（0.32 处出手）→ 手放下
      const back = smooth(0, 0.3, u) * (1 - smooth(0.3, 0.45, u));
      const fwd = smooth(0.3, 0.45, u) * (1 - smooth(0.6, 1, u));
      const down = smooth(0.45, 1, u);
      oy += 0.09 * back - 0.25 * down;
      oz += 0.14 * back - 0.18 * fwd;
      ox += 0.03 * back;
      rx += D(50) * back - D(30) * fwd;
      for (const b of g.body) b.visible = u < 0.32;
      if (g.lever) g.lever.obj.visible = u < 0.32;
    }
    if (ox || oy || oz) {
      P.x += ox;
      P.y += oy;
      P.z += oz;
    }
    if (rx || ry || rz) {
      _e.set(rx, ry, rz, 'YXZ');
      this.pose.quaternion.multiply(_q2.setFromEuler(_e));
    }
  }

  /** 投掷物拔销：拔枪的后半段左手过来拔掉保险销；返回左手是否可见 */
  private pinPull(g: VMGun, u: number, hL: THREE.Object3D): boolean {
    const pin = g.pin;
    if (u >= 1 || u < 0.3) {
      if (pin) pin.obj.visible = u < 0.3;
      return false;
    }
    const reach = smooth(0.3, 0.55, u);
    const pull = smooth(0.6, 0.9, u);
    const away = smooth(0.85, 1, u);
    _v.copy(pin ? pin.pos : _v2.set(-0.02, 0.1, 0));
    _v.x -= 0.03 + pull * 0.07;
    _v.y -= 0.02 + away * 0.15;
    _v.z += 0.02;
    hL.position.lerp(_v, reach);
    hL.quaternion.copy(g.lMagQuat);
    if (pin) {
      pin.obj.position.copy(pin.pos);
      pin.obj.position.x -= pull * 0.07;
      pin.obj.position.y -= away * 0.15;
      pin.obj.visible = away < 0.9;
    }
    if (pull > 0.1 && pull < 0.2 && !this.pinSound) {
      this.pinSound = true;
      this.onPin?.();
    }
    if (u < 0.5) this.pinSound = false;
    return true;
  }

  private pinSound = false;
  /** 拔销时的回调（播放音效，由外部设置） */
  onPin: (() => void) | null = null;

  private placeForearm(arm: Arm, elbow: THREE.Vector3): void {
    // 手腕在 root 空间的位置
    _v.copy(arm.wrist).applyMatrix4(arm.hand.matrixWorld);
    this.root.worldToLocal(_v);
    const f = arm.forearm;
    f.position.copy(_v);
    _v2.subVectors(elbow, _v).normalize();
    // 前臂 +Z 指向肘部；绕自身轴的滚转随手的朝向
    f.quaternion.setFromUnitVectors(_Z, _v2);
  }

  private animateParts(g: VMGun, dt: number, rp: number, inReload: boolean): void {
    // 扳机
    this.trigT = Math.max(0, this.trigT - dt);
    if (g.trigger) {
      g.trigger.obj.quaternion.copy(g.trigger.quat);
      if (this.trigT > 0) g.trigger.obj.quaternion.multiply(_q2.setFromAxisAngle(_X, -0.35 * Math.min(1, this.trigT / 0.05)));
    }
    // 套筒 / 枪机后坐
    this.slideT = Math.max(0, this.slideT - dt);
    const st = this.slideT > 0 ? bell(0, 1, 1 - this.slideT / 0.11) : 0;
    if (g.slide) {
      let back = st * 0.028;
      // 换弹：空仓挂机，结束前释放
      if (inReload && g.kind === 'pistol') back = Math.max(back, 0.028 * smooth(0.05, 0.12, rp) * (1 - smooth(0.88, 0.92, rp)));
      g.slide.obj.position.copy(g.slide.pos);
      g.slide.obj.position.z += back;
    }
    if (g.hammer) {
      g.hammer.obj.quaternion.copy(g.hammer.quat);
      if (st > 0) g.hammer.obj.quaternion.multiply(_q2.setFromAxisAngle(_X, 0.5 * st));
    }
    if (g.bolt && g.kind !== 'sniper') {
      let back = st * 0.03;
      if (inReload) back = Math.max(back, 0.045 * bell(0.86, 0.98, rp));
      g.bolt.obj.position.copy(g.bolt.pos);
      g.bolt.obj.position.z += back;
    }
    // 狙击：拉栓（射击后自动；换弹时开栓装填）
    if (g.bolt && g.kind === 'sniper') {
      let bt = -1;
      if (this.boltT >= 0) {
        this.boltT += dt / 0.85;
        const t = this.boltT - 0.25; // 先等后坐结束
        if (t > 0 && t < 1) bt = t;
        if (Math.abs(t - 0.45) < dt / 0.85 * 0.5) this.eject(g, 0);
        if (this.boltT > 1.3) this.boltT = -1;
      }
      let up = 0,
        back = 0;
      if (bt >= 0) {
        up = smooth(0, 0.2, bt) * (1 - smooth(0.75, 0.95, bt));
        back = smooth(0.2, 0.4, bt) * (1 - smooth(0.55, 0.75, bt));
      }
      if (inReload) {
        up = Math.max(up, smooth(0.05, 0.15, rp) * (1 - smooth(0.85, 0.95, rp)));
        back = Math.max(back, smooth(0.15, 0.25, rp) * (1 - smooth(0.75, 0.85, rp)));
      }
      g.bolt.obj.position.copy(g.bolt.pos);
      g.bolt.obj.position.z += back * 0.09;
      g.bolt.obj.quaternion.copy(g.bolt.quat).multiply(_q2.setFromAxisAngle(_Z, up * D(85)));
    }
    // 霰弹：射击后泵动
    if (g.pump) {
      let pt = 0;
      if (this.pumpT >= 0) {
        this.pumpT += dt / 0.55;
        const t = this.pumpT - 0.3;
        pt = t > 0 ? bell(0, 1, Math.min(1, t)) : 0;
        if (Math.abs(t - 0.5) < (dt / 0.55) * 0.5) this.eject(g, 0);
        if (this.pumpT > 1.3) this.pumpT = -1;
      }
      if (inReload) pt = Math.max(pt, bell(0.86, 1.0, rp));
      g.pump.obj.position.copy(g.pump.pos);
      g.pump.obj.position.z += pt * 0.085;
    }
    // 左轮：每发转 60°（绕弹巢自身轴）；换弹时弹巢绕 crane_pivot（与枪管平行的轴）向左摆出，装填后合上
    let swing = 0;
    if (g.cylinder) {
      if (this.cylT > 0) {
        const k = Math.min(dt, this.cylT) / 0.16;
        this.cylAng += (Math.PI / 3) * k;
        this.cylT -= dt;
      }
      if (inReload && g.conf.reload === 'cylinder') swing = smooth(0.06, 0.2, rp) * (1 - smooth(0.82, 0.94, rp));
      const c = g.cylinder.obj;
      _q2.setFromAxisAngle(_Z, swing * D(80));
      c.position.copy(g.cylinder.pos).sub(g.crane).applyQuaternion(_q2).add(g.crane);
      c.quaternion.copy(_q2).multiply(g.cylinder.quat).multiply(_q2.setFromAxisAngle(_Z, this.cylAng));
    }
    // 轻机枪：换弹时打开机匣盖，换弹箱
    if (g.cover) {
      const cv = g.cover.obj;
      cv.position.copy(g.cover.pos);
      cv.quaternion.copy(g.cover.quat);
      if (inReload && g.conf.reload === 'box') {
        const open = smooth(0.05, 0.18, rp) * (1 - smooth(0.82, 0.94, rp));
        cv.quaternion.multiply(_q2.setFromAxisAngle(_X, open * D(75)));
      }
    }
    // 弹匣：卸下 → 掉落 → 新弹匣由左手装入
    if (g.mag) {
      const m = g.mag.obj;
      m.position.copy(g.mag.pos);
      m.quaternion.copy(g.mag.quat);
      m.visible = g.conf.reload !== 'cylinder';
      if (inReload && (g.conf.reload === 'mag' || g.conf.reload === 'box' || g.conf.reload === 'cylinder')) {
        if (g.conf.reload === 'cylinder') {
          // 快速装弹器：从下方送到摆出的弹巢后方，压入后松开（0.42–0.78 可见）
          const ins = smooth(0.42, 0.66, rp);
          _v2.copy(g.cylinder ? g.cylinder.pos : g.mag.pos).sub(g.crane).applyQuaternion(_q2.setFromAxisAngle(_Z, swing * D(80))).add(g.crane);
          m.position.set(_v2.x, _v2.y - (1 - ins) * 0.16, _v2.z + 0.045 - ins * 0.02);
          m.visible = rp > 0.42 && rp < 0.78;
        } else if (rp < 0.45) {
          const d = smooth(0.18, 0.42, rp);
          m.position.y -= d * d * 0.35;
          m.position.z += d * 0.03;
          m.quaternion.multiply(_q2.setFromAxisAngle(_X, d * 0.4));
          m.visible = rp < 0.4;
        } else {
          // 新弹匣跟着左手从下方上来，0.72 时插入到位
          const ins = smooth(0.5, 0.72, rp);
          m.position.y -= (1 - ins) * 0.2 + (1 - smooth(0.66, 0.74, rp)) * 0.02;
          m.position.x -= (1 - ins) * 0.04;
          m.quaternion.multiply(_q2.setFromAxisAngle(_Z, (1 - ins) * 0.3));
        }
      }
    }
    if (g.shell) {
      // 霰弹装填：左手把弹壳推进装弹口
      const s = g.shell.obj;
      if (inReload && g.conf.reload === 'shells' && rp > 0.12 && rp < 0.84) {
        const cyc = ((rp - 0.12) / 0.72) * 4;
        const f = cyc - Math.floor(cyc);
        s.visible = f < 0.8;
        s.position.copy(g.shell.pos);
        const push = smooth(0.35, 0.75, f);
        s.position.y -= (1 - push) * 0.06;
        s.position.z += (1 - push) * 0.05;
      } else s.visible = false;
    }
  }

  private leftReload(g: VMGun, rp: number, hL: THREE.Object3D): void {
    const c = g.conf;
    if (c.reload === 'mag') {
      // 离开护木 → 去弹匣口 → 向下离开画面 → 带新弹匣回来 → 回到护木
      const toMag = smooth(0.06, 0.2, rp);
      const away = bell(0.3, 0.62, rp);
      const back = smooth(0.78, 0.95, rp);
      const k = toMag * (1 - back);
      _v.copy(g.magwell);
      _v.y -= 0.07;
      _v.x -= 0.006;
      if (g.mag && rp > 0.45) {
        _v.copy(g.mag.obj.position);
        _v.y -= 0.06;
        _v.x -= 0.006;
      }
      _v.y -= away * 0.22;
      _v.x -= away * 0.06;
      hL.position.lerp(_v, k);
      hL.quaternion.slerp(g.lMagQuat, k);
    } else if (c.reload === 'shells') {
      const k = smooth(0.04, 0.12, rp) * (1 - smooth(0.84, 0.92, rp));
      const cyc = ((rp - 0.12) / 0.72) * 4;
      const f = cyc - Math.floor(cyc);
      _v.copy(g.shell ? g.shell.pos : g.magwell);
      _v.y -= 0.045 + (1 - smooth(0.35, 0.75, f)) * 0.06 + (f > 0.8 ? (f - 0.8) * 0.4 : 0);
      _v.z += 0.02;
      hL.position.lerp(_v, k);
      hL.quaternion.slerp(g.lMagQuat, k);
    } else {
      // 栓动：左手不动，右手拉栓由枪机动画表现；左手轻托
      hL.position.y -= 0.01 * bell(0.1, 0.9, rp);
    }
  }

  private updateCasings(dt: number): void {
    for (let i = 0; i < this.casings.length; i++) {
      const c = this.casings[i];
      if (c.life <= 0) continue;
      const d = c.mesh.userData.delay as number;
      if (d > 0) {
        c.mesh.userData.delay = d - dt;
        c.life -= dt;
        continue;
      }
      c.mesh.visible = true;
      c.life -= dt;
      c.vel.y -= 9.8 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      if (c.life <= 0) c.mesh.visible = false;
    }
  }
}
