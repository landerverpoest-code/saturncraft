// Settler trades: every settler buys one kind of goods for beryl and sells two
// or three things for it, depending on its profession. Each offer works 12
// times, then restocks after half a day.
import { I, WOOL_ITEMS, TIPPED_ARROW } from '../world/items.js';
import { B } from '../world/blocks.js';

const BUY = 'buy', SELL = 'sell';
// [kind, give item, give count, get item, get count]
const OFFERS = {
  farmer: [[BUY, I.WHEAT, 20, I.BERYL, 1], [BUY, I.CARROT, 22, I.BERYL, 1], [BUY, I.POTATO, 26, I.BERYL, 1], [BUY, I.BEETROOT, 15, I.BERYL, 1], [SELL, I.BERYL, 1, I.BREAD, 6], [SELL, I.BERYL, 1, I.APPLE, 4], [SELL, I.BERYL, 1, I.CARROT, 5], [SELL, I.BERYL, 1, I.BAKED_POTATO, 4], [SELL, I.BERYL, 1, I.BEETROOT_SEEDS, 6]],
  librarian: [[BUY, I.PAPER, 24, I.BERYL, 1], [BUY, I.BOOK, 4, I.BERYL, 1], [SELL, I.BERYL, 9, B.BOOKSHELF, 1], [SELL, I.BERYL, 1, B.GLASS, 4], [SELL, I.BERYL, 1, B.LADDER, 4]],
  smith: [[BUY, I.COAL, 15, I.BERYL, 1], [BUY, I.IRON_INGOT, 4, I.BERYL, 1], [SELL, I.BERYL, 5, I.IRON_HELMET, 1], [SELL, I.BERYL, 9, I.IRON_CHESTPLATE, 1], [SELL, I.BERYL, 7, I.IRON_LEGGINGS, 1], [SELL, I.BERYL, 4, I.IRON_BOOTS, 1], [SELL, I.BERYL, 3, I.IRON_PICKAXE, 1]],
  shepherd: [[BUY, B.WOOL, 18, I.BERYL, 1], [SELL, I.BERYL, 2, I.SHEARS, 1], [SELL, I.BERYL, 3, I.BED, 1], [SELL, I.BERYL, 1, WOOL_ITEMS[14], 1], [SELL, I.BERYL, 1, WOOL_ITEMS[11], 1]],
  butcher: [[BUY, I.RAW_CHICKEN, 14, I.BERYL, 1], [BUY, I.RAW_PORK, 7, I.BERYL, 1], [SELL, I.BERYL, 1, I.COOKED_PORK, 5], [SELL, I.BERYL, 1, I.COOKED_CHICKEN, 8]],
  fletcher: [[BUY, I.STICK, 32, I.BERYL, 1], [BUY, I.FLINT, 26, I.BERYL, 1], [BUY, I.STRING, 14, I.BERYL, 1], [SELL, I.BERYL, 1, I.ARROW, 16], [SELL, I.BERYL, 2, I.BOW, 1], [SELL, I.BERYL, 3, I.CROSSBOW, 1],
    [SELL, I.BERYL, 2, TIPPED_ARROW.poison, 5], [SELL, I.BERYL, 2, TIPPED_ARROW.slowness, 5]],
  cleric: [[BUY, I.ROTTEN_FLESH, 32, I.BERYL, 1], [BUY, I.GOLD_INGOT, 3, I.BERYL, 1], [SELL, I.BERYL, 1, I.CINNABAR, 2], [SELL, I.BERYL, 1, I.AZURITE, 1], [SELL, I.BERYL, 4, I.GLOWSHARD_DUST, 4],
    [SELL, I.BERYL, 8, I.GILDED_APPLE, 1], [SELL, I.BERYL, 3, I.GLASS_VIAL, 4]],
};
export const MAX_USES = 12;
export const RESTOCK_TICKS = 12000;

/** Offers for a new settler: one way to earn beryl and two or three things to spend it on. */
export function makeTrades(profession, rng = Math.random) {
  const list = OFFERS[profession];
  const buys = list.filter((o) => o[0] === BUY), sells = list.filter((o) => o[0] === SELL);
  const pick = (arr) => arr.splice(Math.floor(rng() * arr.length), 1)[0];
  const chosen = [pick(buys.slice())];
  const pool = sells.slice();
  const n = 2 + (rng() < 0.5 ? 1 : 0);
  for (let k = 0; k < n && pool.length; k++) chosen.push(pick(pool));
  return chosen.map(([, give, gn, get, getn]) => ({ give, giveCount: gn, get, getCount: getn, uses: 0 }));
}

/** Can the inventory pay for an offer? */
export function canTrade(offer, inventory) {
  return offer.uses < MAX_USES && inventory.count(offer.give) >= offer.giveCount;
}

/** Take the price from the inventory; returns the goods (caller puts them in the inventory). */
export function doTrade(offer, inventory) {
  if (!canTrade(offer, inventory)) return null;
  let left = offer.giveCount;
  for (let i = 0; i < inventory.slots.length && left; i++) {
    const s = inventory.slots[i];
    if (!s || s.id !== offer.give) continue;
    const n = Math.min(left, s.count);
    s.count -= n; left -= n;
    if (s.count <= 0) inventory.slots[i] = null;
  }
  offer.uses++;
  inventory.changed();
  return { id: offer.get, count: offer.getCount, damage: 0 };
}
