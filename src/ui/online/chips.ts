/**
 * 标题页的小组件：当前玩家 + 同步状态（"切换玩家"入口）、游戏时间、不能开局的提示。
 */
import { audio } from '../../core/audio.ts';
import { online, type BeforeMatchResult, type PlaytimeView, type SyncStatus } from '../../net/index.ts';
import { add, btn, h } from '../dom.ts';
import { avatar, friendlyTime, hm, modal, textBlock, widget, type Widget } from './common.ts';

const SYNC_TEXT: Record<SyncStatus, string> = {
  synced: '已同步',
  syncing: '同步中…',
  pending: '离线，稍后同步',
  idle: '连接中…',
  guest: '离线游玩',
};

/**
 * 当前玩家 + 同步状态。点击调用 onSwitch（显示登录页切换玩家）。
 * 游客：显示"离线游玩"，服务器在线时提示"点此登录"。
 */
export function playerChip(o: { onSwitch(): void }): Widget<HTMLButtonElement> {
  const b = h('button', 'ol-player-chip');
  b.type = 'button';
  const av = h('span', 'ol-chip-av');
  const name = h('span', 'ol-chip-name');
  const sub = h('span', 'ol-chip-sub');
  const dot = h('i', 'ol-dot');
  const action = h('span', 'ol-chip-act', '切换玩家');
  b.append(av, add(h('span', 'ol-chip-text'), name, add(h('span', 'ol-chip-line'), dot, sub)), action);
  b.addEventListener('click', () => {
    audio.ui('click');
    o.onSwitch();
  });
  const render = () => {
    const p = online.player;
    const st = online.syncStatus;
    av.replaceChildren(p ? avatar(p.name, 'sm') : h('span', 'ol-avatar sm ol-guest-av', '游'));
    name.textContent = p ? p.name : '离线游玩';
    let text = SYNC_TEXT[st];
    let tone = st === 'synced' ? 'good' : st === 'pending' ? 'warn' : st === 'syncing' || st === 'idle' ? 'busy' : 'off';
    if (p && online.state === 'offline') {
      text = st === 'synced' ? '离线（进度已保存）' : '离线，稍后同步';
      tone = st === 'synced' ? 'off' : 'warn';
    }
    const owner = p ? null : online.profileName;
    if (!p && owner) {
      name.textContent = owner;
      av.replaceChildren(avatar(owner, 'sm'));
      text = '登录已失效，请重新登录';
      tone = 'warn';
    } else if (!p) {
      text = online.state === 'signedOut' ? '不保存到服务器 · 点此登录' : '不保存到服务器';
      tone = 'off';
    }
    sub.textContent = text;
    dot.dataset.tone = tone;
    action.textContent = p ? '切换玩家' : '登录';
    void owner;
    b.setAttribute('aria-label', `${name.textContent}，${text}，${action.textContent}`);
  };
  render();
  const offs = [online.on('state', render), online.on('sync', render)];
  return widget(b, offs);
}

/** 游戏时间的一句话（chip 和提示共用）；不需要显示时返回 null */
export function playtimeText(v: PlaytimeView): { text: string; tone: 'ok' | 'warn' | 'stop' } | null {
  if (!v.enabled) return null;
  if (!v.allowedNow) {
    if (v.reason === 'outside_window') return { text: v.nextAllowedAt ? `现在不在可玩时间，${hm(v.nextAllowedAt)} 后可以玩` : '现在不在可玩时间', tone: 'stop' };
    return { text: v.nextAllowedAt ? `今天的时间用完啦，${friendlyTime(v.nextAllowedAt)} 再来` : '今天的游戏时间用完啦', tone: 'stop' };
  }
  if (v.remaining === null) return v.windowEndsAt ? { text: `可以玩到 ${hm(v.windowEndsAt)}`, tone: 'ok' } : null;
  const min = Math.max(0, Math.ceil(v.remaining / 60));
  const end = v.windowEndsAt ? `（${hm(v.windowEndsAt)} 前）` : '';
  return { text: `今日剩余 ${min} 分钟${end}`, tone: min <= 10 ? 'warn' : 'ok' };
}

/** 游戏时间小标签：今日剩余 N 分钟 / 现在不在可玩时间，xx:xx 后可以玩。家长没开启时隐藏。 */
export function playtimeChip(): Widget {
  const el = h('div', 'chip ol-time-chip is-hidden');
  el.setAttribute('role', 'status');
  const ico = h('i', 'ol-clock');
  ico.setAttribute('aria-hidden', 'true');
  const txt = h('span', 'ol-time-text');
  el.append(ico, txt);
  const render = () => {
    const t = online.player ? playtimeText(online.playtime()) : null;
    el.classList.toggle('is-hidden', !t);
    if (!t) return;
    txt.textContent = t.text;
    el.dataset.tone = t.tone;
  };
  render();
  const iv = setInterval(render, 15_000);
  const offs = [online.on('playtime', render), online.on('state', render), () => clearInterval(iv)];
  return widget(el, offs);
}

/**
 * "现在不能开始新的对局"提示（beforeMatch 返回 allowed = false 时显示）。返回关闭时完成的 Promise。
 */
export function showPlayBlocked(r: Pick<BeforeMatchResult, 'reason' | 'playtime'>, parent?: HTMLElement): Promise<void> {
  const m = modal(
    (panel, close) => {
      panel.classList.add('ol-blocked');
      const v = r.playtime;
      const icon = h('div', 'ol-blocked-ico');
      icon.setAttribute('aria-hidden', 'true');
      icon.append(h('i', 'ol-clock big'));
      const head = v.reason === 'daily_limit' ? '今天的游戏时间用完啦' : '现在不是游戏时间';
      const msg = r.reason || v.message || '现在不能开始新的对局';
      panel.append(icon, h('div', 'modal-title', head));
      // 服务器的提示和标题一样时不重复显示
      if (msg !== head) panel.append(textBlock('modal-msg ol-blocked-msg', msg));
      if (v.nextAllowedAt) panel.append(h('div', 'ol-blocked-next', `下次可以玩：${friendlyTime(v.nextAllowedAt)}`));
      panel.append(h('div', 'ol-blocked-tip', '可以先去错题本订正，或者看看"我的学习"。'));
      const ok = btn('知道了', 'btn btn-primary', () => {
        audio.ui('click');
        close();
      });
      panel.append(add(h('div', 'modal-acts'), ok));
    },
    { parent },
  );
  return m.closed;
}
