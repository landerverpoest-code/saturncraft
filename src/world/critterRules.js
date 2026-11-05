// Ambient critters: the rules behind butterflies, fireflies, falling leaves, skimmers and bird flocks (render/critters.js draws them).
//
// They are purely cosmetic: no entity, no collision, no AI, nothing saved or sent over the network. Every critter is a pure function of
// (world seed, the 16-block cell it lives over, its slot number, the clock), so two players beside each other see much the same thing
// without a single byte being exchanged, and nothing here costs more than a few multiplications a frame:
//   * each cell around the player holds K candidate spots per kind, placed by a hash of (seed, cell, kind, slot); a spot is used when its
//     hash is below the acceptance chance (biome density x time of day x weather x season x the reduced-motion scale), so a critter
//     fades in and out as conditions change instead of being re-rolled;
//   * the slots are rebuilt twice a second at most into fixed pools with hard caps (CAPS); the nearest cells fill first;
//   * a slot's position at time t is a closed-form wander round its home spot (flocks cross the sky in a straight line and wrap
//     round the player).
// This file imports only the (small) block ids it needs, so tests can drive it with a fake world.
import { B } from './blocks.js';
import { LEAVES } from './trees.js';
import { BIOMES } from './biomes.js';

export const KINDS = ['butterfly', 'firefly', 'leaf', 'skimmer', 'bird'];
/** Hard caps: instances drawn per kind (the whole system is at most five draw calls and this many matrices a frame). */
export const CAPS = { butterfly: 28, firefly: 48, leaf: 40, skimmer: 14, bird: 14 };
export const CELL = 16;
export const CELL_RADIUS = 2;          // 5 x 5 cells round the player
export const VIEW = 36;                // blocks: ground critters shrink away beyond this
export const CANDIDATES = 8;           // candidate spots per kind per cell
export const REFRESH = 0.5;            // seconds between slot rebuilds
export const BIRD_RANGE = 140;         // flocks wrap round the player within this many blocks
export const BIRD_HEIGHT = [96, 138];  // flight altitude (absolute y)
export const FLOCK_MAX = 2;

/** Density of each kind per biome key: about this many in a 16 x 16 cell in the best conditions. */
export const DENSITY = {
  butterfly: { flower_forest: 5, blossom_grove: 5, highland_meadow: 4.5, plains: 2.4, birch_forest: 2, forest: 1, savanna: 0.8, jungle: 1.6, mushroom_fields: 1 },
  firefly: { swamp: 6, mangrove_swamp: 6, dark_forest: 4.5, jungle: 4, forest: 3, flower_forest: 3, birch_forest: 2, blossom_grove: 2.2 },
  leaf: { forest: 5, birch_forest: 5, dark_forest: 4, flower_forest: 4, plains: 0.8 },
  skimmer: { swamp: 3, mangrove_swamp: 3, river: 2.2, jungle: 1.5, plains: 1, forest: 1, birch_forest: 1, savanna: 1, highland_meadow: 1.2, flower_forest: 1, blossom_grove: 1 },
};
const MAX_DENSITY = {};
for (const k of Object.keys(DENSITY)) MAX_DENSITY[k] = Math.max(...Object.values(DENSITY[k]));
/** Density by biome id (arrays, so a lookup is one index). */
const DENSITY_BY_ID = {};
for (const k of Object.keys(DENSITY)) DENSITY_BY_ID[k] = BIOMES.map((b) => DENSITY[k][b.key] || 0);

const SEASON_MUL = {
  butterfly: { spring: 1.3, summer: 1, autumn: 0.35, winter: 0 },
  firefly: { spring: 0.8, summer: 1.4, autumn: 0.5, winter: 0 },
  leaf: { spring: 0, summer: 0, autumn: 1, winter: 0 },
  skimmer: { spring: 0.8, summer: 1.4, autumn: 0.5, winter: 0 },
  bird: { spring: 1.3, summer: 1, autumn: 1.2, winter: 0.4 },
};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const seasonMul = (kind, season) => (season && SEASON_MUL[kind][season] !== undefined ? SEASON_MUL[kind][season] : kind === 'leaf' ? 0 : 1); // (no seasons: no falling leaves)

/**
 * How much of each kind the moment allows, 0..~1.5: ctx = { day (combined sunlight 0..1), rain (0..1), season (key or null when the
 * seasons are off), scale (the reduced-motion count scale, 1 = full) }. By day the butterflies and skimmers fly (not in rain, not in
 * winter), by night the fireflies glow, leaves fall in autumn, and birds cross the sky by day.
 */
export function kindFactors(ctx) {
  const day = clamp01(ctx.day ?? 1), rain = clamp01(ctx.rain ?? 0), scale = Math.max(0, ctx.scale ?? 1), season = ctx.season || null;
  const dry = 1 - rain;
  const night = 1 - smooth(0.15, 0.55, day);
  const bright = smooth(0.5, 0.85, day);
  return {
    butterfly: bright * dry * seasonMul('butterfly', season) * scale,
    firefly: night * (1 - rain * 0.8) * seasonMul('firefly', season) * scale,
    leaf: (0.35 + 0.65 * smooth(0.05, 0.4, day)) * (1 - rain * 0.5) * seasonMul('leaf', season) * scale,
    skimmer: bright * dry * seasonMul('skimmer', season) * scale,
    bird: smooth(0.3, 0.7, day) * (1 - rain * 0.8) * seasonMul('bird', season) * scale,
  };
}

/** The reduced-motion settings applied to the critter scales: [count scale, clock speed]. */
export function critterScales(fx) {
  return [fx && fx.critters !== undefined ? fx.critters : 1, fx && fx.critterSpeed !== undefined ? fx.critterSpeed : 1];
}

// ---- hashing ---------------------------------------------------------------------------------

/** A 32-bit number from a world seed (a number or a string). */
export function seedNumber(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
/** Deterministic value in [0, 1) from a seed and up to four integers. */
export function hash01(seed, a, b = 0, c = 0, d = 0) {
  let h = (seed ^ Math.imul(a | 0, 0x27d4eb2d)) >>> 0;
  h = Math.imul(h ^ (h >>> 15) ^ Math.imul(b | 0, 0x165667b1), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ Math.imul(c | 0, 0xc2b2ae35), 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 16) ^ Math.imul(d | 0, 0x9e3779b1), 0x165667b1);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ---- slots -----------------------------------------------------------------------------------

/** A fresh, empty slot. */
export const newSlot = () => ({ hx: 0, hy: 0, hz: 0, ph: 0, a: 0, b: 0, spd: 1, presence: 1, size: 1, fall: 0, cr: 1, cg: 1, cb: 1, id: 0 });
/** Pools of preallocated slots, one list per kind, sized by the caps. */
export function newPools() {
  const pools = {};
  for (const k of KINDS) pools[k] = { n: 0, list: Array.from({ length: CAPS[k] }, newSlot) };
  return pools;
}

const BUTTERFLY_COLOURS = [[1, 0.78, 0.18], [0.95, 0.95, 0.98], [0.95, 0.5, 0.15], [0.4, 0.62, 1], [1, 0.45, 0.62], [0.72, 0.5, 0.95]];
const LEAF_COLOURS = [[0.95, 0.42, 0.1], [0.85, 0.2, 0.08], [0.95, 0.72, 0.15], [0.62, 0.36, 0.14], [0.8, 0.5, 0.1]];

/** Ground height of the column and what is on top of it. */
function surface(world, x, z) {
  const h = world.heightAt(x, z);
  return { h, id: world.getBlock(x, h, z) };
}

/**
 * Rebuild the slots of one cell for every kind into `pools` (stopping at each kind's cap). `world` needs isLoaded, biomeAt, heightAt
 * and getBlock. Returns the number of slots added.
 */
export function fillCell(pools, world, seed, cx, cz, factors, px, pz) {
  let added = 0;
  const x0 = cx * CELL, z0 = cz * CELL;
  for (const kind of ['butterfly', 'firefly', 'leaf', 'skimmer']) {
    const f = factors[kind];
    const pool = pools[kind];
    if (f <= 0.001 || pool.n >= pool.list.length) continue;
    const kk = KINDS.indexOf(kind);
    const pMax = Math.min(1, MAX_DENSITY[kind] * f / CANDIDATES);
    for (let j = 0; j < CANDIDATES && pool.n < pool.list.length; j++) {
      const r = hash01(seed, cx, cz, kk * 64 + j, 1);
      if (r >= pMax) continue;
      const hx = x0 + hash01(seed, cx, cz, kk * 64 + j, 2) * CELL, hz = z0 + hash01(seed, cx, cz, kk * 64 + j, 3) * CELL;
      const ix = Math.floor(hx), iz = Math.floor(hz);
      if (!world.isLoaded(ix, iz)) continue;
      const dens = DENSITY_BY_ID[kind][world.biomeAt(ix, iz)] || 0;
      const p = Math.min(1, dens * f / CANDIDATES);
      if (r >= p) continue;
      const s = surface(world, ix, iz);
      let hy, fall = 0;
      if (kind === 'skimmer') {
        if (s.id !== B.WATER) continue;
        hy = s.h + 1.1 + hash01(seed, cx, cz, kk * 64 + j, 4) * 0.8;
      } else if (kind === 'leaf') {
        if (!LEAVES.has(s.id)) continue; // a leaf comes off a tree: fall from the canopy down to the first block that is not foliage or trunk
        let y = s.h;
        while (y > s.h - 14 && (LEAVES.has(world.getBlock(ix, y, iz)) || world.getBlock(ix, y, iz) === 0)) y--;
        fall = s.h + 1 - (y + 1);
        if (fall < 3) continue;
        hy = y + 1;
      } else {
        if (LEAVES.has(s.id) || s.id === B.WATER && kind === 'butterfly' || world.getBlock(ix, s.h + 1, iz) !== 0 && !(kind === 'firefly')) continue;
        hy = s.h + 1 + (kind === 'firefly' ? 0.6 + hash01(seed, cx, cz, kk * 64 + j, 4) * 2.2 : 0.4);
      }
      const sl = pool.list[pool.n++];
      sl.hx = hx; sl.hy = hy; sl.hz = hz; sl.fall = fall; sl.id = kk * 64 + j;
      sl.ph = hash01(seed, cx, cz, kk * 64 + j, 5) * Math.PI * 2;
      sl.a = 0.6 + hash01(seed, cx, cz, kk * 64 + j, 6);   // wander size / speed variety
      sl.b = hash01(seed, cx, cz, kk * 64 + j, 7);
      sl.spd = 0.7 + hash01(seed, cx, cz, kk * 64 + j, 8) * 0.7;
      sl.presence = clamp01((p - r) / 0.05);                // fades in as the acceptance chance rises past its roll
      const pal = kind === 'butterfly' ? BUTTERFLY_COLOURS[Math.floor(sl.b * BUTTERFLY_COLOURS.length)] : kind === 'leaf' ? LEAF_COLOURS[Math.floor(sl.b * LEAF_COLOURS.length)] : kind === 'firefly' ? [0.75, 1.3, 0.12] : [0.55, 0.9, 0.85];
      sl.cr = pal[0]; sl.cg = pal[1]; sl.cb = pal[2];
      sl.size = kind === 'butterfly' ? 0.2 + sl.b * 0.08 : kind === 'firefly' ? 0.11 : kind === 'leaf' ? 0.2 : 0.42;
      added++;
    }
  }
  return added;
}

/** Cell offsets for the 5 x 5 area, nearest first. */
export const CELL_ORDER = (() => {
  const out = [];
  for (let dx = -CELL_RADIUS; dx <= CELL_RADIUS; dx++) for (let dz = -CELL_RADIUS; dz <= CELL_RADIUS; dz++) out.push([dx, dz]);
  return out.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
})();

/** Rebuild every pool for a player at (px, pz). Returns the total number of ground critters. */
export function rebuild(pools, world, seed, px, pz, factors) {
  for (const k of KINDS) pools[k].n = 0;
  const pcx = Math.floor(px / CELL), pcz = Math.floor(pz / CELL);
  let n = 0;
  for (const [dx, dz] of CELL_ORDER) n += fillCell(pools, world, seed, pcx + dx, pcz + dz, factors, px, pz);
  return n;
}

/** Bird flocks: how many (0..FLOCK_MAX) the moment allows, and birds in each (5-7, a V). */
export function flockCount(factors) { const f = factors.bird; return f <= 0.02 ? 0 : Math.min(FLOCK_MAX, Math.max(1, Math.round(f * FLOCK_MAX))); }
export function flockSize(seed, flock) { return 5 + Math.floor(hash01(seed, flock, 11, 0) * 3); }

// ---- motion ----------------------------------------------------------------------------------

/**
 * Where a ground critter is at clock time `t` (seconds): writes [x, y, z] into `out`, and returns a flap phase (0..1 wing opening) /
 * glow (fireflies) / spin (leaves) in out[3].
 */
export function critterPos(kind, s, t, out) {
  const k = s.spd, ph = s.ph;
  if (kind === 'butterfly') {
    out[0] = s.hx + Math.sin(t * 0.37 * k + ph) * 3 * s.a + Math.sin(t * 0.9 * k + ph * 2) * 0.8;
    out[2] = s.hz + Math.cos(t * 0.29 * k + ph * 1.3) * 3 * s.a + Math.cos(t * 0.7 * k + ph) * 0.8;
    out[1] = s.hy + 0.5 + Math.sin(t * 1.1 * k + ph) * 0.45 + Math.abs(Math.sin(t * 7 * k)) * 0.08;
    out[3] = 0.2 + 0.8 * Math.abs(Math.sin(t * 13 * k + ph));
  } else if (kind === 'firefly') {
    out[0] = s.hx + Math.sin(t * 0.21 * k + ph) * 2 * s.a + Math.sin(t * 0.55 * k + ph * 3) * 0.4;
    out[2] = s.hz + Math.cos(t * 0.17 * k + ph * 1.7) * 2 * s.a + Math.cos(t * 0.6 * k + ph) * 0.4;
    out[1] = s.hy + Math.sin(t * 0.4 * k + ph) * 0.6;
    const blink = Math.max(0, Math.sin(t * 1.7 * k + ph));
    out[3] = blink * blink; // glow 0..1
  } else if (kind === 'leaf') {
    const period = 8 + s.b * 6;
    const u = (((t + ph * 1.7) / period) % 1 + 1) % 1; // 0 at the canopy, 1 at the ground
    out[1] = s.hy + s.fall * (1 - u);
    out[0] = s.hx + u * 2.5 * (s.a - 0.6) + Math.sin(t * 1.3 * k + ph) * 0.7;
    out[2] = s.hz + u * 1.5 + Math.cos(t * 1.1 * k + ph) * 0.7;
    out[3] = t * 1.8 * k + ph; // spin (radians)
  } else { // skimmer: hovers, then darts
    const u = Math.sin(t * 0.5 * k + ph);
    out[0] = s.hx + Math.sign(u) * Math.pow(Math.abs(u), 0.35) * 3.2 * s.a;
    out[2] = s.hz + Math.cos(t * 0.37 * k + ph * 1.7) * 2.6 * s.a;
    out[1] = s.hy + Math.sin(t * 5 * k + ph) * 0.05;
    out[3] = 0.4 + 0.6 * Math.abs(Math.sin(t * 40 + ph)); // wing blur
  }
  return out;
}

/** Wrap v into [centre - half, centre + half). */
export function wrapAround(v, centre, half) {
  const span = half * 2;
  return ((((v - centre + half) % span) + span) % span) - half + centre;
}

/**
 * A bird of a flock at time t: the flock flies in a straight line (heading and speed by hash), wrapping round the player so that
 * flocks keep crossing the sky; birds sit in a V behind the leader. Writes [x, y, z, flap] into out.
 */
export function birdPos(seed, flock, i, t, px, pz, out) {
  const ang = hash01(seed, flock, 21, 0) * Math.PI * 2, speed = 5 + hash01(seed, flock, 22, 0) * 3;
  const y0 = BIRD_HEIGHT[0] + hash01(seed, flock, 23, 0) * (BIRD_HEIGHT[1] - BIRD_HEIGHT[0]);
  const ax = (hash01(seed, flock, 24, 0) - 0.5) * 2 * BIRD_RANGE, az = (hash01(seed, flock, 25, 0) - 0.5) * 2 * BIRD_RANGE;
  const dx = Math.cos(ang), dz = Math.sin(ang);
  const cx = wrapAround(ax + dx * speed * t, px, BIRD_RANGE), cz = wrapAround(az + dz * speed * t, pz, BIRD_RANGE);
  const row = Math.ceil(i / 2), side = i === 0 ? 0 : (i % 2 ? 1 : -1);
  const back = row * 2.2, spread = row * 1.8 * side;
  out[0] = cx - dx * back - dz * spread;
  out[2] = cz - dz * back + dx * spread;
  out[1] = y0 + Math.sin(t * 0.7 + i) * 0.8 + row * 0.1;
  out[3] = 0.25 + 0.75 * Math.abs(Math.sin(t * 5 + i * 1.3 + flock)); // wing beat
  return out;
}
