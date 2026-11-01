// Firework fade colours, Star Rockets in crossbows and dispensers, and the player-damage gamerule.
import { describe, it, expect, vi } from 'vitest';
import { rng, MockWorld } from './helpers.js';
import { I, ITEMS, DYES, FIREWORK_STARS, STAR_ROCKETS } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';
import { COLORS } from '../src/world/colors.js';
import { craft } from '../src/player/crafting.js';
import { canStack, withExtras } from '../src/world/enchantments.js';
import { packEntity, unpackEntity, sameStack, copyStack } from '../src/net/protocol.js';
import { tooltipHTML } from '../src/ui/icons.js';
import {
  cleanStar, cleanFw, craftStar, starOfStack, rocketOfStack, fwLines, fadeAmount, mixRgb, crossbowLoad, loadedRocket, FADE_MARKER, burstDamage,
} from '../src/world/fireworks.js';
import { SkyRocket, launchRocket, starColor, SHOT_SPEED, useSkyRocket } from '../src/entities/skyRocket.js';
import { dispense, newDispenser } from '../src/world/dispensers.js';
import { Interaction } from '../src/player/interaction.js';
import { runCommand, GAME_RULES, HELP } from '../src/ui/commands.js';
import { DEFAULT_SETTINGS } from '../src/game.js';
import { Particles } from '../src/render/particles.js';
import '../src/world/dimensions/register.js'; // (the Sky Rocket recipe)

const S = (id, extra = {}) => ({ id, count: 1, ...extra });
const dye = (key) => S(I[key + '_DYE']);
const grid = (...cells) => { const g = new Array(9).fill(null); cells.forEach((c, i) => { g[i] = c; }); return g; };
const RED = 14, BLUE = 11, YELLOW = 4, GREEN = 13;
const INK = S(FADE_MARKER);
const POWDER = S(I.GUNPOWDER);
const mkMob = (x, y, z) => ({ kind: 'mob', x, y, z, width: 0.6, height: 1.8, dead: false, deathTime: 0, hurt: vi.fn(() => true) });
const burstGame = (extra = {}) => ({
  particles: { emit() {} }, audio: { play() {} }, entities: { list: [], add: (e) => e }, world: { getBlock: () => 0 }, player: { x: 99, y: 0, z: 99 }, settings: {}, ...extra,
});

describe('fade colours on Firework Stars', () => {
  it('the dyes after an Ink Sac are the fade colours, those before it the burst colours', () => {
    const r = craft(grid(POWDER, dye('RED'), dye('YELLOW'), INK, dye('BLUE')), 3);
    expect(r.id).toBe(FIREWORK_STARS[RED]);
    expect(r.fw).toEqual({ c: [RED, YELLOW], s: 0, t: 0, w: 0, f: [BLUE] });
    expect(starOfStack(r).f).toEqual([BLUE]);
  });

  it('combines with shapes and effects, and bone meal fades to white', () => {
    const r = craft(grid(POWDER, dye('RED'), S(I.GOLD_NUGGET), S(I.DIAMOND), INK, S(I.BONE_MEAL), dye('GREEN')), 3);
    expect(r.fw).toEqual({ c: [RED], s: 2, t: 1, w: 0, f: [0, GREEN] });
  });

  it('needs a colour before and after the one marker, counts a dye once, and reads the grid in order', () => {
    expect(craftStar([I.GUNPOWDER, I.RED_DYE, FADE_MARKER, I.BLUE_DYE, I.BLUE_DYE]).f).toEqual([BLUE]);
    expect(craftStar([I.GUNPOWDER, I.RED_DYE, FADE_MARKER])).toBe(null); // nothing to fade to
    expect(craftStar([I.GUNPOWDER, FADE_MARKER, I.BLUE_DYE])).toBe(null); // nothing to fade from
    expect(craftStar([I.GUNPOWDER, I.RED_DYE, FADE_MARKER, I.BLUE_DYE, FADE_MARKER, I.GREEN_DYE])).toBe(null);
    expect(craftStar([I.GUNPOWDER, I.BLUE_DYE, FADE_MARKER, I.RED_DYE])).toMatchObject({ c: [BLUE], f: [RED] });
  });

  it('holds up to 8 fade colours, no more', () => {
    const all = DYES.map((d, c) => (c === 0 ? I.BONE_MEAL : d)).filter((_, c) => c !== RED);
    expect(craftStar([I.GUNPOWDER, I.RED_DYE, FADE_MARKER, ...all.slice(0, 8)]).f.length).toBe(8);
    expect(craftStar([I.GUNPOWDER, I.RED_DYE, FADE_MARKER, ...all.slice(0, 9)])).toBe(null);
    expect(cleanStar({ c: [RED], f: [...Array(16).keys()] }).f.length).toBe(8);
  });

  it('a star without a fade is exactly what it was (no f key), and a plain ball stays the plain item', () => {
    expect(craftStar([I.GUNPOWDER, I.RED_DYE, I.GOLD_NUGGET])).toEqual({ c: [RED], s: 2, t: 0, w: 0 });
    expect(craft(grid(POWDER, dye('RED')), 3)).toEqual({ id: FIREWORK_STARS[RED], count: 1 });
    // a faded single ball is not "plain": it needs its data
    expect(craft(grid(POWDER, dye('RED'), INK, dye('BLUE')), 3).fw).toEqual({ c: [RED], s: 0, t: 0, w: 0, f: [BLUE] });
  });

  it('cleaning drops bad fade colours and keeps old data intact', () => {
    expect(cleanStar({ c: [RED], s: 0, t: 0, w: 0, f: [BLUE, BLUE, 99, -1, 'x'] })).toEqual({ c: [RED], s: 0, t: 0, w: 0, f: [BLUE] });
    expect(cleanStar({ c: [RED], f: [] })).toEqual({ c: [RED], s: 0, t: 0, w: 0 });
    expect(cleanStar({ c: [RED], f: 5 })).toEqual({ c: [RED], s: 0, t: 0, w: 0 });
    const old = { f: 2, st: [{ c: [RED, BLUE], s: 1, t: 1, w: 0 }] };
    expect(cleanFw(old)).toEqual(old);
  });

  it('stars with different fades do not stack, and the fade survives the network and copies', () => {
    const a = { id: FIREWORK_STARS[RED], count: 1, fw: { c: [RED], s: 0, t: 0, w: 0, f: [BLUE] } };
    const b = { id: FIREWORK_STARS[RED], count: 1, fw: { c: [RED], s: 0, t: 0, w: 0, f: [GREEN] } };
    expect(canStack(a, a)).toBe(true);
    expect(canStack(a, b)).toBe(false);
    expect(sameStack(copyStack(a), a)).toBe(true);
    expect(sameStack(a, b)).toBe(false);
    const packed = packEntity({ kind: 'item', id: 1, x: 0, y: 0, z: 0, stack: a, pickupDelay: 0 });
    expect(unpackEntity(JSON.parse(JSON.stringify(packed))).stack.fw.f).toEqual([BLUE]);
    expect(withExtras({ id: a.id, count: 1 }, a).fw.f).toEqual([BLUE]);
  });

  it('rockets carry faded stars through crafting', () => {
    const star = craft(grid(POWDER, dye('RED'), INK, dye('BLUE')), 3);
    const r = craft(grid(S(I.PAPER), POWDER, star), 3);
    expect(r.count).toBe(3);
    expect(rocketOfStack(r).stars[0].f).toEqual([BLUE]);
  });

  it('the tooltip names the fade colours', () => {
    const st = { id: FIREWORK_STARS[RED], count: 1, fw: { c: [RED], s: 0, t: 0, w: 0, f: [BLUE, GREEN] } };
    expect(fwLines(st)).toContain(`Fades to ${COLORS[BLUE][1]}, ${COLORS[GREEN][1]}`);
    expect(tooltipHTML(st)).toContain('Fades to');
  });
});

describe('fading sparks', () => {
  it('stay in their burst colour for a third of their life, then turn to the fade colour', () => {
    expect(fadeAmount(0, 30)).toBe(0);
    expect(fadeAmount(10, 30)).toBe(0);
    expect(fadeAmount(20, 30)).toBeCloseTo(0.5);
    expect(fadeAmount(30, 30)).toBe(1);
    expect(fadeAmount(5, 0)).toBe(0);
    expect(mixRgb([1, 0, 0], [0, 0, 1], 0.5)).toEqual([0.5, 0, 0.5]);
  });

  it('the particle system moves a fading particle from one colour to the other', () => {
    const p = new Particles({ add() {} });
    p.emit(0, 0, 0, 0, 0, 0, 1, 0, 0, 30, 0, [0, 0, 1]);
    p.emit(0, 5, 0, 0, 0, 0, 1, 0, 0, 30, 0); // an ordinary one beside it
    for (let t = 0; t < 10; t++) p.tick();
    expect(p.col[0]).toBe(1); // still red
    for (let t = 0; t < 10; t++) p.tick();
    expect(p.col[0]).toBeLessThan(1);
    expect(p.col[2]).toBeGreaterThan(0);
    for (let t = 0; t < 9; t++) p.tick();
    expect(p.col[0]).toBeLessThan(0.1);
    expect(p.col[2]).toBeGreaterThan(0.9);
    expect([p.col[3], p.col[4], p.col[5]]).toEqual([1, 0, 0]);
  });

  it('a burst passes each spark of a faded star a fade colour (and none to a star without one)', () => {
    const emitted = [];
    const game = burstGame({ particles: { emit: (...a) => emitted.push(a) } });
    const stack = { id: STAR_ROCKETS[RED], count: 1, fw: { st: [{ c: [RED], s: 0, t: 0, w: 0, f: [BLUE] }, { c: [YELLOW], s: 0, t: 0, w: 0 }] } };
    new SkyRocket(0, 10, 0, null, rng(3), null, stack).burst(game, rng(1));
    expect(emitted.length).toBe(140);
    const blue = starColor(BLUE), red = starColor(RED);
    for (const e of emitted.slice(0, 70)) {
      expect(e[11]).toHaveLength(3);
      // the fade colour is the blue one at the spark's own brightness
      expect(e[11][2] / blue[2]).toBeCloseTo(e[6] / red[0]);
    }
    for (const e of emitted.slice(70)) expect(e[11]).toBeNull();
  });

  it('a fading trail turns the same way', () => {
    const emitted = [];
    const game = burstGame({ particles: { emit: (...a) => emitted.push(a) } });
    const stack = { id: STAR_ROCKETS[RED], count: 1, fw: { st: [{ c: [RED], s: 0, t: 1, w: 0, f: [BLUE] }] } };
    const r = new SkyRocket(0, 10, 0, null, rng(3), null, stack);
    r.burst(game, rng(1));
    expect(r.heads.length).toBeGreaterThan(0);
    emitted.length = 0;
    r.tickSparks(game);
    const early = emitted.find((e) => e[9] === 7);
    for (let t = 0; t < 16; t++) r.tickSparks(game);
    emitted.length = 0;
    r.tickSparks(game);
    const late = emitted.find((e) => e[9] === 7);
    expect(late[8]).toBeGreaterThan(early[8]); // bluer
    expect(late[6]).toBeLessThan(early[6]); // less red
  });
});

describe('Star Rockets in crossbows', () => {
  const mkInv = (slots) => ({
    slots, selected: 0,
    get selectedStack() { return this.slots[this.selected]; },
    removeFromSlot(i, n) { this.slots[i].count -= n; if (this.slots[i].count <= 0) this.slots[i] = null; },
    damageSelected(n) { this.slots[this.selected].damage = (this.slots[this.selected].damage | 0) + n; },
    changed() {},
  });
  const starRocket = (stars = 2, count = 4) => ({ id: STAR_ROCKETS[RED], count, fw: { f: 2, st: Array.from({ length: stars }, () => ({ c: [RED], s: 1, t: 0, w: 0, f: [BLUE] })) } });
  function mk(slots, { sneaking = true, creative = false, mobs = [], blocks = [] } = {}) {
    const rockets = [];
    const player = { inventory: mkInv(slots), creative, sneaking, x: 0, y: 64, z: 0, dead: false, body: { height: 1.8 }, eyePos: () => [0, 65.6, 0], lookDir: () => [0, 0, -1], hurt: vi.fn(() => true) };
    const world = new MockWorld(60);
    for (const [x, y, z] of blocks) world.set(x, y, z, B.STONE);
    const game = {
      player, world, settings: {}, rockets,
      audio: { play() {} }, particles: { emit() {} },
      entities: { list: mobs, add: (e) => { rockets.push(e); return e; }, spawnArrow: vi.fn() },
    };
    const it = Object.create(Interaction.prototype);
    it.game = game;
    return { game, it, player, rockets };
  }
  const run = (r, game) => { for (let t = 0; t < 40 && !r.exploded; t++) r.tick(game); };

  it('only Star Rockets load (a plain Sky Rocket has nothing to burst)', () => {
    expect(crossbowLoad({ id: I.SKY_ROCKET, count: 1 })).toBe(null);
    expect(crossbowLoad({ id: I.SKY_ROCKET, count: 1, fw: { f: 3 } })).toBe(null);
    expect(crossbowLoad({ id: I.ARROW, count: 1 })).toBe(null);
    expect(crossbowLoad({ id: STAR_ROCKETS[BLUE], count: 3 })).toEqual({ st: [{ c: [BLUE], s: 0, t: 0, w: 0 }] });
    expect(crossbowLoad(starRocket(2))).toEqual({ f: 2, st: starRocket(2).fw.st });
  });

  it('sneaking while drawing loads one Star Rocket (stars, flight, fades) into the crossbow', () => {
    const { game, it } = mk([S(I.CROSSBOW, { damage: 0 }), starRocket(2, 4), S(I.ARROW)]);
    it.loadCrossbow();
    const [bow, rockets, arrows] = game.player.inventory.slots;
    expect(bow.id).toBe(I.CROSSBOW_LOADED);
    expect(rockets.count).toBe(3);
    expect(arrows.count).toBe(1); // the arrow stays
    expect(loadedRocket(bow).flight).toBe(2);
    expect(loadedRocket(bow).stars.length).toBe(2);
    expect(loadedRocket(bow).stars[0].f).toEqual([BLUE]);
    expect(fwLines(bow)[0]).toBe('Loaded: Star Rocket (2 stars, Flight 2)');
    expect(tooltipHTML(bow)).toContain('Loaded: Star Rocket');
    // the load survives copies and the network
    expect(loadedRocket(withExtras({ id: bow.id, count: 1, damage: 0 }, bow)).stars.length).toBe(2);
    expect(sameStack(copyStack(bow), bow)).toBe(true);
  });

  it('without sneaking an arrow is still what is loaded; with nothing to load nothing happens', () => {
    const a = mk([S(I.CROSSBOW, { damage: 0 }), starRocket(1), S(I.ARROW)], { sneaking: false });
    a.it.loadCrossbow();
    expect(a.game.player.inventory.slots[0].fw).toBeUndefined();
    expect(a.game.player.inventory.slots[0].id).toBe(I.CROSSBOW_LOADED);
    expect(a.game.player.inventory.slots[1].count).toBe(4);
    expect(a.game.player.inventory.slots[2]).toBe(null);
    const b = mk([S(I.CROSSBOW, { damage: 0 }), S(I.ARROW), S(I.SKY_ROCKET)], { sneaking: true });
    b.it.loadCrossbow();
    expect(b.game.player.inventory.slots[0].id).toBe(I.CROSSBOW);
    const c = mk([S(I.CROSSBOW, { damage: 0 })], { sneaking: true });
    c.it.loadCrossbow();
    expect(c.game.player.inventory.slots[0].id).toBe(I.CROSSBOW);
  });

  it('creative players keep their rocket', () => {
    const { game, it } = mk([S(I.CROSSBOW, { damage: 0 }), starRocket(1, 1)], { creative: true });
    it.loadCrossbow();
    expect(game.player.inventory.slots[1].count).toBe(1);
    expect(game.player.inventory.slots[0].id).toBe(I.CROSSBOW_LOADED);
  });

  it('firing sends the rocket straight ahead, empties the crossbow and wears it', () => {
    const { game, it, rockets } = mk([S(I.CROSSBOW, { damage: 0 }), starRocket(3, 1)]);
    it.loadCrossbow();
    it.fireCrossbow();
    expect(game.entities.spawnArrow).not.toHaveBeenCalled();
    expect(rockets.length).toBe(1);
    const r = rockets[0];
    expect(r.stars.length).toBe(3);
    expect(r.flight).toBe(2);
    expect(r.dir[2]).toBeCloseTo(-1);
    expect(r.vz).toBeCloseTo(-SHOT_SPEED);
    expect(r.shooter).toBe(game.player);
    const bow = game.player.inventory.slots[0];
    expect(bow.id).toBe(I.CROSSBOW);
    expect(bow.fw).toBeUndefined();
    expect(bow.damage).toBe(3);
  });

  it('the shot flies level and bursts on a block', () => {
    const { game, it, rockets } = mk([S(I.CROSSBOW, { damage: 0 }), starRocket(1, 1)], { blocks: [[0, 65, -10]] });
    it.loadCrossbow(); it.fireCrossbow();
    const r = rockets[0];
    run(r, game);
    expect(r.exploded).toBe(true);
    expect(r.z).toBeGreaterThan(-10.1);
    expect(r.z).toBeLessThan(-8);
    expect(r.y).toBeCloseTo(65.5, 0);
  });

  it('a mob in the way sets it off, and mobs near the burst take 5 + 2 per star', () => {
    const near = mkMob(0, 64, -6), edge = mkMob(3.8, 64, -6), far = mkMob(9, 64, -6);
    const { game, it, rockets } = mk([S(I.CROSSBOW, { damage: 0 }), starRocket(3, 1)], { mobs: [near, edge, far] });
    it.loadCrossbow(); it.fireCrossbow();
    const r = rockets[0];
    run(r, game);
    expect(r.exploded).toBe(true);
    expect(r.z).toBeLessThan(-4); // it did not stop short of the mob
    expect(burstDamage(3)).toBe(11);
    expect(near.hurt).toHaveBeenCalledWith(11, 'firework', null, 0);
    expect(edge.hurt).toHaveBeenCalled();
    expect(far.hurt).not.toHaveBeenCalled();
  });

  it('a shot with more stars hurts more', () => {
    const dmg = (stars) => {
      const m = mkMob(0, 64, -5);
      const { game, it, rockets } = mk([S(I.CROSSBOW, { damage: 0 }), starRocket(stars, 1)], { mobs: [m] });
      it.loadCrossbow(); it.fireCrossbow();
      run(rockets[0], game);
      return m.hurt.mock.calls[0][0];
    };
    expect(dmg(1)).toBe(7);
    expect(dmg(4)).toBe(13);
    expect(dmg(7)).toBe(19);
  });

  it('the arrow path is untouched', () => {
    const { game, it } = mk([S(I.CROSSBOW, { damage: 0 }), S(I.ARROW, { count: 2 })], { sneaking: false });
    it.loadCrossbow();
    it.fireCrossbow();
    expect(game.entities.spawnArrow).toHaveBeenCalledTimes(1);
    expect(game.player.inventory.slots[0]).toMatchObject({ id: I.CROSSBOW, damage: 1 });
  });
});

describe('players and the fireworksHurtPlayers gamerule', () => {
  const two = { c: [RED], s: 0, t: 0, w: 0 };
  const stack = { id: STAR_ROCKETS[RED], count: 1, fw: { st: [two, two] } };
  const mkGame = (settings, extra = {}) => {
    const player = { x: 1, y: 10, z: 0, dead: false, body: { height: 1.8 }, hurt: vi.fn(() => true) };
    return burstGame({ settings, player, net: null, ...extra });
  };

  it('the rule is off by default, in the default settings and when unset', () => {
    expect(DEFAULT_SETTINGS.fireworksHurtPlayers).toBe(false);
    expect(GAME_RULES.fireworksHurtPlayers).toBe('fireworksHurtPlayers');
    expect(HELP.join(' ')).toContain('fireworksHurtPlayers');
    for (const settings of [{}, { fireworksHurtPlayers: false }, undefined]) {
      const g = mkGame(settings);
      new SkyRocket(0, 10, 0, null, rng(3), null, stack).burst(g, rng(1));
      expect(g.player.hurt).not.toHaveBeenCalled();
    }
  });

  it('mobs are hurt either way', () => {
    const m = mkMob(0, 10, 0);
    const g = mkGame({});
    g.entities.list.push(m);
    new SkyRocket(0, 10, 0, null, rng(3), null, stack).burst(g, rng(1));
    expect(m.hurt).toHaveBeenCalledWith(9, 'firework', null, 0);
  });

  it('switched on, a burst hurts the player in range by the star count, but not the shooter or the rider', () => {
    const g = mkGame({ fireworksHurtPlayers: true });
    new SkyRocket(0, 10, 0, null, rng(3), null, stack).burst(g, rng(1));
    expect(g.player.hurt).toHaveBeenCalledTimes(1);
    expect(g.player.hurt.mock.calls[0][0]).toBe(burstDamage(2));
    expect(g.player.hurt.mock.calls[0][1]).toBe('firework');
    const far = mkGame({ fireworksHurtPlayers: true });
    far.player.x = 30;
    new SkyRocket(0, 10, 0, null, rng(3), null, stack).burst(far, rng(1));
    expect(far.player.hurt).not.toHaveBeenCalled();
    const own = mkGame({ fireworksHurtPlayers: true });
    new SkyRocket(0, 10, 0, null, rng(3), null, stack, { shooter: own.player }).burst(own, rng(1));
    expect(own.player.hurt).not.toHaveBeenCalled();
    const ride = mkGame({ fireworksHurtPlayers: true });
    new SkyRocket(0, 10, 0, ride.player, rng(3), null, stack).burst(ride, rng(1));
    expect(ride.player.hurt).not.toHaveBeenCalled();
  });

  it('a plain Sky Rocket never hurts anyone', () => {
    const g = mkGame({ fireworksHurtPlayers: true });
    new SkyRocket(0, 10, 0, null, rng(3)).burst(g, rng(1));
    expect(g.player.hurt).not.toHaveBeenCalled();
  });

  it('on the host guests are hurt too (a player\'s shot only with PvP on), and a guest only shows the sparks', () => {
    const guest = { x: 2, y: 10, z: 0, dead: false, body: { height: 1.8 }, hurt: vi.fn(() => true) };
    const net = (pvp) => ({ isHost: true, isClient: false, pvp, remoteTargets: (proj) => (proj && proj.shooter && !pvp ? [] : [guest]) });
    const a = mkGame({ fireworksHurtPlayers: true }, { net: net(true) });
    new SkyRocket(0, 10, 0, null, rng(3), null, stack, { shooter: a.player }).burst(a, rng(1));
    expect(guest.hurt).toHaveBeenCalledTimes(1);
    guest.hurt.mockClear();
    const b = mkGame({ fireworksHurtPlayers: true }, { net: net(false) });
    new SkyRocket(0, 10, 0, null, rng(3), null, stack, { shooter: b.player }).burst(b, rng(1));
    expect(guest.hurt).not.toHaveBeenCalled();
    const c = mkGame({ fireworksHurtPlayers: true }, { net: { ...net(true), isHost: false, isClient: true } });
    new SkyRocket(0, 10, 0, null, rng(3), null, stack).burst(c, rng(1));
    expect(c.player.hurt).not.toHaveBeenCalled();
  });

  it('/gamerule reads and sets it, defaulting to false', () => {
    const settings = {};
    const game = { settings, setSetting: (k, v) => { settings[k] = v; } };
    expect(runCommand(game, '/gamerule fireworksHurtPlayers')).toContain('currently set to: false');
    expect(runCommand(game, '/gamerule fireworksHurtPlayers true')).toContain('now set to: true');
    expect(settings.fireworksHurtPlayers).toBe(true);
    expect(runCommand(game, '/gamerule fireworksHurtPlayers')).toContain('currently set to: true');
    expect(runCommand(game, '/gamerule doDaylightCycle')).toContain('currently set to: true'); // the others default on
  });
});

describe('rockets from dispensers', () => {
  const UP = 1, EAST = 5;
  function setup(facing, slot, blocks = [], mobs = []) {
    const world = new MockWorld(60);
    world.set(0, 70, 0, B.DISPENSER, facing);
    for (const [x, y, z] of blocks) world.set(x, y, z, B.STONE);
    const d = newDispenser(0, 70, 0);
    d.slots[0] = slot;
    const sounds = [], list = mobs;
    const g = { world, getDispenser: () => d, audio: { play: (n) => sounds.push(n) }, particles: { emit() {} }, player: { x: 99, y: 99, z: 99 }, settings: {}, entities: { list, add: (e) => { list.push(e); return e; } } };
    return { g, d, sounds, list };
  }
  const rocketIn = (list) => list.find((e) => e instanceof SkyRocket);

  it('a dispenser facing up lights the rocket like a rocket on a block', () => {
    const { g, d, list, sounds } = setup(UP, { id: STAR_ROCKETS[RED], count: 2 });
    expect(dispense(g, 0, 70, 0, rng(1))).toBe('rocket');
    expect(d.slots[0].count).toBe(1);
    expect(sounds).toContain('rocket');
    const r = rocketIn(list);
    expect(r.dir).toBe(null);
    expect(r.y).toBeGreaterThan(70.5);
    expect(r.stars[0].c).toEqual([RED]);
    for (let t = 0; t < 5; t++) r.tick(g);
    expect(r.y).toBeGreaterThan(71.5); // climbing
  });

  it('facing sideways the rocket flies straight along the face and bursts on a wall', () => {
    const fw = { f: 3, st: [{ c: [RED], s: 2, t: 0, w: 0, f: [BLUE] }] };
    const { g, d, list } = setup(EAST, { id: STAR_ROCKETS[RED], count: 1, fw }, [[9, 70, 0], [9, 71, 0], [9, 69, 0]]);
    expect(dispense(g, 0, 70, 0, rng(1))).toBe('rocket');
    expect(d.slots[0]).toBe(null);
    const r = rocketIn(list);
    expect(r.dir[0]).toBeGreaterThan(0.99);
    expect(r.stars[0].f).toEqual([BLUE]);
    for (let t = 0; t < 30 && !r.exploded; t++) r.tick(g);
    expect(r.exploded).toBe(true);
    expect(r.x).toBeGreaterThan(5);
    expect(r.x).toBeLessThan(9.1);
    expect(Math.abs(r.y - 70.5)).toBeLessThan(1);
  });

  it('a plain Sky Rocket works too (decoration only), and one facing a wall just goes off', () => {
    const { g, list } = setup(EAST, S(I.SKY_ROCKET), [[1, 70, 0]]);
    expect(dispense(g, 0, 70, 0, rng(1))).toBe('rocket');
    const r = rocketIn(list);
    for (let t = 0; t < 3 && !r.exploded; t++) r.tick(g);
    expect(r.exploded).toBe(true);
    expect(r.stars.length).toBe(0);
  });

  it('a rocket from a dispenser hurts the mobs it bursts beside', () => {
    const m = mkMob(8, 70, 0.5); // (the dispenser's centre line)
    const { g, list } = setup(EAST, { id: STAR_ROCKETS[RED], count: 1 }, [], [m]);
    dispense(g, 0, 70, 0, rng(1));
    const r = rocketIn(list);
    for (let t = 0; t < 30 && !r.exploded; t++) r.tick(g);
    expect(m.hurt).toHaveBeenCalledWith(7, 'firework', null, 0);
  });

  it('launchRocket straight up climbs, any other way flies straight', () => {
    const list = [];
    const g = { entities: { add: (e) => list.push(e) }, audio: { play() {} } };
    expect(launchRocket(g, 0, 0, 0, [0, 1, 0], S(STAR_ROCKETS[RED])).dir).toBe(null);
    expect(launchRocket(g, 0, 0, 0, [0, 0, 1], S(STAR_ROCKETS[RED])).dir).toEqual([0, 0, 1]);
  });
});

describe('gliding with a rocket (already there)', () => {
  it('a rocket used while gliding pushes the Voidwing and trails sparks', () => {
    const added = [];
    const p = { gliding: true, x: 0, y: 100, z: 0, boostTicks: 0 };
    const g = { player: p, entities: { add: (e) => { added.push(e); return e; } }, audio: { play() {} } };
    expect(useSkyRocket(g, null, null, { id: I.SKY_ROCKET, count: 1, fw: { f: 3 } })).toBe(true);
    expect(p.boostTicks).toBe(added[0].life);
    expect(added[0].rider).toBe(p);
    expect(ITEMS[I.SKY_ROCKET].rocket).toBe(true);
  });
});
