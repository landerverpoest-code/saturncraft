import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '../src/world/generator.js';
import { B } from '../src/world/blocks.js';
import { cidx, MIN_Y, CHUNK_VOLUME } from '../src/world/constants.js';
import { dungeonLoot } from '../src/mobs/spawnerBlocks.js';
import { rng } from './helpers.js';

describe('dungeons', () => {
  const gen = new TerrainGenerator(2024);
  const found = [];
  for (let cx = -8; cx < 8; cx++) for (let cz = -8; cz < 8; cz++) {
    const c = gen.generate(cx, cz);
    for (let i = 0; i < CHUNK_VOLUME; i++) if (c.blocks[i] === B.SPAWNER) found.push({ c, i, x: i & 15, z: (i >> 4) & 15, y: MIN_Y + (i >> 8) });
  }

  it('appear in a fraction of chunks', () => {
    expect(found.length).toBeGreaterThan(5);
    expect(found.length).toBeLessThan(256);
  });

  it('have a spawner on a cobblestone floor in an air room, with a known mob kind', () => {
    for (const { c, x, y, z, i } of found) {
      expect([B.COBBLESTONE, B.MOSSY_COBBLESTONE]).toContain(c.blocks[cidx(x, y - 1, z)]);
      expect(c.blocks[cidx(x, y + 1, z)]).toBe(B.AIR);
      expect(c.meta[i]).toBeLessThan(3);
    }
  });

  it('loot chests: 1-3 valuable stacks and 3 junk stacks', () => {
    const r = rng(8);
    for (let k = 0; k < 50; k++) {
      const n = dungeonLoot(r).filter(Boolean).length;
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(6);
    }
  });
});
