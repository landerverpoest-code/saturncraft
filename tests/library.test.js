// Buried Libraries (world/buriedLibrary.js): planning from the seed, depth bounds, the hall footprint, chests and the loot table.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TerrainGenerator } from '../src/world/generator.js';
import {
  libraryInRegion, librariesNear, nearestLibrary, libraryBlock, libraryChests, libraryGuards, libraryLootKind, libraryCeiling,
  LIBRARY_HALF, LIBRARY_MIN_Y, LIBRARY_MAX_Y, LIBRARY_LOOT, LIBRARY_CHEST_KIND, LIBRARY_CHESTS,
} from '../src/world/buriedLibrary.js';
import { landmarksInBox, nearestLandmark } from '../src/world/landmarks.js';
import { LANDMARK_BY_KEY } from '../src/world/landmarkKinds.js';
import { FEATURES, CURRENT_FEATURE_VERSION } from '../src/world/retrofit.js';
import { dungeonLoot, LOOT, STRUCTURE_LOOT } from '../src/mobs/spawnerBlocks.js';
import { MILESTONES } from '../src/player/milestones.js';
import { runCommand, HELP } from '../src/ui/commands.js';
import nl from '../src/ui/lang/nl_ui.js';
import { B } from '../src/world/blocks.js';
import { BIOME } from '../src/world/biomes.js';
import { SEA_LEVEL, cidx } from '../src/world/constants.js';

const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const gen = new TerrainGenerator(12345);
const found = [];
for (let r = 0; r <= 6 && found.length < 4; r++) for (let rx = -r; rx <= r; rx++) for (let rz = -r; rz <= r; rz++) {
  if (Math.max(Math.abs(rx), Math.abs(rz)) !== r) continue;
  const s = libraryInRegion(gen, rx, rz);
  if (s) found.push(s);
}
const s = found[0];

describe('Buried Library planning', () => {
  it('appears in a fair share of regions, deterministically', () => {
    expect(found.length).toBeGreaterThanOrEqual(3);
    const other = new TerrainGenerator(12345);
    for (const f of found) expect(libraryInRegion(other, Math.floor(f.cx / 400), Math.floor(f.cz / 400))).toEqual(f);
  });
  it('lies at a bounded depth under land, never under the sea', () => {
    for (const f of found) {
      expect(f.y).toBeGreaterThanOrEqual(LIBRARY_MIN_Y);
      expect(f.y).toBeLessThanOrEqual(LIBRARY_MAX_Y);
      const col = gen.column(f.cx, f.cz), top = gen.surfaceAt(f.cx, f.cz, col);
      expect(top - f.y).toBeGreaterThanOrEqual(14);
      expect(top).toBeGreaterThanOrEqual(SEA_LEVEL + 5);
      expect([BIOME.OCEAN, BIOME.DEEP_OCEAN, BIOME.FROZEN_OCEAN, BIOME.BEACH, BIOME.RIVER]).not.toContain(gen.biomeFor(col, top));
      expect(f.capH).toBeGreaterThan(13);
      expect(f.x1 - f.x0).toBeGreaterThanOrEqual(2 * LIBRARY_HALF);
    }
  });
  it('is found by the nearest search', () => {
    for (const f of found) {
      expect(librariesNear(gen, f.cx, f.cz, f.cx, f.cz)).toContainEqual(f);
      expect(nearestLibrary(gen, f.cx, f.cz)).toEqual(f);
    }
  });
});

describe('Buried Library geometry', () => {
  it('has a 21 x 15 hall with a vaulted ceiling, shelves, a lectern and a spawner', () => {
    expect(libraryCeiling(0)).toBeGreaterThan(libraryCeiling(6));
    const count = {};
    let floor = 0;
    for (let h = 0; h <= 10; h++) for (let u = -10; u <= 10; u++) for (let v = -7; v <= 7; v++) {
      const id = libraryBlock(s, u, h, v)?.[0];
      count[id] = (count[id] || 0) + 1;
      if (h === 0 && id !== B.AIR) floor++;
    }
    expect(floor).toBe(21 * 15);
    expect(count[B.RECORD_SHELF]).toBeGreaterThan(5);
    expect(count[B.BOOKSHELF]).toBeGreaterThan(20);
    expect(count[B.LECTERN]).toBe(1);
    expect(count[B.SPAWNER]).toBe(1);
    expect(count[B.COBWEB]).toBeGreaterThan(0);
    expect(count[B.LANTERN]).toBe(2);
    expect(libraryBlock(s, 0, 1, 3)[0]).toBe(B.AIR);
  });
  it('keeps every block inside the footprint and closes the shaft with a mossy cap', () => {
    for (let h = 0; h <= s.capH + 3; h++) for (let u = -LIBRARY_HALF - 2; u <= LIBRARY_HALF + 2; u++) for (let v = -14; v <= 14; v++) {
      const bl = libraryBlock(s, u, h, v);
      if (bl) expect(Math.abs(u) <= LIBRARY_HALF && Math.abs(v) <= 12).toBe(true);
    }
    expect(libraryBlock(s, 13, s.capH, 0)[0]).toBe(B.MOSSY_COBBLESTONE);
    expect(libraryBlock(s, 13, s.capH + 1, 0)).toBeNull();
    expect(libraryBlock(s, 12, 1, 0)[0]).toBe(B.AIR);
    expect(libraryBlock(s, 11, 1, 0)[0]).toBe(B.AIR); // the doorway
  });
  it('has a trap pocket of lava behind each west shelf panel', () => {
    for (const tv of [4, -4]) {
      expect(libraryBlock(s, -10, 1, tv)[0]).toBe(B.BOOKSHELF);
      expect(libraryBlock(s, -11, 1, tv)[0]).toBe(B.AIR);
      expect(libraryBlock(s, -11, 3, tv)[0]).toBe(B.LAVA);
    }
  });
  it('is stamped into a chunk with the reading table standing', () => {
    const cx = Math.floor(s.cx / 16), cz = Math.floor(s.cz / 16);
    const c = gen.generate(cx, cz);
    expect(c.blocks[cidx(s.cx - cx * 16, s.y + 1, s.cz - cz * 16)]).toBe(B.SPRUCE_PLANKS);
  });
});

describe('Buried Library chests, guards and loot', () => {
  it('places six chests and three Shamblers', () => {
    const chests = libraryChests(s);
    expect(chests).toHaveLength(LIBRARY_CHESTS.length);
    for (const c of chests) expect(c.kind).toBe(LIBRARY_CHEST_KIND);
    const g = libraryGuards(s);
    expect(g).toHaveLength(3);
    for (const m of g) expect(m.type).toBe('shambler');
  });
  it('rolls the library table inside a library and the old kind elsewhere', () => {
    const c = libraryChests(s)[0];
    expect(libraryLootKind(gen, c.x, c.z, LIBRARY_CHEST_KIND)).toBe(LIBRARY_LOOT);
    expect(libraryLootKind(gen, c.x + 60, c.z + 60, LIBRARY_CHEST_KIND)).toBe(LIBRARY_CHEST_KIND);
    expect(libraryLootKind(gen, c.x, c.z, 7)).toBe(7);
  });
  it('has a valid loot table', () => {
    expect(LOOT.LIBRARY).toBe(LIBRARY_LOOT);
    const [table, a, b, always] = STRUCTURE_LOOT[LIBRARY_LOOT];
    expect(b).toBeGreaterThanOrEqual(a);
    for (const [id, min, max, weight = 1] of [...table, ...always]) {
      expect(id, 'item id').toBeGreaterThan(0);
      expect(min).toBeGreaterThanOrEqual(1);
      expect(max).toBeGreaterThanOrEqual(min);
      expect(weight).toBeGreaterThan(0);
    }
    for (let k = 0; k < 20; k++) expect(dungeonLoot(Math.random, LIBRARY_LOOT).filter(Boolean).length).toBeGreaterThanOrEqual(a);
  });
});

describe('Buried Library wiring', () => {
  it('is a retrofit feature, a generator pass, a landmark kind and a milestone', () => {
    expect(FEATURES.find((f) => f.key === 'library')).toMatchObject({ since: 10 });
    expect(CURRENT_FEATURE_VERSION).toBeGreaterThanOrEqual(10);
    expect(src('src/world/generator.js')).toContain("this.pass('library'");
    expect(LANDMARK_BY_KEY.library.name).toBe('Buried Library');
    expect(landmarksInBox(gen, s.cx - 5, s.cz - 5, s.cx + 5, s.cz + 5).some((l) => l.kind === 'library')).toBe(true);
    expect(nearestLandmark(gen, 'library', s.cx, s.cz).x).toBe(s.cx);
    const m = MILESTONES.find((x) => x.id === 'library');
    expect(m.title).toBe('Quiet Please');
    const at = (x, y, z) => ({ world: { dimension: 'overworld', gen }, player: { x, y, z } });
    expect(m.tick(at(s.cx + 0.5, s.y + 1, s.cz + 0.5))).toBe(true);
    expect(m.tick(at(s.cx + 0.5, s.y + 40, s.cz + 0.5))).toBe(false);
    expect(nl['Quiet Please']).toBeTruthy();
  });
  it('can be located and keeps the sources tidy', () => {
    expect(HELP.join('\n')).toMatch(/\|library\|/);
    const game = { world: { dimension: 'overworld', gen }, player: { x: s.cx + 30, y: 70, z: s.cz } };
    expect(String(runCommand(game, '/locate library'))).toMatch(/Buried Library/);
    expect(src('src/world/buriedLibrary.js')).not.toMatch(/minecraft|nether|redstone|tripwire/i);
  });
});
