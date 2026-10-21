// Tide Citadels (reference: ocean monuments). At most one per 32 x 32-chunk
// region (512 blocks, the reference spacing), placed like the reference
// structure: a random chunk within the first 27 chunks of the region on each
// axis (the average of two rolls, so the middle is likelier; 5 chunks of
// separation), kept only where the ocean is deep. Each citadel is a symmetric
// 58 x 58 temple of tidestone standing on the ocean floor (base at y 39, top
// at y 61), flooded with water:
//
//   * the lower hall (h 0..8): a grid of 7 x 7 rooms around a central gallery
//     that runs back from the entrance, with doorways between rooms, lanterns
//     in the ceilings and a few sponge rooms whose ceilings are hung with Wet
//     Soakmoss;
//   * two wings at the back corners (h 9..17) and a terrace over the middle
//     (h 9..14), reached through openings in the hall roof;
//   * the core (h 15..21) on top of the terrace: a dark tidestone shell around
//     8 gold blocks;
//   * pillars and a skirt of tidestone down to the sea floor.
//
// Planned from the seed alone (monumentInRegion) and stamped chunk by chunk
// (stampMonuments) like the other structures, so it spans chunks seamlessly.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { MIN_Y, WORLD_HEIGHT, SEA_LEVEL, cidx } from './constants.js';
import { mulberry32, hash4 } from './noise.js';

export const MONUMENT_SPACING = 32;     // chunks per region side (reference spacing)
export const MONUMENT_SEPARATION = 5;   // chunks kept free at the far edge of each region
export const MONUMENT_REGION = MONUMENT_SPACING * 16;
export const MONUMENT_SIZE = 58;
export const MONUMENT_HEIGHT = 22;
export const MONUMENT_BASE_Y = SEA_LEVEL - 24; // 39, as in the reference game
const S = MONUMENT_SIZE - 1;              // 57: last local coordinate
const OCEANS = new Set([BIOME.OCEAN, BIOME.FROZEN_OCEAN]);

const cache = new Map();

/**
 * The citadel planned for region (rx, rz), or null. Needs deep ocean: the
 * centre and eight points around the footprint must be ocean whose floor lies
 * at most a few blocks above the citadel's base.
 */
export function monumentInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 9191));
  const span = MONUMENT_SPACING - MONUMENT_SEPARATION; // 27 possible chunks per axis
  const offX = Math.floor((Math.floor(rng() * span) + Math.floor(rng() * span)) / 2);
  const offZ = Math.floor((Math.floor(rng() * span) + Math.floor(rng() * span)) / 2);
  const rot = Math.floor(rng() * 4), seed = Math.floor(rng() * 1e9);
  const cx = (rx * MONUMENT_SPACING + offX) * 16 + 8, cz = (rz * MONUMENT_SPACING + offZ) * 16 + 8;
  let m = null;
  const y = MONUMENT_BASE_Y;
  const deep = [[0, 0], [-26, -26], [26, -26], [-26, 26], [26, 26], [0, -28], [0, 28], [-28, 0], [28, 0]].every(([dx, dz], i) => {
    const col = gen.column(cx + dx, cz + dz), top = gen.surfaceAt(cx + dx, cz + dz, col);
    return OCEANS.has(gen.biomeFor(col, top)) && top <= y + (i === 0 ? 4 : 9);
  });
  if (deep) m = { cx, cz, y, rot, seed, x0: cx - 29, z0: cz - 29, x1: cx - 29 + S, z1: cz - 29 + S };
  if (cache.size > 64) cache.clear();
  cache.set(key, m);
  return m;
}

/** Citadels whose footprint overlaps the box [x0, x1] x [z0, z1]. */
export function monumentsNear(gen, x0, z0, x1, z1) {
  const out = [], R = MONUMENT_REGION;
  for (let rx = Math.floor((x0 - 64) / R); rx <= Math.floor((x1 + 64) / R); rx++) for (let rz = Math.floor((z0 - 64) / R); rz <= Math.floor((z1 + 64) / R); rz++) {
    const m = monumentInRegion(gen, rx, rz);
    if (m && m.x1 >= x0 && m.x0 <= x1 && m.z1 >= z0 && m.z0 <= z1) out.push(m);
  }
  return out;
}

/** The nearest citadel to (x, z), searching rings of regions outwards (null if none within `maxRings`). */
export function nearestMonument(gen, x, z, maxRings = 6) {
  const R = MONUMENT_REGION, prx = Math.floor(x / R), prz = Math.floor(z / R);
  let best = null, bd = Infinity, stopAt = maxRings;
  for (let r = 0; r <= stopAt; r++) for (let rx = prx - r; rx <= prx + r; rx++) for (let rz = prz - r; rz <= prz + r; rz++) {
    if (Math.max(Math.abs(rx - prx), Math.abs(rz - prz)) !== r) continue;
    const m = monumentInRegion(gen, rx, rz);
    if (!m) continue;
    const d = Math.hypot(m.cx - x, m.cz - z);
    if (d < bd) { bd = d; best = m; stopAt = Math.min(stopAt, r + 1); }
  }
  return best;
}

/** World (x, z) of local (u, v) (u across the entrance, v from the entrance to the back). */
export function toWorld(m, u, v) {
  switch (m.rot) {
    case 1: return [m.x0 + S - v, m.z0 + u];
    case 2: return [m.x0 + S - u, m.z0 + S - v];
    case 3: return [m.x0 + v, m.z0 + S - u];
    default: return [m.x0 + u, m.z0 + v];
  }
}
/** Local (u, v) of world (x, z). */
export function toLocal(m, x, z) {
  const a = x - m.x0, b = z - m.z0;
  switch (m.rot) {
    case 1: return [b, S - a];
    case 2: return [S - a, S - b];
    case 3: return [S - b, a];
    default: return [a, b];
  }
}

/** Is world (x, y, z) inside the citadel's box (where Deepeyes spawn)? */
export function inMonument(m, x, y, z, margin = 0) {
  return x >= m.x0 - margin && x <= m.x1 + margin && z >= m.z0 - margin && z <= m.z1 + margin && y >= m.y - 2 - margin && y <= m.y + MONUMENT_HEIGHT + margin;
}

/** Where the three Elder Deepeyes wait: one in each wing and one in the core. */
export function elderSpots(m) {
  return [[6, 41, 12], [S - 6, 41, 12], [28, 33, 17]].map(([u, v, h]) => { const [x, z] = toWorld(m, u, v); return [x + 0.5, m.y + h, z + 0.5]; });
}

const hashU = (m, a, b, salt) => hash4(m.seed, a, b, salt) / 4294967296;

/** Sponge rooms: one or two mirrored pairs of lower-hall rooms (cell indices [cu 0..2, cv 0..6]). */
export function spongeRooms(m) {
  const rng = mulberry32(m.seed ^ 0x5a5a);
  const n = 1 + (rng() < 0.5 ? 1 : 0), out = [];
  while (out.length < n) {
    const cu = Math.floor(rng() * 3), cv = Math.floor(rng() * 7);
    if (!out.some(([a, b]) => a === cu && b === cv)) out.push([cu, cv]);
  }
  return out;
}

/**
 * The block at local (u, h, v) of citadel m (h = height above the base):
 * a block id (B.WATER for the flooded inside), or -1 outside the citadel's
 * hull (the terrain stays). Symmetric under u -> 57 - u.
 */
export function monumentBlock(m, u, h, v, sponge = spongeRooms(m)) {
  if (u < 0 || u > S || v < 0 || v > S || h < 0 || h > MONUMENT_HEIGHT) return -1;
  const mu = Math.min(u, S - u); // 0..28, mirrored
  const W = B.WATER;
  // ---- lower hall, h 0..8 -------------------------------------------------------
  if (h <= 8) {
    const outer = u === 0 || u === S || v === 0 || v === S;
    if (h === 0) {
      if (mu >= 27 && v % 8 === 4 && v > 0 && v < S) return B.TIDE_LANTERN; // lights down the gallery
      if (mu >= 27) return B.DARK_TIDESTONE;
      return outer || mu % 8 === 0 || v % 8 === 0 ? B.TIDESTONE_BRICKS : B.TIDESTONE;
    }
    if (h === 8) {
      // the roof, open over the gallery (into the terrace) and in each wing
      if (mu >= 26 && v >= 9 && v <= 46) return W;
      if (mu >= 5 && mu <= 7 && v >= 40 && v <= 42) return W;
      return outer || mu === 13 ? B.DARK_TIDESTONE : B.TIDESTONE_BRICKS;
    }
    if (outer) {
      // the entrance: a gallery-wide opening framed in dark tidestone
      if (v === 0 && mu >= 26) return h <= 6 ? W : B.DARK_TIDESTONE;
      if (v === 0 && mu === 25) return B.DARK_TIDESTONE;
      const along = u === 0 || u === S ? v : mu;
      if (h === 4 && along % 8 === 4) return B.TIDE_LANTERN;
      if ((h === 2 || h === 3) && along % 8 === 2 && along > 0) return W; // little windows
      if ((u === 0 || u === S) && (v === 0 || v === S)) return B.DARK_TIDESTONE;
      return h === 1 || h === 7 ? B.DARK_TIDESTONE : B.TIDESTONE_BRICKS;
    }
    // inner walls: along v at mu = 8, 16, 24 (the gallery's walls); across at v = 8, 16, ... 48 (not in the gallery)
    const wallU = mu === 8 || mu === 16 || mu === 24, wallV = v % 8 === 0 && v < 56 && mu < 25;
    if (wallU || wallV) {
      if (wallU && wallV) return B.DARK_TIDESTONE; // pillars where walls meet
      if (wallU) {
        const cv = v >> 3, dv = v & 7;
        const open = mu === 24 || hashU(m, mu, cv, 31) < 0.75;
        if (open && dv >= 3 && dv <= 5 && h <= 3) return W;
      } else {
        const cu = mu >> 3, du = mu & 7;
        const open = hashU(m, cu, v, 37) < 0.7;
        if (open && du >= 3 && du <= 5 && h <= 3) return W;
      }
      return h === 7 ? B.TIDESTONE_BRICKS : B.TIDESTONE;
    }
    // inside a room or the gallery
    if (mu < 24) {
      const cu = mu >> 3, cv = v >> 3;
      if (h === 7 && (mu & 7) === 4 && (v & 7) === 4) return B.TIDE_LANTERN;
      if (h >= 6 && sponge.some(([a, b]) => a === cu && b === cv)) {
        const r = hashU(m, mu * 64 + v, h, 41);
        if (r < (h === 7 ? 0.65 : 0.25)) return B.WET_SOAKMOSS;
      }
    }
    return W;
  }
  // ---- terrace over the middle (h 9..14) -----------------------------------------
  const inTerrace = mu >= 13 && v >= 9 && v <= 44 && h <= 14;
  const inWing = mu >= 1 && mu <= 11 && v >= 28 && v <= 54 && h <= 17;
  const inCore = mu >= 19 && v >= 15 && v <= 38 && h >= 15 && h <= 21;
  if (inCore) {
    const wall = mu === 19 || v === 15 || v === 38;
    if (h === 21) return wall ? B.DARK_TIDESTONE : B.TIDESTONE_BRICKS;
    // the treasure: 8 gold blocks in a dark tidestone shell
    if (mu >= 28 && v >= 26 && v <= 27 && h >= 16 && h <= 17) return B.GOLD_BLOCK;
    if (mu >= 27 && v >= 25 && v <= 28 && h >= 15 && h <= 18) return B.DARK_TIDESTONE;
    if (wall) {
      if (h === 18 && (mu === 19 ? v : mu) % 6 === 3) return B.TIDE_LANTERN;
      if (h >= 16 && h <= 17 && (mu === 19 ? (v % 6 === 0) : (mu % 6 === 0 && mu < 27))) return W;
      return h === 15 || h === 20 ? B.DARK_TIDESTONE : B.TIDESTONE_BRICKS;
    }
    if (h === 20 && mu === 24 && (v === 20 || v === 33)) return B.TIDE_LANTERN;
    return W;
  }
  if (h === 22 && mu === 19 && (v === 15 || v === 38)) return B.TIDE_LANTERN; // beacons on the core's corners
  if (inTerrace) {
    const wall = mu === 13 || v === 9 || v === 44;
    if (h === 14) {
      if (mu >= 26 && v >= 33 && v <= 35) return W; // a shaft up into the core
      return wall ? B.DARK_TIDESTONE : B.TIDESTONE_BRICKS;
    }
    if (wall) {
      if (h === 11 && (mu === 13 ? v : mu) % 4 === 1) return W;
      if (h === 13 && (mu === 13 ? v : mu) % 8 === 5) return B.TIDE_LANTERN;
      if (mu === 13 && (v === 9 || v === 44)) return B.DARK_TIDESTONE;
      return B.TIDESTONE_BRICKS;
    }
    if (h === 13 && mu === 20 && v % 8 === 4) return B.TIDE_LANTERN;
    return W;
  }
  if (inWing) {
    const wall = mu === 1 || mu === 11 || v === 28 || v === 54;
    const corner = (mu === 1 || mu === 11) && (v === 28 || v === 54);
    if (h === 17) return corner ? B.TIDE_LANTERN : wall ? B.DARK_TIDESTONE : B.TIDESTONE_BRICKS;
    if (wall) {
      if (corner) return B.DARK_TIDESTONE;
      if (h === 12 && (mu === 1 || mu === 11 ? v : mu) % 4 === 2) return W;
      if (h === 15 && (mu === 1 || mu === 11 ? v : mu) % 6 === 3) return B.TIDE_LANTERN;
      return h === 9 || h === 16 ? B.DARK_TIDESTONE : B.TIDESTONE_BRICKS;
    }
    return W;
  }
  return -1;
}

/** Stamp the parts of nearby citadels inside chunk (cx, cz) (after terrain, water and decoration). */
export function stampMonuments(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  for (const m of monumentsNear(gen, X0, Z0, X0 + 15, Z0 + 15)) {
    const sponge = spongeRooms(m);
    for (let x = Math.max(X0, m.x0); x <= Math.min(X0 + 15, m.x1); x++) for (let z = Math.max(Z0, m.z0); z <= Math.min(Z0 + 15, m.z1); z++) {
      const [u, v] = toLocal(m, x, z);
      const lx = x - X0, lz = z - Z0;
      for (let h = 0; h <= MONUMENT_HEIGHT; h++) {
        const id = monumentBlock(m, u, h, v, sponge);
        const y = m.y + h;
        if (y <= MIN_Y || y >= MIN_Y + WORLD_HEIGHT) continue;
        const i = cidx(lx, y, lz);
        if (id >= 0) { blocks[i] = id; meta[i] = 0; }
        else if (y < SEA_LEVEL) { blocks[i] = B.WATER; meta[i] = 0; } // keep the citadel clear of the sea floor
      }
      for (let y = m.y + MONUMENT_HEIGHT + 1; y < SEA_LEVEL; y++) { const i = cidx(lx, y, lz); blocks[i] = B.WATER; meta[i] = 0; }
      // a skirt round the edge and pillars under the walls' crossings, down to the sea floor
      const mu = Math.min(u, S - u);
      const edge = u === 0 || u === S || v === 0 || v === S;
      const pillar = mu % 8 === 0 && v % 8 === 0;
      if (edge || pillar) {
        for (let y = m.y - 1; y > MIN_Y + 1; y--) {
          const i = cidx(lx, y, lz), b = blocks[i];
          if (b !== B.WATER && b !== B.AIR && b !== B.ICE) break;
          blocks[i] = pillar ? B.DARK_TIDESTONE : B.TIDESTONE; meta[i] = 0;
        }
      }
    }
  }
}
