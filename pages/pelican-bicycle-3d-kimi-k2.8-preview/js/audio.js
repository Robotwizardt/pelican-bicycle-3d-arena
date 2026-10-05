// Web Audio 合成：海浪 + 风声 + 车铃 + 鹈鹕叫 + 捏闸
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
    this._windGain = null;
    this._squawkCooldown = 0;
  }

  // 需在用户手势后调用
  enable() {
    if (this.ctx) { this._setEnabled(true); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(this.ctx.destination);
    this._setEnabled(true);
    this._startOcean();
    this._startWind();
  }

  _setEnabled(on) {
    this.enabled = on;
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(on ? 0.5 : 0, this.ctx.currentTime + 0.5);
    }
  }
  toggle() {
    if (!this.ctx) { this.enable(); return true; }
    this._setEnabled(!this.enabled);
    return this.enabled;
  }

  _noiseBuffer(seconds = 2) {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * seconds, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _startOcean() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(4);
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
    const g = this.ctx.createGain(); g.gain.value = 0.5;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.25;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(); lfo.start();
  }

  _startWind() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(3);
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2;
    const g = this.ctx.createGain(); g.gain.value = 0.0;
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start();
    this._windGain = g;
    this._windFilter = bp;
  }

  // 速度驱动风声音量
  update(dt, speed) {
    if (!this.ctx || !this.enabled) return;
    this._squawkCooldown -= dt;
    const t = this.ctx.currentTime;
    const wind = Math.min(0.22, speed * 0.018);
    this._windGain.gain.setTargetAtTime(wind, t, 0.2);
    this._windFilter.frequency.setTargetAtTime(700 + speed * 60, t, 0.3);
  }

  bell() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    // 自行车铃：非谐波泛音列快速衰减
    for (const [f, a, d] of [[1568, 0.5, 0.9], [2093, 0.3, 0.7], [2637, 0.2, 0.5], [3520, 0.12, 0.35]]) {
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(a, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + d + 0.05);
    }
  }

  squawk() {
    if (!this.ctx || !this.enabled || this._squawkCooldown > 0) return;
    this._squawkCooldown = 0.5;
    const t = this.ctx.currentTime;
    // 鹈鹕叫：锯齿波下滑 + 快速颤音
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(620, t);
    o.frequency.exponentialRampToValueAtTime(340, t + 0.28);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 26;
    const vibG = this.ctx.createGain(); vibG.gain.value = 30;
    vib.connect(vibG); vibG.connect(o.frequency);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 1.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(bp); bp.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.4);
    vib.start(t); vib.stop(t + 0.4);
  }

  brakeSqueal() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(2900, t);
    o.frequency.linearRampToValueAtTime(2400, t + 0.25);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.35);
  }
}
