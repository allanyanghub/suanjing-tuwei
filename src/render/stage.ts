import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import type { Theme } from '../data/defs.ts';
import type { GameMap } from '../world/map.ts';
import { getSky, SKY_FRAG, SKY_VERT, type SkyMood } from './env/sky.ts';
import { setEnvDetail } from './env/pbr.ts';
import { buildEnvironment, type LampSpot } from './env/world.ts';

export type Quality = 'high' | 'medium' | 'low';

/**
 * HDR 颜色保护：NaN / Inf（指数位全 1，按位判断，不怕驱动的快速数学优化把 isnan 去掉）换成 0，过亮的夹到 64。
 * 半浮点缓冲里偶尔出现的坏像素会被泛光模糊成整屏闪烁，所以泛光的高光提取和调色都先过一遍。
 * 正常画面的值远小于 64（AgX 色调映射在约 3 以上就已是纯白），所以不影响观感。
 */
const SAFE_HDR = /* glsl */ `
    vec4 safeHDR(vec4 c) {
      bvec4 bad = equal(floatBitsToUint(c) & uvec4(0x7f800000u), uvec4(0x7f800000u));
      return clamp(mix(c, vec4(0.0), bad), 0.0, 64.0);
    }`;

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.2 },
    uSaturation: { value: 1.0 },
    uContrast: { value: 1.04 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
    uHighTint: { value: new THREE.Vector3(1, 1, 1) },
    uDesat: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uDesat;
    uniform vec3 uTint;
    uniform vec3 uShadowTint;
    uniform vec3 uHighTint;
    varying vec2 vUv;
    ${SAFE_HDR}
    void main() {
      vec4 c = safeHDR(texture2D(tDiffuse, vUv));
      vec3 col = max(c.rgb, vec3(0.0));
      // 以中灰为支点的对比度（线性 HDR）
      col = pow(col / 0.18 + 1e-6, vec3(uContrast)) * 0.18;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= mix(uShadowTint, uHighTint, smoothstep(0.02, 0.6, l));
      l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation * (1.0 - uDesat));
      col *= uTint;
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.95, 0.3, length(d * vec2(1.0, 0.8)));
      col *= mix(1.0 - uVignette, 1.0, v);
      gl_FragColor = vec4(col, c.a);
    }`,
};

/** 世界层 AO：几何缓冲里排除半透明/叠加/镂空类物体，避免它们被当作遮挡体 */
class WorldAOPass extends GTAOPass {
  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    w: number,
    h: number,
    private skip: () => readonly THREE.Object3D[],
  ) {
    super(scene, camera, w, h);
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    const list = this.skip();
    const prev = list.map((o) => o.visible);
    for (const o of list) o.visible = false;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    list.forEach((o, i) => (o.visible = prev[i]));
  }
}

/** 主题 → 天空氛围 */
function moodOf(theme: Theme): SkyMood {
  if (theme.stars) return 'night';
  if (theme.sunDir[1] < 0.45) return 'dusk';
  if (theme.sunDir[1] > 0.8) return 'day';
  return 'dawn';
}

/** 各氛围的曝光与氛围参数 */
const MOOD = {
  // 水平面目标辐照度（天空 + 太阳），曝光，雾密度，夜色调，去饱和
  // sunBoost / warm：对 HDRI 中被云层削弱的太阳做艺术化补偿
  dawn: { E: 3.6, exposure: 1.05, fog: 0.0045, tint: [1, 1, 1], desat: 0, minElev: 30, minSun: 0.6, envK: 1, sunBoost: 1.35, warm: [1, 0.86, 0.68, 0.25] },
  day: { E: 4.2, exposure: 0.95, fog: 0.0032, tint: [1, 1, 1], desat: 0, minElev: 20, minSun: 0.5, envK: 1, sunBoost: 1.0, warm: [1, 1, 1, 0] },
  dusk: { E: 3.0, exposure: 1.2, fog: 0.003, tint: [1, 1, 1], desat: 0, minElev: 14, minSun: 3.0, envK: 0.55, sunBoost: 1.0, warm: [1, 0.62, 0.32, 0.45] },
  night: { E: 0.85, exposure: 1.1, fog: 0.006, tint: [0.55, 0.68, 1.0], desat: 0.55, minElev: 30, minSun: 0.5, envK: 1, sunBoost: 1.0, warm: [1, 1, 1, 0] },
} as const;

/** 给泛光的高光提取加上 HDR 保护（坏像素不会被模糊扩散到整屏） */
function guardBloom(b: UnrealBloomPass): void {
  const m = b.materialHighPassFilter;
  const from = 'vec4 texel = texture2D( tDiffuse, vUv );';
  if (!m.fragmentShader.includes(from)) {
    console.warn('[算境突围] 泛光着色器结构变了，HDR 保护未生效');
    return;
  }
  m.fragmentShader = m.fragmentShader.replace('void main() {', `${SAFE_HDR}\n\t\tvoid main() {`).replace(from, 'vec4 texel = safeHDR( texture2D( tDiffuse, vUv ) );');
  m.needsUpdate = true;
}

const lumOf = (c: THREE.Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  /** 第一人称武器单独一层，避免穿墙 */
  vmScene = new THREE.Scene();
  vmCamera: THREE.PerspectiveCamera;
  composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private gtao: GTAOPass | null = null;
  /** 不参与 AO 的物体 */
  private noAO: THREE.Object3D[] = [];
  private passes: { dispose(): void }[] = [];
  grade!: ShaderPass;
  private worldGroup = new THREE.Group();
  private sun: THREE.DirectionalLight | null = null;
  private vmHemi: THREE.HemisphereLight;
  private vmKey: THREE.DirectionalLight;
  private disposables: { dispose(): void }[] = [];
  private envMats: THREE.Material[] = [];
  quality: Quality = 'high';
  theme!: Theme;
  private mood: SkyMood = 'day';
  private animated: ((t: number) => void)[] = [];

  /** 离屏渲染目标的可用配置（首次构建合成器时探测一次） */
  private rtCaps: { type: THREE.TextureDataType; samples: number } | null = null;
  /** WebGL 上下文已丢失（期间不渲染） */
  contextLost = false;
  /** 重新生成环境光照贴图（PMREM 是在显卡上渲染出来的，上下文丢失后内容没了，需要重画） */
  private regenEnv: (() => void) | null = null;
  /**
   * 正在从上下文丢失中恢复：旧的显卡资源属于已经作废的上下文，不再 dispose（否则浏览器会刷一堆
   * "object does not belong to this context" 警告），直接丢掉引用交给垃圾回收。
   */
  private afterLoss = false;

  constructor(
    public canvas: HTMLCanvasElement,
    /** 触屏设备：像素比上限更低，省电、保帧率 */
    private touchDevice = false,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(78, 1, 0.08, 1200);
    this.camera.rotation.order = 'YXZ';
    this.vmCamera = new THREE.PerspectiveCamera(54, 1, 0.01, 10);
    this.scene.add(this.worldGroup);
    this.scene.add(this.camera);

    // 武器层灯光（环境贴图提供主要的天空光，这里只补一点）
    this.vmHemi = new THREE.HemisphereLight(0xffffff, 0x556070, 0.35);
    this.vmScene.add(this.vmHemi);
    this.vmKey = new THREE.DirectionalLight(0xffffff, 1.6);
    this.vmKey.position.set(-1, 2, 1.5);
    this.vmScene.add(this.vmKey);

    this.buildComposer();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private buildComposer(): void {
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    const caps = (this.rtCaps ??= this.probeTargets());
    const halfFloat = caps.type === THREE.HalfFloatType;
    const rt = new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), {
      type: caps.type,
      samples: this.quality === 'low' ? 0 : caps.samples,
    });
    if (!this.afterLoss) {
      for (const p of this.passes) p.dispose();
      this.composer?.dispose();
    }
    this.passes = [];
    this.composer = new EffectComposer(this.renderer, rt);
    const worldPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(worldPass);
    this.gtao = null;
    if (this.quality === 'high' && halfFloat) {
      // AO 只作用于世界层；武器层在其后单独绘制
      const g = new WorldAOPass(this.scene, this.camera, Math.max(2, size.x), Math.max(2, size.y), () => this.noAO);
      g.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 2, rings: 2, samples: 10 });
      g.blendIntensity = 0.85;
      this.composer.addPass(g);
      this.gtao = g;
      this.passes.push(g);
    }
    const vmPass = new RenderPass(this.vmScene, this.vmCamera);
    vmPass.clear = false;
    vmPass.clearDepth = true;
    this.composer.addPass(vmPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.25, 0.45, 2.0);
    // 泛光内部使用半浮点目标：设备不支持时关闭，避免黑屏
    this.bloom.enabled = this.quality !== 'low' && halfFloat;
    guardBloom(this.bloom);
    this.composer.addPass(this.bloom);
    const prevDesat = this.grade ? (this.grade.uniforms.uDesat.value as number) : 0;
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uDesat.value = prevDesat;
    this.composer.addPass(this.grade);
    const out = new OutputPass();
    this.composer.addPass(out);
    this.passes.push(this.bloom, this.grade, out, worldPass, vmPass);
    if (this.theme) this.applyThemePost();
  }

  /**
   * 探测离屏渲染目标：优先 半浮点 + 4× MSAA，依次退到 无 MSAA、8 位颜色。
   * 部分移动端（旧 iOS Safari）不能渲染到半浮点或多重采样缓冲，帧缓冲不完整会整屏发黑。
   */
  private probeTargets(): { type: THREE.TextureDataType; samples: number } {
    const r = this.renderer;
    const gl = r.getContext();
    const maxS = Math.min(4, r.capabilities.maxSamples ?? 0);
    const halfOk = r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float');
    const tries: { type: THREE.TextureDataType; samples: number }[] = [];
    if (halfOk) {
      if (maxS > 0) tries.push({ type: THREE.HalfFloatType, samples: maxS });
      tries.push({ type: THREE.HalfFloatType, samples: 0 });
    }
    if (maxS > 0) tries.push({ type: THREE.UnsignedByteType, samples: maxS });
    tries.push({ type: THREE.UnsignedByteType, samples: 0 });
    const prev = r.getRenderTarget();
    for (const t of tries) {
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: t.type, samples: t.samples });
      let ok = false;
      try {
        while (gl.getError() !== gl.NO_ERROR) {
          /* 清掉之前残留的错误 */
        }
        r.setRenderTarget(rt);
        r.clear();
        ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
      } catch {
        ok = false;
      }
      r.setRenderTarget(prev);
      rt.dispose();
      if (ok) return t;
      console.warn('[算境突围] 渲染目标不可用，降级：', t);
    }
    return { type: THREE.UnsignedByteType, samples: 0 };
  }

  private applyThemePost(): void {
    const mood = this.mood;
    const night = mood === 'night';
    this.bloom.strength = night ? 0.4 : mood === 'dusk' ? 0.12 : 0.12;
    this.bloom.radius = night ? 0.55 : 0.4;
    this.bloom.threshold = night ? 0.9 : mood === 'dusk' ? 4 : 3;
    const u = this.grade.uniforms;
    u.uSaturation.value = night ? 0.95 : mood === 'dusk' ? 1.04 : 1.02;
    u.uContrast.value = night ? 1.04 : 1.06;
    u.uVignette.value = night ? 0.28 : 0.2;
    const st = u.uShadowTint.value as THREE.Vector3;
    const ht = u.uHighTint.value as THREE.Vector3;
    if (night) {
      st.set(0.96, 1.0, 1.06);
      ht.set(1.02, 1.0, 0.97);
    } else if (mood === 'dusk') {
      st.set(0.97, 0.98, 1.04);
      ht.set(1.03, 1.0, 0.96);
    } else {
      st.set(0.98, 1.0, 1.03);
      ht.set(1.01, 1.0, 0.99);
    }
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.buildComposer();
    if (this.sun) this.configureShadow(this.sun);
    for (const m of this.envMats) setEnvDetail(m, q === 'high');
    this.resize();
  }

  private configureShadow(sun: THREE.DirectionalLight): void {
    const q = this.quality;
    sun.castShadow = q !== 'low';
    const s = q === 'high' ? 4096 : 2048;
    if (sun.shadow.mapSize.x !== s) {
      sun.shadow.mapSize.set(s, s);
      if (!this.afterLoss) sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.shadow.radius = q === 'high' ? 2.5 : 1.6;
    sun.shadow.bias = q === 'high' ? -0.0002 : -0.0004;
    sun.shadow.normalBias = q === 'high' ? 0.03 : 0.045;
  }

  resize(): void {
    const w = window.innerWidth,
      h = window.innerHeight;
    // 像素比上限：触屏设备的屏幕像素密度高、GPU 弱，中 / 低画质按 1 倍渲染
    const cap = this.quality === 'high' ? 1.25 : this.quality === 'medium' ? (this.touchDevice ? 1 : 1.1) : 1;
    const pr = Math.min(window.devicePixelRatio || 1, cap);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    // AO 按 0.75×CSS 像素分辨率计算（降采样，去噪后再放大）
    const ak = Math.min(pr, 1) * 0.75;
    if (this.gtao) this.gtao.setSize(Math.max(2, Math.round(w * ak)), Math.max(2, Math.round(h * ak)));
    this.camera.aspect = this.vmCamera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.vmCamera.updateProjectionMatrix();
  }

  render(time: number): void {
    if (this.contextLost) return;
    for (const f of this.animated) f(time);
    this.composer.render();
  }

  /**
   * WebGL 上下文恢复之后调用（Three.js 已重建内部状态，贴图 / 几何体 / 着色器会在下次绘制时重新上传）。
   * 这里重新探测渲染目标、按给定画质重建合成器和阴影，并重画环境光照贴图。
   */
  restoreAfterContextLoss(q: Quality): void {
    this.contextLost = false;
    this.rtCaps = null;
    this.afterLoss = true;
    try {
      this.setQuality(q);
      this.regenEnv?.();
    } finally {
      this.afterLoss = false;
    }
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  clearWorld(): void {
    // 旧太阳光的阴影贴图也要释放
    this.sun?.dispose();
    this.sun = null;
    this.worldGroup.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.envMats = [];
    this.animated = [];
    this.noAO = [];
    this.regenEnv = null;
    this.scene.environment = null;
    this.scene.background = null;
    this.vmScene.environment = null;
  }

  /** 根据地图与主题搭建整个场景 */
  buildWorld(map: GameMap, theme: Theme): void {
    this.clearWorld();
    this.theme = theme;
    const mood = moodOf(theme);
    this.mood = mood;
    const P = MOOD[mood];
    const sky = getSky(mood);
    const g = this.worldGroup;

    // ---------------- 太阳 / 天空对齐 ----------------
    // 绕 Y 旋转 HDRI，使其太阳方位角与主题设定一致（保持关卡阴影走向），高度角取 HDRI 本身
    const azT = Math.atan2(theme.sunDir[2], theme.sunDir[0]);
    const azH = Math.atan2(sky.sunDir.z, sky.sunDir.x);
    const rot = azT - azH;
    const sunW = new THREE.Vector3(Math.cos(azT) * Math.hypot(sky.sunDir.x, sky.sunDir.z), sky.sunDir.y, Math.sin(azT) * Math.hypot(sky.sunDir.x, sky.sunDir.z));
    const elev = Math.asin(THREE.MathUtils.clamp(sunW.y, -1, 1));
    const lightElev = Math.max(elev, THREE.MathUtils.degToRad(P.minElev));
    const lightDir = new THREE.Vector3(Math.cos(azT) * Math.cos(lightElev), Math.sin(lightElev), Math.sin(azT) * Math.cos(lightElev));
    // 曝光归一化：水平面辐照度 = 目标值
    const Eh = lumOf(sky.skyE) + lumOf(sky.sunE) * Math.max(0.05, Math.sin(elev));
    const scale = P.E / Math.max(1e-4, Eh);
    const tint = new THREE.Color(P.tint[0], P.tint[1], P.tint[2]);
    const desat = (c: THREE.Color, k: number) => {
      const l = lumOf(c);
      return c.lerp(new THREE.Color(l, l, l), k);
    };
    const fogCol = desat(sky.horizon.clone().multiplyScalar(scale), P.desat).multiply(tint);
    const groundAlbedo = 0.22;
    const groundCol = desat(
      new THREE.Color(0.95, 0.9, 0.82).multiplyScalar((groundAlbedo * (lumOf(sky.skyE) + lumOf(sky.sunE) * Math.max(0.05, Math.sin(elev))) * scale) / Math.PI),
      P.desat,
    ).multiply(tint);
    this.renderer.toneMappingExposure = P.exposure;
    this.scene.fog = new THREE.FogExp2(fogCol, P.fog);
    this.renderer.setClearColor(fogCol);
    this.applyThemePost();

    // ---------------- 天空球 / 环境光 ----------------
    const skyUniforms = (mode: number) => ({
      tEnv: { value: sky.env },
      tSky: { value: sky.sky },
      uMode: { value: mode },
      uK: { value: sky.k },
      uRot: { value: new THREE.Vector2(Math.cos(rot), Math.sin(rot)) },
      uScale: { value: scale },
      uTint: { value: new THREE.Vector3(tint.r, tint.g, tint.b) },
      uFog: { value: new THREE.Vector3(fogCol.r, fogCol.g, fogCol.b) },
      uGround: { value: new THREE.Vector3(groundCol.r, groundCol.g, groundCol.b).divideScalar(scale) },
      uDesat: { value: P.desat },
      uClampL: { value: mode === 1 ? 12 : 1e5 },
    });
    const skyGeo = this.track(new THREE.SphereGeometry(1, 64, 32));
    const skyMat = this.track(
      new THREE.ShaderMaterial({ uniforms: skyUniforms(1), vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false }),
    );
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.scale.setScalar(1000);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -100;
    g.add(skyMesh);
    this.animated.push(() => skyMesh.position.copy(this.camera.position));
    let envRT: THREE.WebGLRenderTarget | null = null;
    const genEnv = () => {
      const envScene = new THREE.Scene();
      const envMat = new THREE.ShaderMaterial({ uniforms: skyUniforms(0), vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false });
      const m = new THREE.Mesh(skyGeo, envMat);
      m.scale.setScalar(50);
      envScene.add(m);
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const rt = pmrem.fromScene(envScene, 0, 0.1, 100, { size: 256 });
      pmrem.dispose();
      envMat.dispose();
      if (envRT) {
        if (!this.afterLoss) envRT.dispose();
        this.disposables = this.disposables.filter((d) => d !== envRT);
      }
      envRT = this.track(rt);
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = P.envK;
      this.vmScene.environment = rt.texture;
      this.vmScene.environmentIntensity = 0.9;
    };
    genEnv();
    this.regenEnv = genEnv;

    // ---------------- 太阳 / 月亮 ----------------
    const sunCol = desat(sky.sunE.clone(), P.desat).multiply(tint);
    // 云层后的太阳在 HDRI 中几乎没有直射分量：保证最低的直射光比例，否则画面发灰没有阴影
    const sunI = Math.max(lumOf(sunCol) * scale * P.sunBoost, P.minSun * P.E);
    sunCol.multiplyScalar(1 / Math.max(1e-6, Math.max(sunCol.r, sunCol.g, sunCol.b))).lerp(new THREE.Color(P.warm[0], P.warm[1], P.warm[2]), P.warm[3]);
    sunCol.multiplyScalar(1 / Math.max(1e-6, Math.max(sunCol.r, sunCol.g, sunCol.b)));
    const sun = new THREE.DirectionalLight(sunCol, sunI);
    sun.position.copy(lightDir).multiplyScalar(120);
    const sc = sun.shadow.camera;
    sc.left = -56;
    sc.right = 56;
    sc.top = 56;
    sc.bottom = -56;
    sc.near = 40;
    sc.far = 220;
    this.configureShadow(sun);
    g.add(sun, sun.target);
    this.sun = sun;
    this.vmKey.color.copy(sunCol);
    this.vmKey.intensity = Math.min(3, sunI * 0.5);
    this.vmHemi.color.copy(fogCol).multiplyScalar(1 / Math.max(0.05, lumOf(fogCol))).lerp(new THREE.Color(1, 1, 1), 0.5);
    this.vmHemi.groundColor.copy(groundCol).multiplyScalar(1 / Math.max(0.05, lumOf(groundCol)) * 0.4);
    this.vmHemi.intensity = mood === 'night' ? 0.25 : 0.3;

    // ---------------- 环境几何 ----------------
    const env = buildEnvironment(map, theme, mood, this.quality === 'high');
    g.add(env.group);
    this.disposables.push(...env.disposables);
    this.animated.push(...env.animated);
    this.envMats = env.envMats;

    // 夜晚 / 黄昏：少量真实点光源（其余灯光用自发光 + 光斑模拟）
    if (mood === 'night' || mood === 'dusk') this.addLampLights(env.lamps, mood === 'night' ? 6 : 3, mood === 'night' ? 1 : 0.4);

    // 半透明、叠加、镂空贴花不写入 AO 几何缓冲
    g.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.Material;
      if (m.transparent || m.alphaTest > 0 || !m.depthWrite) this.noAO.push(o);
    });
  }

  /** 动态加入场景的半透明 / 叠加物体（特效层等）不写入 AO 几何缓冲，否则会被当成实心方块压暗画面。换关时 clearWorld 会清空，需在 buildWorld 之后调用 */
  skipAO(o: THREE.Object3D): void {
    if (!this.noAO.includes(o)) this.noAO.push(o);
  }

  /** 从壁灯中挑选分布均匀、靠近重要区域的若干盏放真实点光源 */
  private addLampLights(lamps: LampSpot[], n: number, k: number): void {
    const chosen: LampSpot[] = [];
    const pool = [...lamps];
    while (chosen.length < n && pool.length) {
      let best = 0,
        bs = -1;
      pool.forEach((l, i) => {
        const d = chosen.length ? Math.min(...chosen.map((c) => Math.hypot(c.x - l.x, c.z - l.z))) : 30;
        const s = Math.min(d, 30) * l.weight;
        if (s > bs) {
          bs = s;
          best = i;
        }
      });
      chosen.push(pool.splice(best, 1)[0]);
    }
    for (const l of chosen) {
      const pl = new THREE.PointLight(0xffc68a, 5 * k, 12, 2);
      pl.position.set(l.x, l.y, l.z);
      this.worldGroup.add(pl);
    }
  }
}
