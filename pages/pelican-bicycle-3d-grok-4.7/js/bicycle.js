import * as THREE from 'three'
import { mat, paint, tube } from './meshutil.js'

const WHEEL_R = 0.36
const FRONT_Z = 0.64
const REAR_Z = -0.5
const AXLE_Y = 0.36
const BB = new THREE.Vector3(0, 0.33, 0.02)
const CRANK = 0.15
const CHAIN_R = 0.145
const COG_R = 0.058
const CHAIN_X = 0.11

function wheel(radius, tireMat, metalMat) {
  const group = new THREE.Group()
  const tire = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.045, 12, 40), tireMat)
  tire.rotation.y = Math.PI / 2
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.045, 0.012, 8, 32), metalMat)
  rim.rotation.y = Math.PI / 2
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 12), metalMat)
  hub.rotation.z = Math.PI / 2
  group.add(tire, rim, hub)

  const spokes = 28
  const geo = new THREE.CylinderGeometry(0.0035, 0.0035, radius - 0.05, 4)
  const mesh = new THREE.InstancedMesh(geo, metalMat, spokes)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const dir = new THREE.Vector3()
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2
    dir.set(0, Math.cos(a), Math.sin(a))
    q.setFromUnitVectors(up, dir)
    p.copy(dir).multiplyScalar((radius - 0.05) / 2)
    m.compose(p, q, new THREE.Vector3(1, 1, 1))
    mesh.setMatrixAt(i, m)
  }
  mesh.castShadow = false
  group.add(mesh)
  return group
}

function arch(radius, from, to, segs, tubeR, material, x = 0) {
  const g = new THREE.Group()
  for (let i = 0; i < segs; i++) {
    const t0 = from + ((to - from) * i) / segs
    const t1 = from + ((to - from) * (i + 1)) / segs
    g.add(tube(
      new THREE.Vector3(x, Math.cos(t0) * radius, Math.sin(t0) * radius),
      new THREE.Vector3(x, Math.cos(t1) * radius, Math.sin(t1) * radius),
      tubeR,
      material,
      5
    ))
  }
  return g
}

function sprocket(radius, teeth, material, width) {
  const g = new THREE.Group()
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width, 20), material)
  disc.rotation.z = Math.PI / 2
  disc.castShadow = false
  g.add(disc)
  const toothGeo = new THREE.BoxGeometry(width, 0.028, 0.016)
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2
    const tooth = new THREE.Mesh(toothGeo, material)
    tooth.position.set(0, Math.sin(a) * radius, Math.cos(a) * radius)
    tooth.rotation.x = a
    tooth.castShadow = false
    g.add(tooth)
  }
  return g
}

function modTau(a) {
  const t = Math.PI * 2
  let x = a % t
  if (x < 0) x += t
  return x
}

function arcSweep(a0, a1, target) {
  const ccw = modTau(a1 - a0)
  const rel = modTau(target - a0)
  if (rel <= ccw + 1e-3) return ccw
  return ccw - Math.PI * 2
}

function buildChainPath() {
  const c1z = BB.z
  const c1y = BB.y
  const c2z = REAR_Z
  const c2y = AXLE_Y
  const dx = c2z - c1z
  const dy = c2y - c1y
  const dist = Math.hypot(dx, dy)
  const theta = Math.atan2(dy, dx)
  const phi = Math.acos(THREE.MathUtils.clamp((CHAIN_R - COG_R) / dist, -1, 1))
  const a = theta + phi
  const b = theta - phi
  const upper = Math.sin(a) > Math.sin(b) ? a : b
  const lower = upper === a ? b : a
  const frontOuter = theta + Math.PI
  const rearOuter = theta
  const samples = []

  const pushLine = (z0, y0, z1, y1, n) => {
    for (let i = 0; i < n; i++) {
      const t = i / n
      samples.push({ z: z0 + (z1 - z0) * t, y: y0 + (y1 - y0) * t })
    }
  }
  const pushArc = (cz, cy, r, a0, sweep, n) => {
    for (let i = 0; i < n; i++) {
      const ang = a0 + sweep * (i / n)
      samples.push({ z: cz + Math.cos(ang) * r, y: cy + Math.sin(ang) * r })
    }
  }
  const pz = (ang, r, cz) => cz + Math.cos(ang) * r
  const py = (ang, r, cy) => cy + Math.sin(ang) * r

  pushLine(pz(upper, COG_R, c2z), py(upper, COG_R, c2y), pz(upper, CHAIN_R, c1z), py(upper, CHAIN_R, c1y), 8)
  pushArc(c1z, c1y, CHAIN_R, upper, arcSweep(upper, lower, frontOuter), 14)
  pushLine(pz(lower, CHAIN_R, c1z), py(lower, CHAIN_R, c1y), pz(lower, COG_R, c2z), py(lower, COG_R, c2y), 8)
  pushArc(c2z, c2y, COG_R, lower, arcSweep(lower, upper, rearOuter), 10)

  let total = 0
  for (let i = 0; i < samples.length; i++) {
    const n = samples[(i + 1) % samples.length]
    const len = Math.hypot(n.z - samples[i].z, n.y - samples[i].y)
    samples[i].len = len
    total += len
  }
  return { samples, total }
}

function chainPoint(path, distance) {
  const { samples, total } = path
  let d = ((distance % total) + total) % total
  for (let i = 0; i < samples.length; i++) {
    const seg = samples[i].len
    if (d <= seg || i === samples.length - 1) {
      const n = samples[(i + 1) % samples.length]
      const t = seg < 1e-6 ? 0 : d / seg
      return {
        z: samples[i].z + (n.z - samples[i].z) * t,
        y: samples[i].y + (n.y - samples[i].y) * t,
        tz: n.z - samples[i].z,
        ty: n.y - samples[i].y
      }
    }
    d -= seg
  }
  return { z: BB.z, y: BB.y, tz: 0, ty: 1 }
}

export function createBicycle() {
  const paintMat = mat('#1b4636', 0.42, 0.22)
  const metal = mat('#d5dde2', 0.18, 1)
  const tireMat = mat('#242220', 0.94, 0)
  const saddleMat = mat('#6a3b28', 0.8, 0)
  const cork = mat('#c4aa84', 0.7, 0)
  const brass = mat('#c8922a', 0.32, 0.92)
  const wicker = mat('#b5813f', 0.86, 0)
  const rubber = mat('#2a2724', 0.7, 0.05)
  const fishMat = mat('#d7ecee', 0.35, 0.45)
  const fishFin = mat('#e07a4a', 0.5, 0.1)

  const group = new THREE.Group()

  const rearWheel = wheel(WHEEL_R, tireMat, metal)
  rearWheel.position.set(0, AXLE_Y, REAR_Z)
  const frontWheel = wheel(WHEEL_R, tireMat, metal)

  const fork = new THREE.Group()
  fork.position.set(0, 0, FRONT_Z)
  frontWheel.position.set(0, AXLE_Y, 0)
  fork.add(frontWheel)
  fork.add(tube(new THREE.Vector3(-0.04, AXLE_Y, 0), new THREE.Vector3(-0.015, 0.9, 0), 0.016, metal, 6))
  fork.add(tube(new THREE.Vector3(0.04, AXLE_Y, 0), new THREE.Vector3(0.015, 0.9, 0), 0.016, metal, 6))
  fork.add(tube(new THREE.Vector3(0, AXLE_Y, 0), new THREE.Vector3(0, 1.02, 0), 0.018, metal, 6))

  const barY = 0.98
  fork.add(tube(new THREE.Vector3(-0.28, barY, -0.02), new THREE.Vector3(0.28, barY, -0.02), 0.016, metal, 6))
  fork.add(tube(new THREE.Vector3(-0.28, barY, -0.02), new THREE.Vector3(-0.34, barY - 0.08, 0.08), 0.014, cork, 6))
  fork.add(tube(new THREE.Vector3(0.28, barY, -0.02), new THREE.Vector3(0.34, barY - 0.08, 0.08), 0.014, cork, 6))

  const frontFender = arch(WHEEL_R + 0.07, -1.15, 1.2, 8, 0.012, paintMat)
  frontFender.position.y = AXLE_Y
  fork.add(frontFender)

  const basket = new THREE.Group()
  basket.position.set(0, 0.58, 0.28)
  for (let i = 0; i < 5; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15 + i * 0.012, 0.007, 4, 14), wicker)
    ring.rotation.x = Math.PI / 2
    ring.position.y = -0.06 + i * 0.03
    basket.add(ring)
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.15, 4), wicker)
    rib.position.set(Math.cos(a) * 0.15, 0.01, Math.sin(a) * 0.15)
    basket.add(rib)
  }
  const fish = new THREE.Group()
  const fishBody = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), fishMat)
  fishBody.scale.set(0.42, 0.7, 1.35)
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.09, 4), fishFin)
  tail.rotation.x = Math.PI / 2
  tail.position.z = -0.1
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), mat('#1b1a17', 0.4, 0))
  eye.position.set(0.03, 0.015, 0.04)
  fish.add(fishBody, tail, eye)
  fish.position.set(0, 0.02, 0)
  fish.rotation.y = 0.6
  basket.add(fish)
  fork.add(basket)

  const bell = new THREE.Group()
  bell.position.set(-0.2, barY + 0.03, 0.01)
  const bellDome = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), brass)
  bellDome.rotation.x = Math.PI
  const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 8), metal)
  clapper.position.y = -0.02
  bell.add(bellDome, clapper)
  fork.add(bell)

  const bulbMat = new THREE.MeshStandardMaterial({
    color: '#ffe6c2',
    emissive: '#ffbf70',
    emissiveIntensity: 0.15,
    roughness: 0.35,
    metalness: 0
  })
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), bulbMat)
  bulb.position.set(0, 0.7, 0.22)
  fork.add(bulb)
  const lamp = new THREE.SpotLight('#ffe1b0', 0, 18, Math.PI / 5, 0.45, 2)
  lamp.position.set(0, 0.72, 0.2)
  lamp.target.position.set(0, 0.25, 2.6)
  fork.add(lamp)
  fork.add(lamp.target)

  const rearFender = arch(WHEEL_R + 0.07, -1.25, 1.15, 8, 0.012, paintMat)
  rearFender.position.set(0, AXLE_Y, REAR_Z)
  const reflector = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.01), mat('#c4492c', 0.35, 0.1, { emissive: '#401108', emissiveIntensity: 0.3 }))
  reflector.position.set(0, AXLE_Y + WHEEL_R + 0.02, REAR_Z - 0.08)

  group.add(tube(new THREE.Vector3(0, AXLE_Y, REAR_Z), BB, 0.022, paintMat))
  group.add(tube(new THREE.Vector3(0.03, AXLE_Y, REAR_Z), BB.clone().add(new THREE.Vector3(0.03, 0, 0)), 0.016, paintMat))
  group.add(tube(BB, new THREE.Vector3(0, 0.58, FRONT_Z), 0.024, paintMat))
  group.add(tube(new THREE.Vector3(0, 0.78, -0.14), new THREE.Vector3(0, 0.86, FRONT_Z - 0.02), 0.02, paintMat))
  group.add(tube(new THREE.Vector3(0, AXLE_Y, REAR_Z), new THREE.Vector3(0, 0.74, -0.14), 0.016, paintMat))
  group.add(tube(new THREE.Vector3(0, 0.56, FRONT_Z), new THREE.Vector3(0, 0.9, FRONT_Z), 0.04, paintMat, 10))
  group.add(tube(new THREE.Vector3(0, 0.5, -0.16), new THREE.Vector3(0, 0.8, -0.14), 0.016, metal, 6))

  const saddle = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), saddleMat)
  saddle.scale.set(0.7, 0.38, 1.35)
  saddle.position.set(0, 0.84, -0.16)
  group.add(saddle)

  const crank = new THREE.Group()
  crank.position.copy(BB)
  crank.add(tube(new THREE.Vector3(0.02, 0, 0), new THREE.Vector3(0.16, CRANK, 0), 0.012, metal, 6))
  crank.add(tube(new THREE.Vector3(-0.02, 0, 0), new THREE.Vector3(-0.16, -CRANK, 0), 0.012, metal, 6))
  const chainring = sprocket(CHAIN_R, 16, metal, 0.018)
  chainring.position.x = CHAIN_X
  crank.add(chainring)

  const pedalGeo = new THREE.BoxGeometry(0.075, 0.02, 0.13)
  const pedalR = new THREE.Group()
  pedalR.position.set(0.16, CRANK, 0)
  const pedalRMesh = new THREE.Mesh(pedalGeo, rubber)
  pedalR.add(pedalRMesh)
  const pedalL = new THREE.Group()
  pedalL.position.set(-0.16, -CRANK, 0)
  pedalL.add(new THREE.Mesh(pedalGeo, rubber))
  crank.add(pedalR, pedalL)

  const cog = sprocket(COG_R, 8, metal, 0.016)
  cog.position.set(CHAIN_X, 0, 0)
  rearWheel.add(cog)

  const path = buildChainPath()
  const linkCount = 52
  const link = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.05, 0.018), mat('#2c3134', 0.45, 0.7), linkCount)
  link.castShadow = false
  link.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

  const kick = new THREE.Group()
  kick.position.set(-0.08, 0.34, -0.05)
  kick.add(tube(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.32, 0), 0.01, metal, 5))
  const kickFoot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.06), rubber)
  kickFoot.position.y = -0.32
  kick.add(kickFoot)

  group.add(rearWheel, fork, rearFender, reflector, crank, link, kick)
  paint(group)
  link.castShadow = false

  const dummy = new THREE.Object3D()
  const up = new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3()

  function update(dt, time, state) {
    fork.rotation.y = state.steer
    frontWheel.rotation.x = state.wheelSpin
    rearWheel.rotation.x = state.wheelSpin
    crank.rotation.x = -state.crankAngle
    pedalL.rotation.x = state.crankAngle
    pedalR.rotation.x = state.crankAngle

    const offset = state.crankAngle * CHAIN_R
    const spacing = path.total / linkCount
    for (let i = 0; i < linkCount; i++) {
      const p = chainPoint(path, offset + i * spacing)
      tangent.set(0, p.ty, p.tz)
      if (tangent.lengthSq() < 1e-8) tangent.set(0, 1, 0)
      tangent.normalize()
      dummy.position.set(CHAIN_X, p.y, p.z)
      dummy.quaternion.setFromUnitVectors(up, tangent)
      dummy.scale.set(1, i % 2 ? 0.92 : 1, 1)
      dummy.updateMatrix()
      link.setMatrixAt(i, dummy.matrix)
    }
    link.instanceMatrix.needsUpdate = true

    const parked = Math.abs(state.speed) < 0.25 ? 0.85 : 0.08
    kick.rotation.z = THREE.MathUtils.damp(kick.rotation.z, parked, 8, dt)
    fish.rotation.z = Math.sin(time * 5.2) * 0.45
    fish.position.y = 0.02 + Math.abs(Math.sin(time * 5.2)) * 0.025
    clapper.rotation.z = Math.sin(state.bellT * 46) * Math.exp(-state.bellT * 3.2) * 0.8
    lamp.intensity = state.night * 36
    bulbMat.emissiveIntensity = 0.12 + state.night * 2.2
  }

  return { group, pedalL, pedalR, update, WHEEL_R, REAR_Z, FRONT_Z }
}
