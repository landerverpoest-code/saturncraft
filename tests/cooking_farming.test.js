// Cooking and farming depth: the Cooking Pot, food variety, greenhouses, soil fertility, the new crops and their trades.
import { describe, it, expect } from 'vitest';
import { B, BLOCKS, CROPS, STEM_FRUIT, SHAPE } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import { texId, TEX_NAMES } from '../src/world/textures.js';
import { blockDrops } from '../src/world/mining.js';
import { randomTickBlock, seasonalCropChance, cropGrowthChance } from '../src/world/randomTicks.js';
import { SEASON_DATA, SEASON_KEYS, climate, applyValues, resetClimate } from '../src/world/seasons.js';
import {
  growthFactorFor, inGreenhouse, cropGrowthMultiplier, bestSeasons, seasonTable, CROP_TRAITS, SOIL_CODE, YIELD_FACTOR,
  metaAfterHarvest, tirednessFor, lastCropOf, applyYield, harvestOnSoil, boneMealSoil, hasMemory, restedMeta, GREENHOUSE_LIGHT,
} from '../src/world/farming.js';
import {
  KINDS, KIND_BIT, RECIPES, canAdd, recipeFor, startBrew, potTick, takeServing, hasHeat, readyMeta, isReady, KIND_NAMES, servingsOf, stageOf, dishOf, BREW_STAGES, kindsIn,
} from '../src/world/cookingPot.js';
import { KIND_ITEMS, kindOfItem, bitOfItem, DISHES } from '../src/world/cooking.js';
import { varietyBonus, recordMeal, VARIETY_MAX, VARIETY_WINDOW, countsForVariety } from '../src/player/variety.js';
import { EFFECTS } from '../src/player/effects.js';
import { craft, SMELTING, RECIPES as CRAFT_RECIPES } from '../src/player/crafting.js';
import { offerPool } from '../src/mobs/trades.js';
import { aimTip } from '../src/world/aimTips.js';
import { buildTopics } from '../src/ui/helpTopics.js';
import { resolveBindings } from '../src/ui/bindings.js';
import { entriesOf, resetGuideEntries } from '../src/player/fieldGuideEntries.js';
import { MockWorld, rng } from './helpers.js';

class W extends MockWorld {
  constructor() { super(60); this.light = 0xf0; this.ticks = []; }
  getLight() { return this.light; }
  setBlock(x, y, z, id, meta = 0) { this.set(x, y, z, id, meta); return true; }
  scheduleTick(x, y, z, d) { this.ticks.push([x, y, z, d]); }
}
const withClimate = (season, fn) => { try { applyValues({ ...SEASON_DATA[season] }, climate); return fn(); } finally { resetClimate(climate); } };

describe('new ids', () => {
  it('are appended after the existing extended blocks and items, with textures', () => {
    expect(B.COOKING_POT).toBeGreaterThan(B.WYRMBONE);
    expect(B.SUNGOURD).toBe(B.COOKING_POT + 5);
    expect(BLOCKS[B.COOKING_POT_BREW].hidden).toBe(true);
    expect(BLOCKS[B.COOKING_POT_BREW].drops).toBe(B.COOKING_POT);
    expect(I.FROSTROOT).toBeGreaterThan(I.SURVEYOR_WAND);
    for (const b of [B.COOKING_POT, B.FROSTROOTS, B.DEWBERRY_BRAMBLE, B.SUNGOURD_STEM, B.SUNGOURD]) for (const k of ['top', 'bottom', 'side']) expect(texId(BLOCKS[b].tex[k]), BLOCKS[b].name).toBeGreaterThanOrEqual(0);
    for (const n of ['cooking_pot_stock', 'cooking_pot_stew', 'farmland_tired', 'farmland_tired_moist']) expect(TEX_NAMES.includes(n), n).toBe(true);
    for (let i = 0; i < 4; i++) for (const n of ['frostroots_', 'dewberry_bramble_']) expect(TEX_NAMES.includes(n + i), n + i).toBe(true);
  });
  it('register the crops', () => {
    expect(CROPS.has(B.FROSTROOTS) && CROPS.has(B.SUNGOURD_STEM)).toBe(true);
    expect(STEM_FRUIT[B.SUNGOURD_STEM]).toBe(B.SUNGOURD);
    expect(ITEMS[I.FROSTROOT].places).toBe(B.FROSTROOTS);
    expect(ITEMS[I.DEWBERRIES].places).toBe(B.DEWBERRY_BRAMBLE);
    expect(ITEMS[I.SUNGOURD_SEEDS].places).toBe(B.SUNGOURD_STEM);
    expect(BLOCKS[B.COOKING_POT].shape).toBe(SHAPE.BOXES);
  });
});

describe('Cooking Pot', () => {
  it('ingredient kinds cover the named foods and nothing is in two kinds', () => {
    expect(kindOfItem(I.RAW_VENISON)).toBe('meat');
    expect(kindOfItem(I.RAW_SILVERFIN)).toBe('fish');
    expect(kindOfItem(B.BROWN_MUSHROOM)).toBe('mushroom');
    expect(kindOfItem(I.SWEET_BERRIES)).toBe('berry');
    expect(kindOfItem(I.BEETROOT)).toBe('beet');
    expect(kindOfItem(I.POTATO)).toBe('root');
    expect(kindOfItem(I.FROSTROOT)).toBe('root');
    expect(kindOfItem(I.COOKED_VENISON)).toBe(null); // the pot cooks raw food
    const seen = new Set();
    for (const k of KINDS) for (const id of KIND_ITEMS[k]) { expect(id, k).not.toBeUndefined(); expect(seen.has(id)).toBe(false); seen.add(id); }
    expect(bitOfItem(I.WHEAT)).toBe(KIND_BIT.grain);
  });

  it('recipes are distinct sets of kinds and every dish is a food with a valid buff', () => {
    const masks = RECIPES.map((r) => r.mask);
    expect(new Set(masks).size).toBe(masks.length);
    expect(RECIPES.length).toBeLessThanOrEqual(16); // the dish index is 4 bits of the brew's meta
    for (const d of DISHES) {
      const it = ITEMS[d.id];
      expect(it, d.key).toBeTruthy();
      expect(it.food.saturation, d.name).toBeLessThanOrEqual(it.food.hunger * 2.4);
      expect(it.food.hunger).toBeLessThanOrEqual(10);
      expect(d.servings).toBeGreaterThanOrEqual(2);
      expect(d.servings).toBeLessThanOrEqual(3);
      expect(it.stack).toBe(d.bowl ? 1 : 64);
      expect(!!it.food.leaves).toBe(d.bowl);
      for (const [type, ticks, amp] of it.food.effects) { expect(EFFECTS[type], `${d.name}: ${type}`).toBeTruthy(); expect(ticks).toBeLessThanOrEqual(2400); expect(amp).toBe(0); }
    }
    // the named buffs exist among the dishes
    const buffs = new Set(DISHES.flatMap((d) => ITEMS[d.id].food.effects.map((e) => e[0])));
    for (const t of ['regeneration', 'fire_resistance', 'night_vision']) expect(buffs.has(t), t).toBe(true);
    // every recipe uses the foods the brief names somewhere
    const used = new Set(RECIPES.flatMap((r) => r.kinds));
    for (const k of ['meat', 'berry', 'mushroom', 'fish', 'beet', 'root']) expect(used.has(k), k).toBe(true);
  });

  it('only accepts ingredients that can still become a dish, one of each kind', () => {
    let mask = 0;
    expect(canAdd(mask, KIND_BIT.meat)).toBe(true);
    mask |= KIND_BIT.meat;
    expect(canAdd(mask, KIND_BIT.meat)).toBe(false); // already in
    expect(canAdd(mask, KIND_BIT.grain)).toBe(false); // meat + wheat is no dish
    expect(canAdd(mask, 0)).toBe(false);
    expect(canAdd(mask, KIND_BIT.root)).toBe(true);
    mask |= KIND_BIT.root;
    expect(DISHES[recipeFor(mask)].key).toBe('hunters_stew');
    expect(canAdd(mask, KIND_BIT.mushroom)).toBe(true); // -> hearty hotpot
    expect(recipeFor(KIND_BIT.meat)).toBe(-1);
    expect(kindsIn(mask)).toEqual(['meat', 'root']);
  });

  it('needs a heat source below to cook, then simmers four stages and serves a set number of servings', () => {
    const w = new W();
    w.set(0, 63, 0, B.STONE);
    w.set(0, 64, 0, B.COOKING_POT, KIND_BIT.meat | KIND_BIT.root);
    expect(hasHeat(w, 0, 64, 0)).toBe(false);
    expect(startBrew(w, 0, 64, 0)).toBe('noheat');
    w.set(0, 63, 0, B.CAMPFIRE);
    expect(hasHeat(w, 0, 64, 0)).toBe(true);
    w.set(1, 64, 0, B.COOKING_POT, KIND_BIT.meat);
    w.set(1, 63, 0, B.CAMPFIRE);
    expect(startBrew(w, 1, 64, 0)).toBe('nomatch');
    w.set(2, 64, 0, B.COOKING_POT, 0);
    w.set(2, 63, 0, B.CAMPFIRE);
    expect(startBrew(w, 2, 64, 0)).toBe('empty');
    expect(startBrew(w, 0, 64, 0)).toBe('started');
    expect(w.getBlock(0, 64, 0)).toBe(B.COOKING_POT_BREW);
    expect(w.ticks.at(-1)[3]).toBeGreaterThan(0);
    for (let s = 1; s < BREW_STAGES; s++) { potTick(w, 0, 64, 0); expect(stageOf(w.getMeta(0, 64, 0))).toBe(s); expect(isReady(w.getMeta(0, 64, 0))).toBe(false); }
    // the fire goes out: it waits
    w.set(0, 63, 0, B.STONE);
    potTick(w, 0, 64, 0);
    expect(isReady(w.getMeta(0, 64, 0))).toBe(false);
    w.set(0, 63, 0, B.FURNACE_LIT);
    potTick(w, 0, 64, 0);
    const m = w.getMeta(0, 64, 0);
    expect(isReady(m)).toBe(true);
    expect(dishOf(m)).toBe(0);
    expect(servingsOf(m)).toBe(RECIPES[0].servings);
    const got = [];
    for (let k = 0; k < RECIPES[0].servings; k++) got.push(takeServing(w, 0, 64, 0));
    expect(got.every((d) => d === 0)).toBe(true);
    expect(w.getBlock(0, 64, 0)).toBe(B.COOKING_POT); // empty again
    expect(w.getMeta(0, 64, 0)).toBe(0);
    expect(takeServing(w, 0, 64, 0)).toBe(-1);
  });

  it('every kind of heat counts, and the brew block packs its dish and servings into the meta', () => {
    const w = new W();
    for (const heat of [B.CAMPFIRE, B.FIRE, B.LAVA, B.FURNACE_LIT, B.SMOKER_LIT, B.BLAST_FURNACE_LIT]) { w.set(0, 63, 0, heat); expect(hasHeat(w, 0, 64, 0), BLOCKS[heat].name).toBe(true); }
    for (const heat of [B.STONE, B.FURNACE, B.TORCH, B.AIR]) { w.set(0, 63, 0, heat); expect(hasHeat(w, 0, 64, 0)).toBe(false); }
    for (let dish = 0; dish < RECIPES.length; dish++) for (let s = 1; s <= 3; s++) { const m = readyMeta(dish, s); expect(m).toBeLessThan(256); expect(dishOf(m)).toBe(dish); expect(servingsOf(m)).toBe(s); }
  });

  it('a simmering pot re-arms its scheduled tick from a random tick (ticks are not saved)', () => {
    const w = new W();
    w.set(0, 64, 0, B.COOKING_POT_BREW, 0);
    randomTickBlock(w, 0, 64, 0, B.COOKING_POT_BREW);
    expect(w.ticks.length).toBe(1);
  });

  it('can be crafted from iron and a bowl, and the dishes are only made in the pot', () => {
    const I_ = I.IRON_INGOT, g = [I_, 0, I_, I_, I.BOWL, I_, I_, I_, I_].map((id) => (id ? { id, count: 1 } : null));
    expect(craft(g, 3)).toEqual({ id: B.COOKING_POT, count: 1 });
    for (const d of DISHES) expect(CRAFT_RECIPES.some((r) => r.result === d.id), d.name).toBe(false);
  });
});

describe('food variety', () => {
  it('gives nothing on the first meal or a repeat, and grows with different foods up to a small cap', () => {
    expect(varietyBonus([], 1)).toBe(0);
    expect(varietyBonus([1], 1)).toBe(0);
    expect(varietyBonus([1], 2)).toBe(0.5);
    expect(varietyBonus([1, 2], 3)).toBe(1);
    expect(varietyBonus([1, 2, 3], 4)).toBe(1.5);
    expect(varietyBonus([1, 2, 3, 4], 5)).toBeLessThanOrEqual(VARIETY_MAX);
    expect(varietyBonus([1, 2, 3], 3)).toBe(0); // the same twice in a row
    expect(varietyBonus([2, 1, 2], 1)).toBe(0.5); // a repeat inside the window ends the streak
    expect(VARIETY_MAX).toBeLessThanOrEqual(2);
  });
  it('remembers only the last few meals, and ignores foods with a drawback', () => {
    let r = [];
    for (let i = 1; i <= 9; i++) r = recordMeal(r, i);
    expect(r.length).toBe(VARIETY_WINDOW);
    expect(r.at(-1)).toBe(9);
    expect(countsForVariety(ITEMS[I.BREAD].food)).toBe(true);
    expect(countsForVariety(ITEMS[I.ROTTEN_FLESH].food)).toBe(false);
    expect(countsForVariety(ITEMS[I.SPIDER_EYE].food)).toBe(false);
  });
  it('never lifts saturation past what one meal could (bonus stays far below a single food\'s own saturation)', () => {
    for (const d of DISHES) expect(VARIETY_MAX).toBeLessThan(ITEMS[d.id].food.saturation);
  });
});

describe('seasonal preferences and greenhouses', () => {
  it('Frostroots shrug off winter, Sungourds love summer, and plain crops follow the season', () => {
    const f = (id, s) => growthFactorFor(id, SEASON_DATA[s]);
    expect(f(B.FROSTROOTS, 'winter')).toBeGreaterThan(f(B.WHEAT, 'winter') * 2);
    expect(f(B.FROSTROOTS, 'winter')).toBeGreaterThanOrEqual(f(B.FROSTROOTS, 'summer'));
    expect(bestSeasons(B.FROSTROOTS)).toMatch(/Winter/);
    expect(f(B.SUNGOURD_STEM, 'summer')).toBeGreaterThan(f(B.SUNGOURD_STEM, 'spring'));
    expect(f(B.SUNGOURD_STEM, 'winter')).toBeLessThan(0.25);
    expect(bestSeasons(B.SUNGOURD_STEM)).toBe('Summer');
    expect(bestSeasons(B.DEWBERRY_BRAMBLE)).toMatch(/Spring|Autumn/);
    for (const k of SEASON_KEYS) expect(f(B.WHEAT, k)).toBe(SEASON_DATA[k].growth);
    for (const id of Object.keys(CROP_TRAITS)) for (const s of seasonTable(+id)) { expect(s.factor).toBeGreaterThanOrEqual(0.15); expect(s.factor).toBeLessThanOrEqual(1.6); }
  });
  it('with seasons off every crop grows at the original rate', () => {
    expect(climate.on).toBe(false);
    for (const id of [B.WHEAT, B.FROSTROOTS, B.SUNGOURD_STEM, B.DEWBERRY_BRAMBLE]) expect(growthFactorFor(id)).toBe(1);
  });
  it('a crop\'s chance per tick uses its own factor', () => {
    const w = new W();
    const p = cropGrowthChance(5);
    withClimate('winter', () => {
      expect(seasonalCropChance(w, 5, B.WHEAT, 0, 64, 0)).toBeCloseTo(p * 0.35);
      expect(seasonalCropChance(w, 5, B.FROSTROOTS, 0, 64, 0)).toBeGreaterThan(p * 0.8);
      expect(seasonalCropChance(w, 5)).toBeCloseTo(p * 0.35); // (the old two-argument call still works)
    });
  });

  it('glass over a crop in light >= 12 lifts winter, but only then', () => {
    const w = new W();
    w.set(0, 63, 0, B.FARMLAND, 7); w.set(0, 64, 0, B.WHEAT, 0);
    withClimate('winter', () => {
      expect(inGreenhouse(w, 0, 64, 0)).toBe(false);
      const open = seasonalCropChance(w, 5, B.WHEAT, 0, 64, 0);
      w.set(0, 66, 0, B.GLASS);
      expect(inGreenhouse(w, 0, 64, 0)).toBe(true);
      expect(cropGrowthMultiplier(w, 0, 64, 0, B.WHEAT)).toBe(1);
      expect(seasonalCropChance(w, 5, B.WHEAT, 0, 64, 0)).toBeCloseTo(cropGrowthChance(5));
      expect(seasonalCropChance(w, 5, B.WHEAT, 0, 64, 0)).toBeGreaterThan(open * 2);
      w.light = 0x0b; // dim: below 12
      expect(inGreenhouse(w, 0, 64, 0)).toBe(false);
      w.light = 0x0c; // a torch's worth of 12
      expect(inGreenhouse(w, 0, 64, 0)).toBe(true);
      w.light = 0xf0;
      w.set(0, 66, 0, B.OAK_PLANKS); // a wooden roof is no greenhouse
      expect(inGreenhouse(w, 0, 64, 0)).toBe(false);
      w.set(0, 66, 0, B.SHADED_GLASS); // nor is Shaded Glass
      expect(inGreenhouse(w, 0, 64, 0)).toBe(false);
      w.set(0, 66, 0, B.GLASS_PANE);
      expect(inGreenhouse(w, 0, 64, 0)).toBe(true);
      w.set(0, 66, 0, B.GLASS); w.set(0, 65, 0, B.OAK_PLANKS); // something solid below the glass
      expect(inGreenhouse(w, 0, 64, 0)).toBe(false);
      w.set(0, 65, 0, B.AIR); w.set(0, 66, 0, B.AIR); w.set(0, 71, 0, B.GLASS); // glass too far up
      expect(inGreenhouse(w, 0, 64, 0)).toBe(false);
    });
    expect(GREENHOUSE_LIGHT).toBe(12);
  });

  it('a greenhouse never makes a crop faster than the season already does (spring stays spring)', () => {
    const w = new W();
    w.set(0, 66, 0, B.GLASS);
    withClimate('spring', () => expect(cropGrowthMultiplier(w, 0, 64, 0, B.WHEAT)).toBe(SEASON_DATA.spring.growth));
  });

  it('crops grow under glass in winter in a real random-tick run', () => {
    const run = (roof) => {
      const w = new W();
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.set(dx, 63, dz, B.FARMLAND, 7);
      if (roof) w.set(0, 66, 0, B.GLASS);
      const r = rng(5);
      let ripe = 0;
      withClimate('winter', () => {
        for (let n = 0; n < 60; n++) { w.set(0, 64, 0, B.WHEAT, 0); for (let k = 0; k < 40; k++) randomTickBlock(w, 0, 64, 0, B.WHEAT, r); ripe += w.getMeta(0, 64, 0); }
      });
      return ripe;
    };
    expect(run(true)).toBeGreaterThan(run(false) * 1.5);
  });
});

describe('soil fertility', () => {
  const ripe = (id) => blockDrops(id, undefined, rng(2), 7);
  it('same crop again lowers the yield a little; another crop, rest or Bone Meal restores it', () => {
    let m = 7;
    expect(tirednessFor(m, B.CARROTS)).toBe(0);
    m = metaAfterHarvest(m, B.CARROTS);
    expect(m & 7).toBe(7); // the moisture is untouched
    expect(lastCropOf(m)).toBe(B.CARROTS);
    expect(tirednessFor(m, B.CARROTS)).toBe(1);
    expect(tirednessFor(m, B.POTATOES)).toBe(0); // another crop is fine
    m = metaAfterHarvest(m, B.CARROTS);
    expect(tirednessFor(m, B.CARROTS)).toBe(2);
    m = metaAfterHarvest(m, B.POTATOES); // rotating resets
    expect(tirednessFor(m, B.POTATOES)).toBe(1);
    expect(tirednessFor(m, B.CARROTS)).toBe(0);
    expect(m & 128).toBe(0);
    expect(hasMemory(m)).toBe(true);
    expect(restedMeta(m)).toBe(7);
    expect(hasMemory(restedMeta(m))).toBe(false);
    expect(YIELD_FACTOR[0]).toBe(1);
    expect(YIELD_FACTOR[1]).toBeGreaterThanOrEqual(0.8); // "slightly"
    expect(YIELD_FACTOR[2]).toBeGreaterThanOrEqual(0.65);
    expect(YIELD_FACTOR[2]).toBeLessThan(YIELD_FACTOR[1]);
    for (const id of Object.keys(SOIL_CODE)) expect(CROPS.has(+id)).toBe(true);
  });

  it('the harvest loses a little of the produce on tired soil, never the seeds, and records the crop', () => {
    const isSeed = (id) => /_seeds$/.test(ITEMS[id].key);
    const mean = (soilMeta) => {
      const w = new W();
      w.set(0, 63, 0, B.FARMLAND, soilMeta);
      const r = rng(8);
      let n = 0, seeds = 0;
      for (let k = 0; k < 4000; k++) {
        w.set(0, 63, 0, B.FARMLAND, soilMeta);
        for (const d of harvestOnSoil(w, 0, 64, 0, B.WHEAT, 7, blockDrops(B.WHEAT, undefined, r, 7), r, isSeed)) { if (d.id === I.WHEAT) n += d.count; else seeds += d.count; }
      }
      return [n / 4000, seeds / 4000];
    };
    const [fresh, seedsFresh] = mean(7);
    const [tired, seedsTired] = mean(metaAfterHarvest(7, B.WHEAT));
    const [worn, seedsWorn] = mean(metaAfterHarvest(metaAfterHarvest(7, B.WHEAT), B.WHEAT));
    expect(fresh).toBe(1);
    expect(tired).toBeCloseTo(YIELD_FACTOR[1], 1);
    expect(worn).toBeCloseTo(YIELD_FACTOR[2], 1);
    expect(seedsTired).toBeCloseTo(seedsFresh, 0);
    expect(seedsWorn).toBeCloseTo(seedsFresh, 0);
    // the soil is updated, immature crops change nothing, and so does a crop on plain ground
    const w = new W();
    w.set(0, 63, 0, B.FARMLAND, 5);
    harvestOnSoil(w, 0, 64, 0, B.WHEAT, 3, ripe(B.WHEAT), rng(1), isSeed);
    expect(w.getMeta(0, 63, 0)).toBe(5);
    harvestOnSoil(w, 0, 64, 0, B.WHEAT, 7, ripe(B.WHEAT), rng(1), isSeed);
    expect(lastCropOf(w.getMeta(0, 63, 0))).toBe(B.WHEAT);
    expect(w.getMeta(0, 63, 0) & 7).toBe(5);
    expect(applyYield([{ id: I.WHEAT, count: 3 }], 0)).toEqual([{ id: I.WHEAT, count: 3 }]);
  });

  it('bare farmland that rests forgets by itself; farmland with a crop does not; moisture survives the memory', () => {
    const w = new W();
    w.set(4, 63, -4, B.WATER);
    const mem = metaAfterHarvest(metaAfterHarvest(0, B.WHEAT), B.WHEAT);
    w.set(0, 63, 0, B.FARMLAND, mem | 7);
    w.set(0, 64, 0, B.WHEAT, 1);
    const r = rng(6);
    for (let k = 0; k < 60; k++) randomTickBlock(w, 0, 63, 0, B.FARMLAND, r);
    expect(lastCropOf(w.getMeta(0, 63, 0))).toBe(B.WHEAT); // a crop is growing: the memory stays
    expect(w.getMeta(0, 63, 0) & 7).toBe(7);
    w.set(0, 64, 0, B.AIR);
    for (let k = 0; k < 60; k++) randomTickBlock(w, 0, 63, 0, B.FARMLAND, r);
    expect(w.getBlock(0, 63, 0)).toBe(B.FARMLAND);
    expect(w.getMeta(0, 63, 0)).toBe(7); // rested, still moist
    // dry farmland keeps its memory while it dries one step at a time
    const w2 = new W();
    w2.set(0, 63, 0, B.FARMLAND, metaAfterHarvest(0, B.CARROTS) | 3);
    w2.set(0, 64, 0, B.CARROTS, 2);
    randomTickBlock(w2, 0, 63, 0, B.FARMLAND, () => 0.99);
    expect(w2.getMeta(0, 63, 0) & 7).toBe(2);
    expect(lastCropOf(w2.getMeta(0, 63, 0))).toBe(B.CARROTS);
  });

  it('Bone Meal on bare remembering farmland restores it, and does nothing on fresh soil or under a crop', () => {
    const w = new W();
    w.set(0, 63, 0, B.FARMLAND, metaAfterHarvest(7, B.BEETROOTS));
    w.set(0, 64, 0, B.BEETROOTS, 0);
    expect(boneMealSoil(w, 0, 63, 0)).toBe(false); // a crop is growing
    w.set(0, 64, 0, B.AIR);
    expect(boneMealSoil(w, 0, 63, 0)).toBe(true);
    expect(w.getMeta(0, 63, 0)).toBe(7);
    expect(boneMealSoil(w, 0, 63, 0)).toBe(false);
  });

  it('the old farmland rules still hold with the memory bits in the meta (growth speed counts moisture only)', async () => {
    const { growthSpeed } = await import('../src/world/randomTicks.js');
    const w = new W();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.set(dx, 63, dz, B.FARMLAND, metaAfterHarvest(0, B.WHEAT));
    w.set(0, 64, 0, B.WHEAT);
    expect(growthSpeed(w, 0, 64, 0)).toBe(4); // dry soil, even though its meta is not 0
  });
});

describe('the new crops', () => {
  it('Frostroots drop like carrots and roast better than raw', () => {
    const r = rng(3);
    expect(blockDrops(B.FROSTROOTS, undefined, r, 4)).toEqual([{ id: I.FROSTROOT, count: 1 }]);
    let min = 9, max = 0;
    for (let k = 0; k < 2000; k++) { const n = blockDrops(B.FROSTROOTS, undefined, r, 7)[0].count; min = Math.min(min, n); max = Math.max(max, n); }
    expect([min, max]).toEqual([2, 5]);
    expect(SMELTING[I.FROSTROOT]).toBe(I.ROASTED_FROSTROOT);
    expect(ITEMS[I.ROASTED_FROSTROOT].food.hunger).toBeGreaterThan(ITEMS[I.FROSTROOT].food.hunger);
    expect(ITEMS[I.ROASTED_FROSTROOT].food.saturation).toBeGreaterThan(ITEMS[I.FROSTROOT].food.saturation);
  });

  it('the Sungourd stem grows, sets a gourd on free soil, and the gourd drops wedges; wedges give seeds back', () => {
    const w = new W();
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) w.set(dx, 63, dz, B.FARMLAND, 7);
    w.set(0, 64, 0, B.SUNGOURD_STEM, 7);
    const r = rng(3);
    withClimate('summer', () => { for (let k = 0; k < 600; k++) randomTickBlock(w, 0, 64, 0, B.SUNGOURD_STEM, r); });
    const fruits = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => w.getBlock(dx, 64, dz) === B.SUNGOURD);
    expect(fruits.length).toBe(1);
    for (let k = 0; k < 200; k++) { const d = blockDrops(B.SUNGOURD, undefined, r, 0)[0]; expect(d.id).toBe(I.GOURD_WEDGE); expect(d.count).toBeGreaterThanOrEqual(3); expect(d.count).toBeLessThanOrEqual(6); }
    expect(blockDrops(B.SUNGOURD_STEM, undefined, r, 2)).toEqual([{ id: I.SUNGOURD_SEEDS, count: 1 }]);
    expect(craft([{ id: I.GOURD_WEDGE, count: 1 }], 2)).toEqual({ id: I.SUNGOURD_SEEDS, count: 1 });
  });

  it('a Sungourd stem grows faster in summer than in winter', () => {
    const grow = (season) => {
      const w = new W();
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.set(dx, 63, dz, B.FARMLAND, 7);
      const r = rng(11);
      let total = 0;
      withClimate(season, () => { for (let n = 0; n < 80; n++) { w.set(0, 64, 0, B.SUNGOURD_STEM, 0); for (let k = 0; k < 30; k++) randomTickBlock(w, 0, 64, 0, B.SUNGOURD_STEM, r); total += w.getMeta(0, 64, 0); } });
      return total;
    };
    expect(grow('summer')).toBeGreaterThan(grow('winter') * 3);
  });

  it('the Dewberry Bramble ripens in dim light, stops at 3, and drops a berry when broken', () => {
    const w = new W();
    w.set(0, 63, 0, B.DIRT);
    w.set(0, 64, 0, B.DEWBERRY_BRAMBLE, 0);
    const r = rng(2);
    w.light = 0x50; // below 6
    for (let k = 0; k < 300; k++) randomTickBlock(w, 0, 64, 0, B.DEWBERRY_BRAMBLE, r);
    expect(w.getMeta(0, 64, 0)).toBe(0);
    w.light = 0x60; // 6 is enough (the sweet berry bush needs 9)
    for (let k = 0; k < 300; k++) randomTickBlock(w, 0, 64, 0, B.DEWBERRY_BRAMBLE, r);
    expect(w.getMeta(0, 64, 0)).toBe(3);
    expect(blockDrops(B.DEWBERRY_BRAMBLE, undefined, r, 3)).toEqual([{ id: I.DEWBERRIES, count: 1 }]);
    expect(CROPS.has(B.DEWBERRY_BRAMBLE)).toBe(false); // it grows on soil, not on farmland
  });
});

describe('trades and hover tips', () => {
  it('farmers buy and sell the new crops, selling fewer per beryl than they buy', () => {
    const pool = offerPool('farmer');
    const buys = pool.filter((o) => o[0] === 'buy'), sells = pool.filter((o) => o[0] === 'sell');
    for (const [item, dear] of [[I.FROSTROOT, 4], [I.DEWBERRIES, 5]]) {
      const b = buys.find((o) => o[1] === item), s = sells.find((o) => o[3] === item);
      expect(b, ITEMS[item].name).toBeTruthy(); expect(s).toBeTruthy();
      expect(s[4]).toBe(dear);
      expect(s[4]).toBeLessThan(b[2]); // 4 roots out for a beryl, 24 in
    }
    expect(sells.some((o) => o[3] === I.SUNGOURD_SEEDS)).toBe(true);
    expect(buys.some((o) => o[1] === B.SUNGOURD)).toBe(true);
    expect(sells.some((o) => DISHES.some((d) => d.id === o[3]))).toBe(true);
  });

  it('tips read the soil, crop, season and pot', () => {
    const w = new W();
    w.set(0, 63, 0, B.FARMLAND, 7);
    expect(aimTip(w, { x: 0, y: 63, z: 0, id: B.FARMLAND })).toMatch(/moist.*Fresh soil/);
    w.set(0, 63, 0, B.FARMLAND, metaAfterHarvest(7, B.CARROTS));
    expect(aimTip(w, { x: 0, y: 63, z: 0, id: B.FARMLAND })).toMatch(/Last grew Carrots.*85%/);
    w.set(0, 64, 0, B.CARROTS, 7);
    expect(aimTip(w, { x: 0, y: 64, z: 0, id: B.CARROTS })).toMatch(/ripe.*tired soil: harvest 85%/);
    w.set(0, 64, 1, B.FROSTROOTS, 2);
    withClimate('winter', () => {
      expect(aimTip(w, { x: 0, y: 64, z: 1, id: B.FROSTROOTS })).toMatch(/Frostroots, growing \(3\/8\), .*% growth now, best in Winter/);
    });
    w.set(3, 64, 0, B.COOKING_POT, 0);
    expect(aimTip(w, { x: 3, y: 64, z: 0, id: B.COOKING_POT })).toMatch(/empty/);
    w.set(3, 64, 0, B.COOKING_POT, KIND_BIT.meat | KIND_BIT.root);
    expect(aimTip(w, { x: 3, y: 64, z: 0, id: B.COOKING_POT })).toMatch(/Meat, Roots \(ready to cook, needs a fire below\)/);
    w.set(3, 63, 0, B.CAMPFIRE);
    expect(aimTip(w, { x: 3, y: 64, z: 0, id: B.COOKING_POT })).toMatch(/ready to cook\)/);
    w.set(3, 64, 0, B.COOKING_POT_BREW, readyMeta(0, 2));
    expect(aimTip(w, { x: 3, y: 64, z: 0, id: B.COOKING_POT_BREW })).toMatch(/Hunter's Stew ready, 2 left \(use a Bowl\)/);
    expect(aimTip(w, { x: 9, y: 64, z: 9, id: B.STONE })).toBe(null);
    expect(aimTip(w, null)).toBe(null);
  });
});

describe('Help and the Field Guide stay in step by themselves', () => {
  it('Help has farming and cooking topics generated from the data', () => {
    const topics = buildTopics({ table: resolveBindings({}) });
    const farming = topics.find((t) => t.id === 'farming'), cooking = topics.find((t) => t.id === 'cooking');
    expect(farming && cooking).toBeTruthy();
    for (const id of Object.keys(CROP_TRAITS)) expect(farming.text).toContain(BLOCKS[id].name.toLowerCase());
    expect(farming.text).toContain('greenhouse');
    expect(farming.text).toContain('bone meal');
    for (const d of DISHES) expect(cooking.text, d.name).toContain(d.name.toLowerCase());
    for (const k of KINDS) expect(cooking.text).toContain(KIND_NAMES[k].toLowerCase());
  });
  it('the Field Guide lists every dish and the new crop items', () => {
    resetGuideEntries();
    const names = entriesOf('items').map((e) => e.name);
    for (const d of DISHES) expect(names).toContain(d.name);
    for (const id of [I.FROSTROOT, I.DEWBERRIES, I.SUNGOURD_SEEDS, I.GOURD_WEDGE]) expect(names).toContain(ITEMS[id].name);
  });
});
