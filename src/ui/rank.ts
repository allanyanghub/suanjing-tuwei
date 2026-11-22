/**
 * 段位界面：徽章、段位阶梯页（所有段位从低到高排开，标出"我"和家人在哪）、结算页的升降星条。
 * 规则在 src/core/rank.ts。
 */
import { TIERS, TIER_START, allDivisions, rankView, GOOD_ACC, BAD_ACC, type RankView } from '../core/rank.ts';
import { save } from '../core/save.ts';
import { audio } from '../core/audio.ts';
import { online } from '../net/index.ts';
import type { RankChange } from '../game/match.ts';
import type { Leaderboard } from '../net/api.ts';
import { add, btn, h, starIcon, svg } from './dom.ts';

const ROMAN = ['', 'I', 'II', 'III'];

/** 每个大段徽章外形：越高级装饰越多（翅膀、宝石、皇冠） */
function badgeSvg(tierIndex: number, division: number, cls: string): SVGSVGElement {
  const t = TIERS[tierIndex];
  const id = `rk${tierIndex}-${Math.random().toString(36).slice(2, 7)}`;
  const wings =
    tierIndex >= 3
      ? `<path d="M14 30 C4 28 1 18 3 10 C8 18 12 20 18 21 Z" fill="url(#${id}g)" opacity=".85"/><path d="M86 30 C96 28 99 18 97 10 C92 18 88 20 82 21 Z" fill="url(#${id}g)" opacity=".85"/>` +
        (tierIndex >= 5 ? `<path d="M15 48 C3 48 -1 38 1 30 C6 38 11 40 18 40 Z" fill="url(#${id}g)" opacity=".7"/><path d="M85 48 C97 48 101 38 99 30 C94 38 89 40 82 40 Z" fill="url(#${id}g)" opacity=".7"/>` : '')
      : '';
  const crown =
    tierIndex >= 6
      ? `<path d="M30 14 L36 2 L43 10 L50 0 L57 10 L64 2 L70 14 Z" fill="#ffd36b" stroke="#7a4b00" stroke-width="1.5"/>`
      : tierIndex >= 4
        ? `<path d="M42 12 L50 3 L58 12 Z" fill="url(#${id}g)" stroke="rgba(0,0,0,.35)" stroke-width="1"/>`
        : '';
  const gem = tierIndex >= 2 ? `<path d="M50 30 L60 40 L50 50 L40 40 Z" fill="#fff" opacity=".9"/><path d="M50 30 L60 40 L50 40 Z" fill="${t.color}" opacity=".55"/>` : '';
  const ring = tierIndex >= 1 ? `<path d="M50 20 L76 28 L76 52 C76 68 64 80 50 88 C36 80 24 68 24 52 L24 28 Z" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/>` : '';
  const num = division ? `<text x="50" y="${gem ? 72 : 60}" text-anchor="middle" font-size="${gem ? 16 : 22}" font-weight="800" fill="#fff" stroke="rgba(0,0,0,.45)" stroke-width="2.5" paint-order="stroke" font-family="Georgia, 'Times New Roman', serif">${ROMAN[division]}</text>` : '';
  return svg(
    '0 0 100 100',
    cls,
    `<defs><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".35" stop-color="${t.color}"/><stop offset="1" stop-color="${t.color}" stop-opacity=".55"/></linearGradient>` +
      `<linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.color}"/><stop offset="1" stop-color="#0b1120"/></linearGradient></defs>` +
      wings +
      `<path d="M50 12 L84 22 L84 52 C84 72 70 86 50 96 C30 86 16 72 16 52 L16 22 Z" fill="url(#${id}b)" stroke="url(#${id}g)" stroke-width="4"/>` +
      ring +
      gem +
      crown +
      num,
  );
}

/** 段位徽章（size: 'sm' | 'md' | 'lg'） */
export function rankBadge(pts: number, size: 'sm' | 'md' | 'lg' = 'md'): HTMLElement {
  const v = rankView(pts);
  const w = h('span', `rk-badge rk-${size}`);
  w.style.setProperty('--tc', v.tier.color);
  w.title = v.full;
  w.append(badgeSvg(v.tierIndex, v.division, 'rk-svg'));
  return w;
}

/** 当前小段的星星（满星数个，已得的亮） */
function starRow(v: RankView): HTMLElement {
  const row = h('span', 'rk-stars');
  if (v.starsMax === 0) {
    row.append(starIcon('star on tiny'), h('span', 'rk-king-n', `× ${v.stars}`));
    return row;
  }
  for (let i = 0; i < v.starsMax; i++) row.append(starIcon('star tiny' + (i < v.stars ? ' on' : '')));
  return row;
}

/** 标题页"我的战绩"卡里的段位行（点开阶梯页） */
export function rankProfileRow(open: () => void): HTMLElement {
  const v = rankView(save.rank.pts);
  const b = btn('', 'rk-profile', () => {
    audio.ui('open');
    open();
  });
  b.style.setProperty('--tc', v.tier.color);
  b.replaceChildren(rankBadge(v.pts, 'md'), add(h('span', 'rk-pr-text'), h('span', 'rk-pr-name', v.label), starRow(v)), h('span', 'rk-pr-go', '段位表 ›'));
  b.setAttribute('aria-label', `我的段位：${v.full}，查看段位表`);
  return b;
}

function nextGoal(v: RankView): string {
  if (v.starsMax === 0) return '你已经是王者了！继续赢下去，攒更多王者星。';
  const need = v.starsMax - v.stars;
  const all = allDivisions();
  const i = all.findIndex((d) => d.start === v.pts - v.stars);
  const next = all[i + 1];
  return next ? `再拿 ${need} 颗星升到「${next.label}」` : '';
}

/** 段位阶梯页 */
export function rankScreen(frame: (title: string, kicker: string, back: () => void, cls: string) => { root: HTMLElement; body: HTMLElement }, back: () => void): HTMLElement {
  const { root, body } = frame('段位', '从青铜打到王者', back, 'rank-screen');
  const me = rankView(save.rank.pts);

  // 左：我的段位 + 规则
  const side = h('aside', 'panel rk-side');
  side.style.setProperty('--tc', me.tier.color);
  side.append(
    h('div', 'panel-kicker', '我的段位'),
    add(h('div', 'rk-me'), rankBadge(me.pts, 'lg'), add(h('div', 'rk-me-text'), h('div', 'rk-me-name', me.label), starRow(me), h('div', 'rk-me-goal', nextGoal(me)))),
  );
  const best = rankView(save.rank.best);
  if (best.pts > me.pts) side.append(h('div', 'rk-best', `历史最高：${best.full}`));
  const rules = h('div', 'rk-rules');
  rules.append(
    h('div', 'rk-rules-h', '怎么加星'),
    ruleRow('+2', '打赢，而且答题正确率 ≥ ' + Math.round(GOOD_ACC * 100) + '%', 'up'),
    ruleRow('+1', '打赢', 'up'),
    ruleRow('0', '打赢但正确率不到 ' + Math.round(BAD_ACC * 100) + '%；或者输了但正确率 ≥ ' + Math.round(GOOD_ACC * 100) + '%', 'flat'),
    ruleRow('−1', '输了', 'down'),
    h('div', 'rk-rules-note', '保段：只会掉星，不会掉回上一个大段。到了黄金，就永远不会再回白银。'),
    h('div', 'rk-rules-note', '闯关、合作、对战每打完一局都算。'),
  );
  side.append(rules);

  // 右：阶梯（王者在上，青铜在下）
  const ladder = h('div', 'rk-ladder');
  const whoCells = new Map<number, HTMLElement>();
  const fillFamily = (lb: Leaderboard | null) => {
    const family = new Map<number, { name: string; isMe: boolean }[]>();
    if (online.player && lb)
      for (const p of lb.players) {
        const ti = rankView(p.rank ?? 0).tierIndex;
        if (!family.has(ti)) family.set(ti, []);
        family.get(ti)!.push({ name: p.name, isMe: p.isMe });
      }
    // 自己永远按本机存档显示（刚打完的一局可能还没同步到服务器）
    for (const l of family.values()) for (let i = l.length - 1; i >= 0; i--) if (l[i].isMe) l.splice(i, 1);
    if (!family.has(me.tierIndex)) family.set(me.tierIndex, []);
    family.get(me.tierIndex)!.unshift({ name: online.player?.name ?? '我', isMe: true });
    for (const [ti, cell] of whoCells) {
      cell.replaceChildren();
      for (const p of family.get(ti) ?? []) cell.append(add(h('span', 'rk-who-chip' + (p.isMe ? ' is-me' : '')), p.isMe ? '我' : p.name));
    }
  };

  for (let ti = TIERS.length - 1; ti >= 0; ti--) {
    const t = TIERS[ti];
    const state = ti < me.tierIndex ? 'is-done' : ti === me.tierIndex ? 'is-here' : 'is-locked';
    const row = h('div', `rk-tier ${state}`);
    row.style.setProperty('--tc', t.color);
    row.style.setProperty('--i', String(TIERS.length - 1 - ti));
    const name = add(h('div', 'rk-tier-name'), h('span', 'rk-tier-cn', t.name), h('span', 'rk-tier-need', t.divisions ? `${TIER_START[ti]} 星起 · ${t.divisions} 小段 × ${t.stars} 星` : `${TIER_START[ti]} 星起 · 星数不封顶`));
    const divs = h('div', 'rk-divs');
    if (t.divisions === 0) {
      const d = h('div', 'rk-div' + (ti === me.tierIndex ? ' is-cur' : ''));
      d.append(badgeSvg(ti, 0, 'rk-svg'), h('span', 'rk-div-l', ti === me.tierIndex ? `${me.stars} 星` : '王者'));
      divs.append(d);
    } else
      for (let k = t.divisions; k >= 1; k--) {
        const start = TIER_START[ti] + (t.divisions - k) * t.stars;
        const cur = me.pts >= start && me.pts < start + t.stars;
        const passed = me.pts >= start + t.stars;
        const d = h('div', 'rk-div' + (cur ? ' is-cur' : passed ? ' is-passed' : ''));
        d.append(badgeSvg(ti, k, 'rk-svg'), h('span', 'rk-div-l', `${t.name} ${ROMAN[k]}`));
        if (cur) d.append(starRow(me));
        divs.append(d);
      }
    const who = h('div', 'rk-who');
    whoCells.set(ti, who);
    row.append(name, divs, who);
    ladder.append(row);
  }
  const lw = add(h('section', 'panel rk-ladder-wrap'), ladder);
  if (!online.player) lw.append(h('div', 'rk-ladder-note', '登录家庭账号后，还能看到兄弟姐妹在哪个段位'));
  body.append(side, lw);
  fillFamily(online.leaderboard.data);
  if (online.player) void online.leaderboard.refresh().then((lb) => root.isConnected && fillFamily(lb), () => undefined);
  requestAnimationFrame(() => ladder.querySelector('.is-here')?.scrollIntoView({ block: 'center' }));
  return root;
}

function ruleRow(v: string, text: string, kind: 'up' | 'flat' | 'down'): HTMLElement {
  return add(h('div', 'rk-rule'), h('span', `rk-rule-v is-${kind}`, v), h('span', 'rk-rule-t', text));
}

/** 结算页：段位变化条 */
export function rankResult(c: RankChange | undefined): HTMLElement | null {
  if (!c) return null;
  const before = rankView(c.before);
  const after = rankView(c.after);
  const up = after.tierIndex > before.tierIndex || (after.tierIndex === before.tierIndex && after.division < before.division && after.division !== 0);
  const down = !up && after.label !== before.label;
  const el = h('div', 'rk-result' + (up ? ' is-up' : c.delta > 0 ? ' is-gain' : c.delta < 0 ? ' is-loss' : ''));
  el.style.setProperty('--tc', after.tier.color);
  const dTxt = c.delta > 0 ? `+${c.delta} 星` : c.delta < 0 ? `${c.delta} 星` : '星数不变';
  let why = c.why;
  if (c.rule < 0 && c.delta === 0) why = '保段生效：已经是这个大段最低处，没有掉星';
  el.append(
    rankBadge(after.pts, 'md'),
    add(h('div', 'rk-res-text'), add(h('div', 'rk-res-top'), h('span', 'rk-res-name', after.label), starRow(after), h('span', 'rk-res-d', dTxt)), h('div', 'rk-res-why', why)),
  );
  if (up) {
    el.append(h('div', 'rk-res-up', `升段！${before.label} → ${after.label}`));
    setTimeout(() => audio.ui('buy'), 1400);
  } else if (down) el.append(h('div', 'rk-res-down', `${before.label} → ${after.label}`));
  return el;
}
