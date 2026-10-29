import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '../src/world/generator.js';
import { sunkenRuinInRegion, sunkenRuinsNear, sunkenRuinBlock, sunkenRuinChests, sunkenGuardSpots, nearestSunkenRuin, SUNKEN_REGION, SUNKEN_LOOT } from '../src/world/sunkenRuins.js';
import { sunTombInRegion, sunTombsNear, tombBlock, tombChests, tombGuardSpots, tombTrap, nearestSunTomb, TOMB_HALF, TOMB_REGION, TOMB_LOOT, CRYPT_LOOT } from '../src/world/sunTombs.js';
import { skywatchInRegion, skywatchesNear, skywatchBlock, skywatchChests, skywatchGuards, nearestSkywatch, SKYWATCH_HALF, SKYWATCH_REGION } from '../src/world/skywatch.js';
import { toWorld, toLocal, boxesOverlap, claimedByOthers } from '../src/world/siteKit.js';
import { dungeonLoot, LOOT } from '../src/mobs/spawnerBlocks.js';
import { B, SOLID } from '../src/world/blocks.js';
import { BIOME } from '../src/world/biomes.js';
import { cidx, SEA_LEVEL } from '../src/world/constants.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import '../src/mobs/hostileVariants.js';

const SEED = 12345;
const gen = new TerrainGenerator(SEED);

function collect(find, g, n, R = 8) {
  const out = [];
  for (let r = 0; r <= R && out.length < n; r++) for (let rx = -r; rx <= r; rx++) for (let rz = -r; rz <= r; rz++) {
    if (Math.max(Math.abs(rx), Math.abs(rz)) !== r) continue;
    const s = find(g, rx, rz);
    if (s) out.push(s);
  }
  return out;
}

/** Block reader over generated chunks (generated on demand). */
function reader(g) {
  const chunks = new Map();
  const chunk = (cx, cz) => { const k = `${cx},${cz}`; if (!chunks.has(k)) chunks.set(k, g.generate(cx, cz)); return chunks.get(k); };
  const get = (x, y, z) => {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16), c = chunk(cx, cz), i = cidx(x - cx * 16, y, z - cz * 16);
    return [c.blocks[i], c.meta[i]];
  };
  return { get, chunk, count: () => chunks.size };
}

const ruins = collect(sunkenRuinInRegion, gen, 4);
const tombs = collect(sunTombInRegion, gen, 3, 10);
const towers = collect(skywatchInRegion, gen, 3, 10);

describe('rotation helpers', () => {
  it('toLocal inverts toWorld for every heading', () => {
    for (let d = 0; d < 4; d++) for (const [u, v] of [[0, 0], [3, -5], [-7, 2], [13, 8]]) {
      const [dx, dz] = toWorld(d, u, v);
      expect(toLocal(d, dx, dz)).toEqual([u, v]);
    }
  });
});

describe('placement', () => {
  it('finds each kind of structure in the first rings of regions', () => {
    expect(ruins.length).toBeGreaterThanOrEqual(2);
    expect(tombs.length).toBeGreaterThanOrEqual(1);
    expect(towers.length).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic from the seed', () => {
    const other = new TerrainGenerator(SEED);
    for (let rx = -5; rx <= 5; rx++) for (let rz = -5; rz <= 5; rz++) {
      expect(sunkenRuinInRegion(other, rx, rz)).toEqual(sunkenRuinInRegion(gen, rx, rz));
      expect(sunTombInRegion(other, rx, rz)).toEqual(sunTombInRegion(gen, rx, rz));
      expect(skywatchInRegion(other, rx, rz)).toEqual(skywatchInRegion(gen, rx, rz));
    }
  });

  it('differs between seeds', () => {
    const other = new TerrainGenerator(SEED + 1);
    const a = collect(sunkenRuinInRegion, gen, 3).map((r) => `${r.cx},${r.cz}`);
    const b = collect(sunkenRuinInRegion, other, 3).map((r) => `${r.cx},${r.cz}`);
    expect(a).not.toEqual(b);
  });

  it('is rare', () => {
    let r = 0, t = 0, s = 0, n = 0;
    for (let rx = -8; rx < 8; rx++) for (let rz = -8; rz < 8; rz++) {
      n++; if (sunkenRuinInRegion(gen, rx, rz)) r++; if (sunTombInRegion(gen, rx, rz)) t++; if (skywatchInRegion(gen, rx, rz)) s++;
    }
    expect(r / n).toBeLessThan(0.3);
    expect(t / n).toBeLessThan(0.2);
    expect(s / n).toBeLessThan(0.3);
  });

  it('Sunken Ruins stand on deep ocean floor, below the surface', () => {
    for (const r of ruins) {
      const col = gen.column(r.cx, r.cz), top = gen.surfaceAt(r.cx, r.cz, col);
      expect([BIOME.OCEAN, BIOME.FROZEN_OCEAN]).toContain(gen.biomeFor(col, top));
      expect(r.y).toBeLessThanOrEqual(SEA_LEVEL - 14);
      expect(r.y).toBeGreaterThanOrEqual(top - 5);
    }
  });

  it('Sun Tombs stand in deserts or badlands above sea level', () => {
    for (const t of tombs) {
      const col = gen.column(t.cx, t.cz), top = gen.surfaceAt(t.cx, t.cz, col);
      expect([BIOME.DESERT, BIOME.BADLANDS]).toContain(gen.biomeFor(col, top));
      expect(t.y).toBeGreaterThan(SEA_LEVEL);
      expect(t.style).toBe(gen.biomeFor(col, top) === BIOME.BADLANDS ? 'badlands' : 'desert');
    }
  });

  it('Skywatch Towers crown peaks', () => {
    for (const t of towers) {
      const col = gen.column(t.cx, t.cz), top = gen.surfaceAt(t.cx, t.cz, col);
      expect([BIOME.STONY_PEAKS, BIOME.SNOWY_PEAKS]).toContain(gen.biomeFor(col, top));
      expect(t.y).toBeGreaterThanOrEqual(100);
    }
  });

  it('keeps clear of older structures and of each other', () => {
    for (const s of [...ruins, ...tombs, ...towers]) expect(claimedByOthers(gen, s.x0, s.z0, s.x1, s.z1)).toBe(false);
    // across a wide area no two of the new structures overlap
    const found = [];
    for (let rx = -10; rx <= 10; rx++) for (let rz = -10; rz <= 10; rz++) {
      for (const s of [sunkenRuinInRegion(gen, rx, rz), sunTombInRegion(gen, rx, rz), skywatchInRegion(gen, rx, rz)]) if (s) found.push(s);
    }
    for (let i = 0; i < found.length; i++) for (let j = i + 1; j < found.length; j++) expect(boxesOverlap(found[i], found[j])).toBe(false);
  });

  it('nearby lookups agree with the region lookups', () => {
    const r = ruins[0];
    expect(sunkenRuinsNear(gen, r.cx - 3, r.cz - 3, r.cx + 3, r.cz + 3)).toContainEqual(r);
    expect(sunkenRuinsNear(gen, r.cx + 100, r.cz + 100, r.cx + 110, r.cz + 110)).not.toContainEqual(r);
    expect(sunTombsNear(gen, tombs[0].cx, tombs[0].cz, tombs[0].cx, tombs[0].cz)).toContainEqual(tombs[0]);
    expect(skywatchesNear(gen, towers[0].cx, towers[0].cz, towers[0].cx, towers[0].cz)).toContainEqual(towers[0]);
  });

  it('/locate helpers return the nearest structure', () => {
    const r = nearestSunkenRuin(gen, 0, 0), t = nearestSunTomb(gen, 0, 0), s = nearestSkywatch(gen, 0, 0);
    expect(r && t && s).toBeTruthy();
    const d = (a) => Math.hypot(a.cx, a.cz);
    for (const x of ruins) expect(d(r)).toBeLessThanOrEqual(d(x) + SUNKEN_REGION);
    for (const x of tombs) expect(d(t)).toBeLessThanOrEqual(d(x) + TOMB_REGION);
    for (const x of towers) expect(d(s)).toBeLessThanOrEqual(d(x) + SKYWATCH_REGION);
  });
});

/** Compare every planned block of structure s with the generated world (all chunks it touches). */
function matchesWorld(s, blockFn, half, hMin, hMax, rd) {
  let checked = 0;
  for (let dx = -half; dx <= half; dx++) for (let dz = -half; dz <= half; dz++) {
    const [u, v] = toLocal(s.dir, dx, dz);
    for (let h = hMin; h <= hMax; h++) {
      const bl = blockFn(s, u, h, v);
      if (!bl) continue;
      const [id, m] = rd.get(s.cx + dx, s.y + h, s.cz + dz);
      if (id !== bl[0] || m !== bl[1]) return `${s.cx + dx},${s.y + h},${s.cz + dz} expected ${bl} got ${id},${m}`;
      checked++;
    }
  }
  return checked;
}

describe('chunk-border continuity', () => {
  it('a Sunken Ruin is stamped identically over every chunk it crosses', () => {
    const r = ruins[0], rd = reader(gen);
    const res = matchesWorld(r, sunkenRuinBlock, 13, -5, 11, rd);
    expect(typeof res).toBe('number');
    expect(res).toBeGreaterThan(1500);
    expect(rd.count()).toBeGreaterThan(3); // it really spans several chunks
  });

  it('a Sun Tomb is stamped identically over every chunk it crosses', () => {
    const t = tombs[0], rd = reader(gen);
    const res = matchesWorld(t, tombBlock, TOMB_HALF, -10, 26, rd);
    expect(typeof res).toBe('number');
    expect(res).toBeGreaterThan(10000);
    expect(rd.count()).toBeGreaterThanOrEqual(9);
  });

  it('a Skywatch Tower is stamped identically over every chunk it crosses', () => {
    const t = towers[0], rd = reader(gen);
    const res = matchesWorld(t, skywatchBlock, SKYWATCH_HALF, 0, 40, rd);
    expect(typeof res).toBe('number');
    expect(res).toBeGreaterThan(5000);
  });

  it('regenerating a chunk gives the same blocks', () => {
    const t = tombs[0], cx = Math.floor(t.cx / 16), cz = Math.floor(t.cz / 16);
    const a = gen.generate(cx, cz), b = new TerrainGenerator(SEED).generate(cx, cz);
    expect(Buffer.from(a.blocks).equals(Buffer.from(b.blocks))).toBe(true);
    expect(Buffer.from(a.meta).equals(Buffer.from(b.meta))).toBe(true);
  });
});

describe('chests and loot', () => {
  const chestsIn = (list, rd) => list.map((c) => ({ ...c, got: rd.get(c.x, c.y, c.z) }));

  it('Sunken Ruins hold four loot chests', () => {
    const r = ruins[0], rd = reader(gen), cs = chestsIn(sunkenRuinChests(r), rd);
    expect(cs).toHaveLength(4);
    for (const c of cs) { expect(c.got[0]).toBe(B.CHEST); expect(c.got[1] & 8).toBe(8); expect((c.got[1] >> 4) & 15).toBe(SUNKEN_LOOT); }
  });

  it('Sun Tombs hold seven loot chests, three of them in the crypt', () => {
    const t = tombs[0], rd = reader(gen), cs = chestsIn(tombChests(t), rd);
    expect(cs).toHaveLength(7);
    for (const c of cs) { expect(c.got[0]).toBe(B.CHEST); expect((c.got[1] >> 4) & 15).toBe(c.kind); }
    expect(cs.filter((c) => c.kind === CRYPT_LOOT)).toHaveLength(3);
    expect(cs.filter((c) => c.kind === TOMB_LOOT)).toHaveLength(4);
  });

  it('Skywatch Towers hold six loot chests of existing tables', () => {
    const t = towers[0], rd = reader(gen), cs = chestsIn(skywatchChests(t), rd);
    expect(cs).toHaveLength(6);
    for (const c of cs) { expect(c.got[0]).toBe(B.CHEST); expect((c.got[1] >> 4) & 15).toBe(c.kind); }
  });

  it('new loot kinds are appended after the existing ones and roll items', () => {
    expect(LOOT.TOMB).toBe(10);
    expect(LOOT.SUNKEN).toBe(15);
    const used = Object.entries(LOOT).filter(([k]) => k !== 'TOMB' && k !== 'SUNKEN').map(([, v]) => v);
    expect(used).not.toContain(10);
    expect(used).not.toContain(15);
    for (const kind of [LOOT.TOMB, LOOT.SUNKEN]) {
      let seen = 0;
      for (let i = 0; i < 20; i++) seen += dungeonLoot(Math.random, kind).filter(Boolean).length;
      expect(seen).toBeGreaterThanOrEqual(60);
    }
  });
});

describe('Sun Tomb traps', () => {
  it('every pressure plate lies on TNT, and no TNT is loose', () => {
    const t = tombs[0], rd = reader(gen);
    let plates = 0;
    for (let dx = -TOMB_HALF; dx <= TOMB_HALF; dx++) for (let dz = -TOMB_HALF; dz <= TOMB_HALF; dz++) for (let h = -10; h <= 3; h++) {
      const [id] = rd.get(t.cx + dx, t.y + h, t.cz + dz);
      if (id === B.WOODEN_PRESSURE_PLATE) { plates++; expect(rd.get(t.cx + dx, t.y + h - 1, t.cz + dz)[0]).toBe(B.TNT); }
      if (id === B.TNT) expect(rd.get(t.cx + dx, t.y + h + 1, t.cz + dz)[0]).toBe(B.WOODEN_PRESSURE_PLATE);
    }
    expect(plates).toBeGreaterThan(10);
  });

  it('the entrance corridor always has a way past the plates', () => {
    for (const t of tombs) for (let u = 10; u <= 18; u++) {
      expect([-1, 0, 1].filter((v) => !tombTrap(t, u, v)).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('the crypt and the trapped chamber have a safe path to their chests', () => {
    const step = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const reach = (start, goal, ok) => {
      const seen = new Set([start.join()]), q = [start];
      while (q.length) {
        const [a, b] = q.shift();
        if (goal(a, b)) return true;
        for (const [da, db] of step) {
          const n = [a + da, b + db];
          if (ok(n[0], n[1]) && !seen.has(n.join())) { seen.add(n.join()); q.push(n); }
        }
      }
      return false;
    };
    for (const t of tombs) {
      expect(reach([-12, 0], (u) => u === -4, (u, v) => u >= -12 && u <= -4 && Math.abs(v) <= 4 && !tombTrap(t, u, v))).toBe(true);
      expect(reach([0, 9], (u, v) => v === 13, (u, v) => Math.abs(u) <= 2 && v >= 9 && v <= 13 && !tombTrap(t, u, v))).toBe(true);
    }
  });

  it('the badlands style uses terracotta instead of sandstone', () => {
    const t = tombs[0];
    expect(tombBlock({ ...t, style: 'badlands' }, 12, 2, 12)[0]).not.toBe(B.SANDSTONE);
    expect(tombBlock({ ...t, style: 'desert' }, 12, 2, 12)[0]).toBe(B.SANDSTONE);
  });
});

describe('guards', () => {
  const stands = (rd, [x, y, z]) => !SOLID[rd.get(x, y, z)[0]] && !SOLID[rd.get(x, y + 1, z)[0]] && !!SOLID[rd.get(x, y - 1, z)[0]];

  it('uses mobs that exist', () => {
    for (const k of ['sodden_shambler', 'dune_shambler', 'rattler', 'marauder']) expect(MOBS[k]).toBeTruthy();
  });

  it('Sunken Ruin guard spots are flooded floor space', () => {
    const r = ruins[0], rd = reader(gen), spots = sunkenGuardSpots(r);
    expect(spots).toHaveLength(5);
    for (const [x, y, z] of spots) {
      expect(rd.get(x, y, z)[0]).toBe(B.WATER);
      expect(SOLID[rd.get(x, y - 1, z)[0]]).toBeTruthy();
    }
  });

  it('Sun Tomb guard spots stand inside the hall and the burial chamber', () => {
    const t = tombs[0], rd = reader(gen), spots = tombGuardSpots(t);
    expect(spots).toHaveLength(6);
    for (const s of spots) expect(stands(rd, s)).toBe(true);
  });

  it('Skywatch guards stand on floors, on the roof or in the courtyard', () => {
    for (const t of towers) {
      const rd = reader(gen), gs = skywatchGuards(t);
      expect(gs.filter((g) => g.type === 'rattler').length).toBe(3);
      expect(gs.filter((g) => g.type === 'marauder').length).toBe(5);
      expect(gs.filter((g) => stands(rd, [g.x, g.y, g.z])).length).toBeGreaterThanOrEqual(6); // a few roof planks are weathered away
    }
  });
});
