// Random block ticks: every tick, three random blocks in each non-empty
// section near the player get a chance to change, as in the reference game
// (randomTickSpeed = 3). Handles grass spreading, farmland moisture and crop
// growth.
import { B, OPAQUE, SOLID, CROPS } from './blocks.js';
import { BIOMES } from './biomes.js';
import { MIN_Y, SECTION_COUNT, cidx } from './constants.js';
import { lavaIgnite, FIRE_DELAY } from './fire.js';
import { LEAVES, SAPLING_TREE, growTree, leavesConnected } from './trees.js';

export const RANDOM_TICK_SPEED = 3;

function rawLight(world, x, y, z) {
  const l = world.getLight(x, y, z);
  return Math.max(l >> 4, l & 15);
}

/** Is there water within 4 blocks horizontally, on the farmland's level or one above? */
export function farmlandHydrated(world, x, y, z) {
  for (let dy = 0; dy <= 1; dy++) for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
    if (world.getBlock(x + dx, y + dy, z + dz) === B.WATER) return true;
  }
  return false;
}

/**
 * Growth "points" of a crop (reference getGrowthSpeed): farmland under the
 * crop counts 1 (3 if moist), each of the 8 farmland blocks around it a
 * quarter of that; halved when the same crop grows diagonally or in rows on
 * both axes.
 */
export function growthSpeed(world, x, y, z, crop = B.WHEAT) {
  let f = 1;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    let g = 0;
    if (world.getBlock(x + dx, y - 1, z + dz) === B.FARMLAND) g = world.getMeta(x + dx, y - 1, z + dz) > 0 ? 3 : 1;
    if (dx || dz) g /= 4;
    f += g;
  }
  const is = (dx, dz) => world.getBlock(x + dx, y, z + dz) === crop;
  const rowX = is(-1, 0) || is(1, 0), rowZ = is(0, -1) || is(0, 1);
  const diag = is(-1, -1) || is(1, -1) || is(1, 1) || is(-1, 1);
  if (diag || (rowX && rowZ)) f /= 2;
  return f;
}

/** Chance per random tick that a crop with growth speed f advances a stage. */
export function cropGrowthChance(f) { return 1 / (Math.floor(25 / f) + 1); }

export function randomTickBlock(world, x, y, z, id, rng = Math.random) {
  if (id === B.GRASS) {
    // covered grass dies (also handled on neighbour change); bright grass spreads to dirt
    if (OPAQUE[world.getBlock(x, y + 1, z)]) { world.setBlock(x, y, z, B.DIRT); return; }
    if (rawLight(world, x, y + 1, z) < 9) return;
    for (let k = 0; k < 4; k++) {
      const tx = x + Math.floor(rng() * 3) - 1, ty = y + Math.floor(rng() * 5) - 3, tz = z + Math.floor(rng() * 3) - 1;
      if (world.getBlock(tx, ty, tz) !== B.DIRT) continue;
      const above = world.getBlock(tx, ty + 1, tz);
      if (!OPAQUE[above] && above !== B.WATER && rawLight(world, tx, ty + 1, tz) >= 4) world.setBlock(tx, ty, tz, B.GRASS);
    }
  } else if (id === B.FARMLAND) {
    const m = world.getMeta(x, y, z);
    if (farmlandHydrated(world, x, y, z)) { if (m !== 7) world.setBlock(x, y, z, B.FARMLAND, 7); }
    else if (m > 0) world.setBlock(x, y, z, B.FARMLAND, m - 1);
    else if (!CROPS.has(world.getBlock(x, y + 1, z))) world.setBlock(x, y, z, B.DIRT);
  } else if (id === B.SUGAR_CANE) {
    // the top of a stack under 3 blocks grows a new block every 16 random ticks
    if (world.getBlock(x, y + 1, z)) return;
    let h = 1;
    while (world.getBlock(x, y - h, z) === B.SUGAR_CANE) h++;
    if (h >= 3) return;
    const age = world.getMeta(x, y, z);
    if (age >= 15) { world.setBlock(x, y + 1, z, B.SUGAR_CANE, 0); world.setBlock(x, y, z, B.SUGAR_CANE, 0); }
    else world.setBlock(x, y, z, B.SUGAR_CANE, age + 1);
  } else if (SAPLING_TREE[id]) {
    // reference: light >= 9 and a 1-in-7 chance per random tick; stage 0 -> 1, then the tree
    if (rawLight(world, x, y + 1, z) < 9 || rng() >= 1 / 7) return;
    if (world.getMeta(x, y, z) === 0) world.setBlock(x, y, z, id, 1);
    else growTree(world, x, y, z, SAPLING_TREE[id], rng);
  } else if (LEAVES.has(id)) {
    if (world.getMeta(x, y, z) === 0 && !leavesConnected(world, x, y, z)) world.breakBlock(x, y, z, true);
  } else if (id === B.SNOW_LAYER || id === B.ICE) {
    // torches and other lights melt snow and ice
    if (rawBlockLight(world, x, y + (id === B.ICE ? 1 : 0), z) > 11) world.setBlock(x, y, z, id === B.ICE ? B.WATER : B.AIR);
  } else if (id === B.LAVA) {
    lavaIgnite(world, x, y, z, rng);
  } else if (id === B.FIRE) {
    world.scheduleTick(x, y, z, FIRE_DELAY); // keeps fires burning after a reload
  } else if (id === B.CINDERROOT) {
    // grows on Mournsand in any light: 10 % per random tick, four stages
    const stage = world.getMeta(x, y, z);
    if (stage < 3 && rng() < 0.1) world.setBlock(x, y, z, id, stage + 1);
  } else if (CROPS.has(id)) {
    const stage = world.getMeta(x, y, z);
    if (stage >= 7 || rawLight(world, x, y + 1, z) < 9) return;
    if (rng() < cropGrowthChance(growthSpeed(world, x, y, z, id))) world.setBlock(x, y, z, id, stage + 1);
  }
}

/**
 * While it snows: a few random columns near the player each tick get a layer
 * of snow (one layer at most, like the reference game) or freeze over if they
 * are still water. Roughly the reference rate of 1 in 16 columns per chunk.
 */
export function snowfall(world, px, pz, rng = Math.random, tries = 4) {
  for (let k = 0; k < tries; k++) {
    const x = Math.floor(px + (rng() - 0.5) * 96), z = Math.floor(pz + (rng() - 0.5) * 96);
    if (!world.isLoaded(x, z)) continue;
    const bd = BIOMES[world.biomeAt(x, z)];
    if (!bd || bd.temp >= 0.15) continue;
    const y = world.heightAt(x, z), top = world.getBlock(x, y, z);
    if (rawBlockLight(world, x, y + 1, z) > 11) continue;
    if (top === B.WATER && world.getMeta(x, y, z) === 0) { world.setBlock(x, y, z, B.ICE); continue; }
    if (top === B.SNOW_LAYER || world.getBlock(x, y + 1, z)) continue;
    if ((SOLID[top] && OPAQUE[top]) || LEAVES.has(top)) world.setBlock(x, y + 1, z, B.SNOW_LAYER, 0);
  }
}

function rawBlockLight(world, x, y, z) { return world.getLight(x, y, z) & 15; }

/** Ids that react to random ticks (fast pre-filter). */
export const RANDOM_TICKS = new Uint8Array(256);
for (const id of [B.CINDERROOT, B.GRASS, B.FARMLAND, B.SUGAR_CANE, B.LAVA, B.FIRE, B.SNOW_LAYER, B.ICE, ...CROPS, ...LEAVES, ...Object.keys(SAPLING_TREE).map(Number)]) RANDOM_TICKS[id] = 1;

/** Run one tick's worth of random ticks in all chunks within `radius` chunks of (cx, cz). */
export function runRandomTicks(world, cx, cz, radius, rng = Math.random) {
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
    const c = world.getChunk(cx + dx, cz + dz);
    if (!c) continue;
    const bx = (cx + dx) * 16, bz = (cz + dz) * 16;
    for (let s = 0; s < SECTION_COUNT; s++) {
      if (!c.sectionNonAir[s]) continue;
      for (let k = 0; k < RANDOM_TICK_SPEED; k++) {
        const r = (rng() * 4096) | 0;
        const lx = r & 15, lz = (r >> 4) & 15, y = MIN_Y + s * 16 + (r >> 8);
        const id = c.blocks[cidx(lx, y, lz)];
        if (RANDOM_TICKS[id]) randomTickBlock(world, bx + lx, y, bz + lz, id, rng);
      }
    }
  }
}

