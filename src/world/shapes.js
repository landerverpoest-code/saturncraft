// Collision and selection boxes for blocks that are not full cubes (doors,
// ladders, wall torches). Boxes are block-local [x0, y0, z0, x1, y1, z1].
//
// Side indices (used in meta) follow the furnace convention:
// 0 = -z, 1 = +x, 2 = +z, 3 = -x.
import { B, BLOCKS, SHAPE, BLOCK_LIMIT } from './blocks.js';
import { circuitSelection, circuitCollision } from './circuitShapes.js';
import { crystalBox, rodBoxes } from './caves.js';

export const SIDE_DIRS = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];

/** Side index of a horizontal unit vector, or -1. */
export function sideOf(dx, dz) {
  for (let s = 0; s < 4; s++) if (SIDE_DIRS[s][0] === dx && SIDE_DIRS[s][2] === dz) return s;
  return -1;
}

const T = 3 / 16; // door thickness

/** 3/16-thick slab hugging side s of the block. */
function sideSlab(s, t, y0 = 0, y1 = 1) {
  switch (s) {
    case 0: return [0, y0, 0, 1, y1, t];
    case 1: return [1 - t, y0, 0, 1, y1, 1];
    case 2: return [0, y0, 1 - t, 1, y1, 1];
    default: return [0, y0, 0, t, y1, 1];
  }
}

// Door meta: bits 0-1 facing side (towards the player who placed it),
// bit 2 open, bit 3 upper half. Closed, the panel hugs the facing side; open,
// it swings to the side counter-clockwise from it.
export const DOOR_OPEN = 4, DOOR_UPPER = 8;
export function doorBox(meta) {
  const f = meta & 3;
  return sideSlab(meta & DOOR_OPEN ? (f + 3) & 3 : f, T);
}

/** Ladder meta: side index of the wall it hangs on. */
export function ladderBox(meta) { return sideSlab(meta & 3, 2 / 16); }

/**
 * Torch meta: 0 = standing on the floor, 1..4 = on the wall at side meta-1.
 * Returns the selection box.
 */
export function torchBox(meta) {
  if (!meta) return [0.375, 0, 0.375, 0.625, 0.625, 0.625];
  const [dx, , dz] = SIDE_DIRS[(meta - 1) & 3];
  const cx = 0.5 + dx * 0.34, cz = 0.5 + dz * 0.34;
  return [cx - 0.16, 0.2, cz - 0.16, cx + 0.16, 0.85, cz + 0.16];
}

export const SLAB_TOP = 1, SLAB_DOUBLE = 2, STAIRS_UPSIDE = 4;
const SLAB_BOXES = [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 1, 1, 1], [0, 0, 0, 1, 1, 1]];
export function slabBox(meta) { return SLAB_BOXES[Math.min(2, meta)]; }
/** Quarter of the block in the corner between two perpendicular sides. */
function quarter(a, b, y0, y1) {
  const A = sideSlab(a, 0.5, y0, y1), Bx = sideSlab(b, 0.5, y0, y1);
  return [Math.max(A[0], Bx[0]), y0, Math.max(A[2], Bx[2]), Math.min(A[3], Bx[3]), y1, Math.min(A[5], Bx[5])];
}
/**
 * Stairs: a half slab plus the raised half on the side the player faced when
 * placing. With `nb(dx, dz)` -> [id, meta] of neighbours the shape follows the
 * reference corner rules: a perpendicular stair in front of the raised side
 * makes an outer corner (only a raised quarter), one behind makes an inner
 * corner (raised half plus a quarter).
 */
export function stairBoxes(meta, nb = null, isStairs = null) {
  const up = meta & STAIRS_UPSIDE, s = meta & 3;
  const [ry0, ry1] = up ? [0, 0.5] : [0.5, 1];
  const base = up ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
  if (nb && isStairs) {
    const same = (n) => n && isStairs(n[0]) && (n[1] & STAIRS_UPSIDE) === up;
    const perp = (f) => ((f + s) & 1) === 1;
    const at = (side) => nb(SIDE_DIRS[side][0], SIDE_DIRS[side][2]);
    // a neighbour on `side` that is a stair facing like us blocks a corner towards it
    const blocks = (side) => { const n = at(side); return same(n) && (n[1] & 3) === s; };
    const front = at(s);
    if (same(front) && perp(front[1] & 3) && !blocks((front[1] + 2) & 3)) return [base, quarter(s, front[1] & 3, ry0, ry1)];
    const back = at((s + 2) & 3);
    if (same(back) && perp(back[1] & 3) && !blocks(back[1] & 3)) return [base, sideSlab(s, 0.5, ry0, ry1), quarter((s + 2) & 3, back[1] & 3, ry0, ry1)];
  }
  return [base, sideSlab(s, 0.5, ry0, ry1)];
}

// ---- fences and gates -------------------------------------------------------
export const GATE_OPEN = 4;
const P0 = 6 / 16, P1 = 10 / 16;
/** Does a fence connect towards a neighbouring block? */
export function fenceConnects(id) {
  const d = BLOCKS[id];
  return !!d && (d.shape === SHAPE.FENCE || d.shape === SHAPE.GATE || (d.opaque && d.solid && d.shape === SHAPE.CUBE));
}
/** Connection mask (bit per side 0..3) of the fence at x,y,z from a block getter. */
export function fenceMask(get, x, y, z) {
  let m = 0;
  for (let s = 0; s < 4; s++) if (fenceConnects(get(x + SIDE_DIRS[s][0], y, z + SIDE_DIRS[s][2]))) m |= 1 << s;
  return m;
}
/** Post plus one arm per connected side; `h` is the height (1.5 for collision). */
export function fenceBoxes(mask, h = 1) {
  const out = [[P0, 0, P0, P1, h, P1]];
  for (let s = 0; s < 4; s++) {
    if (!(mask & (1 << s))) continue;
    if (s === 0) out.push([P0, 0, 0, P1, h, P0]);
    else if (s === 1) out.push([P1, 0, P0, 1, h, P1]);
    else if (s === 2) out.push([P0, 0, P1, P1, h, 1]);
    else out.push([0, 0, P0, P0, h, P1]);
  }
  return out;
}
/** Rails for rendering a fence: posts and two bars per connected side. */
export function fenceRenderBoxes(mask) {
  const out = [[P0, 0, P0, P1, 1, P1]];
  const R0 = 7 / 16, R1 = 9 / 16;
  for (let s = 0; s < 4; s++) {
    if (!(mask & (1 << s))) continue;
    for (const [y0, y1] of [[6 / 16, 9 / 16], [12 / 16, 15 / 16]]) {
      if (s === 0) out.push([R0, y0, 0, R1, y1, P0]);
      else if (s === 1) out.push([P1, y0, R0, 1, y1, R1]);
      else if (s === 2) out.push([R0, y0, P1, R1, y1, 1]);
      else out.push([0, y0, R0, P0, y1, R1]);
    }
  }
  return out;
}
/** Gate across the block (perpendicular to its facing); open gates fold back along the posts. */
export function gateRenderBoxes(meta) {
  const alongX = (meta & 1) === 0; // facing -z/+z: the gate spans x
  const open = meta & GATE_OPEN;
  const C0 = 7 / 16, C1 = 9 / 16;
  const boxes = [];
  const box = (a0, y0, b0, a1, y1, b1) => boxes.push(alongX ? [a0, y0, b0, a1, y1, b1] : [b0, y0, a0, b1, y1, a1]);
  box(0, 5 / 16, C0, 2 / 16, 1, C1); box(14 / 16, 5 / 16, C0, 1, 1, C1);   // posts
  if (!open) {
    for (const [y0, y1] of [[6 / 16, 9 / 16], [12 / 16, 15 / 16]]) box(2 / 16, y0, C0, 14 / 16, y1, C1);
    box(6 / 16, 9 / 16, C0, 8 / 16, 12 / 16, C1); box(8 / 16, 9 / 16, C0, 10 / 16, 12 / 16, C1);
  } else {
    const dir = (meta & 3) < 2 ? -1 : 1, z0 = dir < 0 ? 0 : C1, z1 = dir < 0 ? C0 : 1; // folded towards the facing side
    for (const [y0, y1] of [[6 / 16, 9 / 16], [12 / 16, 15 / 16]]) { box(0, y0, z0, 2 / 16, y1, z1); box(14 / 16, y0, z0, 1, y1, z1); }
  }
  return boxes;
}
// ---- walls and trapdoors ----------------------------------------------------
export function wallConnects(id) {
  const d = BLOCKS[id];
  return !!d && (d.shape === SHAPE.WALL || d.shape === SHAPE.GATE || (d.opaque && d.solid && d.shape === SHAPE.CUBE));
}
export function wallMask(get, x, y, z) {
  let m = 0;
  for (let s = 0; s < 4; s++) if (wallConnects(get(x + SIDE_DIRS[s][0], y, z + SIDE_DIRS[s][2]))) m |= 1 << s;
  return m;
}
/** Post (left out on a straight run, like the reference) plus 6-wide arms 14/16 high; `h` overrides heights for collision. */
export function wallBoxes(mask, h = 0) {
  const W0 = 5 / 16, W1 = 11 / 16, A = h || 14 / 16;
  const straight = mask === 5 || mask === 10;
  const out = straight ? [] : [[4 / 16, 0, 4 / 16, 12 / 16, h || 1, 12 / 16]];
  if (mask & 1) out.push([W0, 0, 0, W1, A, straight ? 1 : 4 / 16]);
  if (mask & 2 && !straight) out.push([12 / 16, 0, W0, 1, A, W1]);
  if (mask & 4 && !straight) out.push([W0, 0, 12 / 16, W1, A, 1]);
  if (mask & 8) out.push([0, 0, W0, straight ? 1 : 4 / 16, A, W1]);
  return out;
}
export const TRAPDOOR_OPEN = 4, TRAPDOOR_TOP = 8;
const TD = 3 / 16;
/** A trapdoor lies flat (bottom or top of the block) or, open, stands against its hinge side. */
export function trapdoorBox(meta) {
  if (!(meta & TRAPDOOR_OPEN)) return meta & TRAPDOOR_TOP ? [0, 1 - TD, 0, 1, 1, 1] : [0, 0, 0, 1, TD, 1];
  switch (meta & 3) {
    case 0: return [0, 0, 0, 1, 1, TD];
    case 1: return [1 - TD, 0, 0, 1, 1, 1];
    case 2: return [0, 0, 1 - TD, 1, 1, 1];
    default: return [0, 0, 0, TD, 1, 1];
  }
}

/** Glass panes connect to panes and to full blocks (glass included). */
export function paneConnects(id) {
  const d = BLOCKS[id];
  return !!d && (d.shape === SHAPE.PANE || (d.solid && d.shape === SHAPE.CUBE && (d.opaque || id === B.GLASS)));
}
export function paneMask(get, x, y, z) {
  let m = 0;
  for (let s = 0; s < 4; s++) if (paneConnects(get(x + SIDE_DIRS[s][0], y, z + SIDE_DIRS[s][2]))) m |= 1 << s;
  return m;
}
/** Thin full-height post plus an arm per connected side. */
export function paneBoxes(mask) {
  const A = 7 / 16, Z = 9 / 16;
  const out = [[A, 0, A, Z, 1, Z]];
  if (mask & 1) out.push([A, 0, 0, Z, 1, A]);
  if (mask & 2) out.push([Z, 0, A, 1, 1, Z]);
  if (mask & 4) out.push([A, 0, Z, Z, 1, 1]);
  if (mask & 8) out.push([0, 0, A, A, 1, Z]);
  return out;
}

export function gateCollision(meta) {
  if (meta & GATE_OPEN) return [];
  return [(meta & 1) === 0 ? [0, 0, 6 / 16, 1, 1.5, 10 / 16] : [6 / 16, 0, 0, 10 / 16, 1.5, 1]];
}

export const BED_HEAD = 8;
export const BED_BOX = [0, 0, 0, 1, 9 / 16, 1];

// ---- enchanting table and anvil (SHAPE.BOXES) --------------------------------
const TABLE_BOXES = [[0, 0, 0, 1, 12 / 16, 1]];
// anvil with its long axis along x: base, waist, neck and the wide top
const ANVIL_X = [[2 / 16, 0, 2 / 16, 14 / 16, 4 / 16, 14 / 16], [3 / 16, 4 / 16, 4 / 16, 13 / 16, 5 / 16, 12 / 16],
  [4 / 16, 5 / 16, 6 / 16, 12 / 16, 10 / 16, 10 / 16], [0, 10 / 16, 3 / 16, 1, 1, 13 / 16]];
const ANVIL_Z = ANVIL_X.map(([x0, y0, z0, x1, y1, z1]) => [z0, y0, x0, z1, y1, x1]);
// signs: a board on a post, or a board against a wall
const SIGN_Z = [[0, 8 / 16, 7 / 16, 1, 1, 9 / 16], [7 / 16, 0, 7 / 16, 9 / 16, 8 / 16, 9 / 16]];
const SIGN_X = SIGN_Z.map(([x0, y0, z0, x1, y1, z1]) => [z0, y0, x0, z1, y1, x1]);
const WALL_SIGN = [[0, 4.5 / 16, 0, 1, 12.5 / 16, 2 / 16], [14 / 16, 4.5 / 16, 0, 1, 12.5 / 16, 1], [0, 4.5 / 16, 14 / 16, 1, 12.5 / 16, 1], [0, 4.5 / 16, 0, 2 / 16, 12.5 / 16, 1]].map((b) => [b]);
/** Cocoa pod: grows from 4 to 8 pixels wide, hanging from the log at side meta & 3. */
export function cocoaBox(meta) {
  const age = Math.min(2, (meta >> 2) & 3), w = (4 + age * 2) / 16, h = (5 + age * 2) / 16;
  const [dx, , dz] = SIDE_DIRS[meta & 3];
  const cx = 0.5 + dx * (0.5 - w / 2 - 1 / 16), cz = 0.5 + dz * (0.5 - w / 2 - 1 / 16);
  return [cx - w / 2, 12 / 16 - h, cz - w / 2, cx + w / 2, 12 / 16, cz + w / 2];
}
const FRAME_BOXES = [[2 / 16, 2 / 16, 0, 14 / 16, 14 / 16, 1 / 16], [15 / 16, 2 / 16, 2 / 16, 1, 14 / 16, 14 / 16], [2 / 16, 2 / 16, 15 / 16, 14 / 16, 14 / 16, 1], [0, 2 / 16, 2 / 16, 1 / 16, 14 / 16, 14 / 16]].map((b) => [b]);
// campfire: two logs along x, two across on top, a bed of embers between
const CAMPFIRE_BOXES = [[0, 0, 1 / 16, 1, 4 / 16, 5 / 16], [0, 0, 11 / 16, 1, 4 / 16, 15 / 16],
  [1 / 16, 3 / 16, 0, 5 / 16, 7 / 16, 1], [11 / 16, 3 / 16, 0, 15 / 16, 7 / 16, 1], [5 / 16, 0, 5 / 16, 11 / 16, 1 / 16, 11 / 16]];
const LANTERN_STANDING = [[5 / 16, 0, 5 / 16, 11 / 16, 7 / 16, 11 / 16], [6 / 16, 7 / 16, 6 / 16, 10 / 16, 9 / 16, 10 / 16]];
const LANTERN_HANGING = [[5 / 16, 1 / 16, 5 / 16, 11 / 16, 8 / 16, 11 / 16], [6 / 16, 8 / 16, 6 / 16, 10 / 16, 10 / 16, 10 / 16], [7.5 / 16, 10 / 16, 7.5 / 16, 8.5 / 16, 1, 8.5 / 16]];
// candles: 1-4 thin sticks of wax ([x, z, height] in pixels)
export const CANDLE_SPOTS = [[[7, 7, 6]], [[5, 7, 6], [9, 6, 5]], [[7, 5, 6], [5, 9, 5], [9, 8, 4]], [[5, 5, 6], [9, 5, 5], [5, 9, 5], [9, 9, 4]]];
const CANDLE_BOXES = CANDLE_SPOTS.map((spots) => spots.map(([x, z, h]) => [x / 16, 0, z / 16, (x + 2) / 16, h / 16, (z + 2) / 16]));
// scaffolding: a top plate on four corner posts; for collision only the plate, and only to
// whoever is above it and not sneaking (Body.move fills SCAFFOLD_CTX for the move it makes)
const SCAFFOLD_BOXES = [[0, 14 / 16, 0, 1, 1, 1], [0, 0, 0, 2 / 16, 14 / 16, 2 / 16], [14 / 16, 0, 0, 1, 14 / 16, 2 / 16], [0, 0, 14 / 16, 2 / 16, 14 / 16, 1], [14 / 16, 0, 14 / 16, 1, 14 / 16, 1]];
const SCAFFOLD_TOP = [SCAFFOLD_BOXES[0]], NO_BOXES = [];
export const SCAFFOLD_CTX = { feetY: -Infinity, sneak: false };
const POT_BOXES = [[5 / 16, 0, 5 / 16, 11 / 16, 6 / 16, 11 / 16]];
const CHAIN_BOXES = [[6.5 / 16, 0, 6.5 / 16, 9.5 / 16, 1, 9.5 / 16]];
const swapXZ = (boxes) => boxes.map(([x0, y0, z0, x1, y1, z1]) => [z0, y0, x0, z1, y1, x1]);
const px16 = (...a) => a.map((v) => v / 16);
// Grindstone (meta bit 0 = axis; 0: the wheel's faces look along x): the wheel, then each leg and its pivot
const GRIND_X = [px16(4, 4, 2, 12, 16, 14), px16(2, 0, 6, 4, 7, 10), px16(2, 7, 5, 4, 13, 11), px16(12, 0, 6, 14, 7, 10), px16(12, 7, 5, 14, 13, 11)];
const GRIND_Z = swapXZ(GRIND_X);
// Stonecutter: a stone base and the saw blade standing up out of it (axis 0: the blade runs along x); it collides as its base only
const CUTTER_BASE = [px16(0, 0, 0, 16, 9, 16)];
const CUTTER_X = [CUTTER_BASE[0], px16(1, 9, 7.5, 15, 16, 8.5)];
const CUTTER_Z = swapXZ(CUTTER_X);
// Deep Hush: a sensor is a half slab with four tendrils; a shrieker a half slab under a jaw of bone (world/deepHush.js)
export const SENSOR_BOXES = [px16(0, 0, 0, 16, 8, 16), px16(3, 8, 3, 5, 15, 5), px16(11, 8, 3, 13, 15, 5), px16(3, 8, 11, 5, 15, 13), px16(11, 8, 11, 13, 15, 13)];
export const SHRIEKER_BOXES = [px16(0, 0, 0, 16, 8, 16), px16(1, 8, 1, 15, 15, 3), px16(1, 8, 13, 15, 15, 15), px16(1, 8, 3, 3, 15, 13), px16(13, 8, 3, 15, 15, 13)];
const SENSOR_COLLISION = [SENSOR_BOXES[0]], SHRIEKER_COLLISION = [px16(0, 0, 0, 16, 15, 16)];
/** Render / collision boxes of a SHAPE.BOXES block. */
// Brewing Alembic: base plate, ember rod and a cross-shaped arm near the top
const ALEMBIC_BOXES = [[2 / 16, 0, 2 / 16, 14 / 16, 2 / 16, 14 / 16], [7 / 16, 2 / 16, 7 / 16, 9 / 16, 14 / 16, 9 / 16],
  [3 / 16, 11 / 16, 7.5 / 16, 13 / 16, 12 / 16, 8.5 / 16], [7.5 / 16, 11 / 16, 3 / 16, 8.5 / 16, 12 / 16, 13 / 16]];
// Wyrm Head trophy: a skull with a snout on the side it faces (the front texture is drawn on it)
const WYRM_HEAD_BOXES = [[3 / 16, 0, 3 / 16, 13 / 16, 10 / 16, 13 / 16]];
const ALEMBIC_COLLISION = [ALEMBIC_BOXES[0], [7 / 16, 2 / 16, 7 / 16, 9 / 16, 14 / 16, 9 / 16]];
// up to four Shellback eggs
const EGG_BOXES = [[3, 7, 4, 4], [9, 3, 3, 4], [9, 9, 4, 5], [4, 11, 3, 3]].map(([x, z, s, h]) => [x / 16, 0, z / 16, (x + s) / 16, h / 16, (z + s) / 16]);
// hopper: a bowl (four walls and a floor), a narrower middle and a spout down or to one side
const HOPPER_BOWL = [[0, 10 / 16, 0, 1, 1, 2 / 16], [0, 10 / 16, 14 / 16, 1, 1, 1], [0, 10 / 16, 2 / 16, 2 / 16, 1, 14 / 16], [14 / 16, 10 / 16, 2 / 16, 1, 1, 14 / 16],
  [2 / 16, 10 / 16, 2 / 16, 14 / 16, 11 / 16, 14 / 16], [4 / 16, 4 / 16, 4 / 16, 12 / 16, 10 / 16, 12 / 16]];
const HOPPER_BOXES = [
  [...HOPPER_BOWL, [6 / 16, 0, 6 / 16, 10 / 16, 4 / 16, 10 / 16]],
  [...HOPPER_BOWL, [6 / 16, 4 / 16, 0, 10 / 16, 8 / 16, 4 / 16]], // -z
  [...HOPPER_BOWL, [12 / 16, 4 / 16, 6 / 16, 1, 8 / 16, 10 / 16]], // +x
  [...HOPPER_BOWL, [6 / 16, 4 / 16, 12 / 16, 10 / 16, 8 / 16, 1]], // +z
  [...HOPPER_BOWL, [0, 4 / 16, 6 / 16, 4 / 16, 8 / 16, 10 / 16]], // -x
];
// composter: four walls round a floor
const COMPOSTER_BOXES = [[0, 0, 0, 1, 2 / 16, 1], [0, 0, 0, 1, 1, 2 / 16], [0, 0, 14 / 16, 1, 1, 1], [0, 0, 2 / 16, 2 / 16, 1, 14 / 16], [14 / 16, 0, 2 / 16, 1, 1, 14 / 16]];
/** The compost inside a composter at `level` (null when empty). */
export const compostBox = (level) => (level > 0 ? [2 / 16, 2 / 16, 2 / 16, 14 / 16, Math.min(15, 1 + level * 2) / 16, 14 / 16] : null);
export function blockBoxes(id, meta) {
  if (id === B.COMPOSTER) return COMPOSTER_BOXES;
  if (id === B.ANVIL) return meta & 1 ? ANVIL_Z : ANVIL_X;
  if (id === B.CAMPFIRE) return CAMPFIRE_BOXES;
  if (id === B.OAK_SIGN) return (meta & 1) ? SIGN_X : SIGN_Z;
  if (id === B.OAK_WALL_SIGN) return WALL_SIGN[meta & 3];
  if (id === B.ITEM_FRAME) return FRAME_BOXES[meta & 3];
  if (id === B.COCOA) return [cocoaBox(meta)];
  if (id === B.LANTERN) return meta & 1 ? LANTERN_HANGING : LANTERN_STANDING;
  if (id === B.BREWING_STAND) return ALEMBIC_BOXES;
  if (id === B.TURTLE_EGG) return EGG_BOXES.slice(0, (meta & 3) + 1);
  if (id === B.HOPPER) return HOPPER_BOXES[meta & 7] || HOPPER_BOXES[0];
  if (id === B.WYRM_HEAD) return WYRM_HEAD_BOXES;
  if (id === B.STORM_ROD) return rodBoxes(meta);
  if (BLOCKS[id].candle) return CANDLE_BOXES[meta & 3];
  if (id === B.SCAFFOLDING) return SCAFFOLD_BOXES;
  if (id === B.FLOWER_POT) return POT_BOXES;
  if (id === B.CHAIN) return CHAIN_BOXES;
  if (id === B.GRINDSTONE) return meta & 1 ? GRIND_Z : GRIND_X;
  if (id === B.STONECUTTER) return meta & 1 ? CUTTER_Z : CUTTER_X;
  if (id === B.HUSH_SENSOR) return SENSOR_BOXES;
  if (id === B.HUSH_SHRIEKER) return SHRIEKER_BOXES;
  return TABLE_BOXES;
}
/** One box enclosing all of a SHAPE.BOXES block (selection outline). */
function boundsOf(boxes) {
  const o = [1, 1, 1, 0, 0, 0];
  for (const b of boxes) for (let a = 0; a < 3; a++) { o[a] = Math.min(o[a], b[a]); o[a + 3] = Math.max(o[a + 3], b[a + 3]); }
  return o;
}

/** Blocks whose collision is not a full cube. */
export const SHAPED_COLLISION = new Uint8Array(BLOCK_LIMIT);
for (const b of BLOCKS) if (b && (b.shape === SHAPE.DOOR || b.shape === SHAPE.TRAPDOOR)) SHAPED_COLLISION[b.id] = 1;
SHAPED_COLLISION[B.BED] = 1;
SHAPED_COLLISION[B.GLASS_PANE] = 1;
SHAPED_COLLISION[B.SNOW_LAYER] = 1;
SHAPED_COLLISION[B.SEEPSTONE_SPIKE] = 1;
SHAPED_COLLISION[B.MUD] = 1; // you sink into mud a little
const MUD_BOX = [[0, 0, 0, 1, 14 / 16, 1]];
for (const id of [B.COBBLESTONE_WALL, B.MOSSY_COBBLESTONE_WALL, B.OAK_TRAPDOOR, B.ENCHANTING_TABLE, B.ANVIL, B.CAMPFIRE, B.LANTERN, B.BREWING_STAND, B.TURTLE_EGG, B.HOPPER, B.COMPOSTER, B.SCAFFOLDING, B.FLOWER_POT, B.CHAIN, B.GRINDSTONE, B.STONECUTTER, B.HUSH_SENSOR, B.HUSH_SHRIEKER]) SHAPED_COLLISION[id] = 1;
/** Snow layer box (n = meta + 1 layers); collision is one layer lower, so a single layer has none. */
export const snowBox = (meta, collide = false) => [0, 0, 0, 1, ((meta & 7) + (collide ? 0 : 1)) * 2 / 16, 1];
for (const id of [B.OAK_FENCE, B.SPRUCE_FENCE, B.BIRCH_FENCE, B.OAK_FENCE_GATE]) SHAPED_COLLISION[id] = 1;
for (const id of [B.PISTON, B.STICKY_PISTON, B.PISTON_HEAD, B.OBSERVER, B.DAYLIGHT_SENSOR]) SHAPED_COLLISION[id] = 1;
for (const id of [B.OAK_SLAB, B.COBBLESTONE_SLAB, B.STONE_BRICK_SLAB, B.SANDSTONE_SLAB, B.OAK_STAIRS, B.COBBLESTONE_STAIRS, B.STONE_BRICK_STAIRS, B.SANDSTONE_STAIRS]) SHAPED_COLLISION[id] = 1;
for (const id of [B.HOLLOWBRICK_SLAB, B.HOLLOWBRICK_STAIRS, B.WYRM_HEAD]) SHAPED_COLLISION[id] = 1;
// every slab, stair, fence and gate (the extended blocks too)
for (const b of BLOCKS) if (b && (b.shape === SHAPE.SLAB || b.shape === SHAPE.STAIRS || b.shape === SHAPE.FENCE || b.shape === SHAPE.GATE)) SHAPED_COLLISION[b.id] = 1;
// carpets and Hush Veins (thin sheets) have no collision, like one layer of snow
for (const b of BLOCKS) if (b && b.carpet) SHAPED_COLLISION[b.id] = 1;

/**
 * Collision boxes of a solid non-cube block, or null for an ordinary full
 * cube. (Ladders and torches are not solid and never collide.)
 */
export function collisionBoxes(id, meta, world, x, y, z) {
  if (id === B.MUD) return MUD_BOX;
  if (id === B.SCAFFOLDING) return !SCAFFOLD_CTX.sneak && SCAFFOLD_CTX.feetY >= y + 1 - 1e-4 ? SCAFFOLD_TOP : NO_BOXES;
  if (BLOCKS[id].shape === SHAPE.DOOR) return [doorBox(meta)];
  const shp = BLOCKS[id].shape;
  if (shp === SHAPE.FENCE) return fenceBoxes(world ? fenceMask((a, b, c) => world.getBlock(a, b, c), x, y, z) : 0, 1.5);
  if (shp === SHAPE.GATE) return gateCollision(meta);
  if (shp === SHAPE.PANE) return paneBoxes(world ? paneMask((a, b, c) => world.getBlock(a, b, c), x, y, z) : 0);
  if (id === B.BED) return [BED_BOX];
  const sh = BLOCKS[id].shape;
  if (sh === SHAPE.SLAB) return [slabBox(meta)];
  if (sh === SHAPE.SNOW) return id === B.SNOW_LAYER && (meta & 7) ? [snowBox(meta, true)] : []; // carpets have none (like one layer of snow)
  if (sh === SHAPE.TRAPDOOR) return [trapdoorBox(meta)];
  if (sh === SHAPE.WALL) return wallBoxes(world ? wallMask((a, b, c) => world.getBlock(a, b, c), x, y, z) : 0, 1.5);
  if (sh === SHAPE.STAIRS) return world ? stairBoxes(meta, (dx, dz) => [world.getBlock(x + dx, y, z + dz), world.getMeta(x + dx, y, z + dz)], (n) => BLOCKS[n] && BLOCKS[n].shape === SHAPE.STAIRS) : stairBoxes(meta);
  if (id === B.HUSH_SENSOR) return SENSOR_COLLISION;
  if (id === B.HUSH_SHRIEKER) return SHRIEKER_COLLISION;
  if (sh === SHAPE.BOXES) return id === B.STONECUTTER ? CUTTER_BASE : id === B.ANVIL ? [boundsOf(blockBoxes(id, meta))] : id === B.BREWING_STAND ? ALEMBIC_COLLISION : blockBoxes(id, meta);
  if (sh === SHAPE.CIRCUIT) return circuitCollision(id, meta);
  if (sh === SHAPE.CRYSTAL) return [crystalBox(id, meta)];
  return null;
}

// fire is only hit by aiming at its floor: punching it there puts it out
const FIRE_BOX = [0, 0, 0, 1, 1 / 16, 1];

/** Selection (outline / raycast) box, or null for a full cube. */
export function selectionBox(id, meta) {
  if (BLOCKS[id].shape === SHAPE.DOOR) return doorBox(meta);
  if (BLOCKS[id].shape === SHAPE.SNOW) return snowBox(id === B.SNOW_LAYER ? meta : 0);
  if (id === B.PAINTING || id === B.PAINTING_B) { const [dx, , dz] = SIDE_DIRS[meta & 3]; return [dx > 0 ? 15 / 16 : 0, 0, dz > 0 ? 15 / 16 : 0, dx < 0 ? 1 / 16 : 1, 1, dz < 0 ? 1 / 16 : 1]; }
  if (id === B.RAIL) return [0, 0, 0, 1, meta >= 2 && meta <= 5 ? 0.5 : 2 / 16, 1];
  if (BLOCKS[id].shape === SHAPE.TRAPDOOR) return trapdoorBox(meta);
  if (BLOCKS[id].shape === SHAPE.WALL) return [4 / 16, 0, 4 / 16, 12 / 16, 1, 12 / 16];
  if (BLOCKS[id].shape === SHAPE.FENCE) return [P0, 0, P0, P1, 1, P1];
  if (BLOCKS[id].shape === SHAPE.PANE) return [7 / 16, 0, 7 / 16, 9 / 16, 1, 9 / 16];
  if (BLOCKS[id].shape === SHAPE.GATE) return (meta & 1) === 0 ? [0, 0, 6 / 16, 1, 1, 10 / 16] : [6 / 16, 0, 0, 10 / 16, 1, 1];
  if (id === B.BED) return BED_BOX;
  if (BLOCKS[id].shape === SHAPE.SLAB) return slabBox(meta);
  if (id === B.LADDER || id === B.VINES) return ladderBox(meta);
  if (id === B.LILY_PAD) return [0, 0, 0, 1, 1 / 64, 1];
  if (id === B.TORCH || id === B.CINNABAR_TORCH || id === B.CINNABAR_TORCH_OFF) return torchBox(meta);
  if (BLOCKS[id].shape === SHAPE.WIRE || BLOCKS[id].shape === SHAPE.CIRCUIT) return circuitSelection(id, meta);
  if (id === B.FIRE) return FIRE_BOX;
  if (BLOCKS[id].shape === SHAPE.CRYSTAL) return crystalBox(id, meta);
  if (BLOCKS[id].shape === SHAPE.BOXES) return boundsOf(blockBoxes(id, meta));
  return null;
}
