// Regression tests for bugs found in a play-through QA pass.
import { describe, it, expect } from 'vitest';
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
