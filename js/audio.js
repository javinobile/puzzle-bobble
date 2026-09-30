// Efectos de sonido sintetizados con Web Audio (sin archivos externos)
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  // Los navegadores exigen una interacción del usuario antes de crear audio
  unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  tone({ freq, to = freq, duration = 0.1, type = 'square', volume = 0.15, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  noise({ duration = 0.15, volume = 0.2, filter = 2000, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const length = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = filter;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    src.connect(bp).connect(gain).connect(this.ctx.destination);
    src.start(t);
  }

  shoot() {
    this.tone({ freq: 900, to: 300, duration: 0.12, type: 'square', volume: 0.08 });
  }

  bounce() {
    this.tone({ freq: 500, to: 700, duration: 0.05, type: 'triangle', volume: 0.12 });
  }

  stick() {
    this.tone({ freq: 220, to: 140, duration: 0.08, type: 'triangle', volume: 0.15 });
  }

  pop(count) {
    this.noise({ duration: 0.18, volume: 0.25, filter: 3000 });
    for (let i = 0; i < Math.min(count, 6); i++) {
      this.tone({ freq: 600 + i * 120, to: 1200 + i * 120, duration: 0.07, type: 'sine', volume: 0.08, delay: i * 0.04 });
    }
  }

  drop(count) {
    for (let i = 0; i < Math.min(count, 8); i++) {
      this.tone({ freq: 1000 - i * 80, to: 200, duration: 0.2, type: 'sine', volume: 0.07, delay: i * 0.05 });
    }
  }

  tick() {
    this.tone({ freq: 1200, duration: 0.04, type: 'square', volume: 0.05 });
  }

  ceiling() {
    this.noise({ duration: 0.35, volume: 0.35, filter: 200 });
    this.tone({ freq: 90, to: 50, duration: 0.3, type: 'sawtooth', volume: 0.12 });
  }

  levelClear() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone({ freq: f, duration: 0.18, type: 'square', volume: 0.1, delay: i * 0.12 }),
    );
  }

  gameOver() {
    [392, 330, 262, 196].forEach((f, i) =>
      this.tone({ freq: f, to: f * 0.97, duration: 0.3, type: 'triangle', volume: 0.15, delay: i * 0.25 }),
    );
  }

  select() {
    this.tone({ freq: 880, duration: 0.06, type: 'square', volume: 0.06 });
  }
}
