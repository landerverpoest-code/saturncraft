// Hanging Signs: a board on two chains that hangs from the underside of a solid block, or from a bracket arm on the side of a wall.
// Meta: bit 2 clear = ceiling (bit 0 = which way the board faces: 0 = along z, 1 = along x); bit 2 set = bracket on a wall
// (bits 0-1 = the side of the wall, as for wall signs). Both faces show two lines of text, kept in game.signs like any sign.
// A hanging sign needs the block it hangs from and drops itself when that goes.
import { B, SOLID } from './blocks.js';
import { SIDE_DIRS, sideOf } from './shapes.js';

export const HANGING_WALL = 4;
export const HANGING_LINES = 2;
export const HANGING_LINE_MAX = 15;

const px = (a) => a.map((v) => v / 16);
// a wall at -z: the arm, the crossbar, two chains and the board (box = [x0, y0, z0, x1, y1, z1] in pixels)
const WALL_BASE = [[7, 14, 0, 9, 15, 8], [1, 14, 8, 15, 15, 9], [2, 11, 8, 3, 14, 9], [13, 11, 8, 14, 14, 9], [1, 3, 8, 15, 11, 9]].map(px);
// hanging from a ceiling with the board along x: two chains and the board
const CEIL_BASE = [[2, 10, 7.5, 3, 16, 8.5], [13, 10, 7.5, 14, 16, 8.5], [1, 2, 7.5, 15, 10, 8.5]].map(px);

/** One quarter turn about the block's middle: (x, z) -> (1 - z, x). */
const turnBox = ([x0, y0, z0, x1, y1, z1]) => [1 - z1, y0, x0, 1 - z0, y1, x1];
const turnTimes = (b, n) => { for (let i = 0; i < n; i++) b = turnBox(b); return b; };

const BOXES = [];
for (let m = 0; m < 8; m++) BOXES.push((m & HANGING_WALL ? WALL_BASE : CEIL_BASE).map((b) => turnTimes(b, m & (m & HANGING_WALL ? 3 : 1))));

/** The boxes of a hanging sign (collision-free; used for drawing and aiming). */
export const hangingBoxes = (meta) => BOXES[meta & 7];

/** The block a hanging sign hangs from: [dx, dy, dz]. */
export function hangingAnchor(meta) {
  if (meta & HANGING_WALL) return SIDE_DIRS[meta & 3];
  return [0, 1, 0];
}

/** Does a hanging sign with this meta at x,y,z have something to hang from? */
export function hangingSupported(getBlock, x, y, z, meta) {
  const [dx, dy, dz] = hangingAnchor(meta);
  return !!SOLID[getBlock(x + dx, y + dy, z + dz)];
}

/**
 * The meta for a hanging sign placed on the clicked `face` ([nx, ny, nz] of the face) by a player looking along (ldx, ldz),
 * or -1 when that face cannot hold one (the top of a block).
 */
export function hangingPlaceMeta(face, ldx, ldz) {
  if (face[1] === 1) return -1;
  if (face[1] === -1) return Math.abs(ldx) > Math.abs(ldz) ? 1 : 0; // hung under a block, the board faces the player
  return HANGING_WALL | sideOf(-face[0], -face[2]);
}

/** Where the two text faces of a hanging sign are: [{ cx, cy, cz, nx, nz }] (offsets inside the block; n = the face's normal). */
export function hangingFaces(meta) {
  const e = 0.011;
  let faces, turns;
  if (meta & HANGING_WALL) {
    faces = [{ cx: 0.5, cy: 7 / 16, cz: 9 / 16 + e, nx: 0, nz: 1 }, { cx: 0.5, cy: 7 / 16, cz: 8 / 16 - e, nx: 0, nz: -1 }];
    turns = meta & 3;
  } else {
    faces = [{ cx: 0.5, cy: 6 / 16, cz: 8.5 / 16 + e, nx: 0, nz: 1 }, { cx: 0.5, cy: 6 / 16, cz: 7.5 / 16 - e, nx: 0, nz: -1 }];
    turns = meta & 1;
  }
  return faces.map((f) => {
    let { cx, cz, nx, nz } = f;
    for (let i = 0; i < turns; i++) { [cx, cz] = [1 - cz, cx]; [nx, nz] = [-nz, nx]; }
    return { cx, cy: f.cy, cz, nx, nz };
  });
}

/** The text of a hanging sign: two lines of up to 15 characters (from untrusted data too). */
export const hangingText = (lines) => Array.from({ length: HANGING_LINES }, (_, i) => String((lines && lines[i]) || '').slice(0, HANGING_LINE_MAX));

export const isHangingSign = (id) => id === B.HANGING_SIGN;
