// Souffle de la bombe (bruit filtré) et cliquetis de la bille quand on secoue.
export class SprayAudio {
  constructor() {
    this.ctx = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.band = ctx.createBiquadFilter();
    this.band.type = 'bandpass';
    this.band.frequency.value = 5000;
    this.band.Q.value = 0.6;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    src.connect(this.band).connect(hp).connect(this.gain).connect(ctx.destination);
    src.start();
    this.level = 0;

    // rumeur des voitures qui passent (bruit grave filtré)
    const road = ctx.createBufferSource();
    road.buffer = buf;
    road.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 520;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    road.connect(low).connect(this.roadGain).connect(ctx.destination);
    road.start(0, 0.7);
    this.roadLevel = 0;
  }

  // distance (m) de la voiture en mouvement la plus proche
  setTraffic(distance) {
    if (!this.ctx) return;
    const target = 0.35 / (1 + (distance / 7) ** 2);
    if (Math.abs(target - this.roadLevel) < 0.004) return;
    this.roadLevel = target;
    this.roadGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);
  }

  setSpray(pressure, cap) {
    if (!this.ctx) return;
    const target = pressure > 0.03 ? 0.04 + 0.16 * pressure : 0;
    if (Math.abs(target - this.level) < 0.005) return;
    this.level = target;
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(target, t, 0.025);
    // embout fin : sifflement aigu, gros embout : souffle plus grave
    this.band.frequency.setTargetAtTime(7000 / Math.sqrt(cap.flow), t, 0.05);
  }

  rattle() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let k = 0; k < 2; k++) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2600 + Math.random() * 1400;
      f.Q.value = 8;
      const g = ctx.createGain();
      const t0 = t + k * 0.035;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.5, t0 + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.045);
      src.connect(f).connect(g).connect(ctx.destination);
      src.start(t0, Math.random());
      src.stop(t0 + 0.06);
    }
  }
}
