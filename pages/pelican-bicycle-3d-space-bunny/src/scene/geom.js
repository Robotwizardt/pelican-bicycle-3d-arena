/**
 * scene/geom.js —— 程序化几何工具
 *
 * 三件事：
 *  1) sweepTube：沿任意曲线扫掠**可变截面**的管子（截面可以是圆、椭圆、任意闭合轮廓）。
 *     鹈鹕的脖子、喙、喉囊、脚趾、鸟腿、自行车车架全部由它生成。
 *  2) makeFeather：一片带弧度与扭转的羽毛（用于翅羽/尾羽/枕冠羽）。
 *  3) 一些把 Object3D 摆到两点之间的摆放工具。
 */
import * as THREE from 'three';
import { clamp01, lerp, TAU } from '../util.js';

/**
 * 沿曲线扫掠变截面管。
 * @param {THREE.Curve} curve
 * @param {object} opts
 *   steps     沿曲线的段数
 *   radial    截面顶点数
 *   closed    曲线是否闭合
 *   radius    (t)=>number 截面半径
 *   section   (angle, t)=>[x, y] 自定义截面（默认单位圆）
 *   caps      是否封端
 *   twist     (t)=>弧度 沿曲线扭转
 */
export function sweepTube(curve, opts = {}) {
  const steps = opts.steps ?? 28;
  const radial = opts.radial ?? 10;
  const closed = !!opts.closed;
  const radiusFn = opts.radius ?? (() => 0.1);
  const sectionFn = opts.section ?? ((a) => [Math.cos(a), Math.sin(a)]);
  const twistFn = opts.twist ?? (() => 0);
  const caps = opts.caps !== false;

  const frames = curve.computeFrenetFrames(steps, closed);
  const pts = [];
  const uvs = [];
  const segs = closed ? steps : steps;
  for (let i = 0; i <= segs; i++) {
    const t = closed ? i / segs : i / steps;
    const p = curve.getPointAt(clamp01(t));
    const N = frames.normals[Math.min(i, frames.normals.length - 1)];
    const B = frames.binormals[Math.min(i, frames.binormals.length - 1)];
    const tw = twistFn(t);
    const r = radiusFn(t);
    pts.push({ p, N, B, r, t });
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * TAU + tw;
      const [cx, cy] = sectionFn(a, t);
      uvs.push(k / radial, t);
    }
  }
  const positions = new Float32Array((segs + 1) * (radial + 1) * 3);
  const idx = [];
  let o = 0;
  const v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const { p, N, B, r, t } = pts[i];
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * TAU + twistFn(t);
      const [cx, cy] = sectionFn(a, t);
      v.copy(p).addScaledVector(N, cx * r).addScaledVector(B, cy * r);
      positions[o++] = v.x;
      positions[o++] = v.y;
      positions[o++] = v.z;
    }
  }
  const stride = radial + 1;
  const last = closed ? segs - 1 : segs;
  for (let i = 0; i < last; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * stride + k;
      const b = (i + 1) * stride + k;
      // 每个四边形拆成两个三角形
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** 椭圆截面工厂：rx(t)、ry(t) 可随 t 变化（第二个参数为归一化沿程位置 t）。 */
export function ellipseSection(rx, ry) {
  const fx = typeof rx === 'function' ? rx : () => rx;
  const fy = typeof ry === 'function' ? ry : () => ry;
  return (a, t = 0) => [Math.cos(a) * fx(t), Math.sin(a) * fy(t)];
}

/** 上宽下窄的「喙」截面：rx(t)、ry(t) 可随 t 变化（第二个参数传入归一化沿程位置 t）。 */
export function wedgeSection(rx, ry) {
  const fw = typeof rx === 'function' ? rx : () => rx;
  const fh = typeof ry === 'function' ? ry : () => ry;
  return (a, t = 0) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    // 圆角三角：上缘平直，下缘圆鼓
    const y = s >= 0 ? s * fh(t) * 0.85 : s * fh(t);
    const x = c * fw(t) * (1 + 0.18 * Math.max(0, -s));
    return [x, y];
  };
}

/**
 * 一片羽毛：从根部到尖端，长度方向带弧度（droop）与扭转（twist），
 * 宽度剖面：根部窄 → 40% 处最宽 → 尖端收成圆钝。
 */
export function makeFeather({
  length = 0.5,
  width = 0.12,
  droop = 0.18,
  twist = 0.0,
  thickness = 0.006,
  segments = 9,
  tipTaper = 2.2,
} = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const rows = segments;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    // 宽度剖面
    let w;
    if (t < 0.4) w = lerp(0.35, 1.0, Math.pow(t / 0.4, 0.7));
    else w = Math.pow(1 - (t - 0.4) / 0.6, tipTaper * 0.45);
    w *= width * 0.5;
    const z = t * length;
    const y = -Math.pow(t, 1.7) * droop;
    const tw = twist * t;
    const cx = Math.sin(tw) * z * 0.15;
    const cy = y + Math.cos(tw) * 0.0;
    positions.push(cx - Math.cos(tw) * w, cy, z, cx + Math.cos(tw) * w, cy, z);
    uvs.push(0, t, 1, t);
    if (i < rows) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  // 简单加厚：把中线做成两面（用极薄的双层，视觉上够用且便宜）
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** 便捷：生成 n 片扇形排布的羽毛（尾羽/翅羽），返回合并后的几何。 */
export function featherFan(count, makeGeo, place) {
  const geos = [];
  for (let i = 0; i < count; i++) {
    const g = makeGeo(i / Math.max(1, count - 1), i);
    place(g, i, count);
    geos.push(g);
  }
  return geos;
}

/** 把 object3D 摆成从 a 指向 b 的圆柱（用长度可变缩放）。 */
export function orientBetween(obj, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  obj.position.copy(a).addScaledVector(dir, 0.5);
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  obj.scale.y = len;
  return len;
}

/** 圆角盒（省一个 addon 依赖，自己倒角够用）。 */
export function roundedBox(w, h, d, r = 0.04, seg = 2) {
  const geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  const hd = d / 2 - r;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const cx = THREE.MathUtils.clamp(v.x, -hw, hw);
    const cy = THREE.MathUtils.clamp(v.y, -hh, hh);
    const cz = THREE.MathUtils.clamp(v.z, -hd, hd);
    const dx = v.x - cx;
    const dy = v.y - cy;
    const dz = v.z - cz;
    const len = Math.hypot(dx, dy, dz) || 1;
    pos.setXYZ(i, cx + (dx / len) * r, cy + (dy / len) * r, cz + (dz / len) * r);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** 简易挤压：把一串二维轮廓沿直线挤出（用于招牌/号码板等）。 */
export function extrudeProfile(points, depth, bevel = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geo.computeVertexNormals();
  return geo;
}