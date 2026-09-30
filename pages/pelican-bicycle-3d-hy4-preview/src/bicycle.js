/* =====================================================================
 * bicycle.js — 全程序化复古公路车
 * 车架管件由曲线扫掠，轮组带辐条，链条 84 节，车筐藤编，车头灯可发光
 * 局部坐标：+Z = 前进方向，+X = 右侧，+Y = 上
 * ===================================================================*/
(function () {
  'use strict';
  var PB = window.PB, U = PB.U;

  /* ---------- 极简几何合并（不依赖 BufferGeometryUtils） ---------- */
  function mergeGeos(items) {
    var posArr = [], norArr = [], uvArr = [];
    var nm = new THREE.Matrix3();
    for (var i = 0; i < items.length; i++) {
      var geo = items[i].geo;
      var mat = items[i].matrix;
      var g = geo.index ? geo.toNonIndexed() : geo;
      if (g !== geo && items[i].dispose !== false) { /* toNonIndexed 产生新对象 */ }
      var p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
      if (!n) { g.computeVertexNormals(); n = g.attributes.normal; }
      if (mat) nm.getNormalMatrix(mat);
      var v = new THREE.Vector3(), nv = new THREE.Vector3();
      for (var k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k);
        if (mat) v.applyMatrix4(mat);
        posArr.push(v.x, v.y, v.z);
        nv.fromBufferAttribute(n, k);
        if (mat) nv.applyMatrix3(nm).normalize();
        norArr.push(nv.x, nv.y, nv.z);
        if (uv) uvArr.push(uv.getX(k), uv.getY(k)); else uvArr.push(0, 0);
      }
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(norArr, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    return out;
  }

  /** 由一组点生成管件几何 */
  function tubeFrom(points, radius, radialSeg, tubularSeg, closed) {
    var curve = closed
      ? new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5)
      : new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
    return new THREE.TubeGeometry(curve, tubularSeg || 20, radius, radialSeg || 8, closed || false);
  }

  /* ---------------- 尺寸（米） ---------------- */
  var DIM = {
    wheelR: 0.35,
    tireR: 0.032,
    rimR: 0.315,
    rearZ: -0.53,
    frontZ: 0.55,
    bbY: 0.285,
    bbZ: 0.0,
    seatTopY: 0.90,
    seatTopZ: -0.30,
    headBotY: 0.76,
    headBotZ: 0.46,
    headTopY: 0.97,
    headTopZ: 0.52,
    chainringR: 0.105,
    cogR: 0.043,
    crankLen: 0.165,
    barY: 1.00,
    barZ: 0.50,
    barHalf: 0.24
  };

  function buildWheel(M, opts) {
    var g = new THREE.Group();
    var R = DIM.wheelR;

    // 外胎（含复古褐边）
    var tire = new THREE.Mesh(new THREE.TorusGeometry(R - DIM.tireR * 0.5, DIM.tireR, 10, 44), M.tire);
    tire.rotation.y = Math.PI / 2;
    tire.castShadow = true;
    g.add(tire);

    var stripe = new THREE.Mesh(new THREE.TorusGeometry(R - DIM.tireR * 0.5, DIM.tireR * 0.34, 6, 44), M.tireStripe);
    stripe.rotation.y = Math.PI / 2;
    stripe.position.x = 0;
    stripe.scale.set(1, 1, 1);
    g.add(stripe);

    // 轮辋
    var rim = new THREE.Mesh(new THREE.TorusGeometry(DIM.rimR, 0.017, 8, 44), M.rim);
    rim.rotation.y = Math.PI / 2;
    rim.castShadow = true;
    g.add(rim);

    // 花鼓
    var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.11, 14), M.chrome);
    hub.rotation.z = Math.PI / 2;
    g.add(hub);
    var axle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.17, 8), M.chrome);
    axle.rotation.z = Math.PI / 2;
    g.add(axle);

    // 辐条：合并成单个几何
    var spokeItems = [];
    var n = 28;
    for (var i = 0; i < n; i++) {
      var a = i / n * U.TAU;
      var x = Math.cos(a), y = Math.sin(a);
      var off = (i % 2 === 0 ? 0.038 : -0.038);          // 左右交叉
      var from = new THREE.Vector3(off, x * 0.042, y * 0.042);
      var to = new THREE.Vector3(off * 0.35, x * DIM.rimR, y * DIM.rimR);
      var dir = new THREE.Vector3().subVectors(to, from);
      var len = dir.length();
      var geo = new THREE.CylinderGeometry(0.0035, 0.0035, len, 4, 1);
      var q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      var m = new THREE.Matrix4().compose(
        new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5),
        q, new THREE.Vector3(1, 1, 1));
      spokeItems.push({ geo: geo, matrix: m });
    }
    var spokes = new THREE.Mesh(mergeGeos(spokeItems), M.spoke);
    g.add(spokes);

    // 后轮飞轮
    if (opts && opts.cog) {
      var cog = new THREE.Mesh(new THREE.CylinderGeometry(DIM.cogR, DIM.cogR, 0.016, 18), M.chain);
      cog.rotation.z = Math.PI / 2;
      cog.position.x = 0.055;
      g.add(cog);
      var cog2 = new THREE.Mesh(new THREE.CylinderGeometry(DIM.cogR * 0.72, DIM.cogR * 0.72, 0.014, 16), M.chain);
      cog2.rotation.z = Math.PI / 2;
      cog2.position.x = 0.075;
      g.add(cog2);
    }
    return g;
  }

  function buildFrame(M) {
    var g = new THREE.Group();
    var items = [];

    function addTube(pts, r, seg) {
      items.push({ geo: tubeFrom(pts, r, 8, seg || 16, false), matrix: null });
    }
    function addSymTube(ptsFn, r, seg) {
      [1, -1].forEach(function (s) {
        items.push({ geo: tubeFrom(ptsFn(s), r, 6, seg || 12, false), matrix: null });
      });
    }

    var BB = new THREE.Vector3(0, DIM.bbY, DIM.bbZ);
    var ST = new THREE.Vector3(0, DIM.seatTopY, DIM.seatTopZ);
    var HB = new THREE.Vector3(0, DIM.headBotY, DIM.headBotZ);
    var HT = new THREE.Vector3(0, DIM.headTopY, DIM.headTopZ);
    var RA = new THREE.Vector3(0, DIM.wheelR, DIM.rearZ);
    var FA = new THREE.Vector3(0, DIM.wheelR, DIM.frontZ);

    // 下管
    addTube([BB.clone(), new THREE.Vector3(0, 0.50, 0.24), HB.clone()], 0.026, 18);
    // 座管
    addTube([BB.clone(), ST.clone()], 0.024, 12);
    // 上管
    addTube([ST.clone(), new THREE.Vector3(0, 0.955, 0.10), HT.clone()], 0.021, 14);
    // 头管
    addTube([HB.clone(), HT.clone()], 0.030, 8);
    // 后上叉（座撑）
    addSymTube(function (s) {
      return [ST.clone().setX(s * 0.028), RA.clone().setX(s * 0.055)];
    }, 0.013, 10);
    // 后下叉（链条撑）
    addSymTube(function (s) {
      return [BB.clone().setX(s * 0.030), RA.clone().setX(s * 0.055)];
    }, 0.015, 10);
    // 前叉
    addSymTube(function (s) {
      return [HB.clone().setX(s * 0.026), new THREE.Vector3(s * 0.048, 0.46, 0.50), FA.clone().setX(s * 0.055)];
    }, 0.014, 14);

    var frame = new THREE.Mesh(mergeGeos(items), M.frame);
    frame.castShadow = true;
    g.add(frame);

    // 五通
    var bb = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.075, 16), M.chrome);
    bb.rotation.z = Math.PI / 2;
    bb.position.copy(BB);
    g.add(bb);

    // 座垫
    var saddle = new THREE.Group();
    var seatGeo = new THREE.SphereGeometry(0.115, 18, 12, 0, U.TAU, 0, Math.PI * 0.5);
    seatGeo.scale(0.62, 0.34, 1.35);
    var seat = new THREE.Mesh(seatGeo, M.saddle);
    seat.castShadow = true;
    saddle.add(seat);
    var nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), M.saddle);
    nose.scale.set(0.7, 0.5, 1.5);
    nose.position.set(0, 0.008, 0.15);
    saddle.add(nose);
    // 座垫弹簧
    [1, -1].forEach(function (s) {
      var sp = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.006, 6, 14, Math.PI * 1.6), M.chrome);
      sp.position.set(s * 0.045, -0.05, -0.02);
      sp.rotation.y = Math.PI / 2;
      saddle.add(sp);
    });
    saddle.position.set(0, DIM.seatTopY + 0.10, DIM.seatTopZ - 0.02);
    saddle.rotation.x = -0.06;
    g.add(saddle);

    // 座管夹 + 座杆
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.30, 12), M.chrome);
    post.position.set(0, DIM.seatTopY - 0.05, DIM.seatTopZ + 0.01);
    post.rotation.x = 0.14;
    g.add(post);

    // 车把：复古弯把
    var barPts = [];
    var N = 40;
    for (var i = 0; i <= N; i++) {
      var t = i / N;
      // 从中心向外：直段 -> 前弯 -> 下垂
      var u = (t - 0.5) * 2;                     // -1..1
      var x = u * DIM.barHalf;
      var z = DIM.barZ - Math.pow(Math.abs(u), 2.2) * 0.13;
      var y = DIM.barY - Math.pow(Math.abs(u), 3.4) * 0.10 - Math.pow(Math.abs(u), 9) * 0.14;
      barPts.push(new THREE.Vector3(x, y, z));
    }
    var barGeo = tubeFrom(barPts, 0.017, 8, 60, false);
    var bar = new THREE.Mesh(barGeo, M.chrome);
    bar.castShadow = true;
    g.add(bar);

    // 把立
    var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.022, 0.14, 10), M.chrome);
    stem.position.set(0, DIM.headTopY + 0.03, DIM.headTopZ - 0.02);
    stem.rotation.x = 0.5;
    g.add(stem);

    // 把套
    [1, -1].forEach(function (s) {
      var grip = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.11, 10), M.grip);
      grip.position.set(s * (DIM.barHalf - 0.055), DIM.barY - 0.02, DIM.barZ - 0.03);
      grip.rotation.z = Math.PI / 2;
      g.add(grip);
    });

    // 刹车把手
    [1, -1].forEach(function (s) {
      var lever = new THREE.Mesh(new THREE.CapsuleGeometry(0.010, 0.075, 4, 8), M.chrome);
      lever.position.set(s * (DIM.barHalf - 0.10), DIM.barY - 0.085, DIM.barZ + 0.02);
      lever.rotation.x = 0.6; lever.rotation.z = s * 0.25;
      g.add(lever);
    });

    // 车头灯（复古黄铜 + 可发光透镜）
    var lampG = new THREE.Group();
    var housing = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.052, 0.075, 18), M.chrome);
    housing.rotation.x = Math.PI / 2;
    lampG.add(housing);
    var lensMat = new THREE.MeshStandardMaterial({
      color: 0xfff2cf, emissive: 0xffdca0, emissiveIntensity: 0.6,
      roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.95
    });
    var lens = new THREE.Mesh(new THREE.CircleGeometry(0.058, 20), lensMat);
    lens.position.z = 0.039;
    lampG.add(lens);
    var rimL = new THREE.Mesh(new THREE.TorusGeometry(0.060, 0.008, 8, 22), M.chrome);
    rimL.position.z = 0.038;
    lampG.add(rimL);
    lampG.position.set(0, DIM.headTopY - 0.06, DIM.headTopZ + 0.09);
    g.add(lampG);

    // 车铃
    var bell = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8, 0, U.TAU, 0, Math.PI * 0.55), M.chrome);
    bell.position.set(0.085, DIM.barY - 0.015, DIM.barZ - 0.05);
    bell.rotation.x = 0.4;
    g.add(bell);

    // 尾灯
    var tailMat = new THREE.MeshStandardMaterial({
      color: 0xff5a4a, emissive: 0xff2a18, emissiveIntensity: 0.8, roughness: 0.3
    });
    var tail = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), tailMat);
    tail.scale.set(1, 0.75, 0.6);
    tail.position.set(0, DIM.seatTopY - 0.14, DIM.seatTopZ - 0.16);
    g.add(tail);

    // 打气筒（挂在上管）
    var pump = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.020, 0.42, 10), M.frame);
    pump.position.set(0.05, 0.93, 0.06);
    pump.rotation.x = Math.PI / 2 - 0.03;
    pump.rotation.z = 0.02;
    g.add(pump);

    g.userData = { lensMat: lensMat, tailMat: tailMat, DIM: DIM };
    return g;
  }

  /* ---------- 传动：牙盘 + 曲柄 + 脚踏 + 链条 ---------- */
  function buildDrivetrain(M) {
    var g = new THREE.Group();

    // 牙盘
    var ring = new THREE.Mesh(new THREE.TorusGeometry(DIM.chainringR, 0.008, 6, 40), M.chain);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(0.055, DIM.bbY, DIM.bbZ);
    g.add(ring);
    var spider = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 14), M.chrome);
    spider.rotation.z = Math.PI / 2;
    spider.position.set(0.072, DIM.bbY, DIM.bbZ);
    g.add(spider);
    // 齿（简化为一圈小方块）
    var teeth = [];
    for (var i = 0; i < 44; i++) {
      var a = i / 44 * U.TAU;
      var geo = new THREE.BoxGeometry(0.010, 0.011, 0.014);
      var m = new THREE.Matrix4().compose(
        new THREE.Vector3(0.055 + Math.cos(a) * (DIM.chainringR + 0.004), DIM.bbY + Math.sin(a) * (DIM.chainringR + 0.004), DIM.bbZ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, a)),
        new THREE.Vector3(1, 1, 1));
      teeth.push({ geo: geo, matrix: m });
    }
    g.add(new THREE.Mesh(mergeGeos(teeth), M.chain));

    // 曲柄 + 脚踏（左右各一，相位差 180°）
    var cranks = [];
    for (var s = 0; s < 2; s++) {
      var side = s === 0 ? 1 : -1;
      var cg = new THREE.Group();
      var arm = new THREE.Mesh(new THREE.BoxGeometry(0.016, DIM.crankLen, 0.024), M.chrome);
      arm.position.y = -DIM.crankLen / 2;
      cg.add(arm);
      var pedalG = new THREE.Group();
      var pedal = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.014, 0.062), M.frame);
      pedal.castShadow = true;
      pedalG.add(pedal);
      var pedalPin = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.09, 8), M.chrome);
      pedalPin.rotation.z = Math.PI / 2;
      pedalG.add(pedalPin);
      // 脚趾夹
      var clip = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.005, 6, 14, Math.PI * 1.2), M.chrome);
      clip.rotation.y = Math.PI / 2;
      clip.position.set(0, 0.012, -0.028);
      pedalG.add(clip);
      pedalG.position.y = -DIM.crankLen;
      cg.add(pedalG);
      cg.position.set(side * 0.075, DIM.bbY, DIM.bbZ);
      cg.userData = { pedal: pedalG, side: side };
      cranks.push(cg);
      g.add(cg);
    }

    // 链条：沿闭合路径放置链节
    var chainG = new THREE.Group();
    var chainLinks = [];
    var CL = 84;
    for (var k = 0; k < CL; k++) {
      var link = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.016, 0.020), M.chain);
      chainG.add(link);
      chainLinks.push(link);
    }
    g.add(chainG);

    g.userData = { cranks: cranks, chainLinks: chainLinks, chainRing: ring, chainGroup: chainG };
    return g;
  }

  /**
   * 计算链条闭合路径（在 X = 0.055 平面内）
   * 两个圆（牙盘 / 飞轮）的外公切线 + 两段圆弧
   */
  var _chainPts = [];
  function updateChain(links, crankAngle) {
    var xPlane = 0.055;
    var cx = new THREE.Vector2(DIM.bbZ, DIM.bbY);   // (z,y)
    var ax = new THREE.Vector2(DIM.rearZ, DIM.wheelR);
    var R1 = DIM.chainringR, R2 = DIM.cogR;
    // 外公切线（上、下）
    var d = new THREE.Vector2().subVectors(ax, cx);
    var dist = d.length();
    var ang = Math.atan2(d.y, d.x);
    var gamma = Math.asin(U.clamp((R1 - R2) / dist, -1, 1));
    // 上切线
    var t1a = ang + Math.PI / 2 + gamma;   // 牙盘侧切点角
    var t1b = ang + Math.PI / 2 + gamma;   // 飞轮侧同角
    var p1 = new THREE.Vector2(cx.x + Math.cos(t1a) * R1, cx.y + Math.sin(t1a) * R1);
    var p2 = new THREE.Vector2(ax.x + Math.cos(t1b) * R2, ax.y + Math.sin(t1b) * R2);
    var t2a = ang - Math.PI / 2 - gamma;
    var p3 = new THREE.Vector2(ax.x + Math.cos(t2a) * R2, ax.y + Math.sin(t2a) * R2);
    var p4 = new THREE.Vector2(cx.x + Math.cos(t2a) * R1, cx.y + Math.sin(t2a) * R1);

    var N = links.length;
    var segLen = [
      p1.distanceTo(p2),
      R2 * (Math.PI - 2 * gamma) + R2 * 0.6,   // 飞轮包角（近似）
      p3.distanceTo(p4),
      R1 * (Math.PI - 2 * gamma) + R1 * 0.35
    ];
    var total = segLen[0] + segLen[1] + segLen[2] + segLen[3];
    var pitch = total / N;

    var idx = 0;
    var s = 0;
    var tmp = new THREE.Vector2();
    // 段1：上直线 p1 -> p2
    var n1 = Math.max(2, Math.round(segLen[0] / pitch));
    for (var i = 0; i < n1 && idx < N; i++, idx++) {
      tmp.lerpVectors(p1, p2, i / n1);
      place(tmp);
    }
    // 段2：绕飞轮 p2 -> p3
    var n2 = Math.max(3, Math.round(segLen[1] / pitch));
    var a0 = Math.atan2(p2.y - ax.y, p2.x - ax.x);
    var a1 = Math.atan2(p3.y - ax.y, p3.x - ax.x);
    var da = ((a1 - a0 + Math.PI * 3) % U.TAU) - Math.PI;   // 走短弧
    for (var j = 0; j < n2 && idx < N; j++, idx++) {
      var aa = a0 + da * (j / n2);
      tmp.set(ax.x + Math.cos(aa) * R2, ax.y + Math.sin(aa) * R2);
      place(tmp);
    }
    // 段3：下直线 p3 -> p4
    var n3 = Math.max(2, Math.round(segLen[2] / pitch));
    for (var m = 0; m < n3 && idx < N; m++, idx++) {
      tmp.lerpVectors(p3, p4, m / n3);
      place(tmp);
    }
    // 段4：绕牙盘 p4 -> p1
    var n4 = N - idx;
    var b0 = Math.atan2(p4.y - cx.y, p4.x - cx.x);
    var b1 = Math.atan2(p1.y - cx.y, p1.x - cx.x);
    var db = ((b1 - b0 + Math.PI * 3) % U.TAU) - Math.PI;
    for (var q = 0; q < n4 && idx < N; q++, idx++) {
      var bb2 = b0 + db * (q / Math.max(1, n4));
      tmp.set(cx.x + Math.cos(bb2) * R1, cx.y + Math.sin(bb2) * R1);
      place(tmp);
    }

    function place(v2) {
      var link = links[idx];
      link.position.set(xPlane, v2.y, v2.x);
      link.rotation.x = 0;
      link.rotation.y = Math.PI / 2;
    }
    // 让链条"转起来"：整体沿路径偏移由 crankAngle 驱动 —— 通过复用同一形状
    // （视觉上链条本身是环形的，转速差异体现在牙盘齿数上，这里靠 pedal 同步即可）
  }

  /* ---------- 藤编车筐 + 里面的鱼和三明治 ---------- */
  function buildBasket(M) {
    var g = new THREE.Group();
    var R = 0.155, H = 0.20;

    // 底
    var bottom = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.86, R * 0.78, 0.012, 20), M.basket);
    g.add(bottom);
    // 竖藤条
    var ribs = 14;
    for (var i = 0; i < ribs; i++) {
      var a = i / ribs * U.TAU;
      var rib = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, H, 5), M.basket);
      rib.position.set(Math.cos(a) * R, H / 2, Math.sin(a) * R);
      rib.rotation.z = -Math.cos(a) * 0.06;
      rib.rotation.x = Math.sin(a) * 0.06;
      g.add(rib);
    }
    // 横藤圈
    var rings = 5;
    for (var k = 0; k < rings; k++) {
      var t = k / (rings - 1);
      var rr = U.lerp(R * 0.80, R * 1.02, t);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.0065, 5, 26), M.basket);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = t * H;
      g.add(ring);
    }
    // 上沿
    var lip = new THREE.Mesh(new THREE.TorusGeometry(R * 1.03, 0.010, 6, 26), M.basket);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = H;
    g.add(lip);

    // 鱼（三条，摆出探头姿态）
    var fishList = [];
    for (var f = 0; f < 3; f++) {
      var fish = new THREE.Group();
      // 身体：椭球
      var bodyGeo = new THREE.SphereGeometry(0.055, 16, 12);
      bodyGeo.scale(1.0, 0.62, 2.25);
      var body = new THREE.Mesh(bodyGeo, M.fish);
      fish.add(body);
      // 肚皮
      var bellyGeo = new THREE.SphereGeometry(0.05, 14, 10);
      bellyGeo.scale(0.86, 0.42, 2.0);
      var belly = new THREE.Mesh(bellyGeo, M.fishBelly);
      belly.position.y = -0.016;
      fish.add(belly);
      // 尾鳍
      var tailGeo = new THREE.ConeGeometry(0.042, 0.058, 4, 1);
      tailGeo.rotateX(Math.PI / 2);
      tailGeo.scale(1, 1, 0.25);
      var tail = new THREE.Mesh(tailGeo, M.fish);
      tail.position.z = -0.135;
      fish.add(tail);
      // 背鳍
      var dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.040, 3), M.fish);
      dorsal.scale.set(0.3, 1, 1.6);
      dorsal.position.set(0, 0.028, -0.01);
      fish.add(dorsal);
      // 眼睛
      [-1, 1].forEach(function (s) {
        var eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), M.eye);
        eye.position.set(s * 0.030, 0.012, 0.072);
        fish.add(eye);
      });
      fish.position.set(
        (f - 1) * 0.062 + 0.005, 0.052, 0.012 + (f === 1 ? 0.02 : 0));
      fish.rotation.y = (f - 1) * 0.42;
      fish.rotation.z = -0.9 - f * 0.12;    // 鱼身斜插在筐里
      fish.rotation.x = 0.25;
      fish.userData = { base: fish.rotation.clone(), ph: f * 2.1 };
      fishList.push(fish);
      g.add(fish);
    }

    // 三明治（油纸包）
    var sw = new THREE.Group();
    var bread = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.030, 0.075), M.sandwich);
    sw.add(bread);
    var bread2 = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.026, 0.072), M.sandwich);
    bread2.position.y = 0.028;
    bread2.rotation.y = 0.12;
    sw.add(bread2);
    var lettuce = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.008, 0.078), new THREE.MeshStandardMaterial({ color: 0x6ba84a, roughness: 0.85 }));
    lettuce.position.y = 0.014;
    sw.add(lettuce);
    sw.position.set(-0.075, 0.038, -0.055);
    sw.rotation.set(0.2, 0.6, -0.1);
    g.add(sw);

    // 保温瓶
    var bottle = new THREE.Group();
    var bBody = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.032, 0.14, 14), M.chrome);
    bottle.add(bBody);
    var bCap = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.030, 0.028, 14), M.helmet);
    bCap.position.y = 0.082;
    bottle.add(bCap);
    bottle.position.set(0.082, 0.09, -0.052);
    bottle.rotation.z = -0.34;
    g.add(bottle);

    g.userData = { fish: fishList };
    return g;
  }

  /* =================================================================== */
  function Bicycle(M) {
    var root = new THREE.Group();

    var frame = buildFrame(M);
    root.add(frame);

    var rear = buildWheel(M, { cog: true });
    rear.position.set(0, DIM.wheelR, DIM.rearZ);
    root.add(rear);

    var front = buildWheel(M, {});
    front.position.set(0, DIM.wheelR, DIM.frontZ);
    root.add(front);

    var drive = buildDrivetrain(M);
    root.add(drive);

    var basket = buildBasket(M);
    basket.position.set(0, DIM.barY - 0.145, DIM.barZ + 0.20);
    root.add(basket);

    root.updateMatrixWorld(true);

    // 挡泥板
    [rear, front].forEach(function (w, i) {
      var fend = new THREE.Mesh(
        new THREE.TorusGeometry(DIM.wheelR + 0.055, 0.012, 6, 26, Math.PI * 0.85),
        M.frame);
      fend.rotation.y = Math.PI / 2;
      fend.rotation.z = i === 0 ? -Math.PI * 0.42 : Math.PI * 0.42;
      fend.position.copy(w.position);
      root.add(fend);
    });

    root.userData = {
      frame: frame, rear: rear, front: front, drive: drive, basket: basket,
      DIM: DIM, lensMat: frame.userData.lensMat, tailMat: frame.userData.tailMat
    };
    this.root = root;
    this.M = M;
  }

  /** 轮子 / 曲柄 / 链条同步
   * crankAngle: 曲柄转角（rad）
   * gearRatio: 链条传动比（后轮角速度 = 曲柄角速度 / ratio）
   */
  Bicycle.prototype.update = function (crankAngle, dt, t) {
    var u = this.root.userData;
    var ratio = 0.42;                     // 牙盘 44T / 飞轮 18T ≈ 0.41
    var wheelAngle = crankAngle / ratio;
    u.rear.rotation.x = -wheelAngle;
    u.front.rotation.x = -wheelAngle;

    var cranks = u.drive.userData.cranks;
    for (var i = 0; i < cranks.length; i++) {
      var c = cranks[i];
      c.rotation.x = crankAngle + (i === 0 ? 0 : Math.PI);
      // 脚踏始终保持水平
      c.userData.pedal.rotation.x = -(crankAngle + (i === 0 ? 0 : Math.PI));
    }
    updateChain(u.drive.userData.chainLinks, crankAngle);

    // 鱼随颠簸轻轻晃动
    var fish = u.basket.userData.fish;
    for (var f = 0; f < fish.length; f++) {
      var b = fish[f].userData.base;
      fish[f].rotation.z = b.z + Math.sin(t * 3.1 + fish[f].userData.ph) * 0.045;
      fish[f].rotation.x = b.x + Math.cos(t * 2.6 + fish[f].userData.ph) * 0.035;
    }
  };

  /** 世界空间中的把手 / 车座顶端（rider 挂点） */
  var _wp = new THREE.Vector3();
  Bicycle.prototype.barWorld = function (side, out) {
    var u = this.root.userData, D = u.DIM;
    out = out || new THREE.Vector3();
    out.set(side * (D.barHalf * 0.82), D.barY, D.barZ);
    return this.root.localToWorld(out);
  };
  /** 世界空间中的脚踏位置（给定曲柄角） */
  Bicycle.prototype.pedalWorld = function (side, crankAngle, out) {
    out = out || new THREE.Vector3();
    var D = DIM;
    out.set(side * 0.075, D.bbY - D.crankLen * Math.cos(crankAngle), D.bbZ - D.crankLen * Math.sin(crankAngle));
    return this.root.localToWorld(out);
  };
  /** 世界空间中的车座支撑点 */
  Bicycle.prototype.seatWorld = function (out) {
    out = out || new THREE.Vector3();
    var D = DIM;
    out.set(0, D.seatTopY + 0.10, D.seatTopZ - 0.02);
    return this.root.localToWorld(out);
  };

  PB.Bicycle = Bicycle;
  PB.Bicycle.DIM = DIM;
  PB.mergeGeos = mergeGeos;
})();
