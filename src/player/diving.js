// Diving gear (reference: none; the Diver's Helm and Diver's Lamp are this game's own): pure rules, unit tested; Player.tick and
// Game.render drive them.
//  * The Diver's Helm gives Water Breathing while the head is under water and wears one point every 3 seconds of it; worn down to
//    its last point it stops working (repair it with a Lantern Gland at an anvil). It also wears a brow lamp that lights the way.
//  * The Diver's Lamp is a hand light that works under water (heldLightLevel reads its `holdLight`).
//  * The deep sea is dark: the fog dims with depth (world/deepSea.js depthDarkness); light and night vision keep more of the view.
import { I, ITEMS, heldLightLevel } from '../world/items.js';
import { SEA_LEVEL } from '../world/constants.js';

/** How dark the water is at height y: 0 in the shallows, 1 below the deepest light. */
export function depthDarkness(y) { return Math.max(0, Math.min(1, (SEA_LEVEL - 12 - y) / 28)); }

export const HELM_LIGHT = 10;
export const HELM_WEAR_TICKS = 60;

/** Is this stack a Diver's Helm with air left (worn down to 1 use it stops working)? */
export function helmUsable(st) {
  const d = st && ITEMS[st.id];
  return !!(d && st.id === I.DIVERS_HELM && (st.damage | 0) < d.durability - 1);
}

/** Does the helm wear on this tick of being submerged (`n` counts the ticks so far)? */
export const helmWears = (n) => n > 0 && n % HELM_WEAR_TICKS === 0;

/** Light level a player carries: the held item, or the brow lamp of a usable Diver's Helm. */
export function lampLevel(inventory) {
  const st = inventory && inventory.selectedStack;
  const held = st ? heldLightLevel(st.id) : 0;
  const helm = inventory && inventory.armor && inventory.armor[0];
  return Math.max(held, helmUsable(helm) ? HELM_LIGHT : 0);
}

/**
 * How the water looks to an eye at height y: `dim` (0..1, how much of the daylight colour is lost) and `far` (a multiplier of the
 * fog distance). A light in hand, Night Vision and Water Breathing win back some of it.
 */
export function underwaterView(y, { lamp = 0, nightVision = 0, breathing = false } = {}) {
  const dark = depthDarkness(y);
  const relief = Math.max(nightVision * 0.8, lamp >= 13 ? 0.55 : lamp >= 10 ? 0.4 : 0);
  const dim = dark * 0.85 * (1 - relief);
  return { dim, far: (1 - dark * 0.5 * (1 - relief)) * (breathing || nightVision ? 1.5 : 1) };
}
