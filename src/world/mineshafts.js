// Abandoned mineshafts: one in four 192 x 192-block regions holds a network
// of 3x3 corridors (a central dirt room, branching straight runs with oak
// supports every 4 blocks, rails down the middle, the odd loot chest and
// cobwebs) somewhere between y = -40 and y = 30. Like villages the plan
// comes from the seed alone and each chunk stamps its own part.
import { B } from './blocks.js';
import { MIN_Y, WORLD_HEIGHT, cidx } from './constants.js';
import { mulberry32, hash4 } from './noise.js';

export const MINESHAFT_REGION = 192;
const cache = new Map();

export function mineshaftInRegion(seed, rx, rz) {
  const key = `${seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const m = planMineshaft(seed, rx, rz);
  if (cache.size > 64) cache.clear();
  cache.set(key, m);
  return m;
}

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function planMineshaft(seed, rx, rz) {
  const rng = mulberry32(hash4(seed, rx, rz, 7171));
  if (rng() > 0.25) return null;
  const R = MINESHAFT_REGION, M = 40;
  const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
  const y = -40 + Math.floor(rng() * 70);
  const room = { x0: cx - 3, z0: cz - 3, x1: cx + 3, z1: cz + 3, y };
  const corridors = [];
  const queue = DIRS.map((d, i) => ({ x: cx + d[0] * 4, z: cz + d[1] * 4, dir: i, depth: 0 }));
  while (queue.length && corridors.length < 36) {
    const c = queue.shift();
    const [dx, dz] = DIRS[c.dir];
    const len = 4 * (3 + Math.floor(rng() * 6)); // 12..32
    const ex = c.x + dx * len, ez = c.z + dz * len;
    if (ex < rx * R + 8 || ex > rx * R + R - 8 || ez < rz * R + 8 || ez > rz * R + R - 8) continue;
    corridors.push({ x: c.x, z: c.z, dir: c.dir, len, y, rails: rng() < 0.6, chest: rng() < 0.2 ? Math.floor(rng() * len) : -1, webs: rng() < 0.3 });
    if (c.depth >= 4) continue;
    // at the end: carry on, or branch left and/or right
    const r = rng();
    if (r < 0.35) queue.push({ x: ex, z: ez, dir: c.dir, depth: c.depth + 1 });
    if (r > 0.25) queue.push({ x: ex, z: ez, dir: (c.dir + 1) & 3, depth: c.depth + 1 });
    if (r > 0.6) queue.push({ x: ex, z: ez, dir: (c.dir + 3) & 3, depth: c.depth + 1 });
  }
  return { cx, cz, y, room, corridors, x0: rx * R, x1: rx * R + R, z0: rz * R, z1: rz * R + R };
}

export function mineshaftsNear(seed, x0, z0, x1, z1) {
  const out = [], R = MINESHAFT_REGION;
  for (let rx = Math.floor(x0 / R); rx <= Math.floor(x1 / R); rx++) for (let rz = Math.floor(z0 / R); rz <= Math.floor(z1 / R); rz++) {
    const m = mineshaftInRegion(seed, rx, rz);
    if (m) out.push(m);
  }
  return out;
}

/** Carve the parts of nearby mineshafts that fall inside chunk (cx, cz). */
export function stampMineshafts(seed, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  for (const m of mineshaftsNear(seed, X0, Z0, X0 + 15, Z0 + 15)) {
    const inChunk = (x, z) => x >= X0 && x < X0 + 16 && z >= Z0 && z < Z0 + 16;
    const idx = (x, y, z) => cidx(x - X0, y, z - Z0);
    const okY = (y) => y > MIN_Y + 1 && y < MIN_Y + WORLD_HEIGHT - 1;
    const set = (x, y, z, id, mt = 0) => { if (inChunk(x, z) && okY(y)) { const i = idx(x, y, z); blocks[i] = id; meta[i] = mt; } };
    const get = (x, y, z) => (inChunk(x, z) && okY(y) ? blocks[idx(x, y, z)] : 1);
    const carve = (x, y, z) => { const b = get(x, y, z); if (b !== B.WATER && b !== B.LAVA && b !== B.BEDROCK) set(x, y, z, B.AIR); };
    // the room: a dirt floor and four blocks of headroom
    const r = m.room;
    for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) {
      if (!inChunk(x, z)) continue;
      set(x, r.y - 1, z, B.DIRT);
      for (let y = r.y; y < r.y + 4; y++) carve(x, y, z);
    }
    for (const c of m.corridors) {
      const [dx, dz] = DIRS[c.dir], sx = -dz, sz = dx; // sideways
      const h = (k, s) => (hash4(seed, c.x * 31 + k, c.z * 17 + s, 99) >>> 0) / 4294967296;
      for (let k = 0; k < c.len; k++) {
        const x = c.x + dx * k, z = c.z + dz * k;
        // a quick reject when no part of this slice is in the chunk
        if (!inChunk(x, z) && !inChunk(x + sx, z + sz) && !inChunk(x - sx, z - sz)) continue;
        for (let s = -1; s <= 1; s++) {
          const bx = x + sx * s, bz = z + sz * s;
          if (!inChunk(bx, bz)) continue;
          for (let y = c.y; y < c.y + 3; y++) carve(bx, y, bz);
          const below = get(bx, c.y - 1, bz);
          if (below === B.AIR || below === B.WATER || below === B.LAVA) set(bx, c.y - 1, bz, B.OAK_PLANKS); // bridge over caves
        }
        const support = k % 4 === 2;
        if (support) {
          for (const s of [-1, 1]) { set(x + sx * s, c.y, z + sz * s, B.OAK_FENCE); set(x + sx * s, c.y + 1, z + sz * s, B.OAK_FENCE); }
          for (let s = -1; s <= 1; s++) set(x + sx * s, c.y + 2, z + sz * s, B.OAK_PLANKS);
        }
        if (c.rails && h(k, 1) < 0.9) set(x, c.y, z, B.RAIL, dx ? 1 : 0);
        if (c.webs && !support && h(k, 2) < 0.12) set(x + sx * (h(k, 3) < 0.5 ? -1 : 1), c.y + 2, z + sz * (h(k, 3) < 0.5 ? -1 : 1), B.COBWEB);
        if (k === c.chest && !support) set(x - sx, c.y, z - sz, B.CHEST, ((c.dir + 1) & 3) | 8 | (1 << 4));
      }
    }
  }
}
