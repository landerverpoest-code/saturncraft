import { describe, it, expect } from 'vitest';
import { packPlayerState, unpackPlayerState, PF } from '../src/net/protocol.js';
import { effectColorInt, colorFromInt, effectsColor, effectSwirl, attackSpeedFactor, addEffect } from '../src/player/effects.js';
import { RemotePlayer, makeTarget } from '../src/net/remotePlayer.js';
import { PHYS } from '../src/physics/constants.js';

const base = () => ({ x: 1, y: 2, z: 3, yaw: 0.5, pitch: -0.3, sneaking: false, hurtTime: 0, inventory: { armor: [null, null, null, null] } });
const wire = (a) => JSON.parse(JSON.stringify(a));
// a RemotePlayer without its three.js model (no DOM here): the state, target and effect swirl need none
const fake = () => { const rp = Object.create(RemotePlayer.prototype); rp.state = null; rp.shown = null; rp.target = makeTarget(rp); return rp; };
const setState = (rp, st) => { rp.state = st; };

describe('swimming and gliding in the player state', () => {
  it('travel in two new flag bits', () => {
    expect(PF.SWIM).toBe(256);
    expect(PF.GLIDE).toBe(512);
    const swim = unpackPlayerState(wire(packPlayerState({ ...base(), swimming: true }, null, 0)));
    expect(swim).toMatchObject({ swimming: true, gliding: false, crawling: false });
    const glide = unpackPlayerState(wire(packPlayerState({ ...base(), gliding: true }, null, 0)));
    expect(glide).toMatchObject({ swimming: false, gliding: true });
    const none = unpackPlayerState(wire(packPlayerState(base(), null, 0)));
    expect(none).toMatchObject({ swimming: false, gliding: false });
  });
  it('leave the older flags and old packets alone', () => {
    expect(PF).toMatchObject({ SNEAK: 1, DEAD: 2, SLEEP: 4, CREATIVE: 8, HURT: 16, RIDING: 32, INVISIBLE: 64, CRAWL: 128 });
    const old = unpackPlayerState([0, 0, 0, 0, 0, -1, PF.SNEAK | PF.CRAWL, 0]);
    expect(old).toMatchObject({ sneaking: true, crawling: true, swimming: false, gliding: false, fx: 0 });
    expect(old.armor).toEqual([null, null, null, null]);
  });
  it('a remote player swimming is a low target, a glider looks from low eyes', () => {
    const rp = fake();
    setState(rp, unpackPlayerState(packPlayerState({ ...base(), swimming: true }, null, 0)));
    expect(rp.target.height).toBe(PHYS.PLAYER_CRAWL_HEIGHT);
    expect(rp.target.body.height).toBe(PHYS.PLAYER_CRAWL_HEIGHT);
    expect(rp.target.eyeHeight).toBe(0.4);
    setState(rp, unpackPlayerState(packPlayerState({ ...base(), gliding: true }, null, 0)));
    expect(rp.target.eyeHeight).toBe(0.4);
    expect(rp.target.height).toBe(PHYS.PLAYER_HEIGHT);
    setState(rp, unpackPlayerState(packPlayerState(base(), null, 0)));
    expect(rp.target.eyeHeight).toBe(PHYS.PLAYER_EYE);
  });
});

describe('effect colour in the player state', () => {
  it('is the average colour of the effects as one number, 0 without effects', () => {
    expect(effectColorInt({})).toBe(0);
    expect(effectColorInt(null)).toBe(0);
    const fx = { speed: { amp: 0, ticks: 100 }, regeneration: { amp: 1, ticks: 100 } };
    const n = effectColorInt(fx);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(0xffffff);
    const want = effectsColor([['speed', 0], ['regeneration', 1]]);
    const got = colorFromInt(n);
    for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i], 2);
  });
  it('rides at the end of the state and survives the wire', () => {
    const effects = {};
    addEffect(effects, 'poison', 200, 0);
    const a = packPlayerState({ ...base(), effects }, 4, 1);
    expect(a.length).toBe(13);
    expect(a[12]).toBe(effectColorInt(effects));
    expect(unpackPlayerState(wire(a)).fx).toBe(a[12]);
    expect(unpackPlayerState(wire(packPlayerState(base(), null, 0))).fx).toBe(0);
  });
  it('ignores a nonsense colour from the network', () => {
    const ok = [0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0];
    for (const bad of [-5, 0x1000000, 1.5, 'red', null, NaN]) expect(unpackPlayerState([...ok, bad]).fx).toBe(0);
    expect(unpackPlayerState([...ok, 0x336699]).fx).toBe(0x336699);
  });
  it('makes a remote player emit a swirl in their colour around where they are', () => {
    const emitted = [];
    const game = { ticks: 4, particles: { emit: (...a) => emitted.push(a) } };
    const rp = fake();
    setState(rp, unpackPlayerState(packPlayerState({ ...base(), effects: { strength: { amp: 0, ticks: 100 } } }, null, 0)));
    rp.effectSwirl(game, rp.state);
    expect(emitted.length).toBe(1);
    const [x, y, z, , , , r, g] = emitted[0];
    expect(Math.hypot(x - 1, z - 3)).toBeLessThan(0.7);
    expect(y).toBeGreaterThan(2);
    expect(y).toBeLessThan(4);
    expect(r).toBeGreaterThan(g); // Strength is red
    rp.effectSwirl(game, rp.state); // once per tick at most
    expect(emitted.length).toBe(1);
    game.ticks = 5; rp.effectSwirl(game, rp.state); // every second tick
    expect(emitted.length).toBe(1);
    game.ticks = 6; rp.effectSwirl(game, rp.state);
    expect(emitted.length).toBe(2);
  });
  it('is rarer around an invisible player, and absent for a dead one or without effects', () => {
    const emitted = [];
    const game = { ticks: 0, particles: { emit: (...a) => emitted.push(a) } };
    const rp = fake();
    const fx = { invisibility: { amp: 0, ticks: 100 } };
    setState(rp, unpackPlayerState(packPlayerState({ ...base(), effects: fx }, null, 0)));
    expect(rp.state.invisible).toBe(true);
    for (let t = 1; t <= 12; t++) { game.ticks = t; rp.effectSwirl(game, rp.state); }
    expect(emitted.length).toBe(2); // ticks 6 and 12
    emitted.length = 0;
    setState(rp, unpackPlayerState(packPlayerState({ ...base(), dead: true, effects: fx }, null, 0)));
    game.ticks = 18; rp.effectSwirl(game, rp.state);
    setState(rp, unpackPlayerState(packPlayerState(base(), null, 0)));
    game.ticks = 20; rp.effectSwirl(game, rp.state);
    expect(emitted.length).toBe(0);
  });
  it('swirl points circle the body at the usual radius and height', () => {
    let seed = 0.3;
    const rand = () => (seed = (seed * 7.13 + 0.17) % 1);
    for (let t = 0; t < 50; t++) {
      const w = effectSwirl(t, rand);
      expect(Math.hypot(w.dx, w.dz)).toBeGreaterThanOrEqual(0.45 - 1e-9);
      expect(Math.hypot(w.dx, w.dz)).toBeLessThanOrEqual(0.6 + 1e-9);
      expect(w.h).toBeGreaterThanOrEqual(0.1);
      expect(w.h).toBeLessThanOrEqual(1.7);
      expect(w.vx * w.dx + w.vz * w.dz).toBeCloseTo(0, 6); // tangential
    }
  });
});

describe('attack speed with effects', () => {
  it('Haste speeds it up 10 % per level and Mining Fatigue slows it 10 % per level', () => {
    expect(attackSpeedFactor({})).toBe(1);
    expect(attackSpeedFactor({ haste: { amp: 1, ticks: 9 } })).toBeCloseTo(1.2);
    expect(attackSpeedFactor({ mining_fatigue: { amp: 2, ticks: 9 } })).toBeCloseTo(0.7);
    expect(attackSpeedFactor({ haste: { amp: 0, ticks: 9 }, mining_fatigue: { amp: 0, ticks: 9 } })).toBeCloseTo(1);
    expect(attackSpeedFactor({ mining_fatigue: { amp: 200, ticks: 9 } })).toBeCloseTo(0.1);
  });
});
