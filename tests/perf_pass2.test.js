// Second performance pass: cached carver tunnel paths, the throttled mob spawner and the lazy
// creative catalogue.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { B } from '../src/world/blocks.js';
import { cidx, CHUNK_VOLUME, MIN_Y } from '../src/world/constants.js';
import { MobSpawner, BACKOFF_AFTER, BACKOFF_STRIDE } from '../src/mobs/spawner.js';
import { MOBS, CATEGORY } from '../src/mobs/mobTypes.js';
import { skyState, findNextPhase } from '../src/sky/suns.js';
import { BIOME } from '../src/world/biomes.js';
import { createLazyRenderer } from '../src/ui/lazyIcons.js';
import { carveChunk, clearCarvePaths, carvePathCacheSize } from '../src/world/carvers.js';

const solid = () => { const b = new Uint8Array(CHUNK_VOLUME); for (let y = MIN_Y; y < 120; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) b[cidx(x, y, z)] = y < MIN_Y + 5 ? B.BEDROCK : B.STONE; return b; };
const surface = new Int16Array(256); for (let i = 0; i < 256; i++) surface[i] = 40 + ((i * 7) % 60); // part of it below the sea

function carveHash(order) {
  const h = createHash('sha256');
  let carved = 0;
  for (const seed of order) for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [-3, 5], [10, -12], [11, -12], [100, 100], [-40, -41]]) {
    const b = solid(); carved += carveChunk(seed, cx, cz, b, surface); h.update(b);
  }
  return { hash: h.digest('hex'), carved };
}

describe('carver path cache', () => {
  // The digest was taken from the generator before the cache existed (every chunk replayed the paths of all 17 x 17 sources).
  const REFERENCE = { hash: '9420d8710a417724c66c96c305c27134085f06dcd88b6db5fac6e310ccb8d64a', carved: 54258 };
  it('carves byte-identical chunks to the uncached generator, cold and warm', () => {
    clearCarvePaths();
    expect(carveHash([42, 7, 123456, -5])).toEqual(REFERENCE);
    expect(carvePathCacheSize()).toBeGreaterThan(0);
    expect(carveHash([42, 7, 123456, -5])).toEqual(REFERENCE); // everything now comes from the cache
  }, 30000);
  it('does not depend on what was cached before (other seeds, other order)', () => {
    clearCarvePaths();
    const a = solid(), b = solid();
    carveChunk(1, 5, 5, solid(), surface); carveChunk(2, 6, 5, solid(), surface); // fill with unrelated entries
    const n1 = carveChunk(42, 3, 3, a, surface);
    clearCarvePaths();
    const n2 = carveChunk(42, 3, 3, b, surface);
    expect(n1).toBe(n2);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
  it('stays bounded', () => {
    clearCarvePaths();
    for (let cx = 0; cx < 70; cx++) carveChunk(9, cx * 40, 0, solid(), surface); // 70 x 289 distinct sources
    expect(carvePathCacheSize()).toBeLessThanOrEqual(4096);
    expect(carvePathCacheSize()).toBeGreaterThan(289);
  }, 60000);
});

// Flat grass world lit only by the sky; the player stands in the middle (as in daycycle.test.js).
function spawnWorld(time) {
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
    world, time, ticks: 1, settings: { hostileMobs: true },
    sky: { state: skyState(time) },
    player: { x: 8, y: surface + 1, z: 8, dead: false },
    chunks: { renderDistance: 8 },
    entities: { list, add: (e) => list.push(e) },
  };
  const spawner = new MobSpawner(game);
  spawner.spawnMob = (type, x, y, z) => { const m = { kind: 'mob', type, x, y, z, dead: false, def: MOBS[type] }; list.push(m); return m; };
  let attempts = 0;
  const attempt = spawner.attempt.bind(spawner);
  spawner.attempt = (...a) => { attempts++; return attempt(...a); };
  return { game, spawner, list, attempts: () => attempts };
}

describe('mob spawner throttling', () => {
  const night = findNextPhase(0, 'night');
  const noon = (() => { for (let t = 0; t < 2_000_000; t += 20) if (skyState(t).combined > 0.95) return t; return 0; })();
  const CHUNKS = 17 * 17;

  it('backs off a pass that keeps finding nothing (daylight surface pass) to one chunk in a few per tick', () => {
    const w = spawnWorld(noon);
    for (let i = 0; i < BACKOFF_AFTER; i++) w.spawner.tick();
    const full = w.attempts() / BACKOFF_AFTER;
    expect(full).toBeGreaterThanOrEqual(CHUNKS); // the monster pass and the surface pass, every chunk, every tick
    const before = w.attempts();
    for (let i = 0; i < 40; i++) w.spawner.tick();
    const throttled = (w.attempts() - before) / 40;
    expect(throttled).toBeLessThanOrEqual(full / BACKOFF_STRIDE + 2);
    expect(throttled).toBeGreaterThan(0);
    expect(w.list.filter((e) => e.def.category === CATEGORY.MONSTER)).toHaveLength(0);
  });

  it('keeps every chunk in the rotation (each is tried once per BACKOFF_STRIDE ticks)', () => {
    const w = spawnWorld(noon);
    for (let i = 0; i < BACKOFF_AFTER + 2; i++) w.spawner.tick();
    const seen = new Set();
    const attempt = w.spawner.attempt;
    w.spawner.attempt = (cx, cz, cat, surface) => { if (!surface) seen.add(cx + ',' + cz); return attempt(cx, cz, cat, surface); };
    for (let i = 0; i < BACKOFF_STRIDE; i++) w.spawner.tick();
    expect(seen.size).toBe(CHUNKS);
  });

  it('never throttles while monsters can spawn: night spawning is full speed', () => {
    const w = spawnWorld(night);
    for (let i = 0; i < 60; i++) w.spawner.tick();
    expect(w.spawner.pass.surface.idle).toBeLessThan(BACKOFF_AFTER);
    const monsters = w.list.filter((e) => e.def.category === CATEGORY.MONSTER);
    expect(monsters.length).toBeGreaterThan(10);
    const types = new Set(monsters.map((e) => e.type));
    expect(types.has('shambler') && types.has('skitterer')).toBe(true);
  });

  it('returns to full speed after dusk', () => {
    const w = spawnWorld(noon);
    for (let i = 0; i < BACKOFF_AFTER + 10; i++) w.spawner.tick();
    expect(w.spawner.pass.surface.idle).toBeGreaterThanOrEqual(BACKOFF_AFTER);
    w.game.time = night; w.game.sky.state = skyState(night);
    for (let i = 0; i < 30; i++) w.spawner.tick();
    expect(w.spawner.pass.surface.idle).toBeLessThan(BACKOFF_AFTER);
    expect(w.list.filter((e) => e.def.category === CATEGORY.MONSTER).length).toBeGreaterThan(5);
  });

  it('caches the chunk list while the player and the loaded set stay put, and rebuilds it when they change', () => {
    const w = spawnWorld(noon);
    let calls = 0;
    const loaded = w.game.world.isChunkLoaded;
    w.game.world.isChunkLoaded = (...a) => { calls++; return loaded(...a); };
    w.spawner.tick(); w.spawner.tick(); w.spawner.tick();
    expect(calls).toBe(CHUNKS);
    w.game.player.x += 16;
    w.spawner.tick();
    expect(calls).toBe(CHUNKS * 2);
    w.game.ticks += 25; // a second later it is rebuilt anyway
    w.spawner.tick();
    expect(calls).toBe(CHUNKS * 3);
  });
});

describe('lazy catalogue icons', () => {
  class FakeIO {
    static last = null;
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.watched = new Set(); FakeIO.last = this; }
    observe(el) { this.watched.add(el); }
    unobserve(el) { this.watched.delete(el); }
    disconnect() { this.watched.clear(); }
    show(els) { this.cb(els.filter((e) => this.watched.has(e)).map((target) => ({ target, isIntersecting: true }))); }
  }
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ i, drawn: 0 }));

  it('draws nothing up front and only what scrolls into view (once each)', () => {
    const lazy = createLazyRenderer({ root: {}, IO: FakeIO });
    const els = mk(850);
    for (const e of els) lazy.add(e, () => { e.drawn++; });
    expect(els.some((e) => e.drawn)).toBe(false);
    expect(lazy.pending()).toBe(850);
    FakeIO.last.show(els.slice(0, 54));
    FakeIO.last.show(els.slice(0, 54)); // observed again: no double draw
    expect(els.filter((e) => e.drawn).length).toBe(54);
    expect(els.every((e) => e.drawn <= 1)).toBe(true);
    expect(lazy.pending()).toBe(796);
  });
  it('flush draws the first rows at once; reset forgets the rest', () => {
    const lazy = createLazyRenderer({ root: {}, IO: FakeIO });
    const els = mk(100);
    for (const e of els) lazy.add(e, () => { e.drawn++; });
    lazy.flush(20);
    expect(els.filter((e) => e.drawn).length).toBe(20);
    expect(els.slice(0, 20).every((e) => e.drawn === 1)).toBe(true);
    lazy.reset();
    expect(lazy.pending()).toBe(0);
    FakeIO.last.show(els); // a stale observer callback draws nothing
    expect(els.filter((e) => e.drawn).length).toBe(20);
  });
  it('without IntersectionObserver the queue drains top-down in time-sliced frames', () => {
    const frames = [];
    const lazy = createLazyRenderer({ root: {}, IO: null, schedule: (f) => frames.push(f), budgetMs: 0.0001 });
    const els = mk(300), order = [];
    for (const e of els) lazy.add(e, () => { e.drawn++; order.push(e.i); busy(); });
    function busy() { const t = performance.now(); while (performance.now() - t < 0.01); }
    expect(order).toHaveLength(0); // nothing synchronously
    let n = 0;
    while (frames.length && n++ < 10000) frames.shift()();
    expect(order).toEqual(els.map((e) => e.i));
    expect(n).toBeGreaterThan(5); // spread over many frames
    lazy.add(mk(1)[0], () => {}); // still usable afterwards
    expect(frames.length).toBe(1);
  });
  it('dispose stops pending work', () => {
    const frames = [];
    const lazy = createLazyRenderer({ root: {}, IO: null, schedule: (f) => frames.push(f) });
    const e = { drawn: 0 };
    lazy.add(e, () => { e.drawn++; });
    lazy.dispose();
    while (frames.length) frames.shift()();
    expect(e.drawn).toBe(0);
  });
});
