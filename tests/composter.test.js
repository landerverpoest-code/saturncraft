import { describe, it, expect } from 'vitest';
import { compost, COMPOST_CHANCE } from '../src/world/composter.js';
import { craft } from '../src/player/crafting.js';
import { B } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { blockBoxes, compostBox } from '../src/world/shapes.js';

describe('composter', () => {
  it('is made from seven oak slabs', () => {
    const S = { id: B.OAK_SLAB, count: 1 };
    expect(craft([S, null, S, S, null, S, S, S, S], 3)).toEqual({ id: B.COMPOSTER, count: 1 });
  });
  it('takes plant matter with the reference chances', () => {
    expect(COMPOST_CHANCE.get(I.WHEAT_SEEDS)).toBe(0.3);
    expect(COMPOST_CHANCE.get(I.BREAD)).toBe(0.85);
    expect(COMPOST_CHANCE.get(I.PUMPKIN_PIE)).toBe(1);
    expect(compost(0, I.IRON_INGOT)).toBe(null);
  });
  it('the first item always counts; later ones roll; a full composter takes nothing', () => {
    expect(compost(0, I.WHEAT_SEEDS, () => 0.99)).toEqual({ level: 1 });
    expect(compost(3, I.WHEAT_SEEDS, () => 0.99)).toEqual({ level: 3 });
    expect(compost(3, I.WHEAT_SEEDS, () => 0.1)).toEqual({ level: 4 });
    expect(compost(7, I.PUMPKIN_PIE)).toBe(null);
  });
  it('compost rises with the level inside the walls', () => {
    expect(blockBoxes(B.COMPOSTER, 0).length).toBe(5);
    expect(compostBox(0)).toBe(null);
    expect(compostBox(1)[4]).toBeCloseTo(3 / 16);
    expect(compostBox(8)[4]).toBeCloseTo(15 / 16);
  });
});
