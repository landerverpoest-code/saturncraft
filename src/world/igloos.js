// Igloos: a snow-block dome in snowy plains and snowy taiga, at most one per
// 160 x 160-block region (a few spots of the region are tried; the first one
// on fairly level snowy ground away from villages and other structures wins).
// Inside: a bed, a workbench, a furnace, a torch and a wool rug. Half of them
// hide a trapdoor under the rug's corner with a ladder shaft down to a
// stone-brick basement: a loot chest, a Brewing Alembic, a lantern and a
// fenced-off cell holding a captive settler. Planned from the seed alone;
// each chunk stamps the part that falls inside it (like swampHuts.js).
import { B, BLOCKS, SOLID, BLOCK_LIMIT } from './blocks.js';
import { BIOME } from './biomes.js';
import { MIN_Y, WORLD_HEIGHT, SEA_LEVEL, cidx } from './constants.js';
import { mulberry32, hash4, hashf } from './noise.js';
import { TRAPDOOR_TOP, BED_HEAD } from './shapes.js';
import { villagesNear } from './villages.js';
import { templesNear, outpostsNear } from './temples.js';
import { hutsNear } from './swampHuts.js';
import { ruinsNear } from './ruinedPortals.js';

export const IGLOO_REGION = 160;
export const IGLOO_LOOT = 4; // loot kind of the basement chest (mobs/spawnerBlocks.js LOOT.IGLOO)
export const IGLOO_BIOMES = [BIOME.SNOWY_PLAINS, BIOME.SNOWY_TAIGA];
const TRIES = 10;
const cache = new Map();
const TREE_PART = new Uint8Array(BLOCK_LIMIT);
for (const d of BLOCKS) if (d && /( Log| Leaves|Mushroom Block|Mushroom Stem|Vines|Cocoa)/.test(d.name)) TREE_PART[d.id] = 1;

/** Footprint of an igloo centred on (cx, cz), padded by `pad`. */
const box = (cx, cz, pad = 0) => ({ x0: cx - 6 - pad, x1: cx + 6 + pad, z0: cz - 7 - pad, z1: cz + 6 + pad });
const overlaps = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0;

/** True when another structure (village, temple, outpost, hut or ruined rift) claims the ground near (cx, cz). */
function crowded(gen, cx, cz) {
  const b = box(cx, cz, 8);
  if (villagesNear(gen, b.x0, b.z0, b.x1, b.z1).length) return true;
  if (templesNear(gen, b.x0, b.z0, b.x1, b.z1).length) return true;
  if (hutsNear(gen, b.x0, b.z0, b.x1, b.z1).length) return true;
  if (outpostsNear(gen, b.x0, b.z0, b.x1, b.z1).length) return true;
  return ruinsNear(gen, b.x0, b.z0, b.x1, b.z1).length > 0;
}

/**
 * The igloo of region (rx, rz) or null:
 * { cx, cz, y (floor level), basement, depth (shaft length), seed, x0, z0, x1, z1, y0, y1 }.
 */
export function iglooInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 8383));
  let g = null;
  const R = IGLOO_REGION, M = 16;
  for (let k = 0; k < TRIES && !g; k++) {
    const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
    const basement = rng() < 0.5, depth = 3 + Math.floor(rng() * 6), seed = Math.floor(rng() * 1e9);
    const col = gen.column(cx, cz), top = gen.surfaceAt(cx, cz, col);
    if (top <= SEA_LEVEL || !IGLOO_BIOMES.includes(gen.biomeFor(col, top))) continue;
    if (![[-4, -4], [4, -4], [-4, 4], [4, 4]].every(([dx, dz]) => Math.abs(gen.surfaceAt(cx + dx, cz + dz) - top) <= 2)) continue;
    if (crowded(gen, cx, cz)) continue;
    if (gen.riverInBox && gen.riverInBox(cx - 5, cz - 5, cx + 5, cz + 5)) continue; // not on a river bank
    const y = top + 1;
    g = { cx, cz, y, basement, depth, seed, ...box(cx, cz), y0: basement ? y - 2 - depth - 5 : y - 1, y1: y + 5 };
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, g);
  return g;
}

export function igloosNear(gen, x0, z0, x1, z1) {
  const out = [], R = IGLOO_REGION;
  for (let rx = Math.floor((x0 - 8) / R); rx <= Math.floor((x1 + 8) / R); rx++) for (let rz = Math.floor((z0 - 8) / R); rz <= Math.floor((z1 + 8) / R); rz++) {
    const g = iglooInRegion(gen, rx, rz);
    if (g && g.x1 >= x0 && g.x0 <= x1 && g.z1 >= z0 && g.z0 <= z1) out.push(g);
  }
  return out;
}

/** Where the basement's parts sit (all derived from the igloo). */
export function basementLayout(g) {
  const { cx, cz, y, depth } = g;
  const bf = y - 2 - depth - 3; // basement floor level (feet)
  return {
    bf,
    hatch: { x: cx, y: y - 1, z: cz + 2 },           // trapdoor in the floor under the rug's corner
    chest: { x: cx + 3, y: bf, z: cz },
    brewing: { x: cx + 3, y: bf, z: cz - 2 },
    cell: { x: cx - 2, y: bf, z: cz - 4 },            // the captive settler stands here
  };
}

/** Stamp the parts of nearby igloos inside chunk (cx, cz). */
export function stampIgloos(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  for (const g of igloosNear(gen, X0, Z0, X0 + 15, Z0 + 15)) {
    const set = (x, y, z, id, m = 0) => {
      if (x < X0 || x >= X0 + 16 || z < Z0 || z >= Z0 + 16 || y <= MIN_Y || y >= MIN_Y + WORLD_HEIGHT) return;
      const i = cidx(x - X0, y, z - Z0); blocks[i] = id; meta[i] = m;
    };
    const get = (x, y, z) => (x < X0 || x >= X0 + 16 || z < Z0 || z >= Z0 + 16 || y <= MIN_Y || y >= MIN_Y + WORLD_HEIGHT ? -1 : blocks[cidx(x - X0, y, z - Z0)]);
    buildIgloo(g, set, get);
  }
}

/**
 * Build igloo `g` through set(x, y, z, id, meta) (world coordinates; set clips to its chunk).
 * With get(x, y, z) (-1 outside the chunk) it also clears trees and plants around the dome
 * and packs snow under the floor where the ground dips.
 */
export function buildIgloo(g, set, get = null) {
  const { cx, cz, y } = g;
  if (get) {
    for (let x = cx - 6; x <= cx + 6; x++) for (let z = cz - 7; z <= cz + 6; z++) for (let yy = y - 1; yy < y + 22; yy++) {
      const id = get(x, yy, z);
      if (id <= 0) continue;
      const loose = id === B.SNOW_LAYER ? get(x, yy - 1, z) === 0 : !SOLID[id] && id !== B.WATER; // plants; snow left hanging on cleared leaves
      if (TREE_PART[id] || loose) set(x, yy, z, 0);
    }
    for (let x = cx - 4; x <= cx + 4; x++) for (let z = cz - 6; z <= cz + 4; z++) {
      if (Math.hypot(x - cx, z - cz) > 4.2 && !(Math.abs(x - cx) <= 1 && z < cz)) continue;
      for (let yy = y - 2; yy > y - 8; yy--) { const id = get(x, yy, z); if (id < 0 || (SOLID[id] && !TREE_PART[id])) break; set(x, yy, z, B.SNOW_BLOCK); }
    }
  }
  // the dome: a hollow half-sphere of snow on a snow floor
  for (let x = cx - 4; x <= cx + 4; x++) for (let z = cz - 4; z <= cz + 4; z++) for (let yy = y - 1; yy < y + 5; yy++) {
    const d = Math.hypot((x - cx) / 4.2, (yy - y + 0.5) / 4.2, (z - cz) / 4.2);
    if (yy === y - 1 && d < 1) set(x, yy, z, B.SNOW_BLOCK);
    else if (d < 1 && d > 0.72) set(x, yy, z, B.SNOW_BLOCK);
    else if (d <= 0.72) set(x, yy, z, 0);
  }
  // the entrance tunnel on the -z side with an ice window above it
  for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 6; z <= cz - 4; z++) {
    if (x !== cx) { for (let yy = y; yy < y + 2; yy++) set(x, yy, z, B.SNOW_BLOCK); set(x, y - 1, z, B.SNOW_BLOCK); }
    else { set(x, y - 1, z, B.SNOW_BLOCK); set(x, y, z, 0); set(x, y + 1, z, 0); }
    set(x, y + 2, z, B.SNOW_BLOCK);
  }
  set(cx, y, cz - 3, 0); set(cx, y + 1, cz - 3, 0); // through the dome wall
  set(cx, y + 2, cz - 4, B.ICE);
  // furnishings: a wool rug, a bed, a workbench, a furnace and a torch
  for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) set(x, y - 1, z, B.WOOL, 14);
  set(cx - 2, y, cz + 1, B.BED, 0 | BED_HEAD); set(cx - 2, y, cz + 2, B.BED, 0);
  set(cx + 2, y, cz + 1, B.WORKBENCH);
  set(cx + 2, y, cz - 1, B.FURNACE, 3);
  set(cx - 2, y, cz - 1, B.TORCH, 0);
  if (g.basement) buildBasement(g, set);
}

function buildBasement(g, set) {
  const { cx, cz, y, seed } = g;
  const L = basementLayout(g), bf = L.bf;
  const brick = (x, yy, z) => {
    const r = hashf(seed, x * 31 + yy, z, 3);
    return r < 0.18 ? B.MOSSY_STONE_BRICKS : r < 0.3 ? B.CRACKED_STONE_BRICKS : B.STONE_BRICKS;
  };
  // the room: 7 x 7 inside, 3 high, in a shell of stone bricks
  for (let x = cx - 4; x <= cx + 4; x++) for (let z = cz - 5; z <= cz + 3; z++) for (let yy = bf - 1; yy <= bf + 3; yy++) {
    const shell = x === cx - 4 || x === cx + 4 || z === cz - 5 || z === cz + 3 || yy === bf - 1 || yy === bf + 3;
    set(x, yy, z, shell ? brick(x, yy, z) : 0);
  }
  // the shaft: from under the trapdoor down through the ceiling, ladders on its +z wall
  const { hatch } = L;
  for (let yy = bf + 3; yy <= y - 2; yy++) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (yy > bf + 3) set(hatch.x + dx, yy, hatch.z + dz, brick(hatch.x + dx, yy, hatch.z + dz));
    set(hatch.x, yy, hatch.z, 0);
  }
  for (let yy = bf; yy <= y - 2; yy++) set(hatch.x, yy, hatch.z, B.LADDER, 2);
  set(hatch.x, hatch.y, hatch.z, B.OAK_TRAPDOOR, TRAPDOOR_TOP | 2); // flush with the floor, closed
  // the cell: two blocks against the back wall behind a fence, the settler inside
  for (let yy = bf; yy <= bf + 1; yy++) {
    for (let x = cx - 3; x <= cx - 2; x++) set(x, yy, cz - 3, B.OAK_FENCE);
    set(cx - 1, yy, cz - 4, B.OAK_FENCE);
  }
  // across the room: the brewer's corner, the chest and a hanging lantern
  set(L.brewing.x, L.brewing.y, L.brewing.z, B.BREWING_STAND);
  set(L.chest.x, L.chest.y, L.chest.z, B.CHEST, 3 | 8 | (IGLOO_LOOT << 4));
  set(cx + 3, bf, cz + 2, B.WORKBENCH);
  set(cx, bf + 2, cz - 1, B.LANTERN, 1);
  for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 2; z <= cz; z++) set(x, bf - 1, z, B.WOOL, 14); // a red rug
}
