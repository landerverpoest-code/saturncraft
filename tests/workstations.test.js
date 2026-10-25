import { describe, it, expect } from 'vitest';
import { B, BLOCKS, SHAPE } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import { ENCHANTS } from '../src/world/enchantments.js';
import { grindstoneResult, grindstoneXp, grindstoneAccepts, stonecutterOutputs, stonecutterAccepts, STONECUTTER_INPUTS } from '../src/world/workstations.js';
import { blockBoxes, collisionBoxes, selectionBox, SHAPED_COLLISION } from '../src/world/shapes.js';
import { craft } from '../src/player/crafting.js';
import { texId } from '../src/world/textures.js';

const S = (id) => (id == null ? null : { id, count: 1, damage: 0 });

describe('grindstone', () => {
  const dur = ITEMS[I.IRON_SWORD].durability;

  it('merges two worn items of a kind with a 5% bonus and strips their enchantments', () => {
    const a = { id: I.IRON_SWORD, count: 1, damage: dur - 100, ench: { keen: 3 } };
    const b = { id: I.IRON_SWORD, count: 1, damage: dur - 50, ench: { plunder: 1 }, rw: 3 };
    const r = grindstoneResult(a, b);
    expect(r.result.id).toBe(I.IRON_SWORD);
    expect(r.result.damage).toBe(dur - (150 + Math.floor(dur * 5 / 100)));
    expect(r.result.ench).toBeUndefined();
    expect(r.result.rw).toBeUndefined();
    const worth = ENCHANTS.keen.min(3) + ENCHANTS.plunder.min(1);
    expect(r.xp).toEqual([Math.ceil(worth / 2), worth]);
  });

  it('never repairs past full and leaves plain pairs worth no experience', () => {
    const r = grindstoneResult({ id: I.IRON_SWORD, count: 1, damage: 5 }, { id: I.IRON_SWORD, count: 1, damage: 1 });
    expect(r.result.damage).toBe(0);
    expect(r.xp).toEqual([0, 0]);
    expect(grindstoneXp(r)).toBe(0);
  });

  it('refuses mixed kinds, things without durability and stacks', () => {
    expect(grindstoneResult({ id: I.IRON_SWORD, count: 1, damage: 9 }, { id: I.IRON_PICKAXE, count: 1, damage: 9 })).toBeNull();
    expect(grindstoneResult({ id: I.ENCHANTED_BOOK, count: 1, ench: { keen: 1 } }, { id: I.ENCHANTED_BOOK, count: 1, ench: { keen: 1 } })).toBeNull();
    expect(grindstoneResult(null, null)).toBeNull();
    expect(grindstoneAccepts({ id: B.STONE, count: 1 })).toBe(false);
    expect(grindstoneAccepts(S(I.IRON_SWORD))).toBe(true);
  });

  it('strips one enchanted item in either slot (an Enchanted Book turns back into a Book)', () => {
    const sword = { id: I.IRON_SWORD, count: 1, damage: 12, ench: { keen: 5, steadfast: 3 } };
    for (const [a, b] of [[sword, null], [null, sword]]) {
      const r = grindstoneResult(a, b);
      expect(r.result).toEqual({ id: I.IRON_SWORD, count: 1, damage: 12 });
      const worth = ENCHANTS.keen.min(5) + ENCHANTS.steadfast.min(3);
      expect(r.xp).toEqual([Math.ceil(worth / 2), worth]);
      for (let k = 0; k < 20; k++) { const v = grindstoneXp(r); expect(v).toBeGreaterThanOrEqual(r.xp[0]); expect(v).toBeLessThanOrEqual(r.xp[1]); }
    }
    expect(grindstoneResult({ id: I.ENCHANTED_BOOK, count: 1, ench: { endless: 1 } }, null).result.id).toBe(I.BOOK);
    expect(grindstoneResult(S(I.IRON_SWORD), null)).toBeNull(); // nothing to take off
  });

  it('keeps curses', () => {
    ENCHANTS.keen.curse = true; // pretend for the test
    try {
      const r = grindstoneResult({ id: I.IRON_SWORD, count: 1, damage: 0, ench: { keen: 2, plunder: 3 } }, null);
      expect(r.result.ench).toEqual({ keen: 2 });
      expect(r.xp[1]).toBe(ENCHANTS.plunder.min(3));
      expect(grindstoneResult({ id: I.IRON_SWORD, count: 1, damage: 0, ench: { keen: 2 } }, null)).toBeNull();
    } finally { delete ENCHANTS.keen.curse; }
  });
});

describe('stonecutter', () => {
  const ids = (id) => stonecutterOutputs(id).map((o) => o.id);
  it('cuts stone into bricks, chiseled bricks, slabs (two a block) and stairs', () => {
    const out = stonecutterOutputs(B.STONE);
    for (const id of [B.STONE_BRICKS, B.CHISELED_STONE_BRICKS, B.STONE_SLAB, B.STONE_STAIRS, B.STONE_BRICK_SLAB, B.STONE_BRICK_STAIRS]) expect(out.map((o) => o.id)).toContain(id);
    expect(out.find((o) => o.id === B.STONE_SLAB).count).toBe(2);
    expect(out.find((o) => o.id === B.STONE_BRICKS).count).toBe(1);
    expect(ids(B.STONE)).not.toContain(B.STONE);
  });
  it('gives walls, polished forms and the Hollow\'s shapes', () => {
    expect(ids(B.COBBLESTONE)).toEqual([B.COBBLESTONE_SLAB, B.COBBLESTONE_STAIRS, B.COBBLESTONE_WALL]);
    expect(ids(B.GRANITE)).toEqual([B.POLISHED_GRANITE, B.GRANITE_SLAB, B.POLISHED_GRANITE_SLAB, B.GRANITE_STAIRS, B.POLISHED_GRANITE_STAIRS]);
    expect(ids(B.HOLLOWBRICK)).toContain(B.HOLLOWBRICK_PILLAR);
    expect(ids(B.HOLLOWBRICK)).toContain(B.HOLLOWBRICK_SLAB);
  });
  it('only takes stone that has shapes, and never gives non-stone', () => {
    expect(stonecutterAccepts(S(B.DIRT))).toBe(false);
    expect(stonecutterAccepts(S(B.OAK_PLANKS))).toBe(false);
    expect(stonecutterAccepts(S(B.SANDSTONE))).toBe(true);
    expect(STONECUTTER_INPUTS).toContain(B.SMOOTH_STONE);
    for (const id of STONECUTTER_INPUTS) for (const o of stonecutterOutputs(id)) {
      expect(BLOCKS[o.id]).toBeTruthy();
      expect(BLOCKS[o.id].sound).not.toBe('wood');
      expect(o.count).toBe(BLOCKS[o.id].shape === SHAPE.SLAB ? 2 : 1);
    }
  });
});

describe('workstation blocks', () => {
  const grid = (rows) => rows.flat().map(S);
  it('are crafted from the documented recipes', () => {
    expect(craft(grid([[I.STICK, B.STONE_SLAB, I.STICK], [B.OAK_PLANKS, null, B.SPRUCE_PLANKS], [null, null, null]]), 3)).toEqual({ id: B.GRINDSTONE, count: 1 });
    expect(craft(grid([[null, I.IRON_INGOT, null], [B.STONE, B.STONE, B.STONE], [null, null, null]]), 3)).toEqual({ id: B.STONECUTTER, count: 1 });
  });
  it('are shaped boxes with their own textures, turned by meta', () => {
    for (const id of [B.GRINDSTONE, B.STONECUTTER]) {
      expect(BLOCKS[id].shape).toBe(SHAPE.BOXES);
      expect(SHAPED_COLLISION[id]).toBe(1);
      const [a, b] = [blockBoxes(id, 0), blockBoxes(id, 1)];
      expect(a.length).toBe(b.length);
      expect(b[0]).toEqual([a[0][2], a[0][1], a[0][0], a[0][5], a[0][4], a[0][3]]);
    }
    expect(collisionBoxes(B.STONECUTTER, 0)).toEqual([[0, 0, 0, 1, 9 / 16, 1]]);
    expect(selectionBox(B.STONECUTTER, 0)[4]).toBe(1);
    for (const n of ['grindstone_face', 'grindstone_round', 'grindstone_leg', 'stonecutter_top', 'stonecutter_saw', 'stonecutter_saw_3']) expect(texId(n)).toBeGreaterThan(0);
    expect(texId('stonecutter_saw_3') - texId('stonecutter_saw_0')).toBe(3);
  });
});
