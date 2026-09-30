import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * A finite, texture-free clay coast for Three.js 0.186.1.
 *
 * Parent responsibilities: scene/background, camera, renderer, lighting, and hero.
 * Hero contact is (0, 0.16, 5.8), heading +X. Nothing here moves the hero.
 *
 * update(time, dt, speed): absolute seconds, elapsed seconds, signed km/h.
 * At +12 km/h the island turns -0.10 rad/s, moving the near road toward -X.
 * setNight(boolean): synchronous, reversible local lighting/atmosphere switch.
 * No renderer globals, DOM access, loaders, timers, or animation loop are used.
 */
export function createWorld() {
  const TAU = Math.PI * 2;
  const GROUND = 0.235;
  const group = new THREE.Group();
  group.name = 'Clay coast';
  const rotatingIsland = new THREE.Group();
  rotatingIsland.name = 'Rotating island';
  group.add(rotatingIsland);
  group.userData.heroContact = { x: 0, y: 0.16, z: 5.8 };
  group.userData.road = { radius: 5.8, width: 1.25, surfaceY: 0.14 };

  // Repeatable placement, without changing the application's Math.random state.
  let seed = 0x51c0a57;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const between = (a, b) => a + (b - a) * random();
  const color = (value) => new THREE.Color(value);
  function clay(name, value, extra = {}) {
    const material = new THREE.MeshStandardMaterial({
      color: value, roughness: 0.7, metalness: 0, ...extra,
    });
    material.name = name;
    return material;
  }
  const materials = {
    sand: clay('Warm sand', '#e8caa0'),
    shelf: clay('Submerged sand', '#cfbd99'),
    road: clay('Muted coral road', '#d59a79'),
    meadow: clay('Mint meadow', '#91b3a1'),
    cream: clay('Warm porcelain', '#fff2d9'),
    terra: clay('Terracotta', '#be7f64'),
    wood: clay('Driftwood', '#b59a77'),
    bronze: clay('Warm bronze', '#826c55'),
    leaf: clay('Sage palm leaves', '#729d86'),
    leafLight: clay('Mint palm leaves', '#9ab8a0'),
    recess: clay('Deep teal recesses', '#456b65'),
    grass: clay('Coastal grasses', '#ffffff', { side: THREE.DoubleSide }),
    pebble: clay('Pebbles', '#ffffff'),
    petals: clay('Flower petals', '#ffffff'),
    pollen: clay('Honey flower hearts', '#d6ad67'),
    ocean: clay('Seafoam rounded disc', '#86c6c1'),
    sail: clay('Canvas sails', '#fff2d9', { side: THREE.DoubleSide }),
    clouds: clay('Marshmallow clouds', '#fff6e6', { roughness: 0.86 }),
    lamp: clay('Lighthouse lantern', '#ffddb0', {
      emissive: '#ffbe69', emissiveIntensity: 0.035,
    }),
    window: clay('Cottage window glass', '#a5c7bd', {
      emissive: '#ffc781', emissiveIntensity: 0,
    }),
  };

  // The same source geometries feed batching and instancing throughout the world.
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const pebble = new THREE.SphereGeometry(1, 9, 6);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
  const softBox = roundedBox();
  const dummy = new THREE.Object3D();
  const direction = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function mesh(parent, name, geometry, material, cast = true, receive = true) {
    const object = new THREE.Mesh(geometry, material);
    object.name = name;
    object.castShadow = cast;
    object.receiveShadow = receive;
    parent.add(object);
    return object;
  }
  function batch(parent, name) {
    const buckets = new Map();
    function add(geometry, material, position = [0, 0, 0], scale = [1, 1, 1],
      rotation = [0, 0, 0], cast = true) {
      dummy.position.fromArray(position);
      dummy.scale.fromArray(scale);
      dummy.rotation.set(...rotation);
      dummy.updateMatrix();
      const key = `${material.id}/${cast}`;
      if (!buckets.has(key)) buckets.set(key, { material, cast, geometries: [] });
      const transformed = geometry.clone().applyMatrix4(dummy.matrix);
      // Extrusions are non-indexed, while primitives are indexed; batching
      // requires a consistent representation across both kinds of geometry.
      if (!transformed.index) {
        transformed.setIndex(Array.from({ length: transformed.attributes.position.count }, (_, i) => i));
      }
      buckets.get(key).geometries.push(transformed);
    }
    function rod(a, b, radius, material, cast = true) {
      dummy.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      direction.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const length = direction.length();
      if (!length) return;
      dummy.quaternion.setFromUnitVectors(up, direction.multiplyScalar(1 / length));
      dummy.scale.set(radius, length, radius);
      dummy.updateMatrix();
      const key = `${material.id}/${cast}`;
      if (!buckets.has(key)) buckets.set(key, { material, cast, geometries: [] });
      buckets.get(key).geometries.push(cylinder.clone().applyMatrix4(dummy.matrix));
    }
    function flush() {
      for (const entry of buckets.values()) {
        const merged = mergeGeometries(entry.geometries, false);
        if (!merged) throw new Error(`Could not batch ${name}`);
        mesh(parent, `${name} / ${entry.material.name}`, merged, entry.material, entry.cast);
        for (const geometry of entry.geometries) geometry.dispose();
      }
      buckets.clear();
    }
    return { add, rod, flush };
  }
  function lathe(profile, segments = 96) {
    return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  }
  function instances(parent, name, geometry, material, count, cast = false) {
    const object = new THREE.InstancedMesh(geometry, material, count);
    object.name = name;
    object.castShadow = cast;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function putInstance(object, index, position, scale, rotation = [0, 0, 0], tint) {
    dummy.position.fromArray(position);
    dummy.scale.fromArray(scale);
    dummy.rotation.set(...rotation);
    dummy.updateMatrix();
    object.setMatrixAt(index, dummy.matrix);
    if (tint) object.setColorAt(index, tint);
  }
  function finishInstances(object) {
    object.instanceMatrix.needsUpdate = true;
    if (object.instanceColor) object.instanceColor.needsUpdate = true;
    object.computeBoundingSphere();
  }

  // Rounded ocean bowl: a recessed floor allows the submerged shelf to show
  // through the translucent surface, rather than hiding it behind an opaque cap.
  mesh(group, 'Rounded floating ocean disc', lathe([
    [0, -0.8], [8.78, -0.8], [8.92, -0.773], [8.99, -0.70],
    [9, -0.61], [8.96, -0.545], [8.89, -0.503], [8.81, -0.54],
    [8.60, -0.735], [0, -0.735],
  ], 112), materials.ocean, false, false);

  const waterMaterial = new THREE.ShaderMaterial({
    name: 'Fine seafoam ripples',
    uniforms: {
      uTime: { value: 0 }, uNight: { value: 0 },
      uSea: { value: color('#86c6c1') },
      uFoam: { value: color('#e0eddd') },
      uDeep: { value: color('#397078') },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec2 vCoast;
      void main() {
        vCoast = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uNight;
      uniform vec3 uSea;
      uniform vec3 uFoam;
      uniform vec3 uDeep;
      varying vec2 vCoast;
      void main() {
        vec2 p = vCoast;
        float r = length(p);
        float edge = 1.0 - smoothstep(8.1, 8.89, r);
        float t = uTime * 0.55;
        float a = sin(dot(p, vec2(17.2, 6.8)) + sin(p.y * 4.8 - t) * 0.6 + t);
        float b = sin(dot(p, vec2(-9.7, 21.3)) + sin(p.x * 5.3 + t) * 0.45 - t * 0.8);
        float crest = pow(max(0.0, a * 0.57 + b * 0.43), 7.0);
        float current = sin(p.x * 1.8 + p.y * 2.3 + t * 0.35) * 0.018;
        float shore = exp(-pow((r - 6.94) / 0.29, 2.0));
        float broken = smoothstep(-0.4, 0.65, sin(atan(p.y, p.x) * 21.0 + t * 0.4));
        float lace = exp(-pow((r - 6.94 - sin(atan(p.y, p.x) * 13.0 + t) * 0.027) / 0.028, 2.0));
        vec3 sea = mix(uSea, uDeep, uNight * 0.7);
        vec3 foam = mix(uFoam, uSea, uNight * 0.65);
        vec3 result = mix(sea, foam, (crest * 0.14 + current) * edge);
        result = mix(result, foam, shore * 0.11 + lace * broken * 0.23);
        // The ripples fade before the rounded rim; no hard alpha-cut ocean edge.
        gl_FragColor = vec4(result, 0.94 - shore * 0.18);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const water = mesh(group, 'Water surface (non-rotating)',
    new THREE.CircleGeometry(8.89, 112), waterMaterial, false, false);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.5;
  water.renderOrder = 1;

  mesh(rotatingIsland, 'Underwater sand ledge', lathe([
    [0, -0.69], [6.89, -0.69], [7.08, -0.66], [7.14, -0.61],
    [7.08, -0.565], [6.93, -0.55], [0, -0.55],
  ]), materials.shelf, false);
  mesh(rotatingIsland, 'Soft terraced sandy island', lathe([
    [0, -0.60], [6.39, -0.60], [6.70, -0.55], [6.84, -0.46],
    [6.86, -0.35], [6.81, -0.20], [6.75, -0.08], [6.69, 0.015],
    [6.65, 0.04], [0, 0.04],
  ]), materials.sand, true);
  mesh(rotatingIsland, 'Raised mint meadow', lathe([
    [0, 0.041], [4.70, 0.041], [4.85, 0.075], [4.90, 0.135],
    [4.87, 0.185], [4.78, GROUND], [0, GROUND],
  ]), materials.meadow, false);

  // Exact flat annulus: radius 5.8, width 1.25, road surface y = .14.
  mesh(rotatingIsland, 'Coral cycling loop', lathe([
    [5.175, 0.068], [6.425, 0.068], [6.441, 0.085], [6.441, 0.119],
    [6.425, 0.14], [5.175, 0.14], [5.159, 0.119], [5.159, 0.085],
    [5.175, 0.068],
  ], 128), materials.road, false);
  const edging = batch(rotatingIsland, 'Fine cream road edging');
  for (const radius of [5.198, 6.402]) {
    const geometry = new THREE.TorusGeometry(radius, 0.014, 5, 128);
    edging.add(geometry, materials.cream, [0, 0.139, 0], [1, 1, 1], [Math.PI / 2, 0, 0], false);
    geometry.dispose();
  }
  edging.flush();
  const dashGeometry = new THREE.CapsuleGeometry(0.5, 1, 2, 6);
  dashGeometry.rotateZ(Math.PI / 2);
  const dashes = instances(rotatingIsland, 'Instanced cream road dashes', dashGeometry, materials.cream, 72);
  for (let i = 0; i < 72; i++) {
    const a = i * TAU / 72;
    putInstance(dashes, i, [Math.cos(a) * 5.8, 0.145, Math.sin(a) * 5.8],
      [0.127, 0.005, 0.048], [0, -a - Math.PI / 2, 0]);
  }
  finishInstances(dashes);

  // Back-left lighthouse. Its complete silhouette is 3.30 units above the lawn.
  const lighthouse = new THREE.Group();
  lighthouse.name = 'Striped lighthouse';
  lighthouse.position.set(-2, GROUND, -1.4);
  rotatingIsland.add(lighthouse);
  const tower = batch(lighthouse, 'Lighthouse');
  tower.add(cylinder, materials.cream, [0, 0.07, 0], [0.57, 0.14, 0.57]);
  tower.add(cylinder, materials.sand, [0, 0.155, 0], [0.48, 0.10, 0.48]);
  const bottom = 0.20;
  const top = 2.38;
  const radiusAt = (y) => THREE.MathUtils.lerp(0.435, 0.31, (y - bottom) / (top - bottom));
  for (let i = 0; i < 6; i++) {
    const y0 = bottom + (top - bottom) * i / 6;
    const y1 = bottom + (top - bottom) * (i + 1) / 6;
    const section = new THREE.CylinderGeometry(radiusAt(y1), radiusAt(y0), y1 - y0, 28);
    tower.add(section, i % 2 ? materials.terra : materials.cream, [0, (y0 + y1) / 2, 0]);
    section.dispose();
  }
  const door = archGeometry(0.24, 0.43, 0.04);
  tower.add(door, materials.recess, [0, 0.20, 0.431]);
  door.dispose();
  tower.add(sphere, materials.bronze, [0.075, 0.36, 0.465], [0.019, 0.019, 0.013]);
  // A single high porthole rather than a distracting pattern of windows.
  const portRing = new THREE.TorusGeometry(0.085, 0.019, 6, 16);
  tower.add(portRing, materials.cream, [0, 1.86, 0.352]);
  portRing.dispose();
  tower.add(sphere, materials.recess, [0, 1.86, 0.350], [0.067, 0.067, 0.018]);
  tower.add(cylinder, materials.cream, [0, 2.405, 0], [0.49, 0.105, 0.49]);
  tower.add(cylinder, materials.bronze, [0, 2.488, 0], [0.285, 0.052, 0.285]);
  tower.add(cylinder, materials.lamp, [0, 2.725, 0], [0.245, 0.42, 0.245]);
  tower.add(cylinder, materials.bronze, [0, 2.962, 0], [0.30, 0.055, 0.30]);
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8;
    const c = Math.cos(a);
    const s = Math.sin(a);
    tower.rod([c * 0.266, 2.49, s * 0.266], [c * 0.266, 2.94, s * 0.266], 0.017, materials.bronze);
    tower.rod([c * 0.45, 2.45, s * 0.45], [c * 0.45, 2.63, s * 0.45], 0.012, materials.cream);
  }
  const railing = new THREE.TorusGeometry(0.45, 0.015, 5, 32);
  tower.add(railing, materials.cream, [0, 2.63, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  railing.dispose();
  const roof = new THREE.ConeGeometry(0.405, 0.24, 24);
  tower.add(roof, materials.terra, [0, 3.095, 0]);
  roof.dispose();
  tower.add(sphere, materials.bronze, [0, 3.247, 0], [0.048, 0.053, 0.048]);
  tower.flush();
  const lampLight = new THREE.PointLight('#ffce91', 0, 5, 2);
  lampLight.name = 'Warm lighthouse night light';
  lampLight.position.set(0, 2.73, 0);
  lighthouse.add(lampLight);
  const lampGlow = mesh(lighthouse, 'Soft lantern glow', sphere, glowMaterial(), false, false);
  lampGlow.position.set(0, 2.73, 0);
  lampGlow.scale.setScalar(0.43);
  lampGlow.renderOrder = 2;

  const cottage = new THREE.Group();
  cottage.name = 'Lighthouse keeper cottage';
  cottage.position.set(-0.90, GROUND, -2.10);
  cottage.rotation.y = -0.12;
  rotatingIsland.add(cottage);
  const house = batch(cottage, 'Keeper cottage');
  house.add(softBox, materials.sand, [0, 0.06, 0], [1.21, 0.12, 0.92]);
  house.add(softBox, materials.cream, [0, 0.39, 0], [1.08, 0.65, 0.78]);
  const gable = new THREE.Shape();
  gable.moveTo(-0.58, 0);
  gable.lineTo(0, 0.33);
  gable.lineTo(0.58, 0);
  gable.closePath();
  const gableGeometry = new THREE.ExtrudeGeometry(gable, {
    depth: 0.82, steps: 1, bevelEnabled: true, bevelSize: 0.035,
    bevelThickness: 0.035, bevelSegments: 2, curveSegments: 1,
  });
  gableGeometry.translate(0, 0, -0.41);
  house.add(gableGeometry, materials.terra, [0, 0.72, 0]);
  gableGeometry.dispose();
  house.add(softBox, materials.terra, [0.29, 1.02, -0.15], [0.17, 0.34, 0.17]);
  house.add(softBox, materials.cream, [0.29, 1.20, -0.15], [0.23, 0.07, 0.23]);
  house.add(softBox, materials.recess, [-0.23, 0.29, 0.397], [0.23, 0.40, 0.043]);
  house.add(softBox, materials.wood, [-0.23, 0.095, 0.51], [0.35, 0.065, 0.24]);
  house.add(softBox, materials.terra, [0.25, 0.43, 0.407], [0.35, 0.32, 0.035]);
  house.add(softBox, materials.window, [0.25, 0.43, 0.433], [0.26, 0.235, 0.022]);
  house.add(softBox, materials.cream, [0.25, 0.43, 0.451], [0.026, 0.24, 0.015]);
  house.add(softBox, materials.cream, [0.25, 0.43, 0.451], [0.26, 0.023, 0.015]);
  house.flush();

  // Three deliberately asymmetric palms, all inside the cycling lane.
  const palmLocations = [
    [-3.15, -2.80, 2.38, -0.23, -0.06],
    [0.65, -3.72, 2.75, 0.28, -0.13],
    [3.65, -1.72, 2.43, 0.32, 0.03],
  ];
  const frond = leafGeometry(1.16, 0.20, 0.24, 0.31, 10);
  const palms = batch(rotatingIsland, 'Sculptural palms');
  for (let p = 0; p < palmLocations.length; p++) {
    const [x, z, height, leanX, leanZ] = palmLocations[p];
    const trunk = bentTrunk(height, leanX, leanZ);
    palms.add(trunk, materials.wood, [x, GROUND, z]);
    trunk.dispose();
    for (let i = 0; i < 7; i++) {
      const a = i * TAU / 7 + p * 0.7;
      palms.add(frond, i % 3 ? materials.leaf : materials.leafLight,
        [x + leanX, GROUND + height, z + leanZ],
        [between(0.87, 1.16), between(0.88, 1.12), between(0.86, 1.08)],
        [0, a, between(-0.03, 0.15)]);
    }
    palms.add(sphere, materials.leaf, [x + leanX, GROUND + height, z + leanZ], [0.17, 0.12, 0.17]);
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3;
      palms.add(sphere, materials.bronze,
        [x + leanX + Math.cos(a) * 0.11, GROUND + height - 0.115, z + leanZ + Math.sin(a) * 0.11],
        [0.077, 0.088, 0.072]);
    }
  }
  palms.flush();
  frond.dispose();

  // A tiny striped parasol and canvas chair occupy the quiet left-hand lawn.
  const picnic = new THREE.Group();
  picnic.name = 'Small coastal picnic';
  picnic.position.set(-4.03, GROUND, -0.43);
  picnic.rotation.y = -0.25;
  rotatingIsland.add(picnic);
  const beach = batch(picnic, 'Parasol and chair');
  beach.add(cylinder, materials.wood, [0, 0.62, 0], [0.027, 1.24, 0.027]);
  for (let i = 0; i < 8; i++) {
    const panel = parasolPanel(i * TAU / 8, (i + 1) * TAU / 8);
    beach.add(panel, i % 2 ? materials.terra : materials.cream);
    panel.dispose();
  }
  beach.add(sphere, materials.terra, [0, 1.40, 0], [0.055, 0.058, 0.055]);
  beach.add(softBox, materials.cream, [0.32, 0.016, 0.65], [0.66, 0.03, 0.83], [0, 0.13, 0], false);
  beach.add(softBox, materials.terra, [0.34, 0.20, 0.64], [0.34, 0.032, 0.31]);
  beach.add(softBox, materials.cream, [0.34, 0.37, 0.49], [0.34, 0.39, 0.028], [-0.26, 0, 0]);
  for (const x of [0.145, 0.535]) {
    beach.rod([x, 0.025, 0.43], [x, 0.31, 0.83], 0.019, materials.wood);
    beach.rod([x, 0.025, 0.84], [x, 0.55, 0.43], 0.019, materials.wood);
  }
  beach.rod([0.145, 0.54, 0.43], [0.535, 0.54, 0.43], 0.019, materials.wood);
  beach.flush();

  // Grass is 400 blades in one draw, with local colors rather than new materials.
  const grassGeometry = new THREE.BufferGeometry();
  grassGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.032, 0, 0, 0.032, 0, 0,
    -0.023, 0.22, 0.024, 0.023, 0.22, 0.024, 0.012, 0.43, 0.085,
  ], 3));
  grassGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 0.5, 1, 0.5, 0.5, 1], 2));
  grassGeometry.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  grassGeometry.computeVertexNormals();
  const grass = instances(rotatingIsland, 'Instanced coastal grasses', grassGeometry, materials.grass, 400);
  const grassColors = ['#7d9c77', '#afbc8b', '#68947e', '#98b397'].map(color);
  function clearLawn(x, z) {
    if (Math.hypot(x + 2, z + 1.4) < 0.80) return false;
    if (Math.hypot(x + 0.90, z + 2.10) < 0.90) return false;
    if (Math.hypot(x + 4.03, z + 0.43) < 0.90) return false;
    // A restful foreground keeps the separate rider's silhouette legible.
    if (z > 1.2 && Math.abs(x) < 1.75) return false;
    return true;
  }
  function lawnPosition(min = 2.65, max = 4.62) {
    for (let i = 0; i < 80; i++) {
      const a = random() * TAU;
      const r = Math.sqrt(between(min * min, max * max));
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (clearLawn(x, z)) return [x, z];
    }
    return [3.0, 1.6];
  }
  for (let tuft = 0; tuft < 100; tuft++) {
    const [x, z] = lawnPosition();
    const size = between(0.54, 1.02);
    for (let blade = 0; blade < 4; blade++) {
      const a = random() * TAU;
      putInstance(grass, tuft * 4 + blade,
        [x + between(-0.038, 0.038), GROUND - 0.005, z + between(-0.038, 0.038)],
        [size, size * between(0.62, 1.1), size], [0, a, between(-0.22, 0.22)],
        grassColors[tuft % grassColors.length]);
    }
  }
  finishInstances(grass);

  const rockCount = 23;
  const rocks = instances(rotatingIsland, 'Instanced little rocks and stepping stones', pebble, materials.pebble, rockCount, true);
  const rockColors = ['#c3bca3', '#d8c9ae', '#b2b9aa', '#e8d6b6'].map(color);
  for (let i = 0; i < rockCount; i++) {
    let x, y, z, sx, sy, sz;
    if (i < 5) {
      x = -2 + Math.sin(i * 1.6) * 0.10;
      z = -0.72 + i * 0.29;
      y = GROUND + 0.013;
      sx = 0.18; sy = 0.033; sz = 0.115;
    } else if (i < 12) {
      const a = Math.PI + (i - 5) / 6 * Math.PI;
      x = Math.cos(a) * 6.74;
      z = Math.sin(a) * 6.74;
      y = -0.12;
      sx = between(0.14, 0.23); sy = between(0.14, 0.22); sz = between(0.12, 0.20);
    } else {
      [x, z] = lawnPosition(3.6, 4.60);
      y = GROUND + 0.025;
      sx = between(0.09, 0.18); sy = between(0.065, 0.13); sz = between(0.08, 0.16);
    }
    putInstance(rocks, i, [x, y, z], [sx, sy, sz], [0, random() * TAU, 0], rockColors[i % 4]);
  }
  finishInstances(rocks);

  const flowerCount = 30;
  const stems = instances(rotatingIsland, 'Wildflower stems', cylinder, materials.leaf, flowerCount);
  const petals = instances(rotatingIsland, 'Instanced five-petal wildflowers', pebble, materials.petals, flowerCount * 5);
  const hearts = instances(rotatingIsland, 'Wildflower centers', pebble, materials.pollen, flowerCount);
  const petalColors = ['#fff2d9', '#efd3b8', '#e7b5a4', '#f2deaa'].map(color);
  for (let i = 0; i < flowerCount; i++) {
    const [x, z] = lawnPosition(2.7, 4.40);
    const h = between(0.14, 0.29);
    const size = between(0.75, 1.1);
    putInstance(stems, i, [x, GROUND + h / 2, z], [0.008, h, 0.008]);
    putInstance(hearts, i, [x, GROUND + h + 0.013, z], [0.027 * size, 0.021, 0.027 * size]);
    for (let petal = 0; petal < 5; petal++) {
      const a = petal * TAU / 5 + i;
      putInstance(petals, i * 5 + petal,
        [x + Math.cos(a) * 0.040 * size, GROUND + h, z + Math.sin(a) * 0.040 * size],
        [0.044 * size, 0.015 * size, 0.027 * size], [0, -a, 0], petalColors[i % 4]);
    }
  }
  finishInstances(stems);
  finishInstances(petals);
  finishInstances(hearts);

  // The boats are siblings of rotatingIsland: they bob, never revolve with land.
  const boats = [];
  const hullOutline = new THREE.Shape();
  hullOutline.moveTo(0.56, 0);
  hullOutline.bezierCurveTo(0.27, 0.24, -0.28, 0.26, -0.48, 0.13);
  hullOutline.quadraticCurveTo(-0.56, 0, -0.48, -0.13);
  hullOutline.bezierCurveTo(-0.28, -0.26, 0.27, -0.24, 0.56, 0);
  const hullGeometry = new THREE.ExtrudeGeometry(hullOutline, {
    depth: 0.10, steps: 1, bevelEnabled: true,
    bevelSize: 0.045, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 7,
  });
  hullGeometry.rotateX(Math.PI / 2);
  hullGeometry.translate(0, 0.11, 0);
  const sailGeometry = sailPanel(0.50, 0.83, 0.07);
  const jibGeometry = sailPanel(-0.34, 0.64, -0.045);
  for (let i = 0; i < 2; i++) {
    const boat = new THREE.Group();
    boat.name = i ? 'Distant mint sailboat' : 'Little terracotta sailboat';
    const x = i ? 6.70 : -7.32;
    const z = i ? -4.45 : 2.32;
    const yaw = i ? -0.55 : 0.24;
    boat.position.set(x, -0.47, z);
    boat.rotation.y = yaw;
    boat.scale.setScalar(i ? 0.83 : 0.94);
    group.add(boat);
    const build = batch(boat, 'Sailboat');
    build.add(hullGeometry, i ? materials.leafLight : materials.terra);
    build.add(hullGeometry, materials.cream, [0, 0.105, 0], [0.83, 0.18, 0.78]);
    build.rod([-0.055, 0.15, 0], [-0.055, 1.14, 0], 0.014, materials.wood);
    build.rod([-0.07, 0.31, 0], [0.48, 0.31, 0], 0.011, materials.wood);
    build.add(sailGeometry, materials.sail, [-0.035, 0.31, 0]);
    build.add(jibGeometry, materials.sail, [-0.09, 0.33, 0.012]);
    build.add(softBox, materials.terra, [-0.04, 1.12, 0], [0.16, 0.055, 0.014]);
    build.flush();
    boats.push({ object: boat, x, z, yaw, phase: i * 2.7 });
  }
  hullGeometry.dispose();
  sailGeometry.dispose();
  jibGeometry.dispose();

  // One instanced cloud mesh, not a wall of large overlapping background forms.
  const cloudRoot = new THREE.Group();
  cloudRoot.name = 'Quiet distant clouds';
  group.add(cloudRoot);
  const clouds = instances(cloudRoot, 'Instanced clay cloud puffs', sphere, materials.clouds, 13);
  const cloudSpecs = [
    [-4.65, 5.62, -4.65, 0.66, 4],
    [0.0, 6.12, -6.05, 0.76, 5],
    [4.30, 5.65, -4.65, 0.57, 4],
  ];
  let cloudIndex = 0;
  for (const [x, y, z, size, count] of cloudSpecs) {
    for (let i = 0; i < count; i++) {
      const center = i - (count - 1) / 2;
      const height = i === Math.floor(count / 2) ? 0.13 : 0;
      const puff = size * (i === 0 || i === count - 1 ? 0.58 : 0.77);
      putInstance(clouds, cloudIndex++, [x + center * size * 0.65, y + height, z + Math.sin(i * 2) * 0.10],
        [puff, puff * 0.64, puff * 0.62]);
    }
  }
  finishInstances(clouds);
  clouds.receiveShadow = false;

  const gulls = [];
  const wingGeometry = leafGeometry(0.35, 0.067, 0.052, 0.045, 6);
  // Geometry starts at the shoulder and grows toward +Z; mirror using rotation,
  // never negative scale (which would invert normals on a batched geometry).
  wingGeometry.rotateY(-Math.PI / 2);
  const gullBodyGeometry = sphere.clone();
  gullBodyGeometry.scale(0.14, 0.055, 0.060);
  for (let i = 0; i < 3; i++) {
    const gull = new THREE.Group();
    gull.name = `Small orbiting seagull ${i + 1}`;
    group.add(gull);
    mesh(gull, 'Seagull body', gullBodyGeometry, materials.cream, false, false);
    const left = new THREE.Group();
    const right = new THREE.Group();
    left.position.z = 0.033;
    right.position.z = -0.033;
    right.rotation.y = Math.PI;
    gull.add(left, right);
    mesh(left, 'Left sculpted wing', wingGeometry, materials.cream, false, false);
    mesh(right, 'Right sculpted wing', wingGeometry, materials.cream, false, false);
    const detail = batch(gull, 'Gull details');
    detail.add(sphere, materials.pollen, [0.146, 0.004, 0], [0.044, 0.019, 0.021], [0, 0, 0], false);
    detail.add(softBox, materials.cream, [-0.15, 0.005, 0], [0.10, 0.022, 0.082], [0, 0, -0.17], false);
    detail.flush();
    gull.scale.setScalar(0.78 + i * 0.06);
    gulls.push({ object: gull, left, right, phase: i * TAU / 3 + 0.5 });
  }

  // Night accents are point sprites generated in the shader, without textures.
  const stars = makeNightPoints(42, '#fff2d9', false);
  stars.name = 'Night-only stars';
  group.add(stars);
  const fireflies = makeNightPoints(17, '#ffe8a6', true);
  fireflies.name = 'Night-only meadow fireflies';
  rotatingIsland.add(fireflies);
  const fireflyPositions = fireflies.geometry.getAttribute('position');
  fireflyPositions.setUsage(THREE.DynamicDrawUsage);
  const fireflyBases = new Float32Array(fireflyPositions.array);
  // The animated points stay within this fixed bound; no per-frame recomputation.
  fireflies.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 5.3);
  const cloudDay = color('#fff6e6');
  const cloudNight = color('#a9bfbd');
  const oceanDay = color('#86c6c1');
  const oceanNight = color('#568e91');
  let night = false;
  let elapsed = 0;

  function setNight(isNight) {
    night = Boolean(isNight);
    waterMaterial.uniforms.uNight.value = night ? 1 : 0;
    materials.ocean.color.copy(night ? oceanNight : oceanDay);
    materials.clouds.color.copy(night ? cloudNight : cloudDay);
    materials.lamp.emissiveIntensity = night ? 2.2 : 0.035;
    materials.window.emissiveIntensity = night ? 0.75 : 0;
    lampLight.intensity = night ? 3.1 : 0;
    lampGlow.visible = night;
    stars.visible = night;
    fireflies.visible = night;
  }

  function update(time, dt, speed) {
    const delta = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const velocity = Number.isFinite(speed) ? speed : 0;
    const t = Number.isFinite(time) ? time : elapsed + delta;
    elapsed = t;
    // No implicit frame-rate assumption or dt clamp: the caller owns its clock.
    rotatingIsland.rotation.y = (rotatingIsland.rotation.y - (velocity / 3.6) * 0.03 * delta) % TAU;
    waterMaterial.uniforms.uTime.value = t;
    for (let i = 0; i < boats.length; i++) {
      const boat = boats[i];
      boat.object.position.set(boat.x, -0.47 + Math.sin(t * 1.15 + boat.phase) * 0.025, boat.z);
      boat.object.rotation.set(
        Math.sin(t * 0.91 + boat.phase) * 0.022,
        boat.yaw + Math.sin(t * 0.23 + boat.phase) * 0.025,
        Math.sin(t * 1.07 + boat.phase) * 0.035,
      );
    }
    cloudRoot.position.x = Math.sin(t * 0.065) * 0.15;
    cloudRoot.position.y = Math.sin(t * 0.12) * 0.035;
    for (let i = 0; i < gulls.length; i++) {
      const gull = gulls[i];
      const a = t * (0.085 + i * 0.009) + gull.phase;
      gull.object.position.set(Math.cos(a) * 4.7, 4.73 + Math.sin(t * 0.7 + gull.phase) * 0.19, -1.85 + Math.sin(a) * 2.7);
      gull.object.rotation.y = Math.atan2(-Math.cos(a) * 2.7, -Math.sin(a) * 4.7);
      gull.object.rotation.z = Math.sin(a) * 0.07;
      const flap = Math.sin(t * 3.1 + gull.phase) * 0.25 + 0.08;
      gull.left.rotation.x = flap;
      gull.right.rotation.x = -flap;
    }
    if (night) {
      stars.material.uniforms.uTime.value = t;
      fireflies.material.uniforms.uTime.value = t;
      lampLight.intensity = 3.1 + Math.sin(t * 1.3) * 0.12;
      for (let i = 0; i < fireflyPositions.count; i++) {
        const j = i * 3;
        fireflyPositions.array[j] = fireflyBases[j] + Math.sin(t * 0.58 + i * 1.7) * 0.10;
        fireflyPositions.array[j + 1] = fireflyBases[j + 1] + Math.sin(t * 0.91 + i * 2.3) * 0.11;
        fireflyPositions.array[j + 2] = fireflyBases[j + 2] + Math.cos(t * 0.63 + i) * 0.10;
      }
      fireflyPositions.needsUpdate = true;
    }
  }

  function makeNightPoints(count, tint, onLawn) {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      if (onLawn) {
        const [x, z] = lawnPosition(2.25, 4.50);
        positions.set([x, between(0.45, 0.94), z], i * 3);
      } else {
        positions.set([between(-7.1, 7.1), between(5.35, 8.0), between(-7.0, -3.2)], i * 3);
      }
      sizes[i] = onLawn ? between(2.0, 3.1) : between(1.7, 3.7);
      phases[i] = random() * TAU;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    const material = new THREE.ShaderMaterial({
      name: onLawn ? 'Firefly glow points' : 'Tiny twinkling stars',
      uniforms: { uTime: { value: 0 }, uColor: { value: color(tint) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        varying float vTwinkle;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * 19.0 / max(1.0, -mv.z), 1.25, 5.0);
          vTwinkle = 0.65 + 0.35 * sin(uTime * 0.85 + aPhase);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vTwinkle;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float alpha = (1.0 - smoothstep(0.05, 1.0, r)) * vTwinkle;
          gl_FragColor = vec4(uColor, alpha * 0.85);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 2;
    return points;
  }

  setNight(false);
  update(0, 0, 0);
  // Batching-only source geometries never need GPU resources of their own.
  softBox.dispose();
  return { group, rotatingIsland, update, setNight };
}

// A small rounded cube, reusable at different scales. Its normals follow the
// rounded surface instead of relying on flat box normals or expensive CSG.
function roundedBox() {
  const geometry = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const core = new THREE.Vector3();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const radius = 0.10;
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i);
    core.set(
      THREE.MathUtils.clamp(point.x, -0.5 + radius, 0.5 - radius),
      THREE.MathUtils.clamp(point.y, -0.5 + radius, 0.5 - radius),
      THREE.MathUtils.clamp(point.z, -0.5 + radius, 0.5 - radius),
    );
    normal.copy(point).sub(core).normalize();
    point.copy(core).addScaledVector(normal, radius);
    positions.setXYZ(i, point.x, point.y, point.z);
    normals.setXYZ(i, normal.x, normal.y, normal.z);
  }
  return geometry;
}

function archGeometry(width, height, depth) {
  const r = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-r, 0);
  shape.lineTo(r, 0);
  shape.lineTo(r, height - r);
  shape.absarc(0, height - r, r, 0, Math.PI, false);
  shape.lineTo(-r, 0);
  return new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSize: 0.009,
    bevelThickness: 0.009, bevelSegments: 2, curveSegments: 8,
  });
}

// Closed, gently curved paddle: a raised central vein and rounded silhouette
// read as hand-pressed clay. The same topology also makes the small gull wings.
function leafGeometry(length, width, arch, droop, segments) {
  const positions = [];
  const uv = [];
  const indices = [];
  const stride = (segments + 1) * 3;
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const shape = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.72);
      const halfWidth = 0.004 + width * shape;
      for (let j = 0; j < 3; j++) {
        const v = j - 1;
        const ridge = (1 - v * v) * shape * (side ? -0.017 : 0.035);
        positions.push(t * length, Math.sin(t * Math.PI) * arch - t * t * droop + ridge, v * halfWidth);
        uv.push(t, j / 2);
      }
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j;
      const b = a + 3;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
      indices.push(a + stride, b + stride, a + 1 + stride, a + 1 + stride, b + stride, b + 1 + stride);
    }
    for (const j of [0, 2]) {
      const a = i * 3 + j;
      const b = a + 3;
      if (j === 0) indices.push(a, b, a + stride, b, b + stride, a + stride);
      else indices.push(a, a + stride, b, b, a + stride, b + stride);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function bentTrunk(height, leanX, leanZ) {
  const positions = [];
  const uv = [];
  const indices = [];
  const rings = 12;
  const sides = 8;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const radius = (0.125 - t * 0.061) * (i % 2 ? 0.94 : 1.02);
    for (let j = 0; j <= sides; j++) {
      const a = j * Math.PI * 2 / sides;
      positions.push(leanX * t * t + Math.cos(a) * radius, t * height, leanZ * t * t + Math.sin(a) * radius);
      uv.push(j / sides, t);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j;
      const b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function parasolPanel(start, end) {
  const positions = [];
  const uv = [];
  const indices = [];
  const radial = 5;
  const angular = 4;
  for (let i = 0; i <= radial; i++) {
    const t = i / radial;
    const r = t * 0.63;
    for (let j = 0; j <= angular; j++) {
      const v = j / angular;
      const a = THREE.MathUtils.lerp(start, end, v);
      const scallop = Math.sin(v * Math.PI) * Math.pow(t, 5) * 0.045;
      positions.push(Math.cos(a) * r, 1.36 - 0.22 * t * t - scallop, Math.sin(a) * r);
      uv.push(v, t);
    }
  }
  for (let i = 0; i < radial; i++) {
    for (let j = 0; j < angular; j++) {
      const a = i * (angular + 1) + j;
      const b = a + angular + 1;
      // Both sides are real triangles so shared opaque clay materials stay single-sided.
      indices.push(a, a + 1, b, a + 1, b + 1, b);
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  // Opposing coplanar triangles must not cancel the canopy's smooth top normals.
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] * 1.11;
    const z = positions[i + 2] * 1.11;
    const length = Math.hypot(x, 1, z);
    normals[i] = x / length;
    normals[i + 1] = 1 / length;
    normals[i + 2] = z / length;
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geometry;
}

function sailPanel(width, height, billow) {
  const positions = [];
  const uv = [];
  const indices = [];
  const rows = 6;
  // Triangular lattice, with a slight billow instead of a flat paper triangle.
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    for (let j = 0; j <= rows - i; j++) {
      const u = j / rows;
      positions.push(u * width, t * height, Math.sin(Math.PI * u) * Math.sin(Math.PI * t) * billow * 2);
      uv.push(u, t);
    }
  }
  let offset = 0;
  for (let i = 0; i < rows; i++) {
    const count = rows - i + 1;
    const next = offset + count;
    for (let j = 0; j < count - 1; j++) {
      indices.push(offset + j, offset + j + 1, next + j);
      if (j < count - 2) indices.push(offset + j + 1, next + j + 1, next + j);
    }
    offset = next;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function glowMaterial() {
  return new THREE.ShaderMaterial({
    name: 'Texture-free lantern halo',
    uniforms: { uColor: { value: new THREE.Color('#ffd399') } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = max(0.0, dot(normalize(vNormal), normalize(vView)));
        gl_FragColor = vec4(uColor, pow(facing, 2.8) * 0.17);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
