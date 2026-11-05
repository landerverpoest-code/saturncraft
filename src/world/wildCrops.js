// Wild crops: a separate decoration pass (run after the ordinary decoration, before the structures) that scatters the
// farming depth crops (world/farming.js) through the wild, so a player can find them before they farm:
//  * Frostroots in small plots in the cold biomes (snowy plains, snowy taiga, taiga). Crops need farmland under them, so a
//    wild plot is a few tiles of bare farmland that was tilled by nobody; once picked they go back to dirt, as farmland does.
//  * Dewberry Brambles on forest edges and in meadows (forests, flower forests, birch forests, Highland Meadows, Blossom
//    Groves; plains that border trees), mostly ripe.
//  * Sungourds, whole gourds lying in patches on warm grassland (savanna, jungle, a few on plains).
// Everything is decided per 8 x 8 cell and per block from hashes with their own salts (9101 and up), so the passes before
// it keep producing exactly what they always did and the plots look the same across chunk borders and on every machine.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { cidx, MIN_Y, WORLD_HEIGHT, SEA_LEVEL } from './constants.js';
import { hashf } from './noise.js';

const COLD = new Set([BIOME.SNOWY_PLAINS, BIOME.SNOWY_TAIGA, BIOME.TAIGA]);
const BRAMBLE_BIOMES = { [BIOME.FOREST]: 0.1, [BIOME.BIRCH_FOREST]: 0.1, [BIOME.FLOWER_FOREST]: 0.12, [BIOME.HIGHLAND_MEADOW]: 0.1, [BIOME.BLOSSOM_GROVE]: 0.08, [BIOME.PLAINS]: 0.05 };
const GOURD_BIOMES = { [BIOME.SAVANNA]: 0.1, [BIOME.JUNGLE]: 0.04, [BIOME.PLAINS]: 0.025 };
const SOIL = new Set([B.GRASS, B.SNOWY_GRASS, B.DIRT]);
const FREE = new Set([B.AIR, B.SNOW_LAYER, B.TALL_GRASS]);

export const WILD_SALT = { frost: 9101, bramble: 9111, gourd: 9121 };

/** Does the 8 x 8 cell holding world x, z carry a patch of the kind with hash salt `salt` (chance p)? */
const patch = (seed, wx, wz, salt, p) => hashf(seed, wx >> 3, wz >> 3, salt) < p;

/** Is there a tree trunk within `r` blocks (inside this chunk) of local x, z at height y? */
function logNear(blocks, x, y, z, r) {
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    const nx = x + dx, nz = z + dz;
    if (nx < 0 || nz < 0 || nx > 15 || nz > 15) continue;
    for (let k = 1; k <= 3; k++) { const b = blocks[cidx(nx, y + k, nz)]; if (b === B.OAK_LOG || b === B.BIRCH_LOG || b === B.SPRUCE_LOG || b === B.DARK_OAK_LOG || b === B.BLOSSOM_LOG) return true; }
  }
  return false;
}

/** Scatter the wild crops over chunk (cx, cz). `heightmap` is the terrain's, as the ordinary decoration sees it. */
export function stampWildCrops(gen, blocks, meta, cx, cz, heightmap, biomes) {
  const x0 = cx * 16, z0 = cz * 16, seed = gen.seed;
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const ci = x + z * 16, top = heightmap[ci], biome = biomes[ci];
    if (top <= SEA_LEVEL || top < MIN_Y + 1 || top >= MIN_Y + WORLD_HEIGHT - 4) continue;
    const gi = cidx(x, top, z), ai = cidx(x, top + 1, z), ground = blocks[gi];
    if (!SOIL.has(ground) || !FREE.has(blocks[ai])) continue;
    const wx = x0 + x, wz = z0 + z;
    if (COLD.has(biome)) {
      if (patch(seed, wx, wz, WILD_SALT.frost, 0.07) && hashf(seed, wx, wz, WILD_SALT.frost + 1) < 0.2) {
        blocks[gi] = B.FARMLAND; meta[gi] = 0;
        blocks[ai] = B.FROSTROOTS; meta[ai] = 3 + Math.floor(hashf(seed, wx, wz, WILD_SALT.frost + 2) * 5); // stages 3-7
      }
    } else if (ground !== B.SNOWY_GRASS && BRAMBLE_BIOMES[biome] !== undefined) {
      if (patch(seed, wx, wz, WILD_SALT.bramble, BRAMBLE_BIOMES[biome]) && hashf(seed, wx, wz, WILD_SALT.bramble + 1) < 0.22
        && !blocks[cidx(x, top + 2, z)] && (biome !== BIOME.PLAINS || logNear(blocks, x, top, z, 5))) { // open ground: a forest edge, not under the canopy
        blocks[ai] = B.DEWBERRY_BRAMBLE; meta[ai] = hashf(seed, wx, wz, WILD_SALT.bramble + 2) < 0.6 ? 3 : 2;
      }
    }
    if (ground === B.GRASS && GOURD_BIOMES[biome] !== undefined && !blocks[ai]) {
      if (patch(seed, wx, wz, WILD_SALT.gourd, GOURD_BIOMES[biome]) && hashf(seed, wx, wz, WILD_SALT.gourd + 1) < 0.13) {
        blocks[ai] = B.SUNGOURD; meta[ai] = Math.floor(hashf(seed, wx, wz, WILD_SALT.gourd + 2) * 4);
      }
    }
  }
}
