/**
 * util.js — 无依赖数学/工具库
 * 供场景、模型、物理与 UI 共用：确定性随机、噪声、几何辅助、贴图生成。
 */
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a));
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};
/** 帧率无关的指数趋近（critically-damped 近似） */
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
export const deg = (d) => (d * Math.PI) / 180;

/** mulberry32：确定性伪随机，保证每次刷新场景一致（可分享同一景观） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D 值噪声（双层哈希 + 平滑插值） */
export function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}
export function valueNoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm2(x, y, oct = 4, lac = 2.03, gain = 0.5) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * valueNoise2(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

/* ------------------------------------------------------------------ */
/* 几何辅助                                                            */
/* ------------------------------------------------------------------ */

const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _UP = new THREE.Vector3(0, 1, 0);

/** 把圆柱沿 a→b 摆放（半径 1，高 1，随长度缩放 y） */
export function aimCylinder(mesh, a, b, radiusScale = 1) {
  _va.subVectors(b, a);
  const len = Math.max(_va.length(), 1e-5);
  mesh.position.copy(a).addScaledVector(_va, 0.5);
  mesh.scale.set(radiusScale, len, radiusScale);
  mesh.quaternion.setFromUnitVectors(_UP, _va.normalize());
  return mesh;
}

/** 生成一段「管」：从 a 到 b，半径可两端不同（用 CylinderGeometry 的锥度） */
export function tubeBetween(a, b, r1, r2, mat, seg = 12, seg2 = 1) {
  const g = new THREE.CylinderGeometry(r2, r1, 1, seg, seg2, false);
  const m = new THREE.Mesh(g, mat);
  aimCylinder(m, a, b);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** 沿曲线生成一条 band（路面/条纹/围巾等） */
export function ribbonFromCurve(curve, { width = 4, segments = 240, yOffset = 0, closed = true, uvRepeat = 40, taper = null } = {}) {
  const pos = [], nor = [], uv = [], idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(closed ? t % 1 : t);
    const tan = curve.getTangentAt(closed ? t % 1 : t).normalize();
    const side = new THREE.Vector3().crossVectors(tan, up).normalize();
    const w = (taper ? taper(t) : 1) * width * 0.5;
    pos.push(p.x - side.x * w, p.y + yOffset, p.z - side.z * w);
    pos.push(p.x + side.x * w, p.y + yOffset, p.z + side.z * w);
    nor.push(0, 1, 0, 0, 1, 0);
    uv.push(0, t * uvRepeat, 1, t * uvRepeat);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** 用 Shape + 倒角做出有体积的板件（车架牌、车牌、泥除） */
export function roundedPlate(w, h, r, depth, mat) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: depth * 0.25, bevelThickness: depth * 0.25, bevelSegments: 2, curveSegments: 6 });
  g.center();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** 程序化 Canvas 贴图：路面沥青 */
export function makeAsphaltTexture(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = '#4a4e57'; x.fillRect(0, 0, size, size);
  const img = x.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (hash2(i * 0.013, i * 0.027) - 0.5) * 46;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(${180 + Math.random() * 60 | 0},${180 + Math.random() * 60 | 0},${190 + Math.random() * 50 | 0},${0.05 + Math.random() * 0.16})`;
    x.beginPath(); x.arc(Math.random() * size, Math.random() * size, Math.random() * 1.7, 0, TAU); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 程序化 Canvas 贴图：径向渐变（云、灯光辉光、粒子） */
export function makeGlowTexture(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(0.55, 'rgba(255,255,255,.30)'); g.addColorStop(1, outer);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 程序化 Canvas 贴图：一团噪声（云朵 alpha） */
export function makeCloudTexture(size = 256, seed = 7) {
  const rnd = mulberry32(seed);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  x.clearRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const r = size * (0.10 + rnd() * 0.22);
    const px = size * (0.22 + rnd() * 0.56), py = size * (0.34 + rnd() * 0.32);
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,.95)');
    g.addColorStop(0.5, 'rgba(255,255,255,.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 二维解析二连杆 IK：给定根部、目标与两段长度，返回膝关节位置 */
export function solveTwoBoneIK(root, target, l1, l2, poleDir, out = new THREE.Vector3()) {
  _va.subVectors(target, root);
  let d = _va.length();
  const dMax = (l1 + l2) * 0.999;
  const dMin = Math.abs(l1 - l2) * 1.001 + 1e-5;
  if (d > dMax) { _va.multiplyScalar(dMax / d); d = dMax; }
  else if (d < dMin) { _va.multiplyScalar(dMin / (d || 1e-6)); d = dMin; }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const dir = _va.clone().normalize();
  // 在 poleDir 张成的平面上取垂直分量作为弯曲方向
  const pole = poleDir.clone().addScaledVector(dir, -poleDir.dot(dir));
  if (pole.lengthSq() < 1e-8) pole.set(0, 0, 1);
  pole.normalize();
  return out.copy(root).addScaledVector(dir, a).addScaledVector(pole, h);
}

/** 线性插值关键帧轨道 */
export function sampleKeys(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (t <= t1) return lerp(v0, v1, smoothstep(t0, t1, t));
  }
  return keys[keys.length - 1][1];
}

export function formatClock(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}
