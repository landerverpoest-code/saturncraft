// The Assembler (world/assembler.js): a 3 x 3 grid that crafts its recipe on a cinnabar pulse.
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/world.js';
import { B, BLOCKS } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { CHUNK_VOLUME, cidx, MIN_Y } from '../src/world/constants.js';
import { dispense, newDispenser, isDispenser, DISPENSE_DELAY } from '../src/world/dispensers.js';
import { assemblerResult, assemblerPattern, assemble } from '../src/world/assembler.js';
import { hopperStep, newHopper, containerAccess, insertOne } from '../src/world/hoppers.js';
import { containerSignal } from '../src/world/comparators.js';
import { craft } from '../src/player/crafting.js';
import { TEX_NAMES } from '../src/world/textures.js';

function flatChunk() {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 64; y++) blocks[cidx(x, y, z)] = B.STONE;
  const light = new Uint8Array(CHUNK_VOLUME);
  computeChunkLight(blocks, light);
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) };
}
const Y = 64, EAST = 5;
function setup() {
  const world = new World(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.addChunk(cx, cz, flatChunk());
  world.tick();
  const dispensers = new Map(), chests = new Map(), hoppers = new Map();
  const g = {
    world, items: [], dispensers,
    player: { x: 100, y: 100, z: 100, body: { height: 1.8 } },
    entities: { spawnItem: (x, y, z, st, v) => g.items.push({ x, y, z, st, v }) },
    getDispenser(x, y, z) { const k = `${x},${y},${z}`; if (!dispensers.has(k)) dispensers.set(k, newDispenser(x, y, z)); return dispensers.get(k); },
    getChest(x, y, z) { const k = `${x},${y},${z}`; if (!chests.has(k)) chests.set(k, { slots: new Array(27).fill(null) }); return chests.get(k); },
    getHopper(x, y, z) { const k = `${x},${y},${z}`; if (!hoppers.has(k)) hoppers.set(k, newHopper(x, y, z)); return hoppers.get(k); },
  };
  world.circuits.onDispense = (x, y, z) => dispense(g, x, y, z);
  return g;
}
const S = (id, count = 1) => ({ id, count });
/** Sticks: two planks, one above the other. */
const stickGrid = (n) => [S(B.OAK_PLANKS, n), null, null, S(B.OAK_PLANKS, n), null, null, null, null, null];

describe('the Assembler', () => {
  it('is a container block with its own textures and a recipe', () => {
    expect(isDispenser(B.ASSEMBLER)).toBe(true);
    expect(BLOCKS[B.ASSEMBLER].name).toBe('Assembler');
    expect(BLOCKS[B.ASSEMBLER].container).toBe(true);
    for (const n of ['assembler_front', 'assembler_top']) expect(TEX_NAMES).toContain(n);
    const g = [I.IRON_INGOT, I.IRON_INGOT, I.IRON_INGOT, I.IRON_INGOT, B.WORKBENCH, I.IRON_INGOT, I.CINNABAR, B.DROPPER, I.CINNABAR].map((id) => S(id));
    expect(craft(g, 3)).toMatchObject({ id: B.ASSEMBLER, count: 1 });
  });

  it('knows its recipe, and keeps the last item of each slot as the pattern', () => {
    expect(assemblerResult(new Array(9).fill(null))).toBe(null);
    expect(assemblerPattern(stickGrid(1))).toMatchObject({ id: I.STICK, count: 4 });
    expect(assemblerResult(stickGrid(1))).toBe(null);
    expect(assemblerResult(stickGrid(2))).toMatchObject({ id: I.STICK, count: 4 });
    const lop = stickGrid(5); lop[3] = S(B.OAK_PLANKS, 1);
    expect(assemblerResult(lop)).toBe(null);
    expect(assemblerResult([S(B.STONE, 9), S(I.FEATHER, 9), null, null, null, null, null, null, null])).toBe(null); // not a recipe
  });

  it('crafts once per pulse and throws the result out of its face', () => {
    const g = setup();
    g.world.setBlock(2, Y, 2, B.ASSEMBLER, EAST);
    const d = g.getDispenser(2, Y, 2);
    stickGrid(3).forEach((s, i) => { d.slots[i] = s; });
    expect(dispense(g, 2, Y, 2)).toBe('craft');
    expect(g.items).toHaveLength(1);
    expect(g.items[0].st).toMatchObject({ id: I.STICK, count: 4 });
    expect(g.items[0].x).toBeGreaterThan(3); // out of the east face
    expect(d.slots[0].count).toBe(2);
    expect(dispense(g, 2, Y, 2)).toBe('craft');
    expect(dispense(g, 2, Y, 2)).toBe('empty'); // one plank left in each slot: the pattern stays
    expect(d.slots[0]).toMatchObject({ id: B.OAK_PLANKS, count: 1 });
    expect(d.slots[3]).toMatchObject({ id: B.OAK_PLANKS, count: 1 });
    expect(g.items).toHaveLength(2);
  });

  it('puts the result into a container in front, or does nothing when that is full', () => {
    const g = setup();
    g.world.setBlock(2, Y, 2, B.ASSEMBLER, EAST);
    g.world.setBlock(3, Y, 2, B.CHEST, 0);
    const d = g.getDispenser(2, Y, 2), chest = g.getChest(3, Y, 2);
    stickGrid(4).forEach((s, i) => { d.slots[i] = s; });
    expect(dispense(g, 2, Y, 2)).toBe('insert');
    expect(chest.slots[0]).toMatchObject({ id: I.STICK, count: 4 });
    expect(g.items).toHaveLength(0);
    for (let i = 0; i < 27; i++) chest.slots[i] = S(B.STONE, 64);
    chest.slots[5] = S(I.STICK, 62); // room for two sticks only: all or nothing
    expect(dispense(g, 2, Y, 2)).toBe('fail');
    expect(chest.slots[5].count).toBe(62);
    expect(d.slots[0].count).toBe(3);
  });

  it('fires on a rising cinnabar pulse', () => {
    const g = setup();
    g.world.setBlock(2, Y, 2, B.ASSEMBLER, EAST);
    const d = g.getDispenser(2, Y, 2);
    stickGrid(3).forEach((s, i) => { d.slots[i] = s; });
    g.world.setBlock(2, Y, 3, B.CINNABAR_BLOCK);
    for (let i = 0; i < DISPENSE_DELAY + 4; i++) g.world.tick();
    expect(g.items).toHaveLength(1);
    for (let i = 0; i < 20; i++) g.world.tick();
    expect(g.items).toHaveLength(1); // held power does not repeat
  });

  it('takes from hoppers only what its grid already holds, evening the stacks, and gives nothing back', () => {
    const g = setup();
    g.world.setBlock(2, Y, 2, B.ASSEMBLER, EAST);
    const d = g.getDispenser(2, Y, 2);
    d.slots[0] = S(B.OAK_PLANKS, 1); d.slots[3] = S(B.OAK_PLANKS, 5);
    const acc = containerAccess(g, 2, Y, 2);
    expect(acc.extract).toEqual([]);
    expect(insertOne(acc.insert(true), S(I.FEATHER))).toBe(false); // not part of the pattern
    for (let i = 0; i < 6; i++) expect(insertOne(containerAccess(g, 2, Y, 2).insert(true), S(B.OAK_PLANKS))).toBe(true);
    expect([d.slots[0].count, d.slots[3].count]).toEqual([6, 6]);
    expect(d.slots.filter(Boolean)).toHaveLength(2);
    // a hopper on top feeds it
    g.world.setBlock(2, Y + 1, 2, B.HOPPER, 0);
    const h = g.getHopper(2, Y + 1, 2);
    h.slots[0] = S(B.OAK_PLANKS, 2);
    hopperStep(g, h, false);
    expect(d.slots[0].count + d.slots[3].count).toBe(13);
  });

  it('is read by a comparator like any container', () => {
    const g = setup();
    g.world.setBlock(2, Y, 2, B.ASSEMBLER, EAST);
    expect(containerSignal(g, 2, Y, 2)).toBe(0);
    const d = g.getDispenser(2, Y, 2);
    for (let i = 0; i < 9; i++) d.slots[i] = S(B.STONE, 64);
    expect(containerSignal(g, 2, Y, 2)).toBe(15);
  });

  it('hands back what a recipe leaves over', () => {
    const items = [];
    const game = { world: { getBlock: () => B.AIR }, entities: { spawnItem: (x, y, z, st) => items.push(st) } };
    // not assemblable: a Milk Bucket does not stack, so a cake's pattern cannot be kept
    const cake = [I.MILK_BUCKET, I.MILK_BUCKET, I.MILK_BUCKET, I.SUGAR, I.EGG, I.SUGAR, I.WHEAT, I.WHEAT, I.WHEAT].map((id) => S(id, 1));
    expect(assemble(game, 0, 0, 0, cake, [1, 0, 0])).toBe('empty');
    expect(items).toHaveLength(0);
  });
});
