import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '../src/world/generator.js';
import { villageInRegion, villagesNear, PROFESSIONS } from '../src/world/villages.js';
import { makeTrades, canTrade, doTrade, MAX_USES } from '../src/mobs/trades.js';
import { Inventory } from '../src/player/inventory.js';
import { B } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { cidx } from '../src/world/constants.js';
import { rng } from './helpers.js';

describe('villages', () => {
  const gen = new TerrainGenerator(4242);
  it('plans are deterministic and found in a good share of regions', () => {
    let n = 0;
    for (let rx = -3; rx <= 3; rx++) for (let rz = -3; rz <= 3; rz++) {
      const a = villageInRegion(gen, rx, rz);
      if (!a) continue;
      n++;
      const b = villageInRegion(new TerrainGenerator(4242), rx, rz);
      expect(b.cx).toBe(a.cx); expect(b.pieces.length).toBe(a.pieces.length);
    }
    expect(n).toBeGreaterThan(5);
  });
  it('houses get doors and beds stamped across chunk borders', () => {
    // the first oak-door (plains) village near the origin with a house (rivers keep some regions empty)
    let v = null;
    for (let r = 0; r <= 3 && !v; r++) for (let rx = -r; rx <= r && !v; rx++) for (let rz = -r; rz <= r && !v; rz++) {
      const c = villageInRegion(gen, rx, rz);
      if (c && c.style === 'plains' && c.pieces.some((p) => p.type === 'house')) v = c;
    }
    expect(v).toBeTruthy();
    const house = v.pieces.find((p) => p.type === 'house');
    expect(PROFESSIONS).toContain(house.profession);
    let doors = 0, beds = 0;
    for (let cx = Math.floor(house.x0 / 16); cx <= Math.floor(house.x1 / 16); cx++) for (let cz = Math.floor(house.z0 / 16); cz <= Math.floor(house.z1 / 16); cz++) {
      const c = gen.generate(cx, cz);
      for (let x = Math.max(house.x0, cx * 16); x <= Math.min(house.x1, cx * 16 + 15); x++) for (let z = Math.max(house.z0, cz * 16); z <= Math.min(house.z1, cz * 16 + 15); z++) {
        for (let y = house.y; y < house.y + 2; y++) {
          const id = c.blocks[cidx(x - cx * 16, y, z - cz * 16)];
          if (id === B.DOOR) doors++;
          if (id === B.BED) beds++;
        }
      }
    }
    expect(doors).toBe(2);
    expect(beds).toBe(2);
    expect(villagesNear(gen, v.cx, v.cz, v.cx, v.cz)).toContain(v);
  });
});

describe('trading', () => {
  it('one way to earn beryl and two or three ways to spend it', () => {
    const r = rng(3);
    for (const prof of PROFESSIONS) {
      const t = makeTrades(prof, r);
      expect(t[0].get).toBe(I.BERYL);
      expect(t.length).toBeGreaterThanOrEqual(3);
      for (const o of t.slice(1)) expect(o.give).toBe(I.BERYL);
    }
  });
  it('pays, delivers and sells out after 12 uses', () => {
    const inv = new Inventory();
    inv.slots[0] = { id: I.WHEAT, count: 64 * 5, damage: 0 };
    const offer = { give: I.WHEAT, giveCount: 20, get: I.BERYL, getCount: 1, uses: 0 };
    let got = 0;
    while (canTrade(offer, inv)) got += doTrade(offer, inv).count;
    expect(got).toBe(MAX_USES);
    expect(inv.count(I.WHEAT)).toBe(320 - 240);
  });
});
