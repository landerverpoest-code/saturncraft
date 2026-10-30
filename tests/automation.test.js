import { describe, it, expect } from 'vitest';
import { World } from '../src/world/world.js';
import { B, BLOCKS, NUM_BLOCKS } from '../src/world/blocks.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { CHUNK_VOLUME, cidx, MIN_Y } from '../src/world/constants.js';
import { PISTON_EXTENDED } from '../src/world/circuitShapes.js';
import { weightedLevel, railSpeed, pushStructure, sticks, RAIL_CHAIN, MAX_STRUCTURE, RAIL_ON, plateLevel } from '../src/world/automation.js';
import { railShapeOf, updateRails, isRail } from '../src/world/rails.js';
import { selectionBox } from '../src/world/shapes.js';
import { Body } from '../src/physics/body.js';
import { PHYS } from '../src/physics/constants.js';
import { craft } from '../src/player/crafting.js';
import { I } from '../src/world/items.js';
import { MockWorld } from './helpers.js';

function flatChunk() {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 64; y++) blocks[cidx(x, y, z)] = B.STONE;
  const light = new Uint8Array(CHUNK_VOLUME);
  computeChunkLight(blocks, light);
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) };
}
function flatWorld(r = 1) {
  const w = new World(1);
  for (let cx = -r; cx <= r; cx++) for (let cz = -r; cz <= r; cz++) w.addChunk(cx, cz, flatChunk());
  w.tick();
  return w;
}
const run = (w, n = 1) => { for (let i = 0; i < n; i++) w.tick(); };
const Y = 64;
const level = (w, x, z = 0, y = Y) => w.getMeta(x, y, z) & 15;
const NEW = ['POWERED_RAIL', 'DETECTOR_RAIL', 'ACTIVATOR_RAIL', 'STONE_PRESSURE_PLATE', 'LIGHT_WEIGHTED_PLATE', 'HEAVY_WEIGHTED_PLATE', 'SLIME_BLOCK', 'HONEY_BLOCK'];
const grid = (ids) => ids.map((id) => (id == null ? null : { id, count: 1 }));

describe('appended ids', () => {
  it('the new blocks come after the old ones, in order, and are all defined', () => {
    for (const k of NEW) {
      expect(B[k]).toBeGreaterThan(B.CARVED_PUMPKIN);
      expect(BLOCKS[B[k]].name.length).toBeGreaterThan(3);
    }
    for (let i = 1; i < NEW.length; i++) expect(B[NEW[i]]).toBe(B[NEW[i - 1]] + 1);
    expect(NUM_BLOCKS).toBeGreaterThan(B.HONEY_BLOCK);
  });
});

describe('pressure plates', () => {
  it('weighted plates grow with the number of things on them', () => {
    expect(weightedLevel(B.LIGHT_WEIGHTED_PLATE, 0)).toBe(0);
    expect(weightedLevel(B.LIGHT_WEIGHTED_PLATE, 4)).toBe(4);
    expect(weightedLevel(B.LIGHT_WEIGHTED_PLATE, 40)).toBe(15);
    expect(weightedLevel(B.HEAVY_WEIGHTED_PLATE, 1)).toBe(1);
    expect(weightedLevel(B.HEAVY_WEIGHTED_PLATE, 10)).toBe(1);
    expect(weightedLevel(B.HEAVY_WEIGHTED_PLATE, 11)).toBe(2);
    expect(weightedLevel(B.HEAVY_WEIGHTED_PLATE, 500)).toBe(15);
    expect(plateLevel(B.LIGHT_WEIGHTED_PLATE, 7)).toBe(7);
    expect(plateLevel(B.STONE_PRESSURE_PLATE, 1)).toBe(15);
    expect(plateLevel(B.STONE_PRESSURE_PLATE, 0)).toBe(0);
  });

  it('a weighted plate sends its level into wire, follows the crowd and lets go', () => {
    const w = flatWorld();
    let crowd = 3;
    w.circuits.entitiesCount = () => crowd;
    w.setBlock(0, Y, 0, B.LIGHT_WEIGHTED_PLATE, 0);
    w.setBlock(1, Y, 0, B.CINNABAR_WIRE, 0);
    expect(w.circuits.press(0, Y, 0, crowd)).toBe(true);
    run(w, 2);
    expect(w.getMeta(0, Y, 0)).toBe(3);
    expect(level(w, 1)).toBe(3);
    crowd = 9;
    run(w, 25);
    expect(w.getMeta(0, Y, 0)).toBe(9);
    expect(level(w, 1)).toBe(9);
    crowd = 0;
    run(w, 25);
    expect(w.getMeta(0, Y, 0)).toBe(0);
    expect(level(w, 1)).toBe(0);
  });

  it('a heavy plate counts in tens', () => {
    const w = flatWorld();
    w.circuits.entitiesCount = () => 25;
    w.setBlock(0, Y, 0, B.HEAVY_WEIGHTED_PLATE, 0);
    w.circuits.press(0, Y, 0, 25);
    run(w, 2);
    expect(w.getMeta(0, Y, 0)).toBe(3);
  });

  it('the stone plate asks for living things only and stays down while one stands on it', () => {
    const w = flatWorld();
    const asked = [];
    let n = 1;
    w.circuits.entitiesCount = (x, y, z, living) => { asked.push(living); return n; };
    w.setBlock(0, Y, 0, B.STONE_PRESSURE_PLATE, 0);
    w.setBlock(0, Y, 1, B.CINNABAR_LAMP);
    expect(w.circuits.press(0, Y, 0)).toBe(true);
    expect(w.circuits.press(0, Y, 0)).toBe(false); // already down
    run(w, 3);
    expect(w.getBlock(0, Y, 1)).toBe(B.CINNABAR_LAMP_ON);
    run(w, 45);
    expect(w.getMeta(0, Y, 0) & 1).toBe(1);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((v) => v === true)).toBe(true);
    n = 0;
    run(w, 25);
    expect(w.getMeta(0, Y, 0) & 1).toBe(0);
  });

  it('need a floor, and are recipes', () => {
    const w = flatWorld();
    w.setBlock(0, Y + 5, 0, B.STONE_PRESSURE_PLATE, 0);
    run(w, 2);
    expect(w.getBlock(0, Y + 5, 0)).toBe(B.AIR); // nothing to stand on: it broke
    expect(craft(grid([B.STONE, B.STONE, null, null]), 2)).toEqual({ id: B.STONE_PRESSURE_PLATE, count: 1 });
    expect(craft(grid([I.GOLD_INGOT, I.GOLD_INGOT, null, null]), 2)).toEqual({ id: B.LIGHT_WEIGHTED_PLATE, count: 1 });
    expect(craft(grid([I.IRON_INGOT, I.IRON_INGOT, null, null]), 2)).toEqual({ id: B.HEAVY_WEIGHTED_PLATE, count: 1 });
  });
});

describe('cinnabar rails', () => {
  const lay = (w, id, n, meta = 1) => { for (let x = 0; x < n; x++) w.setBlock(x, Y, 0, id, meta); };

  it('are straight rails that the cart and the mesher read by the same shape', () => {
    expect(isRail(B.RAIL) && isRail(B.POWERED_RAIL) && isRail(B.DETECTOR_RAIL) && isRail(B.ACTIVATOR_RAIL)).toBe(true);
    expect(isRail(B.STONE)).toBe(false);
    expect(railShapeOf(B.RAIL, 7)).toBe(7);
    expect(railShapeOf(B.POWERED_RAIL, 1 | RAIL_ON)).toBe(1);
    expect(railShapeOf(B.DETECTOR_RAIL, 3)).toBe(3);
    expect(selectionBox(B.POWERED_RAIL, 2 | RAIL_ON)[4]).toBe(0.5); // ascending
    expect(selectionBox(B.ACTIVATOR_RAIL, 1)[4]).toBeCloseTo(2 / 16);
  });

  it('never bend into curves and keep their on bit when reshaped', () => {
    const w = new MockWorld(64);
    w.setBlock = (x, y, z, id, meta = 0) => { w.set(x, y, z, id, meta); return true; };
    w.set(0, 64, 0, B.POWERED_RAIL, RAIL_ON);
    w.set(1, 64, 0, B.RAIL, 0);
    w.set(0, 64, 1, B.RAIL, 0);
    updateRails(w, 0, 64, 0);
    expect(w.getMeta(0, 64, 0) & 7).toBeLessThan(2); // straight
    expect(w.getMeta(0, 64, 0) & RAIL_ON).toBe(RAIL_ON);
    // a plain rail still curves
    w.set(5, 64, 0, B.RAIL, 0); w.set(6, 64, 0, B.RAIL, 0); w.set(5, 64, 1, B.RAIL, 0);
    updateRails(w, 5, 64, 0);
    expect(w.getMeta(5, 64, 0)).toBeGreaterThanOrEqual(6);
  });

  it('a powered rail switches on with power and off without', () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.POWERED_RAIL, 1);
    run(w, 2);
    expect(w.getMeta(0, Y, 0) & RAIL_ON).toBe(0);
    w.setBlock(0, Y, 1, B.CINNABAR_BLOCK);
    run(w, 2);
    expect(w.getMeta(0, Y, 0) & RAIL_ON).toBe(RAIL_ON);
    expect(w.getMeta(0, Y, 0) & 7).toBe(1); // still east-west
    w.setBlock(0, Y, 1, B.AIR);
    run(w, 2);
    expect(w.getMeta(0, Y, 0) & RAIL_ON).toBe(0);
  });

  it('power runs along a line of powered rails for a few rails, not for ever', () => {
    const w = flatWorld(2);
    lay(w, B.POWERED_RAIL, RAIL_CHAIN + 3);
    w.setBlock(0, Y, 1, B.CINNABAR_BLOCK);
    run(w, 3);
    for (let x = 0; x <= RAIL_CHAIN; x++) expect(w.getMeta(x, Y, 0) & RAIL_ON, 'rail ' + x).toBe(RAIL_ON);
    expect(w.getMeta(RAIL_CHAIN + 1, Y, 0) & RAIL_ON).toBe(0);
    w.setBlock(0, Y, 1, B.AIR);
    run(w, 3);
    for (let x = 0; x <= RAIL_CHAIN + 2; x++) expect(w.getMeta(x, Y, 0) & RAIL_ON).toBe(0);
  });

  it('power does not jump to a rail of another kind or one beside the line', () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.POWERED_RAIL, 1);
    w.setBlock(1, Y, 0, B.ACTIVATOR_RAIL, 1);
    w.setBlock(0, Y, 2, B.POWERED_RAIL, 1); // beside, not in line
    w.setBlock(-1, Y, 0, B.CINNABAR_BLOCK);
    run(w, 3);
    expect(w.getMeta(0, Y, 0) & RAIL_ON).toBe(RAIL_ON);
    expect(w.getMeta(1, Y, 0) & RAIL_ON).toBe(0);
    expect(w.getMeta(0, Y, 2) & RAIL_ON).toBe(0);
  });

  it('an activator rail takes its power the same way', () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.ACTIVATOR_RAIL, 0);
    w.setBlock(1, Y, 0, B.CINNABAR_BLOCK);
    run(w, 3);
    expect(w.getMeta(0, Y, 0) & RAIL_ON).toBe(RAIL_ON);
  });

  it('a detector rail powers its neighbours while a cart is on it and lets go afterwards', () => {
    const w = flatWorld();
    let cart = true;
    w.circuits.cartOn = () => cart;
    w.setBlock(0, Y, 0, B.DETECTOR_RAIL, 1);
    w.setBlock(0, Y, 1, B.CINNABAR_LAMP);
    expect(w.circuits.detect(1, Y, 0)).toBe(false); // not a rail
    expect(w.circuits.detect(0, Y, 0)).toBe(true);
    expect(w.circuits.detect(0, Y, 0)).toBe(false); // already on
    run(w, 3);
    expect(w.getBlock(0, Y, 1)).toBe(B.CINNABAR_LAMP_ON);
    run(w, 40);
    expect(w.getMeta(0, Y, 0) & RAIL_ON).toBe(RAIL_ON);
    cart = false;
    run(w, 6);
    expect(w.getMeta(0, Y, 0) & RAIL_ON).toBe(0);
    run(w, 6);
    expect(w.getBlock(0, Y, 1)).toBe(B.CINNABAR_LAMP);
    expect(w.getMeta(0, Y, 0) & 7).toBe(1); // the shape survived
  });

  it('a powered rail speeds a cart up, holds it back when off and pushes it off a wall', () => {
    expect(railSpeed(B.RAIL, true, 0.1)).toBe(0.1);
    expect(railSpeed(B.DETECTOR_RAIL, true, 0.1)).toBe(0.1);
    expect(railSpeed(B.POWERED_RAIL, true, 0.1)).toBeGreaterThan(0.1);
    expect(railSpeed(B.POWERED_RAIL, true, -0.1)).toBeLessThan(-0.1);
    expect(railSpeed(B.POWERED_RAIL, false, 0.2)).toBeCloseTo(0.1);
    expect(railSpeed(B.POWERED_RAIL, false, 0.03)).toBe(0); // stopped dead
    expect(railSpeed(B.POWERED_RAIL, true, 0, [true, false])).toBeGreaterThan(0);
    expect(railSpeed(B.POWERED_RAIL, true, 0, [false, true])).toBeLessThan(0);
    expect(railSpeed(B.POWERED_RAIL, true, 0, [false, false])).toBe(0);
  });

  it('are recipes that make six', () => {
    const G = I.GOLD_INGOT, S = I.STICK, C = I.CINNABAR, N = I.IRON_INGOT;
    expect(craft(grid([G, null, G, G, S, G, G, C, G]), 3)).toEqual({ id: B.POWERED_RAIL, count: 6 });
    expect(craft(grid([N, null, N, N, B.STONE_PRESSURE_PLATE, N, N, C, N]), 3)).toEqual({ id: B.DETECTOR_RAIL, count: 6 });
    expect(craft(grid([N, S, N, N, B.CINNABAR_TORCH, N, N, S, N]), 3)).toEqual({ id: B.ACTIVATOR_RAIL, count: 6 });
  });
});

describe('sticky blocks and pistons', () => {
  const Z = Y + 4; // in the air, away from the stone floor (which a slime block would stick to)
  const power = (w) => { w.setBlock(-1, Z, 0, B.CINNABAR_BLOCK); run(w, 3); };
  const unpower = (w) => { w.setBlock(-1, Z, 0, B.AIR); run(w, 3); };

  it('who sticks to whom', () => {
    expect(sticks(B.SLIME_BLOCK, B.STONE)).toBe(true);
    expect(sticks(B.STONE, B.HONEY_BLOCK)).toBe(true);
    expect(sticks(B.SLIME_BLOCK, B.SLIME_BLOCK)).toBe(true);
    expect(sticks(B.HONEY_BLOCK, B.HONEY_BLOCK)).toBe(true);
    expect(sticks(B.SLIME_BLOCK, B.HONEY_BLOCK)).toBe(false);
    expect(sticks(B.STONE, B.COBBLESTONE)).toBe(false);
  });

  it('a pushed slime block takes the blocks around it along, and what is in front of them', () => {
    const w = flatWorld();
    w.setBlock(0, Z, 0, B.PISTON, 5);
    w.setBlock(1, Z, 0, B.SLIME_BLOCK);
    w.setBlock(1, Z, 1, B.STONE);        // beside the slime
    w.setBlock(1, Z + 1, 0, B.COBBLESTONE); // on top of it
    w.setBlock(2, Z, 0, B.OAK_PLANKS); // in its way
    w.setBlock(1, Z, 3, B.STONE);        // far away: stays
    power(w);
    expect(w.getMeta(0, Z, 0) & PISTON_EXTENDED).toBeTruthy();
    expect(w.getBlock(1, Z, 0)).toBe(B.PISTON_HEAD);
    expect(w.getBlock(2, Z, 0)).toBe(B.SLIME_BLOCK);
    expect(w.getBlock(2, Z, 1)).toBe(B.STONE);
    expect(w.getBlock(2, Z + 1, 0)).toBe(B.COBBLESTONE);
    expect(w.getBlock(3, Z, 0)).not.toBe(B.AIR); // the block in its way was pushed on
    expect(w.getBlock(1, Z, 1)).toBe(B.AIR);
    expect(w.getBlock(1, Z + 1, 0)).toBe(B.AIR);
    expect(w.getBlock(1, Z, 3)).toBe(B.STONE);
  });

  it('a honey block holds on as well, but not to a slime block', () => {
    const w = flatWorld();
    w.setBlock(0, Z, 0, B.PISTON, 5);
    w.setBlock(1, Z, 0, B.SLIME_BLOCK);
    w.setBlock(1, Z, 1, B.HONEY_BLOCK);  // does not stick to the slime
    w.setBlock(1, Z, -1, B.STONE);       // does
    power(w);
    expect(w.getBlock(2, Z, 0)).toBe(B.SLIME_BLOCK);
    expect(w.getBlock(2, Z, -1)).toBe(B.STONE);
    expect(w.getBlock(1, Z, 1)).toBe(B.HONEY_BLOCK);
    const w2 = flatWorld();
    w2.setBlock(0, Z, 0, B.PISTON, 5);
    w2.setBlock(1, Z, 0, B.HONEY_BLOCK);
    w2.setBlock(1, Z, 1, B.STONE);
    power(w2);
    expect(w2.getBlock(2, Z, 0)).toBe(B.HONEY_BLOCK);
    expect(w2.getBlock(2, Z, 1)).toBe(B.STONE);
  });

  it('a sticky piston draws the whole cluster back', () => {
    const w = flatWorld();
    w.setBlock(0, Z, 0, B.STICKY_PISTON, 5);
    w.setBlock(1, Z, 0, B.SLIME_BLOCK);
    w.setBlock(1, Z, 1, B.COBBLESTONE);
    power(w);
    expect(w.getBlock(2, Z, 0)).toBe(B.SLIME_BLOCK);
    expect(w.getBlock(2, Z, 1)).toBe(B.COBBLESTONE);
    unpower(w);
    expect(w.getMeta(0, Z, 0) & PISTON_EXTENDED).toBe(0);
    expect(w.getBlock(1, Z, 0)).toBe(B.SLIME_BLOCK);
    expect(w.getBlock(1, Z, 1)).toBe(B.COBBLESTONE);
    expect(w.getBlock(2, Z, 0)).toBe(B.AIR);
    expect(w.getBlock(2, Z, 1)).toBe(B.AIR);
  });

  it('a plain sticky piston still pulls one plain block, and leaves a neighbour alone', () => {
    const w = flatWorld();
    w.setBlock(0, Z, 0, B.STICKY_PISTON, 5);
    w.setBlock(1, Z, 0, B.COBBLESTONE);
    w.setBlock(2, Z, 1, B.STONE);
    power(w);
    unpower(w);
    expect(w.getBlock(1, Z, 0)).toBe(B.COBBLESTONE);
    expect(w.getBlock(2, Z, 1)).toBe(B.STONE);
  });

  it('jams when too many blocks hold together, or when something attached cannot move', () => {
    const w = flatWorld();
    w.setBlock(0, Z, 0, B.PISTON, 5);
    for (let i = 0; i < MAX_STRUCTURE + 1; i++) w.setBlock(1, Z + i, 0, B.SLIME_BLOCK); // a tower of 13
    power(w);
    expect(w.getMeta(0, Z, 0) & PISTON_EXTENDED).toBe(0);
    expect(w.getBlock(1, Z, 0)).toBe(B.SLIME_BLOCK);
    const ok = pushStructure(w, 0, Z, 0, 5);
    expect(ok.ok).toBe(false);

    const w2 = flatWorld();
    w2.setBlock(0, Z, 0, B.PISTON, 5);
    w2.setBlock(1, Z, 0, B.SLIME_BLOCK);
    w2.setBlock(1, Z, 1, B.OBSIDIAN);
    power(w2);
    expect(w2.getMeta(0, Z, 0) & PISTON_EXTENDED).toBe(0);

    const w3 = flatWorld();
    w3.setBlock(0, Z, 0, B.PISTON, 5);
    for (let i = 0; i < MAX_STRUCTURE; i++) w3.setBlock(1, Z + i, 0, B.SLIME_BLOCK); // exactly twelve still goes
    power(w3);
    expect(w3.getMeta(0, Z, 0) & PISTON_EXTENDED).toBeTruthy();
    expect(w3.getBlock(2, Z + MAX_STRUCTURE - 1, 0)).toBe(B.SLIME_BLOCK);
  });

  it('breaks plants in the way of a cluster and works for vertical pistons', () => {
    const w = flatWorld();
    w.setBlock(0, Z, 0, B.PISTON, 5);
    w.setBlock(1, Z, 0, B.SLIME_BLOCK);
    w.setBlock(1, Z + 1, 0, B.STONE);   // stuck on top; it moves into the cobweb's cell
    w.setBlock(2, Z + 1, 0, B.COBWEB);
    const r = pushStructure(w, 0, Z, 0, 5);
    expect(r.ok).toBe(true);
    expect(r.breaks).toEqual([[2, Z + 1, 0]]);
    power(w);
    expect(w.getBlock(2, Z, 0)).toBe(B.SLIME_BLOCK);
    expect(w.getBlock(2, Z + 1, 0)).toBe(B.STONE);
    const w2 = flatWorld();
    w2.setBlock(0, Z, 0, B.PISTON, 1); // facing up
    w2.setBlock(0, Z + 1, 0, B.HONEY_BLOCK);
    w2.setBlock(1, Z + 1, 0, B.STONE);
    w2.setBlock(-1, Z, 0, B.CINNABAR_BLOCK); run(w2, 3);
    expect(w2.getBlock(0, Z + 2, 0)).toBe(B.HONEY_BLOCK);
    expect(w2.getBlock(1, Z + 2, 0)).toBe(B.STONE);
  });

  it('are recipes', () => {
    const S = I.SLIMEBALL;
    expect(craft(grid([S, S, S, S, S, S, S, S, S]), 3)).toEqual({ id: B.SLIME_BLOCK, count: 1 });
    expect(craft(grid([B.SLIME_BLOCK, null, null, null]), 2)).toEqual({ id: I.SLIMEBALL, count: 9 });
    expect(craft(grid([I.HONEYCOMB, I.HONEYCOMB, I.HONEYCOMB, I.HONEYCOMB]), 2)).toEqual({ id: B.HONEY_BLOCK, count: 1 });
  });
});

describe('landing on slime and honey', () => {
  const settle = (floor) => {
    const w = new MockWorld(64);
    w.set(0, 63, 0, floor);
    const b = new Body(PHYS.PLAYER_WIDTH, PHYS.PLAYER_HEIGHT);
    b.setPos(0.5, 74, 0.5);
    return { w, b };
  };

  it('a slime block throws a falling body back up and cancels the fall', () => {
    const { w, b } = settle(B.SLIME_BLOCK);
    let bounced = false, peakFall = 0;
    for (let i = 0; i < 80 && !bounced; i++) {
      b.travel(w, {});
      peakFall = Math.max(peakFall, b.fallDistance);
      if (b.vy > 0.2 && peakFall > 5) bounced = true;
    }
    expect(bounced).toBe(true);
    expect(peakFall).toBeGreaterThan(5);
    expect(b.fallDistance).toBe(0);
  });

  it('a sneaking body does not bounce, but is not hurt either', () => {
    const { w, b } = settle(B.SLIME_BLOCK);
    let landed = false;
    for (let i = 0; i < 80 && !landed; i++) { b.travel(w, { sneak: true }); if (b.onGround) landed = true; }
    expect(landed).toBe(true);
    expect(b.fallDistance).toBe(0);
  });

  it('stone still gives the full fall, honey a fifth of it', () => {
    const fall = (floor) => {
      const { w, b } = settle(floor);
      let at = -1;
      for (let i = 0; i < 80; i++) {
        const before = b.fallDistance;
        b.travel(w, {});
        if (b.onGround) { at = before > b.fallDistance ? before : b.fallDistance; break; }
      }
      return b.fallDistance;
    };
    const stone = fall(B.STONE), honey = fall(B.HONEY_BLOCK);
    expect(stone).toBeGreaterThan(8);
    expect(honey).toBeCloseTo(stone * 0.2, 5);
  });

  it('honey slows whoever walks on it', () => {
    expect(BLOCKS[B.HONEY_BLOCK].speedFactor).toBeLessThan(1);
    expect(BLOCKS[B.SLIME_BLOCK].bouncy).toBe(true);
  });
});
