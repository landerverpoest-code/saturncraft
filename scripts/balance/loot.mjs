// Loot analysis: what every chest kind holds on average, valued in beryl, and how the rare items are spread across kinds.
import { I, ITEMS } from '../../src/world/items.js';
import { dungeonLoot, LOOT } from '../../src/mobs/spawnerBlocks.js';
import { rollCatch } from '../../src/entities/bobber.js';
import { acquireCosts, pricedOffers, MARKETS, nameOf } from './trade.mjs';
import { seeded } from './rng.mjs';

/** Chest kinds by name -> loot kind number (mobs/spawnerBlocks.js LOOT). */
export const CHEST_KINDS = Object.fromEntries(Object.entries(LOOT));

/**
 * Beryl value of an item for loot purposes: what a settler pays for it, else what it costs to buy from one (or the cheapest
 * craft out of such things), else a small default (food and junk). Armour, tools and enchanted gear count at the price of a
 * plain piece.
 */
export function valueTable() {
  const offers = pricedOffers(MARKETS.neutral, 0), cost = acquireCosts(offers), val = new Map();
  for (const o of offers) if (o.kind === 'buy' && o.get === I.BERYL) { const v = o.getN / o.giveN; if (!(val.get(o.give) >= v)) val.set(o.give, v); }
  for (const [id, c] of cost) if (!val.has(id)) val.set(id, c);
  val.set(I.BERYL, 1);
  return (id) => (val.has(id) ? val.get(id) : 0.05);
}

/** Monte Carlo of one chest kind: { items: Map id -> mean count per chest, value: mean beryl value, stacks } over `n` chests. */
export function chestStats(kind, n = 3000, seed = 5, value = valueTable()) {
  const r = seeded(seed + kind), items = new Map();
  let stacks = 0, val = 0;
  for (let k = 0; k < n; k++) for (const st of dungeonLoot(r, kind)) if (st) {
    items.set(st.id, (items.get(st.id) || 0) + st.count);
    stacks++; val += value(st.id) * st.count;
  }
  for (const [id, c] of items) items.set(id, c / n);
  return { items, value: val / n, stacks: stacks / n };
}

/** Expected catches per cast at a Luck level. */
export function fishingStats(luck = 0, n = 40000, seed = 3) {
  const r = seeded(seed), got = new Map();
  for (let k = 0; k < n; k++) { const c = rollCatch(r, luck); got.set(c.id, (got.get(c.id) || 0) + c.count / n); }
  return got;
}

export { I, ITEMS, nameOf };
