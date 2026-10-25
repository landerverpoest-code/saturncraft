import { describe, it, expect } from 'vitest';
import { World } from '../src/world/world.js';
import { B } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { CHUNK_VOLUME, cidx, MIN_Y } from '../src/world/constants.js';
import { ON } from '../src/world/circuitShapes.js';
import { dispense, newDispenser, dispenserPlaceMeta, facingDir, pickSlot, TRIGGERED, DISPENSE_DELAY } from '../src/world/dispensers.js';
import { hopperStep, newHopper } from '../src/world/hoppers.js';
import { craft } from '../src/player/crafting.js';

function flatChunk() {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 64; y++) blocks[cidx(x, y, z)] = B.STONE;
  const light = new Uint8Array(CHUNK_VOLUME);
  computeChunkLight(blocks, light);
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) };
}
const Y = 64;
const EAST = 5; // FACING6 index of +x

/** A small flat world with a game stand-in that records what dispensers do. */
function setup() {
  const world = new World(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.addChunk(cx, cz, flatChunk());
  world.tick();
  const dispensers = new Map(), chests = new Map(), hoppers = new Map();
  const g = {
    world, items: [], arrows: [], tnt: [], fireballs: [], grown: [],
    player: { x: 100, y: 100, z: 100, body: { height: 1.8 }, inventory: { armor: [null, null, null, null], changed() {} } },
    entities: {
      spawnItem: (x, y, z, st, v) => g.items.push({ x, y, z, st, v }),
      spawnArrow: (x, y, z, vx, vy, vz, shooter, crit, thrown, power, potion, item) => g.arrows.push({ x, y, z, v: [vx, vy, vz], item }),
    },
    interaction: { boneMeal: (t) => { if (t.id !== B.WHEAT) return false; g.grown.push(t); return true; } },
    primeTNT: (x, y, z) => g.tnt.push([x, y, z]),
    shootFireball: (x, y, z, vx, vy, vz) => g.fireballs.push({ x, y, z, v: [vx, vy, vz] }),
    getDispenser(x, y, z) { const k = `${x},${y},${z}`; if (!dispensers.has(k)) dispensers.set(k, newDispenser(x, y, z)); return dispensers.get(k); },
    getChest(x, y, z) { const k = `${x},${y},${z}`; if (!chests.has(k)) chests.set(k, { slots: new Array(27).fill(null) }); return chests.get(k); },
    getHopper(x, y, z) { const k = `${x},${y},${z}`; if (!hoppers.has(k)) hoppers.set(k, newHopper(x, y, z)); return hoppers.get(k); },
  };
  world.circuits.onDispense = (x, y, z) => dispense(g, x, y, z);
  return g;
}
const put = (g, x, z, id, st, facing = EAST) => {
  g.world.setBlock(x, Y, z, id, facing);
  const d = g.getDispenser(x, Y, z);
  if (st) d.slots[0] = st;
  return d;
};
const run = (w, n = 1) => { for (let i = 0; i < n; i++) w.tick(); };

describe('dispensers and droppers', () => {
  it('face the player when placed, up or down when looking steeply', () => {
    expect(facingDir(dispenserPlaceMeta([0, 0, 1]))).toEqual([0, 0, -1]); // looking +z: the face points back at -z
    expect(facingDir(dispenserPlaceMeta([-1, 0, 0.2]))).toEqual([1, 0, 0]);
    expect(facingDir(dispenserPlaceMeta([0, -0.9, 0.1]))).toEqual([0, 1, 0]); // looking down: the face points up
    expect(facingDir(dispenserPlaceMeta([0, 0.9, 0.1]))).toEqual([0, -1, 0]);
  });

  it('fire once on a rising edge of power, after a short delay', () => {
    const g = setup();
    const d = put(g, 0, 0, B.DROPPER, { id: I.COAL, count: 5, damage: 0 });
    g.world.setBlock(-1, Y, 0, B.LEVER, 0); run(g.world);
    g.world.setBlock(-1, Y, 0, B.LEVER, ON); run(g.world);
    expect(g.world.getMeta(0, Y, 0) & TRIGGERED).toBeTruthy();
    expect(g.items.length).toBe(0); // not yet
    run(g.world, DISPENSE_DELAY + 1);
    expect(g.items.length).toBe(1);
    run(g.world, 20); // staying powered does nothing more
    expect(g.items.length).toBe(1);
    expect(d.slots[0].count).toBe(4);
    g.world.setBlock(-1, Y, 0, B.LEVER, 0); run(g.world, 3);
    expect(g.world.getMeta(0, Y, 0) & TRIGGERED).toBe(0);
    g.world.setBlock(-1, Y, 0, B.LEVER, ON); run(g.world, DISPENSE_DELAY + 2);
    expect(g.items.length).toBe(2);
    expect(g.world.getMeta(0, Y, 0) & 7).toBe(EAST); // the facing survives the triggered bit
  });

  it('droppers throw items out of their face, or into a container in front', () => {
    const g = setup();
    put(g, 0, 0, B.DROPPER, { id: B.DIRT, count: 2, damage: 0 });
    expect(dispense(g, 0, Y, 0)).toBe('drop');
    const it = g.items[0];
    expect(it.st).toEqual({ id: B.DIRT, count: 1, damage: 0 });
    expect(it.x).toBeGreaterThan(1); expect(it.v[0]).toBeGreaterThan(0);
    g.world.setBlock(1, Y, 0, B.CHEST);
    expect(dispense(g, 0, Y, 0)).toBe('insert');
    expect(g.getChest(1, Y, 0).slots[0]).toMatchObject({ id: B.DIRT, count: 1 });
    expect(g.getDispenser(0, Y, 0).slots[0]).toBe(null);
    expect(dispense(g, 0, Y, 0)).toBe('empty');
  });

  it('dispensers drop what they cannot use, like droppers (but do not fill chests)', () => {
    const g = setup();
    g.world.setBlock(1, Y, 0, B.CHEST);
    put(g, 0, 0, B.DISPENSER, { id: B.DIRT, count: 1, damage: 0 });
    expect(dispense(g, 0, Y, 0)).toBe('drop');
    expect(g.items.length).toBe(1);
  });

  it('shoot arrows (tipped arrows keep their tip) and fire charges', () => {
    const g = setup();
    const d = put(g, 0, 0, B.DISPENSER, { id: I.ARROW, count: 2, damage: 0 });
    expect(dispense(g, 0, Y, 0)).toBe('arrow');
    expect(g.arrows[0].v[0]).toBeGreaterThan(1);
    expect(g.arrows[0].item).toBe(null);
    const tipped = ITEMS.find((it) => it && it.tipped);
    d.slots[0] = { id: tipped.id, count: 1, damage: 0 };
    dispense(g, 0, Y, 0);
    expect(g.arrows[1].item.id).toBe(tipped.id);
    d.slots[0] = { id: I.FIRE_CHARGE, count: 1, damage: 0 };
    expect(dispense(g, 0, Y, 0)).toBe('fireball');
    expect(g.fireballs[0].v[0]).toBeGreaterThan(0);
    expect(d.slots[0]).toBe(null);
  });

  it('pour fluid from buckets and scoop it back up', () => {
    const g = setup();
    const d = put(g, 0, 0, B.DISPENSER, { id: I.WATER_BUCKET, count: 1, damage: 0 });
    expect(dispense(g, 0, Y, 0)).toBe('pour');
    expect(g.world.getBlock(1, Y, 0)).toBe(B.WATER);
    expect(d.slots[0].id).toBe(I.BUCKET);
    expect(dispense(g, 0, Y, 0)).toBe('scoop');
    expect(g.world.getBlock(1, Y, 0)).toBe(B.AIR);
    expect(d.slots[0].id).toBe(I.WATER_BUCKET);
    // two empty buckets: the filled one goes into a free slot
    g.world.setBlock(1, Y, 0, B.LAVA, 0);
    d.slots[0] = { id: I.BUCKET, count: 2, damage: 0 };
    expect(dispense(g, 0, Y, 0)).toBe('scoop');
    expect(d.slots[0]).toMatchObject({ id: I.BUCKET, count: 1 });
    expect(d.slots.some((s) => s && s.id === I.LAVA_BUCKET)).toBe(true);
    // a full bucket against a wall is dropped
    g.world.setBlock(1, Y, 0, B.STONE);
    d.slots.fill(null); d.slots[0] = { id: I.LAVA_BUCKET, count: 1, damage: 0 };
    expect(dispense(g, 0, Y, 0)).toBe('drop');
  });

  it('light fires and TNT with flint and steel, and send out primed TNT', () => {
    const g = setup();
    const d = put(g, 0, 0, B.DISPENSER, { id: I.FLINT_AND_STEEL, count: 1, damage: 0 }, 1); // facing up
    expect(dispense(g, 0, Y, 0)).toBe('ignite');
    expect(g.world.getBlock(0, Y + 1, 0)).toBe(B.FIRE);
    expect(d.slots[0].damage).toBe(1);
    const lit = [];
    g.world.setBlock(0, Y + 1, 0, B.TNT);
    g.world.onTNT = (x, y, z) => lit.push([x, y, z]);
    expect(dispense(g, 0, Y, 0)).toBe('ignite');
    expect(lit).toEqual([[0, Y + 1, 0]]);
    g.world.setBlock(0, Y + 1, 0, B.AIR);
    d.slots[0] = { id: B.TNT, count: 1, damage: 0 };
    expect(dispense(g, 0, Y, 0)).toBe('tnt');
    expect(g.tnt).toEqual([[0.5, Y + 1, 0.5]]);
  });

  it('use bone meal on plants in front, and keep it when there is nothing to grow', () => {
    const g = setup();
    const d = put(g, 0, 0, B.DISPENSER, { id: I.BONE_MEAL, count: 2, damage: 0 });
    expect(dispense(g, 0, Y, 0)).toBe('fail');
    expect(d.slots[0].count).toBe(2);
    g.world.setBlock(1, Y - 1, 0, B.FARMLAND); g.world.setBlock(1, Y, 0, B.WHEAT, 0);
    expect(dispense(g, 0, Y, 0)).toBe('grow');
    expect(g.grown[0]).toMatchObject({ x: 1, y: Y, z: 0 });
    expect(d.slots[0].count).toBe(1);
  });

  it('put armour on a player standing in front, else drop it', () => {
    const g = setup();
    const d = put(g, 0, 0, B.DISPENSER, { id: I.IRON_HELMET, count: 1, damage: 0 });
    expect(dispense(g, 0, Y, 0)).toBe('drop'); // nobody there
    Object.assign(g.player, { x: 1.5, y: Y, z: 0.5 });
    d.slots[0] = { id: I.IRON_HELMET, count: 1, damage: 0 };
    expect(dispense(g, 0, Y, 0)).toBe('equip');
    expect(g.player.inventory.armor[0].id).toBe(I.IRON_HELMET);
  });

  it('pick a random filled slot, and hoppers feed them', () => {
    const slots = [null, { id: 1, count: 1 }, null, { id: 2, count: 1 }];
    expect(pickSlot(slots, () => 0)).toBe(1);
    expect(pickSlot(slots, () => 0.99)).toBe(3);
    expect(pickSlot([null, null], () => 0)).toBe(-1);
    const g = setup();
    g.world.setBlock(0, Y, 0, B.DISPENSER, EAST);
    g.world.setBlock(0, Y + 1, 0, B.HOPPER, 0);
    const h = g.getHopper(0, Y + 1, 0);
    h.slots[0] = { id: I.ARROW, count: 1, damage: 0 };
    hopperStep(g, h, false);
    expect(g.getDispenser(0, Y, 0).slots[0]).toMatchObject({ id: I.ARROW, count: 1 });
  });

  it('recipes', () => {
    const grid = (rows) => rows.flat().map((id) => (id == null ? null : { id, count: 1 }));
    const C = B.COBBLESTONE, R = I.CINNABAR;
    expect(craft(grid([[C, C, C], [C, I.BOW, C], [C, R, C]]), 3)).toMatchObject({ id: B.DISPENSER });
    expect(craft(grid([[C, C, C], [C, null, C], [C, R, C]]), 3)).toMatchObject({ id: B.DROPPER });
    expect(craft(grid([[I.GUNPOWDER, I.EMBER_POWDER, I.COAL], [null, null, null], [null, null, null]]), 3)).toMatchObject({ id: I.FIRE_CHARGE, count: 3 });
  });
});
