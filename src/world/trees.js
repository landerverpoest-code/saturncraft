// Tree shapes shared by world generation and saplings: a list of
// [dx, dy, dz, block, force] relative to the trunk base, in placement order.
// Leaves never replace other blocks; logs (force) replace anything soft.
import { B } from './blocks.js';
import { hashf, mulberry32 } from './noise.js';
import { SIDE_DIRS } from './shapes.js';

export const LEAVES = new Set([B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES, B.JUNGLE_LEAVES, B.ACACIA_LEAVES, B.DARK_OAK_LEAVES]);
export const LOGS = new Set([B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.JUNGLE_LOG, B.ACACIA_LOG, B.DARK_OAK_LOG]);

/**
 * Blocks of a tree of `kind`; r in [0,1) picks the variation. Kinds: 'oak',
 * 'birch', 'spruce', 'swamp_oak', 'jungle', 'jungle_big', 'jungle_bush',
 * 'acacia', 'dark_oak', 'brown_mushroom', 'red_mushroom'. Entries are
 * [dx, dy, dz, block, force, meta?] (meta: the side a vine hangs on).
 */
export function treeShape(kind, r) {
  if (BIG_SHAPES[kind]) return BIG_SHAPES[kind](mulberry32((Math.floor(r * 4294967296) ^ 0x5bd1e995) | 0));
  const out = [];
  if (kind === 'spruce') {
    const h = 6 + Math.floor(r * 4);
    const leafStart = 2 + Math.floor(r * 2);
    let radius = 0;
    for (let k = h; k >= leafStart; k--) {
      for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > radius + (radius > 1 ? 1 : 0)) continue;
        out.push([dx, k, dz, B.SPRUCE_LEAVES, false]);
      }
      radius = radius >= 2 ? (k % 2 ? 1 : 2) : radius + 1;
      if (k > h - 2) radius = Math.min(radius, 1);
    }
    out.push([0, h + 1, 0, B.SPRUCE_LEAVES, false]);
    for (let k = 0; k < h; k++) out.push([0, k, 0, B.SPRUCE_LOG, true]);
    out.push([0, -1, 0, B.DIRT, true]);
    out.height = h + 2;
    return out;
  }
  const log = kind === 'birch' ? B.BIRCH_LOG : B.OAK_LOG;
  const leaf = kind === 'birch' ? B.BIRCH_LEAVES : B.OAK_LEAVES;
  const h = (kind === 'birch' ? 5 : 4) + Math.floor(r * 3);
  for (let yy = h - 3; yy <= h; yy++) {
    const layer = yy - h;
    const radius = layer >= -1 ? 1 : 2;
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
      if (corner && (layer === 0 || hashf(dx, yy, dz, Math.floor(r * 1e6)) < 0.5)) continue;
      out.push([dx, yy, dz, leaf, false]);
    }
  }
  for (let k = 0; k < h; k++) out.push([0, k, 0, log, true]);
  out.push([0, -1, 0, B.DIRT, true]);
  out.height = h + 1;
  return out;
}

// --- Shapes for the newer biomes -------------------------------------------

/** Round leaf layer of radius rad centred on (cx, cz) (.5 centres for 2x2 trunks). */
function disc(out, cx, y, cz, rad, leaf, cut = 0.3) {
  const r0 = Math.floor(cx - rad), r1 = Math.ceil(cx + rad), q0 = Math.floor(cz - rad), q1 = Math.ceil(cz + rad);
  for (let dx = r0; dx <= r1; dx++) for (let dz = q0; dz <= q1; dz++) {
    if ((dx - cx) ** 2 + (dz - cz) ** 2 <= (rad + cut) * (rad + cut)) out.push([dx, y, dz, leaf, false]);
  }
}

/**
 * Drop duplicate spots and leaves more than 4 steps from any log (so leaf
 * decay never eats a fresh tree), then order leaves, logs, vines.
 */
function finish(out, maxDist = 4) {
  const logs = out.filter((e) => e[4] && e[1] >= 0);
  const seen = new Set();
  for (const e of out) if (e[4]) seen.add(`${e[0]},${e[1]},${e[2]}`);
  const leaves = [], vines = [];
  for (const e of out) {
    if (e[4]) continue;
    const k = `${e[0]},${e[1]},${e[2]}`;
    if (seen.has(k)) continue;
    if (LEAVES.has(e[3])) {
      let best = 99;
      for (const l of logs) { const d = Math.abs(l[0] - e[0]) + Math.abs(l[1] - e[1]) + Math.abs(l[2] - e[2]); if (d < best) best = d; }
      if (best > maxDist) continue;
    }
    seen.add(k);
    (e[3] === B.VINES ? vines : leaves).push(e);
  }
  const all = [...leaves, ...out.filter((e) => e[4]), ...vines];
  let top = 0;
  for (const e of all) top = Math.max(top, e[1] + 1);
  all.height = top;
  return all;
}

/** Hang vines off the sides of leaves (and optionally trunks) with chance p, up to maxLen long. */
function addVines(out, rng, p, maxLen, fromLogs = false) {
  const occ = new Set(out.map((e) => `${e[0]},${e[1]},${e[2]}`));
  const add = [];
  for (const e of out) {
    const isLeaf = LEAVES.has(e[3]);
    if (!(isLeaf || (fromLogs && LOGS.has(e[3]) && e[1] >= 1))) continue;
    for (let s = 0; s < 4; s++) {
      const x = e[0] - SIDE_DIRS[s][0], z = e[2] - SIDE_DIRS[s][2]; // the block hung from is on side s of the vine
      if (occ.has(`${x},${e[1]},${z}`) || rng() >= p) continue;
      const len = isLeaf ? 1 + Math.floor(rng() * maxLen) : 1;
      for (let k = 0; k < len; k++) {
        const y = e[1] - k, key = `${x},${y},${z}`;
        if (y < 1 || occ.has(key)) break;
        occ.add(key);
        add.push([x, y, z, B.VINES, false, s]);
      }
    }
  }
  out.push(...add);
}

function trunk(out, log, h, wide = false) {
  const cells = wide ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]];
  for (const [x, z] of cells) {
    for (let k = 0; k < h; k++) out.push([x, k, z, log, true]);
    out.push([x, -1, z, B.DIRT, true]);
  }
}

/** Oak-style canopy: two wide layers and two narrow ones on top. */
function oakCrown(out, rng, h, leaf, wide) {
  for (let yy = h - 3; yy <= h; yy++) {
    const layer = yy - h, rad = layer >= -1 ? 1 : wide;
    for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
      const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
      if (corner && (layer === 0 || rad === 3 || rng() < 0.5)) continue;
      out.push([dx, yy, dz, leaf, false]);
    }
  }
}

const BIG_SHAPES = {
  // Swamp oak: wide, low canopy dripping with vines
  swamp_oak(rng) {
    const out = [], h = 5 + Math.floor(rng() * 3);
    oakCrown(out, rng, h, B.OAK_LEAVES, 3);
    trunk(out, B.OAK_LOG, h);
    addVines(out, rng, 0.3, 4);
    return finish(out);
  },
  // Small jungle tree: tall thin trunk wrapped in vines
  jungle(rng) {
    const out = [], h = 5 + Math.floor(rng() * 5);
    oakCrown(out, rng, h, B.JUNGLE_LEAVES, 2);
    trunk(out, B.JUNGLE_LOG, h);
    addVines(out, rng, 0.25, 3, true);
    // cocoa pods on the trunk (side = towards the log)
    if (rng() < 0.4) for (const [dx, dz, side] of [[1, 0, 3], [-1, 0, 1], [0, 1, 0], [0, -1, 2]]) if (rng() < 0.4) out.push([dx, 2 + Math.floor(rng() * 2), dz, B.COCOA, false, side | (Math.floor(rng() * 3) << 2)]);
    return finish(out);
  },
  // Giant jungle tree: 2x2 trunk, side branches with leaf tufts, a big crown and vines
  jungle_big(rng) {
    const out = [], h = 13 + Math.floor(rng() * 12);
    trunk(out, B.JUNGLE_LOG, h, true);
    for (let y = h - 2; y <= h + 1; y++) disc(out, 0.5, y, 0.5, y <= h - 1 ? 4 : y === h ? 3 : 2, B.JUNGLE_LEAVES);
    for (let y = Math.floor(h / 2); y < h - 4; y += 2 + Math.floor(rng() * 3)) {
      const a = rng() * Math.PI * 2, len = 2 + Math.floor(rng() * 2);
      let bx = 0, bz = 0;
      for (let k = 1; k <= len; k++) {
        bx = Math.round(0.5 + Math.cos(a) * (k + 0.7)); bz = Math.round(0.5 + Math.sin(a) * (k + 0.7));
        out.push([bx, y + (k > 1 ? 1 : 0), bz, B.JUNGLE_LOG, true]);
      }
      for (let dy = 0; dy <= 2; dy++) disc(out, bx, y + 1 + dy, bz, dy === 2 ? 1 : 2, B.JUNGLE_LEAVES, 0.1);
    }
    addVines(out, rng, 0.45, 1, true);
    addVines(out, rng, 0.12, 5);
    return finish(out);
  },
  // Jungle bush: one log under a mound of leaves
  jungle_bush(rng) {
    const out = [];
    disc(out, 0, 0, 0, 2, B.JUNGLE_LEAVES, rng() * 0.5);
    disc(out, 0, 1, 0, 1, B.JUNGLE_LEAVES, 0.4);
    out.push([0, 2, 0, B.JUNGLE_LEAVES, false]);
    out.push([0, 0, 0, B.JUNGLE_LOG, true]);
    out.push([0, -1, 0, B.DIRT, true]);
    return finish(out);
  },
  // Acacia: short trunk leaning out to a flat, wide crown (sometimes a second, lower one)
  acacia(rng) {
    const out = [];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const base = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < base; k++) out.push([0, k, 0, B.ACACIA_LOG, true]);
    out.push([0, -1, 0, B.DIRT, true]);
    const d = Math.floor(rng() * 4);
    let x = 0, y = base - 1, z = 0;
    const lean = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < lean; k++) { x += dirs[d][0]; z += dirs[d][1]; y++; out.push([x, y, z, B.ACACIA_LOG, true]); }
    y++; out.push([x, y, z, B.ACACIA_LOG, true]);
    disc(out, x, y + 1, z, 3, B.ACACIA_LEAVES, -0.2);
    disc(out, x, y + 2, z, 1, B.ACACIA_LEAVES, 0.5);
    if (rng() < 0.5) {
      const d2 = d ^ 1;
      let bx = 0, by = base - 2 + Math.floor(rng() * 2), bz = 0;
      for (let k = 0; k < 2; k++) { bx += dirs[d2][0]; bz += dirs[d2][1]; by++; out.push([bx, by, bz, B.ACACIA_LOG, true]); }
      disc(out, bx, by + 1, bz, 2, B.ACACIA_LEAVES, 0);
      disc(out, bx, by + 2, bz, 1, B.ACACIA_LEAVES, 0.2);
    }
    return finish(out);
  },
  // Dark oak: thick 2x2 trunk with stubby branches under a broad, dense crown
  dark_oak(rng) {
    const out = [], h = 6 + Math.floor(rng() * 3);
    trunk(out, B.DARK_OAK_LOG, h, true);
    for (const [bx, bz] of [[-1, -1], [2, -1], [-1, 2], [2, 2]]) if (rng() < 0.8) out.push([bx, h - 2, bz, B.DARK_OAK_LOG, true]);
    for (const [bx, bz] of [[-1, 0], [2, 1], [1, -1], [0, 2]]) if (rng() < 0.35) out.push([bx, h - 3, bz, B.DARK_OAK_LOG, true]);
    disc(out, 0.5, h - 2, 0.5, 4.2, B.DARK_OAK_LEAVES);
    disc(out, 0.5, h - 1, 0.5, 4.2, B.DARK_OAK_LEAVES);
    disc(out, 0.5, h, 0.5, 3.2, B.DARK_OAK_LEAVES);
    disc(out, 0.5, h + 1, 0.5, 2, B.DARK_OAK_LEAVES);
    return finish(out);
  },
  // Huge mushrooms: a pale stem under a flat brown cap or a red dome
  brown_mushroom(rng) {
    const out = [], h = 4 + Math.floor(rng() * 3);
    for (let k = 0; k < h; k++) out.push([0, k, 0, B.MUSHROOM_STEM, true]);
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
      out.push([dx, h, dz, B.BROWN_MUSHROOM_BLOCK, false]);
    }
    return finish(out);
  },
  red_mushroom(rng) {
    const out = [], h = 4 + Math.floor(rng() * 3);
    for (let k = 0; k < h; k++) out.push([0, k, 0, B.MUSHROOM_STEM, true]);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) out.push([dx, h, dz, B.RED_MUSHROOM_BLOCK, false]);
    for (let y = h - 3; y < h; y++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) < 2 && Math.abs(dz) < 2) continue; // hollow ring
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue; // without corners
      out.push([dx, y, dz, B.RED_MUSHROOM_BLOCK, false]);
    }
    return finish(out);
  },
};

export const PLANTS = new Set([B.TALL_GRASS, B.SUNPETAL, B.REDBLOOM, B.SKYBELL, B.ROSETTE, B.BROWN_MUSHROOM, B.RED_MUSHROOM, B.DEAD_BUSH, B.VINES]);
const SOFT = new Set([B.AIR, ...PLANTS,
  B.OAK_SAPLING, B.BIRCH_SAPLING, B.SPRUCE_SAPLING, B.JUNGLE_SAPLING, B.ACACIA_SAPLING, B.DARK_OAK_SAPLING]);

/**
 * Grow a tree from a sapling at x,y,z in a live world. Fails (returns false)
 * when the trunk would run into something solid or out of the world.
 */
export function growTree(world, x, y, z, kind, rng = Math.random) {
  const shape = treeShape(kind, rng());
  for (let k = 1; k < shape.height; k++) {
    const id = world.getBlock(x, y + k, z);
    if (!SOFT.has(id) && !LEAVES.has(id)) return false;
  }
  // wide trunks and leaning or branching logs need room as well
  for (const [dx, dy, dz, , force] of shape) {
    if (!force || dy < 0 || (!dx && !dz)) continue;
    const id = world.getBlock(x + dx, y + dy, z + dz);
    if (!SOFT.has(id) && !LEAVES.has(id)) return false;
  }
  for (const [dx, dy, dz, id, force, meta] of shape) {
    if (dy < 0) continue; // keep the ground as it is
    const cur = world.getBlock(x + dx, y + dy, z + dz);
    if (force ? (SOFT.has(cur) || LEAVES.has(cur)) : SOFT.has(cur)) {
      world.setBlock(x + dx, y + dy, z + dz, id, meta || 0);
    }
  }
  return true;
}

export const SAPLING_TREE = { [B.OAK_SAPLING]: 'oak', [B.BIRCH_SAPLING]: 'birch', [B.SPRUCE_SAPLING]: 'spruce',
  [B.JUNGLE_SAPLING]: 'jungle', [B.ACACIA_SAPLING]: 'acacia', [B.DARK_OAK_SAPLING]: 'dark_oak' };
export const LEAF_SAPLING = { [B.OAK_LEAVES]: B.OAK_SAPLING, [B.BIRCH_LEAVES]: B.BIRCH_SAPLING, [B.SPRUCE_LEAVES]: B.SPRUCE_SAPLING,
  [B.JUNGLE_LEAVES]: B.JUNGLE_SAPLING, [B.ACACIA_LEAVES]: B.ACACIA_SAPLING, [B.DARK_OAK_LEAVES]: B.DARK_OAK_SAPLING };

/**
 * Leaf decay: natural leaves (meta 0) with no log within 4 steps through
 * leaves and logs fall apart. Player-placed leaves have meta 1 and stay.
 */
export function leavesConnected(world, x, y, z, maxDist = 4) {
  const seen = new Set([`${x},${y},${z}`]);
  let frontier = [[x, y, z]];
  for (let d = 1; d <= maxDist && frontier.length; d++) {
    const next = [];
    for (const [fx, fy, fz] of frontier) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const nx = fx + dx, ny = fy + dy, nz = fz + dz, k = `${nx},${ny},${nz}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const id = world.getBlock(nx, ny, nz);
        if (LOGS.has(id)) return true;
        if (LEAVES.has(id)) next.push([nx, ny, nz]);
      }
    }
    frontier = next;
  }
  return false;
}
