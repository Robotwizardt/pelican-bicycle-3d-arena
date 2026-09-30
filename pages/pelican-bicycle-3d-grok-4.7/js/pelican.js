import * as THREE from 'three'
import { mat } from './meshutil.js'

const L1 = 0.36
const L2 = 0.37

function featherGeometry(length, width) {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.bezierCurveTo(width, length * 0.18, width * 0.28, length * 0.72, 0, length)
  shape.bezierCurveTo(-width * 0.12, length * 0.7, -width * 0.35, length * 0.18, 0, 0)
  const geo = new THREE.ShapeGeometry(shape, 4)
  geo.rotateX(-Math.PI / 2)
  return geo
}

function beakGeometry(length, width, height, hook) {
  const seg = 16
  const slice = 12
  const verts = []
  const idx = []
  for (let i = 0; i <= seg; i++) {
    const t = i / seg
    const z = t * length
    const taper = Math.pow(1 - t, 0.58)
    const w = Math.max(0.0035, width * taper)
    const h = Math.max(0.003, height * Math.pow(1 - t, 0.42))
    const hookY = -hook * t * t * t
    for (let j = 0; j < slice; j++) {
      const a = (j / slice) * Math.PI * 2
      verts.push(Math.cos(a) * w, Math.sin(a) * h * 0.55 + hookY, z)
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < slice; j++) {
      const a = i * slice + j
      const b = i * slice + ((j + 1) % slice)
      const c = (i + 1) * slice + j
      const d = (i + 1) * slice + ((j + 1) % slice)
      idx.push(a, c, b, b, c, d)
    }
  }
  const center = verts.length / 3
  verts.push(0, 0, 0)
  for (let j = 0; j < slice; j++) idx.push(center, (j + 1) % slice, j)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

function footGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0.02)
  shape.lineTo(0.12, 0.16)
  shape.lineTo(0.045, 0.05)
  shape.lineTo(0.1, 0)
  shape.lineTo(0.02, -0.13)
  shape.lineTo(-0.1, 0)
  shape.lineTo(-0.045, 0.05)
  shape.lineTo(-0.12, 0.16)
  shape.closePath()
  const geo = new THREE.ShapeGeometry(shape, 2)
  geo.rotateX(Math.PI / 2)
  geo.translate(0, 0.012, 0.03)
  return geo
}

function limb(length, r0, r1, material) {
  const bone = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, length, 8), material)
  mesh.position.y = length / 2
  mesh.castShadow = true
  bone.add(mesh)
  return bone
}

function orient(bone, parent, fromWorld, toWorld, qParentInv, dir, localFrom) {
  localFrom.copy(fromWorld)
  parent.worldToLocal(localFrom)
  bone.position.copy(localFrom)
  dir.copy(toWorld).sub(fromWorld)
  if (dir.lengthSq() < 1e-8) dir.set(0, -1, 0)
  dir.normalize()
  parent.getWorldQuaternion(qParentInv).invert()
  dir.applyQuaternion(qParentInv)
  bone.quaternion.setFromUnitVectors(UP, dir)
}

const UP = new THREE.Vector3(0, 1, 0)
const _hip = new THREE.Vector3()
const _target = new THREE.Vector3()
const _pole = new THREE.Vector3()
const _knee = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _local = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _qFoot = new THREE.Quaternion()
const _upPedal = new THREE.Vector3()
const _back = new THREE.Vector3()

function solveKnee(hip, target, pole) {
  _dir.copy(target).sub(hip)
  let dist = _dir.length()
  const max = L1 + L2 - 1e-4
  const min = Math.abs(L1 - L2) + 1e-4
  dist = Math.min(max, Math.max(min, dist || min))
  _dir.multiplyScalar(1 / (target.distanceTo(hip) || 1))
  const cosA = THREE.MathUtils.clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1)
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA))
  _pole.copy(pole).sub(hip)
  _pole.addScaledVector(_dir, -_pole.dot(_dir))
  if (_pole.lengthSq() < 1e-8) _pole.set(1, 0, 0)
  _pole.normalize()
  return _knee.copy(hip).addScaledVector(_dir, cosA * L1).addScaledVector(_pole, sinA * L1)
}

export function createPelican() {
  const white = mat('#f6f3ee', 0.72, 0.02, { side: THREE.DoubleSide })
  const shade = mat('#e4ddd2', 0.75, 0.02, { side: THREE.DoubleSide })
  const black = mat('#1c1e22', 0.55, 0.08, { side: THREE.DoubleSide })
  const beakMat = mat('#f08a3c', 0.48, 0.08, { side: THREE.DoubleSide })
  const pouchMat = mat('#e07b45', 0.42, 0.04)
  const loreMat = mat('#f0c14d', 0.55, 0.05)
  const footMat = mat('#ef8b3a', 0.62, 0.04, { side: THREE.DoubleSide })
  const pupilMat = mat('#161514', 0.35, 0.1)
  const sclera = mat('#f7f7f4', 0.3, 0.05)

  const anchor = new THREE.Group()
  const torso = new THREE.Group()
  anchor.add(torso)

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), white)
  body.scale.set(1.05, 0.92, 1.55)
  body.position.set(0, 0.18, -0.04)
  const breast = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), white)
  breast.scale.set(0.95, 0.85, 0.9)
  breast.position.set(0, 0.1, 0.18)
  const back = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), shade)
  back.scale.set(1, 0.7, 1.1)
  back.position.set(0, 0.28, -0.18)
  torso.add(body, breast, back)

  const tailGeo = featherGeometry(0.46, 0.13)
  for (let i = 0; i < 5; i++) {
    const feather = new THREE.Mesh(tailGeo, i === 0 || i === 4 ? shade : white)
    feather.position.set((i - 2) * 0.045, 0.16, -0.32)
    feather.rotation.y = (i - 2) * 0.32
    feather.rotation.x = 0.42
    torso.add(feather)
  }

  function wing(side) {
    const g = new THREE.Group()
    g.position.set(side * 0.16, 0.26, -0.1)
    const shape = new THREE.Shape()
    const s = side
    shape.moveTo(0, 0.12)
    shape.bezierCurveTo(s * 0.35, 0.34, s * 0.9, 0.28, s * 1.2, 0.05)
    shape.bezierCurveTo(s * 0.95, -0.22, s * 0.5, -0.36, s * 0.12, -0.2)
    shape.bezierCurveTo(0, -0.08, 0, 0.02, 0, 0.12)
    const geo = new THREE.ShapeGeometry(shape, 12)
    geo.rotateX(-Math.PI / 2)
    g.add(new THREE.Mesh(geo, white))
    const tip = new THREE.Shape()
    tip.moveTo(s * 0.78, 0.1)
    tip.bezierCurveTo(s * 1.2, 0.2, s * 1.55, 0.06, s * 1.62, -0.06)
    tip.lineTo(s * 1.05, -0.08)
    tip.lineTo(s * 0.78, 0.1)
    const tipGeo = new THREE.ShapeGeometry(tip, 6)
    tipGeo.rotateX(-Math.PI / 2)
    const tipMesh = new THREE.Mesh(tipGeo, black)
    tipMesh.position.y = 0.006
    g.add(tipMesh)
    for (let i = 0; i < 4; i++) {
      const feather = new THREE.Mesh(featherGeometry(0.48, 0.075), black)
      feather.position.set(s * 1.05, 0.012, -0.04)
      feather.rotation.y = s * (0.55 + i * 0.16)
      g.add(feather)
    }
    return g
  }
  const wingR = wing(1)
  const wingL = wing(-1)
  torso.add(wingR, wingL)

  const neckBones = []
  for (let i = 0; i < 4; i++) {
    const radius = 0.1 - i * 0.012
    const bone = limb(0.12, radius, radius * 0.86, white)
    neckBones.push(bone)
    torso.add(bone)
  }

  const head = new THREE.Group()
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 14), white)
  skull.scale.set(1, 0.92, 1.08)
  head.add(skull)

  const upper = new THREE.Mesh(beakGeometry(0.5, 0.075, 0.055, 0.07), beakMat)
  upper.position.set(0, 0.01, 0.06)
  const horn = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), beakMat)
  horn.scale.set(0.45, 1.35, 0.85)
  horn.position.set(0, 0.045, 0.22)
  upper.add(horn)
  const lowerPivot = new THREE.Group()
  lowerPivot.position.set(0, -0.012, 0.07)
  const lower = new THREE.Mesh(beakGeometry(0.46, 0.062, 0.032, 0.015), beakMat)
  lowerPivot.add(lower)
  const pouch = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), pouchMat)
  pouch.scale.set(0.72, 0.55, 1)
  pouch.position.set(0, -0.06, 0.2)
  lowerPivot.add(pouch)
  head.add(upper, lowerPivot)

  function eye(side) {
    const g = new THREE.Group()
    g.position.set(side * 0.055, 0.02, 0.055)
    const lore = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), loreMat)
    lore.scale.set(1, 0.82, 0.7)
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), sclera)
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), pupilMat)
    pupil.position.set(side * 0.006, 0, 0.02)
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }))
    glint.position.set(side * 0.01, 0.01, 0.022)
    g.add(lore, ball, pupil, glint)
    return g
  }
  const eyeL = eye(-1)
  const eyeR = eye(1)
  head.add(eyeL, eyeR)
  torso.add(head)

  const thighL = limb(L1, 0.045, 0.032, footMat)
  const shinL = limb(L2, 0.03, 0.02, footMat)
  const thighR = limb(L1, 0.045, 0.032, footMat)
  const shinR = limb(L2, 0.03, 0.02, footMat)
  const footGeo = footGeometry()
  const footL = new THREE.Group()
  const footR = new THREE.Group()
  footL.add(new THREE.Mesh(footGeo, footMat))
  footR.add(new THREE.Mesh(footGeo, footMat))
  anchor.add(thighL, shinL, footL, thighR, shinR, footR)

  anchor.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true
      obj.receiveShadow = true
    }
  })

  const neck = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3()
  ]
  let blinkClock = 1.6
  let blinkStart = -10
  let beakOpen = 0.02

  function update(dt, time, state) {
    const speed = state.speed
    const bob = Math.sin(state.crank * 2) * 0.016 * Math.min(1, Math.abs(speed) / 2.5)
    torso.position.y = bob
    torso.rotation.x = THREE.MathUtils.damp(torso.rotation.x, -state.accel * 0.035, 4, dt)

    const spread = Math.min(1, Math.abs(speed) / 6) * 0.65 + Math.abs(state.steer) * 0.8 + state.flap * 1
    const lift = Math.sin(time * (3.2 + Math.abs(speed) * 0.35)) * (0.06 + state.flap * 0.45)
    wingR.rotation.z = 0.22 + lift
    wingL.rotation.z = -0.22 - lift
    wingR.rotation.y = -0.72 - spread * 0.2 + state.steer * 0.12
    wingL.rotation.y = 0.72 + spread * 0.2 + state.steer * 0.12

    const turn = state.steer * 0.22
    neck[0].set(0, 0.24, 0.12)
    neck[1].set(turn * 0.2, 0.28, 0.16)
    neck[2].set(turn * 0.55, 0.34, 0.14)
    neck[3].set(turn * 0.85, 0.48, 0.26)
    neck[4].set(turn, 0.58 + Math.sin(time * 1.6) * 0.012, 0.36)
    for (let i = 0; i < neckBones.length; i++) {
      const bone = neckBones[i]
      const a = neck[i]
      const b = neck[i + 1]
      bone.position.copy(a)
      _dir.copy(b).sub(a)
      const len = Math.max(0.04, _dir.length())
      _dir.multiplyScalar(1 / len)
      bone.quaternion.setFromUnitVectors(UP, _dir)
      bone.children[0].scale.y = len / 0.12
      bone.children[0].position.y = len / 2
    }
    head.position.copy(neck[4])
    head.position.y += 0.07 - bob * 0.45
    head.position.z += 0.05
    head.rotation.y = turn * 0.8
    head.rotation.x = -0.12 + Math.sin(time * 1.4) * 0.04

    const wantOpen = state.croak > 0 ? 0.22 : 0.025
    beakOpen = THREE.MathUtils.damp(beakOpen, wantOpen, 10, dt)
    lowerPivot.rotation.x = beakOpen
    const pouchSwing = 0.85 + Math.sin(state.crank * 2) * 0.06 * Math.min(1, Math.abs(speed))
    pouch.scale.y = (0.55 + beakOpen * 0.8) * pouchSwing

    if (time > blinkClock) {
      blinkStart = time
      blinkClock = time + 2.2 + Math.random() * 3.4
    }
    const bt = time - blinkStart
    const blink = bt >= 0 && bt < 0.16 ? Math.sin((bt / 0.16) * Math.PI) : 0
    const sy = 1 - blink * 0.92
    eyeL.scale.y = sy
    eyeR.scale.y = sy

    solveLeg(-1, state.pedalL, thighL, shinL, footL)
    solveLeg(1, state.pedalR, thighR, shinR, footR)
    anchor.updateMatrixWorld(true)
  }

  function solveLeg(side, pedal, thigh, shin, foot) {
    torso.updateWorldMatrix(true, false)
    _hip.set(side * 0.09, 0.02, 0.05)
    torso.localToWorld(_hip)
    pedal.getWorldPosition(_target)
    pedal.getWorldQuaternion(_qFoot)
    _upPedal.set(0, 1, 0).applyQuaternion(_qFoot)
    _back.set(0, 0, -0.035).applyQuaternion(_qFoot)
    _target.addScaledVector(_upPedal, 0.03).add(_back)
    _pole.set(side * 0.7, 0.35, 0.85)
    torso.localToWorld(_pole)
    const knee = solveKnee(_hip, _target, _pole)
    orient(thigh, anchor, _hip, knee, _q, _dir, _local)
    orient(shin, anchor, knee, _target, _q, _dir, _local)
    _local.copy(_target)
    anchor.worldToLocal(_local)
    foot.position.copy(_local)
    anchor.getWorldQuaternion(_q).invert()
    foot.quaternion.copy(_q).multiply(_qFoot)
  }

  return { anchor, head, update }
}
