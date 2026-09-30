/**
 * camera.js — 摄像机导演：多种机位 + 平滑过渡 + 速度感抖动
 */
import * as THREE from 'three';
import { clamp, damp, lerp, TAU } from '../lib/util.js';

export const CAM_MODES = [
  { id: 'chase',  label: '跟随',   pos: [-4.65, 1.55, 0.85], look: [0.35, 0.85, 0], fov: 46 },
  { id: 'close',  label: '追身',   pos: [-1.70, 1.16, 0.42], look: [0.25, 0.95, 0], fov: 50 },
  { id: 'front',  label: '前视',   pos: [2.85, 1.42, 0.75], look: [0.00, 1.00, 0], fov: 48 },
  { id: 'side',   label: '侧掠',   pos: [0.30, 1.55, -5.60], look: [0.18, 0.90, 0], fov: 46 },
  { id: 'low',    label: '低机位', pos: [0.75, 0.46, -1.55], look: [0.10, 0.80, 0], fov: 56 },
  { id: 'wide',   label: '远景',   pos: [-5.20, 3.90, 0.60], look: [0.20, 0.90, 0], fov: 46 },
  { id: 'onboard',label: '骑手视角', pos: [0.30, 1.46, 0.02], look: [2.20, 1.10, 0.02], fov: 62 },
  { id: 'cine',   label: '电影',   pos: [-4.60, 1.75, 1.40], look: [0.20, 1.00, 0], fov: 40 },
];

export class CameraDirector {
  constructor(camera, rig) {
    this.cam = camera;
    this.rig = rig;
    this.modeIndex = 0;
    this.mode = CAM_MODES[0];
    this._pos = new THREE.Vector3().fromArray(CAM_MODES[0].pos);
    this._look = new THREE.Vector3().fromArray(CAM_MODES[0].look);
    this._curPos = new THREE.Vector3();
    this._curLook = new THREE.Vector3();
    this._init = false;
    this.zoom = 1;
    this.auto = false;          // 自动切换机位
    this._autoT = 0;
    this._shake = 0;
    this._fov = 52;
    this._tmp = new THREE.Vector3();
    this._cut = false;
  }

  setMode(i) {
    this.modeIndex = ((i % CAM_MODES.length) + CAM_MODES.length) % CAM_MODES.length;
    this.mode = CAM_MODES[this.modeIndex];
    return this.mode;
  }
  next() { return this.setMode(this.modeIndex + 1); }
  /** 立即到位（切换画质 / 复位时用） */
  snap() { this._init = false; }
  cutNext() { this._cut = true; }

  update(dt, st, focusWorld) {
    if (this.auto) {
      this._autoT -= dt;
      if (this._autoT <= 0) { this._autoT = 7 + Math.random() * 5; this.setMode(this.modeIndex + 1); if (Math.random() < 0.45) this._cut = true; }
    }
    const m = this.mode;
    const zoom = this._zoomTarget ?? 1;
    // 用户拖动 → 环绕 / 俯仰
    const yaw = (st.lookX || 0) * 0.9;
    const pitch = clamp((st.lookY || 0) * 0.6, -0.5, 0.7);
    this._pos.fromArray(m.pos);
    this._look.fromArray(m.look);
    const k = this.rig.scale.x || 1;

    // 环绕：把机位绕焦点旋转，并叠加俯仰
    this._tmp.copy(this._pos).sub(this._look);
    const rotY = new THREE.Matrix4().makeRotationY(yaw);
    const rotX = new THREE.Matrix4().makeRotationZ(pitch * 0.6);
    this._tmp.applyMatrix4(rotY).applyMatrix4(rotX).multiplyScalar(zoom);
    this._pos.copy(this._look).add(this._tmp);

    // 抖动：速度 + 跳跃落地
    const sp = clamp((st.speed || 0) / 12, 0, 1);
    this._shake = damp(this._shake, sp * sp * 0.9 + (st.landKick || 0) * 1.6, 9, dt);
    const t = performance.now() * 0.001;
    const sh = this._shake * 0.05;
    this._pos.x += Math.sin(t * 37.1) * sh;
    this._pos.y += Math.sin(t * 43.7 + 1.3) * sh;
    this._pos.z += Math.sin(t * 51.3 + 2.7) * sh;
    this._look.x += Math.sin(t * 29.3) * sh * 0.6;
    this._look.y += Math.sin(t * 33.9 + 0.7) * sh * 0.6;

    // 车体局部 → 世界
    const wantPos = this._pos.multiplyScalar(k).add(focusWorld);
    const wantLook = this._look.multiplyScalar(k).add(focusWorld);
    wantPos.y = Math.max(wantPos.y, 0.42);

    if (!this._init || this._cut) {
      this._curPos.copy(wantPos); this._curLook.copy(wantLook);
      this._init = true; this._cut = false;
    } else {
      const rate = m.id === 'onboard' ? 14 : 6.5;
      this._curPos.x = damp(this._curPos.x, wantPos.x, rate, dt);
      this._curPos.y = damp(this._curPos.y, wantPos.y, rate, dt);
      this._curPos.z = damp(this._curPos.z, wantPos.z, rate, dt);
      const lr = m.id === 'onboard' ? 16 : 7.5;
      this._curLook.x = damp(this._curLook.x, wantLook.x, lr, dt);
      this._curLook.y = damp(this._curLook.y, wantLook.y, lr, dt);
      this._curLook.z = damp(this._curLook.z, wantLook.z, lr, dt);
    }

    this.cam.position.copy(this._curPos);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this._curLook);

    // 速度感：FOV 推拉 + 轻微滚转
    const fovWant = m.fov + sp * 9 + (st.boost ? 4 : 0) + (st.hopAir ? -3 : 0);
    this._fov = damp(this._fov, fovWant, 4, dt);
    if (Math.abs(this.cam.fov - this._fov) > 0.01) { this.cam.fov = this._fov; this.cam.updateProjectionMatrix(); }
    const roll = -st.steerSmooth * 0.06 + Math.sin(t * 1.7) * 0.01 * sp;
    this.cam.rotateZ(roll);
    return this._fov;
  }
}
