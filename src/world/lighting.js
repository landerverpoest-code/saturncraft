// Flood-fill lighting for sky light and block light (0..15 each, packed as
// sky<<4 | block). Sky light travels straight down without loss; everything
// else loses at least 1 per block plus the block's opacity.
import { OPACITY, EMIT } from './blocks.js';
import { CHUNK_VOLUME, WORLD_HEIGHT, MIN_Y } from './constants.js';

/** Initial lighting of a freshly generated chunk, ignoring its neighbours. */
export function computeChunkLight(blocks, light) {
  light.fill(0);
  const queue = [];
  // Sky columns
  for (let c = 0; c < 256; c++) {
    let v = 15;
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const i = c | (y << 8);
      const op = OPACITY[blocks[i]];
      if (op) v = op >= 15 ? 0 : Math.max(0, v - op);
      if (v === 0) break;
      light[i] = v << 4;
    }
  }
  // Seed cells adjacent to darker non-opaque neighbours
  for (let i = 0; i < CHUNK_VOLUME; i++) {
    const v = light[i] >> 4;
    if (v < 2) continue;
    const x = i & 15, z = (i >> 4) & 15;
    const t = v - 1;
    if ((x > 0 && (light[i - 1] >> 4) < t && OPACITY[blocks[i - 1]] < 15) ||
        (x < 15 && (light[i + 1] >> 4) < t && OPACITY[blocks[i + 1]] < 15) ||
        (z > 0 && (light[i - 16] >> 4) < t && OPACITY[blocks[i - 16]] < 15) ||
        (z < 15 && (light[i + 16] >> 4) < t && OPACITY[blocks[i + 16]] < 15) ||
        (i >= 256 && (light[i - 256] >> 4) < t && OPACITY[blocks[i - 256]] < 15)) queue.push(i);
  }
  propagateLocal(blocks, light, queue, 4);
  // Block light
  queue.length = 0;
  for (let i = 0; i < CHUNK_VOLUME; i++) {
    const e = EMIT[blocks[i]];
    if (e) { light[i] = (light[i] & 0xf0) | e; queue.push(i); }
  }
  propagateLocal(blocks, light, queue, 0);
}

function propagateLocal(blocks, light, queue, shift) {
  const mask = 15 << shift, keep = ~mask & 0xff;
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h];
    const v = (light[i] >> shift) & 15;
    if (v <= 1) continue;
    const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
    for (let d = 0; d < 6; d++) {
      let j;
      if (d === 0) { if (x === 15) continue; j = i + 1; }
      else if (d === 1) { if (x === 0) continue; j = i - 1; }
      else if (d === 2) { if (z === 15) continue; j = i + 16; }
      else if (d === 3) { if (z === 0) continue; j = i - 16; }
      else if (d === 4) { if (y === WORLD_HEIGHT - 1) continue; j = i + 256; }
      else { if (y === 0) continue; j = i - 256; }
      const op = OPACITY[blocks[j]];
      if (op >= 15) continue;
      let nv = v - Math.max(1, op);
      if (shift === 4 && d === 5 && v === 15 && op === 0) nv = 15;
      if (nv > ((light[j] >> shift) & 15)) {
        light[j] = (light[j] & keep) | (nv << shift);
        queue.push(j);
      }
    }
  }
}

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];

/**
 * World-level light engine operating across chunk boundaries.
 * `world` must provide getBlock(x,y,z), getLight(x,y,z) -> packed,
 * setLight(x,y,z,packed) and isLoaded(x,z).
 */
export class LightEngine {
  constructor(world) {
    this.world = world;
    this.addQ = [];
    this.remQ = [];
  }

  /** Light value of a channel (shift 4 = sky, 0 = block) */
  get(x, y, z, shift) { return (this.world.getLight(x, y, z) >> shift) & 15; }
  set(x, y, z, shift, v) {
    const cur = this.world.getLight(x, y, z);
    this.world.setLight(x, y, z, (cur & ~(15 << shift) & 0xff) | (v << shift));
  }

  pushAdd(x, y, z) { this.addQ.push(x, y, z); }

  propagate(shift) {
    const q = this.addQ, w = this.world;
    for (let h = 0; h < q.length; h += 3) {
      const x = q[h], y = q[h + 1], z = q[h + 2];
      const v = this.get(x, y, z, shift);
      if (v <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
        if (ny < MIN_Y || ny >= MIN_Y + WORLD_HEIGHT || !w.isLoaded(nx, nz)) continue;
        const op = OPACITY[w.getBlock(nx, ny, nz)];
        if (op >= 15) continue;
        let nv = v - Math.max(1, op);
        if (shift === 4 && d === 5 && v === 15 && op === 0) nv = 15;
        if (nv > this.get(nx, ny, nz, shift)) { this.set(nx, ny, nz, shift, nv); q.push(nx, ny, nz); }
      }
    }
    q.length = 0;
  }

  /** Remove light originating from (x,y,z) on a channel, re-queue boundaries. */
  remove(x, y, z, shift) {
    const w = this.world;
    const val = this.get(x, y, z, shift);
    this.set(x, y, z, shift, 0);
    const rq = this.remQ;
    rq.push(x, y, z, val);
    for (let h = 0; h < rq.length; h += 4) {
      const cx = rq[h], cy = rq[h + 1], cz = rq[h + 2], cv = rq[h + 3];
      for (let d = 0; d < 6; d++) {
        const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1], nz = cz + DIRS[d][2];
        if (ny < MIN_Y || ny >= MIN_Y + WORLD_HEIGHT || !w.isLoaded(nx, nz)) continue;
        const nv = this.get(nx, ny, nz, shift);
        if (nv === 0) continue;
        if (nv < cv || (shift === 4 && d === 5 && cv === 15 && nv === 15)) {
          this.set(nx, ny, nz, shift, 0);
          rq.push(nx, ny, nz, nv);
        } else {
          this.addQ.push(nx, ny, nz);
        }
      }
    }
    rq.length = 0;
  }

  /** Update lighting after the block at (x,y,z) changed. */
  onBlockChanged(x, y, z, oldId, newId) {
    // Block light channel
    this.remove(x, y, z, 0);
    const e = EMIT[newId];
    if (e) { this.set(x, y, z, 0, e); this.addQ.push(x, y, z); }
    for (const [dx, dy, dz] of DIRS) this.addQ.push(x + dx, y + dy, z + dz);
    this.filterAddQueue();
    this.propagate(0);
    // Sky light channel
    this.remove(x, y, z, 4);
    if (OPACITY[newId] < 15) {
      // Directly under open sky?
      const above = y + 1 >= MIN_Y + WORLD_HEIGHT ? 15 : this.get(x, y + 1, z, 4);
      if (above === 15 && OPACITY[newId] === 0) this.set(x, y, z, 4, 15);
      this.addQ.push(x, y, z);
    }
    for (const [dx, dy, dz] of DIRS) this.addQ.push(x + dx, y + dy, z + dz);
    this.filterAddQueue();
    this.propagate(4);
  }

  filterAddQueue() {
    const q = this.addQ, w = this.world;
    const out = [];
    for (let i = 0; i < q.length; i += 3) {
      const y = q[i + 1];
      if (y < MIN_Y || y >= MIN_Y + WORLD_HEIGHT || !w.isLoaded(q[i], q[i + 2])) continue;
      out.push(q[i], y, q[i + 2]);
    }
    this.addQ = out;
  }

  /** Let light flow across the border between a newly loaded chunk and its neighbours. */
  stitchChunk(cx, cz) {
    const w = this.world;
    const x0 = cx * 16, z0 = cz * 16;
    const sides = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
    ];
    for (const [dx, dz] of sides) {
      if (!w.isChunkLoaded(cx + dx, cz + dz)) continue;
      for (let k = 0; k < 16; k++) {
        // cells on both sides of the shared face
        let ax, az, bx, bz;
        if (dx === -1) { ax = x0; az = z0 + k; bx = x0 - 1; bz = az; }
        else if (dx === 1) { ax = x0 + 15; az = z0 + k; bx = x0 + 16; bz = az; }
        else if (dz === -1) { ax = x0 + k; az = z0; bx = ax; bz = z0 - 1; }
        else { ax = x0 + k; az = z0 + 15; bx = ax; bz = z0 + 16; }
        for (let y = MIN_Y; y < MIN_Y + WORLD_HEIGHT; y++) {
          const la = w.getLight(ax, y, az), lb = w.getLight(bx, y, bz);
          if (la === lb) continue;
          if (((la >> 4) > 1 && (la >> 4) - 1 > (lb >> 4)) || ((la & 15) > 1 && (la & 15) - 1 > (lb & 15))) this.addQ.push(ax, y, az);
          if (((lb >> 4) > 1 && (lb >> 4) - 1 > (la >> 4)) || ((lb & 15) > 1 && (lb & 15) - 1 > (la & 15))) this.addQ.push(bx, y, bz);
        }
      }
    }
    const saved = this.addQ.slice();
    this.propagate(4);
    this.addQ = saved;
    this.propagate(0);
  }
}
