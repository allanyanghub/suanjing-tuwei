/** 结算界面 */
import type { MatchResult } from '../game/match.ts';
import type { LevelDef } from '../data/defs.ts';
import { audio } from '../core/audio.ts';
import { add, btn, h, keycap, starIcon } from './dom.ts';
import { DIFF_NAMES, questionWithFigure } from './quiz.ts';
import { rankResult } from './rank.ts';

export interface ResultActions {
  next: (() => void) | null;
  retry: () => void;
  levels: () => void;
  /** 合作模式：「再来一局」回到房间、「返回」离开房间（给了就不显示单人的按钮） */
  coop?: { again: () => void; leave: () => void };
}

/** 合作模式的全队战绩（由对局同步层填进 MatchResult.coop） */
export interface CoopResultInfo {
  members: { name: string; grade: number; kills: number; deaths: number; answered: number; correct: number; isSelf: boolean; team?: 0 | 1; bot?: boolean }[];
  /** 联机对战：本机所在队伍 / 对方队伍的名字（members.team 0 = 我方） */
  versus?: { selfTeamName: string; otherTeamName: string };
}

const GRADE_TEXT: Record<number, string> = { 3: '三年级', 4: '四年级', 5: '五年级', 6: '六年级' };

/** 合作结算表：每个人的击败、阵亡、答题、正确率。groups：联机对战按队分段（同一张表，列对齐） */
function teamTable(info: CoopResultInfo, groups?: { title: string; team: 0 | 1 }[]): HTMLElement {
  const t = h('table', 'cp-team');
  const headRow = (first: string) => {
    const r = h('tr', '');
    for (const k of [first, '击败', '阵亡', '答对 / 答题', '正确率']) r.append(h('th', '', k));
    return r;
  };
  const body = h('tbody', '');
  const list = groups ?? [{ title: '队员', team: 0 as const }];
  t.append(add(h('thead', ''), headRow(list[0].title)));
  list.forEach((g, gi) => {
    if (gi > 0) body.append(headRow(g.title));
    for (const m of info.members) if (!groups || (m.team ?? 0) === g.team) body.append(memberRow(m));
  });
  t.append(body);
  return t;
}

function memberRow(m: CoopResultInfo['members'][number]): HTMLElement {
  const tr = h('tr', m.isSelf ? 'is-self' : '');
  const name = h('td', '', m.name);
  name.append(h('span', 'cp-grade', m.bot ? '电脑' : (GRADE_TEXT[m.grade] ?? '') + (m.isSelf ? ' · 你' : '')));
  tr.append(
    name,
    h('td', '', String(m.kills)),
    h('td', '', String(m.deaths)),
    h('td', '', m.bot ? '—' : `${m.correct} / ${m.answered}`),
    h('td', '', !m.bot && m.answered ? Math.round((m.correct / m.answered) * 100) + '%' : '—'),
  );
  return tr;
}

export function resultsScreen(res: MatchResult, level: LevelDef, act: ResultActions): HTMLElement {
  const r = res as MatchResult & { coop?: CoopResultInfo };
  if (r.coop?.versus) return versusResults(r, r.coop, level, act);
  if (r.coop || act.coop) return coopResults(r, level, act);
  const root = h('section', 'results ' + (r.win && r.stars > 0 ? 'is-win' : 'is-lose'));
  const panel = h('div', 'res-panel');

  const head = h('div', 'res-head');
  head.append(
    h('div', 'res-kicker', `${level.subtitle} · ${level.name}`),
    h('h2', 'res-title', !r.win ? '失利' : r.stars > 0 ? '通关' : '未通关'),
    add(h('div', 'res-score'), h('span', 'rs-a', String(r.score[0])), h('span', 'rs-sep', ':'), h('span', 'rs-b', String(r.score[1]))),
  );
  const stars = h('div', 'res-stars');
  for (let i = 0; i < 3; i++) {
    const s = starIcon('star big' + (i < r.stars ? ' on' : ''));
    const w = h('div', 'res-star' + (i < r.stars ? ' is-earned' : ''));
    w.style.setProperty('--i', String(i));
    w.append(s);
    stars.append(w);
  }
  if (r.win)
    setTimeout(() => {
      for (let i = 0; i < r.stars; i++) setTimeout(() => audio.ui('buy'), 520 + i * 260);
    }, 0);
  head.append(stars, h('div', 'res-star-note', starNote(r)));

  const acc = r.answered ? Math.round((r.correct / r.answered) * 100) : 0;
  const stats = h('div', 'res-stats');
  const stat = (k: string, v: string, cls = '') => add(h('div', 'rst ' + cls), h('div', 'rst-v', v), h('div', 'rst-k', k));
  stats.append(stat('击败', String(r.kills)), stat('阵亡', String(r.deaths)), stat('答题', `${r.correct} / ${r.answered}`), stat('正确率', r.answered ? acc + '%' : '—', 'accent'));
  const accBar = h('div', 'res-acc');
  const fill = h('i', '');
  fill.style.setProperty('--v', String(acc / 100));
  accBar.append(fill);

  const review = wrongReview(r);

  const acts = h('div', 'res-acts');
  acts.append(
    btn('返回选关', 'btn btn-ghost', () => {
      audio.ui('click');
      act.levels();
    }),
    btn('再来一次', 'btn ' + (act.next ? 'btn-ghost' : 'btn-primary'), () => {
      audio.ui('open');
      act.retry();
    }),
  );
  if (act.next) {
    const nx = act.next;
    acts.append(
      btn('下一关', 'btn btn-primary', () => {
        audio.ui('open');
        nx();
      }),
    );
  }

  const left = add(h('div', 'res-left'), head, stats, accBar, rankResult(r.rank), acts);
  panel.append(left, review);
  root.append(panel);
  return root;
}

/** 右栏：错题回顾 */
function wrongReview(r: MatchResult): HTMLElement {
  const review = h('div', 'res-review');
  review.append(add(h('div', 'sec-head'), h('span', 'sec-title', '错题回顾'), h('span', 'sec-hint', r.wrong.length ? `${r.wrong.length} 道 · 已收入错题本` : '')));
  if (!r.wrong.length) review.append(h('div', 'empty-sub res-perfect', r.answered ? '本关没有答错的题，太棒了！' : '本关没有作答记录。'));
  for (const w of r.wrong) {
    const it = h('div', 'rv-item');
    it.append(h('div', 'rv-meta', DIFF_NAMES[w.q.difficulty] ?? ''), ...questionWithFigure(w.q, 'wi-q'));
    const opts = h('div', 'wi-opts');
    w.q.options.forEach((o, i) => {
      const cls = i === w.q.answer ? ' is-correct' : i === w.picked ? ' is-wrong' : '';
      const op = h('div', 'wi-opt' + cls);
      op.append(keycap(String(i + 1), 'opt-key'), h('span', 'opt-text', o));
      if (i === w.picked && i !== w.q.answer) op.append(h('span', 'wi-badge bad', '你的答案'));
      if (i === w.q.answer) op.append(h('span', 'wi-badge good', '正确答案'));
      opts.append(op);
    });
    it.append(opts, add(h('div', 'wi-explain'), h('span', 'wi-ex-k', '解析'), h('span', '', w.q.explain)));
    review.append(it);
  }
  return review;
}

/** 合作结算：比分 + 全队战绩表（替代星级）+ 自己的错题 */
function coopResults(r: MatchResult & { coop?: CoopResultInfo }, level: LevelDef, act: ResultActions): HTMLElement {
  const root = h('section', 'results ' + (r.win ? 'is-win' : 'is-lose'));
  const panel = h('div', 'res-panel');
  const head = h('div', 'res-head');
  head.append(
    h('div', 'res-kicker', `合作模式 · ${level.subtitle} · ${level.name}`),
    h('h2', 'res-title', r.win ? '全队胜利' : '这次输了'),
    add(h('div', 'res-score'), h('span', 'rs-a', String(r.score[0])), h('span', 'rs-sep', ':'), h('span', 'rs-b', String(r.score[1]))),
    h('div', 'res-star-note', r.win ? '大家配合得真好！' : '别灰心，一起再来一局！'),
  );
  if (r.win) setTimeout(() => audio.ui('buy'), 520);
  const team = h('div', 'cp-res-team');
  if (r.coop?.members.length) team.append(teamTable(r.coop), h('div', 'cp-res-note', '每个人答的是自己年级的题。'));
  else {
    const acc = r.answered ? Math.round((r.correct / r.answered) * 100) : 0;
    const stats = h('div', 'res-stats');
    const stat = (k: string, v: string, cls = '') => add(h('div', 'rst ' + cls), h('div', 'rst-v', v), h('div', 'rst-k', k));
    stats.append(stat('击败', String(r.kills)), stat('阵亡', String(r.deaths)), stat('答题', `${r.correct} / ${r.answered}`), stat('正确率', r.answered ? acc + '%' : '—', 'accent'));
    team.append(stats);
  }
  const acts = h('div', 'res-acts');
  const c = act.coop;
  acts.append(
    btn('返回', 'btn btn-ghost', () => {
      audio.ui('click');
      (c ? c.leave : act.levels)();
    }),
    btn('再来一局', 'btn btn-primary', () => {
      audio.ui('open');
      (c ? c.again : act.retry)();
    }),
  );
  panel.append(add(h('div', 'res-left'), head, team, rankResult(r.rank), acts), wrongReview(r));
  root.append(panel);
  return root;
}

/** 联机对战结算：本机视角的胜负 + 两队战绩表（我方在上） */
function versusResults(r: MatchResult, info: CoopResultInfo, level: LevelDef, act: ResultActions): HTMLElement {
  const vs = info.versus!;
  const root = h('section', 'results ' + (r.win ? 'is-win' : 'is-lose'));
  const panel = h('div', 'res-panel');
  const head = h('div', 'res-head');
  head.append(
    h('div', 'res-kicker', `联机对战 · ${level.subtitle} · ${level.name}`),
    h('h2', 'res-title', r.win ? `${vs.selfTeamName}胜利` : `${vs.otherTeamName}获胜`),
    add(h('div', 'res-score'), h('span', 'rs-a', String(r.score[0])), h('span', 'rs-sep', ':'), h('span', 'rs-b', String(r.score[1]))),
    h('div', 'res-star-note', r.win ? '打得漂亮！和对手握握手吧。' : '差一点点！换个战术再来一局。'),
  );
  if (r.win) setTimeout(() => audio.ui('buy'), 520);
  const team = h('div', 'cp-res-team');
  team.append(
    teamTable(info, [
      { title: `我方 · ${vs.selfTeamName}`, team: 0 },
      { title: `对方 · ${vs.otherTeamName}`, team: 1 },
    ]),
    h('div', 'cp-res-note', '每个人答的是自己年级的题。'),
  );
  const acts = h('div', 'res-acts');
  const c = act.coop;
  acts.append(
    btn('返回', 'btn btn-ghost', () => {
      audio.ui('click');
      (c ? c.leave : act.levels)();
    }),
    btn('再来一局', 'btn btn-primary', () => {
      audio.ui('open');
      (c ? c.again : act.retry)();
    }),
  );
  panel.append(add(h('div', 'res-left'), head, team, rankResult(r.rank), acts), wrongReview(r));
  root.append(panel);
  return root;
}

function starNote(r: MatchResult): string {
  const pass = Math.round(r.pass * 100);
  if (!r.win) return `打赢对战并且答题正确率 ≥ ${pass}% 才算通关，再试一次吧！`;
  if (r.stars === 0) return `对战赢了，但答题正确率不足 ${pass}%，本关不算通关，下一关不会解锁。看看右边的错题再来一次！`;
  if (r.stars >= 3) return '满星通关！解题又快又准。';
  if (r.stars === 2) return `正确率达到 ${Math.max(pass, 95)}% 即可三星。`;
  return `通关！正确率达到 ${Math.max(pass, 80)}% 可得二星。`;
}
