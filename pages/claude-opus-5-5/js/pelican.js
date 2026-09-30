// 程序化鹈鹕：身体、S 形颈、大嘴与会晃的喉囊、翅膀 IK 握把、腿 IK 踩踏、飘动围巾
// 所有坐标均为自行车局部坐标（+X 前，+Y 上，+Z 左）
import * as THREE from 'three';
import { solveIK2, noise1, damp } from './helpers.js';

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

/** 让一个沿 Y 轴、单位长度的物体对齐 a→b，并尽量让其 Z 轴指向 hint */
function orientBone(obj, a, b, hint, thick = 1, wide = 1) {
  _y.subVectors(b, a); const len = _y.length(); _y.divideScalar(len || 1);
  _z.copy(hint).addScaledVector(_y, -hint.dot(_y)).normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(a).lerp(b, 0.5);
  obj.scale.set(wide, len, thick);
}

function featherGeo(len, width) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(width, len * 0.15, width * 0.9, len * 0.75, 0, len);
  s.bezierCurveTo(-width * 0.7, len * 0.75, -width * 0.8, len * 0.15, 0, 0);
  const g = new THREE.ShapeGeometry(s, 10);
  const pos = g.attributes.position; const col = [];
  const white = new THREE.Color(0xf6f2ea), black = new THREE.Color(0x1d1a1a), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / len;
    c.copy(white).lerp(black, THREE.MathUtils.smoothstep(t, 0.35, 0.6));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export function createPelican(bike) {
  const root = new THREE.Group(); root.name = 'pelican';

  // ---------- 材质 ----------
  const feather = new THREE.MeshPhysicalMaterial({ color: 0xf5f0e6, roughness: 0.78, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff) });
  const creamy = new THREE.MeshPhysicalMaterial({ color: 0xf8f0dc, roughness: 0.7, sheen: 1, sheenColor: new THREE.Color(0xfff2c6) });
  const beakMat = new THREE.MeshPhysicalMaterial({ color: 0xf07a12, roughness: 0.45, clearcoat: 0.25, clearcoatRoughness: 0.4 });
  const pouchMat = new THREE.MeshPhysicalMaterial({ color: 0xf09a50, roughness: 0.5, transmission: 0.15, thickness: 0.05, sheen: 0.5, sheenColor: new THREE.Color(0xffd0a0) });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf3b17a, roughness: 0.55 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0xf29a58, roughness: 0.5 });
  const featherTip = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.75, sheen: 0.6, side: THREE.DoubleSide });
  const eyeWhite = new THREE.MeshPhysicalMaterial({ color: 0xfff4c8, roughness: 0.1, clearcoat: 1 });
  const pupil = new THREE.MeshBasicMaterial({ color: 0x0c0c0c });
  const helmetMat = new THREE.MeshPhysicalMaterial({ color: 0xe8403a, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
  const scarfMat = new THREE.MeshStandardMaterial({ color: 0x3060e0, roughness: 0.8, side: THREE.DoubleSide });

  const unitSphere = new THREE.SphereGeometry(0.5, 28, 20);

  // ---------- 躯干组（整体上下起伏） ----------
  // 躯干绕髋部（座垫上方）摆动，而不是绕地面原点
  const PIVOT = V(-0.18, 1.05, 0);
  const torsoPivot = new THREE.Group(); torsoPivot.position.copy(PIVOT); root.add(torsoPivot);
  const SHIFT_X = -0.07; // 整体后移，确保坐在座垫上
  const torso = new THREE.Group(); torso.position.copy(PIVOT).negate().add(V(SHIFT_X, 0)); torsoPivot.add(torso);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), feather);
  body.scale.set(0.24, 0.33, 0.22); body.position.set(-0.13, 1.28, 0); body.rotation.z = -0.38;
  torso.add(body);
  // 臀部羽毛：盖住座垫，看起来真正坐在车座上
  const rump = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), feather);
  rump.scale.set(0.22, 0.13, 0.19); rump.position.set(-0.3, 1.07, 0); torso.add(rump);
  // 胸前的奶油色羽毛
  const chest = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), creamy);
  chest.scale.set(0.15, 0.22, 0.17); chest.position.set(0.0, 1.38, 0); chest.rotation.z = -0.5;
  torso.add(chest);
  // 尾羽
  for (let i = 0; i < 5; i++) {
    const t = new THREE.Mesh(unitSphere, i % 2 ? feather : creamy);
    t.scale.set(0.2, 0.05, 0.08); t.position.set(-0.36 - i * 0.01, 1.08 + i * 0.005, (i - 2) * 0.045);
    t.rotation.set(0, (i - 2) * 0.25, -0.35);
    torso.add(t);
  }

  // S 形脖子
  const neckCurve = new THREE.CatmullRomCurve3([V(-0.02, 1.5), V(0.07, 1.66), V(0.02, 1.8), V(0.06, 1.93), V(0.12, 1.99)]);
  const neckGeo = new THREE.TubeGeometry(neckCurve, 40, 1, 16);
  // 管半径沿长度变细
  { const p = neckGeo.attributes.position; const pts = neckCurve.getSpacedPoints(40);
    for (let i = 0; i < p.count; i++) {
      const ring = Math.floor(i / 17); const c = pts[Math.min(ring, 40)];
      const r = THREE.MathUtils.lerp(0.095, 0.058, ring / 40);
      _x.fromBufferAttribute(p, i).sub(c).normalize().multiplyScalar(r).add(c);
      p.setXYZ(i, _x.x, _x.y, _x.z);
    }
    neckGeo.computeVertexNormals(); }
  const neck = new THREE.Mesh(neckGeo, feather); torso.add(neck);

  // 围巾：绕脖子的环 + 飘带
  const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.028, 10, 24), scarfMat);
  scarfRing.position.set(0.03, 1.62, 0); scarfRing.rotation.set(Math.PI / 2, 0.35, 0); torso.add(scarfRing);
  const SEG = 24;
  const scarfGeo = new THREE.PlaneGeometry(1, 1, SEG, 2);
  const scarf = new THREE.Mesh(scarfGeo, scarfMat); scarf.frustumCulled = false; torso.add(scarf);
  const scarfAnchor = V(-0.05, 1.6, 0.02);

  // ---------- 头部 ----------
  const head = new THREE.Group(); head.position.set(0.13, 2.0, 0); torso.add(head);
  const skull = new THREE.Mesh(unitSphere, creamy); skull.scale.set(0.21, 0.17, 0.155); head.add(skull);
  // 头盔
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), helmetMat);
  helmet.scale.set(1.45, 0.9, 1.0); helmet.position.set(-0.035, 0.03, 0); helmet.rotation.z = -0.12; head.add(helmet);
  // 头盔条纹（贴合壳面的细环，代替突出的通风槽）
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.006, 6, 32, Math.PI), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
  stripe.scale.set(1.46, 0.91, 1.05); stripe.position.copy(helmet.position); stripe.rotation.set(0, 0, -0.12); head.add(stripe);
  // 眼睛（可眨眼）
  const eyes = [];
  for (const s of [1, -1]) {
    const ring = new THREE.Mesh(unitSphere, skinMat); ring.scale.set(0.055, 0.045, 0.02); ring.position.set(0.045, 0.015, 0.07 * s); head.add(ring);
    const eg = new THREE.Group(); eg.position.set(0.05, 0.018, 0.077 * s); head.add(eg);
    const ew = new THREE.Mesh(unitSphere, eyeWhite); ew.scale.setScalar(0.034); eg.add(ew);
    const pp = new THREE.Mesh(unitSphere, pupil); pp.scale.setScalar(0.016); pp.position.set(0.007, 0, 0.01 * s); eg.add(pp);
    const hl = new THREE.Mesh(unitSphere, new THREE.MeshBasicMaterial({ color: 0xffffff })); hl.scale.setScalar(0.005); hl.position.set(0.012, 0.006, 0.016 * s); eg.add(hl);
    eyes.push(eg);
  }
  // 嘴：上喙 + 下喙/喉囊（可张开）
  const beak = new THREE.Group(); beak.position.set(0.08, -0.02, 0); beak.rotation.z = -0.28; head.add(beak);
  const upperGeo = new THREE.CylinderGeometry(0.018, 0.04, 0.46, 16, 6); upperGeo.rotateZ(-Math.PI / 2); upperGeo.translate(0.23, 0, 0);
  upperGeo.scale(1, 0.55, 1);
  const upper = new THREE.Mesh(upperGeo, beakMat); beak.add(upper);
  // 喙尖的小钩：向下弯的短锥
  const hook = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.03, 10), beakMat);
  hook.position.set(0.455, -0.004, 0); hook.rotation.z = -Math.PI / 2 - 0.5; hook.scale.set(1, 0.7, 1); beak.add(hook);
  const lower = new THREE.Group(); beak.add(lower);
  const lowerJaw = new THREE.Mesh(upperGeo, beakMat); lowerJaw.scale.set(0.97, 0.6, 0.9); lowerJaw.position.y = -0.02; lower.add(lowerJaw);
  const pouch = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58), pouchMat);
  pouch.scale.set(0.19, 0.1, 0.045); pouch.position.set(0.19, -0.02, 0); lower.add(pouch);

  // ---------- 翅膀 ----------
  function makeWing(side) {
    const w = { side, parts: [] };
    w.upper = new THREE.Mesh(unitSphere, feather); w.fore = new THREE.Mesh(unitSphere, feather);
    w.hand = new THREE.Mesh(unitSphere, feather);
    root.add(w.upper, w.fore, w.hand);
    // 飞羽挂在前臂上
    w.featherGroup = new THREE.Group(); root.add(w.featherGroup);
    w.feathers = [];
    for (let i = 0; i < 9; i++) {
      const f = new THREE.Mesh(featherGeo(0.22 + i * 0.012, 0.04), featherTip);
      f.castShadow = true;
      w.featherGroup.add(f); w.feathers.push(f);
    }
    return w;
  }
  const wings = [makeWing(1), makeWing(-1)];
  const SH_L1 = 0.33, SH_L2 = 0.32;

  // ---------- 腿 ----------
  function makeLeg(side) {
    const l = { side };
    l.thigh = new THREE.Mesh(unitSphere, feather);
    l.shin = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 10), legMat);
    l.knee = new THREE.Mesh(unitSphere, legMat); l.knee.scale.setScalar(0.05);
    // 蹼足
    l.foot = new THREE.Group();
    const web = new THREE.Shape(); web.moveTo(-0.03, 0); web.lineTo(0.13, 0.06); web.quadraticCurveTo(0.12, 0, 0.14, -0.005); web.quadraticCurveTo(0.12, -0.02, 0.13, -0.06); web.lineTo(-0.03, 0);
    const wg = new THREE.ExtrudeGeometry(web, { depth: 0.008, bevelEnabled: false }); wg.rotateX(-Math.PI / 2);
    const webMesh = new THREE.Mesh(wg, legMat); l.foot.add(webMesh);
    for (const z of [-0.055, 0, 0.055]) {
      const toe = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.01, 0.15, 6), legMat);
      toe.rotation.z = -Math.PI / 2; toe.rotation.y = -z * 3; toe.position.set(0.055, 0.006, z * 0.55); l.foot.add(toe);
    }
    root.add(l.thigh, l.shin, l.knee, l.foot);
    return l;
  }
  const legs = [makeLeg(1), makeLeg(-1)];
  const LEG_L1 = 0.5, LEG_L2 = 0.47;

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scarf.receiveShadow = false;

  // ---------- 状态 ----------
  const st = { t: 0, blink: 0, nextBlink: 2, pouchY: 0, pouchV: 0, squawk: 0, lookYaw: 0, lookPitch: 0, flap: 0 };
  const tmp = { sh: V(0, 0), grip: V(0, 0), elbow: V(0, 0), hip: V(0, 0), knee: V(0, 0), ankle: V(0, 0), hint: V(0, 0) };
  const shoulderLocal = [V(-0.03, 1.46, 0.2), V(-0.03, 1.46, -0.2)];
  const hipLocal = [V(-0.18, 1.08, 0.12), V(-0.18, 1.08, -0.12)];

  function updateScarf(speed, time) {
    const p = scarfGeo.attributes.position;
    const len = 0.55 + Math.min(speed, 10) * 0.03;
    const wind = Math.min(speed / 6, 1.6);
    for (let j = 0; j <= 2; j++) for (let i = 0; i <= SEG; i++) {
      const idx = j * (SEG + 1) + i; const t = i / SEG;
      const wave = Math.sin(t * 9 - time * (6 + speed * 1.4)) * 0.05 * t * (0.4 + wind);
      const droop = (1 - Math.min(wind, 1)) * t * t * 0.45;
      const x = scarfAnchor.x - t * len;
      const y = scarfAnchor.y - droop + wave + t * 0.05 * wind;
      const z = scarfAnchor.z + (j - 1) * 0.055 * (1 - t * 0.1) + Math.sin(t * 5 - time * 5) * 0.04 * t;
      p.setXYZ(idx, x, y, z);
    }
    p.needsUpdate = true; scarfGeo.computeVertexNormals();
  }

  return {
    root, head, beak, pouch,
    /** 点击后张嘴大叫 */
    squawk() { st.squawk = 1; st.pouchV += 3; st.flap = 1; },
    /**
     * @param crankAngle 曲柄角
     * @param speed m/s
     * @param dt 秒
     * @param lookTarget 头部想看向的点（自行车局部坐标，可空）
     */
    update(crankAngle, speed, dt, lookTarget) {
      st.t += dt; const time = st.t;
      // 躯干起伏与左右摇摆（跟随踏频）
      const effort = THREE.MathUtils.clamp(speed / 8, 0, 1.2);
      torsoPivot.position.y = PIVOT.y + Math.abs(Math.sin(crankAngle)) * 0.018 * (0.4 + effort) + Math.sin(time * 1.3) * 0.004;
      torsoPivot.rotation.x = Math.sin(crankAngle) * 0.035 * (0.3 + effort);
      torsoPivot.rotation.z = -0.02 - effort * 0.06; // 速度越快越前倾
      // 头部：反相点头 + 四处张望
      let yaw = (noise1(time * 0.25, 3) - 0.5) * 1.2, pitch = (noise1(time * 0.4, 7) - 0.5) * 0.25;
      if (lookTarget) {
        const d = lookTarget.clone().sub(V(0.13, 2.0, 0));
        yaw = -THREE.MathUtils.clamp(Math.atan2(d.z, d.x), -1.1, 1.1); // 朝向目标（绕 Y 正转会让 +X 转向 -Z）
        pitch = THREE.MathUtils.clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.4, 0.4);
      }
      st.lookYaw = damp(st.lookYaw, yaw, 3, dt); st.lookPitch = damp(st.lookPitch, pitch, 3, dt);
      head.rotation.y = st.lookYaw;
      head.rotation.z = st.lookPitch + Math.sin(crankAngle * 2) * 0.04 * effort;
      head.position.y = 2.0 - Math.abs(Math.sin(crankAngle)) * 0.012;
      // 眨眼
      st.nextBlink -= dt;
      if (st.nextBlink < 0) { st.blink = 0.15; st.nextBlink = 1.5 + Math.random() * 3.5; }
      if (st.blink > 0) st.blink -= dt;
      const eyeS = st.blink > 0 ? 0.15 : 1;
      eyes.forEach((e) => { e.scale.y = damp(e.scale.y, eyeS, 40, dt); });
      // 喉囊弹簧（受竖直加速度与叫声激励）
      const k = 60, c = 6;
      const excite = -Math.cos(crankAngle * 2) * effort * 0.6;
      st.pouchV += (-k * st.pouchY - c * st.pouchV + excite * 8) * dt;
      st.pouchY += st.pouchV * dt;
      pouch.scale.y = 0.1 * (1 + st.pouchY * 0.35);
      pouch.scale.x = 0.19 * (1 - st.pouchY * 0.06);
      // 大叫：张嘴
      if (st.squawk > 0) st.squawk = Math.max(0, st.squawk - dt * 1.1);
      lower.rotation.z = -Math.sin(Math.min(st.squawk, 1) * Math.PI) * 0.55 - Math.max(0, Math.sin(time * 0.7) - 0.97) * 4;
      if (st.flap > 0) st.flap = Math.max(0, st.flap - dt * 0.9);

      updateScarf(speed, time);

      torsoPivot.updateMatrix(); torso.updateMatrix();
      const torsoM = new THREE.Matrix4().multiplyMatrices(torsoPivot.matrix, torso.matrix);
      // 翅膀 IK：肩 → 肘 → 车把
      wings.forEach((w, i) => {
        const side = w.side;
        tmp.sh.copy(shoulderLocal[i]).applyMatrix4(torsoM);
        bike.getGrip(side > 0 ? 'left' : 'right', tmp.grip);
        // 大叫时短暂张开翅膀离开车把
        if (st.flap > 0) { const f = Math.sin(st.flap * Math.PI); tmp.grip.lerp(V(tmp.sh.x - 0.1, tmp.sh.y + 0.35 + Math.sin(time * 30) * 0.08, tmp.sh.z + side * 0.55), f); }
        tmp.hint.set(-0.4, 0.4, side * 1);
        solveIK2(tmp.sh, tmp.grip, SH_L1, SH_L2, tmp.hint, tmp.elbow);
        const planeN = V(0, 0.3, side).normalize();
        orientBone(w.upper, tmp.sh, tmp.elbow, planeN, 0.07, 0.15);
        orientBone(w.fore, tmp.elbow, tmp.grip, planeN, 0.06, 0.11);
        w.hand.position.copy(tmp.grip); w.hand.scale.set(0.09, 0.075, 0.085);
        // 飞羽：沿前臂与上臂排布，向后下方垂落并随风抖动
        w.featherGroup.position.set(0, 0, 0);
        w.feathers.forEach((f, j) => {
          const t = j / (w.feathers.length - 1);
          const onFore = t > 0.4;
          const base = onFore ? tmp.elbow.clone().lerp(tmp.grip, (t - 0.4) / 0.6 * 0.95) : tmp.sh.clone().lerp(tmp.elbow, t / 0.4);
          const flutter = Math.sin(time * (8 + speed) + j) * 0.05 * (0.3 + effort);
          const dir = V(-0.85, -0.45 + flutter + (st.flap > 0 ? Math.sin(st.flap * Math.PI) * 0.8 : 0), side * 0.12).normalize();
          f.position.copy(base).add(V(0, 0, side * 0.012));
          // feather 局部 +Y 指向 dir，平面法线大致朝外侧
          _y.copy(dir); _z.set(0, 0, side).addScaledVector(_y, -_y.z * side).normalize(); _x.crossVectors(_y, _z);
          _m.makeBasis(_x, _y, _z); f.quaternion.setFromRotationMatrix(_m);
        });
      });

      // 腿 IK：髋 → 膝 → 脚踏
      const pedals = bike.getPedals();
      legs.forEach((l, i) => {
        tmp.hip.copy(hipLocal[i]).applyMatrix4(torsoM);
        const pedal = l.side > 0 ? pedals.left : pedals.right;
        tmp.ankle.copy(pedal).add(V(-0.03, 0.03, 0));
        tmp.hint.set(1, 0.25, l.side * 0.12);
        solveIK2(tmp.hip, tmp.ankle, LEG_L1, LEG_L2, tmp.hint, tmp.knee);
        // 大腿（羽毛包裹，较粗）
        orientBone(l.thigh, tmp.hip, tmp.knee, V(0, 0, 1), 0.13, 0.14);
        l.thigh.scale.y *= 1.1;
        orientBone(l.shin, tmp.knee, tmp.ankle, V(0, 0, 1), 0.035, 0.035);
        l.knee.position.copy(tmp.knee);
        l.foot.position.copy(pedal).add(V(-0.02, 0.012, 0));
        l.foot.rotation.z = Math.sin(crankAngle + (l.side > 0 ? Math.PI : 0)) * 0.15; // 踝关节微调
      });
    },
  };
}
