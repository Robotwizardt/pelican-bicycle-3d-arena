import * as THREE from 'three'
import { createAudio } from './audio.js'
import { createBicycle } from './bicycle.js'
import { createPelican } from './pelican.js'
import { TRACK_A, TRACK_B, buildWorld, groundHeight } from './world.js'

const canvas = document.getElementById('c')
const boot = document.getElementById('boot')
const intro = document.getElementById('intro')
const flavorEl = document.getElementById('flavor')
const speedEl = document.getElementById('spd')
const camEl = document.getElementById('cam')
const params = new URLSearchParams(location.search)
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

const lines = [
  '白鹈鹕，初级飞羽是黑的。车速是它自己的事。',
  '篮子里那条鱼，还没放弃。',
  '蹼踏在脚踏上，比锁鞋更理直气壮。',
  '上喙那块角质板，是繁殖季的勋章。',
  '脖子负责瞭望，腿负责里程。',
  '灯塔亮着。它以为那是给自己的。'
]
const camNames = ['跟随', '车筐', '侧影', '鸟瞰', '喙上']

const WHEEL_R = 0.36
const WHEELBASE = 1.14
const GEAR = 0.058 / 0.145
const audio = createAudio()
const keys = Object.create(null)
const state = {
  x: TRACK_A,
  z: 0,
  yaw: 0,
  speed: 3.2,
  steer: 0,
  wheelSpin: 0,
  crankAngle: 0,
  night: params.has('night') ? 1 : 0,
  nightTarget: params.has('night') ? 1 : 0,
  flap: 0,
  croak: 0,
  accel: 0,
  bellT: 10,
  riding: params.has('ride'),
  cam: Math.min(4, Math.max(0, Number(params.get('cam') || 0)))
}
let cruise = 0.35
let shownSpeed = 0
let lineBucket = 0
let paused = false
let clickDebt = 0
let last = performance.now()

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.setClearColor(0xf0b48a)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.08, 900)
const world = buildWorld(renderer, scene)
const bicycle = createBicycle()
const pelican = createPelican()
const lean = new THREE.Group()
const rig = new THREE.Group()
lean.add(bicycle.group)
pelican.anchor.position.set(0, 0.86, -0.1)
lean.add(pelican.anchor)
rig.add(lean)
scene.add(rig)

const dustCount = 48
const dustPos = new Float32Array(dustCount * 3)
const dust = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
  color: '#e6d3b4',
  map: discTexture('rgba(255,248,236,0.95)', 'rgba(255,248,236,0)'),
  size: 0.28,
  transparent: true,
  alphaTest: 0.04,
  opacity: 0.45,
  depthWrite: false,
  sizeAttenuation: true
}))
dust.geometry.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
scene.add(dust)
const motes = Array.from({ length: dustCount }, () => ({ x: 0, y: -8, z: 0, vx: 0, vy: 0, vz: 0, life: 0 }))

function discTexture(inner, outer) {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
  grad.addColorStop(0, inner)
  grad.addColorStop(1, outer)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const blobCanvasTex = discTexture('rgba(50, 36, 22, 0.42)', 'rgba(50, 36, 22, 0)')
const blob = new THREE.Mesh(
  new THREE.CircleGeometry(1.05, 24),
  new THREE.MeshBasicMaterial({ map: blobCanvasTex, transparent: true, depthWrite: false })
)
blob.rotation.x = -Math.PI / 2
blob.renderOrder = 1
scene.add(blob)

const look = { x: 0, y: 0.15, drag: false, lx: 0, ly: 0 }
const desired = new THREE.Vector3()
const target = new THREE.Vector3()
const headPos = new THREE.Vector3()
const rear = new THREE.Vector3()

function placeOnTrack(ang) {
  state.x = Math.cos(ang) * TRACK_A
  state.z = Math.sin(ang) * TRACK_B
  const dx = -TRACK_A * Math.sin(ang)
  const dz = TRACK_B * Math.cos(ang)
  state.yaw = Math.atan2(dx, dz)
}

function beginRide() {
  if (state.riding) {
    audio.resume()
    return
  }
  state.riding = true
  intro.classList.add('hide')
  audio.resume()
}

function cycleCam() {
  state.cam = (state.cam + 1) % camNames.length
  camEl.textContent = camNames[state.cam]
}

function ring() {
  state.bellT = 0
  audio.bell()
}

placeOnTrack(cruise)
if (state.riding) intro.classList.add('hide')
camEl.textContent = camNames[state.cam]
boot.remove()

addEventListener('keydown', (event) => {
  keys[event.code] = true
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault()
  if (!state.riding && event.code !== 'Tab') beginRide()
  if (event.code === 'KeyC') cycleCam()
  if (event.code === 'KeyN') state.nightTarget = state.nightTarget > 0.5 ? 0 : 1
  if (event.code === 'KeyF') {
    state.flap = 1
    audio.whoosh()
  }
  if (event.code === 'KeyV') {
    state.croak = 0.45
    audio.croak()
  }
  if (event.code === 'KeyR') {
    cruise = 0.35
    placeOnTrack(cruise)
    state.speed = 3.2
    state.steer = 0
  }
  if (event.code === 'KeyO') document.body.classList.toggle('clean')
  if (event.code === 'KeyP') paused = !paused
  if (event.code === 'Space') ring()
})
addEventListener('keyup', (event) => {
  keys[event.code] = false
})
addEventListener('blur', () => {
  for (const key of Object.keys(keys)) keys[key] = false
})
document.getElementById('ride').addEventListener('click', beginRide)

function hold(id, code) {
  const el = document.getElementById(id)
  const down = (event) => {
    event.preventDefault()
    keys[code] = true
    beginRide()
  }
  const up = () => {
    keys[code] = false
  }
  el.addEventListener('pointerdown', down)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointerleave', up)
  el.addEventListener('pointercancel', up)
}
hold('t-left', 'ArrowLeft')
hold('t-right', 'ArrowRight')
hold('t-go', 'ArrowUp')
document.getElementById('t-bell').addEventListener('pointerdown', (event) => {
  event.preventDefault()
  beginRide()
  ring()
})

canvas.addEventListener('pointerdown', (event) => {
  look.drag = true
  look.lx = event.clientX
  look.ly = event.clientY
})
addEventListener('pointerup', () => {
  look.drag = false
})
addEventListener('pointermove', (event) => {
  if (!look.drag) return
  look.x += (event.clientX - look.lx) * 0.005
  look.y += (event.clientY - look.ly) * 0.003
  look.y = THREE.MathUtils.clamp(look.y, -0.4, 1.4)
  look.lx = event.clientX
  look.ly = event.clientY
})
canvas.addEventListener('dblclick', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.()
  else document.exitFullscreen?.()
})
addEventListener('resize', () => {
  camera.aspect = innerWidth / Math.max(1, innerHeight)
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

function spawnDust(x, y, z, speed) {
  const mote = motes.find((item) => item.life <= 0)
  if (!mote) return
  mote.life = 0.55
  mote.x = x
  mote.y = y + 0.05
  mote.z = z
  mote.vx = (Math.random() - 0.5) * 0.6 - Math.sin(state.yaw) * speed * 0.15
  mote.vy = 0.4 + Math.random() * 0.8
  mote.vz = (Math.random() - 0.5) * 0.6 - Math.cos(state.yaw) * speed * 0.15
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016)
  last = now
  if (!paused) step(dt)
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}

function step(dt) {
  const time = last / 1000
  state.flap = Math.max(0, state.flap - dt * 0.85)
  state.croak = Math.max(0, state.croak - dt)
  state.bellT += dt
  state.night = THREE.MathUtils.damp(state.night, state.nightTarget, 1.15, dt)

  const left = keys.ArrowLeft || keys.KeyA
  const right = keys.ArrowRight || keys.KeyD
  const forward = keys.ArrowUp || keys.KeyW
  const back = keys.ArrowDown || keys.KeyS
  const boost = keys.ShiftLeft || keys.ShiftRight

  if (!state.riding) {
    const denom = Math.max(4, Math.hypot(TRACK_A * Math.sin(cruise), TRACK_B * Math.cos(cruise)))
    cruise += dt * 3.2 / denom
    placeOnTrack(cruise)
    state.speed = 3.2
    state.steer = THREE.MathUtils.damp(state.steer, 0, 4, dt)
    state.accel = 0
  } else {
    const steerInput = (right ? 1 : 0) - (left ? 1 : 0)
    state.steer = THREE.MathUtils.damp(state.steer, steerInput * 0.36, 7, dt)
    const max = boost ? 10.5 : 6.8
    let accel = 0
    if (forward) accel += boost ? 8 : 5.1
    if (back) accel -= 8
    const prev = state.speed
    if (!forward && !back) {
      const drag = (0.42 + Math.abs(state.speed) * 0.08) * dt
      state.speed -= Math.sign(state.speed) * Math.min(Math.abs(state.speed), drag)
    } else {
      state.speed += accel * dt
      state.speed -= state.speed * 0.12 * dt
    }
    state.speed = THREE.MathUtils.clamp(state.speed, -1.8, max)
    state.accel = (state.speed - prev) / dt
    state.yaw += (state.speed * Math.tan(state.steer) / WHEELBASE) * dt
    if (Math.abs(state.speed) < 0.8) state.yaw += state.steer * 0.55 * dt
    state.x += Math.sin(state.yaw) * state.speed * dt
    state.z += Math.cos(state.yaw) * state.speed * dt
    const rad = Math.hypot(state.x, state.z)
    if (rad > 36) state.speed -= Math.sign(state.speed) * (rad - 36) * 1.5 * dt
    if (rad > 42.5) {
      state.x *= 42.5 / rad
      state.z *= 42.5 / rad
      state.speed *= 0.92
    }
    for (const obstacle of world.obstacles) {
      const dx = state.x - obstacle.x
      const dz = state.z - obstacle.z
      const dist = Math.hypot(dx, dz)
      if (dist < obstacle.r && dist > 1e-4) {
        state.x = obstacle.x + (dx / dist) * obstacle.r
        state.z = obstacle.z + (dz / dist) * obstacle.r
        state.speed *= 0.55
      }
    }
  }

  const spin = (state.speed * dt) / WHEEL_R
  state.wheelSpin += spin
  state.crankAngle += spin * GEAR
  clickDebt += Math.abs(spin * GEAR) * 8
  while (clickDebt > 1) {
    clickDebt -= 1
    if (state.riding && Math.abs(state.speed) > 0.4) audio.click()
  }

  const y = groundHeight(state.x, state.z)
  const ahead = 0.9
  const hf = groundHeight(state.x + Math.sin(state.yaw) * ahead, state.z + Math.cos(state.yaw) * ahead)
  const side = 0.45
  const hr = groundHeight(state.x + Math.cos(state.yaw) * side, state.z - Math.sin(state.yaw) * side)
  const hl = groundHeight(state.x - Math.cos(state.yaw) * side, state.z + Math.sin(state.yaw) * side)
  const pitch = THREE.MathUtils.clamp((y - hf) / ahead, -0.28, 0.28)
  const bank = THREE.MathUtils.clamp((hr - hl) / (side * 2), -0.22, 0.22)
  const steerLean = -state.steer * THREE.MathUtils.clamp(state.speed / 5, -1, 1) * 0.7

  rig.position.set(state.x, y, state.z)
  rig.rotation.y = state.yaw
  lean.rotation.x = reduceMotion ? pitch : THREE.MathUtils.damp(lean.rotation.x, pitch, 6, dt)
  lean.rotation.z = THREE.MathUtils.damp(lean.rotation.z, steerLean + bank, 5, dt)
  bicycle.update(dt, time, state)
  rig.updateMatrixWorld(true)
  pelican.update(dt, time, {
    speed: state.speed,
    steer: state.steer,
    crank: state.crankAngle,
    flap: reduceMotion ? 0 : state.flap,
    croak: state.croak,
    accel: state.accel,
    pedalL: bicycle.pedalL,
    pedalR: bicycle.pedalR
  })

  rear.set(-Math.sin(state.yaw) * 0.55, 0.05, -Math.cos(state.yaw) * 0.55).add(rig.position)
  if (Math.abs(state.speed) > 1.6 && Math.random() < dt * Math.abs(state.speed) * 4) {
    spawnDust(rear.x, y, rear.z, state.speed)
  }
  for (let i = 0; i < motes.length; i++) {
    const mote = motes[i]
    if (mote.life <= 0) {
      dustPos[i * 3 + 1] = -20
      continue
    }
    mote.life -= dt
    mote.vy -= dt * 1.5
    mote.x += mote.vx * dt
    mote.y += mote.vy * dt
    mote.z += mote.vz * dt
    dustPos[i * 3] = mote.x
    dustPos[i * 3 + 1] = mote.y
    dustPos[i * 3 + 2] = mote.z
  }
  dust.geometry.attributes.position.needsUpdate = true
  blob.position.set(state.x, y + 0.03, state.z)

  aimCamera(dt, time, y)
  world.update(time, dt, state.night, rig.position)
  audio.setSpeed(state.speed)

  shownSpeed = THREE.MathUtils.damp(shownSpeed, Math.abs(state.speed) * 3.6, 6, dt)
  speedEl.textContent = shownSpeed.toFixed(0)
  const bucket = Math.floor(time / 8)
  if (bucket !== lineBucket) {
    lineBucket = bucket
    flavorEl.textContent = lines[bucket % lines.length]
  }
}

function aimCamera(dt, time, y) {
  const ox = Math.cos(state.yaw)
  const oz = -Math.sin(state.yaw)
  const fx = Math.sin(state.yaw)
  const fz = Math.cos(state.yaw)
  const bob = reduceMotion ? 0 : Math.sin(state.crankAngle * 2) * 0.02
  if (state.cam === 0) {
    desired.set(
      state.x - fx * 6.3 + ox * look.x * 2.4,
      y + 2.35 + look.y + bob,
      state.z - fz * 6.3 + oz * look.x * 2.4
    )
    target.set(state.x + fx * 1.4, y + 1.15, state.z + fz * 1.4)
  } else if (state.cam === 1) {
    desired.set(state.x + fx * 1.25, y + 1.05, state.z + fz * 1.25)
    target.set(state.x + fx * 8, y + 0.95, state.z + fz * 8)
  } else if (state.cam === 2) {
    desired.set(state.x + ox * 6.2, y + 1.55, state.z + oz * 6.2)
    target.set(state.x, y + 1.05, state.z)
  } else if (state.cam === 3) {
    desired.set(state.x - fx * 1.5 + look.x, y + 12, state.z - fz * 1.5)
    target.set(state.x + fx * 2, y + 0.4, state.z + fz * 2)
  } else {
    pelican.head.getWorldPosition(headPos)
    desired.copy(headPos)
    desired.y += 0.08
    desired.addScaledVector(new THREE.Vector3(fx, 0, fz), 0.22)
    target.set(headPos.x + fx * 6, headPos.y + 0.1 + look.y * 0.2, headPos.z + fz * 6)
  }
  const introT = reduceMotion ? 1 : THREE.MathUtils.smoothstep(time, 0.4, 6.2)
  const wide = new THREE.Vector3(state.x - 16, y + 12, state.z + 18)
  desired.lerp(wide, 1 - introT)
  const k = 1 - Math.exp(-dt * (state.cam === 4 ? 8 : 3.2))
  camera.position.lerp(desired, k)
  camera.lookAt(target)
}

requestAnimationFrame(frame)
