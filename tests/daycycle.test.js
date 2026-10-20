import { describe, it, expect } from 'vitest';
import { runCommand, HELP, GAME_RULES } from '../src/ui/commands.js';
import { MobSpawner } from '../src/mobs/spawner.js';
import { darkSpawnProbability } from '../src/mobs/spawnRules.js';
import { skyState, findNextPhase } from '../src/sky/suns.js';
import { MOBS, CATEGORY } from '../src/mobs/mobTypes.js';
import { B } from '../src/world/blocks.js';
import { BIOME } from '../src/world/biomes.js';

function fakeGame(settings = {}) {
  const g = { settings: { daylightCycle: true, hostileMobs: true, ...settings }, time: 0, changed: [] };
  g.setSetting = (k, v) => { g.settings[k] = v; g.changed.push([k, v]); };
  return g;
}

describe('/gamerule', () => {
  it('is listed in /help', () => {
    expect(HELP.some((l) => l.includes('/gamerule doDaylightCycle'))).toBe(true);
    expect(Object.keys(GAME_RULES)).toContain('doDaylightCycle');
  });
  it('switches the day/night cycle off and on', () => {
    const g = fakeGame();
    expect(runCommand(g, '/gamerule doDaylightCycle false')).toMatch(/now set to: false/);
    expect(g.settings.daylightCycle).toBe(false);
    expect(runCommand(g, '/gamerule doDaylightCycle')).toMatch(/currently set to: false/);
    expect(runCommand(g, '/gamerule dodaylightcycle true')).toMatch(/now set to: true/);
    expect(g.settings.daylightCycle).toBe(true);
  });
  it('switches hostile spawning and rejects bad input', () => {
    const g = fakeGame();
    runCommand(g, '/gamerule doHostileSpawning false');
    expect(g.settings.hostileMobs).toBe(false);
    expect(runCommand(g, '/gamerule doDaylightCycle maybe')).toMatch(/Usage/);
    expect(runCommand(g, '/gamerule nope true')).toMatch(/Usage/);
  });
  it('/time set still works while the cycle is frozen', () => {
    const g = fakeGame({ daylightCycle: false });
    runCommand(g, '/time set night');
    expect(skyState(g.time).aboveCount).toBe(0);
  });
});

// Flat grass world at y=63 lit only by the sky; the player stands in the middle.
function spawnWorld(time, settings) {
  const surface = 63;
  const world = {
    getBlock: (x, y) => (y <= surface ? (y === surface ? B.GRASS : B.STONE) : B.AIR),
    skyLight: (x, y) => (y > surface ? 15 : 0),
    blockLight: () => 0,
    heightAt: () => surface,
    isLoaded: () => true,
    isChunkLoaded: () => true,
    biomeAt: () => BIOME.PLAINS,
  };
  const list = [];
  const game = {
    world, time, ticks: 1, settings: { hostileMobs: true, ...settings },
    sky: { state: skyState(time) },
    player: { x: 8, y: surface + 1, z: 8, dead: false },
    chunks: { renderDistance: 8 },
    entities: { list, add: (e) => list.push(e) },
  };
  const spawner = new MobSpawner(game);
  // keep the test independent from the mob model code: record spawns only
  spawner.spawnMob = (type, x, y, z) => { const m = { kind: 'mob', type, x, y, z, dead: false, def: MOBS[type] }; list.push(m); return m; };
  return { game, spawner, list };
}

describe('night-time surface spawning', () => {
  const night = findNextPhase(0, 'night');
  const noon = (() => { for (let t = 0; t < 2_000_000; t += 20) if (skyState(t).combined > 0.95) return t; return 0; })();

  it('the surface light test passes often at night and never at noon', () => {
    expect(skyState(night).aboveCount).toBe(0);
    expect(darkSpawnProbability(15, 0, skyState(night).skyDarken)).toBeGreaterThan(0.1);
    expect(darkSpawnProbability(15, 0, skyState(noon).skyDarken)).toBe(0);
  });

  it('Shamblers, Skitterers and Rattlers spawn on the surface at night', () => {
    const { spawner, list } = spawnWorld(night);
    for (let i = 0; i < 40; i++) spawner.tick();
    const types = new Set(list.filter((e) => e.def.category === CATEGORY.MONSTER).map((e) => e.type));
    expect(types.has('shambler')).toBe(true);
    expect(types.has('skitterer')).toBe(true);
    expect(types.has('rattler')).toBe(true);
    for (const e of list) if (e.def.category === CATEGORY.MONSTER) expect(e.y).toBe(64);
  });

  it('cave monsters filling the cap do not keep the surface empty at night', () => {
    const { spawner, list } = spawnWorld(night);
    for (let i = 0; i < 70; i++) list.push({ kind: 'mob', type: 'fizzler', x: 8 + i, y: 10, z: 40, dead: false, def: MOBS.fizzler });
    for (let i = 0; i < 40; i++) spawner.tick();
    expect(list.filter((e) => e.def.category === CATEGORY.MONSTER && e.y === 64).length).toBeGreaterThan(0);
  });

  it('no monsters spawn on the surface at noon', () => {
    const { spawner, list } = spawnWorld(noon);
    for (let i = 0; i < 40; i++) spawner.tick();
    expect(list.filter((e) => e.def.category === CATEGORY.MONSTER)).toHaveLength(0);
  });

  it('no monsters spawn at night when hostile mobs are switched off', () => {
    const { spawner, list } = spawnWorld(night, { hostileMobs: false });
    for (let i = 0; i < 40; i++) spawner.tick();
    expect(list.filter((e) => e.def.category === CATEGORY.MONSTER)).toHaveLength(0);
  });
});
