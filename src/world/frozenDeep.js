// The Frozen Deep: a deeper, stranger Frozen Ocean, made of three decoration passes that run after the ordinary terrain (like
// world/deepSea.js), so the terrain noise, the carvers and every older structure keep producing exactly what they always did.
// Everything is a closed-form function of the seed and the coordinates, so the pass looks the same across chunk borders and on
// every machine of a multiplayer game.
//  * Frozen Deep biome (frozenDeep pass): the part of a Frozen Ocean whose floor lies 23 or more blocks under the surface. Under
//    it the ice sheet breaks into ice floes: thick plates of Packed Ice, a block or two proud of the sheet and hanging deeper
//    under it, with open dark leads of water between them.
//  * Icebergs (iceberg pass): about one 144 x 144 region in two that holds a deep frozen ocean has one: a tall, uneven tower of
//    Packed Ice and Ice, snow on its peaks and a deep keel. Inside it is hollow: a chamber whose back half is a dry ledge with a
//    chest (the igloo's loot table) and a Tide Lantern in the ceiling, its front half a pool that an underwater tunnel feeds.
//  * Icebound Hulks (frozenHulk pass): the wreck of a spruce ship frozen into the sheet, stern down in the water, bow in the air.
//    A hatch in the ice leads down to the flooded hold (a treasure chest); the forecastle holds a supply chest.
// Planned from the seed alone and stamped chunk by chunk (world/siteLite.js).
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL, cidx } from './constants.js';
import { Simplex, hash4, hashf } from './noise.js';
import { toWorld, sideOfLocal } from './siteKit.js';
import { makeSiteKind, stampKind } from './siteLite.js';
import { grottosNear, seaBiomeFor, DEEP_TOP } from './deepSea.js';

export { DEEP_TOP };
/** Chest loot kinds (mobs/spawnerBlocks.js LOOT): the igloo's table for the berg, the wreck tables for the hulk. */
export const FROZEN_LOOT = { berg: 4, hullTreasure: 8, hullSupply: 5 };

const noiseCache = new WeakMap();
function floeNoise(gen) {
  let n = noiseCache.get(gen);
  if (!n) { n = { floe: new Simplex(hash4(gen.seed, 31, 611, 3)), crack: new Simplex(hash4(gen.seed, 32, 611, 3)) }; noiseCache.set(gen, n); }
  return n;
}
export const FLOE_MIN = 0.3, LEAD_MAX = -0.56;

/** The floe field at world (x, z): above FLOE_MIN is a floe, below LEAD_MAX a lead of open water, in between plain sheet. */
export function floeValue(gen, x, z) {
  const N = floeNoise(gen);
  return N.floe.noise2(x / 20, z / 20) * 0.85 + N.crack.noise2(x / 7, z / 7) * 0.15;
}
/** How the sheet looks at (x, z): { kind: 'floe' | 'lead' | 'sheet', thick (floes: blocks of Packed Ice under the sheet), rise (blocks over it) }. */
export function floeAt(gen, x, z) {
  const f = floeValue(gen, x, z);
  if (f > FLOE_MIN) return { kind: 'floe', thick: Math.min(4, 1 + Math.floor((f - FLOE_MIN) * 9)), rise: f > FLOE_MIN + 0.16 ? 2 : 1 };
  if (f < LEAD_MAX) return { kind: 'lead', thick: 0, rise: 0 };
  return { kind: 'sheet', thick: 0, rise: 0 };
}

/** The biome the sea passes paint over a generator biome `base` whose floor is `top` (Frozen Deep, Deep Ocean, Kelp Forest): what /locate biome looks for. */
export function deepBiomeFor(gen, base, top, x, z) {
  if (base === BIOME.FROZEN_OCEAN) return top <= DEEP_TOP ? BIOME.FROZEN_DEEP : base;
  return seaBiomeFor(gen, base, top, x, z);
}

/**
 * The frozen deep pass over chunk (cx, cz): paints the Frozen Deep biome and breaks the ice sheet into floes. `heightmap` and `biomes` are the
 * chunk's arrays (the heightmap is the sea floor's here, as in the deep sea pass).
 */
export function stampFrozenDeep(gen, blocks, meta, cx, cz, heightmap, biomes) {
  const X0 = cx * 16, Z0 = cz * 16;
  let any = false;
  for (let i = 0; i < 256; i++) if (biomes[i] === BIOME.FROZEN_OCEAN) { any = true; break; }
  if (!any) return;
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const ci = x + z * 16;
    if (biomes[ci] !== BIOME.FROZEN_OCEAN || heightmap[ci] > DEEP_TOP) continue;
    biomes[ci] = BIOME.FROZEN_DEEP;
    const cap = cidx(x, SEA_LEVEL, z);
    if (blocks[cap] !== B.ICE) continue;
    const f = floeAt(gen, X0 + x, Z0 + z);
    if (f.kind === 'lead') { blocks[cap] = B.WATER; meta[cap] = 0; continue; }
    if (f.kind !== 'floe') continue;
    blocks[cap] = B.PACKED_ICE;
    for (let k = 1; k <= f.thick; k++) { const i = cidx(x, SEA_LEVEL - k, z); if (blocks[i] === B.WATER) { blocks[i] = B.PACKED_ICE; meta[i] = 0; } }
    for (let k = 1; k <= f.rise; k++) {
      const i = cidx(x, SEA_LEVEL + k, z);
      if (blocks[i] === B.AIR || blocks[i] === B.SNOW_LAYER) { blocks[i] = k === f.rise && hashf(gen.seed, X0 + x, Z0 + z, 6101) < 0.55 ? B.SNOW_BLOCK : B.PACKED_ICE; meta[i] = 0; }
    }
  }
}

// ---- icebergs -----------------------------------------------------------------------------
export const BERG_REACH = 21; // R is at most 13 and the wobble at most 1.31 of it, plus the margin
const BERG_ROOM = { u: -1, v: 0, h: 1 }; // the chamber's centre, local
const bergKind = makeSiteKind({
  salt: 6161, region: 144, reach: BERG_REACH, chance: 0.6, tries: 30, siblings: [grottosNear],
  probe(gen, cx, cz, rng) {
    let lo = 999;
    for (const dx of [0, -16, 16]) for (const dz of [0, -16, 16]) {
      const x = cx + dx, z = cz + dz, col = gen.column(x, z), top = gen.surfaceAt(x, z, col);
      if (gen.biomeFor(col, top) !== BIOME.FROZEN_OCEAN) return null;
      lo = Math.min(lo, SEA_LEVEL - top);
    }
    if (lo < 14) return null; // the keel needs water to hang in
    return {
      y: SEA_LEVEL, R: 11 + Math.floor(rng() * 3), top: 11 + Math.floor(rng() * 6), draft: Math.min(12, lo - 3),
      ph1: rng() * 6.283, ph2: rng() * 6.283, ph3: rng() * 6.283,
    };
  },
});
export const icebergInRegion = bergKind.inRegion;
export const icebergsNear = bergKind.near;
export const nearestIceberg = bergKind.nearest;

/** The iceberg's chest, as { x, y, z, kind } in the world. */
export function icebergChests(s) {
  const [dx, dz] = toWorld(s.dir, BERG_ROOM.u - 3, BERG_ROOM.v);
  return [{ x: s.cx + dx, y: s.y + BERG_ROOM.h, z: s.cz + dz, kind: FROZEN_LOOT.berg }];
}

/** Radius of the iceberg's body at height h (h = 0 is the ice sheet's layer) in direction a, or 0 outside its height range. */
export function bergRadius(s, h, a) {
  let t;
  if (h >= 0) { if (h > s.top) return 0; t = 1 - Math.pow(h / (s.top + 1), 1.35); } else { if (-h > s.draft) return 0; t = 1.1 * (1 - Math.pow(-h / (s.draft + 1), 2)); }
  const wob = 1 + 0.16 * Math.sin(3 * a + s.ph1) + 0.1 * Math.sin(5 * a + s.ph2) + 0.05 * Math.sin(8 * a + s.ph3 + h * 0.4);
  return s.R * t * wob;
}

/** The block of iceberg s at local (u, h, v) as [id, meta], or null where it leaves the world alone. */
export function icebergBlock(s, u, h, v) {
  const d = Math.hypot(u, v);
  if (d > s.R * 1.5 + 1) return null;
  const r = bergRadius(s, h, Math.atan2(v, u));
  if (r <= 0 || d > r) return null;
  // the hollow chamber: a dry ledge at the back, a pool in front, fed by a tunnel that opens under the water on the +u side
  const cu = u - BERG_ROOM.u, cv = v - BERG_ROOM.v, ch = h - BERG_ROOM.h;
  const inRoom = (cu / 4.6) ** 2 + (cv / 3.7) ** 2 + (ch / 3.2) ** 2 < 1 && h >= -3;
  if (inRoom) {
    if (h <= -1) return [B.WATER, 0];
    if (h === 0) return cu <= -1 ? [B.PACKED_ICE, 0] : [B.WATER, 0]; // the ledge at the back, the pool in front
    if (h === 1 && cu === -3 && cv === 0) return [B.CHEST, sideOfLocal(s.dir, 1, 0) | 8 | (FROZEN_LOOT.berg << 4)];
    if (h === 4 && cu === 0 && cv === 0) return [B.TIDE_LANTERN, 0];
    return [B.AIR, 0];
  }
  const tunnel = u >= BERG_ROOM.u && h >= -3 && h <= -1 && Math.abs(v) <= 1 && (h !== -3 || Math.abs(v) === 0);
  if (tunnel) return [B.WATER, 0];
  const q = hashf(s.seed, u * 61 + 800, v * 31 + 800, h + 40);
  const shell = d > r - 1.6;
  if (h >= s.top - 3 || (h >= 3 && q < 0.18 && shell)) return [B.SNOW_BLOCK, 0];
  if (h > 0) return [shell && q < 0.5 ? B.ICE : B.PACKED_ICE, 0];
  if (h === 0) return [B.PACKED_ICE, 0];
  return [shell && q < 0.6 ? B.ICE : B.PACKED_ICE, 0];
}

/** Stamp the parts of nearby icebergs inside chunk (cx, cz). */
export function stampIcebergs(gen, blocks, meta, cx, cz) {
  stampKind(gen, blocks, meta, cx, cz, icebergsNear, {
    half: BERG_REACH, below: -13, clear: 16, foundation: 0,
    fill: () => B.WATER,
    blockAt: icebergBlock,
  });
}

// ---- icebound hulks -----------------------------------------------------------------------
export const HULK_REACH = 12;
const hulkKind = makeSiteKind({
  salt: 6262, region: 160, reach: HULK_REACH, chance: 0.55, tries: 25, siblings: [icebergsNear, grottosNear],
  probe(gen, cx, cz) {
    for (const [dx, dz] of [[0, 0], [-8, 0], [8, 0], [0, -4], [0, 4]]) {
      const x = cx + dx, z = cz + dz, col = gen.column(x, z), top = gen.surfaceAt(x, z, col);
      if (gen.biomeFor(col, top) !== BIOME.FROZEN_OCEAN || SEA_LEVEL - top < 10) return null;
    }
    return { y: SEA_LEVEL };
  },
});
export const hulkInRegion = hulkKind.inRegion;
export const hulksNear = hulkKind.near;
export const nearestHulk = hulkKind.nearest;

export const HULK_HALF = 8;
/** Height (local, 0 = the ice sheet) of the hull's keel at lengthwise position u: the stern is deep, the bow rides in the air. */
export const hulkKeel = (u) => Math.floor(-6 + (u + 8) * 0.5);
/** Half width of the hull at u (0 at the prow). */
export const hulkWidth = (u) => (u >= 7 ? 0 : u >= 5 ? 1 : u >= 2 ? 2 : u >= -6 ? 3 : 2);
const HATCH = { u: -3, v: 0 };
export const HULK_CHESTS = [
  { u: -3, v: 0, h: hulkKeel(-3) + 1, fu: 1, fv: 0, loot: FROZEN_LOOT.hullTreasure },
  { u: 4, v: 0, h: hulkKeel(4) + 1, fu: -1, fv: 0, loot: FROZEN_LOOT.hullSupply },
];
export function hulkChests(s) {
  return HULK_CHESTS.map((c) => { const [dx, dz] = toWorld(s.dir, c.u, c.v); return { x: s.cx + dx, y: s.y + c.h, z: s.cz + dz, kind: c.loot }; });
}

/** The block of hulk s at local (u, h, v) as [id, meta], or null where it leaves the world alone. h = 0 is the layer of the ice sheet. */
export function hulkBlock(s, u, h, v) {
  const au = Math.abs(u), av = Math.abs(v);
  if (au > HULK_HALF || av > 6 || h < -8 || h > 10) return null;
  const q = (k) => hashf(s.seed, u * 61 + 900, v * 31 + 900, k + h * 13);
  const plank = () => [q(1) < 0.25 ? B.SPRUCE_LOG : B.SPRUCE_PLANKS, 0];
  const kh = hulkKeel(u), w = hulkWidth(u);
  // the mast: a snapped spruce trunk on the centre line, snow on its stump
  if (u === 1 && v === 0 && h > kh && h <= 7) return [h === 7 ? B.SNOW_BLOCK : B.SPRUCE_LOG, 0];
  // drifts of snow banked along the hull above the sheet
  if (h === 1 && av === w + 1 && u >= -3 && u <= 8 && h > kh + 1 && q(5) < 0.7) return [B.SNOW_BLOCK, 0];
  if (av > w || h < kh || h > kh + 4) return null;
  const edge = av === w, bottom = h === kh;
  for (const c of HULK_CHESTS) if (c.u === u && c.v === v && c.h === h) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (c.loot << 4)];
  if (bottom) return plank();
  const forecastle = u >= 3;
  if (edge || (forecastle && h === kh + 3)) {
    if (h >= kh + 4) return null;
    if (q(2) < 0.1) return null; // a plank sprung loose
    return plank();
  }
  // the interior: water below the sheet, the sheet itself (with a hatch over the hold), then air
  if (h < 0) return [B.WATER, 0];
  if (h === 0) return u === HATCH.u && v === HATCH.v ? [B.WATER, 0] : [B.ICE, 0];
  if (h === kh + 4) return null;
  return [B.AIR, 0];
}

/** Stamp the parts of nearby Icebound Hulks inside chunk (cx, cz). */
export function stampHulks(gen, blocks, meta, cx, cz) {
  stampKind(gen, blocks, meta, cx, cz, hulksNear, {
    half: HULK_HALF + 1, below: -8, clear: 10, foundation: 0,
    fill: () => B.WATER,
    blockAt: hulkBlock,
  });
}
