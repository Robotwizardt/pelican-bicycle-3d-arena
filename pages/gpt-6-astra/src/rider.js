import * as THREE from 'three';

/**
 * A handmade pelican and vintage bicycle. All distances are in scene metres.
 * Local +X is forwards, +Y is up; the wheel axles run along Z.
 * update(time, dt, speed): absolute time / delta in seconds, signed speed in km/h.
 * No renderer, audio, DOM, external assets, or animation loop is created here.
 */
export function createRider() {
  const TAU = Math.PI * 2;
  const WHEEL_RADIUS = 0.57;
  const CRANK_RADIUS = 0.235;
  const CRANK_X = -0.20;
  const CRANK_Y = 0.79;
  const UP = new THREE.Vector3(0, 1, 0);
  const group = new THREE.Group();
  group.name = 'Pip the pelican · mint touring bicycle';

  const material = (color, roughness = 0.65, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const mat = {
    cream: material('#fff4dc', 0.70),
    feather: material('#fffbed', 0.64),
    featherShade: material('#e7ddc6', 0.77),
    mint: material('#7bc8b1', 0.34, 0.22),
    mintLight: material('#b2e2ca', 0.38, 0.13),
    tire: material('#303637', 0.88),
    sidewall: material('#e9d5ad', 0.80),
    silver: material('#cbd5d2', 0.29, 0.79),
    steel: material('#566463', 0.40, 0.70),
    brass: material('#d8ae64', 0.30, 0.72),
    leather: material('#88523a', 0.73),
    leatherLight: material('#b78055', 0.77),
    terracotta: material('#bb593d', 0.88),
    scarfHem: material('#e8b087', 0.91),
    bill: material('#edaa42', 0.53),
    billEdge: material('#c87535', 0.69),
    pouch: material('#f0b18a', 0.73),
    pouchShade: material('#d99171', 0.81),
    feet: material('#e59a46', 0.70),
    toe: material('#c67d3b', 0.74),
    navy: material('#253a42', 0.47),
    pupil: material('#182328', 0.23),
    white: material('#ffffff', 0.38),
    blush: material('#edc2a5', 0.86),
    glass: material('#497275', 0.20, 0.26),
    wicker: material('#c8975e', 0.89),
    wickerDark: material('#a77b4c', 0.96),
    leaf: material('#63896b', 0.85),
    pollen: material('#eac258', 0.84),
    lamp: material('#fff0c5', 0.20, 0.05),
    reflector: material('#b34d39', 0.35),
  };
  mat.lamp.emissive.set('#ffce83');
  mat.lamp.emissiveIntensity = 0.06;
  mat.reflector.emissive.set('#d95036');
  mat.reflector.emissiveIntensity = 0;

  // Shared primitive geometry; small repeated ornament is baked into material batches.
  const sphereGeometry = new THREE.SphereGeometry(1, 20, 12);
  const detailSphere = new THREE.SphereGeometry(1, 12, 8);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
  const transform = new THREE.Object3D();
  const direction = new THREE.Vector3();

  function mesh(parent, geometry, surface, name) {
    const object = new THREE.Mesh(geometry, surface);
    object.name = name;
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }

  function sphere(parent, surface, position, scale, name, rotation = 0) {
    const object = mesh(parent, sphereGeometry, surface, name);
    object.position.set(...position);
    object.scale.set(...scale);
    object.rotation.z = rotation;
    return object;
  }

  function positionBone(object, from, to, radius) {
    direction.copy(to).sub(from);
    const length = Math.max(direction.length(), 1e-8);
    object.position.copy(from).add(to).multiplyScalar(0.5);
    object.scale.set(radius, length, radius);
    object.quaternion.setFromUnitVectors(UP, direction.multiplyScalar(1 / length));
  }

  function rod(parent, surface, from, to, radius, name) {
    const object = mesh(parent, cylinderGeometry, surface, name);
    positionBone(object, new THREE.Vector3(...from), new THREE.Vector3(...to), radius);
    return object;
  }

  function pathGeometry(points, radius, segments = 28, closed = false, sides = 8) {
    const path = new THREE.CatmullRomCurve3(
      points.map((point) => new THREE.Vector3(...point)), closed, 'centripetal',
    );
    return new THREE.TubeGeometry(path, segments, radius, sides, closed);
  }

  function tube(parent, surface, points, radius, name, segments = 28, closed = false) {
    return mesh(parent, pathGeometry(points, radius, segments, closed), surface, name);
  }

  function torus(parent, surface, radius, thickness, position, name, radial = 8, tubular = 56) {
    const object = mesh(parent, new THREE.TorusGeometry(radius, thickness, radial, tubular), surface, name);
    object.position.set(...position);
    return object;
  }

  // A small indexed geometry merger avoids one draw call per spoke, stitch, or petal.
  function batch(parent, surface, name) {
    const pieces = [];
    const add = (geometry, matrix) => {
      const copy = geometry.clone();
      if (matrix) copy.applyMatrix4(matrix);
      pieces.push(copy);
    };
    return {
      sphere(position, scale, rotation = 0) {
        transform.position.set(...position);
        transform.rotation.set(0, 0, rotation);
        transform.scale.set(...scale);
        transform.updateMatrix();
        add(detailSphere, transform.matrix);
      },
      rod(from, to, radius) {
        positionBone(transform, new THREE.Vector3(...from), new THREE.Vector3(...to), radius);
        transform.updateMatrix();
        add(cylinderGeometry, transform.matrix);
      },
      tube(points, radius, segments = 20, closed = false) {
        const geometry = pathGeometry(points, radius, segments, closed, 6);
        add(geometry);
        geometry.dispose();
      },
      geometry(geometry, matrix) { add(geometry, matrix); },
      finish() {
        if (!pieces.length) return null;
        let vertexCount = 0;
        let indexCount = 0;
        for (const piece of pieces) {
          vertexCount += piece.attributes.position.count;
          indexCount += piece.index ? piece.index.count : piece.attributes.position.count;
        }
        const positions = new Float32Array(vertexCount * 3);
        const normals = new Float32Array(vertexCount * 3);
        const indices = new Uint32Array(indexCount);
        let vertexOffset = 0;
        let indexOffset = 0;
        for (const piece of pieces) {
          if (!piece.attributes.normal) piece.computeVertexNormals();
          positions.set(piece.attributes.position.array, vertexOffset * 3);
          normals.set(piece.attributes.normal.array, vertexOffset * 3);
          const count = piece.index ? piece.index.count : piece.attributes.position.count;
          for (let i = 0; i < count; i++) {
            indices[indexOffset++] = vertexOffset + (piece.index ? piece.index.getX(i) : i);
          }
          vertexOffset += piece.attributes.position.count;
          piece.dispose();
        }
        pieces.length = 0;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeBoundingSphere();
        return mesh(parent, geometry, surface, name);
      },
    };
  }

  // Smooth custom longitudinal volumes: the bill, hanging pouch, and leather saddle.
  function loft(rings, steps = 32, sides = 14) {
    const vertices = [];
    const indices = [];
    function sample(t, component) {
      const u = t * (rings.length - 1);
      const i = Math.min(rings.length - 2, Math.floor(u));
      const f = u - i;
      const a = rings[Math.max(0, i - 1)][component];
      const b = rings[i][component];
      const c = rings[i + 1][component];
      const d = rings[Math.min(rings.length - 1, i + 2)][component];
      return 0.5 * ((2 * b) + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f
        + (-a + 3 * b - 3 * c + d) * f * f * f);
    }
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = sample(t, 0);
      const y = sample(t, 1);
      const ry = Math.max(0.002, sample(t, 2));
      const rz = Math.max(0.002, sample(t, 3));
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * TAU;
        vertices.push(x, y + Math.cos(angle) * ry, Math.sin(angle) * rz);
        if (i < steps && j < sides) {
          const a = i * (sides + 1) + j;
          const b = a + sides + 1;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    for (let end = 0; end < 2; end++) {
      const ring = end ? rings[rings.length - 1] : rings[0];
      const center = vertices.length / 3;
      vertices.push(ring[0], ring[1], 0);
      const offset = end ? steps * (sides + 1) : 0;
      for (let j = 0; j < sides; j++) {
        if (end) indices.push(center, offset + j, offset + j + 1);
        else indices.push(center, offset + j + 1, offset + j);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  const bicycle = new THREE.Group();
  bicycle.name = 'Seafoam step-through touring bicycle';
  group.add(bicycle);
  const wheels = [];

  for (const x of [-1.10, 1.10]) {
    const wheel = new THREE.Group();
    wheel.name = x < 0 ? 'Rear wheel · rotating spokes' : 'Front wheel · rotating spokes';
    wheel.position.set(x, 0.59, 0);
    bicycle.add(wheel);
    wheels.push(wheel);
    const tire = torus(wheel, mat.tire, 0.524, 0.046, [0, 0, 0], 'Graphite rubber tire', 10, 64);
    tire.scale.z = 1.27;
    for (const side of [-1, 1]) {
      const wall = torus(wheel, mat.sidewall, 0.523, 0.028, [0, 0, side * 0.042], 'Cream tire sidewall', 8, 56);
      wall.scale.z = 0.30;
    }
    torus(wheel, mat.silver, 0.478, 0.012, [0, 0, 0], 'Polished wheel rim');
    rod(wheel, mat.silver, [0, 0, -0.086], [0, 0, 0.086], 0.041, 'Silver axle hub');
    const spokes = batch(wheel, mat.silver, '28 individual crossed silver spokes');
    for (let i = 0; i < 28; i++) {
      const angle = i / 28 * TAU;
      const hubAngle = angle + (i % 2 ? 0.42 : -0.42);
      spokes.rod(
        [Math.cos(hubAngle) * 0.042, Math.sin(hubAngle) * 0.042, i % 2 ? 0.050 : -0.050],
        [Math.cos(angle) * 0.474, Math.sin(angle) * 0.474, 0], 0.0045,
      );
    }
    spokes.rod([0.432, 0, 0], [0.468, 0, 0], 0.009);
    spokes.finish();
  }

  const frame = batch(bicycle, mat.mint, 'Enamel diamond frame and paired curved front forks');
  frame.rod([-0.20, 0.79, 0], [-0.65, 1.61, 0], 0.047);
  frame.tube([[-0.61, 1.53, 0], [-0.11, 1.41, 0], [0.39, 1.44, 0], [0.79, 1.62, 0]], 0.041);
  frame.rod([-0.20, 0.79, 0], [0.91, 1.36, 0], 0.048);
  frame.rod([0.78, 1.68, 0], [0.93, 1.33, 0], 0.057);
  for (const side of [-1, 1]) {
    const z = side * 0.11;
    frame.rod([-1.10, 0.59, z], [-0.62, 1.55, side * 0.035], 0.027);
    frame.rod([-1.10, 0.59, z], [-0.20, 0.79, side * 0.080], 0.031);
    frame.tube([[0.86, 1.50, side * 0.095], [0.94, 1.21, side * 0.13],
      [1.00, 0.83, side * 0.14], [1.10, 0.59, side * 0.13]], 0.032);
  }
  frame.finish();
  rod(bicycle, mat.silver, [-0.65, 1.59, 0], [-0.68, 1.74, 0], 0.028, 'Seat post');
  rod(bicycle, mat.silver, [0.78, 1.66, 0], [0.71, 1.87, 0], 0.025, 'Chrome handlebar stem');
  rod(bicycle, mat.mintLight, [0.71, 1.87, 0], [0.80, 1.93, 0], 0.034, 'Handlebar stem cap');
  sphere(bicycle, mat.brass, [0.865, 1.49, 0.060], [0.037, 0.061, 0.012], 'Golden maker badge', -0.36);

  // Real curved mudguards with a wide, shallow oval cross-section, not tire-like tubes.
  function makeFender(x) {
    const points = [];
    const normals = [];
    const indices = [];
    const segments = 40;
    const sides = 8;
    for (let i = 0; i <= segments; i++) {
      const angle = -0.04 + (Math.PI + 0.08) * i / segments;
      for (let j = 0; j <= sides; j++) {
        const sectionAngle = j / sides * TAU;
        const radius = 0.625 + Math.cos(sectionAngle) * 0.016;
        points.push(x + radius * Math.cos(angle), 0.59 + radius * Math.sin(angle), Math.sin(sectionAngle) * 0.105);
        const nr = Math.cos(sectionAngle) / 0.016;
        const nz = Math.sin(sectionAngle) / 0.105;
        const inverse = 1 / Math.hypot(nr, nz);
        normals.push(nr * Math.cos(angle) * inverse, nr * Math.sin(angle) * inverse, nz * inverse);
        if (i < segments && j < sides) {
          const a = i * (sides + 1) + j;
          const b = a + sides + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    mesh(bicycle, geometry, mat.mintLight, x < 0 ? 'Rear sweeping mudguard' : 'Front sweeping mudguard');
  }
  makeFender(-1.10);
  makeFender(1.10);
  const hardware = batch(bicycle, mat.silver, 'Fender stays, rack struts and basket supports');
  for (const x of [-1.10, 1.10]) {
    for (const side of [-1, 1]) {
      for (const angle of [0.47, 2.67]) {
        hardware.rod([x, 0.59, side * 0.12],
          [x + 0.62 * Math.cos(angle), 0.59 + 0.62 * Math.sin(angle), side * 0.10], 0.008);
      }
    }
  }
  for (const side of [-1, 1]) {
    hardware.rod([-1.10, 0.61, side * 0.14], [-1.42, 1.34, side * 0.20], 0.013);
    hardware.rod([-0.66, 1.49, side * 0.06], [-0.80, 1.34, side * 0.20], 0.012);
    hardware.rod([0.89, 1.54, side * 0.17], [1.18, 1.43, side * 0.19], 0.012);
  }
  hardware.finish();
  const rack = batch(bicycle, mat.mint, 'Rear luggage rack');
  rack.tube([[-0.74, 1.35, -0.20], [-1.49, 1.35, -0.20], [-1.53, 1.35, 0],
    [-1.49, 1.35, 0.20], [-0.74, 1.35, 0.20]], 0.018, 32);
  for (let i = 0; i < 5; i++) rack.rod([-0.82 - i * 0.145, 1.35, -0.20], [-0.82 - i * 0.145, 1.35, 0.20], 0.012);
  rack.finish();

  const saddle = mesh(bicycle, loft([
    [-0.94, 1.737, 0.025, 0.070], [-0.83, 1.755, 0.076, 0.206],
    [-0.64, 1.768, 0.069, 0.187], [-0.40, 1.758, 0.046, 0.090], [-0.29, 1.752, 0.023, 0.048],
  ], 24, 12), mat.leather, 'Sculpted brown leather saddle');
  saddle.receiveShadow = true;
  const saddleDetails = batch(bicycle, mat.brass, 'Saddle rivets');
  for (const side of [-1, 1]) {
    for (const x of [-0.84, -0.72]) saddleDetails.sphere([x, 1.79, side * 0.17], [0.013, 0.012, 0.012]);
  }
  saddleDetails.finish();
  const bars = batch(bicycle, mat.silver, 'Swept-back handlebars');
  bars.tube([[0.65, 1.91, -0.43], [0.84, 1.93, -0.29], [0.87, 1.94, 0],
    [0.84, 1.93, 0.29], [0.65, 1.91, 0.43]], 0.023, 32);
  bars.finish();
  for (const side of [-1, 1]) {
    rod(bicycle, mat.leather, [0.59, 1.90, side * 0.445], [0.76, 1.92, side * 0.37], 0.038, 'Leather handlebar grip');
  }
  tube(bicycle, mat.steel, [[0.79, 1.92, 0.25], [1.01, 1.72, 0.20], [0.90, 1.34, 0.13], [1.04, 1.11, 0.09]],
    0.006, 'Front brake cable', 28);

  rod(bicycle, mat.terracotta, [-1.16, 1.505, -0.265], [-1.16, 1.505, 0.265], 0.129, 'Rolled terracotta picnic blanket');
  const blanketEnds = batch(bicycle, mat.scarfHem, 'Spiral blanket ends and woven edge');
  for (const side of [-1, 1]) {
    const spiral = [];
    for (let i = 0; i <= 48; i++) {
      const angle = i / 48 * Math.PI * 4.5;
      const radius = 0.014 + i / 48 * 0.100;
      spiral.push([-1.16 + Math.cos(angle) * radius, 1.505 + Math.sin(angle) * radius, side * 0.268]);
    }
    blanketEnds.tube(spiral, 0.0055, 60);
    torus(bicycle, mat.leather, 0.132, 0.013, [-1.16, 1.505, side * 0.155], 'Blanket leather packing strap', 6, 32);
  }
  blanketEnds.finish();

  // Chain, sprockets and two independently level pedals.
  rod(bicycle, mat.steel, [CRANK_X, CRANK_Y, -0.26], [CRANK_X, CRANK_Y, 0.26], 0.057, 'Bottom bracket axle');
  torus(bicycle, mat.steel, 0.085, 0.012, [-1.10, 0.59, -0.177], 'Rear sprocket', 6, 32);
  tube(bicycle, mat.steel, [[-0.20, 0.965, -0.18], [-1.10, 0.68, -0.18], [-1.185, 0.59, -0.18],
    [-1.10, 0.50, -0.18], [-0.20, 0.615, -0.18], [-0.025, 0.79, -0.18]], 0.010, 'Continuous bicycle chain', 54, true);
  tube(bicycle, mat.mint, [[-1.16, 0.736, -0.197], [-0.89, 0.826, -0.197], [-0.43, 0.993, -0.197],
    [-0.17, 1.022, -0.197], [0.027, 0.916, -0.197]], 0.025, 'Slim enamel chain guard', 36);
  const chainring = new THREE.Group();
  chainring.name = 'Rotating five-arm chainring';
  chainring.position.set(CRANK_X, CRANK_Y, -0.18);
  bicycle.add(chainring);
  torus(chainring, mat.silver, 0.174, 0.014, [0, 0, 0], 'Chainring perimeter', 6, 40);
  const chainringArms = batch(chainring, mat.silver, 'Five polished chainring arms');
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU;
    chainringArms.rod([0, 0, 0], [Math.cos(a) * 0.168, Math.sin(a) * 0.168, 0], 0.017);
  }
  chainringArms.finish();

  const pedalMechanisms = [];
  for (const side of [-1, 1]) {
    const crank = new THREE.Group();
    crank.name = side > 0 ? 'Near rotating crank' : 'Far rotating crank';
    crank.position.set(CRANK_X, CRANK_Y, 0);
    bicycle.add(crank);
    rod(crank, mat.silver, [0, 0, side * 0.265], [CRANK_RADIUS, 0, side * 0.265], 0.025, 'Chrome crank arm');
    rod(crank, mat.steel, [CRANK_RADIUS, 0, side * 0.265], [CRANK_RADIUS, 0, side * 0.425], 0.019, 'Pedal spindle');
    const pedal = new THREE.Group();
    pedal.name = 'Level articulated pedal';
    bicycle.add(pedal);
    sphere(pedal, mat.tire, [0, 0, 0], [0.145, 0.029, 0.103], 'Rounded graphite pedal platform');
    const pedalDetails = batch(pedal, mat.silver, 'Pedal traction rails');
    for (const x of [-0.095, 0, 0.095]) pedalDetails.rod([x, 0.019, -0.087], [x, 0.019, 0.087], 0.007);
    pedalDetails.finish();
    pedalMechanisms.push({ side, crank, pedal });
  }

  // An open wicker basket, modeled weave, and a tiny three-daisy bouquet.
  const basket = new THREE.Group();
  basket.name = 'Open woven wicker basket with daisies';
  bicycle.add(basket);
  const basketWall = mesh(basket, new THREE.CylinderGeometry(0.295, 0.22, 0.41, 32, 1, true), mat.wickerDark, 'Open basket wall');
  basketWall.position.set(1.20, 1.63, 0);
  basketWall.scale.z = 0.88;
  mat.wickerDark.side = THREE.DoubleSide;
  const basketBottom = mesh(basket, new THREE.CylinderGeometry(0.222, 0.222, 0.022, 24), mat.wickerDark, 'Basket floor');
  basketBottom.position.set(1.20, 1.43, 0);
  basketBottom.scale.z = 0.88;
  const weave = batch(basket, mat.wicker, 'Individual wicker ribs and horizontal woven courses');
  for (let row = 0; row < 8; row++) {
    const t = row / 7;
    const radius = 0.224 + t * 0.077;
    const loop = [];
    for (let i = 0; i < 32; i++) {
      const a = i / 32 * TAU;
      loop.push([1.20 + Math.cos(a) * radius, 1.436 + t * 0.408, Math.sin(a) * radius * 0.88]);
    }
    weave.tube(loop, row === 7 ? 0.024 : 0.009, 48, true);
  }
  for (let i = 0; i < 22; i++) {
    const angle = i / 22 * TAU;
    const points = [];
    for (let j = 0; j < 6; j++) {
      const t = j / 5;
      const r = 0.228 + 0.077 * t + Math.sin(t * Math.PI * 8 + i * Math.PI) * 0.003;
      points.push([1.20 + Math.cos(angle) * r, 1.43 + t * 0.41, Math.sin(angle) * r * 0.88]);
    }
    weave.tube(points, 0.010, 12);
  }
  weave.finish();
  const bouquet = new THREE.Group();
  bouquet.name = 'Three little daisies';
  bouquet.position.set(1.22, 1.69, 0);
  bicycle.add(bouquet);
  const stems = batch(bouquet, mat.leaf, 'Daisy stems and little leaves');
  const petals = batch(bouquet, mat.feather, 'Twenty-four sculpted daisy petals');
  const pollen = batch(bouquet, mat.pollen, 'Golden daisy centers');
  const flowers = [[-0.12, 0.40, 0.09], [0.105, 0.49, -0.05], [0.19, 0.31, 0.11]];
  const flowerTransform = new THREE.Object3D();
  const petalTransform = new THREE.Object3D();
  const combined = new THREE.Matrix4();
  for (let f = 0; f < flowers.length; f++) {
    const [x, y, z] = flowers[f];
    stems.tube([[0, -0.05, 0], [x * 0.4, y * 0.55, z * 0.5], [x, y, z]], 0.008, 12);
    stems.sphere([x * 0.5 + 0.042, y * 0.5, z * 0.5], [0.064, 0.021, 0.016], 0.52);
    stems.sphere([x * 0.65 - 0.037, y * 0.68, z * 0.65], [0.057, 0.021, 0.016], -0.66);
    flowerTransform.position.set(x, y, z);
    flowerTransform.rotation.set(-0.25, f === 1 ? 0.72 : 0.28, f * 0.4);
    flowerTransform.updateMatrix();
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * TAU;
      petalTransform.position.set(Math.cos(angle) * 0.058, Math.sin(angle) * 0.058, 0);
      petalTransform.rotation.set(0, 0, angle);
      petalTransform.scale.set(0.049, 0.023, 0.014);
      petalTransform.updateMatrix();
      combined.multiplyMatrices(flowerTransform.matrix, petalTransform.matrix);
      petals.geometry(detailSphere, combined);
    }
    petalTransform.position.set(0, 0, 0.017);
    petalTransform.rotation.set(0, 0, 0);
    petalTransform.scale.set(0.034, 0.034, 0.019);
    petalTransform.updateMatrix();
    combined.multiplyMatrices(flowerTransform.matrix, petalTransform.matrix);
    pollen.geometry(detailSphere, combined);
  }
  stems.finish();
  petals.finish();
  pollen.finish();

  // A real local spotlight follows the bike, including when its parent is transformed.
  rod(bicycle, mat.steel, [1.02, 1.29, 0], [1.31, 1.30, 0], 0.018, 'Headlamp mounting bracket');
  rod(bicycle, mat.mint, [1.245, 1.32, 0], [1.41, 1.32, 0], 0.090, 'Vintage headlamp housing');
  const lampRim = torus(bicycle, mat.brass, 0.077, 0.012, [1.423, 1.32, 0], 'Brass headlamp rim', 8, 32);
  lampRim.rotation.y = Math.PI / 2;
  sphere(bicycle, mat.lamp, [1.425, 1.32, 0], [0.020, 0.070, 0.070], 'Warm headlamp lens');
  sphere(bicycle, mat.reflector, [-1.703, 0.88, 0], [0.018, 0.043, 0.050], 'Rear ruby reflector');
  const headlamp = new THREE.SpotLight(0xffd7a0, 0, 9, 0.48, 0.68, 1.5);
  headlamp.name = 'Night-only warm headlamp';
  headlamp.position.set(1.46, 1.32, 0);
  headlamp.visible = false;
  headlamp.castShadow = false;
  const lampTarget = new THREE.Object3D();
  lampTarget.name = 'Headlamp road target';
  lampTarget.position.set(5.1, 0.15, 0);
  bicycle.add(headlamp, lampTarget);
  headlamp.target = lampTarget;

  const bird = new THREE.Group();
  bird.name = 'Cream pelican · breathing body';
  group.add(bird);
  const body = sphere(bird, mat.cream, [-0.39, 2.17, 0], [0.66, 0.49, 0.425], 'Generous pear-shaped pelican body', -0.12);
  sphere(bird, mat.feather, [-0.18, 2.095, 0], [0.47, 0.385, 0.375], 'Soft breast and belly', -0.14);
  const tail = batch(bird, mat.featherShade, 'Three layered tail feathers');
  for (let i = 0; i < 3; i++) {
    tail.sphere([-1.00 - i * 0.065, 2.09 + i * 0.036, (i - 1) * 0.10], [0.31, 0.081, 0.095], -0.22 - i * 0.08);
  }
  tail.finish();

  const neckCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.015, 2.20, 0), new THREE.Vector3(0.205, 2.40, 0),
    new THREE.Vector3(0.145, 2.66, 0), new THREE.Vector3(0.22, 2.92, 0),
    new THREE.Vector3(0.49, 3.065, 0),
  ]);
  const neckFrames = neckCurve.computeFrenetFrames(40, false);
  const neckPositions = [];
  const neckIndices = [];
  const neckRadii = [0.26, 0.215, 0.153, 0.164, 0.205];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const p = neckCurve.getPointAt(t);
    const ri = Math.min(3, Math.floor(t * 4));
    const f = t * 4 - ri;
    const radius = THREE.MathUtils.lerp(neckRadii[ri], neckRadii[ri + 1], f);
    for (let j = 0; j <= 12; j++) {
      const a = j / 12 * TAU;
      const n = neckFrames.normals[i];
      const b = neckFrames.binormals[i];
      neckPositions.push(p.x + radius * (Math.cos(a) * n.x + Math.sin(a) * b.x),
        p.y + radius * (Math.cos(a) * n.y + Math.sin(a) * b.y),
        p.z + radius * 0.92 * (Math.cos(a) * n.z + Math.sin(a) * b.z));
      if (i < 40 && j < 12) {
        const a0 = i * 13 + j;
        const b0 = a0 + 13;
        neckIndices.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0);
      }
    }
  }
  const neckGeometry = new THREE.BufferGeometry();
  neckGeometry.setAttribute('position', new THREE.Float32BufferAttribute(neckPositions, 3));
  neckGeometry.setIndex(neckIndices);
  neckGeometry.computeVertexNormals();
  mesh(bird, neckGeometry, mat.cream, 'Long sculptural S-curved pelican neck');
  sphere(bird, mat.cream, [0.545, 3.075, 0], [0.325, 0.295, 0.254], 'Rounded pelican head');

  mesh(bird, loft([
    [0.75, 3.055, 0.060, 0.127], [0.91, 3.053, 0.082, 0.153],
    [1.18, 3.029, 0.059, 0.119], [1.56, 2.995, 0.034, 0.071],
    [1.85, 2.951, 0.022, 0.027], [1.93, 2.914, 0.020, 0.009],
  ], 40, 14), mat.bill, 'Very long golden upper bill with hooked tip');
  mesh(bird, loft([
    [0.76, 2.967, 0.058, 0.112], [0.88, 2.825, 0.187, 0.158],
    [1.08, 2.776, 0.211, 0.168], [1.32, 2.819, 0.159, 0.132],
    [1.62, 2.874, 0.078, 0.071], [1.90, 2.909, 0.012, 0.012],
  ], 40, 14), mat.pouch, 'Large hanging peach gular pouch — unmistakably pelican');
  const billDetails = batch(bird, mat.billEdge, 'Bill seam and nostrils on both sides');
  const pouchDetails = batch(bird, mat.pouchShade, 'Delicate pouch folds on both sides');
  for (const side of [-1, 1]) {
    billDetails.tube([[0.79, 2.997, side * 0.125], [1.06, 2.979, side * 0.133],
      [1.45, 2.956, side * 0.092], [1.76, 2.924, side * 0.039], [1.918, 2.913, side * 0.009]], 0.008, 28);
    billDetails.sphere([0.937, 3.069, side * 0.151], [0.027, 0.008, 0.005], -0.08);
    pouchDetails.tube([[0.86, 2.90, side * 0.14], [0.98, 2.748, side * 0.165],
      [1.21, 2.706, side * 0.12], [1.43, 2.813, side * 0.09]], 0.004, 20);
  }
  billDetails.finish();
  pouchDetails.finish();

  const eyes = [];
  const eyeDetails = batch(bird, mat.blush, 'Subtle warm cheek patches');
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.name = side > 0 ? 'Expressive near eye' : 'Expressive far eye';
    eye.position.set(0.607, 3.145, side * 0.235);
    bird.add(eye);
    sphere(eye, mat.white, [0, 0, 0], [0.095, 0.111, 0.034], 'Ivory eye white');
    sphere(eye, mat.pupil, [0.027, 0.001, side * 0.029], [0.049, 0.065, 0.022], 'Bright curious black pupil');
    sphere(eye, mat.white, [0.012, 0.029, side * 0.047], [0.017, 0.021, 0.008], 'White eye catchlight');
    eyes.push(eye);
    eyeDetails.sphere([0.464, 3.014, side * 0.242], [0.061, 0.027, 0.009], 0.18);
  }
  eyeDetails.finish();
  const tufts = batch(bird, mat.feather, 'Three soft swept-back crown feathers');
  tufts.sphere([0.357, 3.383, -0.038], [0.066, 0.180, 0.048], -0.38);
  tufts.sphere([0.279, 3.367, 0.024], [0.057, 0.151, 0.048], -0.65);
  tufts.sphere([0.414, 3.382, 0.035], [0.052, 0.142, 0.042], -0.14);
  tufts.finish();
  tube(bird, mat.navy, [[0.47, 3.29, -0.213], [0.30, 3.28, -0.19], [0.259, 3.285, 0],
    [0.30, 3.28, 0.19], [0.47, 3.29, 0.213]], 0.017, 'Navy aviator-goggle strap', 32);
  for (const side of [-1, 1]) {
    const goggle = new THREE.Group();
    goggle.name = 'Perched navy aviator goggle';
    goggle.position.set(0.523, 3.326, side * 0.163);
    goggle.rotation.x = -side * 0.65;
    bird.add(goggle);
    const rim = torus(goggle, mat.navy, 0.079, 0.016, [0, 0, 0], 'Rounded navy goggle rim', 8, 28);
    rim.scale.x = 1.16;
    sphere(goggle, mat.glass, [0, 0, 0], [0.083, 0.069, 0.012], 'Teal polished goggle lens');
    sphere(goggle, mat.brass, [0.091, 0, 0], [0.016, 0.021, 0.017], 'Goggle brass buckle');
  }

  const wings = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    wing.name = side > 0 ? 'Near layered wing reaching handlebar' : 'Far layered wing reaching handlebar';
    wing.position.set(-0.52, 2.27, side * 0.36);
    bird.add(wing);
    sphere(wing, mat.featherShade, [0.27, -0.12, 0], [0.43, 0.21, 0.112], 'Rounded wing shoulder', -0.25);
    const feathers = batch(wing, mat.feather, 'Five individually layered flight feathers');
    for (let i = 0; i < 5; i++) {
      feathers.sphere([0.55 + i * 0.088, -0.20 - i * 0.033, side * (0.031 + i * 0.008)],
        [0.265, 0.069, 0.061], -0.26 - i * 0.04);
    }
    feathers.finish();
    sphere(wing, mat.feather, [1.17, -0.36, side * 0.043], [0.109, 0.056, 0.071], 'Wing tip curled onto leather grip', -0.17);
    wings.push(wing);
  }

  // A substantial collar and two softly rounded, deforming cloth tails.
  const collar = torus(bird, mat.terracotta, 0.172, 0.052, [0.146, 2.633, 0], 'Terracotta scarf wrapped around neck', 10, 40);
  collar.rotation.x = Math.PI / 2;
  collar.rotation.y = -0.18;
  sphere(bird, mat.terracotta, [-0.071, 2.66, 0.034], [0.11, 0.085, 0.087], 'Soft scarf knot', -0.2);
  const scarfMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.89, vertexColors: true });
  const scarfColor = new THREE.Color('#bb593d');
  const hemColor = new THREE.Color('#e5ab7d');
  const scarves = [];
  function scarfTail(length, width, z, phase) {
    const segments = 24;
    const sides = 8;
    const positions = new Float32Array((segments + 1) * (sides + 1) * 3);
    const colors = new Float32Array(positions.length);
    const indices = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const color = (i === 21 || i === 23) ? hemColor : scarfColor;
      for (let j = 0; j <= sides; j++) {
        const k = (i * (sides + 1) + j) * 3;
        colors[k] = color.r;
        colors[k + 1] = color.g;
        colors[k + 2] = color.b;
        // Initialize a nondegenerate strip; animateScarf supplies its final resting shape.
        const a = j / sides * TAU;
        positions[k] = -0.08 - t * length;
        positions[k + 1] = 2.66 + Math.cos(a) * width;
        positions[k + 2] = z + Math.sin(a) * 0.013;
        if (i < segments && j < sides) {
          const p = i * (sides + 1) + j;
          const q = p + sides + 1;
          indices.push(p, q, p + 1, p + 1, q, q + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    // Conservative fixed local bounds keep deformation from flickering at a frustum edge.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(-0.08 - length * 0.5, 2.65, z), length * 0.65 + 0.30);
    const object = mesh(bird, geometry, scarfMaterial, 'Flowing terracotta scarf tail');
    scarves.push({ object, geometry, positions, length, width, z, phase, segments, sides });
  }
  scarfTail(1.31, 0.096, 0.06, 0);
  scarfTail(1.08, 0.075, -0.08, 1.8);

  function animateScarf(t, speed) {
    const flutter = 0.018 + Math.min(Math.abs(speed) / 28, 1) * 0.055;
    for (const scarf of scarves) {
      for (let i = 0; i <= scarf.segments; i++) {
        const u = i / scarf.segments;
        const lift = Math.min(Math.abs(speed) / 30, 1) * 0.12;
        const cy = 2.66 + Math.sin(u * 3.5 + scarf.phase * 0.2) * 0.10 - 0.19 * u + lift * u
          + Math.sin(t * 5.7 - u * 7.2 + scarf.phase) * flutter * u;
        const cz = scarf.z + 0.075 * Math.sin(u * 4.5 + scarf.phase) * u
          + Math.sin(t * 4.3 - u * 6 + scarf.phase) * flutter * u * 0.75;
        const twist = Math.sin(t * 3.3 - u * 4.4 + scarf.phase) * 0.24 * u;
        const taper = 1 - 0.20 * u;
        for (let j = 0; j <= scarf.sides; j++) {
          const angle = j / scarf.sides * TAU;
          const yy = Math.cos(angle) * scarf.width * taper;
          const zz = Math.sin(angle) * 0.012;
          const k = (i * (scarf.sides + 1) + j) * 3;
          scarf.positions[k] = -0.08 - u * scarf.length;
          scarf.positions[k + 1] = cy + yy * Math.cos(twist) - zz * Math.sin(twist);
          scarf.positions[k + 2] = cz + yy * Math.sin(twist) + zz * Math.cos(twist);
        }
      }
      scarf.geometry.attributes.position.needsUpdate = true;
      scarf.geometry.computeVertexNormals();
    }
  }

  // Webbed feet use a rounded, three-toed silhouette instead of human shoes.
  const footShape = new THREE.Shape();
  footShape.moveTo(-0.105, -0.048);
  footShape.quadraticCurveTo(-0.145, 0, -0.105, 0.048);
  footShape.lineTo(0.075, 0.118);
  footShape.quadraticCurveTo(0.137, 0.147, 0.152, 0.110);
  footShape.lineTo(0.121, 0.046);
  footShape.quadraticCurveTo(0.226, 0.044, 0.214, 0.008);
  footShape.quadraticCurveTo(0.218, -0.032, 0.123, -0.044);
  footShape.lineTo(0.151, -0.105);
  footShape.quadraticCurveTo(0.140, -0.146, 0.072, -0.115);
  footShape.closePath();
  const footGeometry = new THREE.ExtrudeGeometry(footShape, {
    depth: 0.027, bevelEnabled: true, bevelThickness: 0.009, bevelSize: 0.010,
    bevelSegments: 2, curveSegments: 7, steps: 1,
  });
  footGeometry.rotateX(-Math.PI / 2);
  const legs = [];
  for (const mechanism of pedalMechanisms) {
    const side = mechanism.side;
    const upper = mesh(group, cylinderGeometry, mat.feet, 'Articulated orange upper leg');
    const lower = mesh(group, cylinderGeometry, mat.feet, 'Articulated orange lower leg');
    const kneeJoint = sphere(group, mat.feet, [0, 0, 0], [0.048, 0.050, 0.047], 'Rounded knee joint');
    const ankleJoint = sphere(group, mat.feet, [0, 0, 0], [0.039, 0.051, 0.038], 'Rounded ankle joint');
    const foot = new THREE.Group();
    foot.name = side > 0 ? 'Near three-toed webbed foot on pedal' : 'Far three-toed webbed foot on pedal';
    group.add(foot);
    mesh(foot, footGeometry, mat.feet, 'Sculpted orange webbed foot');
    const toes = batch(foot, mat.toe, 'Three subtle webbed toe ridges');
    for (const z of [-0.083, 0, 0.083]) {
      toes.tube([[-0.053, 0.038, 0], [0.039, 0.039, z * 0.5], [z === 0 ? 0.177 : 0.112, 0.037, z]], 0.004, 10);
    }
    toes.finish();
    legs.push({ mechanism, upper, lower, kneeJoint, ankleJoint, foot,
      hip: new THREE.Vector3(), knee: new THREE.Vector3(), ankle: new THREE.Vector3(),
      direction: new THREE.Vector3(), bend: new THREE.Vector3() });
  }

  // The bell is visual-only: a sprung brass dome, three expanding rings, and a wing wiggle.
  rod(bicycle, mat.steel, [0.744, 1.925, 0.29], [0.744, 1.968, 0.29], 0.032, 'Bell mounting clamp');
  const bell = new THREE.Group();
  bell.name = 'Animated brass bicycle bell';
  bell.position.set(0.744, 1.976, 0.29);
  bicycle.add(bell);
  sphere(bell, mat.brass, [0, 0.015, 0], [0.070, 0.043, 0.070], 'Brass bell dome');
  rod(bell, mat.navy, [0.047, -0.009, 0.022], [0.09, 0.025, 0.026], 0.010, 'Bell thumb lever');
  const bellWaves = [];
  const waveGeometry = new THREE.TorusGeometry(0.09, 0.006, 6, 32);
  for (let i = 0; i < 3; i++) {
    const surface = material('#f5d391', 0.45, 0.20);
    surface.emissive.set('#e9b55c');
    surface.emissiveIntensity = 0.35;
    surface.transparent = true;
    surface.depthWrite = false;
    surface.opacity = 0;
    const wave = mesh(bicycle, waveGeometry, surface, 'Bell sound ripple');
    wave.position.set(0.77, 2.07, 0.32);
    wave.castShadow = false;
    wave.receiveShadow = false;
    wave.visible = false;
    bellWaves.push(wave);
  }

  let wheelAngle = 0;
  let crankAngle = -0.45;
  let bellElapsed = Infinity;
  let lastTime = 0;

  function updateLegs(bob) {
    for (const leg of legs) {
      const { mechanism } = leg;
      const angle = crankAngle + (mechanism.side < 0 ? Math.PI : 0);
      const x = CRANK_X + Math.cos(angle) * CRANK_RADIUS;
      const y = CRANK_Y + Math.sin(angle) * CRANK_RADIUS;
      const z = mechanism.side * 0.415;
      mechanism.crank.rotation.z = angle;
      mechanism.pedal.position.set(x, y, z);
      // Pedal and foot stay level while the crank rotates underneath them.
      leg.foot.position.set(x, y + 0.039, z);
      leg.hip.set(-0.405, 1.945 + bob, mechanism.side * 0.345);
      leg.ankle.set(x - 0.035, y + 0.099, z);
      leg.direction.copy(leg.ankle).sub(leg.hip);
      const distance = leg.direction.length();
      leg.direction.multiplyScalar(1 / Math.max(distance, 1e-8));
      const thighLength = 0.73;
      const shinLength = 0.70;
      const along = (thighLength * thighLength - shinLength * shinLength + distance * distance) / (2 * distance);
      const bendHeight = Math.sqrt(Math.max(0, thighLength * thighLength - along * along));
      // Project the forward axis into the plane perpendicular to hip -> ankle.
      leg.bend.set(1, 0, 0).addScaledVector(leg.direction, -leg.direction.x).normalize();
      leg.knee.copy(leg.hip).addScaledVector(leg.direction, along).addScaledVector(leg.bend, bendHeight);
      positionBone(leg.upper, leg.hip, leg.knee, 0.041);
      positionBone(leg.lower, leg.knee, leg.ankle, 0.032);
      leg.kneeJoint.position.copy(leg.knee);
      leg.ankleJoint.position.copy(leg.ankle);
    }
  }

  /** Advance animation. Negative speeds roll and pedal backwards; speed 0 stops both. */
  function update(time = 0, dt = 0, speed = 0) {
    const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const t = Number.isFinite(time) ? time : lastTime + delta;
    lastTime = t;
    const kmh = Number.isFinite(speed) ? speed : 0;
    const angularTravel = (kmh / 3.6 / WHEEL_RADIUS) * delta;
    wheelAngle = (wheelAngle - angularTravel) % TAU;
    crankAngle = (crankAngle - angularTravel * 0.58) % TAU;
    for (const wheel of wheels) wheel.rotation.z = wheelAngle;
    chainring.rotation.z = crankAngle;

    const moving = Math.min(Math.abs(kmh) / 12, 1);
    const breath = Math.sin(t * 1.85);
    const bob = breath * 0.008 + Math.sin(crankAngle * 2) * 0.008 * moving;
    bird.position.y = bob;
    body.scale.y = 0.49 * (1 + breath * 0.008);
    bouquet.rotation.z = Math.sin(t * 2.9) * 0.012 * moving;
    updateLegs(bob);
    animateScarf(t, kmh);

    // Deterministic short blink every 5.7 seconds; the beak and cheeks never squash.
    const blinkPhase = ((t % 5.7) + 5.7) % 5.7;
    const blink = blinkPhase > 4.9 && blinkPhase < 5.08
      ? 1 - 0.94 * Math.sin((blinkPhase - 4.9) / 0.18 * Math.PI) : 1;
    for (const eye of eyes) eye.scale.y = blink;

    if (Number.isFinite(bellElapsed)) bellElapsed += delta;
    const ringing = bellElapsed < 1.1;
    const envelope = ringing ? Math.exp(-bellElapsed * 4.2) : 0;
    bell.rotation.z = ringing ? Math.sin(bellElapsed * 43) * 0.15 * envelope : 0;
    for (let i = 0; i < wings.length; i++) {
      wings[i].position.y = 2.27 - bob;
      wings[i].rotation.z = i === 1 && ringing ? Math.sin(bellElapsed * 24) * 0.046 * envelope : 0;
    }
    for (let i = 0; i < bellWaves.length; i++) {
      const age = bellElapsed - i * 0.12;
      const visible = age >= 0 && age < 0.68;
      const wave = bellWaves[i];
      wave.visible = visible;
      if (visible) {
        const progress = age / 0.68;
        wave.scale.setScalar(0.45 + progress * 3.4);
        wave.material.opacity = 0.62 * (1 - progress) * (1 - progress);
        wave.position.set(0.77 + progress * 0.10, 2.07 + progress * 0.12, 0.32);
      }
    }
  }

  /** Trigger a visual bell flourish. Audio is intentionally left to the host. */
  function ringBell() {
    bellElapsed = 0;
    // Make the first ripple visible even before the host's next animation tick.
    bellWaves[0].visible = true;
    bellWaves[0].scale.setScalar(0.45);
    bellWaves[0].material.opacity = 0.62;
    bellWaves[0].position.set(0.77, 2.07, 0.32);
    for (let i = 1; i < bellWaves.length; i++) bellWaves[i].visible = false;
  }

  /** Switch only this rider's practical lights, never the scene or renderer. */
  function setNight(isNight) {
    const night = Boolean(isNight);
    headlamp.visible = night;
    headlamp.intensity = night ? 24 : 0;
    mat.lamp.emissiveIntensity = night ? 2.5 : 0.06;
    mat.reflector.emissiveIntensity = night ? 0.45 : 0;
  }

  // Initialize the exact same connected pose used by the animation, without starting it.
  update(0, 0, 0);
  setNight(false);
  group.userData.rider = {
    forward: '+X', up: '+Y', speedUnit: 'km/h', timeUnit: 'seconds',
    wheelRadius: WHEEL_RADIUS, axleHeight: 0.59, wheelbase: 2.20,
  };
  return { group, update, ringBell, setNight };
}
