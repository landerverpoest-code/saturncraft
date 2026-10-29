// Ecology of the surface: Wildflower Fields (whole hillsides of one kind of flower), Fungal
// Thickets (patches of small mushrooms on a mycelium floor, with giant mushrooms among the trees)
// and which tree grows where. Pure rules; every decision comes from the seed and the column.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { hashf } from './noise.js';

/** Biomes that grow flower fields, and the field noise (-1..1) above which a column is in one. */
export const FIELD_BIOMES = new Set([BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH_FOREST, BIOME.HIGHLAND_MEADOW]);
export const FIELD_THRESHOLD = 0.34;
export const FIELD_FLOWER_P = 0.42;  // chance of a flower on a grass block inside a field
export const FIELD_GRASS_P = 0.16;   // and of tall grass (fields are mostly flowers)
export const FLOWERS = [B.SUNPETAL, B.REDBLOOM, B.ROSETTE, B.SKYBELL];

/** Biomes that grow fungal thickets, the thicket noise above which a column is in one, and the core (mycelium floor). */
export const THICKET_BIOMES = new Set([BIOME.DARK_FOREST, BIOME.TAIGA, BIOME.SWAMP]);
export const THICKET_THRESHOLD = 0.42;
export const THICKET_CORE = 0.58;
export const THICKET_SHROOM_P = 0.14;     // small mushrooms on grass in a thicket
export const THICKET_CORE_SHROOM_P = 0.16; // and on its mycelium core
export const THICKET_TREE_FACTOR = 1.8;    // more trees (so more giant mushrooms) stand there

export function fieldNoise(gen, x, z) { return gen.nField.noise2(x / 70, z / 70); }
export function thicketNoise(gen, x, z) { return gen.nField.noise2(x / 55 + 400, z / 55 - 400); }

/**
 * The flower of a field column: a field is dominated by one kind (three in four of its flowers),
 * chosen per 28-block cell, the rest are any kind. r1, r2 in [0,1) are per-column randoms.
 */
export function fieldFlower(seed, wx, wz, r1, r2) {
  const dominant = Math.floor(hashf(seed, Math.floor(wx / 28), Math.floor(wz / 28), 72) * FLOWERS.length);
  return r1 < 0.75 ? FLOWERS[dominant] : FLOWERS[Math.floor(r2 * FLOWERS.length)];
}

/**
 * Tree kind for a biome; tr in [0,1) picks among the biome's mix. `thicket` is true inside a fungal
 * thicket (giant mushrooms take over a share of the trees there). Besides the older kinds, forests
 * and plains now grow 'grand_oak', birch forests 'tall_birch', taigas 'pine_tall', and open
 * ground 'shrub'.
 */
export function treeKindFor(biome, tr, thicket = false) {
  switch (biome) {
    case BIOME.TAIGA:
      if (thicket && tr < 0.16) return tr < 0.08 ? 'brown_mushroom' : 'red_mushroom';
      return tr >= 0.78 ? 'pine_tall' : 'spruce';
    case BIOME.SNOWY_TAIGA: return tr >= 0.78 ? 'pine_tall' : 'spruce';
    case BIOME.SNOWY_PLAINS: case BIOME.SNOWY_PEAKS: case BIOME.STONY_PEAKS: return 'spruce';
    case BIOME.BIRCH_FOREST: return tr < 0.6 ? 'birch' : tr < 0.85 ? 'tall_birch' : 'oak';
    case BIOME.FOREST: return tr < 0.2 ? 'birch' : tr >= 0.92 ? 'grand_oak' : 'oak';
    case BIOME.FLOWER_FOREST: return tr < 0.3 ? 'birch' : tr >= 0.9 ? 'grand_oak' : 'oak';
    case BIOME.PLAINS: return tr < 0.3 ? 'shrub' : tr >= 0.85 ? 'grand_oak' : 'oak';
    case BIOME.HIGHLAND_MEADOW: return tr < 0.5 ? 'spruce' : tr < 0.8 ? 'shrub' : 'birch';
    case BIOME.BLOSSOM_GROVE: return 'blossom';
    case BIOME.SWAMP:
      if (thicket && tr < 0.2) return tr < 0.1 ? 'brown_mushroom' : 'red_mushroom';
      return 'swamp_oak';
    case BIOME.MANGROVE_SWAMP: return 'mangrove';
    case BIOME.JUNGLE: return tr < 0.11 ? 'jungle_big' : tr < 0.5 ? 'jungle' : 'jungle_bush';
    case BIOME.SAVANNA: return tr < 0.85 ? 'acacia' : tr < 0.93 ? 'shrub' : 'oak';
    case BIOME.DARK_FOREST:
      if (thicket) return tr < 0.3 ? 'brown_mushroom' : tr < 0.55 ? 'red_mushroom' : tr < 0.7 ? 'oak' : 'dark_oak';
      return tr < 0.04 ? 'brown_mushroom' : tr < 0.08 ? 'red_mushroom' : tr < 0.14 ? 'oak' : tr < 0.18 ? 'birch' : 'dark_oak';
    case BIOME.MUSHROOM_FIELDS: return tr < 0.5 ? 'brown_mushroom' : 'red_mushroom';
    default: return 'oak';
  }
}
