// Off-hand items of mobs (reference: the off-hand slot every mob has; nothing here is lifted from the
// default spawn rules, the mobs below are the ones where it makes a story):
//   * Marauders may carry a Shield (10 % + up to 15 % with the local difficulty, Captains +15 %) or, rarer,
//     a Charm of Undying (2 %, Captains 12 %). A shield turns hits and arrows from the front (within 65
//     degrees of where the mob looks, 75 % of them), wearing down with the damage it stops; an axe
//     splinters it at one blow. A charm keeps its holder from dying once: it is used up, the mob stays on
//     1-6 health in a burst of green and gold.
//   * Vixlings sometimes (8 %) trot around with a stolen item in the mouth (berries, a feather, a bone,
//     an egg, string, leather...). A wild one spits it out when hurt and drops it when it dies.
// A held item drops for sure only when it is a stolen item or a charm; a shield drops like worn gear.
// Saved with the mob, shown on every machine (net/protocol.js, snapshot field 24; render/armorModel.js).
// Pure rules (all random rolls take an rng) are exported for the tests.
import { I, ITEMS } from '../world/items.js';
import { BYPASSES_ARMOR } from '../player/armor.js';
import { EQUIP_DROP_CHANCE, dropDamage } from './equipment.js';

export const SHIELD_ARC = Math.cos(65 * Math.PI / 180); // cosine of the half-angle the shield covers
export const SHIELD_BLOCK_CHANCE = 0.75;
export const VIXLING_LOOT_CHANCE = 0.08;
/** What a Vixling may carry off, with weights. */
export const STOLEN_ITEMS = [[I.SWEET_BERRIES, 6], [I.GLOW_BERRIES, 3], [I.FEATHER, 3], [I.BONE, 3], [I.EGG, 3], [I.STRING, 2], [I.LEATHER, 2], [I.RABBIT_HIDE, 2], [I.RAW_RABBIT, 2], [I.GOLD_INGOT, 1]];

/** Mobs that can hold something in the off-hand, and what: 'raider' (shield, charm) or 'thief' (a stolen item). */
export const OFFHAND_KINDS = { marauder: 'raider', vixling: 'thief' };

const stack = (id) => ({ id, count: 1, damage: 0 });

/**
 * Roll the off-hand item of a fresh mob of `type` (a stack or null). `clamped` is the clamped local
 * difficulty (0..1, mobs/equipment.js), `captain` a Marauder Captain, `tamed` a Vixling someone
 * already owns (tame ones carry nothing).
 */
export function rollOffhand(type, clamped = 0, { captain = false, tamed = false } = {}, rng = Math.random) {
  const kind = OFFHAND_KINDS[type];
  if (kind === 'raider') {
    if (rng() < 0.1 + 0.15 * clamped + (captain ? 0.15 : 0)) return stack(I.SHIELD);
    if (rng() < (captain ? 0.12 : 0.02)) return stack(I.CHARM_OF_UNDYING);
    return null;
  }
  if (kind === 'thief' && !tamed && rng() < VIXLING_LOOT_CHANCE) {
    const total = STOLEN_ITEMS.reduce((n, [, w]) => n + w, 0);
    let r = rng() * total;
    for (const [id, w] of STOLEN_ITEMS) if ((r -= w) < 0) return stack(id);
    return stack(STOLEN_ITEMS[0][0]);
  }
  return null;
}

/** A Marauder made Captain: keeps what it holds, otherwise gets the Captain's chances (a shield 15 %, a charm 12 %). */
export const captainOffhand = (current, rng = Math.random) => current || rollOffhand('marauder', 0, { captain: true }, rng);

export const isShield = (st) => !!st && !!ITEMS[st.id] && !!ITEMS[st.id].shield;
export const isCharm = (st) => !!st && !!ITEMS[st.id] && !!ITEMS[st.id].undying;

/** Sources a shield cannot stop (the same ones armour cannot, plus blasts from all sides). */
export const shieldIgnores = (source) => BYPASSES_ARMOR.has(source) || source === 'explosion' || source === 'lava';

/**
 * Does a raised shield on a mob at (x, z) looking along `yaw` stop a hit from (fromX, fromZ)?
 * (Facing as everywhere: front = (-sin yaw, -cos yaw).) `roll` is a random number in [0, 1).
 */
export function shieldBlocks(st, mob, from, source, roll = Math.random()) {
  if (!isShield(st) || !from || shieldIgnores(source)) return false;
  const dx = from.x - mob.x, dz = from.z - mob.z, d = Math.hypot(dx, dz);
  if (d > 0) {
    const dot = (dx * -Math.sin(mob.yaw) + dz * -Math.cos(mob.yaw)) / d;
    if (dot < SHIELD_ARC) return false;
  }
  return roll < SHIELD_BLOCK_CHANCE;
}

/** Does this held stack splinter a shield at one blow (an axe)? */
export const disablesShield = (st) => !!st && !!ITEMS[st.id] && !!ITEMS[st.id].tool && ITEMS[st.id].tool.type === 'axe';

/** Wear the shield by the damage it stopped; returns true when it broke (damage is added to the stack). */
export function wearShield(st, amount) {
  st.damage = (st.damage | 0) + Math.max(1, Math.ceil(amount));
  return st.damage >= (ITEMS[st.id].durability || 1);
}

/** Health a mob keeps when a charm saves it (1-6, never more than it can have). */
export const charmHealth = (maxHealth) => Math.max(1, Math.min(6, maxHealth | 0 || 1));

/** Sources a charm cannot answer (the void and the kill command). */
export const charmIgnores = (source) => source === 'void' || source === 'kill';

/**
 * What a dying mob's off-hand item drops: a stolen item or a charm always (a charm only after a player
 * kill), a shield like worn gear (8.5 % + 1 % per Plunder level on a player kill, worn).
 */
export function offhandDrops(st, { killedByPlayer = false, plunder = 0 } = {}, rng = Math.random) {
  if (!st) return [];
  if (isShield(st)) {
    if (!killedByPlayer || rng() >= EQUIP_DROP_CHANCE + 0.01 * plunder) return [];
    return [{ ...st, damage: Math.max(st.damage | 0, dropDamage(st.id, rng)) }];
  }
  if (isCharm(st) && !killedByPlayer) return [];
  return [{ ...st }];
}

/** Id for the network (0 = nothing). */
export const offhandId = (st) => (st && ITEMS[st.id] ? st.id : 0);
/** Display-only stack from a network id. */
export const offhandFromId = (id) => (Number.isInteger(id) && id > 0 && ITEMS[id] ? stack(id) : null);
/** Clean off-hand stack from a save. */
export function offhandFromSave(s) {
  if (!s || typeof s !== 'object' || !Number.isInteger(s.id) || !ITEMS[s.id]) return null;
  return { id: s.id, count: 1, damage: s.damage | 0 };
}
