/**
 * 合作模式（3–4 个家人组队打电脑）的共享约定。
 *
 * 三部分代码之间只通过这里的类型对接：
 * - 服务端 server/src/coop.ts：WebSocket 房间与消息转发（协议见 server/API.md §18），不懂游戏逻辑；
 * - 客户端联网层 src/net/coop.ts + 大厅界面 src/ui/online/coop-lobby.ts：连服务器、建房 / 进房，
 *   开局时构造一个 CoopLink 交给 App.startCoop()；
 * - 对局同步 src/game/coop-sync.ts（以及 match.ts / player.ts / bot.ts 里的少量改动）：
 *   拿到 CoopLink 后在各设备之间同步对局。
 *
 * 架构：房主的游戏算电脑对手、回合流程、比分、熵核；每个人的设备算自己的移动、开枪命中、答题，
 * 再把结果发给大家。服务器只按 seat 转发消息。
 */
import type { Grade } from '../math/types.ts';
import type { MatchOptions } from '../game/match.ts';

/**
 * 房间的玩法：
 * - 'coop'：合作模式，房间里所有人同一队，一起打电脑；
 * - 'versus'：联机对战，家里人分成蓝队 / 红队互相打，每队人数不够时由电脑补满到关卡的每队人数。
 * 建房时选定，房间存在期间不变。
 */
export type CoopMode = 'coop' | 'versus';

/**
 * 队伍（全局编号，各设备一致）：0 = 蓝队（建房的人默认在这一队），1 = 红队。
 * 合作模式里所有人都是 0。注意这和对局里的 Combatant.team（0 = 本机玩家所在的队）不是一回事，
 * 对局同步负责在两者之间换算。
 */
export type CoopTeam = 0 | 1;

/** 房间里的一个人。seat 在房间内唯一、加入后不变（0 = 建房的人） */
export interface CoopMember {
  seat: number;
  playerId: number;
  name: string;
  /** 这个孩子自己的年级：合作模式里每个人答自己年级的题 */
  grade: Grade;
  agentId: string;
  isHost: boolean;
  /** 所在队伍（见 CoopTeam）；合作模式恒为 0。老服务器不发这个字段时按 0 处理 */
  team: CoopTeam;
}

/** 房主点「开始」后发给所有人的开局信息（每个人收到的完全相同） */
export interface CoopStart {
  /** 玩法（老服务器不发时按 'coop' 处理） */
  mode: CoopMode;
  /** 随机种子：各设备用它得到一致的出生点、电脑名字等 */
  seed: number;
  levelId: string;
  mapId: string;
  opts: MatchOptions;
  /** 开局时房间里的全部成员（按 seat 升序） */
  members: CoopMember[];
}

/** 发送目标：某个 seat / 房主 / 除自己以外的所有人 */
export type CoopTarget = number | 'host' | 'all';

/**
 * 一局合作对局期间的消息通道（由 src/net/coop.ts 实现）。
 * 消息体 d 是任意可 JSON 序列化的值，格式由 src/game/coop-sync.ts 自己定义；单条序列化后 ≤ 16 KB。
 * 同一发送者发出的消息按发送顺序到达。
 */
export interface CoopLink {
  readonly selfSeat: number;
  readonly isHost: boolean;
  /** 当前仍在房间里的成员（有人中途离开后会变少） */
  members(): CoopMember[];
  send(d: unknown, to?: CoopTarget): void;
  /** 收到别人发来的消息；返回取消订阅函数 */
  onMessage(fn: (from: number, d: unknown) => void): () => void;
  /** 有成员离开 / 掉线（房主离开时不会触发这个，而是触发 onClosed） */
  onMemberLeft(fn: (seat: number) => void): () => void;
  /** 房间关闭（房主离开、自己掉线且重连失败、服务器重启等）；reason 是给孩子看的中文 */
  onClosed(fn: (reason: string) => void): () => void;
  /** 主动离开房间（对局结束或中途退出时调用） */
  leave(): void;
}

/** 一个房间最多几个人（人数不够时由电脑队友补满到关卡的每队人数） */
export const COOP_MAX_MEMBERS = 4;

/** 联机对战：开局时每队至少要有几个真人 */
export const VERSUS_MIN_PER_TEAM = 1;

/** 队伍的中文名 */
export const TEAM_NAMES: Record<CoopTeam, string> = { 0: '蓝队', 1: '红队' };
