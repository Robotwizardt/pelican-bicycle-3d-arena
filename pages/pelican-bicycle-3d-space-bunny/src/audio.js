/**
 * audio.js —— 全程序化音频（没有任何音频文件）
 *
 * 合成的东西：
 *  - 海浪：白噪声 → 双二阶低通（LFO 调制截止频率）→ 缓慢起伏的增益（浪的呼吸）
 *  - 风声：粉噪声 → 带通 + 与车速相关的增益与频率
 *  - 轮胎：低频噪声 + 随车速的轻微共振峰
 *  - 鹈鹕：扇翅的「噗」、叫唤（频率滑移的锯齿 + 噪声）、吞咽
 *  - 叮当铃：给停靠点提示（两个正弦相叠的钟声）
 *  - 邮车汽笛（低频双音）作为开场
 * 所有节点只在首次用户交互后创建（浏览器自动播放策略）。
 */
import { clamp01, lerp } from './util.js';

export function createAudio() {
  let ctx = null;
  let master = null;
  const nodes = {};
  let started = false;
  let muted = false;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    return ctx;
  }

  function noiseBuffer(seconds = 3, pink = true) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (pink) {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      } else {
        d[i] = white;
      }
    }
    return buf;
  }

  /** 开始播放环境音（必须在用户手势里调用） */
  function start() {
    if (started) return true;
    if (!ensure()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    started = true;

    /* --- 海浪 --- */
    const surf = ctx.createBufferSource();
    surf.buffer = noiseBuffer(4, false);
    surf.loop = true;
    const surfFilter = ctx.createBiquadFilter();
    surfFilter.type = 'lowpass';
    surfFilter.frequency.value = 520;
    surfFilter.Q.value = 0.6;
    const surfGain = ctx.createGain();
    surfGain.gain.value = 0.10;
    // 浪的呼吸：两个不同周期的 LFO 相加
    const lfo1 = ctx.createOscillator();
    lfo1.frequency.value = 0.09;
    const lfo1Gain = ctx.createGain();
    lfo1Gain.gain.value = 0.055;
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.031;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.035;
    lfo1.connect(lfo1Gain).connect(surfGain.gain);
    lfo2.connect(lfo2Gain).connect(surfGain.gain);
    lfo1.start();
    lfo2.start();
    surf.connect(surfFilter).connect(surfGain).connect(master);
    surf.start();

    /* --- 风声 --- */
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(4, true);
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.8;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.0;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();

    /* --- 轮胎滚动 --- */
    const tyre = ctx.createBufferSource();
    tyre.buffer = noiseBuffer(4, false);
    tyre.loop = true;
    const tyreFilter = ctx.createBiquadFilter();
    tyreFilter.type = 'bandpass';
    tyreFilter.frequency.value = 180;
    tyreFilter.Q.value = 2.2;
    const tyreGain = ctx.createGain();
    tyreGain.gain.value = 0.0;
    tyre.connect(tyreFilter).connect(tyreGain).connect(master);
    tyre.start();

    Object.assign(nodes, {
      surfGain,
      windGain,
      windFilter,
      tyreGain,
      tyreFilter,
    });
    return true;
  }

  /** 每帧根据车速更新环境音 */
  function update(speed, opts = {}) {
    if (!started || !ctx) return;
    const v = clamp01(speed / 10);
    const t = ctx.currentTime;
    nodes.windGain.gain.setTargetAtTime(0.02 + v * 0.09, t, 0.2);
    nodes.windFilter.frequency.setTargetAtTime(500 + v * 900, t, 0.3);
    nodes.tyreGain.gain.setTargetAtTime(v * 0.055, t, 0.15);
    nodes.tyreFilter.frequency.setTargetAtTime(120 + v * 260, t, 0.2);
    nodes.surfGain.gain.setTargetAtTime(muted ? 0 : 0.085 + v * 0.02, t, 0.4);
  }

  function env(node, t0, a, d, peak = 1) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(peak, t0 + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  /** 鹈鹕扇翅：低频「噗」 */
  function flap(intensity = 1) {
    if (!started) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.3, true);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = ctx.createGain();
    env(g, t, 0.02, 0.16, 0.10 * intensity);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.25);
  }

  /** 鹈鹕叫：频率滑移的锯齿 + 气声 */
  function honk(kind = 'short') {
    if (!started) return;
    const t = ctx.currentTime;
    const dur = kind === 'long' ? 0.7 : 0.28;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = kind === 'long' ? 150 : 240;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * (kind === 'long' ? 0.62 : 1.35), t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = base * 4;
    f.Q.value = 3;
    const g = ctx.createGain();
    env(g, t, 0.03, dur, 0.12);
    const breath = ctx.createBufferSource();
    breath.buffer = noiseBuffer(0.3, true);
    const bg = ctx.createGain();
    env(bg, t, 0.02, dur * 0.8, 0.05);
    osc.connect(f).connect(g).connect(master);
    breath.connect(bg).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.1);
    breath.start(t);
    breath.stop(t + dur + 0.1);
  }

  /** 邮车汽笛：两个低频正弦相叠 */
  function whistle(dur = 0.9) {
    if (!started) return;
    const t = ctx.currentTime;
    for (const f0 of [196, 261.6]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f0;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.12);
      g.gain.setValueAtTime(0.09, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    }
  }

  /** 钟铃（停靠提示） */
  function bell(freq = 880, times = 2) {
    if (!started) return;
    const t = ctx.currentTime;
    for (let i = 0; i < times; i++) {
      const t0 = t + i * 0.42;
      for (const [mult, amp] of [[1, 0.07], [2.76, 0.03], [5.4, 0.015]]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * mult;
        const g = ctx.createGain();
        env(g, t0, 0.005, 1.1 / mult, amp);
        osc.connect(g).connect(master);
        osc.start(t0);
        osc.stop(t0 + 1.4);
      }
    }
  }

  /** 溅水（鱼入水） */
  function splash() {
    if (!started) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.5, false);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.3);
    const g = ctx.createGain();
    env(g, t, 0.01, 0.35, 0.12);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.5);
  }

  const api = {
    start,
    update,
    flap,
    honk,
    whistle,
    bell,
    splash,
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.05);
      return muted;
    },
    /** 事件 → 声音的映射 */
    play(type) {
      switch (type) {
        case 'fish':
          splash();
          setTimeout(() => honk('short'), 380);
          break;
        case 'deliver':
          bell(760, 2);
          break;
        case 'light':
          bell(620, 3);
          break;
        case 'lap':
          bell(980, 1);
          break;
        case 'whoosh':
          honk('long');
          break;
        default:
          break;
      }
    },
  };
  return api;
}