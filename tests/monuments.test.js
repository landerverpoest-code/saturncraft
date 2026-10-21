import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '../src/world/generator.js';
import {
  monumentInRegion, monumentsNear, nearestMonument, monumentBlock, spongeRooms, toWorld, toLocal, elderSpots,
  MONUMENT_REGION, MONUMENT_SIZE, MONUMENT_BASE_Y, MONUMENT_SPACING, MONUMENT_SEPARATION,
} from '../src/world/monuments.js';
import { spongeAbsorb, spongeUpdate, SPONGE_MAX } from '../src/world/sponge.js';
import { B } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { cidx, SEA_LEVEL } from '../src/world/constants.js';
import { craft, SMELTING } from '../src/player/crafting.js';
import { fatigueFactor, miningFactor, addEffect } from '../src/player/effects.js';
import { breakTicks } from '../src/world/mining.js';
import { needsFatigue, beamInRange, OCEAN_MOBS } from '../src/mobs/oceanMobs.js';
import { rollDrops } from '../src/mobs/drops.js';
import { MockWorld, rng } from './helpers.js';

const SEED = 7;
const gen = new TerrainGenerator(SEED);

function findSome(g, n = 2) {
  const out = [];
  for (let r = 0; r < 8 && out.length < n; r++) for (let rx = -r; rx <= r; rx++) for (let rz = -r; rz <= r; rz++) {
    if (Math.max(Math.abs(rx), Math.abs(rz)) !== r) continue;
    const m = monumentInRegion(g, rx, rz);
    if (m) out.push({ m, rx, rz });
  }
  return out;
}

describe('Tide Citadel placement', () => {
  it('is deterministic from the seed', () => {
    const other = new TerrainGenerator(SEED);
    for (let rx = -3; rx <= 3; rx++) for (let rz = -3; rz <= 3; rz++) expect(monumentInRegion(other, rx, rz)).toEqual(monumentInRegion(gen, rx, rz));
  });

  it('keeps the reference spacing: one per 32-chunk region, inside its first 27 chunks, centred on a chunk', () => {
    const found = findSome(gen, 3);
    expect(found.length).toBeGreaterThan(0);
    for (const { m, rx, rz } of found) {
      const ox = Math.floor(m.cx / 16) - rx * MONUMENT_SPACING, oz = Math.floor(m.cz / 16) - rz * MONUMENT_SPACING;
      expect(ox).toBeGreaterThanOrEqual(0); expect(ox).toBeLessThan(MONUMENT_SPACING - MONUMENT_SEPARATION);
      expect(oz).toBeGreaterThanOrEqual(0); expect(oz).toBeLessThan(MONUMENT_SPACING - MONUMENT_SEPARATION);
      expect(((m.cx % 16) + 16) % 16).toBe(8);
      expect(m.x1 - m.x0 + 1).toBe(MONUMENT_SIZE);
      expect(m.y).toBe(MONUMENT_BASE_Y);
    }
    // neighbouring citadels never come closer than the separation allows
    const all = [];
    for (let rx = -6; rx <= 6; rx++) for (let rz = -6; rz <= 6; rz++) { const m = monumentInRegion(gen, rx, rz); if (m) all.push(m); }
    for (const a of all) for (const b of all) if (a !== b) expect(Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cz - b.cz))).toBeGreaterThanOrEqual(MONUMENT_SEPARATION * 16 + MONUMENT_SIZE - 16);
  });

  it('only stands in deep ocean', () => {
    for (const { m } of findSome(gen, 3)) {
      const col = gen.column(m.cx, m.cz), top = gen.surfaceAt(m.cx, m.cz, col);
      expect([0, 1]).toContain(gen.biomeFor(col, top)); // ocean / frozen ocean
      expect(top).toBeLessThanOrEqual(SEA_LEVEL - 20);
    }
  });

  it('is found by /locate and by area queries', () => {
    const { m } = findSome(gen, 1)[0];
    expect(nearestMonument(gen, m.cx + 100, m.cz - 50)).toEqual(m);
    expect(monumentsNear(gen, m.x0 + 10, m.z0 + 10, m.x0 + 11, m.z0 + 11)).toContainEqual(m);
    expect(monumentsNear(gen, m.x1 + 2, m.z0, m.x1 + 20, m.z1)).not.toContainEqual(m);
  });
});

describe('Tide Citadel layout', () => {
  const m = { cx: 29, cz: 29, x0: 0, z0: 0, x1: 57, z1: 57, y: 39, rot: 0, seed: 1234 };

  it('is symmetric across its gallery', () => {
    for (let h = 0; h <= 22; h++) for (let v = 0; v < 58; v++) for (let u = 0; u < 29; u++) expect(monumentBlock(m, u, h, v)).toBe(monumentBlock(m, 57 - u, h, v));
  });

  it('holds exactly 8 gold blocks, lanterns and wet soakmoss, and fits under the sea', () => {
    const count = {};
    for (let h = 0; h <= 22; h++) for (let v = 0; v < 58; v++) for (let u = 0; u < 58; u++) { const id = monumentBlock(m, u, h, v); count[id] = (count[id] || 0) + 1; }
    expect(count[B.GOLD_BLOCK]).toBe(8);
    expect(count[B.TIDE_LANTERN]).toBeGreaterThan(20);
    expect(count[B.WET_SOAKMOSS]).toBeGreaterThan(10);
    expect(count[B.WATER]).toBeGreaterThan(10000);
    expect(m.y + 22).toBeLessThan(SEA_LEVEL);
    expect(spongeRooms(m).length).toBeGreaterThanOrEqual(1);
    // the elders wait in water
    for (const [x, y, z] of elderSpots(m)) { const [u, v] = toLocal(m, Math.floor(x), Math.floor(z)); expect(monumentBlock(m, u, Math.floor(y) - m.y, v)).toBe(B.WATER); }
  });

  it('maps local and world coordinates both ways for every rotation', () => {
    for (let rot = 0; rot < 4; rot++) {
      const r = { ...m, rot, x0: 100, z0: -300 };
      for (const [u, v] of [[0, 0], [5, 40], [57, 12], [30, 57]]) {
        const [x, z] = toWorld(r, u, v);
        expect(x).toBeGreaterThanOrEqual(100); expect(x).toBeLessThanOrEqual(157);
        expect(toLocal(r, x, z)).toEqual([u, v]);
      }
    }
  });

  it('is stamped seamlessly across chunk borders', () => {
    const { m: real } = findSome(gen, 1)[0];
    // check the column at every footprint corner and the centre against the plan
    for (const [u, v] of [[0, 0], [57, 57], [28, 26], [13, 40], [44, 9]]) {
      const [x, z] = toWorld(real, u, v);
      const c = gen.generate(Math.floor(x / 16), Math.floor(z / 16));
      for (let h = 0; h <= 22; h++) {
        const want = monumentBlock(real, u, h, v);
        if (want >= 0) expect(c.blocks[cidx(x & 15, real.y + h, z & 15)]).toBe(want);
      }
    }
  });
});

describe('Soakmoss (sponge)', () => {
  it('drinks up water within 7 blocks (taxicab), at most 65 blocks', () => {
    const w = new MockWorld(0);
    for (let x = -10; x <= 10; x++) for (let y = 1; y <= 21; y++) for (let z = -10; z <= 10; z++) w.set(x, y, z, B.WATER);
    w.set(0, 10, 0, B.SOAKMOSS);
    const got = spongeAbsorb((a, b, c) => w.getBlock(a, b, c), 0, 10, 0);
    expect(got.length).toBe(SPONGE_MAX);
    // breadth first: the nearest first, nothing further than 7 steps
    let last = 0;
    for (const [x, y, z] of got) { const d = Math.abs(x) + Math.abs(y - 10) + Math.abs(z); expect(d).toBeGreaterThanOrEqual(last); expect(d).toBeLessThanOrEqual(7); last = d; }
  });

  it('follows the water through a channel up to 7 blocks and no further', () => {
    const w = new MockWorld(0);
    for (let x = 1; x <= 12; x++) w.set(x, 5, 0, B.WATER);
    const got = spongeAbsorb((a, b, c) => w.getBlock(a, b, c), 0, 5, 0);
    expect(got.map(([x]) => x)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('turns wet when it soaks something up, and dries in a furnace', () => {
    const w = new MockWorld(0);
    w.setBlock = (x, y, z, id) => w.set(x, y, z, id);
    w.set(0, 5, 0, B.SOAKMOSS); w.set(1, 5, 0, B.WATER); w.set(0, 6, 0, B.WATER);
    expect(spongeUpdate(w, 0, 5, 0)).toBe(2);
    expect(w.getBlock(0, 5, 0)).toBe(B.WET_SOAKMOSS);
    expect(w.getBlock(1, 5, 0)).toBe(B.AIR);
    expect(spongeUpdate(w, 0, 5, 0)).toBe(0); // a wet one does nothing
    expect(SMELTING[B.WET_SOAKMOSS]).toBe(B.SOAKMOSS);
  });
});

describe('Tide items and recipes', () => {
  const S = { id: I.TIDE_SHARD, count: 1 }, C = { id: I.TIDE_CRYSTAL, count: 1 };
  it('crafts tidestone, bricks, dark tidestone and the lantern', () => {
    expect(craft([S, S, S, S], 2).id).toBe(B.TIDESTONE);
    expect(craft(Array(9).fill(S), 3).id).toBe(B.TIDESTONE_BRICKS);
    expect(craft([S, S, S, S, { id: I.INK_SAC, count: 1 }, S, S, S, S], 3).id).toBe(B.DARK_TIDESTONE);
    expect(craft([S, C, S, C, C, C, S, C, S], 3).id).toBe(B.TIDE_LANTERN);
  });
});

describe('Mining Fatigue and the Deepeyes', () => {
  it('slows mining like the reference (0.3^level, capped at level IV)', () => {
    expect(fatigueFactor(0)).toBe(1);
    expect(fatigueFactor(1)).toBeCloseTo(0.3);
    expect(fatigueFactor(2)).toBeCloseTo(0.09);
    expect(fatigueFactor(3)).toBeCloseTo(0.0027);
    expect(fatigueFactor(9)).toBeCloseTo(0.00081);
    const map = {};
    addEffect(map, 'mining_fatigue', 6000, 2);
    expect(miningFactor(map)).toBeCloseTo(0.0027);
    // stone by hand: 150 ticks normally; with Mining Fatigue III it takes ~370 times as long
    expect(breakTicks(B.STONE, undefined, { fatigue: 3 })).toBeGreaterThan(breakTicks(B.STONE) * 300);
  });

  it('elders only renew the curse when it is missing, weaker or about to run out', () => {
    expect(needsFatigue({})).toBe(true);
    expect(needsFatigue({ mining_fatigue: { amp: 2, ticks: 5000 } })).toBe(false);
    expect(needsFatigue({ mining_fatigue: { amp: 2, ticks: 600 } })).toBe(true);
    expect(needsFatigue({ mining_fatigue: { amp: 0, ticks: 5000 } })).toBe(true);
    expect(needsFatigue({}, true)).toBe(false); // creative
  });

  it('aims at targets between 3 and 16 blocks away', () => {
    expect(beamInRange(2 * 2)).toBe(false);
    expect(beamInRange(10 * 10)).toBe(true);
    expect(beamInRange(17 * 17)).toBe(false);
    expect(OCEAN_MOBS.deepeye.beamCharge).toBe(40); // 2 s
    expect(OCEAN_MOBS.elder_deepeye.health).toBe(80);
  });

  it('drops shards, and fish or crystals (never both)', () => {
    const r = rng(5);
    let fish = 0, crystal = 0;
    for (let k = 0; k < 2000; k++) {
      const d = rollDrops('deepeye', { killedByPlayer: true }, r);
      const f = d.some((x) => x.id === I.RAW_SILVERFIN), c = d.some((x) => x.id === I.TIDE_CRYSTAL);
      expect(f && c).toBe(false);
      for (const x of d) if (x.id === I.TIDE_SHARD) expect(x.count).toBeLessThanOrEqual(2);
      fish += f; crystal += c;
    }
    expect(fish / 2000).toBeCloseTo(0.4, 1);
    expect(crystal / 2000).toBeCloseTo(0.4, 1);
    expect(rollDrops('elder_deepeye', { killedByPlayer: true }, r).some((x) => x.id === B.WET_SOAKMOSS)).toBe(true);
  });
});
