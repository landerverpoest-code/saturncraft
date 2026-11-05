// Campfire cooking: a campfire cooks up to four raw foods laid on it (right-click with raw meat, fish, a potato, a
// Frostroot...), each over CAMP_COOK_TICKS (30 s). A cooked item pops out by itself; an empty-handed right-click
// takes everything off (cooked or still raw). Breaking the campfire drops the contents.
//
// Per position state lives in game.campfires ("x,y,z" -> { slots: [{ id, t } | null x4] }), saved with the world and
// shared in multiplayer like lecterns. `id` is the raw item, `t` the ticks it has cooked. Pure helpers only; the
// world's ticking, the drops and the net messages are in game.js.
import { ITEMS } from './items.js';
import { SMELTING } from '../player/crafting.js';

export const CAMP_SLOTS = 4;
export const CAMP_COOK_TICKS = 600;

/** The cooked item for a raw food id, or undefined if a campfire cannot cook it (only foods; ores and logs need a furnace). */
export function campCooked(id) {
  const out = SMELTING[id];
  return out !== undefined && ITEMS[out] && ITEMS[out].food ? out : undefined;
}
export const canCampCook = (id) => campCooked(id) !== undefined;

/** Normalise state from a save or the net: null when nothing valid is on the campfire. */
export function cleanCamp(s) {
  if (!s || !Array.isArray(s.slots)) return null;
  const slots = [];
  for (let i = 0; i < CAMP_SLOTS; i++) {
    const e = s.slots[i];
    const ok = e && Number.isInteger(e.id) && canCampCook(e.id);
    slots.push(ok ? { id: e.id, t: Math.max(0, Math.min(CAMP_COOK_TICKS - 1, Math.floor(+e.t) || 0)) } : null);
  }
  return slots.some(Boolean) ? { slots } : null;
}

/** How many items lie on a campfire state. */
export const campCount = (c) => (c ? c.slots.filter(Boolean).length : 0);

/** Lay a raw food on the campfire: returns the new state (a copy), or null when it is full or not cookable. */
export function campAdd(c, id) {
  if (!canCampCook(id)) return null;
  const slots = c ? c.slots.map((e) => (e ? { ...e } : null)) : Array(CAMP_SLOTS).fill(null);
  const i = slots.findIndex((e) => !e);
  if (i < 0) return null;
  slots[i] = { id, t: 0 };
  return { slots };
}

/**
 * One tick of cooking (in place). Returns the ids of the items that finished (already cooked) and were taken off;
 * a non-empty result means the layout changed, so the net only needs to hear about those ticks.
 */
export function campTick(c) {
  const done = [];
  for (let i = 0; i < c.slots.length; i++) {
    const e = c.slots[i];
    if (!e) continue;
    if (++e.t >= CAMP_COOK_TICKS) { done.push(campCooked(e.id)); c.slots[i] = null; }
  }
  return done;
}
