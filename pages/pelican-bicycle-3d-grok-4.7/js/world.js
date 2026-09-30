import * as THREE from 'three'
import { mat, paint, tube } from './meshutil.js'

export const TRACK_A = 24
export const TRACK_B = 15.5
const RANGE = 128

export function distToEllipse(x, z, a = TRACK_A, b = TRACK_B) {
  const ang = Math.atan2(z, x)
  const ex = Math.cos(ang) * a
  const ez = Math.sin(ang) * b
  const outside = Math.hypot(x, z) >= Math.hypot(ex, ez) ? 1 : -1
  return outside * Math.hypot(x - ex, z - ez)
}

function hash2(ix, iy) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

function vnoise(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy)
  const b = hash2(ix + 1, iy)
  const c = hash2(ix, iy + 1)
  const d = hash2(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

function fbm(x, y) {
  let v = 0
  let amp = 0.5
  let f = 1
  for (let i = 0; i < 4; i++) {
    v += amp * vnoise(x * f, y * f)
    f *= 2
    amp *= 0.5
  }
  return v
}

function sat(edge0, edge1, x) {
  return THREE.MathUtils.smoothstep(x, edge0, edge1)
}

export function groundHeight(x, z) {
  const r = Math.hypot(x, z)
  const flat = 1 - sat(0.7, 3.6, Math.abs(distToEllipse(x, z)))
  let n = (fbm(x * 0.07 + 2.2, z * 0.07) - 0.45) * 1.35
  n += (fbm(x * 0.19 + 8, z * 0.19) - 0.5) * 0.45
  let h = n * (1 - flat * 0.94)
  const shore = sat(27, 43, r)
  return h * (1 - shore) - shore * shore * 1.7
}

function mulberry32(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sandTexture() {
  const N = 1024
  const canvas = document.createElement('canvas')
  canvas.width = N
  canvas.height = N
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const img = ctx.createImageData(N, N)
  const data = img.data
  for (let py = 0; py < N; py++) {
    const z = (0.5 - py / N) * RANGE
    for (let px = 0; px < N; px++) {
      const x = (px / N - 0.5) * RANGE
      const n = fbm(x * 0.16, z * 0.16)
      const grit = vnoise(x * 4.2, z * 4.2)
      const pebble = vnoise(x * 11, z * 11)
      let r = 206 + n * 16 + (grit - 0.5) * 24 + (pebble - 0.5) * 10
      let g = 176 + n * 14 + (grit - 0.5) * 18 + (pebble - 0.5) * 8
      let b = 126 + n * 8 + (grit - 0.5) * 8
      const rad = Math.hypot(x, z)
      const d = distToEllipse(x, z)
      const ad = Math.abs(d)
      if (rad > 30) {
        const wet = sat(30, 38, rad)
        r += (118 - r) * wet
        g += (96 - g) * wet
        b += (68 - b) * wet
      }
      if (d < -2.2 && n > 0.55) {
        const grass = Math.min(1, (n - 0.55) * 3)
        r += (118 - r) * grass
        g += (138 - g) * grass
        b += (74 - b) * grass
      }
      const band = 1 - sat(0.5, 1.55, ad)
      r += (154 - r) * band
      g += (118 - g) * band
      b += (76 - b) * band
      if (rad > 31 && rad < 37) {
        const foam = (1 - sat(0.15, 1.3, Math.abs(rad - 33.5))) * (0.45 + 0.55 * Math.sin(rad * 2.4 + x * 0.35))
        r += (236 - r) * foam * 0.75
        g += (232 - g) * foam * 0.75
        b += (220 - b) * foam * 0.75
      }
      const i = (py * N + px) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function islandGeometry() {
  const radius = 60
  const rings = 72
  const seg = 140
  const positions = []
  const uvs = []
  const indices = []
  positions.push(0, groundHeight(0, 0), 0)
  uvs.push(0.5, 0.5)
  for (let i = 1; i <= rings; i++) {
    const r = radius * (i / rings)
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      positions.push(x, groundHeight(x, z), z)
      uvs.push(x / RANGE + 0.5, z / RANGE + 0.5)
    }
  }
  for (let j = 0; j < seg; j++) {
    const a = 1 + j
    const b = 1 + ((j + 1) % seg)
    indices.push(0, a, b)
  }
  for (let i = 1; i < rings; i++) {
    const inner = 1 + (i - 1) * seg
    const outer = 1 + i * seg
    for (let j = 0; j < seg; j++) {
      const a = inner + j
      const b = inner + ((j + 1) % seg)
      const c = outer + j
      const d = outer + ((j + 1) % seg)
      indices.push(a, b, d, a, d, c)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

function envMap(renderer) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const g = canvas.getContext('2d')
  const grd = g.createLinearGradient(0, 0, 0, 64)
  grd.addColorStop(0, '#1d4e86')
  grd.addColorStop(0.42, '#f2b07a')
  grd.addColorStop(0.55, '#f8e6cf')
  grd.addColorStop(1, '#b18455')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 64)
  g.fillStyle = '#fff1cc'
  g.beginPath()
  g.arc(40, 30, 7, 0, Math.PI * 2)
  g.fill()
  const tex = new THREE.CanvasTexture(canvas)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  const pmrem = new THREE.PMREMGenerator(renderer)
  const target = pmrem.fromEquirectangular(tex)
  tex.dispose()
  pmrem.dispose()
  return target.texture
}

function grassTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 64
  const g = canvas.getContext('2d')
  g.clearRect(0, 0, 32, 64)
  g.fillStyle = '#6f8f46'
  g.beginPath()
  g.moveTo(16, 2)
  g.quadraticCurveTo(30, 28, 22, 62)
  g.lineTo(16, 48)
  g.lineTo(11, 62)
  g.quadraticCurveTo(2, 28, 16, 2)
  g.fill()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function crossedGrass() {
  const a = new THREE.PlaneGeometry(0.14, 0.32, 1, 1)
  a.translate(0, 0.16, 0)
  const b = a.clone()
  b.rotateY(Math.PI / 2)
  const pa = a.attributes.position.array
  const pb = b.attributes.position.array
  const ua = a.attributes.uv.array
  const ub = b.attributes.uv.array
  const positions = new Float32Array(pa.length + pb.length)
  const uvs = new Float32Array(ua.length + ub.length)
  positions.set(pa, 0)
  positions.set(pb, pa.length)
  uvs.set(ua, 0)
  uvs.set(ub, ua.length)
  const ia = a.index.array
  const ib = b.index.array
  const indices = new Uint16Array(ia.length + ib.length)
  indices.set(ia, 0)
  const off = a.attributes.position.count
  for (let i = 0; i < ib.length; i++) indices[ia.length + i] = ib[i] + off
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeVertexNormals()
  return geo
}

function signTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const g = canvas.getContext('2d')
  g.fillStyle = '#d7b07a'
  g.fillRect(0, 0, 512, 256)
  g.strokeStyle = '#6a4424'
  g.lineWidth = 10
  g.strokeRect(16, 16, 480, 224)
  g.fillStyle = '#3a2415'
  g.textAlign = 'center'
  g.font = '700 72px "Songti SC", "Noto Serif SC", PMingLiU, serif'
  g.fillText('鹈鹕出没', 256, 118)
  g.font = '28px "Avenir Next", "Segoe UI", sans-serif'
  g.fillText('PELICAN CROSSING', 256, 176)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function stripeTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 128
  const g = canvas.getContext('2d')
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#f4f1ea' : '#c4492c'
    g.fillRect(0, i * 16, 16, 16)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}

const skyVert = `
varying vec3 vDir;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDir = world.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const skyFrag = `
varying vec3 vDir;
uniform vec3 uSun;
uniform vec3 uMoon;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uNight;
void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  vec3 day = mix(uHorizon, uZenith, smoothstep(0.0, 0.34, max(h, 0.0)));
  day = mix(day, vec3(0.55, 0.34, 0.28), clamp(-h * 1.4, 0.0, 0.65));
  vec3 nightCol = mix(vec3(0.09, 0.11, 0.16), vec3(0.015, 0.02, 0.05), smoothstep(0.0, 0.7, max(h, 0.0)));
  vec3 col = mix(day, nightCol, uNight);
  float sun = pow(max(dot(dir, normalize(uSun)), 0.0), 700.0);
  float glow = pow(max(dot(dir, normalize(uSun)), 0.0), 3.5);
  col += vec3(1.0, 0.86, 0.62) * (sun * 1.4 + glow * 0.28) * (1.0 - uNight);
  float moon = pow(max(dot(dir, normalize(uMoon)), 0.0), 480.0);
  col += vec3(0.82, 0.86, 1.0) * moon * uNight;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const waterVert = `
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 p = position;
  float w = sin(p.x * 0.045 + uTime * 0.75) * 0.28;
  w += cos(p.y * 0.038 - uTime * 0.55) * 0.2;
  w += sin((p.x + p.y) * 0.02 + uTime * 0.32) * 0.16;
  float dx = cos(p.x * 0.045 + uTime * 0.75) * 0.28 * 0.045;
  dx += cos((p.x + p.y) * 0.02 + uTime * 0.32) * 0.16 * 0.02;
  float dy = -sin(p.y * 0.038 - uTime * 0.55) * 0.2 * 0.038;
  dy += cos((p.x + p.y) * 0.02 + uTime * 0.32) * 0.16 * 0.02;
  p.z += w;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vec3 nLocal = normalize(vec3(-dx, -dy, 1.0));
  vNormal = normalize(mat3(modelMatrix) * nLocal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

const waterFrag = `
varying vec3 vWorld;
varying vec3 vNormal;
uniform vec3 uLight;
uniform vec3 uHorizon;
uniform float uNight;
uniform float uTime;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uLight);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.4);
  float r = length(vWorld.xz);
  float shore = smoothstep(54.0, 34.0, r);
  vec3 deep = mix(vec3(0.035, 0.16, 0.22), vec3(0.015, 0.035, 0.06), uNight);
  vec3 shallow = mix(vec3(0.10, 0.42, 0.46), vec3(0.03, 0.08, 0.1), uNight);
  vec3 col = mix(deep, shallow, shore);
  vec3 sky = mix(uHorizon, vec3(0.55, 0.68, 0.74), fres);
  sky = mix(sky, vec3(0.05, 0.07, 0.1), uNight);
  col = mix(col, sky, fres * 0.7);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), mix(90.0, 36.0, uNight));
  col += mix(vec3(1.0, 0.9, 0.72), vec3(0.7, 0.78, 1.0), uNight) * spec * mix(0.9, 0.4, uNight);
  float edge = smoothstep(1.8, 0.05, abs(r - 45.4));
  float ripple = 0.5 + 0.5 * sin(r * 1.6 - uTime * 1.5 + vWorld.x * 0.2);
  col = mix(col, vec3(0.92, 0.94, 0.9), edge * ripple * (1.0 - uNight * 0.7));
  float dist = length(cameraPosition - vWorld);
  float fogF = smoothstep(48.0, 155.0, dist);
  vec3 fogCol = mix(uHorizon, vec3(0.08, 0.1, 0.14), uNight);
  col = mix(col, fogCol, fogF);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export function buildWorld(renderer, scene) {
  scene.environment = envMap(renderer)
  const horizon = new THREE.Color('#f0b48a')
  const zenith = new THREE.Color('#1f568c')
  scene.fog = new THREE.Fog(horizon.clone(), 48, 155)
  scene.background = horizon

  const sun = new THREE.DirectionalLight('#ffd2a6', 4.4)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -20
  sun.shadow.camera.right = 20
  sun.shadow.camera.top = 20
  sun.shadow.camera.bottom = -20
  sun.shadow.camera.near = 0.5
  sun.shadow.camera.far = 90
  sun.shadow.bias = -0.0003
  sun.shadow.normalBias = 0.045
  scene.add(sun)
  scene.add(sun.target)
  const hemi = new THREE.HemisphereLight('#9ec4de', '#c6a36a', 0.85)
  scene.add(hemi)
  const fill = new THREE.DirectionalLight('#8eb4d4', 0.55)
  scene.add(fill)

  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: new THREE.Vector3(0.78, 0.34, 0.28).normalize() },
      uMoon: { value: new THREE.Vector3(-0.55, 0.62, -0.45).normalize() },
      uZenith: { value: zenith },
      uHorizon: { value: horizon },
      uNight: { value: 0 }
    },
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 20), skyMat)
  sky.frustumCulled = false
  sky.renderOrder = -2
  scene.add(sky)

  const waterMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLight: { value: new THREE.Vector3(0.78, 0.34, 0.28).normalize() },
      uHorizon: { value: horizon },
      uNight: { value: 0 }
    },
    vertexShader: waterVert,
    fragmentShader: waterFrag
  })
  const water = new THREE.Mesh(new THREE.PlaneGeometry(460, 460, 80, 80), waterMat)
  water.rotation.x = -Math.PI / 2
  water.position.y = -0.48
  scene.add(water)

  const ground = new THREE.Mesh(islandGeometry(), new THREE.MeshStandardMaterial({
    map: sandTexture(),
    roughness: 0.97,
    metalness: 0,
    envMapIntensity: 0.18
  }))
  ground.receiveShadow = true
  scene.add(ground)

  const obstacles = []
  const rng = mulberry32(11)

  const grassMat = new THREE.MeshStandardMaterial({
    map: grassTexture(),
    alphaTest: 0.45,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide
  })
  const tufts = []
  for (let i = 0; i < 420; i++) {
    const a = rng() * Math.PI * 2
    const r = 4 + rng() * 40
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (Math.abs(distToEllipse(x, z)) < 2.8) continue
    if (groundHeight(x, z) < -0.15) continue
    tufts.push(x, z)
    if (tufts.length > 320) break
  }
  const grass = new THREE.InstancedMesh(crossedGrass(), grassMat, tufts.length / 2)
  const dummy = new THREE.Object3D()
  const c1 = new THREE.Color('#6d8a3e')
  const c2 = new THREE.Color('#c2b15a')
  for (let i = 0; i < tufts.length; i += 2) {
    dummy.position.set(tufts[i], groundHeight(tufts[i], tufts[i + 1]), tufts[i + 1])
    dummy.rotation.y = rng() * Math.PI
    dummy.scale.setScalar(0.4 + rng() * 0.45)
    dummy.updateMatrix()
    grass.setMatrixAt(i / 2, dummy.matrix)
    grass.setColorAt(i / 2, rng() > 0.8 ? c2 : c1)
  }
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true
  grass.receiveShadow = true
  scene.add(grass)

  const rockMats = ['#6d655c', '#7c7368', '#5a534c'].map((c) => mat(c, 0.96, 0))
  const bark = mat('#6b4a32', 0.9, 0)
  const leaf = mat('#314c32', 0.86, 0)
  for (let i = 0; i < 18; i++) {
    const a = rng() * Math.PI * 2
    const r = 27 + rng() * 14
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (Math.abs(distToEllipse(x, z)) < 3) continue
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + rng() * 0.55, 0), rockMats[i % 3])
    rock.position.set(x, groundHeight(x, z) + 0.15, z)
    rock.rotation.set(rng(), rng(), rng())
    rock.scale.y = 0.6 + rng() * 0.5
    const pos = rock.geometry.attributes.position
    for (let v = 0; v < pos.count; v++) {
      pos.setXYZ(v, pos.getX(v) * (0.85 + rng() * 0.3), pos.getY(v), pos.getZ(v) * (0.85 + rng() * 0.3))
    }
    rock.geometry.computeVertexNormals()
    rock.castShadow = true
    rock.receiveShadow = true
    scene.add(rock)
    obstacles.push({ x, z, r: 0.7 + rock.scale.x * 0.2 })
  }

  for (let i = 0; i < 8; i++) {
    const a = rng() * Math.PI * 2
    const r = 30 + rng() * 8
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (Math.abs(distToEllipse(x, z)) < 3.3) continue
    const h = 2.4 + rng() * 1.6
    const tree = new THREE.Group()
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.16, h, 6), bark)
    trunk.position.y = h / 2
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 0), leaf)
    crown.position.y = h * 0.72
    crown.scale.set(0.75, 1.2, 0.75)
    const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), leaf)
    tip.position.y = h * 0.98
    tree.add(trunk, crown, tip)
    tree.position.set(x, groundHeight(x, z), z)
    tree.rotation.z = (rng() - 0.5) * 0.45
    tree.rotation.y = rng() * 6
    paint(tree)
    scene.add(tree)
    obstacles.push({ x, z, r: 0.55 })
  }

  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2
    const r = 39 + rng() * 4
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.4, 6), bark)
    log.position.set(x, groundHeight(x, z) + 0.08, z)
    log.rotation.z = Math.PI / 2
    log.rotation.y = rng() * 3
    log.castShadow = true
    scene.add(log)
  }

  const lightMat = new THREE.MeshStandardMaterial({
    color: '#f4f1ea',
    map: stripeTexture(),
    roughness: 0.6
  })
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 7.2, 16), lightMat)
  tower.position.y = 3.6
  tower.castShadow = true
  const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.7, 12), mat('#f7f4ef', 0.3, 0.1, {
    emissive: '#ffb15a',
    emissiveIntensity: 0.45
  }))
  lampRoom.position.y = 7.4
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.7, 12), mat('#2d3438', 0.5, 0.4))
  cap.position.y = 8.05
  const rail = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.025, 6, 20), mat('#d5dde2', 0.3, 0.8))
  rail.rotation.x = Math.PI / 2
  rail.position.y = 7.05
  const lighthouse = new THREE.Group()
  lighthouse.add(tower, lampRoom, cap, rail)
  const lx = -36
  const lz = 10
  lighthouse.position.set(lx, groundHeight(lx, lz), lz)
  scene.add(lighthouse)
  obstacles.push({ x: lx, z: lz, r: 1.5 })
  const beacon = new THREE.PointLight('#ffb15a', 2, 22, 2)
  beacon.position.set(lx, lighthouse.position.y + 7.4, lz)
  scene.add(beacon)
  const beamPivot = new THREE.Group()
  beamPivot.position.copy(beacon.position)
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 26, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: '#ffe2a8',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    })
  )
  beam.rotation.x = Math.PI / 2
  beam.position.z = 13
  beamPivot.add(beam)
  scene.add(beamPivot)

  const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 0.06), new THREE.MeshStandardMaterial({
    map: signTexture(),
    roughness: 0.8
  }))
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 6), bark)
  const ang = 0.85
  const sx = Math.cos(ang) * (TRACK_A + 2.6)
  const sz = Math.sin(ang) * (TRACK_B + 2.6)
  const sign = new THREE.Group()
  post.position.y = 0.65
  board.position.y = 1.25
  sign.add(post, board)
  sign.position.set(sx, groundHeight(sx, sz), sz)
  sign.lookAt(0, sign.position.y + 1, 0)
  paint(sign)
  scene.add(sign)
  obstacles.push({ x: sx, z: sz, r: 0.55 })

  const pier = new THREE.Group()
  const deckMat = mat('#b08958', 0.8, 0)
  for (let i = 0; i < 10; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.28), deckMat)
    plank.position.set(0, 0.4, i * 0.32)
    pier.add(plank)
  }
  for (let i = 0; i < 4; i++) {
    pier.add(tube(new THREE.Vector3(-0.6, 0.35, i * 0.9), new THREE.Vector3(-0.6, -1.2, i * 0.9), 0.05, bark, 5))
    pier.add(tube(new THREE.Vector3(0.6, 0.35, i * 0.9), new THREE.Vector3(0.6, -1.2, i * 0.9), 0.05, bark, 5))
  }
  pier.position.set(-30, 0, 22)
  pier.lookAt(-48, 0, 30)
  paint(pier)
  scene.add(pier)

  const buoyGeo = new THREE.SphereGeometry(0.28, 12, 10)
  const buoyMat = mat('#c4492c', 0.45, 0.1)
  const buoys = []
  for (let i = 0; i < 4; i++) {
    const buoy = new THREE.Mesh(buoyGeo, buoyMat)
    const a = i * 1.5 + 0.4
    buoy.position.set(Math.cos(a) * (50 + i * 2), -0.45, Math.sin(a) * 46)
    buoy.castShadow = true
    scene.add(buoy)
    buoys.push(buoy)
  }

  const cloudMat = new THREE.MeshBasicMaterial({ color: '#f7f2ea' })
  const clouds = []
  for (let i = 0; i < 7; i++) {
    const cloud = new THREE.Group()
    const puff = 4 + (i % 3)
    for (let p = 0; p < puff; p++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1.2 + (p % 3) * 0.45, 10, 8), cloudMat)
      s.position.set(p * 1.1 - puff * 0.4, ((p % 2) - 0.5) * 0.4, (p % 2) * 0.3)
      cloud.add(s)
    }
    cloud.position.set(-40 + i * 18, 26 + (i % 3) * 3, -30 + (i % 4) * 16)
    scene.add(cloud)
    clouds.push(cloud)
  }

  const starGeo = new THREE.BufferGeometry()
  const starPos = new Float32Array(180 * 3)
  for (let i = 0; i < 180; i++) {
    const v = new THREE.Vector3(rng() * 2 - 1, rng() * 0.5 + 0.15, rng() * 2 - 1).normalize().multiplyScalar(380)
    starPos.set([v.x, v.y, v.z], i * 3)
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: '#f5f7ff',
    size: 1.7,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false
  }))
  stars.renderOrder = -1
  scene.add(stars)

  function bird() {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), mat('#f4f1ea', 0.7, 0))
    body.scale.set(0.7, 0.55, 1.4)
    const wL = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.16), mat('#d9d3c8', 0.7, 0, { side: THREE.DoubleSide }))
    const wR = wL.clone()
    wL.position.x = -0.32
    wR.position.x = 0.32
    g.add(body, wL, wR)
    g.userData = { wL, wR, phase: rng() * 6, radius: 18 + rng() * 16, y: 7 + rng() * 5, speed: 0.18 + rng() * 0.2 }
    return g
  }
  const seagulls = []
  for (let i = 0; i < 6; i++) {
    const g = bird()
    scene.add(g)
    seagulls.push(g)
  }

  const jumper = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat('#8fd0d8', 0.35, 0.3))
  jumper.scale.set(0.4, 0.7, 1.4)
  jumper.visible = false
  scene.add(jumper)
  let jump = { t: 0, life: 0, x: 0, z: 0, h: 1 }

  const ship = new THREE.Group()
  const hull = new THREE.Mesh(new THREE.BoxGeometry(7, 1.1, 1.6), mat('#3e4650', 0.6, 0.2))
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.2), mat('#d8d2c8', 0.7, 0.1))
  cabin.position.set(-1.4, 0.9, 0)
  ship.add(hull, cabin)
  ship.position.set(88, -0.35, -36)
  scene.add(ship)

  const dayDir = new THREE.Vector3(0.82, 0.36, 0.28).normalize()
  const moonDir = new THREE.Vector3(-0.58, 0.64, -0.42).normalize()
  const lightDir = new THREE.Vector3()

  function update(time, dt, night, focus) {
    sky.position.copy(focus)
    skyMat.uniforms.uNight.value = night
    waterMat.uniforms.uNight.value = night
    waterMat.uniforms.uTime.value = time
    lightDir.copy(dayDir).lerp(moonDir, night).normalize()
    waterMat.uniforms.uLight.value.copy(lightDir)
    const fogCol = horizon.clone().lerp(new THREE.Color('#121820'), night)
    scene.fog.color.copy(fogCol)
    scene.background.copy(fogCol)
    sun.position.copy(focus).addScaledVector(lightDir, 42)
    sun.target.position.copy(focus)
    sun.intensity = 4.4 * (1 - night) + 0.18 * night
    sun.color.set('#ffd2a6').lerp(new THREE.Color('#b9c7ff'), night)
    hemi.intensity = 0.85 * (1 - night) + 0.08 * night
    fill.position.copy(focus).add(-18, 8, -10)
    fill.intensity = 0.55 * (1 - night * 0.8)
    stars.material.opacity = night * 0.9
    beam.material.opacity = night * 0.11
    beamPivot.rotation.y = time * 0.35
    beacon.intensity = 1.2 + night * 6
    lampRoom.material.emissiveIntensity = 0.35 + night * 1.4
    for (let i = 0; i < clouds.length; i++) {
      clouds[i].position.x += dt * (0.35 + i * 0.05)
      if (clouds[i].position.x > 90) clouds[i].position.x = -90
    }
    ship.position.x -= dt * 0.4
    if (ship.position.x < -110) ship.position.x = 110
    for (const buoy of buoys) {
      buoy.position.y = -0.5 + Math.sin(time * 1.3 + buoy.position.x) * 0.12
      buoy.rotation.z = Math.sin(time + buoy.position.z) * 0.15
    }
    for (const g of seagulls) {
      const u = g.userData
      const a = time * u.speed + u.phase
      g.position.set(Math.cos(a) * u.radius, u.y + Math.sin(time * 0.7 + u.phase) * 0.6, Math.sin(a * 0.8) * u.radius)
      g.rotation.y = -a + Math.PI / 2
      const flap = Math.sin(time * 7 + u.phase) * 0.6
      u.wL.rotation.z = 0.3 + flap
      u.wR.rotation.z = -0.3 - flap
    }
    jump.life -= dt
    if (jump.life <= 0 && rng() < dt * 0.25) {
      const a = rng() * Math.PI * 2
      jump = { t: 0, life: 1.25, x: Math.cos(a) * (46 + rng() * 8), z: Math.sin(a) * (40 + rng() * 8), h: 1.1 + rng() }
    }
    if (jump.life > 0) {
      jump.t += dt
      const k = jump.t / 1.25
      jumper.visible = true
      jumper.position.set(jump.x, -0.4 + Math.sin(Math.min(1, k) * Math.PI) * jump.h, jump.z)
      jumper.rotation.x = -k * 4
    } else {
      jumper.visible = false
    }
  }

  return { update, obstacles, lampRoom }
}
