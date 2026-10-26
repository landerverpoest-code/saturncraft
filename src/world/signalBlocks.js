// Small rules of blocks that talk to cinnabar circuits without being containers
// (pure functions; the simulation is in world/circuits.js, comparators in world/comparators.js).
//
// * Target block: a projectile that hits it makes it send out 1-15, the more
//   the closer the hit is to the middle of the face it struck (reference:
//   15 * (0.5 - d) / 0.5 rounded up, d = the larger distance from the centre
//   along the face's two axes, at least 1). The signal lasts 20 ticks for
//   arrows and spears (projectiles that stick) and 8 ticks for anything thrown
//   that breaks (snowballs, eggs, elixirs).
// * Cake: 7 slices; each bite gives 2 hunger and 0.4 saturation; a comparator
//   reads twice the slices left (14 for a whole cake).
// * Item frame: a comparator reads 1 + the item's rotation (1-8), 0 when empty.
import { B } from './blocks.js';

export const TARGET_TICKS_STUCK = 20, TARGET_TICKS_THROWN = 8;
export const CAKE_SLICES = 7;
export const CAKE_FOOD = { hunger: 2, saturation: 0.4 };

/** Signal of a target block hit at world point (hx, hy, hz) on the face with normal `face` ([nx, ny, nz]). */
export function targetPower(hx, hy, hz, face) {
  const fr = (v) => v - Math.floor(v);
  const dx = Math.abs(fr(hx) - 0.5), dy = Math.abs(fr(hy) - 0.5), dz = Math.abs(fr(hz) - 0.5);
  const d = face[1] ? Math.max(dx, dz) : face[2] ? Math.max(dx, dy) : Math.max(dy, dz);
  const f = Math.max(0, Math.min(1, (0.5 - d) / 0.5));
  return Math.max(1, Math.ceil(15 * f - 1e-9));
}

/** How long (ticks) a target block keeps sending after a hit by this kind of projectile ('arrow', 'spear', 'snowball', ...). */
export function targetTicks(kind) {
  return kind === 'arrow' || kind === 'spear' ? TARGET_TICKS_STUCK : TARGET_TICKS_THROWN;
}

/**
 * A projectile of `kind` struck the block `hit` (a world.raycast result) at the world point x,y,z:
 * a target block there sends its signal (host / single player only: world.circuits does nothing on a guest).
 */
export function projectileHit(world, hit, x, y, z, kind) {
  if (!hit || hit.id !== B.TARGET || !world.circuits) return false;
  return world.circuits.hitTarget(hit.x, hit.y, hit.z, targetPower(x, y, z, hit.face), targetTicks(kind));
}

/** Comparator signal of a cake with `bites` slices eaten. */
export const cakeSignal = (bites) => Math.max(0, CAKE_SLICES - Math.max(0, Math.min(CAKE_SLICES, bites | 0))) * 2;

/** Comparator signal of an item frame (meta bits 2-4 = rotation) that holds an item or not. */
export const frameSignal = (meta, hasItem) => (hasItem ? 1 + ((meta >> 2) & 7) : 0);
