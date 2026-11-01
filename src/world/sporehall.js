// Sporehalls: an overgrown cloister of mossy stone bricks, giant mushrooms and puzzle rooms in
// the jungle and on the Highland Meadows, in about one 224 x 224 region in twenty-five (both
// biomes need level ground over a 23-block square). A 27 x 27 walled garth (the gate on the front side, local +v) holds four
// giant mushrooms and three roofed wings, each a small puzzle with a chest at the end of it:
//  * the Maze Cellar (west): a walled maze, different in every hall, with a chest in each of its
//    two deepest dead ends;
//  * the Plate Gallery (east): a floor of pressure plates over TNT with a single winding safe
//    path to the chest at the far end;
//  * the Spore Shrine (back): an altar chest guarded by Skitterers and Shamblers, and under its
//    floor, marked by a ring of chiseled bricks, a sealed crypt holding two more chests.
// Planned from the seed alone and stamped chunk by chunk.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL, cidx } from './constants.js';
import { mulberry32, hash4, hashf } from './noise.js';
import { toWorld, toLocal, sideOfLocal, sitesNear, nearestSite, chunkSetter, claimedByOthers } from './siteKit.js';
import { sunkenRuinsNear } from './sunkenRuins.js';
import { sunTombsNear } from './sunTombs.js';
import { skywatchesNear } from './skywatch.js';
import { rimekeepsNear } from './rimekeep.js';

export const SPOREHALL_REGION = 224;
export const SPOREHALL_HALF = 13;        // the garth's half width (27 blocks across)
export const SPOREHALL_REACH = 14;
// chest loot kinds (mobs/spawnerBlocks.js LOOT; every kind of the 4-bit chest meta is taken, so these are reused):
// jungle temple, ruined rift, sun tomb and the Deep Hush's ruins (moss, candles, bones)
export const SPOREHALL_LOOT = { maze: 3, gallery: 7, shrine: 10, crypt: 12 };
const CHANCE = 0.7, TRIES = 30, CLEAR = 22, FOUNDATION = 14, ROOF = 5;
const cache = new Map();
const isWild = (b) => b === BIOME.JUNGLE || b === BIOME.HIGHLAND_MEADOW;

/**
 * The hall of region (rx, rz) or null: { cx, cz, y (garth level), dir (the gate faces local
 * +v), style ('jungle' | 'meadow'), seed, x0, z0, x1, z1 }.
 */
export function sporehallInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 9898));
  let hall = null;
  if (rng() < CHANCE) {
    const R = SPOREHALL_REGION, M = SPOREHALL_REACH + 8;
    for (let k = 0; k < TRIES && !hall; k++) {
      const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
      const dir = Math.floor(rng() * 4), seed = Math.floor(rng() * 1e9);
      let lo = 999, hi = -999, sum = 0, n = 0, ok = true, meadow = false;
      for (const dx of [0, -11, 11]) {
        for (const dz of [0, -11, 11]) {
          const x = cx + dx, z = cz + dz, col = gen.column(x, z), top = gen.surfaceAt(x, z, col), biome = gen.biomeFor(col, top);
          if (!isWild(biome) || top <= SEA_LEVEL + 1) { ok = false; break; }
          if (dx === 0 && dz === 0) meadow = biome === BIOME.HIGHLAND_MEADOW;
          lo = Math.min(lo, top); hi = Math.max(hi, top); sum += top; n++;
        }
        if (!ok) break;
      }
      if (!ok || hi - lo > 10) continue;
      const box = { x0: cx - SPOREHALL_REACH, z0: cz - SPOREHALL_REACH, x1: cx + SPOREHALL_REACH, z1: cz + SPOREHALL_REACH };
      const pad = [box.x0 - 6, box.z0 - 6, box.x1 + 6, box.z1 + 6];
      if (gen.riverInBox && gen.riverInBox(box.x0, box.z0, box.x1, box.z1)) continue;
      if (claimedByOthers(gen, ...pad) || sunkenRuinsNear(gen, ...pad).length || sunTombsNear(gen, ...pad).length ||
          skywatchesNear(gen, ...pad).length || rimekeepsNear(gen, ...pad).length) continue;
      hall = { cx, cz, y: Math.floor(sum / n), dir, style: meadow ? 'meadow' : 'jungle', seed, ...box };
    }
  }
  if (cache.size > 512) cache.clear();
  cache.set(key, hall);
  return hall;
}

export const sporehallsNear = (gen, x0, z0, x1, z1) => sitesNear(sporehallInRegion, gen, SPOREHALL_REGION, SPOREHALL_REACH, x0, z0, x1, z1);
export const nearestSporehall = (gen, x, z, maxRings = 12) => nearestSite(sporehallInRegion, gen, SPOREHALL_REGION, x, z, maxRings);

// ---- the puzzles ----------------------------------------------------------------------
// The maze fills u -13..-5, v -6..6 (grid i = u + 13, j = v + 6): rooms on the odd cells, a passage
// between two rooms on the even cell between them. It is entered from the garth at (i 8, j 7).
export const MAZE_I = 9, MAZE_J = 13, MAZE_ENTRY = [8, 7];
const mazes = new Map();
/** { open: Set of "i,j", depth: Map node "i,j" -> steps from the entrance, chests: [[i, j], [i, j]] } for a hall seed. */
export function mazeLayout(seed) {
  if (mazes.has(seed)) return mazes.get(seed);
  const rng = mulberry32(hash4(seed, 1, 2, 9899));
  const NA = (MAZE_I - 1) / 2, NB = (MAZE_J - 1) / 2, open = new Set(), seen = new Set(), depth = new Map();
  const start = [3, 3]; // the node behind the entrance cell (i 7, j 7)
  const nid = (a, b) => `${a},${b}`;
  const stack = [start];
  seen.add(nid(...start)); open.add(`${2 * start[0] + 1},${2 * start[1] + 1}`); depth.set(`${2 * start[0] + 1},${2 * start[1] + 1}`, 0);
  while (stack.length) {
    const [a, b] = stack[stack.length - 1];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([da, db]) => [a + da, b + db]).filter(([x, y]) => x >= 0 && x < NA && y >= 0 && y < NB && !seen.has(nid(x, y)));
    if (!nb.length) { stack.pop(); continue; }
    const [x, y] = nb[Math.floor(rng() * nb.length)];
    seen.add(nid(x, y));
    open.add(`${2 * x + 1},${2 * y + 1}`); open.add(`${a + x + 1},${b + y + 1}`);
    depth.set(`${2 * x + 1},${2 * y + 1}`, depth.get(`${2 * a + 1},${2 * b + 1}`) + 1);
    stack.push([x, y]);
  }
  open.add(MAZE_ENTRY.join(','));
  // chests in the two deepest dead ends (nodes with a single way in)
  const ends = [...depth.entries()].filter(([k]) => {
    const [i, j] = k.split(',').map(Number);
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => open.has(`${i + di},${j + dj}`)).length === 1 && k !== '7,7';
  }).sort((p, r) => r[1] - p[1] || (p[0] < r[0] ? -1 : 1));
  const chests = ends.slice(0, 2).map(([k]) => k.split(',').map(Number));
  const out = { open, depth, chests };
  if (mazes.size > 64) mazes.clear();
  mazes.set(seed, out);
  return out;
}

// The plate gallery fills u 5..12, v -5..5: a safe path winds from its door (u 5, v 0) to the chest.
const pathCache = new Map();
/** { cells: Set of "u,v" safe to step on, end: v of the last cell (the chest stands at u 12) }. */
export function galleryPath(seed) {
  if (pathCache.has(seed)) return pathCache.get(seed);
  const cells = new Set();
  let b = 0;
  for (let u = 5; u <= 12; u++) {
    const nb = u === 5 ? 0 : Math.max(-4, Math.min(4, b + Math.floor(hashf(seed, u, 3, 95) * 5) - 2));
    for (let c = Math.min(b, nb); c <= Math.max(b, nb); c++) cells.add(`${u},${c}`);
    b = nb;
  }
  const out = { cells, end: b };
  if (pathCache.size > 64) pathCache.clear();
  pathCache.set(seed, out);
  return out;
}
/** Is local floor cell (u, v) of the gallery a hidden plate over TNT? */
export function galleryTrap(h, u, v) {
  if (u < 5 || u > 12 || Math.abs(v) > 5) return false;
  return !galleryPath(h.seed).cells.has(`${u},${v}`) && hashf(h.seed, u, v, 96) < 0.85;
}

// ---- chests, guards ---------------------------------------------------------------------
/** Chests as { u, h, v, fu, fv, loot }, in local coordinates (h is the level the chest stands on). */
export function sporehallChestCells(h) {
  const m = mazeLayout(h.seed), g = galleryPath(h.seed);
  const out = m.chests.map(([i, j]) => ({ u: i - 13, h: 1, v: j - 6, fu: 1, fv: 0, loot: SPOREHALL_LOOT.maze }));
  out.push({ u: 12, h: 1, v: g.end, fu: -1, fv: 0, loot: SPOREHALL_LOOT.gallery });
  out.push({ u: 0, h: 1, v: -12, fu: 0, fv: 1, loot: SPOREHALL_LOOT.shrine });
  out.push({ u: -1, h: -4, v: -10, fu: 0, fv: 1, loot: SPOREHALL_LOOT.crypt }, { u: 1, h: -4, v: -10, fu: 0, fv: 1, loot: SPOREHALL_LOOT.crypt });
  return out;
}
export function sporehallChests(h) {
  return sporehallChestCells(h).map((c) => { const [dx, dz] = toWorld(h.dir, c.u, c.v); return { x: h.cx + dx, y: h.y + c.h, z: h.cz + dz, kind: c.loot }; });
}

/** Guards as { type, x, y, z } (feet): Skitterers in the maze and the shrine, Shamblers in the shrine. */
export function sporehallGuards(h) {
  const m = mazeLayout(h.seed);
  const at = (type, u, hh, v) => { const [dx, dz] = toWorld(h.dir, u, v); return { type, x: h.cx + dx, y: h.y + hh, z: h.cz + dz }; };
  const chestNodes = new Set(m.chests.map((c) => c.join()));
  const mid = [...m.depth.entries()].filter(([k]) => k !== '7,7' && !chestNodes.has(k)).sort((p, r) => (p[1] - r[1]) || (p[0] < r[0] ? -1 : 1));
  const pick = (f) => { const [i, j] = mid[Math.floor(mid.length * f)][0].split(',').map(Number); return [i - 13, j - 6]; };
  const [u1, v1] = pick(0.35), [u2, v2] = pick(0.7);
  return [at('skitterer', u1, 1, v1), at('skitterer', u2, 1, v2), at('skitterer', -2, 1, -9), at('skitterer', 2, 1, -9),
    at('shambler', -2, 1, -7), at('shambler', 2, 1, -7)];
}

// ---- the blocks -----------------------------------------------------------------------------
/** Giant mushrooms in the garth: [u, v, cap height, cap block]. */
export const GIANTS = [[-2, 1, 7, B.RED_MUSHROOM_BLOCK], [2, -2, 6, B.BROWN_MUSHROOM_BLOCK], [-9, 9, 5, B.BROWN_MUSHROOM_BLOCK], [9, 10, 6, B.RED_MUSHROOM_BLOCK]];
const room = (u, v) => {
  if (u >= -13 && u <= -4 && Math.abs(v) <= 6) return 'maze';
  if (u >= 4 && u <= 13 && Math.abs(v) <= 6) return 'gallery';
  if (Math.abs(u) <= 4 && v >= -13 && v <= -4) return 'shrine';
  return null;
};

/**
 * The block of hall h at local (u, h, v) as [id, meta], or null where the hall leaves the world
 * alone. h = 0 is the floor layer; everything above it in the footprint is cleared.
 */
export function sporehallBlock(s, u, h, v) {
  const au = Math.abs(u), av = Math.abs(v), m = Math.max(au, av);
  if (m > SPOREHALL_HALF || h < -5 || h > CLEAR) return null;
  const AIR = [B.AIR, 0];
  const q = (k) => hashf(s.seed, u * 61 + 900, v * 31 + 900, k + h * 13);
  const brick = (k = 1) => { const t = q(k); return [t < 0.4 ? B.MOSSY_STONE_BRICKS : t < 0.75 ? B.STONE_BRICKS : t < 0.93 ? B.CRACKED_STONE_BRICKS : B.MOSSY_COBBLESTONE, 0]; };
  const torch = (fu, fv) => [B.TORCH, sideOfLocal(s.dir, fu, fv) + 1];

  // ---- the crypt under the shrine: a brick shell round a 5 x 5 room, entered by digging ----
  if (h < 0) {
    if (au > 3 || v < -11 || v > -5 || h < -5) return null;
    if (h === -5 || au === 3 || v === -11 || v === -5) return brick(2);
    for (const c of sporehallChestCells(s)) if (c.h === h && c.u === u && c.v === v) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (c.loot << 4)];
    if (h === -4 && au === 2 && v === -6) return [B.LANTERN, 0];
    if (h === -1 && au === 2 && (v === -6 || v === -10)) return [B.COBWEB, 0];
    if (h === -4 && q(3) < 0.12) return [B.BROWN_MUSHROOM, 0];
    return AIR;
  }

  // ---- the giant mushrooms: stems in the garth, caps that may overhang a wing's roof ----
  if (h > 0) {
    for (const [gu, gv, cap, blk] of GIANTS) {
      const du = Math.abs(u - gu), dv = Math.abs(v - gv);
      if (du === 0 && dv === 0 && h < cap) return [B.MUSHROOM_STEM, 0];
      if (h === cap && du <= 2 && dv <= 2 && !(du === 2 && dv === 2)) return [blk, 0];
      if (h === cap + 1 && du <= 1 && dv <= 1) return [blk, 0];
    }
  }
  const kind = room(u, v);
  // ---- the floor ----
  if (h === 0) {
    if (kind === 'gallery' && galleryTrap(s, u, v)) return [B.TNT, 0];
    if (kind === 'shrine' && ((au === 1 && Math.abs(v + 8) <= 1) || (au === 0 && Math.abs(v + 8) === 1))) return [B.CHISELED_STONE_BRICKS, 0]; // marks the crypt
    if (kind) return brick(4);
    const t = q(5);
    return t < 0.4 ? [B.MOSS_BLOCK, 0] : t < 0.65 ? [B.GRASS, 0] : t < 0.8 ? [B.MOSSY_STONE_BRICKS, 0] : t < 0.92 ? [B.STONE_BRICKS, 0] : [B.DIRT, 0];
  }

  // ---- the three wings ----
  if (kind) {
    const wall = kind === 'maze' ? (u === -13 || u === -4 || av === 6) : kind === 'gallery' ? (u === 4 || u === 13 || av === 6) : (au === 4 || v === -13 || v === -4);
    if (h === ROOF) { // a roof with the odd hole, but never over a lantern
      const hung = kind === 'maze' ? lanternAt(s, u, v) : kind === 'gallery' ? (au >= 5 && (u === 6 || u === 10) && av === 5) : au === 3 && (v === -6 || v === -11);
      return !hung && !wall && q(6) < 0.08 ? AIR : brick(7);
    }
    if (h > ROOF) return AIR;
    if (wall) {
      // doors from the garth into each wing
      if (kind === 'maze' && u === -4 && v === 1 && h <= 3) return AIR;
      if (kind === 'gallery' && u === 4 && v === 0 && h <= 3) return AIR;
      if (kind === 'shrine' && v === -4 && u === 0 && h <= 3) return AIR;
      if (h === 3 && ((kind === 'gallery' && u === 13 && av === 3) || (kind === 'shrine' && v === -13 && av === 2))) return AIR; // slits
      return brick(8);
    }
    if (kind === 'maze') {
      const i = u + 13, j = v + 6, open = mazeLayout(s.seed).open.has(`${i},${j}`);
      if (!open) return brick(9);
      if (h === 4 && lanternAt(s, u, v)) return [B.LANTERN, 1];
      for (const c of sporehallChestCells(s)) if (c.h === h && c.u === u && c.v === v) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (c.loot << 4)];
      if (h === 1 && q(10) < 0.07) return [B.BROWN_MUSHROOM, 0];
      if (h === 4 && q(11) < 0.05) return [B.COBWEB, 0];
      return AIR;
    }
    if (kind === 'gallery') {
      if (h === 1) {
        for (const c of sporehallChestCells(s)) if (c.u === u && c.v === v && c.h === 1) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (c.loot << 4)];
        if (galleryTrap(s, u, v)) return [B.WOODEN_PRESSURE_PLATE, 0];
      }
      if (h === 4 && av === 5 && (u === 6 || u === 10)) return [B.LANTERN, 1];
      return AIR;
    }
    // the shrine: an altar of chiseled bricks with its chest, two columns, mushrooms and cobwebs
    if (u === 0 && v === -12 && h === 1) return [B.CHEST, sideOfLocal(s.dir, 0, 1) | 8 | (SPOREHALL_LOOT.shrine << 4)];
    if (au === 1 && v === -12 && h <= 3) return h === 3 ? [B.CHISELED_STONE_BRICKS, 0] : brick(12);
    if (au === 3 && (v === -6 || v === -11) && h === 4) return [B.LANTERN, 1];
    if (au === 3 && v === -8 && h === 2) return torch(Math.sign(u), 0);
    if (h === 4 && au === 3 && (v === -5 || v === -12) && q(13) < 0.8) return [B.COBWEB, 0];
    if (h === 1 && (au === 3 && (v === -5 || v === -9)) ) return [u < 0 ? B.RED_MUSHROOM : B.BROWN_MUSHROOM, 0];
    return AIR;
  }

  // ---- the garth ----
  if (m === SPOREHALL_HALF) { // the outer wall, broken here and there
    if (v === SPOREHALL_HALF && au <= 1) return h === 4 ? brick(14) : AIR; // the gate, with its lintel
    const top = q(15) < 0.22 ? 1 : 2 + Math.floor(q(16) * 3);
    return h <= top ? brick(17) : AIR;
  }
  if (h === 1) {
    const t = q(18), floor = q(5);
    if (t < 0.05) return [B.BROWN_MUSHROOM, 0];
    if (t < 0.09) return [B.RED_MUSHROOM, 0];
    if (t < 0.12) return [B.AZALEA, 0];
    if (t < 0.3 && floor < 0.4) return [B.MOSS_CARPET, 0];
    if (t < 0.4 && floor >= 0.4 && floor < 0.65) return [B.TALL_GRASS, 0];
    if (t > 0.985) return [B.MOSSY_COBBLESTONE, 0];
  }
  return AIR;
}

/** Does the maze room hang a lantern over local cell (u, v)? Only open node cells can. */
function lanternAt(s, u, v) {
  const i = u + 13, j = v + 6;
  return i % 2 === 1 && j % 2 === 1 && i > 0 && i < 8 && hashf(s.seed, i, j, 97) < 0.35 && mazeLayout(s.seed).open.has(`${i},${j}`);
}

/** Stamp the parts of nearby Sporehalls inside chunk (cx, cz). */
export function stampSporehalls(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  const halls = sporehallsNear(gen, X0, Z0, X0 + 15, Z0 + 15);
  if (!halls.length) return;
  const set = chunkSetter(blocks, meta, cx, cz);
  for (const t of halls) {
    for (let x = Math.max(X0, t.x0); x <= Math.min(X0 + 15, t.x1); x++) for (let z = Math.max(Z0, t.z0); z <= Math.min(Z0 + 15, t.z1); z++) {
      const [u, v] = toLocal(t.dir, x - t.cx, z - t.cz);
      if (Math.abs(u) > SPOREHALL_HALF || Math.abs(v) > SPOREHALL_HALF) continue;
      // build the ground up to the garth where the land falls away
      for (let h = -1; h >= -FOUNDATION; h--) {
        const b = blocks[cidx(x - X0, t.y + h, z - Z0)];
        if (b && b !== B.WATER) break;
        set(x, t.y + h, z, hashf(t.seed, u, v, 80 + h) < 0.5 ? B.MOSSY_STONE_BRICKS : B.DIRT);
      }
      for (let h = -5; h <= CLEAR; h++) {
        const bl = sporehallBlock(t, u, h, v);
        if (bl) set(x, t.y + h, z, bl[0], bl[1]);
      }
    }
  }
}
