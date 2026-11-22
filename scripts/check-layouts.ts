/// <reference types="node" />
/**
 * 地图布局自检：node --experimental-strip-types scripts/check-layouts.ts [--quiet]
 *
 * 独立于 src/world/map.ts（那边会改），这里按 map.ts 的规则重新实现：
 *  - 碰撞盒：# 整格墙；c / C 箱子按同类贪心合并后四周内缩 0.12m
 *  - 1m 导航网格，盒子外扩 0.42m 视为阻挡；8 邻接、不切角的最短路（八方向距离，单位 m）
 *  - 视线：眼高 1.6m，# 与 C 挡视线，c 不挡；在 2m 格子网格上做精确 DDA 射线
 * 检查每张图的硬约束与可量化的设计目标，并检查地图两两之间的差异度。任何失败 → 退出码 1。
 */
import { LAYOUTS } from '../src/world/layouts.ts';
import type { LayoutDef } from '../src/world/layouts.ts';

const COLS = 32;
const ROWS = 34;
const CELL = 2;
const NAV_W = COLS * CELL;
const NAV_H = ROWS * CELL;
const PAD = 0.42;
const INSET = 0.12;
const CHARSET = '#.cCABad';

/** 数值设计目标（单位 m / 格） */
interface Limits {
  atkMin: number;
  atkMax: number;
  atkSpread: number;
  defMin: number;
  defMax: number;
  leadMin: number;
  leadMax: number;
  rotMin: number;
  rotMax: number;
  sightMax: number;
  coverMin: number;
  coverMax: number;
  entrMin: number;
  entrMax: number;
  /** 以下为布尔型放宽开关，默认 false */
  allowSpawnLos: boolean;
  allowCrateSqueeze: boolean;
  allowGapPocket: boolean;
}
const LIMITS: Limits = {
  atkMin: 40,
  atkMax: 62,
  atkSpread: 12,
  defMin: 20,
  defMax: 40,
  leadMin: 6,
  leadMax: 30,
  rotMin: 30,
  rotMax: 60,
  sightMax: 44,
  coverMin: 2,
  coverMax: 5,
  entrMin: 2,
  entrMax: 4,
  allowSpawnLos: false,
  allowCrateSqueeze: false,
  allowGapPocket: false,
};
/**
 * 仅对原有地图 g3-1 放宽的指标（该图按要求原样保留，不改格子）。
 * 每一项都是 g3-1 实测违反的目标，放宽到刚好覆盖实测值。
 */
const RELAX: Record<string, Partial<Limits>> = {
  'g3-1': {
    // 中路从防守出生区一路直通到进攻出生区南侧，实测最长视线 65.5m，且两出生区互相可见
    sightMax: 66,
    allowSpawnLos: true,
    // A/B 点各只有 1 块紧邻掩体（A 侧 (2,11) 的 c、B 侧 (29,11) 的 c；两个 C 都在 2 格外）
    coverMin: 1,
    // 中路北口 (15,7)(16,7) 的 cc 把 4 格宽的中路挤成两条 1 格缝
    allowCrateSqueeze: true,
    // (2,11)/(29,11) 的 c 与外墙之间留下 1 格缝，墙角 (1,12) 等 2 格小死角只能经 1 格缝进入
    allowGapPocket: true,
  },
};

const SIM_MAX = 0.8;
/** 目标区「房间」半径（格，按步数）：见 siteEntrances */
const ROOM_R = 3;

const quiet = process.argv.includes('--quiet');
/** --only <id>：只检查一张图（调试用，跳过全集与差异度检查） */
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
interface CellRect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

function mergeCells(rows: string[], ch: string): Box[] {
  const used = rows.map((row) => Array(row.length).fill(false) as boolean[]);
  const out: Box[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (used[r][c] || rows[r][c] !== ch) continue;
      let c1 = c;
      while (c1 + 1 < COLS && rows[r][c1 + 1] === ch && !used[r][c1 + 1]) c1++;
      let r1 = r;
      outer: while (r1 + 1 < ROWS) {
        for (let k = c; k <= c1; k++) if (rows[r1 + 1][k] !== ch || used[r1 + 1][k]) break outer;
        r1++;
      }
      for (let rr = r; rr <= r1; rr++) for (let cc = c; cc <= c1; cc++) used[rr][cc] = true;
      out.push({ x0: c * CELL, z0: r * CELL, x1: (c1 + 1) * CELL, z1: (r1 + 1) * CELL });
    }
  return out;
}

function buildBoxes(rows: string[]): Box[] {
  const boxes = mergeCells(rows, '#');
  for (const ch of ['c', 'C'])
    for (const b of mergeCells(rows, ch))
      boxes.push({ x0: b.x0 + INSET, z0: b.z0 + INSET, x1: b.x1 - INSET, z1: b.z1 - INSET });
  return boxes;
}

function buildNav(rows: string[]): Uint8Array {
  const boxes = buildBoxes(rows);
  const nav = new Uint8Array(NAV_W * NAV_H);
  for (let j = 0; j < NAV_H; j++)
    for (let i = 0; i < NAV_W; i++) {
      const x = i + 0.5,
        z = j + 0.5;
      for (const b of boxes)
        if (x > b.x0 - PAD && x < b.x1 + PAD && z > b.z0 - PAD && z < b.z1 + PAD) {
          nav[j * NAV_W + i] = 1;
          break;
        }
    }
  return nav;
}

/** 8 邻接不切角的 Dijkstra（八方向距离，m）。extra 为额外阻挡。 */
function dijkstra(nav: Uint8Array, start: number, extra?: Uint8Array): Float64Array {
  const N = NAV_W * NAV_H;
  const dist = new Float64Array(N).fill(Infinity);
  const blocked = (i: number, j: number) =>
    i < 0 || j < 0 || i >= NAV_W || j >= NAV_H || nav[j * NAV_W + i] === 1 || (extra !== undefined && extra[j * NAV_W + i] === 1);
  const heap: number[] = [];
  const key: number[] = [];
  const push = (n: number, d: number) => {
    heap.push(n);
    key.push(d);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (key[p] <= key[i]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      [key[p], key[i]] = [key[i], key[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [heap[0], key[0]];
    const ln = heap.pop()!,
      lk = key.pop()!;
    if (heap.length) {
      heap[0] = ln;
      key[0] = lk;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1,
          r = l + 1;
        let m = i;
        if (l < heap.length && key[l] < key[m]) m = l;
        if (r < heap.length && key[r] < key[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        [key[m], key[i]] = [key[i], key[m]];
        i = m;
      }
    }
    return top;
  };
  const si = start % NAV_W,
    sj = (start / NAV_W) | 0;
  if (blocked(si, sj)) return dist;
  dist[start] = 0;
  push(start, 0);
  while (heap.length) {
    const [cur, d] = pop();
    if (d > dist[cur]) continue;
    const ci = cur % NAV_W,
      cj = (cur / NAV_W) | 0;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di,
          nj = cj + dj;
        if (blocked(ni, nj)) continue;
        if (di && dj && (blocked(ci + di, cj) || blocked(ci, cj + dj))) continue;
        const nd = d + (di && dj ? Math.SQRT2 : 1);
        const nk = nj * NAV_W + ni;
        if (nd < dist[nk]) {
          dist[nk] = nd;
          push(nk, nd);
        }
      }
  }
  return dist;
}

/** 找某个字母的矩形；返回 null 表示不存在或不是实心矩形 */
function rectOf(rows: string[], ch: string): { rect: CellRect | null; count: number } {
  let c0 = COLS,
    c1 = -1,
    r0 = ROWS,
    r1 = -1,
    count = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (rows[r][c] === ch) {
        count++;
        c0 = Math.min(c0, c);
        c1 = Math.max(c1, c);
        r0 = Math.min(r0, r);
        r1 = Math.max(r1, r);
      }
  if (!count) return { rect: null, count };
  if ((c1 - c0 + 1) * (r1 - r0 + 1) !== count) return { rect: null, count };
  return { rect: { c0, r0, c1, r1 }, count };
}

/** 矩形中心最近的可走导航格 */
function navCenter(nav: Uint8Array, r: CellRect): number {
  const x = ((r.c0 + r.c1 + 1) * CELL) / 2,
    z = ((r.r0 + r.r1 + 1) * CELL) / 2;
  const ci = Math.floor(x),
    cj = Math.floor(z);
  for (let rad = 0; rad < 8; rad++) {
    let best = -1,
      bd = Infinity;
    for (let dj = -rad; dj <= rad; dj++)
      for (let di = -rad; di <= rad; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
        const i = ci + di,
          j = cj + dj;
        if (i < 0 || j < 0 || i >= NAV_W || j >= NAV_H || nav[j * NAV_W + i]) continue;
        const d = (i + 0.5 - x) ** 2 + (j + 0.5 - z) ** 2;
        if (d < bd) {
          bd = d;
          best = j * NAV_W + i;
        }
      }
    if (best >= 0) return best;
  }
  return cj * NAV_W + ci;
}

const isWall = (ch: string) => ch === '#';
const isCrate = (ch: string) => ch === 'c' || ch === 'C';
const isFloor = (ch: string) => ch !== '#' && ch !== 'c' && ch !== 'C';

/** 网格射线（坐标单位：格）。# 与 C 阻挡；精确穿过格角时两侧任一阻挡即视为挡住。 */
function los(rows: string[], x0: number, y0: number, x1: number, y1: number): boolean {
  const blk = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
    const ch = rows[r][c];
    return ch === '#' || ch === 'C';
  };
  let cx = Math.floor(x0),
    cy = Math.floor(y0);
  const ex = Math.floor(x1),
    ey = Math.floor(y1);
  const dx = x1 - x0,
    dy = y1 - y0;
  const sx = dx > 0 ? 1 : -1,
    sy = dy > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tmx = dx !== 0 ? (dx > 0 ? cx + 1 - x0 : x0 - cx) * tdx : Infinity;
  let tmy = dy !== 0 ? (dy > 0 ? cy + 1 - y0 : y0 - cy) * tdy : Infinity;
  for (let guard = 0; guard < 400 && (cx !== ex || cy !== ey); guard++) {
    if (Math.abs(tmx - tmy) < 1e-9) {
      if (blk(cx + sx, cy) || blk(cx, cy + sy)) return false;
      cx += sx;
      cy += sy;
      tmx += tdx;
      tmy += tdy;
    } else if (tmx < tmy) {
      cx += sx;
      tmx += tdx;
    } else {
      cy += sy;
      tmy += tdy;
    }
    if (blk(cx, cy)) return false;
  }
  return true;
}

/** 可站立点（导航格中心，单位：格），只取地面格（不含箱顶） */
function standPoints(rows: string[], filter?: (c: number, r: number) => boolean): [number, number][] {
  const pts: [number, number][] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (!isFloor(rows[r][c])) continue;
      if (filter && !filter(c, r)) continue;
      for (const oy of [0.25, 0.75]) for (const ox of [0.25, 0.75]) pts.push([c + ox, r + oy]);
    }
  return pts;
}

function inRect(r: CellRect, c: number, rr: number, pad = 0): boolean {
  return c >= r.c0 - pad && c <= r.c1 + pad && rr >= r.r0 - pad && rr <= r.r1 + pad;
}

/** 两矩形之间任一对站立点可互视则返回该对点（格坐标），否则 null */
function anyLos(rows: string[], a: CellRect, b: CellRect): string | null {
  const pa = standPoints(rows, (c, r) => inRect(a, c, r));
  const pb = standPoints(rows, (c, r) => inRect(b, c, r));
  for (const p of pa)
    for (const q of pb) if (los(rows, p[0], p[1], q[0], q[1])) return `(${p.join(',')}) → (${q.join(',')})`;
  return null;
}

interface Sight {
  len: number;
  from: [number, number];
  to: [number, number];
}
function maxSight(rows: string[]): Sight {
  const pts = standPoints(rows);
  let best: Sight = { len: 0, from: [0, 0], to: [0, 0] };
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) * CELL;
      if (d <= best.len) continue;
      if (los(rows, pts[i][0], pts[i][1], pts[j][0], pts[j][1])) best = { len: d, from: pts[i], to: pts[j] };
    }
  return best;
}

interface Entrance {
  cells: number;
  at: string;
}
/**
 * 目标区入口：从目标区矩形出发，在非墙格上做 4 邻接 BFS（箱子不算隔断），
 * 步数 ≤ ROOM_R 的格子算「目标区房间」；步数 ROOM_R+1 … ROOM_R+3 的格子构成外沿带，
 * 外沿带按 8 邻接分段，只保留一直延伸到 ROOM_R+3 的段（排除墙角小凹槽），段数 = 入口数，
 * 段内某一层（步数 ROOM_R+1…ROOM_R+3）地面格数的最大值 = 入口宽度。
 */
function siteEntrances(rows: string[], s: CellRect): Entrance[] {
  const open = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS && !isWall(rows[r][c]);
  const dist = new Int32Array(COLS * ROWS).fill(-1);
  let q: number[] = [];
  for (let r = s.r0; r <= s.r1; r++)
    for (let c = s.c0; c <= s.c1; c++) {
      dist[r * COLS + c] = 0;
      q.push(r * COLS + c);
    }
  for (let step = 1; step <= ROOM_R + 3; step++) {
    const nq: number[] = [];
    for (const k of q) {
      const c = k % COLS,
        r = (k / COLS) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc,
          nr = r + dr;
        if (!open(nc, nr) || dist[nr * COLS + nc] >= 0) continue;
        dist[nr * COLS + nc] = step;
        nq.push(nr * COLS + nc);
      }
    }
    q = nq;
  }
  const front = new Set<number>();
  for (let k = 0; k < COLS * ROWS; k++) if (dist[k] > ROOM_R) front.add(k);
  const seen = new Set<number>();
  const out: Entrance[] = [];
  for (const k0 of front) {
    if (seen.has(k0)) continue;
    const comp: number[] = [];
    const st = [k0];
    seen.add(k0);
    while (st.length) {
      const k = st.pop()!;
      comp.push(k);
      const c = k % COLS,
        r = (k / COLS) | 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nk = (r + dr) * COLS + c + dc;
          if (front.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            st.push(nk);
          }
        }
    }
    if (!comp.some((k) => dist[k] === ROOM_R + 3)) continue;
    // 宽度取外沿带三层中地面格最多的一层（入口正对一根柱子时，第一层会被柱子切碎）
    let floorCells = 0;
    for (let L = ROOM_R + 1; L <= ROOM_R + 3; L++)
      floorCells = Math.max(
        floorCells,
        comp.filter((k) => dist[k] === L && isFloor(rows[(k / COLS) | 0][k % COLS])).length,
      );
    const mouth = comp.filter((k) => dist[k] === ROOM_R + 1);
    const k = mouth[0] ?? comp[0];
    out.push({ cells: floorCells, at: `(${k % COLS},${(k / COLS) | 0})` });
  }
  return out;
}

/** 箱子块（c/C 合并后 4 邻接连通）*/
function coverPieces(rows: string[]): { cells: [number, number][] }[] {
  const seen = new Set<number>();
  const out: { cells: [number, number][] }[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (!isCrate(rows[r][c]) || seen.has(r * COLS + c)) continue;
      const cells: [number, number][] = [];
      const st = [[c, r]];
      seen.add(r * COLS + c);
      while (st.length) {
        const [x, y] = st.pop()!;
        cells.push([x, y]);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dc,
            ny = y + dr;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          if (!isCrate(rows[ny][nx]) || seen.has(ny * COLS + nx)) continue;
          seen.add(ny * COLS + nx);
          st.push([nx, ny]);
        }
      }
      out.push({ cells });
    }
  return out;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1) : 'inf';
}

interface Row {
  id: string;
  name: string;
  atkA: number;
  atkB: number;
  defA: number;
  defB: number;
  rot: number;
  sight: number;
  area: number;
  coverA: number;
  coverB: number;
  coverAll: number;
  entrA: string;
  entrB: string;
  fails: number;
}

let totalFails = 0;
const table: Row[] = [];

function checkLayout(L: LayoutDef): void {
  const fails: string[] = [];
  const warn: string[] = [];
  const lim: Limits = { ...LIMITS, ...(RELAX[L.id] ?? {}) };
  const fail = (m: string) => fails.push(m);
  /** 标准限值下不通过、放宽后通过 → 只记为「已放宽」提示 */
  const relaxed = (m: string) => warn.push(`已放宽（${L.id} 专用）: ${m}`);
  const rows = L.rows;

  // ---- 元数据
  const nameLen = [...L.name].length;
  if (nameLen < 2 || nameLen > 4) fail(`name 长度 ${nameLen} 不在 2–4`);
  if ([...L.blurb].length > 24) fail(`blurb 超过 24 字`);
  if (![3, 4, 5, 6].includes(L.grade)) fail(`grade 非法`);

  // ---- 尺寸 / 字符 / 边框
  if (rows.length !== ROWS) {
    fail(`行数 ${rows.length} ≠ ${ROWS}`);
  }
  rows.forEach((row, r) => {
    if (row.length !== COLS) fail(`第 ${r} 行长度 ${row.length} ≠ ${COLS}`);
    for (const ch of row) if (!CHARSET.includes(ch)) fail(`第 ${r} 行含非法字符 '${ch}'`);
  });
  if (fails.length) return report(L, fails, warn, null);
  for (let c = 0; c < COLS; c++) if (rows[0][c] !== '#' || rows[ROWS - 1][c] !== '#') fail(`上/下边框第 ${c} 列不是墙`);
  for (let r = 0; r < ROWS; r++) if (rows[r][0] !== '#' || rows[r][COLS - 1] !== '#') fail(`左/右边框第 ${r} 行不是墙`);

  // ---- 矩形
  const rects: Record<string, CellRect> = {};
  for (const ch of ['A', 'B', 'a', 'd']) {
    const { rect, count } = rectOf(rows, ch);
    if (!rect) {
      fail(count ? `'${ch}' 不是单个实心矩形` : `缺少 '${ch}'`);
      continue;
    }
    rects[ch] = rect;
    const w = rect.c1 - rect.c0 + 1,
      h = rect.r1 - rect.r0 + 1;
    const lo = Math.min(w, h),
      hi = Math.max(w, h);
    if (ch === 'A' || ch === 'B') {
      if (lo < 3 || lo > 5 || hi > 6) fail(`目标区 ${ch} 尺寸 ${w}×${h} 不在 3×3 … 5×6`);
    } else {
      if (lo < 2 || hi < 5) fail(`出生区 '${ch}' 尺寸 ${w}×${h} 小于 5×2`);
      // 周围一圈（不含外边框）：不得有箱子，且至少 70% 为地面
      let ringN = 0,
        ringOpen = 0;
      for (let r = rect.r0 - 1; r <= rect.r1 + 1; r++)
        for (let c = rect.c0 - 1; c <= rect.c1 + 1; c++) {
          if (inRect(rect, c, r)) continue;
          if (r <= 0 || c <= 0 || r >= ROWS - 1 || c >= COLS - 1) continue;
          ringN++;
          if (isCrate(rows[r][c])) fail(`出生区 '${ch}' 紧邻箱子 (${c},${r})`);
          if (isFloor(rows[r][c])) ringOpen++;
        }
      if (ringN === 0 || ringOpen / ringN < 0.7) fail(`出生区 '${ch}' 周围开阔度 ${ringOpen}/${ringN} < 70%`);
    }
  }
  if (rects.a && rects.a.r0 < 22) fail(`进攻出生区不在南部（起始行 ${rects.a.r0} < 22）`);
  if (rects.d && rects.d.r1 > 11) fail(`防守出生区不在北部（结束行 ${rects.d.r1} > 11）`);
  if (fails.length) return report(L, fails, warn, null);
  const { A, B, a, d } = rects;

  // ---- 窄道：1 格宽通道连续 > 2 格；箱子把门口挤到 < 2 格
  const blockedCell = (c: number, r: number) => c < 0 || r < 0 || c >= COLS || r >= ROWS || !isFloor(rows[r][c]);
  const pinch = (c: number, r: number) =>
    isFloor(rows[r][c]) && ((blockedCell(c - 1, r) && blockedCell(c + 1, r)) || (blockedCell(c, r - 1) && blockedCell(c, r + 1)));
  for (let c = 0; c < COLS; c++) {
    let run = 0;
    for (let r = 0; r <= ROWS; r++) {
      const p = r < ROWS && isFloor(rows[r][c]) && blockedCell(c - 1, r) && blockedCell(c + 1, r);
      if (p) run++;
      else {
        if (run > 2) fail(`南北向 1 格宽通道长 ${run} 格，列 ${c} 行 ${r - run}…${r - 1}`);
        run = 0;
      }
    }
  }
  for (let r = 0; r < ROWS; r++) {
    let run = 0;
    for (let c = 0; c <= COLS; c++) {
      const p = c < COLS && isFloor(rows[r][c]) && blockedCell(c, r - 1) && blockedCell(c, r + 1);
      if (p) run++;
      else {
        if (run > 2) fail(`东西向 1 格宽通道长 ${run} 格，行 ${r} 列 ${c - run}…${c - 1}`);
        run = 0;
      }
    }
  }
  for (let r = 1; r < ROWS - 1; r++)
    for (let c = 1; c < COLS - 1; c++) {
      if (!isCrate(rows[r][c])) continue;
      for (const [dc, dr] of [[1, 0], [0, 1]]) {
        // 沿该轴把相连的箱子格一起算作一块，每块只在其起始格检查一次
        let b1 = 0,
          b2 = 0;
        while (isCrate(rows[r - dr * (b1 + 1)]?.[c - dc * (b1 + 1)] ?? '#')) b1++;
        while (isCrate(rows[r + dr * (b2 + 1)]?.[c + dc * (b2 + 1)] ?? '#')) b2++;
        if (b1 > 0) continue;
        let s1 = 0,
          s2 = 0;
        while (isFloor(rows[r - dr * (s1 + 1)]?.[c - dc * (s1 + 1)] ?? '#')) s1++;
        while (isFloor(rows[r + dr * (b2 + s2 + 1)]?.[c + dc * (b2 + s2 + 1)] ?? '#')) s2++;
        const width = s1 + s2 + b2 + 1;
        if (s1 + s2 > 0 && width <= 5 && Math.max(s1, s2) < 2) {
          const m = `箱子 (${c},${r}) 把 ${width} 格宽的通道挤成 ${Math.max(s1, s2)} 格`;
          (lim.allowCrateSqueeze ? relaxed : fail)(m);
        }
      }
    }
  // 去掉所有 1 格宽卡口后仍须全图连通（4 邻接）
  {
    const seen = new Uint8Array(COLS * ROWS);
    const st: number[] = [];
    const sc = (a.c0 + a.c1) >> 1,
      sr = (a.r0 + a.r1) >> 1;
    seen[sr * COLS + sc] = 1;
    st.push(sr * COLS + sc);
    while (st.length) {
      const k = st.pop()!;
      const c = k % COLS,
        r = (k / COLS) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc,
          nr = r + dr;
        if (blockedCell(nc, nr) || pinch(nc, nr) || seen[nr * COLS + nc]) continue;
        seen[nr * COLS + nc] = 1;
        st.push(nr * COLS + nc);
      }
    }
    let lost = 0,
      ex = '';
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (isFloor(rows[r][c]) && !pinch(c, r) && !seen[r * COLS + c]) {
          lost++;
          ex ||= `(${c},${r})`;
        }
    if (lost) (lim.allowGapPocket ? relaxed : fail)(`有 ${lost} 格只能经 1 格宽缺口到达，如 ${ex}`);
  }

  // ---- 导航与路径
  const nav = buildNav(rows);
  const sA = navCenter(nav, A),
    sB = navCenter(nav, B),
    sa = navCenter(nav, a),
    sd = navCenter(nav, d);
  const fromA = dijkstra(nav, sa),
    fromD = dijkstra(nav, sd);
  const atkA = fromA[sA],
    atkB = fromA[sB],
    defA = fromD[sA],
    defB = fromD[sB];
  const noAtk = new Uint8Array(NAV_W * NAV_H);
  for (let r = a.r0; r <= a.r1; r++)
    for (let c = a.c0; c <= a.c1; c++)
      for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) noAtk[(r * 2 + dj) * NAV_W + c * 2 + di] = 1;
  const rot = dijkstra(nav, sA, noAtk)[sB];
  const within = (v: number, lo: number, hi: number) => v >= lo - 1e-6 && v <= hi + 1e-6;
  const win = (v: number, key: 'atk' | 'def' | 'lead' | 'rot', what: string) => {
    const lo = (k: Limits) => k[`${key}Min`],
      hi = (k: Limits) => k[`${key}Max`];
    const m = `${what} = ${fmt(v)} m 不在 ${lo(LIMITS)}–${hi(LIMITS)}`;
    if (within(v, lo(LIMITS), hi(LIMITS))) return;
    if (within(v, lo(lim), hi(lim))) relaxed(m);
    else fail(m);
  };
  win(atkA, 'atk', '进攻→A');
  win(atkB, 'atk', '进攻→B');
  {
    const sp = Math.abs(atkA - atkB),
      m = `进攻到两点路程差 ${fmt(sp)} m > ${LIMITS.atkSpread}`;
    if (sp > LIMITS.atkSpread + 1e-6) (sp > lim.atkSpread + 1e-6 ? fail : relaxed)(m);
  }
  win(defA, 'def', '防守→A');
  win(defB, 'def', '防守→B');
  win(atkA - defA, 'lead', 'A 点防守领先');
  win(atkB - defB, 'lead', 'B 点防守领先');
  win(rot, 'rot', 'A↔B 回防（不经进攻出生）');

  // 可达：所有可走导航格须从两个出生区都可达
  let walkNav = 0,
    unreachable = 0,
    exU = '';
  for (let k = 0; k < NAV_W * NAV_H; k++) {
    if (nav[k]) continue;
    walkNav++;
    if (!Number.isFinite(fromA[k]) || !Number.isFinite(fromD[k])) {
      unreachable++;
      exU ||= `nav(${k % NAV_W},${(k / NAV_W) | 0})`;
    }
  }
  if (unreachable) fail(`${unreachable} 个导航格不可从出生区到达，如 ${exU}`);

  // 鲁棒性：任一箱子格变成墙后，两点仍可从两出生区到达
  let robustFail = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (!isCrate(rows[r][c])) continue;
      const alt = rows.map((row, rr) => (rr === r ? row.slice(0, c) + '#' + row.slice(c + 1) : row));
      const nav2 = buildNav(alt);
      const x = dijkstra(nav2, navCenter(nav2, a)),
        y = dijkstra(nav2, navCenter(nav2, d));
      const tA = navCenter(nav2, A),
        tB = navCenter(nav2, B);
      if (![x[tA], x[tB], y[tA], y[tB]].every(Number.isFinite)) {
        robustFail++;
        fail(`箱子 (${c},${r}) 变墙后有目标区不可达`);
      }
    }

  // ---- 视线
  const sight = maxSight(rows);
  if (sight.len > LIMITS.sightMax + 1e-6)
    (sight.len > lim.sightMax + 1e-6 ? fail : relaxed)(
      `最长视线 ${fmt(sight.len)} m > ${LIMITS.sightMax}：格坐标 (${sight.from.map((v) => v.toFixed(2))}) → (${sight.to.map((v) => v.toFixed(2))})`,
    );
  {
    const ad = anyLos(rows, a, d);
    if (ad) (lim.allowSpawnLos ? relaxed : fail)(`两个出生区互相可见 ${ad}`);
  }
  for (const [sn, sr] of [['A', A], ['B', B]] as const) {
    const x = anyLos(rows, a, sr),
      y = anyLos(rows, d, sr);
    if (x) fail(`进攻出生区可直接看到 ${sn} 点 ${x}`);
    if (y) fail(`防守出生区可直接看到 ${sn} 点 ${y}`);
  }

  // ---- 掩体
  const pieces = coverPieces(rows);
  for (const p of pieces)
    for (const [c, r] of p.cells) {
      if (inRect(a, c, r) || inRect(d, c, r)) fail(`箱子在出生区内 (${c},${r})`);
    }
  const coverOf = (s: CellRect) => pieces.filter((p) => p.cells.some(([c, r]) => inRect(s, c, r, 1)));
  const cov: Record<string, number> = {};
  for (const [sn, sr] of [['A', A], ['B', B]] as const) {
    const ps = coverOf(sr);
    cov[sn] = ps.length;
    if (ps.length < LIMITS.coverMin || ps.length > LIMITS.coverMax) {
      const m = `${sn} 点掩体 ${ps.length} 块，不在 ${LIMITS.coverMin}–${LIMITS.coverMax}`;
      (ps.length < lim.coverMin || ps.length > lim.coverMax ? fail : relaxed)(m);
    }
    const cent = ps.map((p) => [
      p.cells.reduce((s, q) => s + q[0], 0) / p.cells.length,
      p.cells.reduce((s, q) => s + q[1], 0) / p.cells.length,
    ]);
    let spread = 0;
    for (const u of cent) for (const v of cent) spread = Math.max(spread, Math.hypot(u[0] - v[0], u[1] - v[1]));
    if (ps.length >= 2 && spread < 2.5) fail(`${sn} 点掩体全挤在一处（最大间距 ${spread.toFixed(1)} 格 < 2.5）`);
  }

  // ---- 入口
  const ent: Record<string, Entrance[]> = {};
  for (const [sn, sr] of [['A', A], ['B', B]] as const) {
    const es = siteEntrances(rows, sr);
    ent[sn] = es;
    if (es.length < lim.entrMin || es.length > lim.entrMax) fail(`${sn} 点入口 ${es.length} 个，不在 ${lim.entrMin}–${lim.entrMax}`);
    for (const e of es) if (e.cells < 2) fail(`${sn} 点入口 ${e.at} 宽度 ${e.cells} 格 < 2`);
  }

  let area = 0;
  for (const row of rows) for (const ch of row) if (isFloor(ch)) area += CELL * CELL;

  table.push({
    id: L.id,
    name: L.name,
    atkA,
    atkB,
    defA,
    defB,
    rot,
    sight: sight.len,
    area,
    coverA: cov.A,
    coverB: cov.B,
    coverAll: pieces.length,
    entrA: ent.A.map((e) => e.cells).join('/'),
    entrB: ent.B.map((e) => e.cells).join('/'),
    fails: fails.length,
  });
  void walkNav;
  void robustFail;
  report(L, fails, warn, sight);
}

function report(L: LayoutDef, fails: string[], warn: string[], sight: Sight | null): void {
  totalFails += fails.length;
  console.log(`\n=== ${L.id} ${L.name}（${L.grade} 年级）— ${L.blurb}`);
  if (!quiet) {
    const hdr = '    ' + Array.from({ length: COLS }, (_, c) => String(c % 10)).join('');
    console.log(hdr);
    L.rows.forEach((row, r) => console.log(String(r).padStart(3) + ' ' + row));
  }
  void sight;
  for (const w of warn) console.log('  注意: ' + w);
  for (const f of fails) console.log('  ✗ ' + f);
  if (!fails.length) console.log('  ✓ 全部通过');
}

// ---- 全集检查
const setFails: string[] = [];
if (LAYOUTS.length !== 8) setFails.push(`LAYOUTS 应为 8 张，实际 ${LAYOUTS.length}`);
const ids = new Set<string>();
LAYOUTS.forEach((L, i) => {
  const g = (3 + Math.floor(i / 2)) as 3 | 4 | 5 | 6;
  const want = `g${g}-${(i % 2) + 1}`;
  if (L.id !== want) setFails.push(`第 ${i} 张 id 应为 ${want}，实际 ${L.id}`);
  if (L.grade !== g) setFails.push(`${L.id} grade 应为 ${g}`);
  if (ids.has(L.id)) setFails.push(`重复 id ${L.id}`);
  ids.add(L.id);
});
if (new Set(LAYOUTS.map((l) => l.name)).size !== LAYOUTS.length) setFails.push('地图名有重复');

if (only) {
  const L = LAYOUTS.find((l) => l.id === only);
  if (!L) throw new Error(`no layout ${only}`);
  checkLayout(L);
  process.exit(totalFails ? 1 : 0);
}
for (const L of LAYOUTS) checkLayout(L);

// ---- 两两差异度（墙 / 地面 / 箱子三类，按原样与左右镜像比较）
const cls = (ch: string) => (ch === '#' ? 0 : isCrate(ch) ? 2 : 1);
console.log('\n=== 差异度（相同格比例：原样 / 左右镜像；> 0.80 判为雷同）');
let simMax = 0;
for (let i = 0; i < LAYOUTS.length; i++)
  for (let j = i + 1; j < LAYOUTS.length; j++) {
    const P = LAYOUTS[i].rows,
      Q = LAYOUTS[j].rows;
    if (P.length !== ROWS || Q.length !== ROWS) continue;
    let same = 0,
      mir = 0;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (cls(P[r][c]) === cls(Q[r]?.[c] ?? '#')) same++;
        if (cls(P[r][c]) === cls(Q[r]?.[COLS - 1 - c] ?? '#')) mir++;
      }
    const s = same / (ROWS * COLS),
      m = mir / (ROWS * COLS);
    simMax = Math.max(simMax, s, m);
    const bad = s > SIM_MAX || m > SIM_MAX;
    if (bad) setFails.push(`${LAYOUTS[i].id} 与 ${LAYOUTS[j].id} 过于相似 (${s.toFixed(2)} / ${m.toFixed(2)})`);
    if (!quiet || bad) console.log(`  ${LAYOUTS[i].id} vs ${LAYOUTS[j].id}: ${s.toFixed(2)} / ${m.toFixed(2)}${bad ? '  ✗' : ''}`);
  }
console.log(`  最大相似度 ${simMax.toFixed(2)}`);

// ---- 汇总表
console.log('\n=== 汇总（路径单位 m；领先 = 进攻路程 − 防守路程）');
console.log(
  'id    name      atk→A atk→B def→A def→B 领先A 领先B  A↔B  视线  面积m² 掩体A/B/全 入口A(宽)   入口B(宽)   失败',
);
for (const t of table) {
  console.log(
    [
      t.id.padEnd(5),
      t.name.padEnd(5, '　'),
      fmt(t.atkA).padStart(5),
      fmt(t.atkB).padStart(5),
      fmt(t.defA).padStart(5),
      fmt(t.defB).padStart(5),
      fmt(t.atkA - t.defA).padStart(5),
      fmt(t.atkB - t.defB).padStart(5),
      fmt(t.rot).padStart(5),
      fmt(t.sight).padStart(5),
      String(t.area).padStart(6),
      `${t.coverA}/${t.coverB}/${t.coverAll}`.padStart(9),
      ` ${t.entrA.split('/').length}(${t.entrA})`.padEnd(12),
      `${t.entrB.split('/').length}(${t.entrB})`.padEnd(12),
      String(t.fails).padStart(3),
    ].join(' '),
  );
}
for (const f of setFails) console.log('  ✗ ' + f);
totalFails += setFails.length;
console.log(totalFails ? `\n失败 ${totalFails} 项` : '\n全部通过');
process.exit(totalFails ? 1 : 0);
