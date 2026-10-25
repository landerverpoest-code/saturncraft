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
    expect(WOOD_SETS.length).toBe(8);
    for (const [planks, slab, stairs, fence] of WOOD_SETS) {
      const P = { id: planks, count: 1 };
      expect(craft([P, P, P, null, null, null, null, null, null], 3)).toEqual({ id: slab, count: 6 });
      expect(craft([P, null, null, P, P, null, P, P, P], 3)).toEqual({ id: stairs, count: 4 });
      expect(fence).toBeTruthy();
    }
  });
});

describe('smoker and blast furnace', () => {
  it('cook their own kind twice as fast', async () => {
    const { fastCook } = await import('../src/player/crafting.js');
    const { I } = await import('../src/world/items.js');
    expect(fastCook('food', I.RAW_BEEF)).toBe(true);
    expect(fastCook('food', B.SAND)).toBe(false);
    expect(fastCook('ore', I.RAW_IRON)).toBe(true);
    expect(fastCook('ore', I.RAW_BEEF)).toBe(false);
  });
  it('are crafted from a furnace', async () => {
    const F = { id: B.FURNACE, count: 1 }, L = { id: B.OAK_LOG, count: 1 };
    expect(craft([null, L, null, L, F, L, null, L, null], 3)).toEqual({ id: B.SMOKER, count: 1 });
  });
});

describe('candles', async () => {
  const { CANDLES, CANDLE_IDS, EMIT } = await import('../src/world/blocks.js');
  const { I, DYES } = await import('../src/world/items.js');
  const { blockDrops } = await import('../src/world/mining.js');
  it('are crafted from string over honeycomb and dyed in sixteen colours', () => {
    expect(CANDLE_IDS.length).toBe(17);
    const st = (id) => id && { id, count: 1 };
    expect(craft([I.STRING, null, null, I.HONEYCOMB, null, null, null, null, null].map(st), 3)).toEqual({ id: CANDLE_IDS[0], count: 1 });
    expect(craft([CANDLE_IDS[0], DYES[14], null, null].map(st), 2)).toEqual({ id: CANDLE_IDS[15], count: 1 });
  });
  it('glow only when lit and drop one candle per stick', () => {
    const c = CANDLES.get(CANDLE_IDS[3]);
    expect(EMIT[c.unlit]).toBe(0);
    expect(EMIT[c.lit]).toBe(12);
    expect(blockDrops(c.lit, undefined, () => 0, 3)).toEqual([{ id: c.unlit, count: 4 }]);
  });
});
