// The Hollow: a central island of Hollowstone floating in a starry void, ringed
// by ten obsidian pillars (each crowned with a Mending Crystal), with the
// bedrock fountain of the exit gate at its centre. The outer islands only
// begin 800 blocks out (reached through the Far Gate that opens once the Void
// Wyrm is slain); some carry a Hollow City (hollowCity.js), many grow Hushvine
// (hushvine.js). Everything below and between is empty void.
import { B } from '../blocks.js';
import { Simplex, hash4, mulberry32 } from '../noise.js';
import { CHUNK_VOLUME, cidx } from '../constants.js';
import { sideOf } from '../shapes.js';
import { planCity, Plan } from './hollowCity.js';
import { growHushvinePlant } from './hushvine.js';

export const HOLLOW_ISLAND_R = 96;
export const HOLLOW_ARRIVAL = { x: 100, y: 48, z: 0 }; // obsidian platform, built on arrival
const OUTER_CELL = 112;
export const OUTER_MIN_R = 800;   // no outer islands closer than this to the centre
export const GATEWAY_R = 80;      // the Far Gate on the main island's rim
export const GATEWAY_TARGET_R = 1024; // where it leads

export class HollowGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    this.dimension = 'hollow';
    const s = (k) => new Simplex(hash4(this.seed, k, 3141, 59));
    this.nEdge = s(1); this.nTop = s(2); this.nBottom = s(3); this.nOuter = s(4);
    this._pillars = null;
    this._fy = null;
    this._plans = new Map();
    this._gate = null;
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
    // outer islands, one at most per 112x112 cell, beyond OUTER_MIN_R
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
    if (Math.hypot(cx, cz) < OUTER_MIN_R) return null;
    const r = mulberry32(hash4(this.seed, ci, cj, 2718));
    if (r() > 0.55) return null;
    const rad = 8 + Math.floor(r() * 20);
    const m = OUTER_CELL / 2 - rad - 4;
    return { x: cx + (r() * 2 - 1) * m, z: cz + (r() * 2 - 1) * m, y: 36 + Math.floor(r() * 36), r: rad };
  }

  /** Top block of the island at a column, or null over the void. */
  groundAt(x, z) { const c = this.islandColumn(x, z); return c ? c[1] : null; }

  /**
   * Everything planned on outer island cell (ci, cj): its city (or null) and a Plan
   * with the city and the Hushvine plants (deterministic, cached).
   */
  islandPlan(ci, cj) {
    const k = `${ci},${cj}`;
    if (this._plans.has(k)) return this._plans.get(k);
    const o = this.outerIsland(ci, cj);
    let out = null;
    if (o) {
      const ground = (x, z) => this.groundAt(x, z);
      const r = mulberry32(hash4(this.seed, ci, cj, 4242));
      const city = o.r >= 15 && r() < 0.6 ? planCity(this.seed, o, ground) : null;
      const P = city ? city.plan : new Plan();
      // Hushvine plants on open ground (not inside the city)
      const n = Math.floor(o.r / 3);
      for (let t = 0; t < n; t++) {
        const a = r() * Math.PI * 2, d = o.r * (0.15 + r() * 0.6);
        const x = Math.floor(o.x + Math.cos(a) * d), z = Math.floor(o.z + Math.sin(a) * d);
        const g = ground(x, z);
        if (g === null || (city && x >= city.bounds.x0 - 2 && x <= city.bounds.x1 + 2 && z >= city.bounds.z0 - 2 && z <= city.bounds.z1 + 2)) continue;
        if (P.get(x, g + 1, z) !== null) continue;
        const free = (xx, yy, zz) => P.get(xx, yy, zz) === null && (ground(xx, zz) ?? -1) < yy;
        growHushvinePlant((xx, yy, zz, id, m) => P.set(xx, yy, zz, id, m), free, r, x, g + 1, z);
      }
      // the far end of the Far Gate, on the island it leads to
      const gw = this.gatewayExit();
      if (gw.ci === ci && gw.cj === cj) {
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 1; dy <= 4; dy++) P.set(gw.x + dx, gw.y + dy, gw.z + dz, B.AIR);
        P.set(gw.x, gw.y, gw.z, B.BEDROCK); P.set(gw.x, gw.y + 1, gw.z, B.FAR_GATE); P.set(gw.x, gw.y + 2, gw.z, B.FAR_GATE); P.set(gw.x, gw.y + 3, gw.z, B.BEDROCK);
      }
      out = { island: o, city, plan: P.finish() };
    }
    if (this._plans.size > 48) this._plans.clear();
    this._plans.set(k, out);
    return out;
  }

  /** The city whose bounds hold (x, y, z), or null. */
  cityAt(x, y, z) {
    const ci = Math.floor(x / OUTER_CELL), cj = Math.floor(z / OUTER_CELL);
    if (Math.hypot(x, z) < OUTER_MIN_R - 64) return null;
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const p = this.islandPlan(i, j), c = p && p.city;
      if (c && x >= c.bounds.x0 && x <= c.bounds.x1 && y >= c.bounds.y0 && y <= c.bounds.y1 && z >= c.bounds.z0 && z <= c.bounds.z1) return c;
    }
    return null;
  }

  /** The nearest Hollow City to (x, z) (outer islands only), searching up to `rings` cells out. */
  nearestCity(x, z, rings = 10) {
    const ci0 = Math.floor(x / OUTER_CELL), cj0 = Math.floor(z / OUTER_CELL);
    let best = null, bd = Infinity;
    for (let r = 0; r <= rings; r++) {
      for (let i = ci0 - r; i <= ci0 + r; i++) for (let j = cj0 - r; j <= cj0 + r; j++) {
        if (Math.max(Math.abs(i - ci0), Math.abs(j - cj0)) !== r) continue;
        const c = this.outerIsland(i, j) && this.islandPlan(i, j).city;
        if (c && Math.hypot(c.x - x, c.z - z) < bd) { bd = Math.hypot(c.x - x, c.z - z); best = c; }
      }
      if (best && r >= 1) break;
    }
    return best;
  }

  /** Direction (radians) of the Far Gate from the centre: fixed per seed. */
  gatewayAngle() { return (hash4(this.seed, 7, 7, 1111) / 4294967296) * Math.PI * 2; }

  /** The Far Gate on the main island's rim: {x, y, z} of its lower gate block's floor (bedrock). */
  gatewayMain() {
    const a = this.gatewayAngle();
    let r = GATEWAY_R, x, z, g;
    do { x = Math.round(Math.cos(a) * r); z = Math.round(Math.sin(a) * r); g = this.groundAt(x, z); r -= 2; } while (g === null && r > 20);
    return { x, y: g ?? 50, z };
  }

  /**
   * The outer island the Far Gate leads to (the nearest one to the point 1024
   * blocks out along the gate's direction) and the spot of its return gate,
   * on the island's rim on the side facing the centre.
   */
  gatewayExit() {
    if (this._gate) return this._gate;
    const a = this.gatewayAngle(), tx = Math.cos(a) * GATEWAY_TARGET_R, tz = Math.sin(a) * GATEWAY_TARGET_R;
    let best = null, bd = Infinity;
    for (let R = 0; R <= 6 && !best; R++) {
      const ci0 = Math.floor(tx / OUTER_CELL), cj0 = Math.floor(tz / OUTER_CELL);
      for (let i = ci0 - R; i <= ci0 + R; i++) for (let j = cj0 - R; j <= cj0 + R; j++) {
        const o = this.outerIsland(i, j);
        if (!o || o.r < 10) continue;
        const d = Math.hypot(o.x - tx, o.z - tz);
        if (d < bd) { bd = d; best = { o, ci: i, cj: j }; }
      }
    }
    if (!best) {
      // no island near the target (very unlikely): the gate floats on its own
      this._gate = { x: Math.round(tx), y: 60, z: Math.round(tz), ci: Math.floor(tx / OUTER_CELL), cj: Math.floor(tz / OUTER_CELL), island: null };
      return this._gate;
    }
    const { o } = best, d = Math.hypot(o.x, o.z) || 1;
    let off = o.r * 0.7, x, z, g;
    do { x = Math.round(o.x - (o.x / d) * off); z = Math.round(o.z - (o.z / d) * off); g = this.groundAt(x, z); off -= 1; } while (g === null && off > 0);
    this._gate = { x, y: g ?? Math.floor(o.y), z, ci: best.ci, cj: best.cj, island: o };
    return this._gate;
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
    // outer-island cities, Hushvine and the Far Gate's far end
    if (Math.hypot(x0 + 8, z0 + 8) > OUTER_MIN_R - 80) {
      const R = 40;
      for (let ci = Math.floor((x0 - R) / OUTER_CELL); ci <= Math.floor((x0 + 15 + R) / OUTER_CELL); ci++)
        for (let cj = Math.floor((z0 - R) / OUTER_CELL); cj <= Math.floor((z0 + 15 + R) / OUTER_CELL); cj++) {
          const p = this.islandPlan(ci, cj);
          if (p) p.plan.stamp(blocks, meta, cx, cz, cidx);
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
