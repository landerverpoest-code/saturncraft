// Hushvine (reference: chorus plant) on the Hollow's outer islands: knotty
// stalks that branch upwards from Hollowstone and end in pale Hushvine
// Flowers. Breaking a stalk brings down everything it holds up. Stalks drop
// Hushfruit (0-1), which teleports whoever eats it up to 8 blocks away.
// Flowers (meta = age 0..5, 5 = finished) grow on random ticks: up a block
// while young, then split into up to four side branches, and finally wither.
// Pure logic (unit tested) plus the random-tick growth used by the game.
import { B, SOLID } from '../blocks.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const HUSH_MAX_AGE = 5;
export const HUSH_MAX_DIST = 8; // branches stay within this many blocks of the root

/**
 * Can a Hushvine stalk stay at (x, y, z)? On Hollowstone or another stalk, or
 * held sideways by a stalk that itself stands on something (reference rules).
 */
export function hushvineSupported(getBlock, x, y, z) {
  const below = getBlock(x, y - 1, z);
  const boxedIn = !!getBlock(x, y + 1, z) && !!below; // something above and below: side branches cannot hold it
  for (const [dx, dz] of DIRS) {
    if (getBlock(x + dx, y, z + dz) !== B.HUSHVINE) continue;
    if (boxedIn) return false;
    const under = getBlock(x + dx, y - 1, z + dz);
    if (under === B.HUSHVINE || under === B.HOLLOWSTONE) return true;
  }
  return below === B.HUSHVINE || below === B.HOLLOWSTONE;
}

/** Can a flower stay: on a stalk or Hollowstone, or at the end of a single side branch over air. */
export function hushFlowerSupported(getBlock, x, y, z) {
  const below = getBlock(x, y - 1, z);
  if (below === B.HUSHVINE || below === B.HOLLOWSTONE) return true;
  if (below) return false;
  let n = 0;
  for (const [dx, dz] of DIRS) { const id = getBlock(x + dx, y, z + dz); if (id === B.HUSHVINE) n++; else if (id) return false; }
  return n === 1;
}

/**
 * Grow a whole plant from (x, y, z) (the bottom stalk) like world generation does:
 * stalks up 1-4 (2-5 at the root), up to 4 branches per knot, four levels deep, flowers at the tips.
 * `set(x, y, z, id, meta)` writes, `free(x, y, z)` tells whether a cell is empty.
 */
export function growHushvinePlant(set, free, rng, x, y, z, maxDist = HUSH_MAX_DIST) {
  set(x, y, z, B.HUSHVINE, 0);
  branch(set, free, rng, x, y, z, x, z, maxDist, 0);
}

/** Are the horizontal neighbours of a cell empty (but the one at `except`)? */
const lonelyCell = (free, x, y, z, ex = 0, ez = 0) => DIRS.every(([dx, dz]) => (dx === ex && dz === ez && (ex || ez)) || free(x + dx, y, z + dz));

function branch(set, free, rng, x, y, z, ox, oz, maxDist, depth) {
  let h = 1 + Math.floor(rng() * 4);
  if (depth === 0) h++;
  for (let i = 1; i <= h; i++) {
    if (!free(x, y + i, z) || !lonelyCell(free, x, y + i, z)) return; // stalks never grow alongside others
    set(x, y + i, z, B.HUSHVINE, 0);
  }
  const top = y + h;
  let branched = false;
  if (depth < 4) {
    let n = Math.floor(rng() * 4);
    if (depth === 0) n++;
    for (let j = 0; j < n; j++) {
      const [dx, dz] = DIRS[Math.floor(rng() * 4)];
      const nx = x + dx, nz = z + dz;
      if (Math.abs(nx - ox) >= maxDist || Math.abs(nz - oz) >= maxDist) continue;
      if (!free(nx, top, nz) || !free(nx, top - 1, nz) || !lonelyCell(free, nx, top, nz, -dx, -dz)) continue;
      set(nx, top, nz, B.HUSHVINE, 0);
      branch(set, free, rng, nx, top, nz, ox, oz, maxDist, depth + 1);
      branched = true;
    }
  }
  if (!branched && free(x, top + 1, z)) set(x, top + 1, z, B.HUSHVINE_FLOWER, HUSH_MAX_AGE);
}

/**
 * A random tick of a Hushvine Flower (reference ChorusFlowerBlock, simplified):
 * a young flower over a short stalk grows up a block; otherwise it tries to
 * split into 1-4 side flowers (age + 1); if it cannot, it withers (age 5).
 * `w` has getBlock / getMeta / setBlock. Returns true if anything changed.
 */
export function tickHushFlower(w, x, y, z, rng = Math.random) {
  const age = w.getMeta(x, y, z);
  if (age >= HUSH_MAX_AGE || w.getBlock(x, y + 1, z) || y >= 250) return false;
  // height of the stalk below (stalks only, to the ground)
  let stalk = 0;
  for (let k = 1; k < 6 && w.getBlock(x, y - k, z) === B.HUSHVINE; k++) stalk++;
  const onGround = w.getBlock(x, y - stalk - 1, z) === B.HOLLOWSTONE;
  const lonely = (cx, cy, cz) => DIRS.every(([dx, dz]) => !w.getBlock(cx + dx, cy, cz + dz) || (cx + dx === x && cz + dz === z));
  const up = stalk < 2 || (stalk < (onGround ? 5 : 4) && rng() < 0.5);
  if (up && !w.getBlock(x, y + 2, z) && lonely(x, y + 1, z)) {
    w.setBlock(x, y, z, B.HUSHVINE, 0);
    w.setBlock(x, y + 1, z, B.HUSHVINE_FLOWER, age);
    return true;
  }
  if (age < 4) {
    let n = 1 + Math.floor(rng() * 4), grown = 0;
    for (let k = 0; k < n; k++) {
      const [dx, dz] = DIRS[Math.floor(rng() * 4)];
      const nx = x + dx, nz = z + dz;
      if (w.getBlock(nx, y, nz) || w.getBlock(nx, y - 1, nz) || !lonely(nx, y, nz)) continue;
      w.setBlock(nx, y, nz, B.HUSHVINE_FLOWER, age + 1);
      grown++;
    }
    if (grown) { w.setBlock(x, y, z, B.HUSHVINE, 0); return true; }
  }
  w.setBlock(x, y, z, B.HUSHVINE_FLOWER, HUSH_MAX_AGE);
  return true;
}

/**
 * Where eating a Hushfruit sends you: up to 16 tries at a random spot within
 * 8 blocks horizontally and vertically with solid ground and room to stand
 * (reference). Returns {x, y, z} (feet) or null.
 */
export function hushfruitTeleport(getBlock, x, y, z, rng = Math.random, minY = 0) {
  for (let k = 0; k < 16; k++) {
    const tx = Math.floor(x + (rng() - 0.5) * 16), tz = Math.floor(z + (rng() - 0.5) * 16);
    let ty = Math.max(minY + 1, Math.floor(y + (rng() - 0.5) * 16));
    // fall down to the ground
    let n = 0;
    while (ty > minY + 1 && !SOLID[getBlock(tx, ty - 1, tz)] && n++ < 16) ty--;
    if (!SOLID[getBlock(tx, ty - 1, tz)] || SOLID[getBlock(tx, ty, tz)] || SOLID[getBlock(tx, ty + 1, tz)]) continue;
    return { x: tx + 0.5, y: ty, z: tz + 0.5 };
  }
  return null;
}
