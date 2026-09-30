import * as THREE from 'three'

const UP = new THREE.Vector3(0, 1, 0)

export function tube(a, b, radius, material, radial = 8) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, Math.max(len, 1e-4), radial),
    material
  )
  mesh.position.copy(a).add(b).multiplyScalar(0.5)
  if (len > 1e-5) mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize())
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export function mat(color, roughness = 0.62, metalness = 0, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    envMapIntensity: 0.75,
    ...extra
  })
}

export function paint(group) {
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true
      obj.receiveShadow = true
    }
  })
}
