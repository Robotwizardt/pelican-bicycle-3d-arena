/**
 * audio.js — 纯 WebAudio 合成音效（无外部音频文件）
 *   轮胎滚动噪声 / 风噪 / 链条哗啦 / 车铃 / 入水水花 / 海鸥
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.volume = 0.55;
    this._lastDing = 0;
  }

  async enable() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const ctx = new AC();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 4;
      master.connect(comp).connect(ctx.destination);
      this.master = master;

      this.noiseBuf = (() => {
        const len = ctx.sampleRate * 2;
        const b = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = b.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
        return b;
      })();
      this.whiteBuf = (() => {
        const len = ctx.sampleRate * 2;
        const b = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return b;
      })();

      // 轮胎滚动（棕噪 → 带通）
      this.tireSrc = ctx.createBufferSource(); this.tireSrc.buffer = this.noiseBuf; this.tireSrc.loop = true;
      this.tireBP = ctx.createBiquadFilter(); this.tireBP.type = 'bandpass'; this.tireBP.frequency.value = 240; this.tireBP.Q.value = 0.7;
      this.tireGain = ctx.createGain(); this.tireGain.gain.value = 0;
      this.tireSrc.connect(this.tireBP).connect(this.tireGain).connect(master);
      this.tireSrc.start();

      // 链条
      this.chainSrc = ctx.createBufferSource(); this.chainSrc.buffer = this.whiteBuf; this.chainSrc.loop = true;
      this.chainHP = ctx.createBiquadFilter(); this.chainHP.type = 'highpass'; this.chainHP.frequency.value = 2600;
      this.chainGain = ctx.createGain(); this.chainGain.gain.value = 0;
      this.chainSrc.connect(this.chainHP).connect(this.chainGain).connect(master);
      this.chainSrc.start();

      // 风噪
      this.windSrc = ctx.createBufferSource(); this.windSrc.buffer = this.whiteBuf; this.windSrc.loop = true;
      this.windBP = ctx.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.frequency.value = 1100; this.windBP.Q.value = 0.4;
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
      this.windSrc.connect(this.windBP).connect(this.windGain).connect(master);
      this.windSrc.start();

      // 海浪底噪
      this.seaSrc = ctx.createBufferSource(); this.seaSrc.buffer = this.noiseBuf; this.seaSrc.loop = true;
      this.seaLP = ctx.createBiquadFilter(); this.seaLP.type = 'lowpass'; this.seaLP.frequency.value = 420;
      this.seaLFO = ctx.createOscillator(); this.seaLFO.frequency.value = 0.09;
      this.seaLFOG = ctx.createGain(); this.seaLFOG.gain.value = 0.32;
      this.seaGain = ctx.createGain(); this.seaGain.gain.value = 0.35;
      this.seaLFO.connect(this.seaLFOG).connect(this.seaGain.gain);
      this.seaLFO.start();
      this.seaSrc.connect(this.seaLP).connect(this.seaGain).connect(master);
      this.seaSrc.start();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.on = true;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(this.volume, this.ctx.currentTime + 0.8);
    return true;
  }

  setEnabled(v) {
    this.on = !!v;
    if (!this.ctx) return;
    if (!v) this.master.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.25);
    else this.enable();
  }

  /** 每帧更新（由主循环调用） */
  setRide({ speed = 0, cadence = 0, air = 0, boosted = false }) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.min(Math.abs(speed), 22);
    const s = v / 22;
    this.tireBP.frequency.setTargetAtTime(200 + v * 42, t, 0.12);
    this.tireGain.gain.setTargetAtTime(0.16 * s * (air ? 0.15 : 1), t, 0.12);
    this.chainGain.gain.setTargetAtTime(Math.min(0.075, cadence / 90 * 0.05), t, 0.15);
    this.windBP.frequency.setTargetAtTime(700 + v * 92, t, 0.15);
    this.windGain.gain.setTargetAtTime(0.10 * s * s + (boosted ? 0.05 : 0), t, 0.15);
  }

  ding(f = 1480) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    if (t - this._lastDing < 0.09) return;
    this._lastDing = t;
    const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain();
    car.type = 'sine'; mod.type = 'sine';
    car.frequency.value = f; mod.frequency.value = f * 1.48;
    mg.gain.value = f * 0.9;
    mod.connect(mg).connect(car.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.9);
    car.connect(g).connect(this.master);
    car.start(t); mod.start(t);
    car.stop(t + 1.0); mod.stop(t + 1.0);
  }

  splash(amount = 1) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.whiteBuf;
    src.playbackRate.value = 1 + Math.random() * 0.3;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(2200, t + 0.32);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * amount, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.55);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.6);
  }

  /** 海鸥：滤波锯齿 + 颤音 */
  gull() {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + Math.random() * 0.1;
    const n = 2 + (Math.random() * 2 | 0);
    for (let i = 0; i < n; i++) {
      const t0 = t + i * 0.28;
      const o = c.createOscillator(); o.type = 'sawtooth';
      const f0 = 620 + Math.random() * 260;
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.55, t0 + 0.07);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.82, t0 + 0.22);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 2.2;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0004, t0 + 0.34);
      o.connect(bp).connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 0.36);
    }
  }

  bell() { this.ding(1680); }
}
