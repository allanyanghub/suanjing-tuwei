/**
 * 标题页的家庭组件：家长留言卡片、任务列表（含完成庆祝）。
 */
import { audio } from '../../core/audio.ts';
import { online, type ParentMessage, type Task } from '../../net/index.ts';
import { add, btn, h, reducedMotion } from '../dom.ts';
import { ago, bar, modal, textBlock, widget, type Widget } from './common.ts';

// ---------------------------------------------------------------- 留言

/**
 * 家长留言卡片：有没看过的留言时显示最新一条，并醒目地弹出；点"知道了"后标为已看过，卡片随之隐藏。
 * 没有未看留言 / 游客时隐藏。
 */
export function messageCard(o: { popup?: boolean } = {}): Widget {
  const card = h('section', 'panel ol-msg-card is-hidden');
  card.setAttribute('aria-label', '家长留言');
  const kick = h('div', 'panel-kicker', '家长留言');
  const text = textBlock('ol-msg-text', '');
  const meta = h('div', 'ol-msg-meta');
  card.append(kick, text, meta);
  let popupOpen = false;

  const render = () => {
    const m = online.player ? online.messages.latest() : null;
    card.classList.toggle('is-hidden', !m);
    if (!m) return;
    text.textContent = m.text;
    const more = online.messages.list.length - 1;
    meta.textContent = `${ago(m.createdAt)}${m.forAll ? ' · 给大家' : ''}${more > 0 ? ` · 还有 ${more} 条` : ''}`;
    if (o.popup !== false && !popupOpen) {
      const fresh = online.messages.unseen();
      if (fresh.length) {
        popupOpen = true;
        showNewMessages(fresh).then(() => {
          popupOpen = false;
          render();
        });
      }
    }
  };
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  const openAll = () => {
    const list = online.messages.list;
    if (list.length) void showMessages(list, '家长留言').then(() => online.messages.markSeen(list.map((m) => m.id)));
  };
  card.addEventListener('click', openAll);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAll();
    }
  });
  render();
  return widget(card, [online.on('messages', render), online.on('state', render)]);
}

/** 新留言弹窗；点"知道了"后标为已看过，之后不再显示 */
function showNewMessages(list: ParentMessage[]): Promise<void> {
  audio.ui('open');
  const shown = list.slice(0, 5);
  return showMessages(shown, list.length > 1 ? `有 ${list.length} 条新留言` : '有一条新留言', true).then(() => {
    online.messages.markSeen(shown.map((m) => m.id));
  });
}

function showMessages(list: ParentMessage[], title: string, fresh = false): Promise<void> {
  return modal((panel, close) => {
    panel.classList.add('ol-msg-modal');
    if (fresh) panel.classList.add('is-new');
    panel.append(h('div', 'panel-kicker', '家长留言'), h('div', 'modal-title', title));
    const box = h('div', 'ol-msg-list');
    for (const m of list) {
      const it = h('div', 'ol-msg-item');
      it.append(textBlock('ol-msg-big', m.text), h('div', 'ol-msg-meta', `${ago(m.createdAt)}${m.forAll ? ' · 给大家' : ''}`));
      box.append(it);
    }
    panel.append(box, add(h('div', 'modal-acts'), btn('知道了', 'btn btn-primary', () => close())));
  }).closed;
}

// ---------------------------------------------------------------- 任务

const UNIT: Record<string, string> = { level: '关', levels: '关', correct: '题', answers: '题', streak: '题' };

/** 进度文字：已答对 18/30 题；accuracy 任务显示"已答 12/20 题，正确率 75%（目标 85%）" */
export function progressText(t: Task): string {
  const p = t.progress;
  if (t.kind === 'accuracy') {
    const acc = p.accuracy === null || p.accuracy === undefined ? '—' : `${p.accuracy}%`;
    return `已答 ${p.current}/${p.target} 题，正确率 ${acc}（目标 ${p.percent ?? '?'}%）`;
  }
  if (t.kind === 'clear_level') return p.current >= 1 ? '已通关' : '还没通关';
  if (t.kind === 'streak') return `最多连对 ${p.current}/${p.target} 题`;
  if (t.kind === 'clear_count') return `已通关 ${p.current}/${p.target} 关`;
  return `已答对 ${p.current}/${p.target} ${UNIT[p.unit] ?? ''}`.trim();
}

function dueText(t: Task): string {
  if (!t.dueDate) return '';
  const [, m, d] = t.dueDate.split('-').map(Number);
  return `截止 ${m}月${d}日`;
}

/**
 * 任务列表：进行中的任务（进度条、截止日、奖励）和最近完成的任务。
 * 有 justCompleted 的任务时自动播放一次庆祝（celebrate = false 可关闭，改由调用方处理 'celebrate' 事件）。
 */
export function taskList(o: { celebrate?: boolean; max?: number } = {}): Widget {
  const card = h('section', 'panel ol-tasks is-hidden');
  card.setAttribute('aria-label', '我的任务');
  const head = h('div', 'panel-kicker', '我的任务');
  const list = h('div', 'ol-task-list');
  card.append(head, list);
  const render = () => {
    const tasks = online.player ? online.tasks.list : [];
    card.classList.toggle('is-hidden', !online.player);
    list.replaceChildren();
    if (!tasks.length) {
      list.append(h('div', 'ol-empty sm', '暂时没有任务，自由闯关吧！'));
      return;
    }
    const sorted = tasks.slice().sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
    for (const t of sorted.slice(0, o.max ?? 6)) list.append(taskRow(t));
    if (sorted.length > (o.max ?? 6)) list.append(h('div', 'ol-more', `还有 ${sorted.length - (o.max ?? 6)} 个任务`));
  };
  const celebrate = () => {
    if (o.celebrate === false || !online.player) return;
    const pend = online.tasks.pendingCelebrations();
    if (pend.length) void celebrateTasks(pend);
  };
  render();
  celebrate();
  return widget(card, [online.on('tasks', render), online.on('state', render), online.on('celebrate', celebrate)]);
}

function taskRow(t: Task): HTMLElement {
  const done = t.status === 'done';
  const row = h('div', 'ol-task' + (done ? ' is-done' : ''));
  const top = h('div', 'ol-task-top');
  const title = h('div', 'ol-task-title');
  title.textContent = t.title;
  top.append(title);
  if (done) top.append(h('span', 'tag ol-tag-done', '已完成'));
  else if (t.dueDate) top.append(h('span', 'tag', dueText(t)));
  row.append(top);
  if (t.description && t.description !== t.title) row.append(textBlock('ol-task-desc', t.description));
  const p = t.progress;
  const frac = done ? 1 : t.kind === 'accuracy' ? Math.min(p.current / Math.max(1, p.target), (p.accuracy ?? 0) / Math.max(1, p.percent ?? 100)) : p.current / Math.max(1, p.target);
  row.append(bar(frac, done ? 'is-done' : ''), h('div', 'ol-task-prog', done ? (t.rewardGranted ? '奖励已兑现' : t.reward ? '完成啦！等家长兑现奖励' : '完成啦！') : progressText(t)));
  if (t.reward) {
    const r = h('div', 'ol-task-reward');
    r.append(h('span', 'ol-gift'), h('span', '', '奖励：'));
    const rt = h('span', 'ol-task-reward-text');
    rt.textContent = t.reward;
    r.append(rt);
    row.append(r);
  }
  if (t.note) row.append(textBlock('ol-task-note', t.note));
  return row;
}

// ---------------------------------------------------------------- 庆祝

let celebrating = false;

/** 依次为每个刚完成的任务播放庆祝，每个播放完立即 ack（恰好一次） */
export async function celebrateTasks(tasks: Task[]): Promise<void> {
  if (celebrating) return;
  celebrating = true;
  try {
    for (const t of tasks) {
      await showCelebration(t);
      await online.celebrated(t.id);
    }
  } finally {
    celebrating = false;
  }
  const more = online.tasks.pendingCelebrations();
  if (more.length) void celebrateTasks(more);
}

/** 庆祝弹层：彩带（canvas 绘制，无素材；减少动态效果时只显示静态画面） */
export function showCelebration(t: Task): Promise<void> {
  audio.ui('buy');
  let stop = () => {};
  const m = modal((panel, close) => {
    panel.classList.add('ol-celebrate');
    const burst = h('div', 'ol-burst');
    burst.setAttribute('aria-hidden', 'true');
    panel.append(burst, h('div', 'panel-kicker', '任务完成'), h('div', 'ol-cel-title', '太棒了！'));
    const name = h('div', 'ol-cel-task');
    name.textContent = t.title;
    panel.append(name);
    if (t.reward) {
      const r = h('div', 'ol-cel-reward');
      r.append(h('span', 'ol-gift big'));
      const rt = h('span', '');
      rt.textContent = `奖励：${t.reward}`;
      r.append(rt);
      panel.append(r, h('div', 'ol-cel-note', '告诉爸爸妈妈，让他们兑现吧！'));
    }
    if (t.bonusCredits > 0) panel.append(h('div', 'ol-cel-bonus', `游戏内奖励：每回合额外 ${t.bonusCredits} 金币`));
    panel.append(add(h('div', 'modal-acts center'), btn('太棒了！', 'btn btn-primary btn-xl', () => close())));
  }, { cls: 'ol-cel-panel' });
  m.root.classList.add('ol-cel-modal');
  if (!reducedMotion()) stop = confetti(m.root);
  else m.root.classList.add('is-static');
  return m.closed.then(() => stop());
}

/** 在容器上铺一层 canvas 撒彩带，返回停止函数 */
function confetti(host: HTMLElement): () => void {
  const c = h('canvas', 'ol-confetti');
  c.setAttribute('aria-hidden', 'true');
  host.prepend(c);
  const ctx = c.getContext('2d');
  if (!ctx) return () => c.remove();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = () => host.clientWidth;
  const H = () => host.clientHeight;
  const resize = () => {
    c.width = W() * dpr;
    c.height = H() * dpr;
  };
  resize();
  const colors = ['#ffc44d', '#ff8a3d', '#35d6ff', '#3ee39b', '#ff5468', '#eef3ff'];
  const parts = Array.from({ length: 140 }, (_, i) => ({
    x: W() / 2 + (Math.random() - 0.5) * 80,
    y: H() * 0.38,
    vx: (Math.random() - 0.5) * 14,
    vy: -6 - Math.random() * 10,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    w: 6 + Math.random() * 7,
    h: 3 + Math.random() * 4,
    c: colors[i % colors.length],
    delay: Math.random() * 18,
  }));
  let raf = 0;
  let frame = 0;
  const tick = () => {
    frame++;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W(), H());
    let alive = 0;
    for (const p of parts) {
      if (frame < p.delay) {
        alive++;
        continue;
      }
      p.vy += 0.32;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      if (p.y < H() + 20) alive++;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      ctx.restore();
    }
    if (alive && frame < 400) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  window.addEventListener('resize', resize);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    c.remove();
  };
}
