// World generation of the caves content, called once per chunk from
// TerrainGenerator.generate (after ores and caves, before water): Violite
// geodes and Seepstone caves (spikes on ceilings and floors, extra copper).
// Everything is decided from the seed and world coordinates, never from the
// chunk's shared random stream, so the rest of the terrain stays the same.
import { B, BLOCK_LIMIT } from './blocks.js';
import { Simplex, hash4, hashf, mulberry32 } from './noise.js';
import { MIN_Y, WORLD_HEIGHT, cidx } from './constants.js';
import { geodeIn, geodeLayer, GEODE_RADII, BUDDING_CHANCE, BUD_PLACE_CHANCE, BUD_STAGES, DIRS6, FACING_UP, FACING_DOWN, spikeMeta, spikeThickness } from './caves.js';

const noises = new Map();
function noisesFor(seed) {
  let n = noises.get(seed);
  if (!n) { n = { geode: new Simplex(hash4(seed, 31, 911, 3)), seep: new Simplex(hash4(seed, 32, 911, 3)), lush: new Simplex(hash4(seed, 33, 911, 3)) }; noises.set(seed, n); }
  return n;
}
const cellHash = (seed, key, x, y, z) => hashf(seed ^ Math.imul(key, 0x2c1b3c6d), x, y, z);

const ROCK = new Uint8Array(BLOCK_LIMIT);
for (const id of [B.STONE, B.DEEPSTONE, B.GRANITE, B.DIORITE, B.ANDESITE, B.TUFF, B.SEEPSTONE]) ROCK[id] = 1;

/** Lush caves: a region of the underground (about a tenth) where cave floors grow moss and azaleas. */
export function lushRegion(seed, x, z) { return noisesFor(seed).lush.fbm2(x / 340, z / 340, 2); }
export const LUSH_THRESHOLD = 0.3;

function stampLush(gen, blocks, meta, cx, cz, heightmap) {
  const seed = gen.seed, x0 = cx * 16, z0 = cz * 16;
  if (lushRegion(seed, x0 + 8, z0 + 8) < LUSH_THRESHOLD - 0.1) return;
  const vines = [];
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const wx = x0 + x, wz = z0 + z;
    if (lushRegion(seed, wx, wz) < LUSH_THRESHOLD) continue;
    const top = heightmap[x + z * 16] - 12;
    for (let y = Math.max(MIN_Y + 6, 0); y < top; y++) {
      const i = cidx(x, y, z);
      if (!ROCK[blocks[i]]) continue;
      const above = cidx(x, y + 1, z), below = cidx(x, y - 1, z);
      if (blocks[above] === B.AIR) {
        // a mossy floor with carpets, azaleas and the odd tuft of grass
        if (cellHash(seed, 20, wx, y, wz) < 0.85) blocks[i] = B.MOSS_BLOCK;
        const r = cellHash(seed, 21, wx, y, wz);
        if (blocks[i] === B.MOSS_BLOCK) {
          if (r < 0.25) blocks[above] = B.MOSS_CARPET;
          else if (r < 0.29) blocks[above] = cellHash(seed, 22, wx, y, wz) < 0.4 ? B.FLOWERING_AZALEA : B.AZALEA;
          else if (r < 0.4) blocks[above] = B.TALL_GRASS;
        }
      } else if (blocks[below] === B.AIR) {
        // a mossy ceiling with hanging cave vines
        if (cellHash(seed, 23, wx, y, wz) < 0.45) blocks[i] = B.MOSS_BLOCK;
        if (cellHash(seed, 24, wx, y, wz) < 0.12) vines.push([x, y, z, 1 + Math.floor(cellHash(seed, 25, wx, y, wz) * 6), wx, wz]);
      }
    }
  }
  for (const [x, y, z, want, wx, wz] of vines) {
    for (let k = 1; k <= want; k++) {
      const i = cidx(x, y - k, z);
      if (blocks[i] !== B.AIR || blocks[cidx(x, y - k - 1, z)] !== B.AIR) break;
      blocks[i] = cellHash(seed, 26, wx, y - k, wz) < 0.3 ? B.CAVE_VINES_LIT : B.CAVE_VINES;
    }
  }
}

/** Region strength of Seepstone caves at a column (they occupy roughly a tenth of the underground). */
export function seepRegion(seed, x, z) { return noisesFor(seed).seep.fbm2(x / 380, z / 380, 2); }
export const SEEP_THRESHOLD = 0.32;

export function stampCaveFeatures(gen, blocks, meta, cx, cz, heightmap) {
  for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
    const g = geodeIn(gen.seed, cx + ox, cz + oz);
    if (!g) continue;
    const col = gen.column(g.x, g.z);
    if (g.y + 10 > col.height - col.amp - 4) continue; // keep them well underground
    stampGeode(gen.seed, blocks, meta, cx, cz, g);
  }
  stampSeepstone(gen, blocks, meta, cx, cz, heightmap);
  stampLush(gen, blocks, meta, cx, cz, heightmap);
}

/** The part of geode `g` inside chunk (cx, cz). */
export function stampGeode(seed, blocks, meta, cx, cz, g) {
  const n = noisesFor(seed).geode;
  const R = Math.ceil(GEODE_RADII[3] * g.scale + 1);
  const x0 = cx * 16, z0 = cz * 16;
  const layerAt = (wx, wy, wz) => {
    const d = Math.hypot(wx - g.x, wy - g.y, wz - g.z) / g.scale + n.noise3(wx / 3.5, wy / 3.5, wz / 3.5) * 0.45;
    return geodeLayer(d);
  };
  const budding = [];
  for (let x = Math.max(0, g.x - R - x0); x <= Math.min(15, g.x + R - x0); x++)
    for (let z = Math.max(0, g.z - R - z0); z <= Math.min(15, g.z + R - z0); z++)
      for (let y = Math.max(MIN_Y + 1, g.y - R); y <= Math.min(MIN_Y + WORLD_HEIGHT - 2, g.y + R); y++) {
        const wx = x0 + x, wz = z0 + z, layer = layerAt(wx, y, wz);
        if (!layer) continue;
        const i = cidx(x, y, z);
        if (blocks[i] === B.BEDROCK) continue;
        meta[i] = 0;
        if (layer === 4) blocks[i] = B.AIR;
        else if (layer === 3) {
          const bud = cellHash(seed, 1, wx, y, wz) < BUDDING_CHANCE;
          blocks[i] = bud ? B.BUDDING_VIOLITE : B.VIOLITE_BLOCK;
          if (bud) budding.push([x, y, z, wx, wz]);
        } else blocks[i] = layer === 2 ? B.CHALKSTONE : B.SMOOTH_BASALT;
      }
  // buds on budding blocks facing the hollow
  for (const [x, y, z, wx, wz] of budding) {
    if (cellHash(seed, 2, wx, y, wz) >= BUD_PLACE_CHANCE) continue;
    const start = Math.floor(cellHash(seed, 3, wx, y, wz) * 6);
    for (let k = 0; k < 6; k++) {
      const f = (start + k) % 6, [dx, dy, dz] = DIRS6[f];
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || nz < 0 || nx > 15 || nz > 15) continue;
      if (layerAt(wx + dx, ny, wz + dz) !== 4 || blocks[cidx(nx, ny, nz)] !== B.AIR) continue;
      blocks[cidx(nx, ny, nz)] = BUD_STAGES[Math.floor(cellHash(seed, 4, wx, y, wz) * 4)];
      meta[cidx(nx, ny, nz)] = f;
      break;
    }
  }
}

/**
 * Seepstone caves: inside the region, cave walls next to air turn to
 * Seepstone, spikes hang from ceilings and rise from floors, and there is a
 * large extra copper vein feature (reference: 16 tries of size 20). Outside
 * it, a few lone spikes are scattered through the caves.
 */
function stampSeepstone(gen, blocks, meta, cx, cz, heightmap) {
  const seed = gen.seed, x0 = cx * 16, z0 = cz * 16;
  if (seepRegion(seed, x0 + 8, z0 + 8) > SEEP_THRESHOLD) {
    const rng = mulberry32(hash4(seed, cx, cz, 4407));
    const f = { block: B.COPPER_ORE, count: 16, dist: 'triangle', min: -16, max: 112, size: 20 };
    for (let k = 0; k < 16; k++) {
      const oy = f.min + Math.floor(rng() * ((f.max - f.min) / 2 + 1)) + Math.floor(rng() * ((f.max - f.min) / 2 + 1));
      gen.placeVein(blocks, rng, f, Math.floor(rng() * 16), oy, Math.floor(rng() * 16));
    }
  }
  const spikes = [];
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const wx = x0 + x, wz = z0 + z;
    const region = seepRegion(seed, wx, wz) > SEEP_THRESHOLD;
    const top = heightmap[x + z * 16] - 6;
    for (let y = MIN_Y + 6; y < top; y++) {
      const i = cidx(x, y, z);
      if (!ROCK[blocks[i]]) continue;
      const airBelow = blocks[cidx(x, y - 1, z)] === B.AIR, airAbove = blocks[cidx(x, y + 1, z)] === B.AIR;
      if (!airBelow && !airAbove) continue;
      if (region && cellHash(seed, 5, wx, y, wz) < 0.75) blocks[i] = B.SEEPSTONE;
      const p = region ? 0.14 : 0.004, r = cellHash(seed, 6, wx, y, wz);
      if (r >= p) continue;
      const len = 1 + Math.floor(cellHash(seed, 7, wx, y, wz) * (region ? 5 : 3));
      if (airBelow) spikes.push([x, y, z, FACING_DOWN, len]);
      else spikes.push([x, y, z, FACING_UP, len]);
    }
  }
  for (const [x, y, z, facing, want] of spikes) {
    const d = facing === FACING_DOWN ? -1 : 1;
    let len = 0;
    // leave a free block beyond the tip so hanging and standing spikes do not touch
    while (len < want && blocks[cidx(x, y + d * (len + 1), z)] === B.AIR && blocks[cidx(x, y + d * (len + 2), z)] === B.AIR) len++;
    for (let k = 0; k < len; k++) {
      const i = cidx(x, y + d * (k + 1), z);
      blocks[i] = B.SEEPSTONE_SPIKE;
      meta[i] = spikeMeta(facing, spikeThickness(k < len - 1, k < len - 2, k > 0));
    }
  }
}
