/**
 * 画布绘制的贴图：校园黑板 / 白板 / 海报 / 指示牌 / 钟面 / 旗帜图集、墙面喷漆图集、
 * 地面油漆标线与材质遮罩、灯光光斑、树叶卡片。
 */
import * as THREE from 'three';

export const SERIF = '"Times New Roman", "Georgia", "STIX Two Math", serif';
export const SANS = '"Helvetica Neue", "Arial", "PingFang SC", sans-serif';
export const CJK = '"PingFang SC", "Hiragino Sans GB", "Heiti SC", "Microsoft YaHei", sans-serif';
export const STENCIL = '"DIN Condensed", "Impact", "Arial Black", "PingFang SC", sans-serif';
const CHALK = '"Chalkboard SE", "Bradley Hand", "Comic Sans MS", "Kaiti SC", cursive';

export const css = (hex: number) => '#' + hex.toString(16).padStart(6, '0');

export function canvasTex(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** UV 矩形 u0 v0 u1 v1（已考虑 flipY） */
export type UVRect = [number, number, number, number];

// ============================================================ 校园图集
export type BoardId =
  | 'chalk1'
  | 'chalk2'
  | 'chalk3'
  | 'white1'
  | 'white2'
  | 'poster1'
  | 'poster2'
  | 'poster3'
  | 'poster4'
  | 'signAR'
  | 'signAL'
  | 'signBR'
  | 'signBL'
  | 'signAtk'
  | 'signDef'
  | 'notice'
  | 'plaque'
  | 'clock'
  | 'flagA'
  | 'flagB'
  | 'plateA'
  | 'plateB';

export interface BoardAtlas {
  tex: THREE.CanvasTexture;
  uv: Record<BoardId, UVRect>;
}

const PX = 400; // 像素 / 米

/** 粉笔质感：轻微抖动多描几次 */
function chalkText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, r: () => number, col = 'rgba(240,244,236,0.86)'): void {
  g.font = `${size}px ${CHALK}`;
  for (let k = 0; k < 3; k++) {
    g.fillStyle = col.replace(/[\d.]+\)$/, `${0.35 + k * 0.2})`);
    g.fillText(text, x + (r() - 0.5) * 1.6, y + (r() - 0.5) * 1.6);
  }
}

function chalkboard(g: CanvasRenderingContext2D, w: number, h: number, variant: number): void {
  const r = rng(31 + variant);
  // 黑板底色：深绿灰，带擦拭痕迹
  g.fillStyle = '#1f2a26';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(200,210,200,${0.015 + r() * 0.03})`;
    const x = r() * w,
      y = r() * h;
    g.beginPath();
    g.ellipse(x, y, 60 + r() * 220, 20 + r() * 60, r() * 0.4 - 0.2, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.035})`;
    g.fillRect(r() * w, r() * h, 1.5, 1.5);
  }
  g.strokeStyle = 'rgba(240,244,236,0.8)';
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  if (variant === 0) {
    // 勾股定理
    const ox = 70,
      oy = h - 90,
      a = 230,
      b = 170;
    g.beginPath();
    g.moveTo(ox, oy);
    g.lineTo(ox + a, oy);
    g.lineTo(ox, oy - b);
    g.closePath();
    g.stroke();
    g.strokeRect(ox, oy - 22, 22, 22);
    chalkText(g, 'a', ox + a / 2 - 8, oy + 40, 34, r);
    chalkText(g, 'b', ox - 36, oy - b / 2, 34, r);
    chalkText(g, 'c', ox + a / 2 + 14, oy - b / 2 - 10, 34, r);
    chalkText(g, 'a² + b² = c²', 360, 120, 64, r);
    chalkText(g, '3² + 4² = 5²', 380, 220, 44, r);
    chalkText(g, '5² + 12² = 13²', 380, 290, 44, r);
    chalkText(g, '勾三 股四 弦五', 380, 380, 40, r);
  } else if (variant === 1) {
    // 鸡兔同笼
    chalkText(g, '鸡兔同笼', 50, 80, 50, r);
    chalkText(g, '头 35  脚 94', 50, 150, 40, r);
    chalkText(g, '假设全是鸡：35 × 2 = 70', 50, 220, 36, r);
    chalkText(g, '94 − 70 = 24', 50, 280, 36, r);
    chalkText(g, '兔：24 ÷ 2 = 12（只）', 50, 340, 36, r);
    chalkText(g, '鸡：35 − 12 = 23（只）', 50, 400, 36, r);
    g.beginPath();
    g.arc(600, 160, 70, 0, Math.PI * 2);
    g.stroke();
    chalkText(g, 'S = πr²', 545, 280, 38, r);
  } else {
    // 等差数列求和 + 分数
    chalkText(g, '1 + 2 + 3 + … + n', 50, 90, 46, r);
    chalkText(g, '= n(n + 1) ÷ 2', 90, 160, 46, r);
    chalkText(g, '1 + 2 + … + 100 = 5050', 50, 250, 40, r);
    chalkText(g, '½ + ¼ + ⅛ + … → 1', 50, 340, 40, r);
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j <= i; j++) {
        g.beginPath();
        g.arc(560 + j * 26 - i * 13, 230 + i * 26, 8, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }
  // 粉笔槽阴影
  const gr = g.createLinearGradient(0, h - 30, 0, h);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = gr;
  g.fillRect(0, h - 30, w, 30);
}

function whiteboard(g: CanvasRenderingContext2D, w: number, h: number, variant: number): void {
  const r = rng(77 + variant);
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, '#f4f5f3');
  gr.addColorStop(1, '#e3e6e6');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  // 残留擦痕
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(120,130,150,${0.03 + r() * 0.04})`;
    g.beginPath();
    g.ellipse(r() * w, r() * h, 40 + r() * 120, 8 + r() * 20, r() - 0.5, 0, Math.PI * 2);
    g.fill();
  }
  g.lineCap = 'round';
  g.textAlign = 'left';
  if (variant === 0) {
    const ox = 60,
      oy = h - 70;
    g.strokeStyle = '#1d3f8a';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(ox - 20, oy);
    g.lineTo(ox + 300, oy);
    g.moveTo(ox + 140, oy + 20);
    g.lineTo(ox + 140, oy - 270);
    g.stroke();
    g.strokeStyle = '#b02a2a';
    g.lineWidth = 5;
    g.beginPath();
    for (let x = -120; x <= 120; x += 4) {
      const y = (x * x) / 60;
      if (x === -120) g.moveTo(ox + 140 + x, oy - y);
      else g.lineTo(ox + 140 + x, oy - y);
    }
    g.stroke();
    g.fillStyle = '#1d3f8a';
    g.font = `italic 600 42px ${SERIF}`;
    g.fillText('y = x²', 400, 90);
    g.font = `500 34px ${CJK}`;
    g.fillText('最值问题：顶点 (0, 0)', 400, 160);
    g.fillStyle = '#2b7a3a';
    g.fillText('课后练习 第 12 题', 400, 230);
  } else {
    g.fillStyle = '#1d3f8a';
    g.font = `600 40px ${CJK}`;
    g.fillText('本周奥数挑战', 40, 70);
    g.font = `500 32px ${CJK}`;
    const lines = ['① 植树问题：两端都种', '② 周期问题：星期几？', '③ 相遇与追及', '④ 容斥原理'];
    lines.forEach((t, i) => g.fillText(t, 50, 140 + i * 56));
    g.strokeStyle = '#b02a2a';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(520, 190, 60, 0, Math.PI * 2);
    g.arc(590, 190, 60, 0, Math.PI * 2);
    g.stroke();
  }
}

function poster(g: CanvasRenderingContext2D, w: number, h: number, variant: number): void {
  const r = rng(99 + variant);
  const bg = ['#24354f', '#efe6d2', '#7a2f2a', '#e9ecef'][variant];
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.textAlign = 'center';
  if (variant === 0) {
    g.fillStyle = '#f2c14e';
    g.font = `italic 700 190px ${SERIF}`;
    g.fillText('π', w / 2, 210);
    g.font = `500 15px ${SERIF}`;
    g.fillStyle = 'rgba(255,255,255,0.7)';
    const digits = '3.14159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706798214808651';
    for (let i = 0; i < 8; i++) g.fillText(digits.slice(i * 14, i * 14 + 14), w / 2, 260 + i * 18);
    g.font = `600 24px ${CJK}`;
    g.fillStyle = '#fff';
    g.fillText('圆周率日 3.14', w / 2, h - 30);
  } else if (variant === 1) {
    // 黄金螺线
    g.strokeStyle = '#8a5a2b';
    g.lineWidth = 2;
    let x = 30,
      y = 80,
      s = 220;
    for (let k = 0; k < 8; k++) {
      g.strokeRect(x, y, s, s);
      const ns = s / 1.618;
      if (k % 4 === 0) x += s;
      else if (k % 4 === 1) y += s;
      s = ns;
    }
    g.strokeStyle = '#c0392b';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(250, 300, 220, Math.PI, Math.PI * 1.5);
    g.stroke();
    g.fillStyle = '#3b2a1a';
    g.font = `italic 600 30px ${SERIF}`;
    g.fillText('φ = (1 + √5) / 2', w / 2, 50);
    g.font = `600 24px ${CJK}`;
    g.fillText('黄金分割', w / 2, h - 30);
  } else if (variant === 2) {
    g.fillStyle = '#f7e7c6';
    g.font = `700 52px ${CJK}`;
    g.fillText('奥数', w / 2, 100);
    g.fillText('挑战赛', w / 2, 160);
    g.strokeStyle = '#f7e7c6';
    g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.arc(w / 2, 270, 20 + i * 14, 0, Math.PI * 2);
      g.stroke();
    }
    g.font = `500 22px ${CJK}`;
    g.fillText('三至六年级 · 报名中', w / 2, h - 40);
  } else {
    // 质数表
    g.fillStyle = '#20314a';
    g.font = `700 32px ${CJK}`;
    g.fillText('100 以内的质数', w / 2, 50);
    g.font = `600 20px ${SANS}`;
    const isP = (n: number) => {
      if (n < 2) return false;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
      return true;
    };
    for (let n = 1; n <= 100; n++) {
      const cx = 30 + ((n - 1) % 10) * 22.5 + 11,
        cy = 80 + Math.floor((n - 1) / 10) * 28 + 20;
      if (isP(n)) {
        g.fillStyle = '#d64b3c';
        g.fillRect(cx - 11, cy - 18, 22, 25);
        g.fillStyle = '#fff';
      } else g.fillStyle = '#7d8794';
      g.font = `600 13px ${SANS}`;
      g.fillText(String(n), cx, cy);
    }
  }
  // 纸张老化与胶带
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.04})`;
    g.fillRect(r() * w, r() * h, 2, 2);
  }
  g.fillStyle = 'rgba(240,235,210,0.7)';
  g.fillRect(w / 2 - 30, 0, 60, 14);
}

function sign(g: CanvasRenderingContext2D, w: number, h: number, id: 'A' | 'B', dir: 1 | -1, col: number): void {
  g.fillStyle = '#f2f2ee';
  g.fillRect(0, 0, w, h);
  g.fillStyle = css(col);
  const bw = h;
  const bx = dir > 0 ? 0 : w - bw;
  g.fillRect(bx, 0, bw, h);
  g.fillStyle = '#fff';
  g.font = `700 ${h * 0.78}px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(id, bx + bw / 2, h / 2 + 4);
  g.fillStyle = '#222';
  g.font = `600 ${h * 0.42}px ${CJK}`;
  g.fillText(`${id} 点`, w / 2 + (dir > 0 ? bw / 2 : -bw / 2) - 40 * dir, h / 2 + 2);
  // 箭头
  const ax = dir > 0 ? w - 60 : 60;
  g.fillStyle = '#222';
  g.beginPath();
  g.moveTo(ax + dir * 34, h / 2);
  g.lineTo(ax - dir * 6, h / 2 - 34);
  g.lineTo(ax - dir * 6, h / 2 - 14);
  g.lineTo(ax - dir * 40, h / 2 - 14);
  g.lineTo(ax - dir * 40, h / 2 + 14);
  g.lineTo(ax - dir * 6, h / 2 + 14);
  g.lineTo(ax - dir * 6, h / 2 + 34);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, w - 4, h - 4);
}

function spawnSign(g: CanvasRenderingContext2D, w: number, h: number, text: string, col: number): void {
  g.fillStyle = css(col);
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, h - 14, w, 14);
  g.fillStyle = '#fff';
  g.font = `700 ${h * 0.5}px ${CJK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
}

function plate(g: CanvasRenderingContext2D, w: number, h: number, id: string, col: number): void {
  g.fillStyle = '#1d1f22';
  g.fillRect(0, 0, w, h);
  g.fillStyle = css(col);
  g.fillRect(16, 16, w - 32, h - 32);
  g.fillStyle = '#fff';
  g.font = `800 ${h * 0.62}px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(id, w / 2, h * 0.47);
  g.font = `700 ${h * 0.11}px ${CJK}`;
  g.fillText('目标区', w / 2, h * 0.86);
}

function flag(g: CanvasRenderingContext2D, w: number, h: number, id: string, col: number): void {
  g.fillStyle = css(col);
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.beginPath();
  g.arc(w * 0.5, h * 0.5, h * 0.36, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = css(col);
  g.font = `800 ${h * 0.52}px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(id, w * 0.5, h * 0.53);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 0, 18, h);
}

function clock(g: CanvasRenderingContext2D, s: number): void {
  const c = s / 2;
  g.fillStyle = '#2a2c30';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#efe9da';
  g.beginPath();
  g.arc(c, c, c * 0.92, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#1e1e1e';
  g.lineWidth = 8;
  g.stroke();
  g.fillStyle = '#1e1e1e';
  g.font = `600 ${s * 0.09}px ${SERIF}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const rom = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    g.fillText(rom[i], c + Math.cos(a) * c * 0.72, c + Math.sin(a) * c * 0.72);
    g.fillRect(c + Math.cos(a) * c * 0.86 - 3, c + Math.sin(a) * c * 0.86 - 3, 6, 6);
  }
  g.lineCap = 'round';
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(c, c);
  g.lineTo(c + Math.cos(-2.3) * c * 0.45, c + Math.sin(-2.3) * c * 0.45);
  g.stroke();
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(c, c);
  g.lineTo(c + Math.cos(-0.2) * c * 0.66, c + Math.sin(-0.2) * c * 0.66);
  g.stroke();
}

function notice(g: CanvasRenderingContext2D, w: number, h: number): void {
  const r = rng(5);
  g.fillStyle = '#a77d4f';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? '60,35,10' : '230,200,150'},${r() * 0.25})`;
    g.fillRect(r() * w, r() * h, 2, 2);
  }
  const papers = ['#f5f3ea', '#fdf3b5', '#dff0f7', '#f7dede'];
  for (let i = 0; i < 7; i++) {
    const pw = 90 + r() * 70,
      ph = 110 + r() * 60;
    const x = 20 + r() * (w - pw - 40),
      y = 20 + r() * (h - ph - 40);
    g.save();
    g.translate(x + pw / 2, y + ph / 2);
    g.rotate((r() - 0.5) * 0.12);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillRect(-pw / 2 + 3, -ph / 2 + 4, pw, ph);
    g.fillStyle = papers[i % 4];
    g.fillRect(-pw / 2, -ph / 2, pw, ph);
    g.fillStyle = 'rgba(40,40,60,0.55)';
    for (let l = 0; l < 6; l++) g.fillRect(-pw / 2 + 10, -ph / 2 + 18 + l * 14, pw * (0.5 + r() * 0.35), 4);
    g.fillStyle = '#c0392b';
    g.beginPath();
    g.arc(0, -ph / 2 + 6, 5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

function plaqueTile(g: CanvasRenderingContext2D, w: number, h: number): void {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#b8955a');
  gr.addColorStop(1, '#8c6c3a');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(60,40,10,0.6)';
  g.lineWidth = 6;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = '#2c1f0c';
  g.font = `700 ${h * 0.42}px ${CJK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('算 境 书 院', w / 2, h / 2 + 2);
}

export function paintBoards(zone: { A: number; B: number; atk: number; def: number }): BoardAtlas {
  const W = 2048,
    H = 2560;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#777';
  g.fillRect(0, 0, W, H);
  const uv = {} as Record<BoardId, UVRect>;
  let x = 0,
    y = 0,
    rowH = 0;
  const pad = 6;
  const add = (id: BoardId, wm: number, hm: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const w = Math.round(wm * PX),
      h = Math.round(hm * PX);
    if (x + w > W) {
      x = 0;
      y += rowH + pad;
      rowH = 0;
    }
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    draw(g, w, h);
    g.restore();
    uv[id] = [(x + 1) / W, 1 - (y + h - 1) / H, (x + w - 1) / W, 1 - (y + 1) / H];
    x += w + pad;
    rowH = Math.max(rowH, h);
  };
  add('chalk1', 1.8, 1.2, (g, w, h) => chalkboard(g, w, h, 0));
  add('chalk2', 1.8, 1.2, (g, w, h) => chalkboard(g, w, h, 1));
  add('chalk3', 1.8, 1.2, (g, w, h) => chalkboard(g, w, h, 2));
  add('white1', 1.6, 1.0, (g, w, h) => whiteboard(g, w, h, 0));
  add('white2', 1.6, 1.0, (g, w, h) => whiteboard(g, w, h, 1));
  add('flagA', 1.5, 1.0, (g, w, h) => flag(g, w, h, 'A', zone.A));
  add('flagB', 1.5, 1.0, (g, w, h) => flag(g, w, h, 'B', zone.B));
  add('poster1', 0.6, 0.85, (g, w, h) => poster(g, w, h, 0));
  add('poster2', 0.6, 0.85, (g, w, h) => poster(g, w, h, 1));
  add('poster3', 0.6, 0.85, (g, w, h) => poster(g, w, h, 2));
  add('poster4', 0.6, 0.85, (g, w, h) => poster(g, w, h, 3));
  add('clock', 1.0, 1.0, (g, w) => clock(g, w));
  add('plateA', 1.0, 1.0, (g, w, h) => plate(g, w, h, 'A', zone.A));
  add('plateB', 1.0, 1.0, (g, w, h) => plate(g, w, h, 'B', zone.B));
  add('notice', 1.2, 0.9, (g, w, h) => notice(g, w, h));
  add('signAtk', 2.4, 0.42, (g, w, h) => spawnSign(g, w, h, '进攻方出发区', zone.atk));
  add('signDef', 2.4, 0.42, (g, w, h) => spawnSign(g, w, h, '防守方出发区', zone.def));
  add('signAR', 1.2, 0.36, (g, w, h) => sign(g, w, h, 'A', 1, zone.A));
  add('signAL', 1.2, 0.36, (g, w, h) => sign(g, w, h, 'A', -1, zone.A));
  add('signBR', 1.2, 0.36, (g, w, h) => sign(g, w, h, 'B', 1, zone.B));
  add('signBL', 1.2, 0.36, (g, w, h) => sign(g, w, h, 'B', -1, zone.B));
  add('plaque', 1.4, 0.5, plaqueTile);
  if (y + rowH > H) console.warn('校园图集溢出');
  const tex = canvasTex(c);
  return { tex, uv };
}

// ============================================================ 墙面喷漆图集（alpha 为漆面覆盖）
export type StencilId = 'A' | 'B' | 'arrowR' | 'arrowL' | 'pi' | 'sum' | 'sqrt' | 'phi' | 'up' | 'fragile' | 'batch' | 'logo';
const STENCIL_ORDER: StencilId[] = ['A', 'B', 'arrowR', 'arrowL', 'pi', 'sum', 'sqrt', 'phi', 'up', 'fragile', 'batch', 'logo'];

export function paintStencils(): { tex: THREE.CanvasTexture; uv: Record<StencilId, UVRect> } {
  const S = 512;
  const R = 3;
  const [c, g] = canvas(S * 4, S * R);
  g.clearRect(0, 0, S * 4, S * R);
  const uv = {} as Record<StencilId, UVRect>;
  STENCIL_ORDER.forEach((id, i) => {
    const x = (i % 4) * S,
      y = Math.floor(i / 4) * S;
    g.save();
    g.translate(x, y);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (id === 'A' || id === 'B') {
      g.font = `700 ${S * 0.95}px ${STENCIL}`;
      g.fillText(id, S / 2, S * 0.55);
      // 镂空模板的连接桥
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(S * 0.47, 0, S * 0.06, S * 0.3);
      g.fillRect(0, S * 0.62, S, S * 0.035);
      g.globalCompositeOperation = 'source-over';
    } else if (id === 'arrowR' || id === 'arrowL') {
      const d = id === 'arrowR' ? 1 : -1;
      g.translate(S / 2, S / 2);
      g.scale(d, 1);
      g.beginPath();
      g.moveTo(230, 0);
      g.lineTo(40, -170);
      g.lineTo(40, -70);
      g.lineTo(-230, -70);
      g.lineTo(-230, 70);
      g.lineTo(40, 70);
      g.lineTo(40, 170);
      g.closePath();
      g.fill();
    } else if (id === 'up') {
      for (const dx of [-110, 110]) {
        g.beginPath();
        g.moveTo(S / 2 + dx, 70);
        g.lineTo(S / 2 + dx + 90, 200);
        g.lineTo(S / 2 + dx + 35, 200);
        g.lineTo(S / 2 + dx + 35, 330);
        g.lineTo(S / 2 + dx - 35, 330);
        g.lineTo(S / 2 + dx - 35, 200);
        g.lineTo(S / 2 + dx - 90, 200);
        g.closePath();
        g.fill();
      }
      g.fillRect(S / 2 - 200, 370, 400, 28);
      g.font = `700 70px ${CJK}`;
      g.fillText('此面向上', S / 2, 450);
    } else if (id === 'fragile') {
      g.font = `700 120px ${CJK}`;
      g.fillText('易 碎', S / 2, S * 0.36);
      g.lineWidth = 16;
      g.strokeStyle = '#fff';
      g.strokeRect(40, 40, S - 80, S - 80);
      g.font = `700 64px ${CJK}`;
      g.fillText('小心轻放', S / 2, S * 0.7);
    } else if (id === 'batch') {
      g.font = `700 80px ${CJK}`;
      g.fillText('教学用具', S / 2, S * 0.3);
      g.font = `700 110px ${STENCIL}`;
      g.fillText('No.314', S / 2, S * 0.62);
      g.font = `700 54px ${CJK}`;
      g.fillText('数学组', S / 2, S * 0.86);
    } else if (id === 'logo') {
      g.lineWidth = 22;
      g.strokeStyle = '#fff';
      g.beginPath();
      g.arc(S / 2, S * 0.42, S * 0.3, 0, Math.PI * 2);
      g.stroke();
      g.font = `italic 700 ${S * 0.36}px ${SERIF}`;
      g.fillText('∑', S / 2, S * 0.44);
      g.font = `700 64px ${CJK}`;
      g.fillText('算境书院', S / 2, S * 0.88);
    } else {
      const t = { pi: 'π', sum: 'Σ', sqrt: '√2', phi: 'φ' }[id];
      g.font = `italic 700 ${S * 0.7}px ${SERIF}`;
      g.fillText(t, S / 2, S * 0.52);
    }
    g.restore();
    uv[id] = [x / (S * 4), 1 - (y + S) / (S * R), (x + S) / (S * 4), 1 - y / (S * R)];
  });
  return { tex: canvasTex(c), uv };
}

// ============================================================ 地面：油漆标线 + 材质遮罩
export interface FloorPaintInput {
  rect: { x0: number; z0: number; w: number; d: number };
  sites: { id: 'A' | 'B'; x0: number; z0: number; x1: number; z1: number; col: number }[];
  spawns: { text: string; x0: number; z0: number; x1: number; z1: number; col: number; flip: boolean }[];
  /** 路线箭头：点列 + 颜色 + 标签 */
  routes: { pts: { x: number; z: number }[]; col: number; label: string }[];
  /** 墙格（世界矩形） */
  walls: { x0: number; z0: number; x1: number; z1: number }[];
  /** 掩体 */
  crates: { x0: number; z0: number; x1: number; z1: number }[];
  numberLine: { x0: number; x1: number; z: number } | null;
}

export function paintFloor(inp: FloorPaintInput): { paint: THREE.CanvasTexture; mask: THREE.CanvasTexture } {
  const PPM_P = 32,
    PPM_M = 8;
  const { x0, z0, w, d } = inp.rect;
  // ---------- 遮罩：R = 第二材质（水泥），G = 积尘
  const [mc, m] = canvas(Math.round(w * PPM_M), Math.round(d * PPM_M));
  m.fillStyle = '#000';
  m.fillRect(0, 0, mc.width, mc.height);
  const MX = (x: number) => (x - x0) * PPM_M,
    MZ = (z: number) => (z - z0) * PPM_M;
  m.fillStyle = 'rgb(255,0,0)';
  for (const s of [...inp.sites, ...inp.spawns]) m.fillRect(MX(s.x0) - 2, MZ(s.z0) - 2, (s.x1 - s.x0) * PPM_M + 4, (s.z1 - s.z0) * PPM_M + 4);
  // 墙根水泥散水带
  for (const b of inp.walls) m.fillRect(MX(b.x0) - 0.7 * PPM_M, MZ(b.z0) - 0.7 * PPM_M, (b.x1 - b.x0 + 1.4) * PPM_M, (b.z1 - b.z0 + 1.4) * PPM_M);
  // 积尘：墙根 / 箱子周围模糊
  const [gc, gg] = canvas(mc.width, mc.height);
  gg.fillStyle = '#000';
  gg.fillRect(0, 0, gc.width, gc.height);
  gg.filter = 'blur(6px)';
  gg.fillStyle = 'rgba(0,255,0,0.95)';
  for (const b of inp.walls) gg.fillRect(MX(b.x0) - 3, MZ(b.z0) - 3, (b.x1 - b.x0) * PPM_M + 6, (b.z1 - b.z0) * PPM_M + 6);
  gg.fillStyle = 'rgba(0,255,0,0.7)';
  for (const b of inp.crates) gg.fillRect(MX(b.x0) - 2, MZ(b.z0) - 2, (b.x1 - b.x0) * PPM_M + 4, (b.z1 - b.z0) * PPM_M + 4);
  gg.filter = 'blur(14px)';
  const r = rng(17);
  for (let i = 0; i < 70; i++) {
    gg.fillStyle = `rgba(0,255,0,${0.08 + r() * 0.2})`;
    gg.beginPath();
    gg.ellipse(r() * gc.width, r() * gc.height, 10 + r() * 50, 8 + r() * 30, r() * 3, 0, Math.PI * 2);
    gg.fill();
  }
  gg.filter = 'none';
  m.globalCompositeOperation = 'lighter';
  m.drawImage(gc, 0, 0);
  m.globalCompositeOperation = 'source-over';
  // 墙体内部（被墙盖住）不必关心
  // ---------- 油漆
  const [pc, p] = canvas(Math.round(w * PPM_P), Math.round(d * PPM_P));
  p.clearRect(0, 0, pc.width, pc.height);
  const X = (x: number) => (x - x0) * PPM_P,
    Z = (z: number) => (z - z0) * PPM_P;
  const M = PPM_P;
  // 目标区：黑黄警示边 + 分区色描边 + 大字母
  for (const s of inp.sites) {
    const sx = X(s.x0),
      sz = Z(s.z0),
      sw = (s.x1 - s.x0) * M,
      sd = (s.z1 - s.z0) * M;
    const bw = 0.42 * M;
    p.save();
    p.beginPath();
    p.rect(sx, sz, sw, sd);
    p.rect(sx + bw, sz + bw, sw - bw * 2, sd - bw * 2);
    p.clip('evenodd');
    p.fillStyle = '#d8b21f';
    p.fillRect(sx, sz, sw, sd);
    p.fillStyle = '#1c1c1c';
    for (let t = -sd; t < sw + sd; t += 0.6 * M) {
      p.beginPath();
      p.moveTo(sx + t, sz);
      p.lineTo(sx + t + 0.3 * M, sz);
      p.lineTo(sx + t + 0.3 * M - sd, sz + sd);
      p.lineTo(sx + t - sd, sz + sd);
      p.closePath();
      p.fill();
    }
    p.restore();
    p.strokeStyle = css(s.col);
    p.lineWidth = 0.14 * M;
    p.strokeRect(sx + bw + 0.3 * M, sz + bw + 0.3 * M, sw - bw * 2 - 0.6 * M, sd - bw * 2 - 0.6 * M);
    p.fillStyle = css(s.col);
    p.font = `700 ${Math.min(sw, sd) * 0.62}px ${STENCIL}`;
    p.textAlign = 'center';
    p.textBaseline = 'middle';
    p.fillText(s.id, sx + sw / 2, sz + sd / 2 + 0.2 * M);
  }
  // 出生区：分区色边框 + 文字
  for (const s of inp.spawns) {
    const sx = X(s.x0),
      sz = Z(s.z0),
      sw = (s.x1 - s.x0) * M,
      sd = (s.z1 - s.z0) * M;
    p.strokeStyle = css(s.col);
    p.lineWidth = 0.16 * M;
    p.setLineDash([0.9 * M, 0.45 * M]);
    p.strokeRect(sx + 0.2 * M, sz + 0.2 * M, sw - 0.4 * M, sd - 0.4 * M);
    p.setLineDash([]);
    p.save();
    p.translate(sx + sw / 2, sz + sd / 2);
    if (s.flip) p.rotate(Math.PI);
    p.fillStyle = css(s.col);
    p.font = `700 ${0.9 * M}px ${CJK}`;
    p.textAlign = 'center';
    p.textBaseline = 'middle';
    p.fillText(s.text, 0, -sd / 2 + 1.3 * M);
    p.restore();
  }
  // 路线箭头（人字形）
  for (const rt of inp.routes) {
    let acc = 0;
    let next = 2.5;
    p.fillStyle = css(rt.col);
    for (let i = 1; i < rt.pts.length && next < 34; i++) {
      const a = rt.pts[i - 1],
        b = rt.pts[i];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      while (next <= acc + L && next < 34) {
        const t = (next - acc) / L;
        const cx = a.x + (b.x - a.x) * t,
          cz = a.z + (b.z - a.z) * t;
        const ang = Math.atan2(b.z - a.z, b.x - a.x);
        p.save();
        p.translate(X(cx), Z(cz));
        p.rotate(ang);
        p.beginPath();
        const s = M;
        p.moveTo(0.45 * s, 0);
        p.lineTo(-0.15 * s, -0.55 * s);
        p.lineTo(-0.45 * s, -0.55 * s);
        p.lineTo(0.12 * s, 0);
        p.lineTo(-0.45 * s, 0.55 * s);
        p.lineTo(-0.15 * s, 0.55 * s);
        p.closePath();
        p.fill();
        if (Math.abs(next - 2.5) < 0.01) {
          p.rotate(-ang);
          p.font = `700 ${0.9 * s}px ${STENCIL}`;
          p.textAlign = 'center';
          p.textBaseline = 'middle';
          p.fillText(rt.label, 0, -1.2 * s);
        }
        p.restore();
        next += 2.6;
      }
      acc += L;
    }
  }
  // 数轴（数学书院的地面装饰）
  if (inp.numberLine) {
    const nl = inp.numberLine;
    p.strokeStyle = '#e9e4d6';
    p.fillStyle = '#e9e4d6';
    p.lineWidth = 0.08 * M;
    p.beginPath();
    p.moveTo(X(nl.x0), Z(nl.z));
    p.lineTo(X(nl.x1), Z(nl.z));
    p.stroke();
    const n = 10;
    p.font = `600 ${0.5 * M}px ${SANS}`;
    p.textAlign = 'center';
    p.textBaseline = 'top';
    for (let i = 0; i <= n; i++) {
      const x = nl.x0 + 0.5 + ((nl.x1 - nl.x0 - 1) * i) / n;
      p.fillRect(X(x) - 0.04 * M, Z(nl.z) - 0.25 * M, 0.08 * M, 0.5 * M);
      p.fillText(String(i), X(x), Z(nl.z) + 0.35 * M);
    }
    p.beginPath();
    p.moveTo(X(nl.x1) + 0.4 * M, Z(nl.z));
    p.lineTo(X(nl.x1) - 0.1 * M, Z(nl.z) - 0.3 * M);
    p.lineTo(X(nl.x1) - 0.1 * M, Z(nl.z) + 0.3 * M);
    p.fill();
  }
  const paint = canvasTex(pc);
  const mask = canvasTex(mc, false);
  return { paint, mask };
}

// ============================================================ 光斑
export function paintPool(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 40, 1, 64, 58, 60);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.2, 'rgba(255,255,255,0.5)');
  gr.addColorStop(0.55, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return canvasTex(c, false);
}

/** 地面圆形光斑 */
export function paintRound(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 1, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return canvasTex(c, false);
}

// ============================================================ 树叶卡片（照片扫描叶片抠图后随机贴成叶簇）
const LEAF_RECTS: [number, number, number, number][] = [
  [8, 10, 68, 200],
  [85, 10, 88, 190],
  [185, 15, 64, 175],
  [265, 22, 68, 165],
  [355, 10, 64, 205],
  [8, 320, 86, 180],
  [110, 298, 74, 210],
  [215, 310, 74, 195],
];

export function paintLeaves(photo: CanvasImageSource & { width: number; height: number }): THREE.CanvasTexture {
  // 抠图：黑底 → 透明
  const [kc, k] = canvas(512, 512);
  k.drawImage(photo, 0, 0, 512, 512);
  const id = k.getImageData(0, 0, 512, 512);
  const px = id.data;
  for (let i = 0; i < px.length; i += 4) {
    const m = Math.max(px[i], px[i + 1], px[i + 2]) / 255;
    const a = Math.min(1, Math.max(0, (m - 0.06) / 0.08));
    px[i + 3] = Math.round(a * 255);
  }
  k.putImageData(id, 0, 0);
  const S = 512;
  const [c, g] = canvas(S, S);
  g.clearRect(0, 0, S, S);
  const r = rng(3);
  for (let i = 0; i < 230; i++) {
    const a = r() * Math.PI * 2;
    const rr = Math.pow(r(), 0.65) * S * 0.44;
    const x = S / 2 + Math.cos(a) * rr,
      y = S / 2 + Math.sin(a) * rr;
    const [lx, ly, lw, lh] = LEAF_RECTS[Math.floor(r() * LEAF_RECTS.length)];
    const sc = (0.2 + r() * 0.14) * (1 - rr / S);
    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI * 2);
    g.scale(sc * (r() > 0.5 ? 1 : -1), sc);
    // 背光的叶子更暗
    g.filter = `brightness(${0.55 + r() * 0.6})`;
    g.drawImage(kc, lx, ly, lw, lh, -lw / 2, -lh * 0.9, lw, lh);
    g.restore();
  }
  g.filter = 'none';
  const t = canvasTex(c);
  return t;
}
