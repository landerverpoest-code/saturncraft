// Taming round: pure rules for four more tameable animals (original; reference: pets with jobs).
//   * Gloamlynx:  offer a raw fish (1 in 3; a wild one lets you near while you hold one). Perk 'pouncer': a tame one
//                 hunts Stone Mites near it, pounces for 3 damage at whatever hurts its owner, and at night curls up on
//                 a bed beside its owner.
//   * Thistlehorn: wheat (a chance each time, growing with every try; mobs/mounts.js) - then a Thistle Harness and a Saddle.
//   * Dustmole:   offer a carrot or beetroot (1 in 3). Perk 'digger': every 4 to 6 minutes, near its owner, it digs up one
//                 thing (dirt, sand, gravel, now and then flint, clay or a seed) and tosses it out.
//   * Tarnling:   offer an iron or gold nugget (1 in 3). Perk 'collector': it fetches loose metal and ore (raw ores, ingots,
//                 nuggets, coal, gems) lying within 8 blocks of it and brings them to its owner.
// The AI runs inside companions.js (companionAI); these are the tables and tests of the rules.
import { I } from '../world/items.js';
import { B } from '../world/blocks.js';

const defined = (list) => list.filter((x) => x !== undefined);

export const FISH_FOOD = defined([I.RAW_SILVERFIN, I.RAW_REDFIN, I.RAW_BOGCARP, I.RAW_DUNEFIN]);
export const ROOT_FOOD = defined([I.CARROT, I.BEETROOT]);
export const NUGGET_FOOD = defined([I.IRON_NUGGET, I.GOLD_NUGGET]);

export const DIG_DELAY = [4800, 2400];       // dig perk: 4-6 minutes between finds [base, spread]
export const DIG_RANGE = 8;                  // the owner must be this close for a find
export const COLLECT_RANGE = 8;              // collector perk: items this close to the Tarnling are fetched
export const COLLECT_REACH = 1.1;            // ... and picked up this close
export const DELIVER_REACH = 2.5;            // ... and handed over this close to the owner
export const KEEP_OFF_OWNER = 3;             // loose items this close to the owner are left (the owner picks them up)
export const POUNCE_DAMAGE = 3;
export const PEST_RANGE = 12;                // a tame Gloamlynx goes for Stone Mites this close to it
export const BED_RANGE = 5;                  // ... and looks for its owner's bed this close to the owner
export const NIGHT_BELOW = 0.5;              // combined sunlight under this is night for a Gloamlynx

/** Ticks until the next dig (a fresh Dustmole waits this long first). */
export const nextDigDelay = (rng = Math.random) => DIG_DELAY[0] + Math.floor(rng() * DIG_DELAY[1]);

/** What a Dustmole digs up: [item id, weight]. Dirt-class stuff mostly, a rare seed now and then. */
export const DIG_FINDS = [
  [B.DIRT, 6], [B.SAND, 4], [B.GRAVEL, 4], [I.FLINT, 1.5], [I.CLAY_BALL, 1.5], [I.WHEAT_SEEDS, 0.6], [I.BEETROOT_SEEDS, 0.4],
].filter(([id]) => id !== undefined);
export function pickDig(rng = Math.random, table = DIG_FINDS) {
  const total = table.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [id, w] of table) { r -= w; if (r < 0) return { id, count: 1 }; }
  return { id: table[0][0], count: 1 };
}

/** Is it time for a find? Needs the owner near and the mole on the ground, not a baby. */
export function digReady(timer, { ownerDist, onGround, baby }) {
  return !baby && onGround && ownerDist <= DIG_RANGE && timer <= 0;
}

/** Metals and ores a Tarnling fetches. */
export const COLLECTABLE = new Set(defined([
  I.RAW_IRON, I.RAW_COPPER, I.RAW_GOLD, I.IRON_INGOT, I.COPPER_INGOT, I.GOLD_INGOT, I.IRON_NUGGET, I.GOLD_NUGGET,
  I.COAL, I.AZURITE, I.BERYL, I.DIAMOND, I.SLAGSTEEL_INGOT,
]));
export const isCollectable = (id) => COLLECTABLE.has(id);

/**
 * Which loose item should a collector go for? `items` are item entities { x, y, z, dead, stack, noFetch };
 * `self` and `owner` have x, y, z. The nearest collectable one within COLLECT_RANGE of the Tarnling and farther than
 * KEEP_OFF_OWNER from the owner (and never one it delivered itself).
 */
export function pickCollectTarget(self, owner, items) {
  let best = null, bd = Infinity;
  for (const e of items) {
    if (!e || e.dead || e.noFetch || !e.stack || !isCollectable(e.stack.id)) continue;
    const d = Math.hypot(e.x - self.x, e.z - self.z);
    if (d > COLLECT_RANGE || Math.abs(e.y - self.y) > 4) continue;
    if (owner && Math.hypot(e.x - owner.x, e.z - owner.z) < KEEP_OFF_OWNER) continue;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Is it night for a Gloamlynx (the sky's combined light under NIGHT_BELOW)? */
export const isNightLight = (combined) => combined < NIGHT_BELOW;

/** Nearest Stone Mite within PEST_RANGE of a Gloamlynx. */
export function pickPest(self, entities) {
  let best = null, bd = PEST_RANGE * PEST_RANGE;
  for (const e of entities) {
    if (!e || e.kind !== 'mob' || e.type !== 'stone_mite' || e.dead || e.removed || (e.deathTime | 0) > 0) continue;
    const d = (e.x - self.x) ** 2 + (e.z - self.z) ** 2;
    if (d < bd && Math.abs(e.y - self.y) <= 4) { bd = d; best = e; }
  }
  return best;
}

/** Find a bed block near the owner: `getBlock(x, y, z)`; returns the nearest bed cell centre {x, y, z} or null. */
export function findBedNear(getBlock, owner, range = BED_RANGE) {
  const ox = Math.floor(owner.x), oy = Math.floor(owner.y), oz = Math.floor(owner.z);
  let best = null, bd = Infinity;
  for (let dx = -range; dx <= range; dx++) for (let dz = -range; dz <= range; dz++) for (let dy = -2; dy <= 2; dy++) {
    if (getBlock(ox + dx, oy + dy, oz + dz) !== B.BED) continue;
    const d = dx * dx + dz * dz + dy * dy;
    if (d < bd) { bd = d; best = { x: ox + dx + 0.5, y: oy + dy, z: oz + dz + 0.5 }; }
  }
  return best;
}

/** A wild Gloamlynx lets a player close while the player holds fish. */
export const lynxLuredBy = (itemId) => FISH_FOOD.includes(itemId);
