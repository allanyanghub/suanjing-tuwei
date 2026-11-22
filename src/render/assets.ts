/**
 * 素材加载与缓存。
 * 所有外部素材（GLB 模型、贴图、HDR 天空）都放在 public/assets/ 下，通过这里加载。
 * 约定：各模块在文件顶层用 registerPreload() 登记自己需要的素材；main.ts 在进入菜单前调用
 * preloadAssets() 全部加载完。之后场景、角色、武器的构造函数里用 getXxx() 同步取用（未预载会抛错）。
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

export const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

const cache = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();
const preloaders: (() => Promise<unknown>)[] = [];

/** 通用：按 key 加载一次并缓存 */
export function loadCached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return Promise.resolve(cache.get(key) as T);
  let p = pending.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load().then((v) => {
      cache.set(key, v);
      pending.delete(key);
      return v;
    });
    pending.set(key, p);
  }
  return p;
}

/** 同步取已预载的素材；没有预载时抛错，便于尽早发现漏登记 */
export function getCached<T>(key: string): T {
  if (!cache.has(key)) throw new Error(`素材尚未预载：${key}`);
  return cache.get(key) as T;
}

export function hasCached(key: string): boolean {
  return cache.has(key);
}

/** path 相对于 public/assets/，例如 'weapons/rifle.glb' */
export function loadGLB(path: string): Promise<GLTF> {
  return loadCached(`glb:${path}`, () => gltfLoader.loadAsync(ASSET_BASE + path));
}

export function getGLB(path: string): GLTF {
  return getCached<GLTF>(`glb:${path}`);
}

export interface TexOpts {
  /** 颜色贴图（albedo / emissive）传 true；法线、粗糙度、AO 等数据贴图传 false */
  srgb: boolean;
  repeat?: boolean;
  anisotropy?: number;
}

export function loadTexture(path: string, opts: TexOpts): Promise<THREE.Texture> {
  return loadCached(`tex:${path}`, async () => {
    const t = await texLoader.loadAsync(ASSET_BASE + path);
    t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = opts.anisotropy ?? 8;
    return t;
  });
}

export function getTexture(path: string): THREE.Texture {
  return getCached<THREE.Texture>(`tex:${path}`);
}

/** 登记一个预载任务（在模块顶层调用） */
export function registerPreload(fn: () => Promise<unknown>): void {
  preloaders.push(fn);
}

let preloadPromise: Promise<void> | null = null;

/** 执行所有已登记的预载任务。onProgress(done, total) 用于进度条。可重复调用，只执行一次。 */
export function preloadAssets(onProgress?: (done: number, total: number) => void): Promise<void> {
  if (!preloadPromise) {
    const total = preloaders.length;
    let done = 0;
    onProgress?.(0, total);
    preloadPromise = Promise.all(
      preloaders.map((fn) =>
        fn().then(() => {
          done++;
          onProgress?.(done, total);
        }),
      ),
    ).then(() => undefined);
  }
  return preloadPromise;
}
