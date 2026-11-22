/** 入口：创建渲染舞台、输入与界面，驱动主循环 */
import './style.css';
import { Stage, type Quality } from './render/stage.ts';
import { FpsGovernor, LOWER, minQuality, showToast, watchContext } from './render/guard.ts';
import { flush as flushErrlog, initErrlog, recentReports, report, reportError } from './core/errlog.ts';
import { Input, isTouchDevice } from './core/input.ts';
import { audio } from './core/audio.ts';
import { onPersist, persist, save } from './core/save.ts';
import { online } from './net/index.ts';
import { App } from './ui/app.ts';
import type { Match, MatchOptions } from './game/match.ts';
import { preloadAssets } from './render/assets.ts';
import { setupMobilePage } from './ui/mobile.ts';
import { LocalCoopLink } from './game/coop-local.ts';
import type { CoopMember, CoopMode, CoopStart, CoopTeam } from './net/coop-link.ts';
import { AGENTS, LEVELS } from './data/defs.ts';
// 仅为登记预载任务而引入（角色模型、武器模型各自在模块顶层登记）
import './render/character.ts';
import './render/weapons.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

// 触屏设备首次运行：玩家没有手动选过画质时，默认中画质（小屏手机用低画质）。不写入存档，不覆盖玩家的选择。
// 自动画质还要受「这台设备的上限」约束：以前画面丢失 / 持续卡顿时自动降过的，下次直接用低一档。
if (save.settings.qualityAuto) {
  if (isTouchDevice()) {
    const shortSide = Math.min(screen.width, screen.height);
    save.settings.quality = shortSide < 500 ? 'low' : 'medium';
  }
  save.settings.quality = minQuality(save.settings.quality, save.settings.qualityCap ?? 'high');
}

const stage = new Stage(canvas, isTouchDevice());

// 错误记录：脚本报错、画面丢失、掉帧等连同设备信息上报给家庭服务器（连不上就算了）
initErrlog({
  apiBase: () => online.api?.base ?? null,
  gl: () => stage.renderer.getContext(),
  context: () => {
    const m = window.__game?.match;
    return { q: stage.quality, qs: save.settings.quality, qa: save.settings.qualityAuto, level: m?.level?.id, map: m?.level?.mapId, phase: m?.phase, coop: m ? !!m.coop : undefined };
  },
});

// ---------------- 画面保护：上下文丢失恢复、持续卡顿自动降画质 ----------------
/** 本次运行里丢失过几次上下文 */
let lostCount = 0;
/**
 * 降一档画质（返回新画质；已是最低返回 null）。
 * 自动画质时写进存档并记住这台设备的上限；玩家手动选过的画质只在本次运行里降低，不改存档。
 */
function lowerQuality(): Quality | null {
  const next = LOWER[stage.quality];
  if (!next) return null;
  if (save.settings.qualityAuto) {
    save.settings.quality = next;
    save.settings.qualityCap = minQuality(save.settings.qualityCap ?? 'high', next);
    persist();
  }
  return next;
}
watchContext(canvas, {
  lost() {
    stage.contextLost = true;
    lostCount++;
    report('context-lost', `WebGL 上下文丢失（第 ${lostCount} 次）`);
  },
  restored() {
    const before = stage.quality;
    // 玩家亲手选的画质，第一次丢失时先保留；再丢一次才降
    const q = save.settings.qualityAuto || lostCount >= 2 ? (lowerQuality() ?? before) : before;
    stage.restoreAfterContextLoss(q);
    governor.reset();
    report('context-restored', `画面已恢复 ${before} → ${q}`);
    showToast(q !== before ? '画面恢复了，已自动调低画质' : '画面恢复了');
  },
  timeout() {
    report('context-reload', '上下文 5 秒内没有恢复，提示重新加载');
    void flushErrlog();
  },
});

const governor = new FpsGovernor({ minFps: 24, seconds: 8 });
const input = new Input(canvas);
setupMobilePage(uiRoot);

// 应用已保存的设置
audio.setVolume(save.settings.volume);
if (save.settings.quality !== stage.quality) stage.setQuality(save.settings.quality);

// 首次用户手势后解锁音频（iOS 需要在 touchend / click 里恢复 AudioContext；直到真正运行才移除监听）
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
const unlockAudio = () => {
  audio.unlock();
  if (!audio.running) return;
  for (const ev of UNLOCK_EVENTS) window.removeEventListener(ev, unlockAudio, true);
};
for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, unlockAudio, true);

// 联网层（家庭服务器）：与素材加载并行探测；没有服务器时是离线游客，游戏照旧单机运行
const onlineReady = online.init();
// 每次写存档后通知联网层（防抖后同步到服务器）
onPersist(() => online.saveChanged());

// 先把模型、贴图、天空等素材全部加载完，再进入菜单（场景和角色的构建是同步读取缓存的）
const loading = document.createElement('div');
loading.className = 'boot-loading';
loading.innerHTML =
  '<div class="boot-title">算境突围</div><div class="boot-sub">正在加载战场素材…</div><div class="boot-bar"><i></i></div><div class="boot-pct">0%</div>';
uiRoot.append(loading);
const bootBar = loading.querySelector('i') as HTMLElement;
const bootPct = loading.querySelector('.boot-pct') as HTMLElement;
try {
  await preloadAssets((done, total) => {
    const v = total ? done / total : 1;
    bootBar.style.transform = `scaleX(${v})`;
    bootPct.textContent = `${Math.round(v * 100)}%`;
  });
} catch (e) {
  (loading.querySelector('.boot-sub') as HTMLElement).textContent = '素材加载失败，请检查网络后刷新页面重试。';
  throw e;
}
// 登录状态要在第一次画标题页之前确定（探测通常早已在素材加载期间完成）
await onlineReady;
loading.remove();

const app = new App(stage, input, uiRoot);

function watchFps(rawDt: number): void {
  const m = app.match;
  const live = !!m && !app.paused && m.phase !== 'over' && !document.hidden && !stage.contextLost;
  const r = governor.sample(rawDt, live, LOWER[stage.quality] !== null);
  if (!r) return;
  const fps = Math.round(governor.lastAvg * 10) / 10;
  if (r === 'slow') {
    report('perf', `最低画质下仍持续低帧率（约 ${Math.round(fps)} 帧/秒）`, { ctx: { fps } });
    return;
  }
  const before = stage.quality;
  const q = lowerQuality();
  if (!q) return;
  stage.setQuality(q);
  report('quality', `持续低帧率，自动降画质 ${before} → ${q}`, { ctx: { fps } });
  showToast('画面有点卡，已自动调低画质');
}

/** 主循环里的异常：控制台只打前几次（之后每 300 次打一次），上报由 errlog 去重 */
const loopErrCount = new Map<string, number>();
function loopError(kind: 'loop' | 'render', e: unknown): void {
  const key = `${kind}|${e instanceof Error ? e.message : String(e)}`;
  const n = (loopErrCount.get(key) ?? 0) + 1;
  if (loopErrCount.size > 200) loopErrCount.clear();
  loopErrCount.set(key, n);
  if (n <= 3 || n % 300 === 0) console.error(`[算境突围] 主循环出错（${kind}，第 ${n} 次）`, e);
  reportError(kind, e);
}

// 菜单背景：缓慢环绕地图的镜头
const IDLE_FOV = 58;
function idleCamera(t: number): void {
  const cam = stage.camera;
  const a = t * 0.045 + 0.6;
  const r = 44 + Math.sin(t * 0.11) * 6;
  cam.position.set(Math.cos(a) * r, 24 + Math.sin(t * 0.17) * 3, Math.sin(a) * r);
  cam.lookAt(0, 0, 0);
  if (cam.fov !== IDLE_FOV) {
    cam.fov = IDLE_FOV;
    cam.updateProjectionMatrix();
  }
}

let last = performance.now();
let elapsed = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000;
  // 标签页切到后台再回来时 dt 会很大，这里截断
  const dt = Math.min(0.1, Math.max(0, raw));
  last = now;
  elapsed += dt;
  // 每一步单独兜住：某一帧出错，画面照样画、循环照样转
  try {
    const m = app.match;
    // 画面丢失期间单机对局先停住（看不见就别挨打）；合作模式要继续同步
    if (m) {
      if (!stage.contextLost || m.coop) app.tick(dt);
    } else idleCamera(elapsed);
  } catch (e) {
    loopError('loop', e);
  }
  try {
    stage.render(elapsed);
  } catch (e) {
    loopError('render', e);
  }
  try {
    input.endFrame();
    watchFps(raw);
  } catch (e) {
    loopError('loop', e);
  }
}
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  last = performance.now();
  // iOS 从后台回来时音频上下文可能被挂起
  if (!document.hidden) audio.unlock();
});

// 自动化测试接口
declare global {
  interface Window {
    __game: {
      readonly match: Match | null;
      stage: Stage;
      input: Input;
      app: App;
      startLevel(levelId: string, agentId?: string, opts?: MatchOptions): void;
      /** 开发测试：画面保护与错误记录 */
      gfx: { governor: FpsGovernor; lowerQuality(): Quality | null; reports: typeof recentReports; flush(): Promise<boolean> };
      /** 开发测试：同一浏览器的几个标签页之间开一局合作 / 对战（BroadcastChannel），self = 本页的 seat（0 = 房主）；mode: 'versus' 时 teams[i] 是 seat i 的队伍 */
      coopLocal(o: { seats: number; self: number; levelId?: string; seed?: number; opts?: MatchOptions; mode?: CoopMode; teams?: CoopTeam[] }): LocalCoopLink;
    };
  }
}

window.__game = {
  get match() {
    return app.match;
  },
  stage,
  input,
  app,
  gfx: { governor, lowerQuality, reports: recentReports, flush: flushErrlog },
  startLevel(levelId: string, agentId?: string, opts?: MatchOptions) {
    // 给了 opts（测试）直接开局；否则和点「出击」一样，先按家长设置和游戏时间检查
    void app.requestStart(levelId, agentId ?? save.agent, opts);
  },
  coopLocal(o) {
    const names = ['小明', '小红', '小刚', '小美'];
    const n = Math.max(1, Math.min(4, o.seats));
    const members: CoopMember[] = [];
    for (let i = 0; i < n; i++)
      members.push({
        seat: i,
        playerId: i + 1,
        name: names[i],
        grade: (3 + i) as CoopMember['grade'],
        agentId: AGENTS[i % AGENTS.length].id,
        isHost: i === 0,
        // 联机对战默认：单数 seat 去红队（0 蓝 1 红 2 蓝 3 红）；可用 teams 指定
        team: o.mode === 'versus' ? (o.teams?.[i] ?? ((i % 2) as CoopTeam)) : 0,
      });
    const level = LEVELS.find((l) => l.id === o.levelId) ?? LEVELS[0];
    const seed = o.seed ?? 12345;
    const start: CoopStart = { mode: o.mode ?? 'coop', seed, levelId: level.id, mapId: level.mapId, opts: o.opts ?? {}, members };
    const link = new LocalCoopLink(String(seed), o.self, members);
    app.startCoop(link, start);
    return link;
  },
};
