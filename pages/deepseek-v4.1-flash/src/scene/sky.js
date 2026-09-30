/**
 * sky.js — 天穹：单球体内的分析式天空着色器
 * 内含：日/月/星空/云层/地平线霞光。色彩由 daycycle 传入，GPU 只做合成，便于统一调色。
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // 恒等于远平面，永不被遮挡
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3  uZenith, uHorizon, uGround, uSunColor, uMoonColor;
uniform vec3  uSunDir, uMoonDir;
uniform float uSunI, uMoonI, uStars, uTime, uCloud, uExposure;
uniform vec3  uCloudDark;

float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for(int i=0;i<5;i++){ s += a*vnoise(p); p *= 2.07; a *= 0.5; }
  return s;
}

void main(){
  vec3 d = normalize(vDir);
  float y = d.y;

  /* ---- 基础渐变：地平线 → 天顶 ---- */
  vec3 col = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.42));
  col = mix(col, uGround, smoothstep(0.03, -0.18, y));

  /* ---- 太阳：圆盘 + 双层辉光 + 晨昏光带 ---- */
  float sd = max(dot(d, uSunDir), 0.0);
  float disk = smoothstep(0.99950, 0.99985, sd);
  float glow = pow(sd, 380.0) * 0.85 + pow(sd, 26.0) * 0.30 + pow(sd, 5.0) * 0.10;
  float band = pow(sd, 3.5) * (1.0 - smoothstep(0.0, 0.35, abs(y)));
  col += uSunColor * (glow * 0.9 + band * 0.30 + disk * 3.4) * (0.25 + uSunI);

  /* ---- 月亮：圆盘 + 环形山 ---- */
  float md = max(dot(d, uMoonDir), 0.0);
  float crater = 0.80 + 0.20 * fbm(d.xz * 55.0 + 3.0);
  col += uMoonColor * (smoothstep(0.99960, 0.99988, md) * 2.8 * crater + pow(md, 24.0) * 0.05) * uMoonI;

  /* ---- 星空 ---- */
  if (uStars > 0.001 && y > -0.02) {
    vec2 sp = d.xz / max(y + 0.28, 0.06);
    vec2 g = floor(sp * 34.0);
    float star = step(0.9965, h21(g));
    float tw = 0.55 + 0.45 * sin(uTime * (1.2 + h21(g + 7.0) * 3.0) + h21(g) * 30.0);
    float mag = h21(g + 13.0);
    col += vec3(0.85, 0.90, 1.0) * star * tw * (0.35 + mag) * uStars * smoothstep(-0.02, 0.25, y);
  }

  /* ---- 云层：方向投影到高空平面做 fbm ---- */
  if (uCloud > 0.001 && y > 0.015) {
    vec2 cp = d.xz / (y + 0.10) * 0.55;
    cp += vec2(uTime * 0.0045, uTime * 0.0022);
    float n  = fbm(cp * 1.25);
    float n2 = fbm(cp * 3.10 + 11.0);
    float cov = smoothstep(0.52 - uCloud * 0.34, 0.86, n * 0.75 + n2 * 0.35);
    float lit = smoothstep(-0.15, 0.55, dot(d, uSunDir));
    vec3 cloudCol = mix(uCloudDark, vec3(1.0, 0.98, 0.95) * (0.40 + 0.52 * lit), 0.35 + 0.65 * lit);
    cloudCol += uSunColor * pow(sd, 6.0) * 0.22 * (0.25 + uSunI) * lit;
    col = mix(col, cloudCol, cov * smoothstep(0.015, 0.12, y) * (0.55 + 0.45 * uSunI));
  }

  gl_FragColor = vec4(max(col, 0.0) * uExposure, 1.0);
}`;

export class Sky extends THREE.Mesh {
  constructor(radius = 3000) {
    const uniforms = {
      uZenith: { value: new THREE.Color('#3f7ad6') },
      uHorizon: { value: new THREE.Color('#bcd8f6') },
      uGround: { value: new THREE.Color('#2b3348') },
      uSunColor: { value: new THREE.Color('#fff0c2') },
      uMoonColor: { value: new THREE.Color('#cfe0ff') },
      uCloudDark: { value: new THREE.Color('#5b6a8c') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunI: { value: 1 },
      uMoonI: { value: 0 },
      uStars: { value: 0 },
      uCloud: { value: 0.5 },
      uTime: { value: 0 },
      uExposure: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    super(new THREE.SphereGeometry(radius, 44, 26), mat);
    this.uniforms = uniforms;
    this.frustumCulled = false;
    this.renderOrder = -1000;
    this.name = 'sky';
  }

  update(time, L) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uSunDir.value.copy(L.sunDir);
    u.uMoonDir.value.copy(L.moonDir);
    u.uZenith.value.copy(L.zenith);
    u.uHorizon.value.copy(L.horizon);
    u.uGround.value.copy(L.groundHaze);
    u.uSunColor.value.copy(L.sunColor);
    u.uMoonColor.value.copy(L.moonColor);
    u.uSunI.value = L.sunIntensity;
    u.uMoonI.value = L.moonIntensity;
    u.uStars.value = L.starVisibility;
    u.uCloud.value = L.cloudiness;
    u.uCloudDark.value.copy(L.cloudDark);
    u.uExposure.value = L.skyExposure;
  }
}
