/**
 * state/ride.js —— 骑乘系统（本作的「导演」）
 *
 * 负责：
 *  1) 沿赛道推进：速度/坡度/弯道 → 车身姿态（侧倾/俯仰/转向）、车轮与曲柄转动
 *  2) 鹈鹕的两骨 IK：脚永远踩在脚踏上（这是全片最该被看清的细节 —— 蹼足压踏板）
 *  3) 脚本化停靠：钓鱼点 → 邮局投递 → 灯塔；每个停靠都有独立的表演
 *  4) 相机模式：追尾 / 鹈鹕第一人称 / 电影环绕 / 自由
 *  5) 海鸥群：绕灯塔盘旋 + 扇翅
 *  6) 事件回调：onEvent('fish'|'deliver'|'lap'|'mode') → 主程序据此改 HUD 与时间
 *
 * 速度模型：极简自行车动力学 —— 踩踏功率 → 加速度 → 阻力(滚阻+风阻+坡度) → 限速，
 * 因此「踩得越用力越快，但上坡会掉速」，与真实体验一致。
 */
import * as THREE from 'three';
import { clamp, clamp01, damp, dampAngle, lerp, smoothstep, TAU, wrap } from '../util.js';
import { PELICAN } from '../creature/pelican.js';
import { BIKE } from '../creature/bicycle.js';

const MODE = {
  INTRO: 'intro',
  CRUISE: 'cruise',
  FISH: 'fish',
  DELIVER: 'deliver',
  LIGHT: 'light',
  FLIGHT: 'flight',
};

export { MODE };

export function createRide({ scene, cape, lighthouse, bike, pelican, camera, controls, audio, gulls }) {
  const track = cape.track;
  const group = new THREE.Group();
  group.name = 'ride';
  scene.add(group);
  group.add(bike.root);

  const state = {
    mode: MODE.INTRO,
    s: 0,
    speed: 0,
    /** 曲柄角（rad），用于计算两只脚的踏板位置 */
    crank: 0,
    /** 累计里程（不绕圈，用于里程表） */
    odometer: 0,
    /** 自动模式的油门 0..1 */
    throttle: 0.62,
    manual: false,
    manualThrottle: 0,
    brake: 0,
    /** 当前停靠点索引 */
    stopIndex: -1,
    /** 停靠表演计时 */
    stopTimer: 0,
    /** 脚本时间线（intro/flight 用） */
    timeline: 0,
    /** 飞行动画参数 */
    flightAngle: 0,
    flightRadius: 34,
    flightHeight: 0,
    lapCount: 0,
    lastLapS: 0,
    /** 统计 */
    fish: 0,
    delivered: 0,
    /** 表现参数（可被外部调） */
    cadenceScale: 1.0,
    /** 巡航速度上限（m/s） */
    vMax: 9.5,
    pedalRatio: 2.6, // 曲柄每转一圈车前进 wheelR*TAU*ratio 米
  };

  /* ---------------- 停靠脚本 ---------------- */
  const STOPS = [
    { t: 0.635, type: 'fish', hold: 7.0, label: '断崖钓鱼点' },
    { t: 0.715, type: 'deliver', hold: 6.0, label: '灯塔邮局' },
    { t: 0.055, type: 'light', hold: 5.0, label: '灯塔平台' },
  ].map((s) => ({ ...s, s: s.t * track.length, done: false }));

  const listeners = [];
  const onEvent = (fn) => listeners.push(fn);
  const emit = (type, data) => {
    for (const fn of listeners) fn(type, data);
  };

  /* ---------------- 鹈鹕初始挂载 ---------------- */
  group.add(pelican.root);
  const pelvis = new THREE.Vector3();   // 鹈鹕骨盆（在世界坐标）
  const pelvisVel = new THREE.Vector3();
  let pelvisYaw = 0;
  let bodyRoll = 0;
  let bodyPitch = 0;
  let steerVis = 0;
  let neckTurn = 0;
  let headPitch = 0;
  let beakOpen = 0;
  let pouchFill = 0;
  let flap = 0;
  let wingSpread = 0;

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const qYaw = new THREE.Quaternion();
  const YAXIS = new THREE.Vector3(0, 1, 0);

  /** 两只脚在脚踏上（世界坐标），返回脚踝目标点。z 与髋同宽（±0.135），保证蹼足正踩在踏板上。 */
  function pedalTargets(out) {
    const bikeYaw = bike.root.rotation.y;
    qYaw.setFromAxisAngle(YAXIS, bikeYaw);
    const bbWorld = tmp.copy(BIKE.bb).applyQuaternion(qYaw).add(bike.root.position);
    const c = Math.cos(state.crank);
    const s = Math.sin(state.crank);
    // 右脚（z = -0.135）在 θ=0 时位于最高点
    out.right.copy(bbWorld).add(new THREE.Vector3(0.17 * s, 0.17 * c, -0.135).applyQuaternion(qYaw));
    out.right.y += 0.095; // 踝关节在踏板上方 9.5cm（脚掌厚度）
    out.left.copy(bbWorld).add(new THREE.Vector3(-0.17 * s, -0.17 * c, 0.135).applyQuaternion(qYaw));
    out.left.y += 0.095;
    return out;
  }
  const pedals = { right: new THREE.Vector3(), left: new THREE.Vector3() };

  /**
   * 两骨 IK：给定髋（世界）、踝（世界）与两根骨长，返回髋/膝的 Z 轴转角。
   * 鹈鹕的「膝」（解剖上是跗关节）向后弯，所以用 bend = +1 让关节往后顶。
   */
  const ikOut = { hipZ: 0, kneeZ: 0, reach: 0, overreach: 0 };
  function solveLegIK(hipWorld, ankleWorld, l1, l2, bend = 1) {
    tmp.copy(ankleWorld).sub(hipWorld);
    // 转到身体局部（只关心 XY 平面内的分量，Z 分量忽略）
    const dx = tmp.x;
    const dy = tmp.y;
    let d = Math.hypot(dx, dy);
    const maxReach = (l1 + l2) * 0.995;
    const minReach = Math.abs(l1 - l2) * 1.05 + 0.02;
    let over = 0;
    if (d > maxReach) {
      over = (d - maxReach) / maxReach;
      d = maxReach;
    } else if (d < minReach) {
      d = minReach;
    }
    const phi = Math.atan2(dx, -dy); // 0 = 正下方，正 = 向前
    // 余弦定理
    const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const cosB = clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1);
    const a = Math.acos(cosA); // 髋关节偏移
    const interior = Math.acos(cosB); // 膝关节内角
    ikOut.hipZ = phi - bend * a;
    ikOut.kneeZ = bend * (Math.PI - interior);
    ikOut.reach = d / (l1 + l2);
    ikOut.overreach = over;
    return ikOut;
  }

  /* ---------------- 相机 ---------------- */
  const CAM_MODES = ['chase', 'pelican', 'orbit', 'free'];
  const cam = {
    mode: 'chase',
    pos: new THREE.Vector3(0, 6, 12),
    look: new THREE.Vector3(),
    fov: 52,
    shake: 0,
    orbitAngle: 0,
  };
  function cycleCamera() {
    const i = CAM_MODES.indexOf(cam.mode);
    cam.mode = CAM_MODES[(i + 1) % CAM_MODES.length];
    if (cam.mode === 'free' && controls) controls.enabled = true;
    else if (controls) controls.enabled = false;
    emit('camera', cam.mode);
    return cam.mode;
  }
  const camTarget = new THREE.Vector3();
  const camDesired = new THREE.Vector3();
  const lookDesired = new THREE.Vector3();
  const shakeOff = new THREE.Vector3();

  /* ---------------- 海鸥 ---------------- */
  const gullList = gulls || [];

  /* ---------------- 主更新 ---------------- */
  let elapsed = 0;

  function stepSpeed(dt) {
    // 速度模型：功率 → 加速度；阻力 = 滚阻 + 二次风阻 + 重力沿坡分量
    const power = (state.manual ? state.manualThrottle : state.throttle) * 260; // W
    const v = state.speed;
    const rolling = 1.6 + 0.02 * v * v;
    const aero = 0.32 * v * v;
    const sm = track.at(state.s);
    const gradeAccel = -9.8 * Math.sin(sm.grade);
    const drive = power / Math.max(2.2, v + 1.2);
    const a = drive / 34 - (rolling + aero) / 34 + gradeAccel;
    let next = v + a * dt;
    // 刹车
    next -= state.brake * 7.5 * dt;
    // 风阻封顶 + 状态限速
    const cap = state.mode === MODE.CRUISE || state.mode === MODE.INTRO ? state.vMax : state.mode === MODE.FISH || state.mode === MODE.DELIVER || state.mode === MODE.LIGHT ? 0.6 : 12;
    next = clamp(next, 0, cap);
    state.speed = Math.max(0, next);
  }

  function advance(dt) {
    const sm = track.at(state.s);
    const ds = state.speed * dt;
    state.odometer += ds;
    const prevS = state.s;
    state.s = wrap(state.s + ds, track.length);
    // 回到起点 → 记一圈
    if (prevS > track.length * 0.75 && state.s < track.length * 0.25) {
      state.lapCount++;
      emit('lap', state.lapCount);
    }
    return sm;
  }

  /** 自动脚本：检查是否到了下一个停靠点 */
  function checkStops() {
    if (state.mode !== MODE.CRUISE && state.mode !== MODE.INTRO) return;
    if (state.manual) return;
    for (let i = 0; i < STOPS.length; i++) {
      const stop = STOPS[i];
      if (stop.done) continue;
      // 前方 60m 内且已经接近
      let d = stop.s - state.s;
      if (d < -track.length * 0.5) d += track.length;
      if (d < 55 && d > -3 && state.speed > 0.2) {
        state.stopIndex = i;
        state.stopTimer = 0;
        // 提前减速到停靠点，否则瞬间把速度清零看起来像撞墙
        const brakeDist = Math.max(8, (state.speed * state.speed) / (2 * 7.5));
        state.brake = d < brakeDist ? 1 : 0;
        state.mode = stop.type === 'fish' ? MODE.FISH : stop.type === 'deliver' ? MODE.DELIVER : MODE.LIGHT;
        // 不再瞬移：让车自然滑到点位，speed 由 stepSpeed 的刹车项收干净
        emit('mode', { mode: state.mode, label: stop.label });
        return;
      }
    }
  }

  /** 停靠表演是否已经走完（表演结束前继续刹车，结束后才松闸） */
  function stopDone() {
    const stop = STOPS[state.stopIndex];
    if (!stop) return true;
    return state.stopTimer >= stop.hold;
  }

  function beginStop() {
    const stop = STOPS[state.stopIndex];
    if (!stop || stop.done) {
      state.mode = MODE.CRUISE;
      return;
    }
    stop.done = true;
    if (stop.type === 'fish') {
      // 钓鱼：低头、张喙、喉囊鼓起
      state.fish += 1;
      emit('fish', state.fish);
      if (audio) audio.play('fish');
    } else if (stop.type === 'deliver') {
      state.delivered += 1;
      emit('deliver', state.delivered);
      if (audio) audio.play('deliver');
    } else {
      emit('light', null);
    }
    state.mode = MODE.CRUISE;
    emit('mode', { mode: state.mode, label: null });
  }

  /** 起飞去灯塔盘旋（剧情收尾） */
  function launchFlight() {
    state.mode = MODE.FLIGHT;
    state.timeline = 0;
    state.flightAngle = 0;
    const sm = track.at(state.s);
    state.flightRadius = 30;
    state.flightHeight = sm.pos.y;
    bike.root.visible = false;
    emit('mode', { mode: state.mode, label: '灯塔巡航' });
    if (audio) audio.play('whoosh');
  }

  function landAndReset() {
    // 从空中回到路面：先把鹈鹕放回车座
    state.mode = MODE.CRUISE;
    bike.root.visible = true;
    state.flightAngle = 0;
    emit('mode', { mode: state.mode, label: null });
    // 重置停靠点，允许再跑一圈
    for (const s of STOPS) s.done = false;
  }

  /* ---------------- 每帧 ---------------- */
  function update(dt, opts = {}) {
    elapsed += dt;
    const autoTime = opts.autoTime !== false;
    if (state.mode !== MODE.FLIGHT) stepSpeed(dt);
    const braking =
      (state.manual && state.brake > 0.05) ||
      (state.mode === MODE.FISH || state.mode === MODE.DELIVER || state.mode === MODE.LIGHT && !stopDone(this));
    state.brake = braking && !state.manual ? 1 : state.brake;

    /* ---- 位置与姿态 ---- */
    let sm = track.at(state.s);
    if (state.mode === MODE.INTRO) {
      state.timeline += dt;
      // 开场：沿赛道缓慢推进并抬头看向镜头
      state.speed = 1.6;
    }
    if (state.mode !== MODE.FLIGHT) {
      sm = advance(dt);
      // 车身：位置贴路面，朝向对齐切线
      bike.root.position.copy(sm.pos);
      const targetYaw = sm.heading;
      bike.root.rotation.y = targetYaw;
      // 路面法线倾斜（把车压在坡面上）
      const pitch = -sm.grade;
      bike.root.rotation.z = damp(bike.root.rotation.z, pitch, 6, dt);
      // 弯道侧倾
      const leanTarget = clamp(-sm.curvature * state.speed * state.speed * 0.42, -0.42, 0.42);
      bike.root.rotation.x = damp(bike.root.rotation.x, leanTarget, 5, dt);
    }

    // 车轮与曲柄：曲柄角由里程驱动（体现 26:1 的传动比）
    state.crank = (state.odometer / (BIKE.wheelR * TAU)) / state.pedalRatio;
    bike.spinWheels(state.odometer / BIKE.wheelR);
    bike.spinCrank(state.crank);

    /* ---- 鹈鹕 ---- */
    if (state.mode === MODE.FLIGHT) {
      updateFlight(dt);
    } else {
      updateRiding(dt, sm, state.feeding);
    }

    /* ---- 海鸥 ---- */
    updateGulls(dt);

    /* ---- 相机 ---- */
    updateCamera(dt, sm);

    return state;
  }

  /* ---------------- 骑乘姿态（含 IK） ---------------- */
  function updateRiding(dt, sm, feeding = false) {
    const cadence = state.speed / (BIKE.wheelR * TAU) / state.pedalRatio * TAU; // rad/s
    const throttleEff = state.manual ? state.manualThrottle : state.throttle;

    /* 骨盆位置：骑手应该在踏板上方一点点，且随车速轻微起伏 */
    const bbWorld = tmp2.copy(BIKE.bb).applyQuaternion(qYaw).add(bike.root.position);
    const pedalMidY = bbWorld.y + Math.cos(state.crank) * 0.17;
    const bobAmp = 0.012 + throttleEff * 0.016;
    const bob = Math.sin(state.crank * 2) * bobAmp;
    const swayZ = Math.sin(state.crank) * 0.012 * clamp01(state.speed / 3);
    // 骑高：车速越快、身体压得越低（风阻姿态）
    const crouch = lerp(0.335, 0.295, clamp01(state.speed / state.vMax));
    const desiredY = pedalMidY + crouch + bob;
    const desiredX = 0.02 + clamp01(state.speed / state.vMax) * 0.02;
    pelvis.y = damp(pelvis.y || desiredY, desiredY, 14, dt);
    pelvis.x = damp(pelvis.x || bbWorld.x, bbWorld.x + Math.cos(sm.heading) * desiredX, 10, dt);
    pelvis.z = damp(pelvis.z || bbWorld.z, bbWorld.z + Math.sin(sm.heading) * desiredX + Math.cos(sm.heading) * swayZ, 10, dt);

    // 朝向：骑手略微反向偏航（像真的在把车压弯）
    const steerTarget = clamp(sm.curvature * state.speed * 1.5, -0.6, 0.6);
    steerVis = damp(steerVis, steerTarget, 5, dt);
    pelvisYaw = dampAngle(pelvisYaw, sm.heading - steerVis * 0.35, 8, dt);
    pelican.root.position.copy(pelvis);
    pelican.root.rotation.y = pelvisYaw;

    /* 腿：IK 到两只脚踏 */
    pedalTargets(pedals);
    const l1 = PELICAN.legUpper;
    const l2 = PELICAN.legLower;
    const hipOffsets = [
      ['right', new THREE.Vector3(0.02, -0.22, -0.135), pedals.right],
      ['left', new THREE.Vector3(0.02, -0.22, 0.135), pedals.left],
    ];
    for (const [name, off, ankle] of hipOffsets) {
      const hipW = tmp2.copy(off).applyAxisAngle(YAXIS, pelvisYaw).add(pelvis);
      const ik = solveLegIK(hipW, ankle, l1, l2, 1);
      // 踝关节：让脚掌（蹼）大致踩平在脚踏上，并随踩踏行程做「脚跟微抬」
      const stroke = Math.sin(state.crank);
      const toeAngle = -0.22 + stroke * 0.30;
      pelican.setLeg(name, {
        hipZ: ik.hipZ,
        kneeZ: ik.kneeZ,
        ankleZ: -(ik.hipZ + ik.kneeZ) + toeAngle,
        footZ: 0,
      });
    }

    /* 身体：侧倾 + 俯仰 + 前后微摆 */
    const targetRoll = steerVis * 0.42 + clamp(-sm.curvature * 2.2, -0.2, 0.2);
    const targetPitch = clamp((state.speed - 3) * 0.012, -0.05, 0.12) + sm.grade * 0.35;
    bodyRoll = damp(bodyRoll, targetRoll, 6, dt);
    bodyPitch = damp(bodyPitch, targetPitch, 4, dt);

    /* 停靠表演 */
    let flapTarget = 0.04 + 0.03 * Math.sin(elapsed * 2.3); // 巡航时的小幅扇翅（保持平衡）
    let neckTarget = Math.sin(elapsed * 1.7) * 0.10 - steerVis * 0.5;
    let headPitchTarget = -0.06 + clamp01(state.speed / state.vMax) * 0.10;
    let beakTarget = 0;
    if (state.mode === MODE.FISH || state.mode === MODE.DELIVER || state.mode === MODE.LIGHT) {
      state.stopTimer += dt;
      const stop = STOPS[state.stopIndex];
      const hold = stop ? stop.hold : 5;
      const p = clamp01(state.stopTimer / hold);
      if (p < 1) {
        if (stop && stop.type === 'fish') {
          // 低头 → 张喙 → 甩头 → 吞下
          const sniff = smoothstep(0.05, 0.3, p) * (1 - smoothstep(0.45, 0.7, p));
          headPitchTarget = lerp(-0.06, 0.85, sniff);
          beakTarget = sniff * 0.9;
          flapTarget = 0.1 + sniff * 0.25;
          neckTarget = 0.1;
        } else if (stop && stop.type === 'deliver') {
          // 伸手把邮包甩向窗口
          const reach = smoothstep(0.1, 0.35, p) * (1 - smoothstep(0.6, 0.85, p));
          headPitchTarget = lerp(-0.06, 0.3, reach);
          neckTarget = lerp(0, -0.55, reach);
          flapTarget = 0.06 + reach * 0.3;
        } else {
          // 灯塔：抬头看光
          headPitchTarget = lerp(-0.06, 0.6, smoothstep(0.1, 0.4, p));
          neckTarget = 0;
        }
      } else {
        // 表演结束：姿态回到正常巡航
        flapTarget = 0.05;
        neckTarget = 0;
        headPitchTarget = -0.06;
        beakTarget = 0;
      }
      if (stopDone(this)) beginStop();
    }
    // 快速下坡时迎风张嘴
    if (state.speed > state.vMax * 0.86) beakTarget = Math.max(beakTarget, 0.22);

    neckTurn = damp(neckTurn, neckTarget, 4, dt);
    headPitch = damp(headPitch, headPitchTarget, 5, dt);
    beakOpen = damp(beakOpen, beakTarget, 7, dt);
    flap = damp(flap, flapTarget, 6, dt);

    /* 喉囊：随着渔获逐渐鼓起来；开投喂动画时短暂瘢下去 */
    pouchFill = clamp01(0.25 + state.fish * 0.22 - (feeding ? 0.3 : 0));

    pelican.applyPose({
      neckTurn,
      headPitch,
      beakOpen,
      pouchFill,
      bodyLean: bodyPitch,
      bodyRoll,
      capOn: 1,
      bagVisible: 1,
    });
    // 扇翅：巡航小抖；下坡抬翅；停靠时抬翅保持平衡
    const flapAngle = flap * Math.sin(elapsed * (5 + cadence * 0.6)) + (state.speed > state.vMax * 0.8 ? 0.25 : 0);
    pelican.updateWings(clamp(flapAngle, -1, 1), 0.15);

    // 车把随转向摆动
    bike.barGroup.rotation.z = damp(bike.barGroup.rotation.z, -steerVis * 0.4, 8, dt);
    bike.saddleGroup.visible = true;
  }

  /* ---------------- 飞行（灯塔盘旋） ---------------- */
  function updateFlight(dt) {
    state.timeline += dt;
    const tl = state.timeline;
    // 阶段 1：离地上升 (0-1.5s) 阶段 2：绕塔盘旋 (1.5-11s) 阶段 3：俯冲入海 (11-14s) 阶段 4：重置
    const sm = track.at(state.s);
    const lh = lighthouse;
    const climb = smoothstep(0, 1.5, tl);
    const dive = smoothstep(11, 14, tl);
    state.flightAngle += dt * 0.55;
    const r = lerp(state.flightRadius, 46, smoothstep(2, 8, tl));
    const h = lerp(sm.pos.y + 2, lh.position.y + 30, climb) - dive * 40;
    pelican.root.position.set(
      lh.position.x + Math.cos(state.flightAngle) * r,
      h,
      lh.position.z + Math.sin(state.flightAngle) * r
    );
    pelican.root.rotation.y = -state.flightAngle - Math.PI / 2;
    pelican.root.rotation.z = -0.35 - dive * 0.4;
    const flapFreq = 5.2;
    flap = Math.sin(tl * flapFreq) * 0.95;
    pelican.updateWings(flap, 0.5);
    pelican.applyPose({
      neckTurn: Math.sin(tl * 0.8) * 0.25,
      headPitch: -0.15,
      beakOpen: 0,
      pouchFill,
      bodyLean: -0.1,
      bodyRoll: 0.2,
      capOn: 0,
      bagVisible: 0,
    });
    // 腿收起（飞行时鹈鹕会把脚缩到羽毛里）
    pelican.setLeg('left', { hipZ: -0.9, kneeZ: 2.2, ankleZ: -1.0 });
    pelican.setLeg('right', { hipZ: -0.9, kneeZ: 2.2, ankleZ: -1.0 });
    if (tl > 15) landAndReset();
  }

  /* ---------------- 海鸥 ---------------- */
  function updateGulls(dt) {
    for (const g of gullList) {
      if (!g.update) continue;
      g.update(dt, elapsed);
    }
  }

  /* ---------------- 相机 ---------------- */
  function updateCamera(dt, sm) {
    if (cam.mode === 'free') return;
    const bikePos = bike.root.position;
    const yaw = sm.heading;

    if (cam.mode === 'chase') {
      // 跟车略高、略偏后，always 能把鹈鹕连车一起收进画面
      const back = 5.2 + state.speed * 0.18;
      const up = 2.35 + state.speed * 0.06;
      camDesired.set(
        bikePos.x - Math.sin(yaw) * back,
        bikePos.y + up,
        bikePos.z - Math.cos(yaw) * back
      );
      // 向海面侧偏一点，构图里留出海与灯塔
      camDesired.x += Math.cos(yaw) * 1.25;
      camDesired.z -= Math.sin(yaw) * 1.25;
      // 视线落在鹈鹕胸口而不是车前方——这样主体总在画面中央
      camTarget.set(
        bikePos.x + Math.sin(yaw) * 0.35,
        bikePos.y + 1.15,
        bikePos.z + Math.cos(yaw) * 0.35
      );
      const k = 1 - Math.exp(-3.4 * dt);
      cam.pos.lerp(camDesired, k);
      cam.look.lerp(camTarget, k);
      cam.fov = damp(cam.fov, 52 + state.speed * 0.85, 3, dt);
    } else if (cam.mode === 'pelican') {
      // 鹈鹕第一人称：挂在头部
      const head = pelican.headPivot;
      head.updateWorldMatrix(true, false);
      const eye = new THREE.Vector3(0.10, 0.03, 0).applyMatrix4(head.matrixWorld);
      camDesired.copy(eye);
      const fwd = new THREE.Vector3(1, 0, 0).transformDirection(head.matrixWorld);
      camTarget.copy(eye).addScaledVector(fwd, 8);
      camTarget.y -= 1.0 + sm.grade * 6;
      cam.pos.lerp(camDesired, 1 - Math.exp(-24 * dt));
      cam.look.lerp(camTarget, 1 - Math.exp(-10 * dt));
      cam.fov = damp(cam.fov, 66, 4, dt);
    } else if (cam.mode === 'orbit') {
      cam.orbitAngle += dt * 0.18;
      const r = 9 + Math.sin(elapsed * 0.2) * 2;
      camDesired.set(
        bikePos.x + Math.cos(cam.orbitAngle) * r,
        bikePos.y + 3.4,
        bikePos.z + Math.sin(cam.orbitAngle) * r
      );
      camTarget.set(bikePos.x, bikePos.y + 1.3, bikePos.z);
      cam.pos.lerp(camDesired, 1 - Math.exp(-2.2 * dt));
      cam.look.lerp(camTarget, 1 - Math.exp(-2.2 * dt));
      cam.fov = damp(cam.fov, 44, 2, dt);
    }
    // 速度带来的轻微抖动
    const shakeAmp = clamp01((state.speed - 2.5) / 9) * 0.035;
    shakeOff.set(
      Math.sin(elapsed * 23.3) * shakeAmp,
      Math.sin(elapsed * 19.7 + 1.3) * shakeAmp * 0.7,
      Math.cos(elapsed * 21.1) * shakeAmp
    );
    camera.position.copy(cam.pos).add(shakeOff);
    camera.lookAt(cam.look);
    if (Math.abs(camera.fov - cam.fov) > 0.01) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
  }

  /* ---------------- 输入 ---------------- */
  function setInput({ throttle = 0, brake = 0, manual = null } = {}) {
    if (manual !== null) state.manual = manual;
    if (state.manual) {
      state.manualThrottle = clamp01(throttle);
      state.brake = clamp01(brake);
    }
  }

  function toggleManual() {
    state.manual = !state.manual;
    if (state.manual) state.manualThrottle = 0.35;
    emit('mode', { mode: state.manual ? 'manual' : state.mode, label: state.manual ? '手动驾驶' : null });
    return state.manual;
  }

  return {
    group,
    state,
    cam,
    stops: STOPS,
    MODE,
    update,
    onEvent,
    checkStops,
    beginStop,
    launchFlight,
    cycleCamera,
    setInput,
    toggleManual,
    /** 立即把速度设成某值（调试/剧情用） */
    setSpeed(v) {
      state.speed = v;
    },
    /** 传送到赛道某处 */
    teleport(s) {
      state.s = wrap(s, track.length);
      const sm = track.at(state.s);
      pelvis.set(sm.pos.x, sm.pos.y + 0.62, sm.pos.z);
      bike.root.position.copy(sm.pos);
    },
  };
}