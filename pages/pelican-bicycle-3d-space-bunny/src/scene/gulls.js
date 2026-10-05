/**
 * scene/gulls.js —— 海鸥群（简单但有生气的 flock）
 *
 * 每只海鸥：绕灯塔/岬角按各自的半径与高度做圆周盘旋 + 俯冲 + 翅膀扇动（正弦）+
 * 朝向沿切线。数量控制在 9 只（可用 HUD 调），每只 4 个网格，整体开销极小，
 * 但能让海面上「有东西在动」，是廉价却极其有效的真实感来源。
 */
import * as THREE from 'three';
import { lerp, TAU } from '../util.js';
import { makeFeather } from './geom.js';

export function createGulls(scene, center, count = 9) {
  const group = new THREE.Group();
  group.name = 'gulls';
  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f2f0ea'),
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  const tipMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#3a3a3c'),
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  const beakMat = new THREE.MeshStandardMaterial({ color: '#e8a13c', roughness: 0.6 });

  const gulls = [];
  for (let i = 0; i < count; i++) {
    const g = new THREE.Group();
    const scale = lerp(0.7, 1.15, (i % 5) / 5);
    g.scale.setScalar(scale);

    // 身体
    const bodyGeo = new THREE.SphereGeometry(0.10, 12, 8);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.scale.set(1.5, 0.85, 0.85);
    g.add(body);
    // 头
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), bodyMat);
    head.position.set(0.15, 0.05, 0);
    g.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.08, 6), beakMat);
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.22, 0.04, 0);
    g.add(beak);
    // 尾
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.015, 0.08), bodyMat);
    tail.position.set(-0.18, 0.0, 0);
    g.add(tail);

    // 翅膀：羽毛几何本身沿 +Z 延伸，正好是侧翼方向；左翼直接用，右翼绕 Y 轴翻转
    const wings = [];
    for (const side of [1, -1]) {
      const w = new THREE.Group();
      w.position.set(0.01, 0.045, side * 0.05);
      if (side < 0) w.rotation.y = Math.PI;
      const inner = new THREE.Mesh(makeFeather({ length: 0.30, width: 0.13 }), bodyMat);
      const tip = new THREE.Mesh(makeFeather({ length: 0.34, width: 0.10 }), tipMat);
      tip.position.z = 0.28;
      w.add(inner, tip);
      g.add(w);
      wings.push({ node: w, side });
    }

    // 运动参数
    const gull = {
      group: g,
      wings,
      radius: lerp(18, 46, ((i * 37) % 11) / 10),
      height: lerp(9, 26, ((i * 53) % 13) / 12),
      angle: ((i * 97) % 100) / 100 * TAU,
      speed: lerp(0.16, 0.34, ((i * 29) % 7) / 6),
      flapPhase: i * 1.3,
      flapSpeed: lerp(5.5, 8.5, ((i * 17) % 5) / 4),
      update(dt, t) {
        this.angle += this.speed * dt;
        const x = center.x + Math.cos(this.angle) * this.radius;
        const z = center.z + Math.sin(this.angle) * this.radius;
        // 高度带一点正弦起伏（滑翔时的“波浪”)
        const y = center.y + this.height + Math.sin(t * 0.4 + i) * 2.2;
        g.position.set(x, y, z);
        // 朝向切线
        g.rotation.y = -this.angle - Math.PI / 2;
        g.rotation.z = -0.12 + Math.sin(t * 0.4 + i) * 0.06;
        // 扇翅：绕前后轴 X 上下扑动
        const flap = Math.sin(t * this.flapSpeed + this.flapPhase);
        for (const { node } of this.wings) {
          node.rotation.x = flap * 0.55;
        }
      },
    };
    gulls.push(gull);
    group.add(g);
  }
  scene.add(group);
  return gulls;
}