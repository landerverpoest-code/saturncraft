import { describe, it, expect } from 'vitest';
import { growTree, leavesConnected, treeShape } from '../src/world/trees.js';
import { randomTickBlock } from '../src/world/randomTicks.js';
import { blockDrops } from '../src/world/mining.js';
import { B } from '../src/world/blocks.js';
import { MockWorld, rng } from './helpers.js';

class TreeWorld extends MockWorld {
  constructor() { super(64); this.broken = []; }
  getLight() { return 0xf0; }
  setBlock(x, y, z, id, meta = 0) { this.set(x, y, z, id, meta); return true; }
  breakBlock(x, y, z) { this.broken.push([x, y, z]); this.set(x, y, z, B.AIR); }
}

describe('saplings and leaves', () => {
  it('a sapling grows into a tree after two growth steps', () => {
    const w = new TreeWorld();
    w.set(0, 63, 0, B.GRASS); w.set(0, 64, 0, B.OAK_SAPLING, 0);
    const r = rng(5);
    for (let k = 0; k < 200 && w.getBlock(0, 64, 0) === B.OAK_SAPLING; k++) randomTickBlock(w, 0, 64, 0, B.OAK_SAPLING, r);
    expect(w.getBlock(0, 64, 0)).toBe(B.OAK_LOG);
    expect(w.getBlock(0, 63, 0)).toBe(B.GRASS); // ground untouched
  });

  it('does not grow into a ceiling', () => {
    const w = new TreeWorld();
    w.set(0, 64, 0, B.SPRUCE_SAPLING, 1); w.set(0, 66, 0, B.STONE);
    expect(growTree(w, 0, 64, 0, 'spruce', rng(2))).toBe(false);
    expect(w.getBlock(0, 64, 0)).toBe(B.SPRUCE_SAPLING);
  });

  it('all generated leaves are within 4 steps of the trunk', () => {
    for (const kind of ['oak', 'birch', 'spruce']) for (const r of [0, 0.5, 0.99]) {
      const w = new TreeWorld();
      for (const [dx, dy, dz, id] of treeShape(kind, r)) if (dy >= 0) w.set(dx, 64 + dy, dz, id);
      for (const [dx, dy, dz, id] of treeShape(kind, r)) if (dy >= 0 && id !== B.OAK_LOG && id !== B.BIRCH_LOG && id !== B.SPRUCE_LOG) expect(leavesConnected(w, dx, 64 + dy, dz)).toBe(true);
    }
  });

  it('natural leaves without a log decay, placed leaves stay', () => {
    const w = new TreeWorld();
    w.set(0, 70, 0, B.OAK_LEAVES, 0); w.set(1, 70, 0, B.OAK_LEAVES, 1);
    randomTickBlock(w, 0, 70, 0, B.OAK_LEAVES, rng(1));
    randomTickBlock(w, 1, 70, 0, B.OAK_LEAVES, rng(1));
    expect(w.broken).toEqual([[0, 70, 0]]);
  });

  it('leaves drop their sapling about 1 in 20', () => {
    const r = rng(9);
    let n = 0;
    for (let k = 0; k < 4000; k++) n += blockDrops(B.BIRCH_LEAVES, undefined, r).filter((s) => s.id === B.BIRCH_SAPLING).length;
    expect(n / 4000).toBeGreaterThan(0.04);
    expect(n / 4000).toBeLessThan(0.06);
  });
});
