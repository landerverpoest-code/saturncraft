import { describe, it, expect } from 'vitest';
import { B } from '../src/world/blocks.js';
import { pairOnPlace, chestPartner, unpairAfterBreak, doubleChestHalves, doubleChestView, PAIRED, KEEP_BITS } from '../src/world/chests.js';
import { containerSlots, applySlotChanges, containerState } from '../src/net/protocol.js';

function mockWorld() {
  const blocks = new Map(), metas = new Map();
  const k = (x, y, z) => `${x},${y},${z}`;
  return {
    getBlock: (x, y, z) => blocks.get(k(x, y, z)) || 0,
    getMeta: (x, y, z) => metas.get(k(x, y, z)) || 0,
    set(x, y, z, id, m = 0) { blocks.set(k(x, y, z), id); metas.set(k(x, y, z), m); },
  };
}
const place = (w, x, y, z, face, sneak) => {
  const r = pairOnPlace(w, x, y, z, face, sneak);
  w.set(x, y, z, B.CHEST, r.meta);
  if (r.neighbour) w.set(r.neighbour.x, r.neighbour.y, r.neighbour.z, B.CHEST, r.neighbour.meta);
};

describe('double chests', () => {
  it('two chests facing the same way side by side join', () => {
    const w = mockWorld();
    place(w, 0, 0, 0, 0); place(w, 1, 0, 0, 0);
    expect(chestPartner(w, 0, 0, 0)).toEqual({ x: 1, y: 0, z: 0 });
    expect(chestPartner(w, 1, 0, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(doubleChestHalves(w, 1, 0, 0)).toEqual([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]);
  });
  it('do not join across the front, with another facing, when sneaking, or a third chest', () => {
    const w = mockWorld();
    place(w, 0, 0, 0, 0); place(w, 0, 0, 1, 0);
    expect(chestPartner(w, 0, 0, 0)).toBeNull();
    place(w, 5, 0, 0, 0); place(w, 6, 0, 0, 1);
    expect(chestPartner(w, 5, 0, 0)).toBeNull();
    place(w, 10, 0, 0, 2); place(w, 11, 0, 0, 2, true);
    expect(chestPartner(w, 10, 0, 0)).toBeNull();
    place(w, 20, 0, 0, 2); place(w, 21, 0, 0, 2); place(w, 22, 0, 0, 2);
    expect(chestPartner(w, 21, 0, 0)).toEqual({ x: 20, y: 0, z: 0 });
    expect(chestPartner(w, 22, 0, 0)).toBeNull();
  });
  it('chests facing east or west join along z', () => {
    const w = mockWorld();
    place(w, 0, 0, 0, 1); place(w, 0, 0, -1, 1);
    expect(chestPartner(w, 0, 0, 0)).toEqual({ x: 0, y: 0, z: -1 });
  });
  it('breaking one half leaves a single chest', () => {
    const w = mockWorld();
    place(w, 0, 0, 0, 3); place(w, 0, 0, 1, 3);
    const m = w.getMeta(0, 0, 0);
    w.set(0, 0, 0, 0);
    const u = unpairAfterBreak(w, 0, 0, 0, m);
    expect(u).toEqual({ x: 0, y: 0, z: 1, meta: 3 });
  });
  it('loot rolling keeps the pairing bits', () => {
    expect(((2 | PAIRED | 8 | (3 << 4)) & KEEP_BITS)).toBe(2 | PAIRED);
  });
  it('the 54-slot view reads and writes both halves, also through the net protocol', () => {
    const a = { x: 0, y: 0, z: 0, slots: new Array(27).fill(null) }, b = { x: 1, y: 0, z: 0, slots: new Array(27).fill(null) };
    const v = doubleChestView(a, b);
    v.slots[3] = { id: 1, count: 5, damage: 0 };
    v.slots[40] = { id: 2, count: 7, damage: 0 };
    expect(a.slots[3].count).toBe(5);
    expect(b.slots[13].count).toBe(7);
    expect(containerSlots('chest2', v)).toHaveLength(54);
    expect(applySlotChanges('chest2', v, [[50, null, { id: 4, count: 1, damage: 0 }]])).toBe(true);
    expect(b.slots[23].id).toBe(4);
    expect(containerState('chest2', v).slots.filter(Boolean)).toHaveLength(3);
  });
});
