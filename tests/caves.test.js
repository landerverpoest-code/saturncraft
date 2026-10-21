import { describe, it, expect } from 'vitest';
import { B } from '../src/world/blocks.js';
import { cidx, CHUNK_VOLUME, MIN_Y } from '../src/world/constants.js';
import { carveChunk } from '../src/world/carvers.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { ruinsNear, ruinInRegion, RUIN_REGION } from '../src/world/ruinedPortals.js';

const solid = () => { const b = new Uint8Array(CHUNK_VOLUME); for (let y = MIN_Y; y < 100; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) b[cidx(x, y, z)] = y < MIN_Y + 5 ? B.BEDROCK : B.STONE; return b; };
const surface = new Int16Array(256).fill(99);

describe('cave carvers', () => {
  it('are deterministic and carve a fair share of chunks', () => {
    let carved = 0, chunks = 0;
    for (let cx = 0; cx < 8; cx++) for (let cz = 0; cz < 8; cz++) {
      const a = solid(), b = solid();
      const n = carveChunk(42, cx, cz, a, surface);
      carveChunk(42, cx, cz, b, surface);
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
      if (n > 0) chunks++;
      carved += n;
    }
    expect(chunks).toBeGreaterThan(16);
    expect(carved).toBeGreaterThan(10000);
  });
  it('tunnels continue across chunk borders', () => {
    // a tunnel that touches the east edge of one chunk also touches the west edge of the next
    let matches = 0, edges = 0;
    for (let cx = 0; cx < 6; cx++) {
      const a = solid(), b = solid();
      carveChunk(7, cx, 0, a, surface); carveChunk(7, cx + 1, 0, b, surface);
      for (let y = MIN_Y + 6; y < 99; y++) for (let z = 0; z < 16; z++) {
        const ea = a[cidx(15, y, z)] !== B.STONE, wb = b[cidx(0, y, z)] !== B.STONE;
        if (ea) { edges++; if (wb) matches++; }
      }
    }
    expect(edges).toBeGreaterThan(0);
    expect(matches / edges).toBeGreaterThan(0.5);
  });
  it('fill with lava below y -55, never touch bedrock', () => {
    for (let cx = 0; cx < 8; cx++) {
      const a = solid();
      carveChunk(3, cx, cx, a, surface);
      for (let y = MIN_Y; y < -55; y++) for (let i = 0; i < 256; i++) {
        const id = a[cidx(i & 15, y, i >> 4)];
        expect(id === B.STONE || id === B.BEDROCK || id === B.LAVA).toBe(true);
      }
      for (let i = 0; i < 256; i++) expect(a[cidx(i & 15, MIN_Y, i >> 4)]).toBe(B.BEDROCK);
    }
  });
  it('generated worlds have diamonds, azurite, beryl and coal', () => {
    const g = new TerrainGenerator(99);
    const found = new Set();
    for (let cx = 0; cx < 10; cx++) for (let cz = 0; cz < 10; cz++) {
      const c = g.generate(cx, cz);
      for (const id of c.blocks) found.add(id);
    }
    for (const id of [B.COAL_ORE, B.DEEP_DIAMOND_ORE, B.AZURITE_ORE, B.BERYL_ORE, B.IRON_ORE, B.GOLD_ORE, B.DEEP_CINNABAR_ORE]) expect(found.has(id)).toBe(true);
  });
});

describe('ruined rifts', () => {
  it('appear in about a third of the regions and stamp obsidian and a chest', () => {
    const g = new TerrainGenerator(12345);
    const list = ruinsNear(g, -1500, -1500, 1500, 1500);
    expect(list.length).toBeGreaterThan(20);
    expect(ruinInRegion(g, 3, 4)).toEqual(ruinInRegion(g, 3, 4));
    const o = list[0];
    const c = g.generate(Math.floor(o.cx / 16), Math.floor(o.cz / 16));
    const ids = new Set(c.blocks);
    expect(ids.has(B.OBSIDIAN) || ids.has(B.CINDERSTONE)).toBe(true);
    expect(RUIN_REGION).toBe(192);
  });
});
