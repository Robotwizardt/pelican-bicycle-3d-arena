/**
 * creature/pelican.js —— 大白鹈鹕（Pelecanus onocrotalus）
 *
 * 造型依据（Audubon / BirdForum / Wikipedia 检索到的特征）：
 *  - 通体白羽，只有初级飞羽黑（"wings with black primaries and secondaries,
 *    contrasting abruptly with white wing coverts"）
 *  - 颈后有一撮松散下垂的短冠羽
 *  - 眼周裸皮在繁殖展示期会转粉/橙；淡黄色虹膜
 *  - 巨喙 + 黄喉囊（gular pouch），上喙末端下钩成「爪」
 *  - 腿短、橙脚、**四趾全蹼**（totipalmate）—— 本页的核心笑点
 *
 * 坐标约定：鹈鹕本地 +X 为前方（喙尖方向），+Y 向上，+Z 为左。
 * 所有「动画用」的节点都挂在 parts 里，并在文件末尾注释了它们的驱动方式。
 */
import * as THREE from 'three';
import { clamp01, lerp, TAU } from '../util.js';
import { ellipseSection, makeFeather, sweepTube, wedgeSection } from '../scene/geom.js';

/** 鹈鹕的解剖比例（本地单位，米）。以 1.5m 长的鸟为基准。 */
export const PELICAN = {
  bodyLen: 0.86,
  bodyR: 0.30,
  tailLen: 0.40,
  neckLen: 0.55,
  headR: 0.115,
  beakLen: 0.42,
  pouchLen: 0.34,
  legUpper: 0.17,
  legLower: 0.16,
  footLen: 0.17,
  wingSpan: 1.32,
};

export function createPelican({ texture = null, flatShading = false } = {}) {
  const root = new THREE.Group();
  root.name = 'pelican';

  /* ---------------- 材质 ---------------- */
  const white = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f6f3ec'),
    roughness: 0.78,
    metalness: 0.0,
    map: texture,
    flatShading,
  });
  const black = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#241f1e'),
    roughness: 0.72,
    metalness: 0.0,
    flatShading,
  });
  const beakMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f0b93f'),
    roughness: 0.42,
    metalness: 0.06,
    flatShading,
  });
  const pouchMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f6d268'),
    roughness: 0.34,
    metalness: 0.02,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
    flatShading,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f0c05a'),
    roughness: 0.5,
    flatShading,
  });
  const legMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#e08b3c'),
    roughness: 0.62,
    metalness: 0.0,
    flatShading,
  });
  const webMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d97b34'),
    roughness: 0.66,
    metalness: 0.0,
    side: THREE.DoubleSide,
    flatShading,
  });
  const eyeWhiteMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f7e6a8'),
    roughness: 0.28,
    emissive: new THREE.Color('#40300c'),
    emissiveIntensity: 0.35,
  });
  const pupilMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#0b0a09'),
    roughness: 0.12,
    metalness: 0.0,
  });
  const irisMaskMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f2c53f'),
    roughness: 0.3,
    emissive: new THREE.Color('#5a4410'),
    emissiveIntensity: 0.5,
  });

  const add = (parent, mesh, cast = true, receive = false) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    parent.add(mesh);
    return mesh;
  };

  /* ================================================================
   * 躯干：用一个沿 X 轴的扫掠管做出「前胸饱满、臀部收窄」的胶囊形，
   * 再按高度压扁成椭圆截面（鸟是侧扁的身体）。
   * ================================================================ */
  const bodyPivot = new THREE.Group(); // 绕 Z 轴的侧倾/前后倾用
  root.add(bodyPivot);

  const bodyCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.40, 0.0, 0),
    new THREE.Vector3(-0.22, 0.03, 0),
    new THREE.Vector3(0.0, 0.02, 0),
    new THREE.Vector3(0.20, 0.0, 0),
    new THREE.Vector3(0.33, -0.03, 0),
    new THREE.Vector3(0.42, -0.07, 0),
  ]);
  const bodyGeo = sweepTube(bodyCurve, {
    steps: 34,
    radial: 20,
    radius: (t) => {
      // 后端小、前端大，肩部最宽
      const base = Math.sin(Math.pow(t, 0.85) * Math.PI * 0.98 + 0.06);
      return PELICAN.bodyR * (0.42 + 0.72 * Math.pow(base, 0.8));
    },
    section: ellipseSection((a) => 1.0, (a) => 0.92),
    caps: true,
  });
  const body = add(bodyPivot, new THREE.Mesh(bodyGeo, white), true, true);

  // 胸部的一小撮蓬松羽毛（让轮廓不那么「管子」）
  const chestPlume = new THREE.Group();
  chestPlume.position.set(0.30, -0.05, 0);
  bodyPivot.add(chestPlume);
  for (let i = 0; i < 7; i++) {
    const f = makeFeather({ length: 0.20, width: 0.10, droop: 0.06, twist: (i - 3) * 0.06 });
    const m = new THREE.Mesh(f, white);
    m.position.set(0, -0.02 + (i % 3) * 0.03, ((i - 3) / 3) * 0.16);
    m.rotation.y = ((i - 3) / 3) * 0.5;
    m.rotation.z = -0.5 + (i % 2) * 0.1;
    m.scale.setScalar(0.9 + (i % 3) * 0.12);
    chestPlume.add(m);
  }

  /* ================================================================
   * 尾羽：5 片，向后下方展开的扇面
   * ================================================================ */
  const tailPivot = new THREE.Group();
  tailPivot.position.set(-0.38, 0.0, 0);
  bodyPivot.add(tailPivot);
  const tailFeathers = [];
  for (let i = 0; i < 7; i++) {
    const f = (i / 6 - 0.5); // -0.5..0.5
    const feather = new THREE.Mesh(
      makeFeather({ length: PELICAN.tailLen, width: 0.11, droop: 0.05, twist: f * 0.3 }),
      white
    );
    feather.position.set(0, 0, f * 0.05);
    feather.rotation.y = f * 0.55;
    feather.rotation.z = 0.12 + Math.abs(f) * 0.06;
    feather.scale.setScalar(1 - Math.abs(f) * 0.22);
    tailPivot.add(feather);
    tailFeathers.push(feather);
  }

  /* ================================================================
   * 翅膀：躯干 → 上臂 → 前臂 → 手掌，各用一段扫掠管；飞羽挂在手掌上
   * ================================================================ */
  const wings = {};
  for (const side of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.10, 0.10, side * 0.20);
    bodyPivot.add(shoulder);

    // 上臂（内收）
    const upperArm = new THREE.Group();
    shoulder.add(upperArm);
    const uaCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-0.06, 0.03, side * 0.10),
      new THREE.Vector3(-0.14, 0.05, side * 0.20),
    ]);
    const ua = new THREE.Mesh(
      sweepTube(uaCurve, {
        steps: 8,
        radial: 10,
        radius: (t) => lerp(0.115, 0.085, t),
        section: ellipseSection(1, 0.7),
      }),
      white
    );
    add(upperArm, ua);

    // 前臂
    const foreArm = new THREE.Group();
    foreArm.position.set(-0.14, 0.05, side * 0.20);
    upperArm.add(foreArm);
    const faCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-0.14, 0.01, side * 0.09),
      new THREE.Vector3(-0.30, -0.01, side * 0.06),
    ]);
    const fa = new THREE.Mesh(
      sweepTube(faCurve, {
        steps: 10,
        radial: 10,
        radius: (t) => lerp(0.085, 0.055, t),
        section: ellipseSection(1, 0.62),
      }),
      white
    );
    add(foreArm, fa);

    // 手掌（腕）
    const hand = new THREE.Group();
    hand.position.set(-0.30, -0.01, side * 0.06);
    foreArm.add(hand);

    // 翼膜：三角楔形
    const membraneShape = new THREE.Shape();
    membraneShape.moveTo(0, 0);
    membraneShape.quadraticCurveTo(-0.16, 0.06, -0.30, 0.10);
    membraneShape.quadraticCurveTo(-0.18, -0.02, 0, -0.06);
    membraneShape.closePath();
    const membrane = new THREE.Mesh(
      new THREE.ShapeGeometry(membraneShape, 12),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#e9e5da'), side: THREE.DoubleSide, roughness: 0.8 })
    );
    membrane.rotation.y = side * Math.PI * 0.5;
    membrane.scale.set(1, 1, 1);
    hand.add(membrane);

    // 飞羽：10 片初级（黑）+ 6 片次级（白），扇形挂在手掌上
    const primaries = [];
    const secondaries = [];
    const primaryCount = 10;
    for (let i = 0; i < primaryCount; i++) {
      const u = i / (primaryCount - 1);
      const feather = new THREE.Mesh(
        makeFeather({
          length: lerp(0.30, 0.52, u),
          width: lerp(0.05, 0.075, u),
          droop: 0.02,
          twist: lerp(0.0, 0.35, u),
        }),
        black
      );
      // 沿手掌后缘排布，越往外越长
      feather.position.set(-0.06 - u * 0.04, -0.01 - u * 0.02, -u * 0.02);
      feather.rotation.y = Math.PI + u * 0.28 * side;
      feather.rotation.z = -0.10 + u * 0.06;
      feather.scale.setScalar(lerp(0.85, 1.15, u));
      hand.add(feather);
      primaries.push(feather);
    }
    for (let i = 0; i < 7; i++) {
      const u = i / 6;
      const feather = new THREE.Mesh(
        makeFeather({ length: lerp(0.34, 0.20, u), width: 0.06, droop: 0.03, twist: 0.1 }),
        white
      );
      feather.position.set(-0.02, -0.02 - u * 0.01, 0.04 - u * 0.10);
      feather.rotation.y = Math.PI * 0.92 - u * 0.14 * side;
      feather.rotation.z = -0.06;
      hand.add(feather);
      secondaries.push(feather);
    }

    // 肩部覆羽：几片白色小羽盖住关节
    for (let i = 0; i < 4; i++) {
      const f = makeFeather({ length: 0.18, width: 0.09, droop: 0.03 });
      const m = new THREE.Mesh(f, white);
      m.position.set(0.0, -0.02, side * (0.02 + i * 0.045));
      m.rotation.y = side * (0.4 + i * 0.2);
      m.rotation.z = 0.6;
      shoulder.add(m);
    }

    wings[side > 0 ? 'left' : 'right'] = { shoulder, upperArm, foreArm, hand, primaries, secondaries, membrane };
  }

  /* ================================================================
   * 脖子：S 形曲线扫掠。下段粗壮、上段细，转折处有明显的「衣领」膨大。
   * ================================================================ */
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0.33, 0.02, 0);
  bodyPivot.add(neckPivot);

  const neckCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.02, -0.02, 0),
    new THREE.Vector3(0.05, 0.12, 0),
    new THREE.Vector3(0.02, 0.28, 0),
    new THREE.Vector3(-0.04, 0.42, 0),
    new THREE.Vector3(0.0, 0.52, 0),
  ]);
  const neckGeo = sweepTube(neckCurve, {
    steps: 26,
    radial: 14,
    radius: (t) => {
      // 根部粗（胸上方的羽领），中段最细（真正的 S 颈），头部前略收
      const base = 0.115;
      const s = Math.sin(Math.pow(t, 0.9) * Math.PI);
      const thin = lerp(1.0, 0.52, Math.sin(t * Math.PI));
      const collar = 1 + 0.32 * Math.exp(-Math.pow((t - 0.06) / 0.16, 2));
      return base * lerp(0.62, 1.0, s) * thin * collar;
    },
    section: ellipseSection(1, 0.86),
  });
  const neck = add(neckPivot, new THREE.Mesh(neckGeo, white));

  // 颈后短冠羽（"long, loose nape feathers"）
  const nape = new THREE.Group();
  nape.position.set(-0.05, 0.44, 0);
  neckPivot.add(nape);
  for (let i = 0; i < 5; i++) {
    const u = (i - 2) / 2;
    const f = makeFeather({ length: 0.14, width: 0.05, droop: 0.07, twist: u * 0.2 });
    const m = new THREE.Mesh(f, white);
    m.position.set(0, 0, u * 0.045);
    m.rotation.y = Math.PI + u * 0.35;
    m.rotation.z = 1.5;
    m.scale.setScalar(0.85 + (i % 2) * 0.25);
    nape.add(m);
  }

  /* ================================================================
   * 头 + 喙 + 喉囊
   * ================================================================ */
  const headPivot = new THREE.Group();
  headPivot.position.set(0.0, 0.52, 0);
  neckPivot.add(headPivot);

  const head = new THREE.Mesh(new THREE.SphereGeometry(PELICAN.headR, 20, 16), white);
  head.scale.set(1.12, 1.0, 0.95);
  add(headPivot, head);

  // 眼周裸皮（繁殖期粉橙）：两片贴在眼下的薄片
  const facePatchMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#e8a05a'),
    roughness: 0.55,
    side: THREE.DoubleSide,
    flatShading,
  });
  const eyePatches = [];
  for (const side of [1, -1]) {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(0.062, 20), facePatchMat);
    patch.position.set(0.085, 0.018, side * 0.078);
    patch.rotation.y = side * Math.PI * 0.5;
    patch.scale.set(1, 1.15, 1);
    headPivot.add(patch);
    eyePatches.push(patch);

    // 眼球：巩膜(淡黄) + 瞳孔 + 高光点
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 12), eyeWhiteMat);
    eye.position.set(0.098, 0.022, side * 0.082);
    eye.scale.set(0.85, 1, 1);
    add(headPivot, eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.019, 12, 10), pupilMat);
    pupil.position.set(0.117, 0.024, side * 0.086);
    headPivot.add(pupil);
    const shine = new THREE.Mesh(
      new THREE.SphereGeometry(0.006, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    shine.position.set(0.128, 0.036, side * 0.09);
    headPivot.add(shine);

    // 眼眶圈（淡黄）
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.007, 6, 18), irisMaskMat);
    ring.position.set(0.101, 0.022, side * 0.083);
    ring.rotation.y = side * Math.PI * 0.5;
    headPivot.add(ring);
  }

  /* --- 上喙：从额头延伸的长而直的喙，末端下钩 --- */
  const beakCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.06, 0.035, 0),
    new THREE.Vector3(0.18, 0.028, 0),
    new THREE.Vector3(0.30, 0.012, 0),
    new THREE.Vector3(0.385, -0.012, 0),
    new THREE.Vector3(0.425, -0.055, 0), // 钩尖下垂
  ]);
  const beakGeo = sweepTube(beakCurve, {
    steps: 26,
    radial: 12,
    radius: (t) => lerp(0.055, 0.016, Math.pow(t, 0.75)),
    // 截面沿程收窄：喙根宽扁、喙尖细高
    section: wedgeSection((t) => lerp(1.55, 0.6, t), (t) => lerp(0.62, 0.45, t)),
    caps: true,
  });
  const beak = add(headPivot, new THREE.Mesh(beakGeo, beakMat));

  // 喙脊线（上下喙的分界）：一条细管
  const ridgeCurve = new THREE.CatmullRomCurve3(
    beakCurve.points.map((p) => new THREE.Vector3(p.x, p.y + 0.006, 0))
  );
  const ridge = new THREE.Mesh(
    sweepTube(ridgeCurve, {
      steps: 14,
      radial: 6,
      radius: () => 0.006,
    }),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#c98f24'), roughness: 0.5 })
  );
  headPivot.add(ridge);

  // 鼻孔：喙根两侧的小洞
  for (const side of [1, -1]) {
    const nostril = new THREE.Mesh(
      new THREE.CircleGeometry(0.010, 8),
      new THREE.MeshBasicMaterial({ color: 0x4a3510 })
    );
    nostril.position.set(0.10, 0.048, side * 0.052);
    nostril.rotation.set(0, side * 1.2, -0.2);
    headPivot.add(nostril);
  }

  /* --- 喉囊：下喙与颈之间的大袋子，随状态改变充盈度 ---
   * 用一个「贴在下颌线上的椭球」做出，底部再叠一片蹼状薄膜（更薄、更透）。 */
  const pouchPivot = new THREE.Group();
  pouchPivot.position.set(0.02, -0.01, 0);
  headPivot.add(pouchPivot);

  const pouchCore = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), pouchMat);
  pouchCore.scale.set(1.55, 0.72, 0.86);
  pouchCore.position.set(0.10, -0.085, 0);
  pouchCore.castShadow = true;
  pouchPivot.add(pouchCore);

  // 囊底的薄膜（更黄、更薄，随充盈度下垂）
  const pouchSkin = new THREE.Mesh(
    new THREE.SphereGeometry(0.105, 20, 14, 0, TAU, Math.PI * 0.42, Math.PI * 0.58),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#ffd97a'),
      roughness: 0.3,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      flatShading,
    })
  );
  pouchSkin.scale.set(1.6, 0.9, 0.9);
  pouchSkin.position.set(0.105, -0.09, 0);
  pouchSkin.castShadow = true;
  pouchPivot.add(pouchSkin);

  // 囊上的细纹（横向的几条浅色线，用细管做）
  for (let i = 0; i < 3; i++) {
    const ringCurve = new THREE.CatmullRomCurve3(
      Array.from({ length: 12 }, (_, k) => {
        const a = (k / 11) * Math.PI;
        return new THREE.Vector3(
          0.105 + Math.cos(a) * 0.02,
          -0.09 - 0.055 - i * 0.018 + Math.sin(a) * 0.012,
          Math.sin(a) * 0.155
        );
      })
    );
    const line = new THREE.Mesh(
      sweepTube(ringCurve, { steps: 12, radial: 5, radius: () => 0.0035, closed: true }),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#e0a83a'), roughness: 0.45 })
    );
    pouchPivot.add(line);
  }

  /* ================================================================
   * 腿与全蹼足（totipalmate）—— 全场唯一的笑点所在，请仔细看
   * ================================================================ */
  const legs = {};
  for (const side of [1, -1]) {
    // hip -> knee -> ankle 的三级结构，便于用两段式 IK 控制踩踏
    const hip = new THREE.Group();
    hip.position.set(0.02, -0.22, side * 0.135);
    bodyPivot.add(hip);

    const upper = new THREE.Group(); // 股骨（缩在羽里）
    hip.add(upper);
    const upperGeo = sweepTube(
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.01, -PELICAN.legUpper, 0)]),
      { steps: 4, radial: 8, radius: (t) => lerp(0.045, 0.034, t) }
    );
    add(upper, new THREE.Mesh(upperGeo, legMat));

    const knee = new THREE.Group(); // 膝（鹈鹕的「跗关节」之上）
    knee.position.set(0.01, -PELICAN.legUpper, 0);
    upper.add(knee);
    const kneeBall = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), legMat);
    add(knee, kneeBall);

    const lower = new THREE.Group(); // 跗跖骨段（外露的那截「橙脚」）
    knee.add(lower);
    const lowerGeo = sweepTube(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.005, -PELICAN.legLower * 0.55, 0),
        new THREE.Vector3(0.0, -PELICAN.legLower, 0),
      ]),
      { steps: 8, radial: 8, radius: (t) => lerp(0.030, 0.024, t) }
    );
    add(lower, new THREE.Mesh(lowerGeo, legMat));

    const ankle = new THREE.Group();
    ankle.position.set(0, -PELICAN.legLower, 0);
    lower.add(ankle);

    const foot = new THREE.Group();
    ankle.add(foot);

    // 蹼：一张膜，形状 = 四趾之间的三角并集（用 ShapeGeometry 画）
    const webShape = new THREE.Shape();
    const L = PELICAN.footLen;
    const halfSpread = 0.052;
    // 蹼膜轮廓：前缘三段弧（趾尖），后缘跟踝
    webShape.moveTo(-0.03, -0.028);
    webShape.quadraticCurveTo(L * 0.42, halfSpread * 1.05, L * 0.72, halfSpread * 0.85);
    webShape.quadraticCurveTo(L * 0.96, halfSpread * 0.55, L, 0.012);
    webShape.quadraticCurveTo(L * 0.96, -halfSpread * 0.55, L * 0.72, -halfSpread * 0.85);
    webShape.quadraticCurveTo(L * 0.42, -halfSpread * 1.05, -0.03, -0.028);
    webShape.closePath();
    const web = new THREE.Mesh(
      new THREE.ShapeGeometry(webShape, 14),
      webMat
    );
    web.rotation.x = -Math.PI / 2;
    web.position.y = -0.004;
    web.receiveShadow = true;
    foot.add(web);

    // 四根趾（中间最长）—— 鹈鹕的「四趾全蹼」：三前一后
    const toes = [];
    const toeSpecs = [
      { angle: 0.0, len: L * 1.0, r: 0.013, z: 0 },          // 中趾（最长）
      { angle: 0.62, len: L * 0.80, r: 0.011, z: 0 },      // 内趾
      { angle: -0.62, len: L * 0.78, r: 0.011, z: 0 },     // 外趾
      { angle: Math.PI, len: L * 0.42, r: 0.010, z: 0 },    // 后趾（hallux，很短）
    ];
    for (const spec of toeSpecs) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.02, 0, 0),
        new THREE.Vector3(Math.cos(spec.angle) * spec.len * 0.42, -0.002, Math.sin(spec.angle) * spec.len * 0.42),
        new THREE.Vector3(Math.cos(spec.angle) * spec.len * 0.78, -0.006, Math.sin(spec.angle) * spec.len * 0.78),
        new THREE.Vector3(Math.cos(spec.angle) * spec.len, -0.010, Math.sin(spec.angle) * spec.len),
      ]);
      const toe = new THREE.Mesh(
        sweepTube(curve, { steps: 8, radial: 6, radius: (t) => lerp(spec.r * 1.25, spec.r * 0.5, t) }),
        legMat
      );
      foot.add(toe);
      // 爪
      const claw = new THREE.Mesh(
        new THREE.ConeGeometry(spec.r * 0.55, 0.028, 6),
        new THREE.MeshStandardMaterial({ color: new THREE.Color('#3b2b1d'), roughness: 0.5 })
      );
      claw.position.set(
        Math.cos(spec.angle) * (spec.len + 0.012),
        -0.012,
        Math.sin(spec.angle) * (spec.len + 0.012)
      );
      claw.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(Math.cos(spec.angle), -0.4, Math.sin(spec.angle)).normalize()
      );
      foot.add(claw);
      toes.push(toe);
    }

    // 踝部的鳞片环（几道浅色横纹）
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.028 - i * 0.001, 0.0035, 5, 12),
        new THREE.MeshStandardMaterial({ color: new THREE.Color('#c96f28'), roughness: 0.55 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.012 - i * 0.028;
      lower.add(ring);
    }

    // 羽毛裤（大腿处的覆羽）
    const trouser = new THREE.Mesh(
      sweepTube(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0.02, 0),
          new THREE.Vector3(0.01, -0.07, 0),
          new THREE.Vector3(0.01, -0.13, 0),
        ]),
        { steps: 6, radial: 10, radius: (t) => lerp(0.075, 0.05, t), section: ellipseSection(1, 0.8) }
      ),
      white
    );
    upper.add(trouser);

    legs[side > 0 ? 'left' : 'right'] = { hip, upper, knee, lower, ankle, foot, toes, web };
  }

  /* ================================================================
   * 邮差包 + 邮差帽（道具）
   * ================================================================ */
  const bagGroup = new THREE.Group();
  const bagMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#a83a2a'), roughness: 0.78 });
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.17, 0.13), bagMat);
  bag.position.set(0.02, 0.06, 0.30);
  bag.rotation.z = -0.06;
  bag.castShadow = true;
  bagGroup.add(bag);
  const bagFlap = new THREE.Mesh(
    new THREE.BoxGeometry(0.245, 0.10, 0.135),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#8c2d20'), roughness: 0.8 })
  );
  bagFlap.position.set(0.02, 0.135, 0.30);
  bagFlap.rotation.z = -0.06;
  bagFlap.castShadow = true;
  bagGroup.add(bagFlap);
  const buckle = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.03, 0.01),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#d9b64a'), roughness: 0.3, metalness: 0.7 })
  );
  buckle.position.set(0.02, 0.075, 0.37);
  bagGroup.add(buckle);
  bodyPivot.add(bagGroup);

  // 邮差帽：贝雷帽，扣在头顶
  const capGroup = new THREE.Group();
  capGroup.position.set(-0.01, 0.10, 0);
  headPivot.add(capGroup);
  const capTop = new THREE.Mesh(
    new THREE.SphereGeometry(PELICAN.headR * 1.06, 18, 10, 0, TAU, 0, Math.PI * 0.42),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#1d3f66'), roughness: 0.72 })
  );
  capTop.scale.set(1.15, 0.72, 1.0);
  capTop.castShadow = true;
  capGroup.add(capTop);
  const capBrim = new THREE.Mesh(
    new THREE.CircleGeometry(PELICAN.headR * 1.02, 20, Math.PI * 0.62, Math.PI * 0.76),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#16304d'), roughness: 0.7, side: THREE.DoubleSide })
  );
  capBrim.rotation.x = -Math.PI / 2 + 0.28;
  capBrim.position.set(0.055, -0.012, 0);
  capGroup.add(capBrim);
  const badge = new THREE.Mesh(
    new THREE.CircleGeometry(0.026, 12),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#e8c45a'), roughness: 0.3, metalness: 0.6 })
  );
  badge.position.set(0.075, 0.062, 0.0);
  badge.rotation.y = Math.PI / 2;
  capGroup.add(badge);

  /* ================================================================
   * 导出
   * ================================================================ */
  const parts = {
    root,
    bodyPivot,
    body,
    tailPivot,
    tailFeathers,
    neckPivot,
    neck,
    nape,
    headPivot,
    head,
    beak,
    pouchPivot,
    pouchCore,
    pouchSkin,
    capGroup,
    bagGroup,
    wings,
    legs,
    materials: { white, black, beakMat, pouchMat, legMat, webMat, facePatchMat },
  };

  /**
   * 状态驱动接口（由 state/pelicanRig.js 每帧调用）：
   *  - neckTurn  脖子左右摆（rad）：neckPivot.rotation.y / headPivot.rotation.y
   *  - headPitch 抬头低头（rad）
   *  - beakOpen  张嘴程度 0..1（下颌绕喙根下转）
   *  - pouchFill 喉囊充盈 0..1
   *  - flapPhase  扇翅相位（rad），由 updateWings 消费
   *  - legPose    直接给两组腿的 hip/knee/ankle 欧拉角
   */
  parts.applyPose = function applyPose(p = {}) {
    const {
      neckTurn = 0,
      headPitch = 0,
      headYaw = 0,
      beakOpen: beakOpenIn = 0,
      pouchFill = 0,
      bodyLean = 0,
      bodyRoll = 0,
      tailSpread = 0,
      capOn = 1,
      bagVisible = 1,
    } = p;
    const beakOpen = Math.min(1, Math.max(0, beakOpenIn));

    neckPivot.rotation.y = neckTurn * 0.45;
    neckPivot.rotation.z = neckTurn * -0.10;
    headPivot.rotation.y = neckTurn * 0.55 + headYaw;
    headPivot.rotation.z = headPitch * 0.35;
    // 抬头时脖子前伸、下巴上扬（用 neck 的两段弯曲近似）
    neckPivot.rotation.z += headPitch * 0.30;
    neckPivot.rotation.x = -headPitch * 0.12;

    // 下颌：张嘴 = 下喙与喉囊一起下压（这里只有上喙+囊，下颌用囊的前缘表示）
    pouchPivot.rotation.z = -beakOpen * 0.42;
    pouchPivot.scale.set(
      1 + pouchFill * 0.16,
      1 + pouchFill * 0.42 - beakOpen * 0.2,
      1 + pouchFill * 0.12
    );
    pouchCore.position.y = -0.085 - pouchFill * 0.045;
    pouchSkin.position.y = -0.09 - pouchFill * 0.06;
    pouchSkin.scale.set(1.6 + pouchFill * 0.2, 0.9 + pouchFill * 0.35, 0.9 + pouchFill * 0.1);

    bodyPivot.rotation.z = bodyLean;
    bodyPivot.rotation.x = bodyRoll;

    tailPivot.rotation.y = tailSpread * 0.18;
    tailFeathers.forEach((f, i) => {
      const u = i / (tailFeathers.length - 1) - 0.5;
      f.rotation.y = u * (0.55 + tailSpread * 0.35);
    });

    capGroup.visible = capOn > 0.5;
    bagGroup.visible = bagVisible > 0.5;
  };

  /** 扇翅：flap ∈ [-1,1]，1 = 完全上举，-1 = 完全下拍 */
  parts.updateWings = function updateWings(flap, twist = 0) {
    for (const key of ['left', 'right']) {
      const w = parts.wings[key];
      const side = key === 'left' ? 1 : -1;
      // 上举：绕 Z 轴（朝外），下拍：绕 X 轴（前后）
      w.shoulder.rotation.z = side * (0.10 + flap * 1.05);
      w.shoulder.rotation.x = -flap * 0.34;
      w.upperArm.rotation.z = side * (0.22 + flap * 0.30);
      w.foreArm.rotation.z = side * (0.30 - flap * 0.42);
      w.hand.rotation.z = side * (0.10 + flap * 0.18);
      // 飞羽沿掌骨展开/收拢
      w.primaries.forEach((f, i) => {
        const u = i / (w.primaries.length - 1);
        f.rotation.y = Math.PI + u * (0.28 + twist * 0.5);
        f.rotation.z = -0.1 + u * 0.06 + flap * 0.10 * u;
      });
    }
  };

  /** 腿的姿态：两组腿各自给 {hip, knee, ankle} 的 pitch/roll（rad） */
  parts.setLeg = function setLeg(name, pose) {
    const leg = parts.legs[name];
    if (!leg) return;
    leg.hip.rotation.z = pose.hipZ ?? 0;
    leg.hip.rotation.x = pose.hipX ?? 0;
    leg.knee.rotation.z = pose.kneeZ ?? 0;
    leg.ankle.rotation.z = pose.ankleZ ?? 0;
    leg.foot.rotation.z = pose.footZ ?? 0;
  };

  /** 默认姿态：站在路上，双脚略微分开 */
  parts.applyPose({});
  parts.updateWings(0);
  parts.setLeg('left', { hipZ: -0.06, kneeZ: 0.1, ankleZ: -0.04 });
  parts.setLeg('right', { hipZ: 0.06, kneeZ: -0.1, ankleZ: 0.04 });

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });

  return parts;
}