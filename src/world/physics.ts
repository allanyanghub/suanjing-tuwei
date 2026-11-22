/** 轻量碰撞：轴对齐盒 + 射线。全部用纯数字，避免每帧分配对象。 */

export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** 子弹可穿透（如减速场），或仅阻挡视线 */
  tag?: string;
}

export interface RayHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  box: Box | null;
}

const _hit: RayHit = { t: Infinity, nx: 0, ny: 0, nz: 0, box: null };

/** 射线与一组盒子的最近交点。返回的对象是复用的，调用方需立刻读走。 */
export function rayBoxes(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  boxes: readonly Box[],
): RayHit {
  let best = maxDist;
  let bnx = 0,
    bny = 0,
    bnz = 0;
  let bbox: Box | null = null;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.tag === 'soft') continue;
    let tmin = 0;
    let tmax = best;
    let axis = -1;
    // X
    if (dx === 0) {
      if (ox < b.x0 || ox > b.x1) continue;
    } else {
      let t1 = (b.x0 - ox) / dx;
      let t2 = (b.x1 - ox) / dx;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      if (t1 > tmin) {
        tmin = t1;
        axis = 0;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    // Y
    if (dy === 0) {
      if (oy < b.y0 || oy > b.y1) continue;
    } else {
      let t1 = (b.y0 - oy) / dy;
      let t2 = (b.y1 - oy) / dy;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      if (t1 > tmin) {
        tmin = t1;
        axis = 1;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    // Z
    if (dz === 0) {
      if (oz < b.z0 || oz > b.z1) continue;
    } else {
      let t1 = (b.z0 - oz) / dz;
      let t2 = (b.z1 - oz) / dz;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      if (t1 > tmin) {
        tmin = t1;
        axis = 2;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    if (axis < 0) continue; // 起点在盒内：忽略
    best = tmin;
    bbox = b;
    bnx = bny = bnz = 0;
    if (axis === 0) bnx = dx > 0 ? -1 : 1;
    else if (axis === 1) bny = dy > 0 ? -1 : 1;
    else bnz = dz > 0 ? -1 : 1;
  }
  _hit.t = bbox ? best : Infinity;
  _hit.nx = bnx;
  _hit.ny = bny;
  _hit.nz = bnz;
  _hit.box = bbox;
  return _hit;
}

/** 两点之间是否无遮挡 */
export function segmentClear(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  boxes: readonly Box[],
): boolean {
  let dx = bx - ax,
    dy = by - ay,
    dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return true;
  dx /= len;
  dy /= len;
  dz /= len;
  return rayBoxes(ax, ay, az, dx, dy, dz, len, boxes).t >= len;
}

/** 线段是否穿过球体 */
export function segmentHitsSphere(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): boolean {
  const dx = bx - ax,
    dy = by - ay,
    dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t - cx,
    py = ay + dy * t - cy,
    pz = az + dz * t - cz;
  return px * px + py * py + pz * pz < r * r;
}

/** 射线与球，返回进入距离或 Infinity */
export function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number {
  const mx = ox - cx,
    my = oy - cy,
    mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c > 0 && b > 0) return Infinity;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/** 射线与竖直圆柱（轴线过 (cx,cz)，高度区间 [y0,y1]），返回进入距离或 Infinity */
export function rayCylinderY(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cz: number,
  r: number,
  y0: number,
  y1: number,
): number {
  const mx = ox - cx,
    mz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-8) return Infinity;
  const b = mx * dx + mz * dz;
  const c = mx * mx + mz * mz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  let t = (-b - s) / a;
  const tExit = (-b + s) / a;
  if (tExit < 0) return Infinity;
  if (t < 0) t = 0;
  // 进入点高度；若不在范围内，看射线在柱内期间是否穿过高度区间
  const yEnter = oy + dy * t;
  if (yEnter >= y0 && yEnter <= y1) return t;
  const yExit = oy + dy * tExit;
  if (yEnter < y0 && yExit >= y0 && dy > 0) return (y0 - oy) / dy;
  if (yEnter > y1 && yExit <= y1 && dy < 0) return (y1 - oy) / dy;
  return Infinity;
}

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  height: number;
  onGround: boolean;
}

const STEP = 0.5;

function overlapsXZ(b: Box, x: number, z: number, r: number): boolean {
  return x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1;
}

/** 移动角色并解决碰撞：逐轴移动，支持上小台阶与落地。 */
export function moveBody(body: Body, dt: number, boxes: readonly Box[], gravity = 24): void {
  const r = body.radius;
  // --- 水平 X ---
  let nx = body.x + body.vx * dt;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.tag === 'soft') continue;
    if (body.y + body.height <= b.y0 || body.y + STEP >= b.y1) continue; // 头顶之上或可跨上
    if (!overlapsXZ(b, nx, body.z, r)) continue;
    if (body.vx > 0) nx = Math.min(nx, b.x0 - r - 1e-4);
    else if (body.vx < 0) nx = Math.max(nx, b.x1 + r + 1e-4);
    else nx = body.x;
    body.vx = 0;
  }
  body.x = nx;
  // --- 水平 Z ---
  let nz = body.z + body.vz * dt;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.tag === 'soft') continue;
    if (body.y + body.height <= b.y0 || body.y + STEP >= b.y1) continue;
    if (!overlapsXZ(b, body.x, nz, r)) continue;
    if (body.vz > 0) nz = Math.min(nz, b.z0 - r - 1e-4);
    else if (body.vz < 0) nz = Math.max(nz, b.z1 + r + 1e-4);
    else nz = body.z;
    body.vz = 0;
  }
  body.z = nz;
  // --- 竖直 ---
  body.vy -= gravity * dt;
  let ny = body.y + body.vy * dt;
  let ground = 0;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.tag === 'soft') continue;
    if (!overlapsXZ(b, body.x, body.z, r * 0.9)) continue;
    // 可站立的顶面：在脚下（含可跨上的小台阶）
    if (b.y1 <= body.y + STEP + 1e-3 && b.y1 > ground) ground = b.y1;
    // 头顶碰撞
    if (body.vy > 0 && b.y0 >= body.y + body.height - 1e-3 && ny + body.height > b.y0) {
      ny = b.y0 - body.height;
      body.vy = 0;
    }
  }
  if (ny <= ground) {
    ny = ground;
    body.vy = 0;
    body.onGround = true;
  } else {
    // 贴地走下小台阶时不要飘
    body.onGround = false;
  }
  body.y = ny;
}
