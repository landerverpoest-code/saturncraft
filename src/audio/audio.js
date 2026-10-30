// Procedural Web Audio sound effects (no audio files). Every sound is
// synthesised from noise and oscillators so all audio is original.
import { REVERB_DECAYS, roofVoice, rainUnderCover } from './acoustics.js';

// Looping noise layers of the ambient bed (levels come from ambience.js). Each has a slow
// tremolo (lfo Hz, depth 0..1) so wind swells and crickets pulse.
export const BED_LAYERS = {
  wind: { type: 'bandpass', freq: 480, q: 0.6, lfo: 0.13, depth: 0.55 },
  insects: { type: 'highpass', freq: 5400, q: 0.7, lfo: 7.5, depth: 0.85 },
  rumble: { type: 'lowpass', freq: 85, q: 0.7, lfo: 0.06, depth: 0.45 },
  sizzle: { type: 'highpass', freq: 6800, q: 0.5, lfo: 0.35, depth: 0.6 },
  water: { type: 'bandpass', freq: 2700, q: 0.35, lfo: 0.21, depth: 0.15 },
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.5;
    this.listener = [0, 0, 0, 0]; // x,y,z,yaw
    this.noiseBuf = null;
    this.last = new Map();
    this.onPlay = null;     // (name, pos, vol) for every sound asked for
    this.room = { wet: 0, bucket: 0, damp: 9000 }; // reverb of the space the listener is in (setRoom)
    this.irs = [];          // impulse responses per REVERB_DECAYS bucket, built on first use
    this.bed = new Map();   // ambient bed layers, created when first asked for
    this.nextPatter = 0;    // when the next rain droplet tick on the roof is due
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

  /**
   * Continuous rain hiss; `level` 0..1. Under a roof (`covered`) it takes the voice of the roof's
   * material (`roof` = { mat, depth } from acoustics.roofMaterial): glass pings, wood knocks, leaves
   * hush, and it fades away under deep rock.
   */
  setRain(level, covered, roof = null) {
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
    if (!covered || !roof) {
      this.rainGain.gain.setTargetAtTime(level * (covered ? 0.12 : 0.22), t, 0.3);
      this.rainFilter.frequency.setTargetAtTime(covered ? 500 : 2600, t, 0.3);
      return;
    }
    const v = roofVoice(roof.mat), vol = level * rainUnderCover(roof);
    this.rainGain.gain.setTargetAtTime(vol * v.gain, t, 0.3);
    this.rainFilter.frequency.setTargetAtTime(v.freq * 2.2, t, 0.3);
    // droplets drumming on the roof
    if (vol > 0.05 && this.ctx.state === 'running' && t >= this.nextPatter) {
      this.nextPatter = t + (0.6 + Math.random() * 0.8) / (v.tick.rate * vol);
      this.noise(t, 0.035, v.tick.freq * (0.8 + Math.random() * 0.4), v.tick.q, v.tick.gain * vol, this.master);
    }
  }

  /** Looping ambient layers: `levels` maps BED_LAYERS names to gains (layers not mentioned fade out). */
  setBed(levels) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [name, def] of Object.entries(BED_LAYERS)) {
      const want = levels[name] || 0;
      let L = this.bed.get(name);
      if (!L) {
        if (want <= 0) continue; // never build a layer that is not wanted
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf; src.loop = true; src.playbackRate.value = 0.8 + Math.random() * 0.4;
        const f = this.ctx.createBiquadFilter(); f.type = def.type; f.frequency.value = def.freq; f.Q.value = def.q;
        const mod = this.ctx.createGain(); mod.gain.value = 1;
        const lfo = this.ctx.createOscillator(); lfo.frequency.value = def.lfo * (0.85 + Math.random() * 0.3);
        const depth = this.ctx.createGain(); depth.gain.value = def.depth * 0.5;
        lfo.connect(depth); depth.connect(mod.gain);
        const amp = this.ctx.createGain(); amp.gain.value = 0;
        src.connect(f); f.connect(mod); mod.connect(amp); amp.connect(this.master);
        src.start(t, Math.random() * 0.5); lfo.start(t);
        L = { amp };
        this.bed.set(name, L);
      }
      L.amp.gain.setTargetAtTime(want, t, 1.5);
    }
  }

  /** Impulse response for a reverb bucket: decaying stereo noise, cached. */
  impulse(bucket) {
    if (this.irs[bucket]) return this.irs[bucket];
    const sr = this.ctx.sampleRate, secs = REVERB_DECAYS[bucket] ?? 1, len = Math.floor(sr * secs);
    const ir = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return (this.irs[bucket] = ir);
  }

  /** Reverb of the listener's surroundings (acoustics.reverbFor): a send level, a tail length bucket and a damping filter. */
  setRoom(room) {
    if (!this.ctx) return;
    this.room = room;
    if (room.wet <= 0 && !this.verb) return; // never built, nothing to do in the open
    if (!this.verb) {
      this.verb = this.ctx.createConvolver();
      this.verbIn = this.ctx.createGain();
      this.verbDamp = this.ctx.createBiquadFilter(); this.verbDamp.type = 'lowpass'; this.verbDamp.frequency.value = 9000;
      this.verbOut = this.ctx.createGain(); this.verbOut.gain.value = 1;
      this.verbIn.connect(this.verb); this.verb.connect(this.verbDamp); this.verbDamp.connect(this.verbOut); this.verbOut.connect(this.master);
      this.verb.buffer = this.impulse(room.bucket);
      this.verbBucket = room.bucket;
    }
    const t = this.ctx.currentTime;
    this.verbDamp.frequency.setTargetAtTime(room.damp, t, 0.4);
    if (room.bucket !== this.verbBucket && room.wet > 0) {
      // swap the tail while the return is silent so the buffer change does not click
      this.verbBucket = room.bucket;
      this.verbOut.gain.setTargetAtTime(0, t, 0.04);
      setTimeout(() => { if (this.verb) { this.verb.buffer = this.impulse(room.bucket); this.verbOut.gain.setTargetAtTime(1, this.ctx.currentTime, 0.1); } }, 220);
    }
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
    if (this.onPlay) this.onPlay(name, pos, vol); // sound captions (ui/accessibility.js); also when the audio context is not running
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
    if (pos && this.room.wet > 0.02 && this.verbIn) { // reverb send: caves ring, open ground does not
      const send = this.ctx.createGain();
      send.gain.value = this.room.wet * Math.min(1, gain * 1.5);
      p.connect(send); send.connect(this.verbIn);
    }
    const out = p;
    const t = now;
    const mat = name.split('_').slice(1).join('_');
    const matFreq = { stone: 900, wood: 500, grass: 2400, gravel: 1400, sand: 3000, snow: 3500, glass: 4000, metal: 2500, wool: 1800, mud: 420 }[mat] || 1200;
    if (name.startsWith('break_')) { this.noise(t, 0.18, matFreq, 1.2, 0.6 * gain, out); this.noise(t + 0.03, 0.12, matFreq * 0.6, 2, 0.4 * gain, out); }
    else if (name.startsWith('hit_')) this.noise(t, 0.06, matFreq, 2, 0.25 * gain, out);
    else if (name.startsWith('place_')) this.noise(t, 0.1, matFreq * 0.8, 1.5, 0.5 * gain, out);
    else if (name === 'step_mud') { this.noise(t, 0.09, 420, 1.2, 0.14 * gain, out); this.tone(t + 0.02, 0.08, 160, 90, 0.05 * gain, out, 'sine'); } // a wet squelch
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
      case 'squawk': this.tone(t, 0.12, 1400 + Math.random() * 400, 900, 0.1 * gain, out, 'square'); this.tone(t + 0.14, 0.1, 1600, 1100, 0.08 * gain, out, 'square'); break;
      case 'crack': this.noise(t, 0.05, 2500, 4, 0.3 * gain, out); this.noise(t + 0.07, 0.04, 3000, 4, 0.2 * gain, out); break;
      case 'buzz': this.tone(t, 0.6, 210 + Math.random() * 30, 230, 0.05 * gain, out, 'sawtooth'); break;
      case 'bleat': this.tone(t, 0.3, 520 + Math.random() * 80, 470, 0.14 * gain, out, 'sawtooth'); this.tone(t, 0.3, 530, 480, 0.06 * gain, out, 'square'); break;
      case 'ram': this.noise(t, 0.18, 300, 1, 0.4 * gain, out); this.tone(t, 0.12, 90, 50, 0.3 * gain, out, 'sine'); break;
      case 'horn': this.tone(t, 2.2, 196, 207, 0.22 * gain, out, 'sawtooth'); this.tone(t, 2.2, 294, 300, 0.12 * gain, out, 'sawtooth'); this.tone(t + 0.1, 2.0, 392, 380, 0.06 * gain, out, 'triangle'); break;
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
      case 'strider': this.tone(t, 0.6, 120, 85, 0.22 * gain, out, 'sawtooth'); this.noise(t + 0.1, 0.4, 300, 1, 0.12 * gain, out, 'lowpass'); break; // a Dune Strider's low grumble
      case 'hoverling': for (let k = 0; k < 3; k++) this.tone(t + k * 0.07, 0.18, 1500 + k * 260 + Math.random() * 120, 1900 + k * 260, 0.05 * gain, out, 'sine'); break; // a Hoverling's twinkle
      case 'gust': this.noise(t, 0.45, 2200, 0.7, 0.22 * gain, out, 'highpass'); this.tone(t, 0.35, 380, 760, 0.05 * gain, out, 'sine'); break; // a Gustling's rush of wind
      case 'neigh': this.tone(t, 0.5, 700, 500, 0.15 * gain, out, 'sawtooth'); this.tone(t + 0.05, 0.4, 820, 560, 0.08 * gain, out, 'square'); break;
      case 'shield': this.noise(t, 0.1, 700, 1.5, 0.45 * gain, out, 'lowpass'); this.tone(t, 0.12, 180, 120, 0.2 * gain, out, 'triangle'); break;
      case 'parry': this.tone(t, 0.1, 900, 1500, 0.2 * gain, out, 'triangle'); this.noise(t, 0.08, 3000, 2, 0.35 * gain, out, 'highpass'); this.tone(t, 0.12, 200, 140, 0.2 * gain, out, 'triangle'); break; // a shield parry rings
      case 'shield_break': this.noise(t, 0.25, 500, 1, 0.6 * gain, out, 'lowpass'); this.tone(t, 0.3, 140, 60, 0.3 * gain, out, 'sawtooth'); this.noise(t + 0.05, 0.1, 2500, 2, 0.3 * gain, out); break; // an axe knocks a shield down
      case 'fuse': this.noise(t, 1.2, 5000, 0.6, 0.25 * gain, out, 'highpass'); break;
      case 'rail': this.noise(t, 0.12, 2200, 3, 0.12 * gain, out); this.tone(t, 0.05, 900, 700, 0.04 * gain, out, 'square'); break;
      case 'croak': this.tone(t, 0.09, 140 + Math.random() * 30, 110, 0.2 * gain, out, 'sawtooth'); this.tone(t + 0.12, 0.12, 160, 100, 0.18 * gain, out, 'sawtooth'); break;
      case 'squish': this.noise(t, 0.12, 500, 2, 0.3 * gain, out, 'lowpass'); this.tone(t, 0.1, 160, 90, 0.12 * gain, out, 'sine'); break;
      case 'clank': this.tone(t, 0.18, 220, 120, 0.25 * gain, out, 'square'); this.noise(t, 0.15, 1800, 2, 0.3 * gain, out); break;
      case 'howl': this.tone(t, 0.12, 380, 520, 0.2 * gain, out, 'sawtooth'); this.tone(t + 0.18, 0.1, 400, 300, 0.18 * gain, out, 'sawtooth'); break;
      case 'grind': for (let k = 0; k < 5; k++) this.noise(t + k * 0.07, 0.09, 1600 + k * 120, 2.5, 0.22 * gain, out); break; // a wheel grinding the gear
      case 'saw': this.noise(t, 0.25, 4200, 5, 0.25 * gain, out); this.tone(t, 0.25, 1800, 2200, 0.04 * gain, out, 'sawtooth'); break; // the stonecutter's blade biting
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
      case 'rocket': this.noise(t, 0.7, 2200, 0.6, 0.3 * gain, out, 'highpass'); this.tone(t, 0.5, 300, 900, 0.06 * gain, out, 'sine'); break;
      case 'rocket_burst': this.noise(t, 0.4, 300, 0.5, 0.7 * gain, out, 'lowpass'); for (let k = 0; k < 6; k++) this.noise(t + 0.15 + Math.random() * 0.6, 0.03, 3500, 4, 0.15 * gain, out); break;
      // the Deep Hush (world/hushSystem.js, mobs/hushkeeper.js)
      case 'hush_sensor': this.tone(t, 0.25, 900, 1500, 0.06 * gain, out, 'sine'); this.noise(t, 0.2, 3000, 6, 0.08 * gain, out); break;
      case 'shriek':
        // a rising, wavering howl with a breathy rasp under it
        for (let k = 0; k < 3; k++) this.tone(t + k * 0.04, 2.2, 260 + k * 37, 1500 + k * 90, 0.12 * gain, out, k === 1 ? 'sawtooth' : 'triangle');
        this.noise(t, 2.4, 1800, 0.8, 0.25 * gain, out); this.noise(t + 0.5, 1.8, 600, 0.6, 0.18 * gain, out, 'lowpass'); break;
      case 'hush_heart': this.tone(t, 0.18, 70, 45, 0.5 * gain, out, 'sine'); this.tone(t + 0.22, 0.2, 62, 40, 0.4 * gain, out, 'sine'); break;
      case 'hush_growl': this.tone(t, 1.1, 75, 55, 0.35 * gain, out, 'sawtooth'); this.noise(t, 1.0, 220, 1.2, 0.3 * gain, out, 'lowpass'); break;
      case 'hush_sniff': for (let k = 0; k < 3; k++) this.noise(t + k * 0.16, 0.12, 1200, 1.5, 0.22 * gain, out); break;
      case 'emerge': this.noise(t, 3.5, 140, 0.5, 0.9 * gain, out, 'lowpass'); for (let k = 0; k < 8; k++) this.noise(t + k * 0.4 + Math.random() * 0.2, 0.15, 700, 1, 0.3 * gain, out); break;
      case 'sonic_charge': this.tone(t, 1.6, 120, 900, 0.18 * gain, out, 'sawtooth'); this.noise(t, 1.6, 500, 2, 0.15 * gain, out); break;
      case 'sonic_boom': this.tone(t, 0.9, 140, 35, 1.0 * gain, out, 'sine'); this.noise(t, 0.7, 900, 0.4, 0.8 * gain, out); this.tone(t, 0.4, 900, 200, 0.25 * gain, out, 'square'); break;
      case 'catalyst': this.tone(t, 0.6, 300, 600, 0.12 * gain, out, 'sine'); this.noise(t, 0.5, 900, 1, 0.12 * gain, out, 'lowpass'); break;
      // ambient one-shots (audio/ambience.js)
      case 'bird_trill': { const f = 2300 + Math.random() * 900; for (let k = 0; k < 4 + Math.floor(Math.random() * 3); k++) this.tone(t + k * 0.085, 0.07, f + k * 160 * (k % 2 ? -1 : 1), f + 380, 0.045 * gain, out, 'sine'); break; }
      case 'cricket': for (let k = 0; k < 3; k++) this.tone(t + k * 0.07, 0.045, 4300, 4500, 0.03 * gain, out, 'sine'); break;
      case 'owl': this.tone(t, 0.35, 420, 380, 0.09 * gain, out, 'sine'); this.tone(t + 0.45, 0.6, 360, 300, 0.09 * gain, out, 'sine'); break;
      case 'drip': this.tone(t, 0.07, 1900 + Math.random() * 700, 900, 0.07 * gain, out, 'sine'); this.noise(t, 0.015, 3500, 4, 0.05 * gain, out); break;
      case 'lava_pop': this.tone(t, 0.14, 110 + Math.random() * 40, 55, 0.2 * gain, out, 'sine'); this.noise(t, 0.12, 700, 1.5, 0.13 * gain, out, 'lowpass'); this.noise(t + 0.09, 0.05, 3000, 3, 0.05 * gain, out); break;
      case 'rift_moan': this.tone(t, 3.2, 58, 46, 0.13 * gain, out, 'sine'); this.tone(t + 0.4, 2.6, 87, 70, 0.05 * gain, out, 'triangle'); this.noise(t, 3.2, 260, 0.8, 0.12 * gain, out, 'lowpass'); break;
      case 'breeze': this.noise(t, 1.8, 600, 0.5, 0.1 * gain, out); this.noise(t + 0.3, 1.5, 1400, 0.6, 0.04 * gain, out); break;
      case 'ember_snap': this.noise(t, 0.03, 2800, 5, 0.12 * gain, out); this.tone(t, 0.05, 1300, 700, 0.04 * gain, out, 'square'); break;
      case 'void_whisper': this.tone(t, 2.0, 1150, 1090, 0.03 * gain, out, 'sine'); this.tone(t + 0.1, 1.8, 1740, 1660, 0.02 * gain, out, 'sine'); this.noise(t, 1.8, 3200, 4, 0.04 * gain, out); break;
      default: this.tone(t, 0.1, 440, 440, 0.1 * gain, out);
    }
  }
}
