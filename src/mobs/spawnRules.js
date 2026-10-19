// Natural spawning rules (pure functions, unit tested). Weights, group sizes,
// mob caps, light tests and distances follow the documented spawning
// algorithm. Light uses the combined darkening of all three suns.
import { BIOMES } from '../world/biomes.js';
import { CATEGORY } from './mobTypes.js';

export const MOB_CAPS = { [CATEGORY.MONSTER]: 70, [CATEGORY.CREATURE]: 10 };
export const CAP_REFERENCE_CHUNKS = 289;      // 17x17 chunks
export const SPAWN_MIN_DIST = 24;
export const DESPAWN_FAR = 128;
export const DESPAWN_NEAR = 32;
export const RANDOM_DESPAWN_CHANCE = 1 / 800;
export const NO_ACTION_DESPAWN_TICKS = 600;
export const CREATURE_SPAWN_INTERVAL = 400;   // passive mobs only attempt every 400 ticks
export const CHUNK_GEN_CREATURE_CHANCE = 0.1; // creatures placed when a chunk is first generated
export const MONSTER_LIGHT_MAX = 7;           // monster_spawn_light_level = uniform(0, 7)
export const MONSTER_BLOCK_LIGHT_LIMIT = 0;

const DEFAULT_MONSTERS = [
  { type: 'skitterer', weight: 100, min: 4, max: 4 },
  { type: 'shambler', weight: 100, min: 4, max: 4 },   // zombie 95 + zombie villager 5
  { type: 'rattler', weight: 100, min: 4, max: 4 },
  { type: 'fizzler', weight: 100, min: 4, max: 4 },
  { type: 'voidwalker', weight: 10, min: 1, max: 4 },
];
const FARM_ANIMALS = [
  { type: 'fleecer', weight: 12, min: 4, max: 4 },
  { type: 'bristleback', weight: 10, min: 4, max: 4 },
  { type: 'cluckling', weight: 10, min: 4, max: 4 },
  { type: 'mooxen', weight: 8, min: 4, max: 4 },
];

export const SPAWN_TABLES = {
  monster: {
    default: DEFAULT_MONSTERS,
    // desert: zombie 19 + husk 80 + zombie villager 1 are all Shamblers here
    desert: DEFAULT_MONSTERS.map((e) => (e.type === 'shambler' ? { ...e, weight: 100 } : e)),
    // snowy plains: skeleton 20 + stray 80 are all Rattlers here
    snowy_plains: DEFAULT_MONSTERS.map((e) => (e.type === 'rattler' ? { ...e, weight: 100 } : e)),
  },
  creature: {
    plains: FARM_ANIMALS, forest: FARM_ANIMALS, birch_forest: FARM_ANIMALS, taiga: FARM_ANIMALS,
    default: [],
  },
};

export function spawnTable(category, biomeId) {
  const key = BIOMES[biomeId] ? BIOMES[biomeId].key : 'plains';
  const t = SPAWN_TABLES[category];
  return t[key] || t.default;
}

/** Weighted random entry from a spawn table. */
export function weightedPick(entries, rng = Math.random) {
  let total = 0;
  for (const e of entries) total += e.weight;
  if (total <= 0) return null;
  let r = Math.floor(rng() * total);
  for (const e of entries) { r -= e.weight; if (r < 0) return e; }
  return entries[entries.length - 1];
}

/** Probability that each mob type is chosen from a table. */
export function pickProbabilities(entries) {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  const out = {};
  for (const e of entries) out[e.type] = (out[e.type] || 0) + e.weight / total;
  return out;
}

export function scaledCap(category, chunkCount) {
  return Math.floor((MOB_CAPS[category] * chunkCount) / CAP_REFERENCE_CHUNKS);
}

/**
 * Monster light test: raw sky light must not exceed rand(32), block light
 * must be 0, and max(sky - darkening, block) <= rand(0..7).
 */
export function isDarkEnoughToSpawn(rawSky, blockLight, skyDarken, rng = Math.random) {
  if (rawSky > Math.floor(rng() * 32)) return false;
  if (blockLight > MONSTER_BLOCK_LIGHT_LIMIT) return false;
  const level = Math.max(rawSky - skyDarken, blockLight);
  return level <= Math.floor(rng() * (MONSTER_LIGHT_MAX + 1));
}

/** Probability that the monster light test passes (analytic, for tests and the debug view). */
export function darkSpawnProbability(rawSky, blockLight, skyDarken) {
  if (blockLight > 0) return 0;
  const pSky = Math.max(0, 32 - rawSky) / 32; // passes when rand(32) >= rawSky
  const level = Math.max(rawSky - skyDarken, 0);
  const pLevel = Math.max(0, 8 - level) / 8;
  return pSky * pLevel;
}

/** Animals need grass below and raw brightness above 8. */
export function isBrightEnoughForAnimal(rawSky, blockLight) {
  return Math.max(rawSky, blockLight) > 8;
}

/** Despawn rule for hostile mobs. Returns true if the mob should be removed this tick. */
export function shouldDespawn(dist, noActionTime, rng = Math.random) {
  if (dist > DESPAWN_FAR) return true;
  if (dist > DESPAWN_NEAR && noActionTime > NO_ACTION_DESPAWN_TICKS && rng() < RANDOM_DESPAWN_CHANCE) return true;
  return false;
}

/** Sunlight burning check for undead (uses combined three-sun light). */
export function shouldBurnInSun({ sunlit, effectiveLevel, canSeeSky, inWater }, rng = Math.random) {
  if (!sunlit || !canSeeSky || inWater) return false;
  const f = effectiveLevel / 15;
  const brightness = f / (4 - 3 * f);
  return brightness > 0.5 && rng() * 30 < (brightness - 0.4) * 2;
}
