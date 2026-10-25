// Swamp huts: a small spruce cabin on oak stilts in swamps, home of a Hexwife
// (the reference game's witch hut). At most one per 320 x 320-block region:
// a few spots of the region are tried and the first one in a swamp is used.
// Planned from the seed alone; each chunk stamps its own part (like temples.js).
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { MIN_Y, WORLD_HEIGHT, SEA_LEVEL, cidx } from './constants.js';
import { mulberry32, hash4 } from './noise.js';

export const HUT_REGION = 320;
const TRIES = 10;
const cache = new Map();

/** The hut of region (rx, rz) or null: { cx, cz, y (floor level), x0, z0, x1, z1, y0, y1 (bounding box) }. */
export function hutInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 9191));
  let h = null;
  const R = HUT_REGION, M = 16;
  for (let k = 0; k < TRIES && !h; k++) {
    const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
    const col = gen.column(cx, cz), top = gen.surfaceAt(cx, cz, col);
    if (gen.biomeFor(col, top) !== BIOME.SWAMP) continue;
    if (gen.riverInBox && gen.riverInBox(cx - 4, cz - 5, cx + 4, cz + 5)) continue; // rivers wind through some swamps
    const y = Math.max(top, SEA_LEVEL) + 3; // the floor, on stilts above the water
    h = { cx, cz, y, x0: cx - 3, x1: cx + 3, z0: cz - 4, z1: cz + 4, y0: y, y1: y + 5 };
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, h);
  return h;
}

export function hutsNear(gen, x0, z0, x1, z1) {
  const out = [], R = HUT_REGION;
  for (let rx = Math.floor((x0 - 5) / R); rx <= Math.floor((x1 + 5) / R); rx++) for (let rz = Math.floor((z0 - 5) / R); rz <= Math.floor((z1 + 5) / R); rz++) {
    const h = hutInRegion(gen, rx, rz);
    if (h && h.x1 + 1 >= x0 && h.x0 - 1 <= x1 && h.z1 + 1 >= z0 && h.z0 - 1 <= z1) out.push(h);
  }
  return out;
}

/** The hut whose box holds block (x, y, z), if any (for the structure spawn list). */
export function hutAt(gen, x, y, z) {
  for (const h of hutsNear(gen, x, z, x, z)) if (x >= h.x0 && x <= h.x1 && z >= h.z0 && z <= h.z1 && y >= h.y0 && y <= h.y1) return h;
  return null;
}

/**
 * Stamp the parts of nearby huts inside chunk (cx, cz): a 7 x 9 spruce floor
 * with a porch, oak log stilts down to the ground, plank walls with oak log
 * corners and fence windows, a stepped roof and a workbench inside.
 */
export function stampHuts(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  for (const h of hutsNear(gen, X0, Z0, X0 + 15, Z0 + 15)) {
    const inChunk = (x, z) => x >= X0 && x < X0 + 16 && z >= Z0 && z < Z0 + 16;
    const set = (x, y, z, id, m = 0) => {
      if (!inChunk(x, z) || y <= MIN_Y || y >= MIN_Y + WORLD_HEIGHT) return;
      const i = cidx(x - X0, y, z - Z0); blocks[i] = id; meta[i] = m;
    };
    const get = (x, y, z) => blocks[cidx(x - X0, y, z - Z0)];
    const { cx: hx, cz: hz, y } = h;
    const F = y - 1; // floor layer
    // clear the space and lay the floor (porch on the -z side)
    for (let x = h.x0 - 1; x <= h.x1 + 1; x++) for (let z = h.z0 - 1; z <= h.z1 + 1; z++) {
      for (let yy = F; yy <= y + 6; yy++) set(x, yy, z, B.AIR);
      if (x >= h.x0 && x <= h.x1 && z >= h.z0 && z <= h.z1) set(x, F, z, B.SPRUCE_PLANKS);
    }
    // stilts under the four corners and the middle of the long sides, down to the ground
    for (const [x, z] of [[h.x0, h.z0], [h.x1, h.z0], [h.x0, h.z1], [h.x1, h.z1], [h.x0, hz], [h.x1, hz]]) {
      if (!inChunk(x, z)) continue;
      for (let yy = F - 1, n = 0; yy > MIN_Y + 1 && n < 14; yy--, n++) {
        const id = get(x, yy, z);
        if (id && id !== B.WATER && id !== B.TALL_GRASS && id !== B.LILY_PAD && id !== B.VINES) break;
        set(x, yy, z, B.OAK_LOG);
      }
    }
    // the room: z0 + 2 .. z1, walls three blocks high
    const rz0 = h.z0 + 2;
    for (let x = h.x0; x <= h.x1; x++) for (let z = rz0; z <= h.z1; z++) {
      const ex = x === h.x0 || x === h.x1, ez = z === rz0 || z === h.z1;
      if (!ex && !ez) continue;
      for (let yy = y; yy < y + 3; yy++) {
        let id = ex && ez ? B.OAK_LOG : B.SPRUCE_PLANKS;
        if (yy === y + 1 && !(ex && ez) && ((ex && z === hz + 1) || (ez && z === h.z1 && x === hx))) id = B.OAK_FENCE; // windows
        set(x, yy, z, id);
      }
    }
    // door opening in the front wall, fence posts at the porch corners
    set(hx, y, rz0, B.AIR); set(hx, y + 1, rz0, B.AIR);
    for (const x of [h.x0, h.x1]) { set(x, y, h.z0, B.OAK_FENCE); set(x, y + 1, h.z0, B.OAK_FENCE); set(x, y + 2, h.z0, B.OAK_FENCE); }
    // stepped roof over room and porch
    for (let x = h.x0 - 1; x <= h.x1 + 1; x++) for (let z = h.z0 - 1; z <= h.z1 + 1; z++) set(x, y + 3, z, B.SPRUCE_PLANKS);
    for (let x = h.x0; x <= h.x1; x++) for (let z = h.z0; z <= h.z1; z++) if (Math.abs(x - hx) <= 2) set(x, y + 4, z, B.SPRUCE_PLANKS);
    for (let z = h.z0 + 1; z <= h.z1 - 1; z++) set(hx, y + 5, z, B.SPRUCE_PLANKS);
    // the Hexwife's workbench in the back corner
    set(h.x1 - 1, y, h.z1 - 1, B.WORKBENCH);
  }
}
