// Hermit's Lighthouse: a round tower of red and white bands on a rocky point of a beach, in about one 200 x 200 region in two
// where the sand meets the sea (a beach with water on some sides). The tower is 9 blocks across and 16 tall: the keeper's
// ground floor (a workbench, a furnace and a supply chest), a bedroom above it (the bed, shelves, a chandelier, and the
// chest that holds the hermit's chart box and his log), and under the red roof the lamp room, ringed in leaded glass round a
// Lighthouse Lens on its pedestal with a strongbox beside it. A single ladder climbs the inside wall; the door faces inland.
// The hermit is long gone; Brinecrabs scuttle on the rocks and a Skitterer or two have moved into the ground floor.
// Planned from the seed alone and stamped chunk by chunk (world/siteLite.js).
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL } from './constants.js';
import { hashf } from './noise.js';
import { toWorld, sideOfLocal } from './siteKit.js';
import { makeSiteKind, stampKind } from './siteLite.js';
import { BED_HEAD } from './shapes.js';

export const LIGHTHOUSE_HALF = 7;
export const LIGHTHOUSE_REACH = 8;
const PLATFORM = 6.6, CLEAR = 22, FOUNDATION = 12;
// chest loot kinds (mobs/spawnerBlocks.js LOOT; every kind of the 4-bit chest meta is taken, so these are reused):
// shipwreck supplies, shipwreck map chest (charts, books, compass) and shipwreck treasure
export const LIGHTHOUSE_LOOT = { stores: 5, chart: 9, strongbox: 8 };

const COASTS = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // the world direction local +v points to, for dir 0..3 (siteKit.toWorld)

const kind = makeSiteKind({
  salt: 9393, region: 200, reach: LIGHTHOUSE_REACH, chance: 0.5, tries: 40,
  probe(gen, cx, cz) {
    const col = gen.column(cx, cz), top = gen.surfaceAt(cx, cz, col);
    if (gen.biomeFor(col, top) !== BIOME.BEACH || top < SEA_LEVEL || top > SEA_LEVEL + 4) return null;
    // the sea: which of eight spots round the point (nine blocks out) are under water; the door faces the driest side
    let wet = 0;
    const dry = [0, 0, 0, 0];
    for (let a = 0; a < 8; a++) {
      const vx = Math.round(Math.cos(a * Math.PI / 4)), vz = Math.round(Math.sin(a * Math.PI / 4));
      const x = cx + vx * 9, z = cz + vz * 9;
      if (gen.surfaceAt(x, z, gen.column(x, z)) < SEA_LEVEL) wet++;
      else for (let d = 0; d < 4; d++) if (COASTS[d][0] * vx + COASTS[d][1] * vz > 0) dry[d]++;
    }
    if (wet < 2 || wet > 6) return null;
    let best = 0;
    for (let d = 1; d < 4; d++) if (dry[d] > dry[best]) best = d;
    return { y: Math.max(top, SEA_LEVEL + 1), dir: best, platformR: PLATFORM };
  },
});
export const lighthouseInRegion = kind.inRegion;
export const lighthousesNear = kind.near;
export const nearestLighthouse = kind.nearest;

// ---- chests, guards ----------------------------------------------------------------------
/** Chests as { u, h, v, fu, fv, loot, lore }, in local coordinates (h is the layer the chest stands on). */
export const LIGHTHOUSE_CHESTS = [
  { u: -2, h: 1, v: 0, fu: 1, fv: 0, loot: LIGHTHOUSE_LOOT.stores },
  { u: 2, h: 7, v: 1, fu: -1, fv: 0, loot: LIGHTHOUSE_LOOT.chart, lore: 'lighthouse' },
  { u: 2, h: 13, v: 0, fu: -1, fv: 0, loot: LIGHTHOUSE_LOOT.strongbox },
];
export function lighthouseChests(s) {
  return LIGHTHOUSE_CHESTS.map((c) => { const [dx, dz] = toWorld(s.dir, c.u, c.v); return { x: s.cx + dx, y: s.y + c.h, z: s.cz + dz, kind: c.loot, lore: c.lore }; });
}
/** Guards as { type, x, y, z } (feet): two Skitterers on the ground floor and a Wickling in the bedroom. */
export function lighthouseGuards(s) {
  const at = (type, u, h, v) => { const [dx, dz] = toWorld(s.dir, u, v); return { type, x: s.cx + dx, y: s.y + h, z: s.cz + dz }; };
  return [at('skitterer', 1, 1, 1), at('skitterer', -1, 1, -1), at('wickling', -1, 7, 0)];
}

// ---- the blocks ------------------------------------------------------------------------
const LADDER = [0, -3];   // the ladder cell (against the wall at v = -4)
const FLOORS = [6, 12];   // the planks of the bedroom and lamp-room floors (layers)
const ROOF = 16;

/**
 * The block of lighthouse s at local (u, h, v) as [id, meta], or null where it leaves the world alone. h = 0 is the platform layer;
 * everything above it inside the footprint is cleared.
 */
export function lighthouseBlock(s, u, h, v) {
  const d = Math.hypot(u, v);
  if (h < 0 || h > CLEAR || d > PLATFORM + 0.6) return null;
  const AIR = [B.AIR, 0];
  const q = (k) => hashf(s.seed, u * 61 + 900, v * 31 + 900, k + h * 13);
  if (h === 0) {
    if (d >= 4.6) return d > PLATFORM ? null : (q(1) < 0.5 ? [B.COBBLESTONE, 0] : q(1) < 0.8 ? [B.STONE_BRICKS, 0] : q(1) < 0.92 ? [B.MOSSY_COBBLESTONE, 0] : [B.GRAVEL, 0]);
    if (d >= 3.2) return q(2) < 0.7 ? [B.STONE_BRICKS, 0] : [B.MOSSY_STONE_BRICKS, 0]; // the foot of the wall
    return d < 1.6 ? [B.SUNBURST_MOSAIC, 0] : [B.AZURE_MOSAIC, 0];
  }
  const wall = d >= 3.2 && d < 4.6;
  const inside = d < 3.2;
  if (h === 1 && !wall && !inside) { // flotsam on the rocks
    if (d <= PLATFORM && q(3) < 0.05) return [B.COBBLESTONE_SLAB, 0];
    return AIR;
  }
  // ---- the lamp room and the roof ----
  if (h >= 13) {
    if (h === ROOF) return d < 4.6 ? [B.RED_CONCRETE, 0] : AIR;
    if (h === ROOF + 1) return d < 3.4 ? [B.RED_CONCRETE, 0] : AIR;
    if (h === ROOF + 2) return d < 2.2 ? [B.RED_CONCRETE, 0] : AIR;
    if (h === ROOF + 3) return d < 1.2 ? [B.RED_CONCRETE, 0] : AIR;
    if (h === ROOF + 4) return u === 0 && v === 0 ? [B.CHAIN, 0] : AIR;
    if (h === ROOF + 5) return u === 0 && v === 0 ? [B.LANTERN, 1] : AIR;
    if (wall) {
      if (h === 13) return [B.WHITE_CONCRETE, 0];
      return Math.abs(u) === 3 && Math.abs(v) === 3 ? [B.RED_CONCRETE, 0] : [B.LEADED_GLASS, 0];
    }
    if (inside) {
      if (h === 13 && u === LADDER[0] && v === LADDER[1]) return [B.LADDER, sideOfLocal(s.dir, 0, -1)]; // the way up ends beside the lamp
      if (h === 13 && u === 0 && v === 0) return [B.POLISHED_ANDESITE, 0];
      if ((h === 14 || h === 15) && u === 0 && v === 0) return [B.LIGHTHOUSE_LENS, 0];
      if (h === 13) {
        const c = LIGHTHOUSE_CHESTS[2];
        if (u === c.u && v === c.v) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (c.loot << 4)];
        if (u === -2 && v === 0) return [B.IRON_BRAZIER, 0];
      }
    }
    return AIR;
  }
  // ---- the floors ----
  if (FLOORS.includes(h)) {
    if (!inside && !wall) return null;
    if (wall) return bandBlock(s, u, v, h, q);
    if (u === LADDER[0] && v === LADDER[1]) return [B.LADDER, sideOfLocal(s.dir, 0, -1)];
    return [B.SPRUCE_PLANKS, 0];
  }
  if (wall) {
    if (u === 0 && v === 4 && h <= 2) return AIR; // the door, inland
    if (h === 3 && u === 0 && v === 4) return [B.ROSE_WINDOW, 0];
    if ((h === 8 || h === 9) && ((Math.abs(u) === 4 && v === 0) || (u === 0 && v === -4))) return [B.LEADED_GLASS, 0];
    if (h === 4 && u === 0 && v === 4) return [B.LEADED_GLASS, 0];
    return bandBlock(s, u, v, h, q);
  }
  if (!inside) return AIR;
  // ---- inside ----
  if (u === LADDER[0] && v === LADDER[1]) return [B.LADDER, sideOfLocal(s.dir, 0, -1)];
  for (const c of LIGHTHOUSE_CHESTS) if (c.h === h && c.u === u && c.v === v) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (c.loot << 4)];
  if (h === 1) {
    if (u === 2 && v === -1) return [B.WORKBENCH, 0];
    if (u === -2 && v === 2) return [B.FURNACE, 0];
    if (u === 2 && v === 2) return [B.BARREL, 0];
  }
  if (h === 3 && v === 0 && Math.abs(u) === 3) return [B.TORCH, 1 + sideOfLocal(s.dir, Math.sign(u), 0)];
  if (h === 9 && v === 0 && Math.abs(u) === 3) return [B.TORCH, 1 + sideOfLocal(s.dir, Math.sign(u), 0)];
  if (h === 7) {
    const sd = sideOfLocal(s.dir, -1, 0);
    if (u === -1 && v === 1) return [B.BED, sd];
    if (u === -2 && v === 1) return [B.BED, sd | BED_HEAD];
    if (u === 2 && v === -2) return [B.BOOKSHELF, 0];
    if (u === 1 && v === -2) return [B.BOOKSHELF, 0];
  }
  if (h === 8 && u === 2 && v === -2) return [B.BOOKSHELF, 0];
  if (h === 11 && u === 0 && v === 0) return [B.CHANDELIER, 0];
  if (h === 7 && u === 0 && v === 2) return [B.CANDLE, 0];
  return AIR;
}

/** The wall's red and white bands (three blocks each) over a stone footing. */
function bandBlock(s, u, v, h, q) {
  if (h <= 3) return q(5) < 0.7 ? [B.STONE_BRICKS, 0] : q(5) < 0.9 ? [B.MOSSY_STONE_BRICKS, 0] : [B.CRACKED_STONE_BRICKS, 0];
  return Math.floor((h - 4) / 3) % 2 === 0 ? [B.WHITE_CONCRETE, 0] : [B.RED_CONCRETE, 0];
}

/** Stamp the parts of nearby lighthouses inside chunk (cx, cz). */
export function stampLighthouses(gen, blocks, meta, cx, cz) {
  stampKind(gen, blocks, meta, cx, cz, lighthousesNear, {
    half: LIGHTHOUSE_HALF, below: 0, clear: CLEAR, foundation: FOUNDATION,
    fill: (s, u, v, h) => (hashf(s.seed, u, v, 80 + h) < 0.55 ? B.COBBLESTONE : B.STONE),
    blockAt: lighthouseBlock,
  });
}
