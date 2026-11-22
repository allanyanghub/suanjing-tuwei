/**
 * HDRI 天空（Poly Haven, CC0）：每个主题一张。
 * - 1k .hdr：预载时分析太阳方向 / 辐照度，把太阳从贴图中“抠掉”后用于 PMREM 环境光照（太阳改由平行光提供）。
 * - 4k 上半球 .jpg：可见天空背景（Reinhard 压缩编码，着色器中还原为线性 HDR）。
 */
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { ASSET_BASE, getCached, getTexture, loadCached, loadTexture, registerPreload } from '../assets.ts';

export type SkyMood = 'dawn' | 'day' | 'dusk' | 'night';

interface SkyDef {
  id: string;
  /** jpg 编码系数：x = L·k，y = x/(1+x) */
  k: number;
}

const SKIES: Record<SkyMood, SkyDef> = {
  dawn: { id: 'qwantani_morning_puresky', k: 0.44568 },
  day: { id: 'kloofendal_48d_partly_cloudy_puresky', k: 0.6411 },
  dusk: { id: 'evening_road_01_puresky', k: 0.24596 },
  night: { id: 'qwantani_moon_noon_puresky', k: 1.7866 },
};

export interface SkyInfo {
  mood: SkyMood;
  k: number;
  /** 去除太阳后的线性 HDR 等距柱状贴图（半浮点） */
  env: THREE.DataTexture;
  /** 可见天空 jpg */
  sky: THREE.Texture;
  /** HDR 坐标系中的太阳方向 */
  sunDir: THREE.Vector3;
  /** 太阳的辐照度（垂直于光线的平面，RGB） */
  sunE: THREE.Color;
  /** 天空（不含太阳）在水平面上的辐照度 */
  skyE: THREE.Color;
  /** 地平线附近平均辐亮度 */
  horizon: THREE.Color;
}

const hdrLoader = new HDRLoader().setDataType(THREE.FloatType);
const lum = (r: number, g: number, b: number) => r * 0.2126 + g * 0.7152 + b * 0.0722;

function analyze(mood: SkyMood, src: THREE.DataTexture, sky: THREE.Texture): SkyInfo {
  const img = src.image as { data: Float32Array; width: number; height: number };
  const { data, width: W, height: H } = img;
  // HDRLoader 设置了 flipY，但数据行顺序仍是文件顺序：第 0 行 = 天顶
  const elevOf = (y: number) => Math.PI / 2 - ((y + 0.5) / H) * Math.PI;
  const dirOf = (x: number, y: number, out: THREE.Vector3) => {
    const el = elevOf(y);
    const ph = ((x + 0.5) / W - 0.5) * Math.PI * 2;
    return out.set(Math.cos(el) * Math.cos(ph), Math.sin(el), Math.cos(el) * Math.sin(ph));
  };
  let peak = 0,
    pi = 0;
  const lums: number[] = [];
  for (let y = 0; y < H / 2; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const L = lum(data[i], data[i + 1], data[i + 2]);
      if (L > peak) {
        peak = L;
        pi = y * W + x;
      }
      if ((x & 3) === 0 && (y & 3) === 0) lums.push(L);
    }
  lums.sort((a, b) => a - b);
  const p90 = lums[Math.floor(lums.length * 0.9)];
  const sunDir = dirOf(pi % W, Math.floor(pi / W), new THREE.Vector3());
  const thr = Math.max(peak * 0.02, p90 * 6);
  const v = new THREE.Vector3();
  const cosR = Math.cos(THREE.MathUtils.degToRad(9));
  const cosRing = Math.cos(THREE.MathUtils.degToRad(12));
  // 先求太阳周围一圈的平均天空亮度
  const ring = [0, 0, 0];
  let rn = 0;
  for (let y = 0; y < H / 2; y++)
    for (let x = 0; x < W; x++) {
      const c = dirOf(x, y, v).dot(sunDir);
      if (c < cosRing || c > cosR) continue;
      const i = (y * W + x) * 4;
      if (lum(data[i], data[i + 1], data[i + 2]) > thr) continue;
      ring[0] += data[i];
      ring[1] += data[i + 1];
      ring[2] += data[i + 2];
      rn++;
    }
  if (rn) for (let c = 0; c < 3; c++) ring[c] /= rn;
  const ringL = Math.max(1e-6, lum(ring[0], ring[1], ring[2]));
  const sunE = new THREE.Color(0, 0, 0);
  const skyE = new THREE.Color(0, 0, 0);
  const hz = [0, 0, 0];
  let hn = 0;
  const dPh = (Math.PI * 2) / W,
    dTh = Math.PI / H;
  for (let y = 0; y < H; y++) {
    const el = elevOf(y);
    const dw = dPh * dTh * Math.cos(el);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (y < H / 2) {
        const c = dirOf(x, y, v).dot(sunDir);
        const L = lum(data[i], data[i + 1], data[i + 2]);
        if (c > cosR && L > Math.max(thr, ringL * 1.5)) {
          // 超出部分记为太阳辐照度，像素压回周围天空亮度
          const k = ringL / L;
          sunE.r += data[i] * (1 - k) * dw;
          sunE.g += data[i + 1] * (1 - k) * dw;
          sunE.b += data[i + 2] * (1 - k) * dw;
          data[i] *= k;
          data[i + 1] *= k;
          data[i + 2] *= k;
        }
        const s = Math.sin(el) * dw;
        skyE.r += data[i] * s;
        skyE.g += data[i + 1] * s;
        skyE.b += data[i + 2] * s;
        // 地平线平均色：避开太阳方位（否则黄昏的雾色会被太阳一侧冲白）
        const ph = ((x + 0.5) / W - 0.5) * Math.PI * 2;
        const dAz = Math.abs(Math.atan2(Math.sin(ph - Math.atan2(sunDir.z, sunDir.x)), Math.cos(ph - Math.atan2(sunDir.z, sunDir.x))));
        if (el < THREE.MathUtils.degToRad(5) && dAz > 1.2) {
          hz[0] += data[i];
          hz[1] += data[i + 1];
          hz[2] += data[i + 2];
          hn++;
        }
      }
    }
  }
  // 转半浮点，供 PMREM 渲染（WebGL2 下可线性过滤）
  const half = new Uint16Array(W * H * 4);
  for (let i = 0; i < W * H * 4; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(data[i], 60000));
  const env = new THREE.DataTexture(half, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  env.colorSpace = THREE.LinearSRGBColorSpace;
  env.magFilter = env.minFilter = THREE.LinearFilter;
  env.wrapS = THREE.RepeatWrapping;
  env.wrapT = THREE.ClampToEdgeWrapping;
  env.generateMipmaps = false;
  env.needsUpdate = true;
  src.dispose();
  sky.wrapS = THREE.RepeatWrapping;
  sky.wrapT = THREE.ClampToEdgeWrapping;
  sky.generateMipmaps = false;
  sky.minFilter = THREE.LinearFilter;
  sky.colorSpace = THREE.NoColorSpace;
  sky.needsUpdate = true;
  return {
    mood,
    k: SKIES[mood].k,
    env,
    sky,
    sunDir,
    sunE,
    skyE,
    horizon: new THREE.Color(hz[0] / hn, hz[1] / hn, hz[2] / hn),
  };
}

for (const mood of Object.keys(SKIES) as SkyMood[]) {
  const d = SKIES[mood];
  registerPreload(() =>
    loadCached(`sky:${mood}`, async () => {
      const [hdr, jpg] = await Promise.all([
        hdrLoader.loadAsync(`${ASSET_BASE}hdri/${d.id}_1k.hdr`),
        loadTexture(`hdri/${d.id}_sky.jpg`, { srgb: false, repeat: true, anisotropy: 1 }),
      ]);
      return analyze(mood, hdr, jpg);
    }),
  );
}

export function getSky(mood: SkyMood): SkyInfo {
  return getCached<SkyInfo>(`sky:${mood}`);
}

/** 可见天空 / 环境光共用的着色器 */
export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

export const SKY_FRAG = /* glsl */ `
uniform sampler2D tEnv;
uniform sampler2D tSky;
uniform float uMode;      // 0 = 环境（HDR 去太阳），1 = 可见背景（jpg）
uniform float uK;
uniform vec2 uRot;        // cos, sin（世界方向 → HDR 方向）
uniform float uScale;
uniform vec3 uTint;
uniform vec3 uFog;
uniform vec3 uGround;
uniform float uDesat;
uniform float uClampL;
varying vec3 vDir;
const float PI_ = 3.14159265;
void main() {
  vec3 d = normalize(vDir);
  vec3 h = vec3(d.x * uRot.x + d.z * uRot.y, d.y, -d.x * uRot.y + d.z * uRot.x);
  float u = atan(h.z, h.x) / (2.0 * PI_) + 0.5;
  float el = asin(clamp(h.y, -1.0, 1.0));
  vec3 col;
  if (uMode < 0.5) {
    col = textureLod(tEnv, vec2(u, 0.5 - el / PI_), 0.0).rgb;
    if (d.y < 0.0) col = mix(uFog / max(uScale, 1e-6), uGround, smoothstep(0.0, 0.25, -d.y));
  } else {
    float ve = clamp(el, radians(-11.0), radians(90.0));
    float v = 1.0 - (radians(90.0) - ve) / radians(101.25);
    vec3 y = pow(textureLod(tSky, vec2(u, v), 0.0).rgb, vec3(2.2));
    y = min(y, vec3(0.995));
    col = y / (1.0 - y) / uK;
  }
  col *= uScale;
  // 限制天空最高亮度，避免太阳周围泛光过曝
  float lm = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= min(1.0, uClampL / max(lm, 1e-5));
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 1.0 - uDesat) * uTint;
  if (uMode > 0.5) {
    // 地平线雾带，与场景雾色衔接
    float f = exp(-max(d.y, 0.0) * 28.0);
    col = mix(col, uFog, f * 0.55);
    if (d.y < 0.0) col = uFog;
  }
  gl_FragColor = vec4(col, 1.0);
}`;
