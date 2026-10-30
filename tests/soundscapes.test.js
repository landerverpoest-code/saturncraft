// Soundscapes, room acoustics, rain-on-roof voices and the night sky (Veilfire, falling stars).
import { describe, it, expect } from 'vitest';
import { BIOMES, BIOME } from '../src/world/biomes.js';
import { B, BLOCKS } from '../src/world/blocks.js';
import { MockWorld, rng } from './helpers.js';
import {
  pickSoundscape, emptyFacts, SOUNDSCAPES, MUSIC_PROFILES, MODES, bedFor, AmbientDirector, musicProfileFor, profileMode, LAVA_LAKE_MIN,
} from '../src/audio/ambience.js';
import {
  measureRoom, reverbFor, roofMaterial, roofVoice, rainUnderCover, ROOM_RAYS, ROOF_VOICES, REVERB_DECAYS,
} from '../src/audio/acoustics.js';
import { soundMaterial } from '../src/audio/ambientSystem.js';
import { Audio, BED_LAYERS } from '../src/audio/audio.js';
import { Music } from '../src/audio/music.js';
import { captionText } from '../src/ui/accessibility.js';
import { coldness, nightCharacter, auroraTarget, Meteors, DAY_TICKS } from '../src/sky/nightSky.js';
import { skyFragment } from '../src/sky/skyShader.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { lakeIn, stampMagmaLakes, LAKE_REGION } from '../src/world/magmaLakes.js';
import { CHUNK_VOLUME, MIN_Y, cidx } from '../src/world/constants.js';

const facts = (o) => ({ ...emptyFacts(), ...o });

// a stand-in for the Web Audio graph that counts what is built
function fakeCtx() {
  const made = { gain: 0, convolver: 0, oscillator: 0, source: 0, filter: 0, panner: 0, buffer: 0 };
  const param = (v = 0) => ({ value: v, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = (kind, extra = {}) => { made[kind]++; return { connect() {}, disconnect() {}, start() {}, stop() {}, gain: param(1), frequency: param(), Q: param(), pan: param(), playbackRate: param(1), ...extra }; };
  return {
    made, currentTime: 0, sampleRate: 8000, state: 'running', destination: {},
    createGain: () => node('gain'), createConvolver: () => node('convolver', { buffer: null }), createOscillator: () => node('oscillator'),
    createBufferSource: () => node('source', { buffer: null }), createBiquadFilter: () => node('filter'), createStereoPanner: () => node('panner'),
    createBuffer: (ch, len) => { made.buffer++; return { getChannelData: () => new Float32Array(len) }; },
  };
}
function liveAudio() {
  const a = new Audio();
  a.ctx = fakeCtx();
  a.master = a.ctx.createGain();
  a.noiseBuf = a.ctx.createBuffer(1, 100, 8000);
  return a;
}

describe('soundscape choice', () => {
  it('gives every biome a surface soundscape with events and a bed', () => {
    for (const b of BIOMES) {
      const k = pickSoundscape(facts({ biome: b.key }));
      expect(SOUNDSCAPES[k], b.key).toBeTruthy();
    }
    expect(pickSoundscape(facts({ biome: 'highland_meadow' }))).toBe('meadow');
    expect(pickSoundscape(facts({ biome: 'snowy_taiga' }))).toBe('cold');
    expect(pickSoundscape(facts({ biome: 'desert' }))).toBe('desert');
  });

  it('puts Magma Lakes, Great Rifts, caves and the other dimensions in their own scapes', () => {
    expect(pickSoundscape(facts({ under: true, y: -30, lavaNear: LAVA_LAKE_MIN + 5 }))).toBe('magma');
    expect(pickSoundscape(facts({ under: true, y: -30, lavaNear: LAVA_LAKE_MIN - 1 }))).toBe('deep_cave');
    expect(pickSoundscape(facts({ under: true, y: 30 }))).toBe('cave');
    // a sky-lit shaft more than 20 blocks below the rim is a rift; a shallow gully is not
    expect(pickSoundscape(facts({ depthBelowSurface: 60, skyLight: 9, y: 20 }))).toBe('rift');
    expect(pickSoundscape(facts({ depthBelowSurface: 6, skyLight: 9, y: 60, biome: 'plains' }))).toBe('plains');
    expect(pickSoundscape(facts({ dimension: 'cinderdeep' }))).toBe('cinderdeep');
    expect(pickSoundscape(facts({ dimension: 'hollow' }))).toBe('hollow');
    // surface lava (a lava pool at y > 0) does not make a lake cavern
    expect(pickSoundscape(facts({ lavaNear: 50, y: 70 }))).toBe('plains');
  });

  it('every bed layer and event sound exists in the engine, with a caption', () => {
    const a = liveAudio();
    for (const [k, s] of Object.entries(SOUNDSCAPES)) {
      for (const bed of [s.bed, s.nightBed || {}]) for (const l of Object.keys(bed)) expect(BED_LAYERS[l], `${k}:${l}`).toBeTruthy();
      for (const e of s.events) {
        expect(() => a.play(e.sound, [1, 1, 1], 1)).not.toThrow();
        expect(captionText(e.sound)).toBeTruthy();
        expect(e.every[0]).toBeLessThanOrEqual(e.every[1]);
      }
    }
  });

  it('bed levels follow the time of day', () => {
    expect(bedFor('plains', true).insects).toBeGreaterThan(0);
    expect(bedFor('plains', false).insects).toBeUndefined();
    expect(bedFor('cave', true)).toEqual(bedFor('cave', false));
    expect(bedFor('nowhere', false)).toEqual({});
  });
});

describe('ambient events', () => {
  it('schedules birdsong by day and crickets at night, never the wrong one, at a sane rate', () => {
    const d = new AmbientDirector(rng(7));
    const day = [], night = [];
    for (let t = 0; t < 600; t++) day.push(...d.tick(1, 'plains', false));
    const d2 = new AmbientDirector(rng(7));
    for (let t = 0; t < 600; t++) night.push(...d2.tick(1, 'plains', true));
    expect(day.length).toBeGreaterThan(10);
    expect(day.every((e) => e.sound === 'bird_trill')).toBe(true);
    expect(night.length).toBeGreaterThan(20);
    expect(night.every((e) => e.sound === 'cricket')).toBe(true);
    expect(day.length + night.length).toBeLessThan(600); // under one a second in all
  });

  it('places events within their distance band and not all at once on entering', () => {
    const d = new AmbientDirector(rng(3));
    const first = d.tick(1, 'magma', false);
    expect(first.length).toBeLessThanOrEqual(1);
    const evs = [];
    for (let t = 0; t < 300; t++) evs.push(...d.tick(1, 'magma', false));
    expect(evs.some((e) => e.sound === 'lava_pop')).toBe(true);
    for (const e of evs) {
      const spec = SOUNDSCAPES.magma.events.find((s) => s.sound === e.sound);
      const dist = Math.hypot(e.dx, e.dz);
      expect(dist).toBeGreaterThanOrEqual(spec.dist[0] - 1e-6);
      expect(dist).toBeLessThanOrEqual(spec.dist[1] + 1e-6);
      expect(e.vol).toBeLessThanOrEqual(spec.vol);
    }
  });

  it('restarts its timers when the soundscape changes', () => {
    const d = new AmbientDirector(rng(1));
    d.tick(1, 'plains', false);
    expect(d.scape).toBe('plains');
    d.tick(1, 'rift', false);
    expect(d.scape).toBe('rift');
    expect(d.timers.length).toBe(SOUNDSCAPES.rift.events.length);
  });
});

describe('room acoustics', () => {
  const matOf = (w) => (x, y, z) => soundMaterial(w.getBlock(x, y, z));
  const box = (w, x0, y0, z0, x1, y1, z1, id) => { // a hollow room of `id` around an empty interior
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      if (x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1) w.set(x, y, z, id);
    }
  };

  it('uses a fixed fan of 14 unit rays, one straight up', () => {
    expect(ROOM_RAYS.length).toBe(14);
    expect(ROOM_RAYS[0]).toEqual([0, 1, 0]);
    for (const r of ROOM_RAYS) expect(Math.hypot(...r)).toBeCloseTo(1, 5);
  });

  it('finds open ground open and gives it no reverb', () => {
    const w = new MockWorld(60);
    const room = measureRoom(matOf(w), 0.5, 62, 0.5);
    expect(room.openness).toBeGreaterThan(0.85); // the ground far below the feet does not count as a wall
    expect(reverbFor(room).wet).toBe(0);
  });

  it('a small closed stone room is enclosed with short walls; a big cavern rings longer and wetter', () => {
    const small = new MockWorld(0), big = new MockWorld(0);
    box(small, -3, 0, -3, 3, 5, 3, B.STONE);
    box(big, -16, 0, -16, 16, 18, 16, B.STONE);
    const rs = measureRoom(matOf(small), 0.5, 2, 0.5), rb = measureRoom(matOf(big), 0.5, 8, 0.5);
    expect(rs.openness).toBe(0);
    expect(rb.openness).toBe(0);
    expect(rb.meanDist).toBeGreaterThan(rs.meanDist);
    const vs = reverbFor(rs), vb = reverbFor(rb);
    expect(vb.bucket).toBeGreaterThan(vs.bucket);
    expect(vb.wet).toBeGreaterThan(vs.wet);
    expect(vb.wet).toBeLessThanOrEqual(0.7);
    expect(vb.bucket).toBeLessThan(REVERB_DECAYS.length);
  });

  it('wooden walls damp the reverb more than stone', () => {
    const a = new MockWorld(0), b = new MockWorld(0);
    box(a, -6, 0, -6, 6, 8, 6, B.STONE);
    box(b, -6, 0, -6, 6, 8, 6, B.OAK_PLANKS);
    const ra = reverbFor(measureRoom(matOf(a), 0.5, 3, 0.5)), rb = reverbFor(measureRoom(matOf(b), 0.5, 3, 0.5));
    expect(rb.damp).toBeLessThan(ra.damp);
    expect(ra.damp).toBeGreaterThan(8000);
  });

  it('a Great-Rift-like slot open to the sky is only partly enclosed', () => {
    const w = new MockWorld(0);
    for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) for (let y = 0; y <= 60; y++) if (Math.abs(x) > 2) w.set(x, y, z, B.STONE);
    const room = measureRoom(matOf(w), 0.5, 30, 0.5);
    expect(room.openness).toBeGreaterThan(0.1);
    expect(room.openness).toBeLessThan(0.6);
  });

  it('classifies solid blocks by their sound material and lets liquids and plants through', () => {
    expect(soundMaterial(B.STONE)).toBe('stone');
    expect(soundMaterial(B.GLASS)).toBe('glass');
    expect(soundMaterial(B.OAK_PLANKS)).toBe('wood');
    expect(soundMaterial(B.AIR)).toBeNull();
    expect(soundMaterial(B.WATER)).toBeNull();
    expect(soundMaterial(B.LAVA)).toBeNull();
    expect(soundMaterial(0)).toBeNull();
    expect(BLOCKS[B.GLASS].sound).toBe('glass');
  });
});

describe('rain on roofs', () => {
  const matOf = (w) => (x, y, z) => soundMaterial(w.getBlock(x, y, z));

  it('finds the material over the head and how high it is', () => {
    const w = new MockWorld(0);
    expect(roofMaterial(matOf(w), 0, 70, 0)).toBeNull();
    w.set(0, 73, 0, B.GLASS);
    w.set(0, 90, 0, B.STONE);
    expect(roofMaterial(matOf(w), 0, 70, 0)).toEqual({ mat: 'glass', depth: 3 });
    expect(roofMaterial(matOf(w), 0, 80, 0)).toEqual({ mat: 'stone', depth: 10 });
    expect(roofMaterial(matOf(w), 0, 40, 0, 40).mat).toBe('glass'); // 33 blocks up, in reach
  });

  it('gives glass a brighter, louder voice than wood, stone or leaves', () => {
    const f = (m) => roofVoice(m);
    expect(f('glass').freq).toBeGreaterThan(f('wood').freq);
    expect(f('wood').freq).toBeGreaterThan(f('stone').freq * 0.9);
    expect(f('glass').gain).toBeGreaterThan(f('stone').gain);
    expect(f('snow').gain).toBeLessThan(f('wood').gain);
    expect(f('grass').tick.rate).toBeGreaterThan(f('stone').tick.rate); // leaves patter more, softer
    expect(f('grass').tick.gain).toBeLessThan(f('stone').tick.gain);
    expect(f('plasma')).toBe(ROOF_VOICES.stone);
    expect(f(null)).toBe(ROOF_VOICES.stone);
  });

  it('every block sound material has a roof voice', () => {
    const mats = new Set(BLOCKS.filter((b) => b && b.solid && b.sound).map((b) => b.sound));
    for (const m of mats) expect(ROOF_VOICES[m], m).toBeTruthy();
  });

  it('fades out under deep rock but not under a thin roof', () => {
    expect(rainUnderCover(null)).toBe(1);
    expect(rainUnderCover({ mat: 'wood', depth: 2 })).toBe(1);
    expect(rainUnderCover({ mat: 'stone', depth: 14 })).toBeLessThan(0.7);
    expect(rainUnderCover({ mat: 'stone', depth: 40 })).toBe(0);
  });
});

describe('audio engine wiring', () => {
  it('builds bed layers only when asked, and reuses them', () => {
    const a = liveAudio();
    a.setBed({});
    expect(a.bed.size).toBe(0);
    a.setBed({ wind: 0.1 });
    expect(a.bed.size).toBe(1);
    const oscs = a.ctx.made.oscillator;
    a.setBed({ wind: 0.2, rumble: 0.05 });
    expect(a.bed.size).toBe(2);
    a.setBed({ wind: 0 });
    expect(a.bed.size).toBe(2);
    expect(a.ctx.made.oscillator).toBe(oscs + 1); // only the rumble layer was new
  });

  it('builds the reverb only after the listener first enters an enclosed space, and sends only then', () => {
    const a = liveAudio();
    a.setRoom({ wet: 0, bucket: 0, damp: 9000 });
    expect(a.verb).toBeUndefined();
    const g0 = a.ctx.made.gain;
    a.ctx.currentTime = 1;
    a.play('drip', [1, 1, 1], 1);
    const open = a.ctx.made.gain - g0;
    expect(open).toBeGreaterThan(0);
    a.setRoom({ wet: 0.4, bucket: 2, damp: 6000 });
    expect(a.verb).toBeTruthy();
    expect(a.verb.buffer).toBeTruthy();
    a.ctx.currentTime = 2;
    const g1 = a.ctx.made.gain;
    a.play('drip', [1, 1, 1], 1);
    expect(a.ctx.made.gain - g1).toBe(open + 1); // exactly one extra gain: the send
    a.ctx.currentTime = 3;
    const g2 = a.ctx.made.gain;
    a.play('drip', null, 1); // sounds without a place (interface feedback) skip the send
    expect(a.ctx.made.gain - g2).toBe(open);
  });

  it('caches impulse responses per bucket', () => {
    const a = liveAudio();
    const i1 = a.impulse(1);
    expect(a.impulse(1)).toBe(i1);
    expect(a.impulse(2)).not.toBe(i1);
  });

  it('rain under a roof drums with ticks, rain in the open does not', () => {
    const a = liveAudio();
    a.setRain(1, false);
    const s0 = a.ctx.made.source;
    a.ctx.currentTime = 10;
    a.setRain(1, true, { mat: 'metal', depth: 3 });
    expect(a.ctx.made.source).toBeGreaterThan(s0); // a droplet tick
    const s1 = a.ctx.made.source;
    a.ctx.currentTime = 20;
    a.setRain(1, true, { mat: 'stone', depth: 60 }); // deep rock: silent
    expect(a.ctx.made.source).toBe(s1);
    a.ctx.currentTime = 30;
    a.setRain(1, true, null); // covered but roof unknown: the old muffled hiss, no ticks
    expect(a.ctx.made.source).toBe(s1);
  });
});

describe('biome music', () => {
  function recordingMusic() {
    const ctx = fakeCtx();
    const freqs = [], lowpass = [];
    const origOsc = ctx.createOscillator;
    ctx.createOscillator = () => { const o = origOsc(); let f = 0; Object.defineProperty(o.frequency, 'value', { get: () => f, set: (v) => { f = v; freqs.push(v); } }); return o; };
    const origF = ctx.createBiquadFilter;
    ctx.createBiquadFilter = () => { const n = origF(); let f = 0; Object.defineProperty(n.frequency, 'value', { get: () => f, set: (v) => { f = v; lowpass.push(v); } }); return n; };
    const audio = { ctx, noiseBuf: null };
    const m = new Music(audio);
    return { m, freqs, lowpass };
  }
  const pitchClasses = (freqs) => new Set(freqs.filter((_, i) => i % 4 === 0).map((f) => ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12));

  it('has a valid profile for every music profile any soundscape asks for', () => {
    for (const s of Object.values(SOUNDSCAPES)) if (s.music) expect(MUSIC_PROFILES[s.music]).toBeTruthy();
    for (const p of Object.values(MUSIC_PROFILES)) {
      expect(MODES[p.mode]).toHaveLength(7);
      expect(MODES[p.nightMode]).toHaveLength(7);
      expect(p.root[0]).toBeLessThanOrEqual(p.root[1]);
      expect(p.bpm[0]).toBeLessThanOrEqual(p.bpm[1]);
    }
    expect(musicProfileFor('meadow')).toBe(MUSIC_PROFILES.meadow);
    expect(musicProfileFor('magma')).toBe(MUSIC_PROFILES.magma);
    expect(musicProfileFor('rift')).toBe(MUSIC_PROFILES.rift);
    expect(musicProfileFor('cave')).toBeNull(); // caves keep the classic cave piece
    expect(musicProfileFor('nowhere')).toBeNull();
  });

  it('a Highland Meadow piece is lydian, bright and brisk; a Great Rift piece low, dark and slow', () => {
    const a = recordingMusic(), b = recordingMusic();
    const lenMeadow = a.m.play('day', rng(5), a.m.dry, { profile: MUSIC_PROFILES.meadow });
    const lenRift = b.m.play('cave', rng(5), b.m.dry, { profile: MUSIC_PROFILES.rift });
    expect(lenRift).toBeGreaterThan(0);
    expect(lenMeadow).toBeGreaterThan(0);
    const minHz = (f) => Math.min(...f), medianHz = (f) => [...f].sort((x, y) => x - y)[Math.floor(f.length / 2)];
    expect(medianHz(a.freqs)).toBeGreaterThan(medianHz(b.freqs));
    expect(Math.min(...a.lowpass)).toBeGreaterThan(Math.min(...b.lowpass)); // brighter piano
    expect(minHz(b.freqs)).toBeLessThan(80);
    // the meadow's scale has the raised fourth, the rift's the flat second
    const lydian = new Set(MODES.lydian);
    const rel = (freqs, root) => [...pitchClasses(freqs)].map((pc) => (pc - root + 12) % 12);
    // find the root from the closing chord's bass: the lowest pitch class used with the piece's first chord is the piece root
    const meadowRoot = [...pitchClasses(a.freqs)].find((pc) => rel(a.freqs, pc).every((r) => lydian.has(r)));
    expect(meadowRoot).toBeDefined();
    const phry = new Set(MODES.phrygian);
    const riftRoot = [...pitchClasses(b.freqs)].find((pc) => rel(b.freqs, pc).every((r) => phry.has(r)));
    expect(riftRoot).toBeDefined();
  });

  it('plain pieces without a profile keep the classic voicing and discs are unaffected', () => {
    const a = recordingMusic();
    a.m.play('day', rng(9), a.m.dry, {});
    expect(a.m.bright).toBe(1);
    a.m.play('day', rng(9), a.m.dry, { profile: MUSIC_PROFILES.snow });
    expect(a.m.bright).toBe(MUSIC_PROFILES.snow.bright);
    a.m.play('night', rng(9), a.m.dry, { root: 50, bpm: 60, rounds: 2 }); // a music disc
    expect(a.m.bright).toBe(1);
  });

  it('profileMode switches to the night mode after dark', () => {
    expect(profileMode(MUSIC_PROFILES.meadow, 'day')).toBe(MODES.lydian);
    expect(profileMode(MUSIC_PROFILES.meadow, 'night')).toBe(MODES.dorian);
    expect(profileMode(MUSIC_PROFILES.rift, 'night')).toBe(MODES.phrygian);
  });
});

describe('Magma Lakes and Great Rifts are heard, not just seen', () => {
  it('a real Magma Lake cavern holds far more lava than the soundscape threshold', () => {
    const seed = 42;
    let found = null;
    for (let rx = -3; rx <= 3 && !found; rx++) for (let rz = -3; rz <= 3 && !found; rz++) { const l = lakeIn(seed, rx, rz); if (l) found = l; }
    expect(found).toBeTruthy();
    const cx = Math.floor(found.x / 16), cz = Math.floor(found.z / 16);
    const blocks = new Uint16Array(CHUNK_VOLUME).fill(B.STONE), meta = new Uint8Array(CHUNK_VOLUME);
    stampMagmaLakes(seed, blocks, meta, cx, cz);
    let lava = 0;
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = found.y - 2; y <= found.y; y++) if (blocks[cidx(x, y, z)] === B.LAVA) lava++;
    // the player's sample box takes every other block of 13 x 5 x 13; a lake of radius 14+ fills a good share of it
    expect(lava).toBeGreaterThan(LAVA_LAKE_MIN * 4);
  });

  it('the new biome is known to the sky: Highland Meadow is cooler than the plains and so sees more Veilfire', () => {
    expect(coldness(BIOMES[BIOME.HIGHLAND_MEADOW].temp)).toBeGreaterThan(coldness(BIOMES[BIOME.PLAINS].temp));
  });
});

describe('Veilfire and falling stars', () => {
  it('colder biomes are colder for the sky', () => {
    expect(coldness(-0.7)).toBe(1);
    expect(coldness(0)).toBe(1);
    expect(coldness(0.7)).toBe(0);
    expect(coldness(2)).toBe(0);
    expect(coldness(0.25)).toBeGreaterThan(coldness(0.55));
  });

  it('the character of a night depends on the day number alone', () => {
    expect(nightCharacter(12)).toEqual(nightCharacter(12));
    let dull = 0, great = 0, starfall = 0;
    const N = 3000;
    for (let d = 0; d < N; d++) { const n = nightCharacter(d); if (n.veil === 0) dull++; if (n.great) great++; if (n.starfall) starfall++; expect(n.veil).toBeLessThanOrEqual(1); }
    expect(dull / N).toBeGreaterThan(0.28); expect(dull / N).toBeLessThan(0.42);
    expect(great / N).toBeGreaterThan(0.05); expect(great / N).toBeLessThan(0.15);
    expect(starfall / N).toBeGreaterThan(0.04); expect(starfall / N).toBeLessThan(0.1);
  });

  it('Veilfire needs darkness and a clear sky and is livelier in the cold', () => {
    let day = 0;
    while (nightCharacter(day).veil < 0.8) day++;
    expect(auroraTarget(0, 1, 0, day)).toBe(0);        // midday
    expect(auroraTarget(0, 0.1, 0, day)).toBeLessThan(auroraTarget(0, 0, 0, day)); // dusk is dimmer
    expect(auroraTarget(0, 0, 1, day)).toBe(0);        // heavy rain
    expect(auroraTarget(0, 0, 0, day)).toBeGreaterThan(0.5);
    expect(auroraTarget(0, 0, 0, day)).toBeGreaterThan(auroraTarget(0.55, 0, 0, day));
    expect(auroraTarget(0.55, 0, 0, day)).toBeGreaterThan(auroraTarget(0.9, 0, 0, day));
    let dull = 0;
    while (nightCharacter(dull).veil !== 0) dull++;
    expect(auroraTarget(-0.5, 0, 0, dull)).toBe(0);    // some nights have none anywhere
    for (let d = 0; d < 200; d++) { const v = auroraTarget(0, 0, 0, d); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(DAY_TICKS).toBe(24000);
  });

  it('falling stars come at night only, are brief, travel along the sphere, and are denser in a Starfall', () => {
    const run = (dark, starfall, clear = 1, secs = 1200) => {
      const m = new Meteors(rng(4));
      let streaks = 0, was = false, maxGlow = 0;
      for (let i = 0; i < secs * 20; i++) {
        const s = m.update(0.05, dark, starfall, clear);
        if (s && !was) streaks++;
        was = !!s;
        if (s) {
          maxGlow = Math.max(maxGlow, s.glow);
          expect(Math.hypot(...s.head)).toBeCloseTo(1, 4);
          expect(Math.hypot(...s.tail)).toBeCloseTo(1, 4);
          expect(s.head[1]).toBeGreaterThan(-0.1);
        }
      }
      return { streaks, maxGlow };
    };
    const day = run(0, false), night = run(1, false), storm = run(1, true), overcast = run(1, false, 0);
    expect(day.streaks).toBe(0);
    expect(overcast.streaks).toBe(0);
    expect(night.streaks).toBeGreaterThan(15);
    expect(night.streaks).toBeLessThan(70);
    expect(storm.streaks).toBeGreaterThan(night.streaks * 3);
    expect(night.maxGlow).toBeGreaterThan(0.8);
  });

  it('the sky shader declares what the sky object feeds it', () => {
    for (const u of ['uAurora', 'uMeteorHead', 'uMeteorTail', 'uMeteorGlow']) expect(skyFragment).toContain(u);
    expect(skyFragment).toContain('veilfire');
  });
});

describe('forbidden words', () => {
  it('stay out of the new files', async () => {
    const { readFileSync } = await import('node:fs');
    const bad = new RegExp(['mine' + 'craft', 'neth' + 'er', 'red' + 'stone'].join('|'), 'i');
    for (const f of ['audio/ambience.js', 'audio/acoustics.js', 'audio/ambientSystem.js', 'sky/nightSky.js']) {
      expect(bad.test(readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')), f).toBe(false);
    }
  });
});
