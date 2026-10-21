import { describe, it, expect } from 'vitest';
import { B } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { hopperStep, newHopper, hopperPlaceMeta, spoutDir } from '../src/world/hoppers.js';

function fakeGame(blocks) {
  const chests = new Map(), hoppers = new Map(), furnaces = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  return {
    world: { getBlock: (x, y, z) => blocks[key(x, y, z)]?.[0] || 0, getMeta: (x, y, z) => blocks[key(x, y, z)]?.[1] || 0 },
    getChest(x, y, z) { const k = key(x, y, z); if (!chests.has(k)) chests.set(k, { slots: new Array(27).fill(null) }); return chests.get(k); },
    getHopper(x, y, z) { const k = key(x, y, z); if (!hoppers.has(k)) hoppers.set(k, newHopper(x, y, z)); return hoppers.get(k); },
    getFurnace(x, y, z) { const k = key(x, y, z); if (!furnaces.has(k)) furnaces.set(k, { input: null, fuel: null, output: null }); return furnaces.get(k); },
  };
}

describe('hoppers', () => {
  it('move items from a chest above to a chest below, one per step', () => {
    const g = fakeGame({ '0,1,0': [B.CHEST], '0,0,0': [B.HOPPER, 0], '0,-1,0': [B.CHEST] });
    g.getChest(0, 1, 0).slots[3] = { id: I.COAL, count: 2, damage: 0 };
    const h = g.getHopper(0, 0, 0);
    expect(hopperStep(g, h, false)).toBe(true);
    expect(h.slots[0]).toEqual({ id: I.COAL, count: 1, damage: 0 });
    hopperStep(g, h, false); hopperStep(g, h, false);
    expect(g.getChest(0, -1, 0).slots[0].count).toBe(2);
    expect(g.getChest(0, 1, 0).slots[3]).toBe(null);
  });
  it('feed furnaces: from above into the input, from the side into the fuel', () => {
    const g = fakeGame({ '0,0,0': [B.HOPPER, 0], '0,-1,0': [B.FURNACE], '5,0,0': [B.HOPPER, 2], '6,0,0': [B.FURNACE] });
    g.getHopper(0, 0, 0).slots[0] = { id: I.RAW_IRON ?? I.IRON_INGOT, count: 1, damage: 0 };
    hopperStep(g, g.getHopper(0, 0, 0), false);
    expect(g.getFurnace(0, -1, 0).input).not.toBe(null);
    const side = g.getHopper(5, 0, 0);
    side.slots[0] = { id: B.DIRT, count: 1, damage: 0 }; side.slots[1] = { id: I.COAL, count: 1, damage: 0 };
    hopperStep(g, side, false);
    expect(g.getFurnace(6, 0, 0).fuel.id).toBe(I.COAL); // dirt is no fuel, so coal goes in
  });
  it('stop when powered and pick up items in the bowl', () => {
    const g = fakeGame({ '0,0,0': [B.HOPPER, 0] });
    const h = g.getHopper(0, 0, 0), item = { x: 0.5, y: 1.1, z: 0.5, stack: { id: I.APPLE, count: 1, damage: 0 } };
    expect(hopperStep(g, h, true, [item])).toBe(false);
    expect(hopperStep(g, h, false, [item])).toBe(true);
    expect(item.dead).toBe(true);
  });
  it('point the spout into the clicked block', () => {
    expect(hopperPlaceMeta([0, 1, 0])).toBe(0);
    expect(spoutDir(hopperPlaceMeta([0, 0, 1]))).toEqual([0, 0, -1]);
    expect(spoutDir(hopperPlaceMeta([-1, 0, 0]))).toEqual([1, 0, 0]);
  });
});
