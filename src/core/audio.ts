/** 纯 WebAudio 合成的音效，不依赖任何音频文件。 */
import { WEAPONS } from '../data/defs.ts';

class AudioSys {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private comp!: DynamicsCompressorNode;
  volume = 0.7;
  /** 听者位置与朝向（用于简单的距离衰减和左右声像） */
  lx = 0;
  lz = 0;
  lyaw = 0;

  /** 音频上下文已在运行（已解锁） */
  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** 必须在用户手势后调用 */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state !== 'running') {
        void this.ctx.resume().catch(() => {});
        this.poke();
      }
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 6;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.comp.connect(this.master).connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, len);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.poke();
  }

  /** 在手势回调里播放一个极短的静音片段：旧版 iOS Safari 需要这样才真正解锁音频 */
  private poke(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* 忽略 */
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  private out(x?: number, z?: number, base = 1): { node: AudioNode; gain: number } | null {
    if (!this.ctx) return null;
    if (x === undefined || z === undefined) return { node: this.comp, gain: base };
    const dx = x - this.lx,
      dz = z - this.lz;
    const dist = Math.hypot(dx, dz);
    const g = base / (1 + (dist / 9) ** 2);
    if (g < 0.004) return null;
    const pan = this.ctx.createStereoPanner();
    // 右方向量 = (cos yaw, -sin yaw)（yaw 为绕 Y 轴，前方 = (-sin, -cos)）
    const rx = Math.cos(this.lyaw),
      rz = -Math.sin(this.lyaw);
    pan.pan.value = dist > 0.5 ? Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / dist) * 0.85)) : 0;
    pan.connect(this.comp);
    return { node: pan, gain: g };
  }

  private burst(
    dest: AudioNode,
    vol: number,
    dur: number,
    filterType: BiquadFilterType,
    f0: number,
    f1: number,
    q = 1,
    delay = 0,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private tone(
    dest: AudioNode,
    type: OscillatorType,
    f0: number,
    f1: number,
    vol: number,
    dur: number,
    delay = 0,
    attack = 0.004,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** 枪声：按武器 id 合成（同类武器音色也不同） */
  shot(id: string, x?: number, z?: number): void {
    const o = this.out(x, z, x === undefined ? 0.9 : 1.5);
    if (!o) return;
    const v = o.gain;
    switch (id) {
      case 'poxiao':
        // 重型手枪：低沉的轰响 + 金属回声
        this.burst(o.node, 0.8 * v, 0.22, 'lowpass', 3200, 240, 0.6);
        this.tone(o.node, 'triangle', 300, 55, 0.6 * v, 0.18);
        this.burst(o.node, 0.12 * v, 0.3, 'bandpass', 2300, 1800, 7, 0.02);
        return;
      case 'yeying':
        // 入门冲锋枪：短促、偏高的“哒”
        this.burst(o.node, 0.4 * v, 0.06, 'bandpass', 3900, 900, 1.2);
        this.tone(o.node, 'square', 380, 120, 0.16 * v, 0.045);
        return;
      case 'beichen':
        // 精确步枪：清脆的爆裂 + 长尾音
        this.burst(o.node, 0.75 * v, 0.18, 'lowpass', 7000, 500, 0.5);
        this.tone(o.node, 'sawtooth', 260, 60, 0.35 * v, 0.14);
        this.burst(o.node, 0.18 * v, 0.6, 'bandpass', 1300, 400, 1.6, 0.05);
        return;
      case 'benlei':
        // 轻机枪：厚重的低频连击
        this.burst(o.node, 0.65 * v, 0.15, 'lowpass', 2800, 200, 0.5);
        this.tone(o.node, 'sine', 115, 40, 0.6 * v, 0.12);
        return;
    }
    switch (WEAPONS[id]?.kind ?? 'pistol') {
      case 'pistol':
        this.burst(o.node, 0.55 * v, 0.11, 'bandpass', 2600, 500, 0.8);
        this.tone(o.node, 'triangle', 420, 90, 0.5 * v, 0.09);
        break;
      case 'smg':
        this.burst(o.node, 0.45 * v, 0.08, 'bandpass', 3200, 700, 0.9);
        this.tone(o.node, 'square', 300, 80, 0.22 * v, 0.06);
        break;
      case 'rifle':
        this.burst(o.node, 0.7 * v, 0.14, 'lowpass', 5200, 400, 0.6);
        this.tone(o.node, 'sawtooth', 220, 50, 0.4 * v, 0.12);
        break;
      case 'shotgun':
        this.burst(o.node, 0.95 * v, 0.28, 'lowpass', 3600, 180, 0.5);
        this.tone(o.node, 'sine', 140, 38, 0.7 * v, 0.22);
        break;
      case 'sniper':
        this.burst(o.node, 1.0 * v, 0.5, 'lowpass', 6500, 120, 0.4);
        this.tone(o.node, 'sine', 180, 30, 0.9 * v, 0.35);
        this.burst(o.node, 0.25 * v, 0.9, 'bandpass', 900, 300, 2, 0.08);
        break;
    }
  }

  /** 匕首挥动（重刺更长更低） */
  knife(heavy: boolean, x?: number, z?: number): void {
    const o = this.out(x, z, x === undefined ? 0.7 : 0.8);
    if (!o) return;
    if (heavy) {
      this.burst(o.node, 0.35 * o.gain, 0.24, 'bandpass', 900, 3200, 1.4, 0.08);
      this.tone(o.node, 'sine', 180, 90, 0.12 * o.gain, 0.12, 0.08);
    } else this.burst(o.node, 0.3 * o.gain, 0.13, 'bandpass', 1600, 5200, 1.6);
  }

  knifeHit(): void {
    const o = this.out();
    if (!o) return;
    this.burst(o.node, 0.45, 0.08, 'lowpass', 1400, 300, 1);
    this.tone(o.node, 'triangle', 240, 120, 0.3, 0.08);
  }

  /** 拉环 + 出手 */
  nadeThrow(x?: number, z?: number): void {
    const o = this.out(x, z, x === undefined ? 0.6 : 0.6);
    if (!o) return;
    this.tone(o.node, 'square', 2400, 2100, 0.06 * o.gain, 0.04);
    this.burst(o.node, 0.18 * o.gain, 0.05, 'highpass', 4500, 3800, 3, 0.02);
    this.burst(o.node, 0.25 * o.gain, 0.2, 'bandpass', 600, 1800, 1.2, 0.12);
  }

  /** 拔掉保险销（手持投掷物时） */
  pin(): void {
    const o = this.out();
    if (!o) return;
    this.tone(o.node, 'square', 2600, 2300, 0.07, 0.035);
    this.burst(o.node, 0.14, 0.04, 'highpass', 5200, 4000, 3, 0.03);
  }

  /** 投掷物落地弹跳 */
  bounce(x: number, z: number): void {
    const o = this.out(x, z, 0.9);
    if (!o) return;
    this.tone(o.node, 'triangle', 820 + Math.random() * 200, 500, 0.18 * o.gain, 0.05);
    this.burst(o.node, 0.15 * o.gain, 0.04, 'bandpass', 2400, 1500, 2);
  }

  /** 破片手雷爆炸：比技能爆炸更脆、带碎片声 */
  grenade(x: number, z: number): void {
    const o = this.out(x, z, 2.6);
    if (!o) return;
    const v = Math.min(1, o.gain);
    this.burst(o.node, 1.0 * v, 0.6, 'lowpass', 4200, 80, 0.5);
    this.tone(o.node, 'sine', 140, 30, 0.9 * v, 0.45);
    this.burst(o.node, 0.3 * v, 0.35, 'highpass', 6000, 2500, 1, 0.03);
  }

  /** 烟雾弹释放的嘶嘶声 */
  smokeHiss(x: number, z: number): void {
    const o = this.out(x, z, 1.1);
    if (!o) return;
    this.burst(o.node, 0.25 * o.gain, 1.6, 'highpass', 3500, 1800, 0.7);
    this.burst(o.node, 0.18 * o.gain, 0.5, 'lowpass', 600, 150, 0.7);
  }

  /** 丢下武器（落地碰撞） */
  drop(x?: number, z?: number): void {
    const o = this.out(x, z, 0.7);
    if (!o) return;
    this.tone(o.node, 'triangle', 340, 160, 0.2 * o.gain, 0.08);
    this.burst(o.node, 0.22 * o.gain, 0.1, 'bandpass', 1800, 700, 2, 0.06);
  }

  pickup(): void {
    const o = this.out();
    if (!o) return;
    this.burst(o.node, 0.22, 0.05, 'bandpass', 2200, 1600, 3);
    this.tone(o.node, 'triangle', 600, 900, 0.12, 0.08, 0.04);
  }

  /** 拔枪 / 换枪 */
  equip(): void {
    const o = this.out();
    if (!o) return;
    this.burst(o.node, 0.14, 0.05, 'bandpass', 1800, 1200, 2.5);
    this.burst(o.node, 0.1, 0.04, 'highpass', 3200, 2600, 3, 0.09);
  }

  /** 落地 */
  land(): void {
    const o = this.out();
    if (!o) return;
    this.burst(o.node, 0.3, 0.09, 'lowpass', 420, 120, 0.7);
  }

  /** 狙击镜切换 */
  scope(on: boolean): void {
    const o = this.out();
    if (!o) return;
    this.tone(o.node, 'sine', on ? 1500 : 1100, on ? 1900 : 900, 0.05, 0.05);
  }

  hit(head: boolean): void {
    const o = this.out();
    if (!o) return;
    if (head) {
      this.tone(o.node, 'sine', 1760, 1760, 0.35, 0.16);
      this.tone(o.node, 'sine', 2640, 2640, 0.2, 0.2, 0.01);
    } else {
      this.tone(o.node, 'triangle', 760, 520, 0.25, 0.07);
    }
  }

  /**
   * 本人击杀确认音：一声有力的"咚"（低频冲击）+ 清脆的"叮"。
   * streak = 本回合第几杀，音调逐级升高、越来越热闹；head = 爆头多一声"铛"；ace = 团灭再加一段短号角。
   */
  killConfirm(streak = 1, head = false, ace = false): void {
    const o = this.out();
    if (!o) return;
    const n = Math.max(1, Math.min(5, streak));
    // 咚：下滑正弦 + 一点低通噪声，像打在鼓面上
    this.tone(o.node, 'sine', 170, 48, 0.6, 0.2, 0, 0.002);
    this.burst(o.node, 0.35, 0.09, 'lowpass', 900, 140, 0.8);
    // 连杀：先快速往上走 n 个音
    const scale = [784, 880, 988, 1175, 1319, 1568, 1760];
    const t0 = n >= 2 ? 0.05 : 0.04;
    for (let i = 1; i < n; i++) this.tone(o.node, 'triangle', scale[i - 1], scale[i - 1], 0.16, 0.09, t0 + (i - 1) * 0.055, 0.003);
    // 叮：主音 + 五度，连杀越多越高越亮
    const base = scale[n + 1] ?? 1760;
    const td = t0 + (n - 1) * 0.055;
    this.tone(o.node, 'sine', base, base, 0.34, 0.42, td, 0.003);
    this.tone(o.node, 'triangle', base * 1.5, base * 1.5, 0.14 + n * 0.02, 0.32, td + 0.01, 0.003);
    if (n >= 3) this.tone(o.node, 'sine', base * 2, base * 2, 0.08, 0.3, td + 0.02, 0.003);
    // 爆头：金属"铛"（不协和泛音，短而亮）
    if (head) {
      this.tone(o.node, 'sine', 2637, 2600, 0.22, 0.28, 0.0, 0.001);
      this.tone(o.node, 'sine', 3951, 3900, 0.12, 0.2, 0.0, 0.001);
      this.tone(o.node, 'square', 5274, 5274, 0.025, 0.06, 0.0, 0.001);
    }
    // 团灭：短号角
    if (ace) [523, 659, 784, 1047].forEach((f, i) => this.tone(o.node, 'sawtooth', f, f, 0.1, i === 3 ? 0.6 : 0.16, td + 0.28 + i * 0.11, 0.01));
  }

  hurt(): void {
    const o = this.out();
    if (!o) return;
    this.burst(o.node, 0.4, 0.12, 'lowpass', 900, 200);
    this.tone(o.node, 'sine', 160, 70, 0.5, 0.14);
  }

  step(x?: number, z?: number): void {
    const o = this.out(x, z, x === undefined ? 0.2 : 0.55);
    if (!o) return;
    this.burst(o.node, 0.5 * o.gain, 0.07, 'lowpass', 500 + Math.random() * 250, 140, 0.7);
  }

  reload(): void {
    const o = this.out();
    if (!o) return;
    this.burst(o.node, 0.25, 0.05, 'highpass', 2200, 1800, 2);
    this.burst(o.node, 0.3, 0.06, 'bandpass', 1500, 900, 3, 0.35);
    this.tone(o.node, 'square', 900, 500, 0.08, 0.04, 0.36);
  }

  empty(): void {
    const o = this.out();
    if (o) this.burst(o.node, 0.18, 0.03, 'highpass', 3000, 2500, 3);
  }

  ui(kind: 'click' | 'hover' | 'buy' | 'deny' | 'open' = 'click'): void {
    const o = this.out();
    if (!o) return;
    if (kind === 'click') this.tone(o.node, 'sine', 720, 980, 0.16, 0.07);
    else if (kind === 'hover') this.tone(o.node, 'sine', 1300, 1300, 0.04, 0.03);
    else if (kind === 'open') this.tone(o.node, 'sine', 420, 840, 0.14, 0.14);
    else if (kind === 'buy') {
      this.tone(o.node, 'triangle', 880, 880, 0.2, 0.08);
      this.tone(o.node, 'triangle', 1320, 1320, 0.2, 0.14, 0.07);
    } else this.tone(o.node, 'square', 180, 120, 0.12, 0.14);
  }

  correct(): void {
    const o = this.out();
    if (!o) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(o.node, 'triangle', f, f, 0.24, 0.22, i * 0.07));
  }

  wrong(): void {
    const o = this.out();
    if (!o) return;
    this.tone(o.node, 'sawtooth', 220, 150, 0.2, 0.25);
    this.tone(o.node, 'sawtooth', 165, 110, 0.2, 0.32, 0.12);
  }

  ability(x?: number, z?: number): void {
    const o = this.out(x, z, 1);
    if (!o) return;
    this.burst(o.node, 0.35 * o.gain, 0.35, 'bandpass', 500, 4200, 2.5);
    this.tone(o.node, 'sine', 300, 1200, 0.2 * o.gain, 0.3);
  }

  ult(): void {
    const o = this.out();
    if (!o) return;
    this.tone(o.node, 'sawtooth', 110, 440, 0.25, 0.6);
    this.tone(o.node, 'sine', 220, 1760, 0.25, 0.7, 0.05);
    this.burst(o.node, 0.3, 0.8, 'bandpass', 300, 6000, 1.5);
  }

  beep(x: number, z: number, high = false): void {
    const o = this.out(x, z, 1.6);
    if (o) this.tone(o.node, 'square', high ? 1480 : 1100, high ? 1480 : 1100, 0.22 * o.gain, 0.07);
  }

  explosion(x?: number, z?: number, big = false): void {
    const o = this.out(x, z, big ? 4 : 2.2);
    if (!o) return;
    const v = Math.min(1, o.gain);
    this.burst(o.node, 1.0 * v, big ? 1.6 : 0.7, 'lowpass', 2400, 60, 0.4);
    this.tone(o.node, 'sine', 120, 24, 1.0 * v, big ? 1.2 : 0.5);
  }

  flashPop(x: number, z: number): void {
    const o = this.out(x, z, 1.6);
    if (!o) return;
    this.burst(o.node, 0.5 * o.gain, 0.18, 'highpass', 5000, 2500);
    this.tone(o.node, 'sine', 3200, 2900, 0.2 * o.gain, 0.9);
  }

  roundStart(): void {
    const o = this.out();
    if (!o) return;
    this.tone(o.node, 'sawtooth', 196, 196, 0.16, 0.5, 0, 0.05);
    this.tone(o.node, 'sawtooth', 294, 294, 0.16, 0.6, 0.02, 0.05);
    this.tone(o.node, 'sine', 588, 588, 0.14, 0.7, 0.04, 0.05);
  }

  roundEnd(win: boolean): void {
    const o = this.out();
    if (!o) return;
    const notes = win ? [392, 494, 587, 784] : [392, 370, 330, 262];
    notes.forEach((f, i) => this.tone(o.node, win ? 'triangle' : 'sawtooth', f, f, 0.2, 0.4, i * 0.13, 0.02));
  }

  planted(): void {
    const o = this.out();
    if (!o) return;
    this.tone(o.node, 'square', 440, 440, 0.14, 0.12);
    this.tone(o.node, 'square', 660, 660, 0.14, 0.12, 0.14);
    this.tone(o.node, 'square', 880, 880, 0.14, 0.3, 0.28);
  }
}

export const audio = new AudioSys();
