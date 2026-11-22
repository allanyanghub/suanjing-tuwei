import * as THREE from 'three';
import {
  AGENTS,
  ARMORS,
  DEFAULT_SIDEARM,
  NADE_ORDER,
  RULES,
  THEMES,
  WEAPONS,
  agentById,
  isPrimary,
  type LevelDef,
  type NadeId,
  type WeaponDef,
} from '../data/defs.ts';
import {
  AIR_SPREAD,
  CROUCH_SPREAD,
  CROUCH_SPREAD_LMG,
  DEADZONE,
  LAND_RECOVER,
  LAND_SPREAD,
  LMG_SETTLE,
  LMG_SETTLE_MUL,
  RUN_SPEED,
  STEP_FRAC,
  WALK_MUL,
} from '../data/handling.ts';
import type { Difficulty, Question } from '../math/types.ts';
import { makeQuestion, topicsOfGrade } from '../math/index.ts';
import { audio } from '../core/audio.ts';
import type { Input } from '../core/input.ts';
import { persist, recordWrong, removeWrong, save } from '../core/save.ts';
import { applyDelta, matchDelta } from '../core/rank.ts';
import { GameMap, type SiteId, type Vec2 } from '../world/map.ts';
import { rayBoxes, rayCylinderY, raySphere, segmentClear, segmentHitsSphere } from '../world/physics.ts';
import type { Stage } from '../render/stage.ts';
import { Fx } from '../render/fx.ts';
import { CharacterModel, TEAM_COLORS, ViewModel, buildSpike, showsRed, teamView } from '../render/models.ts';
import { buildWorldItem, setNextWorldGun } from '../render/weapons.ts';
import { Combatant, SLOT_MELEE, SLOT_NADE, SLOT_PRIMARY, SLOT_SIDEARM, SLOT_SPIKE, newWeapon, type SlotIndex, type WeaponState } from './combatant.ts';
import { BotBrain, planRound, type TeamPlan } from './bot.ts';
import { PlayerController } from './player.ts';
import { AbilitySys, GRAVITY as NADE_G, NADE_LONG } from './abilities.ts';
import { TOUCH_DIFFICULTY } from './assist.ts';
import { CoopSync, type CoopRow } from './coop-sync.ts';
import type { CoopLink, CoopStart } from '../net/coop-link.ts';

export type Side = 'attack' | 'defend';
export type Phase = 'buy' | 'live' | 'planted' | 'end' | 'over';

export interface FocusQuiz {
  kind: 'plant' | 'defuse' | 'revive';
  q: Question;
  picked: number;
  /** 答错后的锁定倒计时（真实时间） */
  lockT: number;
  /** 全部答对后的完成倒计时 */
  doneT: number;
  /** 答对一题（还有下一题）后的过渡倒计时 */
  stepT: number;
  timeLeft: number;
  /** 本次需要连续答对的题数、已答对的题数 */
  need: number;
  done: number;
  ox: number;
  oz: number;
}

export interface MatchResult {
  win: boolean;
  score: [number, number];
  answered: number;
  correct: number;
  stars: number;
  kills: number;
  deaths: number;
  wrong: { q: Question; picked: number }[];
  /** 本局的通关正确率门槛 */
  pass: number;
  /** 合作模式的结算表（每个家人一行；单机时没有）；versus：联机对战（本机所在队伍的名字） */
  coop?: { members: CoopRow[]; versus?: { selfTeamName: string; otherTeamName: string } };
  /** 段位变化（before / after 为累计星数；delta 为实际变化，保段时可能比 rule 小） */
  rank?: RankChange;
}

export interface RankChange {
  before: number;
  after: number;
  delta: number;
  /** 按规则应得的星数变化（保段时实际变化可能是 0） */
  rule: number;
  why: string;
}

export interface MatchUI {
  killFeed(killer: Combatant | null, victim: Combatant, head: boolean, weapon: string): void;
  banner(text: string, sub: string, kind: 'win' | 'lose' | 'info', dur?: number): void;
  toast(text: string): void;
  hitMarker(head: boolean, kill: boolean): void;
  /** 本人击杀：屏幕中间弹出击杀图标（连杀升级） */
  killPop?(k: { streak: number; head: boolean; ace: boolean; bonus: number; total: number }): void;
  damageFrom(angle: number): void;
  flash(amount: number): void;
  openBuy(): void;
  closeBuy(): void;
  matchEnd(r: MatchResult): void;
  /** 每答完一题（任何场景）调用；用于上报答题记录 */
  answered?(e: AnswerEvent): void;
  /** 一回合结束（比分已更新） */
  roundOver?(): void;
  /** 合作模式：房间关闭 / 掉线（reason 是给孩子看的中文） */
  coopClosed?(reason: string): void;
}

export type AnswerContext = 'gate' | 'bonus' | 'plant' | 'defuse' | 'revive';

/** 一次作答 */
export interface AnswerEvent {
  q: Question;
  correct: boolean;
  context: AnswerContext;
  /** 从出题到作答的真实用时（毫秒） */
  ms: number;
  levelId: string;
  /** 家长出题的 id */
  customId?: number;
}

/** 通行题来源：家长出题 / 错题本重练 / 正常出题 */
export interface GatePick {
  q: Question;
  source: 'custom' | 'review' | 'generated';
  customId?: number;
  label?: string;
}

/** 由外部（联网层）决定通行题；generate 是正常出题 */
export type GatePicker = (generate: () => Question) => GatePick;

/**
 * 对局参数（全部可选，缺省 = 原有规则）。将来由服务端按孩子的情况下发。
 */
export interface MatchOptions {
  /** 先赢几回合（默认普通关 5、终局关 7）；打满 roundsToWin − 1 回合后交换攻防 */
  roundsToWin?: number;
  /** 星级评价的正确率门槛（默认 0.6） */
  passAccuracy?: number;
  /** 机器人强度倍率：乘在瞄准质量与伤害上（默认 1） */
  botStrength?: number;
  /** 演算复活题的作答时限（秒，默认 60；0 = 关闭复活） */
  reviveSeconds?: number;
  /** 是否必须答对通行题才能出击（默认 true） */
  gateRequired?: boolean;
  /** 出击前需要答对的通行题数量（默认 1） */
  gateCount?: number;
  /** 通行题之后可选的加分题数量（默认 2） */
  bonusCount?: number;
  /** 安装 / 拆除需要在同一次解题中连续答对的题数（默认 1） */
  plantQuestions?: number;
  defuseQuestions?: number;
}

/** 通关所需的最低答题正确率（默认值；可被 MatchOptions.passAccuracy 覆盖） */
export const PASS_ACC = 0.6;

const ALLY_NAMES = ['祖冲之', '华罗庚', '陈景润', '刘徽'];
const ENEMY_NAMES = ['悖论', '乱码', '余数', '无理数', '虚根'];
/** 联机对战里两队的电脑名字（各设备按全局队伍起名，保证一致） */
const VS_BOT_NAMES: [string[], string[]] = [
  ['祖冲之', '华罗庚', '陈景润', '刘徽', '秦九韶'],
  ['高斯', '欧拉', '费马', '阿基米德', '笛卡尔'],
];

/** 地上的武器 */
export interface DroppedWeapon {
  w: WeaponState;
  x: number;
  y: number;
  z: number;
  mesh: THREE.Object3D;
  age: number;
}

/** 本回合买的东西（可退回） */
interface BuyRecord {
  id: string;
  price: number;
  undo: () => void;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _dir = { x: 0, y: 0, z: 0 };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** 距离衰减分段 */
function falloffMul(def: WeaponDef, dist: number): number {
  let k = 1;
  for (const [d, m] of def.falloff) if (dist >= d) k = m;
  return k;
}

/** 第 n 发（从 1 开始）的后坐力：先竖直上抬 climb 发，之后上抬减弱并按固定节奏左右摆（可练习压枪） */
export function recoilKick(def: WeaponDef, n: number, out: { p: number; y: number }): void {
  const climb = Math.max(1, def.climb);
  out.p = def.recoil * (n <= climb ? 0.6 + (0.4 * n) / climb : 0.35);
  out.y = n > climb ? def.recoil * def.sway * Math.sin((n - climb) * 0.6 + 0.9) * 1.6 : 0;
}
const _kick = { p: 0, y: 0 };

export class Match {
  map: GameMap;
  fx = new Fx();
  group = new THREE.Group();
  abilities: AbilitySys;
  combatants: Combatant[] = [];
  player!: Combatant;
  playerCtl: PlayerController;
  viewModel: ViewModel;
  phase: Phase = 'buy';
  phaseT = 0;
  round = 0;
  /** [我方, 敌方] */
  score: [number, number] = [0, 0];
  playerSide: Side = 'attack';
  spike = {
    state: 'carried' as 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded',
    x: 0,
    z: 0,
    site: null as SiteId | null,
    timer: 0,
    beepT: 0,
    plantT: 0,
    defuseT: 0,
    defuser: null as Combatant | null,
    /** 玩家拆除：已经保住的答对题数（过半后离开也保留） */
    playerDefuseDone: 0,
  };
  private spikeModel = buildSpike(0xff5a3c);
  focus: FocusQuiz | null = null;
  reviveUsed = false;
  timeScale = 1;
  time = 0;
  stats = { answered: 0, correct: 0, wrong: [] as { q: Question; picked: number }[] };
  buyQuizIndex = 0;
  plans: [TeamPlan, TeamPlan] = [
    { site: 'A', alertSite: null, alertT: 0, stage: null, execT: 0, executing: false, lostT: -99 },
    { site: 'A', alertSite: null, alertT: 0, stage: null, execT: 0, executing: false, lostT: -99 },
  ];
  drops: DroppedWeapon[] = [];
  /** 本回合的购买记录（准备阶段可退回） */
  private buys: BuyRecord[] = [];
  /** 已解析的对局参数 */
  readonly opt: Required<MatchOptions>;
  private recent: string[] = [];
  private spotT = 0;
  private roundEndInfo: { win: boolean } | null = null;
  /** 第三人称模型当前挂着的武器 id（同类别武器换模型时需要重建） */
  private modelGun = new Map<Combatant, string>();
  rng: () => number = Math.random;
  disposed = false;
  /** 通行题来源（由 App 按家长设置注入；为空时正常出题） */
  gatePicker: GatePicker | null = null;
  /** 题目出现的时刻（计算作答用时） */
  private shownAt = new WeakMap<Question, number>();
  /** 通行题的来源信息 */
  private qMeta = new WeakMap<Question, GatePick>();
  /** 合作模式的同步层；单机为 null */
  coop: CoopSync | null = null;
  /** 合作：正在执行别的设备发来的事件（此时不再转发、不做权限检查） */
  netIn = false;
  /** 出题用的专题（合作模式按本机孩子的年级） */
  private topicIds: string[];

  constructor(
    public stage: Stage,
    public input: Input,
    public level: LevelDef,
    agentId: string,
    public ui: MatchUI,
    opts: MatchOptions = {},
    coop?: { link: CoopLink; start: CoopStart },
  ) {
    // 合作：关卡地图与参数以开局信息为准（各设备必须一致）
    if (coop) {
      opts = coop.start.opts ?? opts;
      if (coop.start.mapId && coop.start.mapId !== level.mapId) this.level = level = { ...level, mapId: coop.start.mapId };
    }
    const pos = (v: number | undefined, d: number, min = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : d);
    this.opt = {
      roundsToWin: Math.round(pos(opts.roundsToWin, level.roundsToWin, 1)),
      passAccuracy: clamp(pos(opts.passAccuracy, PASS_ACC), 0, 1),
      botStrength: pos(opts.botStrength, 1, 0.05),
      reviveSeconds: pos(opts.reviveSeconds, 60),
      gateRequired: opts.gateRequired ?? true,
      gateCount: Math.round(pos(opts.gateCount, RULES.gateCount)),
      bonusCount: Math.round(pos(opts.bonusCount, RULES.bonusCount)),
      plantQuestions: Math.round(pos(opts.plantQuestions, 1, 1)),
      defuseQuestions: Math.round(pos(opts.defuseQuestions, 1, 1)),
    };
    this.map = new GameMap(level.mapId);
    stage.buildWorld(this.map, THEMES[level.grade]);
    stage.scene.add(this.group);
    this.group.add(this.fx.group);
    // 特效全是半透明 / 叠加的，AO 几何缓冲里不画（否则数字碎片、冲击波会变成暗色方块）
    stage.skipAO(this.fx.group);
    this.group.add(this.spikeModel.group);
    this.abilities = new AbilitySys(this);

    this.topicIds = level.topicIds;
    let agent = agentById(agentId);
    teamView.flip = false;
    if (coop) {
      // ---- 合作：各设备按开局信息建出相同的名单（家人按 seat，电脑补满）
      const sync = new CoopSync(this, coop.link, coop.start);
      this.coop = sync;
      this.topicIds = topicsOfGrade(sync.grade).map((t) => t.id);
      if (!this.topicIds.length) this.topicIds = level.topicIds;
      const used = new Set(coop.start.members.map((x) => x.agentId));
      const free = AGENTS.filter((a) => !used.has(a.id));
      const allies = free.length ? free : AGENTS;
      this.combatants = sync.buildRoster((id, name, team, isPlayer, agentId2, i, gTeam) => {
        if (agentId2 !== null) return new Combatant(id, name, team, isPlayer, agentById(agentId2));
        if (sync.versus) {
          const names = VS_BOT_NAMES[gTeam];
          return new Combatant(id, names[i % names.length], team, false, allies[(i + gTeam * 2) % allies.length]);
        }
        return team === 0
          ? new Combatant(id, ALLY_NAMES[i % ALLY_NAMES.length], 0, false, allies[i % allies.length])
          : new Combatant(id, ENEMY_NAMES[i % ENEMY_NAMES.length], 1, false, AGENTS[i % AGENTS.length]);
      });
      this.player = this.combatants.find((c) => c.isPlayer) ?? this.combatants[0];
      agent = this.player.agent;
      // 联机对战本机在红队：按真实队伍上色（我方红、对方蓝）
      teamView.flip = sync.versus && sync.selfTeam === 1;
    } else {
      let id = 0;
      const p = new Combatant(id++, '你', 0, true, agent);
      p.human = true;
      this.player = p;
      this.combatants.push(p);
      const others = AGENTS.filter((a) => a.id !== agent.id);
      for (let i = 1; i < level.teamSize; i++)
        this.combatants.push(new Combatant(id++, ALLY_NAMES[(i - 1) % ALLY_NAMES.length], 0, false, others[(i - 1) % others.length]));
      for (let i = 0; i < level.teamSize; i++)
        this.combatants.push(new Combatant(id++, ENEMY_NAMES[i % ENEMY_NAMES.length], 1, false, AGENTS[i % AGENTS.length]));
    }
    if (typeof document !== 'undefined') document.documentElement.classList.toggle('team-red', teamView.flip);
    for (const c of this.combatants) {
      c.model = new CharacterModel(c.agent, showsRed(c.team));
      this.group.add(c.model.root);
      c.credits = RULES.startCredits;
      // 合作：只有房主上的电脑有大脑；别人的玩家与非房主上的电脑都是网络木偶
      if (!c.isPlayer && !c.human && !c.remote) c.brain = new BotBrain(c, this);
    }
    this.viewModel = new ViewModel(agent.color);
    this.viewModel.onPin = () => audio.pin();
    stage.vmScene.add(this.viewModel.root);
    this.playerCtl = new PlayerController(this, this.player);
    this.startRound();
  }

  dispose(): void {
    this.disposed = true;
    // 配色视角只在对局中有效：大厅里的「蓝队 / 红队」永远按真实颜色
    teamView.flip = false;
    if (typeof document !== 'undefined') document.documentElement.classList.remove('team-red');
    this.coop?.dispose();
    this.stage.scene.remove(this.group);
    this.stage.vmScene.remove(this.viewModel.root);
    this.abilities.clear();
    this.clearDrops();
    for (const c of this.combatants) c.model.dispose();
    this.stage.grade.uniforms.uDesat.value = 0;
  }

  /** 合作：本机不是房主、且不是在执行房主发来的事件——此时回合流程 / 熵核等房主的事不在本机做 */
  get follower(): boolean {
    return !!this.coop && !this.coop.isHost && !this.netIn;
  }

  // ------------------------------------------------------------ 阵营

  sideOf(team: 0 | 1): Side {
    return team === 0 ? this.playerSide : this.playerSide === 'attack' ? 'defend' : 'attack';
  }

  teamOfSide(side: Side): 0 | 1 {
    return this.playerSide === side ? 0 : 1;
  }

  aliveOf(team: 0 | 1): Combatant[] {
    return this.combatants.filter((c) => c.team === team && c.alive);
  }

  private aliveCount(team: 0 | 1): number {
    let n = 0;
    for (const c of this.combatants) if (c.team === team && c.alive) n++;
    return n;
  }

  // ------------------------------------------------------------ 回合

  /** 上半场的回合数（打满后交换攻防；先赢 N 回合者胜，没有加时） */
  get halfLength(): number {
    return Math.max(1, this.opt.roundsToWin - 1);
  }

  /** 补给站总题数 = 通行题 + 加分题 */
  get quizCount(): number {
    return this.gateNeed + this.opt.bonusCount;
  }

  /** 出击前需要答对的通行题数 */
  get gateNeed(): number {
    return this.opt.gateRequired ? this.opt.gateCount : 0;
  }

  /** 第 i 道补给题（从 0 开始）的难度：通行题为基础，加分题依次为提高 / 挑战 */
  quizDifficulty(i: number): Difficulty {
    if (i < this.gateNeed) return 1;
    return Math.min(3, 2 + (i - this.gateNeed)) as Difficulty;
  }

  startRound(): void {
    this.round++;
    const half = this.halfLength;
    const prevSide = this.playerSide;
    // 联机对战的红队设备：本机的我方是红队，上半场防守
    const firstAttack = !this.coop || this.coop.selfTeam === 0;
    this.playerSide = this.round <= half === firstAttack ? 'attack' : 'defend';
    const swapped = this.round > 1 && this.playerSide !== prevSide;
    this.abilities.clear();
    this.map.clearDynamic();
    this.fx.reset();
    this.clearDrops();
    this.focus = null;
    this.reviveUsed = this.opt.reviveSeconds <= 0;
    this.buyQuizIndex = 0;
    this.buys = [];
    this.roundEndInfo = null;
    this.spike.playerDefuseDone = 0;
    this.handoffT = 0;
    for (const team of [0, 1] as const) {
      const side = this.sideOf(team);
      const rect = side === 'attack' ? this.map.attackSpawn : this.map.defendSpawn;
      const members = this.combatants.filter((c) => c.team === team);
      members.forEach((c, i) => {
        // 交换攻防（半场）时装备与信用点重置，像新的手枪局
        if (swapped) c.credits = RULES.startCredits;
        c.resetForRound(c.alive && this.round > 1 && !swapped);
        const n = members.length;
        const fx = n === 1 ? 0.5 : i / (n - 1);
        c.body.x = rect.x0 + 1.2 + fx * (rect.x1 - rect.x0 - 2.4);
        c.body.z = (rect.z0 + rect.z1) / 2 + (i % 2 === 0 ? -1.2 : 1.2);
        c.body.y = 0;
        c.yaw = side === 'attack' ? 0 : Math.PI;
        c.brain?.reset();
        if (!c.isPlayer && !c.human && !c.remote) this.botLoadout(c, swapped);
        this.syncModel(c);
      });
    }
    const attackers = this.combatants.filter((c) => this.sideOf(c.team) === 'attack');
    const carrier = this.coop
      ? this.coop.carrierFor(attackers)
      : (attackers.find((c) => c.isPlayer) ?? attackers[Math.floor(this.rng() * attackers.length)]);
    carrier.hasSpike = true;
    this.spike.state = 'carried';
    this.spike.site = null;
    this.spike.plantT = this.spike.defuseT = 0;
    this.spike.defuser = null;
    this.spikeModel.group.visible = false;
    this.phase = 'buy';
    this.phaseT = 0;
    this.viewModel.setWeapon(this.player.weapon.def);
    this.coop?.roundStarted(carrier);
    if (swapped) this.ui.banner('交换攻防', `现在你是${this.playerSide === 'attack' ? '进攻方' : '防守方'} · 装备与信用点已重置`, 'info', 3.2);
    this.ui.openBuy();
  }

  /** 机器人整备：按信用点大致决定买什么（与玩家同价），偶尔带烟雾 / 闪光，低年级敌人不带手雷 */
  private botLoadout(c: Combatant, swapped: boolean): void {
    const pistolRound = this.round === 1 || swapped;
    if (pistolRound) {
      c.slots[0] = null;
      c.armor = 0;
      if (c.credits >= 800 + 400 && this.rng() < 0.3) {
        c.armor = 25;
        c.credits -= 400;
      }
    } else if (!c.slots[0]) {
      const r = this.rng();
      const cr = c.credits;
      let id: string | null;
      if (cr >= 3900) id = r < 0.06 ? 'tianshu' : r < 0.12 ? 'benlei' : r < 0.25 ? 'beichen' : r < 0.3 ? 'jingzhe' : 'changgeng';
      else if (cr >= 2250) id = r < 0.35 ? 'beichen' : r < 0.6 ? 'yuyan' : r < 0.75 ? 'jingzhe' : 'yeying';
      else if (cr >= 1600) id = r < 0.5 ? 'yuyan' : 'yeying';
      else if (cr >= 950) id = r < 0.65 ? 'yeying' : null;
      else id = null;
      if (id) {
        c.slots[0] = newWeapon(id);
        c.credits -= WEAPONS[id].price;
      }
      if (!id && c.credits >= 800 && this.rng() < 0.5) {
        c.slots[1] = newWeapon('poxiao');
        c.credits -= 800;
      }
      if (c.armor < 50 && c.credits >= 1000 + 400) {
        c.armor = 50;
        c.credits -= 1000;
      } else if (c.armor < 25 && c.credits >= 400) {
        c.armor = 25;
        c.credits -= 400;
      }
    }
    // 投掷物：少量，低频使用（见 bot.ts）
    // 联机对战两队都有家人：规则对两队相同
    const fragOk = (c.team === 0 && !this.coop?.versus) || this.level.grade >= 5;
    if (!pistolRound && c.credits >= 200 && this.rng() < 0.45) {
      c.nades.yanwu = Math.max(c.nades.yanwu, 1);
      c.credits -= 200;
    }
    if (!pistolRound && c.credits >= 250 && this.rng() < 0.35) {
      c.nades.shanguang = Math.max(c.nades.shanguang, 1);
      c.credits -= 250;
    }
    if (fragOk && !pistolRound && c.credits >= 300 && this.rng() < 0.15) {
      c.nades.pili = 1;
      c.credits -= 300;
    }
    c.slot = c.slots[0] ? 0 : 1;
    c.pickNade(null);
  }

  /** 本回合的通行题是否已全部答对（答对才能出击） */
  get gatePassed(): boolean {
    return this.buyQuizIndex >= this.gateNeed;
  }

  beginLive(): void {
    // 合作：点「出击」只是报名；所有人都准备好后由房主开战（netIn）
    if (this.coop && !this.netIn) {
      this.coop.markReady();
      return;
    }
    if (this.phase !== 'buy' || (!this.gatePassed && !this.coop)) return;
    this.phase = 'live';
    this.phaseT = RULES.roundTime;
    this.buys = [];
    this.ui.closeBuy();
    audio.roundStart();
    if (!this.coop || this.coop.isHost) planRound(this);
    this.coop?.liveStarted();
    const side = this.playerSide === 'attack' ? '进攻方' : '防守方';
    const tip =
      this.playerSide === 'attack'
        ? this.player.hasSpike
          ? `带着熵核前往 A 或 B 点安装（队友主攻 ${this.plans[0].site} 点，会先集合再进点）`
          : `掩护队友在 ${this.plans[0].site} 点安装熵核`
        : '守住 A、B 两点，阻止敌人安装熵核';
    this.ui.banner(`第 ${this.round} 回合 · ${side}`, tip, 'info', 3.2);
  }

  endRound(winSide: Side, _reason: string): void {
    if (this.phase === 'end' || this.phase === 'over' || this.follower) return;
    const reason = _reason;
    this.phase = 'end';
    this.phaseT = RULES.endTime;
    this.focus = null;
    const winTeam = this.teamOfSide(winSide);
    this.score[winTeam]++;
    const win = winTeam === 0;
    this.roundEndInfo = { win };
    for (const c of this.combatants)
      c.credits = Math.min(RULES.maxCredits, c.credits + (c.team === winTeam ? RULES.winBonus : RULES.lossBonus));
    this.coop?.roundEnded(winSide, reason);
    const n = this.opt.roundsToWin;
    const sub = this.round === this.halfLength && Math.max(this.score[0], this.score[1]) < n ? `${reason} · 下回合交换攻防` : reason;
    this.ui.banner(win ? '回合胜利' : '回合失败', sub, win ? 'win' : 'lose', 4);
    audio.roundEnd(win);
    this.ui.roundOver?.();
  }

  /** 终局。合作模式：不给星、不解锁，带上结算表（非房主由房主的 fin 事件调用，rows 为房主发来的表） */
  finish(rows?: CoopRow[]): void {
    if (this.phase === 'over' || this.follower) return;
    this.phase = 'over';
    const win = this.score[0] > this.score[1];
    const rank = this.applyRank(win);
    if (this.coop) {
      const members = rows ?? this.coop.finishTable();
      persist();
      this.ui.matchEnd({
        win,
        score: [this.score[0], this.score[1]],
        answered: this.stats.answered,
        correct: this.stats.correct,
        stars: 0,
        kills: this.player.kills,
        deaths: this.player.deaths,
        wrong: this.stats.wrong,
        pass: this.opt.passAccuracy,
        rank,
        coop: {
          members,
          versus: this.coop.versus ? { selfTeamName: this.coop.teamName(0), otherTeamName: this.coop.teamName(1) } : undefined,
        },
      });
      return;
    }
    const acc = this.stats.answered ? this.stats.correct / this.stats.answered : 0;
    // 通关 = 打赢 + 正确率达标；正确率不足门槛不给星，也不解锁下一关
    const pass = this.opt.passAccuracy;
    let stars = 0;
    if (win && acc >= pass) stars = 1 + (acc >= Math.max(pass, 0.8) ? 1 : 0) + (acc >= Math.max(pass, 0.95) ? 1 : 0);
    if (stars > 0) {
      save.stars[this.level.id] = Math.max(save.stars[this.level.id] ?? 0, stars);
      save.stats.wins++;
    }
    persist();
    this.ui.matchEnd({
      win,
      score: [this.score[0], this.score[1]],
      answered: this.stats.answered,
      correct: this.stats.correct,
      stars,
      kills: this.player.kills,
      deaths: this.player.deaths,
      wrong: this.stats.wrong,
      pass,
      rank,
    });
  }

  /** 段位：本局按胜负 + 本局正确率加减星（调用方负责 persist） */
  private applyRank(win: boolean): RankChange {
    const before = save.rank.pts;
    const d = matchDelta(win, this.stats.answered, this.stats.correct);
    save.rank = applyDelta(save.rank, d.delta);
    return { before, after: save.rank.pts, delta: save.rank.pts - before, rule: d.delta, why: d.why };
  }

  // ------------------------------------------------------------ 题目

  nextQuestion(diff: Difficulty): Question {
    let q = makeQuestion(this.topicIds, diff, this.rng);
    for (let i = 0; i < 8 && this.recent.includes(q.text); i++) q = makeQuestion(this.topicIds, diff, this.rng);
    this.recent.push(q.text);
    if (this.recent.length > 40) this.recent.shift();
    this.shownAt.set(q, performance.now());
    return q;
  }

  /** 补给站第 idx 道题：通行题可能是家长出题或错题再练（gatePicker 决定），加分题正常出题 */
  buyQuestion(idx: number): { q: Question; tag: string } {
    const d = this.quizDifficulty(idx);
    if (idx < this.gateNeed && this.gatePicker) {
      let pick: GatePick;
      try {
        pick = this.gatePicker(() => this.nextQuestion(d));
      } catch (e) {
        console.error('[对局] 通行题来源出错', e);
        pick = { q: this.nextQuestion(d), source: 'generated' };
      }
      this.shownAt.set(pick.q, performance.now());
      if (pick.source !== 'generated') {
        this.qMeta.set(pick.q, pick);
        if (pick.source === 'review') {
          this.recent.push(pick.q.text);
          if (this.recent.length > 40) this.recent.shift();
        }
      }
      return { q: pick.q, tag: pick.source === 'custom' ? '家长出题' : pick.source === 'review' ? '错题再练' : '' };
    }
    return { q: this.nextQuestion(d), tag: '' };
  }

  /** 最近出过的题干（给通行题来源去重用） */
  get recentTexts(): readonly string[] {
    return this.recent;
  }

  private record(q: Question, picked: number, context: AnswerContext): boolean {
    const ok = picked === q.answer;
    const meta = this.qMeta.get(q);
    this.stats.answered++;
    save.stats.answered++;
    if (ok) {
      this.stats.correct++;
      save.stats.correct++;
      this.player.ult = Math.min(this.player.agent.ultCost, this.player.ult + 1);
      // 错题再练答对：从错题本移除（与错题本"再练一次"相同）
      if (meta?.source === 'review') removeWrong({ q });
    } else {
      this.stats.wrong.push({ q, picked });
      // 错题再练答错：错题本里已经有这道题；家长出题不进错题本（家长那边有统计）
      if (!meta) recordWrong(q, picked, this.level.id);
    }
    persist();
    const t0 = this.shownAt.get(q);
    try {
      this.ui.answered?.({ q, correct: ok, context, ms: t0 === undefined ? 0 : Math.max(0, performance.now() - t0), levelId: this.level.id, customId: meta?.customId });
    } catch (e) {
      console.error('[对局] 答题上报出错', e);
    }
    return ok;
  }

  /** 准备阶段的补给题：返回是否答对，并发放奖励 */
  submitBuyAnswer(q: Question, picked: number): boolean {
    const ok = this.record(q, picked, this.buyQuizIndex < this.gateNeed ? 'gate' : 'bonus');
    // 通行题：答错不算完成，必须订正（再做一道同难度的题）；加分题答错也算做过
    if (ok || this.buyQuizIndex >= this.gateNeed) this.buyQuizIndex++;
    if (ok) {
      this.player.credits = Math.min(RULES.maxCredits, this.player.credits + RULES.quizReward[q.difficulty]);
      audio.correct();
    } else audio.wrong();
    return ok;
  }

  // ------------------------------------------------------------ 购买 / 退回

  /** 是否为本回合买的（可退回） */
  boughtThisRound(id: string): boolean {
    return this.buys.some((b) => b.id === id);
  }

  buy(id: string): boolean {
    if (this.phase !== 'buy') return false;
    const p = this.player;
    const w: WeaponDef | undefined = WEAPONS[id];
    if (w) {
      if (w.cls === 'throwable') {
        const nid = id as NadeId;
        const max = w.nade!.max;
        if (p.nades[nid] >= max || p.credits < w.price) return false;
        p.credits -= w.price;
        p.nades[nid]++;
        if (p.totalNades() === 1) p.nadeSel = nid;
        this.buys.push({ id, price: w.price, undo: () => (p.nades[nid] = Math.max(0, p.nades[nid] - 1)) });
        audio.equip();
        return true;
      }
      if (w.cls === 'melee' || w.cls === 'spike') return false;
      if (w.cls === 'sidearm') {
        if (p.slots[1].def.id === id || (w.price === 0 && p.slots[1].def.id === DEFAULT_SIDEARM) || p.credits < w.price) return false;
        const prev = p.slots[1];
        p.credits -= w.price;
        p.slots[1] = newWeapon(id);
        this.buys.push({ id, price: w.price, undo: () => (p.slots[1] = prev) });
        this.equipSlot(p, SLOT_SIDEARM, true);
        return true;
      }
      if (p.slots[0]?.def.id === id || p.credits < w.price) return false;
      const prev = p.slots[0];
      // 换掉本回合刚买的主武器：自动退回它的钱
      const old = this.buys.findIndex((b) => b.id === prev?.def.id);
      let restore = prev;
      if (old >= 0) {
        const rec = this.buys[old];
        this.buys.splice(old, 1);
        p.credits += rec.price;
        rec.undo();
        restore = p.slots[0];
      }
      if (p.credits < w.price) return false;
      p.credits -= w.price;
      p.slots[0] = newWeapon(id);
      this.buys.push({ id, price: w.price, undo: () => (p.slots[0] = restore) });
      this.equipSlot(p, SLOT_PRIMARY, true);
      return true;
    }
    const a = ARMORS.find((x) => x.id === id);
    if (a) {
      if (p.armor >= a.value || p.credits < a.price) return false;
      const prevArmor = p.armor;
      // 升级护盾：退回本回合买的轻型护盾
      const old = this.buys.findIndex((b) => ARMORS.some((x) => x.id === b.id));
      if (old >= 0) {
        p.credits += this.buys[old].price;
        this.buys.splice(old, 1);
      }
      if (p.credits < a.price) return false;
      p.credits -= a.price;
      p.armor = a.value;
      const before = old >= 0 ? 0 : prevArmor;
      this.buys.push({ id, price: a.price, undo: () => (p.armor = before) });
      return true;
    }
    return false;
  }

  /** 退回本回合买的物品（最近一次购买的该物品） */
  refund(id: string): boolean {
    if (this.phase !== 'buy') return false;
    for (let i = this.buys.length - 1; i >= 0; i--) {
      const b = this.buys[i];
      if (b.id !== id) continue;
      this.buys.splice(i, 1);
      b.undo();
      const p = this.player;
      p.credits = Math.min(RULES.maxCredits, p.credits + b.price);
      if (!p.hasSlot(p.slot)) this.equipSlot(p, p.slots[0] ? SLOT_PRIMARY : SLOT_SIDEARM, true);
      else this.equipSlot(p, p.slot, true);
      if (p.totalNades() > 0 && p.nades[p.nadeSel] <= 0) p.pickNade(null);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ 换枪

  /** 切到某一栏（不可用时返回 false）。force：即使已在该栏也重新同步模型 */
  equipSlot(c: Combatant, slot: SlotIndex, force = false): boolean {
    if (!c.hasSlot(slot)) return false;
    if (slot === c.slot && !force) return false;
    const cur = c.weapon;
    if (slot !== c.slot) {
      cur.reloadT = 0; // 收起的武器取消换弹
      cur.burstLeft = 0;
      c.lastSlot = c.slot;
    }
    c.slot = slot;
    c.ads = 0;
    c.scopeLevel = 0;
    c.fireHeldT = 0;
    if (slot === SLOT_NADE && c.nades[c.nadeSel] <= 0) c.pickNade(null);
    const w = c.weapon;
    w.spinK = 0;
    // 准备阶段换枪不需要拔枪时间
    c.equipT = this.phase === 'buy' ? 0 : w.def.equip;
    this.syncModel(c);
    if (c.isPlayer) {
      this.viewModel.setWeapon(w.def, c.equipT);
      audio.equip();
    }
    return true;
  }

  /** 第三人称模型挂上当前武器（同一握持类别的不同武器也要换模型） */
  syncModel(c: Combatant): void {
    const def = c.weapon.def;
    if (this.modelGun.get(c) === def.id) return;
    this.modelGun.set(c, def.id);
    setNextWorldGun(def.id);
    // CharacterModel.setWeapon 在握持类别不变时会直接返回；清掉它记住的类别以强制重建枪模型
    (c.model as unknown as { kind: string | null }).kind = null;
    c.model.setWeapon(def.kind);
    setNextWorldGun(null);
  }

  // ------------------------------------------------------------ 丢弃 / 拾取

  /** 丢弃当前手持的武器（主武器、买的手枪）或熵核。匕首与投掷物不能丢。 */
  dropCurrent(c: Combatant): boolean {
    if (!c.alive || this.phase === 'over') return false;
    if (c.slot === SLOT_SPIKE) {
      if (!c.hasSpike || this.sideOf(c.team) !== 'attack' || this.phase !== 'live') return false;
      // 合作：熵核由房主管理，丢下请房主执行（快照回来后自动切枪）
      if (this.follower) {
        this.coop!.reqSpikeDrop(c);
        return true;
      }
      this.dropSpike(c);
      this.spike.x = c.body.x + c.dirX() * 1.2;
      this.spike.z = c.body.z + c.dirZ() * 1.2;
      const p = this.map.nearestWalkable(this.spike.x, this.spike.z);
      this.spike.x = p.x;
      this.spike.z = p.z;
      // 刚丢下的熵核短时间内不会被自己捡回
      this.spikeNoPick = c;
      this.spikeNoPickT = 1.2;
      this.equipSlot(c, c.slots[0] ? SLOT_PRIMARY : SLOT_SIDEARM);
      if (c.isPlayer) audio.drop();
      return true;
    }
    // 合作模式第一版：不能丢枪（地上的武器不同步）
    if (this.coop) {
      if (c.isPlayer) this.ui.toast('合作模式里不能丢枪');
      return false;
    }
    if (c.slot === SLOT_PRIMARY && c.slots[0]) {
      const w = c.slots[0];
      c.slots[0] = null;
      this.spawnDrop(w, c, 1.6);
      this.equipSlot(c, SLOT_SIDEARM, true);
      return true;
    }
    if (c.slot === SLOT_SIDEARM && c.slots[1].def.price > 0) {
      const w = c.slots[1];
      // 手枪栏不会空着：丢掉买的手枪后换回标配手枪
      c.slots[1] = newWeapon(DEFAULT_SIDEARM);
      c.slots[1].mag = 0;
      c.slots[1].reserve = Math.round(c.slots[1].def.reserve / 3);
      this.spawnDrop(w, c, 1.6);
      this.equipSlot(c, SLOT_SIDEARM, true);
      return true;
    }
    if (c.isPlayer) this.ui.toast(c.slot === SLOT_MELEE ? '匕首不能丢弃' : c.slot === SLOT_NADE ? '投掷物不能丢弃' : '标配手枪不能丢弃');
    return false;
  }

  private spikeNoPick: Combatant | null = null;
  private spikeNoPickT = 0;

  private spawnDrop(w: WeaponState, c: Combatant, ahead: number): void {
    w.reloadT = 0;
    w.burstLeft = 0;
    let x = c.body.x + c.dirX() * ahead,
      z = c.body.z + c.dirZ() * ahead;
    if (!segmentClear(c.body.x, 0.4, c.body.z, x, 0.4, z, this.map.boxes)) {
      x = c.body.x;
      z = c.body.z;
    }
    const p = this.map.nearestWalkable(x, z);
    const t = rayBoxes(p.x, 3, p.z, 0, -1, 0, 4, this.map.boxes).t;
    const y = t <= 3 ? 3 - t : 0;
    const mesh = buildWorldItem(w.def.id);
    mesh.position.set(p.x, y + 0.05, p.z);
    mesh.rotation.set(0, c.yaw + Math.PI / 2, Math.PI / 2);
    this.group.add(mesh);
    this.drops.push({ w, x: p.x, y, z: p.z, mesh, age: 0 });
    if (c.isPlayer || Math.hypot(c.body.x - this.player.body.x, c.body.z - this.player.body.z) < 25) audio.drop(c.isPlayer ? undefined : c.body.x, c.isPlayer ? undefined : c.body.z);
  }

  private clearDrops(): void {
    // 模型与 GLB 模板共享几何 / 材质：只摘下，不释放
    for (const d of this.drops) d.mesh.parent?.remove(d.mesh);
    this.drops = [];
  }

  /** 玩家附近（可交互）的掉落武器 */
  nearDrop(maxD = 1.6): DroppedWeapon | null {
    const p = this.player;
    let best: DroppedWeapon | null = null;
    let bd = maxD;
    for (const d of this.drops) {
      const dd = Math.hypot(d.x - p.body.x, d.z - p.body.z);
      if (dd < bd && Math.abs(d.y - p.body.y) < 1.2) {
        bd = dd;
        best = d;
      }
    }
    return best;
  }

  /** 拾取：空栏自动拾取；swap = 用 F 交换当前同栏武器 */
  private pickUp(d: DroppedWeapon, c: Combatant, swap: boolean): boolean {
    const prim = isPrimary(d.w.def);
    const slot: SlotIndex = prim ? SLOT_PRIMARY : SLOT_SIDEARM;
    const empty = prim ? !c.slots[0] : c.slots[1].def.id === DEFAULT_SIDEARM && d.w.def.id !== DEFAULT_SIDEARM;
    if (!empty && !swap) return false;
    const i = this.drops.indexOf(d);
    if (i < 0) return false;
    this.drops.splice(i, 1);
    d.mesh.parent?.remove(d.mesh);
    const old = prim ? c.slots[0] : c.slots[1];
    if (prim) c.slots[0] = d.w;
    else c.slots[1] = d.w;
    if (old && swap && !(old.def.id === DEFAULT_SIDEARM && !prim)) this.spawnDrop(old, c, 0.8);
    this.equipSlot(c, slot, true);
    if (c.isPlayer) {
      audio.pickup();
      this.ui.toast(`拾取了 ${d.w.def.name}`);
    }
    return true;
  }

  private updateDrops(g: number): void {
    const p = this.player;
    for (const d of this.drops) {
      d.age += g;
      d.mesh.position.y = d.y + 0.05 + Math.max(0, 0.25 - d.age) * 0.6;
    }
    if (!p.alive || this.phase === 'over' || this.phase === 'buy') return;
    // 走到空栏对应的武器上自动拾取（刚丢下的 1 秒内不捡）
    const d = this.nearDrop(1.0);
    if (d && d.age > 1) this.pickUp(d, p, false);
  }

  // ------------------------------------------------------------ 专注解题（安装 / 拆除 / 复活）

  /** 交互提示（不含按键，HUD 会配上按键图标） */
  interactHint(): string {
    const p = this.player;
    if (!p.alive || this.focus) return '';
    if (this.phase === 'live' && p.hasSpike && this.map.siteOf(p.body.x, p.body.z)) return '解题安装熵核';
    if (this.phase === 'planted' && this.playerSide === 'defend' && Math.hypot(p.body.x - this.spike.x, p.body.z - this.spike.z) < 2.2)
      return this.spike.playerDefuseDone > 0 ? `继续解题拆除熵核（已完成 ${this.spike.playerDefuseDone} / ${this.opt.defuseQuestions}）` : '解题拆除熵核';
    if (this.phase !== 'buy' && this.phase !== 'over') {
      const d = this.nearDrop();
      if (d) return `拾取 ${d.w.def.name}`;
    }
    return '';
  }

  interact(): void {
    const p = this.player;
    if (this.focus && this.focus.kind !== 'revive') {
      if (this.focus.doneT <= 0) this.focus = null;
      return;
    }
    const hint = this.interactHint();
    if (!hint) return;
    if (hint.startsWith('拾取')) {
      const d = this.nearDrop();
      if (d) this.pickUp(d, p, true);
      return;
    }
    const kind = this.phase === 'live' ? 'plant' : 'defuse';
    const need = kind === 'plant' ? this.opt.plantQuestions : this.opt.defuseQuestions;
    this.focus = {
      kind,
      q: this.nextQuestion(kind === 'plant' ? 1 : this.level.boss ? 2 : 1),
      picked: -1,
      lockT: 0,
      doneT: 0,
      stepT: 0,
      timeLeft: 0,
      need,
      done: kind === 'defuse' ? Math.min(need - 1, this.spike.playerDefuseDone) : 0,
      ox: p.body.x,
      oz: p.body.z,
    };
    if (kind === 'plant' && p.slot !== SLOT_SPIKE) this.equipSlot(p, SLOT_SPIKE);
    audio.ui('open');
  }

  answerFocus(i: number): void {
    const f = this.focus;
    if (!f || f.doneT > 0 || f.lockT > 0 || f.stepT > 0 || i < 0 || i > 3) return;
    f.picked = i;
    if (this.record(f.q, i, f.kind)) {
      audio.correct();
      f.done++;
      if (f.kind === 'defuse' && f.done * 2 >= f.need && f.need >= 2) this.spike.playerDefuseDone = Math.max(this.spike.playerDefuseDone, Math.ceil(f.need / 2));
      if (f.kind === 'revive' || f.done >= f.need) f.doneT = 0.7;
      else f.stepT = 0.6;
    } else {
      audio.wrong();
      f.lockT = 4.5;
    }
  }

  private updateFocus(dt: number): void {
    const f = this.focus;
    if (!f) return;
    const p = this.player;
    if (this.phase === 'end' || this.phase === 'over') {
      this.focus = null;
      return;
    }
    if (f.kind !== 'revive') {
      const moved = Math.hypot(p.body.x - f.ox, p.body.z - f.oz) > 1.0;
      const invalid =
        !p.alive || moved || (f.kind === 'plant' && (this.phase !== 'live' || !p.hasSpike)) || (f.kind === 'defuse' && this.spike.state !== 'planted');
      if (invalid && f.doneT <= 0) {
        if (moved && p.alive) this.ui.toast(f.kind === 'defuse' && this.spike.playerDefuseDone > 0 ? '离开位置：拆除进度已保留一半' : '离开位置，操作已中断');
        this.focus = null;
        return;
      }
    }
    if (f.doneT > 0) {
      f.doneT -= dt;
      if (f.doneT <= 0) {
        this.focus = null;
        if (f.kind === 'plant') this.plantSpike(p);
        else if (f.kind === 'defuse') this.defuseSpike(p);
        else this.revivePlayer();
      }
    } else if (f.stepT > 0) {
      f.stepT -= dt;
      if (f.stepT <= 0) {
        f.q = this.nextQuestion(f.q.difficulty);
        f.picked = -1;
      }
    } else if (f.lockT > 0) {
      f.lockT -= dt;
      if (f.lockT <= 0) {
        if (f.kind === 'revive') this.focus = null;
        else {
          f.q = this.nextQuestion(f.q.difficulty);
          f.picked = -1;
        }
      }
    } else if (f.kind === 'revive') {
      f.timeLeft -= dt;
      if (f.timeLeft <= 0) this.focus = null;
    }
  }

  private onPlayerDeath(): void {
    this.focus = null;
    if (!this.reviveUsed && this.opt.reviveSeconds > 0 && (this.phase === 'live' || this.phase === 'planted')) {
      this.reviveUsed = true;
      this.focus = {
        kind: 'revive',
        q: this.nextQuestion(2),
        picked: -1,
        lockT: 0,
        doneT: 0,
        stepT: 0,
        timeLeft: this.opt.reviveSeconds,
        need: 1,
        done: 0,
        ox: 0,
        oz: 0,
      };
    }
  }

  private revivePlayer(): void {
    const p = this.player;
    if (p.alive || (this.phase !== 'live' && this.phase !== 'planted')) return;
    const rect = this.playerSide === 'attack' ? this.map.attackSpawn : this.map.defendSpawn;
    const pt = this.map.randomPointIn(rect, this.rng);
    p.alive = true;
    p.hp = 70;
    p.body.x = pt.x;
    p.body.z = pt.z;
    p.body.y = 0;
    p.body.vx = p.body.vy = p.body.vz = 0;
    p.yaw = this.playerSide === 'attack' ? 0 : Math.PI;
    p.pitch = 0;
    for (const w of p.slots)
      if (w) {
        w.mag = w.def.mag;
        w.reloadT = 0;
      }
    this.equipSlot(p, p.slots[0] ? SLOT_PRIMARY : SLOT_SIDEARM, true);
    this.ui.banner('演算复活', '答对了！你回到了出生点', 'win', 2.2);
    audio.ult();
  }

  /** team 队（本机视角）有玩家阵亡且复活题仍在进行时，回合暂不判负 */
  private revivePending(team: 0 | 1): boolean {
    if (this.coop?.remoteRevivePending(team)) return true;
    return team === 0 && !!this.focus && this.focus.kind === 'revive' && this.focus.lockT <= 0;
  }

  // ------------------------------------------------------------ 熵核

  dropSpike(c: Combatant): void {
    c.hasSpike = false;
    this.spike.state = 'dropped';
    this.spike.x = c.body.x;
    this.spike.z = c.body.z;
    if (c.slot === SLOT_SPIKE) c.slot = c.slots[0] ? SLOT_PRIMARY : SLOT_SIDEARM;
  }

  /** at：合作模式里房主发来的安装位置（非房主执行） */
  plantSpike(by: Combatant, at?: { x: number; z: number; site: SiteId }): void {
    if (this.follower) {
      // 合作：答题在本机完成，安装由房主执行
      if (this.phase === 'live' && by.hasSpike) this.coop!.reqPlant(by);
      return;
    }
    if (this.phase !== 'live' || (!by.hasSpike && !at)) return;
    const site = at ? at.site : this.map.siteOf(by.body.x, by.body.z);
    if (!site) return;
    by.hasSpike = false;
    if (by.slot === SLOT_SPIKE) this.equipSlot(by, by.slots[0] ? SLOT_PRIMARY : SLOT_SIDEARM, true);
    const s = this.spike;
    s.state = 'planted';
    s.x = by.body.x + by.dirX() * 0.5;
    s.z = by.body.z + by.dirZ() * 0.5;
    const near = this.map.nearestWalkable(s.x, s.z);
    if (Math.hypot(near.x - s.x, near.z - s.z) > 0.6) {
      s.x = by.body.x;
      s.z = by.body.z;
    }
    if (at) {
      s.x = at.x;
      s.z = at.z;
    }
    this.coop?.planted(by, s.x, s.z, site);
    s.site = site;
    s.timer = RULES.spikeTime;
    s.beepT = 0;
    s.defuseT = 0;
    s.defuser = null;
    this.phase = 'planted';
    for (const c of this.combatants)
      if (c.team === by.team) c.credits = Math.min(RULES.maxCredits, c.credits + RULES.plantBonus);
    this.ui.banner('熵核已安装', `${site} 点 · ${RULES.spikeTime} 秒后引爆`, by.team === 0 ? 'win' : 'lose', 2.6);
    audio.planted();
    for (const p of this.plans) p.site = site;
    // 防守方先集合再回防
    this.plans[this.teamOfSide('defend')].retakeT = this.time + 6 + this.rng() * 4;
    for (const c of this.combatants) c.brain?.onPlanted();
  }

  defuseSpike(_by: Combatant): void {
    if (this.spike.state !== 'planted') return;
    if (this.follower) {
      this.coop!.reqDefuse();
      return;
    }
    this.coop?.defused(_by);
    this.spike.state = 'defused';
    _a.set(this.spike.x, 0.4, this.spike.z);
    this.fx.ring(_a, 6, 0x4be3a4, 0.9);
    this.endRound('defend', '熵核已被拆除');
  }

  explodeSpike(): void {
    if (this.follower || this.spike.state !== 'planted') return;
    this.coop?.exploded();
    const s = this.spike;
    s.state = 'exploded';
    this.spikeModel.group.visible = false;
    _a.set(s.x, 1, s.z);
    this.fx.shockwave(_a, 16, 0xff7a3c, 1.3);
    this.fx.ring(_a, 22, 0xffd08a, 1.2);
    audio.explosion(s.x, s.z, true);
    // 合作的非房主：阵亡由各自的设备结算后广播
    if (!this.coop || this.coop.isHost)
      for (const c of this.combatants)
        if (c.alive && Math.hypot(c.body.x - s.x, c.body.z - s.z) < 14) this.kill(c, null, false, '熵核');
    this.ui.flash(0.8);
    this.endRound('attack', '熵核引爆');
  }

  private updateSpike(g: number): void {
    const s = this.spike;
    const m = this.spikeModel;
    this.spikeNoPickT -= g;
    if (s.state === 'dropped') {
      m.group.visible = true;
      m.group.position.set(s.x, 0, s.z);
      // 合作：只有房主判定谁捡到了熵核
      if (!this.follower) for (const c of this.combatants) {
        if (!c.alive || this.sideOf(c.team) !== 'attack') continue;
        if (c === this.spikeNoPick && this.spikeNoPickT > 0) continue;
        if (Math.hypot(c.body.x - s.x, c.body.z - s.z) < 1.3) {
          c.hasSpike = true;
          s.state = 'carried';
          if (c.isPlayer) {
            this.ui.toast('已拾取熵核');
            audio.pickup();
          }
          break;
        }
      }
    } else if (s.state === 'planted') {
      m.group.visible = true;
      m.group.position.set(s.x, 0, s.z);
      s.timer -= g;
      s.beepT -= g;
      if (s.beepT <= 0) {
        const k = Math.max(0, s.timer / RULES.spikeTime);
        s.beepT = 0.14 + k * 0.9;
        audio.beep(s.x, s.z, s.timer < 10);
        _a.set(s.x, 0.4, s.z);
        this.fx.ring(_a, 2.2, 0xff5a3c, 0.45);
      }
      if (s.defuser && (!s.defuser.alive || Math.hypot(s.defuser.body.x - s.x, s.defuser.body.z - s.z) > 1.8)) {
        s.defuser = null;
        // 拆过一半：进度保留在一半
        s.defuseT = s.defuseT >= RULES.botDefuseHalf ? RULES.botDefuseHalf : 0;
      }
      if (s.timer <= 0 && !this.follower) this.explodeSpike();
    } else m.group.visible = s.state === 'defused';
    if (m.group.visible) {
      m.core.rotation.y = this.time * 2.4;
      m.core.position.y = 0.42 + Math.sin(this.time * 3) * 0.04;
      m.ring.rotation.x = this.time * 1.6;
      m.ring.rotation.y = this.time * 1.1;
      m.light.intensity = 3 + Math.sin(this.time * 9) * 2;
    }
  }

  // ------------------------------------------------------------ 射击与伤害

  startReload(c: Combatant): void {
    const w = c.weapon;
    if (w.def.reload <= 0 || w.reloadT > 0 || w.mag >= w.def.mag || w.reserve <= 0) return;
    w.reloadT = w.def.reload;
    w.burstLeft = 0;
    if (c.isPlayer) {
      audio.reload();
      this.viewModel.cancelInspect();
    }
  }

  /** 当前真实散布（弧度，圆锥半径）：与开火时完全一致，HUD 准星据此扩散 */
  spreadOf(c: Combatant, w: WeaponState, extra = 0): number {
    const def = w.def;
    let spread = def.spread;
    const ads = c.ads > 0.5;
    if (def.cls === 'sniper') {
      // 狙击：开镜极准，不开镜很散
      if (c.ads > 0.9 && c.scopeLevel > 0) spread *= def.adsSpread;
    } else if (ads) spread *= def.adsSpread;
    // 移动散布：低于精准阈值不计；静步速度内按静步散布，超过后逐渐到奔跑散布
    const run = RUN_SPEED * def.moveMul;
    const walk = run * WALK_MUL;
    const dz = run * DEADZONE;
    const sp = c.speed;
    if (sp > dz) {
      if (sp <= walk) spread += def.walkSpread * ((sp - dz) / Math.max(0.01, walk - dz));
      else spread += def.walkSpread + (def.runSpread - def.walkSpread) * Math.min(1, (sp - walk) / Math.max(0.01, run - walk));
    }
    if (!c.body.onGround) spread += AIR_SPREAD;
    else if (c.landT > 0) spread += LAND_SPREAD * (c.landT / LAND_RECOVER);
    spread += Math.min(def.spreadMax, w.spray * def.spreadShot);
    if (def.cls === 'lmg') spread *= 1 - (1 - LMG_SETTLE_MUL) * Math.min(1, w.spray / LMG_SETTLE);
    spread *= 1 - (1 - (def.cls === 'lmg' ? CROUCH_SPREAD_LMG : CROUCH_SPREAD)) * c.crouch;
    return spread + extra;
  }

  /** 当前射击间隔（秒） */
  fireInterval(c: Combatant, w: WeaponState): number {
    const def = w.def;
    let rpm = def.rpm;
    if (c.ads > 0.5) rpm *= def.adsRpm;
    if (def.spin > 0) rpm *= def.spinFrom + (1 - def.spinFrom) * w.spinK;
    return 60 / rpm;
  }

  /** 是否可以开火（拔枪、换弹、冷却都结束） */
  canFire(c: Combatant): boolean {
    const w = c.weapon;
    return c.alive && c.equipT <= 0 && w.cooldown <= 0 && w.reloadT <= 0 && w.burstLeft <= 0;
  }

  /**
   * 主射击 / 副射击（alt）。方向 (ax,ay,az) 为单位向量（玩家含后坐力偏移）。成功返回 true。
   * 不同类别：枪械射击（含右键连发）、匕首快划 / 重刺、投掷物远投 / 近抛。熵核不在这里处理。
   */
  fire(c: Combatant, ax: number, ay: number, az: number, extraSpread = 0, alt = false): boolean {
    const w = c.weapon;
    const def = w.def;
    if (!this.canFire(c)) return false;
    if (def.cls === 'melee') return this.melee(c, ax, ay, az, alt);
    if (def.cls === 'throwable') return this.throwNade(c, ax, ay, az, !alt);
    if (def.cls === 'spike') return false;
    if (w.mag <= 0) {
      if (c.isPlayer && w.reserve <= 0) audio.empty();
      this.startReload(c);
      w.cooldown = 0.25;
      return false;
    }
    // 连发：右键（手枪）或机瞄中左键（入门冲锋枪）
    const burst = (def.alt === 'burst' && alt) || (def.alt === 'adsBurst' && c.ads > 0.5);
    if (burst && def.burst > 1) {
      w.burstLeft = Math.min(def.burst, w.mag);
      w.burstExtra = def.burstSpread + extraSpread;
      return this.burstShot(c, ax, ay, az);
    }
    this.shoot(c, ax, ay, az, extraSpread);
    w.cooldown = this.fireInterval(c, w);
    return true;
  }

  /** 连发中的一发（第一发由 fire 触发，其余由 update 按 burstGap 触发） */
  private burstShot(c: Combatant, ax: number, ay: number, az: number): boolean {
    const w = c.weapon;
    if (w.mag <= 0) {
      w.burstLeft = 0;
      return false;
    }
    this.shoot(c, ax, ay, az, w.burstExtra);
    w.burstLeft--;
    // 连发结束后的冷却稍长：鼓励点射节奏
    w.cooldown = w.burstLeft > 0 ? w.def.burstGap : Math.max(this.fireInterval(c, w), w.def.burstGap * 2) + 0.18;
    return true;
  }

  /** 射出一发（含多颗弹丸） */
  private shoot(c: Combatant, ax: number, ay: number, az: number, extraSpread: number): void {
    const w = c.weapon;
    const def = w.def;
    w.mag--;
    const spread = this.spreadOf(c, w, extraSpread);
    w.spray++;
    w.sprayResetT = def.reset;
    if (c.isPlayer) this.viewModel.cancelInspect();
    // 机器人：同一套后坐力规律（玩家由镜头偏移表现，见 player.ts）
    if (!c.isPlayer) {
      recoilKick(def, w.spray, _kick);
      const control = 0.45 + 0.4 * this.botSkill;
      w.botRecoilP += _kick.p * (1 - control);
      w.botRecoilY += _kick.y * (1 - control);
      const ey = Math.atan2(-ax, -az) + w.botRecoilY;
      const ep = Math.asin(clamp(ay, -1, 1)) + w.botRecoilP;
      const ccp = Math.cos(ep);
      ax = -Math.sin(ey) * ccp;
      ay = Math.sin(ep);
      az = -Math.cos(ey) * ccp;
    }

    // 构造垂直基
    let rx = -az,
      rz = ax;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    const ux = -rz * ay,
      uy = rz * ax - rx * az,
      uz = rx * ay;
    const ox = c.body.x,
      oy = c.eyeY(),
      oz = c.body.z;
    if (c.isPlayer) {
      this.stage.camera.getWorldPosition(_a);
      _a.x += rx * 0.16 + ax * 0.5;
      _a.y += -0.14 + ay * 0.5;
      _a.z += rz * 0.16 + az * 0.5;
    } else c.model.muzzle(_a);
    const startX = _a.x,
      startY = _a.y,
      startZ = _a.z;
    for (let i = 0; i < def.pellets; i++) {
      const ang = this.rng() * Math.PI * 2;
      const rad = spread * Math.sqrt(this.rng()) * (0.5 + 0.5 * this.rng());
      const cx = Math.cos(ang) * rad,
        cy = Math.sin(ang) * rad;
      let dx = ax + rx * cx + ux * cy,
        dy = ay + uy * cy,
        dz = az + rz * cx + uz * cy;
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl;
      dy /= dl;
      dz /= dl;
      this.hitscan(c, ox, oy, oz, dx, dy, dz, def, startX, startY, startZ, i < 3);
    }
    // 合作：别的设备画这一枪的弹道与声音
    if (this.coop && !c.remote) this.coop.sendShot(c, ax, ay, az, def.id);
    if (c.isPlayer) {
      audio.shot(def.id);
      this.viewModel.fire();
      this.playerCtl.recoil(def, w.spray);
    } else {
      audio.shot(def.id, c.body.x, c.body.z);
      _b.set(startX, startY, startZ);
      _n.set(ax, ay, az);
      this.fx.spark(_b, _n, 0xffc880, 3, 3, 0.08, 0);
    }
    if (w.mag <= 0 && w.reserve > 0) this.startReload(c);
  }

  /** 匕首：瞬时锥形判定（距离 ≈ 1.8 米），背后出手伤害翻倍 */
  private melee(c: Combatant, ax: number, ay: number, az: number, heavy: boolean): boolean {
    const w = c.weapon;
    const spec = w.def.melee!;
    const [dmg, back, cd] = heavy ? spec.heavy : spec.quick;
    w.cooldown = cd;
    if (c.isPlayer) {
      this.viewModel.melee(heavy);
      audio.knife(heavy);
    } else audio.knife(heavy, c.body.x, c.body.z);
    if (this.coop && !c.remote) this.coop.sendShot(c, ax, ay, az, w.def.id);
    const ox = c.body.x,
      oy = c.eyeY(),
      oz = c.body.z;
    let best: Combatant | null = null;
    let bestD = Infinity;
    const cosCone = Math.cos(spec.cone);
    for (const e of this.combatants) {
      if (!e.alive || e.team === c.team) continue;
      // 目标点：躯干中部（与视线高度最接近的身体高度）
      const ty = clamp(oy + ay * 1.2, e.body.y + 0.4, e.eyeY());
      const dx = e.body.x - ox,
        dy = ty - oy,
        dz = e.body.z - oz;
      const d = Math.hypot(dx, dy, dz);
      const reach = spec.range + e.body.radius;
      if (d > reach || d < 1e-3) continue;
      const dot = (dx * ax + dy * ay + dz * az) / d;
      if (dot < cosCone && d > e.body.radius + 0.25) continue;
      if (!segmentClear(ox, oy, oz, e.body.x, ty, e.body.z, this.map.boxes)) continue;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) return true;
    // 背刺：攻击者位于目标身后半球
    const fx = -Math.sin(best.yaw),
      fz = -Math.cos(best.yaw);
    const tx = c.body.x - best.body.x,
      tz = c.body.z - best.body.z;
    const tl = Math.hypot(tx, tz) || 1;
    const behind = (tx * fx + tz * fz) / tl < -0.3;
    _b.set(best.body.x, best.body.y + 1.2, best.body.z);
    _n.set(-ax, 0.3, -az);
    this.fx.spark(_b, _n, best.team === 1 ? TEAM_COLORS.enemy : TEAM_COLORS.ally, 10, 3, 0.3);
    if (c.isPlayer) audio.knifeHit();
    this.damage(best, behind ? back : dmg, c, false, w.def.name);
    return true;
  }

  /** 投掷物：左键远投 / 右键近抛 */
  private throwNade(c: Combatant, ax: number, ay: number, az: number, long: boolean, raw = false): boolean {
    const id = c.nadeSel;
    if (c.nades[id] <= 0) return false;
    const def = WEAPONS[id];
    c.nades[id]--;
    c.weapon.cooldown = 0.55;
    this.abilities.throwNade(c, def.nade!.kind, id, ax, ay, az, long, raw);
    if (this.coop && !c.remote) this.coop.sendNade(c, def.nade!.kind, id, ax, ay, az, long, raw);
    if (c.isPlayer) {
      this.viewModel.throwNade();
      audio.nadeThrow();
    } else audio.nadeThrow(c.body.x, c.body.z);
    // 扔完：换下一种投掷物；都没了就切回之前的武器
    if (c.nades[id] <= 0) {
      if (!c.pickNade(id)) {
        const back = c.lastSlot !== SLOT_NADE && c.hasSlot(c.lastSlot) ? c.lastSlot : c.slots[0] ? SLOT_PRIMARY : SLOT_SIDEARM;
        this.pendingSwitch.set(c, back);
        this.pendingSwitchT.set(c, 0.45);
      } else if (c.isPlayer) this.viewModel.setWeapon(c.weapon.def, 0.3);
    }
    return true;
  }

  /** 投掷后延迟切回武器（等出手动画） */
  private pendingSwitch = new Map<Combatant, SlotIndex>();
  private pendingSwitchT = new Map<Combatant, number>();

  /**
   * 机器人：把投掷物扔向 (tx,tz)（远投，按抛物线反算仰角）。kind 为投掷物 id。
   */
  botThrow(c: Combatant, id: NadeId, tx: number, tz: number): boolean {
    if (c.nades[id] <= 0 || !c.alive) return false;
    const dx = tx - c.body.x,
      dz = tz - c.body.z;
    const R = Math.hypot(dx, dz);
    if (R < 1) return false;
    const v = NADE_LONG.speed;
    const s = Math.min(1, (R * NADE_G) / (v * v));
    const th = 0.5 * Math.asin(s);
    const ch = Math.cos(th);
    const prevSel = c.nadeSel;
    c.nadeSel = id;
    const prevSlot = c.slot;
    c.slot = SLOT_NADE;
    const w = c.weapon;
    const cd = w.cooldown;
    w.cooldown = 0;
    const eq = c.equipT;
    c.equipT = 0;
    const ok = this.throwNade(c, (dx / R) * ch, Math.sin(th), (dz / R) * ch, true, true);
    // 机器人投掷不占用武器栏：立即恢复
    c.slot = prevSlot;
    c.equipT = eq;
    w.cooldown = cd;
    this.pendingSwitch.delete(c);
    if (c.nades[prevSel] > 0) c.nadeSel = prevSel;
    else c.pickNade(null);
    this.syncModel(c);
    return ok;
  }

  private hitscan(
    c: Combatant,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    def: WeaponDef,
    sx: number,
    sy: number,
    sz: number,
    drawTracer: boolean,
  ): void {
    const wh = rayBoxes(ox, oy, oz, dx, dy, dz, 220, this.map.boxes);
    let best = wh.t;
    const wnx = wh.nx,
      wny = wh.ny,
      wnz = wh.nz;
    let hitWorld = best < Infinity;
    // 地面
    if (dy < 0) {
      const tg = -oy / dy;
      if (tg < best) {
        best = tg;
        hitWorld = true;
        _n.set(0, 1, 0);
      } else _n.set(wnx, wny, wnz);
    } else _n.set(wnx, wny, wnz);
    let victim: Combatant | null = null;
    let zone = 1;
    for (const e of this.combatants) {
      if (!e.alive || e.team === c.team) continue;
      const ex = e.body.x,
        ez = e.body.z;
      const headY = e.eyeY() + 0.03;
      const bodyBot = e.body.y + 0.72 - e.crouch * 0.2;
      let t = raySphere(ox, oy, oz, dx, dy, dz, ex, headY, ez, 0.2);
      if (t < best) {
        best = t;
        victim = e;
        zone = 2;
      }
      t = rayCylinderY(ox, oy, oz, dx, dy, dz, ex, ez, 0.33, bodyBot, headY - 0.17);
      if (t < best) {
        best = t;
        victim = e;
        zone = 1;
      }
      t = rayCylinderY(ox, oy, oz, dx, dy, dz, ex, ez, 0.24, e.body.y, bodyBot);
      if (t < best) {
        best = t;
        victim = e;
        zone = 0;
      }
    }
    const dist = best < Infinity ? best : 120;
    _b.set(ox + dx * dist, oy + dy * dist, oz + dz * dist);
    if (drawTracer) {
      _a.set(sx, sy, sz);
      this.fx.tracer(_a, _b, showsRed(c.team) ? 0xff9a8a : 0xffe2a8, def.cls === 'sniper' ? 0.04 : 0.02);
    }
    if (victim) {
      const k = falloffMul(def, dist);
      const mul = zone === 2 ? def.headMul : zone === 0 ? def.legMul : 1;
      _n.set(-dx, 0.3, -dz);
      this.fx.spark(_b, _n, victim.team === 1 ? TEAM_COLORS.enemy : TEAM_COLORS.ally, zone === 2 ? 14 : 7, 3.5, 0.35);
      this.damage(victim, def.dmg * mul * k, c, zone === 2, def.name);
    } else if (hitWorld) {
      this.fx.decal(_b, _n);
      this.fx.spark(_b, _n, 0xffd9a0, 5, 3, 0.25);
    }
  }

  /** 机器人技能（0..1，不含 botStrength） */
  get botSkill(): number {
    return clamp(this.level.botSkill, 0, 1);
  }

  damage(v: Combatant, amount: number, attacker: Combatant | null, head: boolean, weapon: string): void {
    if (!v.alive || this.phase === 'buy' || this.phase === 'over') return;
    const self = attacker === v;
    if (attacker && !self) {
      if (attacker.ampT > 0) amount *= 1.6;
      if (!attacker.human) amount *= (0.5 + 0.4 * this.level.botSkill) * this.opt.botStrength;
    }
    if (this.coop) {
      // 合作：攻击者所在的设备结算（电脑 / 无主伤害 = 房主）；受害者在别的设备上时把伤害发过去
      if (attacker ? attacker.remote : !this.coop.isHost) return;
      if (v.remote) {
        if (attacker?.isPlayer && !self) {
          // 本机先预测命中提示（生命值以房主的快照为准）
          const ab = Math.min(v.armor, amount * 0.66);
          v.armor -= ab;
          v.hp -= amount - ab;
          this.ui.hitMarker(head, v.hp <= 0);
          audio.hit(head);
        }
        this.coop.sendDamage(v, amount, attacker, head, weapon);
        return;
      }
    }
    this.applyDamage(v, amount, attacker, head, weapon);
  }

  /** 把已算好倍率的伤害作用到本机结算的角色上（合作模式里也由收到的伤害消息调用） */
  applyDamage(v: Combatant, amount: number, attacker: Combatant | null, head: boolean, weapon: string): void {
    if (!v.alive || this.phase === 'buy' || this.phase === 'over') return;
    const self = attacker === v;
    // 触屏模式：机器人对玩家的伤害按统一的难度倍率降低
    if (attacker && !self && !attacker.human && v.isPlayer && this.input.touchMode) amount *= TOUCH_DIFFICULTY;
    const absorbed = Math.min(v.armor, amount * 0.66);
    v.armor -= absorbed;
    v.hp -= amount - absorbed;
    v.hurtT = 0.3;
    if (v.isPlayer) {
      audio.hurt();
      if (attacker && !self) this.ui.damageFrom(Math.atan2(attacker.body.x - v.body.x, attacker.body.z - v.body.z));
    }
    if (attacker?.isPlayer && !self) {
      this.ui.hitMarker(head, v.hp <= 0);
      audio.hit(head);
    }
    if (!self) v.brain?.onHurt(attacker);
    if (v.hp <= 0) this.kill(v, attacker, head, weapon);
  }

  kill(v: Combatant, attacker: Combatant | null, head: boolean, weapon: string): void {
    if (!v.alive) return;
    // 合作：别的设备上的人由他自己的设备判定阵亡（例如熵核爆炸）
    if (this.coop && !this.netIn && v.remote) {
      this.coop.sendDamage(v, 9999, attacker, head, weapon);
      return;
    }
    v.hp = 0;
    v.alive = false;
    v.deaths++;
    if (attacker && attacker !== v) {
      attacker.kills++;
      attacker.roundKills++;
      attacker.credits = Math.min(RULES.maxCredits, attacker.credits + RULES.killBonus);
      attacker.ult = Math.min(attacker.agent.ultCost, attacker.ult + 1);
      if (attacker.isPlayer) {
        save.stats.kills++;
        if (attacker.team !== v.team) this.killConfirm(attacker, v, head);
      }
    }
    this.ui.killFeed(attacker, v, head, weapon);
    if (v.hasSpike) this.dropSpike(v);
    // 阵亡掉落主武器（可被玩家拾取；合作模式第一版不掉落）
    if (v.slots[0] && this.phase !== 'end' && !this.coop) {
      const w = v.slots[0];
      v.slots[0] = null;
      this.spawnDrop(w, v, 0.3);
    }
    if (this.spike.defuser === v) {
      this.spike.defuser = null;
      this.spike.defuseT = this.spike.defuseT >= RULES.botDefuseHalf ? RULES.botDefuseHalf : 0;
    }
    for (const c of this.combatants) if (c !== v && c.team === v.team && c.alive) c.brain?.onMateDown(v);
    if (this.sideOf(v.team) === 'attack') this.plans[v.team].lostT = this.time;
    if (v.isPlayer) this.onPlayerDeath();
    // 合作：本机结算的角色阵亡，告诉大家（带上是否在答复活题）
    if (this.coop && !this.netIn && !v.remote) this.coop.sendKill(v, attacker, head, weapon, v.isPlayer && this.focus?.kind === 'revive');
  }

  /** 本人击杀的动效和声效：击杀图标（连杀 / 爆头 / 团灭）、击杀音、倒地处飘散数字碎片 */
  private killConfirm(attacker: Combatant, v: Combatant, head: boolean): void {
    const enemies = this.combatants.filter((c) => c.team !== attacker.team);
    const ace = enemies.length >= 2 && attacker.roundKills >= enemies.length && enemies.every((c) => !c.alive);
    try {
      audio.killConfirm(attacker.roundKills, head, ace);
      this.ui.killPop?.({ streak: attacker.roundKills, head, ace, bonus: RULES.killBonus, total: enemies.length });
      this.fx.digitBurst(new THREE.Vector3(v.body.x, Math.max(0.6, v.eyeY() - 0.55), v.body.z), head ? 0xffc44d : 0x5fe8ff, head ? 22 : 18, this.stage.camera.getWorldPosition(new THREE.Vector3()));
    } catch (e) {
      console.error('[对局] 击杀特效出错', e);
    }
  }

  /** a 是否能看到 b（不含视野角判断） */
  canSee(a: Combatant, b: Combatant, maxDist = 75): boolean {
    const ax = a.body.x,
      ay = a.eyeY(),
      az = a.body.z;
    const bx = b.body.x,
      bz = b.body.z;
    const d2 = (ax - bx) ** 2 + (az - bz) ** 2;
    if (d2 > maxDist * maxDist) return false;
    const by = b.eyeY();
    for (const s of this.abilities.smokes)
      if (segmentHitsSphere(ax, ay, az, bx, by - 0.4, bz, s.x, s.y, s.z, s.r)) return false;
    return segmentClear(ax, ay, az, bx, by, bz, this.map.boxes) || segmentClear(ax, ay, az, bx, b.body.y + 0.9, bz, this.map.boxes);
  }

  pointVisible(a: Combatant, x: number, y: number, z: number): boolean {
    return segmentClear(a.body.x, a.eyeY(), a.body.z, x, y, z, this.map.boxes);
  }

  /** 视线方向（玩家含后坐力偏移）写入 _dir */
  private aimDir(c: Combatant): typeof _dir {
    if (c.isPlayer) this.playerCtl.aimDir(_dir);
    else {
      const cp = Math.cos(c.pitch);
      _dir.x = -Math.sin(c.yaw) * cp;
      _dir.y = Math.sin(c.pitch);
      _dir.z = -Math.cos(c.yaw) * cp;
    }
    return _dir;
  }

  // ------------------------------------------------------------ 主循环

  update(realDt: number): void {
    if (this.disposed) return;
    const dt = Math.min(realDt, 0.05);
    // 答错后的锁定期间时间恢复正常流速：答错要付出真实的时间代价
    // 合作：大家共用一个时钟，没有"解题时时间变慢"
    const target = this.focus && this.focus.kind !== 'revive' && this.focus.lockT <= 0 && !this.coop ? RULES.focusTimeScale : 1;
    this.timeScale += (target - this.timeScale) * Math.min(1, dt * 12);
    const g = this.phase === 'over' ? 0 : dt * this.timeScale;
    this.time += g;

    if (this.coop) {
      this.coop.preUpdate();
      if (this.disposed) return;
    }
    this.playerCtl.update(dt, g);
    const active = this.phase === 'live' || this.phase === 'planted' || this.phase === 'end';
    for (const c of this.combatants) {
      // 通用计时
      for (const w of c.slots) {
        if (!w) continue;
        w.cooldown = Math.max(0, w.cooldown - g);
        if (w.sprayResetT > 0) {
          w.sprayResetT -= g;
          if (w.sprayResetT <= 0) {
            w.spray = 0;
            w.botRecoilP = w.botRecoilY = 0;
          }
        }
      }
      const w = c.weapon;
      if (c.slot >= 3) w.cooldown = Math.max(0, w.cooldown - g);
      c.equipT = Math.max(0, c.equipT - g);
      c.landT = Math.max(0, c.landT - g);
      if (w.reloadT > 0) {
        w.reloadT -= g;
        if (w.reloadT <= 0) {
          const need = Math.min(w.def.mag - w.mag, w.reserve);
          w.mag += need;
          w.reserve -= need;
        }
      }
      // 轻机枪转速：持续开火升高，停火后很快降下
      if (w.def.spin > 0) {
        if (w.sprayResetT > 0 && w.spray > 0) w.spinK = Math.min(1, w.spinK + g / w.def.spin);
        else w.spinK = Math.max(0, w.spinK - g * 2);
      }
      // 连发的后续几发
      if (w.burstLeft > 0 && w.cooldown <= 0 && c.alive) {
        const d = this.aimDir(c);
        this.burstShot(c, d.x, d.y, d.z);
      }
      // 投掷后的延迟切枪
      const ps = this.pendingSwitchT.get(c);
      if (ps !== undefined) {
        const left = ps - g;
        if (left <= 0) {
          const to = this.pendingSwitch.get(c)!;
          this.pendingSwitch.delete(c);
          this.pendingSwitchT.delete(c);
          if (c.alive && c.slot === SLOT_NADE) this.equipSlot(c, to);
        } else this.pendingSwitchT.set(c, left);
      }
      c.flashT = Math.max(0, c.flashT - g);
      c.slowT = Math.max(0, c.slowT - g);
      c.ampT = Math.max(0, c.ampT - g);
      c.spottedT = Math.max(0, c.spottedT - g);
      c.hurtT = Math.max(0, c.hurtT - g);
      if (c.healLeft > 0 && c.alive) {
        const h = Math.min(c.healLeft, 15 * g);
        c.healLeft -= h;
        c.hp = Math.min(100, c.hp + h);
      }
      if (c.brain && c.alive && active) c.brain.update(g);
      else if (c.brain && c.alive) c.speed = 0;
      // 脚步声：只有奔跑才有（静步 / 蹲行无声）
      const stepSpeed = RUN_SPEED * c.weapon.def.moveMul * STEP_FRAC;
      if (c.alive && c.body.onGround && c.speed > stepSpeed && !c.walking && c.crouch < 0.5) {
        c.stepT -= g * c.speed;
        if (c.stepT <= 0) {
          c.stepT = 2.6;
          if (c.isPlayer) audio.step();
          else audio.step(c.body.x, c.body.z);
        }
      }
      // 模型
      const hide = c.isPlayer && c.alive;
      c.model.root.position.set(c.body.x, c.body.y, c.body.z);
      c.model.root.rotation.y = c.yaw;
      // 移动方向相对朝向的角度（+ = 向左；朝向 yaw 时前方为 (−sin yaw, −cos yaw)）
      const moveAng = c.speed > 0.3 ? Math.atan2(-c.body.vx, -c.body.vz) - c.yaw : 0;
      c.model.update(g, c.speed, c.pitch, c.crouch, c.alive, moveAng);
      if (hide) c.model.root.visible = false;
    }
    this.abilities.update(g);
    this.updateSpike(g);
    this.updateDrops(g);
    this.updateFocus(dt);
    this.updateSpotting(g);
    this.fx.update(g);

    if (this.follower) {
      // 合作的非房主：回合结束 / 开局 / 终局都听房主的，这里只让倒计时走（快照会校正）
      if (this.phase === 'live') this.phaseT -= g;
    } else if (this.phase === 'live') {
      this.phaseT -= g;
      if (!this.coop) this.spikeHandoff(g);
      const att = this.aliveCount(this.teamOfSide('attack'));
      const def = this.aliveCount(this.teamOfSide('defend'));
      const attAlive = att > 0 || this.revivePending(this.teamOfSide('attack'));
      const defAlive = def > 0 || this.revivePending(this.teamOfSide('defend'));
      if (!attAlive) this.endRound('defend', '进攻方全员阵亡');
      else if (!defAlive) this.endRound('attack', '防守方全员阵亡');
      else if (this.phaseT <= 0) this.endRound('defend', '时间耗尽，熵核未能安装');
    } else if (this.phase === 'planted') {
      const def = this.aliveCount(this.teamOfSide('defend'));
      const pend = this.revivePending(this.teamOfSide('defend'));
      if (def === 0 && !pend) this.endRound('attack', '防守方全员阵亡');
    } else if (this.phase === 'end') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (Math.max(this.score[0], this.score[1]) >= this.opt.roundsToWin) this.finish();
        else this.startRound();
      }
    }
    // 阵亡时画面去色
    const des = this.stage.grade.uniforms.uDesat;
    des.value += ((this.player.alive ? 0 : 0.75) - des.value) * Math.min(1, dt * 5);
    if (this.coop && !this.disposed) this.coop.postUpdate(dt);
  }

  /** 玩家带着熵核在出生区停留 30 秒：交给最近的机器人队友（避免整队等一个挂机的人） */
  private handoffT = 0;
  private spikeHandoff(g: number): void {
    const p = this.player;
    if (!p.hasSpike || !p.alive || this.focus) {
      this.handoffT = 0;
      return;
    }
    const r = this.map.attackSpawn;
    const inSpawn = p.body.x > r.x0 - 4 && p.body.x < r.x1 + 4 && p.body.z > r.z0 - 4 && p.body.z < r.z1 + 4;
    this.handoffT = inSpawn ? this.handoffT + g : 0;
    if (this.handoffT < 30) return;
    let best: Combatant | null = null;
    let bd = Infinity;
    for (const c of this.combatants) {
      if (c.isPlayer || !c.alive || c.team !== p.team) continue;
      const d = Math.hypot(c.body.x - p.body.x, c.body.z - p.body.z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    this.handoffT = 0;
    if (!best) return;
    p.hasSpike = false;
    if (p.slot === SLOT_SPIKE) this.equipSlot(p, p.slots[0] ? SLOT_PRIMARY : SLOT_SIDEARM);
    best.hasSpike = true;
    this.ui.toast(`你在出生区停留太久，${best.name} 接过了熵核`);
  }

  private updateSpotting(g: number): void {
    this.spotT -= g;
    if (this.spotT > 0) return;
    this.spotT = 0.2;
    for (const e of this.combatants) {
      if (e.team !== 1 || !e.alive) continue;
      for (const a of this.combatants) {
        if (a.team !== 0 || !a.alive || a.flashT > 0) continue;
        const dx = e.body.x - a.body.x,
          dz = e.body.z - a.body.z;
        const d = Math.hypot(dx, dz) || 1;
        const dot = (dx * -Math.sin(a.yaw) + dz * -Math.cos(a.yaw)) / d;
        if (dot < 0.45 && d > 5) continue;
        if (this.canSee(a, e)) {
          e.spottedT = 1.6;
          break;
        }
      }
    }
  }

  /** 供机器人查询：最近的集合点 */
  spikePos(): Vec2 {
    return { x: this.spike.x, z: this.spike.z };
  }

  spikeCarrier(): Combatant | null {
    return this.combatants.find((c) => c.hasSpike && c.alive) ?? null;
  }

  /** 投掷物列表（HUD / 购买菜单用） */
  static readonly NADES = NADE_ORDER;
}
