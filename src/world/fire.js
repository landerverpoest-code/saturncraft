// Fire (reference BlockFire): a fire block ages 0..15, ticks every 30-39
// ticks, burns up flammable neighbours, spreads to air next to flammable
// blocks up to 4 blocks above, and dies out without fuel or in the rain.
import { B, BLOCKS, OPAQUE, SOLID } from './blocks.js';

// [encouragement (how readily fire spreads next to it), flammability (how fast it burns away)]
export const FIRE_ODDS = new Map();
const odds = (ids, enc, flam) => { for (const id of ids) FIRE_ODDS.set(id, [enc, flam]); };
odds([B.OAK_PLANKS, B.SPRUCE_PLANKS, B.BIRCH_PLANKS, B.JUNGLE_PLANKS, B.ACACIA_PLANKS, B.DARK_OAK_PLANKS, B.OAK_SLAB, B.OAK_STAIRS, B.OAK_FENCE, B.SPRUCE_FENCE, B.BIRCH_FENCE, B.OAK_FENCE_GATE], 5, 20);
odds([B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.JUNGLE_LOG, B.ACACIA_LOG, B.DARK_OAK_LOG, B.COAL_BLOCK], 5, 5);
odds([B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES, B.JUNGLE_LEAVES, B.ACACIA_LEAVES, B.DARK_OAK_LEAVES, B.WOOL], 30, 60);
odds([B.VINES], 15, 100);
odds([B.BOOKSHELF], 30, 20);
odds([B.TALL_GRASS, B.SUNPETAL, B.REDBLOOM, B.SKYBELL, B.ROSETTE, B.DEAD_BUSH], 60, 100);

export const FIRE_DELAY = 30;
const DIFFICULTY = 2; // Normal
const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

const enc = (id) => (FIRE_ODDS.get(id) || [0, 0])[0];
const flam = (id) => (FIRE_ODDS.get(id) || [0, 0])[1];
export const isFlammable = (id) => enc(id) > 0;

function hasFuelAround(world, x, y, z) {
  for (const [dx, dy, dz] of NEIGHBOURS) if (isFlammable(world.getBlock(x + dx, y + dy, z + dz))) return true;
  return false;
}

/** Can fire exist at x,y,z: on a full solid block or next to something flammable. */
export function fireCanStay(world, x, y, z) {
  const below = world.getBlock(x, y - 1, z);
  return !!(SOLID[below] && OPAQUE[below]) || hasFuelAround(world, x, y, z);
}

/** Can a fire be lit here (air or replaceable plant-free spot that can hold fire)? */
export function canLight(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  return (id === B.AIR) && fireCanStay(world, x, y, z);
}

function encouragementAt(world, x, y, z) {
  if (world.getBlock(x, y, z) !== B.AIR) return 0;
  let e = 0;
  for (const [dx, dy, dz] of NEIGHBOURS) e = Math.max(e, enc(world.getBlock(x + dx, y + dy, z + dz)));
  return e;
}

function rainyAround(world, x, y, z) {
  const r = world.rainingAt;
  if (!r) return false;
  return r(x, y, z) || r(x - 1, y, z) || r(x + 1, y, z) || r(x, y, z - 1) || r(x, y, z + 1);
}

function tryBurn(world, x, y, z, chance, age, rng) {
  const id = world.getBlock(x, y, z);
  if (Math.floor(rng() * chance) >= flam(id)) return;
  if (Math.floor(rng() * (age + 10)) < 5 && !(world.rainingAt && world.rainingAt(x, y, z))) {
    world.setBlock(x, y, z, B.FIRE, Math.min(15, age + Math.floor(Math.floor(rng() * 5) / 4)));
    world.scheduleTick(x, y, z, FIRE_DELAY + Math.floor(rng() * 10));
  } else world.setBlock(x, y, z, B.AIR);
}

/** Scheduled fire tick. */
export function tickFire(world, x, y, z, rng = Math.random) {
  if (!fireCanStay(world, x, y, z)) { world.setBlock(x, y, z, B.AIR); return; }
  let age = world.getMeta(x, y, z);
  if (rainyAround(world, x, y, z) && rng() < 0.2 + age * 0.03) { world.setBlock(x, y, z, B.AIR); return; }
  if (age < 15) {
    age = Math.min(15, age + Math.floor(Math.floor(rng() * 3) / 2));
    world.setBlock(x, y, z, B.FIRE, age, false);
  }
  world.scheduleTick(x, y, z, FIRE_DELAY + Math.floor(rng() * 10));
  const below = world.getBlock(x, y - 1, z);
  const eternal = below === B.CINDERSTONE; // Cinderstone burns forever
  if (!hasFuelAround(world, x, y, z)) {
    if (!eternal && (!(SOLID[below] && OPAQUE[below]) || age > 3)) world.setBlock(x, y, z, B.AIR);
    return;
  }
  if (!eternal && !isFlammable(below) && age === 15 && rng() < 0.25) { world.setBlock(x, y, z, B.AIR); return; }
  // burn neighbours
  for (const [dx, dy, dz] of NEIGHBOURS) tryBurn(world, x + dx, y + dy, z + dz, dy ? 250 : 300, age, rng);
  // spread through the air nearby
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 4; dy++) {
    if (!dx && !dy && !dz) continue;
    const k = 100 + (dy > 1 ? (dy - 1) * 100 : 0);
    const e = encouragementAt(world, x + dx, y + dy, z + dz);
    if (e <= 0) continue;
    const l = Math.floor((e + 40 + DIFFICULTY * 7) / (age + 30));
    if (l > 0 && Math.floor(rng() * k) <= l && !(world.rainingAt && world.rainingAt(x + dx, y + dy, z + dz))) {
      world.setBlock(x + dx, y + dy, z + dz, B.FIRE, Math.min(15, age + Math.floor(Math.floor(rng() * 5) / 4)));
      world.scheduleTick(x + dx, y + dy, z + dz, FIRE_DELAY + Math.floor(rng() * 10));
    }
  }
}

/** Lava random tick: sets fire to flammable blocks near and above it. */
export function lavaIgnite(world, x, y, z, rng = Math.random) {
  const n = Math.floor(rng() * 3);
  if (n > 0) {
    let px = x, py = y, pz = z;
    for (let k = 0; k < n; k++) {
      px += Math.floor(rng() * 3) - 1; py += 1; pz += Math.floor(rng() * 3) - 1;
      const id = world.getBlock(px, py, pz);
      if (id === B.AIR) {
        if (hasFuelAround(world, px, py, pz)) { world.setBlock(px, py, pz, B.FIRE); world.scheduleTick(px, py, pz, FIRE_DELAY); return; }
      } else if (BLOCKS[id].solid) return;
    }
  } else {
    for (let k = 0; k < 3; k++) {
      const px = x + Math.floor(rng() * 3) - 1, pz = z + Math.floor(rng() * 3) - 1;
      if (world.getBlock(px, y + 1, pz) === B.AIR && isFlammable(world.getBlock(px, y, pz))) {
        world.setBlock(px, y + 1, pz, B.FIRE); world.scheduleTick(px, y + 1, pz, FIRE_DELAY);
      }
    }
  }
}
