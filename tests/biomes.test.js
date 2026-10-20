import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '../src/world/generator.js';
import { BIOME, BIOMES } from '../src/world/biomes.js';
import { B } from '../src/world/blocks.js';
import { treeShape, LEAVES, LOGS, growTree } from '../src/world/trees.js';
import { Weather } from '../src/sky/weather.js';
import { spawnTable } from '../src/mobs/spawnRules.js';
import { CHUNK_VOLUME } from '../src/world/constants.js';
import { MockWorld, rng } from './helpers.js';

const gen = new TerrainGenerator(42);

/** A column well inside `biome` (its neighbours 24 blocks away share it), searched on a coarse grid. */
function findBiome(biome) {
  const at = (x, z) => { const c = gen.column(x, z); return gen.biomeFor(c, gen.surfaceAt(x, z, c)); };
  for (let r = 0; r <= 4000; r += 64) for (let x = -r; x <= r; x += 64) for (const z of [-r, r]) {
    for (const [px, pz] of [[x, z], [z, x]]) {
      if (at(px, pz) !== biome) continue;
      if ([[24, 0], [-24, 0], [0, 24], [0, -24]].every(([dx, dz]) => at(px + dx, pz + dz) === biome)) return [px, pz];
    }
  }
  return null;
}

/** Block counts over the 3x3 chunks around a world column. */
function census(x, z) {
  const counts = new Map(), biomes = new Set();
  const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const c = gen.generate(cx + dx, cz + dz);
    for (let i = 0; i < CHUNK_VOLUME; i++) { const b = c.blocks[i]; if (b) counts.set(b, (counts.get(b) || 0) + 1); }
    for (const b of c.biomes) biomes.add(b);
  }
  return { n: (id) => counts.get(id) || 0, biomes };
}

const EXPECT = {
  swamp: [BIOME.SWAMP, (c) => c.n(B.WATER) > 0 && c.n(B.OAK_LOG) > 0 && c.n(B.VINES) + c.n(B.LILY_PAD) > 0],
  jungle: [BIOME.JUNGLE, (c) => c.n(B.JUNGLE_LOG) > 100 && c.n(B.JUNGLE_LEAVES) > 1000],
  savanna: [BIOME.SAVANNA, (c) => c.n(B.ACACIA_LOG) > 0 && c.n(B.TALL_GRASS) > 100],
  badlands: [BIOME.BADLANDS, (c) => c.n(B.RED_SAND) > 0 && c.n(B.TERRACOTTA) > 100 && c.n(B.ORANGE_TERRACOTTA) + c.n(B.RED_TERRACOTTA) > 0],
  dark_forest: [BIOME.DARK_FOREST, (c) => c.n(B.DARK_OAK_LOG) > 50 && c.n(B.DARK_OAK_LEAVES) > 1000],
  mushroom_fields: [BIOME.MUSHROOM_FIELDS, (c) => c.n(B.MYCELIUM) > 100],
  snowy_taiga: [BIOME.SNOWY_TAIGA, (c) => c.n(B.SNOWY_GRASS) > 100 && c.n(B.SPRUCE_LOG) > 0],
  flower_forest: [BIOME.FLOWER_FOREST, (c) => c.n(B.ROSETTE) + c.n(B.SKYBELL) > 5],
};

describe('new biomes', () => {
  for (const [key, [biome, check]] of Object.entries(EXPECT)) {
    it(`${key} appears and has its blocks`, () => {
      const p = findBiome(biome);
      expect(p, `no ${key} found`).not.toBeNull();
      const c = census(p[0], p[1]);
      expect(c.biomes.has(biome)).toBe(true);
      expect(check(c)).toBe(true);
    }, 30000);
  }

  it('every biome has a unique key and id', () => {
    BIOMES.forEach((b, i) => expect(b.id).toBe(i));
    expect(new Set(BIOMES.map((b) => b.key)).size).toBe(BIOMES.length);
  });

  it('dry biomes get no rain, mushroom islands no monsters', () => {
    expect(Weather.precipitation(BIOME.SAVANNA)).toBe(null);
    expect(Weather.precipitation(BIOME.BADLANDS)).toBe(null);
    expect(Weather.precipitation(BIOME.SWAMP)).toBe('rain');
    expect(Weather.precipitation(BIOME.SNOWY_TAIGA)).toBe('snow');
    expect(spawnTable('monster', BIOME.MUSHROOM_FIELDS)).toHaveLength(0);
    expect(spawnTable('creature', BIOME.MUSHROOM_FIELDS)[0].type).toBe('mooxen');
  });
});

describe('new tree shapes', () => {
  const kinds = ['swamp_oak', 'jungle', 'jungle_big', 'jungle_bush', 'acacia', 'dark_oak'];
  it('leaves stay within 4 steps of a log so fresh trees never decay', () => {
    for (const kind of kinds) for (const r of [0, 0.3, 0.7, 0.99]) {
      const shape = treeShape(kind, r);
      const logs = shape.filter((e) => LOGS.has(e[3]));
      expect(logs.length).toBeGreaterThan(0);
      for (const e of shape) {
        if (!LEAVES.has(e[3])) continue;
        const d = Math.min(...logs.map((l) => Math.abs(l[0] - e[0]) + Math.abs(l[1] - e[1]) + Math.abs(l[2] - e[2])));
        expect(d).toBeLessThanOrEqual(4);
      }
    }
  });
  it('is deterministic and vines hang next to something', () => {
    const a = treeShape('jungle_big', 0.42), b = treeShape('jungle_big', 0.42);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const occ = new Set(a.map((e) => `${e[0]},${e[1]},${e[2]}`));
    const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [x, y, z, id, , m] of a) {
      if (id !== B.VINES) continue;
      const [sx, sz] = SIDES[m];
      expect(occ.has(`${x + sx},${y},${z + sz}`) || occ.has(`${x},${y + 1},${z}`)).toBe(true);
    }
  });
  it('a dark oak sapling grows a 2x2 trunk', () => {
    const w = new MockWorld(64);
    w.setBlock = (x, y, z, id, meta) => { w.set(x, y, z, id, meta); return true; };
    expect(growTree(w, 0, 64, 0, 'dark_oak', rng(3))).toBe(true);
    for (const [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]]) expect(w.getBlock(x, 66, z)).toBe(B.DARK_OAK_LOG);
  });
});
