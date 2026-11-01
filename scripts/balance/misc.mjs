// Food, experience, season and enchantment numbers.
import { ITEMS } from '../../src/world/items.js';
import { xpToNextLevel } from '../../src/player/experience.js';
import { SEASON_DATA, SEASON_KEYS, seasonState, seasonValues, DAY_TICKS } from '../../src/world/seasons.js';
import { cropGrowthChance } from '../../src/world/randomTicks.js';
import { ENCHANTS, ENCH_KEYS, protectionFactor } from '../../src/world/enchantments.js';

/** Every item you can eat: { id, name, hunger, saturation }. */
export function foods() {
  return ITEMS.filter((it) => it && it.food).map((it) => ({ id: it.id, key: it.key, name: it.name, hunger: it.food.hunger, saturation: it.food.saturation, always: !!it.food.always, effect: it.food.effect || null }));
}

/** Total experience points to reach `level` from nothing. */
export function xpTotal(level) {
  let t = 0;
  for (let l = 0; l < level; l++) t += xpToNextLevel(l);
  return t;
}

/** Mean crop growth multiplier over one whole year, sampling the blended seasons every 1/4 day. */
export function yearlyGrowth(days = 8) {
  let sum = 0, n = 0, min = Infinity, max = 0;
  for (let t = 0; t < days * 4 * DAY_TICKS; t += DAY_TICKS / 4) {
    const g = seasonValues(seasonState(t, days, 0)).growth;
    sum += g; n++; min = Math.min(min, g); max = Math.max(max, g);
  }
  return { mean: sum / n, min, max };
}

/** Relative crop yield per season (growth multiplier x chance of a stage) for a well-watered 3x3 field, f = 9. */
export function seasonalChances(f = 9) {
  const base = cropGrowthChance(f);
  return Object.fromEntries(SEASON_KEYS.map((k) => [k, Math.min(1, base * SEASON_DATA[k].growth)]));
}

/** The best Bulwark a full set of four Bulwark IV pieces gives against a normal blow (before the cap of 20). */
export function maxProtection() {
  const piece = { ench: { bulwark: ENCHANTS.bulwark.max } };
  return protectionFactor([piece, piece, piece, piece], 'mob');
}

export { ENCHANTS, ENCH_KEYS, SEASON_DATA, SEASON_KEYS };
