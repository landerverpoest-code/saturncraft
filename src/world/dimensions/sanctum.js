// Hollow Sanctums: buried stone-brick vaults in the overworld (one per 640x640
// region, 75 % of regions) holding the ring of twelve Hollow Frames above a
// lava pool. Fill every frame with an Eye of the Void to open the Hollow Gate.
// Like villages, the plan comes from the seed alone so every chunk stamps its
// own share. Thrown Eyes of the Void fly towards the nearest one.
import { B } from '../blocks.js';
import { MIN_Y, cidx } from '../constants.js';
import { mulberry32, hash4 } from '../noise.js';
import { ringCells } from './portal.js';

export const SANCTUM_REGION = 640;
const ROOM = 7;        // half size of the room
const CORRIDOR = 20;   // corridor reaches this far towards -z

export function sanctumInRegion(seed, rx, rz) {
  const r = mulberry32(hash4(seed | 0, rx, rz, 1717));
  if (r() > 0.75) return null;
  const M = 96;
  const x = rx * SANCTUM_REGION + M + Math.floor(r() * (SANCTUM_REGION - 2 * M));
  const z = rz * SANCTUM_REGION + M + Math.floor(r() * (SANCTUM_REGION - 2 * M));
  const y = 10 + Math.floor(r() * 22);
  const eyes = [];
  for (let i = 0; i < 12; i++) eyes.push(r() < 0.1);
  return { x, y, z, eyes, x0: x - ROOM, x1: x + ROOM, z0: z - CORRIDOR, z1: z + ROOM, y0: y - 1, y1: y + ROOM };
}

export function sanctumsNear(seed, x0, z0, x1, z1) {
  const out = [], R = SANCTUM_REGION;
  for (let rx = Math.floor((x0 - 32) / R); rx <= Math.floor((x1 + 32) / R); rx++)
    for (let rz = Math.floor((z0 - 32) / R); rz <= Math.floor((z1 + 32) / R); rz++) {
      const s = sanctumInRegion(seed, rx, rz);
      if (s && s.x1 >= x0 && s.x0 <= x1 && s.z1 >= z0 && s.z0 <= z1) out.push(s);
    }
  return out;
}

/** Nearest sanctum to (x, z), searching outwards region by region. */
export function nearestSanctum(seed, x, z, maxRings = 6) {
  const R = SANCTUM_REGION, prx = Math.floor(x / R), prz = Math.floor(z / R);
  let best = null, stopAt = maxRings;
  for (let r = 0; r <= stopAt; r++) for (let rx = prx - r; rx <= prx + r; rx++) for (let rz = prz - r; rz <= prz + r; rz++) {
    if (Math.max(Math.abs(rx - prx), Math.abs(rz - prz)) !== r) continue;
    const s = sanctumInRegion(seed, rx, rz);
    if (s && (!best || Math.hypot(s.x - x, s.z - z) < Math.hypot(best.x - x, best.z - z))) { best = s; stopAt = Math.min(stopAt, r + 1); }
  }
  return best;
}

/** The block of a sanctum at (x, y, z) or -1 if the plan leaves it alone. Returns [id, meta]. */
function planBlock(s, x, y, z, seed) {
  const dx = x - s.x, dy = y - s.y, dz = z - s.z;
  const wall = (h) => (hash4(seed, x, y, z) & 7) === 0 ? B.MOSSY_COBBLESTONE : h;
  if (dz < -ROOM) {
    // corridor towards -z: 3 wide, 3 high, walled in bricks
    if (Math.abs(dx) > 2 || dy < -1 || dy > 3) return null;
    if (Math.abs(dx) === 2 || dy === -1 || dy === 3) return [wall(B.STONE_BRICKS), 0];
    if (dy === 0 && dx === 1 && (dz + 100) % 6 === 0) return [B.TORCH, 0];
    return [B.AIR, 0];
  }
  if (Math.abs(dx) > ROOM || dz > ROOM || dy < -1 || dy > ROOM) return null;
  const shell = Math.abs(dx) === ROOM || Math.abs(dz) === ROOM || dy === -1 || dy === ROOM;
  if (shell) {
    if (dz === -ROOM && Math.abs(dx) <= 1 && dy >= 0 && dy <= 2) return [B.AIR, 0]; // doorway to the corridor
    return [wall(B.STONE_BRICKS), 0];
  }
  const adx = Math.abs(dx), adz = Math.abs(dz);
  if (dy === 0 && adx <= 1 && adz <= 1) return [B.LAVA, 0];
  if (dy === 0 && adx <= 2 && adz <= 2) return [B.STONE_BRICKS, 0];
  if (dy === 1) {
    const k = ringCells(s.x, s.y + 1, s.z).findIndex(([a, , c]) => a === x && c === z);
    if (k >= 0) return [s.eyes[k] ? B.HOLLOW_FRAME_EYE : B.HOLLOW_FRAME, 0];
  }
  if (dy === 0 && adx === 5 && adz === 5) return [B.TORCH, 0];
  if (dy === 0 && dx === 5 && dz === 0) return [B.SPAWNER, 2]; // Skitterer spawner
  if (dy === 0 && dx === -5 && dz === 4) return [B.CHEST, 8];  // loot chest
  if (dy === 0 && dz === 6 && adx <= 4) return [B.BOOKSHELF, 0];
  return [B.AIR, 0];
}

/** Stamp the parts of nearby sanctums that fall into chunk (cx, cz). */
export function stampSanctums(gen, blocks, meta, cx, cz) {
  const seed = gen.seed | 0;
  const X0 = cx * 16, Z0 = cz * 16;
  for (const s of sanctumsNear(seed, X0, Z0, X0 + 15, Z0 + 15)) {
    for (let z = Math.max(Z0, s.z0); z <= Math.min(Z0 + 15, s.z1); z++)
      for (let x = Math.max(X0, s.x0); x <= Math.min(X0 + 15, s.x1); x++)
        for (let y = Math.max(MIN_Y + 6, s.y0); y <= s.y1; y++) {
          const b = planBlock(s, x, y, z, seed);
          if (!b) continue;
          const i = cidx(x - X0, y, z - Z0);
          blocks[i] = b[0]; meta[i] = b[1];
        }
  }
}
