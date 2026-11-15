// Wanderer's Broth: a foraged stew of a bowl, one wild flower and one mushroom. Its effect depends on the flower used
// (stack.broth = the flower's key below) and lasts 6-12 s; the tooltip names the effect only once that blend has been
// tasted (player.broths, saved), otherwise it reads "Unknown blend". Tasting five different blends is a milestone.
// Imports only blocks and the effect table, so the item table, crafting, saves and the network can all use it.
import { B } from './blocks.js';
import { EFFECTS, effectLabel } from '../player/effects.js';

/** The blends: flower key -> { block (a key of B), effect, ticks, amp }. Append only (keys are stored in saves). */
export const BROTHS = {
  sunpetal: { block: 'SUNPETAL', effect: 'speed', ticks: 160, amp: 0 },
  redbloom: { block: 'REDBLOOM', effect: 'strength', ticks: 200, amp: 0 },
  skybell: { block: 'SKYBELL', effect: 'jump_boost', ticks: 180, amp: 0 },
  rosette: { block: 'ROSETTE', effect: 'regeneration', ticks: 140, amp: 0 },
  flowering_azalea: { block: 'FLOWERING_AZALEA', effect: 'night_vision', ticks: 240, amp: 0 },
  azalea: { block: 'AZALEA', effect: 'fire_resistance', ticks: 200, amp: 0 },
  hushvine_flower: { block: 'HUSHVINE_FLOWER', effect: 'weakness', ticks: 160, amp: 0 },
  blight_rose: { block: 'BLIGHT_ROSE', effect: 'poison', ticks: 120, amp: 0 },
};
export const BROTH_KEYS = Object.keys(BROTHS);
/** Different blends tasted for the Taste Tester milestone. */
export const TASTE_GOAL = 5;

/** Flower block id -> blend key. */
export const FLOWER_BROTH = new Map(BROTH_KEYS.map((k) => [B[BROTHS[k].block], k]));
/** The mushrooms that go into the pot besides the flower. */
export const BROTH_MUSHROOMS = [B.BROWN_MUSHROOM, B.RED_MUSHROOM];

/** A valid blend key from untrusted data, or null. */
export const cleanBroth = (k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(BROTHS, k) ? k : null);
/** A cleaned list of tasted blends (unique, valid keys). */
export const cleanBroths = (l) => (Array.isArray(l) ? [...new Set(l.map(cleanBroth).filter(Boolean))] : []);
export const sameBroth = (a, b) => (a || '') === (b || '');

/** The blend a crafting grid's stacks make (a bowl, one flower and one mushroom, nothing else), or null. `bowlId` is the Bowl item id. */
export function brothFromGrid(stacks, bowlId) {
  const s = stacks.filter(Boolean);
  if (s.length !== 3) return null;
  const bowls = s.filter((x) => x.id === bowlId), mush = s.filter((x) => BROTH_MUSHROOMS.includes(x.id)), fl = s.filter((x) => FLOWER_BROTH.has(x.id));
  return bowls.length === 1 && mush.length === 1 && fl.length === 1 ? FLOWER_BROTH.get(fl[0].id) : null;
}

/** The "Effect Ns" text of a blend, e.g. "Night Vision 12 s". */
export function brothEffectText(key) {
  const b = BROTHS[key];
  return b ? `${effectLabel(b.effect, b.amp)} ${Math.round(b.ticks / 20)} s` : '';
}
/** Tooltip line for a broth stack: the effect once its blend has been tasted, else "Unknown blend". */
export function brothLine(st, learned) {
  const k = cleanBroth(st && st.broth);
  if (!k) return 'Plain broth';
  return (learned || []).includes(k) ? brothEffectText(k) : 'Unknown blend';
}
/** Is the blend's effect a good one (for colouring the tooltip)? */
export const brothIsGood = (k) => !!(BROTHS[k] && EFFECTS[BROTHS[k].effect] && EFFECTS[BROTHS[k].effect].good);

/**
 * Eat a broth stack: gives the player its effect and records the blend as tasted.
 * Returns { key, effect, isNew, count } (key null for a plain broth).
 */
export function eatBroth(p, st) {
  const key = cleanBroth(st && st.broth);
  if (!key) return { key: null, effect: null, isNew: false, count: (p.broths || []).length };
  const b = BROTHS[key];
  p.addEffect(b.effect, b.ticks, b.amp);
  if (!p.broths) p.broths = [];
  const isNew = !p.broths.includes(key);
  if (isNew) p.broths.push(key);
  return { key, effect: b.effect, isNew, count: p.broths.length };
}
