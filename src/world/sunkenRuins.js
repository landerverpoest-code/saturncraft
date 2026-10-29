// Sunken Ruins: the drowned remains of a stone-brick temple hall on the floor of deep ocean,
// in about one 192 x 192-block region in three. A 27 x 17 hall (any of four headings) with a
// broken outer wall, an entrance arch, two rows of columns of every height, tide lanterns in
// the floor, a raised dais at the back with an idol of gold between two loot chests and, sealed
// under the floor (a row of chiseled tiles marks the spot), a flooded crypt with two more.
// Sodden Shamblers haunt the hall. Planned from the seed alone: every chunk stamps the blocks
// of the ruin that fall inside it, so the hall looks the same across chunk borders and on
// every machine of a multiplayer game.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL, cidx } from './constants.js';
import { mulberry32, hash4, hashf } from './noise.js';
import { toWorld, toLocal, sideOfLocal, sitesNear, nearestSite, chunkSetter, claimedByOthers } from './siteKit.js';

export const SUNKEN_REGION = 192;
export const SUNKEN_REACH = 15;          // furthest a block lies from the centre (x or z)
export const SUNKEN_HALF_U = 13, SUNKEN_HALF_V = 8; // the hall's footprint (walls included), local frame
export const SUNKEN_LOOT = 15;           // chest loot kind (mobs/spawnerBlocks.js LOOT.SUNKEN)
const CHANCE = 0.34, TRIES = 5;
const cache = new Map();
const isOcean = (b) => b === BIOME.OCEAN || b === BIOME.FROZEN_OCEAN;

/**
 * The ruin of region (rx, rz) or null: { cx, cz, y (floor level), dir, seed, x0, z0, x1, z1 }.
 * It needs deep, fairly level ocean floor all over its footprint and no other structure nearby.
 */
export function sunkenRuinInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 9494));
  let ruin = null;
  if (rng() < CHANCE) {
    const R = SUNKEN_REGION, M = SUNKEN_REACH + 6;
    for (let k = 0; k < TRIES && !ruin; k++) {
      const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
      const dir = Math.floor(rng() * 4), seed = Math.floor(rng() * 1e9);
      let lo = 999, hi = -999, ok = true;
      for (const u of [-13, 0, 13]) for (const v of [-8, 0, 8]) {
        const [dx, dz] = toWorld(dir, u, v), x = cx + dx, z = cz + dz;
        const col = gen.column(x, z), top = gen.surfaceAt(x, z, col);
        if (!isOcean(gen.biomeFor(col, top))) { ok = false; break; }
        lo = Math.min(lo, top); hi = Math.max(hi, top);
      }
      // deep enough for the tallest column to stay under the surface, and not on a slope
      if (!ok || hi > SEA_LEVEL - 14 || hi - lo > 4) continue;
      const box = { x0: cx - SUNKEN_REACH, z0: cz - SUNKEN_REACH, x1: cx + SUNKEN_REACH, z1: cz + SUNKEN_REACH };
      if (claimedByOthers(gen, box.x0 - 6, box.z0 - 6, box.x1 + 6, box.z1 + 6)) continue;
      ruin = { cx, cz, y: hi, dir, seed, ...box };
    }
  }
  if (cache.size > 512) cache.clear();
  cache.set(key, ruin);
  return ruin;
}

export const sunkenRuinsNear = (gen, x0, z0, x1, z1) => sitesNear(sunkenRuinInRegion, gen, SUNKEN_REGION, SUNKEN_REACH, x0, z0, x1, z1);
export const nearestSunkenRuin = (gen, x, z, maxRings = 14) => nearestSite(sunkenRuinInRegion, gen, SUNKEN_REGION, x, z, maxRings);

const BRICKS = (t) => (t < 0.45 ? B.STONE_BRICKS : t < 0.72 ? B.MOSSY_STONE_BRICKS : t < 0.97 ? B.CRACKED_STONE_BRICKS : B.CHISELED_STONE_BRICKS);
const PILLAR_U = [-6, -3, 0, 3, 6, 9];
const LANTERNS = [[-7, 6], [-7, -6], [6, 6], [6, -6]];
const chestMeta = (r, fu, fv) => sideOfLocal(r.dir, fu, fv) | 8 | (SUNKEN_LOOT << 4);

/** Local chest cells: [u, h, v, fu, fv] (the last two point the way the chest faces). */
const CHESTS = [[-10, 2, 3, 1, 0], [-10, 2, -3, 1, 0], [-9, -4, 1, 1, 0], [-9, -4, -1, 1, 0]];

/**
 * The block of the ruin at local (u, h, v) as [id, meta], or null where the ruin leaves the
 * world alone. h = 0 is the floor layer; the open volume above it is flooded to h = 11.
 */
export function sunkenRuinBlock(r, u, h, v) {
  const au = Math.abs(u), av = Math.abs(v);
  if (au > SUNKEN_HALF_U || av > SUNKEN_HALF_V || h < -5 || h > 11) return null;
  const q = (k) => hashf(r.seed, u * 61 + 700, v * 31 + 700, k);
  const brick = (k = 1) => [BRICKS(q(k + h * 7)), 0];
  // the sealed crypt: a brick shell round a flooded room, two chests on its floor
  if (u >= -12 && u <= -6 && av <= 3 && h <= -1) {
    const inner = u >= -11 && u <= -7 && av <= 2 && h >= -4;
    if (!inner) return brick(2);
    for (const c of CHESTS) if (c[1] === h && c[0] === u && c[2] === v) return [B.CHEST, chestMeta(r, c[3], c[4])];
    return [B.WATER, 0];
  }
  if (h < 0) return null;
  if (h === 0) {
    for (const [lu, lv] of LANTERNS) if (u === lu && v === lv) return [B.TIDE_LANTERN, 0];
    if (u === -8 && (v === 0 || av === 2)) return [B.CHISELED_STONE_BRICKS, 0]; // marks the crypt below
    const t = q(3);
    return t < 0.06 ? [B.GRAVEL, 0] : brick(4);
  }
  // the outer wall: always a course or two, broken higher up; corners stand tall
  const wall = au === SUNKEN_HALF_U || av === SUNKEN_HALF_V;
  if (wall) {
    const entrance = u === SUNKEN_HALF_U && av <= 1;
    if (entrance) return h <= 3 ? [B.WATER, 0] : h === 4 ? brick(5) : [B.WATER, 0];
    const corner = au === SUNKEN_HALF_U && av === SUNKEN_HALF_V;
    const top = corner ? 6 : q(6) < 0.18 ? 1 : 2 + Math.floor(q(7) * 4);
    if (h <= top) return h === top && corner ? [B.CHISELED_STONE_BRICKS, 0] : brick(8);
    return [B.WATER, 0];
  }
  // the dais at the back: a raised platform, a step, the idol between two chests
  if (u <= -9 && u >= -12 && av <= 5) {
    if (h === 1) return u <= -11 && av <= 2 ? [B.CHISELED_STONE_BRICKS, 0] : brick(9);
    if (h === 2 && u === -12 && v === 0) return [B.GOLD_BLOCK, 0];
    for (const c of CHESTS) if (c[1] === h && c[0] === u && c[2] === v) return [B.CHEST, chestMeta(r, c[3], c[4])];
  }
  // the colonnade: two rows of columns, most broken off at their own height
  if (av === 4 && PILLAR_U.includes(u)) {
    const p = hashf(r.seed, u, v, 50);
    const top = p < 0.22 ? 1 : 3 + Math.floor(hashf(r.seed, u, v, 51) * 6);
    if (h <= top) return h === top && top >= 6 ? [B.CHISELED_STONE_BRICKS, 0] : brick(10);
  } else if (h === 1 && av === 4 && PILLAR_U.some((pu) => Math.abs(pu - u) === 1) && hashf(r.seed, u, v, 52) < 0.4) {
    return [B.MOSSY_COBBLESTONE, 0]; // rubble beside a column
  }
  return [B.WATER, 0];
}

/** Every chest of ruin r as { x, y, z } in world coordinates. */
export function sunkenRuinChests(r) {
  return CHESTS.map(([u, h, v]) => { const [dx, dz] = toWorld(r.dir, u, v); return { x: r.cx + dx, y: r.y + h, z: r.cz + dz }; });
}

/** Spots [x, y, z] (feet) where the ruin's Sodden Shamblers wait, clear of the columns. */
export function sunkenGuardSpots(r) {
  const out = [];
  for (let k = 0; out.length < 5 && k < 40; k++) {
    const u = -4 + Math.floor(hashf(r.seed, k, 1, 60) * 16), v = -6 + Math.floor(hashf(r.seed, k, 2, 61) * 13);
    if (Math.abs(v) === 4 && PILLAR_U.includes(u)) continue;
    const [dx, dz] = toWorld(r.dir, u, v);
    out.push([r.cx + dx, r.y + 1, r.cz + dz]);
  }
  return out;
}

const PLANT = new Set([B.KELP, B.SEAGRASS, B.TALL_GRASS].filter((x) => x !== undefined));
const FOUNDATION = 8;

/** Stamp the parts of nearby Sunken Ruins inside chunk (cx, cz). */
export function stampSunkenRuins(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  const set = chunkSetter(blocks, meta, cx, cz);
  const at = (x, y, z) => blocks[cidx(x - X0, y, z - Z0)];
  for (const r of sunkenRuinsNear(gen, X0, Z0, X0 + 15, Z0 + 15)) {
    for (let x = Math.max(X0, r.x0); x <= Math.min(X0 + 15, r.x1); x++) for (let z = Math.max(Z0, r.z0); z <= Math.min(Z0 + 15, r.z1); z++) {
      const [u, v] = toLocal(r.dir, x - r.cx, z - r.cz);
      if (Math.abs(u) > SUNKEN_HALF_U || Math.abs(v) > SUNKEN_HALF_V) continue;
      // a footing where the sea bed dips: bricks down to the first solid block
      for (let h = -1; h >= -FOUNDATION; h--) {
        const b = at(x, r.y + h, z);
        if (b && b !== B.WATER && !PLANT.has(b)) break;
        set(x, r.y + h, z, hashf(r.seed, u, v, 70 + h) < 0.5 ? B.MOSSY_STONE_BRICKS : B.CRACKED_STONE_BRICKS);
      }
      for (let h = -5; h <= 11; h++) {
        const bl = sunkenRuinBlock(r, u, h, v);
        if (bl) set(x, r.y + h, z, bl[0], bl[1]);
      }
      // no kelp or seagrass stalks left hanging above the hall
      for (let yy = r.y + 12; yy < r.y + 40 && PLANT.has(at(x, yy, z)); yy++) set(x, yy, z, B.WATER);
    }
  }
}
