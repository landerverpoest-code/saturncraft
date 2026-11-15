// Beacon Lighthouses (world/beaconHouse.js): planning from the seed, the shore footprint, the tapering tower, the chests and loot table.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TerrainGenerator } from '../src/world/generator.js';
import {
  beaconInRegion, beaconsNear, nearestBeacon, beaconBlock, beaconChests, beaconKeepers, beaconRadius, beaconLootKind,
  BEACON_HALF, BEACON_TOP, BEACON_LOOT, BEACON_CHEST_KIND, BEACON_CHESTS,
} from '../src/world/beaconHouse.js';
import { lighthousesNear } from '../src/world/lighthouse.js';
import { boxesOverlap } from '../src/world/siteKit.js';
import { landmarksInBox, nearestLandmark } from '../src/world/landmarks.js';
import { LANDMARK_BY_KEY } from '../src/world/landmarkKinds.js';
import { FEATURES } from '../src/world/retrofit.js';
import { dungeonLoot, LOOT, STRUCTURE_LOOT } from '../src/mobs/spawnerBlocks.js';
import { MILESTONES } from '../src/player/milestones.js';
import { runCommand, HELP } from '../src/ui/commands.js';
import { B } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { BIOME } from '../src/world/biomes.js';
import { SEA_LEVEL, cidx } from '../src/world/constants.js';

const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const gen = new TerrainGenerator(12345);
const found = [];
for (let r = 0; r <= 8 && found.length < 4; r++) for (let rx = -r; rx <= r; rx++) for (let rz = -r; rz <= r; rz++) {
  if (Math.max(Math.abs(rx), Math.abs(rz)) !== r) continue;
  const s = beaconInRegion(gen, rx, rz);
  if (s) found.push(s);
}
const s = found[0];

describe('Beacon Lighthouse planning', () => {
  it('finds lighthouses in a fair share of regions, deterministically', () => {
    expect(found.length).toBeGreaterThanOrEqual(3);
    const other = new TerrainGenerator(12345);
    for (const f of found) expect(beaconInRegion(other, Math.floor(f.cx / 480), Math.floor(f.cz / 480))).toEqual(f);
  });
  it('stands on a beach shore with sea beside it, the platform above the water', () => {
    for (const f of found) {
      const col = gen.column(f.cx, f.cz), top = gen.surfaceAt(f.cx, f.cz, col);
      expect(gen.biomeFor(col, top)).toBe(BIOME.BEACH);
      expect(f.y).toBeGreaterThan(SEA_LEVEL);
      expect(f.y).toBeLessThanOrEqual(SEA_LEVEL + 4);
      let wet = 0;
      for (let a = 0; a < 8; a++) {
        const x = f.cx + Math.round(Math.cos(a * Math.PI / 4)) * 12, z = f.cz + Math.round(Math.sin(a * Math.PI / 4)) * 12;
        if (gen.surfaceAt(x, z, gen.column(x, z)) < SEA_LEVEL) wet++;
      }
      expect(wet).toBeGreaterThanOrEqual(2);
      expect(f.x1 - f.x0).toBeGreaterThanOrEqual(2 * BEACON_HALF);
    }
  });
  it("keeps clear of the Hermit's Lighthouses and is found by the nearest search", () => {
    for (const f of found) {
      for (const l of lighthousesNear(gen, f.x0 - 8, f.z0 - 8, f.x1 + 8, f.z1 + 8)) expect(boxesOverlap(f, l, 6)).toBe(false);
      expect(beaconsNear(gen, f.cx, f.cz, f.cx, f.cz)).toContainEqual(f);
      expect(nearestBeacon(gen, f.cx, f.cz)).toEqual(f);
    }
  });
});

describe('Beacon Lighthouse geometry', () => {
  it('is 25 to 30 blocks tall and tapers', () => {
    let top = 0;
    for (let h = 0; h <= 40; h++) for (let u = -BEACON_HALF; u <= BEACON_HALF; u++) for (let v = -BEACON_HALF; v <= BEACON_HALF; v++) {
      const b = beaconBlock(s, u, h, v);
      if (b && b[0] !== B.AIR) top = Math.max(top, h);
    }
    expect(top).toBe(BEACON_TOP);
    expect(top).toBeGreaterThanOrEqual(25);
    expect(top).toBeLessThanOrEqual(30);
    expect(beaconRadius(1)).toBeGreaterThan(beaconRadius(21));
    const reach = (h) => { let m = 0; for (let u = 0; u <= 8; u++) { const b = beaconBlock(s, u, h, 0); if (b && b[0] !== B.AIR && b[0] !== B.LADDER) m = u; } return m; };
    expect(reach(2)).toBeGreaterThan(reach(20));
  });
  it('has a door, a ladder through three landings and a glass lamp room with a lens', () => {
    expect(beaconBlock(s, 0, 1, 4)[0]).toBe(B.AIR); // the door cell is open
    expect(beaconBlock(s, 0, 1, -5)[0]).not.toBe(B.AIR);
    for (let h = 1; h <= 22; h++) expect(beaconBlock(s, 0, h, -2)[0]).toBe(B.LADDER);
    for (const f of [7, 14, 21]) expect(beaconBlock(s, 1, f, 0)[0]).toBe(B.SPRUCE_PLANKS);
    let glass = 0, lens = 0, lantern = 0;
    for (let h = 22; h <= 25; h++) for (let u = -4; u <= 4; u++) for (let v = -4; v <= 4; v++) {
      const id = beaconBlock(s, u, h, v)?.[0];
      if (id === B.GLASS) glass++;
      if (id === B.LIGHTHOUSE_LENS) lens++;
      if (id === B.LANTERN) lantern++;
    }
    expect(glass).toBeGreaterThan(20);
    expect(lens).toBe(2);
    expect(lantern).toBe(1);
  });
  it("has a keeper's hut with a bed, furnace, barrel and chest", () => {
    const ids = new Set();
    for (let h = 0; h <= 7; h++) for (let u = -4; u <= 4; u++) for (let v = 7; v <= 14; v++) ids.add(beaconBlock(s, u, h, v)?.[0]);
    for (const b of [B.BED, B.FURNACE, B.BARREL, B.CHEST]) expect(ids.has(b), String(b)).toBe(true);
  });
  it('is stamped into a chunk with its lamp standing', () => {
    const cx = Math.floor(s.cx / 16), cz = Math.floor(s.cz / 16);
    const c = gen.generate(cx, cz);
    expect(c.blocks[cidx(s.cx - cx * 16, s.y + 23, s.cz - cz * 16)]).toBe(B.LIGHTHOUSE_LENS);
  });
});

describe('Beacon Lighthouse chests, keepers and loot', () => {
  it('places four chests and two keepers', () => {
    const chests = beaconChests(s);
    expect(chests).toHaveLength(BEACON_CHESTS.length);
    for (const c of chests) expect(c.kind).toBe(BEACON_CHEST_KIND);
    expect(beaconKeepers(s)).toHaveLength(2);
  });
  it('rolls the lighthouse table for chests inside a lighthouse and the old kind elsewhere', () => {
    const c = beaconChests(s)[0];
    expect(beaconLootKind(gen, c.x, c.z, BEACON_CHEST_KIND)).toBe(BEACON_LOOT);
    expect(beaconLootKind(gen, c.x + 40, c.z + 40, BEACON_CHEST_KIND)).toBe(BEACON_CHEST_KIND);
    expect(beaconLootKind(gen, c.x, c.z, 7)).toBe(7);
  });
  it('has a valid lighthouse loot table', () => {
    expect(LOOT.LIGHTHOUSE).toBe(BEACON_LOOT);
    const [table, a, b, always] = STRUCTURE_LOOT[BEACON_LOOT];
    expect(a).toBeGreaterThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(a);
    for (const [id, min, max, weight = 1] of [...table, ...always]) {
      expect(id, 'item id').toBeGreaterThan(0);
      expect(min).toBeGreaterThanOrEqual(1);
      expect(max).toBeGreaterThanOrEqual(min);
      expect(weight).toBeGreaterThan(0);
    }
    for (let k = 0; k < 20; k++) {
      const items = dungeonLoot(Math.random, BEACON_LOOT).filter(Boolean);
      expect(items.length).toBeGreaterThanOrEqual(a);
      expect(items.some((it) => it.id === B.TORCH)).toBe(true);
    }
    expect(table.some((e) => e[0] === I.COMPASS)).toBe(true);
  });
});

describe('Beacon Lighthouse wiring', () => {
  it('is a retrofit feature, a generator pass, a landmark kind and a milestone', () => {
    expect(FEATURES.find((f) => f.key === 'beaconHouse')).toBeTruthy();
    expect(src('src/world/generator.js')).toContain("this.pass('beaconHouse'");
    expect(LANDMARK_BY_KEY.beaconhouse.name).toBe('Beacon Lighthouse');
    expect(landmarksInBox(gen, s.cx - 5, s.cz - 5, s.cx + 5, s.cz + 5).some((l) => l.kind === 'beaconhouse')).toBe(true);
    expect(nearestLandmark(gen, 'beaconhouse', s.cx, s.cz).x).toBe(s.cx);
    expect(MILESTONES.find((m) => m.id === 'beaconhouse').title).toBe('Keeper of the Coast');
  });
  it('can be located and keeps the sources tidy', () => {
    expect(HELP.join('\n')).toMatch(/\|beacon\|/);
    const game = { world: { dimension: 'overworld', gen }, player: { x: s.cx + 30, y: 70, z: s.cz } };
    expect(String(runCommand(game, '/locate beacon'))).toMatch(/Beacon Lighthouse/);
    for (const f of ['src/world/beaconHouse.js']) expect(src(f), f).not.toMatch(/minecraft|nether|redstone|tripwire/i);
  });
});
