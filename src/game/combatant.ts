import type { AgentDef, NadeId, WeaponDef } from '../data/defs.ts';
import { DEFAULT_SIDEARM, KNIFE, NADE_ORDER, WEAPONS } from '../data/defs.ts';
import type { Body } from '../world/physics.ts';
import type { CharacterModel } from '../render/models.ts';
import type { BotBrain } from './bot.ts';

export interface WeaponState {
  def: WeaponDef;
  mag: number;
  reserve: number;
  cooldown: number;
  reloadT: number;
  /** 连射计数（影响散布与后坐力） */
  spray: number;
  sprayResetT: number;
  /** 轻机枪转速（0..1） */
  spinK: number;
  /** 连发剩余发数与附加散布 */
  burstLeft: number;
  burstExtra: number;
  /** 机器人的后坐力累计（玩家的后坐力在镜头上，见 player.ts） */
  botRecoilP: number;
  botRecoilY: number;
}

export function newWeapon(id: string): WeaponState {
  const def = WEAPONS[id];
  return { def, mag: def.mag, reserve: def.reserve, cooldown: 0, reloadT: 0, spray: 0, sprayResetT: 0, spinK: 0, burstLeft: 0, burstExtra: 0, botRecoilP: 0, botRecoilY: 0 };
}

export const EYE = 1.62;
export const BODY_H = 1.8;
export const BODY_R = 0.34;

/**
 * 武器栏：0 主武器、1 副武器（手枪）、2 匕首、3 投掷物、4 熵核。
 * slots 只放三把真正的枪 / 刀；投掷物按数量记在 nades 里，熵核由 hasSpike 表示。
 */
export const SLOT_PRIMARY = 0;
export const SLOT_SIDEARM = 1;
export const SLOT_MELEE = 2;
export const SLOT_NADE = 3;
export const SLOT_SPIKE = 4;
export type SlotIndex = 0 | 1 | 2 | 3 | 4;

export class Combatant {
  body: Body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: BODY_R, height: BODY_H, onGround: true };
  yaw = 0;
  pitch = 0;
  crouch = 0;
  ads = 0;
  /** 狙击镜档位：0 不开镜，1 第一档，2 第二档 */
  scopeLevel = 0;
  hp = 100;
  armor = 0;
  alive = true;
  /** [主武器, 副武器, 匕首] */
  slots: [WeaponState | null, WeaponState, WeaponState] = [null, newWeapon(DEFAULT_SIDEARM), newWeapon(KNIFE)];
  slot: SlotIndex = 1;
  /** 上一次手持的栏位（丢枪 / 投掷后切回） */
  lastSlot: SlotIndex = 1;
  /** 投掷物数量与当前选中的种类 */
  nades: Record<NadeId, number> = { pili: 0, yanwu: 0, shanguang: 0 };
  nadeSel: NadeId = 'pili';
  /** 每种投掷物的手持状态（mag 与数量同步，供 HUD / 视图模型使用） */
  private nadeStates: Record<NadeId, WeaponState> = { pili: newWeapon('pili'), yanwu: newWeapon('yanwu'), shanguang: newWeapon('shanguang') };
  private spikeState = newWeapon('spike');
  /** 拔枪剩余时间（期间不能开火） */
  equipT = 0;
  /** 落地后的散布恢复（秒） */
  landT = 0;
  /** 连续开火时间（轻机枪转速） */
  fireHeldT = 0;
  credits = 0;
  kills = 0;
  deaths = 0;
  roundKills = 0;
  flashT = 0;
  slowT = 0;
  ampT = 0;
  healLeft = 0;
  hasSpike = false;
  speed = 0;
  /** 静步中（不出脚步声） */
  walking = false;
  stepT = 0;
  chargeQ = 0;
  chargeE = 0;
  ult = 0;
  /** 最近被敌方看见的剩余时间（用于小地图显示） */
  spottedT = 0;
  hurtT = 0;
  model!: CharacterModel;
  brain: BotBrain | null = null;

  // ---- 合作模式（单机时：human 只有玩家为 true，其余保持默认）
  /** 由真人操控（本机玩家或别的设备上的家人）；false = 电脑 */
  human = false;
  /** 网络木偶：状态来自别的设备（别人的玩家；非房主设备上的全部电脑） */
  remote = false;
  /** 负责结算这个角色的设备（seat）；单机为 -1 */
  seat = -1;
  /** 远端玩家是否在用触屏（电脑瞄准误差按此放宽） */
  touch = false;
  /** 远端玩家阵亡后正在答复活题（房主据此暂不判负） */
  netRevive = false;

  constructor(
    public id: number,
    public name: string,
    public team: 0 | 1,
    public isPlayer: boolean,
    public agent: AgentDef,
  ) {}

  get weapon(): WeaponState {
    switch (this.slot) {
      case 0:
        return this.slots[0] ?? this.slots[1];
      case 3: {
        const st = this.nadeStates[this.nadeSel];
        st.mag = this.nades[this.nadeSel];
        return st;
      }
      case 4:
        return this.spikeState;
      default:
        return this.slots[this.slot as 1 | 2];
    }
  }

  totalNades(): number {
    return this.nades.pili + this.nades.yanwu + this.nades.shanguang;
  }

  /** 选中下一种持有的投掷物（从 from 之后开始找）；没有则返回 false */
  pickNade(after: NadeId | null): boolean {
    const start = after ? NADE_ORDER.indexOf(after) + 1 : 0;
    for (let i = 0; i < NADE_ORDER.length; i++) {
      const id = NADE_ORDER[(start + i) % NADE_ORDER.length];
      if (this.nades[id] > 0) {
        this.nadeSel = id;
        return true;
      }
    }
    return false;
  }

  /** 该栏位当前能否手持 */
  hasSlot(s: SlotIndex): boolean {
    if (s === 0) return !!this.slots[0];
    if (s === 3) return this.totalNades() > 0;
    if (s === 4) return this.hasSpike;
    return true;
  }

  eyeY(): number {
    return this.body.y + EYE - this.crouch * 0.45;
  }

  /** 视线方向 */
  dirX(): number {
    return -Math.sin(this.yaw) * Math.cos(this.pitch);
  }
  dirY(): number {
    return Math.sin(this.pitch);
  }
  dirZ(): number {
    return -Math.cos(this.yaw) * Math.cos(this.pitch);
  }

  /** 新回合：keepGear 为 true 时保留武器 / 护盾 / 未用的投掷物（上回合存活），否则回到初始装备 */
  resetForRound(keepGear: boolean): void {
    if (!keepGear) {
      this.slots = [null, newWeapon(DEFAULT_SIDEARM), newWeapon(KNIFE)];
      this.armor = 0;
      this.nades.pili = this.nades.yanwu = this.nades.shanguang = 0;
    } else {
      for (const w of this.slots)
        if (w) {
          w.mag = w.def.mag;
          w.reserve = w.def.reserve;
          w.cooldown = 0;
          w.reloadT = 0;
          w.spray = 0;
          w.spinK = 0;
          w.burstLeft = 0;
          w.botRecoilP = w.botRecoilY = 0;
        }
    }
    this.slot = this.slots[0] ? 0 : 1;
    this.lastSlot = this.slot;
    this.pickNade(null);
    this.hp = 100;
    this.alive = true;
    this.flashT = this.slowT = this.ampT = this.healLeft = 0;
    this.hasSpike = false;
    this.roundKills = 0;
    this.spottedT = 0;
    this.crouch = 0;
    this.ads = 0;
    this.scopeLevel = 0;
    this.equipT = 0;
    this.landT = 0;
    this.fireHeldT = 0;
    this.pitch = 0;
    this.walking = false;
    this.body.vx = this.body.vy = this.body.vz = 0;
    this.chargeQ = this.agent.q.charges;
    this.chargeE = this.agent.e.charges;
  }
}
