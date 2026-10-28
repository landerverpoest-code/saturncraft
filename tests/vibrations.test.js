// Vibrations heard by Hush Sensors (frequencies, wool, comparators, the listener index, guests)
// and copying Written Books in the crafting grid.
import { describe, it, expect } from 'vitest';
import { MockWorld } from './helpers.js';
import { World } from '../src/world/world.js';
import { B } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { CHUNK_VOLUME, cidx, MIN_Y } from '../src/world/constants.js';
import { containerSignal } from '../src/world/comparators.js';
import { comparatorInputs, weakOut } from '../src/world/circuits.js';
import { HushSystem, MOB_STEP_EVERY } from '../src/world/hushSystem.js';
import { sensorPower, SENSOR_PULSE, SENSOR_REST, VIBRATION_RANGE, SHRIEKER_CAN_SUMMON } from '../src/world/deepHush.js';
import {
  FREQUENCY, vibrationFrequency, sensorMeta, sensorFrequency, occluded, findListeners, GUEST_KINDS,
} from '../src/world/vibrations.js';
import { craft, consumeCraft } from '../src/player/crafting.js';
import { bookCopy, signBook, sameBook, copyBookFields, bookGeneration, BOOK_GENERATIONS } from '../src/world/books.js';
import { withExtras } from '../src/world/enchantments.js';
import { packEntity, unpackEntity } from '../src/net/protocol.js';
import { HostSession } from '../src/net/session.js';

const wire = (x) => JSON.parse(JSON.stringify(x));

function flatChunk() {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 64; y++) blocks[cidx(x, y, z)] = B.STONE;
  const light = new Uint8Array(CHUNK_VOLUME);
  computeChunkLight(blocks, light);
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) };
}
const Y = 64;

/** A real world (3x3 chunks of flat stone) with the Deep Hush running over it. */
function setup() {
  const world = new World(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.addChunk(cx, cz, flatChunk());
  world.tick();
  const player = { x: 0.5, y: Y, z: 0.5, netName: 'tester', effects: {}, dead: false, body: { x: 0.5, y: Y, z: 0.5, vx: 0, vz: 0, onGround: true }, addEffect(t, ticks) { this.effects[t] = { ticks }; return true; } };
  const g = { ticks: 1000, world, player, net: null, entities: { list: [] }, spawner: { spawnMob: () => null } };
  g.hush = new HushSystem(g);
  world.circuits.containerSignal = (x, y, z) => containerSignal(g, x, y, z);
  return { g, world, player };
}
const run = (w, n = 1) => { for (let i = 0; i < n; i++) w.tick(); };

describe('vibration rules', () => {
  it('give every kind of vibration a frequency of 1-15', () => {
    for (const f of Object.values(FREQUENCY)) { expect(f).toBeGreaterThanOrEqual(1); expect(f).toBeLessThanOrEqual(15); }
    expect(vibrationFrequency('step')).toBe(1);
    expect(vibrationFrequency('land')).toBe(2);
    expect(vibrationFrequency('eat')).toBe(8);
    expect(vibrationFrequency('close')).toBe(9);
    expect(vibrationFrequency('open')).toBe(10);
    expect(vibrationFrequency('break')).toBe(12);
    expect(vibrationFrequency('place')).toBe(13);
    expect(vibrationFrequency('explode')).toBe(15);
    expect(vibrationFrequency('nonsense')).toBe(1);
  });
  it('keep power and frequency in the sensor meta; a comparator only reads it while it pulses', () => {
    const m = sensorMeta(11, 13);
    expect(m & 15).toBe(11);
    expect(sensorFrequency(m)).toBe(13);
    expect(sensorFrequency(sensorMeta(0, 13))).toBe(0);
    expect(sensorFrequency(0)).toBe(0);
    expect(sensorPower(0)).toBe(15);
    expect(sensorPower(VIBRATION_RANGE)).toBe(1);
  });
  it('are stopped by wool on the line between source and sensor, but not by wool at either end', () => {
    const w = new MockWorld(0);
    const get = (x, y, z) => w.getBlock(x, y, z);
    expect(occluded(get, 0.5, 10.5, 0.5, 6.5, 10.5, 0.5)).toBe(false);
    w.set(3, 10, 0, B.WOOL, 4);
    expect(occluded(get, 0.5, 10.5, 0.5, 6.5, 10.5, 0.5)).toBe(true);
    expect(occluded(get, 0.5, 10.5, 2.5, 6.5, 10.5, 2.5)).toBe(false); // beside the wool
    expect(occluded(get, 3.5, 10.5, 0.5, 6.5, 10.5, 0.5)).toBe(false); // starts in the wool
    expect(occluded(get, 0.5, 10.5, 0.5, 3.5, 10.5, 0.5)).toBe(false); // ends in it
    w.set(3, 11, 3, B.WOOL, 0);
    expect(occluded(get, 0.5, 10.2, 0.5, 6.5, 12.8, 6.5)).toBe(true); // a diagonal through it
    w.set(3, 10, 0, B.WHITE_CARPET ?? B.AIR, 0);
    expect(occluded(get, 0.5, 10.5, 0.5, 6.5, 10.5, 0.5)).toBe(false); // carpets let it through
  });
  it('lets guests report only what the host cannot see', () => {
    for (const k of ['eat', 'drink', 'drop', 'open', 'close', 'activate', 'deactivate']) expect(GUEST_KINDS.has(k)).toBe(true);
    for (const k of ['place', 'break', 'explode', 'death', 'step']) expect(GUEST_KINDS.has(k)).toBe(false);
  });
});

describe('Hush Sensors in the world', () => {
  it('are indexed per chunk as they come and go', () => {
    const { world } = setup();
    world.setBlock(20, Y, 3, B.HUSH_SENSOR, 0);
    world.setBlock(-3, Y, -2, B.HUSH_SHRIEKER, 0);
    const ids = new Set([B.HUSH_SENSOR, B.HUSH_SHRIEKER]);
    expect(findListeners(world, 15.5, Y, 3.5, 8, ids).map((s) => [s.x, s.y, s.z])).toEqual([[20, Y, 3]]);
    expect(findListeners(world, 0.5, Y, 0.5, 8, ids).map((s) => s.id)).toEqual([B.HUSH_SHRIEKER]);
    expect(findListeners(world, 40, Y, 40, 8, ids)).toEqual([]);
    world.setBlock(20, Y, 3, B.AIR, 0);
    expect(findListeners(world, 15.5, Y, 3.5, 8, ids)).toEqual([]);
    expect(world.getChunk(1, 0).listeners.size).toBe(0);
    // a chunk loading with sensors in it indexes them too
    const d = flatChunk(); d.blocks[cidx(4, Y, 4)] = B.HUSH_SENSOR;
    world.addChunk(5, 5, d);
    expect(findListeners(world, 84.5, Y, 84.5, 3, ids).length).toBe(1);
  });

  it('pulse with the distance as power and the frequency for a comparator, for 30 ticks', () => {
    const { g, world, player } = setup();
    world.setBlock(4, Y, 0, B.HUSH_SENSOR, 0);
    world.setBlock(5, Y, 0, B.COMPARATOR, 1); // facing +x: the sensor is behind it
    run(world);
    const r = g.hush.vibrate(0.5, Y, 0.5, 'place', player);
    expect(r.sensors.length).toBe(1);
    const m = world.getMeta(4, Y, 0);
    expect(m & 15).toBe(sensorPower(Math.hypot(4, 0.5)));
    expect(sensorFrequency(m)).toBe(13);
    expect(weakOut(world, 4, Y, 0, [0, 0, 1])).toBe(m & 15);
    expect(comparatorInputs(world, 5, Y, 0, 1, world.circuits.containerSignal).rear).toBe(13);
    run(world, SENSOR_PULSE + 1);
    expect(world.getMeta(4, Y, 0)).toBe(0);
    expect(comparatorInputs(world, 5, Y, 0, 1, world.circuits.containerSignal).rear).toBe(0);
    // it rests a little before it hears again
    g.ticks += SENSOR_PULSE;
    expect(g.hush.vibrate(0.5, Y, 0.5, 'open', player).sensors.length).toBe(0);
    g.ticks += SENSOR_REST;
    expect(g.hush.vibrate(0.5, Y, 0.5, 'open', player).sensors.length).toBe(1);
    expect(sensorFrequency(world.getMeta(4, Y, 0))).toBe(10);
  });

  it('do not hear through a wall of wool, nor beyond 8 blocks', () => {
    const { g, world } = setup();
    world.setBlock(4, Y, 0, B.HUSH_SENSOR, 0);
    world.setBlock(2, Y, 0, B.WOOL, 3);
    expect(g.hush.vibrate(0.5, Y + 0.5, 0.5, 'explode').sensors.length).toBe(0);
    world.setBlock(2, Y, 0, B.STONE, 0); // stone carries it
    expect(g.hush.vibrate(0.5, Y + 0.5, 0.5, 'explode').sensors.length).toBe(1);
    world.setBlock(-9, Y, 0, B.HUSH_SENSOR, 0);
    g.hush.vibrate(0.5, Y + 0.5, 0.5, 'explode');
    expect(world.getMeta(-9, Y, 0)).toBe(0);
  });

  it('hear creatures walking about, but not the Hushkeeper', () => {
    const { g, world } = setup();
    world.setBlock(3, Y, 3, B.HUSH_SENSOR, 0);
    const mob = { kind: 'mob', id: 0, type: 'hushkeeper', dead: false, deathTime: 0, body: { x: 1.5, y: Y, z: 1.5, vx: 0.1, vz: 0, onGround: true } };
    g.entities.list.push(mob);
    g.ticks = MOB_STEP_EVERY * 50;
    g.player = null;
    g.hush.tick();
    expect(world.getMeta(3, Y, 3)).toBe(0);
    mob.type = 'fleecer';
    g.hush.tick();
    expect(sensorFrequency(world.getMeta(3, Y, 3))).toBe(1);
  });

  it('a placed sensor alone never raises the warning level; a world-grown shrieker near it does', () => {
    const { g, world, player } = setup();
    world.setBlock(3, Y, 0, B.HUSH_SENSOR, 0);
    const r = g.hush.vibrate(0.5, Y, 0.5, 'step', player);
    expect(r.sensors.length).toBe(1);
    expect(r.level).toBe(-1);
    expect(g.hush.warnings.level('tester')).toBe(0);
    world.setBlock(3, Y, 0, B.HUSH_SENSOR, 0);
    world.setBlock(-2, Y, 0, B.HUSH_SHRIEKER, SHRIEKER_CAN_SUMMON);
    g.ticks += SENSOR_PULSE + SENSOR_REST;
    expect(g.hush.vibrate(0.5, Y, 0.5, 'step', player).level).toBe(1);
  });
});

describe('vibrations in multiplayer', () => {
  it('a guest sends what it does to the host instead of simulating sensors', () => {
    const { g, world, player } = setup();
    world.setBlock(3, Y, 0, B.HUSH_SENSOR, 0);
    const sent = [];
    g.net = { isClient: true, sendVibration: (...a) => sent.push(a) };
    expect(g.hush.emit('eat', 0.5, Y, 0.5, player)).toBe(null);
    expect(g.hush.emit('place', 0.5, Y, 0.5, player)).toBe(null); // (blocks go with the edits)
    expect(g.hush.vibrate(0.5, Y, 0.5, 'open', player).sensors.length).toBe(0);
    expect(world.getMeta(3, Y, 0)).toBe(0);
    expect(sent).toEqual([['eat', 0.5, Y, 0.5]]);
  });
  it('the host hears a guest\'s report when the guest is near it', () => {
    const { g, world } = setup();
    world.setBlock(3, Y, 0, B.HUSH_SENSOR, 0);
    const h = new HostSession('Host', null, 'ABCDEF');
    h.game = g;
    g.net = h;
    const rp = { id: 2, name: 'Ann', state: { x: 0.5, y: Y, z: 0.5 } };
    rp.target = { isPlayer: true, netName: 'Ann', x: 0.5, y: Y, z: 0.5 };
    const c = { id: 2, name: 'Ann', joined: true, rp, ch: { send() {} } };
    h.clients.set(c.id, c);
    h.onMessage(c, { t: 'vib', k: 'explode', x: 0.5, y: Y, z: 0.5 }); // not a kind guests report
    expect(world.getMeta(3, Y, 0)).toBe(0);
    h.onMessage(c, { t: 'vib', k: 'drink', x: 40, y: Y, z: 0.5 }); // too far from them
    expect(world.getMeta(3, Y, 0)).toBe(0);
    h.onMessage(c, { t: 'vib', k: 'drink', x: 0.5, y: Y, z: 0.5 });
    expect(sensorFrequency(world.getMeta(3, Y, 0))).toBe(8);
  });
});

describe('copying Written Books', () => {
  const original = signBook({ id: I.WRITABLE_BOOK, count: 1, pages: ['Once upon', 'a time'] }, 'Tale', 'Ann');
  const blank = () => ({ id: I.WRITABLE_BOOK, count: 1, damage: 0 });

  it('a written book and writable books make as many copies, one generation on', () => {
    expect(bookGeneration(original)).toBe(0);
    const grid = [original, blank(), blank(), null, blank(), null, null, null, null];
    const out = craft(grid, 3);
    expect(out).toMatchObject({ id: I.WRITTEN_BOOK, count: 3, title: 'Tale', author: 'Ann', pages: ['Once upon', 'a time'], gen: 1 });
    // the book itself stays in the grid; the writable books are used up
    consumeCraft(grid);
    expect(grid[0]).toBe(original);
    expect(grid.filter(Boolean).length).toBe(1);
    expect(craft(grid, 3)).toBe(null); // nothing left to copy onto
    // a 2x2 grid works too
    expect(craft([blank(), original, null, null], 2).count).toBe(1);
  });

  it('copies of copies cannot be copied, and two books or other items spoil the recipe', () => {
    const copy = craft([original, blank(), null, null], 2);
    const copy2 = craft([copy, blank(), null, null], 2);
    expect(copy2.gen).toBe(2);
    expect(BOOK_GENERATIONS[bookGeneration(copy2)]).toBe('Copy of a copy');
    expect(BOOK_GENERATIONS[bookGeneration(copy)]).toBe('Copy of original');
    expect(BOOK_GENERATIONS[0]).toBe('Original');
    expect(bookCopy([copy2, blank(), null, null])).toBe(null);
    expect(craft([copy2, blank(), null, null], 2)).toBe(null);
    expect(craft([original, copy, blank(), null], 2)).toBe(null);
    expect(craft([original, blank(), { id: I.FEATHER, count: 1 }, null], 2)).toBe(null);
    expect(craft([original, null, null, null], 2)).toBe(null);
    // a written book is never written in again: only writable books can be signed
    expect(signBook(original, 'New', 'Bob')).toBe(null);
  });

  it('the generation stays with the book and keeps copies from stacking with originals', () => {
    const copy = craft([original, blank(), null, null], 2);
    expect(sameBook(original, copy)).toBe(false);
    expect(sameBook(copy, { ...copy })).toBe(true);
    expect(copyBookFields({ id: I.WRITTEN_BOOK, count: 1 }, copy).gen).toBe(1);
    expect(withExtras({ id: I.WRITTEN_BOOK, count: 1, damage: 0 }, wire(copy)).gen).toBe(1);
    expect(copyBookFields({ id: I.WRITTEN_BOOK, count: 1 }, { ...copy, gen: 'x' }).gen).toBe(undefined);
    const e = { kind: 'item', id: 5, x: 0, y: 0, z: 0, stack: copy, pickupDelay: 0 };
    expect(unpackEntity(wire(packEntity(e))).stack.gen).toBe(1);
  });
});
