import { describe, it, expect } from 'vitest';
import { treeShape, LEAVES, LOGS, SAPLING_TREE, LEAF_SAPLING } from '../src/world/trees.js';
import { B } from '../src/world/blocks.js';
import { BIOMES, BIOME } from '../src/world/biomes.js';
import { craft } from '../src/player/crafting.js';

describe('blossom grove', () => {
  it('blossom trees have a log trunk under pink crowns', () => {
    const s = treeShape('blossom', 0.3);
    expect(s.some(([, , , id]) => id === B.BLOSSOM_LOG)).toBe(true);
    expect(s.filter(([, , , id]) => id === B.BLOSSOM_LEAVES).length).toBeGreaterThan(30);
  });
  it('the wood works like the other woods', () => {
    expect(LEAVES.has(B.BLOSSOM_LEAVES) && LOGS.has(B.BLOSSOM_LOG)).toBe(true);
    expect(SAPLING_TREE[B.BLOSSOM_SAPLING]).toBe('blossom');
    expect(LEAF_SAPLING[B.BLOSSOM_LEAVES]).toBe(B.BLOSSOM_SAPLING);
    expect(craft([{ id: B.BLOSSOM_LOG, count: 1 }, null, null, null], 2)).toEqual({ id: B.BLOSSOM_PLANKS, count: 4 });
    expect(BIOMES[BIOME.BLOSSOM_GROVE].key).toBe('blossom_grove');
  });
});
