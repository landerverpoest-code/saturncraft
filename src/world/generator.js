// Deterministic terrain generator. Runs inside Web Workers (see gen.worker.js)
// but is a pure module so it can be unit-tested and used for spawn search.
import { stampVillages } from './villages.js';
import { stampMineshafts } from './mineshafts.js';
import { stampTemples, stampWrecks, stampOutposts } from './temples.js';
import { stampHuts } from './swampHuts.js';
import { stampSanctums } from './dimensions/sanctum.js';
import { stampMonuments } from './monuments.js';
import { stampCaveFeatures } from './caveGen.js';
import { treeShape, LEAVES, LOGS, PLANTS } from './trees.js';
import { B, DEEP_VARIANT } from './blocks.js';
import { Simplex, hash4, hashf, mulberry32 } from './noise.js';
import { carveChunk } from './carvers.js';
import { stampRuins } from './ruinedPortals.js';
import { BIOME, BIOMES } from './biomes.js';
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
  { block: B.COAL_ORE, count: 30, dist: 'triangle', min: 0, max: 192, size: 17 },
  { block: B.IRON_ORE, count: 90, dist: 'triangle', min: 80, max: 384, size: 9 },
  { block: B.IRON_ORE, count: 10, dist: 'triangle', min: -24, max: 56, size: 9 },
  { block: B.IRON_ORE, count: 10, dist: 'uniform', min: -64, max: 72, size: 4 },
  { block: B.COPPER_ORE, count: 16, dist: 'triangle', min: -16, max: 112, size: 10 },
  { block: B.GOLD_ORE, count: 4, dist: 'triangle', min: -64, max: 32, size: 9, discard: 0.2 },
  { block: B.GOLD_ORE, count: 0.5, dist: 'uniform', min: -64, max: -48, size: 9, discard: 0.5 },
  { block: B.CINNABAR_ORE, count: 4, dist: 'uniform', min: -64, max: 15, size: 8 },
  { block: B.CINNABAR_ORE, count: 8, dist: 'triangle', min: -96, max: -32, size: 8 },
  { block: B.AZURITE_ORE, count: 2, dist: 'triangle', min: -32, max: 32, size: 7 },
  { block: B.AZURITE_ORE, count: 4, dist: 'uniform', min: -64, max: 64, size: 7, discard: 0.3 },
  { block: B.DIAMOND_ORE, count: 7, dist: 'triangle', min: -144, max: 16, size: 4, discard: 0.2 },
  { block: B.DIAMOND_ORE, count: 1 / 9, dist: 'triangle', min: -144, max: 16, size: 12, discard: 0.3 },
  { block: B.DIAMOND_ORE, count: 4, dist: 'triangle', min: -144, max: 16, size: 8, discard: 0.4 },
  { block: B.BERYL_ORE, count: 100, dist: 'triangle', min: -16, max: 480, size: 3, mountainsOnly: true },
  // (Saturncraft extra) a little Beryl everywhere, so it can be found outside the mountains too
  { block: B.BERYL_ORE, count: 2, dist: 'uniform', min: -32, max: 48, size: 3 },
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

const SNOW_GROUND = new Set([B.SNOWY_GRASS, B.DIRT, B.STONE, B.GRAVEL, B.SAND, B.ICE, B.COBBLESTONE, B.ANDESITE, B.GRANITE, B.DIORITE]);

// Ground cover per biome: chance of tall grass, flowers and small mushrooms on a grass block.
const GRASS_P = { [BIOME.PLAINS]: 0.22, [BIOME.TAIGA]: 0.07, [BIOME.SAVANNA]: 0.35, [BIOME.JUNGLE]: 0.3, [BIOME.SWAMP]: 0.12, [BIOME.DARK_FOREST]: 0.06, [BIOME.FLOWER_FOREST]: 0.08 };
const FLOWER_P = { [BIOME.FLOWER_FOREST]: 0.2, [BIOME.SWAMP]: 0.012, [BIOME.JUNGLE]: 0.004, [BIOME.SAVANNA]: 0.006, [BIOME.DARK_FOREST]: 0.004 };
const SHROOM_P = { [BIOME.DARK_FOREST]: 0.025, [BIOME.SWAMP]: 0.01, [BIOME.TAIGA]: 0.003 };
const TERRACOTTAS = new Set([B.TERRACOTTA, B.ORANGE_TERRACOTTA, B.YELLOW_TERRACOTTA, B.WHITE_TERRACOTTA, B.BROWN_TERRACOTTA, B.RED_TERRACOTTA, B.LIGHT_GRAY_TERRACOTTA]);
const MAX_TREE_DENSITY = 0.14;

const REPLACEABLE_BY_ORE = new Uint8Array(256);
for (const id of [B.STONE, B.DEEPSTONE, B.GRANITE, B.DIORITE, B.ANDESITE, B.TUFF]) REPLACEABLE_BY_ORE[id] = 1;

export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    const s = (k) => new Simplex(hash4(this.seed, k, 911, 3));
    this.nCont = s(1); this.nEros = s(2); this.nRidge = s(3); this.nTemp = s(4); this.nHumid = s(5);
    this.nDetail = s(6); this.nDensity = s(7); this.nCheese = s(8); this.nSpagA = s(9); this.nSpagB = s(10);
    this.nSurface = s(11); this.nClay = s(12);
    this.nVariant = s(13); this.nIsland = s(14); this.nHill = s(15); this.nMesa = s(16);
    // Badlands colour bands: plain terracotta with thin coloured stripes, fixed per seed
    const br = mulberry32(hash4(this.seed, 77, 13, 5));
    const STRIPES = [B.ORANGE_TERRACOTTA, B.ORANGE_TERRACOTTA, B.YELLOW_TERRACOTTA, B.WHITE_TERRACOTTA, B.BROWN_TERRACOTTA, B.RED_TERRACOTTA, B.RED_TERRACOTTA, B.LIGHT_GRAY_TERRACOTTA];
    this.bands = new Uint8Array(64).fill(B.TERRACOTTA);
    for (let y = 0; y < 64;) {
      y += 1 + Math.floor(br() * 4);
      const c = STRIPES[Math.floor(br() * STRIPES.length)], w = 1 + Math.floor(br() * (c === B.ORANGE_TERRACOTTA ? 3 : 2));
      for (let k = 0; k < w && y < 64; k++, y++) this.bands[y] = c;
    }
  }

  /**
   * Per-column climate and height parameters. Mountains grow out of a
   * continuous "mountainness" (continentalness x low erosion) with wide
   * ramps: the outer band only gets rolling foothills, ridges and peaks rise
   * towards the core, so there are no walls standing on flat land. Biome
   * shapes (swamp flats, badlands mesas, mushroom islands) blend in with
   * smooth climate weights for the same reason.
   */
  column(x, z, out = {}) {
    const cont = Math.max(-1, Math.min(1, this.nCont.fbm2(x / 800, z / 800, 5) * 1.5 + 0.12));
    const eros = this.nEros.fbm2(x / 550, z / 550, 4) * 1.4;
    const ridge = 1 - Math.abs(this.nRidge.fbm2(x / 300, z / 300, 4)) * 2.2;
    const mountain = smoothstep(-0.12, 0.5, cont) * smoothstep(0.25, -0.75, eros);
    const pv = Math.max(0, ridge);
    let h = spline(CONT_SPLINE, cont);
    // peaks: ridges only reach full height in the core of a range
    h += Math.pow(mountain, 1.7) * (Math.pow(pv, 1.5) * 125 + 25);
    // foothills: a band of rolling hills around every range
    const foot = 4 * mountain * (1 - mountain);
    if (foot > 0.01) h += foot * (this.nHill.fbm2(x / 90, z / 90, 3) * 0.5 + 0.5) * 22;
    const hillAmp = 3 + 9 * smoothstep(-0.2, 0.6, -eros) * smoothstep(-0.1, 0.2, cont);
    const detail = this.nDetail.fbm2(x / 110, z / 110, 3);
    const t0 = 0.8 + this.nTemp.fbm2(x / 1100, z / 1100, 3) * 1.25;
    const humid = 0.5 + this.nHumid.fbm2(x / 900 + 50, z / 900 - 50, 3) * 0.9;
    const variant = this.nVariant.fbm2(x / 700, z / 700, 2);
    const flat = (1 - mountain) * (1 - mountain);
    // jungles are hillier
    const wJungle = smoothstep(1.02, 1.18, t0) * smoothstep(0.55, 0.68, humid);
    h += detail * (hillAmp + wJungle * 7 * flat);
    // swamps: warm, wet lowland flattened to just around sea level (shallow pools)
    const wSwamp = smoothstep(0.66, 0.76, humid) * smoothstep(0.4, 0.55, t0) * smoothstep(1.2, 1.05, t0) * smoothstep(0.3, 0.1, cont) * smoothstep(-0.16, -0.06, cont) * flat;
    if (wSwamp > 0) h += (SEA_LEVEL + 0.2 + detail * 1.4 - h) * wSwamp;
    // badlands: hot, dry and inland, raised into terraced mesas
    const wMesa = smoothstep(1.05, 1.2, t0) * smoothstep(0.4, 0.3, humid) * smoothstep(0.05, 0.22, variant) * smoothstep(-0.02, 0.12, cont) * flat;
    if (wMesa > 0) {
      h -= detail * hillAmp * 0.6 * wMesa; // flatter canyon floors
      const raise = wMesa * smoothstep(-0.15, 0.35, this.nMesa.fbm2(x / 220, z / 220, 3)) * 36;
      const s = raise / 7, fl = Math.floor(s);
      h += (fl + smoothstep(0.7, 1, s - fl)) * 7;
      out.mesaFloor = raise < 5;
    }
    // mushroom islands rise out of the deep ocean
    const wIsland = smoothstep(-0.4, -0.52, cont) * smoothstep(0.42, 0.58, this.nIsland.fbm2(x / 260, z / 260, 2));
    if (wIsland > 0) h += (SEA_LEVEL + 3 + detail * 4 - h) * wIsland;
    out.height = h;
    out.cont = cont;
    out.mountain = mountain;
    out.amp = (1.5 + mountain * mountain * 14) * (1 - wMesa * 0.75);
    out.temp = t0 - Math.max(0, h - 90) / 140;
    out.humid = humid;
    out.variant = variant;
    out.swamp = wSwamp; out.mesa = wMesa; out.island = wIsland;
    if (wMesa <= 0) out.mesaFloor = true;
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
    // big caverns grow more common with depth; tunnels widen a little below y 0
    const cheeseT = (y < 0 ? 0.48 : y < 40 ? 0.52 : 0.56) + Math.max(0, 14 - depth) * 0.04;
    if (cheese > cheeseT) return true;
    const width = 0.0058 * (y < 0 ? 1.4 : 1);
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

  /** Steep slopes keep bare stone instead of soil (deterministic, used for trees too). */
  isSteep(x, z, top, biome) {
    if (top <= SEA_LEVEL + 4 || biome === BIOME.DESERT || biome === BIOME.BEACH) return false;
    const h = (dx, dz) => this.column(x + dx, z + dz, this._tmpCol || (this._tmpCol = {})).height;
    const sx = Math.abs(h(1, 0) - h(-1, 0)), sz = Math.abs(h(0, 1) - h(0, -1));
    return Math.max(sx, sz) / 2 >= 2.2;
  }

  biomeFor(col, top) {
    const t = col.temp, h = col.humid;
    if (col.island > 0.5 && top >= SEA_LEVEL - 4) return BIOME.MUSHROOM_FIELDS;
    if (col.cont < -0.18 && top < SEA_LEVEL) return t < 0.15 ? BIOME.FROZEN_OCEAN : BIOME.OCEAN;
    if (col.swamp > 0.5 && top <= SEA_LEVEL + 3) return BIOME.SWAMP;
    if (col.cont < -0.07 && top <= SEA_LEVEL + 3) return t < 0.15 ? BIOME.SNOWY_PLAINS : BIOME.BEACH;
    if (col.mountain > 0.3 && top > 105) return (t < 0.5 || top > 170) ? BIOME.SNOWY_PEAKS : BIOME.STONY_PEAKS;
    if (col.mesa > 0.5) return BIOME.BADLANDS;
    if (t < 0.15) return h > 0.5 ? BIOME.SNOWY_TAIGA : BIOME.SNOWY_PLAINS;
    if (t < 0.45) return BIOME.TAIGA;
    if (t > 1.1) {
      if (h < 0.35) return BIOME.DESERT;
      if (h < 0.62) return BIOME.SAVANNA;
      return BIOME.JUNGLE;
    }
    if (h > 0.76) return BIOME.DARK_FOREST;
    if (h > 0.62) return col.variant > 0.3 ? BIOME.FLOWER_FOREST : BIOME.FOREST;
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

    const tints = this.tintGrid(x0, z0), tintOut = [0, 0, 0, 0, 0, 0];
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
      // grass/foliage tints blend smoothly across biome borders (blurred tint grid)
      tints.sample(x, z, tintOut);
      colors.set(tintOut, ci * 6);
      // Steep faces show bare rock, as in the reference game's mountain surface rules
      // (badland cliffs show their terracotta bands instead)
      if (this.isSteep(x0 + x, z0 + z, top, biome)) {
        if (biome === BIOME.BADLANDS) this.applySurface(blocks, x, z, top, biome, x0 + x, z0 + z, true, col);
        continue;
      }
      this.applySurface(blocks, x, z, top, biome, x0 + x, z0 + z, false, col);
    }

    // 4. Caves: worm tunnels and ravines (world/carvers.js), then the noise caves
    if (!this.noCarvers) carveChunk(this.seed, cx, cz, blocks, heightmap);
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

    // 6b. Dungeons (monster rooms)
    for (let k = 0; k < 14; k++) this.tryDungeon(blocks, meta, rng); // 10 + 4 attempts like the reference
    if (!this.noStructures) stampMineshafts(this.seed, blocks, meta, cx, cz);
    stampCaveFeatures(this, blocks, meta, cx, cz, heightmap); // Violite geodes, Seepstone caves (caveGen.js)

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

    // 9. Villages
    stampVillages(this, blocks, meta, cx, cz);
    stampTemples(this, blocks, meta, cx, cz);
    stampHuts(this, blocks, meta, cx, cz);     // swamp huts (world/swampHuts.js)
    stampWrecks(this, blocks, meta, cx, cz);
    stampMonuments(this, blocks, meta, cx, cz); // Tide Citadels (world/monuments.js)
    stampOutposts(this, blocks, meta, cx, cz);
    stampRuins(this, blocks, meta, cx, cz); // Ruined Rifts (world/ruinedPortals.js)
    stampSanctums(this, blocks, meta, cx, cz); // Hollow Sanctums (world/dimensions/sanctum.js)

    // Final heightmap: highest non-air block
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      let y = MIN_Y + WORLD_HEIGHT - 1;
      for (; y > MIN_Y; y--) if (blocks[cidx(x, y, z)]) break;
      heightmap[x + z * 16] = y;
    }
    return { blocks, meta, biomes, colors, heightmap };
  }

  /** Terracotta band colour at height y (bands wobble a little across the land). */
  bandAt(y, wx, wz) {
    const off = Math.round(this.nVariant.noise2(wx / 70, wz / 70) * 2.5);
    return this.bands[(((y + off) % 64) + 64) % 64];
  }

  applySurface(blocks, x, z, top, biome, wx, wz, steep = false, col = null) {
    const depthNoise = this.nSurface.noise2(wx / 12, wz / 12);
    const dirtDepth = 3 + Math.floor((depthNoise + 1) * 1.2);
    const set = (y, b) => { if (y > MIN_Y && blocks[cidx(x, y, z)]) blocks[cidx(x, y, z)] = b; };
    switch (biome) {
      case BIOME.BADLANDS: {
        // red sand on the flats, then layered terracotta far down so cliffs show the stripes
        const sand = steep ? 0 : (!col || col.mesaFloor) ? 2 + Math.floor(depthNoise + 1) : depthNoise > -0.35 ? 1 : 0;
        const bottom = Math.max(SEA_LEVEL - 12, top - 48);
        for (let y = top; y >= bottom; y--) {
          const i = cidx(x, y, z);
          if (blocks[i] !== B.STONE) continue;
          blocks[i] = top - y < sand ? B.RED_SAND : this.bandAt(y, wx, wz);
        }
        break;
      }
      case BIOME.SWAMP:
        set(top, top < SEA_LEVEL ? (this.nClay.noise2(wx / 9, wz / 9) > 0.35 ? B.CLAY : B.DIRT) : B.GRASS);
        for (let d = 1; d < dirtDepth; d++) set(top - d, B.DIRT);
        break;
      case BIOME.MUSHROOM_FIELDS:
        if (top < SEA_LEVEL - 1) { for (let d = 0; d < 3; d++) set(top - d, B.SAND); break; }
        set(top, B.MYCELIUM); for (let d = 1; d < dirtDepth; d++) set(top - d, B.DIRT);
        break;
      case BIOME.SNOWY_TAIGA:
        if (top < SEA_LEVEL) { for (let d = 0; d < 3; d++) set(top - d, B.GRAVEL); break; }
        set(top, B.SNOWY_GRASS); for (let d = 1; d < dirtDepth; d++) set(top - d, B.DIRT);
        break;
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

  /**
   * Monster room as in the reference generator: a cobblestone box (mossy
   * floor) with a 5-7 x 4 x 5-7 interior, a spawner in the middle and up to
   * two chests by the walls. It must sit in solid ground with 1-5 openings
   * into caves. Kept inside the chunk.
   */
  tryDungeon(blocks, meta, rng) {
    const rx = rng() < 0.5 ? 2 : 3, rz = rng() < 0.5 ? 2 : 3;
    const cx = rx + 1 + Math.floor(rng() * (14 - 2 * rx)), cz = rz + 1 + Math.floor(rng() * (14 - 2 * rz));
    const y = MIN_Y + 6 + Math.floor(rng() * 150);
    const SOLID_AT = (x, yy, z) => { const id = blocks[cidx(x, yy, z)]; return id !== 0 && id !== B.WATER && id !== B.LAVA; };
    let openings = 0;
    for (let x = cx - rx - 1; x <= cx + rx + 1; x++) for (let z = cz - rz - 1; z <= cz + rz + 1; z++) {
      if (!SOLID_AT(x, y - 1, z) || !SOLID_AT(x, y + 4, z)) return;
      const wall = x === cx - rx - 1 || x === cx + rx + 1 || z === cz - rz - 1 || z === cz + rz + 1;
      if (wall && !blocks[cidx(x, y, z)] && !blocks[cidx(x, y + 1, z)]) openings++;
    }
    if (openings < 1 || openings > 5) return;
    for (let x = cx - rx - 1; x <= cx + rx + 1; x++) for (let z = cz - rz - 1; z <= cz + rz + 1; z++) for (let yy = y - 1; yy <= y + 4; yy++) {
      const i = cidx(x, yy, z);
      const wall = x === cx - rx - 1 || x === cx + rx + 1 || z === cz - rz - 1 || z === cz + rz + 1;
      if (yy === y - 1) blocks[i] = rng() < 0.75 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE;
      else if (yy === y + 4) { if (SOLID_AT(x, yy, z)) blocks[i] = B.COBBLESTONE; }
      else if (wall) { if (blocks[i] && SOLID_AT(x, yy, z)) blocks[i] = rng() < 0.2 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE; }
      else blocks[i] = 0;
      if (blocks[i] !== B.CHEST) meta[i] = 0;
    }
    // chests against a wall (meta: facing into the room | 8 = loot not rolled yet)
    for (let c = 0; c < 2; c++) {
      for (let tries = 0; tries < 3; tries++) {
        const x = cx - rx + Math.floor(rng() * (2 * rx + 1)), z = cz - rz + Math.floor(rng() * (2 * rz + 1));
        const walls = [[0, -1, 2], [1, 0, 3], [0, 1, 0], [-1, 0, 1]].filter(([dx, dz]) => SOLID_AT(x + dx, y, z + dz));
        if (walls.length !== 1 || blocks[cidx(x, y, z)]) continue;
        blocks[cidx(x, y, z)] = B.CHEST;
        meta[cidx(x, y, z)] = walls[0][2] | 8;
        break;
      }
    }
    const r = rng();
    blocks[cidx(cx, y, cz)] = B.SPAWNER;
    meta[cidx(cx, y, cz)] = r < 0.5 ? 0 : r < 0.75 ? 1 : 2;
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
      case BIOME.JUNGLE: return 0.14;
      case BIOME.DARK_FOREST: return 0.075;
      case BIOME.FOREST: return 0.04;
      case BIOME.BIRCH_FOREST: return 0.035;
      case BIOME.TAIGA: return 0.035;
      case BIOME.SNOWY_TAIGA: return 0.03;
      case BIOME.FLOWER_FOREST: return 0.022;
      case BIOME.SWAMP: return 0.012;
      case BIOME.SAVANNA: return 0.005;
      case BIOME.MUSHROOM_FIELDS: return 0.004;
      case BIOME.SNOWY_PLAINS: return 0.004;
      case BIOME.PLAINS: return 0.0025;
      case BIOME.STONY_PEAKS: return 0.002;
      case BIOME.SNOWY_PEAKS: return 0.003;
      default: return 0;
    }
  }

  /** Tree kind for a biome; tr in [0,1) picks among the biome's mix. */
  treeKind(biome, tr) {
    switch (biome) {
      case BIOME.TAIGA: case BIOME.SNOWY_TAIGA: case BIOME.SNOWY_PLAINS: case BIOME.SNOWY_PEAKS: case BIOME.STONY_PEAKS: return 'spruce';
      case BIOME.BIRCH_FOREST: return tr < 0.85 ? 'birch' : 'oak';
      case BIOME.FOREST: return tr < 0.2 ? 'birch' : 'oak';
      case BIOME.FLOWER_FOREST: return tr < 0.3 ? 'birch' : 'oak';
      case BIOME.SWAMP: return 'swamp_oak';
      case BIOME.JUNGLE: return tr < 0.11 ? 'jungle_big' : tr < 0.5 ? 'jungle' : 'jungle_bush';
      case BIOME.SAVANNA: return tr < 0.85 ? 'acacia' : 'oak';
      case BIOME.DARK_FOREST: return tr < 0.04 ? 'brown_mushroom' : tr < 0.08 ? 'red_mushroom' : tr < 0.14 ? 'oak' : tr < 0.18 ? 'birch' : 'dark_oak';
      case BIOME.MUSHROOM_FIELDS: return tr < 0.5 ? 'brown_mushroom' : 'red_mushroom';
      default: return 'oak';
    }
  }

  decorate(blocks, meta, biomes, heightmap, cx, cz, cols) {
    const x0 = cx * 16, z0 = cz * 16;
    const h = (x, z, k) => hashf(this.seed, x0 + x, z0 + z, k);
    // Ground plants (inside chunk only)
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const ci = x + z * 16;
      const top = heightmap[ci];
      if (top < MIN_Y + 1 || top >= MIN_Y + WORLD_HEIGHT - 3) continue;
      const biome = biomes[ci];
      // lily pads float on shallow swamp water
      if (biome === BIOME.SWAMP && top < SEA_LEVEL && top >= SEA_LEVEL - 3 && blocks[cidx(x, SEA_LEVEL, z)] === B.WATER && !blocks[cidx(x, SEA_LEVEL + 1, z)] && h(x, z, 49) < 0.09) {
        blocks[cidx(x, SEA_LEVEL + 1, z)] = B.LILY_PAD;
      }
      const ground = blocks[cidx(x, top, z)];
      const above = cidx(x, top + 1, z);
      if (blocks[above]) continue;
      const r = h(x, z, 41);
      if (ground === B.GRASS) {
        const grassP = GRASS_P[biome] ?? 0.1;
        const flowerP = FLOWER_P[biome] ?? 0.015;
        const shroomP = SHROOM_P[biome] || 0;
        if (r < flowerP) {
          const f = h(x, z, 42);
          if (biome === BIOME.FLOWER_FOREST) blocks[above] = f < 0.3 ? B.SUNPETAL : f < 0.55 ? B.REDBLOOM : f < 0.8 ? B.ROSETTE : B.SKYBELL;
          else if (biome === BIOME.SWAMP) blocks[above] = B.SKYBELL;
          else blocks[above] = f < 0.5 ? B.SUNPETAL : B.REDBLOOM;
        } else if (r < flowerP + shroomP) blocks[above] = h(x, z, 42) < 0.6 ? B.BROWN_MUSHROOM : B.RED_MUSHROOM;
        else if (r < flowerP + shroomP + grassP) blocks[above] = B.TALL_GRASS;
      } else if (ground === B.MYCELIUM && r < 0.025) blocks[above] = h(x, z, 42) < 0.5 ? B.BROWN_MUSHROOM : B.RED_MUSHROOM;
      // pumpkin patches (plains/taiga) and melons (forests, plenty in jungles)
      const patch = biome === BIOME.JUNGLE ? 0.12 : 0.03;
      if (ground === B.GRASS && !blocks[above] && hashf(this.seed, (x0 + x) >> 3, (z0 + z) >> 3, 46) < patch && h(x, z, 47) < 0.12) {
        if (biome === BIOME.PLAINS || biome === BIOME.TAIGA) { blocks[above] = B.PUMPKIN; meta[above] = Math.floor(h(x, z, 48) * 4); }
        else if (biome === BIOME.FOREST || biome === BIOME.BIRCH_FOREST || biome === BIOME.JUNGLE) blocks[above] = B.MELON;
      }
      // sugar cane on the shore: grass, dirt or sand next to water
      if ((ground === B.GRASS || ground === B.SAND || ground === B.DIRT || ground === B.RED_SAND) && top === SEA_LEVEL && h(x, z, 44) < 0.12) {
        const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => { const xx = x + dx, zz = z + dz; return xx >= 0 && zz >= 0 && xx < 16 && zz < 16 && blocks[cidx(xx, top, zz)] === B.WATER; });
        if (wet && !blocks[above]) {
          const n = 1 + Math.floor(h(x, z, 45) * 3);
          for (let k = 1; k <= n; k++) blocks[cidx(x, top + k, z)] = B.SUGAR_CANE;
        }
      }
      const dry = (ground === B.SAND && biome === BIOME.DESERT) || (biome === BIOME.BADLANDS && (ground === B.RED_SAND || TERRACOTTAS.has(ground)));
      if (dry && !blocks[above]) {
        const sandy = ground === B.SAND || ground === B.RED_SAND;
        const bushP = biome === BIOME.BADLANDS ? 0.014 : 0.006, cactusP = sandy ? (biome === BIOME.BADLANDS ? 0.004 : 0.005) : 0;
        if (r < bushP) blocks[above] = B.DEAD_BUSH;
        else if (r < bushP + cactusP) {
          const free = (dx, dz) => { const xx = x + dx, zz = z + dz; return xx < 0 || zz < 0 || xx > 15 || zz > 15 || !blocks[cidx(xx, top + 1, zz)]; };
          if (free(1, 0) && free(-1, 0) && free(0, 1) && free(0, -1)) {
            const n = 1 + Math.floor(h(x, z, 43) * 3);
            for (let k = 1; k <= n; k++) blocks[cidx(x, top + k, z)] = B.CACTUS;
          }
        }
      }
    }
    // Trees: candidates from a margin around the chunk so canopies (up to 6
    // blocks from the trunk) cross borders. Each candidate is decided from
    // the seed and its own column only, so both chunks agree on it.
    const M = 6;
    const tmpCol = {};
    for (let wz = z0 - M; wz < z0 + 16 + M; wz++) for (let wx = x0 - M; wx < x0 + 16 + M; wx++) {
      const r = hashf(this.seed, wx, wz, 51);
      if (r > MAX_TREE_DENSITY) continue;
      const inside = wx >= x0 && wx < x0 + 16 && wz >= z0 && wz < z0 + 16;
      let col, top;
      if (inside) {
        col = cols[(wx - x0) + (wz - z0) * 16];
        top = heightmap[(wx - x0) + (wz - z0) * 16];
        const g = blocks[cidx(wx - x0, top, wz - z0)];
        if (g !== B.GRASS && g !== B.SNOWY_GRASS && g !== B.DIRT && g !== B.MYCELIUM && g !== B.CLAY) continue;
      } else {
        col = this.column(wx, wz, tmpCol);
        // only dense forests have candidates past the common threshold
        if (r > 0.045 && !(col.humid > 0.55 && col.temp > 0.4)) continue;
        top = this.surfaceAt(wx, wz, col);
      }
      if (top < SEA_LEVEL - 3) continue;
      const biome = this.biomeFor(col, top);
      if (r > this.treeDensity(biome)) continue;
      // swamp trees may stand in shallow water; others need dry land
      if (top < SEA_LEVEL && biome !== BIOME.SWAMP) continue;
      if (biome === BIOME.STONY_PEAKS || biome === BIOME.SNOWY_PEAKS) { if (top >= 118) continue; }
      if (!inside && this.isSteep(wx, wz, top, biome)) continue;
      if (!inside) {
        // Reject if a cave mouth removed the ground there
        const cv = this.caveNoiseAt(wx, top, wz);
        if (TerrainGenerator.isCarved(cv[0], cv[1], cv[2], top, top)) continue;
      }
      const kind = this.treeKind(biome, hashf(this.seed, wx, wz, 52));
      this.placeTree(blocks, meta, kind, wx - x0, top + 1, wz - z0, hashf(this.seed, wx, wz, 53));
      // a bee nest hangs on the side of some oaks and birches in sunny, flowery places
      const nestOdds = biome === BIOME.PLAINS || biome === BIOME.FLOWER_FOREST ? 0.05 : biome === BIOME.BIRCH_FOREST || biome === BIOME.FOREST ? 0.01 : 0;
      if (nestOdds && (kind === 'oak' || kind === 'birch') && hashf(this.seed, wx, wz, 54) < nestOdds) {
        const side = Math.floor(hashf(this.seed, wx, wz, 55) * 4), [sx, sz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][side];
        const nx = wx - x0 + sx, nz = wz - z0 + sz, ny = top + 3;
        if (nx >= 0 && nz >= 0 && nx < 16 && nz < 16 && (!blocks[cidx(nx, ny, nz)] || LEAVES.has(blocks[cidx(nx, ny, nz)]))) { blocks[cidx(nx, ny, nz)] = B.BEE_NEST; meta[cidx(nx, ny, nz)] = side; }
      }
    }
    // A layer of snow on the ground and treetops of cold biomes (not on peaks that are already snow blocks)
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const ci = x + z * 16, bd = BIOMES[biomes[ci]];
      if (!bd || bd.temp >= 0.15 || bd.key === 'frozen_ocean' || bd.key === 'ocean') continue;
      let y = Math.min(MIN_Y + WORLD_HEIGHT - 2, heightmap[ci] + 40);
      while (y > heightmap[ci] && !blocks[cidx(x, y, z)]) y--;
      const b = blocks[cidx(x, y, z)];
      if ((SNOW_GROUND.has(b) || LEAVES.has(b)) && !blocks[cidx(x, y + 1, z)]) blocks[cidx(x, y + 1, z)] = B.SNOW_LAYER;
    }
  }

  /** Grass + foliage tint of one column, from its biome and climate. */
  tintAt(wx, wz, tmp) {
    const col = this.column(wx, wz, tmp);
    const top = this.surfaceAt(wx, wz, col);
    const biome = this.biomeFor(col, top);
    const tNorm = Math.max(0, Math.min(1, col.temp / 1.3)), hNorm = Math.max(0, Math.min(1, col.humid));
    const bd = BIOMES[biome];
    const g = bd.grass || grassColor(biome === BIOME.DESERT ? 1 : tNorm, biome === BIOME.DESERT ? 0 : hNorm);
    const f = bd.foliage || foliageColor(tNorm, hNorm);
    return [g[0], g[1], g[2], f[0], f[1], f[2]];
  }

  /**
   * Tints sampled every 4 blocks on a world-aligned grid around the chunk,
   * box-blurred over 3x3 samples (about 12 blocks) and interpolated per
   * column, so neighbouring chunks agree and biome borders fade over ~8 blocks.
   */
  tintGrid(x0, z0) {
    const S = 4, N = 9, tmp = {}; // samples at x0-8 .. x0+24
    const raw = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) raw.push(this.tintAt(x0 - 8 + i * S, z0 - 8 + j * S, tmp));
    const M = 5, blur = []; // blurred samples at x0 .. x0+16
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const acc = [0, 0, 0, 0, 0, 0];
      for (let dj = 1; dj <= 3; dj++) for (let di = 1; di <= 3; di++) { const r = raw[(j + dj) * N + i + di]; for (let k = 0; k < 6; k++) acc[k] += r[k]; }
      blur.push(acc.map((v) => v / 9));
    }
    return {
      sample(x, z, out) {
        const fx = x / S, fz = z / S, i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
        const a = blur[j * M + i], b = blur[j * M + i + 1], c = blur[(j + 1) * M + i], d = blur[(j + 1) * M + i + 1];
        for (let k = 0; k < 6; k++) out[k] = Math.round((a[k] * (1 - tx) + b[k] * tx) * (1 - tz) + (c[k] * (1 - tx) + d[k] * tx) * tz);
      },
    };
  }

  placeTree(blocks, meta, kind, lx, y, lz, r) {
    for (const [dx, dy, dz, b, force, m] of treeShape(kind, r)) {
      const x = lx + dx, yy = y + dy, z = lz + dz;
      if (x < 0 || z < 0 || x > 15 || z > 15 || yy <= MIN_Y || yy >= MIN_Y + WORLD_HEIGHT) continue;
      const i = cidx(x, yy, z);
      const cur = blocks[i];
      if (force || cur === B.AIR || PLANTS.has(cur)) { blocks[i] = b; meta[i] = m || 0; }
      else if (LEAVES.has(cur) && (LOGS.has(b) || b === B.MUSHROOM_STEM)) { blocks[i] = b; meta[i] = 0; }
    }
  }

  /** Find a dry land spawn column near the origin. */
  findSpawn() {
    for (let r = 0; r < 4096; r += 16) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos(a * Math.PI / 4) * r), z = Math.round(Math.sin(a * Math.PI / 4) * r);
        const col = this.column(x, z);
        const top = this.surfaceAt(x, z, col);
        const biome = this.biomeFor(col, top);
        if (top > SEA_LEVEL + 1 && top < 100 && biome !== BIOME.BEACH && biome !== BIOME.DESERT && biome !== BIOME.BADLANDS && biome !== BIOME.SWAMP) return { x: x + 0.5, y: top + 1, z: z + 0.5 };
      }
    }
    return { x: 0.5, y: 100, z: 0.5 };
  }
}
