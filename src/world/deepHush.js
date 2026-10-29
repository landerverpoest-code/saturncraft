// The Deep Hush (reference: the deep dark): rare stretches of the deepest
// caves where floors, walls and ceilings are grown over with dark teal
// Hushmoss, Hush Veins film the bare rock, and Hush Sensors, Shriekers and
// Catalysts sit among broken stone ruins with candles and loot chests.
//
// This module holds the world generation (called from caveGen.js; decided
// from the seed and world coordinates only, so it is the same every time and
// runs in the terrain worker) and the pure rules the runtime uses
// (world/hushSystem.js): who hears what, how the warning level climbs and
// fades, how the Darkness effect breathes and how a catalyst spreads moss.
import { B, BLOCK_LIMIT, SOLID, BLOCKS } from './blocks.js';
import { Simplex, hash4, hashf } from './noise.js';
import { MIN_Y, cidx } from './constants.js';

/** The Deep Hush lies below this height (its edges a little lower still). */
export const HUSH_TOP = -18;
/** Region strength needed (a few per cent of the deep underground). */
export const HUSH_THRESHOLD = 0.42;
/** Chest loot table of the ruins (chest meta bits 4-7, see mobs/spawnerBlocks.js). */
export const HUSH_LOOT = 12;

const noises = new Map();
function noiseFor(seed) {
  let n = noises.get(seed);
  if (!n) { n = new Simplex(hash4(seed, 34, 911, 3)); noises.set(seed, n); }
  return n;
}
const cellHash = (seed, key, x, y, z) => hashf(seed ^ Math.imul(key, 0x2c1b3c6d), x, y, z);

/** Region strength of the Deep Hush at a column (above HUSH_THRESHOLD = inside). */
export function hushRegion(seed, x, z) { return noiseFor(seed).fbm2(x / 290, z / 290, 2); }

/** The highest y the Deep Hush reaches in a column of region strength `r`. */
export function hushTopAt(r) { return Math.min(HUSH_TOP, HUSH_TOP - 14 + Math.floor((r - HUSH_THRESHOLD) * 90)); }

const ROCK = new Uint8Array(BLOCK_LIMIT);
for (const id of [B.STONE, B.DEEPSTONE, B.GRANITE, B.DIORITE, B.ANDESITE, B.TUFF, B.SEEPSTONE, B.DIRT, B.GRAVEL, B.COBBLED_DEEPSTONE]) ROCK[id] = 1;
const RUIN_STONE = [B.STONE_BRICKS, B.STONE_BRICKS, B.CRACKED_STONE_BRICKS, B.CRACKED_STONE_BRICKS, B.COBBLED_DEEPSTONE, B.CHISELED_STONE_BRICKS];

/** The Hush blocks the runtime looks out for. */
export const HUSH_IDS = new Set([B.HUSHMOSS, B.HUSH_VEIN, B.HUSH_SENSOR, B.HUSH_SHRIEKER, B.HUSH_CATALYST, B.CALIBRATED_HUSH_SENSOR]);
/** Shrieker meta bit: grown by the world (it can call a Hushkeeper); placed or spread ones only shriek. */
export const SHRIEKER_CAN_SUMMON = 1;

/**
 * Stamp the Deep Hush into chunk (cx, cz). `skip(x, z)` says whether a column belongs to another
 * cave biome (lush caves) and is left alone.
 */
export function stampDeepHush(seed, blocks, meta, cx, cz, heightmap, skip = null) {
  const x0 = cx * 16, z0 = cz * 16;
  if (hushRegion(seed, x0 + 8, z0 + 8) < HUSH_THRESHOLD - 0.12) return false;
  let any = false;
  const tops = new Int16Array(256);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const wx = x0 + x, wz = z0 + z, r = hushRegion(seed, wx, wz);
    tops[x + z * 16] = MIN_Y;
    if (r < HUSH_THRESHOLD || (skip && skip(wx, wz))) continue;
    const top = Math.min(hushTopAt(r), heightmap[x + z * 16] - 24);
    tops[x + z * 16] = top;
    for (let y = MIN_Y + 6; y < top; y++) {
      const i = cidx(x, y, z);
      if (!ROCK[blocks[i]]) continue;
      const above = cidx(x, y + 1, z), below = cidx(x, y - 1, z);
      if (blocks[above] === B.AIR) {
        // the cave floor: moss nearly everywhere, sensors, shriekers and the odd catalyst on it, veins on the bare rock
        any = true;
        const r2 = cellHash(seed, 71, wx, y, wz);
        if (r2 < 0.0018) { blocks[i] = B.HUSH_CATALYST; meta[i] = 0; continue; }
        const mossy = cellHash(seed, 70, wx >> 1, y, wz >> 1) < 0.86 || cellHash(seed, 72, wx, y, wz) < 0.4;
        if (mossy) blocks[i] = B.HUSHMOSS;
        if (blocks[cidx(x, y + 2, z)] !== B.AIR) continue;
        if (r2 < 0.014) { blocks[above] = B.HUSH_SENSOR; meta[above] = 0; }
        else if (r2 < 0.019) { blocks[above] = B.HUSH_SHRIEKER; meta[above] = SHRIEKER_CAN_SUMMON; }
        else if (!mossy && r2 < 0.6) { blocks[above] = B.HUSH_VEIN; meta[above] = 0; }
      } else if (blocks[below] === B.AIR) {
        if (cellHash(seed, 73, wx, y, wz) < 0.6) { blocks[i] = B.HUSHMOSS; any = true; }
      } else {
        // walls: rock with open air beside it (looked for inside this chunk only, so the result never depends on a neighbour)
        let side = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx > 15 || nz > 15) continue;
          if (blocks[cidx(nx, y, nz)] === B.AIR) { side = true; break; }
        }
        if (side && cellHash(seed, 74, wx, y, wz) < 0.72) { blocks[i] = B.HUSHMOSS; any = true; }
      }
    }
  }
  if (any) stampRuins(seed, blocks, meta, cx, cz, tops);
  return any;
}

/**
 * A ruin (about one Deep Hush chunk in four): a 7x7 patch of old stone bricks on the cave floor
 * with broken pillars, a few candles and perhaps a loot chest.
 */
function stampRuins(seed, blocks, meta, cx, cz, tops) {
  if (hashf(seed, cx, cz, 9901) >= 0.27) return false;
  const px = 4 + Math.floor(hashf(seed, cx, cz, 9902) * 8), pz = 4 + Math.floor(hashf(seed, cx, cz, 9903) * 8);
  const top = tops[px + pz * 16];
  let fy = null;
  for (let y = MIN_Y + 8; y < top; y++) {
    const i = cidx(px, y, pz);
    if (!SOLID[blocks[i]] || blocks[i] === B.BEDROCK) continue;
    if ([1, 2, 3].every((k) => { const b = blocks[cidx(px, y + k, pz)]; return b === B.AIR || b === B.HUSH_VEIN; })) { fy = y; break; }
  }
  if (fy === null) return false;
  const free = (x, y, z) => { const b = blocks[cidx(x, y, z)]; return b === B.AIR || b === B.HUSH_VEIN; };
  const cells = [];
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const x = px + dx, z = pz + dz, i = cidx(x, fy, z);
    if (!SOLID[blocks[i]] || blocks[i] === B.BEDROCK || !free(x, fy + 1, z)) continue;
    const r = hashf(seed, x + cx * 16, fy, z + cz * 16);
    if (Math.abs(dx) + Math.abs(dz) > 4 && r < 0.35) continue; // crumbled corners
    blocks[i] = r < 0.15 ? B.HUSHMOSS : RUIN_STONE[Math.floor(hashf(seed, x, z, 9904 + cx * 31 + cz) * RUIN_STONE.length)];
    meta[i] = 0;
    const above = cidx(x, fy + 1, z);
    if (blocks[above] === B.HUSH_VEIN) blocks[above] = B.AIR;
    cells.push([x, z, dx, dz]);
  }
  // broken pillars at the corners of the inner square
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    const x = px + dx, z = pz + dz;
    if (hashf(seed, x + cx * 16, fy, z + cz * 16 + 7) > 0.65 || !free(x, fy + 1, z)) continue;
    const h = 1 + Math.floor(hashf(seed, x, fy, z + 9905) * 4);
    for (let k = 1; k <= h && free(x, fy + k, z) && free(x, fy + k + 1, z); k++) blocks[cidx(x, fy + k, z)] = k === h ? B.CHISELED_STONE_BRICKS : B.STONE_BRICKS;
  }
  // candles (most of them long burnt out) and the chest
  let chest = hashf(seed, cx, cz, 9906) < 0.65;
  for (const [x, z, dx, dz] of cells) {
    const a = cidx(x, fy + 1, z);
    if (blocks[a] !== B.AIR) continue;
    const r = hashf(seed, x + cx * 16, fy + 1, z + cz * 16);
    if (chest && Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && r < 0.5) {
      blocks[a] = B.CHEST; meta[a] = (Math.floor(r * 8) & 3) | 8 | (HUSH_LOOT << 4); chest = false;
    } else if (r > 0.88) {
      blocks[a] = r > 0.97 ? B.CANDLE_LIT : B.CANDLE; meta[a] = Math.floor(hashf(seed, x, z, 9907) * 4);
    }
  }
  return true;
}

// ---- runtime rules (pure, unit tested) ------------------------------------------------------

/** How far a Hush Sensor hears (blocks, straight-line distance). */
export const VIBRATION_RANGE = 8;
/** Ticks a sensor's pulse lasts (reference: 30) and how long it then rests before it can hear again (10). */
export const SENSOR_PULSE = 30, SENSOR_REST = 10;
/** Warning: one step per shriek / sensor alarm at most every 10 s; at 4 a Hushkeeper comes; one step fades every 10 minutes. */
export const WARNING_MAX = 4, WARNING_COOLDOWN = 200, WARNING_DECAY = 12000;
/** Darkness from a shrieker: 12 s, felt within 40 blocks. */
export const DARKNESS_TICKS = 260, DARKNESS_RANGE = 40;

/** Cinnabar power of a sensor's pulse: 15 for a sound at the sensor, falling to 1 at the edge of its hearing. */
export function sensorPower(dist, range = VIBRATION_RANGE) {
  return Math.max(1, Math.min(15, 15 - Math.floor(dist * 14 / range)));
}

/** Does a sensor at distance `dist` pick up a vibration? (it must be idle, and close enough) */
export function sensorHears(dist, sensorMeta, restingUntil = 0, now = 0, range = VIBRATION_RANGE) {
  return dist <= range && (sensorMeta & 15) === 0 && now >= restingUntil;
}

/** A footstep makes no vibration when sneaking or when walking on wool or a carpet. */
export function quietStep(sneaking, blockBelow) {
  if (sneaking) return true;
  const b = BLOCKS[blockBelow];
  return !!(b && (b.sound === 'wool' && !HUSH_IDS.has(blockBelow) || b.carpet && blockBelow !== B.HUSH_VEIN));
}

/**
 * Warning levels per player (by name): raised by sensor alarms and shrieks, at most one step per
 * WARNING_COOLDOWN ticks, capped at WARNING_MAX; a step fades after WARNING_DECAY quiet ticks.
 */
export class WarningLevels {
  constructor() { this.map = new Map(); }
  entry(name) {
    let e = this.map.get(name);
    if (!e) { e = { level: 0, last: -Infinity }; this.map.set(name, e); }
    return e;
  }
  level(name) { const e = this.map.get(name); return e ? e.level : 0; }
  /** Try to raise the level; returns the new level, or -1 while still cooling down. */
  raise(name, now) {
    const e = this.entry(name);
    if (now - e.last < WARNING_COOLDOWN) return -1;
    e.last = now;
    e.level = Math.min(WARNING_MAX, e.level + 1);
    return e.level;
  }
  /** Let the levels fade with time. */
  decay(now) {
    for (const [k, e] of this.map) {
      if (e.level > 0 && now - e.last >= WARNING_DECAY) { e.level--; e.last = now; }
      if (e.level === 0 && now - e.last >= WARNING_DECAY) this.map.delete(k);
    }
  }
  reset(name) { this.map.delete(name); }
  save() { return [...this.map].map(([k, e]) => [k, e.level]); }
  load(list, now = 0) { this.map.clear(); if (Array.isArray(list)) for (const [k, lv] of list) if (typeof k === 'string' && lv > 0) this.map.set(k, { level: Math.min(WARNING_MAX, lv | 0), last: now - WARNING_COOLDOWN }); }
}

/**
 * How dark the Darkness effect makes the screen (0..1): it fades in and out at its ends and
 * breathes in slow waves (one every ~2.6 s) in between.
 */
export function darknessFactor(ticksLeft, sec) {
  if (!(ticksLeft > 0)) return 0;
  const ends = Math.min(1, ticksLeft / 40);
  const wave = 0.5 + 0.5 * Math.cos(sec * Math.PI * 2 / 2.6);
  return ends * (0.6 + 0.4 * wave * wave);
}

/** Experience a dying creature is worth to a catalyst (what it would drop if a player killed it). */
export function deathCharge(def, baby = false) {
  if (!def) return 0;
  if (def.xp) return def.xp;
  return def.category === 'monster' ? (baby ? 12 : 5) : 1 + (baby ? 0 : 1);
}

const HUSHABLE = new Uint8Array(BLOCK_LIMIT);
for (const id of [B.STONE, B.DEEPSTONE, B.GRANITE, B.DIORITE, B.ANDESITE, B.TUFF, B.SEEPSTONE, B.DIRT, B.GRAVEL, B.COBBLED_DEEPSTONE, B.COBBLESTONE,
  B.GRASS, B.SAND, B.RED_SAND, B.CLAY, B.MOSS_BLOCK, B.SNOWY_GRASS, B.MYCELIUM, B.CHALKSTONE, B.SMOOTH_BASALT]) HUSHABLE[id] = 1;
const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * A Hush Catalyst spreads moss from where something died: `charge` (the creature's experience)
 * walks out from the spot over the ground, turning one exposed block into Hushmoss per point
 * (moving freely over moss already there). Far enough from the catalyst a big enough charge can
 * raise a sensor (or, rarely, a shrieker that only shrieks). `w` has getBlock / setBlock.
 * Returns the number of blocks changed.
 */
export function spreadHushmoss(w, x, y, z, charge, rng = Math.random, catalyst = null) {
  let cx = Math.floor(x), cy = Math.floor(y) - 1, cz = Math.floor(z), changed = 0, guard = charge * 6 + 12;
  const exposed = (a, b, c) => { for (const [dx, dy, dz] of DIRS6) if (!SOLID[w.getBlock(a + dx, b + dy, c + dz)]) return true; return false; };
  // start on the ground under the body
  for (let k = 0; k < 4 && !SOLID[w.getBlock(cx, cy, cz)]; k++) cy--;
  while (charge > 0 && guard-- > 0) {
    const id = w.getBlock(cx, cy, cz);
    if (HUSHABLE[id] && exposed(cx, cy, cz)) { w.setBlock(cx, cy, cz, B.HUSHMOSS, 0); charge--; changed++; continue; }
    if (id === B.HUSHMOSS && charge >= 10 && catalyst && Math.hypot(cx - catalyst[0], cz - catalyst[2]) >= 4 && rng() < 0.12
      && w.getBlock(cx, cy + 1, cz) === B.AIR && w.getBlock(cx, cy + 2, cz) === B.AIR) {
      w.setBlock(cx, cy + 1, cz, rng() < 0.85 ? B.HUSH_SENSOR : B.HUSH_SHRIEKER, 0);
      charge -= 10; changed++; continue;
    }
    // wander to a neighbouring exposed ground block (preferring ones that are not moss yet)
    const opts = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dz && !dy) continue;
      const nx = cx + dx, ny = cy + dy, nz = cz + dz, n = w.getBlock(nx, ny, nz);
      if ((HUSHABLE[n] || n === B.HUSHMOSS) && exposed(nx, ny, nz)) opts.push([nx, ny, nz, n === B.HUSHMOSS ? 1 : 3]);
    }
    if (!opts.length) break;
    let tot = 0; for (const o of opts) tot += o[3];
    let r = rng() * tot, pick = opts[opts.length - 1];
    for (const o of opts) { if ((r -= o[3]) < 0) { pick = o; break; } }
    [cx, cy, cz] = pick;
  }
  return changed;
}

/**
 * A place for a Hushkeeper to dig up out of the ground near (x, y, z): a solid floor with three
 * free blocks over it, 4-10 blocks away from the player. Null if none is found.
 */
export function findEmergeSpot(w, x, y, z, rng = Math.random) {
  for (let t = 0; t < 40; t++) {
    const a = rng() * Math.PI * 2, d = 4 + rng() * 6;
    const bx = Math.floor(x + Math.cos(a) * d), bz = Math.floor(z + Math.sin(a) * d);
    for (let dy = 5; dy >= -6; dy--) {
      const by = Math.floor(y) + dy;
      if (SOLID[w.getBlock(bx, by - 1, bz)] && !SOLID[w.getBlock(bx, by, bz)] && !SOLID[w.getBlock(bx, by + 1, bz)] && !SOLID[w.getBlock(bx, by + 2, bz)]) return [bx + 0.5, by, bz + 0.5];
    }
  }
  return null;
}

/** Positions of blocks with an id in `ids` within `r` blocks of (x, y, z), nearest first. */
export function findNear(w, x, y, z, r, ids) {
  const out = [], bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z), R = Math.ceil(r);
  for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) for (let dy = -R; dy <= R; dy++) {
    const id = w.getBlock(bx + dx, by + dy, bz + dz);
    if (!ids.has(id)) continue;
    const d = Math.hypot(bx + dx + 0.5 - x, by + dy + 0.5 - y, bz + dz + 0.5 - z);
    if (d <= r) out.push({ x: bx + dx, y: by + dy, z: bz + dz, id, d });
  }
  return out.sort((a, b) => a.d - b.d);
}
