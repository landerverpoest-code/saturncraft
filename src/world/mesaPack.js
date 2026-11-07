// Painted Mesas and Slot Canyons: two additions to the badlands, both laid down after the terrain in passes of their own (the terrain noise and
// the cave carvers are untouched, so every older chunk comes out the same).
//
//  * Painted Mesas (paintedMesa / stampStrata): in patches of the badlands the plain terracotta bands of the cliffs are painted over with Strata,
//    seven shades of banded clay (Strata Rose, Rust, Crimson, Saffron, Bone, Umber, Ash), one for each terracotta it replaces, so the same bands
//    read as brighter, wavier stripes. A variant of the biome rather than a new one: weather, mobs and the map treat it as badlands.
//  * Slot Canyons (canyonInRegion ...): a winding, sheer slot 50 blocks long cut 16 deep into a mesa, with a pool of water on its floor,
//    a chest at one end and two plank bridges across it. Cliffkites ride its updrafts (mobs/duneMobs.js). Planned from the seed (world/siteLite.js).
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL, cidx, MIN_Y } from './constants.js';
import { hashf } from './noise.js';
import { toWorld, sideOfLocal } from './siteKit.js';
import { makeSiteKind, stampKind } from './siteLite.js';
import { sandvaultsNear } from './sandvault.js';

// ---- strata ----------------------------------------------------------------------------------------
/** terracotta -> strata, one for one */
export const STRATA_OF = new Map([
  [B.TERRACOTTA, B.STRATA_ROSE], [B.ORANGE_TERRACOTTA, B.STRATA_RUST], [B.RED_TERRACOTTA, B.STRATA_CRIMSON], [B.YELLOW_TERRACOTTA, B.STRATA_SAFFRON],
  [B.WHITE_TERRACOTTA, B.STRATA_BONE], [B.BROWN_TERRACOTTA, B.STRATA_UMBER], [B.LIGHT_GRAY_TERRACOTTA, B.STRATA_ASH],
]);
export const STRATA_IDS = [...STRATA_OF.values()];
export const PAINTED_SCALE = 150, PAINTED_CUT = 0.05;

/** Is the badlands column at (wx, wz) part of a Painted Mesa? Patches a hundred blocks across, from the seed alone. */
export function paintedMesa(gen, wx, wz) {
  return gen.nClay.noise2(wx / PAINTED_SCALE + 31.7, wz / PAINTED_SCALE - 12.3) > PAINTED_CUT;
}

/** The pass: paint over the terracotta of every badlands column in a Painted Mesa (heightmap: the top of each column, biomes: its biome). */
export function stampStrata(gen, blocks, meta, cx, cz, heightmap, biomes) {
  const X0 = cx * 16, Z0 = cz * 16;
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const ci = x + z * 16;
    if (biomes[ci] !== BIOME.BADLANDS || !paintedMesa(gen, X0 + x, Z0 + z)) continue;
    const top = heightmap[ci], bottom = Math.max(MIN_Y + 1, top - 60);
    for (let y = top; y >= bottom; y--) {
      const i = cidx(x, y, z), to = STRATA_OF.get(blocks[i]);
      if (to) blocks[i] = to;
    }
  }
}

// ---- slot canyons ----------------------------------------------------------------------------------
export const CANYON_HALF = 26;
export const CANYON_REACH = 27;
export const CANYON_LENGTH = 24;   // the slot runs from v = -24 to v = 24 (local)
export const CANYON_DEPTH = 16;
export const CANYON_CLEAR = 24;    // layers above the plateau that are cleared inside the slot
export const CANYON_LOOT = 2;      // chest loot kind: the temple treasure table
export const CANYON_BRIDGES = [-9, 11];
const CANYON_CHEST_V = -18;

const kind = makeSiteKind({
  salt: 9898, region: 192, reach: CANYON_REACH, chance: 0.9, tries: 160, siblings: [sandvaultsNear],
  probe(gen, cx, cz) {
    const c0 = gen.column(cx, cz), t0 = gen.surfaceAt(cx, cz, c0);
    if (gen.biomeFor(c0, t0) !== BIOME.BADLANDS || t0 <= SEA_LEVEL + 3) return null; // (most spots fail here: cheap)
    let lo = t0, hi = t0, bad = 0;
    for (const dx of [-20, -10, 0, 10, 20]) for (const dz of [-20, -10, 0, 10, 20]) {
      const x = cx + dx, z = cz + dz, col = gen.column(x, z), top = gen.surfaceAt(x, z, col);
      if (gen.biomeFor(col, top) !== BIOME.BADLANDS) bad++;
      lo = Math.min(lo, top); hi = Math.max(hi, top);
    }
    return bad <= 12 && lo > SEA_LEVEL + 2 && hi - lo <= 16 ? { y: t0 } : null;
  },
});
export const canyonInRegion = kind.inRegion;
export const canyonsNear = kind.near;
export const nearestCanyon = kind.nearest;

/** The slot's centre line (local u) and half width at local v: it winds, swells and narrows, and tapers shut at both ends. */
export function canyonAxis(s, v) {
  const p1 = hashf(s.seed, 3, 5, 1) * 6.28, p2 = hashf(s.seed, 7, 9, 2) * 6.28, p3 = hashf(s.seed, 11, 13, 3) * 6.28;
  const c = Math.round(5 * Math.sin(v / 8 + p1) + 2.5 * Math.sin(v / 3.7 + p2));
  const taper = Math.max(0, Math.min(1, (CANYON_LENGTH - Math.abs(v)) / 7));
  return { c, w: (2.6 + 1.2 * Math.sin(v / 5 + p3)) * taper };
}
/** Is the cell on the pool of the canyon floor? */
export const inCanyonPool = (s, u, v) => Math.abs(v) <= 2 && Math.abs(u - canyonAxis(s, v).c) <= 1;

/** Chests as { u, h, v, fu, fv, loot }, in the slot at the far end (h is the layer the chest stands on). */
export function canyonChestSpot(s) {
  const a = canyonAxis(s, CANYON_CHEST_V);
  return { u: a.c, h: -CANYON_DEPTH + 1, v: CANYON_CHEST_V, fu: 0, fv: 1, loot: CANYON_LOOT };
}
export function canyonChests(s) {
  const c = canyonChestSpot(s), [dx, dz] = toWorld(s.dir, c.u, c.v);
  return [{ x: s.cx + dx, y: s.y + c.h, z: s.cz + dz, kind: c.loot }];
}
/** Where Cliffkites circle (the canyon's middle, a few blocks over the rim). */
export function canyonGliderSpots(s) {
  return [[0, 5, 0], [6, 7, 8], [-6, 6, -8]].map(([u, h, v]) => { const [dx, dz] = toWorld(s.dir, u, v); return { x: s.cx + dx + 0.5, y: s.y + h, z: s.cz + dz + 0.5 }; });
}

/**
 * The block of canyon s at local (u, h, v) as [id, meta], or null where it leaves the world alone. h = 0 is the plateau's surface layer: the slot
 * is cut from the floor (layer -16, or -17 under the pool) up to CANYON_CLEAR over it, with plank bridges flush with the plateau.
 */
export function canyonBlock(s, u, h, v) {
  if (Math.abs(u) > CANYON_HALF || Math.abs(v) > CANYON_LENGTH || h < -CANYON_DEPTH - 1 || h > CANYON_CLEAR) return null;
  const a = canyonAxis(s, v), d = Math.abs(u - a.c), AIR = [B.AIR, 0];
  const bridge = CANYON_BRIDGES.includes(v) && d <= a.w + 1.5 && a.w > 1;
  if (bridge) {
    if (h === 0) return [B.OAK_PLANKS, 0];
    if (h === 1) return d >= a.w + 0.5 ? [B.OAK_FENCE, 0] : AIR;
  }
  if (d > a.w) return null;
  const pool = inCanyonPool(s, u, v);
  if (h === -CANYON_DEPTH - 1) return pool ? [B.RED_SAND, 0] : null;
  if (h === -CANYON_DEPTH) return pool ? [B.WATER, 0] : (hashf(s.seed, u, v, 90) < 0.12 ? [B.GRAVEL, 0] : [B.RED_SAND, 0]);
  const chest = canyonChestSpot(s);
  if (u === chest.u && v === chest.v && h === chest.h) return [B.CHEST, sideOfLocal(s.dir, chest.fu, chest.fv) | 8 | (chest.loot << 4)];
  return AIR;
}

/** Stamp the parts of nearby Slot Canyons inside chunk (cx, cz). */
export function stampCanyons(gen, blocks, meta, cx, cz) {
  stampKind(gen, blocks, meta, cx, cz, canyonsNear, {
    half: CANYON_HALF, below: -CANYON_DEPTH - 1, clear: CANYON_CLEAR, foundation: 0,
    fill: () => B.RED_SAND,
    blockAt: canyonBlock,
  });
}
