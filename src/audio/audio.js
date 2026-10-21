// Procedural Web Audio sound effects (no audio files). Every sound is
// synthesised from noise and oscillators so all audio is original.
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.5;
    this.listener = [0, 0, 0, 0]; // x,y,z,yaw
    this.noiseBuf = null;
    this.last = new Map();
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  /** Continuous rain hiss; `level` 0..1, muffled when the listener is under cover. */
  setRain(level, covered) {
    if (!this.ctx) return;
    if (!this.rainGain) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      this.rainFilter = this.ctx.createBiquadFilter();
      this.rainFilter.type = 'lowpass';
      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0;
      src.connect(this.rainFilter); this.rainFilter.connect(this.rainGain); this.rainGain.connect(this.master);
      src.start();
    }
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(level * (covered ? 0.12 : 0.22), t, 0.3);
    this.rainFilter.frequency.setTargetAtTime(covered ? 500 : 2600, t, 0.3);
  }
  setListener(x, y, z, yaw) { this.listener = [x, y, z, yaw]; }

  // spatial: returns [gain, pan]
  spatial(pos) {
    if (!pos) return [1, 0];
    const [lx, ly, lz, yaw] = this.listener;
    const dx = pos[0] - lx, dy = pos[1] - ly, dz = pos[2] - lz;
    const d = Math.hypot(dx, dy, dz);
    const g = Math.max(0, 1 - d / 16);
    // right vector (cos, -sin)
    const pan = d > 0.01 ? Math.max(-1, Math.min(1, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d)) : 0;
    return [g, pan];
  }

  noise(t0, dur, freq, q, gain, out, type = 'bandpass') {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true; // long sounds (thunder) outlast the 1 s buffer
    src.playbackRate.value = 0.5 + Math.random();
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.05);
  }

  tone(t0, dur, f0, f1, gain, out, type = 'sine') {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  play(name, pos = null, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const lastT = this.last.get(name) || 0;
    if (now - lastT < 0.03) return;
    this.last.set(name, now);
    const [g0, pan] = this.spatial(pos);
    const gain = g0 * vol;
    if (gain <= 0.01) return;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master);
    const out = p;
    const t = now;
    const mat = name.split('_').slice(1).join('_');
    const matFreq = { stone: 900, wood: 500, grass: 2400, gravel: 1400, sand: 3000, snow: 3500, glass: 4000, metal: 2500, wool: 1800 }[mat] || 1200;
    if (name.startsWith('break_')) { this.noise(t, 0.18, matFreq, 1.2, 0.6 * gain, out); this.noise(t + 0.03, 0.12, matFreq * 0.6, 2, 0.4 * gain, out); }
    else if (name.startsWith('hit_')) this.noise(t, 0.06, matFreq, 2, 0.25 * gain, out);
    else if (name.startsWith('place_')) this.noise(t, 0.1, matFreq * 0.8, 1.5, 0.5 * gain, out);
    else if (name.startsWith('step_')) this.noise(t, 0.07, matFreq * 0.7, 1.5, 0.12 * gain, out);
    else if (name.startsWith('chime_')) {
      // chime block: 25 semitones from F#3 like the reference note block, a bell-like pair of sines
      const f = 185 * Math.pow(2, (+name.slice(6) || 0) / 12);
      this.tone(t, 0.9, f, f * 0.995, 0.22 * gain, out, 'sine'); this.tone(t, 0.5, f * 2.01, f * 2, 0.07 * gain, out, 'sine');
    }
    else switch (name) {
      case 'pop': this.tone(t, 0.08, 600 + Math.random() * 400, 1400, 0.2 * gain, out, 'triangle'); break;
      case 'eat': this.noise(t, 0.08, 1800, 3, 0.25 * gain, out); break;
      case 'burp': this.tone(t, 0.25, 160, 90, 0.3 * gain, out, 'sawtooth'); break;
      case 'hurt': this.tone(t, 0.18, 320, 140, 0.35 * gain, out, 'square'); this.noise(t, 0.1, 800, 1, 0.2 * gain, out); break;
      case 'mob_hurt': this.tone(t, 0.15, 500 + Math.random() * 200, 200, 0.25 * gain, out, 'sawtooth'); break;
      case 'mob_death': this.tone(t, 0.4, 400, 60, 0.3 * gain, out, 'sawtooth'); break;
      case 'grunt': this.tone(t, 0.35, 110 + Math.random() * 30, 80, 0.25 * gain, out, 'sawtooth'); break;
      case 'oink': this.tone(t, 0.18, 300, 200, 0.2 * gain, out, 'square'); this.tone(t + 0.12, 0.12, 280, 180, 0.15 * gain, out, 'square'); break;
      case 'moo': this.tone(t, 0.7, 140, 110, 0.25 * gain, out, 'sawtooth'); break;
      case 'baa': this.tone(t, 0.45, 420, 380, 0.15 * gain, out, 'sawtooth'); break;
      case 'cluck': this.tone(t, 0.06, 900, 600, 0.15 * gain, out, 'square'); this.tone(t + 0.1, 0.06, 1000, 700, 0.15 * gain, out, 'square'); break;
      case 'rattle': for (let k = 0; k < 4; k++) this.noise(t + k * 0.05, 0.04, 2500, 6, 0.2 * gain, out); break;
      case 'hiss': this.noise(t, 1.3, 5000, 0.7, 0.35 * gain, out, 'highpass'); break;
      case 'skitter': for (let k = 0; k < 3; k++) this.noise(t + k * 0.06, 0.05, 3500, 4, 0.15 * gain, out); break;
      case 'warble': this.tone(t, 0.6, 200, 900, 0.18 * gain, out, 'sine'); this.tone(t, 0.6, 210, 60, 0.1 * gain, out, 'triangle'); break;
      case 'scream': this.tone(t, 0.8, 1200, 300, 0.2 * gain, out, 'sawtooth'); break;
      case 'teleport': this.tone(t, 0.3, 200, 1600, 0.2 * gain, out, 'sine'); break;
      case 'explode':
        this.noise(t, 1.6, 300, 0.5, 1.0 * gain, out, 'lowpass');
        this.tone(t, 0.8, 90, 30, 0.8 * gain, out, 'sine'); break;
      case 'bow': this.noise(t, 0.12, 1500, 3, 0.3 * gain, out); this.tone(t, 0.1, 300, 120, 0.2 * gain, out, 'triangle'); break;
      case 'arrow_hit': this.noise(t, 0.08, 1200, 4, 0.3 * gain, out); break;
      case 'splash': this.noise(t, 0.4, 1200, 0.8, 0.4 * gain, out); break;
      case 'bucket_fill': this.noise(t, 0.3, 900, 1, 0.3 * gain, out); break;
      case 'fizz': this.noise(t, 0.5, 4000, 1, 0.3 * gain, out, 'highpass'); break;
      case 'click': this.tone(t, 0.04, 1200, 900, 0.15 * gain, out, 'square'); break;
      case 'piston_out': this.noise(t, 0.16, 700, 1.2, 0.45 * gain, out, 'lowpass'); this.tone(t, 0.12, 180, 260, 0.15 * gain, out, 'triangle'); break;
      case 'piston_in': this.noise(t, 0.14, 600, 1.2, 0.4 * gain, out, 'lowpass'); this.tone(t, 0.12, 260, 160, 0.15 * gain, out, 'triangle'); break;
      case 'burnout': this.noise(t, 0.3, 4500, 1, 0.2 * gain, out, 'highpass'); break;
      case 'door_open': this.noise(t, 0.12, 900, 2, 0.25 * gain, out); this.tone(t, 0.18, 220, 300, 0.12 * gain, out, 'triangle'); break;
      case 'door_close': this.noise(t, 0.07, 600, 1.5, 0.4 * gain, out, 'lowpass'); this.tone(t, 0.08, 160, 110, 0.15 * gain, out, 'triangle'); break;
      case 'orb': this.tone(t, 0.12, 1200 + Math.random() * 500, 1800, 0.12 * gain, out, 'sine'); break;
      case 'enchant': for (let k = 0; k < 5; k++) this.tone(t + k * 0.06, 0.35, 700 + k * 180, 1400 + k * 220, 0.08 * gain, out, 'sine'); this.noise(t, 0.4, 5000, 1, 0.06 * gain, out, 'highpass'); break;
      case 'anvil': this.tone(t, 0.5, 1400, 1300, 0.18 * gain, out, 'triangle'); this.tone(t, 0.35, 2100, 1900, 0.1 * gain, out, 'sine'); this.noise(t, 0.06, 3000, 3, 0.3 * gain, out); break;
      case 'levelup': this.tone(t, 0.5, 600, 1200, 0.2 * gain, out, 'triangle'); this.tone(t + 0.1, 0.5, 900, 1600, 0.15 * gain, out, 'sine'); break;
      case 'equip': this.noise(t, 0.15, 2500, 2, 0.25 * gain, out); this.tone(t, 0.1, 500, 700, 0.1 * gain, out, 'square'); break;
      case 'ignite': this.noise(t, 0.05, 3000, 4, 0.3 * gain, out); this.tone(t, 0.04, 1800, 1200, 0.1 * gain, out, 'square'); this.noise(t + 0.06, 0.35, 900, 0.7, 0.2 * gain, out); break;
      case 'fire': this.noise(t, 0.9, 700, 0.6, 0.12 * gain, out, 'lowpass'); for (let k = 0; k < 4; k++) this.noise(t + Math.random() * 0.8, 0.02, 2500, 5, 0.12 * gain, out); break;
      case 'thunder': this.noise(t, 0.6, 400, 0.5, 0.9 * gain, out, 'lowpass'); this.noise(t + 0.3, 4, 110, 0.4, 1.2 * gain, out, 'lowpass'); this.noise(t + 1.2, 3, 70, 0.4, 0.9 * gain, out, 'lowpass'); break;
      case 'lightning': this.noise(t, 0.25, 6000, 0.3, 0.8 * gain, out, 'highpass'); this.noise(t, 0.6, 1500, 0.4, 0.6 * gain, out); break;
      case 'mew': this.tone(t, 0.22, 700 + Math.random() * 120, 1000, 0.12 * gain, out, 'triangle'); this.tone(t + 0.12, 0.2, 1000, 620, 0.1 * gain, out, 'triangle'); break;
      case 'squeak': this.tone(t, 0.06, 3200 + Math.random() * 800, 2600, 0.06 * gain, out, 'sine'); this.tone(t + 0.08, 0.05, 3400, 2800, 0.05 * gain, out, 'sine'); break;
      case 'neigh': this.tone(t, 0.5, 700, 500, 0.15 * gain, out, 'sawtooth'); this.tone(t + 0.05, 0.4, 820, 560, 0.08 * gain, out, 'square'); break;
      case 'shield': this.noise(t, 0.1, 700, 1.5, 0.45 * gain, out, 'lowpass'); this.tone(t, 0.12, 180, 120, 0.2 * gain, out, 'triangle'); break;
      case 'fuse': this.noise(t, 1.2, 5000, 0.6, 0.25 * gain, out, 'highpass'); break;
      case 'rail': this.noise(t, 0.12, 2200, 3, 0.12 * gain, out); this.tone(t, 0.05, 900, 700, 0.04 * gain, out, 'square'); break;
      case 'squish': this.noise(t, 0.12, 500, 2, 0.3 * gain, out, 'lowpass'); this.tone(t, 0.1, 160, 90, 0.12 * gain, out, 'sine'); break;
      case 'clank': this.tone(t, 0.18, 220, 120, 0.25 * gain, out, 'square'); this.noise(t, 0.15, 1800, 2, 0.3 * gain, out); break;
      case 'howl': this.tone(t, 0.12, 380, 520, 0.2 * gain, out, 'sawtooth'); this.tone(t + 0.18, 0.1, 400, 300, 0.18 * gain, out, 'sawtooth'); break;
      case 'shear': this.noise(t, 0.06, 4000, 3, 0.25 * gain, out); this.noise(t + 0.08, 0.06, 3500, 3, 0.25 * gain, out); break;
      case 'hmm': this.tone(t, 0.12, 180, 210, 0.2 * gain, out, 'sawtooth'); this.tone(t + 0.13, 0.22, 210, 150, 0.2 * gain, out, 'sawtooth'); break;
      case 'page': this.noise(t, 0.12, 2400, 1.5, 0.12 * gain, out); this.noise(t + 0.1, 0.1, 3000, 1.5, 0.08 * gain, out); break;
      case 'chest_open': this.tone(t, 0.25, 180, 240, 0.18 * gain, out, 'sawtooth'); this.noise(t, 0.2, 700, 2, 0.15 * gain, out); break;
      case 'chest_close': this.noise(t, 0.08, 500, 1.5, 0.35 * gain, out, 'lowpass'); this.tone(t, 0.1, 140, 90, 0.2 * gain, out, 'triangle'); break;
      case 'drink': this.tone(t, 0.07, 260 + Math.random() * 60, 180, 0.18 * gain, out, 'sine'); this.noise(t, 0.06, 700, 2, 0.12 * gain, out, 'lowpass'); break;
      case 'glass_break': for (let k = 0; k < 4; k++) this.tone(t + k * 0.025, 0.12, 2600 + Math.random() * 1800, 1800, 0.09 * gain, out, 'triangle'); this.noise(t, 0.2, 5000, 1.5, 0.35 * gain, out, 'highpass'); break;
      case 'brew': this.tone(t, 0.18, 500, 760, 0.1 * gain, out, 'sine'); this.tone(t + 0.15, 0.25, 760, 1000, 0.08 * gain, out, 'sine'); this.noise(t, 0.35, 1200, 1, 0.08 * gain, out); break;
      case 'bubble': this.tone(t, 0.05, 400 + Math.random() * 300, 900, 0.06 * gain, out, 'sine'); break;
      case 'land': this.noise(t, 0.12, 500, 1, 0.4 * gain, out, 'lowpass'); break;
      default: this.tone(t, 0.1, 440, 440, 0.1 * gain, out);
    }
  }
}
