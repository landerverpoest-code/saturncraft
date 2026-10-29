import { describe, it, expect } from 'vitest';
import { TerrainGenerator, ORE_FEATURES, sampleOreHeight } from '../src/world/generator.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { World } from '../src/world/world.js';
import { B } from '../src/world/blocks.js';
import { LOGS as TREE_LOGS, LEAVES as TREE_LEAVES } from '../src/world/trees.js';
import { CHUNK_VOLUME, cidx, MIN_Y, SEA_LEVEL } from '../src/world/constants.js';
import { explosionDamage, explosionBlocks } from '../src/entities/explosion.js';
import { rng } from './helpers.js';

const gen = new TerrainGenerator(12345);

describe('terrain generator', () => {
  it('is deterministic', () => {
    const a = gen.generate(3, -2), b = new TerrainGenerator(12345).generate(3, -2);
    expect(Buffer.from(a.blocks).equals(Buffer.from(b.blocks))).toBe(true);
  });
  it('has bedrock at the bottom and nothing below it', () => {
    const c = gen.generate(0, 0);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) expect(c.blocks[cidx(x, MIN_Y, z)]).toBe(B.BEDROCK);
  });
  it('fills oceans to sea level with water', () => {
    // find an ocean column
    let found = false;
    for (let cx = -20; cx < 20 && !found; cx++) {
      const c = gen.generate(cx * 5, 0);
      for (let i = 0; i < 256 && !found; i++) {
        if (c.biomes[i] === 0) {
          expect(c.blocks[cidx(i & 15, SEA_LEVEL, i >> 4)]).toBe(B.WATER);
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });
  it('tree canopies are continuous across chunk borders', () => {
    const LOGS = TREE_LOGS;
    const LEAVES = TREE_LEAVES;
    const g = new TerrainGenerator(777);
    // each chunk is the eastern neighbour of one pair and the west half of the next: generate it once
    // (generation is by far the cost of this test, which crawled towards its timeout on a loaded machine)
    const made = new Map();
    const chunk = (x, z) => { const k = x + ',' + z; if (!made.has(k)) made.set(k, g.generate(x, z)); return made.get(k); };
    let checked = 0;
    for (let cx = 0; cx < 30 && checked < 5; cx++) for (let cz = 0; cz < 4; cz++) {
      const a = chunk(cx, cz), b = chunk(cx + 1, cz);
      for (let z = 2; z < 14; z++) {
        // trunk at the eastern edge of chunk a
        let top = -1;
        for (let y = 60; y < 200; y++) if (LOGS.has(a.blocks[cidx(15, y, z)])) top = y;
        if (top < 0) continue;
        // its canopy must continue into chunk b (one block away)
        let leaves = 0;
        for (let dz = -1; dz <= 1; dz++) for (let y = top - 3; y <= top + 2; y++) if (LEAVES.has(b.blocks[cidx(0, y, z + dz)])) leaves++;
        expect(leaves).toBeGreaterThan(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 30000);
  it('places diamonds only deep underground and coal throughout', () => {
    let deepest = -1000, highest = -1000, coal = 0, diamonds = 0;
    for (let cx = 0; cx < 12; cx++) {
      const c = gen.generate(cx * 3, cx * 2);
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        const y = (i >> 8) + MIN_Y;
        const b = c.blocks[i];
        if (b === B.DIAMOND_ORE || b === B.DEEP_DIAMOND_ORE) { diamonds++; highest = Math.max(highest, y); }
        if (b === B.COAL_ORE || b === B.DEEP_COAL_ORE) coal++;
        deepest = Math.max(deepest, y);
      }
    }
    expect(diamonds).toBeGreaterThan(0);
    expect(highest).toBeLessThanOrEqual(16);
    expect(coal).toBeGreaterThan(diamonds);
  });
  it('triangle height distribution peaks in the middle of its range', () => {
    const f = ORE_FEATURES.find((o) => o.block === B.DIAMOND_ORE);
    const r = rng(2); let mid = 0, edge = 0;
    for (let i = 0; i < 20000; i++) {
      const y = sampleOreHeight(f, r);
      expect(y).toBeGreaterThanOrEqual(f.min); expect(y).toBeLessThanOrEqual(f.max);
      if (Math.abs(y - (f.min + f.max) / 2) < 20) mid++;
      if (y > f.max - 20) edge++;
    }
    expect(mid).toBeGreaterThan(edge * 3);
  });
  it('finds a dry spawn point', () => {
    const s = gen.findSpawn();
    expect(s.y).toBeGreaterThan(SEA_LEVEL);
  });
});

function flatChunk() {
  const blocks = new Uint8Array(CHUNK_VOLUME);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 64; y++) blocks[cidx(x, y, z)] = B.STONE;
  const light = new Uint8Array(CHUNK_VOLUME);
  computeChunkLight(blocks, light);
  const heightmap = new Int16Array(256).fill(63);
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap };
}
function flatWorld(r = 1) {
  const w = new World(1);
  for (let cx = -r; cx <= r; cx++) for (let cz = -r; cz <= r; cz++) w.addChunk(cx, cz, flatChunk());
  return w;
}

describe('lighting', () => {
  it('open sky is 15 and stone is dark', () => {
    const w = flatWorld(0);
    expect(w.skyLight(3, 64, 3)).toBe(15);
    expect(w.skyLight(3, 40, 3)).toBe(0);
  });
  it('a torch lights 14 at its block and fades by one per block', () => {
    const w = flatWorld(1);
    w.setBlock(0, 64, 0, B.TORCH);
    expect(w.blockLight(0, 64, 0)).toBe(14);
    expect(w.blockLight(3, 64, 0)).toBe(11);
    expect(w.blockLight(0, 64, 5)).toBe(9);
    w.setBlock(0, 64, 0, B.AIR);
    expect(w.blockLight(3, 64, 0)).toBe(0);
  });
  it('roofs block sky light and light spreads under overhangs', () => {
    const w = flatWorld(1);
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) w.setBlock(x, 67, z, B.STONE);
    expect(w.skyLight(0, 64, 0)).toBeLessThan(15);
    expect(w.skyLight(4, 64, 0)).toBe(14);
    expect(w.skyLight(0, 64, 0)).toBe(10);
  });
  it('light crosses chunk borders', () => {
    const w = flatWorld(1);
    w.setBlock(15, 64, 3, B.TORCH);
    expect(w.blockLight(16, 64, 3)).toBe(13);
    expect(w.blockLight(18, 64, 3)).toBe(11);
  });
});

describe('fluids and gravity', () => {
  it('water spreads 7 blocks on flat ground', () => {
    const w = flatWorld(1);
    w.setBlock(0, 64, 0, B.WATER, 0);
    for (let i = 0; i < 200; i++) w.tick();
    expect(w.getBlock(7, 64, 0)).toBe(B.WATER);
    expect(w.getMeta(7, 64, 0)).toBe(7);
    expect(w.getBlock(8, 64, 0)).toBe(B.AIR);
  });
  it('lava spreads 3 blocks and flows slower', () => {
    const w = flatWorld(1);
    w.setBlock(0, 64, 0, B.LAVA, 0);
    for (let i = 0; i < 40; i++) w.tick();
    expect(w.getBlock(1, 64, 0)).toBe(B.LAVA);
    expect(w.getBlock(2, 64, 0)).toBe(B.AIR);
    for (let i = 0; i < 300; i++) w.tick();
    expect(w.getBlock(3, 64, 0)).toBe(B.LAVA);
    expect(w.getBlock(4, 64, 0)).toBe(B.AIR);
  });
  it('two adjacent sources create an infinite source', () => {
    const w = flatWorld(1);
    w.setBlock(0, 64, 0, B.WATER, 0);
    w.setBlock(2, 64, 0, B.WATER, 0);
    for (let i = 0; i < 100; i++) w.tick();
    expect(w.getMeta(1, 64, 0)).toBe(0);
  });
  it('water meeting a lava source makes obsidian', () => {
    const w = flatWorld(1);
    w.setBlock(3, 64, 0, B.LAVA, 0);
    w.setBlock(0, 64, 0, B.WATER, 0);
    for (let i = 0; i < 200; i++) w.tick();
    expect(w.getBlock(3, 64, 0)).toBe(B.OBSIDIAN);
  });
  it('sand falls when unsupported', () => {
    const w = flatWorld(1);
    const falling = [];
    w.on('fallingBlock', (x, y, z, id) => falling.push([x, y, z, id]));
    w.setBlock(2, 70, 2, B.SAND);
    for (let i = 0; i < 5; i++) w.tick();
    expect(falling).toEqual([[2, 70, 2, B.SAND]]);
    expect(w.getBlock(2, 70, 2)).toBe(B.AIR);
  });
});

describe('explosions', () => {
  it('point-blank damage of a power-3 blast is 43', () => {
    expect(explosionDamage(3, 0, 1)).toBe(43);
    expect(explosionDamage(3, 1, 1)).toBe(1);
  });
  it('destroys soft blocks but not obsidian or bedrock', () => {
    const solid = (x, y, z) => (y < 0 ? B.DIRT : B.AIR);
    const out = explosionBlocks(solid, 0.5, 0.5, 0.5, 3, rng(1));
    expect(out.length).toBeGreaterThan(5);
    const hard = (x, y, z) => (y < 0 ? B.OBSIDIAN : B.AIR);
    expect(explosionBlocks(hard, 0.5, 0.5, 0.5, 3, rng(1)).length).toBe(0);
  });
});

describe('save format', () => {
  it('run-length encoding round-trips chunk arrays', async () => {
    const { rleEncode, rleDecode } = await import('../src/world/save.js');
    const c = gen.generate(1, 1);
    const enc = rleEncode(c.blocks);
    expect(enc.length).toBeLessThan(c.blocks.length / 4);
    expect(Buffer.from(rleDecode(enc, c.blocks.length)).equals(Buffer.from(c.blocks))).toBe(true);
  });
});
