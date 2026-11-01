import { describe, it, expect, vi } from 'vitest';
import {
  newStats, loadStats, saveStats, recordKill, recordMove, moveMode, formatDistance, formatTime, killRows, statRows, MAX_STEP,
} from '../src/player/stats.js';
import { MILESTONES, Milestones, SIGHT_RANGE, AURORA_SEEN } from '../src/player/milestones.js';
import { Player } from '../src/player/player.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { sunkenRuinInRegion } from '../src/world/sunkenRuins.js';
import { sunTombInRegion } from '../src/world/sunTombs.js';
import { skywatchInRegion } from '../src/world/skywatch.js';
import { riftStarts, riftPaths, inGreatRift } from '../src/world/carvers.js';
import { lakeIn, lakeDist, domeHeight, inMagmaLake, LAKE_REGION } from '../src/world/magmaLakes.js';
import { BIOME } from '../src/world/biomes.js';
import { B } from '../src/world/blocks.js';
import { MockWorld } from './helpers.js';

const SEED = 12345;
const gen = new TerrainGenerator(SEED);
const ms = (id) => MILESTONES.find((m) => m.id === id);

describe('statistics counters', () => {
  it('start at zero and round-trip through a save', () => {
    const s = newStats();
    expect(Object.values(s).filter((v) => typeof v === 'number').every((v) => v === 0)).toBe(true);
    s.blocksMined = 12; s.blocksPlaced = 7; s.deaths = 2; s.trades = 3; s.ticks = 4000;
    recordKill(s, 'shambler'); recordKill(s, 'shambler'); recordKill(s, 'rattler');
    recordMove(s, 1.5, 2, 'walk'); recordMove(s, 0, 2.25, 'swim'); recordMove(s, 1, 0, 'glide');
    const back = loadStats(JSON.parse(JSON.stringify(saveStats(s))));
    expect(back).toEqual(saveStats(s));
    expect(back.kills).toBe(3);
    expect(back.killsBy).toEqual({ shambler: 2, rattler: 1 });
    expect(back.walked).toBeCloseTo(2.5);
    expect(back.swum).toBeCloseTo(2.3, 1);
  });

  it('an old save without statistics, or a damaged one, loads as zeros', () => {
    expect(loadStats(undefined)).toEqual(newStats());
    expect(loadStats('junk')).toEqual(newStats());
    const bad = loadStats({ blocksMined: -4, kills: NaN, deaths: 'x', walked: Infinity, ticks: 12.9, killsBy: { shambler: 'a', rattler: 2.7, '': 0 } });
    expect(bad.blocksMined).toBe(0);
    expect(bad.kills).toBe(0);
    expect(bad.deaths).toBe(0);
    expect(bad.walked).toBe(0);
    expect(bad.ticks).toBe(12);
    expect(bad.killsBy).toEqual({ rattler: 2 });
  });

  it('loading copies: the saved object and the live one are separate', () => {
    const s = newStats(); recordKill(s, 'shambler');
    const copy = loadStats(s);
    recordKill(s, 'shambler');
    expect(copy.killsBy.shambler).toBe(1);
  });

  it('kills count in total and by kind, even for a stats object that lacks the table', () => {
    const s = { kills: 0 };
    recordKill(s, 'wobbler'); recordKill(s, undefined);
    expect(s.kills).toBe(2);
    expect(s.killsBy).toEqual({ wobbler: 1 });
  });

  it('movement adds up by mode and ignores teleports, standing still and NaN', () => {
    const s = newStats();
    recordMove(s, 0, 0, 'walk'); recordMove(s, NaN, 1, 'walk'); recordMove(s, MAX_STEP + 1, 0, 'walk'); recordMove(s, 200, 200, 'swim');
    expect(s.walked + s.swum + s.glided).toBe(0);
    recordMove(s, 0.2, 0, 'walk'); recordMove(s, 0, 0.3, 'swim'); recordMove(s, 2, 0, 'glide'); recordMove(s, 0.1, 0, 'whatever');
    expect(s.walked).toBeCloseTo(0.3);
    expect(s.swum).toBeCloseTo(0.3);
    expect(s.glided).toBeCloseTo(2);
  });
});

describe('statistics display', () => {
  it('formats distances and times', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(999.9)).toBe('999 m');
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatTime(0)).toBe('0 min 00 s');
    expect(formatTime(20 * 125)).toBe('2 min 05 s');
    expect(formatTime(20 * 3600 * 3 + 20 * 60 * 5)).toBe('3 h 05 min');
  });

  it('lists the kills with the most first and uses mob names', () => {
    const s = newStats();
    for (let i = 0; i < 3; i++) recordKill(s, 'rattler');
    recordKill(s, 'shambler');
    recordKill(s, 'ghost_of_a_mob');
    const rows = killRows(s, MOBS);
    expect(rows[0]).toMatchObject({ type: 'rattler', count: 3, name: MOBS.rattler.name });
    expect(rows.map((r) => r.count)).toEqual([3, 1, 1]);
    expect(rows.find((r) => r.type === 'ghost_of_a_mob').name).toBe('ghost_of_a_mob');
    expect(killRows(newStats(), MOBS)).toEqual([]);
  });

  it('has a row for every counter the pause menu promises', () => {
    const labels = statRows(newStats()).map((r) => r[0]);
    for (const w of ['Play time', 'Blocks mined', 'Blocks placed', 'walked', 'swum', 'glided', 'Deaths', 'Trades']) expect(labels.some((l) => l.includes(w))).toBe(true);
    const rows = statRows({ ...newStats(), blocksMined: 5, walked: 2400, ticks: 24000 });
    expect(rows.find((r) => r[0] === 'Blocks mined')[1]).toBe('5');
    expect(rows.find((r) => r[0] === 'Distance walked')[1]).toBe('2.4 km');
    expect(rows.find((r) => r[0] === 'Play time')[1]).toBe('20 min 00 s');
  });
});

describe('the player records statistics as it plays', () => {
  const IDLE = { forward: 0, strafe: 0, jump: false, sprint: false, sneak: false };

  it('counts ticks, walking distance and nothing for standing still', () => {
    const w = new MockWorld(64);
    const p = new Player();
    p.setPosition(0.5, 64, 0.5);
    for (let i = 0; i < 5; i++) p.tick(w, IDLE);
    expect(p.stats.ticks).toBe(5);
    expect(p.stats.walked).toBeLessThan(0.01);
    for (let i = 0; i < 40; i++) p.tick(w, { ...IDLE, forward: 1 });
    expect(p.stats.ticks).toBe(45);
    expect(p.stats.walked).toBeGreaterThan(3);
    expect(p.stats.swum).toBe(0);
  });

  it('a teleport (setPosition) is not distance travelled', () => {
    const w = new MockWorld(64);
    const p = new Player();
    p.setPosition(0.5, 64, 0.5); p.tick(w, IDLE);
    p.setPosition(500.5, 64, 0.5); p.tick(w, IDLE);
    expect(p.stats.walked).toBeLessThan(0.1);
  });

  it('riding, flying and sleeping count as no travel; gliding and swimming as their own', () => {
    const p = new Player();
    p.body.inWater = false;
    expect(moveMode(p)).toBe('walk');
    p.body.inWater = true; expect(moveMode(p)).toBe('swim'); p.body.inWater = false;
    p.swimming = true; expect(moveMode(p)).toBe('swim'); p.swimming = false;
    p.gliding = true; expect(moveMode(p)).toBe('glide'); p.gliding = false;
    p.riding = {}; expect(moveMode(p)).toBe(null); p.riding = null;
    p.flying = true; expect(moveMode(p)).toBe(null); p.flying = false;
    p.sleeping = true; expect(moveMode(p)).toBe(null); p.sleeping = false;
    p.dead = true; expect(moveMode(p)).toBe(null);
  });

  it('a tick reuses the statistics object (nothing is allocated for them)', () => {
    const p = new Player();
    const s = p.stats, k = p.stats.killsBy;
    const w = new MockWorld(64);
    p.setPosition(0.5, 64, 0.5);
    for (let i = 0; i < 10; i++) p.tick(w, { ...IDLE, forward: 1 });
    expect(p.stats).toBe(s);
    expect(p.stats.killsBy).toBe(k);
  });
});

describe('milestones for the recent features', () => {
  const NEW = ['chart', 'sunken', 'tomb', 'skywatch', 'peddler', 'parry', 'offhand', 'carve', 'auto_rail', 'auto_plate', 'meadow', 'great_rift', 'magma_lake', 'veilfire'];

  it('exist once each with a title, a description and an icon', () => {
    for (const id of NEW) {
      const m = ms(id);
      expect(m, id).toBeTruthy();
      expect(m.title.length).toBeGreaterThan(2);
      expect(m.desc.length).toBeGreaterThan(5);
      expect(m.icon, id).toBeGreaterThan(0);
      expect(!!(m.event || m.tick || m.inv), id).toBe(true);
    }
    const ids = MILESTONES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('say nothing of the reference game by name', () => {
    for (const m of MILESTONES) expect(`${m.title} ${m.desc}`).not.toMatch(/minecraft|nether|redstone|\bend\b/i);
  });

  function fakeGame(over = {}) {
    const inv = { count: vi.fn(() => 0), armor: [] };
    return {
      player: { x: 0, y: 70, z: 0, inventory: inv, ...over.player },
      world: { dimension: 'overworld', gen, biomeAt: () => BIOME.PLAINS, ...over.world },
      sky: { aurora: 0, ...over.sky },
      hud: { milestone: vi.fn() }, audio: { play: vi.fn() },
    };
  }

  it('events unlock the milestones that listen for them, once', () => {
    const g = fakeGame();
    const m = new Milestones(g);
    for (const id of ['chart', 'peddler', 'parry', 'offhand', 'carve']) {
      expect(m.done.has(id)).toBe(false);
      m.event(id);
      m.event(id);
      expect(m.done.has(id)).toBe(true);
    }
    expect(g.hud.milestone).toHaveBeenCalledTimes(5);
    const m2 = new Milestones(fakeGame());
    m2.load(m.save());
    expect([...m2.done].sort()).toEqual([...m.done].sort());
  });

  it('cinnabar rails and plates unlock from the inventory', () => {
    for (const [id, items] of [['auto_rail', [B.POWERED_RAIL, B.DETECTOR_RAIL, B.ACTIVATOR_RAIL]], ['auto_plate', [B.STONE_PRESSURE_PLATE, B.LIGHT_WEIGHTED_PLATE, B.HEAVY_WEIGHTED_PLATE]]]) {
      for (const it of items) {
        const g = fakeGame();
        g.player.inventory.count = (x) => (x === it ? 1 : 0);
        expect(ms(id).inv(g), `${id} ${it}`).toBe(true);
      }
      expect(ms(id).inv(fakeGame())).toBe(false);
    }
    // a plain Rail or wooden plate is not the cinnabar kind
    const g = fakeGame(); g.player.inventory.count = (x) => (x === B.RAIL || x === B.WOODEN_PRESSURE_PLATE ? 1 : 0);
    expect(ms('auto_rail').inv(g) || ms('auto_plate').inv(g)).toBe(false);
  });

  function findSite(find, R) {
    for (let r = 0; r <= R; r++) for (let rx = -r; rx <= r; rx++) for (let rz = -r; rz <= r; rz++) {
      if (Math.max(Math.abs(rx), Math.abs(rz)) !== r) continue;
      const s = find(gen, rx, rz);
      if (s) return s;
    }
    return null;
  }

  it('finding a Sunken Ruin, Sun Tomb or Skywatch Tower is checked by walking up to it', () => {
    for (const [id, find, R] of [['sunken', sunkenRuinInRegion, 8], ['tomb', sunTombInRegion, 10], ['skywatch', skywatchInRegion, 10]]) {
      const site = findSite(find, R);
      expect(site, id).toBeTruthy();
      expect(ms(id).tick(fakeGame({ player: { x: site.cx, y: 70, z: site.cz } })), `${id} at its centre`).toBe(true);
      expect(ms(id).tick(fakeGame({ player: { x: site.cx + 5, y: 70, z: site.cz - 5 } })), `${id} just off`).toBe(true);
      expect(ms(id).tick(fakeGame({ player: { x: site.x1 + SIGHT_RANGE + 5, y: 70, z: site.cz } })), `${id} far east`).toBe(false);
      expect(ms(id).tick(fakeGame({ player: { x: site.cx, y: 70, z: site.cz }, world: { dimension: 'cinderdeep' } })), `${id} in another dimension`).toBe(false);
    }
  });

  it('the Highland Meadow, Veilfire and the dimension rule', () => {
    expect(ms('meadow').tick(fakeGame())).toBe(false);
    expect(ms('meadow').tick(fakeGame({ world: { biomeAt: () => BIOME.HIGHLAND_MEADOW } }))).toBe(true);
    expect(ms('meadow').tick(fakeGame({ world: { biomeAt: () => BIOME.HIGHLAND_MEADOW, dimension: 'hollow' } }))).toBe(false);
    expect(ms('veilfire').tick(fakeGame({ sky: { aurora: AURORA_SEEN - 0.1 } }))).toBe(false);
    expect(ms('veilfire').tick(fakeGame({ sky: { aurora: AURORA_SEEN + 0.1 } }))).toBe(true);
    expect(ms('veilfire').tick(fakeGame({ sky: { aurora: 1 }, world: { dimension: 'hollow' } }))).toBe(false);
  });

  it('a Great Rift is found where the carved spheres are, and only there', () => {
    let found = null;
    for (let sx = -60; sx < 60 && !found; sx++) for (let sz = -60; sz < 60 && !found; sz++) if (riftStarts(SEED, sx, sz)) found = [sx, sz];
    expect(found).toBeTruthy();
    const ops = riftPaths(SEED, found[0], found[1]);
    expect(ops.length).toBeGreaterThan(0);
    expect(inGreatRift(SEED, ops[0], ops[1], ops[2])).toBe(true);
    expect(ms('great_rift').tick(fakeGame({ player: { x: ops[0], y: ops[1], z: ops[2] } }))).toBe(true);
    expect(inGreatRift(SEED, ops[0], ops[1] + 400, ops[2])).toBe(false);
    expect(ms('great_rift').tick(fakeGame({ player: { x: ops[0], y: ops[1], z: ops[2] }, world: { dimension: 'cinderdeep' } }))).toBe(false);
  });

  it('a Magma Lake is found over its lava and under its dome', () => {
    let lake = null;
    for (let rx = -20; rx < 20 && !lake; rx++) for (let rz = -20; rz < 20 && !lake; rz++) { const l = lakeIn(SEED, rx, rz); if (l) lake = { l, rx, rz }; }
    expect(lake).toBeTruthy();
    const { l } = lake;
    expect(lake.rx).toBe(Math.floor(l.x / LAKE_REGION));
    expect(lakeDist(SEED, l, l.x, l.z)).toBeLessThan(1);
    expect(inMagmaLake(SEED, l.x, l.y + 2, l.z)).toBe(true);
    expect(inMagmaLake(SEED, l.x, l.y + l.h + 30, l.z)).toBe(false);
    expect(inMagmaLake(SEED, l.x + l.r * 3, l.y + 2, l.z)).toBe(false);
    expect(domeHeight(l, 0)).toBeGreaterThan(1);
    expect(ms('magma_lake').tick(fakeGame({ player: { x: l.x, y: l.y + 2, z: l.z } }))).toBe(true);
    expect(ms('magma_lake').tick(fakeGame({ player: { x: l.x, y: 70, z: l.z } }))).toBe(false);
  });
});

describe('performance stays neutral', () => {
  it('a milestone check only evaluates the milestones not yet done', () => {
    const g = { player: { x: 0, y: 70, z: 0, inventory: { count: () => 0, armor: [] } }, world: { dimension: 'overworld', gen, biomeAt: () => BIOME.PLAINS }, sky: { aurora: 0, state: { aboveCount: 3 } }, hud: { milestone() {} }, audio: { play() {} } };
    const m = new Milestones(g);
    for (const x of MILESTONES) m.done.add(x.id);
    const spy = vi.fn(() => false);
    const probe = { id: '__probe', title: 't', desc: 'd', icon: 1, tick: spy, inv: spy };
    MILESTONES.push(probe); m.done.add('__probe');
    m.tick(); m.checkInventory();
    expect(spy).not.toHaveBeenCalled();
    MILESTONES.pop();
  });

  it('one stats update per tick is a handful of additions', () => {
    const s = newStats();
    const t0 = performance.now();
    for (let i = 0; i < 200000; i++) { s.ticks++; recordMove(s, 0.2, 0.1, 'walk'); }
    expect(performance.now() - t0).toBeLessThan(500);
    expect(s.ticks).toBe(200000);
  });
});
