// Calibrated Hush Sensors and vibrations that take time to travel, Tattered Books,
// Mining Fatigue / Haste attack speed, and Firework Stars with Star Rockets.
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/world.js';
import { B, BLOCKS, NUM_BLOCKS } from '../src/world/blocks.js';
import { I, ITEMS, FIREWORK_STARS, STAR_ROCKETS } from '../src/world/items.js';
import { COLORS } from '../src/world/colors.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { CHUNK_VOLUME, cidx, MIN_Y } from '../src/world/constants.js';
import { containerSignal } from '../src/world/comparators.js';
import { HushSystem } from '../src/world/hushSystem.js';
import { sensorPower, SENSOR_PULSE, SENSOR_REST, SHRIEKER_CAN_SUMMON } from '../src/world/deepHush.js';
import {
  sensorFrequency, travelTicks, VibrationQueue, calibratedHears, sensorRange, CALIBRATED_RANGE, LISTENS, TRAVEL_TICKS_PER_BLOCK,
} from '../src/world/vibrations.js';
import { craft, consumeCraft } from '../src/player/crafting.js';
import { signBook, bookCopy, isBook, isReadOnlyBook, bookGeneration, BOOK_GENERATIONS, cleanLectern, sameBook } from '../src/world/books.js';
import { attackSpeedFactor } from '../src/player/effects.js';
import { SkyRocket, starDamage, starColor, STAR_RANGE, STAR_DAMAGE, useSkyRocket } from '../src/entities/skyRocket.js';
import { packEntity, unpackEntity } from '../src/net/protocol.js';
import { tooltipHTML } from '../src/ui/icons.js';

const wire = (x) => JSON.parse(JSON.stringify(x));

function flatChunk() {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 64; y++) blocks[cidx(x, y, z)] = B.STONE;
  const light = new Uint8Array(CHUNK_VOLUME);
  computeChunkLight(blocks, light);
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) };
}
const Y = 64;

/** A real world (3x3 chunks of flat stone) with the Deep Hush running over it; `travel` = ticks per block. */
function setup(travel = TRAVEL_TICKS_PER_BLOCK) {
  const world = new World(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.addChunk(cx, cz, flatChunk());
  world.tick();
  const player = { x: 0.5, y: Y, z: 0.5, netName: 'tester', effects: {}, dead: false, body: { x: 0.5, y: Y, z: 0.5, vx: 0, vz: 0, onGround: true }, addEffect() { return true; } };
  const g = { ticks: 1000, world, player, net: null, entities: { list: [] }, spawner: { spawnMob: () => null } };
  g.hush = new HushSystem(g);
  g.hush.travel = travel;
  world.circuits.containerSignal = (x, y, z) => containerSignal(g, x, y, z);
  return { g, world, player };
}
/** Let `n` ticks pass for the hush system (arrivals) and the world (pulses end). */
const pass = (g, n = 1) => { for (let i = 0; i < n; i++) { g.ticks++; g.hush.arrive(); g.world.tick(); } };

describe('Calibrated Hush Sensor block', () => {
  it('is appended after every earlier block and listens for vibrations', () => {
    expect(B.CALIBRATED_HUSH_SENSOR).toBeGreaterThan(B.HUSH_SENSOR);
    expect(B.CALIBRATED_HUSH_SENSOR).toBeGreaterThan(B.OMINOUS_SPAWNER);
    expect(B.CALIBRATED_HUSH_SENSOR).toBe(NUM_BLOCKS - 1);
    expect(BLOCKS[B.CALIBRATED_HUSH_SENSOR].name).toBe('Calibrated Hush Sensor');
    expect(LISTENS[B.CALIBRATED_HUSH_SENSOR]).toBe(1);
    expect(sensorRange(B.CALIBRATED_HUSH_SENSOR)).toBe(16);
    expect(sensorRange(B.HUSH_SENSOR)).toBe(8);
  });
  it('is crafted from a Hush Sensor and three Hush Shards, and drops itself', () => {
    const grid = [null, { id: I.HUSH_SHARD, count: 1 }, null, { id: I.HUSH_SHARD, count: 1 }, { id: B.HUSH_SENSOR, count: 1 }, { id: I.HUSH_SHARD, count: 1 }, null, null, null];
    expect(craft(grid, 3)).toMatchObject({ id: B.CALIBRATED_HUSH_SENSOR, count: 1 });
    expect(BLOCKS[B.CALIBRATED_HUSH_SENSOR].drops).toBe(B.CALIBRATED_HUSH_SENSOR);
  });
  it('tuning rules: an untuned sensor hears everything, a tuned one only its frequency', () => {
    expect(calibratedHears(8, 0)).toBe(true);
    expect(calibratedHears(8, 8)).toBe(true);
    expect(calibratedHears(8, 9)).toBe(false);
  });
});

describe('vibrations travelling to sensors', () => {
  it('take about a tick per block and never arrive before they are sent', () => {
    expect(travelTicks(0)).toBe(0);
    expect(travelTicks(0.4)).toBe(1);
    expect(travelTicks(1)).toBe(1);
    expect(travelTicks(4.2)).toBe(5);
    expect(travelTicks(7.9)).toBe(8);
    expect(travelTicks(5, 0)).toBe(0);
    expect(travelTicks(5, 2)).toBe(10);
  });
  it('the queue hands items over in arrival order when due', () => {
    const q = new VibrationQueue(3);
    q.add(10, 'c'); q.add(5, 'a'); q.add(7, 'b');
    expect(q.take(4)).toEqual([]);
    expect(q.take(7)).toEqual(['a', 'b']);
    expect(q.size).toBe(1);
    q.add(20, 'd'); q.add(21, 'e'); q.add(22, 'f'); // over the cap: the oldest goes
    expect(q.size).toBe(3);
    q.clear();
    expect(q.take(100)).toEqual([]);
  });
  it('a plain sensor pulses when the vibration gets there, not before', () => {
    const { g, world, player } = setup();
    world.setBlock(4, Y, 0, B.HUSH_SENSOR, 0);
    const r = g.hush.vibrate(0.5, Y, 0.5, 'place', player);
    expect(r.sensors.length).toBe(1);
    const d = r.sensors[0].d, wait = travelTicks(d);
    expect(wait).toBe(5);
    expect(world.getMeta(4, Y, 0)).toBe(0);
    pass(g, wait - 1);
    expect(world.getMeta(4, Y, 0)).toBe(0); // still on its way
    pass(g, 1);
    expect(world.getMeta(4, Y, 0) & 15).toBe(sensorPower(d));
    expect(sensorFrequency(world.getMeta(4, Y, 0))).toBe(13);
    // the pulse lasts its 30 ticks as before
    pass(g, SENSOR_PULSE + 1);
    expect(world.getMeta(4, Y, 0)).toBe(0);
  });
  it('sensors farther away hear later, and wool still blocks the line', () => {
    const { g, world } = setup();
    world.setBlock(2, Y, 0, B.HUSH_SENSOR, 0);
    world.setBlock(7, Y, 0, B.HUSH_SENSOR, 0);
    world.setBlock(0, Y, 5, B.HUSH_SENSOR, 0);
    world.setBlock(0, Y, 3, B.WOOL, 0);
    g.hush.vibrate(0.5, Y, 0.5, 'explode');
    pass(g, 2);
    expect(world.getMeta(2, Y, 0)).toBe(0); // 2.06 blocks off: 3 ticks
    pass(g, 1);
    expect(world.getMeta(2, Y, 0) & 15).toBeGreaterThan(0);
    expect(world.getMeta(7, Y, 0)).toBe(0);
    pass(g, 4);
    expect(world.getMeta(7, Y, 0)).toBe(0); // 7.02 blocks off: 8 ticks
    pass(g, 1);
    expect(world.getMeta(7, Y, 0) & 15).toBeGreaterThan(0);
    pass(g, 10);
    expect(world.getMeta(0, Y, 5)).toBe(0); // behind the wool
  });
  it('a sensor that is gone, or busy, when the vibration arrives does not react', () => {
    const { g, world } = setup();
    world.setBlock(4, Y, 0, B.HUSH_SENSOR, 0);
    g.hush.vibrate(0.5, Y, 0.5, 'place');
    world.setBlock(4, Y, 0, B.STONE, 0);
    expect(() => pass(g, 6)).not.toThrow();
    expect(world.getBlock(4, Y, 0)).toBe(B.STONE);
    world.setBlock(4, Y, 0, B.HUSH_SENSOR, 0);
    g.hush.vibrate(0.5, Y, 0.5, 'place');
    g.hush.vibrate(0.5, Y, 0.5, 'open');
    pass(g, 6);
    expect(sensorFrequency(world.getMeta(4, Y, 0))).toBe(13); // the first one took it, the second found it busy
    expect(g.hush.queue.size).toBe(0);
  });
  it('a shrieker shrieks only when a sensor has heard a player\'s vibration', () => {
    const { g, world, player } = setup();
    world.setBlock(4, Y, 0, B.HUSH_SENSOR, 0);
    world.setBlock(0, Y, 4, B.HUSH_SHRIEKER, SHRIEKER_CAN_SUMMON);
    const r = g.hush.vibrate(0.5, Y, 0.5, 'place', player);
    expect(r.shrieked.length).toBe(0);
    expect(g.hush.warnings.level(g.hush.playerName(player))).toBe(0);
    pass(g, 4);
    expect(g.hush.warnings.level(g.hush.playerName(player))).toBe(0);
    pass(g, 1); // the sensor 4.03 blocks off hears at tick 5
    expect(g.hush.warnings.level(g.hush.playerName(player))).toBe(1);
  });
  it('travel 0 keeps the old instant behaviour', () => {
    const { g, world } = setup(0);
    world.setBlock(4, Y, 0, B.HUSH_SENSOR, 0);
    expect(g.hush.vibrate(0.5, Y, 0.5, 'place').sensors.length).toBe(1);
    expect(sensorFrequency(world.getMeta(4, Y, 0))).toBe(13);
  });
  it('guests do not run arrivals: nothing is simulated or queued on a client', () => {
    const { g, world } = setup();
    g.net = { isClient: true };
    world.setBlock(4, Y, 0, B.HUSH_SENSOR, 0);
    g.hush.vibrate(0.5, Y, 0.5, 'place');
    expect(g.hush.queue.size).toBe(0);
  });
});

describe('Calibrated Hush Sensors listening', () => {
  /** A sensor at (4, Y, 0) fed `level` by a Target block beside it (its meta is its signal). */
  function tuned(level, travel = 0) {
    const s = setup(travel);
    s.world.setBlock(4, Y, 0, B.CALIBRATED_HUSH_SENSOR, 0);
    if (level) s.world.setBlock(4, Y, 1, B.TARGET, level);
    return s;
  }
  it('read the cinnabar signal from a neighbour as their tuning', () => {
    expect(tuned(0).g.hush.tuning(4, Y, 0)).toBe(0);
    expect(tuned(10).g.hush.tuning(4, Y, 0)).toBe(10);
    const s = tuned(0); s.world.setBlock(3, Y, 0, B.CINNABAR_BLOCK, 0);
    expect(s.g.hush.tuning(4, Y, 0)).toBe(15);
  });
  it('hear only the frequency they are tuned to', () => {
    const a = tuned(10); // doors opening are 10
    expect(a.g.hush.vibrate(0.5, Y, 0.5, 'place').sensors.length).toBe(0); // 13 is not the 10 it is tuned to
    expect(a.world.getMeta(4, Y, 0)).toBe(0);
    const b = tuned(10);
    b.g.hush.vibrate(0.5, Y, 0.5, 'open');
    expect(sensorFrequency(b.world.getMeta(4, Y, 0))).toBe(10);
    const c = tuned(13);
    c.g.hush.vibrate(0.5, Y, 0.5, 'open'); c.g.hush.vibrate(0.5, Y, 0.5, 'break'); c.g.hush.vibrate(0.5, Y, 0.5, 'step');
    expect(c.world.getMeta(4, Y, 0)).toBe(0);
    c.g.hush.vibrate(0.5, Y, 0.5, 'place');
    expect(sensorFrequency(c.world.getMeta(4, Y, 0))).toBe(13);
  });
  it('an untuned one hears everything', () => {
    const s = tuned(0);
    s.g.hush.vibrate(0.5, Y, 0.5, 'step');
    expect(sensorFrequency(s.world.getMeta(4, Y, 0))).toBe(1);
  });
  it('a vibration it was not tuned to leaves it idle, so the right one still gets through', () => {
    const s = tuned(12);
    s.g.hush.vibrate(0.5, Y, 0.5, 'place');
    expect(s.world.getMeta(4, Y, 0)).toBe(0);
    s.g.hush.vibrate(0.5, Y, 0.5, 'break');
    expect(sensorFrequency(s.world.getMeta(4, Y, 0))).toBe(12);
  });
  it('is checked on arrival: retuning while the vibration travels counts', () => {
    const s = tuned(10, 1);
    s.g.hush.vibrate(0.5, Y, 0.5, 'break'); // 12, but tuned to 10 ...
    s.world.setBlock(4, Y, 1, B.TARGET, 12); // ... retuned in flight
    pass(s.g, 6);
    expect(sensorFrequency(s.world.getMeta(4, Y, 0))).toBe(12);
  });
  it('hear up to 16 blocks away (plain sensors 8), with the power falling over the longer range', () => {
    const { g, world } = setup(0);
    world.setBlock(12, Y, 0, B.CALIBRATED_HUSH_SENSOR, 0);
    world.setBlock(0, Y, -12, B.HUSH_SENSOR, 0);
    world.setBlock(17, Y, 0, B.CALIBRATED_HUSH_SENSOR, 0);
    const r = g.hush.vibrate(0.5, Y, 0.5, 'explode');
    expect(r.sensors.map((s) => s.x + ',' + s.z)).toEqual(['12,0']);
    const d = r.sensors[0].d;
    expect(d).toBeGreaterThan(8);
    expect(world.getMeta(12, Y, 0) & 15).toBe(sensorPower(d, CALIBRATED_RANGE));
    expect(world.getMeta(0, Y, -12)).toBe(0);
    expect(world.getMeta(17, Y, 0)).toBe(0);
  });
  it('pulse for 30 ticks and then rest 10, as plain sensors do', () => {
    const s = tuned(0);
    s.g.hush.vibrate(0.5, Y, 0.5, 'step');
    run(s.world, SENSOR_PULSE + 1);
    expect(s.world.getMeta(4, Y, 0)).toBe(0);
    s.g.ticks += SENSOR_PULSE;
    s.g.hush.vibrate(0.5, Y, 0.5, 'open');
    expect(s.world.getMeta(4, Y, 0)).toBe(0);
    s.g.ticks += SENSOR_REST;
    s.g.hush.vibrate(0.5, Y, 0.5, 'open');
    expect(sensorFrequency(s.world.getMeta(4, Y, 0))).toBe(10);
  });
});
const run = (w, n = 1) => { for (let i = 0; i < n; i++) w.tick(); };

describe('Tattered Books', () => {
  const original = signBook({ id: I.WRITABLE_BOOK, count: 1, pages: ['Once upon', 'a time'] }, 'Tale', 'Ann');
  const blank = () => ({ id: I.WRITABLE_BOOK, count: 1, damage: 0 });
  it('a copy of a copy is a Tattered Book that is read like a Written Book', () => {
    const copy = craft([original, blank(), null, null], 2);
    expect(copy.id).toBe(I.WRITTEN_BOOK);
    expect(bookGeneration(copy)).toBe(1);
    const tat = craft([copy, blank(), blank(), null], 2);
    expect(tat).toMatchObject({ id: I.TATTERED_BOOK, count: 2, title: 'Tale', author: 'Ann', pages: ['Once upon', 'a time'], gen: 2 });
    expect(BOOK_GENERATIONS[bookGeneration(tat)]).toBe('Copy of a copy');
    expect(ITEMS[I.TATTERED_BOOK].name).toBe('Tattered Book');
    expect(ITEMS[I.TATTERED_BOOK].written).toBe(true); // opens in the reading screen, shows title, author and pages
    expect(isBook(I.TATTERED_BOOK)).toBe(true);
    expect(isReadOnlyBook(I.TATTERED_BOOK)).toBe(true);
    expect(isReadOnlyBook(I.WRITABLE_BOOK)).toBe(false);
    const tip = tooltipHTML(tat);
    expect(tip).toContain('Tattered Book');
    expect(tip).toContain('Tale');
    expect(tip).toContain('2 pages');
  });
  it('cannot be copied again, or written in', () => {
    const copy = craft([original, blank(), null, null], 2);
    const tat = craft([copy, blank(), null, null], 2);
    expect(bookCopy([tat, blank(), null, null])).toBe(null);
    expect(craft([tat, blank(), null, null], 2)).toBe(null);
    expect(craft([tat, original, blank(), null], 2)).toBe(null);
    expect(signBook(tat, 'New', 'Bob')).toBe(null);
    // even a Written Book of an old save that already is a copy of a copy stays uncopiable
    expect(bookCopy([{ ...tat, id: I.WRITTEN_BOOK }, blank(), null, null])).toBe(null);
    // the book it was copied from stays in the grid and the copies come out as tattered ones
    const grid = [copy, blank(), null, null];
    craft(grid, 2); consumeCraft(grid);
    expect(grid[0]).toBe(copy);
    expect(grid[1]).toBe(null);
  });
  it('keeps its pages through lecterns and the network, and stacks only with its own kind', () => {
    const copy = craft([original, blank(), null, null], 2);
    const tat = craft([copy, blank(), null, null], 2);
    const l = cleanLectern(wire({ book: tat, page: 1 }));
    expect(l.book).toMatchObject({ id: I.TATTERED_BOOK, gen: 2, pages: ['Once upon', 'a time'], title: 'Tale' });
    expect(l.page).toBe(1);
    const e = { kind: 'item', id: 9, x: 0, y: 0, z: 0, stack: tat, pickupDelay: 0 };
    const back = unpackEntity(wire(packEntity(e))).stack;
    expect(back).toMatchObject({ id: I.TATTERED_BOOK, gen: 2, title: 'Tale', author: 'Ann' });
    expect(sameBook(tat, { ...tat })).toBe(true);
    expect(sameBook(tat, copy)).toBe(false);
  });
});

describe('Mining Fatigue and Haste change the attack speed', () => {
  it('Mining Fatigue slows swings by 10 % per level, Haste speeds them up', () => {
    expect(attackSpeedFactor({})).toBe(1);
    expect(attackSpeedFactor(null)).toBe(1);
    expect(attackSpeedFactor({ mining_fatigue: { amp: 0, ticks: 100 } })).toBeCloseTo(0.9);
    expect(attackSpeedFactor({ mining_fatigue: { amp: 2, ticks: 100 } })).toBeCloseTo(0.7); // the Elder Deepeye's III
    expect(attackSpeedFactor({ haste: { amp: 1, ticks: 100 } })).toBeCloseTo(1.2);
    expect(attackSpeedFactor({ haste: { amp: 0, ticks: 10 }, mining_fatigue: { amp: 0, ticks: 10 } })).toBeCloseTo(1);
    expect(attackSpeedFactor({ mining_fatigue: { amp: 40, ticks: 10 } })).toBeCloseTo(0.1); // never stops altogether
  });
  it('lengthens the attack cooldown of the held weapon', async () => {
    const { Interaction } = await import('../src/player/interaction.js');
    const sword = { id: I.IRON_SWORD, count: 1, damage: 0 };
    const make = (effects) => {
      const game = { player: { effects, attackTicks: 0, inventory: { selectedStack: sword } } };
      return Object.assign(Object.create(Interaction.prototype), { game });
    };
    const base = make({}).attackCooldownTicks();
    expect(base).toBeCloseTo(12.5); // iron sword: 1.6 attacks per second
    expect(make({ mining_fatigue: { amp: 2, ticks: 99 } }).attackCooldownTicks()).toBeCloseTo(base / 0.7);
    expect(make({ haste: { amp: 1, ticks: 99 } }).attackCooldownTicks()).toBeCloseTo(base / 1.2);
    const slow = make({ mining_fatigue: { amp: 2, ticks: 99 } });
    expect(slow.attackCooldownProgress()).toBeLessThan(make({}).attackCooldownProgress());
  });
});

describe('Firework Stars and Star Rockets', () => {
  it('there is a star and a Star Rocket for each of the 16 colours, appended after the other items', () => {
    expect(FIREWORK_STARS.length).toBe(16);
    expect(STAR_ROCKETS.length).toBe(16);
    expect(new Set([...FIREWORK_STARS, ...STAR_ROCKETS]).size).toBe(32);
    expect(FIREWORK_STARS[0]).toBeGreaterThan(I.TATTERED_BOOK);
    expect(ITEMS[FIREWORK_STARS[14]].name).toBe('Red Firework Star');
    expect(ITEMS[STAR_ROCKETS[3]].name).toBe('Light Blue Star Rocket');
    expect(ITEMS[STAR_ROCKETS[3]].rocket).toBe(true);
    expect(ITEMS[STAR_ROCKETS[3]].rocketStar).toBe(3);
    expect(ITEMS[I.SKY_ROCKET].rocketStar).toBe(undefined);
  });
  it('blast powder and a dye (bone meal for white) make a star, and paper, powder and a star make 3 rockets', () => {
    const dye = (key) => ({ id: I[key + '_DYE'], count: 1 });
    expect(craft([{ id: I.GUNPOWDER, count: 1 }, dye('RED'), null, null], 2)).toMatchObject({ id: FIREWORK_STARS[14], count: 1 });
    expect(craft([{ id: I.GUNPOWDER, count: 1 }, { id: I.BONE_MEAL, count: 1 }, null, null], 2)).toMatchObject({ id: FIREWORK_STARS[0] });
    const star = { id: FIREWORK_STARS[5], count: 1 };
    expect(craft([{ id: I.PAPER, count: 1 }, { id: I.GUNPOWDER, count: 1 }, star, null], 2)).toMatchObject({ id: STAR_ROCKETS[5], count: 3 });
  });
  it('a plain rocket bursts in a random palette colour, a Star Rocket in its star\'s colour', () => {
    const plain = new SkyRocket(0, 0, 0, null, () => 0);
    expect(plain.star).toBe(null);
    const star = new SkyRocket(0, 0, 0, null, Math.random, 14);
    expect(star.color).toEqual(starColor(14));
    expect(star.color[0]).toBeCloseTo(COLORS[14][2][0] / 255);
    expect(starColor(99)).toBe(null);
  });
  it('the burst hurts mobs within 5 blocks, and only where the mobs are simulated', () => {
    expect(starDamage(0)).toBe(STAR_DAMAGE);
    expect(starDamage(STAR_RANGE)).toBe(STAR_DAMAGE);
    expect(starDamage(STAR_RANGE + 0.1)).toBe(0);
    const hits = [];
    const mob = (id, x, y, z, extra = {}) => ({ kind: 'mob', id, x, y, z, height: 1, dead: false, deathTime: 0, hurt(d, src) { hits.push([id, d, src]); return true; }, ...extra });
    const mk = (net) => ({
      net, particles: { emit() {} }, audio: { play() {} },
      entities: { list: [mob(1, 2, 10, 0), mob(2, 9, 10, 0), mob(3, 0, 10, 4, { dead: true }), { kind: 'item', hurt() { throw new Error('items are not hurt'); }, x: 0, y: 10, z: 0 }] },
    });
    const r = new SkyRocket(0, 10, 0, null, Math.random, 4);
    r.burst(mk(null));
    expect(hits).toEqual([[1, STAR_DAMAGE, 'firework']]);
    hits.length = 0;
    new SkyRocket(0, 10, 0, null, Math.random, 4).burst(mk({ isHost: true }));
    expect(hits.length).toBe(1);
    hits.length = 0;
    new SkyRocket(0, 10, 0, null, Math.random, 4).burst(mk({ isClient: true })); // a guest's rocket is only for show
    expect(hits.length).toBe(0);
    new SkyRocket(0, 10, 0, null, Math.random, null).burst(mk(null)); // a plain rocket never hurts
    expect(hits.length).toBe(0);
  });
  it('launching a Star Rocket from a block gives the rocket its star', () => {
    const added = [];
    const g = { player: { gliding: false, x: 0, y: 0, z: 0 }, entities: { add: (e) => { added.push(e); return e; } }, audio: { play() {} } };
    expect(useSkyRocket(g, { x: 1, y: 2, z: 3, face: [0, 1, 0] }, 6)).toBe(true);
    expect(added[0].star).toBe(6);
    expect(useSkyRocket(g, { x: 1, y: 2, z: 3, face: [0, 1, 0] })).toBe(true);
    expect(added[1].star).toBe(null);
  });
});
