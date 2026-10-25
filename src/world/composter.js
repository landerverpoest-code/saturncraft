// Composter: plant matter dropped in raises the compost a layer with a chance
// that depends on the item (reference values). Seven layers settle into a
// ready composter (meta 8) a second later; using it then gives Bone Meal.
// Meta = fill level 0..8.
import { B } from './blocks.js';
import { I } from './items.js';

export const READY = 8;
export const SETTLE_TICKS = 20;

const CHANCES = [
  [0.3, [I.WHEAT_SEEDS, I.BEETROOT_SEEDS, I.MELON_SEEDS, I.PUMPKIN_SEEDS, B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES, B.JUNGLE_LEAVES, B.ACACIA_LEAVES, B.DARK_OAK_LEAVES, B.BLOSSOM_LEAVES, B.MANGROVE_LEAVES, B.MANGROVE_ROOTS,
    B.OAK_SAPLING, B.BIRCH_SAPLING, B.SPRUCE_SAPLING, B.JUNGLE_SAPLING, B.ACACIA_SAPLING, B.DARK_OAK_SAPLING, B.BLOSSOM_SAPLING, B.MANGROVE_PROPAGULE, B.TALL_GRASS]],
  [0.5, [B.CACTUS, B.SUGAR_CANE, B.VINES, I.MELON_SLICE, B.CAVE_VINES]],
  [0.65, [B.MOSS_BLOCK, B.AZALEA, I.SWEET_BERRIES, I.GLOW_BERRIES, B.BAMBOO, B.KELP]],
  [0.85, [B.FLOWERING_AZALEA]],
  [0.65, [I.APPLE, I.BEETROOT, I.CARROT, I.POTATO, I.WHEAT, I.COCOA_BEANS, B.SUNPETAL, B.REDBLOOM, B.SKYBELL, B.ROSETTE, B.BROWN_MUSHROOM, B.RED_MUSHROOM,
    B.PUMPKIN, B.MELON, B.LILY_PAD]],
  [0.85, [I.BAKED_POTATO, I.BREAD, I.COOKIE, B.HAY_BALE, B.BROWN_MUSHROOM_BLOCK, B.RED_MUSHROOM_BLOCK]],
  [1, [I.PUMPKIN_PIE]],
];
export const COMPOST_CHANCE = new Map();
for (const [c, ids] of CHANCES) for (const id of ids) if (id !== undefined) COMPOST_CHANCE.set(id, c);

/**
 * Put one item in a composter at `level`: null if it does not take it (not compostable, or
 * full), else { level } - the new level (the same when the chance roll failed).
 */
export function compost(level, id, rng = Math.random) {
  const c = COMPOST_CHANCE.get(id);
  if (c === undefined || level >= 7) return null;
  return { level: level === 0 || rng() < c ? level + 1 : level };
}
