// Scaffolding: a frame of bamboo that is only solid on top (and not to someone
// sneaking), climbed from inside like a ladder. Each block keeps in its meta
// how far it is (0-6) from a column standing on the ground; past 6 it breaks,
// so taking out the bottom of a tower brings it all down, a block a tick.
import { BLOCKS, SOLID } from './blocks.js';

export const SCAFFOLD_MAX = 6;

/** Distance of the cell from a supported column: that of the scaffold below, 0 on solid ground, else the nearest neighbour's + 1 (7 = unsupported). */
export function scaffoldDistance(w, x, y, z) {
  const below = w.getBlock(x, y - 1, z);
  if (BLOCKS[below] && BLOCKS[below].scaffold) return w.getMeta(x, y - 1, z) & 7;
  if (SOLID[below]) return 0;
  let d = SCAFFOLD_MAX + 1;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = w.getBlock(x + dx, y, z + dz);
    if (BLOCKS[n] && BLOCKS[n].scaffold) d = Math.min(d, (w.getMeta(x + dx, y, z + dz) & 7) + 1);
  }
  return d;
}

/** Scheduled tick after a neighbour changed: take the new distance, or break once it is too far. */
export function scaffoldTick(w, x, y, z) {
  const id = w.getBlock(x, y, z), d = scaffoldDistance(w, x, y, z);
  if (d > SCAFFOLD_MAX) { w.breakBlock(x, y, z, true); return; }
  if (d !== (w.getMeta(x, y, z) & 7)) w.setBlock(x, y, z, id, d);
}

/** The cell a scaffold placed against scaffolding at (x, y, z) goes to: the top of that column (up to 32 high), or null. */
export function scaffoldColumnTop(w, x, y, z) {
  for (let k = 1; k <= 32; k++) {
    const id = w.getBlock(x, y + k, z);
    if (BLOCKS[id] && BLOCKS[id].scaffold) continue;
    return id === 0 || (BLOCKS[id] && BLOCKS[id].replaceable) ? [x, y + k, z] : null;
  }
  return null;
}
