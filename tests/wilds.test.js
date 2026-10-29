// Highland Meadows with Cascades, Wildflower Fields, Fungal Thickets, more tree kinds, Great Rifts
// and Magma Lakes. Everything is deterministic from the seed; the lakes and rifts are carved by
// functions of world position, so they must agree across chunk borders.
import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '../src/world/generator.js';
import { BIOME, BIOMES } from '../src/world/biomes.js';
import { B } from '../src/world/blocks.js';
import { CHUNK_VOLUME, MIN_Y, cidx } from '../src/world/constants.js';
import { spawnTable } from '../src/mobs/spawnRules.js';
import { treeShape, LEAVES, LOGS } from '../src/world/trees.js';
import { cascadeCourse, cascadeCells, stampCascades, isMeadow, CASCADE_MIN_DROP } from '../src/world/highlands.js';
import { treeKindFor, fieldFlower, FLOWERS, FIELD_BIOMES, THICKET_BIOMES } from '../src/world/ecology.js';
import { carveChunk, carveRifts, riftStarts, riftPaths, RIFT_CHANCE, clearCarvePaths } from '../src/world/carvers.js';
import { lakeIn, lakeDist, lakeFloor, domeHeight, isIsland, stampMagmaLakes, LAKE_REGION } from '../src/world/magmaLakes.js';

const gen = new TerrainGenerator(42);
const biomeAt = (g, x, z) => { const c = g.column(x, z); return g.biomeFor(c, g.surfaceAt(x, z, c)); };

/** [cx, cz, x, z] of chunks holding the sampled `biome` column (x, z), on a coarse grid around the origin, up to `n` of them. */
function chunksOf(g, biome, n, step = 32, R = 4000) {
  const out = [], seen = new Set();
  for (let x = -R; x <= R && out.length < n; x += step) for (let z = -R; z <= R && out.length < n; z += step) {
    if (biomeAt(g, x, z) !== biome) continue;
    const k = (x >> 4) + ',' + (z >> 4);
    if (!seen.has(k)) { seen.add(k); out.push([x >> 4, z >> 4, x, z]); }
  }
  return out;
}
const count = (chunk, id, meta) => { let n = 0; for (let i = 0; i < CHUNK_VOLUME; i++) if (chunk.blocks[i] === id && (meta === undefined || chunk.meta[i] === meta)) n++; return n; };

describe('Highland Meadow biome', () => {
  it('is appended to the biome table with its own spawn table and tints', () => {
    expect(BIOME.HIGHLAND_MEADOW).toBe(23);
    expect(BIOMES.length).toBe(24);
    BIOMES.forEach((b, i) => expect(b.id).toBe(i)); // ids are never renumbered
    expect(BIOMES[23].key).toBe('highland_meadow');
    expect(BIOMES[23].temp).toBeGreaterThan(0.15); // no snow
    const creatures = spawnTable('creature', BIOME.HIGHLAND_MEADOW).map((e) => e.type);
    expect(creatures).toContain('fleecer');
    expect(creatures).toContain('cragbuck');
    expect(spawnTable('monster', BIOME.HIGHLAND_MEADOW).length).toBeGreaterThan(0);
  });
  it('only appears on mild mountain flanks', () => {
    const cols = chunksOf(gen, BIOME.HIGHLAND_MEADOW, 12);
    expect(cols.length).toBeGreaterThanOrEqual(8);
    for (const [, , x, z] of cols) {
      const col = gen.column(x, z), top = gen.surfaceAt(x, z, col);
      expect(isMeadow(col, top)).toBe(true);
      expect(col.mountain).toBeGreaterThan(0.3);
      expect(top).toBeGreaterThan(105);
      expect(top).toBeLessThanOrEqual(140);
      expect(col.temp).toBeGreaterThanOrEqual(0.5);
    }
  });
  it('grows grass, flowers and few trees, and no snow', () => {
    let grass = 0, flowers = 0, snow = 0, trees = 0;
    for (const [cx, cz] of chunksOf(gen, BIOME.HIGHLAND_MEADOW, 8)) {
      const c = gen.generate(cx, cz);
      grass += count(c, B.GRASS);
      for (let i = 0; i < 256; i++) if (c.biomes[i] === BIOME.HIGHLAND_MEADOW && c.blocks[cidx(i & 15, c.heightmap[i], i >> 4)] === B.SNOW_LAYER) snow++;
      for (const f of FLOWERS) flowers += count(c, f);
      trees += count(c, B.SPRUCE_LOG) + count(c, B.OAK_LOG) + count(c, B.BIRCH_LOG);
    }
    expect(grass).toBeGreaterThan(300);
    expect(flowers).toBeGreaterThan(40);
    expect(snow).toBe(0);
    expect(trees).toBeLessThan(grass / 10); // pastures, not woods
  });
});

describe('Cascades', () => {
  // a made-up chunk: a stair of ground falling towards +x from the spring at (4, 8), ending in a hollow
  const stair = (tops) => {
    const hm = new Int16Array(256).fill(120);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) hm[x + z * 16] = x <= 4 ? 120 : tops[Math.min(x - 5, tops.length - 1)];
    return hm;
  };
  it('follows the lowest way down to a hollow and fills it with a spring, flowing and falling water', () => {
    const hm = stair([119, 116, 112, 108, 104, 104, 108]); // the ground rises again after the hollow
    const path = cascadeCourse(hm, 4, 8);
    expect(path).not.toBeNull();
    expect(path[0]).toEqual({ x: 4, z: 8, top: 120 });
    expect(path[path.length - 1].top).toBeLessThanOrEqual(104);
    const cells = cascadeCells(path);
    expect(cells[0]).toEqual([4, 120, 8, 0]); // the spring: a still source
    expect(cells.some((c) => c[3] === 8)).toBe(true); // falling water
    expect(cells.some((c) => c[3] === 1)).toBe(true); // flowing water
    // a column of water joins every step: the top cell of a column is at the height of the column before it
    for (let k = 1; k < path.length; k++) {
      const col = cells.filter((c) => c[0] === path[k].x && c[2] === path[k].z);
      expect(Math.max(...col.map((c) => c[1]))).toBe(path[k - 1].top);
      expect(Math.min(...col.map((c) => c[1]))).toBe(path[k].top + 1);
    }
  });
  it('needs a real drop, one way down for the water and room inside the chunk', () => {
    expect(cascadeCourse(new Int16Array(256).fill(100), 8, 8)).toBeNull(); // flat
    expect(cascadeCourse(stair([119, 118, 117]), 4, 8)).toBeNull(); // too gentle (drop 3)
    const pit = new Int16Array(256).fill(120); pit[3 + 8 * 16] = 110; pit[5 + 8 * 16] = 110;
    expect(cascadeCourse(pit, 4, 8)).toBeNull(); // two ways down: the spring would spill both ways
    const edge = new Int16Array(256); for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) edge[x + z * 16] = 130 - x * 3; // runs off the chunk
    expect(cascadeCourse(edge, 9, 8)).toBeNull();
    expect(CASCADE_MIN_DROP).toBeGreaterThanOrEqual(5);
  });
  it('stamps water into a meadow chunk and leaves other chunks alone', () => {
    const hm = stair([119, 116, 112, 108, 104, 104, 108]);
    const biomes = new Uint8Array(256).fill(BIOME.HIGHLAND_MEADOW), blocks = new Uint16Array(CHUNK_VOLUME), meta = new Uint8Array(CHUNK_VOLUME);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = MIN_Y; y <= hm[x + z * 16]; y++) blocks[cidx(x, y, z)] = B.STONE;
    const n = stampCascades(42, blocks, meta, biomes, hm, 0, 0);
    expect(n).toBeGreaterThan(5);
    let water = 0, source = 0;
    for (let i = 0; i < CHUNK_VOLUME; i++) if (blocks[i] === B.WATER) { water++; if (meta[i] === 0) source++; }
    expect(water).toBe(n);
    expect(source).toBe(1);
    const dry = new Uint8Array(CHUNK_VOLUME), none = new Uint8Array(256).fill(BIOME.PLAINS);
    expect(stampCascades(42, new Uint16Array(CHUNK_VOLUME), dry, none, hm, 0, 0)).toBe(0);
  });
  it('are found in generated meadows, with falling water, and generation is repeatable', () => {
    let withWater = 0, total = 0;
    for (const [cx, cz] of chunksOf(gen, BIOME.HIGHLAND_MEADOW, 40)) {
      const c = gen.generate(cx, cz);
      total++;
      if (count(c, B.WATER, 8) > 0 && count(c, B.WATER, 0) === 1) withWater++;
      if (total === 1) {
        const again = new TerrainGenerator(42).generate(cx, cz);
        expect(Buffer.from(again.blocks.buffer).equals(Buffer.from(c.blocks.buffer))).toBe(true);
        expect(Buffer.from(again.meta).equals(Buffer.from(c.meta))).toBe(true);
      }
    }
    expect(withWater).toBeGreaterThanOrEqual(3);
  }, 60000);
});

describe('Wildflower Fields and Fungal Thickets', () => {
  it('a field is dominated by one flower', () => {
    const kinds = new Map();
    for (let i = 0; i < 400; i++) {
      const f = fieldFlower(42, 100 + (i % 5), 200 + (i % 3), (i * 0.37) % 1, (i * 0.61) % 1);
      kinds.set(f, (kinds.get(f) || 0) + 1);
    }
    expect(Math.max(...kinds.values())).toBeGreaterThan(400 * 0.6);
    for (const f of kinds.keys()) expect(FLOWERS).toContain(f);
    // the dominant kind differs from cell to cell of the world
    const doms = new Set();
    for (let cx = 0; cx < 40; cx++) doms.add(fieldFlower(42, cx * 28, 0, 0, 0));
    expect(doms.size).toBeGreaterThan(1);
  });
  it('plains hold fields far denser in flowers than the open plains around them', () => {
    const cells = [];
    for (let cx = -30; cx < 30; cx++) for (let cz = -30; cz < 30; cz++) if (cx % 3 === 0 && cz % 3 === 0 && biomeAt(gen, cx * 16 + 8, cz * 16 + 8) === BIOME.PLAINS) cells.push([cx, cz]);
    expect(cells.length).toBeGreaterThan(5);
    let best = 0, worst = Infinity;
    for (const [cx, cz] of cells.slice(0, 40)) {
      const c = gen.generate(cx, cz);
      let fl = 0, grass = 0;
      for (const f of FLOWERS) fl += count(c, f);
      grass += count(c, B.GRASS);
      if (grass < 100) continue;
      const share = fl / grass;
      best = Math.max(best, share); worst = Math.min(worst, share);
    }
    expect(best).toBeGreaterThan(0.2);   // somewhere is a field
    expect(worst).toBeLessThan(0.1);     // and elsewhere it is ordinary plains
  }, 60000);
  it('thickets turn the floor to mycelium with small mushrooms and more giant ones', () => {
    let myc = 0, shrooms = 0, giants = 0;
    for (const biome of [BIOME.DARK_FOREST, BIOME.TAIGA]) {
      for (const [cx, cz] of chunksOf(gen, biome, 40, 48)) {
        const c = gen.generate(cx, cz);
        myc += count(c, B.MYCELIUM); shrooms += count(c, B.BROWN_MUSHROOM) + count(c, B.RED_MUSHROOM);
        giants += count(c, B.MUSHROOM_STEM);
      }
    }
    expect(myc).toBeGreaterThan(50);
    expect(shrooms).toBeGreaterThan(100);
    expect(giants).toBeGreaterThan(20);
    for (const b of FIELD_BIOMES) expect(BIOMES[b]).toBeTruthy();
    for (const b of THICKET_BIOMES) expect(BIOMES[b]).toBeTruthy();
  }, 120000);
});

describe('tree kinds', () => {
  const NEW = ['grand_oak', 'tall_birch', 'pine_tall', 'shrub'];
  it('new shapes are deterministic, rooted in logs, close to their trunk and leafy', () => {
    for (const kind of NEW) for (let r = 0; r < 1; r += 0.07) {
      const a = treeShape(kind, r), b = treeShape(kind, r);
      expect(a).toEqual(b);
      expect(a.length).toBeGreaterThan(8);
      expect(a.some((e) => LOGS.has(e[3]))).toBe(true);
      expect(a.some((e) => LEAVES.has(e[3]))).toBe(true);
      for (const e of a) { expect(Math.abs(e[0])).toBeLessThanOrEqual(5); expect(Math.abs(e[2])).toBeLessThanOrEqual(5); } // the generator reads a margin of 6
      // a log at the base of the trunk and no leaf without a log within 4 steps (so nothing decays)
      expect(a.some((e) => e[0] === 0 && e[1] === 0 && e[2] === 0 && LOGS.has(e[3]))).toBe(true);
      const logs = a.filter((e) => LOGS.has(e[3]));
      for (const e of a) if (LEAVES.has(e[3])) expect(logs.some((l) => Math.abs(l[0] - e[0]) + Math.abs(l[1] - e[1]) + Math.abs(l[2] - e[2]) <= 4)).toBe(true);
    }
  });
  it('grow taller than their plain relatives', () => {
    const h = (kind) => Math.max(...[0.1, 0.5, 0.9].map((r) => treeShape(kind, r).height));
    expect(h('grand_oak')).toBeGreaterThan(h('oak'));
    expect(h('tall_birch')).toBeGreaterThan(h('birch'));
    expect(h('pine_tall')).toBeGreaterThan(h('spruce'));
    expect(h('shrub')).toBeLessThan(h('oak'));
  });
  it('mix the new kinds into the right biomes and keep the old mix elsewhere', () => {
    const kinds = (biome, thicket = false) => new Set(Array.from({ length: 100 }, (_, i) => treeKindFor(biome, i / 100, thicket)));
    expect(kinds(BIOME.FOREST)).toContain('grand_oak');
    expect(kinds(BIOME.PLAINS)).toContain('shrub');
    expect(kinds(BIOME.BIRCH_FOREST)).toContain('tall_birch');
    expect(kinds(BIOME.TAIGA)).toContain('pine_tall');
    expect(kinds(BIOME.HIGHLAND_MEADOW)).toEqual(new Set(['spruce', 'shrub', 'birch']));
    expect(kinds(BIOME.JUNGLE)).toEqual(new Set(['jungle_big', 'jungle', 'jungle_bush']));
    expect(kinds(BIOME.MANGROVE_SWAMP)).toEqual(new Set(['mangrove']));
    expect(kinds(BIOME.SWAMP)).toEqual(new Set(['swamp_oak']));
    expect(kinds(BIOME.SWAMP, true)).toContain('brown_mushroom');
    expect(kinds(BIOME.DARK_FOREST, true)).toContain('red_mushroom');
    // giant mushrooms are a clear majority more common in a thicket
    const share = (b, t) => Array.from({ length: 100 }, (_, i) => treeKindFor(b, i / 100, t)).filter((k) => k.endsWith('mushroom')).length;
    expect(share(BIOME.DARK_FOREST, true)).toBeGreaterThan(share(BIOME.DARK_FOREST, false) * 3);
    for (const biome of BIOMES.map((b) => b.id)) for (const k of kinds(biome)) expect(treeShape(k, 0.5).length).toBeGreaterThan(0);
  });
});

describe('Great Rifts', () => {
  it('start rarely, deterministically and from their own random stream', () => {
    let n = 0;
    for (let sx = -40; sx < 40; sx++) for (let sz = -40; sz < 40; sz++) if (riftStarts(42, sx, sz)) n++;
    expect(n).toBeGreaterThan(6400 * RIFT_CHANCE * 0.4);
    expect(n).toBeLessThan(6400 * RIFT_CHANCE * 2.2);
    expect(riftStarts(42, -59, -27)).toBe(riftStarts(42, -59, -27));
    const [sx, sz] = [-59, -27];
    expect(riftStarts(42, sx, sz)).toBe(true);
    expect(riftPaths(42, sx, sz).length).toBeGreaterThan(70 * 7);
    expect(riftPaths(42, sx + 1, sz).length === 0 || riftStarts(42, sx + 1, sz)).toBe(true);
  });
  const solid = () => { const w = new Uint16Array(CHUNK_VOLUME); for (let y = MIN_Y; y < 140; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) w[cidx(x, y, z)] = y < MIN_Y + 5 ? B.BEDROCK : B.STONE; return w; };
  const surface = () => new Int16Array(256).fill(100);
  it('carve a deep, wide canyon through the chunks along their path, and nothing elsewhere', () => {
    const ops = riftPaths(42, -59, -27), mid = Math.floor(ops.length / 7 / 2) * 7;
    const cx = Math.floor(ops[mid] / 16), cz = Math.floor(ops[mid + 2] / 16);
    const b = solid(), carved = carveRifts(42, cx, cz, b, surface());
    expect(carved).toBeGreaterThan(3000);
    // tall: open air over more than 40 blocks in some column
    let tallest = 0;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) { let n = 0; for (let y = MIN_Y + 5; y < 140; y++) if (!b[cidx(x, y, z)]) n++; tallest = Math.max(tallest, n); }
    expect(tallest).toBeGreaterThan(40);
    expect(carveRifts(42, cx + 400, cz, solid(), surface())).toBe(0);
    // repeatable, cold or from the cache
    const b2 = solid(); carveRifts(42, cx, cz, b2, surface());
    expect(Buffer.from(b2.buffer).equals(Buffer.from(b.buffer))).toBe(true);
  });
  it('leave the ordinary tunnels and ravines exactly as they were', () => {
    clearCarvePaths();
    const a = solid(), b = solid();
    const n1 = carveChunk(42, -58, -29, a, surface());
    carveRifts(42, -58, -29, b, surface());
    const n2 = carveChunk(42, -58, -29, b, surface()); // carveChunk works on a chunk the rift pass already opened
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBeLessThanOrEqual(n1);
    // and the pass really is separate: carveChunk alone on a fresh chunk gives the same count as before
    expect(carveChunk(42, -58, -29, solid(), surface())).toBe(n1);
  });
  it('do not open the sea floor', () => {
    const ops = riftPaths(42, -59, -27), mid = Math.floor(ops.length / 7 / 2) * 7;
    const cx = Math.floor(ops[mid] / 16), cz = Math.floor(ops[mid + 2] / 16);
    const w = solid();
    const sea = new Int16Array(256).fill(50); // ocean floor at 50: the top 9 blocks stay shut
    carveRifts(42, cx, cz, w, sea);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 42; y < 50; y++) expect(w[cidx(x, y, z)]).not.toBe(0);
  });
});

describe('Magma Lakes', () => {
  // the first region with a lake near the origin
  const lakeRegion = () => { for (let r = 0; r < 10; r++) for (let rx = -r; rx <= r; rx++) for (let rz = -r; rz <= r; rz++) { const l = lakeIn(42, rx, rz); if (l) return { rx, rz, lake: l }; } return null; };
  it('are candidates of a region, well inside it and deep underground', () => {
    let n = 0;
    for (let rx = -10; rx < 10; rx++) for (let rz = -10; rz < 10; rz++) {
      const l = lakeIn(42, rx, rz);
      if (!l) continue;
      n++;
      expect(l.x - rx * LAKE_REGION).toBeGreaterThanOrEqual(40);
      expect(l.x - rx * LAKE_REGION + l.r * 1.25 + 4).toBeLessThan(LAKE_REGION);
      expect(l.x - rx * LAKE_REGION - l.r * 1.25 - 4).toBeGreaterThan(0);
      expect(l.z - rz * LAKE_REGION + l.r * 1.25 + 4).toBeLessThan(LAKE_REGION);
      expect(l.z - rz * LAKE_REGION - l.r * 1.25 - 4).toBeGreaterThan(0);
      expect(l.y).toBeGreaterThanOrEqual(-48); expect(l.y).toBeLessThanOrEqual(-13);
      expect(l.y + l.h).toBeLessThan(20);
    }
    expect(n).toBeGreaterThan(400 * 0.3);
    expect(n).toBeLessThan(400 * 0.6);
  });
  it('fill the cavern with lava to the lake level with basalt islands, and a sealed bed', () => {
    const { rx, rz, lake } = lakeRegion();
    let lava = 0, basalt = 0, air = 0;
    const cx0 = Math.floor((lake.x - lake.r) / 16), cx1 = Math.floor((lake.x + lake.r) / 16), cz0 = Math.floor((lake.z - lake.r) / 16), cz1 = Math.floor((lake.z + lake.r) / 16);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const blocks = new Uint16Array(CHUNK_VOLUME).fill(B.STONE), meta = new Uint8Array(CHUNK_VOLUME);
      lava += stampMagmaLakes(42, blocks, meta, cx, cz);
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const wx = cx * 16 + lx, wz = cz * 16 + lz, d = lakeDist(42, lake, wx, wz);
        if (d >= 1) continue;
        const f = lakeFloor(lake, d), island = isIsland(42, d, wx, wz);
        for (let y = f; y <= lake.y; y++) expect(blocks[cidx(lx, y, lz)]).toBe(island ? B.SMOOTH_BASALT : B.LAVA);
        expect(blocks[cidx(lx, lake.y + 2, lz)]).toBe(domeHeight(lake, d) >= 2 ? B.AIR : B.STONE);
        expect(blocks[cidx(lx, f - 1, lz)]).not.toBe(B.LAVA);
        for (let y = f; y <= lake.y + domeHeight(lake, d); y++) { const b = blocks[cidx(lx, y, lz)]; if (b === B.AIR) air++; else if (b === B.SMOOTH_BASALT) basalt++; }
      }
    }
    expect(lava).toBeGreaterThan(300);
    expect(air).toBeGreaterThan(lava);
    expect(rx * LAKE_REGION).toBeLessThanOrEqual(lake.x);
  });
  it('seal open caves at the shore so lava never touches air sideways, across chunk borders', () => {
    const { lake } = lakeRegion();
    // a world of air (one big cave) in a box around the lake: every lava cell must have lava,
    // basalt or stone beside it at its own height; only the cell above the lava may be air
    const cx0 = Math.floor((lake.x - lake.r - 8) / 16), cx1 = Math.floor((lake.x + lake.r + 8) / 16), cz0 = Math.floor((lake.z - lake.r - 8) / 16), cz1 = Math.floor((lake.z + lake.r + 8) / 16);
    const chunks = new Map();
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const blocks = new Uint16Array(CHUNK_VOLUME), meta = new Uint8Array(CHUNK_VOLUME);
      for (let y = MIN_Y + 1; y < 40; y++) for (let i = 0; i < 256; i++) blocks[cidx(i & 15, y, i >> 4)] = (y <= MIN_Y + 4 ? B.BEDROCK : B.AIR);
      stampMagmaLakes(42, blocks, meta, cx, cz);
      chunks.set(cx + ',' + cz, blocks);
    }
    const at = (x, y, z) => chunks.get((x >> 4) + ',' + (z >> 4))?.[cidx(x & 15, y, z & 15)];
    let checked = 0;
    for (let x = cx0 * 16 + 1; x < cx1 * 16 + 15; x++) for (let z = cz0 * 16 + 1; z < cz1 * 16 + 15; z++) for (let y = lake.y - 7; y <= lake.y; y++) {
      if (at(x, y, z) !== B.LAVA) continue;
      checked++;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = at(x + dx, y, z + dz);
        expect(n === B.LAVA || n === B.SMOOTH_BASALT).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
  it('make full chunks that are repeatable and cost nothing outside the lake', () => {
    const { lake } = lakeRegion();
    const cx = Math.floor(lake.x / 16), cz = Math.floor(lake.z / 16);
    const a = gen.generate(cx, cz), b = new TerrainGenerator(42).generate(cx, cz);
    expect(Buffer.from(a.blocks.buffer).equals(Buffer.from(b.blocks.buffer))).toBe(true);
    expect(count(a, B.LAVA)).toBeGreaterThan(100);
    const far = new Uint16Array(CHUNK_VOLUME), meta = new Uint8Array(CHUNK_VOLUME);
    expect(stampMagmaLakes(42, far, meta, cx + 20, cz)).toBe(0);
  }, 30000);
});
