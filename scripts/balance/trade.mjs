// Trade-economy analysis: for every market condition (reputation, festival, champion) find buy -> craft -> sell
// loops that end with more beryl than they began with. Shared by scripts/balance/report.mjs and tests/balance.test.js.
import { I, ITEMS } from '../../src/world/items.js';
import { BLOCKS } from '../../src/world/blocks.js';
import { RECIPES, SMELTING, TAGS } from '../../src/player/crafting.js';
import { offerPool, offerPrice } from '../../src/mobs/trades.js';

export const PROFESSIONS = ['farmer', 'librarian', 'smith', 'shepherd', 'butcher', 'fletcher', 'cleric', 'cartographer', 'mason', 'toolsmith', 'armorer', 'peddler'];

/** Named market conditions: reputation, festival cut, champion (Village Champion V) discount. */
export const MARKETS = {
  neutral: { rep: 0, festival: 0, champion: 0 },
  trusted: { rep: 60, festival: 0, champion: 0 },
  hero: { rep: 100, festival: 0, champion: 0 },
  heroFestival: { rep: 100, festival: 0.12, champion: 0 },
  heroFestivalChampion: { rep: 100, festival: 0.12, champion: 0.55 },
  championOnly: { rep: 0, festival: 0, champion: 0.55 },
};

export const nameOf = (id) => (ITEMS[id] && ITEMS[id].name) || (BLOCKS[id] && BLOCKS[id].name) || `#${id}`;

/** Every offer of every profession priced at `uses` in `market`: { prof, kind, tier, give, giveN (real price), baseGive, get, getN }. */
export function pricedOffers(market, uses = 0) {
  const out = [];
  for (const prof of PROFESSIONS) for (const [kind, give, gn, get, getn, tier] of offerPool(prof)) {
    const price = offerPrice({ give, giveCount: gn, get, getCount: getn, uses }, market.champion || 0, { rep: market.rep, festival: market.festival || 0 });
    out.push({ prof, kind, tier, give, giveN: price, baseGive: gn, get, getN: getn });
  }
  return out;
}

/** Crafting and uncrafting rows: { out, n, ings: [[candidate ids]...] } (tags expanded to their members). */
export function recipeRows() {
  const rows = [];
  for (const r of RECIPES) {
    const ings = [];
    if (r.type === 'shapeless') for (const i of r.ings) ings.push(i);
    else for (const row of r.pattern) for (const ch of row) if (ch !== ' ') ings.push(r.key[ch]);
    rows.push({ out: r.result, n: r.count, ings: ings.map((i) => (typeof i === 'string' ? TAGS[i] : [i])) });
  }
  for (const [from, to] of Object.entries(SMELTING)) rows.push({ out: to, n: 1, ings: [[+from]], smelt: true });
  return rows;
}

/**
 * Cheapest beryl cost of one unit of every item that beryl alone can obtain (settler/peddler sells, then crafting and smelting
 * chains made only of such items; `free` ids cost nothing, e.g. things you can gather). Returns Map id -> cost per unit.
 */
export function acquireCosts(offers, free = []) {
  const cost = new Map();
  for (const id of free) cost.set(id, 0);
  for (const o of offers) if (o.kind === 'sell' && o.give === I.BERYL) {
    const c = o.giveN / o.getN;
    if (!(cost.get(o.get) <= c)) cost.set(o.get, c);
  }
  const rows = recipeRows();
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const r of rows) {
      let total = 0, ok = true;
      for (const cands of r.ings) {
        let best = Infinity;
        for (const c of cands) if (cost.has(c) && cost.get(c) < best) best = cost.get(c);
        if (best === Infinity) { ok = false; break; }
        total += best;
      }
      if (!ok) continue;
      const c = total / r.n;
      if (!(cost.get(r.out) <= c + 1e-9)) { cost.set(r.out, c); changed = true; }
    }
    if (!changed) break;
  }
  return cost;
}

/**
 * Buy-craft-sell loops: items a settler pays beryl for whose cheapest beryl-only acquisition costs less than the sale price.
 * Returns [{ item, name, buyer, income, cost, gain }] with income/cost in beryl per item.
 */
export function arbitrageLoops(market, uses = 0, free = []) {
  const offers = pricedOffers(market, uses), cost = acquireCosts(offers, free), loops = [];
  for (const o of offers) {
    if (o.kind !== 'buy' || o.get !== I.BERYL) continue;
    const income = o.getN / o.giveN, c = cost.get(o.give);
    if (c !== undefined && c < income - 1e-9) loops.push({ item: o.give, name: nameOf(o.give), buyer: o.prof, income, cost: c, gain: income / Math.max(c, 1e-9) });
  }
  return loops;
}
