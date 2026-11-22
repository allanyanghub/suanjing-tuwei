/**
 * 触屏辅助瞄准（只在触屏模式生效，鼠标操作完全不受影响）：
 * 1. 减速：准星靠近敌人时，手指拖动的视角转速降低，便于停在目标上；
 * 2. 吸附：视角手指正在移动时，按移动量的一定比例把准星拉向最近可见敌人的上半身；
 * 3. 自动开火：准星稳定停在可见敌人身上（且在武器有效射程内）一小段时间后自动射击。
 * 以及一个难度倍率：触屏模式下敌方机器人对玩家的伤害与瞄准精度按 TOUCH_DIFFICULTY 缩放。
 * 一切辅助都要求视线可达（match.canSee，含烟雾判断），不会隔墙或隔烟吸附。
 */
import type { AssistLevel } from '../core/save.ts';
import type { WeaponKind } from '../data/defs.ts';
import type { Combatant } from './combatant.ts';
import type { Match } from './match.ts';

/**
 * 触屏难度倍率（唯一的调节点）：
 * - 机器人打到玩家的伤害 × TOUCH_DIFFICULTY；
 * - 机器人瞄准玩家时的瞄准误差 ÷ TOUCH_DIFFICULTY（即更容易打偏）。
 */
export const TOUCH_DIFFICULTY = 0.75;

interface AssistTune {
  /** 减速生效的角度范围（弧度，按 1/距离 适当放大） */
  frictionCone: number;
  /** 准星正对目标时的最大减速比例 */
  friction: number;
  /** 吸附生效的角度范围 */
  magnetCone: number;
  /** 每弧度手指转动带来的吸附量 */
  magnet: number;
}

const TUNE: Record<AssistLevel, AssistTune> = {
  low: { frictionCone: 0.07, friction: 0.3, magnetCone: 0.1, magnet: 0.18 },
  medium: { frictionCone: 0.1, friction: 0.45, magnetCone: 0.15, magnet: 0.32 },
  high: { frictionCone: 0.13, friction: 0.6, magnetCone: 0.2, magnet: 0.5 },
};

/** 各类武器的自动开火有效射程（米） */
const AUTO_RANGE: Record<WeaponKind, number> = {
  pistol: 26,
  smg: 24,
  shotgun: 9,
  rifle: 48,
  sniper: 75,
};

/** 自动开火前准星需要停留的时间（秒，真实时间） */
const AUTO_DWELL = 0.16;

/** 目标瞄准点：上半身（胸口略上） */
function aimY(e: Combatant): number {
  return e.body.y + 1.3 - e.crouch * 0.35;
}

export class AimAssist {
  /** 本帧选中的目标（可见、在吸附范围内） */
  target: Combatant | null = null;
  /** 目标相对当前准星的偏差（弧度） */
  errYaw = 0;
  errPitch = 0;
  /** 目标距离 */
  dist = 0;
  private dwell = 0;
  private lastTarget: Combatant | null = null;

  constructor(private m: Match) {}

  reset(): void {
    this.target = null;
    this.lastTarget = null;
    this.dwell = 0;
  }

  /**
   * 选目标：在吸附锥内按角度偏差从小到大尝试，最多做 2 次视线检测（射线检测较贵）。
   * yaw/pitch 为当前（含后坐力的）准星朝向。
   */
  scan(p: Combatant, yaw: number, pitch: number, level: AssistLevel): void {
    const t = TUNE[level];
    let best: Combatant | null = null;
    let bestScore = Infinity;
    let second: Combatant | null = null;
    let secondScore = Infinity;
    const ex = p.body.x,
      ey = p.eyeY(),
      ez = p.body.z;
    for (const e of this.m.combatants) {
      if (e.team === p.team || !e.alive) continue;
      const dx = e.body.x - ex,
        dz = e.body.z - ez;
      const hd = Math.hypot(dx, dz);
      if (hd < 0.3 || hd > 75) continue;
      const ty = Math.atan2(-dx, -dz);
      const tp = Math.atan2(aimY(e) - ey, hd);
      const dy = wrap(ty - yaw),
        dp = tp - pitch;
      const ang = Math.hypot(dy, dp);
      // 近处目标在屏幕上更大：锥角随距离放大一些
      const cone = t.magnetCone + Math.min(0.12, 0.5 / hd);
      if (ang > cone) continue;
      if (ang < bestScore) {
        second = best;
        secondScore = bestScore;
        best = e;
        bestScore = ang;
      } else if (ang < secondScore) {
        second = e;
        secondScore = ang;
      }
    }
    let chosen: Combatant | null = null;
    if (best && this.m.canSee(p, best)) chosen = best;
    else if (second && this.m.canSee(p, second)) chosen = second;
    this.target = chosen;
    if (chosen) {
      const dx = chosen.body.x - ex,
        dz = chosen.body.z - ez;
      const hd = Math.hypot(dx, dz);
      this.dist = hd;
      this.errYaw = wrap(Math.atan2(-dx, -dz) - yaw);
      this.errPitch = Math.atan2(aimY(chosen) - ey, hd) - pitch;
    }
  }

  /** 视角转动减速系数（1 = 不减速） */
  friction(level: AssistLevel): number {
    if (!this.target) return 1;
    const t = TUNE[level];
    const cone = t.frictionCone + Math.min(0.08, 0.35 / Math.max(1, this.dist));
    const ang = Math.hypot(this.errYaw, this.errPitch);
    if (ang >= cone) return 1;
    return 1 - t.friction * (1 - ang / cone);
  }

  /**
   * 吸附：手指本帧转动了 lookRad 弧度时，最多把准星向目标拉 lookRad × magnet。
   * 返回 [dYaw, dPitch]（写入 out，避免分配）。
   */
  magnet(level: AssistLevel, lookRad: number, out: { yaw: number; pitch: number }): void {
    out.yaw = 0;
    out.pitch = 0;
    if (!this.target || lookRad <= 0) return;
    const ang = Math.hypot(this.errYaw, this.errPitch);
    if (ang < 1e-4) return;
    const pull = Math.min(ang, lookRad * TUNE[level].magnet);
    out.yaw = (this.errYaw / ang) * pull;
    out.pitch = (this.errPitch / ang) * pull;
  }

  /**
   * 自动开火判定：准星射线穿过目标身体（竖直圆柱近似）、在有效射程内，并持续 AUTO_DWELL 秒。
   * dirX/Y/Z 为准星方向（单位向量）。
   */
  autoFire(p: Combatant, dirX: number, dirY: number, dirZ: number, kind: WeaponKind, dt: number): boolean {
    const e = this.target;
    if (!e || this.dist > AUTO_RANGE[kind]) {
      this.dwell = 0;
      this.lastTarget = null;
      return false;
    }
    const ox = p.body.x,
      oy = p.eyeY(),
      oz = p.body.z;
    const cx = e.body.x - ox,
      cy = e.body.y + 1.0 - oy,
      cz = e.body.z - oz;
    const t = cx * dirX + cy * dirY + cz * dirZ;
    let onBody = false;
    if (t > 0) {
      const px = ox + dirX * t,
        py = oy + dirY * t,
        pz = oz + dirZ * t;
      const top = e.body.y + 1.85 - e.crouch * 0.45;
      onBody = Math.hypot(px - e.body.x, pz - e.body.z) < 0.36 && py > e.body.y + 0.15 && py < top;
    }
    if (!onBody) {
      this.dwell = 0;
      return false;
    }
    if (e !== this.lastTarget) {
      this.lastTarget = e;
      this.dwell = 0;
    }
    this.dwell += dt;
    return this.dwell >= AUTO_DWELL;
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
