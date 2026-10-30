// Generative background music: every 5-10 minutes a calm piano piece is
// composed on the spot (chord progression, broken-chord left hand, sparse
// melody) on a soft piano voice with reverb. The mood follows the world: major
// by day, minor at night, low and sparse underground. Caves also get the odd
// distant rumble. Where the player stands also colours the piece: a music
// profile (ambience.js) swaps the scale, tempo, register and brightness, so a
// Highland Meadow sounds bright and open, a Magma Lake low and smouldering and a
// Great Rift vast and slow.

import { mulberry32 } from '../world/noise.js';
import { profileMode } from './ambience.js';

const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};
// progressions as scale degrees (0-based) of chord roots
const PROGRESSIONS = [[0, 5, 3, 4], [0, 3, 5, 4], [5, 3, 0, 4], [0, 4, 5, 3], [3, 0, 4, 5], [0, 2, 3, 4]];

export class Music {
  constructor(audio) {
    this.audio = audio;
    this.volume = 0.5;
    this.nextAt = 60 + Math.random() * 60; // first piece after 1-2 minutes
    this.clock = 0;
    this.playingUntil = 0;
    this.darkTime = 0;
    this.nextRumble = 60;
    this.bright = 1; // piano brightness of the piece being scheduled (profile.bright)
  }

  setVolume(v) { this.volume = v; if (this.out) this.out.gain.value = v; }

  ensureNodes() {
    const a = this.audio;
    if (!a.ctx || this.out) return !!this.out;
    const ctx = a.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    // reverb: 3.5 s of decaying stereo noise
    const len = Math.floor(ctx.sampleRate * 3.5);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.45;
    this.dry = ctx.createGain(); this.dry.gain.value = 0.75;
    this.dry.connect(this.out); this.dry.connect(this.reverb); this.reverb.connect(wet); wet.connect(this.out);
    this.out.connect(a.master);
    return true;
  }

  /** A soft piano-like note: a few decaying partials through a velocity-dependent lowpass. */
  note(t, freq, dur, vel, pan = 0, dest = this.dry) {
    const ctx = this.audio.ctx;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = (900 + vel * 2600) * this.bright;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const decay = Math.min(6, 1.2 + dur * 1.4) * (freq < 200 ? 1.4 : 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34 * vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    for (const [mult, amp, type] of [[1, 1, 'sine'], [2, 0.32, 'triangle'], [3, 0.08, 'sine'], [4.02, 0.04, 'sine']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      const og = ctx.createGain(); og.gain.value = amp;
      o.connect(og); og.connect(f);
      o.start(t); o.stop(t + decay + 0.05);
    }
    f.connect(g);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(dest); } else g.connect(dest);
  }

  /** Compose and schedule one piece; returns its length in seconds. */
  play(mood, rnd = Math.random, dest = this.dry, opts = {}) {
    const ctx = this.audio.ctx, t0 = ctx.currentTime + 0.3;
    const note = (t, f, d, v, pan) => this.note(t, f, d, v, pan, dest);
    const prof = opts.profile || null;
    const mode = prof ? profileMode(prof, mood) : mood === 'day' ? MODES.major : mood === 'night' ? (rnd() < 0.5 ? MODES.minor : MODES.dorian) : MODES.minor;
    const between = (r) => r[0] + rnd() * (r[1] - r[0]);
    this.bright = prof ? prof.bright : 1; // read by note() while this piece is scheduled; discs and caves keep 1
    const rootMidi = opts.root ?? (prof ? Math.floor(between(prof.root)) : (mood === 'cave' ? 45 : 50) + Math.floor(rnd() * 7)); // A2..D#3 or D3..G#3
    const bpm = opts.bpm ?? (prof ? between(prof.bpm) : mood === 'cave' ? 52 + rnd() * 10 : 62 + rnd() * 14);
    const beat = 60 / bpm;
    const prog = PROGRESSIONS[Math.floor(rnd() * PROGRESSIONS.length)];
    const midiOf = (deg, oct = 0) => rootMidi + 12 * (oct + Math.floor(deg / 7)) + mode[((deg % 7) + 7) % 7];
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const rounds = opts.rounds ?? (prof ? Math.round(between(prof.rounds)) : mood === 'cave' ? 2 : 3 + Math.floor(rnd() * 2));
    let t = t0, lastMel = 7 + 2;
    const density = prof ? prof.density * (mood === 'night' ? 0.8 : 1) : mood === 'cave' ? 0.25 : mood === 'night' ? 0.4 : 0.5;
    for (let r = 0; r < rounds; r++) {
      for (const deg of prog) {
        const chord = [deg, deg + 2, deg + 4];
        // left hand: broken chord over two bars
        const pattern = rnd() < 0.5 ? [0, 1, 2, 1] : [0, 2, 1, 2];
        for (let b = 0; b < 8; b += 2) {
          const tone = chord[pattern[(b / 2) % 4]];
          note(t + b * beat, hz(midiOf(tone, -1)), beat * 2, 0.35 + rnd() * 0.1, -0.3);
        }
        if (r > 0 || rnd() < 0.5) note(t, hz(midiOf(deg, -2)), beat * 6, 0.3, -0.2); // bass
        // right hand: sparse melody leaning on chord tones, stepping through the scale
        if (r > 0 || mood !== 'cave') {
          for (let h = 0; h < 16; h++) {
            if (rnd() > density || (r === rounds - 1 && h > 10)) continue;
            const target = chord[Math.floor(rnd() * 3)] + 7 * (rnd() < 0.7 ? 1 : 2);
            lastMel += Math.sign(target - lastMel) * (rnd() < 0.6 ? 1 : 2);
            if (Math.abs(lastMel - target) > 4) lastMel = target;
            note(t + h * beat / 2 + (rnd() - 0.5) * 0.03, hz(midiOf(lastMel, 0)), beat * (1 + rnd()), 0.45 + rnd() * 0.2, 0.25);
          }
        }
        t += 8 * beat;
      }
    }
    // closing chord
    for (const [k, d] of [[0, -1], [2, -1], [4, -1], [0, 0]].entries()) note(t + k * 0.06, hz(midiOf(d[0] + 0, d[1])), beat * 8, 0.35, (k - 1.5) * 0.2);
    return t - t0 + beat * 8;
  }

  /**
   * A music disc in a jukebox: the same piece every time (seeded), heard around x,y,z.
   * Returns a handle whose gain follows the listener's distance; stop() silences it.
   */
  playDisc(disc, x, y, z) {
    if (!this.ensureNodes()) return null;
    const ctx = this.audio.ctx, g = ctx.createGain();
    g.gain.value = 1; // placeDisc fades it with distance
    g.connect(this.dry);
    const len = this.play(disc.mood, mulberry32(disc.seed), g, { root: disc.root, bpm: disc.bpm, rounds: disc.rounds });
    const h = { x, y, z, gain: g, ends: ctx.currentTime + len + 2, stop: () => { try { g.gain.setTargetAtTime(0, ctx.currentTime, 0.2); setTimeout(() => g.disconnect(), 1500); } catch { /* closed */ } h.stopped = true; } };
    return h;
  }

  /** Jukebox volume by distance to the listener (fades out over 48 blocks). */
  placeDisc(h, lx, ly, lz) {
    if (!h || h.stopped) return;
    const d = Math.hypot(h.x - lx, h.y - ly, h.z - lz);
    h.gain.gain.setTargetAtTime(Math.max(0, 1 - d / 48) * 1.6, this.audio.ctx.currentTime, 0.3);
  }

  /** Distant cave rumble: a slow swell of filtered noise with a sliding low tone. */
  rumble() {
    const a = this.audio, ctx = a.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = a.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 2.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
    src.connect(f); f.connect(g); g.connect(this.dry);
    src.start(t); src.stop(t + 6.2);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70 + Math.random() * 30, t); o.frequency.exponentialRampToValueAtTime(38, t + 5);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.12, t + 2); og.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
    o.connect(og); og.connect(this.dry); o.start(t); o.stop(t + 5.6);
  }

  /** Called once per second. */
  update(dt, mood, inDarkCave, profile = null) {
    if (!this.ensureNodes()) return;
    this.clock += dt;
    if (this.volume > 0 && this.clock >= this.nextAt && this.clock >= this.playingUntil) {
      const len = this.play(mood, Math.random, this.dry, { profile });
      this.playingUntil = this.clock + len;
      this.nextAt = this.playingUntil + 300 + Math.random() * 300; // 5-10 minutes of silence
    }
    this.darkTime = inDarkCave ? this.darkTime + dt : 0;
    if (this.darkTime > 30 && this.clock >= this.nextRumble) {
      this.rumble();
      this.nextRumble = this.clock + 90 + Math.random() * 150;
    }
  }
}
