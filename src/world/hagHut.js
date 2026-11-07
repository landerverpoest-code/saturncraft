// Hag Hut: a stilted cabin of Bog Planks in the swamps and mangrove swamps, reached over bog bridges (about one in two 224 x 224 regions).
// A 7 x 7 room on posts a block or two over the water, with a roof stepped in like a hat, a doorway on the front side and two plank bridges
// running out from it - one straight out of the door, one off to the side - on posts with a lantern every few blocks. Inside: the Hag's
// Cauldron (world/hagCauldron.js), an Alembic, a workbench, shelves and a chest that holds a Written Book with the hag's recipe in riddles.
// Wicklings keep the porch dry. Planned from the seed alone and stamped chunk by chunk (world/siteLite.js).
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL } from './constants.js';
import { hashf } from './noise.js';
import { toWorld, sideOfLocal } from './siteKit.js';
import { makeSiteKind, stampKind } from './siteLite.js';
import { mireShrinesNear } from './mireShrine.js';

export const HAG_HALF = 15;
export const HAG_REACH = 16;
const CLEAR = 10, FOUNDATION = 14, FLOOR = 2, WALL_TOP = 5;
// chest loot kind: the ruins of the Deep Hush's table (moss, candles, bones, ingots) is the nearest to a hag's hoard
export const HAG_LOOT = 12;
const isBog = (b) => b === BIOME.SWAMP || b === BIOME.MANGROVE_SWAMP;

const kind = makeSiteKind({
  salt: 9696, region: 224, reach: HAG_REACH, chance: 0.6, tries: 40, siblings: [mireShrinesNear],
  probe(gen, cx, cz) {
    let ok = 0;
    for (const dx of [0, -8, 8, -16, 16]) for (const dz of [0, -8, 8, -16, 16]) {
      const x = cx + dx, z = cz + dz, col = gen.column(x, z), top = gen.surfaceAt(x, z, col);
      if (!isBog(gen.biomeFor(col, top))) return null;
      if (top >= SEA_LEVEL - 4 && top <= SEA_LEVEL + 2) ok++;
    }
    return ok >= 18 ? { y: SEA_LEVEL } : null; // layer 0 is the top layer of the water
  },
});
export const hagHutInRegion = kind.inRegion;
export const hagHutsNear = kind.near;
export const nearestHagHut = kind.nearest;

// ---- chests, cauldron, guards ----------------------------------------------------------------
/** The hut's chest, as { u, h, v, fu, fv, loot, lore }. */
export const HAG_CHESTS = [{ u: -2, h: FLOOR + 1, v: -2, fu: 0, fv: 1, loot: HAG_LOOT, lore: 'hag' }];
export const HAG_CAULDRON_AT = { u: 0, h: FLOOR + 1, v: 0 };
export function hagChests(s) {
  return HAG_CHESTS.map((c) => { const [dx, dz] = toWorld(s.dir, c.u, c.v); return { x: s.cx + dx, y: s.y + c.h, z: s.cz + dz, kind: c.loot, lore: c.lore }; });
}
/** Where the cauldron stands in the world. */
export function hagCauldronPos(s) {
  const [dx, dz] = toWorld(s.dir, HAG_CAULDRON_AT.u, HAG_CAULDRON_AT.v);
  return { x: s.cx + dx, y: s.y + HAG_CAULDRON_AT.h, z: s.cz + dz };
}
/** Guards as { type, x, y, z }: two Wicklings in the hut's room. */
export function hagGuards(s) {
  const at = (type, u, h, v) => { const [dx, dz] = toWorld(s.dir, u, v); return { type, x: s.cx + dx, y: s.y + h, z: s.cz + dz }; };
  return [at('wickling', 2, FLOOR + 1, 1), at('wickling', -2, FLOOR + 1, 2)];
}

// ---- the blocks ------------------------------------------------------------------------
const POSTS = [[-3, -3], [3, -3], [-3, 3], [3, 3], [0, -3], [-3, 0], [3, 0]];
const isPost = (u, v) => POSTS.some(([a, b]) => a === u && b === v);
export const HAG_BRIDGE_LEN = 11; // each bridge runs this many blocks out from the wall

/**
 * The block of hut s at local (u, h, v) as [id, meta], or null where it leaves the world alone. h = 0 is the top layer of the water; the deck
 * and the hut's floor lie at h = 2. The door is on the +v side; bridge A runs along +v from the door, bridge B along +u from the east wall.
 */
export function hagBlock(s, u, h, v) {
  const au = Math.abs(u), av = Math.abs(v);
  if (au > HAG_HALF || av > HAG_HALF || h < 0 || h > CLEAR) return null;
  const AIR = [B.AIR, 0];
  const q = (k) => hashf(s.seed, u * 61 + 900, v * 31 + 900, k + h * 13);
  const plank = () => [B.BOG_PLANKS, 0];
  const inRoom = au <= 3 && av <= 3;

  // ---- the bridges: a deck three wide, posts every fourth block with a lantern on top ----
  const onA = au <= 1 && v >= 4 && v <= 3 + HAG_BRIDGE_LEN;
  const onB = av <= 1 && u >= 4 && u <= 3 + HAG_BRIDGE_LEN;
  const postA = au === 2 && v >= 6 && v <= 3 + HAG_BRIDGE_LEN && (v - 6) % 4 === 0;
  const postB = av === 2 && u >= 6 && u <= 3 + HAG_BRIDGE_LEN && (u - 6) % 4 === 0;
  if (!inRoom) {
    if (onA || onB) {
      if (h < FLOOR) return null;
      if (h === FLOOR) return q(1) < 0.1 ? [B.MOSSY_COBBLESTONE, 0] : plank();
      return h <= FLOOR + 3 ? AIR : null; // headroom for the walker (and the trees' branches go)
    }
    if (postA || postB) {
      if (h < FLOOR) return [B.OAK_LOG, 0];
      if (h === FLOOR) return [B.OAK_LOG, 0];
      if (h === FLOOR + 1) return [B.OAK_FENCE, 0];
      if (h === FLOOR + 2) return [B.LANTERN, 0];
      return null;
    }
    // the roof overhangs the room by one block
    if (h === WALL_TOP + 1 && au <= 4 && av <= 4) return plank();
    return null;
  }

  // ---- the room (7 x 7 on posts) ----
  if (h < FLOOR) return isPost(u, v) ? [B.OAK_LOG, 0] : null;
  if (h === FLOOR) return plank();
  if (h <= WALL_TOP) {
    const edge = au === 3 || av === 3;
    if (edge) {
      if (au === 3 && av === 3) return [B.OAK_LOG, 0]; // corner posts
      if (v === 3 && u === 0 && h <= FLOOR + 2) return AIR; // the doorway
      if (u === 3 && v === 0 && h <= FLOOR + 2) return AIR; // the way out to bridge B
      if ((h === FLOOR + 2) && ((au === 3 && av === 2) || (av === 3 && au === 2 && v === -3))) return [B.GLASS, 0]; // little windows
      return plank();
    }
    // inside
    if (u === HAG_CAULDRON_AT.u && v === HAG_CAULDRON_AT.v && h === HAG_CAULDRON_AT.h) return [B.HAG_CAULDRON, 0];
    for (const c of HAG_CHESTS) if (c.h === h && c.u === u && c.v === v) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (c.loot << 4)];
    if (h === FLOOR + 1) {
      if (u === 2 && v === -2) return [B.BREWING_STAND, 0];
      if (u === -2 && v === 2) return [B.WORKBENCH, 0];
      if (u === 2 && v === 2) return [B.CANDLE, 0];
      if (au === 2 && v === 0) return [B.BOOKSHELF, 0];
    }
    if (h === FLOOR + 2 && au === 2 && v === 0) return [B.BOOKSHELF, 0];
    if (h === WALL_TOP && u === 0 && v === 0) return [B.LANTERN, 0];
    return AIR;
  }
  // ---- the roof: stepped in like a hat, a point on top ----
  if (h === WALL_TOP + 1) return au <= 4 && av <= 4 ? plank() : null;
  if (h === WALL_TOP + 2) return au <= 2 && av <= 2 ? plank() : null;
  if (h === WALL_TOP + 3) return au <= 1 && av <= 1 ? plank() : null;
  if (h === WALL_TOP + 4) return au === 0 && av === 0 ? [B.BOG_PLANKS, 0] : null;
  return null;
}

/** Stamp the parts of nearby Hag Huts inside chunk (cx, cz). */
export function stampHagHuts(gen, blocks, meta, cx, cz) {
  stampKind(gen, blocks, meta, cx, cz, hagHutsNear, {
    half: HAG_HALF, below: 0, clear: CLEAR, foundation: FOUNDATION,
    // the posts reach down to the bottom (the water is left alone elsewhere)
    fill: (s, u, v) => (isPost(u, v) || ((Math.abs(u) === 2 && (v - 6) % 4 === 0 && v >= 6 && v <= 3 + HAG_BRIDGE_LEN) || (Math.abs(v) === 2 && (u - 6) % 4 === 0 && u >= 6 && u <= 3 + HAG_BRIDGE_LEN)) ? B.OAK_LOG : B.WATER),
    blockAt: hagBlock,
  });
}
