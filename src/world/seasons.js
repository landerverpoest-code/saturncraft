// Seasons: a calendar derived from world time. Four seasons of `days` in-game
// days (24000 ticks each, default 8) turn in a loop, so the season needs no
// clock of its own: it is a pure function of game.time plus a saved offset
// (set by /season set). Everything that listens to the season reads the
// `climate` object, which Seasons.update() refreshes about once a second, so
// the cost per frame and per tick is a handful of property reads.
//
//  - tint        grass and leaf colours are shifted in the terrain shader by a few
//                uniforms (render/terrainMaterial.js): no chunk is ever remeshed
//  - snowTemp    biomes colder than this get snow instead of rain (winter reaches
//                into the temperate biomes, thaw melts their snow layers again)
//  - rainClear / rainLen   scale the clear and rainy spells (spring is the wet one)
//  - growth      crop growth speed (slow winter, quick spring)
//  - warmth      0..1 how warm the season is (0.5 = neutral); crops with a seasonal preference (world/farming.js) read it
//  - breedCooldown / creatureCap   animals breed sooner and flourish in spring
//  - sunDecl     the suns climb higher in summer and hang low in winter
//  - veil        Veilfire is stronger in the long winter nights
//  - amb         soundscape tweaks: birds, crickets, wind, wolf howls
//
// This file imports nothing, so any module can use it.

export const DAY_TICKS = 24000;
export const DEFAULT_DAYS = 8;      // days per season
export const MIN_DAYS = 1;
export const MAX_DAYS = 120;

export const SEASON_KEYS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_NAMES = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };

/** How each sun's declination follows the season (the Hearth sun makes the days long and short). */
export const SUN_SEASONAL = { hearth: 1, pale: 0.45, ember: 0.6 };

/**
 * The numbers of each season. Colour entries are [r, g, b, strength]: the shader pulls a surface's
 * colour towards (its brightness * rgb) by `strength`, so the biome's own hue still shows through.
 */
export const SEASON_DATA = {
  spring: {
    grass: [0.8, 1.4, 0.5, 0.2], leaf: [0.8, 1.45, 0.5, 0.22], leafVar: 0, frost: 0.06,
    snowTemp: 0.15, rainClear: 0.55, rainLen: 1.25, growth: 1.35, warmth: 0.55, breedCooldown: 0.6, creatureCap: 1.25,
    sunDecl: 0, veil: 0.85, skyTint: [0.98, 1.0, 1.0], amb: { wind: 1, bird: 1.9, cricket: 0.6, howl: 0.5 },
  },
  summer: {
    grass: [1.3, 1.1, 0.4, 0.12], leaf: [1.0, 1.2, 0.6, 0.08], leafVar: 0, frost: 0,
    snowTemp: 0.15, rainClear: 1.15, rainLen: 0.8, growth: 1.0, warmth: 1, breedCooldown: 0.9, creatureCap: 1.1,
    sunDecl: 1, veil: 0.6, skyTint: [1.02, 1.0, 1.03], amb: { wind: 0.8, bird: 1.2, cricket: 1.7, howl: 0.3 },
  },
  autumn: {
    grass: [1.5, 1.05, 0.4, 0.5], leaf: [2.8, 0.55, 0.1, 0.85], leafVar: 1, frost: 0.12,
    snowTemp: 0.3, rainClear: 0.75, rainLen: 1.1, growth: 0.8, warmth: 0.35, breedCooldown: 1.1, creatureCap: 0.9,
    sunDecl: 0, veil: 1.1, skyTint: [1.04, 0.98, 0.92], amb: { wind: 1.3, bird: 0.7, cricket: 0.8, howl: 1.3 },
  },
  winter: {
    grass: [1.15, 1.05, 0.8, 0.7], leaf: [0.95, 0.78, 0.6, 0.88], leafVar: 0, frost: 0.85,
    snowTemp: 0.62, rainClear: 0.9, rainLen: 1.0, growth: 0.35, warmth: 0, breedCooldown: 1.6, creatureCap: 0.65,
    sunDecl: -1, veil: 1.5, skyTint: [0.95, 1.0, 1.07], amb: { wind: 1.55, bird: 0.2, cricket: 0.0, howl: 2.5 },
  },
};

/** The neutral climate: what the world is like with seasons switched off (the original rules). */
export function neutralClimate() {
  return {
    on: false, grass: [1, 1, 1, 0], leaf: [1, 1, 1, 0], leafVar: 0, frost: 0,
    snowTemp: 0.15, rainClear: 1, rainLen: 1, growth: 1, warmth: 0.5, breedCooldown: 1, creatureCap: 1,
    sunDecl: 0, veil: 1, skyTint: [1, 1, 1], amb: { wind: 1, bird: 1, cricket: 1, howl: 1 },
  };
}

/** The live climate every system reads (refreshed by Seasons.update). */
export const climate = neutralClimate();

// ---- the calendar -------------------------------------------------------------------------

/** Clamp a season length to a whole number of days. */
export function cleanDays(d) {
  const n = Math.round(Number(d));
  return Number.isFinite(n) ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, n)) : DEFAULT_DAYS;
}

export const yearTicks = (days = DEFAULT_DAYS) => days * 4 * DAY_TICKS;

/**
 * Where world time `time` falls in the year. `offset` shifts the calendar (ticks).
 * Returns { index, key, name, day (1-based, in the season), dayOfYear (1-based), year (0-based),
 *   progress (0..1 through the season), yearProgress (0..1), days }.
 */
export function seasonState(time, days = DEFAULT_DAYS, offset = 0) {
  days = cleanDays(days);
  const season = days * DAY_TICKS, year = season * 4;
  const t = (((Math.floor(time) + Math.floor(offset)) % year) + year) % year;
  const index = Math.floor(t / season);
  return {
    index, key: SEASON_KEYS[index], name: SEASON_NAMES[SEASON_KEYS[index]],
    day: Math.floor((t - index * season) / DAY_TICKS) + 1,
    dayOfYear: Math.floor(t / DAY_TICKS) + 1,
    year: Math.max(0, Math.floor(time / year)), // years lived (by the clock; /season set only moves the date)
    progress: (t - index * season) / season,
    yearProgress: t / year,
    days,
  };
}

/** Offset that puts `time` at the first day of the season `key`. */
export function offsetFor(key, time, days = DEFAULT_DAYS) {
  const i = SEASON_KEYS.indexOf(key);
  if (i < 0) return null;
  days = cleanDays(days);
  const year = yearTicks(days), dayStart = Math.floor(time / DAY_TICKS) * DAY_TICKS;
  return ((i * days * DAY_TICKS - dayStart) % year + year) % year;
}

// ---- blending ------------------------------------------------------------------------------

const mixVal = (a, b, k) => {
  if (Array.isArray(a)) return a.map((v, i) => v + (b[i] - v) * k);
  if (typeof a === 'object') { const o = {}; for (const key of Object.keys(a)) o[key] = mixVal(a[key], b[key], k); return o; }
  return a + (b - a) * k;
};
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * The season's numbers at a moment: the middle of a season holds its own values, and the first and
 * last 30 % of it ease half way into the neighbouring season (so there is no jump at the boundary).
 */
export function seasonValues(state) {
  const cur = SEASON_DATA[state.key], q = state.progress;
  if (q < 0.3) return mixVal(cur, SEASON_DATA[SEASON_KEYS[(state.index + 3) % 4]], (1 - smooth(q / 0.3)) * 0.5);
  if (q > 0.7) return mixVal(cur, SEASON_DATA[SEASON_KEYS[(state.index + 1) % 4]], smooth((q - 0.7) / 0.3) * 0.5);
  return mixVal(cur, cur, 0);
}

/** Copy blended values into `into` (the live climate by default). */
export function applyValues(v, into = climate) {
  into.on = true;
  for (const k of Object.keys(v)) {
    if (Array.isArray(v[k])) for (let i = 0; i < v[k].length; i++) into[k][i] = v[k][i];
    else if (typeof v[k] === 'object') Object.assign(into[k], v[k]);
    else into[k] = v[k];
  }
  return into;
}

/** Back to the original rules. */
export function resetClimate(into = climate) {
  const n = neutralClimate();
  for (const k of Object.keys(n)) {
    if (Array.isArray(n[k])) for (let i = 0; i < n[k].length; i++) into[k][i] = n[k][i];
    else if (typeof n[k] === 'object') Object.assign(into[k], n[k]);
    else into[k] = n[k];
  }
  return into;
}

// ---- helpers the systems share ---------------------------------------------------------------

/** Chance of a crop growing a stage, scaled by the season (never above certain). */
export const seasonalChance = (p) => Math.min(1, p * climate.growth);

/** Ticks a parent animal waits after a baby. */
export const breedCooldownTicks = (base = 6000) => Math.max(600, Math.round(base * climate.breedCooldown));

/** The animal cap scaled by the season. */
export const seasonalCreatureCap = (cap) => Math.floor(cap * climate.creatureCap);

/** Ambience rate of a one-shot sound (1 = as usual, 0 = silent) in the given `amb` table. */
export function ambienceRate(sound, amb) {
  if (!amb) return 1;
  switch (sound) {
    case 'bird_trill': return amb.bird;
    case 'cricket': case 'croak': return amb.cricket;
    case 'howl': return amb.howl;
    case 'breeze': return amb.wind;
    default: return 1;
  }
}

/** Bed levels with the season's wind and insects applied. */
export function seasonBed(bed, amb) {
  if (!amb || !bed) return bed;
  const out = { ...bed };
  if (out.wind) out.wind *= amb.wind;
  if (out.insects) out.insects *= amb.cricket;
  return out;
}

// ---- the game's calendar -----------------------------------------------------------------------

/** One per game: the saved calendar settings and the cached state. */
export class Seasons {
  constructor() {
    this.enabled = true;
    this.days = DEFAULT_DAYS;
    this.offset = 0;
    this.state = seasonState(0, this.days, 0);
    this.lastStamp = NaN;
  }

  /** The calendar position at `time` (no side effects). */
  at(time) { return seasonState(time, this.days, this.offset); }

  /** Refresh the cached state and the shared climate; cheap, but callers throttle it to ~1 Hz. */
  update(time) {
    this.state = this.at(time);
    if (this.enabled) applyValues(seasonValues(this.state));
    else if (climate.on) resetClimate();
    return this.state;
  }

  /** Jump to the first day of a season at `time`. Returns false for an unknown season. */
  setSeason(key, time) {
    const o = offsetFor(key, time, this.days);
    if (o === null) return false;
    this.offset = o;
    return true;
  }

  /** Change the season length, keeping today's place in the year as far as possible. */
  setDays(days, time) {
    const d = cleanDays(days), cur = this.at(time);
    this.days = d;
    const target = cur.index * d * DAY_TICKS + Math.min(cur.day - 1, d - 1) * DAY_TICKS + (Math.floor(time) % DAY_TICKS);
    const year = yearTicks(d);
    this.offset = ((target - Math.floor(time)) % year + year) % year;
    return d;
  }

  /** Short label for the HUD: "Spring, day 3/8". */
  label(time = null) {
    const s = time === null ? this.state : this.at(time);
    return `${s.name}, day ${s.day}/${s.days}`;
  }

  save() { return { on: this.enabled, days: this.days, offset: this.offset }; }
  load(d) {
    if (!d || typeof d !== 'object') return;
    if (typeof d.on === 'boolean') this.enabled = d.on;
    this.days = cleanDays(d.days ?? DEFAULT_DAYS);
    this.offset = Number.isFinite(d.offset) ? Math.floor(d.offset) : 0;
  }
}
