// Beacon Lighthouses: a coastal stone-brick tower on a rocky base at the shoreline, in about one 480 x 480 region in two where a
// beach meets the sea. The round tower tapers from 11 blocks across at its foot to 7 at the gallery and stands 29 blocks tall: a
// ladder climbs the inside of the wall through three landings (a store, a watch room and the lamp-room floor), the gallery rings
// a glass-walled lamp room, and a Lighthouse Lens glows on its pedestal under a hanging lantern beneath the roof. A keeper's hut
// stands inland of the tower (bed, furnace, barrel, a chest) joined to the tower door by a short path; one keeper lives in the hut
// and one in the tower. Planned from the seed alone and stamped chunk by chunk, so the host and every guest agree.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL, cidx } from './constants.js';
import { hashf } from './noise.js';
import { toWorld, toLocal, sideOfLocal, chunkSetter } from './siteKit.js';
import { makeSiteKind } from './siteLite.js';
import { lighthousesNear } from './lighthouse.js';
import { mireShrinesNear } from './mireShrine.js';
import { observatoriesNear } from './observatory.js';
import { hagHutsNear } from './hagHut.js';
import { sandvaultsNear } from './sandvault.js';
import { BED_HEAD } from './shapes.js';

export const BEACON_REGION = 480;
export const BEACON_REACH = 15;       // half width of the box a lighthouse claims
export const BEACON_HALF = 14;        // |u| and |v| of the stamped footprint stay within this
export const BEACON_TOP = 29;         // the topmost layer of the tower (the cap of the roof), counted from the platform layer 0
const CLEAR = 32, FOUNDATION = 14, PLATFORM_R = 7.4;
/** The chest-meta loot kind the lighthouse chests carry (the shipwreck supplies kind); mobs/spawnerBlocks.js swaps it for BEACON_LOOT. */
export const BEACON_CHEST_KIND = 5;
/** The loot table of the lighthouse chests (every 4-bit chest kind is taken, so game.getChest asks `beaconLootKind`). */
export const BEACON_LOOT = 16;

const COASTS = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // the world direction local +v points to, for dir 0..3 (siteKit.toWorld)

const kind = makeSiteKind({
  salt: 9911, region: BEACON_REGION, reach: BEACON_REACH, chance: 0.5, tries: 500,
  siblings: [lighthousesNear, mireShrinesNear, observatoriesNear, hagHutsNear, sandvaultsNear],
  probe(gen, cx, cz) {
    const col = gen.column(cx, cz), top = gen.surfaceAt(cx, cz, col);
    if (gen.biomeFor(col, top) !== BIOME.BEACH || top < SEA_LEVEL || top > SEA_LEVEL + 3) return null;
    // the sea: which of eight spots round the point (twelve blocks out) are under water; the door and the hut face the driest side
    let wet = 0;
    const dry = [0, 0, 0, 0];
    for (let a = 0; a < 8; a++) {
      const vx = Math.round(Math.cos(a * Math.PI / 4)), vz = Math.round(Math.sin(a * Math.PI / 4));
      const x = cx + vx * 12, z = cz + vz * 12;
      if (gen.surfaceAt(x, z, gen.column(x, z)) < SEA_LEVEL) wet++;
      else for (let d = 0; d < 4; d++) if (COASTS[d][0] * vx + COASTS[d][1] * vz > 0) dry[d]++;
    }
    if (wet < 2 || wet > 6) return null;
    let best = 0;
    for (let d = 1; d < 4; d++) if (dry[d] > dry[best]) best = d;
    // the keeper's hut stands 10 blocks inland: the ground there must be dry and close to the tower's level
    const [hx, hz] = toWorld(best, 0, 10);
    const hy = gen.surfaceAt(cx + hx, cz + hz, gen.column(cx + hx, cz + hz));
    const y = Math.max(top, SEA_LEVEL + 1);
    if (hy < SEA_LEVEL || hy < y - 2 || hy > y + 3) return null;
    return { y, dir: best, platformR: PLATFORM_R };
  },
});
export const beaconInRegion = kind.inRegion;
export const beaconsNear = kind.near;
export const nearestBeacon = kind.nearest;

// ---- chests, keepers ---------------------------------------------------------------------
/** Chests as { u, h, v, fu, fv }, in local coordinates (h is the layer the chest stands on; fu, fv the way it faces). */
export const BEACON_CHESTS = [
  { u: 2, h: 8, v: 0, fu: -1, fv: 0 },      // the store on the first landing
  { u: -2, h: 15, v: 0, fu: 1, fv: 0 },     // the watch room
  { u: -2, h: 22, v: 0, fu: 1, fv: 0 },     // the lamp room
  { u: 2, h: 1, v: 9, fu: -1, fv: 0 },      // the keeper's chest in the hut
];
export function beaconChests(s) {
  return BEACON_CHESTS.map((c) => { const [dx, dz] = toWorld(s.dir, c.u, c.v); return { x: s.cx + dx, y: s.y + c.h, z: s.cz + dz, kind: BEACON_CHEST_KIND }; });
}
/** The loot kind to roll for a chest at (x, z) whose meta says `kind`: BEACON_LOOT inside a lighthouse's box, else `kind`. */
export function beaconLootKind(gen, x, z, kind0) {
  if (kind0 !== BEACON_CHEST_KIND || !gen || gen.dimension) return kind0;
  return beaconsNear(gen, x, z, x, z).length ? BEACON_LOOT : kind0;
}
/** Keeper settlers as { profession, x, y, z } (feet): one in the hut and one on the watch-room landing. */
export function beaconKeepers(s) {
  const at = (profession, u, h, v) => { const [dx, dz] = toWorld(s.dir, u, v); return { profession, x: s.cx + dx, y: s.y + h, z: s.cz + dz }; };
  return [at('cartographer', 0, 1, 11), at('fletcher', 1, 15, 1)];
}

// ---- the tower -----------------------------------------------------------------------------
const FLOORS = [7, 14, 21];            // the landings (the top one is also the gallery)
const LADDER = [0, -2];                 // the ladder cell, against the pilaster on the wall at -v
const DOOR_V = 3;

/** The outer radius of the tower wall at layer h (1..21): 5.0 at the foot, 3.4 at the gallery. */
export const beaconRadius = (h) => 5.0 - 1.6 * (Math.min(Math.max(h, 1), 21) - 1) / 20;

/**
 * The block of lighthouse s at local (u, h, v) as [id, meta], or null where it leaves the world alone. h = 0 is the platform layer
 * (the shore); everything above it inside the footprint is cleared. The tower stands on (0, 0); the hut lies at v = 8..13.
 */
export function beaconBlock(s, u, h, v) {
  if (h < 0 || h > CLEAR || Math.abs(u) > BEACON_HALF || Math.abs(v) > BEACON_HALF) return null;
  const AIR = [B.AIR, 0];
  const d = Math.hypot(u, v);
  const q = (k) => hashf(s.seed, u * 61 + 900, v * 31 + 900, k + h * 13);
  const brick = (k = 1) => { const t = q(k); return [t < 0.7 ? B.STONE_BRICKS : t < 0.88 ? B.MOSSY_STONE_BRICKS : B.CRACKED_STONE_BRICKS, 0]; };
  const inHut = Math.abs(u) <= 4 && v >= 7 && v <= 14;
  if (!inHut && (Math.abs(u) > 8 || v < -8)) return null;

  if (inHut) return hutBlock(s, u, h, v, q, AIR);
  if (u === 0 && v >= 5 && v <= 7 && h <= 1) return h === 0 ? [q(9) < 0.5 ? B.COBBLESTONE : B.GRAVEL, 0] : AIR; // the path to the hut

  // ---- the rocky base ----
  if (h === 0) {
    if (d > PLATFORM_R + 0.6) return null;
    if (d > 6.2 && q(2) > 0.55) return null;
    return q(1) < 0.45 ? [B.COBBLESTONE, 0] : q(1) < 0.75 ? [B.STONE_BRICKS, 0] : q(1) < 0.9 ? [B.MOSSY_COBBLESTONE, 0] : [B.STONE, 0];
  }
  if (h <= 2 && d > 5.9 && d <= PLATFORM_R && q(3) < 0.2) return [q(4) < 0.7 ? B.COBBLESTONE : B.MOSSY_COBBLESTONE, 0]; // boulders on the shore

  const top = BEACON_TOP;
  // ---- the roof of the lamp room ----
  if (h >= 26) {
    if (h === 26) return d <= 4.5 ? [B.STONE_BRICKS, 0] : AIR;
    if (h === 27) return d <= 3.4 ? [B.STONE_BRICKS, 0] : AIR;
    if (h === 28) return d <= 2.3 ? [B.STONE_BRICKS, 0] : AIR;
    if (h === top) return d <= 1.2 ? [B.CHISELED_STONE_BRICKS, 0] : AIR;
    return AIR;
  }
  // ---- the lamp room (layers 22..25) and its gallery (parapet at 22) ----
  if (h >= 22) {
    if (d > 3.45) {
      if (h === 22 && d > 4.6 && d <= 5.4) return [B.COBBLESTONE_WALL, 0]; // the parapet of the gallery
      return AIR;
    }
    if (d > 2.05) { // the glass walls between stone posts; a door onto the gallery at the front
      if (u === 0 && v === DOOR_V && h <= 23) return AIR;
      if (Math.abs(u) <= 1 && v === -3) return brick(6);
      if (Math.abs(u) === 2 && Math.abs(v) === 2) return brick(6);
      return [B.GLASS, 0];
    }
    if (h === 22 && u === LADDER[0] && v === LADDER[1]) return [B.LADDER, sideOfLocal(s.dir, 0, -1)];
    if (h === 22 && u === 0 && v === 0) return [B.POLISHED_ANDESITE, 0];
    if ((h === 23 || h === 24) && u === 0 && v === 0) return [B.LIGHTHOUSE_LENS, 0];
    if (h === 25 && u === 0 && v === 0) return [B.LANTERN, 1];
    for (const c of BEACON_CHESTS) if (c.h === h && c.u === u && c.v === v) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (BEACON_CHEST_KIND << 4)];
    if (h === 22 && u === 2 && v === 0) return [B.IRON_BRAZIER, 0];
    return AIR;
  }

  // ---- the tapering tower (layers 1..21) ----
  const R = beaconRadius(h);
  if (d > R + 0.45) {
    if (h === 21 && d <= 5.4) return brick(7);                         // the gallery floor
    if (h === 22 && d > 4.6 && d <= 5.4) return [B.COBBLESTONE_WALL, 0];
    return AIR;
  }
  const rin = R - 0.95;
  if (d > rin) { // the wall
    if (u === 0 && v >= DOOR_V && h <= 2) return AIR;                   // the door, inland
    if (v === 0 && Math.abs(u) >= 3 && (h === 4 || h === 11 || h === 18)) return [B.GLASS, 0]; // lit windows
    if (h <= 3 && d > R - 0.2) return q(5) < 0.55 ? [B.STONE_BRICKS, 0] : q(5) < 0.8 ? [B.MOSSY_STONE_BRICKS, 0] : [B.COBBLESTONE, 0];
    if (h % 7 === 0) return [B.CHISELED_STONE_BRICKS, 0];              // a string course at every landing
    return brick(8);
  }
  if (v === -3 && Math.abs(u) <= 1 && d > 2) return brick(8);          // the pilaster the ladder climbs
  if (u === LADDER[0] && v === LADDER[1]) return [B.LADDER, sideOfLocal(s.dir, 0, -1)]; // (through the landings too)
  if (h === 0) return [B.STONE_BRICKS, 0];
  if (FLOORS.includes(h)) return [B.SPRUCE_PLANKS, 0];
  for (const c of BEACON_CHESTS) if (c.h === h && c.u === u && c.v === v) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (BEACON_CHEST_KIND << 4)];
  if (Math.abs(u) === 1 && v === -2 && (h === 3 || h === 10 || h === 17)) return [B.TORCH, 1 + sideOfLocal(s.dir, 0, -1)];
  // furniture of the landings
  if (h === 8 && u === -2 && v === 1) return [B.BARREL, 0];
  if (h === 8 && u === 2 && v === 1) return [B.WORKBENCH, 0];
  if (h === 15 && u === 2 && v === 1) return [B.BOOKSHELF, 0];
  if (h === 15 && u === 2 && v === -1) return [B.BOOKSHELF, 0];
  if (h === 15 && u === -2 && v === 1) return [B.CANDLE, 0];
  return AIR;
}

/** The keeper's hut: a 7 x 6 spruce-and-cobblestone cottage (interior 5 x 4) with a stepped roof, a chimney and a door facing the tower. */
function hutBlock(s, u, h, v, q, AIR) {
  const au = Math.abs(u);
  const wallZone = au <= 3 && v >= 8 && v <= 13;
  if (h === 0) return wallZone ? [B.SPRUCE_PLANKS, 0] : [q(2) < 0.5 ? B.COBBLESTONE : B.GRAVEL, 0];
  if (!wallZone) {
    if (h === 4 && au <= 4 && v >= 7 && v <= 14) return [B.SPRUCE_SLAB, 0]; // the eaves
    return AIR;
  }
  const edgeU = au === 3, edgeV = v === 8 || v === 13;
  if (h <= 3) {
    if (edgeU && edgeV) return [B.SPRUCE_LOG, 0];
    if (edgeU || edgeV) {
      if (u === 0 && v === 8 && h <= 2) return AIR;                      // the door, towards the tower
      if (h === 2 && ((edgeU && v === 10) || (v === 13 && u === 0))) return [B.GLASS_PANE, 0];
      return h === 1 ? [B.COBBLESTONE, 0] : [B.SPRUCE_PLANKS, 0];
    }
    // inside
    for (const c of BEACON_CHESTS) if (c.h === h && c.u === u && c.v === v) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (BEACON_CHEST_KIND << 4)];
    if (h === 1 && u === -2 && v === 9) return [B.BED, sideOfLocal(s.dir, 0, 1)];
    if (h === 1 && u === -2 && v === 10) return [B.BED, sideOfLocal(s.dir, 0, 1) | BED_HEAD];
    if (h === 1 && u === 2 && v === 12) return [B.FURNACE, 0];
    if (h === 1 && u === -2 && v === 12) return [B.BARREL, 0];
    if (h === 1 && u === 0 && v === 12) return [B.WORKBENCH, 0];
    if (h === 3 && u === 0 && v === 10) return [B.LANTERN, 1];           // hangs from the roof
    if (u === 2 && v === 12 && h >= 2) return [B.STONE_BRICKS, 0];       // the chimney stack over the furnace
    return AIR;
  }
  // the roof: a stepped pyramid of planks
  if (h === 4) return u === 2 && v === 12 ? [B.STONE_BRICKS, 0] : [B.SPRUCE_PLANKS, 0];
  if (h === 5) return au <= 2 && v >= 9 && v <= 12 ? (u === 2 && v === 12 ? [B.STONE_BRICKS, 0] : [B.SPRUCE_PLANKS, 0]) : AIR;
  if (h === 6) return au <= 1 && v >= 10 && v <= 11 ? [B.SPRUCE_PLANKS, 0] : u === 2 && v === 12 ? [B.STONE_BRICKS, 0] : AIR;
  return AIR;
}

/** Stamp the parts of nearby Beacon Lighthouses inside chunk (cx, cz). */
export function stampBeacons(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  const sites = beaconsNear(gen, X0, Z0, X0 + 15, Z0 + 15);
  if (!sites.length) return;
  const set = chunkSetter(blocks, meta, cx, cz);
  for (const s of sites) {
    for (let x = Math.max(X0, s.x0); x <= Math.min(X0 + 15, s.x1); x++) for (let z = Math.max(Z0, s.z0); z <= Math.min(Z0 + 15, s.z1); z++) {
      const [u, v] = toLocal(s.dir, x - s.cx, z - s.cz);
      if (Math.abs(u) > BEACON_HALF || Math.abs(v) > BEACON_HALF) continue;
      const hut = Math.abs(u) <= 4 && v >= 5 && v <= 14;
      const rock = Math.hypot(u, v) <= PLATFORM_R + 0.6;
      if (hut || rock) { // build the shore up under the tower and the hut where the ground falls away
        for (let h = -1; h >= -FOUNDATION; h--) {
          const b = blocks[cidx(x - X0, s.y + h, z - Z0)];
          if (b && b !== B.WATER) break;
          set(x, s.y + h, z, hashf(s.seed, u, v, 80 + h) < 0.55 ? B.COBBLESTONE : B.STONE);
        }
      }
      for (let h = 0; h <= CLEAR; h++) {
        const bl = beaconBlock(s, u, h, v);
        if (bl) set(x, s.y + h, z, bl[0], bl[1]);
      }
    }
  }
}
