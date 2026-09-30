/**
 * pelican.js — 程序化鹈鹕
 *
 * 全部由基础几何体拼装（无外部模型/贴图）：
 *   椭球躯干 + 羽毛层 → 3 段瓶颈（跟随式层级）→ 头 + 长喙 + 喉囊 + 骑行帽 / 墨镜
 *   双翼当作手臂：肩 → 肱（覆羽）→ 肘 → 前臂（初级飞羽）→ "手"抱住车把（解析 IK）
 *   双腿：髋 → 大腿 → 膝 → 胫 → 蹼足（解析 IK，脚掌贴在脚踏上）
 *   围巾：Verlet 布料链（在 sim 中驱动）
 *
 * 所有坐标都在「自行车局部空间」：+X 前进、+Y 向上、+Z 车身右侧。
 */
import * as THREE from 'three';
import { aimCylinder, solveTwoBoneIK, roundedPlate, clamp, lerp, damp, TAU, mulberry32 } from '../lib/util.js';

export const PELICAN_ANCHORS = {
  bodyC: new THREE.Vector3(-0.045, 0.830, 0),
  hip: new THREE.Vector3(0.020, 0.700, 0.085),     // x,y 与 ±z 由 side 决定
  shoulder: new THREE.Vector3(0.060, 0.960, 0.150),
  neckBase: new THREE.Vector3(0.185, 0.985, 0),
  headBase: new THREE.Vector3(0.320, 1.225, 0),
  legL1: 0.320, legL2: 0.330,
  wingL1: 0.240, wingL2: 0.262,
  footLen: 0.165, footWide: 0.105,
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _pole = new THREE.Vector3(), _knee = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);

function numberPlateTexture(text = '13') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 192;
  const x = c.getContext('2d');
  x.fillStyle = '#f7f3e6'; x.fillRect(0, 0, 256, 192);
  x.strokeStyle = '#c8452f'; x.lineWidth = 10; x.strokeRect(9, 9, 238, 174);
  x.fillStyle = '#1f2733'; x.font = 'bold 130px ui-monospace, monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 128, 104);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Pelican {
  constructor({ livery, quality = 'high' } = {}) {
    this.quality = quality;
    this.root = new THREE.Group();
    this.root.name = 'pelican';
    this.mats = this._materials(livery);
    this.feathers = [];
    this._t = 0;
    this._build();
    this.setLivery(livery);
  }

  _materials(l) {
    const std = (color, roughness = 0.8, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02, ...extra });
    return {
      feather: std(0xece5d4, 0.80),
      featherShade: std(0xdcd4c1, 0.84),
      featherDeep: std(0xc8bfab, 0.88),
      flight: std(0xb9b3a6, 0.8),
      flightTip: std(0x8d887e, 0.78),
      bill: std(0xf3c9a2, 0.42),
      billTip: std(0xe8a24f, 0.4),
      pouch: std(0xf2a04a, 0.5, { side: THREE.DoubleSide }),
      pouchInner: std(0xd9832f, 0.55, { side: THREE.DoubleSide }),
      leg: std(0xe8952f, 0.55),
      foot: std(0xe08526, 0.52),
      eyeWhite: std(0xfbfbff, 0.3),
      eyeDark: std(0x1a1c22, 0.18),
      glint: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      cap: std(l.frame, 0.55),
      capAccent: std(l.accent, 0.6),
      lens: std(0x1c2430, 0.12, { metalness: 0.5, transparent: true, opacity: 0.86 }),
      scarf: std(0xe2523f, 0.86),
      scarfAlt: std(0xf7f1e2, 0.86),
      fish: std(0xc8d4e0, 0.35, { metalness: 0.5 }),
      plate: new THREE.MeshStandardMaterial({ map: numberPlateTexture('13'), roughness: 0.7 }),
    };
  }

  setLivery(l) {
    this.livery = l;
    this.mats.cap.color.setHex(l.frame);
    this.mats.capAccent.color.setHex(l.accent);
  }

  setQuality(q) {
    this.quality = q;
    const on = q !== 'low';
    this.feathers.forEach((f, i) => { if (f.userData.lod === 'high') f.visible = on; });
  }

  /* ------------------------------------------------------------------ */
  _build() {
    const M = this.mats, A = PELICAN_ANCHORS;
    const rnd = mulberry32(20260930);

    /* ============ 躯干 ============ */
    const body = new THREE.Group();
    body.position.copy(A.bodyC);
    this.root.add(body);
    this.body = body;

    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.30, 28, 22), M.feather);
    torso.scale.set(0.62 / 0.30 / 2 * 1.0, 0.40 / 0.30 / 2, 0.36 / 0.30 / 2);
    torso.scale.set(1.03, 0.68, 0.60);
    torso.castShadow = true; torso.receiveShadow = true;
    body.add(torso);
    this.torso = torso;

    // 胸部（前下方略鼓）
    const breast = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 16), M.feather);
    breast.scale.set(0.95, 1.0, 1.02);
    breast.position.set(0.155, -0.035, 0);
    breast.castShadow = true;
    body.add(breast);

    // 腹部阴影层
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), M.featherShade);
    belly.scale.set(1.15, 0.62, 0.86);
    belly.position.set(0.02, -0.115, 0);
    body.add(belly);

    // 羽毛层：交替错位的扁椭球，形成"瓦片"感
    for (let r = 0; r < 5; r++) {
      const rows = 5 - Math.floor(r / 2);
      for (let c = 0; c < rows; c++) {
        [-1, 1].forEach((side) => {
          const f = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 9), r % 2 ? M.featherShade : M.feather);
          f.scale.set(1.05, 0.26, 0.9);
          const spread = (c - (rows - 1) / 2) / rows;
          f.position.set(-0.14 + r * 0.105, 0.115 - r * 0.048, side * (0.115 + spread * 0.05));
          f.rotation.set(0.1, side * (0.35 + spread * 0.5), -0.16 + r * 0.05);
          f.castShadow = true;
          f.userData.lod = r > 3 ? 'high' : 'low';
          body.add(f);
          this.feathers.push(f);
        });
      }
    }

    // 赛号牌（侧面）
    const plate = roundedPlate(0.135, 0.10, 0.012, 0.004, M.plate);
    plate.position.set(0.02, -0.01, -0.175);
    plate.rotation.set(0, -Math.PI / 2, 0.06);
    body.add(plate);
    const plate2 = plate.clone();
    plate2.position.z = 0.175; plate2.rotation.y = Math.PI / 2;
    plate2.material = M.featherShade;
    body.add(plate2);

    /* ============ 尾羽 ============ */
    const tail = new THREE.Group();
    tail.position.set(-0.30, 0.055, 0);
    body.add(tail);
    this.tail = tail;
    for (let i = 0; i < 7; i++) {
      const k = i - 3;
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.30 + Math.abs(k) * 0.012, 0.014, 0.055), M.featherShade);
      f.geometry.translate(0.15, 0, 0);
      f.position.set(-0.02, 0.012 - Math.abs(k) * 0.012, k * 0.026);
      f.rotation.set(0, k * 0.13, -0.30 + Math.abs(k) * 0.05);
      f.castShadow = true;
      tail.add(f);
    }
    const rump = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), M.feather);
    rump.scale.set(0.9, 0.75, 0.85);
    tail.add(rump);

    /* ============ 脖子：3 段跟随链 ============ */
    const neckSegs = [];
    const neckTop = A.headBase.clone();
    const neckStart = A.neckBase.clone();
    const N = 3;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const p0 = neckStart.clone().lerp(neckTop, t0);
      const p1 = neckStart.clone().lerp(neckTop, t1);
      const g = new THREE.Group();
      g.position.copy(p0);
      const len = p1.distanceTo(p0);
      g.userData.rest = p1.clone().sub(p0);
      g.userData.len = len;
      // 注意：这里必须用真实长度建圆柱（设计稿里原来用了高 1 的圆柱又没缩放，
      // 于是每段脖子都会变成 1 m 长的白色管子，整条脖子成一根“烟囱”）。
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.072 - i * 0.006, 0.078 - i * 0.006, len, 16), M.feather);
      mesh.geometry.translate(0, len * 0.5, 0);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), g.userData.rest.clone().normalize());
      mesh.castShadow = true;
      g.add(mesh);
      // 平铺挂在 root 下：update() 读写的 seg.position / seg.quaternion 都是 root 局部坐标，
      // 若像原来那样逐级嵌套（parent = g），这些坐标会被当成子级偏移而层层累加，脖子会飞出去。
      this.root.add(g);
      neckSegs.push(g);
      g.userData.mesh = mesh;
    }
    this.neck = neckSegs;

    /* ============ 头 ============ */
    const head = new THREE.Group();
    head.position.copy(neckTop);
    this.root.add(head);
    this.head = head;

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.088, 22, 18), M.feather);
    skull.scale.set(1.06, 0.98, 0.94);
    skull.castShadow = true;
    head.add(skull);
    this.skull = skull;
    // 后脑蓬松羽
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), M.featherShade);
      f.scale.set(1.0, 0.4, 0.8);
      f.position.set(-0.055 - i * 0.012, 0.045 - i * 0.022, (i % 2 ? 0.03 : -0.03));
      f.rotation.z = 0.4 + i * 0.12;
      head.add(f);
    }

    /* ---- 喙：上喙（长直）+ 喙尖钩 + 下喙 + 喉囊 ---- */
    const billBase = new THREE.Vector3(0.055, 0.008, 0);
    const billDir = new THREE.Vector3(0.955, -0.30, 0).normalize();
    const billLen = 0.455;
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.055, billLen, 12, 3), M.bill);
    upper.geometry.translate(0, billLen / 2, 0);
    upper.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), billDir);
    upper.position.copy(billBase);
    upper.castShadow = true;
    head.add(upper);
    // 喙脊（颜色分界）
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(billLen * 0.7, 0.006, 0.02), M.billTip);
    ridge.position.copy(billBase).addScaledVector(billDir, billLen * 0.45);
    ridge.quaternion.copy(upper.quaternion);
    ridge.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    head.add(ridge);
    // 喙尖下钩
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.075, 9), M.billTip);
    tip.quaternion.copy(upper.quaternion);
    tip.rotateZ(-0.42);
    tip.position.copy(billBase).addScaledVector(billDir, billLen + 0.012);
    tip.castShadow = true;
    head.add(tip);
    this.billTip = tip;

    // 喉囊：上下两片曲面 + 前袋（用椭球压扁模拟，随速度抖动）
    const pouch = new THREE.Group();
    pouch.position.copy(billBase);
    head.add(pouch);
    this.pouch = pouch;
    const pouchMain = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 14), M.pouch);
    pouchMain.scale.set(1.55, 0.72, 0.85);
    pouchMain.position.set(billLen * 0.40, -0.062, 0);
    pouchMain.rotation.z = -0.16;
    pouchMain.castShadow = true;
    pouch.add(pouchMain);
    const pouchFront = new THREE.Mesh(new THREE.SphereGeometry(0.078, 18, 12), M.pouchInner);
    pouchFront.scale.set(0.95, 0.80, 0.86);
    pouchFront.position.set(billLen * 0.72, -0.052, 0);
    pouch.add(pouchFront);
    // 下喙缘
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.040, billLen, 10, 3, true), M.pouchInner);
    lower.geometry.translate(0, billLen / 2, 0);
    lower.quaternion.copy(upper.quaternion);
    lower.position.copy(billBase);
    lower.position.y -= 0.042;
    pouch.add(lower);
    // 嘴里露出的鱼尾（呼应货箱）
    const fishTail = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.10, 4), M.fish);
    fishTail.position.set(billLen * 0.30, -0.100, 0.01);
    fishTail.rotation.set(0.6, 0.3, 0.9);
    pouch.add(fishTail);

    // 眼睛（含眼睑与高光）
    this.eyes = [];
    [-1, 1].forEach((s) => {
      const eyeG = new THREE.Group();
      eyeG.position.set(0.030, 0.036, s * 0.070);
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 12), M.eyeWhite);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.015, 12, 10), M.eyeDark);
      pupil.position.set(0.014, 0, s * 0.004);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), M.glint);
      glint.position.set(0.026, 0.008, s * 0.008);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0275, 14, 10, 0, TAU, 0, Math.PI / 2), M.feather);
      lid.rotation.x = Math.PI / 2;
      lid.rotation.z = 1.2;
      eyeG.add(w, pupil, glint, lid);
      eyeG.userData.lid = lid;
      lid.userData.base = 1.2;
      head.add(eyeG);
      this.eyes.push(eyeG);
    });

    // 骑行帽：帽体 + 帽檐 + 条纹
    const cap = new THREE.Group();
    cap.position.set(-0.008, 0.052, 0);
    cap.rotation.z = -0.18;
    const capDome = new THREE.Mesh(new THREE.SphereGeometry(0.095, 20, 12, 0, TAU, 0, Math.PI / 2), M.cap);
    capDome.scale.set(1.02, 1.05, 0.95);
    capDome.castShadow = true;
    const capBand = new THREE.Mesh(new THREE.TorusGeometry(0.094, 0.011, 8, 24), M.capAccent);
    capBand.rotation.x = Math.PI / 2;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.098, 0.011, 20), M.cap);
    brim.scale.set(1, 1.0, 1.45);
    brim.position.set(0.075, -0.006, 0);
    brim.rotation.z = -0.06;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.006, 0.19), M.capAccent);
    stripe.position.y = 0.095;
    cap.add(capDome, capBand, brim, stripe);
    head.add(cap);
    this.cap = cap;

    // 墨镜（速降风）
    const shades = new THREE.Group();
    [-1, 1].forEach((s) => {
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.030, 14, 10, 0, TAU, 0, Math.PI / 2), M.lens);
      lens.scale.set(1.15, 0.75, 0.9);
      lens.rotation.set(Math.PI / 2, 0, 0);
      lens.position.set(0.062, 0.032, s * 0.052);
      shades.add(lens);
    });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.115), M.capAccent);
    frame.position.set(0.058, 0.030, 0);
    shades.add(frame);
    shades.visible = false;
    head.add(shades);
    this.shades = shades;

    /* ============ 双翼（当作手臂） ============ */
    this.wings = {};
    [-1, 1].forEach((side) => {
      const wingRoot = new THREE.Group();
      wingRoot.position.copy(A.shoulder).setZ(side * A.shoulder.z);
      this.root.add(wingRoot);
      // 肩羽（覆羽层：短羽 5 片）
      const covert = [];
      for (let i = 0; i < 5; i++) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.13 + i * 0.012, 0.011, 0.042), M.featherShade);
        f.geometry.translate(0.06, 0, 0);
        f.position.set(-0.02, -0.008 * i, side * (0.012 + i * 0.006));
        f.rotation.set(0, side * (0.2 + i * 0.06), -0.25 - i * 0.05);
        f.castShadow = true;
        f.userData.lod = i > 2 ? 'high' : 'low';
        wingRoot.add(f);
        covert.push(f);
        this.feathers.push(f);
      }
      const shoulderBall = new THREE.Mesh(new THREE.SphereGeometry(0.062, 14, 11), M.feather);
      shoulderBall.scale.set(0.9, 0.8, 1.15);
      shoulderBall.castShadow = true;
      wingRoot.add(shoulderBall);
      // 肱骨（上臂）
      const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), M.feather);
      upperArm.castShadow = true;
      this.root.add(upperArm);
      // 前臂
      const foreArm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), M.featherShade);
      foreArm.castShadow = true;
      this.root.add(foreArm);
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 10), M.feather);
      elbow.castShadow = true;
      this.root.add(elbow);
      const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 10), M.featherShade);
      this.root.add(wrist);
      // "手"：初级飞羽抱住车把，羽片沿把轴排开
      const hand = new THREE.Group();
      this.root.add(hand);
      const primaries = [];
      for (let i = 0; i < 7; i++) {
        const len = 0.30 - i * 0.022;
        const f = new THREE.Mesh(new THREE.BoxGeometry(len, 0.010, 0.036), M.flight);
        f.geometry.translate(len / 2, 0, 0);
        f.position.set(0.01, -0.004 * i, side * (-0.03 + i * 0.012));
        f.rotation.set(0, side * (0.5 - i * 0.16), -0.35 - i * 0.09);
        f.castShadow = true;
        f.userData.lod = i > 4 ? 'high' : 'low';
        hand.add(f);
        primaries.push(f);
        this.feathers.push(f);
      }
      // 次级飞羽（垂在下方，骑行时飘动）
      const secondaries = [];
      for (let i = 0; i < 5; i++) {
        const len = 0.24 - i * 0.02;
        const f = new THREE.Mesh(new THREE.BoxGeometry(len, 0.009, 0.032), M.flightTip);
        f.geometry.translate(len / 2, 0, 0);
        f.position.set(-0.02, -0.02 * i, side * (0.02 + i * 0.014));
        f.rotation.set(0, side * (0.85 - i * 0.12), -0.55 - i * 0.12);
        f.castShadow = true;
        f.userData.lod = i > 2 ? 'high' : 'low';
        hand.add(f);
        secondaries.push(f);
        this.feathers.push(f);
      }
      this.wings[side > 0 ? 'R' : 'L'] = {
        side, root: wingRoot, upperArm, foreArm, elbow, wrist, hand, covert, primaries, secondaries,
        l1: A.wingL1, l2: A.wingL2,
      };
    });

    /* ============ 双腿 ============ */
    this.legs = [];
    [-1, 1].forEach((side) => {
      const hip = new THREE.Group();
      hip.position.copy(A.hip).setZ(side * A.hip.z);
      this.root.add(hip);
      const hipBall = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), M.featherShade);
      hipBall.scale.set(0.9, 0.9, 1.0);
      hip.add(hipBall);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), M.leg);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 9), M.leg);
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), M.leg);
      const heel = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), M.leg);
      [thigh, shin, knee, heel].forEach((m) => { m.castShadow = true; this.root.add(m); });
      // 蹼足：掌 + 3 趾 + 蹼膜
      const foot = new THREE.Group();
      const sole = new THREE.Mesh(new THREE.BoxGeometry(A.footLen, 0.020, A.footWide), M.foot);
      sole.geometry.translate(A.footLen * 0.42, 0, 0);
      sole.castShadow = true;
      foot.add(sole);
      const web = new THREE.Mesh(new THREE.BoxGeometry(A.footLen * 0.86, 0.005, A.footWide * 1.05), M.foot);
      web.geometry.translate(A.footLen * 0.45, -0.008, 0);
      foot.add(web);
      for (let i = -1; i <= 1; i++) {
        const toe = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, A.footLen * 0.55, 3, 8), M.foot);
        toe.rotation.z = Math.PI / 2;
        toe.rotation.y = i * 0.28;
        toe.position.set(A.footLen * 0.80, 0.001, i * A.footWide * 0.33);
        foot.add(toe);
      }
      this.root.add(foot);
      this.legs.push({ side, hip, thigh, shin, knee, heel, foot, l1: A.legL1, l2: A.legL2 });
    });

    /* ============ 围巾（Verlet 布料，sim 中驱动） ============ */
    const scarf = new THREE.Group();
    this.root.add(scarf);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.028, 8, 22), M.scarf);
    collar.position.set(A.neckBase.x - 0.02, A.neckBase.y + 0.01, 0);
    collar.rotation.set(Math.PI / 2, 0, 0.25);
    collar.castShadow = true;
    scarf.add(collar);
    this.scarf = { root: scarf, segs: [], points: [], prev: [] };
    const SC = 9;
    const nb = A.neckBase;
    for (let i = 0; i < SC; i++) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.014, 0.115), i % 2 ? M.scarf : M.scarfAlt);
      mesh.geometry.translate(0, 0, 0.055);
      mesh.castShadow = true;
      g.add(mesh);
      scarf.add(g);
      this.scarf.segs.push(g);
      this.scarf.points.push(new THREE.Vector3(nb.x - 0.03 - i * 0.105, nb.y - 0.015 - i * 0.030, -0.030 - i * 0.012));
      this.scarf.prev.push(this.scarf.points[i].clone());
    }
    this.scarf.origin = new THREE.Vector3(0, -0.02, -0.10);   // 挂在脖子右侧、向后飘
  }

  /* ------------------------------------------------------------------ */
  /** 每帧：IK 求解 + 程序化动画 + 围巾 Verlet */
  update(dt, st) {
    this._t += dt;
    const t = this._t;
    const A = PELICAN_ANCHORS;
    const P = this.root;

    /* --- 整体姿态：加速后仰、刹车前倾、转向侧倾、蹦跳 --- */
    // 轴向约定：+X 车头前进 → 绕 X 为「侧倾(压弯)」，绕 Z 为「俯仰(后仰/前倾)」
    const pitch = clamp(st.accel * 0.024, -0.16, 0.18) - st.brake * 0.07;
    P.rotation.x = damp(P.rotation.x, st.steerSmooth * 0.30, 8, dt);      // 压弯
    P.rotation.z = damp(P.rotation.z, pitch + st.pitchBoost, 7, dt);      // 俯仰
    P.position.y = st.hopY;
    P.position.z = damp(P.position.z, st.steerSmooth * 0.018, 8, dt);

    // IK 目标由「车体局部空间」转入本 root 局部空间（补偿本帧姿态）
    const _inv = new THREE.Matrix4().compose(P.position, P.quaternion, _one).invert();
    const iGrips = [st.grips[0].clone().applyMatrix4(_inv), st.grips[1].clone().applyMatrix4(_inv)];
    const iPedals = [st.pedals[0].clone().applyMatrix4(_inv), st.pedals[1].clone().applyMatrix4(_inv)];

    /* --- 躯干呼吸 / 踩踏反作用力 --- */
    const cad = st.crankAngle;
    const pulse = Math.sin(cad * 2) * st.cadence / 90;
    this.body.scale.setScalar(1 + pulse * 0.012);
    this.body.rotation.x = -pulse * 0.035;                                    // 踩踏反作用：左右微摆
    this.body.rotation.z = st.accel * 0.012 + Math.sin(t * 1.6) * 0.012;      // 呼吸：前后微摆

    /* --- 脖子：跟随式（延迟 + 阻尼），头部朝前看 --- */
    const neckTarget = A.headBase.clone();
    neckTarget.y += Math.sin(cad * 2) * 0.012 * (st.cadence / 80) + Math.sin(t * 1.2) * 0.008;
    neckTarget.x += st.brake * 0.03 - st.accel * 0.012;
    neckTarget.z += -st.steerSmooth * 0.05;
    const segLen = this.neck.map((s) => s.userData.len);
    let cur = A.neckBase.clone();
    let prevDir = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.neck.length; i++) {
      const remaining = this.neck.length - i;
      const target = i === this.neck.length - 1 ? neckTarget : neckTarget.clone().lerp(cur, (remaining - 1) / this.neck.length);
      const dir = target.clone().sub(cur);
      if (dir.lengthSq() < 1e-8) dir.copy(prevDir);
      dir.normalize();
      const seg = this.neck[i];
      // 平滑朝向 + 轻微侧向摆动
      const up = new THREE.Vector3(0, 1, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
      const sway = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(t * 2.1 + i * 0.9) * 0.02);
      q.multiply(sway);
      seg.quaternion.slerp(q, 1 - Math.exp(-14 * dt));
      cur = seg.position.clone().add(dir.multiplyScalar(segLen[i]));
      prevDir = dir;
    }
    this.head.position.copy(cur);
    // 头：朝向 + 顶点噪声
    const headLook = new THREE.Vector3(st.lookDir ? st.lookDir.x : 1, 0.06, st.lookDir ? st.lookDir.z : 0).normalize();
    const headQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), headLook);
    headQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(t * 3.3) * 0.03 - st.accel * 0.004));
    this.head.quaternion.slerp(headQ, 1 - Math.exp(-9 * dt));

    // 喉囊抖动（速度越快晃得越厉害）
    const wob = Math.sin(t * 9 + Math.sin(t * 2.3)) * (0.02 + st.speed * 0.0016);
    this.pouch.scale.set(1 + wob * 0.6, 1 + wob, 1 + wob * 0.4);
    this.pouch.rotation.z = wob * 0.4;
    this.shades.visible = !!st.shades;
    // 眨眼
    this._blinkT = (this._blinkT ?? 2.5) - dt;
    const blink = this._blinkT < 0.14 ? 1 : 0;
    if (this._blinkT < 0) this._blinkT = 2.6 + Math.random() * 3.4;
    this.eyes.forEach((e) => {
      const lid = e.userData.lid;
      lid.rotation.z = lid.userData.base + blink * 1.35;
    });
    // 帽子随速度后掀
    this.cap.rotation.z = 0.10 + clamp(st.speed * 0.005, 0, 0.14) + Math.sin(t * 7) * 0.01;  // 帽檐随速度后掀
    // 尾羽摆动
    this.tail.rotation.z = Math.sin(t * 2.4) * 0.06 + st.accel * 0.01;
    this.tail.rotation.y = -st.steerSmooth * 0.25;

    /* --- 双翼：IK 到车把（握把），蹦跳时展开拍打 --- */
    [-1, 1].forEach((side) => {
      const w = this.wings[side > 0 ? 'R' : 'L'];
      const grip = iGrips[side > 0 ? 1 : 0];
      const shoulder = w.root.position.clone();
      // 起跳/摇铃时手掌离把
      const flap = st.wingFlap || 0;
      const handTarget = grip.clone().add(new THREE.Vector3(0, 0.03 * flap, side * 0.02 * flap));
      if (flap > 0.01) handTarget.add(new THREE.Vector3(Math.sin(t * 22) * 0.05, 0.14 * flap, 0));
      _pole.set(0.35, -0.35, side * 0.9).normalize();
      solveTwoBoneIK(shoulder, handTarget, w.l1, w.l2, _pole, _knee);
      const elbow = _knee;
      aimCylinder(w.upperArm, shoulder, elbow, 0.052);
      aimCylinder(w.foreArm, elbow, handTarget, 0.034);
      w.elbow.position.copy(elbow);
      w.wrist.position.copy(handTarget);
      w.hand.position.copy(handTarget);
      // 手掌朝向：局部 X 指向车把轴线（Z），并让羽片环绕把横
      const barAxis = new THREE.Vector3(0, 0, 1);
      const handDir = new THREE.Vector3().subVectors(handTarget, elbow).normalize();
      const zAxis = barAxis.clone().normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, handDir).normalize();
      const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
      const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
      const q = new THREE.Quaternion().setFromRotationMatrix(basis);
      // 羽片随风抖动
      const flutter = Math.sin(t * 12 + side) * 0.02 + clamp(st.speed * 0.002, 0, 0.08);
      w.hand.quaternion.slerp(q, 1 - Math.exp(-8 * dt));
      w.primaries.forEach((f, i) => { f.rotation.x = Math.sin(t * 10 + i * 0.7) * flutter; });
      w.secondaries.forEach((f, i) => { f.rotation.x = -Math.sin(t * 8 + i * 0.9) * flutter * 1.6; });
      w.covert.forEach((f, i) => { f.rotation.x = Math.sin(t * 6 + i) * 0.02 + flap * 0.2; });
      w.root.quaternion.slerp(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3().subVectors(elbow, shoulder).normalize()),
        1 - Math.exp(-12 * dt)
      );
    });

    /* --- 双腿：IK 到脚踏，蹼足保持水平 --- */
    this.legs.forEach((L) => {
      const pedal = iPedals[L.side > 0 ? 1 : 0];
      const hip = L.hip.position.clone();
      _pole.set(0.6, 0.0, L.side * 0.8).normalize();
      solveTwoBoneIK(hip, pedal, L.l1, L.l2, _pole, _knee);
      const knee = _knee;
      aimCylinder(L.thigh, hip, knee, 0.046);
      aimCylinder(L.shin, knee, pedal, 0.030);
      L.knee.position.copy(knee);
      L.heel.position.copy(pedal);
      L.foot.position.copy(pedal);
      // 脚掌：与脚踏同向（水平），并随速度轻微摆动
      const footQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), st.steerSmooth * 0.5);
      L.foot.quaternion.copy(footQ);
      L.foot.rotateZ(-0.06 + Math.sin(t * 5 + L.side) * 0.03 * (st.cadence / 80));
    });

    /* --- 围巾 Verlet --- */
    this._updateScarf(dt, st, A);
  }

  _updateScarf(dt, st, A) {
    const S = this.scarf;
    const rootPos = S.root.position;
    const gravity = new THREE.Vector3(0, -9.8, 0);
    // 风：与骑行方向相反的相对风 + 侧风
    const speed = st.speed;
    const wind = new THREE.Vector3(-speed * 0.55, 0.10, Math.sin(this._t * 0.7) * 0.35 - st.steerSmooth * 1.2);
    const drag = 0.86;
    const segLen = 0.115;
    const damping = Math.exp(-1.6 * dt);
    for (let i = 0; i < S.points.length; i++) {
      const p = S.points[i], prev = S.prev[i];
      if (i === 0) {
        // 锚点：跟随脖子根部（本 root 局部空间）
        const anchor = new THREE.Vector3(A.neckBase.x - 0.03, A.neckBase.y - 0.015, -0.03);
        p.copy(anchor);
        prev.copy(anchor);
        continue;
      }
      const v = new THREE.Vector3().subVectors(p, prev).multiplyScalar(damping);
      prev.copy(p);
      p.add(v);
      p.addScaledVector(gravity, dt * dt * 0.55);
      p.addScaledVector(wind, dt * dt * 0.85);
      // 与躯干做一次简单碰撞（近似椭球外推）
      const dBody = new THREE.Vector3(p.x - A.bodyC.x, p.y - A.bodyC.y, p.z - A.bodyC.z);
      const r = Math.hypot(dBody.x / 0.33, dBody.y / 0.24, dBody.z / 0.20);
      if (r < 1) {
        dBody.multiplyScalar(1 / Math.max(r, 1e-3));
        p.set(A.bodyC.x + dBody.x * 0.33, A.bodyC.y + dBody.y * 0.24, A.bodyC.z + dBody.z * 0.20);
      }
      // 与鞍座/后轮上方保持在地面之上
      p.y = Math.max(p.y, 0.62);
      // 距离约束（迭代 2 次，串珠）
      const dir = new THREE.Vector3().subVectors(p, S.points[i - 1]);
      const d = dir.length() || 1e-5;
      if (d > segLen) {
        dir.multiplyScalar((d - segLen) / d);
        p.sub(dir);
      }
      // 最大弯曲限制（避免锐角）
      if (i > 1) {
        const prevDir = new THREE.Vector3().subVectors(S.points[i - 1], S.points[i - 2]).normalize();
        const curDir = new THREE.Vector3().subVectors(p, S.points[i - 1]).normalize();
        const dot = clamp(prevDir.dot(curDir), -1, 1);
        const ang = Math.acos(dot);
        const maxAng = 0.75;
        if (ang > maxAng) {
          const axis = new THREE.Vector3().crossVectors(prevDir, curDir).normalize();
          if (axis.lengthSq() > 1e-6) {
            const q = new THREE.Quaternion().setFromAxisAngle(axis, ang - maxAng);
            curDir.applyQuaternion(q);
            p.copy(S.points[i - 1]).addScaledVector(curDir, segLen);
          }
        }
      }
    }
    // 写回可视网格：位置 + 朝向 + 扭转
    for (let i = 0; i < S.segs.length; i++) {
      const a = S.points[i], b = i < S.points.length - 1 ? S.points[i + 1] : S.points[i];
      const g = S.segs[i];
      g.position.copy(a);
      const dir = new THREE.Vector3().subVectors(b, a).normalize();
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.lengthSq() > 1e-6 ? dir : new THREE.Vector3(0, 0, 1));
      g.rotation.z += Math.sin(this._t * 6 + i * 0.6) * 0.06;
    }
  }

  /** 供 sim 使用的锚点（自行车局部空间） */
  get anchors() { return PELICAN_ANCHORS; }
}
