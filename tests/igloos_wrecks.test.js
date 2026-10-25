import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '../src/world/generator.js';
import { iglooInRegion, igloosNear, buildIgloo, basementLayout, IGLOO_BIOMES, IGLOO_LOOT } from '../src/world/igloos.js';
import { wreckInRegion, wrecksNear, wreckPlan, WRECK_LOOT, WRECK_REACH } from '../src/world/shipwrecks.js';
import { templeInRegion, templesNear, outpostsNear } from '../src/world/temples.js';
import { villagesNear } from '../src/world/villages.js';
import { monumentsNear } from '../src/world/monuments.js';
import { ruinsNear } from '../src/world/ruinedPortals.js';
import { dungeonLoot, LOOT } from '../src/mobs/spawnerBlocks.js';
import { B } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { BIOME } from '../src/world/biomes.js';
import { cidx, SEA_LEVEL } from '../src/world/constants.js';
import { rng } from './helpers.js';

const SEED = 12345;
const gen = new TerrainGenerator(SEED);

function collect(find, g = gen, n = 6) {
  const out = [];
  for (let r = 0; r < 9 && out.length < n; r++) for (let rx = -r; rx <= r; rx++) for (let rz = -r; rz <= r; rz++) {
    if (Math.max(Math.abs(rx), Math.abs(rz)) !== r) continue;
    const s = find(g, rx, rz);
    if (s) out.push(s);
  }
  return out;
}

/** Block reader over generated chunks (generated on demand). */
function reader(g) {
  const chunks = new Map();
  return (x, y, z) => {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16), k = `${cx},${cz}`;
    if (!chunks.has(k)) chunks.set(k, g.generate(cx, cz));
    const c = chunks.get(k);
    return [c.blocks[cidx(x - cx * 16, y, z - cz * 16)], c.meta[cidx(x - cx * 16, y, z - cz * 16)]];
  };
}

const igloos = collect(iglooInRegion);
const wrecks = collect(wreckInRegion, gen, 10);

describe('igloo placement', () => {
  it('finds igloos, with and without basements', () => {
    const many = collect(iglooInRegion, gen, 12);
    expect(many.length).toBeGreaterThan(3);
    expect(many.some((g) => g.basement)).toBe(true);
    expect(many.some((g) => !g.basement)).toBe(true);
  });

  it('is deterministic from the seed', () => {
    const other = new TerrainGenerator(SEED);
    for (let rx = -4; rx <= 4; rx++) for (let rz = -4; rz <= 4; rz++) expect(iglooInRegion(other, rx, rz)).toEqual(iglooInRegion(gen, rx, rz));
  });

  it('only stands on dry snowy ground', () => {
    for (const g of igloos) {
      const col = gen.column(g.cx, g.cz), top = gen.surfaceAt(g.cx, g.cz, col);
      expect(IGLOO_BIOMES).toContain(gen.biomeFor(col, top));
      expect(top).toBeGreaterThan(SEA_LEVEL);
      expect(g.y).toBe(top + 1);
    }
  });

  it('keeps clear of villages, temples, outposts and ruined rifts', () => {
    for (const g of igloos) {
      const [x0, z0, x1, z1] = [g.x0 - 4, g.z0 - 4, g.x1 + 4, g.z1 + 4];
      expect(villagesNear(gen, x0, z0, x1, z1)).toEqual([]);
      expect(templesNear(gen, x0, z0, x1, z1)).toEqual([]);
      expect(outpostsNear(gen, x0, z0, x1, z1)).toEqual([]);
      expect(ruinsNear(gen, x0, z0, x1, z1)).toEqual([]);
      expect(wrecksNear(gen, x0, z0, x1, z1)).toEqual([]);
    }
  });

  it('temples no longer plan igloos of their own', () => {
    for (let rx = -5; rx <= 5; rx++) for (let rz = -5; rz <= 5; rz++) {
      const t = templeInRegion(gen, rx, rz);
      if (t) expect(['desert', 'jungle']).toContain(t.kind);
    }
  });

  it('is found by area queries', () => {
    const g = igloos[0];
    expect(igloosNear(gen, g.cx, g.cz, g.cx, g.cz)).toContainEqual(g);
    expect(igloosNear(gen, g.x1 + 2, g.z0, g.x1 + 30, g.z1)).not.toContainEqual(g);
  });
});

describe('igloo layout', () => {
  const plan = (g) => {
    const cells = new Map();
    buildIgloo(g, (x, y, z, id, m = 0) => cells.set(`${x},${y},${z}`, [id, m]));
    return cells;
  };
  const count = (cells, id) => [...cells.values()].filter(([b]) => b === id).length;
  const base = { cx: 8, cz: 8, y: 80, depth: 5, seed: 99 };

  it('has a bed, workbench, furnace and light under a snow dome with an entrance', () => {
    const c = plan({ ...base, basement: false });
    expect(count(c, B.BED)).toBe(2);
    expect(count(c, B.WORKBENCH)).toBe(1);
    expect(count(c, B.FURNACE)).toBe(1);
    expect(count(c, B.TORCH)).toBe(1);
    expect(count(c, B.SNOW_BLOCK)).toBeGreaterThan(100);
    expect(count(c, B.CHEST) + count(c, B.OAK_TRAPDOOR) + count(c, B.BREWING_STAND)).toBe(0);
    // the doorway: two air blocks through the dome wall on the -z side
    for (let z = base.cz - 6; z <= base.cz - 3; z++) for (const y of [base.y, base.y + 1]) expect(c.get(`${base.cx},${y},${z}`)[0]).toBe(B.AIR);
  });

  it('a basement adds a trapdoor, a ladder shaft, a chest, an alembic and a fenced cell', () => {
    const g = { ...base, basement: true }, c = plan(g), L = basementLayout(g);
    expect(c.get(`${L.hatch.x},${L.hatch.y},${L.hatch.z}`)[0]).toBe(B.OAK_TRAPDOOR);
    for (let y = L.bf; y < L.hatch.y; y++) {
      expect(c.get(`${L.hatch.x},${y},${L.hatch.z}`)[0]).toBe(B.LADDER);
      expect(c.get(`${L.hatch.x},${y},${L.hatch.z + 1}`)[0]).not.toBe(B.AIR); // the wall the ladder hangs on
    }
    const [chest, cm] = c.get(`${L.chest.x},${L.chest.y},${L.chest.z}`);
    expect(chest).toBe(B.CHEST);
    expect(cm & 8).toBe(8); expect((cm >> 4) & 15).toBe(IGLOO_LOOT);
    expect(c.get(`${L.brewing.x},${L.brewing.y},${L.brewing.z}`)[0]).toBe(B.BREWING_STAND);
    // the settler's cell is open space, fenced on its open sides
    expect(c.get(`${L.cell.x},${L.cell.y},${L.cell.z}`)[0]).toBe(B.AIR);
    expect(c.get(`${L.cell.x},${L.cell.y},${L.cell.z + 1}`)[0]).toBe(B.OAK_FENCE);
    expect(c.get(`${L.cell.x + 1},${L.cell.y},${L.cell.z}`)[0]).toBe(B.OAK_FENCE);
    expect(c.get(`${L.cell.x},${L.cell.y},${L.cell.z - 1}`)[0]).not.toBe(B.AIR);
  });

  it('is stamped whole across chunk borders in generated terrain', () => {
    const g = igloos.find((x) => x.basement) || igloos[0];
    const get = reader(gen);
    expect(Math.floor(g.x0 / 16) !== Math.floor(g.x1 / 16) || Math.floor(g.z0 / 16) !== Math.floor(g.z1 / 16)).toBe(true);
    for (const [k, [id, m]] of plan(g)) {
      const [x, y, z] = k.split(',').map(Number);
      expect(get(x, y, z)).toEqual([id, m]);
    }
  });
});

describe('shipwreck placement', () => {
  it('is deterministic from the seed', () => {
    const other = new TerrainGenerator(SEED);
    for (let rx = -4; rx <= 4; rx++) for (let rz = -4; rz <= 4; rz++) {
      const a = wreckInRegion(gen, rx, rz), b = wreckInRegion(other, rx, rz);
      expect(b).toEqual(a);
      if (a) expect(wreckPlan(b)).toEqual(wreckPlan(a));
    }
  });

  it('lies on the ocean floor or on a beach', () => {
    expect(wrecks.length).toBeGreaterThan(4);
    for (const w of wrecks) {
      const col = gen.column(w.cx, w.cz), top = gen.surfaceAt(w.cx, w.cz, col), biome = gen.biomeFor(col, top);
      if (w.beached) { expect(biome).toBe(BIOME.BEACH); expect(w.y).toBe(top); }
      else { expect([BIOME.OCEAN, BIOME.FROZEN_OCEAN]).toContain(biome); expect(w.y).toBe(top + 1); expect(top).toBeLessThan(SEA_LEVEL - 6); }
    }
    // some run aground
    const many = [];
    for (let rx = -8; rx <= 8; rx++) for (let rz = -8; rz <= 8; rz++) { const w = wreckInRegion(gen, rx, rz); if (w) many.push(w); }
    expect(many.some((w) => w.beached)).toBe(true);
    expect(many.some((w) => w.part !== 'full')).toBe(true);
    expect(many.some((w) => w.roll || w.pitch)).toBe(true);
  });

  it('keeps clear of Tide Citadels and villages', () => {
    for (const w of wrecks) {
      expect(monumentsNear(gen, w.x0, w.z0, w.x1, w.z1)).toEqual([]);
      expect(villagesNear(gen, w.x0, w.z0, w.x1, w.z1)).toEqual([]);
      expect(igloosNear(gen, w.x0, w.z0, w.x1, w.z1)).toEqual([]);
    }
  });
});

describe('shipwreck layout', () => {
  it('holds one to three chests of the right loot kinds, inside its reach', () => {
    for (const w of wrecks) {
      const p = wreckPlan(w);
      expect(p.chests.length).toBeGreaterThanOrEqual(1);
      expect(p.chests.length).toBeLessThanOrEqual(3);
      if (w.part === 'bow') expect(p.chests.map((c) => c.kind)).toEqual(['supply']);
      if (w.part === 'stern') expect(p.chests.map((c) => c.kind).sort()).toEqual(['map', 'treasure']);
      for (const [x, , z] of p.cells) { expect(Math.abs(x - w.cx)).toBeLessThanOrEqual(WRECK_REACH); expect(Math.abs(z - w.cz)).toBeLessThanOrEqual(WRECK_REACH); }
      const woods = p.cells.filter(([, , , id]) => id > 0 && id !== B.CHEST).length;
      expect(woods).toBeGreaterThan(40);
    }
  });

  it('every planned chest shows up in the generated chunks, across chunk borders', () => {
    const get = reader(gen);
    for (const w of wrecks.slice(0, 5)) {
      const p = wreckPlan(w);
      for (const c of p.chests) {
        const [id, m] = get(c.x, c.y, c.z);
        expect(id).toBe(B.CHEST);
        expect(m & 8).toBe(8);
        expect((m >> 4) & 15).toBe(WRECK_LOOT[c.kind]);
      }
      // the hull blocks land exactly as planned in whichever chunk they fall
      let same = 0, solid = 0;
      for (const [x, y, z, id] of p.cells) if (id > 0) { solid++; if (get(x, y, z)[0] === id) same++; }
      expect(same).toBe(solid);
    }
  });
});

describe('structure loot', () => {
  const roll = (kind, n = 40) => { const r = rng(5), out = []; for (let k = 0; k < n; k++) out.push(dungeonLoot(r, kind).filter(Boolean)); return out; };
  it('map rooms always hold an empty map; treasure always holds beryl', () => {
    for (const s of roll(LOOT.WRECK_MAP)) expect(s.some((x) => x.id === I.EMPTY_MAP)).toBe(true);
    for (const s of roll(LOOT.WRECK_TREASURE)) expect(s.some((x) => x.id === I.BERYL)).toBe(true);
    const metals = roll(LOOT.WRECK_TREASURE).flat().map((x) => x.id);
    expect(metals).toContain(I.IRON_INGOT); expect(metals).toContain(I.GOLD_NUGGET);
  });
  it('supply holds carry food; igloo basements always keep a Gilded Apple', () => {
    const food = roll(LOOT.WRECK).flat().map((x) => x.id);
    expect(food.some((id) => [I.WHEAT, I.CARROT, I.POTATO, I.BREAD, I.DRIED_KELP].includes(id))).toBe(true);
    for (const s of roll(LOOT.IGLOO)) expect(s.some((x) => x.id === I.GILDED_APPLE)).toBe(true);
    expect(WRECK_LOOT).toEqual({ supply: LOOT.WRECK, treasure: LOOT.WRECK_TREASURE, map: LOOT.WRECK_MAP });
    expect(IGLOO_LOOT).toBe(LOOT.IGLOO);
  });
});
