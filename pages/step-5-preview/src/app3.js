
/* ---------------- 昼夜系统 ---------------- */
var todCur = {
  skyTop: new THREE.Color(0x2f7fd0), skyMid: new THREE.Color(0x8fd0f5), skyBot: new THREE.Color(0xdff1fb),
  sunColor: new THREE.Color(0xfff6e0), sunI: 1.15, sunPos: V3(30, 46, 26),
  hemiSky: new THREE.Color(0xbfe3ff), hemiGround: new THREE.Color(0x7d9a6d), hemiI: 0.75,
  amb: 0.25, fog: new THREE.Color(0xcfe6f2), fogNear: 34, fogFar: 235,
  stars: 0, lamp: 0, sunSpr: 1, moonSpr: 0, beam: 0
};
var todTgt = {};
function refreshTODTarget() {
  var p = TOD[state.tod];
  todTgt = {
    skyTop: new THREE.Color(p.sky.top), skyMid: new THREE.Color(p.sky.mid), skyBot: new THREE.Color(p.sky.bot),
    sunColor: new THREE.Color(p.sun.color), sunI: p.sun.intensity, sunPos: V3(p.sun.pos[0], p.sun.pos[1], p.sun.pos[2]),
    hemiSky: new THREE.Color(p.hemi.sky), hemiGround: new THREE.Color(p.hemi.ground), hemiI: p.hemi.intensity,
    amb: p.ambient, fog: new THREE.Color(p.fog), fogNear: p.fogNear, fogFar: p.fogFar,
    stars: p.stars, lamp: p.lamp, sunSpr: p.sunSprite, moonSpr: p.moonSprite, beam: p.beam
  };
}
function dampColor(c, t, l, dt) { c.r = damp(c.r, t.r, l, dt); c.g = damp(c.g, t.g, l, dt); c.b = damp(c.b, t.b, l, dt); }
function dampVec(v, t, l, dt) { v.x = damp(v.x, t.x, l, dt); v.y = damp(v.y, t.y, l, dt); v.z = damp(v.z, t.z, l, dt); }
function applyTOD() {
  skyMat.uniforms.topColor.value.copy(todCur.skyTop);
  skyMat.uniforms.midColor.value.copy(todCur.skyMid);
  skyMat.uniforms.botColor.value.copy(todCur.skyBot);
  skyMat.uniforms.sunColor.value.copy(todCur.sunColor);
  skyMat.uniforms.sunDir.value.copy(todCur.sunPos).normalize();
  sunLight.color.copy(todCur.sunColor);
  sunLight.intensity = todCur.sunI;
  sunLight.position.copy(todCur.sunPos);
  hemiLight.color.copy(todCur.hemiSky);
  hemiLight.groundColor.copy(todCur.hemiGround);
  hemiLight.intensity = todCur.hemiI;
  ambientLight.intensity = todCur.amb;
  scene.fog.color.copy(todCur.fog);
  scene.fog.near = todCur.fogNear;
  scene.fog.far = todCur.fogFar;
  starMat.opacity = todCur.stars * (0.78 + 0.22 * Math.sin(state.t * 1.7));
  sunSprite.material.opacity = todCur.sunSpr;
  moonSprite.material.opacity = todCur.moonSpr;
  _v.copy(todCur.sunPos).normalize().multiplyScalar(420);
  sunSprite.position.copy(_v);
  _v.copy(todCur.sunPos).normalize().multiplyScalar(430);
  moonSprite.position.copy(_v);
  for (var i = 0; i < lampMat.length; i++) lampMat[i].emissiveIntensity = todCur.lamp * 2.6;
  for (var j = 0; j < env.scenery.length; j++) {
    var s = env.scenery[j];
    if (s.kind === 'lamp' && s.obj.userData.halo) s.obj.userData.halo.material.opacity = todCur.lamp * 0.85;
  }
  if (headLight) {
    headLight.intensity = todCur.beam * 3.0;
    if (beamMesh) beamMesh.material.opacity = todCur.beam * 0.085;
    if (bike.userData.lens) bike.userData.lens.material.emissiveIntensity = todCur.beam * 1.8 + 0.04;
    if (bike.userData.tailLens) bike.userData.tailLens.material.emissiveIntensity = todCur.beam * 2.4 + 0.05;
  }
}
function updateTOD(dt) {
  if (!todTgt.sunPos) return;
  var l = 2.0;
  dampColor(todCur.skyTop, todTgt.skyTop, l, dt);
  dampColor(todCur.skyMid, todTgt.skyMid, l, dt);
  dampColor(todCur.skyBot, todTgt.skyBot, l, dt);
  dampColor(todCur.sunColor, todTgt.sunColor, l, dt);
  dampColor(todCur.hemiSky, todTgt.hemiSky, l, dt);
  dampColor(todCur.hemiGround, todTgt.hemiGround, l, dt);
  dampColor(todCur.fog, todTgt.fog, l, dt);
  dampVec(todCur.sunPos, todTgt.sunPos, l, dt);
  todCur.sunI = damp(todCur.sunI, todTgt.sunI, l, dt);
  todCur.hemiI = damp(todCur.hemiI, todTgt.hemiI, l, dt);
  todCur.amb = damp(todCur.amb, todTgt.amb, l, dt);
  todCur.fogNear = damp(todCur.fogNear, todTgt.fogNear, l, dt);
  todCur.fogFar = damp(todCur.fogFar, todTgt.fogFar, l, dt);
  todCur.stars = damp(todCur.stars, todTgt.stars, l, dt);
  todCur.lamp = damp(todCur.lamp, todTgt.lamp, l, dt);
  todCur.sunSpr = damp(todCur.sunSpr, todTgt.sunSpr, l, dt);
  todCur.moonSpr = damp(todCur.moonSpr, todTgt.moonSpr, l, dt);
  todCur.beam = damp(todCur.beam, todTgt.beam, l, dt);
  applyTOD();
}

/* ---------------- 动画 ---------------- */
var _footW = V3(), _knee = V3(), _kneeDir = V3(), AXIS_X = V3(1, 0, 0);
var hudT = 0, fpsT = 0, fpsN = 0, windT = 0, rawDt = 0;

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

function updateBike(dt) {
  wheelR.rotation.x = -state.wheel;
  wheelF.rotation.x = -state.wheel;
  crankG.rotation.x = -state.crank;
  pedalL.rotation.x = state.crank;
  pedalR.rotation.x = state.crank;
  steerGroup.rotation.y = state.steer * 0.55;
  bike.rotation.y = -state.steer * 0.34;
  bike.rotation.z = -state.steer * 0.30;
  /* 车铃摇晃 */
  bellGroup.rotation.z = Math.sin(state.t * 34) * 0.4 * state.excitement;
  bellGroup.rotation.x = Math.sin(state.t * 27) * 0.25 * state.excitement;
  /* 筐里的鱼 */
  fishGroup.rotation.z = 0.25 + Math.sin(state.t * 2.6) * 0.14;
  fishGroup.position.y = 0.16 + Math.sin(state.t * 2.6 + 1) * 0.012;
}

function updatePelican(dt) {
  var t = state.t;
  var p = bird.root;
  var moving = state.speed > 0.4 ? 1 : 0.25;
  /* 身体随踩踏起伏 */
  p.position.y = 0.95 + Math.sin(state.crank * 2) * 0.013 * moving;
  p.rotation.x = -0.12 + Math.sin(state.crank * 2 + 0.6) * 0.014 * moving + state.excitement * 0.10;
  p.rotation.z = -state.steer * 0.10;
  /* 脖子：三段骨架，S 形摆动 */
  var sway = Math.sin(t * 1.15) * 0.05 + state.steer * 0.07;
  var ex = state.excitement;
  var a1 = 0.55 + sway * 0.7 + Math.sin(t * 2.1) * 0.022 - ex * 0.20;
  var a2 = 0.15 + sway + Math.sin(t * 1.7 + 1) * 0.03;
  var a3 = 0.35 + sway * 0.5 + Math.sin(t * 2.4 + 2) * 0.03 - ex * 0.26;
  var L = 0.16, j = bird.neckJoints;
  j[0].set(0, 0.20, -0.14);
  j[1].set(0, j[0].y + Math.cos(a1) * L, j[0].z - Math.sin(a1) * L);
  j[2].set(0, j[1].y + Math.cos(a2) * L, j[1].z - Math.sin(a2) * L);
  j[3].set(0, j[2].y + Math.cos(a3) * L, j[2].z - Math.sin(a3) * L);
  for (var i = 0; i < 3; i++) aimSegment(bird.neck[i], j[i], j[i + 1]);
  bird.head.position.copy(j[3]);
  bird.head.rotation.set(-a3 - 0.05, -state.steer * 0.18 + Math.sin(t * 0.7) * 0.05, Math.sin(t * 0.9) * 0.035);
  /* 翅膀 */
  var flap = Math.sin(state.crank * 0.9) * 0.10 * moving + Math.sin(t * 2.3) * 0.045 + ex * 1.0;
  var sweep = -0.22 - clamp(state.speed / 60, 0, 1) * 0.16;
  bird.wingR.rotation.set(0.14 + ex * 0.35, sweep, flap);
  bird.wingL.rotation.set(0.14 + ex * 0.35, -sweep, -flap);
  /* 尾羽 */
  bird.tail.rotation.set(0.12 + Math.sin(t * 1.3) * 0.05 + ex * 0.25, Math.sin(t * 0.8) * 0.09, 0);
  /* 围巾 */
  var windK = clamp(state.speed / 60, 0, 1);
  for (var s = 0; s < bird.scarfSegs.length; s++) {
    var seg = bird.scarfSegs[s];
    seg.rotation.y = Math.sin(t * 7.5 - s * 0.55) * (0.16 + windK * 0.2);
    seg.rotation.x = -0.04 - windK * 0.16 + Math.sin(t * 6.2 - s * 0.5) * (0.10 + windK * 0.14);
  }
  /* 腿部 IK */
  for (var l = 0; l < bird.legs.length; l++) {
    var leg = bird.legs[l];
    leg.foot.getWorldPosition(_footW);
    bird.root.worldToLocal(_footW);
    _v.subVectors(_footW, leg.hip);
    var d = clamp(_v.length(), Math.abs(leg.l1 - leg.l2) + 0.06, leg.l1 + leg.l2 - 0.012);
    _v.normalize();
    var ang = Math.acos(clamp((leg.l1 * leg.l1 + d * d - leg.l2 * leg.l2) / (2 * leg.l1 * d), -1, 1));
    _kneeDir.copy(_v).applyAxisAngle(AXIS_X, ang);
    _knee.copy(leg.hip).addScaledVector(_kneeDir, leg.l1);
    aimSegment(leg.thigh, leg.hip, _knee);
    aimSegment(leg.shin, _knee, _footW);
    leg.knee.position.copy(_knee);
    leg.ankle.position.copy(_footW);
  }
}

function curveOffset(z) { return -state.steer * 0.11 * z; }

function updateWorld(dt) {
  var v = state.speed / 3.6;
  /* 公路滚动 */
  env.roadTex.offset.y += v * (9 / 460) * dt;
  env.roadTex.offset.x -= state.steer * v * dt * 0.018;
  /* 景物循环 */
  for (var i = 0; i < env.scenery.length; i++) {
    var s = env.scenery[i];
    var o = s.obj;
    o.position.z += v * dt;
    o.position.x = s.baseX + curveOffset(o.position.z);
    if (o.position.z > 26) {
      o.position.z -= 196;
      s.baseX = (Math.random() < 0.5 ? -1 : 1) * rand(3.6, 14);
      var sc = rand(0.85, 1.25);
      o.scale.set(sc, sc, sc);
      o.rotation.y = Math.random() * Math.PI * 2;
      o.position.x = s.baseX;
    }
  }
  /* 云 */
  for (var c = 0; c < env.clouds.length; c++) {
    var cl = env.clouds[c];
    cl.obj.position.x += cl.v * dt;
    if (cl.obj.position.x > 120) cl.obj.position.x = -120;
  }
  /* 热气球 */
  balloonGroup.position.y = 30 + Math.sin(state.t * 0.32) * 1.6;
  balloonGroup.rotation.y = Math.sin(state.t * 0.12) * 0.5;
  /* 星空缓慢旋转 */
  stars.rotation.y += dt * 0.004;
}

function updateCamera(dt) {
  if (camTween) {
    camTween.t = Math.min(1, camTween.t + dt / camTween.dur);
    var e = easeInOut(camTween.t);
    camera.position.lerpVectors(camTween.from, camTween.to, e);
    controls.target.lerpVectors(camTween.fromT, camTween.toT, e);
    if (camTween.t >= 1) camTween = null;
  }
  if (state.camMode === 'orbit') {
    controls.update();
    return;
  }
  var d, dt2;
  var yaw = bike.rotation.y;
  if (state.camMode === 'chase') { d = V3(Math.sin(yaw) * 6.2, 2.45, Math.cos(yaw) * 6.2); dt2 = V3(0, 1.05, -1.8); }
  else if (state.camMode === 'side') { d = V3(7.6, 1.75, 0.4); dt2 = V3(0, 1.0, 0.1); }
  else if (state.camMode === 'front') { d = V3(-2.6, 2.0, -6.2); dt2 = V3(0, 1.1, -0.3); }
  else { d = V3(0.02, 9.2, 1.1); dt2 = V3(0, 0.7, 0); }
  camera.position.x = damp(camera.position.x, d.x, 3.2, dt);
  camera.position.y = damp(camera.position.y, d.y, 3.2, dt);
  camera.position.z = damp(camera.position.z, d.z, 3.2, dt);
  controls.target.x = damp(controls.target.x, dt2.x, 3.2, dt);
  controls.target.y = damp(controls.target.y, dt2.y, 3.2, dt);
  controls.target.z = damp(controls.target.z, dt2.z, 3.2, dt);
  camera.lookAt(controls.target);
}

function updateHUD(dt) {
  hudT += dt; fpsT += rawDt; fpsN++;
  if (ui.gaugeNeedle) {
    var ang = -120 + (state.speed / 60) * 240;
    ui.gaugeNeedle.setAttribute('transform', 'rotate(' + ang.toFixed(1) + ' 62 62)');
  }
  if (hudT > 0.12) {
    hudT = 0;
    ui.spdNum.textContent = Math.round(state.speed);
    ui.distNum.textContent = state.distance.toFixed(2);
    var v = state.speed / 3.6;
    ui.cadNum.textContent = Math.round(v / 0.325 / 2.75 * 60);
    var arc = document.getElementById('gaugeArc');
    if (arc) arc.setAttribute('stroke-dashoffset', String((157 * (1 - state.speed / 60)).toFixed(1)));
  }
  if (fpsT > 0.6 && ui.fpsInfo) {
    ui.fpsInfo.textContent = Math.round(fpsN / fpsT) + ' FPS · ' +
      (renderer.info.render.triangles / 1000).toFixed(1) + 'k 三角形';
    fpsT = 0; fpsN = 0;
  }
  windT += dt;
  if (windT > 0.3) { windT = 0; audio.setWind(state.speed); }
}

/* ---------------- 主循环 ---------------- */
function animate() {
  requestAnimationFrame(animate);
  rawDt = clock.getDelta();
  var dt = Math.min(rawDt, 0.05);
  state.t += dt;
  state.excitement = Math.max(0, state.excitement - dt * 0.9);

  /* 输入 */
  var k = ui.keys || {};
  var left = k['a'] || k['arrowleft'] || touchSteer.left;
  var right = k['d'] || k['arrowright'] || touchSteer.right;
  state.steerTarget = (right ? 1 : 0) - (left ? 1 : 0);
  state.steer = damp(state.steer, state.steerTarget * 0.55, 5, dt);
  var spdKey = (k['w'] || k['arrowup'] ? 1 : 0) - (k['s'] || k['arrowdown'] ? 1 : 0);
  if (spdKey) {
    state.speed = clamp(state.speed + spdKey * 16 * dt, 0, 60);
    ui.speed.value = Math.round(state.speed);
    ui.speed.dispatchEvent(new Event('input'));
  }

  var v = state.speed / 3.6;
  state.distance += v * dt / 1000;
  state.wheel += (v / 0.325) * dt;
  state.crank += (v / 0.895) * dt;

  updateBike(dt);
  updatePelican(dt);
  updateWorld(dt);
  updateCamera(dt);
  updateTOD(dt);
  updateHUD(dt);
  renderer.render(scene, camera);
}

/* ---------------- 启动 ---------------- */
function hasWebGL() {
  try {
    var c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) { return false; }
}
function playLoader() {
  var msgs = [
    ['正在唤醒鹈鹕…', 14], ['正在焊接车架…', 32], ['正在编织羽毛…', 50],
    ['调试喉囊颜色…', 66], ['给自行车打气…', 82], ['校准海风方向…', 96], ['出发！', 100]
  ];
  var i = 0;
  (function step() {
    if (i >= msgs.length) {
      setTimeout(function () {
        ui.loader.classList.add('done');
        setTimeout(function () { ui.loader.style.display = 'none'; }, 900);
      }, 240);
      return;
    }
    ui.ldMsg.textContent = msgs[i][0];
    ui.ldBar.style.width = msgs[i][1] + '%';
    i++;
    setTimeout(step, 175);
  })();
}
function onResize() {
  W = window.innerWidth; H = window.innerHeight;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
}
function init() {
  if (!hasWebGL()) {
    $('#fallback').classList.add('show');
    $('#loader').style.display = 'none';
    return;
  }
  initRenderer();
  buildSky();
  buildLights();
  buildGround();
  buildScenery();
  buildSkyLife();
  buildBike();
  buildPelican();
  bindUI();
  /* 面板技术信息（复用 HTML 中的占位元素，避免重复 id） */
  ui.fpsInfo = document.getElementById('fpsInfo');
  setTOD('noon');
  setCam('orbit');
  window.addEventListener('resize', onResize);
  /* 首次渲染 + 渲染信息 */
  updateBike(0); updatePelican(0);
  renderer.render(scene, camera);
  /* 调试/控制台把柄 */
  window.PELICAN = {
    THREE: THREE, scene: scene, camera: camera, renderer: renderer, controls: controls,
    bird: bird, bike: bike, state: state, todCur: todCur, setTOD: setTOD, setCam: setCam,
    ringBell: ringBell, setLivery: setLivery
  };
  playLoader();
  clock.getDelta();
  animate();
  setTimeout(function () { toast('提示：按空格键让鹈鹕按铃 🐦'); }, 2600);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
