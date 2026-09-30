/* ============================================================
   鹈鹕骑行 3D · Pelican Ride 3D
   纯程序化建模：鹈鹕 + 自行车 + 海岸公路 + 昼夜天空
   Three.js r128 · 无外部资源 · 单文件
   ============================================================ */
(function () {
'use strict';

/* ---------------- 工具 ---------------- */
var $ = function (s) { return document.querySelector(s); };
var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
var lerp = function (a, b, t) { return a + (b - a) * t; };
var damp = function (a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); };
var rand = function (a, b) { return a + Math.random() * (b - a); };
var randInt = function (a, b) { return Math.floor(rand(a, b + 1)); };
var pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
var V3 = function (x, y, z) { return new THREE.Vector3(x, y, z); };

/* ---------------- 配置：时间段 ---------------- */
var TOD = {
  dawn: {
    icon: '🌅',
    label: '黎明',
    sky: { top: 0x3c6ea8, mid: 0xf0a878, bot: 0xffe0b4 },
    sun: { color: 0xffc48a, intensity: 0.95, pos: [-24.5, 1.4, -17.3] },
    hemi: { sky: 0xffd2a8, ground: 0x7a6a58, intensity: 0.62 },
    ambient: 0.2,
    fog: 0xf0c9a4, fogNear: 28, fogFar: 205,
    stars: 0.32, exposure: 1.02, lamp: 0.3, beam: 0.18,
    sunSprite: 1.0, moonSprite: 0.18, accent: '#ff9e5e'
  },
  noon: {
    icon: '☀️',
    label: '正午',
    sky: { top: 0x2f7fd0, mid: 0x8fd0f5, bot: 0xdff1fb },
    sun: { color: 0xfff6e0, intensity: 1.15, pos: [-17.1, 20.8, -13.3] },
    hemi: { sky: 0xbfe3ff, ground: 0x7d9a6d, intensity: 0.75 },
    ambient: 0.25,
    fog: 0xcfe6f2, fogNear: 34, fogFar: 235,
    stars: 0, exposure: 1.0, lamp: 0.0, beam: 0.0,
    sunSprite: 1.0, moonSprite: 0.0, accent: '#ff8a3d'
  },
  dusk: {
    icon: '🌇',
    label: '黄昏',
    sky: { top: 0x35265e, mid: 0xd96a63, bot: 0xffb45c },
    sun: { color: 0xff9a52, intensity: 0.92, pos: [-11.8, 0.9, -27.6] },
    hemi: { sky: 0xe8907a, ground: 0x5d4a58, intensity: 0.5 },
    ambient: 0.17,
    fog: 0xd98a72, fogNear: 26, fogFar: 190,
    stars: 0.4, exposure: 1.04, lamp: 0.55, beam: 0.62,
    sunSprite: 1.0, moonSprite: 0.1, accent: '#ef6f4b'
  },
  night: {
    icon: '🌙',
    label: '夜晚',
    sky: { top: 0x040818, mid: 0x0c1c3c, bot: 0x1e3a63 },
    sun: { color: 0x9fb8ff, intensity: 0.36, pos: [-15.8, 2.3, -25.4] },
    hemi: { sky: 0x2a4a80, ground: 0x0d1524, intensity: 0.46 },
    ambient: 0.13,
    fog: 0x101f36, fogNear: 20, fogFar: 165,
    stars: 1.0, exposure: 1.1, lamp: 1.0, beam: 1.0,
    sunSprite: 0.0, moonSprite: 1.0, accent: '#6f8cff'
  }
};
var TOD_ORDER = ['dawn', 'noon', 'dusk', 'night'];

/* ---------------- 配置：涂装 ---------------- */
var LIVERY = [
  { name: '珊瑚红', frame: 0xe9523f, trim: 0xffd9a8, accent: '#ff8a3d' },
  { name: '薄荷绿', frame: 0x2fb8a6, trim: 0xe6fff9, accent: '#2fb8a6' },
  { name: '柠檬黄', frame: 0xf2b93c, trim: 0xfff3d0, accent: '#f2b93c' },
  { name: '鸢尾蓝', frame: 0x4a6fd4, trim: 0xdfe8ff, accent: '#6f8cff' }
];

/* ---------------- 全局状态 ---------------- */
var state = {
  speed: 18,           // km/h
  steer: 0, steerTarget: 0,
  tod: 'noon',
  livery: 0,
  camMode: 'orbit',
  autoRotate: true,
  shadows: true,
  wireframe: false,
  sound: false,
  distance: 0,         // km
  crank: 0,            // 曲柄角
  wheel: 0,            // 轮转角
  excitement: 0,
  t: 0
};

/* ---------------- 渲染器 / 场景 ---------------- */
var renderer, scene, camera, controls, skyMat, sunLight, hemiLight, ambientLight;
var stars, starMat, sunSprite, moonSprite, lampMat = [];
var headLight = null, beamMesh = null;
var W = window.innerWidth, H = window.innerHeight;
var clock = new THREE.Clock();

function initRenderer() {
  var stage = $('#app');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe6f2, 34, 235);

  camera = new THREE.PerspectiveCamera(46, W / H, 0.1, 1200);
  camera.position.set(4.6, 2.45, 5.2);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.02, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 2.2;
  controls.maxDistance = 24;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.autoRotate = state.autoRotate;
  controls.autoRotateSpeed = 0.55;
  controls.enablePan = false;
}

/* ---------------- 天空 ---------------- */
function buildSky() {
  var uniforms = {
    topColor: { value: new THREE.Color(0x2f7fd0) },
    midColor: { value: new THREE.Color(0x8fd0f5) },
    botColor: { value: new THREE.Color(0xdff1fb) },
    sunColor: { value: new THREE.Color(0xfff6e0) },
    sunDir: { value: V3(0.55, 0.5, 0.45).normalize() },
    sunSize: { value: 1.0 }
  };
  skyMat = new THREE.ShaderMaterial({
    uniforms: uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: [
      'varying vec3 vDir;',
      'void main(){',
      '  vDir = position;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 topColor; uniform vec3 midColor; uniform vec3 botColor;',
      'uniform vec3 sunColor; uniform vec3 sunDir; uniform float sunSize;',
      'varying vec3 vDir;',
      'void main(){',
      '  vec3 d = normalize(vDir);',
      '  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);',
      '  vec3 col = mix(botColor, midColor, smoothstep(0.34, 0.52, h));',
      '  col = mix(col, topColor, smoothstep(0.50, 0.96, h));',
      '  float s = max(dot(d, normalize(sunDir)), 0.0);',
      '  col += sunColor * (pow(s, 900.0) * 1.6 * sunSize + pow(s, 14.0) * 0.14);',
      '  gl_Fosition = vec4(col, 1.0);',
      '}'
    ].join('\n')
  });
  // 修正拼写（避免手滑）
  skyMat.fragmentShader = skyMat.fragmentShader.replace('gl_Fosition', 'gl_FragColor');
  var sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 20), skyMat);
  sky.name = 'sky';
  scene.add(sky);

  /* 星星 */
  var n = 900, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  var c = new THREE.Color();
  for (var i = 0; i < n; i++) {
    var th = Math.random() * Math.PI * 2, ph = Math.acos(rand(0.06, 1));
    var r = 460;
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph);
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    c.setHSL(rand(0.55, 0.68), rand(0, 0.5), rand(0.72, 1));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  starMat = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
  stars = new THREE.Points(g, starMat);
  scene.add(stars);

  sunSprite = glowSprite('rgba(255,250,225,1)', 'rgba(255,214,140,.75)', 90);
  moonSprite = glowSprite('rgba(235,242,255,1)', 'rgba(160,190,255,.45)', 46);
  scene.add(sunSprite); scene.add(moonSprite);
}

/* ---------------- 灯光 ---------------- */
function buildLights() {
  hemiLight = new THREE.HemisphereLight(0xbfe3ff, 0x7d9a6d, 0.75);
  scene.add(hemiLight);
  ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(0xfff6e0, 1.15);
  sunLight.position.set(30, 46, 26);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  var s = 7.5, cam = sunLight.shadow.camera;
  cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s; cam.near = 1; cam.far = 140;
  sunLight.shadow.bias = -0.0012;
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);
  scene.add(sunLight.target);
  sunLight.target.position.set(0, 0.8, 0);

  /* 补光：让暗部不死黑 */
  var fill = new THREE.DirectionalLight(0xcfe4ff, 0.28);
  fill.position.set(-14, 9, -12);
  scene.add(fill);
}

/* ---------------- 程序化贴图 ---------------- */
function noiseCanvas(size, base, dots, alpha) {
  var cv = document.createElement('canvas'); cv.width = cv.height = size;
  var x = cv.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, size, size);
  for (var i = 0; i < dots; i++) {
    var g = randInt(0, 70);
    x.fillStyle = 'rgba(' + g + ',' + (g + 8) + ',' + g + ',' + alpha + ')';
    x.fillRect(Math.random() * size, Math.random() * size, rand(1, 3.4), rand(1, 3.4));
  }
  return cv;
}
function makeTex(cv, rx, ry) {
  var t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function buildGround() {
  /* 草地 */
  var grassCv = noiseCanvas(256, '#7fae63', 1500, 0.16);
  var gx = grassCv.getContext('2d');
  for (var i = 0; i < 90; i++) {
    gx.strokeStyle = 'rgba(60,110,60,.20)'; gx.lineWidth = 1;
    var px = Math.random() * 256, py = Math.random() * 256;
    gx.beginPath(); gx.moveTo(px, py); gx.lineTo(px + rand(-3, 3), py - rand(3, 8)); gx.stroke();
  }
  var grass = new THREE.Mesh(
    new THREE.PlaneGeometry(460, 460),
    new THREE.MeshStandardMaterial({ map: makeTex(grassCv, 46, 46), roughness: 1, metalness: 0 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  /* 公路 */
  var rw = 5.6, rl = 460;
  var cv = document.createElement('canvas'); cv.width = 256; cv.height = 2048;
  var x = cv.getContext('2d');
  x.fillStyle = '#3d4147'; x.fillRect(0, 0, 256, 2048);
  for (var i = 0; i < 5200; i++) {
    var g = randInt(48, 78);
    x.fillStyle = 'rgba(' + g + ',' + g + ',' + (g + 4) + ',.5)';
    x.fillRect(Math.random() * 256, Math.random() * 2048, rand(1, 4), rand(1, 4));
  }
  /* 边线 */
  x.fillStyle = 'rgba(240,240,235,.92)';
  x.fillRect(14, 0, 9, 2048); x.fillRect(233, 0, 9, 2048);
  /* 中心虚线 */
  x.fillStyle = 'rgba(246,214,110,.95)';
  for (var y = 0; y < 2048; y += 410) x.fillRect(121, y, 14, 240);
  /* 远处修补痕迹 */
  x.fillStyle = 'rgba(20,20,22,.35)';
  x.fillRect(0, rand(0, 2048), 256, rand(20, 70));
  var roadTex = makeTex(cv, 1, 9);
  var road = new THREE.Mesh(
    new THREE.PlaneGeometry(rw, rl),
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.94, metalness: 0.02 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.012;
  road.receiveShadow = true;
  scene.add(road);
  env.roadTex = roadTex;

  /* 路肩 / 人行道 */
  var sideCv = noiseCanvas(128, '#c9c2b2', 500, 0.2);
  var sideTex = makeTex(sideCv, 2, 60);
  [-1, 1].forEach(function (s) {
    var m = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.09, rl),
      new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.9 })
    );
    m.position.set(s * (rw / 2 + 0.58), 0.045, 0);
    m.receiveShadow = true;
    scene.add(m);
    var curb = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, rl),
      new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.85 })
    );
    curb.position.set(s * (rw / 2 + 0.06), 0.07, 0);
    curb.receiveShadow = true;
    scene.add(curb);
  });
}

/* ---------------- 环境容器 ---------------- */
var env = { roadTex: null, scenery: [], clouds: [], lampLights: [] };

function buildScenery() {
  var matTrunk = new THREE.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.9 });
  var matLeaf = new THREE.MeshStandardMaterial({ color: 0x4e9a52, roughness: 0.85 });
  var matLeaf2 = new THREE.MeshStandardMaterial({ color: 0x3f8547, roughness: 0.85 });
  var matRock = new THREE.MeshStandardMaterial({ color: 0x8d8f93, roughness: 0.95, flatShading: true });
  var matWood = new THREE.MeshStandardMaterial({ color: 0xb08954, roughness: 0.9 });
  var matMetal = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.4, metalness: 0.7 });

  function palm() {
    var g = new THREE.Group();
    var h = rand(4.5, 7.5);
    var n = 7, pts = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      pts.push(V3(Math.sin(t * 2.2) * 0.55 * t, t * h, Math.cos(t * 1.6) * 0.3 * t));
    }
    var curve = new THREE.CatmullRomCurve3(pts);
    var trunk = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.13, 7), matTrunk);
    trunk.castShadow = true; g.add(trunk);
    var top = pts[n];
    for (var i = 0; i < 7; i++) {
      var a = (i / 7) * Math.PI * 2 + rand(-0.2, 0.2);
      var leaf = new THREE.Mesh(new THREE.ConeGeometry(0.32, 2.5, 4), i % 2 ? matLeaf : matLeaf2);
      leaf.scale.set(1, 1, 0.28);
      leaf.position.set(top.x + Math.cos(a) * 1.15, top.y - 0.1, top.z + Math.sin(a) * 1.15);
      leaf.rotation.set(Math.PI / 2 - 0.5, -a, 0);
      leaf.rotateX(rand(-0.25, 0.25));
      leaf.castShadow = true;
      g.add(leaf);
    }
    var coco = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), matTrunk);
    coco.position.set(top.x + 0.3, top.y - 0.35, top.z);
    g.add(coco);
    return g;
  }

  function bush() {
    var g = new THREE.Group();
    var n = randInt(3, 5);
    for (var i = 0; i < n; i++) {
      var s = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.35, 0.62), 0), i % 2 ? matLeaf : matLeaf2);
      s.position.set(rand(-0.4, 0.4), rand(0.3, 0.62), rand(-0.3, 0.3));
      s.castShadow = true;
      g.add(s);
    }
    return g;
  }

  function rock() {
    var g = new THREE.Group();
    var n = randInt(1, 3);
    for (var i = 0; i < n; i++) {
      var s = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.18, 0.4), 0), matRock);
      s.position.set(rand(-0.5, 0.5), rand(0.1, 0.28), rand(-0.4, 0.4));
      s.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      s.castShadow = true; s.receiveShadow = true;
      g.add(s);
    }
    return g;
  }

  function flowers() {
    var g = new THREE.Group();
    var cols = [0xff6b8a, 0xffd23f, 0xff9a4d, 0xc77dff, 0xffffff];
    var n = randInt(4, 8);
    for (var i = 0; i < n; i++) {
      var f = new THREE.Group();
      var st = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 4), matLeaf);
      st.position.y = 0.12; f.add(st);
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 7, 5),
        new THREE.MeshStandardMaterial({ color: pick(cols), roughness: 0.7 }));
      head.position.y = 0.26; f.add(head);
      f.position.set(rand(-0.5, 0.5), 0, rand(-0.4, 0.4));
      g.add(f);
    }
    return g;
  }

  function fence(len) {
    var g = new THREE.Group();
    var posts = Math.max(2, Math.round(len / 1.6));
    for (var i = 0; i < posts; i++) {
      var p = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.0, 0.11), matWood);
      p.position.set((i / (posts - 1) - 0.5) * len, 0.5, 0);
      p.castShadow = true;
      g.add(p);
    }
    [0.42, 0.78].forEach(function (y) {
      var r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.05), matWood);
      r.position.set(0, y, 0);
      r.castShadow = true;
      g.add(r);
    });
    return g;
  }

  function sign() {
    var g = new THREE.Group();
    var p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 6), matMetal);
    p.position.y = 1.05; p.castShadow = true; g.add(p);
    var texts = ['鹈鹕公路', 'PELICAN RD', '海风方向 →', '慢一点 · 看风景', '海岸 2 km'];
    var cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    var x = cv.getContext('2d');
    x.fillStyle = '#fdf6e6'; x.fillRect(0, 0, 512, 256);
    x.strokeStyle = '#2b3a48'; x.lineWidth = 12; x.strokeRect(10, 10, 492, 236);
    x.fillStyle = '#22303c'; x.font = 'bold 96px "PingFang SC","Microsoft YaHei",sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    var t = pick(texts);
    x.fillText(t.length > 6 ? t.slice(0, 6) : t, 256, 132);
    var tex = new THREE.CanvasTexture(cv);
    var board = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.85, 0.06),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    board.position.y = 2.15; board.castShadow = true;
    g.add(board);
    g.userData.text = t;
    return g;
  }

  function lamp() {
    var g = new THREE.Group();
    var p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x3c4652, roughness: 0.5, metalness: 0.6 }));
    p.position.y = 1.8; p.castShadow = true; g.add(p);
    var arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.8, 6), p.material);
    arm.rotation.z = Math.PI / 2; arm.position.set(0.35, 3.55, 0); g.add(arm);
    var bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffd98a, emissiveIntensity: 0.0, roughness: 0.4 });
    lampMat.push(bulbMat);
    var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), bulbMat);
    bulb.position.set(0.72, 3.45, 0); g.add(bulb);
    var halo = glowSprite('rgba(255,220,150,.9)', 'rgba(255,200,110,.35)', 1.7);
    halo.position.copy(bulb.position); g.add(halo);
    g.userData.halo = halo;
    return g;
  }

  var makers = [
    { f: palm, w: 2.6, side: [7.6, 18], cast: true },
    { f: bush, w: 3.4, side: [4.4, 9], cast: true },
    { f: rock, w: 1.4, side: [4.0, 7.5], cast: true },
    { f: flowers, w: 2.6, side: [3.6, 6.5], cast: false },
    { f: function () { var g = fence(rand(2.4, 5)); g.rotation.y = rand(-0.3, 0.3); return g; }, w: 1.6, side: [4.2, 6.4], cast: true },
    { f: sign, w: 0.5, side: [4.6, 6.2], cast: true },
    { f: lamp, w: 0.9, side: [4.0, 4.6], cast: true }
  ];
  var totalWeight = makers.reduce(function (s, m) { return s + m.w; }, 0);

  function spawnOne(obj, z) {
    var r = Math.random() * totalWeight, acc = 0, m = makers[0];
    for (var i = 0; i < makers.length; i++) { acc += makers[i].w; if (r <= acc) { m = makers[i]; break; } }
    var side = Math.random() < 0.5 ? -1 : 1;
    if (m === makers[6]) side = Math.random() < 0.5 ? -1 : 1;
    var built = m.f();
    built.position.set(side * rand(m.side[0], m.side[1]), 0, z);
    built.rotation.y = Math.random() * Math.PI * 2;
    if (m === makers[6]) { built.rotation.y = side > 0 ? -0.35 : Math.PI + 0.35; }
    var s = rand(0.85, 1.25);
    built.scale.set(s, s, s);
    scene.add(built);
    env.scenery.push({ obj: built, baseX: built.position.x, kind: m.f === makers[6].f ? 'lamp' : 'prop' });
  }

  for (var z = -170; z < 26; z += rand(2.2, 4.4)) spawnOne(null, z);
  env.spawnOne = spawnOne;
}

/* ---------------- 云 / 热气球 ---------------- */
var cloudMat, balloonGroup;
/* 太阳 / 月亮 精灵 */
function glowSprite(inner, outer, scale) {
  var cv = document.createElement('canvas'); cv.width = cv.height = 256;
  var x = cv.getContext('2d');
  var gr = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, inner); gr.addColorStop(0.22, outer); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
  var tex = new THREE.CanvasTexture(cv);
  var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sp.scale.set(scale, scale, 1);
  return sp;
}

function buildSkyLife() {
  cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, opacity: 0.92, flatShading: true });
  for (var i = 0; i < 11; i++) {
    var g = new THREE.Group();
    var n = randInt(4, 7);
    for (var j = 0; j < n; j++) {
      var s = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(1.6, 3.4), 1), cloudMat);
      s.position.set(rand(-4, 4), rand(-0.8, 0.8), rand(-2, 2));
      s.scale.y = rand(0.55, 0.8);
      g.add(s);
    }
    g.position.set(rand(-90, 90), rand(26, 52), rand(-190, -30));
    var sc = rand(0.8, 1.7); g.scale.set(sc, sc, sc);
    scene.add(g);
    env.clouds.push({ obj: g, v: rand(0.25, 0.8) });
  }

  /* 热气球 */
  balloonGroup = new THREE.Group();
  var env1 = new THREE.Mesh(new THREE.SphereGeometry(2.6, 18, 14),
    new THREE.MeshStandardMaterial({ color: 0xe9523f, roughness: 0.75 }));
  env1.scale.y = 1.25;
  var stripeMat = new THREE.MeshStandardMaterial({ color: 0xf7d13d, roughness: 0.75 });
  for (var k = 0; k < 4; k++) {
    var st = new THREE.Mesh(new THREE.SphereGeometry(2.62, 18, 14, (k / 4) * Math.PI * 2, Math.PI / 6), stripeMat);
    st.scale.y = 1.25;
    balloonGroup.add(st);
  }
  balloonGroup.add(env1);
  var basket = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 }));
  basket.position.y = -4.2; balloonGroup.add(basket);
  for (var r = 0; r < 4; r++) {
    var a = r / 4 * Math.PI * 2 + 0.4;
    var rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 4),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2a }));
    rope.position.set(Math.cos(a) * 0.35, -3.4, Math.sin(a) * 0.35);
    balloonGroup.add(rope);
  }
  balloonGroup.position.set(-46, 30, -130);
  scene.add(balloonGroup);
}

/* ---------------- 自行车 ---------------- */
var bike, wheelF, wheelR, crankG, pedalL, pedalR, bellGroup, basketGroup, fishGroup, frameMat, steerGroup;
function buildBike() {
  bike = new THREE.Group();
  scene.add(bike);

  /* 转向组：前叉 + 车把 + 车筐 绕头管轴线转动 */
  steerGroup = new THREE.Group();
  steerGroup.position.set(0, 0.80, -0.31);
  bike.add(steerGroup);

  frameMat = new THREE.MeshStandardMaterial({ color: LIVERY[0].frame, roughness: 0.32, metalness: 0.55 });
  var matMetal = new THREE.MeshStandardMaterial({ color: 0xd4d9de, roughness: 0.25, metalness: 0.85 });
  var matDark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.85 });
  var matTire = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.95 });
  var matGrip = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
  var matWicker = new THREE.MeshStandardMaterial({ color: 0xd9a860, roughness: 0.85 });
  var matFish = new THREE.MeshStandardMaterial({ color: 0xc7d3dc, roughness: 0.35, metalness: 0.6 });

  function tube(a, b, r, mat, seg) {
    var dir = V3(0, 0, 0).subVectors(b, a);
    var len = dir.length();
    var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg || 12), mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(V3(0, 1, 0), dir.normalize());
    m.castShadow = true;
    return m;
  }

  /* ---- 轮子 ---- */
  function wheel() {
    var g = new THREE.Group();
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.030, 9, 40), matMetal);
    rim.castShadow = true; g.add(rim);
    var tire = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.046, 9, 44), matTire);
    tire.castShadow = true; g.add(tire);
    for (var i = 0; i < 14; i++) {
      var a = (i / 14) * Math.PI * 2;
      var sp = tube(V3(0, 0, 0), V3(Math.cos(a) * 0.29, Math.sin(a) * 0.29, 0), 0.0065, matMetal, 5);
      g.add(sp);
    }
    var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.13, 12), matMetal);
    hub.rotation.z = Math.PI / 2; hub.castShadow = true; g.add(hub);
    /* 挡泥板 */
    var guard = new THREE.Mesh(new THREE.TorusGeometry(0.355, 0.022, 7, 22, Math.PI * 0.75), frameMat);
    guard.rotation.z = Math.PI * 0.625;
    guard.castShadow = true; g.add(guard);
    return g;
  }
  wheelR = wheel(); wheelR.position.set(0, 0.335, 0.44); bike.add(wheelR);
  wheelF = wheel(); wheelF.position.set(0, 0.335, -0.44); steerGroup.add(wheelF);

  /* ---- 关键点 ---- */
  var bb = V3(0, 0.40, 0.07);
  var rear = V3(0, 0.335, 0.44);
  var front = V3(0, 0.335, -0.44);
  var seatC = V3(0, 0.80, 0.42);
  var headT = V3(0, 0.92, -0.34);
  var headB = V3(0, 0.72, -0.27);

  /* ---- 车架 ---- */
  bike.add(tube(bb, headB, 0.036, frameMat));                       // 下管
  bike.add(tube(bb, seatC, 0.034, frameMat));                       // 座管
  bike.add(tube(seatC, headT, 0.036, frameMat));                    // 上管
  bike.add(tube(headB, headT, 0.05, frameMat));                     // 头管
  bike.add(tube(V3(0, 0.92, -0.345), V3(0, 1.0, -0.30), 0.032, matMetal)); // 把立
  [-1, 1].forEach(function (s) {
    bike.add(tube(V3(s * 0.05, 0.40, 0.07), V3(s * 0.05, 0.335, 0.44), 0.024, frameMat)); // 后下叉
    bike.add(tube(V3(s * 0.045, 0.85, 0.395), V3(s * 0.05, 0.335, 0.44), 0.022, frameMat)); // 后上叉
    steerGroup.add(tube(V3(s * 0.045, -0.085, 0.038), V3(s * 0.045, -0.465, -0.13), 0.024, matMetal)); // 前叉
  });

  /* 车把 */
  var bar = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.5, 10), matMetal);
  bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.205, 0.01); bar.castShadow = true;
  steerGroup.add(bar);
  [-1, 1].forEach(function (s) {
    var grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.12, 10), matGrip);
    grip.rotation.z = Math.PI / 2; grip.position.set(s * 0.22, 0.205, 0.01);
    grip.castShadow = true; steerGroup.add(grip);
  });

  /* 坐垫 */
  var saddle = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), matDark);
  saddle.scale.set(0.75, 0.32, 1.25); saddle.position.set(0, 0.80, 0.42);
  saddle.castShadow = true; bike.add(saddle);

  /* 牙盘 + 曲柄 + 脚踏 */
  var ring = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.016, 22), matMetal);
  ring.rotation.z = Math.PI / 2; ring.position.copy(bb); bike.add(ring);
  var cog = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 16), matMetal);
  cog.rotation.z = Math.PI / 2; cog.position.copy(rear); bike.add(cog);

  crankG = new THREE.Group();
  crankG.position.copy(bb);
  bike.add(crankG);
  [-1, 1].forEach(function (s) {
    var arm = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.15), matMetal);
    arm.position.set(s * 0.05, s * 0.075, 0); arm.castShadow = true;
    crankG.add(arm);
    var pedal = new THREE.Group();
    var plat = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.022, 0.15), matDark);
    plat.castShadow = true; pedal.add(plat);
    pedal.position.set(s * 0.075, s * 0.15, 0);
    crankG.add(pedal);
    if (s > 0) pedalR = pedal; else pedalL = pedal;
  });

  /* 链条（上下两股） */
  bike.add(tube(V3(0.078, 0.51, 0.07), V3(0.078, 0.395, 0.44), 0.012, matDark, 6));
  bike.add(tube(V3(0.078, 0.29, 0.07), V3(0.078, 0.275, 0.44), 0.012, matDark, 6));

  /* 水壶 */
  var bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.17, 10),
    new THREE.MeshStandardMaterial({ color: 0x2fb8a6, roughness: 0.4 }));
  bottle.position.set(0.055, 0.55, -0.02); bottle.rotation.x = -0.5; bike.add(bottle);

  /* 前筐 + 鱼 */
  basketGroup = new THREE.Group();
  basketGroup.position.set(0, 0.0, -0.21);
  var w = 0.44, d = 0.34, h = 0.24, t = 0.022;
  [[0, h / 2, d / 2, w, t], [0, h / 2, -d / 2, w, t], [w / 2, h / 2, 0, t, d], [-w / 2, h / 2, 0, t, d], [0, 0, 0, w, t]].forEach(function (p, i) {
    var panel = new THREE.Mesh(new THREE.BoxGeometry(i === 4 ? w : p[3], i === 4 ? d : h, i === 4 ? d : p[4]), matWicker);
    panel.position.set(p[0], i === 4 ? t : p[1], i === 4 ? 0 : p[2]);
    panel.castShadow = true;
    basketGroup.add(panel);
  });
  steerGroup.add(basketGroup);
  fishGroup = new THREE.Group();
  var body = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 9), matFish);
  body.scale.set(0.62, 0.92, 1.5); fishGroup.add(body);
  var tail = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.13, 4), matFish);
  tail.rotation.x = -Math.PI / 2; tail.position.z = 0.16; tail.scale.set(1, 1, 0.4); fishGroup.add(tail);
  fishGroup.position.set(0.02, 0.16, 0);
  fishGroup.rotation.z = 0.25;
  basketGroup.add(fishGroup);

  /* 车铃 */
  bellGroup = new THREE.Group();
  var dome = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.3, metalness: 0.8 }));
  dome.castShadow = true; bellGroup.add(dome);
  var base = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.02, 12),
    new THREE.MeshStandardMaterial({ color: 0x3c4652, roughness: 0.4, metalness: 0.7 }));
  base.position.y = -0.005; bellGroup.add(base);
  var striker = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), matMetal);
  striker.position.set(0, 0.02, 0.05); bellGroup.add(striker);
  bellGroup.position.set(0.13, 0.245, 0.04);
  steerGroup.add(bellGroup);
  bike.userData.striker = striker;

  /* ---- 车灯：夜间前灯 + 尾灯 ---- */
  headLight = new THREE.SpotLight(0xfff0c8, 0, 17, 0.46, 0.6, 1.05);
  headLight.position.set(0, 0.62, -0.42);
  bike.add(headLight);
  var hlTarget = new THREE.Object3D();
  hlTarget.position.set(0, -0.30, -7.5);
  bike.add(hlTarget);
  headLight.target = hlTarget;
  var matLens = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe9a8, emissiveIntensity: 0.04, roughness: 0.25 });
  var lens = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 9), matLens);
  lens.position.set(0, 0.62, -0.46);
  bike.add(lens);
  bike.userData.lens = lens;
  beamMesh = new THREE.Mesh(new THREE.ConeGeometry(0.62, 4.6, 22, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe3a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beamMesh.rotation.x = -Math.PI / 2;
  beamMesh.position.set(0, 0.62, -0.42 - 2.3);
  bike.add(beamMesh);
  var tailLens = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xff3b2a, emissiveIntensity: 0.05, roughness: 0.4 }));
  tailLens.position.set(0, 0.74, 0.52);
  bike.add(tailLens);
  bike.userData.tailLens = tailLens;
}

/* ---------------- 通用段（骨头）工具 ---------------- */
var _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), UP = V3(0, 1, 0), FWD = V3(0, 0, -1);
function makeSegment(r, mat, seg) {
  var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, seg || 8), mat);
  m.castShadow = true;
  return m;
}
function aimSegment(m, a, b) {
  _v.subVectors(b, a);
  var len = Math.max(_v.length(), 1e-4);
  m.position.copy(a).addScaledVector(_v, 0.5);
  m.scale.set(1, len, 1);
  m.quaternion.setFromUnitVectors(UP, _v.normalize());
}

/* ---------------- 鹈鹕 ---------------- */
var bird = null, capMat, scarfMat, beakMat, pouchMat;
function buildPelican() {
  var root = new THREE.Group();
  root.position.set(0, 0.95, 0.40);
  root.rotation.x = -0.12;
  scene.add(root);

  var matWhite = new THREE.MeshStandardMaterial({ color: 0xf7f4ec, roughness: 0.78 });
  var matWhite2 = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.8 });
  var matGray = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.85 });
  var matOrange = new THREE.MeshStandardMaterial({ color: 0xe98a2e, roughness: 0.6 });
  var matDark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5 });
  var beakMat = new THREE.MeshStandardMaterial({ color: 0xf5c95c, roughness: 0.45 });
  pouchMat = new THREE.MeshStandardMaterial({ color: 0xf0992f, roughness: 0.55, transparent: true, opacity: 0.96 });
  capMat = new THREE.MeshStandardMaterial({ color: LIVERY[0].frame, roughness: 0.5 });
  scarfMat = new THREE.MeshStandardMaterial({ color: 0xe9523f, roughness: 0.85 });
  var trimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });

  /* ---- 身体 ---- */
  var body = new THREE.Group();
  root.add(body);
  var torso = new THREE.Mesh(new THREE.SphereGeometry(0.28, 26, 20), matWhite);
  torso.scale.set(1.02, 0.94, 1.24);
  torso.position.set(0, 0.05, 0.03);
  torso.castShadow = true;
  body.add(torso);
  var chest = new THREE.Mesh(new THREE.SphereGeometry(0.20, 18, 14), matWhite);
  chest.scale.set(1.0, 0.95, 1.05);
  chest.position.set(0, 0.015, -0.20);
  chest.castShadow = true;
  body.add(chest);
  /* 羽毛层次 */
  for (var r = 0; r < 3; r++) {
    for (var c = 0; c < 2; c++) {
      var f = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 9), r % 2 ? matWhite2 : matWhite);
      f.scale.set(1.0, 0.30, 0.85);
      f.position.set(c ? 0.15 : -0.15, 0.14 - r * 0.075, 0.02 + r * 0.115);
      f.rotation.z = c ? -0.22 : 0.22;
      f.castShadow = true;
      body.add(f);
    }
  }
  /* 肚子 */
  var belly = new THREE.Mesh(new THREE.SphereGeometry(0.23, 18, 14), matWhite2);
  belly.scale.set(0.92, 0.62, 1.1);
  belly.position.set(0, -0.06, 0.04);
  body.add(belly);

  /* ---- 脖子（3 段骨架） ---- */
  var neckMat = matWhite;
  var nSegs = [makeSegment(0.082, neckMat, 10), makeSegment(0.072, neckMat, 10), makeSegment(0.062, neckMat, 10)];
  nSegs.forEach(function (s) { root.add(s); });

  /* ---- 头 ---- */
  var head = new THREE.Group();
  head.position.set(0, 0.62, -0.32);
  root.add(head);
  var skull = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 16), matWhite);
  skull.castShadow = true;
  head.add(skull);
  var cheek = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), matWhite);
  cheek.scale.set(1.05, 0.9, 1.0);
  cheek.position.set(0, -0.03, -0.03);
  head.add(cheek);

  /* 上喙 */
  var beak = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.020, 0.40, 9), beakMat);
  beak.geometry.translate(0, 0.20, 0);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.018, -0.085);
  beak.castShadow = true;
  head.add(beak);
  var tip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.09, 7), beakMat);
  tip.geometry.translate(0, 0.045, 0);
  tip.rotation.x = -Math.PI / 2 - 0.25;
  tip.position.set(0, 0.012, -0.465);
  head.add(tip);
  /* 喉囊 */
  var pouch = new THREE.Mesh(new THREE.SphereGeometry(0.068, 16, 12), pouchMat);
  pouch.scale.set(0.92, 0.62, 1.0);
  pouch.position.set(0, -0.062, -0.215);
  pouch.castShadow = true;
  head.add(pouch);
  var throat = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), pouchMat);
  throat.scale.set(1.0, 0.85, 0.9);
  throat.position.set(0, -0.072, -0.10);
  head.add(throat);

  /* 眼睛 */
  [-1, 1].forEach(function (s) {
    var white = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), trimMat);
    white.position.set(s * 0.068, 0.05, -0.095);
    head.add(white);
    var pupil = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), matDark);
    pupil.position.set(s * 0.075, 0.052, -0.118);
    head.add(pupil);
    var glint = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 }));
    glint.position.set(s * 0.08, 0.058, -0.13);
    head.add(glint);
  });

  /* 骑行帽 */
  var cap = new THREE.Mesh(new THREE.SphereGeometry(0.132, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
  cap.position.set(0, 0.045, 0.005);
  cap.castShadow = true;
  head.add(cap);
  var brim = new THREE.Mesh(new THREE.SphereGeometry(0.10, 16, 10), capMat);
  brim.scale.set(0.86, 0.15, 1.35);
  brim.position.set(0, 0.036, -0.115);
  brim.rotation.x = 0.10;
  brim.castShadow = true;
  head.add(brim);
  var stripe = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.13),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
  stripe.position.set(0, 0.155, -0.01);
  head.add(stripe);

  /* ---- 翅膀 ---- */
  function feather(len, w, mat) {
    var g = new THREE.BoxGeometry(w, 0.016, len);
    g.translate(0, 0, len / 2);
    var m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    return m;
  }
  function buildWing(side) {
    var w = new THREE.Group();
    w.position.set(side * 0.235, 0.135, 0.0);
    var shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 9), matWhite);
    shoulder.scale.set(0.8, 0.9, 1.3);
    w.add(shoulder);
    /* 覆羽 */
    for (var i = 0; i < 5; i++) {
      var f = feather(0.20 + i * 0.012, 0.085, matWhite2);
      f.position.set(0, 0.02, -0.02 + i * 0.075);
      f.rotation.y = side * (-0.16 + i * 0.08);
      f.rotation.x = -0.12;
      w.add(f);
    }
    /* 飞羽 */
    for (var j = 0; j < 6; j++) {
      var p = feather(0.30 + j * 0.022, 0.10, j > 3 ? matGray : matWhite2);
      p.position.set(0, -0.005, 0.02 + j * 0.075);
      p.rotation.y = side * (-0.10 + j * 0.085);
      p.rotation.x = -0.05 - j * 0.02;
      w.add(p);
    }
    /* 翼尖 */
    for (var k = 0; k < 3; k++) {
      var t = feather(0.40 + k * 0.03, 0.075, matGray);
      t.position.set(0, -0.01, 0.30 + k * 0.06);
      t.rotation.y = side * (0.36 + k * 0.14);
      t.rotation.x = -0.14;
      w.add(t);
    }
    root.add(w);
    return w;
  }
  var wingR = buildWing(1), wingL = buildWing(-1);

  /* ---- 尾羽 ---- */
  var tail = new THREE.Group();
  tail.position.set(0, 0.10, 0.28);
  root.add(tail);
  for (var t2 = 0; t2 < 5; t2++) {
    var tf = feather(0.30 + (t2 % 2) * 0.06, 0.115, t2 % 2 ? matWhite2 : matWhite);
    tf.position.set(0, 0.01, 0.02);
    tf.rotation.y = (t2 - 2) * 0.20;
    tf.rotation.x = 0.30 + Math.abs(t2 - 2) * 0.05;
    tail.add(tf);
  }

  /* ---- 围巾 ---- */
  var collar = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.030, 8, 22), scarfMat);
  collar.position.set(0, 0.205, -0.115);
  collar.rotation.x = Math.PI / 2 - 0.25;
  collar.castShadow = true;
  root.add(collar);
  var scarfSegs = [];
  var scParent = new THREE.Group();
  scParent.position.set(0, 0.20, -0.10);
  root.add(scParent);
  var cur = scParent;
  for (var s2 = 0; s2 < 7; s2++) {
    var g2 = new THREE.Group();
    var m2 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.016, 0.115), scarfMat);
    m2.position.z = 0.055;
    m2.castShadow = true;
    g2.add(m2);
    cur.add(g2);
    g2.position.z = s2 === 0 ? 0 : 0.115;
    scarfSegs.push(g2);
    cur = g2;
  }


  /* ---- 腿 + 两连杆 IK ---- */
  var legs = [];
  [-1, 1].forEach(function (side) {
    var hip = V3(side * 0.105, -0.05, -0.10);
    var thigh = makeSegment(0.036, matOrange, 8);
    var shin = makeSegment(0.028, matOrange, 8);
    var knee = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), matOrange);
    var ankle = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), matOrange);
    root.add(thigh); root.add(shin); root.add(knee); root.add(ankle);
    /* 蹼足：挂在脚踏上，随脚踏保持水平 */
    var pedal = side > 0 ? pedalR : pedalL;
    var footG = new THREE.Group();
    var sole = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.024, 0.15), matOrange);
    sole.position.set(0, 0.012, -0.02); sole.castShadow = true;
    footG.add(sole);
    for (var q = -1; q <= 1; q++) {
      var toe = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.014, 0.075), matOrange);
      toe.position.set(q * 0.028, 0.008, -0.115);
      toe.rotation.y = q * 0.22;
      footG.add(toe);
    }
    footG.position.set(side * 0.075, 0.026, 0);
    pedal.add(footG);
    legs.push({ side: side, hip: hip, thigh: thigh, shin: shin, knee: knee, ankle: ankle, l1: 0.32, l2: 0.35, foot: footG });
  });

  bird = {
    root: root, body: body, head: head, skull: skull,
    neck: nSegs, neckJoints: [V3(0, 0.20, -0.14), V3(0, 0, 0), V3(0, 0, 0), V3(0, 0, 0)],
    wingL: wingL, wingR: wingR, tail: tail,
    scarfSegs: scarfSegs, legs: legs,
    capMat: capMat, scarfMat: scarfMat, pouchMat: pouchMat
  };
}
