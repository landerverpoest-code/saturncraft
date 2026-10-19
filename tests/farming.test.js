import { describe, it, expect } from 'vitest';
import { growthSpeed, cropGrowthChance, farmlandHydrated, randomTickBlock } from '../src/world/randomTicks.js';
import { blockDrops } from '../src/world/mining.js';
import { craft } from '../src/player/crafting.js';
import { B } from '../src/world/blocks.js';
import { I, toolOf } from '../src/world/items.js';
import { MockWorld, rng } from './helpers.js';

class FarmWorld extends MockWorld {
  constructor() { super(60); this.light = 0xf0; }
  getLight() { return this.light; }
  setBlock(x, y, z, id, meta = 0) { this.set(x, y, z, id, meta); return true; }
}

describe('farming', () => {
  it('growth speed follows the reference formula', () => {
    const w = new FarmWorld();
    // single crop on dry farmland surrounded by dry farmland: 1 + 1 + 8 * 0.25 = 4
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.set(dx, 63, dz, B.FARMLAND, 0);
    w.set(0, 64, 0, B.WHEAT);
    expect(growthSpeed(w, 0, 64, 0)).toBe(4);
    // moist farmland: 1 + 3 + 8 * 0.75 = 10
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.set(dx, 63, dz, B.FARMLAND, 7);
    expect(growthSpeed(w, 0, 64, 0)).toBe(10);
    // a diagonal neighbour halves it
    w.set(1, 64, 1, B.WHEAT);
    expect(growthSpeed(w, 0, 64, 0)).toBe(5);
  });

  it('growth chance per random tick', () => {
    expect(cropGrowthChance(10)).toBeCloseTo(1 / 3);
    expect(cropGrowthChance(4)).toBeCloseTo(1 / 7);
    expect(cropGrowthChance(1)).toBeCloseTo(1 / 26);
  });

  it('farmland is moistened by water within 4 blocks and dries out without it', () => {
    const w = new FarmWorld();
    w.set(0, 63, 0, B.FARMLAND, 0);
    expect(farmlandHydrated(w, 0, 63, 0)).toBe(false);
    w.set(4, 63, -4, B.WATER);
    expect(farmlandHydrated(w, 0, 63, 0)).toBe(true);
    randomTickBlock(w, 0, 63, 0, B.FARMLAND);
    expect(w.getMeta(0, 63, 0)).toBe(7);
    w.set(4, 63, -4, B.AIR);
    for (let k = 0; k < 7; k++) randomTickBlock(w, 0, 63, 0, B.FARMLAND);
    expect(w.getBlock(0, 63, 0)).toBe(B.FARMLAND);
    expect(w.getMeta(0, 63, 0)).toBe(0);
    randomTickBlock(w, 0, 63, 0, B.FARMLAND); // dry and bare -> dirt
    expect(w.getBlock(0, 63, 0)).toBe(B.DIRT);
  });

  it('wheat grows only in light >= 9 and stops at stage 7', () => {
    const w = new FarmWorld();
    w.set(0, 63, 0, B.FARMLAND, 7);
    w.set(0, 64, 0, B.WHEAT, 0);
    w.light = 0x08;
    const r = rng(3);
    for (let k = 0; k < 500; k++) randomTickBlock(w, 0, 64, 0, B.WHEAT, r);
    expect(w.getMeta(0, 64, 0)).toBe(0);
    w.light = 0x90;
    for (let k = 0; k < 500; k++) randomTickBlock(w, 0, 64, 0, B.WHEAT, r);
    expect(w.getMeta(0, 64, 0)).toBe(7);
  });

  it('harvest drops', () => {
    const r = rng(9);
    expect(blockDrops(B.WHEAT, toolOf(null), r, 3)).toEqual([{ id: I.WHEAT_SEEDS, count: 1 }]);
    let wheat = 0, seeds = 0;
    for (let k = 0; k < 7000; k++) for (const d of blockDrops(B.WHEAT, toolOf(null), r, 7)) {
      if (d.id === I.WHEAT) wheat += d.count; else seeds += d.count;
    }
    expect(wheat).toBe(7000);
    expect(seeds / 7000).toBeCloseTo(1 + 3 * 4 / 7, 1); // ~2.71 seeds per mature crop
    let fromGrass = 0;
    for (let k = 0; k < 8000; k++) fromGrass += blockDrops(B.TALL_GRASS, toolOf(null), r).length;
    expect(fromGrass / 8000).toBeCloseTo(0.125, 1);
  });

  it('carrots: 2-5 when ripe, the carrot back otherwise', () => {
    const r = rng(4);
    expect(blockDrops(B.CARROTS, toolOf(null), r, 4)).toEqual([{ id: I.CARROT, count: 1 }]);
    let min = 9, max = 0;
    for (let k = 0; k < 3000; k++) { const n = blockDrops(B.CARROTS, toolOf(null), r, 7)[0].count; min = Math.min(min, n); max = Math.max(max, n); }
    expect([min, max]).toEqual([2, 5]);
  });

  it('bread and hoe recipes', () => {
    const s = (id) => (id == null ? null : { id, count: 1 });
    expect(craft([I.WHEAT, I.WHEAT, I.WHEAT, null, null, null, null, null, null].map(s), 3)).toEqual({ id: I.BREAD, count: 1 });
    const P = B.OAK_PLANKS, S = I.STICK;
    expect(craft([P, P, null, null, S, null, null, S, null].map(s), 3)).toEqual({ id: I.WOOD_HOE, count: 1 });
  });
});
