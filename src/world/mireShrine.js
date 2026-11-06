// Mire Shrine: a half-sunken shrine of mossy stone in the swamps and mangrove swamps, in about one 208 x 208 region in
// three. A 17 x 17 walled court dug into the bog and flooded knee-deep, floored in Azure Mosaic with a Sunburst Mosaic star,
// with a gateway on the front side, leaded-glass windows, two pairs of pillars joined by beams that carry Chandeliers, Iron
// Braziers by the gate and, at the back, a raised dais under a Rose Window with the altar chest. A ladder of rope drops down
// from the dais into a sealed, flooded crypt with two more chests. Wicklings stand on the dais (they cannot bear the water
// of the court) and Sodden Shamblers drift in the crypt. Planned from the seed alone and stamped chunk by chunk (world/siteLite.js).
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL } from './constants.js';
import { hashf } from './noise.js';
import { toWorld, sideOfLocal } from './siteKit.js';
import { makeSiteKind, stampKind, oldBrick } from './siteLite.js';
import { lighthousesNear } from './lighthouse.js';

export const MIRE_HALF = 8;
export const MIRE_REACH = 9;
const CLEAR = 9, FOUNDATION = 8, WALL_TOP = 5;
// chest loot kinds (mobs/spawnerBlocks.js LOOT): the Sunken Ruins' table (tide crystals, books) for the altar and one crypt chest,
// the Deep Hush's ruins (moss, candles, bones) for the other
export const MIRE_LOOT = { altar: 15, crypt: 15, deep: 12 };
const isBog = (b) => b === BIOME.SWAMP || b === BIOME.MANGROVE_SWAMP;

const kind = makeSiteKind({
  salt: 9494, region: 208, reach: MIRE_REACH, chance: 0.66, tries: 40, siblings: [lighthousesNear],
  probe(gen, cx, cz) {
    for (const dx of [0, -10, 10]) for (const dz of [0, -10, 10]) {
      const x = cx + dx, z = cz + dz, col = gen.column(x, z), top = gen.surfaceAt(x, z, col);
      if (!isBog(gen.biomeFor(col, top)) || top < SEA_LEVEL - 3 || top > SEA_LEVEL + 3) return null;
    }
    return { y: SEA_LEVEL - 1 }; // the court's floor lies a block under the water line
  },
});
export const mireShrineInRegion = kind.inRegion;
export const mireShrinesNear = kind.near;
export const nearestMireShrine = kind.nearest;

// ---- chests, guards ----------------------------------------------------------------------
/** Chests as { u, h, v, fu, fv, loot, lore } (h is the layer the chest stands on). */
export const MIRE_CHESTS = [
  { u: 0, h: 2, v: -7, fu: 0, fv: 1, loot: MIRE_LOOT.altar, lore: 'mire' },
  { u: 1, h: -3, v: -7, fu: 0, fv: 1, loot: MIRE_LOOT.crypt },
  { u: -1, h: -3, v: -7, fu: 0, fv: 1, loot: MIRE_LOOT.deep },
];
export function mireChests(s) {
  return MIRE_CHESTS.map((c) => { const [dx, dz] = toWorld(s.dir, c.u, c.v); return { x: s.cx + dx, y: s.y + c.h, z: s.cz + dz, kind: c.loot, lore: c.lore }; });
}
/** Guards as { type, x, y, z }: two Wicklings on the dais, two Sodden Shamblers in the crypt. */
export function mireGuards(s) {
  const at = (type, u, h, v) => { const [dx, dz] = toWorld(s.dir, u, v); return { type, x: s.cx + dx, y: s.y + h, z: s.cz + dz }; };
  return [at('wickling', -2, 2, -6), at('wickling', 2, 2, -5), at('sodden_shambler', 0, -3, -5), at('sodden_shambler', 2, -3, -6)];
}

// ---- the blocks ------------------------------------------------------------------------
export const MIRE_LADDER = [-2, -5]; // the rope ladder's column (it hangs on the crypt's west wall)
const PILLARS = [[-4, 2], [4, 2], [-4, -1], [4, -1]];
const onDais = (u, v) => Math.abs(u) <= 3 && v >= -7 && v <= -5;
const CRYPT_U = 2, CRYPT_V0 = -8, CRYPT_V1 = -3; // the crypt's inside: |u| <= 2, v -7..-4 (shell at -8 and -3)

/**
 * The block of shrine s at local (u, h, v) as [id, meta], or null where it leaves the world alone. h = 0 is the court's floor
 * layer; layer 1 is the water (and the dais) and everything above it inside the court is cleared.
 */
export function mireBlock(s, u, h, v) {
  const au = Math.abs(u), av = Math.abs(v), m = Math.max(au, av);
  if (m > MIRE_HALF || h < -5 || h > CLEAR) return null;
  const AIR = [B.AIR, 0], WATER = [B.WATER, 0];
  const q = (k) => hashf(s.seed, u * 61 + 900, v * 31 + 900, k + h * 13);
  const brick = (k = 1) => oldBrick(s.seed, u, v + h * 7, k, 0.5);

  // ---- the crypt under the dais: a brick shell round a flooded room, entered by the rope ladder ----
  if (h < 0) {
    if (au > CRYPT_U + 1 || v < CRYPT_V0 || v > CRYPT_V1 || h < -4) return null;
    if (h === -4 || au === CRYPT_U + 1 || v === CRYPT_V0 || v === CRYPT_V1) return brick(2);
    if (u === MIRE_LADDER[0] && v === MIRE_LADDER[1] && h >= -3) return [B.ROPE_LADDER, sideOfLocal(s.dir, -1, 0)];
    for (const c of MIRE_CHESTS) if (c.h === h && c.u === u && c.v === v) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (c.loot << 4)];
    if (h === -3 && au === 2 && v === -4) return [B.CANDLE, 0];
    return WATER;
  }

  // ---- the floor ----
  if (h === 0) {
    if (u === MIRE_LADDER[0] && v === MIRE_LADDER[1]) return [B.ROPE_LADDER, sideOfLocal(s.dir, -1, 0)]; // the hole in the dais
    if (m === MIRE_HALF) return brick(3);
    const star = (au === av) || au === 0 || av === 0;
    if (Math.hypot(u, v + 1) < 2 || (star && m <= 5)) return [B.SUNBURST_MOSAIC, 0];
    return q(4) < 0.12 ? [B.MOSSY_STONE_BRICKS, 0] : (au + av) % 4 === 0 ? [B.SMOOTH_STONE, 0] : [B.AZURE_MOSAIC, 0];
  }

  // ---- the wall ----
  if (m === MIRE_HALF) {
    if (v === MIRE_HALF && au <= 1) return h <= 3 ? AIR : h === 4 ? [B.CHISELED_STONE_BRICKS, 0] : AIR; // the gateway
    const top = q(5) < 0.2 ? 2 : WALL_TOP - (q(6) < 0.3 ? 1 : 0) - (au + av > 12 && q(7) < 0.4 ? 2 : 0);
    if (h > top) return AIR;
    if ((h === 3 || h === 4) && ((au === 8 && Math.abs(v) === 3) || (v === -8 && au <= 1))) return v === -8 ? [B.ROSE_WINDOW, 0] : [B.LEADED_GLASS, 0];
    return brick(8);
  }

  // ---- the dais under the rose window ----
  if (onDais(u, v)) {
    if (u === MIRE_LADDER[0] && v === MIRE_LADDER[1]) return h === 1 ? [B.ROPE_LADDER, sideOfLocal(s.dir, -1, 0)] : AIR;
    if (h === 1) return (au + v) % 2 === 0 ? [B.SUNBURST_MOSAIC, 0] : [B.AZURE_MOSAIC, 0];
    for (const c of MIRE_CHESTS) if (c.h === h && c.u === u && c.v === v) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (c.loot << 4)];
    if (h === 2 && au === 3 && v === -5) return [B.CANDLE, 1];
    return AIR;
  }
  if (v === -4 && au <= 3 && h === 1) return [B.AZURE_MOSAIC_STAIRS, sideOfLocal(s.dir, 0, -1)]; // steps up to the dais (the raised half on the dais side)

  // ---- pillars, beams, chandeliers ----
  for (const [pu, pv] of PILLARS) {
    if (u === pu && v === pv && h <= WALL_TOP - 1) return h === WALL_TOP - 1 ? [B.CHISELED_STONE_BRICKS, 0] : brick(9);
  }
  if (h === WALL_TOP && (v === 2 || v === -1) && au <= 4) return brick(10);
  if (h === WALL_TOP - 1 && u === 0 && (v === 2 || v === -1)) return [B.CHANDELIER, 0];
  if (h === 1 && v === 7 && au === 2) return [B.IRON_BRAZIER, 0];

  // ---- the flooded court ----
  if (h === 1) return WATER;
  if (h === 2 && q(11) < 0.07) return [B.LILY_PAD, 0];
  return AIR;
}

/** Stamp the parts of nearby Mire Shrines inside chunk (cx, cz). */
export function stampMireShrines(gen, blocks, meta, cx, cz) {
  stampKind(gen, blocks, meta, cx, cz, mireShrinesNear, {
    half: MIRE_HALF, below: -5, clear: CLEAR, foundation: FOUNDATION,
    fill: (s, u, v, h) => (hashf(s.seed, u, v, 80 + h) < 0.5 ? B.MOSSY_STONE_BRICKS : B.MUD),
    blockAt: mireBlock,
  });
}
