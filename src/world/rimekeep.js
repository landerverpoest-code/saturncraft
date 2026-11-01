// Rimekeeps: a frozen stone-and-ice fortress on the snowy plains and taiga, in about one 240 x 240
// region in twelve (cold ground that is level enough is scarce). A 29 x 29 courtyard (a frozen pond, drifts of
// snow, a broken curtain wall with a gateway and four corner towers) round a 13 x 13 keep of three
// storeys joined by a ladder: a barracks, an armoury and, under the roof, the Warden's throne
// room with ice windows and pillars of ice. Below the barracks a sealed vault holds the hoard.
// The Warden is a Rime Rattler of 90 hit points in diamond armour that never leaves its hall;
// Rime Rattlers guard the armoury and the towers, Shamblers the barracks and Marauders the yard.
// Planned from the seed alone and stamped chunk by chunk, so the keep looks the same across
// chunk borders and on every machine of a multiplayer game.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL, cidx } from './constants.js';
import { mulberry32, hash4, hashf } from './noise.js';
import { toWorld, toLocal, sideOfLocal, sitesNear, nearestSite, chunkSetter, claimedByOthers } from './siteKit.js';
import { sunkenRuinsNear } from './sunkenRuins.js';
import { sunTombsNear } from './sunTombs.js';
import { skywatchesNear } from './skywatch.js';

export const RIMEKEEP_REGION = 240;
export const RIMEKEEP_HALF = 14;         // the courtyard's half width (29 blocks across)
export const RIMEKEEP_REACH = 15;
// chest loot kinds: every kind of the 4-bit chest meta is taken, so the keep reuses existing tables
// (mobs/spawnerBlocks.js LOOT): igloo, outpost, sun tomb and shipwreck treasure
export const RIMEKEEP_LOOT = { barracks: 4, armoury: 6, throne: 10, vault: 8 };
/** The Warden: a named Rime Rattler with this many hit points, in diamond armour (mobs/spawner.js). */
export const RIMEKEEP_WARDEN = { type: 'rime_rattler', name: 'Rimekeep Warden', hp: 90 };
const CHANCE = 0.5, TRIES = 36, CLEAR = 26, FOUNDATION = 18;
const KEEP = 6;                          // the keep's shell lies at ring distance 6
const FLOORS = [7, 13];                  // block layers of the upper floors (the roof is layer 19)
const ROOF = 19;
const LADDER_CELL = [-4, 5];             // local (u, v) of the ladder; it hangs on the wall at +v
const YARD_GUARDS = [[9, 5], [-9, -6], [-9, 8]]; // where the Marauders of the courtyard stand: no snow drifts there
const TORCHES = [[5, 3, 1], [5, -3, 1], [-5, 4, -1], [-5, -4, -1]]; // wall torches of every storey: [u, v, fu]
const cache = new Map();
const isCold = (b) => b === BIOME.SNOWY_PLAINS || b === BIOME.SNOWY_TAIGA || b === BIOME.TAIGA;

/**
 * The keep of region (rx, rz) or null: { cx, cz, y (courtyard level), dir (the gateway faces
 * local +u), seed, x0, z0, x1, z1 }.
 */
export function rimekeepInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 9797));
  let keep = null;
  if (rng() < CHANCE) {
    const R = RIMEKEEP_REGION, M = RIMEKEEP_REACH + 8;
    for (let k = 0; k < TRIES && !keep; k++) {
      const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
      const dir = Math.floor(rng() * 4), seed = Math.floor(rng() * 1e9);
      let lo = 999, hi = -999, sum = 0, n = 0, ok = true;
      for (const dx of [0, -12, 12]) { // the centre first: most tries fail on it
        for (const dz of [0, -12, 12]) {
          const x = cx + dx, z = cz + dz, col = gen.column(x, z), top = gen.surfaceAt(x, z, col);
          if (!isCold(gen.biomeFor(col, top)) || top <= SEA_LEVEL + 1) { ok = false; break; }
          lo = Math.min(lo, top); hi = Math.max(hi, top); sum += top; n++;
        }
        if (!ok) break;
      }
      if (!ok || hi - lo > 8) continue;
      const box = { x0: cx - RIMEKEEP_REACH, z0: cz - RIMEKEEP_REACH, x1: cx + RIMEKEEP_REACH, z1: cz + RIMEKEEP_REACH };
      const pad = [box.x0 - 6, box.z0 - 6, box.x1 + 6, box.z1 + 6];
      if (gen.riverInBox && gen.riverInBox(box.x0, box.z0, box.x1, box.z1)) continue;
      if (claimedByOthers(gen, ...pad) || sunkenRuinsNear(gen, ...pad).length || sunTombsNear(gen, ...pad).length || skywatchesNear(gen, ...pad).length) continue;
      keep = { cx, cz, y: Math.floor(sum / n), dir, seed, ...box };
    }
  }
  if (cache.size > 512) cache.clear();
  cache.set(key, keep);
  return keep;
}

export const rimekeepsNear = (gen, x0, z0, x1, z1) => sitesNear(rimekeepInRegion, gen, RIMEKEEP_REGION, RIMEKEEP_REACH, x0, z0, x1, z1);
export const nearestRimekeep = (gen, x, z, maxRings = 12) => nearestSite(rimekeepInRegion, gen, RIMEKEEP_REGION, x, z, maxRings);

const BRICKS = (t) => (t < 0.5 ? B.STONE_BRICKS : t < 0.7 ? B.CRACKED_STONE_BRICKS : t < 0.88 ? B.SNOW_BLOCK : B.ICE);

/** Chests as [u, h, v, fu, fv, loot] (fu, fv: the way the chest faces); h is the level the chest stands on. */
export const RIMEKEEP_CHESTS = [
  [-5, 1, -2, 1, 0, RIMEKEEP_LOOT.barracks], [-5, 1, 2, 1, 0, RIMEKEEP_LOOT.barracks],   // the barracks
  [-5, 8, -2, 1, 0, RIMEKEEP_LOOT.armoury], [-5, 8, 2, 1, 0, RIMEKEEP_LOOT.armoury],     // the armoury
  [-5, 14, -1, 1, 0, RIMEKEEP_LOOT.throne], [-5, 14, 1, 1, 0, RIMEKEEP_LOOT.throne],     // behind the throne
  [-5, -5, -3, 1, 0, RIMEKEEP_LOOT.vault], [-5, -5, 0, 1, 0, RIMEKEEP_LOOT.vault], [-5, -5, 3, 1, 0, RIMEKEEP_LOOT.vault], // the vault
];

export function rimekeepChests(k) {
  return RIMEKEEP_CHESTS.map(([u, h, v, , , loot]) => { const [dx, dz] = toWorld(k.dir, u, v); return { x: k.cx + dx, y: k.y + h, z: k.cz + dz, kind: loot }; });
}

/** Guards as { type, x, y, z, warden? } (feet): the Warden in the throne room, Rime Rattlers and Shamblers inside, Marauders in the yard. */
export function rimekeepGuards(k) {
  const at = (type, u, h, v, extra) => { const [dx, dz] = toWorld(k.dir, u, v); return { type, x: k.cx + dx, y: k.y + h, z: k.cz + dz, ...extra }; };
  return [at(RIMEKEEP_WARDEN.type, 0, 14, 0, { warden: true }),
    at('rime_rattler', 3, 8, 3), at('rime_rattler', 3, 8, -3), at('rime_rattler', 12, 1, 12), at('rime_rattler', -12, 1, -12),
    at('shambler', 2, 1, 3), at('shambler', 2, 1, -3),
    ...YARD_GUARDS.map(([u, v]) => at('marauder', u, 1, v))];
}

/**
 * The block of keep k at local (u, h, v) as [id, meta], or null where the keep leaves the
 * world alone. h = 0 is the courtyard level; everything above it in the footprint is cleared.
 */
export function rimekeepBlock(k, u, h, v) {
  const au = Math.abs(u), av = Math.abs(v), m = Math.max(au, av);
  if (m > RIMEKEEP_HALF || h < -6 || h > CLEAR) return null;
  const AIR = [B.AIR, 0];
  const q = (kk) => hashf(k.seed, u * 61 + 900, v * 31 + 900, kk + h * 13);
  const brick = (kk = 1) => [BRICKS(q(kk)), 0];
  const stone = (kk = 1) => [q(kk) < 0.75 ? B.STONE_BRICKS : B.CRACKED_STONE_BRICKS, 0];
  const torch = (fu, fv) => [B.TORCH, sideOfLocal(k.dir, fu, fv) + 1];

  // ---- the vault under the barracks ----
  if (h < 0) {
    if (au > KEEP || av > KEEP) return null;
    if (au === KEEP || av === KEEP || h === -6) return stone(2);
    if (u === LADDER_CELL[0] && v === LADDER_CELL[1]) return [B.LADDER, sideOfLocal(k.dir, 0, 1)];
    for (const [cu, ch, cv, fu, fv, loot] of RIMEKEEP_CHESTS) if (cu === u && ch === h && cv === v) return [B.CHEST, sideOfLocal(k.dir, fu, fv) | 8 | (loot << 4)];
    if (h === -3 && au === 5 && av === 3) return torch(Math.sign(u), 0);
    if (h === -5 && q(3) < 0.05) return [B.COBWEB, 0];
    return AIR;
  }

  // ---- the keep ----
  if (m <= KEEP) {
    if (h === 0) return u === LADDER_CELL[0] && v === LADDER_CELL[1] ? [B.LADDER, sideOfLocal(k.dir, 0, 1)] : stone(4);
    if (m === KEEP) { // the shell
      if (h === 21) return au === KEEP && av === KEEP ? [B.CHISELED_STONE_BRICKS, 0] : AIR;
      if (h === 20) return au === KEEP && av === KEEP ? brick(5) : (u + v) % 2 === 0 ? brick(5) : AIR;   // the crenels
      if (h > 21) return AIR;
      if (u === KEEP && av <= 1 && h <= 3) return AIR;                                                 // the gateway of the keep
      if ((h === 5 || h === 12 || h === 18) && ((au === KEEP && av === 3) || (av === KEEP && au === 3))) return [B.ICE, 0]; // ice windows
      if (h >= 12 && h <= 19 && q(6) < 0.03 + (h - 12) * 0.008) return AIR;                            // weathered holes
      return brick(7);
    }
    if (h > 21) return AIR;
    if (u === LADDER_CELL[0] && v === LADDER_CELL[1] && h <= ROOF - 1) return [B.LADDER, sideOfLocal(k.dir, 0, 1)];
    if (h === ROOF) return stone(8);
    if (h > ROOF) return AIR;
    if (FLOORS.includes(h)) return (au > 3 || av > 3) && q(9) < 0.07 ? AIR : [B.SPRUCE_PLANKS, 0]; // rotten planks at the edges only, never under a guard
    for (const [cu, ch, cv, fu, fv, loot] of RIMEKEEP_CHESTS) if (cu === u && ch === h && cv === v) return [B.CHEST, sideOfLocal(k.dir, fu, fv) | 8 | (loot << 4)];
    const base = h >= 14 ? 14 : h >= 8 ? 8 : 1;                     // walking level of this storey
    if (h === base + 2) for (const [tu, tv, fu] of TORCHES) if (tu === u && tv === v) return torch(fu, 0);
    if (base === 1 && h === 1 && u === -3 && v === -4) return [B.WORKBENCH, 0];
    if (base === 1 && h === 1 && u === -3 && v === 4) return [B.FURNACE, 0];
    if (base === 8 && (h === 8 || h === 9) && u === 5 && av <= 3 && av !== 0) return [B.BOOKSHELF, 0]; // a shelf of war books
    if (base === 14) {
      if (au === 3 && av === 3 && h <= 18) return [B.ICE, 0];                                          // pillars of ice
      if (h === 14 && u <= -4 && av <= 2 && !RIMEKEEP_CHESTS.some((c) => c[0] === u && c[2] === v)) return [B.CHISELED_STONE_BRICKS, 0]; // the throne's dais
      if (h === 18 && au === 5 && av === 5) return [B.COBWEB, 0];
    }
    if (base === 1 && h === 6 && au === 5 && av === 5) return [B.COBWEB, 0];
    return AIR;
  }

  // ---- the corner towers ----
  if (au >= 11 && av >= 11) {
    const shell = au === 11 || av === 11 || au === 14 || av === 14;
    if (h === 0) return brick(10);
    if (h === 10) return stone(11);
    if (h === 11) return shell && (au + av) % 2 === 0 ? brick(12) : AIR;
    if (h > 11) return AIR;
    if (!shell) return AIR;
    if (au === 11 && av === 12 && h <= 2) return AIR;                // the door, towards the courtyard
    if (h === 5 && ((au === 14 && av === 12) || (av === 14 && au === 12))) return AIR; // an arrow slit
    return brick(13);
  }

  // ---- the courtyard ----
  if (h === 0) {
    if (au >= 8 && au <= 10 && v >= -9 && v <= -7) return [B.ICE, 0];     // the frozen pond
    const t = q(14);
    return t < 0.4 ? [B.SNOW_BLOCK, 0] : t < 0.7 ? [B.STONE_BRICKS, 0] : t < 0.8 ? [B.ICE, 0] : t < 0.9 ? [B.COBBLESTONE, 0] : [B.GRAVEL, 0];
  }
  if (m === RIMEKEEP_HALF) { // the broken curtain wall
    if (u === RIMEKEEP_HALF && av <= 2) return h === 4 ? stone(15) : AIR; // the gateway, with its lintel
    const top = q(16) < 0.2 ? 1 : 2 + Math.floor(q(17) * 3);
    return h <= top ? brick(18) : AIR;
  }
  if (h === 1 && !YARD_GUARDS.some(([a, b]) => a === u && b === v)) {
    const t = q(19);
    if (t < 0.03) return [B.COBBLESTONE, 0];
    if (t < 0.4 && !(au >= 8 && au <= 10 && v >= -9 && v <= -7)) return [B.SNOW_LAYER, t < 0.15 ? 1 : 0];
  }
  return AIR;
}

/** Stamp the parts of nearby Rimekeeps inside chunk (cx, cz). */
export function stampRimekeeps(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  const keeps = rimekeepsNear(gen, X0, Z0, X0 + 15, Z0 + 15);
  if (!keeps.length) return;
  const set = chunkSetter(blocks, meta, cx, cz);
  for (const t of keeps) {
    for (let x = Math.max(X0, t.x0); x <= Math.min(X0 + 15, t.x1); x++) for (let z = Math.max(Z0, t.z0); z <= Math.min(Z0 + 15, t.z1); z++) {
      const [u, v] = toLocal(t.dir, x - t.cx, z - t.cz);
      if (Math.abs(u) > RIMEKEEP_HALF || Math.abs(v) > RIMEKEEP_HALF) continue;
      // build the ground up to the courtyard where the land falls away
      for (let h = -1; h >= -FOUNDATION; h--) {
        const b = blocks[cidx(x - X0, t.y + h, z - Z0)];
        if (b && b !== B.WATER && b !== B.SNOW_LAYER) break;
        set(x, t.y + h, z, hashf(t.seed, u, v, 80 + h) < 0.4 ? B.COBBLESTONE : B.STONE_BRICKS);
      }
      for (let h = -6; h <= CLEAR; h++) {
        const bl = rimekeepBlock(t, u, h, v);
        if (bl) set(x, t.y + h, z, bl[0], bl[1]);
      }
    }
  }
}
