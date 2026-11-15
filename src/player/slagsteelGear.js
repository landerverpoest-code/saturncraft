// Slagsteel gear: the armour's fire ward (15% per piece, 60% for the whole set) and the Ember-forged upgrade.
// An Ember-forged tool is a Slagsteel sword, axe, shovel, pickaxe or hoe that went through the anvil with an Ember Rod
// (`forgeCombine`, used by world/enchantments.js anvilCombine): the stack carries `forged: true` (kept by withExtras, the
// network's item copies, saves and bundles like an enchantment). A forged blade does +1 damage and sets what it hits
// alight (as Emberbrand I does); a forged axe does +1 damage; a forged pickaxe, shovel or hoe digs 1 faster.
import { ITEMS, I } from '../world/items.js';

/** Fire, lava and burning damage each Slagsteel armour piece takes off. */
export const FIRE_WARD_PER_PIECE = 0.15;

/** Share of fire, lava and burning damage the armour stacks ward off (0 to 0.6 with the four Slagsteel pieces). */
export function fireWard(armor) {
  let w = 0;
  for (const st of armor || []) {
    const a = st && ITEMS[st.id] && ITEMS[st.id].armor;
    if (a && a.fireward) w += a.fireward;
  }
  return Math.min(1, w);
}

/** Can this item be Ember-forged? (a Slagsteel tool that is not forged yet) */
export function canForge(st) {
  const d = st && ITEMS[st.id];
  return !!(d && d.tool && d.tool.material === 'slagsteel' && !st.forged);
}
export const isForged = (st) => !!(st && st.forged === true && ITEMS[st.id] && ITEMS[st.id].tool && ITEMS[st.id].tool.material === 'slagsteel');
/** A cleaned `forged` flag from untrusted data: true or undefined. */
export const cleanForged = (v) => (v === true || v === 1 ? true : undefined);

export const FORGED_DAMAGE = 1;
export const FORGED_SPEED = 1;
export const FORGED_IGNITE_TICKS = 80;

const typeOf = (st) => ITEMS[st.id].tool.type;
/** Extra melee damage of a forged blade or axe. */
export const forgedDamage = (st) => (isForged(st) && (typeOf(st) === 'sword' || typeOf(st) === 'axe') ? FORGED_DAMAGE : 0);
/** Extra mining speed of a forged pickaxe, shovel or hoe. */
export const forgedSpeed = (st) => (isForged(st) && typeOf(st) !== 'sword' && typeOf(st) !== 'axe' ? FORGED_SPEED : 0);
/** Burn ticks a forged sword puts on what it hits. */
export const forgedIgnite = (st) => (isForged(st) && typeOf(st) === 'sword' ? FORGED_IGNITE_TICKS : 0);

/** Anvil: a Slagsteel tool and one Ember Rod make it Ember-forged. { result, cost, use } or null. */
export function forgeCombine(left, right) {
  if (!left || !right || right.id !== I.EMBER_ROD || !canForge(left)) return null;
  return { result: { ...left, count: 1, forged: true, rw: (left.rw | 0) * 2 + 1 }, cost: 6 + (left.rw | 0), use: 1, forge: true };
}

/** Tooltip lines of a forged stack. */
export function forgedLines(st) {
  if (!isForged(st)) return [];
  const t = typeOf(st);
  return [t === 'sword' ? 'Ember-forged: +1 damage, sets foes alight' : t === 'axe' ? 'Ember-forged: +1 damage' : 'Ember-forged: digs 1 faster'];
}
