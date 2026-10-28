import { describe, it, expect } from 'vitest';
import { MockWorld, rng } from './helpers.js';
import { B } from '../src/world/blocks.js';
import { cidx, MIN_Y } from '../src/world/constants.js';
import { TerrainGenerator } from '../src/world/generator.js';
import {
  hushRegion, HUSH_THRESHOLD, HUSH_TOP, HUSH_LOOT, VIBRATION_RANGE, SENSOR_PULSE, SENSOR_REST, WARNING_COOLDOWN, WARNING_DECAY, SHRIEKER_CAN_SUMMON,
  sensorPower, quietStep, WarningLevels, darknessFactor, spreadHushmoss, deathCharge, findEmergeSpot,
} from '../src/world/deepHush.js';
import { HushSystem } from '../src/world/hushSystem.js';
import { weakOut } from '../src/world/circuits.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import { angerAfter, boomReaches, shouldDig, HUSHKEEPER } from '../src/mobs/hushkeeper.js';
import { BYPASSES_ARMOR } from '../src/player/armor.js';
import { dungeonLoot } from '../src/mobs/spawnerBlocks.js';
import { I } from '../src/world/items.js';

const HUSH = [B.HUSHMOSS, B.HUSH_VEIN, B.HUSH_SENSOR, B.HUSH_SHRIEKER, B.HUSH_CATALYST];

/** The chunk nearest the origin deep inside the Deep Hush for a seed. */
function hushChunk(seed) {
  let best = null;
  for (let cx = -40; cx <= 40; cx++) for (let cz = -40; cz <= 40; cz++) {
    if (hushRegion(seed, cx * 16 + 8, cz * 16 + 8) < HUSH_THRESHOLD + 0.06) continue;
    if (!best || Math.hypot(cx, cz) < Math.hypot(best[0], best[1])) best = [cx, cz];
  }
  return best;
}

describe('Deep Hush generation', () => {
  const seed = 42, at = hushChunk(seed);
  it('is found deep under rare regions', () => {
    expect(at).not.toBeNull();
    let inside = 0, n = 0;
    for (let cx = -60; cx < 60; cx += 3) for (let cz = -60; cz < 60; cz += 3) { n++; if (hushRegion(seed, cx * 16 + 8, cz * 16 + 8) >= HUSH_THRESHOLD) inside++; }
    expect(inside / n).toBeGreaterThan(0.01);
    expect(inside / n).toBeLessThan(0.15);
  });
  it('is the same every time and grows moss, sensors and veins only below the top of the Hush', () => {
    const counts = {};
    for (let k = 0; k < 4; k++) {
      const cx = at[0] + (k & 1), cz = at[1] + (k >> 1);
      const a = new TerrainGenerator(seed).generate(cx, cz), b = new TerrainGenerator(seed).generate(cx, cz);
      const ba = a.blocks || a, bb = b.blocks || b;
      expect(Buffer.from(ba.buffer).equals(Buffer.from(bb.buffer))).toBe(true);
      if (a.meta) expect(Buffer.from(a.meta.buffer).equals(Buffer.from(b.meta.buffer))).toBe(true);
      for (let y = MIN_Y; y < 200; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const id = ba[cidx(x, y, z)];
        if (!HUSH.includes(id)) continue;
        counts[id] = (counts[id] || 0) + 1;
        expect(y).toBeLessThanOrEqual(HUSH_TOP + 1);
        if (id === B.HUSH_SHRIEKER) expect(a.meta[cidx(x, y, z)] & SHRIEKER_CAN_SUMMON).toBe(1);
      }
    }
    expect(counts[B.HUSHMOSS]).toBeGreaterThan(200);
    expect(counts[B.HUSH_SENSOR]).toBeGreaterThan(0);
  });
  it('leaves the underground outside its regions alone', () => {
    let far = null;
    for (let cx = 0; cx < 80 && !far; cx++) if (hushRegion(seed, cx * 16 + 8, 8) < HUSH_THRESHOLD - 0.2) far = cx;
    const c = new TerrainGenerator(seed).generate(far, 0), bl = c.blocks || c;
    for (const v of bl) expect(HUSH.includes(v)).toBe(false);
  });
  it('ruin chests roll their own loot', () => {
    const slots = dungeonLoot(rng(3), HUSH_LOOT).filter(Boolean);
    expect(slots.length).toBeGreaterThanOrEqual(3);
    const many = []; for (let s = 1; s < 40; s++) many.push(...dungeonLoot(rng(s), HUSH_LOOT).filter(Boolean).map((st) => st.id));
    expect(many).toContain(I.HUSH_SHARD);
  });
});

class World extends MockWorld {
  constructor() { super(60); this.scheduled = []; }
  setBlock(x, y, z, id, meta = 0) { this.set(x, y, z, id, meta); return true; }
  scheduleTick(x, y, z, d) { this.scheduled.push([x, y, z, d]); }
}
function makeGame() {
  const world = new World();
  const spawned = [];
  const player = { x: 0.5, y: 60, z: 0.5, netName: 'tester', effects: {}, dead: false, body: { x: 0.5, y: 60, z: 0.5, vx: 0, vz: 0, onGround: true }, addEffect(t, ticks) { this.effects[t] = { ticks, amp: 0 }; return true; } };
  const g = { ticks: 1000, world, player, net: null, entities: { list: [] }, spawner: { spawnMob(type, x, y, z) { const m = { type, x, y, z, dead: false, deathTime: 0 }; spawned.push(m); return m; } } };
  g.hush = new HushSystem(g);
  return { g, world, player, spawned };
}

describe('Hush Sensors', () => {
  it('hear player vibrations within 8 blocks and send a cinnabar pulse that weakens with distance', () => {
    const { g, world, player } = makeGame();
    world.set(5, 60, 0, B.HUSH_SENSOR, 0); world.set(0, 60, 9, B.HUSH_SENSOR, 0);
    const r = g.hush.vibrate(0.5, 60, 0.5, 'step', player);
    expect(r.sensors.map((s) => s.x)).toEqual([5]);
    const power = world.getMeta(5, 60, 0) & 15; // (bits 4-7: the vibration's frequency, world/vibrations.js)
    expect(power).toBe(sensorPower(Math.hypot(5, 0.5)));
    expect(power).toBeGreaterThan(0); expect(power).toBeLessThan(15);
    expect(world.getMeta(0, 60, 9)).toBe(0); // out of range
    expect(weakOut(world, 5, 60, 0, [1, 0, 0])).toBe(power); // a power source for cinnabar wire
    expect(world.scheduled).toContainEqual([5, 60, 0, SENSOR_PULSE]);
    expect(sensorPower(0)).toBe(15); expect(sensorPower(VIBRATION_RANGE)).toBe(1);
  });
  it('rest after a pulse, and sneaking or wool make no sound', () => {
    const { g, world, player } = makeGame();
    world.set(3, 60, 0, B.HUSH_SENSOR, 0);
    expect(g.hush.vibrate(0.5, 60, 0.5, 'place', player).sensors.length).toBe(1);
    world.set(3, 60, 0, B.HUSH_SENSOR, 0); // pulse over
    expect(g.hush.vibrate(0.5, 60, 0.5, 'place', player).sensors.length).toBe(0); // still resting
    g.ticks += SENSOR_PULSE + SENSOR_REST;
    expect(g.hush.vibrate(0.5, 60, 0.5, 'place', player).sensors.length).toBe(1);
    expect(quietStep(true, B.STONE)).toBe(true);
    expect(quietStep(false, B.WOOL)).toBe(true);
    expect(quietStep(false, B.STONE)).toBe(false);
    expect(quietStep(false, B.HUSHMOSS)).toBe(false);
  });
  it('picks up walking and landing from the player each tick, but not sneaking', () => {
    const { g, world, player } = makeGame();
    world.set(2, 60, 2, B.HUSH_SENSOR, 0);
    player.sneaking = true; player.body.vx = 0.2;
    g.hush.tick();
    expect(world.getMeta(2, 60, 2)).toBe(0);
    player.sneaking = false; g.ticks += 20;
    g.hush.tick();
    expect(world.getMeta(2, 60, 2)).toBeGreaterThan(0);
    expect(g.hush.noises.at(-1).kind).toBe('step');
  });
});

describe('warning levels and the Hushkeeper', () => {
  it('climb one step per shriek at most every 10 s, fade with time and call a Hushkeeper at 4', () => {
    const { g, world, player, spawned } = makeGame();
    world.set(3, 60, 0, B.HUSH_SENSOR, 0);
    world.set(-3, 60, 0, B.HUSH_SHRIEKER, SHRIEKER_CAN_SUMMON); // only a world-grown shrieker raises the warning
    const levels = [];
    for (let k = 0; k < 4; k++) {
      world.set(3, 60, 0, B.HUSH_SENSOR, 0);
      levels.push(g.hush.vibrate(0.5, 60, 0.5, 'break', player).level);
      g.ticks += WARNING_COOLDOWN;
    }
    expect(levels).toEqual([1, 2, 3, 4]);
    expect(spawned.map((m) => m.type)).toEqual(['hushkeeper']);
    expect(spawned[0].emerging).toBe(HUSHKEEPER.EMERGE);
    const w = new WarningLevels();
    expect(w.raise('a', 0)).toBe(1);
    expect(w.raise('a', 50)).toBe(-1); // cooling down
    expect(w.raise('a', WARNING_COOLDOWN)).toBe(2);
    w.decay(WARNING_COOLDOWN + WARNING_DECAY);
    expect(w.level('a')).toBe(1);
  });
  it('a world-grown shrieker shrieks and pulses Darkness; a placed one only shrieks', () => {
    const { g, world, player } = makeGame();
    world.set(3, 60, 0, B.HUSH_SENSOR, 0);
    world.set(-3, 60, 0, B.HUSH_SHRIEKER, SHRIEKER_CAN_SUMMON);
    const r = g.hush.vibrate(0.5, 60, 0.5, 'step', player);
    expect(r.shrieked.length).toBe(1);
    expect(player.effects.darkness.ticks).toBeGreaterThan(200);
    const b = makeGame();
    b.world.set(3, 60, 0, B.HUSH_SENSOR, 0); b.world.set(-3, 60, 0, B.HUSH_SHRIEKER, 0);
    expect(b.g.hush.vibrate(0.5, 60, 0.5, 'step', b.player).shrieked.length).toBe(1);
    expect(b.player.effects.darkness).toBeUndefined();
  });
  it('is big, blind and dangerous', () => {
    const d = MOBS.hushkeeper;
    expect(d.height).toBe(2.9);
    expect(d.attack).toBeGreaterThanOrEqual(30);
    expect(BYPASSES_ARMOR.has('sonic')).toBe(true);
    expect(angerAfter(0, 'noise')).toBe(HUSHKEEPER.NOISE_ANGER);
    expect(angerAfter(140, 'hit')).toBe(HUSHKEEPER.ANGER_MAX);
    expect(boomReaches(14, 3)).toBe(true); expect(boomReaches(16, 0)).toBe(false);
    expect(shouldDig(1300, 0, 10)).toBe(true); expect(shouldDig(1300, 200, 10)).toBe(false); expect(shouldDig(5000, 0, 90)).toBe(false);
    const w = new World();
    const spot = findEmergeSpot(w, 0.5, 60, 0.5, rng(1));
    expect(spot).not.toBeNull();
    expect(w.getBlock(Math.floor(spot[0]), spot[1] - 1, Math.floor(spot[2]))).toBe(B.STONE);
  });
});

describe('Darkness and the Hush Catalyst', () => {
  it('Darkness breathes in waves and fades at its ends', () => {
    expect(darknessFactor(0, 1)).toBe(0);
    const vals = []; for (let s = 0; s < 3; s += 0.1) vals.push(darknessFactor(200, s));
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.3);
    expect(darknessFactor(10, 0)).toBeLessThan(darknessFactor(200, 0));
  });
  it('spreads moss by the experience of the dead and swallows the orbs of a player kill', () => {
    const w = new World();
    expect(spreadHushmoss(w, 0.5, 60, 0.5, 5, rng(2), [4, 59, 0])).toBe(5);
    let moss = 0;
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) if (w.getBlock(x, 59, z) === B.HUSHMOSS) moss++;
    expect(moss).toBe(5);
    expect(deathCharge(MOBS.shambler)).toBe(5);
    const { g, world } = makeGame();
    world.set(3, 59, 0, B.HUSH_CATALYST, 0);
    expect(g.hush.onMobDeath({ def: MOBS.shambler, x: 0.5, y: 60, z: 0.5, age: 0, killedByPlayer: true })).toBe(true);
    expect(g.hush.onMobDeath({ def: MOBS.shambler, x: 30.5, y: 60, z: 0.5, age: 0, killedByPlayer: true })).toBe(false); // too far
  });
});
