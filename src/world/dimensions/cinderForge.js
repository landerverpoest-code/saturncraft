// Cinderforges: abandoned smithies of the Cinderdeep, one in about every second 320 x 320 region. A square
// courtyard of Scorched Bricks (25 x 25, walls four blocks high, a tower at each corner crowned with a
// Glowshard) stands on pillars over the caverns, with a causeway running out from its gate. Inside, a pit of
// lava with a low rim, furnaces and anvils along the back wall, piles of Slag Ore, two loot chests and a
// Cinder Brute spawner. Planned from the seed alone (like the Ember Bastions) and stamped chunk by chunk,
// using the shared helpers of world/siteKit.js; found with /locate forge, on maps' Field Guide pages and by
// the landmark finders (world/landmarks.js).
import { B } from '../blocks.js';
import { mulberry32, hash4 } from '../noise.js';
import { cidx } from '../constants.js';
import { toWorld, sitesNear, nearestSite, chunkSetter, boxesOverlap } from '../siteKit.js';

export const FORGE_REGION = 320;
export const FORGE_HALF = 12;       // the courtyard is 25 blocks across
export const FORGE_CAUSEWAY = 26;   // the causeway reaches this far out of the gate (local +v)
export const FORGE_REACH = 28;
export const CINDER_BRUTE_SPAWNER_META = 4; // index into SPAWNER_TYPES (mobs/cinderMobs.js appends 'cinder_brute' after 'ember_lord')
// chest loot kinds (mobs/spawnerBlocks.js LOOT; all sixteen are taken, so these reuse the dungeon and ruined-rift tables)
export const FORGE_LOOT = { smith: 0, hoard: 7 };
const CHANCE = 0.55, TRIES = 12;
const cache = new Map();

/** The forge of region (rx, rz) or null: { cx, cz, y (floor level), dir (the gate faces local +v), seed, x0, z0, x1, z1 }. */
export function forgeInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 5252));
  let forge = null;
  if (rng() < CHANCE) {
    const R = FORGE_REGION, M = FORGE_REACH + 10;
    for (let k = 0; k < TRIES && !forge; k++) {
      const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
      const y = 48 + Math.floor(rng() * 28), dir = Math.floor(rng() * 4), seed = Math.floor(rng() * 1e9);
      const box = { x0: cx - FORGE_REACH, z0: cz - FORGE_REACH, x1: cx + FORGE_REACH, z1: cz + FORGE_REACH };
      // leave Ember Bastions alone
      if (gen.bastionsNear && gen.bastionsNear(box.x0 - 8, box.z0 - 8, box.x1 + 8, box.z1 + 8).some((b) => boxesOverlap(box, { x0: b.cx - 60, z0: b.cz - 60, x1: b.cx + 60, z1: b.cz + 60 }, 8))) continue;
      forge = { cx, cz, y, dir, seed, ...box };
    }
  }
  if (cache.size > 512) cache.clear();
  cache.set(key, forge);
  return forge;
}

export const forgesNear = (gen, x0, z0, x1, z1) => sitesNear(forgeInRegion, gen, FORGE_REGION, FORGE_REACH, x0, z0, x1, z1);
export const nearestForge = (gen, x, z, maxRings = 12) => nearestSite(forgeInRegion, gen, FORGE_REGION, x, z, maxRings);

/** Is (x, y, z) inside a forge's courtyard or close above or below it (for natural spawning)? */
export function inForge(gen, x, y, z) {
  for (const f of forgesNear(gen, x, z, x, z)) {
    if (Math.abs(x - f.cx) <= FORGE_HALF + 2 && Math.abs(z - f.cz) <= FORGE_HALF + 2 && Math.abs(y - f.y) < 12) return true;
  }
  return false;
}

/** The loot chest spots in local (u, v): the smith's chest and the hoard. */
export const FORGE_CHESTS = [{ u: -10, v: -10, kind: 'smith' }, { u: 10, v: -10, kind: 'hoard' }];
const chestMeta = (kind, facing = 0) => (facing & 3) | 8 | (kind << 4);

/** What stands at local (u, v), floor level y0 + dy: the id (or -1 for "leave"), and a meta. */
function cellAbove(u, v, dy) {
  const au = Math.abs(u), av = Math.abs(v), edge = Math.max(au, av);
  // courtyard
  if (au <= FORGE_HALF && av <= FORGE_HALF) {
    const corner = au === FORGE_HALF && av === FORGE_HALF;
    if (edge === FORGE_HALF) {
      const gate = v === FORGE_HALF && au <= 2;
      if (corner) return dy <= 8 ? [B.SCORCHED_BRICKS, 0] : dy === 9 ? [B.GLOWSHARD, 0] : [B.AIR, 0];
      if (gate) return dy <= 3 ? [B.AIR, 0] : dy === 4 ? [B.SCORCHED_BRICKS, 0] : [B.AIR, 0];
      return dy <= 4 ? [B.SCORCHED_BRICKS, 0] : dy === 5 && (u + v) % 2 === 0 ? [B.SCORCHED_BRICKS, 0] : [B.AIR, 0];
    }
    // the lava pit and its rim
    if (au <= 2 && av <= 2) return [B.AIR, 0];
    if (edge === 3) return dy === 1 ? [B.SCORCHED_BRICKS, 0] : [B.AIR, 0];
    // the back wall (local -v): furnaces and anvils
    if (v === -11 && dy === 1 && (au === 4 || au === 8)) return [B.FURNACE_LIT, 0];
    if (v === -11 && dy === 2 && (au === 4 || au === 8)) return [B.AIR, 0];
    if (dy === 1 && v === 5 && au === 6) return [B.ANVIL, 0];
    if (dy === 1 && v === -9 && u === 0) return [B.SPAWNER, CINDER_BRUTE_SPAWNER_META];
    for (const c of FORGE_CHESTS) if (dy === 1 && u === c.u && v === c.v) return [B.CHEST, chestMeta(FORGE_LOOT[c.kind], u < 0 ? 1 : 3)];
    // stockpiles of Slag Ore
    if (au === 10 && v === 10 && dy <= 2) return [B.SLAG_ORE, 0];
    if (au === 9 && v === 10 && dy === 1) return [B.SLAG_ORE, 0];
    return [B.AIR, 0];
  }
  // the causeway out of the gate: a three-wide road with a low parapet
  if (au <= 2 && v > FORGE_HALF && v <= FORGE_CAUSEWAY) {
    if (dy === 1 && au === 2 && v % 2 === 0) return [B.SCORCHED_BRICKS, 0];
    return [B.AIR, 0];
  }
  return null;
}

/** Floor block at local (u, v): lava in the pit, bricks elsewhere (null outside the footprint). */
function floorAt(u, v) {
  const au = Math.abs(u), av = Math.abs(v);
  if (au <= FORGE_HALF && av <= FORGE_HALF) return au <= 2 && av <= 2 ? B.LAVA : (au + av) % 7 === 0 ? B.SLAGSTONE : B.SCORCHED_BRICKS;
  if (au <= 2 && v > FORGE_HALF && v <= FORGE_CAUSEWAY) return B.SCORCHED_BRICKS;
  return null;
}

/** Pillars (every sixth block of the courtyard, every eight along the causeway) run down to the ground or the lava. */
function pillarAt(u, v) {
  const au = Math.abs(u), av = Math.abs(v);
  if (au <= FORGE_HALF && av <= FORGE_HALF) return (u % 6 === 0 && v % 6 === 0);
  return au <= 1 && v > FORGE_HALF && (v - FORGE_HALF) % 8 === 4 && au === 0;
}

/** Stamp the part of every forge that lies in chunk (cx, cz). */
export function stampForges(gen, blocks, meta, cx, cz) {
  const x0 = cx * 16, z0 = cz * 16;
  const forges = forgesNear(gen, x0, z0, x0 + 15, z0 + 15);
  if (!forges.length) return;
  const set = chunkSetter(blocks, meta, cx, cz);
  for (const f of forges) {
    for (let u = -FORGE_HALF; u <= FORGE_HALF; u++) {
      for (let v = -FORGE_HALF; v <= FORGE_CAUSEWAY; v++) {
        const floor = floorAt(u, v);
        if (floor === null) continue;
        const [dx, dz] = toWorld(f.dir, u, v), x = f.cx + dx, z = f.cz + dz;
        if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16) continue;
        const y0 = f.y;
        if (floor === B.LAVA) { set(x, y0, z, B.LAVA); set(x, y0 - 1, z, B.SCORCHED_BRICKS); } else { set(x, y0, z, floor); set(x, y0 - 1, z, B.SCORCHED_BRICKS); }
        for (let dy = 1; dy <= 11; dy++) {
          const c = cellAbove(u, v, dy);
          if (!c) break;
          if (blocks[cidx(x - x0, y0 + dy, z - z0)] === B.BEDROCK) break;
          set(x, y0 + dy, z, c[0], c[1]);
        }
        if (pillarAt(u, v)) {
          for (let y = y0 - 2; y > 4; y--) {
            const id = blocks[cidx(x - x0, y, z - z0)];
            if (id !== B.AIR && id !== B.LAVA) break;
            set(x, y, z, B.SCORCHED_BRICKS);
          }
        }
      }
    }
  }
}

/** Where the spawner and the chests of a forge stand in the world: [{ x, y, z, what }] (for tests and the Field Guide). */
export function forgeParts(f) {
  const out = [];
  const at = (u, v, dy, what) => { const [dx, dz] = toWorld(f.dir, u, v); out.push({ x: f.cx + dx, y: f.y + dy, z: f.cz + dz, what }); };
  at(0, -9, 1, 'spawner');
  for (const c of FORGE_CHESTS) at(c.u, c.v, 1, 'chest');
  return out;
}
