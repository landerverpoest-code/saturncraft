// Cooking Pot, item side: which items count as which ingredient kind and the dishes' items
// (the pot's own rules are in world/cookingPot.js).
import { B } from './blocks.js';
import { I, ITEMS } from './items.js';
import { KINDS, KIND_BIT, RECIPES } from './cookingPot.js';

/** Ingredient kind -> the item (or block item) ids that count as it. Raw meat, not cooked: the pot cooks it. */
export const KIND_ITEMS = {
  meat: [I.RAW_VENISON, I.RAW_PORK, I.RAW_BEEF, I.RAW_MUTTON, I.RAW_RABBIT, I.RAW_CHICKEN],
  fish: [I.RAW_SILVERFIN, I.RAW_REDFIN],
  mushroom: [B.BROWN_MUSHROOM, B.RED_MUSHROOM],
  berry: [I.SWEET_BERRIES, I.DEWBERRIES, I.GLOW_BERRIES],
  beet: [I.BEETROOT],
  root: [I.POTATO, I.CARROT, I.FROSTROOT],
  gourd: [I.GOURD_WEDGE, I.MELON_SLICE, B.PUMPKIN],
  grain: [I.WHEAT],
};
const KIND_OF = new Map();
for (const k of KINDS) for (const id of KIND_ITEMS[k]) if (id !== undefined) KIND_OF.set(id, k);

/** The kind of ingredient an item is, or null. */
export const kindOfItem = (id) => KIND_OF.get(id) || null;
/** The kind's bit for an item id (0 if it is no ingredient). */
export const bitOfItem = (id) => (KIND_OF.has(id) ? KIND_BIT[KIND_OF.get(id)] : 0);

/** The dishes with their item ids: [{ key, kinds, mask, servings, bowl, id, name }]. */
export const DISHES = RECIPES.map((r) => ({ ...r, id: I[r.key.toUpperCase()], name: ITEMS[I[r.key.toUpperCase()]].name }));
export const DISH_IDS = DISHES.map((d) => d.id);

/** What tipping a pot out returns for each kind in it: the kind's first item (a plain stand-in for what was put in). */
export const kindStandIn = (kind) => KIND_ITEMS[kind].find((id) => id !== undefined);
