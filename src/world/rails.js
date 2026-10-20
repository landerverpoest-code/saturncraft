// Rails: meta 0 north-south, 1 east-west, 2-5 ascending towards +x, -x, -z,
// +z, 6-9 curves (+z/+x, +z/-x, -z/-x, -z/+x), the reference numbering. A
// placed rail turns towards neighbouring rails (also one block up or down),
// and neighbours with a free end bend towards it.
import { B, SOLID, OPAQUE } from './blocks.js';

export const RAIL_EXITS = [
  [[0, -1], [0, 1]], [[-1, 0], [1, 0]],
  [[-1, 0], [1, 0]], [[1, 0], [-1, 0]], [[0, 1], [0, -1]], [[0, -1], [0, 1]],
  [[0, 1], [1, 0]], [[0, 1], [-1, 0]], [[0, -1], [-1, 0]], [[0, -1], [1, 0]],
];
/** Ascending rails: the horizontal direction that goes up (exit b of RAIL_EXITS). */
export const RAIL_UP = { 2: [1, 0], 3: [-1, 0], 4: [0, -1], 5: [0, 1] };

const isRail = (id) => id === B.RAIL;

/** Rail neighbours by direction (index 0 -z, 1 +x, 2 +z, 3 -x): 0 none, 1 same level, 2 one up, 3 one down. */
function neighbours(world, x, y, z) {
  const out = [];
  for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    if (isRail(world.getBlock(x + dx, y, z + dz))) out.push(1);
    else if (isRail(world.getBlock(x + dx, y + 1, z + dz))) out.push(2);
    else if (isRail(world.getBlock(x + dx, y - 1, z + dz))) out.push(3);
    else out.push(0);
  }
  return out;
}
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const ASC = { 1: 2, 3: 3, 0: 4, 2: 5 }; // direction index -> ascending meta

/** Best shape for a rail at x,y,z given its neighbours (prefers straights, then curves). */
export function railShape(world, x, y, z) {
  const n = neighbours(world, x, y, z);
  const has = (d) => n[d] > 0;
  const ns = has(0) || has(2), ew = has(1) || has(3);
  // curves need one rail on each axis
  if (ns && ew && !(has(0) && has(2)) && !(has(1) && has(3))) {
    const s = has(2), e = has(1);
    return s ? (e ? 6 : 7) : (e ? 9 : 8);
  }
  if (ew && !(has(0) && has(2))) {
    if (n[1] === 2) return 2; if (n[3] === 2) return 3;
    return 1;
  }
  if (n[0] === 2) return 4; if (n[2] === 2) return 5;
  return 0;
}

/** How many of a rail's two ends lead to another rail. */
function connectedEnds(world, x, y, z, meta) {
  let c = 0;
  for (const [dx, dz] of RAIL_EXITS[meta]) {
    const up = RAIL_UP[meta] && RAIL_UP[meta][0] === dx && RAIL_UP[meta][1] === dz;
    if (isRail(world.getBlock(x + dx, y + (up ? 1 : 0), z + dz)) || isRail(world.getBlock(x + dx, y - 1, z + dz))) c++;
  }
  return c;
}

/** After a rail is placed: shape it, and let neighbouring rails with a free end turn towards it. */
export function updateRails(world, x, y, z) {
  if (!isRail(world.getBlock(x, y, z))) return;
  world.setBlock(x, y, z, B.RAIL, railShape(world, x, y, z), false);
  for (const [dx, dz] of DIRS) for (const dy of [0, -1, 1]) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (!isRail(world.getBlock(nx, ny, nz))) continue;
    if (connectedEnds(world, nx, ny, nz, world.getMeta(nx, ny, nz)) >= 2) continue;
    world.setBlock(nx, ny, nz, B.RAIL, railShape(world, nx, ny, nz), false);
  }
  world.setBlock(x, y, z, B.RAIL, railShape(world, x, y, z), false);
}

/** Rails need a solid top to sit on. */
export function railSupported(world, x, y, z) {
  const b = world.getBlock(x, y - 1, z);
  return !!SOLID[b] && !!OPAQUE[b];
}

/** Track height (above the block's floor) at local position (fx, fz) for a rail shape. */
export function railHeight(meta, fx, fz) {
  const up = RAIL_UP[meta];
  if (!up) return 1 / 16;
  const t = up[0] ? (up[0] > 0 ? fx : 1 - fx) : (up[1] > 0 ? fz : 1 - fz);
  return 1 / 16 + Math.max(0, Math.min(1, t));
}
