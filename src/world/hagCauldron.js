// The Hag's Cauldron: a puzzle with no one to ask. A Hag Hut keeps a cauldron (and, in its chest, a Written Book with the hag's recipe
// told in riddles). The recipe is three of four things, in a fixed order that depends on the world's seed: a Peat Clot (from a Peat Lurker),
// Tallow (from a Wickling), a Slimeball or a Snapper Fang (from a Sandsnapper). Right-click the cauldron with one: the right one next in line
// is stirred in (the block's meta counts the steps done, so it is shared with everyone and kept in the world); a wrong one - or the right
// one at the wrong time - curdles the brew, which is lost and starts over. After the third step the cauldron gives Bog Essence, the base of
// an Elixir of the Marsh. Pure functions of the seed and the item; the interaction lives in player/interaction.js.
import { I } from './items.js';
import { mulberry32, hash4 } from './noise.js';

export const CAULDRON_STEPS = 3;
/** What can be put in, in a fixed order (the recipe is a choice of three of these, ordered). */
export const CAULDRON_ITEMS = ['PEAT_CLOT', 'TALLOW', 'SLIMEBALL', 'SNAPPER_FANG'];
/** What a finished brew gives. */
export const CAULDRON_YIELD = { key: 'BOG_ESSENCE', count: 2 };
export const itemIds = () => CAULDRON_ITEMS.map((k) => I[k]);

/** The recipe of a world: the indices (into CAULDRON_ITEMS) of the three steps, in order. */
export function cauldronRecipe(seed) {
  const rng = mulberry32(hash4(seed | 0, 4141, 77, 5)), pool = [0, 1, 2, 3], out = [];
  for (let k = 0; k < CAULDRON_STEPS; k++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

/** Index of an item id among the cauldron's things, or -1. */
export const cauldronIndex = (id) => itemIds().indexOf(id);

/**
 * Feed item `id` to a cauldron that has done `progress` steps. Returns { result, progress }: 'ignore' (not something the cauldron takes: nothing
 * is used up), 'step' (the right thing at the right time), 'done' (the last step: the brew is ready, progress back to 0) or 'curdle'
 * (wrong: the item is used up, the brew starts over).
 */
export function cauldronFeed(seed, progress, id) {
  const i = cauldronIndex(id);
  if (i < 0) return { result: 'ignore', progress };
  const recipe = cauldronRecipe(seed), p = Math.max(0, Math.min(CAULDRON_STEPS - 1, progress | 0));
  if (recipe[p] !== i) return { result: 'curdle', progress: 0 };
  return p + 1 >= CAULDRON_STEPS ? { result: 'done', progress: 0 } : { result: 'step', progress: p + 1 };
}

/** Riddles for each thing; a hag's book tells the recipe with these. */
export const RIDDLES = {
  PEAT_CLOT: 'the black clot a lurker leaves when the bog lets go of it',
  TALLOW: 'the weeping wax of a candle-headed wanderer',
  SLIMEBALL: 'the green gloop of a thing that bounces',
  SNAPPER_FANG: 'a tooth of whatever waits under the dry sand',
};
const ORDINAL = ['First', 'Then', 'Last'];

/** The pages of a hag's recipe book for a world: three riddles in order, spread over the book. */
export function recipePages(seed) {
  const r = cauldronRecipe(seed);
  return [
    'Brew for the one who finds this: Bog Essence, boiled in the iron pot, three things in the right order, and the pot will not forgive a wrong one.',
    ...r.map((i, k) => `${ORDINAL[k]}: ${RIDDLES[CAULDRON_ITEMS[i]]}.`),
    'Stir each in as it comes. Then draw the essence off and mix it into a murky vial. The marsh does the rest.',
  ];
}
