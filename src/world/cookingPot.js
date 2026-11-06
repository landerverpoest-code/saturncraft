// The Cooking Pot: a pot over a heat source that cooks stews, soups and pies from sets of ingredient kinds.
// This file imports only blocks, so the world's scheduled ticks can run a simmering pot; which items count as which
// kind, and the dishes' items, live in world/cooking.js.
//
//  * COOKING_POT (filling): meta = a bit set of the ingredient KINDS put in so far (one of each kind, 8 kinds = 8 bits)
//  * right-click with empty hand or a Stick ("stir") when the set matches a recipe and there is a heat source below:
//    the block becomes COOKING_POT_BREW and simmers BREW_STAGES stages of BREW_STAGE_TICKS each
//  * COOKING_POT_BREW: meta bits 0-3 = the dish (index into RECIPES), bits 4-5 = the simmer stage while cooking, or
//    the servings left minus one once ready, bit 7 (READY) = ready. Each serving is taken with a Bowl (stews) or by hand (pies).
//  * a pot without heat does not cook; a simmering pot that loses its heat waits until it is heated again.
import { B } from './blocks.js';

/** The ingredient kinds, in bit order. */
export const KINDS = ['meat', 'fish', 'mushroom', 'berry', 'beet', 'root', 'gourd', 'grain'];
export const KIND_NAMES = { meat: 'Meat', fish: 'Fish', mushroom: 'Mushrooms', berry: 'Berries', beet: 'Beetroot', root: 'Roots', gourd: 'Gourd', grain: 'Wheat' };
export const KIND_BIT = Object.fromEntries(KINDS.map((k, i) => [k, 1 << i]));

/**
 * The dishes. `key` is the item's key (world/items.js); `kinds` the set it is cooked from; `servings` how many
 * come out of one pot; `bowl` whether each serving needs a Bowl (soups, stews) or is taken by hand (pies).
 * Append only: the index is stored in the pot's meta.
 */
export const RECIPES = [
  { key: 'hunters_stew', kinds: ['meat', 'root'], servings: 2, bowl: true },
  { key: 'fishers_chowder', kinds: ['fish', 'root'], servings: 2, bowl: true },
  { key: 'foragers_stew', kinds: ['mushroom', 'beet'], servings: 2, bowl: true },
  { key: 'hearty_hotpot', kinds: ['meat', 'mushroom', 'root'], servings: 3, bowl: true },
  { key: 'seafarers_pot', kinds: ['fish', 'mushroom', 'beet'], servings: 3, bowl: true },
  { key: 'gourd_soup', kinds: ['gourd', 'root'], servings: 2, bowl: true },
  { key: 'berry_tart', kinds: ['berry', 'grain'], servings: 3, bowl: false },
  { key: 'gourd_pie', kinds: ['gourd', 'grain'], servings: 3, bowl: false },
];
for (const r of RECIPES) r.mask = r.kinds.reduce((m, k) => m | KIND_BIT[k], 0);

export const BREW_STAGES = 4;
export const BREW_STAGE_TICKS = 100; // 5 s a stage, 20 s a pot
export const READY = 128;

/** Blocks that heat a pot standing on them. */
export const HEAT = new Set([B.CAMPFIRE, B.FIRE, B.LAVA, B.FURNACE_LIT, B.SMOKER_LIT, B.BLAST_FURNACE_LIT]);
export const hasHeat = (world, x, y, z) => HEAT.has(world.getBlock(x, y - 1, z));

export const isPot = (id) => id === B.COOKING_POT || id === B.COOKING_POT_BREW;

/** Can kind bit `bit` join `mask` (not there yet, and some recipe still contains the whole set)? */
export function canAdd(mask, bit) {
  if (!bit || (mask & bit)) return false;
  const next = mask | bit;
  return RECIPES.some((r) => (r.mask & next) === next);
}
/** The recipe index a set of kinds is cooked into (-1 if no recipe has exactly this set). */
export const recipeFor = (mask) => RECIPES.findIndex((r) => r.mask === mask);
/** The names of the kinds in a mask, in bit order. */
export const kindsIn = (mask) => KINDS.filter((k) => mask & KIND_BIT[k]);

// ---- the brew block's meta -------------------------------------------------------------------------------
export const brewMeta = (dish, stage) => dish | (stage << 4);
export const readyMeta = (dish, servings) => READY | dish | ((servings - 1) << 4);
export const isReady = (m) => !!(m & READY);
export const dishOf = (m) => { const d = m & 15; return d < RECIPES.length ? d : 0; }; // (a meta from outside data can name a dish there is none of)
export const stageOf = (m) => (m >> 4) & 3;
export const servingsOf = (m) => (isReady(m) ? ((m >> 4) & 3) + 1 : 0);

/**
 * Start cooking the pot at x,y,z. Returns 'started', 'empty' (nothing in it), 'nomatch' (the set is not a recipe yet),
 * 'noheat' (nothing hot below) or 'busy' (not a filling pot).
 */
export function startBrew(world, x, y, z) {
  if (world.getBlock(x, y, z) !== B.COOKING_POT) return 'busy';
  const mask = world.getMeta(x, y, z);
  if (!mask) return 'empty';
  const dish = recipeFor(mask);
  if (dish < 0) return 'nomatch';
  if (!hasHeat(world, x, y, z)) return 'noheat';
  world.setBlock(x, y, z, B.COOKING_POT_BREW, brewMeta(dish, 0));
  world.scheduleTick(x, y, z, BREW_STAGE_TICKS);
  return 'started';
}

/** A scheduled tick of a simmering pot: one stage further while there is heat (ready pots do nothing). */
export function potTick(world, x, y, z) {
  if (world.getBlock(x, y, z) !== B.COOKING_POT_BREW) return;
  const m = world.getMeta(x, y, z);
  if (isReady(m)) return;
  if (!hasHeat(world, x, y, z)) { world.scheduleTick(x, y, z, BREW_STAGE_TICKS); return; } // waits for the fire
  const stage = stageOf(m) + 1, dish = dishOf(m);
  if (stage >= BREW_STAGES) world.setBlock(x, y, z, B.COOKING_POT_BREW, readyMeta(dish, RECIPES[dish].servings));
  else { world.setBlock(x, y, z, B.COOKING_POT_BREW, brewMeta(dish, stage)); world.scheduleTick(x, y, z, BREW_STAGE_TICKS); }
}

/**
 * Take one serving out of a ready pot: returns the dish index, or -1 if the pot is not ready. The pot empties
 * (back to a filling pot with nothing in it) when the last serving is taken.
 */
export function takeServing(world, x, y, z) {
  if (world.getBlock(x, y, z) !== B.COOKING_POT_BREW) return -1;
  const m = world.getMeta(x, y, z);
  if (!isReady(m)) return -1;
  const dish = dishOf(m), left = servingsOf(m) - 1;
  if (left <= 0) world.setBlock(x, y, z, B.COOKING_POT, 0);
  else world.setBlock(x, y, z, B.COOKING_POT_BREW, readyMeta(dish, left));
  return dish;
}
