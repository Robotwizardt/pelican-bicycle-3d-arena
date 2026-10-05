/**
 * main.js —— 装配与主循环
 *
 * 渲染器设置要点：
 *  - WebGLRenderer，antialias 由画质档决定
 *  - outputColorSpace = SRGBColorSpace（r152+ 的新写法）
 *  - toneMapping = ACESFilmic，exposure 由时间轴微调
 *  - PCFSoft 阴影；太阳阴影相机跟随骑手，保证近处永远有清晰影子
 *  - 一个 EffectComposer：RenderPass → 自研渐晕/色调 ShaderPass → OutputPass
 *    （刻意不抄官方 Bloom/GTAO 的重型 pass：自定义 pass 更轻、更贴画面）
 *  - 像素比钳制在 [1, 2]，并按帧率动态降级（自适应分辨率）
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { clamp, clamp01, damp, lerp, smoothstep } from './util.js';
import { makeAsphaltTexture, makeCanvasTextures, makeFeatherTexture, makeRockTexture, makeWaterNormals } from './noise.js';
import { createSea, createSky, Timeline } from './scene/world.js';
import { createCape } from './scene/cape.js';
import { createLighthouse, createPostOffice, makeCorrugatedTexture } from './scene/lighthouse.js';
import { createGulls } from './scene/gulls.js';
import { createPelican } from './creature/pelican.js';
import { createBicycle } from './creature/bicycle.js';
import { createRide, MODE } from './state/ride.js';
import { createWeather } from './weather.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

/* ------------------------------------------------------------------ 后期处理 */

const GradePass = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uTime: { value: 0 },
    uNight: { value: 0 },
    uMotion: { value: 0 },
    // 色散基值。之前的 0.0015 配着 “速度 ×6” 的系数，高速时能到 0.0105，
    // 屏幕上每条边都镶一道彩虹边。现在压到只有轻微镜头感。
    uAberration: { value: 0.0007 },
    uSaturation: { value: 1.06 },
    uLift: { value: new THREE.Vector3(0.0, 0.0, 0.01) },
    uGain: { value: new THREE.Vector3(1.02, 1.0, 0.97) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uTime;
    uniform float uNight;
    uniform float uMotion;
    uniform float uAberration;
    uniform float uSaturation;
    uniform vec3 uLift;
    uniform vec3 uGain;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot( c, c );

      // 速度越高，边缘轻微色散（像镜头）。系数从 6 降到 2.5，
      // 否则巡航速度下就已经是一圈明显的彩色描边。
      float ab = uAberration * ( 1.0 + uMotion * 2.5 );
      vec3 col;
      col.r = texture2D( tDiffuse, uv + c * ab ).r;
      col.g = texture2D( tDiffuse, uv ).g;
      col.b = texture2D( tDiffuse, uv - c * ab ).b;

      // 提升/增益调色：夜里偏青蓝（更像月光），白天偏暖
      col = col * uGain + uLift * ( 0.35 + uNight * 0.65 );

      // 饱和度
      float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = mix( vec3( l ), col, uSaturation );

      // 渐晕
      float vig = 1.0 - uVignette * smoothstep( 0.15, 0.75, r2 );
      col *= vig;

      // 夜里加一点噪点（模拟高感光度）
      float n = fract( sin( dot( uv * ( 1.0 + uTime * 0.001 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
      col += ( n - 0.5 ) * 0.022 * uNight;

      gl_FragColor = vec4( col, 1.0 );
    }
  `,
};

/* ------------------------------------------------------------------ 启动 */

function boot() {
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r0.186 移除了 PCFSoftShadowMap

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.08, 6000);
  camera.position.set(0, 8, 20);

  /* ---------------- 灯光 ---------------- */
  const hemi = new THREE.HemisphereLight(0x7fa2cc, 0x59544a, 0.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dc, 1.85);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  const SH = 34;
  sun.shadow.camera.left = -SH;
  sun.shadow.camera.right = SH;
  sun.shadow.camera.top = SH;
  sun.shadow.camera.bottom = -SH;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.022;
  scene.add(sun);
  scene.add(sun.target);
  // 补光：从海面方向反射回来的冷光，让阴影不至于死黑
  const fill = new THREE.DirectionalLight(0xa8c8e8, 0.35);
  fill.position.set(-1, 0.4, 1);
  scene.add(fill);

  /* ---------------- 天空 / 海 / 雾 ---------------- */
  const sky = createSky();
  sky.mesh.scale.setScalar(4000);
  scene.add(sky.mesh);
  scene.fog = new THREE.FogExp2(0xb6c9d8, 0.0055);

  const timeline = new Timeline();
  const sea = createSea(renderer, sky.uniforms, { extent: 3000, segments: 200 });
  sea.mesh.position.set(0, 0, 0);
  scene.add(sea.mesh);

  /* ---------------- 贴图 ---------------- */
  const textures = {
    rock: makeRockTexture(512, 5),
    asphalt: makeAsphaltTexture(512, 17),
    canvas: makeCanvasTextures(256),
    feather: makeFeatherTexture(256),
    corrugated: makeCorrugatedTexture(),
  };
  const normals = makeWaterNormals(renderer);
  sea.uniforms.uNormalBig.value = normals.big;
  sea.uniforms.uNormalRipple.value = normals.ripple;
  sea.uniforms.uNoise.value = normals.ripple;

  /* ---------------- 世界 ---------------- */
  const cape = createCape(scene, textures);
  // 让海面着色器知道岬角到底有多大（否则海会盖到公路上）
  sea.fitCape(cape.track, cape.track.centroid);
  // 地标：灯塔放在环的东北高点，邮局放在码头旁
  const lhS = cape.at(cape.stations.lighthouse * cape.length);
  const lighthouse = createLighthouse(scene, textures, {
    position: new THREE.Vector3(lhS.pos.x + lhS.outward.x * -13, lhS.pos.y - 0.2, lhS.pos.z + lhS.outward.z * -13),
  });
  const poS = cape.at(cape.stations.postOffice * cape.length);
  const postOffice = createPostOffice(scene, textures, {
    position: new THREE.Vector3(
      poS.pos.x + poS.outward.x * -9.5,
      poS.pos.y - 0.1,
      poS.pos.z + poS.outward.z * -9.5
    ),
    yaw: Math.atan2(poS.outward.x, poS.outward.z) + 0.25,
  });

  const gulls = createGulls(scene, new THREE.Vector3(lighthouse.position.x, 0, lighthouse.position.z), 9);

  /* ---------------- 主角 ---------------- */
  const pelican = createPelican({ texture: textures.feather });
  const bike = createBicycle({ number: '404' });

  /* ---------------- 骑乘 ---------------- */
  const ride = createRide({
    scene,
    cape,
    lighthouse,
    bike,
    pelican,
    camera,
    controls: null,
    audio: null,
    gulls,
  });
  // 出生点：邮局门口
  const startS = (cape.stations.postOffice + 0.012) * cape.length;
  ride.teleport(startS);
  ride.state.speed = 0;
  ride.state.mode = MODE.INTRO;

  /* ---------------- 天气 ---------------- */
  const weather = createWeather({
    scene,
    skyUniforms: sky.uniforms,
    seaUniforms: sea.uniforms,
    sun,
    hemi,
    dirLight: sun,
    timeline,
  });
  // 起始时间选下午 3 点半：太阳高度角还在 20° 左右，长影子拉得开、天空渐变最丰富，
  // 既是白天看得清鹈鹕配色，又能保留金色时刻的氛围。17 点半一进场就快黑了。
  weather.hour = 15.5;
  weather.weather = 0;
  weather.wind = 0.45;
  weather.autoTime = true;

  /* ---------------- 音频 ---------------- */
  const audio = createAudio();
  ride.state.audioRef = audio;

  /* ---------------- HUD ---------------- */
  const hud = createHud({
    ride,
    weather,
    audio,
    onQuality: (q) => applyQuality(q),
  });
  ride.capeLength = cape.length;

  /* ---------------- 后期 ---------------- */
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(window.innerWidth, window.innerHeight);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const gradePass = new ShaderPass(GradePass);
  composer.addPass(gradePass);
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  /* ---------------- 画质档 ---------------- */
  let quality = 'high';
  const QUALITY = {
    low: { pixelRatio: 1, shadow: 1024, post: false, grass: false, seaSeg: 110 },
    medium: { pixelRatio: 1.5, shadow: 1536, post: true, grass: true, seaSeg: 160 },
    high: { pixelRatio: 2, shadow: 2048, post: true, grass: true, seaSeg: 200 },
  };
  function applyQuality(q) {
    quality = q;
    const Q = QUALITY[q];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, Q.pixelRatio));
    composer.setPixelRatio(Math.min(window.devicePixelRatio, Q.pixelRatio));
    renderer.shadowMap.enabled = Q.shadow > 0;
    sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
    gradePass.enabled = Q.post;
    grassToggle(Q.grass);
  }
  function grassToggle(on) {
    const grass = scene.getObjectByName('grass');
    if (grass) grass.visible = on;
  }

  /* ---------------- 输入 ---------------- */
  const keys = new Set();
  let manualMode = false;
  const isManual = () => manualMode;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        break;
      case 'KeyC':
        ride.cycleCamera();
        break;
      case 'KeyM':
        manualMode = ride.toggleManual();
        break;
      case 'KeyF':
        ride.launchFlight();
        break;
      case 'KeyR':
        ride.teleport(startS);
        ride.state.speed = 0;
        break;
      case 'KeyT':
        weather.autoTime = !weather.autoTime;
        break;
      case 'BracketLeft':
        weather.weather = (Math.round(weather.weather) + 3) % 4;
        break;
      case 'BracketRight':
        weather.weather = (Math.round(weather.weather) + 1) % 4;
        break;
      case 'Comma':
        weather.hour -= 0.25;
        weather.autoTime = false;
        break;
      case 'Period':
        weather.hour += 0.25;
        weather.autoTime = false;
        break;
      case 'KeyP':
        document.body.classList.toggle('nohud');
        break;
      default:
        break;
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  /* ---------------- 主循环 ---------------- */
  const clock = new THREE.Timer();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let dynamicScale = 1;
  let autoHourAccum = 0;
  const tmpV = new THREE.Vector3();

  function frame(ts) {
    clock.update(ts); // r0.186 的 Timer：先 update 再取 delta / elapsed
    const dt = Math.min(clock.getDelta(), 1 / 20);
    const t = clock.getElapsed();

    // 自动时间：每 6 秒推进 0.5 分钟（一整天约 48 分钟）。
    // 之前是 1.2 秒/0.5 分钟，一小时 2 分钟就过完了，光影变化快到让人晕。
    if (weather.autoTime) {
      autoHourAccum += dt;
      if (autoHourAccum > 6) {
        autoHourAccum = 0;
        weather.hour += 0.5 / 60;
        if (weather.hour >= 24) weather.hour -= 24;
      }
    }

    // 手动输入
    if (manualMode) {
      const up = keys.has('KeyW') || keys.has('ArrowUp');
      const down = keys.has('KeyS') || keys.has('ArrowDown');
      const brake = keys.has('Space');
      ride.setInput({ throttle: up ? 1 : down ? 0.15 : 0.35, brake: brake ? 1 : 0, manual: true });
    } else {
      ride.setInput({ manual: false });
      ride.checkStops();
    }

    // 推进骑乘
    const st = ride.update(dt);

    // 天气与时间
    const envInfo = weather.update(dt, t);
    sky.uniforms.uTime.value = t;
    sea.uniforms.uTime.value = t;
    sea.uniforms.uCameraPos.value.copy(camera.position);
    // 天空球跟着相机走
    sky.mesh.position.copy(camera.position);

    // 阴影相机跟随骑手
    const focus = ride.group.position;
    tmpV.copy(envInfo.sunDir).multiplyScalar(60).add(focus);
    sun.position.copy(tmpV);
    sun.target.position.copy(focus);
    sun.target.updateMatrixWorld();

    // 路灯 / 车灯 / 灯塔
    applyNightLights(envInfo.night);

    // 灯塔
    lighthouse.update(dt, t);
    lighthouse.setNight(envInfo.night);

    // 音频
    audio.update(st.speed);

    // 后期参数随速度/夜色变化
    gradePass.uniforms.uTime.value = t;
    gradePass.uniforms.uNight.value = envInfo.night;
    gradePass.uniforms.uMotion.value = clamp01(st.speed / 10);
    gradePass.uniforms.uSaturation.value = lerp(1.08, 0.92, envInfo.night);
    gradePass.uniforms.uLift.value.set(
      lerp(-0.004, 0.0, envInfo.night),
      lerp(0.002, 0.012, envInfo.night),
      lerp(0.012, 0.03, envInfo.night)
    );
    gradePass.uniforms.uGain.value.set(
      lerp(0.99, 0.92, envInfo.night),
      lerp(0.99, 0.96, envInfo.night),
      lerp(0.96, 1.06, envInfo.night)
    );
    renderer.toneMappingExposure = lerp(0.96, 0.92, envInfo.night);

    // 打开遮罩时的开场镜头（慢慢绕到追尾位）
    if (st.mode === MODE.INTRO) {
      introCamera(dt);
    }

    // HUD
    hud.update(dt, st);
    updateMood(envInfo);

    // 渲染
    if (QUALITY[quality].post) composer.render();
    else renderer.render(scene, camera);

    // 自适应分辨率：连续低帧则降
    fpsAccum += dt;
    fpsFrames++;
    if (fpsAccum > 1.5) {
      const fps = fpsFrames / fpsAccum;
      fpsAccum = 0;
      fpsFrames = 0;
      if (fps < 45 && dynamicScale > 0.62) {
        dynamicScale = Math.max(0.62, dynamicScale - 0.12);
        applyDynamicScale();
      } else if (fps > 58 && dynamicScale < 1) {
        dynamicScale = Math.min(1, dynamicScale + 0.08);
        applyDynamicScale();
      }
      window.__fps = fps;
    }

    requestAnimationFrame(frame);
  }

  function applyDynamicScale() {
    const base = Math.min(window.devicePixelRatio, QUALITY[quality].pixelRatio);
    const pr = base * dynamicScale;
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
  }

  const lampLights = [];
  const lampGlassMats = [];
  function collectLampLights() {
    const lamps = cape.props.lampLights;
    for (const l of lamps) lampLights.push(l);
  }
  collectLampLights();
  function applyNightLights(night) {
    const level = ride.state.lampOverride ?? clamp01(smoothstep(0.22, 0.62, night));
    for (const l of lampLights) l.intensity = level * 26;
    // 车前灯
    bike.headLampLight.intensity = level * 12;
    bike.lampLensMat.emissiveIntensity = level * 2.5;
  }

  function introCamera(dt) {
    // 开场：从海面一侧缓缓升起，同时看向骑手。
    // 关键是往海面偏：站在陆侧只能看到路面和内陆，看不到海岬最漂亮的那面悬崖。
    const bikePos = bike.root.position;
    // sNearest 只返回弧长，要拿外法线还得再 at() 一次
    const sm = cape.track.at(cape.track.sNearest(bikePos));
    const angle = ride.state.timeline * 0.22;
    camDesired.set(
      bikePos.x + Math.cos(angle) * 9 + sm.outward.x * 5.5,
      bikePos.y + 3.6 + Math.sin(ride.state.timeline * 0.35) * 0.6,
      bikePos.z + Math.sin(angle) * 9 + sm.outward.z * 5.5
    );
    camera.position.lerp(camDesired, 1 - Math.exp(-1.6 * dt));
    camLook.set(bikePos.x, bikePos.y + 1.1, bikePos.z);
    camera.lookAt(camLook);
  }
  const camDesired = new THREE.Vector3();
  const camLook = new THREE.Vector3();

  function updateMood(info) {
    const h = weather.hour;
    let label = '';
    if (h >= 5 && h < 8) label = '晨光';
    else if (h >= 8 && h < 11) label = '上午';
    else if (h >= 11 && h < 14) label = '正午';
    else if (h >= 14 && h < 17) label = '午后';
    else if (h >= 17 && h < 19.5) label = '黄金时刻';
    else if (h >= 19.5 && h < 21) label = '暮色';
    else label = '夜航';
    const c = `#${info.horizonColor.getHexString()}`;
    hud.setMood(label, c);
  }

  /* ---------------- 窗口 ---------------- */
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  // 首次交互解锁音频
  const unlock = () => {
    audio.start();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // 调试钩子
  window.__pelican = { scene, renderer, camera, ride, weather, cape, pelican, bike, sky, sea, THREE };

  // 隐藏加载遮罩
  const loading = document.getElementById('loading');
  loading.classList.add('hidden');

  frame();

  return { ride, weather, hud };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}