/**
 * 第三人称角色：带骨骼蒙皮的写实士兵模型（public/assets/characters/soldier.glb，Mixamo 骨架）。
 *
 * 结构：root（由对局设置位置与朝向）→ pivot（死亡倒地时绕脚底旋转）→ model（SkeletonUtils 克隆）。
 * 模型原生朝 -Z、脚底在 y = 0、单位为米（Character 节点自带 0.01 缩放与 Z-up→Y-up 旋转），
 * 再整体缩放 MODEL_SCALE 使头部中心 ≈ 1.65 m，与命中判定一致。
 *
 * 每帧流程：AnimationMixer 按速度混合 Idle / Walk / Run（步频与地速匹配）→
 * 下蹲（降低髋部 + 双腿 IK 保持脚掌着地）→ 脊柱/头部随俯仰 →
 * 右臂双骨 IK 把枪摆到视线方向 → 左臂 IK 托住枪的 grip_l → 手指握持 → 死亡时程序化倒地 → 围巾尾摆动。
 * 每名特工另有：装备套件（kit_<id>.glb，挂在骨骼上）、骨骼横向缩放的体型差异、制服织物色与纹样。
 * update() 内不分配新对象。
 */
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AgentDef, WeaponKind } from '../data/defs.ts';
import { AGENTS } from '../data/defs.ts';
import { getGLB, hasCached, loadGLB, registerPreload } from './assets.ts';
import { buildWorldGun } from './weapons.ts';

const GLB_PATH = 'characters/soldier.glb';
registerPreload(() => loadGLB(GLB_PATH));

/**
 * 特工装备套件 kit_<id>.glb：每个网格节点名为 <骨骼名>__<部件>，顶点位于该骨骼的局部空间
 * （glTF 节点空间，含 0.01 缩放），直接以单位变换挂到骨骼上。源文件见 art-src/characters/。
 * 缺失的套件会被跳过（角色仍可用）。
 */
const kitPath = (id: string): string => `characters/kit_${id}.glb`;
for (const a of AGENTS) registerPreload(() => loadGLB(kitPath(a.id)).catch(() => undefined));

/**
 * 换头（预留，默认关闭）：开启后若预载中存在 head_<id>.glb（约定同套件：节点 mixamorigHead__head，
 * 头骨局部空间，头部中心约 1.60 m 未缩放 → 引擎内 ≈ 1.66 m），则隐藏原模型的密封头盔头部
 * （蒙皮主要绑定在 Head / HeadTop_End 的三角形与面罩网格），改挂该头部网格；文件缺失时保持原头。
 */
const HEAD_SWAP = true;
const headPath = (id: string): string => `characters/head_${id}.glb`;
if (HEAD_SWAP) for (const a of AGENTS) registerPreload(() => loadGLB(headPath(a.id)).catch(() => undefined));

/**
 * 原模型 T-pose 身高 1.83 m（头盔顶）；待机/持枪姿态膝盖微屈，头部中心约 1.60 m。
 * 放大 1.04 后待机头部中心 ≈ 1.66 m，与命中判定（1.65 m）一致。
 */
const MODEL_SCALE = 1.04;
/** 动画片段的原生地速（m/s，未缩放；由脚掌着地阶段的位移测得） */
const WALK_SPEED = 1.7 * MODEL_SCALE;
const RUN_SPEED = 4.4 * MODEL_SCALE;
/** 下蹲时髋部下降量（视线下降 0.45 m） */
const CROUCH_DROP = 0.43;
/** 死亡后多久隐藏 */
const DEATH_HIDE = 4.2;

const TEAM = {
  ally: { band: 0x35d6ff, light: 0x7fe9ff },
  enemy: { band: 0xff3445, light: 0xff2a3a },
};

/* ============================================================================
 * 小工具（模块级临时对象，update 中复用）
 * ========================================================================== */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _s1 = new THREE.Vector3();
const _vd = new THREE.Vector3();
const _sd = new THREE.Vector3();
const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 角度归一到 (-π, π] */
const wrapAngle = (a: number): number => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
/** 超过此角度（约 110°）视为后退：腿朝反方向、动画倒放 */
const BACK_ANGLE = (110 * Math.PI) / 180;
/** 下半身相对朝向的最大偏转 */
const LEG_YAW_MAX = Math.PI / 2;

/** 从（已更新的）matrixWorld 取世界位置 */
function wpos(o: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  return out.setFromMatrixPosition(o.matrixWorld);
}
/** 从（已更新的）matrixWorld 取世界旋转 */
function wquat(o: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
  o.matrixWorld.decompose(_vd, out, _sd);
  return out;
}
/** 设置骨骼的世界旋转（父级 matrixWorld 须为最新） */
function setWorldQuat(b: THREE.Object3D, q: THREE.Quaternion): void {
  const p = b.parent;
  if (p) {
    wquat(p, _q3).invert();
    b.quaternion.multiplyQuaternions(_q3, q);
  } else b.quaternion.copy(q);
}
/** 绕世界轴旋转骨骼（父级 matrixWorld 须为最新；同一轴的祖先旋转不影响结果） */
function rotateWorldAxis(b: THREE.Object3D, axisWorld: THREE.Vector3, angle: number): void {
  if (angle === 0) return;
  const p = b.parent;
  _v5.copy(axisWorld);
  if (p) _v5.applyQuaternion(wquat(p, _q3).invert());
  _q2.setFromAxisAngle(_v5.normalize(), angle);
  b.quaternion.premultiply(_q2);
}
/** 把骨骼从当前世界方向 from 转到 to（单位向量） */
function swingWorld(b: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  _q1.setFromUnitVectors(from, to);
  wquat(b, _q2);
  _q1.multiply(_q2);
  setWorldQuat(b, _q1);
}

/**
 * 双骨 IK：a（上臂/大腿）→ b（前臂/小腿）→ c（手/脚），使 c 的原点到达 target，
 * 关节朝 pole 方向弯曲。调用前三根骨骼的 matrixWorld 须为最新，结束后同样保持最新。
 */
function twoBoneIK(a: THREE.Object3D, b: THREE.Object3D, c: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3): void {
  const pa = wpos(a, _v1);
  const pb = wpos(b, _v2);
  const pc = wpos(c, _v3);
  const la = pa.distanceTo(pb);
  const lb = pb.distanceTo(pc);
  const n = _v4.subVectors(target, pa);
  let d = n.length();
  if (d < 1e-5) return;
  n.divideScalar(d);
  d = Math.min(Math.max(d, Math.abs(la - lb) + 1e-3), (la + lb) * 0.9995);
  const cosA = (la * la + d * d - lb * lb) / (2 * la * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  // 垂直于 n 的弯曲方向
  const u = _v5.copy(pole).addScaledVector(n, -pole.dot(n));
  if (u.lengthSq() < 1e-8) u.set(0, -1, 0).addScaledVector(n, n.y);
  u.normalize();
  // 期望的肘/膝位置存入 pc（之后不再需要旧的 pc）
  const elbow = pc.copy(pa).addScaledVector(n, la * cosA).addScaledVector(u, la * sinA);
  // 末端期望位置存入 n
  n.multiplyScalar(d).add(pa);
  // a：当前 a→b 转到 a→elbow
  pb.sub(pa).normalize();
  elbow.sub(pa).normalize();
  swingWorld(a, pb, elbow);
  a.updateMatrixWorld(true);
  // b：当前 b→c 转到 b→末端
  wpos(b, _v1);
  wpos(c, _v2).sub(_v1).normalize();
  _v3.subVectors(n, _v1).normalize();
  swingWorld(b, _v2, _v3);
  b.updateMatrixWorld(true);
}

/* ============================================================================
 * 材质：按队伍/特工改色（基于贴图颜色区域，在着色器中替换）
 * ========================================================================== */

interface TintSpec {
  plate: THREE.Color;
  fabric: THREE.Color;
  stripe: THREE.Color;
  rim: THREE.Color;
  pattern: number;
}

const bodyMatCache = new Map<string, THREE.MeshStandardMaterial>();
let visorMat: THREE.MeshStandardMaterial | null = null;
const markMatCache = new Map<string, THREE.MeshStandardMaterial>();
let ringGeo: THREE.BufferGeometry | null = null;
let ledGeo: THREE.BufferGeometry | null = null;
let patchGeo: THREE.BufferGeometry | null = null;

function tintSpec(isEnemy: boolean, agent: AgentDef): TintSpec {
  const c = (hex: number) => new THREE.Color(hex);
  const look = lookOf(agent.id);
  return isEnemy
    ? {
        // 敌方：深炭黑装甲、近黑织物（按特工略有色差），红色描边
        plate: c(0x3a3637),
        fabric: c(look.fabric[1]),
        stripe: c(agent.color),
        rim: c(0xff2030).multiplyScalar(0.03),
        pattern: look.pattern,
      }
    : {
        // 友方：冷灰蓝装甲、按特工区分的织物色，青色描边
        plate: c(0x8ea9c9),
        fabric: c(look.fabric[0]),
        stripe: c(agent.color),
        rim: c(0x40d8ff).multiplyScalar(0.025),
        pattern: look.pattern,
      };
}

function bodyMaterial(base: THREE.MeshStandardMaterial, isEnemy: boolean, agent: AgentDef): THREE.MeshStandardMaterial {
  const agentColor = agent.color;
  const key = `${isEnemy ? 'e' : 'a'}:${agent.id}:${agentColor}`;
  let m = bodyMatCache.get(key);
  if (m) return m;
  m = base.clone();
  m.name = `soldier_${key}`;
  m.roughness = 0.82;
  m.metalness = 0;
  const t = tintSpec(isEnemy, agent);
  const uniforms = {
    uPlate: { value: t.plate },
    uFabric: { value: t.fabric },
    uStripe: { value: t.stripe },
    uRim: { value: t.rim },
    uPat: { value: t.pattern },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uPlate;\nuniform vec3 uFabric;\nuniform vec3 uStripe;\nuniform vec3 uRim;\nuniform float uPat;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec3 kc = diffuseColor.rgb;
        float kLum = dot(kc, vec3(0.2126, 0.7152, 0.0722));
        // 暖色饱和度与色相（0 = 纯红，≈0.4 = 米色/棕色）
        float kSat = (kc.r - kc.b) / (kc.r + 1e-3);
        float kHue = (kc.g - kc.b) / (kc.r - kc.b + 1e-3);
        // 红色条纹 → 特工色
        float kRed = (1.0 - smoothstep(0.05, 0.14, kHue)) * smoothstep(0.82, 0.93, kSat) * smoothstep(0.05, 0.14, kc.r);
        // 米色装甲板及其棕色磨损边 → 队伍装甲色（保留明暗）
        float kTan = smoothstep(0.22, 0.42, kSat) * (1.0 - kRed) * step(kc.b, kc.g);
        // 橄榄绿织物 → 队伍织物色
        float kOl = smoothstep(0.06, 0.16, (kc.g - kc.r) / (kc.g + 1e-3)) * step(kc.b, kc.g);
        kc = mix(kc, uPlate * (kLum / 0.56), kTan);
        // 特工织物纹样（斜纹 / 圆点 / 网格），只作用于织物区域
        float kPt = 0.5;
        if (uPat > 0.5 && uPat < 1.5) kPt = step(0.5, fract((vMapUv.x + vMapUv.y) * 70.0));
        else if (uPat > 1.5 && uPat < 2.5) { vec2 kg = fract(vMapUv * 110.0) - 0.5; kPt = 1.0 - step(0.26, length(kg)); }
        else if (uPat > 2.5) { vec2 kg = fract(vMapUv * 80.0); kPt = step(0.86, max(kg.x, kg.y)); }
        kc = mix(kc, uFabric * (kLum / 0.085) * (1.0 + 0.45 * (kPt - 0.5)), kOl);
        kc = mix(kc, uStripe * clamp(diffuseColor.r / 0.45, 0.0, 1.3), kRed);
        diffuseColor.rgb = kc;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.5, kTan);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float kF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += uRim * kF * kF * kF + uStripe * kRed * 0.12;`,
      );
  };
  m.customProgramCacheKey = () => 'soldier-tint-v2';
  bodyMatCache.set(key, m);
  return m;
}

function getVisorMat(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  if (!visorMat) {
    visorMat = base.clone();
    visorMat.name = 'soldier_visor';
    visorMat.roughness = 0.22;
    visorMat.metalness = 0.6;
  }
  return visorMat;
}

function markMat(color: number, emissive: number): THREE.MeshStandardMaterial {
  const key = `${color}:${emissive}`;
  let m = markMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, emissive: color, emissiveIntensity: emissive });
    markMatCache.set(key, m);
  }
  return m;
}

function markGeos(): { ring: THREE.BufferGeometry; led: THREE.BufferGeometry; patch: THREE.BufferGeometry } {
  if (!ringGeo) {
    // 臂章：套在上臂上的短环（轴沿 X）
    ringGeo = new THREE.CylinderGeometry(0.07, 0.068, 0.042, 20, 1, true);
    ringGeo.rotateZ(Math.PI / 2);
  }
  // 头盔侧面的小信号灯
  if (!ledGeo) ledGeo = new THREE.BoxGeometry(0.01, 0.014, 0.03);
  // 右上臂外侧的特工臂章（T-pose 下外侧朝上）
  if (!patchGeo) patchGeo = new THREE.BoxGeometry(0.06, 0.012, 0.05);
  return { ring: ringGeo, led: ledGeo, patch: patchGeo };
}

/* ============================================================================
 * 特工外观：体型（骨骼横向缩放）、制服织物色与纹样、套件
 * ========================================================================== */

interface AgentLook {
  /** 骨骼“净”横向缩放（骨骼局部 x/z；y 为骨骼方向不变，因此身高与命中判定不变） */
  scale: Record<string, [number, number]>;
  /** 制服织物（原橄榄绿区域）色：友方 / 敌方 */
  fabric: [number, number];
  /** 织物纹样：1 斜纹 2 圆点 3 网格 */
  pattern: number;
  /** 头盔侧面队伍信号灯位置（未缩放的模型空间，取 x>0 一侧，左右对称） */
  led: [number, number, number];
  /** 是否保留臂章与右臂特工臂章（重型肩甲会挡住） */
  armband: boolean;
}

const LOOK: Record<string, AgentLook> = {
  // 零：瘦削轻快——腿、腰收窄
  ling: {
    scale: { UpLeg: [0.92, 0.92], Leg: [0.92, 0.92], Spine1: [0.93, 0.95], Spine: [0.95, 0.96] },
    fabric: [0x2f4558, 0x2a2224],
    pattern: 1,
    led: [0.124, 1.71, 0.07],
    armband: true,
  },
  // 圆：偏纤细的肩宽
  yuan: {
    scale: { Spine2: [0.95, 0.97], UpLeg: [0.96, 0.96], Leg: [0.96, 0.96] },
    fabric: [0x433f5e, 0x2c2230],
    pattern: 2,
    led: [0.124, 1.70, 0.1],
    armband: true,
  },
  // 衡：宽肩厚胸、腿更粗
  heng: {
    scale: { Spine1: [1.05, 1.04], Spine2: [1.09, 1.06], UpLeg: [1.06, 1.06], Leg: [1.05, 1.05] },
    fabric: [0x454a3c, 0x2c2a22],
    pattern: 3,
    led: [0.133, 1.70, 0.07],
    armband: false,
  },
};
const lookOf = (id: string): AgentLook => LOOK[id] ?? LOOK.ling;

type KitRole = 'main' | 'plate' | 'team' | 'agent' | 'glass';

interface KitPart {
  bone: string;
  piece: string;
  geo: THREE.BufferGeometry;
  src: THREE.MeshStandardMaterial;
  role: KitRole;
  /** 摆动部件（围巾尾）：骨骼局部空间里的悬挂点 */
  pivot: THREE.Vector3 | null;
  /** 足够大才投射阴影（小挂件省掉阴影绘制） */
  shadow: boolean;
}

const kitCache = new Map<string, KitPart[]>();
const kitMatCache = new Map<string, THREE.Material>();

function roleOf(name: string): KitRole {
  if (name.startsWith('kit_plate')) return 'plate';
  if (name.startsWith('kit_team')) return 'team';
  if (name.startsWith('kit_agent')) return 'agent';
  if (name.startsWith('kit_glass')) return 'glass';
  return 'main';
}

/** 解析套件 GLB（每个特工只做一次；几何体与贴图在所有实例间共享） */
function kitParts(path: string): KitPart[] {
  let parts = kitCache.get(path);
  if (parts) return parts;
  parts = [];
  if (hasCached(`glb:${path}`)) {
    const scene = getGLB(path).scene;
    scene.updateMatrixWorld(true);
    for (const node of scene.children) {
      const sep = node.name.indexOf('__');
      if (sep < 0) continue;
      const bone = node.name.slice(0, sep);
      const piece = node.name.slice(sep + 2);
      node.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        let pivot: THREE.Vector3 | null = null;
        if (piece.startsWith('tail')) {
          // 悬挂点：骨骼局部 +Y（绑定姿态下朝上）最高处顶点的平均
          const pos = m.geometry.getAttribute('position');
          let top = -Infinity;
          for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
          pivot = new THREE.Vector3();
          let n = 0;
          for (let i = 0; i < pos.count; i++)
            if (pos.getY(i) > top - 2) {
              pivot.x += pos.getX(i);
              pivot.y += pos.getY(i);
              pivot.z += pos.getZ(i);
              n++;
            }
          pivot.divideScalar(Math.max(1, n));
        }
        parts!.push({ bone, piece, geo: m.geometry, src, role: roleOf(src.name), pivot, shadow: true });
      });
    }
  }
  // 同一骨骼、同一材质角色的固定部件合并成一个绘制（摆动件单独保留）
  const groups = new Map<string, KitPart[]>();
  for (const p of parts) {
    const key = p.pivot ? `${p.bone}|${p.piece}|${p.src.name}` : `${p.bone}|${p.src.name}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(p);
  }
  const merged: KitPart[] = [];
  for (const g of groups.values()) {
    let geo: THREE.BufferGeometry | null = g.length > 1 ? mergeGeometries(g.map((p) => p.geo)) : g[0].geo;
    if (!geo) {
      merged.push(...g);
      continue;
    }
    geo.computeBoundingSphere();
    const r = geo.boundingSphere ? geo.boundingSphere.radius : 0;
    merged.push({ ...g[0], piece: g.map((p) => p.piece).join('+'), geo, shadow: r > 9 });
  }
  kitCache.set(path, merged);
  return merged;
}

function kitMaterial(kitId: string, part: KitPart, isEnemy: boolean, agentColor: number): THREE.Material {
  const team = isEnemy ? 'e' : 'a';
  const key =
    part.role === 'main' || part.role === 'glass' ? `${kitId}:${part.role}:${part.src.name}` : `${kitId}:${part.role}:${team}:${agentColor}:${part.src.name}`;
  let m = kitMatCache.get(key);
  if (m) return m;
  const T = isEnemy ? TEAM.enemy : TEAM.ally;
  switch (part.role) {
    case 'plate': {
      // 大块装甲板跟随队伍装甲色（与身体改色一致），保证远距离的敌我区分
      const c = part.src.clone();
      c.color.set(isEnemy ? 0x45403f : 0xa3bad6);
      c.name = `kit_plate_${key}`;
      m = c;
      break;
    }
    case 'team':
      m = new THREE.MeshStandardMaterial({ color: T.band, emissive: T.band, emissiveIntensity: 0.6, roughness: 0.5 });
      break;
    case 'agent': {
      const c = part.src.clone();
      c.color.set(agentColor);
      c.emissive.set(agentColor);
      c.emissiveIntensity = 0.12;
      m = c;
      break;
    }
    case 'glass':
      m = new THREE.MeshStandardMaterial({ color: 0x0e1418, roughness: 0.06, metalness: 0.6, transparent: true, opacity: 0.55, depthWrite: false });
      break;
    default:
      m = part.src;
  }
  kitMatCache.set(key, m);
  return m;
}

/** 去掉缩放轨道的动画片段（骨骼缩放由体型参数控制，不能被动画覆盖） */
let clipsNoScale: THREE.AnimationClip[] | null = null;
function animClips(src: THREE.AnimationClip[]): THREE.AnimationClip[] {
  if (!clipsNoScale) clipsNoScale = src.map((c) => new THREE.AnimationClip(c.name, c.duration, c.tracks.filter((t) => !t.name.endsWith('.scale'))));
  return clipsNoScale;
}

/** 换头时隐藏原头部：去掉主要绑定在头部骨骼上的三角形（几何体按源几何体缓存共享） */
const headlessCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
function headlessGeometry(sm: THREE.SkinnedMesh, headJoints: Set<number>): THREE.BufferGeometry {
  const src = sm.geometry;
  let g = headlessCache.get(src);
  if (g) return g;
  const si = src.getAttribute('skinIndex');
  const sw = src.getAttribute('skinWeight');
  const headW = (v: number): number => {
    let w = 0;
    for (let k = 0; k < 4; k++) if (headJoints.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
    return w;
  };
  const idx = src.getIndex();
  const tri = idx ? idx.count / 3 : src.getAttribute('position').count / 3;
  const keep: number[] = [];
  for (let t = 0; t < tri; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3;
    const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    if (Math.max(headW(a), headW(b), headW(c)) < 0.35) keep.push(a, b, c);
  }
  g = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) g.setAttribute(name, src.getAttribute(name));
  g.setIndex(keep);
  g.boundingSphere = src.boundingSphere;
  headlessCache.set(src, g);
  return g;
}

/* ============================================================================
 * 持枪参数
 * ========================================================================== */

interface HandFrame {
  /** 手腕→中指根方向 */
  f: THREE.Vector3;
  /** 掌心法线（指向握持物） */
  p: THREE.Vector3;
  /** 握持点相对手腕：沿 f、沿 p、沿世界上方 */
  df: number;
  dp: number;
}

interface HoldPose {
  /** 枪原点（右手虎口处）相对颈部的偏移（瞄准坐标系：x 右、y 上、z 后） */
  off: THREE.Vector3;
  right: HandFrame;
  left: HandFrame;
  /** 右/左手指弯曲（弧度/关节） */
  curlR: number;
  curlL: number;
  /** 躯干朝右扭转（步枪抵肩） */
  twist: number;
  /** 左锁骨前伸（弧度） */
  clav: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();
const RIGHT_GRIP: HandFrame = { f: V(0.0, -0.42, -1), p: V(-1, 0, 0), df: 0.075, dp: 0.03 };
const LEFT_UNDER: HandFrame = { f: V(0.75, 0.05, -0.7), p: V(0.15, 1, 0), df: 0.07, dp: 0.035 };
const LEFT_CUP: HandFrame = { f: V(0.15, -0.5, -1), p: V(1, 0.1, 0), df: 0.06, dp: 0.04 };

const HOLD: Record<WeaponKind, HoldPose> = {
  pistol: { off: new THREE.Vector3(0.05, -0.1, -0.42), right: RIGHT_GRIP, left: LEFT_CUP, curlR: 1.15, curlL: 1.0, twist: 0.05, clav: 0.1 },
  smg: { off: new THREE.Vector3(0.1, -0.15, -0.22), right: RIGHT_GRIP, left: LEFT_UNDER, curlR: 1.15, curlL: 0.75, twist: 0.45, clav: 0.3 },
  shotgun: { off: new THREE.Vector3(0.11, -0.16, -0.18), right: RIGHT_GRIP, left: LEFT_UNDER, curlR: 1.15, curlL: 0.8, twist: 0.55, clav: 0.35 },
  rifle: { off: new THREE.Vector3(0.11, -0.16, -0.18), right: RIGHT_GRIP, left: LEFT_UNDER, curlR: 1.15, curlL: 0.8, twist: 0.55, clav: 0.35 },
  sniper: { off: new THREE.Vector3(0.11, -0.15, -0.17), right: RIGHT_GRIP, left: LEFT_UNDER, curlR: 1.15, curlL: 0.8, twist: 0.6, clav: 0.35 },
};

/** 由（绑定姿态下的）手骨计算：手骨世界旋转 → 语义坐标系（f, p, t） 的换算 */
interface HandRig {
  hand: THREE.Object3D;
  fore: THREE.Object3D;
  upper: THREE.Object3D;
  /** 绑定姿态（模型空间）手骨旋转 */
  bindQ: THREE.Quaternion;
  /** 绑定姿态的语义基 S_T 的逆 */
  semInv: THREE.Quaternion;
  /** 右手 t = f×p，左手 t = -(f×p) */
  sign: number;
  fingers: { bone: THREE.Object3D; bind: THREE.Quaternion; axis: THREE.Vector3; thumb: boolean }[];
}

function basisQuat(f: THREE.Vector3, p: THREE.Vector3, sign: number, out: THREE.Quaternion): THREE.Quaternion {
  _v1.copy(f).normalize();
  _v2.copy(p).addScaledVector(_v1, -p.dot(_v1)).normalize();
  _v3.crossVectors(_v1, _v2).multiplyScalar(sign);
  _m1.makeBasis(_v1, _v2, _v3);
  return out.setFromRotationMatrix(_m1);
}

/* ============================================================================
 * 角色
 * ========================================================================== */

export class CharacterModel {
  root = new THREE.Group();
  private pivot = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private idle: THREE.AnimationAction;
  private walk: THREE.AnimationAction;
  private runA: THREE.AnimationAction;
  private walkDur: number;
  private runDur: number;
  private skinned: THREE.SkinnedMesh[] = [];

  private hips: THREE.Object3D;
  private spine: THREE.Object3D[];
  private neck: THREE.Object3D;
  private clavL: THREE.Object3D;
  private head: THREE.Object3D;
  private legs: { up: THREE.Object3D; low: THREE.Object3D; foot: THREE.Object3D; side: number; pos: THREE.Vector3; quat: THREE.Quaternion }[];
  private armR: HandRig;
  private armL: HandRig;
  /** 骨骼的世界缩放（模型空间，用于把米制挂件挂到骨骼上） */
  private boneScale: number;

  private mount = new THREE.Group();
  private gun: THREE.Object3D | null = null;
  private gunMuzzle: THREE.Object3D | null = null;
  private gunGripL: THREE.Object3D | null = null;
  private kind: WeaponKind | null = null;
  private hold: HoldPose = HOLD.pistol;
  /** 各手的期望旋转（瞄准坐标系下，常量，随武器变化） */
  private kR = new THREE.Quaternion();
  private kL = new THREE.Quaternion();
  private wristR = new THREE.Vector3();
  private wristL = new THREE.Vector3();

  private speedS = 0;
  private crouchS = 0;
  private phase = 0;
  private time = Math.random() * 10;
  private wIdle = 1;
  private wWalk = 0;
  private wRun = 0;
  /** 下半身偏转（平滑后，弧度，+ = 向左转） */
  private legYaw = 0;
  /** 步相位推进方向：+1 前进，-1 后退（平滑过渡） */
  private stepDir = 1;
  private deathT = -1;
  private deathDir = 1;
  private deathSide = 0;
  /**
   * 程序化覆盖的骨骼及其“纯动画”姿态。PropertyMixer 只在动画值变化时才写回骨骼，
   * 所以每帧先把这些骨骼恢复成上一帧的动画姿态，避免覆盖量累积（例如死亡时动画冻结）。
   */
  private ovBones: THREE.Object3D[] = [];
  private ovSaved: THREE.Quaternion[] = [];
  private hipsSaved = new THREE.Vector3();
  /** ovBones 中手臂/手指骨骼的起始下标（死亡时淡回动画姿态） */
  private armStart = 0;

  // 每帧复用
  private aimQ = new THREE.Quaternion();
  private rootQ = new THREE.Quaternion();
  private tmpQ = new THREE.Quaternion();
  private gunPos = new THREE.Vector3();
  private target = new THREE.Vector3();
  private pole = new THREE.Vector3();
  private right = new THREE.Vector3();
  /** 围巾尾等摆动部件：悬挂组 + 摆角/角速度（x = 前后，z = 左右） */
  private swing: { g: THREE.Group; ax: number; vx: number; az: number; vz: number; k: number }[] = [];
  private prevSpeed = 0;

  constructor(
    public agent: AgentDef,
    isEnemy: boolean,
  ) {
    const gltf = getGLB(GLB_PATH);
    this.model = SkeletonUtils.clone(gltf.scene);
    this.model.scale.setScalar(MODEL_SCALE);
    this.root.add(this.pivot);
    this.pivot.add(this.model);

    // 材质：共享几何与贴图，按（队伍, 特工）共享改色材质
    this.model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      const base = sm.material as THREE.MeshStandardMaterial;
      sm.material = base.name.toLowerCase().includes('visor') ? getVisorMat(base) : bodyMaterial(base, isEnemy, agent);
      sm.castShadow = true;
      sm.receiveShadow = true;
      // 倒地、下蹲等姿态会超出绑定包围球
      sm.frustumCulled = false;
      this.skinned.push(sm);
    });

    const bone = (n: string): THREE.Object3D => {
      const b = this.model.getObjectByName('mixamorig' + n);
      if (!b) throw new Error(`角色骨骼缺失：${n}`);
      return b;
    };
    this.hips = bone('Hips');
    this.spine = [bone('Spine'), bone('Spine1'), bone('Spine2')];
    this.neck = bone('Neck');
    this.clavL = bone('LeftShoulder');
    this.head = bone('Head');
    this.legs = (
      [
        ['Left', -1],
        ['Right', 1],
      ] as const
    ).map(([s, side]) => ({
      up: bone(s + 'UpLeg'),
      low: bone(s + 'Leg'),
      foot: bone(s + 'Foot'),
      side,
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
    }));

    // 体型：骨骼横向缩放（子骨骼按绑定姿态的相对旋转做反向补偿，只影响该段蒙皮）
    const look = lookOf(agent.id);
    this.applyProportions(look);

    // 换头（默认关闭）
    const headGltf = HEAD_SWAP && hasCached(`glb:${headPath(agent.id)}`);
    if (headGltf) {
      const joints = new Set<number>();
      for (const sm of this.skinned) {
        sm.skeleton.bones.forEach((b, i) => {
          if (b.name === 'mixamorigHead' || b.name === 'mixamorigHeadTop_End') joints.add(i);
        });
        if (sm.material === visorMat) sm.visible = false;
        else sm.geometry = headlessGeometry(sm, joints);
      }
    }

    // 绑定姿态（T-pose）下测量手部坐标系
    this.root.updateMatrixWorld(true);
    this.boneScale = this.hips.getWorldScale(_v1).x;
    const handRig = (s: 'Left' | 'Right'): HandRig => {
      const hand = bone(s + 'Hand');
      const sign = s === 'Right' ? 1 : -1;
      const hp = wpos(hand, new THREE.Vector3());
      const f = wpos(bone(s + 'HandMiddle1'), new THREE.Vector3()).sub(hp).normalize();
      const th = wpos(bone(s + 'HandThumb1'), new THREE.Vector3()).sub(hp);
      th.addScaledVector(f, -th.dot(f)).normalize();
      // t = sign·(f×p) ⇒ 右手 p = t×f，左手 p = f×t
      const p = sign > 0 ? new THREE.Vector3().crossVectors(th, f) : new THREE.Vector3().crossVectors(f, th);
      const semInv = basisQuat(f, p, sign, new THREE.Quaternion()).invert();
      const curlAxis = new THREE.Vector3().crossVectors(f, p).normalize();
      const fingers: HandRig['fingers'] = [];
      for (const fn of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'])
        for (let i = 1; i <= 3; i++) {
          const fb = bone(`${s}Hand${fn}${i}`);
          const axis = curlAxis.clone().applyQuaternion(wquat(fb, new THREE.Quaternion()).invert()).normalize();
          fingers.push({ bone: fb, bind: fb.quaternion.clone(), axis, thumb: fn === 'Thumb' });
        }
      return { hand, fore: bone(s + 'ForeArm'), upper: bone(s + 'Arm'), bindQ: wquat(hand, new THREE.Quaternion()), semInv, sign, fingers };
    };
    this.armR = handRig('Right');
    this.armL = handRig('Left');
    this.ovBones.push(this.hips, ...this.spine, this.neck, this.head, this.clavL);
    for (const l of this.legs) this.ovBones.push(l.up, l.low, l.foot);
    this.armStart = this.ovBones.length;
    for (const r of [this.armR, this.armL]) {
      this.ovBones.push(r.upper, r.fore, r.hand);
      for (const fg of r.fingers) this.ovBones.push(fg.bone);
    }
    this.ovSaved = this.ovBones.map((b) => b.quaternion.clone());
    this.hipsSaved.copy(this.hips.position);

    // 队伍/特工标识（在绑定姿态下按模型空间坐标挂到骨骼上）
    const g = markGeos();
    const team = isEnemy ? TEAM.enemy : TEAM.ally;
    if (look.armband) {
      const band = new THREE.Mesh(g.ring, markMat(team.band, 0.55));
      this.attachAt(bone('LeftArm'), band, -0.395, 1.479, 0.057);
      const patch = new THREE.Mesh(g.patch, markMat(agent.color, 0.35));
      this.attachAt(bone('RightArm'), patch, 0.395, 1.479 + 0.072, 0.057);
    }
    for (const sx of [-1, 1]) {
      const led = new THREE.Mesh(g.led, markMat(team.light, 2.4));
      this.attachAt(bone('Head'), led, sx * look.led[0], look.led[1], look.led[2]);
    }

    // 特工装备套件（+ 可选的替换头部）
    this.attachKit(kitPath(agent.id), agent.id, isEnemy, agent.color);
    if (headGltf) this.attachKit(headPath(agent.id), `head_${agent.id}`, isEnemy, agent.color);

    this.mount.name = 'gun_mount';
    this.armR.hand.add(this.mount);

    // 动画
    this.mixer = new THREE.AnimationMixer(this.model);
    const clips = animClips(gltf.animations);
    const clip = (n: string): THREE.AnimationClip => {
      const c = THREE.AnimationClip.findByName(clips, n);
      if (!c) throw new Error(`角色动画缺失：${n}`);
      return c;
    };
    this.idle = this.mixer.clipAction(clip('Idle'));
    this.walk = this.mixer.clipAction(clip('Walk'));
    this.runA = this.mixer.clipAction(clip('Run'));
    this.walkDur = this.walk.getClip().duration;
    this.runDur = this.runA.getClip().duration;
    this.idle.time = Math.random() * this.idle.getClip().duration;
    for (const a of [this.idle, this.walk, this.runA]) {
      a.play();
      a.setEffectiveWeight(0);
    }
    // 行走/奔跑的时间由步相位驱动
    this.walk.timeScale = 0;
    this.runA.timeScale = 0;
    this.idle.setEffectiveWeight(1);

    this.setWeapon('pistol');
    this.update(0, 0, 0, 0, true);
  }

  /**
   * 骨骼横向缩放。look.scale 给出各骨骼（左右成对的去掉 Left/Right 前缀）的“净”缩放；
   * 实际局部缩放 = 净缩放 ÷ 父骨骼净缩放在该轴上的投影，子骨骼若无设定则完全补偿回 1，
   * 这样缩放只影响本段蒙皮，手、头等末端（及枪的挂点）保持原比例。
   */
  private applyProportions(look: AgentLook): void {
    const net = new Map<THREE.Object3D, THREE.Vector3>();
    const want = (b: THREE.Object3D): THREE.Vector3 => {
      const key = b.name.replace('mixamorig', '').replace(/^(Left|Right)/, '');
      const v = look.scale[key];
      return v ? new THREE.Vector3(v[0], 1, v[1]) : new THREE.Vector3(1, 1, 1);
    };
    const visit = (b: THREE.Object3D, parentNet: THREE.Vector3 | null): void => {
      if (!(b as THREE.Bone).isBone) return;
      const w = want(b);
      const local = new THREE.Vector3(1, 1, 1);
      if (parentNet) {
        // 本骨骼各局部轴在父骨骼空间中的方向，被父骨骼净缩放拉伸的长度
        const m = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(b.quaternion));
        const e = m.elements;
        for (let i = 0; i < 3; i++) {
          const ax = e[i * 3] * parentNet.x;
          const ay = e[i * 3 + 1] * parentNet.y;
          const az = e[i * 3 + 2] * parentNet.z;
          const len = Math.hypot(ax, ay, az);
          local.setComponent(i, w.getComponent(i) / Math.max(1e-3, len));
        }
      } else local.copy(w);
      if (Math.abs(local.x - 1) > 1e-3 || Math.abs(local.y - 1) > 1e-3 || Math.abs(local.z - 1) > 1e-3) b.scale.copy(local);
      // 子骨骼看到的父空间缩放：沿本骨骼轴的净缩放
      net.set(b, w);
      for (const c of b.children) visit(c, w);
    };
    visit(this.hips, null);
  }

  /** 挂上套件部件：几何体共享，材质按（套件, 角色, 队伍/特工）共享 */
  private attachKit(path: string, kitId: string, isEnemy: boolean, agentColor: number): void {
    const parts = kitParts(path);
    for (const part of parts) {
      const b = this.model.getObjectByName(part.bone);
      if (!b) continue;
      const mesh = new THREE.Mesh(part.geo, kitMaterial(kitId, part, isEnemy, agentColor));
      mesh.name = `${part.bone}__${part.piece}`;
      mesh.castShadow = part.shadow && part.role !== 'glass' && part.role !== 'team';
      mesh.receiveShadow = true;
      if (part.pivot) {
        const gp = new THREE.Group();
        gp.position.copy(part.pivot);
        mesh.position.copy(part.pivot).negate();
        gp.add(mesh);
        b.add(gp);
        this.swing.push({ g: gp, ax: 0, vx: 0, az: 0, vz: 0, k: 22 + this.swing.length * 7 });
      } else b.add(mesh);
    }
  }

  /** 围巾尾：受速度变化与步伐驱动的阻尼摆（无分配） */
  private updateSwing(dt: number): void {
    if (this.swing.length === 0 || dt <= 0) return;
    const sp = this.speedS;
    const acc = (sp - this.prevSpeed) / dt;
    this.prevSpeed = sp;
    const run = this.wRun + this.wWalk * 0.4;
    for (let i = 0; i < this.swing.length; i++) {
      const s = this.swing[i];
      // 跑动时向后飘起，加速时再甩一下；步伐带来轻微左右摆
      const tx = -Math.min(0.75, sp * 0.13) + Math.sin(this.phase * Math.PI * 4 + i) * 0.06 * run;
      const tz = Math.sin(this.phase * Math.PI * 2 + i * 1.3) * 0.12 * run + this.legYaw * 0.15;
      s.vx += ((tx - s.ax) * s.k - s.vx * 4.5 - acc * 0.06) * dt;
      s.vz += ((tz - s.az) * s.k - s.vz * 4.5) * dt;
      s.ax += s.vx * dt;
      s.az += s.vz * dt;
      s.g.rotation.set(s.ax, 0, s.az);
    }
  }

  /** 把挂件按绑定姿态下的模型空间位置（未缩放的米）挂到骨骼上，挂件轴向与模型空间一致 */
  private attachAt(b: THREE.Object3D, obj: THREE.Object3D, x: number, y: number, z: number): void {
    const s = new THREE.Group();
    const inv = wquat(b, new THREE.Quaternion()).invert();
    s.quaternion.copy(inv);
    s.position.copy(b.worldToLocal(new THREE.Vector3(x, y, z).multiplyScalar(MODEL_SCALE)));
    s.scale.setScalar(1 / this.boneScale);
    s.add(obj);
    b.add(s);
  }

  setWeapon(kind: WeaponKind): void {
    if (this.kind === kind && this.gun) return;
    this.kind = kind;
    if (this.gun) this.mount.remove(this.gun);
    const gun = buildWorldGun(kind);
    gun.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.gun = gun;
    this.gunMuzzle = gun.getObjectByName('muzzle') ?? null;
    this.gunGripL = gun.getObjectByName('grip_l') ?? null;
    this.mount.add(gun);
    const h = HOLD[kind];
    this.hold = h;
    // 期望手骨旋转（瞄准坐标系）：K = S_D · S_T⁻¹ · H_T
    this.kR.copy(basisQuat(h.right.f, h.right.p, 1, _q1)).multiply(this.armR.semInv).multiply(this.armR.bindQ);
    this.kL.copy(basisQuat(h.left.f, h.left.p, -1, _q1)).multiply(this.armL.semInv).multiply(this.armL.bindQ);
    // 手腕相对握持点
    this.wristR.copy(h.right.f).multiplyScalar(-h.right.df).addScaledVector(h.right.p, -h.right.dp);
    this.wristL.copy(h.left.f).multiplyScalar(-h.left.df).addScaledVector(h.left.p, -h.left.dp);
    // 枪相对手骨的固定变换：mount = (手骨在瞄准坐标系的位姿)⁻¹
    _m1.compose(this.wristR, this.kR, _s1.setScalar(this.boneScale)).invert();
    _m1.decompose(this.mount.position, this.mount.quaternion, this.mount.scale);
  }

  /**
   * 每帧姿态：speed 为水平速度，pitch 为俯仰（>0 抬头），crouch 0..1。
   * moveAngle：水平移动方向相对朝向的角度（弧度，任意范围，内部归一）。
   * 约定与 rotation.y 相同（绕 +Y 逆时针为正）：0 = 向前，+π/2 = 向角色左侧平移，
   * −π/2 = 向右侧平移，±π = 后退。下半身转向移动方向（最多 ±90°），上半身反向扭回保持瞄准；
   * |角度| > 110° 时腿朝反方向并倒放动画。
   */
  update(dt: number, speed: number, pitch: number, crouch: number, alive: boolean, moveAngle = 0): void {
    this.time += dt;
    let aimW = 1;
    let cr: number;
    if (!alive) {
      if (this.deathT < 0) this.startDeath();
      this.deathT += dt;
      speed = 0;
      pitch = 0;
      const d = this.deathT;
      aimW = 1 - smooth(0.0, 0.3, d);
      // 膝盖先软下去，倒地后腿伸直些
      cr = smooth(0, 0.28, d) * 0.55 * (1 - smooth(0.45, 0.9, d) * 0.7);
      this.root.visible = d < DEATH_HIDE;
      this.mixer.timeScale = 1 - smooth(0.1, 0.6, d);
    } else {
      if (this.deathT >= 0) this.resetDeath();
      this.root.visible = true;
      this.crouchS += (crouch - this.crouchS) * Math.min(1, dt * 14);
      cr = this.crouchS;
    }
    this.speedS += (speed - this.speedS) * Math.min(1, dt * (alive ? 10 : 14));
    // 移动方向 → 下半身偏转与前进/后退
    let legT = 0;
    let dirT = 1;
    if (alive && speed > 0.05) {
      const a = wrapAngle(moveAngle);
      if (Math.abs(a) > BACK_ANGLE) {
        dirT = -1;
        legT = wrapAngle(a - Math.PI);
      } else legT = a;
      legT = Math.max(-LEG_YAW_MAX, Math.min(LEG_YAW_MAX, legT));
    }
    const kd = Math.min(1, dt * 9);
    this.legYaw += (legT - this.legYaw) * kd;
    this.stepDir += (dirT - this.stepDir) * kd;
    this.locomotion(dt, this.speedS);
    if (!alive) this.applyDeath();

    // 恢复纯动画姿态，再让混合器写入新的一帧
    for (let i = 0; i < this.ovBones.length; i++) this.ovBones[i].quaternion.copy(this.ovSaved[i]);
    this.hips.position.copy(this.hipsSaved);
    this.mixer.update(dt);
    for (let i = 0; i < this.ovBones.length; i++) this.ovSaved[i].copy(this.ovBones[i].quaternion);
    this.hipsSaved.copy(this.hips.position);
    this.root.updateMatrixWorld(true);
    // 身体朝向（含倒地旋转）
    wquat(this.pivot, this.rootQ);
    this.right.copy(_X).applyQuaternion(this.rootQ);

    // 下半身转向移动方向（待机时不转）；上半身在 applySpine 中反向扭回
    const legYaw = this.legYaw * (1 - this.wIdle);
    if (Math.abs(legYaw) > 1e-4) {
      _v4.copy(_Y).applyQuaternion(this.rootQ);
      rotateWorldAxis(this.hips, _v4, legYaw);
      this.hips.updateMatrixWorld(true);
    }

    if (cr > 0.002) this.applyCrouch(cr);
    this.applySpine(pitch, cr, aimW, alive, legYaw);
    if (aimW > 0) this.applyArms(pitch, aimW);
    if (aimW < 1) for (let i = this.armStart; i < this.ovBones.length; i++) this.ovBones[i].quaternion.slerp(this.ovSaved[i], 1 - aimW);
    this.updateSwing(dt);
  }

  /** Idle / Walk / Run 权重与步相位 */
  private locomotion(dt: number, s: number): void {
    const t1 = smooth(0.08, WALK_SPEED * 0.7, s);
    const t2 = clamp01((s - WALK_SPEED) / (RUN_SPEED - WALK_SPEED));
    const k = Math.min(1, dt * 8);
    this.wIdle += (1 - t1 - this.wIdle) * k;
    this.wWalk += (t1 * (1 - t2) - this.wWalk) * k;
    this.wRun += (t1 * t2 - this.wRun) * k;
    // 一个步态周期的地面距离（两步）
    const stride = WALK_SPEED * this.walkDur * (1 - t2) + RUN_SPEED * this.runDur * t2;
    this.phase = (this.phase + (dt * s * this.stepDir) / stride) % 1;
    if (this.phase < 0) this.phase += 1;
    this.idle.setEffectiveWeight(this.wIdle);
    this.walk.setEffectiveWeight(this.wWalk);
    this.runA.setEffectiveWeight(this.wRun);
    this.walk.time = this.phase * this.walkDur;
    this.runA.time = this.phase * this.runDur;
  }

  /** 下蹲：髋部下降，双腿 IK 保持脚掌位置与朝向 */
  private applyCrouch(cr: number): void {
    for (let i = 0; i < this.legs.length; i++) {
      const l = this.legs[i];
      wpos(l.foot, l.pos);
      wquat(l.foot, l.quat);
    }
    const hp = wpos(this.hips, _v1);
    // 髋部下降并略后坐
    _v2.set(0, -cr * CROUCH_DROP, 0.06 * cr).applyQuaternion(this.rootQ);
    hp.add(_v2);
    const parent = this.hips.parent;
    if (parent) parent.worldToLocal(hp);
    this.hips.position.copy(hp);
    this.hips.updateMatrixWorld(true);
    for (let i = 0; i < this.legs.length; i++) {
      const l = this.legs[i];
      // 下蹲时双脚略分开
      this.target.copy(l.pos).addScaledVector(this.right, l.side * 0.05 * cr);
      this.pole.set(l.side * 0.25, 0, -1).applyQuaternion(this.rootQ);
      twoBoneIK(l.up, l.low, l.foot, this.target, this.pole);
      setWorldQuat(l.foot, l.quat);
      l.foot.updateMatrixWorld(true);
    }
  }

  /** 脊柱/头部随俯仰；持枪时躯干略右转 */
  private applySpine(pitch: number, cr: number, aimW: number, alive: boolean, legYaw: number): void {
    const ax = this.right;
    const lean = -0.22 * cr;
    const p = pitch * aimW;
    const tw = this.hold.twist * aimW;
    const up = _v4.copy(_Y).applyQuaternion(this.rootQ);
    // 脊柱三节分担 60% 俯仰，颈 15%，头 25%
    for (let i = 0; i < 3; i++) {
      const b = this.spine[i];
      rotateWorldAxis(b, ax, p * 0.2 + lean / 3);
      rotateWorldAxis(b, up, -(tw + legYaw) / 3);
    }
    rotateWorldAxis(this.neck, ax, p * 0.15 - lean * 0.4);
    rotateWorldAxis(this.neck, up, tw * 0.5);
    rotateWorldAxis(this.head, ax, p * 0.25 - lean * 0.4);
    rotateWorldAxis(this.head, up, tw * 0.5);
    rotateWorldAxis(this.clavL, up, -this.hold.clav * aimW);
    if (!alive) {
      // 倒地：身体蜷曲、头后仰/前垂
      const d = this.deathT;
      const slump = smooth(0.0, 0.4, d);
      for (let i = 0; i < this.spine.length; i++) rotateWorldAxis(this.spine[i], ax, this.deathDir * -0.12 * slump);
      rotateWorldAxis(this.head, ax, this.deathDir * -0.35 * slump);
      rotateWorldAxis(this.spine[1], up, this.deathSide * 0.25 * slump);
    }
    this.hips.updateMatrixWorld(true);
  }

  /** 右手握枪对准视线，左手托枪 */
  private applyArms(pitch: number, aimW: number): void {
    const h = this.hold;
    // 瞄准方向：根朝向 + 俯仰
    this.aimQ.setFromAxisAngle(_X, pitch);
    this.aimQ.premultiply(this.rootQ);
    // 微小呼吸摆动
    const br = Math.sin(this.time * 1.6) * 0.004 * (1 - this.wRun);
    // 枪原点 = 颈部 + 偏移（瞄准坐标系）
    wpos(this.neck, this.gunPos);
    _v1.copy(h.off);
    _v1.y += br;
    this.gunPos.add(_v1.applyQuaternion(this.aimQ));

    // 右臂
    const R = this.armR;
    this.tmpQ.multiplyQuaternions(this.aimQ, this.kR);
    this.target.copy(this.wristR).applyQuaternion(this.aimQ).add(this.gunPos);
    this.pole.set(0.6, -1, 0.35).applyQuaternion(this.rootQ);
    twoBoneIK(R.upper, R.fore, R.hand, this.target, this.pole);
    this.setHand(R, this.tmpQ);

    // 左臂 → grip_l
    const L = this.armL;
    if (this.gunGripL) wpos(this.gunGripL, this.target);
    else this.target.copy(this.gunPos);
    this.tmpQ.multiplyQuaternions(this.aimQ, this.kL);
    _v1.copy(this.wristL).applyQuaternion(this.aimQ);
    this.target.add(_v1);
    this.pole.set(-0.7, -1, 0.1).applyQuaternion(this.rootQ);
    twoBoneIK(L.upper, L.fore, L.hand, this.target, this.pole);
    this.setHand(L, this.tmpQ);

    this.curl(R, h.curlR);
    this.curl(L, h.curlL);
  }

  /** 设置手的世界旋转，并把一部分绕前臂轴的扭转分给前臂，减少手腕“糖纸”扭曲 */
  private setHand(r: HandRig, q: THREE.Quaternion): void {
    // 手相对前臂的局部旋转
    wquat(r.fore, _q1);
    _q2.copy(_q1).invert().multiply(q);
    // 绕前臂骨轴（局部 Y）的扭转分量
    const twist = 2 * Math.atan2(_q2.y, _q2.w);
    _q3.setFromAxisAngle(_Y, twist * 0.55);
    r.fore.quaternion.multiply(_q3);
    r.fore.updateMatrixWorld(false);
    setWorldQuat(r.hand, q);
    r.hand.updateMatrixWorld(true);
  }

  private curl(r: HandRig, amt: number): void {
    for (let i = 0; i < r.fingers.length; i++) {
      const fg = r.fingers[i];
      const a = fg.thumb ? amt * 0.35 : amt;
      _q1.setFromAxisAngle(fg.axis, a);
      fg.bone.quaternion.copy(fg.bind).multiply(_q1);
    }
  }

  private startDeath(): void {
    this.deathT = 0;
    this.deathDir = Math.random() < 0.55 ? 1 : -1;
    this.deathSide = Math.random() * 2 - 1;
  }

  /** 倒地：整体绕脚底旋转（重力加速），落地小幅回弹 */
  private applyDeath(): void {
    const d = this.deathT;
    const f = smooth(0.08, 0.62, d);
    // 加速下落
    const fall = f * f;
    const bounce = Math.sin(Math.max(0, Math.min(1, (d - 0.62) / 0.25)) * Math.PI) * 0.06;
    const ang = (Math.PI / 2 - 0.06) * fall - bounce * fall;
    this.pivot.rotation.set(this.deathDir * ang, 0, this.deathSide * 0.18 * fall);
    // 躯干厚度：躺下后抬高，避免陷入地面；倒向一侧时略后移
    this.pivot.position.set(0, 0.11 * fall, this.deathDir * 0.18 * fall);
    // 数秒后下沉
    const sink = smooth(DEATH_HIDE - 1.2, DEATH_HIDE, d);
    this.pivot.position.y -= sink * 0.35;
  }

  private resetDeath(): void {
    this.deathT = -1;
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.position.set(0, 0, 0);
    this.mixer.timeScale = 1;
    this.speedS = 0;
    this.crouchS = 0;
    this.legYaw = 0;
    this.stepDir = 1;
  }

  /** 枪口世界坐标 */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    if (this.gunMuzzle) return this.gunMuzzle.getWorldPosition(out);
    return this.root.getWorldPosition(out).setY(out.y + 1.4);
  }

  /** 释放每个实例自己的资源（动画混合器、骨骼纹理）；共享的 GLB 几何/贴图与改色材质不释放 */
  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const sm of this.skinned) sm.skeleton.dispose();
    this.root.removeFromParent();
  }
}
