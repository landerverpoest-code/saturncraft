// Snare lines: two Snare Posts looking at each other with Snare Cord between them (the tripline of the reference game's
// tripwire hooks). Pure rules; the simulation is in world/circuits.js.
//
// * A line runs along one horizontal axis at one height: post, 1 to 39 cords, post, the posts facing each other.
//   A post whose line is complete is "tied" (meta bit 2).
// * Anything that stands in a cord's block (the player, mobs, items, carts) trips the line: both posts send power
//   (15 weakly all round and strongly into the block each hangs on) for as long as it is touched, and for at least
//   SNARE_HOLD ticks after the last touch. A line that is cut (a cord or a post removed) goes quiet and its remaining
//   post is no longer tied.
import { B } from './blocks.js';
import { SIDE_DIRS } from './shapes.js';

export const SNARE_RANGE = 40;   // longest line, post to post (blocks apart)
export const SNARE_HOLD = 10;    // ticks a tripped line keeps sending after the last touch

/**
 * The line a post at x,y,z looking along side `s` (SIDE_DIRS index) belongs to:
 * { ok, other: [x,y,z] | null, cords: [[x,y,z]...] }. `ok` = a post looking back closes it within range.
 */
export function snareLine(w, x, y, z, s) {
  const [dx, , dz] = SIDE_DIRS[s & 3], cords = [];
  for (let i = 1; i <= SNARE_RANGE; i++) {
    const px = x + dx * i, pz = z + dz * i;
    if (w.isLoaded && !w.isLoaded(px, pz)) return { ok: false, other: null, cords };
    const id = w.getBlock(px, y, pz);
    if (id === B.SNARE_CORD) { cords.push([px, y, pz]); continue; }
    if (id === B.SNARE_POST && i >= 2 && (w.getMeta(px, y, pz) & 3) === ((s + 2) & 3)) return { ok: true, other: [px, y, pz], cords };
    return { ok: false, other: null, cords };
  }
  return { ok: false, other: null, cords };
}

/**
 * Posts that look along a line through the cell x,y,z (a cord or post that just changed), as [x, y, z, side]:
 * each is found by walking away from the cell over cords until something else is met.
 */
export function snarePostsThrough(w, x, y, z) {
  const out = [];
  for (let s = 0; s < 4; s++) {
    const [dx, , dz] = SIDE_DIRS[s];
    for (let i = 1; i <= SNARE_RANGE; i++) {
      const px = x + dx * i, pz = z + dz * i;
      if (w.isLoaded && !w.isLoaded(px, pz)) break;
      const id = w.getBlock(px, y, pz);
      if (id === B.SNARE_CORD) continue;
      if (id === B.SNARE_POST && (w.getMeta(px, y, pz) & 3) === ((s + 2) & 3)) out.push([px, y, pz, (s + 2) & 3]);
      break;
    }
  }
  return out;
}
