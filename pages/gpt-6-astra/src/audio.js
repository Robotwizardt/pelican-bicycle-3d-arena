// Original, locally synthesized seaside ambience. No audio files or network requests.
export function createSoundscape() {
  let context, master, ambientGain, noiseSource, swell, gullTimer;
  let enabled = false;
  function init() {
    if (context) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('Web Audio is not supported');
    context = new Audio();
    master = context.createGain();
    master.gain.value = 0.38;
    master.connect(context.destination);
    ambientGain = context.createGain();
    ambientGain.gain.value = 0;
    ambientGain.connect(master);
    const length = context.sampleRate * 8;
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      let last = 0;
      for (let i = 0; i < length; i++) {
        last = (last + (Math.random() * 2 - 1) * 0.025) / 1.025;
        samples[i] = last * 5;
      }
    }
    noiseSource = context.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1150;
    const waveGain = context.createGain();
    waveGain.gain.value = 0.24;
    noiseSource.connect(filter).connect(waveGain).connect(ambientGain);
    swell = context.createOscillator();
    swell.frequency.value = 0.11;
    const swellGain = context.createGain();
    swellGain.gain.value = 0.14;
    swell.connect(swellGain).connect(waveGain.gain);
    noiseSource.start();
    swell.start();
  }
  async function ready() { init(); if (context.state === 'suspended') await context.resume(); }
  function tone(frequency, delay, duration, gain = 0.18) {
    const now = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope).connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.05);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  }
  function gull() {
    if (!enabled || context.state !== 'running') return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.exponentialRampToValueAtTime(1350, now + 0.13);
    oscillator.frequency.exponentialRampToValueAtTime(670, now + 0.65);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.027, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    oscillator.connect(gain).connect(ambientGain);
    oscillator.start(); oscillator.stop(now + 0.8);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  return {
    async toggle() {
      await ready();
      enabled = !enabled;
      ambientGain.gain.setTargetAtTime(enabled ? 1 : 0, context.currentTime, 0.35);
      clearInterval(gullTimer);
      if (enabled) gullTimer = setInterval(gull, 14500);
      return enabled;
    },
    async bell() {
      await ready();
      [0, 0.15].forEach((delay) => {
        tone(1760, delay, 0.95, 0.21);
        tone(3520, delay, 0.4, 0.055);
        tone(2349, delay + 0.008, 0.65, 0.032);
      });
    },
    async suspend() { if (context?.state === 'running') await context.suspend(); },
    async resume() { if (context?.state === 'suspended') await context.resume(); },
    dispose() { clearInterval(gullTimer); if (context) void context.close(); },
  };
}
