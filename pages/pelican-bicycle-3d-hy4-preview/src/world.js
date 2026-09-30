/* =====================================================================
 * world.js — 海岛地形、海面、自行车道、植被、灯塔、飞鸟、云
 * 全局命名空间 PB.World
 * ===================================================================*/
(function () {
  'use strict';
  var PB = window.PB, U = PB.U;

  var ISLAND_R = 62;     // 海岛半径
  var TERRAIN_SIZE = 150;
  var TERRAIN_SEG = 200;

  /* ---------- 地形高度场：解析函数，CPU 与 GPU 一致 ---------- */
  function heightAt(x, z) {
    var r = Math.sqrt(x * x + z * z);
    // 基础岛屿轮廓：中心隆起，边缘沉入海面
    var base = Math.exp(-Math.pow(r / (ISLAND_R * 0.62), 2.4)) * 8.4;
    // 沙丘起伏
    var dune = U.fbm(x * 0.022 + 4.1, z * 0.022 - 2.7, 4) * 1.7;
    var dune2 = U.ridged(x * 0.045 - 8.3, z * 0.045 + 5.2, 3) * 0.55;
    // 边缘涟漪
    var edge = U.fbm(x * 0.11, z * 0.11, 3) * 0.28;
    var h = base + dune * U.smoothstep(ISLAND_R * 1.25, ISLAND_R * 0.35, r) + dune2 + edge;
    // 海床：岛外迅速下降
    var sea = -U.smoothstep(ISLAND_R * 0.85, ISLAND_R * 1.35, r) * 9.0;
    h = h * U.smoothstep(ISLAND_R * 1.32, ISLAND_R * 0.75, r) + sea;
    // 中央沙丘高地
    h += Math.exp(-Math.pow(r / 16, 2)) * 2.2;
    return h;
  }

  /* ---------- 骑行环路：一条环绕海岛的闭合样条 ---------- */
  function buildTrack() {
    var pts = [];
    var n = 14;
    var rnd = U.rng(20260930);
    for (var i = 0; i < n; i++) {
      var a = i / n * U.TAU;
      // 半径轻微起伏，形成有机的环岛路
      var rr = 15.5 + Math.sin(a * 3.0) * 2.3 + Math.cos(a * 2.0 + 1.1) * 1.9 + rnd.range(-0.6, 0.6);
      var x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      // 高度：贴地 + 轻微起伏（小坡），让骑行有上下感
      var y = heightAt(x, z) + 0.16 + Math.sin(a * 5.0) * 0.42;
      pts.push(new THREE.Vector3(x, y, z));
    }
    var curve = U.loopCurve(pts, 0.5);
    var table = U.arcTable(curve, 900);
    return { curve: curve, table: table, length: table.total, radius: 15.5 };
  }

  /* ---------- 地形网格 ---------- */
  function buildTerrain(M) {
    var geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    var colors = new Float32Array(pos.count * 3);
    var c = new THREE.Color();
    var sandC = new THREE.Color(0xd9c295);
    var grassC = new THREE.Color(0x7c8a4a);
    var rockC = new THREE.Color(0x8b8577);
    var wetC = new THREE.Color(0xb2a179);
    var seabedC = new THREE.Color(0x4a5a52);

    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      var h = heightAt(x, z);
      pos.setY(i, h);

      var r = Math.sqrt(x * x + z * z);
      var slope = 0;
      // 用邻近采样估坡度（每 8 个采样一次以省时间）
      if (i % 1 === 0) {
        var hh = heightAt(x + 0.7, z) - heightAt(x - 0.7, z);
        var hv = heightAt(x, z + 0.7) - heightAt(x, z - 0.7);
        slope = Math.sqrt(hh * hh + hv * hv);
      }
      // 顶点色：水下 -> 湿沙 -> 干沙 -> 草 -> 岩
      var t = U.saturate((h - 0.05) / 1.6);
      c.copy(seabedC).lerp(sandC, U.smoothstep(-2.2, 0.4, h));
      c.lerp(wetC, U.smoothstep(0.0, 0.55, h) * 0.5);
      c.lerp(grassC, U.smoothstep(0.9, 3.4, h) * U.smoothstep(0.16, 0.5, slope) * 0.85);
      c.lerp(rockC, U.smoothstep(2.6, 5.2, h) * U.smoothstep(0.35, 0.75, slope));
      // 环路边压暗成压实沙路
      var trackT = Math.abs(r - 15.5);
      c.multiplyScalar(U.lerp(0.82, 1.0, U.smoothstep(0.9, 2.6, trackT)));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    var mat = M.sand.clone();
    mat.vertexColors = true;
    mat.envMapIntensity = 0.35;
    var mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'terrain';
    return mesh;
  }

  /* ---------- 海面：顶点位移 + 程序化法线 ---------- */
  function buildOcean(M, size) {
    size = size || 900;
    var seg = 128;
    var geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);

    var mat = new THREE.MeshStandardMaterial({
      color: 0x123b52,
      roughness: 0.075,
      metalness: 0.02,
      transparent: true,
      opacity: 0.94,
      envMapIntensity: 1.0,
      normalMap: PB.Tex.waterNormal(256),
      normalScale: new THREE.Vector2(0.45, 0.45)
    });
    mat.normalMap.repeat.set(60, 60);

    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0;
    mesh.name = 'ocean';
    mesh.receiveShadow = false;

    // 保存原始顶点用于波浪位移
    var pos = geo.attributes.position;
    var base = new Float32Array(pos.count * 3);
    for (var i = 0; i < pos.count * 3; i++) base[i] = pos.array[i];
    mesh.userData.base = base;
    mesh.userData.mat = mat;

    /* 岸边泡沫环：一圈半透明的泡沫带 */
    var foamGeo = new THREE.RingGeometry(ISLAND_R * 0.96, ISLAND_R * 1.22, 180, 6);
    foamGeo.rotateX(-Math.PI / 2);
    var foamMat = new THREE.MeshBasicMaterial({
      map: PB.Tex.foam(256),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide
    });
    foamMat.map.repeat.set(70, 1);
    var foam = new THREE.Mesh(foamGeo, foamMat);
    foam.position.y = 0.06;
    foam.name = 'foam';
    mesh.userData.foam = foam;

    /* 深海底（避免透出天空） */
    var floorGeo = new THREE.PlaneGeometry(size, size, 1, 1);
    floorGeo.rotateX(-Math.PI / 2);
    var floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({
      color: 0x0a2733, roughness: 0.95, metalness: 0
    }));
    floor.position.y = -11;
    floor.name = 'seafloor';

    var g = new THREE.Group();
    g.add(mesh); g.add(foam); g.add(floor);
    g.userData = { surf: mesh, foam: foam, floor: floor, mat: mat };
    return g;
  }

  /** 更新海面顶点（Gerstner 波，3 个方向） */
  function updateOcean(oceanGroup, t, windDir, amp) {
    var surf = oceanGroup.userData.surf;
    var pos = surf.geometry.attributes.position;
    var base = surf.userData.base;
    var a = pos.array;
    amp = amp == null ? 1 : amp;
    var wd = windDir || 0;
    var k = 0.18;
    for (var i = 0; i < pos.count; i++) {
      var i3 = i * 3;
      var x = base[i3], z = base[i3 + 2];
      var h = 0;
      var ph = t * 1.05;
      h += Math.sin(x * 0.075 + z * 0.041 + ph) * 0.42;
      h += Math.sin(x * 0.031 - z * 0.108 + ph * 1.37) * 0.30;
      h += Math.sin(-x * 0.143 + z * 0.126 + ph * 0.73) * 0.13;
      h += U.fbm(x * 0.02 + t * 0.05, z * 0.02, 2) * 0.5;
      a[i3 + 1] = h * amp * U.smoothstep(-1.2, 2.5, Math.sqrt(x * x + z * z) - ISLAND_R * 0.9) + h * amp * 0.35;
    }
    pos.needsUpdate = true;
    surf.geometry.computeVertexNormals();

    var m = oceanGroup.userData.mat;
    var nx = m.normalMap;
    nx.offset.x = (t * 0.014) + Math.cos(wd) * 0.02;
    nx.offset.y = (t * 0.010) + Math.sin(wd) * 0.02;

    var foam = oceanGroup.userData.foam;
    foam.material.map.offset.x = t * 0.02;
    foam.material.opacity = 0.34 + Math.sin(t * 0.8) * 0.09;
    foam.position.y = 0.05 + Math.sin(t * 0.7) * 0.05;
  }

  /* ---------- 椰子棕榈 ---------- */
  function makePalm(M, rnd) {
    var g = new THREE.Group();
    var h = rnd.range(4.2, 7.6);
    var lean = rnd.range(0.06, 0.26);
    var leanDir = rnd() * U.TAU;

    // 树干：沿一条弯曲曲线扫掠
    var curvePts = [];
    var segN = 8;
    for (var i = 0; i <= segN; i++) {
      var tt = i / segN;
      var bend = Math.pow(tt, 1.7) * lean * h;
      curvePts.push(new THREE.Vector3(
        Math.cos(leanDir) * bend,
        tt * h,
        Math.sin(leanDir) * bend
      ));
    }
    var curve = new THREE.CatmullRomCurve3(curvePts);
    var tube = new THREE.TubeGeometry(curve, 14, 0.17, 8, false);
    // 让树干下粗上细
    var tp = tube.attributes.position;
    var v = new THREE.Vector3();
    for (var j = 0; j < tp.count; j++) {
      v.fromBufferAttribute(tp, j);
      var f = U.saturate(v.y / h);
      var shrink = U.lerp(1.35, 0.62, f);
      // 以曲线中心轴为基准收缩
      var cp = curve.getPoint(U.saturate(f));
      v.x = cp.x + (v.x - cp.x) * shrink;
      v.z = cp.z + (v.z - cp.z) * shrink;
      tp.setXYZ(j, v.x, v.y, v.z);
    }
    tube.computeVertexNormals();
    var trunk = new THREE.Mesh(tube, M.palmTrunk);
    trunk.castShadow = true;
    g.add(trunk);

    // 树冠：8~11 片叶子
    var top = curve.getPoint(1);
    var leaves = rnd.int(8, 11);
    for (var k = 0; k < leaves; k++) {
      var ang = k / leaves * U.TAU + rnd.range(-0.2, 0.2);
      var leaf = makePalmLeaf(M, rnd);
      leaf.position.copy(top);
      leaf.rotation.y = ang;
      leaf.rotation.z = -rnd.range(0.35, 0.95);
      leaf.scale.setScalar(rnd.range(0.85, 1.25));
      g.add(leaf);
    }
    // 椰子
    var nuts = rnd.int(0, 3);
    for (var n = 0; n < nuts; n++) {
      var nut = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 10, 8),
        M.palmTrunk
      );
      nut.position.set(top.x + rnd.range(-0.3, 0.3), top.y - 0.28, top.z + rnd.range(-0.3, 0.3));
      nut.castShadow = true;
      g.add(nut);
    }
    return g;
  }

  function makePalmLeaf(M, rnd) {
    // 羽状叶：中轴 + 若干小叶片
    var g = new THREE.Group();
    var L = rnd.range(1.9, 3.1);
    var segs = 12;
    var spinePts = [];
    for (var i = 0; i <= segs; i++) {
      var t = i / segs;
      spinePts.push(new THREE.Vector3(t * L, -Math.pow(t, 2) * L * 0.42, 0));
    }
    var spineCurve = new THREE.CatmullRomCurve3(spinePts);
    var spine = new THREE.Mesh(
      new THREE.TubeGeometry(spineCurve, 16, 0.035, 5, false),
      M.palmLeaf
    );
    g.add(spine);

    // 小叶片：用一组扁平三角面近似羽片
    var count = Math.round(segs * 2);
    var positions = [], indices = [];
    for (var s = 0; s < count; s++) {
      var t2 = (s + 0.5) / count;
      var p = spineCurve.getPoint(t2);
      var tan = spineCurve.getTangent(t2);
      var side = s % 2 === 0 ? 1 : -1;
      var w = Math.sin(t2 * Math.PI) * 0.34 + 0.06;
      var droop = -0.12;
      var p0 = p.clone();
      var p1 = p.clone().add(new THREE.Vector3(0, 0, side * w).add(new THREE.Vector3(0, droop, 0)));
      var p2 = p.clone().add(new THREE.Vector3(tan.x * 0.16, tan.y * 0.16, side * w * 0.82));
      var base = s * 3;
      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      indices.push(base, base + 1, base + 2);
      indices.push(base, base + 2, base + 1);   // 双面
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    var mesh = new THREE.Mesh(geo, M.palmLeaf);
    mesh.castShadow = true;
    g.add(mesh);
    return g;
  }

  /* ---------- 灌木草丛（InstancedMesh） ---------- */
  function makeGrassPatches(M, rnd, track, count) {
    var blade = new THREE.ConeGeometry(0.075, 0.62, 4, 1, true);
    blade.translate(0, 0.31, 0);
    var inst = new THREE.InstancedMesh(blade, M.duneGrass, count);
    inst.castShadow = false;
    inst.receiveShadow = true;
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    var e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    var placed = 0, guard = 0;
    while (placed < count && guard++ < count * 40) {
      var a = rnd() * U.TAU;
      var rr = Math.sqrt(rnd()) * ISLAND_R * 1.02;
      var x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      var h = heightAt(x, z);
      if (h < 0.75 || h > 7.5) continue;
      // 避开骑行道
      var dTrack = Math.abs(rr - track.radius);
      if (dTrack < 1.9) continue;
      p.set(x, h - 0.05, z);
      e.set(rnd.range(-0.18, 0.18), rnd() * U.TAU, rnd.range(-0.18, 0.18));
      q.setFromEuler(e);
      var sc = rnd.range(0.7, 1.9);
      s.set(sc, rnd.range(0.8, 2.2), sc);
      m4.compose(p, q, s);
      inst.setMatrixAt(placed, m4);
      placed++;
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    return inst;
  }

  /* ---------- 礁石 ---------- */
  function makeRocks(M, rnd, count) {
    var base = new THREE.IcosahedronGeometry(1, 1);
    // 随机扰动顶点，做出不规则礁石
    var pos = base.attributes.position;
    var v = new THREE.Vector3();
    for (var i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      var n = U.fbm(v.x * 2.2 + 3, v.z * 2.2 + 7, 3) * 0.34;
      v.multiplyScalar(1 + n);
      v.y *= 0.66;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    base.computeVertexNormals();
    var inst = new THREE.InstancedMesh(base, M.rock, count);
    inst.castShadow = true; inst.receiveShadow = true;
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    var p = new THREE.Vector3(), s = new THREE.Vector3();
    var placed = 0, guard = 0;
    while (placed < count && guard++ < count * 40) {
      var a = rnd() * U.TAU;
      var rr = U.lerp(ISLAND_R * 0.72, ISLAND_R * 1.18, Math.pow(rnd(), 0.6));
      var x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      var h = heightAt(x, z);
      if (h > 0.55) continue;                 // 只放在水边
      var sc = rnd.range(0.5, 2.6);
      p.set(x, h - sc * 0.18, z);
      e.set(rnd.range(-0.2, 0.2), rnd() * U.TAU, rnd.range(-0.2, 0.2));
      q.setFromEuler(e);
      s.set(sc * rnd.range(0.8, 1.5), sc * rnd.range(0.5, 0.9), sc * rnd.range(0.8, 1.5));
      m4.compose(p, q, s);
      inst.setMatrixAt(placed, m4);
      placed++;
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    inst.name = 'rocks';
    return inst;
  }

  /* ---------- 灯塔 ---------- */
  function makeLighthouse(M) {
    var g = new THREE.Group();
    var H = 13.5;
    // 塔身：锥台
    var body = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 1.75, H, 24, 6, true),
      M.lighthouseBody
    );
    body.position.y = H / 2;
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);
    // 红白环带
    for (var i = 0; i < 4; i++) {
      var band = new THREE.Mesh(
        new THREE.CylinderGeometry(
          U.lerp(1.75, 1.05, (i * 2 + 1) / 9), U.lerp(1.75, 1.05, (i * 2 + 2) / 9),
          H / 9, 24, 1, true),
        M.lighthouseBand
      );
      band.position.y = H * (i * 2 + 1.5) / 9;
      band.castShadow = true;
      g.add(band);
    }
    // 观景台
    var deck = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.22, 24), M.lighthouseBand);
    deck.position.y = H;
    g.add(deck);
    var rail = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.05, 8, 28), M.chrome);
    rail.rotation.x = Math.PI / 2; rail.position.y = H + 0.62;
    g.add(rail);
    // 灯室
    var lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.9, 1.5, 16, 1, true), M.lighthouseLamp);
    lamp.position.y = H + 0.95;
    g.add(lamp);
    var cap = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.9, 16), M.lighthouseBand);
    cap.position.y = H + 2.15;
    cap.castShadow = true;
    g.add(cap);
    var ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), M.chrome);
    ball.position.y = H + 2.68;
    g.add(ball);

    var light = new THREE.PointLight(0xffd08a, 0, 46, 2);
    light.position.set(0, H + 0.95, 0);
    g.add(light);
    g.userData.lampLight = light;
    g.userData.lampMat = M.lighthouseLamp;
    return g;
  }

  /* ---------- 海鸥（InstancedMesh + 拍翅动画在 shader 里做太重，用 CPU 少量） ---------- */
  function makeGulls(M, rnd, count) {
    var gulls = [];
    var bodyGeo = new THREE.CapsuleGeometry(0.12, 0.42, 4, 8);
    bodyGeo.rotateZ(Math.PI / 2);
    for (var i = 0; i < count; i++) {
      var g = new THREE.Group();
      var body = new THREE.Mesh(bodyGeo, M.seagull);
      g.add(body);
      var wingGeo = new THREE.PlaneGeometry(0.62, 0.2);
      wingGeo.translate(0.31, 0, 0);
      var L = new THREE.Mesh(wingGeo, M.seagull);
      var R = new THREE.Mesh(wingGeo, M.seagull);
      R.scale.x = -1;
      L.rotation.x = Math.PI / 2; R.rotation.x = Math.PI / 2;
      L.material = M.seagull; R.material = M.seagull;
      var wl = new THREE.Group(); wl.add(L);
      var wr = new THREE.Group(); wr.add(R);
      g.add(wl); g.add(wr);
      g.userData = {
        wl: wl, wr: wr,
        r: rnd.range(26, 78),
        a: rnd() * U.TAU,
        y: rnd.range(9, 26),
        spd: rnd.range(0.055, 0.13) * rnd.sign(),
        flap: rnd.range(5.5, 8.5),
        ph: rnd() * 10
      };
      gulls.push(g);
    }
    return gulls;
  }

  /* ---------- 云（面向相机的 billboard） ---------- */
  function makeClouds(M, rnd, count) {
    var g = new THREE.Group();
    for (var i = 0; i < count; i++) {
      var plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), M.cloudMat.clone());
      var s = rnd.range(14, 44);
      plane.scale.set(s, s * rnd.range(0.32, 0.5), 1);
      var a = rnd() * U.TAU, r = rnd.range(70, 210);
      plane.position.set(Math.cos(a) * r, rnd.range(26, 62), Math.sin(a) * r);
      plane.userData.spd = rnd.range(0.4, 1.4);
      plane.userData.baseY = plane.position.y;
      plane.renderOrder = -5;
      g.add(plane);
    }
    g.userData.clouds = g.children.slice();
    return g;
  }

  /* =================================================================== */
  function World(scene, M, opts) {
    opts = opts || {};
    var rnd = U.rng(20260930);
    this.M = M;
    this.scene = scene;

    this.track = buildTrack();

    var terrain = buildTerrain(M);
    scene.add(terrain);
    this.terrain = terrain;

    var ocean = buildOcean(M, 900);
    scene.add(ocean);
    this.ocean = ocean;

    // 棕榈树
    var palms = new THREE.Group();
    var palmCount = 34;
    var placed = 0, guard = 0;
    while (placed < palmCount && guard++ < palmCount * 60) {
      var a = rnd() * U.TAU;
      var rr = U.lerp(6, ISLAND_R * 1.0, Math.pow(rnd(), 0.75));
      var x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      var h = heightAt(x, z);
      if (h < 0.7 || h > 8) continue;
      if (Math.abs(rr - this.track.radius) < 3.0) continue;
      var palm = makePalm(M, rnd);
      palm.position.set(x, h - 0.1, z);
      palm.rotation.y = rnd() * U.TAU;
      palm.scale.setScalar(rnd.range(0.8, 1.25));
      palms.add(palm);
      placed++;
    }
    scene.add(palms);
    this.palms = palms;

    var grass = makeGrassPatches(M, rnd, this.track, 1400);
    scene.add(grass);
    this.grass = grass;

    var rocks = makeRocks(M, rnd, 90);
    scene.add(rocks);
    this.rocks = rocks;

    // 灯塔放在岛外的一块礁石上
    var lh = makeLighthouse(M);
    var lhA = 2.35, lhR = ISLAND_R * 1.28;
    lh.position.set(Math.cos(lhA) * lhR, -1.6, Math.sin(lhA) * lhR);
    scene.add(lh);
    this.lighthouse = lh;

    var gulls = makeGulls(M, rnd, 12);
    var gullGroup = new THREE.Group();
    gulls.forEach(function (g) { gullGroup.add(g); });
    scene.add(gullGroup);
    this.gulls = gulls;

    var clouds = makeClouds(M, rnd, 16);
    scene.add(clouds);
    this.clouds = clouds;

    this.heightAt = heightAt;
    this.ISLAND_R = ISLAND_R;
  }

  World.prototype.update = function (t, dt, camera, nightAmt) {
    // 海面
    updateOcean(this.ocean, t, 0.6, 1);

    // 海鸥
    for (var i = 0; i < this.gulls.length; i++) {
      var g = this.gulls[i], d = g.userData;
      d.a += d.spd * dt;
      var x = Math.cos(d.a) * d.r, z = Math.sin(d.a) * d.r;
      var y = d.y + Math.sin(t * 0.6 + d.ph) * 1.6;
      g.position.set(x, y, z);
      g.rotation.y = -d.a + (d.spd > 0 ? Math.PI / 2 : -Math.PI / 2);
      g.rotation.z = Math.sin(t * 0.6 + d.ph) * 0.12;
      var f = Math.sin(t * d.flap + d.ph);
      d.wl.rotation.z = f * 0.72;
      d.wr.rotation.z = -f * 0.72;
    }

    // 云：缓慢漂移 + 始终面向相机
    var cl = this.clouds.children;
    for (var c = 0; c < cl.length; c++) {
      var p = cl[c];
      p.position.x += p.userData.spd * dt;
      if (p.position.x > 230) p.position.x = -230;
      p.position.y = p.userData.baseY + Math.sin(t * 0.12 + c) * 0.9;
      p.lookAt(camera.position.x, p.position.y, camera.position.z);
    }

    // 灯塔：夜里亮灯并旋转扫光
    var lamp = this.lighthouse.userData.lampLight;
    lamp.intensity = U.smoothstep(0.02, 0.28, nightAmt) * 260;
    this.lighthouse.userData.lampMat.emissiveIntensity =
      U.lerp(0.05, 2.6, nightAmt);
  };

  PB.World = World;
  PB.World.heightAt = heightAt;
  PB.World.ISLAND_R = ISLAND_R;
})();
