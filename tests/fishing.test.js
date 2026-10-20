import { describe, it, expect } from 'vitest';
import { rollCatch } from '../src/entities/bobber.js';
import { I } from '../src/world/items.js';
import { craft, SMELTING } from '../src/player/crafting.js';
import { rng } from './helpers.js';

describe('fishing', () => {
  it('catches follow the reference split: 85 % fish, mostly silverfin', () => {
    const r = rng(3), fish = new Set([I.RAW_SILVERFIN, I.RAW_REDFIN, I.SPINEFISH, I.GLIMMERFIN]);
    let f = 0, silver = 0;
    for (let k = 0; k < 20000; k++) { const c = rollCatch(r); if (fish.has(c.id)) f++; if (c.id === I.RAW_SILVERFIN) silver++; }
    expect(f / 20000).toBeCloseTo(0.85, 1);
    expect(silver / 20000).toBeCloseTo(0.85 * 0.6, 1);
  });
  it('rod recipe and cooked fish', () => {
    const S = { id: I.STICK, count: 1 }, W = { id: I.STRING, count: 1 };
    expect(craft([null, null, S, null, S, W, S, null, W], 3)?.id).toBe(I.FISHING_ROD);
    expect(SMELTING[I.RAW_SILVERFIN]).toBe(I.COOKED_SILVERFIN);
  });
});
