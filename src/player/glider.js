// The Voidwing (reference: elytra) and Sky Rockets (reference: firework
// rockets). Pure flight maths, unit tested; Player.tick drives it.
//
// Gliding starts when jump is pressed in mid-air with a usable Voidwing in
// the chest slot, and ends on the ground, in a fluid, under Levitation or
// when the wing is worn out (it stops at 1 use left instead of breaking).
// Each tick follows the reference fall-flying step: gravity is cancelled in
// proportion to cos^2(pitch) (lift), a falling glider turns some of its
// descent into forward speed, pulling up trades speed for height, the
// velocity swings towards the look direction, and drag is 0.99 / 0.98 / 0.99.
// Flying into a wall hurts (10 x speed lost - 3). Every 20 ticks of flight
// wear the wing by one.
import { ITEMS } from '../world/items.js';

export const GLIDER_GRAVITY = 0.08;
export const GLIDER_WEAR_TICKS = 20;

/** Is this stack a Voidwing with flight left (worn down to 1 use it stops working)? */
export function gliderUsable(st) {
  const d = st && ITEMS[st.id];
  return !!(d && d.glider && (st.damage | 0) < d.durability - 1);
}

/** May the holder start gliding now? */
export function canStartGliding({ onGround, inWater, inLava, flying, levitating, riding, chest }) {
  return !onGround && !inWater && !inLava && !flying && !levitating && !riding && gliderUsable(chest);
}

/**
 * Look vector for a yaw / pitch in this game's convention (yaw 0 faces -z,
 * positive pitch looks up).
 */
export function lookVector(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/**
 * One tick of gliding velocity (before the move). `v` is {vx, vy, vz} and is
 * updated in place; returns it. `gravity` is 0.08 (0.01 under Slow Falling
 * while descending).
 */
export function glideStep(v, yaw, pitch, gravity = GLIDER_GRAVITY) {
  const [lx, ly, lz] = lookVector(yaw, pitch);
  const f = -pitch; // the reference's pitch: positive looks down
  const hl = Math.hypot(lx, lz);
  const hs = Math.hypot(v.vx, v.vz);
  const len = Math.hypot(lx, ly, lz);
  let c = Math.cos(f);
  c = c * c * Math.min(1, len / 0.4);
  v.vy += gravity * (-1 + c * 0.75);
  if (v.vy < 0 && hl > 0) {
    // descending: some of the fall becomes forward speed
    const d = v.vy * -0.1 * c;
    v.vx += lx * d / hl; v.vy += d; v.vz += lz * d / hl;
  }
  if (f < 0 && hl > 0) {
    // pulling up: forward speed becomes height
    const d = hs * -Math.sin(f) * 0.04;
    v.vx -= lx * d / hl; v.vy += d * 3.2; v.vz -= lz * d / hl;
  }
  if (hl > 0) {
    // the flight path swings towards where the glider looks
    v.vx += (lx / hl * hs - v.vx) * 0.1;
    v.vz += (lz / hl * hs - v.vz) * 0.1;
  }
  v.vx *= 0.99; v.vy *= 0.98; v.vz *= 0.99;
  return v;
}

/** Damage for hitting a wall while gliding: 10 x horizontal speed lost - 3 (0 if none). */
export function wallDamage(speedBefore, speedAfter) {
  return Math.max(0, (speedBefore - speedAfter) * 10 - 3);
}

/** Does this tick of flight (counted from 0) wear the wing? */
export function wearsThisTick(flightTicks) { return (flightTicks + 1) % GLIDER_WEAR_TICKS === 0; }

/** One tick of a Sky Rocket's push on a gliding player (towards 1.5 blocks/tick along the look). */
export function rocketBoost(v, yaw, pitch) {
  const [lx, ly, lz] = lookVector(yaw, pitch);
  v.vx += lx * 0.1 + (lx * 1.5 - v.vx) * 0.5;
  v.vy += ly * 0.1 + (ly * 1.5 - v.vy) * 0.5;
  v.vz += lz * 0.1 + (lz * 1.5 - v.vz) * 0.5;
  return v;
}

/** Ticks a rocket burns: 10 x (flight + 1) + 0..5 + 0..6 (flight 1 for crafted rockets). */
export function rocketLifetime(flight = 1, rng = Math.random) {
  return 10 * (flight + 1) + Math.floor(rng() * 6) + Math.floor(rng() * 7);
}
