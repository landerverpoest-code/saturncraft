// The Tide Heart (world/tideHeart.js): an underwater beacon woken by a frame of Tidestone.
import { describe, it, expect } from 'vitest';
import { MockWorld } from './helpers.js';
import { B, BLOCKS } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { craft } from '../src/player/crafting.js';
import { TEX_NAMES } from '../src/world/textures.js';
import { EFFECTS } from '../src/player/effects.js';
import {
  heartSubmerged, heartFrame, heartRange, heartState, heartReaches, isFrameBlock, HEART_MIN_FRAME, HEART_FULL_FRAME, HEART_EFFECTS, HEART_PERIOD, HEART_DURATION, HEART_STRIKE,
} from '../src/world/tideHeart.js';
import { Game } from '../src/game.js';

/** A heart at (0, 80, 0) in a block of water, with `n` frame blocks placed around the shell. */
function pool(n = 0, frameId = B.TIDESTONE_BRICKS) {
  const w = new MockWorld(64);
  for (let x = -4; x <= 4; x++) for (let y = 76; y <= 84; y++) for (let z = -4; z <= 4; z++) w.set(x, y, z, B.WATER, 0);
  w.set(0, 80, 0, B.TIDE_HEART);
  let k = 0;
  for (let dx = -2; dx <= 2 && k < n; dx++) for (let dy = -2; dy <= 2 && k < n; dy++) for (let dz = -2; dz <= 2 && k < n; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== 2) continue;
    w.set(dx, 80 + dy, dz, frameId); k++;
  }
  return w;
}

describe('the Tide Heart', () => {
  it('is a glowing block with a texture and a recipe', () => {
    expect(BLOCKS[B.TIDE_HEART].emit).toBe(15);
    expect(TEX_NAMES).toContain('tide_heart');
    const C = I.TIDE_CRYSTAL, S = I.TIDE_SHARD;
    expect(craft([C, S, C, S, I.DIAMOND, S, C, S, C].map((id) => ({ id, count: 1 })), 3)).toMatchObject({ id: B.TIDE_HEART, count: 1 });
    for (const e of HEART_EFFECTS) expect(EFFECTS[e], e).toBeTruthy();
    expect(HEART_DURATION).toBeGreaterThan(HEART_PERIOD); // the gifts never lapse between pulses
  });

  it('needs water on all six sides', () => {
    const w = pool(20);
    expect(heartSubmerged(w, 0, 80, 0)).toBe(true);
    w.set(0, 81, 0, B.AIR);
    expect(heartSubmerged(w, 0, 80, 0)).toBe(false);
    expect(heartState(w, 0, 80, 0)).toMatchObject({ awake: false, range: 0 });
    w.set(0, 81, 0, B.KELP); // kelp stands in water
    expect(heartSubmerged(w, 0, 80, 0)).toBe(true);
  });

  it('counts frame blocks in the shell two out, of four kinds, up to the full frame', () => {
    expect(heartFrame(pool(0), 0, 80, 0)).toBe(0);
    expect(heartFrame(pool(23), 0, 80, 0)).toBe(23);
    expect(heartFrame(pool(98), 0, 80, 0)).toBe(HEART_FULL_FRAME);
    for (const id of [B.TIDESTONE, B.TIDESTONE_BRICKS, B.DARK_TIDESTONE, B.TIDE_LANTERN]) expect(isFrameBlock(id)).toBe(true);
    expect(isFrameBlock(B.STONE)).toBe(false);
    const near = pool(0);
    near.set(1, 80, 1, B.TIDESTONE); near.set(3, 80, 0, B.TIDESTONE); // too close, too far
    expect(heartFrame(near, 0, 80, 0)).toBe(0);
    expect(heartFrame(pool(30, B.STONE), 0, 80, 0)).toBe(0);
  });

  it('reaches further with a bigger frame', () => {
    expect(heartRange(HEART_MIN_FRAME - 1)).toBe(0);
    expect(heartRange(HEART_MIN_FRAME)).toBe(32);
    expect(heartRange(23)).toBe(48);
    expect(heartRange(30)).toBe(64);
    expect(heartRange(41)).toBe(80);
    expect(heartRange(HEART_FULL_FRAME)).toBe(96);
    let last = 0;
    for (let n = 0; n <= 60; n++) { const r = heartRange(n); expect(r).toBeGreaterThanOrEqual(last); last = r; }
    expect(heartState(pool(42), 0, 80, 0)).toMatchObject({ awake: true, range: 96, strikes: true });
    expect(heartState(pool(16), 0, 80, 0)).toMatchObject({ awake: true, range: 32, strikes: false });
  });

  it('reaches only the wet, and only in range', () => {
    const st = heartState(pool(16), 0, 80, 0);
    expect(heartReaches(st, 0, 80, 0, 20, 80, 0, true)).toBe(true);
    expect(heartReaches(st, 0, 80, 0, 20, 80, 0, false)).toBe(false);
    expect(heartReaches(st, 0, 80, 0, 40, 80, 0, true)).toBe(false);
    expect(heartReaches({ awake: false, range: 0 }, 0, 80, 0, 1, 80, 0, true)).toBe(false);
  });

  it('gives a swimmer its gifts and strikes monsters in the water when full', () => {
    const w = pool(42);
    const effects = [], hits = [];
    const mob = (x, cat, inWater) => ({ kind: 'mob', x, y: 80, z: 0.5, dead: false, deathTime: 0, def: { category: cat }, body: { inWater }, hurt: (n, s) => hits.push([x, n, s]) });
    const g = {
      world: Object.assign(w, { getChunk: (cx, cz) => (cx === 0 && cz === 0 ? { hearts: new Set(['0,80,0']) } : null) }),
      ticks: HEART_PERIOD, net: null, particles: { emit() {} }, milestones: { event() {} },
      player: { x: 10.5, y: 79, z: 0.5, dead: false, body: { inWater: true }, addEffect: (e, t, a) => effects.push([e, t, a]) },
      entities: { list: [mob(3.5, 'monster', true), mob(4.5, 'monster', false), mob(5.5, 'animal', true), mob(30.5, 'monster', true)] },
    };
    Game.prototype.tickTideHearts.call(g);
    expect(effects.map((e) => e[0]).sort()).toEqual([...HEART_EFFECTS].sort());
    expect(effects[0][1]).toBe(HEART_DURATION);
    expect(hits).toEqual([[3.5, HEART_STRIKE.damage, 'magic']]);
    // dry on land: no gifts; a guest's game never strikes
    effects.length = 0; hits.length = 0;
    g.player.body.inWater = false; g.net = { isClient: true };
    Game.prototype.tickTideHearts.call(g);
    expect(effects).toEqual([]);
    expect(hits).toEqual([]);
    // between pulses nothing is given
    g.player.body.inWater = true; g.ticks = HEART_PERIOD + HEART_STRIKE.period;
    Game.prototype.tickTideHearts.call(g);
    expect(effects).toEqual([]);
  });
});
