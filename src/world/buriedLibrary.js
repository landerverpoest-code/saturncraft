// The Buried Library: a sunken stone-brick reading hall far under the hills, in about three 400 x 400 regions in five, beneath
// plains, forests and mountains (never under the sea). The 21 x 15 hall has a vaulted ceiling, rows of Record Shelves and bookshelves
// hung with cobwebs, a reading table with a lectern in the middle and four side alcoves with chests; two shelves on the west wall
// hide a pocket of dripping lava behind them (a trap for the greedy), a Monster Spawner keeps a few Shamblers among the stacks,
// and the only light is a pair of hanging lanterns and a few candles. A spiral stair of loose bricks climbs the shaft at the east
// end up to the surface, where a mossy cobblestone cap hides it. Planned from the seed alone and stamped chunk by chunk.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL } from './constants.js';
import { hashf } from './noise.js';
import { toWorld, sideOfLocal } from './siteKit.js';
import { makeSiteKind, stampKind } from './siteLite.js';

export const LIBRARY_REGION = 400;
export const LIBRARY_REACH = 16;          // half width of the box a library claims
export const LIBRARY_HALF = 15;           // |u| and |v| of the stamped footprint stay within this
export const LIBRARY_MIN_Y = 20, LIBRARY_MAX_Y = 45; // the floor layer of the hall
/** The chest-meta loot kind the library chests carry (the shipwreck supplies kind); game.getChest swaps it for LIBRARY_LOOT. */
export const LIBRARY_CHEST_KIND = 5;
/** The loot table of the library chests. */
export const LIBRARY_LOOT = 17;

const OK_BIOMES = new Set([BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH_FOREST, BIOME.TAIGA, BIOME.SNOWY_PLAINS, BIOME.STONY_PEAKS, BIOME.SNOWY_PEAKS,
  BIOME.SAVANNA, BIOME.DARK_FOREST, BIOME.SNOWY_TAIGA, BIOME.FLOWER_FOREST, BIOME.HIGHLAND_MEADOW]);
const SHAFT = [[12, 0], [12, 1], [13, 1], [14, 1], [14, 0], [14, -1], [13, -1], [12, -1]]; // the ring of the spiral stair round the pillar at (13, 0)

const kind = makeSiteKind({
  salt: 7741, region: LIBRARY_REGION, reach: LIBRARY_REACH, chance: 0.6, tries: 60,
  probe(gen, cx, cz, rng) {
    const col = gen.column(cx, cz), top = gen.surfaceAt(cx, cz, col);
    if (!OK_BIOMES.has(gen.biomeFor(col, top)) || top < SEA_LEVEL + 5) return null;
    // every ground level round the box must be land, and the hall deep enough under the lowest of them
    let hi = 0, lo = 1e9;
    for (let dx = -LIBRARY_REACH; dx <= LIBRARY_REACH; dx += 8) for (let dz = -LIBRARY_REACH; dz <= LIBRARY_REACH; dz += 8) {
      const t = gen.surfaceAt(cx + dx, cz + dz, gen.column(cx + dx, cz + dz));
      if (t < SEA_LEVEL + 3) return null;
      hi = Math.max(hi, t); lo = Math.min(lo, t);
    }
    const y = Math.max(LIBRARY_MIN_Y, Math.min(LIBRARY_MAX_Y, lo - 16 - Math.floor(rng() * 10)));
    if (lo - y < 14 || hi - y > 125) return null;
    return { y, dir: Math.floor(rng() * 4) };
  },
});
/** Fill in the layer of the cap over the shaft (the highest ground above it), a pure function of the seed. */
function withCap(gen, s) {
  if (s && s.capH === undefined) {
    let hi = 0;
    for (let a = 11; a <= 15; a += 2) for (let b = -2; b <= 2; b += 2) {
      const [dx, dz] = toWorld(s.dir, a, b);
      hi = Math.max(hi, gen.surfaceAt(s.cx + dx, s.cz + dz, gen.column(s.cx + dx, s.cz + dz)));
    }
    s.capH = hi - s.y;
  }
  return s;
}
export const libraryInRegion = (gen, rx, rz) => withCap(gen, kind.inRegion(gen, rx, rz));
export const librariesNear = (gen, x0, z0, x1, z1) => kind.near(gen, x0, z0, x1, z1).map((s) => withCap(gen, s));
export const nearestLibrary = (gen, x, z, maxRings) => withCap(gen, kind.nearest(gen, x, z, maxRings));

// ---- chests, guards ------------------------------------------------------------------------
/** Chests as { u, h, v, fu, fv } in local coordinates: one per alcove and the bait chests behind the lava shelves. */
export const LIBRARY_CHESTS = [
  { u: 6, h: 1, v: 10, fu: 0, fv: -1 }, { u: -6, h: 1, v: 10, fu: 0, fv: -1 },
  { u: 6, h: 1, v: -10, fu: 0, fv: 1 }, { u: -6, h: 1, v: -10, fu: 0, fv: 1 },
  { u: -12, h: 1, v: 4, fu: 1, fv: 0 }, { u: -12, h: 1, v: -4, fu: 1, fv: 0 },
];
export function libraryChests(s) {
  return LIBRARY_CHESTS.map((c) => { const [dx, dz] = toWorld(s.dir, c.u, c.v); return { x: s.cx + dx, y: s.y + c.h, z: s.cz + dz, kind: LIBRARY_CHEST_KIND }; });
}
/** The loot kind to roll for a chest at (x, z) whose meta says `kind`: LIBRARY_LOOT inside a library's footprint, else `kind`. */
export function libraryLootKind(gen, x, z, kind0) {
  if (kind0 !== LIBRARY_CHEST_KIND || !gen || gen.dimension) return kind0;
  return librariesNear(gen, x, z, x, z).some((s) => Math.abs(s.cx - x) <= LIBRARY_HALF && Math.abs(s.cz - z) <= LIBRARY_HALF) ? LIBRARY_LOOT : kind0;
}
/** The Shamblers that wander the stacks as { type, x, y, z } (feet). */
export function libraryGuards(s) {
  const at = (u, v) => { const [dx, dz] = toWorld(s.dir, u, v); return { type: 'shambler', x: s.cx + dx, y: s.y + 1, z: s.cz + dz }; };
  return [at(4, 5), at(-4, -5), at(8, 0)];
}
/** The Monster Spawner's spot (world coordinates). */
export function librarySpawnerSpot(s) {
  const [dx, dz] = toWorld(s.dir, -7, 0);
  return { x: s.cx + dx, y: s.y + 1, z: s.cz + dz };
}

// ---- the hall ------------------------------------------------------------------------------
/** The layer of the vault's ceiling over lateral position v. */
export const libraryCeiling = (v) => { const a = Math.abs(v); return a <= 1 ? 9 : a <= 3 ? 8 : a <= 5 ? 7 : a <= 6 ? 6 : 5; };
const VAULT_TOP = 10;

/**
 * The block of library s at local (u, h, v) as [id, meta], or null where it leaves the world alone. h = 0 is the floor layer of the
 * hall; the shaft reaches up to s.capH, where the mossy cobblestone cap sits.
 */
export function libraryBlock(s, u, h, v) {
  if (h < 0 || Math.abs(u) > LIBRARY_HALF || Math.abs(v) > 12) return null;
  const AIR = [B.AIR, 0];
  const q = (k) => hashf(s.seed, u * 61 + 900, v * 31 + 900, k + h * 13);
  const brick = (k = 1) => { const t = q(k); return [t < 0.62 ? B.STONE_BRICKS : t < 0.82 ? B.MOSSY_STONE_BRICKS : B.CRACKED_STONE_BRICKS, 0]; };
  const capH = s.capH ?? 30;

  // ---- the stair shaft (3 x 3 at u 12..14, v -1..1) and its shell ----
  if (u >= 12 && u <= 15 && Math.abs(v) <= 2) {
    if (u === 15 || Math.abs(v) === 2) return h < capH ? brick(5) : null;
    if (h > capH) return null;
    if (h === capH) return [B.MOSSY_COBBLESTONE, 0];
    if (h === 0) return brick(2);
    if (u === 13 && v === 0) return brick(3);                                    // the pillar
    const i = SHAFT.findIndex((c) => c[0] === u && c[1] === v);
    return h % 8 === i && h <= capH - 3 ? brick(4) : AIR;                        // a step, or the open shaft
  }

  // ---- the lava pockets behind the two west shelves ----
  const tv = v > 0 ? 4 : -4;
  if (u <= -11 && u >= -13 && Math.abs(v - tv) <= 1 && h <= 4) {
    if (v === tv && u >= -12 && h >= 1 && h <= 3) {
      if (u === -12 && h === 1) return [B.CHEST, sideOfLocal(s.dir, 1, 0) | 8 | (LIBRARY_CHEST_KIND << 4)];
      if (h === 3) return [B.LAVA, 0];                                          // a source that drips down onto the bait
      return AIR;
    }
    return brick(6);
  }

  // ---- the side alcoves (3 wide, 3 deep, at u = +-6) ----
  const av = v > 0 ? 1 : -1;
  for (const au of [6, -6]) {
    if (Math.abs(u - au) <= 2 && v * av >= 8 && v * av <= 11 && h <= 5) {
      const inside = Math.abs(u - au) <= 1 && v * av <= 10;
      if (inside && h >= 1 && h <= 3) {
        for (const c of LIBRARY_CHESTS) if (c.u === u && c.v === v && c.h === h) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (LIBRARY_CHEST_KIND << 4)];
        if (h === 1 && Math.abs(u - au) === 1 && v * av === 10) return [B.CANDLE, 0];
        return AIR;
      }
      if (inside && h === 0) return brick(7);
      return brick(8);
    }
  }

  // ---- the hall ----
  if (Math.abs(u) <= 11 && Math.abs(v) <= 8 && h <= VAULT_TOP) {
    if (Math.abs(u) > 10 || Math.abs(v) > 7) return u === 11 && v === 0 && (h === 1 || h === 2) ? AIR : brick(9); // walls (the doorway to the shaft)
    const ceil = libraryCeiling(v);
    if (h > ceil) return brick(10);
    if (h === ceil) return Math.abs(u) % 5 === 0 ? [B.CHISELED_STONE_BRICKS, 0] : brick(11);
    if (h === 0) { const t = q(12); return [t < 0.5 ? B.STONE_BRICKS : t < 0.75 ? B.MOSSY_STONE_BRICKS : t < 0.9 ? B.CRACKED_STONE_BRICKS : B.COBBLESTONE, 0]; }
    // the reading table in the middle
    if (Math.abs(u) <= 2 && v === 0 && h === 1) return [B.SPRUCE_PLANKS, 0];
    if (u === 0 && v === 0 && h === 2) return [B.LECTERN, sideOfLocal(s.dir, 0, -1)];
    if (Math.abs(u) === 2 && v === 0 && h === 2) return [B.CANDLE, 0];
    if (u === -7 && v === 0 && h === 1) return [B.SPAWNER, 0];
    // hanging lanterns, the only real light
    if (Math.abs(u) === 8 && v === 0 && h === ceil - 1) return [B.LANTERN, 1];
    // the shelves: two rows across the hall, a run along each side wall and the end walls, with bare bays and cobwebs
    const shelf = () => {
      if (q(13) < 0.1) return q(14) < 0.5 ? [B.COBWEB, 0] : AIR;
      return h % 2 === 1 && q(15) < 0.7 ? [B.RECORD_SHELF, 0] : [B.BOOKSHELF, 0];
    };
    if (u === -10 && Math.abs(v) === 4 && h <= 2) return [B.BOOKSHELF, 0];     // the panels over the lava pockets
    if (h <= 4) {
      if (Math.abs(v) === 4 && Math.abs(u) >= 3 && Math.abs(u) <= 8) return shelf();
      if (Math.abs(v) === 7 && Math.abs(u) <= 9 && Math.abs(Math.abs(u) - 6) > 1) return shelf();
      if (u === -10 && Math.abs(v) >= 2 && Math.abs(v) <= 6 && Math.abs(v) !== 4) return shelf();
      if (u === 10 && Math.abs(v) >= 3 && Math.abs(v) <= 6) return shelf();
    }
    if (h === ceil - 1 && q(16) < 0.14) return [B.COBWEB, 0];                   // cobwebs under the vault
    if (h === 1 && q(17) < 0.02 && Math.abs(v) !== 4) return [B.COBWEB, 0];
    return AIR;
  }
  return null;
}

/** Stamp the parts of nearby Buried Libraries inside chunk (cx, cz). */
export function stampLibraries(gen, blocks, meta, cx, cz) {
  stampKind(gen, blocks, meta, cx, cz, librariesNear, {
    half: LIBRARY_HALF, below: 0, clear: 140, foundation: 0, fill: () => B.STONE, blockAt: libraryBlock,
  });
}
