// Stone Mites and Mite-Riddled stone (mobs/stoneMites.js, world/stoneMiteGen.js).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { Mob } from '../src/mobs/mob.js';
import { MOBS, MOB_KEYS, CATEGORY } from '../src/mobs/mobTypes.js';
import { spawnTable } from '../src/mobs/spawnRules.js';
import {
  MITE, RIDDLED_OF, PLAIN_OF, isRiddled, alertedMites, riddledNear, burrowSpot, burrowReady, releaseMite, raiseAlarm, STONE_MITE,
} from '../src/mobs/stoneMites.js';
import { stampMiteStone, MITE_BIOME_IDS, sanctumRiddled } from '../src/world/stoneMiteGen.js';
import { B, BLOCKS, NUM_BLOCKS, TOOL } from '../src/world/blocks.js';
import { BIOME, BIOMES } from '../src/world/biomes.js';
import { TEX_NAMES } from '../src/world/textures.js';
import { blockDrops } from '../src/world/mining.js';
import { MODELS } from '../src/mobs/models.js';
import { MIN_Y, CHUNK_VOLUME, cidx } from '../src/world/constants.js';
import { MockWorld } from './helpers.js';

const noop = () => {};
class W extends MockWorld {
  constructor() { super(60); }
  setBlock(x, y, z, id, meta = 0) { this.set(x, y, z, id, meta); return true; }
  setBlockUrgent(x, y, z, id, meta = 0) { return this.setBlock(x, y, z, id, meta); }
}
function fakeGame(world = new W(), over = {}) {
  const g = {
    ticks: 100, world, played: [], broke: 0,
    audio: { play: (n) => g.played.push(n) },
    particles: { blockBreak: () => { g.broke++; }, smoke: noop, emit: noop },
    entities: { list: [], add(e) { this.list.push(e); } },
    spawner: {
      spawned: [],
      hostileEnabled: () => true,
      spawnMob(type, x, y, z) { const m = new Mob(type, x, y, z); m._game = g; if (m.def.onSpawn) m.def.onSpawn(m); g.entities.list.push(m); this.spawned.push(m); return m; },
    },
    ...over,
  };
  return g;
}
const put = (g, x = 0, y = 64, z = 0) => g.spawner.spawnMob('stone_mite', x + 0.5, y, z + 0.5);

describe('Mite-Riddled blocks', () => {
  it('are three new blocks that look like the plain ones, break quickly and drop nothing', () => {
    for (const [k, name, tex] of [['MITE_STONE', 'Mite-Riddled Stone', 'stone'], ['MITE_COBBLE', 'Mite-Riddled Cobblestone', 'cobblestone'], ['MITE_BRICKS', 'Mite-Riddled Stone Bricks', 'stone_bricks']]) {
      const d = BLOCKS[B[k]];
      expect(d.name).toBe(name);
      expect(d.hardness).toBe(0.75);
      expect(d.tool).toBe(TOOL.PICKAXE);
      expect(d.tex.top).toBe(tex); expect(d.tex.side).toBe(tex);
      expect(TEX_NAMES).toContain(tex);
      expect(B[k]).toBeLessThan(NUM_BLOCKS);
      expect(blockDrops(B[k], { type: 'pickaxe', tier: 3, speed: 4 })).toEqual([]);
    }
    expect(BLOCKS[B.STONE].hardness).toBeGreaterThan(0.75);
  });
  it('pair up with the plain blocks both ways', () => {
    expect(RIDDLED_OF[B.STONE]).toBe(B.MITE_STONE);
    expect(RIDDLED_OF[B.COBBLESTONE]).toBe(B.MITE_COBBLE);
    expect(RIDDLED_OF[B.STONE_BRICKS]).toBe(B.MITE_BRICKS);
    for (const [plain, rid] of Object.entries(RIDDLED_OF)) expect(PLAIN_OF[rid]).toBe(+plain);
    expect(isRiddled(B.MITE_COBBLE)).toBe(true);
    expect(isRiddled(B.COBBLESTONE)).toBe(false);
  });
  it('a Gentle Hand pickaxe brings one home whole', () => {
    expect(blockDrops(B.MITE_STONE, { type: 'pickaxe', tier: 3, speed: 4 }, Math.random, 0, { gentle_hand: 1 })).toEqual([{ id: B.MITE_STONE, count: 1 }]);
  });
});

describe('Stone Mite definition', () => {
  it('is a tiny hostile 4 hp biter with a model, outside the open-world spawn tables', () => {
    const d = MOBS.stone_mite;
    expect(d).toBe(STONE_MITE);
    expect(MOB_KEYS).toContain('stone_mite');
    expect(d.category).toBe(CATEGORY.MONSTER);
    expect(d.health).toBe(4);
    expect(d.attack).toBe(1);
    expect(d.width).toBeLessThanOrEqual(0.5);
    expect(d.height).toBeLessThanOrEqual(0.5);
    expect(d.speed).toBeGreaterThan(MOBS.shambler.speed);
    expect(MODELS.stone_mite.parts.length).toBeGreaterThan(3);
    for (const b of BIOMES) for (const c of [CATEGORY.MONSTER, CATEGORY.CREATURE]) expect((spawnTable(c, b.id) || []).some((e) => e.type === 'stone_mite')).toBe(false);
  });
});

describe('release, alarm and burrowing rules', () => {
  it('breaking a Riddled block lets one mite out, hunting the player; peaceful or a guest releases none', () => {
    const g = fakeGame();
    const m = releaseMite(g, 3, 70, 4);
    expect(m.type).toBe('stone_mite');
    expect(m.target).toBe('player');
    expect(m.x).toBeCloseTo(3.5);
    expect(releaseMite(fakeGame(new W(), { net: { isClient: true } }), 0, 64, 0)).toBeNull();
    const calm = fakeGame(); calm.spawner.hostileEnabled = () => false;
    expect(releaseMite(calm, 0, 64, 0)).toBeNull();
  });
  it('alerts only mites within 10 blocks', () => {
    const g = fakeGame();
    const a = put(g, 0, 64, 0), near = put(g, 6, 64, 6), far = put(g, 9, 64, 9), dead = put(g, 1, 64, 1); dead.dead = true;
    expect(Math.hypot(far.x - a.x, far.z - a.z)).toBeGreaterThan(MITE.ALERT_RADIUS);
    expect(alertedMites(g.entities.list, a)).toEqual([near]);
    near.target = null; far.target = null;
    raiseAlarm(g, a);
    expect(near.target).toBe('player');
    expect(far.target).toBeNull();
  });
  it('a hurt mite bursts every Riddled block within 6 blocks and nothing beyond', () => {
    const w = new W();
    w.set(2, 64, 0, B.MITE_STONE); w.set(0, 66, 3, B.MITE_COBBLE); w.set(-4, 64, -2, B.MITE_BRICKS); w.set(9, 64, 0, B.MITE_STONE); w.set(1, 64, 1, B.STONE);
    const g = fakeGame(w);
    const a = put(g, 0, 64, 0);
    const before = g.entities.list.length;
    expect(riddledNear((x, y, z) => w.getBlock(x, y, z), a.x, a.y, a.z).length).toBe(3);
    a.hurt(1, 'player', null, 0);
    expect(g.entities.list.length).toBe(before + 3);
    expect(w.getBlock(2, 64, 0)).toBe(B.AIR);
    expect(w.getBlock(0, 66, 3)).toBe(B.AIR);
    expect(w.getBlock(-4, 64, -2)).toBe(B.AIR);
    expect(w.getBlock(9, 64, 0)).toBe(B.MITE_STONE);
    expect(w.getBlock(1, 64, 1)).toBe(B.STONE);
    expect(g.broke).toBe(3);
    expect(g.played).toContain('hiss');
  });
  it('burrows into plain stone, cobblestone or bricks beside it, but only after the wait', () => {
    const w = new W();
    w.set(5, 70, 5, B.AIR);
    const get = (x, y, z) => w.getBlock(x, y, z);
    expect(burrowSpot(get, 5.5, 70, 5.5)).toBeNull();
    w.set(6, 70, 5, B.COBBLESTONE);
    expect(burrowSpot(get, 5.5, 70, 5.5)).toEqual([6, 70, 5, B.MITE_COBBLE]);
    expect(burrowReady(MITE.BURROW_TICKS - 1, [1, 1, 1, B.MITE_STONE])).toBe(false);
    expect(burrowReady(MITE.BURROW_TICKS, null)).toBe(false);
    expect(burrowReady(MITE.BURROW_TICKS, [1, 1, 1, B.MITE_STONE])).toBe(true);
    expect(MITE.BURROW_TICKS).toBe(200);
  });
  it('an idle mite beside stone burrows in: the block turns Riddled and the mite is gone; one with a target stays', () => {
    const w = new W(); // floor of stone below y 60: a mite at y 60 stands on it
    const g = fakeGame(w);
    const p = { x: 500, y: 64, z: 500, dead: false, creative: false, effects: {}, eyeHeight: 1.6 };
    const m = put(g, 0, 60, 0);
    m.idle = MITE.BURROW_TICKS - 1;
    m.target = 'player'; m.def.customAI(m, g, { ...p, x: 1, z: 1 }, 2); // hunting: the idle count resets
    expect(m.idle).toBe(0);
    m.target = null; m.idle = MITE.BURROW_TICKS - 1;
    m.def.customAI(m, g, p, 700);
    expect(m.removed).toBe(true);
    const turned = [[0, 59, 0], [1, 60, 0], [-1, 60, 0], [0, 60, 1], [0, 60, -1]].some(([x, y, z]) => isRiddled(w.getBlock(x, y, z)));
    expect(turned || isRiddled(w.getBlock(0, 59, 0))).toBe(true);
  });
});

describe('generation', () => {
  it('seeds small clusters, about 1-2 % of the stone, only under mountain-style biomes and below the surface', () => {
    const gen = { seed: 1234 };
    const make = (biome) => {
      const blocks = new Uint16Array(CHUNK_VOLUME), meta = new Uint8Array(CHUNK_VOLUME), biomes = new Uint8Array(256).fill(biome), heightmap = new Int16Array(256).fill(120);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = MIN_Y; y <= 120; y++) blocks[cidx(x, y, z)] = B.STONE;
      return { blocks, meta, biomes, heightmap };
    };
    let stone = 0, rid = 0, shallow = 0;
    for (let c = 0; c < 6; c++) {
      const s = make(BIOME.STONY_PEAKS);
      stampMiteStone(gen, s.blocks, s.meta, c, c * 3, s.heightmap, s.biomes);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = MIN_Y; y <= 120; y++) {
        const b = s.blocks[cidx(x, y, z)];
        if (b === B.MITE_STONE) { rid++; if (y > 117) shallow++; } else if (b === B.STONE) stone++;
      }
    }
    const share = rid / (rid + stone);
    expect(share).toBeGreaterThan(0.004);
    expect(share).toBeLessThan(0.03);
    expect(shallow).toBe(0);
    const plain = make(BIOME.PLAINS);
    stampMiteStone(gen, plain.blocks, plain.meta, 0, 0, plain.heightmap, plain.biomes);
    expect(plain.blocks.includes(B.MITE_STONE)).toBe(false);
    expect(MITE_BIOME_IDS.has(BIOME.STONY_PEAKS)).toBe(true);
    const a = make(BIOME.STONY_PEAKS), b = make(BIOME.STONY_PEAKS);
    stampMiteStone(gen, a.blocks, a.meta, 2, 2, a.heightmap, a.biomes); stampMiteStone(gen, b.blocks, b.meta, 2, 2, b.heightmap, b.biomes);
    expect(Buffer.from(a.blocks.buffer).equals(Buffer.from(b.blocks.buffer))).toBe(true);
  });
  it('a bit over a tenth of the Sanctum bricks are Riddled', () => {
    let n = 0;
    for (let i = 0; i < 4000; i++) if (sanctumRiddled(77, i, 10, i * 3)) n++;
    expect(n / 4000).toBeGreaterThan(0.08);
    expect(n / 4000).toBeLessThan(0.16);
  });
});

describe('sources', () => {
  it('stay original', () => {
    for (const f of ['src/mobs/stoneMites.js', 'src/world/stoneMiteGen.js']) {
      const t = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').toLowerCase();
      for (const w of ['minecraft', 'nether', 'redstone', 'tripwire']) expect(t).not.toContain(w);
    }
  });
});
