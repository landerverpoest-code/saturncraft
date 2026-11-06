// Crafting-graph analysis: where every item can come from, which recipe ingredients nothing can supply, and whether
// any chain of recipes turns a stack of something into more of itself. Shared by report.mjs and tests/balance.test.js.
import { I, ITEMS, HAND } from '../../src/world/items.js';
import { BLOCKS } from '../../src/world/blocks.js';
import { RECIPES, SMELTING, TAGS } from '../../src/player/crafting.js';
import { blockDrops } from '../../src/world/mining.js';
import { offerPool } from '../../src/mobs/trades.js';
import { rollDrops } from '../../src/mobs/drops.js';
import { dungeonLoot, LOOT } from '../../src/mobs/spawnerBlocks.js';
import { rollCatch } from '../../src/entities/bobber.js';
import { SITE_LOOT } from '../../src/world/archaeology.js';
import { SPAWNER_REWARDS, OMINOUS_REWARDS, VAULT_LOOT } from '../../src/world/provingLoot.js';
import { compost, COMPOST_CHANCE } from '../../src/world/composter.js';
import { DISHES } from '../../src/world/cooking.js';
import { PROFESSIONS } from './trade.mjs';
import { seeded } from './rng.mjs';

// (registers every mob definition)
import '../../src/mobs/dimensionMobs.js';
import '../../src/mobs/hostileVariants.js';
import '../../src/mobs/oceanMobs.js';
import '../../src/mobs/peddler.js';
import '../../src/mobs/duneStrider.js';
import '../../src/mobs/gloomshell.js';
import '../../src/mobs/gustling.js';
import '../../src/mobs/hoverling.js';
import '../../src/mobs/hushkeeper.js';
import '../../src/mobs/fauna.js';
import '../../src/mobs/slagColossus.js';
import { MOBS } from '../../src/mobs/mobTypes.js';

const TOOLS = ['DIAMOND_PICKAXE', 'DIAMOND_AXE', 'DIAMOND_SHOVEL', 'DIAMOND_SWORD', 'DIAMOND_HOE', 'SHEARS'].map((k) => (ITEMS[I[k]] || {}).tool || (ITEMS[I[k]] || {}).shears && { shears: true, type: 'shears', tier: 9 }).filter(Boolean);

/** Every item that something other than a recipe can hand the player: Map id -> Set of source labels. */
export function naturalSources() {
  const src = new Map();
  const add = (id, why) => { if (id === undefined || id === null || !ITEMS[id]) return; (src.get(id) || src.set(id, new Set()).get(id)).add(why); };
  const rng = seeded(99);
  // blocks that break into something (with every tool, with and without Gentle Hand)
  for (const b of BLOCKS) {
    if (!b) continue;
    for (const tool of [HAND, ...TOOLS]) for (const ench of [null, { gentle_hand: 1 }]) for (let meta = 0; meta < 16; meta++) for (let k = 0; k < 6; k++) {
      let drops = [];
      try { drops = blockDrops(b.id, tool, rng, meta, ench); } catch { /* blocks with odd meta */ }
      for (const d of drops) add(d.id, 'block:' + b.name);
    }
  }
  // mobs
  for (const [key, def] of Object.entries(MOBS)) {
    for (let k = 0; k < 400; k++) for (const d of rollDrops(key, { killedByPlayer: true, onFire: k & 1, plunder: 3 }, rng)) add(d.id, 'mob:' + key);
    for (const d of def.drops || []) { add(d.id, 'mob:' + key); for (const o of d.oneOf || []) add(o[0], 'mob:' + key); }
    if (def.rare) for (const id of def.rare.ids) add(id, 'mob:' + key);
  }
  // chests
  for (const [name, kind] of Object.entries(LOOT)) for (let k = 0; k < 3000; k++) for (const st of dungeonLoot(rng, kind)) if (st) add(st.id, 'chest:' + name);
  // fishing, archaeology, proving rewards, trading, composting
  for (let k = 0; k < 20000; k++) add(rollCatch(rng, k % 5).id, 'fishing');
  for (const t of Object.values(SITE_LOOT)) for (const e of t) add(e[0], 'archaeology');
  for (const t of [SPAWNER_REWARDS, OMINOUS_REWARDS, VAULT_LOOT]) for (const e of t) add(e[0], 'proving');
  for (const p of PROFESSIONS) for (const o of offerPool(p)) if (o[0] === 'sell') add(o[3], 'trade:' + p);
  void compost; void COMPOST_CHANCE;
  for (const d of DISHES) add(d.id, 'cooking:pot'); // the Cooking Pot (world/cookingPot.js); its tests check every dish's ingredients are obtainable
  return src;
}

/** Ids a recipe or the furnace can make. */
export function craftedIds() {
  const out = new Set();
  for (const r of RECIPES) out.add(r.result);
  for (const v of Object.values(SMELTING)) out.add(v);
  return out;
}

/** The ingredient ids (tags expanded) of a recipe, one array of candidates per slot. */
export function recipeSlots(r) {
  const slots = [];
  if (r.type === 'shapeless') for (const i of r.ings) slots.push(i);
  else for (const row of r.pattern) for (const ch of row) if (ch !== ' ') slots.push(r.key[ch]);
  return slots.map((i) => (typeof i === 'string' ? TAGS[i] : [i]));
}

/**
 * Recipe ingredients (and smelting inputs) that no source and no other recipe can produce: a recipe that can never be made.
 * Returns [{ recipe result, ingredient }] for every slot none of whose candidates is obtainable.
 */
export function deadRecipes(sources = naturalSources(), extra = new Set()) {
  const have = new Set([...sources.keys(), ...extra]);
  const dead = [];
  // closure: an item is obtainable when a source gives it or some recipe whose slots are all obtainable makes it
  let changed = true;
  const rows = RECIPES.map((r) => ({ out: r.result, slots: recipeSlots(r) }));
  for (const [from, to] of Object.entries(SMELTING)) rows.push({ out: to, slots: [[+from]] });
  while (changed) {
    changed = false;
    for (const r of rows) if (!have.has(r.out) && r.slots.every((c) => c.some((id) => have.has(id)))) { have.add(r.out); changed = true; }
  }
  for (const r of rows) if (!have.has(r.out)) dead.push({ result: r.out, missing: r.slots.filter((c) => !c.some((id) => have.has(id))).map((c) => c[0]) });
  return { dead, obtainable: have };
}

/**
 * Resource-creating chains: give every item the value 1, then let each recipe lower an output's value to (sum of its inputs)/count
 * and each smelting step copy its input's. When no chain makes more of something than it eats, the values settle in a few passes;
 * values that are still falling after `passes` passes belong to a loop that multiplies resources.
 */
export function resourceLoops(passes = 120) {
  const rows = RECIPES.filter((r) => !(r.result === undefined)).map((r) => ({ out: r.result, n: r.count, slots: recipeSlots(r) }));
  for (const [from, to] of Object.entries(SMELTING)) rows.push({ out: to, n: 1, slots: [[+from]] });
  const val = new Map();
  const get = (id) => (val.has(id) ? val.get(id) : 1);
  let last = new Set();
  for (let p = 0; p < passes; p++) {
    last = new Set();
    for (const r of rows) {
      let total = 0;
      for (const c of r.slots) total += Math.min(...c.map(get));
      const v = total / r.n;
      if (v < get(r.out) - 1e-9) { val.set(r.out, v); last.add(r.out); }
    }
    if (!last.size) break;
  }
  return [...last];
}
