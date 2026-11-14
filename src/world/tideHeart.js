// The Tide Heart: a beacon for the sea. Set it under water (water on all six sides) inside a frame of Tidestone, Tidestone
// Bricks, Dark Tidestone or Tide Lanterns - any blocks of the shell two blocks out from it count - and it wakes: every four
// seconds every player within reach who is in water or out in the rain gets Water Breathing, Night Vision and Haste for
// thirteen seconds. Sixteen frame blocks wake it and reach 32 blocks; every seven more add 16, up to 96 at 42. A heart
// with 42 or more also strikes monsters in the water within 8 blocks, 4 damage every two seconds.
// Nothing is stored: the frame is read from the world when the heart ticks, like a beacon's pyramid.
import { B, isWaterish } from './blocks.js';

export const HEART_PERIOD = 80;       // ticks between pulses
export const HEART_DURATION = 260;    // ticks the gifts last
export const HEART_MIN_FRAME = 16;
export const HEART_FULL_FRAME = 42;
export const HEART_STRIKE = { range: 8, damage: 4, period: 40 };
export const HEART_EFFECTS = ['water_breathing', 'night_vision', 'haste'];
const FRAME = new Set([B.TIDESTONE, B.TIDESTONE_BRICKS, B.DARK_TIDESTONE, B.TIDE_LANTERN]);
export const isFrameBlock = (id) => FRAME.has(id);

/** Is the heart surrounded by water on all six sides? */
export function heartSubmerged(w, x, y, z) {
  return isWaterish(w.getBlock(x + 1, y, z)) && isWaterish(w.getBlock(x - 1, y, z)) && isWaterish(w.getBlock(x, y + 1, z))
    && isWaterish(w.getBlock(x, y - 1, z)) && isWaterish(w.getBlock(x, y, z + 1)) && isWaterish(w.getBlock(x, y, z - 1));
}

/** Frame blocks in the shell two blocks out from the heart (capped at the full frame). */
export function heartFrame(w, x, y, z) {
  let n = 0;
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== 2) continue;
    if (FRAME.has(w.getBlock(x + dx, y + dy, z + dz)) && ++n >= HEART_FULL_FRAME) return n;
  }
  return n;
}

/** How far a heart with this many frame blocks reaches (0: asleep). */
export function heartRange(frame) {
  if (frame < HEART_MIN_FRAME) return 0;
  return Math.min(96, 32 + Math.floor((frame - HEART_MIN_FRAME) / 7) * 16 + (frame >= HEART_FULL_FRAME ? 16 : 0));
}

/** The state of the heart at (x, y, z): { awake, frame, range, strikes }. */
export function heartState(w, x, y, z) {
  if (!heartSubmerged(w, x, y, z)) return { awake: false, frame: 0, range: 0, strikes: false };
  const frame = heartFrame(w, x, y, z), range = heartRange(frame);
  return { awake: range > 0, frame, range, strikes: frame >= HEART_FULL_FRAME };
}

/** Does a player at (px, py, pz) who is `wet` (in water or rained on) get the heart's gifts? */
export function heartReaches(state, x, y, z, px, py, pz, wet) {
  return state.awake && wet && Math.hypot(px - (x + 0.5), py - (y + 0.5), pz - (z + 0.5)) <= state.range;
}
