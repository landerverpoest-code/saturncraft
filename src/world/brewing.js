// The Brewing Alembic (reference: brewing stand). Pure logic, unit tested.
// A stand is { x, y, z, slots: [vial, vial, vial, ingredient, fuel], fuel, brewTime, brewing }:
//   fuel     = brews left from the last Ember Powder (20 each)
//   brewTime = ticks left of the current brew (400 to 0), 0 when idle
//   brewing  = the ingredient item id being brewed (the brew stops if it changes)
import { ITEMS, I, POTION_ITEM, SPLASH_ITEM, LINGERING_ITEM } from './items.js';
import { B } from './blocks.js';
import { brewKind, BREW_INGREDIENTS } from './potions.js';

export const BREW_TICKS = 400;
export const BREWS_PER_POWDER = 20;
export const VIAL_SLOTS = [0, 1, 2];
export const INGREDIENT_SLOT = 3, FUEL_SLOT = 4;

// (an ingredient may be a block item, such as the Blight Rose)
const INGREDIENT_IDS = new Set(BREW_INGREDIENTS.map((k) => I[k.toUpperCase()] ?? B[k.toUpperCase()]).filter((id) => id !== undefined));

export function newStand(x, y, z) { return { x, y, z, slots: [null, null, null, null, null], fuel: 0, brewTime: 0, brewing: null }; }

/** Is this item id something the alembic can brew with? */
export const isIngredient = (id) => INGREDIENT_IDS.has(id);
/** Elixirs (and water vials) go in the three vial slots. */
export const isVial = (id) => !!(ITEMS[id] && ITEMS[id].potion);

/** The item a vial becomes with an ingredient, or null. */
export function brewItem(vialId, ingId) {
  const d = ITEMS[vialId], ing = ITEMS[ingId];
  if (!d || !d.potion || !ing) return null;
  const { kind, splash, lingering } = d.potion;
  if (ingId === I.GUNPOWDER) return splash ? null : SPLASH_ITEM[kind];
  if (ingId === I.HOLLOW_BREATH) return splash && !lingering ? LINGERING_ITEM[kind] : null; // splash -> lingering
  const out = brewKind(kind, ing.key);
  if (!out) return null;
  return lingering ? LINGERING_ITEM[out] : splash ? SPLASH_ITEM[out] : POTION_ITEM[out];
}

/** Can the stand's ingredient change any of its vials? */
export function canBrew(stand) {
  const ing = stand.slots[INGREDIENT_SLOT];
  if (!ing || !isIngredient(ing.id)) return false;
  return VIAL_SLOTS.some((i) => stand.slots[i] && brewItem(stand.slots[i].id, ing.id) !== null);
}

/**
 * One tick. Refuels from Ember Powder, starts a brew (spending one fuel), counts
 * down and finishes it. Returns 'done' when vials were brewed this tick, true
 * if anything else changed, false otherwise.
 */
export function tickStand(stand) {
  let changed = false;
  const s = stand.slots;
  const fuelSt = s[FUEL_SLOT];
  if (stand.fuel <= 0 && fuelSt && fuelSt.id === I.EMBER_POWDER) {
    stand.fuel = BREWS_PER_POWDER;
    fuelSt.count--;
    if (fuelSt.count <= 0) s[FUEL_SLOT] = null;
    changed = true;
  }
  const ok = canBrew(stand);
  const ing = s[INGREDIENT_SLOT];
  if (stand.brewTime > 0) {
    if (!ok || !ing || ing.id !== stand.brewing) { stand.brewTime = 0; stand.brewing = null; return true; } // ingredient taken out
    if (--stand.brewTime === 0) {
      for (const i of VIAL_SLOTS) {
        if (!s[i]) continue;
        const out = brewItem(s[i].id, ing.id);
        if (out !== null) s[i] = { id: out, count: 1, damage: 0 };
      }
      ing.count--;
      if (ing.count <= 0) s[INGREDIENT_SLOT] = null;
      stand.brewing = null;
      return 'done';
    }
    return true;
  }
  if (ok && stand.fuel > 0) {
    stand.fuel--;
    stand.brewTime = BREW_TICKS;
    stand.brewing = ing.id;
    return true;
  }
  return changed;
}
