import { TOUCH_DIFFICULTY } from './assist.ts';
import { RULES } from '../data/defs.ts';
import type { NadeId } from '../data/defs.ts';
import type { SiteId, Vec2 } from '../world/map.ts';
import { moveBody, segmentClear } from '../world/physics.ts';
import type { Combatant } from './combatant.ts';
import type { Match } from './match.ts';

/** 每支队伍的回合战术计划（下标 = 队伍） */
export interface TeamPlan {
  /** 进攻方主攻的目标点；安装后为熵核所在点 */
  site: SiteId;
  /** 防守方：最近发现敌人的目标点（用于回防） */
  alertSite: SiteId | null;
  /** 警报发生时的 match.time */
  alertT: number;
  /** 进攻方：进点前的集合点（目标点外约 14 米，沿进攻路线） */
  stage: Vec2 | null;
  /** 进攻方：计划的进点时刻（match.time）；executing = 已开始进点 */
  execT: number;
  executing: boolean;
  /** 最近一次有队友阵亡的时刻 */
  lostT: number;
  /** 防守方：当前允许主动出去“拉枪”的人（同一时间只有一个） */
  peeker?: Combatant | null;
  peekT?: number;
  /** 防守方：安装后集合回防的时刻 */
  retakeT?: number;
  /** 本回合是否已经扔过进点烟 / 闪 */
  smoked?: boolean;
  flashed?: boolean;
}

// ---------------------------------------------------------------- 常量

/** 步行速度 m/s */
const WALK = 4.6;
/** 视野检测间隔（秒） */
const VISION_DT = 0.15;
/** 110° 视野的半角余弦 */
const FOV_COS = Math.cos((55 * Math.PI) / 180);
/** 近身感知距离：此距离内无视朝向 */
const NEAR_SENSE = 6;
/** 中路防守点 */
/** 拆除前需要的「无敌人可见」时长 */
const DEFUSE_CLEAR = 1.5;
/** 安装前需要的「无敌人可见」时长 */
const PLANT_CLEAR = 0.6;

// 复用的临时对象（避免每帧分配）
const _from: Vec2 = { x: 0, z: 0 };
const _to: Vec2 = { x: 0, z: 0 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 把角度规整到 (-π, π] */
function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** 从自身朝向 (dx,dz) 的偏航角（yaw 0 朝 −Z） */
function yawTo(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

type Role = SiteId | 'mid';

export class BotBrain {
  // ------------------------------------------------ 导航
  private path: Vec2[] = [];
  private pathI = 0;
  private hasGoal = false;
  private goalX = 0;
  private goalZ = 0;
  private arriveR = 0.8;
  private atGoal = false;
  private needPath = false;
  private repathCD = 0;
  private jitter = 1;
  private stuckClock = 0;
  private stuckX = 0;
  private stuckZ = 0;
  private sideT = 0;
  private sideX = 0;
  private sideZ = 0;
  /** 本帧期望移动方向（单位向量或 0）与速度倍率 */
  private mvx = 0;
  private mvz = 0;
  private mvMul = 1;

  // ------------------------------------------------ 任务
  private role: Role = 'A';
  private holdX = 0;
  private holdZ = 0;
  private watchX = 0;
  private watchZ = 0;
  private hasWatch = false;
  private plantX = 0;
  private plantZ = 0;
  private plantProg = 0;
  private willRotate = false;
  private rotateDelay = 5;
  private rotated = false;
  private guardSet = false;
  private guardX = 0;
  private guardZ = 0;
  private planting = false;
  private defusing = false;
  private idlePhase = 0;
  /** 推进中的停顿：每走一段停下观察 */
  private pauseT = 0;
  private travel = 0;
  private travelGoal = 8;
  private lastPX = 0;
  private lastPZ = 0;
  /** 队友阵亡后的后撤 / 架枪 */
  private fallT = 0;
  private fallX = 0;
  private fallZ = 0;
  /** 防守时蹲着架点 */
  private crouchHold = false;
  /** 自己在集合点附近的位置 */
  private stageX = 0;
  private stageZ = 0;
  private hasStage = false;
  /** 下一次考虑扔手雷的时间 */
  private fragCD = 0;

  // ------------------------------------------------ 战斗
  private target: Combatant | null = null;
  private lastTarget: Combatant | null = null;
  private lostClock = 99;
  private visionT = 0;
  private reactT = 0;
  private lastSeenX = 0;
  private lastSeenZ = 0;
  private huntT = 0;
  /** 距上次看到敌人的时间 */
  private noEnemyT = 99;
  private burstLeft = 0;
  private burstPause = 0;
  private aimYawOff = 0;
  private aimPitchOff = 0;
  private aimHead = false;
  private strafeT = 0;
  private strafeDir = 0;
  private hurtT = 0;
  private hurtX = 0;
  private hurtZ = 0;

  constructor(
    private c: Combatant,
    private m: Match,
  ) {}

  private get skill(): number {
    return Math.max(0, Math.min(1, this.m.level.botSkill));
  }

  /** 瞄准误差倍率：触屏模式下瞄准玩家时误差放大（见 TOUCH_DIFFICULTY）；botStrength 越高误差越小 */
  private errScale(tgt: Combatant): number {
    return ((tgt.isPlayer ? this.m.input.touchMode : tgt.touch) ? 1 / TOUCH_DIFFICULTY : 1) / this.m.opt.botStrength;
  }

  /** 每回合开始（准备阶段）调用 */
  reset(): void {
    const c = this.c;
    this.path = [];
    this.pathI = 0;
    this.hasGoal = false;
    this.atGoal = false;
    this.needPath = false;
    this.repathCD = 0;
    this.stuckClock = 0;
    this.stuckX = c.body.x;
    this.stuckZ = c.body.z;
    this.sideT = 0;
    this.mvx = this.mvz = 0;
    this.mvMul = 1;
    this.role = 'A';
    this.holdX = c.body.x;
    this.holdZ = c.body.z;
    this.hasWatch = false;
    this.plantProg = 0;
    this.willRotate = false;
    this.rotated = false;
    this.guardSet = false;
    this.planting = false;
    this.defusing = false;
    this.idlePhase = this.m.rng() * Math.PI * 2;
    this.target = null;
    this.lastTarget = null;
    this.lostClock = 99;
    this.visionT = this.m.rng() * VISION_DT;
    this.reactT = 0;
    this.huntT = 0;
    this.noEnemyT = 99;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.strafeT = 0;
    this.strafeDir = 0;
    this.hurtT = 0;
    this.jitter = 0.5 + this.m.rng() * 2.5;
    this.pauseT = 0;
    this.travel = 0;
    this.travelGoal = 7 + this.m.rng() * 5;
    this.lastPX = c.body.x;
    this.lastPZ = c.body.z;
    this.fallT = 0;
    this.crouchHold = false;
    this.hasStage = false;
    this.fragCD = 6 + this.m.rng() * 6;
    c.speed = 0;
    c.ads = 0;
    c.scopeLevel = 0;
    c.crouch = 0;
    c.walking = false;
  }

  // ------------------------------------------------ 回合分配（planRound 调用）

  /** 进攻方：前往 site，持有熵核者进入点内安装 */
  assignAttack(site: SiteId, index: number): void {
    const m = this.m;
    const rect = m.map.sites[site];
    this.role = site;
    this.jitter = 0.6 + m.rng() * 3;
    const pp = m.map.randomPointIn(rect, m.rng, 1.6);
    this.plantX = pp.x;
    this.plantZ = pp.z;
    let hp: Vec2;
    if (index % 2 === 0) hp = m.map.randomPointIn(rect, m.rng, 1);
    else {
      const cen = m.map.siteCenter(site);
      const a = m.rng() * Math.PI * 2;
      const r = 4 + m.rng() * 5;
      hp = m.map.nearestWalkable(cen.x + Math.cos(a) * r, cen.z + Math.sin(a) * r);
    }
    this.holdX = hp.x;
    this.holdZ = hp.z;
    // 守点时面朝防守方可能来的方向
    const ds = m.map.defendSpawn;
    _to.x = (ds.x0 + ds.x1) / 2;
    _to.z = (ds.z0 + ds.z1) / 2;
    this.setWatchAlong(hp, _to, 9);
    // 集合点：在队伍集合点附近散开（不要挤在一起）
    const st = m.plans[this.c.team].stage;
    if (st) {
      const a = (index / 5) * Math.PI * 2 + m.rng() * 0.6;
      const r = 1.5 + m.rng() * 2.5;
      const sp = m.map.nearestWalkable(st.x + Math.cos(a) * r, st.z + Math.sin(a) * r);
      this.stageX = sp.x;
      this.stageZ = sp.z;
      this.hasStage = true;
    }
  }

  /** 防守方：守在 role 位置，watchMid 为 true 时盯中路方向，否则盯进攻方来路 */
  assignDefend(role: Role, watchMid: boolean): void {
    const m = this.m;
    this.role = role;
    this.jitter = 0.5 + m.rng() * 1.5;
    this.rotated = false;
    this.willRotate = role === 'mid' ? true : m.rng() < 0.6;
    this.rotateDelay = 3 + m.rng() * 4;
    this.crouchHold = m.rng() < 0.35;
    this.defendHold(role, watchMid);
  }

  private defendHold(role: Role, watchMid: boolean): void {
    const m = this.m;
    let hp: Vec2;
    if (role === 'mid') {
      const mp = m.map.midPoint();
      hp = m.map.nearestWalkable(mp.x + (m.rng() - 0.5) * 6, mp.z + (m.rng() - 0.5) * 4);
    }
    else hp = m.map.randomPointIn(m.map.sites[role], m.rng, 1.2);
    this.holdX = hp.x;
    this.holdZ = hp.z;
    if (watchMid && role !== 'mid') {
      const mid = m.map.midPoint();
      _to.x = mid.x;
      _to.z = mid.z;
    } else {
      const as = m.map.attackSpawn;
      _to.x = (as.x0 + as.x1) / 2;
      _to.z = (as.z0 + as.z1) / 2;
    }
    this.setWatchAlong(hp, _to, 10);
  }

  /** 沿 from→to 的路径走 along 米处作为观察点 */
  private setWatchAlong(from: Vec2, to: Vec2, along: number): void {
    const path = this.m.map.findPath(from, to, 1.5, this.m.rng);
    let px = from.x,
      pz = from.z,
      acc = 0;
    let wx = to.x,
      wz = to.z;
    for (const p of path) {
      const d = Math.hypot(p.x - px, p.z - pz);
      if (acc + d >= along && d > 1e-4) {
        const t = (along - acc) / d;
        wx = px + (p.x - px) * t;
        wz = pz + (p.z - pz) * t;
        break;
      }
      acc += d;
      px = p.x;
      pz = p.z;
      wx = p.x;
      wz = p.z;
    }
    this.watchX = wx;
    this.watchZ = wz;
    this.hasWatch = Math.hypot(wx - from.x, wz - from.z) > 0.5;
  }

  // ------------------------------------------------ 事件

  onHurt(attacker: Combatant | null): void {
    const c = this.c;
    if (!attacker || attacker === c || attacker.team === c.team || !c.alive) return;
    this.hurtT = 1.4;
    this.hurtX = attacker.body.x;
    this.hurtZ = attacker.body.z;
    this.noEnemyT = 0;
    if (!this.target) {
      this.lastSeenX = attacker.body.x;
      this.lastSeenZ = attacker.body.z;
      this.visionT = 0;
    }
    this.raiseAlert(attacker.body.x, attacker.body.z);
  }

  /** 队友阵亡：附近的队友停下架枪，进攻方未进点时稍微后撤 */
  onMateDown(v: Combatant): void {
    const c = this.c;
    const m = this.m;
    if (!c.alive || c.hasSpike || this.target) return;
    const d = Math.hypot(v.body.x - c.body.x, v.body.z - c.body.z);
    if (d > 20) return;
    this.fallT = 2 + m.rng() * 1.5;
    // 沿“队友 → 自己”的方向后撤约 3 米，并盯住队友倒下的方向
    const k = d > 0.1 ? 3 / d : 0;
    const p = m.map.nearestWalkable(c.body.x + (c.body.x - v.body.x) * k, c.body.z + (c.body.z - v.body.z) * k);
    this.fallX = p.x;
    this.fallZ = p.z;
    this.hurtX = v.body.x;
    this.hurtZ = v.body.z;
    this.hurtT = Math.max(this.hurtT, 1.5);
  }

  /** 被闪：丢失目标（视野检测里也会跳过） */
  onFlashed(): void {
    if (this.target) this.loseTarget(true);
  }

  onPlanted(): void {
    this.guardSet = false;
    this.plantProg = 0;
    this.planting = false;
    this.huntT = 0;
    this.atGoal = false;
  }

  // ------------------------------------------------ 主更新

  update(g: number): void {
    const c = this.c;
    const m = this.m;
    if (!c.alive) {
      c.speed = 0;
      return;
    }
    if (g <= 0) return;

    // 计时
    this.repathCD -= g;
    this.reactT -= g;
    this.burstPause -= g;
    this.hurtT -= g;
    this.huntT -= g;
    this.sideT -= g;
    this.noEnemyT += g;
    this.lostClock += g;

    this.vision(g);
    if (this.target && !this.target.alive) this.loseTarget(false);
    if (this.target) this.noEnemyT = 0;

    this.mvx = this.mvz = 0;
    this.mvMul = 1;
    this.planting = false;
    this.defusing = false;
    this.pauseT -= g;
    this.fallT -= g;
    this.fragCD -= g;
    c.walking = false;

    const tgt = this.target;
    if (tgt) {
      this.combatMove(tgt, g);
    } else if (this.huntT > 0 && this.canHunt()) {
      this.setGoal(this.lastSeenX, this.lastSeenZ, 1.2);
      if (this.steer()) this.huntT = Math.min(this.huntT, 0.5);
      // 清点：靠近时放慢脚步
      this.mvMul = 0.6;
      c.walking = true;
      this.maybeFrag();
    } else if (this.fallT > 0 && !c.hasSpike && m.phase === 'live') {
      this.setGoal(this.fallX, this.fallZ, 0.6);
      this.steer();
      this.mvMul = 0.55;
      c.walking = true;
    } else {
      this.objective(g);
      this.tactical();
    }

    // 蹲着架点：防守方到位后静止时
    const still = this.mvx === 0 && this.mvz === 0;
    const wantCrouch = (this.crouchHold && still && m.sideOf(c.team) === 'defend' && !this.defusing) || this.planting || this.defusing;
    c.crouch = Math.max(0, Math.min(1, c.crouch + (wantCrouch ? g : -g) / 0.15));

    this.locomotion(g);
    this.look(g);
    if (tgt) this.shoot(tgt);
    else {
      c.ads = 0;
      const w = c.weapon;
      if (w.reloadT <= 0 && w.reserve > 0 && w.mag < w.def.mag * 0.4 && this.noEnemyT > 0.6) m.startReload(c);
    }
  }

  // ------------------------------------------------ 视野

  private vision(_g: number): void {
    this.visionT -= _g;
    if (this.visionT > 0) return;
    const c = this.c;
    const m = this.m;
    this.visionT = VISION_DT * (0.85 + 0.3 * m.rng());
    if (c.flashT > 0) {
      // 被致盲：什么也看不见
      if (this.target) this.loseTarget(true);
      return;
    }
    const fx = -Math.sin(c.yaw),
      fz = -Math.cos(c.yaw);
    let best: Combatant | null = null;
    let bestScore = Infinity;
    const list = m.combatants;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.team === c.team) continue;
      const dx = e.body.x - c.body.x,
        dz = e.body.z - c.body.z;
      const d = Math.hypot(dx, dz);
      if (d > NEAR_SENSE && (dx * fx + dz * fz) / d < FOV_COS) continue;
      if (!m.canSee(c, e)) continue;
      const score = d - (e === this.target ? 8 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) {
      if (best !== this.target) {
        const quick = best === this.lastTarget && this.lostClock < 1.2;
        this.reactT = quick ? 0.08 : (lerp(0.7, 0.22, this.skill) * (0.8 + 0.4 * m.rng())) / Math.sqrt(this.m.opt.botStrength);
        this.newBurst();
        this.burstPause = 0;
      }
      this.target = best;
      this.lastSeenX = best.body.x;
      this.lastSeenZ = best.body.z;
      this.noEnemyT = 0;
      this.huntT = 0;
      this.raiseAlert(best.body.x, best.body.z);
    } else if (this.target) this.loseTarget(true);
  }

  private loseTarget(hunt: boolean): void {
    this.lastTarget = this.target;
    this.target = null;
    this.lostClock = 0;
    this.huntT = hunt ? 2 + this.m.rng() * 2.5 : 0;
    this.atGoal = false;
  }

  /** 防守方发现敌人时，标记交火的目标点 */
  private raiseAlert(x: number, z: number): void {
    const m = this.m;
    if (m.phase !== 'live' || m.sideOf(this.c.team) !== 'defend') return;
    const a = m.map.siteCenter('A'),
      b = m.map.siteCenter('B');
    const da = Math.hypot(x - a.x, z - a.z),
      db = Math.hypot(x - b.x, z - b.z);
    const site: SiteId = da <= db ? 'A' : 'B';
    if (Math.min(da, db) > 20) return;
    const plan = m.plans[this.c.team];
    if (plan.alertSite === site) return;
    if (plan.alertSite && m.time - plan.alertT < 8) return;
    plan.alertSite = site;
    plan.alertT = m.time;
  }

  private canHunt(): boolean {
    const m = this.m;
    const c = this.c;
    if (m.phase === 'end' || c.hasSpike) return false;
    if (m.phase === 'planted') {
      // 安装后不要离熵核太远
      return Math.hypot(this.lastSeenX - m.spike.x, this.lastSeenZ - m.spike.z) < 14;
    }
    if (m.sideOf(c.team) === 'defend') {
      // 防守方不一起冲出去：同一时间只有一人去“拉枪”，并且不离开守位太远
      if (Math.hypot(this.lastSeenX - this.holdX, this.lastSeenZ - this.holdZ) > 10) return false;
      const plan = m.plans[c.team];
      if (plan.peeker && plan.peeker !== c && plan.peeker.alive && m.time - (plan.peekT ?? 0) < 3) return false;
      plan.peeker = c;
      plan.peekT = m.time;
    }
    return true;
  }

  // ------------------------------------------------ 任务目标

  private objective(g: number): void {
    const c = this.c;
    const m = this.m;
    const side = m.sideOf(c.team);
    const s = m.spike;
    if (m.phase === 'end') {
      this.clearGoal();
      return;
    }
    if (m.phase === 'planted' && s.state === 'planted') {
      if (side === 'attack') {
        this.ensureGuard(4, 9);
        this.setGoal(this.guardX, this.guardZ, 0.8);
        this.steer();
        this.watchX = s.x;
        this.watchZ = s.z;
        this.hasWatch = true;
      } else {
        const plan = m.plans[c.team];
        // 回防：先在熵核外集合，凑齐人或等一会儿再一起进
        if (m.time < (plan.retakeT ?? 0) && Math.hypot(c.body.x - s.x, c.body.z - s.z) > 9) {
          let near = 0;
          for (const o of m.combatants) if (o.alive && o.team === c.team && Math.hypot(o.body.x - s.x, o.body.z - s.z) < 18) near++;
          if (near < 2) {
            const k = 13 / Math.max(1, Math.hypot(c.body.x - s.x, c.body.z - s.z));
            const gx = s.x + (c.body.x - s.x) * Math.min(1, k),
              gz = s.z + (c.body.z - s.z) * Math.min(1, k);
            this.setGoal(gx, gz, 1.5);
            this.steer();
            this.watchX = s.x;
            this.watchZ = s.z;
            this.hasWatch = true;
            return;
          }
        }
        if (!plan.flashed && c.nades.shanguang > 0 && Math.hypot(c.body.x - s.x, c.body.z - s.z) < 16 && m.rng() < 0.02) {
          plan.flashed = true;
          m.botThrow(c, 'shanguang', s.x, s.z);
        }
        if (this.isDefuser()) {
          this.setGoal(s.x, s.z, 0.7);
          this.steer();
          const d = Math.hypot(c.body.x - s.x, c.body.z - s.z);
          if (d < 1.3) {
            this.defusing = true;
            if (this.noEnemyT >= DEFUSE_CLEAR && (!s.defuser || s.defuser === c || !s.defuser.alive)) {
              s.defuser = c;
              s.defuseT += g;
              if (s.defuseT >= RULES.botDefuseTime) m.defuseSpike(c);
            }
          }
        } else {
          this.ensureGuard(2.5, 6);
          this.setGoal(this.guardX, this.guardZ, 0.8);
          this.steer();
          this.watchX = s.x;
          this.watchZ = s.z;
          this.hasWatch = true;
        }
      }
      return;
    }
    if (m.phase !== 'live') {
      this.clearGoal();
      return;
    }
    if (side === 'attack') {
      if (c.hasSpike) {
        if (this.atStage()) return;
        this.setGoal(this.plantX, this.plantZ, 0.6);
        const arrived = this.steer();
        const inSite = m.map.siteOf(c.body.x, c.body.z) !== null;
        if (inSite && (arrived || Math.hypot(c.body.x - this.plantX, c.body.z - this.plantZ) < 1.5)) {
          this.mvx = this.mvz = 0;
          this.planting = true;
          if (this.noEnemyT >= PLANT_CLEAR) {
            this.plantProg += g;
            s.plantT = this.plantProg;
            if (this.plantProg >= RULES.botPlantTime) {
              this.plantProg = 0;
              m.plantSpike(c);
            }
          }
        } else this.plantProg = 0;
        return;
      }
      this.plantProg = 0;
      if (s.state === 'dropped' && this.nearestAttackerBotToSpike()) {
        this.setGoal(s.x, s.z, 0.3);
        this.steer();
        return;
      }
      if (this.atStage()) return;
      this.setGoal(this.holdX, this.holdZ, 0.8);
      this.steer();
      return;
    }
    // 防守方：回防
    const plan = m.plans[c.team];
    if (
      this.willRotate &&
      !this.rotated &&
      plan.alertSite &&
      plan.alertSite !== this.role &&
      m.time - plan.alertT > this.rotateDelay
    ) {
      this.rotated = true;
      this.defendHold(plan.alertSite, m.rng() < 0.5);
    }
    this.setGoal(this.holdX, this.holdZ, 0.8);
    this.steer();
  }

  /**
   * 进攻方进点前：去集合点等队友（或等计划时间），返回 true 表示本帧由集合逻辑接管。
   * 进点时由第一个带烟的机器人封住防守方来路、带闪的机器人往点内扔闪。
   */
  private atStage(): boolean {
    const m = this.m;
    const c = this.c;
    const plan = m.plans[c.team];
    if (!plan.stage || !this.hasStage) return false;
    if (!plan.executing) {
      // 队伍级判断：集合人数够了、到时间了、或熵核已经被带近目标点（例如玩家先进）
      let alive = 0,
        near = 0;
      for (const o of m.combatants) {
        if (!o.alive || o.team !== c.team) continue;
        alive++;
        if (Math.hypot(o.body.x - plan.stage.x, o.body.z - plan.stage.z) < 9) near++;
      }
      const carrier = m.spikeCarrier();
      const cen = m.map.siteCenter(plan.site);
      const carrierClose = !!carrier && carrier.team === c.team && Math.hypot(carrier.body.x - cen.x, carrier.body.z - cen.z) < 12;
      if ((m.time >= plan.execT && near >= Math.ceil(alive * 0.6)) || m.time >= plan.execT + 12 || carrierClose || m.phaseT < 38) {
        plan.executing = true;
        this.atGoal = false;
      }
    }
    if (plan.executing) {
      const cen = m.map.siteCenter(plan.site);
      const d = Math.hypot(c.body.x - cen.x, c.body.z - cen.z);
      if (!plan.smoked && c.nades.yanwu > 0 && d < 22) {
        plan.smoked = true;
        // 封住防守方回防的方向
        const ds = m.map.defendSpawn;
        const tx = cen.x + ((ds.x0 + ds.x1) / 2 - cen.x) * 0.35,
          tz = cen.z + ((ds.z0 + ds.z1) / 2 - cen.z) * 0.35;
        m.botThrow(c, 'yanwu', tx, tz);
      } else if (!plan.flashed && c.nades.shanguang > 0 && d < 16 && d > 7) {
        plan.flashed = true;
        m.botThrow(c, 'shanguang', cen.x, cen.z);
      }
      return false;
    }
    // 走向集合点，到了就盯着目标点方向
    this.setGoal(this.stageX, this.stageZ, 1.0);
    if (this.steer()) {
      const cen = m.map.siteCenter(plan.site);
      this.watchX = cen.x;
      this.watchZ = cen.z;
      this.hasWatch = true;
    }
    return true;
  }

  /** 推进的节奏：每走一段停一下观察；靠近目标点时静步清点 */
  private tactical(): void {
    const c = this.c;
    const m = this.m;
    if (m.phase !== 'live' && m.phase !== 'planted') return;
    const moved = Math.hypot(c.body.x - this.lastPX, c.body.z - this.lastPZ);
    this.lastPX = c.body.x;
    this.lastPZ = c.body.z;
    if (this.mvx === 0 && this.mvz === 0) return;
    if (this.planting || this.defusing) return;
    // 靠近任意目标点（或熵核）时放慢：静步清点
    const a = m.map.siteCenter('A'),
      b = m.map.siteCenter('B');
    const ds = Math.min(Math.hypot(c.body.x - a.x, c.body.z - a.z), Math.hypot(c.body.x - b.x, c.body.z - b.z));
    const side = m.sideOf(c.team);
    if (ds < 13 && (side === 'attack' || m.phase === 'planted') && !c.hasSpike) {
      this.mvMul = Math.min(this.mvMul, 0.62);
      c.walking = true;
    }
    if (this.pauseT > 0) {
      this.mvx = this.mvz = 0;
      return;
    }
    if (m.phase !== 'live') return;
    this.travel += moved;
    if (this.travel >= this.travelGoal) {
      this.travel = 0;
      this.travelGoal = 7 + m.rng() * 6;
      // 带熵核的人与回防者停得少一些
      if (!c.hasSpike && m.rng() < 0.7) this.pauseT = 0.7 + m.rng() * 1.1;
    }
  }

  /** 丢失目标后偶尔往敌人最后出现的位置扔一颗手雷（低年级敌人不会带手雷） */
  private maybeFrag(): void {
    const c = this.c;
    const m = this.m;
    if (c.nades.pili <= 0 || this.fragCD > 0) return;
    this.fragCD = 4;
    const d = Math.hypot(this.lastSeenX - c.body.x, this.lastSeenZ - c.body.z);
    if (d < 7 || d > 17 || m.rng() > 0.35) return;
    m.botThrow(c, 'pili' as NadeId, this.lastSeenX, this.lastSeenZ);
  }

  private isDefuser(): boolean {
    const m = this.m;
    const s = m.spike;
    const c = this.c;
    if (s.defuser && s.defuser.alive && s.defuser !== c) return false;
    if (s.defuser === c) return true;
    let best: Combatant | null = null;
    let bd = Infinity;
    const list = m.combatants;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o.alive || !o.brain || o.team !== c.team) continue;
      const d = (o.body.x - s.x) ** 2 + (o.body.z - s.z) ** 2;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best === c;
  }

  private nearestAttackerBotToSpike(): boolean {
    const m = this.m;
    const s = m.spike;
    const c = this.c;
    let best: Combatant | null = null;
    let bd = Infinity;
    const list = m.combatants;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o.alive || !o.brain || o.team !== c.team) continue;
      const d = (o.body.x - s.x) ** 2 + (o.body.z - s.z) ** 2;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best === c;
  }

  /** 在熵核周围选一个能看到熵核的位置 */
  private ensureGuard(rMin: number, rMax: number): void {
    if (this.guardSet) return;
    const m = this.m;
    const s = m.spike;
    this.guardSet = true;
    for (let k = 0; k < 16; k++) {
      const a = m.rng() * Math.PI * 2;
      const r = rMin + m.rng() * (rMax - rMin);
      const p = m.map.nearestWalkable(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r);
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < rMin * 0.6 || d > rMax + 1.5) continue;
      if (!segmentClear(p.x, 1.6, p.z, s.x, 0.5, s.z, m.map.boxes)) continue;
      this.guardX = p.x;
      this.guardZ = p.z;
      return;
    }
    const p = m.map.nearestWalkable(s.x + (m.rng() - 0.5) * 3, s.z + (m.rng() - 0.5) * 3);
    this.guardX = p.x;
    this.guardZ = p.z;
  }

  // ------------------------------------------------ 战斗移动 / 射击

  private combatMove(tgt: Combatant, g: number): void {
    const c = this.c;
    const m = this.m;
    // 安装中或拆除中的机器人原地站定
    if (c.hasSpike && m.phase === 'live' && m.map.siteOf(c.body.x, c.body.z)) {
      this.plantProg = 0;
      m.spike.plantT = 0;
      return;
    }
    if (m.spike.defuser === c) {
      m.spike.defuser = null;
      m.spike.defuseT = 0;
    }
    this.strafeT -= g;
    if (this.strafeT <= 0) {
      this.strafeT = 0.35 + m.rng() * 0.7;
      const prob = 0.3 + 0.4 * this.skill;
      this.strafeDir = m.rng() < prob ? (m.rng() < 0.5 ? -1 : 1) : 0;
    }
    if (this.strafeDir === 0) return;
    const yaw = yawTo(tgt.body.x - c.body.x, tgt.body.z - c.body.z);
    // 右方向 = (cos yaw, -sin yaw)
    this.mvx = Math.cos(yaw) * this.strafeDir;
    this.mvz = -Math.sin(yaw) * this.strafeDir;
    this.mvMul = 0.5;
  }

  private newBurst(): void {
    const m = this.m;
    const sk = this.skill;
    const wd = this.c.weapon.def;
    // 点射 / 短连发（与玩家一样受连射散布与后坐力影响，长连发不划算）
    if (wd.auto) this.burstLeft = wd.cls === 'lmg' ? 6 + Math.floor(m.rng() * 6) : 3 + Math.floor(m.rng() * (2 + sk * 3));
    else this.burstLeft = wd.cls === 'sniper' ? 1 : 1 + Math.floor(m.rng() * 2);
    const sig = lerp(0.085, 0.02, sk) / this.m.opt.botStrength;
    this.aimYawOff = this.gauss() * sig * 0.6;
    this.aimPitchOff = this.gauss() * sig * 0.4;
    this.aimHead = m.rng() < sk * 0.55;
  }

  private shoot(tgt: Combatant): void {
    const c = this.c;
    const m = this.m;
    const def0 = c.weapon.def;
    // 机器人与玩家同一套规则：狙击 / 精确步枪停下来开镜再打
    const scoped = (def0.alt === 'scope' || def0.cls === 'rifle' && def0.zoom >= 2) && c.speed < 1.5;
    c.ads = scoped ? Math.min(1, c.ads + 0.2) : 0;
    c.scopeLevel = scoped && def0.alt === 'scope' ? 1 : 0;
    if (this.reactT > 0 || this.burstPause > 0 || c.weapon.reloadT > 0) return;
    const dx = tgt.body.x - c.body.x,
      dz = tgt.body.z - c.body.z;
    const dist = Math.hypot(dx, dz);
    const wantYaw = yawTo(dx, dz);
    const tol = 0.12 + (dist < 5 ? 0.15 : 0);
    if (Math.abs(wrapAngle(wantYaw - c.yaw)) > tol) return;
    const sk = this.skill;
    const sig = lerp(0.085, 0.02, sk) * this.errScale(tgt);
    if (!m.canFire(c)) return;
    const ey = c.yaw + this.gauss() * sig * 0.7;
    const ep = c.pitch + this.gauss() * sig * 0.5;
    const cp = Math.cos(ep);
    const fx = -Math.sin(ey) * cp,
      fy = Math.sin(ep),
      fz = -Math.cos(ey) * cp;
    if (m.fire(c, fx, fy, fz, lerp(0.015, 0, sk))) {
      this.burstLeft--;
      if (this.burstLeft <= 0) {
        const def = c.weapon.def;
        let pause: number;
        if (def.cls === 'sniper') pause = lerp(1.1, 0.6, sk) + m.rng() * 0.4;
        else if (def.auto) pause = lerp(0.55, 0.25, sk) + m.rng() * 0.25;
        else pause = lerp(0.4, 0.12, sk) + m.rng() * 0.2;
        this.burstPause = pause;
        this.newBurst();
      }
    }
  }

  private gauss(): number {
    const r = this.m.rng;
    const u = Math.max(1e-6, r());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * r());
  }

  // ------------------------------------------------ 朝向

  private look(g: number): void {
    const c = this.c;
    const m = this.m;
    let wantYaw = c.yaw;
    let wantPitch = 0;
    let rate = 6;
    const tgt = this.target;
    if (tgt) {
      const dx = tgt.body.x - c.body.x,
        dz = tgt.body.z - c.body.z;
      const hd = Math.max(0.3, Math.hypot(dx, dz));
      const ty = this.aimHead ? tgt.eyeY() + 0.03 : tgt.body.y + 1.15 - tgt.crouch * 0.2;
      const ek = this.errScale(tgt);
      wantYaw = yawTo(dx, dz) + this.aimYawOff * ek;
      wantPitch = Math.atan2(ty - c.eyeY(), hd) + this.aimPitchOff * ek;
      rate = lerp(4.5, 11, this.skill);
    } else if (this.hurtT > 0) {
      wantYaw = yawTo(this.hurtX - c.body.x, this.hurtZ - c.body.z);
      rate = lerp(4, 9, this.skill);
    } else if (this.planting || this.defusing) {
      const s = m.spike;
      const sx = this.planting ? c.body.x - Math.sin(c.yaw) : s.x;
      const sz = this.planting ? c.body.z - Math.cos(c.yaw) : s.z;
      if (Math.hypot(sx - c.body.x, sz - c.body.z) > 0.2) wantYaw = yawTo(sx - c.body.x, sz - c.body.z);
      wantPitch = -0.6;
      rate = 3;
    } else if (this.mvx !== 0 || this.mvz !== 0) {
      if (this.huntT > 0 && this.target === null && Math.hypot(this.lastSeenX - c.body.x, this.lastSeenZ - c.body.z) > 0.5)
        wantYaw = yawTo(this.lastSeenX - c.body.x, this.lastSeenZ - c.body.z);
      else wantYaw = yawTo(this.mvx, this.mvz);
      rate = 5;
    } else if (this.huntT > 0) {
      wantYaw = yawTo(this.lastSeenX - c.body.x, this.lastSeenZ - c.body.z) + Math.sin(m.time * 1.3 + this.idlePhase) * 0.5;
      rate = 4;
    } else if (this.hasWatch) {
      const dx = this.watchX - c.body.x,
        dz = this.watchZ - c.body.z;
      if (dx * dx + dz * dz > 0.25) wantYaw = yawTo(dx, dz) + Math.sin(m.time * 0.6 + this.idlePhase) * 0.35;
      rate = 3;
    }
    const dy = wrapAngle(wantYaw - c.yaw);
    const maxStep = rate * g;
    let step = dy * Math.min(1, g * 12);
    if (step > maxStep) step = maxStep;
    else if (step < -maxStep) step = -maxStep;
    c.yaw = wrapAngle(c.yaw + step);
    const dp = wantPitch - c.pitch;
    let ps = dp * Math.min(1, g * 12);
    if (ps > maxStep) ps = maxStep;
    else if (ps < -maxStep) ps = -maxStep;
    c.pitch = Math.max(-1.3, Math.min(1.3, c.pitch + ps));
  }

  // ------------------------------------------------ 寻路与移动

  private clearGoal(): void {
    this.hasGoal = false;
    this.path.length = 0;
    this.pathI = 0;
  }

  private setGoal(x: number, z: number, arriveR: number): void {
    this.arriveR = arriveR;
    if (this.hasGoal && Math.hypot(x - this.goalX, z - this.goalZ) < 1.0) return;
    this.hasGoal = true;
    this.goalX = x;
    this.goalZ = z;
    this.atGoal = false;
    this.needPath = true;
  }

  private computePath(): void {
    const c = this.c;
    _from.x = c.body.x;
    _from.z = c.body.z;
    _to.x = this.goalX;
    _to.z = this.goalZ;
    this.path = this.m.map.findPath(_from, _to, this.jitter, this.m.rng);
    this.pathI = 0;
    this.needPath = false;
    this.repathCD = 0.6;
  }

  /** 沿路径朝目标走，设置 mvx/mvz。到达返回 true。 */
  private steer(): boolean {
    const c = this.c;
    if (!this.hasGoal) return true;
    const gd = Math.hypot(this.goalX - c.body.x, this.goalZ - c.body.z);
    if (this.atGoal) {
      if (gd < this.arriveR + 0.8) return true;
      this.atGoal = false;
      this.needPath = true;
    }
    if (gd < this.arriveR) {
      this.atGoal = true;
      return true;
    }
    if (this.needPath && this.repathCD <= 0) this.computePath();
    let tx = this.goalX,
      tz = this.goalZ;
    while (this.pathI < this.path.length) {
      const p = this.path[this.pathI];
      const d = Math.hypot(p.x - c.body.x, p.z - c.body.z);
      if (d < 0.55 && this.pathI < this.path.length - 1) {
        this.pathI++;
        continue;
      }
      tx = p.x;
      tz = p.z;
      break;
    }
    if (this.pathI >= this.path.length - 1 && this.path.length > 0) {
      tx = this.goalX;
      tz = this.goalZ;
    }
    const dx = tx - c.body.x,
      dz = tz - c.body.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) {
      this.mvx = dx / d;
      this.mvz = dz / d;
    }
    // 接近终点时减速，避免来回抖动
    if (gd < 1.5) this.mvMul = Math.max(0.35, gd / 1.5);
    return false;
  }

  private locomotion(g: number): void {
    const c = this.c;
    const m = this.m;
    const b = c.body;
    const wantMove = this.mvx !== 0 || this.mvz !== 0;
    let speed = WALK * c.weapon.def.moveMul * this.mvMul;
    if (c.slowT > 0) speed *= 0.5;
    if (c.ads > 0.5) speed *= c.weapon.def.adsMove;
    speed *= 1 - 0.55 * c.crouch;

    // 卡住检测
    if (wantMove && this.mvMul > 0.6) {
      this.stuckClock += g;
      if (this.stuckClock >= 1) {
        const moved = Math.hypot(b.x - this.stuckX, b.z - this.stuckZ);
        if (moved < 0.6) {
          this.needPath = true;
          this.repathCD = 0;
          this.jitter = Math.min(5, this.jitter + 1);
          // 侧移一下，摆脱卡住的位置
          const s = m.rng() < 0.5 ? -1 : 1;
          this.sideX = -this.mvz * s;
          this.sideZ = this.mvx * s;
          this.sideT = 0.45;
        }
        this.stuckClock = 0;
        this.stuckX = b.x;
        this.stuckZ = b.z;
      }
    } else {
      this.stuckClock = 0;
      this.stuckX = b.x;
      this.stuckZ = b.z;
    }

    let vx = this.mvx * speed,
      vz = this.mvz * speed;
    if (this.sideT > 0 && wantMove) {
      vx = vx * 0.3 + this.sideX * speed;
      vz = vz * 0.3 + this.sideZ * speed;
    }
    // 轻微分离，避免叠在一起
    const list = m.combatants;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === c || !o.alive) continue;
      const dx = b.x - o.body.x,
        dz = b.z - o.body.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1.44 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const k = ((1.2 - d) / 1.2) * 2.5;
      vx += (dx / d) * k;
      vz += (dz / d) * k;
    }
    const ox = b.x,
      oz = b.z;
    b.vx = vx;
    b.vz = vz;
    moveBody(b, g, m.map.boxes);
    c.speed = Math.min(WALK * 1.3, Math.hypot(b.x - ox, b.z - oz) / g);
  }
}

// ---------------------------------------------------------------- 回合计划

/** 进攻集合点：沿“进攻出生区 → 目标点”的路线，从目标点往回约 20 米（避开防守方的直接视线） */
function stagePoint(m: Match, site: SiteId): Vec2 {
  const as = m.map.attackSpawn;
  const from: Vec2 = { x: (as.x0 + as.x1) / 2, z: (as.z0 + as.z1) / 2 };
  const to = m.map.siteCenter(site);
  const path = m.map.findPath(from, to, 0.5, m.rng);
  const pts: Vec2[] = [from, ...path];
  let need = 20;
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i],
      b = pts[i - 1];
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d >= need) {
      const t = need / d;
      return m.map.nearestWalkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    }
    need -= d;
  }
  return m.map.nearestWalkable((from.x + to.x) / 2, (from.z + to.z) / 2);
}

/** 回合开战时调用：为双方机器人分配进攻点 / 防守位置 */
export function planRound(m: Match): void {
  for (const team of [0, 1] as const) {
    const plan = m.plans[team];
    plan.alertSite = null;
    plan.alertT = 0;
    const brains: BotBrain[] = [];
    for (const c of m.combatants) if (c.team === team && !c.isPlayer && c.brain) brains.push(c.brain);
    plan.executing = false;
    plan.smoked = plan.flashed = false;
    plan.peeker = null;
    plan.lostT = -99;
    plan.retakeT = 0;
    if (m.sideOf(team) === 'attack') {
      plan.site = m.rng() < 0.5 ? 'A' : 'B';
      plan.stage = stagePoint(m, plan.site);
      // 先集合再进点：开局后 20–36 秒进点（集合齐了才走，最多再等 12 秒）
      plan.execT = m.time + 20 + m.rng() * 16;
      brains.forEach((b, i) => b.assignAttack(plan.site, i));
    } else {
      const first: SiteId = m.rng() < 0.5 ? 'A' : 'B';
      const second: SiteId = first === 'A' ? 'B' : 'A';
      const roles: Role[] = brains.length >= 5 ? [first, second, 'mid', first, second] : [first, second, first, second];
      const count: Record<Role, number> = { A: 0, B: 0, mid: 0 };
      brains.forEach((b, i) => {
        const role = roles[i % roles.length];
        const k = count[role]++;
        b.assignDefend(role, k % 2 === 1);
      });
    }
  }
}
