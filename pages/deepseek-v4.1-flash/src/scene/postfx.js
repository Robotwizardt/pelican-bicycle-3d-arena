/**
 * postfx.js — 自研 HDR 后期管线（不使用 three 的 EffectComposer）
 *
 *   scene ─► sceneRT(HalfFloat, 线性HDR)
 *              ├─► bright pass ─► (H ─► V) ×3 级、逐级加宽、加性累加（半分辨率）
 *              └─► composite: 速度径向模糊 + 径向色散 + ACES + 曝光 + 泛光
 *                             + 对比/饱和 + 暗角 + 胶片颗粒 + 抖动 + sRGB 编码
 *
 * 前置约定：renderer.toneMapping = NoToneMapping，
 *           renderer.outputColorSpace = LinearSRGBColorSpace（sRGB 编码由本模块完成），
 *           renderer.autoClear = false（本模块自行管理清屏）。
 */
import * as THREE from 'three';

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform float uThreshold, uKnee, uClamp, uWeight;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(min(c * w, vec3(uClamp)) * uWeight, 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uDir;
uniform float uWeight;
void main(){
  vec3 s = texture2D(tSrc, vUv).rgb * 0.227027;
  s += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.316216;
  s += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.070270;
  gl_FragColor = vec4(s * uWeight, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene, tBloom;
uniform float uExposure, uBloom, uChroma, uVignette, uGrain, uTime, uSpeedBlur, uSat, uContrast;
uniform vec2  uResolution;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main(){
  vec2 uv = vUv;
  vec2 cen = uv - 0.5;
  float r2 = dot(cen, cen);

  /* --- 速度径向模糊（4 抽样，越靠画面边缘越强） --- */
  vec3 scene = texture2D(tScene, uv).rgb;
  if (uSpeedBlur > 0.001) {
    vec3 acc = scene;
    for (int i = 1; i <= 4; i++) {
      float f = float(i) * 0.5;
      acc += texture2D(tScene, uv + cen * uSpeedBlur * f * 0.042).rgb;
    }
    scene = mix(scene, acc * 0.2, clamp(uSpeedBlur * 1.3, 0.0, 0.55) * smoothstep(0.02, 0.28, r2));
  }

  /* --- 径向色散 --- */
  if (uChroma > 0.0001) {
    vec2 off = cen * uChroma * (0.6 + r2 * 2.4);
    scene.r = texture2D(tScene, uv + off).r;
    scene.b = texture2D(tScene, uv - off).b;
  }

  vec3 col = scene + texture2D(tBloom, uv).rgb * uBloom;
  col *= uExposure;
  col = aces(col);
  col = mix(col, col * col * (3.0 - 2.0 * col), uContrast * 0.35);   // S 曲线对比

  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, uSat);                                    // 饱和

  col *= 1.0 - uVignette * smoothstep(0.05, 0.75, r2);                // 暗角

  float g = hash12(uv * uResolution + fract(uTime) * 137.0) - 0.5;
  col += g * uGrain * (1.15 - lum * 0.75);                            // 胶片颗粒
  col += (hash12(uv * uResolution + 7.0) - 0.5) / 255.0;              // 抖动

  gl_FragColor = vec4(toSRGB(col), 1.0);
}`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.width = 0; this.height = 0;

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const common = { depthTest: false, depthWrite: false };
    this.mBright = new THREE.ShaderMaterial({
      ...common, vertexShader: QUAD_VERT, fragmentShader: BRIGHT_FRAG,
      uniforms: { tSrc: { value: null }, uThreshold: { value: 1.0 }, uKnee: { value: 0.6 }, uClamp: { value: 14 }, uWeight: { value: 1 } },
    });
    this.mBlur = new THREE.ShaderMaterial({
      ...common, vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG,
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
    });
    this.mComp = new THREE.ShaderMaterial({
      ...common, vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tScene: { value: null }, tBloom: { value: null },
        uExposure: { value: 1 }, uBloom: { value: 0.4 }, uChroma: { value: 0.0022 },
        uVignette: { value: 0.34 }, uGrain: { value: 0.03 }, uTime: { value: 0 },
        uSpeedBlur: { value: 0 }, uSat: { value: 1.06 }, uContrast: { value: 0.35 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
    });
    this.setSize(1, 1);
  }

  _makeRT(w, h, depth) {
    const rt = new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: !!depth,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
  }

  setSize(width, height) {
    const w = Math.max(4, Math.round(width));
    const h = Math.max(4, Math.round(height));
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    ['rtScene', 'rtA', 'rtB', 'rtBlur'].forEach((k) => this[k] && this[k].dispose());
    const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
    this.rtScene = this._makeRT(w, h, true);
    this.rtA = this._makeRT(hw, hh, false);
    this.rtB = this._makeRT(hw, hh, false);
    this.rtBlur = this._makeRT(hw, hh, false);
    this.mComp.uniforms.uResolution.value.set(w, h);
  }

  /** 一次全屏绘制。clear=null 表示不清屏（用于加性累加） */
  _blit(mat, target, clear = true) {
    const r = this.renderer;
    this.quad.material = mat;
    r.setRenderTarget(target);
    if (clear) r.clear(true, false, false);
    r.render(this.quadScene, this.quadCam);
  }

  render(scene, camera, p = {}) {
    const r = this.renderer;
    const prevTone = r.toneMapping;
    const prevAuto = r.autoClear;
    r.toneMapping = THREE.NoToneMapping;
    r.autoClear = false;

    /* 1) 场景 → HDR RT */
    r.setRenderTarget(this.rtScene);
    r.clear(true, true, false);
    r.render(scene, camera);

    const bloomOn = (p.bloom ?? 0.4) > 0.002;
    if (bloomOn) {
      /* 2) 亮度提取 */
      this.mBright.uniforms.tSrc.value = this.rtScene.texture;
      this.mBright.uniforms.uThreshold.value = p.bloomThreshold ?? 0.95;
      this.mBright.uniforms.uClamp.value = p.bloomClamp ?? 14;
      this._blit(this.mBright, this.rtA);

      /* 3) 三级高斯：H → 乒乓 RT，V 加性累加到 rtBlur（先清黑）
         注意：源贴图与目标贴图绝不能是同一张（WebGL 反馈回路 → 整帧作废） */
      r.setRenderTarget(this.rtBlur);
      r.clear(true, false, false);
      const bw = Math.max(2, this.rtA.width), bh = Math.max(2, this.rtA.height);
      let src = this.rtA.texture;                 // 首级源 = 亮度图
      const radii = [1.0, 2.6, 5.6];
      for (let i = 0; i < radii.length; i++) {
        const rad = radii[i];
        const hTarget = (src === this.rtA.texture) ? this.rtB : this.rtA;
        this.mBlur.uniforms.tSrc.value = src;
        this.mBlur.uniforms.uWeight.value = 1;
        this.mBlur.uniforms.uDir.value.set(rad / bw, 0);
        this._blit(this.mBlur, hTarget, true);
        this.mBlur.uniforms.tSrc.value = hTarget.texture;
        this.mBlur.uniforms.uWeight.value = 1 / radii.length;
        this.mBlur.uniforms.uDir.value.set(0, rad / bh);
        this.mBlur.blending = THREE.AdditiveBlending;
        this._blit(this.mBlur, this.rtBlur, false);
        this.mBlur.blending = THREE.NormalBlending;
        src = hTarget.texture;                    // 下一级从本级 H 结果继续扩散
      }
      this.mComp.uniforms.tBloom.value = this.rtBlur.texture;
    }

    /* 4) 合成 → 屏幕 */
    const u = this.mComp.uniforms;
    u.tScene.value = this.rtScene.texture;
    if (!bloomOn) u.tBloom.value = this.rtBlur.texture;
    u.uExposure.value = p.exposure ?? 1;
    u.uBloom.value = bloomOn ? (p.bloom ?? 0.4) : 0;
    u.uChroma.value = p.chroma ?? 0.0022;
    u.uVignette.value = p.vignette ?? 0.34;
    u.uGrain.value = p.grain ?? 0.03;
    u.uTime.value = p.time ?? 0;
    u.uSpeedBlur.value = p.speedBlur ?? 0;
    u.uSat.value = p.saturation ?? 1.06;
    u.uContrast.value = p.contrast ?? 0.35;
    r.setRenderTarget(null);
    this._blit(this.mComp, null, true);

    r.toneMapping = prevTone;
    r.autoClear = prevAuto;
  }

  dispose() {
    ['rtScene', 'rtA', 'rtB', 'rtBlur'].forEach((k) => this[k] && this[k].dispose());
    this.quad.geometry.dispose();
    this.mBright.dispose(); this.mBlur.dispose(); this.mComp.dispose();
  }
}
