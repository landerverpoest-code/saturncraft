// Soakmoss (reference: sponge). When it is placed, or water flows next to it,
// it drinks up the water around it: a breadth-first walk through water blocks
// from the sponge, up to 7 steps away (taxicab), at most 65 blocks; then it
// turns into Wet Soakmoss. Pure search (unit tested) plus the world hook.
import { B } from './blocks.js';

export const SPONGE_REACH = 7;
export const SPONGE_MAX = 65;
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * Water blocks a sponge at (x, y, z) would soak up, in the order the reference
 * game removes them. `getBlock(x, y, z)` reads the world.
 * @returns {Array<[number, number, number]>}
 */
export function spongeAbsorb(getBlock, x, y, z) {
  const out = [], seen = new Set([`${x},${y},${z}`]);
  const queue = [[x, y, z, 0]];
  for (let qi = 0; qi < queue.length; qi++) {
    const [px, py, pz, d] = queue[qi];
    for (const [dx, dy, dz] of DIRS) {
      const nx = px + dx, ny = py + dy, nz = pz + dz, k = `${nx},${ny},${nz}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (getBlock(nx, ny, nz) !== B.WATER) continue;
      out.push([nx, ny, nz]);
      if (out.length >= SPONGE_MAX) return out;
      if (d < SPONGE_REACH - 1) queue.push([nx, ny, nz, d + 1]);
    }
  }
  return out;
}

/** World hook: a dry sponge at (x, y, z) soaks up nearby water. Returns the number of blocks removed. */
export function spongeUpdate(world, x, y, z) {
  if (world.getBlock(x, y, z) !== B.SOAKMOSS) return 0;
  const list = spongeAbsorb((a, b, c) => world.getBlock(a, b, c), x, y, z);
  if (!list.length) return 0;
  world.setBlock(x, y, z, B.WET_SOAKMOSS, 0, false); // first, so the removals below cannot re-trigger it
  for (const [a, b, c] of list) world.setBlock(a, b, c, B.AIR);
  return list.length;
}
