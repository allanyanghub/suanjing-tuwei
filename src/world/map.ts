import type { Box } from './physics.ts';
import { rayBoxes } from './physics.ts';
import { LAYOUTS, layoutById, type LayoutDef } from './layouts.ts';

/**
 * 原创地图「双塔书院」。每格 2m×2m。北(上)为防守方出生区，南(下)为进攻方出生区。
 * # 高墙  . 地面  c 矮箱(可跳上)  C 高箱  A/B 目标区  a 进攻出生  d 防守出生
 */
/** 当前地图的格子布局。同一时刻只有一张地图在使用，构造 GameMap 时切换。所有布局尺寸相同（32×34）。 */
let LAYOUT: readonly string[] = LAYOUTS[0].rows;

export const CELL = 2;
export const COLS = LAYOUT[0].length;
export const ROWS = LAYOUT.length;
export const WALL_H = 5.2;
export const CRATE_LOW = 1.05;
export const CRATE_HIGH = 2.3;
export const HALF_W = (COLS * CELL) / 2;
export const HALF_D = (ROWS * CELL) / 2;

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface MapPiece {
  kind: 'wall' | 'crateLow' | 'crateHigh';
  box: Box;
}

export interface Vec2 {
  x: number;
  z: number;
}

export type SiteId = 'A' | 'B';

function cellChar(c: number, r: number): string {
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return '#';
  return LAYOUT[r][c];
}

function cellRect(c0: number, r0: number, c1: number, r1: number): Rect {
  return {
    x0: c0 * CELL - HALF_W,
    z0: r0 * CELL - HALF_D,
    x1: (c1 + 1) * CELL - HALF_W,
    z1: (r1 + 1) * CELL - HALF_D,
  };
}

/** 把同类格子贪心合并成矩形，减少盒子数量 */
function mergeCells(ch: string): Rect[] {
  const used: boolean[][] = LAYOUT.map((row) => Array<boolean>(row.length).fill(false));
  const out: Rect[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (used[r][c] || LAYOUT[r][c] !== ch) continue;
      let c1 = c;
      while (c1 + 1 < COLS && LAYOUT[r][c1 + 1] === ch && !used[r][c1 + 1]) c1++;
      let r1 = r;
      outer: while (r1 + 1 < ROWS) {
        for (let k = c; k <= c1; k++) if (LAYOUT[r1 + 1][k] !== ch || used[r1 + 1][k]) break outer;
        r1++;
      }
      for (let rr = r; rr <= r1; rr++) for (let cc = c; cc <= c1; cc++) used[rr][cc] = true;
      out.push(cellRect(c, r, c1, r1));
    }
  }
  return out;
}

function boundsOf(ch: string): Rect {
  let c0 = COLS,
    c1 = -1,
    r0 = ROWS,
    r1 = -1;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (LAYOUT[r][c] === ch) {
        c0 = Math.min(c0, c);
        c1 = Math.max(c1, c);
        r0 = Math.min(r0, r);
        r1 = Math.max(r1, r);
      }
  return cellRect(c0, r0, c1, r1);
}

/** 导航网格：1m 分辨率 */
export const NAV_RES = 1;
export const NAV_W = COLS * CELL;
export const NAV_H = ROWS * CELL;

export class GameMap {
  pieces: MapPiece[] = [];
  /** 静态 + 动态碰撞盒（技能墙会临时加入） */
  boxes: Box[] = [];
  staticCount = 0;
  sites: Record<SiteId, Rect>;
  attackSpawn: Rect;
  defendSpawn: Rect;
  /** 0 = 可走, 1 = 静态阻挡 */
  navStatic: Uint8Array;
  navDyn: Uint8Array;
  /** 每个格子到最近阻挡的距离（格），用于让路径离墙远一点 */
  navClear: Uint8Array;

  /** 本地图的布局定义（名称、所属年级等） */
  def: LayoutDef;

  constructor(layoutId: string = LAYOUTS[0].id) {
    this.def = layoutById(layoutId);
    LAYOUT = this.def.rows;
    for (const r of mergeCells('#'))
      this.pieces.push({ kind: 'wall', box: { x0: r.x0, y0: 0, z0: r.z0, x1: r.x1, y1: WALL_H, z1: r.z1 } });
    const inset = 0.12;
    for (const r of mergeCells('c'))
      this.pieces.push({
        kind: 'crateLow',
        box: { x0: r.x0 + inset, y0: 0, z0: r.z0 + inset, x1: r.x1 - inset, y1: CRATE_LOW, z1: r.z1 - inset },
      });
    for (const r of mergeCells('C'))
      this.pieces.push({
        kind: 'crateHigh',
        box: { x0: r.x0 + inset, y0: 0, z0: r.z0 + inset, x1: r.x1 - inset, y1: CRATE_HIGH, z1: r.z1 - inset },
      });
    this.boxes = this.pieces.map((p) => p.box);
    this.staticCount = this.boxes.length;
    this.sites = { A: boundsOf('A'), B: boundsOf('B') };
    this.attackSpawn = boundsOf('a');
    this.defendSpawn = boundsOf('d');

    this.navStatic = new Uint8Array(NAV_W * NAV_H);
    this.navDyn = new Uint8Array(NAV_W * NAV_H);
    const pad = 0.42;
    for (let j = 0; j < NAV_H; j++) {
      for (let i = 0; i < NAV_W; i++) {
        const x = i + 0.5 - HALF_W;
        const z = j + 0.5 - HALF_D;
        let blocked = false;
        for (const b of this.boxes) {
          if (x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) {
            blocked = true;
            break;
          }
        }
        this.navStatic[j * NAV_W + i] = blocked ? 1 : 0;
      }
    }
    // 距离场（切比雪夫，最多 3 格）
    this.navClear = new Uint8Array(NAV_W * NAV_H);
    for (let j = 0; j < NAV_H; j++) {
      for (let i = 0; i < NAV_W; i++) {
        let d = 3;
        search: for (let rr = 1; rr <= 2; rr++) {
          for (let dj = -rr; dj <= rr; dj++)
            for (let di = -rr; di <= rr; di++) {
              const ii = i + di,
                jj = j + dj;
              if (ii < 0 || jj < 0 || ii >= NAV_W || jj >= NAV_H || this.navStatic[jj * NAV_W + ii]) {
                d = rr;
                break search;
              }
            }
        }
        this.navClear[j * NAV_W + i] = d;
      }
    }
  }

  siteOf(x: number, z: number): SiteId | null {
    for (const id of ['A', 'B'] as const) {
      const s = this.sites[id];
      if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return id;
    }
    return null;
  }

  siteCenter(id: SiteId): Vec2 {
    const s = this.sites[id];
    return { x: (s.x0 + s.x1) / 2, z: (s.z0 + s.z1) / 2 };
  }

  inRect(r: Rect, x: number, z: number, pad = 0): boolean {
    return x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
  }

  addDynamicBox(b: Box): void {
    this.boxes.push(b);
    this.setDyn(b, 1);
  }

  removeDynamicBox(b: Box): void {
    const i = this.boxes.indexOf(b);
    if (i >= this.staticCount) this.boxes.splice(i, 1);
    this.setDyn(b, 0);
  }

  clearDynamic(): void {
    this.boxes.length = this.staticCount;
    this.navDyn.fill(0);
  }

  private setDyn(b: Box, v: number): void {
    const pad = 0.42;
    const i0 = Math.max(0, Math.floor(b.x0 - pad + HALF_W));
    const i1 = Math.min(NAV_W - 1, Math.floor(b.x1 + pad + HALF_W));
    const j0 = Math.max(0, Math.floor(b.z0 - pad + HALF_D));
    const j1 = Math.min(NAV_H - 1, Math.floor(b.z1 + pad + HALF_D));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.navDyn[j * NAV_W + i] = v;
  }

  walkable(i: number, j: number): boolean {
    if (i < 0 || j < 0 || i >= NAV_W || j >= NAV_H) return false;
    const k = j * NAV_W + i;
    return !this.navStatic[k] && !this.navDyn[k];
  }

  /** 找离 (x,z) 最近的可走格中心 */
  nearestWalkable(x: number, z: number): Vec2 {
    const ci = Math.floor(x + HALF_W),
      cj = Math.floor(z + HALF_D);
    for (let r = 0; r < 8; r++) {
      let best: Vec2 | null = null;
      let bd = Infinity;
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (!this.walkable(ci + di, cj + dj)) continue;
          const px = ci + di + 0.5 - HALF_W,
            pz = cj + dj + 0.5 - HALF_D;
          const d = (px - x) ** 2 + (pz - z) ** 2;
          if (d < bd) {
            bd = d;
            best = { x: px, z: pz };
          }
        }
      if (best) return best;
    }
    return { x, z };
  }

  /** 在矩形内随机取一个可走点 */
  randomPointIn(r: Rect, rng: () => number, pad = 0.6): Vec2 {
    for (let k = 0; k < 30; k++) {
      const x = r.x0 + pad + rng() * (r.x1 - r.x0 - pad * 2);
      const z = r.z0 + pad + rng() * (r.z1 - r.z0 - pad * 2);
      if (this.walkable(Math.floor(x + HALF_W), Math.floor(z + HALF_D))) return { x, z };
    }
    return this.nearestWalkable((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
  }

  /** 地面高度 1.0m 处两点间是否可直线行走（用于路径拉直） */
  private walkClear(a: Vec2, b: Vec2): boolean {
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const n = Math.ceil(len / 0.4);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const x = a.x + dx * t,
        z = a.z + dz * t;
      const i = Math.floor(x + HALF_W),
        j = Math.floor(z + HALF_D);
      if (!this.walkable(i, j)) return false;
    }
    return true;
  }

  /** A* 寻路，返回拉直后的路径点（不含起点）。找不到返回空数组。 */
  findPath(from: Vec2, to: Vec2, jitter = 0, rng: () => number = Math.random): Vec2[] {
    const s = this.nearestWalkable(from.x, from.z);
    const g = this.nearestWalkable(to.x, to.z);
    const si = Math.floor(s.x + HALF_W),
      sj = Math.floor(s.z + HALF_D);
    const gi = Math.floor(g.x + HALF_W),
      gj = Math.floor(g.z + HALF_D);
    const N = NAV_W * NAV_H;
    const start = sj * NAV_W + si,
      goal = gj * NAV_W + gi;
    if (start === goal) return [{ x: to.x, z: to.z }];
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    // 二叉堆
    const heap: number[] = [];
    const fScore = new Float32Array(N);
    const push = (n: number) => {
      heap.push(n);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (fScore[heap[p]] <= fScore[heap[i]]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1,
            r = l + 1;
          let m = i;
          if (l < heap.length && fScore[heap[l]] < fScore[heap[m]]) m = l;
          if (r < heap.length && fScore[heap[r]] < fScore[heap[m]]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    const h = (i: number, j: number) => {
      const dx = Math.abs(i - gi),
        dz = Math.abs(j - gj);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    gScore[start] = 0;
    fScore[start] = h(si, sj);
    push(start);
    let found = false;
    while (heap.length) {
      const cur = pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ci = cur % NAV_W,
        cj = (cur / NAV_W) | 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di,
            nj = cj + dj;
          if (!this.walkable(ni, nj)) continue;
          if (di && dj && (!this.walkable(ci + di, cj) || !this.walkable(ci, cj + dj))) continue;
          const nk = nj * NAV_W + ni;
          if (closed[nk]) continue;
          const clearPenalty = (3 - this.navClear[nk]) * 0.6;
          const noise = jitter ? rng() * jitter : 0;
          const cost = gScore[cur] + (di && dj ? 1.414 : 1) + clearPenalty + noise;
          if (cost < gScore[nk]) {
            gScore[nk] = cost;
            came[nk] = cur;
            fScore[nk] = cost + h(ni, nj);
            push(nk);
          }
        }
    }
    if (!found) return [];
    const raw: Vec2[] = [];
    let k = goal;
    while (k !== start && k >= 0) {
      raw.push({ x: (k % NAV_W) + 0.5 - HALF_W, z: ((k / NAV_W) | 0) + 0.5 - HALF_D });
      k = came[k];
    }
    raw.reverse();
    raw[raw.length - 1] = { x: g.x, z: g.z };
    // 拉直
    const out: Vec2[] = [];
    let anchor: Vec2 = s;
    let i = 0;
    while (i < raw.length) {
      let far = i;
      for (let j = Math.min(raw.length - 1, i + 24); j > i; j--) {
        if (this.walkClear(anchor, raw[j])) {
          far = j;
          break;
        }
      }
      out.push(raw[far]);
      anchor = raw[far];
      i = far + 1;
    }
    return out;
  }

  /** 眼睛高度视线检测（只看静态+动态盒） */
  rayDist(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    return rayBoxes(ox, oy, oz, dx, dy, dz, max, this.boxes).t;
  }

  /** 中路集合点：两个目标区连线中点略偏进攻方一侧的可走位置 */
  midPoint(): Vec2 {
    const a = this.siteCenter('A'),
      b = this.siteCenter('B');
    return this.nearestWalkable((a.x + b.x) / 2, (a.z + b.z) / 2 + 6);
  }

  /** 供小地图/调试使用（返回最近一次构造的地图的布局） */
  static layout(): readonly string[] {
    return LAYOUT;
  }
  static cellAt(c: number, r: number): string {
    return cellChar(c, r);
  }
}
