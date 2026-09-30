/**
 * env.js — 光照 / 雾 / 环境反射（IBL）
 *   · 半球光 + 平行光（阳光，带阴影相机，跟随主体）
 *   · 天空盒 PMREM 环境贴图：按时间段节流重建，让金属部件有真实反射
 */
import * as THREE from 'three';

export class Environment {
  constructor(renderer, scene, { shadowSize = 2048, quality = 'high' } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = quality;
    this.night = 0;

    scene.fog = new THREE.Fog(0xcfe0ea, 30, 250);

    // 环境光：主体由天空 PMREM（IBL）提供，解析光只做补充，避免与 IBL 双重计光而洗白画面
    this.hemi = new THREE.HemisphereLight(0xbfd8ef, 0x6b5a44, 0.25);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.0);
    this._shadowAllowed = shadowSize > 0;
    this.sun.castShadow = shadowSize > 0;
    this.sun.shadow.mapSize.set(shadowSize || 1024, shadowSize || 1024);
    const s = 14;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 60;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sun, this.sunTarget);
    this.sun.target = this.sunTarget;
    this._sunDir = new THREE.Vector3(0, 1, 0);

    // 补光（避免背光面全黑）
    this.fill = new THREE.DirectionalLight(0x9fc0e8, 0.10);
    this.fill.position.set(-4, 3, -3);
    scene.add(this.fill);

    // 地面反弹光
    this.bounce = new THREE.DirectionalLight(0xd8c39a, 0.06);
    this.bounce.position.set(0, -1, 0);
    scene.add(this.bounce);
    scene.environmentIntensity = 0.55;   // IBL 总强度（three r163+；r186 支持）

    // PMREM
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this._envScene = new THREE.Scene();
    this._envDirty = true;
    this._envTimer = 0;

    // 后期光晕用的太阳屏幕位置
    this.sunDir = this._sunDir;
  }

  setSun(dir, { intensity, color }) {
    this.sun.castShadow = this._shadowAllowed && intensity > 0.45;
    this._sunDir.copy(dir);
    this.sun.position.copy(dir).multiplyScalar(30);
    this.sun.intensity = intensity;
    this.sun.color.copy(color);
    this.sunSpriteVisible = intensity > 0.3;
  }
  setAmbient(v) {
    this.hemi.intensity = v * 0.25;
    this.fill.intensity = 0.03 + v * 0.07;
    this.bounce.intensity = 0.02 + v * 0.05;
    this.scene.environmentIntensity = 0.22 + v * 0.60;   // 白天 IBL 为主，夜里靠解析光
  }
  setNight(n) { this.night = n; }

  /** 用天空 shader 的材质烘一张环境贴图（节流：仅在时间变化后重建） */
  refreshEnvMap(skyMesh, force = false) {
    if (!this._envDirty) return;
    const now = performance.now();
    if (!force && now - (this._envBakedAt || 0) < 260) return;   // 节流：拖时间滑杆时不卡顿
    this._envDirty = false;
    this._envBakedAt = now;
    const m = skyMesh.material;
    const geo = new THREE.SphereGeometry(50, 24, 16);
    const mesh = new THREE.Mesh(geo, m);
    this._envScene.add(mesh);
    const rt = this.pmrem.fromScene(this._envScene, 0.04, 0.1, 200);
    this.scene.environment = rt.texture;
    if (this._prevRT) this._prevRT.dispose();
    this._prevRT = rt;
    this._envScene.remove(mesh);
    geo.dispose();
  }

  markEnvDirty() { this._envDirty = true; }

  update(dt, focus, elapsed) {
    // 阴影相机跟随
    this.sunTarget.position.copy(focus);
    this.sun.position.copy(this._sunDir).multiplyScalar(30).add(focus);
    this.sun.shadow.camera.updateProjectionMatrix();
    // 阴影范围随质量
    if (this.sun.castShadow) {
      const s = this.quality === 'low' ? 9 : 14;
      if (this.sun.shadow.camera.right !== s) {
        this.sun.shadow.camera.left = -s; this.sun.shadow.camera.right = s;
        this.sun.shadow.camera.top = s; this.sun.shadow.camera.bottom = -s;
        this.sun.shadow.camera.updateProjectionMatrix();
      }
    }
  }

  setQuality(q) {
    this.quality = q;
    this._shadowAllowed = q !== 'low';
    this.sun.castShadow = this._shadowAllowed;
    this.pmrem.dispose?.();
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.markEnvDirty();
  }
}
