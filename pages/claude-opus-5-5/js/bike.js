// 程序化自行车：车架、可转向前叉、辐条轮、牙盘链条、车篮与小鱼、车灯
// 坐标：+X 前进方向，+Y 向上，+Z 为车的左侧
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tubeBetween } from './helpers.js';

export const WHEEL_R = 0.34;
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

export function createBike() {
  const root = new THREE.Group();
  root.name = 'bike';

  // ---------- 材质 ----------
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x1f8a8a, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdadfe6, metalness: 1, roughness: 0.14 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.92 });
  const leather = new THREE.MeshPhysicalMaterial({ color: 0x7a4526, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(0xffc9a0) });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.7, roughness: 0.4 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xffcf4a, metalness: 1, roughness: 0.22 });

  // ---------- 关键点 ----------
  const rearAxle = V(-0.52, WHEEL_R), frontAxle = V(0.52, WHEEL_R);
  const bb = V(0, 0.3);
  const seatTop = V(-0.19, 0.84);
  const axis = V(-0.12, 0.5).normalize();        // 转向轴（从前轴指向车把）
  const headBottom = frontAxle.clone().addScaledVector(axis, 0.37);
  const headTop = frontAxle.clone().addScaledVector(axis, 0.53);

  // ---------- 车架 ----------
  const frame = new THREE.Group();
  const tube = (a, b, r = 0.022) => frame.add(tubeBetween(a, b, r, paint, 14));
  tube(bb, seatTop, 0.024);                                            // 立管
  tube(bb, headBottom, 0.028);                                         // 下管
  tube(seatTop.clone().lerp(bb, 0.08), headTop.clone().lerp(headBottom, 0.35), 0.022); // 上管
  tube(headBottom, headTop, 0.032);                                    // 头管
  for (const s of [1, -1]) {
    tube(V(bb.x, bb.y, 0.03 * s), V(rearAxle.x, rearAxle.y, 0.055 * s), 0.013);            // 后下叉
    tube(V(seatTop.x + 0.02, seatTop.y - 0.07, 0.02 * s), V(rearAxle.x, rearAxle.y, 0.055 * s), 0.012); // 后上叉
  }
  // 五通
  const bbShell = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.08, 18), paint);
  bbShell.rotation.x = Math.PI / 2; bbShell.position.copy(bb); frame.add(bbShell);
  root.add(frame);

  // ---------- 座管与座垫 ----------
  const seatPost = tubeBetween(seatTop, seatTop.clone().addScaledVector(seatTop.clone().sub(bb).normalize(), 0.1), 0.014, chrome);
  root.add(seatPost);
  const saddleShape = new THREE.Shape();
  saddleShape.moveTo(-0.13, 0.075); saddleShape.bezierCurveTo(0.0, 0.1, 0.05, 0.04, 0.14, 0.022);
  saddleShape.lineTo(0.14, -0.022); saddleShape.bezierCurveTo(0.05, -0.04, 0.0, -0.1, -0.13, -0.075);
  saddleShape.quadraticCurveTo(-0.16, 0, -0.13, 0.075);
  const saddleGeo = new THREE.ExtrudeGeometry(saddleShape, { depth: 0.035, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 4, curveSegments: 18 });
  saddleGeo.rotateX(Math.PI / 2);
  const saddle = new THREE.Mesh(saddleGeo, leather);
  const seatPos = seatTop.clone().addScaledVector(seatTop.clone().sub(bb).normalize(), 0.1);
  saddle.position.set(seatPos.x - 0.02, seatPos.y + 0.045, 0);
  saddle.castShadow = true; root.add(saddle);

  // ---------- 车轮 ----------
  function makeWheel() {
    const g = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.018, 0.02, 14, 64), rubber);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.04, 0.009, 8, 64), chrome);
    tire.castShadow = true;
    g.add(tire, rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 16), chrome);
    hub.rotation.x = Math.PI / 2; g.add(hub);
    // 辐条：合并成一个几何体
    const spokes = [];
    const N = 28;
    for (let i = 0; i < N; i++) {
      const side = i % 2 ? 1 : -1;
      const a = (i / N) * Math.PI * 2;
      const a2 = a + side * 0.18;
      const p1 = V(Math.cos(a2) * 0.02, Math.sin(a2) * 0.02, 0.045 * side);
      const p2 = V(Math.cos(a) * (WHEEL_R - 0.045), Math.sin(a) * (WHEEL_R - 0.045), 0.004 * side);
      const len = p1.distanceTo(p2);
      const sg = new THREE.CylinderGeometry(0.0022, 0.0022, len, 4, 1);
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), p2.clone().sub(p1).normalize());
      sg.applyQuaternion(q); const mid = p1.clone().add(p2).multiplyScalar(0.5);
      sg.translate(mid.x, mid.y, mid.z);
      spokes.push(sg);
    }
    g.add(new THREE.Mesh(mergeGeometries(spokes), chrome));
    // 高速时的“动态模糊”圆盘
    const blur = new THREE.Mesh(new THREE.CircleGeometry(WHEEL_R - 0.045, 40),
      new THREE.MeshBasicMaterial({ color: 0xc8ccd4, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    g.add(blur);
    g.userData.blur = blur;
    return g;
  }
  const rearWheel = makeWheel(); rearWheel.position.copy(rearAxle); root.add(rearWheel);

  // ---------- 转向组件（前叉、前轮、车把、车篮、车灯） ----------
  const steer = new THREE.Group();
  steer.position.copy(headBottom);
  root.add(steer);
  const L = (v) => v.clone().sub(headBottom); // 转为 steer 局部坐标
  for (const s of [1, -1]) steer.add(tubeBetween(L(V(headBottom.x, headBottom.y, 0.045 * s)), L(V(frontAxle.x, frontAxle.y, 0.052 * s)), 0.014, chrome));
  const crown = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.12), chrome); crown.position.set(0, -0.005, 0); steer.add(crown);
  const frontWheel = makeWheel(); frontWheel.position.copy(L(frontAxle)); steer.add(frontWheel);

  const stemTop = headTop.clone().addScaledVector(axis, 0.07);
  steer.add(tubeBetween(L(headTop), L(stemTop), 0.016, chrome));
  const barC = stemTop.clone().add(V(0.06, 0.02));
  steer.add(tubeBetween(L(stemTop), L(barC), 0.014, chrome));
  // 复古弯把：左右各一段向后弯
  const gripL = V(barC.x - 0.12, barC.y + 0.03, 0.26), gripR = V(barC.x - 0.12, barC.y + 0.03, -0.26);
  for (const [grip, s] of [[gripL, 1], [gripR, -1]]) {
    const curve = new THREE.CatmullRomCurve3([L(barC), L(V(barC.x + 0.01, barC.y + 0.005, 0.12 * s)), L(V(barC.x - 0.05, barC.y + 0.02, 0.22 * s)), L(grip)]);
    const bar = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.012, 8), chrome); bar.castShadow = true; steer.add(bar);
    const g = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 12), rubber);
    const gEnd = grip.clone().add(V(-0.09, 0, 0.01 * s));
    const gm = tubeBetween(L(grip), L(gEnd), 0.018, rubber); steer.add(gm);
    g.geometry.dispose();
  }
  const gripLocal = { left: L(gripL.clone().add(V(-0.04, 0.012, 0.005))), right: L(gripR.clone().add(V(-0.04, 0.012, -0.005))) };

  // 车铃
  const bell = new THREE.Group();
  const bellDome = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  const bellBase = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 20), chrome);
  bell.add(bellDome, bellBase);
  bell.position.copy(L(V(barC.x - 0.02, barC.y + 0.03, 0.13)));
  steer.add(bell);

  // 车灯 + 聚光灯
  const lampBody = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.06, 18), chrome);
  lampBody.rotation.z = Math.PI / 2;
  const lampPos = L(V(headTop.x + 0.07, headTop.y - 0.05, 0));
  lampBody.position.copy(lampPos);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff1c0, emissiveIntensity: 0.2 });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 18), lensMat);
  lens.rotation.y = Math.PI / 2; lens.position.copy(lampPos).add(V(0.031, 0, 0));
  steer.add(lampBody, lens);
  const spot = new THREE.SpotLight(0xffeecc, 0, 14, 0.5, 0.55, 1.4);
  spot.position.copy(lampPos).add(V(0.04, 0, 0));
  spot.target.position.copy(lampPos).add(V(3, -0.9, 0));
  steer.add(spot, spot.target);

  // 车篮 + 小鱼
  const basket = new THREE.Group();
  const weave = makeWeaveTexture();
  const basketMat = new THREE.MeshStandardMaterial({ map: weave, alphaMap: weave, alphaTest: 0.35, color: 0xd9a55b, roughness: 0.85, side: THREE.DoubleSide });
  const bw = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.17, 24, 1, true), basketMat);
  bw.castShadow = true;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), new THREE.MeshStandardMaterial({ color: 0xa8743a, roughness: 0.9 }));
  bottom.rotation.x = -Math.PI / 2; bottom.position.y = -0.085;
  const rimB = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.01, 8, 32), new THREE.MeshStandardMaterial({ color: 0x9c6a33, roughness: 0.8 }));
  rimB.rotation.x = Math.PI / 2; rimB.position.y = 0.085;
  basket.add(bw, bottom, rimB);
  const fishes = [];
  const fishMat = new THREE.MeshPhysicalMaterial({ color: 0x8fb4d6, metalness: 0.6, roughness: 0.25, iridescence: 1, iridescenceIOR: 1.6 });
  for (let i = 0; i < 3; i++) {
    const f = makeFish(fishMat);
    f.position.set((i - 1) * 0.06, 0.07 + (i % 2) * 0.03, (i - 1) * 0.04);
    f.rotation.set(-0.9 + i * 0.5, i * 1.3, Math.PI / 2 - 0.3 + i * 0.3);
    basket.add(f); fishes.push(f);
  }
  basket.position.copy(L(V(barC.x + 0.17, barC.y - 0.11, 0)));
  steer.add(basket);
  // 车篮支架
  steer.add(tubeBetween(L(V(barC.x + 0.1, barC.y - 0.18, 0)), L(V(frontAxle.x + 0.02, frontAxle.y + 0.02, 0.04)), 0.006, chrome));
  steer.add(tubeBetween(L(V(barC.x + 0.1, barC.y - 0.18, 0)), L(V(frontAxle.x + 0.02, frontAxle.y + 0.02, -0.04)), 0.006, chrome));

  // ---------- 牙盘、曲柄、脚踏 ----------
  const CRANK = 0.17;
  const crank = new THREE.Group(); crank.position.copy(bb); root.add(crank);
  const ring = new THREE.Mesh(makeChainringGeo(0.1, 36), chrome); ring.position.z = -0.065; crank.add(ring);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(CRANK, 0.022, 0.014), dark); armR.position.set(CRANK / 2, 0, -0.085); crank.add(armR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(CRANK, 0.022, 0.014), dark); armL.position.set(-CRANK / 2, 0, 0.085); crank.add(armL);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.19, 10), chrome); axle.rotation.x = Math.PI / 2; crank.add(axle);
  const pedalGeo = new THREE.BoxGeometry(0.1, 0.018, 0.075);
  const pedalR = new THREE.Mesh(pedalGeo, dark), pedalL = new THREE.Mesh(pedalGeo, dark);
  pedalR.castShadow = pedalL.castShadow = true;
  root.add(pedalR, pedalL);
  const cog = new THREE.Mesh(makeChainringGeo(0.04, 14), chrome); cog.position.set(rearAxle.x, rearAxle.y, -0.065); root.add(cog);

  // 链条：沿闭合路径的管子，用滚动纹理模拟链节运动
  const chainTex = makeChainTexture();
  const chainMat = new THREE.MeshStandardMaterial({ map: chainTex, metalness: 0.8, roughness: 0.4 });
  const chainPath = makeChainPath(V(bb.x, bb.y, -0.065), 0.1, V(rearAxle.x, rearAxle.y, -0.065), 0.04);
  const chain = new THREE.Mesh(new THREE.TubeGeometry(chainPath, 200, 0.006, 5, true), chainMat);
  root.add(chain);
  const chainLen = chainPath.getLength();
  chainTex.repeat.set(Math.round(chainLen / 0.0127), 1);

  // 后反光片
  const refl = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.04, 0.06), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 0.3 }));
  refl.position.set(seatTop.x - 0.07, seatTop.y - 0.1, 0); root.add(refl);

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  frame.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });

  const pedals = { left: new THREE.Vector3(), right: new THREE.Vector3() };
  let bellT = 0;

  return {
    root, steer, frontWheel, rearWheel, fishes, bell, spot, lensMat, refl,
    headAxis: axis,
    crankLen: CRANK,
    seatPos: saddle.position.clone(),
    /** 每帧更新：轮转角、曲柄角、转向角 */
    update(wheelAngle, crankAngle, steerAngle, speed, night, dt) {
      rearWheel.rotation.z = -wheelAngle;
      frontWheel.rotation.z = -wheelAngle;
      const blurO = THREE.MathUtils.clamp((speed - 3) / 9, 0, 0.55);
      rearWheel.userData.blur.material.opacity = blurO;
      frontWheel.userData.blur.material.opacity = blurO;
      steer.quaternion.setFromAxisAngle(axis, steerAngle);
      crank.rotation.z = -crankAngle;
      cog.rotation.z = -wheelAngle;
      chainTex.offset.x = -(crankAngle * 0.1) / chainLen * chainTex.repeat.x;
      // 脚踏位置（始终保持水平）
      const a = -crankAngle;
      pedals.right.set(bb.x + Math.cos(a) * CRANK, bb.y + Math.sin(a) * CRANK, -0.13);
      pedals.left.set(bb.x - Math.cos(a) * CRANK, bb.y - Math.sin(a) * CRANK, 0.13);
      pedalR.position.copy(pedals.right); pedalL.position.copy(pedals.left);
      // 车灯
      spot.intensity = night * 18;
      lensMat.emissiveIntensity = 0.2 + night * 6;
      refl.material.emissiveIntensity = 0.3 + night * 3;
      // 车铃摆动
      if (bellT > 0) { bellT = Math.max(0, bellT - dt); bell.rotation.x = Math.sin(bellT * 60) * bellT * 0.8; }
      // 小鱼轻轻跳动
      fishes.forEach((f, i) => { f.position.y = 0.07 + (i % 2) * 0.03 + Math.max(0, Math.sin(performance.now() * 0.012 + i * 2)) * 0.012 * Math.min(speed, 6) / 6; });
    },
    ringBell() { bellT = 0.6; },
    getPedals() { return pedals; },
    /** 车把握点（bike 局部坐标，随转向变化） */
    getGrip(side, out) {
      return out.copy(gripLocal[side]).applyQuaternion(steer.quaternion).add(steer.position);
    },
  };
}

function makeChainringGeo(r, teeth) {
  const s = new THREE.Shape();
  for (let i = 0; i <= teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 ? r : r + 0.008;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const hole = new THREE.Path();
  for (let i = 0; i <= 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    if (i === 0) hole.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6); else hole.lineTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
  }
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: false });
  g.translate(0, 0, -0.0025);
  return g;
}

function makeChainPath(c1, r1, c2, r2) {
  // 两圆的外公切线闭合路径（在 z 平面上）
  const pts = [];
  const d = c2.clone().sub(c1); const dist = d.length(); const base = Math.atan2(d.y, d.x);
  const phi = Math.acos((r1 - r2) / dist);
  // 大圆：从 base+phi 经过远离小圆的一侧转到 base-phi
  const n = 40;
  for (let i = 0; i <= n; i++) { const a = base + phi + (i / n) * (Math.PI * 2 - 2 * phi); pts.push(new THREE.Vector3(c1.x + Math.cos(a) * r1, c1.y + Math.sin(a) * r1, c1.z)); }
  for (let i = 0; i <= 16; i++) { const a = base - phi + (i / 16) * (2 * phi); pts.push(new THREE.Vector3(c2.x + Math.cos(a) * r2, c2.y + Math.sin(a) * r2, c2.z)); }
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

function makeChainTexture() {
  const c = document.createElement('canvas'); c.width = 32; c.height = 8;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3a3e'; g.fillRect(0, 0, 32, 8);
  g.fillStyle = '#b8bcc4'; g.fillRect(2, 1, 12, 6); g.fillStyle = '#6c7078'; g.fillRect(18, 2, 12, 4);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeWeaveTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const on = (x + y) % 2 === 0;
    g.fillStyle = on ? '#fff' : '#bbb';
    g.fillRect(x * 16 + 1, y * 16 + (on ? 2 : 4), 14, on ? 12 : 8);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 1);
  return t;
}

function makeFish(mat) {
  const f = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 10), mat);
  body.scale.set(2.6, 1, 0.55); f.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 3), mat);
  tail.rotation.z = Math.PI / 2; tail.scale.set(1, 1, 0.3); tail.position.x = -0.09; f.add(tail);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  eye.position.set(0.055, 0.008, 0.014); f.add(eye);
  f.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return f;
}
