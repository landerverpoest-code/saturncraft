import { describe, it, expect } from 'vitest';
import { World } from '../src/world/world.js';
import { B } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { CHUNK_VOLUME, cidx, MIN_Y } from '../src/world/constants.js';
import { COMPARATOR_SUBTRACT, OBSERVER_POWERED, SENSOR_INVERTED, comparatorLevel, wireMask, circuitParts, FACING6 } from '../src/world/circuitShapes.js';
import { placeMeta, useMeta, comparatorInputs, COMPARATOR_DELAY, OBSERVER_DELAY, SENSOR_INTERVAL } from '../src/world/circuits.js';
import { comparatorOutput, fullness, daylightLevel, containerSignal } from '../src/world/comparators.js';
import { collisionBoxes, selectionBox } from '../src/world/shapes.js';
import { craft } from '../src/player/crafting.js';

function flatChunk() {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 64; y++) blocks[cidx(x, y, z)] = B.STONE;
  const light = new Uint8Array(CHUNK_VOLUME);
  computeChunkLight(blocks, light);
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) };
}
const Y = 64;
const EAST = 1; // repeater / comparator meta: output towards +x (so the back is at -x)

function setup() {
  const world = new World(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.addChunk(cx, cz, flatChunk());
  world.tick();
  const g = { world, chests: new Map(), hoppers: new Map(), dispensers: new Map(), furnaces: new Map(), brewingStands: new Map() };
  world.circuits.containerSignal = (x, y, z) => containerSignal(g, x, y, z);
  return g;
}
const run = (w, n = 1) => { for (let i = 0; i < n; i++) w.tick(); };
const stacks = (n, id = B.COBBLESTONE, count = 64) => Array.from({ length: n }, () => ({ id, count }));
const chestWith = (g, x, y, z, filled) => {
  g.world.setBlock(x, y, z, B.CHEST, 0);
  const slots = new Array(27).fill(null);
  filled.forEach((st, i) => { slots[i] = st; });
  g.chests.set(`${x},${y},${z}`, { x, y, z, slots });
  return slots;
};

describe('comparator rules', () => {
  it('compares and subtracts', () => {
    expect(comparatorOutput(10, 4, false)).toBe(10);
    expect(comparatorOutput(10, 10, false)).toBe(10);
    expect(comparatorOutput(4, 10, false)).toBe(0);
    expect(comparatorOutput(10, 4, true)).toBe(6);
    expect(comparatorOutput(4, 10, true)).toBe(0);
  });

  it('measure fullness with the reference formula', () => {
    expect(fullness(new Array(27).fill(null))).toBe(0);
    expect(fullness([{ id: B.COBBLESTONE, count: 1 }, ...new Array(26).fill(null)])).toBe(1);
    expect(fullness(stacks(27))).toBe(15);
    expect(fullness([...stacks(1), null, null, null, null])).toBe(3); // a hopper with one full stack: 1 + 14/5
    expect(fullness([...stacks(13), ...new Array(14).fill(null)])).toBe(7);
    // items that stack to 16 or 1 count for more
    expect(fullness([{ id: I.ARMOR_STAND, count: 16 }, null, null, null, null])).toBe(3);
  });

  it('read a daylight level from sky light and sun brightness', () => {
    expect(daylightLevel(15, 1)).toBe(15);
    expect(daylightLevel(15, 0)).toBe(0);
    expect(daylightLevel(15, 0.5)).toBe(8);
    expect(daylightLevel(10, 1)).toBe(10);
    expect(daylightLevel(15, 1, true)).toBe(0);
    expect(daylightLevel(15, 0, true)).toBe(15);
  });
});

describe('comparators in the world', () => {
  it('pass the power behind them on after two ticks and light a lamp', () => {
    const { world } = setup();
    world.setBlock(-1, Y, 0, B.CINNABAR_BLOCK);
    world.setBlock(1, Y, 0, B.CINNABAR_LAMP);
    world.setBlock(0, Y, 0, B.COMPARATOR, EAST);
    run(world, 1);
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(0);
    run(world, COMPARATOR_DELAY + 1);
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(15);
    expect(world.getBlock(1, Y, 0)).toBe(B.CINNABAR_LAMP_ON);
    world.setBlock(-1, Y, 0, B.AIR);
    run(world, 10);
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(0);
    expect(world.getBlock(1, Y, 0)).toBe(B.CINNABAR_LAMP);
  });

  it('keep the level of the wire behind them and power wire in front', () => {
    const { world } = setup();
    // wire: block at -4, wire -3 (15), -2 (14), -1 (13) into the comparator's back
    world.setBlock(-4, Y, 0, B.CINNABAR_BLOCK);
    for (const x of [-3, -2, -1]) world.setBlock(x, Y, 0, B.CINNABAR_WIRE);
    world.setBlock(0, Y, 0, B.COMPARATOR, EAST);
    world.setBlock(1, Y, 0, B.CINNABAR_WIRE); world.setBlock(2, Y, 0, B.CINNABAR_WIRE);
    run(world, 6);
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(13);
    expect(world.getMeta(1, Y, 0) & 15).toBe(13);
    expect(world.getMeta(2, Y, 0) & 15).toBe(12);
  });

  it('subtract a side signal in subtract mode, and switch off in compare mode when the side is stronger', () => {
    const { world } = setup();
    world.setBlock(-1, Y, 0, B.CINNABAR_BLOCK);
    world.setBlock(0, Y, 0, B.COMPARATOR, EAST | COMPARATOR_SUBTRACT);
    // side wire along +z: block at z 4 -> wire 15, 14, 13 next to the comparator
    world.setBlock(0, Y, 4, B.CINNABAR_BLOCK);
    for (const z of [3, 2, 1]) world.setBlock(0, Y, z, B.CINNABAR_WIRE);
    run(world, 6);
    expect(comparatorInputs(world, 0, Y, 0, world.getMeta(0, Y, 0))).toEqual({ rear: 15, side: 13 });
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(2);
    // a right-click flips it to compare mode: 15 >= 13 passes 15
    world.setBlock(0, Y, 0, B.COMPARATOR, useMeta(B.COMPARATOR, world.getMeta(0, Y, 0)));
    run(world, 4);
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(15);
    // a cinnabar block at the other side (15) beats a weaker rear
    world.setBlock(-1, Y, 0, B.AIR); world.setBlock(-3, Y, 0, B.CINNABAR_BLOCK); world.setBlock(-2, Y, 0, B.CINNABAR_WIRE); world.setBlock(-1, Y, 0, B.CINNABAR_WIRE); // rear 14
    world.setBlock(0, Y, -1, B.CINNABAR_BLOCK);
    run(world, 6);
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(0);
  });

  it('read how full a chest is, also through a solid block, and follow its contents', () => {
    const g = setup(), { world } = g;
    const slots = chestWith(g, -1, Y, 0, stacks(13));
    world.setBlock(0, Y, 0, B.COMPARATOR, EAST);
    run(world, 4);
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(7);
    slots.fill(null);
    run(world, 6); // polled every other tick, then the 2-tick delay
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(0);
    slots.fill({ id: B.COBBLESTONE, count: 64 });
    run(world, 6);
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(15);

    // a chest behind a stone block
    chestWith(g, 4, Y, 0, stacks(1));
    world.setBlock(5, Y, 0, B.STONE);
    world.setBlock(6, Y, 0, B.COMPARATOR, EAST);
    run(world, 6);
    expect(comparatorLevel(world.getMeta(6, Y, 0))).toBe(1);
  });

  it('read hoppers, dispensers, furnaces, brewing stands, composters and jukeboxes', () => {
    const g = setup(), { world } = g;
    const at = (x, z) => containerSignal(g, x, Y, z);
    world.setBlock(0, Y, 5, B.HOPPER); g.hoppers.set(`0,${Y},5`, { slots: [...stacks(5)] });
    world.setBlock(1, Y, 5, B.DISPENSER); g.dispensers.set(`1,${Y},5`, { slots: [...stacks(1), ...new Array(8).fill(null)] });
    world.setBlock(2, Y, 5, B.FURNACE); g.furnaces.set(`2,${Y},5`, { input: { id: B.COBBLESTONE, count: 32 }, fuel: null, output: null });
    world.setBlock(3, Y, 5, B.BREWING_STAND); g.brewingStands.set(`3,${Y},5`, { slots: [null, null, null, null, null] });
    world.setBlock(4, Y, 5, B.COMPOSTER, 5);
    world.setBlock(5, Y, 5, B.JUKEBOX, 3);
    world.setBlock(6, Y, 5, B.BARREL); g.chests.set(`6,${Y},5`, { slots: stacks(27) });
    expect(at(0, 5)).toBe(15);
    expect(at(1, 5)).toBe(2);
    expect(at(2, 5)).toBe(3);
    expect(at(3, 5)).toBe(0);
    expect(at(4, 5)).toBe(5);
    expect(at(5, 5)).toBe(3);
    expect(at(6, 5)).toBe(15);
    expect(at(7, 5)).toBe(-1); // air is no container
    world.setBlock(5, Y, 5, B.JUKEBOX, 0);
    expect(at(5, 5)).toBe(0);
  });

  it('are flat parts placed on top, facing where the player looks', () => {
    expect(placeMeta(B.COMPARATOR, [0, 1, 0], [1, 0, 0])).toBe(1);
    expect(placeMeta(B.COMPARATOR, [1, 0, 0], [1, 0, 0])).toBe(-1);
    const { world } = setup();
    expect(world.hasSupport(0, Y, 0, B.COMPARATOR, 0)).toBe(true);
    expect(world.hasSupport(0, Y + 3, 0, B.COMPARATOR, 0)).toBe(false);
    // the front torch is lit only in subtract mode
    const lit = (m) => circuitParts(B.COMPARATOR, m)[3].lit;
    expect(lit(0)).toBe(false);
    expect(lit(COMPARATOR_SUBTRACT)).toBe(true);
    expect(useMeta(B.COMPARATOR, 1)).toBe(1 | COMPARATOR_SUBTRACT);
  });
});

describe('observers', () => {
  it('face away from the player like a piston placed the other way round', () => {
    expect(FACING6[placeMeta(B.OBSERVER, [0, 1, 0], [0, 0, 1])]).toEqual([0, 0, 1]);
    expect(FACING6[placeMeta(B.OBSERVER, [0, 1, 0], [-1, 0, 0.1])]).toEqual([-1, 0, 0]);
    expect(FACING6[placeMeta(B.OBSERVER, [0, 1, 0], [0, -0.9, 0.1])]).toEqual([0, -1, 0]);
    expect(FACING6[placeMeta(B.OBSERVER, [0, 1, 0], [0, 0.9, 0.1])]).toEqual([0, 1, 0]);
    expect(collisionBoxes(B.OBSERVER, 0)).toEqual([[0, 0, 0, 1, 1, 1]]);
    expect(selectionBox(B.OBSERVER, 0)).toBe(null);
  });

  it('send a two-tick pulse of 15 out of the back when the block in front changes', () => {
    const { world } = setup();
    world.setBlock(0, Y, 0, B.OBSERVER, 5); // face looks at +x, back at -x
    for (const x of [-1, -2]) world.setBlock(x, Y, 0, B.CINNABAR_WIRE);
    run(world, 5);
    expect(world.getMeta(0, Y, 0) & OBSERVER_POWERED).toBe(0); // placing it does nothing
    world.setBlock(1, Y, 0, B.COBBLESTONE);
    run(world, OBSERVER_DELAY - 1);
    expect(world.getMeta(0, Y, 0) & OBSERVER_POWERED).toBe(0);
    run(world, 1);
    expect(world.getMeta(0, Y, 0) & OBSERVER_POWERED).toBeTruthy();
    expect(world.getMeta(-1, Y, 0) & 15).toBe(15);
    expect(world.getMeta(-2, Y, 0) & 15).toBe(14);
    run(world, OBSERVER_DELAY);
    expect(world.getMeta(0, Y, 0) & OBSERVER_POWERED).toBe(0);
    expect(world.getMeta(-1, Y, 0) & 15).toBe(0);
  });

  it('see meta changes too, but not changes beside or behind them', () => {
    const { world } = setup();
    world.setBlock(1, Y, 0, B.COMPOSTER, 0);
    world.setBlock(0, Y, 0, B.OBSERVER, 5);
    world.setBlock(-1, Y, 0, B.CINNABAR_LAMP);
    run(world, 5);
    world.setBlock(0, Y, 1, B.COBBLESTONE); // beside
    run(world, 5);
    expect(world.getBlock(-1, Y, 0)).toBe(B.CINNABAR_LAMP);
    world.setBlock(1, Y, 0, B.COMPOSTER, 1); // one more layer of compost
    run(world, OBSERVER_DELAY);
    expect(world.getBlock(-1, Y, 0)).toBe(B.CINNABAR_LAMP_ON);
  });

  it('power the block behind strongly and attract wire only at the back', () => {
    const { world } = setup();
    world.setBlock(0, Y, 0, B.OBSERVER, 5);
    world.setBlock(-1, Y, 0, B.STONE);
    world.setBlock(-2, Y, 0, B.CINNABAR_WIRE);
    world.setBlock(1, Y, 0, B.SAND);
    run(world, OBSERVER_DELAY);
    expect(world.getMeta(-2, Y, 0) & 15).toBe(15); // through the strongly powered stone
    const g = (x, y, z) => world.getBlock(x, y, z), m = (x, y, z) => world.getMeta(x, y, z);
    world.setBlock(0, Y, 3, B.OBSERVER, 5);
    world.setBlock(-1, Y, 3, B.CINNABAR_WIRE); world.setBlock(0, Y, 4, B.CINNABAR_WIRE);
    expect(wireMask(g, m, -1, Y, 3) & 2).toBeTruthy(); // the back (+x of the wire)
    expect(wireMask(g, m, 0, Y, 4) & 1).toBe(0);       // its side (-z of the wire)
  });
});

describe('daylight sensors', () => {
  it('give sky light times the suns\' brightness, inverted on a right-click', () => {
    const { world } = setup();
    let sun = 1;
    world.circuits.daylight = () => sun;
    world.setBlock(0, Y, 0, B.DAYLIGHT_SENSOR, 0);
    world.setBlock(1, Y, 0, B.CINNABAR_WIRE);
    run(world, 2);
    expect(world.getMeta(0, Y, 0) & 15).toBe(15);
    expect(world.getMeta(1, Y, 0) & 15).toBe(15);
    sun = 0.5;
    run(world, SENSOR_INTERVAL);
    expect(world.getMeta(0, Y, 0) & 15).toBe(8);
    expect(world.getMeta(1, Y, 0) & 15).toBe(8);
    world.setBlock(0, Y, 0, B.DAYLIGHT_SENSOR, useMeta(B.DAYLIGHT_SENSOR, world.getMeta(0, Y, 0)));
    run(world, 1);
    expect(world.getMeta(0, Y, 0) & SENSOR_INVERTED).toBeTruthy();
    expect(world.getMeta(0, Y, 0) & 15).toBe(7);
    sun = 0;
    run(world, SENSOR_INTERVAL);
    expect(world.getMeta(0, Y, 0) & 15).toBe(15);
  });

  it('see nothing under a roof and are slab-high', () => {
    const { world } = setup();
    world.circuits.daylight = () => 1;
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) world.setBlock(x, Y + 1, z, B.STONE);
    world.setBlock(0, Y, 0, B.DAYLIGHT_SENSOR, 0);
    run(world, SENSOR_INTERVAL + 1);
    expect(world.getMeta(0, Y, 0) & 15).toBeLessThan(15);
    expect(collisionBoxes(B.DAYLIGHT_SENSOR, 0)).toEqual([[0, 0, 0, 1, 6 / 16, 1]]);
  });
});

describe('recipes', () => {
  const grid = (rows) => rows.flat().map((id) => (id ? { id, count: 1 } : null));
  it('craft comparators, observers and daylight sensors', () => {
    const T = B.CINNABAR_TORCH, Q = I.EMBER_QUARTZ, S = B.STONE, C = B.COBBLESTONE, R = I.CINNABAR, G = B.GLASS, W = B.OAK_SLAB;
    expect(craft(grid([[null, T, null], [T, Q, T], [S, S, S]]), 3)).toMatchObject({ id: B.COMPARATOR });
    expect(craft(grid([[C, C, C], [R, R, Q], [C, C, C]]), 3)).toMatchObject({ id: B.OBSERVER });
    expect(craft(grid([[G, G, G], [Q, Q, Q], [W, W, W]]), 3)).toMatchObject({ id: B.DAYLIGHT_SENSOR });
  });
});
