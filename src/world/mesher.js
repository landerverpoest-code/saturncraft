// Face-culled section mesher with smooth lighting and ambient occlusion.
// Input is a 18x18x18 padded copy of a 16^3 section (1 block border from
// neighbours) so it can run inside a worker without access to the world.
import { B, OPAQUE, SHAPES, LAYERS, SHAPE, LAYER } from './blocks.js';
import { FACE_TILE, FRONT_TILE, texId } from './textures.js';
import { doorBox, ladderBox, SIDE_DIRS, DOOR_UPPER, BED_HEAD, BED_BOX, slabBox, stairBoxes, fenceConnects, fenceRenderBoxes, gateRenderBoxes } from './shapes.js';

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
const FURNACE_FRONT_DIR = [5, 0, 4, 1];
// crop textures per growth stage 0..7 (carrots have 4 visual stages)
const CROP_TILES = { [B.WHEAT]: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => texId('wheat_' + i)), [B.CARROTS]: [0, 0, 1, 1, 2, 2, 2, 3].map((i) => texId('carrots_' + i)) };
const FARMLAND_MOIST = texId('farmland_moist');
const DOOR_LOWER = texId('door_lower'), DOOR_UPPER_TILE = texId('door_upper');
const BED_TOPS = [0, 1, 2, 3].map((r) => [texId('bed_foot_top_' + r), texId('bed_head_top_' + r)]);
const BED_SIDE = texId('bed_side'), BED_BOTTOM = texId('oak_planks');

class Buf {
  constructor(cap = 16384) { this.alloc(cap); this.n = 0; this.ni = 0; this.yBase = 0; }
  alloc(cap) {
    const old = this.pos ? this : null;
    this.cap = cap;
    const pos = new Float32Array(cap * 3), nrm = new Int8Array(cap * 3), uv = new Float32Array(cap * 2);
    const col = new Uint8Array(cap * 3), lit = new Uint8Array(cap * 4), idx = new Uint32Array(cap * 1.5);
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
  opaqueBuf.reset(); cutoutBuf.reset(); transBuf.reset();
  opaqueBuf.yBase = cutoutBuf.yBase = transBuf.yBase = sec.yBase || 0;
  const ao = [0, 0, 0, 0], sk = [0, 0, 0, 0], bl = [0, 0, 0, 0];
  for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const i = pidx(x, y, z);
    const id = blocks[i];
    if (!id) continue;
    const shape = SHAPES[id];
    const buf = LAYERS[id] === LAYER.TRANSLUCENT ? transBuf : LAYERS[id] === LAYER.CUTOUT ? cutoutBuf : opaqueBuf;
    const ci = (x + z * 16) * 6;
    if (shape === SHAPE.CUBE) {
      const translucent = !OPAQUE[id];
      for (let d = 0; d < 6; d++) {
        const ni = i + FACE_N[d];
        const nb = blocks[ni];
        if (OPAQUE[nb]) continue;
        if (translucent && nb === id && id !== B.OAK_LEAVES && id !== B.BIRCH_LEAVES && id !== B.SPRUCE_LEAVES) continue;
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
        } else if (FRONT_TILE[id] >= 0 && d === FURNACE_FRONT_DIR[meta[i] & 3]) tile = FRONT_TILE[id];
        else if (id === B.FARMLAND && d === 2 && meta[i] > 0) tile = FARMLAND_MOIST;
        let r = 255, g = 255, b2 = 255;
        if ((id === B.GRASS && d === 2)) { r = colors[ci]; g = colors[ci + 1]; b2 = colors[ci + 2]; }
        else if (id === B.OAK_LEAVES) { r = colors[ci + 3]; g = colors[ci + 4]; b2 = colors[ci + 5]; }
        else if (FOLIAGE_FIXED[id]) [r, g, b2] = FOLIAGE_FIXED[id];
        const f = FACES[d];
        buf.ensure(4);
        for (let k = 0; k < 4; k++) {
          const [s, t] = CORNERS[k];
          buf.vert(
            x + f.o[0] + s * f.u[0] + t * f.v[0], y + f.o[1] + s * f.u[1] + t * f.v[1], z + f.o[2] + s * f.u[2] + t * f.v[2],
            f.n[0], f.n[1], f.n[2], s, 1 - t, r, g, b2, sk[k], bl[k], ao[k], tile);
        }
        buf.quad(ao[0] + ao[2] > ao[1] + ao[3]);
      }
    } else if (shape === SHAPE.LIQUID) {
      meshLiquid(buf, blocks, light, meta, i, id, x, y, z);
    } else if (shape === SHAPE.CROSS) {
      const l = light[i];
      const tile = FACE_TILE[id * 6 + 2];
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
          buf.vert(x2, y + 1, z2, 0, 1, 0, 1, 0, r, g, b2, sky, blk, 0, tile);
          buf.vert(x1, y + 1, z1, 0, 1, 0, 0, 0, r, g, b2, sky, blk, 0, tile);
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
    } else if (shape === SHAPE.SLAB || shape === SHAPE.STAIRS) {
      // light-blocking partial blocks: shade with the brightest neighbouring light
      let sk = 0, bk = 0;
      for (let d = 0; d < 6; d++) { const l = light[i + FACE_N[d]]; sk = Math.max(sk, l >> 4); bk = Math.max(bk, l & 15); }
      const tiles = [0, 1, 2, 3, 4, 5].map((d) => FACE_TILE[id * 6 + d]);
      const boxes = shape === SHAPE.SLAB ? [slabBox(meta[i])] : stairBoxes(meta[i]);
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
    } else if (shape === SHAPE.BED) {
      const l = light[i], m = meta[i], top = BED_TOPS[m & 3][m & BED_HEAD ? 1 : 0];
      emitBox(buf, x, y, z, ...BED_BOX, [BED_SIDE, BED_SIDE, top, BED_BOTTOM, BED_SIDE, BED_SIDE], (l >> 4) * 17, (l & 15) * 17, 'box');
    } else if (shape === SHAPE.DOOR) {
      const l = light[i], b = doorBox(meta[i]);
      emitBox(buf, x, y, z, b[0], b[1], b[2], b[3], b[4], b[5], meta[i] & DOOR_UPPER ? DOOR_UPPER_TILE : DOOR_LOWER, (l >> 4) * 17, (l & 15) * 17, 'box');
    } else if (shape === SHAPE.LADDER) {
      // a thin panel just off the wall (both faces textured)
      const l = light[i], b = ladderBox(meta[i]);
      const s = meta[i] & 3, a = s === 1 || s === 3 ? 0 : 2; // axis of the wall normal
      const atWall = s === 1 || s === 2 ? 1 : 0, off = atWall ? -1 / 16 : 1 / 16;
      b[a] = atWall + off - 0.005; b[a + 3] = atWall + off + 0.005;
      emitBox(buf, x, y, z, b[0], b[1], b[2], b[3], b[4], b[5], FACE_TILE[id * 6], (l >> 4) * 17, (l & 15) * 17, 'box');
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

function swapVert(buf, a, b) {
  const sw = (arr, n) => { for (let k = 0; k < n; k++) { const t = arr[a * n + k]; arr[a * n + k] = arr[b * n + k]; arr[b * n + k] = t; } };
  sw(buf.pos, 3); sw(buf.uv, 2); sw(buf.col, 3); sw(buf.lit, 4);
}

/** Axis-aligned box; uvMode 'torch' maps the top to the torch tip, 'box' maps every face to its sub-rectangle. */
function emitBox(buf, x, y, z, x0, y0, z0, x1, y1, z1, tile, sky, blk, uvMode = 'torch') {
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
      buf.vert(x + p[0], y + p[1], z + p[2], f.n[0], f.n[1], f.n[2], u, v, 255, 255, 255, sky, blk, 0, typeof tile === 'number' ? tile : tile[d]);
    }
    buf.quad(false);
  }
}

function meshLiquid(buf, blocks, light, meta, i, id, x, y, z) {
  const above = blocks[i + FACE_N[2]];
  const h = above === id ? 1 : liquidHeight(meta[i]);
  const still = texId(id === B.WATER ? 'water' : 'lava');
  const flow = texId(id === B.WATER ? 'water_flow' : 'lava_flow');
  const isWater = id === B.WATER;
  for (let d = 0; d < 6; d++) {
    const ni = i + FACE_N[d];
    const nb = blocks[ni];
    if (nb === id) continue;
    if (OPAQUE[nb] && d !== 2) continue;
    if (d === 2 && OPAQUE[nb] && h >= 1) continue;
    if (isWater && nb === B.ICE) continue;
    const l = light[d === 2 && h < 1 ? i : ni] || light[i];
    const sky = (l >> 4) * 17, blk = (l & 15) * 17;
    const f = FACES[d];
    buf.ensure(4);
    for (let k = 0; k < 4; k++) {
      const [s, t] = CORNERS[k];
      let py = y + f.o[1] + s * f.u[1] + t * f.v[1];
      if (py > y) py = y + h;
      const tile = d === 2 || d === 3 ? still : flow;
      buf.vert(x + f.o[0] + s * f.u[0] + t * f.v[0], py, z + f.o[2] + s * f.u[2] + t * f.v[2], f.n[0], f.n[1], f.n[2], s, 1 - t * (d === 2 || d === 3 ? 1 : h), 255, 255, 255, sky, blk, 0, tile);
    }
    buf.quad(false);
    // Inner side of the surface so it is visible from below the water
    if (d === 2 && isWater) {
      buf.ensure(4);
      for (let k = 3; k >= 0; k--) {
        const [s, t] = CORNERS[k];
        buf.vert(x + f.o[0] + s * f.u[0] + t * f.v[0], y + h, z + f.o[2] + s * f.u[2] + t * f.v[2], 0, -1, 0, s, 1 - t, 255, 255, 255, sky, blk, 0, still);
      }
      buf.quad(false);
    }
  }
}
