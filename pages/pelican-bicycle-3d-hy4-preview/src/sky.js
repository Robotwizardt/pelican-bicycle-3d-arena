/* =====================================================================
 * sky.js — 解析式天空（Preetham 大气散射）+ 夜间星空 + 月亮 + 暮光余晖
 *
 * 大气散射部分改写自 three.js examples/jsm/objects/Sky.js (MIT License,
 * Copyright 2010-2023 Three.js Authors)，理论来自 Preetham et al.
 * "A Practical Analytic Model for Daylight"。
 * 本文件新增：夜间项、程序化星场 / 银河、月光散射、暮光余晖、银河尘埃，
 * 并把结果用 CubeCamera 烘焙成 HalfFloat cubemap，经 PMREM 供 PBR 使用。
 *
 * 输出线性 HDR（不做色调映射），由渲染器的 ACES/AgX 统一映射。
 * ===================================================================*/
(function () {
  'use strict';
  var PB = window.PB, U = PB.U;

  var VERT = [
    'varying vec3 vWorldDir;',
    'void main(){',
    '  vec4 wp = modelMatrix * vec4( position, 1.0 );',
    '  vWorldDir = wp.xyz - cameraPosition;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '  gl_Position.z = gl_Position.w;',   // 永远贴在远平面
    '}'
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    'varying vec3 vWorldDir;',
    'uniform vec3 uSunDir;',
    'uniform vec3 uMoonDir;',
    'uniform float uTurbidity;',
    'uniform float uRayleigh;',
    'uniform float uMie;',
    'uniform float uMieG;',
    'uniform float uMoonGain;',
    'uniform float uNightGain;',
    'uniform float uStarGain;',
    'uniform float uCalibration;',
    '',
    'const float e = 2.718281828459045235360287471352662497757247093;',
    'const float pi = 3.141592653589793238462643383279502884197169;',
    'const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );',
    'const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );',
    'const float cutoffAngle = 1.6110731556870734;',
    'const float steepness = 1.5;',
    'const float EE = 1000.0;',
    'const vec3 up = vec3( 0.0, 1.0, 0.0 );',
    'const float rayleighZenithLength = 8.4E3;',
    'const float mieZenithLength = 1.25E3;',
    'const float THREE_OVER_SIXTEENPI = 0.05968310365946075;',
    'const float ONE_OVER_FOURPI = 0.07957747154594767;',
    '',
    'float sunIntensity( float zenithAngleCos ){',
    '  zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );',
    '  return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );',
    '}',
    'vec3 totalMie( float T ){',
    '  float c = ( 0.2 * T ) * 10E-18;',
    '  return 0.434 * c * MieConst;',
    '}',
    'float rayleighPhase( float cosTheta ){ return THREE_OVER_SIXTEENPI * ( 1.0 + pow( cosTheta, 2.0 ) ); }',
    'float hgPhase( float cosTheta, float g ){',
    '  float g2 = pow( g, 2.0 );',
    '  return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 ) );',
    '}',
    '',
    '/* ---- 单光源散射：sun 与 moon 复用同一套公式 ---- */',
    'vec3 scatter( vec3 direction, vec3 lightDir, float lightE, float turbidity, float rayleighCoeff, float mieCoeff, float mieG, float sunfadeIn ){',
    '  vec3 vSunDirection = normalize( lightDir );',
    '  vec3 vBetaR = totalRayleigh * rayleighCoeff;',
    '  vec3 vBetaM = totalMie( turbidity ) * mieCoeff;',
    '  float zenithAngle = acos( max( 0.0, dot( up, direction ) ) );',
    '  float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );',
    '  float sR = rayleighZenithLength * inverse;',
    '  float sM = mieZenithLength * inverse;',
    '  vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );',
    '  float cosTheta = dot( direction, vSunDirection );',
    '  vec3 betaRTheta = vBetaR * rayleighPhase( cosTheta * 0.5 + 0.5 );',
    '  vec3 betaMTheta = vBetaM * hgPhase( cosTheta, mieG );',
    '  vec3 Lin = pow( lightE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );',
    '  Lin *= mix( vec3( 1.0 ), pow( lightE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 0.5 ) ),',
    '        clamp( pow( 1.0 - dot( up, vSunDirection ), 5.0 ), 0.0, 1.0 ) );',
    '  vec3 L0 = vec3( 0.1 ) * Fex;',
    '  vec3 texColor = ( Lin + L0 ) * 0.04;',
    '  return pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * sunfadeIn ) ) ) );',
    '}',
    '',
    '/* ---- 程序化星场（3 层细胞噪声）+ 银河带 ---- */',
    'float hash13( vec3 p ){',
    '  p = fract( p * 0.3183099 + vec3( 0.1, 0.2, 0.3 ) );',
    '  p *= 17.0;',
    '  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );',
    '}',
    'float starLayer( vec3 dir, float scale, float density, float seed ){',
    '  vec3 p = dir * scale;',
    '  vec3 id = floor( p );',
    '  vec3 f = p - id - 0.5;',
    '  float h = hash13( id + seed );',
    '  if ( h < density ) return 0.0;',
    '  vec3 off = vec3( hash13( id + 1.7 + seed ), hash13( id + 3.3 + seed ), hash13( id + 5.9 + seed ) ) - 0.5;',
    '  float d = length( f - off * 0.66 );',
    '  float s = smoothstep( 0.19, 0.0, d );',
    '  return s * ( 0.35 + hash13( id + 9.1 + seed ) * 1.15 );',
    '}',
    'float milkyway( vec3 dir ){',
    '  // 一条倾斜的银河带：法向量与 dir 的点积决定带的中心',
    '  vec3 n = normalize( vec3( 0.32, 0.86, -0.39 ) );',
    '  float b = 1.0 - abs( dot( dir, n ) );',
    '  float band = pow( clamp( b, 0.0, 1.0 ), 12.0 );',
    '  float cl = hash13( floor( dir * 26.0 ) ) * 0.6 + hash13( floor( dir * 11.0 ) ) * 0.4;',
    '  return band * ( 0.35 + cl * 0.65 );',
    '}',
    '',
    'void main(){',
    '  vec3 dir = normalize( vWorldDir );',
    '',
    '  /* ---------- 白天 / 黄昏：太阳散射 ---------- */',
    '  float sunfade = 1.0 - clamp( 1.0 - exp( uSunDir.y / 450000.0 * 1000.0 ), 0.0, 1.0 );',
    '  float rayleighCoefficient = uRayleigh - ( 1.0 * ( 1.0 - sunfade ) );',
    '  float sunE = sunIntensity( dot( uSunDir, up ) );',
    '  vec3 day = scatter( dir, uSunDir, sunE, uTurbidity, rayleighCoefficient, uMie, uMieG, sunfade );',
    '',
    '  /* ---------- 夜晚：月亮散射 ---------- */',
    '  float moonE = sunIntensity( dot( uMoonDir, up ) ) * uMoonGain;',
    '  vec3 night = scatter( dir, uMoonDir, moonE, uTurbidity * 0.7, rayleighCoefficient * 0.85, uMie * 0.6, 0.72, sunfade );',
    '  night *= vec3( 0.72, 0.82, 1.15 );',
    '',
    '  float nightAmt = smoothstep( 0.03, -0.13, uSunDir.y );',
    '  vec3 col = day * ( 1.0 - nightAmt * 0.92 ) + night * uNightGain;',
    '',
    '  /* ---------- 星星 + 银河 ---------- */',
    '  float horizon = smoothstep( -0.02, 0.16, dir.y );',
    '  float st = starLayer( dir, 150.0, 0.978, 0.0 )',
    '             + starLayer( dir, 300.0, 0.986, 13.0 ) * 0.6',
    '             + starLayer( dir, 560.0, 0.991, 29.0 ) * 0.35;',
    '  float mw = milkyway( dir ) * 0.055;',
    '  col += ( st * vec3( 0.95, 0.97, 1.0 ) + mw * vec3( 0.62, 0.70, 0.95 ) ) * uStarGain * nightAmt * horizon;',
    '',
    '  /* ---------- 月盘 + 月华 ---------- */',
    '  float md = dot( dir, normalize( uMoonDir ) );',
    '  float disc = smoothstep( 0.99972, 0.99988, md );',
    '  float halo = pow( max( md, 0.0 ), 900.0 ) * 0.55 + pow( max( md, 0.0 ), 60.0 ) * 0.05;',
    '  float moonUp = smoothstep( -0.05, 0.05, uMoonDir.y );',
    '  col += ( disc * 2.4 + halo ) * vec3( 0.98, 0.99, 1.0 ) * moonUp * nightAmt;',
    '',
    '  /* ---------- 暮光余晖：太阳落山后地平线上的暖光 ---------- */',
    '  float below = max( 0.0, -uSunDir.y );',
    '  vec3 flatDir = normalize( vec3( dir.x, 0.0, dir.z ) + vec3( 1e-5 ) );',
    '  vec3 flatSun = normalize( vec3( uSunDir.x, 0.0, uSunDir.z ) + vec3( 1e-5 ) );',
    '  float az = dot( flatDir, flatSun );',
    '  float glow = pow( max( az, 0.0 ), 5.0 ) * exp( -below * 6.5 ) * exp( -max( dir.y, 0.0 ) * 3.4 );',
    '  col += vec3( 1.0, 0.42, 0.16 ) * glow * 0.60;',
    '  // 日间靠近太阳的大气辉光',
    '  float sd = max( dot( dir, normalize( uSunDir ) ), 0.0 );',
    '  col += vec3( 1.0, 0.72, 0.42 ) * pow( sd, 22.0 ) * 0.10 * ( 1.0 - nightAmt );',
    '',
    '  /* ---------- 大气底色 / 地平线雾化 ---------- */',
    '  col += vec3( 0.0, 0.00025, 0.0006 );',
    '  col = max( col, vec3( 0.0 ) );',
    // Preetham 模型输出的是未归一化的物理辐亮度：实测天顶线性值可达 1.3~2.1。
    // 直接喂给色调映射会把整片天空压成纯白（实测 254,255,255）。
    // 这里做一次曝光标定，让晴朗天顶落在 ~0.5 线性，既留住高光层次又不溢出。
    '  col *= uCalibration;',
    '  gl_FragColor = vec4( col, 1.0 );',
    '}'
  ].join('\n');

  function Sky(scene, renderer, opts) {
    opts = opts || {};
    this.scene = scene;
    this.renderer = renderer;
    this.size = opts.size || 256;

    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0.3, 0.25, 1).normalize() },
      uMoonDir: { value: new THREE.Vector3(-0.4, 0.6, -0.8).normalize() },
      uTurbidity: { value: 2.4 },
      uRayleigh: { value: 1.15 },
      uMie: { value: 0.006 },
      uMieG: { value: 0.82 },
      uMoonGain: { value: 0.0032 },
      uNightGain: { value: 1.25 },
      uStarGain: { value: 0.85 },
      uCalibration: { value: 0.30 }
    };

    var geo = new THREE.SphereGeometry(50, 48, 32);
    var mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      fog: false
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.skyScene = new THREE.Scene();
    this.skyScene.add(this.mesh);

    var rt = new THREE.WebGLCubeRenderTarget(this.size, {
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    });
    rt.texture.type = THREE.HalfFloatType;
    rt.texture.colorSpace = THREE.NoColorSpace;
    rt.texture.mapping = THREE.CubeReflectionMapping;
    this.rt = rt;

    this.cubeCam = new THREE.CubeCamera(0.5, 400, rt);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileCubemapShader();
    this.envRT = null;

    this._dirty = true;
    this._key = '';
    scene.background = rt.texture;
  }

  Sky.prototype.setSun = function (dir) {
    this.uniforms.uSunDir.value.copy(dir).normalize();
    this._dirty = true;
  };
  Sky.prototype.setMoon = function (dir) {
    this.uniforms.uMoonDir.value.copy(dir).normalize();
    this._dirty = true;
  };

  /** 只在参数变化超过阈值时重新烘焙 —— 一次烘焙含 6 面渲染 + PMREM */
  Sky.prototype.bakeIfNeeded = function (force) {
    var u = this.uniforms;
    var s = u.uSunDir.value, m = u.uMoonDir.value;
    var key = [Math.round(s.x * 400), Math.round(s.y * 400), Math.round(s.z * 400),
      Math.round(m.x * 400), Math.round(m.y * 400), Math.round(m.z * 400),
      Math.round(u.uTurbidity.value * 50),
      Math.round(u.uCalibration.value * 200)].join(',');
    if (!force && !this._dirty && key === this._key) return false;
    this._key = key; this._dirty = false;
    this.bake();
    return true;
  };

  Sky.prototype.bake = function () {
    var r = this.renderer;
    var prevBg = this.scene.background;
    var prevEnv = this.scene.environment;
    var prevTM = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;   // 烘焙必须拿线性 HDR

    this.scene.background = null;
    this.scene.environment = null;
    this.cubeCam.update(r, this.skyScene);

    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromCubemap(this.rt.texture);

    this.scene.background = this.rt.texture;
    this.scene.environment = this.envRT.texture;
    this.scene.backgroundIntensity = 1.0;
    this.scene.environmentIntensity = 1.0;
    r.toneMapping = prevTM;
  };

  Sky.prototype.dispose = function () {
    this.rt.dispose();
    if (this.envRT) this.envRT.dispose();
    this.pmrem.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  };

  PB.Sky = Sky;
})();
