/* Pelican Velocity — standalone procedural Three.js experience */
(() => {
  'use strict';

  const $ = (q) => document.querySelector(q);
  const $$ = (q) => [...document.querySelectorAll(q)];
  const clamp = THREE.MathUtils.clamp;
  const lerp = THREE.MathUtils.lerp;
  const damp = (a, b, lambda, dt) => THREE.MathUtils.damp(a, b, lambda, dt);

  const ui = {
    canvas: $('#scene'), loader: $('#loader'), loaderBar: $('.loader-line i'), loaderText: $('.loader p span'),
    speed: $('#speedValue'), speedArc: $('#speedArc'), speedSlider: $('#speedSlider'), speedOutput: $('#speedOutput'),
    sunSlider: $('#sunSlider'), sunOutput: $('#sunOutput'), lap: $('#lapTime'), distance: $('#distanceValue'),
    combo: $('#comboValue'), heading: $('#headingValue'), fps: $('#fpsValue'), status: $('#statusText'),
    live: $('#liveState'), boost: $('#boostMeter i'), boostValue: $('#boostMeter b'), ride: $('#rideBtn'),
    sound: $('#soundBtn'), photo: $('#photoBtn'), panel: $('#controlPanel'), panelBtn: $('#panelBtn'),
    motion: $('#motionToggle'), lights: $('#lightsToggle'), toast: $('#toast')
  };

  if (!window.THREE) {
    document.body.innerHTML = '<div style="padding:40px;color:white;font-family:sans-serif">3D 引擎加载失败，请刷新页面。</div>';
    return;
  }

  const state = {
    running: true,
    started: false,
    t: 0.08,
    speed: 18,
    targetSpeed: 18,
    lateral: 0,
    targetLateral: 0,
    vertical: 0,
    verticalVelocity: 0,
    jumpCooldown: 0,
    boost: 100,
    boosting: false,
    lapStart: performance.now(),
    lapCount: 0,
    distance: 0,
    combo: 1,
    cameraMode: 'chase',
    cameraIndex: 0,
    cameraYaw: 0.05,
    cameraPitch: 0.12,
    cameraZoom: 1,
    sun: 0.34,
    neon: true,
    motion: true,
    pointerDown: false,
    pointerMoved: false,
    pointerX: 0,
    pointerY: 0,
    wingBurst: 0,
    photoFlash: 0,
    key: Object.create(null)
  };

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0b3040, 0.0064);

  const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 650);
  camera.position.set(10, 7, 14);

  const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.physicallyCorrectLights = true;

  const clock = new THREE.Clock();
  const world = new THREE.Group();
  scene.add(world);

  const palette = {
    cream: 0xe9e2c9, white: 0xf5f2df, feather: 0xc7c1a9, darkFeather: 0x303b42,
    beak: 0xf5a45a, pouch: 0xea704b, black: 0x071014, tire: 0x111820,
    metal: 0x93a9ab, cyan: 0x78ffe1, cyanDeep: 0x14a993, orange: 0xff7849,
    road: 0x27323a, sand: 0xb9a878, water: 0x0b6478, navy: 0x07131e
  };

  const mat = {
    cream: new THREE.MeshStandardMaterial({ color: palette.cream, roughness: .78, metalness: .02 }),
    white: new THREE.MeshStandardMaterial({ color: palette.white, roughness: .7 }),
    feather: new THREE.MeshStandardMaterial({ color: palette.feather, roughness: .88 }),
    darkFeather: new THREE.MeshStandardMaterial({ color: palette.darkFeather, roughness: .86 }),
    beak: new THREE.MeshStandardMaterial({ color: palette.beak, roughness: .63 }),
    pouch: new THREE.MeshStandardMaterial({ color: palette.pouch, roughness: .75 }),
    black: new THREE.MeshStandardMaterial({ color: palette.black, roughness: .58, metalness: .15 }),
    tire: new THREE.MeshStandardMaterial({ color: palette.tire, roughness: .82 }),
    metal: new THREE.MeshStandardMaterial({ color: palette.metal, roughness: .28, metalness: .86 }),
    bike: new THREE.MeshStandardMaterial({ color: palette.cyanDeep, roughness: .28, metalness: .78 }),
    bikeGlow: new THREE.MeshStandardMaterial({ color: palette.cyan, emissive: palette.cyan, emissiveIntensity: 2.1, roughness: .25 }),
    orangeGlow: new THREE.MeshStandardMaterial({ color: palette.orange, emissive: palette.orange, emissiveIntensity: 2.5, roughness: .3 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9ad9dd, transmission: .35, transparent: true, opacity: .68, roughness: .12, metalness: .05 }),
    sand: new THREE.MeshStandardMaterial({ color: palette.sand, roughness: 1 }),
    road: new THREE.MeshStandardMaterial({ color: palette.road, roughness: .9, metalness: .03 }),
    roadEdge: new THREE.MeshStandardMaterial({ color: 0x53636b, roughness: .64, metalness: .18 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x204e43, roughness: .92 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x6a4c34, roughness: 1 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x52636a, roughness: 1 })
  };

  function shadows(obj, cast = true, receive = true) {
    obj.traverse((c) => {
      if (c.isMesh) { c.castShadow = cast; c.receiveShadow = receive; }
    });
    return obj;
  }

  function mesh(geometry, material, pos, rot, scale) {
    const m = new THREE.Mesh(geometry, material);
    if (pos) m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    if (scale) m.scale.set(...scale);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  function cylinderBetween(a, b, radius, material, radial = 8) {
    const start = a.clone ? a : new THREE.Vector3(...a);
    const end = b.clone ? b : new THREE.Vector3(...b);
    const mid = start.clone().add(end).multiplyScalar(.5);
    const len = start.distanceTo(end);
    const c = mesh(new THREE.CylinderGeometry(radius, radius, len, radial), material);
    c.position.copy(mid);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
    return c;
  }

  function roundedBox(w, h, d, r, material) {
    const shape = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
    shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
    shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: r * .38, bevelThickness: r * .38 });
    g.center();
    return mesh(g, material);
  }

  // Lighting
  const hemi = new THREE.HemisphereLight(0xa5ddff, 0x20362f, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd0a2, 4.2);
  sun.position.set(-38, 46, -22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -75; sun.shadow.camera.right = 75; sun.shadow.camera.top = 65; sun.shadow.camera.bottom = -65;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 145;
  sun.shadow.bias = -0.00035;
  scene.add(sun);
  const rimLight = new THREE.DirectionalLight(0x54dfff, 1.15);
  rimLight.position.set(40, 22, 24);
  scene.add(rimLight);

  // Procedural sky
  const skyUniforms = {
    topColor: { value: new THREE.Color(0x071829) },
    midColor: { value: new THREE.Color(0x27667c) },
    horizonColor: { value: new THREE.Color(0xf1956b) },
    bottomColor: { value: new THREE.Color(0x06121b) },
    sunDir: { value: new THREE.Vector3(-.6, .25, -.5).normalize() },
    time: { value: 0 }
  };
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: skyUniforms,
    vertexShader: `varying vec3 vWorld; void main(){ vec4 p=modelMatrix*vec4(position,1.); vWorld=normalize(p.xyz-cameraPosition); gl_Position=projectionMatrix*viewMatrix*p; }`,
    fragmentShader: `
      uniform vec3 topColor,midColor,horizonColor,bottomColor,sunDir; uniform float time; varying vec3 vWorld;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){
        float h=normalize(vWorld).y;
        vec3 c=mix(bottomColor,horizonColor,smoothstep(-.22,.03,h));
        c=mix(c,midColor,smoothstep(.01,.28,h)); c=mix(c,topColor,smoothstep(.24,.82,h));
        float sd=max(dot(normalize(vWorld),sunDir),0.);
        c+=vec3(1.,.48,.22)*pow(sd,340.)*5.; c+=vec3(1.,.32,.14)*pow(sd,18.)*.35;
        float stars=step(.9975,hash(floor(vWorld.xz*700.)))*smoothstep(.25,.8,h);
        c+=stars*vec3(.6,.8,1.)*(.35+.25*sin(time*2.+vWorld.x*500.));
        gl_FragColor=vec4(c,1.);
      }`
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(310, 48, 30), skyMat));

  // Ocean
  const oceanUniforms = {
    time: { value: 0 }, deep: { value: new THREE.Color(0x053246) }, shallow: { value: new THREE.Color(0x1590a0) },
    sunColor: { value: new THREE.Color(0xffb073) }, sunDir: skyUniforms.sunDir
  };
  const oceanMat = new THREE.ShaderMaterial({
    uniforms: oceanUniforms, transparent: false, side: THREE.DoubleSide,
    vertexShader: `
      uniform float time; varying float vWave; varying vec3 vPos;
      void main(){ vec3 p=position; float w=sin(p.x*.16+time*1.1)*.22+sin(p.y*.23-time*1.45)*.15+sin((p.x+p.y)*.07+time*.55)*.3; p.z+=w; vWave=w; vec4 wp=modelMatrix*vec4(p,1.); vPos=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `
      uniform float time; uniform vec3 deep,shallow,sunColor,sunDir; varying float vWave; varying vec3 vPos;
      void main(){ float bands=.5+.5*sin(vPos.x*.65+vPos.z*.42+time*1.3); float fres=pow(1.-abs(vWave),2.); vec3 c=mix(deep,shallow,.34+vWave*.65); c+=bands*.025; float glint=pow(max(dot(normalize(vec3(.2,1.,.25)),sunDir),0.),10.); c+=sunColor*glint*.08+fres*.025; gl_FragColor=vec4(c,1.); }`
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(500, 500, 90, 90), oceanMat);
  ocean.rotation.x = -Math.PI / 2; ocean.position.y = -1.05; ocean.receiveShadow = true;
  world.add(ocean);

  // Main island and track
  const island = mesh(new THREE.CylinderGeometry(67, 73, 3.1, 96), mat.sand, [0, -1.6, 0]);
  island.scale.z = .73;
  island.receiveShadow = true;
  world.add(island);

  const RX = 49, RZ = 27, TRACK_HALF = 4.2;
  function ellipseShape(rx, rz) {
    const s = new THREE.Shape();
    s.absellipse(0, 0, rx, rz, 0, Math.PI * 2, false, 0);
    return s;
  }
  const roadShape = ellipseShape(RX + TRACK_HALF, RZ + TRACK_HALF);
  const roadHole = new THREE.Path();
  roadHole.absellipse(0, 0, RX - TRACK_HALF, RZ - TRACK_HALF, 0, Math.PI * 2, true, 0);
  roadShape.holes.push(roadHole);
  const track = mesh(new THREE.ShapeGeometry(roadShape, 128), mat.road, [0, .08, 0], [-Math.PI / 2, 0, 0]);
  track.receiveShadow = true; track.castShadow = false;
  world.add(track);

  function ellipseCurve(rx, rz, y = .13) {
    const pts = [];
    for (let i = 0; i < 129; i++) {
      const a = i / 128 * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * rx, y, Math.sin(a) * rz));
    }
    return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  }
  [RX - TRACK_HALF + .25, RX + TRACK_HALF - .25].forEach((rx, idx) => {
    const rz = RZ + (rx - RX);
    const edge = mesh(new THREE.TubeGeometry(ellipseCurve(rx, rz), 160, .11, 5, true), idx ? mat.orangeGlow : mat.bikeGlow);
    edge.castShadow = false; world.add(edge);
  });

  // Dashed center markings
  for (let i = 0; i < 64; i += 2) {
    const a = i / 64 * Math.PI * 2;
    const p = new THREE.Vector3(Math.cos(a) * RX, .16, Math.sin(a) * RZ);
    const tangent = new THREE.Vector3(-Math.sin(a) * RX, 0, Math.cos(a) * RZ).normalize();
    const dash = mesh(new THREE.BoxGeometry(.16, .025, 1.25), new THREE.MeshStandardMaterial({ color: 0xbcd2ce, roughness: .8 }), [p.x, p.y, p.z]);
    dash.rotation.y = Math.atan2(tangent.x, tangent.z);
    dash.castShadow = false; world.add(dash);
  }

  // Start gate
  const gate = new THREE.Group();
  gate.position.set(RX, .1, 0);
  gate.rotation.y = Math.PI / 2;
  gate.add(cylinderBetween([-4.8, 0, 0], [-4.8, 6.6, 0], .2, mat.metal));
  gate.add(cylinderBetween([4.8, 0, 0], [4.8, 6.6, 0], .2, mat.metal));
  gate.add(cylinderBetween([-4.8, 6.45, 0], [4.8, 6.45, 0], .2, mat.metal));
  const gateSign = roundedBox(4.8, 1.05, .18, .14, mat.black);
  gateSign.position.y = 6.4;
  gate.add(gateSign);
  const gateGlow = roundedBox(3.8, .11, .22, .04, mat.bikeGlow);
  gateGlow.position.set(0, 6.38, -.13); gate.add(gateGlow);
  world.add(shadows(gate));

  // Scenery: palms, rocks, pylons and flags
  const environmental = new THREE.Group();
  world.add(environmental);

  function createPalm(seed = 0) {
    const g = new THREE.Group();
    const trunk = mesh(new THREE.CylinderGeometry(.25, .42, 5.5, 7), mat.trunk, [0, 2.5, 0], [0, 0, (seed % 3 - 1) * .05]);
    g.add(trunk);
    for (let i = 0; i < 7; i++) {
      const leaf = mesh(new THREE.ConeGeometry(.38, 3.9, 5), mat.leaf);
      leaf.position.set(0, 5.4, 0);
      leaf.rotation.z = Math.PI / 2.5;
      leaf.rotation.y = i / 7 * Math.PI * 2 + seed;
      leaf.scale.set(1, 1, .35);
      g.add(leaf);
    }
    g.scale.setScalar(.72 + (seed % 4) * .08);
    return g;
  }

  for (let i = 0; i < 19; i++) {
    const a = i / 19 * Math.PI * 2 + .12;
    const radius = i % 3 === 0 ? 61 : 59;
    const palm = createPalm(i * .31);
    palm.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius * .72);
    palm.rotation.y = -a + (i % 2) * .3;
    environmental.add(shadows(palm));
  }

  for (let i = 0; i < 42; i++) {
    const a = i * 2.39996;
    const r = 19 + (i * 17 % 23);
    const rock = mesh(new THREE.DodecahedronGeometry(.65 + (i % 5) * .16, 0), mat.rock,
      [Math.cos(a) * r, -.15, Math.sin(a) * r * .65], [i * .13, i * .27, 0], [1.4, .65, 1]);
    environmental.add(rock);
  }

  const neonLights = [];
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2;
    const rX = RX + (i % 2 ? 8 : -8), rZ = RZ + (i % 2 ? 7 : -7);
    const pylon = new THREE.Group();
    pylon.position.set(Math.cos(a) * rX, .1, Math.sin(a) * rZ);
    const pole = mesh(new THREE.CylinderGeometry(.055, .09, 3.5, 6), mat.metal, [0, 1.75, 0]);
    const glow = mesh(new THREE.CylinderGeometry(.12, .12, 1.25, 8), i % 3 ? mat.bikeGlow : mat.orangeGlow, [0, 3.3, 0]);
    const light = new THREE.PointLight(i % 3 ? palette.cyan : palette.orange, 1.4, 8, 2);
    light.position.y = 3.25;
    pylon.add(pole, glow, light);
    neonLights.push({ glow, light });
    environmental.add(pylon);
  }

  // Distant wind turbines
  const turbines = [];
  for (let i = 0; i < 5; i++) {
    const t = new THREE.Group();
    t.position.set(-90 + i * 34, -1, -68 - (i % 2) * 12);
    t.add(mesh(new THREE.CylinderGeometry(.22, .55, 17, 8), mat.white, [0, 8.5, 0]));
    const hub = mesh(new THREE.SphereGeometry(.45, 12, 8), mat.metal, [0, 17, 0]);
    const rotor = new THREE.Group(); rotor.position.set(0, 17, .1);
    for (let b = 0; b < 3; b++) {
      const blade = mesh(new THREE.BoxGeometry(.18, 5.5, .09), mat.white, [0, 2.7, 0]);
      blade.geometry.translate(0, 2.5, 0);
      blade.rotation.z = b * Math.PI * 2 / 3;
      rotor.add(blade);
    }
    t.add(hub, rotor); turbines.push(rotor); world.add(t);
  }

  // Clouds
  const clouds = [];
  for (let i = 0; i < 13; i++) {
    const c = new THREE.Group();
    const cloudMat = new THREE.MeshBasicMaterial({ color: i % 2 ? 0xd2e7e4 : 0xffcfbb, transparent: true, opacity: .17, depthWrite: false });
    for (let j = 0; j < 5; j++) {
      c.add(mesh(new THREE.SphereGeometry(2.2 + (j % 3), 12, 8), cloudMat, [(j - 2) * 2.3, Math.sin(j) * .8, j % 2], null, [1.5, .65, 1]));
    }
    c.position.set((i * 37 % 160) - 80, 25 + (i % 4) * 7, -90 + (i * 23 % 100));
    c.scale.setScalar(.75 + (i % 3) * .28); clouds.push(c); scene.add(c);
  }

  // Bicycle
  const vehicle = new THREE.Group();
  vehicle.name = 'PelicanRider';
  world.add(vehicle);

  const bike = new THREE.Group();
  vehicle.add(bike);
  const wheelRadius = 1.18;
  const wheelGroups = [];

  function createWheel(z) {
    const wheel = new THREE.Group();
    wheel.position.set(0, 1.23, z);
    const tire = mesh(new THREE.TorusGeometry(wheelRadius, .095, 10, 40), mat.tire, null, [0, Math.PI / 2, 0]);
    const rim = mesh(new THREE.TorusGeometry(wheelRadius * .88, .035, 8, 36), mat.metal, null, [0, Math.PI / 2, 0]);
    wheel.add(tire, rim);
    const hub = mesh(new THREE.CylinderGeometry(.11, .11, .34, 12), mat.metal, null, [0, 0, Math.PI / 2]);
    wheel.add(hub);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const end = new THREE.Vector3(0, Math.cos(a) * wheelRadius * .86, Math.sin(a) * wheelRadius * .86);
      wheel.add(cylinderBetween(new THREE.Vector3(0, 0, 0), end, .009, mat.metal, 4));
    }
    const reflector = mesh(new THREE.BoxGeometry(.035, .13, .22), mat.orangeGlow, [0, .55, .55]);
    wheel.add(reflector);
    wheelGroups.push(wheel); bike.add(wheel);
    return wheel;
  }
  const rearWheel = createWheel(-1.55);
  const frontWheel = createWheel(1.55);

  // Bike frame geometry in local x/y/z
  const framePoints = {
    crank: new THREE.Vector3(0, 1.34, -.18), seat: new THREE.Vector3(0, 2.5, -.7), rear: new THREE.Vector3(0, 1.23, -1.55),
    headLow: new THREE.Vector3(0, 1.55, 1.18), headHigh: new THREE.Vector3(0, 2.42, .94), front: new THREE.Vector3(0, 1.23, 1.55)
  };
  [
    ['crank','seat'], ['seat','rear'], ['rear','crank'], ['crank','headLow'], ['headLow','headHigh'], ['headHigh','seat'], ['headLow','front'], ['headHigh','front']
  ].forEach(([a,b], i) => bike.add(cylinderBetween(framePoints[a], framePoints[b], i > 5 ? .055 : .075, i === 3 ? mat.orangeGlow : mat.bike, 10)));

  // Seat, handlebar, drivetrain
  const seat = roundedBox(.48, .12, .52, .08, mat.black); seat.position.set(0, 2.62, -.74); bike.add(seat);
  const stem = cylinderBetween([0, 2.36, .95], [0, 2.85, 1.08], .045, mat.metal); bike.add(stem);
  const handlebar = cylinderBetween([-.55, 2.86, 1.1], [.55, 2.86, 1.1], .055, mat.metal); bike.add(handlebar);
  bike.add(mesh(new THREE.TorusGeometry(.35, .045, 8, 24), mat.metal, [0, 1.34, -.18], [0, Math.PI/2, 0]));
  const chain = mesh(new THREE.TorusGeometry(.45, .018, 4, 40), mat.metal, [.03, 1.34, -.55], [0, Math.PI/2, 0], [1, 1, 2.2]); bike.add(chain);
  const pedalCrank = new THREE.Group(); pedalCrank.position.copy(framePoints.crank); bike.add(pedalCrank);
  pedalCrank.add(cylinderBetween([-.46,0,0],[.46,0,0],.035,mat.metal,8));
  const pedals = [mesh(new THREE.BoxGeometry(.32,.07,.16),mat.black,[-.5,0,0]), mesh(new THREE.BoxGeometry(.32,.07,.16),mat.black,[.5,0,0])];
  pedalCrank.add(...pedals);
  const lampLens = mesh(new THREE.SphereGeometry(.13, 12, 8), mat.bikeGlow, [0, 2.65, 1.35]); bike.add(lampLens);
  const headLamp = new THREE.SpotLight(palette.cyan, 8, 20, .33, .55, 1.5); headLamp.position.set(0,2.65,1.35); headLamp.target.position.set(0,1.2,12); bike.add(headLamp, headLamp.target);

  // Pelican
  const pelican = new THREE.Group();
  pelican.position.set(0, 2.68, -.55);
  vehicle.add(pelican);

  const body = mesh(new THREE.SphereGeometry(1, 26, 18), mat.cream, [0, .85, 0], [0.05,0,0], [.92, 1.18, .88]);
  body.name = 'pelican-body'; pelican.add(body);
  const chest = mesh(new THREE.SphereGeometry(.72, 22, 16), mat.white, [0, .95, .47], [.1,0,0], [.9,1.2,.7]); pelican.add(chest);
  const neck = mesh(new THREE.CylinderGeometry(.38, .58, 1.45, 18), mat.white, [0,1.88,.28], [.22,0,0]); pelican.add(neck);
  const head = mesh(new THREE.SphereGeometry(.62, 24, 16), mat.cream, [0,2.7,.57], [0,0,0], [1,.92,.92]); pelican.add(head);
  const crown = mesh(new THREE.ConeGeometry(.32, .95, 8), mat.cream, [0,3.12,.24], [-.25,0,0]); pelican.add(crown);
  // Long beak points forward (+Z)
  const upperBeak = mesh(new THREE.ConeGeometry(.29, 2.25, 12), mat.beak, [0,2.65,1.77], [Math.PI/2,0,0], [1,.82,1]); pelican.add(upperBeak);
  const pouch = mesh(new THREE.SphereGeometry(.5, 18, 12), mat.pouch, [0,2.38,1.48], [.26,0,0], [.86,.62,1.82]); pelican.add(pouch);
  // Eyes
  [-1,1].forEach((side) => {
    const eyeWhite = mesh(new THREE.SphereGeometry(.135, 14, 10), mat.white, [side*.43,2.82,.92]);
    const pupil = mesh(new THREE.SphereGeometry(.065, 12, 8), mat.black, [side*.48,2.82,1.02]);
    pelican.add(eyeWhite, pupil);
  });

  // Wings, with root groups for animation
  const wings = [];
  [-1,1].forEach((side) => {
    const root = new THREE.Group(); root.position.set(side*.72,1.25,.1); root.rotation.z = side * -.34;
    const upper = mesh(new THREE.SphereGeometry(.62, 18, 12), mat.feather, [side*.38,-.08,.1], [0,0,side*.5], [1.25,.42,.68]);
    const fore = cylinderBetween([side*.65,-.08,.12],[side*1.26,.52,1.35],.19,mat.feather,10);
    const tip = mesh(new THREE.ConeGeometry(.23,.9,7),mat.darkFeather,[side*1.36,.53,1.56],[Math.PI/2,0,side*.12], [.9,1,.62]);
    root.add(upper, fore, tip); pelican.add(root); wings.push(root);
  });

  // Tail feathers
  for (let i = -2; i <= 2; i++) {
    pelican.add(mesh(new THREE.ConeGeometry(.18, 1.05, 6), i%2?mat.darkFeather:mat.cream, [i*.16,.56,-.92], [-Math.PI/2-.25,0,i*.08]));
  }

  // Legs and feet toward pedals
  const legs = [];
  [-1,1].forEach((side) => {
    const leg = new THREE.Group(); leg.position.set(side*.32,.25,.03);
    const thigh = cylinderBetween([0,.22,0],[side*.12,-.55,.28],.09,mat.pouch,8);
    const shin = cylinderBetween([side*.12,-.55,.28],[side*.2,-1.32,.35],.065,mat.pouch,8);
    const foot = mesh(new THREE.BoxGeometry(.18,.08,.42),mat.pouch,[side*.2,-1.35,.48],[0,0,0]);
    leg.add(thigh,shin,foot); pelican.add(leg); legs.push(leg);
  });

  // Helmet and goggles
  const helmet = mesh(new THREE.SphereGeometry(.66, 20, 12, 0, Math.PI*2, 0, Math.PI*.55), mat.bike, [0,2.92,.46], [-.1,0,0], [1.05,.9,1]);
  pelican.add(helmet);
  const visor = mesh(new THREE.BoxGeometry(.92,.18,.14),mat.glass,[0,2.82,1.03],[0,0,0]); pelican.add(visor);
  const helmetStripe = mesh(new THREE.BoxGeometry(.08,.42,.7),mat.orangeGlow,[0,3.2,.42],[-.2,0,0]); pelican.add(helmetStripe);

  shadows(vehicle);

  // Motion streak particles
  const particleCount = 180;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleSeeds = [];
  for (let i = 0; i < particleCount; i++) {
    particlePositions[i*3] = (Math.random()-.5)*3;
    particlePositions[i*3+1] = Math.random()*2.5;
    particlePositions[i*3+2] = -Math.random()*16;
    particleSeeds.push(Math.random());
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions,3));
  const particleMat = new THREE.PointsMaterial({ color: palette.cyan, size: .055, transparent: true, opacity: .46, blending: THREE.AdditiveBlending, depthWrite: false });
  const speedParticles = new THREE.Points(particleGeo, particleMat); speedParticles.position.set(0,1,-2); vehicle.add(speedParticles);

  // Gulls circling above the arena
  const gulls = [];
  for (let i=0;i<11;i++) {
    const g = new THREE.Group();
    const gm = new THREE.MeshBasicMaterial({ color: 0xe8eeee, side: THREE.DoubleSide });
    const left = mesh(new THREE.ConeGeometry(.22,.8,3),gm,[-.28,0,0],[0,0,Math.PI/2]);
    const right = mesh(new THREE.ConeGeometry(.22,.8,3),gm,[.28,0,0],[0,0,-Math.PI/2]);
    g.add(left,right); g.scale.setScalar(.55+(i%3)*.15); gulls.push({g,left,right,phase:i*.7}); scene.add(g);
  }

  // A small flock of fish occasionally breaching near island
  const fish = [];
  for(let i=0;i<6;i++){
    const f=mesh(new THREE.ConeGeometry(.12,.55,7),new THREE.MeshStandardMaterial({color:0x7fc3be,roughness:.55}),null,[Math.PI/2,0,0]);
    fish.push({mesh:f,phase:i*.8}); world.add(f);
  }

  // Camera rig targets
  const lookTarget = new THREE.Vector3();
  const desiredCamera = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const tempVec = new THREE.Vector3();
  const tempQuat = new THREE.Quaternion();

  // Audio engine generated entirely with Web Audio
  let audio = null;
  function initAudio() {
    if (audio) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { toast('当前浏览器不支持声音引擎'); return; }
    const ctx = new Ctx();
    const master = ctx.createGain(); master.gain.value = .18; master.connect(ctx.destination);
    const hum = ctx.createOscillator(); hum.type='triangle'; hum.frequency.value=54;
    const humGain = ctx.createGain(); humGain.gain.value=.045; hum.connect(humGain).connect(master); hum.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value=.16; const lfoGain=ctx.createGain(); lfoGain.gain.value=6; lfo.connect(lfoGain).connect(hum.frequency); lfo.start();
    const buffer=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate); const data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*(.5+.5*Math.sin(i*.013));
    const wind=ctx.createBufferSource(); wind.buffer=buffer; wind.loop=true;
    const filter=ctx.createBiquadFilter(); filter.type='bandpass'; filter.frequency.value=520; filter.Q.value=.5;
    const windGain=ctx.createGain(); windGain.gain.value=.018; wind.connect(filter).connect(windGain).connect(master); wind.start();
    audio={ctx,master,hum,humGain,windGain,filter,enabled:true};
    ui.sound.setAttribute('aria-pressed','true'); ui.sound.setAttribute('aria-label','关闭声音');
    toast('海风声场已开启');
  }
  function toggleAudio(){
    if(!audio){initAudio();return;}
    audio.enabled=!audio.enabled;
    audio.master.gain.setTargetAtTime(audio.enabled?.18:0,audio.ctx.currentTime,.08);
    ui.sound.setAttribute('aria-pressed',String(audio.enabled)); ui.sound.setAttribute('aria-label',audio.enabled?'关闭声音':'开启声音');
    toast(audio.enabled?'声场已开启':'声场已静音');
  }
  function squawk(){
    if(!audio||!audio.enabled)return;
    const o=audio.ctx.createOscillator(), g=audio.ctx.createGain(); o.type='sawtooth'; o.frequency.setValueAtTime(520,audio.ctx.currentTime); o.frequency.exponentialRampToValueAtTime(160,audio.ctx.currentTime+.24);
    g.gain.setValueAtTime(.001,audio.ctx.currentTime);g.gain.exponentialRampToValueAtTime(.14,audio.ctx.currentTime+.025);g.gain.exponentialRampToValueAtTime(.001,audio.ctx.currentTime+.27);o.connect(g).connect(audio.master);o.start();o.stop(audio.ctx.currentTime+.3);
  }

  function toast(message) {
    ui.toast.textContent = message; ui.toast.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(()=>ui.toast.classList.remove('show'),1900);
  }

  function jump() {
    if (state.jumpCooldown > 0 || state.vertical > .05) return;
    state.verticalVelocity = 7.8 + state.speed * .035;
    state.jumpCooldown = .65;
    state.combo = Math.min(9, state.combo + 1);
    state.wingBurst = 1;
    ui.status.textContent = ['羽翼辅助腾跃','潮风起跳！','鹈鹕弹射！'][state.combo%3];
    toast(`AIR COMBO ×${state.combo}`);
    squawk();
  }

  function setCameraMode(mode, announce=true) {
    const modes=['chase','orbit','cinema','pov'];
    if(!modes.includes(mode)) mode='chase';
    state.cameraMode=mode; state.cameraIndex=modes.indexOf(mode);
    $$('.camera-btn').forEach(b=>b.classList.toggle('active',b.dataset.camera===mode));
    if(announce) toast({chase:'追逐镜头',orbit:'自由环绕镜头',cinema:'电影运镜',pov:'车载镜头'}[mode]);
  }

  function updateSun(value) {
    state.sun=value;
    const angle=lerp(-.05,1.2,value);
    const x=-Math.cos(angle)*65, y=Math.sin(angle)*62+2, z=-33;
    sun.position.set(x,y,z);
    skyUniforms.sunDir.value.set(x,y,z).normalize();
    const night=1-smoothstep(.02,.48,value);
    const dusk=1-Math.abs(value-.34)*2.5;
    sun.intensity=lerp(.25,4.6,smoothstep(.03,.65,value));
    hemi.intensity=lerp(.28,1.25,smoothstep(.05,.65,value));
    rimLight.intensity=lerp(1.7,.75,value);
    renderer.toneMappingExposure=lerp(.72,1.12,value);
    scene.fog.color.set(value<.18?0x071a29:(value<.52?0x164151:0x76aeb7));
    skyUniforms.topColor.value.set(value<.16?0x020817:(value<.55?0x071829:0x2f7c9c));
    skyUniforms.midColor.value.set(value<.16?0x101b43:(value<.55?0x27667c:0x72b9c5));
    skyUniforms.horizonColor.value.set(value<.13?0x552b54:(value<.55?0xf1956b:0xb9d8d1));
    neonLights.forEach(n=>n.light.intensity=state.neon?lerp(2.4,.45,value):0);
    ui.sunOutput.textContent=value<.16?'星夜':value<.44?'暮光':value<.75?'晨光':'正午';
    ui.sunSlider.style.setProperty('--fill',`${value*100}%`);
  }
  function smoothstep(min,max,v){ const x=clamp((v-min)/(max-min),0,1); return x*x*(3-2*x); }

  function onResize() {
    camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight,false);
  }

  // Input
  addEventListener('resize',onResize);
  addEventListener('keydown',(e)=>{
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    state.key[e.code]=true;
    if(e.code==='Space'&&!e.repeat) jump();
    if(e.code==='KeyC'&&!e.repeat) setCameraMode(['chase','orbit','cinema','pov'][(state.cameraIndex+1)%4]);
    if(e.code==='KeyP'&&!e.repeat){state.running=!state.running;ui.live.textContent=state.running?'LIVE':'PAUSE';toast(state.running?'继续骑行':'时间已暂停');}
    if(e.code==='KeyL'&&!e.repeat){ui.lights.click();}
    if(e.code==='KeyH'&&!e.repeat) document.body.classList.toggle('minimal-ui');
    if(e.code==='KeyR'&&!e.repeat){state.t=.08;state.distance=0;state.combo=1;toast('赛道状态已重置');}
  });
  addEventListener('keyup',(e)=>state.key[e.code]=false);
  addEventListener('blur',()=>{state.key=Object.create(null);state.boosting=false;});

  ui.canvas.addEventListener('pointerdown',(e)=>{state.pointerDown=true;state.pointerMoved=false;state.pointerX=e.clientX;state.pointerY=e.clientY;ui.canvas.setPointerCapture?.(e.pointerId);});
  ui.canvas.addEventListener('pointermove',(e)=>{
    if(!state.pointerDown)return;
    const dx=e.clientX-state.pointerX,dy=e.clientY-state.pointerY;
    if(Math.abs(dx)+Math.abs(dy)>2)state.pointerMoved=true;
    state.cameraYaw-=dx*.006;state.cameraPitch=clamp(state.cameraPitch+dy*.004,-.18,.7);
    state.pointerX=e.clientX;state.pointerY=e.clientY;
    if(state.cameraMode==='chase'&&state.pointerMoved)setCameraMode('orbit',false);
  });
  ui.canvas.addEventListener('pointerup',(e)=>{
    state.pointerDown=false;
    if(!state.pointerMoved){state.wingBurst=1;squawk();toast('鹈鹕：嘎——出发！');}
  });
  ui.canvas.addEventListener('wheel',(e)=>{state.cameraZoom=clamp(state.cameraZoom+e.deltaY*.0008,.58,1.65);},{passive:true});

  ui.ride.addEventListener('click',()=>{document.body.classList.add('riding');state.started=true;state.targetSpeed=Math.max(state.targetSpeed,25);setCameraMode('chase');initAudio();toast('W / S 加减速 · SPACE 腾跃');});
  ui.sound.addEventListener('click',toggleAudio);
  ui.photo.addEventListener('click',()=>{
    state.photoFlash=1;renderer.render(scene,camera);
    const a=document.createElement('a');a.download=`pelican-velocity-${Date.now()}.png`;a.href=renderer.domElement.toDataURL('image/png');a.click();toast('赛道快照已保存');
  });
  ui.panelBtn.addEventListener('click',()=>{const open=ui.panel.classList.toggle('open');ui.panelBtn.setAttribute('aria-expanded',String(open));});
  ui.speedSlider.addEventListener('input',()=>{const v=+ui.speedSlider.value;state.targetSpeed=lerp(0,54,v/100);ui.speedOutput.value=`${v}%`;ui.speedSlider.style.setProperty('--fill',`${v}%`);});
  ui.sunSlider.addEventListener('input',()=>updateSun(+ui.sunSlider.value/100));
  ui.motion.addEventListener('change',()=>{state.motion=ui.motion.checked;toast(state.motion?'动态效果已开启':'已切换舒缓模式');});
  ui.lights.addEventListener('change',()=>{state.neon=ui.lights.checked;neonLights.forEach(n=>{n.glow.visible=state.neon;n.light.intensity=state.neon?1:0});headLamp.visible=state.neon;toast(state.neon?'霓虹灯已开启':'霓虹灯已关闭');});
  $$('.camera-btn').forEach(b=>b.addEventListener('click',()=>setCameraMode(b.dataset.camera)));

  function holdButton(btn, code){
    const on=(e)=>{e.preventDefault();state.key[code]=true;}; const off=()=>state.key[code]=false;
    btn.addEventListener('pointerdown',on);btn.addEventListener('pointerup',off);btn.addEventListener('pointercancel',off);btn.addEventListener('pointerleave',off);
  }
  holdButton($('#leftBtn'),'KeyA');holdButton($('#rightBtn'),'KeyD');$('#jumpBtn').addEventListener('pointerdown',(e)=>{e.preventDefault();jump();});

  // Animate
  let elapsed=0, fpsFrames=0, fpsStart=performance.now(), lastLapT=state.t;
  const vehiclePos = new THREE.Vector3();

  function updateVehicle(dt, time) {
    const accel=(state.key.KeyW||state.key.ArrowUp)?26:0;
    const brake=(state.key.KeyS||state.key.ArrowDown)?34:0;
    state.boosting=!!(state.key.ShiftLeft||state.key.ShiftRight)&&state.boost>0;
    let desired=state.targetSpeed+accel-brake+(state.boosting?24:0);
    desired=clamp(desired,0,76);
    state.speed=damp(state.speed,desired,state.boosting?3.3:1.8,dt);
    if(state.boosting)state.boost=Math.max(0,state.boost-dt*24); else state.boost=Math.min(100,state.boost+dt*9);
    const steer=(state.key.KeyA||state.key.ArrowLeft?-1:0)+(state.key.KeyD||state.key.ArrowRight?1:0);
    state.targetLateral=clamp(state.targetLateral+steer*dt*5,-2.75,2.75);
    if(!steer)state.targetLateral=damp(state.targetLateral,0,1.45,dt);
    state.lateral=damp(state.lateral,state.targetLateral,5.5,dt);

    const trackLength=245;
    const deltaT=(state.speed/3.6)/trackLength*dt;
    state.t=(state.t+deltaT)%1;
    state.distance+=state.speed/3.6*dt/1000;
    if(state.t<lastLapT-.5){state.lapCount++;state.lapStart=performance.now();toast(`完成第 ${state.lapCount} 圈`);state.combo=Math.min(9,state.combo+1);}
    lastLapT=state.t;

    state.jumpCooldown=Math.max(0,state.jumpCooldown-dt);
    state.verticalVelocity-=14.5*dt;state.vertical+=state.verticalVelocity*dt;
    if(state.vertical<=0){if(state.verticalVelocity< -3&&state.combo>1)ui.status.textContent='平稳落地 · 连击保持';state.vertical=0;state.verticalVelocity=0;}
    state.wingBurst=Math.max(0,state.wingBurst-dt*1.8);

    const a=state.t*Math.PI*2;
    const base=new THREE.Vector3(Math.cos(a)*RX,.27,Math.sin(a)*RZ);
    forward.set(-Math.sin(a)*RX,0,Math.cos(a)*RZ).normalize();
    right.set(forward.z,0,-forward.x);
    vehiclePos.copy(base).addScaledVector(right,state.lateral);vehiclePos.y+=state.vertical;
    vehicle.position.copy(vehiclePos);
    const heading=Math.atan2(forward.x,forward.z);
    vehicle.rotation.y=heading;
    vehicle.rotation.z=damp(vehicle.rotation.z,-steer*.18*(state.speed/50),5,dt);
    vehicle.rotation.x=damp(vehicle.rotation.x,state.vertical>0?-.1*state.verticalVelocity/8:Math.sin(time*3.2)*.006,4,dt);

    const wheelSpin=state.speed/3.6/wheelRadius*dt;
    wheelGroups.forEach(w=>w.rotation.x-=wheelSpin);
    pedalCrank.rotation.x-=wheelSpin*.64;
    const pedalPhase=pedalCrank.rotation.x;
    legs[0].rotation.x=Math.sin(pedalPhase)*.26;legs[1].rotation.x=-Math.sin(pedalPhase)*.26;

    const bob=state.motion?Math.sin(time*(4+state.speed*.05))*.035*(state.speed/35):0;
    pelican.position.y=2.68+bob;
    pelican.rotation.x=.06+Math.sin(time*2.1)*.018-state.speed*.0008;
    const flap=(state.wingBurst>0?Math.sin(time*18)*state.wingBurst*.75:Math.sin(time*2.8)*.035);
    wings[0].rotation.z=-.34-flap;wings[1].rotation.z=.34+flap;
    crown.rotation.z=Math.sin(time*5.5)*.05;
    pouch.scale.y=.62+Math.sin(time*2.3)*.035;

    const positions=particleGeo.attributes.position.array;
    particleMat.opacity=clamp((state.speed-12)/45,0,.62)+(state.boosting?.2:0);
    for(let i=0;i<particleCount;i++){
      positions[i*3+2]-=dt*(6+state.speed*.22)*(0.4+particleSeeds[i]);
      if(positions[i*3+2]<-18){positions[i*3+2]=1;positions[i*3]=(Math.random()-.5)*4;positions[i*3+1]=Math.random()*2.7;}
    }
    particleGeo.attributes.position.needsUpdate=true;

    if(audio){audio.hum.frequency.setTargetAtTime(45+state.speed*1.35,audio.ctx.currentTime,.08);audio.windGain.gain.setTargetAtTime(.008+state.speed*.00055,audio.ctx.currentTime,.1);audio.filter.frequency.setTargetAtTime(330+state.speed*13,audio.ctx.currentTime,.1);}
  }

  function updateCamera(dt,time){
    vehicle.getWorldDirection(tempVec); tempVec.normalize();
    // getWorldDirection follows local +Z for Object3D
    const up=new THREE.Vector3(0,1,0);
    const side=new THREE.Vector3().crossVectors(up,tempVec).normalize();
    const zoom=state.cameraZoom;
    if(state.cameraMode==='chase'){
      desiredCamera.copy(vehiclePos).addScaledVector(tempVec,-10.5*zoom).addScaledVector(side,2.0).add(new THREE.Vector3(0,5.1*zoom,0));
      lookTarget.copy(vehiclePos).addScaledVector(tempVec,5.5).add(new THREE.Vector3(0,2.1,0));
    }else if(state.cameraMode==='pov'){
      desiredCamera.copy(vehiclePos).addScaledVector(tempVec,.55).add(new THREE.Vector3(0,5.45,0));
      lookTarget.copy(vehiclePos).addScaledVector(tempVec,18).add(new THREE.Vector3(0,2.1,0));
    }else if(state.cameraMode==='orbit'){
      const dist=12.5*zoom, yaw=Math.atan2(tempVec.x,tempVec.z)+state.cameraYaw;
      desiredCamera.set(vehiclePos.x+Math.sin(yaw)*dist*Math.cos(state.cameraPitch),vehiclePos.y+4.0+Math.sin(state.cameraPitch)*dist,vehiclePos.z+Math.cos(yaw)*dist*Math.cos(state.cameraPitch));
      lookTarget.copy(vehiclePos).add(new THREE.Vector3(0,2.4,0));
    }else{
      const phase=time*.12;
      const dist=(14+Math.sin(time*.25)*5)*zoom;
      desiredCamera.set(vehiclePos.x+Math.cos(phase)*dist,vehiclePos.y+5.5+Math.sin(time*.32)*2.4,vehiclePos.z+Math.sin(phase)*dist);
      lookTarget.copy(vehiclePos).add(new THREE.Vector3(0,2.1,0));
    }
    camera.position.lerp(desiredCamera,1-Math.exp(-dt*(state.cameraMode==='pov'?9:3.2)));
    const currentLook=tempVec.copy(lookTarget);
    camera.lookAt(currentLook);
    const fovTarget=(state.cameraMode==='pov'?61:48)+(state.speed/76)*5+(state.boosting?6:0);
    camera.fov=damp(camera.fov,fovTarget,4,dt);camera.updateProjectionMatrix();
  }

  function updateWorld(dt,time){
    skyUniforms.time.value=time;oceanUniforms.time.value=time;
    turbines.forEach((r,i)=>r.rotation.z+=dt*(.28+i*.025));
    clouds.forEach((c,i)=>{c.position.x+=dt*(.22+i*.01);if(c.position.x>100)c.position.x=-100;});
    gulls.forEach((o,i)=>{
      const a=time*(.13+i*.004)+o.phase,r=30+(i%5)*8;
      o.g.position.set(Math.cos(a)*r,13+(i%4)*2+Math.sin(time*.8+i),Math.sin(a)*r*.72);
      o.g.rotation.y=-a+Math.PI/2;
      const flap=Math.sin(time*3.5+i)*.42;o.left.rotation.z=Math.PI/2+flap;o.right.rotation.z=-Math.PI/2-flap;
    });
    fish.forEach((o,i)=>{const cycle=(time*.22+o.phase)%5;const a=i*1.05+.4;o.mesh.position.set(Math.cos(a)*69,-.85+Math.max(0,1-Math.abs(cycle-1.2))*2.8,Math.sin(a)*42);o.mesh.rotation.x=Math.PI/2+(cycle-1.2)*.8;});
    neonLights.forEach((n,i)=>{if(state.neon)n.glow.material.emissiveIntensity=1.8+Math.sin(time*2+i)*.45;});
  }

  function updateUI(time){
    ui.speed.textContent=Math.round(state.speed).toString().padStart(2,'0');
    ui.speedArc.style.transform=`rotate(${lerp(-50,72,state.speed/76)}deg)`;
    ui.distance.textContent=`${state.distance.toFixed(2)} km`;
    ui.combo.textContent=`×${state.combo}`;
    ui.boost.style.width=`${state.boost}%`;ui.boostValue.textContent=Math.round(state.boost);
    const lapMs=performance.now()-state.lapStart, min=Math.floor(lapMs/60000),sec=Math.floor(lapMs/1000)%60,tenth=Math.floor(lapMs/100)%10;
    ui.lap.textContent=`${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${tenth}`;
    const a=(Math.atan2(forward.x,forward.z)*180/Math.PI+360)%360;ui.heading.textContent=`${String(Math.round(a)).padStart(3,'0')}°`;
    if(state.boosting)ui.status.textContent='涡流推进已启动';
    fpsFrames++;const now=performance.now();if(now-fpsStart>800){ui.fps.textContent=`${Math.round(fpsFrames*1000/(now-fpsStart))} FPS`;fpsFrames=0;fpsStart=now;}
  }

  function animate(){
    requestAnimationFrame(animate);
    let dt=Math.min(clock.getDelta(),.05);elapsed+=dt;
    if(!state.running)dt=0;
    if(dt>0){updateVehicle(dt,elapsed);updateWorld(dt,elapsed);updateCamera(dt,elapsed);updateUI(elapsed);}
    renderer.render(scene,camera);
  }

  // Loader sequence and initialization
  function loadingSequence(){
    let p=0;
    const timer=setInterval(()=>{
      p=Math.min(100,p+5+Math.random()*12);ui.loaderBar.style.width=`${p}%`;ui.loaderText.textContent=`${Math.floor(p)}%`;
      if(p>=100){clearInterval(timer);setTimeout(()=>ui.loader.classList.add('done'),280);}
    },80);
  }

  updateSun(state.sun);
  ui.speedSlider.style.setProperty('--fill','55%');
  setCameraMode('chase',false);
  loadingSequence();
  animate();
})();
