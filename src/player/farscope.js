// The Farscope: a Farglass with steps of zoom. Looking through it (hold right mouse) the view narrows to a third, a sixth or an eleventh of the
// usual field of view; the mouse wheel (or the hotbar keys) steps between them, the aim steadies the more it magnifies, and a read-out under
// the ring names what the cross-hairs rest on and how far off it is. Pure rules here; game.js narrows the view and ui/hud.js draws the read-out.
import { ITEMS } from '../world/items.js';

/** Field-of-view factors of the Farscope's three steps, and the Farglass's single one. */
export const SCOPE_LEVELS = [0.32, 0.16, 0.09];
export const FARGLASS_FACTOR = 0.1;
export const SCOPE_RANGE = 160;

export const isSpyglass = (id) => !!(ITEMS[id] && ITEMS[id].spyglass);
export const isFarscope = (id) => !!(ITEMS[id] && ITEMS[id].scope);
/** The zoom step, kept in range (a Farglass has none). */
export const clampLevel = (n) => Math.max(0, Math.min(SCOPE_LEVELS.length - 1, n | 0));
/** One step along the mouse wheel: scrolling up (a negative delta) zooms in. */
export const stepLevel = (level, wheel) => clampLevel((level | 0) - Math.sign(wheel || 0));
/** The factor the field of view is multiplied by while looking through item `id` at zoom step `level`. */
export function zoomFactor(id, level = 0) {
  if (isFarscope(id)) return SCOPE_LEVELS[clampLevel(level)];
  return isSpyglass(id) ? FARGLASS_FACTOR : 1;
}
/** The magnification as the read-out shows it ("x6.3"). */
export const magnification = (id, level = 0) => `x${(1 / zoomFactor(id, level)).toFixed(1)}`;
/** Mouse-sensitivity factor while looking through: steadier the more it magnifies. */
export function scopeSensitivity(id, level = 0) {
  return isFarscope(id) ? Math.min(1, zoomFactor(id, level) * 1.6) : 0.15;
}

/** Distance as the read-out shows it: metres up to a kilometre. */
export function rangeLabel(d) {
  if (!(d >= 0)) return '';
  return d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
}

/** The read-out text: "x6.3 · Sandsnapper · 42 m", just the magnification when nothing is in sight. `what` is a name or null, `dist` blocks or null. */
export function readoutText(id, level, what, dist) {
  const parts = [magnification(id, level)];
  if (what) parts.push(what);
  if (what || dist != null) { const r = rangeLabel(dist); if (r) parts.push(r); }
  return parts.join(' · ');
}

/**
 * What the line of sight rests on: the nearest creature within a hair of it (and in front of any block) or else the block it ends on.
 * `look` is the unit view vector from `eye`; world.raycast(x, y, z, dx, dy, dz, max) gives { dist, id }; mobs are entities of kind 'mob'.
 * Returns { what, dist } (both null when it sees only sky).
 */
export function aimedAt(world, eye, look, entities, blockName = () => 'terrain') {
  const hit = world.raycast(eye[0], eye[1], eye[2], look[0], look[1], look[2], SCOPE_RANGE);
  let best = null, bd = hit ? hit.dist : SCOPE_RANGE;
  for (const e of entities) {
    if (e.kind !== 'mob' || e.dead || e.deathTime > 0 || (e.special && e.def && e.def.burrower) || !e.def) continue;
    const dx = e.x - eye[0], dy = e.y + e.height * 0.5 - eye[1], dz = e.z - eye[2], d = Math.hypot(dx, dy, dz);
    if (d < 2 || d > bd) continue;
    const reach = Math.max((e.width || 0.6) / 2, (e.height || 0.6) / 2) + 0.3; // the creature's size seen from here
    if ((dx * look[0] + dy * look[1] + dz * look[2]) / d < d / Math.hypot(d, reach)) continue;
    bd = d; best = e;
  }
  if (best) return { what: best.customName || best.def.name, dist: bd };
  return hit ? { what: blockName(hit), dist: hit.dist } : { what: null, dist: null };
}
