// Balance invariants: the numbers scripts/balance/report.mjs prints, kept inside bounds.
// (Run `node scripts/balance/report.mjs` to see them.)
import { describe, it, expect } from 'vitest';
import { I, ITEMS, CHARTS } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';
import { offerPrice, offerPool, MAX_USES, MAX_TOTAL_CUT } from '../src/mobs/trades.js';
import { repFactor } from '../src/mobs/reputation.js';
import { rollDrops } from '../src/mobs/drops.js';
import { STRUCTURE_LOOT, LOOT_A, LOOT_B, LOOT } from '../src/mobs/spawnerBlocks.js';
import { cleanEnch, ENCHANTS, ENCH_KEYS, availableEnchants, meleeBonus, protectionFactor, protectionReduce } from '../src/world/enchantments.js';
import { SEASON_DATA, SEASON_KEYS, seasonalChance, climate, applyValues, resetClimate, seasonState, seasonValues, DAY_TICKS } from '../src/world/seasons.js';
import { xpToNextLevel } from '../src/player/experience.js';
import { MARKETS, arbitrageLoops, pricedOffers, PROFESSIONS, nameOf } from '../scripts/balance/trade.mjs';
import { naturalSources, deadRecipes, resourceLoops } from '../scripts/balance/craft.mjs';
import { CHEST_KINDS, chestStats, valueTable, fishingStats } from '../scripts/balance/loot.mjs';
import { armorSets, damageAfter, hitsToKill, arrowHitsToKill, bossTable, weaponProfile, timeToKill, dpsAgainst, tierWeapons, weaponVector, dominates, TTK_TARGETS } from '../scripts/balance/combat.mjs';
import { setBonusProtect } from '../scripts/balance/setcheck.mjs';
import { SETS } from '../src/player/setBonuses.js';
import { WEAPONS } from '../src/world/items.js';
import { foods, xpTotal, yearlyGrowth, seasonalChances, maxProtection } from '../scripts/balance/misc.mjs';
import { HUSHKEEPER } from '../src/mobs/hushkeeper.js';
import { RIMEKEEP_WARDEN } from '../src/world/rimekeep.js';
import { rng } from './helpers.js';

describe('trade economy', () => {
  it('has no buy -> craft/smelt -> sell loop in any market, at any demand', () => {
    for (const [name, market] of Object.entries(MARKETS)) for (let uses = 0; uses < MAX_USES; uses++) {
      const loops = arbitrageLoops(market, uses);
      expect(loops.map((l) => `${name}/${uses}: ${l.name} at ${l.buyer} ${l.cost} -> ${l.income}`)).toEqual([]);
    }
  });

  it('keeps the old Hay Bale and Leather loops closed (cuts only help what the player buys with beryl)', () => {
    const hay = { give: I.BERYL, giveCount: 1, get: B.HAY_BALE, getCount: 2, uses: 0 };
    const wheat = { give: I.WHEAT, giveCount: 20, get: I.BERYL, getCount: 1, uses: 0 };
    const hero = { rep: 100, festival: 0.12 };
    // 1 beryl buys 18 wheat of Hay; the farmer must not give more than 18/20 of a beryl back
    expect(18 / offerPrice(wheat, 0.55, hero)).toBeLessThanOrEqual(1);
    expect(offerPrice(hay, 0.55, hero)).toBe(1);
    const leather = { give: I.LEATHER, giveCount: 8, get: I.BERYL, getCount: 1, uses: 0 };
    expect(offerPrice(leather, 0.55, hero)).toBe(8);
    expect(offerPrice(leather, 0, { rep: 0 })).toBe(8);
  });

  it('still lets a bad name raise what a settler asks for its beryl', () => {
    const wheat = { give: I.WHEAT, giveCount: 20, get: I.BERYL, getCount: 1, uses: 0 };
    expect(offerPrice(wheat, 0, { rep: -50 })).toBeGreaterThan(20);
  });

  it('never takes more than half off a price, however the cuts stack', () => {
    for (const prof of PROFESSIONS) for (const [kind, give, gn, get, getn] of offerPool(prof)) {
      if (kind !== 'sell') continue;
      const o = { give, giveCount: gn, get, getCount: getn, uses: 0 };
      const best = offerPrice(o, 0.55, { rep: 100, festival: 0.12 });
      expect(best, `${prof}: ${nameOf(get)}`).toBeGreaterThanOrEqual(Math.min(gn, Math.ceil(gn * (1 - MAX_TOTAL_CUT))));
      expect(best).toBeLessThanOrEqual(gn);
      expect(best).toBeGreaterThanOrEqual(1);
    }
  });

  it('prices without a market are still the plain ones (older saves, guests)', () => {
    const o = { give: I.BERYL, giveCount: 9, get: B.BOOKSHELF, getCount: 1, uses: 0 };
    expect(offerPrice(o)).toBe(9);
    expect(offerPrice(o, 0.3)).toBe(7);
    expect(offerPrice({ giveCount: 20, uses: 0 }, 0.3)).toBe(14);
  });

  it('a settler never asks for more beryl than any buyer pays out for one item (offer bounds)', () => {
    for (const o of pricedOffers(MARKETS.neutral, 0)) {
      if (o.kind === 'buy') { expect(o.getN / o.giveN, nameOf(o.give)).toBeLessThanOrEqual(3); expect(o.getN).toBeLessThanOrEqual(3); } // no raw good is worth more than a Diamond's 3 beryl
      else expect(o.giveN, nameOf(o.get)).toBeLessThanOrEqual(30);
    }
  });

  it('the dearest things stay out of early reach (tier), charts apart: every cartographer stocks one', () => {
    const charts = new Set(Object.values(CHARTS));
    for (const prof of PROFESSIONS) for (const [kind, , gn, get, , tier] of offerPool(prof)) {
      if (kind !== 'sell' || charts.has(get)) continue;
      if (gn >= 14) expect(tier, `${prof}: ${nameOf(get)} costs ${gn}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('the Marauder\'s beryl is not multiplied by Plunder', () => {
    const r = rng(11);
    const mean = (plunder) => { let t = 0; for (let k = 0; k < 4000; k++) for (const d of rollDrops('marauder', { killedByPlayer: true, plunder }, r)) if (d.id === I.BERYL) t += d.count; return t / 4000; };
    expect(mean(0)).toBeGreaterThan(0.4);
    expect(mean(0)).toBeLessThan(0.6);
    expect(mean(3)).toBeLessThan(0.6);
  });
});

describe('crafting graph', () => {
  const src = naturalSources();
  // Items that exist only through an interaction (not a recipe, drop table or trade); each has a documented source.
  const INTERACTION_ITEMS = {
    EGG: 'Clucklings lay them (mobs/mob.js)', MILK_BUCKET: 'milking a Mooxen (player/interaction.js)', HONEYCOMB: 'shearing a full hive (player/interaction.js)',
    WATER_BUCKET: 'filling a Bucket', LAVA_BUCKET: 'filling a Bucket', ENCHANTED_BOOK: 'the enchanting table', FILLED_MAP: 'a map filled in', WRITTEN_BOOK: 'signing a Writable Book',
    TATTERED_BOOK: 'copying a copy', CRAG_HORN: 'a Cragbuck ramming stone (mobs/mob.js)', SWEET_BERRIES: 'picking a Sweet Berry Bush', POPPED_HUSHFRUIT: 'eating a Hushfruit',
    CROSSBOW_LOADED: 'loading a Crossbow', EYE_OF_THE_VOID: 'Void Pearl and Ember Powder (world/dimensions/register.js)',
    TARNLING_BUCKET: 'scooping a Tarnling with an empty Bucket (mobs/fauna.js)',
    SLAGSTEEL_INGOT: 'smelting Slag Chunks (world/dimensions/register.js)', SLAGSTEEL_PICKAXE: 'Slagsteel Ingots (world/dimensions/register.js)', DIRGESTEP_BOOTS: 'Dirge Crystals (world/dimensions/register.js)',
    SLAG_SIGIL: 'Slagsteel Ingots, Ember Rods, a Dirge Crystal and Obsidian (world/dimensions/register.js)',
    SURVEYOR_WAND: '/wand or the creative inventory (ui/buildCommands.js)',
  };
  const extra = new Set([
    ...ITEMS.filter((it) => it && (it.potion || it.splash || it.lingering)).map((i) => i.id), // brewed (world/brewing.js)
    ...Object.keys(INTERACTION_ITEMS).map((k) => I[k]),
  ]);

  it('every recipe and smelting step can be made from things the game hands out', () => {
    const { dead } = deadRecipes(src, extra);
    expect(dead.map((d) => `${nameOf(d.result)} needs ${d.missing.map(nameOf).join(', ')}`)).toEqual([]);
  });

  it('every pure item (not a block) has a source, a recipe or a documented interaction', () => {
    const { obtainable } = deadRecipes(src, extra);
    const orphans = ITEMS.filter((it) => it && !it.block && !obtainable.has(it.id)).map((it) => it.key);
    expect(orphans).toEqual([]);
  });

  it('documented interaction items are not also craftable by accident (no duplicate cheap source)', () => {
    const { obtainable } = deadRecipes(src, new Set());
    for (const k of ['ENCHANTED_BOOK', 'WRITTEN_BOOK', 'WATER_BUCKET', 'LAVA_BUCKET', 'FILLED_MAP']) expect(obtainable.has(I[k]), k).toBe(false);
  });

  it('no chain of recipes turns a stack into a bigger one', () => {
    expect(resourceLoops().map(nameOf)).toEqual([]);
  });

  it('rare items keep their few sources', () => {
    const count = (k) => (src.get(I[k]) || new Set()).size;
    expect(count('SUNCORE')).toBe(1);
    expect(count('VOIDWING')).toBe(1);
    expect(count('TIDESPEAR')).toBe(1);
    expect(count('CHARM_OF_UNDYING')).toBeLessThanOrEqual(2);
    // no chest anywhere hands out a Charm, Suncore or Voidwing outside the Hollow ship
    for (const s of src.get(I.CHARM_OF_UNDYING) || []) expect(s.startsWith('chest:'), s).toBe(false);
    for (const s of src.get(I.VOIDWING) || []) expect(s).toBe('chest:HOLLOW_SHIP');
  });
});

describe('loot tables', () => {
  const tables = [['LOOT_A', LOOT_A], ['LOOT_B', LOOT_B], ...Object.entries(STRUCTURE_LOOT).map(([k, t]) => [`kind ${k}`, t[0]])];

  it('every entry is a real item with a sane weight and count', () => {
    for (const [label, table] of tables) {
      const seen = new Set();
      for (const e of table) {
        const [id, min, max, w] = e;
        expect(ITEMS[id], `${label} has a missing item`).toBeTruthy();
        expect(min, `${label}: ${nameOf(id)}`).toBeLessThanOrEqual(max);
        expect(min).toBeGreaterThanOrEqual(1);
        expect(w).toBeGreaterThan(0);
        expect(max).toBeLessThanOrEqual(ITEMS[id].stack);
        expect(seen.has(id), `${label}: ${nameOf(id)} listed twice`).toBe(false);
        seen.add(id);
      }
    }
  });

  const value = valueTable();
  const stats = Object.fromEntries(Object.entries(CHEST_KINDS).map(([name, kind]) => [name, chestStats(kind, 1500, 5, value)]));

  it('chest kinds stay within bounds of what they hold on average', () => {
    for (const [name, s] of Object.entries(stats)) {
      expect(s.value, `${name} value`).toBeGreaterThan(1);
      expect(s.value, `${name} value`).toBeLessThan(30);
      expect(s.stacks, `${name} stacks`).toBeLessThanOrEqual(8);
      expect(s.items.get(I.DIAMOND) || 0, `${name} diamonds`).toBeLessThanOrEqual(1.2);
      expect(s.items.get(I.GILDED_APPLE) || 0, `${name} gilded apples`).toBeLessThanOrEqual(1.3);
      expect(s.items.get(I.BERYL) || 0, `${name} beryl`).toBeLessThanOrEqual(5);
      expect(s.items.get(I.CHARM_OF_UNDYING) || 0, `${name} charms`).toBe(0);
    }
  });

  it('the poorest chest is not worth under a tenth of the richest, and none is empty', () => {
    const vals = Object.values(stats).map((s) => s.value);
    expect(Math.min(...vals) * 25).toBeGreaterThan(Math.max(...vals));
  });

  it('fishing hands out diamonds rarely, even with the best luck', () => {
    expect(fishingStats(0).get(I.DIAMOND)).toBeLessThan(0.015);
    expect(fishingStats(4).get(I.DIAMOND)).toBeLessThan(0.035);
  });

  it('the Rimekeep chests use tables that exist', () => {
    for (const k of [LOOT.IGLOO, LOOT.OUTPOST, LOOT.TOMB, LOOT.WRECK_TREASURE]) expect(STRUCTURE_LOOT[k]).toBeTruthy();
  });
});

describe('combat', () => {
  const sets = armorSets();

  it('each armour tier takes off more than the one before, never more than 80 % unenchanted', () => {
    for (const d of [1, 2, 3, 5, 7, 10, 20, 30, 45]) {
      const order = ['none', 'leather', 'gold', 'iron', 'diamond'].map((k) => damageAfter(d, sets[k]));
      for (let k = 1; k < order.length; k++) expect(order[k], `hit ${d}`).toBeLessThan(order[k - 1]);
      expect(order[4]).toBeGreaterThanOrEqual(d * 0.2 - 1e-9);
    }
  });

  it('a full set of Bulwark IV is capped well short of invulnerable', () => {
    expect(maxProtection()).toBe(16);
    expect(maxProtection()).toBeLessThanOrEqual(20);
    const epf = protectionFactor([{ ench: { bulwark: 4, featherstep: 4 } }, { ench: { bulwark: 4, featherstep: 4 } }, { ench: { bulwark: 4, featherstep: 4 } }, { ench: { bulwark: 4, featherstep: 4 } }], 'fall');
    expect(epf).toBe(20);
    // diamond + Bulwark IV x4 still takes at least 7 % of a blow
    for (const d of [3, 10, 30]) expect(damageAfter(d, sets.diamond, 16) / d).toBeGreaterThan(0.07);
    expect(protectionReduce(100, 99)).toBeCloseTo(20); // (the cap of 20 holds)
  });

  it('nothing the player meets in the overworld one-shots a player in diamond armour on Normal', () => {
    for (const hit of [3, 7, 10, 30 /* Hushkeeper */]) expect(damageAfter(hit, sets.diamond)).toBeLessThan(20);
    expect(damageAfter(HUSHKEEPER.MELEE, sets.iron)).toBeGreaterThan(20); // iron is not enough for the Warden's keeper: gear up first
  });

  it('the Rimekeep Warden and the Hushkeeper are long fights but not endless', () => {
    const rows = Object.fromEntries(bossTable().map((r) => [r.weapon, r]));
    expect(rows['diamond sword Keen V'].warden).toBeGreaterThan(15);
    expect(rows['diamond sword Keen V'].warden).toBeLessThanOrEqual(40);
    expect(rows['iron sword'].warden).toBeLessThanOrEqual(80);
    expect(rows['iron sword'].hushkeeper).toBeLessThanOrEqual(100);
    expect(rows['diamond sword Keen V'].hushkeeper).toBeLessThanOrEqual(60);
    // better gear always means fewer blows
    expect(rows['diamond sword'].warden).toBeLessThan(rows['iron sword'].warden);
    expect(rows['diamond sword Keen V'].warden).toBeLessThan(rows['diamond sword'].warden);
    expect(rows['bow, Strongdraw V'].warden).toBeLessThan(rows['diamond sword Keen V'].warden);
    expect(RIMEKEEP_WARDEN.hp).toBeLessThan(HUSHKEEPER.HEALTH);
    expect(hitsToKill(RIMEKEEP_WARDEN.hp, 'diamond', I.DIAMOND_SWORD, 0)).toBe(rows['diamond sword'].warden);
    expect(arrowHitsToKill(RIMEKEEP_WARDEN.hp, 'diamond', 0)).toBeGreaterThan(arrowHitsToKill(RIMEKEEP_WARDEN.hp, 'diamond', 5));
  });
});

describe('weapons (gear round)', () => {
  const NEW = ['warhammer', 'dagger', 'glaive', 'disc'];
  const tiers = ['stone', 'iron', 'diamond'];

  it('every new weapon kills a 20 hp monster in the open in 1 to 5 seconds (documented range), and the armoured and Warden fights stay long but finite', () => {
    for (const k of NEW) for (const tier of tiers) {
      const id = WEAPONS[k][tier], name = weaponProfile(id).name;
      const open = timeToKill(id, TTK_TARGETS.open20);
      expect(open, `${name} on 20 hp`).toBeGreaterThanOrEqual(1);
      expect(open, `${name} on 20 hp`).toBeLessThanOrEqual(5);
      expect(timeToKill(id, TTK_TARGETS.armoured20), `${name} armoured`).toBeLessThanOrEqual(25);
      expect(timeToKill(id, TTK_TARGETS.warden), `${name} Warden`).toBeLessThanOrEqual(110);
      expect(timeToKill(id, TTK_TARGETS.warden), `${name} Warden`).toBeGreaterThanOrEqual(25);
    }
  });

  it('within a tier no weapon is at least as good as another on every axis (dps, dps against armour, biggest blow, reach, crowd dps, control)', () => {
    for (const tier of tiers) {
      const ids = tierWeapons(tier);
      for (const a of ids) for (const b of ids) if (a !== b) expect(dominates(weaponVector(a), weaponVector(b)), `${weaponProfile(a).name} over ${weaponProfile(b).name}`).toBe(false);
    }
  });

  it('nothing beats the sword of its tier on plain dps, and the tiers climb', () => {
    for (const tier of tiers) {
      const sword = weaponProfile(ITEMS[I[`${tier}_SWORD`.toUpperCase()]] && I[`${tier}_SWORD`.toUpperCase()]);
      for (const k of NEW) { const p = weaponProfile(WEAPONS[k][tier]); expect(p.damage * p.blowsPerSec, `${p.name}`).toBeLessThan(sword.damage * sword.blowsPerSec); }
    }
    for (const k of NEW) for (let i = 1; i < tiers.length; i++) expect(dpsAgainst(WEAPONS[k][tiers[i]], 'none')).toBeGreaterThan(dpsAgainst(WEAPONS[k][tiers[i - 1]], 'none'));
  });

  it('each weapon\'s trick is worth something but bounded: a backstab never one-shots a full-health 20 hp mob with a stone dagger, and the diamond dagger from behind kills in under a second', () => {
    expect(timeToKill(WEAPONS.dagger.stone, TTK_TARGETS.open20, 'backstab')).toBeGreaterThan(0);
    expect(timeToKill(WEAPONS.dagger.diamond, TTK_TARGETS.open20, 'backstab')).toBeLessThan(1);
    expect(weaponProfile(WEAPONS.warhammer.diamond).damage).toBeLessThanOrEqual(12);
    expect(weaponProfile(WEAPONS.glaive.diamond).group).toBeGreaterThan(weaponProfile(WEAPONS.glaive.diamond).damage * weaponProfile(WEAPONS.glaive.diamond).blowsPerSec * 2);
  });

  it('armour set bonuses and trinkets never make the player invulnerable', () => {
    for (const set of Object.keys(SETS)) {
      expect(setBonusProtect(set, 16)).toBeGreaterThanOrEqual(0.2 - 1e-9); // Bulwark IV x4 plus the set: at most 80 % off
    }
    expect(setBonusProtect('diamond', 0)).toBeGreaterThan(0.8);
  });
});

describe('enchantment caps', () => {
  it('a saved or networked enchantment never loads above the enchantment\'s own top level', () => {
    const wild = Object.fromEntries(ENCH_KEYS.map((k) => [k, 10]));
    const clean = cleanEnch(wild);
    for (const k of ENCH_KEYS) expect(clean[k], k).toBe(ENCHANTS[k].max);
    // levels that were legal stay as they are
    expect(cleanEnch({ keen: 3, bulwark: 4, stormcall: 1 })).toEqual({ keen: 3, bulwark: 4, stormcall: 1 });
    expect(cleanEnch({ keen: 0, plunder: -2 })).toBe(null);
  });

  it('the best sword enchantments add a bounded amount of damage', () => {
    const sword = { id: I.DIAMOND_SWORD, ench: { keen: 5 } };
    const target = { def: { undead: true } };
    expect(meleeBonus(sword, {})).toBeLessThanOrEqual(3);
    expect(meleeBonus({ id: I.DIAMOND_SWORD, ench: { hallowed: 5 } }, target)).toBeLessThanOrEqual(12.5);
    expect(ITEMS[I.DIAMOND_SWORD].tool.damage + meleeBonus(sword, {})).toBeLessThanOrEqual(10);
  });

  it('exclusive groups stay exclusive and every level window is sane', () => {
    for (const k of ENCH_KEYS) {
      const e = ENCHANTS[k];
      expect(e.max).toBeGreaterThanOrEqual(1);
      expect(e.max).toBeLessThanOrEqual(5);
      for (let l = 1; l <= e.max; l++) expect(e.maxCost(l)).toBeGreaterThanOrEqual(e.min(l));
      expect(e.min(e.max)).toBeLessThanOrEqual(50); // within reach of the 50-level cap of the table
    }
    const diamondSword = availableEnchants(I.DIAMOND_SWORD, 30).map(([k]) => k);
    expect(diamondSword.includes('keen') && diamondSword.includes('hallowed')).toBe(true); // (both offered, the roll picks compatible ones)
  });
});

describe('hunger and food', () => {
  const list = foods();

  it('saturation never beats the reference ratio (2.4 x hunger) and hunger never fills a bar', () => {
    for (const f of list) {
      expect(f.saturation, f.name).toBeLessThanOrEqual(f.hunger * 2.4 + 1e-9);
      expect(f.hunger, f.name).toBeGreaterThanOrEqual(1);
      expect(f.hunger, f.name).toBeLessThanOrEqual(10);
    }
  });

  it('cooked is better than raw, for every smelted food', async () => {
    const { SMELTING } = await import('../src/player/crafting.js');
    for (const [from, to] of Object.entries(SMELTING)) {
      const a = ITEMS[from], b = ITEMS[to];
      if (!a || !b || !a.food || !b.food) continue;
      expect(b.food.hunger, `${b.name} vs ${a.name}`).toBeGreaterThan(a.food.hunger);
      expect(b.food.saturation).toBeGreaterThan(a.food.saturation);
    }
  });

  it('only the golden foods fill without hunger and nothing raw is above 4 hunger', () => {
    for (const f of list) if (f.always) expect(['gilded_apple', 'hushfruit'], f.name).toContain(f.key);
    for (const f of list) if (f.key.startsWith('raw_')) expect(f.hunger, f.name).toBeLessThanOrEqual(4);
  });
});

describe('experience', () => {
  it('follows the reference curve and keeps growing', () => {
    expect(xpTotal(15)).toBe(315);
    expect(xpTotal(30)).toBe(1395);
    expect(xpTotal(50)).toBe(5345);
    let prev = 0;
    for (let l = 0; l < 80; l++) { const n = xpToNextLevel(l); expect(n).toBeGreaterThan(prev); prev = n; }
  });

  it('the enchanting table never asks for more than 30 levels and the anvil stops at 40', async () => {
    const { offerCost, ANVIL_MAX_COST, MAX_SHELVES } = await import('../src/world/enchantments.js');
    const r = rng(3);
    for (let k = 0; k < 3000; k++) for (const slot of [0, 1, 2]) expect(offerCost(r, slot, MAX_SHELVES + 20)).toBeLessThanOrEqual(30);
    expect(ANVIL_MAX_COST).toBe(40);
  });
});

describe('seasons and crops', () => {
  it('growth stays between a third and 1.5x, and a year of it averages close to the original rules', () => {
    for (const k of SEASON_KEYS) { expect(SEASON_DATA[k].growth).toBeGreaterThanOrEqual(0.3); expect(SEASON_DATA[k].growth).toBeLessThanOrEqual(1.5); }
    const y = yearlyGrowth();
    expect(y.mean).toBeGreaterThan(0.8);
    expect(y.mean).toBeLessThan(1.1);
    expect(y.min).toBeGreaterThanOrEqual(0.3);
    expect(y.max).toBeLessThanOrEqual(1.5);
  });

  it('no season makes a crop grow in a single tick, and winter slows but never stops it', () => {
    const c = seasonalChances(9);
    for (const k of SEASON_KEYS) { expect(c[k]).toBeLessThan(0.6); expect(c[k]).toBeGreaterThan(0.05); }
    expect(c.spring).toBeGreaterThan(c.summer);
    expect(c.summer).toBeGreaterThan(c.autumn);
    expect(c.autumn).toBeGreaterThan(c.winter);
    try { applyValues(seasonValues(seasonState(0)), climate); expect(seasonalChance(5)).toBe(1); } finally { resetClimate(climate); }
  });

  it('the blended growth has no jumps between neighbouring moments', () => {
    let last = null;
    for (let t = 0; t < 8 * 4 * DAY_TICKS; t += DAY_TICKS / 8) {
      const g = seasonValues(seasonState(t)).growth;
      if (last !== null) expect(Math.abs(g - last)).toBeLessThan(0.08);
      last = g;
    }
  });

  it('repFactor is the only rule that moves prices with a name (sanity)', () => {
    expect(repFactor(100)).toBeCloseTo(0.7);
    expect(repFactor(-100)).toBeCloseTo(1.6);
  });
});
