// What the Proving Vaults give (world/provingVaults.js, world/provingSystem.js): the rewards a Proving
// Spawner throws out after a beaten wave, one Vault roll, and the chests of the store rooms and galleries.
import { B } from './blocks.js';
import { I } from './items.js';

/** [id, min, max, weight] per entry (entries whose item does not exist are left out). */
export const SPAWNER_REWARDS = [
  [I.PROVING_KEY, 1, 1, 40], [I.ARROW, 4, 10, 12], [I.BREAD, 1, 3, 10], [I.BAKED_POTATO, 2, 4, 8], [I.COOKED_CHICKEN, 1, 3, 8],
  [I.BERYL, 1, 3, 10], [I.HONEY_BOTTLE, 1, 2, 6], [I.IRON_INGOT, 1, 2, 6],
];
export const VAULT_LOOT = [
  [I.BERYL, 3, 8, 14], [I.IRON_INGOT, 3, 6, 10], [I.GOLD_INGOT, 2, 5, 8], [I.DIAMOND, 1, 2, 5], [I.GILDED_APPLE, 1, 1, 4],
  [I.GILDED_CARROT, 3, 6, 6], [I.ARROW, 12, 24, 8], [I.CROSSBOW, 1, 1, 4], [I.SHIELD, 1, 1, 4], [I.DIAMOND_AXE, 1, 1, 2],
  [B.VAULT_BRICKS, 8, 16, 4], [B.COPPER_BULB, 2, 4, 4],
];
/** Chest loot (loot kind VAULTS_LOOT): [table, rolls min, rolls max]. */
export const VAULTS_CHEST = [[
  [I.PROVING_KEY, 1, 1, 6], [I.ARROW, 4, 12, 12], [I.BREAD, 2, 4, 12], [I.BAKED_POTATO, 2, 5, 10], [I.COPPER_INGOT, 2, 6, 10],
  [I.IRON_INGOT, 1, 3, 8], [I.BERYL, 1, 4, 8], [I.HONEY_BOTTLE, 1, 2, 5], [B.COPPER_GRATE, 2, 6, 5], [B.ASHSTONE_TILES, 4, 12, 6],
].filter((e) => e[0] !== undefined), 2, 5];

const valid = (table) => table.filter((e) => e[0] !== undefined);

/** One weighted pick from a table, as a stack. */
export function rollStack(table, rng = Math.random) {
  const t = valid(table);
  let total = 0;
  for (const e of t) total += e[3];
  let r = rng() * total, e = t[t.length - 1];
  for (const x of t) { if ((r -= x[3]) < 0) { e = x; break; } }
  return { id: e[0], count: e[1] + Math.floor(rng() * (e[2] - e[1] + 1)), damage: 0 };
}

/** A beaten wave's rewards: one roll for each player who fought it (at least one). */
export function spawnerRewards(players, rng = Math.random) {
  const out = [];
  for (let k = 0; k < Math.max(1, players); k++) out.push(rollStack(SPAWNER_REWARDS, rng));
  return out;
}

/** One Vault roll: a prize, and now and then a little beryl besides. */
export function vaultRoll(rng = Math.random) {
  const out = [rollStack(VAULT_LOOT, rng)];
  if (rng() < 0.3) out.push({ id: I.BERYL, count: 1 + Math.floor(rng() * 3), damage: 0 });
  return out;
}
