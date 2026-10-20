// Temples: one 256 x 256-block region in three may hold one: a desert temple,
// a jungle temple or (in snowy biomes) an igloo, depending on the biome. A 21 x 21 sandstone hall with two corner towers, a
// terracotta star in the floor and, 12 blocks under its centre, a hidden
// chamber with four loot chests above a trap of nine TNT. Planned from the
// seed alone; each chunk stamps its own part.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { MIN_Y, WORLD_HEIGHT, SEA_LEVEL, cidx } from './constants.js';
import { mulberry32, hash4 } from './noise.js';

export const TEMPLE_REGION = 256;
const cache = new Map();

export function templeInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 5151));
  let t = null;
  if (rng() < 0.33) {
    const R = TEMPLE_REGION, M = 24;
    const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
    const col = gen.column(cx, cz), top = gen.surfaceAt(cx, cz, col);
    // only on fairly level ground: the corners within 4 blocks of the centre's height
    const flat = [[-10, -10], [10, -10], [-10, 10], [10, 10]].every(([dx, dz]) => Math.abs(gen.surfaceAt(cx + dx, cz + dz) - top) <= 4);
    const biome = gen.biomeFor(col, top);
    const kind = biome === BIOME.DESERT ? 'desert' : biome === BIOME.JUNGLE ? 'jungle' : (biome === BIOME.SNOWY_PLAINS || biome === BIOME.SNOWY_TAIGA) ? 'igloo' : null;
    if (kind && flat && top > SEA_LEVEL) t = { kind, cx, cz, y: top + 1, x0: cx - 10, z0: cz - 10, x1: cx + 10, z1: cz + 10 };
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, t);
  return t;
}

export function templesNear(gen, x0, z0, x1, z1) {
  const out = [], R = TEMPLE_REGION;
  for (let rx = Math.floor((x0 - 10) / R); rx <= Math.floor((x1 + 10) / R); rx++) for (let rz = Math.floor((z0 - 10) / R); rz <= Math.floor((z1 + 10) / R); rz++) {
    const t = templeInRegion(gen, rx, rz);
    if (t && t.x1 >= x0 && t.x0 <= x1 && t.z1 >= z0 && t.z0 <= z1) out.push(t);
  }
  return out;
}

/** Stamp the parts of nearby temples inside chunk (cx, cz). */
export function stampTemples(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  for (const t of templesNear(gen, X0, Z0, X0 + 15, Z0 + 15)) {
    const inChunk = (x, z) => x >= X0 && x < X0 + 16 && z >= Z0 && z < Z0 + 16;
    const set = (x, y, z, id, m = 0) => {
      if (!inChunk(x, z) || y <= MIN_Y || y >= MIN_Y + WORLD_HEIGHT) return;
      const i = cidx(x - X0, y, z - Z0); blocks[i] = id; meta[i] = m;
    };
    if (t.kind === 'jungle') { jungleTemple(t, set); continue; }
    if (t.kind === 'igloo') { igloo(t, set); continue; }
    const { y, x0, z0, x1, z1, cx: tx, cz: tz } = t;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (!inChunk(x, z)) continue;
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      // foundation down to the sand, a clean interior and the walls
      for (let yy = y - 1; yy > y - 8; yy--) set(x, yy, z, B.SANDSTONE);
      set(x, y - 1, z, B.SANDSTONE);
      for (let yy = y; yy < y + 12; yy++) set(x, yy, z, B.AIR);
      const tower = (x - x0 < 5 || x1 - x < 5) && z - z0 < 5;
      const h = tower ? 11 : 7;
      if (edge || (tower && (x - x0 === 4 || x1 - x === 4 || z - z0 === 4))) {
        for (let yy = y; yy < y + h; yy++) {
          const band = yy === y + 2 || yy === y + 5 || yy === y + 9;
          set(x, yy, z, band && (x + z) % 2 === 0 ? B.ORANGE_TERRACOTTA : B.SANDSTONE);
        }
      }
      // roof over the hall and the towers, open well over the centre
      const open = Math.abs(x - tx) <= 2 && Math.abs(z - tz) <= 2;
      if (!open) set(x, y + h, z, tower ? B.SANDSTONE : B.SANDSTONE_SLAB);
      if (tower) set(x, y + h + 1, z, (x + z) % 2 === 0 ? B.SANDSTONE_SLAB : B.AIR);
      // floor: a terracotta star around a red centre
      const dx = x - tx, dz = z - tz;
      if (Math.abs(dx) <= 4 && Math.abs(dz) <= 4) {
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        const star = Math.abs(dx) === Math.abs(dz) || dx === 0 || dz === 0;
        set(x, y - 1, z, ring === 0 ? B.RED_TERRACOTTA : star ? B.ORANGE_TERRACOTTA : B.SANDSTONE);
      }
    }
    // the entrance on the -z side
    for (let x = tx - 1; x <= tx + 1; x++) for (let yy = y; yy < y + 3; yy++) set(x, yy, z0, B.AIR);
    // hidden chamber 12 blocks down: 7x7x4 room, four chests in alcoves, nine TNT in the floor
    const cy = y - 13;
    for (let x = tx - 4; x <= tx + 4; x++) for (let z = tz - 4; z <= tz + 4; z++) for (let yy = cy - 3; yy <= cy + 4; yy++) {
      const wall = Math.abs(x - tx) === 4 || Math.abs(z - tz) === 4 || yy === cy - 1 || yy === cy + 4 || yy < cy - 1;
      set(x, yy, z, wall ? B.SANDSTONE : B.AIR);
    }
    for (let x = tx - 1; x <= tx + 1; x++) for (let z = tz - 1; z <= tz + 1; z++) set(x, cy - 2, z, B.TNT);
    set(tx, cy - 1, tz, B.RED_TERRACOTTA);
    for (const [ax, az, face] of [[0, -3, 2], [3, 0, 3], [0, 3, 0], [-3, 0, 1]]) set(tx + ax, cy, tz + az, B.CHEST, face | 8);
    // the way down: a one-block shaft under the floor centre
    for (let yy = cy + 4; yy < y - 1; yy++) set(tx, yy, tz, B.AIR);
  }
}

/** Jungle temple: a 12 x 15 mossy cobblestone building on two floors with vines, a stair to the roof and a loot chest. */
function jungleTemple(t, set) {
  const { cx, cz, y } = t;
  const x0 = cx - 6, x1 = cx + 5, z0 = cz - 7, z1 = cz + 7;
  const stone = (x, yy, z) => ((x * 7 + yy * 13 + z * 3) % 5 < 2 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    for (let yy = y - 4; yy < y; yy++) set(x, yy, z, stone(x, yy, z)); // foundation
    for (let yy = y; yy < y + 10; yy++) set(x, yy, z, 0);
    const edge = x === x0 || x === x1 || z === z0 || z === z1;
    const inner = x > x0 + 1 && x < x1 - 1 && z > z0 + 1 && z < z1 - 1;
    for (let yy = y; yy < y + 4; yy++) if (edge) set(x, yy, z, stone(x, yy, z));
    set(x, y + 4, z, stone(x, y + 4, z)); // first floor ceiling
    // upper storey, set back one block
    const edge2 = x === x0 + 1 || x === x1 - 1 || z === z0 + 1 || z === z1 - 1;
    if (!edge && (edge2 || inner)) {
      for (let yy = y + 5; yy < y + 8; yy++) if (edge2) set(x, yy, z, stone(x, yy, z));
      set(x, y + 8, z, stone(x, y + 8, z));
    }
    if (inner && x > x0 + 2 && x < x1 - 2 && z > z0 + 2 && z < z1 - 2) set(x, y + 9, z, stone(x, y + 9, z));
    // vines down the walls
    if (edge && (x + z) % 3 === 0) for (let yy = y + 1; yy < y + 4; yy++) {
      const s = z === z0 ? 2 : z === z1 ? 0 : x === x0 ? 1 : 3; // hang on the wall behind
      const dx = s === 1 ? -1 : s === 3 ? 1 : 0, dz = s === 2 ? -1 : s === 0 ? 1 : 0;
      set(x + dx, yy, z + dz, B.VINES, s);
    }
  }
  // doorway, windows and inner rooms
  for (let x = cx - 1; x <= cx; x++) for (let yy = y; yy < y + 3; yy++) set(x, yy, z0, 0);
  for (const z of [cz - 3, cz + 3]) { set(x0, y + 2, z, 0); set(x1, y + 2, z, 0); }
  for (let z = z0 + 1; z < z1; z++) if (z !== cz) set(cx - 2, y + 1, z, B.COBBLESTONE_WALL);
  // a hole in the floor down to the treasure room
  for (let x = cx + 1; x <= cx + 3; x++) for (let z = cz + 2; z <= cz + 4; z++) for (let yy = y - 4; yy < y - 1; yy++) set(x, yy, z, 0);
  set(cx + 2, y - 4, cz + 3, B.CHEST, 2 | 8);
  set(cx - 4, y, cz + 5, B.CHEST, 1 | 8);
  for (let yy = y - 3; yy < y; yy++) set(cx + 1, yy, cz + 2, B.LADDER, 0);
}

/** Igloo: a snow dome with a bed, a workbench, a furnace, a torch and a carpet of wool. */
function igloo(t, set) {
  const { cx, cz, y } = t;
  // clear trees and snow around the dome
  for (let x = cx - 6; x <= cx + 6; x++) for (let z = cz - 7; z <= cz + 6; z++) for (let yy = y; yy < y + 14; yy++) set(x, yy, z, 0);
  for (let x = cx - 4; x <= cx + 4; x++) for (let z = cz - 4; z <= cz + 4; z++) for (let yy = y - 1; yy < y + 5; yy++) {
    const d = Math.hypot((x - cx) / 4.2, (yy - y + 0.5) / 4.2, (z - cz) / 4.2);
    if (yy === y - 1 && d < 1) set(x, yy, z, B.SNOW_BLOCK);
    else if (d < 1 && d > 0.72) set(x, yy, z, B.SNOW_BLOCK);
    else if (d <= 0.72) set(x, yy, z, 0);
  }
  for (let z = cz - 5; z <= cz - 3; z++) for (let yy = y; yy < y + 2; yy++) set(cx, yy, z, 0); // tunnel entrance
  set(cx, y + 2, cz - 4, B.ICE);
  for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) set(x, y - 1, z, B.WOOL, 14);
  set(cx - 2, y, cz + 1, B.BED, 0 | 8); set(cx - 2, y, cz + 2, B.BED, 0);
  set(cx + 2, y, cz + 1, B.WORKBENCH); set(cx + 2, y, cz - 1, B.FURNACE, 3);
  set(cx - 2, y, cz - 1, B.TORCH, 0);
  set(cx + 1, y, cz + 2, B.CHEST, 0 | 8);
}
