// Water and lava flow. Meta: bits 0-2 = level (0 = source, 1..7 flowing),
// bit 3 = falling. Water spreads every 5 ticks with drop-off 1 (reach 7);
// lava every 30 ticks with drop-off 2 (reach 3), as in the reference game's
// overworld.
import { B, BLOCKS, SOLID, SHAPE } from './blocks.js';

export const WATER_DELAY = 5;
export const LAVA_DELAY = 30;

export function fluidDelay(id) { return id === B.LAVA ? LAVA_DELAY : WATER_DELAY; }
const dropOff = (id) => (id === B.LAVA ? 2 : 1);
const slopeDist = (id) => (id === B.LAVA ? 2 : 4);
const HORIZ = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function levelOf(meta) { return (meta & 8) ? 0 : meta & 7; }

/** Can fluid `id` flow into the block at x,y,z? */
function canFlowInto(world, x, y, z, id, newLevel) {
  const b = world.getBlock(x, y, z);
  if (b === B.AIR) return true;
  if (b === id) {
    const m = world.getMeta(x, y, z);
    if ((m & 7) === 0 && !(m & 8)) return false;
    return levelOf(m) > newLevel;
  }
  if (b === B.WATER || b === B.LAVA) return true; // interaction handled after
  const d = BLOCKS[b];
  if (d.solid || d.waterlogged) return false; // kelp and seagrass already stand in water
  return d.replaceable || d.shape === SHAPE.CROSS || b === B.TORCH;
}

function placeFluid(world, x, y, z, id, meta) {
  const b = world.getBlock(x, y, z);
  if ((b === B.WATER && id === B.LAVA) || (b === B.LAVA && id === B.WATER)) {
    // Water flowing into lava: source lava -> obsidian, else cobblestone. Lava onto water -> stone.
    if (b === B.LAVA) {
      const m = world.getMeta(x, y, z);
      world.setBlock(x, y, z, (m & 7) === 0 && !(m & 8) ? B.OBSIDIAN : B.COBBLESTONE);
    } else world.setBlock(x, y, z, B.STONE);
    return;
  }
  if (b !== B.AIR && b !== id) world.breakBlock(x, y, z, true);
  world.setBlock(x, y, z, id, meta);
}

/** Lava touching water hardens (checked whenever lava ticks). */
function lavaInteraction(world, x, y, z) {
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
    if (world.getBlock(x + dx, y + dy, z + dz) === B.WATER) {
      const m = world.getMeta(x, y, z);
      world.setBlock(x, y, z, (m & 7) === 0 && !(m & 8) ? B.OBSIDIAN : B.COBBLESTONE);
      return true;
    }
  }
  return false;
}

/** Shortest distance (<= limit) to a spot where the fluid can drop down, per direction. */
function slopeCost(world, x, y, z, id, depth, limit, fromDx, fromDz) {
  let best = 1000;
  for (const [dx, dz] of HORIZ) {
    if (dx === -fromDx && dz === -fromDz) continue;
    const nx = x + dx, nz = z + dz;
    const b = world.getBlock(nx, y, nz);
    if (SOLID[b] || (b === id && (world.getMeta(nx, y, nz) & 7) === 0)) continue;
    if (!SOLID[world.getBlock(nx, y - 1, nz)]) return depth;
    if (depth < limit) best = Math.min(best, slopeCost(world, nx, y, nz, id, depth + 1, limit, dx, dz));
  }
  return best;
}

export function tickFluid(world, x, y, z, id) {
  if (id === B.LAVA && lavaInteraction(world, x, y, z)) return;
  let meta = world.getMeta(x, y, z);
  const isSource = (meta & 7) === 0 && !(meta & 8);
  const drop = dropOff(id);

  if (!isSource) {
    // Recompute level from neighbours
    let newMeta;
    if (world.getBlock(x, y + 1, z) === id) newMeta = 8;
    else {
      let min = 100, sources = 0;
      for (const [dx, dz] of HORIZ) {
        if (world.getBlock(x + dx, y, z + dz) !== id) continue;
        const m = world.getMeta(x + dx, y, z + dz);
        if ((m & 7) === 0 && !(m & 8)) sources++;
        min = Math.min(min, levelOf(m));
      }
      const below = world.getBlock(x, y - 1, z);
      if (id === B.WATER && sources >= 2 && (SOLID[below] || (below === B.WATER && (world.getMeta(x, y - 1, z) & 7) === 0))) newMeta = 0;
      else newMeta = min + drop;
    }
    if (newMeta !== 8 && newMeta > 7) { world.setBlock(x, y, z, B.AIR); return; }
    if (newMeta !== meta) { world.setBlock(x, y, z, id, newMeta); meta = newMeta; }
  }

  // Flow down first
  const belowB = world.getBlock(x, y - 1, z);
  if (canFlowInto(world, x, y - 1, z, id, 0) && belowB !== id) {
    placeFluid(world, x, y - 1, z, id, 8);
    return;
  }
  if (belowB === id && !((world.getMeta(x, y - 1, z) & 7) === 0 && !(world.getMeta(x, y - 1, z) & 8))) {
    // falling column continues
    if (!(world.getMeta(x, y - 1, z) & 8)) world.setBlock(x, y - 1, z, id, 8);
    if (!isSource) return;
  }

  const level = levelOf(meta);
  const next = level + drop;
  if (next > 7) return;
  // Choose directions with the shortest path to a drop
  const costs = HORIZ.map(([dx, dz]) => {
    const nx = x + dx, nz = z + dz;
    if (!canFlowInto(world, nx, y, nz, id, next)) return Infinity;
    if (!SOLID[world.getBlock(nx, y - 1, nz)]) return 0;
    return slopeCost(world, nx, y, nz, id, 1, slopeDist(id), dx, dz);
  });
  const min = Math.min(...costs);
  if (min === Infinity) return;
  HORIZ.forEach(([dx, dz], k) => {
    if (costs[k] === min || min >= 1000) {
      if (costs[k] === Infinity) return;
      placeFluid(world, x + dx, y, z + dz, id, next);
    }
  });
}
