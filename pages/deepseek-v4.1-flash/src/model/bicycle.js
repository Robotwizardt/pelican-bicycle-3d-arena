/**
 * bicycle.js — 参数化自行车
 *
 * 只给一份「几何规格」(spec)，其余全部由它推导：轴距、头管角、后下叉、BB 下沉、
 * 前叉偏移、曲柄长、齿比…… 管件用两关节之间的圆柱生成，因此改 spec 就能换车。
 * 传动系统（牙盘/飞轮/链条）按真实外切公切线计算路径，链条随张力松弛。
 *
 * 局部坐标约定：+X 前进、+Y 向上、+Z 车身右侧，地面 y=0。
 */
import * as THREE from 'three';
import { aimCylinder, tubeBetween, roundedPlate, clamp, lerp, TAU } from '../lib/util.js';

export const SPEC = {
  tireR: 0.335, tireW: 0.033, wheelbase: 1.02,
  bbDrop: 0.065, chainstay: 0.438, seatTubeAngle: 74, seatTubeLen: 0.552,
  headAngle: 72, headTubeLen: 0.118, headTubeTop: [0.400, 0.900],
  forkOffset: 0.048, crankLen: 0.170, chainring: 0.106, cog: 0.042,
  saddle: [-0.150, 0.848], barWidth: 0.42, barCenter: [0.452, 0.928], drop: 0.125,
};

export const LIVERIES = [
  { id: 'sunset', name: '落日橘', frame: 0xff7a2f, accent: 0x1d2430, tape: 0xf2e9d8, box: 0xf7f1e2, saddle: 0x2b2320, trim: 0xffd9a8, light: 0xffb066 },
  { id: 'abyss', name: '深海蓝', frame: 0x2f6fd0, accent: 0x0f1626, tape: 0xdfe8ff, box: 0xe8f0ff, saddle: 0x1b2434, trim: 0x9fd0ff, light: 0x8fc4ff },
  { id: 'matcha', name: '抹茶绿', frame: 0x3f9e6a, accent: 0x1a2a20, tape: 0xf0efe2, box: 0xf4f6e8, saddle: 0x2a2418, trim: 0xcdffd9, light: 0xa8ffcf },
  { id: 'cream', name: '复古奶油', frame: 0xf2e5c8, accent: 0x8c3b2a, tape: 0x8c3b2a, box: 0xfbf3e2, saddle: 0x5a3a26, trim: 0xffe9bd, light: 0xffd9a0 },
  { id: 'neon', name: '霓虹紫', frame: 0x8b5cf6, accent: 0x12091f, tape: 0x2a1b46, box: 0x1d1233, saddle: 0x1a1029, trim: 0xd9c2ff, light: 0xd0a8ff },
];

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Bicycle {
  constructor({ livery = LIVERIES[0], quality = 'high' } = {}) {
    this.quality = quality;
    this.spec = SPEC;
    this.root = new THREE.Group();
    this.root.name = 'bicycle';
    this.mats = this._materials(livery);
    this.parts = {};
    this._build();
    this.setLivery(livery);
  }

  _materials(l) {
    const std = (color, metalness, roughness, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
    return {
      frame: std(l.frame, 0.62, 0.26),
      accent: std(l.accent, 0.5, 0.42),
      tape: std(l.tape, 0.05, 0.82),
      saddle: std(l.saddle, 0.12, 0.62),
      box: std(l.box, 0.05, 0.7),
      trim: std(l.trim, 0.35, 0.35),
      alu: std(0xb8c0ca, 0.92, 0.22),
      aluDark: std(0x8d949e, 0.88, 0.3),
      steel: std(0x42474f, 0.85, 0.35),
      rubber: std(0x191b1f, 0.02, 0.92),
      rubberSoft: std(0x2a2d33, 0.02, 0.86),
      chain: std(0x6c737d, 0.95, 0.28),
      gold: std(0xd8a94a, 0.95, 0.25),
      glass: std(0xbfe3ff, 0.1, 0.12, { transparent: true, opacity: 0.5 }),
      lightFront: new THREE.MeshStandardMaterial({ color: 0xfff4d0, emissive: 0xfff0c0, emissiveIntensity: 0, roughness: 0.3 }),
      lightRear: new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xff2a1a, emissiveIntensity: 0, roughness: 0.4 }),
      lampGlow: new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      lampGlowR: new THREE.MeshBasicMaterial({ color: 0xff3a20, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      spoke: std(0xd6dbe2, 0.95, 0.25),
    };
  }

  setLivery(l) {
    this.livery = l;
    const m = this.mats;
    m.frame.color.setHex(l.frame);
    m.accent.color.setHex(l.accent);
    m.tape.color.setHex(l.tape);
    m.saddle.color.setHex(l.saddle);
    m.box.color.setHex(l.box);
    m.trim.color.setHex(l.trim);
    m.lightFront.emissive.setHex(l.light);
  }

  setQuality(q) {
    this.quality = q;
    const on = q !== 'low';
    const P = this.parts;
    ['wheelFront', 'wheelRear'].forEach((k) => {
      if (!P[k]) return;
      P[k].spokesL.visible = on;
      P[k].spokesR.visible = on;
      P[k].group.traverse((o) => { if (o.isInstancedMesh && o.geometry.type === 'BoxGeometry') o.visible = true; });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 建模                                                                */
  /* ------------------------------------------------------------------ */
  _build() {
    const S = this.spec, M = this.mats, P = this.parts;
    const tireR = S.tireR, axleY = tireR;
    // 后轴：由「后下叉长度 + BB 下沉量」反推水平距离
    const csX = Math.sqrt(Math.max(S.chainstay ** 2 - S.bbDrop ** 2, 0));
    const rearAxle = V(-csX, axleY, 0);
    const bb = V(0, axleY - S.bbDrop, 0);
    const frontAxle = V(rearAxle.x + S.wheelbase, axleY, 0);
    const seatAng = (S.seatTubeAngle * Math.PI) / 180;
    const seatTop = V(bb.x - Math.cos(seatAng) * S.seatTubeLen, bb.y + Math.sin(seatAng) * S.seatTubeLen, 0);
    const headTop = V(S.headTubeTop[0], S.headTubeTop[1], 0);
    const headAxis = V(-Math.cos((S.headAngle * Math.PI) / 180), Math.sin((S.headAngle * Math.PI) / 180), 0).normalize();
    const headBottom = headTop.clone().addScaledVector(headAxis, -S.headTubeLen);
    const saddlePos = V(S.saddle[0], S.saddle[1], 0);
    const bar = V(S.barCenter[0], S.barCenter[1], 0);

    this.geo = { tireR, axleY, rearAxle, frontAxle, bb, seatTop, headTop, headBottom, headAxis, saddlePos, bar };

    const tubeR = { top: 0.019, down: 0.024, seat: 0.017, stay: 0.011, chain: 0.013, fork: 0.015 };

    /* ---------- 三角车架 ---------- */
    const frameG = new THREE.Group(); frameG.name = 'frame';
    const add = (m, parent = frameG) => { parent.add(m); return m; };
    add(tubeBetween(bb, headBottom, tubeR.down, tubeR.down * 0.86, M.frame));               // 下管
    add(tubeBetween(seatTop, headTop, tubeR.top, tubeR.top, M.frame));                      // 上管
    add(tubeBetween(bb, seatTop, tubeR.seat, tubeR.seat * 0.92, M.frame));                  // 立管
    add(tubeBetween(headBottom, headTop, 0.024, 0.022, M.accent));                          // 头管
    add(tubeBetween(seatTop, rearAxle, tubeR.stay, tubeR.stay * 0.72, M.frame));            // 后上叉
    add(tubeBetween(bb, rearAxle, tubeR.chain, tubeR.chain * 0.8, M.frame));                // 后下叉
    // 后叉桥 + 五通加强
    add(tubeBetween(V((seatTop.x + rearAxle.x) / 2, (seatTop.y + rearAxle.y) / 2, 0), V((seatTop.x + rearAxle.x) / 2, (seatTop.y + rearAxle.y) / 2, 0.001), 0.008, 0.008, M.accent));
    const bbShell = add(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.085, 20), M.frame));
    bbShell.position.copy(bb); bbShell.rotation.x = Math.PI / 2;
    add(tubeBetween(V(bb.x - 0.03, bb.y - 0.005, 0.02), V(bb.x - 0.11, bb.y - 0.02, 0.02), 0.010, 0.010, M.accent)); // 五通下耳
    // 水壶架 + 水壶
    const bottle = new THREE.Group();
    const btl = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.034, 0.16, 16), M.trim);
    btl.position.y = 0.02; btl.castShadow = true;
    bottle.add(btl);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.028, 12), M.accent);
    cap.position.y = 0.11; bottle.add(cap);
    bottle.position.set(bb.x * 0.45 + headBottom.x * 0.55, bb.y * 0.42 + headBottom.y * 0.58 - 0.02, 0.052);
    bottle.rotation.set(0, 0, -0.86);
    frameG.add(bottle);
    P.bottle = bottle;

    /* ---------- 座管 + 座垫 ---------- */
    const post = add(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.20, 14), M.aluDark));
    aimCylinder(post, seatTop, saddlePos.clone().add(V(0, -0.03, 0)));
    const saddle = new THREE.Group();
    const sad = roundedPlate(0.27, 0.135, 0.055, 0.028, M.saddle);
    sad.rotation.x = -Math.PI / 2; sad.scale.set(1, 1, 1);
    sad.position.y = 0.006; saddle.add(sad);
    const nose = new THREE.Mesh(new THREE.CapsuleGeometry(0.021, 0.10, 4, 10), M.saddle);
    nose.rotation.z = Math.PI / 2; nose.position.set(0.115, 0.004, 0); saddle.add(nose);
    saddle.position.copy(saddlePos);
    saddle.rotation.z = -0.06;
    frameG.add(saddle); P.saddle = saddle;

    /* ---------- 前叉 + 转向总成（绕头管轴旋转） ---------- */
    const steer = new THREE.Group();
    steer.position.copy(headTop);
    steer.name = 'steer';
    const toLocal = (v) => v.clone().sub(headTop);
    const inSteer = (m) => { steer.add(m); return m; };
    // 舵管 / 把立
    inSteer(tubeBetween(toLocal(headTop), toLocal(headBottom.clone().addScaledVector(headAxis, 0.02)), 0.017, 0.016, M.aluDark));
    const stem = inSteer(tubeBetween(toLocal(headTop.clone().addScaledVector(headAxis, 0.01)), toLocal(bar), 0.016, 0.014, M.alu));
    // 前叉：冠 → 中段 → 叉脚（带一点弯曲与偏移）
    const crown = headBottom.clone().addScaledVector(headAxis, -0.012);
    const mid = V(crown.x + (frontAxle.x - crown.x) * 0.45 + S.forkOffset * 0.4, crown.y * 0.55 + frontAxle.y * 0.45, 0);
    const bladeL = crown.clone().setZ(0.052), bladeR = crown.clone().setZ(-0.052);
    const midL = mid.clone().setZ(0.058), midR = mid.clone().setZ(-0.058);
    const axleL = frontAxle.clone().setZ(0.050), axleR = frontAxle.clone().setZ(-0.050);
    [[bladeL, midL, axleL], [bladeR, midR, axleR]].forEach(([a, b, c]) => {
      inSteer(tubeBetween(toLocal(a), toLocal(b), 0.017, 0.014, M.frame));
      inSteer(tubeBetween(toLocal(b), toLocal(c), 0.014, 0.011, M.frame));
    });
    const forkCrown = inSteer(tubeBetween(toLocal(bladeL), toLocal(bladeR.clone()), 0.026, 0.026, M.frame));
    forkCrown.position.y += 0.012;

    /* ---------- 车把：上把 + 下把 + 弯头 ---------- */
    const BAR = this._buildHandlebar(bar, headTop, M);
    steer.add(BAR.group);
    P.gripL = BAR.gripL; P.gripR = BAR.gripR; P.leverL = BAR.leverL; P.leverR = BAR.leverR;
    P.bell = this._buildBell(bar, headTop, M);
    steer.add(P.bell);

    /* ---------- 灯组 ---------- */
    const lamp = this._buildLamps(headTop, bar, rearAxle, M);
    steer.add(lamp.frontGroup);
    frameG.add(lamp.rearGroup);
    P.lamp = lamp;

    /* ---------- 车轮 ---------- */
    // 后轮（含飞轮与碟刹座）
    const rearWheel = this._buildWheel(rearAxle, M, { cassette: true, rotor: false });
    frameG.add(rearWheel.group);
    // 前轮（含碟刹）
    // 注意：前轮是 steer 的子节点，而 steer 自身就位于 headTop。
    // _buildWheel 用的是【车体绝对坐标】frontAxle，所以这里必须减去 headTop 转成局部坐标；
    // 早先多加了一层 frontWheelHolder.position.copy(headTop)，等于把 headTop 计了两次，
    // 前轮会因此悬空在前叉轴线外约 1 m（正好一个轴距）——就是画面里漂在鹈鹕头顶的那个“黑圈”。
    const frontWheel = this._buildWheel(frontAxle, M, { cassette: false, rotor: true });
    frontWheel.group.position.sub(headTop);
    steer.add(frontWheel.group);
    P.wheelRear = rearWheel; P.wheelFront = frontWheel;

    /* ---------- 挡泥板 ---------- */
    frameG.add(this._buildFender(rearAxle, 0.335 + 0.030, 16, 170, M.frame));
    steer.add((() => { const f = this._buildFender(frontAxle, 0.365, 10, 178, M.frame); f.position.sub(headTop); return f; })());

    /* ---------- 传动：牙盘 / 曲柄 / 脚踏 / 链条 ---------- */
    const drive = this._buildDrivetrain(bb, rearAxle, M);
    frameG.add(drive.group);
    P.crank = drive.crankGroup; P.pedalL = drive.pedalL; P.pedalR = drive.pedalR;
    P.chainring = drive.ring; P.chain = drive.chain;

    /* ---------- 后货架 + 渔获箱 ---------- */
    const rack = this._buildRack(rearAxle, seatTop, M);
    frameG.add(rack);

    /* ---------- 刹车器 ---------- */
    frameG.add(this._buildBrakes(rearAxle, M));
    steer.add((() => { const b = this._buildBrakes(frontAxle, M, true); b.position.sub(headTop); return b; })());

    this.root.add(frameG, steer);
    P.steer = steer;
    P.frame = frameG;
    this._frameG = frameG;
  }

  _buildHandlebar(bar, headTop, M) {
    const g = new THREE.Group();
    g.position.copy(bar).sub(headTop);
    const half = 0.21;
    const segs = [];
    // 中间平把
    const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.0145, half * 2, 18), M.alu);
    mid.rotation.x = Math.PI / 2; mid.castShadow = true; g.add(mid);
    // 两侧弯把：向前的弯钩 + 下垂
    const hooks = [];
    [-1, 1].forEach((s) => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, s * half),
        new THREE.Vector3(0.055, 0.004, s * (half + 0.012)),
        new THREE.Vector3(0.075, -0.045, s * (half + 0.004)),
        new THREE.Vector3(0.030, -0.105, s * (half - 0.006)),
        new THREE.Vector3(-0.045, -0.125, s * (half - 0.012)),
      ]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 26, 0.0145, 12, false), M.alu);
      tube.castShadow = true; g.add(tube);
      hooks.push(curve);
      // 把带
      const tapeCurve = new THREE.CatmullRomCurve3(curve.getPoints(12).slice(1, 12));
      const tape = new THREE.Mesh(new THREE.TubeGeometry(tapeCurve, 22, 0.0165, 12, false), M.tape);
      tape.castShadow = true; g.add(tape);
    });
    // 握把（副把位）：手变头位置
    const gripL = new THREE.Object3D(), gripR = new THREE.Object3D();
    const hoodL = new THREE.Object3D(), hoodR = new THREE.Object3D();
    gripL.position.set(0.060, 0.006, -half); gripR.position.set(0.060, 0.006, half);
    g.add(gripL, gripR);
    // 手变（刹把本体）
    const lever = (s) => {
      const l = new THREE.Group();
      const body = roundedPlate(0.10, 0.055, 0.02, 0.05, M.rubberSoft);
      body.rotation.y = Math.PI / 2; body.rotation.z = -0.25; body.position.set(0.052, -0.012, 0);
      const bl = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.085, 3, 8), M.aluDark);
      bl.rotation.z = -0.35; bl.position.set(0.049, -0.062, 0);
      l.add(body, bl);
      l.position.set(0, 0, s * half);
      return l;
    };
    const leverL = lever(-1), leverR = lever(1);
    g.add(leverL, leverR);
    return { group: g, gripL, gripR, leverL, leverR, hooks };
  }

  _buildBell(bar, headTop, M) {
    const b = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.026, 18, 12, 0, TAU, 0, Math.PI / 2.1), M.gold);
    dome.castShadow = true;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.008, 14), M.aluDark);
    b.add(dome, base);
    b.position.copy(bar).sub(headTop).add(V(0.01, 0.02, 0.10));
    this.parts.bell = b;
    return b;
  }

  _buildLamps(headTop, bar, rearAxle, M) {
    const frontGroup = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.05, 18), M.aluDark);
    housing.rotation.z = Math.PI / 2; housing.castShadow = true;
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.023, 16, 12, 0, TAU, 0, Math.PI / 2), M.lightFront);
    lens.rotation.z = -Math.PI / 2; lens.position.x = 0.026;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), M.lampGlow);
    glow.position.set(0.06, 0, 0); glow.rotation.y = -Math.PI / 2;
    frontGroup.add(housing, lens, glow);
    frontGroup.position.set(bar.x + 0.10, bar.y - 0.13, 0).sub(headTop);
    const spot = new THREE.SpotLight(0xfff0c8, 0, 22, 0.52, 0.42, 1.4);
    spot.position.set(0.04, 0, 0);
    const spotTarget = new THREE.Object3D(); spotTarget.position.set(6, -0.6, 0);
    frontGroup.add(spot, spotTarget); spot.target = spotTarget;

    const rearGroup = new THREE.Group();
    const rh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.026), M.accent);
    const rl = new THREE.Mesh(new THREE.PlaneGeometry(0.024, 0.04), M.lightRear);
    rl.position.x = -0.016; rl.rotation.y = -Math.PI / 2;
    const rglow = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), M.lampGlowR);
    rglow.position.set(-0.03, 0, 0); rglow.rotation.y = -Math.PI / 2;
    rearGroup.add(rh, rl, rglow);
    rearGroup.position.set(rearAxle.x - 0.02, rearAxle.y + 0.26, 0);
    const rearPoint = new THREE.PointLight(0xff3a20, 0, 4, 2);
    rearGroup.add(rearPoint);
    return { frontGroup, rearGroup, spot, rearPoint, lens, rl, glow, rglow };
  }

  _buildWheel(axle, M, { cassette = false, rotor = false } = {}) {
    const R = this.spec.tireR;
    const group = new THREE.Group();
    group.position.copy(axle);
    group.name = cassette ? 'wheel-rear' : 'wheel-front';
    const spin = new THREE.Group();           // 绕 Z 轴自转
    group.add(spin);

    // 轮胎
    const tire = new THREE.Mesh(new THREE.TorusGeometry(R - this.spec.tireW, this.spec.tireW, 12, 64), M.rubber);
    tire.castShadow = true; tire.receiveShadow = true;
    // 胎面细纹（用一圈小方块表达，低画质时省略）
    spin.add(tire);
    if (this.quality !== 'low') {
      const knobs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.006, 0.006, 0.028), M.rubberSoft, 40);
      const mtx = new THREE.Matrix4();
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * TAU;
        mtx.makeRotationZ(a);
        mtx.setPosition(Math.cos(a + 0.04) * (R - 0.004), Math.sin(a + 0.04) * (R - 0.004), (i % 2 ? 0.012 : -0.012));
        knobs.setMatrixAt(i, mtx);
      }
      spin.add(knobs);
    }
    // 轮圈（制动边 + 圈床，两段圆柱做出剖面感）
    const rimOuter = new THREE.Mesh(new THREE.CylinderGeometry(R - this.spec.tireW * 0.62, R - this.spec.tireW * 0.62, 0.026, 56, 1, true), M.alu);
    rimOuter.rotation.x = Math.PI / 2;
    const rimInner = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.062, R - 0.062, 0.03, 48, 1, true), M.aluDark);
    rimInner.rotation.x = Math.PI / 2;
    spin.add(rimOuter, rimInner);
    [-1, 1].forEach((s) => {
      const wall = new THREE.Mesh(new THREE.RingGeometry(R - 0.062, R - this.spec.tireW * 0.62, 48), M.aluDark);
      wall.position.z = s * 0.016;
      spin.add(wall);
    });
    // 辐条：交叉编法（左右法兰各 16 根，切向偏置）
    const spokeLen = R - 0.07;
    const mkSpokes = (side) => {
      const inst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0016, 0.0016, spokeLen, 5), M.spoke, 16);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
      const pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        const hubZ = side * 0.026;
        const dir = new THREE.Vector3(Math.cos(a + side * 0.16) * spokeLen, Math.sin(a + side * 0.16) * spokeLen, -hubZ).normalize();
        pos.set(Math.cos(a) * spokeLen * 0.5, Math.sin(a) * spokeLen * 0.5, hubZ * 0.5);
        q.setFromUnitVectors(up, dir);
        m.compose(pos, q, s);
        inst.setMatrixAt(i, m);
      }
      spin.add(inst);
      return inst;
    };
    const spokesR = mkSpokes(1), spokesL = mkSpokes(-1);
    // 花鼓
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.075, 16), M.alu);
    hub.rotation.x = Math.PI / 2; spin.add(hub);
    [-1, 1].forEach((s) => {
      const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.007, 18), M.aluDark);
      fl.rotation.x = Math.PI / 2; fl.position.z = s * 0.032; spin.add(fl);
    });
    if (cassette) {
      // 飞轮：8 片，半径递减
      for (let i = 0; i < 8; i++) {
        const r = this.spec.cog + 0.019 - i * 0.0026;
        const cog = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.0055, 26), M.chain);
        cog.rotation.x = Math.PI / 2;
        cog.position.z = 0.042 + i * 0.0062;
        spin.add(cog);
      }
      const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12), M.alu);
      lock.rotation.x = Math.PI / 2; lock.position.z = 0.098; spin.add(lock);
    }
    if (rotor) {
      const rotorMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.003, 40, 1, true), M.aluDark);
      rotorMesh.rotation.x = Math.PI / 2; rotorMesh.position.z = 0.038; spin.add(rotorMesh);
      const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.028, 0.0026), M.aluDark, 12);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        m.makeRotationZ(a); m.setPosition(Math.cos(a) * 0.055, Math.sin(a) * 0.055, 0.038);
        arms.setMatrixAt(i, m);
      }
      spin.add(arms);
    }
    // 气嘴
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 8), M.gold);
    valve.position.set(0, R - 0.045, 0); spin.add(valve);
    return { group, spin, spokesL, spokesR };
  }

  _buildFender(axle, radius, a0, a1, mat) {
    const g = new THREE.Group();
    g.position.copy(axle);
    // Torus 从 +X 起逆时针扫掠；90° 即正上方，因此 a0..a1 覆盖轮子上方
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.0075, 6, 44, ((a1 - a0) * Math.PI) / 180),
      new THREE.MeshStandardMaterial({ color: mat.color, metalness: 0.35, roughness: 0.45, side: THREE.DoubleSide })
    );
    arc.rotation.z = (a0 * Math.PI) / 180;
    arc.castShadow = true;
    g.add(arc);
    // 支撑杆：从轮轴附近斜撑到泥除两端
    [-1, 1].forEach((s) => {
      const a = ((s > 0 ? a1 : a0) * Math.PI) / 180;
      const tip = V(Math.cos(a) * radius * 0.97, Math.sin(a) * radius * 0.97, s * 0.048);
      const base = V(0, 0, s * 0.052);
      const stay = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 1, 6), this.mats.alu);
      aimCylinder(stay, base, tip);
      g.add(stay);
    });
    return g;
  }

  _buildDrivetrain(bb, rearAxle, M) {
    const S = this.spec;
    const group = new THREE.Group();
    const crankGroup = new THREE.Group();
    crankGroup.position.copy(bb);
    // 牙盘（带齿）
    const ring = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(S.chainring - 0.008, S.chainring - 0.008, 0.005, 48), M.alu);
    disc.rotation.x = Math.PI / 2;
    ring.add(disc);
    const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(0.004, 0.016, 0.005), M.aluDark, 44);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * TAU;
      m.makeRotationZ(a);
      m.setPosition(Math.cos(a) * (S.chainring - 0.004), Math.sin(a) * (S.chainring - 0.004), 0);
      teeth.setMatrixAt(i, m);
    }
    ring.add(teeth);
    // 曲柄臂
    const arm = (side) => {
      const a = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.028, S.crankLen, 0.014), M.alu);
      body.position.y = S.crankLen / 2; body.castShadow = true;
      a.add(body);
      a.position.z = side * 0.062;
      return a;
    };
    const crankL = arm(-1), crankR = arm(1);
    crankL.rotation.z = Math.PI;              // 左右曲柄相位差 180°
    ring.position.z = 0.045;                  // 牙盘平面与链条平面对齐
    crankGroup.add(ring, crankL, crankR);
    // 脚踏（挂在曲柄末端，保持水平）
    const pedal = (side) => {
      const gped = new THREE.Group();
      const platform = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.014, 0.085), M.rubberSoft);
      platform.castShadow = true;
      const cage = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.008, 0.075), M.alu);
      cage.position.y = 0.011;
      const reflect = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.02, 0.03), M.trim);
      reflect.position.set(-0.05, 0, 0);
      const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.02, 8), M.aluDark);
      spindle.rotation.z = Math.PI / 2; spindle.position.z = -side * 0.012;
      gped.add(platform, cage, reflect, spindle);
      gped.position.y = S.crankLen;
      gped.position.z = side * 0.012;         // 脚踏平台略外置（Q 因子）
      return gped;
    };
    const pedalL = pedal(-1), pedalR = pedal(1);
    crankL.add(pedalL); crankR.add(pedalR);
    group.add(crankGroup);

    /* --- 链条：真实公切线路径 + 下段松弛 --- */
    const c1 = new THREE.Vector3(0, 0, 0.045);        // 牙盘中心（局部于 BB）
    const c2 = new THREE.Vector3(rearAxle.x - bb.x, rearAxle.y - bb.y, 0.045);
    const r1 = S.chainring, r2 = S.cog;
    const chainGroup = new THREE.Group();
    chainGroup.position.copy(bb);
    const d = Math.hypot(c2.x, c2.y);
    const phi = Math.atan2(c2.y, c2.x);
    const alpha = Math.acos(clamp((r1 - r2) / d, -1, 1));
    // 上段：外切线（与两圆相切）
    const t1 = new THREE.Vector3(Math.cos(phi + alpha), Math.sin(phi + alpha), 0);
    const t2 = new THREE.Vector3(Math.cos(phi + alpha), Math.sin(phi + alpha), 0);
    const topA = c1.clone().addScaledVector(t1, r1);
    const topB = c2.clone().addScaledVector(t2, r2);
    const chainLinks = 84;
    const link = new THREE.InstancedMesh(new THREE.BoxGeometry(0.0128, 0.0085, 0.0026), M.chain, chainLinks);
    link.castShadow = true;
    chainGroup.add(link);
    // 下段松弛控制点
    const sagPoint = new THREE.Vector3(
      (c1.x + c2.x) / 2 + 0.01,
      (c1.y + c2.y) / 2 - 0.075,
      0.045
    );
    const path = { c1, c2, r1, r2, topA, topB, sagPoint, chainGroup, link };
    const rollerGeo = new THREE.CylinderGeometry(0.0036, 0.0036, 0.0072, 6);
    rollerGeo.rotateX(Math.PI / 2);          // 让滚子轴线 = Z（与牙盘同轴）
    const rollers = new THREE.InstancedMesh(rollerGeo, M.chain, chainLinks);
    chainGroup.add(rollers);
    path.rollers = rollers;

    return { group, crankGroup, pedalL, pedalR, ring, chain: path };
  }

  _buildRack(rearAxle, seatTop, M) {
    const g = new THREE.Group();
    const top = V(rearAxle.x - 0.02, rearAxle.y + 0.30, 0);
    // 两根支杆 + 平台
    [-1, 1].forEach((s) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.33, 8), M.aluDark);
      aimCylinder(leg, top.clone().setZ(s * 0.075), rearAxle.clone().setZ(s * 0.075));
      g.add(leg);
      const stay = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.28, 8), M.aluDark);
      aimCylinder(stay, top.clone().setZ(s * 0.075), seatTop.clone().add(V(0, -0.06, s * 0.07)));
      g.add(stay);
    });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.012, 0.20), M.aluDark);
    deck.position.copy(top).add(V(-0.03, 0.006, 0)); deck.castShadow = true; deck.receiveShadow = true;
    g.add(deck);
    // 渔获箱
    const box = new THREE.Group();
    const body = roundedPlate(0.28, 0.19, 0.02, 0.19, M.box);
    body.rotation.x = 0;
    body.position.y = 0.11;
    box.add(body);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.02, 0.20), M.trim);
    lid.position.y = 0.208; lid.castShadow = true;
    box.add(lid);
    // 鱼形标识：两片三角 + 圆点
    const fish = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.075, 3), M.trim);
    fish.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    fish.position.set(0, 0.12, 0.098);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), M.accent);
    eye.position.set(0.018, 0.128, 0.104);
    box.add(fish, eye);
    // 露出箱口的鱼尾
    const tailFish = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 4), M.trim);
    tailFish.rotation.set(0.4, 0.5, 0.35);
    tailFish.position.set(-0.02, 0.30, -0.02);
    tailFish.castShadow = true;
    box.add(tailFish);
    box.position.copy(top).add(V(-0.03, 0.006, 0));
    g.add(box);
    this.parts.cargoBox = box;
    return g;
  }

  _buildBrakes(axle, M, front = false) {
    const g = new THREE.Group();
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.03), M.alu);
    caliper.position.set(0, 0, front ? -0.052 : 0.052);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.055, 0.012), M.steel);
    arm.position.set(-0.026, -0.012, front ? -0.06 : 0.06);
    g.add(caliper, arm);
    g.position.copy(axle).add(V(-0.01, 0.10, 0));
    return g;
  }

  /* ------------------------------------------------------------------ */
  /* 运行状态                                                            */
  /* ------------------------------------------------------------------ */
  update(dt, st) {
    const S = this.spec, P = this.parts;
    const speed = st.speed;
    // 车轮自转：ω = v / r，方向随前进
    const spin = (speed * dt) / S.tireR;
    P.wheelFront.spin.rotation.z -= spin;
    P.wheelRear.spin.rotation.z -= spin;
    // 曲柄踏频：+X 为前进方向，向前踏踏时曲柄绕 -Z 转（与车轮滚向一致）
    P.crank.rotation.z = -st.crankAngle;
    // 脚踏保持水平（脚踏轴随曲柄平移但不旋转；左曲柄已偏移 180°）
    P.pedalL.rotation.z = st.crankAngle - Math.PI;
    P.pedalR.rotation.z = st.crankAngle;
    // 转向
    if (P.steer) P.steer.quaternion.setFromAxisAngle(this.geo.headAxis, -st.steer);
    // 链条：按线速度沿着路径推进相位
    this._updateChain(st.chainPhase, st.tension);
    // 灯光
    const night = st.lampMix;
    P.lamp.spot.intensity = night * 42;
    P.lamp.rearPoint.intensity = night * 3.2;
    this.mats.lightFront.emissiveIntensity = 0.25 + night * 3.2;
    this.mats.lightRear.emissiveIntensity = 0.2 + night * 2.6 + st.brake * 1.4;
    this.mats.lampGlow.opacity = night * 0.5;
    this.mats.lampGlowR.opacity = night * 0.35 + st.brake * 0.3;
    // 刹车时叉子下沉
    const dive = st.brake * 0.02;
    P.frame.rotation.z = -dive;
    P.bell.rotation.z = st.bellWobble || 0;
    this.state = st;
  }

  _updateChain(phase, tension) {
    const P = this.parts, ch = P.chain;
    if (!ch) return;
    const { c1, c2, r1, r2, chainGroup, link, rollers } = ch;
    const d = Math.hypot(c2.x - c1.x, c2.y - c1.y);
    const phi = Math.atan2(c2.y - c1.y, c2.x - c1.x);
    const alpha = Math.acos(clamp((r1 - r2) / d, -1, 1));
    const dir = new THREE.Vector3(Math.cos(phi + alpha), Math.sin(phi + alpha), 0);
    const topA = c1.clone().addScaledVector(dir, r1);
    const topB = c2.clone().addScaledVector(dir, r2);
    const sagPoint = new THREE.Vector3((c1.x + c2.x) / 2 + 0.008, (c1.y + c2.y) / 2 - 0.055 - 0.05 * (1 - tension), 0.045);
    // 路径：上段（牙盘上切点 → 飞轮上切点）→ 飞轮弧 → 下段（含松弛）→ 牙盘弧
    const pts = [];
    const N1 = 18, N2 = 10;
    for (let i = 0; i <= N1; i++) pts.push(topA.clone().lerp(topB, i / N1));
    // 飞轮包角（从上切点绕到下方）
    const angB = Math.atan2(topB.y - c2.y, topB.x - c2.x);
    const angSagEnd = Math.atan2(sagPoint.y - c2.y, sagPoint.x - c2.x);
    let a0 = angB, a1 = angSagEnd;
    while (a1 > a0) a1 -= TAU;
    for (let i = 1; i <= N2; i++) {
      const a = lerp(a0, a1, i / N2);
      pts.push(new THREE.Vector3(c2.x + Math.cos(a) * r2, c2.y + Math.sin(a) * r2, 0.045));
    }
    // 下段：飞轮 → 松弛点 → 牙盘下切点（二次贝塞尔）
    const bottomA = c1.clone().addScaledVector(dir, -r1);
    const bottomB = c2.clone().addScaledVector(dir, -r2);
    const bez = (p0, pc, p1, t) => {
      const it = 1 - t;
      return new THREE.Vector3(
        it * it * p0.x + 2 * it * t * pc.x + t * t * p1.x,
        it * it * p0.y + 2 * it * t * pc.y + t * t * p1.y,
        it * it * p0.z + 2 * it * t * pc.z + t * t * p1.z
      );
    };
    const Ng = 20;
    for (let i = 0; i <= Ng; i++) pts.push(bez(bottomB, sagPoint, bottomA, i / Ng));
    // 牙盘包角
    const angA0 = Math.atan2(bottomA.y - c1.y, bottomA.x - c1.x);
    const angA1 = Math.atan2(topA.y - c1.y, topA.x - c1.x) + TAU;
    for (let i = 1; i <= N2; i++) {
      const a = lerp(angA0, angA1, i / N2);
      pts.push(new THREE.Vector3(c1.x + Math.cos(a) * r1, c1.y + Math.sin(a) * r1, 0.045));
    }
    // 等弧长重采样
    const total = [];
    let len = 0;
    total.push(0);
    for (let i = 0; i < pts.length; i++) {
      len += pts[i].distanceTo(pts[(i + 1) % pts.length]);
      total.push(len);
    }
    const n = link.count;
    this.chainPitch = len / n;                 // 链节间距（供外部推进相位）
    const m = new THREE.Matrix4(), sc = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    const xA = new THREE.Vector3(), yA = new THREE.Vector3(), zA = new THREE.Vector3(0, 0, 1);
    const start = (phase % 1) * (len / n);
    for (let i = 0; i < n; i++) {
      const s = (start + (i * len) / n) % len;
      // 二分查找段
      let lo = 0, hi = total.length - 1;
      while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (total[mid] <= s) lo = mid; else hi = mid; }
      const t = (s - total[lo]) / Math.max(total[lo + 1] - total[lo], 1e-6);
      const p0 = pts[lo % pts.length], p1 = pts[(lo + 1) % pts.length];
      pos.lerpVectors(p0, p1, clamp(t, 0, 1));
      xA.subVectors(p1, p0).normalize();
      yA.crossVectors(zA, xA).normalize();
      xA.crossVectors(yA, zA).normalize();
      m.makeBasis(xA, yA, zA).setPosition(pos);
      link.setMatrixAt(i, m);
      rollers.setMatrixAt(i, m);
    }
    link.instanceMatrix.needsUpdate = true;
    rollers.instanceMatrix.needsUpdate = true;
  }

  /** 自行车局部坐标：握把（给翅膀 IK，解析求解，不依赖世界矩阵） */
  gripLocal(side, steer, out = new THREE.Vector3()) {
    const rest = new THREE.Vector3(0.060, 0.006, side * 0.21).add(this.geo.bar).sub(this.geo.headTop);
    const q = new THREE.Quaternion().setFromAxisAngle(this.geo.headAxis, -steer);
    return out.copy(rest).applyQuaternion(q).add(this.geo.headTop);
  }
  /** 自行车局部坐标：踏面中心 */
  pedalLocal(side, crankAngle, out = new THREE.Vector3()) {
    const a = crankAngle + (side > 0 ? 0 : Math.PI);
    const bb = this.geo.bb;
    return out.set(
      bb.x + Math.sin(a) * this.spec.crankLen,
      bb.y + Math.cos(a) * this.spec.crankLen,
      side * (0.062 + 0.012)
    );
  }
  /** 世界坐标：握把（供翅膀 IK） */
  gripWorld(side, out) {
    return (side > 0 ? this.parts.gripR : this.parts.gripL).getWorldPosition(out);
  }
  /** 世界坐标：脚踏中心（供双脚 IK） */
  pedalWorld(side, out) {
    return (side > 0 ? this.parts.pedalR : this.parts.pedalL).getWorldPosition(out);
  }
}
