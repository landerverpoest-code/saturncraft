// Generation of Mite-Riddled stone (mobs/stoneMites.js): small clusters of Riddled Stone buried in the stone of the mountain, peak and highland
// biomes, and a twelfth of the Hollow Sanctums' stone bricks. A pass of its own (own hash salts), so nothing else in a chunk changes.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { MIN_Y, WORLD_HEIGHT, cidx } from './constants.js';
import { mulberry32, hash4, hashf } from './noise.js';

export const MITE_BIOME_IDS = new Set([BIOME.STONY_PEAKS, BIOME.SNOWY_PEAKS, BIOME.HIGHLAND_MEADOW]);
export const MITE_CLUSTER = { SHARE: 0.015, MIN: 3, MAX: 6, DEPTH: 3 }; // about 1.5 % of the stone, in clusters of 3 to 6, at least 3 blocks under the surface
export const SANCTUM_SHARE = 0.12;                                      // a bit over a tenth of the Sanctum's stone bricks

/** Is this Sanctum brick one of the Riddled ones (deterministic per cell). */
export const sanctumRiddled = (seed, x, y, z) => hashf(seed ^ 0x51ed, x, y, z) < SANCTUM_SHARE;

const STEPS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Seeds the clusters into one chunk's blocks (only Stone is replaced, only under mountain-style biomes, under the surface). */
export function stampMiteStone(gen, blocks, meta, cx, cz, heightmap, biomes) {
  let any = false;
  for (let i = 0; i < 256; i++) if (MITE_BIOME_IDS.has(biomes[i])) { any = true; break; }
  if (!any) return;
  const rng = mulberry32(hash4((gen.seed | 0) ^ 0x3a17e, cx, cz, 8201));
  const per = MITE_CLUSTER.SHARE / ((MITE_CLUSTER.MIN + MITE_CLUSTER.MAX) / 2); // chance that a stone cell starts a cluster
  const top = MIN_Y + WORLD_HEIGHT - 1;
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    if (!MITE_BIOME_IDS.has(biomes[x + z * 16])) continue;
    const ceil = Math.min(top, heightmap[x + z * 16] - MITE_CLUSTER.DEPTH);
    for (let y = MIN_Y + 6; y <= ceil; y++) {
      if (blocks[cidx(x, y, z)] !== B.STONE || rng() >= per) continue;
      const n = MITE_CLUSTER.MIN + Math.floor(rng() * (MITE_CLUSTER.MAX - MITE_CLUSTER.MIN + 1));
      let cx2 = x, cy = y, cz2 = z;
      for (let k = 0, steps = 0; k < n && steps < n * 4; steps++) {
        const i = cidx(cx2, cy, cz2);
        if (blocks[i] === B.STONE) { blocks[i] = B.MITE_STONE; meta[i] = 0; k++; } // (a step onto something else is wasted; the walk is short)
        for (let tries = 0; tries < 6; tries++) {
          const s = STEPS[Math.floor(rng() * 6)], nx = cx2 + s[0], ny = cy + s[1], nz = cz2 + s[2];
          if (nx < 0 || nx > 15 || nz < 0 || nz > 15 || ny < MIN_Y + 6 || ny > ceil) continue;
          cx2 = nx; cy = ny; cz2 = nz; break;
        }
      }
    }
  }
}
