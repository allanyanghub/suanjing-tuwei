/**
 * 合作模式 / 联机对战的对局同步（2–4 个家人，家里局域网）。
 *
 * 分工（谁说了算）：
 * - 房主：全部电脑（BotBrain、买装备、开枪、受伤）、回合流程（开局 / 开战 / 结束 / 终局、比分）、
 *   熵核（携带者、掉落、安装 / 拆除的执行、引爆）、胜负判定；
 * - 每个人的设备：自己的移动 / 瞄准、自己开枪的命中判定（打在本机插值出来的木偶上）、
 *   自己的购买 / 信用点、自己答的题（按自己的年级出题）、自己受到的伤害与阵亡（含复活题）。
 *
 * 约定：
 * - 消息全部发给 'all'（同一发送者按顺序到达），每 50 ms 打包成一个数组发送；
 *   只给某个人的消息（伤害）在消息里带目标 seat，其他人忽略。
 * - 带回合号 r 的消息只在回合号相同时生效（防止上一回合的旧消息影响新回合）。
 * - 木偶的位置按接收时间放进插值缓冲，渲染时取 100 ms 之前的状态（局域网足够平滑）。
 * - Match 里的钩子都用 `this.coop` 判断；单机时 coop 为 null，行为与原来完全相同。
 *
 * 联机对战（start.mode === 'versus'）：
 * - 家人分成蓝队 / 红队（CoopMember.team，全局编号），各队人数不够时由房主的电脑补满；
 * - 本机视角：Match 里的 team 0 永远是「我方」。本机队伍 = 全局队伍 XOR 自己的全局队伍（flip），
 *   所以蓝队设备与房主的编号相同，红队设备两队对调；角色 id（名单顺序）各设备一致；
 * - 线上一律用全局 / 中立的编号：角色 id、全局比分（蓝, 红）、绝对的攻 / 守方；收发时用 toLocal 换算；
 * - 攻防：蓝队上半场进攻（与合作模式里的家人相同），交换攻防后红队进攻；
 * - 人打人：开枪的人的设备判定命中，伤害发给受害者的设备结算（与打电脑相同），阵亡广播给所有人。
 *
 * 简化（第一版）：
 * - 阵亡掉落武器、丢枪 / 捡枪在合作模式里关闭（熵核照常可以丢、捡）；
 * - 带着熵核在出生区挂机 30 秒自动转交的规则只在单机生效；
 * - 远端的开枪只画弹道与声音（不画命中火花）；屏障在各设备上按施放者的位置各自生成，
 *   个别情况下（施放瞬间有人挡住）可能只在部分设备出现——屏障不影响伤害结算，不会造成比分不一致。
 */
import * as THREE from 'three';
import { WEAPONS, isPrimary, type NadeId } from '../data/defs.ts';
import { audio } from '../core/audio.ts';
import { rayBoxes } from '../world/physics.ts';
import type { SiteId } from '../world/map.ts';
import { TEAM_NAMES, type CoopLink, type CoopMember, type CoopStart, type CoopTeam } from '../net/coop-link.ts';
import type { Grade } from '../math/types.ts';
import { BotBrain } from './bot.ts';
import { showsRed } from '../render/models.ts';
import { Combatant, SLOT_MELEE, SLOT_NADE, SLOT_PRIMARY, SLOT_SIDEARM, SLOT_SPIKE, newWeapon } from './combatant.ts';
import type { NadeKind } from './abilities.ts';
import type { Match, Phase, Side } from './match.ts';

// ---------------------------------------------------------------- 常量与工具

/** 成员的全局队伍（老服务器不发 team 时按 0） */
const teamOf = (x: CoopMember): CoopTeam => (x.team === 1 ? 1 : 0);

/** 发送间隔（秒）：玩家状态 / 房主快照 20 Hz */
const SEND_DT = 0.05;
/** 插值延迟（毫秒） */
const INTERP_MS = 100;
/** 最多外推（毫秒）：迟迟没有新状态时不再继续往前滑 */
const EXTRAP_MS = 120;

/** 武器 id ↔ 编号（各设备是同一份构建，顺序相同） */
export const WEAPON_IDS: string[] = Object.keys(WEAPONS);
const WIDX = new Map<string, number>(WEAPON_IDS.map((id, i) => [id, i]));
const wIndex = (id: string) => WIDX.get(id) ?? 0;

const PHASES: Phase[] = ['buy', 'live', 'planted', 'end', 'over'];
const SPIKE_STATES = ['carried', 'dropped', 'planted', 'defused', 'exploded'] as const;
const NADE_KINDS: NadeKind[] = ['frag', 'smoke', 'flash'];
const SLOTS = ['q', 'e', 'x'] as const;

/** 可复现的随机数（各设备用同一个种子得到同样的结果） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// 状态标志位
const F_ALIVE = 1;
const F_REVIVE = 2;
const F_GROUND = 4;
const F_WALK = 8;
const F_TOUCH = 16;

/** 合作结算表的一行（MatchResult.coop.members） */
export interface CoopRow {
  name: string;
  grade: number;
  kills: number;
  deaths: number;
  answered: number;
  correct: number;
  isSelf: boolean;
  /** 本机视角的队伍（0 = 我方）；合作模式恒为 0 */
  team: 0 | 1;
  /** 电脑（联机对战的结算表也列出电脑） */
  bot?: boolean;
}

// ---------------------------------------------------------------- 插值缓冲

/** 每个样本：t, x, y, z, vx, vz, yaw, pitch, crouch, speed */
const K = 10;
const N = 12;

class Interp {
  private buf = new Float64Array(K * N);
  private head = 0;
  count = 0;

  clear(): void {
    this.count = 0;
  }

  push(t: number, x: number, y: number, z: number, vx: number, vz: number, yaw: number, pitch: number, crouch: number, speed: number): void {
    // 瞬移（出生 / 复活）：清空缓冲，直接跳过去
    if (this.count > 0) {
      const o = this.idx(this.count - 1);
      if (Math.hypot(this.buf[o + 1] - x, this.buf[o + 3] - z) > 6) this.count = 0;
    }
    let i: number;
    if (this.count < N) i = this.idx(this.count++);
    else {
      i = this.head * K;
      this.head = (this.head + 1) % N;
    }
    const b = this.buf;
    b[i] = t;
    b[i + 1] = x;
    b[i + 2] = y;
    b[i + 3] = z;
    b[i + 4] = vx;
    b[i + 5] = vz;
    b[i + 6] = yaw;
    b[i + 7] = pitch;
    b[i + 8] = crouch;
    b[i + 9] = speed;
  }

  private idx(k: number): number {
    return ((this.head + k) % N) * K;
  }

  /** 把渲染时刻 rt 的状态写到角色上 */
  apply(rt: number, c: Combatant): void {
    if (this.count === 0) return;
    const b = this.buf;
    let lo = this.idx(0);
    if (rt <= b[lo] || this.count === 1) {
      this.write(c, lo, lo, 0, 0);
      return;
    }
    for (let k = 1; k < this.count; k++) {
      const hi = this.idx(k);
      if (rt <= b[hi]) {
        const span = b[hi] - b[lo];
        this.write(c, lo, hi, span > 0 ? (rt - b[lo]) / span : 1, 0);
        return;
      }
      lo = hi;
    }
    // 比最新样本还新：按速度小幅外推
    this.write(c, lo, lo, 0, Math.min(rt - b[lo], EXTRAP_MS) / 1000);
  }

  private write(c: Combatant, a: number, b: number, k: number, ext: number): void {
    const s = this.buf;
    const body = c.body;
    body.vx = s[a + 4] + (s[b + 4] - s[a + 4]) * k;
    body.vz = s[a + 5] + (s[b + 5] - s[a + 5]) * k;
    body.x = s[a + 1] + (s[b + 1] - s[a + 1]) * k + body.vx * ext;
    body.y = s[a + 2] + (s[b + 2] - s[a + 2]) * k;
    body.z = s[a + 3] + (s[b + 3] - s[a + 3]) * k + body.vz * ext;
    c.yaw = wrapAngle(s[a + 6] + wrapAngle(s[b + 6] - s[a + 6]) * k);
    c.pitch = s[a + 7] + (s[b + 7] - s[a + 7]) * k;
    c.crouch = s[a + 8] + (s[b + 8] - s[a + 8]) * k;
    c.speed = s[a + 9] + (s[b + 9] - s[a + 9]) * k;
  }
}

// ---------------------------------------------------------------- 同步

type Msg = unknown[];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

export class CoopSync {
  readonly link: CoopLink;
  readonly start: CoopStart;
  readonly isHost: boolean;
  readonly selfSeat: number;
  readonly hostSeat: number;
  readonly self: CoopMember;
  /** 联机对战（家人分两队互相打） */
  readonly versus: boolean;
  /** 本机所在的全局队伍（合作模式恒为 0） */
  readonly selfTeam: CoopTeam;
  /** 开局时每个 seat 对应的角色（离开后被电脑接管也不变，结算表用） */
  readonly seatCombatant = new Map<number, Combatant>();
  /** 房间已关闭（不再收发） */
  closed = false;

  private m: Match;
  private inbox: { from: number; d: unknown }[] = [];
  private outbox: Msg[] = [];
  private urgent = false;
  private sendAcc = 0;
  private interp = new Map<Combatant, Interp>();
  /** 与 interp 相同的内容，按数组存放（每帧遍历不产生临时对象） */
  private interpC: Combatant[] = [];
  private interpI: Interp[] = [];
  private offs: (() => void)[] = [];
  /** 远端玩家最近一次报告的答题数 */
  private remoteStats = new Map<number, { answered: number; correct: number }>();
  /** 房主：本回合已点「出击」的 seat */
  private ready = new Set<number>();
  /** 本机本回合是否已点「出击」 */
  selfReady = false;
  /** 准备阶段的人数（房主广播） */
  readyCount = 0;
  readyTotal = 0;
  /** 非房主：下一次开局时由房主指定的熵核携带者 */
  private pendingCarrier = -1;

  constructor(m: Match, link: CoopLink, start: CoopStart) {
    this.m = m;
    this.link = link;
    this.start = start;
    this.isHost = link.isHost;
    this.selfSeat = link.selfSeat;
    const host = start.members.find((x) => x.isHost) ?? start.members[0];
    this.hostSeat = host ? host.seat : 0;
    this.self = start.members.find((x) => x.seat === link.selfSeat) ?? { seat: link.selfSeat, playerId: 0, name: '你', grade: m.level.grade, agentId: '', isHost: link.isHost, team: 0 };
    this.versus = start.mode === 'versus';
    this.selfTeam = this.versus ? teamOf(this.self) : 0;
    this.readyTotal = start.members.length;
    this.offs.push(
      link.onMessage((from, d) => {
        if (!this.closed) this.inbox.push({ from, d });
      }),
      link.onMemberLeft((seat) => {
        if (!this.closed) this.inbox.push({ from: -1, d: ['left', seat] });
      }),
      link.onClosed((reason) => {
        if (this.closed) return;
        this.closed = true;
        try {
          m.ui.coopClosed?.(reason);
        } catch (e) {
          console.error('[合作] coopClosed 出错', e);
        }
      }),
    );
  }

  /** 全局队伍 ↔ 本机队伍（XOR，两个方向相同） */
  toLocal(t: number): 0 | 1 {
    return ((t ^ this.selfTeam) & 1) as 0 | 1;
  }

  /** 本机视角的队伍名（联机对战：蓝队 / 红队；合作模式没有） */
  teamName(local: 0 | 1): string {
    return this.versus ? TEAM_NAMES[this.toLocal(local) as CoopTeam] : '';
  }

  /** 全局比分（蓝, 红）→ 写入本机比分（我方, 对方） */
  private setScore(blue: unknown, red: unknown): void {
    const s = this.m.score;
    const b = num(blue, s[this.toLocal(0)]);
    const r = num(red, s[this.toLocal(1)]);
    s[this.toLocal(0)] = b;
    s[this.toLocal(1)] = r;
  }

  /** 本机比分 → 全局（蓝, 红） */
  private globalScore(): [number, number] {
    const s = this.m.score;
    return [s[this.toLocal(0)], s[this.toLocal(1)]];
  }

  /** 本机孩子的年级（出题用） */
  get grade(): Grade {
    return this.self.grade;
  }

  dispose(): void {
    this.flush();
    for (const f of this.offs) f();
    this.offs = [];
    this.closed = true;
  }

  // ------------------------------------------------------------ 名单（Match 构造时调用）

  /**
   * 按开局信息建出全部角色（各设备的顺序 / id 相同）：
   * - 合作：我方 = 家人（按 seat）+ 电脑队友补满；敌方 = 电脑；
   * - 对战：蓝队家人 + 蓝队电脑，再红队家人 + 红队电脑（team 按本机视角换算）。
   * make 的 gTeam 是全局队伍（起名用，各设备一致）。
   */
  buildRoster(make: (id: number, name: string, team: 0 | 1, isPlayer: boolean, agentId: string | null, slot: number, gTeam: 0 | 1) => Combatant): Combatant[] {
    const m = this.m;
    const members = [...this.start.members].sort((a, b) => a.seat - b.seat);
    const list: Combatant[] = [];
    let id = 0;
    if (this.versus) {
      const of = (g: CoopTeam) => members.filter((x) => teamOf(x) === g);
      const size = Math.max(m.level.teamSize, of(0).length, of(1).length);
      for (const g of [0, 1] as const) {
        const humans = of(g);
        const team = this.toLocal(g);
        for (const mem of humans) {
          const c = make(id++, mem.name, team, mem.seat === this.selfSeat, mem.agentId, -1, g);
          c.human = true;
          c.seat = mem.seat;
          c.remote = mem.seat !== this.selfSeat;
          this.seatCombatant.set(mem.seat, c);
          list.push(c);
        }
        for (let i = 0; i < size - humans.length; i++) list.push(this.botOf(make(id++, '', team, false, null, i, g)));
      }
      return list;
    }
    const size = Math.max(m.level.teamSize, members.length);
    for (const mem of members) {
      const c = make(id++, mem.name, 0, mem.seat === this.selfSeat, mem.agentId, -1, 0);
      c.human = true;
      c.seat = mem.seat;
      c.remote = mem.seat !== this.selfSeat;
      this.seatCombatant.set(mem.seat, c);
      list.push(c);
    }
    for (let i = 0; i < size - members.length; i++) list.push(this.botOf(make(id++, '', 0, false, null, i, 0)));
    for (let i = 0; i < size; i++) list.push(this.botOf(make(id++, '', 1, false, null, i, 1)));
    return list;
  }

  private botOf(c: Combatant): Combatant {
    c.seat = this.hostSeat;
    c.remote = !this.isHost;
    return c;
  }

  /** 这个角色是否由别的设备的人操控（不是电脑） */
  private humanAt(seat: number): Combatant | null {
    for (const c of this.m.combatants) if (c.human && c.seat === seat) return c;
    return null;
  }

  private byId(id: unknown): Combatant | null {
    return typeof id === 'number' ? (this.m.combatants[id] ?? null) : null;
  }

  // ------------------------------------------------------------ 每帧

  /** Match.update 开头：处理收到的消息，木偶插值 */
  preUpdate(): void {
    if (this.inbox.length) {
      const q = this.inbox;
      this.inbox = [];
      for (const e of q) {
        try {
          if (e.from < 0) this.onLeft(e.d as Msg);
          else if (Array.isArray(e.d)) for (const msg of e.d) if (Array.isArray(msg)) this.handle(e.from, msg);
        } catch (err) {
          console.error('[合作] 处理消息出错', err, e.d);
        } finally {
          this.m.netIn = false;
        }
        if (this.m.disposed) return;
      }
    }
    const rt = performance.now() - INTERP_MS;
    for (let i = 0; i < this.interpC.length; i++) {
      const c = this.interpC[i];
      if (c.remote && c.alive) this.interpI[i].apply(rt, c);
    }
  }

  /** Match.update 结尾：按节奏发送自己的状态（房主再加快照） */
  postUpdate(dt: number): void {
    if (this.closed) return;
    this.sendAcc += dt;
    if (this.sendAcc >= SEND_DT) {
      this.sendAcc = Math.min(this.sendAcc - SEND_DT, SEND_DT);
      this.pushState();
      if (this.isHost) this.pushSnapshot();
      this.flush();
    } else if (this.urgent) this.flush();
  }

  private emit(msg: Msg, urgent = false): void {
    if (this.closed) return;
    this.outbox.push(msg);
    if (urgent) this.urgent = true;
  }

  flush(): void {
    this.urgent = false;
    if (!this.outbox.length || this.closed) return;
    const batch = this.outbox;
    this.outbox = [];
    try {
      this.link.send(batch, 'all');
    } catch (e) {
      console.error('[合作] 发送失败', e);
    }
  }

  private pushState(): void {
    const m = this.m;
    const p = m.player;
    const b = p.body;
    const flags =
      (p.alive ? F_ALIVE : 0) |
      (m.focus?.kind === 'revive' && m.focus.lockT <= 0 ? F_REVIVE : 0) |
      (b.onGround ? F_GROUND : 0) |
      (p.walking ? F_WALK : 0) |
      (m.input.touchMode ? F_TOUCH : 0);
    this.outbox.push([
      'p',
      m.round,
      r2(b.x),
      r2(b.y),
      r2(b.z),
      r2(b.vx),
      r2(b.vz),
      r3(p.yaw),
      r3(p.pitch),
      r2(p.crouch),
      r2(p.speed),
      wIndex(p.weapon.def.id),
      flags,
      Math.round(Math.max(0, p.hp)),
      Math.round(p.armor),
      m.stats.answered,
      m.stats.correct,
    ]);
  }

  private pushSnapshot(): void {
    const m = this.m;
    const s = m.spike;
    const carrier = m.spikeCarrier();
    const bots: number[] = [];
    for (const c of m.combatants) {
      if (c.remote || c.isPlayer) continue;
      const b = c.body;
      bots.push(
        c.id,
        r2(b.x),
        r2(b.y),
        r2(b.z),
        r2(b.vx),
        r2(b.vz),
        r3(c.yaw),
        r3(c.pitch),
        r2(c.crouch),
        r2(c.speed),
        wIndex(c.weapon.def.id),
        (c.alive ? F_ALIVE : 0) | (b.onGround ? F_GROUND : 0) | (c.walking ? F_WALK : 0),
        Math.round(Math.max(0, c.hp)),
        Math.round(c.armor),
      );
    }
    this.outbox.push([
      's',
      m.round,
      PHASES.indexOf(m.phase),
      r2(m.phaseT),
      ...this.globalScore(),
      SPIKE_STATES.indexOf(s.state),
      r2(s.x),
      r2(s.z),
      carrier ? carrier.id : -1,
      r2(s.timer),
      r2(s.defuseT),
      s.site === 'B' ? 1 : 0,
      bots,
    ]);
  }

  // ------------------------------------------------------------ 收消息

  private handle(from: number, msg: Msg): void {
    const m = this.m;
    const t = msg[0];
    const fromHost = from === this.hostSeat;
    switch (t) {
      case 'p':
        return this.onState(from, msg);
      case 's':
        if (fromHost && !this.isHost) this.onSnapshot(msg);
        return;
      case 'f': {
        const c = this.byId(msg[1]);
        if (c && c.remote) this.visualShot(c, num(msg[2]), num(msg[3]), num(msg[4]), num(msg[5]));
        return;
      }
      case 'n':
        return this.onNade(msg);
      case 'a':
        return this.onCast(msg);
      case 'd': {
        // 只发给受害者所在的设备
        if (msg[1] !== this.selfSeat || msg[2] !== m.round) return;
        const v = this.byId(msg[3]);
        if (!v || v.remote) return;
        m.applyDamage(v, num(msg[5]), this.byId(msg[4]), !!msg[6], String(msg[7] ?? ''));
        return;
      }
      case 'k': {
        if (msg[1] !== m.round) return;
        const v = this.byId(msg[2]);
        if (!v || !v.remote) return;
        v.netRevive = !!msg[6];
        m.netIn = true;
        m.kill(v, this.byId(msg[3]), !!msg[4], String(msg[5] ?? ''));
        m.netIn = false;
        return;
      }
      case 'rdy':
        if (this.isHost && msg[1] === m.round && m.phase === 'buy') {
          this.ready.add(from);
          this.checkReady();
        }
        return;
      case 'w':
        if (fromHost && msg[1] === m.round) {
          this.readyCount = num(msg[2]);
          this.readyTotal = num(msg[3]);
        }
        return;
      case 'tk': {
        const c = this.byId(msg[1]);
        if (fromHost && c && !this.isHost) this.toBot(c, false);
        return;
      }
      case 'left':
        return;
    }
    // ---- 以下只接受房主发来的流程事件（非房主执行）
    if (fromHost && !this.isHost) {
      m.netIn = true;
      switch (t) {
        case 'rd': {
          const r = num(msg[1]);
          if (r <= m.round) break;
          m.round = r - 1;
          this.pendingCarrier = num(msg[2], -1);
          m.startRound();
          break;
        }
        case 'lv':
          if (msg[1] === m.round && m.phase === 'buy') {
            // msg[2] / msg[3]：全局 0 / 1 队的主攻点
            m.plans[this.toLocal(0)].site = msg[2] === 'B' ? 'B' : 'A';
            if (msg[3] !== undefined) m.plans[this.toLocal(1)].site = msg[3] === 'B' ? 'B' : 'A';
            m.beginLive();
          }
          break;
        case 'e':
          if (msg[1] === m.round) {
            m.endRound(msg[2] === 1 ? 'defend' : 'attack', String(msg[3] ?? ''));
            this.setScore(msg[4], msg[5]);
          }
          break;
        case 'pl': {
          const by = this.byId(msg[2]);
          if (msg[1] === m.round && by) m.plantSpike(by, { x: num(msg[3]), z: num(msg[4]), site: msg[5] === 'B' ? 'B' : 'A' });
          break;
        }
        case 'df': {
          const by = this.byId(msg[2]);
          if (msg[1] === m.round && by) m.defuseSpike(by);
          break;
        }
        case 'ex':
          if (msg[1] === m.round) m.explodeSpike();
          break;
        case 'fin':
          this.setScore(msg[1], msg[2]);
          m.finish(this.rowsFrom(msg[3]));
          break;
      }
      m.netIn = false;
      return;
    }
    // ---- 只有房主处理的请求（来自别的家人）
    if (!this.isHost || msg[1] !== m.round) return;
    const c = this.humanAt(from);
    if (!c || !c.remote) return;
    switch (t) {
      case 'rp':
        // 安装：答题在家人的设备上完成，房主执行（以对方报告的位置为准）
        if (m.phase === 'live' && c.hasSpike && c.alive) {
          c.body.x = num(msg[2], c.body.x);
          c.body.z = num(msg[3], c.body.z);
          c.yaw = num(msg[4], c.yaw);
          m.plantSpike(c);
        }
        break;
      case 'rf':
        if (m.spike.state === 'planted' && c.alive && Math.hypot(c.body.x - m.spike.x, c.body.z - m.spike.z) < 3.5) m.defuseSpike(c);
        break;
      case 'rs':
        if (m.phase === 'live' && c.hasSpike && c.alive) {
          c.body.x = num(msg[2], c.body.x);
          c.body.z = num(msg[3], c.body.z);
          c.yaw = num(msg[4], c.yaw);
          c.pitch = 0;
          c.slot = SLOT_SPIKE;
          m.dropCurrent(c);
        }
        break;
    }
  }

  /** 别的家人的状态 */
  private onState(from: number, msg: Msg): void {
    const m = this.m;
    const c = this.humanAt(from);
    if (!c || !c.remote) return;
    this.remoteStats.set(from, { answered: num(msg[15]), correct: num(msg[16]) });
    if (msg[1] !== m.round) return;
    const flags = num(msg[12]);
    this.interpOf(c).push(performance.now(), num(msg[2]), num(msg[3]), num(msg[4]), num(msg[5]), num(msg[6]), num(msg[7]), num(msg[8]), num(msg[9]), num(msg[10]));
    c.body.onGround = (flags & F_GROUND) !== 0;
    c.walking = (flags & F_WALK) !== 0;
    c.touch = (flags & F_TOUCH) !== 0;
    c.netRevive = (flags & F_REVIVE) !== 0;
    this.applyLife(c, (flags & F_ALIVE) !== 0, num(msg[13]), num(msg[14]));
    if (c.alive) this.setWeapon(c, num(msg[11]));
  }

  /** 房主快照（非房主） */
  private onSnapshot(msg: Msg): void {
    const m = this.m;
    if (msg[1] !== m.round) return;
    const ph = PHASES[num(msg[2])];
    if ((ph === 'live' || ph === 'planted') && ph === m.phase) m.phaseT = num(msg[3], m.phaseT);
    this.setScore(msg[4], msg[5]);
    // 熵核：状态、位置、携带者以房主为准
    const s = m.spike;
    const st = SPIKE_STATES[num(msg[6])] ?? s.state;
    // 安装 / 拆除 / 引爆以事件为准（快照只纠正携带 / 掉落）
    if ((st === 'carried' || st === 'dropped') && (s.state === 'carried' || s.state === 'dropped')) s.state = st;
    if (st === 'dropped' || st === 'planted') {
      s.x = num(msg[7], s.x);
      s.z = num(msg[8], s.z);
    }
    if (st === 'planted' && s.state === 'planted') {
      s.timer = num(msg[10], s.timer);
      s.defuseT = num(msg[11], s.defuseT);
    }
    const carrierId = num(msg[9], -1);
    for (const c of m.combatants) {
      const has = c.id === carrierId;
      if (c.hasSpike === has) continue;
      if (c.isPlayer) {
        c.hasSpike = has;
        if (has && m.phase === 'live') {
          m.ui.toast('已拾取熵核');
          audio.pickup();
        } else if (!has && c.slot === SLOT_SPIKE) m.equipSlot(c, c.slots[0] ? SLOT_PRIMARY : SLOT_SIDEARM, true);
      } else c.hasSpike = has;
    }
    // 电脑（以及被电脑接管的人）
    const bots = msg[13];
    if (!Array.isArray(bots)) return;
    const now = performance.now();
    for (let i = 0; i + 13 < bots.length; i += 14) {
      const c = this.byId(bots[i]);
      if (!c || c.isPlayer) continue;
      if (c.human) this.toBot(c, false);
      this.interpOf(c).push(now, num(bots[i + 1]), num(bots[i + 2]), num(bots[i + 3]), num(bots[i + 4]), num(bots[i + 5]), num(bots[i + 6]), num(bots[i + 7]), num(bots[i + 8]), num(bots[i + 9]));
      const flags = num(bots[i + 11]);
      c.body.onGround = (flags & F_GROUND) !== 0;
      c.walking = (flags & F_WALK) !== 0;
      this.applyLife(c, (flags & F_ALIVE) !== 0, num(bots[i + 12]), num(bots[i + 13]));
      if (c.alive) this.setWeapon(c, num(bots[i + 10]));
    }
  }

  private interpOf(c: Combatant): Interp {
    let ip = this.interp.get(c);
    if (!ip) {
      ip = new Interp();
      this.interp.set(c, ip);
      this.interpC.push(c);
      this.interpI.push(ip);
    }
    return ip;
  }

  /** 生死 / 生命值：阵亡的瞬间以 kill 事件为准（击杀信息、熵核掉落），这里只兜底与处理复活 */
  private applyLife(c: Combatant, alive: boolean, hp: number, armor: number): void {
    if (alive && !c.alive) {
      // 复活（演算复活题答对）
      c.alive = true;
      this.interp.get(c)?.clear();
    } else if (!alive && c.alive) {
      c.alive = false;
      c.hp = 0;
    }
    if (c.alive) {
      c.hp = hp;
      c.armor = armor;
    }
  }

  /** 木偶手里的武器（只影响第三人称模型与声音） */
  private setWeapon(c: Combatant, idx: number): void {
    const id = WEAPON_IDS[idx];
    const def = id ? WEAPONS[id] : undefined;
    if (!def || c.weapon.def === def) return;
    if (def.cls === 'spike') {
      if (c.hasSpike) c.slot = SLOT_SPIKE;
    } else if (def.cls === 'melee') c.slot = SLOT_MELEE;
    else if (def.cls === 'throwable') {
      c.nades[id as NadeId] = Math.max(1, c.nades[id as NadeId]);
      c.nadeSel = id as NadeId;
      c.slot = SLOT_NADE;
    } else if (isPrimary(def)) {
      if (c.slots[0]?.def !== def) c.slots[0] = newWeapon(id);
      c.slot = SLOT_PRIMARY;
    } else {
      if (c.slots[1].def !== def) c.slots[1] = newWeapon(id);
      c.slot = SLOT_SIDEARM;
    }
    this.m.syncModel(c);
  }

  /** 新回合（各设备）：清空插值、准备状态 */
  roundReset(): void {
    for (const ip of this.interpI) ip.clear();
    this.ready.clear();
    this.selfReady = false;
    this.readyCount = 0;
    this.readyTotal = this.link.members().length || this.start.members.length;
  }

  // ------------------------------------------------------------ 离开 / 接管

  private onLeft(msg: Msg): void {
    const seat = num(msg[1], -1);
    const c = this.humanAt(seat);
    if (!c) return;
    if (seat === this.selfSeat) return;
    if (this.isHost) {
      this.toBot(c, true);
      this.emit(['tk', c.id], true);
      this.ready.delete(seat);
      if (this.m.phase === 'buy') this.checkReady();
    } else this.toBot(c, false);
    this.m.ui.toast(this.versus ? `${c.name} 离开了，由电脑接手` : `${c.name} 离开了，电脑队友接手`);
  }

  /** 把一个家人的角色交给电脑（房主上真的给它装上 BotBrain，其他设备上继续当木偶） */
  private toBot(c: Combatant, host: boolean): void {
    if (!c.human) return;
    c.human = false;
    c.seat = this.hostSeat;
    c.netRevive = false;
    this.interp.get(c)?.clear();
    if (!host) return;
    const m = this.m;
    c.remote = false;
    c.brain = new BotBrain(c, m);
    c.brain.reset();
    if (m.phase === 'live' || m.phase === 'planted') {
      const mates = m.combatants.filter((o) => o.team === c.team && o.brain);
      const i = Math.max(0, mates.indexOf(c));
      if (m.sideOf(c.team) === 'attack') c.brain.assignAttack(m.plans[c.team].site, i);
      else c.brain.assignDefend(i % 2 === 0 ? 'A' : 'B', false);
      if (m.phase === 'planted') c.brain.onPlanted();
    }
  }

  // ------------------------------------------------------------ 回合流程（Match 调用）

  /** 本回合的熵核携带者：房主指定（优先由家人携带）；各设备用同一个种子得到同样的结果 */
  carrierFor(attackers: Combatant[]): Combatant {
    if (this.pendingCarrier >= 0) {
      const c = this.byId(this.pendingCarrier);
      this.pendingCarrier = -1;
      if (c && attackers.includes(c)) return c;
    }
    const humans = attackers.filter((c) => c.human);
    const pool = humans.length ? humans : attackers;
    const rnd = mulberry32((this.start.seed ^ Math.imul(this.m.round, 0x9e3779b1)) >>> 0);
    return pool[Math.floor(rnd() * pool.length) % pool.length];
  }

  /** 房主：新回合开始（Match.startRound 末尾） */
  roundStarted(carrier: Combatant): void {
    this.roundReset();
    if (this.isHost) {
      this.emit(['rd', this.m.round, carrier.id], true);
      this.sendWait();
    }
  }

  /** 本机点了「出击」 */
  markReady(): void {
    const m = this.m;
    if (m.phase !== 'buy' || !m.gatePassed) return;
    this.selfReady = true;
    if (this.isHost) {
      this.ready.add(this.selfSeat);
      this.checkReady();
    } else this.emit(['rdy', m.round], true);
  }

  private sendWait(): void {
    const seats = this.link.members().map((x) => x.seat);
    let n = 0;
    for (const s of seats) if (this.ready.has(s)) n++;
    this.readyCount = n;
    this.readyTotal = seats.length;
    this.emit(['w', this.m.round, n, seats.length], true);
  }

  /** 房主：在线的人都点了「出击」才开战 */
  private checkReady(): void {
    const m = this.m;
    this.sendWait();
    if (m.phase !== 'buy') return;
    const seats = this.link.members().map((x) => x.seat);
    if (!seats.includes(this.selfSeat)) seats.push(this.selfSeat);
    if (!seats.every((s) => this.ready.has(s))) return;
    m.netIn = true;
    try {
      m.beginLive();
    } finally {
      m.netIn = false;
    }
  }

  /** 「出击」按钮上的等待文字；未点出击时为 null */
  get waitText(): string | null {
    if (!this.selfReady || this.m.phase !== 'buy') return null;
    const total = Math.max(1, this.readyTotal);
    return `${this.versus ? '等待大家' : '等待队友'}（${Math.max(1, this.readyCount)}/${total}）`;
  }

  /** 房主：开战 */
  liveStarted(): void {
    const p = this.m.plans;
    if (this.isHost) this.emit(['lv', this.m.round, p[this.toLocal(0)].site, p[this.toLocal(1)].site], true);
  }

  /** 房主：回合结束 */
  roundEnded(winSide: Side, reason: string): void {
    if (this.isHost) this.emit(['e', this.m.round, winSide === 'defend' ? 1 : 0, reason, ...this.globalScore()], true);
  }

  planted(by: Combatant, x: number, z: number, site: SiteId): void {
    if (this.isHost) this.emit(['pl', this.m.round, by.id, r2(x), r2(z), site], true);
  }

  defused(by: Combatant): void {
    if (this.isHost) this.emit(['df', this.m.round, by.id], true);
  }

  exploded(): void {
    if (this.isHost) this.emit(['ex', this.m.round], true);
  }

  /** 非房主：答对安装题，请房主执行安装 */
  reqPlant(by: Combatant): void {
    this.emit(['rp', this.m.round, r2(by.body.x), r2(by.body.z), r3(by.yaw)], true);
  }

  reqDefuse(): void {
    this.emit(['rf', this.m.round], true);
  }

  reqSpikeDrop(by: Combatant): void {
    this.emit(['rs', this.m.round, r2(by.body.x), r2(by.body.z), r3(by.yaw)], true);
  }

  /** 房主：本机视角 team 队里有别的家人阵亡后还在答复活题 */
  remoteRevivePending(team: 0 | 1): boolean {
    for (const c of this.m.combatants) if (c.team === team && c.human && c.remote && !c.alive && c.netRevive) return true;
    return false;
  }

  // ------------------------------------------------------------ 战斗

  /** 伤害交给受害者所在的设备结算 */
  sendDamage(v: Combatant, amount: number, attacker: Combatant | null, head: boolean, weapon: string): void {
    this.emit(['d', v.seat, this.m.round, v.id, attacker ? attacker.id : -1, r2(amount), head ? 1 : 0, weapon], true);
  }

  /** 本机结算的角色阵亡（rv = 阵亡者正在答复活题） */
  sendKill(v: Combatant, attacker: Combatant | null, head: boolean, weapon: string, rv: boolean): void {
    this.emit(['k', this.m.round, v.id, attacker ? attacker.id : -1, head ? 1 : 0, weapon, rv ? 1 : 0], true);
  }

  /** 开枪 / 挥刀（只用于别的设备上的弹道与声音） */
  sendShot(c: Combatant, dx: number, dy: number, dz: number, weaponId: string): void {
    this.emit(['f', c.id, r3(dx), r3(dy), r3(dz), wIndex(weaponId)]);
  }

  sendNade(c: Combatant, kind: NadeKind, itemId: string, dx: number, dy: number, dz: number, long: boolean, raw: boolean): void {
    const b = c.body;
    this.emit(['n', c.id, NADE_KINDS.indexOf(kind), itemId, r3(b.x), r3(b.y), r3(b.z), r2(c.crouch), r2(b.vx), r2(b.vz), r3(dx), r3(dy), r3(dz), long ? 1 : 0, raw ? 1 : 0], true);
  }

  sendCast(c: Combatant, slot: 'q' | 'e' | 'x'): void {
    const b = c.body;
    this.emit(['a', c.id, SLOTS.indexOf(slot), r3(b.x), r3(b.y), r3(b.z), r3(c.yaw), r3(c.pitch), r2(b.vx), r2(b.vz), r2(c.crouch)], true);
  }

  /** 临时把木偶摆到施放者当时的姿势（投掷 / 施放的起点与方向），执行后还原 */
  private withPose(c: Combatant, msg: Msg, at: number, fn: () => void, yawAt = -1): void {
    const b = c.body;
    const sx = b.x,
      sy = b.y,
      sz = b.z,
      svx = b.vx,
      svz = b.vz,
      sc = c.crouch,
      syaw = c.yaw,
      sp = c.pitch;
    b.x = num(msg[at], b.x);
    b.y = num(msg[at + 1], b.y);
    b.z = num(msg[at + 2], b.z);
    if (yawAt >= 0) {
      c.yaw = num(msg[yawAt], c.yaw);
      c.pitch = num(msg[yawAt + 1], c.pitch);
      b.vx = num(msg[yawAt + 2]);
      b.vz = num(msg[yawAt + 3]);
      c.crouch = num(msg[yawAt + 4]);
    } else {
      c.crouch = num(msg[at + 3]);
      b.vx = num(msg[at + 4]);
      b.vz = num(msg[at + 5]);
    }
    try {
      fn();
    } finally {
      b.x = sx;
      b.y = sy;
      b.z = sz;
      b.vx = svx;
      b.vz = svz;
      c.crouch = sc;
      c.yaw = syaw;
      c.pitch = sp;
    }
  }

  private onNade(msg: Msg): void {
    const c = this.byId(msg[1]);
    const kind = NADE_KINDS[num(msg[2], -1)];
    const item = String(msg[3] ?? '');
    if (!c || !c.remote || !kind || !WEAPONS[item]) return;
    this.withPose(c, msg, 4, () => {
      this.m.abilities.throwNade(c, kind, item, num(msg[10]), num(msg[11]), num(msg[12]), !!msg[13], !!msg[14]);
    });
    audio.nadeThrow(c.body.x, c.body.z);
  }

  private onCast(msg: Msg): void {
    const c = this.byId(msg[1]);
    const slot = SLOTS[num(msg[2], -1)];
    if (!c || !c.remote || !slot) return;
    this.withPose(c, msg, 3, () => this.m.abilities.castNet(c, slot), 6);
  }

  /** 别的设备上的一枪：弹道、枪口火光、声音、弹孔（不判定命中） */
  private visualShot(c: Combatant, dx: number, dy: number, dz: number, wi: number): void {
    const m = this.m;
    const def = WEAPONS[WEAPON_IDS[wi]] ?? c.weapon.def;
    if (def.cls === 'melee') {
      audio.knife(false, c.body.x, c.body.z);
      return;
    }
    if (!c.alive) return;
    const ox = c.body.x,
      oy = c.eyeY(),
      oz = c.body.z;
    const hit = rayBoxes(ox, oy, oz, dx, dy, dz, 220, m.map.boxes);
    let t = hit.t;
    _n.set(hit.nx, hit.ny, hit.nz);
    if (dy < 0 && -oy / dy < t) {
      t = -oy / dy;
      _n.set(0, 1, 0);
    }
    const world = t < 220;
    if (!world) t = 120;
    c.model.muzzle(_a);
    _b.set(ox + dx * t, oy + dy * t, oz + dz * t);
    m.fx.tracer(_a, _b, showsRed(c.team) ? 0xff9a8a : 0xffe2a8, def.cls === 'sniper' ? 0.04 : 0.02);
    if (world) {
      m.fx.decal(_b, _n);
      m.fx.spark(_b, _n, 0xffd9a0, 5, 3, 0.25);
    }
    _n.set(dx, dy, dz);
    m.fx.spark(_a, _n, 0xffc880, 3, 3, 0.08, 0);
    audio.shot(def.id, c.body.x, c.body.z);
  }

  // ------------------------------------------------------------ 终局

  /** 房主：生成结算表并广播；返回本机视角的表 */
  finishTable(): CoopRow[] {
    const m = this.m;
    const raw: unknown[] = [];
    for (const mem of [...this.start.members].sort((a, b) => a.seat - b.seat)) {
      const c = this.seatCombatant.get(mem.seat);
      const st = mem.seat === this.selfSeat ? m.stats : (this.remoteStats.get(mem.seat) ?? { answered: 0, correct: 0 });
      raw.push([mem.seat, mem.name, mem.grade, c?.kills ?? 0, c?.deaths ?? 0, st.answered, st.correct, this.versus ? teamOf(mem) : 0]);
    }
    // 对战：电脑也列出来（seat = -1，按全局队伍）
    if (this.versus) {
      const humans = new Set(this.seatCombatant.values());
      for (const c of m.combatants) if (!humans.has(c)) raw.push([-1, c.name, 0, c.kills, c.deaths, 0, 0, this.toLocal(c.team)]);
    }
    if (this.isHost) {
      this.emit(['fin', ...this.globalScore(), raw], true);
      this.flush();
    }
    return this.rowsFrom(raw);
  }

  private rowsFrom(raw: unknown): CoopRow[] {
    if (!Array.isArray(raw)) return [];
    const rows: CoopRow[] = [];
    for (const r of raw) {
      if (!Array.isArray(r)) continue;
      const seat = num(r[0], -1);
      // 自己的答题数以本机为准
      const me = seat === this.selfSeat;
      rows.push({
        name: String(r[1] ?? ''),
        grade: num(r[2]),
        kills: num(r[3]),
        deaths: num(r[4]),
        answered: me ? this.m.stats.answered : num(r[5]),
        correct: me ? this.m.stats.correct : num(r[6]),
        isSelf: me,
        team: this.toLocal(num(r[7])),
        bot: seat < 0,
      });
    }
    return rows;
  }
}
