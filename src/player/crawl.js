// Crawling: a 0.6-high pose for squeezing through gaps one block high (or a block and a bit: slabs,
// trapdoors, pistons). You crawl while the crawl key (C) is held, and automatically when you walk
// into a gap too low to sneak through; once in a gap you cannot stand up in, you stay down until you
// are out. Crawling is as slow as sneaking, cannot sprint or jump, and lowers the eyes to 0.4 blocks.
// The pose is part of the player state that is shared in multiplayer (net/protocol.js PF.CRAWL).
// The rules are pure (they take the world's boxCollides) so the tests can run them on a fake world.
import { PHYS } from '../physics/constants.js';

const HALF = PHYS.PLAYER_WIDTH / 2;
/** How far ahead of the body's middle a gap is probed when walking (just past the front edge). */
export const PROBE_AHEAD = 0.45;

/** Is there room for the player's box (standing at feet position x, y, z) `h` blocks high? */
export function roomFor(world, x, y, z, h) {
  return !world.boxCollides(x - HALF, y, z - HALF, x + HALF, y + h, z + HALF);
}

/** The horizontal unit direction of the walking input for a yaw (yaw 0 faces -z), or null without input. */
export function inputDirection(yaw, forward, strafe) {
  const len = Math.hypot(forward, strafe);
  if (len < 1e-6) return null;
  const f = forward / len, s = strafe / len, sin = Math.sin(yaw), cos = Math.cos(yaw);
  return [-sin * f + cos * s, -cos * f - sin * s];
}

/**
 * Is the player walking into a gap they cannot get through standing or sneaking but can crawl through
 * (room for 0.6 blocks, none for 1.5) a few steps ahead? Needs a floor underfoot.
 */
export function lowGapAhead(world, b, yaw, forward, strafe) {
  const d = inputDirection(yaw, forward, strafe);
  if (!d || !b.onGround) return false;
  const x = b.x + d[0] * PROBE_AHEAD, z = b.z + d[1] * PROBE_AHEAD;
  return !roomFor(world, x, b.y, z, PHYS.PLAYER_SNEAK_HEIGHT) && roomFor(world, x, b.y, z, PHYS.PLAYER_CRAWL_HEIGHT);
}

/**
 * The crawling state for the next tick. `s` = { crawling, key (crawl key held), forward, strafe, yaw, blocked }
 * where `blocked` is true while something else decides the pose (swimming, gliding, flying, riding, asleep).
 */
export function crawlNext(world, b, s) {
  if (s.blocked) return false;
  const standRoom = roomFor(world, b.x, b.y, b.z, PHYS.PLAYER_HEIGHT);
  if (s.crawling && !standRoom) return true;          // stuck in the gap: stay down until out of it
  if (!b.onGround && !s.crawling) return false;        // you do not drop into a crawl in mid-air
  if (s.key) return true;
  return lowGapAhead(world, b, s.yaw, s.forward, s.strafe);
}
