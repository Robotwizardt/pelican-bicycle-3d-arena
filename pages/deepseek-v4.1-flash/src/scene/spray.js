/**
 * spray.js — 通用粒子池（水花 / 沙尘 / 落水雾）
 * 单 draw call 的 Points + 自定义着色器；CPU 侧积分，容量固定。
 */
import * as THREE from 'three';

const VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute vec3 aCol;
uniform float uScale;
varying float vA;
varying vec3 vC;
void main() {
  vA = aAlpha; vC = aCol;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * uScale / max(0.05, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform sampler2D uTex;
varying float vA;
varying vec3 vC;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  float a = t.a * vA;
  if (a < 0.008) discard;
  gl_FragColor = vec4(vC * (0.6 + 0.6 * t.a), a);
}`;

function dropTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Spray {
  constructor(scene, { count = 700 } = {}) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.col = new Float32Array(count * 3);
    this.grav = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.alive = 0;
    this.cursor = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3));
    g.setDrawRange(0, count);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: dropTexture() }, uScale: { value: 420 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = g;
  }

  setViewport(height, fovDeg) {
    this.mat.uniforms.uScale.value = height * 0.5 / Math.tan((fovDeg * Math.PI) / 360) * 2.0;
  }

  _spawn(x, y, z, vx, vy, vz, { size = 0.05, life = 0.7, color = [0.86, 0.93, 1.0], grav = 9.0, drag = 0.6, alpha = 1 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size * (0.7 + Math.random() * 0.7);
    this.alpha[i] = alpha;
    this.col[i3] = color[0]; this.col[i3 + 1] = color[1]; this.col[i3 + 2] = color[2];
    this.grav[i] = grav; this.drag[i] = drag;
    return i;
  }

  /** 一簇水花 / 沙尘 */
  burst(p, {
    n = 8, spread = 1.6, up = 1.5, back = 0, size = 0.055, life = 0.75,
    color = [0.86, 0.93, 1.0], grav = 9.0, drag = 0.7,
  } = {}) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      this._spawn(
        p.x + (Math.random() - 0.5) * 0.16,
        p.y + Math.random() * 0.12,
        p.z + (Math.random() - 0.5) * 0.28,
        -back * (0.6 + Math.random()) + Math.cos(a) * spread * r,
        up * (0.5 + Math.random() * 0.9),
        Math.sin(a) * spread * r * 0.7,
        { size, life: life * (0.6 + Math.random() * 0.8), color, grav, drag }
      );
    }
  }

  /** 雾状（低速飘散，用于海雾 / 落地尘） */
  puff(p, { n = 6, size = 0.22, life = 1.6, color = [0.92, 0.94, 0.96], grav = -0.25, spread = 0.5 } = {}) {
    for (let k = 0; k < n; k++) {
      this._spawn(
        p.x + (Math.random() - 0.5) * 0.5, p.y + Math.random() * 0.3, p.z + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * spread, 0.15 + Math.random() * 0.3, (Math.random() - 0.5) * spread,
        { size: size * (0.7 + Math.random() * 0.8), life: life * (0.7 + Math.random() * 0.7), color, grav, drag: 1.5, alpha: 0.42 }
      );
    }
  }

  update(dt) {
    const n = this.count;
    let alive = 0;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const i3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= d; this.vel[i3 + 2] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02) { this.pos[i3 + 1] = 0.02; this.vel[i3 + 1] *= -0.25; }
      this.alpha[i] = Math.min(1, t * 1.6) * (t < 0.35 ? t / 0.35 : 1) * 0.95;
      if (this.life[i] <= 0) this.alpha[i] = 0;
      else alive++;
    }
    this.alive = alive;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aCol.needsUpdate = true;
  }
}
