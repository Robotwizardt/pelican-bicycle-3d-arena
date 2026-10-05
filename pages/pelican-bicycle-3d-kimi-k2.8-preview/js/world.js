// 世界搭建：天空 / 光照 / 海面 / 木板路 / 画廊小屋 / 粒子
import * as THREE from 'three';
import { Assets } from './textures.js';

export const BoardTopY = 0.1;
export const LaneX = 0.6;           // 骑行道在板上的横向偏移
export const BoardLength = 400;     // 板长（z 方向，双向循环）

// ---------- 天空穹顶（着色器渐变 + 太阳 + 星星 + 昼夜过渡） ----------
export function buildSky(scene) {
  const uniforms = {
    uTop:     { value: new THREE.Color('#3d7ac8') },
    uHorizon: { value: new THREE.Color('#cfe4ee') },
    uSunDir:  { value: new THREE.Vector3(0.3, 0.35, -1).normalize() },
    uSunColor:{ value: new THREE.Color('#fff2cf') },
    uNight:   { value: 0.0 },
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // 始终推到远平面
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 uTop, uHorizon, uSunColor, uSunDir;
      uniform float uNight;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
        float sunD = max(dot(normalize(vDir), uSunDir), 0.0);
        // 太阳圆盘 + 光晕
        col += uSunColor * (smoothstep(0.9985, 0.9995, sunD) * 2.2 + pow(sunD, 64.0) * 0.5) * (1.0 - uNight * 0.85);
        // 夜晚星星
        if (uNight > 0.01 && vDir.y > 0.02) {
          vec2 sp = vDir.xz / (vDir.y + 0.4) * 90.0;
          vec2 cell = floor(sp);
          float star = step(0.992, hash(cell));
          float tw = 0.6 + 0.4 * sin(hash(cell * 1.7) * 40.0 + hash(cell) * 100.0);
          col += vec3(0.9, 0.95, 1.0) * star * tw * uNight * smoothstep(0.02, 0.25, vDir.y);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  sky.frustumCulled = false;
  scene.add(sky);
  return { sky, uniforms };
}

// ---------- 光照（随昼夜过渡） ----------
export function buildLights(scene) {
  const hemi = new THREE.HemisphereLight('#bcd8ff', '#4a3b2a', 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0d0', 1.6);
  sun.position.set(30, 42, -60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 22;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;   sun.shadow.camera.bottom = -d;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  const moon = new THREE.DirectionalLight('#7f9cc8', 0.0);
  moon.position.set(-30, 40, 50);
  scene.add(moon);
  return { hemi, sun, moon };
}

// ---------- 海面（Gerstner 顶点位移 + 程序法线 + 昼夜调色） ----------
export function buildOcean(scene) {
  const uniforms = {
    uTime:   { value: 0 },
    uNight:  { value: 0 },
    uDeep:   { value: new THREE.Color('#0d4d6b') },
    uShallow:{ value: new THREE.Color('#2fa3a8') },
    uSkyTint:{ value: new THREE.Color('#cfe4ee') },
    uSunDir: { value: new THREE.Vector3(0.3, 0.35, -1).normalize() },
    fogColor:   { value: new THREE.Color('#cfe4ee') },
    fogNear:    { value: 60 },
    fogFar:     { value: 260 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: false,
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying float vFogDepth;

      // 三个 Gerstner 波
      vec3 gerstner(vec2 xz, float t, out vec3 nrm) {
        vec3 p = vec3(xz.x, 0.0, xz.y);
        vec3 n = vec3(0.0, 1.0, 0.0);
        vec2 dirs[3]; float amps[3]; float lens[3]; float sps[3];
        dirs[0] = normalize(vec2(1.0, 0.35)); amps[0] = 0.32; lens[0] = 14.0; sps[0] = 1.1;
        dirs[1] = normalize(vec2(0.7, -0.8)); amps[1] = 0.18; lens[1] = 7.0;  sps[1] = 1.6;
        dirs[2] = normalize(vec2(-0.4, 1.0)); amps[2] = 0.10; lens[2] = 3.5;  sps[2] = 2.2;
        for (int i = 0; i < 3; i++) {
          float k = 6.28318 / lens[i];
          float f = k * dot(dirs[i], xz) + sps[i] * t;
          float a = amps[i];
          p.y += a * sin(f);
          p.x += dirs[i].x * a * 0.6 * cos(f);
          p.z += dirs[i].y * a * 0.6 * cos(f);
          n.x -= dirs[i].x * k * a * cos(f);
          n.z -= dirs[i].y * k * a * cos(f);
        }
        nrm = normalize(n);
        return p;
      }
      void main() {
        vec3 n;
        vec3 wp = gerstner(position.xz, uTime, n);
        vec4 world = modelMatrix * vec4(wp, 1.0);
        vWorld = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * n);
        vec4 mv = viewMatrix * world;
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime, uNight, fogNear, fogFar;
      uniform vec3 uDeep, uShallow, uSkyTint, uSunDir, fogColor;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying float vFogDepth;
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 N = normalize(vNormalW);
        float fres = pow(1.0 - max(dot(V, N), 0.0), 3.0);
        vec3 col = mix(uDeep, uShallow, 0.35 + 0.65 * fres);
        col = mix(col, uSkyTint, fres * 0.55);
        // 太阳高光
        vec3 H = normalize(V + uSunDir);
        float spec = pow(max(dot(N, H), 0.0), 220.0) * 1.6;
        // 波峰泡沫
        float foam = smoothstep(0.42, 0.62, vWorld.y + sin(vWorld.x * 0.8 + uTime * 1.7) * 0.05);
        col += vec3(spec) * (1.0 - uNight * 0.5);
        col = mix(col, vec3(0.92, 0.97, 0.98), foam * 0.45);
        // 夜色压暗 + 月光波带
        col *= (1.0 - uNight * 0.72);
        col += vec3(0.35, 0.5, 0.7) * uNight * fres * 0.4;
        float fogF = smoothstep(fogNear, fogFar, vFogDepth);
        col = mix(col, fogColor, fogF);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const geo = new THREE.PlaneGeometry(1600, 1600, 200, 200);
  geo.rotateX(-Math.PI / 2);
  const ocean = new THREE.Mesh(geo, mat);
  ocean.position.set(60, -1.6, 0); // 板在 x<2.5，海在板外侧
  ocean.frustumCulled = false;
  scene.add(ocean);
  return { ocean, uniforms };
}

// ---------- 木板路（纹理面板 + 立柱，沿 z 循环） ----------
export function buildBoardwalk(scene) {
  const group = new THREE.Group();
  const woodTex = Assets.wood;
  woodTex.repeat.set(1.6, 30);

  const deckMat = new THREE.MeshStandardMaterial({
    map: woodTex, roughness: 0.85, metalness: 0.0,
  });
  const sideMat = new THREE.MeshStandardMaterial({ color: '#5d4630', roughness: 0.9 });

  const W = 5, H = 0.22, L = BoardLength;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(W, H, L), deckMat);
  deck.position.set(0, 0, 0);
  deck.receiveShadow = true;
  deck.name = 'boardwalk';
  group.add(deck);

  // 两侧沿
  for (const sx of [-1, 1]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, L), sideMat);
    curb.position.set(sx * (W / 2 - 0.09), 0.1, 0);
    curb.receiveShadow = true;
    group.add(curb);
  }
  // 立柱
  const postGeo = new THREE.CylinderGeometry(0.12, 0.14, 2.4, 8);
  const postMat = new THREE.MeshStandardMaterial({ color: '#4a3826', roughness: 0.95 });
  const nPosts = Math.floor(L / 8);
  const posts = new THREE.InstancedMesh(postGeo, postMat, nPosts * 2);
  const m = new THREE.Matrix4();
  let idx = 0;
  for (let i = 0; i < nPosts; i++) {
    const z = -L / 2 + i * 8 + 4;
    for (const sx of [-1, 1]) {
      m.setPosition(sx * (W / 2 - 0.35), -1.2, z);
      posts.setMatrixAt(idx++, m);
    }
  }
  posts.castShadow = true;
  group.add(posts);
  scene.add(group);
  return { group, deck };
}

// ---------- 画廊小屋（彩蛋：屋内挂 AI 生成的鹈鹕油画） ----------
export function buildGalleryHut(scene, paintingTex) {
  const hut = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: '#e8dcc8', roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#b8543e', roughness: 0.8 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#6b4f37', roughness: 0.85 });

  // 三面墙 + 地板 + 顶（靠近板的一侧留空当门）
  const mk = (g, x, y, z) => { const mm = new THREE.Mesh(g, wallMat); mm.position.set(x, y, z); mm.castShadow = mm.receiveShadow = true; hut.add(mm); return mm; };
  mk(new THREE.BoxGeometry(3.4, 2.4, 0.14), 0, 1.2, -1.6);           // 后墙
  mk(new THREE.BoxGeometry(0.14, 2.4, 3.2), -1.65, 1.2, 0);          // 左墙
  mk(new THREE.BoxGeometry(0.14, 2.4, 3.2),  1.65, 1.2, 0);          // 右墙
  mk(new THREE.BoxGeometry(3.5, 0.12, 3.4), 0, 0.06, 0).material = trimMat; // 地板

  // 屋顶
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.9, 1.1, 4), roofMat);
  roof.position.y = 2.95; roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  hut.add(roof);

  // 画框 + AI 挂画
  if (paintingTex) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.15, 0.06), trimMat);
    frame.position.set(0, 1.35, -1.51);
    hut.add(frame);
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.0),
      new THREE.MeshStandardMaterial({ map: paintingTex, roughness: 0.7, emissive: '#221a12', emissiveIntensity: 0.25 }),
    );
    art.position.set(0, 1.35, -1.47);
    hut.add(art);
  }

  hut.position.set(-0.4, BoardTopY, 26); // 路旁，骑行会经过
  scene.add(hut);
  return hut;
}

// ---------- 粒子：海鸥群 + 骑行浪花 ----------
export function buildParticles(scene) {
  // 海鸥： InstancedMesh 上下扑翼环绕
  const gullGeo = new THREE.ConeGeometry(0.12, 0.55, 4);
  gullGeo.rotateZ(Math.PI / 2);
  const gullMat = new THREE.MeshBasicMaterial({ color: '#f4f7f9' });
  const GULLS = 7;
  const gulls = new THREE.InstancedMesh(gullGeo, gullMat, GULLS);
  gulls.frustumCulled = false;
  scene.add(gulls);

  // 浪花：Points 从轮下喷出
  const SPLASH = 260;
  const splashGeo = new THREE.BufferGeometry();
  const splashPos = new Float32Array(SPLASH * 3);
  const splashLife = new Float32Array(SPLASH).fill(-1);
  splashGeo.setAttribute('position', new THREE.BufferAttribute(splashPos, 3));
  const splashMat = new THREE.PointsMaterial({
    map: Assets.particle, size: 0.28, transparent: true, opacity: 0.85,
    depthWrite: false, blending: THREE.AdditiveBlending, color: '#dff3f6',
  });
  const splash = new THREE.Points(splashGeo, splashMat);
  splash.frustumCulled = false;
  scene.add(splash);

  const splashVel = new Float32Array(SPLASH * 3);
  let splashCursor = 0;

  return {
    gulls, GULLS,
    // 在 (x,y,z) 处喷 n 个粒子
    emit(x, y, z, n = 2, spread = 0.6, up = 1.6) {
      for (let i = 0; i < n; i++) {
        const k = splashCursor = (splashCursor + 1) % SPLASH;
        splashPos[k * 3]     = x + (Math.random() - 0.5) * 0.2;
        splashPos[k * 3 + 1] = y;
        splashPos[k * 3 + 2] = z + (Math.random() - 0.5) * 0.2;
        splashVel[k * 3]     = (Math.random() - 0.5) * spread;
        splashVel[k * 3 + 1] = Math.random() * up + 0.6;
        splashVel[k * 3 + 2] = (Math.random() - 0.5) * spread - 0.5;
        splashLife[k] = 0.8 + Math.random() * 0.4;
      }
    },
    update(dt, t, pelicanPos) {
      // 海鸥环绕
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const s = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < GULLS; i++) {
        const phase = (i / GULLS) * Math.PI * 2;
        const R = 9 + (i % 3) * 3;
        const speed = 0.35 + (i % 2) * 0.12;
        const flap = Math.sin(t * 9 + i * 1.7) * 0.5;
        const cx = pelicanPos.x - 4, cz = pelicanPos.z - 6;
        const px = cx + Math.cos(t * speed + phase) * R;
        const pz = cz + Math.sin(t * speed + phase) * R;
        const py = 5.5 + Math.sin(t * 0.7 + phase) * 1.2;
        e.set(0, -(t * speed + phase) - Math.PI / 2, flap, 'YXZ');
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(px, py, pz), q, s);
        gulls.setMatrixAt(i, m);
      }
      gulls.instanceMatrix.needsUpdate = true;

      // 浪花粒子
      for (let k = 0; k < SPLASH; k++) {
        if (splashLife[k] <= 0) { splashPos[k * 3 + 1] = -999; continue; }
        splashLife[k] -= dt;
        splashVel[k * 3 + 1] -= 5.2 * dt;
        splashPos[k * 3]     += splashVel[k * 3] * dt;
        splashPos[k * 3 + 1] += splashVel[k * 3 + 1] * dt;
        splashPos[k * 3 + 2] += splashVel[k * 3 + 2] * dt;
      }
      splashGeo.attributes.position.needsUpdate = true;
    },
  };
}
