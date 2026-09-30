// 场景：起伏地形、环形公路、池塘、实例化树木/草/花/石头、路灯、云、远山、萤火虫、星空
import * as THREE from 'three';
import { mulberry32, smoothstep } from './helpers.js';

export const ROAD_R = 18;       // 公路中心线半径
export const ROAD_W = 3.2;
const POND_R = 7.5;

export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  let h = Math.sin(x * 0.07) * Math.cos(z * 0.06) * 2.2 + Math.sin(x * 0.19 + z * 0.13) * 0.6 + Math.cos(z * 0.23 - x * 0.05) * 0.4;
  h += smoothstep(40, 110, r) * 9 * (0.6 + 0.4 * Math.sin(Math.atan2(z, x) * 3));
  // 公路两侧压平
  const road = 1 - smoothstep(ROAD_W * 0.5 + 0.6, ROAD_W * 0.5 + 5, Math.abs(r - ROAD_R));
  h = THREE.MathUtils.lerp(h, 0, road);
  // 池塘下凹
  h -= (1 - smoothstep(POND_R - 1.5, POND_R + 3, r)) * 1.6;
  return h;
}

export function createWorld(scene, quality) {
  const rand = mulberry32(20260930);
  const world = { lamps: [], updaters: [] };

  // ---------- 地形 ----------
  const SIZE = 320, SEG = 220;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); tg.rotateX(-Math.PI / 2);
  const tp = tg.attributes.position; const cols = [];
  const grassA = new THREE.Color(0x5f9a3c), grassB = new THREE.Color(0x87b04a), dirt = new THREE.Color(0xb59a6a), sand = new THREE.Color(0xd8c89a), c = new THREE.Color();
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i); const h = heightAt(x, z); tp.setY(i, h);
    const r = Math.hypot(x, z);
    c.copy(grassA).lerp(grassB, 0.5 + 0.5 * Math.sin(x * 0.3) * Math.cos(z * 0.27));
    c.lerp(dirt, (1 - smoothstep(ROAD_W * 0.5, ROAD_W * 0.5 + 1.2, Math.abs(r - ROAD_R))) * 0.8);
    c.lerp(sand, 1 - smoothstep(POND_R, POND_R + 1.6, r));
    c.lerp(new THREE.Color(0x7b8a6a), smoothstep(60, 120, r) * 0.5);
    cols.push(c.r, c.g, c.b);
  }
  tg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  terrain.receiveShadow = true; terrain.name = 'terrain'; scene.add(terrain);

  // ---------- 公路（自定义 UV 的圆环） ----------
  const rc = document.createElement('canvas'); rc.width = 256; rc.height = 512;
  const g = rc.getContext('2d');
  g.fillStyle = '#3b3d42'; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 4000; i++) { const v = 52 + Math.random() * 18; g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2); }
  g.fillStyle = '#e9e4d0'; g.fillRect(8, 0, 8, 512); g.fillRect(240, 0, 8, 512);
  g.fillStyle = '#f2c230'; g.fillRect(122, 0, 12, 280);
  const roadTex = new THREE.CanvasTexture(rc); roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping; roadTex.colorSpace = THREE.SRGBColorSpace; roadTex.anisotropy = 8;
  const RS = 256; const rpos = [], ruv = [], ridx = [];
  const segLen = 4; const circ = 2 * Math.PI * ROAD_R; const repeats = Math.round(circ / segLen);
  for (let i = 0; i <= RS; i++) {
    const a = (i / RS) * Math.PI * 2;
    for (let j = 0; j <= 1; j++) {
      const r = ROAD_R + (j - 0.5) * ROAD_W;
      rpos.push(Math.cos(a) * r, 0.03, Math.sin(a) * r); ruv.push(j, (i / RS) * repeats);
    }
    if (i < RS) { const k = i * 2; ridx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2)); rg.setIndex(ridx); rg.computeVertexNormals();
  if (rg.attributes.normal.getY(0) < 0) { rg.setIndex(ridx.map((v, i) => ridx[i - (i % 3) + (2 - (i % 3))])); rg.computeVertexNormals(); }
  const road = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85 }));
  road.receiveShadow = true; scene.add(road);

  // ---------- 池塘 ----------
  const waterUniforms = { uTime: { value: 0 } };
  const waterMat = new THREE.MeshPhysicalMaterial({ color: 0x2f6f8f, roughness: 0.06, metalness: 0.1, transmission: 0, transparent: true, opacity: 0.9, clearcoat: 1 });
  waterMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = waterUniforms.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vWPos;')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        vec2 p = vWPos.xz;
        float r = length(p);
        vec2 grad = vec2(cos(p.x*1.7+uTime*1.3)+cos((p.x+p.y)*2.3-uTime*1.7)*0.6, cos(p.y*1.9-uTime*1.1)+cos((p.x-p.y)*2.9+uTime*2.1)*0.5)*0.06;
        grad += normalize(p+1e-4) * sin(r*6.0 - uTime*2.5)*0.03;
        normal = normalize(normal + (viewMatrix * vec4(grad.x, 0.0, grad.y, 0.0)).xyz);`);
  };
  const water = new THREE.Mesh(new THREE.CircleGeometry(POND_R + 1.2, 64), waterMat);
  water.rotation.x = -Math.PI / 2; water.position.y = -0.55; water.receiveShadow = true; scene.add(water);
  // 荷叶与荷花
  const padMat = new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.6, side: THREE.DoubleSide });
  const lotusMat = new THREE.MeshPhysicalMaterial({ color: 0xffb6d0, roughness: 0.4, sheen: 1, sheenColor: new THREE.Color(0xffffff) });
  const pads = [];
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2, r = 1.5 + rand() * (POND_R - 2.5);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.35 + rand() * 0.35, 20, 0.3, Math.PI * 2 - 0.3), padMat);
    pad.rotation.x = -Math.PI / 2; pad.rotation.z = rand() * 6; pad.position.set(Math.cos(a) * r, -0.53, Math.sin(a) * r);
    scene.add(pad); pads.push(pad);
    if (i % 3 === 0) {
      const lotus = new THREE.Group();
      for (let k = 0; k < 8; k++) { const pe = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), lotusMat); pe.scale.set(0.5, 1.4, 0.3); pe.position.set(Math.cos(k) * 0.06, 0.08, Math.sin(k) * 0.06); pe.rotation.set(Math.sin(k) * 0.5, 0, Math.cos(k) * 0.5); lotus.add(pe); }
      lotus.position.copy(pad.position).add(new THREE.Vector3(0, 0.02, 0)); scene.add(lotus);
    }
  }
  world.updaters.push((t) => { waterUniforms.uTime.value = t; pads.forEach((p, i) => { p.position.y = -0.53 + Math.sin(t * 1.2 + i) * 0.01; }); });

  // ---------- 放置工具 ----------
  const okSpot = (x, z, pad = 1.5) => { const r = Math.hypot(x, z); return Math.abs(r - ROAD_R) > ROAD_W * 0.5 + pad && r > POND_R + 1.8; };
  const dummy = new THREE.Object3D();

  // ---------- 树（两种：圆冠 + 松树） ----------
  const treeCount = quality.high ? 260 : 140;
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1.6, 7); trunkGeo.translate(0, 0.8, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1.1, 1); crownGeo.translate(0, 2.3, 0);
  const pineGeo = new THREE.ConeGeometry(1, 2.8, 8); pineGeo.translate(0, 2.6, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeCount);
  const pines = new THREE.InstancedMesh(pineGeo, crownMat, treeCount);
  let nc = 0, np = 0, nt = 0;
  const leafCols = [0x4f8f3a, 0x6aa84f, 0x3d7a34, 0x8fbf4f, 0xd9a13a, 0xc9642f].map((h) => new THREE.Color(h));
  const treeSpots = [];
  for (let i = 0; i < treeCount * 3 && nt < treeCount; i++) {
    const a = rand() * Math.PI * 2, r = 9 + Math.pow(rand(), 0.7) * 100;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!okSpot(x, z, 2.2) || (r > POND_R && r < ROAD_R - ROAD_W * 0.5 && rand() < 0.75)) continue; // 内圈留空给镜头
    const s = 0.7 + rand() * 0.9;
    dummy.position.set(x, heightAt(x, z) - 0.05, z); dummy.rotation.set(0, rand() * 6, 0); dummy.scale.set(s, s * (0.85 + rand() * 0.4), s); dummy.updateMatrix();
    trunks.setMatrixAt(nt++, dummy.matrix);
    const col = leafCols[Math.floor(rand() * leafCols.length)].clone().offsetHSL(0, 0, (rand() - 0.5) * 0.08);
    if (rand() < 0.45) { pines.setMatrixAt(np, dummy.matrix); pines.setColorAt(np++, col.clone().lerp(new THREE.Color(0x2d5a2d), 0.6)); }
    else { crowns.setMatrixAt(nc, dummy.matrix); crowns.setColorAt(nc++, col); }
    treeSpots.push([x, z]);
  }
  trunks.count = nt; crowns.count = nc; pines.count = np;
  for (const m of [trunks, crowns, pines]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }

  // ---------- 草（带风摆的着色器） ----------
  const windU = { uTime: { value: 0 }, uWind: { value: 1 } };
  const bladeGeo = new THREE.PlaneGeometry(0.07, 0.45, 1, 3); bladeGeo.translate(0, 0.225, 0);
  const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
  grassMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windU.uTime; sh.uniforms.uWind = windU.uWind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
        float bend = pow(position.y/0.45, 2.0);
        float w = sin(uTime*2.2 + wp.x*0.35 + wp.z*0.25) * 0.5 + sin(uTime*3.7 + wp.x*0.8) * 0.2;
        transformed.x += w * bend * 0.16 * uWind;
        transformed.z += cos(uTime*1.7 + wp.z*0.5) * bend * 0.06 * uWind;`);
  };
  const grassCount = quality.high ? 26000 : 9000;
  const grass = new THREE.InstancedMesh(bladeGeo, grassMat, grassCount);
  const gA = new THREE.Color(0x5c9a34), gB = new THREE.Color(0xa6c95a);
  let ng = 0;
  for (let i = 0; i < grassCount * 2 && ng < grassCount; i++) {
    const a = rand() * Math.PI * 2, r = 8.5 + rand() * 38;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!okSpot(x, z, 0.4)) continue;
    const s = 0.6 + rand() * 0.9;
    dummy.position.set(x, heightAt(x, z), z); dummy.rotation.set((rand() - 0.5) * 0.3, rand() * 6, 0); dummy.scale.set(s, s, s); dummy.updateMatrix();
    grass.setMatrixAt(ng, dummy.matrix); grass.setColorAt(ng++, gA.clone().lerp(gB, rand()));
  }
  grass.count = ng; grass.receiveShadow = true; scene.add(grass);
  world.updaters.push((t, speed) => { windU.uTime.value = t; });

  // ---------- 花 ----------
  const flowerGeo = new THREE.IcosahedronGeometry(0.09, 0); flowerGeo.translate(0, 0.35, 0);
  const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0x000000 }), 900);
  const fCols = [0xff5a7a, 0xffd23f, 0xffffff, 0xa77bff, 0xff8c42].map((h) => new THREE.Color(h));
  let nf = 0;
  for (let i = 0; i < 2500 && nf < 900; i++) {
    const a = rand() * Math.PI * 2, r = ROAD_R + (rand() < 0.5 ? -1 : 1) * (ROAD_W * 0.5 + 0.8 + rand() * 7);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!okSpot(x, z, 0.5)) continue;
    dummy.position.set(x, heightAt(x, z), z); dummy.rotation.set(0, rand() * 6, 0); dummy.scale.setScalar(0.7 + rand() * 0.8); dummy.updateMatrix();
    flowers.setMatrixAt(nf, dummy.matrix); flowers.setColorAt(nf++, fCols[Math.floor(rand() * fCols.length)]);
  }
  flowers.count = nf; flowers.castShadow = true; scene.add(flowers);

  // ---------- 石头 ----------
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ color: 0x8a8a88, roughness: 0.95, flatShading: true }), 120);
  for (let i = 0; i < 120; i++) {
    let x, z; do { const a = rand() * Math.PI * 2, r = 8 + rand() * 90; x = Math.cos(a) * r; z = Math.sin(a) * r; } while (!okSpot(x, z, 1));
    const s = 0.3 + rand() * 1.4;
    dummy.position.set(x, heightAt(x, z) + s * 0.1, z); dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3); dummy.scale.set(s, s * 0.6, s * 0.9); dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  rocks.castShadow = rocks.receiveShadow = true; scene.add(rocks);

  // ---------- 远山 ----------
  const mountMat = new THREE.MeshStandardMaterial({ color: 0x6a7f9a, roughness: 1, flatShading: true });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.2, r = 150 + rand() * 30;
    const h = 25 + rand() * 45;
    const m = new THREE.Mesh(new THREE.ConeGeometry(20 + rand() * 25, h, 6 + Math.floor(rand() * 4)), mountMat);
    m.position.set(Math.cos(a) * r, h / 2 - 3, Math.sin(a) * r); m.rotation.y = rand() * 3; scene.add(m);
    if (h > 50) { const cap = new THREE.Mesh(new THREE.ConeGeometry((20) * 0.35, h * 0.3, 6), new THREE.MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.7, flatShading: true })); cap.position.set(m.position.x, h - 3 - h * 0.15 + 0.3, m.position.z); cap.scale.x = cap.scale.z = (m.geometry.parameters.radius / 20); scene.add(cap); }
  }

  // ---------- 路灯 ----------
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.8, roughness: 0.35 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffc870, emissiveIntensity: 0 });
  const glowTex = radialTexture();
  const LAMPS = 14;
  for (let i = 0; i < LAMPS; i++) {
    const a = (i / LAMPS) * Math.PI * 2 + 0.1; const r = ROAD_R + ROAD_W * 0.5 + 0.7;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const lamp = new THREE.Group(); lamp.position.set(x, 0, z); lamp.rotation.y = -a;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 3.6, 10), poleMat); pole.position.y = 1.8;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 8), poleMat); arm.rotation.z = Math.PI / 2; arm.position.set(-0.4, 3.55, 0);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 14, 1, true), poleMat); shade.position.set(-0.78, 3.5, 0);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), bulbMat); bulb.position.set(-0.78, 3.4, 0);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffc070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(-0.9, 0.06, 0);
    lamp.add(pole, arm, shade, bulb, pool);
    pole.castShadow = true;
    // 仅偶数灯带真实点光源（性能）
    let light = null;
    if (i % 2 === 0) { light = new THREE.PointLight(0xffc070, 0, 9, 1.6); light.position.set(-0.78, 3.2, 0); lamp.add(light); }
    scene.add(lamp);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc878, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(1.6); halo.position.set(-0.78, 3.38, 0);
    lamp.add(halo);
    world.lamps.push({ bulb, pool, light, halo });
  }

  // ---------- 云 ----------
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: 0.95 });
  const clouds = new THREE.Group(); scene.add(clouds);
  for (let i = 0; i < 16; i++) {
    const cl = new THREE.Group();
    const n = 4 + Math.floor(rand() * 5);
    for (let k = 0; k < n; k++) {
      const p = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + rand() * 2.5, 1), cloudMat);
      p.position.set(k * 2.6 - n * 1.3, rand() * 1.5, (rand() - 0.5) * 3); p.scale.y = 0.65; cl.add(p);
    }
    const a = rand() * Math.PI * 2, r = 30 + rand() * 90;
    cl.position.set(Math.cos(a) * r, 28 + rand() * 18, Math.sin(a) * r);
    cl.userData.v = 0.6 + rand() * 1.2;
    clouds.add(cl);
  }
  world.clouds = clouds; world.cloudMat = cloudMat;
  world.updaters.push((t, speed, dt) => { clouds.children.forEach((cl) => { cl.position.x += cl.userData.v * dt; if (cl.position.x > 140) cl.position.x = -140; }); });

  // ---------- 星空 ----------
  const starGeo = new THREE.BufferGeometry(); const sp = [];
  for (let i = 0; i < 4500; i++) { const u = rand(), v = 0.03 + rand() * 0.94; const th = u * Math.PI * 2, ph = Math.acos(1 - v); sp.push(Math.sin(ph) * Math.cos(th) * 400, Math.cos(ph) * 400, Math.sin(ph) * Math.sin(th) * 400); }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const sc = []; for (let i = 0; i < sp.length / 3; i++) { const t = rand(), b = 0.5 + rand() * 0.9; sc.push(b * (t < 0.2 ? 0.8 : 1), b * (t < 0.2 ? 0.85 : 0.97), b * (t > 0.85 ? 0.75 : 1)); }
  starGeo.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  const starMat = new THREE.PointsMaterial({ vertexColors: true, toneMapped: false, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const stars = new THREE.Points(starGeo, starMat); stars.renderOrder = -1; scene.add(stars);
  world.stars = stars;

  // ---------- 萤火虫 ----------
  const FF = 220; const ffGeo = new THREE.BufferGeometry(); const ffp = new Float32Array(FF * 3); const ffSeed = [];
  for (let i = 0; i < FF; i++) {
    let x, z; do { const a = rand() * Math.PI * 2, r = 6 + rand() * 30; x = Math.cos(a) * r; z = Math.sin(a) * r; } while (!okSpot(x, z, 0.2));
    ffSeed.push([x, heightAt(x, z) + 0.4 + rand() * 1.6, z, rand() * 10]);
  }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffp, 3));
  const ffMat = new THREE.PointsMaterial({ color: 0xd8ff6a, size: 0.14, map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const fireflies = new THREE.Points(ffGeo, ffMat); fireflies.frustumCulled = false; scene.add(fireflies);
  world.updaters.push((t) => {
    for (let i = 0; i < FF; i++) { const s = ffSeed[i]; ffp[i * 3] = s[0] + Math.sin(t * 0.5 + s[3]) * 0.8; ffp[i * 3 + 1] = s[1] + Math.sin(t * 0.9 + s[3] * 2) * 0.3; ffp[i * 3 + 2] = s[2] + Math.cos(t * 0.4 + s[3]) * 0.8; }
    ffGeo.attributes.position.needsUpdate = true;
  });

  /** 昼夜切换：night 0..1 */
  world.setNight = (night, t, dusk = 0) => {
    world.lamps.forEach((l, i) => {
      const flick = 1 + Math.sin(t * 13 + i * 7) * 0.03;
      l.bulb.material.emissiveIntensity = night * 9 * flick;
      l.pool.material.opacity = night * 0.55;
      l.halo.material.opacity = night * 0.9 * flick;
      if (l.light) l.light.intensity = night * 14 * flick;
    });
    starMat.opacity = smoothstep(0.4, 1, night);
    ffMat.opacity = smoothstep(0.5, 1, night) * (0.7 + Math.sin(t * 3) * 0.3);
    cloudMat.color.setHSL(THREE.MathUtils.lerp(0.62, 0.07, dusk), THREE.MathUtils.lerp(0.15, 0.75, dusk), THREE.MathUtils.lerp(1, 0.25, night) * (1 - dusk * 0.12));
    mountMat.color.setHSL(0.6, 0.2, THREE.MathUtils.lerp(0.5, 0.18, night));
  };
  world.update = (t, speed, dt) => world.updaters.forEach((u) => u(t, speed, dt));
  world.treeSpots = treeSpots;
  return world;
}

export function radialTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); return t;
}
