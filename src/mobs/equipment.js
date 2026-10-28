// Mob equipment (reference: Mob.populateDefaultEquipmentSlots and the
// regional difficulty): Shamblers and Dune Shamblers may spawn wearing armour
// and, rarely, holding an iron sword or shovel; Rattlers and Rime Rattlers hold
// a bow and may wear armour too. The chances grow with the local difficulty
// (the world's age and the time players have spent in the chunk). Worn armour
// reduces the damage a mob takes with the player's formula, a held weapon adds
// its attack bonus, every piece has an 8.5 % chance (+1 % per Plunder level) to
// drop, worn, when a player kills the mob, and mobs allowed to pick up loot take
// better gear lying on the ground (that gear always drops).
// Enchanted gear (reference: enchantSpawnedArmor / enchantSpawnedWeapon): each worn piece has a
// 50 % x clamped difficulty chance to come enchanted as if at an enchanting table of level
// 5 + rnd(18 x clamped); a held weapon (or bow) 25 % x clamped. Enchantments count in the fight
// (Bulwark cuts the damage the mob takes, Keen adds to its blows, Strongdraw to its arrows),
// show as a glint on the worn piece (also for guests), survive when the piece drops (the dropped
// stack is enchanted) and each enchanted piece adds experience to the mob's kill (gearXp).
// Also here: the chicken jockey roll for baby Shamblers.
// Pure rules (all random rolls take an rng) are exported for the tests.
import { I, ITEMS } from '../world/items.js';
import { armorReduce, armorTotals, BYPASSES_ARMOR } from '../player/armor.js';
import { selectEnchantments, protectionFactor, protectionReduce, hasEnch, enchLevel, cleanEnch } from '../world/enchantments.js';

/** Which mobs roll equipment: melee ones may get a sword or shovel, archers always hold a bow. */
export const EQUIP_KINDS = { shambler: 'melee', dune_shambler: 'melee', rattler: 'archer', rime_rattler: 'archer' };

export const EQUIP_DROP_CHANCE = 0.085;  // per piece, on a player kill
export const JOCKEY_CHANCE = 0.05;       // a baby Shambler looks for (or brings) a Cluckling to ride
export const SLOTS = 5;                  // 0 the hand, 1-4 helmet, chestplate, leggings, boots

const DIFF_ID = { peaceful: 0, easy: 1, normal: 2, hard: 3 };

/**
 * Regional difficulty (reference DifficultyInstance): difficulty id x (0.75 + world age part
 * + inhabited part + "moon" part). There are no moon phases under the ringed giant, so
 * `moon` (0..1) defaults to a half-lit 0.5.
 */
export function localDifficulty({ difficulty = 'normal', worldTicks = 0, inhabitedTicks = 0, moon = 0.5 } = {}) {
  const id = DIFF_ID[difficulty] ?? 2;
  if (!id) return 0;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  let f = 0.75;
  const age = clamp01((worldTicks - 72000) / 1440000) * 0.25;
  f += age;
  let h = clamp01(inhabitedTicks / 3600000) * (difficulty === 'hard' ? 1 : 0.75);
  h += Math.max(0, Math.min(age, moon * 0.25));
  if (difficulty === 'easy') h *= 0.5;
  return id * (f + h);
}

/** The "special multiplier": 0 below 2, 1 above 4, linear in between. */
export function clampedDifficulty(regional) {
  return regional < 2 ? 0 : regional > 4 ? 1 : (regional - 2) / 2;
}

/** Armour material per tier (leather, gold, chain, iron, diamond); there is no chain mail here, so its tier wears iron. */
export const ARMOR_TIERS = ['leather', 'gold', 'iron', 'iron', 'diamond'];
const PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];
export const armorItem = (tier, slot) => I[`${ARMOR_TIERS[tier].toUpperCase()}_${PIECES[slot].toUpperCase()}`];

/** The armour tier: 0 or 1, then three 9.5 % chances of one tier better. */
export function rollArmorTier(rng = Math.random) {
  let t = Math.floor(rng() * 2);
  for (let k = 0; k < 3; k++) if (rng() < 0.095) t++;
  return t;
}

/**
 * Roll the gear of a freshly spawned mob of `type`. Returns { hand, armor: [helmet, chest, legs, boots] }
 * (stacks or null), or null for mobs that wear nothing.
 * Armour: 15 % x clamped difficulty; boots always, then each piece up (leggings, chestplate,
 * helmet) unless a 25 % (Hard: 10 %) stop chance hits. Melee mobs: 1 % (Hard 5 %) a weapon,
 * one in three an iron sword, otherwise an iron shovel.
 */
export function rollEquipment(type, clamped, difficulty = 'normal', rng = Math.random, { armorChance = 0.15 * clamped } = {}) {
  const kind = EQUIP_KINDS[type];
  if (!kind) return null;
  const eq = { hand: null, armor: [null, null, null, null] };
  if (kind === 'archer') eq.hand = { id: I.BOW, count: 1, damage: 0 };
  const hard = difficulty === 'hard';
  if (rng() < armorChance) {
    const tier = rollArmorTier(rng), stop = hard ? 0.1 : 0.25;
    for (let slot = 3, first = true; slot >= 0; slot--, first = false) {
      if (!first && rng() < stop) break;
      eq.armor[slot] = { id: armorItem(tier, slot), count: 1, damage: 0 };
    }
  }
  if (kind === 'melee' && rng() < (hard ? 0.05 : 0.01)) {
    eq.hand = { id: Math.floor(rng() * 3) === 0 ? I.IRON_SWORD : I.IRON_SHOVEL, count: 1, damage: 0 };
  }
  return eq;
}

export const ENCHANT_ARMOR_CHANCE = 0.5, ENCHANT_WEAPON_CHANCE = 0.25;

/** The enchantment level of spawned gear: 5 + rnd(18 x clamped difficulty), at most 22. */
export const gearEnchantLevel = (clamped, rng = Math.random) => 5 + Math.floor(rng() * 18 * clamped);

/** Enchant one stack as at an enchanting table of `level`; returns the stack (unchanged if nothing fits). */
export function enchantStack(st, level, rng = Math.random) {
  const list = selectEnchantments(rng, st.id, level);
  if (list.length) { st.ench = {}; for (const [k, l] of list) st.ench[k] = l; }
  return st;
}

/**
 * Roll enchantments onto the gear of a fresh mob (mutates and returns `eq`): every worn piece with
 * chance 0.5 x clamped, the held weapon or bow with 0.25 x clamped. Nothing at clamped difficulty 0.
 */
export function enchantEquipment(eq, clamped, rng = Math.random) {
  if (!eq || !(clamped > 0)) return eq;
  for (const st of eq.armor) if (st && rng() < ENCHANT_ARMOR_CHANCE * clamped) enchantStack(st, gearEnchantLevel(clamped, rng), rng);
  if (eq.hand && rng() < ENCHANT_WEAPON_CHANCE * clamped) enchantStack(eq.hand, gearEnchantLevel(clamped, rng), rng);
  return eq;
}

/** The gear of a freshly spawned mob: armour and weapon rolls, then their enchantments (null for mobs that wear nothing). */
export function spawnGear(type, clamped, difficulty = 'normal', rng = Math.random, opts = {}) {
  return enchantEquipment(rollEquipment(type, clamped, difficulty, rng, opts), clamped, rng);
}

/** Does any piece of the gear carry enchantments? */
export const hasEnchantedGear = (eq) => !!eq && [eq.hand, ...eq.armor].some(hasEnch);

/** Experience a kill by a player adds for the gear: 1-3 per worn or held piece, 3-7 when it is enchanted. */
export function gearXp(eq, rng = Math.random) {
  if (!eq) return 0;
  let xp = 0;
  for (const st of [eq.hand, ...eq.armor]) if (st) xp += hasEnch(st) ? 3 + Math.floor(rng() * 5) : 1 + Math.floor(rng() * 3);
  return xp;
}

/** Reference: a mob may pick up loot with chance 0.55 x clamped difficulty. */
export const rollCanPickUp = (clamped, rng = Math.random) => rng() < 0.55 * clamped;

/** Defence points and toughness of the worn pieces. */
export function equipArmor(eq) { return eq ? armorTotals(eq.armor) : { points: 0, toughness: 0 }; }

/**
 * Damage a mob takes after its natural armour (def.armor, applied as before to every source)
 * and worn armour (only against sources that armour stops, like the player's).
 */
export function mobDamageTaken(dmg, natural = 0, eq = null, source = 'player') {
  const worn = BYPASSES_ARMOR.has(source) ? { points: 0, toughness: 0 } : equipArmor(eq);
  const points = natural + worn.points;
  let taken = points > 0 ? armorReduce(dmg, points, worn.toughness) : dmg;
  // Bulwark and Featherstep on worn pieces (as for the player: not the void, kills or starving)
  const epf = eq ? protectionFactor(eq.armor, source) : 0;
  if (epf > 0) taken = protectionReduce(taken, epf);
  return taken;
}

/** Attack bonus of a held weapon (its damage beyond the bare hand's 1; bows add nothing in melee). */
export function weaponBonus(st) {
  const t = st && ITEMS[st.id] && ITEMS[st.id].tool;
  if (!t) return 0;
  const keen = enchLevel(st, 'keen'); // a Keen blade cuts deeper: 0.5 x level + 0.5
  return Math.max(0, t.damage - 1) + (keen ? 0.5 * keen + 0.5 : 0);
}

/** Strongdraw level of the bow in a mob's hand (it adds to its arrows' damage). */
export const bowPower = (eq) => (eq && eq.hand ? enchLevel(eq.hand, 'strongdraw') : 0);

/** The damage a dropped piece carries (reference: max - rnd(1 + rnd(max(max - 3, 1)))). */
export function dropDamage(id, rng = Math.random) {
  const max = ITEMS[id] && ITEMS[id].durability;
  if (!max) return 0;
  const inner = Math.floor(rng() * Math.max(max - 3, 1));
  return Math.max(0, Math.min(max - 1, max - Math.floor(rng() * (1 + inner)) - 1));
}

/**
 * What a dying mob's gear drops: picked-up pieces (bit `1 << slot` in `picked`) always, undamaged;
 * the rest only on a player kill, each 8.5 % (+1 % per Plunder level), worn.
 */
export function equipmentDrops(eq, { killedByPlayer = false, plunder = 0, picked = 0 } = {}, rng = Math.random) {
  if (!eq) return [];
  const out = [];
  [eq.hand, ...eq.armor].forEach((st, slot) => {
    if (!st) return;
    if (picked & (1 << slot)) { out.push({ ...st }); return; }
    if (!killedByPlayer || rng() >= EQUIP_DROP_CHANCE + 0.01 * plunder) return;
    out.push({ ...st, damage: dropDamage(st.id, rng) });
  });
  return out;
}

/** Which slot (0 hand, 1-4 armour) a dropped item would go to on a mob of `type`, or -1. */
export function slotFor(type, id) {
  const d = ITEMS[id];
  if (!d || !EQUIP_KINDS[type]) return -1;
  if (d.armor && !d.armor.glider) return 1 + d.armor.slot;
  if (d.tool && ['sword', 'axe', 'shovel', 'pickaxe', 'hoe'].includes(d.tool.type)) return EQUIP_KINDS[type] === 'melee' ? 0 : -1;
  return -1;
}

/** Is `cand` better than what is worn in that slot (reference Mob.canReplaceCurrentItem, simplified)? */
export function isBetter(slot, cand, cur) {
  if (!cur) return true;
  const a = ITEMS[cand.id], b = ITEMS[cur.id];
  if (slot === 0) {
    if (!b.tool) return false; // an archer's bow stays
    const sa = a.tool.type === 'sword', sb = b.tool.type === 'sword';
    if (sa !== sb) return sa; // swords beat everything else
    if (a.tool.damage !== b.tool.damage) return a.tool.damage > b.tool.damage;
  } else {
    if (a.armor.defense !== b.armor.defense) return a.armor.defense > b.armor.defense;
    if (a.armor.toughness !== b.armor.toughness) return a.armor.toughness > b.armor.toughness;
  }
  return (cand.damage | 0) < (cur.damage | 0) || (!!cand.ench && !cur.ench);
}

/**
 * Undead in the sun: a helmet shades the head instead of the mob catching fire, wearing 0-1 per
 * burn check, and is gone when it breaks. Returns true while a helmet shields it.
 */
export function helmetShadesSun(eq, rng = Math.random) {
  const h = eq && eq.armor[0];
  if (!h) return false;
  h.damage = (h.damage | 0) + Math.floor(rng() * 2);
  if (h.damage >= (ITEMS[h.id].durability || 1)) eq.armor[0] = null;
  return true;
}

/** Equipment ids for the network / the model: [hand, helmet, chest, legs, boots] (0 = none). */
export const GLINT_BIT = 0x1000;
/** (An enchanted piece sets GLINT_BIT on its id, so guests can show its glint.) */
export const equipIds = (eq) => (eq ? [eq.hand, ...eq.armor].map((s) => (s ? s.id | (hasEnch(s) ? GLINT_BIT : 0) : 0)) : null);
/** Rebuild display-only equipment from ids (guests only need to see it). */
export function equipFromIds(ids) {
  if (!Array.isArray(ids)) return null;
  const st = (v) => {
    const id = Number.isInteger(v) ? v & ~GLINT_BIT : 0;
    return id && ITEMS[id] ? { id, count: 1, damage: 0, ...(v & GLINT_BIT ? { ench: { keen: 1 } } : {}) } : null; // the enchantment itself stays with the host: a stand-in shows the glint
  };
  return { hand: st(ids[0]), armor: [1, 2, 3, 4].map((i) => st(ids[i])) };
}
/** Clean equipment from a save (stacks validated). */
export function equipFromSave(s) {
  if (!s || typeof s !== 'object') return null;
  const st = (x) => {
    if (!x || !Number.isInteger(x.id) || !ITEMS[x.id]) return null;
    const out = { ...x, count: 1, damage: x.damage | 0 };
    const e = cleanEnch(x.ench);
    if (e) out.ench = e; else delete out.ench;
    return out;
  };
  return { hand: st(s.hand), armor: [0, 1, 2, 3].map((i) => st(Array.isArray(s.armor) ? s.armor[i] : null)) };
}

/**
 * The chicken jockey roll for a fresh baby Shambler (reference Zombie.finalizeSpawn): 5 % it climbs
 * on a free Cluckling nearby (if there is one), otherwise 5 % it brings its own.
 * Returns 'existing', 'new' or null.
 */
export function jockeyRoll(hasFreeChicken, rng = Math.random) {
  if (rng() < JOCKEY_CHANCE) return hasFreeChicken ? 'existing' : null;
  return rng() < JOCKEY_CHANCE ? 'new' : null;
}
