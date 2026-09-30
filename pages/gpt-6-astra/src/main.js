import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRider } from './rider.js';
import { createWorld } from './world.js';
import { createSoundscape } from './audio.js';
import { createRideState, advanceRide, normalizeSpeed, loopProgress } from './ride-state.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const state = createRideState({ reducedMotion: reducedMotion.matches });
const sound = createSoundscape();
let renderer, scene, camera, controls, rider, world;
let animationFrame = 0;
let lastTime = 0;
let elapsed = 0;
let nightAmount = 0;
let actualSpeed = 0;
let distanceTick = 0;
let toastTimeout;
let resetCamera = false;
let ready = false;
let soundBusy = false;
const cameraHome = new THREE.Vector3(8, 10.2, 19);
const targetHome = new THREE.Vector3(0, 1.35, 0.5);
const daySun = new THREE.Color('#fff1d5');
const nightSun = new THREE.Color('#a8c8ee');
const dayAmbient = new THREE.Color('#f9f5e7');
const nightAmbient = new THREE.Color('#94b6d4');

function icon(button, name) { button.querySelector('use').setAttribute('href', `#i-${name}`); }
function toast(message) {
  clearTimeout(toastTimeout);
  $('toast').textContent = message;
  $('toast').classList.add('show');
  toastTimeout = setTimeout(() => $('toast').classList.remove('show'), 3100);
}
function syncPlaying() {
  icon($('pause-button'), state.playing ? 'pause' : 'play');
  $('pause-button').setAttribute('aria-label', state.playing ? '暂停骑行' : '开始骑行');
  $('pause-button').setAttribute('aria-pressed', String(state.playing));
}
function setSpeed(value) {
  state.speed = normalizeSpeed(value);
  $('speed').value = state.speed;
  $('speed-output').value = state.speed;
  const percent = (state.speed - 4) / 24 * 100;
  $('speed').style.background = `linear-gradient(90deg,#7c9876 ${percent}%,${state.night ? '#3c5650' : '#dfe3d6'} ${percent}%)`;
}
function pauseRide() {
  state.playing = !state.playing;
  syncPlaying();
  toast(state.playing ? '好啦，继续追海风。' : '停一停也很好，风景不会跑掉。');
}
function setNight() {
  if (!ready) return;
  state.night = !state.night;
  document.body.classList.toggle('night', state.night);
  document.querySelector('meta[name="theme-color"]').content = state.night ? '#172c31' : '#f7f5ed';
  icon($('weather-button'), state.night ? 'moon' : 'sun');
  $('weather-button').setAttribute('aria-label', state.night ? '切换到阳光日景' : '切换到月光夜景');
  $('weather-button').setAttribute('aria-pressed', String(state.night));
  $('weather-name').textContent = state.night ? '把月光装进口袋' : '一整天的好天气';
  $('weather-detail').textContent = state.night ? 'MOONLIGHT & A THOUSAND LITTLE DREAMS' : 'SUNSHINE & A LITTLE SEA BREEZE';
  rider.setNight(state.night);
  world.setNight(state.night);
  setSpeed(state.speed);
  toast(state.night ? '灯塔亮了，今晚的月光是你的。' : '早安，小岛。又是适合兜风的一天。');
}
async function toggleSound() {
  if (soundBusy) return;
  soundBusy = true;
  try {
    state.sound = await sound.toggle();
    icon($('sound-button'), state.sound ? 'sound' : 'muted');
    $('sound-button').setAttribute('aria-label', state.sound ? '关闭海浪声音' : '打开海浪声音');
    $('sound-button').setAttribute('aria-pressed', String(state.sound));
    toast(state.sound ? '听，是海浪和远处的海鸥。' : '安静一点，也很美好。');
  } catch { toast('当前浏览器暂时不能播放声音。'); }
  finally { soundBusy = false; }
}
async function ringBell() {
  if (!ready) return;
  if (!reducedMotion.matches) rider.ringBell();
  toast('叮铃铃！借过一下，快乐要经过。');
  try { await sound.bell(); } catch { /* Visual bell remains functional without Web Audio. */ }
}
async function takePostcard() {
  if (!ready) return;
  const button = $('photo-button');
  button.disabled = true;
  try {
    await document.fonts.ready;
    renderer.render(scene, camera);
    const canvas = document.createElement('canvas');
    canvas.width = 1800; canvas.height = 1400;
    const painter = canvas.getContext('2d');
    if (!painter) throw new Error('Canvas unavailable');
    painter.fillStyle = state.night ? '#172c31' : '#f7f5ed';
    painter.fillRect(0, 0, canvas.width, canvas.height);
    const source = renderer.domElement;
    const scale = Math.min(1650 / source.width, 1120 / source.height);
    const width = source.width * scale, height = source.height * scale;
    painter.drawImage(source, (1800 - width) / 2, 90 + (1110 - height) / 2, width, height);
    painter.strokeStyle = state.night ? '#476265' : '#d1d9c8';
    painter.lineWidth = 2;
    painter.strokeRect(35, 35, 1730, 1330);
    painter.fillStyle = state.night ? '#e4e5cd' : '#254d41';
    painter.font = '48px Fraunces, Georgia, serif';
    painter.fillText('Greetings from Pelican Island.', 100, 1250);
    painter.font = '19px "DM Sans", sans-serif';
    painter.fillStyle = '#86967e';
    painter.fillText('A SLOWER PACE. A HAPPIER PLACE.  /  PELICAN POST', 100, 1301);
    painter.textAlign = 'right';
    painter.fillText(`${state.distance.toFixed(2)} KM OF GOOD VIBES`, 1700, 1301);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not capture image');
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `pelican-post-${state.night ? 'moonlight' : 'sunshine'}.png`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    $('camera-flash').classList.remove('flash');
    void $('camera-flash').offsetWidth;
    $('camera-flash').classList.add('flash');
    toast('咔嚓！这张海风明信片，送给你。');
  } catch { toast('照片没拍好，再试一次好吗？'); }
  finally { button.disabled = false; }
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else toast('这个浏览器不支持全屏，横屏看看也很棒。');
  } catch { toast('当前浏览器不允许全屏显示。'); }
}

$('pause-button').addEventListener('click', pauseRide);
$('ride-button').addEventListener('click', () => {
  state.playing = true; syncPlaying();
  toast('没有目的地也没关系，我们出发。');
  $('ride-button').querySelector('.ride-label').textContent = '就在这里，慢慢骑';
  if (innerWidth <= 600) $('scene-wrap').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'center' });
});
$('speed').addEventListener('input', (event) => setSpeed(event.target.value));
$('sound-button').addEventListener('click', toggleSound);
$('weather-button').addEventListener('click', setNight);
$('bell-button').addEventListener('click', ringBell);
$('photo-button').addEventListener('click', takePostcard);
$('fullscreen-button').addEventListener('click', toggleFullscreen);
$('reset-button').addEventListener('click', () => { resetCamera = true; toast('回到最喜欢的角度。'); });
const story = $('story-dialog');
$('nav-story').addEventListener('click', () => story.showModal());
story.querySelector('.dialog-close').addEventListener('click', () => story.close());
story.addEventListener('click', (event) => {
  const bounds = story.getBoundingClientRect();
  if (event.target === story && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) story.close();
});
$('nav-escape').addEventListener('click', () => { if (story.open) story.close(); $('main').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth' }); });
document.addEventListener('keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || story.open || /INPUT|TEXTAREA|SELECT|BUTTON|A/.test(event.target.tagName) || event.target.isContentEditable) return;
  const actions = { ' ': pauseRide, b: ringBell, n: setNight, m: toggleSound, p: takePostcard, f: toggleFullscreen, r: () => { resetCamera = true; } };
  const action = actions[event.key.toLowerCase()];
  if (action) { event.preventDefault(); action(); }
});
reducedMotion.addEventListener('change', (event) => {
  if (controls) controls.enableDamping = !event.matches;
  if (event.matches) { state.playing = false; actualSpeed = 0; syncPlaying(); }
});
syncPlaying(); setSpeed(state.speed);

async function initialize() {
  const container = $('scene');
  const mobile = matchMedia('(max-width: 600px)').matches;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.6 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .96;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-10, 10, 8, -8, .1, 150);
  camera.position.copy(cameraHome);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(targetHome);
  controls.enableDamping = !reducedMotion.matches;
  controls.dampingFactor = .065;
  controls.minPolarAngle = .40;
  controls.maxPolarAngle = Math.PI / 2.12;
  controls.minZoom = .7;
  controls.maxZoom = 2.5;
  controls.enablePan = false;
  controls.rotateSpeed = .65;
  controls.zoomSpeed = .7;
  controls.addEventListener('start', () => { resetCamera = false; $('rider-note').style.opacity = '0'; });
  controls.update();
  container.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const rotate = { ArrowLeft: [.12, 0], ArrowRight: [-.12, 0], ArrowUp: [0, -.08], ArrowDown: [0, .08] }[event.key];
    if (!rotate && !['+', '=', '-', '_'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); resetCamera = false;
    if (rotate) {
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta += rotate[0];
      spherical.phi = THREE.MathUtils.clamp(spherical.phi + rotate[1], controls.minPolarAngle, controls.maxPolarAngle);
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
    } else {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * (['+', '='].includes(event.key) ? 1.12 : 1 / 1.12), controls.minZoom, controls.maxZoom);
      camera.updateProjectionMatrix();
    }
    controls.update(); $('rider-note').style.opacity = '0';
  });

  const hemisphere = new THREE.HemisphereLight('#f9f5e7', '#8b9480', 1.65);
  scene.add(hemisphere);
  const sunlight = new THREE.DirectionalLight('#fff1d5', 3.1);
  sunlight.position.set(-6, 12, 7);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  sunlight.shadow.camera.left = -11; sunlight.shadow.camera.right = 11;
  sunlight.shadow.camera.top = 11; sunlight.shadow.camera.bottom = -11;
  sunlight.shadow.camera.near = 1; sunlight.shadow.camera.far = 40;
  sunlight.shadow.normalBias = .035; sunlight.shadow.bias = -.00025;
  sunlight.shadow.radius = 3;
  scene.add(sunlight);
  const rim = new THREE.DirectionalLight('#c2ece2', 1.05);
  rim.position.set(7, 5, -6); scene.add(rim);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .06);
  scene.environment = environment.texture;
  scene.environmentIntensity = .3;
  room.dispose(); pmrem.dispose();

  world = createWorld();
  rider = createRider();
  rider.group.position.set(0, .16, 5.8);
  rider.group.scale.setScalar(1.6);
  scene.add(world.group, rider.group);
  // Soft painted contact shadow keeps the floating diorama grounded on the page.
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128;
  const context = shadowCanvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 64);
  gradient.addColorStop(0, '#27493735'); gradient.addColorStop(.5, '#27493720'); gradient.addColorStop(1, '#27493700');
  context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(25, 23), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, toneMapped: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.08; scene.add(shadow);

  function resize() {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    const aspect = width / height;
    const span = Math.max(14.8, 20.6 / aspect);
    camera.left = -span * aspect / 2; camera.right = span * aspect / 2;
    camera.top = span / 2; camera.bottom = -span / 2;
    camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
  }
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); ready = false; toast('画面暂时休息了，正在等待图形恢复。'); });
  renderer.domElement.addEventListener('webglcontextrestored', () => { ready = true; resize(); });
  rider.update(0, 0, 0); world.update(0, 0, 0);
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  $('loading').classList.add('done');
  setTimeout(() => { $('loading').hidden = true; }, 700);
  ready = true;
  document.documentElement.dataset.sceneReady = 'true';

  function frame(time) {
    animationFrame = requestAnimationFrame(frame);
    if (!ready || document.hidden) { lastTime = time; return; }
    const dt = lastTime ? Math.min((time - lastTime) / 1000, .06) : 0;
    lastTime = time;
    const sceneDt = state.playing ? dt : 0;
    elapsed += sceneDt;
    actualSpeed = reducedMotion.matches ? (state.playing ? state.speed : 0) : THREE.MathUtils.damp(actualSpeed, state.playing ? state.speed : 0, 3, dt);
    if (actualSpeed < .005) actualSpeed = 0;
    // A fixed scene clock freezes decorative motion; dt still expires deliberate bell feedback.
    rider.update(elapsed, dt, actualSpeed);
    world.update(elapsed, sceneDt, actualSpeed);
    if (advanceRide(state, dt)) { toast(`第 ${state.laps} 圈！快乐没有终点。`); rider.ringBell(); }
    distanceTick += dt;
    if (distanceTick > .25) {
      distanceTick = 0;
      $('distance').textContent = state.distance.toFixed(2);
      $('distance-ring').style.strokeDashoffset = 87.965 * (1 - loopProgress(state.distance));
    }
    nightAmount = reducedMotion.matches ? Number(state.night) : THREE.MathUtils.damp(nightAmount, state.night ? 1 : 0, 2.8, dt);
    hemisphere.intensity = THREE.MathUtils.lerp(1.65, .73, nightAmount);
    hemisphere.color.copy(dayAmbient).lerp(nightAmbient, nightAmount);
    sunlight.intensity = THREE.MathUtils.lerp(3.1, 1.15, nightAmount);
    sunlight.color.copy(daySun).lerp(nightSun, nightAmount);
    rim.intensity = THREE.MathUtils.lerp(1.05, 1.85, nightAmount);
    scene.environmentIntensity = THREE.MathUtils.lerp(.3, .15, nightAmount);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(.96, .95, nightAmount);
    shadow.material.opacity = 1 - nightAmount * .45;
    if (resetCamera && reducedMotion.matches) {
      camera.position.copy(cameraHome); controls.target.copy(targetHome); camera.zoom = 1;
      camera.updateProjectionMatrix(); resetCamera = false; $('rider-note').style.opacity = '1';
    }
    if (resetCamera) {
      camera.position.lerp(cameraHome, 1 - Math.exp(-4 * dt));
      controls.target.lerp(targetHome, 1 - Math.exp(-4 * dt));
      camera.zoom = THREE.MathUtils.damp(camera.zoom, 1, 4, dt);
      camera.updateProjectionMatrix();
      if (camera.position.distanceTo(cameraHome) < .025 && Math.abs(camera.zoom - 1) < .005) {
        camera.position.copy(cameraHome); controls.target.copy(targetHome); camera.zoom = 1;
        camera.updateProjectionMatrix(); resetCamera = false; $('rider-note').style.opacity = '1';
      }
    }
    controls.update();
    renderer.render(scene, camera);
  }
  animationFrame = requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', async () => {
    lastTime = 0;
    try { if (document.hidden) await sound.suspend(); else await sound.resume(); } catch { /* Browser audio policy may defer resume until next gesture. */ }
  });
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    cancelAnimationFrame(animationFrame); observer.disconnect(); controls.dispose(); sound.dispose();
    const geometries = new Set(), materials = new Set();
    scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
    shadowTexture.dispose(); environment.dispose(); renderer.dispose();
  });
  // Read-only diagnostics make automated visual and interaction verification reproducible.
  Object.defineProperty(window, '__pelican', { value: {
    get status() { return { ready, ...state, actualSpeed, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, zoom: camera.zoom, camera: camera.position.toArray() }; },
  }, configurable: false });
}

initialize().catch((error) => {
  console.error('Pelican Island could not initialize:', error);
  $('loading').classList.add('error');
  $('loading').replaceChildren();
  const text = document.createElement('p');
  text.textContent = '这座小岛需要支持 WebGL 2 的浏览器。请启用硬件加速，或使用新版 Chrome / Edge / Safari 再试一次。';
  const retry = document.createElement('button'); retry.textContent = '重新试试'; retry.addEventListener('click', () => location.reload());
  $('loading').append(text, retry);
});
