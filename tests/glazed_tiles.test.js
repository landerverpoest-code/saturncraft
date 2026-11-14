// Glazed Tiles: sixteen decorative blocks, one per dye colour, smelted from coloured Terracotta and turned by the placing facing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { B, BLOCKS, NUM_BLOCKS, COLOR_BLOCKS, GLAZED } from '../src/world/blocks.js';
import { COLORS } from '../src/world/colors.js';
import { TEX_NAMES } from '../src/world/textures.js';
import { GLAZED_TEX } from '../src/world/glazedTextures.js';
import { SMELTING } from '../src/player/crafting.js';
import '../src/world/dimensions/register.js';

const FORBIDDEN = /minecraft|nether|redstone|tripwire/i;

describe('Glazed Tiles', () => {
  it('has one block per dye colour, named and textured', () => {
    expect(COLOR_BLOCKS.glazed).toHaveLength(16);
    COLORS.forEach(([key, name], i) => {
      const id = B[key.toUpperCase() + '_GLAZED_TILES'];
      expect(id).toBeGreaterThan(0);
      expect(COLOR_BLOCKS.glazed[i]).toBe(id);
      expect(BLOCKS[id].name).toBe(`${name} Glazed Tiles`);
      expect(BLOCKS[id].tex.top).toBe(key + '_glazed_tiles');
      expect(BLOCKS[id].glazed).toBe(true);
      expect(GLAZED[id]).toBe(1);
      expect(BLOCKS[id].tool).toBeTruthy();
      expect(BLOCKS[id].hardness).toBe(1.4);
    });
  });

  it('has textures in TEX_NAMES and a painter for each', () => {
    for (const [key] of COLORS) {
      expect(TEX_NAMES).toContain(key + '_glazed_tiles');
      expect(GLAZED_TEX[key + '_glazed_tiles']).toBeTypeOf('function');
    }
  });

  it('smelts each coloured terracotta into the glazed tiles of its colour', () => {
    COLORS.forEach(([key], i) => {
      const terracotta = B[key.toUpperCase() + '_TERRACOTTA'];
      expect(SMELTING[terracotta]).toBe(COLOR_BLOCKS.glazed[i]);
    });
    expect(SMELTING[B.TERRACOTTA]).toBeUndefined();
  });

  it('keeps earlier ids where they were', () => {
    expect(B.DAWNFERN_PLANT).toBe(1379);
    expect(COLOR_BLOCKS.glazed[0]).toBeGreaterThan(B.DAWNFERN_PLANT);
    expect(NUM_BLOCKS).toBeGreaterThanOrEqual(COLOR_BLOCKS.glazed[15] + 1);
  });

  it('uses no forbidden words in names or texture names', () => {
    for (const id of COLOR_BLOCKS.glazed) {
      expect(BLOCKS[id].name).not.toMatch(FORBIDDEN);
      expect(BLOCKS[id].tex.top).not.toMatch(FORBIDDEN);
    }
    const src = readFileSync(new URL('../src/world/glazedTextures.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(FORBIDDEN);
  });
});
