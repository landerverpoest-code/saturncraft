import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '../src/world/generator.js';
import { lushRegion, LUSH_THRESHOLD } from '../src/world/caveGen.js';
import { B } from '../src/world/blocks.js';
import { cidx } from '../src/world/constants.js';
import { MOBS } from '../src/mobs/mobTypes.js';

describe('lush cave pools', () => {
  it('sink clay-bottomed water pools into lush cave floors, held in by their rim', () => {
    const seed = 42, gen = new TerrainGenerator(seed);
    const found = [-14, -19]; // a lush stretch of this seed's underground
    expect(lushRegion(seed, found[0] * 16 + 8, found[1] * 16 + 8)).toBeGreaterThan(LUSH_THRESHOLD);
    let pools = 0, leaky = 0;
    for (let dx = 0; dx < 5; dx++) {
      const r = gen.generate(found[0] + dx, found[1]), bl = r.blocks || r;
      for (let y = 0; y < 60; y++) for (let x = 1; x < 15; x++) for (let z = 1; z < 15; z++) {
        if (bl[cidx(x, y, z)] !== B.WATER || bl[cidx(x, y - 1, z)] !== B.CLAY) continue;
        pools++;
        for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (bl[cidx(x + ax, y, z + az)] === B.AIR) leaky++;
      }
    }
    expect(pools).toBeGreaterThan(5);
    expect(leaky).toBe(0);
  });
  it('gillnewts breathe water and count apart from the fish cap', () => {
    expect(MOBS.gillnewt.breathesWater).toBe(true);
    expect(MOBS.gillnewt.newt).toBe(true);
  });
});
