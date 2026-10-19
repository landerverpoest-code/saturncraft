import { describe, it, expect } from 'vitest';
import { craft, SMELTING } from '../src/player/crafting.js';
import { B } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';

const s = (id) => (id == null ? null : { id, count: 1 });
const grid = (ids) => ids.map(s);

describe('crafting', () => {
  it('log -> 4 planks in any slot', () => {
    expect(craft(grid([null, null, B.OAK_LOG, null]), 2)).toEqual({ id: B.OAK_PLANKS, count: 4 });
    expect(craft(grid([null, null, null, null, null, null, null, null, B.BIRCH_LOG]), 3)).toEqual({ id: B.BIRCH_PLANKS, count: 4 });
  });
  it('sticks and workbench in the 2x2 grid', () => {
    expect(craft(grid([B.OAK_PLANKS, null, B.SPRUCE_PLANKS, null]), 2)).toEqual({ id: I.STICK, count: 4 });
    expect(craft(grid([B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS]), 2)).toEqual({ id: B.WORKBENCH, count: 1 });
  });
  it('tools need the 3x3 grid', () => {
    const P = B.OAK_PLANKS, S = I.STICK, C = B.COBBLESTONE;
    expect(craft(grid([P, P, P, null, S, null, null, S, null]), 3)).toEqual({ id: I.WOOD_PICKAXE, count: 1 });
    expect(craft(grid([C, C, C, null, S, null, null, S, null]), 3)).toEqual({ id: I.STONE_PICKAXE, count: 1 });
    // axe and its mirror image
    expect(craft(grid([C, C, null, C, S, null, null, S, null]), 3)).toEqual({ id: I.STONE_AXE, count: 1 });
    expect(craft(grid([null, C, C, null, S, C, null, S, null]), 3)).toEqual({ id: I.STONE_AXE, count: 1 });
  });
  it('chest from a ring of mixed planks', () => {
    const P = B.OAK_PLANKS, Q = B.BIRCH_PLANKS;
    expect(craft(grid([P, P, Q, P, null, P, Q, P, P]), 3)).toEqual({ id: B.CHEST, count: 1 });
  });
  it('furnace and torches', () => {
    const C = B.COBBLESTONE;
    expect(craft(grid([C, C, C, C, null, C, C, C, C]), 3)).toEqual({ id: B.FURNACE, count: 1 });
    expect(craft(grid([I.COAL, null, I.STICK, null]), 2)).toEqual({ id: B.TORCH, count: 4 });
  });
  it('invalid grids craft nothing', () => {
    expect(craft(grid([B.DIRT, B.DIRT, null, null]), 2)).toBeNull();
    expect(craft(grid([null, null, null, null]), 2)).toBeNull();
  });
  it('smelting', () => {
    expect(SMELTING[I.RAW_IRON]).toBe(I.IRON_INGOT);
    expect(SMELTING[B.SAND]).toBe(B.GLASS);
    expect(SMELTING[I.RAW_BEEF]).toBe(I.STEAK);
  });
});
