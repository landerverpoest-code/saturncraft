// Third performance pass (after seasons, soundscapes, new structures, companions, fireworks...): cheap guards on op
// counts, caches and allocation, not on timings. The measurements are in the README (Performance).
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/world.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { runRandomTicks, RANDOM_TICKS } from '../src/world/randomTicks.js';
import { rleEncode, rleDecode, packChunk, packStats } from '../src/world/save.js';
import { sameFw } from '../src/world/fireworks.js';
import { EntityManager } from '../src/entities/entities.js';
import { Game } from '../src/game.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { stampRimekeeps } from '../src/world/rimekeep.js';
import { stampSporehalls } from '../src/world/sporehall.js';
import { stampSunTombs } from '../src/world/sunTombs.js';
import { stampSkywatches } from '../src/world/skywatch.js';
import { stampSunkenRuins } from '../src/world/sunkenRuins.js';
import { measureRoom, ROOM_RAYS, RAY_RANGE } from '../src/audio/acoustics.js';
import { B } from '../src/world/blocks.js';
import { CHUNK_VOLUME, SECTION_COUNT, cidx, MIN_Y } from '../src/world/constants.js';
import { rng } from './helpers.js';

function chunkData(fill) {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < MIN_Y + 384; y++) blocks[cidx(x, y, z)] = fill(x, y, z);
  const light = new Uint8Array(CHUNK_VOLUME);
  computeChunkLight(blocks, light);
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) };
}
const ground = (x, y) => (y < 60 ? B.STONE : y < 64 ? B.DIRT : y === 64 ? B.GRASS : 0);

describe('random ticks skip sections without tickable blocks', () => {
  it('keeps a per-section count of tickable blocks that follows every edit', () => {
    const w = new World(1);
    w.addChunk(0, 0, chunkData(ground));
    const c = w.getChunk(0, 0);
    const brute = () => {
      const out = new Uint16Array(SECTION_COUNT);
      for (let i = 0; i < c.blocks.length; i++) if (RANDOM_TICKS[c.blocks[i]]) out[i >> 12]++;
      return out;
    };
    expect([...c.sectionTick]).toEqual([...brute()]);
    expect(c.sectionTick.reduce((a, b) => a + b, 0)).toBe(256); // the grass layer only
    const r = rng(5), pool = [B.GRASS, B.STONE, B.AIR, B.OAK_LEAVES, B.LAVA, B.DIRT, B.WATER, B.FIRE];
    for (let k = 0; k < 400; k++) w.setBlock(Math.floor(r() * 16), MIN_Y + Math.floor(r() * 384), Math.floor(r() * 16), pool[Math.floor(r() * pool.length)], 0, false);
    expect([...c.sectionTick]).toEqual([...brute()]);
  });

  it('draws random numbers only for sections that have something to tick', () => {
    const w = new World(1);
    for (let cx = 0; cx < 3; cx++) for (let cz = 0; cz < 3; cz++) w.addChunk(cx, cz, chunkData(ground));
    let draws = 0;
    const counting = () => { draws++; return 0.99; };
    runRandomTicks(w, 1, 1, 1, counting);
    // 9 chunks, one section each holds the grass layer: 3 picks each; the ~20 stone/air sections draw nothing
    expect(draws).toBe(9 * 3);
    w.setBlock(8 + 16, 100, 8 + 16, B.OAK_LEAVES, 0, false); // one leaf block in the middle chunk wakes its section up
    draws = 0;
    runRandomTicks(w, 1, 1, 1, counting);
    expect(draws).toBe(9 * 3 + 3);
    w.setBlock(8 + 16, 100, 8 + 16, B.AIR, 0, false);
    draws = 0;
    runRandomTicks(w, 1, 1, 1, counting);
    expect(draws).toBe(9 * 3);
  });
});

describe('autosave packing', () => {
  it('encodes run lengths exactly like the plain version and decodes back', () => {
    const ref = (arr) => { const out = []; let i = 0; while (i < arr.length) { const v = arr[i]; let n = 1; while (i + n < arr.length && arr[i + n] === v && n < 255) n++; out.push(v, n); i += n; } return arr instanceof Uint16Array ? Uint16Array.from(out) : Uint8Array.from(out); };
    const r = rng(3);
    for (const T of [Uint8Array, Uint16Array]) {
      for (const mode of ['noise', 'runs', 'flat']) {
        const a = new T(20000);
        for (let i = 0; i < a.length; i++) a[i] = mode === 'noise' ? Math.floor(r() * 300) : mode === 'runs' ? (i >> 6) % 7 : 9;
        const e = rleEncode(a);
        expect(e.constructor).toBe(T);
        expect(Buffer.from(e.buffer, e.byteOffset, e.byteLength).equals(Buffer.from(ref(a).buffer))).toBe(true);
        expect([...rleDecode(e, a.length, T)]).toEqual([...a]);
      }
    }
    expect(rleEncode(new Uint16Array(0)).length).toBe(0);
  });

  it('re-encodes a chunk only when its blocks or light changed', () => {
    const w = new World(1);
    w.addChunk(0, 0, chunkData(ground));
    const c = w.getChunk(0, 0);
    const p0 = { ...packStats };
    const a = packChunk(c), b = packChunk(c), d = packChunk(c);
    expect(b).toBe(a); expect(d).toBe(a);
    expect(packStats.packed - p0.packed).toBe(1);
    expect(packStats.reused - p0.reused).toBe(2);
    w.setBlock(3, 70, 3, B.STONE, 0, false);
    const e = packChunk(c);
    expect(e).not.toBe(a);
    expect(Buffer.from(e.blocks.buffer).equals(Buffer.from(rleEncode(c.blocks).buffer))).toBe(true);
    w.setLight(2, 90, 2, 0x35);
    const f = packChunk(c);
    expect(f).not.toBe(e);
    expect(Buffer.from(f.light.buffer).equals(Buffer.from(rleEncode(c.light).buffer))).toBe(true);
    w.setLight(2, 90, 2, 0x35); // no change: still the same copy
    expect(packChunk(c)).toBe(f);
    // unloading and loading again keeps the copy (and its validity)
    w.removeChunk(0, 0);
    const again = w.addChunk(0, 0, null);
    expect(packChunk(again)).toBe(f);
    w.setBlock(3, 71, 3, B.STONE, 0, false);
    expect(packChunk(again)).not.toBe(f);
  });
});

describe('per-tick allocation', () => {
  const stubGame = () => ({ scene: { add() {}, remove() {} }, ticks: 1, net: null, player: { dead: true, body: { box: () => [0, 0, 0, 0, 0, 0] } } });

  it('the entity list is compacted in place and still drops what it dropped before', () => {
    const g = stubGame(), em = new EntityManager(g);
    const mk = (kind, extra = {}) => ({ kind, dead: false, removed: false, x: 0, y: 70, z: 0, tick() {}, ...extra });
    const keep1 = mk('mob'), deadItem = mk('item', { dead: true }), goneMob = mk('mob', { dead: true, removed: true }), dying = mk('mob', { dead: true }), liveGone = mk('mob', { removed: true }), keep2 = mk('boat');
    for (const e of [keep1, deadItem, goneMob, dying, liveGone, keep2]) em.add(e);
    g.world = { isLoaded: () => true };
    const list = em.list;
    em.tick();
    expect(em.list).toBe(list); // same array, no new one per tick
    expect(em.list).toEqual([keep1, dying, keep2]);
  });

  it('stack merging looks at the distance before the (costly) stack comparison', () => {
    const g = stubGame(), em = new EntityManager(g);
    g.ticks = 10; g.world = { isLoaded: () => true };
    const item = (x, count) => ({ kind: 'item', dead: false, x, y: 70, z: 0, pickupDelay: 5, stack: { id: B.COBBLESTONE, count }, tick() {} });
    const a = item(0, 3), near = item(0.2, 4), far = item(5, 2);
    em.add(a); em.add(near); em.add(far);
    em.tick();
    expect(a.stack.count).toBe(7); expect(near.dead).toBe(true); expect(far.dead).toBe(false);
  });

  it('plates are pressed without building a [x, y, z, living] array per entity', () => {
    const pressed = [];
    const stub = {
      net: null,
      world: { circuits: { enabled: true, queue: new Map(), press: (...a) => pressed.push(a), detect() {} }, getBlock: (x, y, z) => (x === 5 ? B.STONE_PRESSURE_PLATE : 0) },
      player: { dead: false, spectator: false, x: 0.5, y: 64, z: 0.5 },
      entities: { list: [{ dead: false, body: {}, kind: 'mob', x: 5.5, y: 64, z: 0 }, { dead: false, body: {}, kind: 'item', x: 5.5, y: 64, z: 0 }, { dead: false, body: {}, kind: 'xp', x: 5.5, y: 64, z: 0 }] },
      pressers() { throw new Error('allocates'); },
    };
    Game.prototype.tickCircuits.call(stub);
    expect(pressed).toEqual([[5, 64, 0]]); // the mob presses the stone plate; the item and the orb do not
  });

  it('sameFw answers the common no-data case without serialising anything', () => {
    const orig = JSON.stringify;
    let calls = 0;
    JSON.stringify = (...a) => { calls++; return orig(...a); };
    try {
      expect(sameFw(null, undefined)).toBe(true);
      expect(sameFw(undefined, null)).toBe(true);
      expect(calls).toBe(0);
      expect(sameFw({ f: 2 }, { f: 2 })).toBe(true);
      expect(sameFw({ f: 2 }, null)).toBe(false);
    } finally { JSON.stringify = orig; }
  });
});

describe('structure placement and room acoustics stay cheap', () => {
  it('the new structure stamps look their sites up once per region, then only read the cache', () => {
    const gen = new TerrainGenerator(42);
    let calls = 0;
    for (const k of ['column', 'surfaceAt', 'biomeFor', 'riverInBox']) {
      const f = gen[k];
      if (typeof f === 'function') gen[k] = function (...a) { calls++; return f.apply(this, a); };
    }
    const stamps = [stampRimekeeps, stampSporehalls, stampSunTombs, stampSkywatches, stampSunkenRuins];
    const spots = [[0, 0], [1, 0], [0, 1], [1, 1], [-5, 3], [7, -2]];
    const run = () => { for (const st of stamps) for (const [cx, cz] of spots) st(gen, new Uint16Array(CHUNK_VOLUME), new Uint8Array(CHUNK_VOLUME), cx, cz); };
    run();
    const first = calls;
    expect(first).toBeGreaterThan(0);
    calls = 0;
    run();
    expect(calls).toBe(0);
  });

  it('measuring a room reads at most rays x range blocks', () => {
    let reads = 0;
    const open = measureRoom(() => { reads++; return null; }, 0, 70, 0);
    expect(open.openness).toBe(1);
    expect(reads).toBeLessThanOrEqual(ROOM_RAYS.length * Math.ceil(RAY_RANGE));
    expect(reads).toBeLessThanOrEqual(400);
  });
});
