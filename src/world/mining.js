// Block breaking speed and block drop rules (pure functions, unit tested).
import { BLOCKS, B, TIER, TOOL } from './blocks.js';
import { I, HAND, WOOL_ITEMS, DISCS } from './items.js';
import { LEAF_SAPLING } from './trees.js';
import { swiftdigBonus, silkDropsSelf, bountyCount } from './enchantments.js';
import { fatigueFactor } from '../player/effects.js';

/** True if this tool type is the efficient one for the block. */
export function isCorrectToolType(block, tool) {
  if (!tool || !tool.type) return false;
  if (tool.type === 'sword') return block.tool === TOOL.HOE || block.tool === TOOL.SWORD; // leaves, cobwebs
  return block.tool === tool.type;
}

/** Whether the block yields drops when broken with this tool. */
export function canHarvest(blockId, tool = HAND) {
  const b = BLOCKS[blockId];
  if (!b) return false;
  if (b.tier === TIER.ANY) return true;
  return !!tool && tool.type === b.tool && tool.tier >= b.tier;
}

/**
 * Fraction of the block destroyed per game tick.
 * @param {number} blockId
 * @param {object} tool  tool stats (HAND for bare hand)
 * @param {{onGround?: boolean, inWater?: boolean, swiftdig?: number, haste?: number}} ctx  swiftdig = the tool's Swiftdig level, haste = Haste effect level, fatigue = Mining Fatigue level
 */
export function breakProgressPerTick(blockId, tool = HAND, ctx = {}) {
  const b = BLOCKS[blockId];
  if (!b || b.hardness < 0) return 0;
  if (b.hardness === 0) return 1;
  let speed = 1;
  if (isCorrectToolType(b, tool)) speed = tool.type === 'sword' ? 1.5 : tool.speed;
  if (ctx.swiftdig && speed > 1) speed += swiftdigBonus(ctx.swiftdig);
  if (ctx.haste) speed *= 1 + 0.2 * ctx.haste;
  if (ctx.fatigue) speed *= fatigueFactor(ctx.fatigue); // Mining Fatigue
  if (ctx.inWater) speed /= 5;
  if (ctx.onGround === false) speed /= 5;
  const divisor = canHarvest(blockId, tool) ? 30 : 100;
  return speed / b.hardness / divisor;
}

/** Number of ticks needed to break a block (0 = instant, Infinity = unbreakable). */
export function breakTicks(blockId, tool = HAND, ctx = {}) {
  const p = breakProgressPerTick(blockId, tool, ctx);
  if (p <= 0) return Infinity;
  if (p >= 1) return 0;
  return Math.ceil(1 / p);
}

const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

// Ore-like drops that Bounty multiplies
const BOUNTY_DROPS = new Set(['violite_cluster', 'coal', 'raw_iron', 'raw_gold', 'raw_copper', 'cinnabar', 'azurite', 'diamond', 'beryl']);

/**
 * Items dropped by a broken block. Returns [{id, count}].
 * `ench` = the tool's enchantments: gentle_hand (the block drops itself), bounty (more ore drops).
 */
export function blockDrops(blockId, tool = HAND, rng = Math.random, meta = 0, ench = null) {
  const b = BLOCKS[blockId];
  if (!b || !canHarvest(blockId, tool)) return [];
  if (ench && ench.gentle_hand && silkDropsSelf(blockId)) return [{ id: blockId, count: 1 }];
  if (b.drops === null) return [];
  const out = baseDrops(blockId, b, rng, meta, tool);
  const bounty = ench ? ench.bounty | 0 : 0;
  if (bounty && (BOUNTY_DROPS.has(b.drops) || (typeof b.drops === 'object' && b.drops && blockId === B.EMBERQUARTZ_ORE))) {
    for (const o of out) o.count = bountyCount(o.count, bounty, rng);
  }
  return out;
}

function baseDrops(blockId, b, rng, meta, tool) {
  const d = b.drops;
  if (d === 'self') return [{ id: blockId, count: 1 }];
  if (typeof d === 'number') return [{ id: d, count: 1 }];
  if (typeof d === 'object') return [{ id: I[d.item], count: randInt(rng, d.min, d.max) }]; // { item: 'KEY', min, max }
  switch (d) {
    case 'coal': return [{ id: I.COAL, count: 1 }];
    case 'raw_iron': return [{ id: I.RAW_IRON, count: 1 }];
    case 'raw_gold': return [{ id: I.RAW_GOLD, count: 1 }];
    case 'raw_copper': return [{ id: I.RAW_COPPER, count: randInt(rng, 2, 5) }];
    case 'cinnabar': return [{ id: I.CINNABAR, count: randInt(rng, 4, 5) }];
    case 'azurite': return [{ id: I.AZURITE, count: randInt(rng, 4, 9) }];
    case 'diamond': return [{ id: I.DIAMOND, count: 1 }];
    case 'beryl': return [{ id: I.BERYL, count: 1 }];
    case 'clay': return [{ id: I.CLAY_BALL, count: 4 }];
    // Violite clusters: 4 shards with a pickaxe, 2 otherwise (reference)
    case 'violite_cluster': return [{ id: I.VIOLITE_SHARD, count: tool && tool.type === 'pickaxe' ? 4 : 2 }];
    case 'gravel': return rng() < 0.1 ? [{ id: I.FLINT, count: 1 }] : [{ id: B.GRAVEL, count: 1 }];
    case 'cobweb': return tool && (tool.type === 'sword' || tool.shears) ? [{ id: I.STRING, count: 1 }] : [];
    case 'melon_stem': return [{ id: I.MELON_SEEDS, count: 1 + ((meta & 7) === 7 && rng() < 0.5 ? 1 : 0) }];
    case 'pumpkin_stem': return [{ id: I.PUMPKIN_SEEDS, count: 1 + ((meta & 7) === 7 && rng() < 0.5 ? 1 : 0) }];
    case 'cocoa': return [{ id: I.COCOA_BEANS, count: ((meta >> 2) & 3) >= 2 ? 2 + Math.floor(rng() * 2) : 1 }];
    case 'item_frame': return [{ id: I.ITEM_FRAME, count: 1 }];
    case 'sign': return [{ id: I.SIGN, count: 1 }];
    case 'painting': return ((meta >> 2) & 15) === 0 ? [{ id: I.PAINTING, count: 1 }] : []; // one item per picture (from its first part)
    case 'campfire': return [{ id: I.COAL, count: 2 }];
    case 'snowballs': return [{ id: I.SNOWBALL, count: 4 }];
    case 'snow_layer': return [{ id: I.SNOWBALL, count: (meta & 7) + 1 }];
    case 'slab': return [{ id: blockId, count: meta === 2 ? 2 : 1 }];
    case 'wool': return [{ id: WOOL_ITEMS[meta & 15], count: 1 }];
    case 'melon': return [{ id: I.MELON_SLICE, count: 3 + Math.floor(rng() * 5) }];
    case 'bookshelf': return [{ id: I.BOOK, count: 3 }];
    case 'bed': return (meta & 8) ? [{ id: I.BED, count: 1 }] : []; // the head half drops the bed
    case 'jukebox': return [{ id: B.JUKEBOX, count: 1 }, ...(meta > 0 && DISCS[meta - 1] ? [{ id: DISCS[meta - 1], count: 1 }] : [])]; // with the disc inside
    case 'door': return (meta & 8) ? [] : [{ id: BLOCKS[blockId].doorItem || I.OAK_DOOR, count: 1 }]; // the lower half drops the door
    case 'seeds': return rng() < 0.125 ? [{ id: I.WHEAT_SEEDS, count: 1 }] : [];
    case 'carrots': {
      // mature: 1 + 1 + binomial(3, 4/7) carrots; otherwise the carrot back
      if ((meta & 7) < 7) return [{ id: I.CARROT, count: 1 }];
      let n = 2;
      for (let k = 0; k < 3; k++) if (rng() < 4 / 7) n++;
      return [{ id: I.CARROT, count: n }];
    }
    case 'potatoes': {
      // mature: 1 + 1 + binomial(3, 4/7) potatoes and a 2 % chance of a poisonous one
      if ((meta & 7) < 7) return [{ id: I.POTATO, count: 1 }];
      let n = 2;
      for (let k = 0; k < 3; k++) if (rng() < 4 / 7) n++;
      const out = [{ id: I.POTATO, count: n }];
      if (rng() < 0.02) out.push({ id: I.POISONOUS_POTATO, count: 1 });
      return out;
    }
    case 'cinderroot': return [{ id: I.CINDERROOT, count: (meta & 7) >= 3 ? randInt(rng, 2, 4) : 1 }];
    case 'beetroots': {
      if ((meta & 7) < 7) return [{ id: I.BEETROOT_SEEDS, count: 1 }];
      let seeds = 1;
      for (let k = 0; k < 3; k++) if (rng() < 4 / 7) seeds++;
      return [{ id: I.BEETROOT, count: 1 }, { id: I.BEETROOT_SEEDS, count: seeds }];
    }
    case 'wheat': {
      // mature: 1 wheat + 1 seed + binomial(3, 4/7) seeds; otherwise just the seed back
      if ((meta & 7) < 7) return [{ id: I.WHEAT_SEEDS, count: 1 }];
      let seeds = 1;
      for (let k = 0; k < 3; k++) if (rng() < 4 / 7) seeds++;
      return [{ id: I.WHEAT, count: 1 }, { id: I.WHEAT_SEEDS, count: seeds }];
    }
    // huge mushroom caps: 0-2 small mushrooms (reference: max(0, rand(-6..2)))
    case 'brown_mushroom_block':
    case 'red_mushroom_block': {
      const n = Math.max(0, randInt(rng, -6, 2));
      return n ? [{ id: d === 'red_mushroom_block' ? B.RED_MUSHROOM : B.BROWN_MUSHROOM, count: n }] : [];
    }
    case 'dead_bush': { const n = randInt(rng, 0, 2); return n ? [{ id: I.STICK, count: n }] : []; }
    case 'oak_leaves':
    case 'leaves': {
      const out = [];
      if (rng() < 0.05) out.push({ id: LEAF_SAPLING[blockId], count: 1 });
      if (rng() < 0.02) out.push({ id: I.STICK, count: randInt(rng, 1, 2) });
      if (d === 'oak_leaves' && rng() < 0.005) out.push({ id: I.APPLE, count: 1 });
      return out;
    }
    default: return [];
  }
}

export { B };
