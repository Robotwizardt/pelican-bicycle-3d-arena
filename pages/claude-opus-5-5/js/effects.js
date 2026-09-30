// 粒子特效：后轮扬尘（GPU 点精灵，带寿命淡出）、点击时飘落的羽毛
import * as THREE from 'three';
import { radialTexture } from './world.js';

export function createDust(scene, max = 400) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3), life = new Float32Array(max), size = new Float32Array(max);
  const vel = new Float32Array(max * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uMap: { value: radialTexture() }, uColor: { value: new THREE.Color(0xd9c08e) }, uScale: { value: 300 } },
    vertexShader: `attribute float aLife; attribute float aSize; varying float vLife;
      uniform float uScale;
      void main(){ vLife=aLife; vec4 mv=modelViewMatrix*vec4(position,1.0);
        gl_PointSize = aSize * (1.6 - aLife) * uScale / -mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; varying float vLife;
      void main(){ if(vLife<=0.0) discard; float a=texture2D(uMap,gl_PointCoord).a * vLife*vLife*0.28; gl_FragColor=vec4(uColor,a); }`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
  let head = 0, acc = 0;
  return {
    mat,
    update(dt, emitPos, speed, back) {
      acc += dt * speed * 9;
      while (acc > 1) {
        acc -= 1; const i = head; head = (head + 1) % max;
        pos[i * 3] = emitPos.x + (Math.random() - 0.5) * 0.15; pos[i * 3 + 1] = emitPos.y + 0.02; pos[i * 3 + 2] = emitPos.z + (Math.random() - 0.5) * 0.15;
        vel[i * 3] = back.x * speed * 0.15 + (Math.random() - 0.5) * 0.4; vel[i * 3 + 1] = 0.3 + Math.random() * 0.5; vel[i * 3 + 2] = back.z * speed * 0.15 + (Math.random() - 0.5) * 0.4;
        life[i] = 1; size[i] = 0.25 + Math.random() * 0.35;
      }
      for (let i = 0; i < max; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt * 0.8;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        vel[i * 3 + 1] -= dt * 0.25; vel[i * 3] *= 0.98; vel[i * 3 + 2] *= 0.98;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.aLife.needsUpdate = true; geo.attributes.aSize.needsUpdate = true;
    },
  };
}

export function createFeathers(scene) {
  const g = new THREE.PlaneGeometry(0.06, 0.16); g.translate(0, 0.08, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xfaf6ee, side: THREE.DoubleSide, roughness: 0.8, transparent: true });
  const pool = [];
  return {
    burst(origin, n = 14) {
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(g, mat.clone());
        m.position.copy(origin);
        m.userData = { v: new THREE.Vector3((Math.random() - 0.5) * 2.2, 1 + Math.random() * 1.8, (Math.random() - 0.5) * 2.2), life: 3 + Math.random() * 2, ph: Math.random() * 6 };
        m.castShadow = true; scene.add(m); pool.push(m);
      }
    },
    update(dt, t) {
      for (let i = pool.length - 1; i >= 0; i--) {
        const m = pool[i]; const d = m.userData;
        d.life -= dt; d.v.y = Math.max(d.v.y - dt * 3, -0.45);
        d.v.x *= 0.985; d.v.z *= 0.985;
        m.position.addScaledVector(d.v, dt);
        m.position.x += Math.sin(t * 3 + d.ph) * dt * 0.5;
        m.rotation.set(Math.sin(t * 4 + d.ph) * 0.8, t * 2 + d.ph, Math.cos(t * 3 + d.ph) * 0.6);
        m.material.opacity = Math.min(1, d.life);
        if (d.life <= 0 || m.position.y < -1) { scene.remove(m); m.material.dispose(); pool.splice(i, 1); }
      }
    },
  };
}
