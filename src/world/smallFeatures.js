// Small features that fit inside one chunk: desert wells (a sandstone basin of water under a
// slab roof) and fossils (a spine and ribs of Bone Blocks buried in deserts and swamps).
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { cidx, SEA_LEVEL } from './constants.js';
import { hashf } from './noise.js';
import { SITE, susMeta } from './archaeology.js';

export function stampSmallFeatures(gen, blocks, meta, cx, cz, heightmap, biomes) {
  const set = (x, y, z, id, m = 0) => { if (x < 0 || x > 15 || z < 0 || z > 15) return; const i = cidx(x, y, z); blocks[i] = id; meta[i] = m; };
  const mid = 8 + 8 * 16, biome = biomes[mid], top = heightmap[mid];
  // desert well: 1 chunk in 150 of desert, on flat sand
  if (biome === BIOME.DESERT && hashf(gen.seed, cx, cz, 71) < 1 / 150 && top > SEA_LEVEL && !(gen.riverInBox && gen.riverInBox(cx * 16 + 5, cz * 16 + 5, cx * 16 + 11, cz * 16 + 11))) {
    const flat = [[5, 5], [11, 5], [5, 11], [11, 11]].every(([x, z]) => Math.abs(heightmap[x + z * 16] - top) <= 3);
    if (flat) {
      for (let x = 6; x <= 10; x++) for (let z = 6; z <= 10; z++) {
        for (let y = top - 4; y <= top; y++) if (y >= top - 1 || !blocks[cidx(x, y, z)]) set(x, y, z, B.SANDSTONE); // a footing on uneven dunes
        for (let y = top + 1; y <= top + 4; y++) set(x, y, z, B.AIR);
        const edge = x === 6 || x === 10 || z === 6 || z === 10;
        if (edge) set(x, top + 1, z, B.SANDSTONE_SLAB);
      }
      for (let y = top - 3; y <= top; y++) set(8, y, 8, B.WATER); // the shaft
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) set(8 + dx, top, 8 + dz, B.WATER);
      for (const [x, z] of [[7, 7], [9, 7], [7, 9], [9, 9]]) for (let y = top + 1; y <= top + 2; y++) set(x, y, z, B.SANDSTONE);
      for (let x = 7; x <= 9; x++) for (let z = 7; z <= 9; z++) set(x, top + 3, z, B.SANDSTONE_SLAB);
      set(8, top + 3, 8, B.SANDSTONE);
      // Suspicious Sand in the footing beside the basin, one or two blocks, for a Brush (world/archaeology.js)
      const spots = [[6, 8], [10, 8], [8, 6], [8, 10]], first = Math.floor(hashf(gen.seed, cx, cz, 76) * 4);
      set(spots[first][0], top - 1, spots[first][1], B.SUSPICIOUS_SAND, susMeta(SITE.WELL));
      if (hashf(gen.seed, cx, cz, 77) < 0.5) { const [x, z] = spots[(first + 2) & 3]; set(x, top - 1, z, B.SUSPICIOUS_SAND, susMeta(SITE.WELL)); }
    }
  }
  // fossil: 1 chunk in 64 of desert or swamp, 15-30 blocks under the surface
  if ((biome === BIOME.DESERT || biome === BIOME.SWAMP) && hashf(gen.seed, cx, cz, 72) < 1 / 64) {
    const y = top - 15 - Math.floor(hashf(gen.seed, cx, cz, 73) * 15);
    if (y > 0) {
      const len = 6 + Math.floor(hashf(gen.seed, cx, cz, 74) * 5), alongX = hashf(gen.seed, cx, cz, 75) < 0.5;
      const put = (a, dy, b) => (alongX ? set(3 + a, y + dy, 8 + b, B.BONE_BLOCK) : set(8 + b, y + dy, 3 + a, B.BONE_BLOCK));
      for (let a = 0; a < len; a++) {
        put(a, 0, 0); // the spine
        if (a % 2 === 1 && a < len - 1) for (const s of [-1, 1]) { put(a, -1, s * 2); put(a, 0, s); put(a, -2, s * 2); put(a, -3, s); } // ribs
      }
      put(len, 0, 0); put(len, 1, 0); put(len + 1, 0, 0); // the skull
    }
  }
}
