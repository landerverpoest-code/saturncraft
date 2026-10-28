// Face-culled section mesher with smooth lighting and ambient occlusion.
// Input is a 18x18x18 padded copy of a 16^3 section (1 block border from
// neighbours) so it can run inside a worker without access to the world.
import { B, BLOCKS, OPAQUE, SOLID, SHAPES, LAYERS, SHAPE, LAYER, BLOCK_LIMIT, WATERLOGGED, CANDLES, POTTED, PROPAGULE_HANGING } from './blocks.js';
import { LEAVES } from './trees.js';
import { waterTint } from './biomes.js';
import { FACE_TILE, FRONT_TILE, texId } from './textures.js';
import { WOOL_RGB } from './colors.js';
import { railHeight } from './rails.js';
import { ARTS, artOf, partOf } from './paintings.js';
import { crystalTex, orientPoint } from './caves.js';
import { circuitParts, partPoint, wireMask, wireColor } from './circuitShapes.js';
import { doorBox, ladderBox, SIDE_DIRS, DOOR_UPPER, BED_HEAD, BED_BOX, slabBox, stairBoxes, fenceConnects, fenceRenderBoxes, gateRenderBoxes, paneConnects, paneBoxes, snowBox, wallConnects, wallBoxes, trapdoorBox, blockBoxes, compostBox, CANDLE_SPOTS } from './shapes.js';

export const PAD = 18;
export const PAD_VOL = PAD * PAD * PAD;
export function pidx(x, y, z) { return (x + 1) + (z + 1) * PAD + (y + 1) * PAD * PAD; }

const FACES = [
  { n: [1, 0, 0], o: [1, 0, 1], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], o: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], o: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], o: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0] },
];
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
const off = (x, y, z) => x + z * PAD + y * PAD * PAD;

// Per face: neighbour offset and per corner [side1, side2, corner] offsets.
const FACE_N = [], FACE_AO = [];
for (const f of FACES) {
  FACE_N.push(off(...f.n));
  const corners = [];
  for (const [s, t] of CORNERS) {
    const su = s ? 1 : -1, sv = t ? 1 : -1;
    const a = [f.n[0] + su * f.u[0], f.n[1] + su * f.u[1], f.n[2] + su * f.u[2]];
    const b = [f.n[0] + sv * f.v[0], f.n[1] + sv * f.v[1], f.n[2] + sv * f.v[2]];
    const c = [f.n[0] + su * f.u[0] + sv * f.v[0], f.n[1] + su * f.u[1] + sv * f.v[1], f.n[2] + su * f.u[2] + sv * f.v[2]];
    corners.push([off(...a), off(...b), off(...c)]);
  }
  FACE_AO.push(corners);
}

const FOLIAGE_FIXED = { [B.BIRCH_LEAVES]: [128, 167, 85], [B.SPRUCE_LEAVES]: [97, 153, 97] };
// blocks tinted with the biome's foliage colour (leaves, vines)
const FOLIAGE_BIOME = new Uint8Array(BLOCK_LIMIT);
for (const d of BLOCKS) if (d && d.tint === 'foliage') FOLIAGE_BIOME[d.id] = 1;
const FURNACE_FRONT_DIR = [5, 0, 4, 1];
// FACING6 index (down, up, -z, +z, -x, +x) -> face index (+x, -x, +y, -y, +z, -z)
const FACING6_FACE = [3, 2, 5, 4, 1, 0, -1, -1];
// double chests: does the partner on the + side of the chest's axis sit at the viewer's right (front faces -z, +x, +z, -x)?
const CHEST_SEAM_RIGHT = [false, false, true, true];
const CHEST_FRONT_L = texId('chest_front_l'), CHEST_FRONT_R = texId('chest_front_r');
const NEST_HONEY = texId('nest_front_honey'), HIVE_HONEY = texId('hive_front_honey');
// crop textures per growth stage 0..7 (carrots have 4 visual stages)
const CROP_TILES = { [B.WHEAT]: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => texId('wheat_' + i)), [B.CARROTS]: [0, 0, 1, 1, 2, 2, 2, 3].map((i) => texId('carrots_' + i)),
  [B.MELON_STEM]: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => texId('stem_' + i)), [B.PUMPKIN_STEM]: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => texId('stem_' + i)),
  [B.POTATOES]: [0, 0, 1, 1, 2, 2, 2, 3].map((i) => texId('potatoes_' + i)), [B.BEETROOTS]: [0, 0, 1, 1, 2, 2, 2, 3].map((i) => texId('beetroots_' + i)),
  [B.CINDERROOT]: [0, 1, 2, 3, 3, 3, 3, 3].map((i) => texId('cinderroot_' + i)) };
const FARMLAND_MOIST = texId('farmland_moist');
const PROPAGULE_HANG_TILE = texId('mangrove_propagule_hanging');
const WATER_STILL = texId('water');
/** See-through blocks whose faces between neighbours of the same kind stay (mangrove roots). */
const LATTICE = new Uint8Array(BLOCK_LIMIT);
for (const d of BLOCKS) if (d && d.lattice) LATTICE[d.id] = 1;
const RAIL_CORNER = texId('rail_corner');
const PAINT_TILES = ARTS.map(([, w, h], art) => Array.from({ length: w * h }, (_, p) => texId(`painting_${art}_${p}`)));
const DOOR_LOWER = texId('door_lower'), DOOR_UPPER_TILE = texId('door_upper');
const DOOR_TILES = {};
for (const b of BLOCKS) if (b && b.doorTex) DOOR_TILES[b.id] = b.doorTex.map(texId);
const BED_TOPS = [0, 1, 2, 3].map((r) => [texId('bed_foot_top_' + r), texId('bed_head_top_' + r)]);
const BED_SIDE = texId('bed_side'), BED_BOTTOM = texId('oak_planks');
const WIRE_DOT = texId('cinnabar_wire_dot'), WIRE_LINE = texId('cinnabar_wire_line'), WIRE_HALF = texId('cinnabar_wire_half');
const tileOf = (name) => texId(name) ?? 0;
const COMPOST = texId('compost'), COMPOST_READY = texId('compost_ready');
const WICK = texId('candle_wick'), CANDLE_FLAME = texId('candle_flame');
// Grindstone and Stonecutter: their own tiles per box ([+x, -x, +y, -y, +z, -z]), by axis (meta bit 0)
const WS_TILES = (() => {
  const t = (...n) => n.map(tileOf), all = (n) => t(n, n, n, n, n, n);
  const r = 'grindstone_round', f = 'grindstone_face', leg = all('grindstone_leg'), piv = all('grindstone_pivot');
  const s = 'stonecutter_side', base = t(s, s, 'stonecutter_top', 'stonecutter_bottom', s, s), w = 'stonecutter_saw', o = 'stonecutter_blank';
  return {
    [B.GRINDSTONE]: [[t(f, f, r, r, r, r), leg, piv, leg, piv], [t(r, r, r, r, f, f), leg, piv, leg, piv]],
    [B.STONECUTTER]: [[base, t(o, o, o, o, w, w)], [base, t(w, w, o, o, o, o)]], // only the blade's flat faces show
    // Deep Hush sensors (tendrils light up while the sensor pulses) and shriekers (a jaw of bone on a mossy base)
    [B.HUSH_SENSOR]: [0, 1].map((on) => {
      const ss = 'hush_sensor_side', td = all(on ? 'hush_tendril_active' : 'hush_tendril');
      return [t(ss, ss, 'hush_sensor_top', 'hushmoss', ss, ss), td, td, td, td];
    }),
    [B.HUSH_SHRIEKER]: [0, 1].map(() => {
      const ss = 'hush_shrieker_side', bn = all('hush_shrieker_bone');
      return [t(ss, ss, 'hush_shrieker_top', 'hushmoss', ss, ss), bn, bn, bn, bn];
    }),
    // Lectern (index = has a book): base, post, the desk's two steps, then the open book
    [B.LECTERN]: [0, 1].map((book) => {
      const ls = 'lectern_side', desk = t(ls, ls, 'lectern_top', 'oak_planks', ls, ls);
      const parts = [t(ls, ls, 'lectern_base', 'oak_planks', ls, ls), all('lectern_post'), desk, desk];
      return book ? [...parts, t('lectern_book_side', 'lectern_book_side', 'lectern_book', 'lectern_book_side', 'lectern_book_side', 'lectern_book_side')] : parts;
    }),
    // Cake (index = bitten): the cut side shows the sponge inside
    [B.CAKE]: [0, 1].map((bitten) => [t('cake_side', bitten ? 'cake_inner' : 'cake_side', 'cake_top', 'cake_bottom', 'cake_side', 'cake_side')]),
  };
})();
/** Which set of WS_TILES a block uses for its meta. */
const wsIndex = (id, m) => (id === B.HUSH_SENSOR ? ((m & 15) ? 1 : 0) : id === B.LECTERN ? (m >> 2) & 1 : id === B.CAKE ? ((m & 7) ? 1 : 0) : m & 1);
const BERRY_TILES = [0, 1, 2, 3].map((i) => texId('sweet_berry_bush_' + i));
// Suspicious Sand and Gravel: one tile per brushing stage (meta bits 0-1, world/archaeology.js)
const SUS_TILES = { [B.SUSPICIOUS_SAND]: [0, 1, 2, 3].map((i) => texId('suspicious_sand_' + i)), [B.SUSPICIOUS_GRAVEL]: [0, 1, 2, 3].map((i) => texId('suspicious_gravel_' + i)) };
// Proving Spawners show their state on the sides (meta bits 4-5: waiting, active, cooling down; world/provingVaults.js)
const PROVING_SIDES = [0, 1, 2].map((i) => texId('proving_spawner_side_' + i));

class Buf {
  constructor(cap = 16384) { this.alloc(cap); this.n = 0; this.ni = 0; this.yBase = 0; }
  alloc(cap) {
    const old = this.pos ? this : null;
    this.cap = cap;
    const pos = new Float32Array(cap * 3), nrm = new Int8Array(cap * 3), uv = new Float32Array(cap * 2);
    const col = new Uint8Array(cap * 3), lit = new Uint16Array(cap * 4), idx = new Uint32Array(cap * 1.5);
    if (old) {
      pos.set(old.pos); nrm.set(old.nrm); uv.set(old.uv); col.set(old.col); lit.set(old.lit); idx.set(old.idx);
    }
    Object.assign(this, { pos, nrm, uv, col, lit, idx });
  }
  reset() { this.n = 0; this.ni = 0; }
  ensure(k) { if (this.n + k > this.cap) this.alloc(Math.max(this.cap * 2, this.n + k)); }
  vert(x, y, z, nx, ny, nz, u, v, r, g, b, sky, blk, ao, tile) {
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y + this.yBase; this.pos[i * 3 + 2] = z;
    this.nrm[i * 3] = nx * 127; this.nrm[i * 3 + 1] = ny * 127; this.nrm[i * 3 + 2] = nz * 127;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.lit[i * 4] = sky; this.lit[i * 4 + 1] = blk; this.lit[i * 4 + 2] = ao; this.lit[i * 4 + 3] = tile;
  }
  quad(flip) {
    const b = this.n - 4, j = this.ni;
    if (flip) { this.idx[j] = b + 1; this.idx[j + 1] = b + 2; this.idx[j + 2] = b + 3; this.idx[j + 3] = b + 1; this.idx[j + 4] = b + 3; this.idx[j + 5] = b; }
    else { this.idx[j] = b; this.idx[j + 1] = b + 1; this.idx[j + 2] = b + 2; this.idx[j + 3] = b; this.idx[j + 4] = b + 2; this.idx[j + 5] = b + 3; }
    this.ni += 6;
  }
  out() {
    if (!this.n) return null;
    return {
      pos: this.pos.slice(0, this.n * 3), nrm: this.nrm.slice(0, this.n * 3), uv: this.uv.slice(0, this.n * 2),
      col: this.col.slice(0, this.n * 3), lit: this.lit.slice(0, this.n * 4), idx: this.idx.slice(0, this.ni),
    };
  }
}

// wind: vertex 'ao' values carry a sway flag on top of the 0-3 occlusion (terrainMaterial.js decodes it)
const WAVE_LEAF = 4, WAVE_TOP = 8;
const UNDERWATER = 16; // a face under water: the shader plays caustics over it

const opaqueBuf = new Buf();
const cutoutBuf = new Buf(4096); // alpha-tested (leaves, plants, glass, torches)
const transBuf = new Buf(4096);

export function liquidHeight(meta) {
  const level = meta & 7;
  if (meta & 8) return 8 / 9;
  return (8 - level) / 9;
}

/**
 * @param {{blocks: Uint8Array, light: Uint8Array, meta: Uint8Array, colors: Uint8Array}} sec
 * colors: 256*6 bytes grass+foliage per column of the chunk.
 */
export function meshSection(sec) {
  const { blocks, light, meta, colors } = sec;
  const wb = sec.biomes; // per-column biome ids (water tint), when the caller passes them
  opaqueBuf.reset(); cutoutBuf.reset(); transBuf.reset();
  opaqueBuf.yBase = cutoutBuf.yBase = transBuf.yBase = sec.yBase || 0;
  const ao = [0, 0, 0, 0], sk = [0, 0, 0, 0], bl = [0, 0, 0, 0];
  for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const i = pidx(x, y, z);
    const id = blocks[i];
    if (!id) continue;
    const shape = SHAPES[id];
    if (WATERLOGGED[id] || id === B.WATER || id === B.LAVA) WT = wb && id !== B.LAVA ? waterTint(wb[x + z * 16]) : NO_TINT;
    if (WATERLOGGED[id]) waterloggedTop(blocks, light, i, x, y, z); // the water's surface over roots standing in it
    const buf = LAYERS[id] === LAYER.TRANSLUCENT ? transBuf : LAYERS[id] === LAYER.CUTOUT ? cutoutBuf : opaqueBuf;
    const ci = (x + z * 16) * 6;
    if (shape === SHAPE.CUBE) {
      const leafWave = LEAVES.has(id) ? WAVE_LEAF : 0;
      const translucent = !OPAQUE[id];
      for (let d = 0; d < 6; d++) {
        const ni = i + FACE_N[d];
        const nb = blocks[ni];
        if (OPAQUE[nb]) continue;
        if (translucent && nb === id && !LEAVES.has(id) && !LATTICE[id]) continue;
        // smooth light + AO
        const corners = FACE_AO[d];
        const fl = light[ni];
        for (let k = 0; k < 4; k++) {
          const [a, b, c] = corners[k];
          const oa = OPAQUE[blocks[i + a]], ob = OPAQUE[blocks[i + b]];
          const oc = (oa && ob) ? 1 : OPAQUE[blocks[i + c]];
          ao[k] = (oa && ob) ? 3 : oa + ob + oc;
          let s = fl >> 4, bb = fl & 15, cnt = 1;
          if (!oa) { const l = light[i + a]; s += l >> 4; bb += l & 15; cnt++; }
          if (!ob) { const l = light[i + b]; s += l >> 4; bb += l & 15; cnt++; }
          if (!oc) { const l = light[i + c]; s += l >> 4; bb += l & 15; cnt++; }
          sk[k] = Math.round(s * 17 / cnt); bl[k] = Math.round(bb * 17 / cnt);
        }
        let tile = FACE_TILE[id * 6 + d];
        if (id === B.FURNACE || id === B.FURNACE_LIT) {
          if (d === FURNACE_FRONT_DIR[meta[i] & 3]) tile = texId(id === B.FURNACE ? 'furnace_front' : 'furnace_front_lit');
          else if (d !== 2 && d !== 3) tile = texId('furnace_side');
        } else if (id === B.DISPENSER || id === B.DROPPER) {
          if (d === FACING6_FACE[meta[i] & 7]) tile = FRONT_TILE[id]; // the face points along FACING6 (up and down too)
        } else if (FRONT_TILE[id] >= 0 && d === FURNACE_FRONT_DIR[meta[i] & 3]) {
          tile = FRONT_TILE[id];
          if (id === B.CHEST && (meta[i] & 4)) tile = CHEST_SEAM_RIGHT[meta[i] & 3] === !!(meta[i] & 128) ? CHEST_FRONT_R : CHEST_FRONT_L;
          else if ((id === B.BEE_NEST || id === B.BEEHIVE) && ((meta[i] >> 2) & 7) >= 5) tile = id === B.BEE_NEST ? NEST_HONEY : HIVE_HONEY; // dripping with honey
        }
        else if (id === B.FARMLAND && d === 2 && meta[i] > 0) tile = FARMLAND_MOIST;
        else if (SUS_TILES[id]) tile = SUS_TILES[id][meta[i] & 3];
        else if (id === B.PROVING_SPAWNER && d !== 2 && d !== 3) tile = PROVING_SIDES[((meta[i] >> 4) & 3) % 3];
        let r = 255, g = 255, b2 = 255;
        if ((id === B.GRASS && d === 2)) { r = colors[ci]; g = colors[ci + 1]; b2 = colors[ci + 2]; }
        else if (FOLIAGE_BIOME[id]) { r = colors[ci + 3]; g = colors[ci + 4]; b2 = colors[ci + 5]; }
        else if (FOLIAGE_FIXED[id]) [r, g, b2] = FOLIAGE_FIXED[id];
        else if (id === B.WOOL && meta[i]) [r, g, b2] = WOOL_RGB[meta[i] & 15];
        const f = FACES[d];
        buf.ensure(4);
        for (let k = 0; k < 4; k++) {
          const [s, t] = CORNERS[k];
          buf.vert(
            x + f.o[0] + s * f.u[0] + t * f.v[0], y + f.o[1] + s * f.u[1] + t * f.v[1], z + f.o[2] + s * f.u[2] + t * f.v[2],
            f.n[0], f.n[1], f.n[2], s, 1 - t, r, g, b2, sk[k], bl[k], ao[k] + leafWave + (nb === B.WATER ? UNDERWATER : 0), tile);
        }
        buf.quad(ao[0] + ao[2] > ao[1] + ao[3]);
      }
    } else if (shape === SHAPE.LIQUID) {
      meshLiquid(buf, blocks, light, meta, i, id, x, y, z);
    } else if (shape === SHAPE.CROSS) {
      const l = light[i];
      const tile = id === B.SWEET_BERRY_BUSH ? BERRY_TILES[meta[i] & 3] : id === B.MANGROVE_PROPAGULE && (meta[i] & PROPAGULE_HANGING) ? PROPAGULE_HANG_TILE : FACE_TILE[id * 6 + 2];
      let r = 255, g = 255, b2 = 255;
      if (id === B.TALL_GRASS) { r = colors[ci]; g = colors[ci + 1]; b2 = colors[ci + 2]; }
      const sky = (l >> 4) * 17, blk = (l & 15) * 17;
      const a = 0.15, c = 0.85;
      const quads = [[x + a, z + a, x + c, z + c], [x + a, z + c, x + c, z + a]];
      buf.ensure(16);
      for (const [x1, z1, x2, z2] of quads) {
        for (let side = 0; side < 2; side++) {
          buf.vert(x1, y, z1, 0, 1, 0, 0, 1, r, g, b2, sky, blk, 0, tile);
          buf.vert(x2, y, z2, 0, 1, 0, 1, 1, r, g, b2, sky, blk, 0, tile);
          buf.vert(x2, y + 1, z2, 0, 1, 0, 1, 0, r, g, b2, sky, blk, WAVE_TOP, tile);
          buf.vert(x1, y + 1, z1, 0, 1, 0, 0, 0, r, g, b2, sky, blk, WAVE_TOP, tile);
          buf.quad(false);
          if (side === 0) {
            // reverse winding for the back side
            const n = buf.n;
            for (let k = 0; k < 2; k++) {
              swapVert(buf, n - 4 + k, n - 1 - k);
            }
          }
        }
      }
    } else if (shape === SHAPE.FIRE) {
      // two crossed planes plus four planes along the edges leaning inwards, both sides, full bright
      const l = light[i], tile = FACE_TILE[id * 6 + 2];
      const sky = (l >> 4) * 17, blk = 255, h = 1.3;
      const planes = [
        [x, z, x + 1, z + 1, 0, 0], [x, z + 1, x + 1, z, 0, 0],
        [x + 0.05, z, x + 0.05, z + 1, 0.25, 0], [x + 0.95, z, x + 0.95, z + 1, -0.25, 0],
        [x, z + 0.05, x + 1, z + 0.05, 0, 0.25], [x, z + 0.95, x + 1, z + 0.95, 0, -0.25],
      ];
      buf.ensure(48);
      for (const [x1, z1, x2, z2, lx, lz] of planes) {
        for (let side = 0; side < 2; side++) {
          buf.vert(x1, y, z1, 0, 1, 0, 0, 1, 255, 255, 255, sky, blk, 0, tile);
          buf.vert(x2, y, z2, 0, 1, 0, 1, 1, 255, 255, 255, sky, blk, 0, tile);
          buf.vert(x2 + lx, y + h, z2 + lz, 0, 1, 0, 1, 0, 255, 255, 255, sky, blk, 0, tile);
          buf.vert(x1 + lx, y + h, z1 + lz, 0, 1, 0, 0, 0, 255, 255, 255, sky, blk, 0, tile);
          buf.quad(false);
          if (side === 0) { const n = buf.n; for (let k = 0; k < 2; k++) swapVert(buf, n - 4 + k, n - 1 - k); }
        }
      }
    } else if (shape === SHAPE.CROP) {
      // four planes in a # pattern, both sides
      const l = light[i];
      const tile = CROP_TILES[id][meta[i] & 7];
      const sky = (l >> 4) * 17, blk = (l & 15) * 17;
      const quads = [[x + 0.25, z, x + 0.25, z + 1], [x + 0.75, z, x + 0.75, z + 1], [x, z + 0.25, x + 1, z + 0.25], [x, z + 0.75, x + 1, z + 0.75]];
      buf.ensure(32);
      for (const [x1, z1, x2, z2] of quads) {
        for (let side = 0; side < 2; side++) {
          buf.vert(x1, y, z1, 0, 1, 0, 0, 1, 255, 255, 255, sky, blk, 0, tile);
          buf.vert(x2, y, z2, 0, 1, 0, 1, 1, 255, 255, 255, sky, blk, 0, tile);
          buf.vert(x2, y + 1, z2, 0, 1, 0, 1, 0, 255, 255, 255, sky, blk, 0, tile);
          buf.vert(x1, y + 1, z1, 0, 1, 0, 0, 0, 255, 255, 255, sky, blk, 0, tile);
          buf.quad(false);
          if (side === 0) { const n = buf.n; for (let k = 0; k < 2; k++) swapVert(buf, n - 4 + k, n - 1 - k); }
        }
      }
    } else if (shape === SHAPE.PAD) {
      // a flat pad resting on the water surface, visible from both sides
      const l = light[i], tile = FACE_TILE[id * 6 + 2];
      const sky = (l >> 4) * 17, blk = (l & 15) * 17, yy = y + 1 / 64;
      buf.ensure(8);
      buf.vert(x, yy, z + 1, 0, 1, 0, 0, 1, 255, 255, 255, sky, blk, 0, tile);
      buf.vert(x + 1, yy, z + 1, 0, 1, 0, 1, 1, 255, 255, 255, sky, blk, 0, tile);
      buf.vert(x + 1, yy, z, 0, 1, 0, 1, 0, 255, 255, 255, sky, blk, 0, tile);
      buf.vert(x, yy, z, 0, 1, 0, 0, 0, 255, 255, 255, sky, blk, 0, tile);
      buf.quad(false);
      buf.vert(x, yy, z, 0, -1, 0, 0, 0, 255, 255, 255, sky, blk, 0, tile);
      buf.vert(x + 1, yy, z, 0, -1, 0, 1, 0, 255, 255, 255, sky, blk, 0, tile);
      buf.vert(x + 1, yy, z + 1, 0, -1, 0, 1, 1, 255, 255, 255, sky, blk, 0, tile);
      buf.vert(x, yy, z + 1, 0, -1, 0, 0, 1, 255, 255, 255, sky, blk, 0, tile);
      buf.quad(false);
    } else if (shape === SHAPE.TORCH) {
      const l = light[i], m = meta[i];
      if (!m) emitBox(buf, x, y, z, 7 / 16, 0, 7 / 16, 9 / 16, 10 / 16, 9 / 16, FACE_TILE[id * 6], (l >> 4) * 17, (l & 15) * 17);
      else {
        // wall torch: base against the wall, leaning 22.5 degrees away from it
        const [dx, , dz] = SIDE_DIRS[(m - 1) & 3];
        const cx = 0.5 + dx * 0.36, cz = 0.5 + dz * 0.36, y0 = 3.5 / 16;
        const n0 = buf.n;
        emitBox(buf, x, y, z, cx - 1 / 16, y0, cz - 1 / 16, cx + 1 / 16, y0 + 10 / 16, cz + 1 / 16, FACE_TILE[id * 6], (l >> 4) * 17, (l & 15) * 17);
        for (let v = n0; v < buf.n; v++) {
          const h = buf.pos[v * 3 + 1] - buf.yBase - y - y0;
          buf.pos[v * 3] -= dx * h * 0.41; buf.pos[v * 3 + 2] -= dz * h * 0.41;
        }
      }
    } else if (shape === SHAPE.PAINTING) {
      // a thin board against the wall with the picture's part on its front
      const l = light[i], m = meta[i], side = m & 3, [dx, , dz] = SIDE_DIRS[side];
      const sky = (l >> 4) * 17, blk = (l & 15) * 17, T = 1 / 16;
      const bx0 = dx > 0 ? 1 - T : 0, bx1 = dx < 0 ? T : 1, bz0 = dz > 0 ? 1 - T : 0, bz1 = dz < 0 ? T : 1;
      emitBox(buf, x, y, z, dx ? bx0 : 0, 0, dz ? bz0 : 0, dx ? bx1 : 1, 1, dz ? bz1 : 1, FACE_TILE[id * 6 + 2], sky, blk, 'box');
      const art = artOf(id, m), tile = PAINT_TILES[art][partOf(m)];
      const rx = -dz, rz = dx, cxp = x + 0.5 + dx * (0.5 - T - 0.002), czp = z + 0.5 + dz * (0.5 - T - 0.002);
      buf.ensure(4);
      buf.vert(cxp - rx * 0.5, y, czp - rz * 0.5, -dx, 0, -dz, 0, 1, 255, 255, 255, sky, blk, 0, tile);
      buf.vert(cxp + rx * 0.5, y, czp + rz * 0.5, -dx, 0, -dz, 1, 1, 255, 255, 255, sky, blk, 0, tile);
      buf.vert(cxp + rx * 0.5, y + 1, czp + rz * 0.5, -dx, 0, -dz, 1, 0, 255, 255, 255, sky, blk, 0, tile);
      buf.vert(cxp - rx * 0.5, y + 1, czp - rz * 0.5, -dx, 0, -dz, 0, 0, 255, 255, 255, sky, blk, 0, tile);
      buf.quad(false);
    } else if (shape === SHAPE.RAIL) {
      // one textured quad on the floor (sloped for ascending rails), rotated to the rail's shape
      const l = light[i], m = meta[i] % 10, sky = (l >> 4) * 17, blk = (l & 15) * 17;
      const tile = m >= 6 ? RAIL_CORNER : FACE_TILE[id * 6 + 2];
      const rot = m >= 6 ? m - 6 : (m === 1 || m === 2 || m === 3) ? 1 : 0;
      const cx = [0, 1, 1, 0], cz = [0, 0, 1, 1], bu = [0, 1, 1, 0], bv = [0, 0, 1, 1];
      buf.ensure(4);
      for (let k = 3; k >= 0; k--) { // counter-clockwise seen from above
        const j = (k - rot + 4) & 3;
        buf.vert(x + cx[k], y + railHeight(m, cx[k], cz[k]), z + cz[k], 0, 1, 0, bu[j], bv[j], 255, 255, 255, sky, blk, 0, tile);
      }
      buf.quad(false);
    } else if (shape === SHAPE.WALL || shape === SHAPE.TRAPDOOR) {
      const l = light[i], tile = FACE_TILE[id * 6 + 2];
      let boxes;
      if (shape === SHAPE.WALL) {
        let mask = 0;
        for (let s = 0; s < 4; s++) if (wallConnects(blocks[i + SIDE_DIRS[s][0] + SIDE_DIRS[s][2] * PAD])) mask |= 1 << s;
        boxes = wallBoxes(mask);
      } else boxes = [trapdoorBox(meta[i])];
      for (const b of boxes) emitBox(buf, x, y, z, b[0], b[1], b[2], b[3], b[4], b[5], tile, (l >> 4) * 17, (l & 15) * 17, 'box');
    } else if (shape === SHAPE.SNOW) {
      // a slab of snow; sides hidden by neighbouring snow of at least the same height are skipped by emitBox order cost only
      const l = light[i], b = snowBox(meta[i]);
      emitBox(buf, x, y, z, b[0], b[1], b[2], b[3], b[4], b[5], FACE_TILE[id * 6 + 2], (l >> 4) * 17, (l & 15) * 17, 'box');
    } else if (shape === SHAPE.BOXES) {
      // enchanting table / anvil: fixed boxes, lit by the brightest neighbour
      let sk = 0, bk = 0;
      for (let d = 0; d < 6; d++) { const l = light[i + FACE_N[d]]; sk = Math.max(sk, l >> 4); bk = Math.max(bk, l & 15); }
      const tiles = [0, 1, 2, 3, 4, 5].map((d) => FACE_TILE[id * 6 + d]);
      if (FRONT_TILE[id] >= 0) tiles[FURNACE_FRONT_DIR[meta[i] & 3]] = FRONT_TILE[id]; // the Wyrm Head's face
      const ws = WS_TILES[id] && WS_TILES[id][wsIndex(id, meta[i])];
      blockBoxes(id, meta[i]).forEach((b, k) => emitBox(buf, x, y, z, b[0], b[1], b[2], b[3], b[4], b[5], ws ? ws[k] : tiles, sk * 17, bk * 17, 'box'));
      const cb = id === B.COMPOSTER && compostBox(meta[i] & 15);
      if (cb) emitBox(buf, x, y, z, cb[0], cb[1], cb[2], cb[3], cb[4], cb[5], (meta[i] & 15) >= 8 ? COMPOST_READY : COMPOST, sk * 17, bk * 17, 'box');
      const cdl = CANDLES.get(id);
      if (cdl) for (const [cx, cz, h] of CANDLE_SPOTS[meta[i] & 3]) {
        // a wick on each candle, and a little flame (full bright) on lit ones
        emitBox(buf, x, y, z, (cx + 0.75) / 16, h / 16, (cz + 0.75) / 16, (cx + 1.25) / 16, (h + 1) / 16, (cz + 1.25) / 16, WICK, sk * 17, bk * 17, 'box');
        if (id === cdl.lit) emitBox(buf, x, y, z, (cx + 0.5) / 16, (h + 1) / 16, (cz + 0.5) / 16, (cx + 1.5) / 16, (h + 2.5) / 16, (cz + 1.5) / 16, CANDLE_FLAME, sk * 17, 255, 'box');
      }
      const potted = id === B.FLOWER_POT && meta[i] ? POTTED[meta[i] - 1] : 0;
      if (potted === B.CACTUS) emitBox(buf, x, y, z, 6 / 16, 6 / 16, 6 / 16, 10 / 16, 1, 10 / 16, FACE_TILE[B.CACTUS * 6 + 2], sk * 17, bk * 17, 'box');
      else if (potted) {
        // the plant in the pot: two crossed planes standing on the soil
        const tile = FACE_TILE[potted * 6 + 2], sky = sk * 17, blk = bk * 17, h = 0.75, y0 = y + 6 / 16;
        buf.ensure(16);
        for (const [x1, z1, x2, z2] of [[x + 0.2, z + 0.2, x + 0.8, z + 0.8], [x + 0.2, z + 0.8, x + 0.8, z + 0.2]]) {
          for (let side = 0; side < 2; side++) {
            buf.vert(x1, y0, z1, 0, 1, 0, 0, 1, 255, 255, 255, sky, blk, 0, tile);
            buf.vert(x2, y0, z2, 0, 1, 0, 1, 1, 255, 255, 255, sky, blk, 0, tile);
            buf.vert(x2, y0 + h, z2, 0, 1, 0, 1, 0, 255, 255, 255, sky, blk, 0, tile);
            buf.vert(x1, y0 + h, z1, 0, 1, 0, 0, 0, 255, 255, 255, sky, blk, 0, tile);
            buf.quad(false);
            if (side === 0) { const n = buf.n; for (let k = 0; k < 2; k++) swapVert(buf, n - 4 + k, n - 1 - k); }
          }
        }
      }
      if (id === B.CAMPFIRE) {
        // the flames: two crossed planes of animated fire, full bright
        const tile = FACE_TILE[B.FIRE * 6 + 2], sky = sk * 17, h = 0.9, y0 = y + 0.1;
        buf.ensure(16);
        for (const [x1, z1, x2, z2] of [[x + 0.15, z + 0.15, x + 0.85, z + 0.85], [x + 0.15, z + 0.85, x + 0.85, z + 0.15]]) {
          for (let side = 0; side < 2; side++) {
            buf.vert(x1, y0, z1, 0, 1, 0, 0, 1, 255, 255, 255, sky, 255, 0, tile);
            buf.vert(x2, y0, z2, 0, 1, 0, 1, 1, 255, 255, 255, sky, 255, 0, tile);
            buf.vert(x2, y0 + h, z2, 0, 1, 0, 1, 0, 255, 255, 255, sky, 255, 0, tile);
            buf.vert(x1, y0 + h, z1, 0, 1, 0, 0, 0, 255, 255, 255, sky, 255, 0, tile);
            buf.quad(false);
            if (side === 0) { const n = buf.n; for (let k = 0; k < 2; k++) swapVert(buf, n - 4 + k, n - 1 - k); }
          }
        }
      }
    } else if (shape === SHAPE.SLAB || shape === SHAPE.STAIRS) {
      // light-blocking partial blocks: shade with the brightest neighbouring light
      let sk = 0, bk = 0;
      for (let d = 0; d < 6; d++) { const l = light[i + FACE_N[d]]; sk = Math.max(sk, l >> 4); bk = Math.max(bk, l & 15); }
      const tiles = [0, 1, 2, 3, 4, 5].map((d) => FACE_TILE[id * 6 + d]);
      const boxes = shape === SHAPE.SLAB ? [slabBox(meta[i])] : stairBoxes(meta[i], (dx, dz) => [blocks[i + dx + dz * PAD], meta[i + dx + dz * PAD]], (n) => SHAPES[n] === SHAPE.STAIRS);
      for (const b of boxes) emitBox(buf, x, y, z, b[0], b[1], b[2], b[3], b[4], b[5], tiles, sk * 17, bk * 17, 'box');
    } else if (shape === SHAPE.FENCE || shape === SHAPE.GATE) {
      const l = light[i], tile = FACE_TILE[id * 6 + 2];
      let boxes;
      if (shape === SHAPE.FENCE) {
        let mask = 0;
        for (let s = 0; s < 4; s++) if (fenceConnects(blocks[i + SIDE_DIRS[s][0] + SIDE_DIRS[s][2] * PAD])) mask |= 1 << s;
        boxes = fenceRenderBoxes(mask);
      } else boxes = gateRenderBoxes(meta[i]);
      for (const b of boxes) emitBox(buf, x, y, z, b[0], b[1], b[2], b[3], b[4], b[5], tile, (l >> 4) * 17, (l & 15) * 17, 'box');
    } else if (shape === SHAPE.PANE) {
      const l = light[i], tile = FACE_TILE[id * 6 + 2];
      let mask = 0;
      for (let s = 0; s < 4; s++) if (paneConnects(blocks[i + SIDE_DIRS[s][0] + SIDE_DIRS[s][2] * PAD])) mask |= 1 << s;
      for (const b of paneBoxes(mask)) emitBox(buf, x, y, z, b[0], b[1], b[2], b[3], b[4], b[5], tile, (l >> 4) * 17, (l & 15) * 17, 'box');
    } else if (shape === SHAPE.BED) {
      const l = light[i], m = meta[i], top = BED_TOPS[m & 3][m & BED_HEAD ? 1 : 0];
      emitBox(buf, x, y, z, ...BED_BOX, [BED_SIDE, BED_SIDE, top, BED_BOTTOM, BED_SIDE, BED_SIDE], (l >> 4) * 17, (l & 15) * 17, 'box');
    } else if (shape === SHAPE.DOOR) {
      const l = light[i], b = doorBox(meta[i]);
      const dt = DOOR_TILES[id] || [DOOR_LOWER, DOOR_UPPER_TILE];
      emitBox(buf, x, y, z, b[0], b[1], b[2], b[3], b[4], b[5], meta[i] & DOOR_UPPER ? dt[1] : dt[0], (l >> 4) * 17, (l & 15) * 17, 'box');
    } else if (shape === SHAPE.LADDER) {
      // a thin panel just off the wall (both faces textured)
      const l = light[i], b = ladderBox(meta[i]);
      const s = meta[i] & 3, a = s === 1 || s === 3 ? 0 : 2; // axis of the wall normal
      const atWall = s === 1 || s === 2 ? 1 : 0, off = atWall ? -1 / 16 : 1 / 16;
      b[a] = atWall + off - 0.005; b[a + 3] = atWall + off + 0.005;
      emitBox(buf, x, y, z, b[0], b[1], b[2], b[3], b[4], b[5], FACE_TILE[id * 6], (l >> 4) * 17, (l & 15) * 17, 'box', FOLIAGE_BIOME[id] ? [colors[ci + 3], colors[ci + 4], colors[ci + 5]] : null);
    } else if (shape === SHAPE.CRYSTAL) {
      // Violite buds and Seepstone spikes: two crossed sprites standing on the face they grow from
      const l = light[i], m = meta[i], facing = m & 7;
      const tile = tileOf(crystalTex(id, m)), sky = (l >> 4) * 17, blk = (l & 15) * 17;
      const a = 0.12, c = 0.88;
      buf.ensure(16);
      for (const [x1, z1, x2, z2] of [[a, a, c, c], [a, c, c, a]]) {
        for (let side = 0; side < 2; side++) {
          for (const [px, py, pz, u, v] of [[x1, 0, z1, 0, 1], [x2, 0, z2, 1, 1], [x2, 1, z2, 1, 0], [x1, 1, z1, 0, 0]]) {
            const q = orientPoint(px, py, pz, facing);
            buf.vert(x + q[0], y + q[1], z + q[2], 0, 1, 0, u, v, 255, 255, 255, sky, blk, 0, tile);
          }
          buf.quad(false);
          if (side === 0) { const n = buf.n; for (let k = 0; k < 2; k++) swapVert(buf, n - 4 + k, n - 1 - k); }
        }
      }
    } else if (shape === SHAPE.WIRE) {
      meshWire(buf, blocks, light, meta, i, x, y, z);
    } else if (shape === SHAPE.CIRCUIT) {
      // levers, buttons, plates, repeaters, pistons: boxes turned into place, lit by the brightest neighbour
      let sk = 0, bk = 0;
      for (let d = 0; d < 6; d++) { const l = light[i + FACE_N[d]]; sk = Math.max(sk, l >> 4); bk = Math.max(bk, l & 15); }
      for (const p of circuitParts(id, meta[i])) {
        const tile = typeof p.tile === 'string' ? tileOf(p.tile) : p.tile.map(tileOf);
        const n0 = buf.n;
        emitBox(buf, x, y, z, p.box[0], p.box[1], p.box[2], p.box[3], p.box[4], p.box[5], tile, sk * 17, (p.lit ? Math.max(bk, 9) : bk) * 17, p.uv);
        transformVerts(buf, n0, x, y, z, p);
      }
    } else if (shape === SHAPE.CACTUS) {
      const l = light[i];
      const sky = (l >> 4) * 17, blk = (l & 15) * 17;
      for (let d = 0; d < 6; d++) {
        const nb = blocks[i + FACE_N[d]];
        if ((d === 2 || d === 3) && (OPAQUE[nb] || nb === B.CACTUS)) continue;
        const f = FACES[d];
        const inset = (d === 2 || d === 3) ? 0 : 1 / 16;
        buf.ensure(4);
        for (let k = 0; k < 4; k++) {
          const [s, t] = CORNERS[k];
          buf.vert(
            x + f.o[0] + s * f.u[0] + t * f.v[0] - f.n[0] * inset,
            y + f.o[1] + s * f.u[1] + t * f.v[1],
            z + f.o[2] + s * f.u[2] + t * f.v[2] - f.n[2] * inset,
            f.n[0], f.n[1], f.n[2], s, 1 - t, 255, 255, 255, sky, blk, 0, FACE_TILE[id * 6 + d]);
        }
        buf.quad(false);
      }
    }
  }
  return { opaque: opaqueBuf.out(), cutout: cutoutBuf.out(), trans: transBuf.out() };
}

/** Move vertices n0.. of a part emitted at the block's origin to their place (circuitShapes.partPoint). */
function transformVerts(buf, n0, x, y, z, part) {
  if (!part.tilt && !part.off && !part.yaw && (part.facing ?? 1) === 1) return;
  for (let v = n0; v < buf.n; v++) {
    const px = buf.pos[v * 3] - x, py = buf.pos[v * 3 + 1] - buf.yBase - y, pz = buf.pos[v * 3 + 2] - z;
    const q = partPoint(part, px, py, pz);
    buf.pos[v * 3] = x + q[0]; buf.pos[v * 3 + 1] = y + q[1] + buf.yBase; buf.pos[v * 3 + 2] = z + q[2];
    const n = partPoint(part, buf.nrm[v * 3] / 127, buf.nrm[v * 3 + 1] / 127, buf.nrm[v * 3 + 2] / 127, true);
    buf.nrm[v * 3] = Math.round(n[0] * 127); buf.nrm[v * 3 + 1] = Math.round(n[1] * 127); buf.nrm[v * 3 + 2] = Math.round(n[2] * 127);
  }
}

/**
 * Cinnabar wire: flat quads on the floor (a dot, straight lines, or a dot with
 * an arm per connection) plus a line up the side of a block where it climbs,
 * tinted from dark to bright red by its power level.
 */
function meshWire(buf, blocks, light, meta, i, x, y, z) {
  const lvl = meta[i] & 15;
  const mask = wireMask((a, b, c) => blocks[pidx(a, b, c)], (a, b, c) => meta[pidx(a, b, c)], x, y, z);
  const [r, g, b] = wireColor(lvl);
  const l = light[i], sky = (l >> 4) * 17, blk = Math.max(l & 15, Math.round(lvl * 0.6)) * 17;
  const conn = mask & 15;
  // flat quad rotated by `rot` quarter turns (texture "up" = -z), raised a hair to avoid z-fighting
  const flat = (tile, rot, lift) => {
    const cx = [0, 1, 1, 0], cz = [0, 0, 1, 1], bu = [0, 1, 1, 0], bv = [0, 0, 1, 1], yy = y + 1 / 64 + lift;
    buf.ensure(4);
    for (let k = 3; k >= 0; k--) {
      const j = (k - rot + 4) & 3;
      buf.vert(x + cx[k], yy, z + cz[k], 0, 1, 0, bu[j], bv[j], r, g, b, sky, blk, 0, tile);
    }
    buf.quad(false);
  };
  if (conn === 5 || conn === 10 || conn === 1 || conn === 4 || conn === 2 || conn === 8) flat(WIRE_LINE, conn & 10 ? 1 : 0, 0);
  else {
    flat(WIRE_DOT, 0, 0);
    // half lines: the texture runs from the centre to the top edge (-z); rot turns it to side s
    for (let s = 0; s < 4; s++) if (conn & (1 << s)) flat(WIRE_HALF, s, (s + 1) / 512);
  }
  // climbing: a line up the face of the neighbouring block
  for (let s = 0; s < 4; s++) {
    if (!(mask & (16 << s))) continue;
    const [dx, , dz] = SIDE_DIRS[s];
    const e = 1 / 64, px = dx > 0 ? x + 1 - e : dx < 0 ? x + e : null, pz = dz > 0 ? z + 1 - e : dz < 0 ? z + e : null;
    const pts = px !== null ? [[px, z], [px, z + 1]] : [[x, pz], [x + 1, pz]];
    buf.ensure(8);
    for (let side = 0; side < 2; side++) {
      buf.vert(pts[0][0], y, pts[0][1], -dx, 0, -dz, 0, 1, r, g, b, sky, blk, 0, WIRE_LINE);
      buf.vert(pts[1][0], y, pts[1][1], -dx, 0, -dz, 1, 1, r, g, b, sky, blk, 0, WIRE_LINE);
      buf.vert(pts[1][0], y + 1, pts[1][1], -dx, 0, -dz, 1, 0, r, g, b, sky, blk, 0, WIRE_LINE);
      buf.vert(pts[0][0], y + 1, pts[0][1], -dx, 0, -dz, 0, 0, r, g, b, sky, blk, 0, WIRE_LINE);
      buf.quad(false);
      if (side === 0) { const n = buf.n; for (let k = 0; k < 2; k++) swapVert(buf, n - 4 + k, n - 1 - k); }
    }
  }
}

function swapVert(buf, a, b) {
  const sw = (arr, n) => { for (let k = 0; k < n; k++) { const t = arr[a * n + k]; arr[a * n + k] = arr[b * n + k]; arr[b * n + k] = t; } };
  sw(buf.pos, 3); sw(buf.uv, 2); sw(buf.col, 3); sw(buf.lit, 4);
}

/** Axis-aligned box; uvMode 'torch' maps the top to the torch tip, 'box' maps every face to its sub-rectangle. */
function emitBox(buf, x, y, z, x0, y0, z0, x1, y1, z1, tile, sky, blk, uvMode = 'torch', rgb = null) {
  const cr = rgb ? rgb[0] : 255, cg = rgb ? rgb[1] : 255, cb = rgb ? rgb[2] : 255;
  const mn = [x0, y0, z0], mx = [x1, y1, z1];
  for (let d = 0; d < 6; d++) {
    const f = FACES[d];
    buf.ensure(4);
    for (let k = 0; k < 4; k++) {
      const [s, t] = CORNERS[k];
      const p = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        const unit = f.o[a] + s * f.u[a] + t * f.v[a]; // 0..1
        p[a] = unit > 0.5 ? mx[a] : mn[a];
      }
      // texture coordinates sample the matching sub-rectangle of the tile
      let u, v;
      if (d === 2 || d === 3) { u = p[0]; v = 1 - p[2] - (d === 2 ? 0.25 : 0); }
      else if (d === 0 || d === 1) { u = p[2]; v = 1 - p[1]; }
      else { u = p[0]; v = 1 - p[1]; }
      if (d === 2 && uvMode === 'torch') { u = 7 / 16 + s * 2 / 16; v = 6 / 16 + t * 2 / 16; }
      else if ((d === 2 || d === 3) && uvMode === 'box') { u = p[0]; v = p[2]; }
      buf.vert(x + p[0], y + p[1], z + p[2], f.n[0], f.n[1], f.n[2], u, v, cr, cg, cb, sky, blk, 0, typeof tile === 'number' ? tile : tile[d]);
    }
    buf.quad(false);
  }
}

/**
 * Height of a liquid surface corner (cx, cz in 0..1 of block i), as in the
 * reference renderer: the average over the four columns that share the
 * corner, sources weighted ten times; liquid above any of them fills the
 * corner, open air pulls it down, solid blocks don't count.
 */
function cornerHeight(blocks, meta, i, id, cx, cz) {
  let sum = 0, w = 0;
  for (let dx = cx - 1; dx <= cx; dx++) for (let dz = cz - 1; dz <= cz; dz++) {
    const j = i + off(dx, 0, dz);
    if (blocks[j + UP] === id || (id === B.WATER && WATERLOGGED[blocks[j + UP]])) return 1;
    const b = blocks[j];
    if (id === B.WATER && WATERLOGGED[b]) { sum += 8 / 9 * 10; w += 10; continue; } // kelp stands in still water
    if (b === id) {
      const m = meta[j], hh = liquidHeight(m), wt = (m & 7) === 0 && !(m & 8) ? 10 : 1;
      sum += hh * wt; w += wt;
    } else if (!SOLID[b]) w += 1;
  }
  return w ? sum / w : 1;
}
const UP = off(0, 1, 0);

/** Still water's surface over a waterlogged block (mangrove roots, propagules) open to the air above. */
// water colour of the column being meshed (rivers tint their water, see biomes.js)
const NO_TINT = [255, 255, 255];
let WT = NO_TINT;

function waterloggedTop(blocks, light, i, x, y, z) {
  const above = blocks[i + UP];
  if (above === B.WATER || WATERLOGGED[above] || OPAQUE[above]) return;
  const l = light[i + UP] || light[i], sky = (l >> 4) * 17, blk = (l & 15) * 17, yy = y + 8 / 9;
  transBuf.ensure(8);
  const c = [[0, 1], [1, 1], [1, 0], [0, 0]];
  for (const [vx, vz] of c) transBuf.vert(x + vx, yy, z + vz, 0, 1, 0, vx, 1 - vz, WT[0], WT[1], WT[2], sky, blk, 0, WATER_STILL);
  transBuf.quad(false);
  for (let k = 3; k >= 0; k--) { const [vx, vz] = c[k]; transBuf.vert(x + vx, yy, z + vz, 0, -1, 0, vx, 1 - vz, WT[0], WT[1], WT[2], sky, blk, 0, WATER_STILL); }
  transBuf.quad(false);
}

function meshLiquid(buf, blocks, light, meta, i, id, x, y, z) {
  const above = blocks[i + FACE_N[2]];
  const full = above === id || (id === B.WATER && WATERLOGGED[above] === 1);
  // surface heights at the corners (x, z): 00, 10, 11, 01
  const ch = full ? [1, 1, 1, 1] : [cornerHeight(blocks, meta, i, id, 0, 0), cornerHeight(blocks, meta, i, id, 1, 0), cornerHeight(blocks, meta, i, id, 1, 1), cornerHeight(blocks, meta, i, id, 0, 1)];
  const hAt = (vx, vz) => ch[vx ? (vz ? 2 : 1) : (vz ? 3 : 0)];
  const hMax = Math.max(...ch);
  const still = texId(id === B.WATER ? 'water' : 'lava');
  const flow = texId(id === B.WATER ? 'water_flow' : 'lava_flow');
  const isWater = id === B.WATER;
  // flow direction from the slope of the surface (downhill)
  const fx = (ch[0] + ch[3]) - (ch[1] + ch[2]), fz = (ch[0] + ch[1]) - (ch[3] + ch[2]);
  const flowing = !full && (Math.abs(fx) > 0.01 || Math.abs(fz) > 0.01);
  const ang = flowing ? Math.atan2(fx, fz) : 0, ca = Math.cos(ang), sa = Math.sin(ang);
  const topUV = (px, pz) => {
    if (!flowing) return [px, 1 - pz];
    const u = px - 0.5, v = pz - 0.5; // turn the flow texture so it runs downhill (at half scale like the reference)
    return [0.5 + (u * ca - v * sa) * 0.5, 0.5 + (u * sa + v * ca) * 0.5];
  };
  for (let d = 0; d < 6; d++) {
    const ni = i + FACE_N[d];
    const nb = blocks[ni];
    if (nb === id || (id === B.WATER && WATERLOGGED[nb])) continue;
    if (OPAQUE[nb] && d !== 2) continue;
    if (d === 2 && OPAQUE[nb] && hMax >= 1) continue;
    if (isWater && nb === B.ICE) continue;
    const l = light[d === 2 && hMax < 1 ? i : ni] || light[i];
    const sky = (l >> 4) * 17, blk = (l & 15) * 17;
    const f = FACES[d];
    buf.ensure(4);
    for (let k = 0; k < 4; k++) {
      const [s, t] = CORNERS[k];
      const vx = f.o[0] + s * f.u[0] + t * f.v[0], vz = f.o[2] + s * f.u[2] + t * f.v[2];
      let vy = f.o[1] + s * f.u[1] + t * f.v[1];
      let u = s, v;
      if (d === 2) { vy = hAt(vx, vz); [u, v] = topUV(vx, vz); }
      else if (d === 3) v = 1 - t;
      else { const top = hAt(vx, vz); if (vy > 0) vy = top; v = 1 - vy; } // sides follow the sloped edge
      const tile = d === 2 ? (flowing ? flow : still) : d === 3 ? still : flow;
      buf.vert(x + vx, y + vy, z + vz, f.n[0], f.n[1], f.n[2], u, v, WT[0], WT[1], WT[2], sky, blk, 0, tile);
    }
    buf.quad(false);
    // Inner side of the surface so it is visible from below the water
    if (d === 2 && isWater) {
      buf.ensure(4);
      for (let k = 3; k >= 0; k--) {
        const [s, t] = CORNERS[k];
        const vx = f.o[0] + s * f.u[0] + t * f.v[0], vz = f.o[2] + s * f.u[2] + t * f.v[2];
        const [u, v] = topUV(vx, vz);
        buf.vert(x + vx, y + hAt(vx, vz), z + vz, 0, -1, 0, u, v, WT[0], WT[1], WT[2], sky, blk, 0, flowing ? flow : still);
      }
      buf.quad(false);
    }
  }
}
