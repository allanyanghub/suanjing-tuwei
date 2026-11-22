/**
 * 合并几何体构建器：世界坐标 UV、顶点色与一组可选的自定义顶点属性（aux / aZone），
 * 让整片墙体、线脚、地面等合并成少量 draw call。
 */
import * as THREE from 'three';

export type V3 = [number, number, number];
export type UV4 = [number, number, number, number, number, number, number, number];

export const WHITE = new THREE.Color(1, 1, 1);
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  auxA: number[] = [];
  idx: number[] = [];
  /** 之后写入的顶点使用的 aux 值 */
  aux: [number, number, number, number] = [0, 0, 0, 0];
  /** 可选：按顶点位置计算 aux（覆盖 aux），例如墙面到阴角的距离 */
  auxFn: ((x: number, y: number, z: number) => [number, number, number, number]) | null = null;

  get count(): number {
    return this.pos.length / 3;
  }

  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: THREE.Color): void {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    const a = this.auxFn ? this.auxFn(x, y, z) : this.aux;
    this.auxA.push(a[0], a[1], a[2], a[3]);
  }

  /** 四边形 a b c d（左下 右下 右上 左上），朝向不对时自动翻转 */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, uvs: UV4, col: THREE.Color = WHITE): void {
    const e1x = b[0] - a[0],
      e1y = b[1] - a[1],
      e1z = b[2] - a[2];
    const e2x = d[0] - a[0],
      e2y = d[1] - a[1],
      e2z = d[2] - a[2];
    const cx = e1y * e2z - e1z * e2y,
      cy = e1z * e2x - e1x * e2z,
      cz = e1x * e2y - e1y * e2x;
    const i = this.count;
    this.vert(a[0], a[1], a[2], n[0], n[1], n[2], uvs[0], uvs[1], col);
    this.vert(b[0], b[1], b[2], n[0], n[1], n[2], uvs[2], uvs[3], col);
    this.vert(c[0], c[1], c[2], n[0], n[1], n[2], uvs[4], uvs[5], col);
    this.vert(d[0], d[1], d[2], n[0], n[1], n[2], uvs[6], uvs[7], col);
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    else this.idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }

  /** 轴对齐盒子，平面投影世界 UV（s 米一个单位）。skip 位: 1 -x, 2 +x, 4 -y, 8 +y, 16 -z, 32 +z */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: THREE.Color = WHITE, s = 1, skip = 4): void {
    if (!(skip & 32))
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [x0 / s, y0 / s, x1 / s, y0 / s, x1 / s, y1 / s, x0 / s, y1 / s], col);
    if (!(skip & 16))
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [-x1 / s, y0 / s, -x0 / s, y0 / s, -x0 / s, y1 / s, -x1 / s, y1 / s], col);
    if (!(skip & 2))
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [-z1 / s, y0 / s, -z0 / s, y0 / s, -z0 / s, y1 / s, -z1 / s, y1 / s], col);
    if (!(skip & 1))
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [z0 / s, y0 / s, z1 / s, y0 / s, z1 / s, y1 / s, z0 / s, y1 / s], col);
    if (!(skip & 8))
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [x0 / s, -z1 / s, x1 / s, -z1 / s, x1 / s, -z0 / s, x0 / s, -z0 / s], col);
    if (!(skip & 4))
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [x0 / s, z0 / s, x1 / s, z0 / s, x1 / s, z1 / s, x0 / s, z1 / s], col);
  }

  /** 把任意几何体变换后并入。uvMode: keep 原 UV×缩放；planar 世界平面投影（us 米一个单位）；cyl 原 u×us、v=世界 y/vs */
  addGeo(geo: THREE.BufferGeometry, m: THREE.Matrix4, col: THREE.Color = WHITE, uvMode: 'keep' | 'planar' | 'cyl' = 'keep', us = 1, vs = 1): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const U = g.getAttribute('uv');
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const base = this.count;
    for (let i = 0; i < P.count; i++) {
      _p.fromBufferAttribute(P, i).applyMatrix4(m);
      _n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      let u = U ? U.getX(i) : 0,
        v = U ? U.getY(i) : 0;
      if (uvMode === 'keep') {
        u *= us;
        v *= vs;
      } else if (uvMode === 'cyl') {
        u *= us;
        v = _p.y / vs;
      } else {
        const ax = Math.abs(_n.x),
          ay = Math.abs(_n.y),
          az = Math.abs(_n.z);
        if (ay >= ax && ay >= az) {
          u = _p.x / us;
          v = _p.z / us;
        } else if (ax >= az) {
          u = _p.z / us;
          v = _p.y / us;
        } else {
          u = _p.x / us;
          v = _p.y / us;
        }
      }
      this.vert(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, u, v, col);
      this.idx.push(base + i);
    }
    if (g !== geo) g.dispose();
  }

  /** withAux: 输出 aux(vec4) 与 aZone(vec3, 来自顶点色) 属性，而不是 color */
  build(withAux = false): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (withAux) {
      g.setAttribute('aux', new THREE.Float32BufferAttribute(this.auxA, 4));
      g.setAttribute('aZone', new THREE.Float32BufferAttribute(this.col, 3));
    } else g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** 可复现的伪随机 */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function hash2(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
