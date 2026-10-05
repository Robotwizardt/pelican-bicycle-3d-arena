/**
 * scene/world.js —— 天空、大气、海面
 *
 * 天空用的是自研的天顶着色器（Preetham 式散射 + 太阳圆盘 + 米氏光晕 + 幂函数云层），
 * 全部由 uniforms 驱动，因此「时间轴」滑块能把太阳从晨光推到暮色、推到黑夜，
 * 星空也只是一层按同一方向向量点亮的粒子云。
 */
import * as THREE from 'three';
import { clamp01, TAU } from '../util.js';

/* ------------------------------------------------------------------ 天空 */

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize( position );
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // 永远贴在远平面
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vDir;

  uniform vec3  uSunDir;
  uniform float uTime;
  uniform float uTurbidity;     // 大气浑浊度
  uniform float uRayleigh;      // 瑞利散射强度
  uniform float uMie;           // 米氏系数
  uniform float uMieG;          // 米氏方向性
  uniform float uSunIntensity;
  uniform float uCloud;         // 云量
  uniform float uCloudHeight;
  uniform float uStars;         // 星空强度 0..1
  uniform float uMoon;          // 月亮强度
  uniform vec3  uMoonDir;

  const float PI = 3.141592653589793;

  float hash21( vec2 p ) {
    p = fract( p * vec2( 123.34, 456.21 ) );
    p += dot( p, p + 45.32 );
    return fract( p.x * p.y );
  }

  float valueNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    float a = hash21( i );
    float b = hash21( i + vec2( 1.0, 0.0 ) );
    float c = hash21( i + vec2( 0.0, 1.0 ) );
    float d = hash21( i + vec2( 1.0, 1.0 ) );
    return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
  }

  float fbm( vec2 p ) {
    float s = 0.0, a = 0.5;
    for ( int i = 0; i < 5; i ++ ) {
      s += valueNoise( p ) * a;
      p = p * 2.02 + vec2( 17.3, 9.1 );
      a *= 0.5;
    }
    return s;
  }

  // 日出/日落时贴着地平线的暖色梯度（太阳越低越红）
  vec3 sunGlow( vec3 dir, vec3 sunDir, float lowSun ) {
    float cosT = dot( dir, sunDir );
    float halo  = pow( max( cosT, 0.0 ), mix( 26.0, 5.0, lowSun ) );
    float wide  = pow( max( cosT, 0.0 ), mix( 2.0, 1.2, lowSun ) );
    vec3 warm   = vec3( 1.0, 0.42, 0.16 );
    vec3 golden = vec3( 1.0, 0.74, 0.42 );
    vec3 col = warm * wide * 1.1 + golden * halo * 1.9;
    // 地平线附近的集中辉光
    float horiz = exp( -max( dir.y, 0.0 ) * 9.0 );
    col += warm * horiz * wide * 0.85 * ( 0.35 + lowSun );
    return col;
  }

  void main() {
    vec3 dir = normalize( vDir );
    float sunY = uSunDir.y;
    float lowSun = clamp( 1.0 - clamp( sunY / 0.42, 0.0, 1.0 ), 0.0, 1.0 );
    float cosT = dot( dir, uSunDir );

    // --- 大气散射：天顶蓝 -> 地平线雾白，再叠太阳染色
    float up = clamp( dir.y, 0.0, 1.0 );
    float rayleighMix = pow( 1.0 - up, 3.6 );
    vec3 zenithCool = vec3( 0.055, 0.145, 0.42 );
    vec3 zenithDay  = vec3( 0.13, 0.31, 0.72 );
    vec3 zenith     = mix( zenithCool, zenithDay, clamp( uSunDir.y * 2.6, 0.0, 1.0 ) );
    vec3 horizon    = vec3( 0.62, 0.72, 0.88 );
    vec3 col = mix( zenith, horizon, rayleighMix );

    // 散射主瓣：太阳附近的蓝向白化
    col += vec3( 0.55, 0.72, 1.0 ) * pow( max( cosT, 0.0 ), 6.0 ) * uRayleigh * 0.55;
    // 米氏散射：太阳周围的白亮光晕
    float mie = pow( max( cosT, 0.0 ), uMieG * 220.0 );
    col += vec3( 1.0, 0.93, 0.82 ) * mie * uMie * 3.4;
    col += sunGlow( dir, uSunDir, lowSun ) * ( 0.35 + lowSun * 1.5 );

    // --- 星空（太阳落到地平线以下才逐渐点亮）
    if ( uStars > 0.001 && dir.y > -0.06 ) {
      vec2 sp = dir.xz / max( abs( dir.y ) + 0.18, 0.06 );
      float cell = 0.5;
      vec2 g = floor( sp * cell );
      float r = hash21( g );
      if ( r > 0.972 ) {
        vec2 c = ( g + vec2( hash21( g + 3.1 ), hash21( g + 7.7 ) ) ) / cell;
        float d = length( sp - c );
        float tw = 0.55 + 0.45 * sin( uTime * ( 1.4 + r * 6.0 ) + r * 40.0 );
        float star = smoothstep( 0.10, 0.0, d ) * tw;
        col += vec3( 0.85, 0.9, 1.0 ) * star * uStars * ( 0.5 + r * 1.6 );
      }
    }

    // --- 太阳圆盘
    float sunDisc = smoothstep( 0.99955, 0.99988, cosT );
    col += vec3( 1.0, 0.97, 0.90 ) * sunDisc * uSunIntensity * 6.0;

    // --- 月亮：圆盘 + 月晕
    float moonCos = dot( dir, normalize( uMoonDir ) );
    float moonDisc = smoothstep( 0.99965, 0.99992, moonCos );
    float moonGlow = pow( max( moonCos, 0.0 ), 900.0 );
    col += vec3( 0.82, 0.86, 1.0 ) * ( moonDisc * 1.5 + moonGlow * 0.7 ) * uMoon;

    // --- 云层：射线穿过云盘（平面投影），fbm 密度 + 高度带来的透视衰减
    if ( dir.y > 0.005 && uCloud > 0.001 ) {
      vec2 uv = dir.xz / dir.y * uCloudHeight;
      uv = uv * 0.00042;
      vec2 drift = vec2( uTime * 0.0026, uTime * 0.0011 );
      float base = fbm( uv + drift );
      float det  = fbm( uv * 2.7 - drift * 1.7 );
      float dens = base * 0.72 + det * 0.28;
      float cover = mix( 0.74, 0.34, uCloud );
      float d = smoothstep( cover, cover + 0.24, dens );
      // 云被太阳从背后点亮
      float lit = 0.45 + 0.55 * pow( max( cosT * 0.5 + 0.5, 0.0 ), 3.0 );
      vec3 cloudLit = mix( vec3( 0.62, 0.66, 0.76 ), vec3( 1.0, 0.94, 0.86 ), lit );
      cloudLit = mix( cloudLit * 0.55, cloudLit * 1.25, clamp( uSunDir.y * 2.2 + 0.15, 0.0, 1.0 ) );
      // 地平线附近的云淡出，避免硬边
      d *= smoothstep( 0.0, 0.16, dir.y );
      col = mix( col, cloudLit, d * 0.94 );
    }

    // --- 地平线以下（海面之下的方向）压暗，水面自己会补颜色
    col = mix( col, col * 0.42, smoothstep( 0.0, -0.10, dir.y ) );

    gl_FragColor = vec4( col, 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSky() {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0.4, 0.35, -0.85).normalize() },
    uMoonDir: { value: new THREE.Vector3(-0.45, 0.5, 0.72).normalize() },
    uTime: { value: 0 },
    uTurbidity: { value: 2.6 },
    uRayleigh: { value: 1.15 },
    uMie: { value: 0.0042 },
    uMieG: { value: 0.82 },
    uSunIntensity: { value: 1 },
    uCloud: { value: 0.5 },
    uCloudHeight: { value: 1 },
    uStars: { value: 0 },
    uMoon: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return { mesh, uniforms };
}

/* ------------------------------------------------------------------ 雾 */

export function createFog() {
  return new THREE.FogExp2(new THREE.Color('#b8c9d6'), 0.0065);
}

/* ------------------------------------------------------------------ 海面 */

/** 覆盖整片海面的大平面，顶点位移做涌浪。 */
function makeSeaGeometry(segments, extent) {
  const geo = new THREE.PlaneGeometry(extent, extent, segments, segments);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * 海面自定义着色器（着色器版 Water 的思路 + 自己写的泡沫/焦散/深度雾）：
 *  - 反射：把视线在法线上的镜像方向喂给天空 shader（skyReflect），得到物理一致的天空倒影
 *  - 折射/水色：菲涅耳混合深浅水色，浅处透出沙色
 *  - 波峰白沫：由法线斜率 + 波高共同决定，浪尖才有泡沫
 *  - 太阳镜面高光 + 朝阳时的辉光拖尾
 *  - 距离雾：与场景雾统一
 */
const WATER_VERT_CLEAN = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uChoppy;

  varying vec3 vWorldPos;
  varying vec2 vUvW;
  varying vec3 vNormal;
  varying float vWaveH;
  varying vec4 vScreenPos;

  vec3 gerstner( vec2 p, vec2 dir, float amp, float len, float speed, out vec3 tangent, out vec3 binormal ) {
    float k = 6.28318530718 / len;
    float f = k * ( dot( dir, p ) - speed * uTime );
    float a = amp;
    float c = cos( f );
    float s = sin( f );
    float ka = k * a;
    tangent  = vec3( 1.0 - dir.x * dir.x * ka * s, dir.x * ka * c, -dir.x * dir.x * ka * s );
    binormal = vec3( -dir.x * dir.y * ka * s, dir.y * ka * c, -dir.y * dir.y * ka * s );
    return vec3( dir.x * a * c, a * s, dir.y * a * c );
  }

  void main() {
    vUvW = uv;
    vec3 pos = position;
    vec3 wp = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
    vec2 p = wp.xz;

    vec3 t0, b0, t1, b1, t2, b2;
    vec3 d = vec3( 0.0 );
    d += gerstner( p, normalize( vec2( 1.0, 0.22 ) ), 0.40 * uChoppy, 27.0, 3.0, t0, b0 );
    d += gerstner( p, normalize( vec2( 0.62, -0.85 ) ), 0.21 * uChoppy, 13.5, 2.4, t1, b1 );
    d += gerstner( p, normalize( vec2( -0.35, 0.94 ) ), 0.10 * uChoppy, 6.4, 1.7, t2, b2 );

    pos += d;
    vWaveH = d.y;

    vec3 n = normalize( cross( normalize( t0 + t1 + t2 ), normalize( b0 + b1 + b2 ) ) );
    if ( n.y < 0.0 ) n = -n;
    vNormal = n;

    vec4 world = modelMatrix * vec4( pos, 1.0 );
    vWorldPos = world.xyz;
    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;
    vScreenPos = gl_Position;
  }
`;

const WATER_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uNormalBig;
  uniform sampler2D uNormalRipple;
  uniform sampler2D uNoise;
  uniform vec3  uCameraPos;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform vec3  uShallowColor;
  uniform vec3  uDeepColor;
  uniform vec3  uFogColor;
  uniform float uFogDensity;
  uniform float uTime;
  uniform float uChoppy;
  uniform float uFoam;
  uniform vec3  uHorizonTint;
  uniform vec2  uCapeCenter;
  uniform float uCapeOuterR;
  uniform float uSeaLevel;

  varying vec3 vWorldPos;
  varying vec2 vUvW;
  varying vec3 vNormal;
  varying float vWaveH;
  varying vec4 vScreenPos;

  const float PI = 3.141592653589793;   // GGX 分母用

  /**
   * 「陆地遮罩」完全解析计算：岬角近似为以 CAPE_CENTER 为心、半径 uCapeOuterR 的圆。
   * 返回 (是否被陆地遮挡, 到岸线的距离)。
   * 只依赖世界坐标 → 没有深度纹理、没有 stencil、不需要额外 render target，
   * 画家算法单 pass 就能得到正确的裁剪与岸线泡沫。
   */
  vec2 landMask( vec2 xz, vec3 eye ) {
    vec2 d = xz - uCapeCenter;
    float radial = length( d );
    float ang = atan( d.y, d.x );
    // 陆地轮廓：圆 + 几阶谐波，模拟岬角外凸与内凹。
    // 注意：下方 fitCape() 会在采样半径上加上 HARMONIC_MAX，所以这个振幅不能随意调大，
    // 否则水面会盖到公路上。
    float r = uCapeOuterR
      + 3.0 * sin( ang * 3.0 + 0.6 )
      + 1.6 * sin( ang * 5.0 + 2.1 )
      - 0.9 * sin( ang * 7.0 );
    float dist = radial - r;              // >0 在海里，<0 在陆地上
    float eps = 0.35 + 0.02 * radial;     // 像素级膨胀，消除接缝锯齿
    bool behind = dist < eps;
    // 视线是否先撞到陆：把海岸圆当成球体求遮挡锥
    vec2 oc = uCapeCenter - eye.xz;
    float tc = dot( oc, normalize( xz - eye.xz ) );
    bool blocked = ( tc > 0.0 ) && ( tc < length( oc ) );
    if ( blocked ) {
      float shadowR = ( uCapeOuterR + 1.0 );
      float perp = abs( dot( oc, vec2( -normalize( xz - eye.xz ).y, normalize( xz - eye.xz ).x ) ) );
      if ( perp < shadowR ) behind = true;
    }
    return vec2( behind ? 1.0 : 0.0, dist );
  }

  void main() {
    vec2 maskInfo = landMask( vWorldPos.xz, uCameraPos );
    if ( maskInfo.x > 0.5 ) discard;

    // 法线细节随距离淡出，避免远处摩尔纹
    float dist = length( uCameraPos - vWorldPos );
    float detail = 1.0 - smoothstep( 60.0, 420.0, dist );
    vec2 uv = vWorldPos.xz * 0.014;
    vec3 nBig   = texture2D( uNormalBig, uv + vec2( uTime * 0.0045, uTime * 0.0028 ) ).xyz * 2.0 - 1.0;
    vec3 nRipple = texture2D( uNormalRipple, vWorldPos.xz * 0.05 + vec2( -uTime * 0.021, uTime * 0.013 ) ).xyz * 2.0 - 1.0;
    vec3 nGeo = normalize( vNormal );
    vec3 n = normalize( vec3(
      nGeo.x + ( nBig.x * 0.85 + nRipple.x * 0.5 ) * detail,
      1.0,
      nGeo.z + ( nBig.z * 0.85 + nRipple.z * 0.5 ) * detail
    ) );

    vec3 viewDir = normalize( uCameraPos - vWorldPos );
    float fres = pow( 1.0 - clamp( dot( n, viewDir ), 0.0, 1.0 ), 4.2 );
    fres = mix( 0.022, 1.0, fres );

    // --- 反射方向 -> 与天空同源的廉价近似（天顶蓝 ↔ 地平线色）
    vec3 R = reflect( -viewDir, n );
    float upness = clamp( R.y, 0.0, 1.0 );
    vec3 zenith = uHorizonTint * 0.5 + vec3( 0.12, 0.30, 0.62 );
    vec3 skyRefl = mix( uHorizonTint, zenith, pow( upness, 0.55 ) );
    skyRefl *= 0.85 + 0.35 * pow( max( dot( R, uSunDir ), 0.0 ), 3.0 );

    // --- 太阳镜面高光（GGX）+ 朝阳的辉光走廊
    vec3 H = normalize( viewDir + uSunDir );
    float ndh = max( dot( n, H ), 0.0 );
    float rough = 0.05 + 0.09 * ( 1.0 - upness );
    float a2 = rough * rough * rough * rough;
    float dGGX = a2 / ( PI * pow( ndh * ndh * ( a2 - 1.0 ) + 1.0, 2.0 ) );
    vec3 spec = uSunColor * dGGX * 0.9;
    vec2 sunAz = normalize( uSunDir.xz + vec2( 1e-5 ) );
    vec2 wAz   = normalize( vWorldPos.xz - uCameraPos.xz + vec2( 1e-5 ) );
    float azAlign = pow( max( dot( sunAz, wAz ), 0.0 ), 30.0 );
    spec += uSunColor * azAlign * 0.34 * clamp( uSunDir.y + 0.28, 0.0, 1.0 );

    // --- 水色
    float crestShade = smoothstep( -0.3, 0.5, vWaveH );
    vec3 body = mix( uDeepColor, uShallowColor, 0.30 + 0.40 * crestShade );
    float shore = 1.0 - smoothstep( 0.5, 26.0, -maskInfo.y );
    body = mix( body, uShallowColor * 1.25, shore * 0.6 );

    vec3 col = mix( body, skyRefl, fres );
    col += spec;

    // --- 浪尖白沫 + 岸线碎浪
    float slope = 1.0 - n.y;
    float crest = smoothstep( 0.05, 0.22, slope ) * smoothstep( 0.05, 0.30, vWaveH );
    float foamNoise = texture2D( uNoise, vWorldPos.xz * 0.05 + vec2( uTime * 0.01, uTime * -0.008 ) ).r;
    float foam = clamp( crest * ( 0.5 + foamNoise ), 0.0, 1.0 ) * uFoam;
    float surfBand = ( 1.0 - smoothstep( 0.0, 3.6, abs( maskInfo.y + 1.1 ) ) );
    float surf = surfBand * ( 0.45 + 0.55 * foamNoise ) * ( 0.7 + 0.3 * sin( uTime * 1.7 + vWorldPos.x * 0.25 + vWorldPos.z * 0.18 ) );
    foam = clamp( max( foam, surf * 0.9 ) + surfBand * 0.25, 0.0, 1.0 ) * uFoam;
    col = mix( col, vec3( 0.97, 0.98, 1.0 ), foam * 0.9 );

    // --- 场景雾（与 FogExp2 同模型，保证海天在地平线处无缝）
    float fogAmt = 1.0 - exp( -uFogDensity * uFogDensity * dist * dist );
    col = mix( col, uFogColor, clamp( fogAmt, 0.0, 1.0 ) );

    gl_FragColor = vec4( col, 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSea(renderer, skyUniforms, opts = {}) {
  const extent = opts.extent ?? 3000;
  const segments = opts.segments ?? 200;
  const geo = makeSeaGeometry(segments, extent);
  // 顶点着色器要用到近处的细节，UV 以世界尺度铺开
  const uniforms = {
    uTime: { value: 0 },
    uChoppy: { value: 1 },
    uNormalBig: { value: null },
    uNormalRipple: { value: null },
    uNoise: { value: null },
    uCameraPos: { value: new THREE.Vector3() },
    uSunDir: skyUniforms.uSunDir,
    uSunColor: { value: new THREE.Color('#ffd9a0') },
    uShallowColor: { value: new THREE.Color('#2fa2a6') },
    uDeepColor: { value: new THREE.Color('#0a3f5e') },
    uFogColor: { value: new THREE.Color('#b8c9d6') },
    uFogDensity: { value: 0.0065 },
    uFoam: { value: 1 },
    uHorizonTint: { value: new THREE.Color('#cbd8e2') },
    uCapeCenter: { value: CAPE_CENTER.clone() },
    uCapeOuterR: { value: CAPE_OUTER_R },
    uSeaLevel: { value: SEA_LEVEL },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WATER_VERT_CLEAN,
    fragmentShader: WATER_FRAG,
    transparent: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sea';
  mesh.frustumCulled = false;
  // 海面必须先画：地面是「挖洞」画法（路面/崖顶之上直接绘制），依赖深度测试剔除水下部分
  mesh.renderOrder = -100;
  mesh.receiveShadow = false;
  /**
   * 用赛道采样出真实的岬角半径，并写回 uniform。
   * 陆地遮罩是这个 shader 唯一知道「陆地在哪里」的手段：
   * 半径给小了，海面会盖到公路上；给大了，海水会缩进崖壁里。
   */
  // 陆地遮罩是这个 shader 唯一知道「陆地在哪里」的手段，所以中心必须是赛道质心。
  // 比赛道原点差 2~3m 就会在环的某些角度上差半个身位，表现为海面切进路面。
  const fitCape = (track, capCenter) => {
    const c = track.centroid;
    const cx = c ? c.x : capCenter.x;
    const cz = c ? c.z : capCenter.y;
    // 留量 = 路面半宽 + 路肩 + 谐波最大内凹 + 崖唇。
    // 只加一点余量是不够的：轮廓谐波会往里凹，路面外边缘也会被海面爬上来。
    const PAD = 3.1 + 0.55 + 4.0 + 3.2;
    let r = 0;
    const N = 360;
    for (let i = 0; i < N; i++) {
      const sm = track.at((i / N) * track.length);
      r = Math.max(r, Math.hypot(sm.pos.x - cx, sm.pos.z - cz) + PAD);
    }
    uniforms.uCapeCenter.value.set(cx, cz);
    uniforms.uCapeOuterR.value = r;
    return r;
  };
  return { mesh, uniforms, material: mat, extent, fitCape };
}

/** 供外部（相机后处理）复用的全局时间线。 */
export class Timeline {
  constructor() {
    this.t = 0;
    this.timeScale = 1;
  }
  advance(dt) {
    this.t += dt * this.timeScale;
  }
  /** hour ∈ [0,24)：返回太阳高度角（弧度，负数=地平线下）与方位角（弧度） */
  sunAngles(hour) {
    // 用一条不对称的曲线模拟真实日照：06:00 升，12:00 最高，18:00 落
    const dayT = ((hour - 6) / 12) * Math.PI; // 0..π 对应 06..18
    const elev = Math.sin(dayT) * 1.02;       // 最大约 58°
    const azi = -2.35 + dayT * 2.0;
    return { elev, azi };
  }
  sunDirFromHour(hour) {
    const { elev, azi } = this.sunAngles(hour);
    const v = new THREE.Vector3(
      Math.cos(elev) * Math.sin(azi),
      Math.sin(elev),
      Math.cos(elev) * Math.cos(azi)
    );
    return v.normalize();
  }
  /** 夜色程度 0(白天) → 1(深夜) */
  nightness(hour) {
    const { elev } = this.sunAngles(hour);
    return clamp01(1 - (elev + 0.12) / 0.34);
  }
  /** 黄金时刻权重：日出与日落各一个小峰 */
  goldenness(hour) {
    const { elev } = this.sunAngles(hour);
    const rise = clamp01(1 - Math.abs(elev - 0.12) / 0.22);
    return clamp01(rise);
  }
}

export const SEA_LEVEL = 0.0;
export const CAPE_CENTER = new THREE.Vector2(0, 16);
export const CAPE_OUTER_R = 30;