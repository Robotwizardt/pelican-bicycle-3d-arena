// 通用几何/数学工具
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

/** 在两点之间放一根圆柱（用于车架、腿骨等） */
export function tubeBetween(a, b, r, mat, seg = 12) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  const m = new THREE.Mesh(g, mat);
  placeBetween(m, a, b);
  m.castShadow = true;
  return m;
}

/** 把一个单位高(沿 Y)的物体摆到 a→b 之间，可选按长度缩放 */
export function placeBetween(obj, a, b, scaleLen = false) {
  _dir.subVectors(b, a);
  const len = _dir.length();
  obj.position.copy(a).addScaledVector(_dir, 0.5);
  if (len > 1e-6) obj.quaternion.setFromUnitVectors(UP, _dir.multiplyScalar(1 / len));
  if (scaleLen) obj.scale.set(1, len, 1);
}

/** 平面两骨 IK：给定根、目标、骨长与“膝盖朝向”提示，返回关节位置 */
export function solveIK2(root, target, l1, l2, hint, out = new THREE.Vector3()) {
  const d = _dir.subVectors(target, root);
  let dist = d.length();
  const maxR = (l1 + l2) * 0.999;
  const minR = Math.abs(l1 - l2) * 1.001 + 1e-4;
  dist = THREE.MathUtils.clamp(dist, minR, maxR);
  const dirN = d.clone().normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // 与 dir 垂直、尽量指向 hint 的方向
  const perp = hint.clone().addScaledVector(dirN, -hint.dot(dirN)).normalize();
  return out.copy(root).addScaledVector(dirN, a).addScaledVector(perp, h);
}

/** 确定性伪随机 */
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 平滑 1D 噪声（值噪声 + 平滑插值） */
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const h = (n) => { const s = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453; return s - Math.floor(s); };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

export const smoothstep = (e0, e1, x) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const damp = (a, b, lambda, dt) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt));
