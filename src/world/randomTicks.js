// Random block ticks: every tick, three random blocks in each non-empty
// section near the player get a chance to change, as in the reference game
// (randomTickSpeed = 3). Handles grass spreading, farmland moisture and crop
// growth.
import { B, OPAQUE, SOLID, CROPS, STEM_FRUIT, BLOCK_LIMIT, isPropagule, PROPAGULE_HANGING } from './blocks.js';
import { BIOMES } from './biomes.js';
import { MIN_Y, SECTION_COUNT, cidx } from './constants.js';
import { lavaIgnite, FIRE_DELAY } from './fire.js';
import { LEAVES, SAPLING_TREE, growTree, leavesConnected } from './trees.js';
import { CIRCUIT_SETTLE } from './circuits.js';
import { tickHushFlower } from './dimensions/hushvine.js';
import { caveRandomTick, CAVE_TICKING } from './caves.js';

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
  } else if (id === B.CAVE_VINES || id === B.CAVE_VINES_LIT) {
    // cave vines grow down a little and grow glow berries
    if (id === B.CAVE_VINES && rng() < 0.1) world.setBlock(x, y, z, B.CAVE_VINES_LIT);
    else if (rng() < 0.05 && !world.getBlock(x, y - 1, z) && !world.getBlock(x, y - 2, z)) world.setBlock(x, y - 1, z, B.CAVE_VINES);
  } else if (id === B.KELP) {
    // kelp grows a section up into the water above, 14 % of random ticks, up to 16 tall
    if (world.getBlock(x, y + 1, z) !== B.WATER || world.getBlock(x, y + 2, z) !== B.WATER || rng() > 0.14) return;
    let h = 1;
    while (world.getBlock(x, y - h, z) === B.KELP) h++;
    if (h < 16) world.setBlock(x, y + 1, z, B.KELP, 0);
  } else if (id === B.BAMBOO) {
    // bamboo shoots up fast: a new section every 4 random ticks, up to 12 tall in the light
    if (world.getBlock(x, y + 1, z) || rawLight(world, x, y + 1, z) < 9) return;
    let h = 1;
    while (world.getBlock(x, y - h, z) === B.BAMBOO) h++;
    if (h >= 12) return;
    const age = world.getMeta(x, y, z);
    if (age >= 3) { world.setBlock(x, y + 1, z, B.BAMBOO, 0); world.setBlock(x, y, z, B.BAMBOO, 0); }
    else world.setBlock(x, y, z, B.BAMBOO, age + 1);
  } else if (id === B.HUSHVINE_FLOWER) {
    // Hushvine flowers grow up, branch and wither (dimensions/hushvine.js); reference: 1 in ~1 tick odds are slow anyway
    if (rng() < 0.25) tickHushFlower(world, x, y, z, rng);
  } else if (isPropagule(id) && (world.getMeta(x, y, z) & PROPAGULE_HANGING)) {
    // a hanging propagule ripens (age 0-3) and then lets go: it drops as an item to be planted
    const m = world.getMeta(x, y, z), age = m & 3;
    if (rng() >= 0.1) return;
    if (age < 3) world.setBlock(x, y, z, id, m + 1);
    else world.breakBlock(x, y, z, true);
  } else if (SAPLING_TREE[id]) {
    // reference: light >= 9 and a 1-in-7 chance per random tick; stage 0 -> 1, then the tree
    if (rawLight(world, x, y + 1, z) < 9 || rng() >= 1 / 7) return;
    if (world.getMeta(x, y, z) === 0) world.setBlock(x, y, z, id, 1);
    else growTree(world, x, y, z, SAPLING_TREE[id], rng);
  } else if (LEAVES.has(id)) {
    if (world.getMeta(x, y, z) === 0 && !leavesConnected(world, x, y, z)) world.breakBlock(x, y, z, true);
  } else if (id === B.TURTLE_EGG) {
    if (world.onEggTick) world.onEggTick(x, y, z); // cracking and hatching need the sky (game.js)
  } else if (id === B.SWEET_BERRY_BUSH) {
    // berries ripen in the light: 1 in 5 per random tick, ages 0-3
    const age = world.getMeta(x, y, z) & 3;
    if (age < 3 && rng() < 0.2 && rawLight(world, x, y + 1, z) >= 9) world.setBlock(x, y, z, id, age + 1);
  } else if (id === B.COCOA) {
    const m = world.getMeta(x, y, z);
    if (((m >> 2) & 3) < 2 && rng() < 0.2) world.setBlock(x, y, z, B.COCOA, m + 4);
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
  } else if (CAVE_TICK[id]) {
    caveRandomTick(world, x, y, z, id, rng); // copper weathering, budding Violite, Seepstone spikes
  } else if (CIRCUIT_SETTLE[id]) {
    if (world.circuits) world.circuits.enqueue(x, y, z); // circuits settle again after a reload
  } else if (CROPS.has(id)) {
    const stage = world.getMeta(x, y, z);
    if (rawLight(world, x, y + 1, z) < 9) return;
    if (stage >= 7 && STEM_FRUIT[id]) {
      // a ripe stem sets a melon / pumpkin on a free neighbouring spot of soil
      if (rng() >= cropGrowthChance(growthSpeed(world, x, y, z, id))) return;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => world.getBlock(x + dx, y, z + dz) === STEM_FRUIT[id])) return;
      const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rng() * 4)];
      const below = world.getBlock(x + dx, y - 1, z + dz);
      if (!world.getBlock(x + dx, y, z + dz) && (below === B.DIRT || below === B.GRASS || below === B.FARMLAND)) world.setBlock(x + dx, y, z + dz, STEM_FRUIT[id], Math.floor(rng() * 4));
      return;
    }
    if (stage >= 7) return;
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
export const RANDOM_TICKS = new Uint8Array(BLOCK_LIMIT);
for (const id of [B.HUSHVINE_FLOWER, B.CINDERROOT, B.GRASS, B.FARMLAND, B.SUGAR_CANE, B.BAMBOO, B.KELP, B.CAVE_VINES, B.CAVE_VINES_LIT, B.LAVA, B.FIRE, B.SNOW_LAYER, B.ICE, B.COCOA, B.SWEET_BERRY_BUSH, B.TURTLE_EGG, ...CROPS, ...LEAVES, ...Object.keys(SAPLING_TREE).map(Number)]) RANDOM_TICKS[id] = 1;
for (let id = 0; id < BLOCK_LIMIT; id++) if (CIRCUIT_SETTLE[id]) RANDOM_TICKS[id] = 1;
const CAVE_TICK = new Uint8Array(BLOCK_LIMIT);
for (const id of CAVE_TICKING) { CAVE_TICK[id] = 1; RANDOM_TICKS[id] = 1; }

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

