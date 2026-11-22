/**
 * 照片扫描 PBR 材质（Poly Haven, CC0）与环境材质的着色器扩展：
 * 世界坐标宏观变化（消除重复）、墙脚污渍 / 阴角 AO / 檐下雨痕、分区色油漆带、
 * 地面双材质混合 + 油漆标线、建筑立面程序化窗户。
 */
import * as THREE from 'three';
import { getTexture, loadTexture, registerPreload } from '../assets.ts';

/** 贴图集 id → Poly Haven 资源 id（每张贴图 2m×2m，1k 分辨率） */
const SETS = {
  plaster: 'painted_plaster_wall',
  brick: 'brick_wall_09',
  concrete: 'concrete_wall_008',
  granite: 'granite_tile_04',
  brushed: 'brushed_concrete_03',
  grass: 'leafy_grass',
  shutter: 'painted_metal_shutter',
  plywood: 'plywood',
} as const;
export type SetId = keyof typeof SETS;
type MapKind = 'diff' | 'nor' | 'arm';

/** 各贴图一个重复单元对应的米数 */
export const SET_SIZE: Record<SetId, number> = { plaster: 2, brick: 2.01, concrete: 2.71, granite: 2, brushed: 2, grass: 2, shutter: 2, plywood: 1 };

const texPath = (set: SetId, k: MapKind) => `textures/${SETS[set]}/${SETS[set]}_${k}_1k.jpg`;

registerPreload(() =>
  Promise.all(
    (Object.keys(SETS) as SetId[]).flatMap((s) => [
      loadTexture(texPath(s, 'diff'), { srgb: true, anisotropy: 8 }),
      loadTexture(texPath(s, 'nor'), { srgb: false, anisotropy: 8 }),
      loadTexture(texPath(s, 'arm'), { srgb: false, anisotropy: 8 }),
    ]),
  ),
);

export function setTex(set: SetId, k: MapKind): THREE.Texture {
  return getTexture(texPath(set, k));
}

export type EnvKind = 'plain' | 'wall' | 'floor' | 'facade' | 'decal' | 'ground';

export interface EnvMatOpts {
  set?: SetId;
  kind?: EnvKind;
  color?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  /** 宏观明暗变化强度 */
  macro?: number;
  /** 使用 arm 的 B 通道作为金属度 */
  metalMap?: boolean;
  vertexColors?: boolean;
  side?: THREE.Side;
  extraUniforms?: Record<string, THREE.IUniform>;
}

const NOISE = /* glsl */ `
float envHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float envNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(envHash(i), envHash(i + vec2(1.0, 0.0)), u.x), mix(envHash(i + vec2(0.0, 1.0)), envHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float envFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * envNoise(p); p = p * 2.07 + vec2(13.1, 7.7); a *= 0.5; } return s; }
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vWPos;
uniform float uMacro;
uniform float uNight;
${NOISE}
vec3 gEnvTint = vec3(1.0);
float gRoughAdd = 0.0;
float gRoughSet = -1.0;
float gMetalSet = -1.0;
float gFlatN = 0.0;
vec3 gEmit = vec3(0.0);
vec2 envP() { return vWPos.xz + vWPos.yy * vec2(0.71, 0.37); }
#ifdef ENV_WALL
varying vec4 vAux;
varying vec3 vZone;
#endif
#ifdef ENV_FLOOR
uniform sampler2D tBDiff; uniform sampler2D tBNor; uniform sampler2D tBArm;
uniform sampler2D tMask; uniform sampler2D tPaint;
uniform vec4 uRect;
uniform float uBScale;
vec4 gMask = vec4(0.0);
vec4 gPaint = vec4(0.0);
#endif
#ifdef ENV_FACADE
varying vec4 vFac;
uniform vec4 uWin;   // 开间宽, 层高, 窗宽, 窗高
uniform vec4 uWin2;  // 窗台高, 底层高度, 亮灯比例, 窗内色调
float gWinMode = 0.0;
vec3 gWinCol = vec3(0.0);
#endif

#ifdef USE_MAP
float envDecalWear() {
  vec2 p = envP();
  return smoothstep(0.28, 0.5, envFbm(p * 2.3) * 0.8 + envNoise(p * 37.0) * 0.35 + 0.1);
}
vec4 envAlbedo(vec2 uv) {
  vec4 c = texture2D(map, uv);
#ifdef ENV_DETAIL
  // 同一贴图旋转缩放后再采样一次，按低频噪声混合，打散重复感
  vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.61 + vec2(0.37, 0.11);
  vec4 c2 = texture2D(map, uv2);
  float b = smoothstep(0.3, 0.7, envNoise(envP() * 0.21 + 3.0));
  c.rgb = mix(c.rgb, c2.rgb * (dot(c.rgb, vec3(0.333)) / max(0.02, dot(c2.rgb, vec3(0.333)))), b * 0.55);
#endif
#ifdef ENV_FLOOR
  c = mix(c, texture2D(tBDiff, uv * uBScale), gMask.r);
#endif
  return c;
}
#endif
#ifdef USE_NORMALMAP
vec4 envNormal(vec2 uv) {
  vec4 n = texture2D(normalMap, uv);
#ifdef ENV_FLOOR
  n = mix(n, texture2D(tBNor, uv * uBScale), gMask.r);
  n = mix(n, vec4(0.5, 0.5, 1.0, 1.0), gPaint.a * 0.55);
#endif
  return mix(n, vec4(0.5, 0.5, 1.0, 1.0), gFlatN);
}
#endif
#ifdef USE_ROUGHNESSMAP
vec4 envArm(vec2 uv) {
  vec4 a = texture2D(roughnessMap, uv);
#ifdef ENV_FLOOR
  a = mix(a, texture2D(tBArm, uv * uBScale), gMask.r);
#endif
  return a;
}
#endif
#ifdef USE_AOMAP
vec4 envAo(vec2 uv) {
  vec4 a = texture2D(aoMap, uv);
#ifdef ENV_FLOOR
  a = mix(a, texture2D(tBArm, uv * uBScale), gMask.r);
#endif
  return mix(a, vec4(1.0), gFlatN);
}
#endif

void envPrepare() {
  vec2 p = envP();
#ifdef ENV_FLOOR
  vec2 muv = (vWPos.xz - uRect.xy) / uRect.zw;
  gMask = texture2D(tMask, muv);
  gPaint = texture2D(tPaint, muv);
  // 油漆磨损：低频斑驳 + 高频颗粒
  float w = envFbm(vWPos.xz * 1.7) * 0.75 + envNoise(vWPos.xz * 23.0) * 0.35;
  gPaint.a *= smoothstep(0.32, 0.5, w + gPaint.a * 0.08);
#endif
#ifdef ENV_FACADE
  // 立面窗格：vFac.xy = 立面坐标（米），vFac.z = 可布置窗的长度，vFac.w = 立面高度
  vec2 f = vFac.xy;
  float bay = uWin.x, fl = uWin.y;
  float bx = mod(f.x, bay) - bay * 0.5;
  float fy = f.y - uWin2.y;
  float level = floor(fy / fl);
  float ly = fy - level * fl;
  float hw = uWin.z * 0.5;
  float wy0 = uWin2.x, wy1 = uWin2.x + uWin.w;
  float inRange = step(0.0, f.x) * step(f.x, vFac.z) * step(0.0, fy) * step(level * fl + wy1, vFac.w - uWin2.y - 0.6);
  float inside = step(abs(bx), hw) * step(wy0, ly) * step(ly, wy1) * inRange;
  if (inside > 0.5) {
    vec2 wid = vec2(floor(f.x / bay), level) + floor(vWPos.xz * 0.1) * 3.1;
    float h = envHash(wid);
    float fx = hw - abs(bx), fyy = min(ly - wy0, wy1 - ly);
    float mull = step(abs(bx), 0.035) + step(abs(ly - (wy0 + uWin.w * 0.68)), 0.03);
    float frame = step(min(fx, fyy), 0.07) + mull;
    float lit = step(1.0 - uWin2.z, h);
    float blind = wy1 - (0.15 + fract(h * 7.3) * 1.1);
    float down = step(blind, ly);
    gWinMode = frame > 0.5 ? 1.0 : 2.0;
    gWinCol = mix(vec3(0.012, 0.014, 0.017), vec3(0.16, 0.15, 0.13), down * 0.8);
    if (gWinMode > 1.5) {
      gRoughSet = 0.05; gMetalSet = 0.0;
      vec3 lc = mix(vec3(1.0, 0.7, 0.4), vec3(0.8, 0.88, 1.0), step(0.75, fract(h * 13.1)));
      gEmit = lit * uNight * lc * (down * 0.7 + 0.3) * uWin2.w;
    } else {
      gRoughSet = 0.4; gMetalSet = 0.7;
    }
    gFlatN = 1.0;
  } else {
    float near = step(abs(bx), hw + 0.14) * inRange;
    float sill = near * step(wy0 - 0.09, ly) * step(ly, wy0);
    float lint = near * step(wy1, ly) * step(ly, wy1 + 0.22);
    gEnvTint = vec3(1.0 - lint * 0.3 + sill * 0.2);
  }
#endif
}

vec3 envMacro(vec3 col) {
  vec2 p = envP();
  float n1 = envFbm(p * 0.11);
  float n2 = envNoise(p * 0.83 + 7.0);
  col *= 1.0 + (n1 - 0.5) * uMacro * 1.3 + (n2 - 0.5) * uMacro * 0.4;
  col *= mix(vec3(1.025, 1.0, 0.97), vec3(0.975, 1.0, 1.03), n1);
#ifdef ENV_WALL
  float h = vWPos.y;
  float s = vWPos.x + vWPos.z;
  // 墙脚溅污
  float base = (1.0 - smoothstep(0.0, 1.0 + n2 * 0.7, h)) * (0.5 + 0.5 * envNoise(vec2(s * 1.3, h * 2.0)));
  col *= 1.0 - base * 0.42;
  gRoughAdd += base * 0.05;
  // 阴角 AO（vAux.xy = 到两端阴角的距离）
  float cd = min(vAux.x, vAux.y);
  col *= 1.0 - (1.0 - smoothstep(0.0, 0.8, cd)) * 0.28;
  // 檐下雨痕：垂直条纹，从压顶往下长度随机
  float lane = envNoise(vec2(s * 2.3, 0.5));
  float len = 0.6 + 2.6 * envNoise(vec2(s * 0.7, 4.0));
  float top = 4.85;
  float streak = smoothstep(0.5, 0.85, lane) * smoothstep(top - len, top - 0.1, h) * step(h, top + 0.02);
  streak *= 0.6 + 0.4 * envNoise(vec2(s * 9.0, h * 0.8));
  col *= 1.0 - streak * 0.38;
  // 分区色油漆带（墙裙）
  if (vAux.z > 0.5) {
    float band = step(0.95, h) * step(h, 1.3);
    float wear = smoothstep(0.3, 0.48, envFbm(vec2(s, h) * 3.1) * 0.8 + envNoise(vec2(s, h) * 31.0) * 0.3);
    float line = step(1.3, h) * step(h, 1.36);
    float m = max(band * wear, line * wear);
    col = mix(col, vZone * mix(0.85, 1.0, n2), m);
    gRoughAdd -= m * 0.25;
  }
#endif
#ifdef ENV_FLOOR
  // 墙根积尘、接缝污渍
  col *= 1.0 - gMask.g * 0.38;
  col = mix(col, gPaint.rgb, gPaint.a);
  gRoughAdd += gMask.g * 0.08 - gPaint.a * 0.2;
#endif
#ifdef ENV_FACADE
  if (gWinMode > 1.5) col = gWinCol;
  else if (gWinMode > 0.5) col = vec3(0.3, 0.31, 0.32);
  else col *= gEnvTint;
#endif
  return col;
}
`;

const VERT_PARS = /* glsl */ `
varying vec3 vWPos;
#ifdef ENV_WALL
attribute vec4 aux;
attribute vec3 aZone;
varying vec4 vAux;
varying vec3 vZone;
#endif
#ifdef ENV_FACADE
attribute vec4 aFac;
varying vec4 vFac;
#endif
`;

const VERT_MAIN = /* glsl */ `
{
  vec4 wp_ = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  wp_ = instanceMatrix * wp_;
#endif
  vWPos = (modelMatrix * wp_).xyz;
#ifdef ENV_WALL
  vAux = aux; vZone = aZone;
#endif
#ifdef ENV_FACADE
  vFac = aFac;
#endif
}
`;

/** 所有环境材质共享的 uniform（夜晚系数等） */
export const envShared = {
  uNight: { value: 0 },
};

/** 创建带环境扩展的 MeshStandardMaterial */
export function envMaterial(o: EnvMatOpts, detail: boolean): THREE.MeshStandardMaterial {
  const kind = o.kind ?? 'plain';
  const m = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? 0,
    vertexColors: o.vertexColors ?? false,
    side: o.side ?? THREE.FrontSide,
  });
  if (o.set) {
    m.map = setTex(o.set, 'diff');
    m.normalMap = setTex(o.set, 'nor');
    m.normalScale.setScalar(o.normalScale ?? 1);
    m.roughnessMap = setTex(o.set, 'arm');
    m.aoMap = setTex(o.set, 'arm');
    m.aoMapIntensity = 1;
    if (o.metalMap) m.metalnessMap = setTex(o.set, 'arm');
  }
  m.defines = m.defines ?? {};
  m.defines[`ENV_${kind.toUpperCase()}`] = '';
  if (detail && o.set) m.defines.ENV_DETAIL = '';
  const uniforms: Record<string, THREE.IUniform> = { uMacro: { value: o.macro ?? 0.25 }, uNight: envShared.uNight, ...(o.extraUniforms ?? {}) };
  m.userData.envKind = kind;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${VERT_PARS}`).replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    let f = sh.fragmentShader.replace('void main() {', `${FRAG_PARS}\nvoid main() {`);
    f = f.replace(
      '#include <map_fragment>',
      `envPrepare();\n` + THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'envAlbedo( vMapUv )') + `\ndiffuseColor.rgb = envMacro(diffuseColor.rgb);\n#ifdef ENV_DECAL\ndiffuseColor.a *= envDecalWear();\n#endif`,
    );
    f = f.replace(
      '#include <roughnessmap_fragment>',
      THREE.ShaderChunk.roughnessmap_fragment.replace('texture2D( roughnessMap, vRoughnessMapUv )', 'envArm( vRoughnessMapUv )') +
        `\nroughnessFactor = clamp(roughnessFactor + gRoughAdd, 0.04, 1.0);\nif (gRoughSet >= 0.0) roughnessFactor = gRoughSet;`,
    );
    f = f.replace('#include <metalnessmap_fragment>', THREE.ShaderChunk.metalnessmap_fragment + `\nif (gMetalSet >= 0.0) metalnessFactor = gMetalSet;`);
    f = f.replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('texture2D( normalMap, vNormalMapUv )', 'envNormal( vNormalMapUv )'));
    f = f.replace('#include <aomap_fragment>', THREE.ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv )', 'envAo( vAoMapUv )'));
    f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;`);
    sh.fragmentShader = f;
  };
  m.customProgramCacheKey = () => `env:${kind}:${detail && o.set ? 1 : 0}:${m.map ? 1 : 0}`;
  return m;
}

/** 切换画质时改变细节混合宏 */
export function setEnvDetail(m: THREE.Material, on: boolean): void {
  const d = m.defines ?? (m.defines = {});
  const has = 'ENV_DETAIL' in d;
  if (has === on || !(m instanceof THREE.MeshStandardMaterial) || !m.map) return;
  if (on) d.ENV_DETAIL = '';
  else delete d.ENV_DETAIL;
  const kind = String(m.userData.envKind ?? 'plain');
  m.customProgramCacheKey = () => `env:${kind}:${on ? 1 : 0}:1`;
  m.needsUpdate = true;
}
