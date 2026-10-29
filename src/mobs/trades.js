// Settler trades: every settler buys one kind of goods for beryl and sells two
// or three things for it, depending on its profession. Each offer works 12
// times, then restocks after half a day.
import { I, WOOL_ITEMS, TIPPED_ARROW, CHARTS } from '../world/items.js';
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
    [SELL, I.BERYL, 8, I.GILDED_APPLE, 1], [SELL, I.BERYL, 3, I.GLASS_VIAL, 4], [SELL, I.BERYL, 24, I.CHARM_OF_UNDYING, 1]],
  // Cartographers (Cartography Desk): buy paper, ink and compasses; sell maps, compasses and clocks and Explorer Charts (world/landmarks.js, dearer for the harder places). Every cartographer stocks at least one chart (see GUARANTEED).
  cartographer: [[BUY, I.PAPER, 24, I.BERYL, 1], [BUY, I.INK_SAC, 16, I.BERYL, 1], [BUY, I.COMPASS, 2, I.BERYL, 1],
    [SELL, I.BERYL, 2, I.EMPTY_MAP, 1], [SELL, I.BERYL, 3, I.COMPASS, 1], [SELL, I.BERYL, 4, I.CLOCK, 1],
    [SELL, I.BERYL, 8, CHARTS.outpost, 1], [SELL, I.BERYL, 10, CHARTS.skywatch, 1], [SELL, I.BERYL, 11, CHARTS.sunken, 1],
    [SELL, I.BERYL, 12, CHARTS.tomb, 1], [SELL, I.BERYL, 14, CHARTS.citadel, 1]],
};
const CHART_IDS = new Set(Object.values(CHARTS));
/** Trades whose list always holds at least one offer that passes the test (the first sell is picked among those). */
const GUARANTEED = { cartographer: (o) => CHART_IDS.has(o[3]) };
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
  const must = GUARANTEED[profession];
  if (must) { // e.g. a cartographer always stocks a chart: take one of those first
    const first = pick(pool.filter(must));
    pool.splice(pool.indexOf(first), 1);
    chosen.push(first);
  }
  for (let k = 0; k < n - (must ? 1 : 0) && pool.length; k++) chosen.push(pick(pool));
  return chosen.map(([, give, gn, get, getn]) => ({ give, giveCount: gn, get, getCount: getn, uses: 0 }));
}

/**
 * What an offer costs after a price cut (0..1, e.g. Village Champion's, see
 * raids.js): the reference rule takes floor(cut x price) off, at least one
 * item, but never goes below one.
 */
export function offerPrice(offer, discount = 0) {
  if (!(discount > 0)) return offer.giveCount;
  return Math.max(1, offer.giveCount - Math.max(1, Math.floor(discount * offer.giveCount)));
}

/** Can the inventory pay for an offer? */
export function canTrade(offer, inventory, discount = 0) {
  return offer.uses < MAX_USES && inventory.count(offer.give) >= offerPrice(offer, discount);
}

/** Take the price from the inventory; returns the goods (caller puts them in the inventory). */
export function doTrade(offer, inventory, discount = 0) {
  if (!canTrade(offer, inventory, discount)) return null;
  let left = offerPrice(offer, discount);
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
