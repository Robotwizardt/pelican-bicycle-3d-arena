// 程序化自行车 + 鹈鹕骑手
// 骑行几何常量：轮半径 0.42，牙盘半径 0.11，故齿比 ≈ 3.82
import * as THREE from 'three';
import { Skinned, Limb, boxFromMesh } from './vertexAnim.js';
import { Assets } from './textures.js';
import { BoardTopY, LaneX } from './world.js';

const WHEEL_R = 0.42;
const CHAINRING_R = 0.11;
const GEAR = WHEEL_R / CHAINRING_R; // ≈3.82

const V = {
  a: new THREE.Vector3(), b: new THREE.Vector3(),
  q: new THREE.Quaternion(), e: new THREE.Euler(),
  m: new THREE.Matrix4(), s: new THREE.Vector3(1, 1, 1),
};

const MAT = {
  frame:  new THREE.MeshStandardMaterial({ color: '#d64545', roughness: 0.35, metalness: 0.65 }),
  dark:   new THREE.MeshStandardMaterial({ color: '#22262b', roughness: 0.7, metalness: 0.2 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#c9d2d8', roughness: 0.18, metalness: 0.95 }),
  tire:   new THREE.MeshStandardMaterial({ color: '#1b1d20', roughness: 0.95 }),
  saddle: new THREE.MeshStandardMaterial({ color: '#5a3a22', roughness: 0.6 }),
  pedal:  new THREE.MeshStandardMaterial({ color: '#2c2f33', roughness: 0.5, metalness: 0.4 }),
  feather:new THREE.MeshStandardMaterial({ color: '#f3efe6', roughness: 0.9 }),
  bodyW:  new THREE.MeshStandardMaterial({ color: '#efe9dc', roughness: 0.85 }),
  darkW:  new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.8 }),
  beak:   new THREE.MeshStandardMaterial({ color: '#f2a33c', roughness: 0.55 }),
  leg:    new THREE.MeshStandardMaterial({ color: '#e08b4e', roughness: 0.7 }),
  eye:    new THREE.MeshStandardMaterial({ color: '#101216', roughness: 0.25 }),
  cap:    new THREE.MeshStandardMaterial({ color: '#2f6f8f', roughness: 0.7 }),
  scarf:  new THREE.MeshStandardMaterial({ color: '#e2574c', roughness: 0.8 }),
};

function cylBetween(p1, p2, r, mat, seg = 10) {
  V.a.copy(p2).sub(p1);
  const len = V.a.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), V.a.normalize());
  mesh.castShadow = true;
  return mesh;
}
const P = (x, y, z) => new THREE.Vector3(x, y, z);

export class PelicanBicycle {
  constructor(scene) {
    this.root = new THREE.Group();          // 位于车道中线上
    this.root.position.set(LaneX, BoardTopY, 0);
    scene.add(this.root);
    this.group = new THREE.Group();         // 转向时整个车身偏航
    this.root.add(this.group);

    this.distance = 0;
    this.speed = 5;
    this.targetSpeed = 5;
    this.wheelAngle = 0;
    this.crankAngle = 0;
    this.steer = 0;
    this.bobPhase = 0;
    this._prevCrank = 0;
    this.onBell = null;

    this._buildBicycle();
    this._buildPelican();
    this._buildScarf();
  }

  _buildBicycle() {
    const g = new THREE.Group();
    this.group.add(g);
    this.bike = g;

    const rearHub = P(0, WHEEL_R, -0.68);
    const frontHub = P(0, WHEEL_R, 0.68);
    const bb      = P(0, 0.42, -0.02);
    const seatTop = P(0, 0.95, -0.32);
    const headTop = P(0, 0.98, 0.44);

    // 轮子
    this.wheels = [];
    for (const hub of [rearHub, frontHub]) {
      const w = new THREE.Group();
      w.position.copy(hub);
      const tire = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.045, 0.05, 12, 28), MAT.tire);
      const rim  = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.1, 0.018, 8, 24), MAT.chrome);
      tire.castShadow = true;
      w.add(tire, rim);
      // 辐条
      const spokeGeo = new THREE.CylinderGeometry(0.006, 0.006, WHEEL_R - 0.09, 4);
      for (let i = 0; i < 8; i++) {
        const sp = new THREE.Mesh(spokeGeo, MAT.chrome);
        sp.rotation.z = (i / 8) * Math.PI * 2;
        sp.position.set(Math.sin(sp.rotation.z) * (WHEEL_R - 0.09) / 2,
                        Math.cos(sp.rotation.z) * (WHEEL_R - 0.09) / 2, 0);
        w.add(sp);
      }
      g.add(w);
      this.wheels.push(w);
    }

    // 车架管件
    const tube = (a, b, r = 0.032) => g.add(cylBetween(a, b, r, MAT.frame, 12));
    tube(bb, seatTop);            // 座管立
    tube(bb, headTop);            // 下管
    tube(seatTop, headTop);       // 上管
    tube(bb, rearHub);            // 后下叉
    tube(seatTop, rearHub);       // 后上叉
    g.add(cylBetween(headTop, frontHub, 0.03, MAT.frame, 12)); // 前叉

    // 座垫
    const saddle = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), MAT.saddle);
    saddle.scale.set(0.7, 0.35, 1.5);
    saddle.position.set(0, 1.0, -0.33);
    saddle.castShadow = true;
    g.add(saddle);

    // 车把
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.56, 10), MAT.chrome);
    bar.rotation.z = Math.PI / 2;
    bar.position.copy(headTop).add(P(0, 0.08, -0.02));
    bar.castShadow = true;
    g.add(bar);
    for (const sx of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.14, 10), MAT.dark);
      grip.rotation.z = Math.PI / 2;
      grip.position.set(sx * 0.27, headTop.y + 0.08, headTop.z - 0.02);
      g.add(grip);
    }
    this.handlebarY = headTop.y + 0.08;

    // 牙盘 + 链条
    const ring = new THREE.Mesh(new THREE.TorusGeometry(CHAINRING_R, 0.014, 8, 24), MAT.dark);
    ring.position.copy(bb);
    g.add(ring);
    this.crank = new THREE.Group();
    this.crank.position.copy(bb);
    g.add(this.crank);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, CHAINRING_R * 2 + 0.1, 0.03), MAT.chrome);
      arm.position.set(sx * 0.05, 0, 0);
      this.crank.add(arm);
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.1), MAT.pedal);
      pedal.position.set(sx * 0.1, -sx * (CHAINRING_R + 0.05), 0);
      pedal.castShadow = true;
      this.crank.add(pedal);
      if (sx > 0) this.pedalR = pedal; else this.pedalL = pedal;
    }

    // 辐条状脚踏轨迹参考点（鹈鹕脚所在处）
    this.footOffset = CHAINRING_R + 0.05;
  }

  _buildPelican() {
    // 在装配坐标系里摆好各部件（车已朝 +z），逐段注册为蒙皮肢体
    this.limbs = [];
    this.skinSources = []; // 仅用于量尺寸，稍后统一移除
    this.pelican = new THREE.Group();
    this.group.add(this.pelican);

    const reg = (mesh, pivot, weight = 1) => {
      const { box, geometry } = boxFromMesh(mesh);
      this.limbs.push({ geometry, limb: new Limb(box, pivot, weight) });
      this.skinSources.push(mesh);
    };
    const add = (mesh) => this.pelican.add(mesh);

    // —— 身体（前倾） ——
    this.bodyGroup = new THREE.Group();
    this.bodyGroup.position.set(0, 1.08, -0.3);
    this.bodyGroup.rotation.x = 0.5;
    this.pelican.add(this.bodyGroup);

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 16), MAT.bodyW);
    body.scale.set(0.95, 1.15, 1.5);
    body.castShadow = true;
    this.bodyGroup.add(body);
    // 身体蒙皮：枢轴在臀部
    const bodyPivot = P(0, 1.0, -0.42);
    body.updateMatrixWorld(true);
    this.bodyMesh = body;
    reg(body, bodyPivot);

    // 尾巴
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.42, 10), MAT.feather);
    tail.rotation.x = Math.PI / 2 + 0.5;
    tail.position.set(0, -0.12, -0.5);
    tail.castShadow = true;
    this.bodyGroup.add(tail);
    reg(tail, bodyPivot);

    // —— 脖子（两段，枢轴在肩） ——
    this.neckPivot = new THREE.Group();
    this.neckPivot.position.set(0, 0.3, 0.34);
    this.bodyGroup.add(this.neckPivot);

    const neckGeo = new THREE.CylinderGeometry(0.085, 0.12, 0.5, 12);
    const neck1 = new THREE.Mesh(neckGeo, MAT.bodyW);
    neck1.position.set(0, 0.22, 0.02);
    neck1.rotation.x = -0.18;
    neck1.castShadow = true;
    this.neckPivot.add(neck1);
    const neckPivotWorld = P(0, 1.45, 0.1);
    neck1.updateMatrixWorld(true);
    reg(neck1, neckPivotWorld);

    const neck2Pivot = new THREE.Group();
    neck2Pivot.position.set(0, 0.45, 0.06);
    this.neckPivot.add(neck2Pivot);
    const neck2 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.4, 12), MAT.bodyW);
    neck2.position.set(0, 0.18, 0.03);
    neck2.castShadow = true;
    neck2Pivot.add(neck2);
    const neck2PivotWorld = P(0, 1.9, 0.2);
    neck2.updateMatrixWorld(true);
    reg(neck2, neck2PivotWorld);
    this.neck2Pivot = neck2Pivot;

    // —— 头 ——
    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 0.36, 0.06);
    neck2Pivot.add(this.headPivot);
    this.headGroup = new THREE.Group();
    this.headPivot.add(this.headGroup);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 14), MAT.bodyW);
    head.scale.set(0.9, 0.95, 1.15);
    head.castShadow = true;
    this.headGroup.add(head);
    const headPivotWorld = P(0, 2.32, 0.32);
    head.updateMatrixWorld(true);
    reg(head, headPivotWorld);

    // 喙（上 + 喉囊）
    const upper = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.62, 10), MAT.beak);
    upper.rotation.x = Math.PI / 2 - 0.12;
    upper.position.set(0, -0.01, 0.42);
    upper.scale.set(1, 1, 0.7);
    upper.castShadow = true;
    this.headGroup.add(upper);
    reg(upper, headPivotWorld);

    this.pouch = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), MAT.beak);
    this.pouch.scale.set(0.75, 0.55, 1.7);
    this.pouch.position.set(0, -0.13, 0.26);
    this.headGroup.add(this.pouch);
    reg(this.pouch, headPivotWorld);

    // 眼睛
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), MAT.eye);
      eye.position.set(sx * 0.1, 0.045, 0.1);
      this.headGroup.add(eye);
    }

    // 小帽子
    const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.cap);
    capTop.position.set(0, 0.09, -0.01);
    capTop.scale.set(1, 0.7, 1.15);
    this.headGroup.add(capTop);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.02, 14), MAT.cap);
    brim.scale.set(1, 1, 1.3);
    brim.position.set(0, 0.1, 0.08);
    this.headGroup.add(brim);
    reg(capTop, headPivotWorld);

    // —— 翅膀（收拢贴身，逐顶点微颤） ——
    for (const sx of [-1, 1]) {
      const wingPivotLocal = P(sx * 0.2, 1.35, -0.25);
      const wing = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), MAT.feather);
      wing.scale.set(0.32, 0.85, 1.35);
      wing.position.set(sx * 0.24, -0.05, -0.05);
      wing.rotation.z = sx * -0.12;
      wing.rotation.y = sx * 0.15;
      wing.castShadow = true;
      this.bodyGroup.add(wing);
      wing.updateMatrixWorld(true);
      reg(wing, wingPivotLocal);
      this[sx > 0 ? 'wingR' : 'wingL'] = { mesh: wing, limb: this.limbs[this.limbs.length - 1].limb };
    }

    // —— 腿与蹼足（蒙皮，踏板驱动） ——
    this.feet = [];
    for (const sx of [-1, 1]) {
      const hip = P(sx * 0.13, 1.02, -0.38);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.52, 8), MAT.leg);
      // 先摆到车旁直立，枢轴在髋
      leg.position.set(sx * 0.13, 1.02 - 0.26, -0.38);
      leg.castShadow = true;
      this.pelican.add(leg);
      leg.updateMatrixWorld(true);
      reg(leg, hip);

      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.22), MAT.leg);
      foot.position.set(sx * 0.13, 0.18, -0.32);
      foot.castShadow = true;
      this.pelican.add(foot);
      foot.updateMatrixWorld(true);
      reg(foot, hip, 0.85);
      this.feet.push({ legLimb: this.limbs[this.limbs.length - 2].limb, footLimb: this.limbs[this.limbs.length - 1].limb, side: sx });
    }

    // —— 翅膀 / 鳍状前肢扶把 ——
    for (const sx of [-1, 1]) {
      const wingArm = cylBetween(P(sx * 0.2, 1.5, 0.05), P(sx * 0.24, this.handlebarY + 0.02, 0.42), 0.045, MAT.feather, 8);
      this.pelican.add(wingArm);
      wingArm.updateMatrixWorld(true);
      reg(wingArm, P(sx * 0.2, 1.5, 0.05), 0.35);
    }

    // 合并蒙皮
    this.skinned = new Skinned(this.limbs.map(l => l.geometry), this.limbs.map(l => l.limb), MAT.bodyW);
    this.group.add(this.skinned.mesh);
    // 逐顶点方案里原网格只用于量尺寸，移除后统一由蒙皮网格绘制
    for (const m of this.skinSources) m.parent?.remove(m);
  }

  _buildScarf() {
    // 红色围巾：一串小球跟随，尾部按正弦摆动 —— 每帧 update
    this.scarfSegs = [];
    const geo = new THREE.SphereGeometry(0.055, 8, 6);
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(geo, MAT.scarf);
      s.scale.setScalar(1 - i * 0.07);
      this.group.add(s);
      this.scarfSegs.push(s);
    }
  }

  bell() {
    // 点头 + 张嘴
    this._bellT = 0.0001;
  }

  update(dt, t, input) {
    // —— 速度与里程 ——
    this.targetSpeed = input.speed;
    const braking = input.brake ? 3.5 : 1;
    const accel = input.brake ? 10 : 2.2;
    this.speed += (this.targetSpeed * braking - this.speed) * Math.min(1, accel * dt);
    if (input.brake) this.speed = Math.max(0, this.speed - 8 * dt);
    this.distance += this.speed * dt;
    this.bobPhase += this.speed * dt * 1.6;

    // —— 轮与脚踏 ——
    this.wheelAngle -= (this.speed / WHEEL_R) * dt;
    this.crankAngle -= (this.speed / WHEEL_R) * dt * GEAR;
    this.wheels[0].rotation.x = this.wheelAngle;
    this.wheels[1].rotation.x = this.wheelAngle;
    this.crank.rotation.x = this.crankAngle;

    // 每转一圈记一次完整踏频
    if (Math.floor(this.crankAngle / (Math.PI * 2)) !== Math.floor(this._prevCrank / (Math.PI * 2))) {
      this.onBell?.('cadence');
    }
    this._prevCrank = this.crankAngle;

    // —— 沿车道往返（z 循环） ——
    const cycle = 160;
    const half = cycle / 2;
    const raw = (this.distance % cycle) - half;
    const dirSign = 1;
    // 用三角波制造往返
    const tri = (x) => 1 - 2 * Math.abs((x / cycle) - Math.floor(x / cycle + 0.5)) * 1; // -1..1
    const zPos = raw;
    // 是否处于返程（决定朝向）
    const phase = (this.distance % cycle) / cycle;
    const returning = phase > 0.5;
    const targetYaw = returning ? Math.PI : 0;
    // 平滑转向
    let dy = targetYaw - this.group.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.group.rotation.y += dy * Math.min(1, 2.2 * dt);

    this.root.position.z = returning ? -zPos : zPos;
    // 转向倾斜
    this.group.rotation.z += (dy * -0.15 - this.group.rotation.z) * Math.min(1, 4 * dt);

    // —— 车身起伏（路感） ——
    const bob = Math.sin(this.bobPhase * 2.2) * 0.012 + Math.sin(this.bobPhase * 5.7) * 0.006;
    this.group.position.y = bob * Math.min(1, this.speed / 3);
    this.bike.rotation.x = Math.sin(this.bobPhase * 2.2) * 0.008;

    // —— 鹈鹕姿态 ——
    const lean = Math.min(1, this.speed / 6);
    this.pelican.rotation.x = 0.06 + lean * 0.1;
    this.pelican.position.y = bob * 0.5;

    // 脖子/头：前方注视 + 轻微弹簧
    this.neckPivot.rotation.x = -0.5 + Math.sin(this.bobPhase * 2.2) * 0.03 * lean;
    this.headPivot.rotation.x = 0.35 - Math.sin(this.bobPhase * 2.2) * 0.04 * lean;

    // 铃铛动作
    let jaw = 0, nod = 0;
    if (this._bellT > 0) {
      this._bellT += dt;
      const k = this._bellT / 0.7;
      if (k >= 1) { this._bellT = 0; }
      else {
        jaw = Math.sin(k * Math.PI) * 0.5;
        nod = Math.sin(k * Math.PI * 2) * 0.16;
      }
    }
    this.headPivot.rotation.x += nod;
    this.pouch.scale.set(0.75, 0.55 + jaw * 0.9, 1.7 + jaw * 0.5);

    // 翅膀微颤（蒙皮肢体四元数）
    const flap = Math.sin(t * 2.1) * 0.045 + Math.sin(t * 7.3) * 0.015 * lean;
    if (this.wingL) {
      V.e.set(0, 0, -flap); V.q.setFromEuler(V.e);
      this.wingL.limb.quaternion.copy(V.q);
      V.e.set(0, 0, flap); V.q.setFromEuler(V.e);
      this.wingR.limb.quaternion.copy(V.q);
    }

    // —— 腿：脚踏驱动 ——
    for (const f of this.feet) {
      const a = this.crankAngle + (f.side > 0 ? 0 : Math.PI);
      // 脚掌目标点：脚踏位置（crank 局部）转到 group 空间
      const py = 0.42 + Math.cos(a) * this.footOffset;   // 竖直
      const pz = -0.02 + Math.sin(a) * this.footOffset * -1;
      const px = f.side * 0.13;
      // 大腿从髋指向膝（简化为指向脚掌中点略上方）
      const hip = V.a.set(f.side * 0.13, 1.02, -0.38);
      const foot = V.b.set(px, Math.max(py, 0.16), pz);
      const dir = foot.clone().sub(hip);
      const swing = Math.atan2(dir.z, -dir.y) * 0.55;
      V.e.set(swing, 0, 0); V.q.setFromEuler(V.e);
      f.legLimb.quaternion.copy(V.q);
      f.footLimb.quaternion.copy(V.q);
    }

    // —— 围巾跟随 ——
    const neckWorld = V.a.set(0, 1.95, -0.05);
    this.group.localToWorld(neckWorld);
    for (let i = 0; i < this.scarfSegs.length; i++) {
      const s = this.scarfSegs[i];
      const lag = i * 0.09;
      const sway = Math.sin(t * 3.2 - i * 0.7) * (0.04 + i * 0.02) * (0.4 + lean);
      const back = i * 0.075 * (0.6 + lean * 0.8);
      const local = V.b.set(
        neckWorld.x + sway,
        neckWorld.y - i * 0.028 - lag * 0.15,
        neckWorld.z - back,
      );
      this.group.worldToLocal(local);
      s.position.copy(local);
    }

    // 蒙皮 uniform 已在 GPU 端，无需 CPU 回写
    this.skinned.update();
  }

  getCadenceRPM() {
    return Math.abs(this.speed / WHEEL_R) * GEAR * 60 / (Math.PI * 2);
  }
}
