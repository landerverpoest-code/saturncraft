// Beacons: a Beacon on a stepped pyramid of iron, gold, diamond or beryl
// blocks (1-4 layers) sends a beam into the sky and, every 4 seconds, gives
// the players within 10 + 10 x level blocks its chosen powers for 9 + 2 x
// level seconds. Stained glass in the beam tints it. The powers live in the
// beacon's meta: bits 0-2 the primary power, bits 3-4 the secondary
// (1 = Regeneration, 2 = the primary at level II), both only at level 4.
import { B, OPAQUE, COLOR_BLOCKS } from './blocks.js';
import { COLORS } from './colors.js';
import { I } from './items.js';

export const BEACON_BASE = new Set([B.IRON_BLOCK, B.GOLD_BLOCK, B.DIAMOND_BLOCK, B.BERYL_BLOCK]);
export const BEACON_POWERS = [null, 'speed', 'haste', 'resistance', 'jump_boost', 'strength'];
/** The pyramid level each primary power needs. */
export const POWER_LEVEL = { speed: 1, haste: 1, resistance: 2, jump_boost: 2, strength: 3 };
export const SECONDARY = { NONE: 0, REGENERATION: 1, BOOST: 2 };
export const BEACON_PAYMENT = new Set([I.IRON_INGOT, I.GOLD_INGOT, I.DIAMOND, I.BERYL]);
export const BEACON_PERIOD = 80;
export const beaconRange = (level) => 10 + level * 10;
export const beaconDuration = (level) => (9 + level * 2) * 20;

/** How many full layers (0-4) of base blocks lie under the beacon. */
export function beaconLevel(w, x, y, z) {
  for (let k = 1; k <= 4; k++) {
    for (let dx = -k; dx <= k; dx++) for (let dz = -k; dz <= k; dz++) if (!BEACON_BASE.has(w.getBlock(x + dx, y - k, z + dz))) return k - 1;
  }
  return 4;
}

const GLASS_RGB = new Map();
COLOR_BLOCKS.glass.forEach((id, c) => GLASS_RGB.set(id, COLORS[c][2]));
COLOR_BLOCKS.pane.forEach((id, c) => GLASS_RGB.set(id, COLORS[c][2]));

/**
 * The beam above (x, y, z): null when an opaque block stops it, else its colour
 * ([r, g, b] 0-1; white, then each stained glass on the way averages its colour in).
 */
export function beamColor(w, x, y, z, top = w.heightAt(x, z)) {
  let col = null;
  for (let yy = y + 1; yy <= top; yy++) {
    const id = w.getBlock(x, yy, z);
    if (!id) continue;
    if (OPAQUE[id]) return null;
    const rgb = GLASS_RGB.get(id);
    if (rgb) { const c = rgb.map((v) => v / 255); col = col ? col.map((v, i) => (v + c[i]) / 2) : c; }
  }
  return col || [1, 1, 1];
}

/** The effects a beacon with this meta gives at this pyramid level: [{ name, amp }]. */
export function beaconEffects(meta, level) {
  const primary = BEACON_POWERS[meta & 7], secondary = (meta >> 3) & 3;
  if (!primary || level < 1 || POWER_LEVEL[primary] > level) return [];
  const out = [{ name: primary, amp: secondary === SECONDARY.BOOST && level >= 4 ? 1 : 0 }];
  if (secondary === SECONDARY.REGENERATION && level >= 4) out.push({ name: 'regeneration', amp: 0 });
  return out;
}

/** Beacon meta for a choice of powers. */
export const beaconMeta = (primary, secondary = 0) => (BEACON_POWERS.indexOf(primary) & 7) | ((secondary & 3) << 3);
