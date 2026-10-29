// Carved Pumpkins (reference: the carved pumpkin and its Halloween spawns). Shears carve a Pumpkin
// (player/interaction.js): the face turns towards the player and 4 seeds fall out. The Carved Pumpkin
// is also a helmet (world/items.js): no defence, no wear, but Voidwalkers (mobs/mob.js) only take a
// stare as a challenge when the face they meet is bare, and undead may spawn wearing one:
//   * 1 % of fresh Shamblers, Dune Shamblers, Rattlers and Rime Rattlers without a helmet, and in the
//     week of the harvest feast (20 October to 1 November, by the real calendar) 25 %;
//   * a pumpkin head does not shade the sun: the mob still burns (mobs/equipment.js helmetShadesSun).
// Pure rules (all random rolls take an rng) are exported for the tests.
import { B } from '../world/blocks.js';

export const CARVE_SEEDS = 4;
export const PUMPKIN_HEAD_CHANCE = 0.01, HARVEST_PUMPKIN_CHANCE = 0.25;

/** Meta of a block placed or carved to face a player standing at (dx, dz) from its centre: 0 = -z front, 1 = +x, 2 = +z, 3 = -x. */
export const carveFacing = (dx, dz) => (Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0));

/** Is it the week of the harvest feast (20 October to 1 November)? `date` is a Date. */
export function isHarvestSeason(date = new Date()) {
  const m = date.getMonth(), d = date.getDate();
  return (m === 9 && d >= 20) || (m === 10 && d <= 1);
}

/** The chance that a fresh undead mob without a helmet spawns in a pumpkin. */
export const pumpkinHeadChance = (date = new Date()) => (isHarvestSeason(date) ? HARVEST_PUMPKIN_CHANCE : PUMPKIN_HEAD_CHANCE);

/** Is this stack a Carved Pumpkin? */
export const isPumpkinHead = (st) => !!st && st.id === B.CARVED_PUMPKIN;

/** The gear stack of a pumpkin head. */
export const pumpkinStack = () => ({ id: B.CARVED_PUMPKIN, count: 1, damage: 0 });

/**
 * Maybe put a pumpkin on the head of a mob's gear `eq` ({ hand, armor }) when the helmet slot is empty.
 * Mutates and returns `eq`; null (a mob that wears nothing) stays null.
 */
export function addPumpkinHead(eq, date = new Date(), rng = Math.random) {
  if (!eq || eq.armor[0]) return eq;
  if (rng() < pumpkinHeadChance(date)) eq.armor[0] = pumpkinStack();
  return eq;
}

/** Does this player wear a pumpkin on the head (the first armour slot)? */
export const wearsPumpkin = (player) => !!(player && player.inventory && isPumpkinHead(player.inventory.armor[0]));

/** Would a Voidwalker take the player's gaze as a challenge? Not while the player's face is hidden by a pumpkin. */
export const gazeProvokes = (player) => !wearsPumpkin(player);
