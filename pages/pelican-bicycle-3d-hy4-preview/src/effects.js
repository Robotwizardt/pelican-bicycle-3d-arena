/* =====================================================================
 * effects.js — 粒子系统 / 体积光 / 软阴影 / 贴花 / 萤火虫 / 星空
 *
 * 1. FXSystem：通用 GPU 粒子池（单个 BufferGeometry + Points，CPU 更新）
 *              支持：沙尘、水花、羽毛、爆米花状溅射、萤火虫、火花
 * 2. Volumetric：太阳 god-ray（径向模糊的后处理近似，用叠加片做）
 * 3. SoftShadow：混合方案 —— shadowMap 提供接触阴影，另加一个
 *    「贴地投影贴片」保证快速移动时阴影不丢
 * 4. Decal：自行车轮胎在沙地上的滚动痕迹（CanvasTexture 增量绘制）
 * 5. Ripples：海面交互涟漪（鼠标点击 / 骑行经过水洼）
 * ===================================================================*/
(function () {
  'use strict';
  var PB = window.PB, U = PB.U;

  /* ===================================================================
   * 通用粒子系统
   * ================================================================= */
  function ParticlePool(max, opts) {
    opts = opts || {};
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.kind = new Uint8Array(max);      // 0 点精灵 1 拉伸条
    this.cursor = 0;

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;

    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: 1 },
        uMap: { value: opts.map || null },
        uHasMap: { value: opts.map ? 1 : 0 },
        uScale: { value: opts.scale || 340 }
      },
      vertexShader: [
        'attribute vec3 aColor; attribute float aSize; attribute float aAlpha;',
        'uniform float uPixelRatio; uniform float uScale;',
        'varying vec3 vColor; varying float vAlpha;',
        'void main(){',
        '  vColor = aColor; vAlpha = aAlpha;',
        '  vec4 mv = modelViewMatrix * vec4(position,1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  gl_PointSize = aSize * uScale * uPixelRatio / max(0.001,-mv.z);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D uMap;',
        'uniform float uHasMap;',
        'varying vec3 vColor; varying float vAlpha;',
        'void main(){',
        '  vec2 uv = gl_PointCoord;',
        '  float m = 1.0;',
        '  if(uHasMap > 0.5){ m = texture2D(uMap, uv).a; } else {',
        '    vec2 d = uv - 0.5;',
        '    m = smoothstep(0.5, 0.05, length(d));',
        '  }',
        '  float a = vAlpha * m;',
        '  if(a < 0.01) discard;',
        '  gl_FragColor = vec4(vColor * m, a);',
        '}'
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.mat = mat;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  ParticlePool.prototype.spawn = function (o) {
    var i = this.cursor;
    // 找一个空闲槽（简单环形复用）
    for (var tries = 0; tries < this.max; tries++) {
      if (this.life[(this.cursor + tries) % this.max] <= 0) {
        i = (this.cursor + tries) % this.max; break;
      }
      i = (this.cursor + tries) % this.max;
    }
    this.cursor = (i + 1) % this.max;

    var i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
    this.col[i3] = o.r; this.col[i3 + 1] = o.g; this.col[i3 + 2] = o.b;
    this.size[i] = o.size || 0.05;
    this.alpha[i] = o.alpha == null ? 1 : o.alpha;
    this.life[i] = this.maxLife[i] = o.life || 1;
    this.drag[i] = o.drag == null ? 0.6 : o.drag;
    this.grav[i] = o.grav == null ? -9.8 : o.grav;
    this.kind[i] = o.kind || 0;
    if (i + 1 > this.count) this.count = i + 1;
    return i;
  };

  ParticlePool.prototype.update = function (dt, opts) {
    opts = opts || {};
    var wind = opts.wind;
    var alive = 0, maxIdx = 0;
    for (var i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      var i3 = i * 3;
      var d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= d; this.vel[i3 + 1] *= d; this.vel[i3 + 2] *= d;
      this.vel[i3 + 1] += this.grav[i] * dt;
      if (wind) {
        this.vel[i3] += wind.x * dt;
        this.vel[i3 + 1] += wind.y * dt;
        this.vel[i3 + 2] += wind.z * dt;
      }
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      var t = this.life[i] / this.maxLife[i];
      // 淡入淡出
      this.alpha[i] = U.smoothstep(0, 0.15, t) * U.smoothstep(0, 0.35, 1 - t) * 1.0;
      alive++;
      if (i + 1 > maxIdx) maxIdx = i + 1;
    }
    this.count = maxIdx;
    this.geo.setDrawRange(0, this.count);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    return alive;
  };

  /* ===================================================================
   * 贴地软阴影贴片（跟随鹈鹕+自行车）
   * ================================================================= */
  function BlobShadow(M, size) {
    var geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    var mat = new THREE.MeshBasicMaterial({
      map: PB.Tex.shadowBlob(128),
      transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.NormalBlending
    });
    var m = new THREE.Mesh(geo, mat);
    m.renderOrder = 3;
    m.frustumCulled = false;
    this.mesh = m;
    this.mat = mat;
  }
  BlobShadow.prototype.place = function (x, y, z, scale, opacity) {
    this.mesh.position.set(x, y + 0.012, z);
    this.mesh.scale.setScalar(scale);
    this.mat.opacity = opacity;
  };

  /* ===================================================================
   * 车轮痕迹（Decal）：在沙地贴图上增量绘制暗色轨迹
   * ================================================================= */
  function TrailDecal(worldSize, resolution, terrainSize) {
    resolution = resolution || 1024;
    this.res = resolution;
    this.terrainSize = terrainSize || 150;
    var c = document.createElement('canvas');
    c.width = c.height = resolution;
    this.canvas = c;
    this.ctx = c.getContext('2d');
    this.ctx.clearRect(0, 0, resolution, resolution);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    this.texture = t;

    var geo = new THREE.PlaneGeometry(terrainSize, terrainSize, 1, 1);
    geo.rotateX(-Math.PI / 2);
    var mat = new THREE.MeshBasicMaterial({
      map: t, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.NormalBlending
    });
    var m = new THREE.Mesh(geo, mat);
    m.renderOrder = 2;
    m.frustumCulled = false;
    this.mesh = m;
    this._last = {};
  }

  /** 在世界坐标 (x,z) 处画一个轮胎印 */
  TrailDecal.prototype.stamp = function (x, z, width, strength, angle) {
    var px = (x / this.terrainSize + 0.5) * this.res;
    var py = (z / this.terrainSize + 0.5) * this.res;
    var r = width / this.terrainSize * this.res;
    var ctx = this.ctx;
    ctx.save();
    ctx.translate(px, py);
    if (angle) ctx.rotate(angle);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(90,72,50,' + strength + ')');
    g.addColorStop(1, 'rgba(90,72,50,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    this._dirty = true;
  };

  /** 每帧最多上传一次贴图，避免频繁 GPU 上传 */
  TrailDecal.prototype.flush = function () {
    if (!this._dirty) return;
    this.texture.needsUpdate = true;
    this._dirty = false;
  };
  TrailDecal.prototype.clear = function () {
    this.ctx.clearRect(0, 0, this.res, this.res);
    this.texture.needsUpdate = true;
  };

  /* ===================================================================
   * 体积光 / 光轴：一层跟随太阳位置的加性光晕片 + 屏幕空间径向模糊条
   * 这里用一个「面向相机的大四边形」叠加 god-ray 纹理，成本低且稳定
   * ================================================================= */
  function SunShafts(M) {
    var g = new THREE.Group();
    // 中心大光晕
    var glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: PB.Tex.radialGlow(256, 0.95, 0.28),
        transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending
      }));
    glow.renderOrder = 4;
    g.add(glow);

    // 光轴：一圈细长条，从太阳向外发散
    var rays = new THREE.Group();
    var N = 22;
    for (var i = 0; i < N; i++) {
      var a = i / N * Math.PI * 2;
      var len = 0.9 + Math.random() * 1.4;
      var w = 0.012 + Math.random() * 0.05;
      var geo = new THREE.PlaneGeometry(w, len);
      geo.translate(0, len * 0.5, 0);
      var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: PB.Tex.radialGlow(64, 0.6, 0.18),
        transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, opacity: 0.5
      }));
      m.rotation.z = a;
      m.renderOrder = 4;
      rays.add(m);
    }
    g.add(rays);
    g.renderOrder = 4;
    g.frustumCulled = false;

    this.group = g;
    this.glow = glow;
    this.rays = rays;
    this.visible = true;
  }
  SunShafts.prototype.update = function (camera, sunWorldPos, intensity, t) {
    var g = this.group;
    g.visible = intensity > 0.01;
    if (!g.visible) return;
    // 放在相机前方固定距离，始终面向相机
    var dir = new THREE.Vector3().subVectors(sunWorldPos, camera.position).normalize();
    var dist = 40;
    g.position.copy(camera.position).addScaledVector(dir, dist);
    g.quaternion.copy(camera.quaternion);
    var s = dist * 0.55;
    this.glow.scale.set(s, s, 1);
    this.glow.material.opacity = intensity * 0.85;
    for (var i = 0; i < this.rays.children.length; i++) {
      var m = this.rays.children[i];
      m.material.opacity = intensity * (0.22 + 0.18 * Math.sin(t * 0.6 + i * 1.7));
    }
    this.rays.rotation.z = t * 0.012;
  };

  /* ===================================================================
   * 萤火虫（夜间）：在小岛植被间游荡的加性光点
   * ================================================================= */
  function Fireflies(M, count, radius) {
    var pool = new ParticlePool(count, { additive: true, scale: 420 });
    this.pool = pool;
    this.radius = radius || 40;
    this.rnd = U.rng(4242);
    this.data = [];
    for (var i = 0; i < count; i++) {
      var a = this.rnd() * U.TAU;
      var r = Math.sqrt(this.rnd()) * this.radius;
      this.data.push({
        x: Math.cos(a) * r, z: Math.sin(a) * r,
        y: this.rnd.range(0.4, 3.2),
        ph: this.rnd() * 10, sp: this.rnd.range(0.2, 0.7),
        blinkPh: this.rnd() * 10, blinkSp: this.rnd.range(1.2, 3.4)
      });
    }
    this.active = false;
  }
  Fireflies.prototype.update = function (t, dt, nightAmt, heightAt) {
    var act = nightAmt > 0.15;
    if (act !== this.active) {
      this.active = act;
      this.pool.points.visible = act;
    }
    if (!act) return;
    var p = this.pool;
    // 用固定槽位（避免 spawn 搜索开销）
    for (var i = 0; i < this.data.length; i++) {
      var d = this.data[i];
      var i3 = i * 3;
      var wx = d.x + Math.sin(t * d.sp + d.ph) * 1.7;
      var wz = d.z + Math.cos(t * d.sp * 0.8 + d.ph * 1.3) * 1.7;
      var wy = d.y + Math.sin(t * d.sp * 1.4 + d.ph * 0.7) * 0.35;
      p.pos[i3] = wx; p.pos[i3 + 1] = wy; p.pos[i3 + 2] = wz;
      p.col[i3] = 1.0; p.col[i3 + 1] = 0.86; p.col[i3 + 2] = 0.48;
      p.size[i] = 0.055;
      var blink = 0.5 + 0.5 * Math.sin(t * d.blinkSp + d.blinkPh);
      p.alpha[i] = Math.pow(blink, 3) * nightAmt;
      p.life[i] = 1; p.maxLife[i] = 1;
    }
    p.count = this.data.length;
    p.geo.setDrawRange(0, p.count);
    p.geo.attributes.position.needsUpdate = true;
    p.geo.attributes.aColor.needsUpdate = true;
    p.geo.attributes.aSize.needsUpdate = true;
    p.geo.attributes.aAlpha.needsUpdate = true;
  };

  /* ===================================================================
   * 星空（夜间）：天球上分布的加性点
   * ================================================================= */
  function StarField(count, radius) {
    var pos = new Float32Array(count * 3);
    var col = new Float32Array(count * 3);
    var size = new Float32Array(count);
    var alpha = new Float32Array(count);
    var rnd = U.rng(31337);
    for (var i = 0; i < count; i++) {
      // 半球均匀分布（偏上）
      var u = rnd() * 2 - 1;
      var th = rnd() * U.TAU;
      var r = Math.sqrt(1 - u * u);
      var x = r * Math.cos(th), y = Math.abs(u) * 0.96 + 0.02, z = r * Math.sin(th);
      pos[i * 3] = x * radius; pos[i * 3 + 1] = y * radius; pos[i * 3 + 2] = z * radius;
      var warm = rnd();
      col[i * 3] = U.lerp(0.72, 1.0, warm);
      col[i * 3 + 1] = U.lerp(0.82, 0.97, warm);
      col[i * 3 + 2] = U.lerp(1.0, 0.88, warm);
      size[i] = rnd.range(0.9, 3.4);
      alpha[i] = rnd.range(0.35, 1.0);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    var mat = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 }, uOpacity: { value: 0 } },
      vertexShader: [
        'attribute vec3 aColor; attribute float aSize; attribute float aAlpha;',
        'uniform float uPixelRatio;',
        'varying vec3 vColor; varying float vAlpha;',
        'void main(){',
        '  vColor=aColor; vAlpha=aAlpha;',
        '  vec4 mv = modelViewMatrix * vec4(position,1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  gl_PointSize = aSize * uPixelRatio;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uOpacity;',
        'varying vec3 vColor; varying float vAlpha;',
        'void main(){',
        '  vec2 d = gl_PointCoord - 0.5;',
        '  float m = smoothstep(0.5, 0.02, length(d));',
        '  gl_FragColor = vec4(vColor, m * vAlpha * uOpacity);',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = -900;
    this.points = pts;
    this.mat = mat;
  }
  StarField.prototype.update = function (nightAmt, camera, t) {
    this.mat.uniforms.uOpacity.value = U.smoothstep(0.05, 0.55, nightAmt);
    this.points.position.copy(camera.position);
    this.points.rotation.y = t * 0.004;   // 极缓慢的周日运动
  };

  /* ===================================================================
   * 波纹（水面交互）
   * ================================================================= */
  function Ripples(max) {
    this.pool = new ParticlePool(max, { additive: false, scale: 300 });
    this.pool.mat.uniforms.uMap.value = PB.Tex.foam(128);
    this.pool.mat.uniforms.uHasMap.value = 1;
    this.pool.points.renderOrder = 5;
  }
  Ripples.prototype.add = function (x, y, z, strength) {
    var n = Math.round(6 + strength * 10);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * U.TAU;
      var s = 0.25 + Math.random() * 0.9 * strength;
      this.pool.spawn({
        x: x, y: y + 0.03, z: z,
        vx: Math.cos(a) * s, vy: 0.15 + Math.random() * 0.4, vz: Math.sin(a) * s,
        r: 1.0, g: 1.0, b: 1.0,
        size: 0.06 + Math.random() * 0.10,
        alpha: 0.9, life: 0.5 + Math.random() * 0.6,
        drag: 2.2, grav: -1.2
      });
    }
  };
  Ripples.prototype.update = function (dt) { this.pool.update(dt); };

  /* ===================================================================
   * 统一的 FX 管理器
   * ================================================================= */
  function FX(scene, M) {
    this.scene = scene;
    this.M = M;

    var dust = new ParticlePool(1200, { additive: false, scale: 300 });
    dust.points.renderOrder = 5;
    scene.add(dust.points);
    this.dust = dust;

    var spray = new ParticlePool(900, { additive: true, scale: 320 });
    spray.points.renderOrder = 5;
    scene.add(spray.points);
    this.spray = spray;

    var feathers = new ParticlePool(220, { additive: false, scale: 340 });
    feathers.pool = feathers;
    feathers.points.renderOrder = 6;
    scene.add(feathers.points);
    this.feathers = feathers;

    var sparks = new ParticlePool(400, { additive: true, scale: 380 });
    sparks.points.renderOrder = 6;
    scene.add(sparks.points);
    this.sparks = sparks;

    var fireflies = new Fireflies(M, 150, 34);
    scene.add(fireflies.pool.points);
    fireflies.pool.points.visible = false;
    this.fireflies = fireflies;

    var stars = new StarField(1400, 320);
    scene.add(stars.points);
    this.stars = stars;

    var shafts = new SunShafts(M);
    scene.add(shafts.group);
    this.shafts = shafts;

    var ripples = new Ripples(600);
    scene.add(ripples.pool.points);
    this.ripples = ripples;

    var blob = new BlobShadow(M, 3.2);
    scene.add(blob.mesh);
    this.blob = blob;

    var trail = new TrailDecal(150, 1024, 150);
    scene.add(trail.mesh);
    this.trail = trail;

    this.wind = new THREE.Vector3(1.6, 0.1, -0.4);
  }

  /** 车轮扬沙 */
  FX.prototype.wheelDust = function (x, y, z, vx, vz, speed, dt, rate) {
    rate = rate == null ? 1 : rate;
    var n = Math.min(6, Math.floor(speed * 2.2 * rate * dt * 60));
    if (n <= 0) return;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * U.TAU;
      var s = 0.25 + Math.random() * 0.85;
      this.dust.spawn({
        x: x + (Math.random() - 0.5) * 0.14,
        y: y + 0.02,
        z: z + (Math.random() - 0.5) * 0.14,
        vx: vx * 0.22 + Math.cos(a) * s,
        vy: 0.35 + Math.random() * 0.85,
        vz: vz * 0.22 + Math.sin(a) * s,
        r: 0.80, g: 0.72, b: 0.56,
        size: 0.045 + Math.random() * 0.075,
        alpha: 0.55, life: 0.7 + Math.random() * 0.9,
        drag: 1.5, grav: -1.6
      });
    }
  };

  /** 溅水（过水洼 / 冲进海里） */
  FX.prototype.splash = function (x, y, z, strength, dir) {
    var n = Math.round(10 + strength * 26);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * U.TAU;
      var s = (0.6 + Math.random() * 2.2) * strength;
      this.spray.spawn({
        x: x, y: y + 0.02, z: z,
        vx: Math.cos(a) * s + (dir ? dir.x * 0.7 : 0),
        vy: 1.1 + Math.random() * 2.4 * strength,
        vz: Math.sin(a) * s + (dir ? dir.z * 0.7 : 0),
        r: 0.86, g: 0.95, b: 1.0,
        size: 0.035 + Math.random() * 0.07,
        alpha: 0.8, life: 0.4 + Math.random() * 0.55,
        drag: 0.9, grav: -7.5
      });
    }
    this.ripples.add(x, y, z, strength);
  };

  /** 掉羽毛 */
  FX.prototype.dropFeather = function (x, y, z) {
    var warm = Math.random();
    this.feathers.spawn({
      x: x, y: y, z: z,
      vx: (Math.random() - 0.5) * 0.7,
      vy: 0.4 + Math.random() * 0.5,
      vz: (Math.random() - 0.5) * 0.7,
      r: U.lerp(0.88, 0.98, warm), g: U.lerp(0.92, 0.99, warm), b: U.lerp(0.98, 1.0, warm),
      size: 0.10 + Math.random() * 0.07,
      alpha: 0.95, life: 2.6 + Math.random() * 1.6,
      drag: 1.9, grav: -0.55
    });
  };

  /** 庆祝火花（冲线 / 撒花） */
  FX.prototype.confetti = function (x, y, z, n) {
    n = n || 80;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * U.TAU;
      var s = 1.2 + Math.random() * 3.4;
      var hue = Math.random();
      var c = new THREE.Color().setHSL(hue, 0.75, 0.62);
      this.sparks.spawn({
        x: x, y: y + 0.3, z: z,
        vx: Math.cos(a) * s, vy: 2.4 + Math.random() * 3.6, vz: Math.sin(a) * s,
        r: c.r, g: c.g, b: c.b,
        size: 0.07 + Math.random() * 0.06,
        alpha: 1.0, life: 1.4 + Math.random() * 1.4,
        drag: 0.5, grav: -4.2
      });
    }
  };

  /** 刹车 / 漂移的轮胎烟 */
  FX.prototype.tireSmoke = function (x, y, z, vx, vz, amount) {
    var n = Math.round(amount * 4);
    for (var i = 0; i < n; i++) {
      this.dust.spawn({
        x: x + (Math.random() - 0.5) * 0.2, y: y + 0.03, z: z + (Math.random() - 0.5) * 0.2,
        vx: vx * 0.1 + (Math.random() - 0.5) * 0.5,
        vy: 0.5 + Math.random() * 0.9,
        vz: vz * 0.1 + (Math.random() - 0.5) * 0.5,
        r: 0.72, g: 0.68, b: 0.62,
        size: 0.10 + Math.random() * 0.14,
        alpha: 0.35, life: 1.0 + Math.random() * 1.0,
        drag: 1.2, grav: -0.3
      });
    }
  };

  FX.prototype.update = function (dt, t, nightAmt, camera, sunWorld, heightAt) {
    var w = this.wind;
    this.dust.update(dt, { wind: w });
    this.spray.update(dt, { wind: new THREE.Vector3(0, 0, 0) });
    this.feathers.update(dt, { wind: w });
    this.sparks.update(dt, { wind: w });
    this.ripples.update(dt);
    this.fireflies.update(t, dt, nightAmt, heightAt);
    this.stars.update(nightAmt, camera, t);
    // 体积光：只在太阳接近地平线时明显
    var sunEl = sunWorld.clone().normalize().y;
    var shaftI = U.smoothstep(0.42, 0.02, Math.abs(sunEl)) * U.smoothstep(-0.16, 0.02, sunEl);
    this.shafts.update(camera, sunWorld, shaftI, t);
    this.trail.flush();
  };

  FX.prototype.setPixelRatio = function (pr) {
    [this.dust, this.spray, this.feathers, this.sparks, this.ripples.pool, this.fireflies.pool]
      .forEach(function (p) { p.mat.uniforms.uPixelRatio.value = pr; });
    this.stars.mat.uniforms.uPixelRatio.value = pr;
  };

  PB.FX = FX;
  PB.ParticlePool = ParticlePool;
})();
