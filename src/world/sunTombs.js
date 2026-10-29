// Sun Tombs: a stepped pyramid 39 blocks wide rising 22 blocks over the dunes of deserts and
// badlands (at most one per 256 x 256-block region, found only where the ground is level
// enough and all desert or badlands). Every face is a staircase of full blocks you can walk up;
// on top, a small pillared shrine holds a chest under a golden sun. Inside, from an entrance
// corridor (some of its floor tiles hide a pressure plate over TNT) a great hall opens with four
// pillars, a patterned floor and Dune Shamblers, and three doors: to a burial chamber with two
// chests and cobwebs, to a trapped chamber whose floor is a field of hidden plates with a single
// safe path to a chest, and to a back room with a ladder down to the crypt: a plate-and-TNT
// floor again, a safe winding path through it and three treasure chests at the far wall.
// Planned from the seed alone (the heading, the style and every trap), stamped chunk by chunk.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL, cidx } from './constants.js';
import { mulberry32, hash4, hashf } from './noise.js';
import { toWorld, toLocal, sideOfLocal, sitesNear, nearestSite, chunkSetter, claimedByOthers } from './siteKit.js';
import { sunkenRuinsNear } from './sunkenRuins.js';

export const TOMB_REGION = 256;
export const TOMB_HALF = 19;            // the pyramid's half width (39 blocks across)
export const TOMB_REACH = 20;
export const TOMB_LOOT = 10;            // chest loot kind (mobs/spawnerBlocks.js LOOT.TOMB)
export const CRYPT_LOOT = 2;            // the crypt's chests use the temple treasure table
const CHANCE = 0.8, TRIES = 20, TOP = 16, CLEAR = 26;
const cache = new Map();

/**
 * The tomb of region (rx, rz) or null: { cx, cz, y (ground level), dir (the entrance faces
 * local +u), style ('desert' | 'badlands'), seed, x0, z0, x1, z1 }.
 */
export function sunTombInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 9595));
  let tomb = null;
  if (rng() < CHANCE) {
    const R = TOMB_REGION, M = TOMB_REACH + 8;
    for (let k = 0; k < TRIES && !tomb; k++) {
      const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
      const dir = Math.floor(rng() * 4), seed = Math.floor(rng() * 1e9);
      let lo = 999, hi = -999, sum = 0, n = 0, ok = true, badlands = false;
      for (const dx of [-14, 0, 14]) for (const dz of [-14, 0, 14]) {
        const x = cx + dx, z = cz + dz, col = gen.column(x, z), top = gen.surfaceAt(x, z, col), biome = gen.biomeFor(col, top);
        if ((biome !== BIOME.DESERT && biome !== BIOME.BADLANDS) || top <= SEA_LEVEL + 1) { ok = false; break; }
        if (dx === 0 && dz === 0) badlands = biome === BIOME.BADLANDS;
        lo = Math.min(lo, top); hi = Math.max(hi, top); sum += top; n++;
      }
      if (!ok || hi - lo > 10) continue;
      const box = { x0: cx - TOMB_REACH, z0: cz - TOMB_REACH, x1: cx + TOMB_REACH, z1: cz + TOMB_REACH };
      if (gen.riverInBox && gen.riverInBox(box.x0, box.z0, box.x1, box.z1)) continue;
      if (claimedByOthers(gen, box.x0 - 6, box.z0 - 6, box.x1 + 6, box.z1 + 6)) continue;
      if (sunkenRuinsNear(gen, box.x0 - 6, box.z0 - 6, box.x1 + 6, box.z1 + 6).length) continue;
      tomb = { cx, cz, y: Math.floor(sum / n), dir, style: badlands ? 'badlands' : 'desert', seed, ...box };
    }
  }
  if (cache.size > 512) cache.clear();
  cache.set(key, tomb);
  return tomb;
}

export const sunTombsNear = (gen, x0, z0, x1, z1) => sitesNear(sunTombInRegion, gen, TOMB_REGION, TOMB_REACH, x0, z0, x1, z1);
export const nearestSunTomb = (gen, x, z, maxRings = 12) => nearestSite(sunTombInRegion, gen, TOMB_REGION, x, z, maxRings);

const BAND = [B.TERRACOTTA, B.ORANGE_TERRACOTTA, B.TERRACOTTA, B.YELLOW_TERRACOTTA, B.BROWN_TERRACOTTA];
const STYLE = {
  desert: { body: () => B.SANDSTONE, accent: B.ORANGE_TERRACOTTA, core: B.RED_TERRACOTTA },
  badlands: { body: (h) => BAND[((h % 5) + 5) % 5], accent: B.RED_TERRACOTTA, core: B.YELLOW_TERRACOTTA },
};

/** Height of the pyramid's column at ring distance m: a 45 degree staircase with a flat top. */
export const tombHeight = (m) => Math.min(TOMB_HALF + 1 - m, TOP);

// ---- traps -----------------------------------------------------------------------------
const paths = new Map();
/** Cells [a, b] of a safe path along axis a (a0..a1) wandering in b within +-lim, as a Set of "a,b". */
function safePath(seed, tag, a0, a1, lim) {
  const key = `${seed}:${tag}`;
  if (paths.has(key)) return paths.get(key);
  const set = new Set();
  let b = 0;
  for (let a = a0; a <= a1; a++) {
    const nb = a === a0 ? 0 : Math.max(-lim, Math.min(lim, b + Math.floor(hashf(seed, a, tag.length * 7 + tag.charCodeAt(0), 95) * 3) - 1));
    for (let c = Math.min(b, nb); c <= Math.max(b, nb); c++) set.add(`${a},${c}`);
    b = nb;
  }
  if (paths.size > 256) paths.clear();
  paths.set(key, set);
  return set;
}

/** The kind of trap under local floor cell (u, v): null, or 'corridor' | 'chamber' | 'crypt'. */
export function tombTrap(t, u, v) {
  if (v === 0 && u === 0) return null;
  if (u >= 10 && u <= 18 && Math.abs(v) <= 1) {
    // at most one plate across the corridor, so there is always a way round
    return hashf(t.seed, u, 0, 90) < 0.42 && v === Math.floor(hashf(t.seed, u, 1, 91) * 3) - 1 ? 'corridor' : null;
  }
  if (Math.abs(u) <= 2 && v >= 10 && v <= 12) { // the trapped chamber east of the hall (+v)
    return !safePath(t.seed, 'chamber', 9, 13, 2).has(`${v},${u}`) && hashf(t.seed, u, v, 92) < 0.85 ? 'chamber' : null;
  }
  if (u >= -11 && u <= -5 && Math.abs(v) <= 4) { // the crypt
    return !safePath(t.seed, 'crypt', -12, -4, 3).has(`${u},${v}`) && hashf(t.seed, u, v, 93) < 0.8 ? 'crypt' : null;
  }
  return null;
}

// ---- chests and guards ----------------------------------------------------------------------
/** Chests as [u, h, v, fu, fv, loot] (fu, fv: the way the chest faces). */
export const TOMB_CHESTS = [
  [0, TOP, 0, 1, 0, TOMB_LOOT],                                // under the golden sun
  [-1, 1, -13, 0, 1, TOMB_LOOT], [1, 1, -13, 0, 1, TOMB_LOOT], // the burial chamber (-v)
  [0, 1, 13, 0, -1, TOMB_LOOT],                                // the trapped chamber (+v)
  [-4, -9, -2, -1, 0, CRYPT_LOOT], [-4, -9, 0, -1, 0, CRYPT_LOOT], [-4, -9, 2, -1, 0, CRYPT_LOOT], // the crypt
];
const GUARDS = [[-5, 3], [5, -3], [3, 5], [-3, -5], [-1, -11], [1, -11]];

export function tombChests(t) {
  return TOMB_CHESTS.map(([u, h, v, , , loot]) => { const [dx, dz] = toWorld(t.dir, u, v); return { x: t.cx + dx, y: t.y + h, z: t.cz + dz, kind: loot }; });
}
/** Where the tomb's Dune Shamblers wait: [x, y, z] (feet), four in the hall and two in the burial chamber. */
export function tombGuardSpots(t) {
  return GUARDS.map(([u, v]) => { const [dx, dz] = toWorld(t.dir, u, v); return [t.cx + dx, t.y + 1, t.cz + dz]; });
}

// ---- the blocks ----------------------------------------------------------------------------
/**
 * The block of tomb t at local (u, h, v) as [id, meta], or null where the tomb leaves the
 * world alone. h = 0 is the ground level the pyramid stands on.
 */
export function tombBlock(t, u, h, v) {
  const au = Math.abs(u), av = Math.abs(v), m = Math.max(au, av);
  if (m > TOMB_HALF || h < -10 || h > CLEAR) return null;
  const S = STYLE[t.style], body = () => [S.body(h), 0], AIR = [B.AIR, 0];
  const torch = (fu, fv) => [B.TORCH, sideOfLocal(t.dir, fu, fv) + 1];
  const chest = () => { for (const [cu, ch, cv, fu, fv, loot] of TOMB_CHESTS) if (cu === u && ch === h && cv === v) return [B.CHEST, sideOfLocal(t.dir, fu, fv) | 8 | (loot << 4)]; return null; };
  const q = (k) => hashf(t.seed, u * 61 + 900, v * 31 + 900, k + h * 13);

  // ---- below ground: the crypt, its roof and the ladder shaft ----
  if (h < 0) {
    if (u === -13 && v === 0 && h >= -9) return [B.LADDER, sideOfLocal(t.dir, -1, 0)];
    if (u < -13 || u > -3 || av > 5 || h < -10) return null;
    if (h >= -4) return body();                       // a solid roof of stone under the hall
    if (h === -5) return body();
    if (h === -10) { // the floor; TNT under every plate
      const tr = u >= -12 && u <= -4 && av <= 4 ? tombTrap(t, u, v) : null;
      return tr ? [B.TNT, 0] : [S.body(h), 0];
    }
    const inner = u >= -12 && u <= -4 && av <= 4;
    if (!inner) return body();
    if (h === -9) {
      const c = chest(); if (c) return c;
      if (tombTrap(t, u, v)) return [B.WOODEN_PRESSURE_PLATE, 0];
    }
    if (h === -7 && av === 4 && u === -8) return torch(0, Math.sign(v));
    return AIR;
  }

  // ---- the pyramid, stairs and all ----
  const H = tombHeight(m);
  // the shrine on the flat top: four columns, a slab roof, the golden sun
  if (m <= 4 && h >= TOP) {
    const c = chest(); if (c) return c;
    if (au === 3 && av === 3 && h <= TOP + 3) return h === TOP + 3 ? [S.accent, 0] : [S.body(h), 0];
    if (h === TOP + 4 && au <= 3 && av <= 3) return [B.SANDSTONE_SLAB, 0];
    if (h === TOP + 5 && u === 0 && v === 0) return [B.GOLD_BLOCK, 0];
    return AIR;
  }
  // hollow rooms
  const hall = au <= 7 && av <= 7;
  const door = h >= 1 && h <= 3;
  if (hall && h >= 1 && h <= 8) {
    if (au === 4 && av === 4) { // pillars, banded at the top
      return h === 8 ? [S.accent, 0] : [S.body(h), 0];
    }
    if (au === 3 && av === 4 && h === 3) return torch(Math.sign(u), 0); // on the pillar beside it
    if (au === 7 && av === 7 && h >= 7) return [B.COBWEB, 0];
    if (h === 1 && q(11) < 0.05) return [B.BONE_BLOCK, 0];
    return AIR;
  }
  if (door) {
    if (au >= 8 && au <= 19 && av <= 1 && u > 0) { // the entrance corridor, open at the outer end
      const tr = h === 1 ? tombTrap(t, u, v) : null;
      return tr ? [B.WOODEN_PRESSURE_PLATE, 0] : AIR;
    }
    if (u === -8 && av <= 1) return AIR;                // the door to the back room
    if (av === 8 && au <= 1) return AIR;               // the doors to the side chambers
  }
  // the burial chamber (-v), the trapped chamber (+v) and the back room (-u)
  if (h >= 1 && h <= 4 && ((au <= 2 && av >= 9 && av <= 13) || (u >= -13 && u <= -9 && av <= 2))) {
    const c = chest(); if (c) return c;
    if (v < 0 && au <= 2 && av >= 9 && h === 4 && au === 2 && (av === 9 || av === 13)) return [B.COBWEB, 0];
    if (v < 0 && au === 2 && av >= 9 && h === 1 && q(12) < 0.4) return [B.BONE_BLOCK, 0];
    if (u === -13 && v === 0) return AIR;
    if (v > 0 && au <= 2 && h === 1) return tombTrap(t, u, v) ? [B.WOODEN_PRESSURE_PLATE, 0] : AIR;
    return AIR;
  }
  if (h === 0) { // floors: a star of terracotta in the hall, TNT under the plates
    const tr = tombTrap(t, u, v);
    if (tr && tr !== 'crypt') return [B.TNT, 0];
    if (u === -13 && v === 0) return [B.LADDER, sideOfLocal(t.dir, -1, 0)]; // the way down
    if (hall) {
      if (m === 0) return [S.core, 0];
      if (au === av || au === 0 || av === 0) return [S.accent, 0];
    }
  }
  if (h < H) {
    // the skin: the top step of every ring is banded with the accent colour every fourth ring
    return h === H - 1 && m % 4 === 0 ? [S.accent, 0] : body();
  }
  return AIR; // clear the dunes (and any cactus) above
}

/** Stamp the parts of nearby Sun Tombs inside chunk (cx, cz). */
export function stampSunTombs(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  const set = chunkSetter(blocks, meta, cx, cz);
  for (const t of sunTombsNear(gen, X0, Z0, X0 + 15, Z0 + 15)) {
    for (let x = Math.max(X0, t.x0); x <= Math.min(X0 + 15, t.x1); x++) for (let z = Math.max(Z0, t.z0); z <= Math.min(Z0 + 15, t.z1); z++) {
      const [u, v] = toLocal(t.dir, x - t.cx, z - t.cz);
      if (Math.abs(u) > TOMB_HALF || Math.abs(v) > TOMB_HALF) continue;
      // a footing where the dunes dip below the base
      for (let h = -1; h >= -9; h--) {
        const b = blocks[cidx(x - X0, t.y + h, z - Z0)];
        if (b && b !== B.WATER) break;
        set(x, t.y + h, z, STYLE[t.style].body(h));
      }
      for (let h = -10; h <= CLEAR; h++) {
        const bl = tombBlock(t, u, h, v);
        if (bl) set(x, t.y + h, z, bl[0], bl[1]);
      }
    }
  }
}
