/** 应用外壳：界面切换、局内 UI（实现 MatchUI）、暂停与结算 */
import { LAYOUTS } from '../world/layouts.ts';
import { Match, type AnswerEvent, type MatchOptions, type MatchResult, type MatchUI } from '../game/match.ts';
import { actDown, actHit } from '../data/controls.ts';
import type { Combatant } from '../game/combatant.ts';
import { LEVELS, RULES, THEMES, type LevelDef } from '../data/defs.ts';
import type { Question } from '../math/types.ts';
import { online } from '../net/index.ts';
import { leaderboardScreen, loginScreen, showPlayBlocked, studyScreen, type Widget } from './online/index.ts';
import { decorateTitle } from './online/title.ts';
import { closeCoop, coopClient, coopLobbyScreen } from './online/coop-lobby.ts';
import type { CoopLink, CoopStart } from '../net/coop-link.ts';
import type { Input } from '../core/input.ts';
import { save } from '../core/save.ts';
import { audio } from '../core/audio.ts';
import type { Stage } from '../render/stage.ts';
import { GameMap } from '../world/map.ts';
import { add, btn, h } from './dom.ts';
import { Hud, type KillPopInfo } from './hud.ts';
import { BuyMenu } from './buy.ts';
import { agentScreen, emblem, helpScreen, levelScreen, rankScreen, settingsScreen, titleScreen, wrongScreen, type MenuNav, type ScreenEl } from './menus.ts';
import { resultsScreen } from './results.ts';
import { TouchControls } from './touch.ts';
import { canUseMap, levelById, nextLevel, unlockedMapIds } from './progress.ts';

export class App implements MatchUI {
  match: Match | null = null;
  paused = false;
  readonly hud = new Hud();
  readonly touch: TouchControls;
  private menuLayer = h('div', 'menu-layer');
  private overlay = h('div', 'overlay-layer is-hidden');
  private noticeEl = h('div', 'notice is-hidden');
  private buyMenu: BuyMenu;
  private nav: MenuNav;
  private screen: ScreenEl | null = null;
  private level: LevelDef | null = null;
  private resultsOn = false;
  private pendingBuy = false;
  private pauseAt = 0;
  private pauseSub = false;
  private idleBuilt = false;
  /** 盖在菜单上的联网全屏界面（登录 / 我的学习 / 排行榜） */
  private onlineLayer: Widget | null = null;
  /** 标题页当前是按哪个联网状态渲染的（状态变了才重绘） */
  private titleKey = '';
  /** 对局已开始、还没结束（用于游戏时间计时） */
  private matchLive = false;
  /** 已发放任务奖励的回合 */
  private bonusRound = -1;
  private starting = false;
  /** 合作模式：当前这一局的消息通道（单人对局时为 null） */
  private coopLink: CoopLink | null = null;

  constructor(
    private stage: Stage,
    private input: Input,
    private root: HTMLElement,
  ) {
    this.buyMenu = new BuyMenu(
      () => this.deploy(),
      () => this.hideBuy(),
    );
    this.touch = new TouchControls(
      input,
      {
        pause: () => {
          if (this.canPause()) this.openPause();
        },
        buy: () => {
          const m = this.match;
          if (m && m.phase === 'buy' && !this.buyMenu.isOpen) {
            audio.ui('open');
            this.openBuy();
          }
        },
      },
      this.hud.root,
    );
    // 触屏层在 HUD 之下：HUD 上可点的元素（技能、比分条、解题选项等）优先接收触摸
    root.append(this.touch.root, this.hud.root, this.buyMenu.root, this.overlay, this.menuLayer, this.noticeEl);

    const nav: MenuNav = {
      title: () => this.showTitle(true),
      levels: () => this.show(levelScreen(nav)),
      agents: (back) => this.show(agentScreen(back)),
      wrong: (back) => this.show(wrongScreen(back)),
      rank: (back) => this.show(rankScreen(back)),
      settings: (back) => this.show(settingsScreen(back, stage, input.touchMode)),
      help: (back) => this.show(helpScreen(back, input.touchMode)),
      start: (l) => void this.requestStart(l.id, save.agent),
      coop: () => this.openCoop(),
      stage,
    };
    this.nav = nav;

    input.onLockChange = (locked) => this.onLock(locked);
    input.onModeChange = (mode) => {
      // 对局中切到触屏：放开指针锁定（触屏不需要）；切回鼠标：等玩家点击画面重新锁定
      if (mode === 'touch') this.input.exitLock();
      this.touch.reset();
    };
    // 触屏没有指针锁定：切到后台 / 竖屏时自动暂停
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.input.touchMode && this.canPause()) this.openPause();
      // 切回来时重新申请屏幕常亮（切到后台时浏览器会自动释放）
      if (!document.hidden && this.coopLink) void this.acquireWakeLock();
    });
    try {
      matchMedia('(orientation: portrait)').addEventListener('change', (e) => {
        if (e.matches && this.input.touchMode && this.canPause()) this.openPause();
      });
    } catch {
      /* 旧浏览器忽略 */
    }
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.bindOnline();
    this.ensureIdleWorld();
    nav.title();
  }

  // ------------------------------------------------------------ 联网（家庭服务器）

  private bindOnline(): void {
    const onTitle = () => !this.match && this.screen?.classList.contains('title-screen');
    const key = () => `${online.state}|${online.player?.name ?? ''}|${online.isGuest}`;
    // 换了玩家 / 采用了服务器合并后的存档：标题页的星星、战绩要重画
    online.on('saveSwapped', () => {
      if (onTitle()) this.showTitle(false);
    });
    online.on('state', () => {
      if (onTitle() && key() !== this.titleKey) this.showTitle(false);
    });
    online.on('authLost', (v) => {
      if (!this.match) this.showLogin(false);
      else if (v.reason) this.hud.toast(`${v.reason}，打完这局要重新登录才能保存到服务器`);
    });
    online.on('limitReached', () => {
      if (this.match) this.hud.toast('今天的游戏时间到了，打完这一局就休息吧');
    });
  }

  /** 标题页（navigated = 从别的界面回来：顺便刷新留言 / 任务 / 游戏时间） */
  private showTitle(navigated: boolean): void {
    const el = titleScreen(this.nav) as ScreenEl & { onLeave?: () => void };
    this.titleKey = `${online.state}|${online.player?.name ?? ''}|${online.isGuest}`;
    el.onLeave = decorateTitle(el, {
      switchPlayer: () => this.showLogin(true),
      openStudy: () => this.openLayer(studyScreen({ onBack: () => this.closeLayer() })),
      openBoard: () => this.openLayer(leaderboardScreen({ onBack: () => this.closeLayer() })),
    });
    this.show(el);
    if (navigated) void online.refreshTitle();
    if (online.needsLogin && !this.onlineLayer) this.showLogin(false);
  }

  private openLayer(w: Widget): void {
    this.onlineLayer?.destroy();
    this.onlineLayer = w;
    this.root.append(w);
  }

  private closeLayer(): void {
    this.onlineLayer?.destroy();
    this.onlineLayer = null;
  }

  /** 登录 / 切换玩家（cancelable：从"切换玩家"进来时可以直接返回） */
  showLogin(cancelable: boolean): void {
    this.openLayer(
      loginScreen({
        onDone: () => {
          this.closeLayer();
          this.showTitle(true);
        },
        onCancel: cancelable ? () => this.closeLayer() : undefined,
      }),
    );
  }

  // ------------------------------------------------------------ 合作模式

  /** 打开合作模式大厅（notice：先给孩子看的一句话，例如"房主离开了房间"） */
  openCoop(notice?: string): void {
    this.openLayer(
      coopLobbyScreen({
        notice,
        onBack: () => {
          closeCoop();
          this.closeLayer();
        },
        onStart: (link, start) => this.startCoop(link, start),
        onLogin: () => this.showLogin(true),
      }),
    );
  }

  /** 从合作对局回到大厅：标题页垫在下面，大厅层盖在上面 */
  private backToCoop(notice?: string): void {
    this.showTitle(false);
    this.openCoop(notice);
  }

  /**
   * 合作模式开局（房主点了「开始」，每个人的设备都会调用）。
   * 与 startLevel 相同，只是关卡 / 地图 / 参数来自房主，角色是自己在房间里选的，并把 link 交给对局。
   */
  startCoop(link: CoopLink, start: CoopStart): void {
    const base = levelById(start.levelId) ?? LEVELS[0];
    const l = start.mapId && start.mapId !== base.mapId ? { ...base, mapId: start.mapId } : base;
    const self = start.members.find((x) => x.seat === link.selfSeat);
    const agentId = self?.agentId ?? save.agent;
    // 上一局（结算界面）还在：换成新的一局（旧 link 已作废，teardown 里的 leave 是空操作）
    if (this.match) this.teardown();
    this.coopLink = link;
    this.level = base;
    this.pendingBuy = false;
    this.closeLayer();
    (this.screen as (ScreenEl & { onLeave?: () => void }) | null)?.onLeave?.();
    this.menuLayer.classList.add('is-hidden');
    this.menuLayer.replaceChildren();
    this.screen = null;
    this.idleBuilt = false;
    let m: Match;
    try {
      this.mapsBefore = unlockedMapIds();
      // 第 7 个参数由对局同步层（src/game/coop-sync.ts）使用
      m = new Match(this.stage, this.input, l, agentId, this, start.opts ?? {}, { link, start });
    } catch (err) {
      console.error('[算境突围] 合作对局启动失败', err);
      this.coopLink = null;
      link.leave();
      this.idleBuilt = false;
      this.backToCoop('对局启动失败，请稍后重试');
      return;
    }
    this.match = m;
    // 通行题：与单人相同（家长题 / 错题再练）
    m.gatePicker = (generate) => online.gateQuestion<Question>({ level: m.level, generate, recentTexts: m.recentTexts });
    // 房主的设备替所有人算电脑和回合：对局中别让屏幕睡着
    void this.acquireWakeLock();
    // 房间关了 / 掉线：对局同步层也会调用 coopClosed，这里兜底（例如在结算界面时）
    link.onClosed((reason) => {
      if (this.coopLink === link) this.coopClosed(reason);
    });
    this.bonusRound = -1;
    this.matchLive = true;
    online.matchStarted();
    this.hud.attach(m);
    if (this.pendingBuy) {
      this.pendingBuy = false;
      this.openBuy();
    }
  }

  /** 屏幕常亮锁（只在合作对局中持有） */
  private wakeLock: { release(): Promise<void> } | null = null;

  private async acquireWakeLock(): Promise<void> {
    if (!this.coopLink || this.wakeLock || document.hidden) return;
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
      const lock = await nav.wakeLock?.request('screen');
      if (!lock) return;
      // 拿到锁时对局已经结束：马上释放
      if (!this.coopLink) void lock.release().catch(() => undefined);
      else {
        this.wakeLock = lock;
        (lock as unknown as EventTarget).addEventListener?.('release', () => {
          if (this.wakeLock === lock) this.wakeLock = null;
        });
      }
    } catch {
      /* 不支持 / 被拒绝：忽略 */
    }
  }

  private releaseWakeLock(): void {
    const l = this.wakeLock;
    this.wakeLock = null;
    if (l) void l.release().catch(() => undefined);
  }

  /** 合作对局里：房间关闭或掉线（MatchUI 钩子，对局同步层调用；可重复调用） */
  coopClosed(reason: string): void {
    if (!this.coopLink) return;
    this.coopLink = null;
    // 已经在看结算：别把孩子从结算界面拽走，按钮之后会回到大厅
    if (this.resultsOn) {
      this.notice(reason);
      return;
    }
    audio.ui('deny');
    this.backToCoop(reason);
  }

  /** 离开合作对局（中途退出 / 结算后返回）：离开房间，回到大厅的房间列表 */
  private leaveCoop(): void {
    // teardown 会调用 link.leave()
    this.backToCoop();
  }

  /** 结算后「再来一局」：留在房间里；房主让房间回到大厅状态 */
  private coopAgain(): void {
    const c = coopClient();
    if (this.coopLink && c?.room) {
      // 不离开房间
      this.coopLink = null;
      c.end();
    }
    this.backToCoop();
  }

  /**
   * 开局：先问联网层能不能玩、用什么参数（家长设置）；不能玩时显示提示。
   * 明确给了 opts（测试接口）或离线游客时直接开局（与原来一样是同步的）。
   */
  async requestStart(levelId: string, agentId: string = save.agent, opts?: MatchOptions): Promise<void> {
    if (opts || online.isGuest) {
      this.startLevel(levelId, agentId, opts);
      return;
    }
    if (this.starting) return;
    this.starting = true;
    try {
      const l = levelById(levelId) ?? LEVELS[0];
      const r = await online.beforeMatch(l);
      if (!r.allowed) {
        audio.ui('deny');
        await showPlayBlocked(r, this.root);
        return;
      }
      this.startLevel(levelId, agentId, r.options);
    } finally {
      this.starting = false;
    }
  }

  // ------------------------------------------------------------ 菜单

  private show(el: ScreenEl): void {
    (this.screen as (ScreenEl & { onLeave?: () => void }) | null)?.onLeave?.();
    if (this.match) this.teardown();
    this.ensureIdleWorld();
    this.menuLayer.classList.remove('is-hidden');
    this.menuLayer.replaceChildren(el);
    this.screen = el;
  }

  private ensureIdleWorld(): void {
    if (this.idleBuilt) return;
    this.stage.buildWorld(new GameMap(), THEMES[3]);
    this.idleBuilt = true;
  }

  /** 开局时已解锁的地图，用于结算时提示新解锁 */
  private mapsBefore: string[] = [];

  private notice(text: string): void {
    this.noticeEl.textContent = text;
    this.noticeEl.classList.remove('is-hidden');
    setTimeout(() => this.noticeEl.classList.add('is-hidden'), 4200);
  }

  // ------------------------------------------------------------ 对局生命周期

  /** 本关的对局参数（重玩时沿用；将来由服务端按孩子下发） */
  private matchOpts: MatchOptions = {};

  startLevel(levelId: string, agentId: string = save.agent, opts?: MatchOptions): void {
    const l = levelById(levelId) ?? LEVELS[0];
    if (opts) this.matchOpts = opts;
    else if (this.level?.id !== levelId) this.matchOpts = {};
    if (this.match) this.teardown();
    this.level = l;
    this.pendingBuy = false;
    this.closeLayer();
    (this.screen as (ScreenEl & { onLeave?: () => void }) | null)?.onLeave?.();
    this.menuLayer.classList.add('is-hidden');
    this.menuLayer.replaceChildren();
    this.screen = null;
    this.idleBuilt = false;
    let m: Match;
    try {
      // 玩家可以在关卡简报里自选地图；题目仍然只来自本关的专题
      const chosen = save.mapChoice[l.id];
      const mapId = chosen && canUseMap(l, chosen) ? chosen : l.mapId;
      this.mapsBefore = unlockedMapIds();
      m = new Match(this.stage, this.input, mapId === l.mapId ? l : { ...l, mapId }, agentId, this, this.matchOpts);
    } catch (err) {
      console.error('[算境突围] 关卡启动失败', err);
      this.idleBuilt = false;
      this.nav.levels();
      this.notice('关卡启动失败，请稍后重试');
      return;
    }
    this.match = m;
    // 通行题：按家长设置出家长题 / 错题再练（游客时总是正常出题）
    m.gatePicker = (generate) => online.gateQuestion<Question>({ level: m.level, generate, recentTexts: m.recentTexts });
    this.bonusRound = -1;
    this.matchLive = true;
    online.matchStarted();
    this.hud.attach(m);
    if (this.pendingBuy) {
      this.pendingBuy = false;
      this.openBuy();
    }
  }

  private teardown(): void {
    const m = this.match;
    this.match = null;
    // 合作对局：离开房间（"再来一局"会先把 coopLink 清掉，从而留在房间里）
    const link = this.coopLink;
    this.coopLink = null;
    if (link) link.leave();
    this.releaseWakeLock();
    // 中途退出：停止计时并发送答题
    if (this.matchLive) {
      this.matchLive = false;
      void online.matchEnded();
    }
    this.paused = false;
    this.pauseSub = false;
    this.resultsOn = false;
    this.pendingBuy = false;
    this.buyMenu.reset();
    this.hud.detach();
    this.overlay.classList.add('is-hidden');
    this.overlay.replaceChildren();
    this.input.wantLock = false;
    this.input.gameplay = false;
    this.input.exitLock();
    this.touch.update(null, false);
    if (m) {
      try {
        m.dispose();
      } catch (err) {
        console.error(err);
      }
    }
    this.idleBuilt = false;
  }

  /** 由主循环每帧调用：处理按键、推进对局、刷新 HUD */
  tick(dt: number): void {
    const m = this.match;
    if (!m) return;
    this.pollKeys(m);
    const menuOpen = this.paused || this.buyMenu.isOpen || this.resultsOn;
    const touch = this.input.touchMode;
    // 触屏模式据此判定玩家输入是否生效（桌面看指针锁定）
    this.input.gameplay = !menuOpen && m.phase !== 'over';
    this.touch.update(m, touch && this.input.gameplay);
    // 合作模式：别人还在打，打开暂停菜单时对局照常进行（输入已被关掉：gameplay = false、指针已解锁）
    const coop = !!this.coopLink || !!m.coop;
    if ((!this.paused || coop) && !this.resultsOn) m.update(dt);
    if (this.match !== m) return;
    if (this.buyMenu.isOpen) this.buyMenu.refresh();
    this.hud.update(m, dt, {
      active: this.input.active,
      touch,
      menuOpen: this.paused || this.buyMenu.isOpen || this.resultsOn,
      scoreboard: actDown(this.input, 'score') || (touch && this.touch.scoreOn),
    });
  }

  private pollKeys(m: Match): void {
    if (this.paused || this.resultsOn) return;
    if (actHit(this.input, 'buy') && m.phase === 'buy') {
      if (this.buyMenu.isOpen) this.hideBuy();
      else {
        audio.ui('open');
        this.openBuy();
      }
    }
  }

  /** 收起购买菜单，在出生点自由活动（B 键或菜单里的按钮） */
  private hideBuy(): void {
    if (!this.buyMenu.isOpen) return;
    this.buyMenu.close();
    this.input.wantLock = true;
    // 桌面：必须在按键 / 点击回调中同步调用才能锁定指针；触屏为空操作
    this.input.requestLock();
  }

  /** 当前能否打开暂停菜单 */
  private canPause(): boolean {
    const m = this.match;
    return !!m && !this.paused && !this.buyMenu.isOpen && !this.resultsOn && m.phase !== 'over';
  }

  private deploy(): void {
    const m = this.match;
    if (!m) return;
    m.beginLive();
    if (this.buyMenu.isOpen) this.buyMenu.close();
    this.input.wantLock = true;
    // 必须在点击回调中同步调用，才能获得指针锁定
    this.input.requestLock();
  }

  // ------------------------------------------------------------ 指针锁定与暂停

  private onLock(locked: boolean): void {
    const m = this.match;
    if (!m) return;
    if (!locked && !this.paused && !this.buyMenu.isOpen && !this.resultsOn && m.phase !== 'over') this.openPause();
    if (locked && this.paused) this.closePause();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code !== 'Escape') return;
    if (document.querySelector('.modal')) return;
    const m = this.match;
    if (!m) {
      this.screen?.onBack?.();
      return;
    }
    if (this.resultsOn || this.buyMenu.isOpen) return;
    if (this.paused) {
      if (this.pauseSub) this.renderPause();
      else if (performance.now() - this.pauseAt > 400) this.resume();
    } else if (!this.input.locked && m.phase !== 'over') this.openPause();
  }

  private openPause(): void {
    this.paused = true;
    // 合作模式里对局并没有停：照常计游戏时间
    if (!this.coopLink) online.matchPaused(true);
    this.touch.reset();
    this.pauseAt = performance.now();
    this.input.wantLock = false;
    this.renderPause();
  }

  private renderPause(): void {
    const m = this.match;
    if (!m) return;
    this.pauseSub = false;
    const wrap = h('div', 'pause');
    const p = h('div', 'panel pause-panel');
    const l = m.level;
    let confirmT = 0;
    const coop = !!this.coopLink;
    const exit = btn(coop ? '离开对局' : '退出关卡', 'menu-item danger', () => {
      const now = performance.now();
      if (now - confirmT < 3000) {
        audio.ui('click');
        if (coop) this.leaveCoop();
        else this.nav.levels();
        return;
      }
      confirmT = now;
      audio.ui('deny');
      exit.querySelector('.menu-hint')!.textContent = coop ? (m.coop?.versus ? '电脑会接替你 · 再点一次确认' : '队友会继续打 · 再点一次确认') : '本局进度不会保存 · 再点一次确认';
      exit.classList.add('is-armed');
    });
    exit.append(h('span', 'menu-hint', coop ? '回到合作模式大厅' : '返回选关界面'));
    const items: [string, string, () => void][] = [
      [
        '继续',
        '回到战斗',
        () => {
          audio.ui('click');
          this.resume();
        },
      ],
      [
        '设置',
        '灵敏度 · 视野 · 音量 · 画质',
        () => {
          audio.ui('click');
          this.pauseSubScreen(settingsScreen(() => this.renderPause(), this.stage, this.input.touchMode));
        },
      ],
      [
        '操作说明',
        '按键与奥数规则',
        () => {
          audio.ui('click');
          this.pauseSubScreen(helpScreen(() => this.renderPause(), this.input.touchMode));
        },
      ],
    ];
    const menu = h('nav', 'title-menu pause-menu');
    items.forEach(([label, hint, fn], i) => {
      const b = btn(label, 'menu-item' + (i === 0 ? ' is-primary' : ''), fn);
      b.style.setProperty('--i', String(i));
      b.append(h('span', 'menu-hint', hint));
      menu.append(b);
    });
    exit.style.setProperty('--i', '3');
    menu.append(exit);
    p.append(
      add(h('div', 'pause-head'), emblem('emblem pause-emblem'), add(h('div', ''), h('div', 'screen-kicker', `${coop ? (m.coop?.versus ? '联机对战 · ' : '合作模式 · ') : ''}${l.subtitle} · ${l.name}`), h('h2', 'screen-h', coop ? '菜单' : '已暂停'))),
      h('div', 'pause-score', `比分 ${m.score[0]} : ${m.score[1]} · 第 ${m.round} 回合${coop ? (m.coop?.versus ? ' · 对局没有暂停，大家还在战斗' : ' · 对局没有暂停，队友还在战斗') : ''}`),
      menu,
    );
    wrap.append(p);
    this.overlay.replaceChildren(wrap);
    this.overlay.classList.remove('is-hidden');
  }

  private pauseSubScreen(el: ScreenEl): void {
    this.pauseSub = true;
    el.classList.add('in-overlay');
    this.overlay.replaceChildren(el);
    const fresh = unlockedMapIds().filter((id) => !this.mapsBefore.includes(id));
    if (fresh.length) {
      const names = fresh.map((id) => LAYOUTS.find((d) => d.id === id)?.name ?? id).join('、');
      this.notice(`解锁新地图：${names}！可以在关卡简报里选用`);
    }
  }

  private resume(): void {
    this.closePause();
    // 合作模式：菜单打开期间进入了准备阶段，关菜单时已经打开了购买菜单
    if (this.buyMenu.isOpen) return;
    this.input.wantLock = true;
    this.input.requestLock();
  }

  private closePause(): void {
    this.paused = false;
    if (!this.coopLink) online.matchPaused(false);
    this.pauseSub = false;
    this.overlay.classList.add('is-hidden');
    this.overlay.replaceChildren();
    // 合作模式：菜单打开期间到了准备阶段，现在补开购买菜单
    const m = this.match;
    if (this.pendingBuy && m) {
      this.pendingBuy = false;
      if (m.phase === 'buy') this.openBuy();
    }
  }

  // ------------------------------------------------------------ MatchUI

  killFeed(killer: Combatant | null, victim: Combatant, head: boolean, weapon: string): void {
    this.hud.killFeed(killer, victim, head, weapon);
  }

  banner(text: string, sub: string, kind: 'win' | 'lose' | 'info', dur?: number): void {
    this.hud.banner(text, sub, kind, dur);
  }

  toast(text: string): void {
    this.hud.toast(text);
  }

  hitMarker(head: boolean, kill: boolean): void {
    this.hud.hitMarker(head, kill);
  }

  killPop(k: KillPopInfo): void {
    this.hud.killPop(k);
  }

  damageFrom(angle: number): void {
    this.hud.damageFrom(angle);
  }

  flash(amount: number): void {
    this.hud.flashScreen(amount);
  }

  openBuy(): void {
    // Match 构造函数里就会调用，此时 this.match 尚未赋值
    if (!this.match) {
      this.pendingBuy = true;
      return;
    }
    // 合作模式里菜单打开时对局照常进行：等关掉菜单再打开购买菜单
    if (this.paused) {
      this.pendingBuy = true;
      return;
    }
    const m = this.match;
    // 每回合准备阶段开始时发放任务奖励（已完成任务的 bonusCredits；暂定规则）
    if (m.round !== this.bonusRound) {
      this.bonusRound = m.round;
      const bonus = online.taskBonusCredits();
      if (bonus > 0) {
        m.player.credits = Math.min(RULES.maxCredits, m.player.credits + bonus);
        this.hud.toast(`任务奖励 +${bonus}`);
      }
    }
    this.buyMenu.open(m);
    this.input.wantLock = false;
    this.input.exitLock();
  }

  closeBuy(): void {
    this.pendingBuy = false;
    this.buyMenu.close();
    if (!this.paused) this.input.wantLock = true;
  }

  answered(e: AnswerEvent): void {
    online.logAnswer({ q: e.q, correct: e.correct, context: e.context, ms: e.ms, levelId: e.levelId, customId: e.customId });
  }

  roundOver(): void {
    online.roundEnded();
  }

  matchEnd(r: MatchResult): void {
    this.matchLive = false;
    void online.matchEnded(r);
    const m = this.match;
    const l = this.level ?? m?.level;
    if (!l) return;
    this.resultsOn = true;
    this.paused = false;
    this.buyMenu.close();
    this.input.wantLock = false;
    this.input.exitLock();
    const coop = !!this.coopLink || !!r.coop;
    const nx = !coop && r.stars > 0 ? nextLevel(l) : null;
    const el = resultsScreen(r, l, {
      next: nx ? () => void this.requestStart(nx.id, save.agent) : null,
      retry: () => void this.requestStart(l.id, save.agent),
      levels: () => this.nav.levels(),
      coop: coop ? { again: () => this.coopAgain(), leave: () => this.leaveCoop() } : undefined,
    });
    this.overlay.replaceChildren(el);
    this.overlay.classList.remove('is-hidden');
  }
}
