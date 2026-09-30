/* =====================================================================
 * pelican.js — 程序化鹈鹕（骨架 + 蒙皮 SkinnedMesh + 休息姿态驱动的链式 IK）
 *
 * 骨架层级（局部朝向：+Z 前进，+Y 上，+X 左翅方向与世界一致）
 *   root
 *    └ hips
 *       ├ spine -> chest
 *       │    ├ neck1 -> neck2 -> neck3 -> head -> jaw
 *       │    ├ shoulderL -> wingUpL -> wingLoL -> wingTipL
 *       │    └ shoulderR -> wingUpR -> wingLoR -> wingTipR
 *       ├ tail -> tailTip
 *       ├ thighL -> shinL -> footL -> toeL
 *       └ thighR -> shinR -> footR -> toeR
 *
 * 蒙皮：每段骨骼按下述方式生成一圈状管面，顶点权重按段内位置在
 *       「父骨 / 子骨」两根骨之间线性混合（最多 2 骨 weight）。
 * IK  ：先解析求出关节位置（给出明确的肘/膝朝向），再用
 *       setFromUnitVectors 把「骨骼静止朝向」aim 到目标，theta roll 由
 *       静止姿态天然决定 —— 这是爬行动物/鸟类腿部外翻感的来源。
 * ===================================================================*/
(function () {
  'use strict';
  var PB = window.PB, U = PB.U;

  /* ---------------- 骨架定义：[name, parent, offset] ---------------- */
  var BONES = [
    ['root', null, [0, 0, 0]],
    ['hips', 'root', [0, 0.86, -0.10]],
    ['spine', 'hips', [0, 0.10, 0.10]],
    ['chest', 'spine', [0, 0.12, 0.12]],

    ['neck1', 'chest', [0, 0.16, 0.08]],
    ['neck2', 'neck1', [0, 0.19, 0.03]],
    ['neck3', 'neck2', [0, 0.18, 0.02]],
    ['head', 'neck3', [0, 0.17, 0.02]],
    ['jaw', 'head', [0, -0.015, 0.035]],

    ['shoulderL', 'chest', [0.115, 0.10, 0.02]],
    ['wingUpL', 'shoulderL', [0.062, 0.015, 0]],
    ['wingLoL', 'wingUpL', [0.295, -0.020, -0.020]],
    ['wingTipL', 'wingLoL', [0.270, -0.026, -0.038]],

    ['shoulderR', 'chest', [-0.115, 0.10, 0.02]],
    ['wingUpR', 'shoulderR', [-0.062, 0.015, 0]],
    ['wingLoR', 'wingUpR', [-0.295, -0.020, -0.020]],
    ['wingTipR', 'wingLoR', [-0.270, -0.026, -0.038]],

    ['tail', 'hips', [0, 0.02, -0.22]],
    ['tailTip', 'tail', [0, -0.02, -0.18]],

    ['thighL', 'hips', [0.092, -0.02, -0.02]],
    ['shinL', 'thighL', [0.014, -0.470, 0.012]],
    ['footL', 'shinL', [0, -0.500, 0.016]],
    ['toeL', 'footL', [0, -0.030, 0.062]],

    ['thighR', 'hips', [-0.092, -0.02, -0.02]],
    ['shinR', 'thighR', [-0.014, -0.470, 0.012]],
    ['footR', 'shinR', [0, -0.500, 0.016]],
    ['toeR', 'footR', [0, -0.030, 0.062]]
  ];

  function buildSkeleton() {
    var bones = [], byName = {}, root = null;
    BONES.forEach(function (b) {
      var bone = new THREE.Bone();
      bone.name = b[0];
      bone.position.set(b[2][0], b[2][1], b[2][2]);
      byName[b[0]] = bone;
      bones.push(bone);
      if (b[1]) byName[b[1]].add(bone); else root = bone;
    });
    root.updateMatrixWorld(true);
    return { bones: bones, byName: byName, root: root };
  }

  /* ---------------- 蒙皮管面生成 ---------------- */
  /**
   * seg: {from, to, rings, columns, rA(t), rB(t)}
   * 返回 {positions, normals, uvs, indices, skinIndex, skinWeight} 的数组形式
   * 坐标系：以骨骼当前（静止）世界位置为准 —— 因为骨架在静止姿态下绑定
   */
  function buildSegmentData(skel, seg, boneIndex, out) {
    var b0 = skel.byName[seg.from], b1 = skel.byName[seg.to];
    var i0 = boneIndex[seg.from], i1 = boneIndex[seg.to];
    var p0 = new THREE.Vector3().setFromMatrixPosition(b0.matrixWorld);
    var p1 = new THREE.Vector3().setFromMatrixPosition(b1.matrixWorld);
    var dir = new THREE.Vector3().subVectors(p1, p0);
    var len = dir.length();
    if (len < 1e-6) return;
    dir.normalize();

    // 正交基 (ax, ay, dir)
    var upRef = Math.abs(dir.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    var ax = new THREE.Vector3().crossVectors(upRef, dir).normalize();
    var ay = new THREE.Vector3().crossVectors(dir, ax).normalize();

    var rings = seg.rings || 8;
    var cols = seg.columns || 10;
    var start = out.pos.length / 3;

    for (var r = 0; r <= rings; r++) {
      var t = r / rings;
      var cx = p0.x + (p1.x - p0.x) * t;
      var cy = p0.y + (p1.y - p0.y) * t;
      var cz = p0.z + (p1.z - p0.z) * t;
      var rA = seg.rA(t), rB = seg.rB(t);     // A 沿 ay，B 沿 ax
      var w1 = U.smoothstep(0, 1, t), w0 = 1 - w1;
      for (var c = 0; c < cols; c++) {
        var a = c / cols * U.TAU;
        var ca = Math.cos(a), sa = Math.sin(a);
        var oA = ca * rA, oB = sa * rB;
        out.pos.push(
          cx + ax.x * oB + ay.x * oA,
          cy + ax.y * oB + ay.y * oA,
          cz + ax.z * oB + ay.z * oA);
        // 椭圆法线近似
        var nx = ax.x * (sa / Math.max(rB, 1e-4)) + ay.x * (ca / Math.max(rA, 1e-4));
        var ny = ax.y * (sa / Math.max(rB, 1e-4)) + ay.y * (ca / Math.max(rA, 1e-4));
        var nz = ax.z * (sa / Math.max(rB, 1e-4)) + ay.z * (ca / Math.max(rA, 1e-4));
        var nl = Math.hypot(nx, ny, nz) || 1;
        out.nor.push(nx / nl, ny / nl, nz / nl);
        out.uv.push(c / cols, t);
        out.si.push(i0, i1, 0, 0);
        out.sw.push(w0, w1, 0, 0);
      }
    }
    for (var r2 = 0; r2 < rings; r2++) {
      for (var c2 = 0; c2 < cols; c2++) {
        var cn = (c2 + 1) % cols;
        var a0 = start + r2 * cols + c2;
        var a1 = start + r2 * cols + cn;
        var b_ = start + (r2 + 1) * cols + c2;
        var b1i = start + (r2 + 1) * cols + cn;
        out.idx.push(a0, b_, b1i, a0, b1i, a1);
      }
    }
  }

  function makeSkinGeometry(skel, segs) {
    var boneIndex = {};
    skel.bones.forEach(function (b, i) { boneIndex[b.name] = i; });
    var out = { pos: [], nor: [], uv: [], idx: [], si: [], sw: [] };
    segs.forEach(function (seg) { buildSegmentData(skel, seg, boneIndex, out); });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(out.si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(out.sw, 4));
    geo.setIndex(out.idx);
    geo.computeBoundingSphere();
    return geo;
  }

  /* ---------------- 各部位解剖参数 ---------------- */
  function bodySegments() {
    return [
      {
        from: 'hips', to: 'chest', rings: 16, columns: 16,
        rA: function (t) { return (0.128 + Math.sin(t * Math.PI) * 0.048) * U.lerp(0.92, 1.06, t); },
        rB: function (t) { return (0.140 + Math.sin(t * Math.PI * 0.9) * 0.045) * U.lerp(0.95, 1.0, t); }
      },
      {
        from: 'tail', to: 'tailTip', rings: 8, columns: 12,
        rA: function (t) { return U.lerp(0.070, 0.018, Math.pow(t, 0.8)); },
        rB: function (t) { return U.lerp(0.110, 0.048, Math.pow(t, 0.7)); }
      },
      {
        from: 'neck1', to: 'neck2', rings: 7, columns: 12,
        rA: function (t) { return U.lerp(0.086, 0.072, t); },
        rB: function (t) { return U.lerp(0.090, 0.076, t); }
      },
      {
        from: 'neck2', to: 'neck3', rings: 7, columns: 12,
        rA: function (t) { return U.lerp(0.072, 0.060, t); },
        rB: function (t) { return U.lerp(0.076, 0.066, t); }
      },
      {
        from: 'neck3', to: 'head', rings: 6, columns: 12,
        rA: function (t) { return U.lerp(0.060, 0.056, t); },
        rB: function (t) { return U.lerp(0.066, 0.064, t); }
      },
      {
        from: 'head', to: 'jaw', rings: 5, columns: 12,
        rA: function (t) { return U.lerp(0.058, 0.044, t); },
        rB: function (t) { return U.lerp(0.068, 0.056, t); }
      }
    ];
  }

  function wingSegments(S) {
    return [
      {
        from: 'shoulder' + S, to: 'wingUp' + S, rings: 5, columns: 10,
        rA: function (t) { return U.lerp(0.060, 0.052, t); },
        rB: function (t) { return U.lerp(0.072, 0.060, t); }
      },
      {
        from: 'wingUp' + S, to: 'wingLo' + S, rings: 9, columns: 10,
        rA: function (t) { return U.lerp(0.052, 0.030, t); },
        rB: function (t) { return U.lerp(0.082, 0.052, t); }
      },
      {
        from: 'wingLo' + S, to: 'wingTip' + S, rings: 8, columns: 10,
        rA: function (t) { return U.lerp(0.030, 0.009, Math.pow(t, 0.8)); },
        rB: function (t) { return U.lerp(0.054, 0.024, Math.pow(t, 0.7)); }
      }
    ];
  }

  function legSegments(S) {
    return [
      {
        from: 'thigh' + S, to: 'shin' + S, rings: 7, columns: 8,
        rA: function (t) { return U.lerp(0.046, 0.026, t); },
        rB: function (t) { return U.lerp(0.046, 0.026, t); }
      },
      {
        from: 'shin' + S, to: 'foot' + S, rings: 7, columns: 8,
        rA: function (t) { return U.lerp(0.026, 0.016, t); },
        rB: function (t) { return U.lerp(0.026, 0.016, t); }
      },
      {
        from: 'foot' + S, to: 'toe' + S, rings: 4, columns: 8,
        rA: function (t) { return U.lerp(0.019, 0.007, t); },
        rB: function (t) { return U.lerp(0.034, 0.012, t); }
      }
    ];
  }

  /* ---------------- 喙 ---------------- */
  function buildBeak(M) {
    var g = new THREE.Group();
    var pts = [], N = 10;
    for (var i = 0; i <= N; i++) {
      var t = i / N;
      pts.push(new THREE.Vector3(0, -0.010 * t * t, 0.050 + t * 0.295));
    }
    var curve = new THREE.CatmullRomCurve3(pts);
    var rings = 18, cols = 14;
    var pos = [], nor = [], uv = [], idx = [];
    for (var r = 0; r <= rings; r++) {
      var tt = r / rings;
      var p = curve.getPoint(tt);
      var tan = curve.getTangent(tt);
      var upRef = new THREE.Vector3(0, 1, 0);
      var bx = new THREE.Vector3().crossVectors(upRef, tan).normalize();
      var by = new THREE.Vector3().crossVectors(tan, bx).normalize();
      var w = U.lerp(0.040, 0.005, Math.pow(tt, 0.7));
      var h = U.lerp(0.030, 0.004, Math.pow(tt, 0.75));
      for (var c = 0; c < cols; c++) {
        var a = c / cols * U.TAU;
        var ca = Math.cos(a), sa = Math.sin(a);
        var oA = ca * h * (sa > 0 ? 1.0 : 0.45);   // 上颌饱满，上颚面
        var oB = sa * w;
        pos.push(
          p.x + bx.x * oB + by.x * oA,
          p.y + bx.y * oB + by.y * oA,
          p.z + bx.z * oB + by.z * oA);
        var nx = bx.x * sa / Math.max(w, 1e-4) + by.x * ca / Math.max(h, 1e-4);
        var ny = bx.y * sa / Math.max(w, 1e-4) + by.y * ca / Math.max(h, 1e-4);
        var nz = bx.z * sa / Math.max(w, 1e-4) + by.z * ca / Math.max(h, 1e-4);
        var nl = Math.hypot(nx, ny, nz) || 1;
        nor.push(nx / nl, ny / nl, nz / nl);
        uv.push(c / cols, tt);
      }
    }
    for (var r2 = 0; r2 < rings; r2++) {
      for (var c2 = 0; c2 < cols; c2++) {
        var cn = (c2 + 1) % cols;
        var a0 = r2 * cols + c2, a1 = r2 * cols + cn;
        var b_ = (r2 + 1) * cols + c2, b1i = (r2 + 1) * cols + cn;
        idx.push(a0, b_, b1i, a0, b1i, a1);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    var upper = new THREE.Mesh(geo, M.beak);
    upper.castShadow = true;
    g.add(upper);

    var nail = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.042, 10), M.beakNail);
    nail.rotation.x = Math.PI / 2;
    nail.position.set(0, -0.014, 0.362);
    nail.scale.set(1, 0.7, 1);
    g.add(nail);

    for (var s = -1; s <= 1; s += 2) {
      var ridge = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.004, 0.105), M.beakNail);
      ridge.position.set(s * 0.013, 0.014, 0.125);
      ridge.rotation.y = s * 0.06;
      g.add(ridge);
    }

    var lower = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.009, 0.29), M.beak);
    lower.position.set(0, -0.050, 0.185);
    lower.rotation.x = -0.10;
    g.add(lower);
    var lower2 = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.007, 0.095), M.beakNail);
    lower2.position.set(0, -0.056, 0.335);
    lower2.rotation.x = -0.15;
    g.add(lower2);

    g.userData = { lower: lower, lower2: lower2, upper: upper };
    return g;
  }

  function buildPouch(M) {
    var pts = [], N = 24;
    for (var i = 0; i <= N; i++) {
      var t = i / N;
      var r = Math.sin(t * Math.PI) * 0.070 + 0.004;
      r *= 1 + Math.sin(t * Math.PI) * 0.30;
      pts.push(new THREE.Vector2(Math.max(0.0018, r), -t * 0.195 + 0.014));
    }
    var geo = new THREE.LatheGeometry(pts, 22);
    geo.scale(1.0, 1.0, 0.60);
    geo.computeVertexNormals();
    var mesh = new THREE.Mesh(geo, M.pouch);
    mesh.castShadow = true;
    mesh.userData = { geo: geo, base: new Float32Array(geo.attributes.position.array) };
    return mesh;
  }

  function buildCrest(M, count) {
    var g = new THREE.Group();
    var rnd = U.rng(88);
    for (var i = 0; i < count; i++) {
      var t = count > 1 ? i / (count - 1) : 0.5;
      var a = U.lerp(-0.60, 0.60, t) + rnd.range(-0.07, 0.07);
      var len = rnd.range(0.070, 0.150);
      var curvePts = [];
      for (var k = 0; k <= 5; k++) {
        var u = k / 5;
        curvePts.push(new THREE.Vector3(
          Math.sin(a) * u * 0.028,
          u * len - u * u * len * 0.38,
          -u * u * len * 0.32));
      }
      var curve = new THREE.CatmullRomCurve3(curvePts);
      var geo = new THREE.TubeGeometry(curve, 6, 0.009, 5, false);
      var p = geo.attributes.position, v = new THREE.Vector3();
      for (var j = 0; j < p.count; j++) {
        v.fromBufferAttribute(p, j);
        v.x *= 1.7; p.setXYZ(j, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      var f = new THREE.Mesh(geo, M.crest);
      f.castShadow = true;
      g.add(f);
    }
    return g;
  }

  function buildEyes(M) {
    var g = new THREE.Group();
    var eyes = [];
    [-1, 1].forEach(function (s) {
      var eg = new THREE.Group();
      var white = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 12), M.eyeWhite);
      eg.add(white);
      var pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0145, 12, 10), M.eye);
      pupil.position.z = 0.016; pupil.scale.z = 0.8;
      eg.add(pupil);
      var spec = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      spec.position.set(0.006, 0.007, 0.024);
      eg.add(spec);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.005, 6, 18), M.pouch);
      ring.rotation.x = Math.PI / 2; ring.position.z = -0.004;
      eg.add(ring);
      // 眼睑（眨眼用，上下两片）
      var lidMat = M.body;
      var lidTop = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 8, 0, U.TAU, 0, Math.PI * 0.42), lidMat);
      var lidBot = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 8, 0, U.TAU, Math.PI * 0.58, Math.PI * 0.42), lidMat);
      eg.add(lidTop); eg.add(lidBot);
      eg.position.set(s * 0.040, 0.028, 0.040);
      g.add(eg);
      eyes.push({ group: eg, pupil: pupil, lidTop: lidTop, lidBot: lidBot, side: s });
    });
    g.userData = { eyes: eyes };
    return g;
  }

  /* ---------------- 骑行装备 ---------------- */
  function buildHelmet(M) {
    var g = new THREE.Group();
    var geo = new THREE.SphereGeometry(0.105, 22, 14, 0, U.TAU, 0, Math.PI * 0.60);
    var shell = new THREE.Mesh(geo, M.helmet);
    shell.castShadow = true;
    g.add(shell);
    for (var i = 0; i < 5; i++) {
      var a = -0.85 + i * 0.42;
      var slot = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.020, 0.072), M.helmetStripe);
      slot.position.set(Math.sin(a) * 0.072, 0.072, Math.cos(a) * 0.038);
      slot.rotation.x = -0.32; slot.rotation.y = a;
      g.add(slot);
    }
    var visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.110, 16, 8, 0, U.TAU, Math.PI * 0.44, Math.PI * 0.15), M.helmet);
    visor.scale.set(1, 0.45, 1.30);
    visor.position.set(0, 0.010, 0.024);
    g.add(visor);
    [-1, 1].forEach(function (s) {
      var strap = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.10, 6), M.helmetStripe);
      strap.position.set(s * 0.060, -0.050, 0.026);
      strap.rotation.z = s * 0.26;
      g.add(strap);
    });
    var refl = new THREE.Mesh(new THREE.CircleGeometry(0.013, 12), new THREE.MeshStandardMaterial({
      color: 0xff6b4a, emissive: 0xff4a28, emissiveIntensity: 0.6, roughness: 0.3,
      side: THREE.DoubleSide
    }));
    refl.position.set(0, 0.042, -0.092);
    refl.rotation.y = Math.PI;
    g.add(refl);
    return g;
  }

  /** 自己实现的带状体 ^^ tube —— 便于逐帧以同一布局更新顶点 */
  function Ribbon(SEG, COLS, radiusFn) {
    this.SEG = SEG; this.COLS = COLS; this.radiusFn = radiusFn;
    this.count = (SEG + 1) * COLS;
    this.positions = new Float32Array(this.count * 3);
    this.normals = new Float32Array(this.count * 3);
    this.uvs = new Float32Array(this.count * 2);
    this.indices = [];
    for (var r = 0; r < SEG; r++) {
      for (var c = 0; c < COLS; c++) {
        var cn = (c + 1) % COLS;
        var a0 = r * COLS + c, a1 = r * COLS + cn;
        var b_ = (r + 1) * COLS + c, b1 = (r + 1) * COLS + cn;
        this.indices.push(a0, b_, b1, a0, b1, a1);
      }
    }
    this.up = new THREE.Vector3(0, 1, 0);
    this._v = new THREE.Vector3();
    this._tan = new THREE.Vector3();
    this._bx = new THREE.Vector3();
    this._by = new THREE.Vector3();
    this._n = new THREE.Vector3();
  }
  Ribbon.prototype.update = function (points) {
    var P = this.positions, Nn = this.normals, Uv = this.uvs;
    var COLS = this.COLS, SEG = this.SEG;
    var tan = this._tan, bx = this._bx, by = this._by, v = this._v, n = this._n;
    var k = 0;
    for (var r = 0; r <= SEG; r++) {
      var t = r / SEG;
      var p = points[Math.min(r, points.length - 1)];
      var pn = points[Math.min(r + 1, points.length - 1)];
      var pb = points[Math.max(r - 1, 0)];
      tan.subVectors(pn, pb);
      if (tan.lengthSq() < 1e-10) tan.set(0, 0, -1);
      tan.normalize();
      bx.crossVectors(this.up, tan);
      if (bx.lengthSq() < 1e-8) bx.set(1, 0, 0); else bx.normalize();
      by.crossVectors(tan, bx).normalize();
      var rad = this.radiusFn(t);
      for (var c = 0; c < COLS; c++) {
        var a = c / COLS * U.TAU;
        var ca = Math.cos(a), sa = Math.sin(a);
        n.set(0, 0, 0)
          .addScaledVector(by, ca)
          .addScaledVector(bx, sa)
          .normalize();
        v.copy(p).addScaledVector(by, ca * rad * 0.42).addScaledVector(bx, sa * rad);
        P[k * 3] = v.x; P[k * 3 + 1] = v.y; P[k * 3 + 2] = v.z;
        Nn[k * 3] = n.x; Nn[k * 3 + 1] = n.y; Nn[k * 3 + 2] = n.z;
        Uv[k * 2] = c / COLS; Uv[k * 2 + 1] = t;
        k++;
      }
    }
  };
  Ribbon.prototype.toGeometry = function () {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    geo.setIndex(this.indices);
    geo.computeBoundingSphere();
    return geo;
  };

  function buildScarf(M) {
    var SEG = 18, COLS = 7;
    var ribbon = new Ribbon(SEG, COLS, function (t) { return 0.026 * U.lerp(1.0, 0.35, t); });
    var pts = [];
    for (var i = 0; i <= SEG + 1; i++) pts.push(new THREE.Vector3(0, 0, -i * 0.042));
    ribbon.update(pts);
    var geo = ribbon.toGeometry();
    var mesh = new THREE.Mesh(geo, M.scarf);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    var g = new THREE.Group();
    g.add(mesh);
    g.userData = { ribbon: ribbon, mesh: mesh, geo: geo, SEG: SEG, pts: pts.slice(0, SEG + 1) };
    return g;
  }

  function buildGoggles(M) {
    var g = new THREE.Group();
    [-1, 1].forEach(function (s) {
      var lensMat = new THREE.MeshPhysicalMaterial({
        color: 0x21384f, roughness: 0.05, metalness: 0.05,
        transmission: 0.45, thickness: 0.04, ior: 1.45,
        clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6,
        side: THREE.DoubleSide
      });
      var lens = new THREE.Mesh(
        new THREE.SphereGeometry(0.036, 14, 10, 0, U.TAU, 0, Math.PI * 0.5), lensMat);
      lens.rotation.x = Math.PI / 2;
      lens.scale.set(1, 0.72, 0.85);
      lens.position.set(s * 0.040, 0.030, 0.052);
      g.add(lens);
      var rim = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 6, 18), M.helmetStripe);
      rim.position.set(s * 0.040, 0.030, 0.058);
      g.add(rim);
    });
    var strap = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.008, 6, 22), M.helmetStripe);
    strap.rotation.y = Math.PI / 2;
    strap.rotation.x = 0.12;
    strap.position.set(0, 0.036, 0.010);
    g.add(strap);
    return g;
  }

  function buildFoot(M) {
    var g = new THREE.Group();
    var shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.034, 0.012, 0.044, 0.072, 0.0, 0.092);
    shape.bezierCurveTo(-0.044, 0.072, -0.034, 0.012, 0, 0);
    var web = new THREE.Mesh(new THREE.ShapeGeometry(shape, 14), M.foot);
    web.rotation.x = -Math.PI / 2;
    web.position.set(0, -0.020, 0.028);
    web.castShadow = true;
    g.add(web);
    [-1, 0, 1].forEach(function (d) {
      var toe = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.004, 0.082, 5), M.leg);
      toe.rotation.x = Math.PI / 2;
      toe.position.set(d * 0.019, -0.016, 0.060);
      toe.rotation.z = d * 0.12;
      g.add(toe);
      var claw = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.016, 5), M.beakNail);
      claw.rotation.x = -Math.PI / 2;
      claw.position.set(d * 0.019, -0.016, 0.104);
      g.add(claw);
    });
    return g;
  }

  /* ---------------- 静止朝向向量（用于 IK aim） ---------------- */
  function restDir(fromBone, childBone) {
    return childBone.position.clone().normalize();
  }

  /* ---------------- 链式 IK ---------------- */
  var _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  var _q1 = new THREE.Quaternion(), _m4 = new THREE.Matrix4();

  /**
   * 把 bone 的子骨末端指向 worldTarget，旋转中轴为「静止朝向」
   * childRestDir: bone 局部坐标系中指向子骨的静止方向向量
   */
  function aimAt(bone, childRestDir, worldTarget) {
    bone.updateMatrixWorld(true);
    var boneWorld = _v1.setFromMatrixPosition(bone.matrixWorld);
    var desired = _v2.subVectors(worldTarget, boneWorld);
    if (desired.lengthSq() < 1e-10) return;
    desired.normalize();
    var parent = bone.parent;
    parent.updateMatrixWorld(true);
    // 转到父骨架局部方向
    var pq = _q1;
    parent.getWorldQuaternion(pq).invert();
    desired.applyQuaternion(pq).normalize();
    var q = new THREE.Quaternion().setFromUnitVectors(childRestDir, desired);
    bone.quaternion.copy(q);
    bone.updateMatrixWorld(true);
  }

  /**
   * 两段肢体 IK：bone1 -> bone2 -> target（target 是肢体末端应到达的点）
   * pole: 决定肘/膝外翻方向的世界向量
   */
  function solveTwoBone(bone1, bone2, len1, len2, target, pole) {
    bone1.updateMatrixWorld(true);
    var root = _v3.setFromMatrixPosition(bone1.matrixWorld);
    var ik = U.twoBoneIK(root, target, len1, len2, pole);

    // 关节位置：把 aim 方向绕 axis 旋转 angle1（朝 pole 一侧）
    var jointDir = ik.dir.clone().applyAxisAngle(ik.axis, ik.angle1);
    var joint = jointDir.clone().multiplyScalar(len1).add(root);

    var rest1 = bone2.position.clone().normalize();
    aimAt(bone1, rest1, joint);
    // 第二段指向真实目标
    var rest2 = (bone2.children.length ? bone2.children[0].position.clone().normalize() : new THREE.Vector3(0, -1, 0));
    aimAt(bone2, rest2, target);
    return ik;
  }

  /* =================================================================== */
  function Pelican(M) {
    var skel = buildSkeleton();
    var group = new THREE.Group();
    group.add(skel.root);
    group.updateMatrixWorld(true);

    var boneSegs = function (S) { return S === null ? null : S; };   // 占位

    var body = new THREE.SkinnedMesh(makeSkinGeometry(skel, bodySegments()), M.body);
    var wingL = new THREE.SkinnedMesh(makeSkinGeometry(skel, wingSegments('L')), M.wing);
    var wingR = new THREE.SkinnedMesh(makeSkinGeometry(skel, wingSegments('R')), M.wing);
    var legL = new THREE.SkinnedMesh(makeSkinGeometry(skel, legSegments('L')), M.leg);
    var legR = new THREE.SkinnedMesh(makeSkinGeometry(skel, legSegments('R')), M.leg);

    [body, wingL, wingR, legL, legR].forEach(function (m) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      group.add(m);
    });
    group.updateMatrixWorld(true);

    var skeleton = new THREE.Skeleton(skel.bones);
    [body, wingL, wingR, legL, legR].forEach(function (m) { m.bind(skeleton); });

    var s = skel.byName;

    // 脚蹼
    var feet = [];
    [['footL', 1], ['footR', -1]].forEach(function (pair) {
      var f = buildFoot(M);
      s[pair[0]].add(f);
      feet.push({ group: f, side: pair[1] });
    });

    // 头部零件
    var beak = buildBeak(M);
    beak.position.set(0, -0.006, 0.048);
    s['head'].add(beak);

    var pouch = buildPouch(M);
    pouch.position.set(0, -0.028, 0.048);
    s['head'].add(pouch);

    var crest = buildCrest(M, 11);
    crest.position.set(0, 0.045, -0.028);
    s['head'].add(crest);

    var eyes = buildEyes(M);
    s['head'].add(eyes);

    var helmet = buildHelmet(M);
    helmet.position.set(0, 0.060, -0.004);
    s['head'].add(helmet);

    var goggles = buildGoggles(M);
    goggles.position.set(0, 0.028, 0.018);
    s['head'].add(goggles);

    var scarf = buildScarf(M);
    scarf.position.set(0, 0.130, 0.050);
    s['chest'].add(scarf);

    // 尾羽扇
    var tailFan = new THREE.Group();
    for (var tf = 0; tf < 9; tf++) {
      var tt = (tf / 8 - 0.5) * 2;
      var fm = new THREE.Mesh(
        new THREE.BoxGeometry(0.015, 0.004, 0.155),
        (tf % 3 === 0) ? M.wingTip : M.wing);
      fm.position.set(tt * 0.052, 0, 0.072);
      fm.rotation.y = tt * 0.44;
      fm.rotation.x = 0.05;
      fm.castShadow = true;
      tailFan.add(fm);
    }
    s['tailTip'].add(tailFan);

    // 翼尖黑羽（初级飞羽）
    [['wingTipL', 0.260], ['wingTipR', -0.260]].forEach(function (pair) {
      var fan = new THREE.Group();
      for (var i = 0; i < 6; i++) {
        var u = (i / 5 - 0.5) * 2;
        var f = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 0.115), M.wingTip);
        f.position.set(u * 0.030, 0, 0.052);
        f.rotation.y = u * 0.34;
        fan.add(f);
      }
      s[pair[0]].add(fan);
    });

    group.updateMatrixWorld(true);

    this.group = group;
    this.skel = skel;
    this.M = M;
    this.skeleton = skeleton;
    this.blink = 0;
    this._blinkT = 2.4;
    this.userData = {
      body: body, wingL: wingL, wingR: wingR, legL: legL, legR: legR,
      feet: feet, beak: beak, pouch: pouch, crest: crest, eyes: eyes,
      helmet: helmet, goggles: goggles, scarf: scarf, tailFan: tailFan
    };

    // 骨长（用于 IK）
    this.len = {
      thigh: s['shinL'].position.length(),
      shin: (function () { return s['footL'].position.length(); })(),
      footTip: s['toeL'].position.length() + 0.055,
      wingUp: s['wingLoL'].position.length(),
      wingLo: s['wingTipL'].position.length(),
      wingTipLen: 0.115
    };
  }

  /** 每帧求解姿态 */
  Pelican.prototype.solve = function (pose, dt, t) {
    var s = this.skel.byName;
    var u = this.userData;
    var bounce = pose.bounce || 0;
    var lean = pose.lean || 0;
    var roll = pose.roll || 0;
    var spd = pose.speed || 0;
    var spdN = U.saturate(spd / 9);

    /* ---------- 躯干 ---------- */
    s['hips'].position.set(0, 0.86 + bounce * 0.010, -0.10);
    s['hips'].rotation.set(-lean * 0.42 + bounce * 0.015, 0, roll * 0.30);
    s['spine'].rotation.set(-lean * 0.26, 0, roll * 0.12);
    s['chest'].rotation.set(-lean * 0.20, 0, roll * 0.08);

    /* ---------- 颈与头 ---------- */
    var bob = Math.sin(t * 2.1) * 0.016;
    var neckLook = pose.neckLook || 0;
    s['neck1'].rotation.set(0.30 - lean * 0.30 + bob * 0.4, neckLook * 0.45, 0);
    s['neck2'].rotation.set(-0.34 + lean * 0.16 + bob * 0.3, neckLook * 0.5, 0);
    s['neck3'].rotation.set(-0.26 + lean * 0.12 + bob * 0.25, neckLook * 0.45, 0);
    s['head'].rotation.set(
      0.26 - lean * 0.10 + Math.sin(t * 1.7) * 0.022 + bounce * 0.02,
      neckLook * 0.55, roll * 0.14);

    /* ---------- 翅膀：抓车把 or 张开 ---------- */
    var spread = pose.wingSpread || 0;
    if (spread > 0.001) {
      var flap = Math.sin(t * (4.0 + spread * 2.5));
      ['L', 'R'].forEach(function (S) {
        var side = S === 'L' ? 1 : -1;
        s['shoulder' + S].rotation.set(
          U.lerp(0, flap * 0.55, spread), 0, U.lerp(0, side * (0.50 + flap * 0.34), spread));
        s['wingUp' + S].rotation.set(0, U.lerp(0, side * 0.28, spread), U.lerp(0, flap * 0.26, spread));
        s['wingLo' + S].rotation.set(0, U.lerp(0, side * 0.40, spread), U.lerp(0, flap * 0.42, spread));
        s['wingTip' + S].rotation.set(0, U.lerp(0, side * 0.28, spread), U.lerp(0, flap * 0.34, spread));
      });
    } else {
      // 抓把：翼尖当手
      var upL = this.len.wingUp, loL = this.len.wingLo, tipL = this.len.wingTipLen;
      solveTwoBone(s['shoulderL'], s['wingUpL'], upL, loL + tipL,
        pose.barL, new THREE.Vector3(0.55, -0.75, 0.15));
      s['wingLoL'].rotation.set(0, -0.30, 0);
      s['wingTipL'].rotation.set(0, -0.16, 0);

      solveTwoBone(s['shoulderR'], s['wingUpR'], upL, loL + tipL,
        pose.barR, new THREE.Vector3(-0.55, -0.75, 0.15));
      s['wingLoR'].rotation.set(0, 0.30, 0);
      s['wingTipR'].rotation.set(0, 0.16, 0);
    }

    /* ---------- 腿：踩踏板 ---------- */
    var footExtra = this.len.footTip;
    var legL1 = this.len.thigh, legL2 = this.len.shin + 0.018;
    solveTwoBone(s['thighL'], s['shinL'], legL1, legL2, pose.pedalL,
      new THREE.Vector3(0.42, 0.10, 0.90));
    solveTwoBone(s['thighR'], s['shinR'], legL1, legL2, pose.pedalR,
      new THREE.Vector3(-0.42, 0.10, 0.90));
    // 脚掌贴合踏板：反向抵消大腿+小腿的俯仰
    ['footL', 'footR'].forEach(function (nm) {
      var th = s[nm === 'footL' ? 'thighL' : 'thighR'];
      var sh = s[nm === 'footL' ? 'shinL' : 'shinR'];
      s[nm].rotation.set(U.clamp(-th.rotation.x - sh.rotation.x, -0.8, 0.8) * 0.85, 0, 0);
    });

    /* ---------- 尾羽 ---------- */
    s['tail'].rotation.set(
      -0.08 + Math.sin(t * 3.0) * 0.05 * spdN,
      Math.sin(t * 2.2) * 0.10 * spdN, roll * 0.2);
    s['tailTip'].rotation.set(0.10, Math.sin(t * 2.6 + 0.7) * 0.12 * spdN, 0);
    u.tailFan.rotation.y = Math.sin(t * 2.0) * 0.08 * spdN;

    /* ---------- 眨眼 ---------- */
    this._blinkT -= dt;
    if (this._blinkT <= 0) { this.blink = 1; this._blinkT = U.lerp(1.8, 5.0, Math.random()); }
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt * 7.0);
    var lid = Math.sin(this.blink * Math.PI);
    var eyes = u.eyes.userData.eyes;
    for (var e = 0; e < eyes.length; e++) {
      var ey = eyes[e];
      ey.lidTop.rotation.x = -lid * 1.35;
      ey.lidBot.rotation.x = lid * 1.15;
      if (pose.lookAt) {
        ey.pupil.position.x = U.clamp(pose.lookAt.x * 0.006, -0.006, 0.006);
        ey.pupil.position.y = U.clamp(pose.lookAt.y * 0.005, -0.005, 0.005);
      }
    }

    /* ---------- 喉囊动态形变 ---------- */
    var pm = u.pouch.userData;
    var pa = pm.geo.attributes.position, pb = pm.base;
    var amp = 0.008 + spdN * 0.020 + Math.abs(bounce) * 0.016;
    for (var i = 0, c = pa.count; i < c; i++) {
      var i3 = i * 3;
      var bx = pb[i3], by = pb[i3 + 1], bz = pb[i3 + 2];
      var wgt = U.saturate(-by / 0.195);
      var ph = t * 4.2 + bx * 7 + bz * 4;
      pa.setXYZ(i,
        bx + Math.sin(ph) * amp * wgt * 0.55,
        by + Math.sin(ph * 1.3 + 1.1) * amp * wgt * 0.30,
        bz + Math.cos(ph * 0.9) * amp * wgt * 0.95);
    }
    pa.needsUpdate = true;
    pm.geo.computeVertexNormals();

    /* ---------- 下颌开合 ---------- */
    var jaw = U.saturate(spd / 11) * 0.09 + Math.abs(bounce) * 0.05;
    s['jaw'].rotation.x = jaw;
    var bd = u.beak.userData;
    bd.lower.position.y = -0.050 - jaw * 0.30;
    bd.lower2.position.y = -0.056 - jaw * 0.46;
    bd.lower.rotation.x = -0.10 - jaw * 1.0;
    bd.lower2.rotation.x = -0.15 - jaw * 1.4;

    /* ---------- 围巾飘动 ---------- */
    var sc = u.scarf.userData;
    var pts = sc.pts, SEG = sc.SEG;
    var strength = 0.20 + spdN * 1.45;
    for (var q2 = 0; q2 <= SEG; q2++) {
      var uu = q2 / SEG;
      var p = pts[q2];
      p.set(
        Math.cos(t * 3.7 - uu * 4.2) * 0.040 * uu * strength,
        Math.sin(t * 5.2 - uu * 6.0) * 0.052 * uu * strength + Math.sin(uu * 3.0) * 0.026 - uu * uu * 0.075 * strength,
        -q2 * 0.042 - uu * uu * 0.16 * strength);
    }
    sc.ribbon.update(pts);
    sc.geo.attributes.position.needsUpdate = true;
    sc.geo.attributes.normal.needsUpdate = true;
    sc.geo.computeBoundingSphere();
  };

  PB.Pelican = Pelican;
})();
