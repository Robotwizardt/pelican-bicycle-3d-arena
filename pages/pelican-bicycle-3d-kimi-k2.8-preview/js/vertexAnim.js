// 逐顶点（GPU 蒙皮）动画系统
// 不依赖骨骼网格，而是给每段肢体一个"蒙皮盒"（包围盒），
// 顶点按它在盒内的相对位置计算关节旋转后的落点 —— 本质是把 CPU 骨骼蒙皮搬到 vertex shader。
import * as THREE from 'three';

const V = {
  aPart:   new THREE.Vector3(),
  aCenter: new THREE.Vector3(),
  q:       new THREE.Quaternion(),
  invQ:    new THREE.Quaternion(),
  off:     new THREE.Vector3(),
  tmp:     new THREE.Vector3(),
};

// 一段肢体：包围盒 + 世界枢轴点 + 旋转四元数（每帧由调用方写入）
export class Limb {
  /**
   * @param {THREE.Box3} box 该肢体的局部包围盒
   * @param {THREE.Vector3} pivot 关节点（几何局部坐标）
   * @param {number} weight 盒内顶点的最大旋转权重
   */
  constructor(box, pivot, weight = 1) {
    this.box = box;
    this.pivot = pivot.clone();
    this.weight = weight;
    this.quaternion = new THREE.Quaternion(); // 每帧更新
    this.center = box.getCenter(new THREE.Vector3());
    this.half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    // 预计算单位盒内的归一化坐标
    this._unit = new THREE.Vector3();
    this.min = box.min;
  }
}

// 为一组几何体生成逐顶点动画网格
export class Skinned {
  /**
   * @param {THREE.BufferGeometry[]} geoms 肢体几何（都已 translate 到世界摆放位置）
   * @param {Limb[]} limbs 与 geoms 一一对应
   */
  constructor(geoms, limbs, material) {
    this.limbs = limbs;
    this.parts = [];

    const merged = mergeWithAttrs(geoms, limbs);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(merged.positions, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(merged.normals, 3));
    geo.setAttribute('aLimb',    new THREE.BufferAttribute(merged.limbIndex, 1));
    geo.setAttribute('aPart',    new THREE.BufferAttribute(merged.part, 3));

    this.uniforms = {
      uLimbQuat:  { value: limbs.map(l => l.quaternion) },
      uLimbPivot: { value: limbs.map(l => l.pivot) },
      uLimbMin:   { value: limbs.map(l => l.min) },
      uLimbHalf:  { value: limbs.map(l => l.half) },
      uLimbWeight:{ value: limbs.map(l => l.weight) },
    };

    const mat = material.clone();
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aLimb;
          attribute vec3 aPart;
          uniform vec4 uLimbQuat[${limbs.length}];
          uniform vec3 uLimbPivot[${limbs.length}];
          uniform vec3 uLimbMin[${limbs.length}];
          uniform vec3 uLimbHalf[${limbs.length}];
          uniform float uLimbWeight[${limbs.length}];
          vec3 qrot(vec4 q, vec3 v){ return v + 2.0*cross(q.xyz, cross(q.xyz, v) + q.w*v); }
        `)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          {
            int li = int(aLimb + 0.5);
            float w = uLimbWeight[li];
            vec4 q = uLimbQuat[li];
            objectNormal = normalize(mix(objectNormal, qrot(q, objectNormal), w));
          }
        `)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            int li = int(aLimb + 0.5);
            float w = uLimbWeight[li];
            vec4 q = uLimbQuat[li];
            vec3 pivot = uLimbPivot[li];
            vec3 t = transformed - pivot;
            vec3 rotated = qrot(q, t);
            transformed = pivot + mix(t, rotated, w);
          }
        `);
    };
    // 让克隆材质的唯一 program 缓存键不同，避免与普通材质串味
    mat.customProgramCacheKey = () => 'skinned-' + limbs.length;

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; // 顶点在 GPU 上变形，CPU 包围球会失真
  }

  update() {
    // 四元数直接由 Limb 持有，uniform 引用同一对象，无需逐帧拷贝
  }
}

function mergeWithAttrs(geoms, limbs) {
  const positions = [], normals = [], limbIndex = [], part = [];
  geoms.forEach((g, i) => {
    const l = limbs[i];
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    for (let v = 0; v < pos.count; v++) {
      positions.push(pos.getX(v), pos.getY(v), pos.getZ(v));
      normals.push(nor.getX(v), nor.getY(v), nor.getZ(v));
      limbIndex.push(i);
      // 顶点在肢体单位盒内的坐标（0..1），可用于盒内权重渐变
      part.push(
        (pos.getX(v) - l.min.x) / (l.half.x * 2 || 1),
        (pos.getY(v) - l.min.y) / (l.half.y * 2 || 1),
        (pos.getZ(v) - l.min.z) / (l.half.z * 2 || 1),
      );
    }
  });
  return {
    positions: new Float32Array(positions),
    normals:   new Float32Array(normals),
    limbIndex: new Float32Array(limbIndex),
    part:      new Float32Array(part),
  };
}

export const boxFromMesh = (mesh, pad = 0) => {
  mesh.updateMatrixWorld(true);
  const geo = mesh.geometry.clone();
  geo.applyMatrix4(mesh.matrixWorld);
  geo.computeBoundingBox();
  const b = geo.boundingBox.clone();
  if (pad) b.expandByScalar(pad);
  return { box: b, geometry: geo };
};
