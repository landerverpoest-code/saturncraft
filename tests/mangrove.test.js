import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '../src/world/generator.js';
import { BIOME, BIOMES } from '../src/world/biomes.js';
import { B, BLOCKS, WOOD_SETS, DOOR_SETS, GATE_SETS, STONE_SETS, WATERLOGGED, WATERLOGGED_FORM, DRY_FORM, PROPAGULE_HANGING } from '../src/world/blocks.js';
import { ITEMS, I } from '../src/world/items.js';
import { treeShape, growTree, LEAVES, LOGS, SAPLING_TREE, LEAF_SAPLING } from '../src/world/trees.js';
import { craft, SMELTING } from '../src/player/crafting.js';
import { collisionBoxes, SHAPED_COLLISION } from '../src/world/shapes.js';
import { SPAWN_TABLES, isNewtPoolFloor } from '../src/mobs/spawnRules.js';
import { stonecutterOutputs } from '../src/world/workstations.js';
import { CHUNK_VOLUME } from '../src/world/constants.js';
import { MockWorld, rng } from './helpers.js';

const S = (id) => (id == null ? null : { id, count: 1 });
const grid3 = (...ids) => ids.map(S);

describe('mangrove swamp biome', () => {
  const gen = new TerrainGenerator(42);
  const at = (g, x, z) => { const c = g.column(x, z); return g.biomeFor(c, g.surfaceAt(x, z, c)); };

  it('is registered with its own colours and spawns', () => {
    expect(BIOMES[BIOME.MANGROVE_SWAMP].key).toBe('mangrove_swamp');
    expect(BIOMES[BIOME.MANGROVE_SWAMP].foliage).toBeTruthy();
    expect(SPAWN_TABLES.creature.mangrove_swamp.some((e) => e.type === 'croaker')).toBe(true);
    expect(isNewtPoolFloor(B.MUD, true)).toBe(true);
    expect(isNewtPoolFloor(B.MUD, false)).toBe(false);
    expect(isNewtPoolFloor(B.CLAY, false)).toBe(true);
  });

  it('is placed deterministically on warm, wet lowland by the water', () => {
    const other = new TerrainGenerator(42);
    let found = null, n = 0;
    for (let x = -4000; x <= 4000 && !found; x += 64) for (let z = -4000; z <= 4000; z += 64) {
      const b = at(gen, x, z);
      expect(at(other, x, z)).toBe(b); // same seed, same biome
      if (b !== BIOME.MANGROVE_SWAMP) continue;
      n++;
      const c = gen.column(x, z);
      expect(c.temp).toBeGreaterThan(0.95);
      expect(gen.surfaceAt(x, z, c)).toBeLessThanOrEqual(66);
      if ([[24, 0], [-24, 0], [0, 24], [0, -24]].every(([dx, dz]) => at(gen, x + dx, z + dz) === b)) { found = [x, z]; break; }
    }
    expect(n).toBeGreaterThan(0);
    expect(found).not.toBeNull();
    // the chunk there: mud, water, mangroves with roots in the water and propagules hanging
    const cx = Math.floor(found[0] / 16), cz = Math.floor(found[1] / 16);
    const counts = new Map();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const c = gen.generate(cx + dx, cz + dz);
      expect(c.blocks).toEqual(other.generate(cx + dx, cz + dz).blocks);
      for (let i = 0; i < CHUNK_VOLUME; i++) counts.set(c.blocks[i], (counts.get(c.blocks[i]) || 0) + 1);
    }
    const k = (id) => counts.get(id) || 0;
    expect(k(B.MUD)).toBeGreaterThan(500);
    expect(k(B.WATER)).toBeGreaterThan(0);
    expect(k(B.MANGROVE_LOG)).toBeGreaterThan(20);
    expect(k(B.MANGROVE_LEAVES)).toBeGreaterThan(200);
    expect(k(B.MANGROVE_ROOTS) + k(B.WATERLOGGED_MANGROVE_ROOTS)).toBeGreaterThan(50);
    expect(k(B.MUDDY_MANGROVE_ROOTS)).toBeGreaterThan(0);
    expect(k(B.MANGROVE_PROPAGULE)).toBeGreaterThan(0);
  }, 60000);
});

describe('mangrove trees', () => {
  it('raise the trunk on roots that arch down into the mud, under a crown with propagules', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
      const s = treeShape('mangrove', r);
      expect(JSON.stringify(s)).toBe(JSON.stringify(treeShape('mangrove', r)));
      const logs = s.filter((e) => LOGS.has(e[3]));
      const trunkFoot = Math.min(...logs.filter((e) => !e[0] && !e[2]).map((e) => e[1]));
      expect(trunkFoot).toBeGreaterThanOrEqual(2); // stilts
      expect(s.some((e) => e[3] === B.MANGROVE_ROOTS && (e[0] || e[2]))).toBe(true); // prop roots out to the sides
      expect(s.filter((e) => e[3] === B.MUDDY_MANGROVE_ROOTS).every((e) => e[1] === -1)).toBe(true);
      for (const e of s) {
        if (!LEAVES.has(e[3])) continue;
        const d = Math.min(...logs.map((l) => Math.abs(l[0] - e[0]) + Math.abs(l[1] - e[1]) + Math.abs(l[2] - e[2])));
        expect(d).toBeLessThanOrEqual(4); // never decays
      }
      for (const e of s) if (e[3] === B.MANGROVE_PROPAGULE) {
        expect(e[5] & PROPAGULE_HANGING).toBeTruthy();
        expect(s.find((l) => l[0] === e[0] && l[1] === e[1] + 1 && l[2] === e[2])[3]).toBe(B.MANGROVE_LEAVES);
      }
    }
  });

  it('grow from a propagule planted in shallow water, roots standing in it', () => {
    const w = new MockWorld(64);
    w.setBlock = (x, y, z, id, meta) => { w.set(x, y, z, id, meta); return true; };
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) { w.set(x, 63, z, B.MUD); w.set(x, 64, z, B.WATER); }
    w.set(0, 64, 0, B.WATERLOGGED_MANGROVE_PROPAGULE);
    expect(SAPLING_TREE[B.WATERLOGGED_MANGROVE_PROPAGULE]).toBe('mangrove');
    expect(growTree(w, 0, 64, 0, 'mangrove', rng(5))).toBe(true);
    expect(w.getBlock(0, 64, 0)).toBe(B.WATERLOGGED_MANGROVE_ROOTS);
    expect(w.getBlock(0, 63, 0)).toBe(B.MUDDY_MANGROVE_ROOTS);
    let logs = 0;
    for (let y = 65; y < 80; y++) if (w.getBlock(0, y, 0) === B.MANGROVE_LOG) logs++;
    expect(logs).toBeGreaterThan(2);
  });
});

describe('mangrove and mud blocks', () => {
  it('waterlogged forms pair up and stand in water', () => {
    expect(WATERLOGGED_FORM[B.MANGROVE_ROOTS]).toBe(B.WATERLOGGED_MANGROVE_ROOTS);
    expect(DRY_FORM[B.WATERLOGGED_MANGROVE_PROPAGULE]).toBe(B.MANGROVE_PROPAGULE);
    expect(WATERLOGGED[B.WATERLOGGED_MANGROVE_ROOTS]).toBe(1);
    expect(BLOCKS[B.WATERLOGGED_MANGROVE_ROOTS].drops).toBe(B.MANGROVE_ROOTS);
    expect(BLOCKS[B.MANGROVE_ROOTS].opaque).toBe(false);
    expect(LEAF_SAPLING[B.MANGROVE_LEAVES]).toBe(B.MANGROVE_PROPAGULE);
  });
  it('mud lets you sink in a little', () => {
    expect(SHAPED_COLLISION[B.MUD]).toBe(1);
    expect(collisionBoxes(B.MUD, 0)[0][4]).toBeCloseTo(14 / 16);
    expect(BLOCKS[B.MUD].sound).toBe('mud');
  });
  it('recipes: planks, every wood recipe, packed mud and mud bricks', () => {
    expect(craft(grid3(B.MANGROVE_LOG, null, null, null), 2)).toEqual({ id: B.MANGROVE_PLANKS, count: 4 });
    const P = B.MANGROVE_PLANKS;
    expect(craft(grid3(P, null, P, P, P, P, null, null, null), 3)).toEqual({ id: I.OAK_BOAT, count: 1 });
    expect(craft(grid3(P, P, P, P, P, P), 2)).toEqual({ id: I.MANGROVE_DOOR, count: 3 });
    expect(ITEMS[I.MANGROVE_DOOR].doorBlock).toBe(B.MANGROVE_DOOR);
    expect(craft(grid3(P, P, P, P, P, P, null, null, null), 3)).toEqual({ id: B.MANGROVE_TRAPDOOR, count: 2 });
    expect(craft(grid3(P, P, P, P), 2)).toEqual({ id: B.WORKBENCH, count: 1 });
    expect(craft(grid3(P, null, P, null), 2)).toEqual({ id: I.STICK, count: 4 });
    expect(WOOD_SETS.some((s) => s[0] === P) && DOOR_SETS.some((s) => s[0] === P) && GATE_SETS.some((s) => s[0] === P)).toBe(true);
    expect(SMELTING[B.MANGROVE_LOG]).toBe(I.COAL);
    expect(ITEMS[P].fuel).toBe(300);
    expect(craft(grid3(B.MUD, I.WHEAT, null, null), 2)).toEqual({ id: B.PACKED_MUD, count: 1 });
    const M = B.PACKED_MUD;
    expect(craft(grid3(M, M, M, M), 2)).toEqual({ id: B.MUD_BRICKS, count: 4 });
    const K = B.MUD_BRICKS;
    expect(craft(grid3(K, K, K, null, null, null, null, null, null), 3)).toEqual({ id: B.MUD_BRICK_SLAB, count: 6 });
    expect(STONE_SETS.some((s) => s[0] === K)).toBe(true);
    expect(stonecutterOutputs(K).length).toBeGreaterThan(0);
  });
});
