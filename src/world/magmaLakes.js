// Magma Lakes: deep, domed caverns floored with a lake of lava, with islands of smooth basalt
// standing in it. One candidate per 128 x 128 block region of the overworld, decided from the seed
// alone, far enough from the region's edge that no lake ever crosses into the next one, so a chunk
// only needs the lake of its own region. Everything about a column (is it in the lake, how deep,
// is it an island) is a function of its world position, so chunks agree along their borders.
// The lake is carved into whatever is there (caves included); where the lava would touch open
// air at the foot of a cave wall outside the lake, the wall is sealed with smooth basalt.
import { B } from './blocks.js';
import { Simplex, hash4, hashf } from './noise.js';
import { MIN_Y, cidx } from './constants.js';

export const LAKE_REGION = 128;
export const LAKE_CHANCE = 0.45;
const LAKE_MIN_Y = MIN_Y + 6;

const noises = new Map();
function noiseFor(seed) {
  let n = noises.get(seed);
  if (!n) { n = new Simplex(hash4(seed, 34, 911, 3)); noises.set(seed, n); }
  return n;
}

/** The lake candidate of region (rx, rz): { x, z, r, y, h } (centre, radius, lava level, dome height) or null. */
export function lakeIn(seed, rx, rz) {
  const h = (k) => hashf(seed, rx, rz, 8100 + k);
  if (h(0) >= LAKE_CHANCE) return null;
  return {
    x: rx * LAKE_REGION + 40 + Math.floor(h(1) * 48), z: rz * LAKE_REGION + 40 + Math.floor(h(2) * 48),
    r: 14 + Math.floor(h(3) * 13),   // 14 - 26
    y: -48 + Math.floor(h(4) * 36),  // lava level -48 .. -13
    h: 8 + Math.floor(h(5) * 9),     // dome 8 - 16 above the lava
  };
}

/** Distance of column (wx, wz) from the lake's centre in lake radii (a wobbling edge); under 1 is inside. */
export function lakeDist(seed, lake, wx, wz) {
  return Math.hypot(wx + 0.5 - lake.x, wz + 0.5 - lake.z) / lake.r + noiseFor(seed).noise2(wx / 11, wz / 11) * 0.2;
}

/** A basalt island stands in the lake at this column. */
export function isIsland(seed, d, wx, wz) { return d < 0.82 && noiseFor(seed).noise2(wx / 7 + 90, wz / 7 - 40) > 0.5; }

/** Lowest lava cell of an inside column (the lake bed is deepest in the middle: 6 blocks down, 1 at the shore). */
export function lakeFloor(lake, d) { return Math.max(LAKE_MIN_Y, lake.y - 1 - Math.round(5 * (1 - d * d))); }
/** Air above the lava at an inside column. */
export function domeHeight(lake, d) { return Math.max(2, Math.floor(lake.h * Math.sqrt(Math.max(0, 1 - d * d)))); }

const SOFT = (id) => id === B.AIR || id === B.WATER || id === B.LAVA;

/** Stamp the part of this region's lake that lies in chunk (cx, cz). Returns the number of lava blocks placed. */
export function stampMagmaLakes(seed, blocks, meta, cx, cz) {
  const lake = lakeIn(seed, Math.floor(cx / (LAKE_REGION / 16)), Math.floor(cz / (LAKE_REGION / 16)));
  if (!lake) return 0;
  const x0 = cx * 16, z0 = cz * 16, reach = lake.r * 1.2 + 3;
  if (x0 + 16 < lake.x - reach || x0 > lake.x + reach || z0 + 16 < lake.z - reach || z0 > lake.z + reach) return 0;
  let lava = 0;
  for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    const wx = x0 + lx, wz = z0 + lz;
    if (Math.abs(wx - lake.x) > reach || Math.abs(wz - lake.z) > reach) continue;
    const d = lakeDist(seed, lake, wx, wz);
    if (d < 1) {
      const floor = lakeFloor(lake, d), top = lake.y + domeHeight(lake, d), island = isIsland(seed, d, wx, wz);
      for (let y = floor; y <= top; y++) {
        const i = cidx(lx, y, lz);
        if (blocks[i] === B.BEDROCK) continue;
        meta[i] = 0;
        if (y <= lake.y + (island ? 1 : 0)) {
          blocks[i] = island ? B.SMOOTH_BASALT : B.LAVA;
          if (!island) lava++;
        } else blocks[i] = B.AIR;
      }
      // a sealed bed, and sealed walls where the bed is shallower than its neighbour's: no hole for the lava to drain into
      let low = floor;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nd = lakeDist(seed, lake, wx + dx, wz + dz);
        if (nd < 1) low = Math.min(low, lakeFloor(lake, nd));
      }
      for (let y = Math.min(low, floor - 1); y < floor; y++) {
        const i = cidx(lx, y, lz);
        if (y > MIN_Y && SOFT(blocks[i])) { blocks[i] = B.SMOOTH_BASALT; meta[i] = 0; }
      }
    } else if (d < 1 + 3 / lake.r) {
      // just outside: wherever a neighbouring lake column has lava at this height, open air gets a basalt wall
      let low = Infinity;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nd = lakeDist(seed, lake, wx + dx, wz + dz);
        if (nd < 1) low = Math.min(low, lakeFloor(lake, nd));
      }
      if (low === Infinity) continue;
      for (let y = low; y <= lake.y; y++) {
        const i = cidx(lx, y, lz);
        if (SOFT(blocks[i])) { blocks[i] = B.SMOOTH_BASALT; meta[i] = 0; }
      }
    }
  }
  return lava;
}
