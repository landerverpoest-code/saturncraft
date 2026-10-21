// Ruined Rifts: the remains of old obsidian portal frames, scattered across
// the overworld (one 192 x 192 region in three). The frame (4-6 wide, 5-7
// tall inside measures) stands upright or lies toppled, with a third of its
// obsidian missing, on a splash of Cinderstone, gravel and the odd patch of
// lava and fire, next to a chest of gold. Gold blocks sometimes hide in the
// rubble. Kept deterministic from the seed and stamped chunk by chunk.
import { B, BLOCKS, SOLID } from './blocks.js';
import { BIOME } from './biomes.js';
import { MIN_Y, WORLD_HEIGHT, SEA_LEVEL, cidx } from './constants.js';
import { mulberry32, hash4, hashf } from './noise.js';

export const RUIN_REGION = 192;
export const RUIN_LOOT = 7; // loot kind of the chest (mobs/spawnerBlocks.js)
const cache = new Map();
const TREE_PART = new Uint8Array(256);
for (const d of BLOCKS) if (d && /( Log| Leaves|Mushroom Block|Mushroom Stem|Vines|Cocoa)/.test(d.name)) TREE_PART[d.id] = 1;

export function ruinInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(hash4(gen.seed, rx, rz, 4517));
  let o = null;
  if (rng() < 0.34) {
    const R = RUIN_REGION, M = 16;
    const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
    const col = gen.column(cx, cz), top = gen.surfaceAt(cx, cz, col), biome = gen.biomeFor(col, top);
    if (top > SEA_LEVEL && biome !== BIOME.OCEAN && biome !== BIOME.FROZEN_OCEAN) {
      o = {
        cx, cz, y: top + 1, w: 2 + Math.floor(rng() * 3), h: 3 + Math.floor(rng() * 3),
        alongX: rng() < 0.5, toppled: rng() < 0.3, sunk: rng() < 0.3 ? 1 + Math.floor(rng() * 2) : 0,
        seed: Math.floor(rng() * 1e9),
      };
    }
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, o);
  return o;
}

export function ruinsNear(gen, x0, z0, x1, z1) {
  const out = [], R = RUIN_REGION;
  for (let rx = Math.floor((x0 - 12) / R); rx <= Math.floor((x1 + 12) / R); rx++) for (let rz = Math.floor((z0 - 12) / R); rz <= Math.floor((z1 + 12) / R); rz++) {
    const o = ruinInRegion(gen, rx, rz);
    if (o && o.cx + 12 >= x0 && o.cx - 12 <= x1 && o.cz + 12 >= z0 && o.cz - 12 <= z1) out.push(o);
  }
  return out;
}

export function stampRuins(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  for (const o of ruinsNear(gen, X0, Z0, X0 + 15, Z0 + 15)) {
    const inside = (x, y, z) => x >= X0 && x < X0 + 16 && z >= Z0 && z < Z0 + 16 && y > MIN_Y && y < MIN_Y + WORLD_HEIGHT;
    const get = (x, y, z) => blocks[cidx(x - X0, y, z - Z0)];
    const set = (x, y, z, id, m = 0) => { if (!inside(x, y, z)) return; const i = cidx(x - X0, y, z - Z0); blocks[i] = id; meta[i] = m; };
    const h = (x, z, k) => hashf(o.seed, x, z, k);
    const base = o.y - 1 - o.sunk;
    // clear any tree standing where the ruin goes
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) for (let y = base - 3; y <= base + 14; y++) {
      const x = o.cx + dx, z = o.cz + dz;
      if (inside(x, y, z) && TREE_PART[get(x, y, z)]) set(x, y, z, 0);
    }
    // the splash of scorched ground around the frame: Cinderstone, gravel, a little fire and lava
    for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) {
      const x = o.cx + dx, z = o.cz + dz, d = Math.hypot(dx, dz);
      if (!inside(x, base, z) || d > 7 + h(x, z, 1) * 2) continue;
      // the ground surface of this column near the ruin
      let y = base + 4;
      while (y > base - 6 && (!get(x, y, z) || !SOLID[get(x, y, z)] || TREE_PART[get(x, y, z)])) y--;
      if (y <= base - 6) continue;
      const r = h(x, z, 2);
      if (r < 0.55 - d * 0.05) set(x, y, z, B.CINDERSTONE);
      else if (r < 0.7 - d * 0.05) set(x, y, z, B.GRAVEL);
      if (d < 6 && r > 0.97) set(x, y, z, B.LAVA);
      else if (d < 6 && r > 0.93 && get(x, y, z) === B.CINDERSTONE && !get(x, y + 1, z)) set(x, y + 1, z, B.FIRE);
    }
    // the frame: obsidian with a third of it gone (a little crumbled obsidian lies around instead)
    const W = o.w + 2, H = o.h + 2;
    const at = (i, j) => o.toppled
      ? (o.alongX ? [o.cx - 1 + i, base + 1, o.cz - 2 + j] : [o.cx - 2 + j, base + 1, o.cz - 1 + i])
      : (o.alongX ? [o.cx - 1 + i, base + 1 + j, o.cz] : [o.cx, base + 1 + j, o.cz - 1 + i]);
    for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
      const edge = i === 0 || j === 0 || i === W - 1 || j === H - 1;
      const [x, y, z] = at(i, j);
      if (!edge) { if (!o.toppled) set(x, y, z, 0); continue; }
      if (h(i, j, 3) < 0.66) set(x, y, z, B.OBSIDIAN);
      else if (!o.toppled && j === 0) set(x, y, z, B.CINDERSTONE);
    }
    // a plinth of cobblestone and Cinderstone under the frame
    for (let i = -1; i <= W; i++) for (let j = o.toppled ? -1 : 0; j <= (o.toppled ? H : 0); j++) {
      const x = o.toppled ? (o.alongX ? o.cx - 1 + i : o.cx - 2 + j) : (o.alongX ? o.cx - 1 + i : o.cx);
      const z = o.toppled ? (o.alongX ? o.cz - 2 + j : o.cz - 1 + i) : (o.alongX ? o.cz : o.cz - 1 + i);
      set(x, base, z, h(i, j, 4) < 0.5 ? B.CINDERSTONE : B.COBBLESTONE);
    }
    // loose obsidian, a gold block in the rubble and the chest
    for (let k = 0; k < 3; k++) {
      const x = o.cx + Math.floor(h(k, 5, 6) * 9) - 4, z = o.cz + Math.floor(h(k, 6, 7) * 9) - 4;
      if (inside(x, base, z) && h(k, 8, 9) < 0.5) set(x, base + 1, z, B.OBSIDIAN);
    }
    if (h(0, 0, 10) < 0.3) set(o.cx + 2, base, o.cz + 2, B.GOLD_BLOCK);
    const chestX = o.alongX ? o.cx + 1 : o.cx + 2, chestZ = o.alongX ? o.cz + 2 : o.cz + 1;
    set(chestX, base + 1, chestZ, B.CHEST, (o.alongX ? 0 : 3) | 8 | (RUIN_LOOT << 4));
  }
}
