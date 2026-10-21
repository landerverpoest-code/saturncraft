// Maps: a filled map shows a 128 x 128-block square of the world from above
// (one pixel per block), aligned to the reference grid (squares start at
// -64 + 128k). The picture fills in while its holder walks around inside it:
// each pixel takes the colour of the top block, shaded brighter or darker
// where the ground rises or falls towards the north, and water darker the
// deeper it is.
import { B, BLOCKS } from './blocks.js';
import { BIOMES } from './biomes.js';
import { FACE_TILE, TEX_NAMES, texturePixels, grassColor, foliageColor } from './textures.js';

export const MAP_SIZE = 128;
export const MAP_VIEW = 64; // how far from the holder the map draws

/** Corner of the map square containing world column x (or z). */
export const mapOrigin = (v) => Math.floor((v + 64) / MAP_SIZE) * MAP_SIZE - 64;

export function newMap(id, x, z, dimension = 'overworld') {
  return { id, x0: mapOrigin(Math.floor(x)), z0: mapOrigin(Math.floor(z)), dimension, px: new Uint8Array(MAP_SIZE * MAP_SIZE * 3), filled: 0 };
}

// average colour of each block's top texture (computed once per block)
const avg = new Map();
function topColor(id) {
  if (avg.has(id)) return avg.get(id);
  let c = [128, 128, 128];
  try {
    const d = texturePixels(TEX_NAMES[FACE_TILE[id * 6 + 2]]);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (n) c = [r / n, g / n, b / n];
  } catch { /* no texture: grey */ }
  avg.set(id, c);
  return c;
}

const FIXED = { [B.WATER]: [52, 84, 200], [B.LAVA]: [230, 90, 20], [B.BIRCH_LEAVES]: [128, 167, 85], [B.SPRUCE_LEAVES]: [97, 153, 97] };

/** Base map colour of a block in a biome. */
export function blockMapColor(id, biomeId) {
  if (FIXED[id]) return FIXED[id];
  const base = topColor(id), bi = BIOMES[biomeId] || BIOMES[1];
  const tint = BLOCKS[id] && BLOCKS[id].tint;
  if (tint === 'grass' || tint === 'foliage') {
    const t = tint === 'grass' ? (bi.grass || grassColor(bi.temp, bi.humid)) : (bi.foliage || foliageColor(bi.temp, bi.humid));
    return base.map((v, k) => (v * t[k]) / 255);
  }
  return base;
}

/**
 * Draw the columns of `map` within MAP_VIEW of (px, pz). `world` needs
 * heightAt, getBlock and biomeAt. Draws at most `budget` columns, starting
 * at the map's own sweep cursor, so a held map fills in over a few seconds.
 */
export function updateMap(map, world, px, pz, budget = 1024) {
  const cx = Math.floor(px) - map.x0, cz = Math.floor(pz) - map.z0;
  if (cx < -MAP_VIEW || cz < -MAP_VIEW || cx >= MAP_SIZE + MAP_VIEW || cz >= MAP_SIZE + MAP_VIEW) return 0;
  const xa = Math.max(0, cx - MAP_VIEW), xb = Math.min(MAP_SIZE - 1, cx + MAP_VIEW);
  const za = Math.max(0, cz - MAP_VIEW), zb = Math.min(MAP_SIZE - 1, cz + MAP_VIEW);
  let drawn = 0;
  map.cursor = map.cursor || 0;
  const w = xb - xa + 1, total = w * (zb - za + 1);
  for (let k = 0; k < Math.min(budget, total); k++) {
    const i = (map.cursor + k) % total, mx = xa + (i % w), mz = za + Math.floor(i / w);
    if ((mx - cx) ** 2 + (mz - cz) ** 2 > MAP_VIEW * MAP_VIEW) continue;
    drawColumn(map, world, mx, mz);
    drawn++;
  }
  map.cursor = (map.cursor + Math.min(budget, total)) % Math.max(1, total);
  return drawn;
}

export function drawColumn(map, world, mx, mz) {
  const x = map.x0 + mx, z = map.z0 + mz;
  if (world.getChunk && !world.getChunk(x >> 4, z >> 4)) return; // not loaded yet
  let y = world.heightAt(x, z), id = world.getBlock(x, y, z);
  // skip see-through bits (grass tufts, flowers, snow layers keep their colour)
  for (let n = 0; n < 4 && id !== B.WATER && id !== B.SNOW_LAYER && BLOCKS[id] && !BLOCKS[id].solid && y > 0; n++) id = world.getBlock(x, --y, z);
  let c = blockMapColor(id, world.biomeAt(x, z));
  let f;
  if (id === B.WATER) {
    let depth = 0;
    while (depth < 12 && world.getBlock(x, y - depth - 1, z) === B.WATER) depth++;
    f = depth < 2 ? 1.08 : depth < 5 ? 0.94 : depth < 9 ? 0.82 : 0.7;
  } else {
    const yn = world.heightAt(x, z - 1);
    f = y > yn ? 1.1 : y < yn ? 0.8 : 0.94;
  }
  const o = (mz * MAP_SIZE + mx) * 3;
  if (!map.px[o] && !map.px[o + 1] && !map.px[o + 2]) map.filled++;
  for (let k = 0; k < 3; k++) map.px[o + k] = Math.max(1, Math.min(255, Math.round(c[k] * f)));
}

/** Map pixel position of a world point (may lie outside 0..127). */
export const mapPos = (map, x, z) => [x - map.x0, z - map.z0];

// ---- saving -------------------------------------------------------------------------
export function encodeMap(m) {
  let s = '';
  for (let i = 0; i < m.px.length; i += 8192) s += String.fromCharCode(...m.px.subarray(i, i + 8192));
  return { id: m.id, x0: m.x0, z0: m.z0, dimension: m.dimension, filled: m.filled, px: btoa(s) };
}
export function decodeMap(d) {
  if (!d || !Number.isInteger(d.id) || typeof d.px !== 'string') return null;
  const m = { id: d.id, x0: d.x0 | 0, z0: d.z0 | 0, dimension: d.dimension || 'overworld', filled: d.filled | 0, px: new Uint8Array(MAP_SIZE * MAP_SIZE * 3) };
  try { const s = atob(d.px); for (let i = 0; i < Math.min(s.length, m.px.length); i++) m.px[i] = s.charCodeAt(i); } catch { /* keep blank */ }
  return m;
}
