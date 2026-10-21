// Mob loot rolls (ctx.plunder = the killer's Plunder level: 0..lvl extra per drop, +1 % rare chance per level). Counts are uniform integers in
// [min, max]; negative results mean "no drop" (used for the 1/3 eye chance).
import { MOBS } from './mobTypes.js';

/**
 * @param {string} type mob key
 * @param {{killedByPlayer?: boolean, onFire?: boolean, plunder?: number}} ctx
 * @param {() => number} rng
 * @returns {Array<{id:number,count:number}>}
 */
export function rollDrops(type, ctx = {}, rng = Math.random) {
  const def = MOBS[type];
  const out = [];
  for (const d of def.drops) {
    if (d.playerOnly && !ctx.killedByPlayer) continue;
    if (d.oneOf) {
      // one item (or none) from weighted chances: [[id, chance], ...]
      let r = rng();
      for (const [id, chance] of d.oneOf) { if (r < chance) { out.push({ id, count: 1 }); break; } r -= chance; }
      continue;
    }
    if (d.notSheared && ctx.sheared) continue;
    if (d.chance !== undefined && rng() >= d.chance + (d.plunderChance || 0) * (ctx.plunder | 0)) continue;
    let n = d.min + Math.floor(rng() * (d.max - d.min + 1));
    if (ctx.plunder > 0 && ctx.killedByPlayer && d.max > 0) n = Math.max(0, n) + Math.floor(rng() * (ctx.plunder + 1));
    if (n <= 0) continue;
    out.push({ id: ctx.onFire && d.cooked ? d.cooked : d.id, count: n });
  }
  if (def.loot) {
    // a loot pool: rolls x one weighted entry, count uniform in [count] (+0..Plunder each)
    const L = def.loot, total = L.entries.reduce((a, e) => a + e.weight, 0);
    const rolls = L.rolls[0] + Math.floor(rng() * (L.rolls[1] - L.rolls[0] + 1));
    for (let k = 0; k < rolls; k++) {
      let r = rng() * total, e = L.entries[L.entries.length - 1];
      for (const c of L.entries) { r -= c.weight; if (r < 0) { e = c; break; } }
      let n = L.count[0] + Math.floor(rng() * (L.count[1] - L.count[0] + 1));
      if (ctx.plunder > 0 && ctx.killedByPlayer) n += Math.floor(rng() * (ctx.plunder + 1));
      if (n <= 0) continue;
      const same = out.find((o) => o.id === e.id);
      if (same) same.count += n; else out.push({ id: e.id, count: n });
    }
  }
  if (def.rare && ctx.killedByPlayer && rng() < def.rare.chance + 0.01 * (ctx.plunder | 0)) {
    // vanilla's rare pool has 3 equally likely entries (a missing one drops nothing)
    const pick = def.rare.ids[Math.floor(rng() * 3)];
    if (pick !== undefined) out.push({ id: pick, count: 1 });
  }
  return out;
}

/** Expected count of an item from a uniform [min,max] roll (negative clamps to 0). */
export function expectedCount(min, max) {
  let s = 0;
  for (let n = min; n <= max; n++) s += Math.max(0, n);
  return s / (max - min + 1);
}
