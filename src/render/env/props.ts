/**
 * 照片扫描道具（Poly Haven, CC0）：木箱堆（贴合碰撞盒的掩体）、壁灯、配电箱、路灯，
 * 以及程序化的树（照片扫描树皮 / 叶片贴图）。重复物件全部实例化。
 */
import * as THREE from 'three';
import { getGLB, getTexture, loadGLB, loadTexture, registerPreload } from '../assets.ts';
import type { Box } from '../../world/physics.ts';

export const PROP = {
  crate: 'props/wooden_crate_02.glb',
  lamp: 'props/industrial_wall_lamp.glb',
  powerBox: 'props/power_box_01.glb',
  streetLamp: 'props/street_lamp_01.glb',
} as const;
export type PropId = keyof typeof PROP;
const LEAF = 'props/island_tree_02_leaves_diff_512.jpg';
const BARK = 'props/island_tree_02_bark_diff_512.jpg';

registerPreload(() =>
  Promise.all([
    ...Object.values(PROP).map((p) => loadGLB(p)),
    loadTexture(LEAF, { srgb: true, repeat: false }),
    loadTexture(BARK, { srgb: true }),
  ]),
);

export interface PropPart {
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
  name: string;
}

const partCache = new Map<string, PropPart[]>();

/** 模型拆成（几何, 材质）列表，几何已烘焙节点变换。结果归缓存所有，不要释放。 */
export function propParts(id: PropId): PropPart[] {
  const hit = partCache.get(id);
  if (hit) return hit;
  const gltf = getGLB(PROP[id]);
  gltf.scene.updateMatrixWorld(true);
  const out: PropPart[] = [];
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geo = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
    geo.computeBoundingBox();
    const mat = o.material as THREE.MeshStandardMaterial;
    out.push({ geo, mat, name: mat.name });
  });
  partCache.set(id, out);
  return out;
}

export function propBounds(id: PropId): THREE.Box3 {
  const b = new THREE.Box3();
  for (const p of propParts(id)) b.union(p.geo.boundingBox!);
  return b;
}

export function leafPhoto(): HTMLImageElement {
  return getTexture(LEAF).image as HTMLImageElement;
}
export function barkTex(): THREE.Texture {
  return getTexture(BARK);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);

/** 生成木箱堆的实例矩阵：外轮廓与碰撞盒一致，逐层交错码放 */
export function crateStack(b: Box, high: boolean, rnd: () => number, out: { m: THREE.Matrix4; c: THREE.Color }[]): void {
  const cb = propBounds('crate');
  const size = cb.getSize(new THREE.Vector3());
  const lenX = b.x1 - b.x0,
    lenZ = b.z1 - b.z0;
  const H = b.y1 - b.y0;
  const layers = high ? 4 : 2;
  const lh = H / layers;
  const gap = 0.025;
  const longX = lenX >= lenZ;
  const tints = [new THREE.Color(0.92, 0.94, 0.96), new THREE.Color(0.8, 0.83, 0.86), new THREE.Color(0.9, 0.88, 0.86), new THREE.Color(0.7, 0.76, 0.7), new THREE.Color(0.76, 0.78, 0.82)];
  const stackTint = Math.floor(rnd() * tints.length);
  for (let L = 0; L < layers; L++) {
    // 偶数层沿长边，奇数层横放
    const alongX = L % 2 === 0 ? longX : !longX;
    const spanA = alongX ? lenX : lenZ; // 箱子长轴方向的总长
    const spanB = alongX ? lenZ : lenX;
    const nA = Math.max(1, Math.round(spanA / 1.0));
    const nB = Math.max(1, Math.round(spanB / 0.6));
    const ca = spanA / nA,
      cbw = spanB / nB;
    for (let i = 0; i < nA; i++)
      for (let j = 0; j < nB; j++) {
        const a0 = i * ca,
          b0 = j * cbw;
        // 外侧贴边，内侧留缝
        const ga0 = i === 0 ? 0.004 : gap / 2,
          ga1 = i === nA - 1 ? 0.004 : gap / 2;
        const gb0 = j === 0 ? 0.004 : gap / 2,
          gb1 = j === nB - 1 ? 0.004 : gap / 2;
        const lenA = ca - ga0 - ga1,
          lenB = cbw - gb0 - gb1;
        const midA = a0 + ga0 + lenA / 2,
          midB = b0 + gb0 + lenB / 2;
        const cx = alongX ? b.x0 + midA : b.x0 + midB;
        const cz = alongX ? b.z0 + midB : b.z0 + midA;
        const y0 = b.y0 + L * lh;
        const flip = rnd() > 0.5 ? Math.PI : 0;
        const yaw = (alongX ? Math.PI / 2 : 0) + flip + (L === layers - 1 ? 0 : (rnd() - 0.5) * 0.012);
        // 模型：长轴 = 本地 z，宽 = 本地 x
        _s.set(lenB / size.x, (lh - 0.006) / size.y, lenA / size.z);
        _q.setFromAxisAngle(_y, yaw);
        _t.set(cx, y0, cz);
        const m = new THREE.Matrix4().compose(_t, _q, _s);
        // 把模型底面中心移到原点
        m.multiply(_m.makeTranslation(-(cb.min.x + cb.max.x) / 2, -cb.min.y, -(cb.min.z + cb.max.z) / 2));
        const tint = rnd() < 0.75 ? tints[stackTint] : tints[Math.floor(rnd() * tints.length)];
        const c = tint.clone().multiplyScalar(0.9 + rnd() * 0.15);
        out.push({ m, c });
      }
  }
}

/** 一组实例化网格（每个模型部件一个），矩阵相同 */
export function instancedProp(id: PropId, mats: THREE.Matrix4[], colors?: THREE.Color[], override?: (p: PropPart) => THREE.Material | null): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  if (!mats.length) return out;
  for (const p of propParts(id)) {
    const mat = override?.(p) ?? p.mat;
    const im = new THREE.InstancedMesh(p.geo, mat, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    if (colors) colors.forEach((c, i) => im.setColorAt(i, c));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = true;
    im.receiveShadow = true;
    out.push(im);
  }
  return out;
}

// ============================================================ 程序化树
export interface TreeGeo {
  trunk: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
}

/** 一棵树：树干 + 分枝（圆柱）+ 叶片卡片（法线指向树冠中心外侧，获得柔和的体积光照） */
export function makeTree(seed: number): TreeGeo {
  let s = seed >>> 0;
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const trunkParts: THREE.BufferGeometry[] = [];
  const H = 4.2 + r() * 1.5;
  const cyl = (p0: THREE.Vector3, p1: THREE.Vector3, r0: number, r1: number) => {
    const len = p0.distanceTo(p1);
    const g = new THREE.CylinderGeometry(r1, r0, len, 7, 3, true);
    g.translate(0, len / 2, 0);
    const dir = p1.clone().sub(p0).normalize();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    g.translate(p0.x, p0.y, p0.z);
    // 树皮 UV：u 绕一圈 = 1，v 每 1.2m 一个单位
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) * len) / 1.2);
    trunkParts.push(g.toNonIndexed());
    g.dispose();
  };
  const base = new THREE.Vector3(0, 0, 0);
  const lean = new THREE.Vector3((r() - 0.5) * 0.5, H, (r() - 0.5) * 0.5);
  cyl(base, lean, 0.2, 0.12);
  const crowns: { c: THREE.Vector3; rad: number }[] = [{ c: lean.clone().add(new THREE.Vector3(0, 1.2, 0)), rad: 2.3 + r() * 0.6 }];
  const nb = 4 + Math.floor(r() * 3);
  for (let i = 0; i < nb; i++) {
    const t = 0.45 + r() * 0.45;
    const p0 = base.clone().lerp(lean, t);
    const a = (i / nb) * Math.PI * 2 + r() * 0.8;
    const len = 1.4 + r() * 1.4;
    const p1 = p0.clone().add(new THREE.Vector3(Math.cos(a) * len, 0.9 + r() * 1.3, Math.sin(a) * len));
    cyl(p0, p1, 0.08, 0.035);
    crowns.push({ c: p1.clone().add(new THREE.Vector3(0, 0.3, 0)), rad: 1.2 + r() * 0.7 });
  }
  const trunk = mergeNonIndexed(trunkParts);
  // 叶片卡片
  const pos: number[] = [],
    nor: number[] = [],
    uvs: number[] = [];
  const centre = new THREE.Vector3();
  for (const c of crowns) centre.add(c.c);
  centre.divideScalar(crowns.length);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const cr of crowns) {
    const n = Math.round(cr.rad * cr.rad * 9);
    for (let i = 0; i < n; i++) {
      // 均匀分布在球体内（偏向外壳）
      const u = r() * 2 - 1,
        th = r() * Math.PI * 2;
      const rr = cr.rad * Math.pow(0.35 + r() * 0.65, 0.5);
      const d = new THREE.Vector3(Math.sqrt(1 - u * u) * Math.cos(th), u * 0.75, Math.sqrt(1 - u * u) * Math.sin(th));
      const p = cr.c.clone().addScaledVector(d, rr);
      const size = 1.3 + r() * 0.8;
      e.set(r() * Math.PI, r() * Math.PI, r() * Math.PI);
      q.setFromEuler(e);
      const ax = new THREE.Vector3(size / 2, 0, 0).applyQuaternion(q);
      const ay = new THREE.Vector3(0, size / 2, 0).applyQuaternion(q);
      const corners = [
        p.clone().sub(ax).sub(ay),
        p.clone().add(ax).sub(ay),
        p.clone().add(ax).add(ay),
        p.clone().sub(ax).add(ay),
      ];
      const cuv = [0, 0, 1, 0, 1, 1, 0, 1];
      const order = [0, 1, 2, 0, 2, 3];
      for (const k of order) {
        const v = corners[k];
        pos.push(v.x, v.y, v.z);
        // 球形法线：混合树冠中心方向与局部团簇方向
        const nn = v.clone().sub(centre).normalize().multiplyScalar(0.6).add(v.clone().sub(cr.c).normalize().multiplyScalar(0.4)).normalize();
        nor.push(nn.x, nn.y, nn.z);
        uvs.push(cuv[k * 2], cuv[k * 2 + 1]);
      }
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  leaves.computeBoundingSphere();
  return { trunk, leaves };
}

function mergeNonIndexed(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'uv'] as const;
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = parts[0].getAttribute(n).itemSize;
    let len = 0;
    for (const p of parts) len += p.getAttribute(n).count * size;
    const arr = new Float32Array(len);
    let o = 0;
    for (const p of parts) {
      const a = p.getAttribute(n).array as Float32Array;
      arr.set(a, o);
      o += a.length;
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  for (const p of parts) p.dispose();
  out.computeBoundingSphere();
  return out;
}
