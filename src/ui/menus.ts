/** 菜单界面：标题、选关、角色、错题本、设置、操作说明 */
import { LAYOUTS } from '../world/layouts.ts';
import { AGENTS, GRADE_NAMES, LEVELS, THEMES, agentById, type AgentDef, type LevelDef } from '../data/defs.ts';
import type { Grade, Topic } from '../math/types.ts';
import { topicById } from '../math/index.ts';
import { save, persist, removeWrong, totalStars, type AimMode, type AssistLevel, type WrongEntry } from '../core/save.ts';
import { BINDINGS, TOUCH_ROWS, keyOf, keysOf } from '../data/controls.ts';
import { audio } from '../core/audio.ts';
import type { Stage, Quality } from '../render/stage.ts';
import { add, btn, fmtDate, h, hexCss, keycap, lockIcon, starIcon, svg } from './dom.ts';
import { canUseMap, gradeMaxStars, gradeStars, isUnlocked, levelById, levelsOfGrade, mapUnlock, starsOf, suggestedGrade } from './progress.ts';
import { DIFF_NAMES, QuizCard, questionWithFigure } from './quiz.ts';
import { online } from '../net/index.ts';
import { agentBadge, agentCardArt, artImg } from './agent-art.ts';
import { rankProfileRow, rankScreen as rankLadder } from './rank.ts';

export interface MenuNav {
  title(): void;
  levels(): void;
  agents(back: () => void): void;
  wrong(back: () => void): void;
  settings(back: () => void): void;
  help(back: () => void): void;
  /** 段位阶梯页 */
  rank(back: () => void): void;
  start(level: LevelDef): void;
  /** 联机游戏大厅：合作 / 对战（没有家庭服务器的纯单机部署时不提供） */
  coop?(): void;
  stage: Stage;
}

const GRADES: Grade[] = [3, 4, 5, 6];
const CN_NUM = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];

function topicOf(id: string): Topic | undefined {
  try {
    return topicById(id) as Topic | undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- 公共框架

/** 原创徽标：六边形框 + 求和折线 + 准星刻度 */
export function emblem(cls = 'emblem'): SVGSVGElement {
  return svg(
    '0 0 64 64',
    cls,
    `<defs><linearGradient id="emg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#ff6a3d"/></linearGradient></defs>
     <path d="M32 3 57 17.5v29L32 61 7 46.5v-29z" fill="none" stroke="url(#emg)" stroke-width="3.2"/>
     <path d="M22 20h20l-11 12 11 12H22" fill="none" stroke="#fff" stroke-width="4.2" stroke-linejoin="miter" stroke-linecap="square"/>
     <path d="M32 0v8M32 56v8M3 32h8M53 32h8" stroke="url(#emg)" stroke-width="2.4"/>`,
  );
}

function frame(title: string, kicker: string, back: (() => void) | null, cls = ''): { root: HTMLElement; body: HTMLElement; head: HTMLElement } {
  const root = h('section', ('screen ' + cls).trim());
  const head = h('header', 'screen-head');
  if (back)
    head.append(
      btn('返回', 'btn btn-back', () => {
        audio.ui('click');
        back();
      }),
    );
  const t = h('div', 'screen-title');
  t.append(h('div', 'screen-kicker', kicker), h('h2', 'screen-h', title));
  head.append(t);
  const body = h('div', 'screen-body');
  root.append(head, body);
  if (back) root.dataset.back = '1';
  (root as HTMLElement & { onBack?: () => void }).onBack = back ?? undefined;
  return { root, body, head };
}

export type ScreenEl = HTMLElement & { onBack?: () => void };

function starsRow(n: number, max = 3, cls = 'stars'): HTMLElement {
  const r = h('div', cls);
  for (let i = 0; i < max; i++) r.append(starIcon(i < n ? 'star on' : 'star'));
  return r;
}

// ---------------------------------------------------------------- 标题

export function titleScreen(nav: MenuNav): ScreenEl {
  const root = h('section', 'screen title-screen');
  const left = h('div', 'title-left');
  const logo = h('div', 'logo');
  const word = h('h1', 'wordmark');
  word.append(h('span', 'wm-a', '算境'), h('span', 'wm-b', '突围'));
  const sub = h('div', 'logo-sub');
  sub.append(h('span', 'logo-rule'), h('span', '', '奥数战术射击'), h('span', 'logo-rule'));
  const lt = h('div', 'logo-text');
  lt.append(word, sub);
  logo.append(emblem('emblem logo-emblem'), lt);

  const menu = h('nav', 'title-menu');
  const items: [string, string, () => void][] = [
    ['开始闯关', `${LEVELS.length} 个关卡 · ${CN_NUM[new Set(LEVELS.map((l) => l.grade)).size] ?? ''}个年级`, () => nav.levels()],
    ...(nav.coop && online.state !== 'unknown' && !(online.state === 'offline' && !online.player) ? [['联机游戏', '和家人合作或对战', () => nav.coop?.()] as [string, string, () => void]] : []),
    ['选择角色', '当前：' + agentById(save.agent).name, () => nav.agents(() => nav.title())],
    ['错题本', save.wrong.length ? `${save.wrong.length} 道待巩固` : '暂无错题', () => nav.wrong(() => nav.title())],
    ['设置', '灵敏度 · 视野 · 音量 · 画质', () => nav.settings(() => nav.title())],
    ['操作说明', '按键与奥数规则', () => nav.help(() => nav.title())],
  ];
  items.forEach(([label, hint, go], i) => {
    const b = btn(label, 'menu-item' + (i === 0 ? ' is-primary' : ''), () => {
      audio.ui(i === 0 ? 'open' : 'click');
      go();
    });
    b.style.setProperty('--i', String(i));
    b.prepend(h('span', 'menu-idx', String(i + 1).padStart(2, '0')));
    b.append(h('span', 'menu-hint', hint));
    menu.append(b);
  });
  left.append(logo, menu);

  // 右侧档案卡
  const right = h('aside', 'title-right');
  const card = h('div', 'panel profile');
  const total = totalStars();
  const st = save.stats;
  const acc = st.answered ? Math.round((st.correct / st.answered) * 100) : 0;
  const starBig = h('div', 'profile-stars');
  starBig.append(starIcon('star on big'), h('span', 'ps-num', String(total)), h('span', 'ps-max', `/ ${LEVELS.length * 3}`));
  const grid = h('div', 'profile-grid');
  for (const [k, v] of [
    ['胜场', String(st.wins)],
    ['击败', String(st.kills)],
    ['答题', String(st.answered)],
    ['正确率', st.answered ? acc + '%' : '—'],
  ])
    add(grid, add(h('div', 'pg-cell'), h('div', 'pg-v', v), h('div', 'pg-k', k)));
  const ag = agentById(save.agent);
  const agChip = h('div', 'profile-agent');
  agChip.style.setProperty('--ac', hexCss(ag.color));
  agChip.append(agentBadge(ag.id, ag.name, 'pa-badge'), add(h('div', 'pa-text'), h('div', 'pa-name', `${ag.name} · ${ag.title}`), h('div', 'pa-role', ag.role)));
  card.append(h('div', 'panel-kicker', '我的战绩'), rankProfileRow(() => nav.rank(() => nav.title())), starBig, grid, agChip);
  right.append(card);

  const foot = h('footer', 'title-foot', '原创奥数战术射击 · 适合三至六年级 · 解题即战力');
  root.append(left, right, foot);
  return root;
}

// ---------------------------------------------------------------- 选关

let lastGrade: Grade | null = null;

export function levelScreen(nav: MenuNav): ScreenEl {
  const { root, body } = frame('选择关卡', '战区 · 关卡', () => nav.title(), 'level-screen');
  const grade: Grade = lastGrade ?? suggestedGrade();
  const tabs = h('div', 'grade-tabs');
  const grid = h('div', 'level-grid');
  const brief = h('aside', 'panel brief is-empty');
  const main = h('div', 'level-main');
  main.append(tabs, grid);
  body.append(main, brief);

  let current: Grade = grade;
  const tabEls = new Map<Grade, HTMLButtonElement>();
  for (const g of GRADES) {
    const t = btn(GRADE_NAMES[g], 'grade-tab', () => {
      audio.ui('click');
      renderGrade(g);
    });
    t.style.setProperty('--tc', hexCss(THEMES[g].neon));
    t.append(h('span', 'gt-theme', THEMES[g].name), add(h('span', 'gt-stars'), starIcon('star on tiny'), `${gradeStars(g)}/${gradeMaxStars(g)}`));
    tabs.append(t);
    tabEls.set(g, t);
  }

  const renderBrief = (l: LevelDef) => {
    brief.classList.remove('is-empty');
    brief.replaceChildren();
    brief.style.setProperty('--tc', hexCss(THEMES[l.grade].neon));
    const topics = l.topicIds.map((id) => topicOf(id)).filter((t): t is Topic => !!t);
    brief.append(
      h('div', 'panel-kicker', `${l.subtitle}${l.boss ? ' · 终局之战' : ''}`),
      h('h3', 'brief-title', l.name),
      starsRow(starsOf(l.id), 3, 'stars brief-stars'),
    );
    const facts = h('div', 'brief-facts');
    const fact = (k: string, v: string) => add(h('div', 'bf'), h('div', 'bf-k', k), h('div', 'bf-v', v));
    facts.append(
      fact('对阵', `${l.teamSize} v ${l.teamSize}`),
      fact('胜利条件', `先赢 ${l.roundsToWin} 回合`),
      fact('战场', THEMES[l.grade].name),
    );
    const meter = h('div', 'bf');
    const bar = h('div', 'meter');
    const fill = h('div', 'meter-fill');
    fill.style.setProperty('--v', String(Math.min(1, l.botSkill)));
    bar.append(fill);
    meter.append(h('div', 'bf-k', '敌方强度'), bar);
    facts.append(meter);
    brief.append(facts);

    const kn = h('div', 'brief-know');
    kn.append(h('div', 'bk-head', '知识要点'));
    if (topics.length)
      for (const t of topics) kn.append(add(h('div', 'bk-item'), h('div', 'bk-name', t.name), h('div', 'bk-hint', t.hint)));
    else kn.append(h('div', 'bk-hint', '本关题目覆盖：' + l.name));
    brief.append(kn);

    // 地图选择：默认是本关的地图，可以换成任意一张
    const mapBox = h('div', 'brief-map');
    const curMap = () => {
      const c = save.mapChoice[l.id];
      return c && canUseMap(l, c) ? c : l.mapId;
    };
    const mapHead = h('div', 'bk-head', '');
    const mapBlurb = h('div', 'bk-hint', '');
    const chips = h('div', 'map-chips');
    const paintMaps = () => {
      const cur = curMap();
      const def = LAYOUTS.find((d) => d.id === cur) ?? LAYOUTS[0];
      mapHead.textContent = `地图：${def.name}${cur === l.mapId ? '（本关默认）' : ''}`;
      mapBlurb.textContent = def.blurb;
      chips.querySelectorAll('.map-chip').forEach((e) => e.classList.toggle('is-on', (e as HTMLElement).dataset.id === cur));
    };
    for (const d of LAYOUTS) {
      const open = canUseMap(l, d.id);
      const info = mapUnlock(d);
      const c = btn(open ? d.name : `🔒 ${d.name}`, 'map-chip' + (open ? '' : ' is-locked'), () => {
        if (!open) {
          audio.ui('deny');
          mapBlurb.textContent = `「${d.name}」未解锁：通关${GRADE_NAMES[d.grade]}的 ${info.need} 关后开放（已通关 ${info.have} 关）。`;
          return;
        }
        audio.ui('click');
        if (d.id === l.mapId) delete save.mapChoice[l.id];
        else save.mapChoice[l.id] = d.id;
        persist();
        paintMaps();
      });
      c.dataset.id = d.id;
      c.title = open ? `${GRADE_NAMES[d.grade]}地图 · ${d.blurb}` : `通关${GRADE_NAMES[d.grade]}的 ${info.need} 关后解锁（已通关 ${info.have} 关）`;
      chips.append(c);
    }
    mapBox.append(mapHead, mapBlurb, chips);
    paintMaps();
    brief.append(mapBox);

    const ag = agentById(save.agent);
    const agRow = h('div', 'brief-agent');
    agRow.style.setProperty('--ac', hexCss(ag.color));
    agRow.append(
      agentBadge(ag.id, ag.name, 'pa-badge sm'),
      add(h('div', 'pa-text'), h('div', 'pa-name', `出战角色：${ag.name}`), h('div', 'pa-role', ag.title)),
      btn('更换', 'btn btn-ghost sm', () => {
        audio.ui('click');
        nav.agents(() => nav.levels());
      }),
    );
    brief.append(agRow);
    const go = btn('出击', 'btn btn-primary btn-xl', () => {
      audio.ui('open');
      nav.start(l);
    });
    brief.append(go);
  };

  const renderGrade = (g: Grade) => {
    current = g;
    lastGrade = g;
    for (const [k, t] of tabEls) t.classList.toggle('is-active', k === g);
    root.style.setProperty('--tc', hexCss(THEMES[g].neon));
    grid.replaceChildren();
    // 关卡数可变：每行最多 5 张，按行数均分列数（12 关 → 4×3），行数多时卡片更紧凑
    const levels = levelsOfGrade(g);
    const rows = Math.max(1, Math.ceil(levels.length / 5));
    grid.style.setProperty('--cols', String(Math.max(1, Math.ceil(levels.length / rows))));
    grid.dataset.rows = String(Math.min(rows, 3));
    grid.scrollTop = 0;
    let firstOpen: LevelDef | null = null;
    levels.forEach((l, i) => {
      const open = isUnlocked(l);
      const s = starsOf(l.id);
      if (open && !firstOpen && s < 1) firstOpen = l;
      const c = h('button', 'level-card' + (open ? '' : ' is-locked') + (l.boss ? ' is-boss' : '') + (s > 0 ? ' is-cleared' : ''));
      c.type = 'button';
      c.style.setProperty('--i', String(Math.min(i, 11)));
      c.append(h('div', 'lc-num', String(i + 1).padStart(2, '0')));
      if (l.boss) c.append(h('div', 'lc-boss', '终局'));
      c.append(h('div', 'lc-name', l.name), h('div', 'lc-sub', l.subtitle));
      const foot = h('div', 'lc-foot');
      foot.append(h('span', 'lc-team', `${l.teamSize} v ${l.teamSize}`), starsRow(s));
      c.append(foot);
      if (!open) {
        const lk = h('div', 'lc-lock');
        lk.append(lockIcon(), h('span', '', '通关上一关解锁'));
        c.append(lk);
      }
      c.addEventListener('mouseenter', () => audio.ui('hover'));
      c.addEventListener('click', () => {
        if (!open) {
          audio.ui('deny');
          return;
        }
        audio.ui('click');
        grid.querySelectorAll('.level-card').forEach((e) => e.classList.remove('is-selected'));
        c.classList.add('is-selected');
        renderBrief(l);
      });
      grid.append(c);
    });
    // 默认选中第一个可打的关卡
    const pick = firstOpen ?? levels.filter(isUnlocked).slice(-1)[0];
    if (pick) {
      const idx = levels.indexOf(pick);
      const el = grid.children[idx];
      el?.classList.add('is-selected');
      if (el instanceof HTMLElement && rows > 1) requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
      renderBrief(pick);
    }
  };
  renderGrade(current);
  return root;
}

// ---------------------------------------------------------------- 角色

function abilityRow(key: string, a: { name: string; desc: string; icon: string; charges: number }, extra: string): HTMLElement {
  const r = h('div', 'ab-row');
  r.append(
    add(h('div', 'ab-icon'), h('span', '', a.icon), keycap(key, 'ab-key')),
    add(h('div', 'ab-text'), add(h('div', 'ab-name'), a.name, h('span', 'ab-extra', extra)), h('div', 'ab-desc', a.desc)),
  );
  return r;
}

export function agentCard(a: AgentDef, selected: boolean): HTMLButtonElement {
  const c = h('button', 'agent-card' + (selected ? ' is-selected' : ''));
  c.type = 'button';
  c.setAttribute('aria-pressed', String(selected));
  c.style.setProperty('--ac', hexCss(a.color));
  c.style.setProperty('--ac2', hexCss(a.accent));
  // 整卡角色图（public/assets/characters/card_<id>.png；暂缺时用立绘；都没有时保持原来的文字徽标）
  const src = agentCardArt(a.id);
  if (src) {
    c.classList.add('has-art');
    c.append(h('div', 'agent-backdrop'), artImg(src, 'agent-art'), h('div', 'agent-shade'));
  }
  const body = h('div', 'agent-body');
  const top = h('div', 'agent-top');
  if (!src) top.append(h('div', 'agent-glyph', a.name));
  top.append(add(h('div', 'agent-id'), h('div', 'agent-role', a.role), h('div', 'agent-name', a.name), h('div', 'agent-title', a.title)));
  body.append(top, h('p', 'agent-blurb', a.blurb));
  const abs = h('div', 'agent-abs');
  abs.append(
    abilityRow(keyOf('abilityQ'), a.q, `每回合 ${a.q.charges} 次`),
    abilityRow(keyOf('abilityE'), a.e, `每回合 ${a.e.charges} 次`),
    abilityRow(keyOf('ult'), a.x, `需 ${a.ultCost} 点充能`),
  );
  body.append(abs, add(h('div', 'agent-sel'), h('span', '', selected ? '已选择' : '选择该角色')));
  c.append(body);
  return c;
}

export function agentScreen(back: () => void): ScreenEl {
  const { root, body } = frame('选择角色', '小队 · 角色', back, 'agent-screen');
  const row = h('div', 'agent-row');
  body.append(row, h('p', 'screen-note', `大招（${keyOf('ult')}）需要充能：每击败一名敌人或答对一道题获得 1 点。`));
  const render = () => {
    row.replaceChildren();
    AGENTS.forEach((a, i) => {
      const c = agentCard(a, a.id === save.agent);
      c.style.setProperty('--i', String(i));
      c.addEventListener('mouseenter', () => audio.ui('hover'));
      c.addEventListener('click', () => {
        if (save.agent === a.id) return;
        save.agent = a.id;
        persist();
        audio.ui('buy');
        render();
      });
      row.append(c);
    });
  };
  render();
  return root;
}

// ---------------------------------------------------------------- 错题本

function wrongItem(e: WrongEntry, onPractice: () => void, onRemove: () => void): HTMLElement {
  const it = h('article', 'panel wrong-item');
  const lv = levelById(e.levelId);
  const tp = topicOf(e.q.topicId);
  const meta = h('div', 'wi-meta');
  meta.append(
    h('span', 'tag', lv ? `${lv.subtitle}` : e.levelId),
    h('span', 'tag tag-accent', tp ? tp.name : e.q.topicId),
    h('span', 'tag', DIFF_NAMES[e.q.difficulty] ?? ''),
    h('span', 'wi-date', fmtDate(e.time)),
  );
  const q = questionWithFigure(e.q, 'wi-q');
  const opts = h('div', 'wi-opts');
  e.q.options.forEach((o, i) => {
    const cls = i === e.q.answer ? ' is-correct' : i === e.picked ? ' is-wrong' : '';
    const op = h('div', 'wi-opt' + cls);
    op.append(keycap(String(i + 1), 'opt-key'), h('span', 'opt-text', o));
    if (i === e.picked && i !== e.q.answer) op.append(h('span', 'wi-badge bad', '你的答案'));
    if (i === e.q.answer) op.append(h('span', 'wi-badge good', '正确答案'));
    opts.append(op);
  });
  const ex = h('div', 'wi-explain');
  ex.append(h('span', 'wi-ex-k', '解析'), h('span', '', e.q.explain));
  const acts = h('div', 'wi-acts');
  acts.append(
    btn('再练一次', 'btn btn-primary sm', () => {
      audio.ui('open');
      onPractice();
    }),
    btn('移除', 'btn btn-ghost sm', () => {
      audio.ui('click');
      onRemove();
    }),
  );
  it.append(meta, ...q, opts, ex, acts);
  return it;
}

/** 段位阶梯页 */
export function rankScreen(back: () => void): ScreenEl {
  return rankLadder(frame, back) as ScreenEl;
}

export function wrongScreen(back: () => void): ScreenEl {
  const { root, body, head } = frame('错题本', '复盘 · 巩固', back, 'wrong-screen');
  const tools = h('div', 'head-tools');
  const count = h('div', 'wrong-count');
  const clear = btn('清空错题本', 'btn btn-danger sm', () => {
    audio.ui('click');
    confirmBox('确定清空全部错题吗？', '清空后无法恢复。', '全部清空', () => {
      save.wrong.length = 0;
      persist();
      render();
    });
  });
  tools.append(count, clear);
  head.append(tools);
  const list = h('div', 'wrong-list');
  body.append(list);

  const modalHost = h('div', 'modal-host');
  root.append(modalHost);

  const confirmBox = (title: string, msg: string, okLabel: string, ok: () => void) => {
    const m = h('div', 'modal');
    const p = h('div', 'panel modal-panel');
    p.append(
      h('h3', 'modal-title', title),
      h('p', 'modal-msg', msg),
      add(
        h('div', 'modal-acts'),
        btn('取消', 'btn btn-ghost', () => {
          audio.ui('click');
          m.remove();
        }),
        btn(okLabel, 'btn btn-danger', () => {
          audio.ui('click');
          m.remove();
          ok();
        }),
      ),
    );
    m.append(p);
    modalHost.append(m);
  };

  const practice = (e: WrongEntry) => {
    const m = h('div', 'modal');
    const p = h('div', 'panel modal-panel practice');
    const shownAt = performance.now();
    const card = new QuizCard((i) => {
      const ok = card.reveal(i, '');
      online.logAnswer({ q: e.q, correct: ok, context: 'practice', ms: performance.now() - shownAt, levelId: e.levelId });
      if (ok) {
        audio.correct();
        removeWrong(e);
        persist();
        status.textContent = '已掌握！这道题已从错题本中移除。';
        status.className = 'practice-status good';
      } else {
        audio.wrong();
        status.textContent = '再想想解析里的思路，下次一定行。';
        status.className = 'practice-status bad';
      }
      done.classList.remove('is-hidden');
    });
    const tp = topicOf(e.q.topicId);
    card.show(e.q, `再练一次 · ${tp ? tp.name : ''} · ${DIFF_NAMES[e.q.difficulty] ?? ''}`);
    const status = h('div', 'practice-status');
    const done = btn('完成', 'btn btn-primary is-hidden', () => {
      audio.ui('click');
      close();
    });
    const close = () => {
      window.removeEventListener('keydown', onKey);
      m.remove();
      render();
    };
    const onKey = (ev: KeyboardEvent) => {
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(ev.code);
      if (n >= 0) card.pick(n);
      else if (ev.code === 'Escape') {
        ev.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    p.append(
      card.root,
      add(
        h('div', 'modal-acts'),
        status,
        btn('关闭', 'btn btn-ghost', () => {
          audio.ui('click');
          close();
        }),
        done,
      ),
    );
    m.append(p);
    modalHost.append(m);
  };

  const render = () => {
    list.replaceChildren();
    count.textContent = save.wrong.length ? `共 ${save.wrong.length} 道` : '';
    clear.disabled = save.wrong.length === 0;
    if (!save.wrong.length) {
      const empty = h('div', 'empty');
      empty.append(h('div', 'empty-big', '错题本是空的'), h('div', 'empty-sub', '在战斗中答错的题会自动收集到这里，方便赛后复盘。'));
      list.append(empty);
      return;
    }
    save.wrong.forEach((e, i) => {
      const it = wrongItem(
        e,
        () => practice(e),
        () => {
          const k = save.wrong.indexOf(e);
          if (k >= 0) save.wrong.splice(k, 1);
          persist();
          render();
        },
      );
      it.style.setProperty('--i', String(Math.min(i, 8)));
      list.append(it);
    });
  };
  render();
  return root;
}

// ---------------------------------------------------------------- 设置

function slider(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, on: (v: number) => void): HTMLElement {
  const row = h('label', 'set-row');
  const val = h('span', 'set-val', fmt(value));
  const inp = h('input', 'range');
  inp.type = 'range';
  inp.min = String(min);
  inp.max = String(max);
  inp.step = String(step);
  inp.value = String(value);
  const paint = () => inp.style.setProperty('--p', String((Number(inp.value) - min) / (max - min)));
  paint();
  inp.addEventListener('input', () => {
    const v = Number(inp.value);
    val.textContent = fmt(v);
    paint();
    on(v);
  });
  row.append(add(h('div', 'set-label'), h('span', '', label), val), inp);
  return row;
}

/** 分段按钮（单选） */
function segRow<T extends string>(label: string, note: string, opts: [T, string][], cur: T, on: (v: T) => void): HTMLElement {
  const seg = h('div', 'seg');
  const segBtns: HTMLButtonElement[] = [];
  let value = cur;
  for (const [v, name] of opts) {
    const b = btn(name, 'seg-btn' + (cur === v ? ' is-active' : ''), () => {
      if (value === v) return;
      value = v;
      audio.ui('click');
      segBtns.forEach((x, i) => x.classList.toggle('is-active', opts[i][0] === v));
      on(v);
    });
    segBtns.push(b);
    seg.append(b);
  }
  return add(h('div', 'set-row'), add(h('div', 'set-label'), h('span', '', label), h('span', 'set-val', note)), seg);
}

export function settingsScreen(back: () => void, stage: Stage, touch = false): ScreenEl {
  const { root, body } = frame('设置', '系统 · 偏好', back, 'settings-screen');
  const p = h('div', 'panel settings-panel');
  const s = save.settings;
  const touchRows = [
    segRow('摇杆左右', '转向：左右推摇杆转身；平移：左右推侧着走，转身靠右边屏幕滑动', [['turn', '转向'], ['strafe', '平移']] as [string, string][], s.stickTurn ? 'turn' : 'strafe', (v) => {
      s.stickTurn = v === 'turn';
      persist();
    }),
    slider('触屏灵敏度', 0.3, 3, 0.05, s.touchSens, (v) => v.toFixed(2), (v) => {
      s.touchSens = v;
      persist();
    }),
    segRow('自动开火', '准星停在敌人身上时自动射击', [['on', '开'], ['off', '关']] as [string, string][], s.autoFire ? 'on' : 'off', (v) => {
      s.autoFire = v === 'on';
      persist();
    }),
    segRow<AssistLevel>('辅助瞄准强度', '仅触屏生效', [['low', '低'], ['medium', '中'], ['high', '高']], s.assist, (v) => {
      s.assist = v;
      persist();
    }),
  ];
  const mouseRow = slider('鼠标灵敏度', 0.2, 3, 0.05, s.sens, (v) => v.toFixed(2), (v) => {
    s.sens = v;
    persist();
  });
  const aimOpts: [AimMode, string][] = [
    ['hold', '按住'],
    ['toggle', '切换'],
  ];
  const adsRow = segRow<AimMode>('瞄准方式', '右键开镜：按住开镜 / 点一下切换', aimOpts, s.adsMode, (v) => {
    s.adsMode = v;
    persist();
  });
  const scopeRow = segRow<AimMode>('狙击开镜方式', '切换时右键依次：2.5 倍 → 5 倍 → 关', aimOpts, s.scopeMode, (v) => {
    s.scopeMode = v;
    persist();
  });
  p.append(
    h('div', 'panel-kicker', '操控'),
    // 当前是触屏时把触屏设置放在前面
    ...(touch ? [...touchRows, mouseRow, adsRow, scopeRow] : [mouseRow, adsRow, scopeRow, ...touchRows]),
    slider('视野范围（FOV）', 60, 100, 1, s.fov, (v) => `${v}°`, (v) => {
      s.fov = v;
      persist();
    }),
    h('div', 'panel-kicker', '声音'),
    slider('音量', 0, 1, 0.01, s.volume, (v) => `${Math.round(v * 100)}%`, (v) => {
      s.volume = v;
      audio.setVolume(v);
      persist();
    }),
    h('div', 'panel-kicker', '画面'),
  );
  const opts: [Quality, string][] = [
    ['high', '高'],
    ['medium', '中'],
    ['low', '低'],
  ];
  p.append(
    segRow('画质', '低画质可提升帧率', opts, s.quality, (q) => {
      s.quality = q;
      // 玩家手动选过画质后，不再自动调整
      s.qualityAuto = false;
      persist();
      stage.setQuality(q);
    }),
  );
  body.append(p);
  return root;
}

// ---------------------------------------------------------------- 操作说明

export function helpScreen(back: () => void, touch = false): ScreenEl {
  const { root, body } = frame('操作说明', '手册 · 规则', back, 'help-screen');
  const tk = h('div', 'panel help-keys help-touch');
  tk.append(h('div', 'panel-kicker', '触屏操作'));
  for (const [k, v] of TOUCH_ROWS) tk.append(add(h('div', 'rule'), h('div', 'rule-k', k), h('div', 'rule-v', v)));
  // 键位表由 data/controls.ts 生成（与游戏实际读取的按键是同一份）
  const keys = h('div', 'panel help-keys');
  keys.append(h('div', 'panel-kicker', '按键'));
  const grid = h('div', 'key-grid');
  const row = (ks: string[], desc: string) => {
    const k = h('div', 'kg-keys');
    ks.forEach((x) => k.append(keycap(x)));
    grid.append(k, h('div', 'kg-desc', desc));
  };
  row(['W', 'A', 'S', 'D'], '移动（没有冲刺键：默认就是奔跑）');
  for (const b of BINDINGS) if (b.help) row(keysOf(b.id), b.label);
  row(['1', '2', '3', '4'], '解题面板打开时：数字键用来作答（不换枪）');
  keys.append(grid);

  const rules = h('div', 'panel help-rules');
  rules.append(h('div', 'panel-kicker', '奥数怎么用'));
  const list: [string, string][] = [
    ['解题补给站', '每回合开始的准备阶段先答对通行题才能出击，之后还有更难的加分题（可以跳过）。答对就能获得信用点，用来购买武器、投掷物和护盾。'],
    ['回合与攻防', '先赢够规定回合数的一方获胜；打满上半场后交换攻防，装备和信用点重新开始。'],
    ['安装熵核', `进攻方带着熵核走到 A 点或 B 点，按 ${keyOf('slot4')} 或 ${keyOf('use')} 开始解题（手持熵核时也可以点左键）。解题时时间会变慢，答对即可完成安装；有的关卡要连续答对几道题。`],
    ['拆除熵核', `防守方靠近已安装的熵核按 ${keyOf('slot4')} 或 ${keyOf('use')} 解题，答对就能拆除，赢下回合。需要答多道题时，答对一半后离开，进度会保留一半。`],
    ['答错怎么办', '答错会锁定几秒并显示解析，看懂之后会换一道新题，不要着急。'],
    ['演算复活', '每回合第一次阵亡时，有一次复活题机会：在倒计时内答对，就能回到出生点继续战斗。'],
    ['大招充能', '每答对一题或击败一名敌人，大招充能 +1。'],
    ['星级评价', '赢下关卡得 1 星；答题正确率越高，星星越多（最多 3 星）。'],
    ['错题本', '所有答错的题都会自动收进错题本，可以随时「再练一次」。'],
  ];
  for (const [k, v] of list) rules.append(add(h('div', 'rule'), h('div', 'rule-k', k), h('div', 'rule-v', v)));
  // 当前是触屏时把触屏操作放在最前面
  if (touch) body.append(tk, rules, keys);
  else body.append(keys, rules, tk);
  return root;
}
