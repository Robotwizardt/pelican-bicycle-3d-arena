/**
 * sim.js — 骑行物理与动画状态（纯数值，无 three 对象）
 * 输出 st（共享动画状态）供 bicycle.update / pelican.update / env / camera 使用。
 */
import { clamp, damp, lerp } from '../lib/util.js';

const GEAR = 3.21;        // 牙盘/飞轮 齿比（与 bicycle.js 的链轮半径一致）
const WHEEL_C = 2 * Math.PI * 0.335;
const GRAV = 9.8;

export class Sim {
  constructor() {
    this.reset();
  }

  reset() {
    this.speed = 0;
    this.dist = 0;
    this.crankAngle = 0;
    this.steer = 0;
    this.steerSmooth = 0;
    this.accel = 0;
    this.brake = 0;
    this.boost = 0;
    this.stamina = 1;
    this.cadence = 0;
    this.hopY = 0;
    this.hopV = 0;
    this.hopAir = false;
    this.landKick = 0;
    this.wingFlap = 0;
    this.bellStrike = 0;
    this.bellWobble = 0;
    this.lampMix = 0;
    this.shades = true;
    this.odo = 0;
    this.chainTension = 0;
    this.fov = 52;
    this.auto = false;
    this.elapsed = 0;
    this.wheelRPS = 0;
    this._prevSpeed = 0;
  }

  /** 驱动一帧：input.state → st */
  update(dt, inp, opts = {}) {
    dt = Math.min(dt, 1 / 30);
    this.elapsed += dt;
    const S = this;

    /* ---------- 动力 ---------- */
    const boosting = inp.boost > 0.5 && S.stamina > 0.02 && inp.throttle > 0.05;
    S.stamina = clamp(S.stamina + (boosting ? -0.30 : 0.16) * dt, 0, 1);
    const boostK = 1 + inp.boost * 0.42;

    const drive = inp.throttle;
    let torque = 0;
    if (drive > 0) torque = 2.65 * boostK * drive * (1 - clamp(Math.abs(S.speed) / 24, 0, 0.95));
    else if (drive < 0) torque = 2.0 * drive;                       // 倒踩 / 低速后退

    const ground = !S.hopAir;
    if (ground) {
      const drag = 0.0052 * S.speed * Math.abs(S.speed) + 0.055 * S.speed + Math.sign(S.speed) * 0.36;
      S.speed += (torque - drag) * dt;
      S.speed -= inp.brake * clamp(S.speed, 0, 99) * 0.85 * dt;      // 刹车
      if (Math.abs(S.speed) < 0.06 && Math.abs(drive) < 0.05 && inp.brake > 0.05) S.speed = 0;
    } else {
      S.speed += torque * 0.35 * dt;                                // 空中无力
    }
    S.speed = clamp(S.speed, -3.0, 20.5);

    // 加速度（平滑，供姿态使用）
    const rawAcc = (S.speed - S._prevSpeed) / Math.max(dt, 1e-3);
    S._prevSpeed = S.speed;
    S.accel = damp(S.accel, clamp(rawAcc, -8, 8), 6, dt);

    /* ---------- 转向 ---------- */
    // 速度越高转向越钝；低速更灵敏
    const steerAuth = lerp(1.0, 0.42, clamp(S.speed / 12, 0, 1));
    S.steer = damp(S.steer, clamp(inp.steer, -1, 1) * steerAuth, 7, dt);
    S.steerSmooth = damp(S.steerSmooth, S.steer, 4.2, dt);

    /* ---------- 跳跃 ---------- */
    if (opts.hop && ground && S.speed > 1.2) {
      S.hopV = 3.35 + Math.min(S.speed, 12) * 0.055;
      S.hopAir = true;
      this.bellStrike = 0.5;
    }
    if (S.hopAir) {
      S.hopV -= GRAV * dt;
      S.hopY += S.hopV * dt;
      if (S.hopY <= 0) {
        const impact = Math.abs(S.hopV);
        S.hopY = 0; S.hopV = 0; S.hopAir = false;
        S.landKick = clamp(impact / 5.2, 0, 1);
      }
    }
    S.landKick = damp(S.landKick, 0, 7, dt);
    S.wingFlap = damp(S.wingFlap, S.hopAir ? 1 : (S.landKick > 0.35 ? 0.55 : 0), S.hopAir ? 6 : 3.2, dt);

    /* ---------- 里程 / 曲柄 ---------- */
    S.dist += S.speed * dt;
    S.odo += Math.max(0, S.speed) * dt;
    S.wheelRPS = S.speed / WHEEL_C;
    const crankRPS = S.wheelRPS / GEAR;
    S.crankAngle += crankRPS * Math.PI * 2 * dt;
    S.cadence = Math.abs(crankRPS) * 60;
    S.chainTension = clamp(0.25 + Math.abs(torque) * 0.45 + S.speed * 0.03, 0, 1);

    /* ---------- 铃铛 ---------- */
    S.bellStrike = damp(S.bellStrike, 0, 4.5, dt);
    S.bellWobble = Math.sin(S.elapsed * 34) * S.bellStrike * 0.5;

    /* ---------- 车灯 ---------- */
    S.brake = inp.brake;
    S.boost = inp.boost;

    /* ---------- 装配 st ---------- */
    this.st = {
      speed: S.speed, accel: S.accel, brake: inp.brake, boost: S.boost > 0.5,
      crankAngle: S.crankAngle, cadence: S.cadence, steer: S.steer, steerSmooth: S.steerSmooth,
      hopY: S.hopY, hopAir: S.hopAir, landKick: S.landKick, wingFlap: S.wingFlap,
      bellStrike: S.bellStrike, bellWobble: S.bellWobble, chainTension: S.chainTension,
      lampMix: S.lampMix, shades: S.shades, speedKmh: S.speed * 3.6,
      pitchBoost: (S.hopAir ? -0.11 : 0) + S.landKick * 0.06 - clamp(S.accel * 0.004, -0.05, 0.05),
      lookDir: opts.lookDir || null,
      grips: [null, null], pedals: [null, null],
    };
    return this.st;
  }
}
