// Collision and selection boxes for blocks that are not full cubes (doors,
// ladders, wall torches). Boxes are block-local [x0, y0, z0, x1, y1, z1].
//
// Side indices (used in meta) follow the furnace convention:
// 0 = -z, 1 = +x, 2 = +z, 3 = -x.
import { B, BLOCKS, SHAPE } from './blocks.js';

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
/** Stairs: a half slab plus the raised half on the side the player faced when placing. */
export function stairBoxes(meta) {
  const up = meta & STAIRS_UPSIDE;
  return [up ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1], sideSlab(meta & 3, 0.5, up ? 0 : 0.5, up ? 0.5 : 1)];
}

export const BED_HEAD = 8;
export const BED_BOX = [0, 0, 0, 1, 9 / 16, 1];

/** Blocks whose collision is not a full cube. */
export const SHAPED_COLLISION = new Uint8Array(256);
SHAPED_COLLISION[B.DOOR] = 1;
SHAPED_COLLISION[B.BED] = 1;
for (const id of [B.OAK_SLAB, B.COBBLESTONE_SLAB, B.STONE_BRICK_SLAB, B.SANDSTONE_SLAB, B.OAK_STAIRS, B.COBBLESTONE_STAIRS, B.STONE_BRICK_STAIRS, B.SANDSTONE_STAIRS]) SHAPED_COLLISION[id] = 1;

/**
 * Collision boxes of a solid non-cube block, or null for an ordinary full
 * cube. (Ladders and torches are not solid and never collide.)
 */
export function collisionBoxes(id, meta) {
  if (id === B.DOOR) return [doorBox(meta)];
  if (id === B.BED) return [BED_BOX];
  const sh = BLOCKS[id].shape;
  if (sh === SHAPE.SLAB) return [slabBox(meta)];
  if (sh === SHAPE.STAIRS) return stairBoxes(meta);
  return null;
}

/** Selection (outline / raycast) box, or null for a full cube. */
export function selectionBox(id, meta) {
  if (id === B.DOOR) return doorBox(meta);
  if (id === B.BED) return BED_BOX;
  if (BLOCKS[id].shape === SHAPE.SLAB) return slabBox(meta);
  if (id === B.LADDER) return ladderBox(meta);
  if (id === B.TORCH) return torchBox(meta);
  return null;
}
