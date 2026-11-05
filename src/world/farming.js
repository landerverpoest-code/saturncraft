// Farming depth: seasonal crop preferences, greenhouses and soil fertility (crop rotation). This file imports only
// blocks and seasons, so the world's random ticks can use it.
//
//  * Seasonal preferences: every crop with a CROP_TRAITS entry grows at the season's growth speed bent by two numbers:
//      hardy 0..1  how much of the winter (and autumn) slowdown the crop shrugs off (1 = none of it)
//      warm  -1..1 how much it loves heat (positive) or cold (negative): the growth is scaled by 1 + warm * (2 * warmth - 1)
//    so Frostroots keep growing in winter and sulk in summer, Sungourds race in summer and sleep in winter. Crops without
//    an entry follow the plain season (world/seasons.js).
//  * Greenhouse: a crop with glass (or stained glass, or a glass pane) as the first block above it within GREENHOUSE_REACH, in
//    light of at least GREENHOUSE_LIGHT, never grows slower than at the original rate: glass keeps the winter out.
//  * Soil fertility: farmland's meta holds the moisture in bits 0-2 (as always), the crop last harvested from it in bits 3-6
//    (SOIL_CODE) and bit 7 = "this was already the second harvest of the same crop in a row". Taking the same crop again
//    from the same soil lowers the yield a little (YIELD_FACTOR); another crop, a rest (bare farmland for a while) or Bone
//    Meal on the bare soil restores it.
import { B, CROPS } from './blocks.js';
import { climate, SEASON_DATA, SEASON_KEYS, SEASON_NAMES } from './seasons.js';

// ---- seasonal preferences ------------------------------------------------------------------------

/** Crop block -> { hardy, warm } (see above). */
export const CROP_TRAITS = {
  [B.FROSTROOTS]: { hardy: 0.85, warm: -0.25 },
  [B.DEWBERRY_BRAMBLE]: { hardy: 0.35, warm: -0.15 },
  [B.SUNGOURD_STEM]: { hardy: 0, warm: 0.5 },
};
const MIN_FACTOR = 0.15, MAX_FACTOR = 1.6;
const mixTo = (a, b, k) => a + (b - a) * k;

/** The growth factor of a crop for a set of season numbers ({ growth, warmth }); plain crops just use `growth`. */
export function growthFactorFor(id, data = climate) {
  const t = CROP_TRAITS[id];
  if (!t) return data.growth;
  const f = mixTo(data.growth, 1, t.hardy) * (1 + t.warm * (2 * data.warmth - 1));
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, f));
}

/** Per season [{ key, name, factor }] for a crop (the season's own middle values), for tooltips and the Help screen. */
export function seasonTable(id) {
  return SEASON_KEYS.map((key) => ({ key, name: SEASON_NAMES[key], factor: growthFactorFor(id, SEASON_DATA[key]) }));
}

/** The seasons a crop grows best in, as names ("Winter" or "Spring and Autumn"), judged by seasonTable. */
export function bestSeasons(id) {
  const t = seasonTable(id), top = Math.max(...t.map((s) => s.factor));
  const names = t.filter((s) => s.factor >= top - 0.05).map((s) => s.name);
  return names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
}

// ---- greenhouses ------------------------------------------------------------------------------------

export const GREENHOUSE_REACH = 6;
export const GREENHOUSE_LIGHT = 12;
/** Blocks that make a greenhouse roof: Glass, every Stained Glass and every pane (not Shaded Glass, which shuts the light out). */
export const ROOF_GLASS = new Set([B.GLASS, B.GLASS_PANE]);
for (const k of Object.keys(B)) if (k.endsWith('_STAINED_GLASS') || k.endsWith('_STAINED_GLASS_PANE')) ROOF_GLASS.add(B[k]);

/** Is the block at x,y,z under a glass roof and lit by light >= 12 (sky or block light)? */
export function inGreenhouse(world, x, y, z) {
  let roofed = false;
  for (let k = 1; k <= GREENHOUSE_REACH; k++) {
    const id = world.getBlock(x, y + k, z);
    if (!id) continue;
    roofed = ROOF_GLASS.has(id);
    break;
  }
  if (!roofed) return false;
  const l = world.getLight ? world.getLight(x, y, z) : 0;
  return Math.max(l >> 4, l & 15) >= GREENHOUSE_LIGHT;
}

/** The growth multiplier of a crop at x,y,z: its season factor, lifted to at least 1 under a lit glass roof. */
export function cropGrowthMultiplier(world, x, y, z, id) {
  const f = growthFactorFor(id);
  return f < 1 && inGreenhouse(world, x, y, z) ? 1 : f;
}

// ---- soil fertility -----------------------------------------------------------------------------------

export const MOISTURE_MASK = 7;
export const WORN_BIT = 128;
export const LAST_SHIFT = 3, LAST_MASK = 15 << LAST_SHIFT;
/** Crops that remember their soil: crop block -> code 1.. stored in the farmland's meta. (Stem crops bear fruit beside them.) */
export const SOIL_CODE = { [B.WHEAT]: 1, [B.CARROTS]: 2, [B.POTATOES]: 3, [B.BEETROOTS]: 4, [B.FROSTROOTS]: 5 };
const SOIL_CROP = Object.fromEntries(Object.entries(SOIL_CODE).map(([id, code]) => [code, +id]));
/** Share of a harvest kept at each tiredness level 0 (rested), 1 (same crop again), 2 (same crop a third time running or more). */
export const YIELD_FACTOR = [1, 0.85, 0.7];

export const moistureOf = (m) => m & MOISTURE_MASK;
/** The crop block last harvested from soil with this meta (0 if none). */
export const lastCropOf = (m) => SOIL_CROP[(m & LAST_MASK) >> LAST_SHIFT] || 0;
/** Tiredness of the soil for crop `id`: 0 rested or another crop's soil, 1 it was just this crop, 2 it was this crop twice or more. */
export function tirednessFor(m, id) {
  if (!SOIL_CODE[id] || lastCropOf(m) !== id) return 0;
  return m & WORN_BIT ? 2 : 1;
}
/** Does this soil carry any memory of a crop (so that resting or Bone Meal would change it)? */
export const hasMemory = (m) => (m & (LAST_MASK | WORN_BIT)) !== 0;

/** The farmland meta after crop `id` was harvested from it. */
export function metaAfterHarvest(m, id) {
  const code = SOIL_CODE[id];
  if (!code) return m;
  const same = lastCropOf(m) === id;
  return (m & MOISTURE_MASK) | (code << LAST_SHIFT) | (same ? WORN_BIT : 0);
}
/** The meta of farmland that has rested: moisture only. */
export const restedMeta = (m) => m & MOISTURE_MASK;

/** Scale the produce of a harvest by the soil's tiredness: stochastic rounding per stack, seeds untouched. */
export function applyYield(drops, level, rng = Math.random, isSeed = () => false) {
  const k = YIELD_FACTOR[Math.min(level, 2)];
  if (k >= 1) return drops;
  return drops.map((d) => (isSeed(d.id) ? d : { ...d, count: Math.floor(d.count * k + rng()) })).filter((d) => d.count > 0);
}

/**
 * A mature crop at x,y,z was harvested: returns its drops adjusted for the soil and updates the soil's memory.
 * `set(x, y, z, id, meta)` writes a block (the game passes setBlockUrgent so the change is shared). Crops that are
 * not ripe, or do not remember their soil, pass through unchanged.
 */
export function harvestOnSoil(world, x, y, z, id, cropMeta, drops, rng = Math.random, isSeed = () => false, set = null) {
  if (!SOIL_CODE[id] || (cropMeta & 7) < 7 || world.getBlock(x, y - 1, z) !== B.FARMLAND) return drops;
  const m = world.getMeta(x, y - 1, z), level = tirednessFor(m, id);
  const nm = metaAfterHarvest(m, id);
  if (nm !== m) (set || ((a, b, c, i, mm) => world.setBlock(a, b, c, i, mm)))(x, y - 1, z, B.FARMLAND, nm);
  return applyYield(drops, level, rng, isSeed);
}

/** Chance per random tick that bare farmland forgets (rests): about a quarter of an hour on average at the usual tick rate. */
export const REST_CHANCE = 0.25;

/** Bone Meal on bare farmland that remembers a crop: forget it. Returns true if something changed. */
export function boneMealSoil(world, x, y, z, set = null) {
  const m = world.getMeta(x, y, z);
  if (world.getBlock(x, y, z) !== B.FARMLAND || !hasMemory(m) || CROPS.has(world.getBlock(x, y + 1, z))) return false;
  (set || ((a, b, c, i, mm) => world.setBlock(a, b, c, i, mm)))(x, y, z, B.FARMLAND, restedMeta(m));
  return true;
}

// ---- the berry bramble ------------------------------------------------------------------------------------

/** Light needed to ripen the Dewberry Bramble (the sweet berry bush needs 9). */
export const BRAMBLE_LIGHT = 6;
export const BRAMBLE_CHANCE = 0.25;
/** The bramble's ripening chance per random tick under the season (with the greenhouse lift), min 1. */
export function brambleChance(world, x, y, z) {
  return Math.min(1, BRAMBLE_CHANCE * cropGrowthMultiplier(world, x, y, z, B.DEWBERRY_BRAMBLE));
}
