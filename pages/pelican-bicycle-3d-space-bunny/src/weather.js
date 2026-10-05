/**
 * weather.js —— 天气与时间
 *
 * 时间轴（hour 0..24）驱动太阳方向、颜色、夜色强度、星星、云、风、雾、路灯与灯塔灯。
 * 天气（晴/多云/雾/雨/雪）改变云的密度、雾密度、雨雪粒子数量与速度、太阳强度。
 * 同时提供 getMoodColor(hour, weather) 供 HUD 与天空同步变色。
 */
import * as THREE from 'three';
import { clamp01, lerp, smoothstep, TAU } from './util.js';

export const WEATHERS = ['晴', '多云', '雾', '雨', '雪'];

export function createWeather({ scene, skyUniforms, seaUniforms, sun, hemi, dirLight, timeline }) {
  const fog = scene.fog;
  const state = {
    hour: 17.4,
    weather: 0, // 晴
    wind: 0.5,
  };

  /* ---------------- 雨 ---------------- */
  const RAIN_COUNT = 2400;
  const rainGeo = new THREE.BufferGeometry();
  const rp = new Float32Array(RAIN_COUNT * 3);
  const rs = new Float32Array(RAIN_COUNT);
  const rng = (() => {
    let s = 99;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();
  for (let i = 0; i < RAIN_COUNT; i++) {
    rp[i * 3] = (rng() - 0.5) * 90;
    rp[i * 3 + 1] = rng() * 40;
    rp[i * 3 + 2] = (rng() - 0.5) * 90;
    rs[i] = 0.6 + rng() * 0.8;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const rainMat = new THREE.PointsMaterial({
    color: new THREE.Color('#bcd4e6'),
    size: 0.06,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const rain = new THREE.Points(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.name = 'rain';
  scene.add(rain);

  /* ---------------- 雪 ---------------- */
  const SNOW_COUNT = 1600;
  const snowGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(SNOW_COUNT * 3);
  const snowSeed = new Float32Array(SNOW_COUNT);
  for (let i = 0; i < SNOW_COUNT; i++) {
    sp[i * 3] = (rng() - 0.5) * 80;
    sp[i * 3 + 1] = rng() * 32;
    sp[i * 3 + 2] = (rng() - 0.5) * 80;
    snowSeed[i] = rng() * TAU;
  }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const snowMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.11,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const snow = new THREE.Points(snowGeo, snowMat);
  snow.frustumCulled = false;
  snow.name = 'snow';
  scene.add(snow);

  /* 雨滴打在地面的涟漪（用一圈圈淡出的环，性能友好） */
  const rippleGeo = new THREE.RingGeometry(0.06, 0.5, 12);
  rippleGeo.rotateX(-Math.PI / 2);
  const rippleMat = new THREE.MeshBasicMaterial({
    color: 0xbcd4e6,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const ripples = new THREE.InstancedMesh(rippleGeo, rippleMat, 60);
  ripples.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ripples.frustumCulled = false;
  const rippleData = Array.from({ length: 60 }, () => ({
    life: rng(),
    x: (rng() - 0.5) * 30,
    z: (rng() - 0.5) * 30,
  }));
  scene.add(ripples);

  /* ---------------- 太阳/灯光的目标色（按时刻 + 天气混合） ---------------- */
  const SUN_COLORS = {
    // 高度角 → 颜色
    dawn: new THREE.Color('#ff9a52'),
    golden: new THREE.Color('#ffc06a'),
    day: new THREE.Color('#fff3dc'),
    dusk: new THREE.Color('#ff8248'),
    night: new THREE.Color('#8fa8d8'),
  };
  const tmpC = new THREE.Color();

  function sunColorFor(elev) {
    if (elev < -0.12) return SUN_COLORS.night;
    if (elev < 0.05) {
      tmpC.copy(SUN_COLORS.night).lerp(SUN_COLORS.dusk, clamp01((elev + 0.12) / 0.17));
      return tmpC;
    }
    if (elev < 0.22) {
      tmpC.copy(SUN_COLORS.dusk).lerp(SUN_COLORS.golden, clamp01((elev - 0.05) / 0.17));
      return tmpC;
    }
    tmpC.copy(SUN_COLORS.golden).lerp(SUN_COLORS.day, clamp01((elev - 0.22) / 0.35));
    return tmpC;
  }

  const FOG_COLORS = {
    clear: new THREE.Color('#b6c9d8'),
    cloudy: new THREE.Color('#a8b4c0'),
    fog: new THREE.Color('#c3cdd4'),
    rain: new THREE.Color('#8fa1ad'),
    snow: new THREE.Color('#ccd6de'),
  };

  /** 天空调色板：给天空 shader 的地平线色 & 雾色 & 环境光用 */
  function horizonColor(hour, night) {
    const base = new THREE.Color('#c6d6e4');
    if (hour < 6.2 || hour > 18.6) return base.multiplyScalar(lerp(0.25, 0.5, night));
    // 日出/日落时地平线偏暖
    const golden = 1 - smoothstep(6.2, 8.2, hour) + (1 - smoothstep(16.6, 18.6, hour));
    return base.lerp(new THREE.Color('#f0b078'), clamp01(golden) * 0.75);
  }

  let lampLevel = 0;

  function update(dt, elapsed, ctx = {}) {
    const { hour, weather } = state;
    const sunDir = timeline.sunDirFromHour(hour);
    const elev = sunDir.y;
    const night = timeline.nightness(hour);

    /* --- 太阳方向 --- */
    sunDir.normalize();
    sun.position.copy(sunDir).multiplyScalar(300);

    /* --- 光照强度与颜色 --- */
    const sunColor = sunColorFor(elev);
    const cloudFactor = [1.0, 0.55, 0.28, 0.22, 0.3][weather];
    const dayLight = clamp01(smoothstep(-0.12, 0.28, elev));
    const intensity = dayLight * lerp(1.85, 0.5, night) * lerp(1, 0.45, 1 - cloudFactor);
    sun.color.copy(sunColor);
    sun.intensity = intensity;
    if (dirLight) {
      dirLight.color.copy(sunColor);
      dirLight.intensity = intensity;
    }

    /* --- 环境光：天空色 ↔ 海面反射色 --- */
    const skyAmb = new THREE.Color('#7fa2cc').lerp(new THREE.Color('#1b2740'), night);
    const groundAmb = new THREE.Color('#59544a').lerp(new THREE.Color('#0d1119'), night);
    hemi.color.copy(skyAmb);
    hemi.groundColor.copy(groundAmb);
  // 白天：路面靠环境光也该看得见细节，否则会烧成一片死白
    hemi.intensity = lerp(0.3, 0.52, dayLight) * lerp(1, 1.25, cloudFactor * 0.5);

    /* --- 天空 shader --- */
    skyUniforms.uSunDir.value.copy(sunDir);
    skyUniforms.uSunIntensity.value = clamp01(smoothstep(-0.06, 0.1, elev)) * lerp(1, 0.25, 1 - cloudFactor);
    skyUniforms.uStars.value = clamp01(night * 1.1 - 0.1);
    skyUniforms.uMoon.value = night * 0.8;
    skyUniforms.uCloud.value = [0.42, 0.78, 0.5, 0.9, 0.7][weather];
    skyUniforms.uRayleigh.value = [1.15, 0.95, 0.5, 0.5, 0.6][weather];
    skyUniforms.uTurbidity.value = [2.4, 3.4, 6.0, 5.0, 4.0][weather];

    /* --- 雾 --- */
    const baseFog = [0.0055, 0.008, 0.026, 0.016, 0.018][weather];
    fog.density = baseFog * lerp(1, 1.5, night * 0.5);
    const fc = FOG_COLORS[['clear', 'cloudy', 'fog', 'rain', 'snow'][weather]];
    fog.color.copy(fc).lerp(new THREE.Color('#1b2436'), night * 0.7);

    /* --- 太阳位置指示（在天空 shader 里已经有了，这里同步海面反射色） --- */
    skyUniforms.uHorizonTint && skyUniforms.uHorizonTint.value.copy(fog.color);

    /* --- 雨 --- */
    const raining = weather === 3;
    rainMat.opacity = lerp(rainMat.opacity, raining ? 0.75 : 0, 1 - Math.exp(-dt * 2));
    if (rainMat.opacity > 0.01) {
      const pos = rainGeo.attributes.position.array;
      const fallSpeed = lerp(28, 46, state.wind);
      for (let i = 0; i < RAIN_COUNT; i++) {
        pos[i * 3 + 1] -= fallSpeed * rs[i] * dt;
        pos[i * 3] += state.wind * 3 * dt;
        if (pos[i * 3 + 1] < -2) {
          pos[i * 3 + 1] = 38 + Math.random() * 6;
        }
      }
      rainGeo.attributes.position.needsUpdate = true;
      // 涟漪
      rippleMat.opacity = 0.22 * rainMat.opacity;
      const m = new THREE.Matrix4();
      for (let i = 0; i < rippleData.length; i++) {
        const r = rippleData[i];
        r.life -= dt * 1.6;
        if (r.life <= 0) {
          r.life = 1;
          r.x = (Math.random() - 0.5) * 26;
          r.z = (Math.random() - 0.5) * 26;
        }
        const s = (1 - r.life) * 0.9 + 0.05;
        m.compose(new THREE.Vector3(r.x, 0.03, r.z), new THREE.Quaternion(), new THREE.Vector3(s, 1, s));
        ripples.setMatrixAt(i, m);
      }
      ripples.instanceMatrix.needsUpdate = true;
    } else {
      rippleMat.opacity = 0;
    }

    /* --- 雪 --- */
    const snowing = weather === 4;
    snowMat.opacity = lerp(snowMat.opacity, snowing ? 0.9 : 0, 1 - Math.exp(-dt * 1.5));
    if (snowMat.opacity > 0.01) {
      const pos = snowGeo.attributes.position.array;
      for (let i = 0; i < SNOW_COUNT; i++) {
        pos[i * 3 + 1] -= (1.2 + snowSeed[i] * 0.6) * dt;
        pos[i * 3] += Math.sin(elapsed * 0.6 + snowSeed[i]) * 0.6 * dt + state.wind * 1.2 * dt;
        pos[i * 3 + 2] += Math.cos(elapsed * 0.5 + snowSeed[i]) * 0.5 * dt;
        if (pos[i * 3 + 1] < 0) pos[i * 3 + 1] = 30 + Math.random() * 4;
      }
      snowGeo.attributes.position.needsUpdate = true;
    }

    /* --- 海面着色器同步 --- */
    if (seaUniforms) {
      seaUniforms.uSunDir.value.copy(sunDir);
      seaUniforms.uSunColor.value.copy(sunColor);
      seaUniforms.uFogColor.value.copy(fog.color);
      seaUniforms.uFogDensity.value = fog.density;
      seaUniforms.uHorizonTint.value.copy(fog.color);
      seaUniforms.uChoppy.value = lerp(1, 2.0, state.wind);
      seaUniforms.uFoam.value = weather === 3 || weather === 4 ? 0.5 : 1;
    }

    /* --- 路灯/车灯（黄昏后渐亮） --- */
    lampLevel = clamp01(smoothstep(0.25, 0.65, night)) * lerp(1, 0.25, 1 - cloudFactor * 0.5);
    return { night, sunDir, sunColor, dayLight, lampLevel, horizonColor: fog.color.clone() };
  }

  return {
    state,
    update,
    get hour() {
      return state.hour;
    },
    set hour(v) {
      state.hour = ((v % 24) + 24) % 24;
    },
    get weather() {
      return state.weather;
    },
    set weather(v) {
      state.weather = clamp01(v / 4) * 4;
    },
    get wind() {
      return state.wind;
    },
    set wind(v) {
      state.wind = clamp01(v);
    },
    WEATHERS,
  };
}