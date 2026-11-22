/** 准备阶段：军械库（分类 + 退回）+ 解题补给站 + 出击 */
import type { Match } from '../game/match.ts';
import { ARMORS, BUY_CATEGORIES, CLASS_NAMES, NADE_ORDER, RULES, WEAPONS, WEAPON_ORDER, type NadeId, type WeaponDef } from '../data/defs.ts';
import { keyOf } from '../data/controls.ts';
import type { Difficulty } from '../math/types.ts';
import { audio } from '../core/audio.ts';
import { type Bind, add, bind, btn, creditIcon, fmtNum, h, keycap } from './dom.ts';
import { DIFF_NAMES, QuizCard } from './quiz.ts';

interface Card {
  id: string;
  price: number;
  root: Bind;
  state: Bind;
  refund: Bind;
  kind: 'weapon' | 'nade' | 'armor';
  value: number;
  count: Bind | null;
}

const MAX_DMG = 150;
type StepState = 'pending' | 'right' | 'wrong';

function statBar(label: string, v: number): HTMLElement {
  const r = h('div', 'stat');
  const bar = h('div', 'stat-bar');
  const f = h('i', 'stat-fill');
  f.style.setProperty('--v', Math.max(0.04, Math.min(1, v)).toFixed(3));
  bar.append(f);
  r.append(h('span', 'stat-k', label), bar);
  return r;
}

export class BuyMenu {
  root = h('div', 'buy is-hidden');
  private rootB = bind(this.root);
  private m: Match | null = null;
  private roundT = bind(h('div', 'buy-round'));
  private sideT = bind(h('div', 'buy-side'));
  private scoreT = bind(h('div', 'buy-score'));
  private creditT = bind(h('span', 'buy-cr-num'));
  private creditBox = h('div', 'buy-credits');
  private cards: Card[] = [];
  private loadoutT = bind(h('div', 'buy-loadout'));
  private shopEl = h('section', 'buy-shop');
  private catBtns: HTMLButtonElement[] = [];
  private groups: HTMLElement[] = [];

  // 补给站
  private quiz: QuizCard;
  private stepWrap = h('div', 'qs-steps');
  private steps: Bind[] = [];
  private stepState: StepState[] = [];
  private stationHint = h('span', 'sec-hint');
  private introSub = h('div', 'qs-intro-s');
  private quizArea = h('div', 'qs-area');
  private nextBtn: HTMLButtonElement;
  private doneBox = bind(h('div', 'qs-done'));
  private doneTxt = h('div', 'qs-done-txt');
  private intro = bind(h('div', 'qs-intro'));
  private earned = 0;
  private quizRound = -1;
  private current = -1;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private tipDesk = h('span', 'only-desktop');
  private tipTouch = h('span', 'only-touch');

  constructor(
    private onDeploy: () => void,
    private onHide: () => void,
  ) {
    const R = this.root;
    const panel = h('div', 'buy-panel');

    // 头部
    const head = h('header', 'buy-head');
    this.creditBox.append(creditIcon(), this.creditT.el);
    head.append(
      add(h('div', 'buy-title'), h('div', 'screen-kicker', '准备阶段'), h('h2', 'screen-h', '整备')),
      add(h('div', 'buy-meta'), this.roundT.el, this.sideT.el, this.scoreT.el),
      this.creditBox,
    );

    // 左：军械库（分类分组，顶部分类条点击跳到对应分组）
    const shop = this.shopEl;
    shop.append(add(h('div', 'sec-head'), h('span', 'sec-title', '军械库'), h('span', 'sec-hint', '点击购买 · 本回合买的再点一次（或点「退回」）可退款')));
    const cats = h('div', 'buy-cats');
    for (const cat of BUY_CATEGORIES) {
      const b = btn(cat.name, 'buy-cat', () => {
        audio.ui('click');
        this.jumpTo(cat.id);
      });
      b.dataset.cat = cat.id;
      cats.append(b);
      this.catBtns.push(b);
    }
    shop.append(cats);
    const list = h('div', 'buy-groups');
    for (const cat of BUY_CATEGORIES) {
      const g = h('div', 'buy-group');
      g.dataset.cat = cat.id;
      const grid = h('div', 'wp-grid');
      if (cat.cls === 'armor') for (const a of ARMORS) grid.append(this.armorCard(a.id, a.name, a.price, a.value));
      else if (cat.cls === 'throwable') for (const id of NADE_ORDER) grid.append(this.nadeCard(WEAPONS[id]));
      else for (const id of WEAPON_ORDER) if (WEAPONS[id].cls === cat.cls) grid.append(this.weaponCard(WEAPONS[id]));
      g.append(add(h('div', 'bg-head'), h('span', 'bg-title', cat.name), h('span', 'bg-hint', catHint(cat.id))), grid);
      list.append(g);
      this.groups.push(g);
    }
    shop.append(list, this.loadoutT.el);

    // 右：解题补给站
    const station = h('section', 'buy-quiz');
    station.append(add(h('div', 'sec-head'), h('span', 'sec-title', '解题补给站'), this.stationHint), this.stepWrap);
    this.quiz = new QuizCard((i) => this.answer(i));
    this.nextBtn = btn('下一题', 'btn btn-ghost', () => {
      audio.ui('click');
      this.showNext();
    });
    this.intro.el.append(
      h('div', 'qs-intro-t', '准备好了吗？'),
      this.introSub,
      btn('开始答题', 'btn btn-primary', () => {
        audio.ui('open');
        this.showNext();
      }),
    );
    this.doneBox.el.append(h('div', 'qs-done-big', '本回合补给已领取'), this.doneTxt);
    this.quizArea.append(this.intro.el, this.quiz.root, this.doneBox.el);
    station.append(this.quizArea, add(h('div', 'qs-acts'), this.nextBtn));

    // 底部
    const foot = h('footer', 'buy-foot');
    const go = btn('出击', 'btn btn-primary btn-deploy', () => {
      const m = this.m;
      if (!m?.gatePassed) {
        audio.ui('deny');
        return;
      }
      audio.ui('open');
      const co = m.coop;
      // 合作：先报名，菜单留着显示「等待队友」；只差自己一个人时直接出击（与单机一样收起菜单）
      if (co && (co.selfReady || co.readyCount < co.readyTotal - 1)) {
        if (!co.selfReady) m.beginLive();
        this.refresh();
        return;
      }
      this.onDeploy();
    });
    this.goBtn = go;
    const hide = btn('收起菜单', 'btn btn-ghost btn-hide', () => {
      audio.ui('click');
      this.onHide();
    });
    foot.append(add(h('div', 'buy-tip'), keycap(keyOf('buy'), 'only-desktop'), this.tipDesk, this.tipTouch), hide, go);

    // 小屏（手机横屏）：军械库与补给站分成两个页签，题目和「出击」始终可见
    const tabs = h('div', 'buy-tabs');
    const tabQuiz = btn('解题补给站', 'buy-tab is-active', () => this.setTab('quiz'));
    const tabShop = btn('军械库', 'buy-tab', () => this.setTab('shop'));
    tabs.append(tabQuiz, tabShop);
    this.tabBtns = [tabQuiz, tabShop];
    this.root.classList.add('tab-quiz');
    panel.append(head, tabs, add(h('div', 'buy-cols'), shop, station), foot);
    R.append(panel);
  }

  private jumpTo(cat: string): void {
    const g = this.groups.find((x) => x.dataset.cat === cat);
    if (!g) return;
    const list = g.parentElement!;
    // 只滚动军械库内部（不滚动整页）
    this.shopEl.scrollTo({ top: g.offsetTop - list.offsetTop, behavior: 'smooth' });
    for (const b of this.catBtns) b.classList.toggle('is-active', b.dataset.cat === cat);
  }

  private makeCard(id: string, price: number, kind: Card['kind'], value: number, top: HTMLElement, body: (HTMLElement | null)[]): HTMLElement {
    const c = h('div', 'wcard' + (kind === 'armor' ? ' acard' : kind === 'nade' ? ' ncard' : ''));
    c.setAttribute('role', 'button');
    c.tabIndex = 0;
    c.dataset.id = id;
    const state = h('span', 'wc-state');
    const refund = h('button', 'wc-refund is-hidden', '退回');
    refund.type = 'button';
    refund.addEventListener('click', (e) => {
      e.stopPropagation();
      this.doRefund(id);
    });
    c.append(top, ...body.filter((x): x is HTMLElement => !!x), add(h('div', 'wc-foot'), refund, state));
    c.addEventListener('mouseenter', () => audio.ui('hover'));
    c.addEventListener('click', () => this.purchase(id));
    c.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') this.purchase(id);
    });
    const countEl = body.find((x) => x?.classList.contains('nc-count')) ?? null;
    this.cards.push({ id, price, root: bind(c), state: bind(state), refund: bind(refund), kind, value, count: countEl ? bind(countEl) : null });
    return c;
  }

  private priceEl(price: number): HTMLElement {
    return add(h('div', 'wc-price'), price ? creditIcon() : '', price ? fmtNum(price) : '免费');
  }

  private weaponCard(w: WeaponDef): HTMLElement {
    const top = add(h('div', 'wc-top'), add(h('div', 'wc-id'), h('div', 'wc-name', w.name), h('div', 'wc-kind', CLASS_NAMES[w.cls])), this.priceEl(w.price));
    const stats = add(
      h('div', 'wc-stats'),
      statBar('伤害', (w.dmg * w.pellets) / MAX_DMG),
      statBar('射速', w.rpm / 900),
      statBar('精度', 1 - Math.min(1, (w.spread + w.runSpread * 0.3) / 0.07)),
      statBar('弹匣', Math.min(1, w.mag / 40)),
    );
    return this.makeCard(w.id, w.price, 'weapon', 0, top, [h('div', 'wc-desc', w.desc), stats]);
  }

  private nadeCard(w: WeaponDef): HTMLElement {
    const top = add(h('div', 'wc-top'), add(h('div', 'wc-id'), h('div', 'wc-name', w.name), h('div', 'wc-kind', `投掷物 · 最多 ${w.nade!.max}`)), this.priceEl(w.price));
    return this.makeCard(w.id, w.price, 'nade', w.nade!.max, top, [h('div', 'wc-desc', w.desc), h('div', 'nc-count', '')]);
  }

  private armorCard(id: string, name: string, price: number, value: number): HTMLElement {
    const pips = h('div', 'ac-pips');
    for (let i = 0; i < 2; i++) pips.append(h('i', i < value / 25 ? 'on' : ''));
    const top = add(h('div', 'wc-top'), add(h('div', 'wc-id'), h('div', 'wc-name', name), h('div', 'wc-kind', `护盾 +${value}`)), this.priceEl(price));
    return this.makeCard(id, price, 'armor', value, top, [h('div', 'wc-desc', '抵挡约三分之二的伤害，回合结束仍存活可保留。'), pips]);
  }

  private goBtn: HTMLElement | null = null;
  private tabBtns: HTMLButtonElement[] = [];

  private setTab(t: 'quiz' | 'shop'): void {
    audio.ui('click');
    this.root.classList.toggle('tab-quiz', t === 'quiz');
    this.root.classList.toggle('tab-shop', t === 'shop');
    this.tabBtns[0].classList.toggle('is-active', t === 'quiz');
    this.tabBtns[1].classList.toggle('is-active', t === 'shop');
  }
  private goKey = '';

  private flashCard(id: string): void {
    const c = this.cards.find((x) => x.id === id);
    c?.root.el.animate?.([{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 380 });
  }

  private purchase(id: string): void {
    const m = this.m;
    if (!m) return;
    if (m.buy(id)) {
      audio.ui('buy');
      this.flashCard(id);
    } else if (m.boughtThisRound(id) && this.isFull(id)) {
      // 已拥有且是本回合买的：再点一次退回
      this.doRefund(id);
      return;
    } else audio.ui('deny');
    this.refresh();
  }

  private doRefund(id: string): void {
    const m = this.m;
    if (!m) return;
    if (m.refund(id)) {
      audio.ui('click');
      this.flashCard(id);
    } else audio.ui('deny');
    this.refresh();
  }

  /** 该物品是否已经拥有到上限（再点就是退回） */
  private isFull(id: string): boolean {
    const p = this.m!.player;
    const w = WEAPONS[id];
    if (w?.cls === 'throwable') return p.nades[id as NadeId] >= w.nade!.max;
    if (w) return p.slots[0]?.def.id === id || p.slots[1].def.id === id;
    const a = ARMORS.find((x) => x.id === id);
    return !!a && p.armor >= a.value;
  }

  // ------------------------------------------------------------ 打开 / 关闭

  open(m: Match): void {
    this.m = m;
    if (this.quizRound !== m.round) {
      // 新回合：按本局的题数重建补给站
      this.quizRound = m.round;
      this.earned = 0;
      this.current = -1;
      this.buildSteps(m);
      this.quiz.q = null;
      const n = m.quizCount;
      this.setView(m.buyQuizIndex >= n ? 'done' : 'intro');
      // 第二回合起直接出题，减少点击
      if (m.round > 1 && m.buyQuizIndex < n) this.showNext();
    }
    this.rootB.show(true);
    this.root.classList.add('is-open');
    window.addEventListener('keydown', this.keyHandler);
    this.refresh();
  }

  /** 题数与说明文字全部来自本局参数（gateCount / bonusCount） */
  private buildSteps(m: Match): void {
    const gate = m.gateNeed,
      bonus = m.opt.bonusCount,
      n = m.quizCount;
    this.stepWrap.replaceChildren();
    this.steps = [];
    this.stepState = [];
    for (let i = 0; i < n; i++) {
      const d = m.quizDifficulty(i);
      const s = h('div', 'qs-step' + (i < gate ? ' is-gate' : ''));
      s.append(h('span', 'qs-step-n', i < gate ? `通行${gate > 1 ? ' ' + (i + 1) : ''}` : DIFF_NAMES[d]), add(h('span', 'qs-step-r'), creditIcon(), `+${RULES.quizReward[d]}`));
      this.stepWrap.append(s);
      this.steps.push(bind(s));
      this.stepState.push('pending');
    }
    this.stepWrap.classList.toggle('is-hidden', n === 0);
    const gateTxt = gate > 0 ? `答对 ${gate} 道通行题才能出击` : '本局不需要通行题';
    this.stationHint.textContent = bonus > 0 ? `${gateTxt} · 后 ${bonus} 题可跳过` : gateTxt;
    const parts: string[] = [];
    if (gate > 0) parts.push(`每回合必须先答对 ${gate} 道通行题才能出击，答错要订正。`);
    if (bonus > 0) parts.push(`之后还有 ${bonus} 道加分题，更难、奖励更高，可以跳过。`);
    parts.push('答对也会为大招充能。');
    this.introSub.textContent = parts.join('');
    const gateShort = gate > 0 ? `先答对${gate > 1 ? ` ${gate} 道` : ''}通行题，` : '';
    const start = m.coop ? '等大家都点了「出击」一起开始' : '开始回合';
    this.tipDesk.textContent = `准备阶段不限时。${gateShort}再点「出击」${start}；按 ${keyOf('buy')} 可收起菜单在出生点活动。`;
    this.tipTouch.textContent = `准备阶段不限时。${gateShort}再点「出击」${m.coop ? '，等大家一起开始' : ''}；收起菜单后可在出生点走动，点右下「购买 · 出击」回来。`;
    this.goKey = '';
  }

  close(): void {
    this.rootB.show(false);
    this.root.classList.remove('is-open');
    window.removeEventListener('keydown', this.keyHandler);
  }

  get isOpen(): boolean {
    return this.root.classList.contains('is-open');
  }

  /** 结束整场比赛时清空引用 */
  reset(): void {
    this.close();
    this.m = null;
    this.quizRound = -1;
  }

  private onKey(e: KeyboardEvent): void {
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (n >= 0 && this.quiz.q && !this.quiz.answered && this.current >= 0) this.quiz.pick(n);
    else if ((e.code === 'Enter' || e.code === 'Space') && this.quiz.answered && !this.nextBtn.classList.contains('is-hidden')) {
      e.preventDefault();
      this.showNext();
    }
  }

  private setView(v: 'intro' | 'quiz' | 'done'): void {
    this.intro.show(v === 'intro');
    this.quiz.root.classList.toggle('is-hidden', v !== 'quiz');
    this.doneBox.show(v === 'done');
    if (v === 'done') {
      const right = this.stepState.filter((s) => s === 'right').length;
      const answered = this.stepState.filter((s) => s !== 'pending').length;
      this.doneTxt.textContent = answered
        ? `答对 ${right} / ${answered} 题，共获得 ${fmtNum(this.earned)} 信用点。现在去买装备，然后出击吧！`
        : '本回合的补给题已经答完，去买装备然后出击吧！';
    }
  }

  private showNext(): void {
    const m = this.m;
    if (!m) return;
    const idx = m.buyQuizIndex;
    const n = m.quizCount;
    if (idx >= n) {
      this.setView('done');
      this.nextBtn.classList.add('is-hidden');
      this.refresh();
      return;
    }
    const d: Difficulty = m.quizDifficulty(idx);
    const { q, tag } = m.buyQuestion(idx);
    this.current = idx;
    this.stepState[idx] = 'pending';
    const how = document.documentElement.classList.contains('touch') ? '点选答案' : '可用数字键 1–4 作答';
    const gate = idx < m.gateNeed ? `通行题${m.gateNeed > 1 ? ` ${idx + 1} / ${m.gateNeed}` : ''} · ` : '';
    this.quiz.show(q, `第 ${idx + 1} 题 · ${gate}${DIFF_NAMES[d]} · 答对 +${RULES.quizReward[d]} 信用点 · ${how}`, tag);
    this.setView('quiz');
    this.nextBtn.classList.add('is-hidden');
    this.refresh();
  }

  private answer(i: number): void {
    const m = this.m;
    const q = this.quiz.q;
    if (!m || !q || this.quiz.answered) return;
    const wasGate = m.buyQuizIndex < m.gateNeed;
    const ok = m.submitBuyAnswer(q, i);
    const reward = RULES.quizReward[q.difficulty];
    if (ok) this.earned += reward;
    const mustRedo = !ok && wasGate;
    this.stepState[this.current] = ok ? 'right' : 'wrong';
    const left = m.gateNeed - m.buyQuizIndex;
    this.quiz.reveal(
      i,
      ok ? `+${reward} 信用点${wasGate && left > 0 ? ` · 还要再答对 ${left} 道通行题` : ''}` : mustRedo ? '通行题答错了：看懂解析后再做一道，答对才能出击' : '本题无奖励',
    );
    if (ok) this.creditBox.animate?.([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
    const more = m.buyQuizIndex < m.quizCount;
    this.nextBtn.querySelector('.btn-label')!.textContent = mustRedo ? '订正：再做一道' : more ? '下一题' : '查看小结';
    this.nextBtn.classList.remove('is-hidden');
    this.refresh();
  }

  // ------------------------------------------------------------ 刷新（打开期间每帧调用，带缓存）

  refresh(): void {
    const m = this.m;
    if (!m) return;
    const p = m.player;
    this.roundT.text(`第 ${m.round} 回合`);
    // 联机对战：带上本机所在的队伍
    const tn = m.coop?.versus ? m.coop.teamName(0) + ' · ' : '';
    this.sideT.text(tn + (m.playerSide === 'attack' ? '进攻方 · 携带熵核安装' : '防守方 · 守住 A / B 点'));
    this.sideT.cls('is-def', m.playerSide === 'defend');
    this.scoreT.text(`比分 ${m.score[0]} : ${m.score[1]} · 先赢 ${m.opt.roundsToWin}`);
    this.creditT.text(fmtNum(p.credits));
    for (const c of this.cards) {
      let owned: boolean;
      let label: string;
      const bought = m.boughtThisRound(c.id);
      if (c.kind === 'armor') {
        owned = p.armor >= c.value;
        label = owned ? '已装备' : '';
      } else if (c.kind === 'nade') {
        const n = p.nades[c.id as NadeId];
        owned = n >= c.value;
        c.count?.text(`持有 ${n} / ${c.value}`);
        label = owned ? '已满' : '';
      } else {
        owned = p.slots[0]?.def.id === c.id || p.slots[1].def.id === c.id;
        label = owned ? (c.price === 0 ? '标配' : '已装备') : '';
      }
      const afford = p.credits >= c.price;
      c.root.cls('is-owned', owned);
      c.root.cls('is-bought', bought);
      c.root.cls('is-poor', !owned && !afford);
      c.refund.show(bought);
      c.state.text(label || (afford ? (c.kind === 'nade' && p.nades[c.id as NadeId] > 0 ? '再买一个' : '购买') : '信用点不足'));
    }
    const ready = m.gatePassed;
    const need = m.gateNeed;
    // 合作：点过「出击」后显示等待人数
    const wait = m.coop?.waitText ?? null;
    const key = `${ready}|${m.buyQuizIndex}|${need}|${wait}`;
    if (this.goBtn && this.goKey !== key) {
      this.goKey = key;
      this.goBtn.classList.toggle('is-locked', !ready || !!wait);
      this.goBtn.setAttribute('aria-disabled', String(!ready || !!wait));
      const lab = this.goBtn.querySelector('.btn-label');
      if (lab) lab.textContent = wait ?? (ready ? '出击' : need > 1 ? `先答对通行题（${m.buyQuizIndex}/${need}）` : '先答对通行题');
    }
    const prim = p.slots[0];
    const nades = NADE_ORDER.filter((id) => p.nades[id] > 0).map((id) => `${WEAPONS[id].name}×${p.nades[id]}`);
    this.loadoutT.text(
      `当前装备：${prim ? prim.def.name + ' + ' : ''}${p.slots[1].def.name} + 匕首${nades.length ? ' + ' + nades.join('、') : ''} · 护盾 ${Math.round(p.armor)}`,
    );
    this.steps.forEach((s, i) => {
      const st = this.stepState[i];
      s.cls('is-right', st === 'right');
      s.cls('is-wrong', st === 'wrong');
      s.cls('is-current', i === this.current && st === 'pending');
    });
  }
}

function catHint(id: string): string {
  switch (id) {
    case 'sidearm':
      return '副武器栏 · 买新手枪会替换标配';
    case 'throwable':
      return `按 ${keyOf('slot5')} 拿出 · 左键远投、右键近抛`;
    case 'armor':
      return '抵挡约三分之二的伤害';
    default:
      return '主武器栏只能放一把';
  }
}
