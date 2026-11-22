/**
 * 联机游戏大厅（全屏层）：房间列表 → 建房（先选玩法：合作 / 对战，再选关卡）/ 加入 → 房间（成员、分队、换角色、房主开始）。
 * 合作 = 全家一队打电脑；对战 = 分成蓝队 / 红队互相打（每队人不够由电脑补位）。
 * 连接由本模块持有（离开大厅进入对局时不断开）；回到标题页时调用 closeCoop() 断开。
 * 房主点「开始」后服务器向全房间广播 start，这里把 CoopLink 交给 onStart（App.startCoop）。
 */
import './coop.css';
import { audio } from '../../core/audio.ts';
import { save } from '../../core/save.ts';
import { GRADE_NAMES, THEMES, agentById, type LevelDef } from '../../data/defs.ts';
import type { Grade } from '../../math/types.ts';
import { online } from '../../net/index.ts';
import { CoopClient, coopUrl, type RoomInfo } from '../../net/coop.ts';
import { COOP_MAX_MEMBERS, TEAM_NAMES, VERSUS_MIN_PER_TEAM, type CoopLink, type CoopMember, type CoopMode, type CoopStart, type CoopTeam } from '../../net/coop-link.ts';
import { LAYOUTS } from '../../world/layouts.ts';
import { agentBadge } from '../agent-art.ts';
import { add, btn, h, hexCss } from '../dom.ts';
import { agentScreen } from '../menus.ts';
import { canUseMap, isUnlocked, levelById, levelsOfGrade, starsOf, suggestedGrade } from '../progress.ts';
import { showPlayBlocked } from './chips.ts';
import { GRADE_CN, avatar, frame, layer, onEscape, widget, type Widget } from './common.ts';

export interface CoopLobbyOptions {
  /** 返回标题页（会断开连接） */
  onBack(): void;
  /** 房主开局了：进入对局 */
  onStart(link: CoopLink, start: CoopStart): void;
  /** 打开登录页 */
  onLogin(): void;
  /** 打开时先显示的一句提示（例如"房主离开了房间"） */
  notice?: string;
}

// ---------------------------------------------------------------- 连接（跨界面保留）

let client: CoopClient | null = null;
let clientToken = '';
let startHandler: ((link: CoopLink, start: CoopStart) => void) | null = null;

/** 当前的合作模式连接（没有连接时为 null） */
export function coopClient(): CoopClient | null {
  return client;
}

/** 断开合作模式连接（离开合作模式时） */
export function closeCoop(): void {
  client?.close();
  client = null;
}

function ensureClient(): CoopClient | null {
  const token = online.player ? online.session.token : null;
  if (!token) return null;
  if (client && !client.closed && clientToken === token) return client;
  client?.close();
  let url: string;
  try {
    url = coopUrl(online.api.base, typeof location === 'undefined' ? null : location);
  } catch {
    return null;
  }
  const c = new CoopClient({ url, token });
  c.on('start', ({ link, start }) => startHandler?.(link, start));
  client = c;
  clientToken = token;
  return c;
}

// ---------------------------------------------------------------- 小工具

const MAX_LABEL = ['', '一', '两', '三', '四'];

function mapName(id: string): string {
  return LAYOUTS.find((d) => d.id === id)?.name ?? id;
}

/** 这一关用的地图：存档里选过的（可用时），否则本关默认 */
function mapFor(l: LevelDef): string {
  const c = save.mapChoice[l.id];
  return c && canUseMap(l, c) ? c : l.mapId;
}

function levelLabel(id: string): string {
  const l = levelById(id);
  return l ? `${l.subtitle} · ${l.name}` : id;
}

function gradeOf(n: number): string {
  return GRADE_CN[n] ?? `${n} 年级`;
}

/** 大厅标题（合作 / 对战共用） */
const LOBBY_TITLE = '联机游戏';
const LOBBY_KICKER = '和家人一起玩 · 合作或对战';
const MODE_NAMES: Record<CoopMode, string> = { coop: '合作', versus: '对战' };
const other = (t: CoopTeam): CoopTeam => (t === 0 ? 1 : 0);

/** 每队的真人数 */
function teamCounts(members: CoopMember[]): [number, number] {
  const n: [number, number] = [0, 0];
  for (const m of members) n[m.team]++;
  return n;
}

/** 对战房间现在能不能开局 */
function teamsReady(members: CoopMember[]): boolean {
  const n = teamCounts(members);
  return n[0] >= VERSUS_MIN_PER_TEAM && n[1] >= VERSUS_MIN_PER_TEAM;
}

// ---------------------------------------------------------------- 界面

type View = 'guest' | 'connecting' | 'failed' | 'list' | 'mode' | 'create' | 'level' | 'room' | 'agent';

export function coopLobbyScreen(o: CoopLobbyOptions): Widget {
  startHandler = o.onStart;
  const root = layer('ol-screen-layer cp-layer');
  const cleanups: (() => void)[] = [];
  let view: View = 'connecting';
  let banner = o.notice ?? '';
  let failText = '';
  let busy = false;
  let back: () => void = o.onBack;
  /** 正在建的房间的玩法（建房第一步选） */
  let createMode: CoopMode = 'coop';

  let c = ensureClient();
  /** 当前连接上的事件订阅（重新连接时换掉） */
  let offs: (() => void)[] = [];
  cleanups.push(() => offs.splice(0).forEach((f) => f()));

  const setBanner = (t: string, sound = true) => {
    banner = t;
    if (sound && t) audio.ui('deny');
    render();
  };

  const go = (v: View) => {
    view = v;
    busy = false;
    render();
  };

  /** 当前该显示的主界面（按连接 / 房间状态） */
  const home = (): View => {
    if (!c) return 'guest';
    if (!c.ready) return failText ? 'failed' : 'connecting';
    return c.room ? 'room' : 'list';
  };

  const connect = () => {
    const cc = c;
    if (!cc) return;
    failText = '';
    go('connecting');
    cc.connect().then(
      () => {
        if (cc !== c) return;
        if (!cc.room) cc.subscribeRooms();
        go(home());
      },
      (e: Error) => {
        if (cc !== c) return;
        failText = e.message || '连不上家里的服务器';
        go('failed');
      },
    );
  };

  const bind = (c: CoopClient) => {
    offs.splice(0).forEach((f) => f());
    offs = [
      c.on('rooms', () => {
        if (view === 'list') render();
      }),
      c.on('room', (r) => {
        busy = false;
        if (r) {
          if (view === 'list' || view === 'mode' || view === 'create' || view === 'room') go('room');
          else if (view === 'level') go('room');
        } else {
          c.subscribeRooms();
          if (view === 'room' || view === 'level' || view === 'agent') go('list');
        }
      }),
      c.on('roomClosed', (reason) => setBanner(reason)),
      c.on('error', (e) => {
        busy = false;
        setBanner(e.message);
      }),
      c.on('disconnected', (reason) => {
        failText = reason;
        // 可能是这个账号在另一台设备上登录了：马上确认，失效的话界面会回到登录页
        void online.checkSession();
        go('failed');
      }),
    ];
  };
  if (c) bind(c);

  // ---------------------------------------------------------- 各个界面

  /** onBack：Esc 和「返回」按钮；showBack = false 时不显示「返回」按钮（房间里用「离开房间」） */
  const shell = (title: string, kicker: string, onBack: () => void, showBack = true) => {
    back = onBack;
    const f = frame(title, kicker, showBack ? onBack : null, 'cp-screen');
    root.replaceChildren(f.root);
    if (banner) {
      const b = h('div', 'ol-banner cp-banner');
      b.append(h('span', '', banner), btn('知道了', 'btn btn-ghost sm', () => {
        banner = '';
        b.remove();
      }));
      f.body.before(b);
    }
    return f;
  };

  const renderGuest = () => {
    const { body } = shell(LOBBY_TITLE, LOBBY_KICKER, o.onBack);
    const p = h('div', 'panel cp-guest');
    p.append(
      h('div', 'panel-kicker', '需要先登录'),
      h('p', 'cp-text', '联机游戏要和家里的其他人一起玩（一起打电脑，或者分两队互相打）：每个人在自己的设备上登录自己的家庭账号，再进同一个房间。'),
      h('p', 'cp-text dim', online.state === 'offline' ? '现在连不上家里的服务器，连上以后才能玩联机游戏。' : '你现在是游客身份，先登录自己的账号吧。'),
      add(
        h('div', 'cp-acts'),
        btn('返回', 'btn btn-ghost', () => {
          audio.ui('click');
          o.onBack();
        }),
        online.state === 'offline'
          ? null
          : btn('去登录', 'btn btn-primary', () => {
              audio.ui('open');
              o.onLogin();
            }),
      ),
    );
    body.append(p);
  };

  const renderConnecting = () => {
    const { body } = shell(LOBBY_TITLE, LOBBY_KICKER, o.onBack);
    body.append(h('div', 'ol-empty cp-wait', '正在连接家里的服务器…'));
  };

  const renderFailed = () => {
    const { body } = shell(LOBBY_TITLE, LOBBY_KICKER, o.onBack);
    const p = h('div', 'panel cp-guest');
    p.append(
      h('div', 'panel-kicker', '连不上'),
      h('p', 'cp-text', failText || '连不上家里的服务器'),
      h('p', 'cp-text dim', '看看平板 / 电脑是不是连着家里的 Wi-Fi，然后再试一次。'),
      add(
        h('div', 'cp-acts'),
        btn('返回', 'btn btn-ghost', () => {
          audio.ui('click');
          o.onBack();
        }),
        btn('重新连接', 'btn btn-primary', () => {
          audio.ui('click');
          // 断开的连接不能再用：换一个新的
          closeCoop();
          banner = '';
          c = ensureClient();
          if (!c) return go('guest');
          bind(c);
          connect();
        }),
      ),
    );
    body.append(p);
  };

  const roomCard = (r: RoomInfo) => {
    const card = h('article', 'panel cp-room' + (r.state === 'playing' ? ' is-playing' : ''));
    const host = r.members.find((m) => m.isHost) ?? r.members[0];
    const l = levelById(r.levelId);
    if (l) card.style.setProperty('--tc', hexCss(THEMES[l.grade].neon));
    const full = r.members.length >= COOP_MAX_MEMBERS;
    const vs = r.mode === 'versus';
    const people = h('div', 'cp-room-people');
    for (const m of r.members) people.append(add(h('span', 'cp-chip' + (vs ? ` team-${m.team}` : '')), avatar(m.name, 'sm'), h('span', '', m.name)));
    const n = teamCounts(r.members);
    const teams = vs
      ? add(h('div', 'cp-room-teams'), h('span', 'cp-team-n team-0', `${TEAM_NAMES[0]} ${n[0]} 人`), h('span', 'cp-vs', 'VS'), h('span', 'cp-team-n team-1', `${TEAM_NAMES[1]} ${n[1]} 人`))
      : null;
    const status = r.state === 'playing' ? '正在对战' : full ? '人满了' : '等人加入';
    const join = btn(r.state === 'playing' ? '对战中' : full ? '满了' : '加入', 'btn btn-primary', () => {
      if (!c || busy) return;
      void tryEnter(r.levelId, () => c?.join(r.id, save.agent));
    });
    join.disabled = r.state === 'playing' || full;
    card.append(
      add(
        h('div', 'cp-room-top'),
        add(
          h('div', 'cp-room-id'),
          h('span', 'cp-room-no', `房间 ${r.id}`),
          h('span', `cp-tag cp-mode-tag mode-${r.mode}`, MODE_NAMES[r.mode]),
          h('span', 'cp-tag' + (r.state === 'playing' ? ' hot' : ''), status),
        ),
        h('div', 'cp-room-count', `${r.members.length} / ${COOP_MAX_MEMBERS} 人`),
      ),
      h('div', 'cp-room-level', `${host ? host.name + '的房间 · ' : ''}${levelLabel(r.levelId)}`),
      h('div', 'cp-room-map', `地图：${mapName(r.mapId)}`),
      teams ?? '',
      people,
      join,
    );
    return card;
  };

  const renderList = () => {
    const { body, head } = shell(LOBBY_TITLE, LOBBY_KICKER, o.onBack);
    const create = btn('建一个房间', 'btn btn-primary', () => {
      audio.ui('open');
      go('mode');
    });
    head.append(add(h('div', 'head-tools'), create));
    const me = online.player;
    const intro = h('div', 'cp-intro');
    intro.append(
      me ? add(h('span', 'cp-chip me'), avatar(me.name, 'sm'), h('span', '', `${me.name} · ${gradeOf(me.grade)}`)) : '',
      h('span', 'cp-intro-text', `最多${MAX_LABEL[COOP_MAX_MEMBERS]}个人：可以一起打电脑，也可以分两队互相打。每个人答自己年级的题。`),
    );
    const list = h('div', 'cp-room-list');
    const rooms = c?.rooms ?? [];
    if (!rooms.length) {
      const empty = h('div', 'cp-empty');
      empty.append(
        h('div', 'empty-big', '还没有房间'),
        h('div', 'empty-sub', '点「建一个房间」，再让家里其他人在自己的设备上打开「联机游戏」，就能看到你的房间了。'),
        btn('建一个房间', 'btn btn-primary btn-xl', () => {
          audio.ui('open');
          go('mode');
        }),
      );
      list.append(empty);
    } else for (const r of rooms) list.append(roomCard(r));
    body.append(add(h('div', 'cp-col'), intro, list));
  };

  /** 建房第一步：选玩法 */
  const renderMode = () => {
    const { body } = shell('建一个房间', '先选怎么玩', () => go('list'));
    const card = (mode: CoopMode, name: string, short: string, text: string) => {
      const b = btn(name, `panel cp-mode mode-${mode}`, () => {
        audio.ui('open');
        createMode = mode;
        go('create');
      });
      // 示意图：合作 = 一整条蓝色（大家一队）；对战 = 蓝 / 红两半
      b.prepend(mode === 'coop' ? add(h('span', 'cp-mode-icon'), h('i', 'team-0'), h('i', 'team-0')) : add(h('span', 'cp-mode-icon'), h('i', 'team-0'), h('b', '', 'VS'), h('i', 'team-1')));
      b.append(h('span', 'cp-mode-short', short), h('span', 'cp-mode-text', text));
      return b;
    };
    body.append(
      add(
        h('div', 'cp-modes'),
        card('coop', '合作', '一起打电脑', '全家人在同一队，和电脑对手比赛。'),
        card('versus', '对战', '分两队互相打', `分成${TEAM_NAMES[0]}和${TEAM_NAMES[1]}互相比赛，人不够时电脑来补位。`),
      ),
    );
  };

  /** 选关卡（建房 / 房主换关卡共用） */
  const renderPicker = (mode: 'create' | 'level') => {
    const backTo = () => go(mode === 'create' ? 'mode' : 'room');
    const roomMode: CoopMode = mode === 'create' ? createMode : (c?.room?.mode ?? 'coop');
    const { body } = shell(mode === 'create' ? `建一个${MODE_NAMES[createMode]}房间` : '换关卡', '选一个你已经解锁的关卡', backTo);
    const cur = mode === 'level' && c?.room ? levelById(c.room.levelId) : undefined;
    let grade: Grade = cur?.grade ?? (([3, 4, 5, 6] as Grade[]).includes(online.player?.grade as Grade) ? (online.player!.grade as Grade) : suggestedGrade());
    let picked: LevelDef | null = cur ?? null;
    const tabs = h('div', 'grade-tabs cp-tabs');
    const grid = h('div', 'cp-levels');
    const side = h('aside', 'panel cp-pick-side');
    const ok = btn(mode === 'create' ? '建好房间' : '就打这一关', 'btn btn-primary btn-xl', () => {
      if (!picked || !c || busy) return;
      const l = picked;
      audio.ui('open');
      if (mode === 'create') void tryEnter(l.id, () => c?.create(l.id, mapFor(l), save.agent, createMode));
      else {
        busy = true;
        c.setLevel(l.id, mapFor(l));
      }
    });
    const paintSide = () => {
      side.replaceChildren();
      if (!picked) {
        side.append(h('div', 'ol-empty sm', '先在左边选一个关卡'));
        ok.disabled = true;
        side.append(ok);
        return;
      }
      ok.disabled = false;
      const l = picked;
      side.style.setProperty('--tc', hexCss(THEMES[l.grade].neon));
      side.append(
        h('div', 'panel-kicker', l.subtitle),
        h('h3', 'brief-title', l.name),
        add(
          h('div', 'cp-facts'),
          h('div', '', `每队 ${l.teamSize} 人 · 先赢 ${l.roundsToWin} 回合`),
          h('div', '', `地图：${mapName(mapFor(l))}`),
          h('div', 'dim', roomMode === 'versus' ? '对战：两队人不够时由电脑补满' : '合作：大家一队打电脑'),
          h('div', 'dim', '题目：每个人答自己年级的题'),
        ),
        ok,
      );
    };
    const paintGrade = () => {
      tabs.querySelectorAll<HTMLElement>('.grade-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.g === String(grade)));
      grid.replaceChildren();
      levelsOfGrade(grade).forEach((l, i) => {
        const open = isUnlocked(l);
        const s = starsOf(l.id);
        const b = btn(`${String(i + 1).padStart(2, '0')} ${l.name}`, 'cp-level' + (open ? '' : ' is-locked') + (picked?.id === l.id ? ' is-selected' : ''), () => {
          if (!open) {
            audio.ui('deny');
            return;
          }
          audio.ui('click');
          picked = l;
          paintGrade();
          paintSide();
        });
        b.append(h('span', 'cp-level-sub', open ? (s > 0 ? '★'.repeat(s) : '未通关') : '🔒 未解锁'));
        if (!open) b.setAttribute('aria-disabled', 'true');
        grid.append(b);
      });
    };
    for (const g of [3, 4, 5, 6] as Grade[]) {
      const t = btn(GRADE_NAMES[g], 'grade-tab', () => {
        audio.ui('click');
        grade = g;
        paintGrade();
      });
      t.dataset.g = String(g);
      t.style.setProperty('--tc', hexCss(THEMES[g].neon));
      tabs.append(t);
    }
    if (!picked) picked = levelsOfGrade(grade).find((l) => isUnlocked(l) && starsOf(l.id) < 1) ?? levelsOfGrade(grade).filter(isUnlocked).slice(-1)[0] ?? null;
    paintGrade();
    paintSide();
    body.append(add(h('div', 'cp-pick-main'), tabs, grid), side);
  };

  const memberCard = (m: CoopMember, self: boolean, extra: HTMLElement | null = null) => {
    const a = agentById(m.agentId);
    const card = h('div', 'cp-member' + (self ? ' is-self' : ''));
    card.style.setProperty('--ac', hexCss(a.color));
    card.append(
      agentBadge(a.id, a.name, 'pa-badge cp-badge'),
      add(
        h('div', 'cp-member-text'),
        add(h('div', 'cp-member-name'), h('span', '', m.name), m.isHost ? h('span', 'cp-tag', '房主') : null, self ? h('span', 'cp-tag me', '你') : null),
        h('div', 'cp-member-sub', `${gradeOf(m.grade)} · ${a.name}`),
      ),
      extra ?? '',
    );
    return card;
  };

  const renderRoom = () => {
    if (!c?.room) return go('list');
    const r = c.room;
    const leave = () => {
      audio.ui('click');
      c?.leave();
    };
    const vs = r.mode === 'versus';
    const { body, head } = shell(`房间 ${r.id}`, vs ? '联机对战 · 房间' : '合作模式 · 房间', leave, false);
    const host = c.isHost;
    const l = levelById(r.levelId);
    if (l) root.style.setProperty('--tc', hexCss(THEMES[l.grade].neon));
    head.append(
      add(
        h('div', 'head-tools'),
        btn('离开房间', 'btn btn-ghost', leave),
      ),
    );

    // 左：成员（对战：蓝队 / 红队两栏）
    const left = vs ? versusLeft(r, l, host) : coopLeft(r, l, host);

    // 右：关卡 + 按钮
    const self = r.members.find((m) => m.seat === c?.selfSeat);
    const right = h('aside', 'panel cp-room-right' + (vs ? ' is-versus' : ''));
    right.append(
      h('div', 'panel-kicker', host ? '你是房主' : '关卡'),
      h('h3', 'brief-title', l ? l.name : r.levelId),
      add(h('div', 'cp-facts'), h('div', '', l ? l.subtitle : ''), h('div', '', `地图：${mapName(r.mapId)}`), l ? h('div', '', `每队 ${l.teamSize} 人 · 先赢 ${l.roundsToWin} 回合`) : null),
    );
    const acts = h('div', 'cp-room-acts');
    const ag = agentById(self?.agentId ?? save.agent);
    if (vs && self) {
      const to = other(self.team);
      const sw = btn(`换到${TEAM_NAMES[to]}`, `btn btn-ghost cp-switch team-${to}`, () => {
        audio.ui('click');
        c?.setTeam(to);
      });
      sw.disabled = r.state === 'playing';
      acts.append(sw);
    }
    acts.append(
      btn(`换角色（${ag.name}）`, 'btn btn-ghost', () => {
        audio.ui('click');
        go('agent');
      }),
    );
    const ready = !vs || teamsReady(r.members);
    const hint = vs && !ready && r.state !== 'playing' ? h('div', 'cp-start-hint', '两队都要至少有一个人') : null;
    if (host) {
      acts.append(
        btn('换关卡', 'btn btn-ghost', () => {
          audio.ui('click');
          go('level');
        }),
      );
      const start = btn(r.state === 'playing' ? '对局进行中…' : '开始', 'btn btn-primary btn-xl', () => void startMatch());
      start.disabled = busy || r.state === 'playing' || !ready;
      if (hint) acts.append(hint);
      acts.append(start);
    } else {
      const wait = btn(r.state === 'playing' ? '这一局还没结束…' : '等房主开始', 'btn btn-ghost btn-xl cp-waiting', () => undefined);
      wait.disabled = true;
      if (hint) acts.append(hint);
      acts.append(wait);
    }
    right.append(acts);
    body.append(left, right);
  };

  /** 合作房间的成员栏（和加入对战前完全一样） */
  const coopLeft = (r: RoomInfo, l: LevelDef | undefined, host: boolean) => {
    const slots = h('div', 'cp-members');
    const size = Math.max(l?.teamSize ?? COOP_MAX_MEMBERS, r.members.length);
    for (const m of r.members) slots.append(memberCard(m, m.seat === c?.selfSeat));
    for (let i = r.members.length; i < size; i++) {
      const e = h('div', 'cp-member is-bot');
      e.append(h('div', 'pa-badge cp-badge cp-bot', '电脑'), add(h('div', 'cp-member-text'), h('div', 'cp-member-name', '电脑队友'), h('div', 'cp-member-sub', i < COOP_MAX_MEMBERS ? '还可以再进一个人' : '由电脑来打')));
      slots.append(e);
    }
    return add(
      h('section', 'panel cp-room-left'),
      h('div', 'panel-kicker', `队友 ${r.members.length} / ${COOP_MAX_MEMBERS}`),
      slots,
      h('p', 'cp-text dim', '每个人答自己年级的题，一起打败电脑。人不够时，空位由电脑队友补上。'),
      host ? h('p', 'cp-text cp-host-note', '你是房主：对局中请保持本设备屏幕亮着、不要切到别的应用（电脑对手由你的设备来控制）。') : null,
    );
  };

  /** 对战房间的成员栏：蓝队 / 红队两栏，空位显示「电脑补位」 */
  const versusLeft = (r: RoomInfo, l: LevelDef | undefined, host: boolean) => {
    const size = l?.teamSize ?? COOP_MAX_MEMBERS;
    const n = teamCounts(r.members);
    const cols = h('div', 'cp-teams');
    for (const t of [0, 1] as CoopTeam[]) {
      const list = h('div', 'cp-team-list');
      for (const m of r.members.filter((x) => x.team === t)) {
        const self = m.seat === c?.selfSeat;
        // 房主：每个别人的卡片上有一个小按钮，把他换到另一队
        let move: HTMLElement | null = null;
        if (host && !self && r.state === 'lobby') {
          const to = other(t);
          move = btn(t === 0 ? '换到红队 →' : '← 换到蓝队', `cp-move team-${to}`, () => {
            audio.ui('click');
            c?.setTeam(to, m.seat);
          });
          move.title = `把${m.name}换到${TEAM_NAMES[to]}`;
        }
        list.append(memberCard(m, self, move));
      }
      for (let i = n[t]; i < size; i++) {
        const e = h('div', 'cp-member is-bot');
        e.append(h('div', 'pa-badge cp-badge cp-bot', '电脑'), add(h('div', 'cp-member-text'), h('div', 'cp-member-name', '电脑补位'), h('div', 'cp-member-sub', '人不够时由电脑来打')));
        list.append(e);
      }
      cols.append(
        add(
          h('div', `cp-team-col team-${t}`),
          add(h('div', 'cp-team-head'), h('span', 'cp-team-name', TEAM_NAMES[t]), h('span', 'cp-team-count', `${n[t]} 人 · 每队 ${size} 人`)),
          list,
        ),
      );
    }
    return add(
      h('section', 'panel cp-room-left'),
      h('div', 'panel-kicker', `对战 · ${r.members.length} / ${COOP_MAX_MEMBERS} 人`),
      cols,
      h('p', 'cp-text dim', '两队互相比赛，每个人答自己年级的题。人不够的队，空位由电脑补上。'),
      host ? h('p', 'cp-text cp-host-note', '你是房主：可以点别人卡片上的按钮帮他换队。对局中请保持本设备屏幕亮着、不要切到别的应用（电脑由你的设备来控制）。') : null,
    );
  };

  const renderAgent = () => {
    const before = save.agent;
    const backTo = () => {
      if (c?.room && save.agent !== before) c.setAgent(save.agent);
      go(c?.room ? 'room' : 'list');
    };
    back = backTo;
    const el = agentScreen(backTo);
    el.classList.add('cp-agent');
    root.replaceChildren(el);
  };

  /** 建房 / 进房前：看看现在能不能玩（家长设置的游戏时间） */
  const tryEnter = async (levelId: string, send: () => void) => {
    busy = true;
    const l = levelById(levelId);
    if (l) {
      const r = await online.beforeMatch(l);
      if (!r.allowed) {
        busy = false;
        audio.ui('deny');
        await showPlayBlocked(r, root);
        return;
      }
    }
    send();
    // 服务器没有回应时别一直卡住
    setTimeout(() => (busy = false), 4000);
  };

  const startMatch = async () => {
    if (!c?.room || !c.isHost || busy) return;
    const r = c.room;
    const l = levelById(r.levelId);
    if (!l) return setBanner('找不到这个关卡');
    busy = true;
    render();
    audio.ui('open');
    const b = await online.beforeMatch(l);
    if (!b.allowed) {
      busy = false;
      render();
      audio.ui('deny');
      await showPlayBlocked(b, root);
      return;
    }
    if (!c.room || c.room.id !== r.id) return;
    c.start(r.levelId, r.mapId, b.options);
    setTimeout(() => {
      if (busy) {
        busy = false;
        if (view === 'room') render();
      }
    }, 4000);
  };

  function render(): void {
    if (view !== 'agent' && view !== 'mode' && view !== 'create' && view !== 'level') {
      const hv = home();
      if (hv !== view && !(view === 'failed' && hv === 'connecting')) view = hv;
    }
    switch (view) {
      case 'guest':
        return renderGuest();
      case 'connecting':
        return renderConnecting();
      case 'failed':
        return renderFailed();
      case 'list':
        return renderList();
      case 'mode':
        return renderMode();
      case 'create':
        return renderPicker('create');
      case 'level':
        return renderPicker('level');
      case 'room':
        return renderRoom();
      case 'agent':
        return renderAgent();
    }
  }

  cleanups.push(onEscape(() => back()));
  const ww = widget(root, cleanups);

  if (!c) view = 'guest';
  else if (c.ready) {
    if (!c.room) c.subscribeRooms();
    view = home();
  } else connect();
  render();
  return ww;
}
