// Shipwrecks: the wooden hull of a lost ship, in 40 % of 160 x 160-block
// regions, lying on the ocean floor (or, now and then, run aground on a
// beach). A few spots of the region are tried; the first one in deep enough
// ocean (or on a beach) and clear of Tide Citadels, villages and ruined rifts
// is used. Each wreck has its own wood, length (13 or 17), heading, and may be
// whole or only its bow or stern half, upright or keeled over and pitched,
// with a broken deck, a snapped mast and missing planks. Its holds keep one to
// three chests: supplies in the bow, treasure under the stern and a map room
// in the stern cabin. The shape is planned from the seed alone; each chunk
// stamps the blocks that fall inside it.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { MIN_Y, WORLD_HEIGHT, SEA_LEVEL, cidx } from './constants.js';
import { mulberry32, hash4, hashf } from './noise.js';
import { monumentsNear } from './monuments.js';
import { villagesNear } from './villages.js';
import { ruinsNear } from './ruinedPortals.js';

export const WRECK_REGION = 160;
export const WRECK_REACH = 12; // furthest a wreck's block lies from its centre (x or z)
/** Loot kinds of the three holds (mobs/spawnerBlocks.js LOOT.WRECK / WRECK_TREASURE / WRECK_MAP). */
export const WRECK_LOOT = { supply: 5, treasure: 8, map: 9 };
const TRIES = 3;
const FLUID = -1; // placeholder: water below sea level, air above
const WOODS = [
  [B.OAK_PLANKS, B.OAK_LOG, B.OAK_FENCE],
  [B.SPRUCE_PLANKS, B.SPRUCE_LOG, B.SPRUCE_FENCE],
  [B.DARK_OAK_PLANKS, B.DARK_OAK_LOG, B.DARK_OAK_FENCE ?? B.OAK_FENCE],
  [B.BIRCH_PLANKS, B.BIRCH_LOG, B.BIRCH_FENCE],
];
const cache = new Map();

const isOcean = (b) => b === BIOME.OCEAN || b === BIOME.FROZEN_OCEAN;

function crowded(gen, cx, cz) {
  const r = WRECK_REACH + 6, x0 = cx - r, x1 = cx + r, z0 = cz - r, z1 = cz + r;
  return monumentsNear(gen, x0, z0, x1, z1).length > 0 || villagesNear(gen, x0, z0, x1, z1).length > 0 || ruinsNear(gen, x0, z0, x1, z1).length > 0;
}

/**
 * The wreck of region (rx, rz) or null: { cx, cz, y (keel level), beached, dir (0..3, bow towards
 * SIDE_DIRS[dir]), H (half length), part ('full' | 'bow' | 'stern'), cut, roll, pitch, wood, seed, x0..z1 }.
 */
export function wreckInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 6262));
  let wk = null;
  if (rng() < 0.4) {
    const R = WRECK_REGION, M = WRECK_REACH + 4;
    for (let k = 0; k < TRIES && !wk; k++) {
      const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
      const shape = {
        dir: Math.floor(rng() * 4), H: rng() < 0.6 ? 8 : 6,
        part: ['full', 'full', 'bow', 'stern'][Math.floor(rng() * 4)], cut: Math.floor(rng() * 3) - 1,
        roll: rng() < 0.5 ? 0 : rng() < 0.5 ? -0.5 : 0.5, pitch: rng() < 0.6 ? 0 : rng() < 0.5 ? -0.13 : 0.13,
        mapRoom: rng() < 0.6, mast: 1 + Math.floor(rng() * 6),
        wood: Math.floor(rng() * WOODS.length), seed: Math.floor(rng() * 1e9),
      };
      const col = gen.column(cx, cz), top = gen.surfaceAt(cx, cz, col), biome = gen.biomeFor(col, top);
      let y, beached = false;
      if (isOcean(biome) && top < SEA_LEVEL - 6) y = top + 1;
      else if (biome === BIOME.BEACH && top >= SEA_LEVEL - 1 && top <= SEA_LEVEL + 2) { y = top; beached = true; }
      else continue;
      if (crowded(gen, cx, cz)) continue;
      wk = { cx, cz, y, beached, ...shape, x0: cx - WRECK_REACH, x1: cx + WRECK_REACH, z0: cz - WRECK_REACH, z1: cz + WRECK_REACH };
    }
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, wk);
  return wk;
}

export function wrecksNear(gen, x0, z0, x1, z1) {
  const out = [], R = WRECK_REGION;
  for (let rx = Math.floor((x0 - WRECK_REACH) / R); rx <= Math.floor((x1 + WRECK_REACH) / R); rx++) for (let rz = Math.floor((z0 - WRECK_REACH) / R); rz <= Math.floor((z1 + WRECK_REACH) / R); rz++) {
    const wk = wreckInRegion(gen, rx, rz);
    if (wk && wk.x1 >= x0 && wk.x0 <= x1 && wk.z1 >= z0 && wk.z0 <= z1) out.push(wk);
  }
  return out;
}

// local (a along the keel, bow at -H; b across; h up from the keel) -> world offsets
const ROT = [(a, b) => [b, a], (a, b) => [-a, b], (a, b) => [-b, -a], (a, b) => [a, -b]];
/** Chest facing (side index) for a chest whose front points along local +a (s = 1) or -a (s = -1). */
const faceAlong = (dir, s) => (s > 0 ? (dir + 2) & 3 : dir);

/** Half-width of the hull at station a: 2 amidships, 1 near the ends, 0 at the tip. */
const halfAt = (H, a) => (Math.abs(a) <= H - 3 ? 2 : Math.abs(a) < H ? 1 : 0);

const plans = new Map();

/**
 * Every block of wreck `wk` as world-coordinate entries [x, y, z, id, meta]; id FLUID marks
 * the inside of the hull (water or air). Also lists the chests ({ x, y, z, kind }).
 */
export function wreckPlan(wk) {
  const key = `${wk.seed}:${wk.cx},${wk.cz},${wk.y}`;
  if (plans.has(key)) return plans.get(key);
  const { H, dir, part, cut, roll, pitch, seed } = wk;
  const [plank, log, fence] = WOODS[wk.wood];
  const rot = ROT[dir];
  const cells = new Map(), chests = [];
  const present = (a) => part === 'full' || (part === 'bow' ? a <= cut : a >= cut);
  const r = (a, b, h, k) => hashf(seed, a * 64 + b, h, k);
  const put = (a, b, h, id, m = 0) => {
    if (!present(a)) return;
    // missing planks, worse near a broken end
    if (id === plank && part !== 'full' && Math.abs(a - cut) <= 1 && h > 0 && r(a, b, h, 1) < 0.5) id = FLUID;
    const [dx, dz] = rot(a, b);
    const y = wk.y + h + Math.round(b * roll) + Math.round(a * pitch);
    cells.set(`${wk.cx + dx},${y},${wk.cz + dz}`, [wk.cx + dx, y, wk.cz + dz, id, m]);
  };
  const cabin0 = H - 4;
  for (let a = -H; a <= H; a++) {
    const hf = halfAt(H, a);
    for (let b = -hf; b <= hf; b++) {
      const side = Math.abs(b) === hf;
      if (hf === 0) { for (let h = 0; h <= 4; h++) put(a, b, h, log); continue; } // stem / sternpost
      if (!side) put(a, b, 0, b === 0 ? log : plank);              // the bottom, a log keel down the middle
      if (side) {
        for (let h = 1; h <= 3; h++) put(a, b, h, r(a, b, h, 2) < 0.12 ? FLUID : plank);
        if (a < cabin0 && Math.abs(a) < H - 1 && r(a, b, 4, 3) < 0.6) put(a, b, 4, fence); // railing
      } else {
        put(a, b, 1, FLUID); put(a, b, 2, FLUID);
        const hatch = (a === -H + 3 || a === H - 3) && b === 0;
        put(a, b, 3, !hatch && r(a, b, 3, 4) < 0.7 ? plank : FLUID);  // the deck, holed
      }
    }
  }
  // the stern cabin: walls, a doorway facing the bow, a fence window each side and a holed roof
  for (let a = cabin0; a <= H - 1; a++) {
    const hf = halfAt(H, a);
    for (let b = -hf; b <= hf; b++) {
      const wall = Math.abs(b) === hf || a === cabin0 || a === H - 1;
      for (let h = 4; h <= 5; h++) {
        if (!wall) put(a, b, h, FLUID);
        else if (a === cabin0 && b === 0) put(a, b, h, FLUID);
        else if (h === 5 && a === H - 3 && Math.abs(b) === hf) put(a, b, h, fence);
        else put(a, b, h, r(a, b, h, 5) < 0.1 ? FLUID : plank);
      }
      put(a, b, 6, r(a, b, 6, 6) < 0.8 ? plank : FLUID);
    }
  }
  // the mast, snapped off at some height; a yard across it when it still stands tall
  for (let h = 1; h <= 3 + wk.mast; h++) put(-1, 0, h, log);
  if (wk.mast >= 4) for (let b = -2; b <= 2; b++) if (b) put(-1, b, 3 + wk.mast, fence);
  // the bowsprit
  put(-H - 1, 0, 4, fence); put(-H - 2, 0, 5, fence);
  // the chests
  const chest = (a, b, h, s, kind) => {
    if (!present(a)) return;
    put(a, b, h, B.CHEST, faceAlong(dir, s) | 8 | (WRECK_LOOT[kind] << 4));
    const [dx, dz] = rot(a, b);
    chests.push({ x: wk.cx + dx, y: wk.y + h + Math.round(b * roll) + Math.round(a * pitch), z: wk.cz + dz, kind });
  };
  chest(-H + 3, 0, 1, 1, 'supply');
  chest(H - 3, 0, 1, -1, 'treasure');
  if (part !== 'full' || wk.mapRoom) chest(H - 2, 0, 4, -1, 'map');
  const plan = { cells: [...cells.values()], chests };
  if (plans.size > 64) plans.clear();
  plans.set(key, plan);
  return plan;
}

const PLANT = new Set([B.KELP, B.SEAGRASS, B.TALL_GRASS].filter((x) => x !== undefined));

/** Stamp the parts of nearby wrecks inside chunk (cx, cz). */
export function stampWrecks(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  for (const wk of wrecksNear(gen, X0, Z0, X0 + 15, Z0 + 15)) {
    const inside = (x, y, z) => x >= X0 && x < X0 + 16 && z >= Z0 && z < Z0 + 16 && y > MIN_Y && y < MIN_Y + WORLD_HEIGHT;
    const plan = wreckPlan(wk);
    const fluid = (y) => (y <= SEA_LEVEL ? B.WATER : B.AIR);
    for (const [x, y, z, id, m] of plan.cells) {
      if (!inside(x, y, z)) continue;
      const i = cidx(x - X0, y, z - Z0);
      blocks[i] = id === FLUID ? fluid(y) : id; meta[i] = id === FLUID ? 0 : m;
      // no kelp or seagrass growing through the hull
      for (let yy = y + 1; yy < MIN_Y + WORLD_HEIGHT && yy <= y + 30; yy++) {
        const j = cidx(x - X0, yy, z - Z0);
        if (!PLANT.has(blocks[j])) break;
        blocks[j] = fluid(yy); meta[j] = 0;
      }
    }
  }
}
