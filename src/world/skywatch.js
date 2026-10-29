// Skywatch Towers: a ruined stone-brick watchtower on the summit of a mountain, in about one
// 224 x 224-block region in two where a peak top is level enough (stony or snowy peaks; the
// summit is levelled and the foot built up). A 25 x 25 courtyard with a low broken wall, a
// gateway and four corner bastions round an 11 x 11 keep 25 blocks tall: four storeys joined by a
// ladder, arrow slits, a crenellated roof and one corner fallen in. The ground floor and the
// armoury keep supply chests, the map room a chart chest and the top floor a treasury; Rattlers
// guard the rooms and Marauders the roof and courtyard. Planned from the seed alone and stamped
// chunk by chunk.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { cidx } from './constants.js';
import { mulberry32, hash4, hashf } from './noise.js';
import { toWorld, toLocal, sideOfLocal, sitesNear, nearestSite, chunkSetter, claimedByOthers } from './siteKit.js';
import { sunkenRuinsNear } from './sunkenRuins.js';
import { sunTombsNear } from './sunTombs.js';

export const SKYWATCH_REGION = 224;
export const SKYWATCH_HALF = 12;        // the courtyard's half width
export const SKYWATCH_REACH = 13;
export const SKYWATCH_LOOT = { supply: 6, map: 9, treasure: 8 }; // outpost, shipwreck map and shipwreck treasure tables
const CHANCE = 0.6, TRIES = 10, CLEAR = 40, FOUNDATION = 22;
const FLOORS = [5, 11, 17, 23];         // block layers of the floors (and the roof)
const LADDER_CELL = [-3, 4];            // local (u, v) of the ladder; it hangs on the wall at +v
const cache = new Map();

/**
 * The tower of region (rx, rz) or null: { cx, cz, y (ground level of the courtyard), dir
 * (the gateway faces local +u), seed, x0, z0, x1, z1 }.
 */
export function skywatchInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 9696));
  let tower = null;
  if (rng() < CHANCE) {
    const R = SKYWATCH_REGION, M = SKYWATCH_REACH + 8;
    for (let k = 0; k < TRIES && !tower; k++) {
      const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
      const dir = Math.floor(rng() * 4), seed = Math.floor(rng() * 1e9);
      let lo = 999, hi = -999, sum = 0, n = 0, ok = true;
      for (const dx of [-10, 0, 10]) for (const dz of [-10, 0, 10]) {
        const x = cx + dx, z = cz + dz, col = gen.column(x, z), top = gen.surfaceAt(x, z, col), biome = gen.biomeFor(col, top);
        if ((biome !== BIOME.STONY_PEAKS && biome !== BIOME.SNOWY_PEAKS) || top < 110) { ok = false; break; }
        lo = Math.min(lo, top); hi = Math.max(hi, top); sum += top; n++;
      }
      if (!ok || hi - lo > 14) continue;
      const box = { x0: cx - SKYWATCH_REACH, z0: cz - SKYWATCH_REACH, x1: cx + SKYWATCH_REACH, z1: cz + SKYWATCH_REACH };
      const pad = [box.x0 - 6, box.z0 - 6, box.x1 + 6, box.z1 + 6];
      if (claimedByOthers(gen, ...pad) || sunkenRuinsNear(gen, ...pad).length || sunTombsNear(gen, ...pad).length) continue;
      tower = { cx, cz, y: Math.floor(sum / n), dir, seed, ...box };
    }
  }
  if (cache.size > 512) cache.clear();
  cache.set(key, tower);
  return tower;
}

export const skywatchesNear = (gen, x0, z0, x1, z1) => sitesNear(skywatchInRegion, gen, SKYWATCH_REGION, SKYWATCH_REACH, x0, z0, x1, z1);
export const nearestSkywatch = (gen, x, z, maxRings = 12) => nearestSite(skywatchInRegion, gen, SKYWATCH_REGION, x, z, maxRings);

const BRICKS = (t) => (t < 0.55 ? B.STONE_BRICKS : t < 0.75 ? B.CRACKED_STONE_BRICKS : t < 0.92 ? B.MOSSY_STONE_BRICKS : B.COBBLESTONE);

/** Chests as [u, h, v, fu, fv, loot] (fu, fv: the way the chest faces); h is the level the chest stands on. */
export const SKYWATCH_CHESTS = [
  [-4, 1, -1, 1, 0, SKYWATCH_LOOT.supply],                                    // the guard room
  [-4, 6, -2, 1, 0, SKYWATCH_LOOT.supply], [-4, 6, 2, 1, 0, SKYWATCH_LOOT.supply], // the armoury
  [0, 12, -4, 0, 1, SKYWATCH_LOOT.map],                                       // the map room
  [-4, 18, -1, 1, 0, SKYWATCH_LOOT.treasure], [-4, 18, 1, 1, 0, SKYWATCH_LOOT.treasure], // the treasury
];

export function skywatchChests(t) {
  return SKYWATCH_CHESTS.map(([u, h, v, , , loot]) => { const [dx, dz] = toWorld(t.dir, u, v); return { x: t.cx + dx, y: t.y + h, z: t.cz + dz, kind: loot }; });
}

/** Guards as { type, x, y, z } (feet): Rattlers inside, Marauders on the roof and in the courtyard. */
export function skywatchGuards(t) {
  const at = (type, u, h, v) => { const [dx, dz] = toWorld(t.dir, u, v); return { type, x: t.cx + dx, y: t.y + h, z: t.cz + dz }; };
  return [at('rattler', -2, 1, 2), at('rattler', 0, 6, 0), at('rattler', 1, 12, -1),
    at('marauder', -3, 24, -3), at('marauder', -3, 24, 3), at('marauder', 3, 24, -3), at('marauder', 8, 1, -5), at('marauder', -8, 1, 6)];
}

/**
 * The block of tower t at local (u, h, v) as [id, meta], or null where the tower leaves the
 * world alone. h = 0 is the courtyard level; everything above it in the footprint is cleared.
 */
export function skywatchBlock(t, u, h, v) {
  const au = Math.abs(u), av = Math.abs(v), m = Math.max(au, av);
  if (m > SKYWATCH_HALF || h < 0 || h > CLEAR) return null;
  const AIR = [B.AIR, 0];
  const q = (k) => hashf(t.seed, u * 61 + 900, v * 31 + 900, k + h * 13);
  const brick = (k = 1) => [BRICKS(q(k)), 0];
  const torch = (fu, fv) => [B.TORCH, sideOfLocal(t.dir, fu, fv) + 1];

  // ---- the keep ----
  if (au <= 5 && av <= 5) {
    if (h === 0) return brick(2);
    const fallen = u >= 2 && v >= 2 && h >= 14;       // one corner has come down
    if (fallen) return AIR;
    const inner = au <= 4 && av <= 4;
    if (!inner) {
      if (h === 24) return au === 5 && av === 5 ? brick(3) : (u + v) % 2 === 0 ? brick(3) : AIR; // the crenels
      if (h === 25) return au === 5 && av === 5 ? [B.CHISELED_STONE_BRICKS, 0] : AIR;
      if (h > 25) return AIR;
      if (u === 5 && av <= 1 && h <= 3) return AIR;                     // the gateway of the keep
      if ((h === 3 || h === 8 || h === 14 || h === 20) && ((av === 0 && au === 5) || (au === 0 && av === 5))) return AIR; // arrow slits
      if (h >= 12 && q(20) < 0.04 + (h - 12) * 0.012) return AIR;      // weathered holes, more of them higher up
      return brick(4);
    }
    // inside: ladder, floors, furniture
    if (u === LADDER_CELL[0] && v === LADDER_CELL[1] && h >= 1 && h <= 23) return [B.LADDER, sideOfLocal(t.dir, 0, 1)];
    if (FLOORS.includes(h)) return q(21) < 0.08 ? AIR : [B.DARK_OAK_PLANKS, 0];
    if (h > 23) return AIR;
    for (const [cu, ch, cv, fu, fv, loot] of SKYWATCH_CHESTS) if (cu === u && ch === h && cv === v) return [B.CHEST, sideOfLocal(t.dir, fu, fv) | 8 | (loot << 4)];
    const base = h >= 18 ? 18 : h >= 12 ? 12 : h >= 6 ? 6 : 1;       // walking level of this storey
    if (h === base + 2 && av === 3 && au === 4) return torch(Math.sign(u), 0);
    if (base === 1 && h === 1 && u === -3 && v === -3) return [B.WORKBENCH, 0];
    if (base === 12 && (h === 12 || h === 13) && u === -4 && av <= 3 && !(av === 2 && h === 12)) return [B.BOOKSHELF, 0]; // the library wall
    if (base === 18 && h === 22 && au === 4 && av === 4) return [B.COBWEB, 0];
    return AIR;
  }

  // ---- the courtyard ----
  if (h === 0) {
    const t0 = q(5);
    return t0 < 0.45 ? [B.COBBLESTONE, 0] : t0 < 0.7 ? [B.STONE_BRICKS, 0] : t0 < 0.85 ? [B.MOSSY_COBBLESTONE, 0] : t0 < 0.95 ? [B.GRAVEL, 0] : [B.STONE, 0];
  }
  if (au >= 10 && av >= 10) {                                         // the corner bastions
    if (h <= 6) return brick(6);
    if (h === 7) return au === 12 && av === 12 ? [B.CHISELED_STONE_BRICKS, 0] : (u + v) % 2 === 0 ? brick(6) : AIR;
    return AIR;
  }
  if (au === SKYWATCH_HALF || av === SKYWATCH_HALF) {                 // the broken curtain wall
    if (u === SKYWATCH_HALF && av <= 2) return AIR;                   // the gateway
    const top = q(30) < 0.22 ? 0 : 1 + Math.floor(q(31) * 3);
    return h <= top ? brick(7) : AIR;
  }
  if (h === 1 && q(8) < 0.04) return [B.COBBLESTONE, 0];             // fallen stones
  return AIR;
}

/** Stamp the parts of nearby Skywatch Towers inside chunk (cx, cz). */
export function stampSkywatches(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  const set = chunkSetter(blocks, meta, cx, cz);
  for (const t of skywatchesNear(gen, X0, Z0, X0 + 15, Z0 + 15)) {
    for (let x = Math.max(X0, t.x0); x <= Math.min(X0 + 15, t.x1); x++) for (let z = Math.max(Z0, t.z0); z <= Math.min(Z0 + 15, t.z1); z++) {
      const [u, v] = toLocal(t.dir, x - t.cx, z - t.cz);
      if (Math.abs(u) > SKYWATCH_HALF || Math.abs(v) > SKYWATCH_HALF) continue;
      // build the summit up to the courtyard where the slope falls away
      for (let h = -1; h >= -FOUNDATION; h--) {
        const b = blocks[cidx(x - X0, t.y + h, z - Z0)];
        if (b && b !== B.WATER && b !== B.SNOW_LAYER) break;
        set(x, t.y + h, z, hashf(t.seed, u, v, 80 + h) < 0.4 ? B.COBBLESTONE : B.STONE_BRICKS);
      }
      for (let h = 0; h <= CLEAR; h++) {
        const bl = skywatchBlock(t, u, h, v);
        if (bl) set(x, t.y + h, z, bl[0], bl[1]);
      }
    }
  }
}
