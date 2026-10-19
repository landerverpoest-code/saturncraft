// Deterministic terrain generator. Runs inside Web Workers (see gen.worker.js)
// but is a pure module so it can be unit-tested and used for spawn search.
import { B, DEEP_VARIANT } from './blocks.js';
import { Simplex, hash4, hashf, mulberry32 } from './noise.js';
import { BIOME } from './biomes.js';
import { MIN_Y, WORLD_HEIGHT, SEA_LEVEL, CHUNK_VOLUME, cidx } from './constants.js';
import { grassColor, foliageColor } from './textures.js';

const DH = 4;   // density grid horizontal spacing
const DV = 8;   // density grid vertical spacing
const DNY = WORLD_HEIGHT / DV + 1;
const CV = 4;   // cave grid vertical spacing
const CNY = WORLD_HEIGHT / CV + 1;

const CONT_SPLINE = [[-1, 20], [-0.55, 30], [-0.3, 44], [-0.18, 54], [-0.1, 61], [-0.04, 64.5], [0.05, 67], [0.3, 74], [0.6, 86], [1, 98]];

function spline(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const t = (x - x0) / (x1 - x0);
      const s = t * t * (3 - 2 * t);
      return y0 + (y1 - y0) * s;
    }
  }
  return pts[pts.length - 1][1];
}
function smoothstep(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

// Ore placement configs mirroring the documented count/height/size per chunk.
export const ORE_FEATURES = [
  { block: B.COAL_ORE, count: 30, dist: 'uniform', min: 136, max: 320, size: 17 },
  { block: B.COAL_ORE, count: 20, dist: 'triangle', min: 0, max: 192, size: 17, discard: 0.5 },
  { block: B.IRON_ORE, count: 90, dist: 'triangle', min: 80, max: 384, size: 9 },
  { block: B.IRON_ORE, count: 10, dist: 'triangle', min: -24, max: 56, size: 9 },
  { block: B.IRON_ORE, count: 10, dist: 'uniform', min: -64, max: 72, size: 4 },
  { block: B.COPPER_ORE, count: 16, dist: 'triangle', min: -16, max: 112, size: 10 },
  { block: B.GOLD_ORE, count: 4, dist: 'triangle', min: -64, max: 32, size: 9, discard: 0.5 },
  { block: B.GOLD_ORE, count: 0.5, dist: 'uniform', min: -64, max: -48, size: 9, discard: 0.5 },
  { block: B.CINNABAR_ORE, count: 4, dist: 'uniform', min: -64, max: 15, size: 8 },
  { block: B.CINNABAR_ORE, count: 8, dist: 'triangle', min: -96, max: -32, size: 8 },
  { block: B.AZURITE_ORE, count: 2, dist: 'triangle', min: -32, max: 32, size: 7 },
  { block: B.AZURITE_ORE, count: 4, dist: 'uniform', min: -64, max: 64, size: 7, discard: 1 },
  { block: B.DIAMOND_ORE, count: 7, dist: 'triangle', min: -144, max: 16, size: 4, discard: 0.5 },
  { block: B.DIAMOND_ORE, count: 1 / 9, dist: 'triangle', min: -144, max: 16, size: 12, discard: 0.7 },
  { block: B.DIAMOND_ORE, count: 4, dist: 'triangle', min: -144, max: 16, size: 8, discard: 1 },
  { block: B.BERYL_ORE, count: 100, dist: 'triangle', min: -16, max: 480, size: 3, mountainsOnly: true },
  { block: B.GRANITE, count: 2, dist: 'uniform', min: 0, max: 60, size: 64 },
  { block: B.DIORITE, count: 2, dist: 'uniform', min: 0, max: 60, size: 64 },
  { block: B.ANDESITE, count: 2, dist: 'uniform', min: 0, max: 60, size: 64 },
  { block: B.TUFF, count: 2, dist: 'uniform', min: -64, max: 0, size: 64 },
  { block: B.DIRT, count: 7, dist: 'uniform', min: 0, max: 160, size: 33 },
  { block: B.GRAVEL, count: 14, dist: 'uniform', min: -64, max: 320, size: 33 },
];

/** Height sample following the documented uniform / triangle height providers. */
export function sampleOreHeight(f, rng) {
  if (f.dist === 'uniform') return f.min + Math.floor(rng() * (f.max - f.min + 1));
  const range = f.max - f.min;
  return f.min + Math.floor(rng() * (range / 2 + 1)) + Math.floor(rng() * (range / 2 + 1));
}

const REPLACEABLE_BY_ORE = new Uint8Array(256);
for (const id of [B.STONE, B.DEEPSTONE, B.GRANITE, B.DIORITE, B.ANDESITE, B.TUFF]) REPLACEABLE_BY_ORE[id] = 1;

export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    const s = (k) => new Simplex(hash4(this.seed, k, 911, 3));
    this.nCont = s(1); this.nEros = s(2); this.nRidge = s(3); this.nTemp = s(4); this.nHumid = s(5);
    this.nDetail = s(6); this.nDensity = s(7); this.nCheese = s(8); this.nSpagA = s(9); this.nSpagB = s(10);
    this.nSurface = s(11); this.nClay = s(12);
  }

  /** Per-column climate and height parameters. */
  column(x, z, out = {}) {
    const cont = Math.max(-1, Math.min(1, this.nCont.fbm2(x / 800, z / 800, 5) * 1.5 + 0.12));
    const eros = this.nEros.fbm2(x / 550, z / 550, 4) * 1.4;
    const ridge = 1 - Math.abs(this.nRidge.fbm2(x / 300, z / 300, 4)) * 2.2;
    const mountain = smoothstep(-0.02, 0.4, cont) * smoothstep(0.1, -0.55, eros);
    const pv = Math.max(0, ridge);
    let h = spline(CONT_SPLINE, cont);
    h += mountain * (Math.pow(pv, 1.5) * 130 + 20);
    const hillAmp = 3 + 9 * smoothstep(-0.2, 0.6, -eros) * smoothstep(-0.1, 0.2, cont);
    h += this.nDetail.fbm2(x / 110, z / 110, 3) * hillAmp;
    out.height = h;
    out.cont = cont;
    out.mountain = mountain;
    out.amp = 1.5 + mountain * 16;
    out.temp = 0.8 + this.nTemp.fbm2(x / 1100, z / 1100, 3) * 1.25 - Math.max(0, h - 90) / 140;
    out.humid = 0.5 + this.nHumid.fbm2(x / 900 + 50, z / 900 - 50, 3) * 0.9;
    return out;
  }

  densityGridNoise(gx, gy, gz) {
    return this.nDensity.fbm3((gx * DH) / 64, (gy * DV + MIN_Y) / 36, (gz * DH) / 64, 2);
  }
  caveGridNoise(gx, gy, gz, out) {
    const x = gx * DH, y = gy * CV + MIN_Y, z = gz * DH;
    out[0] = this.nCheese.fbm3(x / 90, y / 50, z / 90, 2);
    out[1] = this.nSpagA.noise3(x / 60, y / 38, z / 60);
    out[2] = this.nSpagB.noise3(x / 60 + 300, y / 38, z / 60);
  }

  /** Trilinear interpolated density noise at any world position (for cross-chunk queries). */
  densityNoiseAt(x, y, z) {
    const fx = x / DH, fy = (y - MIN_Y) / DV, fz = z / DH;
    const gx = Math.floor(fx), gy = Math.floor(fy), gz = Math.floor(fz);
    const tx = fx - gx, ty = fy - gy, tz = fz - gz;
    const c = (i, j, k) => this.densityGridNoise(gx + i, gy + j, gz + k);
    const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * tx;
    const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * tx;
    const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * tx;
    const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * tx;
    const y0 = x00 + (x10 - x00) * ty, y1 = x01 + (x11 - x01) * ty;
    return y0 + (y1 - y0) * tz;
  }

  caveNoiseAt(x, y, z) {
    const fx = x / DH, fy = (y - MIN_Y) / CV, fz = z / DH;
    const gx = Math.floor(fx), gy = Math.floor(fy), gz = Math.floor(fz);
    const tx = fx - gx, ty = fy - gy, tz = fz - gz;
    const res = [0, 0, 0], tmp = [0, 0, 0];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
      this.caveGridNoise(gx + i, gy + j, gz + k, tmp);
      const w = (i ? tx : 1 - tx) * (j ? ty : 1 - ty) * (k ? tz : 1 - tz);
      res[0] += tmp[0] * w; res[1] += tmp[1] * w; res[2] += tmp[2] * w;
    }
    return res;
  }

  static isCarved(cheese, a, b, y, surface) {
    if (y < MIN_Y + 5) return false;
    const depth = surface - y;
    if (surface < SEA_LEVEL && depth < 9) return false; // keep ocean floors sealed
    const cheeseT = 0.58 + Math.max(0, 14 - depth) * 0.04;
    if (cheese > cheeseT) return true;
    const width = 0.0045 * (y < 0 ? 1.4 : 1);
    return a * a + b * b < width;
  }

  /** Top solid block y for a column (used for cross-chunk tree placement). */
  surfaceAt(x, z, col = this.column(x, z)) {
    const top = Math.ceil(col.height + col.amp + 1);
    const bot = Math.floor(col.height - col.amp - 1);
    for (let y = top; y >= bot; y--) {
      if (col.height - y + this.densityNoiseAt(x, y, z) * col.amp > 0) return y;
    }
    return bot;
  }

  biomeFor(col, top) {
    const t = col.temp, h = col.humid;
    if (col.cont < -0.18 && top < SEA_LEVEL) return t < 0.15 ? BIOME.FROZEN_OCEAN : BIOME.OCEAN;
    if (col.cont < -0.07 && top <= SEA_LEVEL + 3) return t < 0.15 ? BIOME.SNOWY_PLAINS : BIOME.BEACH;
    if (col.mountain > 0.3 && top > 105) return (t < 0.5 || top > 170) ? BIOME.SNOWY_PEAKS : BIOME.STONY_PEAKS;
    if (t > 1.3 && h < 0.35) return BIOME.DESERT;
    if (t < 0.15) return BIOME.SNOWY_PLAINS;
    if (t < 0.45) return BIOME.TAIGA;
    if (h > 0.62) return BIOME.FOREST;
    if (h > 0.45 && t < 0.85) return BIOME.BIRCH_FOREST;
    return BIOME.PLAINS;
  }

  /**
   * Generate a full chunk.
   * @returns {{blocks: Uint8Array, meta: Uint8Array, biomes: Uint8Array, colors: Uint8Array, heightmap: Int16Array}}
   */
  generate(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const meta = new Uint8Array(CHUNK_VOLUME);
    const biomes = new Uint8Array(256);
    const colors = new Uint8Array(256 * 6);
    const heightmap = new Int16Array(256);
    const x0 = cx * 16, z0 = cz * 16;

    // 1. Density grid
    const dgrid = new Float64Array(5 * 5 * DNY);
    for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) for (let j = 0; j < DNY; j++) {
      dgrid[(i * 5 + k) * DNY + j] = this.densityGridNoise(cx * 4 + i, j, cz * 4 + k);
    }
    const cols = new Array(256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) cols[x + z * 16] = this.column(x0 + x, z0 + z);

    // 2. Base stone fill
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const col = cols[x + z * 16];
      const H = col.height, amp = col.amp;
      const yLow = Math.floor(H - amp - 1), yHigh = Math.ceil(H + amp + 1);
      const ix = x >> 2, iz = z >> 2, tx = (x & 3) / 4, tz = (z & 3) / 4;
      const b00 = (ix * 5 + iz) * DNY, b10 = ((ix + 1) * 5 + iz) * DNY, b01 = (ix * 5 + iz + 1) * DNY, b11 = ((ix + 1) * 5 + iz + 1) * DNY;
      for (let y = MIN_Y; y <= Math.min(yHigh, MIN_Y + WORLD_HEIGHT - 1); y++) {
        let solid;
        if (y < yLow) solid = true;
        else {
          const fy = (y - MIN_Y) / DV, j = Math.floor(fy), ty = fy - j;
          const n0 = (dgrid[b00 + j] * (1 - tx) + dgrid[b10 + j] * tx) * (1 - tz) + (dgrid[b01 + j] * (1 - tx) + dgrid[b11 + j] * tx) * tz;
          const n1 = (dgrid[b00 + j + 1] * (1 - tx) + dgrid[b10 + j + 1] * tx) * (1 - tz) + (dgrid[b01 + j + 1] * (1 - tx) + dgrid[b11 + j + 1] * tx) * tz;
          solid = H - y + (n0 + (n1 - n0) * ty) * amp > 0;
        }
        if (solid) blocks[cidx(x, y, z)] = B.STONE;
      }
    }

    // 3. Surface + biome
    const rng = mulberry32(hash4(this.seed, cx, cz, 1));
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const ci = x + z * 16;
      const col = cols[ci];
      let top = MIN_Y;
      for (let y = Math.ceil(col.height + col.amp + 1); y > MIN_Y; y--) if (blocks[cidx(x, y, z)]) { top = y; break; }
      heightmap[ci] = top;
      const biome = this.biomeFor(col, top);
      biomes[ci] = biome;
      const tNorm = Math.max(0, Math.min(1, col.temp / 1.3)), hNorm = Math.max(0, Math.min(1, col.humid));
      const g = grassColor(biome === BIOME.DESERT ? 1 : tNorm, biome === BIOME.DESERT ? 0 : hNorm);
      const f = foliageColor(tNorm, hNorm);
      colors.set([g[0], g[1], g[2], f[0], f[1], f[2]], ci * 6);
      this.applySurface(blocks, x, z, top, biome, x0 + x, z0 + z);
    }

    // 4. Caves
    const cg = new Float32Array(5 * 5 * CNY * 3);
    const tmp = [0, 0, 0];
    for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) for (let j = 0; j < CNY; j++) {
      this.caveGridNoise(cx * 4 + i, j, cz * 4 + k, tmp);
      const o = ((i * 5 + k) * CNY + j) * 3;
      cg[o] = tmp[0]; cg[o + 1] = tmp[1]; cg[o + 2] = tmp[2];
    }
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const top = heightmap[x + z * 16];
      const ix = x >> 2, iz = z >> 2, tx = (x & 3) / 4, tz = (z & 3) / 4;
      const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz;
      const o00 = (ix * 5 + iz) * CNY * 3, o10 = ((ix + 1) * 5 + iz) * CNY * 3, o01 = (ix * 5 + iz + 1) * CNY * 3, o11 = ((ix + 1) * 5 + iz + 1) * CNY * 3;
      for (let y = MIN_Y + 5; y <= top; y++) {
        const i = cidx(x, y, z);
        if (!blocks[i]) continue;
        const fy = (y - MIN_Y) / CV, j = Math.floor(fy), ty = fy - j;
        const v = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          const a = cg[o00 + j * 3 + c] * w00 + cg[o10 + j * 3 + c] * w10 + cg[o01 + j * 3 + c] * w01 + cg[o11 + j * 3 + c] * w11;
          const bb = cg[o00 + (j + 1) * 3 + c] * w00 + cg[o10 + (j + 1) * 3 + c] * w10 + cg[o01 + (j + 1) * 3 + c] * w01 + cg[o11 + (j + 1) * 3 + c] * w11;
          v[c] = a + (bb - a) * ty;
        }
        if (TerrainGenerator.isCarved(v[0], v[1], v[2], y, top)) {
          blocks[i] = y < -54 ? B.LAVA : B.AIR;
        }
      }
      // Recompute surface after carving (cave entrances)
      let t2 = MIN_Y;
      for (let y = top; y > MIN_Y; y--) { const b = blocks[cidx(x, y, z)]; if (b && b !== B.LAVA) { t2 = y; break; } }
      heightmap[x + z * 16] = t2;
    }

    // 5. Deepstone + bedrock
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      for (let y = MIN_Y; y < 8; y++) {
        const i = cidx(x, y, z);
        if (y <= MIN_Y + 4 && (y === MIN_Y || hashf(this.seed, x0 + x, y, z0 + z) < (MIN_Y + 5 - y) / 5)) { blocks[i] = B.BEDROCK; continue; }
        if (blocks[i] === B.STONE && (y < 0 || hashf(this.seed, x0 + x, y, z0 + z + 7) < (8 - y) / 8)) blocks[i] = B.DEEPSTONE;
      }
    }

    // 6. Ores
    const mountainChunk = cols[136].mountain > 0.3;
    for (const f of ORE_FEATURES) {
      if (f.mountainsOnly && !mountainChunk) continue;
      let n = Math.floor(f.count);
      if (rng() < f.count - n) n++;
      for (let k = 0; k < n; k++) {
        const ox = Math.floor(rng() * 16), oz = Math.floor(rng() * 16);
        const oy = sampleOreHeight(f, rng);
        if (oy < MIN_Y || oy >= MIN_Y + WORLD_HEIGHT) continue;
        this.placeVein(blocks, rng, f, ox, oy, oz);
      }
    }

    // 7. Water
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const top = heightmap[x + z * 16];
      const biome = biomes[x + z * 16];
      for (let y = top + 1; y <= SEA_LEVEL; y++) {
        const i = cidx(x, y, z);
        if (!blocks[i]) blocks[i] = (y === SEA_LEVEL && biome === BIOME.FROZEN_OCEAN) ? B.ICE : B.WATER;
      }
    }

    // 8. Decoration
    this.decorate(blocks, meta, biomes, heightmap, cx, cz, cols);

    // Final heightmap: highest non-air block
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      let y = MIN_Y + WORLD_HEIGHT - 1;
      for (; y > MIN_Y; y--) if (blocks[cidx(x, y, z)]) break;
      heightmap[x + z * 16] = y;
    }
    return { blocks, meta, biomes, colors, heightmap };
  }

  applySurface(blocks, x, z, top, biome, wx, wz) {
    const depthNoise = this.nSurface.noise2(wx / 12, wz / 12);
    const dirtDepth = 3 + Math.floor((depthNoise + 1) * 1.2);
    const set = (y, b) => { if (y > MIN_Y && blocks[cidx(x, y, z)]) blocks[cidx(x, y, z)] = b; };
    switch (biome) {
      case BIOME.DESERT:
        for (let d = 0; d < dirtDepth + 1; d++) set(top - d, B.SAND);
        for (let d = dirtDepth + 1; d < dirtDepth + 5; d++) set(top - d, B.SANDSTONE);
        break;
      case BIOME.BEACH:
        for (let d = 0; d < 4; d++) set(top - d, B.SAND);
        for (let d = 4; d < 6; d++) set(top - d, B.SANDSTONE);
        break;
      case BIOME.OCEAN:
      case BIOME.FROZEN_OCEAN: {
        const clay = this.nClay.noise2(wx / 20, wz / 20) > 0.55;
        const mat = biome === BIOME.FROZEN_OCEAN || top < 42 ? B.GRAVEL : (clay ? B.CLAY : B.SAND);
        for (let d = 0; d < 3; d++) set(top - d, mat);
        break;
      }
      case BIOME.STONY_PEAKS:
        if (top < 118) { set(top, B.GRASS); for (let d = 1; d < dirtDepth; d++) set(top - d, B.DIRT); }
        else if (depthNoise > 0.5) set(top, B.GRAVEL);
        break;
      case BIOME.SNOWY_PEAKS:
        if (top > 150) { set(top, B.SNOW_BLOCK); set(top - 1, B.SNOW_BLOCK); }
        else if (top < 118) { set(top, B.SNOWY_GRASS); for (let d = 1; d < dirtDepth; d++) set(top - d, B.DIRT); }
        break;
      case BIOME.SNOWY_PLAINS:
        if (top < SEA_LEVEL) { for (let d = 0; d < 3; d++) set(top - d, B.GRAVEL); break; }
        set(top, B.SNOWY_GRASS); for (let d = 1; d < dirtDepth; d++) set(top - d, B.DIRT);
        break;
      default:
        if (top < SEA_LEVEL - 1) { for (let d = 0; d < 3; d++) set(top - d, B.DIRT); break; }
        set(top, B.GRASS); for (let d = 1; d < dirtDepth; d++) set(top - d, B.DIRT);
    }
  }

  placeVein(blocks, rng, f, ox, oy, oz) {
    const size = f.size;
    const angle = rng() * Math.PI;
    const r8 = size / 8;
    const xa = ox + Math.sin(angle) * r8, xb = ox - Math.sin(angle) * r8;
    const za = oz + Math.cos(angle) * r8, zb = oz - Math.cos(angle) * r8;
    const ya = oy + Math.floor(rng() * 3) - 1, yb = oy + Math.floor(rng() * 3) - 1;
    const isOre = f.block !== B.GRANITE && f.block !== B.DIORITE && f.block !== B.ANDESITE && f.block !== B.TUFF && f.block !== B.DIRT && f.block !== B.GRAVEL;
    for (let s = 0; s < size; s++) {
      const t = s / size;
      const px = xa + (xb - xa) * t, py = ya + (yb - ya) * t, pz = za + (zb - za) * t;
      const r = ((Math.sin(Math.PI * t) + 1) * rng() * size / 16 + 1) / 2;
      const minX = Math.max(0, Math.floor(px - r)), maxX = Math.min(15, Math.floor(px + r));
      const minZ = Math.max(0, Math.floor(pz - r)), maxZ = Math.min(15, Math.floor(pz + r));
      const minY = Math.max(MIN_Y + 1, Math.floor(py - r)), maxY = Math.min(MIN_Y + WORLD_HEIGHT - 2, Math.floor(py + r));
      for (let x = minX; x <= maxX; x++) {
        const dx = (x + 0.5 - px) / r;
        for (let z = minZ; z <= maxZ; z++) {
          const dz = (z + 0.5 - pz) / r;
          for (let y = minY; y <= maxY; y++) {
            const dy = (y + 0.5 - py) / r;
            if (dx * dx + dy * dy + dz * dz >= 1) continue;
            const i = cidx(x, y, z);
            const cur = blocks[i];
            if (!REPLACEABLE_BY_ORE[cur]) continue;
            if (f.discard && this.exposedToAir(blocks, x, y, z) && rng() < f.discard) continue;
            let b = f.block;
            if (isOre && cur === B.DEEPSTONE) b = DEEP_VARIANT[b] || b;
            else if (isOre && cur !== B.STONE && cur !== B.DEEPSTONE) continue;
            if (!isOre && cur === B.DEEPSTONE && b !== B.TUFF) continue;
            blocks[i] = b;
          }
        }
      }
    }
  }

  exposedToAir(blocks, x, y, z) {
    if (x > 0 && !blocks[cidx(x - 1, y, z)]) return true;
    if (x < 15 && !blocks[cidx(x + 1, y, z)]) return true;
    if (z > 0 && !blocks[cidx(x, y, z - 1)]) return true;
    if (z < 15 && !blocks[cidx(x, y, z + 1)]) return true;
    if (!blocks[cidx(x, y - 1, z)] || !blocks[cidx(x, y + 1, z)]) return true;
    return false;
  }

  treeDensity(biome) {
    switch (biome) {
      case BIOME.FOREST: return 0.04;
      case BIOME.BIRCH_FOREST: return 0.035;
      case BIOME.TAIGA: return 0.035;
      case BIOME.SNOWY_PLAINS: return 0.004;
      case BIOME.PLAINS: return 0.0025;
      case BIOME.STONY_PEAKS: return 0.002;
      case BIOME.SNOWY_PEAKS: return 0.003;
      default: return 0;
    }
  }

  decorate(blocks, meta, biomes, heightmap, cx, cz, cols) {
    const x0 = cx * 16, z0 = cz * 16;
    // Ground plants (inside chunk only)
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const ci = x + z * 16;
      const top = heightmap[ci];
      if (top < MIN_Y + 1 || top >= MIN_Y + WORLD_HEIGHT - 3) continue;
      const ground = blocks[cidx(x, top, z)];
      const above = cidx(x, top + 1, z);
      if (blocks[above]) continue;
      const r = hashf(this.seed, x0 + x, z0 + z, 41);
      const biome = biomes[ci];
      if (ground === B.GRASS) {
        const grassP = biome === BIOME.PLAINS ? 0.22 : biome === BIOME.TAIGA ? 0.07 : 0.1;
        if (r < 0.015) blocks[above] = hashf(this.seed, x0 + x, z0 + z, 42) < 0.5 ? B.SUNPETAL : B.REDBLOOM;
        else if (r < 0.015 + grassP) blocks[above] = B.TALL_GRASS;
      } else if (ground === B.SAND && biome === BIOME.DESERT) {
        if (r < 0.006) blocks[above] = B.DEAD_BUSH;
        else if (r < 0.011) {
          const free = (dx, dz) => { const xx = x + dx, zz = z + dz; return xx < 0 || zz < 0 || xx > 15 || zz > 15 || !blocks[cidx(xx, top + 1, zz)]; };
          if (free(1, 0) && free(-1, 0) && free(0, 1) && free(0, -1)) {
            const h = 1 + Math.floor(hashf(this.seed, x0 + x, z0 + z, 43) * 3);
            for (let k = 1; k <= h; k++) blocks[cidx(x, top + k, z)] = B.CACTUS;
          }
        }
      }
    }
    // Trees: candidates from a margin around the chunk so canopies cross borders.
    const tmpCol = {};
    for (let wz = z0 - 3; wz < z0 + 19; wz++) for (let wx = x0 - 3; wx < x0 + 19; wx++) {
      const r = hashf(this.seed, wx, wz, 51);
      if (r > 0.045) continue;
      const inside = wx >= x0 && wx < x0 + 16 && wz >= z0 && wz < z0 + 16;
      let col, top;
      if (inside) {
        col = cols[(wx - x0) + (wz - z0) * 16];
        top = heightmap[(wx - x0) + (wz - z0) * 16];
        const g = blocks[cidx(wx - x0, top, wz - z0)];
        if (g !== B.GRASS && g !== B.SNOWY_GRASS && g !== B.DIRT) continue;
      } else {
        col = this.column(wx, wz, tmpCol);
        top = this.surfaceAt(wx, wz, col);
      }
      if (top < SEA_LEVEL) continue;
      const biome = this.biomeFor(col, top);
      if (r > this.treeDensity(biome)) continue;
      if (biome === BIOME.STONY_PEAKS || biome === BIOME.SNOWY_PEAKS) { if (top >= 118) continue; }
      if (!inside) {
        // Reject if a cave mouth removed the ground there
        const cv = this.caveNoiseAt(wx, top, wz);
        if (TerrainGenerator.isCarved(cv[0], cv[1], cv[2], top, top)) continue;
      }
      const tr = hashf(this.seed, wx, wz, 52);
      let kind = 'oak';
      if (biome === BIOME.TAIGA || biome === BIOME.SNOWY_PLAINS || biome === BIOME.SNOWY_PEAKS || biome === BIOME.STONY_PEAKS) kind = 'spruce';
      else if (biome === BIOME.BIRCH_FOREST) kind = tr < 0.85 ? 'birch' : 'oak';
      else if (biome === BIOME.FOREST) kind = tr < 0.2 ? 'birch' : 'oak';
      this.placeTree(blocks, kind, wx - x0, top + 1, wz - z0, hashf(this.seed, wx, wz, 53));
    }
  }

  placeTree(blocks, kind, lx, y, lz, r) {
    const set = (x, yy, z, b, force) => {
      if (x < 0 || z < 0 || x > 15 || z > 15 || yy <= MIN_Y || yy >= MIN_Y + WORLD_HEIGHT) return;
      const i = cidx(x, yy, z);
      const cur = blocks[i];
      if (force || cur === B.AIR || cur === B.TALL_GRASS || cur === B.SUNPETAL || cur === B.REDBLOOM) blocks[i] = b;
      else if (cur === B.OAK_LEAVES || cur === B.BIRCH_LEAVES || cur === B.SPRUCE_LEAVES) { if (b !== B.OAK_LEAVES && b !== B.BIRCH_LEAVES && b !== B.SPRUCE_LEAVES) blocks[i] = b; }
    };
    if (kind === 'spruce') {
      const h = 6 + Math.floor(r * 4);
      const leafStart = 2 + Math.floor(r * 2);
      let radius = 0;
      for (let k = h; k >= leafStart; k--) {
        const yy = y + k;
        for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > radius + (radius > 1 ? 1 : 0)) continue;
          set(lx + dx, yy, lz + dz, B.SPRUCE_LEAVES);
        }
        radius = radius >= 2 ? (k % 2 ? 1 : 2) : radius + 1;
        if (k > h - 2) radius = Math.min(radius, 1);
      }
      set(lx, y + h + 1, lz, B.SPRUCE_LEAVES);
      for (let k = 0; k < h; k++) set(lx, y + k, lz, B.SPRUCE_LOG, true);
      set(lx, y - 1, lz, B.DIRT, true);
      return;
    }
    const log = kind === 'birch' ? B.BIRCH_LOG : B.OAK_LOG;
    const leaf = kind === 'birch' ? B.BIRCH_LEAVES : B.OAK_LEAVES;
    const h = (kind === 'birch' ? 5 : 4) + Math.floor(r * 3);
    for (let yy = y + h - 3; yy <= y + h; yy++) {
      const layer = yy - (y + h);
      const radius = layer >= -1 ? 1 : 2;
      for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
        if (corner && (layer === 0 || hashf(dx, yy - y, dz, Math.floor(r * 1e6)) < 0.5)) continue;
        set(lx + dx, yy, lz + dz, leaf);
      }
    }
    for (let k = 0; k < h; k++) set(lx, y + k, lz, log, true);
    set(lx, y - 1, lz, B.DIRT, true);
  }

  /** Find a dry land spawn column near the origin. */
  findSpawn() {
    for (let r = 0; r < 4096; r += 16) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos(a * Math.PI / 4) * r), z = Math.round(Math.sin(a * Math.PI / 4) * r);
        const col = this.column(x, z);
        const top = this.surfaceAt(x, z, col);
        const biome = this.biomeFor(col, top);
        if (top > SEA_LEVEL + 1 && top < 100 && biome !== BIOME.BEACH && biome !== BIOME.DESERT) return { x: x + 0.5, y: top + 1, z: z + 0.5 };
      }
    }
    return { x: 0.5, y: 100, z: 0.5 };
  }
}
