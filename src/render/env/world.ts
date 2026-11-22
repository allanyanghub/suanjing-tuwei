/**
 * 环境搭建：根据地图布局生成写实化的书院庭院 —— 墙体（砖 / 抹灰 + 混凝土线脚、窗洞、卷帘门、
 * 管线、壁灯、黑板海报指示牌）、地面（花岗岩铺装 + 水泥 + 磨损油漆标线）、照片扫描木箱掩体、
 * 目标区旗杆、周边教学楼、北侧双钟楼、树木与远景地面。
 */
import * as THREE from 'three';
import type { Theme } from '../../data/defs.ts';
import { GameMap, WALL_H, HALF_W, HALF_D, CELL, COLS, ROWS, type Rect, type Vec2 } from '../../world/map.ts';
import { GeoBuilder, WHITE, hash2, seeded, type V3 } from './geo.ts';
import { envMaterial, envShared, setTex, SET_SIZE, type EnvMatOpts } from './pbr.ts';
import { paintBoards, paintFloor, paintLeaves, paintPool, paintRound, paintStencils, type BoardAtlas, type BoardId, type StencilId, type UVRect } from './paint.ts';
import { barkTex, crateStack, instancedProp, leafPhoto, makeTree, propParts } from './props.ts';
import type { SkyMood } from './sky.ts';

export type Zone = 'A' | 'B' | 'atk' | 'def' | 'n';
export const ZONE_COL: Record<Exclude<Zone, 'n'>, number> = { A: 0xe0a325, B: 0x7a63e0, atk: 0xe8604a, def: 0x3a9be0 };

export interface LampSpot {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  /** 是否位于重要区域（目标区 / 出生区 / 中路） */
  weight: number;
}

export interface EnvBuild {
  group: THREE.Group;
  disposables: { dispose(): void }[];
  animated: ((t: number) => void)[];
  envMats: THREE.Material[];
  lamps: LampSpot[];
}

/** 墙面上的一段连续暴露面 */
interface Run {
  nx: number;
  nz: number;
  plane: number;
  a: number;
  b: number;
  convA: boolean;
  convB: boolean;
  ext: boolean;
  comp: number;
}

type Feature = 'plain' | 'window' | 'door' | 'chalk' | 'white' | 'posters' | 'notice' | 'vent' | 'stencil' | 'math' | 'plate' | 'power';

export function buildEnvironment(map: GameMap, theme: Theme, mood: SkyMood, detail: boolean): EnvBuild {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const animated: ((t: number) => void)[] = [];
  const envMats: THREE.Material[] = [];
  const lamps: LampSpot[] = [];
  const track = <T extends { dispose(): void }>(o: T): T => {
    disposables.push(o);
    return o;
  };
  const night = mood === 'night';
  const dusk = mood === 'dusk';
  const nightK = night ? 1 : dusk ? 0.35 : 0;
  envShared.uNight.value = nightK;
  const mat = (o: EnvMatOpts): THREE.MeshStandardMaterial => {
    const m = track(envMaterial(o, detail));
    envMats.push(m);
    return m;
  };
  const addMesh = (geo: THREE.BufferGeometry | null, m: THREE.Material, cast = true, recv = true): THREE.Mesh | null => {
    if (!geo) return null;
    track(geo);
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = recv;
    group.add(mesh);
    return mesh;
  };
  const rnd = seeded(7);

  // ================= 材质 =================
  const mPlaster = mat({ set: 'plaster', kind: 'wall', color: 0xf0e4d0, macro: 0.45 });
  const mBrick = mat({ set: 'brick', kind: 'wall', color: 0xf4ece6, macro: 0.32 });
  const mConcrete = mat({ set: 'concrete', color: 0xe2ddd3, macro: 0.3 });
  const mMetal = mat({ color: 0x6b7178, roughness: 0.5, metalness: 0.8, macro: 0.2 });
  const mDark = mat({ color: 0x2c3034, roughness: 0.45, metalness: 0.75, macro: 0.15 });
  const mShutter = mat({ set: 'shutter', color: 0xc9ccce, metalMap: true, macro: 0.2 });
  const mGlass = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0.0 }));
  const glassCols = [new THREE.Color(0x0e1216), new THREE.Color(0x161b20), new THREE.Color(0x5d5850), new THREE.Color(0x3c4046)];
  const mGlassLit = track(
    new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 0.05, metalness: 0, emissive: 0xffc98a, emissiveIntensity: nightK * 1.6 }),
  );

  // ================= 墙体拓扑 =================
  const inb = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
  const isWall = (c: number, r: number) => inb(c, r) && GameMap.cellAt(c, r) === '#';
  // 连通的墙体块：决定砖墙 / 抹灰墙
  const comp = new Int32Array(COLS * ROWS).fill(-1);
  let nComp = 0;
  const compBorder: boolean[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (!isWall(c, r) || comp[r * COLS + c] >= 0) continue;
      const id = nComp++;
      let border = false;
      const st = [[c, r]];
      comp[r * COLS + c] = id;
      while (st.length) {
        const [cc, rr] = st.pop()!;
        if (cc === 0 || rr === 0 || cc === COLS - 1 || rr === ROWS - 1) border = true;
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const x = cc + dc,
            y = rr + dr;
          if (isWall(x, y) && comp[y * COLS + x] < 0) {
            comp[y * COLS + x] = id;
            st.push([x, y]);
          }
        }
      }
      compBorder.push(border);
    }
  const compBrick = (id: number) => (compBorder[id] ? false : hash2(id * 3.7, 1.3) > 0.35);

  const runs: Run[] = [];
  for (const dz of [1, -1]) {
    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      while (c < COLS) {
        if (isWall(c, r) && !isWall(c, r + dz)) {
          const s = c;
          while (c < COLS && isWall(c, r) && !isWall(c, r + dz)) c++;
          runs.push({
            nx: 0,
            nz: dz,
            plane: (dz > 0 ? r + 1 : r) * CELL - HALF_D,
            a: s * CELL - HALF_W,
            b: c * CELL - HALF_W,
            convA: !isWall(s - 1, r),
            convB: !isWall(c, r),
            ext: !inb(s, r + dz),
            comp: comp[r * COLS + s],
          });
        } else c++;
      }
    }
  }
  for (const dx of [1, -1]) {
    for (let c = 0; c < COLS; c++) {
      let r = 0;
      while (r < ROWS) {
        if (isWall(c, r) && !isWall(c + dx, r)) {
          const s = r;
          while (r < ROWS && isWall(c, r) && !isWall(c + dx, r)) r++;
          runs.push({
            nx: dx,
            nz: 0,
            plane: (dx > 0 ? c + 1 : c) * CELL - HALF_W,
            a: s * CELL - HALF_D,
            b: r * CELL - HALF_D,
            convA: !isWall(c, s - 1),
            convB: !isWall(c, r),
            ext: !inb(c + dx, s),
            comp: comp[s * COLS + c],
          });
        } else r++;
      }
    }
  }
  const W3 = (rn: Run, s: number, h: number, o: number): V3 => (rn.nz !== 0 ? [s, h, rn.plane + o * rn.nz] : [rn.plane + o * rn.nx, h, s]);
  const nrm = (rn: Run): V3 => [rn.nx, 0, rn.nz];
  const tan = (rn: Run): V3 => (rn.nz !== 0 ? [1, 0, 0] : [0, 0, 1]);
  const neg = (v: V3): V3 => [-v[0], -v[1], -v[2]];
  const rightSign = (rn: Run) => (rn.nz !== 0 ? rn.nz : -rn.nx);
  const expand = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, z0: r.z0 - m, x1: r.x1 + m, z1: r.z1 + m });
  const inRect = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
  const zA = expand(map.sites.A, 6),
    zB = expand(map.sites.B, 6),
    zAtk = expand(map.attackSpawn, 6),
    zDef = expand(map.defendSpawn, 5);
  const zoneAt = (x: number, z: number): Zone =>
    inRect(zA, x, z) ? 'A' : inRect(zB, x, z) ? 'B' : inRect(zAtk, x, z) ? 'atk' : inRect(zDef, x, z) ? 'def' : 'n';
  /** 局部盒 → 世界 AABB */
  const lbox = (gb: GeoBuilder, rn: Run, s0: number, s1: number, h0: number, h1: number, o0: number, o1: number, size = 1, skip = 4, col: THREE.Color = WHITE) => {
    const p = W3(rn, s0, h0, o0),
      q = W3(rn, s1, h1, o1);
    gb.box(Math.min(p[0], q[0]), h0, Math.min(p[2], q[2]), Math.max(p[0], q[0]), h1, Math.max(p[2], q[2]), col, size, skip);
  };
  /** 平行于墙面的四边形，uv 由世界坐标计算（size 米一个重复）或直接给定 */
  const wquad = (gb: GeoBuilder, rn: Run, sc0: number, sc1: number, h0: number, h1: number, o: number, uv: UVRect | number, col: THREE.Color = WHITE) => {
    const rs = rightSign(rn);
    const sl = rs > 0 ? Math.min(sc0, sc1) : Math.max(sc0, sc1);
    const sr = rs > 0 ? Math.max(sc0, sc1) : Math.min(sc0, sc1);
    let u0: number, v0: number, u1: number, v1: number;
    if (typeof uv === 'number') {
      u0 = (sl * rs) / uv;
      u1 = (sr * rs) / uv;
      v0 = h0 / uv;
      v1 = h1 / uv;
    } else [u0, v0, u1, v1] = uv;
    gb.quad(W3(rn, sl, h0, o), W3(rn, sr, h0, o), W3(rn, sr, h1, o), W3(rn, sl, h1, o), nrm(rn), [u0, v0, u1, v0, u1, v1, u0, v1], col);
  };
  /** 洞口四周的内侧面（侧壁 / 窗台面 / 顶面） */
  const reveal = (gb: GeoBuilder, rn: Run, s0: number, s1: number, h0: number, h1: number, D: number, size: number, bottom = true) => {
    const t = tan(rn);
    const q = (a: V3, b: V3, c: V3, d: V3, n: V3, w: number, h: number) => gb.quad(a, b, c, d, n, [0, 0, w / size, 0, w / size, h / size, 0, h / size]);
    q(W3(rn, s0, h0, 0), W3(rn, s0, h0, -D), W3(rn, s0, h1, -D), W3(rn, s0, h1, 0), t, D, h1 - h0);
    q(W3(rn, s1, h0, -D), W3(rn, s1, h0, 0), W3(rn, s1, h1, 0), W3(rn, s1, h1, -D), neg(t), D, h1 - h0);
    q(W3(rn, s0, h1, 0), W3(rn, s1, h1, 0), W3(rn, s1, h1, -D), W3(rn, s0, h1, -D), [0, -1, 0], s1 - s0, D);
    if (bottom) q(W3(rn, s0, h0, -D), W3(rn, s1, h0, -D), W3(rn, s1, h0, 0), W3(rn, s0, h0, 0), [0, 1, 0], s1 - s0, D);
  };

  // ================= 路线 =================
  const atkC: Vec2 = { x: (map.attackSpawn.x0 + map.attackSpawn.x1) / 2, z: (map.attackSpawn.z0 + map.attackSpawn.z1) / 2 };
  const routeA = [atkC, ...map.findPath(atkC, map.siteCenter('A'))];
  const routeB = [atkC, ...map.findPath(atkC, map.siteCenter('B'))];
  const pathAhead = (from: Vec2, to: Vec2): Vec2 | null => {
    const p = map.findPath(from, to);
    if (!p.length) return null;
    let prev = from;
    let left = 5;
    for (const q of p) {
      const d = Math.hypot(q.x - prev.x, q.z - prev.z);
      if (d >= left) return { x: prev.x + ((q.x - prev.x) * left) / d, z: prev.z + ((q.z - prev.z) * left) / d };
      left -= d;
      prev = q;
    }
    return prev;
  };

  // ================= 墙体几何 =================
  const gbPlaster = new GeoBuilder();
  const gbBrick = new GeoBuilder();
  const gbConc = new GeoBuilder();
  const gbMetal = new GeoBuilder();
  const gbDark = new GeoBuilder();
  const gbShutter = new GeoBuilder();
  const gbGlass = new GeoBuilder();
  const gbGlassLit = new GeoBuilder();
  const gbBoardM = new GeoBuilder();
  const gbBoardG = new GeoBuilder();
  const gbDecal = new GeoBuilder();
  const gbPool = new GeoBuilder();
  const gbYellow = new GeoBuilder();
  const boards: BoardAtlas = paintBoards({ A: ZONE_COL.A, B: ZONE_COL.B, atk: ZONE_COL.atk, def: ZONE_COL.def });
  track(boards.tex);
  const stencils = paintStencils();
  track(stencils.tex);
  const CS = SET_SIZE.concrete;
  const lampMats: THREE.Matrix4[] = [];
  const powerMats: THREE.Matrix4[] = [];
  const signs: { x: number; z: number }[] = [];
  const pipeGeo = track(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true));
  const pipe = (gb: GeoBuilder, rn: Run, s: number, h0: number, h1: number, o: number, r: number) => {
    const p = W3(rn, s, (h0 + h1) / 2, o);
    gb.addGeo(pipeGeo, new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion(), new THREE.Vector3(r, h1 - h0, r)), WHITE, 'cyl', 1, 1);
  };
  const hpipe = (gb: GeoBuilder, rn: Run, s0: number, s1: number, h: number, o: number, r: number) => {
    const p = W3(rn, (s0 + s1) / 2, h, o);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...tan(rn)));
    gb.addGeo(pipeGeo, new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(r, Math.abs(s1 - s0), r)), WHITE, 'keep', 1, 1);
  };
  const boardQuad = (glossy: boolean, rn: Run, sc: number, w: number, h0: number, h1: number, o: number, id: BoardId) =>
    wquad(glossy ? gbBoardG : gbBoardM, rn, sc - w / 2, sc + w / 2, h0, h1, o, boards.uv[id]);
  const stencil = (rn: Run, sc: number, w: number, h0: number, h1: number, id: StencilId, col: number) =>
    wquad(gbDecal, rn, sc - w / 2, sc + w / 2, h0, h1, 0.006, stencils.uv[id], new THREE.Color(col));
  const letterRuns = { A: 0, B: 0 };
  const plateDone = { A: 0, B: 0 };
  // 出生区指示牌：选每个出生区内最长的一段墙
  const spawnRun: Partial<Record<'atk' | 'def', Run>> = {};
  for (const rn of runs) {
    if (rn.ext) continue;
    const m = W3(rn, (rn.a + rn.b) / 2, 0, 2);
    const z = zoneAt(m[0], m[2]);
    if (z !== 'atk' && z !== 'def') continue;
    // 面向出生区中心
    const sp = z === 'atk' ? map.attackSpawn : map.defendSpawn;
    const cx = (sp.x0 + sp.x1) / 2,
      cz = (sp.z0 + sp.z1) / 2;
    if ((cx - m[0]) * rn.nx + (cz - m[2]) * rn.nz <= 0) continue;
    const cur = spawnRun[z];
    if (rn.b - rn.a >= 6 && (!cur || rn.b - rn.a > cur.b - cur.a)) spawnRun[z] = rn;
  }

  for (const rn of runs) {
    const L = rn.b - rn.a;
    const nMod = Math.max(1, Math.round(L / CELL));
    const mid = (rn.a + rn.b) / 2;
    const midW = W3(rn, mid, 0, 0);
    const zone: Zone = rn.ext ? 'n' : zoneAt(midW[0] + rn.nx * 2, midW[2] + rn.nz * 2);
    const accent = zone !== 'n';
    const brick = compBrick(rn.comp);
    const gbBody = brick ? gbBrick : gbPlaster;
    const WS = brick ? SET_SIZE.brick : SET_SIZE.plaster;
    // 阴角距离 + 油漆带
    const stripe = accent && !rn.ext ? 1 : 0;
    const zc = new THREE.Color(zone === 'n' ? 0xb8b2a6 : ZONE_COL[zone]);
    gbBody.auxFn = (x, _y, z) => {
      const s = rn.nz !== 0 ? x : z;
      return [rn.convA ? 99 : s - rn.a, rn.convB ? 99 : rn.b - s, stripe, 0];
    };

    // ---- 模块功能分配 ----
    const feats: Feature[] = [];
    let signK = -1;
    if (!rn.ext && nMod >= 2 && (zone === 'n' || zone === 'atk')) {
      const k = Math.floor(nMod / 2);
      const c = W3(rn, rn.a + (k + 0.5) * CELL, 0, 1.3);
      if (!signs.some((s) => Math.hypot(s.x - c[0], s.z - c[2]) < 13)) signK = k;
    }
    const spawnSign = spawnRun.atk === rn ? 'atk' : spawnRun.def === rn ? 'def' : null;
    const spawnK = spawnSign ? Math.floor(nMod / 2) : -99;
    for (let k = 0; k < nMod; k++) {
      const s0 = rn.a + k * CELL;
      const h = hash2(s0 * 0.37 + rn.plane * 1.3, rn.nx * 3 + rn.nz * 7);
      const prev = k > 0 ? feats[k - 1] : 'plain';
      const edge = (k === 0 && rn.convA) || (k === nMod - 1 && rn.convB);
      let f: Feature = 'plain';
      if (rn.ext) f = k % 2 === 1 && !edge ? 'window' : 'plain';
      else if (k === signK || Math.abs(k - spawnK) <= 1) f = 'plain';
      else if ((zone === 'A' || zone === 'B') && letterRuns[zone] < 3 && !edge && nMod >= 3 && k === Math.floor(nMod / 2) - 1 && L >= 6) {
        f = 'stencil';
        letterRuns[zone]++;
      } else if ((zone === 'A' || zone === 'B') && plateDone[zone] < 2 && !edge && prev !== 'stencil' && h > 0.5) {
        f = 'plate';
        plateDone[zone]++;
      } else if (h < 0.3 && !edge) f = 'window';
      else if (h < 0.38 && prev !== 'chalk' && prev !== 'white') f = h < 0.34 ? 'chalk' : 'white';
      else if (h < 0.45 && !edge && prev !== 'door' && nMod >= 3) f = 'door';
      else if (h < 0.51) f = 'posters';
      else if (h < 0.55) f = 'notice';
      else if (h < 0.6) f = 'vent';
      else if (h < 0.64) f = 'power';
      else if (h < 0.7 && zone === 'n') f = 'math';
      feats.push(f);
    }

    // ---- 墙面主体（带洞口） ----
    const doors: [number, number][] = [];
    for (let k = 0; k < nMod; k++) {
      const s0 = rn.a + k * CELL,
        s1 = s0 + CELL,
        sc = s0 + CELL / 2;
      const f = feats[k];
      let hole: [number, number, number, number, number] | null = null; // s0 s1 h0 h1 depth
      if (f === 'window') hole = [sc - 0.62, sc + 0.62, 2.65, 4.2, 0.16];
      if (f === 'door') hole = [sc - 0.9, sc + 0.9, 0, 2.6, 0.24];
      if (!hole) {
        wquad(gbBody, rn, s0, s1, 0, WALL_H, 0, WS, zc);
      } else {
        const [hs0, hs1, h0, h1, D] = hole;
        wquad(gbBody, rn, s0, hs0, 0, WALL_H, 0, WS, zc);
        wquad(gbBody, rn, hs1, s1, 0, WALL_H, 0, WS, zc);
        if (h0 > 0) wquad(gbBody, rn, hs0, hs1, 0, h0, 0, WS, zc);
        wquad(gbBody, rn, hs0, hs1, h1, WALL_H, 0, WS, zc);
        reveal(gbConc, rn, hs0, hs1, h0, h1, D, CS, h0 > 0);
        if (f === 'window') {
          const lit = nightK > 0 && hash2(sc, rn.plane) > 0.45;
          wquad(lit ? gbGlassLit : gbGlass, rn, hs0, hs1, h0, h1, -D + 0.04, [0, 0, 1, 1], glassCols[Math.floor(hash2(sc * 3.1, rn.plane) * 4)]);
          // 窗框与中梃
          lbox(gbDark, rn, hs0, hs1, h0, h0 + 0.06, -D + 0.02, -D + 0.08);
          lbox(gbDark, rn, hs0, hs1, h1 - 0.06, h1, -D + 0.02, -D + 0.08);
          lbox(gbDark, rn, hs0, hs0 + 0.06, h0, h1, -D + 0.02, -D + 0.08);
          lbox(gbDark, rn, hs1 - 0.06, hs1, h0, h1, -D + 0.02, -D + 0.08);
          lbox(gbDark, rn, sc - 0.025, sc + 0.025, h0, h1, -D + 0.03, -D + 0.07);
          lbox(gbDark, rn, hs0, hs1, h0 + 1.0, h0 + 1.04, -D + 0.03, -D + 0.07);
          // 窗台石与过梁
          lbox(gbConc, rn, hs0 - 0.08, hs1 + 0.08, h0 - 0.07, h0, -D, 0.06, CS, 0);
          if (brick) lbox(gbConc, rn, hs0 - 0.16, hs1 + 0.16, h1, h1 + 0.2, 0, 0.025, CS, 4);
        } else {
          doors.push([hs0, hs1]);
          wquad(gbShutter, rn, hs0, hs1, 0, h1, -D + 0.02, SET_SIZE.shutter);
          // 门框角钢、卷帘盒、防撞柱
          lbox(gbDark, rn, hs0 - 0.07, hs0, 0, h1 + 0.05, 0, 0.03);
          lbox(gbDark, rn, hs1, hs1 + 0.07, 0, h1 + 0.05, 0, 0.03);
          lbox(gbMetal, rn, hs0 - 0.1, hs1 + 0.1, h1 + 0.05, h1 + 0.4, 0, 0.13, 1, 0);
          lbox(gbConc, rn, hs0 - 0.1, hs1 + 0.1, h1 + 0.4, h1 + 0.46, 0, 0.15, CS, 0);
          stencilHazard(rn, hs0, hs1);
        }
      }
      // 墙面附属物
      if (f === 'chalk' || f === 'white') {
        const chalk = f === 'chalk';
        const w = chalk ? 1.8 : 1.6,
          hh = chalk ? 1.2 : 1.0;
        const h0 = chalk ? 1.0 : 1.15;
        const id: BoardId = chalk ? (['chalk1', 'chalk2', 'chalk3'] as const)[Math.floor(hash2(sc, 9) * 3)] : hash2(sc, 4) > 0.5 ? 'white1' : 'white2';
        lbox(chalk ? gbDark : gbMetal, rn, sc - w / 2 - 0.04, sc + w / 2 + 0.04, h0 - 0.04, h0 + hh + 0.04, 0, 0.035, 1, 0);
        boardQuad(!chalk, rn, sc, w, h0, h0 + hh, 0.036, id);
        lbox(gbMetal, rn, sc - w / 2, sc + w / 2, h0 - 0.08, h0 - 0.05, 0, 0.09, 1, 0);
      } else if (f === 'posters') {
        for (const d of [-0.42, 0.42]) {
          const id = (['poster1', 'poster2', 'poster3', 'poster4'] as const)[Math.floor(hash2(sc + d, rn.plane) * 4)];
          boardQuad(false, rn, sc + d, 0.6, 1.35, 2.2, 0.008, id);
        }
      } else if (f === 'notice') {
        lbox(gbDark, rn, sc - 0.65, sc + 0.65, 1.15, 2.15, 0, 0.04, 1, 0);
        boardQuad(false, rn, sc, 1.2, 1.2, 2.1, 0.042, 'notice');
      } else if (f === 'vent') {
        lbox(gbDark, rn, sc - 0.5, sc + 0.5, 0.6, 1.25, 0, 0.04, 1, 0);
        for (let i = 0; i < 6; i++) lbox(gbMetal, rn, sc - 0.46, sc + 0.46, 0.66 + i * 0.1, 0.71 + i * 0.1, 0.03, 0.07, 1, 0);
      } else if (f === 'stencil') {
        const id = zone === 'A' ? 'A' : 'B';
        stencil(rn, sc, 2.2, 1.45, 3.65, id, ZONE_COL[id]);
      } else if (f === 'plate') {
        const id = zone === 'A' ? 'plateA' : 'plateB';
        lbox(gbDark, rn, sc - 0.56, sc + 0.56, 2.84, 3.96, 0, 0.03, 1, 0);
        boardQuad(true, rn, sc, 1.0, 2.9, 3.9, 0.032, id);
      } else if (f === 'math') {
        const id = (['pi', 'sum', 'sqrt', 'phi'] as const)[Math.floor(hash2(sc, 2) * 4)];
        stencil(rn, sc, 1.3, 1.5, 2.8, id, 0xcfcac0);
      } else if (f === 'power') {
        const m = new THREE.Matrix4();
        const p = W3(rn, sc, 1.45, 0.075);
        m.compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(rn.nx, rn.nz)), new THREE.Vector3(1.5, 1.5, 1.5));
        powerMats.push(m);
        pipe(gbDark, rn, sc + 0.12, 1.85, 3.3, 0.05, 0.025);
      }
    }

    // ---- 线脚：勒脚、檐口、压顶 ----
    const ext = (conv: boolean, out: number) => (conv ? out : 0);
    const sA = (o: number) => rn.a - ext(rn.convA, o);
    const sB = (o: number) => rn.b + ext(rn.convB, o);
    // 勒脚（门洞处断开）
    {
      let cur = sA(0.04);
      const segs: [number, number][] = [];
      for (const [d0, d1] of doors.sort((p, q) => p[0] - q[0])) {
        segs.push([cur, d0 - 0.07]);
        cur = d1 + 0.07;
      }
      segs.push([cur, sB(0.04)]);
      for (const [p, q] of segs) if (q - p > 0.05) lbox(gbConc, rn, p, q, 0, 0.42, 0, 0.04, CS, 4);
    }
    lbox(gbConc, rn, sA(0.08), sB(0.08), 4.72, 4.92, 0, 0.08, CS, 0);
    lbox(gbConc, rn, sA(0.06), sB(0.06), 4.92, 5.0, 0, 0.05, CS, 0);
    lbox(gbConc, rn, sA(0.07), sB(0.07), 5.2, 5.32, -0.35, 0.07, CS, 4);
    lbox(gbConc, rn, sA(0.07), sB(0.07), WALL_H - 0.001, 5.2, 0, 0.07, CS, 4 | 8);
    // 阳角隅石
    for (const [conv, s] of [
      [rn.convA, rn.a],
      [rn.convB, rn.b],
    ] as const) {
      if (!conv) continue;
      const dir = s === rn.a ? 1 : -1;
      lbox(gbConc, rn, Math.min(s - 0.05 * dir, s + 0.5 * dir), Math.max(s - 0.05 * dir, s + 0.5 * dir), 0.42, 4.72, 0, 0.05, CS, 4);
    }

    // ---- 壁灯、落水管、线槽（仅内侧墙面） ----
    if (!rn.ext) {
      let lastLamp = -99;
      for (let k = 1; k < nMod; k++) {
        const s = rn.a + k * CELL;
        const left = feats[k - 1],
          right = feats[k];
        if (left === 'door' || right === 'door') continue;
        const hh = hash2(s * 1.7, rn.plane * 0.3);
        if (s - lastLamp >= 9 && hh > 0.25) {
          const p = W3(rn, s, 3.05, 0);
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(...p),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(rn.nx, rn.nz)),
            new THREE.Vector3(1.2, 1.2, 1.2),
          );
          lampMats.push(m);
          lastLamp = s;
          const w = W3(rn, s, 3.05, 0.3);
          const imp = zone !== 'n' ? 2 : 1;
          lamps.push({ x: w[0], y: 2.9, z: w[2], nx: rn.nx, nz: rn.nz, weight: imp });
          if (night) {
            const pc = new THREE.Color(1, 0.78, 0.5).multiplyScalar(0.3 * nightK);
            wquad(gbPool, rn, s - 1.5, s + 1.5, 0.6, 4.0, 0.012, [0, 0, 1, 1], pc);
          }
        } else if (hh < 0.18 && left !== 'window' && right !== 'window') {
          // 落水管 + 管卡
          pipe(gbMetal, rn, s, 0.12, 4.72, 0.09, 0.055);
          lbox(gbMetal, rn, s - 0.13, s + 0.13, 4.5, 4.72, 0, 0.18, 1, 0);
          for (let y = 0.9; y < 4.5; y += 1.4) lbox(gbDark, rn, s - 0.07, s + 0.07, y, y + 0.05, 0, 0.12, 1, 0);
          lbox(gbMetal, rn, s - 0.07, s + 0.07, 0.02, 0.14, 0.03, 0.15, 1, 0);
        }
      }
      // 线槽（无门的长墙）
      if (L >= 8 && !doors.length && hash2(rn.plane, rn.a) > 0.35) {
        hpipe(gbMetal, rn, rn.a + 0.6, rn.b - 0.6, 2.42, 0.045, 0.03);
        for (let s = rn.a + 1.4; s < rn.b - 0.6; s += 5.8) lbox(gbMetal, rn, s - 0.13, s + 0.13, 2.32, 2.54, 0, 0.1, 1, 0);
      }
    }

    // ---- 路口指示牌 ----
    if (signK >= 0) {
      const cx = rn.a + (signK + 0.5) * CELL;
      const from = W3(rn, cx, 0, 1.3);
      const fromV = { x: from[0], z: from[2] };
      const R = [rn.nz, -rn.nx];
      let h = 2.15;
      let placed = false;
      for (const id of ['A', 'B'] as const) {
        const ahead = pathAhead(fromV, map.siteCenter(id));
        if (!ahead) continue;
        const dx = ahead.x - fromV.x,
          dz = ahead.z - fromV.z;
        const t = dx * R[0] + dz * R[1];
        if (Math.abs(t) < 0.45 * Math.hypot(dx, dz)) continue;
        const sid: BoardId = id === 'A' ? (t < 0 ? 'signAL' : 'signAR') : t < 0 ? 'signBL' : 'signBR';
        lbox(gbDark, rn, cx - 0.62, cx + 0.62, h - 0.39, h + 0.01, 0, 0.02, 1, 0);
        boardQuad(true, rn, cx, 1.2, h - 0.37, h - 0.01, 0.022, sid);
        h -= 0.46;
        placed = true;
      }
      if (placed) signs.push({ x: from[0], z: from[2] });
    }
    if (spawnSign) {
      const cx = rn.a + (Math.floor(nMod / 2) + 0.5) * CELL;
      lbox(gbDark, rn, cx - 1.24, cx + 1.24, 3.08, 3.54, 0, 0.03, 1, 0);
      boardQuad(true, rn, cx, 2.4, 3.1, 3.52, 0.032, spawnSign === 'atk' ? 'signAtk' : 'signDef');
      boardQuad(true, rn, cx + (hash2(cx, 1) > 0.5 ? 2.2 : -2.2), 1.4, 3.6, 4.1, 0.01, 'plaque');
    }
    gbBody.auxFn = null;
  }

  /** 卷帘门两侧的黑黄警示漆 */
  function stencilHazard(rn: Run, hs0: number, hs1: number): void {
    for (const s of [hs0 - 0.2, hs1 + 0.2]) {
      lbox(gbYellow, rn, s - 0.08, s + 0.08, 0, 1.0, 0, 0.12, 1, 0);
      lbox(gbDark, rn, s - 0.085, s + 0.085, 0.62, 0.72, 0, 0.125, 1, 0);
    }
  }

  // ---- 墙顶 ----
  for (const p of map.pieces) if (p.kind === 'wall') gbConc.box(p.box.x0, p.box.y1 - 0.01, p.box.z0, p.box.x1, p.box.y1 + 0.005, p.box.z1, WHITE, CS, 1 | 2 | 4 | 16 | 32);

  // ---- 屋顶空调机组（高于墙顶，不参与碰撞） ----
  const gbFan = new GeoBuilder();
  for (const p of map.pieces) {
    if (p.kind !== 'wall') continue;
    const b = p.box;
    const w = b.x1 - b.x0,
      d = b.z1 - b.z0;
    if (w * d < 10 || w < 3.2 || d < 3.2) continue;
    if (hash2(b.x0, b.z0) < 0.35) continue;
    const cx = b.x0 + w * (0.3 + hash2(b.z0, 1) * 0.4),
      cz = b.z0 + d * (0.3 + hash2(b.x0, 2) * 0.4);
    const rotX = w > d;
    const hw = rotX ? 0.75 : 0.55,
      hd = rotX ? 0.55 : 0.75;
    gbShutter.box(cx - hw, 5.32, cz - hd, cx + hw, 6.3, cz + hd, WHITE, 1, 4);
    gbConc.box(cx - hw - 0.1, 5.2, cz - hd - 0.1, cx + hw + 0.1, 5.32, cz + hd + 0.1, WHITE, CS, 4);
    gbFan.addGeo(pipeGeo, new THREE.Matrix4().compose(new THREE.Vector3(cx, 6.33, cz), new THREE.Quaternion(), new THREE.Vector3(0.42, 0.06, 0.42)), WHITE, 'keep');
  }

  // ================= 网格 =================
  const mBoardM = track(new THREE.MeshStandardMaterial({ map: boards.tex, roughness: 0.82, metalness: 0 }));
  const mBoardG = track(
    new THREE.MeshStandardMaterial({ map: boards.tex, roughness: 0.28, metalness: 0, emissiveMap: boards.tex, emissive: 0xffffff, emissiveIntensity: nightK * 0.45 }),
  );
  const mDecal = mat({ kind: 'decal', vertexColors: true, roughness: 0.62, macro: 0.1 });
  mDecal.map = stencils.tex;
  mDecal.alphaTest = 0.5;
  mDecal.polygonOffset = true;
  mDecal.polygonOffsetFactor = -2;
  mDecal.polygonOffsetUnits = -2;
  const poolTex = track(paintPool());
  const mPool = track(
    new THREE.MeshBasicMaterial({ map: poolTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
  );
  addMesh(gbPlaster.build(true), mPlaster);
  addMesh(gbBrick.build(true), mBrick);
  addMesh(gbConc.build(), mConcrete);
  addMesh(gbMetal.build(), mMetal);
  addMesh(gbDark.build(), mDark);
  addMesh(gbFan.build(), mDark);
  addMesh(gbShutter.build(), mShutter);
  addMesh(gbYellow.build(), mat({ color: 0xd4a017, roughness: 0.55, metalness: 0.3, macro: 0.35 }));
  addMesh(gbGlass.build(), mGlass, false, true);
  addMesh(gbGlassLit.build(), mGlassLit, false, true);
  addMesh(gbBoardM.build(), mBoardM, false, true);
  addMesh(gbBoardG.build(), mBoardG, false, true);
  addMesh(gbDecal.build(), mDecal, false, true);
  if (night) addMesh(gbPool.build(), mPool, false, false);

  // ================= 道具：壁灯 / 配电箱 =================
  {
    const glassMat = track((propParts('lamp').find((p) => /glass/.test(p.name))?.mat ?? new THREE.MeshStandardMaterial()).clone());
    glassMat.emissive = new THREE.Color(1, 0.8, 0.55);
    glassMat.emissiveIntensity = nightK > 0 ? 6 * nightK : 0;
    glassMat.transparent = false;
    glassMat.opacity = 1;
    for (const im of instancedProp('lamp', lampMats, undefined, (p) => (/glass/.test(p.name) ? glassMat : null))) {
      track(im);
      im.castShadow = false;
      group.add(im);
    }
    for (const im of instancedProp('powerBox', powerMats)) {
      track(im);
      group.add(im);
    }
    // 夜间地面光斑
    if (night && lamps.length) {
      const roundTex = track(paintRound());
      const gb = new GeoBuilder();
      for (const l of lamps) {
        const x = l.x + l.nx * 0.6,
          z = l.z + l.nz * 0.6;
        const r = 2.3;
        gb.quad([x - r, 0.012, z + r], [x + r, 0.012, z + r], [x + r, 0.012, z - r], [x - r, 0.012, z - r], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], new THREE.Color(1, 0.78, 0.5).multiplyScalar(0.22 * nightK));
      }
      const m = track(
        new THREE.MeshBasicMaterial({ map: roundTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
      );
      addMesh(gb.build(), m, false, false);
    }
  }

  // ================= 掩体 =================
  // 高掩体：胶合板运输箱（照片扫描胶合板材质 + 木条框架 + 喷漆标记），外轮廓与碰撞盒完全一致；
  // 矮掩体：照片扫描木箱堆码（Poly Haven wooden_crate_02），逐层交错，外轮廓贴合碰撞盒。
  {
    const list: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const cr = seeded(23);
    const gbPly = new GeoBuilder();
    const gbCrDecal = new GeoBuilder();
    const PS = SET_SIZE.plywood;
    const plyTints = [new THREE.Color(1, 0.98, 0.95), new THREE.Color(0.8, 0.8, 0.78), new THREE.Color(0.6, 0.68, 0.52), new THREE.Color(0.9, 0.86, 0.8)];
    const plyCrate = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tint: THREE.Color) => {
      const t = 0.04; // 木条厚度
      const bw = 0.11; // 木条宽度
      const bat = tint.clone().multiplyScalar(0.62);
      // 面板（内缩）
      gbPly.box(x0 + t, y0, z0 + t, x1 - t, y1 - t, z1 - t, tint, PS, 4);
      // 四角立柱
      for (const [cx, cz] of [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ]) {
        const ax = cx === x0 ? x0 : x1 - bw,
          az = cz === z0 ? z0 : z1 - bw;
        gbPly.box(ax, y0, az, ax + bw, y1, az + bw, bat, PS, 4);
      }
      // 上下腰带木条（四个面）
      const bands = y1 - y0 > 1.0 ? [y0, (y0 + y1) / 2 - bw / 2, y1 - bw] : [y0, y1 - bw];
      for (const by of bands) {
        gbPly.box(x0 + bw, by, z1 - t, x1 - bw, by + bw, z1, bat, PS, 4);
        gbPly.box(x0 + bw, by, z0, x1 - bw, by + bw, z0 + t, bat, PS, 4);
        gbPly.box(x1 - t, by, z0 + bw, x1, by + bw, z1 - bw, bat, PS, 4);
        gbPly.box(x0, by, z0 + bw, x0 + t, by + bw, z1 - bw, bat, PS, 4);
      }
      // 顶面框条
      gbPly.box(x0 + bw, y1 - t, z0, x1 - bw, y1, z0 + bw, bat, PS, 4);
      gbPly.box(x0 + bw, y1 - t, z1 - bw, x1 - bw, y1, z1, bat, PS, 4);
      gbPly.box(x0, y1 - t, z0 + bw, x0 + bw, y1, z1 - bw, bat, PS, 4);
      gbPly.box(x1 - bw, y1 - t, z0 + bw, x1, y1, z1 - bw, bat, PS, 4);
      // 侧面喷漆标记
      const ink = new THREE.Color(0x1b1b1b);
      const h = hash2(x0 * 3.3 + y0, z0 * 1.7);
      const ids: StencilId[] = ['up', 'fragile', 'batch', 'logo'];
      const sz = Math.min(0.55, (y1 - y0) * 0.45);
      const yc = (y0 + y1) / 2 + (bands.length === 3 ? (y1 - y0) * 0.22 : 0);
      const put = (face: number, id: StencilId) => {
        const [u0, v0, u1, v1] = stencils.uv[id];
        const o = 0.004 - t;
        if (face === 0) gbCrDecal.quad([(x0 + x1) / 2 - sz, yc - sz, z1 + o], [(x0 + x1) / 2 + sz, yc - sz, z1 + o], [(x0 + x1) / 2 + sz, yc + sz, z1 + o], [(x0 + x1) / 2 - sz, yc + sz, z1 + o], [0, 0, 1], [u0, v0, u1, v0, u1, v1, u0, v1], ink);
        if (face === 1) gbCrDecal.quad([(x0 + x1) / 2 + sz, yc - sz, z0 - o], [(x0 + x1) / 2 - sz, yc - sz, z0 - o], [(x0 + x1) / 2 - sz, yc + sz, z0 - o], [(x0 + x1) / 2 + sz, yc + sz, z0 - o], [0, 0, -1], [u0, v0, u1, v0, u1, v1, u0, v1], ink);
        if (face === 2) gbCrDecal.quad([x1 + o, yc - sz, (z0 + z1) / 2 + sz], [x1 + o, yc - sz, (z0 + z1) / 2 - sz], [x1 + o, yc + sz, (z0 + z1) / 2 - sz], [x1 + o, yc + sz, (z0 + z1) / 2 + sz], [1, 0, 0], [u0, v0, u1, v0, u1, v1, u0, v1], ink);
        if (face === 3) gbCrDecal.quad([x0 - o, yc - sz, (z0 + z1) / 2 - sz], [x0 - o, yc - sz, (z0 + z1) / 2 + sz], [x0 - o, yc + sz, (z0 + z1) / 2 + sz], [x0 - o, yc + sz, (z0 + z1) / 2 - sz], [-1, 0, 0], [u0, v0, u1, v0, u1, v1, u0, v1], ink);
      };
      put(Math.floor(h * 4), ids[Math.floor(h * 16) % 4]);
      put((Math.floor(h * 4) + 2) % 4, ids[(Math.floor(h * 16) + 1) % 4]);
    };
    for (const p of map.pieces) {
      if (p.kind === 'wall') continue;
      const b = p.box;
      const high = p.kind === 'crateHigh';
      const usePly = high || hash2(b.x0, b.z0) > 0.55;
      if (!usePly) {
        crateStack(b, false, cr, list);
        continue;
      }
      const tint = plyTints[Math.floor(hash2(b.z0, b.x0) * plyTints.length)];
      const lenX = b.x1 - b.x0,
        lenZ = b.z1 - b.z0;
      // 长条掩体拆成两只箱子；高掩体上下两层（上层略小的高度）
      const n = Math.max(1, Math.round(Math.max(lenX, lenZ) / 1.9));
      const layers = high ? [b.y0, b.y0 + 1.25, b.y1] : [b.y0, b.y1];
      for (let i = 0; i < n; i++) {
        const a0 = i / n,
          a1 = (i + 1) / n;
        const gap = 0.012;
        const cx0 = lenX >= lenZ ? b.x0 + lenX * a0 + (i > 0 ? gap : 0) : b.x0;
        const cx1 = lenX >= lenZ ? b.x0 + lenX * a1 - (i < n - 1 ? gap : 0) : b.x1;
        const cz0 = lenX >= lenZ ? b.z0 : b.z0 + lenZ * a0 + (i > 0 ? gap : 0);
        const cz1 = lenX >= lenZ ? b.z1 : b.z0 + lenZ * a1 - (i < n - 1 ? gap : 0);
        for (let L = 0; L < layers.length - 1; L++) plyCrate(cx0, layers[L], cz0, cx1, layers[L + 1], cz1, plyTints[(Math.floor(hash2(cx0 + L, cz0) * 4) + L) % 4].clone().lerp(tint, 0.5));
      }
    }
    addMesh(gbCrDecal.build(), mDecal, false, true);
    addMesh(gbPly.build(), mat({ set: 'plywood', vertexColors: true, color: 0xe0d4c4, macro: 0.4 }));
    for (const im of instancedProp(
      'crate',
      list.map((l) => l.m),
      list.map((l) => l.c),
    )) {
      track(im);
      group.add(im);
    }
  }

  // ================= 地面 =================
  const rect = { x0: -HALF_W, z0: -HALF_D, w: HALF_W * 2, d: HALF_D * 2 };
  {
    const walls = map.pieces.filter((p) => p.kind === 'wall').map((p) => p.box);
    const crates = map.pieces.filter((p) => p.kind !== 'wall').map((p) => p.box);
    const site = (id: 'A' | 'B') => ({ id, ...map.sites[id], col: ZONE_COL[id] });
    const { paint, mask } = paintFloor({
      rect,
      sites: [site('A'), site('B')],
      spawns: [
        { text: '进攻方出发区', ...map.attackSpawn, col: ZONE_COL.atk, flip: false },
        { text: '防守方出发区', ...map.defendSpawn, col: ZONE_COL.def, flip: true },
      ],
      routes: [
        { pts: routeA, col: ZONE_COL.A, label: 'A' },
        { pts: routeB, col: ZONE_COL.B, label: 'B' },
      ],
      walls,
      crates,
      numberLine: { x0: -9, x1: 9, z: 21.2 },
    });
    // 画布第 0 行 = 北侧（z0），与着色器中 (z - z0) / d 对应
    paint.flipY = false;
    mask.flipY = false;
    track(paint);
    track(mask);
    const mFloor = mat({
      set: 'granite',
      kind: 'floor',
      color: new THREE.Color(1.12, 1.08, 1.0),
      macro: 0.4,
      extraUniforms: {
        tBDiff: { value: setTex('brushed', 'diff') },
        tBNor: { value: setTex('brushed', 'nor') },
        tBArm: { value: setTex('brushed', 'arm') },
        tMask: { value: mask },
        tPaint: { value: paint },
        uRect: { value: new THREE.Vector4(rect.x0, rect.z0, rect.w, rect.d) },
        uBScale: { value: 1.0 },
      },
    });
    const gb = new GeoBuilder();
    const S = SET_SIZE.granite;
    // 4m 网格细分，便于阴影 / 雾的插值
    for (let x = rect.x0; x < rect.x0 + rect.w - 0.01; x += 4)
      for (let z = rect.z0; z < rect.z0 + rect.d - 0.01; z += 4) {
        const x1 = Math.min(x + 4, rect.x0 + rect.w),
          z1 = Math.min(z + 4, rect.z0 + rect.d);
        gb.quad([x, 0, z1], [x1, 0, z1], [x1, 0, z], [x, 0, z], [0, 1, 0], [x / S, -z1 / S, x1 / S, -z1 / S, x1 / S, -z / S, x / S, -z / S]);
      }
    addMesh(gb.build(), mFloor, false, true);
  }

  // ================= 周边：铺装、草地、教学楼、钟楼、树木 =================
  buildSurroundings();

  // ================= 目标区旗杆 =================
  buildFlags();

  // 只在需要的物体上投射阴影；其余略
  return { group, disposables, animated, envMats, lamps };

  // ------------------------------------------------------------------------------------------
  function buildSurroundings(): void {
    // 外围铺装与草地
    const mApron = mat({ set: 'granite', color: 0xd8d2c8, macro: 0.35 });
    const mGrass = mat({ set: 'grass', color: 0x98c070, macro: 0.5 });
    const ap = new GeoBuilder();
    const AX = 58,
      AZ = 62;
    const S = SET_SIZE.granite;
    const ring = (gb: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, s: number) =>
      gb.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [x0 / s, -z1 / s, x1 / s, -z1 / s, x1 / s, -z0 / s, x0 / s, -z0 / s]);
    ring(ap, -AX, -AZ, AX, -HALF_D, -0.01, S);
    ring(ap, -AX, HALF_D, AX, AZ, -0.01, S);
    ring(ap, -AX, -HALF_D, -HALF_W, HALF_D, -0.01, S);
    ring(ap, HALF_W, -HALF_D, AX, HALF_D, -0.01, S);
    addMesh(ap.build(), mApron, false, true);
    const gg = new GeoBuilder();
    const G = 900,
      GS = SET_SIZE.grass * 1.5;
    ring(gg, -G, -G, G, -AZ, -0.03, GS);
    ring(gg, -G, AZ, G, G, -0.03, GS);
    ring(gg, -G, -AZ, -AX, AZ, -0.03, GS);
    ring(gg, AX, -AZ, G, AZ, -0.03, GS);
    addMesh(gg.build(), mGrass, false, true);

    // ---- 教学楼 ----
    const winUniforms = (lit: number) => ({
      uWin: { value: new THREE.Vector4(3.4, 3.6, 1.9, 2.1) },
      uWin2: { value: new THREE.Vector4(0.95, 0.4, lit, 1.4) },
    });
    const mFacBrick = mat({ set: 'brick', kind: 'facade', color: 0xf0e6de, macro: 0.25, extraUniforms: winUniforms(0.4) });
    const mFacPlaster = mat({ set: 'plaster', kind: 'facade', color: 0xeadfcc, macro: 0.3, extraUniforms: winUniforms(0.35) });
    const fb = new GeoBuilder(),
      fp = new GeoBuilder();
    const bays = 3.4;
    const facade = (gb: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, H: number, windows: boolean, size: number) => {
      // 四个立面：(起点, 终点, 法线)
      const faces: [number, number, number, number, V3][] = [
        [x0, z1, x1, z1, [0, 0, 1]],
        [x1, z0, x0, z0, [0, 0, -1]],
        [x1, z1, x1, z0, [1, 0, 0]],
        [x0, z0, x0, z1, [-1, 0, 0]],
      ];
      for (const [ax, az, bx, bz, n] of faces) {
        const L = Math.hypot(bx - ax, bz - az);
        const nb = Math.floor((L - 2.4) / bays);
        const margin = (L - nb * bays) / 2;
        gb.aux = [0, 0, windows && nb > 0 ? nb * bays : -1, H];
        // 立面坐标 u 从 margin 处开始为 0
        gb.auxFn = (x, y, z) => [Math.hypot(x - ax, z - az) - margin, y - y0, windows && nb > 0 ? nb * bays : -1, H];
        gb.quad([ax, y0, az], [bx, y0, bz], [bx, y0 + H, bz], [ax, y0 + H, az], n, [0, y0 / size, L / size, y0 / size, L / size, (y0 + H) / size, 0, (y0 + H) / size]);
        gb.auxFn = null;
      }
    };
    const cornice = (x0: number, z0: number, x1: number, z1: number, H: number) => {
      gbConc2.box(x0 - 0.18, H - 0.5, z0 - 0.18, x1 + 0.18, H - 0.25, z1 + 0.18, WHITE, CS, 4);
      gbConc2.box(x0 - 0.1, H - 0.25, z0 - 0.1, x1 + 0.1, H + 0.6, z1 + 0.1, WHITE, CS, 4 | 8);
      gbConc2.box(x0 - 0.15, H + 0.6, z0 - 0.15, x1 + 0.15, H + 0.72, z1 + 0.15, WHITE, CS, 4);
      gbConc2.box(x0 + 0.1, H - 0.1, z0 + 0.1, x1 - 0.1, H + 0.0, z1 - 0.1, WHITE, CS, 1 | 2 | 4 | 16 | 32);
      gbConc2.box(x0 - 0.05, 0, z0 - 0.05, x1 + 0.05, 0.75, z1 + 0.05, WHITE, CS, 4 | 8);
      // 屋顶设备
      const br = seeded(Math.floor(x0 * 13 + z0 * 7));
      for (let i = 0; i < 3; i++) {
        const cx = x0 + 2 + br() * (x1 - x0 - 4),
          cz = z0 + 2 + br() * (z1 - z0 - 4);
        gbShutter2.box(cx - 0.9, H, cz - 0.7, cx + 0.9, H + 1.3, cz + 0.7, WHITE, 1, 4);
      }
    };
    const gbConc2 = new GeoBuilder();
    const gbShutter2 = new GeoBuilder();
    const clockGB = new GeoBuilder();
    const domeGB = new GeoBuilder();
    const blds: [number, number, number, number, number, boolean][] = [
      // x0, z0, x1, z1, 高, 砖
      [-50, 40, -20, 54, 16, true],
      [-14, 39, 14, 52, 12.5, false],
      [20, 40, 50, 54, 17, true],
      [-50, -54, -18, -40, 15, false],
      [18, -54, 50, -40, 14, true],
      [-15, -70, 15, -58, 9, true],
      [-52, -30, -38, -5, 13, true],
      [-52, 3, -38, 32, 16, false],
      [38, -30, 52, -4, 17, false],
      [38, 4, 52, 32, 13, true],
    ];
    const bboxes: Rect[] = [];
    for (const [x0, z0, x1, z1, H, br] of blds) {
      facade(br ? fb : fp, x0, z0, x1, z1, 0, H, true, br ? SET_SIZE.brick : SET_SIZE.plaster);
      cornice(x0, z0, x1, z1, H);
      bboxes.push({ x0: x0 - 2, z0: z0 - 2, x1: x1 + 2, z1: z1 + 2 });
    }
    // ---- 北侧双钟楼（方位地标）----
    const tw = 4;
    for (const cx of [-9, 9]) {
      const cz = -64;
      const TH = 43;
      const dy = TH - 33;
      facade(fb, cx - tw, cz - tw, cx + tw, cz + tw, 9, TH - 9, false, SET_SIZE.brick);
      // 隅石与腰线
      for (const [qx, qz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ])
        gbConc2.box(cx + qx * tw - 0.35, 9, cz + qz * tw - 0.35, cx + qx * tw + 0.35, TH, cz + qz * tw + 0.35, WHITE, CS, 4);
      for (const y of [15, 21 + dy / 2, 27.2 + dy]) gbConc2.box(cx - tw - 0.2, y, cz - tw - 0.2, cx + tw + 0.2, y + 0.4, cz + tw + 0.2, WHITE, CS, 0);
      // 钟面（四面）
      for (const [nx, nz] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        const px = cx + nx * (tw + 0.08),
          pz = cz + nz * (tw + 0.08);
        const r = 1.7;
        const L0: V3 = nz !== 0 ? [px - r * nz, 22.9 + dy, pz] : [px, 22.9 + dy, pz + r * nx];
        const R0: V3 = nz !== 0 ? [px + r * nz, 22.9 + dy, pz] : [px, 22.9 + dy, pz - r * nx];
        const [u0, v0, u1, v1] = boards.uv.clock;
        clockGB.quad(L0, R0, [R0[0], 26.3 + dy, R0[2]], [L0[0], 26.3 + dy, L0[2]], [nx, 0, nz], [u0, v0, u1, v0, u1, v1, u0, v1]);
        gbConc2.box(Math.min(L0[0], R0[0]) - 0.25 * Math.abs(nz), 22.65 + dy, Math.min(L0[2], R0[2]) - 0.25 * Math.abs(nx), Math.max(L0[0], R0[0]) + 0.25 * Math.abs(nz), 22.9 + dy, Math.max(L0[2], R0[2]) + 0.25 * Math.abs(nx), WHITE, CS, 0);
      }
      // 顶部：八角鼓座 + 穹顶 + 尖顶
      gbConc2.box(cx - tw - 0.3, TH, cz - tw - 0.3, cx + tw + 0.3, TH + 0.6, cz + tw + 0.3, WHITE, CS, 0);
      const drum = track(new THREE.CylinderGeometry(3.3, 3.3, 3.2, 8, 1));
      gbConc2.addGeo(drum, new THREE.Matrix4().makeTranslation(cx, TH + 2.2, cz), WHITE, 'planar', CS);
      const dome = track(new THREE.SphereGeometry(3.5, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2));
      domeGB.addGeo(dome, new THREE.Matrix4().makeTranslation(cx, TH + 3.8, cz), WHITE, 'keep');
      const spire = track(new THREE.ConeGeometry(0.25, 3.2, 8));
      domeGB.addGeo(spire, new THREE.Matrix4().makeTranslation(cx, TH + 8.6, cz), WHITE, 'keep');
      bboxes.push({ x0: cx - 6, z0: cz - 6, x1: cx + 6, z1: cz + 6 });
    }
    addMesh(fb.build(true), mFacBrick);
    addMesh(fp.build(true), mFacPlaster);
    addMesh(gbConc2.build(), mConcrete);
    addMesh(gbShutter2.build(), mShutter);
    addMesh(clockGB.build(), mBoardG, false, true);
    addMesh(domeGB.build(), mat({ color: 0x5d8a76, roughness: 0.42, metalness: 0.75, macro: 0.3 }));
    // 立面属性改名：aux → aFac
    for (const o of group.children) {
      if (!(o instanceof THREE.Mesh)) continue;
      const m = o.material as THREE.Material;
      if (m !== mFacBrick && m !== mFacPlaster) continue;
      const g = o.geometry as THREE.BufferGeometry;
      g.setAttribute('aFac', g.getAttribute('aux'));
      g.deleteAttribute('aux');
      g.deleteAttribute('aZone');
    }

    // ---- 树 ----
    const leafTex = track(paintLeaves(leafPhoto()));
    const mLeaf = track(
      new THREE.MeshStandardMaterial({
        map: leafTex,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.75,
        color: mood === 'dusk' ? 0xe0dccc : 0xffffff,
      }),
    );
    const mBark = mat({ color: 0xb8aca0, roughness: 0.95, macro: 0.2 });
    mBark.map = barkTex();
    const spots: Vec2[] = [];
    const tr = seeded(91);
    const okSpot = (x: number, z: number) => !bboxes.some((b) => inRect(b, x, z)) && !spots.some((p) => Math.hypot(p.x - x, p.z - z) < 4.5);
    // 围墙外侧一圈（树冠高出墙顶）
    for (let t = -HALF_W + 3; t <= HALF_W - 3; t += 7.5) {
      for (const z of [-HALF_D - 3.2, HALF_D + 3.2]) {
        const x = t + (tr() - 0.5) * 2;
        if (okSpot(x, z)) spots.push({ x, z });
      }
    }
    for (let t = -HALF_D + 3; t <= HALF_D - 3; t += 7.5) {
      for (const x of [-HALF_W - 3.2, HALF_W + 3.2]) {
        const z = t + (tr() - 0.5) * 2;
        if (okSpot(x, z)) spots.push({ x, z });
      }
    }
    // 远处
    for (let i = 0; i < 400 && spots.length < 150; i++) {
      const a = tr() * Math.PI * 2,
        r = 58 + tr() * 90;
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      if (okSpot(x, z)) spots.push({ x, z });
    }
    const variants = [makeTree(11), makeTree(29), makeTree(47)];
    variants.forEach((v, vi) => {
      track(v.trunk);
      track(v.leaves);
      const mine = spots.filter((_, i) => i % 3 === vi);
      if (!mine.length) return;
      const trunk = new THREE.InstancedMesh(v.trunk, mBark, mine.length);
      const leaves = new THREE.InstancedMesh(v.leaves, mLeaf, mine.length);
      mine.forEach((p, i) => {
        const far = Math.hypot(p.x, p.z) > 55;
        const s = (far ? 1.3 : 1.0) * (0.85 + tr() * 0.35);
        const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr() * 6.28), new THREE.Vector3(s, s, s));
        trunk.setMatrixAt(i, m);
        leaves.setMatrixAt(i, m);
        const c = new THREE.Color().setHSL(0.22 + tr() * 0.06, 0.25 + tr() * 0.2, 0.42 + tr() * 0.12).multiplyScalar(2.1);
        leaves.setColorAt(i, c);
      });
      trunk.computeBoundingSphere();
      leaves.computeBoundingSphere();
      trunk.castShadow = leaves.castShadow = true;
      trunk.receiveShadow = leaves.receiveShadow = true;
      track(trunk);
      track(leaves);
      group.add(trunk, leaves);
    });

    // ---- 路灯（外围铺装） ----
    const lampPos: THREE.Matrix4[] = [];
    for (let t = -HALF_W + 8; t <= HALF_W - 8; t += 16) for (const z of [-HALF_D - 5.5, HALF_D + 5.5]) lampPos.push(new THREE.Matrix4().makeTranslation(t, 0, z));
    for (let t = -HALF_D + 8; t <= HALF_D - 8; t += 16) for (const x of [-HALF_W - 5.5, HALF_W + 5.5]) lampPos.push(new THREE.Matrix4().makeTranslation(x, 0, t));
    const slGlass = track((propParts('streetLamp').find((p) => /glass/.test(p.name))?.mat ?? new THREE.MeshStandardMaterial()).clone());
    slGlass.emissive = new THREE.Color(1, 0.82, 0.6);
    slGlass.emissiveIntensity = nightK * 5;
    for (const im of instancedProp('streetLamp', lampPos, undefined, (p) => (/glass/.test(p.name) ? slGlass : null))) {
      track(im);
      group.add(im);
    }
  }

  function buildFlags(): void {
    const poleMat = mMetal;
    const gbPole = new GeoBuilder();
    for (const id of ['A', 'B'] as const) {
      const c = map.siteCenter(id);
      // 离目标区中心最近的墙体单元：旗杆立在墙顶（高于头顶，不影响碰撞）
      let best: Vec2 | null = null,
        bd = 1e9;
      for (let r = 0; r < ROWS; r++)
        for (let cc = 0; cc < COLS; cc++) {
          if (!isWall(cc, r)) continue;
          const x = cc * CELL - HALF_W + 1,
            z = r * CELL - HALF_D + 1;
          const d = Math.hypot(x - c.x, z - c.z);
          if (d < bd) {
            bd = d;
            best = { x, z };
          }
        }
      if (!best) continue;
      const top = 16;
      gbPole.addGeo(pipeGeo, new THREE.Matrix4().compose(new THREE.Vector3(best.x, (WALL_H + top) / 2, best.z), new THREE.Quaternion(), new THREE.Vector3(0.07, top - WALL_H, 0.07)), WHITE, 'keep');
      gbPole.box(best.x - 0.35, WALL_H, best.z - 0.35, best.x + 0.35, WALL_H + 0.3, best.z + 0.35, WHITE, 1, 4);
      const ball = track(new THREE.SphereGeometry(0.14, 12, 8));
      gbPole.addGeo(ball, new THREE.Matrix4().makeTranslation(best.x, top + 0.1, best.z), WHITE, 'keep');
      // 旗面：朝向地图中心飘
      const fw = 3.6,
        fh = 2.4;
      const geo = track(new THREE.PlaneGeometry(fw, fh, 16, 8));
      geo.translate(fw / 2, 0, 0);
      const [u0, v0, u1, v1] = boards.uv[id === 'A' ? 'flagA' : 'flagB'];
      const uv = geo.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      const uTime = { value: 0 };
      const fm = track(
        new THREE.MeshStandardMaterial({ map: boards.tex, side: THREE.DoubleSide, roughness: 0.85, emissiveMap: boards.tex, emissive: 0xffffff, emissiveIntensity: nightK * 0.35 }),
      );
      fm.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = uTime;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            float k = position.x / ${fw.toFixed(2)};
            transformed.z += sin(position.x * 1.7 - uTime * 3.2) * 0.22 * k + sin(position.x * 3.1 - uTime * 5.0 + position.y) * 0.06 * k;
            transformed.y -= k * k * 0.25;`,
          )
          .replace(
            '#include <beginnormal_vertex>',
            `#include <beginnormal_vertex>
            { float kk = position.x / ${fw.toFixed(2)}; objectNormal = normalize(vec3(-cos(position.x * 1.7 - uTime * 3.2) * 0.37 * kk, 0.0, 1.0)); }`,
          );
      };
      fm.customProgramCacheKey = () => 'flag';
      const flag = new THREE.Mesh(geo, fm);
      flag.position.set(best.x, top - fh / 2 - 0.25, best.z);
      flag.rotation.y = Math.atan2(-(0 - best.z), 0 - best.x) + (hash2(best.x, best.z) - 0.5) * 0.6;
      flag.castShadow = true;
      group.add(flag);
      animated.push((t) => (uTime.value = t + (id === 'A' ? 0 : 1.7)));
    }
    addMesh(gbPole.build(), poleMat);
  }
}

