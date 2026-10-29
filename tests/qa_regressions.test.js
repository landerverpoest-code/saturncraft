// Regression tests for bugs found in a play-through QA pass.
import { describe, it, expect, vi } from 'vitest';
import { MobSpawner } from '../src/mobs/spawner.js';
import { MOBS, CATEGORY } from '../src/mobs/mobTypes.js';
import { scaledCap } from '../src/mobs/spawnRules.js';
import { skyState } from '../src/sky/suns.js';
import { B } from '../src/world/blocks.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { cidx } from '../src/world/constants.js';
import { DimensionManager } from '../src/world/dimensions/manager.js';
import { Player } from '../src/player/player.js';

describe('Cinderdeep monster spawning', () => {
  // a cavern: floor at y 40, roof from y 120 up (the heightmap reads the roof)
  function cinderWorld() {
    const world = {
      dimension: 'cinderdeep',
      getBlock: (x, y) => (y <= 40 || y >= 120 ? B.CINDERSTONE : B.AIR),
      getMeta: () => 0,
      skyLight: () => 0,
      blockLight: () => 0,
      heightAt: () => 127,
      isLoaded: () => true,
      isChunkLoaded: () => true,
      biomeAt: () => 0,
    };
    const list = [];
    const game = {
      world, time: 0, ticks: 1, settings: { hostileMobs: true }, difficulty: 'normal',
      sky: { state: skyState(0) },
      player: { x: 8, y: 41, z: 8, dead: false },
      chunks: { renderDistance: 4 },
      entities: { list, add: (e) => list.push(e) },
    };
    const spawner = new MobSpawner(game);
    spawner.spawnMob = (type, x, y, z) => { const m = { kind: 'mob', type, x, y, z, dead: false, def: MOBS[type] }; list.push(m); return m; };
    return { spawner, list };
  }

  it('stays near the monster cap instead of spawning without limit', () => {
    const { spawner, list } = cinderWorld();
    for (let i = 0; i < 400; i++) spawner.tick();
    const monsters = list.filter((e) => e.def.category === CATEGORY.MONSTER).length;
    const cap = scaledCap(CATEGORY.MONSTER, 9 * 9);
    expect(monsters).toBeGreaterThan(0);
    // one tick's pass may overshoot the cap a little, but never runs away
    expect(monsters).toBeLessThan(cap * 2);
  });

  // The test above used to fail about one run in 16: a sweep over all 81 chunks kept going after the cap
  // was reached, so a tick that started just under the cap could end far over it (random, 19 up to 50).
  it('never overshoots the cap by more than one pack, however the dice fall', () => {
    const cap = scaledCap(CATEGORY.MONSTER, 9 * 9);
    for (let run = 0; run < 25; run++) {
      const { spawner, list } = cinderWorld();
      for (let i = 0; i < 200; i++) {
        spawner.tick();
        // a pack in the Cinderdeep is at most 4 mobs, and a pass only starts below the cap
        expect(list.filter((e) => e.def.category === CATEGORY.MONSTER).length).toBeLessThanOrEqual(cap - 1 + 4);
      }
    }
  });

  it('a sweep stops as soon as the room left under the cap is used up', () => {
    const { spawner } = cinderWorld();
    const chunks = [];
    for (let x = 0; x < 9; x++) for (let z = 0; z < 9; z++) chunks.push([x, z]);
    let calls = 0;
    spawner.attempt = () => { calls++; return 3; };
    expect(spawner.sweep({ idle: 0 }, chunks, CATEGORY.MONSTER, false, 5)).toBe(6);
    expect(calls).toBe(2);
    calls = 0;
    expect(spawner.sweep({ idle: 0 }, chunks, CATEGORY.MONSTER, false)).toBe(81 * 3); // no room given: the whole sweep, as before
    expect(calls).toBe(81);
  });

  it('a sweep with limited room still visits every chunk over time (no fixed favourites)', () => {
    const { spawner } = cinderWorld();
    const chunks = [];
    for (let x = 0; x < 9; x++) for (let z = 0; z < 9; z++) chunks.push([x, z]);
    const seen = new Set();
    spawner.attempt = (cx, cz) => { seen.add(cx + ',' + cz); return 1; };
    let k = 0;
    const rnd = vi.spyOn(Math, 'random').mockImplementation(() => (k++ % 81) / 81); // a fixed walk through the start positions
    try { for (let i = 0; i < 81; i++) spawner.sweep({ idle: 0 }, chunks, CATEGORY.MONSTER, false, 1); } finally { rnd.mockRestore(); }
    expect(seen.size).toBe(81);
  });
});

describe('world spawn', () => {
  // seed 42's first candidate column sat over a cave mouth that floods to sea level
  it.each([42, 8, 7, 1234])('seed %i spawns on dry, whole ground', (seed) => {
    const gen = new TerrainGenerator(seed);
    const sp = gen.findSpawn();
    const x = Math.floor(sp.x), z = Math.floor(sp.z);
    const ch = gen.generate(x >> 4, z >> 4);
    const lx = x & 15, lz = z & 15, top = sp.y - 1;
    expect(ch.blocks[cidx(lx, top, lz)]).not.toBe(B.AIR);
    for (let y = top; y <= ch.heightmap[lx + lz * 16]; y++) {
      expect([B.WATER, B.LAVA, B.ICE]).not.toContain(ch.blocks[cidx(lx, y, lz)]);
    }
  });
});

describe('a Void Wyrm outside the Hollow', () => {
  function fakeDims(dimension) {
    const toasts = [];
    const dm = Object.create(DimensionManager.prototype);
    dm.game = { world: { dimension, dimGenerator: null, isChunkLoaded: () => true }, hud: { toast: (t) => toasts.push(t) }, milestones: null };
    dm.hollow = { defeated: false, crystals: [true, true], wyrmHealth: 200 };
    dm.beam = { visible: false };
    return { dm, toasts };
  }
  it('circles at a fixed height when there is no Hollow island', () => {
    const { dm } = fakeDims('overworld');
    expect(dm.wyrmCircleY()).toBeGreaterThan(64);
  });
  it('slain in the overworld, does not open the Hollow\'s gates', () => {
    const { dm, toasts } = fakeDims('overworld');
    expect(() => dm.onWyrmSlain()).not.toThrow();
    expect(dm.hollow.defeated).toBe(false);
    expect(toasts.length).toBe(0);
    dm.onCrystalDestroyed({ crystalIndex: 0 });
    expect(dm.hollow.crystals[0]).toBe(true);
  });
});

describe('/kill under Resistance V', () => {
  it('kills instead of leaving the health NaN', () => {
    const p = new Player();
    p.applyEffect('resistance', 600, 4);
    p.hurt(Infinity, 'kill');
    expect(Number.isNaN(p.health)).toBe(false);
    expect(p.health).toBe(0);
    expect(p.dead).toBe(true);
  });
});
