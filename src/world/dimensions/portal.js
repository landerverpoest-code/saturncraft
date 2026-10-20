// Portal logic (pure functions over a world-like object with getBlock /
// setBlock / getMeta, so it can be unit-tested):
//  * Rift portals: an obsidian frame (interior 2..21 wide, 3..21 tall, corners
//    optional) in the x or z plane, lit with flint and steel, fills with Rift
//    blocks. A Rift block disappears when its frame or sheet is broken.
//  * Hollow gates: a ring of 12 Hollow Frames (5x5 without corners) around a
//    3x3 hole; once every frame holds an Eye of the Void the hole fills with
//    Hollow Gate blocks.
import { B, SOLID } from '../blocks.js';

export const MIN_W = 2, MAX_W = 21, MIN_H = 3, MAX_H = 21;
const AXES = [[1, 0], [0, 1]]; // meta 0: sheet spans x, meta 1: spans z

const emptyForPortal = (id) => id === B.AIR || id === B.FIRE || id === B.RIFT;

/**
 * Find a complete, empty obsidian frame around the cell (x, y, z) in either
 * plane. Returns { axis, x, y, z, w, h } (x/y/z: lower interior corner) or null.
 */
export function findRiftFrame(world, x, y, z) {
  if (!emptyForPortal(world.getBlock(x, y, z))) return null;
  for (let axis = 0; axis < 2; axis++) {
    const f = frameInPlane(world, x, y, z, axis);
    if (f) return f;
  }
  return null;
}

function frameInPlane(world, x, y, z, axis) {
  const [ax, az] = AXES[axis];
  const at = (i, j) => world.getBlock(x + ax * i, j, z + az * i);
  // drop to the bottom of the interior
  let by = y, n = 0;
  while (emptyForPortal(at(0, by - 1)) && n++ < MAX_H) by--;
  if (at(0, by - 1) !== B.OBSIDIAN) return null;
  // slide to the left edge
  let left = 0;
  n = 0;
  while (emptyForPortal(at(left - 1, by)) && at(left - 1, by - 1) === B.OBSIDIAN && n++ < MAX_W) left--;
  if (at(left - 1, by) !== B.OBSIDIAN) return null;
  // width along the bottom row
  let w = 0;
  while (w <= MAX_W && emptyForPortal(at(left + w, by)) && at(left + w, by - 1) === B.OBSIDIAN) w++;
  if (w < MIN_W || w > MAX_W || at(left + w, by) !== B.OBSIDIAN) return null;
  // height: rows of empty interior bounded by obsidian on both sides, capped by an obsidian row
  let h = 0;
  for (; h <= MAX_H; h++) {
    const yy = by + h;
    let rowEmpty = true, rowTop = true;
    for (let i = 0; i < w; i++) {
      const id = at(left + i, yy);
      if (!emptyForPortal(id)) rowEmpty = false;
      if (id !== B.OBSIDIAN) rowTop = false;
    }
    if (rowTop) break;
    if (!rowEmpty || at(left - 1, yy) !== B.OBSIDIAN || at(left + w, yy) !== B.OBSIDIAN) return null;
  }
  if (h < MIN_H || h > MAX_H) return null;
  return { axis, x: x + ax * left, y: by, z: z + az * left, w, h };
}

/** Fill a frame found by findRiftFrame with Rift blocks. */
export function fillRift(world, f, set = (x, y, z, id, m) => world.setBlock(x, y, z, id, m, false)) {
  const [ax, az] = AXES[f.axis];
  for (let i = 0; i < f.w; i++) for (let j = 0; j < f.h; j++) set(f.x + ax * i, f.y + j, f.z + az * i, B.RIFT, f.axis);
}

/** Try to light a portal at a fire position. Returns the frame or null. */
export function tryLightRift(world, x, y, z, set) {
  const f = findRiftFrame(world, x, y, z);
  if (f) fillRift(world, f, set);
  return f;
}

/** A Rift block stays while its in-plane neighbours are Rift or obsidian. */
export function riftCanStay(world, x, y, z) {
  const [ax, az] = AXES[world.getMeta(x, y, z) & 1];
  const ok = (id) => id === B.RIFT || id === B.OBSIDIAN;
  return ok(world.getBlock(x + ax, y, z + az)) && ok(world.getBlock(x - ax, y, z - az)) && ok(world.getBlock(x, y + 1, z)) && ok(world.getBlock(x, y - 1, z));
}

/** Cells of the 12-frame ring around centre (cx, y, cz). */
export function ringCells(cx, y, cz) {
  const out = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const ring = Math.max(Math.abs(dx), Math.abs(dz)) === 2, corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
    if (ring && !corner) out.push([cx + dx, y, cz + dz]);
  }
  return out;
}

/** Centre of a complete ring of eyed frames that includes (x, y, z), or null. */
export function findHollowRing(world, x, y, z) {
  for (let cx = x - 2; cx <= x + 2; cx++) for (let cz = z - 2; cz <= z + 2; cz++) {
    const cells = ringCells(cx, y, cz);
    if (!cells.some(([a, , c]) => a === x && c === z)) continue;
    if (cells.every(([a, b, c]) => world.getBlock(a, b, c) === B.HOLLOW_FRAME_EYE)) return { x: cx, y, z: cz };
  }
  return null;
}

/** Fill the 3x3 hole of a ring with Hollow Gate blocks. */
export function fillHollowGate(world, c, set = (x, y, z, id) => world.setBlock(x, y, z, id, 0, false)) {
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) set(c.x + dx, c.y, c.z + dz, B.HOLLOW_GATE);
}

/**
 * Nearest Rift block (lowest of its column) within `radius` of (x, z) among
 * loaded chunks, or null. `chunks` iterates objects with cx, cz, blocks.
 */
export function nearestRift(chunks, cidx, x, y, z, radius, yMin, yMax) {
  let best = null, bd = Infinity;
  for (const c of chunks) {
    const bx = c.cx * 16, bz = c.cz * 16;
    if (bx + 16 < x - radius || bx > x + radius || bz + 16 < z - radius || bz > z + radius) continue;
    for (let yy = yMin; yy <= yMax; yy++) for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      if (c.blocks[cidx(lx, yy, lz)] !== B.RIFT) continue;
      if (yy > yMin && c.blocks[cidx(lx, yy - 1, lz)] === B.RIFT) continue; // lowest of the column only
      const d = (bx + lx - x) ** 2 + (yy - y) ** 2 * 0.25 + (bz + lz - z) ** 2;
      if (d < bd && d <= radius * radius * 1.5) { bd = d; best = { x: bx + lx, y: yy, z: bz + lz }; }
    }
  }
  return best;
}

/**
 * Find a spot for a new 4x5 portal near (x, y, z): solid ground under a 4x3
 * footprint with 5 free blocks above. Returns {x, y, z, axis} (x/z of the frame's
 * first column, y = interior bottom) or null.
 */
export function findPortalSite(world, x, y, z, radius, yMin, yMax) {
  let best = null, bd = Infinity;
  const free = (id) => id === B.AIR || id === B.FIRE;
  for (let dx = -radius; dx <= radius; dx += 1) for (let dz = -radius; dz <= radius; dz += 1) {
    if (dx * dx + dz * dz > radius * radius) continue;
    const px = x + dx, pz = z + dz;
    for (let yy = yMax; yy >= yMin; yy--) {
      if (!free(world.getBlock(px, yy, pz)) || !SOLID[world.getBlock(px, yy - 1, pz)]) continue;
      for (let axis = 0; axis < 2; axis++) {
        const [ax, az] = AXES[axis], [qx, qz] = AXES[1 - axis];
        let ok = true;
        for (let i = 0; i < 4 && ok; i++) for (let k = -1; k <= 1 && ok; k++) {
          const cx = px + ax * i + qx * k, cz = pz + az * i + qz * k;
          const g = world.getBlock(cx, yy - 1, cz);
          if (!SOLID[g] || g === B.LAVA) ok = false;
          for (let j = 0; j < 5 && ok; j++) if (!free(world.getBlock(cx, yy + j, cz))) ok = false;
        }
        if (!ok) continue;
        const d = dx * dx + dz * dz + (yy - y) ** 2;
        if (d < bd) { bd = d; best = { x: px, y: yy, z: pz, axis }; }
      }
    }
  }
  return best;
}

/**
 * Build a 4x5 obsidian frame (2x3 Rift interior) whose first column is at
 * (x, z) with the interior starting at y; with `platform`, also lay a 4x3
 * obsidian floor and carve air around it. Returns the frame (for fillRift).
 */
export function buildRiftPortal(world, x, y, z, axis, platform, set = (a, b, c, id, m = 0) => world.setBlock(a, b, c, id, m, false)) {
  const [ax, az] = AXES[axis], [qx, qz] = AXES[1 - axis];
  if (platform) {
    for (let i = -1; i <= 4; i++) for (let k = -1; k <= 1; k++) {
      const cx = x + ax * i + qx * k, cz = z + az * i + qz * k;
      set(cx, y - 1, cz, B.OBSIDIAN);
      for (let j = 0; j < 5; j++) set(cx, y + j, cz, B.AIR);
    }
  }
  for (let i = 0; i < 4; i++) for (let j = -1; j <= 3; j++) {
    const edge = i === 0 || i === 3 || j === -1 || j === 3;
    set(x + ax * i, y + j, z + az * i, edge ? B.OBSIDIAN : B.AIR);
  }
  const f = { axis, x: x + ax, y, z: z + az, w: 2, h: 3 };
  fillRift(world, f, (a, b, c, id, m) => set(a, b, c, id, m));
  return f;
}
