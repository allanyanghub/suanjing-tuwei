/**
 * 角色卡面 / 立绘图片（美术放在 public/assets/characters/）：
 * - card_<id>.png：900×1400 透明底，大腿以上、脸在上三分之一 —— 选角卡片的整卡背景；
 * - portrait_<id>.png：头像立绘 —— 用于小徽标（简报、标题页）；没有卡面时也拿来当卡片背景。
 * 进入菜单前随其他素材一起预载（每个文件只试一次，结果记住）：界面出现时图片已解码，不会跳动；
 * 缺的文件直接退回原来的文字徽标，之后不再请求。
 */
import { AGENTS } from '../data/defs.ts';
import { ASSET_BASE, registerPreload } from '../render/assets.ts';
import { h } from './dom.ts';

type Kind = 'card' | 'portrait';
const url = (kind: Kind, id: string) => `${ASSET_BASE}characters/${kind}_${id}.png`;
/** 预载成功的图片地址 */
const ok = new Set<string>();

function preload(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      ok.add(src);
      void (img.decode?.() ?? Promise.resolve()).catch(() => undefined).then(() => resolve());
    };
    img.onerror = () => resolve();
    img.src = src;
  });
}

registerPreload(() => Promise.all(AGENTS.flatMap((a) => [preload(url('card', a.id)), preload(url('portrait', a.id))])));

const has = (kind: Kind, id: string) => ok.has(url(kind, id));

/** 选角卡片的背景图（优先卡面，其次立绘）；都没有时为 null */
export function agentCardArt(id: string): string | null {
  if (has('card', id)) return url('card', id);
  if (has('portrait', id)) return url('portrait', id);
  return null;
}

/** 小徽标用的头像图：卡面的头部特写（头在上三分之一，裁切清楚）；没有卡面时用立绘；都没有时为 null */
export function agentFaceArt(id: string): { src: string; card: boolean } | null {
  if (has('card', id)) return { src: url('card', id), card: true };
  if (has('portrait', id)) return { src: url('portrait', id), card: false };
  return null;
}

/** 角色图片元素（预载过的直接可用；装饰性，alt 为空） */
export function artImg(src: string, cls: string): HTMLImageElement {
  const img = h('img', cls);
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  img.src = src;
  return img;
}

/**
 * 角色小徽标：有图片时显示头像（六边形裁切），否则保持原来的文字徽标。
 * cls 沿用原来的 pa-badge / pa-badge sm。
 */
export function agentBadge(id: string, name: string, cls: string): HTMLElement {
  const face = agentFaceArt(id);
  const b = h('div', cls, face ? undefined : name);
  if (face) {
    // 背景图方式裁出头部（图片已预载，不会闪）
    b.classList.add('has-art', face.card ? 'from-card' : 'from-portrait');
    // 转成绝对地址：CSS 变量里的相对 url() 会按样式表（dist/assets/）解析，打包后会变成 assets/assets/…
    b.style.setProperty('--art', `url("${new URL(face.src, document.baseURI).href}")`);
    b.setAttribute('role', 'img');
    b.setAttribute('aria-label', name);
  }
  return b;
}
