// Name Tags (reference: name tag): a tag given a name (right-click it in the air to
// write one) names the mob it is used on. A named mob never despawns, keeps its
// name in the save and shows it on a floating label when the player is within 8
// blocks or looks right at it.
import { cleanLabel } from '../world/enchantments.js';

/** Within this distance (blocks) a named mob's label always shows. */
export const NAME_RANGE = 8;
/** Furthest a label shows when the player looks right at the mob. */
export const NAME_LOOK_RANGE = 32;

/** Can this mob take the name `label`? (Not the dying, not players, not with an empty name.) */
export function canName(mob, label) {
  return !!(mob && mob.kind === 'mob' && mob.deathTime === 0 && !mob.dead && !mob.isRemotePlayer && cleanLabel(label));
}

/** Give a mob a name: it keeps it, and never despawns from now on. Returns true when named. */
export function nameMob(mob, label) {
  const name = cleanLabel(label);
  if (!name || !mob) return false;
  mob.customName = name;
  mob.persistent = true;
  return true;
}

/**
 * Should a name label show? `dx, dy, dz` runs from the viewer's eye to the middle of the mob,
 * `lx, ly, lz` is the (unit) view direction and `radius` about half the mob's size.
 */
export function nameVisible(dx, dy, dz, lx, ly, lz, radius = 0.5) {
  const d = Math.hypot(dx, dy, dz);
  if (d <= NAME_RANGE) return true;
  if (d > NAME_LOOK_RANGE) return false;
  const along = dx * lx + dy * ly + dz * lz;
  if (along <= 0) return false;
  const perp = Math.sqrt(Math.max(0, d * d - along * along));
  return perp <= Math.max(0.5, radius);
}
