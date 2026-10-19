import { describe, it, expect } from 'vitest';
import {
  SPAWN_TABLES, spawnTable, weightedPick, pickProbabilities, scaledCap, isDarkEnoughToSpawn, darkSpawnProbability,
  isBrightEnoughForAnimal, shouldDespawn, shouldBurnInSun, MOB_CAPS, SPAWN_MIN_DIST, DESPAWN_FAR, DESPAWN_NEAR,
} from '../src/mobs/spawnRules.js';
import { BIOME } from '../src/world/biomes.js';
import { skyState, findNextPhase } from '../src/sky/suns.js';
import { rng } from './helpers.js';

describe('spawn tables', () => {
  it('default monster weights match the documented table (slime/witch absent)', () => {
    const p = pickProbabilities(SPAWN_TABLES.monster.default);
    const total = 410;
    expect(p.skitterer).toBeCloseTo(100 / total, 9);
    expect(p.shambler).toBeCloseTo(100 / total, 9);
    expect(p.rattler).toBeCloseTo(100 / total, 9);
    expect(p.fizzler).toBeCloseTo(100 / total, 9);
    expect(p.voidwalker).toBeCloseTo(10 / total, 9);
  });
  it('farm animals use weights 12/10/10/8 in grassy biomes', () => {
    const p = pickProbabilities(spawnTable('creature', BIOME.PLAINS));
    expect(p.fleecer).toBeCloseTo(12 / 40, 9);
    expect(p.bristleback).toBeCloseTo(10 / 40, 9);
    expect(p.cluckling).toBeCloseTo(10 / 40, 9);
    expect(p.mooxen).toBeCloseTo(8 / 40, 9);
    expect(spawnTable('creature', BIOME.DESERT)).toHaveLength(0);
  });
  it('weighted picks converge on the weights', () => {
    const r = rng(42);
    const table = SPAWN_TABLES.monster.default;
    const counts = {};
    const N = 200000;
    for (let i = 0; i < N; i++) { const e = weightedPick(table, r); counts[e.type] = (counts[e.type] || 0) + 1; }
    const p = pickProbabilities(table);
    for (const k of Object.keys(p)) expect(counts[k] / N).toBeCloseTo(p[k], 2);
  });
  it('group sizes: four for most monsters, 1-4 voidwalkers', () => {
    const t = SPAWN_TABLES.monster.default;
    expect(t.find((e) => e.type === 'shambler')).toMatchObject({ min: 4, max: 4 });
    expect(t.find((e) => e.type === 'voidwalker')).toMatchObject({ min: 1, max: 4 });
  });
});

describe('caps and distances', () => {
  it('mob caps are 70 hostile / 10 passive at 289 chunks and scale linearly', () => {
    expect(MOB_CAPS.monster).toBe(70);
    expect(MOB_CAPS.creature).toBe(10);
    expect(scaledCap('monster', 289)).toBe(70);
    expect(scaledCap('monster', 81)).toBe(19);
  });
  it('spawn and despawn radii', () => {
    expect(SPAWN_MIN_DIST).toBe(24);
    expect(DESPAWN_FAR).toBe(128);
    expect(DESPAWN_NEAR).toBe(32);
    expect(shouldDespawn(129, 0, () => 0.99)).toBe(true);
    expect(shouldDespawn(20, 10000, () => 0)).toBe(false);
    expect(shouldDespawn(50, 601, () => 0.0001)).toBe(true);
    expect(shouldDespawn(50, 599, () => 0.0001)).toBe(false);
    expect(shouldDespawn(50, 601, () => 0.5)).toBe(false);
  });
});

describe('light thresholds', () => {
  it('monsters never spawn with block light > 0', () => {
    const r = rng(1);
    for (let i = 0; i < 5000; i++) expect(isDarkEnoughToSpawn(0, 1, 11, r)).toBe(false);
  });
  it('monster spawn probability matches the analytic rule', () => {
    const r = rng(7);
    for (const [sky, darken] of [[0, 0], [15, 11], [15, 0], [10, 11], [6, 0], [4, 0]]) {
      let ok = 0; const N = 100000;
      for (let i = 0; i < N; i++) if (isDarkEnoughToSpawn(sky, 0, darken, r)) ok++;
      expect(ok / N).toBeCloseTo(darkSpawnProbability(sky, 0, darken), 2);
    }
  });
  it('surface spawns need night from all three suns', () => {
    const night = skyState(findNextPhase(0, 'night') + 400);
    expect(darkSpawnProbability(15, 0, night.skyDarken)).toBeGreaterThan(0.2);
    // during the day (any sun high) open-sky spawning is impossible
    for (let t = 0; t < 100000; t += 997) {
      const st = skyState(t);
      if (st.skyDarken <= 7) expect(darkSpawnProbability(15, 0, st.skyDarken)).toBe(0);
    }
    // a dark cave spawns regardless of the suns
    expect(darkSpawnProbability(0, 0, 0)).toBe(1);
  });
  it('animals need light above 8', () => {
    expect(isBrightEnoughForAnimal(9, 0)).toBe(true);
    expect(isBrightEnoughForAnimal(8, 0)).toBe(false);
    expect(isBrightEnoughForAnimal(0, 14)).toBe(true);
  });
  it('undead burn only in combined sunlight under open sky', () => {
    const r = () => 0; // most permissive roll
    expect(shouldBurnInSun({ sunlit: true, effectiveLevel: 15, canSeeSky: true, inWater: false }, r)).toBe(true);
    expect(shouldBurnInSun({ sunlit: false, effectiveLevel: 15, canSeeSky: true, inWater: false }, r)).toBe(false);
    expect(shouldBurnInSun({ sunlit: true, effectiveLevel: 15, canSeeSky: false, inWater: false }, r)).toBe(false);
    expect(shouldBurnInSun({ sunlit: true, effectiveLevel: 15, canSeeSky: true, inWater: true }, r)).toBe(false);
    expect(shouldBurnInSun({ sunlit: true, effectiveLevel: 9, canSeeSky: true, inWater: false }, r)).toBe(false);
    // per-tick chance at full sun = (1 - 0.4) * 2 / 30 = 4%
    const g = rng(3); let n = 0;
    for (let i = 0; i < 100000; i++) if (shouldBurnInSun({ sunlit: true, effectiveLevel: 15, canSeeSky: true, inWater: false }, g)) n++;
    expect(n / 100000).toBeCloseTo(0.04, 2);
  });
});
