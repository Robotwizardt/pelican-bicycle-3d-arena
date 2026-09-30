
/* ---------------- 音频（WebAudio 合成） ---------------- */
var audio = {
  ctx: null, master: null, windGain: null, windFilter: null, ready: false,
  ensure: function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    /* 风声：循环噪声 + 低通 */
    var len = this.ctx.sampleRate * 2;
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    }
    var src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 420;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.master);
    src.start();
    this.ready = true;
  },
  bell: function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    [2093, 2637, 3136].forEach(function (f, i) {
      var o = audio.ctx.createOscillator(), g = audio.ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22 / (i + 1), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9 - i * 0.2);
      o.connect(g); g.connect(audio.master);
      o.start(t); o.stop(t + 1.0);
    });
    /* 金属敲击感 */
    var o2 = audio.ctx.createOscillator(), g2 = audio.ctx.createGain();
    o2.type = 'triangle'; o2.frequency.value = 5200;
    g2.gain.setValueAtTime(0.12, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o2.connect(g2); g2.connect(audio.master);
    o2.start(t); o2.stop(t + 0.1);
  },
  squawk: function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    var o = audio.ctx.createOscillator(), g = audio.ctx.createGain(), f = audio.ctx.createBiquadFilter();
    o.type = 'sawtooth';
    f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 2.5;
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.10);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.34);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(f); f.connect(g); g.connect(audio.master);
    o.start(t); o.stop(t + 0.42);
  },
  setWind: function (v) {
    if (!this.ready) return;
    var target = state.sound ? clamp(v * 0.05, 0, 0.22) : 0;
    this.windGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25);
    this.windFilter.frequency.setTargetAtTime(300 + v * 55, this.ctx.currentTime, 0.3);
  }
};

/* ---------------- UI ---------------- */
var ui = {};
function bindUI() {
  ui.speed = $('#speed'); ui.spdVal = $('#spdVal');
  ui.spdNum = $('#spdNum'); ui.distNum = $('#distNum'); ui.cadNum = $('#cadNum');
  ui.timeName = $('#timeName'); ui.todVal = $('#todVal'); ui.liveryVal = $('#liveryVal');
  ui.panel = $('#panel'); ui.panelToggle = $('#panelToggle'); ui.todName = $('#todName');
  ui.toast = $('#toast'); ui.loader = $('#loader'); ui.ldBar = $('#ldBar'); ui.ldMsg = $('#ldMsg');
  ui.gaugeNeedle = $('#gaugeNeedle');

  /* 速度 */
  ui.speed.addEventListener('input', function () {
    state.speed = parseFloat(this.value);
    ui.spdVal.textContent = state.speed + ' km/h';
    this.style.setProperty('--p', (state.speed / 60 * 100) + '%');
  });
  ui.speed.style.setProperty('--p', (state.speed / 60 * 100) + '%');

  /* 时间段 */
  $('#todChips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    setTOD(b.dataset.tod);
  });

  /* 涂装 */
  var lv = $('#livery');
  LIVERY.forEach(function (l, i) {
    var d = document.createElement('div');
    d.className = 'sw' + (i === 0 ? ' on' : '');
    d.style.background = 'linear-gradient(150deg,#' + l.frame.toString(16).padStart(6, '0') + ',#' +
      (function (c) { var r = Math.min(255, (c >> 16) + 40), g = Math.min(255, ((c >> 8) & 255) + 40), b = Math.min(255, (c & 255) + 40); return ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0'); })(l.frame) + ')';
    d.title = l.name;
    d.addEventListener('click', function () { setLivery(i); });
    lv.appendChild(d);
  });

  /* 视角 */
  $('#camChips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    setCam(b.dataset.cam);
  });

  /* 开关 */
  Array.prototype.forEach.call(document.querySelectorAll('.tg'), function (el) {
    el.addEventListener('click', function () {
      var key = el.dataset.tg;
      state[key] = !state[key];
      el.classList.toggle('on', state[key]);
      if (key === 'autoRotate') { controls.autoRotate = state.autoRotate && state.camMode === 'orbit'; }
      if (key === 'shadows') { renderer.shadowMap.enabled = state.shadows; scene.traverse(function (o) { if (o.material) o.material.needsUpdate = true; }); }
      if (key === 'wireframe') { setWireframe(state.wireframe); }
      if (key === 'sound') {
        if (state.sound) { audio.ensure(); toast('🔊 音效已开启'); }
        else { audio.setWind(0); toast('🔇 音效已关闭'); }
      }
    });
  });

  /* 按钮 */
  $('#btnBell').addEventListener('click', function () { ringBell(); });
  $('#btnBellTouch').addEventListener('click', function () { ringBell(); });
  $('#btnPhoto').addEventListener('click', takePhoto);
  $('#btnReset').addEventListener('click', resetAll);
  $('#btnFull').addEventListener('click', toggleFullscreen);
  ui.panelToggle.addEventListener('click', function () { ui.panel.classList.remove('hide'); ui.panelToggle.classList.remove('show'); });

  /* 触屏转向 */
  Array.prototype.forEach.call(document.querySelectorAll('.tbtn[data-key]'), function (b) {
    var k = b.dataset.key;
    var on = function (e) { e.preventDefault(); touchSteer[k] = true; };
    var off = function (e) { e.preventDefault(); touchSteer[k] = false; };
    b.addEventListener('touchstart', on, { passive: false });
    b.addEventListener('touchend', off, { passive: false });
    b.addEventListener('touchcancel', off, { passive: false });
    b.addEventListener('mousedown', on);
    b.addEventListener('mouseup', off);
    b.addEventListener('mouseleave', off);
  });

  /* 键盘 */
  var keys = {};
  window.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    keys[k] = true;
    if (k === ' ') { e.preventDefault(); ringBell(); }
    if (k >= '1' && k <= '4') setTOD(TOD_ORDER[parseInt(k, 10) - 1]);
    if (k === 'r') resetAll();
    if (k === 'f') toggleFullscreen();
    if (k === 'p') takePhoto();
  });
  window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
  ui.keys = keys;

  /* 面板显隐（移动端） */
  window.addEventListener('resize', layout);
  layout();
}
function layout() {
  if (window.innerWidth <= 900) { ui.panel.classList.add('hide'); ui.panelToggle.classList.add('show'); }
  else { ui.panel.classList.remove('hide'); ui.panelToggle.classList.remove('show'); }
}
var toastTimer = null;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { ui.toast.classList.remove('show'); }, 1900);
}

/* ---------------- 交互动作 ---------------- */
var touchSteer = { left: false, right: false };
function ringBell() {
  state.excitement = 1;
  if (state.sound) { audio.ensure(); audio.bell(); audio.squawk(); }
  toast('🔔 叮——！鹈鹕：嗷！');
}
function setTOD(name) {
  if (!TOD[name]) return;
  state.tod = name;
  refreshTODTarget();
  if (todTgt.sunPos) applyTOD();
  Array.prototype.forEach.call(document.querySelectorAll('#todChips .chip'), function (c) {
    c.classList.toggle('on', c.dataset.tod === name);
  });
  ui.todVal.textContent = TOD[name].label;
  ui.timeName.textContent = TOD[name].label;
  if (ui.todName) ui.todName.textContent = TOD[name].icon + ' ' + TOD[name].label;
  document.documentElement.style.setProperty('--accent', TOD[name].accent);
  toast('🕐 时间段：' + TOD[name].label);
}
function setLivery(i) {
  state.livery = i;
  var l = LIVERY[i];
  frameMat.color.setHex(l.frame);
  bird.capMat.color.setHex(l.frame);
  bird.scarfMat.color.setHex(l.frame === 0x4a6fd4 ? 0xe9523f : l.frame);
  Array.prototype.forEach.call(document.querySelectorAll('#livery .sw'), function (s, j) {
    s.classList.toggle('on', j === i);
  });
  ui.liveryVal.textContent = l.name;
  document.documentElement.style.setProperty('--accent', l.accent);
  toast('🎨 涂装：' + l.name);
}
var camTween = null;
function setCam(mode) {
  state.camMode = mode;
  Array.prototype.forEach.call(document.querySelectorAll('#camChips .chip'), function (c) {
    c.classList.toggle('on', c.dataset.cam === mode);
  });
  controls.autoRotate = state.autoRotate && mode === 'orbit';
  controls.enabled = mode === 'orbit';
  var targets = {
    orbit: { pos: V3(4.6, 2.45, 5.2), tgt: V3(0, 1.02, 0) },
    side: { pos: V3(7.6, 1.7, 0.4), tgt: V3(0, 1.0, 0.1) },
    front: { pos: V3(-2.6, 2.0, -6.2), tgt: V3(0, 1.1, -0.3) },
    chase: { pos: V3(0, 2.3, 6.0), tgt: V3(0, 1.1, -1.2) },
    top: { pos: V3(0.01, 9.0, 1.0), tgt: V3(0, 0.7, 0) }
  };
  camTween = {
    from: camera.position.clone(), to: targets[mode].pos.clone(),
    fromT: controls.target.clone(), toT: targets[mode].tgt.clone(),
    t: 0, dur: 1.0
  };
}
function resetAll() {
  state.speed = 18; state.steerTarget = 0;
  ui.speed.value = 18; ui.speed.dispatchEvent(new Event('input'));
  setCam('orbit');
  setWireframe(false);
  document.querySelector('.tg[data-tg="wireframe"]').classList.remove('on');
  state.wireframe = false;
  camera.position.set(4.6, 2.45, 5.2);
  controls.target.set(0, 1.02, 0);
  toast('↺ 已重置视角与速度');
}
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    (document.documentElement.requestFullscreen || function () {}).call(document.documentElement);
  } else if (document.exitFullscreen) { document.exitFullscreen(); }
}
function takePhoto() {
  renderer.render(scene, camera);
  try {
    var url = renderer.domElement.toDataURL('image/png');
    var a = document.createElement('a');
    a.href = url;
    a.download = 'pelican-ride-3d-' + Date.now() + '.png';
    document.body.appendChild(a); a.click(); a.remove();
    toast('📷 已保存截图');
  } catch (e) { toast('😥 截图失败'); }
}
function setWireframe(on) {
  scene.traverse(function (o) {
    if (o.isMesh && o.material && 'wireframe' in o.material) {
      if (Array.isArray(o.material)) o.material.forEach(function (m) { m.wireframe = on; });
      else o.material.wireframe = on;
    }
  });
}
