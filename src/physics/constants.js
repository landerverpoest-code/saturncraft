// Movement constants (blocks, ticks). Values follow the reference game's
// documented entity physics so that jump arcs and run speeds match.
export const PHYS = {
  GRAVITY: 0.08,           // blocks/tick^2
  DRAG_Y: 0.98,            // vertical velocity multiplier per tick
  AIR_FRICTION: 0.91,      // horizontal multiplier per tick while airborne
  GROUND_FRICTION_MUL: 0.91, // ground friction = block slipperiness * 0.91
  DEFAULT_SLIPPERINESS: 0.6,
  JUMP_VELOCITY: 0.42,
  SPRINT_JUMP_BOOST: 0.2,
  WALK_SPEED: 0.1,         // movement_speed attribute of the player
  SPRINT_MULTIPLIER: 1.3,
  SNEAK_MULTIPLIER: 0.3,
  INPUT_SCALE: 0.98,       // forward/strafe impulses are scaled by 0.98
  AIR_ACCEL: 0.02,
  AIR_ACCEL_SPRINT: 0.026,
  STEP_HEIGHT: 0.6,
  PLAYER_WIDTH: 0.6,
  PLAYER_HEIGHT: 1.8,
  PLAYER_SNEAK_HEIGHT: 1.5,
  PLAYER_EYE: 1.62,
  PLAYER_SNEAK_EYE: 1.27,
  PLAYER_CRAWL_HEIGHT: 0.6, // crawling (player/crawl.js): as low as swimming
  PLAYER_CRAWL_EYE: 0.4,
  CRAWL_MULTIPLIER: 0.3,    // crawl speed (as slow as sneaking)
  WATER_ACCEL: 0.02,
  WATER_DRAG: 0.8,
  WATER_SPRINT_DRAG: 0.9,
  WATER_GRAVITY: 0.005,    // gravity / 16
  WATER_JUMP: 0.04,
  LAVA_DRAG: 0.5,
  LAVA_GRAVITY: 0.02,      // gravity / 4
  SAFE_FALL: 3,
  REACH: 4.5,              // survival block interaction range
};

/** Horizontal acceleration while on ground (speed * 0.216 / friction^3). */
export function groundAccel(speed, slipperiness = PHYS.DEFAULT_SLIPPERINESS) {
  return speed * (0.21600002 / (slipperiness * slipperiness * slipperiness));
}

/** Fall damage for a fall distance (blocks), rounded up past the 3-block safe distance. */
export function fallDamage(fallDistance) {
  return Math.max(0, Math.ceil(fallDistance - PHYS.SAFE_FALL));
}
