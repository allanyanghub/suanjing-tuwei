/** 小地图：静态层只在尺寸变化时绘制一次，动态层每帧绘制 */
import type { Match } from '../game/match.ts';
import { teamView } from '../render/models.ts';
import { CELL, COLS, GameMap, HALF_D, HALF_W, ROWS } from '../world/map.ts';
import { h } from './dom.ts';

const BLUE = '#35d6ff';
const RED = '#ff4d5e';
/** 我方 / 对方的颜色（联机对战里本机在红队时对调，见 teamView） */
const ALLY = () => (teamView.flip ? RED : BLUE);
const ENEMY = () => (teamView.flip ? BLUE : RED);
const SPIKE = '#ff8a3d';

export class Minimap {
  root = h('div', 'minimap');
  private cv = h('canvas', 'mm-canvas');
  private ctx = this.cv.getContext('2d')!;
  private stat = document.createElement('canvas');
  private cell = 0;
  private w = 0;
  private hgt = 0;
  private dpr = 1;
  private t = 0;

  constructor() {
    this.root.append(this.cv);
    window.addEventListener('resize', () => (this.w = 0));
  }

  private layout(): void {
    const r = this.cv.getBoundingClientRect();
    if (r.width < 4) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cell = (r.width * this.dpr) / COLS;
    this.w = Math.round(this.cell * COLS);
    this.hgt = Math.round(this.cell * ROWS);
    this.cv.width = this.w;
    this.cv.height = this.hgt;
    this.stat.width = this.w;
    this.stat.height = this.hgt;
    this.drawStatic();
  }

  private drawnLayout: readonly string[] | null = null;

  private drawStatic(): void {
    const g = this.stat.getContext('2d')!;
    const L = GameMap.layout();
    this.drawnLayout = L;
    const c = this.cell;
    g.clearRect(0, 0, this.w, this.hgt);
    for (let r = 0; r < ROWS; r++)
      for (let k = 0; k < COLS; k++) {
        const ch = L[r][k];
        if (ch === '#') continue;
        let col = 'rgba(176,198,236,0.20)';
        if (ch === 'A' || ch === 'B') col = 'rgba(255,184,77,0.30)';
        else if (ch === 'a') col = 'rgba(255,122,89,0.22)';
        else if (ch === 'd') col = 'rgba(74,168,255,0.22)';
        g.fillStyle = col;
        g.fillRect(k * c, r * c, c + 0.5, c + 0.5);
        if (ch === 'c' || ch === 'C') {
          g.fillStyle = ch === 'C' ? 'rgba(206,222,250,0.62)' : 'rgba(206,222,250,0.40)';
          const p = c * 0.12;
          g.fillRect(k * c + p, r * c + p, c - p * 2, c - p * 2);
        }
      }
    // 墙体边缘描线
    g.strokeStyle = 'rgba(214,230,255,0.55)';
    g.lineWidth = Math.max(1, c * 0.1);
    g.beginPath();
    for (let r = 0; r < ROWS; r++)
      for (let k = 0; k < COLS; k++) {
        if (L[r][k] !== '#') continue;
        const open = (rr: number, kk: number) => GameMap.cellAt(kk, rr) !== '#';
        if (open(r - 1, k)) {
          g.moveTo(k * c, r * c);
          g.lineTo((k + 1) * c, r * c);
        }
        if (open(r + 1, k)) {
          g.moveTo(k * c, (r + 1) * c);
          g.lineTo((k + 1) * c, (r + 1) * c);
        }
        if (open(r, k - 1)) {
          g.moveTo(k * c, r * c);
          g.lineTo(k * c, (r + 1) * c);
        }
        if (open(r, k + 1)) {
          g.moveTo((k + 1) * c, r * c);
          g.lineTo((k + 1) * c, (r + 1) * c);
        }
      }
    g.stroke();
    // A / B 标签
    g.fillStyle = 'rgba(255,214,140,0.95)';
    g.font = `800 ${Math.round(c * 2.6)}px "Avenir Next", "PingFang SC", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const id of ['A', 'B'] as const) {
      let r0 = ROWS,
        r1 = 0,
        k0 = COLS,
        k1 = 0;
      for (let r = 0; r < ROWS; r++)
        for (let k = 0; k < COLS; k++)
          if (L[r][k] === id) {
            r0 = Math.min(r0, r);
            r1 = Math.max(r1, r);
            k0 = Math.min(k0, k);
            k1 = Math.max(k1, k);
          }
      g.fillText(id, ((k0 + k1 + 1) / 2) * c, ((r0 + r1 + 1) / 2) * c);
    }
  }

  private px(x: number): number {
    return ((x + HALF_W) / CELL) * this.cell;
  }
  private pz(z: number): number {
    return ((z + HALF_D) / CELL) * this.cell;
  }

  private big = false;

  /** 放大地图（M 切换 / Caps Lock 按住 / 触屏点小地图） */
  setBig(on: boolean): void {
    if (on === this.big) return;
    this.big = on;
    this.root.classList.toggle('is-big', on);
    this.w = 0;
  }

  update(m: Match, dt: number): void {
    // 换了地图就重画静态层
    if (this.drawnLayout !== GameMap.layout() && this.w > 0) this.drawStatic();
    if (!this.w) this.layout();
    if (!this.w) return;
    this.t += dt;
    const g = this.ctx;
    const c = this.cell;
    g.clearRect(0, 0, this.w, this.hgt);
    g.drawImage(this.stat, 0, 0);

    // 熵核
    const s = m.spike;
    if (s.state === 'dropped' || s.state === 'planted') {
      const x = this.px(s.x),
        y = this.pz(s.z);
      const blink = s.state === 'planted' ? 0.55 + 0.45 * Math.sin(this.t * (s.timer < 10 ? 18 : 7)) : 1;
      g.save();
      g.globalAlpha = blink;
      g.translate(x, y);
      g.rotate(Math.PI / 4);
      g.fillStyle = SPIKE;
      g.strokeStyle = '#fff';
      g.lineWidth = c * 0.12;
      const r = c * 0.55;
      g.fillRect(-r, -r, r * 2, r * 2);
      g.strokeRect(-r, -r, r * 2, r * 2);
      g.restore();
      if (s.state === 'planted') {
        g.strokeStyle = 'rgba(255,138,61,0.7)';
        g.lineWidth = c * 0.12;
        g.beginPath();
        g.arc(x, y, c * (1 + ((this.t * 1.5) % 1) * 2.2), 0, Math.PI * 2);
        g.stroke();
      }
    }

    const me = m.player;
    for (const u of m.combatants) {
      if (u === me) continue;
      const x = this.px(u.body.x),
        y = this.pz(u.body.z);
      if (u.team === 0) {
        if (u.alive) this.dot(x, y, c * 0.5, ALLY(), u.hasSpike);
        else this.cross(x, y, c * 0.4, teamView.flip ? 'rgba(255,77,94,0.55)' : 'rgba(53,214,255,0.55)');
      } else if (u.alive && u.spottedT > 0) {
        g.globalAlpha = Math.min(1, u.spottedT / 0.6);
        this.dot(x, y, c * 0.5, ENEMY(), u.hasSpike);
        g.globalAlpha = 1;
      }
    }
    // 玩家箭头（北朝上，yaw=0 时朝 -Z 即屏幕上方）
    const x = this.px(me.body.x),
      y = this.pz(me.body.z);
    g.save();
    g.translate(x, y);
    g.rotate(-me.yaw);
    // 视野扇形
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, c * 5);
    grd.addColorStop(0, 'rgba(255,255,255,0.28)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, c * 5, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    g.closePath();
    g.fill();
    if (me.alive) {
      g.fillStyle = '#ffffff';
      g.strokeStyle = 'rgba(10,14,24,0.9)';
      g.lineWidth = c * 0.14;
      g.beginPath();
      g.moveTo(0, -c * 0.95);
      g.lineTo(c * 0.62, c * 0.6);
      g.lineTo(0, c * 0.28);
      g.lineTo(-c * 0.62, c * 0.6);
      g.closePath();
      g.stroke();
      g.fill();
    } else this.cross(0, 0, c * 0.5, '#fff');
    g.restore();
  }

  private dot(x: number, y: number, r: number, col: string, ring: boolean): void {
    const g = this.ctx;
    g.fillStyle = col;
    g.strokeStyle = 'rgba(8,12,22,0.9)';
    g.lineWidth = r * 0.3;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (ring) {
      g.strokeStyle = SPIKE;
      g.lineWidth = r * 0.35;
      g.beginPath();
      g.arc(x, y, r * 1.7, 0, Math.PI * 2);
      g.stroke();
    }
  }

  private cross(x: number, y: number, r: number, col: string): void {
    const g = this.ctx;
    g.strokeStyle = col;
    g.lineWidth = r * 0.4;
    g.beginPath();
    g.moveTo(x - r, y - r);
    g.lineTo(x + r, y + r);
    g.moveTo(x + r, y - r);
    g.lineTo(x - r, y + r);
    g.stroke();
  }
}
