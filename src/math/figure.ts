/**
 * 题目配图：用一组小函数拼出 SVG 字符串。
 * 约定：画布 viewBox 为 0 0 W H（默认 260×170），y 轴向下；配色固定为深色面板上的浅色线条，
 * 界面按宽度等比缩放。所有文字都经过转义。只画示意图，不要求按比例（题干里注明"图不按比例"即可省略）。
 */

export const FIG = {
  stroke: '#e8eef7',
  dim: '#8fa0b8',
  accent: '#ffb347',
  accent2: '#35d6ff',
  fill: 'rgba(53,214,255,0.22)',
  fill2: 'rgba(255,179,71,0.28)',
};

const esc = (s: string | number): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const n = (v: number): string => String(Math.round(v * 100) / 100);

export interface Style {
  stroke?: string;
  fill?: string;
  width?: number;
  dash?: boolean;
}

function attrs(st: Style | undefined, defFill = 'none'): string {
  const s = st ?? {};
  return `stroke="${s.stroke ?? FIG.stroke}" stroke-width="${s.width ?? 2}" fill="${s.fill ?? defFill}"${s.dash ? ' stroke-dasharray="5 4"' : ''} stroke-linejoin="round" stroke-linecap="round"`;
}

/** 把若干图元包成完整 SVG */
export function svg(parts: string[], w = 260, h = 170): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img">${parts.join('')}</svg>`;
}

export function line(x1: number, y1: number, x2: number, y2: number, st?: Style): string {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${attrs(st)}/>`;
}

export function polygon(pts: [number, number][], st?: Style): string {
  return `<polygon points="${pts.map((p) => `${n(p[0])},${n(p[1])}`).join(' ')}" ${attrs(st)}/>`;
}

export function polyline(pts: [number, number][], st?: Style): string {
  return `<polyline points="${pts.map((p) => `${n(p[0])},${n(p[1])}`).join(' ')}" ${attrs(st)}/>`;
}

export function rect(x: number, y: number, w: number, h: number, st?: Style): string {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${attrs(st)}/>`;
}

export function circle(cx: number, cy: number, r: number, st?: Style): string {
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" ${attrs(st)}/>`;
}

/** 圆弧（角度制，0° 指向右，逆时针为正——与数学习惯一致），可用于标角 */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, st?: Style): string {
  const p = (a: number): [number, number] => [cx + r * Math.cos((a * Math.PI) / 180), cy - r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 0 : 1;
  return `<path d="M ${n(x0)} ${n(y0)} A ${n(r)} ${n(r)} 0 ${large} ${sweep} ${n(x1)} ${n(y1)}" ${attrs(st)}/>`;
}

/** 扇形（含两条半径） */
export function sector(cx: number, cy: number, r: number, a0: number, a1: number, st?: Style): string {
  const p = (a: number): [number, number] => [cx + r * Math.cos((a * Math.PI) / 180), cy - r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 0 : 1;
  return `<path d="M ${n(cx)} ${n(cy)} L ${n(x0)} ${n(y0)} A ${n(r)} ${n(r)} 0 ${large} ${sweep} ${n(x1)} ${n(y1)} Z" ${attrs(st)}/>`;
}

export function text(x: number, y: number, s: string | number, opts?: { size?: number; color?: string; anchor?: 'start' | 'middle' | 'end'; bold?: boolean }): string {
  const o = opts ?? {};
  return `<text x="${n(x)}" y="${n(y)}" font-size="${o.size ?? 14}" fill="${o.color ?? FIG.stroke}" text-anchor="${o.anchor ?? 'middle'}" dominant-baseline="middle"${o.bold ? ' font-weight="700"' : ''} font-family="'Avenir Next','PingFang SC',sans-serif">${esc(s)}</text>`;
}

export function dot(x: number, y: number, r = 3, color: string = FIG.stroke): string {
  return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${color}"/>`;
}

/** 直角标记：顶点 (x,y)，两条边方向的单位向量 (ux,uy)、(vx,vy) */
export function rightAngle(x: number, y: number, ux: number, uy: number, vx: number, vy: number, s = 9): string {
  return polyline(
    [
      [x + ux * s, y + uy * s],
      [x + ux * s + vx * s, y + uy * s + vy * s],
      [x + vx * s, y + vy * s],
    ],
    { stroke: FIG.dim, width: 1.5 },
  );
}

/** r 行 c 列的方格网，左上角 (x,y)，格宽 cell */
export function grid(x: number, y: number, rows: number, cols: number, cell: number, st?: Style): string {
  const out: string[] = [];
  for (let i = 0; i <= rows; i++) out.push(line(x, y + i * cell, x + cols * cell, y + i * cell, st));
  for (let j = 0; j <= cols; j++) out.push(line(x + j * cell, y, x + j * cell, y + rows * cell, st));
  return out.join('');
}

/** 带刻度的尺寸标注：在线段 (x1,y1)-(x2,y2) 旁边写 label，off 为垂直偏移（像素，正值偏向线段左手侧） */
export function dimLabel(x1: number, y1: number, x2: number, y2: number, label: string | number, off = 14): string {
  const dx = x2 - x1,
    dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dy / len,
    ny = -dx / len;
  return text((x1 + x2) / 2 + nx * off, (y1 + y2) / 2 + ny * off, label, { size: 13, color: FIG.accent });
}
