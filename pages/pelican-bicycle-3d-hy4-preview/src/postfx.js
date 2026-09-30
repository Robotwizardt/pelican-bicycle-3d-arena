/* =====================================================================
 * postfx.js — 自研后处理链（不依赖 three/examples）
 *
 *   HDR 场景 → 亮度提取(4 级降采样) → 高斯模糊(可分离, 双向) → 合成
 *            → 色调映射(ACES / AgX / Neutral / Filmic / Reinhard / Linear)
 *            → LUT(程序化 3D→2D 条带, 冷暖/饱和/对比/褪色/分离色调)
 *            → 色差 + 锐化 + 暗角 + 胶片颗粒 + 轻微桶形畸变
 *            → 输出到屏幕
 *
 * 所有 pass 都是全屏三角形，共用一个 ortho 相机。
 * ===================================================================*/
(function () {
  'use strict';
  var PB = window.PB, U = PB.U;

  var VERT = [
    'varying vec2 vUv;',
    'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
  ].join('\n');

  /* ---------- 全屏三角形 ---------- */
  function fsTriangle() {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    return geo;
  }

  function pass(material) {
    var mesh = new THREE.Mesh(fsTriangle(), material);
    mesh.frustumCulled = false;
    var scene = new THREE.Scene();
    scene.add(mesh);
    var cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return { scene: scene, cam: cam, mesh: mesh, mat: material };
  }

  /* ==================== 亮度提取 + 降采样 ==================== */
  var LUMA_FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D tDiffuse;',
    'uniform float uThreshold;',
    'uniform float uSoftKnee;',
    'void main(){',
    '  vec3 c = texture2D(tDiffuse, vUv).rgb;',
    '  float br = max(c.r, max(c.g, c.b));',
    '  float knee = uThreshold * uSoftKnee + 1e-5;',
    '  float soft = clamp(br - uThreshold + knee, 0.0, 2.0*knee);',
    '  soft = soft*soft/(4.0*knee+1e-5);',
    '  float contrib = max(soft, br - uThreshold) / max(br, 1e-5);',
    '  gl_FragColor = vec4(c * contrib, 1.0);',
    '}'
  ].join('\n');

  var DOWN_FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D tDiffuse;',
    'uniform vec2 uTexel;',
    'void main(){',
    '  vec3 s = vec3(0.0);',
    '  s += texture2D(tDiffuse, vUv + vec2(-1.0,-1.0)*uTexel).rgb;',
    '  s += texture2D(tDiffuse, vUv + vec2( 1.0,-1.0)*uTexel).rgb;',
    '  s += texture2D(tDiffuse, vUv + vec2(-1.0, 1.0)*uTexel).rgb;',
    '  s += texture2D(tDiffuse, vUv + vec2( 1.0, 1.0)*uTexel).rgb;',
    '  gl_FragColor = vec4(s * 0.25, 1.0);',
    '}'
  ].join('\n');

  /* ==================== 可分离高斯模糊 ==================== */
  var BLUR_FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D tDiffuse;',
    'uniform vec2 uDir;',       // 已含 texel size
    'void main(){',
    // 9-tap 线性采样高斯（等效 5 次双线性 = 高质量）
    '  vec3 s = vec3(0.0);',
    '  s += texture2D(tDiffuse, vUv - uDir*4.0).rgb * 0.0162;',
    '  s += texture2D(tDiffuse, vUv - uDir*3.0).rgb * 0.0540;',
    '  s += texture2D(tDiffuse, vUv - uDir*2.0).rgb * 0.1216;',
    '  s += texture2D(tDiffuse, vUv - uDir*1.0).rgb * 0.1946;',
    '  s += texture2D(tDiffuse, vUv              ).rgb * 0.2270;',
    '  s += texture2D(tDiffuse, vUv + uDir*1.0).rgb * 0.1946;',
    '  s += texture2D(tDiffuse, vUv + uDir*2.0).rgb * 0.1216;',
    '  s += texture2D(tDiffuse, vUv + uDir*3.0).rgb * 0.0540;',
    '  s += texture2D(tDiffuse, vUv + uDir*4.0).rgb * 0.0162;',
    '  gl_FragColor = vec4(s, 1.0);',
    '}'
  ].join('\n');

  var UP_FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D tDiffuse;',
    'uniform vec2 uTexel;',
    'uniform float uRadius;',
    'void main(){',
    '  vec3 s = vec3(0.0);',
    '  s += texture2D(tDiffuse, vUv + vec2(-1.0,-1.0)*uTexel*uRadius).rgb;',
    '  s += texture2D(tDiffuse, vUv + vec2( 1.0,-1.0)*uTexel*uRadius).rgb;',
    '  s += texture2D(tDiffuse, vUv + vec2(-1.0, 1.0)*uTexel*uRadius).rgb;',
    '  s += texture2D(tDiffuse, vUv + vec2( 1.0, 1.0)*uTexel*uRadius).rgb;',
    '  gl_FragColor = vec4(s * 0.25, 1.0);',
    '}'
  ].join('\n');

  /* ==================== 合成 + 色调映射 + 调色 + 胶片 ==================== */
  var COMPOSE_FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D tDiffuse;',
    'uniform sampler2D tBloom;',
    'uniform sampler2D tLUT;',
    'uniform float uBloom;',
    'uniform float uExposure;',
    'uniform float uContrast;',
    'uniform float uSaturation;',
    'uniform float uTemperature;',
    'uniform float uTint;',
    'uniform float uFade;',
    'uniform vec3  uLift;',
    'uniform vec3  uGain;',
    'uniform float uSplitTone;',
    'uniform vec3  uShadowTint;',
    'uniform vec3  uHighTint;',
    'uniform float uVignette;',
    'uniform float uVignetteSoft;',
    'uniform float uGrain;',
    'uniform float uGrainSize;',
    'uniform float uChroma;',
    'uniform float uSharpen;',
    'uniform float uDistort;',
    'uniform vec2  uResolution;',
    'uniform float uTime;',
    'uniform int   uToneMap;',     // 0 ACES 1 AgX 2 Neutral 3 Filmic 4 Reinhard 5 Linear
    'uniform float uFlash;',
    'uniform float uFadeOut;',
    '',
    // 线性 -> sRGB（等价于 THREE.ShaderChunk encodings_fragment / linearToOutputTexel）
    'vec3 LinearTosRGB(vec3 value){',
    '  vec3 lt = vec3(lessThanEqual(value.rgb, vec3(0.0031308)));',
    '  vec3 v1 = value * 12.92;',
    '  vec3 v2 = pow(value.rgb, vec3(0.41666)) * 1.055 - vec3(0.055);',
    '  return mix(v2, v1, lt);',
    '}',
    '',
    'vec3 acesFilm(vec3 x){',
    '  const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;',
    '  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);',
    '}',
    // AgX 近似（基于 Blender AgX 的多项式拟合；保留其"高光不偏色"特性）
    'vec3 agx(vec3 x){',
    '  x = max(x, 0.0);',
    '  vec3 x2 = x*x; vec3 x3 = x2*x;',
    '  vec3 num = x3*(0.0245786) + x2*(0.000090537) + x*(0.983729);',
    '  vec3 den = x3*(0.4329510) + x2*(0.2380810) + x*(0.327445) + 0.115634;',
    '  return pow(clamp(num/den, 0.0, 1.0), vec3(2.2));',
    '}',
    // Khronos PBR Neutral
    'vec3 neutral(vec3 x){',
    '  const float startCompression = 0.8 - 0.04;',
    '  const float desaturation = 0.15;',
    '  x *= 1.0;',
    '  float peak = max(x.r, max(x.g, x.b));',
    '  if (peak < startCompression) return x;',
    '  float d = 1.0 - startCompression;',
    '  float newPeak = 1.0 - d*d/(peak + d - startCompression);',
    '  x *= newPeak / peak;',
    '  float g = 1.0 - 1.0/(desaturation*(peak-newPeak)+1.0);',
    '  return mix(x, vec3(newPeak), g);',
    '}',
    'vec3 filmic(vec3 x){',
    '  x = max(vec3(0.0), x - 0.004);',
    '  return (x*(6.2*x+0.5))/(x*(6.2*x+1.7)+0.06);',
    '}',
    'vec3 reinhard(vec3 x){ return x/(1.0+x); }',
    '',
    'vec3 tonemap(vec3 c){',
    '  if(uToneMap==0) return acesFilm(c);',
    '  if(uToneMap==1) return agx(c);',
    '  if(uToneMap==2) return neutral(c);',
    '  if(uToneMap==3) return filmic(c);',
    '  if(uToneMap==4) return reinhard(c);',
    '  return clamp(c, 0.0, 1.0);',
    '}',
    '',
    // 3D LUT 采样（条带布局：宽度 = size*size，高度 = size）
    'vec3 sampleLUT(sampler2D lut, vec3 c, float size){',
    '  c = clamp(c, 0.0, 1.0);',
    '  float sliceSize = 1.0 / size;',
    '  float slicePx = sliceSize * (1.0/ (size*size)) * size;', // 半个纹素偏移
    '  float z = c.b * (size - 1.0);',
    '  float z0 = floor(z), z1 = min(z0 + 1.0, size - 1.0);',
    '  float fz = z - z0;',
    '  float x0 = (z0 + c.r * (size - 1.0) / size) / size;',
    '  vec2 uv0 = vec2(  (z0 * size + c.r * (size - 1.0) + 0.5) / (size*size), (c.g * (size-1.0) + 0.5)/size );',
    '  vec2 uv1 = vec2(  (z1 * size + c.r * (size - 1.0) + 0.5) / (size*size), (c.g * (size-1.0) + 0.5)/size );',
    '  vec3 a = texture2D(lut, uv0).rgb;',
    '  vec3 b = texture2D(lut, uv1).rgb;',
    '  return mix(a, b, fz);',
    '}',
    '',
    'void main(){',
    '  vec2 uv = vUv;',
    '  vec2 cc = uv - 0.5;',
    // 桶形畸变（轻微）
    '  float r2 = dot(cc, cc);',
    '  uv = 0.5 + cc * (1.0 + uDistort * r2);',
    '  if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){ gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }',
    '',
    '  vec3 col;',
    '  if(uChroma > 0.0001){',
    '    vec2 dir = cc * uChroma * (0.35 + r2);',
    '    col.r = texture2D(tDiffuse, uv + dir).r;',
    '    col.g = texture2D(tDiffuse, uv).g;',
    '    col.b = texture2D(tDiffuse, uv - dir).b;',
    '  } else {',
    '    col = texture2D(tDiffuse, uv).rgb;',
    '  }',
    '',
    // 锐化（unsharp mask，用 4 邻域）
    '  if(uSharpen > 0.0001){',
    '    vec2 tx = 1.0/uResolution;',
    '    vec3 blur = (texture2D(tDiffuse, uv+vec2(tx.x,0.0)).rgb + texture2D(tDiffuse, uv-vec2(tx.x,0.0)).rgb',
    '               + texture2D(tDiffuse, uv+vec2(0.0,tx.y)).rgb + texture2D(tDiffuse, uv-vec2(0.0,tx.y)).rgb) * 0.25;',
    '    col = col + (col - blur) * uSharpen;',
    '  }',
    '',
    // Bloom 叠加（在色调映射之前，保持 HDR 感）
    '  vec3 bloom = texture2D(tBloom, uv).rgb;',
    '  col += bloom * uBloom;',
    '',
    // 曝光 + 白平衡（温度/色调）
    '  col *= uExposure;',
    '  float t = uTemperature;',
    '  col.r *= (1.0 + t * 0.35);',
    '  col.b *= (1.0 - t * 0.35);',
    '  col.g *= (1.0 + uTint * 0.25);',
    '  col.rb *= vec2(1.0 - uTint*0.18, 1.0 + uTint*0.18);',
    '',
    // 色调映射
    '  col = tonemap(col);',
    '',
    // 对比度（以 0.5 为 pivot 的 S 曲线）
    '  col = clamp((col - 0.5) * (1.0 + uContrast) + 0.5, 0.0, 1.0);',
    // 饱和度
    '  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));',
    '  col = mix(vec3(lum), col, uSaturation);',
    // Lift / Gamma / Gain
    '  col = col * uGain + uLift * (1.0 - col);',
    // 分离色调
    '  float sh = 1.0 - smoothstep(0.0, 0.55, lum);',
    '  float hi = smoothstep(0.45, 1.0, lum);',
    '  col = mix(col, col * uShadowTint, sh * uSplitTone);',
    '  col = mix(col, col * uHighTint, hi * uSplitTone);',
    // LUT
    '  col = sampleLUT(tLUT, col, 32.0);',
    // 褪色（提黑）
    '  col = mix(col, vec3(0.06,0.07,0.09), uFade * (1.0 - smoothstep(0.0,0.35,lum)));',
    '',
    // 暗角
    '  float vig = smoothstep(0.95, uVignetteSoft, length(cc) * 1.42);',
    '  col *= mix(1.0, vig, uVignette);',
    '',
    // 胶片颗粒（随时间抖动）
    '  if(uGrain > 0.0001){',
    '    vec2 guv = uv * uResolution / max(uGrainSize, 1.0);',
    '    float n = fract(sin(dot(guv + uTime * 91.7, vec2(12.9898, 78.233))) * 43758.5453);',
    '    float g = (n - 0.5) * uGrain;',
    '    col += g * (0.35 + 0.65 * (1.0 - lum));',
    '  }',
    '',
    '  col += uFlash;',
    '  col *= uFadeOut;',
    '  col = clamp(col, 0.0, 1.0);',
    // 场景 RT 是线性 HDR（NoColorSpace），到最后必须自己转 sRGB：
    // 少了这一步，写出去的是线性值，画面会整体偏暗偏紫偏绿。
    '  col = LinearTosRGB(col);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ==================== 程序化 3D LUT（32³，条带 1024×32） ==================== */
  function buildLUT(preset) {
    var SIZE = 32;
    var c = document.createElement('canvas');
    c.width = SIZE * SIZE; c.height = SIZE;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(SIZE * SIZE, SIZE);
    var d = img.data;
    var p = preset || {};
    var tealShadow = p.tealShadow == null ? 0.10 : p.tealShadow;
    var warmHigh = p.warmHigh == null ? 0.12 : p.warmHigh;
    var sCurve = p.sCurve == null ? 0.10 : p.sCurve;
    var satHi = p.satHi == null ? 1.06 : p.satHi;
    var satLo = p.satLo == null ? 0.94 : p.satLo;
    var greenCut = p.greenCut == null ? 0.03 : p.greenCut;

    for (var b = 0; b < SIZE; b++) {
      for (var g = 0; g < SIZE; g++) {
        for (var r = 0; r < SIZE; r++) {
          var R = r / (SIZE - 1), G = g / (SIZE - 1), B = b / (SIZE - 1);
          // S 曲线（中间调加对比）
          function sc(x) { return x + (x - 0.5) * sCurve * (1 - Math.abs(x - 0.5) * 2); }
          R = U.clamp(sc(R), 0, 1); G = U.clamp(sc(G), 0, 1); B = U.clamp(sc(B), 0, 1);
          var lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
          // 阴影偏青、高光偏暖
          var sh = 1 - U.smoothstep(0, 0.6, lum);
          var hi = U.smoothstep(0.4, 1, lum);
          R += hi * warmHigh * 0.06 - sh * tealShadow * 0.05;
          G += hi * warmHigh * 0.02 + sh * tealShadow * 0.01;
          B += sh * tealShadow * 0.07 - hi * warmHigh * 0.03;
          // 高光/阴影分别调饱和
          var s = U.lerp(satLo, satHi, lum);
          R = lum + (R - lum) * s; G = lum + (G - lum) * s; B = lum + (B - lum) * s;
          // 略微压绿（肤色/羽毛更干净）
          G -= greenCut * (G - (R + B) * 0.5) * 0.5;
          var x = b * SIZE + r;
          var y = g;
          var i = (y * (SIZE * SIZE) + x) * 4;
          d[i] = U.clamp(R, 0, 1) * 255;
          d[i + 1] = U.clamp(G, 0, 1) * 255;
          d[i + 2] = U.clamp(B, 0, 1) * 255;
          d[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    var t = new THREE.CanvasTexture(c);
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.NoColorSpace;
    // CanvasTexture 默认 flipY=true，上传时会把图像上下翻转，
    // 于是 UV.y≈0 取到的是 canvas 的最后一行；条带 LUT 的纵向正是 G 轴，
    // 结果绿色索引被取反 —— 中性灰会被查成 (207,166,207) 的洋红。
    // 关掉 flipY，让 UV.y 与 canvas 行号一一对应。
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  }

  /* =================================================================== */
  function PostFX(renderer, opts) {
    opts = opts || {};
    this.renderer = renderer;
    this.enabled = true;
    var pr = renderer.getPixelRatio();

    // ---- HDR 场景目标 ----
    var rtOpts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      samples: opts.samples != null ? opts.samples : 4
    };
    this.rtScene = new THREE.WebGLRenderTarget(2, 2, rtOpts);

    // ---- Bloom 金字塔（4 级） ----
    this.levels = 4;
    this.bloomRT = [];
    for (var i = 0; i < this.levels; i++) {
      this.bloomRT.push(new THREE.WebGLRenderTarget(2, 2, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        type: THREE.HalfFloatType, colorSpace: THREE.NoColorSpace,
        depthBuffer: false
      }));
    }
    // 模糊用的乒乓
    this.blurRT = [];
    for (var j = 0; j < this.levels; j++) {
      this.blurRT.push(new THREE.WebGLRenderTarget(2, 2, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        type: THREE.HalfFloatType, colorSpace: THREE.NoColorSpace,
        depthBuffer: false
      }));
    }

    // ---- Passes ----
    this.pLuma = pass(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: 1.05 }, uSoftKnee: { value: 0.6 } },
      vertexShader: VERT, fragmentShader: LUMA_FRAG, depthTest: false, depthWrite: false
    }));
    this.pDown = pass(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: VERT, fragmentShader: DOWN_FRAG, depthTest: false, depthWrite: false
    }));
    this.pBlur = pass(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false
    }));
    this.pUp = pass(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } },
      vertexShader: VERT, fragmentShader: UP_FRAG, depthTest: false, depthWrite: false
    }));

    this.lut = buildLUT(opts.lut);
    this.u = {
      tDiffuse: { value: null },
      tBloom: { value: null },
      tLUT: { value: this.lut },
      uBloom: { value: 0.55 },
      uExposure: { value: 1.0 },
      uContrast: { value: 0.10 },
      uSaturation: { value: 1.06 },
      uTemperature: { value: 0.05 },
      uTint: { value: 0.0 },
      uFade: { value: 0.06 },
      uLift: { value: new THREE.Vector3(0.005, 0.006, 0.010) },
      uGain: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
      uSplitTone: { value: 0.35 },
      uShadowTint: { value: new THREE.Vector3(0.88, 0.96, 1.10) },
      uHighTint: { value: new THREE.Vector3(1.08, 1.02, 0.92) },
      uVignette: { value: 0.42 },
      uVignetteSoft: { value: 0.42 },
      uGrain: { value: 0.045 },
      uGrainSize: { value: 1.6 },
      uChroma: { value: 0.0022 },
      uSharpen: { value: 0.18 },
      uDistort: { value: 0.018 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uToneMap: { value: 0 },
      uFlash: { value: 0 },
      uFadeOut: { value: 1 }
    };
    this.pCompose = pass(new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: VERT, fragmentShader: COMPOSE_FRAG,
      depthTest: false, depthWrite: false
    }));

    this._size = new THREE.Vector2(2, 2);
  }

  PostFX.prototype.setSize = function (w, h, pixelRatio) {
    var W = Math.max(2, Math.floor(w * pixelRatio));
    var H = Math.max(2, Math.floor(h * pixelRatio));
    this._size.set(W, H);
    this.rtScene.setSize(W, H);
    for (var i = 0; i < this.levels; i++) {
      var ww = Math.max(2, W >> (i + 1));
      var hh = Math.max(2, H >> (i + 1));
      this.bloomRT[i].setSize(ww, hh);
      this.blurRT[i].setSize(ww, hh);
    }
    this.u.uResolution.value.set(W, H);
  };

  /** 渲染一帧：先渲染 scene 到 HDR RT，再走后处理 */
  PostFX.prototype.render = function (scene, camera, t, opts) {
    var r = this.renderer;
    opts = opts || {};
    this.u.uTime.value = t;
    if (opts.flash != null) this.u.uFlash.value = opts.flash;
    if (opts.fadeOut != null) this.u.uFadeOut.value = opts.fadeOut;

    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);
    // 场景渲染统计快照：后面的后处理 pass 会继续累加计数，直接读会误判
    this.lastSceneCalls = r.info.render.calls;
    this.lastSceneTris = r.info.render.triangles;

    if (!this.enabled) {
      r.setRenderTarget(null);
      // 注意：这里不能沿用 rtScene —— rtScene 是线性 HDR 且带 MSAA，
      // 直接拿它当 tDiffuse 再渲染回默认帧缓冲会既偏色又丢内容。
      // 降级路径改为直接把场景渲染到默认帧缓冲（three 自己会做 sRGB 转换）。
      r.render(scene, camera);
      this.lastSceneCalls = r.info.render.calls;
      this.lastSceneTris = r.info.render.triangles;
      return;
      /* eslint-disable-next-line no-unreachable */
      r.render(this._copyScene ? this._copyScene : (this._copyScene = (function () {
        var p = pass(new THREE.ShaderMaterial({
          uniforms: { tDiffuse: { value: null } },
          vertexShader: VERT,
          fragmentShader: 'precision highp float;varying vec2 vUv;uniform sampler2D tDiffuse;' +
            'vec3 LinearTosRGB(vec3 v){ vec3 lt=vec3(lessThanEqual(v.rgb,vec3(0.0031308)));' +
            ' vec3 v1=v*12.92; vec3 v2=pow(v.rgb,vec3(0.41666))*1.055-vec3(0.055); return mix(v2,v1,lt); }' +
            'void main(){ gl_FragColor=vec4(LinearTosRGB(texture2D(tDiffuse,vUv).rgb),1.0); }',
          depthTest: false, depthWrite: false
        }));
        return p.scene;
      })()), camera && this._copyCam ? this._copyCam : (this._copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)));
      return;
    }

    // ---- Bloom ----
    var th = opts.bloomThreshold != null ? opts.bloomThreshold : 1.05;
    this.pLuma.mat.uniforms.tDiffuse.value = this.rtScene.texture;
    this.pLuma.mat.uniforms.uThreshold.value = th;
    r.setRenderTarget(this.bloomRT[0]);
    r.render(this.pLuma.scene, this.pLuma.cam);

    for (var i = 1; i < this.levels; i++) {
      var src = this.bloomRT[i - 1];
      this.pDown.mat.uniforms.tDiffuse.value = src.texture;
      this.pDown.mat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      r.setRenderTarget(this.bloomRT[i]);
      r.render(this.pDown.scene, this.pDown.cam);
    }

    // 逐级模糊（H 然后 V）
    for (var lv = 0; lv < this.levels; lv++) {
      var rt = this.bloomRT[lv], tmp = this.blurRT[lv];
      var tx = 1 / rt.width, ty = 1 / rt.height;
      var radius = opts.bloomRadius || 1.0;

      this.pBlur.mat.uniforms.tDiffuse.value = rt.texture;
      this.pBlur.mat.uniforms.uDir.value.set(tx * radius, 0);
      r.setRenderTarget(tmp);
      r.render(this.pBlur.scene, this.pBlur.cam);

      this.pBlur.mat.uniforms.tDiffuse.value = tmp.texture;
      this.pBlur.mat.uniforms.uDir.value.set(0, ty * radius);
      r.setRenderTarget(rt);
      r.render(this.pBlur.scene, this.pBlur.cam);
    }

    // 逐级上采样叠加
    for (var lv2 = this.levels - 1; lv2 > 0; lv2--) {
      var srcRT = this.bloomRT[lv2], dstRT = this.bloomRT[lv2 - 1];
      var prevAuto = r.autoClear;
      // 用加法混合把高一级的结果叠回低一级
      var up = this.pUp;
      up.mat.uniforms.tDiffuse.value = srcRT.texture;
      up.mat.uniforms.uTexel.value.set(1 / dstRT.width, 1 / dstRT.height);
      up.mat.uniforms.uRadius.value = 1.0;
      up.mat.blending = THREE.AdditiveBlending;
      up.mat.transparent = true;
      r.setRenderTarget(dstRT);
      r.autoClear = false;
      r.render(up.scene, up.cam);
      r.autoClear = prevAuto;
      up.mat.blending = THREE.NoBlending;
      up.mat.transparent = false;
    }

    // ---- 合成 ----
    this.u.tDiffuse.value = this.rtScene.texture;
    this.u.tBloom.value = this.bloomRT[0].texture;
    r.setRenderTarget(null);
    r.render(this.pCompose.scene, this.pCompose.cam);
  };

  PostFX.prototype.setToneMap = function (idx) { this.u.uToneMap.value = idx; };
  PostFX.prototype.setLUTPreset = function (preset) {
    var old = this.lut;
    this.lut = buildLUT(preset);
    this.u.tLUT.value = this.lut;
    if (old) old.dispose();
  };

  PB.PostFX = PostFX;
  PB.buildLUT = buildLUT;
})();
