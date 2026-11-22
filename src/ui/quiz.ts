/** 可复用的四选一题卡：准备阶段补给站、错题本重练都用它 */
import type { Question } from '../math/types.ts';
import { audio } from '../core/audio.ts';
import { h, keycap } from './dom.ts';

export const DIFF_NAMES = ['', '基础', '提高', '挑战'] as const;

/** 题目配图容器（默认隐藏；无配图时不占空间） */
export function figureBox(cls = ''): HTMLElement {
  const e = h('div', ('q-figure is-hidden ' + cls).trim());
  e.setAttribute('aria-hidden', 'true');
  return e;
}

/**
 * 写入题目配图。配图是 src/math/figure.ts 在本地生成的 SVG（可信内容），所以用 innerHTML；
 * 题干文字仍然一律用 textContent。只应在题目对象变化时调用。
 */
export function setFigure(box: HTMLElement, figure: string | undefined): void {
  box.innerHTML = figure ?? '';
  box.classList.toggle('is-hidden', !figure);
  // 记下配图宽高比，供高度受限时（局内解题面板）让卡片宽度随之收窄
  const vb = box.querySelector('svg')?.viewBox.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) box.style.setProperty('--fig-ar', (vb.width / vb.height).toFixed(3));
  else box.style.removeProperty('--fig-ar');
}

/** 带配图容器的题干块（错题本、结算回顾用） */
export function questionWithFigure(q: Question, textCls: string): HTMLElement[] {
  const text = h('div', textCls, q.text);
  if (!q.figure) return [text];
  const fig = figureBox();
  setFigure(fig, q.figure);
  return [text, fig];
}

export class QuizCard {
  root = h('div', 'quiz-card');
  private meta = h('div', 'quiz-meta');
  private text = h('div', 'quiz-text');
  private figure = figureBox();
  private optsWrap = h('div', 'quiz-opts');
  private opts: HTMLButtonElement[] = [];
  private result = h('div', 'quiz-result is-hidden');
  private resultHead = h('div', 'quiz-result-head');
  private explain = h('div', 'quiz-explain');
  q: Question | null = null;
  answered = false;

  constructor(private onPick: (i: number) => void) {
    for (let i = 0; i < 4; i++) {
      const b = h('button', 'quiz-opt');
      b.type = 'button';
      b.append(keycap(String(i + 1), 'opt-key'), h('span', 'opt-text'));
      b.addEventListener('click', () => this.pick(i));
      b.addEventListener('mouseenter', () => {
        if (!this.answered) audio.ui('hover');
      });
      this.opts.push(b);
      this.optsWrap.append(b);
    }
    this.result.append(this.resultHead, this.explain);
    this.root.append(this.meta, this.text, this.figure, this.optsWrap, this.result);
  }

  /** tag：题目来源标签（如「家长出题」「错题再练」），显示在题目信息行前面 */
  show(q: Question, meta: string, tag = ''): void {
    this.q = q;
    this.answered = false;
    this.meta.textContent = meta;
    if (tag) {
      const t = h('span', 'quiz-tag', tag);
      t.dataset.kind = tag === '家长出题' ? 'custom' : 'review';
      this.meta.prepend(t);
    }
    // 题干含 < > 等字符，只能用 textContent
    this.text.textContent = q.text;
    setFigure(this.figure, q.figure);
    q.options.forEach((o, i) => {
      const b = this.opts[i];
      b.className = 'quiz-opt';
      b.disabled = false;
      (b.querySelector('.opt-text') as HTMLElement).textContent = o;
    });
    this.result.classList.add('is-hidden');
    this.root.classList.remove('is-right', 'is-wrong');
    this.root.classList.add('is-fresh');
    requestAnimationFrame(() => this.root.classList.remove('is-fresh'));
  }

  /** 键盘或鼠标作答 */
  pick(i: number): void {
    if (this.answered || !this.q || i < 0 || i > 3) return;
    this.onPick(i);
  }

  /** 揭晓答案；extra 为额外的结果说明（如奖励） */
  reveal(picked: number, extra = ''): boolean {
    const q = this.q;
    if (!q) return false;
    this.answered = true;
    const ok = picked === q.answer;
    this.opts.forEach((b, i) => {
      b.disabled = true;
      b.classList.toggle('is-correct', i === q.answer);
      b.classList.toggle('is-wrong', i === picked && !ok);
      b.classList.toggle('is-dim', i !== q.answer && i !== picked);
    });
    this.root.classList.add(ok ? 'is-right' : 'is-wrong');
    this.resultHead.textContent = (ok ? '回答正确！' : `正确答案是 ${q.options[q.answer]}`) + (extra ? `  ${extra}` : '');
    this.explain.textContent = q.explain;
    this.result.classList.remove('is-hidden');
    return ok;
  }
}
