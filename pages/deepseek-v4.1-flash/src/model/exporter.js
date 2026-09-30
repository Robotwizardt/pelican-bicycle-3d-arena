/**
 * exporter.js — 把「鹈鹕 + 自行车」导出为 glTF (.glb) 二进制
 * 用 KeyG 触发：模型带着当下姿态被烘成静态网格，可直接拖进 Blender / three.js 编辑器。
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export async function exportGLB(root, filename = 'pelican-bicycle.glb') {
  const exporter = new GLTFExporter();
  // 导出前临时归零世界变换，保证模型原点在自行车接地点
  const keepPos = root.position.clone();
  const keepQuat = root.quaternion.clone();
  const keepScale = root.scale.clone();
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.scale.setScalar(1);
  root.updateMatrixWorld(true);

  try {
    const out = await exporter.parseAsync(root, {
      binary: true,
      onlyVisible: true,
      truncateDrawRange: true,
      maxTextureSize: 2048,
    });
    const blob = out instanceof ArrayBuffer ? new Blob([out], { type: 'model/gltf-binary' }) : new Blob([JSON.stringify(out)], { type: 'model/gltf+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return blob.size;
  } finally {
    root.position.copy(keepPos);
    root.quaternion.copy(keepQuat);
    root.scale.copy(keepScale);
    root.updateMatrixWorld(true);
  }
}

/** 统计场景三角面 / 网格数（HUD 里显示） */
export function countStats(root) {
  let tris = 0, meshes = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    meshes++;
    const g = o.geometry;
    const n = g.index ? g.index.count : g.attributes.position?.count || 0;
    tris += n / 3;
  });
  return { tris: Math.round(tris), meshes };
}
