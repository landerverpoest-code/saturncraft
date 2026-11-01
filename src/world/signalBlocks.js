// Small rules of blocks that talk to cinnabar circuits without being containers
// (pure functions; the simulation is in world/circuits.js, comparators in world/comparators.js).
//
// * Target block: a projectile that hits it makes it send out 1-15, the more
//   the closer the hit is to the middle of the face it struck (reference:
//   15 * (0.5 - d) / 0.5 rounded up, d = the larger distance from the centre
//   along the face's two axes, at least 1). The signal lasts 20 ticks for
//   arrows and spears (projectiles that stick) and 8 ticks for anything thrown
//   that breaks (snowballs, eggs, elixirs) or bursts (a Sky / Star Rocket flying into it).
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

/**
 * Where a straight flight from `from` to `to` (both [x, y, z]) first enters the block cell (cx, cy, cz): { hit, x, y, z }
 * with `hit` shaped like a world.raycast result ({ id, x, y, z, face }), or null when the segment misses the cell.
 * (A Star Rocket bursts the moment its next step lies inside a solid block; this finds the face it struck.)
 */
export function entryHit(from, to, cx, cy, cz, id = B.TARGET) {
  const c = [cx, cy, cz], d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  let tIn = -Infinity, tOut = Infinity, axis = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (from[i] < c[i] || from[i] > c[i] + 1) return null; continue; }
    const t0 = (c[i] - from[i]) / d[i], t1 = (c[i] + 1 - from[i]) / d[i];
    const near = Math.min(t0, t1), far = Math.max(t0, t1);
    if (near > tIn) { tIn = near; axis = i; }
    tOut = Math.min(tOut, far);
  }
  if (tIn > tOut || tOut < 0 || tIn > 1) return null;
  const t = Math.max(0, tIn), face = [0, 0, 0];
  face[axis] = d[axis] > 0 ? -1 : 1;
  const p = [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t];
  return { hit: { id, x: cx, y: cy, z: cz, face }, x: p[0], y: p[1], z: p[2] };
}

/** A rocket about to fly from `from` into `to`: when that cell is a target block it answers (kind 'rocket'). */
export function rocketStrike(game, from, to) {
  const cx = Math.floor(to[0]), cy = Math.floor(to[1]), cz = Math.floor(to[2]);
  if (game.world.getBlock(cx, cy, cz) !== B.TARGET) return false;
  const e = entryHit(from, to, cx, cy, cz);
  if (!e || !game.onProjectileHit) return false;
  game.onProjectileHit(e.hit, e.x, e.y, e.z, 'rocket');
  return true;
}

/** Comparator signal of a cake with `bites` slices eaten. */
export const cakeSignal = (bites) => Math.max(0, CAKE_SLICES - Math.max(0, Math.min(CAKE_SLICES, bites | 0))) * 2;

/** Comparator signal of an item frame (meta bits 2-4 = rotation) that holds an item or not. */
export const frameSignal = (meta, hasItem) => (hasItem ? 1 + ((meta >> 2) & 7) : 0);
