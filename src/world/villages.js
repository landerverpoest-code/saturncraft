// Villages. Every 320 x 320 block region may hold one (80 %), centred in a
// plains, desert, taiga or snowy plains spot on dry land. The plan (well,
// four roads, houses, farms and lamp posts beside the roads) is derived from
// the seed alone, so every chunk can stamp its own share of it and buildings
// join up across chunk borders. Settlers are spawned from the plan on the main
// thread when a chunk is generated.
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL, MIN_Y, WORLD_HEIGHT, cidx } from './constants.js';
import { mulberry32, hash4 } from './noise.js';
import { SIDE_DIRS, DOOR_UPPER, BED_HEAD } from './shapes.js';

export const VILLAGE_REGION = 320;
const REACH = 56; // how far buildings may reach from the centre
export const PROFESSIONS = ['farmer', 'librarian', 'smith', 'shepherd', 'butcher'];

const STYLES = {
  plains: { corner: B.OAK_LOG, wall: B.OAK_PLANKS, floor: B.COBBLESTONE, roof: B.OAK_STAIRS, roofSlab: B.OAK_SLAB, fence: B.OAK_FENCE },
  desert: { corner: B.SANDSTONE, wall: B.SANDSTONE, floor: B.SANDSTONE, roof: B.SANDSTONE_STAIRS, roofSlab: B.SANDSTONE_SLAB, fence: B.OAK_FENCE },
  taiga: { corner: B.SPRUCE_LOG, wall: B.SPRUCE_PLANKS, floor: B.COBBLESTONE, roof: B.COBBLESTONE_STAIRS, roofSlab: B.COBBLESTONE_SLAB, fence: B.SPRUCE_FENCE },
};

const cache = new Map();

/** The village of region (rx, rz), or null. */
export function villageInRegion(gen, rx, rz) {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const v = planVillage(gen, rx, rz);
  if (cache.size > 64) cache.clear();
  cache.set(key, v);
  return v;
}

function planVillage(gen, rx, rz) {
  const rng = mulberry32(hash4(gen.seed, rx, rz, 4242));
  if (rng() > 0.8) return null;
  const R = VILLAGE_REGION;
  const cx = rx * R + REACH + Math.floor(rng() * (R - 2 * REACH)), cz = rz * R + REACH + Math.floor(rng() * (R - 2 * REACH));
  const col = gen.column(cx, cz);
  const y = gen.surfaceAt(cx, cz, col) + 1;
  const biome = gen.biomeFor(col, y - 1);
  if (![BIOME.PLAINS, BIOME.DESERT, BIOME.TAIGA, BIOME.SNOWY_PLAINS].includes(biome)) return null;
  if (y <= SEA_LEVEL + 1 || y > SEA_LEVEL + 45) return null;
  const style = biome === BIOME.DESERT ? 'desert' : biome === BIOME.PLAINS ? 'plains' : 'taiga';
  const pieces = [{ type: 'well', x0: cx - 2, z0: cz - 2, x1: cx + 1, z1: cz + 1, y }];
  const roads = [];
  const taken = (a) => pieces.some((p) => a.x0 <= p.x1 + 1 && a.x1 >= p.x0 - 1 && a.z0 <= p.z1 + 1 && a.z1 >= p.z0 - 1);
  let houseNo = 0;
  for (let s = 0; s < 4; s++) {
    const [dx, , dz] = SIDE_DIRS[s];
    const len = 16 + Math.floor(rng() * 18);
    // three-wide road from the well outwards
    for (let k = 2; k <= len; k++) for (let w = -1; w <= 1; w++) roads.push([cx + dx * k + (dz ? w : 0), cz + dz * k + (dx ? w : 0)]);
    // buildings on both sides every 9 blocks
    for (let k = 6; k <= len - 2; k += 9) for (const side of [-1, 1]) {
      if (rng() > 0.8) continue;
      const r = rng();
      const type = r < 0.62 ? 'house' : r < 0.85 ? 'farm' : 'lamp';
      const [w, d] = type === 'house' ? (rng() < 0.5 ? [5, 5] : [7, 5]) : type === 'farm' ? [7, 9] : [1, 1];
      // perpendicular offset from the road centre line; the front faces the road
      const off = 3 + Math.floor(d / 2);
      const bx = cx + dx * k + (dz ? side * off : 0), bz = cz + dz * k + (dx ? side * off : 0);
      const alongX = dx !== 0; // road runs along x: building depth goes along z
      const hw = Math.floor((alongX ? w : d) / 2), hd = Math.floor((alongX ? d : w) / 2);
      const p = { type, x0: bx - hw, x1: bx - hw + (alongX ? w : d) - 1, z0: bz - hd, z1: bz - hd + (alongX ? d : w) - 1 };
      if (taken(p)) continue;
      const gy = gen.surfaceAt(bx, bz) + 1;
      if (gy <= SEA_LEVEL + 1 || Math.abs(gy - y) > 7) continue;
      p.y = gy;
      // facing: side index pointing from the building towards the road
      p.facing = alongX ? (side > 0 ? 0 : 2) : (side > 0 ? 3 : 1);
      if (type === 'house') p.profession = PROFESSIONS[(houseNo++ + Math.floor(rng() * 5)) % 5];
      p.seed = Math.floor(rng() * 1e9);
      pieces.push(p);
    }
    pieces.push({ type: 'lamp', x0: cx + dx * (len + 1) + (dz ? 2 : 0), x1: cx + dx * (len + 1) + (dz ? 2 : 0), z0: cz + dz * (len + 1) + (dx ? 2 : 0), z1: cz + dz * (len + 1) + (dx ? 2 : 0), y: gen.surfaceAt(cx + dx * (len + 1) + (dz ? 2 : 0), cz + dz * (len + 1) + (dx ? 2 : 0)) + 1, seed: 1 });
  }
  return { cx, cz, y, biome, style, pieces, roads, x0: cx - REACH, x1: cx + REACH, z0: cz - REACH, z1: cz + REACH };
}

/** Villages whose area overlaps the box [x0, x1] x [z0, z1]. */
export function villagesNear(gen, x0, z0, x1, z1) {
  const out = [];
  for (let rx = Math.floor((x0 - REACH) / VILLAGE_REGION); rx <= Math.floor((x1 + REACH) / VILLAGE_REGION); rx++)
    for (let rz = Math.floor((z0 - REACH) / VILLAGE_REGION); rz <= Math.floor((z1 + REACH) / VILLAGE_REGION); rz++) {
      const v = villageInRegion(gen, rx, rz);
      if (v && v.x0 <= x1 && v.x1 >= x0 && v.z0 <= z1 && v.z1 >= z0) out.push(v);
    }
  return out;
}

/** Interior spot (feet) where a house's settler lives. */
export function houseHome(p) { return { x: Math.floor((p.x0 + p.x1) / 2) + 0.5, y: p.y, z: Math.floor((p.z0 + p.z1) / 2) + 0.5 }; }

// ---- stamping ----------------------------------------------------------------

/** Write the parts of nearby villages that fall inside chunk (cx, cz). */
export function stampVillages(gen, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  for (const v of villagesNear(gen, X0, Z0, X0 + 15, Z0 + 15)) {
    const st = STYLES[v.style];
    const inChunk = (x, z) => x >= X0 && x < X0 + 16 && z >= Z0 && z < Z0 + 16;
    const set = (x, y, z, id, m = 0) => {
      if (!inChunk(x, z) || y < MIN_Y || y >= MIN_Y + WORLD_HEIGHT) return;
      const i = cidx(x - X0, y, z - Z0);
      blocks[i] = id; meta[i] = m;
    };
    const get = (x, y, z) => (inChunk(x, z) && y >= MIN_Y && y < MIN_Y + WORLD_HEIGHT ? blocks[cidx(x - X0, y, z - Z0)] : 0);
    const solidGround = (id) => id && id !== B.WATER && id !== B.OAK_LEAVES && id !== B.BIRCH_LEAVES && id !== B.SPRUCE_LEAVES && id !== B.TALL_GRASS && id !== B.SUNPETAL && id !== B.REDBLOOM && id !== B.OAK_LOG && id !== B.BIRCH_LOG && id !== B.SPRUCE_LOG;
    // roads: path blocks on the ground (planks over water)
    for (const [x, z] of v.roads) {
      if (!inChunk(x, z)) continue;
      let y = v.y + 8;
      while (y > v.y - 10 && !solidGround(get(x, y, z)) && get(x, y, z) !== B.WATER) y--;
      if (get(x, y, z) === B.WATER) set(x, y, z, v.style === 'desert' ? B.SANDSTONE : B.OAK_PLANKS);
      else if (get(x, y, z) === B.GRASS || get(x, y, z) === B.DIRT || get(x, y, z) === B.SAND || get(x, y, z) === B.SNOWY_GRASS || get(x, y, z) === B.GRAVEL) set(x, y, z, B.DIRT_PATH);
      for (let k = 1; k <= 3; k++) if (get(x, y + k, z) && !solidGround(get(x, y + k, z))) set(x, y + k, z, B.AIR);
    }
    for (const p of v.pieces) {
      if (p.x1 < X0 || p.x0 >= X0 + 16 || p.z1 < Z0 || p.z0 >= Z0 + 16) continue;
      // foundation down to the ground, and clear room above
      const height = p.type === 'house' ? 7 : p.type === 'lamp' ? 4 : 4;
      const pad = p.type === 'lamp' ? 0 : 1;
      for (let x = p.x0 - pad; x <= p.x1 + pad; x++) for (let z = p.z0 - pad; z <= p.z1 + pad; z++) {
        if (!inChunk(x, z)) continue;
        const edge = x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1;
        for (let y = p.y - 2, n = 0; n < 14 && !solidGround(get(x, y, z)); y--, n++) set(x, y, z, edge ? B.DIRT : st.floor);
        if (!edge) set(x, p.y - 1, z, p.type === 'farm' ? B.DIRT : st.floor);
        else if (get(x, p.y - 1, z) !== B.DIRT_PATH) set(x, p.y - 1, z, v.style === 'desert' ? B.SAND : B.GRASS);
        for (let y = p.y; y < p.y + height; y++) set(x, y, z, B.AIR);
      }
      BUILDERS[p.type](p, st, set, mulberry32(p.seed || 7), v.style);
    }
  }
}

const BUILDERS = {
  well(p, st, set) {
    const y = p.y;
    for (let x = p.x0; x <= p.x1; x++) for (let z = p.z0; z <= p.z1; z++) {
      const inner = x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1;
      for (let d = 1; d <= 4; d++) set(x, y - d, z, inner && d < 4 ? B.WATER : B.COBBLESTONE);
      set(x, y, z, inner ? B.AIR : B.COBBLESTONE);
      const corner = (x === p.x0 || x === p.x1) && (z === p.z0 || z === p.z1);
      if (corner) { set(x, y + 1, z, st.fence); set(x, y + 2, z, st.fence); }
      set(x, y + 3, z, B.COBBLESTONE_SLAB, 0);
    }
  },

  lamp(p, st, set) {
    const x = p.x0, z = p.z0, y = p.y;
    set(x, y, z, st.fence); set(x, y + 1, z, st.fence); set(x, y + 2, z, B.WOOL, 0);
    for (let s = 0; s < 4; s++) set(x + SIDE_DIRS[s][0], y + 2, z + SIDE_DIRS[s][2], B.TORCH, 1 + ((s + 2) & 3));
  },

  farm(p, st, set, rng) {
    const y = p.y - 1;
    const alongX = p.x1 - p.x0 > p.z1 - p.z0;
    const cr = rng();
    const crop = cr < 0.45 ? B.WHEAT : cr < 0.65 ? B.CARROTS : cr < 0.85 ? B.POTATOES : B.BEETROOTS;
    for (let x = p.x0; x <= p.x1; x++) for (let z = p.z0; z <= p.z1; z++) {
      const border = x === p.x0 || x === p.x1 || z === p.z0 || z === p.z1;
      const mid = alongX ? z === Math.floor((p.z0 + p.z1) / 2) : x === Math.floor((p.x0 + p.x1) / 2);
      if (border) set(x, y, z, B.OAK_LOG);
      else if (mid) set(x, y, z, B.WATER);
      else { set(x, y, z, B.FARMLAND, 7); set(x, y + 1, z, crop, Math.floor(rng() * 8)); }
    }
  },

  house(p, st, set, rng) {
    const y = p.y, f = p.facing;
    const [fx, , fz] = SIDE_DIRS[f];
    const W = 3; // wall height
    for (let x = p.x0; x <= p.x1; x++) for (let z = p.z0; z <= p.z1; z++) {
      const ex = x === p.x0 || x === p.x1, ez = z === p.z0 || z === p.z1;
      set(x, y - 1, z, st.floor);
      for (let h = 0; h < W; h++) {
        if (ex && ez) set(x, y + h, z, st.corner);
        else if (ex || ez) set(x, y + h, z, st.wall);
      }
      // roof: stairs along the two long edges, slabs on top
      const longX = p.x1 - p.x0 >= p.z1 - p.z0;
      if (longX ? ez : ex) set(x, y + W, z, st.roof, longX ? (z === p.z0 ? 2 : 0) : (x === p.x0 ? 1 : 3));
      else set(x, y + W, z, st.wall);
      if (!(ex || ez)) set(x, y + W + 1, z, st.roofSlab, 0);
    }
    // front door in the middle of the wall facing the road
    const mx = Math.floor((p.x0 + p.x1) / 2), mz = Math.floor((p.z0 + p.z1) / 2);
    const dx = fx > 0 ? p.x1 : fx < 0 ? p.x0 : mx, dz = fz > 0 ? p.z1 : fz < 0 ? p.z0 : mz;
    set(dx, y, dz, B.DOOR, f); set(dx, y + 1, dz, B.DOOR, f | DOOR_UPPER);
    set(dx + fx, y - 1, dz + fz, B.DIRT_PATH);
    // windows in the two side walls
    const left = (f + 1) & 3, right = (f + 3) & 3;
    for (const s of [left, right]) {
      const [sx, , sz] = SIDE_DIRS[s];
      const wx = sx > 0 ? p.x1 : sx < 0 ? p.x0 : mx, wz = sz > 0 ? p.z1 : sz < 0 ? p.z0 : mz;
      set(wx, y + 1, wz, B.GLASS_PANE);
    }
    // bed against the back wall, a workbench or chest and a torch
    const back = (f + 2) & 3;
    const [bx, , bz] = SIDE_DIRS[back];
    const hx = bx > 0 ? p.x1 - 1 : bx < 0 ? p.x0 + 1 : mx + 1, hz = bz > 0 ? p.z1 - 1 : bz < 0 ? p.z0 + 1 : mz + 1;
    set(hx, y, hz, B.BED, back | BED_HEAD);
    set(hx - bx, y, hz - bz, B.BED, back);
    const sideCell = bx ? [hx, hz - 1] : [hx - 1, hz];
    set(sideCell[0], y, sideCell[1], rng() < 0.5 ? B.WORKBENCH : B.CHEST, f);
    const tside = left, [tx, , tz] = SIDE_DIRS[tside];
    set(mx + tx * (Math.floor((p.x1 - p.x0) / 2) - 1), y + 2, mz + tz * (Math.floor((p.z1 - p.z0) / 2) - 1), B.TORCH, 1 + tside);
  },
};
