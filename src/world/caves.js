// Caves content: weathering copper, Storm Rods, Violite geodes and buds,
// Seepstone spikes. Pure rules (odds, stages, shapes, damage) are exported for
// the tests; the world-facing helpers take any object with getBlock / getMeta /
// setBlock (the main-thread World).
import { B, BLOCKS, SOLID, OPAQUE } from './blocks.js';
import { hashf } from './noise.js';

// ---- facing (buds, clusters, spikes) ----------------------------------------
// 0 up, 1 down, 2 -z, 3 +z, 4 -x, 5 +x: the direction the crystal points to
export const DIRS6 = [[0, 1, 0], [0, -1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
export const FACING_UP = 0, FACING_DOWN = 1;
export function facingOf(dx, dy, dz) { return DIRS6.findIndex((d) => d[0] === dx && d[1] === dy && d[2] === dz); }

// ---- copper weathering --------------------------------------------------------
export const COPPER_STAGES = [B.COPPER_BLOCK, B.DULLED_COPPER, B.TARNISHED_COPPER, B.VERDIGRIS_COPPER];
export const WAXED_STAGES = [B.WAXED_COPPER_BLOCK, B.WAXED_DULLED_COPPER, B.WAXED_TARNISHED_COPPER, B.WAXED_VERDIGRIS_COPPER];
/** Reference: each random tick a weathering block tries to age with chance 0.05688889 (about 1 in 17.6). */
export const OXIDATION_TICK_CHANCE = 0.05688889;

/** Weathering stage 0..3 of a (sealed or not) copper block, or -1. */
export function copperStage(id) {
  const i = COPPER_STAGES.indexOf(id);
  return i >= 0 ? i : WAXED_STAGES.indexOf(id);
}
export function isWaxed(id) { return WAXED_STAGES.includes(id); }

/**
 * Chance that a copper block of stage `age` ages one stage, given the stages of
 * the weathering (unsealed) copper within Manhattan distance 4 (reference
 * ChangeOverTimeBlock): any less weathered neighbour holds it back; otherwise
 * ((older + 1) / (older + same + 1))^2, times 0.75 for fresh copper.
 */
export function oxidationChance(age, neighbourAges) {
  if (age < 0 || age >= 3) return 0;
  let older = 0, same = 0;
  for (const a of neighbourAges) {
    if (a < age) return 0;
    if (a > age) older++; else same++;
  }
  const f = (older + 1) / (older + same + 1);
  return f * f * (age === 0 ? 0.75 : 1);
}

/** Random tick of unsealed copper. */
export function tickCopper(world, x, y, z, id, rng = Math.random) {
  const age = COPPER_STAGES.indexOf(id);
  if (age < 0 || age >= 3 || rng() >= OXIDATION_TICK_CHANCE) return false;
  const ages = [];
  for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) for (let dz = -4; dz <= 4; dz++) {
    const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    if (m === 0 || m > 4) continue;
    const a = COPPER_STAGES.indexOf(world.getBlock(x + dx, y + dy, z + dz));
    if (a >= 0) ages.push(a);
  }
  if (rng() >= oxidationChance(age, ages)) return false;
  world.setBlock(x, y, z, COPPER_STAGES[age + 1], 0);
  return true;
}

/** Honeycomb on copper: the sealed id, or null. */
export function waxCopper(id) { const a = COPPER_STAGES.indexOf(id); return a >= 0 ? WAXED_STAGES[a] : null; }
/** An axe on copper: removes the wax, else scrapes one stage of weathering off; null if nothing to do. */
export function scrapeCopper(id) {
  const w = WAXED_STAGES.indexOf(id);
  if (w >= 0) return COPPER_STAGES[w];
  const a = COPPER_STAGES.indexOf(id);
  return a > 0 ? COPPER_STAGES[a - 1] : null;
}

/**
 * Lightning hitting copper (or a Storm Rod standing on copper) cleans it
 * (reference clearCopperOnLightningStrike): the struck block becomes fresh and
 * 3-5 random walks of 1-8 steps each scrape one stage off the copper they reach.
 */
export function lightningCleanCopper(world, x, y, z, rng = Math.random) {
  let id = world.getBlock(x, y, z);
  if (id === B.STORM_ROD) {
    const dy = world.getMeta(x, y, z) & 1 ? 1 : -1; // the block it is fixed to
    y += dy; id = world.getBlock(x, y, z);
  }
  if (COPPER_STAGES.indexOf(id) < 0) return 0;
  let changed = 0;
  if (id !== B.COPPER_BLOCK) { world.setBlock(x, y, z, B.COPPER_BLOCK, 0); changed++; }
  const walks = 3 + Math.floor(rng() * 3);
  for (let k = 0; k < walks; k++) {
    let cx = x, cy = y, cz = z;
    const steps = 1 + Math.floor(rng() * 8);
    for (let s = 0; s < steps; s++) {
      let moved = false;
      for (let t = 0; t < 10 && !moved; t++) {
        const nx = cx + Math.floor(rng() * 3) - 1, ny = cy + Math.floor(rng() * 3) - 1, nz = cz + Math.floor(rng() * 3) - 1;
        const a = COPPER_STAGES.indexOf(world.getBlock(nx, ny, nz));
        if (a < 0) continue;
        if (a > 0) { world.setBlock(nx, ny, nz, COPPER_STAGES[a - 1], 0); changed++; }
        cx = nx; cy = ny; cz = nz; moved = true;
      }
      if (!moved) break;
    }
  }
  return changed;
}

// ---- Storm Rods ---------------------------------------------------------------
export const ROD_RANGE = 128;
/** Storm Rods in a loaded chunk (cached on the chunk; cleared when a rod is placed or removed). */
export function rodsInChunk(chunk) {
  if (chunk.stormRods) return chunk.stormRods;
  const out = [], b = chunk.blocks, x0 = chunk.cx * 16, z0 = chunk.cz * 16;
  for (let i = 0; i < b.length; i++) if (b[i] === B.STORM_ROD) out.push([x0 + (i & 15), -64 + (i >> 8), z0 + ((i >> 4) & 15)]);
  return (chunk.stormRods = out);
}
/**
 * The Storm Rod that draws a bolt aimed at (x, z): the closest rod within 128
 * blocks (square, like the reference) that is the highest block of its column.
 */
export function findStormRod(world, x, z, range = ROD_RANGE) {
  let best = null, bd = Infinity;
  for (let cx = (x - range) >> 4; cx <= (x + range) >> 4; cx++) for (let cz = (z - range) >> 4; cz <= (z + range) >> 4; cz++) {
    const c = world.getChunk(cx, cz);
    if (!c) continue;
    for (const r of rodsInChunk(c)) {
      if (Math.abs(r[0] - x) > range || Math.abs(r[2] - z) > range) continue;
      if (world.heightAt(r[0], r[2]) !== r[1]) continue; // must see the sky
      const d = (r[0] - x) ** 2 + (r[2] - z) ** 2;
      if (d < bd) { bd = d; best = r; }
    }
  }
  return best;
}
const ROD_STANDING = [[7 / 16, 0, 7 / 16, 9 / 16, 12 / 16, 9 / 16], [6 / 16, 12 / 16, 6 / 16, 10 / 16, 1, 10 / 16]];
const ROD_HANGING = ROD_STANDING.map(([a, b, c, d, e, f]) => [a, 1 - e, c, d, 1 - b, f]);
export function rodBoxes(meta) { return meta & 1 ? ROD_HANGING : ROD_STANDING; }

// ---- Violite: buds and geodes ------------------------------------------------
export const BUD_STAGES = [B.SMALL_VIOLITE_BUD, B.MEDIUM_VIOLITE_BUD, B.LARGE_VIOLITE_BUD, B.VIOLITE_CLUSTER];
/** Reference budding amethyst: 1 in 5 random ticks it tries to grow a bud on one random side. */
export const BUD_GROW_CHANCE = 0.2;
/** What a budding block grows on its `dir` side, given the block there (null = nothing). */
export function nextBud(targetId, targetMeta, dir) {
  if (targetId === B.AIR || (targetId === B.WATER && targetMeta === 0)) return B.SMALL_VIOLITE_BUD;
  const s = BUD_STAGES.indexOf(targetId);
  if (s >= 0 && s < 3 && (targetMeta & 7) === dir) return BUD_STAGES[s + 1];
  return null;
}
export function tickBudding(world, x, y, z, rng = Math.random) {
  if (rng() >= BUD_GROW_CHANCE) return false;
  const dir = Math.floor(rng() * 6), [dx, dy, dz] = DIRS6[dir];
  const tx = x + dx, ty = y + dy, tz = z + dz;
  const next = nextBud(world.getBlock(tx, ty, tz), world.getMeta(tx, ty, tz), dir);
  if (next == null) return false;
  world.setBlock(tx, ty, tz, next, dir);
  return true;
}
// [inset, height] in pixels of each bud stage (reference outline shapes)
const BUD_SIZE = { [B.SMALL_VIOLITE_BUD]: [4, 3], [B.MEDIUM_VIOLITE_BUD]: [3, 4], [B.LARGE_VIOLITE_BUD]: [3, 5], [B.VIOLITE_CLUSTER]: [3, 7] };

/** Map a box given for an upward-pointing crystal to the facing. */
export function orientBox(b, facing) {
  const map = (x, y, z) => orientPoint(x, y, z, facing);
  const p = map(b[0], b[1], b[2]), q = map(b[3], b[4], b[5]);
  return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2]), Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])];
}
/** Local point of an upward crystal (y along the crystal) turned to `facing`. */
export function orientPoint(x, y, z, facing) {
  switch (facing) {
    case 1: return [x, 1 - y, z];
    case 2: return [x, z, 1 - y];
    case 3: return [x, z, y];
    case 4: return [1 - y, x, z];
    case 5: return [y, x, z];
    default: return [x, y, z];
  }
}
/** Selection / collision box of a crystal block (bud, cluster, spike, rod). */
export function crystalBox(id, meta) {
  if (id === B.SEEPSTONE_SPIKE) {
    const w = [3, 4, 5, 6][(meta >> 3) & 3] / 16;
    return [0.5 - w, 0, 0.5 - w, 0.5 + w, 1, 0.5 + w];
  }
  const [inset, h] = BUD_SIZE[id] || [3, 7];
  return orientBox([inset / 16, 0, inset / 16, 1 - inset / 16, h / 16, 1 - inset / 16], meta & 7);
}
/** Buds need a solid block behind them. */
export function crystalSupported(world, x, y, z, id, meta) {
  const [dx, dy, dz] = DIRS6[meta & 7];
  const b = world.getBlock(x - dx, y - dy, z - dz);
  return !!(SOLID[b] && OPAQUE[b]);
}
/** Texture of a crystal block, by meta (spikes change with their thickness). */
export function crystalTex(id, meta) {
  if (id === B.SEEPSTONE_SPIKE) return 'seepstone_spike_' + ((meta >> 3) & 3);
  return BLOCKS[id].tex.side;
}

// Geodes (reference: 1 in 24 chunks, y -58..30): a hollow ball lined with
// Violite (8.3 % of it budding), wrapped in Chalkstone and Smooth Basalt.
export const GEODE_CHANCE = 1 / 24;
export const GEODE_MIN_Y = -58, GEODE_MAX_Y = 30;
export const GEODE_RADII = [3.3, 4.3, 5.3, 6.2]; // hollow / violite / chalkstone / basalt
export const BUDDING_CHANCE = 0.083, BUD_PLACE_CHANCE = 0.35;
/** Layer at a (noise-wobbled, scaled) distance from the centre: 4 hollow, 3 violite, 2 chalkstone, 1 basalt, 0 outside. */
export function geodeLayer(d) {
  if (d < GEODE_RADII[0]) return 4;
  if (d < GEODE_RADII[1]) return 3;
  if (d < GEODE_RADII[2]) return 2;
  if (d < GEODE_RADII[3]) return 1;
  return 0;
}
/** The geode centred in chunk (cx, cz), if it has one: {x, y, z, scale}. */
export function geodeIn(seed, cx, cz) {
  if (hashf(seed, cx, cz, 3301) >= GEODE_CHANCE) return null;
  return {
    x: cx * 16 + 4 + Math.floor(hashf(seed, cx, cz, 3302) * 8),
    y: GEODE_MIN_Y + Math.floor(hashf(seed, cx, cz, 3303) * (GEODE_MAX_Y - GEODE_MIN_Y + 1)),
    z: cz * 16 + 4 + Math.floor(hashf(seed, cx, cz, 3304) * 8),
    scale: 0.85 + hashf(seed, cx, cz, 3305) * 0.2,
  };
}

// ---- Seepstone spikes ---------------------------------------------------------
export const SPIKE_TIP = 0, SPIKE_FRUSTUM = 1, SPIKE_MIDDLE = 2, SPIKE_BASE = 3;
export const SPIKE_MAX_GROWTH = 7, SPIKE_GROW_CHANCE = 0.011;
export const spikeMeta = (facing, thickness) => (facing & 7) | (thickness << 3);
/**
 * Thickness from the neighbours along the spike (reference rules): `ahead` =
 * the next block towards the tip is a spike pointing the same way, `ahead2` the
 * one after it, `behind` = the block towards the base is such a spike.
 */
export function spikeThickness(ahead, ahead2, behind) {
  if (!ahead) return SPIKE_TIP;
  if (!ahead2) return SPIKE_FRUSTUM;
  return behind ? SPIKE_MIDDLE : SPIKE_BASE;
}
function isSpike(world, x, y, z, facing) {
  return world.getBlock(x, y, z) === B.SEEPSTONE_SPIKE && (world.getMeta(x, y, z) & 7) === facing;
}
export function spikeThicknessAt(world, x, y, z, facing) {
  const d = facing === FACING_DOWN ? -1 : 1;
  return spikeThickness(isSpike(world, x, y + d, z, facing), isSpike(world, x, y + 2 * d, z, facing), isSpike(world, x, y - d, z, facing));
}
/** A spike rests on a solid block (or the next spike) on its base side. */
export function spikeSupported(world, x, y, z, facing) {
  const d = facing === FACING_DOWN ? 1 : -1;
  const b = world.getBlock(x, y + d, z);
  return isSpike(world, x, y + d, z, facing) || !!(SOLID[b] && OPAQUE[b]);
}
/** Damage of a falling stalactite (reference: per block fallen and at most max(length, 6)). */
export function stalactiteDamage(fallDistance, length) {
  const per = Math.max(length, 6), i = Math.ceil(fallDistance - 1);
  return i <= 0 ? 0 : Math.min(Math.floor(i * per), per);
}
/** Landing on the tip of an upward spike: fall distance + 2, doubled (reference stalagmite). */
export function stalagmiteFallDamage(fallDistance) { return Math.max(0, Math.ceil(fallDistance + 2 - 3)) * 2; }
/** Is (x, y, z) the tip of an upward spike? */
export function isStalagmiteTip(world, x, y, z) {
  if (world.getBlock(x, y, z) !== B.SEEPSTONE_SPIKE) return false;
  const m = world.getMeta(x, y, z);
  return (m & 7) === FACING_UP && ((m >> 3) & 3) === SPIKE_TIP;
}

/** Neighbour update of a spike: fall or break when unsupported, else refresh the thickness. */
export function updateSpike(world, x, y, z) {
  const m = world.getMeta(x, y, z), facing = m & 7;
  if (!spikeSupported(world, x, y, z, facing)) {
    if (facing === FACING_DOWN) dropStalactite(world, x, y, z);
    else world.breakBlock(x, y, z, true);
    return;
  }
  const t = spikeThicknessAt(world, x, y, z, facing);
  if (((m >> 3) & 3) !== t) world.setBlock(x, y, z, B.SEEPSTONE_SPIKE, spikeMeta(facing, t));
}
/** The hanging spike at (x, y, z) and every spike below it fall together; the tip hurts what it lands on. */
export function dropStalactite(world, x, y, z) {
  const parts = [];
  for (let yy = y; isSpike(world, x, yy, z, FACING_DOWN); yy--) parts.push([x, yy, z, world.getMeta(x, yy, z)]);
  for (const [px, py, pz] of parts) world.setBlock(px, py, pz, B.AIR, 0, false);
  if (world.onNeighborChanged) { world.onNeighborChanged(x, y + 1, z); world.onNeighborChanged(x, y - parts.length, z); }
  if (world.onStalactiteFall) world.onStalactiteFall(parts);
}

/**
 * Random tick of a hanging spike (reference growth, simplified): 1.1 % of the
 * time, when its root is a Seepstone block with water above, the tip grows one
 * block (up to 7); a spike that cannot grow drips a new upward spike onto the
 * floor up to 10 blocks below (or makes the one there taller).
 */
export function tickSpike(world, x, y, z, rng = Math.random) {
  if ((world.getMeta(x, y, z) & 7) !== FACING_DOWN || rng() >= SPIKE_GROW_CHANCE) return false;
  let top = y;
  while (isSpike(world, x, top + 1, z, FACING_DOWN)) top++;
  if (world.getBlock(x, top + 1, z) !== B.SEEPSTONE || world.getBlock(x, top + 2, z) !== B.WATER) return false;
  let tip = y;
  while (isSpike(world, x, tip - 1, z, FACING_DOWN)) tip--;
  if (top - tip + 1 < SPIKE_MAX_GROWTH && world.getBlock(x, tip - 1, z) === B.AIR && world.getBlock(x, tip - 2, z) === B.AIR) {
    world.setBlock(x, tip - 1, z, B.SEEPSTONE_SPIKE, spikeMeta(FACING_DOWN, SPIKE_TIP));
    return true;
  }
  for (let yy = tip - 1; yy >= tip - 10; yy--) {
    const b = world.getBlock(x, yy, z);
    if (b === B.AIR) continue;
    if (isSpike(world, x, yy, z, FACING_UP)) {
      let up = yy;
      while (isSpike(world, x, up - 1, z, FACING_UP)) up--;
      if (yy - up + 1 < SPIKE_MAX_GROWTH && world.getBlock(x, yy + 1, z) === B.AIR && yy + 1 < tip - 1) { world.setBlock(x, yy + 1, z, B.SEEPSTONE_SPIKE, spikeMeta(FACING_UP, SPIKE_TIP)); return true; }
    } else if (SOLID[b] && OPAQUE[b] && yy + 1 < tip - 1) {
      world.setBlock(x, yy + 1, z, B.SEEPSTONE_SPIKE, spikeMeta(FACING_UP, SPIKE_TIP));
      return true;
    }
    return false;
  }
  return false;
}

/** Meta for a crystal block / Storm Rod placed against `face` (the clicked face normal); -1 if it cannot go there. */
export function cavePlaceMeta(world, x, y, z, id, face) {
  if (id === B.STORM_ROD) return face[1] === -1 ? 1 : 0;
  const facing = facingOf(face[0], face[1], face[2]);
  if (id === B.SEEPSTONE_SPIKE) {
    if (facing !== FACING_UP && facing !== FACING_DOWN) return -1;
    if (!spikeSupported(world, x, y, z, facing)) return -1;
    return spikeMeta(facing, spikeThicknessAt(world, x, y, z, facing));
  }
  return facing;
}

/** Random ticks handled here. */
export function caveRandomTick(world, x, y, z, id, rng = Math.random) {
  if (id === B.BUDDING_VIOLITE) tickBudding(world, x, y, z, rng);
  else if (id === B.SEEPSTONE_SPIKE) tickSpike(world, x, y, z, rng);
  else tickCopper(world, x, y, z, id, rng);
}
export const CAVE_TICKING = [B.COPPER_BLOCK, B.DULLED_COPPER, B.TARNISHED_COPPER, B.BUDDING_VIOLITE, B.SEEPSTONE_SPIKE];
