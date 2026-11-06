// Cloud Isles: small floating islands of grass over pale Cirrusstone high above the land, in about one 192 x 192-block region in
// two. Each has a grassy top with flowers, a little pond and an oak, a stone-brick Aerie with two chests, a patch of Beanstalks
// and veins of ore in its underside. A wild Beanstalk grows from the ground below to the isle (climb it like a ladder); a Skybean
// planted at home grows one too (world/randomTicks.js). Skyrays glide round the isles (mobs/oceanSky.js).
// Planned from the seed alone and stamped chunk by chunk in a pass of its own after the structures, so the terrain, the carvers
// and the older structures keep producing exactly what they always did.
import { B } from './blocks.js';
import { SEA_LEVEL, MAX_Y, cidx } from './constants.js';
import { mulberry32, hash4, hashf } from './noise.js';
import { toWorld, toLocal, sideOfLocal, sitesNear, nearestSite, chunkSetter } from './siteKit.js';

export const ISLE_REGION = 192;
export const ISLE_REACH = 22;            // furthest a block lies from the centre (x or z)
export const ISLE_DEPTH = 13;            // how far the underside hangs below the grass
export const ISLE_LOOT = { library: 9, hoard: 7 }; // existing chest tables: shipwreck chart chest, ruined-rift hoard
const CHANCE = 0.5, TRIES = 5;
const cache = new Map();

/**
 * The isle of region (rx, rz) or null: { cx, cz, y (grass level), r (radius), dir, seed, ax, az (where the wild Beanstalk stands),
 * ground (the ground it grows from), x0, z0, x1, z1 }. It needs low, dry ground beneath its anchor and no mountain top within reach.
 */
export function isleInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 9898));
  let isle = null;
  if (rng() < CHANCE) {
    const R = ISLE_REGION, M = ISLE_REACH + 6;
    for (let k = 0; k < TRIES && !isle; k++) {
      const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
      const dir = Math.floor(rng() * 4), seed = Math.floor(rng() * 1e9), r = 11 + Math.floor(rng() * 6);
      const ax = cx + Math.floor(rng() * 3) - 1, az = cz + Math.floor(rng() * 3) - 1;
      const col = gen.column(ax, az), ground = gen.surfaceAt(ax, az, col);
      if (ground <= SEA_LEVEL + 1 || ground > 100) continue;
      const y = Math.min(MAX_Y - 40, Math.max(132, ground + 58 + Math.floor(rng() * 20)));
      let hi = -999;
      for (let dx = -ISLE_REACH; dx <= ISLE_REACH; dx += 11) for (let dz = -ISLE_REACH; dz <= ISLE_REACH; dz += 11) hi = Math.max(hi, gen.surfaceAt(cx + dx, cz + dz));
      if (hi > y - ISLE_DEPTH - 12) continue;
      isle = { cx, cz, y, r, dir, seed, ax, az, ground, x0: cx - ISLE_REACH, z0: cz - ISLE_REACH, x1: cx + ISLE_REACH, z1: cz + ISLE_REACH };
    }
  }
  if (cache.size > 512) cache.clear();
  cache.set(key, isle);
  return isle;
}
export const isleNear = (gen, x0, z0, x1, z1) => sitesNear(isleInRegion, gen, ISLE_REGION, ISLE_REACH, x0, z0, x1, z1);
export const nearestIsle = (gen, x, z, maxRings = 14) => nearestSite(isleInRegion, gen, ISLE_REGION, x, z, maxRings);

/** Radius of the isle's rim at angle t (a wobbly circle). */
export function isleRim(s, t) {
  const p1 = hashf(s.seed, 1, 0, 11) * 6.28, p2 = hashf(s.seed, 2, 0, 12) * 6.28;
  return s.r * (1 + 0.14 * Math.sin(3 * t + p1) + 0.08 * Math.sin(5 * t + p2));
}
/** Is local (u, dy, v) inside the isle's rock? dy = 0 is the grass layer, negative below. */
export function isleSolid(s, u, dy, v) {
  if (dy > 0 || dy <= -ISLE_DEPTH) return false;
  const t = Math.atan2(v, u), rim = isleRim(s, t), d = Math.hypot(u, v);
  const f = Math.pow(Math.max(0, 1 - Math.pow(-dy / ISLE_DEPTH, 1.6)), 0.6);
  const wobble = (hashf(s.seed, u, v, 13) - 0.5) * 0.6 * (-dy > 3 ? 1 : 0);
  return d <= rim * f + wobble;
}

// the Aerie: a 5 x 5 stone-brick hut, door on the +u side, local cells
const AERIE = { u: -4, v: -2 };
/** Local chest cells [u, dy, v, fu, fv, loot] in the Aerie (dy 1 = just above the floor). */
export const AERIE_CHESTS = [[AERIE.u - 1, 1, AERIE.v - 1, 1, 0, ISLE_LOOT.library], [AERIE.u - 1, 1, AERIE.v + 1, 1, 0, ISLE_LOOT.hoard]];
const TREE = { u: 4, v: -6 };
const POND = { u: 3, v: 5, r: 2.2 };

/** The Beanstalk patch cells (local u, v) on the isle's top, with their heights. */
export function plotStalks(s) { return [-3, -2, -1].map((v, i) => ({ u: 2, v, h: 2 + Math.floor(hashf(s.seed, i, 3, 14) * 3) })); }
/** Local (u, v) of the wild Beanstalk's cell. */
export const anchorLocal = (s) => toLocal(s.dir, s.ax - s.cx, s.az - s.cz);

const chestMeta = (s, fu, fv, loot) => sideOfLocal(s.dir, fu, fv) | 8 | (loot << 4);
const brick = (t) => (t < 0.5 ? B.STONE_BRICKS : t < 0.8 ? B.MOSSY_STONE_BRICKS : B.CRACKED_STONE_BRICKS);

/** The block of the isle at local (u, dy, v) as [id, meta], or null where it leaves the sky alone. */
export function isleBlock(s, u, dy, v) {
  const q = (k) => hashf(s.seed, u * 61 + 900, v * 31 + 900, k + dy * 5);
  const au = u - AERIE.u, av = v - AERIE.v;
  // the Aerie walls and roof stand on the grass
  if (Math.abs(au) <= 2 && Math.abs(av) <= 2 && dy >= 0 && dy <= 5) {
    const edge = Math.abs(au) === 2 || Math.abs(av) === 2;
    if (dy === 0) return [B.STONE_BRICKS, 0];                       // the floor
    if (dy === 4) return [brick(q(1)), 0];                           // the roof
    if (dy === 5) return Math.abs(au) <= 1 && Math.abs(av) <= 1 ? [B.STONE_BRICK_SLAB, 0] : null;
    if (edge) {
      if (au === 2 && av === 0 && dy <= 2) return [B.AIR, 0];       // the doorway
      if (dy === 2 && ((au === -2 && av === 0) || (Math.abs(av) === 2 && au === 0))) return [B.GLASS_PANE, 0]; // windows
      return [brick(q(2)), 0];
    }
    for (const c of AERIE_CHESTS) if (c[0] === u && c[1] === dy && c[2] === v) return [B.CHEST, chestMeta(s, c[3], c[4], c[5])];
    if (dy === 3 && au === 0 && av === 0) return [B.LANTERN, 1];   // hangs from the roof
    return [B.AIR, 0];
  }
  const [wu, wv] = anchorLocal(s);
  // the oak's crown (it may overhang the rim)
  const tu = Math.abs(u - TREE.u), tv = Math.abs(v - TREE.v);
  if (dy >= 3 && dy <= 5 && tu <= 2 && tv <= 2) {
    if (tu === 0 && tv === 0 && dy <= 4) return [B.OAK_LOG, 0];
    if (dy === 5 ? tu + tv <= 1 : !(tu === 2 && tv === 2 && q(6) < 0.5)) return [B.OAK_LEAVES, 0];
  }
  if (dy > 0) {
    // things standing on the grass
    if (!isleSolid(s, u, 0, v)) return null;
    if (u === wu && v === wv && dy <= 1) return [B.BEANSTALK, 0];            // the wild stalk comes out on top
    for (const st of plotStalks(s)) if (st.u === u && st.v === v && dy <= st.h) return [B.BEANSTALK, 0];
    if (u === TREE.u && v === TREE.v && dy <= 4) return [B.OAK_LOG, 0];
    if (dy === 1 && Math.hypot(u - POND.u, v - POND.v) > POND.r + 1) {
      const t = q(4);
      if (t < 0.22) return [B.TALL_GRASS, 0];
      if (t < 0.27) return [t < 0.24 ? B.SKYBELL : t < 0.26 ? B.SUNPETAL : B.ROSETTE, 0];
    }
    return null;
  }
  if (!isleSolid(s, u, dy, v)) return null;
  // the wild stalk climbs through the rock
  if (u === wu && v === wv) return [B.BEANSTALK, 0];
  if (dy === 0) return Math.hypot(u - POND.u, v - POND.v) <= POND.r ? [B.WATER, 0] : [B.GRASS, 0];
  if (dy === -1 && Math.hypot(u - POND.u, v - POND.v) <= POND.r + 0.6) return [B.CLAY, 0];
  if (dy >= -3) return [B.DIRT, 0];
  const t = q(5);
  if (t < 0.035) return [B.IRON_ORE, 0];
  if (t < 0.05) return [B.COAL_ORE, 0];
  if (t < 0.058) return [B.GOLD_ORE, 0];
  if (t < 0.0605 && dy <= -6) return [B.DIAMOND_ORE, 0];
  return [t < 0.5 ? B.CIRRUSSTONE : t < 0.8 ? B.STONE : B.CIRRUSSTONE, 0];
}

/** Every chest of the isle as { x, y, z } in world coordinates. */
export function isleChests(s) {
  return AERIE_CHESTS.map(([u, dy, v]) => { const [dx, dz] = toWorld(s.dir, u, v); return { x: s.cx + dx, y: s.y + dy, z: s.cz + dz }; });
}

/** Spots [x, y, z] where an isle's Skyrays are first seen, gliding above it. */
export function isleRaySpots(s) {
  return [0, 1].map((k) => ({ x: s.cx + (k ? 9 : -9), y: s.y + 10 + k * 3, z: s.cz + (k ? -7 : 8) }));
}

/** Stamp the parts of nearby isles (and their wild Beanstalks) inside chunk (cx, cz). */
export function stampSkyIsles(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  const isles = isleNear(gen, X0, Z0, X0 + 15, Z0 + 15);
  if (!isles.length) return;
  const set = chunkSetter(blocks, meta, cx, cz);
  for (const s of isles) {
    for (let x = Math.max(X0, s.x0); x <= Math.min(X0 + 15, s.x1); x++) for (let z = Math.max(Z0, s.z0); z <= Math.min(Z0 + 15, s.z1); z++) {
      const [u, v] = toLocal(s.dir, x - s.cx, z - s.cz);
      // the isle was planned in a frame turned by dir; the stamp uses the same frame for every block
      for (let dy = -ISLE_DEPTH; dy <= 6; dy++) {
        const bl = isleBlock(s, u, dy, v);
        if (bl) set(x, s.y + dy, z, bl[0], bl[1]);
      }
    }
    // the wild Beanstalk from the ground up to the isle's underside
    if (s.ax >= X0 && s.ax < X0 + 16 && s.az >= Z0 && s.az < Z0 + 16) {
      for (let y = s.ground + 1; y < s.y - 9; y++) set(s.ax, y, s.az, B.BEANSTALK, 0); // (up into the rock, where isleBlock carries it on)
    }
  }
}
