function noiseBuffer(ctx) {
  const seconds = 2
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1
    last = last * 0.98 + white * 0.02
    data[i] = last * 2.5
  }
  return buffer
}

export function createAudio() {
  let ctx = null
  let ocean = null
  let wind = null
  let windGain = null
  let started = false

  function ensure() {
    if (started) return
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    ctx = new AC()
    const buffer = noiseBuffer(ctx)

    const oceanSrc = ctx.createBufferSource()
    oceanSrc.buffer = buffer
    oceanSrc.loop = true
    const oceanFilter = ctx.createBiquadFilter()
    oceanFilter.type = 'lowpass'
    oceanFilter.frequency.value = 420
    const oceanGain = ctx.createGain()
    oceanGain.gain.value = 0.045
    oceanSrc.connect(oceanFilter)
    oceanFilter.connect(oceanGain)
    oceanGain.connect(ctx.destination)
    oceanSrc.start()
    ocean = oceanGain

    const windSrc = ctx.createBufferSource()
    windSrc.buffer = buffer
    windSrc.loop = true
    const windFilter = ctx.createBiquadFilter()
    windFilter.type = 'bandpass'
    windFilter.frequency.value = 800
    windFilter.Q.value = 0.7
    windGain = ctx.createGain()
    windGain.gain.value = 0
    windSrc.connect(windFilter)
    windFilter.connect(windGain)
    windGain.connect(ctx.destination)
    windSrc.start()
    wind = windFilter
    started = true
  }

  function burst(freq, dur, type, gainValue, slide) {
    if (!ctx) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(gainValue, t + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  return {
    resume() {
      ensure()
      if (ctx && ctx.state === 'suspended') ctx.resume()
    },
    bell() {
      this.resume()
      burst(1567, 1.15, 'sine', 0.08, 1174)
      burst(2093, 0.9, 'sine', 0.035, 1760)
    },
    croak() {
      this.resume()
      burst(180, 0.28, 'sawtooth', 0.045, 90)
      burst(340, 0.22, 'triangle', 0.03, 140)
    },
    whoosh() {
      this.resume()
      if (!ctx) return
      const t = ctx.currentTime
      const src = ctx.createBufferSource()
      src.buffer = noiseBuffer(ctx)
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.setValueAtTime(400, t)
      filter.frequency.exponentialRampToValueAtTime(1400, t + 0.25)
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.06, t + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32)
      src.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      src.start(t)
      src.stop(t + 0.36)
    },
    click() {
      burst(1800, 0.03, 'square', 0.012, 400)
    },
    setSpeed(speed) {
      if (!windGain || !ctx) return
      const now = ctx.currentTime
      const g = Math.min(0.05, Math.abs(speed) * 0.004)
      windGain.gain.setTargetAtTime(g, now, 0.2)
      if (wind) wind.frequency.setTargetAtTime(500 + Math.abs(speed) * 90, now, 0.2)
    }
  }
}
