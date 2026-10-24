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

describe('gilded apple and absorption', () => {
  it('is crafted from eight gold ingots round an apple', () => {
    const G = { id: I.GOLD_INGOT, count: 1 }, A = { id: I.APPLE, count: 1 };
    expect(craft([G, G, G, G, A, G, G, G, G], 3)).toEqual({ id: I.GILDED_APPLE, count: 1 });
  });
  it('golden hearts take damage before health and vanish with the effect', async () => {
    const { Player } = await import('../src/player/player.js');
    const p = new Player();
    p.addEffect('absorption', 2400, 0);
    expect(p.absorption).toBe(4);
    p.hurt(3, 'generic');
    expect(p.absorption).toBe(1);
    expect(p.health).toBe(20);
    p.invulnerable = 0;
    p.hurt(3, 'generic');
    expect(p.absorption).toBe(0);
    expect(p.health).toBe(18);
  });
});

describe('charm of undying', () => {
  it('saves its holder from a deadly hit once', async () => {
    const { Player } = await import('../src/player/player.js');
    const p = new Player();
    p.inventory.slots[3] = { id: I.CHARM_OF_UNDYING, count: 1 };
    p.hurt(50, 'generic');
    expect(p.dead).toBe(false);
    expect(p.health).toBe(1);
    expect(p.effects.regeneration.amp).toBe(1);
    expect(p.inventory.slots[3]).toBe(null);
    p.invulnerable = 0; p.absorption = 0;
    p.hurt(50, 'generic');
    expect(p.dead).toBe(true);
  });
});
