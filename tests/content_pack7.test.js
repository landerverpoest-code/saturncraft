// Content pack 7: Driftsnow (sinking, freezing, Leather Boots), Scaldrock and the water columns, the Echo Coffer, and the generator pass.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MockWorld } from './helpers.js';
import { B, BLOCKS, NUM_BLOCKS, SOLID, OPAQUE } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { BIOME } from '../src/world/biomes.js';
import { SEA_LEVEL, cidx, CHUNK_VOLUME } from '../src/world/constants.js';
import { TEX_NAMES } from '../src/world/textures.js';
import { PHYS } from '../src/physics/constants.js';
import { Body } from '../src/physics/body.js';
import {
  columnAt, columnSpeed, COLUMN, COLUMN_REACH, frostStep, FROST, driftValue, DRIFT_MIN, ventInRegion, VENT_REGION, VENT_MIN_DEPTH, stampColdCurrents,
} from '../src/world/coldCurrents.js';
import { cleanEcho, echoStore, ECHO_SIZE } from '../src/player/echoCoffer.js';
import { Player } from '../src/player/player.js';
import { craft } from '../src/player/crafting.js';
import { FEATURES, CURRENT_FEATURE_VERSION } from '../src/world/retrofit.js';
import { entriesOf } from '../src/player/fieldGuideEntries.js';
import { playerSaveData } from '../src/world/save.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { BYPASSES_ARMOR } from '../src/player/armor.js';
import { damageCounts } from '../src/world/gameRules.js';
import '../src/world/dimensions/register.js';

const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const FORBIDDEN = /minecraft|nether|redstone/i;
const grid = (...cells) => { const g = new Array(9).fill(null); cells.forEach((c, i) => { g[i] = c ? { id: c, count: 1 } : null; }); return g; };

describe('content pack 7: ids and wiring', () => {
  it('appends three blocks with textures and no forbidden words', () => {
    expect(B.DRIFTSNOW).toBe(1371);
    expect(B.SCALDROCK).toBe(1372);
    expect(B.ECHO_COFFER).toBe(1373);
    expect(NUM_BLOCKS).toBe(1374);
    expect(BLOCKS[B.DRIFTSNOW].name).toBe('Driftsnow');
    expect(SOLID[B.DRIFTSNOW]).toBe(0);
    expect(OPAQUE[B.DRIFTSNOW]).toBe(0);
    expect(BLOCKS[B.SCALDROCK].emit).toBe(3);
    expect(BLOCKS[B.ECHO_COFFER].resistance).toBeGreaterThan(100); // blast proof, like the obsidian it is made of
    for (const n of ['driftsnow', 'scaldrock', 'echo_coffer_top', 'echo_coffer_side', 'echo_coffer_front']) expect(TEX_NAMES).toContain(n);
    for (const f of ['src/world/coldCurrents.js', 'src/world/pack7Textures.js', 'src/player/echoCoffer.js', 'src/world/gameRules.js']) expect(src(f), f).not.toMatch(FORBIDDEN);
    expect(PROTOCOL_VERSION).toBe(2);
  });

  it('is the last generator pass and retrofit feature, as version 8', () => {
    expect(FEATURES[FEATURES.length - 1]).toMatchObject({ key: 'coldCurrents', since: 8 });
    expect(CURRENT_FEATURE_VERSION).toBe(8);
    const calls = [...src('src/world/generator.js').matchAll(/this\.pass\('([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(calls[calls.length - 1]).toBe('coldCurrents');
  });

  it('has recipes and Field Guide notes', () => {
    const O = B.OBSIDIAN;
    expect(craft(grid(O, O, O, O, I.EYE_OF_THE_VOID, O, O, O, O), 3)).toMatchObject({ id: B.ECHO_COFFER, count: 1 });
    expect(craft(grid(I.EMBER_CREAM, I.EMBER_CREAM, null, I.EMBER_CREAM, I.EMBER_CREAM), 3)).toMatchObject({ id: B.SCALDROCK, count: 1 });
    expect(craft(grid(B.SNOW_BLOCK, B.SNOW_BLOCK, null, B.SNOW_BLOCK, B.SNOW_BLOCK), 3)).toMatchObject({ id: B.DRIFTSNOW, count: 4 });
    const items = entriesOf('items');
    for (const id of [B.DRIFTSNOW, B.SCALDROCK, B.ECHO_COFFER]) expect(items.find((e) => e.id === id), BLOCKS[id].name).toBeTruthy();
  });
});

function sea(depth = 10, floor = B.SAND) {
  const w = new MockWorld(64); // stone below 64
  for (let y = 64; y < 64 + depth; y++) w.set(0, y, 0, B.WATER, 0);
  w.set(0, 63, 0, floor);
  return w;
}

describe('water columns', () => {
  it('rise over Mournsand, sink over Scaldrock, and need still water all the way down', () => {
    expect(columnAt(sea(10, B.MOURNSAND), 0, 70, 0)).toBe(1);
    expect(columnAt(sea(10, B.SCALDROCK), 0, 70, 0)).toBe(-1);
    expect(columnAt(sea(10, B.SAND), 0, 70, 0)).toBe(0);
    const flowing = sea(10, B.MOURNSAND); flowing.set(0, 66, 0, B.WATER, 2);
    expect(columnAt(flowing, 0, 70, 0)).toBe(0);
    expect(columnAt(flowing, 0, 65, 0)).toBe(1); // below the break it still stands
    const blocked = sea(10, B.SCALDROCK); blocked.set(0, 66, 0, B.GLASS);
    expect(columnAt(blocked, 0, 70, 0)).toBe(0);
    expect(columnAt(sea(COLUMN_REACH + 10, B.MOURNSAND), 0, 64 + COLUMN_REACH + 5, 0)).toBe(0); // out of reach
  });

  it('speed up to their limits', () => {
    let vy = 0;
    for (let i = 0; i < 40; i++) vy = columnSpeed(vy, 1);
    expect(vy).toBe(COLUMN.upMax);
    vy = 0;
    for (let i = 0; i < 40; i++) vy = columnSpeed(vy, -1);
    expect(vy).toBe(COLUMN.downMax);
    expect(columnSpeed(0.2, 0)).toBe(0.2);
  });

  it('lift a body to the surface and hold another on the floor', () => {
    const run = (floor) => {
      const w = sea(12, floor);
      // a 3x3 shaft of water so the body stays in it
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = 64; y < 76; y++) w.set(x, y, z, B.WATER, 0);
      const b = new Body(PHYS.PLAYER_WIDTH, PHYS.PLAYER_HEIGHT);
      b.setPos(0.5, 68, 0.5);
      let top = 68;
      for (let i = 0; i < 60; i++) { b.updateFluidState(w, 1.62); b.travel(w, {}); top = Math.max(top, b.y); }
      return { b, top };
    };
    const up = run(B.MOURNSAND), down = run(B.SCALDROCK), still = run(B.SAND);
    expect(up.top).toBeGreaterThan(74);
    expect(down.b.y).toBeLessThan(64.5);
    expect(down.b.column).toBe(-1);
    expect(still.b.y).toBeGreaterThan(down.b.y - 0.01); // an ordinary swimmer sinks no faster than the dragged one
    expect(still.top).toBeLessThan(up.top);
  });
});

function driftField() {
  const w = new MockWorld(64);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) { w.set(x, 64, z, B.DRIFTSNOW); w.set(x, 65, z, B.DRIFTSNOW); }
  return w; // two blocks of Driftsnow over stone, top at 66
}
function drop(w, opts = {}, ticks = 80, input = {}) {
  const b = new Body(PHYS.PLAYER_WIDTH, PHYS.PLAYER_HEIGHT);
  Object.assign(b, opts);
  b.setPos(0.5, 68, 0.5);
  for (let i = 0; i < ticks; i++) { b.updateFluidState(w, 1.62); b.travel(w, input); }
  return b;
}

describe('Driftsnow', () => {
  it('lets a body sink to the floor, slowly and without a fall', () => {
    const w = driftField();
    const b = drop(w, {}, 15);
    expect(b.inDrift).toBe(true);
    expect(b.y).toBeGreaterThan(64.3); // still sinking after the first moments
    const done = drop(w, {}, 120);
    expect(done.y).toBeCloseTo(64, 1);
    expect(done.fallDistance).toBe(0);
    expect(done.eyeInDrift).toBe(true);
  });

  it('carries Leather Boots, unless their wearer sneaks', () => {
    const w = driftField();
    const walker = drop(w, { snowWalker: true });
    expect(walker.y).toBeCloseTo(66, 3);
    expect(walker.onGround).toBe(true);
    expect(walker.inDrift).toBe(false);
    const sneaker = drop(w, { snowWalker: true }, 120, { sneak: true });
    expect(sneaker.y).toBeLessThan(65);
  });

  it('can be climbed out of by jumping', () => {
    const w = driftField();
    const b = drop(w, {}, 120);
    let top = b.y;
    for (let i = 0; i < 60; i++) { b.updateFluidState(w, 1.62); b.travel(w, { jump: true }); top = Math.max(top, b.y); }
    expect(top).toBeGreaterThan(65.9);
  });

  it('slows walking', () => {
    const free = new MockWorld(64), snow = new MockWorld(64);
    for (let x = -1; x <= 1; x++) for (let z = -30; z <= 2; z++) snow.set(x, 64, z, B.DRIFTSNOW);
    const walk = (w) => { const b = new Body(PHYS.PLAYER_WIDTH, PHYS.PLAYER_HEIGHT); b.setPos(0.5, 64, 0.5); for (let i = 0; i < 40; i++) { b.updateFluidState(w, 1.62); b.travel(w, { forward: 1, yaw: 0 }); } return 0.5 - b.z; };
    expect(walk(snow)).toBeLessThan(walk(free) * 0.6);
    expect(walk(snow)).toBeGreaterThan(0.5);
  });

  it('builds frost, which leather keeps off and the open air thaws', () => {
    let f = 0;
    for (let i = 0; i < 200; i++) f = frostStep(f, true, false);
    expect(f).toBe(FROST.full);
    expect(frostStep(50, true, true)).toBe(48);
    expect(frostStep(50, false, false)).toBe(50 - FROST.thaw);
    expect(frostStep(0, false, false)).toBe(0);
  });

  it('freezes a player buried in it, but not one in leather', () => {
    const w = driftField();
    w.rainingAt = () => false;
    const mk = () => { const p = new Player(); p.setPosition(0.5, 64, 0.5); return p; };
    const tick = (p, n) => { for (let i = 0; i < n; i++) p.tick(w, { forward: 0, strafe: 0 }); };
    const bare = mk();
    tick(bare, FROST.full - 5);
    expect(bare.health).toBe(20);
    tick(bare, 130);
    expect(bare.health).toBeLessThan(20);
    expect(bare.frost).toBe(FROST.full);
    const warm = mk();
    warm.inventory.armor[1] = { id: I.LEATHER_CHESTPLATE, count: 1 };
    tick(warm, 300);
    expect(warm.health).toBe(20);
    expect(warm.frost).toBe(0);
    expect(BYPASSES_ARMOR.has('freeze')).toBe(true);
  });

  it('boots make the player a snow walker', () => {
    const w = driftField();
    const p = new Player(); p.setPosition(0.5, 66, 0.5);
    p.inventory.armor[3] = { id: I.LEATHER_BOOTS, count: 1 };
    for (let i = 0; i < 40; i++) p.tick(w, { forward: 0, strafe: 0 });
    expect(p.body.snowWalker).toBe(true);
    expect(p.y).toBeCloseTo(66, 3);
  });
});

describe('Scaldrock', () => {
  it('burns bare feet once a second, not while sneaking, and follows the fireDamage rule', () => {
    const w = new MockWorld(64);
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) w.set(x, 63, z, B.SCALDROCK);
    const stand = (input) => { const p = new Player(); p.setPosition(0.5, 64, 0.5); for (let i = 0; i < 100; i++) p.tick(w, { forward: 0, strafe: 0, ...input }); return p; };
    expect(stand({}).health).toBeLessThan(20);
    expect(stand({ sneak: true }).health).toBe(20);
    expect(damageCounts({ fireDamage: false }, 'hot_floor')).toBe(false);
  });
});

describe('Echo Coffer', () => {
  it('keeps a clean store of 27 slots with the player', () => {
    expect(cleanEcho(null)).toHaveLength(ECHO_SIZE);
    const dirty = [{ id: B.STONE, count: 5 }, { id: 999999, count: 1 }, { id: B.STONE, count: 0 }, 'x', { id: I.DIAMOND, count: 900 }];
    const c = cleanEcho(dirty);
    expect(c[0]).toEqual({ id: B.STONE, count: 5 });
    expect(c[1]).toBe(null); expect(c[2]).toBe(null); expect(c[3]).toBe(null);
    expect(c[4].count).toBe(64);
    const p = {};
    const s = echoStore(p);
    s[3] = { id: I.DIAMOND, count: 2 };
    expect(echoStore(p)).toBe(s); // the same store every time
    expect(p.echo[3].count).toBe(2);
  });

  it('is saved with the player', () => {
    const p = new Player();
    echoStore(p)[0] = { id: I.DIAMOND, count: 3 };
    const d = playerSaveData(p);
    expect(d.echo[0]).toEqual({ id: I.DIAMOND, count: 3 });
    expect(cleanEcho(JSON.parse(JSON.stringify(d.echo)))[0]).toEqual({ id: I.DIAMOND, count: 3 });
  });
});

describe('the coldCurrents pass', () => {
  const gen = { seed: 4242 };
  const blank = (biome) => ({ blocks: new Uint16Array(CHUNK_VOLUME), meta: new Uint8Array(CHUNK_VOLUME), biomes: new Uint8Array(256).fill(biome) });

  it('hollows snowy ground where the field is high, leaving a floor and no layer on top', () => {
    // find a chunk with some drift cells
    let cx = 0;
    const has = (c) => { for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) if (driftValue(gen, c * 16 + x, z) > DRIFT_MIN) return true; return false; };
    while (!has(cx)) cx++;
    const { blocks, meta, biomes } = blank(BIOME.SNOWY_PLAINS);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      for (let y = 60; y < 78; y++) blocks[cidx(x, y, z)] = B.STONE;
      blocks[cidx(x, 78, z)] = B.DIRT; blocks[cidx(x, 79, z)] = B.DIRT; blocks[cidx(x, 80, z)] = B.SNOWY_GRASS; blocks[cidx(x, 81, z)] = B.SNOW_LAYER;
    }
    blocks[cidx(5, 80, 5)] = B.OAK_PLANKS; // somebody's floor: never touched
    stampColdCurrents(gen, blocks, meta, cx, 0, biomes);
    let drift = 0;
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      const d = driftValue(gen, cx * 16 + x, z) > DRIFT_MIN && !(x === 5 && z === 5);
      expect(blocks[cidx(x, 80, z)] === B.DRIFTSNOW).toBe(d);
      if (d) { drift++; expect(blocks[cidx(x, 79, z)]).toBe(B.DRIFTSNOW); expect(blocks[cidx(x, 78, z)]).toBe(B.DIRT); expect(blocks[cidx(x, 81, z)]).toBe(B.AIR); }
      else expect(blocks[cidx(x, 81, z)]).toBe(B.SNOW_LAYER);
    }
    expect(drift).toBeGreaterThan(0);
    expect(blocks[cidx(5, 80, 5)]).toBe(B.OAK_PLANKS);
  });

  it('leaves warm land alone', () => {
    const { blocks, meta, biomes } = blank(BIOME.PLAINS);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) { blocks[cidx(x, 79, z)] = B.DIRT; blocks[cidx(x, 80, z)] = B.SNOWY_GRASS; }
    const before = blocks.slice();
    for (let cx = 0; cx < 6; cx++) stampColdCurrents(gen, blocks, meta, cx, 0, biomes);
    expect(blocks).toEqual(before);
  });

  it('plans about one vent or upwell in two regions, of both kinds, inside its region', () => {
    let n = 0, vents = 0;
    for (let rx = 0; rx < 30; rx++) for (let rz = 0; rz < 30; rz++) {
      const v = ventInRegion(77, rx, rz);
      if (!v) continue;
      n++; if (v.kind === 'vent') vents++;
      expect(v.x - v.r).toBeGreaterThanOrEqual(rx * VENT_REGION); expect(v.x + v.r).toBeLessThan((rx + 1) * VENT_REGION);
      expect(v.z - v.r).toBeGreaterThanOrEqual(rz * VENT_REGION); expect(v.z + v.r).toBeLessThan((rz + 1) * VENT_REGION);
      expect(ventInRegion(77, rx, rz)).toEqual(v);
    }
    expect(n).toBeGreaterThan(400); expect(n).toBeLessThan(600);
    expect(vents).toBeGreaterThan(n * 0.35); expect(vents).toBeLessThan(n * 0.65);
  });

  it('stamps a vent on a deep sea floor, the same across chunk borders, and none in the shallows', () => {
    let v = null, rx = 0;
    for (; !v; rx++) v = ventInRegion(gen.seed, rx, 0);
    const stampAt = (floorY) => {
      const found = [];
      for (let cx = Math.floor((v.x - 3) / 16); cx <= Math.floor((v.x + 3) / 16); cx++) for (let cz = Math.floor((v.z - 3) / 16); cz <= Math.floor((v.z + 3) / 16); cz++) {
        const { blocks, meta, biomes } = blank(BIOME.DEEP_OCEAN);
        for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
          for (let y = floorY - 4; y <= floorY; y++) blocks[cidx(x, y, z)] = y === floorY ? B.GRAVEL : B.STONE;
          for (let y = floorY + 1; y <= SEA_LEVEL; y++) blocks[cidx(x, y, z)] = B.WATER;
        }
        stampColdCurrents(gen, blocks, meta, cx, cz, biomes);
        for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
          const id = blocks[cidx(x, floorY, z)];
          if (id !== B.GRAVEL) found.push([cx * 16 + x, cz * 16 + z, id]);
        }
      }
      return found;
    };
    const deep = stampAt(SEA_LEVEL - 20);
    expect(deep.length).toBeGreaterThan(0);
    const want = v.kind === 'vent' ? B.SCALDROCK : B.MOURNSAND;
    for (const [x, z, id] of deep) { expect(id).toBe(want); expect(Math.hypot(x - v.x, z - v.z)).toBeLessThanOrEqual(v.r + 0.5); }
    expect(stampAt(SEA_LEVEL - (VENT_MIN_DEPTH - 2))).toEqual([]);
  });
});
