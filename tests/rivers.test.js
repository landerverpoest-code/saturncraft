import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '../src/world/generator.js';
import { BIOME, BIOMES, waterTint } from '../src/world/biomes.js';
import { B } from '../src/world/blocks.js';
import { spawnTable } from '../src/mobs/spawnRules.js';
import { SEA_LEVEL, cidx } from '../src/world/constants.js';
import { villagesNear } from '../src/world/villages.js';
import { iglooInRegion, IGLOO_REGION } from '../src/world/igloos.js';
import { ruinInRegion, RUIN_REGION } from '../src/world/ruinedPortals.js';
import { hutInRegion, HUT_REGION } from '../src/world/swampHuts.js';
import { templesNear, outpostsNear } from '../src/world/temples.js';

const gen = new TerrainGenerator(42);
const biomeAt = (g, x, z) => { const c = g.column(x, z); return g.biomeFor(c, g.surfaceAt(x, z, c)); };
const isRiver = (b) => b === BIOME.RIVER || b === BIOME.FROZEN_RIVER;

/** First column of `biome` on a spiral-ish grid search around the origin. */
function find(g, biome, step = 8, R = 6000) {
  for (let r = 0; r <= R; r += step) for (let k = -r; k <= r; k += step) {
    for (const [x, z] of [[k, -r], [k, r], [-r, k], [r, k]]) if (biomeAt(g, x, z) === biome) return [x, z];
  }
  return null;
}

/** Census of the river columns of one generated chunk. */
function riverChunk(g, x, z) {
  const c = g.generate(Math.floor(x / 16), Math.floor(z / 16));
  const cols = [];
  for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    const b = c.biomes[lx + lz * 16];
    if (!isRiver(b)) continue;
    let bed = SEA_LEVEL;
    while (bed > SEA_LEVEL - 20) {
      const id = c.blocks[cidx(lx, bed, lz)];
      if (id !== B.WATER && id !== B.ICE && id !== B.SEAGRASS && id !== B.KELP) break;
      bed--;
    }
    cols.push({ biome: b, surface: c.blocks[cidx(lx, SEA_LEVEL, lz)], above: c.blocks[cidx(lx, SEA_LEVEL + 1, lz)], bed, bedBlock: c.blocks[cidx(lx, bed, lz)] });
  }
  return { chunk: c, cols };
}

describe('rivers', () => {
  it('have their own biomes with matching spawn tables and water colours', () => {
    expect(BIOMES[BIOME.RIVER].key).toBe('river');
    expect(BIOMES[BIOME.FROZEN_RIVER].key).toBe('frozen_river');
    expect(BIOMES[BIOME.FROZEN_RIVER].temp).toBeLessThan(0.15); // it snows there
    const shambler = (b) => spawnTable('monster', b).find((e) => e.type === 'sodden_shambler');
    expect(shambler(BIOME.RIVER).weight).toBe(100);
    expect(shambler(BIOME.FROZEN_RIVER).weight).toBe(1);
    expect(waterTint(BIOME.RIVER)).not.toEqual([255, 255, 255]);
    expect(waterTint(BIOME.OCEAN)).toEqual([255, 255, 255]);
  });

  it('are deterministic', () => {
    const p = find(gen, BIOME.RIVER);
    expect(p).not.toBeNull();
    const other = new TerrainGenerator(42);
    for (let d = -20; d <= 20; d += 5) {
      const a = gen.column(p[0] + d, p[1]), b = other.column(p[0] + d, p[1]);
      expect(b.height).toBe(a.height);
      expect(b.river).toBe(a.river);
    }
    const c1 = gen.generate(Math.floor(p[0] / 16), Math.floor(p[1] / 16)), c2 = other.generate(Math.floor(p[0] / 16), Math.floor(p[1] / 16));
    expect(Buffer.compare(Buffer.from(c1.blocks.buffer), Buffer.from(c2.blocks.buffer))).toBe(0);
    expect(Array.from(c1.biomes)).toEqual(Array.from(c2.biomes));
  }, 20000);

  it('wind across a sampled area as long, narrow channels', () => {
    let n = 0, river = 0;
    for (let x = -1024; x < 1024; x += 16) for (let z = -1024; z < 1024; z += 16) { n++; if (isRiver(biomeAt(gen, x, z))) river++; }
    expect(river / n).toBeGreaterThan(0.01);
    expect(river / n).toBeLessThan(0.1);
    // walking across a river along x and along z: one way is a short crossing,
    // the other follows the channel for a while
    const p = find(gen, BIOME.RIVER);
    const run = (dx, dz) => {
      let w = 1;
      for (const s of [-1, 1]) for (let k = 1; k < 80 && isRiver(biomeAt(gen, p[0] + dx * k * s, p[1] + dz * k * s)); k++) w++;
      return w;
    };
    const across = Math.min(run(1, 0), run(0, 1)), along = Math.max(run(1, 0), run(0, 1));
    expect(across).toBeLessThanOrEqual(20);
    expect(along).toBeGreaterThanOrEqual(5);
  }, 20000);

  it('are filled with water up to sea level over a sand, gravel or clay bed', () => {
    const p = find(gen, BIOME.RIVER);
    const { cols, chunk } = riverChunk(gen, p[0], p[1]);
    expect(cols.length).toBeGreaterThan(0);
    let deepest = 0;
    for (const c of cols) {
      expect(c.surface).toBe(c.bed === SEA_LEVEL ? c.surface : B.WATER);
      expect(c.above).not.toBe(B.WATER);
      if (c.bed < SEA_LEVEL) expect([B.SAND, B.GRAVEL, B.CLAY]).toContain(c.bedBlock);
      deepest = Math.max(deepest, SEA_LEVEL - c.bed);
    }
    expect(deepest).toBeGreaterThanOrEqual(2);
    expect(deepest).toBeLessThanOrEqual(7);
    // no water is ever placed above sea level
    for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) expect(chunk.blocks[cidx(lx, SEA_LEVEL + 1, lz)]).not.toBe(B.WATER);
  }, 20000);

  it('grow sugar cane on their banks and a little seagrass in the water', () => {
    let cane = 0, grass = 0, seen = 0;
    for (let x = -1024; x < 1024 && seen < 24; x += 32) for (let z = -1024; z < 1024 && seen < 24; z += 32) {
      if (biomeAt(gen, x, z) !== BIOME.RIVER) continue;
      seen++;
      const c = gen.generate(Math.floor(x / 16), Math.floor(z / 16));
      for (const id of c.blocks) { if (id === B.SUGAR_CANE) cane++; else if (id === B.SEAGRASS) grass++; }
    }
    expect(seen).toBeGreaterThan(5);
    expect(cane).toBeGreaterThan(0);
    expect(grass).toBeGreaterThan(0);
  }, 60000);

  it('freeze over where the land around them is snowy', () => {
    let p = null, g = gen;
    for (const seed of [42, 7, 1234, 99]) { g = new TerrainGenerator(seed); p = find(g, BIOME.FROZEN_RIVER, 16, 5000); if (p) break; }
    expect(p).not.toBeNull();
    expect(g.column(p[0], p[1]).temp).toBeLessThan(0.15);
    const { cols } = riverChunk(g, p[0], p[1]);
    const frozen = cols.filter((c) => c.biome === BIOME.FROZEN_RIVER && c.bed < SEA_LEVEL);
    expect(frozen.length).toBeGreaterThan(0);
    for (const c of frozen) expect(c.surface).toBe(B.ICE);
  }, 60000);

  it('stay out of the high mountains', () => {
    let peaks = 0;
    for (let x = -2048; x < 2048; x += 24) for (let z = -2048; z < 2048; z += 24) {
      const c = gen.column(x, z);
      if (c.mountain > 0.5) { peaks++; expect(c.river).toBe(0); }
    }
    expect(peaks).toBeGreaterThan(0);
  }, 30000);

  it('keep villages, temples, outposts, igloos, ruins and swamp huts off the water', () => {
    const riverIn = (g, x0, z0, x1, z1) => {
      for (let x = x0; x <= x1; x += 3) for (let z = z0; z <= z1; z += 3) if (isRiver(biomeAt(g, x, z))) return true;
      return false;
    };
    let checked = 0;
    for (const seed of [42, 7]) {
      const g = new TerrainGenerator(seed);
      for (const v of villagesNear(g, -3000, -3000, 3000, 3000)) {
        checked++;
        for (const p of v.pieces) expect(riverIn(g, p.x0, p.z0, p.x1, p.z1), `village piece at ${p.x0},${p.z0}`).toBe(false);
      }
      for (const t of templesNear(g, -3000, -3000, 3000, 3000)) { checked++; expect(riverIn(g, t.x0, t.z0, t.x1, t.z1)).toBe(false); }
      for (const o of outpostsNear(g, -3000, -3000, 3000, 3000)) { checked++; expect(riverIn(g, o.cx - 6, o.cz - 6, o.cx + 6, o.cz + 6)).toBe(false); }
      for (let rx = -8; rx < 8; rx++) for (let rz = -8; rz < 8; rz++) {
        for (const s of [iglooInRegion(g, rx, rz), hutInRegion(g, rx, rz)]) if (s) { checked++; expect(riverIn(g, s.x0, s.z0, s.x1, s.z1)).toBe(false); }
        const r = ruinInRegion(g, rx, rz);
        if (r) { checked++; expect(riverIn(g, r.cx - 4, r.cz - 4, r.cx + 4, r.cz + 4)).toBe(false); }
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(IGLOO_REGION + HUT_REGION + RUIN_REGION).toBeGreaterThan(0);
  }, 120000);

  it('never get the player spawn', () => {
    for (const seed of [42, 1, 2, 3, 7, 99, 1234, 31337]) {
      const g = new TerrainGenerator(seed);
      const s = g.findSpawn();
      const x = Math.floor(s.x), z = Math.floor(s.z);
      expect(isRiver(biomeAt(g, x, z))).toBe(false);
      expect(g.nearRiver(x, z, 6)).toBe(false);
      expect(s.y).toBeGreaterThan(SEA_LEVEL + 1);
    }
  }, 30000);
});
