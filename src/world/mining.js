// Block breaking speed and block drop rules (pure functions, unit tested).
import { BLOCKS, B, TIER, TOOL } from './blocks.js';
import { I, HAND } from './items.js';

/** True if this tool type is the efficient one for the block. */
export function isCorrectToolType(block, tool) {
  if (!tool || !tool.type) return false;
  if (tool.type === 'sword') return block.tool === TOOL.HOE; // leaves
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
 * @param {{onGround?: boolean, inWater?: boolean}} ctx
 */
export function breakProgressPerTick(blockId, tool = HAND, ctx = {}) {
  const b = BLOCKS[blockId];
  if (!b || b.hardness < 0) return 0;
  if (b.hardness === 0) return 1;
  let speed = 1;
  if (isCorrectToolType(b, tool)) speed = tool.type === 'sword' ? 1.5 : tool.speed;
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

/** Items dropped by a broken block. Returns [{id, count}]. */
export function blockDrops(blockId, tool = HAND, rng = Math.random, meta = 0) {
  const b = BLOCKS[blockId];
  if (!b || b.drops === null || !canHarvest(blockId, tool)) return [];
  const d = b.drops;
  if (d === 'self') return [{ id: blockId, count: 1 }];
  if (typeof d === 'number') return [{ id: d, count: 1 }];
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
    case 'gravel': return rng() < 0.1 ? [{ id: I.FLINT, count: 1 }] : [{ id: B.GRAVEL, count: 1 }];
    case 'bed': return (meta & 8) ? [{ id: I.BED, count: 1 }] : []; // the head half drops the bed
    case 'door': return (meta & 8) ? [] : [{ id: I.OAK_DOOR, count: 1 }]; // the lower half drops the door
    case 'seeds': return rng() < 0.125 ? [{ id: I.WHEAT_SEEDS, count: 1 }] : [];
    case 'wheat': {
      // mature: 1 wheat + 1 seed + binomial(3, 4/7) seeds; otherwise just the seed back
      if ((meta & 7) < 7) return [{ id: I.WHEAT_SEEDS, count: 1 }];
      let seeds = 1;
      for (let k = 0; k < 3; k++) if (rng() < 4 / 7) seeds++;
      return [{ id: I.WHEAT, count: 1 }, { id: I.WHEAT_SEEDS, count: seeds }];
    }
    case 'dead_bush': { const n = randInt(rng, 0, 2); return n ? [{ id: I.STICK, count: n }] : []; }
    case 'oak_leaves':
    case 'leaves': {
      const out = [];
      if (rng() < 0.02) out.push({ id: I.STICK, count: randInt(rng, 1, 2) });
      if (d === 'oak_leaves' && rng() < 0.005) out.push({ id: I.APPLE, count: 1 });
      return out;
    }
    default: return [];
  }
}

export { B };
