/* =====================================================================
 * main.js — 装配 / 运镜 / 交互 / UI / 主循环
 *
 *  局部坐标约定：自行车与鹈鹕都是 +Z 前、+Y 上、+X 右。
 *  鹈鹕是一个独立的 Group（静止姿态下髋部在 y=0.86），每帧用 IK 把
 *  双手（翼尖）、双脚（脚掌）钉到车把与脚踏上，髋部钉到车座上。
 * ===================================================================*/
(function () {
  'use strict';
  var U = PB.U, clamp = U.clamp, lerp = U.lerp, damp = U.damp, sat = U.saturate;
  var PI = Math.PI, TAU = PI * 2;
  var V3 = THREE.Vector3;

  /* ==================================================================
   * 赛道运输（弧长参数化 + 坡度 / 侧倾 / 侧移）
   * ================================================================*/
  function Transport(curve, table) {
    this.curve = curve; this.table = table;
    this.s = 0;                 // 弧长
    this.speed = 5.0;           // m/s
    this.crankAngle = 0;
    this.travelled = 0;
    this.lateral = 0;           // 侧向偏移（米）
    this.lean = 0;              // 侧倾（rad）
    this.pitch = 0;             // 俯仰（rad）
    this.yaw = 0;               // 朝向
    this.upSlope = 0;
    this.yawRate = 0;
    this.groundY = 0;
    this.airY = 0;              // 腾空额外高度
    this.airV = 0;
    this.onGround = true;

    this.pos = new V3();
    this.fwd = new V3(0, 0, 1);
    this.right = new V3(1, 0, 0);
    this.up = new V3(0, 1, 0);
    this._p = new V3(); this._p2 = new V3(); this._t = new V3(); this._t2 = new V3();
    this._m = new THREE.Matrix4();
  }

  Transport.prototype.update = function (dt, ctrl) {
    // ---- 纵向 ----
    var target = ctrl.throttle * ctrl.maxSpeed;
    var rate = target > this.speed ? ctrl.accel : ctrl.decel;
    if (ctrl.brake) rate = ctrl.decel * 2.2;
    this.speed = damp(this.speed, target, rate, dt);
    if (Math.abs(this.speed) < 1e-4) this.speed = 0;

    var ds = this.speed * dt;
    this.s = U.wrap(this.s + ds, this.table.total);
    this.travelled += Math.abs(ds);

    // 传动比 44/18：曲柄角速度 = 轮角速度 * ratio
    var ratio = 0.42;
    this.crankAngle = U.wrap(this.crankAngle + ds / 0.35 * ratio, TAU);

    // ---- 侧向 ----
    this.lateral = damp(this.lateral, ctrl.steer * 1.8, 5.0, dt);

    // ---- 采样中心线 ----
    var tA = U.sToT(this.table, this.s);
    this.curve.getPointAt(tA, this._p);
    this.curve.getTangentAt(tA, this._t);
    this._t.y = 0; this._t.normalize();

    this.right.set(this._t.z, 0, -this._t.x);   // 右手系：right = up × fwd
    this.pos.copy(this._p).addScaledVector(this.right, this.lateral);

    // ---- 坡度 ----
    var tB = U.sToT(this.table, this.s + 1.2);
    this.curve.getPointAt(tB, this._p2);
    this._p2.addScaledVector(this.right, this.lateral);
    var hA = this.heightAt(this.pos.x, this.pos.z);
    var hB = this.heightAt(this._p2.x, this._p2.z);
    this.upSlope = (hB - hA) / 1.2;
    this.groundY = hA;

    // ---- 朝向 ----
    this.fwd.copy(this._t);
    this.yaw = Math.atan2(this.fwd.x, this.fwd.z);
    this.pitch = -Math.atan(this.upSlope);

    // ---- 过弯侧倾 ----
    this.curve.getTangentAt(U.sToT(this.table, this.s + 3.0), this._t2);
    this._t2.y = 0; this._t2.normalize();
    var cross = this.fwd.x * this._t2.z - this.fwd.z * this._t2.x;
    this.yawRate = cross / 3.0;
    var leanTarget = clamp(-this.yawRate * this.speed * 1.6 - ctrl.steer * 0.10, -0.30, 0.30);
    this.lean = damp(this.lean, leanTarget, 4.5, dt);

    // ---- 腾空（小跳台：赛道上的正弦起伏把车弹起来） ----
    var bump = Math.sin(this.s * 1.7) * 0.10 + Math.sin(this.s * 0.63 + 1.1) * 0.06;
    var lift = bump * sat(this.speed / 6) * 0.9;
    if (this.speed > 4.2) {
      if (this.onGround && lift > 0.02) { this.airV = lift * 9.0; this.onGround = false; }
    }
    if (!this.onGround) {
      this.airV -= 16.0 * dt;
      this.airY += this.airV * dt;
      if (this.airY <= 0) { this.airY = 0; this.airV = 0; this.onGround = true; this.justLanded = clamp(-this.airV / 8, 0, 1); }
    } else this.airY = damp(this.airY, 0, 8, dt);

    this.pos.y = this.groundY + this.airY;
    this.up.set(0, 1, 0).applyAxisAngle(this.fwd, this.lean).normalize();
  };

  Transport.prototype.heightAt = function (x, z) { return PB.World.heightAt(x, z); };

  PB.Transport = Transport;

  /* ==================================================================
   * 相机导演
   * ================================================================*/
  var CAM_MODES = ['trailing', 'orbit', 'chase', 'low', 'bird', 'cockpit', 'free'];
  var CAM_LABEL = {
    trailing: '跟拍', orbit: '环绕', chase: '贴地追', low: '低机位',
    bird: '俯瞰', cockpit: '第一视角', free: '自由'
  };

  function CameraRig(camera) {
    this.cam = camera;
    this.mode = 'trailing';
    this.pos = new V3(6, 3, 6);
    this.look = new V3();
    this.shake = 0;
    this.fov = 46;
    this.freeYaw = 0; this.freePitch = -0.18; this.freeDist = 7;
    this.orbitA = 0;
    this.dragging = false;
  }

  CameraRig.prototype.apply = function (dt, T, opt) {
    var c = this.cam;
    var rigPos = T.pos, fwd = T.fwd, right = T.right;
    var spdN = sat(Math.abs(T.speed) / 10);
    var mode = this.mode;
    var want = new V3(), lookAt = new V3();
    var fov = 46;

    lookAt.copy(rigPos).addScaledVector(fwd, 0.4);
    lookAt.y += 1.15;

    if (mode === 'trailing') {
      want.copy(rigPos)
        .addScaledVector(fwd, -5.2 - spdN * 1.6)
        .addScaledVector(right, 1.1 + T.lean * 2.2);
      want.y += 2.35;
      fov = 46 + spdN * 10;
    } else if (mode === 'orbit') {
      this.orbitA += dt * 0.28;
      var r = 6.6;
      want.set(rigPos.x + Math.cos(this.orbitA) * r, rigPos.y + 2.6, rigPos.z + Math.sin(this.orbitA) * r);
      fov = 44;
    } else if (mode === 'chase') {
      want.copy(rigPos).addScaledVector(fwd, -2.4).addScaledVector(right, T.lean * 1.4);
      want.y += 1.35;
      fov = 52 + spdN * 12;
    } else if (mode === 'low') {
      want.copy(rigPos).addScaledVector(fwd, -3.4).addScaledVector(right, 0.9);
      want.y += 0.42;
      lookAt.y -= 0.35;
      fov = 58;
    } else if (mode === 'bird') {
      want.copy(rigPos).addScaledVector(fwd, -1.0);
      want.y += 13.5;
      lookAt.copy(rigPos); lookAt.y += 0.6;
      fov = 42;
    } else if (mode === 'cockpit') {
      // 骑手视角：从头部往前看
      want.copy(rigPos).addScaledVector(fwd, 0.10);
      want.y += 2.02;
      lookAt.copy(rigPos).addScaledVector(fwd, 8).setY(rigPos.y + 1.95 + T.pitch * 6);
      fov = 62;
    } else { // free
      want.set(
        rigPos.x + Math.sin(this.freeYaw) * Math.cos(this.freePitch) * this.freeDist,
        rigPos.y + 1.2 - Math.sin(this.freePitch) * this.freeDist,
        rigPos.z + Math.cos(this.freeYaw) * Math.cos(this.freePitch) * this.freeDist);
      fov = 50;
    }

    // 防止穿地
    var gy = PB.World.heightAt(want.x, want.z);
    if (want.y < gy + 0.35) want.y = gy + 0.35;

    var lag = (mode === 'cockpit') ? 30 : (mode === 'chase' ? 9 : 4.2);
    if (mode === 'orbit' || mode === 'bird') lag = 6;
    this.pos.x = damp(this.pos.x, want.x, lag, dt);
    this.pos.y = damp(this.pos.y, want.y, lag, dt);
    this.pos.z = damp(this.pos.z, want.z, lag, dt);
    this.look.x = damp(this.look.x, lookAt.x, lag * 1.3, dt);
    this.look.y = damp(this.look.y, lookAt.y, lag * 1.3, dt);
    this.look.z = damp(this.look.z, lookAt.z, lag * 1.3, dt);

    // 颠簸抖动
    var rough = T.onGround ? 1 : 0.25;
    var jitter = spdN * 0.020 * rough + T.airY * 0.02 + this.shake;
    c.position.set(
      this.pos.x + (Math.random() - 0.5) * jitter,
      this.pos.y + (Math.random() - 0.5) * jitter,
      this.pos.z + (Math.random() - 0.5) * jitter);
    c.lookAt(this.look);
    // 侧倾一点点，增加速度感
    c.rotateZ(T.lean * 0.35 + (Math.random() - 0.5) * jitter * 0.3);
    this.shake = damp(this.shake, 0, 6, dt);

    this.fov = damp(this.fov, fov, 5, dt);
    if (Math.abs(c.fov - this.fov) > 0.01) { c.fov = this.fov; c.updateProjectionMatrix(); }
  };

  PB.CameraRig = CameraRig;
  PB.CAM_MODES = CAM_MODES;
  PB.CAM_LABEL = CAM_LABEL;

  /* ==================================================================
   * 主应用
   * ================================================================*/
  function App(opts) {
    opts = opts || {};
    this.P = {
      // 运动
      throttle: 1.0, steer: 0.0, maxSpeed: 9.0, autoSteer: 1,
      // 骑手
      bounce: 1.0, lean: 0.30, crouch: 0.25,
      // 翅膀
      wingSpread: 0.0, wingFlap: 0.0,
      // 世界
      timeOfDay: 8.4, daySpeed: 0.0,
      // 渲染
      exposure: 1.0, bloom: 0.55, contrast: 0.10, saturation: 1.06,
      temperature: 0.05, vignette: 0.42, grain: 0.045,
      chroma: 0.0022, sharpen: 0.18, distort: 0.018, tonemap: 0
    };
    this.state = {
      paused: false, autoRide: true, audioOn: false,
      camMode: 'trailing', showUI: true, night: 0
    };
    this.t = 0;
    this.fpsSmooth = 60;
    this.aimPoint = new V3();
    this.nightAmt = 0;
  }

  App.prototype.boot = function () {
    var self = this;
    var P = this.P;

    // ---------- renderer ----------
    var host = document.getElementById('stage');
    var renderer = this.renderer = new THREE.WebGLRenderer({
      antialias: false, alpha: false, stencil: false,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;   // 交给 PostFX
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    renderer.domElement.id = 'gl';

    var scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xd7dee8, 0.0034);

    var camera = this.camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.08, 1400);
    camera.position.set(6, 3, 6);

    // ---------- 材质 / 天空 / 世界 ----------
    var M = this.M = PB.Mat.build({});
    var sky = this.sky = new PB.Sky(scene, renderer, { size: 256 });
    var world = this.world = new PB.World(scene, M, {});

    // ---------- 灯光 ----------
    var sun = this.sun = new THREE.DirectionalLight(0xfff0d8, 3.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 90;
    var sd = 12;
    sun.shadow.camera.left = -sd; sun.shadow.camera.right = sd;
    sun.shadow.camera.top = sd; sun.shadow.camera.bottom = -sd;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);

    var hemi = this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0xc8a878, 0.6);
    scene.add(hemi);
    var fill = this.fill = new THREE.DirectionalLight(0x9ab4ff, 0.3);
    fill.position.set(-6, 8, -4);
    scene.add(fill);

    // ---------- 车 + 鹈鹕 ----------
    var rig = this.rig = new THREE.Group();
    scene.add(rig);
    var bike = this.bike = new PB.Bicycle(M);
    rig.add(bike.root);
    bike.root.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    var pelican = this.pelican = new PB.Pelican(M);
    this.pelicanRoot = new THREE.Group();
    this.pelicanRoot.add(pelican.group);
    rig.add(this.pelicanRoot);

    // ---------- 特效 / 后处理 ----------
    var fx = this.fx = new PB.FX(scene, M);
    fx.setPixelRatio(renderer.getPixelRatio());
    var post = this.post = new PB.PostFX(renderer, { samples: 4 });
    post.setSize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());

    // ---------- 运输 / 相机 ----------
    this.transport = new Transport(world.track.curve, world.track.table);
    this.camRig = new CameraRig(camera);

    // ---------- 音频 ----------
    this.audio = new PB.Audio();

    // ---------- 绑定 ----------
    this.bindKeys();
    this.bindPointer(renderer.domElement);
    this.buildUI();
    this.onResize();
    window.addEventListener('resize', function () { self.onResize(); });

    this.updateSky(0, true);

    // 预热一帧，避免首帧闪烁
    this.step(0.016);

    var lo = document.getElementById('loading');
    if (lo) { lo.style.opacity = '0'; setTimeout(function () { lo.style.display = 'none'; }, 600); }

    this.last = -1;   // 首帧由 rAF 时间戳初始化，避免 dt 为负
    var loop = function (now) {
      requestAnimationFrame(loop);
      if (self.last < 0) self.last = now;
      // rAF 的时间戳是帧起始时刻，可能早于上次记录的 performance.now()，
      // 所以 dt 必须双向夹紧：负 dt 会让 damp() 的 1-exp(-rate*dt) 爆炸。
      var dt = Math.min(0.05, Math.max(0, (now - self.last) / 1000));
      self.last = now;
      self.step(dt);
    };
    requestAnimationFrame(loop);
  };

  /* ---------------- 昼夜 ---------------- */
  App.prototype.updateSky = function (dt, force) {
    var P = this.P;
    var h = P.timeOfDay;
    var ang = (h / 24) * TAU - PI * 0.5;
    var sd = this._sunDir || (this._sunDir = new V3());
    var az = 0.55;
    sd.set(Math.cos(ang) * Math.cos(az), Math.sin(ang), Math.cos(ang) * Math.sin(az)).normalize();
    if (sd.y < -0.20) sd.y = -0.20 + (sd.y + 0.20) * 0.3;
    sd.normalize();

    var md = this._moonDir || (this._moonDir = new V3());
    md.set(-sd.x * 0.6, -sd.y, -sd.z * 0.6).normalize();

    this.sky.setSun(sd);
    this.sky.setMoon(md);
    if (force) this.sky.bake(); else this.sky.bakeIfNeeded();

    var night = this.nightAmt = U.smoothstep(0.10, -0.14, sd.y);
    var day = 1 - night;
    this.state.night = night;

    this.sunDir = sd;
    this.sun.position.copy(this.aimPoint).addScaledVector(sd, 55);
    this.sun.target.position.copy(this.aimPoint);
    this.sun.target.updateMatrixWorld();
    this.sun.intensity = lerp(0.05, 3.2, Math.pow(day, 0.8));
    this.sun.color.setRGB(
      lerp(0.62, 1.0, Math.pow(day, 0.5)),
      lerp(0.74, 0.96, Math.pow(day, 0.8)),
      lerp(1.0, 0.88, Math.pow(day, 1.6)));
    this.hemi.intensity = lerp(0.10, 0.62, day);
    this.hemi.color.setRGB(lerp(0.16, 0.74, day), lerp(0.22, 0.85, day), lerp(0.36, 1.0, day));
    this.hemi.groundColor.setRGB(lerp(0.10, 0.78, day), lerp(0.10, 0.66, day), lerp(0.14, 0.47, day));
    this.fill.intensity = lerp(0.08, 0.30, day);

    var fogC = this.scene.fog.color;
    fogC.setRGB(lerp(0.045, 0.85, day), lerp(0.062, 0.87, day), lerp(0.13, 0.91, day));
    this.scene.fog.density = lerp(0.0060, 0.0032, day);

    // 车灯：夜里点亮
    var ud = this.bike.root.userData;
    if (ud.lensMat) {
      ud.lensMat.emissiveIntensity = lerp(0.15, 2.4, night);
      ud.lensMat.color.setRGB(1, lerp(0.98, 0.90, night), lerp(0.92, 0.66, night));
    }
    if (ud.tailMat) ud.tailMat.emissiveIntensity = lerp(0.25, 2.8, night);
  };

  /* ---------------- 输入 ---------------- */
  App.prototype.bindKeys = function () {
    var self = this, keys = this.keys = {};
    window.addEventListener('keydown', function (e) {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      keys[e.code] = true;
      self.onKey(e);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });
    window.addEventListener('blur', function () { self.keys = keys = {}; });
  };

  App.prototype.onKey = function (e) {
    var P = this.P, S = this.state;
    switch (e.code) {
      case 'Space': S.paused = !S.paused; this.flash(0.25); break;
      case 'KeyC': this.cycleCamera(); break;
      case 'KeyR': S.autoRide = !S.autoRide; this.toast(S.autoRide ? '自动巡航 开' : '自动巡航 关'); break;
      case 'KeyN': P.timeOfDay = (P.timeOfDay + 12) % 24; this.updateSky(0, true); this.toast('切换昼夜'); break;
      case 'KeyH': this.toggleUI(); break;
      case 'KeyB': if (this.audio) { this.audio.bell(); } break;
      case 'KeyP': this.screenshot(); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
      case 'Digit5': case 'Digit6': case 'Digit7':
        var i = parseInt(e.code.slice(5), 10) - 1;
        if (CAM_MODES[i]) { this.setCamera(CAM_MODES[i]); }
        break;
    }
  };

  App.prototype.bindPointer = function (dom) {
    var self = this, down = false, lx = 0, ly = 0;
    dom.addEventListener('pointerdown', function (e) {
      down = true; lx = e.clientX; ly = e.clientY;
      dom.setPointerCapture(e.pointerId);
      self.audio.resume();
    });
    dom.addEventListener('pointerup', function (e) {
      down = false;
      try { dom.releasePointerCapture(e.pointerId); } catch (err) { }
    });
    dom.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      var cr = self.camRig;
      if (cr.mode === 'free') {
        cr.freeYaw -= dx * 0.005;
        cr.freePitch = clamp(cr.freePitch + dy * 0.004, -0.9, 1.2);
      } else if (cr.mode === 'orbit') {
        cr.orbitA -= dx * 0.005;
      } else {
        cr.freeYaw -= dx * 0.005;
        cr.freePitch = clamp(cr.freePitch + dy * 0.004, -0.9, 1.2);
        cr.mode = 'free';
        self.setCamera('free');
      }
    });
    dom.addEventListener('wheel', function (e) {
      var cr = self.camRig;
      cr.freeDist = clamp(cr.freeDist + e.deltaY * 0.006, 2.2, 30);
      if (cr.mode === 'orbit') cr.orbitA += e.deltaY * 0.001;
      e.preventDefault();
    }, { passive: false });
  };

  /* ---------------- 相机切换 ---------------- */
  App.prototype.setCamera = function (m) {
    this.camRig.mode = m;
    this.state.camMode = m;
    var lab = document.getElementById('camLabel');
    if (lab) lab.textContent = CAM_LABEL[m] || m;
    var btns = document.querySelectorAll('.cambtn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].dataset.mode === m);
    }
  };
  App.prototype.cycleCamera = function () {
    var i = CAM_MODES.indexOf(this.camRig.mode);
    this.setCamera(CAM_MODES[(i + 1) % CAM_MODES.length]);
  };

  /* ---------------- UI ---------------- */
  App.prototype.buildUI = function () {
    var self = this;
    var bar = document.getElementById('camBar');
    if (bar) {
      CAM_MODES.forEach(function (m, i) {
        var b = document.createElement('button');
        b.className = 'cambtn';
        b.dataset.mode = m;
        b.textContent = (i + 1) + ' ' + CAM_LABEL[m];
        b.onclick = function () { self.setCamera(m); self.audio.uiTick(); };
        bar.appendChild(b);
      });
      this.setCamera('trailing');
    }
    var btn = function (id, fn) { var e = document.getElementById(id); if (e) e.onclick = fn; };
    btn('btnPause', function () { self.state.paused = !self.state.paused; self.syncUI(); });
    btn('btnNight', function () { self.P.timeOfDay = (self.P.timeOfDay + 12) % 24; self.updateSky(0, true); });
    btn('btnAudio', function () { self.toggleAudio(); });
    btn('btnBell', function () { self.audio.resume(); self.audio.bell(); });
    btn('btnSquawk', function () { self.audio.resume(); self.audio.squawk(1); });
    btn('btnShot', function () { self.screenshot(); });
    btn('btnHelp', function () {
      var h = document.getElementById('help');
      if (h) h.classList.toggle('hidden');
    });
    btn('btnUI', function () { self.toggleUI(); });

    // 滑块
    this.sliders = {};
    var defs = [
      ['throttle', '油门', 0, 1.4], ['maxSpeed', '极速', 1, 18],
      ['bounce', '踩踏起伏', 0, 2.5], ['lean', '前倾', -0.2, 0.8], ['crouch', '低伏', 0, 1],
      ['wingSpread', '张翅', 0, 1.5], ['wingFlap', '扇翅', 0, 1.2],
      ['timeOfDay', '时刻', 0, 24], ['daySpeed', '时间流速', 0, 1.2],
      ['exposure', '曝光', 0.3, 2.2], ['bloom', '辉光', 0, 2],
      ['contrast', '对比', -0.4, 0.5], ['saturation', '饱和', 0, 2],
      ['temperature', '色温', -0.4, 0.4], ['vignette', '暗角', 0, 1.5],
      ['grain', '颗粒', 0, 0.25], ['chroma', '色散', 0, 0.016], ['sharpen', '锐化', 0, 0.8]
    ];
    var box = document.getElementById('sliders');
    if (box) {
      defs.forEach(function (d) {
        var row = document.createElement('div'); row.className = 'srow';
        var lab = document.createElement('span'); lab.className = 'slab'; lab.textContent = d[1];
        var inp = document.createElement('input');
        inp.type = 'range'; inp.min = d[2]; inp.max = d[3]; inp.step = (d[3] - d[2]) / 200;
        inp.value = self.P[d[0]];
        var val = document.createElement('span'); val.className = 'sval';
        val.textContent = (+self.P[d[0]]).toFixed(2);
        inp.oninput = function () {
          self.P[d[0]] = parseFloat(inp.value);
          val.textContent = (+inp.value).toFixed(2);
          if (d[0] === 'timeOfDay') self.updateSky(0, true);
        };
        row.appendChild(lab); row.appendChild(inp); row.appendChild(val);
        box.appendChild(row);
        self.sliders[d[0]] = { inp: inp, val: val };
      });
    }
    // Tonemap 选择
    var tm = document.getElementById('tonemap');
    if (tm) {
      ['ACES', 'AgX', 'Neutral', 'Filmic', 'Reinhard', 'Linear'].forEach(function (n, i) {
        var o = document.createElement('option'); o.value = i; o.textContent = n;
        tm.appendChild(o);
      });
      tm.value = 0;
      tm.onchange = function () { self.post.setToneMap(parseInt(tm.value, 10)); };
    }
  };

  App.prototype.toggleUI = function () {
    var p = document.getElementById('ui');
    if (p) p.classList.toggle('hidden');
  };
  App.prototype.toggleAudio = function () {
    var a = this.audio, S = this.state;
    if (!a.ctx) { a.init(); }
    S.audioOn = !S.audioOn;
    a.resume();
    a.setEnabled(S.audioOn);
    var b = document.getElementById('btnAudio');
    if (b) b.textContent = S.audioOn ? '🔊 声音' : '🔇 静音';
    if (S.audioOn) a.uiTick();
  };
  App.prototype.syncUI = function () {
    var b = document.getElementById('btnPause');
    if (b) b.textContent = this.state.paused ? '▶ 继续' : '⏸ 暂停';
  };
  App.prototype.toast = function (msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(function () { t.classList.remove('show'); }, 1400);
  };
  App.prototype.flash = function (v) { this._flash = v; };

  App.prototype.screenshot = function () {
    var self = this;
    this.renderer.domElement.toBlob(function (blob) {
      if (!blob) return;
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pelican-bicycle-' + Date.now() + '.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      self.toast('已保存截图');
    });
  };

  App.prototype.onResize = function () {
    var w = window.innerWidth, h = window.innerHeight;
    var pr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h, pr);
    this.fx.setPixelRatio(pr);
  };

  /* ---------------- 渲染统计（后处理会重置计数，所以自己存） ---------------- */
  App.prototype._captureStats = function () {
    var i = this.renderer.info;
    this.stats = this.stats || { calls: 0, tris: 0 };
    this.stats.calls = i.render.calls;
    this.stats.tris = i.render.triangles;
  };

  /* ---------------- 每帧 ---------------- */
  var _vA = new V3(), _vB = new V3(), _vC = new V3(), _vD = new V3(), _vE = new V3();

  App.prototype.step = function (dt) {
    var P = this.P, S = this.state;
    if (S.paused) dt = 0;
    this.t += dt;

    // 时间流逝
    if (P.daySpeed > 0.001) {
      P.timeOfDay = (P.timeOfDay + P.daySpeed * dt * 0.6) % 24;
      this.updateSky(dt);
    }

    var T = this.transport;
    var keys = this.keys || {};

    // ---- 控制 ----
    var ctrl = {
      throttle: S.autoRide ? P.throttle : 0,
      maxSpeed: P.maxSpeed, accel: 2.4, decel: 3.0,
      brake: false, steer: 0
    };
    if (keys['ArrowUp'] || keys['KeyW']) { ctrl.throttle = 1.3; S.autoRide = false; }
    if (keys['ArrowDown'] || keys['KeyS']) { ctrl.throttle = 0; ctrl.brake = true; }
    if (keys['ShiftLeft']) ctrl.throttle *= 1.5;
    var st = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) st -= 1;
    if (keys['ArrowRight'] || keys['KeyD']) st += 1;
    if (st !== 0) { ctrl.steer = st; S.autoRide = false; }
    else if (S.autoRide) ctrl.steer = P.steer;
    // 自动巡航时轻微蛇行，看起来在控车
    if (S.autoRide) ctrl.steer += Math.sin(this.t * 0.55) * 0.28 * P.autoSteer;

    T.update(dt, ctrl);

    // ---- 车身姿态 ----
    var rig = this.rig;
    rig.position.copy(T.pos);
    rig.rotation.set(0, 0, 0);
    rig.rotateY(T.yaw);
    rig.rotateX(T.pitch);
    rig.rotateZ(T.lean);
    // 车轮接触点：车组原点在地面，所以直接用地面高度
    rig.position.y = T.groundY + T.airY;

    this.aimPoint.copy(T.pos); this.aimPoint.y += 1.0;

    // ---- 自行车 ----
    var bike = this.bike;
    bike.update(T.crankAngle, dt, this.t);

    // ---- 鹈鹕 IK ----
    var DIM = PB.Bicycle.DIM;
    bike.root.updateMatrixWorld(true);
    var pel = this.pelican;

    // 车把（世界）
    bike.barWorld(1, _vA);
    bike.barWorld(-1, _vB);
    // 脚踏（世界）
    bike.pedalWorld(1, T.crankAngle, _vC);
    bike.pedalWorld(-1, T.crankAngle + PI, _vD);
    // 车座（世界）—— 用来把髋部钉住
    bike.seatWorld(_vE);

    var hipTargetY = _vE.y;
    var seatBackZ = _vE.z;
    var seatX = _vE.x;

    // 把鹈鹕的根骨放到车座上方：静止姿态 hips 在局部 y=0.86
    var pr = this.pelicanRoot;
    pr.position.set(0, 0, 0);
    pr.rotation.set(0, 0, 0);
    var sitY = DIM.seatTopY + 0.10 - 0.86;
    pr.position.set(0, sitY, DIM.seatTopZ - 0.02);
    // 踩踏起伏 + 低伏
    var bounce = Math.sin(T.crankAngle * 2) * 0.022 * P.bounce * sat(T.speed / 3);
    pr.position.y += bounce;
    pr.position.z -= P.crouch * 0.10;
    pr.rotation.x = -P.crouch * 0.12;

    pr.updateMatrixWorld(true);

    pel.solve({
      bounce: (Math.sin(T.crankAngle * 2) * 1.0) * P.bounce * sat(T.speed / 3),
      lean: P.lean + P.crouch * 0.25,
      roll: T.lean * 1.2,
      speed: T.speed,
      neckLook: Math.sin(this.t * 0.7) * 0.25 - T.lean * 0.8,
      wingSpread: P.wingSpread + (T.onGround ? 0 : P.wingFlap * 1.2),
      barL: _vA, barR: _vB, pedalL: _vC, pedalR: _vD,
      lookAt: { x: Math.sin(this.t * 0.5) * 2, y: Math.cos(this.t * 0.31) * 1.2 }
    }, dt, this.t);

    // ---- 世界 ----
    this.world.update(this.t, dt, this.camera, this.nightAmt);

    // ---- 尾迹 / 影子 / 粒子 ----
    var fx = this.fx;
    var rearW = _vA.set(0, DIM.wheelR, DIM.rearZ).applyMatrix4(bike.root.matrixWorld);
    var frontW = _vB.set(0, DIM.wheelR, DIM.frontZ).applyMatrix4(bike.root.matrixWorld);
    var vel = _vC.copy(T.fwd).multiplyScalar(T.speed);

    // 车轮扬沙
    if (T.onGround && T.speed > 0.4) {
      var rate = sat(T.speed / 7) * (1 + Math.abs(T.lean) * 2);
      fx.wheelDust(rearW.x, T.groundY + 0.03, rearW.z, -vel.x, -vel.z, T.speed, dt, rate);
      fx.wheelDust(frontW.x, T.groundY + 0.03, frontW.z, -vel.x, -vel.z, T.speed * 0.7, dt, rate * 0.7);
      // 胎痕
      fx.trail.stamp(rearW.x, rearW.z, 0.10 + T.speed * 0.008, 0.05 + rate * 0.05, T.yaw);
      fx.trail.stamp(frontW.x, frontW.z, 0.09, 0.03 + rate * 0.03, T.yaw);
    }
    // 溅水：靠近海岸时
    var distC = Math.hypot(rearW.x, rearW.z);
    var wetness = sat((distC - PB.World.ISLAND_R * 0.72) / 12);
    if (T.speed > 1 && wetness > 0.02) {
      fx.splash(rearW.x, T.groundY + 0.05, rearW.z, wetness * sat(T.speed / 8), vel);
      if (Math.random() < wetness * 0.4) fx.ripples.add(rearW.x, T.groundY + 0.02, rearW.z, 0.6);
    }
    if (T.justLanded) {
      this.audio.land(T.justLanded);
      this.camRig.shake += T.justLanded * 0.12;
      fx.wheelDust(rearW.x, T.groundY + 0.02, rearW.z, 0, 0, 3, dt, 3.5);
      T.justLanded = 0;
    }
    // 影子
    fx.blob.place(T.pos.x, T.groundY + 0.012, T.pos.z, 1.0, T.onGround ? 0.55 : 0.22);
    // 偶尔掉一根羽毛
    if (Math.random() < dt * 0.35) {
      fx.dropFeather(T.pos.x + (Math.random() - 0.5) * 2, T.groundY + 2.0, T.pos.z + (Math.random() - 0.5) * 2);
    }

    fx.update(dt, this.t, this.nightAmt, this.camera, this.sunDir, PB.World.heightAt);

    // ---- 相机 ----
    this.camRig.apply(dt, T, {});

    // ---- 音频 ----
    this.audio.update(dt, T.speed, T.speed / 0.35 * 0.42, this.nightAmt, T.onGround);

    // ---- 后处理参数 ----
    var u = this.post.u;
    u.uExposure.value = P.exposure;
    u.uBloom.value = P.bloom;
    u.uContrast.value = P.contrast;
    u.uSaturation.value = P.saturation;
    u.uTemperature.value = P.temperature;
    u.uVignette.value = P.vignette;
    u.uGrain.value = P.grain;
    u.uChroma.value = P.chroma;
    u.uSharpen.value = P.sharpen;
    u.uDistort.value = P.distort;
    if (this._flash) { this._flash = damp(this._flash, 0, 8, dt); }

    // ---- 渲染 ----
    this.post.render(this.scene, this.camera, this.t, {
      flash: this._flash || 0,
      bloomThreshold: 1.05, bloomRadius: 1.0
    });
    this._captureStats();

    // ---- HUD ----
    this.updateHUD(dt);
  };

  var hudT = 0;
  App.prototype.updateHUD = function (dt) {
    this.fpsSmooth = lerp(this.fpsSmooth, 1 / Math.max(dt, 1e-4), 0.08);
    hudT += dt;
    if (hudT < 0.25) return;
    hudT = 0;
    var T = this.transport;
    var set = function (id, txt) { var e = document.getElementById(id); if (e) e.textContent = txt; };
    set('hudFps', Math.round(this.fpsSmooth) + ' fps');
    set('hudSpeed', (T.speed * 3.6).toFixed(1) + ' km/h');
    set('hudDist', (T.travelled / 1000).toFixed(2) + ' km');
    set('hudTime', U.pad2(Math.floor(this.P.timeOfDay)) + ':' +
      U.pad2(Math.floor((this.P.timeOfDay % 1) * 60)));
    set('hudAir', T.onGround ? '着地' : '腾空 ' + T.airY.toFixed(2) + ' m');
    set('hudCam', CAM_LABEL[this.camRig.mode] || '');
    var pf = this.post;
    var calls = pf.lastSceneCalls != null ? pf.lastSceneCalls : this.renderer.info.render.calls;
    var tris = pf.lastSceneTris != null ? pf.lastSceneTris : this.renderer.info.render.triangles;
    set('hudDraw', calls + ' calls / ' + (tris / 1000).toFixed(0) + 'k tris');
  };

  PB.App = App;

  /* ---------------- 启动 ---------------- */
  window.addEventListener('DOMContentLoaded', function () {
    var app = window.pelicanApp = new App({});
    try {
      app.boot();
    } catch (err) {
      var l = document.getElementById('loading');
      if (l) {
        l.innerHTML = '<div class="err"><b>初始化失败</b><br><code>' +
          String(err && err.message || err).replace(/</g, '&lt;') + '</code></div>';
        l.style.opacity = '1';
      }
      throw err;
    }
  });
})();
