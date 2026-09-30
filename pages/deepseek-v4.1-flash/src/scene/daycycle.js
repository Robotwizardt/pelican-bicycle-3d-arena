/**
 * daycycle.js — 昼夜模型
 * 输入：一天中的分钟数（0..1439）；输出：整套光照/色彩/环境参数。
 * 太阳沿黄道倾斜 18° 升落，月亮取太阳反方向并做相位偏移。
 */
import * as THREE from 'three';
import { clamp, lerp, smoothstep, sampleKeys, TAU } from '../lib/util.js';

const KEYS = {
  zenith: [
    [0.00, '#050a1c'], [0.10, '#08122c'], [0.20, '#1b3566'], [0.30, '#3f7ad6'],
    [0.50, '#2f6ad8'], [0.70, '#1e458f'], [0.80, '#26305e'], [0.90, '#0a1024'], [1.00, '#050a1c'],
  ],
  horizon: [
    [0.00, '#0d1430'], [0.10, '#1b2447'], [0.20, '#6a5a8e'], [0.26, '#e08a5a'],
    [0.32, '#9fc3ee'], [0.50, '#cfe2f7'], [0.70, '#b7cbe8'], [0.78, '#d98a63'],
    [0.84, '#5b4a72'], [0.92, '#141c3c'], [1.00, '#0d1430'],
  ],
  sunColor: [
    [0.00, '#ffffff'], [0.22, '#ff8a4a'], [0.30, '#ffc98a'], [0.50, '#fff4dc'],
    [0.72, '#ffd39a'], [0.80, '#ff7a3c'], [1.00, '#ffffff'],
  ],
  sunI: [
    [0.00, 0.02], [0.20, 0.06], [0.26, 0.35], [0.34, 0.95], [0.50, 1.12],
    [0.70, 0.85], [0.80, 0.22], [0.86, 0.05], [1.00, 0.02],
  ],
  ambI: [
    [0.00, 0.09], [0.22, 0.16], [0.32, 0.42], [0.50, 0.55], [0.72, 0.40],
    [0.82, 0.18], [0.92, 0.10], [1.00, 0.09],
  ],
  exposure: [
    [0.00, 1.55], [0.22, 1.35], [0.34, 1.05], [0.50, 1.00], [0.72, 1.12],
    [0.82, 1.42], [1.00, 1.55],
  ],
  cloudy: [
    [0.00, 0.55], [0.30, 0.62], [0.50, 0.24], [0.72, 0.28], [0.86, 0.50], [1.00, 0.55],
  ],
  fog: [
    [0.00, 0.028], [0.26, 0.055], [0.40, 0.022], [0.50, 0.018], [0.78, 0.030],
    [0.86, 0.050], [1.00, 0.028],
  ],
  temp: [
    [0.00, 12], [0.20, 11], [0.29, 15], [0.50, 26], [0.70, 23], [0.80, 18], [1.00, 12],
  ],
};

const PHASES = [
  [0.00, '深夜'], [0.19, '黎明'], [0.26, '日出'], [0.31, '清晨'],
  [0.45, '上午'], [0.52, '正午'], [0.62, '午后'], [0.72, '傍晚'],
  [0.79, '日落'], [0.84, '黄昏'], [0.90, '入夜'], [1.01, '深夜'],
];

export function createLighting() {
  return {
    minutes: 480,
    sunDir: new THREE.Vector3(),
    moonDir: new THREE.Vector3(),
    zenith: new THREE.Color(), horizon: new THREE.Color(), groundHaze: new THREE.Color(),
    sunColor: new THREE.Color(), moonColor: new THREE.Color(),
    cloudDark: new THREE.Color(),
    sunIntensity: 1, moonIntensity: 0, ambientIntensity: 0.4,
    exposure: 1, skyExposure: 1, fogDensity: 0.02, fogColor: new THREE.Color(),
    starVisibility: 0, cloudiness: 0.5, phase: '上午', temperature: 20,
    lampMix: 0, twilight: 0, isNight: false,
    // 画质/风格全局系数（供后期与灯光使用）
    bloom: 0.35,
  };
}

const _c1 = new THREE.Color(), _c2 = new THREE.Color();

export function updateLighting(L, minutes) {
  const t = ((minutes % 1440) + 1440) % 1440 / 1440;
  L.minutes = ((minutes % 1440) + 1440) % 1440;

  // 太阳：方位角 5:40 起 18:40 落，仰角随正弦；黄道倾斜让正午不垂直
  const dayT = smoothstep(0.23, 0.77, t);
  const sunAngle = (t - 0.25) * TAU;           // 6:00 日出
  const elev = Math.sin(sunAngle * 1.0) * 0.98;
  const azim = -0.55 + Math.cos(sunAngle) * 0.0;
  L.sunDir.set(
    Math.cos(sunAngle) * 0.86 + azim * 0.2,
    elev,
    Math.sin(sunAngle * 0.62) * 0.34 + 0.18
  ).normalize();

  // 月亮：近似反相，抬高一点避免与太阳重叠
  L.moonDir.copy(L.sunDir).multiplyScalar(-1);
  L.moonDir.x = -L.moonDir.x * 0.85 + 0.25;
  L.moonDir.y = Math.abs(L.moonDir.y) * 0.9 + 0.15;
  L.moonDir.z = -L.moonDir.z;
  L.moonDir.normalize();

  const sunUp = clamp(L.sunDir.y, -0.3, 1);
  const sunI = sampleKeys(KEYS.sunI, t) * (sunUp > 0 ? 1 : 0.15);
  L.sunIntensity = sunI * (0.6 + 0.5 * clamp(sunUp, 0, 1));
  L.moonIntensity = clamp(0.55 * smoothstep(0.06, -0.10, sunUp) * (0.4 + 0.6 * clamp(L.moonDir.y, 0, 1)), 0, 0.7);
  L.ambientIntensity = sampleKeys(KEYS.ambI, t);
  L.exposure = sampleKeys(KEYS.exposure, t);
  // 天空 shader 输出的是线性辐亮度：曝光只在 composite 里施加一次。
  // （若这里乘上 exposure，天空会被曝光平方，且 PMREM IBL 也会被预曝光 → 画面洗白。）
  L.skyExposure = 1;
  L.starVisibility = clamp(smoothstep(0.06, -0.06, sunUp), 0, 1) * 0.95;
  L.cloudiness = sampleKeys(KEYS.cloudy, t) * 0.9;
  L.temperature = sampleKeys(KEYS.temp, t);
  L.twilight = clamp(smoothstep(0.22, 0.0, Math.abs(sunUp)), 0, 1);

  sampleColor(L.zenith, KEYS.zenith, t);
  sampleColor(L.horizon, KEYS.horizon, t);
  sampleColor(L.sunColor, KEYS.sunColor, t);
  L.moonColor.setRGB(0.72, 0.80, 1.0);
  L.groundHaze.copy(L.horizon).lerp(L.zenith, 0.35).multiplyScalar(0.55);
  L.cloudDark.copy(L.horizon).lerp(_c1.set('#20263c'), 0.55 - L.twilight * 0.25);

  L.fogDensity = sampleKeys(KEYS.fog, t);
  _c2.copy(L.horizon).lerp(L.groundHaze, 0.35);
  L.fogColor.copy(_c2).multiplyScalar(0.92);

  L.lampMix = clamp(smoothstep(0.13, -0.02, sunUp) + L.twilight * 0.35, 0, 1);
  L.isNight = sunUp < 0;
  L.phase = sampleKeys(PHASES, t);
  L.t = t;
  L.bloom = lerp(0.30, 0.62, clamp(smoothstep(0.10, -0.05, sunUp), 0, 1)) + L.twilight * 0.15;
  return L;
}

function sampleColor(target, keys, t) {
  const hex = sampleHex(keys, t);
  target.set(hex);
  return target;
}
function sampleHex(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (t <= keys[i + 1][0]) {
      const [t0, c0] = keys[i], [t1, c1] = keys[i + 1];
      const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return mixHex(c0, c1, k * k * (3 - 2 * k));
    }
  }
  return keys[keys.length - 1][1];
}
function mixHex(a, b, k) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return `#${ca.lerp(cb, k).getHexString()}`;
}

/** 供 HUD 用的文字时钟（未填 0 补位由 util.formatClock 处理） */
export function phaseOf(L) { return L.phase; }
