// Angling round: biome fish, the Fishing Log (best weight per species), ice holes and the Big Catch. Pure rules; the bobber (entities/bobber.js)
// calls them.
import { I } from './items.js';
import { B } from './blocks.js';
import { cleanTrophy } from './trophyFish.js';

/** The angling species: item key of the raw fish -> display name. Keys are stored in saves; append only. */
export const SPECIES = {
  RAW_SILVERFIN: 'Silverfin', RAW_REDFIN: 'Redfin', SPINEFISH: 'Spinefish', GLIMMERFIN: 'Glimmerfin', RAW_BOGCARP: 'Bogcarp', RAW_DUNEFIN: 'Dunefin',
  GILDED_PERCH: 'Gilded Perch', RAW_LANTERNFIN: 'Lanternfin', RAW_MUDCARP: 'Mudcarp', RAW_FROSTPERCH: 'Frostperch', RAW_GLIMMEREEL: 'Glimmereel', RAW_SUNSCALE: 'Sunscale',
};
export const SPECIES_KEYS = Object.keys(SPECIES);
/** The species key of a raw fish item id, or null. */
export const speciesOf = (id) => SPECIES_KEYS.find((k) => I[k] === id) || null;

export const COLD_BIOMES = ['frozen_ocean', 'frozen_river', 'frozen_deep', 'snowy_plains', 'snowy_taiga', 'snowy_peaks', 'taiga'];
export const MUD_BIOMES = ['swamp', 'mangrove_swamp', 'jungle', 'river'];
export const WARM_BIOMES = ['ocean', 'beach', 'kelp_forest'];
/** Share of the fish catches that are the local angling fish. */
export const ANGLING_SHARE = 0.3;
/** Share of fish that are Glimmereels in the dark, and Frostperch at an ice hole. */
export const EEL_SHARE = 0.35, ICE_HOLE_SHARE = 0.6;
/** One cast in this many hooks a Trophy fish; one such fight in TROPHY_ESCAPE slips the line. */
export const TROPHY_ODDS = 40, TROPHY_ESCAPE = 3;

/**
 * The angling fish (an item key) that replaces an ordinary catch, or null. `ctx` is { dark, ice }: dark water (night, or a cave) and an ice hole.
 * A seeded rng gives the same fish.
 */
export function anglingFish(biomeKey, ctx = {}, rng = Math.random) {
  if (ctx.dark && rng() < EEL_SHARE) return 'RAW_GLIMMEREEL';
  if (ctx.ice && rng() < ICE_HOLE_SHARE) return 'RAW_FROSTPERCH';
  if (rng() >= ANGLING_SHARE) return null;
  if (COLD_BIOMES.includes(biomeKey)) return 'RAW_FROSTPERCH';
  if (MUD_BIOMES.includes(biomeKey)) return 'RAW_MUDCARP';
  if (WARM_BIOMES.includes(biomeKey)) return 'RAW_SUNSCALE';
  return null;
}

/** Is this spot an ice hole: water whose surface has ice or packed ice on at least one side (a hole cut by breaking an ice block)? */
export function isIceHole(getBlock, x, y, z) {
  if (getBlock(x, y, z) !== B.WATER) return false;
  let top = y;
  while (getBlock(x, top + 1, z) === B.WATER) top++;
  const iced = (b) => b === B.ICE || b === B.PACKED_ICE;
  if (iced(getBlock(x, top + 1, z))) return false; // (a closed roof is not a hole: nothing to cast through)
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => iced(getBlock(x + dx, top, z + dz)));
}

/** A fish's weight in kg (0.3 to 6.0, tenths) from the rng. */
export const rollWeight = (rng = Math.random) => Math.round((0.3 + rng() * 5.7) * 10) / 10;
/** A Trophy fish's weight (3.0 to 6.0 kg). */
export const rollTrophyWeight = (rng = Math.random) => cleanTrophy(3 + rng() * 3);
/** Does this cast hook a Trophy fish (one in TROPHY_ODDS)? */
export const isTrophyCast = (rng = Math.random) => rng() * TROPHY_ODDS < 1;
/** Does a hooked Trophy fish slip the line (one in TROPHY_ESCAPE)? */
export const trophyEscapes = (rng = Math.random) => rng() * TROPHY_ESCAPE < 1;

/** The Fishing Log: { SPECIES_KEY: { n: caught, best: kg } }. A cleaned copy of untrusted data. */
export function cleanFishLog(l) {
  const out = {};
  if (!l || typeof l !== 'object') return out;
  for (const k of SPECIES_KEYS) {
    const e = l[k];
    if (!e || !(e.n >= 1)) continue;
    const best = typeof e.best === 'number' && Number.isFinite(e.best) ? Math.round(Math.max(0, Math.min(99, e.best)) * 10) / 10 : 0;
    out[k] = { n: Math.min(1e6, Math.floor(e.n)), best };
  }
  return out;
}
/** Record a catch; returns { isNew, isRecord }. A heavier fish replaces the record. */
export function recordFish(log, key, weight) {
  if (!SPECIES[key]) return { isNew: false, isRecord: false };
  const e = log[key], w = Math.round(weight * 10) / 10;
  if (!e) { log[key] = { n: 1, best: w }; return { isNew: true, isRecord: true }; }
  e.n++;
  const rec = w > e.best;
  if (rec) e.best = w;
  return { isNew: false, isRecord: rec };
}
/** Rows [label, value] for the Statistics screen: each species caught with its record. */
export function fishLogRows(log) {
  const rows = SPECIES_KEYS.filter((k) => log && log[k]).map((k) => [SPECIES[k], `${log[k].n} caught, best ${log[k].best.toFixed(1)} kg`]);
  return rows.length ? rows : [['Nothing yet', '0']];
}
export const speciesCaught = (log) => SPECIES_KEYS.filter((k) => log && log[k]).length;
