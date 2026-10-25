// The thrown Tidespear (reference: trident). An Arrow with thrown === 'spear'
// runs this tick instead of the arrow's (entities.js):
//  * it flies heavy and straight (water hardly slows it), hits for 8 (+ Harpoon
//    against water mobs), then glances off and falls;
//  * it sticks into the block it hits and only its thrower can pull it out
//    again (a creative thrower kept theirs, so it just vanishes);
//  * Homing Tide (loyalty) flies it back to the thrower once it hit something
//    or got stuck (or fell out of the world), faster with each level;
//  * Stormcall (channeling) calls lightning down on a mob it hits under open
//    sky during a thunderstorm.
// A Sodden Shambler's spear carries no item: it hits, sticks briefly and vanishes.
// The rules are pure functions exported for the tests.
import { B } from '../world/blocks.js';
import { MIN_Y } from '../world/constants.js';
import { enchLevel, harpoonBonus } from '../world/enchantments.js';

export const SPEAR_DAMAGE = 8;
export const SPEAR_STUCK_TICKS = 1200;  // a stuck spear turns into a dropped item after a minute
export const MOB_SPEAR_STUCK_TICKS = 60; // a mob's spear vanishes soon after landing
export const SPEAR_GRAVITY = 0.05;
export const SPEAR_WATER_DRAG = 0.99;    // the same as in the air: it cuts through water

/** Damage a thrown spear deals to a target. */
export const spearDamage = (item, target) => SPEAR_DAMAGE + harpoonBonus(item, target);

/** Can `who` pull a stuck spear out? Only its thrower, and only a living one. */
export function canPickUpSpear(spear, who) {
  return !!(spear.item && who && who === spear.shooter && !who.dead);
}

/** Does a Homing Tide spear fly back now? After a hit or getting stuck, or below the world; never to a dead or missing thrower. */
export function shouldReturn(spear) {
  const lvl = enchLevel(spear.item, 'homing_tide');
  if (!lvl || !spear.shooter || !spear.shooter.isPlayer || spear.shooter.dead) return false;
  return !!(spear.dealtDamage || spear.stuck || spear.y < MIN_Y);
}

/**
 * One tick of the return flight towards the owner's eyes (reference loyalty):
 * velocity = velocity x 0.95 + direction x 0.05 x level, and the height is nudged by 0.015 x level.
 * Mutates and returns `s` ({x, y, z, vx, vy, vz}).
 */
export function returnStep(s, ox, oy, oz, level) {
  const dx = ox - s.x, dy = oy - s.y, dz = oz - s.z, l = Math.hypot(dx, dy, dz) || 1;
  s.y += dy * 0.015 * level;
  const k = 0.05 * level;
  s.vx = s.vx * 0.95 + dx / l * k; s.vy = s.vy * 0.95 + dy / l * k; s.vz = s.vz * 0.95 + dz / l * k;
  s.x += s.vx; s.y += s.vy; s.z += s.vz;
  return s;
}

/** Does Stormcall strike: level 1, a thunderstorm, the target under open sky. */
export const stormcallStrikes = (level, thundering, openSky) => level > 0 && !!thundering && !!openSky;

const ownerEye = (o) => [o.x, o.y + (o.eyeHeight || 1.62) - 0.1, o.z];

/** Hand the spear back to its thrower (or drop it at their feet when there is no room). */
function giveBack(a, game) {
  a.dead = true;
  const o = a.shooter;
  game.audio.play('pop', [o.x, o.y + 1, o.z]);
  if (a.creativeThrow || !a.item) return; // a creative thrower still holds theirs
  if (game.net && game.net.isClient) return;
  const p = game.player;
  if (o === p && p.inventory.add({ ...a.item }) === 0) { p.inventory.changed && p.inventory.changed(); return; }
  game.entities.spawnItem(o.x, o.y + 0.2, o.z, a.item, [0, 0, 0]); // a guest picks it up as a drop
}

/** A thrown spear's tick (the arrow's prev/age are already updated). */
export function tickSpear(a, game) {
  const w = game.world;
  if (!a.returning && shouldReturn(a)) { a.returning = true; a.stuck = false; a.vx = a.vy = a.vz = 0; }
  if (a.returning) {
    const o = a.shooter;
    if (o.dead) { a.returning = false; a.land(game); return; }
    const [ox, oy, oz] = ownerEye(o);
    if (Math.hypot(ox - a.x, oy - a.y, oz - a.z) < 1.4 || a.age > 1200) { giveBack(a, game); return; }
    returnStep(a, ox, oy, oz, enchLevel(a.item, 'homing_tide')); // straight through blocks
    return;
  }
  if (a.stuck) {
    const p = game.player;
    if (!a.item) { if (a.age > MOB_SPEAR_STUCK_TICKS) a.dead = true; return; }
    if (canPickUpSpear(a, p) && Math.abs(p.x - a.x) < 1.2 && Math.abs(p.z - a.z) < 1.2 && a.y > p.y - 0.5 && a.y < p.y + 2.3) {
      if (a.creativeThrow || p.inventory.add({ ...a.item }) === 0) { a.dead = true; game.audio.play('pop'); if (p.inventory.changed) p.inventory.changed(); }
      return;
    }
    if (a.age > SPEAR_STUCK_TICKS) a.land(game); // left too long: it pops out as a normal drop
    return;
  }
  const speed = Math.hypot(a.vx, a.vy, a.vz) || 1e-6;
  const ux = a.vx / speed, uy = a.vy / speed, uz = a.vz / speed;
  const hit = w.raycast(a.x, a.y, a.z, ux, uy, uz, speed);
  const target = a.dealtDamage ? null : game.entities.sweepHit(a, a.x, a.y, a.z, ux, uy, uz, hit ? hit.dist : speed);
  if (target) {
    target.hurt(spearDamage(a.item, target), 'arrow', a.shooter, 0.6, a);
    a.dealtDamage = true;
    if (!a.item) { a.dead = true; game.audio.play('arrow_hit', [a.x, a.y, a.z]); return; }
    const lvl = enchLevel(a.item, 'stormcall');
    if (lvl && game.weather && game.strikeLightning) {
      const tx = Math.floor(target.x), ty = Math.floor(target.y), tz = Math.floor(target.z);
      if (stormcallStrikes(lvl, game.weather.thundering && game.weather.level >= 0.2, w.heightAt(tx, tz) < ty)) game.strikeLightning(tx, ty, tz);
    }
    // glance off and drop
    a.vx *= -0.01; a.vy *= -0.1; a.vz *= -0.01;
    game.audio.play('arrow_hit', [a.x, a.y, a.z]);
    return;
  }
  if (hit) {
    a.x += ux * hit.dist; a.y += uy * hit.dist; a.z += uz * hit.dist;
    a.stuck = true; a.age = 0;
    game.audio.play('arrow_hit', [a.x, a.y, a.z]);
    return;
  }
  a.x += a.vx; a.y += a.vy; a.z += a.vz;
  const drag = w.getBlock(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z)) === B.WATER ? SPEAR_WATER_DRAG : 0.99;
  a.vx *= drag; a.vy *= drag; a.vz *= drag;
  a.vy -= SPEAR_GRAVITY;
  if (a.y < MIN_Y - 64 || a.age > 1200) a.dead = true; // (a Homing Tide spear turns back at MIN_Y)
}
