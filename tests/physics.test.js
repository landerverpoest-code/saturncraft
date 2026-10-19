import { describe, it, expect } from 'vitest';
import { PHYS, groundAccel, fallDamage } from '../src/physics/constants.js';
import { Body } from '../src/physics/body.js';
import { B } from '../src/world/blocks.js';
import { MockWorld } from './helpers.js';

function player(world, y = 64) {
  const b = new Body(PHYS.PLAYER_WIDTH, PHYS.PLAYER_HEIGHT);
  b.setPos(0.5, y, 0.5);
  // settle on the ground
  for (let i = 0; i < 5; i++) b.travel(world, {});
  return b;
}

/** Steady-state horizontal speed in m/s after `ticks` ticks of input. */
function speedOf(input, ticks = 60) {
  const w = new MockWorld();
  const b = player(w);
  for (let i = 0; i < ticks; i++) b.travel(w, { yaw: 0, ...input });
  const z0 = b.z;
  for (let i = 0; i < 20; i++) b.travel(w, { yaw: 0, ...input });
  return z0 - b.z; // 20 ticks = 1 second, moving towards -Z
}

describe('physics constants', () => {
  it('uses the documented base values', () => {
    expect(PHYS.GRAVITY).toBe(0.08);
    expect(PHYS.DRAG_Y).toBe(0.98);
    expect(PHYS.JUMP_VELOCITY).toBe(0.42);
    expect(PHYS.STEP_HEIGHT).toBe(0.6);
    expect(PHYS.WALK_SPEED).toBe(0.1);
    expect(PHYS.PLAYER_WIDTH).toBe(0.6);
    expect(PHYS.PLAYER_HEIGHT).toBe(1.8);
    expect(PHYS.PLAYER_EYE).toBe(1.62);
  });
  it('ground acceleration on default blocks equals the movement speed', () => {
    expect(groundAccel(0.1)).toBeCloseTo(0.1, 6);
    expect(groundAccel(0.1, 0.98)).toBeLessThan(0.1); // ice: less traction
  });
});

describe('movement', () => {
  it('walks at 4.317 m/s', () => expect(speedOf({ forward: 1 })).toBeCloseTo(4.317, 2));
  it('sprints at 5.612 m/s', () => expect(speedOf({ forward: 1, sprint: true })).toBeCloseTo(5.612, 2));
  it('sneaks at ~1.295 m/s', () => expect(speedOf({ forward: 1, sneak: true })).toBeCloseTo(1.295, 2));
  it('strafing diagonally is not faster than walking straight', () => {
    expect(speedOf({ forward: 1, strafe: 1 })).toBeLessThan(4.317);
  });
});

describe('jumping and falling', () => {
  it('jump apex is 1.2522 blocks', () => {
    const w = new MockWorld();
    const b = player(w);
    const y0 = b.y;
    let max = y0;
    b.travel(w, { jump: true });
    for (let i = 0; i < 30; i++) { b.travel(w, {}); max = Math.max(max, b.y); }
    expect(max - y0).toBeCloseTo(1.2522, 3);
    expect(b.onGround).toBe(true);
  });
  it('jump lasts 12 ticks before landing', () => {
    const w = new MockWorld();
    const b = player(w);
    b.travel(w, { jump: true });
    let t = 1;
    while (!b.onGround && t < 40) { b.travel(w, {}); t++; }
    expect(t).toBe(12);
  });
  it('sprint-jumping covers more ground than sprinting', () => {
    const w = new MockWorld();
    const run = (jump) => {
      const b = player(w);
      for (let i = 0; i < 40; i++) b.travel(w, { forward: 1, sprint: true, jump: jump && b.onGround });
      return -b.z;
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });
  it('terminal velocity approaches 3.92 blocks/tick', () => {
    const w = new MockWorld(-10000);
    const b = new Body(0.6, 1.8);
    b.setPos(0, 1000, 0);
    for (let i = 0; i < 400; i++) b.travel(w, {});
    expect(-b.vy).toBeGreaterThan(3.9);
    expect(-b.vy).toBeLessThan(3.921);
  });
  it('fall damage is ceil(distance - 3)', () => {
    expect(fallDamage(3)).toBe(0);
    expect(fallDamage(3.4)).toBe(1);
    expect(fallDamage(4)).toBe(1);
    expect(fallDamage(10)).toBe(7);
    expect(fallDamage(23)).toBe(20);
  });
  it('accumulates fall distance during a real fall', () => {
    const w = new MockWorld(64);
    const b = new Body(0.6, 1.8);
    b.setPos(0.5, 74, 0.5);
    while (!b.onGround) b.travel(w, {});
    // the landing tick is not counted, as in the reference game
    expect(b.fallDistance).toBeGreaterThan(9.5);
    expect(b.fallDistance).toBeLessThan(10);
    expect(fallDamage(b.fallDistance)).toBe(7);
  });
});

describe('collision and step-up', () => {
  it('cannot walk through a wall', () => {
    const w = new MockWorld();
    for (let y = 64; y < 70; y++) w.set(0, y, -3, B.STONE);
    const b = player(w);
    for (let i = 0; i < 60; i++) b.travel(w, { forward: 1, yaw: 0 });
    expect(b.z - 0.3).toBeGreaterThanOrEqual(-2 - 1e-9);
    expect(b.horizontalCollision).toBe(true);
  });
  it('a full block is too high to step onto (needs a jump)', () => {
    const w = new MockWorld();
    w.set(0, 64, -2, B.STONE);
    const b = player(w);
    for (let i = 0; i < 40; i++) b.travel(w, { forward: 1, yaw: 0 });
    expect(b.y).toBeCloseTo(64, 5);
  });
  it('step-up lifts the body when the obstacle is within step height', () => {
    const w = new MockWorld();
    for (let z = -30; z <= -2; z++) w.set(0, 64, z, B.STONE);
    const b = player(w);
    b.stepHeight = 1.0; // a full block becomes steppable with a 1.0 step
    for (let i = 0; i < 40; i++) b.travel(w, { forward: 1, yaw: 0 });
    expect(b.y).toBeCloseTo(65, 5);
  });
  it('sneaking stops at ledges', () => {
    const w = new MockWorld();
    for (let x = -3; x <= 3; x++) for (let z = -6; z <= 0; z++) w.set(x, 63, z, B.AIR);
    for (let x = -3; x <= 3; x++) for (let z = 0; z <= 3; z++) w.set(x, 63, z, B.STONE);
    const b = player(w);
    for (let i = 0; i < 80; i++) b.travel(w, { forward: 1, sneak: true, yaw: 0 });
    expect(b.y).toBeCloseTo(64, 5);
    expect(b.z).toBeGreaterThan(-0.31);
  });
});

describe('fluids', () => {
  it('water slows horizontal movement and buoys jumps', () => {
    const w = new MockWorld();
    for (let x = -2; x <= 2; x++) for (let z = -40; z <= 2; z++) for (let y = 64; y < 67; y++) w.set(x, y, z, B.WATER);
    const b = player(w);
    b.updateFluidState(w, 1.62);
    expect(b.inWater).toBe(true);
    const z0 = b.z;
    for (let i = 0; i < 20; i++) { b.updateFluidState(w, 1.62); b.travel(w, { forward: 1 }); }
    expect(z0 - b.z).toBeLessThan(2.5);
    const y0 = b.y;
    for (let i = 0; i < 20; i++) { b.updateFluidState(w, 1.62); b.travel(w, { jump: true }); }
    expect(b.y).toBeGreaterThan(y0);
  });
});
