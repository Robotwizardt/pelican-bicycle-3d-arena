/**
 * creature/bicycle.js —— 邮政红色公路车（程序化建模）
 *
 * 结构：菱形车架（用扫掠管沿每根管件的中心线）+ 前后叉 + 轮组（轮胎/轮圈/辐条/花鼓）
 *      + 传动（牙盘/链条/后拨）+ 把手/坐垫/水壶架/前灯/驮包架 + 号码牌 + 邮包。
 *
 * 车把用「反向弯曲」的三段折线：中心低、两端上扬下弯 —— 骑行车把的典型形状。
 * 车架用关键帧：所有管件都是一次 sweepTube，避免拼盒子显得廉价。
 */
import * as THREE from 'three';
import { lerp, TAU } from '../util.js';
import { ellipseSection, sweepTube } from '../scene/geom.js';

/** 车架几何（本地单位，米）。以 BB（曲柄中心）为原点。 */
export const BIKE = {
  wheelR: 0.34,
  wheelbase: 1.04,
  bbDrop: 0.055,
  bb: new THREE.Vector3(0, 0.29, 0),
  saddle: new THREE.Vector3(-0.20, 0.94, 0),
  headTop: new THREE.Vector3(0.42, 1.02, 0),
  headBot: new THREE.Vector3(0.44, 0.80, 0),
  crankLen: 0.17,
};

export function createBicycle({ number = '404' } = {}) {
  const root = new THREE.Group();
  root.name = 'bicycle';

  const frameMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#a8271c'),
    roughness: 0.26,
    metalness: 0.42,
  });
  const frameMatDark = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#7d1b13'),
    roughness: 0.3,
    metalness: 0.4,
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#cfd6db'),
    roughness: 0.16,
    metalness: 0.92,
  });
  const rubberMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1b1d20'),
    roughness: 0.94,
    metalness: 0.0,
  });
  const leatherMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#4a3427'),
    roughness: 0.62,
    metalness: 0.05,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#c9a24a'),
    roughness: 0.24,
    metalness: 0.88,
  });

  /* ---------------- 轮组 ---------------- */
  function makeWheel(cx) {
    const wheel = new THREE.Group();
    wheel.position.set(cx, BIKE.wheelR, 0);

    // 轮胎（外圈）
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(BIKE.wheelR - 0.022, 0.024, 10, 40), rubberMat);
    tyre.rotation.y = Math.PI / 2;
    tyre.castShadow = true;
    wheel.add(tyre);
    // 胎壁上的细纹（另一层薄环）
    const tread = new THREE.Mesh(new THREE.TorusGeometry(BIKE.wheelR - 0.004, 0.006, 6, 44), rubberMat);
    tread.rotation.y = Math.PI / 2;
    wheel.add(tread);

    // 轮圈（深框）
    const rimMat = new THREE.MeshStandardMaterial({ color: '#b9c2c8', roughness: 0.2, metalness: 0.85 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(BIKE.wheelR - 0.05, 0.012, 8, 40), rimMat);
    rim.rotation.y = Math.PI / 2;
    wheel.add(rim);

    // 辐条：前后各用交叉编法
    const spokeCount = 20;
    const spokeGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 1, 4);
    const spokes = new THREE.InstancedMesh(spokeGeo, chromeMat, spokeCount * 2);
    const m4 = new THREE.Matrix4();
    const qq = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < spokeCount; i++) {
      const a = (i / spokeCount) * TAU;
      const cross = (i % 2 === 0 ? 1 : -1) * 0.42;
      const hubR = 0.035;
      from.set(0, Math.cos(a) * hubR, Math.sin(a) * hubR);
      to.set(0, Math.cos(a + cross) * (BIKE.wheelR - 0.06), Math.sin(a + cross) * (BIKE.wheelR - 0.06));
      const dir = to.clone().sub(from);
      const len = dir.length();
      qq.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      m4.compose(from.clone().addScaledVector(dir, len / 2), qq, sc.set(1, len, 1));
      spokes.setMatrixAt(n++, m4);
    }
    spokes.instanceMatrix.needsUpdate = true;
    wheel.add(spokes);

    // 花鼓 + 刹车盘
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.10, 12), chromeMat);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.006, 20), chromeMat);
    rotor.rotation.z = Math.PI / 2;
    rotor.position.x = -0.055;
    wheel.add(rotor);

    return wheel;
  }
  const rearWheel = makeWheel(-BIKE.wheelbase / 2);
  const frontWheel = makeWheel(BIKE.wheelbase / 2);
  root.add(rearWheel, frontWheel);

  /* ---------------- 车架 ---------------- */
  const frameGroup = new THREE.Group();
  root.add(frameGroup);

  /** 一根管件：a→b，附带沿程的粗细（两端略粗，像焊接/收口） */
  const tube = (a, b, r = 0.022, mat = frameMat, bulge = 0.12) => {
    const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(b, 0.5), b]);
    const geo = sweepTube(curve, {
      steps: 6,
      radial: 8,
      radius: (t) => r * (1 + bulge * Math.sin(t * Math.PI)),
    });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    frameGroup.add(m);
    return m;
  };

  const bb = BIKE.bb;
  const st = BIKE.saddle;
  const ht = BIKE.headTop;
  const hb = BIKE.headBot;
  const rearAxle = new THREE.Vector3(-BIKE.wheelbase / 2, BIKE.wheelR, 0);
  const frontAxle = new THREE.Vector3(BIKE.wheelbase / 2, BIKE.wheelR, 0);
  // 座管实际落点比头管低
  const seatTop = new THREE.Vector3(-0.20, 0.86, 0);

  tube(bb, seatTop, 0.024, frameMat);           // 座管
  tube(bb.clone().add(new THREE.Vector3(0.0, 0.02, 0)), hb, 0.026, frameMat); // 下管
  tube(seatTop.clone().add(new THREE.Vector3(0.02, 0.04, 0)), ht, 0.021, frameMat); // 上管
  tube(bb, rearAxle, 0.014, frameMatDark, 0.06); // 后下叉
  tube(seatTop.clone().add(new THREE.Vector3(-0.015, 0.01, 0)), rearAxle, 0.012, frameMatDark, 0.06); // 后上叉
  tube(hb, frontAxle, 0.013, frameMatDark, 0.06); // 前叉
  tube(ht, hb, 0.024, frameMatDark, 0.0);       // 头管
  // 五通壳
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 14), frameMatDark);
  shell.rotation.x = Math.PI / 2;
  shell.position.copy(bb);
  frameGroup.add(shell);

  // 头管上的碗组与把立
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.035), chromeMat);
  stem.position.set(ht.x - 0.03, ht.y + 0.03, 0);
  stem.rotation.z = 0.16;
  frameGroup.add(stem);

  /* ---------------- 车把：反向三折 ---------------- */
  const barGroup = new THREE.Group();
  const barCenter = new THREE.Vector3(ht.x - 0.07, ht.y + 0.075, 0);
  const dropCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-0.012, 0.004, 0.10),
    new THREE.Vector3(-0.012, 0.008, 0.18),
    new THREE.Vector3(-0.016, 0.002, 0.235),
    new THREE.Vector3(-0.045, -0.020, 0.255),
    new THREE.Vector3(-0.075, -0.052, 0.250),
    new THREE.Vector3(-0.072, -0.086, 0.238),
  ]);
  for (const side of [1, -1]) {
    const pts = dropCurve.points.map((p) => new THREE.Vector3(p.x, p.y, p.z * side));
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = sweepTube(curve, { steps: 20, radial: 7, radius: () => 0.014 });
    const bar = new THREE.Mesh(geo, chromeMat);
    bar.castShadow = true;
    barGroup.add(bar);
    // 把带（外侧握持段）
    const tapePts = pts.slice(3);
    const tapeCurve = new THREE.CatmullRomCurve3(tapePts);
    const tape = new THREE.Mesh(
      sweepTube(tapeCurve, { steps: 12, radial: 8, radius: (t) => lerp(0.017, 0.0165, t) }),
      new THREE.MeshStandardMaterial({ color: '#2a2f34', roughness: 0.9 })
    );
    barGroup.add(tape);
    // 刹车手柄
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.014, 0.016), chromeMat);
    lever.position.set(-0.03, -0.03, 0.222 * side);
    lever.rotation.x = side * 0.2;
    barGroup.add(lever);
  }
  barGroup.position.copy(barCenter);
  frameGroup.add(barGroup);

  /* ---------------- 坐垫 ---------------- */
  const saddleGroup = new THREE.Group();
  const saddle = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 16, 10),
    leatherMat
  );
  saddle.scale.set(1.5, 0.34, 0.75);
  saddle.position.set(-0.01, 0, 0);
  saddle.castShadow = true;
  saddleGroup.add(saddle);
  const saddleNose = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.11, 8), leatherMat);
  saddleNose.rotation.z = -Math.PI / 2;
  saddleNose.position.set(0.11, -0.004, 0);
  saddleGroup.add(saddleNose);
  const saddlePost = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.10, 8), chromeMat);
  saddlePost.position.set(0.0, -0.05, 0);
  saddleGroup.add(saddlePost);
  saddleGroup.position.set(st.x - 0.01, st.y + 0.02, 0);
  frameGroup.add(saddleGroup);

  /* ---------------- 传动 ---------------- */
  const crankGroup = new THREE.Group();
  crankGroup.position.copy(bb);
  root.add(crankGroup);
  const chainring = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.006, 32), chromeMat);
  chainring.rotation.x = Math.PI / 2;
  crankGroup.add(chainring);
  const ringTeeth = new THREE.Mesh(new THREE.TorusGeometry(0.104, 0.006, 6, 40), chromeMat);
  crankGroup.add(ringTeeth);
  const crankArms = [];
  for (const side of [1, -1]) {
    const arm = new THREE.Group();
    arm.position.z = side * 0.06;
    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.032, BIKE.crankLen, 0.016), chromeMat);
    armMesh.position.y = BIKE.crankLen / 2;
    arm.add(armMesh);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.018, 0.062), new THREE.MeshStandardMaterial({ color: '#22262a', roughness: 0.8 }));
    pedal.position.y = BIKE.crankLen;
    arm.add(pedal);
    crankGroup.add(arm);
    crankArms.push({ arm, side });
  }
  // 后拨与飞轮
  const cassette = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.05, 16), chromeMat);
  cassette.rotation.x = Math.PI / 2;
  cassette.position.copy(rearAxle);
  root.add(cassette);
  const derailleur = new THREE.Group();
  derailleur.position.set(rearAxle.x + 0.02, rearAxle.y + 0.16, 0.06);
  const dBody = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.03), frameMatDark);
  dBody.rotation.z = -0.4;
  derailleur.add(dBody);
  root.add(derailleur);
  // 链条：两条直线段（不模拟运动，用静态几何即可）
  for (const [y0, y1] of [
    [bb.y + 0.105, rearAxle.y + 0.055],
    [bb.y - 0.105, rearAxle.y - 0.045],
  ]) {
    const chain = new THREE.Mesh(
      new THREE.BoxGeometry(0.47, 0.012, 0.008),
      new THREE.MeshStandardMaterial({ color: '#5a5f66', roughness: 0.4, metalness: 0.8 })
    );
    chain.position.set((bb.x + rearAxle.x) / 2, (y0 + y1) / 2, 0.06);
    chain.rotation.z = Math.atan2(y1 - y0, 0.47);
    root.add(chain);
  }

  /* ---------------- 邮政部件：号码牌 / 前灯 / 驮包架 / 水壶架 ---------------- */
  const numberPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.30, 0.15),
    new THREE.MeshStandardMaterial({ map: makeNumberTexture(number), roughness: 0.5, metalness: 0.1 })
  );
  numberPlate.position.set(-0.16, 0.72, 0);
  numberPlate.rotation.y = Math.PI / 2;
  numberPlate.rotation.z = 0.12;
  frameGroup.add(numberPlate);

  const headLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.06, 14), brassMat);
  headLamp.rotation.z = Math.PI / 2 + 0.1;
  headLamp.position.set(ht.x + 0.06, ht.y + 0.09, 0);
  frameGroup.add(headLamp);
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.032, 16),
    new THREE.MeshStandardMaterial({ color: '#ffeec2', emissive: '#ffbe63', emissiveIntensity: 0.0 })
  );
  lens.position.set(ht.x + 0.092, ht.y + 0.085, 0);
  lens.rotation.y = Math.PI / 2;
  frameGroup.add(lens);
  const headLampLight = new THREE.PointLight('#ffcf8f', 0, 12, 2);
  headLampLight.position.copy(lens.position);
  root.add(headLampLight);

  // 驮包架
  const rackPts = [
    new THREE.Vector3(-0.34, 0.90, 0),
    new THREE.Vector3(-0.10, 0.90, 0),
    new THREE.Vector3(0.06, 0.82, 0),
  ];
  for (const side of [1, -1]) {
    const curve = new THREE.CatmullRomCurve3(rackPts.map((p) => new THREE.Vector3(p.x, p.y, p.z + side * 0.07)));
    const geo = sweepTube(curve, { steps: 8, radial: 6, radius: () => 0.008 });
    frameGroup.add(new THREE.Mesh(geo, chromeMat));
  }
  // 驮包上的邮包
  const pannierMat = new THREE.MeshStandardMaterial({ color: '#b5452f', roughness: 0.8 });
  const pannier = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.16), pannierMat);
  pannier.position.set(-0.18, 0.80, 0.13);
  pannier.rotation.y = 0.12;
  pannier.castShadow = true;
  frameGroup.add(pannier);
  const pannierFlap = new THREE.Mesh(new THREE.BoxGeometry(0.265, 0.13, 0.165), new THREE.MeshStandardMaterial({ color: '#8e2f21', roughness: 0.8 }));
  pannierFlap.position.set(-0.18, 0.885, 0.13);
  pannierFlap.rotation.y = 0.12;
  frameGroup.add(pannierFlap);

  // 水壶架 + 水壶
  const cage = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 5, 12, Math.PI * 1.2), chromeMat);
  cage.position.set(0.14, 0.72, 0);
  cage.rotation.set(0, Math.PI / 2, 0.4);
  frameGroup.add(cage);
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.17, 12), new THREE.MeshStandardMaterial({ color: '#e8e2d0', roughness: 0.4, metalness: 0.1 }));
  bottle.position.set(0.14, 0.70, 0);
  frameGroup.add(bottle);
  const bottleCap = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.025, 10), frameMatDark);
  bottleCap.position.set(0.14, 0.795, 0);
  frameGroup.add(bottleCap);

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  const parts = {
    root,
    rearWheel,
    frontWheel,
    crankGroup,
    crankArms,
    saddleGroup,
    barGroup,
    pannier,
    pannierFlap,
    headLampLight,
    lampLensMat: lens.material,
    frameMat,
    /** 车轮转角（rad） */
    spinWheels(angle) {
      rearWheel.rotation.x = angle;
      frontWheel.rotation.x = angle;
    },
    /** 曲柄转角（rad），踏板始终朝下（4 踏板永远水平） */
    spinCrank(angle) {
      crankGroup.rotation.z = -angle;
      for (const { arm } of crankArms) {
        arm.rotation.z = angle;
        // 抵消整体旋转，使踏板面保持水平
        arm.children.forEach((c) => {
          if (c.geometry && c.geometry.type === 'BoxGeometry' && c.geometry.parameters.width === 0.09) {
            c.rotation.z = angle;
          }
        });
      }
    },
  };
  return parts;
}

function makeNumberTexture(num) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4ecd8';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#1b1d21';
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 492, 236);
  ctx.fillStyle = '#1b1d21';
  ctx.font = 'bold 140px "Georgia","Times New Roman",serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(num, 256, 120);
  ctx.font = '30px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('灯塔邮路', 256, 216);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}