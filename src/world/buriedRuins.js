// Buried Ruins: the stumps of an old clay-and-terracotta house, half sunk into the plains or
// the taiga, in one 224 x 224-block region in three. Broken walls of terracotta, mud bricks
// and packed mud poke a block or two out of the grass; inside, under a little earth, lies a
// floor of gravel with Suspicious Gravel in it (and a patch or two showing at the surface) for
// a Brush to sweep (world/archaeology.js). Planned from the seed alone; each chunk stamps its part.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { MIN_Y, WORLD_HEIGHT, SEA_LEVEL, cidx } from './constants.js';
import { mulberry32, hash4, hashf } from './noise.js';
import { villagesNear } from './villages.js';
import { outpostsNear } from './temples.js';
import { SITE, susMeta } from './archaeology.js';

export const BURIED_REGION = 224;
export const BURIED_REACH = 5; // furthest block from the centre (x or z)
export const BURIED_BIOMES = [BIOME.PLAINS, BIOME.TAIGA];
const WALL = [B.TERRACOTTA, B.BROWN_TERRACOTTA, B.MUD_BRICKS, B.PACKED_MUD, B.TERRACOTTA, B.MUD_BRICKS];
const cache = new Map();

/** The ruin of region (rx, rz), or null: { cx, cz, y (ground level), hw, hd (half sizes), seed }. */
export function buriedRuinInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 8484));
  let r = null;
  if (rng() < 0.34) {
    const R = BURIED_REGION, M = BURIED_REACH + 8;
    const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
    const col = gen.column(cx, cz), top = gen.surfaceAt(cx, cz, col), biome = gen.biomeFor(col, top);
    const hw = 3 + Math.floor(rng() * 3), hd = 3 + Math.floor(rng() * 3), seed = Math.floor(rng() * 1e9);
    const flat = [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]].every(([dx, dz]) => Math.abs(gen.surfaceAt(cx + dx, cz + dz) - top) <= 2);
    const R2 = BURIED_REACH + 4;
    const clear = !villagesNear(gen, cx - R2, cz - R2, cx + R2, cz + R2).length && !outpostsNear(gen, cx - R2, cz - R2, cx + R2, cz + R2).length;
    if (flat && clear && top > SEA_LEVEL && BURIED_BIOMES.includes(biome)) r = { cx, cz, y: top, hw, hd, seed };
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, r);
  return r;
}

export function buriedRuinsNear(gen, x0, z0, x1, z1) {
  const out = [], R = BURIED_REGION;
  for (let rx = Math.floor((x0 - BURIED_REACH) / R); rx <= Math.floor((x1 + BURIED_REACH) / R); rx++) for (let rz = Math.floor((z0 - BURIED_REACH) / R); rz <= Math.floor((z1 + BURIED_REACH) / R); rz++) {
    const r = buriedRuinInRegion(gen, rx, rz);
    if (r && r.cx + BURIED_REACH >= x0 && r.cx - BURIED_REACH <= x1 && r.cz + BURIED_REACH >= z0 && r.cz - BURIED_REACH <= z1) out.push(r);
  }
  return out;
}

/**
 * Every block of a ruin as [x, y, z, id, meta] in world coordinates. The walls run from three
 * blocks down to a broken top 0-2 blocks over the ground (here and there missing); inside, a
 * gravel floor two blocks down holds the Suspicious Gravel under a layer of dirt and grass.
 */
export function buriedRuinPlan(r) {
  const { cx, cz, y, hw, hd, seed } = r;
  const out = [];
  const h = (a, b, k) => hashf(seed, a, b, k);
  for (let dx = -hw; dx <= hw; dx++) for (let dz = -hd; dz <= hd; dz++) {
    const x = cx + dx, z = cz + dz, edge = Math.abs(dx) === hw || Math.abs(dz) === hd;
    if (edge) {
      // a wall stump: buried footing, then up to two blocks above the grass (gaps where it fell)
      const up = h(dx, dz, 1) < 0.25 ? -1 : Math.floor(h(dx, dz, 2) * 3);
      for (let yy = y - 3; yy <= y + up; yy++) out.push([x, yy, z, WALL[Math.floor(h(dx, yy, 3 + dz) * WALL.length)], 0]);
      for (let yy = Math.max(y + 1, y + up + 1); yy <= y + 10; yy++) out.push([x, yy, z, B.AIR, 0]);
      continue;
    }
    // inside: a gravel floor (some of it suspicious) under earth, the odd find showing at the top
    const sus = h(dx, dz, 4) < 0.22, shows = sus && h(dx, dz, 5) < 0.3;
    out.push([x, y - 3, z, B.PACKED_MUD, 0]);
    out.push([x, y - 2, z, sus && !shows ? B.SUSPICIOUS_GRAVEL : B.GRAVEL, sus && !shows ? susMeta(SITE.BURIED) : 0]);
    out.push([x, y - 1, z, h(dx, dz, 6) < 0.3 ? B.GRAVEL : B.DIRT, 0]);
    out.push([x, y, z, shows ? B.SUSPICIOUS_GRAVEL : h(dx, dz, 7) < 0.2 ? B.GRAVEL : B.GRASS, shows ? susMeta(SITE.BURIED) : 0]);
    for (let yy = y + 1; yy <= y + 10; yy++) out.push([x, yy, z, B.AIR, 0]); // no trees or grass growing through
  }
  return out;
}

/** Stamp the parts of nearby Buried Ruins inside chunk (cx, cz). */
export function stampBuriedRuins(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  for (const r of buriedRuinsNear(gen, X0, Z0, X0 + 15, Z0 + 15)) {
    for (const [x, y, z, id, m] of buriedRuinPlan(r)) {
      if (x < X0 || x >= X0 + 16 || z < Z0 || z >= Z0 + 16 || y <= MIN_Y || y >= MIN_Y + WORLD_HEIGHT) continue;
      const i = cidx(x - X0, y, z - Z0);
      blocks[i] = id; meta[i] = m;
    }
  }
}
