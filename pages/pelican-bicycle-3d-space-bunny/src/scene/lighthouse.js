/**
 * scene/lighthouse.js —— 灯塔 / 灯室 / 旋转光束 / 邮政车库
 *
 * 灯塔：LatheGeometry 的分段收分塔身（真的像 lighthouse —— 底部粗、顶部细，
 * 有一段锥形腰身），漆成红白横带（用多段 Lathe 分组上色）；
 * 灯室：八角形玻璃罩 + 菲涅尔透镜（叠环）+ 栏杆 + 穹顶 + 风信标；
 * 光束：一个加性混合的锥体网格 + 一枚 Sprite 灯芯 + 真实 SpotLight，
 * 只在夜色（时间轴 > 16.8 或 < 6.2）点亮。
 */
import * as THREE from 'three';
import { clamp01, lerp, TAU } from '../util.js';

export function createLighthouse(scene, textures, opts = {}) {
  const group = new THREE.Group();
  group.name = 'lighthouse';
  const { position = new THREE.Vector3(43, 8.2, 3), sByStation = 0.055 } = opts;

  /* ---------------- 塔身：分段 Lathe，白红相间 ---------------- */
  const H = 26;
  // 半径剖面：底座 → 锥形塔身 → 顶部平台
  const profile = [
    [6.2, 0.0], [6.4, 0.9], [5.6, 1.6], [5.2, 2.2],
    [4.6, 5.0], [4.1, 9.0], [3.65, 13.0], [3.3, 17.0],
    [3.05, 19.0], [3.0, 19.8], [3.9, 20.1], [3.9, 20.6],
  ];
  const bands = 5;
  const towerMeshes = [];
  for (let b = 0; b < bands; b++) {
    const y0 = (b / bands) * (H - 7);
    const y1 = ((b + 1) / bands) * (H - 7);
    const seg = [];
    for (const [r, y] of profile) {
      if (y >= y0 && y <= y1) {
        seg.push(new THREE.Vector2(r, y));
      }
    }
    if (seg.length < 2) continue;
    const white = b % 2 === 0;
    const geo = new THREE.LatheGeometry(seg, 40);
    const mat = new THREE.MeshStandardMaterial({
      color: white ? new THREE.Color('#f4f1ea') : new THREE.Color('#c8412f'),
      roughness: 0.72,
      metalness: 0.03,
    });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    towerMeshes.push(m);
    group.add(m);
  }

  /* ---------------- 平台 ---------------- */
  const platformY = 20.6;
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(4.4, 4.4, 0.5, 32),
    new THREE.MeshStandardMaterial({ color: '#5c6470', roughness: 0.8 })
  );
  platform.position.y = platformY + 0.2;
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);

  // 平台栏杆
  const railGroup = new THREE.Group();
  const railMat = new THREE.MeshStandardMaterial({ color: '#2c333c', roughness: 0.45, metalness: 0.6 });
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.05, 6);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const post = new THREE.Mesh(postGeo, railMat);
    post.position.set(Math.cos(a) * 4.0, platformY + 1.0, Math.sin(a) * 4.0);
    railGroup.add(post);
  }
  const railRing = new THREE.Mesh(new THREE.TorusGeometry(4.0, 0.045, 6, 32), railMat);
  railRing.rotation.x = Math.PI / 2;
  railRing.position.y = platformY + 1.5;
  railGroup.add(railRing);
  group.add(railGroup);

  /* ---------------- 灯室 ---------------- */
  const lanternY = platformY + 0.5;
  const lanternBase = new THREE.Mesh(
    new THREE.CylinderGeometry(3.0, 3.2, 1.4, 12),
    new THREE.MeshStandardMaterial({ color: '#3c444e', roughness: 0.55, metalness: 0.35 })
  );
  lanternBase.position.y = lanternY + 0.7;
  lanternBase.castShadow = true;
  group.add(lanternBase);

  // 八角玻璃罩
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.7, 3.6, 8, 1, true),
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#cfe6f2'),
      roughness: 0.06,
      metalness: 0,
      transmission: 0.92,
      thickness: 0.4,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      envMapIntensity: 1.2,
    })
  );
  glass.position.y = lanternY + 3.2;
  group.add(glass);

  // 菲涅尔透镜：叠环 + 中心灯泡
  const lensGroup = new THREE.Group();
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#ffe9b8'),
    roughness: 0.05,
    metalness: 0,
    transmission: 0.85,
    thickness: 0.2,
    transparent: true,
    opacity: 0.6,
    emissive: new THREE.Color('#ffca6a'),
    emissiveIntensity: 0,
  });
  for (let i = 0; i < 7; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55 + i * 0.16, 0.06, 6, 20), lensMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = lanternY + 2.2 + i * 0.22;
    lensGroup.add(ring);
  }
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 16, 12),
    new THREE.MeshStandardMaterial({
      color: '#fff3d0',
      emissive: new THREE.Color('#ffcf7d'),
      emissiveIntensity: 0,
      roughness: 0.2,
    })
  );
  bulb.position.y = lanternY + 2.9;
  lensGroup.add(bulb);
  group.add(lensGroup);

  // 穹顶
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2.9, 24, 14, 0, TAU, 0, Math.PI * 0.5),
    new THREE.MeshStandardMaterial({ color: '#2f363f', roughness: 0.4, metalness: 0.55 })
  );
  dome.position.y = lanternY + 5.0;
  dome.castShadow = true;
  group.add(dome);
  // 穹顶上的通风小球与风向标
  const finial = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 12, 10),
    new THREE.MeshStandardMaterial({ color: '#c8412f', roughness: 0.5 })
  );
  finial.position.y = lanternY + 7.85;
  group.add(finial);
  const vane = new THREE.Group();
  const vaneRod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), railMat);
  vaneRod.position.y = lanternY + 8.6;
  const vaneArrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 6), railMat);
  vaneArrow.position.set(0.35, lanternY + 9.2, 0);
  vaneArrow.rotation.z = -Math.PI / 2;
  vane.add(vaneRod, vaneArrow);
  group.add(vane);

  /* ---------------- 光束 ---------------- */
  const beamPivot = new THREE.Group();
  beamPivot.position.y = lanternY + 2.9;
  group.add(beamPivot);

  const beamGeo = new THREE.ConeGeometry(7.5, 130, 20, 1, true);
  // 锥体默认沿 Y 轴，旋转成水平
  beamGeo.rotateZ(Math.PI / 2);
  beamGeo.translate(65, 0, 0);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: { value: 0 },
      uColor: { value: new THREE.Color('#ffe3a8') },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uIntensity;
      uniform vec3 uColor;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        // 沿光束距离衰减 + 边缘柔化 + 轻微闪烁（大气中的光柱抖动）
        float alongFade = 1.0 - smoothstep( 0.0, 130.0, vPos.x );
        float edge = 1.0 - abs( vUv.y * 2.0 - 1.0 );
        float flicker = 0.92 + 0.08 * sin( uTime * 3.1 ) * sin( uTime * 7.3 );
        float a = alongFade * pow( edge, 1.6 ) * uIntensity * flicker;
        gl_FragColor = vec4( uColor, a * 0.32 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.frustumCulled = false;
  beamPivot.add(beam);

  // 灯芯光晕 sprite（用程序生成的径向渐变纹理）
  const glowTex = makeGlowTexture();
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: new THREE.Color('#ffdca0'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    })
  );
  glow.scale.set(22, 22, 1);
  glow.position.y = 0;
  beamPivot.add(glow);

  // 真实灯：SpotLight 打进海面与雾里（夜里）
  const spot = new THREE.SpotLight('#ffdca0', 0, 260, 0.22, 0.55, 1.4);
  spot.position.set(0, 0, 0);
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(60, -6, 0);
  beamPivot.add(spot);
  beamPivot.add(spotTarget);
  spot.target = spotTarget;

  /* ---------------- 灯塔院子（地面平台 + 铁艺大门 + 告示牌） ---------------- */
  const yard = new THREE.Mesh(
    new THREE.CylinderGeometry(9.5, 10.2, 0.6, 28),
    // 灯塔院子：铺装地面，比路面亮一档，做出“与沥青路不同的材质”的层次
    new THREE.MeshStandardMaterial({
      map: textures.asphalt.map,
      bumpMap: textures.asphalt.bump,
      bumpScale: 0.35,
      color: '#a2a9b2',
      roughness: 0.9,
    })
  );
  yard.position.y = -0.3;
  yard.receiveShadow = true;
  group.add(yard);

  const gateGroup = new THREE.Group();
  const gateMat = new THREE.MeshStandardMaterial({ color: '#243039', roughness: 0.5, metalness: 0.5 });
  for (let i = 0; i < 7; i++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), gateMat);
    bar.position.set(-1.8 + i * 0.6, 1.3, 0);
    gateGroup.add(bar);
  }
  const gateTop = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 0.12), gateMat);
  gateTop.position.y = 2.5;
  gateGroup.add(gateTop);
  gateGroup.position.set(0, 0, -9.4);
  group.add(gateGroup);

  // 铁艺围栏（绕院子一圈，留门口）
  const fenceGroup = new THREE.Group();
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * TAU;
    if (Math.abs(a - Math.PI * 1.5) < 0.35) continue; // 门口
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 5), gateMat);
    post.position.set(Math.cos(a) * 9.8, 0.6, Math.sin(a) * 9.8);
    fenceGroup.add(post);
  }
  const fenceRing = new THREE.Mesh(new THREE.TorusGeometry(9.8, 0.035, 5, 48), gateMat);
  fenceRing.rotation.x = Math.PI / 2;
  fenceRing.position.y = 1.05;
  fenceGroup.add(fenceRing);
  group.add(fenceGroup);

  group.position.copy(position);
  scene.add(group);

  /* ---------------- 夜间状态 ---------------- */
  let beamPhase = 0;
  const state = {
    group,
    position,
    lampWorldPos: new THREE.Vector3(position.x, position.y + lanternY + 2.9, position.z),
    beamPivot,
    beamMat,
    glow,
    spot,
    lensMat,
    bulbMat: bulb.material,
    /** night ∈ [0,1]：0 白天，1 深夜 */
    setNight(night) {
      const on = clamp01((night - 0.35) / 0.5);
      beamMat.uniforms.uIntensity.value = on;
      glow.material.opacity = on * 0.9;
      glow.scale.setScalar(14 + on * 14);
      lensMat.emissiveIntensity = on * 1.6;
      bulb.material.emissiveIntensity = on * 3.5;
      // 衰減=1.4 时光强衰减很快，这个数量级才对应“灯塔照亮海面”的观感。
      // 之前的 900000 会把整个场景打爆成一片死白。
      spot.intensity = on * 2600;
      beam.visible = on > 0.01;
      glow.visible = on > 0.01;
    },
    update(dt, elapsed) {
      beamPhase += dt * 0.42; // 转一圈约 15s
      beamPivot.rotation.y = beamPhase;
      beamMat.uniforms.uTime.value = elapsed;
    },
    height: H,
  };
  state.setNight(0);
  return state;
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,236,200,1)');
  g.addColorStop(0.25, 'rgba(255,214,140,0.55)');
  g.addColorStop(0.6, 'rgba(255,180,90,0.15)');
  g.addColorStop(1, 'rgba(255,160,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ 邮政车库 */

/** 码头边的邮政车库：波纹铁皮墙 + 双开大门 + 投递窗口 + 招牌 + 邮筒。 */
export function createPostOffice(scene, textures, opts = {}) {
  const { position = new THREE.Vector3(-34, 1.5, 6), yaw = 0.6 } = opts;
  const group = new THREE.Group();
  group.name = 'postOffice';

  const W = 9;
  const D = 7;
  const Hh = 4.2;

  // 地基
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(W + 1.2, 0.4, D + 1.2),
    new THREE.MeshStandardMaterial({ color: '#6d747c', roughness: 0.95 })
  );
  slab.position.y = -0.2;
  slab.receiveShadow = true;
  group.add(slab);

  // 波纹铁皮墙（四面）
  const wallMat = new THREE.MeshStandardMaterial({
    map: textures.corrugated,
    roughness: 0.55,
    metalness: 0.45,
    color: new THREE.Color('#2f6b70'),
  });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(W, Hh, D), wallMat);
  wall.position.y = Hh / 2;
  wall.castShadow = true;
  wall.receiveShadow = true;
  group.add(wall);

  // 单坡屋顶
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(W + 0.8, 0.22, D + 0.8),
    new THREE.MeshStandardMaterial({ color: '#1f4a52', roughness: 0.5, metalness: 0.5 })
  );
  roof.position.y = Hh + 0.1;
  roof.rotation.z = 0.06;
  roof.castShadow = true;
  group.add(roof);

  // 双开大门（朝 -Z）
  const doorMat = new THREE.MeshStandardMaterial({ color: '#c9b184', roughness: 0.7 });
  for (const side of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.2, 0.12), doorMat);
    door.position.set(side * 0.85, 1.6, D / 2 + 0.03);
    door.rotation.y = side * 0.22;
    door.castShadow = true;
    group.add(door);
  }
  // 门楣招牌
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 0.8),
    new THREE.MeshBasicMaterial({ map: makePostOfficeSign() })
  );
  sign.position.set(0, 3.65, D / 2 + 0.09);
  group.add(sign);

  // 投递窗口（带小遮檐）
  const windowFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 1.0, 0.1),
    new THREE.MeshStandardMaterial({ color: '#e6ddc8', roughness: 0.7 })
  );
  windowFrame.position.set(W / 2 + 0.02, 2.0, 0);
  windowFrame.rotation.y = Math.PI / 2;
  group.add(windowFrame);
  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.08, 1.0),
    new THREE.MeshStandardMaterial({ color: '#b5442f', roughness: 0.6 })
  );
  awning.position.set(W / 2 + 0.5, 2.6, 0);
  awning.rotation.z = -0.25;
  awning.castShadow = true;
  group.add(awning);

  // 屋顶烟囱/通风帽
  const vent = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.34, 1.0, 10),
    new THREE.MeshStandardMaterial({ color: '#4a525a', roughness: 0.5, metalness: 0.6 })
  );
  vent.position.set(W / 2 - 1.5, Hh + 0.7, D / 2 - 1.5);
  vent.castShadow = true;
  group.add(vent);

  // 邮筒（英式红圆柱）
  const box = new THREE.Group();
  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 1.35, 16),
    new THREE.MeshStandardMaterial({ color: '#b4261c', roughness: 0.42, metalness: 0.25 })
  );
  cylinder.position.y = 0.68;
  cylinder.castShadow = true;
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 16, 8, 0, TAU, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#b4261c', roughness: 0.42, metalness: 0.25 })
  );
  cap.position.y = 1.35;
  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.07, 0.06),
    new THREE.MeshStandardMaterial({ color: '#20242a', roughness: 0.8 })
  );
  slot.position.set(0, 1.02, 0.4);
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.42, 0.03),
    new THREE.MeshStandardMaterial({ map: makeRoyalPlate(), roughness: 0.5, metalness: 0.2 })
  );
  plate.position.set(0, 0.6, 0.41);
  box.add(cylinder, cap, slot, plate);
  box.position.set(W / 2 + 1.6, 0, D / 2 - 1.0);
  group.add(box);

  group.position.copy(position);
  group.rotation.y = yaw;
  scene.add(group);
  return { group, box };
}

function makePostOfficeSign() {
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 180;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2ead8';
  ctx.fillRect(0, 0, 768, 180);
  ctx.strokeStyle = '#b4261c';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 752, 164);
  ctx.fillStyle = '#b4261c';
  ctx.font = 'bold 88px "PingFang SC","Microsoft YaHei",serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('灯塔邮局', 384, 88);
  ctx.fillStyle = '#2b2f36';
  ctx.font = '30px Georgia, serif';
  ctx.fillText('CAPELIGHT POST · EST. 1904', 384, 150);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRoyalPlate() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 360;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#b4261c';
  ctx.fillRect(0, 0, 256, 360);
  ctx.fillStyle = '#f6ecd8';
  ctx.font = 'bold 30px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('POST', 128, 60);
  ctx.font = '18px Georgia, serif';
  ctx.fillText('CAPELIGHT', 128, 92);
  // 皇家冠徽的简化画法
  ctx.beginPath();
  ctx.moveTo(80, 150);
  ctx.lineTo(96, 108);
  ctx.lineTo(128, 140);
  ctx.lineTo(160, 108);
  ctx.lineTo(176, 150);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(76, 158, 104, 14);
  ctx.fillRect(70, 182, 116, 10);
  ctx.font = '16px Georgia, serif';
  ctx.fillText('CAPELIGHT', 128, 240);
  ctx.fillText('NO. 404', 128, 270);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 波纹铁皮贴图（法线感通过 bumpMap 实现，避免 onBeforeCompile） */
export function makeCorrugatedTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a949c';
  ctx.fillRect(0, 0, 256, 256);
  // 竖向波纹明暗
  for (let x = 0; x < 256; x++) {
    const w = 0.5 + 0.5 * Math.sin((x / 256) * TAU * 16);
    const g = Math.round(120 + w * 90);
    ctx.fillStyle = `rgb(${g},${g + 8},${g + 14})`;
    ctx.fillRect(x, 0, 1, 256);
  }
  // 锈斑
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = Math.random() * 6 + 1;
    ctx.fillStyle = `rgba(${120 + Math.random() * 60},${60 + Math.random() * 30},30,${Math.random() * 0.35})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1.4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}