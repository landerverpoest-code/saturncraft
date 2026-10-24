import { describe, it, expect } from 'vitest';
import { B, BLOCKS, EXT_BASE, isBlockId, SOLID, WOOD_SETS } from '../src/world/blocks.js';
import { ITEMS, isBlockItem } from '../src/world/items.js';
import { packChunk, unpackChunk } from '../src/world/save.js';
import { craft } from '../src/player/crafting.js';
import { FACE_TILE } from '../src/world/textures.js';

describe('extended block ids', () => {
  it('new blocks start at EXT_BASE and never collide with items', () => {
    expect(B.SPRUCE_SLAB).toBe(EXT_BASE);
    for (let id = 256; id < EXT_BASE; id++) expect(BLOCKS[id]).toBeUndefined();
    expect(isBlockId(B.BLOSSOM_STAIRS) && isBlockItem(B.BLOSSOM_STAIRS)).toBe(true);
    expect(isBlockId(300)).toBe(false);
    expect(ITEMS[B.POLISHED_GRANITE].block).toBe(B.POLISHED_GRANITE);
    expect(SOLID[B.POLISHED_GRANITE]).toBe(1);
    expect(FACE_TILE[B.POLISHED_GRANITE * 6 + 2]).toBeGreaterThan(0);
  });
  it('chunks with extended ids survive saving (and old 8-bit saves still load)', () => {
    const V = 16 * 16 * 384;
    const c = { blocks: new Uint16Array(V), meta: new Uint8Array(V), light: new Uint8Array(V), biomes: new Uint8Array(256), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256) };
    c.blocks[5] = B.ACACIA_STAIRS; c.blocks[6] = B.STONE; c.blocks[V - 1] = B.SMOOTH_STONE;
    const back = unpackChunk(packChunk(c));
    expect(back.blocks[5]).toBe(B.ACACIA_STAIRS);
    expect(back.blocks[6]).toBe(B.STONE);
    expect(back.blocks[V - 1]).toBe(B.SMOOTH_STONE);
    const old = { ...c, blocks: new Uint8Array(V).fill(B.DIRT) };
    expect(unpackChunk(packChunk(old)).blocks[123]).toBe(B.DIRT);
  });
  it('every wood has slabs, stairs and a fence', () => {
    expect(WOOD_SETS.length).toBe(7);
    for (const [planks, slab, stairs, fence] of WOOD_SETS) {
      const P = { id: planks, count: 1 };
      expect(craft([P, P, P, null, null, null, null, null, null], 3)).toEqual({ id: slab, count: 6 });
      expect(craft([P, null, null, P, P, null, P, P, P], 3)).toEqual({ id: stairs, count: 4 });
      expect(fence).toBeTruthy();
    }
  });
});
