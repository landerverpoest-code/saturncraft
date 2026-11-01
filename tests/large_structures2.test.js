import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '../src/world/generator.js';
import { rimekeepInRegion, rimekeepsNear, rimekeepBlock, rimekeepChests, rimekeepGuards, nearestRimekeep, RIMEKEEP_HALF, RIMEKEEP_REGION, RIMEKEEP_LOOT, RIMEKEEP_WARDEN } from '../src/world/rimekeep.js';
import { sporehallInRegion, sporehallsNear, sporehallBlock, sporehallChests, sporehallChestCells, sporehallGuards, nearestSporehall, mazeLayout, galleryPath, galleryTrap, SPOREHALL_HALF, SPOREHALL_REGION, SPOREHALL_LOOT, MAZE_ENTRY, MAZE_I, MAZE_J } from '../src/world/sporehall.js';
import { sunkenRuinInRegion } from '../src/world/sunkenRuins.js';
import { sunTombInRegion } from '../src/world/sunTombs.js';
import { skywatchInRegion } from '../src/world/skywatch.js';
import { toLocal, boxesOverlap, claimedByOthers } from '../src/world/siteKit.js';
import { landmarksInBox, nearestLandmark, chartMap, mapTitle } from '../src/world/landmarks.js';
import { LANDMARK_BY_KEY } from '../src/world/landmarkKinds.js';
import { dungeonLoot, LOOT } from '../src/mobs/spawnerBlocks.js';
import { makeTrades } from '../src/mobs/trades.js';
import { MILESTONES } from '../src/player/milestones.js';
import { runCommand, HELP } from '../src/ui/commands.js';
import { I, ITEMS, CHARTS } from '../src/world/items.js';
import { B, SOLID } from '../src/world/blocks.js';
import { BIOME } from '../src/world/biomes.js';
import { cidx, SEA_LEVEL } from '../src/world/constants.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import { EQUIP_KINDS } from '../src/mobs/equipment.js';
import '../src/mobs/hostileVariants.js';

const SEED = 12345;
const gen = new TerrainGenerator(SEED);

function collect(find, g, n, R = 10) {
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
  return { get, count: () => chunks.size };
}

const keeps = collect(rimekeepInRegion, gen, 3);
const halls = collect(sporehallInRegion, gen, 3);

describe('placement', () => {
  it('finds both kinds in the first rings of regions', () => {
    expect(keeps.length).toBeGreaterThanOrEqual(2);
    expect(halls.length).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic from the seed and differs between seeds', () => {
    const other = new TerrainGenerator(SEED);
    for (let rx = -5; rx <= 5; rx++) for (let rz = -5; rz <= 5; rz++) {
      expect(rimekeepInRegion(other, rx, rz)).toEqual(rimekeepInRegion(gen, rx, rz));
      expect(sporehallInRegion(other, rx, rz)).toEqual(sporehallInRegion(gen, rx, rz));
    }
    const diff = new TerrainGenerator(SEED + 1);
    const a = collect(rimekeepInRegion, gen, 3).map((r) => `${r.cx},${r.cz}`), b = collect(rimekeepInRegion, diff, 3).map((r) => `${r.cx},${r.cz}`);
    expect(a).not.toEqual(b);
  });

  it('is rare', () => {
    let r = 0, s = 0, n = 0;
    for (let rx = -8; rx < 8; rx++) for (let rz = -8; rz < 8; rz++) { n++; if (rimekeepInRegion(gen, rx, rz)) r++; if (sporehallInRegion(gen, rx, rz)) s++; }
    expect(r / n).toBeLessThan(0.3);
    expect(s / n).toBeLessThan(0.3);
  });

  it('Rimekeeps stand in cold biomes above sea level', () => {
    for (const k of keeps) {
      const col = gen.column(k.cx, k.cz), top = gen.surfaceAt(k.cx, k.cz, col);
      expect([BIOME.SNOWY_PLAINS, BIOME.SNOWY_TAIGA, BIOME.TAIGA]).toContain(gen.biomeFor(col, top));
      expect(k.y).toBeGreaterThan(SEA_LEVEL);
    }
  });

  it('Sporehalls stand in the jungle or on a Highland Meadow, and say which', () => {
    for (const h of halls) {
      const col = gen.column(h.cx, h.cz), top = gen.surfaceAt(h.cx, h.cz, col), b = gen.biomeFor(col, top);
      expect([BIOME.JUNGLE, BIOME.HIGHLAND_MEADOW]).toContain(b);
      expect(h.style).toBe(b === BIOME.HIGHLAND_MEADOW ? 'meadow' : 'jungle');
      expect(h.y).toBeGreaterThan(SEA_LEVEL);
    }
    // Highland Meadows are allowed: another seed may well put one there
    let meadow = 0;
    for (const seed of [12345, 99, 4242, 7]) { const g = new TerrainGenerator(seed); meadow += collect(sporehallInRegion, g, 40, 8).filter((h) => h.style === 'meadow').length; }
    expect(meadow).toBeGreaterThanOrEqual(1);
  });

  it('keeps clear of older structures and of each other', () => {
    for (const s of [...keeps, ...halls]) expect(claimedByOthers(gen, s.x0, s.z0, s.x1, s.z1)).toBe(false);
    const found = [];
    for (let rx = -10; rx <= 10; rx++) for (let rz = -10; rz <= 10; rz++) {
      for (const s of [sunkenRuinInRegion(gen, rx, rz), sunTombInRegion(gen, rx, rz), skywatchInRegion(gen, rx, rz), rimekeepInRegion(gen, rx, rz), sporehallInRegion(gen, rx, rz)]) if (s) found.push(s);
    }
    for (let i = 0; i < found.length; i++) for (let j = i + 1; j < found.length; j++) expect(boxesOverlap(found[i], found[j])).toBe(false);
  });

  it('nearby lookups agree with the region lookups', () => {
    const k = keeps[0], h = halls[0];
    expect(rimekeepsNear(gen, k.cx - 3, k.cz - 3, k.cx + 3, k.cz + 3)).toContainEqual(k);
    expect(rimekeepsNear(gen, k.cx + 400, k.cz + 400, k.cx + 410, k.cz + 410)).not.toContainEqual(k);
    expect(sporehallsNear(gen, h.cx, h.cz, h.cx, h.cz)).toContainEqual(h);
  });
});

describe('/locate, maps and charts', () => {
  it('the nearest-site helpers return a site within one region of the best', () => {
    const k = nearestRimekeep(gen, 0, 0), h = nearestSporehall(gen, 0, 0);
    expect(k && h).toBeTruthy();
    const d = (a) => Math.hypot(a.cx, a.cz);
    for (const x of keeps) expect(d(k)).toBeLessThanOrEqual(d(x) + RIMEKEEP_REGION);
    for (const x of halls) expect(d(h)).toBeLessThanOrEqual(d(x) + SPOREHALL_REGION);
  });

  it('/locate rimekeep and /locate sporehall name the nearest one', () => {
    const k = keeps[0], h = halls[0];
    const game = (s) => ({ seed: SEED, world: { dimension: 'overworld', gen }, player: { x: s.cx + 20, z: s.cz - 20 } });
    const r = runCommand(game(k), '/locate rimekeep');
    expect(r).toMatch(/^The nearest Rimekeep is at -?\d+, -?\d+, -?\d+ \(\d+ blocks away\)$/);
    expect(r).toContain(`${nearestRimekeep(gen, k.cx + 20, k.cz - 20).cx}, `);
    const s = runCommand(game(h), '/locate sporehall');
    expect(s).toMatch(/^The nearest Sporehall is at -?\d+, -?\d+, -?\d+ \(\d+ blocks away\), (jungle|meadow)$/);
    expect(runCommand({ seed: SEED, world: { dimension: 'hollow', gen }, player: { x: 0, z: 0 } }, '/locate rimekeep')).toMatch(/overworld/);
    expect(HELP.join('\n')).toMatch(/rimekeep\|sporehall/);
  });

  it('maps note both kinds and charts lead to them', () => {
    for (const [kind, s] of [['rimekeep', keeps[0]], ['sporehall', halls[0]]]) {
      expect(LANDMARK_BY_KEY[kind]).toBeTruthy();
      expect(landmarksInBox(gen, s.cx - 5, s.cz - 5, s.cx + 5, s.cz + 5)).toContainEqual({ kind, x: s.cx, z: s.cz });
      const r = nearestLandmark(gen, kind, s.cx + 30, s.cz - 30);
      expect(r.kind).toBe(kind);
      expect(Math.hypot(r.x - s.cx, r.z - s.cz)).toBeLessThan(500);
      const c = chartMap(gen, kind, s.cx + 100, s.cz, 5);
      expect(c.map.marks).toContainEqual({ kind, x: c.site.x, z: c.site.z, target: true });
      expect(mapTitle(c.map)).toBe(`${LANDMARK_BY_KEY[kind].name} Map`);
      expect(ITEMS[CHARTS[kind]].chart).toBe(kind);
    }
    expect(I.CHART_RIMEKEEP).toBe(CHARTS.rimekeep);
    expect(I.CHART_SPOREHALL).toBe(CHARTS.sporehall);
  });

  it('cartographers can sell the new charts and milestones exist', () => {
    const got = new Set();
    for (let i = 0; i < 200; i++) for (const o of makeTrades('cartographer', Math.random)) got.add(o.get);
    expect(got.has(CHARTS.rimekeep)).toBe(true);
    expect(got.has(CHARTS.sporehall)).toBe(true);
    const ids = MILESTONES.map((m) => m.id);
    expect(ids).toContain('rimekeep');
    expect(ids).toContain('sporehall');
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
  it('a Rimekeep is stamped identically over every chunk it crosses', () => {
    const rd = reader(gen), res = matchesWorld(keeps[0], rimekeepBlock, RIMEKEEP_HALF, -6, 26, rd);
    expect(typeof res).toBe('number');
    expect(res).toBeGreaterThan(10000);
    expect(rd.count()).toBeGreaterThanOrEqual(4);
  });

  it('a Sporehall is stamped identically over every chunk it crosses', () => {
    const rd = reader(gen), res = matchesWorld(halls[0], sporehallBlock, SPOREHALL_HALF, -5, 22, rd);
    expect(typeof res).toBe('number');
    expect(res).toBeGreaterThan(8000);
    expect(rd.count()).toBeGreaterThanOrEqual(4);
  });

  it('regenerating a chunk gives the same blocks', () => {
    for (const s of [keeps[0], halls[0]]) {
      const cx = Math.floor(s.cx / 16), cz = Math.floor(s.cz / 16);
      const a = gen.generate(cx, cz), b = new TerrainGenerator(SEED).generate(cx, cz);
      expect(Buffer.from(a.blocks).equals(Buffer.from(b.blocks))).toBe(true);
      expect(Buffer.from(a.meta).equals(Buffer.from(b.meta))).toBe(true);
    }
  });
});

describe('chests and loot', () => {
  const chestsOf = (list, rd) => list.map((c) => ({ ...c, got: rd.get(c.x, c.y, c.z) }));

  it('a Rimekeep holds nine loot chests in four tables', () => {
    const cs = chestsOf(rimekeepChests(keeps[0]), reader(gen));
    expect(cs).toHaveLength(9);
    for (const c of cs) { expect(c.got[0]).toBe(B.CHEST); expect(c.got[1] & 8).toBe(8); expect((c.got[1] >> 4) & 15).toBe(c.kind); }
    for (const kind of Object.values(RIMEKEEP_LOOT)) expect(cs.some((c) => c.kind === kind)).toBe(true);
    expect(cs.filter((c) => c.kind === RIMEKEEP_LOOT.vault)).toHaveLength(3);
  });

  it('a Sporehall holds six loot chests: two in the maze, one at the end of the gallery, the altar and two in the crypt', () => {
    for (const h of halls) {
      const cs = chestsOf(sporehallChests(h), reader(gen));
      expect(cs).toHaveLength(6);
      for (const c of cs) { expect(c.got[0]).toBe(B.CHEST); expect((c.got[1] >> 4) & 15).toBe(c.kind); }
      expect(cs.filter((c) => c.kind === SPOREHALL_LOOT.maze)).toHaveLength(2);
      expect(cs.filter((c) => c.kind === SPOREHALL_LOOT.crypt)).toHaveLength(2);
    }
  });

  it('only reuses loot kinds that exist (all 16 chest kinds were taken) and every table rolls items', () => {
    const taken = new Set(Object.values(LOOT));
    for (const kind of [...Object.values(RIMEKEEP_LOOT), ...Object.values(SPOREHALL_LOOT)]) {
      expect(kind).toBeGreaterThanOrEqual(0);
      expect(kind).toBeLessThanOrEqual(15);
      expect(taken.has(kind)).toBe(true);
      let seen = 0;
      for (let i = 0; i < 20; i++) seen += dungeonLoot(Math.random, kind).filter(Boolean).length;
      expect(seen).toBeGreaterThanOrEqual(30);
    }
  });
});

describe('Sporehall puzzles', () => {
  it('the maze is a perfect maze: every room is reachable from the entrance and the chests lie in dead ends', () => {
    for (const h of halls) {
      const m = mazeLayout(h.seed), step = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const seen = new Set([MAZE_ENTRY.join()]), q = [MAZE_ENTRY];
      while (q.length) {
        const [i, j] = q.shift();
        for (const [di, dj] of step) {
          const n = [i + di, j + dj], k = n.join();
          if (m.open.has(k) && !seen.has(k)) { seen.add(k); q.push(n); }
        }
      }
      expect(seen.size).toBe(m.open.size);
      for (let i = 1; i < MAZE_I; i += 2) for (let j = 1; j < MAZE_J; j += 2) expect(seen.has(`${i},${j}`)).toBe(true); // all 24 rooms
      expect(m.open.size).toBe(24 + 23 + 1); // rooms + one passage fewer than rooms + the entrance
      expect(m.chests).toHaveLength(2);
      for (const [i, j] of m.chests) expect(step.filter(([di, dj]) => m.open.has(`${i + di},${j + dj}`)).length).toBe(1);
    }
  });

  it('the maze differs from hall to hall and walls in every cell that is not open', () => {
    expect(new Set(halls.map((h) => [...mazeLayout(h.seed).open].sort().join('|'))).size).toBeGreaterThan(1);
    const h = halls[0], m = mazeLayout(h.seed);
    for (let i = 0; i < MAZE_I; i++) for (let j = 0; j < MAZE_J; j++) {
      const bl = sporehallBlock(h, i - 13, 1, j - 6);
      const open = m.open.has(`${i},${j}`);
      if (open) expect(SOLID[bl[0]] ? bl[0] === B.CHEST : true).toBe(true);
      else expect(SOLID[bl[0]]).toBeTruthy();
    }
  });

  it('the gallery has one safe path from its door to the chest, and every plate lies on TNT', () => {
    for (const h of halls) {
      const g = galleryPath(h.seed), step = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const seen = new Set(['5,0']), q = [[5, 0]];
      while (q.length) {
        const [u, v] = q.shift();
        for (const [du, dv] of step) {
          const n = [u + du, v + dv];
          if (g.cells.has(n.join()) && !seen.has(n.join())) { seen.add(n.join()); q.push(n); }
        }
      }
      expect(seen.has(`12,${g.end}`)).toBe(true);
      expect(seen.size).toBe(g.cells.size);
      for (const c of g.cells) { const [u, v] = c.split(',').map(Number); expect(galleryTrap(h, u, v)).toBe(false); }
    }
    const h = halls[0];
    let plates = 0;
    for (let u = 5; u <= 12; u++) for (let v = -5; v <= 5; v++) {
      const trap = galleryTrap(h, u, v);
      const pl = sporehallBlock(h, u, 1, v), fl = sporehallBlock(h, u, 0, v);
      if (trap) { plates++; expect(pl[0]).toBe(B.WOODEN_PRESSURE_PLATE); expect(fl[0]).toBe(B.TNT); } else { expect(fl[0]).not.toBe(B.TNT); expect(pl[0]).not.toBe(B.WOODEN_PRESSURE_PLATE); }
    }
    expect(plates).toBeGreaterThan(20);
  });

  it('the crypt is sealed under a marked spot in the shrine floor and holds two chests', () => {
    const h = halls[0];
    expect(sporehallBlock(h, 0, 0, -7)[0]).toBe(B.CHISELED_STONE_BRICKS);
    expect(sporehallBlock(h, 1, 0, -8)[0]).toBe(B.CHISELED_STONE_BRICKS);
    expect(sporehallBlock(h, 0, 0, -8)[0]).not.toBe(B.CHISELED_STONE_BRICKS);
    for (const [u, hh, v] of [[0, -3, -8], [2, -2, -10], [-2, -4, -7]]) expect([B.AIR, B.CHEST, B.LANTERN, B.BROWN_MUSHROOM, B.COBWEB]).toContain(sporehallBlock(h, u, hh, v)[0]);
    for (const [u, hh, v] of [[3, -3, -8], [0, -3, -11], [0, -3, -5], [0, -5, -8]]) expect(SOLID[sporehallBlock(h, u, hh, v)[0]]).toBeTruthy(); // the shell
    expect(sporehallChestCells(h).filter((c) => c.h < 0)).toHaveLength(2);
  });
});

describe('guards', () => {
  const stands = (rd, [x, y, z]) => !SOLID[rd.get(x, y, z)[0]] && !SOLID[rd.get(x, y + 1, z)[0]] && !!SOLID[rd.get(x, y - 1, z)[0]];

  it('uses mobs that exist, and the Warden is a tough named archer', () => {
    for (const k of ['rime_rattler', 'shambler', 'marauder', 'skitterer']) expect(MOBS[k]).toBeTruthy();
    expect(RIMEKEEP_WARDEN.type).toBe('rime_rattler');
    expect(EQUIP_KINDS[RIMEKEEP_WARDEN.type]).toBe('archer');
    expect(RIMEKEEP_WARDEN.hp).toBeGreaterThan(MOBS.rime_rattler.health * 3);
    expect(RIMEKEEP_WARDEN.name.length).toBeLessThanOrEqual(32);
    for (const piece of ['DIAMOND_HELMET', 'DIAMOND_CHESTPLATE', 'DIAMOND_LEGGINGS', 'DIAMOND_BOOTS']) expect(I[piece]).toBeTruthy();
  });

  it('Rimekeep guards stand on floors, with one Warden in the throne room', () => {
    for (const k of keeps) {
      const rd = reader(gen), gs = rimekeepGuards(k);
      expect(gs.filter((g) => g.warden)).toHaveLength(1);
      expect(gs).toHaveLength(10);
      const w = gs.find((g) => g.warden);
      expect(w.y - k.y).toBe(14);
      expect(gs.filter((g) => stands(rd, [g.x, g.y, g.z])).length).toBe(gs.length);
    }
  });

  it('Sporehall guards stand on floors inside the maze and the shrine', () => {
    for (const h of halls) {
      const rd = reader(gen), gs = sporehallGuards(h);
      expect(gs.filter((g) => g.type === 'skitterer')).toHaveLength(4);
      expect(gs.filter((g) => g.type === 'shambler')).toHaveLength(2);
      expect(gs.filter((g) => stands(rd, [g.x, g.y, g.z])).length).toBe(gs.length);
    }
  });

  it('keeps no guard where a chest stands', () => {
    for (const h of halls) {
      const cells = new Set(sporehallChests(h).map((c) => `${c.x},${c.y},${c.z}`));
      for (const g of sporehallGuards(h)) expect(cells.has(`${g.x},${g.y},${g.z}`)).toBe(false);
    }
  });
});
