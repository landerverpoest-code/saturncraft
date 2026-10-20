import { describe, it, expect } from 'vitest';
import { snowfall, randomTickBlock } from '../src/world/randomTicks.js';
import { collisionBoxes, selectionBox } from '../src/world/shapes.js';
import { blockDrops } from '../src/world/mining.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { B } from '../src/world/blocks.js';
import { I, toolOf } from '../src/world/items.js';
import { BIOME } from '../src/world/biomes.js';
import { MockWorld, rng } from './helpers.js';

class SnowWorld extends MockWorld {
  constructor(biome) { super(64); this.biome = biome; this.blockLight = 0; }
  isLoaded() { return true; }
  biomeAt() { return this.biome; }
  heightAt(x, z) { let y = 80; while (y > 0 && !this.getBlock(x, y, z)) y--; return y; }
  getLight() { return 0xf0 | this.blockLight; }
  setBlock(x, y, z, id, meta = 0) { this.set(x, y, z, id, meta); return true; }
}

describe('snow', () => {
  it('falls as single layers in cold biomes only, and freezes water', () => {
    const w = new SnowWorld(BIOME.SNOWY_PLAINS);
    w.set(0, 63, 0, B.WATER, 0);
    snowfall(w, 0, 0, rng(1), 4000);
    let layers = 0;
    for (const [k, v] of w.blocks) if (v === B.SNOW_LAYER) { layers++; expect(w.meta.get(k)).toBe(0); }
    expect(layers).toBeGreaterThan(100);
    expect(w.getBlock(0, 63, 0)).toBe(B.ICE);
    const warm = new SnowWorld(BIOME.PLAINS);
    snowfall(warm, 0, 0, rng(1), 2000);
    expect([...warm.blocks.values()].includes(B.SNOW_LAYER)).toBe(false);
  });

  it('melts next to bright light', () => {
    const w = new SnowWorld(BIOME.SNOWY_PLAINS);
    w.set(0, 64, 0, B.SNOW_LAYER, 0); w.blockLight = 14;
    randomTickBlock(w, 0, 64, 0, B.SNOW_LAYER, rng(1));
    expect(w.getBlock(0, 64, 0)).toBe(B.AIR);
  });

  it('a single layer has no collision; more layers stand one layer lower; shovels get snowballs', () => {
    expect(collisionBoxes(B.SNOW_LAYER, 0)).toEqual([]);
    expect(collisionBoxes(B.SNOW_LAYER, 3)[0][4]).toBeCloseTo(6 / 16);
    expect(selectionBox(B.SNOW_LAYER, 3)[4]).toBeCloseTo(8 / 16);
    expect(blockDrops(B.SNOW_LAYER, toolOf({ id: I.WOOD_SHOVEL, count: 1 }), rng(1), 2)).toEqual([{ id: I.SNOWBALL, count: 3 }]);
    expect(blockDrops(B.SNOW_LAYER, toolOf(null), rng(1), 2)).toEqual([]);
  });

  it('cold biomes are generated with a snow cover', () => {
    const g = new TerrainGenerator(42);
    let found = 0;
    for (let cx = -20; cx < 20 && !found; cx++) for (let cz = -20; cz < 20 && !found; cz += 4) {
      const c = g.generate(cx, cz);
      if (!c.biomes.includes(BIOME.SNOWY_PLAINS) && !c.biomes.includes(BIOME.SNOWY_TAIGA)) continue;
      found = c.blocks.filter((b) => b === B.SNOW_LAYER).length;
    }
    expect(found).toBeGreaterThan(20);
  }, 60000);
});
