// 主入口：渲染器 / 相机 / 交互 / 昼夜 / 循环
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadAssets, Assets } from './textures.js';
import { buildSky, buildLights, buildOcean, buildBoardwalk, buildGalleryHut, buildParticles, BoardTopY } from './world.js';
import { PelicanBicycle } from './bicycle.js';
import { SoundEngine } from './audio.js';

const canvas = document.getElementById('scene-canvas');
const wrap = document.getElementById('canvas-wrap');

// 无头验证：把关键状态/错误写进 title，便于 dump-dom 读取
const TEST = location.hash === '#test';
if (TEST) document.body.classList.add('test-mode');
const dbg = (msg) => { if (TEST) document.title = 'DBG ' + msg; };
window.addEventListener('error', (e) => dbg('ERROR ' + e.message));

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#cfe4ee', 60, 260);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1200);
camera.position.set(6.5, 3.4, 6.5);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.52;
controls.minDistance = 2.5;
controls.maxDistance = 40;
controls.target.set(0.6, 1.4, 0);

// ---------- 世界 ----------
const state = {
  night: 0,          // 0=白天 1=夜晚（平滑过渡）
  nightTarget: 0,
  autoOrbit: false,
  wire: false,
  speed: 5,
  brake: false,
  ready: false,
};

let sky, lights, ocean, board, particles, pelican;
const sound = new SoundEngine();

const lerp = (a, b, t) => a + (b - a) * t;
const tmpColor = new THREE.Color();

function applyDayNight() {
  const n = state.night;
  // 天空
  tmpColor.set('#3d7ac8').lerp(new THREE.Color('#04070f'), n);
  sky.uniforms.uTop.value.copy(tmpColor);
  tmpColor.set('#cfe4ee').lerp(new THREE.Color('#16243d'), n);
  sky.uniforms.uHorizon.value.copy(tmpColor);
  sky.uniforms.uNight.value = n;
  sky.uniforms.uSunDir.value.set(0.3 - n * 0.6, 0.35 - n * 0.25, -1).normalize();
  // 光照
  lights.sun.intensity = lerp(1.6, 0.06, n);
  lights.moon.intensity = lerp(0.0, 0.5, n);
  lights.hemi.intensity = lerp(0.75, 0.18, n);
  lights.sun.color.set('#fff0d0').lerp(new THREE.Color('#8aa3c8'), n);
  // 海
  ocean.uniforms.uNight.value = n;
  ocean.uniforms.uDeep.value.set('#0d4d6b').lerp(new THREE.Color('#041520'), n);
  ocean.uniforms.uShallow.value.set('#2fa3a8').lerp(new THREE.Color('#0d2a38'), n);
  ocean.uniforms.uSkyTint.value.set('#cfe4ee').lerp(new THREE.Color('#16243d'), n);
  // 雾 & 背景 & 曝光
  scene.fog.color.set('#cfe4ee').lerp(new THREE.Color('#0a1226'), n);
  renderer.toneMappingExposure = lerp(1.05, 0.9, n);
}

// ---------- 初始化 ----------
const loaderFill = document.getElementById('loader-fill');
const setProgress = (p, label) => {
  loaderFill.style.width = `${Math.round(p * 100)}%`;
  if (label) document.querySelector('.loader-text').textContent = `正在加载：${label}`;
};

async function init() {
  setProgress(0.08, '天空与光照');
  sky = buildSky(scene);
  lights = buildLights(scene);

  setProgress(0.2, '海面着色器');
  ocean = buildOcean(scene);

  setProgress(0.32, '贴图素材');
  await loadAssets((label) => setProgress(0.42, label));

  setProgress(0.55, '木板路');
  board = buildBoardwalk(scene);
  buildGalleryHut(scene, Assets.painting);

  setProgress(0.7, '鹈鹕与自行车');
  pelican = new PelicanBicycle(scene);

  setProgress(0.84, '海鸥与浪花');
  particles = buildParticles(scene);

  applyDayNight();
  resize();
  setProgress(1, '完成');

  state.ready = true;
  document.getElementById('loader').classList.add('done');
  if (location.hash === '#test') {
    // 无头验证钩子：跳过缓慢过渡，直接落位
    state.night = state.nightTarget;
    applyDayNight();
    pelican.speed = pelican.targetSpeed = 6;
    // 测试机位：俯瞰全场，便于检查搭建结果
    camera.position.set(8, 8, 10);
    controls.target.set(0.5, 1, 0);
    pelican.update(0.4, 5.0, state); // 预推进几拍，让姿态/踏板/围巾就位
    pelican.update(0.4, 5.4, state);
    pelican.update(0.4, 5.8, state);
    // 同步推进世界再立即渲染一拍，不依赖 RAF 缓慢过渡
    particles.update(0.4, 6.2, pelican.root.position);
    ocean.uniforms.uTime.value = 6.2;
    controls.update();
    renderer.render(scene, camera);
  }
}

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const toast = (msg) => {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove('show'), 1800);
};

$('enter-btn').addEventListener('click', () => {
  wrap.scrollIntoView({ behavior: 'smooth' });
});

$('speed-slider').addEventListener('input', (e) => {
  state.speed = parseFloat(e.target.value);
});

$('auto-orbit').addEventListener('click', (e) => {
  state.autoOrbit = !state.autoOrbit;
  controls.autoRotate = state.autoOrbit;
  controls.autoRotateSpeed = 1.2;
  e.currentTarget.classList.toggle('active', state.autoOrbit);
});

$('wire-toggle').addEventListener('click', (e) => {
  state.wire = !state.wire;
  scene.traverse(o => { if (o.isMesh && o.material) o.material.wireframe = state.wire; });
  e.currentTarget.classList.toggle('active', state.wire);
});

$('day-night').addEventListener('click', (e) => {
  state.nightTarget = state.nightTarget > 0.5 ? 0 : 1;
  e.currentTarget.textContent = state.nightTarget ? '☀ 白天' : '☾ 夜晚';
  e.currentTarget.classList.toggle('active', state.nightTarget > 0.5);
});

$('sound-btn').addEventListener('click', async (e) => {
  const on = sound.toggle();
  if (sound.ctx && sound.ctx.state === 'suspended') await sound.ctx.resume();
  e.currentTarget.textContent = on ? '🔊 声音' : '🔇 声音';
  e.currentTarget.classList.toggle('active', on);
});

// 空格捏闸
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && state.ready) {
    e.preventDefault();
    state.brake = true;
    sound.brakeSqueal();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') state.brake = false;
});

// 点击鹈鹕：射线拾取 → 叫声
const ray = new THREE.Raycaster();
const mouseV = new THREE.Vector2();
let downPos = null;
canvas.addEventListener('pointerdown', (e) => { downPos = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
  downPos = null;
  if (moved > 6 || !pelican) return; // 视为拖拽
  const r = canvas.getBoundingClientRect();
  mouseV.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouseV, camera);
  const hits = ray.intersectObject(pelican.group, true);
  if (hits.length) {
    pelican.bell();
    sound.squawk();
    toast('嘎——！🦩');
  }
});

// 灯箱
document.querySelectorAll('.gallery-card').forEach(card => {
  const open = () => {
    $('lightbox-img').src = card.dataset.lightbox;
    $('lightbox').classList.add('open');
  };
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
});
$('lightbox-close').addEventListener('click', () => $('lightbox').classList.remove('open'));
$('lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') e.currentTarget.classList.remove('open'); });

// ---------- 自适应 ----------
function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let hudT = 0;

const camTarget = new THREE.Vector3();
const camDesired = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (state.ready) {
    // 昼夜平滑
    if (state.night !== state.nightTarget) {
      const d = Math.sign(state.nightTarget - state.night) * dt * 0.5;
      state.night = THREE.MathUtils.clamp(state.night + d, 0, 1);
      applyDayNight();
    }

    pelican.update(dt, t, state);
    ocean.uniforms.uTime.value = t;
    particles.update(dt, t, pelican.root.position);

    // 骑行时轮下喷起细浪
    if (pelican.speed > 2) {
      const gy = pelican.group.position.y;
      particles.emit(pelican.root.position.x - 0.4, BoardTopY + 0.05 + gy, pelican.root.position.z, 1, 0.5, 0.9);
    }

    // 相机跟随（软弹簧）
    pelican.group.getWorldPosition(camTarget);
    camDesired.set(camTarget.x + 6.2, camTarget.y + 3.0, camTarget.z + 6.2);
    const stiff = 1 - Math.exp(-3.2 * dt);
    camera.position.lerp(camDesired, stiff);
    controls.target.lerp(new THREE.Vector3(camTarget.x, camTarget.y + 1.2, camTarget.z), stiff);

    // 捏闸提示
    if (state.brake && pelican.speed > 1) particles.emit(camTarget.x, 0.2, camTarget.z, 0, 0, 0);

    sound.update(dt, pelican.speed);

    // HUD 读数
    hudT += dt;
    if (hudT > 0.15) {
      hudT = 0;
      $('ro-speed').textContent = `${pelican.speed.toFixed(1)} m/s`;
      $('ro-cadence').textContent = `${Math.round(pelican.getCadenceRPM())} rpm`;
      $('ro-dist').textContent = `${(pelican.distance / 1000).toFixed(2)} km`;
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

init().catch(err => {
  console.error(err);
  document.querySelector('.loader-text').textContent = '加载失败：' + err.message;
});
animate();
