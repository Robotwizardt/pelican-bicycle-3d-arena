import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorld } from '../src/world.js';
import { createRider } from '../src/rider.js';

function inspect(group) {
  let meshes = 0, geometryCount = 0;
  const uniqueGeometries = new Set();
  group.updateMatrixWorld(true);
  group.traverse(object => {
    assert.ok(object.matrixWorld.elements.every(Number.isFinite), `${object.name} transform must be finite`);
    if (object.isMesh) {
      meshes++;
      uniqueGeometries.add(object.geometry);
      for (const value of object.geometry.attributes.position.array) assert.ok(Number.isFinite(value), `${object.name} vertex must be finite`);
    }
  });
  geometryCount = uniqueGeometries.size;
  return { meshes, geometryCount };
}

test('procedural rider and coastal environment initialize without external assets', () => {
  const rider = createRider();
  const world = createWorld();
  assert.ok(rider.group instanceof THREE.Group);
  assert.ok(world.group instanceof THREE.Group);
  assert.ok(world.rotatingIsland.parent === world.group);
  assert.equal(world.group.userData.road.surfaceY, .14);
  assert.ok(inspect(rider.group).meshes < 160);
  assert.ok(inspect(world.group).meshes < 130);
});

test('animations keep all coordinates finite and geometry allocations stable', () => {
  const rider = createRider();
  const world = createWorld();
  const riderBefore = inspect(rider.group);
  const worldBefore = inspect(world.group);
  for (let frame = 0; frame < 300; frame++) {
    const speed = frame < 100 ? 28 : frame < 200 ? 0 : -8;
    rider.update(frame / 60, 1 / 60, speed);
    world.update(frame / 60, 1 / 60, speed);
    if (frame === 20) { rider.ringBell(); rider.setNight(true); world.setNight(true); }
    if (frame === 180) { rider.setNight(false); world.setNight(false); }
  }
  assert.deepEqual(inspect(rider.group), riderBefore);
  assert.deepEqual(inspect(world.group), worldBefore);
});

test('island moves beneath the stationary rider and stops at zero speed', () => {
  const world = createWorld();
  world.update(1, 1, 12);
  assert.ok(Math.abs(world.rotatingIsland.rotation.y + .1) < 1e-8);
  world.update(2, 1, 0);
  assert.ok(Math.abs(world.rotatingIsland.rotation.y + .1) < 1e-8);
});
