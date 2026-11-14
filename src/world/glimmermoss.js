// Glimmermoss: a glowing wall plant of caves. It hangs on the side of a solid block like Vines (meta = the side index of its wall), but
// nothing climbs it, and only Shears bring it home. Bone Meal spreads one more onto a free neighbouring wall spot.
import { B, SOLID, OPAQUE } from './blocks.js';
import { SIDE_DIRS } from './shapes.js';

/** Does a Glimmermoss with this meta have its wall? (a solid, opaque block on its side) */
export function mossSupported(getBlock, x, y, z, meta) {
  const [dx, , dz] = SIDE_DIRS[meta & 3];
  const wall = getBlock(x + dx, y, z + dz);
  return !!(SOLID[wall] && OPAQUE[wall]);
}

const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * Every place Bone Meal on the moss at (x, y, z) could grow a new one: a free (air) cell beside it with a wall on one of its sides.
 * [{ x, y, z, meta }]; `getBlock` is the world's accessor.
 */
export function spreadSpots(getBlock, x, y, z) {
  const out = [];
  for (const [ox, oy, oz] of NEIGHBOURS) {
    const nx = x + ox, ny = y + oy, nz = z + oz;
    if (getBlock(nx, ny, nz) !== B.AIR) continue;
    for (let s = 0; s < 4; s++) if (mossSupported(getBlock, nx, ny, nz, s)) { out.push({ x: nx, y: ny, z: nz, meta: s }); break; }
  }
  return out;
}

/** Pick one spread spot with a random number in [0, 1), or null when there is none. */
export function pickSpread(spots, r) {
  return spots.length ? spots[Math.min(spots.length - 1, Math.floor(r * spots.length))] : null;
}
