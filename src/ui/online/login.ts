/**
 * 登录 / 选择玩家界面。
 * - 玩家方块（GET /api/players），本设备上次登录的玩家排第一并标出；
 * - 点方块 → 输入密码（触屏默认数字键盘，可切换字母；显示 / 隐藏；回车提交；中文错误；输错 5 次锁定倒计时）；
 * - "新玩家"：名字、两次密码、年级（三–六年级）；
 * - "离线游玩（不保存到服务器）"；
 * - 第一次在本设备登录且有单机进度时，询问是否合并。
 */
import { audio } from '../../core/audio.ts';
import { online, type MergeOffer, type Player } from '../../net/index.ts';
import { ApiError } from '../../net/api.ts';
import { add, btn, h } from '../dom.ts';
import { GRADE_CN, avatar, frame, layer, onEscape, widget, type Widget } from './common.ts';

export interface LoginOptions {
  /** 登录成功（含合并询问处理完）或选择离线游玩后调用；界面不会自己移除，由调用方 destroy */
  onDone(how: 'signedIn' | 'offline'): void;
  /** 有值时显示"返回"按钮（例如从标题页的"切换玩家"进来，可以不换人直接回去） */
  onCancel?: () => void;
}

const BAD_NAME = /[\u0000-\u001f<>"'&\\/]/;
const LOCK_FAILS = 5;
const LOCK_SECONDS = 30;

/** 输错次数（按名字，页面内有效）——服务器第 5 次输错后锁定 30 秒，但第 5 次仍返回 401，这里提前告诉孩子 */
const fails = new Map<string, number>();
const lockedUntil = new Map<string, number>();

/** 登录界面（全屏层）。挂到 #ui 或 body 上；完成后调用方 destroy()。 */
export function loginScreen(o: LoginOptions): Widget {
  const cleanups: (() => void)[] = [];
  const root = layer('ol-login-layer');
  const { root: scr, body, head } = frame('谁来玩？', '家庭账号', o.onCancel ? () => o.onCancel!() : null, 'ol-login');
  root.append(scr);
  const status = h('div', 'ol-login-status');
  status.setAttribute('role', 'status');
  head.append(status);
  const w = widget(root, cleanups);
  if (o.onCancel) w.onBack = o.onCancel;

  let timer: ReturnType<typeof setInterval> | null = null;
  /** 被另一台设备挤下线时的说明（只在这次登录页显示） */
  const notice = online.loginNotice;
  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  cleanups.push(stopTimer);
  let offEsc: (() => void) | null = null;
  const setEsc = (fn: (() => void) | null) => {
    offEsc?.();
    offEsc = fn ? onEscape(fn) : null;
  };
  cleanups.push(() => setEsc(null));

  const show = (el: HTMLElement) => {
    stopTimer();
    body.replaceChildren(el);
    const f = el.querySelector<HTMLElement>('input, .ol-tile.is-last, .ol-tile, .btn-primary');
    f?.focus({ preventScroll: true });
  };

  const finish = (how: 'signedIn' | 'offline') => {
    setEsc(null);
    o.onDone(how);
  };

  // ------------------------------------------------------------ 选人

  async function pick(): Promise<void> {
    setEsc(o.onCancel ? () => o.onCancel!() : null);
    const wrap = h('div', 'ol-pick');
    if (notice) wrap.append(add(h('div', 'ol-banner ol-notice'), h('span', 'ol-banner-text', `${notice}。要在这台设备上继续玩，点自己的名字重新登录（另一台设备会退出）。`)));
    const grid = h('div', 'ol-tiles');
    grid.setAttribute('role', 'list');
    const loading = h('div', 'ol-empty', '正在连接家里的服务器…');
    wrap.append(grid, loading);
    const foot = h('div', 'ol-pick-foot');
    const offBtn = btn('离线游玩（不保存到服务器）', 'btn btn-ghost ol-offline-btn', () => {
      audio.ui('click');
      online.playOffline();
      finish('offline');
    });
    foot.append(offBtn);
    wrap.append(foot);
    show(wrap);

    const r = await online.listPlayers();
    if (!root.isConnected && !body.contains(wrap)) return;
    loading.remove();
    status.replaceChildren();
    const last = online.lastPlayer?.toLowerCase() ?? '';
    const players = r.players.slice().sort((a, b) => Number(b.name.toLowerCase() === last) - Number(a.name.toLowerCase() === last));
    if (r.offline) {
      const warn = h('div', 'ol-banner');
      warn.append(h('span', 'ol-banner-text', `${r.error ?? '连不上家里的服务器'}。可以先离线玩，进度保存在这台设备上。`));
      const retry = btn('重试', 'btn sm', async () => {
        audio.ui('click');
        retry.disabled = true;
        await online.retryConnection();
        void pick();
      });
      warn.append(retry);
      wrap.prepend(warn);
    }
    for (const p of players) {
      const t = h('button', 'ol-tile' + (p.name.toLowerCase() === last ? ' is-last' : ''));
      t.type = 'button';
      t.setAttribute('role', 'listitem');
      t.disabled = r.offline;
      t.append(avatar(p.name), add(h('span', 'ol-tile-text'), h('span', 'ol-tile-name', p.name), h('span', 'ol-tile-sub', GRADE_CN[p.grade] ?? '')));
      if (p.name.toLowerCase() === last) t.append(h('span', 'tag tag-accent ol-tile-tag', '上次'));
      t.addEventListener('click', () => {
        audio.ui('open');
        password(p);
      });
      grid.append(t);
    }
    if (!r.offline) {
      const n = h('button', 'ol-tile ol-tile-new');
      n.type = 'button';
      n.setAttribute('role', 'listitem');
      n.append(h('span', 'ol-avatar ol-plus', '+'), add(h('span', 'ol-tile-text'), h('span', 'ol-tile-name', '新玩家'), h('span', 'ol-tile-sub', '创建账号')));
      n.addEventListener('click', () => {
        audio.ui('open');
        register();
      });
      grid.append(n);
      if (!players.length) wrap.insertBefore(h('div', 'ol-empty', '还没有玩家，点"新玩家"创建第一个账号吧'), foot);
    }
    (grid.querySelector<HTMLElement>('.ol-tile.is-last') ?? grid.querySelector<HTMLElement>('.ol-tile:not(:disabled)'))?.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ 密码

  function password(p: Player): void {
    const key = p.name.toLowerCase();
    const panel = h('form', 'panel ol-auth');
    panel.noValidate = true;
    const who = h('div', 'ol-auth-who');
    who.append(avatar(p.name, 'big'), add(h('div'), h('div', 'ol-auth-name', p.name), h('div', 'ol-auth-sub', GRADE_CN[p.grade] ?? '')));
    const field = passwordField('密码', 'current-password');
    const err = h('div', 'ol-err');
    err.setAttribute('role', 'alert');
    err.setAttribute('aria-live', 'assertive');
    const go = btn('登录', 'btn btn-primary ol-go', () => panel.requestSubmit());
    go.type = 'submit';
    const back = btn('换个人', 'btn btn-ghost', () => {
      audio.ui('click');
      void pick();
    });
    const acts = add(h('div', 'ol-acts'), back, go);
    panel.append(who, field.wrap, err, acts);
    setEsc(() => void pick());

    const lock = () => {
      const until = lockedUntil.get(key) ?? 0;
      const left = Math.ceil((until - Date.now()) / 1000);
      if (left > 0) {
        err.textContent = `密码错得太多了，请 ${left} 秒后再试`;
        go.disabled = true;
        field.input.disabled = true;
        return true;
      }
      if (go.disabled && until) {
        err.textContent = '';
        go.disabled = false;
        field.input.disabled = false;
        field.input.focus();
        lockedUntil.delete(key);
      }
      return false;
    };
    const startLock = (secs: number) => {
      lockedUntil.set(key, Date.now() + secs * 1000);
      lock();
      stopTimer();
      timer = setInterval(() => {
        if (!lock()) stopTimer();
      }, 250);
    };

    panel.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (go.disabled) return;
      const pw = field.input.value;
      if (!pw) {
        err.textContent = '请输入密码';
        field.input.focus();
        return;
      }
      go.disabled = true;
      err.textContent = '';
      go.querySelector('.btn-label')!.textContent = '登录中…';
      try {
        const r = await online.signIn(p.name, pw);
        fails.delete(key);
        audio.ui('open');
        await afterSignIn(r.player, r.mergeOffer);
      } catch (ex) {
        go.querySelector('.btn-label')!.textContent = '登录';
        go.disabled = false;
        field.input.select();
        if (ex instanceof ApiError && ex.status === 429) {
          const m = /(\d+)\s*秒/.exec(ex.message);
          startLock(m ? Number(m[1]) : LOCK_SECONDS);
        } else if (ex instanceof ApiError && ex.status === 401) {
          const n = (fails.get(key) ?? 0) + 1;
          fails.set(key, n);
          audio.ui('deny');
          if (n >= LOCK_FAILS) {
            fails.delete(key);
            startLock(LOCK_SECONDS);
          } else err.textContent = n >= 3 ? `密码不对（已经错了 ${n} 次，错 ${LOCK_FAILS} 次要等 ${LOCK_SECONDS} 秒）` : '密码不对，再想想？';
        } else err.textContent = online.errorText(ex);
      }
    });
    show(panel);
    if (!lock()) field.input.focus();
    else {
      stopTimer();
      timer = setInterval(() => {
        if (!lock()) stopTimer();
      }, 250);
    }
  }

  // ------------------------------------------------------------ 新玩家

  function register(): void {
    const panel = h('form', 'panel ol-auth ol-reg');
    panel.noValidate = true;
    panel.append(h('div', 'panel-kicker', '新玩家'));
    const nameWrap = h('label', 'ol-field');
    const name = h('input', 'ol-input');
    name.type = 'text';
    name.maxLength = 24;
    name.setAttribute('autocomplete', 'nickname');
    name.spellcheck = false;
    name.placeholder = '名字（最多 12 个字）';
    name.setAttribute('aria-label', '名字');
    nameWrap.append(h('span', 'ol-label', '名字'), name);
    const pw1 = passwordField('密码', 'new-password', '4 到 32 位');
    const pw2 = passwordField('再输一次', 'new-password', '和上面一样');
    const gradeRow = h('div', 'ol-field');
    gradeRow.append(h('span', 'ol-label', '年级'));
    const seg = h('div', 'seg ol-grades');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', '年级');
    let grade = 3;
    const gbtns: HTMLButtonElement[] = [];
    for (const g of [3, 4, 5, 6]) {
      const b = h('button', 'seg-btn' + (g === grade ? ' is-active' : ''), GRADE_CN[g]);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(g === grade));
      b.addEventListener('click', () => {
        grade = g;
        audio.ui('click');
        for (const x of gbtns) {
          const on = x === b;
          x.classList.toggle('is-active', on);
          x.setAttribute('aria-checked', String(on));
        }
      });
      gbtns.push(b);
      seg.append(b);
    }
    gradeRow.append(seg);
    const err = h('div', 'ol-err');
    err.setAttribute('role', 'alert');
    const go = btn('创建并开始', 'btn btn-primary ol-go', () => panel.requestSubmit());
    go.type = 'submit';
    const back = btn('返回', 'btn btn-ghost', () => {
      audio.ui('click');
      void pick();
    });
    const grid = h('div', 'ol-reg-grid');
    grid.append(nameWrap, gradeRow, pw1.wrap, pw2.wrap);
    panel.append(grid, err, add(h('div', 'ol-acts'), back, go));
    setEsc(() => void pick());

    panel.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (go.disabled) return;
      const n = name.value.trim();
      const len = Array.from(n).length;
      const fail = (msg: string, el: HTMLInputElement) => {
        err.textContent = msg;
        el.focus();
        audio.ui('deny');
      };
      if (len < 1) return fail('请填写名字', name);
      if (len > 12) return fail('名字最多 12 个字', name);
      if (BAD_NAME.test(n)) return fail('名字里不能有 < > " \' & \\ / 这些符号', name);
      if (pw1.input.value.length < 4 || pw1.input.value.length > 32) return fail('密码需要 4 到 32 位', pw1.input);
      if (pw1.input.value !== pw2.input.value) return fail('两次输入的密码不一样', pw2.input);
      go.disabled = true;
      err.textContent = '';
      go.querySelector('.btn-label')!.textContent = '创建中…';
      try {
        const r = await online.register(n, pw1.input.value, grade);
        audio.ui('open');
        await afterSignIn(r.player, r.mergeOffer);
      } catch (ex) {
        go.disabled = false;
        go.querySelector('.btn-label')!.textContent = '创建并开始';
        err.textContent = online.errorText(ex);
        if (ex instanceof ApiError && ex.status === 409) name.select();
      }
    });
    show(panel);
  }

  // ------------------------------------------------------------ 合并离线进度

  async function afterSignIn(p: Player, offer: MergeOffer | null): Promise<void> {
    if (!offer) return finish('signedIn');
    const panel = h('div', 'panel ol-auth ol-merge');
    panel.append(h('div', 'panel-kicker', '离线进度'));
    panel.append(h('div', 'ol-merge-title', `欢迎，${p.name}！`));
    const parts: string[] = [];
    if (offer.levels) parts.push(`通关 ${offer.levels} 关（${offer.stars} 颗星）`);
    if (offer.answered) parts.push(`答题 ${offer.answered} 道`);
    if (offer.wrong) parts.push(`错题 ${offer.wrong} 道`);
    panel.append(h('p', 'ol-merge-msg', `这台设备上有之前离线玩的进度：${parts.join('、') || '一些记录'}。要把它们合并到你的账号吗？`));
    panel.append(h('p', 'ol-merge-note', '只合并到一个人的账号。如果这些不是你玩的，选"不合并"，进度会继续留在这台设备的离线游玩里。'));
    const err = h('div', 'ol-err');
    const yes = btn('合并到我的账号', 'btn btn-primary', async () => {
      audio.ui('open');
      yes.disabled = no.disabled = true;
      yes.querySelector('.btn-label')!.textContent = '合并中…';
      await online.resolveMerge(true);
      finish('signedIn');
    });
    const no = btn('不合并', 'btn btn-ghost', async () => {
      audio.ui('click');
      yes.disabled = no.disabled = true;
      await online.resolveMerge(false);
      finish('signedIn');
    });
    panel.append(err, add(h('div', 'ol-acts'), no, yes));
    setEsc(null);
    show(panel);
  }

  // 服务器状态提示
  const st = online.state;
  if (st === 'offline') status.append(h('span', 'tag', '离线'));
  void pick();
  return w;
}

/** 密码输入框：显示 / 隐藏；触屏时可在数字键盘和字母键盘之间切换 */
function passwordField(label: string, autocomplete: string, placeholder = ''): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = h('label', 'ol-field');
  wrap.append(h('span', 'ol-label', label));
  const row = h('span', 'ol-pw');
  const input = h('input', 'ol-input');
  input.type = 'password';
  input.setAttribute('autocomplete', autocomplete);
  input.maxLength = 32;
  input.spellcheck = false;
  input.autocapitalize = 'off';
  input.placeholder = placeholder || label;
  input.setAttribute('aria-label', label);
  input.inputMode = 'numeric';
  const eye = h('button', 'ol-pw-btn', '显示');
  eye.type = 'button';
  eye.setAttribute('aria-label', '显示密码');
  eye.setAttribute('aria-pressed', 'false');
  eye.addEventListener('click', (e) => {
    e.preventDefault();
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.textContent = show ? '隐藏' : '显示';
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    input.focus();
  });
  const kb = h('button', 'ol-pw-btn ol-kb', 'ABC');
  kb.type = 'button';
  kb.title = '切换数字 / 字母键盘';
  kb.setAttribute('aria-label', '切换到字母键盘');
  kb.addEventListener('click', (e) => {
    e.preventDefault();
    const num = input.inputMode === 'numeric';
    input.inputMode = num ? 'text' : 'numeric';
    kb.textContent = num ? '123' : 'ABC';
    kb.setAttribute('aria-label', num ? '切换到数字键盘' : '切换到字母键盘');
    input.blur();
    input.focus();
  });
  row.append(input, kb, eye);
  wrap.append(row);
  return { wrap, input };
}
