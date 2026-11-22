import * as THREE from 'three';

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}

interface Timed {
  obj: THREE.Object3D;
  t: number;
  dur: number;
  update: (k: number, obj: THREE.Object3D) => void;
  dispose?: boolean;
}

const MAX_P = 900;

const GLYPHS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '−', '×', '÷', '=', 'π', '%', '?'];
let glyphTex: THREE.CanvasTexture[] | null = null;

/** 数字碎片用的字形贴图（白色，第一次用到时画一次，之后共享） */
function glyphTextures(): THREE.CanvasTexture[] {
  if (glyphTex) return glyphTex;
  glyphTex = GLYPHS.map((ch) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    x.font = "bold 52px 'DIN Alternate', 'Avenir Next', Arial, sans-serif";
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    // 深色描边：白天亮墙 / 天空前也看得清
    x.lineJoin = 'round';
    x.lineWidth = 9;
    x.strokeStyle = 'rgba(6,14,30,0.85)';
    x.strokeText(ch, 32, 35);
    x.shadowColor = '#fff';
    x.shadowBlur = 6;
    x.fillStyle = '#fff';
    x.fillText(ch, 32, 35);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  return glyphTex;
}
const MAX_DECAL = 160;

/** 子弹轨迹、粒子、弹孔、冲击波等一次性特效 */
export class Fx {
  group = new THREE.Group();
  private tracers: Tracer[] = [];
  private tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  private tracerPool: THREE.Mesh[] = [];
  private timed: Timed[] = [];

  private pPos = new Float32Array(MAX_P * 3);
  private pCol = new Float32Array(MAX_P * 3);
  private pVel = new Float32Array(MAX_P * 3);
  private pLife = new Float32Array(MAX_P);
  private pMax = new Float32Array(MAX_P);
  private pBase = new Float32Array(MAX_P * 3);
  private pGrav = new Float32Array(MAX_P);
  private pNext = 0;
  private points: THREE.Points;

  private decals: THREE.InstancedMesh;
  private decalNext = 0;
  private dummy = new THREE.Object3D();

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.09,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.pPos.fill(-9999);
    this.group.add(this.points);

    const dmat = new THREE.MeshBasicMaterial({
      color: 0x15171c,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.decals = new THREE.InstancedMesh(new THREE.CircleGeometry(0.045, 8), dmat, MAX_DECAL);
    this.decals.frustumCulled = false;
    this.dummy.position.set(0, -999, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < MAX_DECAL; i++) this.decals.setMatrixAt(i, this.dummy.matrix);
    this.group.add(this.decals);
  }

  reset(): void {
    for (const t of this.tracers) {
      t.mesh.visible = false;
      this.tracerPool.push(t.mesh);
    }
    this.tracers = [];
    for (const t of this.timed) this.kill(t);
    this.timed = [];
    this.pLife.fill(0);
    this.pPos.fill(-9999);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.dummy.position.set(0, -999, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < MAX_DECAL; i++) this.decals.setMatrixAt(i, this.dummy.matrix);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  private kill(t: Timed): void {
    this.group.remove(t.obj);
    if (t.dispose !== false)
      t.obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        } else if ((o as THREE.Sprite).isSprite) (o as THREE.Sprite).material.dispose(); // 贴图是共享的，不释放
      });
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, color: number, width = 0.022): void {
    const len = a.distanceTo(b);
    if (len < 0.5) return;
    let m = this.tracerPool.pop();
    if (!m) {
      m = new THREE.Mesh(
        this.tracerGeo,
        new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      this.group.add(m);
    }
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color).multiplyScalar(2.2);
    mat.opacity = 1;
    m.visible = true;
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.scale.set(width, width, len);
    m.lookAt(b);
    this.tracers.push({ mesh: m, life: 0.07, max: 0.07 });
  }

  spark(p: THREE.Vector3, n: THREE.Vector3, color: number, count = 8, speed = 4, life = 0.35, grav = 9): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const k = this.pNext;
      this.pNext = (this.pNext + 1) % MAX_P;
      this.pPos[k * 3] = p.x;
      this.pPos[k * 3 + 1] = p.y;
      this.pPos[k * 3 + 2] = p.z;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.pVel[k * 3] = (n.x + (Math.random() - 0.5) * 1.4) * s;
      this.pVel[k * 3 + 1] = (n.y + (Math.random() - 0.5) * 1.4 + 0.3) * s;
      this.pVel[k * 3 + 2] = (n.z + (Math.random() - 0.5) * 1.4) * s;
      this.pBase[k * 3] = c.r * 1.6;
      this.pBase[k * 3 + 1] = c.g * 1.6;
      this.pBase[k * 3 + 2] = c.b * 1.6;
      this.pMax[k] = this.pLife[k] = life * (0.6 + Math.random() * 0.7);
      this.pGrav[k] = grav;
    }
  }

  decal(p: THREE.Vector3, n: THREE.Vector3): void {
    this.dummy.position.copy(p).addScaledVector(n, 0.006);
    this.dummy.lookAt(p.x + n.x, p.y + n.y, p.z + n.z);
    const s = 0.8 + Math.random() * 0.5;
    this.dummy.scale.set(s, s, s);
    this.dummy.updateMatrix();
    this.decals.setMatrixAt(this.decalNext, this.dummy.matrix);
    this.decalNext = (this.decalNext + 1) % MAX_DECAL;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** 加入一个按时长播放的对象，k 从 0 到 1 */
  add(obj: THREE.Object3D, dur: number, update: (k: number, obj: THREE.Object3D) => void): Timed {
    this.group.add(obj);
    const t: Timed = { obj, t: 0, dur, update };
    this.timed.push(t);
    update(0, obj);
    return t;
  }

  remove(t: Timed): void {
    const i = this.timed.indexOf(t);
    if (i >= 0) {
      this.timed.splice(i, 1);
      this.kill(t);
    }
  }

  /** 膨胀的冲击波球 */
  shockwave(p: THREE.Vector3, radius: number, color: number, dur = 0.5): void {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(2),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    m.position.copy(p);
    this.add(m, dur, (k) => {
      const e = 1 - (1 - k) ** 3;
      m.scale.setScalar(0.2 + radius * e);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.7;
    });
    const up = new THREE.Vector3(0, 1, 0);
    this.spark(p, up, color, 40, radius * 1.6, 0.8, 6);
    this.spark(p, up, 0xfff0c0, 24, radius * 1.1, 0.6, 3);
  }

  /**
   * 击杀：一圈发光的数字 / 运算符号从倒地处往上飘散（"算境"主题，不血腥）。
   * p = 胸口高度的位置；color = 主色；eye = 镜头位置（远处的击杀按距离放大，保证屏幕上看起来差不多大）。
   */
  digitBurst(p: THREE.Vector3, color = 0x5fe8ff, count = 18, eye?: THREE.Vector3): void {
    const tex = glyphTextures();
    const g = new THREE.Group();
    g.renderOrder = 10;
    // 以 4.5 米处的观感为基准，远了按比例放大（最多 6 倍）
    const f = eye ? Math.min(6, Math.max(1, eye.distanceTo(p) / 4.5)) : 1;
    const parts: { s: THREE.Sprite; v: THREE.Vector3; spin: number; size: number; delay: number }[] = [];
    const c1 = new THREE.Color(color).multiplyScalar(1.6);
    const c2 = new THREE.Color(0xffd36b).multiplyScalar(1.6);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex[(Math.random() * tex.length) | 0],
        color: Math.random() < 0.3 ? c2 : c1,
        transparent: true,
        depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.renderOrder = 10;
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const r = (0.15 + Math.random() * 0.25) * f;
      s.position.set(p.x + Math.cos(a) * r, p.y + (Math.random() - 0.4) * 0.9 * f, p.z + Math.sin(a) * r);
      const sp = (0.9 + Math.random() * 1.4) * f;
      parts.push({
        s,
        v: new THREE.Vector3(Math.cos(a) * sp, (1.2 + Math.random() * 1.6) * f, Math.sin(a) * sp),
        spin: (Math.random() - 0.5) * 4,
        size: (0.26 + Math.random() * 0.18) * f,
        delay: Math.random() * 0.12,
      });
      g.add(s);
    }
    const dur = 1.6;
    let last = 0;
    this.add(g, dur, (k) => {
      const dt = (k - last) * dur;
      last = k;
      for (const q of parts) {
        const kk = Math.max(0, (k * dur - q.delay) / (dur - q.delay));
        q.v.multiplyScalar(Math.max(0, 1 - dt * 1.6));
        q.v.y += dt * 0.6 * f;
        q.s.position.addScaledVector(q.v, dt);
        q.s.material.rotation += q.spin * dt;
        const pop = kk < 0.12 ? kk / 0.12 : 1;
        q.s.scale.setScalar(q.size * (0.4 + 0.8 * pop));
        q.s.material.opacity = kk <= 0 ? 0 : kk < 0.65 ? 1 : 1 - (kk - 0.65) / 0.35;
      }
    });
    this.ring(new THREE.Vector3(p.x, 0.02, p.z), 1.4 * Math.min(f, 2.5), color, 0.6);
    this.spark(p, new THREE.Vector3(0, 1, 0), color, 22, 2.6 * Math.min(f, 2.5), 0.55, 2);
  }

  /** 地面上的扩散圆环 */
  ring(p: THREE.Vector3, radius: number, color: number, dur = 0.6): void {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 48),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(2),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, p.y + 0.04, p.z);
    this.add(m, dur, (k) => {
      m.scale.setScalar(0.1 + radius * (1 - (1 - k) ** 2));
      (m.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    });
  }

  update(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        t.mesh.visible = false;
        this.tracerPool.push(t.mesh);
        this.tracers.splice(i, 1);
      } else (t.mesh.material as THREE.MeshBasicMaterial).opacity = t.life / t.max;
    }
    let any = false;
    for (let k = 0; k < MAX_P; k++) {
      if (this.pLife[k] <= 0) continue;
      any = true;
      this.pLife[k] -= dt;
      const j = k * 3;
      if (this.pLife[k] <= 0) {
        this.pPos[j + 1] = -9999;
        continue;
      }
      this.pVel[j + 1] -= this.pGrav[k] * dt;
      this.pPos[j] += this.pVel[j] * dt;
      this.pPos[j + 1] += this.pVel[j + 1] * dt;
      this.pPos[j + 2] += this.pVel[j + 2] * dt;
      if (this.pPos[j + 1] < 0.02) {
        this.pPos[j + 1] = 0.02;
        this.pVel[j + 1] *= -0.35;
        this.pVel[j] *= 0.6;
        this.pVel[j + 2] *= 0.6;
      }
      const f = this.pLife[k] / this.pMax[k];
      this.pCol[j] = this.pBase[j] * f;
      this.pCol[j + 1] = this.pBase[j + 1] * f;
      this.pCol[j + 2] = this.pBase[j + 2] * f;
    }
    if (any) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      t.update(k, t.obj);
      if (k >= 1) {
        this.timed.splice(i, 1);
        this.kill(t);
      }
    }
  }
}
