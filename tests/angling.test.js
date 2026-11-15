import { describe, it, expect } from 'vitest';
import { rollCatch, biteWait } from '../src/entities/bobber.js';
import { I, ITEMS } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';
import { SMELTING } from '../src/player/crafting.js';
import { withExtras, canStack } from '../src/world/enchantments.js';
import { cleanTrophy, trophyLine } from '../src/world/trophyFish.js';
import { packEntity, unpackEntity, sameStack, copyStack } from '../src/net/protocol.js';
import { anglingFish, isIceHole, rollWeight, rollTrophyWeight, isTrophyCast, trophyEscapes, recordFish, cleanFishLog, fishLogRows, speciesOf, TROPHY_ODDS } from '../src/world/angling.js';
import { newStats, loadStats, saveStats } from '../src/player/stats.js';
import { MockWorld, rng } from './helpers.js';

const frac = (n, f) => { let c = 0; for (let k = 0; k < n; k++) if (f()) c++; return c / n; };

describe('angling: biome loot', () => {
  it('each biome family has its own fish, and the plain biomes none', () => {
    const r = rng(1);
    const share = (b, key, ctx) => frac(8000, () => anglingFish(b, ctx || {}, r) === key);
    expect(share('swamp', 'RAW_MUDCARP')).toBeGreaterThan(0.2);
    expect(share('river', 'RAW_MUDCARP')).toBeGreaterThan(0.2);
    expect(share('frozen_ocean', 'RAW_FROSTPERCH')).toBeGreaterThan(0.2);
    expect(share('ocean', 'RAW_SUNSCALE')).toBeGreaterThan(0.2);
    expect(share('plains', 'RAW_MUDCARP') + share('plains', 'RAW_SUNSCALE') + share('plains', 'RAW_FROSTPERCH')).toBe(0);
    expect(share('ocean', 'RAW_FROSTPERCH')).toBe(0);
  });
  it('Glimmereels only bite in the dark; ice holes bring Frostperch anywhere', () => {
    const r = rng(2);
    for (const b of ['ocean', 'swamp', 'plains', 'frozen_river']) expect(frac(4000, () => anglingFish(b, { dark: false }, r) === 'RAW_GLIMMEREEL')).toBe(0);
    expect(frac(4000, () => anglingFish('plains', { dark: true }, r) === 'RAW_GLIMMEREEL')).toBeGreaterThan(0.25);
    expect(frac(4000, () => anglingFish('plains', { ice: true }, r) === 'RAW_FROSTPERCH')).toBeGreaterThan(0.5);
  });
  it('rollCatch hands out the new fish through the ordinary table', () => {
    const r = rng(3);
    expect(frac(20000, () => rollCatch(r, 0, 'swamp').id === I.RAW_MUDCARP)).toBeGreaterThan(0.05);
    expect(frac(20000, () => rollCatch(r, 0, 'ocean').id === I.RAW_SUNSCALE)).toBeGreaterThan(0.15);
    expect(frac(20000, () => rollCatch(r, 0, 'ocean', 0, { dark: true }).id === I.RAW_GLIMMEREEL)).toBeGreaterThan(0.15);
    expect(frac(20000, () => rollCatch(r, 0, 'ocean').id === I.RAW_GLIMMEREEL)).toBe(0);
  });
  it('every new fish cooks and feeds', () => {
    for (const k of ['MUDCARP', 'FROSTPERCH', 'GLIMMEREEL', 'SUNSCALE']) {
      expect(SMELTING[I['RAW_' + k]]).toBe(I['COOKED_' + k]);
      expect(ITEMS[I['COOKED_' + k]].food.hunger).toBeGreaterThan(ITEMS[I['RAW_' + k]].food.hunger);
    }
  });
  it('Lure shortens the wait', () => {
    expect(biteWait(() => 0.5, false, 2)).toBeLessThan(biteWait(() => 0.5, false, 0));
  });
});

describe('angling: ice fishing', () => {
  it('a hole is water with ice beside its surface', () => {
    const w = new MockWorld(60);
    for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) { w.set(x, 62, z, B.WATER); w.set(x, 63, z, B.ICE); }
    const get = (x, y, z) => w.getBlock(x, y, z);
    expect(isIceHole(get, 2, 62, 2)).toBe(false); // sealed under the ice
    w.set(2, 63, 2, B.WATER); // breaking an ice block over water leaves water
    expect(isIceHole(get, 2, 63, 2)).toBe(true);
    expect(isIceHole(get, 2, 60, 2)).toBe(false); // (stone: not water)
  });
  it('open water with no ice is no hole', () => {
    const w = new MockWorld(60);
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) w.set(x, 63, z, B.WATER);
    expect(isIceHole((x, y, z) => w.getBlock(x, y, z), 1, 63, 1)).toBe(false);
  });
});

describe('angling: Fishing Log and weights', () => {
  it('weights are 0.3 to 6.0 kg and deterministic from the rng', () => {
    const a = rng(7), b = rng(7);
    for (let k = 0; k < 500; k++) { const w = rollWeight(a); expect(w).toBeGreaterThanOrEqual(0.3); expect(w).toBeLessThanOrEqual(6.0); expect(rollWeight(b)).toBe(w); }
    for (let k = 0; k < 100; k++) { const w = rollTrophyWeight(a); expect(w).toBeGreaterThanOrEqual(3); expect(w).toBeLessThanOrEqual(6); }
  });
  it('keeps the best weight and counts the catches', () => {
    const log = {};
    expect(recordFish(log, 'RAW_REDFIN', 1.2)).toEqual({ isNew: true, isRecord: true });
    expect(recordFish(log, 'RAW_REDFIN', 0.8)).toEqual({ isNew: false, isRecord: false });
    expect(recordFish(log, 'RAW_REDFIN', 2.5).isRecord).toBe(true);
    expect(log.RAW_REDFIN).toEqual({ n: 3, best: 2.5 });
    expect(recordFish(log, 'NOT_A_FISH', 9).isNew).toBe(false);
    expect(speciesOf(I.RAW_SUNSCALE)).toBe('RAW_SUNSCALE');
    expect(fishLogRows(log)[0][1]).toContain('best 2.5 kg');
  });
  it('the log survives the saved statistics and cleans bad data', () => {
    const s = newStats();
    recordFish(s.fishLog, 'RAW_MUDCARP', 4.4);
    const back = loadStats(JSON.parse(JSON.stringify(saveStats(s))));
    expect(back.fishLog).toEqual({ RAW_MUDCARP: { n: 1, best: 4.4 } });
    expect(cleanFishLog({ RAW_MUDCARP: { n: -3, best: 1 }, JUNK: { n: 5, best: 1 }, RAW_REDFIN: { n: 2, best: 'x' } })).toEqual({ RAW_REDFIN: { n: 2, best: 0 } });
    expect(loadStats(null).fishLog).toEqual({});
  });
});

describe('angling: Big Catch', () => {
  it('one cast in forty is a trophy, and one fight in three slips', () => {
    const r = rng(5);
    expect(frac(40000, () => isTrophyCast(r))).toBeCloseTo(1 / TROPHY_ODDS, 2);
    expect(frac(20000, () => trophyEscapes(r))).toBeCloseTo(1 / 3, 1);
  });
  it('the trophy weight rides on the stack through extras, stacking, the network and the save', () => {
    const st = withExtras({ id: I.RAW_REDFIN, count: 1, damage: 0 }, { trophy: 4.27 });
    expect(st.trophy).toBe(4.3);
    expect(canStack(st, { id: I.RAW_REDFIN, count: 1 })).toBe(false);
    expect(canStack(st, copyStack(st))).toBe(true);
    expect(sameStack(st, { ...st, trophy: 5 })).toBe(false);
    expect(copyStack(st).trophy).toBe(4.3);
    expect(JSON.parse(JSON.stringify(st)).trophy).toBe(4.3);
    expect(withExtras({ id: I.RAW_REDFIN, count: 1, damage: 0 }, JSON.parse(JSON.stringify(st))).trophy).toBe(4.3);
    expect(cleanTrophy(-1)).toBe(0);
    expect(cleanTrophy('9')).toBe(0);
    expect(cleanTrophy(500)).toBe(12);
    expect(trophyLine(st)).toBe('Trophy, 4.3 kg');
    expect(trophyLine({})).toBe('');
  });
  it('a dropped trophy fish keeps its weight over the wire', () => {
    const e = { kind: 'item', id: 5, x: 1, y: 2, z: 3, stack: { id: I.RAW_REDFIN, count: 1, damage: 0, trophy: 3.9 }, pickupDelay: 0 };
    const wire = packEntity(e);
    expect(wire[17]).toBe(3.9);
    expect(unpackEntity(JSON.parse(JSON.stringify(wire))).stack.trophy).toBe(3.9);
  });
});
