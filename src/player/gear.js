// What the armour sets and the worn trinkets add up to. Everything that reads a passive gear effect asks here:
//   speed (walk speed fraction)  sprintSave (share of sprint hunger saved)  wearSave (share of tool and weapon wear spared)
//   plunder (levels of Plunder on any weapon)  protect (armour-set protection points, joins Bulwark; the total stays capped at 20)
//   knockResist (share of knockback taken off)  fireResist (share off fire, lava and burning)  ward (share off creature, arrow, blast
//   and magic damage)  pull (blocks a Lodestone Charm pulls drops from)  mineOre (ore mining speed)  oreXp (more ore experience)
//   light (a held-torch light level that follows the wearer)
import { bonusFor, countPieces } from './setBonuses.js';
import { TRINKETS, wornKinds } from './trinkets.js';

export const NO_GEAR = Object.freeze({ speed: 0, sprintSave: 0, wearSave: 0, plunder: 0, protect: 0, knockResist: 0, fireResist: 0, ward: 0, pull: 0, mineOre: 0, oreXp: 0, light: 0 });
const CAPS = { wearSave: 0.6, speed: 0.5, sprintSave: 0.75, knockResist: 0.9, fireResist: 0.9, ward: 0.5, protect: 12, plunder: 3 };

/** Totals for armour stacks and trinket stacks. */
export function gearTotals(armor, trinkets) {
  const t = { ...NO_GEAR };
  const add = (b) => { for (const [k, v] of Object.entries(b)) t[k] = k === 'light' || k === 'pull' ? Math.max(t[k], v) : t[k] + v; };
  const counts = countPieces(armor);
  for (const [s, n] of Object.entries(counts)) add(bonusFor(s, n));
  for (const k of wornKinds(trinkets)) add(TRINKETS[k].bonus);
  for (const [k, c] of Object.entries(CAPS)) t[k] = Math.min(c, t[k]);
  return t;
}

/** The totals for an inventory, remembered until the worn pieces change. */
export function gearBonuses(inv) {
  if (!inv) return NO_GEAR;
  const sig = (inv.armor || []).map((s) => (s ? s.id : 0)).join(',') + '|' + (inv.trinkets || []).map((s) => (s ? s.id : 0)).join(',');
  if (inv._gearSig !== sig) { inv._gearSig = sig; inv._gear = gearTotals(inv.armor, inv.trinkets); }
  return inv._gear;
}

/** Fire, lava and burning damage after the gear's share. */
export const fireFactor = (g) => 1 - g.fireResist;
