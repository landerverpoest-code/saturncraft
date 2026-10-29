// Cinnabar automation: the pieces that connect the circuits to carts and to moving blocks.
//
// * Pressure plates: the Stone Plate answers creatures and players only, the two weighted plates give a
//   level that grows with how many things stand on them (Light: one per thing, up to 15; Heavy: one per ten).
// * Rails: the Powered, Detector and Activator Rail are straight rails (world/rails.js) with an on/off bit.
//   Powered and Activator Rails are switched by cinnabar power that reaches them or any rail of the same kind
//   in the same line up to eight rails away (a short row of powered rails needs one source).
// * Sticky blocks: a Slime Block and a Honey Block hold on to the blocks around them, so a piston that moves
//   one moves the whole cluster (at most twelve blocks, and nothing it cannot move may be attached). The two
//   do not stick to each other. `pushStructure` works out what moves; world/circuits.js moves it.
import { B, BLOCKS, isFurnace } from './blocks.js';
import { MIN_Y, MAX_Y } from './constants.js';
import { FACING6, isPiston, PISTON_EXTENDED } from './circuitShapes.js';
import { RAIL_EXITS, RAIL_UP, railShapeOf } from './rails.js';

export { plateLevel, isPlate, isWeightedPlate } from './circuitShapes.js';
export { RAIL_ON } from './rails.js';

export const DETECT_TICKS = 4;        // a Detector Rail looks for its cart again this often
export const RAIL_CHAIN = 8;          // rails of one kind that pass power along a line
export const MAX_STRUCTURE = 12;      // blocks one piston can move at once
export const BOOST = 0.06;            // speed a powered rail adds to a cart per tick (the top speed still caps it)
export const RAIL_BRAKE = 0.5;        // an unpowered Powered Rail slows a cart by this factor each tick

/** Level of a weighted plate with `count` things on it. */
export function weightedLevel(id, count) {
  if (count <= 0) return 0;
  return id === B.LIGHT_WEIGHTED_PLATE ? Math.min(15, count) : Math.min(15, Math.ceil(count / 10));
}

// ---- rails ------------------------------------------------------------------------------
/** Is the cinnabar rail at x,y,z switched on (a Detector Rail: a cart is on it)? */
export const railOn = (w, x, y, z) => !!(w.getMeta(x, y, z) & 8);

/**
 * The rails one step along a straight cinnabar rail from x,y,z: [[x,y,z]...] for its two ends (the next rail may
 * be a slope up or down). Only rails of the same id whose own ends point back here count.
 */
export function railNeighbours(w, x, y, z, id) {
  const meta = railShapeOf(id, w.getMeta(x, y, z));
  const out = [];
  for (const [dx, dz] of RAIL_EXITS[meta]) {
    const up = RAIL_UP[meta] && RAIL_UP[meta][0] === dx && RAIL_UP[meta][1] === dz;
    for (const dy of up ? [1] : [0, -1]) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (w.getBlock(nx, ny, nz) !== id) continue;
      const nm = railShapeOf(id, w.getMeta(nx, ny, nz));
      // the neighbour must run back towards us (a rail beside the line is not part of it)
      if (RAIL_EXITS[nm].some(([ex, ez]) => ex === -dx && ez === -dz)) { out.push([nx, ny, nz]); break; }
    }
  }
  return out;
}

/**
 * Should the Powered / Activator Rail at x,y,z be on? `powerAt(x, y, z)` says whether cinnabar power reaches a cell.
 * It is on when power reaches it or a rail of its kind in line with it, within RAIL_CHAIN rails.
 */
export function railShouldBeOn(w, x, y, z, powerAt) {
  const id = w.getBlock(x, y, z);
  if (powerAt(x, y, z)) return true;
  for (const start of railNeighbours(w, x, y, z, id)) {
    let prev = [x, y, z], cur = start;
    for (let i = 1; i <= RAIL_CHAIN; i++) {
      if (powerAt(cur[0], cur[1], cur[2])) return true;
      const next = railNeighbours(w, cur[0], cur[1], cur[2], id).find((n) => n[0] !== prev[0] || n[1] !== prev[1] || n[2] !== prev[2]);
      if (!next) break;
      prev = cur; cur = next;
    }
  }
  return false;
}

/**
 * How a cart's speed along its rail changes on a cinnabar rail. `s` is the speed along the track (positive towards
 * the second exit), `blocked` = [firstExitBlocked, secondExitBlocked] (a solid block at the end of the line).
 */
export function railSpeed(id, on, s, blocked = [false, false]) {
  if (id !== B.POWERED_RAIL) return s;
  if (!on) {
    s *= RAIL_BRAKE;
    return Math.abs(s) < 0.02 ? 0 : s;
  }
  if (Math.abs(s) > 0.01) return s + Math.sign(s) * BOOST;
  // standing still on a powered rail: it pushes away from a wall
  if (blocked[1] && !blocked[0]) return -0.04;
  if (blocked[0] && !blocked[1]) return 0.04;
  return s;
}

// ---- sticky blocks and pistons ---------------------------------------------------------------
export const stickyKind = (id) => (BLOCKS[id] && BLOCKS[id].sticky) || null;
/** Do two neighbouring blocks hold on to each other? (A sticky block holds anything but the other sort of sticky.) */
export function sticks(a, b) {
  const ka = stickyKind(a), kb = stickyKind(b);
  if (!ka && !kb) return false;
  if (ka && kb) return ka === kb;
  return true;
}

/** Blocks a piston cannot move at all (obsidian, containers, extended pistons...). */
export function immovable(id, meta) {
  const d = BLOCKS[id];
  if (!d || d.hardness < 0 || id === B.OBSIDIAN || d.container || isFurnace(id) || id === B.SPAWNER) return true;
  if (id === B.ENCHANTING_TABLE || id === B.PISTON_HEAD || id === B.RIFT || id === B.LECTERN) return true; // (a lectern keeps its book per position)
  if (isPiston(id) && meta & PISTON_EXTENDED) return true;
  return false;
}
/** Blocks a piston breaks (drops) instead of pushing: plants, torches, wire, fluids... */
export function pushBreaks(id) {
  const d = BLOCKS[id];
  return !!d && (d.replaceable || d.needsSupport || !d.solid || !!d.fluid);
}

const key = (x, y, z) => `${x},${y},${z}`;

/**
 * What a piston at (px,py,pz) facing f moves. Extending (pull = false) it pushes the block in front of its head and
 * whatever that block pushes or holds on to; a sticky piston retracting (pull = true) draws back the block two
 * cells in front of it (the head cell having just been emptied) and what holds on to that.
 * Returns { ok, moves: [[x,y,z,id,meta]...], breaks: [[x,y,z]...], cells: destination cells }.
 */
export function pushStructure(w, px, py, pz, f, pull = false, isImmovable = immovable, isBreakable = pushBreaks) {
  const dir = FACING6[f], md = pull ? [-dir[0], -dir[1], -dir[2]] : dir;
  const head = [px + dir[0], py + dir[1], pz + dir[2]];
  const blockAt = (x, y, z) => (pull && x === head[0] && y === head[1] && z === head[2] ? 0 : w.getBlock(x, y, z));
  const inside = (x, y, z) => y >= MIN_Y && y <= MAX_Y && !(w.isLoaded && !w.isLoaded(x, z));
  const fail = { ok: false, moves: [], breaks: [], cells: [] };
  const members = new Map(), breaks = new Map();
  const root = pull ? [head[0] + dir[0], head[1] + dir[1], head[2] + dir[2]] : head;
  if (!inside(root[0], root[1], root[2])) return fail;
  const rid = blockAt(root[0], root[1], root[2]);
  if (!rid) return { ok: true, moves: [], breaks: [], cells: [] };
  if (isBreakable(rid)) {
    if (pull) return { ok: true, moves: [], breaks: [], cells: [] }; // nothing to draw back
    return { ok: true, moves: [], breaks: [[root[0], root[1], root[2]]], cells: [] };
  }
  const stack = [root];
  while (stack.length) {
    const [x, y, z] = stack.pop();
    const k = key(x, y, z);
    if (members.has(k)) continue;
    const id = blockAt(x, y, z), meta = w.getMeta(x, y, z);
    if (isImmovable(id, meta)) return fail;
    if (members.size >= MAX_STRUCTURE) return fail;
    members.set(k, [x, y, z, id, meta]);
    // whatever is in the way
    const fx = x + md[0], fy = y + md[1], fz = z + md[2];
    if (!inside(fx, fy, fz)) return fail;
    const fid = blockAt(fx, fy, fz);
    if (fid && !members.has(key(fx, fy, fz))) {
      if (isBreakable(fid)) breaks.set(key(fx, fy, fz), [fx, fy, fz]);
      else if (pull) return fail;
      else stack.push([fx, fy, fz]);
    }
    // whatever it holds on to
    if (stickyKind(id)) {
      for (const d of FACING6) {
        const nx = x + d[0], ny = y + d[1], nz = z + d[2];
        if ((nx === px && ny === py && nz === pz) || (nx === head[0] && ny === head[1] && nz === head[2])) continue; // the piston itself
        const nid = blockAt(nx, ny, nz);
        if (!nid || members.has(key(nx, ny, nz)) || isBreakable(nid) || !sticks(id, nid)) continue;
        stack.push([nx, ny, nz]);
      }
    }
  }
  // a destination that is neither empty nor leaving would block a pull
  const moves = [...members.values()];
  const cells = moves.map(([x, y, z]) => [x + md[0], y + md[1], z + md[2]]);
  for (const [cx, cy, cz] of cells) {
    if (!inside(cx, cy, cz)) return fail;
    if (members.has(key(cx, cy, cz))) continue;
    const id = blockAt(cx, cy, cz);
    if (id && !isBreakable(id)) return fail;
  }
  return { ok: true, moves, breaks: [...breaks.values()], cells };
}

/** Order `moves` so that each block is set into its new cell before the cell it leaves is needed: farthest along dir first. */
export function moveOrder(moves, md) {
  return [...moves].sort((a, b) => (b[0] * md[0] + b[1] * md[1] + b[2] * md[2]) - (a[0] * md[0] + a[1] * md[1] + a[2] * md[2]));
}
