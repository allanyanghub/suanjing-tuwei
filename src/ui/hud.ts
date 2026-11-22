/** 局内 HUD：所有元素在 attach 时创建一次，之后每帧只做带缓存的写入 */
import type { FocusQuiz, Match } from '../game/match.ts';
import type { Combatant } from '../game/combatant.ts';
import { CLASS_NAMES, NADE_ORDER, WEAPONS, hasScope, type WeaponKind } from '../data/defs.ts';
import { keyOf } from '../data/controls.ts';
import type { Question } from '../math/types.ts';
export interface KillPopInfo {
  /** 本回合第几杀 */
  streak: number;
  head: boolean;
  /** 本回合把敌人全部击杀 */
  ace: boolean;
  /** 击杀奖励信用点 */
  bonus: number;
  /** 敌方人数（圆点个数） */
  total: number;
}

import { type Bind, add, bind, creditIcon, fmtNum, fmtTime, h, hexCss, keycap, pulse, reducedMotion, spikeIcon } from './dom.ts';
import { Minimap } from './minimap.ts';
import { figureBox, setFigure } from './quiz.ts';

/** 握持类别的中文名（旧接口） */
export const KIND_NAMES: Record<WeaponKind, string> = {
  pistol: '手枪',
  smg: '冲锋枪',
  shotgun: '霰弹枪',
  rifle: '步枪',
  sniper: '狙击枪',
};

const FOCUS_TITLE: Record<FocusQuiz['kind'], string> = {
  plant: '安装熵核 · 解题',
  defuse: '拆除熵核 · 解题',
  revive: '演算复活',
};

interface FeedItem {
  el: HTMLElement;
  t: number;
}
interface Arc {
  b: Bind;
  angle: number;
  t: number;
}
interface Toast {
  el: HTMLElement;
  t: number;
}
interface AbilityUI {
  root: Bind;
  pips: Bind[];
}
interface PipUI {
  c: Combatant;
  b: Bind;
}
interface ScoreRow {
  c: Combatant;
  root: Bind;
  kd: Bind;
  cr: Bind | null;
  st: Bind;
}

export interface HudState {
  /** 玩家输入生效中（桌面：指针已锁定；触屏：对局进行中） */
  active: boolean;
  /** 触屏模式（解题提示等文案不同，且不显示“点击画面继续”） */
  touch: boolean;
  /** 购买 / 暂停 / 结算等菜单打开中 */
  menuOpen: boolean;
  scoreboard: boolean;
}

export class Hud {
  root = h('div', 'hud is-hidden');
  private rootB = bind(this.root);
  private minimap = new Minimap();
  private m: Match | null = null;
  private time = 0;

  // 顶部
  private scoreA = bind(h('div', 'tb-score'));
  private scoreB = bind(h('div', 'tb-score'));
  private pipsA = h('div', 'tb-pips');
  private pipsB = h('div', 'tb-pips');
  private pips: PipUI[] = [];
  private timerBox = bind(h('div', 'tb-timer'));
  private timerTxt = bind(h('span', 'tb-time'));
  private timerIco = bind(h('span', 'tb-spike'));
  private sideTxt = bind(h('div', 'tb-sub'));

  // 左下
  private hpNum = bind(h('div', 'vit-num'));
  private hpFill = bind(h('div', 'vit-fill'));
  private hpBox = bind(h('div', 'vit hp'));
  private arNum = bind(h('div', 'vit-num sm'));
  private arFill = bind(h('div', 'vit-fill'));
  private credits = bind(h('span', 'cr-num'));
  private spikeChip = bind(h('div', 'chip spike-chip'));

  // 右下
  private wName = bind(h('div', 'wp-name'));
  private wKind = bind(h('div', 'wp-kind'));
  private wMag = bind(h('span', 'wp-mag'));
  private wRes = bind(h('span', 'wp-res'));
  private wBox = bind(h('div', 'weapon'));
  private wReload = bind(h('div', 'wp-reload'));
  private wReloadFill = bind(h('div', 'wp-reload-fill'));
  /** 武器栏：按键 1–5 的顺序（主 / 副 / 匕首 / 熵核 / 投掷物） */
  private slotRows: { slot: 0 | 1 | 2 | 3 | 4; b: Bind; name: Bind }[] = [];
  private promptKey = bind(keycap('F', 'prompt-key'));

  // 技能
  private abQ!: AbilityUI;
  private abE!: AbilityUI;
  private abX!: AbilityUI;
  private abBar = h('div', 'abilities');

  // 中央
  private xhair = bind(h('div', 'xhair'));
  private hitm = h('div', 'hitmark');
  /** 击杀图标（屏幕中下方弹出） */
  private kpop = h('div', 'killpop');
  private scope = bind(h('div', 'scope'));
  private flash = bind(h('div', 'fx-flash'));
  private lowhp = bind(h('div', 'fx-lowhp'));
  private slowmo = bind(h('div', 'fx-slowmo'));
  private arcs: Arc[] = [];
  private flashAmt = 0;
  private prompt = bind(h('div', 'prompt'));
  private promptTxt = bind(h('span', 'prompt-txt'));
  private unlockHint = bind(h('div', 'unlock-hint'));
  private deadChip = bind(h('div', 'dead-chip'));

  // 事件类
  private feed = h('div', 'killfeed');
  private feedItems: FeedItem[] = [];
  private bannerEl = h('div', 'banner');
  private bannerText = h('div', 'bn-text');
  private bannerSub = h('div', 'bn-sub');
  private bannerT = 0;
  private toastWrap = h('div', 'toasts');
  private toasts: Toast[] = [];

  // 解题面板
  private focusEl = h('div', 'focus');
  private focusB = bind(this.focusEl);
  private fTitle = h('div', 'focus-title');
  private fSub = bind(h('div', 'focus-sub'));
  private fText = h('div', 'focus-q');
  private fFig = figureBox('focus-fig');
  private fOpts: { root: HTMLElement; txt: HTMLElement }[] = [];
  private fResult = bind(h('div', 'focus-result'));
  private fResHead = h('div', 'fr-head');
  private fExplain = h('div', 'fr-explain');
  private fBar = bind(h('div', 'fr-fill'));
  private fKey = '';
  private fTouch = false;
  private fQ: Question | null = null;

  // 计分板
  private board = bind(h('div', 'scoreboard'));
  private boardRows: ScoreRow[] = [];
  private boardA = h('div', 'sb-team ally');
  private boardB = h('div', 'sb-team enemy');
  private boardTitle = bind(h('div', 'sb-title'));

  constructor() {
    const R = this.root;
    // 首帧更新前先隐藏条件性元素
    for (const b of [this.scope, this.lowhp, this.prompt, this.deadChip, this.unlockHint, this.board, this.wReload, this.spikeChip, this.timerIco])
      b.el.classList.add('is-hidden');
    // 顶部比分条
    const top = h('div', 'topbar');
    // 触屏：点比分条打开 / 关闭计分板；点武器栏换枪；点交互提示安装 / 拆除（见 touch.ts）
    top.dataset.act = 'score';
    this.timerIco.el.append(spikeIcon());
    this.timerBox.el.append(this.timerIco.el, this.timerTxt.el);
    top.append(
      add(h('div', 'tb-side ally'), this.scoreA.el, this.pipsA),
      add(h('div', 'tb-center'), this.timerBox.el, this.sideTxt.el),
      add(h('div', 'tb-side enemy'), this.pipsB, this.scoreB.el),
    );

    // 左上小地图
    const tl = h('div', 'hud-tl');
    tl.append(this.minimap.root);
    // 触屏：点小地图放大 / 还原
    this.minimap.root.dataset.act = 'map';

    // 左下生命
    const bl = h('div', 'hud-bl');
    const cr = h('div', 'chip cr-chip');
    cr.append(creditIcon(), this.credits.el);
    this.spikeChip.el.append(spikeIcon(), h('span', '', '你携带着熵核 · 前往 A / B 点安装'));
    const hpBar = h('div', 'vit-bar');
    hpBar.append(this.hpFill.el);
    this.hpBox.el.append(add(h('div', 'vit-ico'), crossIcon()), this.hpNum.el, hpBar);
    const arBar = h('div', 'vit-bar');
    arBar.append(this.arFill.el);
    const ar = add(h('div', 'vit armor'), add(h('div', 'vit-ico'), shieldIcon()), this.arNum.el, arBar);
    bl.append(this.spikeChip.el, cr, add(h('div', 'vitals'), this.hpBox.el, ar));

    // 右下武器
    const br = h('div', 'hud-br');
    br.dataset.act = 'swap';
    const slotWrap = h('div', 'wp-slots');
    const rows: [0 | 1 | 2 | 3 | 4, string][] = [
      [0, keyOf('slot1')],
      [1, keyOf('slot2')],
      [2, keyOf('slot3')],
      [4, keyOf('slot4')],
      [3, keyOf('slot5')],
    ];
    for (const [slot, key] of rows) {
      const el = h('div', 'wp-slot');
      const name = bind(h('span', 'ws-name'));
      el.append(keycap(key, 'ws-key'), name.el);
      slotWrap.append(el);
      this.slotRows.push({ slot, b: bind(el), name });
    }
    this.wReload.el.append(h('span', 'wr-txt', '换弹中'), add(h('div', 'wr-bar'), this.wReloadFill.el));
    this.wBox.el.append(
      slotWrap,
      add(h('div', 'wp-main'), add(h('div', 'wp-id'), this.wName.el, this.wKind.el), add(h('div', 'wp-ammo'), this.wMag.el, this.wRes.el)),
      this.wReload.el,
    );
    br.append(this.wBox.el);

    // 底部技能
    const bc = h('div', 'hud-bc');
    bc.append(this.abBar);

    // 准星
    const xh = this.xhair.el;
    for (const d of ['t', 'b', 'l', 'r']) xh.append(h('i', 'xh-ln xh-' + d));
    xh.append(h('i', 'xh-dot'));
    for (let i = 0; i < 4; i++) this.hitm.append(h('i', 'hm-l hm-' + i));
    const scopeEl = this.scope.el;
    scopeEl.append(h('div', 'scope-ring'), h('i', 'scope-h'), h('i', 'scope-v'), h('i', 'scope-dot'));
    const arcWrap = h('div', 'dmg-arcs');
    for (let i = 0; i < 5; i++) {
      const a = h('div', 'dmg-arc');
      a.append(h('i', ''));
      arcWrap.append(a);
      this.arcs.push({ b: bind(a), angle: 0, t: 0 });
    }
    this.prompt.el.append(this.promptKey.el, this.promptTxt.el);
    this.prompt.el.dataset.act = 'f';
    this.unlockHint.el.append(h('div', 'uh-main', '点击画面继续'), h('div', 'uh-sub', '鼠标将被锁定以控制视角 · 按 Esc 可暂停'));
    this.deadChip.el.append(h('span', 'dc-main', '你已阵亡'), h('span', 'dc-sub', '正在观战，等待回合结束'));

    // 横幅
    this.bannerEl.append(h('i', 'bn-line l'), add(h('div', 'bn-body'), this.bannerText, this.bannerSub), h('i', 'bn-line r'));

    // 解题面板
    const fHead = h('div', 'focus-head');
    fHead.append(add(h('div', 'focus-badge'), spikeIcon()), this.fTitle, this.fSub.el);
    const fOpts = h('div', 'focus-opts');
    for (let i = 0; i < 4; i++) {
      const o = h('div', 'focus-opt');
      o.dataset.act = 'a' + i;
      const t = h('span', 'opt-text');
      o.append(keycap(String(i + 1), 'opt-key'), t);
      fOpts.append(o);
      this.fOpts.push({ root: o, txt: t });
    }
    const frBar = h('div', 'fr-bar');
    frBar.append(this.fBar.el);
    this.fResult.el.append(this.fResHead, this.fExplain, frBar);
    this.focusEl.append(fHead, this.fText, this.fFig, fOpts, this.fResult.el);
    this.focusEl.dataset.act = 'none';

    // 计分板
    this.board.el.append(this.boardTitle.el, this.boardA, this.boardB);
    this.board.el.dataset.act = 'score';

    R.append(
      this.flash.el,
      this.lowhp.el,
      this.slowmo.el,
      this.scope.el,
      top,
      tl,
      this.feed,
      bl,
      bc,
      br,
      arcWrap,
      this.xhair.el,
      this.hitm,
      this.kpop,
      this.prompt.el,
      this.deadChip.el,
      this.bannerEl,
      this.toastWrap,
      this.focusEl,
      this.unlockHint.el,
      this.board.el,
    );
  }

  // ------------------------------------------------------------ 绑定 / 解绑

  attach(m: Match): void {
    this.m = m;
    this.time = 0;
    this.fKey = '';
    this.fQ = null;
    this.flashAmt = 0;
    this.bannerT = 0;
    this.bannerEl.classList.remove('is-in');
    this.feed.replaceChildren();
    this.feedItems = [];
    this.toastWrap.replaceChildren();
    this.toasts = [];
    for (const a of this.arcs) a.t = 0;

    // 存活点
    this.pipsA.replaceChildren();
    this.pipsB.replaceChildren();
    this.pips = [];
    for (const c of m.combatants) {
      const p = h('i', 'pip');
      if (c.isPlayer) p.classList.add('is-me');
      (c.team === 0 ? this.pipsA : this.pipsB).append(p);
      this.pips.push({ c, b: bind(p) });
    }

    // 技能栏
    const ag = m.player.agent;
    this.root.style.setProperty('--agent', hexCss(ag.color));
    this.abBar.replaceChildren();
    const mk = (key: string, icon: string, name: string, n: number, ult: boolean): AbilityUI => {
      const r = h('div', 'ab' + (ult ? ' ult' : ''));
      r.dataset.act = ult ? 'x' : key === keyOf('abilityQ') ? 'q' : 'e';
      const pipWrap = h('div', 'ab-pips');
      const pips: Bind[] = [];
      for (let i = 0; i < n; i++) {
        const p = h('i', 'ab-pip');
        pipWrap.append(p);
        pips.push(bind(p));
      }
      r.append(add(h('div', 'ab-face'), h('span', 'ab-glyph', icon)), keycap(key, 'ab-k'), h('div', 'ab-label', name), pipWrap);
      this.abBar.append(r);
      return { root: bind(r), pips };
    };
    this.abQ = mk(keyOf('abilityQ'), ag.q.icon, ag.q.name, ag.q.charges, false);
    this.abE = mk(keyOf('abilityE'), ag.e.icon, ag.e.name, ag.e.charges, false);
    this.abX = mk(keyOf('ult'), ag.x.icon, ag.x.name, ag.ultCost, true);

    // 计分板行
    this.boardA.replaceChildren();
    this.boardB.replaceChildren();
    this.boardRows = [];
    const head = (team: 0 | 1) =>
      add(
        h('div', 'sb-row sb-head'),
        // 联机对战：带上队伍名（我方 · 红队）
        h('span', 'sb-name', (team === 0 ? '我方' : '敌方') + (m.coop?.versus ? ' · ' + m.coop.teamName(team) : '')),
        h('span', 'sb-agent', '角色'),
        h('span', 'sb-kd', '击败 / 阵亡'),
        h('span', 'sb-cr', team === 0 ? '信用点' : ''),
        h('span', 'sb-st', '状态'),
      );
    this.boardA.append(head(0));
    this.boardB.append(head(1));
    for (const c of m.combatants) {
      const row = h('div', 'sb-row' + (c.isPlayer ? ' is-me' : ''));
      row.style.setProperty('--ac', hexCss(c.agent.color));
      const kd = h('span', 'sb-kd');
      const crEl = h('span', 'sb-cr');
      const st = h('span', 'sb-st');
      row.append(add(h('span', 'sb-name'), h('i', 'sb-dot'), c.name), h('span', 'sb-agent', c.agent.name), kd, crEl, st);
      (c.team === 0 ? this.boardA : this.boardB).append(row);
      this.boardRows.push({ c, root: bind(row), kd: bind(kd), cr: c.team === 0 ? bind(crEl) : null, st: bind(st) });
    }
    this.rootB.show(true);
  }

  detach(): void {
    this.m = null;
    this.rootB.show(false);
    this.focusB.cls('is-in', false);
  }

  // ------------------------------------------------------------ 事件（MatchUI 转发）

  killFeed(killer: Combatant | null, victim: Combatant, head: boolean, weapon: string): void {
    const e = h('div', 'kf');
    if (killer === this.m?.player || victim === this.m?.player) e.classList.add('is-me');
    if (killer && killer !== victim) e.append(h('span', 'kf-name ' + (killer.team === 0 ? 'ally' : 'enemy'), killer.name));
    const w = h('span', 'kf-weapon', weapon);
    e.append(w);
    if (head) e.append(h('span', 'kf-head', '爆头'));
    e.append(h('span', 'kf-name ' + (victim.team === 0 ? 'ally' : 'enemy'), victim.name));
    this.feed.prepend(e);
    this.feedItems.unshift({ el: e, t: 5 });
    while (this.feedItems.length > 6) this.feedItems.pop()!.el.remove();
  }

  banner(text: string, sub: string, kind: 'win' | 'lose' | 'info', dur = 2.6): void {
    this.bannerText.textContent = text;
    this.bannerSub.textContent = sub;
    this.bannerEl.className = 'banner kind-' + kind + ' is-in';
    // 重新触发入场动画（仅在事件发生时执行一次）
    pulse(this.bannerEl, [{ opacity: 0, transform: 'translate(-50%, -0.6rem) scaleX(0.86)', letterSpacing: '0.5em' }, { opacity: 1, transform: 'translate(-50%, 0) scaleX(1)' }], {
      duration: reducedMotion() ? 1 : 420,
      easing: 'cubic-bezier(.2,.9,.25,1)',
    });
    this.bannerT = dur;
  }

  toast(text: string): void {
    const e = h('div', 'toast', text);
    this.toastWrap.append(e);
    this.toasts.push({ el: e, t: 2.8 });
    while (this.toasts.length > 3) this.toasts.shift()!.el.remove();
  }

  hitMarker(head: boolean, kill: boolean): void {
    this.hitm.className = 'hitmark' + (kill ? ' kill' : '') + (head ? ' head' : '');
    pulse(
      this.hitm,
      [
        { opacity: 1, transform: `translate(-50%,-50%) scale(${kill ? 1.35 : head ? 1.2 : 1})` },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.35 },
        { opacity: 0, transform: 'translate(-50%,-50%) scale(1)' },
      ],
      { duration: kill ? 520 : 300, easing: 'ease-out' },
    );
  }

  /** 本人击杀：屏幕中下方弹出击杀图标（连杀逐级升级），下面一排圆点 = 本回合击杀数 / 敌人数 */
  killPop(k: KillPopInfo): void {
    const n = Math.max(1, Math.min(5, k.streak));
    const title = k.ace ? '团灭' : n === 1 ? (k.head ? '爆头' : '击杀') : ['', '', '双杀', '三杀', '四杀', '五杀'][n];
    const tier = k.ace ? 6 : n;
    const el = this.kpop;
    el.className = `killpop tier-${tier}${k.head ? ' is-head' : ''}${k.ace ? ' is-ace' : ''}`;
    const icon = h('div', 'kp-icon');
    icon.innerHTML =
      '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" stroke-width="6"/>' +
      '<circle cx="50" cy="50" r="9" fill="currentColor"/>' +
      '<path d="M50 4v20M50 76v20M4 50h20M76 50h20" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>' +
      (k.head ? '<path d="M28 18 L50 6 L72 18" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>' : '') +
      '</svg>';
    const tags = h('div', 'kp-tags');
    if (k.head && (n > 1 || k.ace)) tags.append(h('span', 'kp-tag head', '爆头'));
    if (k.ace) tags.append(h('span', 'kp-tag ace', 'ACE'));
    const pips = h('div', 'kp-pips');
    const total = Math.max(k.total, k.streak);
    for (let i = 0; i < Math.min(total, 8); i++) pips.append(h('i', i < k.streak ? 'on' : ''));
    el.replaceChildren(h('div', 'kp-glow'), icon, add(h('div', 'kp-text'), h('div', 'kp-title', title), tags), add(h('div', 'kp-sub'), creditIcon(), `+${k.bonus}`), pips);
    if (reducedMotion()) {
      pulse(el, [{ opacity: 1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 1800 });
      return;
    }
    const big = 1 + tier * 0.06;
    pulse(
      el,
      [
        // 缓动写在每一段上（写在整段动画上会把"停留"压得很短）
        { opacity: 0, transform: `translate(-50%, 0) scale(${2.2 * big})`, easing: 'cubic-bezier(.2,.9,.25,1)' },
        { opacity: 1, transform: `translate(-50%, 0) scale(${0.92 * big})`, offset: 0.08, easing: 'ease-out' },
        { opacity: 1, transform: `translate(-50%, 0) scale(${big})`, offset: 0.14 },
        { opacity: 1, transform: `translate(-50%, 0) scale(${big})`, offset: 0.8, easing: 'ease-in' },
        { opacity: 0, transform: `translate(-50%, -0.8rem) scale(${big * 0.96})` },
      ],
      { duration: k.ace ? 2600 : 1700 },
    );
  }

  damageFrom(angle: number): void {
    let slot = this.arcs[0];
    for (const a of this.arcs) if (a.t < slot.t) slot = a;
    slot.angle = angle;
    slot.t = 1.3;
  }

  flashScreen(amount: number): void {
    this.flashAmt = Math.max(this.flashAmt, Math.min(1, amount));
  }

  // ------------------------------------------------------------ 每帧

  update(m: Match, dt: number, st: HudState): void {
    this.time += dt;
    const me = m.player;
    const live = m.phase === 'live' || m.phase === 'planted';
    this.rootB.cls('is-menu', st.menuOpen);

    // 顶部
    this.scoreA.text(m.score[0]);
    this.scoreB.text(m.score[1]);
    for (const p of this.pips) p.b.cls('is-dead', !p.c.alive);
    const planted = m.phase === 'planted';
    this.timerBox.cls('is-spike', planted);
    this.timerIco.show(planted);
    if (planted) {
      const t = Math.max(0, m.spike.timer);
      this.timerTxt.text(t < 10 ? t.toFixed(1) : fmtTime(t));
      this.timerBox.cls('is-urgent', t < 10);
    } else {
      this.timerBox.cls('is-urgent', m.phase === 'live' && m.phaseT < 10);
      this.timerTxt.text(m.phase === 'buy' ? (m.coop?.selfReady ? '等待' : '准备') : m.phase === 'live' ? fmtTime(m.phaseT) : m.phase === 'end' ? '结束' : '—');
    }
    this.sideTxt.text(`第 ${m.round} 回合 · ${m.coop?.versus ? m.coop.teamName(0) + ' · ' : ''}${m.playerSide === 'attack' ? '进攻方' : '防守方'}`);
    this.sideTxt.cls('is-def', m.playerSide === 'defend');

    // 生命 / 护甲 / 信用点
    const hp = Math.max(0, Math.ceil(me.hp));
    this.hpNum.text(hp);
    this.hpFill.style('transform', `scaleX(${(Math.max(0, me.hp) / 100).toFixed(3)})`);
    this.hpBox.cls('is-low', hp <= 30 && me.alive);
    const ar = Math.max(0, Math.ceil(me.armor));
    this.arNum.text(ar);
    this.arFill.style('transform', `scaleX(${Math.min(1, me.armor / 50).toFixed(3)})`);
    this.credits.text(fmtNum(me.credits));
    this.spikeChip.show(me.hasSpike && me.alive);

    // 武器
    const w = me.weapon;
    const cls = w.def.cls;
    this.wName.text(w.def.name);
    this.wKind.text(CLASS_NAMES[cls]);
    const noAmmo = cls === 'melee' || cls === 'spike';
    this.wMag.text(noAmmo ? '—' : w.mag);
    this.wRes.text(noAmmo ? '' : cls === 'throwable' ? `/ ${w.def.nade!.max}` : '/ ' + w.reserve);
    this.wBox.cls('is-empty', !noAmmo && w.mag === 0);
    this.wBox.cls('is-low', !noAmmo && cls !== 'throwable' && w.mag > 0 && w.mag <= Math.ceil(w.def.mag * 0.25));
    const reloading = w.reloadT > 0;
    this.wReload.show(reloading);
    if (reloading) this.wReloadFill.style('transform', `scaleX(${(1 - w.reloadT / w.def.reload).toFixed(3)})`);
    for (const r of this.slotRows) {
      const has = me.hasSlot(r.slot);
      r.b.show(has);
      r.b.cls('is-active', me.slot === r.slot || (r.slot === 1 && me.slot === 0 && !me.slots[0]));
      if (!has) continue;
      if (r.slot === 0) r.name.text(me.slots[0]!.def.name);
      else if (r.slot === 1) r.name.text(me.slots[1].def.name);
      else if (r.slot === 2) r.name.text(me.slots[2].def.name);
      else if (r.slot === 4) r.name.text('熵核');
      else {
        const k = me.nades.pili * 100 + me.nades.yanwu * 10 + me.nades.shanguang + (me.slot === 3 ? 1000 * (1 + NADE_ORDER.indexOf(me.nadeSel)) : 0);
        if (k !== this.nadeKey) {
          this.nadeKey = k;
          r.name.text(this.nadeText(me));
        }
      }
    }

    // 技能
    this.abilityState(this.abQ, me.chargeQ, me.alive);
    this.abilityState(this.abE, me.chargeE, me.alive);
    this.abilityState(this.abX, me.ult, me.alive);
    const ready = me.ult >= me.agent.ultCost;
    this.abX.root.cls('is-ready', ready && me.alive);

    // 准星 / 开镜
    const scoped = me.alive && hasScope(w.def) && me.ads > 0.8;
    this.scope.show(scoped);
    const showX = me.alive && st.active && !scoped && !st.menuOpen;
    this.xhair.show(showX);
    if (showX) {
      // 准星间隙 = 真实散布在屏幕上的半径（与弹道一致）
      const px = Math.max(3, Math.min(90, m.playerCtl.crosshairPx));
      this.xhair.style('--gap', `${px.toFixed(0)}px`);
    }
    this.minimap.setBig(m.playerCtl.mapBig);

    // 闪光 / 低血量 / 子弹时间
    this.flashAmt = Math.max(0, this.flashAmt - dt * 0.9);
    const ft = me.alive ? Math.min(1, me.flashT / 0.9) : 0;
    const fl = Math.max(this.flashAmt, ft);
    this.flash.style('opacity', fl.toFixed(2));
    const low = me.alive && me.hp < 40 ? (40 - me.hp) / 40 : 0;
    this.lowhp.style('opacity', (0.35 + low * 0.65).toFixed(2));
    this.lowhp.show(low > 0);
    this.slowmo.cls('is-on', m.timeScale < 0.6);

    // 受击方向（换算到屏幕：yaw=0 朝 -Z，右方向 = (cos yaw, -sin yaw)）
    for (const a of this.arcs) {
      if (a.t <= 0) {
        a.b.show(false);
        continue;
      }
      a.t -= dt;
      const dx = Math.sin(a.angle),
        dz = Math.cos(a.angle);
      const fwd = dx * -Math.sin(me.yaw) + dz * -Math.cos(me.yaw);
      const right = dx * Math.cos(me.yaw) + dz * -Math.sin(me.yaw);
      const rel = Math.atan2(right, fwd);
      a.b.show(true);
      a.b.style('transform', `rotate(${rel.toFixed(3)}rad)`);
      a.b.style('opacity', Math.min(1, a.t / 0.6).toFixed(2));
    }

    // 交互提示
    const hint = st.menuOpen ? '' : m.interactHint();
    this.prompt.show(!!hint);
    if (hint) {
      this.promptTxt.text(hint);
      // 安装 / 拆除：参考键 4 与 F 都可以；拾取只用 F
      this.promptKey.text(hint.includes('熵核') ? `${keyOf('slot4')} / ${keyOf('use')}` : keyOf('use'));
    }

    // 阵亡提示（有复活题时不显示）
    this.deadChip.show(!me.alive && !m.focus && (live || m.phase === 'end'));

    // 指针未锁定提示
    this.unlockHint.show(!st.touch && !st.active && !st.menuOpen && m.phase !== 'over');

    // 小地图
    this.minimap.update(m, dt);

    // 击杀信息淡出
    for (let i = this.feedItems.length - 1; i >= 0; i--) {
      const f = this.feedItems[i];
      f.t -= dt;
      if (f.t <= 0.5 && !f.el.classList.contains('is-out')) f.el.classList.add('is-out');
      if (f.t <= 0) {
        f.el.remove();
        this.feedItems.splice(i, 1);
      }
    }
    // 横幅
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.bannerEl.classList.remove('is-in');
    }
    // 小提示
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      t.t -= dt;
      if (t.t <= 0.4 && !t.el.classList.contains('is-out')) t.el.classList.add('is-out');
      if (t.t <= 0) {
        t.el.remove();
        this.toasts.splice(i, 1);
      }
    }

    if (st.touch !== this.fTouch) {
      this.fTouch = st.touch;
      this.fKey = '';
    }
    this.updateFocus(m.focus, st.menuOpen);

    // 计分板
    this.board.show(st.scoreboard && !st.menuOpen);
    if (st.scoreboard && !st.menuOpen) {
      this.boardTitle.text(`比分 ${m.score[0]} : ${m.score[1]} · 第 ${m.round} 回合 · 先赢 ${m.opt.roundsToWin} 回合获胜（打满 ${m.halfLength} 回合交换攻防）`);
      for (const r of this.boardRows) {
        r.root.cls('is-dead', !r.c.alive);
        r.root.cls('has-spike', r.c.hasSpike);
        r.kd.text(`${r.c.kills} / ${r.c.deaths}`);
        // 合作：别人的信用点在他自己的设备上，这里不显示
        r.cr?.text(r.c.remote ? '—' : fmtNum(r.c.credits));
        r.st.text(r.c.alive ? (r.c.hasSpike ? '携带熵核' : '存活') : '阵亡');
      }
    }
  }

  private nadeKey = -1;

  private nadeText(me: Combatant): string {
    let t = '';
    for (const id of NADE_ORDER) {
      const n = me.nades[id];
      if (n <= 0) continue;
      const nm = WEAPONS[id].name;
      const sel = me.slot === 3 && me.nadeSel === id;
      t += (t ? ' ' : '') + (sel ? '▸' : '') + nm + '×' + n;
    }
    return t;
  }

  private abilityState(a: AbilityUI, n: number, alive: boolean): void {
    a.pips.forEach((p, i) => p.cls('on', i < n));
    a.root.cls('is-empty', n <= 0 || !alive);
  }

  // ------------------------------------------------------------ 解题面板

  private updateFocus(f: FocusQuiz | null, hidden: boolean): void {
    const on = !!f && !hidden;
    this.focusB.cls('is-in', on);
    if (!f) {
      this.fKey = '';
      this.fQ = null;
      return;
    }
    const done = f.doneT > 0;
    const locked = f.picked >= 0 && !done;
    const key = `${f.kind}|${f.picked}|${done ? 1 : 0}|${locked ? 1 : 0}|${f.done}|${f.stepT > 0 ? 1 : 0}`;
    if (f.q !== this.fQ || key !== this.fKey) {
      const newQ = f.q !== this.fQ;
      this.fQ = f.q;
      this.fKey = key;
      this.renderFocus(f, done, locked, newQ, on);
    }
    // 动态部分
    if (f.kind === 'revive' && !done && !locked) {
      const left = Math.max(0, Math.ceil(f.timeLeft));
      this.fSub.text(`剩余 ${left} 秒 · ${this.fTouch ? '点选答案' : '按数字键 1–4 作答（解题时数字键不换枪）'}`);
      this.fSub.cls('is-urgent', left <= 10);
    }
    if (locked) this.fBar.style('transform', `scaleX(${Math.max(0, f.lockT / 4.5).toFixed(3)})`);
  }

  private renderFocus(f: FocusQuiz, done: boolean, locked: boolean, newQ: boolean, on: boolean): void {
    const q = f.q;
    // 有配图时：选项都很短就排成一行，给配图多留高度
    const fig = q.figure ? ' has-fig' + (q.options.every((o) => textUnits(o) <= 12) ? ' opts-row' : '') : '';
    this.focusEl.className = 'focus kind-' + f.kind + fig + (done ? ' is-right' : '') + (locked ? ' is-wrong' : '');
    this.focusB = bind(this.focusEl);
    this.focusB.cls('is-in', on);
    this.fTitle.textContent = FOCUS_TITLE[f.kind];
    this.fSub.cls('is-urgent', false);
    const how = this.fTouch ? '点选答案' : '按数字键 1–4 作答（解题时数字键不换枪）';
    const prog = f.need > 1 ? `第 ${Math.min(f.need, f.done + (f.stepT > 0 || done ? 0 : 1))} / ${f.need} 题 · ` : '';
    if (f.kind !== 'revive') this.fSub.text(`${prog}时间已减缓 · ${how} · 移动会中断`);
    else this.fSub.text(`剩余 ${Math.max(0, Math.ceil(f.timeLeft))} 秒 · ${how}`);
    if (newQ) {
      this.fText.textContent = q.text;
      setFigure(this.fFig, q.figure);
      q.options.forEach((o, i) => (this.fOpts[i].txt.textContent = o));
      if (!reducedMotion()) pulse(this.focusEl, [{ transform: 'translate(-50%, 1.2rem)', opacity: 0.2 }, { transform: 'translate(-50%, 0)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1)' });
    }
    this.fOpts.forEach((o, i) => {
      const picked = i === f.picked;
      o.root.className =
        'focus-opt' +
        (done && picked ? ' is-correct' : '') +
        (locked && picked ? ' is-wrong' : '') +
        (locked && i === q.answer ? ' is-correct' : '') +
        ((done || locked) && !picked && i !== q.answer ? ' is-dim' : '');
    });
    const step = f.stepT > 0;
    this.fResult.show(locked || done || step);
    if (step) {
      this.fResHead.textContent = `回答正确！还需要答对 ${f.need - f.done} 题`;
      this.fExplain.textContent = '';
      this.fOpts[f.picked]?.root.classList.add('is-correct');
    } else if (done) {
      this.fResHead.textContent = f.kind === 'plant' ? '回答正确！熵核安装中…' : f.kind === 'defuse' ? '回答正确！正在拆除…' : '回答正确！准备复活…';
      this.fExplain.textContent = '';
    } else if (locked) {
      this.fResHead.textContent =
        `答错了，正确答案是 ${q.options[q.answer]}` + (f.kind === 'revive' ? '' : f.need > 1 ? ` · 已答对的 ${f.done} 题仍然有效，稍后换一道新题` : ' · 稍后换一道新题');
      this.fExplain.textContent = q.explain;
    }
    this.fBar.el.parentElement!.classList.toggle('is-hidden', !locked);
  }
}

/** 粗略的显示宽度：全角字符记 2，其余记 1 */
function textUnits(t: string): number {
  let n = 0;
  for (const ch of t) n += ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
  return n;
}

function crossIcon(): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="currentColor"/>';
  return s;
}

function shieldIcon(): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = '<path d="M12 2 20 5v7c0 5-3.6 8.4-8 10-4.4-1.6-8-5-8-10V5z" fill="currentColor"/>';
  return s;
}

