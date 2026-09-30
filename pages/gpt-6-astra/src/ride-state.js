export const LOOP_KM = 1.2;
export const MIN_SPEED = 4;
export const MAX_SPEED = 28;

export function normalizeSpeed(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(number))) : 12;
}

export function createRideState({ reducedMotion = false } = {}) {
  return { playing: !reducedMotion, speed: 12, distance: 0, laps: 0, night: false, sound: false };
}

export function advanceRide(state, deltaSeconds) {
  if (!state.playing || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return false;
  const oldLaps = state.laps;
  state.distance += normalizeSpeed(state.speed) * Math.min(deltaSeconds, 0.1) / 3600;
  state.laps = Math.floor((state.distance + 1e-10) / LOOP_KM);
  return state.laps > oldLaps;
}

export function loopProgress(distance) {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  return (distance % LOOP_KM) / LOOP_KM;
}
