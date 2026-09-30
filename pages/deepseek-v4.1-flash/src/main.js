/**
 * main.js — 装配 / 交互 / 主循环
 *
 *   场景：世界(天空·地形·海·道具) + 鹈鹕 + 自行车 + 粒子 + 光照 + HDR 后期
 *   输入：键盘 / 指针拖拽 / 滚轮 / 触摸摇杆 / 游戏手柄
 *   输出：HUD、程序化音效、GLB 导出、PNG 截图、WebM 录屏、状态分享链接
 */
import * as THREE from 'three';
import { World, terrainHeightAt } from './scene/world.js';
import { Environment } from './scene/env.js';
import { PostFX } from './scene/postfx.js';

const _bufSize = new THREE.Vector2();   // 绘制缓冲尺寸复用对象（resize 用）
import { CameraDirector, CAM_MODES } from './scene/camera.js';
import { Spray } from './scene/spray.js';
import { Bicycle, LIVERIES } from './model/bicycle.js';
import { Pelican } from './model/pelican.js';
import { Sim } from './sim/sim.js';
import { Input } from './sim/input.js';
import { Hud, dayPhase } from './ui/hud.js';
import { Audio } from './audio/audio.js';
import { exportGLB, countStats } from './model/exporter.js';
import { clamp, damp } from './lib/util.js';

/* ------------------------------------------------------------------ 配置 */
const QS = new URLSearchParams(location.search);
const IS_TOUCH = matchMedia('(hover: none)').matches;
const QUALITY_CAP = ['low', 'medium', 'high'].includes(QS.get('q')) ? QS.get('q') : (IS_TOUCH ? 'medium' : 'high');
const CHAIN_V_K = 0.0986;                 // 链条线速度 / 车速
const QUALITIES = [{ id: 'low', label: '低' }, { id: 'medium', label: '中' }, { id: 'high', label: '高' }];

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/* ------------------------------------------------------------------ 启动 */
async function boot() {
  const hud = new Hud();
  hud.loading(0.02, '初始化渲染器');

  const renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('scene'),
    antialias: QUALITY_CAP !== 'low', powerPreference: 'high-performance',
    stencil: false, alpha: false, preserveDrawingBuffer: true,
  });
  let pixelRatio = Math.min(devicePixelRatio || 1, QUALITY_CAP === 'high' ? 2 : 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = QUALITY_CAP !== 'low';
  renderer.shadowMap.type = THREE.PCFShadowMap;   // three r18x 已移除 PCFSoftShadowMap
  renderer.toneMapping = THREE.NoToneMapping;      // 色调映射交给后处理
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.autoClear = false;
  renderer.info.autoReset = false;          // 手动重置，便于统计整帧（含后期多趟）绘制量

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.08, 4000);

  const postfx = new PostFX(renderer);
  const env = new Environment(renderer, scene, {
    shadowSize: QUALITY_CAP === 'low' ? 0 : QUALITY_CAP === 'medium' ? 1024 : 2048, quality: QUALITY_CAP,
  });
  await nextFrame();

  hud.loading(0.12, '生成天空 · 海洋 · 地形');
  const world = new World({ scene, env, quality: QUALITY_CAP, renderer });
  await nextFrame();

  let liveryIdx = LIVERIES.findIndex((l) => l.id === QS.get('livery'));
  if (liveryIdx < 0) liveryIdx = 0;
  const livery = LIVERIES[liveryIdx];

  hud.loading(0.42, '组装自行车');
  const bike = new Bicycle({ livery, quality: QUALITY_CAP });
  await nextFrame();

  hud.loading(0.62, '唤醒鹈鹕');
  const pelican = new Pelican({ livery, quality: QUALITY_CAP });
  await nextFrame();

  /* 车 + 鹈鹕挂在同一个「车架组」：一起平移 / 倾斜 / 转向 */
  const rig = new THREE.Group();
  rig.name = 'rig';
  rig.position.set(world.wrapX(0), terrainHeightAt(0), 0);
  rig.add(bike.root, pelican.root);
  scene.add(rig);
  for (const g of [bike.root, pelican.root]) {
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  hud.loading(0.78, '注入粒子与音效');
  const spray = new Spray(scene, { count: QUALITY_CAP === 'low' ? 320 : 800 });
  spray.setViewport(innerHeight, 52);
  const audio = new Audio();
  const sim = new Sim();
  const input = new Input(renderer.domElement);
  const director = new CameraDirector(camera, rig);
  await nextFrame();

  hud.loading(0.9, '编译着色器');
  const startHour = clamp(parseFloat(QS.get('time')) || 12, 0, 23.99);
  world.setTimeOfDay(startHour / 24);
  env.refreshEnvMap(world.sky, true);
  env.update(1 / 60, rig.position, 0);
  renderer.compile(scene, camera);
  await nextFrame();

  /* --------------------------------------------------------------- 状态 */
  const app = {
    hud, renderer, scene, camera, postfx, env, world, bike, pelican, rig, spray, audio, sim, input, director,
    quality: QUALITY_CAP, liveryIdx, stats: countStats(scene), pixelRatio, recorder: null,
    timeHour: startHour, autoRide: IS_TOUCH || QS.get('auto') !== '0', audioOn: false,
    chainTravel: 0, elapsed: 0, paused: false, fps: 60, fpsAcc: 0, fpsN: 0, qTimer: 0, _dt: 1 / 60,
    shot: false, glbBusy: false, zoom: 1, mistT: 0, dustT: 0, gullT: 7, wasAir: false, landed: false,
    focus: new THREE.Vector3(), cf: new THREE.Vector3(), cr: new THREE.Vector3(),
  };
  const camIdx = Math.max(0, CAM_MODES.findIndex((m) => m.id === QS.get('cam')));
  if (camIdx > 0) { director.setMode(camIdx); camera.fov = director.mode.fov; camera.updateProjectionMatrix(); }

  /* HUD 接口 */
  Object.assign(hud.h, {
    hop: () => { app.sim.hopQueued = true; },
    ring: () => { app.sim.bellStrike = 0.65; app.audio.ding(1560); },
    shot: () => { app.shot = true; },
    record: () => toggleRecord(app),
    exportGLB: () => doExport(app),
    share: () => shareURL(app),
    reset: () => { sim.reset(); app.chainTravel = 0; director.snap(); hud.toast('已复位'); },
    auto: () => toggleAuto(app),
    director: () => { director.auto = !director.auto; hud.markAction('auto', false); hud.toast(director.auto ? '自动运镜：开' : '自动运镜：关'); },
    audio: () => toggleAudio(app),
    sound: () => toggleAudio(app),
    obj: () => doExport(app),
    time: (h) => setHour(app, h, false),
    fullscreen: () => {},
  });
  hud.buildCams(CAM_MODES, camIdx, (i) => setCam(app, i));
  hud.buildLivery(LIVERIES, liveryIdx, (i) => setLivery(app, i));
  hud.buildQuality(QUALITIES, QUALITIES.findIndex((q) => q.id === app.quality), (q) => setQuality(app, q));
  hud.bindInput(input, IS_TOUCH);
  const terr = [];
  for (let i = 0; i < 64; i++) terr.push(terrainHeightAt(-95 + (i / 63) * 130));
  hud.setTerrain(terr);

  window.__PELICAN__ = app;      // 调试钩子（控制台可用：__PELICAN__.sim.speed 等）
  wire(app);
  setHour(app, startHour, false);
  addEventListener('resize', () => resize(app));
  document.addEventListener('visibilitychange', () => { app.paused = document.hidden; });
  if (QS.get('hud') === '0') hud.setUIVisible(false);
  resize(app);                  // 首帧前定尺寸：后期 RT 必须与绘制缓冲一致（否则画面被 2×2 RT 拉伸）

  hud.loading(1, '就绪');
  await nextFrame();
  hud.ready();
  hud.toast(IS_TOUCH ? '摇杆转向·上下滑加速 · 首次触碰开启音效' : 'W/S 踩踏刹车 · A/D 转向 · 空格跳跃 · C 换机位 · G 导出 GLB', 5200);
  requestAnimationFrame((t) => frame(app, t));
}

/* --------------------------------------------------------------- 交互绑定 */
function wire(app) {
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    switch (e.code) {
      case 'KeyC': setCam(app, (CAM_MODES.indexOf(app.director.mode) + 1) % CAM_MODES.length); break;
      case 'KeyL': setLivery(app, app.liveryIdx + 1); break;
      case 'KeyT': setHour(app, app.timeHour + 2, false); break;
      case 'KeyY': setHour(app, app.timeHour - 2, false); break;
      case 'KeyX': toggleAuto(app); break;
      case 'KeyV': app.director.auto = !app.director.auto; app.hud.toast(app.director.auto ? '自动运镜：开' : '自动运镜：关'); break;
      case 'KeyM': toggleAudio(app); break;
      case 'KeyQ': setQuality(app, QUALITIES[(QUALITIES.findIndex((q) => q.id === app.quality) + 1) % 3].id); break;
      case 'KeyH': app.hud.toggleUI(); break;
      case 'KeyG': doExport(app); break;
      case 'KeyP': app.shot = true; break;
      case 'KeyR': toggleRecord(app); break;
      case 'KeyB': app.sim.bellStrike = 0.65; app.audio.ding(1560); break;
      case 'Escape': app.hud.showHelp(false); break;
      default: break;
    }
  });
  // 首次交互解锁音频（浏览器自动播放策略）
  const unlock = () => {
    if (!app.audioOn) app.audio.enable().then(() => {
      app.audioOn = true;
      app.hud.setSoundIcon(true);
    });
  };
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });
}

/* --------------------------------------------------------------- 控制逻辑 */
function setCam(app, i) {
  const idx = ((i % CAM_MODES.length) + CAM_MODES.length) % CAM_MODES.length;
  const m = app.director.setMode(idx);
  app.camera.fov = m.fov;
  app.camera.updateProjectionMatrix();
  app.spray.setViewport(innerHeight, m.fov);
  app.hud.markChips('cam', idx);
  app.hud.toast(`机位：${m.label}`);
}

function setLivery(app, i) {
  app.liveryIdx = ((i % LIVERIES.length) + LIVERIES.length) % LIVERIES.length;
  const l = LIVERIES[app.liveryIdx];
  app.bike.setLivery(l);
  app.pelican.setLivery(l);
  app.hud.markChips('livery', app.liveryIdx);
  app.hud.toast(`涂装：${l.name}`);
}

function setHour(app, h, bakeEnv = false) {
  app.timeHour = ((h % 24) + 24) % 24;
  app.world.setTimeOfDay(app.timeHour / 24);
  app.hud.setTime(app.timeHour);
  if (bakeEnv) app.env.refreshEnvMap(app.world.sky, true);
}

function toggleAuto(app) {
  app.autoRide = !app.autoRide;
  app.hud.markAction('auto', app.autoRide);
  app.hud.toast(app.autoRide ? '自动骑行：开（演示巡航）' : '自动骑行：关');
}

function toggleAudio(app) {
  if (app.audioOn) {
    app.audio.setEnabled(false);
    app.audioOn = false;
    app.hud.setSoundIcon(false);
  } else {
    app.audio.enable().then(() => {
      app.audioOn = true;
      app.hud.setSoundIcon(true);
    });
  }
}

function setQuality(app, q) {
  app.quality = q;
  app.bike.setQuality(q);
  app.pelican.setQuality(q);
  app.world.setQuality(q);
  app.env.setQuality(q);
  app.renderer.shadowMap.enabled = q !== 'low';
  app.hud.markChips('quality', QUALITIES.findIndex((x) => x.id === q));
  app.hud.toast(`画质：${QUALITIES.find((x) => x.id === q).label}${q === 'low' ? '（关闭阴影与草）' : ''}`);
}

async function doExport(app) {
  if (app.glbBusy) return;
  app.glbBusy = true;
  app.hud.toast('正在导出 glTF …');
  try {
    const size = await exportGLB(app.rig, 'pelican-bicycle.glb');
    app.hud.toast(`已导出 pelican-bicycle.glb（${(size / 1024).toFixed(0)} KB）`, 3400);
  } catch (err) {
    app.hud.toast(`导出失败：${err.message}`, 3400);
  }
  app.glbBusy = false;
}

function toggleRecord(app) {
  if (app.recorder) { app.recorder.stop(); return; }
  const canvas = app.renderer.domElement;
  if (!window.MediaRecorder || !canvas.captureStream) { app.hud.toast('当前浏览器不支持画布录屏'); return; }
  const stream = canvas.captureStream(30);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const chunks = [];
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : undefined);
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pelican-rider-${Date.now()}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    app.recorder = null;
    app.hud.setRecording(false);
    app.hud.toast(`录屏已保存（${(blob.size / 1048576).toFixed(1)} MB）`, 3200);
  };
  rec.start(500);
  app.recorder = rec;
  app.hud.setRecording(true);
  app.hud.toast('开始录屏 · 再按 R 停止并下载');
}

function shareURL(app) {
  const u = new URL(location.href);
  u.search = new URLSearchParams({
    time: app.timeHour.toFixed(1), livery: LIVERIES[app.liveryIdx].id,
    cam: app.director.mode.id, q: app.quality,
  }).toString();
  const txt = u.toString();
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(txt).then(
      () => app.hud.toast(`链接已复制：${txt.length > 60 ? txt.slice(0, 60) + '…' : txt}`, 4200),
      () => app.hud.toast(txt, 6000));
  } else app.hud.toast(txt, 6000);
}

function resize(app) {
  const { renderer, camera, postfx, spray } = app;
  camera.aspect = innerWidth / innerHeight;
  // 底部常驻 HUD 面板，把投影窗口整体下移 11%，画面内容随之整体上移，
  // 主体（鹈鹕 + 单车）才能落进 HUD 上方那条可视带里。
  camera.setViewOffset(innerWidth, innerHeight, 0, Math.round(innerHeight * 0.12), innerWidth, innerHeight);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  // 后期 RT 必须等于绘制缓冲分辨率（含 devicePixelRatio），否则整帧会被拉伸
  renderer.getDrawingBufferSize(_bufSize);
  postfx.setSize(_bufSize.x, _bufSize.y);
  spray.setViewport(innerHeight, camera.fov);
}

/* ------------------------------------------------------------------ 主循环 */
function frame(app, now) {
  requestAnimationFrame((t) => frame(app, t));
  const dt = clamp((now - (app._last || now)) / 1000, 0.0005, 0.05);
  app._last = now;
  app._dt = dt;
  if (app.paused) return;
  app.elapsed += dt;
  app.renderer.info.reset();

  const { sim, input, bike, pelican, rig, world, env, camera, director, postfx, spray, hud } = app;

  /* 输入 → 物理 */
  const inp = input.update(dt, { autoRide: app.autoRide });
  const st = sim.update(dt, inp, {
    hop: input.take('Space') || sim.hopQueued,
    lookDir: { x: 1, z: clamp(-sim.steerSmooth * 0.6, -0.6, 0.6) },
  });
  sim.hopQueued = false;
  st.lookX = inp.lookX;
  st.lookY = inp.lookY;
  if (inp.zoom) app.zoom = clamp(app.zoom * (1 + inp.zoom * 0.12), 0.45, 2.4);
  director._zoomTarget = app.zoom;

  /* 车体姿态（rig 同时承载自行车与鹈鹕） */
  rig.rotation.x = damp(rig.rotation.x, st.steerSmooth * 0.10, 6, dt);
  rig.rotation.y = damp(rig.rotation.y, -st.steerSmooth * 0.30, 5, dt);
  rig.rotation.z = damp(rig.rotation.z, clamp(st.accel * 0.006, -0.05, 0.06) - st.brake * 0.028, 7, dt);
  rig.position.x = world.wrapX(sim.dist);
  rig.position.y = damp(rig.position.y, terrainHeightAt(0), 20, dt);

  /* 车灯 / 夜色 */
  st.lampMix = clamp(env.night * 1.25 - 0.05, 0, 1);

  /* IK 目标：握把与踏板（自行车局部坐标） */
  st.grips[0] = bike.gripLocal(-1, st.steer, new THREE.Vector3());
  st.grips[1] = bike.gripLocal(1, st.steer, new THREE.Vector3());
  st.pedals[0] = bike.pedalLocal(-1, st.crankAngle, new THREE.Vector3());
  st.pedals[1] = bike.pedalLocal(1, st.crankAngle, new THREE.Vector3());

  /* 链条相位：链节按线速度推进 */
  app.chainTravel += CHAIN_V_K * st.speed * dt;
  st.chainPhase = app.chainTravel / (bike.chainPitch || 0.0127);
  st.tension = st.chainTension;

  /* 模型 */
  bike.update(dt, st);
  pelican.update(dt, st);
  rig.updateMatrixWorld(true);
  app.focus.copy(rig.position);
  app.focus.y += 0.75;

  /* 世界与光照 */
  world.update(dt, sim.dist, camera.position, app.elapsed);
  env.update(dt, app.focus, app.elapsed);
  env.refreshEnvMap(world.sky);

  /* 相机 */
  director.update(dt, st, app.focus);

  /* 粒子与音效 */
  emitParticles(app, dt, st);
  if (app.audioOn) {
    app.audio.setRide({ speed: st.speed, cadence: st.cadence, air: st.hopAir, boosted: st.boost });
    app.gullT -= dt;
    if (app.gullT <= 0) { app.audio.gull(); app.gullT = 9 + Math.random() * 16; }
  }
  if (st.hopAir && !app.wasAir && app.audioOn) app.audio.ding(1400);
  app.wasAir = st.hopAir;

  /* 渲染：HDR + 泛光 + 速度模糊 + 暗角 + 颗粒 */
  const sp = clamp(Math.abs(st.speed) / 20, 0, 1);
  postfx.render(app.scene, camera, {
    exposure: 0.92 + (1 - env.night) * 0.30 + env.night * 0.22,
    bloom: 0.34 + env.night * 0.62,
    bloomThreshold: 0.90, bloomClamp: 12,
    speedBlur: sp * sp * 1.7,
    chroma: 0.0014 + sp * 0.0042,
    vignette: 0.30 + sp * 0.13,
    grain: 0.020 + env.night * 0.024,
    time: app.elapsed,
    saturation: 1.05 + env.night * 0.08,
    contrast: 0.34,
  });
  if (app.shot) { app.shot = false; screenshot(app); }

  /* HUD 与自适应画质 */
  hud.tick(app, st);
  app.fpsAcc += dt; app.fpsN++;
  if (app.fpsAcc > 0.4) {
    app.fps = app.fpsN / app.fpsAcc;
    app.fpsAcc = 0; app.fpsN = 0;
    autoQuality(app);
  }
  input.endFrame();
}

/* ------------------------------------------------------------ 粒子发射器 */
function emitParticles(app, dt, st) {
  const { spray, bike, rig } = app;

  // 落地扬尘
  if (st.landKick > 0.30 && !app.landed) {
    app.landed = true;
    app.cf.set(bike.geo.frontAxle.x, 0.02, 0).applyMatrix4(rig.matrixWorld);
    app.cr.set(bike.geo.rearAxle.x, 0.02, 0).applyMatrix4(rig.matrixWorld);
    const n = Math.round(5 + st.landKick * 13);
    spray.burst(app.cf, { n, spread: 1.5 + st.landKick, up: 1.35, back: st.speed * 0.05, size: 0.075, life: 0.9, color: [0.72, 0.63, 0.48], grav: 6.5, drag: 1.1 });
    spray.burst(app.cr, { n, spread: 1.3 + st.landKick, up: 1.15, back: st.speed * 0.05, size: 0.070, life: 0.85, color: [0.70, 0.61, 0.46], grav: 6.5, drag: 1.1 });
  } else if (st.landKick < 0.1) app.landed = false;

  // 高速时后轮细尘
  if (st.speed > 6) {
    app.dustT -= dt * (st.speed / 12);
    if (app.dustT <= 0) {
      app.dustT = 0.07;
      app.cr.set(bike.geo.rearAxle.x - 0.30, 0.05, 0).applyMatrix4(rig.matrixWorld);
      spray.burst(app.cr, { n: 2, spread: 0.4, up: 0.45, back: 1.4, size: 0.05, life: 0.5, color: [0.78, 0.72, 0.58], grav: 1.0, drag: 2.2 });
    }
  }

  // 海岸薄雾
  app.mistT -= dt;
  if (app.mistT <= 0 && app.quality !== 'low') {
    app.mistT = 0.24;
    spray.puff(
      new THREE.Vector3(app.camera.position.x + (Math.random() - 0.5) * 76, -0.15 + Math.random() * 0.55, 9.5 + Math.random() * 24),
      { n: 1, size: 1.7, life: 3.4, spread: 0.4, color: [0.93, 0.96, 0.99] }
    );
  }
  spray.update(dt);
}

/* --------------------------------------------------------------- 辅助功能 */
function screenshot(app) {
  try {
    const url = app.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `pelican-bicycle-${Date.now()}.png`;
    a.click();
    app.hud.toast('已保存截图 PNG');
  } catch (e) {
    app.hud.toast('截图失败（浏览器限制）', 2600);
  }
}

/** 帧率过低时逐步降低渲染倍率，恢复后自动升回 */
function autoQuality(app) {
  const cap = Math.min(devicePixelRatio || 1, app.quality === 'high' ? 2 : 1.5);
  if (app.fps < 42) {
    app.qTimer += 0.4;
    if (app.qTimer > 1.6 && app.pixelRatio > 1.0) {
      app.pixelRatio = Math.max(1.0, app.pixelRatio - 0.25);
      app.renderer.setPixelRatio(app.pixelRatio);
      resize(app);
      app.hud.toast(`性能优化：渲染倍率 → ${app.pixelRatio.toFixed(2)}`, 1600);
      app.qTimer = 0;
    }
  } else if (app.fps > 58) {
    app.qTimer = Math.max(0, app.qTimer - 0.2);
    if (app.pixelRatio < cap && app.qTimer <= 0) {
      app.pixelRatio = Math.min(cap, app.pixelRatio + 0.25);
      app.renderer.setPixelRatio(app.pixelRatio);
      resize(app);
    }
  }
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('boot-msg');
  if (el) el.textContent = `启动失败：${err.message}`;
});
