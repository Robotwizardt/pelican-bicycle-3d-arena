import test from 'node:test';
import assert from 'node:assert/strict';
import { createRideState, advanceRide, normalizeSpeed, loopProgress, LOOP_KM } from '../src/ride-state.js';

test('speed is finite, integer, and constrained to the UI range', () => {
  assert.equal(normalizeSpeed(100), 28);
  assert.equal(normalizeSpeed(-10), 4);
  assert.equal(normalizeSpeed('18'), 18);
  assert.equal(normalizeSpeed(12.7), 13);
  assert.equal(normalizeSpeed(NaN), 12);
  assert.equal(normalizeSpeed(Infinity), 12);
});
test('reduced motion starts the island paused', () => {
  assert.equal(createRideState({ reducedMotion: true }).playing, false);
  assert.equal(createRideState().playing, true);
});
test('distance accurately integrates kilometres per hour', () => {
  const state = createRideState();
  for (let i = 0; i < 600; i++) advanceRide(state, 0.1);
  assert.ok(Math.abs(state.distance - 0.2) < 1e-10);
});
test('paused trips and invalid deltas never increase distance', () => {
  const state = createRideState({ reducedMotion: true });
  advanceRide(state, 0.1);
  assert.equal(state.distance, 0);
  state.playing = true;
  for (const dt of [-1, NaN, Infinity, 0]) assert.equal(advanceRide(state, dt), false);
  assert.equal(state.distance, 0);
});
test('background-tab jumps are capped rather than counting as ride time', () => {
  const state = createRideState();
  advanceRide(state, 3600);
  assert.ok(state.distance < 0.001);
});
test('lap completion is emitted exactly once at the boundary', () => {
  const state = createRideState();
  state.distance = LOOP_KM - 0.0001;
  assert.equal(advanceRide(state, 0.1), true);
  assert.equal(state.laps, 1);
  assert.equal(advanceRide(state, 0.1), false);
});
test('route progress wraps cleanly and rejects invalid inputs', () => {
  assert.equal(loopProgress(0), 0);
  assert.equal(loopProgress(0.6), 0.5);
  assert.equal(loopProgress(1.2), 0);
  assert.ok(Math.abs(loopProgress(1.8) - 0.5) < 1e-10);
  assert.equal(loopProgress(-1), 0);
  assert.equal(loopProgress(NaN), 0);
});
