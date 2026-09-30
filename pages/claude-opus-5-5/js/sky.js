// 昼夜系统：物理天空、太阳/月光、半球光、雾、按需重建 PMREM 环境贴图
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { smoothstep } from './helpers.js';

export function createSkySystem(renderer, scene) {
  const sky = new Sky(); sky.scale.setScalar(900); scene.add(sky);
  const u = sky.material.uniforms;
  u.turbidity.value = 5.5; u.rayleigh.value = 1.8; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.82;

  // 专供环境贴图的天空场景（共享材质）
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(sky.geometry, sky.material); envSky.scale.setScalar(900); envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null, lastEnvSun = new THREE.Vector3(9, 9, 9), envTimer = 0;

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const S = 9; Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 80 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x4a5a30, 0.8); scene.add(hemi);
  scene.fog = new THREE.Fog(0xcfe2f3, 60, 280);

  const sunDir = new THREE.Vector3();
  const cWarm = new THREE.Color(0xffa860), cDay = new THREE.Color(0xfff4e0), cMoon = new THREE.Color(0x8fa8ff);
  const fogDay = new THREE.Color(0xcfe2f3), fogDusk = new THREE.Color(0xf29a62), fogNight = new THREE.Color(0x0b1224);
  const state = { night: 0, elevation: 0, sunDir };

  /** hour: 0..24；focus: 阴影跟随的焦点 */
  function update(hour, focus, dt) {
    const dayPhase = (hour - 6) / 12 * Math.PI;              // 6 点日出、18 点日落
    const elev = Math.sin(dayPhase) * THREE.MathUtils.degToRad(62);
    const azim = THREE.MathUtils.degToRad(100 + (hour / 24) * 200);
    sunDir.setFromSphericalCoords(1, Math.PI / 2 - elev, azim);
    u.sunPosition.value.copy(sunDir);

    const elevDeg = THREE.MathUtils.radToDeg(elev);
    const night = 1 - smoothstep(-8, 3, elevDeg);
    const dusk = (1 - smoothstep(4, 22, elevDeg)) * (1 - night);
    state.night = night; state.elevation = elevDeg; state.dusk = dusk;

    // 白天用太阳，夜里切为月光（方向取反且抬高）
    const lightDir = night > 0.5 ? new THREE.Vector3(-sunDir.x, Math.abs(sunDir.y) + 0.5, -sunDir.z).normalize() : sunDir.clone();
    if (lightDir.y < 0.05) lightDir.y = 0.05;
    sun.position.copy(focus).addScaledVector(lightDir, 40);
    sun.target.position.copy(focus);
    const col = cDay.clone().lerp(cWarm, dusk);
    sun.color.copy(night > 0.5 ? cMoon : col);
    sun.intensity = night > 0.5 ? 1.5 * night : 3.2 * (1 - night) * (0.35 + 0.65 * smoothstep(-2, 15, elevDeg));
    hemi.intensity = THREE.MathUtils.lerp(0.85, 0.6, night);
    hemi.color.setHSL(0.6, 0.55, THREE.MathUtils.lerp(0.75, 0.45, night));
    scene.fog.color.copy(fogDay).lerp(fogDusk, dusk).lerp(fogNight, night);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(0.55, 0.6, night);
    u.rayleigh.value = THREE.MathUtils.lerp(1.8, 3.4, dusk);
    u.mieCoefficient.value = THREE.MathUtils.lerp(0.005, 0.012, dusk);
    u.turbidity.value = THREE.MathUtils.lerp(5.5, 9, dusk);

    // 环境贴图：太阳明显移动时才重建（节流）
    envTimer -= dt;
    if (envTimer <= 0 && sunDir.distanceTo(lastEnvSun) > 0.02) {
      envTimer = 0.4; lastEnvSun.copy(sunDir);
      const rt = pmrem.fromScene(envScene, 0, 0.1, 1000);
      if (envRT) envRT.dispose(); envRT = rt;
      scene.environment = rt.texture;
      scene.environmentIntensity = THREE.MathUtils.lerp(1, 0.15, night);
    }
    return state;
  }
  return { sky, sun, hemi, update, state };
}
