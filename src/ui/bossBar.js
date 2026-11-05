// The boss bar: which boss (a mob whose definition has `bossBar`) the player is fighting, and what to show for it.
// Pure lookups (unit tested); ui/hud.js draws the bar and game.js asks for the info a few times a second.
// It reads the mirrored mob fields every client has (type, health, the `special` flag), so guests in a shared
// world see the same bar as the host.
import { MOBS } from '../mobs/mobTypes.js';

/** Boss bars show for a boss within this many blocks. */
export const BAR_RANGE = 72;

/** Phase number (1-based) for a health fraction and a boss's phase thresholds (descending fractions). */
export function barPhase(frac, phases) {
  let n = 1;
  for (const t of phases || []) if (frac <= t) n++;
  return n;
}

/**
 * The bar for the nearest living boss round (x, y, z): { name, frac, phase, phases, shielded } or null.
 * `list` is the entity list.
 */
export function bossBarInfo(list, x, y, z, range = BAR_RANGE) {
  let best = null, bd = range * range;
  for (const e of list) {
    if (e.kind !== 'mob' || e.dead || e.removed || e.deathTime > 0) continue;
    const def = e.def || MOBS[e.type];
    if (!def || !def.bossBar) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2 + (e.z - z) ** 2;
    if (d < bd) { bd = d; best = { e, def }; }
  }
  if (!best) return null;
  const { e, def } = best, max = def.health || 1, frac = Math.max(0, Math.min(1, e.health / max));
  return { name: def.name, frac, phase: barPhase(frac, def.bossBar.phases), phases: def.bossBar.phases || [], shielded: !!e.special };
}
