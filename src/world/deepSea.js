// The ocean depths: a decoration pass run after the ordinary decoration (like world/wildCrops.js), so the terrain noise and the
// carvers keep producing exactly what they always did. Everything is a closed-form function of the seed and the coordinates, so the
// pass looks the same across chunk borders and on every machine of a multiplayer game.
//  * Biomes: Deep Ocean (floors 23 or more blocks under the surface) and Kelp Forest (patches of the mid-depth floor) are painted over
//    the Ocean biome after the terrain is made. Structure planners keep asking the generator (which says "ocean"), so nothing moves.
//  * Kelp forests: dense, tall kelp rooted in the sand of Kelp Forest patches.
//  * Trenches: meandering cuts down to 14 blocks deep in the deep floor, with Gleamkelp glowing on their floors.
//  * Gleamkelp: single glowing fronds scattered over the deep floor (and thicker in trenches), the only light down there.
//  * Abyssal Grotto: a sea cave in about one 160 x 160 region in three on deep, level floor: a rock dome with an arched mouth, Gleamkelp
//    among the rocks, a dais of tidestone with two chests and the wreck of a diving skiff with a third. Trenchmaws lurk inside.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL, MIN_Y, cidx } from './constants.js';
import { Simplex, mulberry32, hash4, hashf } from './noise.js';
import { toWorld, toLocal, sideOfLocal, sitesNear, nearestSite, chunkSetter, claimedByOthers } from './siteKit.js';
import { sunkenRuinsNear } from './sunkenRuins.js';

export const DEEP_TOP = SEA_LEVEL - 23;       // a sea floor at or below this y makes Deep Ocean
export const FOREST_MIN = SEA_LEVEL - 22, FOREST_MAX = SEA_LEVEL - 5; // floors that can hold a Kelp Forest
export const TRENCH_MAX = 14;                 // deepest cut of a trench
export const TRENCH_FLOOR = 6;                // a trench never cuts below this y
export const GROTTO_REGION = 160;
export const GROTTO_REACH = 13;
export const GROTTO_R = 12;                   // the dome's outer radius
export const GROTTO_LOOT = { dais: 8, hull: 5, side: 15 }; // existing chest tables: shipwreck treasure, shipwreck supplies, sunken ruins
const CHANCE = 0.34, TRIES = 6;
const isOceanBiome = (b) => b === BIOME.OCEAN || b === BIOME.FROZEN_OCEAN;
const cache = new Map();
const noiseCache = new WeakMap();

/** The generator's sea noise fields (made once per generator). */
export function seaNoise(gen) {
  let n = noiseCache.get(gen);
  if (!n) { n = { trench: new Simplex(hash4(gen.seed, 24, 911, 3)), width: new Simplex(hash4(gen.seed, 25, 911, 3)), forest: new Simplex(hash4(gen.seed, 26, 911, 3)) }; noiseCache.set(gen, n); }
  return n;
}

/** How many blocks a trench cuts into the sea floor at world (x, z): 0 outside a trench. */
export function trenchCut(gen, x, z) {
  const N = seaNoise(gen);
  const wx = x + Math.sin(z / 41) * 14, wz = z + Math.sin(x / 53) * 14; // wobble, so the trenches wind
  const n = Math.abs(N.trench.noise2(wx / 190, wz / 190));
  const THR = 0.045;
  if (n >= THR) return 0;
  const prof = 1 - (n / THR) ** 2;                              // 1 along the middle, 0 at the lip
  const amp = 0.45 + 0.55 * (N.width.noise2(x / 240, z / 240) * 0.5 + 0.5); // some stretches run deeper
  return Math.round(TRENCH_MAX * amp * Math.pow(prof, 0.7));
}

/** Is world (x, z) inside a Kelp Forest patch (before the depth test)? */
export function kelpForestNoise(gen, x, z) { return seaNoise(gen).forest.noise2(x / 70, z / 70); }
export const FOREST_THRESHOLD = 0.18;

/** How dark the water is at height y: 0 in the shallows, 1 below the deepest light (used for the fog, see game.js). */
export function depthDarkness(y) { return Math.max(0, Math.min(1, (SEA_LEVEL - 12 - y) / 28)); }

/** Which sea biome a floor of height `top` gets, from the Ocean biome it started as. */
export function seaBiomeFor(gen, base, top, x, z) {
  if (base !== BIOME.OCEAN) return base;
  if (top <= DEEP_TOP) return BIOME.DEEP_OCEAN;
  if (top >= FOREST_MIN && top <= FOREST_MAX && kelpForestNoise(gen, x, z) > FOREST_THRESHOLD) return BIOME.KELP_FOREST;
  return base;
}

// ---- Abyssal Grottos -------------------------------------------------------------------
/**
 * The grotto of region (rx, rz) or null: { cx, cz, y (floor level), dir (the mouth faces local +u), seed, x0, z0, x1, z1 }.
 * It needs deep, fairly level ocean floor and no other structure nearby.
 */
export function grottoInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 9696));
  let g = null;
  if (rng() < CHANCE) {
    const R = GROTTO_REGION, M = GROTTO_REACH + 6;
    for (let k = 0; k < TRIES && !g; k++) {
      const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
      const dir = Math.floor(rng() * 4), seed = Math.floor(rng() * 1e9);
      let lo = 999, hi = -999, ok = true;
      for (const u of [0, -13, 13]) for (const v of [0, -13, 13]) {
        const [dx, dz] = toWorld(dir, u, v), x = cx + dx, z = cz + dz;
        const col = gen.column(x, z), top = gen.surfaceAt(x, z, col);
        if (!isOceanBiome(gen.biomeFor(col, top))) { ok = false; break; }
        lo = Math.min(lo, top); hi = Math.max(hi, top);
      }
      if (!ok || hi > DEEP_TOP + 4 || lo < MIN_Y + 14 || hi - lo > 5) continue;
      let trench = false;
      for (let dx = -14; dx <= 14 && !trench; dx += 7) for (let dz = -14; dz <= 14; dz += 7) if (trenchCut(gen, cx + dx, cz + dz) > 0) { trench = true; break; }
      if (trench) continue;
      const box = { x0: cx - GROTTO_REACH, z0: cz - GROTTO_REACH, x1: cx + GROTTO_REACH, z1: cz + GROTTO_REACH };
      const pad = [box.x0 - 8, box.z0 - 8, box.x1 + 8, box.z1 + 8];
      if (claimedByOthers(gen, ...pad) || sunkenRuinsNear(gen, ...pad).length) continue;
      g = { cx, cz, y: hi, dir, seed, ...box };
    }
  }
  if (cache.size > 512) cache.clear();
  cache.set(key, g);
  return g;
}
export const grottosNear = (gen, x0, z0, x1, z1) => sitesNear(grottoInRegion, gen, GROTTO_REGION, GROTTO_REACH, x0, z0, x1, z1);
export const nearestGrotto = (gen, x, z, maxRings = 14) => nearestSite(grottoInRegion, gen, GROTTO_REGION, x, z, maxRings);

const SHELL = (t) => (t < 0.5 ? B.DEEPSTONE : t < 0.72 ? B.SMOOTH_BASALT : t < 0.9 ? B.COBBLED_DEEPSTONE : B.DARK_TIDESTONE);
/** Local chest cells: [u, dy, v, fu, fv, loot] (the last pair is the way the chest faces). */
export const GROTTO_CHESTS = [[-7, 2, -1, 1, 0, GROTTO_LOOT.dais], [-7, 2, 1, 1, 0, GROTTO_LOOT.side], [3, 1, -5, 0, 1, GROTTO_LOOT.hull]];
const chestMeta = (g, fu, fv, loot) => sideOfLocal(g.dir, fu, fv) | 8 | (loot << 4);

/**
 * The block of grotto g at local (u, dy, v) as [id, meta], or null where the grotto leaves the sea alone. dy = 0 is the floor layer;
 * the hall above it is flooded.
 */
export function grottoBlock(g, u, dy, v) {
  const d = Math.hypot(u, v);
  if (d > GROTTO_R + 0.5 || dy < -4 || dy > 11) return null;
  const q = (k) => hashf(g.seed, u * 61 + 700, v * 31 + 700, k + dy * 7);
  if (dy < 0) return [q(1) < 0.15 ? B.GRAVEL : B.DEEPSTONE, 0];
  if (dy === 0) return [q(2) < 0.25 ? B.GRAVEL : q(3) < 0.4 ? B.SMOOTH_BASALT : B.DEEPSTONE, 0];
  // the hall: a flooded ellipsoid inside a thick rock shell; the mouth is an arch on the +u side
  const hy = (dy - 1) / 7;
  const inside = (d / 9.2) ** 2 + hy * hy < 1;
  const outer = (d / GROTTO_R) ** 2 + (dy / 10) ** 2 <= 1;
  const mouth = u >= 5 && Math.abs(v) <= 2 && dy <= (Math.abs(v) === 2 ? 4 : 5);
  if (!outer) return null;
  if (!inside || (mouth && d > 7)) return mouth ? [B.WATER, 0] : [SHELL(q(4)), 0];
  // furnishings of the hall
  for (const c of GROTTO_CHESTS) if (c[0] === u && c[1] === dy && c[2] === v) return [B.CHEST, chestMeta(g, c[3], c[4], c[5])];
  if (u >= -9 && u <= -5 && Math.abs(v) <= 3 && dy === 1) return [Math.abs(v) <= 1 || u === -9 ? B.TIDESTONE_BRICKS : B.TIDESTONE, 0]; // the dais
  if (u === -7 && v === 0 && dy === 2) return [B.TIDE_LANTERN, 0];
  if (dy >= 1 && dy <= 2 && u >= 1 && u <= 7 && (v === -6 || v === -3) && q(5) < 0.8) return [q(6) < 0.3 ? B.DARK_OAK_PLANKS : B.OAK_PLANKS, 0]; // the skiff's ribs, broken
  if (dy === 1 && d >= 3 && d <= 8.5 && q(8) < 0.14) return [B.GLEAMKELP, 0];
  if (dy === 1 && d > 8.5 && q(9) < 0.05) return [B.TIDE_LANTERN, 0]; // a lantern in the rubble at the foot of the wall
  return [B.WATER, 0];
}

/** Every chest of grotto g as { x, y, z } in world coordinates. */
export function grottoChests(g) {
  return GROTTO_CHESTS.map(([u, dy, v]) => { const [dx, dz] = toWorld(g.dir, u, v); return { x: g.cx + dx, y: g.y + dy, z: g.cz + dz }; });
}

/** Spots [x, y, z] (feet) where the grotto's Trenchmaws lurk. */
export function grottoGuardSpots(g) {
  const out = [];
  for (let k = 0; out.length < 2 && k < 30; k++) {
    const u = -4 + Math.floor(hashf(g.seed, k, 1, 60) * 10), v = -5 + Math.floor(hashf(g.seed, k, 2, 61) * 11);
    if (Math.hypot(u, v) > 7) continue;
    const [dx, dz] = toWorld(g.dir, u, v);
    out.push([g.cx + dx, g.y + 3, g.cz + dz]);
  }
  return out;
}

const PLANT = new Set([B.KELP, B.SEAGRASS, B.GLEAMKELP]);
const FLOOR = new Set([B.SAND, B.GRAVEL, B.DIRT, B.CLAY]);

/**
 * The deep-sea pass over chunk (cx, cz): biomes, kelp forests, trenches and Gleamkelp. Run after the ordinary decoration and before the
 * structures; `heightmap` and `biomes` are the chunk's arrays, updated where a trench lowers the floor or the biome changes.
 */
export function stampDeepSea(gen, blocks, meta, cx, cz, heightmap, biomes) {
  const X0 = cx * 16, Z0 = cz * 16;
  let any = false;
  for (let i = 0; i < 256; i++) if (isOceanBiome(biomes[i])) { any = true; break; }
  if (!any) return;
  // trenches keep clear of structures (the planners know nothing of them)
  let trenchOk = null;
  const allowTrench = () => {
    if (trenchOk === null) {
      const pad = [X0 - 10, Z0 - 10, X0 + 25, Z0 + 25];
      trenchOk = !claimedByOthers(gen, ...pad) && !sunkenRuinsNear(gen, ...pad).length && !grottosNear(gen, ...pad).length;
    }
    return trenchOk;
  };
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const ci = x + z * 16, base = biomes[ci];
    if (!isOceanBiome(base)) continue;
    const wx = X0 + x, wz = Z0 + z;
    let top = heightmap[ci];
    if (top > SEA_LEVEL - 3 || blocks[cidx(x, top + 1, z)] !== B.WATER && !PLANT.has(blocks[cidx(x, top + 1, z)])) continue;
    // a trench cuts the deep floor
    const cut = top <= DEEP_TOP + 4 ? trenchCut(gen, wx, wz) : 0;
    if (cut > 0 && allowTrench()) {
      const nt = Math.max(TRENCH_FLOOR, top - cut);
      for (let y = top + 1; y <= SEA_LEVEL - 2 && PLANT.has(blocks[cidx(x, y, z)]); y++) blocks[cidx(x, y, z)] = B.WATER;
      for (let y = nt + 1; y <= top; y++) { blocks[cidx(x, y, z)] = B.WATER; meta[cidx(x, y, z)] = 0; }
      const t = hashf(gen.seed, wx, wz, 9601);
      blocks[cidx(x, nt, z)] = t < 0.5 ? B.GRAVEL : t < 0.8 ? B.SMOOTH_BASALT : B.DEEPSTONE;
      top = nt; heightmap[ci] = nt;
      if (hashf(gen.seed, wx, wz, 9602) < 0.1) blocks[cidx(x, nt + 1, z)] = B.GLEAMKELP;
    }
    const biome = seaBiomeFor(gen, base, top, wx, wz);
    biomes[ci] = biome;
    const ground = blocks[cidx(x, top, z)], above = cidx(x, top + 1, z);
    if (biome === BIOME.KELP_FOREST && FLOOR.has(ground) && (blocks[above] === B.WATER || PLANT.has(blocks[above]))) {
      const r = hashf(gen.seed, wx, wz, 9603);
      if (r < 0.42) {
        const n = Math.max(3, Math.floor((SEA_LEVEL - 2 - top) * (0.55 + 0.45 * hashf(gen.seed, wx, wz, 9604))));
        for (let k = 1; k <= n && top + k < SEA_LEVEL - 1; k++) blocks[cidx(x, top + k, z)] = B.KELP;
      } else if (r < 0.5) blocks[above] = B.SEAGRASS;
    } else if (biome === BIOME.DEEP_OCEAN && (FLOOR.has(ground) || ground === B.STONE || ground === B.DEEPSTONE) && blocks[above] === B.WATER) {
      if (hashf(gen.seed, wx, wz, 9605) < 0.03) blocks[above] = B.GLEAMKELP;
    }
  }
  // grottos: a rock dome on the floor
  const grottos = grottosNear(gen, X0, Z0, X0 + 15, Z0 + 15);
  if (!grottos.length) return;
  const set = chunkSetter(blocks, meta, cx, cz);
  for (const g of grottos) {
    for (let x = Math.max(X0, g.x0); x <= Math.min(X0 + 15, g.x1); x++) for (let z = Math.max(Z0, g.z0); z <= Math.min(Z0 + 15, g.z1); z++) {
      const [u, v] = toLocal(g.dir, x - g.cx, z - g.cz);
      if (Math.hypot(u, v) > GROTTO_R + 0.5) continue;
      for (let dy = -4; dy <= 11; dy++) {
        const bl = grottoBlock(g, u, dy, v);
        if (bl) set(x, g.y + dy, z, bl[0], bl[1]);
      }
      // no kelp left standing on the roof
      for (let yy = g.y + 12; yy < g.y + 40 && PLANT.has(blocks[cidx(x - X0, yy, z - Z0)]); yy++) set(x, yy, z, B.WATER);
      const bi = (x - X0) + (z - Z0) * 16;
      if (biomes[bi] === BIOME.OCEAN || biomes[bi] === BIOME.KELP_FOREST) biomes[bi] = BIOME.DEEP_OCEAN;
    }
  }
}
