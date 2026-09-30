// 纯 WebAudio 合成音效：车铃、鹈鹕叫、随速度变化的风声、白天鸟鸣 / 夜晚蟋蟀、链条咔哒
export function createAudio() {
  let ctx = null, master, windGain, windFilter, enabled = false;
  let birdTimer = 2, cricketTimer = 0, tickAcc = 0;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.6; master.connect(ctx.destination);
    // 风声：循环白噪声 → 低通
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < d.length; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = last * 6; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    windFilter = ctx.createBiquadFilter(); windFilter.type = 'lowpass'; windFilter.frequency.value = 400;
    windGain = ctx.createGain(); windGain.gain.value = 0;
    src.connect(windFilter).connect(windGain).connect(master); src.start();
  }

  function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }

  function bell() {
    if (!enabled) return; const t = ctx.currentTime;
    for (const [f, amp, dec] of [[2200, 0.25, 1.4], [2200 * 2.76, 0.08, 0.6], [2200 * 5.4, 0.04, 0.3], [1100, 0.06, 0.9]]) {
      for (let k = 0; k < 2; k++) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f * (1 + k * 0.003); o.type = 'sine';
        o.connect(g).connect(master); env(g, t + k * 0.16, 0.003, amp, dec); o.start(t + k * 0.16); o.stop(t + k * 0.16 + dec + 0.1);
      }
    }
  }

  function squawk() {
    if (!enabled) return; const t = ctx.currentTime;
    for (let k = 0; k < 3; k++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 3;
      const t0 = t + k * 0.18;
      o.frequency.setValueAtTime(520, t0); o.frequency.exponentialRampToValueAtTime(260, t0 + 0.16);
      o.connect(f).connect(g).connect(master); env(g, t0, 0.01, 0.35, 0.16); o.start(t0); o.stop(t0 + 0.2);
    }
  }

  function chirp() {
    const t = ctx.currentTime; const n = 2 + Math.floor(Math.random() * 4); const base = 2500 + Math.random() * 2000;
    for (let k = 0; k < n; k++) {
      const o = ctx.createOscillator(), g = ctx.createGain(); const t0 = t + k * 0.11;
      o.frequency.setValueAtTime(base, t0); o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), t0 + 0.07);
      o.connect(g).connect(master); env(g, t0, 0.005, 0.05, 0.07); o.start(t0); o.stop(t0 + 0.1);
    }
  }

  function cricket() {
    const t = ctx.currentTime;
    for (let k = 0; k < 3; k++) {
      const o = ctx.createOscillator(), g = ctx.createGain(); const t0 = t + k * 0.05;
      o.frequency.value = 4400 + Math.random() * 200; o.connect(g).connect(master); env(g, t0, 0.004, 0.025, 0.03); o.start(t0); o.stop(t0 + 0.05);
    }
  }

  function tick() {
    const t = ctx.currentTime; const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 3000 + Math.random() * 800; o.connect(g).connect(master); env(g, t, 0.001, 0.006, 0.01); o.start(t); o.stop(t + 0.02);
  }

  return {
    get enabled() { return enabled; },
    async toggle() {
      init(); enabled = !enabled;
      if (enabled) await ctx.resume(); else await ctx.suspend();
      return enabled;
    },
    bell, squawk,
    update(dt, speed, night, crankRate) {
      if (!enabled) return;
      const w = Math.min(speed / 10, 1);
      windGain.gain.setTargetAtTime(0.02 + w * 0.22, ctx.currentTime, 0.2);
      windFilter.frequency.setTargetAtTime(300 + w * 1400, ctx.currentTime, 0.2);
      birdTimer -= dt; cricketTimer -= dt;
      if (night < 0.5 && birdTimer < 0) { chirp(); birdTimer = 1.5 + Math.random() * 4; }
      if (night > 0.5 && cricketTimer < 0) { cricket(); cricketTimer = 0.35 + Math.random() * 0.5; }
      // 飞轮棘轮声：停止踩踏但仍在滑行时
      tickAcc += dt * (crankRate < 0.2 && speed > 0.5 ? speed * 6 : 0);
      while (tickAcc > 1) { tickAcc -= 1; tick(); }
    },
  };
}
