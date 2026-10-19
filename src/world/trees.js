// Tree shapes shared by world generation and saplings: a list of
// [dx, dy, dz, block, force] relative to the trunk base, in placement order.
// Leaves never replace other blocks; logs (force) replace anything soft.
import { B } from './blocks.js';
import { hashf } from './noise.js';

export const LEAVES = new Set([B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES]);
export const LOGS = new Set([B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG]);

/** Blocks of a tree of `kind` ('oak', 'birch', 'spruce'); r in [0,1) picks the variation. */
export function treeShape(kind, r) {
  const out = [];
  if (kind === 'spruce') {
    const h = 6 + Math.floor(r * 4);
    const leafStart = 2 + Math.floor(r * 2);
    let radius = 0;
    for (let k = h; k >= leafStart; k--) {
      for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > radius + (radius > 1 ? 1 : 0)) continue;
        out.push([dx, k, dz, B.SPRUCE_LEAVES, false]);
      }
      radius = radius >= 2 ? (k % 2 ? 1 : 2) : radius + 1;
      if (k > h - 2) radius = Math.min(radius, 1);
    }
    out.push([0, h + 1, 0, B.SPRUCE_LEAVES, false]);
    for (let k = 0; k < h; k++) out.push([0, k, 0, B.SPRUCE_LOG, true]);
    out.push([0, -1, 0, B.DIRT, true]);
    out.height = h + 2;
    return out;
  }
  const log = kind === 'birch' ? B.BIRCH_LOG : B.OAK_LOG;
  const leaf = kind === 'birch' ? B.BIRCH_LEAVES : B.OAK_LEAVES;
  const h = (kind === 'birch' ? 5 : 4) + Math.floor(r * 3);
  for (let yy = h - 3; yy <= h; yy++) {
    const layer = yy - h;
    const radius = layer >= -1 ? 1 : 2;
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
      if (corner && (layer === 0 || hashf(dx, yy, dz, Math.floor(r * 1e6)) < 0.5)) continue;
      out.push([dx, yy, dz, leaf, false]);
    }
  }
  for (let k = 0; k < h; k++) out.push([0, k, 0, log, true]);
  out.push([0, -1, 0, B.DIRT, true]);
  out.height = h + 1;
  return out;
}

const SOFT = new Set([B.AIR, B.TALL_GRASS, B.SUNPETAL, B.REDBLOOM, B.OAK_SAPLING, B.BIRCH_SAPLING, B.SPRUCE_SAPLING]);

/**
 * Grow a tree from a sapling at x,y,z in a live world. Fails (returns false)
 * when the trunk would run into something solid or out of the world.
 */
export function growTree(world, x, y, z, kind, rng = Math.random) {
  const shape = treeShape(kind, rng());
  for (let k = 1; k < shape.height; k++) {
    const id = world.getBlock(x, y + k, z);
    if (!SOFT.has(id) && !LEAVES.has(id)) return false;
  }
  for (const [dx, dy, dz, id, force] of shape) {
    if (dy < 0) continue; // keep the ground as it is
    const cur = world.getBlock(x + dx, y + dy, z + dz);
    if (force ? (SOFT.has(cur) || LEAVES.has(cur)) : SOFT.has(cur)) {
      world.setBlock(x + dx, y + dy, z + dz, id, 0);
    }
  }
  return true;
}

export const SAPLING_TREE = { [B.OAK_SAPLING]: 'oak', [B.BIRCH_SAPLING]: 'birch', [B.SPRUCE_SAPLING]: 'spruce' };
export const LEAF_SAPLING = { [B.OAK_LEAVES]: B.OAK_SAPLING, [B.BIRCH_LEAVES]: B.BIRCH_SAPLING, [B.SPRUCE_LEAVES]: B.SPRUCE_SAPLING };

/**
 * Leaf decay: natural leaves (meta 0) with no log within 4 steps through
 * leaves and logs fall apart. Player-placed leaves have meta 1 and stay.
 */
export function leavesConnected(world, x, y, z, maxDist = 4) {
  const seen = new Set([`${x},${y},${z}`]);
  let frontier = [[x, y, z]];
  for (let d = 1; d <= maxDist && frontier.length; d++) {
    const next = [];
    for (const [fx, fy, fz] of frontier) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const nx = fx + dx, ny = fy + dy, nz = fz + dz, k = `${nx},${ny},${nz}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const id = world.getBlock(nx, ny, nz);
        if (LOGS.has(id)) return true;
        if (LEAVES.has(id)) next.push([nx, ny, nz]);
      }
    }
    frontier = next;
  }
  return false;
}
