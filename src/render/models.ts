import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * 队伍配色视角。平时我方蓝、对方红；联机对战里本机在红队时 flip = true：
 * 按真实队伍上色（我方红、对方蓝），和大厅里的蓝队 / 红队一致。由 Match 开局时设置。
 */
export const teamView = { flip: false };
const TEAM_BLUE = 0x35d6ff;
const TEAM_RED = 0xff4d5e;
export const TEAM_COLORS = {
  get ally(): number {
    return teamView.flip ? TEAM_RED : TEAM_BLUE;
  },
  get enemy(): number {
    return teamView.flip ? TEAM_BLUE : TEAM_RED;
  },
};
/** 某个（本机视角的）队伍是不是显示成红色 */
export const showsRed = (localTeam: 0 | 1): boolean => (localTeam === 1) !== teamView.flip;

/* ============================================================================
 * 共享资源：几何体 / 材质 / 贴图全部按键缓存，所有实例共用，永不在 dispose 中释放
 * ========================================================================== */

type Slot = 'suit' | 'white' | 'agent' | 'dark' | 'mid' | 'glove' | 'glow' | 'aglow' | 'visor';

const matCache = new Map<string, THREE.Material>();
function cachedMat(key: string, make: () => THREE.Material): THREE.Material {
  let m = matCache.get(key);
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

interface Palette {
  team: number;
  agent: number;
  enemy: boolean;
  /** 角色描边：材质掠射角叠加队伍色辉光，远距离也能分辨敌我 */
  rim?: boolean;
}

/** 饱和后的队伍发光色（ACES 色调映射会冲淡原色） */
const teamEmissive = (p: Palette) => (p.enemy ? 0xff2438 : 0x1fc4ff);

function std(p: Palette, key: string, params: THREE.MeshStandardMaterialParameters, rimK: number): THREE.Material {
  const rim = p.rim && rimK > 0;
  return cachedMat(`${key}:${rim ? `rim${p.enemy}` : ''}`, () => {
    const m = new THREE.MeshStandardMaterial(params);
    if (rim) {
      const col = new THREE.Color(teamEmissive(p));
      const k = rimK * (p.enemy ? 0.75 : 0.7);
      m.onBeforeCompile = (sh) => {
        sh.uniforms.rimColor = { value: col.clone().multiplyScalar(k) };
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;')
          .replace(
            '#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\n{ float fr = 1.0 - saturate(dot(normal, normalize(vViewPosition))); totalEmissiveRadiance += rimColor * fr * fr * fr; }',
          );
      };
      m.customProgramCacheKey = () => 'rim';
    }
    return m;
  });
}

function slotMat(slot: Slot, p: Palette): THREE.Material {
  switch (slot) {
    case 'suit':
      return std(p, `suit:${p.enemy}`, { color: p.enemy ? 0x2b1d26 : 0x1b2433, roughness: 0.8, metalness: 0.12 }, 0.75);
    case 'white':
      return std(p, `white:${p.enemy}`, { color: p.enemy ? 0xdcd3d3 : 0xd6dde6, roughness: 0.34, metalness: 0.04 }, 0.6);
    case 'agent':
      return std(p, `agent:${p.agent}`, { color: p.agent, roughness: 0.42, metalness: 0.12 }, 0.6);
    case 'dark':
      return std(p, 'dark', { color: 0x2f3542, roughness: 0.5, metalness: 0.18 }, 0.75);
    case 'glove':
      return std(p, 'glove', { color: 0x4a5262, roughness: 0.72, metalness: 0.05 }, 0);
    case 'mid':
      return std(p, 'mid', { color: 0x5a6372, roughness: 0.42, metalness: 0.3 }, 0.6);
    case 'glow':
      return cachedMat(`glow:${p.enemy}`, () =>
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(teamEmissive(p)).multiplyScalar(0.3),
          emissive: teamEmissive(p),
          emissiveIntensity: p.enemy ? 2.2 : 1.6,
          roughness: 0.4,
        }),
      );
    case 'aglow':
      return cachedMat(`aglow:${p.agent}`, () =>
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(p.agent).multiplyScalar(0.4),
          emissive: p.agent,
          emissiveIntensity: 1.25,
          roughness: 0.4,
        }),
      );
    case 'visor':
      return cachedMat(`visor:${p.enemy}`, () =>
        new THREE.MeshStandardMaterial({
          color: 0x0b0e14,
          emissive: teamEmissive(p),
          emissiveIntensity: p.enemy ? 1.05 : 0.8,
          roughness: 0.12,
          metalness: 0.4,
        }),
      );
  }
}

/* ---- 几何体工具 ---- */

const geoCache = new Map<string, THREE.BufferGeometry>();
function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** 圆角盒 */
function rbox(w: number, h: number, d: number, r = 0.012, seg = 1): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  return cachedGeo(`rb:${w}:${h}:${d}:${rr}:${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, rr));
}

/* ---- 画布贴图 ---- */

let glyphTex: THREE.CanvasTexture | null = null;
function getGlyphTex(): THREE.CanvasTexture {
  if (glyphTex) return glyphTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#000';
  x.fillRect(0, 0, 512, 64);
  x.fillStyle = '#fff';
  x.font = 'bold 40px serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const glyphs = ['∑', 'π', '∞', '√', 'Δ', 'φ', '∫', 'e'];
  glyphs.forEach((t, i) => x.fillText(t, 32 + i * 64, 34));
  x.fillRect(0, 2, 512, 3);
  x.fillRect(0, 59, 512, 3);
  glyphTex = new THREE.CanvasTexture(c);
  glyphTex.colorSpace = THREE.SRGBColorSpace;
  glyphTex.wrapS = THREE.RepeatWrapping;
  return glyphTex;
}

/* ============================================================================
 * 角色与武器：角色为 character.ts 的蒙皮模型；第一人称 / 第三人称枪在 weapons.ts
 * ========================================================================== */

export { CharacterModel } from './character.ts';
export { ViewModel } from './weapons.ts';

/* ============================================================================
 * 熵核
 * ========================================================================== */

export function buildSpike(color: number): { group: THREE.Group; core: THREE.Mesh; ring: THREE.Mesh; light: THREE.PointLight } {
  const group = new THREE.Group();
  const pal: Palette = { team: color, agent: color, enemy: true };
  const glowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.4),
    emissive: color,
    emissiveIntensity: 1.8,
    roughness: 0.3,
  });
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, rz);
    o.castShadow = m !== glowMat;
    group.add(o);
    return o;
  };
  const dark = slotMat('dark', pal);
  const white = slotMat('white', { team: color, agent: color, enemy: false });
  // 底座：双层六角台
  add(new THREE.CylinderGeometry(0.27, 0.31, 0.06, 6), dark, 0, 0.03, 0);
  add(new THREE.CylinderGeometry(0.23, 0.26, 0.07, 6), white, 0, 0.095, 0);
  add(new THREE.CylinderGeometry(0.235, 0.235, 0.012, 6), glowMat, 0, 0.066, 0);
  // 公式环带
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.205, 0.215, 0.05, 32, 1, true),
    new THREE.MeshBasicMaterial({ map: getGlyphTex(), color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  band.position.y = 0.155;
  group.add(band);
  add(new THREE.CylinderGeometry(0.19, 0.2, 0.06, 6), dark, 0, 0.155, 0);
  // 三根支架 + 顶盖
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 0.2,
      z = Math.sin(a) * 0.2;
    add(new RoundedBoxGeometry(0.05, 0.5, 0.05, 2, 0.015), white, x, 0.4, z, 0, -a, 0);
    add(new RoundedBoxGeometry(0.02, 0.32, 0.055, 1, 0.006), glowMat, x * 1.12, 0.4, z * 1.12, 0, -a, 0);
    add(new RoundedBoxGeometry(0.09, 0.05, 0.11, 2, 0.015), dark, x * 1.05, 0.2, z * 1.05, 0, -a, 0);
  }
  add(new THREE.CylinderGeometry(0.22, 0.24, 0.05, 6), white, 0, 0.66, 0);
  add(new THREE.CylinderGeometry(0.1, 0.16, 0.04, 6), dark, 0, 0.7, 0);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 8), glowMat, 0, 0.75, 0);
  // 能量核
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x401410,
    emissive: new THREE.Color(color).lerp(new THREE.Color(0xffe0c0), 0.12),
    emissiveIntensity: 1.5,
    roughness: 0.2,
    flatShading: true,
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.085, 0), coreMat);
  core.position.y = 0.42;
  core.scale.set(1, 1.35, 1);
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.115, 0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.3), wireframe: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  core.add(shell);
  group.add(core);
  // 刻度环
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.006, 6, 48), glowMat);
  ring.position.y = 0.42;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tick = new THREE.Mesh(rbox(i % 3 ? 0.01 : 0.018, 0.026, 0.01, 0.003), i % 3 ? dark : white);
    tick.position.set(Math.cos(a) * 0.155, Math.sin(a) * 0.155, 0);
    tick.rotation.z = a;
    ring.add(tick);
  }
  group.add(ring);
  const light = new THREE.PointLight(color, 4, 9, 1.6);
  light.position.y = 0.6;
  group.add(light);
  return { group, core, ring, light };
}
