// Enchantments: definitions, the enchanting-table offer formulas, anvil
// combining and the per-enchantment effects. Pure functions (unit tested).
// Numbers follow the reference game's documented formulas; names are our own.
//
// Enchantments live on an item stack as `stack.ench = { key: level }`; the
// anvil's prior-work penalty is `stack.rw` (0, 1, 3, 7, ...).
import { ITEMS, I } from './items.js';
import { B, BLOCKS, SHAPE } from './blocks.js';
import { mulberry32 } from './noise.js';
import { cleanPotFaces } from './archaeology.js';
import { copyBookFields, sameBook } from './books.js';

const lin = (base, per) => (l) => base + (l - 1) * per;

/**
 * table: item categories the enchanting table can roll it for;
 * anvil: extra categories an enchanted book can add it to.
 * min/max: the "modified enchantment level" window for each level.
 * group: enchantments sharing a group are mutually exclusive.
 */
export const ENCHANTS = {
  keen:        { name: 'Keen',        max: 5, weight: 10, table: ['sword'], anvil: ['axe'], min: lin(1, 11), span: 20, group: 'damage' },
  hallowed:    { name: 'Hallowed',    max: 5, weight: 5,  table: ['sword'], anvil: ['axe'], min: lin(5, 8), span: 20, group: 'damage' },
  shove:       { name: 'Shove',       max: 2, weight: 5,  table: ['sword'], min: lin(5, 20), span: 50 },
  emberbrand:  { name: 'Emberbrand',  max: 2, weight: 2,  table: ['sword'], min: lin(10, 20), span: 50 },
  plunder:     { name: 'Plunder',     max: 3, weight: 2,  table: ['sword'], min: lin(15, 9), span: 50 },
  swiftdig:    { name: 'Swiftdig',    max: 5, weight: 10, table: ['tool'], anvil: ['shears'], min: lin(1, 10), span: 50 },
  gentle_hand: { name: 'Gentle Hand', max: 1, weight: 1,  table: ['tool'], min: () => 15, span: 50, group: 'harvest' },
  bounty:      { name: 'Bounty',      max: 3, weight: 2,  table: ['tool'], min: lin(15, 9), span: 50, group: 'harvest' },
  steadfast:   { name: 'Steadfast',   max: 3, weight: 5,  table: ['sword', 'tool', 'armor', 'bow', 'spear'], anvil: ['shears', 'gear'], min: lin(5, 8), span: 50 },
  bulwark:     { name: 'Bulwark',     max: 4, weight: 10, table: ['armor'], min: lin(1, 11), span: 11 },
  featherstep: { name: 'Featherstep', max: 4, weight: 5,  table: ['boots'], min: lin(5, 6), span: 6 },
  strongdraw:  { name: 'Strongdraw',  max: 5, weight: 10, table: ['bow'], min: lin(1, 10), span: 15 },
  endless:     { name: 'Endless',     max: 1, weight: 1,  table: ['bow'], min: () => 20, span: 30 },
  // Tidespear (reference: trident) enchantments. `cap` is a fixed top of the level window;
  // `excludes` lists enchantments it cannot share an item with (Tidal Surge excludes both others).
  homing_tide: { name: 'Homing Tide', max: 3, weight: 5,  table: ['spear'], min: lin(12, 7), cap: 50 },             // loyalty
  tidal_surge: { name: 'Tidal Surge', max: 3, weight: 2,  table: ['spear'], min: lin(17, 7), cap: 50, excludes: ['homing_tide', 'stormcall'] }, // riptide
  harpoon:     { name: 'Harpoon',     max: 5, weight: 2,  table: ['spear'], min: lin(1, 8), span: 20 },              // impaling
  stormcall:   { name: 'Stormcall',   max: 1, weight: 1,  table: ['spear'], min: () => 25, cap: 50 },                 // channeling
};
export const ENCH_KEYS = Object.keys(ENCHANTS);
for (const k of ENCH_KEYS) {
  const e = ENCHANTS[k];
  e.key = k;
  e.maxCost = (l) => (e.cap !== undefined ? e.cap : e.min(l) + e.span);
  // anvil cost multiplier per level from the rarity (weight 10 / 5 / 2 / 1)
  e.costMul = e.weight >= 10 ? 1 : e.weight >= 5 ? 2 : e.weight >= 2 ? 4 : 8;
}

// Enchantability per material (higher = better bonus rolls). 0 = cannot be enchanted at a table.
export const TOOL_ENCHANTABILITY = { wood: 15, stone: 5, iron: 14, gold: 22, diamond: 10 };
export const ARMOR_ENCHANTABILITY = { leather: 15, gold: 25, iron: 9, diamond: 10 };

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const roman = (n) => ROMAN[n] || String(n);
export function enchName(key, level) {
  const e = ENCHANTS[key];
  if (!e) return key;
  return e.max === 1 && level === 1 ? e.name : `${e.name} ${roman(level)}`;
}

/** Categories an item belongs to: sword, tool, axe, armor, boots, bow, spear, shears, gear, book. */
export function categories(id) {
  const d = ITEMS[id];
  if (!d) return [];
  if (id === I.BOOK || id === I.ENCHANTED_BOOK) return ['book'];
  if (d.tool) return d.tool.type === 'sword' ? ['sword'] : d.tool.type === 'axe' ? ['tool', 'axe'] : ['tool'];
  if (d.armor && d.armor.pumpkin) return []; // a Carved Pumpkin takes no enchantments
  if (d.armor) return d.armor.slot === 3 ? ['armor', 'boots'] : ['armor'];
  if (d.bow || d.crossbow) return ['bow'];
  if (d.spear) return ['spear'];
  if (d.shears) return ['shears'];
  if (d.durability) return ['gear'];
  return [];
}

export function enchantability(id) {
  const d = ITEMS[id];
  if (!d) return 0;
  if (id === I.BOOK) return 1;
  if (d.tool) return TOOL_ENCHANTABILITY[d.tool.material] || 0;
  if (d.armor) return ARMOR_ENCHANTABILITY[d.armor.material] || 0;
  if (d.bow || d.crossbow || d.spear) return 1;
  return 0;
}

/** Can the enchantment go on this item at a table (or, with `anvil`, via a book at the anvil)? */
export function canApply(key, id, anvil = false) {
  const e = ENCHANTS[key];
  if (!e) return false;
  const cats = categories(id);
  if (cats.includes('book')) return true;
  return cats.some((c) => e.table.includes(c) || (anvil && e.anvil && e.anvil.includes(c)));
}

export function compatible(a, b) {
  if (a === b) return false;
  if ((ENCHANTS[a].excludes || []).includes(b) || (ENCHANTS[b].excludes || []).includes(a)) return false;
  const ga = ENCHANTS[a].group;
  return !ga || ga !== ENCHANTS[b].group;
}

/** Can an item be put on the enchanting table to be enchanted? */
export function isEnchantable(st) {
  return !!st && st.count === 1 && !hasEnch(st) && enchantability(st.id) > 0 && st.id !== I.ENCHANTED_BOOK;
}

// ---- stacks ---------------------------------------------------------------
export const hasEnch = (st) => !!(st && st.ench && Object.keys(st.ench).length);
export const enchLevel = (st, key) => (st && st.ench && st.ench[key]) | 0;
export const isGlinting = (st) => hasEnch(st);

/** Equal enchantment sets (order independent; null and {} are the same). */
export function sameEnch(a, b) {
  const ka = a ? Object.keys(a).filter((k) => a[k]) : [], kb = b ? Object.keys(b).filter((k) => b[k]) : [];
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/** Can two stacks be merged into one? Never for durability items, nor enchanted with plain. */
export function canStack(a, b) {
  return !!a && !!b && a.id === b.id && !(ITEMS[a.id] && ITEMS[a.id].durability) && sameEnch(a.ench, b.ench) && (a.rw | 0) === (b.rw | 0) && a.map === b.map && (a.label || '') === (b.label || '') && String(a.sherds || '') === String(b.sherds || '') && sameBook(a, b);
}

/** A cleaned copy of an enchantment map from untrusted data (network, saves). */
export function cleanEnch(e) {
  if (!e || typeof e !== 'object') return null;
  let out = null;
  for (const k of ENCH_KEYS) {
    const l = e[k] | 0;
    if (l > 0) (out || (out = {}))[k] = Math.min(10, l);
  }
  return out;
}

/** Copy the extra stack data (enchantments, prior work, a Gloomshell Box's contents, a book's text) from `src` onto `dst`; returns dst. */
export function withExtras(dst, src) {
  const e = src && cleanEnch(src.ench);
  if (e) dst.ench = e;
  if (src && src.rw > 0) dst.rw = src.rw | 0;
  if (src && Number.isInteger(src.map)) { dst.map = src.map; dst.mapX = src.mapX | 0; dst.mapZ = src.mapZ | 0; } // filled maps
  const c = src && src.contents && cleanContents(src.contents);
  if (c) dst.contents = c;
  const label = src && cleanLabel(src.label);
  if (label) dst.label = label; // a Name Tag's name (or any renamed stack)
  const bundle = src && src.bundle && cleanBundle(src.bundle);
  if (bundle) dst.bundle = bundle; // a Bundle's contents (world/bundles.js)
  const f = src && src.sherds && cleanPotFaces(src.sherds); // a Decorated Pot's sides (world/archaeology.js)
  if (f) dst.sherds = f;
  copyBookFields(dst, src); // a book's pages, title and author (world/books.js)
  return dst;
}

/** Longest name a Name Tag carries. */
export const LABEL_MAX = 32;
/** A cleaned name (from untrusted data): trimmed text up to LABEL_MAX characters, or null. */
export function cleanLabel(t) {
  if (typeof t !== 'string') return null;
  const s = t.replace(/[\u0000-\u001f]/g, '').trim().slice(0, LABEL_MAX);
  return s || null;
}

/** A cleaned copy of a Bundle's stacks (from untrusted data; at most 64 entries), or null when empty. */
export function cleanBundle(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const s of list.slice(0, 64)) {
    if (!s || !ITEMS[s.id | 0] || !((s.count | 0) > 0)) continue;
    const st = { id: s.id | 0, count: Math.min(64, s.count | 0), damage: s.damage | 0 };
    const e = cleanEnch(s.ench);
    if (e) st.ench = e;
    if (s.rw > 0) st.rw = s.rw | 0;
    const l = cleanLabel(s.label);
    if (l) st.label = l;
    if (Array.isArray(s.bundle)) { const b = cleanBundle(s.bundle); if (b) st.bundle = b; }
    copyBookFields(st, s); // a book keeps its text
    out.push(st);
  }
  return out.length ? out : null;
}

/**
 * A cleaned copy of a Gloomshell Box's 27 stored slots (from untrusted data), or null
 * when it holds nothing. Boxes never hold boxes with contents.
 */
export function cleanContents(list) {
  if (!Array.isArray(list)) return null;
  const out = new Array(27).fill(null);
  let any = false;
  for (let i = 0; i < Math.min(27, list.length); i++) {
    const s = list[i];
    if (!s || !ITEMS[s.id | 0] || !((s.count | 0) > 0)) continue;
    const st = { id: s.id | 0, count: Math.min(64, s.count | 0), damage: s.damage | 0 };
    const e = cleanEnch(s.ench);
    if (e) st.ench = e;
    if (s.rw > 0) st.rw = s.rw | 0;
    const l = cleanLabel(s.label);
    if (l) st.label = l;
    copyBookFields(st, s); // a book keeps its text
    out[i] = st; any = true;
  }
  return any ? out : null;
}

/** Tooltip lines (enchantment names) of a stack. */
export function enchLines(st) {
  if (!hasEnch(st)) return [];
  return ENCH_KEYS.filter((k) => st.ench[k]).map((k) => enchName(k, st.ench[k]));
}

// ---- enchanting table -------------------------------------------------------
export const MAX_SHELVES = 15;

/** Bookshelves powering a table at x,y,z: the 5x5 ring two blocks out, at table height and one up, with air in between. */
export function countBookshelves(getBlock, x, y, z) {
  let n = 0;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
    for (let dy = 0; dy <= 1; dy++) {
      if (getBlock(x + dx, y + dy, z + dz) !== B.BOOKSHELF) continue;
      // the block between the table and the shelf must be air (integer halfway, rounding toward zero)
      if (getBlock(x + Math.trunc(dx / 2), y + dy, z + Math.trunc(dz / 2)) === B.AIR) n++;
    }
  }
  return n;
}

const nextInt = (rng, n) => Math.floor(rng() * n);

/** Level cost of offer `slot` (0..2) for a shelf count (reference formula); 0 = no offer. */
export function offerCost(rng, slot, shelves) {
  shelves = Math.min(MAX_SHELVES, shelves);
  const base = nextInt(rng, 8) + 1 + (shelves >> 1) + nextInt(rng, shelves + 1);
  let c;
  if (slot === 0) c = Math.max(Math.floor(base / 3), 1);
  else if (slot === 1) c = Math.floor((base * 2) / 3) + 1;
  else c = Math.max(base, shelves * 2);
  return c < slot + 1 ? 0 : c;
}

/** Every [key, level] the table can roll for an item at a modified level (highest fitting level of each). */
export function availableEnchants(id, level) {
  const out = [];
  for (const k of ENCH_KEYS) {
    if (!canApply(k, id)) continue;
    const e = ENCHANTS[k];
    for (let l = e.max; l >= 1; l--) {
      if (level >= e.min(l) && level <= e.maxCost(l)) { out.push([k, l]); break; }
    }
  }
  return out;
}

export function weightedPick(rng, list) {
  let total = 0;
  for (const [k] of list) total += ENCHANTS[k].weight;
  let r = nextInt(rng, total);
  for (const it of list) { r -= ENCHANTS[it[0]].weight; if (r < 0) return it; }
  return list[list.length - 1];
}

/** Random enchantments for an item enchanted at `level` (reference algorithm). Returns [[key, level], ...]. */
export function selectEnchantments(rng, id, level) {
  const ench = enchantability(id);
  if (ench <= 0) return [];
  const q = Math.floor(ench / 4) + 1;
  level += 1 + nextInt(rng, q) + nextInt(rng, q);
  const bonus = (rng() + rng() - 1) * 0.15;
  level = Math.max(1, Math.round(level + level * bonus));
  let pool = availableEnchants(id, level);
  const out = [];
  if (!pool.length) return out;
  out.push(weightedPick(rng, pool));
  while (nextInt(rng, 50) <= level) {
    const last = out[out.length - 1][0];
    pool = pool.filter(([k]) => compatible(k, last));
    if (!pool.length) break;
    out.push(weightedPick(rng, pool));
    level = Math.floor(level / 2);
  }
  return out;
}

/**
 * The three table offers for an item with a given enchantment seed and shelf count:
 * [{cost, ench: [[key, level], ...], hint: [key, level]} | null] x 3.
 */
export function tableOffers(id, seed, shelves) {
  if (enchantability(id) <= 0) return [null, null, null];
  const rng = mulberry32(seed);
  const costs = [0, 1, 2].map((s) => offerCost(rng, s, shelves));
  return costs.map((cost, slot) => {
    if (!cost) return null;
    const ench = rollOffer(id, seed, slot, cost);
    if (!ench.length) return null;
    const hint = ench[mulberry32(seed + slot * 7919 + 1)() * ench.length | 0];
    return { cost, ench, hint };
  });
}

/** The enchantments an offer gives (deterministic per seed and slot). Books keep only one of several. */
export function rollOffer(id, seed, slot, cost) {
  const rng = mulberry32((seed + slot) | 0);
  const list = selectEnchantments(rng, id, cost);
  if (id === I.BOOK && list.length > 1) list.splice(nextInt(rng, list.length), 1);
  return list;
}

/** The stack after picking an offer: books become enchanted books. */
export function applyOffer(st, list) {
  const ench = {};
  for (const [k, l] of list) ench[k] = l;
  return { id: st.id === I.BOOK ? I.ENCHANTED_BOOK : st.id, count: 1, damage: st.damage | 0, ench, ...(st.rw ? { rw: st.rw } : {}) };
}

// ---- anvil ----------------------------------------------------------------
export const ANVIL_MAX_COST = 40;

/** Units of material that repair an item, or null. */
export function repairMaterial(id) {
  const d = ITEMS[id];
  if (!d) return null;
  if (d.repairWith) return I[d.repairWith]; // e.g. a Voidwing mends with Drift Membrane
  const mat = (d.tool && d.tool.material) || (d.armor && d.armor.material);
  return { wood: 'planks', stone: B.COBBLESTONE, iron: I.IRON_INGOT, gold: I.GOLD_INGOT, diamond: I.DIAMOND, leather: I.LEATHER }[mat] || null;
}
const PLANKS = [B.OAK_PLANKS, B.SPRUCE_PLANKS, B.BIRCH_PLANKS, B.JUNGLE_PLANKS, B.ACACIA_PLANKS, B.DARK_OAK_PLANKS, B.BLOSSOM_PLANKS, B.MANGROVE_PLANKS];
function isRepairMaterial(id, mat) { return mat === 'planks' ? PLANKS.includes(id) : id === mat || (mat === B.COBBLESTONE && id === B.COBBLED_DEEPSTONE); }

/**
 * Anvil result for `left` + `right`, or null when nothing can be done.
 * Returns { result, cost, use } (use = how many of the right stack are consumed).
 * The cost includes both items' prior-work penalties; at ANVIL_MAX_COST or more
 * it is "too expensive" in survival.
 */
export function anvilCombine(left, right) {
  if (!left || !right) return null;
  const dl = ITEMS[left.id];
  if (!dl) return null;
  const rwCost = (left.rw | 0) + (right.rw | 0);
  const out = { id: left.id, count: 1, damage: left.damage | 0, ench: { ...(left.ench || {}) } };
  let cost = 0, use = 1;
  const mat = repairMaterial(left.id);
  if (mat && isRepairMaterial(right.id, mat) && dl.durability) {
    // material repair: each unit mends a quarter of the full durability
    if (!out.damage) return null;
    const per = Math.min(out.damage, Math.floor(dl.durability / 4));
    if (per <= 0) return null;
    let n = 0;
    while (out.damage > 0 && n < right.count) { out.damage = Math.max(0, out.damage - per); n++; cost++; }
    use = n;
  } else {
    const book = right.id === I.ENCHANTED_BOOK;
    if (!book && right.id !== left.id) return null;
    if (left.id === I.ENCHANTED_BOOK && !book) return null;
    if (!book && dl.durability && (left.damage | 0) > 0) {
      // two of the same item: remaining durability of both plus a 12 % bonus
      const keep = (dl.durability - (left.damage | 0)) + (dl.durability - (right.damage | 0)) + Math.floor(dl.durability * 12 / 100);
      out.damage = Math.max(0, dl.durability - keep);
      cost += 2;
    }
    let any = false, bad = false;
    for (const k of ENCH_KEYS) {
      const rl = right.ench ? right.ench[k] | 0 : 0;
      if (!rl) continue;
      const e = ENCHANTS[k];
      const ok = canApply(k, left.id, true) && Object.keys(out.ench).every((o) => o === k || compatible(o, k));
      if (!ok) { cost += 1; bad = true; continue; }
      const ll = out.ench[k] | 0;
      const lvl = ll === rl ? Math.min(e.max, ll + 1) : Math.max(ll, rl);
      out.ench[k] = lvl;
      any = true;
      cost += lvl * (book ? Math.max(1, e.costMul >> 1) : e.costMul);
    }
    if (!any && bad && cost === 0) return null;
    if (!any && out.damage === (left.damage | 0)) return null; // nothing changed
  }
  if (!Object.keys(out.ench).length) delete out.ench;
  const rw = Math.max(left.rw | 0, right.rw | 0) * 2 + 1;
  out.rw = rw;
  return { result: out, cost: cost + rwCost, use };
}

// ---- effects ----------------------------------------------------------------
/** Mining speed bonus of Swiftdig (added to the tool's speed when it is the right tool). */
export const swiftdigBonus = (level) => (level > 0 ? level * level + 1 : 0);

/** Water mobs (fish, Inklings, Dolphins, Deepeyes, Gillnewts, Shellbacks): what Harpoon is for. */
export function isWaterMob(target) {
  const d = target && target.def;
  return !!(d && (d.aquatic || d.fish || d.breathesWater || d.turtle));
}

/** Harpoon's extra damage (2.5 per level) against water mobs, in melee and when thrown. */
export const harpoonBonus = (st, target) => (isWaterMob(target) ? 2.5 * enchLevel(st, 'harpoon') : 0);

/** Extra melee damage: Keen against anything, Hallowed against the undead, Harpoon against water mobs. */
export function meleeBonus(st, target) {
  let d = harpoonBonus(st, target);
  const keen = enchLevel(st, 'keen');
  if (keen) d += 0.5 * keen + 0.5;
  const hal = enchLevel(st, 'hallowed');
  if (hal && target && target.def && (target.def.undead || target.def.burnsInSun)) d += 2.5 * hal;
  return d;
}

/** How many of `amount` durability points a stack actually loses (Steadfast resists). */
export function durabilityLoss(st, amount, rng = Math.random) {
  const lvl = enchLevel(st, 'steadfast');
  if (!lvl) return amount;
  const armor = !!(ITEMS[st.id] && ITEMS[st.id].armor);
  let n = 0;
  for (let i = 0; i < amount; i++) {
    // tools: 1/(lvl+1) chance to wear; armour: 60 % + 40 %/(lvl+1)
    const p = armor ? 0.6 + 0.4 / (lvl + 1) : 1 / (lvl + 1);
    if (rng() < p) n++;
  }
  return n;
}

/** Bounty drop multiplier for ores: count * (1 + max(0, rand(0..lvl+1) - 1)). */
export function bountyCount(count, level, rng = Math.random) {
  if (level <= 0) return count;
  const bonus = Math.max(0, nextInt(rng, level + 2) - 1);
  return count * (bonus + 1);
}

// Blocks that Gentle Hand cannot pick up whole (multi-part blocks, crops, etc.)
const NO_SILK = new Set([B.BED, ...BLOCKS.filter((b) => b && b.shape === SHAPE.DOOR).map((b) => b.id), B.WHEAT, B.CARROTS, B.POTATOES, B.BEETROOTS, B.FIRE, B.SPAWNER, B.FURNACE_LIT, B.SMOKER_LIT, B.BLAST_FURNACE_LIT, B.FARMLAND, B.SNOW_LAYER, B.CINDERROOT]);
/** Does Gentle Hand make this block drop itself? */
export function silkDropsSelf(blockId) {
  const b = BLOCKS[blockId];
  if (!b || b.hardness < 0 || NO_SILK.has(blockId) || b.fluid || b.noSilk) return false;
  if (b.silkSelf) return true;
  if (b.drops === 'self' || b.drops === 'slab' || b.drops === 'wool') return false; // already drops itself
  return b.shape === SHAPE.CUBE || b.shape === SHAPE.PANE || blockId === B.VINES;
}

/** Enchantment protection factor of worn armour for a damage source (capped at 20 = 80 %). */
export function protectionFactor(armor, source) {
  if (source === 'void' || source === 'kill' || source === 'starve' || source === 'generic') return 0;
  let epf = 0;
  for (const st of armor) {
    if (!st) continue;
    epf += enchLevel(st, 'bulwark');
    if (source === 'fall') epf += 3 * enchLevel(st, 'featherstep');
  }
  return Math.min(20, epf);
}
export const protectionReduce = (amount, epf) => amount * (1 - Math.min(20, epf) / 25);

/** Arrow damage for a launch speed and the bow's Strongdraw level. */
export function arrowDamage(speed, power = 0) {
  const base = 2 + (power > 0 ? 0.5 * power + 0.5 : 0);
  return Math.ceil(speed * base);
}

/** Plunder: each drop gets 0..lvl extra. */
export const plunderExtra = (level, rng = Math.random) => (level > 0 ? nextInt(rng, level + 1) : 0);

// ---- Tidespear --------------------------------------------------------------
/** Tidal Surge works only for a player standing in water or out in the rain. */
export const canSurge = (level, { inWater = false, inRain = false } = {}) => level > 0 && (inWater || inRain);

/** The launch a Tidal Surge release gives along the look direction (blocks per tick): 3 x (1 + level) / 4. */
export function surgeVelocity(level, [dx, dy, dz]) {
  const f = 3 * (1 + level) / 4, l = Math.hypot(dx, dy, dz) || 1;
  return [dx / l * f, dy / l * f, dz / l * f];
}
