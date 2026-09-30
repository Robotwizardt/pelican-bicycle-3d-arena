/* =====================================================================
 * audio.js — WebAudio 程序化音景（零外部音频文件）
 *
 *   风声        : 白噪声 -> bandpass(随速度移动) -> gain
 *   轮胎滚沙    : 褐噪声 -> lowpass -> gain(随速度)
 *   链条棘轮    : 短噪声脉冲 -> highpass，按踏频触发"咔哒"
 *   海浪        : 粉噪声 -> 双 lowpass + 缓慢 LFO 起伏
 *   车铃        : 多个正弦谐波 + 指数衰减包络
 *   鹈鹕叫      : 锯齿波 + formant 带通 + 音高滑音
 *   环境垫音    : 三个失谐正弦 + 缓慢 LFO（昼夜切换和弦）
 *   吃鱼 gulp   : 低频正弦 + 快速音高下滑
 *
 * 浏览器要求用户手势后才能 resume()，由 main.js 首次交互时调用。
 * ===================================================================*/
(function () {
  'use strict';
  var PB = window.PB, U = PB.U;

  function makeNoiseBuffer(ctx, seconds, kind) {
    var n = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    if (kind === 'brown') {
      var last = 0;
      for (var i = 0; i < n; i++) {
        var w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    } else if (kind === 'pink') {
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (var j = 0; j < n; j++) {
        var ww = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + ww * 0.0555179;
        b1 = 0.99332 * b1 + ww * 0.0750759;
        b2 = 0.96900 * b2 + ww * 0.1538520;
        b3 = 0.86650 * b3 + ww * 0.3104856;
        b4 = 0.55000 * b4 + ww * 0.5329522;
        b5 = -0.7616 * b5 - ww * 0.0168980;
        d[j] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + ww * 0.5362;
        b6 = ww * 0.115926;
        d[j] *= 0.11;
      }
    } else {
      for (var k = 0; k < n; k++) d[k] = Math.random() * 2 - 1;
    }
    return buf;
  }

  function Audio() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.masterVol = 0.55;
    this._nodes = {};
    this._lastClick = 0;
  }

  Audio.prototype.init = function () {
    if (this.ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { this.ctx = new AC(); } catch (e) { return false; }
    var ctx = this.ctx;
    var master = ctx.createGain();
    master.gain.value = this.masterVol;
    // 总线上挂一个软限幅，避免叠加削顶
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 22;
    comp.ratio.value = 5; comp.attack.value = 0.005; comp.release.value = 0.20;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    var white = makeNoiseBuffer(ctx, 2.0, 'white');
    var brown = makeNoiseBuffer(ctx, 3.0, 'brown');
    var pink = makeNoiseBuffer(ctx, 4.0, 'pink');
    this._white = white; this._brown = brown; this._pink = pink;

    var N = this._nodes;

    /* ---------- 风 ---------- */
    N.windSrc = ctx.createBufferSource();
    N.windSrc.buffer = white; N.windSrc.loop = true;
    N.windFilter = ctx.createBiquadFilter();
    N.windFilter.type = 'bandpass';
    N.windFilter.frequency.value = 520; N.windFilter.Q.value = 0.7;
    N.windGain = ctx.createGain(); N.windGain.gain.value = 0.0;
    N.windSrc.connect(N.windFilter); N.windFilter.connect(N.windGain);
    N.windGain.connect(master);
    N.windSrc.start();

    /* ---------- 轮胎滚沙 ---------- */
    N.tireSrc = ctx.createBufferSource();
    N.tireSrc.buffer = brown; N.tireSrc.loop = true;
    N.tireLP = ctx.createBiquadFilter();
    N.tireLP.type = 'lowpass'; N.tireLP.frequency.value = 900; N.tireLP.Q.value = 0.6;
    N.tireHP = ctx.createBiquadFilter();
    N.tireHP.type = 'highpass'; N.tireHP.frequency.value = 180;
    N.tireGain = ctx.createGain(); N.tireGain.gain.value = 0;
    N.tireSrc.connect(N.tireHP); N.tireHP.connect(N.tireLP);
    N.tireLP.connect(N.tireGain); N.tireGain.connect(master);
    N.tireSrc.start();

    /* ---------- 海浪 ---------- */
    N.seaSrc = ctx.createBufferSource();
    N.seaSrc.buffer = pink; N.seaSrc.loop = true;
    N.seaLP = ctx.createBiquadFilter();
    N.seaLP.type = 'lowpass'; N.seaLP.frequency.value = 480; N.seaLP.Q.value = 0.4;
    N.seaGain = ctx.createGain(); N.seaGain.gain.value = 0.10;
    N.seaSrc.connect(N.seaLP); N.seaLP.connect(N.seaGain); N.seaGain.connect(master);
    N.seaSrc.start();
    // 浪的呼吸感：低频 LFO 调制音量
    N.seaLFO = ctx.createOscillator();
    N.seaLFO.frequency.value = 0.13;
    N.seaLFOG = ctx.createGain(); N.seaLFOG.gain.value = 0.055;
    N.seaLFO.connect(N.seaLFOG); N.seaLFOG.connect(N.seaGain.gain);
    N.seaLFO.start();

    /* ---------- 环境垫音（昼夜和弦） ---------- */
    N.padGain = ctx.createGain(); N.padGain.gain.value = 0.0;
    N.padGain.connect(master);
    N.padOsc = [];
    for (var i = 0; i < 3; i++) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 110 * Math.pow(2, i / 12 * 7);
      var og = ctx.createGain(); og.gain.value = 0.22 / (i + 1);
      o.connect(og); og.connect(N.padGain);
      o.start();
      N.padOsc.push({ osc: o, gain: og });
    }
    N.padLFO = ctx.createOscillator();
    N.padLFO.frequency.value = 0.08;
    N.padLFOG = ctx.createGain(); N.padLFOG.gain.value = 0.35;
    N.padLFO.connect(N.padLFOG); N.padLFOG.connect(N.padGain.gain);
    N.padLFO.start();

    this.ready = true;
    return true;
  };

  Audio.prototype.resume = function () {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };

  Audio.prototype.setMasterVolume = function (v) {
    this.masterVol = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  };
  Audio.prototype.setEnabled = function (on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? this.masterVol : 0, this.ctx.currentTime, 0.05);
  };

  /** 每帧驱动：speed m/s, cadence rad/s, nightAmt 0..1 */
  Audio.prototype.update = function (dt, speed, cadence, nightAmt, onGround) {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx, N = this._nodes;
    var now = ctx.currentTime;
    var spdN = U.saturate(speed / 9);

    var wet = onGround ? 1 : 0.15;
    N.windGain.gain.setTargetAtTime(0.020 + spdN * 0.135, now, 0.12);
    N.windFilter.frequency.setTargetAtTime(430 + spdN * 1450, now, 0.15);
    N.tireGain.gain.setTargetAtTime((0.010 + spdN * 0.105) * wet, now, 0.08);
    N.tireLP.frequency.setTargetAtTime(700 + spdN * 2300, now, 0.10);
    N.seaGain.gain.setTargetAtTime(0.075 + (1 - spdN) * 0.05, now, 0.4);
    N.padGain.gain.setTargetAtTime(0.012 + nightAmt * 0.055, now, 0.6);

    // 昼夜：白天 A2/C3 五度，夜里换到更低的小三和弦
    var baseDay = [110, 164.81, 220];
    var baseNight = [98, 116.54, 146.83];
    for (var i = 0; i < N.padOsc.length; i++) {
      var f = U.lerp(baseDay[i], baseNight[i], nightAmt);
      N.padOsc[i].osc.frequency.setTargetAtTime(f, now, 1.2);
    }

    // 棘轮咔哒：按踏频周期性叠加
    if (cadence > 0.4 && wet) {
      this._clickAcc = (this._clickAcc || 0) + cadence * dt;
      if (this._clickAcc > 0.40) { this._clickAcc = 0; this.click(spdN); }
    }
  };

  /* ---------- 一次性音效 ---------- */
  Audio.prototype._envNoise = function (buf, freq, dur, vol, type) {
    var ctx = this.ctx;
    var s = ctx.createBufferSource(); s.buffer = buf || this._white;
    var f = ctx.createBiquadFilter();
    f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = 2.4;
    var g = ctx.createGain();
    var t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur + 0.02);
    return { src: s, filter: f, gain: g };
  };

  /** 棘轮咔哒 */
  Audio.prototype.click = function (intensity) {
    if (!this.ready || !this.enabled) return;
    this._envNoise(this._white, 2600 + Math.random() * 1800, 0.045,
      0.030 + U.saturate(intensity) * 0.045, 'bandpass');
  };

  /** 车铃 */
  Audio.prototype.bell = function () {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var partials = [1, 2.76, 5.40, 8.93];
    var amps = [1, 0.55, 0.30, 0.14];
    for (var i = 0; i < partials.length; i++) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 880 * partials[i] * (0.995 + Math.random() * 0.01);
      var g = ctx.createGain();
      var decay = 2.2 / (1 + i * 1.4);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.14 * amps[i], t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + decay + 0.05);
    }
  };

  /** 鹈鹕叫声：锯齿 + formant + 下滑音 */
  Audio.prototype.squawk = function (pitch) {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx, t = ctx.currentTime;
    pitch = pitch || 1;
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    var f0 = 210 * pitch;
    o.frequency.setValueAtTime(f0 * 1.35, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.72, t + 0.42);

    var f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass'; f1.frequency.value = 780; f1.Q.value = 4.5;
    var f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass'; f2.frequency.value = 1560; f2.Q.value = 7;
    var mix = ctx.createGain(); mix.gain.value = 0.5;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.03);
    g.gain.setValueAtTime(0.16, t + 0.26);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    // 颤音
    var vib = ctx.createOscillator(); vib.frequency.value = 22;
    var vibG = ctx.createGain(); vibG.gain.value = 26;
    vib.connect(vibG); vibG.connect(o.frequency);
    vib.start(t); vib.stop(t + 0.6);

    o.connect(f1); o.connect(f2); f1.connect(mix); f2.connect(mix);
    mix.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.6);
  };

  /** 吞鱼 */
  Audio.prototype.gulp = function () {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(72, t + 0.20);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.20, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    o.connect(lp); lp.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.3);
    this._envNoise(this._white, 500, 0.16, 0.05, 'lowpass');
  };

  /** 车轮打到水花 */
  Audio.prototype.splash = function (strength) {
    if (!this.ready || !this.enabled) return;
    var v = U.saturate(strength);
    this._envNoise(this._white, 1400 + Math.random() * 1200, 0.22 + v * 0.2,
      0.06 + v * 0.10, 'bandpass');
    this._envNoise(this._brown, 320, 0.30, 0.05 + v * 0.07, 'lowpass');
  };

  /** 腾空落地的闷响 */
  Audio.prototype.land = function (strength) {
    if (!this.ready || !this.enabled) return;
    var v = U.saturate(strength);
    this._envNoise(this._brown, 180, 0.20, 0.06 + v * 0.14, 'lowpass');
  };

  /** UI 轻点 */
  Audio.prototype.uiTick = function () {
    if (!this.ready || !this.enabled) return;
    this._envNoise(this._white, 3200, 0.03, 0.045, 'bandpass');
  };

  PB.Audio = Audio;
})();
