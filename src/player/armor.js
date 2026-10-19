// Armour: defence points and toughness reduce incoming damage with the
// reference formula; every piece wears by max(1, floor(damage / 4)) per hit.
import { ITEMS } from '../world/items.js';

export const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];

// Damage sources that armour does not reduce (reference "bypasses_armor").
export const BYPASSES_ARMOR = new Set(['fall', 'drown', 'starve', 'fire', 'void', 'poison', 'generic']);

/** Damage after armour: damage * (1 - min(20, max(armor / 5, armor - 4 * damage / (toughness + 8))) / 25). */
export function armorReduce(damage, armor, toughness = 0) {
  const f = Math.min(20, Math.max(armor / 5, armor - (4 * damage) / (toughness + 8)));
  return damage * (1 - f / 25);
}

/** Total defence points and toughness of worn armour stacks (helmet, chest, legs, boots). */
export function armorTotals(armor) {
  let points = 0, toughness = 0;
  for (const st of armor) {
    const d = st && ITEMS[st.id] && ITEMS[st.id].armor;
    if (d) { points += d.defense; toughness += d.toughness; }
  }
  return { points, toughness };
}

/** Wear every worn piece after taking `damage`; returns the indices of pieces that broke. */
export function wearArmor(armor, damage) {
  const broke = [];
  const wear = Math.max(1, Math.floor(damage / 4));
  for (let i = 0; i < armor.length; i++) {
    const st = armor[i];
    if (!st) continue;
    st.damage = (st.damage || 0) + wear;
    if (st.damage >= ITEMS[st.id].durability) { armor[i] = null; broke.push(i); }
  }
  return broke;
}
