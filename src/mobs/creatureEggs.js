// Creature Eggs: a creative-mode item that hatches a creature where it is used. There is one item; which creature it holds
// is the stack's label (the same field a Name Tag writes), so eggs of different creatures do not stack together, travel
// through saves and the network like any labelled stack, and an egg renamed on an anvil hatches whatever it is named after.
// The Creative Inventory lists one egg per creature. Bosses and things that are made rather than born have no egg.
import { MOBS } from './mobTypes.js';
import { I } from '../world/items.js';

/** Creatures without an egg: bosses, their parts and summoned things. */
export const NO_EGG = new Set(['void_wyrm', 'void_crystal', 'ember_lord']);

/** The egg stacks the Creative Inventory offers, by creature name. */
export function eggCatalog() {
  return Object.keys(MOBS).filter((k) => !NO_EGG.has(k) && !MOBS[k].boss && MOBS[k].name)
    .map((k) => ({ key: k, name: `${MOBS[k].name} Egg`, stack: { id: I.CREATURE_EGG, count: 1, label: MOBS[k].name } }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The creature an egg stack holds (its key), or null. */
export function eggMob(st) {
  if (!st || st.id !== I.CREATURE_EGG || typeof st.label !== 'string') return null;
  const n = st.label.trim().toLowerCase();
  if (!n) return null;
  const key = Object.keys(MOBS).find((k) => k === n || MOBS[k].name.toLowerCase() === n);
  return key && !NO_EGG.has(key) && !MOBS[key].boss ? key : null;
}

/**
 * Use an egg on the face of a block: the creature appears in the cell in front of that face. Returns the mob key, or null
 * when the egg is blank. A guest asks the host (the /summon path); survival players use the egg up.
 */
export function useEgg(game, st, target) {
  const key = eggMob(st);
  if (!key) return null;
  const x = target.x + target.face[0] + 0.5, y = target.y + target.face[1] + (target.face[1] < 0 ? -1 : 0), z = target.z + target.face[2] + 0.5;
  if (game.net && game.net.isClient) game.net.sendCommand(`/summon ${key} ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`);
  else game.spawner.spawnMob(key, x, y, z);
  return key;
}
