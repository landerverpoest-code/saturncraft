// The play styles of the gear round's weapons, as pure rules (tests/gear_depth.test.js; the numbers live in
// world/weaponStats.js):
//  * Warhammer: a full swing staggers the mob (it stands still, `stunTicks`) and splinters a raised shield.
//  * Dagger:    a blow from behind the mob lands BACKSTAB_MULT times as hard; the short reach is the price.
//  * Glaive:    reach 4.5, and the arc round the target shares SWEEP_FRACTION of the blow with up to SWEEP_MAX more mobs.
//  * Disc:      thrown (entities/disc.js); this file has its damage and flight range.
// Specials that change what a mob does (the stagger) are applied where the mob is hurt (mobs/mob.js calls
// `onPlayerHit`), so they happen on the host for a guest's blows too; the damage numbers are worked out by the
// attacker's own game, as for every other blow, and the host caps them.
import { ITEMS } from '../world/items.js';
import { enchLevel } from '../world/enchantments.js';
import * as W from '../world/weaponStats.js';

/** The `weapon` record of a stack when it is one of the gear round's weapons, else null. */
export function weaponOf(st) {
  const d = st && ITEMS[st.id];
  return d && d.weapon && W.WEAPON_KINDS[d.weapon.type] ? d.weapon : null;
}
/** Is this stack a Returning Disc (the thrown weapon)? Not a Music Disc: those carry `disc` (their tune) and go in a Jukebox. */
export const isDisc = (st) => !!(st && ITEMS[st.id] && ITEMS[st.id].weapon && ITEMS[st.id].weapon.type === 'disc');

/** How far the held stack reaches for a mob (blocks): the glaive's 4.5, a dagger's 2.5, else 3. */
export function reachOf(st) {
  const w = weaponOf(st);
  return w && w.reach ? w.reach : 3.0;
}

/** Cosine between a mob's facing and the direction from it to (fromX, fromZ): 1 in front, -1 directly behind. */
export function facingDot(mob, fromX, fromZ) {
  const dx = fromX - mob.x, dz = fromZ - mob.z, d = Math.hypot(dx, dz);
  if (d < 1e-6) return 0;
  return (dx * -Math.sin(mob.yaw) + dz * -Math.cos(mob.yaw)) / d;
}
/** Is the attacker behind the mob (outside the cone it sees)? */
export const isBehind = (mob, fromX, fromZ) => facingDot(mob, fromX, fromZ) < -W.BACKSTAB_ARC;

/** Damage multiplier of a blow with this stack on this mob from this spot (a Dagger from behind, else 1). */
export function backstabFactor(st, mob, fromX, fromZ) {
  const w = weaponOf(st);
  return w && w.type === 'dagger' && isBehind(mob, fromX, fromZ) ? W.BACKSTAB_MULT : 1;
}

/** Ticks a mob stands staggered by this blow: a Warhammer's full swing, else 0. `dmg` is the damage before armour. */
export function stunFor(st, dmg) {
  const w = weaponOf(st);
  return w && w.type === 'warhammer' && dmg >= w.damage * W.STUN_MIN_FRACTION ? W.STUN_TICKS : 0;
}

/** Does this stack splinter a raised shield (an axe, or a Warhammer)? */
export function breaksShield(st) {
  const d = st && ITEMS[st.id];
  if (!d) return false;
  return !!((d.tool && d.tool.type === 'axe') || (d.weapon && d.weapon.breaksShield));
}

/** What a hit does to the mob besides damage: called from Mob.hurt for a player's melee blow (`rawDmg`: before armour). */
export function onPlayerHit(mob, attacker, rawDmg) {
  const held = attacker && attacker.inventory ? attacker.inventory.selectedStack : null;
  const stun = stunFor(held, rawDmg);
  if (stun && !(mob.def && (mob.def.boss || mob.def.knockbackResist))) mob.stunTicks = Math.max(mob.stunTicks | 0, stun);
  return stun;
}

/**
 * The mobs a Glaive's sweep also hits: up to SWEEP_MAX others within `reach` of the player and inside the cone of
 * half-angle acos(SWEEP_ARC) round the view, nearest first. `mobs` are { x, y, z, height, dead, deathTime } objects.
 */
export function sweepTargets(eye, look, primary, mobs, reach = 4.5) {
  const out = [];
  for (const m of mobs) {
    if (m === primary || m.dead || m.deathTime > 0 || m.kind !== 'mob') continue;
    const dx = m.x - eye[0], dy = m.y + (m.height || 1) * 0.5 - eye[1], dz = m.z - eye[2];
    const d = Math.hypot(dx, dy, dz);
    if (d > reach + (m.width || 0.6) * 0.5 || d < 1e-6) continue;
    if ((dx * look[0] + dy * look[1] + dz * look[2]) / d < W.SWEEP_ARC) continue;
    out.push({ m, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, W.SWEEP_MAX).map((o) => o.m);
}
/** Damage a swept mob takes for a primary blow of `dmg`. */
export const sweepDamage = (dmg) => dmg * W.SWEEP_FRACTION;

/** Damage of a thrown disc (before Keen-like bonuses, which discs do not take) and how far it flies out. */
export function discDamage(st) {
  const d = st && ITEMS[st.id];
  return d && d.weapon && d.weapon.throwDamage ? d.weapon.throwDamage : 0;
}
export const discRange = (st) => W.DISC_RANGE + W.DISC_RANGE_PER_FARFLIGHT * enchLevel(st, 'farflight');

/** Durability the held weapon loses for one blow (a Warhammer is hard on itself). */
export function wearPerBlow(st, tool) {
  const w = weaponOf(st);
  if (w) return w.wear || 1;
  return tool && (tool.type === 'sword' || tool.type === 'spear') ? 1 : 2;
}
/** Wear for breaking a block with something that is not a tool. */
export const wearPerBlock = (st, tool) => (weaponOf(st) ? 2 : tool && tool.type === 'sword' ? 2 : 1);
