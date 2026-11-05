// Stargazer's Observatory: the ruin of a round star-watching house on open hills of the plains, savannas and Highland Meadows, in
// about one 240 x 240 region in two (hilltops need level ground over a 17-block square). A drum of stone bricks 12 blocks across
// under a ribbed dome whose panes of leaded glass have mostly fallen in (one side wholly, round an open oculus), a doorway on the
// front, a floor of mosaic laid as a star chart, a pedestal with the astronomer's chart chest at its middle, bookshelves, a
// lectern, braziers and a second chest in a corner. Wicklings and Skitterers have taken the place over.
// Planned from the seed alone and stamped chunk by chunk (world/siteLite.js).
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL } from './constants.js';
import { hashf } from './noise.js';
import { toWorld, sideOfLocal } from './siteKit.js';
import { makeSiteKind, stampKind, oldBrick } from './siteLite.js';
import { lighthousesNear } from './lighthouse.js';
import { mireShrinesNear } from './mireShrine.js';

export const OBSERVATORY_HALF = 8;
export const OBSERVATORY_REACH = 9;
const CLEAR = 15, FOUNDATION = 12, DOME_R = 6, DOME_Y = 7, PLATFORM = 8.3;
// chest loot kinds (mobs/spawnerBlocks.js LOOT): the shipwreck map chest (paper, books, compass, clock, charts) for the astronomer's
// pedestal and the ruined rift's gold for the corner chest
export const OBSERVATORY_LOOT = { chart: 9, corner: 7 };
const isHill = (b) => b === BIOME.PLAINS || b === BIOME.SAVANNA || b === BIOME.HIGHLAND_MEADOW;

const kind = makeSiteKind({
  salt: 9595, region: 240, reach: OBSERVATORY_REACH, chance: 0.35, tries: 24, siblings: [lighthousesNear, mireShrinesNear],
  probe(gen, cx, cz) {
    let lo = 999, hi = -999, sum = 0, n = 0;
    for (const dx of [0, -9, 9]) for (const dz of [0, -9, 9]) {
      const x = cx + dx, z = cz + dz, col = gen.column(x, z), top = gen.surfaceAt(x, z, col);
      if (!isHill(gen.biomeFor(col, top)) || top <= SEA_LEVEL + 2) return null;
      lo = Math.min(lo, top); hi = Math.max(hi, top); sum += top; n++;
    }
    if (hi - lo > 6) return null;
    return { y: Math.floor(sum / n), platformR: PLATFORM };
  },
});
export const observatoryInRegion = kind.inRegion;
export const observatoriesNear = kind.near;
export const nearestObservatory = kind.nearest;

// ---- chests, guards ----------------------------------------------------------------------
/** Chests as { u, h, v, fu, fv, loot, lore } (h is the layer the chest stands on). */
export const OBSERVATORY_CHESTS = [
  { u: 0, h: 2, v: 0, fu: 0, fv: 1, loot: OBSERVATORY_LOOT.chart, lore: 'observatory' },
  { u: -3, h: 1, v: -3, fu: 0, fv: 1, loot: OBSERVATORY_LOOT.corner },
];
export function observatoryChests(s) {
  return OBSERVATORY_CHESTS.map((c) => { const [dx, dz] = toWorld(s.dir, c.u, c.v); return { x: s.cx + dx, y: s.y + c.h, z: s.cz + dz, kind: c.loot, lore: c.lore }; });
}
/** Guards as { type, x, y, z }: two Wicklings and two Skitterers on the star floor. */
export function observatoryGuards(s) {
  const at = (type, u, h, v) => { const [dx, dz] = toWorld(s.dir, u, v); return { type, x: s.cx + dx, y: s.y + h, z: s.cz + dz }; };
  return [at('wickling', -2, 1, 2), at('wickling', 2, 1, -2), at('skitterer', 3, 1, 1), at('skitterer', -1, 1, -3)];
}

// ---- the blocks ------------------------------------------------------------------------
/** Is the dome's panel at this point broken (the east side is fallen in; elsewhere a share is missing)? */
const panelGone = (s, u, h, v, q) => (u > 1 && h > 8 ? q(21) < 0.85 : q(22) < 0.4);

/**
 * The block of observatory s at local (u, h, v) as [id, meta], or null where it leaves the world alone. h = 0 is the floor layer;
 * everything above it inside the footprint is cleared.
 */
export function observatoryBlock(s, u, h, v) {
  const d = Math.hypot(u, v);
  if (h < 0 || h > CLEAR || d > PLATFORM + 0.4) return null;
  const AIR = [B.AIR, 0];
  const q = (k) => hashf(s.seed, u * 61 + 900, v * 31 + 900, k + h * 13);
  const brick = (k = 1) => oldBrick(s.seed, u, v + h * 7, k, 0.3);
  if (h === 0) {
    if (d > PLATFORM) return null;
    if (d >= 6.4) return q(1) < 0.55 ? [B.STONE_BRICKS, 0] : q(1) < 0.8 ? [B.COBBLESTONE, 0] : q(1) < 0.92 ? [B.MOSSY_COBBLESTONE, 0] : [B.GRAVEL, 0];
    if (d >= 5.2) return brick(2);
    // the star chart: a sunburst heart, eight rays of it, the rest in azure
    const au = Math.abs(u), av = Math.abs(v);
    return d < 1.8 || au === av || au === 0 || av === 0 ? [B.SUNBURST_MOSAIC, 0] : q(3) < 0.1 ? [B.MOSSY_STONE_BRICKS, 0] : [B.AZURE_MOSAIC, 0];
  }
  const wall = d >= 5.2 && d < 6.4;
  if (wall && h <= 6) {
    if (v > 0 && Math.abs(u) <= 1 && h <= 3) return AIR; // the doorway on the front
    if (h <= 2 && v > 0 && Math.abs(u) <= 1) return AIR;
    const top = 3 + Math.floor(q(4) * 4);
    if (h > top) return AIR;
    if ((h === 3 || h === 4) && ((Math.abs(u) === 6 && v === 0) || (u === 0 && v === -6))) return h === 3 && u === 0 ? [B.ROSE_WINDOW, 0] : [B.LEADED_GLASS, 0];
    return brick(5);
  }
  if (d < 5.2 && h <= 6) {
    // ---- inside ----
    for (const c of OBSERVATORY_CHESTS) if (c.h === h && c.u === u && c.v === v) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (c.loot << 4)];
    if (h === 1 && u === 0 && v === 0) return [B.CHISELED_STONE_BRICKS, 0];
    if (h === 1 && v === -5 && Math.abs(u) <= 1) return [B.BOOKSHELF, 0];
    if (h === 2 && v === -5 && Math.abs(u) <= 1) return q(6) < 0.7 ? [B.BOOKSHELF, 0] : AIR;
    if (h === 1 && v === -3 && u === 3) return [B.LECTERN, sideOfLocal(s.dir, -1, 0)];
    if (h === 1 && v === 3 && Math.abs(u) === 3) return [B.IRON_BRAZIER, 0];
    if (h === 1 && q(7) < 0.04) return [B.COBWEB, 0];
    return AIR;
  }
  // ---- the dome: a ribbed shell over the drum, mostly fallen in ----
  if (h >= DOME_Y - 1) {
    const dy = h - DOME_Y, R = Math.hypot(d, dy);
    if (dy >= 0 && Math.abs(R - DOME_R) < 0.75 && !(d < 1.6 && h >= DOME_Y + 5)) {
      const a = Math.atan2(v, u) / (Math.PI / 4), arc = Math.abs(a - Math.round(a)) * (Math.PI / 4) * Math.max(d, 1);
      if (arc < 0.7 && q(8) < 0.9) return brick(9);
      if (panelGone(s, u, h, v, q)) return AIR;
      return q(23) < 0.08 ? [B.ROSE_WINDOW, 0] : [B.LEADED_GLASS, 0];
    }
  }
  return AIR;
}

/** Stamp the parts of nearby observatories inside chunk (cx, cz). */
export function stampObservatories(gen, blocks, meta, cx, cz) {
  stampKind(gen, blocks, meta, cx, cz, observatoriesNear, {
    half: OBSERVATORY_HALF, below: 0, clear: CLEAR, foundation: FOUNDATION,
    fill: (s, u, v, h) => (hashf(s.seed, u, v, 80 + h) < 0.45 ? B.COBBLESTONE : B.STONE_BRICKS),
    blockAt: observatoryBlock,
  });
}
