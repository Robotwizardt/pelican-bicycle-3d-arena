/**
 * world.js — 程序化海岸公路世界（"跑步机"式无限场景）
 *   · 天空穹顶（渐变 + 云带 + 星空）+ 太阳 sprite
 *   · 海面（Gerstner 波 + 菲涅尔 + 高光 + 泡沫，近岸下沉降避免穿帮）
 *   · 悬崖 / 路肩 / 路面（精确 7.8m 宽，程序化 canvas 贴图）/ 沙滩
 *   · 棕榈、岩石、草丛、护栏、路桩、路牌（InstancedMesh + 顶点色单材质）
 * 世界沿 -X 无限延伸：自行车留在原地，地面与道具按行进距离滚动。
 */
import * as THREE from 'three';
import { mulberry32, clamp, lerp, TAU, smoothstep } from '../lib/util.js';
import { Sky } from './sky.js';

export const ROAD_TILE = 60;      // 瓷砖长度（米）
export const ROAD_W = 7.8;        // 路面宽度
export const TILES = 6;           // 循环瓷砖数
export const SPAN = ROAD_TILE * TILES;
export const WRAP_MIN = -80;      // 循环窗口起点（米）

/** 横向剖面（z, 高度）：与地形网格和道具落位共用 */
export const PROFILE = [
  [-90, 34], [-62, 23], [-38, 13.0], [-22, 6.2], [-14, 2.35], [-8.2, 0.55], [-3.9, 0.0],
  [3.9, -0.02], [8.2, -0.45], [14, -1.25], [24, -2.1], [45, -2.7], [90, -3.0],
];
const ROAD_IDX = PROFILE.findIndex((p) => p[0] === 3.9);   // 路面间隙起始行

export function terrainHeightAt(z) {
  if (z <= PROFILE[0][0]) return PROFILE[0][1];
  for (let k = 0; k + 1 < PROFILE.length; k++) {
    if (z >= PROFILE[k][0] && z <= PROFILE[k + 1][0]) {
      const f = (z - PROFILE[k][0]) / (PROFILE[k + 1][0] - PROFILE[k][0]);
      return lerp(PROFILE[k][1], PROFILE[k + 1][1], f);
    }
  }
  return PROFILE[PROFILE.length - 1][1];
}

/* 所有沿路方向的频率周期都能整除 SPAN，保证瓷砖循环时地形无跳变 */
function terrainNoise(x, z) {
  const k = (p) => TAU / p;
  const a = Math.abs(z);
  const amp = smoothstep(4.1, 13, a) * 0.6 + smoothstep(11, 46, a) * 2.1;
  return (
    Math.sin(x * k(180) + z * k(50)) * 0.55 +
    Math.sin(x * k(90) - z * k(23)) * 0.30 +
    Math.sin(x * k(45) + z * k(11)) * 0.15
  ) * amp;
}

/* ------------------------------------------------------------------ */
function asphaltTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const x = c.getContext('2d');
  const rnd = mulberry32(4242);
  x.fillStyle = '#3c4046'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 16000; i++) {
    const v = 42 + rnd() * 68;
    x.fillStyle = `rgba(${v},${v + 4},${v + 10},${0.22 + rnd() * 0.45})`;
    x.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 2.2, 1 + rnd() * 2.2);
  }
  for (let i = 0; i < 12; i++) {
    x.fillStyle = `rgba(28,30,36,${0.08 + rnd() * 0.18})`;
    x.beginPath(); x.ellipse(rnd() * 512, rnd() * 512, 20 + rnd() * 80, 12 + rnd() * 40, rnd() * 3, 0, TAU); x.fill();
  }
  // 中央虚线：canvas 的 u 轴 = 路长方向
  x.fillStyle = '#eae3c9';
  [0, 128, 256, 384].forEach((o) => x.fillRect(o + 20, 250, 78, 13));
  // 边线
  x.fillStyle = 'rgba(240,236,220,0.85)';
  x.fillRect(0, 9, 512, 12); x.fillRect(0, 491, 512, 12);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function sandTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  const rnd = mulberry32(99);
  x.fillStyle = '#c9b183'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 7000; i++) {
    const v = 140 + rnd() * 78;
    x.fillStyle = `rgba(${v},${v - 12},${v - 46},${0.18 + rnd() * 0.4})`;
    x.fillRect(rnd() * 256, rnd() * 256, 1.4, 1.4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function cliffTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  const rnd = mulberry32(777);
  x.fillStyle = '#6d5c49'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    const v = rnd();
    x.strokeStyle = `rgba(${92 + v * 62},${76 + v * 52},${58 + v * 42},${0.22 + rnd() * 0.5})`;
    x.lineWidth = 1 + rnd() * 6;
    x.beginPath();
    const y0 = rnd() * 256;
    x.moveTo(rnd() * 256, y0);
    x.bezierCurveTo(rnd() * 256, rnd() * 256, rnd() * 256, rnd() * 256, rnd() * 256, y0 + (rnd() - 0.5) * 60);
    x.stroke();
  }
  for (let i = 0; i < 4000; i++) {
    const v = rnd() * 90;
    x.fillStyle = `rgba(${v + 62},${v + 50},${v + 36},0.28)`;
    x.fillRect(rnd() * 256, rnd() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* 顶点色工具（让一个 InstancedMesh 用同一材质表达多色） */
export function paintGeo(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/* 合并几何体（自带实现，避免额外依赖；要求属性集合一致） */
export function mergeGeoms(geoms) {
  const out = new THREE.BufferGeometry();
  const names = Object.keys(geoms[0].attributes);
  names.forEach((name) => {
    const size = geoms[0].attributes[name].itemSize;
    const total = geoms.reduce((a, g) => a + g.attributes[name].array.length, 0);
    const arr = new Float32Array(total);
    let off = 0;
    geoms.forEach((g) => { arr.set(g.attributes[name].array, off); off += g.attributes[name].array.length; });
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  });
  const idx = [];
  let vOff = 0;
  geoms.forEach((g) => {
    const n = g.attributes.position.count;
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + vOff);
    else for (let i = 0; i < n; i++) idx.push(i + vOff);
    vOff += n;
  });
  out.setIndex(idx);
  return out;
}

/* ------------------------------------------------------------------ */
export class World {
  constructor({ scene, env, quality = 'high', renderer } = {}) {
    this.scene = scene;
    this.env = env;
    this.quality = quality;
    this.renderer = renderer;
    this.rnd = mulberry32(88112);
    this.dist = 0;
    this.timeOfDay = 0.30;
    this._buildSky();
    this._buildOcean();
    this._buildGround();
    this._buildProps();
    this._buildSkyline();
    this.setQuality(quality);
    this.setTimeOfDay(this.timeOfDay);
  }

  /* ---------------- 天空 ---------------- */
  _buildSky() {
    this.sky = new Sky(900);            // 分析式天空：日 / 月 / 星空 / 云 / 霞光
    this.skyUni = this.sky.uniforms;
    this.scene.add(this.sky);

    // 太阳发光交由后期 bloom 处理，这里保留一个可选的近景光晕锚点
    this.sunSprite = new THREE.Object3D();
    this.sunSprite.visible = false;
    this.scene.add(this.sunSprite);
  }

  /* ---------------- 海面 ---------------- */
  _buildOcean() {
    const seg = this.quality === 'low' ? 96 : this.quality === 'medium' ? 160 : 220;
    const W = 1500, D = 700;
    const geo = new THREE.PlaneGeometry(W, D, seg, Math.round(seg * 0.55));
    geo.rotateX(-Math.PI / 2);
    const uni = {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uDeep: { value: new THREE.Color(0x0b3d63) },
      uShallow: { value: new THREE.Color(0x2f8bb5) },
      uSky: { value: new THREE.Color(0x9fc9ef) },
      uNight: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uFogColor: { value: new THREE.Color(0xcfe0ea) },
      uFogNear: { value: 40 },
      uFogFar: { value: 320 },
    };
    this.oceanUni = uni;
    const mat = new THREE.ShaderMaterial({
      uniforms: uni, fog: false,
      vertexShader: /* glsl */`
        uniform float uTime, uNearShore;
        varying vec3 vW; varying vec3 vNorm; varying float vWave; varying float vFog;
        const float PI2 = 6.28318530718;
        float wave(vec2 p, vec2 dir, float len, float amp, float sp, float t){
          float k = PI2 / len;
          return amp * sin(dot(normalize(dir), p) * k + t * sp * k);
        }
        float surf(vec2 p, float t){
          float h = 0.0;
          h += wave(p, vec2(1.0, 0.22), 30.0, 0.34, 1.0, t);
          h += wave(p, vec2(0.72, -0.6), 17.0, 0.20, 1.25, t);
          h += wave(p, vec2(0.35, 0.94), 9.5, 0.115, 1.7, t);
          h += wave(p, vec2(-0.9, 0.32), 5.6, 0.055, 2.2, t);
          h += wave(p, vec2(0.5, 0.86), 3.1, 0.028, 3.1, t);
          return h;
        }
        void main() {
          vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
          float t = uTime;
          float h = surf(wp.xz, t);
          float e = 1.4;
          float hx = surf(wp.xz + vec2(e, 0.0), t) - surf(wp.xz - vec2(e, 0.0), t);
          float hz = surf(wp.xz + vec2(0.0, e), t) - surf(wp.xz - vec2(0.0, e), t);
          vNorm = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));
          // 近岸（z 小）把水面压下去，避免出现"悬空的直边"
          float shore = smoothstep(13.0, 7.4, wp.z);
          wp.y += -0.15 + h - shore * 2.6;
          vW = wp;
          vWave = h - shore * 2.6;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          vFog = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSun; uniform vec3 uDeep, uShallow, uSky, uFogColor;
        uniform float uNight, uFogNear, uFogFar;
        varying vec3 vW; varying vec3 vNorm; varying float vWave; varying float vFog;
        void main() {
          vec3 N = normalize(vNorm);
          vec3 L = normalize(uSun);
          vec3 col;
          if (uSun.y < 0.02) {
            // 夜间：只用天空色，避免"月亮"方向错误
            col = mix(uDeep, uSky, pow(1.0 - clamp(abs(N.y), 0.0, 1.0), 2.0) * 0.5);
          } else {
            vec3 V = normalize(cameraPosition - vW);
            vec3 H = normalize(L + V);
            float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
            float diff = clamp(dot(N, L), 0.0, 1.0);
            vec3 base = mix(uDeep, uShallow, clamp(vWave * 0.5 + 0.5, 0.0, 1.0));
            col = mix(base * (0.30 + 0.70 * diff), uSky, fres * 0.7);
            col += vec3(1.0, 0.97, 0.88) * pow(clamp(dot(N, H), 0.0, 1.0), 240.0) * 2.6;
            col += vec3(0.55, 0.62, 0.7) * pow(clamp(dot(N, H), 0.0, 1.0), 16.0) * 0.22;
            col += vec3(0.9) * smoothstep(0.30, 0.55, vWave) * 0.30;
          }
          col *= mix(1.0, 0.30, uNight);
          float f = clamp((vFog - uFogNear) / max(uFogFar - uFogNear, 1.0), 0.0, 1.0);
          col = mix(col, uFogColor, f);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const ocean = new THREE.Mesh(geo, mat);
    ocean.position.set(60, 0, 7.4 + D / 2);
    ocean.frustumCulled = false;
    this.ocean = ocean;
    this.scene.add(ocean);

    const bed = new THREE.Mesh(new THREE.PlaneGeometry(1600, 800), new THREE.MeshStandardMaterial({ color: 0x24384a, roughness: 1 }));
    bed.rotation.x = -Math.PI / 2;
    bed.position.set(60, -7, 7.4 + D / 2);
    this.scene.add(bed);
  }

  /* ---------------- 地面 / 路面 ---------------- */
  _buildGround() {
    const cliffT = cliffTexture(); cliffT.repeat.set(2, 2);
    const sandT = sandTexture(); sandT.repeat.set(6, 6);
    const roadT = asphaltTexture(); roadT.repeat.set(ROAD_TILE / 12, 1);

    this.roadMat = new THREE.MeshStandardMaterial({ map: roadT, roughness: 0.9, metalness: 0.02 });
    this.sandMat = new THREE.MeshStandardMaterial({ map: sandT, roughness: 0.95 });
    this.cliffMat = new THREE.MeshStandardMaterial({ map: cliffT, roughness: 0.96, flatShading: true });
    this.dirtMat = new THREE.MeshStandardMaterial({ color: 0x8d7a5e, roughness: 0.96 });

    const segX = this.quality === 'low' ? 6 : this.quality === 'high' ? 14 : 10;
    const tiles = new THREE.Group();
    this.tiles = tiles;
    this.scene.add(tiles);
    const rows = PROFILE.length;
    let tileIndex = 0;

    // 把剖面行区间构造成一条连续网格（世界相位保证瓷砖接缝处地形连续）
    const buildStrip = (r0, r1, mat, uvScale) => {
      const nR = r1 - r0;
      const vs = [], ix = [], uv = [];
      for (let r = r0; r <= r1; r++) {
        const z = PROFILE[r][0];
        for (let s = 0; s <= segX; s++) {
          const lx = (s / segX - 0.5) * ROAD_TILE;
          const wx = lx + tileIndex * ROAD_TILE;
          vs.push(lx, PROFILE[r][1] + terrainNoise(wx, z), z);
          uv.push(lx / uvScale, z / uvScale);
        }
      }
      for (let r = 0; r < nR; r++) {
        for (let s = 0; s < segX; s++) {
          const a = r * (segX + 1) + s, b = a + 1, c = a + segX + 1, d = c + 1;
          ix.push(a, c, b, b, c, d);
        }
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(vs, 3));
      gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      gg.setIndex(ix);
      gg.computeVertexNormals();
      const mesh = new THREE.Mesh(gg, mat);
      mesh.receiveShadow = true;
      return mesh;
    };

    for (let tileIndex = 0; tileIndex < TILES; tileIndex++) {
      const tileG = new THREE.Group();
      tileG.userData.tile = tileIndex;
      tileG.add(buildStrip(0, ROAD_IDX - 1, this.cliffMat, 14));      // 悬崖 + 路肩（z <= -3.9）
      tileG.add(buildStrip(ROAD_IDX, rows - 1, this.sandMat, 12));    // 沙滩（z >= 3.9）
      const roadGeo = new THREE.PlaneGeometry(ROAD_TILE, ROAD_W, segX, 1);
      roadGeo.rotateX(-Math.PI / 2);
      const road = new THREE.Mesh(roadGeo, this.roadMat);
      road.receiveShadow = true;
      tileG.add(road);
      tiles.add(tileG);
    }

    // 路缘白线（静态长条，循环窗口内始终可见）
    const edgeGeo = new THREE.BoxGeometry(SPAN + 40, 0.045, 0.16);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xece5d2, roughness: 0.75 });
    this.edges = [];
    [-1, 1].forEach((side) => {
      const e = new THREE.Mesh(edgeGeo, edgeMat);
      e.position.set(WRAP_MIN + SPAN / 2, 0.022, side * (ROAD_W * 0.5 - 0.22));
      this.scene.add(e);
      this.edges.push(e);
    });
  }

  /* ---------------- 路边道具 ---------------- */
  _buildProps() {
    const rnd = this.rnd;
    const props = new THREE.Group();
    this.props = props;
    this.scene.add(props);
    const vc = (o) => { o.vertexColors = true; return o; };
    const M = {
      palm: new THREE.MeshStandardMaterial(vc({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide })),
      rock: new THREE.MeshStandardMaterial(vc({ color: 0xffffff, roughness: 0.95, flatShading: true })),
      grass: new THREE.MeshStandardMaterial(vc({ color: 0xffffff, roughness: 0.92, side: THREE.DoubleSide })),
      post: new THREE.MeshStandardMaterial({ color: 0xd2d7db, roughness: 0.55, metalness: 0.25 }),
      rail: new THREE.MeshStandardMaterial({ color: 0xc2c8cd, roughness: 0.4, metalness: 0.6 }),
      reflector: new THREE.MeshStandardMaterial({ color: 0xff8a2b, roughness: 0.35, emissive: 0x431800, metalness: 0.3 }),
      sign: new THREE.MeshStandardMaterial({ color: 0xa9b0b6, roughness: 0.62 }),
      signFace: new THREE.MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.5 }),
    };
    this.propMats = M;

    /* 棕榈树（弯曲树干 + 9 片叶，顶点色区分） */
    const palmGeo = (() => {
      const parts = [];
      const segs = 7;
      let p = new THREE.Vector3(0, 0, 0);
      let lean = 0.05;
      for (let i = 0; i < segs; i++) {
        const r0 = 0.17 * (1 - i / (segs + 1.5)), r1 = 0.17 * (1 - (i + 1) / (segs + 1.5));
        const g = new THREE.CylinderGeometry(r1, r0, 0.78, 7, 1);
        g.translate(0, 0.39, 0);
        g.applyMatrix4(new THREE.Matrix4().makeRotationZ(-lean * i).setPosition(p));
        parts.push(paintGeo(g, i < 2 ? 0x5c4630 : 0x8a7350));
        p = p.clone().add(new THREE.Vector3(-Math.sin(lean * i) * 0.78, Math.cos(lean * i) * 0.78, 0));
        lean += 0.018;
      }
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU + 0.3;
        const len = 2.1 + rnd() * 0.9;
        const g = new THREE.PlaneGeometry(len, 0.6, 7, 1);
        const pos = g.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          const u = Math.max(0, Math.min(1, (pos.getX(k) + len / 2) / len));   // 夹紧：浮点误差会让 u 微负 → Math.pow(负,1.6)=NaN
          pos.setY(k, pos.getY(k) * (1 - u * 0.6));
          pos.setZ(k, -Math.pow(u, 1.6) * 1.25);
        }
        g.computeVertexNormals();
        g.translate(len / 2, 0, 0);
        g.applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.38 - rnd() * 0.22));
        g.applyMatrix4(new THREE.Matrix4().makeRotationY(a));
        g.translate(p.x, p.y, p.z);
        parts.push(paintGeo(g, i % 2 ? 0x2f7a43 : 0x3f9a52));
      }
      return mergeGeoms(parts);
    })();
    const palmCount = this.quality === 'low' ? 26 : this.quality === 'medium' ? 52 : 78;
    this.palms = new THREE.InstancedMesh(palmGeo, M.palm, palmCount);
    this.palms.castShadow = true; this.palms.receiveShadow = true;
    props.add(this.palms);
    this.palmData = [];
    for (let i = 0; i < palmCount; i++) {
      const x = (i / palmCount) * SPAN + rnd() * 8;
      const side = rnd() < 0.4 ? 1 : -1;
      const z = side > 0 ? 9.5 + rnd() * 10 : -(8 + rnd() * 17);
      this.palmData.push({ x, z, s: 0.85 + rnd() * 0.8, rot: rnd() * TAU, tilt: (rnd() - 0.5) * 0.16 });
    }

    /* 岩石 */
    const rockGeo = (() => {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const pos = g.attributes.position;
      const r2 = mulberry32(31);
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        v.multiplyScalar(0.72 + r2() * 0.56);
        pos.setXYZ(i, v.x, v.y * 0.72, v.z);
      }
      g.computeVertexNormals();
      return paintGeo(g, 0xffffff);
    })();
    const rockCount = this.quality === 'low' ? 40 : 110;
    this.rocks = new THREE.InstancedMesh(rockGeo, M.rock, rockCount);
    this.rocks.castShadow = true; this.rocks.receiveShadow = true;
    props.add(this.rocks);
    this.rockData = [];
    for (let i = 0; i < rockCount; i++) {
      const side = rnd() < 0.5 ? 1 : -1;
      this.rockData.push({
        x: rnd() * SPAN,
        z: side > 0 ? 6.4 + rnd() * 6 : -(5.2 + rnd() * 24),
        s: 0.22 + rnd() * 1.4,
        rot: rnd() * TAU,
        e: new THREE.Euler(rnd() * 0.7, rnd() * TAU, rnd() * 0.7),
        gray: 0.5 + rnd() * 0.35,
      });
    }

    /* 草丛 */
    const grassGeo = (() => {
      const parts = [];
      const r3 = mulberry32(55);
      for (let i = 0; i < 6; i++) {
        const g = new THREE.PlaneGeometry(0.07, 0.42, 1, 2);
        g.translate(0, 0.21, 0);
        g.applyMatrix4(new THREE.Matrix4().makeRotationZ((r3() - 0.5) * 0.8)
          .setPosition((r3() - 0.5) * 0.24, 0, (r3() - 0.5) * 0.24));
        parts.push(paintGeo(g, i % 2 ? 0x53612d : 0x65733a));
      }
      return mergeGeoms(parts);
    })();
    const grassCount = this.quality === 'low' ? 80 : 320;
    this.grass = new THREE.InstancedMesh(grassGeo, M.grass, grassCount);
    props.add(this.grass);
    this.grassData = [];
    for (let i = 0; i < grassCount; i++) {
      const side = rnd() < 0.45 ? 1 : -1;
      this.grassData.push({
        x: rnd() * SPAN,
        z: side > 0 ? 4.5 + rnd() * 4.2 : -(5.6 + rnd() * 11),
        s: 0.6 + rnd() * 1.7, rot: rnd() * TAU,
      });
    }

    /* 护栏立柱 */
    const postGeo = new THREE.BoxGeometry(0.09, 1.0, 0.09);
    postGeo.translate(0, 0.5, 0);
    const postCount = Math.floor(SPAN / 3) * 2;
    this.posts = new THREE.InstancedMesh(postGeo, M.post, postCount);
    this.posts.castShadow = true;
    props.add(this.posts);
    /* 护栏横梁（静态长条） */
    this.rails = [];
    const railGeo = new THREE.BoxGeometry(SPAN + 40, 0.09, 0.05);
    [-1, 1].forEach((side) => {
      [0.45, 0.82].forEach((h) => {
        const r = new THREE.Mesh(railGeo, M.rail);
        r.position.set(WRAP_MIN + SPAN / 2, h, side * 6.3);
        r.castShadow = true;
        props.add(r);
        this.rails.push(r);
      });
    });
    /* 反光路桩 */
    const refGeo = new THREE.BoxGeometry(0.05, 0.14, 0.05);
    refGeo.translate(0, 0.07, 0);
    const refCount = Math.floor(SPAN / 12) * 2;
    this.refs = new THREE.InstancedMesh(refGeo, M.reflector, refCount);
    props.add(this.refs);
    this.refData = [];
    for (let i = 0; i < refCount / 2; i++) {
      [-1, 1].forEach((side) => {
        this.refData.push({ x: i * 12 + (side > 0 ? 6 : 0) + rnd(), z: side * (ROAD_W * 0.5 + 0.32) });
      });
    }
    /* 路牌 */
    this.signs = [];
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.3, 8), M.post);
      pole.position.y = 1.15;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), M.signFace);
      face.position.y = 2.0;
      const back = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), M.sign);
      back.position.y = 2.0; back.rotation.y = Math.PI;
      g.add(pole, face, back);
      g.position.set(i * 74 + 22, 0, -(ROAD_W * 0.5 + 2.0));
      g.rotation.y = Math.PI / 2;
      props.add(g);
      this.signs.push(g);
    }
    this._placeProps(0);
  }

  /** 把「已行进距离」映射到循环窗口内的世界 X（自行车实际停在窗口内滚动） */
  wrapX(dist) {
    const v = ((dist - this.dist) % SPAN + SPAN) % SPAN;
    return v + WRAP_MIN;
  }
  _wrap(x) { return this.wrapX(x); }

  _placeProps(dist) {
    const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    const E = new THREE.Euler();
    this.palmData.forEach((d, i) => {
      P.set(this._wrap(d.x), terrainHeightAt(d.z) - 0.2, d.z);
      E.set(d.tilt, d.rot, d.tilt * 0.6, 'YXZ');
      Q.setFromEuler(E);
      S.setScalar(d.s);
      M4.compose(P, Q, S);
      this.palms.setMatrixAt(i, M4);
    });
    this.palms.instanceMatrix.needsUpdate = true;
    const col = new THREE.Color();
    this.rockData.forEach((d, i) => {
      P.set(this._wrap(d.x), terrainHeightAt(d.z) + 0.1 * d.s, d.z);
      Q.setFromEuler(d.e);
      S.set(d.s, d.s * 0.8, d.s * 1.1);
      M4.compose(P, Q, S);
      this.rocks.setMatrixAt(i, M4);
      col.setScalar(d.gray * 0.55).offsetHSL(0.08, 0.10, 0);
      this.rocks.setColorAt(i, col);
    });
    this.rocks.instanceMatrix.needsUpdate = true;
    if (this.rocks.instanceColor) this.rocks.instanceColor.needsUpdate = true;
    this.grassData.forEach((d, i) => {
      P.set(this._wrap(d.x), terrainHeightAt(d.z) + 0.02, d.z);
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.rot);
      S.setScalar(d.s);
      M4.compose(P, Q, S);
      this.grass.setMatrixAt(i, M4);
    });
    this.grass.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.posts.count; i++) {
      const side = i % 2 ? 1 : -1;
      P.set(this._wrap(Math.floor(i / 2) * 3), -0.4, side * 6.3);
      Q.identity(); S.setScalar(1);
      M4.compose(P, Q, S);
      this.posts.setMatrixAt(i, M4);
    }
    this.posts.instanceMatrix.needsUpdate = true;
    this.refData.forEach((d, i) => {
      P.set(this._wrap(d.x), -0.06, d.z);
      Q.identity(); S.setScalar(1);
      M4.compose(P, Q, S);
      this.refs.setMatrixAt(i, M4);
    });
    this.refs.instanceMatrix.needsUpdate = true;
    this.signs.forEach((s, i) => { s.position.x = this._wrap(i * 74 + 22); });
    this.tiles.children.forEach((t) => { t.position.x = this._wrap(t.userData.tile * ROAD_TILE); });
  }

  /* ---------------- 远景 ---------------- */
  _buildSkyline() {
    const rnd = mulberry32(9182);
    const far = new THREE.Group();
    this.scene.add(far);
    this.far = far;
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x50697a, roughness: 1, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(28 + rnd() * 42, 22 + rnd() * 44, 5 + Math.floor(rnd() * 3), 1), rockMat);
      m.position.set(-220 + i * 95 + rnd() * 40, -6, -190 - rnd() * 130);
      m.rotation.y = rnd() * TAU;
      m.scale.set(1 + rnd() * 0.6, 0.7 + rnd() * 0.8, 1);
      far.add(m);
    }
    const isleMat = new THREE.MeshStandardMaterial({ color: 0x5b6f5a, roughness: 1, flatShading: true });
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(15 + rnd() * 24, 12 + rnd() * 24, 6, 1), isleMat);
      m.position.set(-280 + i * 190 + rnd() * 60, -4, 170 + rnd() * 320);
      far.add(m);
    }
    this.boats = [];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 2.2), new THREE.MeshStandardMaterial({ color: 0xf2efe6 }));
      hull.position.y = 1.4;
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 7.4), new THREE.MeshStandardMaterial({ color: 0xfdfdfa, side: THREE.DoubleSide }));
      sail.position.set(0.4, 5.4, 0); sail.rotation.y = Math.PI / 2;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 7, 5), new THREE.MeshStandardMaterial({ color: 0xd8d4c8 }));
      mast.position.y = 4.6;
      b.add(hull, sail, mast);
      b.position.set(-120 + i * 95 + rnd() * 40, 0, 130 + rnd() * 260);
      b.rotation.y = rnd() * TAU;
      far.add(b);
      this.boats.push({ g: b, ph: rnd() * TAU, sp: 0.5 + rnd() * 1.1 });
    }
    // 海鸟
    const verts = [];
    for (let i = 0; i < 46; i++) {
      const x = (rnd() - 0.5) * 420, y = 26 + rnd() * 58, z = 70 + rnd() * 320;
      verts.push(x - 3, y, z, x, y + 0.6, z, x, y, z - 2.6);
      verts.push(x + 3, y, z, x, y + 0.6, z, x, y, z - 2.6);
    }
    const birdGeo = new THREE.BufferGeometry();
    birdGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    birdGeo.computeVertexNormals();
    this.birds = new THREE.Mesh(birdGeo, new THREE.MeshStandardMaterial({ color: 0xf7f7f2, side: THREE.DoubleSide, roughness: 0.8 }));
    far.add(this.birds);
  }

  /* ---------------- 时间 / 质量 ---------------- */
  setTimeOfDay(t) {
    this.timeOfDay = ((t % 1) + 1) % 1;
    // 太阳沿东→西的弧线：t=0.25 日出(+X) / t=0.5 正午 / t=0.75 日落(-X)
    const ang = this.timeOfDay * TAU;
    const sun = new THREE.Vector3(Math.cos(ang - Math.PI / 2) * 0.72, Math.sin(ang - Math.PI / 2), 0.34).normalize();
    const day = clamp(sun.y * 2.4 + 0.12, 0, 1);
    const dusk = clamp(1 - Math.abs(sun.y) * 7, 0, 1);      // 贴近地平线时的霞光强度
    const night = 1 - day;

    this.env.setSun(sun, {
      intensity: day > 0.02 ? 0.06 + day * 2.05 : 0.0,   // 主光峰值 ~2.1：环境由天空 IBL 提供，避免双重计光
      color: new THREE.Color().setHSL(0.10 + day * 0.03, 0.55 - day * 0.35, 0.70 + (1 - day) * 0.06),
    });
    this.env.setAmbient(0.16 + day * 0.86);
    this.env.setNight(night);
    this.env.markEnvDirty();

    const U = this.skyUni;
    U.uZenith.value.setHSL(0.600, 0.62, 0.050 + day * 0.34);                       // 天顶
    U.uHorizon.value.setHSL(0.570 - dusk * 0.02, 0.50, 0.09 + day * 0.44 - dusk * 0.05); // 地平线
    U.uGround.value.setHSL(0.070 + dusk * 0.02, 0.30 + dusk * 0.45, 0.08 + day * 0.66);  // 地平线下
    U.uCloudDark.value.setHSL(0.600, 0.22, 0.10 + day * 0.30);
    U.uSunColor.value.setHSL(0.110 - day * 0.02, 0.45 + night * 0.40, 0.62 + day * 0.20);
    U.uMoonColor.value.setHSL(0.600, 0.24, 0.88);
    U.uSunDir.value.copy(sun);
    U.uMoonDir.value.copy(sun).multiplyScalar(-1);
    U.uSunI.value = 0.20 + day * 1.30;
    U.uMoonI.value = clamp(night * 1.25 - 0.15, 0, 1);
    U.uStars.value = clamp((0.34 - day) * 3.4, 0, 1);
    U.uCloud.value = 0.42;
    U.uExposure.value = 1;

    this.oceanUni.uSun.value.copy(sun);
    this.oceanUni.uNight.value = night;
    this.oceanUni.uSky.value.copy(U.uHorizon.value).lerp(U.uZenith.value, 0.35);
    if (this.scene.fog) {
      this.scene.fog.color.copy(U.uGround.value).lerp(U.uHorizon.value, 0.55);
      this.scene.fog.near = 34;
      this.scene.fog.far = 300 - night * 60;
      this.oceanUni.uFogColor.value.copy(this.scene.fog.color);
      this.oceanUni.uFogNear.value = this.scene.fog.near;
      this.oceanUni.uFogFar.value = this.scene.fog.far;
    }
    if (this.sunSprite) this.sunSprite.position.copy(sun).multiplyScalar(700);
    return day;
  }

  setQuality(q) {
    this.quality = q;
    const on = q !== 'low';
    this.grass.visible = on;
    this.rails.forEach((r) => { r.visible = q !== 'low'; });
  }

  update(dt, dist, camPos, elapsed) {
    this.dist = dist;
    const t = elapsed;
    this.skyUni.uTime.value = t;
    this.oceanUni.uTime.value = t;
    this.sky.position.set(camPos.x, 0, camPos.z);
    this.sunSprite.position.copy(this.skyUni.uSunDir.value).multiplyScalar(700).add(new THREE.Vector3(camPos.x * 0.0, 0, 0));
    this.lastShadowRef = camPos;
    this._placeProps(dist);
    this.boats.forEach((b) => {
      b.g.position.x += b.sp * dt;
      b.g.position.y = Math.sin(t * 0.9 + b.ph) * 0.35;
      b.g.rotation.z = Math.sin(t * 0.7 + b.ph) * 0.03;
      if (b.g.position.x > 460) b.g.position.x = -460;
    });
    if (this.birds) this.birds.position.x = ((t * 7) % 700) - 350;
  }
}
