// Settler trades: every settler buys one kind of goods for beryl and sells two
// or three things for it, depending on its profession. Each offer works 12
// times, then restocks after half a day. Settlers level up with the number of
// trades done (Novice .. Master) and stock better offers with every level;
// prices follow the player's reputation in the village (mobs/reputation.js)
// and the demand for an offer since its last restock.
import { I, WOOL_ITEMS, TIPPED_ARROW, CHARTS, DYES } from '../world/items.js';
import { B } from '../world/blocks.js';
import { repFactor, refusesTrade, REP } from './reputation.js';

const BUY = 'buy', SELL = 'sell';
// [kind, give item, give count, get item, get count, tier]. The tier (1 when left out) is the settler level an offer
// is unlocked at: a new settler stocks one buy and two or three sells of tier 1; every level it reaches adds
// one or two offers of that tier (see levelUpTrades).
const OFFERS = {
  farmer: [[BUY, I.WHEAT, 20, I.BERYL, 1], [BUY, I.CARROT, 22, I.BERYL, 1], [BUY, I.POTATO, 26, I.BERYL, 1], [BUY, I.BEETROOT, 15, I.BERYL, 1], [BUY, B.PUMPKIN, 6, I.BERYL, 1, 3], [BUY, I.MELON_SLICE, 24, I.BERYL, 1, 4],
    [SELL, I.BERYL, 1, I.BREAD, 6], [SELL, I.BERYL, 1, I.APPLE, 4], [SELL, I.BERYL, 1, I.CARROT, 5, 2], [SELL, I.BERYL, 1, I.BAKED_POTATO, 4], [SELL, I.BERYL, 1, I.BEETROOT_SEEDS, 6],
    [SELL, I.BERYL, 1, I.COOKIE, 6, 2], [SELL, I.BERYL, 1, I.PUMPKIN_PIE, 3, 3], [SELL, I.BERYL, 1, B.HAY_BALE, 2, 3], [SELL, I.BERYL, 3, I.GILDED_CARROT, 2, 4], [SELL, I.BERYL, 6, I.GILDED_MELON_SLICE, 1, 5]],
  librarian: [[BUY, I.PAPER, 24, I.BERYL, 1], [BUY, I.BOOK, 4, I.BERYL, 1], [BUY, I.INK_SAC, 12, I.BERYL, 1, 2], [BUY, I.WRITABLE_BOOK, 2, I.BERYL, 1, 4],
    [SELL, I.BERYL, 9, B.BOOKSHELF, 1], [SELL, I.BERYL, 1, B.GLASS, 4], [SELL, I.BERYL, 1, B.LADDER, 4],
    [SELL, I.BERYL, 3, I.COMPASS, 1, 2], [SELL, I.BERYL, 2, B.LANTERN, 1, 2], [SELL, I.BERYL, 4, I.CLOCK, 1, 3], [SELL, I.BERYL, 3, I.NAME_TAG, 1, 3],
    [SELL, I.BERYL, 2, I.PAINTING, 1, 4], [SELL, I.BERYL, 3, I.ITEM_FRAME, 2, 4], [SELL, I.BERYL, 12, B.JUKEBOX, 1, 5]],
  smith: [[BUY, I.COAL, 15, I.BERYL, 1], [BUY, I.IRON_INGOT, 4, I.BERYL, 1], [BUY, I.RAW_IRON, 8, I.BERYL, 1, 2], [BUY, I.DIAMOND, 1, I.BERYL, 3, 4],
    [SELL, I.BERYL, 5, I.IRON_HELMET, 1], [SELL, I.BERYL, 9, I.IRON_CHESTPLATE, 1, 2], [SELL, I.BERYL, 7, I.IRON_LEGGINGS, 1], [SELL, I.BERYL, 4, I.IRON_BOOTS, 1], [SELL, I.BERYL, 3, I.IRON_PICKAXE, 1],
    [SELL, I.BERYL, 4, I.IRON_SWORD, 1, 2], [SELL, I.BERYL, 3, I.IRON_AXE, 1, 2], [SELL, I.BERYL, 6, B.ANVIL, 1, 3], [SELL, I.BERYL, 3, I.FLINT_AND_STEEL, 1, 3],
    [SELL, I.BERYL, 15, I.DIAMOND_SWORD, 1, 4], [SELL, I.BERYL, 14, I.DIAMOND_AXE, 1, 5]],
  shepherd: [[BUY, B.WOOL, 18, I.BERYL, 1], [BUY, I.STRING, 14, I.BERYL, 1, 3],
    [SELL, I.BERYL, 2, I.SHEARS, 1], [SELL, I.BERYL, 3, I.BED, 1, 2], [SELL, I.BERYL, 1, WOOL_ITEMS[14], 1], [SELL, I.BERYL, 1, WOOL_ITEMS[11], 1],
    [SELL, I.BERYL, 1, DYES[1], 3, 2], [SELL, I.BERYL, 1, DYES[4], 3, 2], [SELL, I.BERYL, 2, I.PAINTING, 1, 3], [SELL, I.BERYL, 2, I.LEAD, 2, 3],
    [SELL, I.BERYL, 2, B.CANDLE, 2, 4], [SELL, I.BERYL, 2, I.NAME_TAG, 1, 4], [SELL, I.BERYL, 4, I.BUNDLE, 1, 5]],
  butcher: [[BUY, I.RAW_CHICKEN, 14, I.BERYL, 1], [BUY, I.RAW_PORK, 7, I.BERYL, 1], [BUY, I.RAW_BEEF, 8, I.BERYL, 1, 2], [BUY, I.RAW_MUTTON, 8, I.BERYL, 1, 3],
    [SELL, I.BERYL, 1, I.COOKED_PORK, 5], [SELL, I.BERYL, 1, I.COOKED_CHICKEN, 8], [SELL, I.BERYL, 1, I.COOKED_MUTTON, 5, 2], [SELL, I.BERYL, 1, I.STEAK, 5, 2],
    [SELL, I.BERYL, 1, I.COOKED_RABBIT, 5, 3], [SELL, I.BERYL, 2, I.LEATHER, 4, 4], [SELL, I.BERYL, 6, I.SADDLE, 1, 5]],
  fletcher: [[BUY, I.STICK, 32, I.BERYL, 1], [BUY, I.FLINT, 26, I.BERYL, 1], [BUY, I.STRING, 14, I.BERYL, 1], [BUY, I.FEATHER, 24, I.BERYL, 1, 3],
    [SELL, I.BERYL, 1, I.ARROW, 16], [SELL, I.BERYL, 2, I.BOW, 1], [SELL, I.BERYL, 3, I.CROSSBOW, 1], [SELL, I.BERYL, 2, TIPPED_ARROW.poison, 5],
    [SELL, I.BERYL, 2, TIPPED_ARROW.slowness, 5, 2], [SELL, I.BERYL, 2, TIPPED_ARROW.weakness, 5, 3], [SELL, I.BERYL, 3, TIPPED_ARROW.leaping, 5, 3],
    [SELL, I.BERYL, 3, TIPPED_ARROW.healing, 5, 4], [SELL, I.BERYL, 4, TIPPED_ARROW.strength, 5, 5]],
  cleric: [[BUY, I.ROTTEN_FLESH, 32, I.BERYL, 1], [BUY, I.GOLD_INGOT, 3, I.BERYL, 1], [BUY, I.BONE, 20, I.BERYL, 1, 3], [BUY, I.SPIDER_EYE, 12, I.BERYL, 1, 4],
    [SELL, I.BERYL, 1, I.CINNABAR, 2], [SELL, I.BERYL, 1, I.AZURITE, 1], [SELL, I.BERYL, 4, I.GLOWSHARD_DUST, 4], [SELL, I.BERYL, 3, I.GLASS_VIAL, 4],
    [SELL, I.BERYL, 3, I.EMBER_POWDER, 2, 2], [SELL, I.BERYL, 5, I.VOID_PEARL, 1, 3],
    [SELL, I.BERYL, 8, I.GILDED_APPLE, 1, 4], [SELL, I.BERYL, 24, I.CHARM_OF_UNDYING, 1, 5]],
  // Cartographers (Cartography Desk): buy paper, ink and compasses; sell maps, compasses and clocks and Explorer Charts (world/landmarks.js, dearer for the harder places). Every cartographer stocks at least one chart (see GUARANTEED).
  cartographer: [[BUY, I.PAPER, 24, I.BERYL, 1], [BUY, I.INK_SAC, 16, I.BERYL, 1], [BUY, I.COMPASS, 2, I.BERYL, 1],
    [SELL, I.BERYL, 2, I.EMPTY_MAP, 1], [SELL, I.BERYL, 3, I.COMPASS, 1], [SELL, I.BERYL, 4, I.CLOCK, 1],
    [SELL, I.BERYL, 8, CHARTS.outpost, 1], [SELL, I.BERYL, 10, CHARTS.skywatch, 1], [SELL, I.BERYL, 11, CHARTS.sunken, 1],
    [SELL, I.BERYL, 12, CHARTS.sporehall, 1], [SELL, I.BERYL, 13, CHARTS.rimekeep, 1],
    [SELL, I.BERYL, 12, CHARTS.tomb, 1], [SELL, I.BERYL, 14, CHARTS.citadel, 1],
    [SELL, I.BERYL, 2, I.ITEM_FRAME, 2, 2], [SELL, I.BERYL, 2, I.PAINTING, 1, 3], [SELL, I.BERYL, 2, B.LANTERN, 1, 4], [SELL, I.BERYL, 4, I.BUNDLE, 1, 5]],
  // Masons (Masonry Bench): buy clay, bricks and rough stone; sell dressed stone, bricks and coloured building blocks.
  mason: [[BUY, I.CLAY_BALL, 10, I.BERYL, 1], [BUY, B.COBBLESTONE, 32, I.BERYL, 1], [BUY, I.BRICK, 10, I.BERYL, 1, 2], [BUY, B.GRANITE, 16, I.BERYL, 1, 3], [BUY, I.EMBER_QUARTZ, 5, I.BERYL, 1, 4],
    [SELL, I.BERYL, 1, B.STONE_BRICKS, 4], [SELL, I.BERYL, 1, B.BRICKS, 3], [SELL, I.BERYL, 1, B.POLISHED_ANDESITE, 4],
    [SELL, I.BERYL, 1, B.POLISHED_GRANITE, 4, 2], [SELL, I.BERYL, 1, B.POLISHED_DIORITE, 4, 2], [SELL, I.BERYL, 1, B.CHISELED_STONE_BRICKS, 3, 2],
    [SELL, I.BERYL, 1, B.TERRACOTTA, 4, 3], [SELL, I.BERYL, 3, B.STONECUTTER, 1, 3], [SELL, I.BERYL, 1, B.SMOOTH_STONE, 6, 3],
    [SELL, I.BERYL, 1, B.WHITE_CONCRETE, 4, 4], [SELL, I.BERYL, 1, B.GRAY_CONCRETE, 4, 4], [SELL, I.BERYL, 1, B.CHALKSTONE, 4, 4],
    [SELL, I.BERYL, 2, B.POLISHED_ASHSTONE, 4, 5], [SELL, I.BERYL, 2, B.ASHSTONE_BRICKS, 4, 5]],
  // Toolsmiths (Whetstone Stand): buy coal, flint and iron; sell tools from stone up to diamond.
  toolsmith: [[BUY, I.COAL, 15, I.BERYL, 1], [BUY, I.FLINT, 26, I.BERYL, 1], [BUY, I.IRON_INGOT, 4, I.BERYL, 1, 2], [BUY, I.STICK, 40, I.BERYL, 1, 3], [BUY, I.DIAMOND, 1, I.BERYL, 3, 4],
    [SELL, I.BERYL, 1, I.STONE_PICKAXE, 1], [SELL, I.BERYL, 1, I.STONE_AXE, 1], [SELL, I.BERYL, 1, I.STONE_SHOVEL, 1], [SELL, I.BERYL, 1, I.STONE_HOE, 1],
    [SELL, I.BERYL, 3, I.IRON_AXE, 1, 2], [SELL, I.BERYL, 2, I.IRON_SHOVEL, 1, 2], [SELL, I.BERYL, 2, I.IRON_HOE, 1, 2], [SELL, I.BERYL, 2, I.FISHING_ROD, 1, 2],
    [SELL, I.BERYL, 3, I.BUCKET, 1, 3], [SELL, I.BERYL, 2, I.SHEARS, 1, 3], [SELL, I.BERYL, 3, I.IRON_PICKAXE, 1, 3],
    [SELL, I.BERYL, 8, I.DIAMOND_SHOVEL, 1, 4], [SELL, I.BERYL, 8, I.DIAMOND_HOE, 1, 4], [SELL, I.BERYL, 18, I.DIAMOND_PICKAXE, 1, 5]],
  // Armorers (Armorer's Rack): buy hides and iron; sell leather, gold and diamond armour and shields.
  armorer: [[BUY, I.LEATHER, 8, I.BERYL, 1], [BUY, I.IRON_INGOT, 4, I.BERYL, 1], [BUY, I.GOLD_INGOT, 3, I.BERYL, 1, 2], [BUY, I.SCUTE, 4, I.BERYL, 1, 3], [BUY, I.DIAMOND, 1, I.BERYL, 3, 4],
    [SELL, I.BERYL, 1, I.LEATHER_HELMET, 1], [SELL, I.BERYL, 3, I.LEATHER_CHESTPLATE, 1], [SELL, I.BERYL, 2, I.LEATHER_LEGGINGS, 1], [SELL, I.BERYL, 1, I.LEATHER_BOOTS, 1],
    [SELL, I.BERYL, 4, I.GOLD_HELMET, 1, 2], [SELL, I.BERYL, 8, I.GOLD_CHESTPLATE, 1, 2], [SELL, I.BERYL, 6, I.GOLD_LEGGINGS, 1, 2], [SELL, I.BERYL, 3, I.GOLD_BOOTS, 1, 2],
    [SELL, I.BERYL, 4, I.SHIELD, 1, 3], [SELL, I.BERYL, 6, I.TURTLE_SHELL, 1, 3],
    [SELL, I.BERYL, 14, I.DIAMOND_HELMET, 1, 4], [SELL, I.BERYL, 12, I.DIAMOND_BOOTS, 1, 4],
    [SELL, I.BERYL, 20, I.DIAMOND_LEGGINGS, 1, 5], [SELL, I.BERYL, 24, I.DIAMOND_CHESTPLATE, 1, 5]],
};
/** The trades that level up (everything above; a Roving Peddler's pack is fixed). */
const LEVELED = new Set(Object.keys(OFFERS));
// Roving Peddlers (mobs/peddler.js): they buy a few raw goods and sell odd wares no village stocks; the stock does not refill.
OFFERS.peddler = [[BUY, I.IRON_INGOT, 3, I.BERYL, 1], [BUY, I.GOLD_INGOT, 2, I.BERYL, 1], [BUY, I.LEATHER, 8, I.BERYL, 1], [BUY, I.FEATHER, 20, I.BERYL, 1],
  [SELL, I.BERYL, 1, B.JUNGLE_SAPLING, 1], [SELL, I.BERYL, 1, B.ACACIA_SAPLING, 1], [SELL, I.BERYL, 1, B.DARK_OAK_SAPLING, 1], [SELL, I.BERYL, 1, B.BLOSSOM_SAPLING, 1],
  [SELL, I.BERYL, 1, DYES[2], 3], [SELL, I.BERYL, 1, DYES[6], 3], [SELL, I.BERYL, 1, DYES[11], 3], [SELL, I.BERYL, 1, DYES[14], 3],
  [SELL, I.BERYL, 2, I.GLOW_BERRIES, 6], [SELL, I.BERYL, 2, I.HONEY_BOTTLE, 2], [SELL, I.BERYL, 3, I.SLIMEBALL, 4], [SELL, I.BERYL, 2, I.NAME_TAG, 1],
  [SELL, I.BERYL, 2, I.LEAD, 2], [SELL, I.BERYL, 5, I.SADDLE, 1], [SELL, I.BERYL, 6, I.VOID_PEARL, 1], [SELL, I.BERYL, 3, B.ICE, 4]];
/** Extra sell offers on top of the usual two or three (a peddler's pack is fuller than a settler's stall). */
const EXTRA_SELLS = { peddler: 2 };
const CHART_IDS = new Set(Object.values(CHARTS));
/** Trades whose list always holds at least one offer that passes the test (the first sell is picked among those). */
const GUARANTEED = { cartographer: (o) => CHART_IDS.has(o[3]) };
export const MAX_USES = 12;
export const RESTOCK_TICKS = 12000;

const tierOf = (o) => o[5] || 1;
const toOffer = ([, give, gn, get, getn]) => ({ give, giveCount: gn, get, getCount: getn, uses: 0 });

/** Every offer a trade can ever stock as [kind, give, giveCount, get, getCount, tier] rows (for tests and tooltips). */
export const offerPool = (profession) => (OFFERS[profession] || []).map((o) => [o[0], o[1], o[2], o[3], o[4], tierOf(o)]);

/** Offers for a new settler: one way to earn beryl and two or three things to spend it on (level 1 offers only). */
export function makeTrades(profession, rng = Math.random) {
  const list = OFFERS[profession].filter((o) => tierOf(o) === 1);
  const buys = list.filter((o) => o[0] === BUY), sells = list.filter((o) => o[0] === SELL);
  const pick = (arr) => arr.splice(Math.floor(rng() * arr.length), 1)[0];
  const chosen = [pick(buys.slice())];
  const pool = sells.slice();
  const n = 2 + (rng() < 0.5 ? 1 : 0) + (EXTRA_SELLS[profession] || 0);
  const must = GUARANTEED[profession];
  if (must) { // e.g. a cartographer always stocks a chart: take one of those first
    const first = pick(pool.filter(must));
    pool.splice(pool.indexOf(first), 1);
    chosen.push(first);
  }
  for (let k = 0; k < n - (must ? 1 : 0) && pool.length; k++) chosen.push(pick(pool));
  return chosen.map(toOffer);
}

// ---- levels ------------------------------------------------------------------------

export const MAX_LEVEL = 5;
export const LEVEL_NAMES = ['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master'];
/** Trades a settler must have done in all to reach each level (index 0 = level 1). */
export const LEVEL_AT = [0, 8, 24, 50, 90];

/** The level (1..5) a settler that has done `count` trades has reached. */
export function levelFor(count) {
  let lv = 1;
  for (let k = 1; k < LEVEL_AT.length; k++) if (count >= LEVEL_AT[k]) lv = k + 1;
  return lv;
}

/**
 * Where a settler stands on the way to its next level: { level, name, done, need, frac, max }.
 * `done` and `need` count the trades inside the current level (frac is 1 at the top level).
 */
export function levelProgress(count) {
  count = Math.max(0, Math.floor(count) || 0);
  const level = levelFor(count);
  if (level >= MAX_LEVEL) return { level, name: LEVEL_NAMES[level - 1], done: 1, need: 1, frac: 1, max: true };
  const from = LEVEL_AT[level - 1], to = LEVEL_AT[level];
  return { level, name: LEVEL_NAMES[level - 1], done: count - from, need: to - from, frac: (count - from) / (to - from), max: false };
}

/** Does this trade level up at all? (A peddler's pack does not.) */
export const canLevel = (profession) => LEVELED.has(profession);

/**
 * New offers a settler gets on reaching `level`: one way to earn beryl (when the trade has one at that level) and one or two
 * to spend it on, none it already stocks (compared by what changes hands).
 */
export function levelUpTrades(profession, level, have = [], rng = Math.random) {
  if (!LEVELED.has(profession)) return [];
  const stocked = new Set(have.map((o) => `${o.give}>${o.get}`));
  const pool = OFFERS[profession].filter((o) => tierOf(o) === level && !stocked.has(`${o[1]}>${o[3]}`));
  const pick = (arr) => arr.splice(Math.floor(rng() * arr.length), 1)[0];
  const buys = pool.filter((o) => o[0] === BUY), sells = pool.filter((o) => o[0] === SELL);
  const out = [];
  if (buys.length) out.push(pick(buys));
  const nSell = (out.length ? 1 : 2) + (rng() < 0.4 ? 1 : 0);
  for (let k = 0; k < nSell && sells.length; k++) out.push(pick(sells));
  return out.map(toOffer);
}

/**
 * A settler did `n` more trades: count them and, for every level reached, stock the offers that come with it.
 * Returns how many levels it gained. `mob` has profession, trades, tradeCount and level.
 */
export function recordTrades(mob, n, rng = Math.random) {
  if (!(n > 0)) return 0;
  mob.tradeCount = (mob.tradeCount | 0) + n;
  if (!LEVELED.has(mob.profession)) return 0;
  const want = levelFor(mob.tradeCount);
  let gained = 0;
  if (!(mob.level >= 1)) mob.level = 1;
  while (mob.level < want) {
    mob.level++; gained++;
    mob.trades.push(...levelUpTrades(mob.profession, mob.level, mob.trades, rng));
  }
  return gained;
}

/** A saved settler's level and trade count, checked (older saves had neither: they count the uses of their offers). */
export function cleanLevel(s) {
  const trades = Array.isArray(s.trades) ? s.trades : [];
  const count = Math.max(Math.floor(+s.tradeCount) || 0, s.traded ? trades.reduce((a, o) => a + ((o && o.uses) | 0), 0) : 0);
  return { tradeCount: Math.min(count, 1e6), level: Math.max(1, Math.min(MAX_LEVEL, Math.floor(+s.level) || 1)) };
}

// ---- prices ------------------------------------------------------------------------

/** Demand: every use of an offer since the last restock makes it 6 % dearer (11 uses: two thirds more). */
export const DEMAND_STEP = 0.06;
export const demandFactor = (uses) => 1 + DEMAND_STEP * Math.max(0, Math.min(MAX_USES, uses | 0));

/**
 * What an offer costs after the market (reputation and demand, when `market` = { rep } is given) and a price cut
 * (0..1, e.g. Village Champion's, see raids.js): the reference rule takes floor(cut x price) off, at least one
 * item, but never goes below one. Without `market` the price is the plain one, as in older versions.
 */
export function offerPrice(offer, discount = 0, market = null) {
  let price = offer.giveCount;
  if (market) price = Math.max(1, Math.round(price * repFactor(market.rep || 0) * demandFactor(offer.uses)));
  if (!(discount > 0)) return price;
  return Math.max(1, price - Math.max(1, Math.floor(discount * price)));
}

/** Can the inventory pay for an offer? (Not with a settler that has had enough of the player: see refusesTrade.) */
export function canTrade(offer, inventory, discount = 0, market = null) {
  if (market && refusesTrade(market.rep || 0)) return false;
  return offer.uses < MAX_USES && inventory.count(offer.give) >= offerPrice(offer, discount, market);
}

/** Take the price from the inventory; returns the goods (caller puts them in the inventory). */
export function doTrade(offer, inventory, discount = 0, market = null) {
  if (!canTrade(offer, inventory, discount, market)) return null;
  let left = offerPrice(offer, discount, market);
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

// ---- gifts -------------------------------------------------------------------------

const TREASURE = new Set([I.BERYL, I.GOLD_INGOT, I.DIAMOND, I.GILDED_APPLE]);
/** A settler takes one gift per restock period. */
export const GIFT_COOLDOWN = RESTOCK_TICKS;

/**
 * What a gift of item `id` does for the reputation: goods the settler's trade buys are welcome, treasure more so,
 * anything else is politely refused (0).
 */
export function giftValue(profession, id) {
  if (TREASURE.has(id)) return REP.treasure;
  const list = OFFERS[profession];
  return list && list.some((o) => o[0] === BUY && o[1] === id) ? REP.gift : 0;
}
