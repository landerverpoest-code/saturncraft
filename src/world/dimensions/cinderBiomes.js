// Sub-biomes of the Cinderdeep. Two slow 2D noises (scale ~90 blocks) paint patches over the cavern
// floors without touching the cave shapes, so the old terrain, lava sea, bastions and ores come out
// exactly as before everywhere else:
//  * Glowcap Thicket - Spore Loam floors under pale Glowcap Stalks that carry glowing Glowcap Caps
//    (Spores for Spore Lanterns); teal-green haze; Capwalkers graze here.
//  * Slagfall Delta  - Slagstone floors with ridges of slag columns, Slag Ore (smelts into Slagsteel);
//    ash drifts down through a brown-grey haze; Cinder Brutes, Ember Lords and Ashwraiths hunt here.
//  * Dirgevale       - cold Dirgestone and Mournsand with Wraithbone spires and Dirge Crystal Ore;
//    a blue haze and the wails of Dirge Wailers.
// Everything here is a pure function of the seed and the coordinates. Each sub-biome also decides its
// fog colour, soundscape and natural spawn table (mobs/dimensionMobs.js, audio/ambience.js).
import { B } from '../blocks.js';
import { mulberry32, hash4 } from '../noise.js';
import { cidx } from '../constants.js';

export const SUB = { NONE: 0, THICKET: 1, DELTA: 2, VALE: 3 };

/** Per sub-biome: name, fog colour (and near / far as fractions of the view distance), soundscape key, spawn table key. */
export const SUB_BIOMES = {
  [SUB.NONE]: { key: 'cinders', name: 'the Cinderdeep', fog: [0.2, 0.035, 0.018], fogNear: 0.1, fogFar: 0.8, soundscape: 'cinderdeep', table: 'cinderdeep' },
  [SUB.THICKET]: { key: 'thicket', name: 'Glowcap Thicket', fog: [0.025, 0.14, 0.12], fogNear: 0.06, fogFar: 0.65, soundscape: 'cinder_thicket', table: 'cinderThicket' },
  [SUB.DELTA]: { key: 'delta', name: 'Slagfall Delta', fog: [0.17, 0.12, 0.11], fogNear: 0.08, fogFar: 0.7, soundscape: 'cinder_delta', table: 'cinderDelta' },
  [SUB.VALE]: { key: 'vale', name: 'Dirgevale', fog: [0.05, 0.09, 0.22], fogNear: 0.05, fogFar: 0.6, soundscape: 'cinder_vale', table: 'cinderVale' },
};
export const SUB_BY_KEY = Object.fromEntries(Object.values(SUB_BIOMES).map((s, i) => [s.key, i]));

export const THICKET_AT = 0.5, DELTA_AT = -0.5, VALE_AT = 0.45;

/** The sub-biome for the two noise values (a: thicket high / delta low, b: vale high). */
export function pickSub(a, b) {
  if (a > THICKET_AT) return SUB.THICKET;
  if (a < DELTA_AT) return SUB.DELTA;
  if (b > VALE_AT) return SUB.VALE;
  return SUB.NONE;
}

/** The floor block a sub-biome lays over open Cinderstone (0 = leave the old surface), given the patch noise `q` of the column. */
export function subFloor(sub, q) {
  if (sub === SUB.THICKET) return B.SPORE_LOAM;
  if (sub === SUB.DELTA) return B.SLAGSTONE;
  if (sub === SUB.VALE) return q > 0.15 ? B.DIRGE_STONE : B.MOURNSAND;
  return 0;
}

const FLOORS = new Set([B.SPORE_LOAM, B.SLAGSTONE, B.DIRGE_STONE, B.MOURNSAND]);

/** y of the highest floor block of `mat` (or any sub-biome floor when 0) with air above it in a chunk column, scanning down from `from`; -1 when none. */
function floorY(blocks, x, z, mat, from = 112) {
  for (let y = from; y > 32; y--) {
    const id = blocks[cidx(x, y, z)];
    if ((mat ? id === mat : FLOORS.has(id)) && blocks[cidx(x, y + 1, z)] === B.AIR) return y;
  }
  return -1;
}

/** Walk a short vein of `ore` through `host` blocks from (x, y, z). */
function vein(blocks, rng, x, y, z, ore, hosts, steps) {
  for (let n = 0; n < steps; n++) {
    if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 4 && y < 123 && hosts.has(blocks[cidx(x, y, z)])) blocks[cidx(x, y, z)] = ore;
    const r = rng();
    if (r < 0.33) x += rng() < 0.5 ? 1 : -1; else if (r < 0.66) z += rng() < 0.5 ? 1 : -1; else y += rng() < 0.5 ? 1 : -1;
  }
}

const HOSTS = { [SUB.DELTA]: new Set([B.CINDERSTONE, B.SLAGSTONE]), [SUB.VALE]: new Set([B.CINDERSTONE, B.DIRGE_STONE]) };

/** A glowing mushroom tree: a pale stalk under a domed cap. Only replaces air; returns the blocks placed. */
export function growGlowcap(blocks, x, y, z, h) {
  let n = 0;
  const put = (xx, yy, zz, id) => {
    if (xx < 0 || xx > 15 || zz < 0 || zz > 15 || yy < 1 || yy > 122) return;
    const i = cidx(xx, yy, zz);
    if (blocks[i] === B.AIR) { blocks[i] = id; n++; }
  };
  for (let k = 1; k <= h; k++) put(x, y + k, z, B.GLOWCAP_STALK);
  const top = y + h;
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    const r2 = dx * dx + dz * dz;
    if (r2 > 10) continue;
    if (r2 >= 4 && r2 !== 0) put(x + dx, top, z + dz, B.GLOWCAP_CAP);   // the skirt
    put(x + dx, top + 1, z + dz, B.GLOWCAP_CAP);                          // the dome
    if (r2 <= 2) put(x + dx, top + 2, z + dz, B.GLOWCAP_CAP);             // the crown
  }
  return n;
}

/**
 * Ores, Glowcap trees, slag columns and Wraithbone spires of the sub-biomes of one chunk, from its own random
 * stream (the old terrain's streams are untouched). `sub` holds the sub-biome of each of the 256 columns.
 */
export function decorateSubBiomes(seed, blocks, cx, cz, sub) {
  let any = 0;
  for (let i = 0; i < 256; i++) if (sub[i]) { any = 1; break; }
  if (!any) return;
  const rng = mulberry32(hash4(seed, cx, cz, 7919));
  // ore veins (Slag Ore in the Delta, Dirge Crystal Ore in the Vale)
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(rng() * 16), y = 8 + Math.floor(rng() * 110), z = Math.floor(rng() * 16), s = sub[x + z * 16];
    if (s === SUB.DELTA) vein(blocks, rng, x, y, z, B.SLAG_ORE, HOSTS[SUB.DELTA], 9);
    else if (s === SUB.VALE && k % 2 === 0) vein(blocks, rng, x, y, z, B.DIRGE_CRYSTAL_ORE, HOSTS[SUB.VALE], 7);
  }
  // Glowcap trees and ground clumps
  for (let k = 0; k < 6; k++) {
    const x = 3 + Math.floor(rng() * 10), z = 3 + Math.floor(rng() * 10), h = 4 + Math.floor(rng() * 6);
    if (sub[x + z * 16] !== SUB.THICKET) continue;
    const y = floorY(blocks, x, z, B.SPORE_LOAM);
    if (y > 0) growGlowcap(blocks, x, y, z, h);
  }
  for (let k = 0; k < 10; k++) {
    const x = 1 + Math.floor(rng() * 14), z = 1 + Math.floor(rng() * 14);
    if (sub[x + z * 16] !== SUB.THICKET || rng() < 0.4) continue;
    const y = floorY(blocks, x, z, B.SPORE_LOAM);
    if (y > 0) blocks[cidx(x, y + 1, z)] = B.GLOWCAP_CAP;
  }
  // slag columns: ridges of tall dark pillars with a skirt of rubble
  for (let k = 0; k < 9; k++) {
    const x = 1 + Math.floor(rng() * 14), z = 1 + Math.floor(rng() * 14), h = 2 + Math.floor(rng() * 6);
    if (sub[x + z * 16] !== SUB.DELTA) continue;
    const y = floorY(blocks, x, z, B.SLAGSTONE);
    if (y < 0) continue;
    for (let d = 1; d <= h; d++) if (blocks[cidx(x, y + d, z)] === B.AIR) blocks[cidx(x, y + d, z)] = B.SLAGSTONE; else break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (rng() < 0.45) continue;
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || xx > 15 || zz < 0 || zz > 15) continue;
      for (let d = 1; d <= Math.ceil(h / 2); d++) if (blocks[cidx(xx, y + d, zz)] === B.AIR && blocks[cidx(xx, y + d - 1, zz)] !== B.AIR && blocks[cidx(xx, y + d - 1, zz)] !== B.LAVA) blocks[cidx(xx, y + d, zz)] = B.SLAGSTONE; else break;
    }
  }
  // Wraithbone spires
  for (let k = 0; k < 6; k++) {
    const x = 1 + Math.floor(rng() * 14), z = 1 + Math.floor(rng() * 14), h = 3 + Math.floor(rng() * 6);
    if (sub[x + z * 16] !== SUB.VALE) continue;
    const y = floorY(blocks, x, z, 0);
    if (y < 0) continue;
    for (let d = 1; d <= h; d++) if (blocks[cidx(x, y + d, z)] === B.AIR) blocks[cidx(x, y + d, z)] = B.WRAITHBONE; else break;
    const kx = x + (rng() < 0.5 ? 1 : -1);
    if (kx >= 0 && kx < 16 && blocks[cidx(kx, y + 2, z)] === B.AIR && h > 4) blocks[cidx(kx, y + 2, z)] = B.WRAITHBONE;
  }
}
