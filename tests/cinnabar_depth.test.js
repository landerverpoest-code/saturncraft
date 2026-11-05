import { describe, it, expect } from 'vitest';
import { World } from '../src/world/world.js';
import { B, BLOCKS } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { CHUNK_VOLUME, cidx, MIN_Y } from '../src/world/constants.js';
import {
  ON, PISTON_EXTENDED, OBSERVER_POWERED, SENSOR_INVERTED, SNARE_ATTACHED, SNARE_TRIPPED, SNARE_AXIS_X, PG_ON, PG_LATCH, PG_REST,
  comparatorLevel, COMPARATOR_SUBTRACT, circuitParts, circuitSelection,
} from '../src/world/circuitShapes.js';
import {
  powerInto, placeMeta, useMeta, supported, CIRCUIT_REACT, CIRCUIT_SETTLE, LOOP_LIMIT, LOOP_FUSE, LOOP_WATCH, OBSERVE_PER_TICK,
  SCHEDULED_PER_TICK, UPDATES_PER_TICK, OBSERVER_DELAY,
} from '../src/world/circuits.js';
import { snareLine, SNARE_RANGE, SNARE_HOLD } from '../src/world/snare.js';
import { PULSE_GATE_SETTINGS, gateSetting, gateLabel } from '../src/world/pulseGate.js';
import { containerSignal } from '../src/world/comparators.js';
import { hopperStep, newHopper } from '../src/world/hoppers.js';
import { craft } from '../src/player/crafting.js';
import { buildTopics } from '../src/ui/helpTopics.js';
import { resolveBindings } from '../src/ui/bindings.js';

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
const EAST = 1;
const grid = (ids) => ids.map((id) => (id == null ? null : { id, count: 1 }));
const meta = (w, x, z, y = Y) => w.getMeta(x, y, z);
// names of the reference game that must not appear in anything we ship (spelled in pieces so this file stays clean too)
const FORBIDDEN = new RegExp([['mine', 'craft'], ['neth', 'er'], ['red', 'stone'], ['trip', 'wire']].map((p) => p.join('')).join('|'), 'i');

// ---------------------------------------------------------------------------------------------------------------------
describe('the audit: what a builder can already lean on, and what was added', () => {
  it('every contraption part exists under its own name', () => {
    const have = ['CINNABAR_WIRE', 'CINNABAR_TORCH', 'REPEATER', 'LEVER', 'STONE_BUTTON', 'WOODEN_PRESSURE_PLATE', 'STONE_PRESSURE_PLATE',
      'LIGHT_WEIGHTED_PLATE', 'HEAVY_WEIGHTED_PLATE', 'PISTON', 'STICKY_PISTON', 'DISPENSER', 'DROPPER', 'HOPPER', 'CHIME_BLOCK',
      'CINNABAR_LAMP', 'TARGET', 'COMPARATOR', 'OBSERVER', 'DAYLIGHT_SENSOR', 'SLIME_BLOCK', 'HONEY_BLOCK', 'DETECTOR_RAIL', 'LECTERN',
      'SNARE_POST', 'SNARE_CORD', 'PULSE_GATE'];
    for (const k of have) expect(B[k], k).toBeGreaterThan(0);
    expect(BLOCKS[B.OBSERVER].name).toBe('Observer'); // the block-update detector
  });

  it('the new blocks are appended after every older id (nothing was renumbered)', () => {
    expect(B.SNARE_POST).toBeGreaterThan(B.SUNGOURD);
    expect(B.SNARE_CORD).toBe(B.SNARE_POST + 1);
    expect(B.PULSE_GATE).toBe(B.SNARE_POST + 2);
    expect(B.COMPARATOR).toBeLessThan(B.SNARE_POST);
  });

  it('are wired into the simulation and carry original names', () => {
    for (const id of [B.SNARE_POST, B.SNARE_CORD, B.PULSE_GATE]) {
      expect(CIRCUIT_REACT[id]).toBe(1);
      expect(BLOCKS[id].name).not.toMatch(FORBIDDEN);
    }
    expect(CIRCUIT_SETTLE[B.SNARE_POST]).toBe(1);
    expect(CIRCUIT_SETTLE[B.PULSE_GATE]).toBe(1);
  });

  it('are recipes', () => {
    expect(craft(grid([null, I.IRON_INGOT, null, null, I.STICK, null, null, B.OAK_PLANKS, null]), 3)).toEqual({ id: B.SNARE_POST, count: 2 });
    expect(craft(grid([I.STRING, null, null, null]), 2)).toEqual({ id: B.SNARE_CORD, count: 2 });
    const T = B.CINNABAR_TORCH, G = I.GOLD_INGOT, S = B.STONE;
    expect(craft(grid([T, I.EMBER_QUARTZ, T, G, I.CINNABAR, G, S, S, S]), 3)).toEqual({ id: B.PULSE_GATE, count: 1 });
  });

  it('are in the Help topic on cinnabar', () => {
    const topic = buildTopics({ table: resolveBindings({}) }).find((t) => t.id === 'cinnabar');
    const text = JSON.stringify(topic).toLowerCase();
    for (const word of ['snare', 'pulse gate', 'comparator', 'observer', 'daylight sensor', 'loop']) expect(text, word).toContain(word);
    expect(text).not.toMatch(FORBIDDEN);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('snare lines (tripwire hook pair)', () => {
  /** Post A at x=0 looking east (hangs on the stone at -1), post B at x=gap looking west (hangs on the stone at gap+1), cords between. */
  function tie(w, gap = 11, z = 0) {
    w.setBlock(-1, Y, z, B.STONE); w.setBlock(gap + 1, Y, z, B.STONE);
    for (let x = 1; x < gap; x++) w.setBlock(x, Y, z, B.SNARE_CORD, SNARE_AXIS_X);
    w.setBlock(0, Y, z, B.SNARE_POST, 1);
    w.setBlock(gap, Y, z, B.SNARE_POST, 3);
    run(w, 2);
  }

  it('place on the side of a block, looking away from it, and cord follows the way the player walks', () => {
    expect(placeMeta(B.SNARE_POST, [1, 0, 0], [1, 0, 0])).toBe(1);   // clicked a +x face: looks east
    expect(placeMeta(B.SNARE_POST, [0, 0, -1], [0, 0, -1])).toBe(0);
    expect(placeMeta(B.SNARE_POST, [-1, 0, 0], [0, 0, 1])).toBe(3);
    expect(placeMeta(B.SNARE_POST, [0, 1, 0], [1, 0, 0])).toBe(-1);   // not on a floor
    expect(placeMeta(B.SNARE_CORD, [0, 1, 0], [1, 0, 0.2])).toBe(SNARE_AXIS_X);
    expect(placeMeta(B.SNARE_CORD, [0, 1, 0], [0.2, 0, 1])).toBe(0);
    const w = flatWorld();
    expect(supported(w, 0, Y, 0, B.SNARE_POST, 1)).toBe(false);
    w.setBlock(-1, Y, 0, B.STONE);
    expect(supported(w, 0, Y, 0, B.SNARE_POST, 1)).toBe(true);
    expect(supported(w, 0, Y, 0, B.SNARE_POST, 3)).toBe(false);
    expect(BLOCKS[B.SNARE_CORD].needsSupport).toBe(false); // cord may span the air
    w.setBlock(5, Y + 3, 5, B.SNARE_CORD, 0); run(w, 2);
    expect(w.getBlock(5, Y + 3, 5)).toBe(B.SNARE_CORD);
  });

  it('tie when two posts face each other across cord, in range only', () => {
    const w = flatWorld();
    tie(w);
    expect(meta(w, 0, 0) & SNARE_ATTACHED).toBeTruthy();
    expect(meta(w, 11, 0) & SNARE_ATTACHED).toBeTruthy();
    expect(snareLine(w, 0, Y, 0, 1)).toMatchObject({ ok: true, other: [11, Y, 0] });
    expect(snareLine(w, 0, Y, 0, 1).cords.length).toBe(10);
    // a line cut by a missing cord, a post that looks away, two posts with no cord, a gap of 41
    w.setBlock(5, Y, 0, B.AIR); run(w, 2);
    expect(meta(w, 0, 0) & SNARE_ATTACHED).toBe(0);
    expect(meta(w, 11, 0) & SNARE_ATTACHED).toBe(0);
    w.setBlock(5, Y, 0, B.SNARE_CORD, SNARE_AXIS_X); run(w, 2);
    expect(meta(w, 0, 0) & SNARE_ATTACHED).toBeTruthy();
    w.setBlock(11, Y, 0, B.SNARE_POST, 1); run(w, 2); // turned the wrong way
    expect(meta(w, 0, 0) & SNARE_ATTACHED).toBe(0);
    const w2 = flatWorld(3);
    w2.setBlock(0, Y, 0, B.SNARE_POST, 1); w2.setBlock(1, Y, 0, B.SNARE_POST, 3); run(w2, 2);
    expect(meta(w2, 0, 0) & SNARE_ATTACHED).toBe(0); // nothing between them
    const far = flatWorld(3);
    tie(far, SNARE_RANGE); // 40 blocks apart still ties
    expect(meta(far, 0, 0) & SNARE_ATTACHED).toBeTruthy();
    const tooFar = flatWorld(3);
    tie(tooFar, SNARE_RANGE + 1);
    expect(meta(tooFar, 0, 0) & SNARE_ATTACHED).toBe(0);
  });

  it('send power from both posts when something touches the cord, and let go after a short hold', () => {
    const w = flatWorld();
    tie(w);
    // a wire beside each block the posts hang on, so the strong power shows
    w.setBlock(-1, Y, 1, B.CINNABAR_WIRE, 0); w.setBlock(12, Y, 1, B.CINNABAR_WIRE, 0); run(w, 2);
    expect(meta(w, -1, 1) & 15).toBe(0);
    expect(w.circuits.trip(5, Y, 0)).toBe(true);
    run(w, 1);
    expect(meta(w, 0, 0) & SNARE_TRIPPED).toBeTruthy();
    expect(meta(w, 11, 0) & SNARE_TRIPPED).toBeTruthy();
    expect(meta(w, -1, 1) & 15).toBe(15);
    expect(meta(w, 12, 1) & 15).toBe(15);
    expect(w.circuits.trip(5, Y, 0)).toBe(false); // already tripped: nothing new
    run(w, SNARE_HOLD - 2);
    expect(meta(w, 0, 0) & SNARE_TRIPPED).toBeTruthy();
    run(w, 4);
    expect(meta(w, 0, 0) & SNARE_TRIPPED).toBe(0);
    expect(meta(w, 11, 0) & SNARE_TRIPPED).toBe(0);
    expect(meta(w, 0, 0) & SNARE_ATTACHED).toBeTruthy(); // still tied
    expect(meta(w, -1, 1) & 15).toBe(0);
  });

  it('stay tripped while something is still standing in the cord, and a stray cord is no line', () => {
    const w = flatWorld();
    tie(w);
    let standing = true;
    w.circuits.entitiesCount = (x, y, z) => (standing && x === 6 && y === Y && z === 0 ? 1 : 0);
    w.circuits.trip(3, Y, 0);
    run(w, SNARE_HOLD * 4);
    expect(meta(w, 0, 0) & SNARE_TRIPPED).toBeTruthy();
    standing = false;
    run(w, SNARE_HOLD + 2);
    expect(meta(w, 0, 0) & SNARE_TRIPPED).toBe(0);
    // cord with no posts: nothing to trip
    w.setBlock(20, Y, 5, B.SNARE_CORD, 0); w.setBlock(21, Y, 5, B.SNARE_CORD, 0); run(w, 2);
    expect(w.circuits.trip(20, Y, 5)).toBe(false);
    expect(w.circuits.trip(2, Y + 3, 2)).toBe(false); // not even a cord
  });

  it('go quiet when the line is cut while tripped, and feed a lamp through the block behind', () => {
    const w = flatWorld();
    tie(w, 6);
    w.setBlock(-1, Y, 1, B.CINNABAR_LAMP);
    run(w, 2);
    w.circuits.trip(3, Y, 0); run(w, 2);
    expect(w.getBlock(-1, Y, 1)).toBe(B.CINNABAR_LAMP_ON);
    w.setBlock(3, Y, 0, B.AIR); run(w, 2);
    expect(meta(w, 0, 0) & (SNARE_TRIPPED | SNARE_ATTACHED)).toBe(0);
    run(w, 8);
    expect(w.getBlock(-1, Y, 1)).toBe(B.CINNABAR_LAMP);
  });

  it('draw as a hook with a cord stub when tied, tilted when tripped, and select a thin cord', () => {
    const plain = circuitParts(B.SNARE_POST, 1), tied = circuitParts(B.SNARE_POST, 1 | SNARE_ATTACHED), tripped = circuitParts(B.SNARE_POST, 1 | SNARE_ATTACHED | SNARE_TRIPPED);
    expect(tied.length).toBe(plain.length + 1);
    expect(plain[1].tilt).toBe(0);
    expect(tripped[1].tilt).toBeGreaterThan(0);
    const sel = circuitSelection(B.SNARE_CORD, SNARE_AXIS_X);
    expect(sel[3] - sel[0]).toBe(1);
    expect(sel[4]).toBeLessThan(0.25);
    expect(circuitSelection(B.SNARE_CORD, 0)[5] - circuitSelection(B.SNARE_CORD, 0)[2]).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the pulse gate (limiter and metronome)', () => {
  /** A lever behind a gate that sends east into a lamp: lever (0), gate (1), lamp (2). Returns the gate's ON bit per tick. */
  function rig(setting, lever = false) {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.LEVER, lever ? ON : 0);
    w.setBlock(1, Y, 0, B.PULSE_GATE, EAST | (setting << 2));
    w.setBlock(2, Y, 0, B.CINNABAR_LAMP);
    run(w, 2);
    return w;
  }
  const flip = (w, on) => w.setBlock(0, Y, 0, B.LEVER, on ? ON : 0);
  const trace = (w, n) => { const o = []; for (let i = 0; i < n; i++) { run(w); o.push(meta(w, 1, 0) & PG_ON ? 1 : 0); } return o.join(''); };

  it('has eight settings: four limiter pulses and four metronome beats', () => {
    expect(PULSE_GATE_SETTINGS.length).toBe(8);
    expect(PULSE_GATE_SETTINGS.slice(0, 4).every((s) => s.kind === 'limiter')).toBe(true);
    expect(PULSE_GATE_SETTINGS.slice(4).every((s) => s.kind === 'metronome')).toBe(true);
    expect(gateSetting(3 << 2).ticks).toBe(20);
    expect(gateLabel(0)).toBe('Limiter: pulses of 0.1 s');
    expect(gateLabel(7 << 2)).toBe('Metronome: beats every 2 s');
  });

  it('turns a long signal into one short pulse (limiter)', () => {
    const w = rig(0);
    flip(w, true);
    const t = trace(w, 12);
    expect(t.startsWith('11')).toBe(true);
    expect(t.slice(2)).toBe('0000000000'); // one pulse of two ticks only, though the lever stays on
    expect(w.getBlock(2, Y, 0)).toBe(B.CINNABAR_LAMP);
  });

  it('squares up a blip into a long pulse: a pulse extender', () => {
    const w = rig(3); // 20 ticks
    flip(w, true); run(w, 1); flip(w, false); // a one-tick blip
    const t = trace(w, 30);
    expect((t.match(/1/g) || []).length).toBeGreaterThanOrEqual(19);
    expect(t.indexOf('0')).toBeGreaterThanOrEqual(19);
    expect(t.slice(0, 19)).toBe('1'.repeat(19));
    expect(t.slice(-6)).toBe('000000');
  });

  it('rests after a pulse: edges that come too early are ignored, later ones are heard', () => {
    const w = rig(1); // 4 ticks on, 4 resting
    flip(w, true); run(w, 1);
    expect(meta(w, 1, 0) & PG_ON).toBeTruthy();
    flip(w, false); run(w, 1); flip(w, true); // again within the pulse
    run(w, 3);
    expect(meta(w, 1, 0) & PG_ON).toBe(0);      // the pulse ended on time
    expect(meta(w, 1, 0) & PG_REST).toBeTruthy();
    flip(w, false); run(w, 1); flip(w, true); run(w, 1); // an edge while resting
    expect(meta(w, 1, 0) & PG_ON).toBe(0);
    run(w, 10);
    expect(meta(w, 1, 0) & (PG_ON | PG_REST)).toBe(0);
    flip(w, false); run(w, 2); flip(w, true); run(w, 1);
    expect(meta(w, 1, 0) & PG_ON).toBeTruthy();  // rested: heard again
  });

  it('caps the rate of a noisy line: a lever flapped every other tick gives pulses no closer than a period apart', () => {
    const w = rig(1);
    let on = false, pulses = 0, last = false, first = -1, second = -1;
    for (let t = 0; t < 60; t++) {
      on = !on; flip(w, on); run(w);
      const g = !!(meta(w, 1, 0) & PG_ON);
      if (g && !last) { pulses++; if (first < 0) first = t; else if (second < 0) second = t; }
      last = g;
    }
    expect(pulses).toBeLessThanOrEqual(8);
    expect(pulses).toBeGreaterThanOrEqual(5);
    expect(second - first).toBeGreaterThanOrEqual(8); // 4 on + 4 resting
  });

  it('beats while powered and stops the moment the signal stops (metronome)', () => {
    const w = rig(4); // 4 ticks on, 4 off
    flip(w, true);
    const t = trace(w, 24);
    expect(t).toBe('111100001111000011110000'.replace(/^/, '').slice(0, 24));
    flip(w, false); run(w, 1);
    expect(meta(w, 1, 0) & (PG_ON | PG_LATCH)).toBe(0);
    expect(trace(w, 12)).toBe('000000000000');
  });

  it('feeds what is in front of it, and nothing from the back or sides', () => {
    const w = rig(3);
    flip(w, true); run(w, 3);
    expect(w.getBlock(2, Y, 0)).toBe(B.CINNABAR_LAMP_ON);
    expect(powerInto(w, 2, Y, 0)).toBe(15);
    w.setBlock(1, Y, 1, B.CINNABAR_LAMP); w.setBlock(1, Y, -1, B.CINNABAR_LAMP); run(w, 2);
    expect(w.getBlock(1, Y, 1)).toBe(B.CINNABAR_LAMP); // the gate's sides stay dark
    expect(w.getBlock(1, Y, -1)).toBe(B.CINNABAR_LAMP);
  });

  it('is stepped through its settings by use, starts over, and keeps its facing', () => {
    let m = EAST | PG_ON | PG_LATCH | PG_REST;
    for (let i = 1; i <= 8; i++) {
      m = useMeta(B.PULSE_GATE, m);
      expect(m & 3).toBe(EAST);
      expect(m & (PG_ON | PG_LATCH | PG_REST)).toBe(0);
      expect((m >> 2) & 7).toBe(i & 7);
    }
    expect(placeMeta(B.PULSE_GATE, [0, 1, 0], [1, 0, 0])).toBe(1);
    expect(placeMeta(B.PULSE_GATE, [1, 0, 0], [1, 0, 0])).toBe(-1);
    expect(circuitParts(B.PULSE_GATE, 3 << 2).length).toBe(2 + 4);
    expect(circuitParts(B.PULSE_GATE, 4 << 2)[0].tile[2]).toBe('pulse_gate_clock');
    expect(circuitParts(B.PULSE_GATE, PG_ON)[0].tile[2]).toBe('pulse_gate_on');
  });

  it('settle after a reload: a pulse that was under way still ends', () => {
    const w = flatWorld();
    w.setBlock(1, Y, 0, B.PULSE_GATE, EAST | (1 << 2) | PG_ON | PG_LATCH);
    run(w, 6);
    expect(meta(w, 1, 0) & PG_ON).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('loop guards (no runaway contraption can stall a tick)', () => {
  it('state their caps', () => {
    expect(LOOP_LIMIT).toBe(24);
    expect(LOOP_FUSE).toBe(40);
    expect(OBSERVE_PER_TICK).toBe(2000);
    expect(SCHEDULED_PER_TICK).toBe(4000);
    expect(LOOP_WATCH + LOOP_LIMIT * 3).toBeLessThan(UPDATES_PER_TICK / 100);
  });

  it('cut an update loop short each tick and give up on it after the fuse, instead of spinning for 20000 updates a tick', () => {
    const w = flatWorld();
    const c = w.circuits;
    const ring = ['0,64,0', '1,64,0', '2,64,0'];
    let calls = 0;
    // three positions that keep waking each other with no delay at all (nothing in the real simulation does this; a bug or a future block might)
    c.update = (x, y, z) => { calls++; c.queue.add(ring[(ring.indexOf(`${x},${y},${z}`) + 1) % 3]); };
    c.queue.add(ring[0]);
    const perTick = [];
    for (let t = 0; t < LOOP_FUSE + 5; t++) { const before = calls; w.tick(); perTick.push(calls - before); }
    expect(Math.max(...perTick)).toBeLessThanOrEqual(LOOP_WATCH + 3 * LOOP_LIMIT + 3);
    expect(Math.max(...perTick)).toBeLessThan(UPDATES_PER_TICK / 100);
    expect(c.stats.looped).toBeGreaterThan(0);
    expect(c.stats.dropped).toBeGreaterThan(0);          // the fuse: it was dropped at last
    expect(perTick[perTick.length - 1]).toBe(0);          // ...and the loop is dead
    expect(c.queue.size).toBe(0);
    expect(calls).toBeLessThan((LOOP_WATCH + 3 * LOOP_LIMIT + 3) * (LOOP_FUSE + 2));
  });

  it('do not trouble honest machines: a long wire and a running metronome', () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.LEVER, ON);
    for (let x = 1; x <= 40; x++) w.setBlock(x, Y, 0, B.CINNABAR_WIRE, 0);
    for (let x = 1; x <= 40; x++) w.setBlock(x, Y, 2, B.CINNABAR_WIRE, 0);
    run(w, 3);
    expect(w.getMeta(15, Y, 0) & 15).toBe(1);
    w.setBlock(10, Y, 10, B.LEVER, ON);
    w.setBlock(11, Y, 10, B.PULSE_GATE, EAST | (4 << 2));
    run(w, 40);
    expect(w.circuits.stats.looped).toBe(0);
    expect(w.circuits.stats.dropped).toBe(0);
  });

  it('start only OBSERVE_PER_TICK observers in one tick; the rest start a tick later and all of them still pulse', () => {
    const w = flatWorld();
    const cells = [];
    for (let x = -16; x < 32; x++) for (let z = -16; z < 32; z++) cells.push([x, z]);
    expect(cells.length).toBeGreaterThan(OBSERVE_PER_TICK);
    for (const [x, z] of cells) w.setBlock(x, Y, z, B.OBSERVER, 1); // faces up, watches the cell above
    run(w, 3);
    for (const [x, z] of cells) w.setBlock(x, Y + 1, z, B.STONE);  // all change in the same tick
    const powered = () => cells.filter(([x, z]) => w.getMeta(x, Y, z) & OBSERVER_POWERED).length;
    run(w, OBSERVER_DELAY);
    expect(powered()).toBe(OBSERVE_PER_TICK);
    run(w, 1);
    expect(powered()).toBe(cells.length);
    expect(w.circuits.stats.deferred).toBe(cells.length - OBSERVE_PER_TICK);
    run(w, 6);
    expect(powered()).toBe(0);
  });

  it('run at most SCHEDULED_PER_TICK scheduled updates in one tick and the rest on the next', () => {
    const w = flatWorld();
    const cells = [];
    for (let y = Y; y <= Y + 1; y++) for (let x = -16; x < 32; x++) for (let z = -16; z < 32; z++) cells.push([x, y, z]);
    expect(cells.length).toBeGreaterThan(SCHEDULED_PER_TICK + 100);
    for (const [x, y, z] of cells) w.setBlock(x, y, z, B.CINNABAR_LAMP_ON);
    let ticks = 0;
    const real = w.circuits.tick.bind(w.circuits);
    w.circuits.tick = (...a) => { ticks++; real(...a); };
    const counts = [];
    for (let t = 0; t < 12 && counts.reduce((a, b) => a + b, 0) < cells.length; t++) { const b = ticks; w.tick(); counts.push(ticks - b); }
    expect(Math.max(...counts)).toBeLessThanOrEqual(SCHEDULED_PER_TICK + 1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(cells.length);
    expect(counts.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    expect(cells.every(([x, y, z]) => w.getBlock(x, y, z) === B.CINNABAR_LAMP)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('sensors: the daylight sensor reads the sky in steps and can be inverted', () => {
  it('gives 0-15 by the sun and 15 minus that when inverted', () => {
    const w = flatWorld();
    let sun = 1;
    w.circuits.daylight = () => sun;
    w.setBlock(0, Y, 0, B.DAYLIGHT_SENSOR, 0);
    w.setBlock(4, Y, 0, B.DAYLIGHT_SENSOR, SENSOR_INVERTED);
    const lv = (x) => w.getMeta(x, Y, 0) & 15;
    run(w, 2);
    expect(lv(0)).toBe(15); expect(lv(4)).toBe(0);
    sun = 0.5; run(w, 21);
    expect(lv(0)).toBe(8); expect(lv(4)).toBe(7);
    sun = 0; run(w, 21);
    expect(lv(0)).toBe(0); expect(lv(4)).toBe(15);
    expect(useMeta(B.DAYLIGHT_SENSOR, 0)).toBe(SENSOR_INVERTED);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('reference contraptions, built block by block', () => {
  it('a pulse extender: a one-tick blip holds a piston out for a full second', () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.LEVER, 0);
    w.setBlock(1, Y, 0, B.PULSE_GATE, EAST | (3 << 2)); // limiter, 20 ticks
    w.setBlock(2, Y, 0, B.PISTON, 1);                    // faces up
    w.setBlock(2, Y + 1, 0, B.STONE);
    run(w, 3);
    expect(w.getBlock(2, Y + 1, 0)).toBe(B.STONE);
    w.setBlock(0, Y, 0, B.LEVER, ON); run(w, 1); w.setBlock(0, Y, 0, B.LEVER, 0); // the blip
    let out = 0, firstOut = -1, lastOut = -1;
    for (let t = 0; t < 40; t++) {
      run(w);
      const ext = !!(w.getMeta(2, Y, 0) & PISTON_EXTENDED);
      if (ext) { out++; if (firstOut < 0) firstOut = t; lastOut = t; }
    }
    expect(w.getBlock(2, Y + 2, 0)).toBe(B.STONE); // it was pushed up...
    expect(w.getBlock(2, Y + 1, 0)).toBe(B.AIR);   // ...and (not sticky) stays there
    expect(out).toBeGreaterThanOrEqual(19);
    expect(out).toBeLessThanOrEqual(22);
    expect(lastOut - firstOut + 1).toBe(out);       // one unbroken stretch
    expect(w.getMeta(2, Y, 0) & PISTON_EXTENDED).toBe(0);
  });

  /**
   * T flip-flop (changes state at every pulse). Memory: two cinnabar torches that each switch the other's block off (an RS latch),
   * with repeaters as one-way valves into the blocks. Steering: two subtract-mode comparators compute S = C - Q (sets Q when it is off)
   * and R = C - Qb (resets Q when it is on); the sensed Q and Qb come through slow 8-tick repeaters so the pulse C (an 8-tick Pulse Gate
   * Limiter pulse) is gone before the new state is seen. Q = the torch at (1,0).
   */
  function tFlipFlop(w, ox, oz) {
    const set = (x, z, id, m = 0) => w.setBlock(ox + x, Y, oz + z, id, m);
    const S = 2, Wd = 3;
    set(0, 0, B.STONE); set(4, 0, B.STONE);
    set(1, 0, B.CINNABAR_TORCH, 4);       // Q: on the east face of its block
    set(4, 1, B.CINNABAR_TORCH_OFF, 1);   // Qb: on the south face of its block
    set(2, 0, B.CINNABAR_WIRE); set(3, 0, B.REPEATER, EAST);   // Q net, valve into Qb's block
    for (const [x, z] of [[4, 2], [3, 2], [2, 2], [1, 2], [0, 2], [-1, 2], [-2, 2], [-2, 1], [-2, 0], [-2, -1]]) set(x, z, B.CINNABAR_WIRE); // Qb net
    set(-1, 0, B.REPEATER, EAST);         // valve into Q's block
    set(2, -1, B.CINNABAR_WIRE); set(3, -1, B.REPEATER, EAST | (3 << 2)); // Q sensed (8 ticks late)
    set(-1, -1, B.REPEATER, EAST | (3 << 2));                              // Qb sensed (8 ticks late)
    set(4, -1, B.COMPARATOR, S | COMPARATOR_SUBTRACT); set(0, -1, B.COMPARATOR, S | COMPARATOR_SUBTRACT); // S and R
    set(4, -2, B.REPEATER, S); set(0, -2, B.REPEATER, S);                  // the pulse C enters both
    for (let x = 0; x <= 4; x++) set(x, -3, B.CINNABAR_WIRE);
    set(5, -3, B.PULSE_GATE, Wd | (2 << 2));                               // edge to an 8-tick pulse
    set(6, -3, B.LEVER, 0);                                                // the T input
    return {
      q: () => (w.getBlock(ox + 1, Y, oz) === B.CINNABAR_TORCH ? 1 : 0),
      qb: () => (w.getBlock(ox + 4, Y, oz + 1) === B.CINNABAR_TORCH ? 1 : 0),
      input: (on) => w.setBlock(ox + 6, Y, oz - 3, B.LEVER, on ? ON : 0),
    };
  }

  it('a T flip-flop changes state at every pulse and holds it between pulses', () => {
    const w = flatWorld();
    const ff = tFlipFlop(w, 5, 5);
    run(w, 40);
    expect([ff.q(), ff.qb()]).toEqual([1, 0]);
    const states = [];
    for (let k = 0; k < 6; k++) {
      ff.input(true); run(w, 30);
      states.push(ff.q());
      expect(ff.q() + ff.qb()).toBe(1);          // always exactly one of the two
      ff.input(false); run(w, 30);
      expect(ff.q()).toBe(states[k]);             // letting go changes nothing
    }
    expect(states).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('a T flip-flop gives one toggle for a signal that stays on, and its state survives idle time', () => {
    const w = flatWorld();
    const ff = tFlipFlop(w, 5, 5);
    run(w, 40);
    ff.input(true);
    run(w, 400);                                  // held for twenty seconds
    expect(ff.q()).toBe(0);
    run(w, 400);
    expect(ff.q()).toBe(0);
    expect(w.circuits.stats.looped).toBe(0);
    expect(w.circuits.stats.dropped).toBe(0);
  });

  /**
   * Item sorter. The sorting hopper S holds 63 of the wanted item and a full stack of four different fillers, so it is full
   * for everything but the wanted item: nothing else fits. A wanted item that arrives makes it completely full (comparator
   * signal 15 instead of 14); a subtract-mode comparator with a side signal of 14 turns that into a signal, which a torch
   * inverts into the lock on S. Unlocked, S passes one wanted item into the chest and takes the next from the input hopper;
   * when it is back to 63 the lock closes again.
   */
  function sorter(w, wanted) {
    const ox = 5, oz = 5, set = (x, y, z, id, m = 0) => w.setBlock(ox + x, y, oz + z, id, m);
    const hoppers = new Map(), chests = new Map();
    const g = {
      world: w, hoppers, chests,
      getChest(x, y, z) { const k = `${x},${y},${z}`; if (!chests.has(k)) chests.set(k, { slots: new Array(27).fill(null) }); return chests.get(k); },
      getHopper(x, y, z) { const k = `${x},${y},${z}`; if (!hoppers.has(k)) hoppers.set(k, newHopper(x, y, z)); return hoppers.get(k); },
    };
    w.circuits.containerSignal = (x, y, z) => containerSignal(g, x, y, z);
    const st = (id, n) => ({ id, count: n, damage: 0 });
    const hop = (x, y, z, m) => { set(x, y, z, B.HOPPER, m); return g.getHopper(ox + x, y, oz + z); };
    set(-1, 66, 0, B.CHEST);
    const s = hop(0, 66, 0, 4);        // the sorting hopper, spout into the chest at -x
    const inn = hop(0, 67, 0, 0);      // the input hopper above it
    s.slots = [st(wanted, 63), st(B.COBBLESTONE, 64), st(B.DIRT, 64), st(B.SAND, 64), st(B.GRAVEL, 64)];
    set(1, 65, 0, B.STONE); set(1, 66, 0, B.COMPARATOR, EAST | COMPARATOR_SUBTRACT); // reads S through its back
    set(2, 66, 0, B.STONE);
    set(3, 66, 0, B.CINNABAR_TORCH, 4);                                              // inverts the comparator's signal
    for (const [x, z] of [[3, 1], [3, 2], [2, 2], [1, 2], [0, 2]]) { set(x, 65, z, B.STONE); set(x, 66, z, B.CINNABAR_WIRE); }
    set(0, 65, 1, B.STONE); set(0, 66, 1, B.REPEATER, 0);                            // the lock on S
    for (const z of [-1, -2]) { set(1, 65, z, B.STONE); set(1, 66, z, B.CINNABAR_WIRE); }
    set(1, 66, -3, B.CINNABAR_BLOCK);                                                // the side signal: 14
    let t = 0;
    const tick = (n) => { for (let i = 0; i < n; i++) { w.tick(); if (++t % 8 === 0) for (const h of [...hoppers.values()]) hopperStep(g, h, powerInto(w, h.x, h.y, h.z) > 0); } };
    const count = (slots, id) => slots.reduce((a, c) => a + (c && c.id === id ? c.count : 0), 0);
    return { g, s, inn, st, tick, count, out: g.getChest(ox - 1, 66, oz), locked: () => powerInto(w, ox, 66, oz) > 0 };
  }

  it('an item sorter lets the wanted item through, keeps everything else back, and locks itself again', () => {
    const w = flatWorld();
    const WANT = I.IRON_INGOT;
    const k = sorter(w, WANT);
    k.tick(6);
    expect(k.locked()).toBe(true);                                        // locked at rest
    expect(containerSignal(k.g, 5, 66, 5)).toBe(14);
    k.inn.slots = [k.st(I.COAL, 5), k.st(WANT, 3), k.st(I.STICK, 4), k.st(B.DIRT, 9), null]; // junk before, between and after
    k.tick(120);
    expect(k.count(k.out.slots, WANT)).toBe(3);                           // all three wanted ones got through
    expect(k.count(k.out.slots, I.COAL) + k.count(k.out.slots, I.STICK) + k.count(k.out.slots, B.DIRT)).toBe(0);
    expect(k.count(k.inn.slots, I.COAL)).toBe(5);                         // the junk is still in the input
    expect(k.count(k.inn.slots, I.STICK)).toBe(4);
    expect(k.count(k.inn.slots, B.DIRT)).toBe(9);
    expect(k.count(k.s.slots, WANT)).toBe(63);                            // the sorter is back at its resting load
    expect(k.locked()).toBe(true);
    // more later: still sorted, still one for one
    k.inn.slots = [k.st(I.STICK, 2), k.st(WANT, 2), null, null, null];
    k.tick(100);
    expect(k.count(k.out.slots, WANT)).toBe(5);
    expect(k.count(k.s.slots, WANT)).toBe(63);
    expect(k.locked()).toBe(true);
  });

  it('an item sorter never passes junk, however long it runs', () => {
    const w = flatWorld();
    const k = sorter(w, I.IRON_INGOT);
    k.inn.slots = [k.st(I.COAL, 64), k.st(I.STICK, 64), k.st(B.STONE, 64), k.st(I.APPLE, 12), k.st(B.COBBLESTONE, 20)]; // even a filler's kind cannot slip in: its stack is full
    k.tick(300);
    expect(k.out.slots.every((c) => c === null)).toBe(true);
    expect(k.count(k.inn.slots, I.COAL)).toBe(64);
    expect(k.count(k.s.slots, B.COBBLESTONE)).toBe(64);
    expect(k.locked()).toBe(true);
  });
});
