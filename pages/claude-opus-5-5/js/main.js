// 入口：渲染器、后期、相机模式、交互、主循环
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import GUI from 'lil-gui';
import { createBike, WHEEL_R } from './bike.js';
import { createPelican } from './pelican.js';
import { createWorld, heightAt, ROAD_R } from './world.js';
import { createSkySystem } from './sky.js';
import { createDust, createFeathers } from './effects.js';
import { createAudio } from './audio.js';
import { damp, noise1 } from './helpers.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
const quality = { high: !isMobile };

// ---------- 渲染器 ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  $('loader').innerHTML = '<p role="alert">你的浏览器不支持 WebGL，无法显示 3D 场景。</p>';
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, quality.high ? 2 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.55;
renderer.domElement.setAttribute('aria-label', '3D 场景：一只戴红色头盔、系蓝色围巾的鹈鹕骑着复古自行车绕池塘兜圈');
renderer.domElement.setAttribute('role', 'img');
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 2000);
camera.position.set(6, 3.5, 7);

const skySys = createSkySystem(renderer, scene);
const world = createWorld(scene, quality);

// 月亮
const moon = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: 0xf4f1e0, fog: false, transparent: true }));
scene.add(moon);

// ---------- 主角 ----------
const bike = createBike();
const pelican = createPelican(bike);
bike.root.add(pelican.root);
const rider = new THREE.Group(); rider.add(bike.root); scene.add(rider);
bike.root.rotation.order = 'YXZ';

const dust = createDust(scene);
const feathers = createFeathers(scene);
const audio = createAudio();

// ---------- 后期 ----------
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: quality.high ? 4 : 2 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(renderer.getPixelRatio());
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.25, 0.6, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const vignette = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uAmt: { value: 0.35 }, uTime: { value: 0 }, uGrain: { value: 0.035 }, uWarm: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmt; uniform float uTime; uniform float uGrain; uniform float uWarm; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){ vec4 c=texture2D(tDiffuse,vUv); vec2 d=vUv-0.5; c.rgb*=1.0-dot(d,d)*uAmt*2.2;
      c.rgb = mix(c.rgb, c.rgb*vec3(1.12,0.98,0.80) + vec3(0.03,0.012,0.0), uWarm*0.85); // 黄昏暖调
      c.rgb += (h(vUv*1000.0+uTime)-0.5)*uGrain; gl_FragColor=c; }`,
});
composer.addPass(vignette);

// ---------- 参数与 GUI ----------
const params = {
  speed: reduceMotion ? 2.5 : 4.5, targetSpeed: reduceMotion ? 2.5 : 4.5,
  hour: 17.55, timeFlow: 0.05, autoTime: true,
  camera: reduceMotion ? 'orbit' : 'cinematic',
  bloom: true, shadows: true, dust: true, grain: true,
  paint: '#1f8a8a', scarf: '#3060e0', helmet: '#e8403a',
};
const gui = new GUI({ title: '控制面板', width: 260 });
gui.add(params, 'targetSpeed', 0, 12, 0.1).name('目标速度 m/s').listen();
gui.add(params, 'hour', 0, 24, 0.01).name('时间 (时)').listen();
gui.add(params, 'autoTime').name('时间流逝');
gui.add(params, 'timeFlow', 0, 1, 0.01).name('流逝速度 (时/秒)');
gui.add(params, 'camera', { '电影运镜': 'cinematic', '自由环绕': 'orbit', '追尾': 'chase', '侧拍': 'side', '鹈鹕视角': 'pov' }).name('相机').listen().onChange(setCamera);
const fx = gui.addFolder('画面');
fx.add(params, 'bloom').name('辉光');
fx.add(params, 'shadows').name('阴影').onChange((v) => { renderer.shadowMap.enabled = v; scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); });
fx.add(params, 'dust').name('扬尘');
fx.add(params, 'grain').name('胶片颗粒');
const look = gui.addFolder('外观');
const findMat = (root, hex) => { const out = []; root.traverse((o) => { if (o.material && o.material.color && o.material.color.getHex() === hex) out.push(o.material); }); return [...new Set(out)]; };
const paintMats = findMat(bike.root, 0x1f8a8a), scarfMats = findMat(pelican.root, 0x3060e0), helmetMats = findMat(pelican.root, 0xe8403a);
look.addColor(params, 'paint').name('车身颜色').onChange((v) => paintMats.forEach((m) => m.color.set(v)));
look.addColor(params, 'scarf').name('围巾颜色').onChange((v) => scarfMats.forEach((m) => m.color.set(v)));
look.addColor(params, 'helmet').name('头盔颜色').onChange((v) => helmetMats.forEach((m) => m.color.set(v)));
fx.close(); look.close();
if (isMobile) gui.close();

// ---------- 相机 ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 1.5; controls.maxDistance = 60;
controls.enabled = params.camera === 'orbit';
const CAMS = ['cinematic', 'orbit', 'chase', 'side', 'pov'];
const CAM_NAMES = { cinematic: '电影运镜', orbit: '自由环绕', chase: '追尾', side: '侧拍', pov: '鹈鹕视角' };
function setCamera(mode) {
  params.camera = mode; controls.enabled = mode === 'orbit';
  if (mode === 'orbit') controls.target.copy(bikePos).add(new THREE.Vector3(0, 1.1, 0)); announce(`相机：${CAM_NAMES[mode]}`); $('btn-cam').textContent = `🎥 ${CAM_NAMES[mode]}`; }

// ---------- 状态 ----------
const st = { angle: -Math.PI / 2, dist: 0, wheelAngle: 0, crank: 0, crankRate: 1, coast: false, keys: {}, t: 0, shotT: 0, shot: 0, prevPos: new THREE.Vector3(), intro: reduceMotion ? 0 : 1 };
const tmpV = new THREE.Vector3(), fwd = new THREE.Vector3(), left = new THREE.Vector3(), camGoal = new THREE.Vector3(), lookGoal = new THREE.Vector3(), camLook = new THREE.Vector3();
const bikePos = new THREE.Vector3();

// ---------- 交互 ----------
const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(bike.root, true);
  if (!hits.length) return;
  let o = hits[0].object, isPelican = false;
  while (o) { if (o === pelican.root) { isPelican = true; break; } o = o.parent; }
  if (isPelican) doSquawk(); else doBell();
});
function doSquawk() { pelican.squawk(); audio.squawk(); feathers.burst(pelican.head.getWorldPosition(tmpV).clone().add(new THREE.Vector3(0, -0.3, 0))); announce('鹈鹕：嘎——！'); }
function doBell() { bike.ringBell(); audio.bell(); announce('叮铃铃'); }
function toggleNight() { const isNight = skySys.state.night > 0.5; params.hour = isNight ? 9.5 : 20.8; announce(isNight ? '切换到白天' : '切换到夜晚'); }
async function toggleSound() { const on = await audio.toggle(); $('btn-sound').textContent = on ? '🔊 声音开' : '🔇 声音关'; $('btn-sound').setAttribute('aria-pressed', String(on)); }
function screenshot() {
  composer.render();
  renderer.domElement.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'pelican-bicycle.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
  announce('已保存截图');
}
function cycleCam() { setCamera(CAMS[(CAMS.indexOf(params.camera) + 1) % CAMS.length]); }
function toggleUI() { document.body.classList.toggle('hide-ui'); gui.show(!document.body.classList.contains('hide-ui')); }

addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('.lil-gui')) return;
  const k = e.key.toLowerCase(); st.keys[k] = true;
  if (k === ' ') { st.coast = true; e.preventDefault(); }
  if (k === 'b') doBell();
  if (k === 'q') doSquawk();
  if (k === 'c') cycleCam();
  if (k === 'n') toggleNight();
  if (k === 'm') toggleSound();
  if (k === 'h') toggleUI();
  if (k === 'p') screenshot();
  if (['arrowup', 'arrowdown'].includes(k)) e.preventDefault();
});
addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); st.keys[k] = false; if (k === ' ') st.coast = false; });
$('btn-bell').onclick = doBell; $('btn-squawk').onclick = doSquawk; $('btn-cam').onclick = cycleCam; $('btn-night').onclick = toggleNight;
$('btn-sound').onclick = toggleSound; $('btn-shot').onclick = screenshot; $('btn-ui').onclick = toggleUI;
const hold = (id, on, off) => { const b = $(id); b.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, off); };
hold('btn-faster', () => (st.keys.arrowup = true), () => (st.keys.arrowup = false));
hold('btn-slower', () => (st.keys.arrowdown = true), () => (st.keys.arrowdown = false));
hold('btn-coast', () => (st.coast = true), () => (st.coast = false));

let lastAnnounce = 0;
function announce(msg) { const n = performance.now(); $('live').textContent = msg; lastAnnounce = n; showToast(msg); }
let toastTimer; function showToast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1400); }

function layoutHud() { const h = $('hud'); h.style.top = innerWidth < 760 ? ($('title').getBoundingClientRect().bottom + 8) + 'px' : ''; }
layoutHud();
addEventListener('resize', () => {
  layoutHud();
  if (innerWidth < 760 && !gui._closed) gui.close();
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); bloom.resolution.set(innerWidth, innerHeight);
});

// ---------- 主循环 ----------
const clock = new THREE.Clock();
const UP = new THREE.Vector3(0, 1, 0);
const introFrom = new THREE.Vector3();
const hud = { t: 0, frames: 0, fps: 60, lowT: 0 };
let framesRendered = 0;
const LANE_R = ROAD_R + 0.75;          // 靠右行驶
const GEAR = 2.3;                       // 轮子转 2.3 圈，曲柄转 1 圈

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); st.t += dt; const t = st.t;

  // 速度控制
  if (st.keys.arrowup || st.keys.w) params.targetSpeed = Math.min(12, params.targetSpeed + dt * 3);
  if (st.keys.arrowdown || st.keys.s) params.targetSpeed = Math.max(0, params.targetSpeed - dt * 4);
  params.speed = damp(params.speed, st.coast ? 0 : params.targetSpeed, st.coast ? 0.25 : 1.2, dt);
  const v = params.speed;
  if (params.autoTime) params.hour = (params.hour + dt * params.timeFlow) % 24;

  // 沿圆环前进
  st.angle += (v * dt) / LANE_R; st.dist += v * dt;
  const a = st.angle;
  bikePos.set(Math.cos(a) * LANE_R, heightAt(Math.cos(a) * LANE_R, Math.sin(a) * LANE_R) * 0 + 0.03 + Math.max(0, noise1(st.dist * 3, 5) - 0.85) * 0.03, Math.sin(a) * LANE_R);
  fwd.set(-Math.sin(a), 0, Math.cos(a)); left.set(-Math.cos(a), 0, -Math.sin(a));
  bike.root.position.copy(bikePos);
  st.crankRate = damp(st.crankRate, st.coast || v < 0.05 ? 0 : 1, 6, dt);
  st.crank += ((v * dt) / WHEEL_R / GEAR) * st.crankRate;
  st.wheelAngle = st.dist / WHEEL_R;
  const lean = Math.atan((v * v) / (9.81 * LANE_R)) + Math.sin(st.crank) * 0.025 * st.crankRate * Math.min(v / 3, 1);
  bike.root.rotation.set(lean, -a - Math.PI / 2, 0);
  const steer = Math.atan(1.04 / LANE_R) + (noise1(t * 0.8, 2) - 0.5) * 0.08 * (1 - Math.min(v / 7, 0.8));

  // 天空与昼夜
  const s = skySys.update(params.hour, bikePos, dt);
  world.setNight(s.night, t, s.dusk);
  vignette.uniforms.uWarm.value = s.dusk;
  const md = new THREE.Vector3(-s.sunDir.x, Math.abs(s.sunDir.y) * 0.7 + 0.28, -s.sunDir.z).normalize();
  moon.position.copy(camera.position).addScaledVector(md, 700);
  moon.material.opacity = s.night; moon.visible = s.night > 0.02;

  bike.update(st.wheelAngle, st.crank, steer, v, s.night, dt);

  // 鹈鹕偶尔看向镜头
  let lookTarget = null;
  if (params.camera !== 'pov' && noise1(t * 0.18, 11) > 0.62) {
    bike.root.updateMatrixWorld();
    lookTarget = bike.root.worldToLocal(camera.position.clone());
  }
  pelican.update(st.crank, v, dt, lookTarget);

  world.update(t, v, dt);
  feathers.update(dt, t);
  if (params.dust && v > 0.5) {
    const contact = bikePos.clone().addScaledVector(fwd, -0.52);
    dust.update(dt, contact, v, fwd.clone().negate());
  } else dust.update(dt, bikePos, 0, fwd);
  dust.mat.uniforms.uColor.value.setHSL(0.1, 0.45, THREE.MathUtils.lerp(0.72, 0.2, s.night));
  audio.update(dt, v, s.night, st.crankRate);

  // 后期
  bloom.enabled = params.bloom; bloom.strength = THREE.MathUtils.lerp(0.15, 0.85, s.night);
  vignette.uniforms.uTime.value = t % 100; vignette.uniforms.uGrain.value = params.grain ? 0.03 : 0;

  updateCamera(dt, t, v);
  composer.render();

  // HUD + 自适应画质
  hud.frames++; hud.t += dt;
  if (hud.t > 0.5) {
    hud.fps = hud.frames / hud.t; hud.frames = 0; hud.t = 0;
    const hh = Math.floor(params.hour), mm = Math.floor((params.hour % 1) * 60);
    $('hud-speed').textContent = (v * 3.6).toFixed(1);
    $('hud-dist').textContent = (st.dist / 1000).toFixed(2);
    $('hud-time').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    $('hud-fps').textContent = Math.round(hud.fps);
    $('hud-cadence').textContent = Math.round((v / WHEEL_R / GEAR / (Math.PI * 2)) * 60 * st.crankRate);
    if (hud.fps < 32 && renderer.getPixelRatio() > 1) { hud.lowT += 0.5; if (hud.lowT > 3) { renderer.setPixelRatio(1); composer.setPixelRatio(1); composer.setSize(innerWidth, innerHeight); hud.lowT = 0; } }
  }
  if (++framesRendered === 3) { $('loader').classList.add('done'); introFrom.copy(camera.position); }
  requestAnimationFrame(frame);
}

const SHOT_LEN = 6.5;
function updateCamera(dt, t, v) {
  const mode = params.camera;
  if (mode === 'none') return; // 调试用：外部直接控制相机
  if (mode === 'orbit') {
    tmpV.copy(bikePos).addScaledVector(UP, 1.1).sub(controls.target);
    controls.target.add(tmpV); camera.position.add(tmpV);
    controls.update();
    camera.fov = damp(camera.fov, 50, 3, dt); camera.updateProjectionMatrix();
    return;
  }
  let snap = false;
  if (mode === 'chase') {
    camGoal.copy(bikePos).addScaledVector(fwd, -4.3).addScaledVector(UP, 2.3).addScaledVector(left, 0.3);
    lookGoal.copy(bikePos).addScaledVector(fwd, 2).addScaledVector(UP, 1.2);
  } else if (mode === 'side') {
    camGoal.copy(bikePos).addScaledVector(left, 4.2).addScaledVector(UP, 1.3).addScaledVector(fwd, 0.4); // 内侧拍摄，避开路灯
    lookGoal.copy(bikePos).addScaledVector(UP, 1.05);
  } else if (mode === 'pov') {
    pelican.head.getWorldPosition(camGoal); camGoal.addScaledVector(UP, 0.16).addScaledVector(fwd, -0.05);
    lookGoal.copy(camGoal).addScaledVector(fwd, 6).addScaledVector(UP, -1.3);
    snap = true;
  } else { // cinematic
    st.shotT += dt;
    if (st.shotT > SHOT_LEN) { st.shotT = 0; st.shot = (st.shot + 1) % 6; st.shotAnchor = null; snap = true; }
    const u = st.shotT / SHOT_LEN;
    switch (st.shot) {
      case 0: // 低机位前 3/4，缓慢推近
        camGoal.copy(bikePos).addScaledVector(fwd, 3.6 - u * 1.2).addScaledVector(left, 1.9).addScaledVector(UP, 0.45);
        lookGoal.copy(bikePos).addScaledVector(UP, 1.1); break;
      case 1: // 高空摇臂环绕
        camGoal.copy(bikePos).addScaledVector(left, Math.cos(u * 2) * 9).addScaledVector(fwd, Math.sin(u * 2) * 9).addScaledVector(UP, 6 - u * 2);
        lookGoal.copy(bikePos).addScaledVector(UP, 0.9); break;
      case 2: // 头部特写
        camGoal.copy(bikePos).addScaledVector(fwd, 1.6).addScaledVector(left, 1.2 + u * 0.4).addScaledVector(UP, 2.05);
        pelican.head.getWorldPosition(lookGoal); break;
      case 3: { // 路边固定机位摇镜
        if (!st.shotAnchor) { const aa = st.angle + 0.32; st.shotAnchor = new THREE.Vector3(Math.cos(aa) * (LANE_R - 3.2), 1.1, Math.sin(aa) * (LANE_R - 3.2)); }
        camGoal.copy(st.shotAnchor); lookGoal.copy(bikePos).addScaledVector(UP, 1.0); break;
      }
      case 4: // 传动系统特写
        camGoal.copy(bikePos).addScaledVector(left, -1.25).addScaledVector(UP, 0.42).addScaledVector(fwd, 0.35 - u * 0.5);
        lookGoal.copy(bikePos).addScaledVector(UP, 0.4).addScaledVector(fwd, -0.1); break;
      default: // 池塘对岸远景
        camGoal.copy(bikePos).multiplyScalar(-0.35).setY(2.2 + u);
        lookGoal.copy(bikePos).addScaledVector(UP, 1.0); break;
    }
    if (st.intro > 0) {
      st.intro = Math.max(0, st.intro - dt / 4);
      const e = 1 - Math.pow(st.intro, 3);
      camGoal.lerpVectors(tmpV.copy(bikePos).add(new THREE.Vector3(26, 16, -18)), camGoal.clone(), e);
      snap = true;
    }
    snap = true;
  }
  if (snap) { camera.position.copy(camGoal); camLook.copy(lookGoal); }
  else { camera.position.x = damp(camera.position.x, camGoal.x, 4, dt); camera.position.y = damp(camera.position.y, camGoal.y, 4, dt); camera.position.z = damp(camera.position.z, camGoal.z, 4, dt); camLook.lerp(lookGoal, 1 - Math.exp(-8 * dt)); }
  // 相机不钻地
  camera.position.y = Math.max(camera.position.y, heightAt(camera.position.x, camera.position.z) + 0.25);
  camera.lookAt(camLook);
  const fovGoal = mode === 'chase' ? 50 + v * 1.6 : mode === 'pov' ? 70 : mode === 'cinematic' && st.shot === 2 ? 38 : 50;
  camera.fov = damp(camera.fov, fovGoal, 3, dt); camera.updateProjectionMatrix();
}

setCamera(params.camera);
controls.target.set(0, 1, 0);
window.__pelican = { params, st, scene, camera, setCamera, renderer };
requestAnimationFrame(frame);
