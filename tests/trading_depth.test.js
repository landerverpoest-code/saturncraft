// Villager trading in depth: new professions with job-site blocks and house variants, settler levels, village
// reputation (saved and synced in multiplayer) and demand pricing.
import { describe, it, expect, vi } from 'vitest';
import {
  makeTrades, offerPool, offerPrice, canTrade, doTrade, MAX_USES, MAX_LEVEL, LEVEL_AT, LEVEL_NAMES, levelFor, levelProgress,
  levelUpTrades, recordTrades, cleanLevel, canLevel, demandFactor, giftValue, GIFT_COOLDOWN,
} from '../src/mobs/trades.js';
import {
  REP, TRADE_CAP, REFUSE_BELOW, standing, repFactor, refusesTrade, getRep, setRep, addRep, cleanReputation, villageKey, isVillageKey, repHint,
} from '../src/mobs/reputation.js';
import { repEvent } from '../src/mobs/villageRep.js';
import { JOB_SITES, jobSiteProfession, jobSiteBlock, isJobSite, takeJobSite } from '../src/mobs/jobSites.js';
import { Mob } from '../src/mobs/mob.js';
import { championDiscount } from '../src/mobs/raids.js';
import { packMob, unpackMob, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { HostSession, ClientSession } from '../src/net/session.js';
import { Player } from '../src/player/player.js';
import { Inventory } from '../src/player/inventory.js';
import { craft } from '../src/player/crafting.js';
import { playerSaveData, applyPlayerSave } from '../src/world/save.js';
import { B, BLOCKS } from '../src/world/blocks.js';
import { I, ITEMS, CHARTS } from '../src/world/items.js';
import { TEX_NAMES } from '../src/world/textures.js';
import { JOBSITE_TEX } from '../src/world/jobSiteTextures.js';
import { TerrainGenerator } from '../src/world/generator.js';
import {
  villageInRegion, PROFESSIONS, TRADE_PROFESSIONS, VARIANT_PROFESSIONS, VILLAGE_PROFESSIONS, VARIANT_CHANCE, houseProfession,
} from '../src/world/villages.js';
import { cidx } from '../src/world/constants.js';
import { rng } from './helpers.js';

const wire = (x) => JSON.parse(JSON.stringify(x));
const NEW_TRADES = ['mason', 'toolsmith', 'armorer'];
const LEVELED = TRADE_PROFESSIONS;
const settler = (prof = 'smith') => {
  const m = new Mob('settler', 0.5, 64, 0.5);
  m.profession = prof; m.trades = makeTrades(prof, rng(4));
  return m;
};

describe('new professions: job-site blocks', () => {
  it('Masonry Bench, Whetstone Stand and Armorer\'s Rack are appended blocks with textures, items and recipes', () => {
    const ids = [B.MASONRY_BENCH, B.WHETSTONE_STAND, B.ARMOR_RACK];
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      expect(id).toBeGreaterThan(B.HONEY_BLOCK); // appended after everything that existed (ids are never renumbered)
      expect(BLOCKS[id]).toBeTruthy();
      expect(ITEMS[id]).toBeTruthy();
      const t = BLOCKS[id].tex;
      for (const n of [t.top, t.side, t.front]) { expect(JOBSITE_TEX[n]).toBeTypeOf('function'); expect(TEX_NAMES).toContain(n); }
    }
    const s = (id) => (id == null ? null : { id, count: 1 });
    const P = B.OAK_PLANKS;
    expect(craft([B.STONE, B.STONE, P, P, P, P].map(s), 2)).toEqual({ id: B.MASONRY_BENCH, count: 1 });
    expect(craft([I.IRON_INGOT, I.FLINT, P, P, P, P].map(s), 2)).toEqual({ id: B.WHETSTONE_STAND, count: 1 });
    expect(craft([I.LEATHER, I.LEATHER, P, P, P, P].map(s), 2)).toEqual({ id: B.ARMOR_RACK, count: 1 });
  });

  it('each new trade has its own block, one trade per block, and a villager robe', () => {
    expect(jobSiteBlock('mason')).toBe(B.MASONRY_BENCH);
    expect(jobSiteBlock('toolsmith')).toBe(B.WHETSTONE_STAND);
    expect(jobSiteBlock('armorer')).toBe(B.ARMOR_RACK);
    for (const p of NEW_TRADES) { expect(TRADE_PROFESSIONS).toContain(p); for (const id of JOB_SITES[p]) { expect(isJobSite(id)).toBe(true); expect(jobSiteProfession(id)).toBe(p); } }
    expect(Object.keys(JOB_SITES).sort()).toEqual([...TRADE_PROFESSIONS].sort());
    // a settler that takes up the new trade starts as a Novice with its level-1 offers
    const m = new Mob('settler', 0, 64, 0);
    m.tradeCount = 99; m.level = 4;
    expect(takeJobSite(m, { x: 1, y: 64, z: 1, profession: 'armorer' }, 10)).toBe(true);
    expect(m.profession).toBe('armorer');
    expect(m.level).toBe(1); expect(m.tradeCount).toBe(0);
    expect(m.trades[0].get).toBe(I.BERYL);
  });

  it('their robes survive the mob snapshot sent to guests', () => {
    for (const p of NEW_TRADES) {
      const m = new Mob('settler', 1, 64, 2); m.profession = p;
      expect(unpackMob(wire(packMob(m))).profession).toBe(p);
    }
  });
});

describe('new professions: house variants', () => {
  const gen = new TerrainGenerator(4242);
  it('the profession pick is deterministic, about three in ten become a variant, and the original ones are untouched', () => {
    let variants = 0;
    const N = 4000;
    for (let seed = 1; seed <= N; seed++) {
      const a = houseProfession('smith', seed * 7919);
      expect(houseProfession('smith', seed * 7919)).toBe(a);
      if (VARIANT_PROFESSIONS.includes(a)) variants++; else expect(a).toBe('smith');
    }
    expect(variants / N).toBeGreaterThan(VARIANT_CHANCE - 0.05);
    expect(variants / N).toBeLessThan(VARIANT_CHANCE + 0.05);
    expect(PROFESSIONS).toEqual(['farmer', 'librarian', 'smith', 'shepherd', 'butcher', 'fletcher', 'cleric']); // (changing this would change villages not yet generated)
    expect(VILLAGE_PROFESSIONS).toEqual([...PROFESSIONS, ...VARIANT_PROFESSIONS]);
  });

  it('villages plan variant houses, stamp them and give them their job-site block', () => {
    const found = {};
    for (let rx = -6; rx <= 6; rx++) for (let rz = -6; rz <= 6; rz++) {
      const v = villageInRegion(gen, rx, rz);
      if (!v) continue;
      for (const p of v.pieces) if (p.type === 'house') {
        expect(VILLAGE_PROFESSIONS).toContain(p.profession);
        if (VARIANT_PROFESSIONS.includes(p.profession) && !found[p.profession]) found[p.profession] = p;
      }
    }
    for (const prof of NEW_TRADES) expect(found[prof]).toBeTruthy();
    for (const prof of NEW_TRADES) {
      const h = found[prof];
      let site = 0;
      for (let cx = Math.floor(h.x0 / 16); cx <= Math.floor(h.x1 / 16); cx++) for (let cz = Math.floor(h.z0 / 16); cz <= Math.floor(h.z1 / 16); cz++) {
        const c = gen.generate(cx, cz);
        for (let x = Math.max(h.x0, cx * 16); x <= Math.min(h.x1, cx * 16 + 15); x++) for (let z = Math.max(h.z0, cz * 16); z <= Math.min(h.z1, cz * 16 + 15); z++) {
          for (let y = h.y; y < h.y + 3; y++) if (c.blocks[cidx(x - cx * 16, y, z - cz * 16)] === jobSiteBlock(prof)) site++;
        }
      }
      expect(site).toBe(1);
    }
  });
});

describe('trade tiers and settler levels', () => {
  it('levels come with the number of trades done', () => {
    expect(LEVEL_AT.length).toBe(MAX_LEVEL);
    expect(levelFor(0)).toBe(1);
    expect(levelFor(LEVEL_AT[1] - 1)).toBe(1);
    expect(levelFor(LEVEL_AT[1])).toBe(2);
    expect(levelFor(LEVEL_AT[4])).toBe(5);
    expect(levelFor(1e6)).toBe(5);
    for (let k = 1; k < LEVEL_AT.length; k++) expect(LEVEL_AT[k]).toBeGreaterThan(LEVEL_AT[k - 1]);
    const p = levelProgress(LEVEL_AT[1] + 4);
    expect(p).toMatchObject({ level: 2, name: LEVEL_NAMES[1], done: 4, max: false });
    expect(p.need).toBe(LEVEL_AT[2] - LEVEL_AT[1]);
    expect(p.frac).toBeCloseTo(4 / p.need);
    expect(levelProgress(0)).toMatchObject({ level: 1, done: 0, frac: 0 });
    expect(levelProgress(500)).toMatchObject({ level: 5, frac: 1, max: true });
    expect(levelProgress(-3).level).toBe(1);
    expect(levelProgress(NaN).level).toBe(1);
  });

  it('every trade has offers at every tier, new settlers only stock the first tier', () => {
    for (const prof of LEVELED) {
      const pool = offerPool(prof);
      for (let tier = 1; tier <= MAX_LEVEL; tier++) expect(pool.filter((o) => o[5] === tier).length).toBeGreaterThan(0);
      expect(pool.filter((o) => o[5] === 1 && o[0] === 'buy').length).toBeGreaterThan(0);
      expect(pool.filter((o) => o[5] === 1 && o[0] === 'sell').length).toBeGreaterThanOrEqual(2);
      const tier1 = new Set(pool.filter((o) => o[5] === 1).map((o) => `${o[1]}>${o[3]}`));
      for (let k = 0; k < 40; k++) {
        const t = makeTrades(prof, rng(k + 1));
        expect(t[0].get).toBe(I.BERYL);
        expect(t.length).toBeGreaterThanOrEqual(3);
        for (const o of t) { expect(tier1.has(`${o.give}>${o.get}`)).toBe(true); expect(o.uses).toBe(0); }
      }
    }
    expect(offerPool('peddler').every((o) => o[5] === 1)).toBe(true);
    expect(canLevel('peddler')).toBe(false);
    expect(canLevel('mason')).toBe(true);
  });

  it('cartographers still stock a chart from the start, and a better chart comes at no cost to that', () => {
    const chartIds = new Set(Object.values(CHARTS));
    for (let k = 0; k < 60; k++) expect(makeTrades('cartographer', rng(k + 3)).some((o) => chartIds.has(o.get))).toBe(true);
  });

  it('reaching a level adds that tier\'s offers, no duplicates, and keeps what was there', () => {
    for (const prof of LEVELED) {
      const m = settler(prof);
      const first = m.trades.map((o) => ({ ...o }));
      m.trades[0].uses = 5;
      let prev = m.trades.length;
      expect(recordTrades(m, LEVEL_AT[1] - 1, rng(2))).toBe(0);
      expect(m.trades.length).toBe(prev);
      expect(recordTrades(m, 1, rng(2))).toBe(1);
      expect(m.level).toBe(2);
      expect(m.trades.length).toBeGreaterThan(prev);
      expect(m.trades.length).toBeLessThanOrEqual(prev + 3);
      expect(m.trades[0].uses).toBe(5);
      expect(m.trades.slice(0, first.length).map((o) => o.get)).toEqual(first.map((o) => o.get));
      const tier2 = new Set(offerPool(prof).filter((o) => o[5] === 2).map((o) => `${o[1]}>${o[3]}`));
      for (const o of m.trades.slice(prev)) { expect(tier2.has(`${o.give}>${o.get}`)).toBe(true); expect(o.uses).toBe(0); }
      // and on to the top, several levels in one go
      expect(recordTrades(m, 1000, rng(5))).toBe(3);
      expect(m.level).toBe(5);
      const keys = m.trades.map((o) => `${o.give}>${o.get}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(recordTrades(m, 1, rng(6))).toBe(0);
    }
  });

  it('a level-up never repeats what a settler already stocks, and a peddler never levels', () => {
    const have = levelUpTrades('smith', 2, [], () => 0);
    expect(have.length).toBeGreaterThan(0);
    const again = levelUpTrades('smith', 2, have, () => 0);
    for (const o of again) expect(have.some((h) => h.give === o.give && h.get === o.get)).toBe(false);
    const p = settler('farmer'); p.profession = 'peddler'; p.trades = makeTrades('peddler', rng(1));
    const n = p.trades.length;
    expect(recordTrades(p, 500)).toBe(0);
    expect(p.trades.length).toBe(n);
    expect(p.tradeCount).toBe(500);
    expect(levelUpTrades('peddler', 2)).toEqual([]);
  });

  it('older saved settlers: no level or count means the uses of their offers when they had traded', () => {
    expect(cleanLevel({})).toEqual({ tradeCount: 0, level: 1 });
    expect(cleanLevel({ traded: true, trades: [{ uses: 7 }, { uses: 3 }] })).toEqual({ tradeCount: 10, level: 1 });
    expect(cleanLevel({ traded: false, trades: [{ uses: 7 }] })).toEqual({ tradeCount: 0, level: 1 });
    expect(cleanLevel({ tradeCount: 30, level: 3 })).toEqual({ tradeCount: 30, level: 3 });
    expect(cleanLevel({ tradeCount: 'x', level: 99 }).level).toBe(MAX_LEVEL);
    expect(cleanLevel({ tradeCount: -4, level: -2 })).toEqual({ tradeCount: 0, level: 1 });
  });

  it('level, count, village and gift time are saved with the settler; old saves load', () => {
    const m = settler('mason');
    m.village = '320,-640'; m.tradeCount = 30; m.level = 3; m.lastGift = 5000; m.traded = true;
    const saved = wire(m.saveData());
    const n = new Mob('settler', 0, 64, 0); n.loadData(saved);
    expect(n).toMatchObject({ profession: 'mason', village: '320,-640', tradeCount: 30, level: 3, lastGift: 5000 });
    // an old save has none of these fields
    const old = wire(m.saveData());
    for (const k of ['tradeCount', 'level', 'village', 'lastGift']) delete old[k];
    old.trades = [{ give: I.BERYL, giveCount: 2, get: I.SHEARS, getCount: 1, uses: 4 }, { give: I.WHEAT, giveCount: 1, get: I.BERYL, getCount: 1, uses: 2 }];
    const o = new Mob('settler', 0, 64, 0); o.loadData(old);
    expect(o).toMatchObject({ tradeCount: 6, level: 1, village: undefined });
    expect(o.lastGift).toBeLessThan(-1e8);
    const junk = wire(m.saveData()); junk.village = '../../x'; junk.level = 'big'; junk.lastGift = 'now';
    const j = new Mob('settler', 0, 64, 0); j.loadData(junk);
    expect(j.village).toBeUndefined(); expect(j.level).toBe(1);
    expect(Number.isFinite(j.lastGift)).toBe(true);
  });
});

describe('reputation', () => {
  it('moves prices down for friends and up for the disliked, and shuts out the hated', () => {
    expect(repFactor(0)).toBe(1);
    expect(repFactor(100)).toBeCloseTo(0.7);
    expect(repFactor(-100)).toBeCloseTo(1.6);
    expect(repFactor(50)).toBeLessThan(1);
    expect(repFactor(-30)).toBeGreaterThan(1);
    expect(repFactor(NaN)).toBe(1);
    expect(repFactor(5000)).toBeCloseTo(0.7); // clamped
    expect(refusesTrade(REFUSE_BELOW)).toBe(true);
    expect(refusesTrade(REFUSE_BELOW + 1)).toBe(false);
    expect(standing(-100).name).toBe('Hostile');
    expect(standing(-30).name).toBe('Distrusted');
    expect(standing(0).name).toBe('Neutral');
    expect(standing(25).name).toBe('Friendly');
    expect(standing(70).name).toBe('Trusted');
    expect(standing(100).name).toBe('Hero');
    expect(repHint(0)).toMatch(/fair/i);
    expect(repHint(60)).toMatch(/lower/);
    expect(repHint(-30)).toMatch(/higher/);
    expect(repHint(-90)).toMatch(/not trade/i);
  });

  it('is kept per village, clamped, and not remembered at zero', () => {
    const p = { reputation: {} };
    const k = villageKey(320.4, -640.2);
    expect(k).toBe('320,-640');
    expect(isVillageKey(k)).toBe(true);
    expect(isVillageKey('x,y')).toBe(false);
    expect(isVillageKey('1,2,3')).toBe(false);
    expect(getRep(p, k)).toBe(0);
    expect(addRep(p, k, 30)).toBe(30);
    expect(addRep(p, k, 500)).toBe(100);
    expect(addRep(p, k, -999)).toBe(-100);
    expect(addRep(p, k, 100)).toBe(0);
    expect(p.reputation[k]).toBeUndefined();
    expect(setRep(p, 'junk', 5)).toBe(0);
    expect(getRep(null, k)).toBe(0);
    expect(getRep({}, k)).toBe(0);
    // a holder without a table gets one
    const q = {}; addRep(q, k, 4); expect(q.reputation[k]).toBe(4);
  });

  it('trades earn goodwill only up to a cap; gifts and raids go beyond', () => {
    const p = { reputation: {} };
    for (let i = 0; i < 1000; i++) addRep(p, '1,1', REP.trade, 'trade');
    expect(getRep(p, '1,1')).toBe(TRADE_CAP);
    addRep(p, '1,1', REP.raid);
    expect(getRep(p, '1,1')).toBe(TRADE_CAP + REP.raid);
    // trading never pulls someone back down from beyond the cap
    addRep(p, '1,1', REP.trade, 'trade');
    expect(getRep(p, '1,1')).toBe(TRADE_CAP + REP.raid);
  });

  it('sanitises a saved table', () => {
    const t = cleanReputation({ '1,2': 50, '3,4': 400, '5,6': 0, bad: 5, '7,8': 'x', '9,9': NaN, '-4,5': -70.126 });
    expect(t).toEqual({ '1,2': 50, '3,4': 100, '-4,5': -70.13 });
    expect(cleanReputation(null)).toEqual({});
    expect(cleanReputation([1, 2])).toEqual({});
    expect(cleanReputation('x')).toEqual({});
    const many = {}; for (let i = 0; i < 500; i++) many[`${i},${i}`] = 10;
    expect(Object.keys(cleanReputation(many)).length).toBeLessThanOrEqual(200);
  });

  it('is saved with the player and loads from older saves without it', () => {
    const p = new Player();
    p.reputation = { '320,-640': 42, '0,0': -15.5 };
    const d = wire(playerSaveData(p));
    expect(d.reputation).toEqual({ '320,-640': 42, '0,0': -15.5 });
    const game = { player: new Player() };
    applyPlayerSave(game, d);
    expect(game.player.reputation).toEqual({ '320,-640': 42, '0,0': -15.5 });
    const old = wire(playerSaveData(new Player())); delete old.reputation;
    game.player.reputation = { '1,1': 9 };
    applyPlayerSave(game, old);
    expect(game.player.reputation).toEqual({});
    d.reputation = { evil: 99, '5,5': 1e9 };
    applyPlayerSave(game, d);
    expect(game.player.reputation).toEqual({ '5,5': 100 });
  });

  it('gifts: goods the trade buys and treasure count, one per restock period', () => {
    expect(giftValue('farmer', I.WHEAT)).toBe(REP.gift);
    expect(giftValue('smith', I.IRON_INGOT)).toBe(REP.gift);
    expect(giftValue('mason', I.CLAY_BALL)).toBe(REP.gift);
    expect(giftValue('farmer', I.IRON_INGOT)).toBe(0);
    expect(giftValue('farmer', I.BERYL)).toBe(REP.treasure);
    expect(giftValue('anything', I.DIAMOND)).toBe(REP.treasure);
    expect(giftValue('nobody', I.STICK)).toBe(0);
    expect(GIFT_COOLDOWN).toBeGreaterThan(0);
  });
});

describe('prices: reputation and demand', () => {
  const offer = (give, giveCount, uses = 0) => ({ give, giveCount, get: I.BREAD, getCount: 6, uses });

  it('without a market the price is the plain one, as before', () => {
    expect(offerPrice(offer(I.BERYL, 4, 9))).toBe(4);
    expect(offerPrice(offer(I.BERYL, 4, 9), 0.3)).toBeLessThan(4);
    expect(offerPrice({ giveCount: 1, uses: 0 }, 0.3)).toBe(1);
  });

  it('every use of an offer makes it dearer until the restock', () => {
    expect(demandFactor(0)).toBe(1);
    expect(demandFactor(MAX_USES)).toBeGreaterThan(1.5);
    expect(demandFactor(500)).toBe(demandFactor(MAX_USES));
    const market = { rep: 0 };
    const prices = Array.from({ length: MAX_USES }, (_, u) => offerPrice(offer(I.BERYL, 9, u), 0, market));
    expect(prices[0]).toBe(9);
    for (let k = 1; k < prices.length; k++) expect(prices[k]).toBeGreaterThanOrEqual(prices[k - 1]);
    expect(prices.at(-1)).toBeGreaterThan(prices[0] * 1.4);
    // a one-beryl offer needs a lot of use before it costs two
    expect(offerPrice(offer(I.BERYL, 1, 0), 0, market)).toBe(1);
    expect(offerPrice(offer(I.BERYL, 1, MAX_USES - 1), 0, market)).toBe(2);
  });

  it('a good name is cheaper, a bad one dearer, and the Champion cut still applies on top', () => {
    const o = offer(I.BERYL, 20);
    expect(offerPrice(o, 0, { rep: 100 })).toBeLessThan(offerPrice(o, 0, { rep: 0 }));
    expect(offerPrice(o, 0, { rep: -50 })).toBeGreaterThan(offerPrice(o, 0, { rep: 0 }));
    expect(offerPrice(o, 0, { rep: 100 })).toBe(14);
    expect(offerPrice(o, 0.3, { rep: 100 })).toBeLessThan(14);
    expect(offerPrice(o, championDiscount({}), { rep: 0 })).toBe(20);
    expect(offerPrice(offer(I.BERYL, 1), 0.5, { rep: 100 })).toBe(1); // never below one
  });

  it('trading pays the dearer price, hostile settlers refuse, and the restock brings the price back', () => {
    const inv = new Inventory();
    inv.slots[0] = { id: I.BERYL, count: 64, damage: 0 };
    const o = offer(I.BERYL, 9);
    const before = inv.count(I.BERYL);
    expect(doTrade(o, inv, 0, { rep: 0 })).toMatchObject({ id: I.BREAD, count: 6 });
    expect(inv.count(I.BERYL)).toBe(before - 9);
    const second = offerPrice(o, 0, { rep: 0 });
    expect(second).toBeGreaterThan(9);
    const mid = inv.count(I.BERYL);
    doTrade(o, inv, 0, { rep: 0 });
    expect(inv.count(I.BERYL)).toBe(mid - second);
    expect(canTrade(o, inv, 0, { rep: REFUSE_BELOW })).toBe(false);
    expect(doTrade(o, inv, 0, { rep: REFUSE_BELOW })).toBe(null);
    expect(canTrade(o, inv, 0, { rep: REFUSE_BELOW + 1 })).toBe(true);
    // the settler restocking (mobs/mob.js) resets the uses and with them the demand
    o.uses = 0;
    expect(offerPrice(o, 0, { rep: 0 })).toBe(9);
    // sold out stays sold out whatever the name
    o.uses = MAX_USES;
    expect(canTrade(o, inv, 0, { rep: 100 })).toBe(false);
  });

  it('the old rules still hold without a market: 12 uses, flat price', () => {
    const inv = new Inventory();
    inv.slots[0] = { id: I.WHEAT, count: 64 * 5, damage: 0 };
    const o = { give: I.WHEAT, giveCount: 20, get: I.BERYL, getCount: 1, uses: 0 };
    let got = 0;
    while (canTrade(o, inv)) got += doTrade(o, inv).count;
    expect(got).toBe(MAX_USES);
    expect(inv.count(I.WHEAT)).toBe(320 - 240);
  });
});

describe('settlers react to the player', () => {
  /** A settler with a village in a minimal game; the attacker is a player object. */
  function scene() {
    const m = new Mob('settler', 0.5, 64, 0.5);
    m.profession = 'farmer'; m.trades = []; m.village = '320,-640';
    const g = { player: { isPlayer: true, x: 0, y: 64, z: 0, reputation: {}, stats: { kills: 0, killsBy: {} } }, entities: { list: [m], spawnItem() {}, spawnXp() {} }, hud: { toast: vi.fn() }, time: 1000, ticks: 0, net: null, milestones: { event() {} }, audio: { play() {} }, particles: { emit() {} } };
    m._game = g;
    return { m, g };
  }

  it('hitting a settler costs reputation once per hit; killing it costs much more', () => {
    const { m, g } = scene();
    m.health = 50;
    m.hurt(1, 'player', g.player, 0.4);
    expect(getRep(g.player, '320,-640')).toBe(REP.hit);
    m.hurt(1, 'player', g.player, 0.4); // inside the same hit window: no second charge
    expect(getRep(g.player, '320,-640')).toBe(REP.hit);
    m.invulnerable = 0;
    m.hurt(1, 'player', g.player, 0.4);
    expect(getRep(g.player, '320,-640')).toBe(2 * REP.hit);
    m.invulnerable = 0; m.health = 1;
    m.hurt(5, 'player', g.player, 0.4);
    m.die(g, 'player');
    expect(getRep(g.player, '320,-640')).toBe(3 * REP.hit + REP.kill);
    expect(g.hud.toast).toHaveBeenCalled();
  });

  it('a mob that is not a player does not change anything', () => {
    const { m, g } = scene();
    m.hurt(1, 'fall', null, 0);
    m.hurt(1, 'arrow', { isPlayer: false }, 0.4);
    expect(getRep(g.player, '320,-640')).toBe(0);
  });

  it('a settler finds its village from its house when the save did not say', () => {
    const gen = new TerrainGenerator(4242);
    let v = null;
    for (let rx = -4; rx <= 4 && !v; rx++) for (let rz = -4; rz <= 4 && !v; rz++) { const c = villageInRegion(gen, rx, rz); if (c && c.pieces.some((p) => p.type === 'house')) v = c; }
    const house = v.pieces.find((p) => p.type === 'house');
    const m = new Mob('settler', 0, 64, 0);
    expect(m.villageId({ world: { gen } })).toBe(null); // no house yet; nothing is remembered about it
    m.village = undefined;
    m.home = { x: (house.x0 + house.x1) / 2 + 0.5, y: house.y, z: (house.z0 + house.z1) / 2 + 0.5 };
    expect(m.villageId({ world: { gen } })).toBe(villageKey(v.cx, v.cz));
    const far = new Mob('settler', 0, 64, 0); far.home = { x: 9e5, y: 64, z: 9e5 };
    expect(far.villageId({ world: { gen } })).toBe(null);
  });
});

describe('multiplayer: the host keeps a guest\'s reputation', () => {
  function guest(id, name, state) {
    const sent = [];
    const rp = { id, name, state, target: null };
    rp.target = { isPlayer: true, isRemotePlayer: true, remote: rp, netName: name, reputation: {}, get x() { return rp.state.x; }, get y() { return rp.state.y; }, get z() { return rp.state.z; } };
    return { id, name, joined: true, rp, ch: { send: (m) => sent.push(wire(m)), conn: { send() {} } }, sent };
  }
  function hostWith(c, settlerMob) {
    const h = new HostSession('Host', null, 'ABCDEF');
    const g = { player: { isPlayer: true, x: 0, y: 64, z: 0, reputation: {} }, time: 5000, ticks: 0, world: { dimension: 'overworld' }, audio: { play() {} }, entities: { list: [settlerMob] }, netPlayers: { [c.name]: { slots: [], reputation: {} } }, net: h };
    g.localPlayer = g.player;
    h.game = g;
    h.clients.set(c.id, c);
    settlerMob._game = g;
    return { h, g };
  }
  const mkSettler = () => {
    const m = new Mob('settler', 1, 64, 1);
    m.id = 4321; m.profession = 'smith'; m.trades = makeTrades('smith', rng(9)); m.village = '320,-640';
    return m;
  };

  it('a guest\'s trade counts for the settler\'s level and the guest\'s reputation, and the guest is told', () => {
    const c = guest(3, 'Ann', { x: 1, y: 64, z: 2 });
    const m = mkSettler();
    const { h, g } = hostWith(c, m);
    h.onMessage(c, { t: 'trade', id: 4321, i: 0, n: 3 });
    expect(m.trades[0].uses).toBe(3);
    expect(m.tradeCount).toBe(3);
    expect(m.traded).toBe(true);
    const traded = c.sent.find((s) => s.t === 'traded');
    expect(traded).toMatchObject({ id: 4321, i: 0, n: 3, tc: 3, lv: 1 });
    expect(traded.trades.length).toBe(m.trades.length);
    expect(getRep(c.rp.target, '320,-640')).toBeCloseTo(3 * REP.trade);
    expect(c.sent.find((s) => s.t === 'rep')).toMatchObject({ k: '320,-640', v: 0.75 });
    expect(g.netPlayers.Ann.reputation['320,-640']).toBeCloseTo(0.75); // and it is in the guest's saved record
    expect(getRep(g.player, '320,-640')).toBe(0); // the host's own is separate
    // a batch that levels the settler up sends the new offers along
    const before = m.trades.length;
    h.onMessage(c, { t: 'trade', id: 4321, i: 1, n: 12 });
    expect(m.level).toBe(2);
    expect(m.trades.length).toBeGreaterThan(before);
    expect(c.sent.filter((s) => s.t === 'traded').at(-1)).toMatchObject({ lv: 2, tc: m.tradeCount });
  });

  it('a settler whose village has turned on the guest does not trade with it', () => {
    const c = guest(3, 'Ann', { x: 1, y: 64, z: 2 });
    c.rp.target.reputation = { '320,-640': -80 };
    const m = mkSettler();
    const { h } = hostWith(c, m);
    h.onMessage(c, { t: 'trade', id: 4321, i: 0, n: 5 });
    expect(m.trades[0].uses).toBe(0);
    expect(m.tradeCount).toBe(0);
    expect(c.sent.find((s) => s.t === 'traded')).toMatchObject({ n: 0 });
  });

  it('a gift the guest holds is taken once per period and raises reputation', () => {
    const c = guest(3, 'Ann', { x: 1, y: 64, z: 2, held: I.IRON_INGOT });
    const m = mkSettler();
    const { h, g } = hostWith(c, m);
    h.onMessage(c, { t: 'gift', id: 4321 });
    expect(c.sent.at(-1)).toMatchObject({ t: 'gifted', ok: 1, item: I.IRON_INGOT });
    expect(getRep(c.rp.target, '320,-640')).toBe(REP.gift);
    expect(c.sent.some((s) => s.t === 'rep' && s.v === REP.gift)).toBe(true);
    h.onMessage(c, { t: 'gift', id: 4321 }); // not again so soon
    expect(c.sent.at(-1)).toMatchObject({ t: 'gifted', ok: 0 });
    expect(getRep(c.rp.target, '320,-640')).toBe(REP.gift);
    g.time += GIFT_COOLDOWN;
    h.onMessage(c, { t: 'gift', id: 4321 });
    expect(c.sent.at(-1)).toMatchObject({ ok: 1 });
    expect(getRep(c.rp.target, '320,-640')).toBe(2 * REP.gift);
    // something it has no use for, or too far away
    g.time += GIFT_COOLDOWN; c.rp.state.held = I.STICK;
    h.onMessage(c, { t: 'gift', id: 4321 });
    expect(c.sent.at(-1)).toMatchObject({ ok: 0 });
    const n = c.sent.length;
    c.rp.state = { x: 50, y: 64, z: 50, held: I.IRON_INGOT };
    h.onMessage(c, { t: 'gift', id: 4321 });
    expect(c.sent.length).toBe(n);
  });

  it('repEvent tells a guest, and not the host\'s own player', () => {
    const c = guest(3, 'Ann', { x: 1, y: 64, z: 2 });
    const { g } = hostWith(c, mkSettler());
    repEvent(g, g.player, '1,1', 10);
    expect(getRep(g.player, '1,1')).toBe(10);
    expect(c.sent.length).toBe(0);
    repEvent(g, c.rp.target, '1,1', 12);
    expect(c.sent.at(-1)).toEqual({ t: 'rep', k: '1,1', v: 12 });
  });

  it('the host keeps its copy when the guest saves its player record', () => {
    const c = guest(3, 'Ann', { x: 1, y: 64, z: 2 });
    const { h, g } = hostWith(c, mkSettler());
    c.rp.target.reputation = { '2,2': 33 };
    h.onMessage(c, { t: 'ps', p: { slots: [], reputation: { '2,2': -100, '9,9': 100 } } }); // (a guest cannot give itself a name)
    expect(g.netPlayers.Ann.reputation).toEqual({ '2,2': 33 });
  });

  it('the guest applies the host\'s reputation, pays the demand price per trade, and rebuilds the screen on a level-up', () => {
    const cs = new ClientSession('Bea');
    const inv = new Inventory();
    inv.slots[0] = { id: I.BERYL, count: 64, damage: 0 };
    const player = { x: 0, y: 64, z: 0, inventory: inv, effects: {}, stats: { trades: 0 }, reputation: {} };
    const reopened = [];
    const mob = { netId: 7, def: {}, trades: [{ give: I.BERYL, giveCount: 9, get: I.BREAD, getCount: 6, uses: 0 }], village: '1,1', x: 0, y: 64, z: 0 };
    cs.game = {
      player, entities: { spawnItem() {}, spawnXp() {} }, audio: { play() {} }, milestones: { event() {} },
      ui: { open: 'trade', refreshAll() {}, openTrade: (m) => reopened.push(m) },
    };
    cs.ents = { byNetId: () => mob };
    cs.handle({ t: 'rep', k: '1,1', v: 40 });
    expect(player.reputation).toEqual({ '1,1': 40 });
    cs.handle({ t: 'rep', k: 'evil', v: 40 });
    cs.handle({ t: 'rep', k: '2,2', v: 'lots' });
    expect(player.reputation).toEqual({ '1,1': 40 });
    // two trades in a batch: the second is dearer
    const hostOffer = { ...mob.trades[0], uses: 2 };
    cs.handle({ t: 'traded', id: 7, i: 0, n: 2, trades: [hostOffer], tc: 2, lv: 1 });
    const spent = 64 - inv.count(I.BERYL);
    expect(spent).toBe(offerPrice({ ...hostOffer, uses: 0 }, 0, { rep: 40 }) + offerPrice({ ...hostOffer, uses: 1 }, 0, { rep: 40 }));
    expect(inv.count(I.BREAD)).toBe(12);
    expect(mob.trades[0].uses).toBe(2);
    expect(mob.tradeCount).toBe(2);
    expect(reopened.length).toBe(0);
    // the host levelled it up: more offers than we had
    const more = [hostOffer, { give: I.BERYL, giveCount: 3, get: I.COOKIE, getCount: 6, uses: 0 }];
    cs.handle({ t: 'traded', id: 7, i: 0, n: 0, trades: more, tc: 8, lv: 2 });
    expect(mob.trades.length).toBe(2);
    expect(mob.level).toBe(2);
    expect(reopened).toEqual([mob]);
  });

  it('the protocol version moved on, so old clients are turned away', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(2);
  });
});
