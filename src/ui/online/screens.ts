/**
 * 全屏界面："我的学习"（GET /api/report/me）与家庭排行榜（GET /api/leaderboard）。
 * 都用与菜单相同的屏幕框架；返回按钮 / Esc 调用 onBack。离线时显示最后一次缓存的数据。
 */
import { audio } from '../../core/audio.ts';
import { online, type BoardMetric, type Leaderboard, type MyReport } from '../../net/index.ts';
import { BOARD_LABELS, BOARD_ORDER } from '../../net/leaderboard.ts';
import { rankView } from '../../core/rank.ts';
import { rankBadge } from '../rank.ts';
import { accuracyTier, encouragement } from '../../net/report.ts';
import { add, h } from '../dom.ts';
import { GRADE_CN, ago, avatar, bar, frame, layer, onEscape, widget, type Widget } from './common.ts';

function stat(v: string, k: string, cls = ''): HTMLElement {
  return add(h('div', ('ol-stat ' + cls).trim()), h('div', 'ol-stat-v', v), h('div', 'ol-stat-k', k));
}
const pctText = (a: number | null) => (a === null ? '—' : `${a}%`);

function offlineNote(fetchedAt: number): HTMLElement | null {
  if (online.state === 'signedIn') return null;
  return h('div', 'ol-banner sm', fetchedAt ? `现在连不上服务器，显示的是${ago(fetchedAt)}的数据` : '现在连不上服务器');
}

/** "我的学习"：总体、本周、今天、连对、各专题正确率 */
export function studyScreen(o: { onBack(): void }): Widget {
  const root = layer('ol-screen-layer');
  const { root: scr, body } = frame('我的学习', '学习小结', o.onBack, 'ol-study');
  root.append(scr);
  const render = (r: MyReport | null, loading = false) => {
    body.replaceChildren();
    if (!online.player) {
      body.append(h('div', 'ol-empty', '登录后才能看到自己的学习记录哦'));
      return;
    }
    if (!r) {
      body.append(h('div', 'ol-empty', loading ? '正在读取…' : '暂时拿不到学习记录，等连上家里的服务器再看吧'));
      return;
    }
    const note = offlineNote(online.report.fetchedAt);
    const left = h('div', 'ol-study-left');
    if (note) left.append(note);
    const cheer = h('div', 'panel ol-cheer');
    cheer.append(h('div', 'panel-kicker', online.player.name), h('div', 'ol-cheer-text', encouragement(r)));
    const grid = h('div', 'ol-stats');
    grid.append(
      stat(String(r.week.answered), '本周答题'),
      stat(pctText(r.week.accuracy), '本周正确率'),
      stat(String(r.today.answered), '今天答题'),
      stat(String(r.streak.current), '当前连对', 'hot'),
      stat(String(r.streak.best), '最长连对'),
      stat(pctText(r.totals.accuracy), `累计 ${r.totals.answered} 题`),
    );
    left.append(cheer, grid);
    const right = h('section', 'panel ol-topics');
    right.append(h('div', 'panel-kicker', '各专题正确率'));
    const list = h('div', 'ol-topic-list');
    if (!r.topics.length) list.append(h('div', 'ol-empty sm', '还没有答题记录，去闯一关吧！'));
    for (const t of r.topics) {
      const row = h('div', 'ol-topic');
      row.dataset.tier = accuracyTier(t.accuracy);
      const name = h('div', 'ol-topic-name');
      name.textContent = t.name;
      row.append(
        add(h('div', 'ol-topic-top'), name, h('div', 'ol-topic-v', `${pctText(t.accuracy)}`)),
        bar((t.accuracy ?? 0) / 100, 'tier'),
        h('div', 'ol-topic-sub', `答对 ${t.correct} / ${t.answered} 题`),
      );
      list.append(row);
    }
    right.append(list);
    body.append(left, right);
  };
  render(online.report.data, true);
  void online.report.refresh().then((r) => render(r));
  const offs = [onEscape(o.onBack)];
  const w = widget(root, offs);
  w.onBack = o.onBack;
  return w;
}

const EMPTY_BOARD: Record<BoardMetric, string> = {
  rank: '还没有段位数据',
  stars: '还没有人拿到星星，快去闯关吧！',
  cleared: '还没有人通关，第一个就是你！',
  weekCorrect: '这周还没人答题，现在开始就能领先！',
  weekAccuracy: '本周答满 10 题才能上正确率榜哦',
  bestStreak: '还没有连对记录',
  wins: '还没有胜场记录',
};

/** 家庭排行榜：每个指标一个页签，当前孩子高亮 */
export function leaderboardScreen(o: { onBack(): void; initial?: BoardMetric }): Widget {
  const root = layer('ol-screen-layer');
  const { root: scr, body, head } = frame('家庭排行榜', '和兄弟姐妹比一比', o.onBack, 'ol-board');
  root.append(scr);
  let metric: BoardMetric = o.initial ?? 'rank';
  const tabs = h('div', 'seg ol-tabs');
  tabs.setAttribute('role', 'tablist');
  const tabBtns = new Map<BoardMetric, HTMLButtonElement>();
  for (const m of BOARD_ORDER) {
    const b = h('button', 'seg-btn ol-tab', BOARD_LABELS[m].name);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      audio.ui('click');
      metric = m;
      render(online.leaderboard.data);
    });
    b.addEventListener('keydown', (e) => {
      const i = BOARD_ORDER.indexOf(m);
      const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
      if (j >= 0 && j < BOARD_ORDER.length && j !== i) {
        e.preventDefault();
        metric = BOARD_ORDER[j];
        render(online.leaderboard.data);
        tabBtns.get(metric)?.focus();
      }
    });
    tabBtns.set(m, b);
    tabs.append(b);
  }
  head.append(add(h('div', 'head-tools ol-tabs-wrap'), tabs));
  const render = (lb: Leaderboard | null, loading = false) => {
    for (const [m, b] of tabBtns) {
      b.classList.toggle('is-active', m === metric);
      b.setAttribute('aria-selected', String(m === metric));
      b.tabIndex = m === metric ? 0 : -1;
    }
    body.replaceChildren();
    if (!online.player) {
      body.append(h('div', 'ol-empty', '登录后才能看家庭排行榜哦'));
      return;
    }
    if (!lb) {
      body.append(h('div', 'ol-empty', loading ? '正在读取…' : '暂时拿不到排行榜，等连上家里的服务器再看吧'));
      return;
    }
    const panel = h('section', 'panel ol-board-panel');
    panel.setAttribute('role', 'tabpanel');
    const note = offlineNote(online.leaderboard.fetchedAt);
    if (note) panel.append(note);
    if (lb.meHidden) panel.append(h('div', 'ol-banner sm', '家长把你的排行榜关掉了，你不会出现在榜上，但可以看看大家'));
    const info = BOARD_LABELS[metric];
    panel.append(add(h('div', 'ol-board-head'), h('div', 'panel-kicker', info.name), h('div', 'ol-board-hint', info.hint)));
    const rows = lb.boards[metric] ?? [];
    const list = h('ol', 'ol-rank-list');
    if (!rows.length) panel.append(h('div', 'ol-empty sm', EMPTY_BOARD[metric]));
    const byName = new Map(lb.players.map((p) => [p.name, p]));
    const max = Math.max(1, ...rows.map((r) => r.value));
    for (const r of rows) {
      const p = byName.get(r.name);
      const li = h('li', 'ol-rank' + (p?.isMe ? ' is-me' : ''));
      li.dataset.rank = String(r.rank);
      const name = h('span', 'ol-rank-name');
      name.textContent = r.name;
      const nm = add(h('span', 'ol-rank-who'), name, h('span', 'ol-rank-sub', `${GRADE_CN[p?.grade ?? 0] ?? ''}${p?.isMe ? ' · 我' : ''}`));
      const isRank = metric === 'rank';
      const val = h('span', 'ol-rank-v' + (isRank ? ' is-rank' : ''), isRank ? rankView(r.value).label : `${r.value}`);
      if (isRank) val.prepend(rankBadge(r.value, 'sm'));
      else val.append(h('small', '', info.unit));
      li.append(h('span', 'ol-rank-n', String(r.rank)), avatar(r.name, 'sm'), nm, add(h('span', 'ol-rank-barw'), bar(metric === 'weekAccuracy' ? r.value / 100 : isRank ? (r.value + 1) / (max + 1) : r.value / max)), val);
      if (p?.isMe) li.setAttribute('aria-current', 'true');
      list.append(li);
    }
    if (rows.length) panel.append(list);
    if (rows.length === 1 && !lb.meHidden) panel.append(h('div', 'ol-more', '家里只有你一个人上榜，邀请兄弟姐妹一起来玩吧'));
    body.append(panel);
  };
  render(online.leaderboard.data, true);
  void online.leaderboard.refresh().then((lb) => render(lb));
  const w = widget(root, [onEscape(o.onBack)]);
  w.onBack = o.onBack;
  return w;
}
