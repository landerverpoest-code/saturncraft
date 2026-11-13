// Content pack 7, "cold and currents": Driftsnow, Scaldrock and the water columns over hot and restless sea floors.
//  * Driftsnow is loose, deep snow: it looks like a snow field but does not hold you. Whoever steps in sinks slowly, is slowed,
//    and starts to freeze (player/player.js: the frost builds over seven seconds, then bites once every two). Leather Boots
//    carry you over it (physics/body.js), any piece of leather armour keeps the frost off, and a fall into it does not hurt.
//  * Scaldrock is a hot stone: it glows faintly, burns bare feet (not while sneaking) and, under still water, drags that water
//    down in a column of bubbles. Mournsand under still water does the opposite: its column lifts whatever is in it.
//    Both columns give a diver air. `columnAt` is the whole rule: no extra blocks are stored, so pistons, buckets and
//    explosions change a column the moment the blocks change.
//  * The generator pass (coldCurrents) hides Driftsnow hollows under snowy ground and puts Scald Vents and Upwells on ocean floors.
// Everything is a closed-form function of the seed and the coordinates.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL, MIN_Y, WORLD_HEIGHT, cidx } from './constants.js';
import { Simplex, hash4, hashf } from './noise.js';

/** How far down a column looks for its floor. */
export const COLUMN_REACH = 64;
/** Speeds (blocks per tick): what a column adds each tick and where it stops. */
export const COLUMN = { upPush: 0.06, upMax: 0.7, downPull: 0.03, downMax: -0.3 };

/**
 * The column a water cell stands in: 1 lifts (Mournsand below), -1 drags down (Scaldrock below), 0 none. Only still source
 * water carries a column; anything else between the cell and the floor breaks it.
 */
export function columnAt(world, x, y, z) {
  for (let i = 0; i < COLUMN_REACH; i++, y--) {
    const id = world.getBlock(x, y, z);
    if (id === B.WATER) { if (world.getMeta(x, y, z) !== 0) return 0; continue; }
    return id === B.MOURNSAND ? 1 : id === B.SCALDROCK ? -1 : 0;
  }
  return 0;
}

/** The new vertical speed of something in a column. */
export function columnSpeed(vy, dir) {
  if (dir > 0) return Math.min(COLUMN.upMax, vy + COLUMN.upPush);
  if (dir < 0) return Math.max(COLUMN.downMax, vy - COLUMN.downPull);
  return vy;
}

// ---- freezing ---------------------------------------------------------------------------------
/** Ticks in Driftsnow until the frost bites, ticks between bites, and how fast it thaws outside. */
export const FROST = { full: 140, every: 40, thaw: 2, damage: 1 };

/** One tick of the frost counter: rising inside Driftsnow (unless something warm is worn), thawing twice as fast outside. */
export function frostStep(frost, inDrift, warm) {
  if (inDrift && !warm) return Math.min(FROST.full, frost + 1);
  return Math.max(0, frost - FROST.thaw);
}

// ---- generation -------------------------------------------------------------------------------
const SNOWY = new Set([BIOME.SNOWY_PLAINS, BIOME.SNOWY_PEAKS, BIOME.SNOWY_TAIGA]);
const SEAS = new Set([BIOME.OCEAN, BIOME.DEEP_OCEAN]);
const SEABED = new Set([B.SAND, B.GRAVEL, B.DIRT, B.CLAY, B.STONE]);
export const DRIFT_MIN = 0.6;         // the hollow noise above which the ground is Driftsnow
export const VENT_REGION = 64;        // one vent or upwell may stand in each region of this many blocks
export const VENT_CHANCE = 0.55;
export const VENT_MIN_DEPTH = 8;      // still water over the floor

const noiseCache = new WeakMap();
function driftNoise(gen) {
  let n = noiseCache.get(gen);
  if (!n) { n = new Simplex(hash4(gen.seed, 71, 907, 5)); noiseCache.set(gen, n); }
  return n;
}
/** The hollow field at world (x, z); above DRIFT_MIN snowy ground is Driftsnow. */
export const driftValue = (gen, x, z) => driftNoise(gen).noise2(x / 11, z / 11);

/** The vent of the region around world (x, z), or null: { x, z, r, kind: 'vent' | 'upwell' } (whether the sea is deep enough there is decided when it is stamped). */
export function ventInRegion(seed, rx, rz) {
  if (hashf(seed, rx, rz, 7101) >= VENT_CHANCE) return null;
  const x = rx * VENT_REGION + 8 + Math.floor(hashf(seed, rx, rz, 7102) * (VENT_REGION - 16));
  const z = rz * VENT_REGION + 8 + Math.floor(hashf(seed, rx, rz, 7103) * (VENT_REGION - 16));
  return { x, z, r: 1 + Math.floor(hashf(seed, rx, rz, 7104) * 2), kind: hashf(seed, rx, rz, 7105) < 0.5 ? 'vent' : 'upwell' };
}

/** The pass over chunk (cx, cz): Driftsnow hollows in snowy ground, Scald Vents and Upwells on ocean floors. */
export function stampColdCurrents(gen, blocks, meta, cx, cz, biomes) {
  const X0 = cx * 16, Z0 = cz * 16;
  const topY = MIN_Y + WORLD_HEIGHT - 2;
  let snowy = false, sea = false;
  for (let i = 0; i < 256; i++) { if (SNOWY.has(biomes[i])) snowy = true; else if (SEAS.has(biomes[i])) sea = true; }
  if (snowy) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const bio = biomes[x + z * 16];
    if (!SNOWY.has(bio) || driftValue(gen, X0 + x, Z0 + z) <= DRIFT_MIN) continue;
    let y = topY;
    while (y > SEA_LEVEL && (blocks[cidx(x, y, z)] === B.AIR || blocks[cidx(x, y, z)] === B.SNOW_LAYER)) y--;
    if (y <= SEA_LEVEL + 1) continue;
    const top = blocks[cidx(x, y, z)], under = blocks[cidx(x, y - 1, z)];
    // natural snowy ground only: grass under snow, or the bare rock and snow caps of the peaks (never a roof, a path or a floor)
    const peak = bio === BIOME.SNOWY_PEAKS && (top === B.STONE || top === B.SNOW_BLOCK) && (under === B.STONE || under === B.SNOW_BLOCK);
    if (top !== B.SNOWY_GRASS && !peak) continue;
    if (blocks[cidx(x, y - 2, z)] === B.AIR || blocks[cidx(x, y - 2, z)] === B.WATER) continue; // a floor must remain under the hollow
    const over = cidx(x, y + 1, z);
    if (blocks[over] === B.SNOW_LAYER) { blocks[over] = B.AIR; meta[over] = 0; }
    blocks[cidx(x, y, z)] = B.DRIFTSNOW; meta[cidx(x, y, z)] = 0;
    if (under === B.DIRT || under === B.STONE || under === B.SNOW_BLOCK) { blocks[cidx(x, y - 1, z)] = B.DRIFTSNOW; meta[cidx(x, y - 1, z)] = 0; }
  }
  if (!sea) return;
  const rx0 = Math.floor((X0 - 3) / VENT_REGION), rx1 = Math.floor((X0 + 18) / VENT_REGION);
  const rz0 = Math.floor((Z0 - 3) / VENT_REGION), rz1 = Math.floor((Z0 + 18) / VENT_REGION);
  for (let rx = rx0; rx <= rx1; rx++) for (let rz = rz0; rz <= rz1; rz++) {
    const v = ventInRegion(gen.seed, rx, rz);
    if (!v) continue;
    for (let dz = -v.r; dz <= v.r; dz++) for (let dx = -v.r; dx <= v.r; dx++) {
      if (dx * dx + dz * dz > v.r * v.r + 1) continue;
      const x = v.x + dx - X0, z = v.z + dz - Z0;
      if (x < 0 || x > 15 || z < 0 || z > 15 || !SEAS.has(biomes[x + z * 16])) continue;
      if (hashf(gen.seed, v.x + dx, v.z + dz, 7106) < 0.25) continue; // a ragged patch
      let y = SEA_LEVEL, clear = true;
      for (; y > MIN_Y + 4; y--) { const i = cidx(x, y, z); if (blocks[i] !== B.WATER) break; if (meta[i] !== 0) clear = false; }
      if (!clear || SEA_LEVEL - y < VENT_MIN_DEPTH || !SEABED.has(blocks[cidx(x, y, z)])) continue;
      blocks[cidx(x, y, z)] = v.kind === 'vent' ? B.SCALDROCK : B.MOURNSAND; meta[cidx(x, y, z)] = 0;
    }
  }
}
