// Soundscapes: what the world sounds like where the player stands. A pure
// decision layer (no Web Audio) so it can be tested: pickSoundscape() turns a
// handful of cheap facts about the player's surroundings into a soundscape
// key, and each soundscape has
//   - a continuous "bed" (levels of the looping noise layers in audio.js),
//   - sparse one-shot events (birdsong, crickets, drips, lava pops...) that
//     the AmbientDirector schedules, and
//   - a music profile (scale, tempo, register, brightness) that Music.play
//     composes with, so Highland Meadows sound bright and open, Magma Lakes
//     low and smouldering and Great Rifts vast and slow.

export const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  dominantPhrygian: [0, 1, 4, 5, 7, 8, 10],
};

/** Music profiles: root = MIDI range, bpm = range, density = melody notes per half-beat, bright scales the piano's lowpass. */
export const MUSIC_PROFILES = {
  meadow: { mode: 'lydian', nightMode: 'dorian', root: [53, 58], bpm: [68, 80], density: 0.55, bright: 1.3, rounds: [3, 4] },
  forest: { mode: 'major', nightMode: 'dorian', root: [48, 54], bpm: [60, 72], density: 0.45, bright: 0.95, rounds: [3, 4] },
  swamp: { mode: 'dorian', nightMode: 'phrygian', root: [45, 50], bpm: [52, 62], density: 0.35, bright: 0.75, rounds: [3, 3] },
  jungle: { mode: 'mixolydian', nightMode: 'dorian', root: [50, 55], bpm: [70, 84], density: 0.6, bright: 1.1, rounds: [3, 4] },
  desert: { mode: 'dominantPhrygian', nightMode: 'dominantPhrygian', root: [46, 52], bpm: [58, 70], density: 0.45, bright: 1.05, rounds: [3, 4] },
  snow: { mode: 'lydian', nightMode: 'minor', root: [55, 60], bpm: [56, 66], density: 0.3, bright: 1.4, rounds: [3, 3] },
  shore: { mode: 'mixolydian', nightMode: 'dorian', root: [48, 53], bpm: [58, 68], density: 0.4, bright: 1.0, rounds: [3, 3] },
  rift: { mode: 'phrygian', nightMode: 'phrygian', root: [36, 41], bpm: [40, 48], density: 0.2, bright: 0.6, rounds: [2, 2] },
  magma: { mode: 'dominantPhrygian', nightMode: 'dominantPhrygian', root: [36, 41], bpm: [44, 52], density: 0.3, bright: 0.75, rounds: [2, 3] },
};

/** The notes of a profile's mode for this mood. */
export function profileMode(profile, mood) {
  const name = mood === 'night' && profile.nightMode ? profile.nightMode : profile.mode;
  return MODES[name];
}

/** Which music profile a soundscape plays: surface soundscapes carry their own, caves keep the classic cave piece. */
export function musicProfileFor(scape) { return SOUNDSCAPES[scape] ? MUSIC_PROFILES[SOUNDSCAPES[scape].music] || null : null; }

// biome key -> surface soundscape
const SURFACE = {
  highland_meadow: 'meadow',
  plains: 'plains', flower_forest: 'forest', forest: 'forest', birch_forest: 'forest', dark_forest: 'forest', blossom_grove: 'meadow',
  taiga: 'cold', snowy_taiga: 'cold', snowy_plains: 'cold', snowy_peaks: 'cold', frozen_ocean: 'cold', frozen_river: 'cold',
  swamp: 'swamp', mangrove_swamp: 'swamp', jungle: 'jungle', mushroom_fields: 'swamp',
  desert: 'desert', badlands: 'desert', savanna: 'desert',
  ocean: 'shore', beach: 'shore', river: 'shore', stony_peaks: 'peaks',
};

/** Facts the game gathers once a second. */
export function emptyFacts() {
  return { dimension: 'overworld', biome: 'plains', under: false, depthBelowSurface: 0, skyLight: 15, y: 70, lavaNear: 0, night: false, raining: false };
}

export const LAVA_LAKE_MIN = 8;      // lava blocks in the sampled box that make a cavern a lake cavern
export const RIFT_MIN_DEPTH = 20;    // how far below the rim a sky-lit shaft must be to count as a rift

/** The soundscape key for the player's surroundings. */
export function pickSoundscape(f) {
  if (f.dimension === 'cinderdeep') return 'cinderdeep';
  if (f.dimension === 'hollow') return 'hollow';
  if (f.lavaNear >= LAVA_LAKE_MIN && f.y < 0) return 'magma';
  if (f.depthBelowSurface >= RIFT_MIN_DEPTH && f.skyLight >= 5) return 'rift';
  if (f.under) return f.y < -20 ? 'deep_cave' : 'cave';
  return SURFACE[f.biome] || 'plains';
}

/**
 * Bed levels (0..~0.2 of master) per looping layer; see BED_LAYERS in audio.js.
 * `night` lifts the insects and drops the wind of calm biomes.
 */
export const SOUNDSCAPES = {
  plains: { music: 'forest', bed: { wind: 0.05 }, nightBed: { wind: 0.03, insects: 0.045 }, events: [
    { sound: 'bird_trill', every: [9, 26], vol: 0.5, dist: [6, 14], when: 'day' },
    { sound: 'cricket', every: [5, 12], vol: 0.35, dist: [4, 12], when: 'night' },
  ] },
  forest: { music: 'forest', bed: { wind: 0.06 }, nightBed: { wind: 0.04, insects: 0.04 }, events: [
    { sound: 'bird_trill', every: [6, 18], vol: 0.55, dist: [5, 14], when: 'day' },
    { sound: 'owl', every: [18, 50], vol: 0.45, dist: [8, 15], when: 'night' },
    { sound: 'cricket', every: [6, 14], vol: 0.3, dist: [4, 12], when: 'night' },
  ] },
  meadow: { music: 'meadow', bed: { wind: 0.13, water: 0.012 }, nightBed: { wind: 0.1, insects: 0.03, water: 0.012 }, events: [
    { sound: 'bird_trill', every: [5, 14], vol: 0.6, dist: [5, 15], when: 'day' },
    { sound: 'breeze', every: [14, 34], vol: 0.5, dist: [0, 6], when: 'any' },
    { sound: 'cricket', every: [6, 14], vol: 0.3, dist: [4, 12], when: 'night' },
  ] },
  swamp: { music: 'swamp', bed: { wind: 0.03, insects: 0.025 }, nightBed: { wind: 0.025, insects: 0.07 }, events: [
    { sound: 'croak', every: [7, 20], vol: 0.35, dist: [5, 14], when: 'any' },
    { sound: 'bubble', every: [10, 24], vol: 0.5, dist: [3, 10], when: 'any' },
  ] },
  jungle: { music: 'jungle', bed: { wind: 0.04, insects: 0.035 }, nightBed: { wind: 0.03, insects: 0.075 }, events: [
    { sound: 'bird_trill', every: [3, 9], vol: 0.55, dist: [5, 15], when: 'day' },
    { sound: 'croak', every: [10, 24], vol: 0.3, dist: [5, 14], when: 'night' },
  ] },
  desert: { music: 'desert', bed: { wind: 0.09 }, nightBed: { wind: 0.07 }, events: [
    { sound: 'breeze', every: [10, 26], vol: 0.55, dist: [0, 6], when: 'any' },
  ] },
  cold: { music: 'snow', bed: { wind: 0.1 }, nightBed: { wind: 0.12 }, events: [
    { sound: 'breeze', every: [8, 22], vol: 0.6, dist: [0, 6], when: 'any' },
    { sound: 'howl', every: [60, 140], vol: 0.25, dist: [11, 15], when: 'night' },
  ] },
  shore: { music: 'shore', bed: { wind: 0.07, water: 0.02 }, nightBed: { wind: 0.05, water: 0.02 }, events: [
    { sound: 'bird_trill', every: [10, 28], vol: 0.4, dist: [6, 14], when: 'day' },
  ] },
  peaks: { music: 'meadow', bed: { wind: 0.17 }, nightBed: { wind: 0.17 }, events: [
    { sound: 'breeze', every: [6, 16], vol: 0.65, dist: [0, 5], when: 'any' },
  ] },
  cave: { music: null, bed: { rumble: 0.03 }, nightBed: null, events: [
    { sound: 'drip', every: [3, 9], vol: 0.55, dist: [2, 10], when: 'any' },
  ] },
  deep_cave: { music: null, bed: { rumble: 0.06 }, nightBed: null, events: [
    { sound: 'drip', every: [4, 11], vol: 0.5, dist: [2, 11], when: 'any' },
    { sound: 'rift_moan', every: [50, 120], vol: 0.25, dist: [8, 15], when: 'any' },
  ] },
  magma: { music: 'magma', bed: { rumble: 0.09, sizzle: 0.03 }, nightBed: null, events: [
    { sound: 'lava_pop', every: [1.5, 5], vol: 0.6, dist: [3, 14], when: 'any' },
    { sound: 'rift_moan', every: [40, 90], vol: 0.2, dist: [9, 15], when: 'any' },
  ] },
  rift: { music: 'rift', bed: { wind: 0.14, rumble: 0.045 }, nightBed: null, events: [
    { sound: 'rift_moan', every: [14, 40], vol: 0.5, dist: [6, 15], when: 'any' },
    { sound: 'drip', every: [5, 14], vol: 0.45, dist: [3, 12], when: 'any' },
  ] },
  cinderdeep: { music: null, bed: { rumble: 0.07, sizzle: 0.035 }, nightBed: null, events: [
    { sound: 'lava_pop', every: [2, 6], vol: 0.5, dist: [4, 14], when: 'any' },
    { sound: 'ember_snap', every: [3, 9], vol: 0.45, dist: [3, 12], when: 'any' },
  ] },
  hollow: { music: null, bed: { wind: 0.08, rumble: 0.02 }, nightBed: null, events: [
    { sound: 'void_whisper', every: [12, 34], vol: 0.35, dist: [6, 15], when: 'any' },
  ] },
};

/** Bed levels of a soundscape for the time of day; rain adds nothing here (the rain bed is separate). */
export function bedFor(scape, night) {
  const s = SOUNDSCAPES[scape];
  if (!s) return {};
  return (night && s.nightBed) || s.bed;
}

/**
 * Schedules the one-shot events of the current soundscape. tick() returns the
 * events due this step as { sound, dx, dy, dz, vol } offsets from the listener.
 */
export class AmbientDirector {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.scape = null;
    this.timers = [];
  }

  reset(scape) {
    this.scape = scape;
    const s = SOUNDSCAPES[scape];
    // first events come after a fraction of their interval so entering a place is not an instant chorus
    this.timers = s ? s.events.map((e) => e.every[0] * (0.5 + this.rng())) : [];
  }

  tick(dt, scape, night) {
    if (scape !== this.scape) this.reset(scape);
    const s = SOUNDSCAPES[scape];
    const out = [];
    if (!s) return out;
    for (let i = 0; i < s.events.length; i++) {
      this.timers[i] -= dt;
      if (this.timers[i] > 0) continue;
      const e = s.events[i];
      this.timers[i] = e.every[0] + this.rng() * (e.every[1] - e.every[0]);
      if ((e.when === 'day' && night) || (e.when === 'night' && !night)) continue;
      const a = this.rng() * Math.PI * 2, d = e.dist[0] + this.rng() * (e.dist[1] - e.dist[0]);
      out.push({ sound: e.sound, dx: Math.cos(a) * d, dy: (this.rng() - 0.3) * 4, dz: Math.sin(a) * d, vol: e.vol * (0.7 + 0.3 * this.rng()) });
    }
    return out;
  }
}
