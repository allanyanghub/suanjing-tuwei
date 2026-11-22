// 离线 DSP 小工具库：滤波、包络、变调、混响、限幅、响度。全部为单声道 Float32Array 操作（立体声 = 两条）。
export const SR = 48000;

let seed = 12345;
/** 可复现的伪随机 */
export function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
export function setSeed(s) {
  seed = s >>> 0;
}
export const rr = (a, b) => a + (b - a) * rand();

export const zeros = (sec, sr = SR) => new Float32Array(Math.max(1, Math.round(sec * sr)));
export const dbToLin = (db) => 10 ** (db / 20);
export const linToDb = (x) => (x > 0 ? 20 * Math.log10(x) : -200);

/** 截取 [t0, t1) 秒 */
export function slice(x, t0, t1, sr = SR) {
  const a = Math.max(0, Math.round(t0 * sr));
  const b = Math.min(x.length, Math.round(t1 * sr));
  return x.slice(a, Math.max(a + 1, b));
}

/** 淡入淡出（秒）；淡出用等功率余弦 */
export function fade(x, fin = 0.002, fout = 0.05, sr = SR) {
  const y = Float32Array.from(x);
  const ni = Math.min(y.length, Math.round(fin * sr));
  const no = Math.min(y.length, Math.round(fout * sr));
  for (let i = 0; i < ni; i++) y[i] *= Math.sin((i / ni) * Math.PI * 0.5);
  for (let i = 0; i < no; i++) y[y.length - 1 - i] *= Math.sin((i / no) * Math.PI * 0.5);
  return y;
}

/** 指数衰减尾：从 t0 开始以 tau 秒衰减（用于截短录音的自然尾） */
export function decayFrom(x, t0, tau, sr = SR) {
  const y = Float32Array.from(x);
  const s = Math.round(t0 * sr);
  for (let i = s; i < y.length; i++) y[i] *= Math.exp(-(i - s) / (tau * sr));
  return y;
}

export function gain(x, g) {
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
  return y;
}

export function peak(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}

export function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

/** 归一化到峰值 dB */
export function normPeak(x, db = -1) {
  const p = peak(x) || 1;
  return gain(x, dbToLin(db) / p);
}

/** 把 b 加到 a 的 at 秒处（a 必要时加长） */
export function mixInto(a, b, at = 0, g = 1, sr = SR) {
  const off = Math.round(at * sr);
  let y = a;
  if (off + b.length > a.length) {
    y = new Float32Array(off + b.length);
    y.set(a);
  }
  for (let i = 0; i < b.length; i++) if (off + i >= 0) y[off + i] += b[i] * g;
  return y;
}

/** 首个超过阈值的采样位置（秒） */
export function onset(x, thrDb = -30, sr = SR) {
  const p = peak(x);
  const t = p * dbToLin(thrDb);
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > t) return i / sr;
  return 0;
}

// ------------------------------------------------------------ 滤波（RBJ 双二阶）

export function biquadCoefs(type, f, q = 0.707, gainDb = 0, sr = SR) {
  const w = (2 * Math.PI * Math.min(f, sr * 0.49)) / sr;
  const cs = Math.cos(w),
    sn = Math.sin(w);
  const al = sn / (2 * q);
  const A = 10 ** (gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lp':
      b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
      break;
    case 'hp':
      b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
      break;
    case 'bp':
      b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
      break;
    case 'peak':
      b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * al;
      b0 = A * (A + 1 - (A - 1) * cs + s); b1 = 2 * A * (A - 1 - (A + 1) * cs); b2 = A * (A + 1 - (A - 1) * cs - s);
      a0 = A + 1 + (A - 1) * cs + s; a1 = -2 * (A - 1 + (A + 1) * cs); a2 = A + 1 + (A - 1) * cs - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * al;
      b0 = A * (A + 1 + (A - 1) * cs + s); b1 = -2 * A * (A - 1 + (A + 1) * cs); b2 = A * (A + 1 + (A - 1) * cs - s);
      a0 = A + 1 - (A - 1) * cs + s; a1 = 2 * (A - 1 - (A + 1) * cs); a2 = A + 1 - (A - 1) * cs - s;
      break;
    }
    default:
      throw new Error('未知滤波器 ' + type);
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** 固定参数滤波 */
export function filt(x, type, f, q = 0.707, gainDb = 0, sr = SR) {
  const [b0, b1, b2, a1, a2] = biquadCoefs(type, f, q, gainDb, sr);
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = o;
    y[i] = o;
  }
  return y;
}

/** 截止频率随时间变化的滤波（fn(t秒) → Hz），每 32 采样更新系数 */
export function sweep(x, type, fn, q = 0.707, sr = SR) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let c = biquadCoefs(type, fn(0), q, 0, sr);
  for (let i = 0; i < x.length; i++) {
    if ((i & 31) === 0) c = biquadCoefs(type, Math.max(20, fn(i / sr)), q, 0, sr);
    const v = x[i];
    const o = c[0] * v + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = o;
    y[i] = o;
  }
  return y;
}

/** 一串 EQ：[[type,f,q,gain],...] */
export function eq(x, bands, sr = SR) {
  let y = x;
  for (const [t, f, q, g] of bands) y = filt(y, t, f, q ?? 0.707, g ?? 0, sr);
  return y;
}

// ------------------------------------------------------------ 变调 / 时间

/** 变速变调（ratio > 1 升调变短），三次插值 */
export function resample(x, ratio) {
  const n = Math.floor((x.length - 1) / ratio);
  const y = new Float32Array(Math.max(1, n));
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const k = Math.floor(p);
    const f = p - k;
    const xm = x[k - 1] ?? x[k],
      x0 = x[k],
      x1 = x[k + 1] ?? x0,
      x2 = x[k + 2] ?? x1;
    y[i] = x0 + 0.5 * f * (x1 - xm + f * (2 * xm - 5 * x0 + 4 * x1 - x2 + f * (3 * (x0 - x1) + x2 - xm)));
  }
  return y;
}

export const semis = (s) => 2 ** (s / 12);

// ------------------------------------------------------------ 动态

/** 软削波（tanh），drive 线性倍数 */
export function saturate(x, drive = 1.5) {
  const y = new Float32Array(x.length);
  const n = Math.tanh(drive);
  for (let i = 0; i < x.length; i++) y[i] = Math.tanh(x[i] * drive) / n;
  return y;
}

/** 简单前视峰值限幅器（作用于多声道，联动） */
export function limit(chs, ceilDb = -1, releaseMs = 80, lookMs = 3, sr = SR) {
  const ceil = dbToLin(ceilDb);
  const n = chs[0].length;
  const look = Math.round((lookMs / 1000) * sr);
  const rel = Math.exp(-1 / ((releaseMs / 1000) * sr));
  // 每个采样所需增益
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const c of chs) p = Math.max(p, Math.abs(c[i]));
    need[i] = p > ceil ? ceil / p : 1;
  }
  // 前视：窗口内最小值
  const g = new Float32Array(n);
  let cur = 1;
  for (let i = 0; i < n; i++) {
    let m = 1;
    for (let j = i; j < Math.min(n, i + look); j++) if (need[j] < m) m = need[j];
    cur = m < cur ? m : m + (cur - m) * rel;
    g[i] = cur;
  }
  return chs.map((c) => {
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = Math.max(-ceil, Math.min(ceil, c[i] * g[i]));
    return y;
  });
}

/** 简单下压式压缩（RMS 检测），多声道联动 */
export function compress(chs, thrDb = -18, ratio = 3, atkMs = 10, relMs = 120, makeupDb = 0, sr = SR) {
  const n = chs[0].length;
  const at = Math.exp(-1 / ((atkMs / 1000) * sr));
  const rl = Math.exp(-1 / ((relMs / 1000) * sr));
  let env = 0;
  const out = chs.map(() => new Float32Array(n));
  const mk = dbToLin(makeupDb);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const c of chs) s = Math.max(s, c[i] * c[i]);
    const c2 = s > env ? at : rl;
    env = c2 * env + (1 - c2) * s;
    const lvl = 10 * Math.log10(env + 1e-12);
    const over = lvl - thrDb;
    const gr = over > 0 ? over * (1 - 1 / ratio) : 0;
    const g = dbToLin(-gr) * mk;
    for (let k = 0; k < chs.length; k++) out[k][i] = chs[k][i] * g;
  }
  return out;
}

// ------------------------------------------------------------ 响度（近似 BS.1770 K 加权，门限 -70 LUFS + 相对 -10）

export function lufs(chs, sr = SR) {
  const kw = chs.map((c) => filt(filt(c, 'highshelf', 1681, 0.707, 4, sr), 'hp', 38, 0.5, 0, sr));
  const blk = Math.round(0.4 * sr),
    hop = Math.round(0.1 * sr);
  const ls = [];
  for (let i = 0; i + blk <= kw[0].length; i += hop) {
    let s = 0;
    for (const c of kw) for (let j = i; j < i + blk; j++) s += c[j] * c[j];
    ls.push(s / blk);
  }
  if (!ls.length) {
    let s = 0;
    for (const c of kw) for (const v of c) s += v * v;
    return -0.691 + 10 * Math.log10(s / kw[0].length + 1e-12);
  }
  const L = (z) => -0.691 + 10 * Math.log10(z + 1e-12);
  const abs = ls.filter((z) => L(z) > -70);
  if (!abs.length) return -70;
  const m1 = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((z) => L(z) > L(m1) - 10);
  return L(rel.reduce((a, b) => a + b, 0) / rel.length);
}

/** 把多声道整体调到目标 LUFS，然后限幅 */
export function toLufs(chs, target = -16, ceilDb = -1, sr = SR) {
  const l = lufs(chs, sr);
  const g = dbToLin(target - l);
  return limit(chs.map((c) => gain(c, g)), ceilDb, 80, 3, sr);
}

// ------------------------------------------------------------ 生成

export function noise(sec, sr = SR) {
  const y = zeros(sec, sr);
  for (let i = 0; i < y.length; i++) y[i] = rand() * 2 - 1;
  return y;
}

/** 粉红噪声（Voss-McCartney 近似） */
export function pink(sec, sr = SR) {
  const y = zeros(sec, sr);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < y.length; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    y[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return y;
}

/** 振荡器：fn(t) → 频率；type sine/saw/square/tri；带简单 polyBLEP 抗混叠 */
export function osc(sec, fn, type = 'sine', sr = SR, phase0 = 0) {
  const y = zeros(sec, sr);
  let ph = phase0;
  const fconst = typeof fn === 'number';
  for (let i = 0; i < y.length; i++) {
    const f = fconst ? fn : fn(i / sr);
    const dt = f / sr;
    let v;
    if (type === 'sine') v = Math.sin(2 * Math.PI * ph);
    else if (type === 'saw') {
      v = 2 * ph - 1;
      v -= blep(ph, dt);
    } else if (type === 'square') {
      v = ph < 0.5 ? 1 : -1;
      v += blep(ph, dt);
      v -= blep((ph + 0.5) % 1, dt);
    } else v = 1 - 4 * Math.abs(ph - 0.5);
    y[i] = v;
    ph += dt;
    ph -= Math.floor(ph);
  }
  return y;
}
function blep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** ADSR / 任意包络：points = [[t, v], ...]，线性插值；或指数衰减 */
export function env(x, points, sr = SR) {
  const y = new Float32Array(x.length);
  let k = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    while (k < points.length - 2 && t > points[k + 1][0]) k++;
    const [t0, v0] = points[k];
    const [t1, v1] = points[Math.min(k + 1, points.length - 1)];
    const v = t <= t0 ? v0 : t >= t1 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    y[i] = x[i] * v;
  }
  return y;
}

/** 起音 a 秒后按 tau 指数衰减 */
export function expEnv(x, a, tau, sr = SR) {
  const y = new Float32Array(x.length);
  const na = Math.max(1, Math.round(a * sr));
  for (let i = 0; i < x.length; i++) y[i] = x[i] * (i < na ? i / na : Math.exp(-(i - na) / (tau * sr)));
  return y;
}

/** 模态合成：若干衰减正弦（[freq, amp, decay秒]） */
export function modal(sec, modes, sr = SR) {
  const y = zeros(sec, sr);
  for (const [f, a, d] of modes) {
    const w = (2 * Math.PI * f) / sr;
    const k = Math.exp(-1 / (d * sr));
    let g = a;
    const ph = rand() * Math.PI * 2;
    for (let i = 0; i < y.length; i++) {
      y[i] += Math.sin(w * i + ph) * g;
      g *= k;
      if (g < 1e-5) break;
    }
  }
  return y;
}

// ------------------------------------------------------------ 混响（Freeverb）与延迟

class Comb {
  constructor(n) {
    this.b = new Float32Array(n);
    this.i = 0;
    this.f = 0;
  }
  run(x, fb, damp) {
    const o = this.b[this.i];
    this.f = o * (1 - damp) + this.f * damp;
    this.b[this.i] = x + this.f * fb;
    if (++this.i >= this.b.length) this.i = 0;
    return o;
  }
}
class AP {
  constructor(n) {
    this.b = new Float32Array(n);
    this.i = 0;
  }
  run(x) {
    const o = this.b[this.i];
    this.b[this.i] = x + o * 0.5;
    if (++this.i >= this.b.length) this.i = 0;
    return o - x;
  }
}
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const APS = [556, 441, 341, 225];

/** Freeverb：输入单声道或立体声，输出立体声湿信号。room 0..1, damp 0..1 */
export function reverb(chs, { room = 0.8, damp = 0.4, width = 1, pre = 0.02, tailSec = 3 } = {}, sr = SR) {
  const k = sr / 44100;
  const mono = chs.length === 1 ? chs[0] : chs[0].map((v, i) => (v + chs[1][i]) * 0.5);
  const n = mono.length + Math.round(tailSec * sr);
  const pd = Math.round(pre * sr);
  const fb = 0.7 + 0.28 * room;
  const outs = [0, 1].map((side) => {
    const spread = side ? 23 : 0;
    const cs = COMBS.map((c) => new Comb(Math.round((c + spread) * k)));
    const as = APS.map((a) => new AP(Math.round((a + spread) * k)));
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = i - pd;
      const x = j >= 0 && j < mono.length ? mono[j] * 0.015 : 0;
      let s = 0;
      for (const c of cs) s += c.run(x, fb, damp);
      for (const a of as) s = a.run(s);
      y[i] = s;
    }
    return y;
  });
  const w1 = width / 2 + 0.5,
    w2 = (1 - width) / 2;
  return [outs[0].map((v, i) => v * w1 + outs[1][i] * w2), outs[1].map((v, i) => v * w1 + outs[0][i] * w2)];
}

/** 立体声乒乓延迟（返回湿信号） */
export function pingpong(chs, time, fbk = 0.35, tailSec = 2, lpf = 4000, sr = SR) {
  const mono = chs.length === 1 ? chs[0] : chs[0].map((v, i) => (v + chs[1][i]) * 0.5);
  const n = mono.length + Math.round(tailSec * sr);
  const d = Math.round(time * sr);
  const L = new Float32Array(n),
    R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const inp = i < mono.length ? mono[i] : 0;
    const l = i >= d ? R[i - d] * fbk + (i - d < mono.length ? mono[i - d] : 0) : 0;
    const r = i >= d ? L[i - d] : 0;
    L[i] = l;
    R[i] = r;
    void inp;
  }
  return [filt(L, 'lp', lpf, 0.707, 0, sr), filt(R, 'lp', lpf, 0.707, 0, sr)];
}

/** 立体声化：Haas + 微小音高差的合唱（返回 [L,R]） */
export function widen(x, ms = 12, sr = SR) {
  const d = Math.round((ms / 1000) * sr);
  const R = new Float32Array(x.length);
  for (let i = d; i < x.length; i++) R[i] = x[i - d];
  return [x, R];
}

/** 声像：pan -1..1 → [L,R]（等功率） */
export function panMono(x, pan = 0) {
  const a = ((pan + 1) * Math.PI) / 4;
  return [gain(x, Math.cos(a)), gain(x, Math.sin(a))];
}

/** 多声道加和（按最长对齐） */
export function sumSt(list) {
  const n = Math.max(...list.map((s) => s[0].length));
  const L = new Float32Array(n),
    R = new Float32Array(n);
  for (const [l, r] of list) {
    for (let i = 0; i < l.length; i++) L[i] += l[i];
    for (let i = 0; i < r.length; i++) R[i] += r[i];
  }
  return [L, R];
}

/** 在 x 的 at 秒处叠加立体声 s */
export function addSt(dst, s, at = 0, g = 1, sr = SR) {
  const off = Math.round(at * sr);
  for (let c = 0; c < 2; c++) {
    const src = s[c] ?? s[0];
    const d = dst[c];
    for (let i = 0; i < src.length && off + i < d.length; i++) if (off + i >= 0) d[off + i] += src[i] * g;
  }
}

/** 等功率交叉淡化，使片段首尾无缝可循环（xf 秒） */
export function makeLoop(chs, xf, sr = SR) {
  const n = Math.round(xf * sr);
  return chs.map((c) => {
    const len = c.length - n;
    const y = c.slice(0, len);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      y[i] = c[i] * Math.sin(t * Math.PI * 0.5) + c[len + i] * Math.cos(t * Math.PI * 0.5);
    }
    return y;
  });
}
