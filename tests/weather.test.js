import { describe, it, expect } from 'vitest';
import { Weather, CLEAR_TICKS, RAIN_TICKS } from '../src/sky/weather.js';
import { BIOME } from '../src/world/biomes.js';
import { rng } from './helpers.js';

describe('weather', () => {
  it('alternates clear and rain spells within the reference timer ranges', () => {
    const w = new Weather(rng(5));
    const spells = { clear: [], rain: [] };
    let cur = w.raining, len = w.timer, start = 0;
    expect(len).toBeGreaterThanOrEqual(CLEAR_TICKS[0]);
    for (let t = 1; t < 3_000_000; t++) {
      w.tick();
      if (w.raining !== cur) { spells[cur ? 'rain' : 'clear'].push(t - start); start = t; cur = w.raining; }
    }
    expect(spells.rain.length).toBeGreaterThan(10);
    for (const s of spells.rain) { expect(s).toBeGreaterThanOrEqual(RAIN_TICKS[0]); expect(s).toBeLessThanOrEqual(RAIN_TICKS[1]); }
    for (const s of spells.clear.slice(1)) { expect(s).toBeGreaterThanOrEqual(CLEAR_TICKS[0]); expect(s).toBeLessThanOrEqual(CLEAR_TICKS[1]); }
  });

  it('fades in over 100 ticks', () => {
    const w = new Weather(rng(1));
    w.raining = true; w.timer = 99999;
    for (let k = 0; k < 50; k++) w.tick();
    expect(w.level).toBeCloseTo(0.5);
    for (let k = 0; k < 60; k++) w.tick();
    expect(w.level).toBe(1);
  });

  it('rain, snow or nothing by biome', () => {
    expect(Weather.precipitation(BIOME.PLAINS)).toBe('rain');
    expect(Weather.precipitation(BIOME.SNOWY_PLAINS)).toBe('snow');
    expect(Weather.precipitation(BIOME.DESERT)).toBe(null);
  });

  it('only rains on blocks open to the sky', () => {
    const w = new Weather(); w.level = 1;
    const world = { biomeAt: () => BIOME.FOREST, heightAt: () => 70 };
    expect(w.rainingAt(world, 0, 71, 0)).toBe(true);
    expect(w.rainingAt(world, 0, 65, 0)).toBe(false);
    world.biomeAt = () => BIOME.DESERT;
    expect(w.rainingAt(world, 0, 71, 0)).toBe(false);
  });
});
