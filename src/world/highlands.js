// Highland Meadows: the green pastures that sit between the tree line and the bare summits, on the
// milder mountain flanks. Where a stream would run off a slope there, a Cascade is stamped: a spring
// block in the ground and a ribbon of falling and flowing water down the hill to a pool.
// Everything is decided from the seed and the chunk's own columns, so a chunk never needs its
// neighbours (cascades stay inside the chunk they start in) and generating twice gives the same chunk.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { cidx } from './constants.js';
import { PLANTS } from './trees.js';

/** Mountain flank band (surface height) where meadows replace the grassy and bare peaks. */
export const MEADOW_MIN_TOP = 105;
export const MEADOW_MAX_TOP = 140;
/** Minimum climate temperature (already cooled by height) for grass to hold. */
export const MEADOW_MIN_TEMP = 0.5;

/** Is a column (its climate `col` from TerrainGenerator.column, surface height `top`) a Highland Meadow? */
export function isMeadow(col, top) {
  return col.mountain > 0.3 && top > MEADOW_MIN_TOP && top <= MEADOW_MAX_TOP && col.temp >= MEADOW_MIN_TEMP && col.meadow > 0;
}

export const CASCADE_MIN_DROP = 7;   // the water must fall at least this far in all
export const CASCADE_MIN_LEN = 3;    // and run over at least this many columns below the spring
export const CASCADE_MAX_LEN = 40;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * The course of a stream from a spring at chunk column (lx, lz): the spring needs exactly one lower
 * neighbour (the others at least as high, so the water has only one way to go), then the stream
 * always steps to the lowest unvisited neighbour until it reaches a hollow. Returns the columns
 * [{x, z, top}] (spring first) or null when it is too short, too flat or would leave the chunk.
 */
export function cascadeCourse(heightmap, lx, lz) {
  const at = (x, z) => heightmap[x + z * 16];
  const t0 = at(lx, lz);
  let lower = 0;
  for (const [dx, dz] of DIRS) {
    const t = at(lx + dx, lz + dz);
    if (t < t0) lower++;
  }
  if (lower !== 1) return null;
  const path = [{ x: lx, z: lz, top: t0 }], seen = new Set([lx + lz * 16]);
  for (let step = 0; step < CASCADE_MAX_LEN; step++) {
    const cur = path[path.length - 1];
    let best = null;
    for (const [dx, dz] of DIRS) {
      const x = cur.x + dx, z = cur.z + dz;
      if (seen.has(x + z * 16)) continue;
      const t = at(x, z);
      if (!best || t < best.top) best = { x, z, top: t };
    }
    if (!best || best.top >= cur.top) break; // a hollow: the stream ends in a pool here
    // never run along the very edge of the chunk, where the next column cannot be seen (columns 1..14 only)
    if (best.x < 1 || best.z < 1 || best.x > 14 || best.z > 14) return null;
    seen.add(best.x + best.z * 16);
    path.push(best);
  }
  const drop = t0 - path[path.length - 1].top;
  if (drop < CASCADE_MIN_DROP || path.length - 1 < CASCADE_MIN_LEN) return null;
  return path;
}

const CELL_OK = new Set([B.AIR, ...PLANTS, B.SNOW_LAYER]);

/** The water cells of a course: [x, y, z, meta] (the spring is meta 0, flowing 1, falling 8). */
export function cascadeCells(path) {
  const cells = [[path[0].x, path[0].top, path[0].z, 0]];
  for (let k = 1; k < path.length; k++) {
    const p = path[k], from = path[k - 1].top;
    for (let y = p.top + 1; y <= from; y++) cells.push([p.x, y, p.z, y === from ? 1 : 8]);
  }
  return cells;
}

/**
 * Stamp at most one Cascade into a freshly decorated chunk: the most falling course found from
 * any spring column of the meadow (first one in a hashed scan order wins a tie). Returns the number
 * of water cells placed (0 when the chunk has no meadow or no slope fit for a stream).
 */
export function stampCascades(seed, blocks, meta, biomes, heightmap, cx, cz) {
  let meadow = 0;
  for (let i = 0; i < 256; i++) if (biomes[i] === BIOME.HIGHLAND_MEADOW) meadow++;
  if (meadow < 24) return 0;
  const start = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ seed) >>> 0;
  let best = null, bestDrop = 0;
  for (let n = 0; n < 144; n++) {
    const k = (n + start) % 144, lx = 2 + (k % 12), lz = 2 + Math.floor(k / 12);
    if (biomes[lx + lz * 16] !== BIOME.HIGHLAND_MEADOW) continue;
    const path = cascadeCourse(heightmap, lx, lz);
    if (!path) continue;
    const cells = cascadeCells(path);
    // true falls count three times over a gentle run
    const drop = path[0].top - path[path.length - 1].top + 3 * cells.filter((c) => c[3] === 8).length;
    if (drop <= bestDrop) continue;
    // the way must be free (no tree in it) and the ground under it dry and solid
    let ok = true;
    for (const [x, y, z] of cells) {
      const cur = blocks[cidx(x, y, z)];
      if (!(y === path[0].top && x === path[0].x && z === path[0].z ? !!cur && cur !== B.WATER && cur !== B.LAVA : CELL_OK.has(cur))) { ok = false; break; }
    }
    if (!ok) continue;
    best = cells; bestDrop = drop;
  }
  if (!best) return 0;
  for (const [x, y, z, m] of best) {
    const i = cidx(x, y, z);
    blocks[i] = B.WATER; meta[i] = m;
  }
  // the spring is open to the sky: clear whatever grows right on it
  const [sx, sy, sz] = best[0];
  if (PLANTS.has(blocks[cidx(sx, sy + 1, sz)]) || blocks[cidx(sx, sy + 1, sz)] === B.SNOW_LAYER) blocks[cidx(sx, sy + 1, sz)] = B.AIR;
  return best.length;
}
