// Classic cave carvers, after the reference generator: winding worm tunnels
// that branch and open into rooms, and long narrow ravines. Each source
// chunk seeds its own carvers from the world seed, and every chunk replays
// the carvers of all source chunks within CARVE_RANGE, carving only the part
// that falls inside itself, so tunnels run seamlessly across chunk borders.
// Deep tunnels may have a lava floor, a few higher ones a puddle of water,
// and everything carved below y -55 fills with lava.
import { B } from './blocks.js';
import { MIN_Y, SEA_LEVEL, cidx } from './constants.js';
import { hash4, mulberry32 } from './noise.js';

export const CARVE_RANGE = 8;
const LAVA_LEVEL = -55;

/** Carve the tunnels and ravines that pass through chunk (cx, cz). `surface` is the per-column top before carving. */
export function carveChunk(seed, cx, cz, blocks, surface) {
  const ctx = { blocks, surface, x0: cx * 16, z0: cz * 16, carved: 0 };
  for (let sx = cx - CARVE_RANGE; sx <= cx + CARVE_RANGE; sx++) for (let sz = cz - CARVE_RANGE; sz <= cz + CARVE_RANGE; sz++) {
    const r = mulberry32(hash4(seed, sx, sz, 701));
    const rint = (n) => Math.floor(r() * n);
    // worm caves: most chunks have none, a few have a cluster
    let count = rint(rint(rint(15) + 1) + 1);
    if (rint(3) !== 0) count = 0;
    for (let i = 0; i < count; i++) {
      const x = sx * 16 + rint(16), z = sz * 16 + rint(16);
      const y = MIN_Y + 8 + rint(rint(160) + 8);
      let tunnels = 1;
      if (rint(4) === 0) {
        // a room where several tunnels meet
        const rad = 1 + r() * 6;
        tunnel(ctx, r, x, y, z, 1 + rad * 2, 0, 0, -1, -1, 0.5, false, null);
        tunnels += rint(4);
      }
      const pool = y < 10 ? (r() < 0.3 ? B.LAVA : null) : (r() < 0.1 ? B.WATER : null);
      for (let t = 0; t < tunnels; t++) {
        let width = r() * 2 + r();
        if (rint(10) === 0) width *= r() * r() * 3 + 1;
        tunnel(ctx, r, x, y, z, width, r() * Math.PI * 2, (r() - 0.5) / 4, 0, 0, 1, false, pool);
      }
    }
    // ravines: rare, long and tall
    if (rint(60) === 0) {
      const x = sx * 16 + rint(16), z = sz * 16 + rint(16);
      const y = 10 + rint(60);
      tunnel(ctx, r, x, y, z, (r() * 2 + r()) * 2, r() * Math.PI * 2, (r() - 0.5) / 4, 0, 0, 3, true, null);
    }
  }
  return ctx.carved;
}

/**
 * One tunnel (reference "worm"): `step`/`len` -1 means a single room sphere.
 * yScale stretches the cross-section vertically (3 for ravines).
 */
function tunnel(ctx, r, x, y, z, width, yaw, pitch, step, len, yScale, ravine, pool) {
  let yawD = 0, pitchD = 0;
  const room = step === -1;
  if (room) { step = 0; len = 1; } else if (len <= 0) len = 112 - Math.floor(r() * 28);
  const branchAt = Math.floor(r() * (len / 2)) + Math.floor(len / 4);
  const steep = r() < 1 / 6;
  for (; step < len; step++) {
    const h = room ? width / 2 + 1 : 1.5 + Math.sin(step * Math.PI / len) * width;
    const v = h * yScale;
    if (!room) {
      const cp = Math.cos(pitch);
      x += Math.cos(yaw) * cp; y += Math.sin(pitch); z += Math.sin(yaw) * cp;
      pitch *= steep ? 0.92 : 0.7;
      pitch += pitchD * 0.1; yaw += yawD * (ravine ? 0.05 : 0.1);
      pitchD *= ravine ? 0.8 : 0.9; yawD *= 0.75;
      pitchD += (r() - r()) * r() * 2; yawD += (r() - r()) * r() * 4;
      if (!ravine && step === branchAt && width > 1) {
        tunnel(ctx, r, x, y, z, r() * 0.5 + 0.5, yaw - Math.PI / 2, pitch / 3, step, len, 1, false, pool);
        tunnel(ctx, r, x, y, z, r() * 0.5 + 0.5, yaw + Math.PI / 2, pitch / 3, step, len, 1, false, pool);
        return;
      }
      if (r() < 0.25 && !ravine) continue; // the reference skips a quarter of the spheres
    }
    // only carve what overlaps this chunk
    if (x + h < ctx.x0 - 1 || x - h > ctx.x0 + 17 || z + h < ctx.z0 - 1 || z - h > ctx.z0 + 17) continue;
    carveEllipsoid(ctx, x, y, z, h, v, pool, ravine);
  }
}

function carveEllipsoid(ctx, cx, cy, cz, h, v, pool, ravine) {
  const { blocks, surface, x0, z0 } = ctx;
  const xa = Math.max(0, Math.floor(cx - h) - x0), xb = Math.min(15, Math.ceil(cx + h) - x0);
  const za = Math.max(0, Math.floor(cz - h) - z0), zb = Math.min(15, Math.ceil(cz + h) - z0);
  const ya = Math.max(MIN_Y + 5, Math.floor(cy - v)), yb = Math.ceil(cy + v);
  for (let lx = xa; lx <= xb; lx++) for (let lz = za; lz <= zb; lz++) {
    const dx = (lx + x0 + 0.5 - cx) / h, dz = (lz + z0 + 0.5 - cz) / h;
    const dxz = dx * dx + dz * dz;
    if (dxz >= 1) continue;
    const top = surface[lx + lz * 16];
    for (let y = ya; y <= yb; y++) {
      const dy = (y + 0.5 - cy) / v;
      if (dy < -0.7 && !ravine) continue; // flat-ish floors
      if (dxz + dy * dy * (ravine ? 1 + Math.abs(dy) * 0.3 : 1) >= 1) continue;
      if (top < SEA_LEVEL && y > top - 9) continue; // never open the sea floor
      const i = cidx(lx, y, lz), b = blocks[i];
      if (!b || b === B.BEDROCK || b === B.WATER || b === B.LAVA) continue;
      blocks[i] = y < LAVA_LEVEL ? B.LAVA : pool && dy < -0.35 ? pool : B.AIR;
      ctx.carved++;
    }
  }
}
