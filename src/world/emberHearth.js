// The Ember Hearth: a respawn point for the Cinderdeep. Feed it Glowshard blocks (one charge each, up to four), then use it in the
// Cinderdeep to bind yourself to it. Die in the Cinderdeep and you wake beside it instead of being sent home; each rising uses one charge.
// The block's meta is its charge count (0..4); the player keeps only the hearth's position (player.hearth, saved with the player).
import { B, SOLID, isFluid } from './blocks.js';

export const HEARTH_MAX_CHARGES = 4;
export const HEARTH_DIMENSION = 'cinderdeep';

/** The charges stored in a hearth's meta (0..4). */
export const hearthCharges = (meta) => Math.max(0, Math.min(HEARTH_MAX_CHARGES, meta | 0));

/** Can a Glowshard block add a charge? */
export const canCharge = (charges) => hearthCharges(charges) < HEARTH_MAX_CHARGES;

/** The charges after feeding one Glowshard block (capped at four). */
export const chargeUp = (charges) => Math.min(HEARTH_MAX_CHARGES, hearthCharges(charges) + 1);

/** The charges left after one rising (never below zero). */
export const spendCharge = (charges) => Math.max(0, hearthCharges(charges) - 1);

/** May a player in dimension `dim` bind to a hearth holding `charges`? Only in the Cinderdeep, and only when it has a charge. */
export const canSet = (charges, dim) => dim === HEARTH_DIMENSION && hearthCharges(charges) > 0;

/** Is this a hearth position (three finite numbers)? Returns a clean copy or null (for saves and guests). */
export function cleanHearth(h) {
  if (!h || typeof h !== 'object') return null;
  if (!Number.isFinite(h.x) || !Number.isFinite(h.y) || !Number.isFinite(h.z)) return null;
  if (Math.abs(h.x) > 3e7 || Math.abs(h.z) > 3e7 || Math.abs(h.y) > 1e4) return null;
  return { x: Math.floor(h.x), y: Math.floor(h.y), z: Math.floor(h.z) };
}

const free = (id) => !SOLID[id] && !isFluid(id) && id !== B.FIRE;

/** Can a body stand with its feet in cell (x, y, z)? Solid ground below, two free cells for feet and head. */
export function canStandAt(getBlock, x, y, z) {
  return !!SOLID[getBlock(x, y - 1, z)] && !isFluid(getBlock(x, y - 1, z)) && free(getBlock(x, y, z)) && free(getBlock(x, y + 1, z));
}

// the cells beside a hearth, nearest first (sides, then corners, then two out)
const RING = [];
for (let r = 1; r <= 2; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) RING.push([dx, dz]);
RING.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));

/** A free standing spot beside the hearth at (x, y, z): { x, y, z } at a cell's middle, or null when it is walled in. */
export function hearthSpot(getBlock, x, y, z) {
  for (const [dx, dz] of RING) for (const dy of [0, 1, -1]) {
    if (canStandAt(getBlock, x + dx, y + dy, z + dz)) return { x: x + dx + 0.5, y: y + dy, z: z + dz + 0.5 };
  }
  return null;
}
