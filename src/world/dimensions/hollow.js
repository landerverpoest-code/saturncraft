// The Hollow: a central island of Hollowstone floating in a starry void, ringed
// by ten obsidian pillars (each crowned with a Mending Crystal), with the
// bedrock fountain of the exit gate at its centre. Smaller islands drift far
// out. Everything below and between is empty void.
import { B } from '../blocks.js';
import { Simplex, hash4, mulberry32 } from '../noise.js';
import { CHUNK_VOLUME, cidx } from '../constants.js';
import { sideOf } from '../shapes.js';

export const HOLLOW_ISLAND_R = 96;
export const HOLLOW_ARRIVAL = { x: 100, y: 48, z: 0 }; // obsidian platform, built on arrival
const OUTER_CELL = 112;

export class HollowGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    this.dimension = 'hollow';
    const s = (k) => new Simplex(hash4(this.seed, k, 3141, 59));
    this.nEdge = s(1); this.nTop = s(2); this.nBottom = s(3); this.nOuter = s(4);
    this._pillars = null;
    this._fy = null;
  }

  /** Top and bottom of the island column at (x, z), or null over the void. */
  islandColumn(x, z) {
    const r = Math.hypot(x, z);
    const R = HOLLOW_ISLAND_R + this.nEdge.noise2(x / 52, z / 52) * 16;
    if (r < R) {
      const t = r / R;
      const top = 56 + this.nTop.fbm2(x / 36, z / 36, 2) * 3.5 * (1 - t) - t * t * 7;
      const bottom = top - (3 + 44 * (1 - t) ** 1.6) + this.nBottom.noise2(x / 18, z / 18) * 3;
      return [Math.floor(bottom), Math.floor(top)];
    }
    // outer islands, one at most per 112x112 cell, beyond 180 blocks
    const ci = Math.floor(x / OUTER_CELL), cj = Math.floor(z / OUTER_CELL);
    const o = this.outerIsland(ci, cj);
    if (!o) return null;
    const d = Math.hypot(x - o.x, z - o.z) / (o.r * (1 + this.nOuter.noise2(x / 9, z / 9) * 0.18));
    if (d >= 1) return null;
    const top = o.y + 2.5 * (1 - d * d);
    const bottom = o.y - o.r * 0.9 * (1 - d) ** 1.3;
    return [Math.floor(bottom), Math.floor(top)];
  }

  outerIsland(ci, cj) {
    const cx = (ci + 0.5) * OUTER_CELL, cz = (cj + 0.5) * OUTER_CELL;
    if (Math.hypot(cx, cz) < 220) return null;
    const r = mulberry32(hash4(this.seed, ci, cj, 2718));
    if (r() > 0.45) return null;
    const rad = 7 + Math.floor(r() * 14);
    const m = OUTER_CELL / 2 - rad - 4;
    return { x: cx + (r() * 2 - 1) * m, z: cz + (r() * 2 - 1) * m, y: 36 + Math.floor(r() * 36), r: rad };
  }

  /** Ten obsidian pillars around the centre: {x, z, r, h} (top block y = h, crystal above). */
  pillars() {
    if (this._pillars) return this._pillars;
    const r = mulberry32(hash4(this.seed, 5, 5, 909));
    const out = [];
    const off = r() * Math.PI * 2;
    for (let i = 0; i < 10; i++) {
      const a = off + (i / 10) * Math.PI * 2;
      out.push({ x: Math.round(Math.cos(a) * 42), z: Math.round(Math.sin(a) * 42), r: 2 + Math.floor(r() * 4), h: 76 + 3 * Math.floor(r() * 10) });
    }
    return (this._pillars = out);
  }

  /** y of the fountain floor (the gate layer) at the centre. */
  fountainY() {
    if (this._fy === null) this._fy = this.islandColumn(0, 0)[1] + 1;
    return this._fy;
  }

  /** Cells (x, y, z) that become Hollow Gate blocks once the Wyrm is slain. */
  gateCells() {
    const fy = this.fountainY(), out = [];
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      if ((dx || dz) && Math.hypot(dx, dz) <= 2.5) out.push([dx, fy, dz]);
    }
    return out;
  }

  generate(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const meta = new Uint8Array(CHUNK_VOLUME);
    const biomes = new Uint8Array(256).fill(8);
    const colors = new Uint8Array(256 * 6);
    for (let i = 0; i < 256; i++) colors.set([110, 160, 70, 80, 140, 50], i * 6);
    const heightmap = new Int16Array(256);
    const x0 = cx * 16, z0 = cz * 16;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const col = this.islandColumn(x0 + x, z0 + z);
      if (!col) continue;
      for (let y = Math.max(1, col[0]); y <= col[1]; y++) blocks[cidx(x, y, z)] = B.HOLLOWSTONE;
    }
    // pillars
    for (const p of this.pillars()) {
      if (p.x + p.r < x0 || p.x - p.r > x0 + 15 || p.z + p.r < z0 || p.z - p.r > z0 + 15) continue;
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const dx = x0 + x - p.x, dz = z0 + z - p.z;
        if (dx * dx + dz * dz > p.r * p.r + p.r) continue;
        for (let y = 36; y <= p.h; y++) blocks[cidx(x, y, z)] = B.OBSIDIAN;
        if (!dx && !dz) blocks[cidx(x, p.h + 1, z)] = B.BEDROCK;
      }
    }
    // exit fountain at the centre (inactive: the gate cells stay empty until the Wyrm dies)
    if (x0 <= 4 && x0 + 15 >= -4 && z0 <= 4 && z0 + 15 >= -4) {
      const fy = this.fountainY();
      for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
        const x = dx - x0, z = dz - z0;
        if (x < 0 || x > 15 || z < 0 || z > 15) continue;
        const d = Math.hypot(dx, dz);
        if (d > 4.2) continue;
        for (let y = fy; y <= fy + 6; y++) blocks[cidx(x, y, z)] = B.AIR;
        if (d <= 3.5) {
          blocks[cidx(x, fy - 1, z)] = B.BEDROCK;
          for (let y = fy - 2; y > fy - 6; y--) if (!blocks[cidx(x, y, z)]) blocks[cidx(x, y, z)] = B.HOLLOWSTONE;
          if (d > 2.5) blocks[cidx(x, fy, z)] = B.BEDROCK;
        }
        if (!dx && !dz) for (let y = fy; y <= fy + 3; y++) blocks[cidx(x, y, z)] = B.BEDROCK;
        if (Math.abs(dx) + Math.abs(dz) === 1) {
          // torches on the central pillar
          blocks[cidx(x, fy + 2, z)] = B.TORCH;
          meta[cidx(x, fy + 2, z)] = 1 + sideOf(-dx, -dz);
        }
      }
    }
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      let y = 255;
      while (y > 0 && !blocks[cidx(x, y, z)]) y--;
      heightmap[x + z * 16] = y;
    }
    return { blocks, meta, biomes, colors, heightmap };
  }
}
