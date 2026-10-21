import { describe, it, expect } from 'vitest';
import { World } from '../src/world/world.js';
import { B } from '../src/world/blocks.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { CHUNK_VOLUME, cidx, MIN_Y } from '../src/world/constants.js';
import { wireMask, wirePowerSides, ON, REPEATER_POWERED, PISTON_EXTENDED, circuitParts, circuitSelection } from '../src/world/circuitShapes.js';
import { powerInto, placeMeta, useMeta, MAX_PUSH, BUTTON_TICKS } from '../src/world/circuits.js';
import { DOOR_OPEN, DOOR_UPPER, TRAPDOOR_OPEN } from '../src/world/shapes.js';
import { craft } from '../src/player/crafting.js';
import { I } from '../src/world/items.js';

function flatChunk() {
  const blocks = new Uint8Array(CHUNK_VOLUME);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 64; y++) blocks[cidx(x, y, z)] = B.STONE;
  const light = new Uint8Array(CHUNK_VOLUME);
  computeChunkLight(blocks, light);
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) };
}
function flatWorld(r = 1) {
  const w = new World(1);
  for (let cx = -r; cx <= r; cx++) for (let cz = -r; cz <= r; cz++) w.addChunk(cx, cz, flatChunk());
  w.tick(); // settle
  return w;
}
const run = (w, n = 1) => { for (let i = 0; i < n; i++) w.tick(); };
const Y = 64;
const lever = (w, x, z, on = false) => w.setBlock(x, Y, z, B.LEVER, on ? ON : 0);
const flip = (w, x, y, z) => w.setBlock(x, y, z, B.LEVER, w.getMeta(x, y, z) ^ ON);
const wire = (w, x0, x1, z = 0) => { for (let x = x0; x <= x1; x++) w.setBlock(x, Y, z, B.CINNABAR_WIRE, 0); };
const level = (w, x, z = 0, y = Y) => w.getMeta(x, y, z) & 15;

describe('cinnabar wire', () => {
  it('carries a lever\'s power, losing one level per block', () => {
    const w = flatWorld();
    lever(w, 0, 0);
    wire(w, 1, 16);
    flip(w, 0, Y, 0); run(w);
    for (let x = 1; x <= 16; x++) expect(level(w, x)).toBe(16 - x);
    flip(w, 0, Y, 0); run(w);
    for (let x = 1; x <= 16; x++) expect(level(w, x)).toBe(0);
  });

  it('takes the strongest of two sources and goes dark when a piece is removed', () => {
    const w = flatWorld();
    lever(w, 0, 0, true); lever(w, 12, 0, true);
    wire(w, 1, 11); run(w);
    expect(level(w, 6)).toBe(10); // 15 - 5 from the left beats 15 - 6 from the right
    expect(level(w, 11)).toBe(15);
    w.setBlock(6, Y, 0, B.AIR); run(w);
    expect(level(w, 5)).toBe(11);
    w.setBlock(12, Y, 0, B.AIR); run(w);
    expect(level(w, 7)).toBe(0);
  });

  it('connects to neighbours: dots, lines, corners, crosses and steps', () => {
    const w = flatWorld();
    const mask = (x, y, z) => wireMask((a, b, c) => w.getBlock(a, b, c), (a, b, c) => w.getMeta(a, b, c), x, y, z);
    w.setBlock(0, Y, 0, B.CINNABAR_WIRE);
    expect(mask(0, Y, 0)).toBe(0); // a lone dot
    expect(wirePowerSides(0)).toBe(15);
    w.setBlock(1, Y, 0, B.CINNABAR_WIRE);
    expect(mask(0, Y, 0)).toBe(2); // towards +x
    expect(wirePowerSides(2)).toBe(10); // a line powers both ends
    w.setBlock(0, Y, 1, B.CINNABAR_WIRE);
    expect(mask(0, Y, 0)).toBe(2 | 4); // corner
    w.setBlock(-1, Y, 0, B.CINNABAR_WIRE); w.setBlock(0, Y, -1, B.CINNABAR_WIRE);
    expect(mask(0, Y, 0)).toBe(15); // cross
    // a step up onto a block, and the climb is cut by a block above the lower wire
    w.setBlock(5, Y, 5, B.CINNABAR_WIRE); w.setBlock(6, Y, 5, B.STONE); w.setBlock(6, Y + 1, 5, B.CINNABAR_WIRE);
    expect(mask(5, Y, 5)).toBe(2 | 32);
    expect(mask(6, Y + 1, 5)).toBe(8); // down the step
    w.setBlock(5, Y + 1, 5, B.STONE);
    expect(mask(5, Y, 5)).toBe(0);
    // components attract wire; repeaters only along their axis
    w.setBlock(10, Y, 10, B.CINNABAR_WIRE); w.setBlock(11, Y, 10, B.CINNABAR_TORCH); w.setBlock(10, Y, 11, B.REPEATER, 1);
    expect(mask(10, Y, 10)).toBe(2);
    w.setBlock(10, Y, 11, B.REPEATER, 2);
    expect(mask(10, Y, 10)).toBe(2 | 4);
  });

  it('climbs stairs of blocks and is supported only on solid blocks', () => {
    const w = flatWorld();
    lever(w, 0, 0, true);
    w.setBlock(1, Y, 0, B.CINNABAR_WIRE);
    w.setBlock(2, Y, 0, B.STONE); w.setBlock(2, Y + 1, 0, B.CINNABAR_WIRE);
    w.setBlock(3, Y, 0, B.STONE); w.setBlock(3, Y + 1, 0, B.CINNABAR_WIRE);
    run(w);
    expect(level(w, 2, 0, Y + 1)).toBe(14);
    expect(level(w, 3, 0, Y + 1)).toBe(13);
    w.setBlock(2, Y, 0, B.AIR); // the step goes, its wire drops off
    expect(w.getBlock(2, Y + 1, 0)).toBe(B.AIR);
  });

  it('powers the block it runs into weakly: lamps light, other wire does not', () => {
    const w = flatWorld();
    lever(w, 0, 0, true);
    wire(w, 1, 2);
    w.setBlock(3, Y, 0, B.STONE);            // wire points into this block
    w.setBlock(3, Y, 1, B.CINNABAR_LAMP);    // a lamp beside the block
    w.setBlock(4, Y, 0, B.CINNABAR_WIRE);    // and wire on the far side
    run(w, 2);
    expect(w.getBlock(3, Y, 1)).toBe(B.CINNABAR_LAMP_ON);
    expect(level(w, 4)).toBe(0);
    // a lever on the block powers it strongly: now the far wire gets 15
    w.setBlock(3, Y + 1, 0, B.LEVER, ON);
    run(w);
    expect(level(w, 4)).toBe(15);
  });

  it('a lone dot powers all around it, a line passing by does not', () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.CINNABAR_BLOCK);
    w.setBlock(1, Y, 0, B.CINNABAR_WIRE);
    w.setBlock(1, Y, 1, B.CINNABAR_LAMP);
    run(w, 2);
    expect(w.getBlock(1, Y, 1)).toBe(B.CINNABAR_LAMP); // the line runs from the block along x
    w.setBlock(2, Y, 0, B.CINNABAR_WIRE); w.setBlock(1, Y, 0, B.AIR);
    w.setBlock(0, Y, 0, B.AIR); w.setBlock(2, Y, -1, B.LEVER, ON);
    w.setBlock(2, Y, 1, B.CINNABAR_LAMP);
    run(w, 2);
    expect(level(w, 2)).toBe(15);
    // the lever connects the wire towards -z, a line, so the lamp at +z (the other end) lights
    expect(w.getBlock(2, Y, 1)).toBe(B.CINNABAR_LAMP_ON);
  });
});

describe('components', () => {
  it('a lamp lights at once and goes out 4 ticks after its power', () => {
    const w = flatWorld();
    lever(w, 0, 0);
    w.setBlock(1, Y, 0, B.CINNABAR_LAMP);
    flip(w, 0, Y, 0); run(w);
    expect(w.getBlock(1, Y, 0)).toBe(B.CINNABAR_LAMP_ON);
    expect(w.blockLight(1, Y + 1, 0)).toBe(14);
    flip(w, 0, Y, 0); run(w, 3);
    expect(w.getBlock(1, Y, 0)).toBe(B.CINNABAR_LAMP_ON);
    run(w, 2);
    expect(w.getBlock(1, Y, 0)).toBe(B.CINNABAR_LAMP);
  });

  it('a torch inverts the power of its block after 2 ticks', () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.STONE);
    w.setBlock(0, Y + 1, 0, B.CINNABAR_TORCH, 0);   // on top of the block
    w.setBlock(-1, Y, 0, B.LEVER, 2);               // lever on the block's -x side (its wall is at +x: side 1)
    expect(w.hasSupport(-1, Y, 0, B.LEVER, 2)).toBe(true);
    w.setBlock(0, Y + 2, 0, B.CINNABAR_LAMP);        // lamp above the torch (strongly powered)
    run(w, 2);
    expect(w.getBlock(0, Y + 2, 0)).toBe(B.CINNABAR_LAMP_ON);
    flip(w, -1, Y, 0);
    run(w, 1);
    expect(w.getBlock(0, Y + 1, 0)).toBe(B.CINNABAR_TORCH);
    run(w, 2);
    expect(w.getBlock(0, Y + 1, 0)).toBe(B.CINNABAR_TORCH_OFF);
    run(w, 5);
    expect(w.getBlock(0, Y + 2, 0)).toBe(B.CINNABAR_LAMP);
    flip(w, -1, Y, 0); run(w, 3);
    expect(w.getBlock(0, Y + 1, 0)).toBe(B.CINNABAR_TORCH);
  });

  it('a torch toggled too often burns out for a while', () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.STONE);
    w.setBlock(0, Y + 1, 0, B.CINNABAR_TORCH, 0);
    w.setBlock(-1, Y, 0, B.LEVER, 2);
    for (let k = 0; k < 20; k++) { flip(w, -1, Y, 0); run(w, 3); }
    // now unpowered (20 flips, 10 turn-offs in 60 ticks), yet still dark: burnt out
    expect(w.getMeta(-1, Y, 0) & ON).toBe(0);
    expect(w.getBlock(0, Y + 1, 0)).toBe(B.CINNABAR_TORCH_OFF);
    run(w, 200);
    expect(w.getBlock(0, Y + 1, 0)).toBe(B.CINNABAR_TORCH);
  });

  it('a torch feeding a repeater into its own block makes a clock', () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.STONE);
    w.setBlock(1, Y, 0, B.CINNABAR_TORCH, 4); // on the block's +x face (its wall is at -x: side 3)
    w.setBlock(-1, Y, 0, B.REPEATER, 1);      // into the block from -x
    // wire from beside the torch round to the back of the repeater (never next to the block itself)
    for (const [x, z] of [[1, 1], [1, 2], [0, 2], [-1, 2], [-2, 2], [-2, 1], [-2, 0]]) w.setBlock(x, Y, z, B.CINNABAR_WIRE);
    const seen = [];
    for (let k = 0; k < 40; k++) { run(w); seen.push(w.getBlock(1, Y, 0) === B.CINNABAR_TORCH ? 1 : 0); }
    const flips = seen.slice(1).filter((v, i) => v !== seen[i]).length;
    expect(flips).toBeGreaterThan(4);
    // the burnout guard stops very fast clocks; this one (period 8) keeps going
    expect(seen.slice(-16).includes(1) && seen.slice(-16).includes(0)).toBe(true);
  });

  it('a repeater delays by 2 ticks per step and restores full power', () => {
    for (const delay of [1, 2, 3, 4]) {
      const w = flatWorld();
      lever(w, 0, 0);
      w.setBlock(1, Y, 0, B.REPEATER, 1 | ((delay - 1) << 2)); // output towards +x
      wire(w, 2, 3);
      flip(w, 0, Y, 0);
      let t = 0;
      while (level(w, 3) === 0 && t < 30) { run(w); t++; }
      expect(t).toBe(1 + delay * 2);
      expect(level(w, 2)).toBe(15);
      expect(w.getMeta(1, Y, 0) & REPEATER_POWERED).toBeTruthy();
    }
  });

  it('repeaters only pass power forwards and stretch short pulses', () => {
    const w = flatWorld();
    w.setBlock(1, Y, 0, B.REPEATER, 3 | (3 << 2)); // output towards -x, delay 4
    lever(w, 0, 0, true); // at its output side
    run(w, 12);
    expect(w.getMeta(1, Y, 0) & REPEATER_POWERED).toBe(0);
    // a 1-tick pulse from a button behind it still gives an 8-tick output
    w.setBlock(0, Y, 0, B.AIR);
    w.setBlock(2, Y, 0, B.LEVER, ON); run(w); w.setBlock(2, Y, 0, B.LEVER, 0);
    let on = 0;
    for (let k = 0; k < 30; k++) { run(w); if (w.getMeta(1, Y, 0) & REPEATER_POWERED) on++; }
    expect(on).toBeGreaterThanOrEqual(7);
  });

  it('a button gives a pulse of 20 ticks', () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.STONE_BUTTON, 0);
    w.setBlock(1, Y, 0, B.CINNABAR_LAMP);
    w.setBlock(0, Y, 0, B.STONE_BUTTON, useMeta(B.STONE_BUTTON, 0));
    run(w);
    expect(w.getBlock(1, Y, 0)).toBe(B.CINNABAR_LAMP_ON);
    expect(useMeta(B.STONE_BUTTON, ON)).toBe(-1); // cannot press it again
    run(w, BUTTON_TICKS - 2);
    expect(w.getMeta(0, Y, 0) & ON).toBeTruthy();
    run(w, 3);
    expect(w.getMeta(0, Y, 0) & ON).toBe(0);
    run(w, 5);
    expect(w.getBlock(1, Y, 0)).toBe(B.CINNABAR_LAMP);
  });

  it('a pressure plate stays down while something stands on it', () => {
    const w = flatWorld();
    let standing = true;
    w.circuits.entitiesOn = () => standing;
    w.setBlock(0, Y, 0, B.WOODEN_PRESSURE_PLATE, 0);
    w.setBlock(0, Y - 1, 1, B.CINNABAR_LAMP); // below-beside: powered through the block under the plate
    w.setBlock(0, Y - 1, 1, B.CINNABAR_LAMP);
    expect(w.circuits.press(0, Y, 0)).toBe(true);
    run(w, 2);
    expect(w.getBlock(0, Y - 1, 1)).toBe(B.CINNABAR_LAMP_ON);
    run(w, 50);
    expect(w.getMeta(0, Y, 0) & 1).toBe(1);
    standing = false;
    run(w, 25);
    expect(w.getMeta(0, Y, 0) & 1).toBe(0);
  });

  it('power opens doors, trapdoors and gates, and closes them again', () => {
    const w = flatWorld();
    w.setBlock(0, Y + 1, 0, B.DOOR, 0 | DOOR_UPPER, false); w.setBlock(0, Y, 0, B.DOOR, 0);
    w.setBlock(2, Y, 0, B.OAK_TRAPDOOR, 0);
    w.setBlock(4, Y, 0, B.OAK_FENCE_GATE, 0);
    for (const x of [1, 3, 5]) w.setBlock(x, Y, 0, B.LEVER, ON);
    run(w);
    expect(w.getMeta(0, Y, 0) & DOOR_OPEN).toBeTruthy();
    expect(w.getMeta(0, Y + 1, 0) & DOOR_OPEN).toBeTruthy();
    expect(w.getMeta(2, Y, 0) & TRAPDOOR_OPEN).toBeTruthy();
    expect(w.getMeta(4, Y, 0) & 4).toBeTruthy();
    for (const x of [1, 3, 5]) w.setBlock(x, Y, 0, B.LEVER, 0);
    run(w);
    expect(w.getMeta(0, Y, 0) & DOOR_OPEN).toBe(0);
    expect(w.getMeta(2, Y, 0) & TRAPDOOR_OPEN).toBe(0);
    expect(w.getMeta(4, Y, 0) & 4).toBe(0);
  });

  it('power sets off TNT and rings chime blocks once per pulse', () => {
    const w = flatWorld();
    const lit = [];
    w.onTNT = (x, y, z) => { lit.push([x, y, z]); w.setBlock(x, y, z, B.AIR); };
    w.setBlock(0, Y, 0, B.TNT);
    w.setBlock(1, Y, 0, B.LEVER, ON);
    run(w);
    expect(lit).toEqual([[0, Y, 0]]);
    const rings = [];
    w.on('blockChanged', (x, y, z, o, id) => { if (id === B.CHIME_BLOCK && w.getMeta(x, y, z) & 32) rings.push(w.getMeta(x, y, z) & 31); });
    w.setBlock(4, Y, 0, B.CHIME_BLOCK, useMeta(B.CHIME_BLOCK, 0));
    w.setBlock(5, Y, 0, B.LEVER, ON); run(w, 3);
    w.setBlock(5, Y, 0, B.LEVER, 0); run(w, 3);
    w.setBlock(5, Y, 0, B.LEVER, ON); run(w, 3);
    expect(rings).toEqual([1, 1]);
  });
});

describe('pistons', () => {
  const push = (w, n, end = B.AIR) => {
    w.setBlock(0, Y, 0, B.PISTON, 5); // facing +x
    for (let i = 1; i <= n; i++) w.setBlock(i, Y, 0, B.COBBLESTONE);
    if (end) w.setBlock(n + 1, Y, 0, end);
    w.setBlock(-1, Y, 0, B.LEVER, ON);
    run(w, 3);
  };
  it('push up to 12 blocks', () => {
    const w = flatWorld();
    push(w, MAX_PUSH);
    expect(w.getMeta(0, Y, 0) & PISTON_EXTENDED).toBeTruthy();
    expect(w.getBlock(1, Y, 0)).toBe(B.PISTON_HEAD);
    for (let i = 2; i <= MAX_PUSH + 1; i++) expect(w.getBlock(i, Y, 0)).toBe(B.COBBLESTONE);
    // retract: the head goes, the blocks stay
    w.setBlock(-1, Y, 0, B.LEVER, 0); run(w, 3);
    expect(w.getMeta(0, Y, 0) & PISTON_EXTENDED).toBe(0);
    expect(w.getBlock(1, Y, 0)).toBe(B.AIR);
    expect(w.getBlock(2, Y, 0)).toBe(B.COBBLESTONE);
  });
  it('cannot push 13 blocks or obsidian', () => {
    const w = flatWorld();
    push(w, MAX_PUSH + 1);
    expect(w.getMeta(0, Y, 0) & PISTON_EXTENDED).toBe(0);
    expect(w.getBlock(1, Y, 0)).toBe(B.COBBLESTONE);
    const w2 = flatWorld();
    push(w2, 2, B.OBSIDIAN);
    expect(w2.getMeta(0, Y, 0) & PISTON_EXTENDED).toBe(0);
  });
  it('breaks plants and torches in the way', () => {
    const w = flatWorld();
    const drops = [];
    w.on('dropItems', (x, y, z, id) => drops.push(id));
    push(w, 2, B.TORCH);
    expect(w.getBlock(3, Y, 0)).toBe(B.COBBLESTONE);
    expect(drops).toContain(B.TORCH);
  });
  it('a sticky piston pulls the block back', () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.STICKY_PISTON, 5);
    w.setBlock(1, Y, 0, B.CINNABAR_LAMP);
    w.setBlock(-1, Y, 0, B.LEVER, ON); run(w, 3);
    expect(w.getBlock(2, Y, 0)).toBe(B.CINNABAR_LAMP);
    expect(w.getMeta(1, Y, 0) & 8).toBeTruthy(); // a sticky head
    w.setBlock(-1, Y, 0, B.LEVER, 0); run(w, 3);
    expect(w.getBlock(1, Y, 0)).toBe(B.CINNABAR_LAMP);
    expect(w.getBlock(2, Y, 0)).toBe(B.AIR);
  });
  it('a piston is not powered through its front, and breaking the head breaks the base', () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.PISTON, 5);
    w.setBlock(1, Y, 0, B.CINNABAR_BLOCK);
    run(w, 3);
    expect(w.getMeta(0, Y, 0) & PISTON_EXTENDED).toBe(0);
    expect(powerInto(w, 0, Y, 0, 5)).toBe(0);
    w.setBlock(-1, Y, 0, B.CINNABAR_BLOCK); run(w, 3); // from behind it works (and pushes the block)
    expect(w.getBlock(2, Y, 0)).toBe(B.CINNABAR_BLOCK);
    const drops = [];
    w.on('dropItems', (x, y, z, id) => drops.push(id));
    w.setBlock(1, Y, 0, B.AIR);
    expect(w.getBlock(0, Y, 0)).toBe(B.AIR);
    expect(drops).toEqual([B.PISTON]);
  });
  it('vertical pistons push blocks up', () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.PISTON, 1);
    w.setBlock(0, Y + 1, 0, B.SAND);
    w.setBlock(1, Y, 0, B.LEVER, ON); run(w, 3);
    expect(w.getBlock(0, Y + 1, 0)).toBe(B.PISTON_HEAD);
    expect(w.getBlock(0, Y + 2, 0)).toBe(B.SAND);
  });
});

describe('circuit plumbing', () => {
  it('guests do not simulate', () => {
    const w = flatWorld();
    w.circuits.enabled = false;
    lever(w, 0, 0, true); wire(w, 1, 3); run(w, 3);
    expect(level(w, 1)).toBe(0);
  });
  it('a big network is solved without update storms', () => {
    const w = flatWorld(2);
    for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z += 2) w.setBlock(x, Y, z, B.CINNABAR_WIRE);
    for (let z = -30; z <= 30; z += 4) w.setBlock(30, Y, z + 1, B.CINNABAR_WIRE), w.setBlock(-30, Y, z + 3, B.CINNABAR_WIRE);
    run(w);
    const before = w.circuits.stats.networks;
    w.setBlock(-31, Y, -30, B.LEVER, ON); run(w);
    expect(w.circuits.stats.networks - before).toBeLessThan(10);
    expect(level(w, -30, -30)).toBe(15);
    expect(level(w, -16, -30)).toBe(1);
  });
  it('stale levels settle when the chunk loads again', () => {
    const w = flatWorld();
    lever(w, 0, 0, true); wire(w, 1, 5); run(w);
    // corrupt the stored levels, as if scheduled updates were lost on save
    w.circuits.enabled = false;
    for (let x = 1; x <= 5; x++) w.setBlock(x, Y, 0, B.CINNABAR_WIRE, 0, false);
    w.circuits.enabled = true;
    const c = w.removeChunk(0, 0);
    w.addChunk(0, 0, { ...c, modified: true });
    run(w);
    expect(level(w, 5)).toBe(11);
  });
  it('placement metas and supports', () => {
    expect(placeMeta(B.LEVER, [0, 1, 0], [0, -1, 0.1])).toBe(0);
    expect(placeMeta(B.LEVER, [1, 0, 0], [-1, 0, 0])).toBe(1 + 3); // on the +x face of a block: wall at -x
    expect(placeMeta(B.REPEATER, [0, 1, 0], [1, -0.5, 0])).toBe(1);
    expect(placeMeta(B.REPEATER, [1, 0, 0], [1, 0, 0])).toBe(-1);
    expect(placeMeta(B.PISTON, [0, 1, 0], [0, -0.9, 0.1])).toBe(1);
    expect(placeMeta(B.PISTON, [0, 0, 1], [0, 0, -1])).toBe(3); // faces the player at +z
    const w = flatWorld();
    expect(w.hasSupport(0, Y, 0, B.CINNABAR_WIRE, 0)).toBe(true);
    expect(w.hasSupport(0, Y + 3, 0, B.CINNABAR_WIRE, 0)).toBe(false);
    expect(useMeta(B.REPEATER, 3 << 2)).toBe(0);
    expect(useMeta(B.CHIME_BLOCK, 24)).toBe(0);
  });
  it('shapes: parts stay inside their block, flat parts are flat', () => {
    for (const [id, m] of [[B.LEVER, 0], [B.LEVER, 3 | ON], [B.LEVER, 5], [B.STONE_BUTTON, 2], [B.REPEATER, 6], [B.PISTON_HEAD, 4]]) {
      const s = circuitSelection(id, m);
      for (let a = 0; a < 3; a++) { expect(s[a]).toBeGreaterThanOrEqual(0); expect(s[a + 3]).toBeLessThanOrEqual(1); expect(s[a + 3]).toBeGreaterThan(s[a]); }
    }
    expect(circuitSelection(B.WOODEN_PRESSURE_PLATE, 0)[4]).toBeLessThan(0.1);
    expect(circuitParts(B.REPEATER, 0).length).toBe(3);
  });
  it('recipes', () => {
    const g = (rows) => rows.flat().map((id) => (id == null ? null : { id, count: 1 }));
    expect(craft(g([[I.CINNABAR, null, null], [I.STICK, null, null], [null, null, null]]), 3)).toMatchObject({ id: B.CINNABAR_TORCH });
    expect(craft(g([[B.CINNABAR_TORCH, I.CINNABAR, B.CINNABAR_TORCH], [B.STONE, B.STONE, B.STONE], [null, null, null]]), 3)).toMatchObject({ id: B.REPEATER });
    expect(craft(g([[B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS], [B.COBBLESTONE, I.IRON_INGOT, B.COBBLESTONE], [B.COBBLESTONE, I.CINNABAR, B.COBBLESTONE]]), 3)).toMatchObject({ id: B.PISTON });
  });
});
