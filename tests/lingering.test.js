import { describe, it, expect } from 'vitest';
import {
  EFFECTS, addEffect, tickEffects, periodicActions, witherInterval, resistanceFactor, luckOf, lingerFactor,
  LINGER_DURATION_FACTOR, LINGER_INSTANT_FACTOR,
} from '../src/player/effects.js';
import { POTIONS, brewKind, potionColor } from '../src/world/potions.js';
import { brewItem, isIngredient } from '../src/world/brewing.js';
import { ITEMS, I, POTION_ITEM, SPLASH_ITEM, LINGERING_ITEM, TIPPED_ARROW } from '../src/world/items.js';
import { B, BLOCKS, SHAPE, POTTED } from '../src/world/blocks.js';
import { craft } from '../src/player/crafting.js';
import { Player } from '../src/player/player.js';
import { splashPotion } from '../src/entities/splash.js';
import { AreaCloud, CLOUD, cloudFloor, breathCloudNear } from '../src/entities/areaCloud.js';
import { Arrow } from '../src/entities/entities.js';
import { packEntity, unpackEntity } from '../src/net/protocol.js';
import { catchWeights, rollCatch } from '../src/entities/bobber.js';
import { CinderdeepGenerator } from '../src/world/dimensions/cinderdeep.js';
import { MockWorld, rng } from './helpers.js';

const mob = (x, y = 64, z = 0) => ({ kind: 'mob', x, y, z, height: 1.8, deathTime: 0, applied: [], def: {},
  applyEffect(type, ticks, amp, f) { this.applied.push([type, ticks, amp, f]); } });

describe('new effects', () => {
  it('Wither hurts every 40 >> amp ticks and, unlike poison, can kill', () => {
    expect(EFFECTS.wither.good).toBe(false);
    expect(witherInterval(0)).toBe(40);
    expect(witherInterval(1)).toBe(20);
    const m = {};
    addEffect(m, 'wither', 80, 0);
    let hurts = 0;
    for (let t = 0; t < 80; t++) { hurts += periodicActions(m, { health: 1 }).filter((a) => a.source === 'wither').length; tickEffects(m); }
    expect(hurts).toBe(2);
    // poison never takes the last heart; wither does
    expect(periodicActions({ poison: { amp: 0, ticks: 25 } }, { health: 1 }).length).toBe(0);
    expect(periodicActions({ wither: { amp: 0, ticks: 40 } }, { health: 1 })).toEqual([{ type: 'hurt', amount: 1, source: 'wither' }]);
  });
  it('Wither kills the player (it ignores armour)', () => {
    const p = new Player();
    p.health = 1;
    p.addEffect('wither', 40, 0);
    for (const a of periodicActions(p.effects, { health: p.health })) p.hurt(a.amount, a.source);
    expect(p.dead).toBe(true);
    expect(p.deathCause).toBe('wither');
  });
  it('Resistance takes a fifth per level off the damage', () => {
    expect(resistanceFactor({})).toBe(1);
    expect(resistanceFactor({ resistance: { amp: 2, ticks: 1 } })).toBeCloseTo(0.4);
    expect(resistanceFactor({ resistance: { amp: 4, ticks: 1 } })).toBe(0);
    expect(resistanceFactor({ resistance: { amp: 4, ticks: 1 } }, 'void')).toBe(1);
    const p = new Player();
    p.addEffect('resistance', 100, 2);
    p.hurt(10, 'generic');
    expect(p.health).toBeCloseTo(16);
  });
  it('Luck and Bad Luck shift the fishing catch towards treasure or junk', () => {
    expect(luckOf({ luck: { amp: 0, ticks: 5 } })).toBe(1);
    expect(luckOf({ luck: { amp: 1, ticks: 5 }, unluck: { amp: 0, ticks: 5 } })).toBe(1);
    expect(catchWeights(0)).toEqual({ fish: 85, junk: 10, treasure: 5 });
    expect(catchWeights(1)).toEqual({ fish: 84, junk: 8, treasure: 7 });
    expect(catchWeights(-3).treasure).toBe(0);
    const treasure = new Set([I.BOW, I.FISHING_ROD, I.DIAMOND, I.IRON_INGOT, I.BOOK]);
    const share = (luck) => { const r = rng(7); let n = 0; for (let k = 0; k < 20000; k++) if (treasure.has(rollCatch(r, luck).id)) n++; return n / 20000; };
    expect(share(0)).toBeCloseTo(0.05, 1);
    expect(share(3)).toBeGreaterThan(share(0) + 0.05);
    expect(share(-3)).toBe(0);
  });
});

describe('new elixirs', () => {
  it('brew from the Shellback Helmet, the Blight Rose and the Glimmerfin', () => {
    expect(brewKind('murky', 'turtle_shell')).toBe('turtle_master');
    expect(brewKind('turtle_master', 'cinnabar')).toBe('long_turtle_master');
    expect(brewKind('turtle_master', 'glowshard_dust')).toBe('strong_turtle_master');
    expect(POTIONS.turtle_master.effects).toEqual([['slowness', 400, 3], ['resistance', 400, 2]]); // Slowness IV + Resistance III
    expect(brewKind('murky', 'blight_rose')).toBe('decay');
    expect(POTIONS.decay.effects[0][0]).toBe('wither');
    expect(brewKind('murky', 'glimmerfin')).toBe('luck');
    expect(brewKind('luck', 'fermented_spider_eye')).toBe('unluck');
    expect(isIngredient(I.TURTLE_SHELL)).toBe(true);
    expect(isIngredient(B.BLIGHT_ROSE)).toBe(true);
    expect(isIngredient(I.HOLLOW_BREATH)).toBe(true);
    expect(brewItem(POTION_ITEM.murky, I.TURTLE_SHELL)).toBe(POTION_ITEM.turtle_master);
    expect(brewItem(POTION_ITEM.murky, B.BLIGHT_ROSE)).toBe(POTION_ITEM.decay);
    expect(potionColor('turtle_master')).toBe('#7a5a96');
  });
  it('late elixir kinds are registered after every older item (ids stay stable)', () => {
    for (const k of ['turtle_master', 'decay', 'luck', 'unluck']) {
      expect(POTION_ITEM[k]).toBeGreaterThan(I.BUNDLE);
      expect(SPLASH_ITEM[k]).toBeGreaterThan(I.BUNDLE);
      expect(TIPPED_ARROW[k]).toBeGreaterThan(I.BUNDLE);
    }
    expect(I.HOLLOW_BREATH).toBeGreaterThan(I.BUNDLE);
    expect(POTION_ITEM.swiftness).toBeLessThan(I.EMPTY_MAP); // an old one, still where it was
    for (const k of Object.keys(POTIONS)) expect(ITEMS[LINGERING_ITEM[k]].potion).toEqual({ kind: k, splash: true, lingering: true });
  });
});

describe('lingering elixirs', () => {
  it('Hollow Breath turns splash vials into lingering ones, which brew on as lingering', () => {
    expect(brewItem(SPLASH_ITEM.poison, I.HOLLOW_BREATH)).toBe(LINGERING_ITEM.poison);
    expect(brewItem(POTION_ITEM.poison, I.HOLLOW_BREATH)).toBeNull();
    expect(brewItem(LINGERING_ITEM.poison, I.HOLLOW_BREATH)).toBeNull();
    expect(brewItem(LINGERING_ITEM.poison, I.GUNPOWDER)).toBeNull();
    expect(brewItem(LINGERING_ITEM.poison, I.CINNABAR)).toBe(LINGERING_ITEM.long_poison);
    expect(brewItem(LINGERING_ITEM.murky, I.TURTLE_SHELL)).toBe(LINGERING_ITEM.turtle_master);
    expect(ITEMS[LINGERING_ITEM.poison].throwable).toBe('potion');
    expect(ITEMS[LINGERING_ITEM.poison].name).toBe('Lingering Elixir of Poison');
  });
  it('a cloud waits, shrinks to nothing over 30 s and is gone', () => {
    const c = new AreaCloud(0, 64, 0, { potion: LINGERING_ITEM.swiftness });
    expect(c.radius).toBe(3);
    expect(c.effects).toEqual(POTIONS.swiftness.effects);
    let ticks = 0;
    while (!c.dead && ticks < 1000) { c.step([]); ticks++; }
    expect(ticks).toBeGreaterThan(450);
    expect(ticks).toBeLessThanOrEqual(CLOUD.wait + CLOUD.duration + 1);
  });
  it('lays a quarter of the duration on those inside, at most once a second, shrinking each time', () => {
    const c = new AreaCloud(0, 64, 0, { potion: LINGERING_ITEM.swiftness });
    const inside = mob(1), outside = mob(5), above = mob(0, 70);
    const hits = [];
    for (let t = 0; t < 60; t++) hits.push(...c.step([inside, outside, above]));
    expect(hits.filter((h) => h === inside).length).toBe(3); // at 15, 35 and 55 ticks
    expect(hits).not.toContain(outside);
    expect(hits).not.toContain(above);
    expect(c.radius).toBeLessThan(3 - 3 * 0.5 + 0.01);
    // applying: lasting effects at 1/4, instant ones at 1/2
    expect(lingerFactor('speed')).toBe(LINGER_DURATION_FACTOR);
    expect(lingerFactor('instant_health')).toBe(LINGER_INSTANT_FACTOR);
    const p = new Player();
    p.setPosition(0.5, 64, 0.5);
    const game = { player: p, entities: { list: [] }, net: null, particles: null };
    c.affect(game, p);
    expect(p.effects.speed.ticks).toBe(Math.round(POTIONS.swiftness.effects[0][1] / 4));
  });
  it('a thrown lingering elixir touches no one but leaves a cloud on the ground', () => {
    const p = new Player();
    p.setPosition(0, 64, 0);
    const near = mob(1), list = [near];
    const world = new MockWorld(64);
    const game = { player: p, world, entities: { list, add(e) { list.push(e); return e; } }, net: null, particles: null, audio: null };
    const reached = splashPotion(game, 0.5, 65.6, 0.5, LINGERING_ITEM.strength);
    expect(reached).toEqual([]);
    expect(p.effects.strength).toBeUndefined();
    const cloud = list.find((e) => e.kind === 'cloud');
    expect(cloud).toBeTruthy();
    expect(cloud.y).toBe(64); // settled on the floor
    for (let t = 0; t < 20; t++) cloud.tick(game);
    expect(p.effects.strength.ticks).toBeGreaterThan(0);
    expect(near.applied[0]).toEqual(['strength', POTIONS.strength.effects[0][1], 0, 0.25]);
  });
  it('guests standing in the host\'s cloud are sent the effects', () => {
    const sent = [];
    const remote = { isPlayer: true, isRemotePlayer: true, x: 0, y: 64, z: 1, height: 1.8, dead: false,
      applyEffect(type, ticks, amp, f) { sent.push([type, ticks, amp, f]); } };
    const p = new Player(); p.setPosition(50, 64, 50);
    const game = { player: p, entities: { list: [] }, net: { isHost: true, remoteTargets: () => [remote] }, particles: null };
    const c = new AreaCloud(0, 64, 0, { potion: LINGERING_ITEM.healing });
    for (let t = 0; t < 16; t++) c.tick(game);
    expect(sent).toEqual([['instant_health', 1, 0, 0.5]]);
  });
  it('clouds travel to guests', () => {
    const c = new AreaCloud(1, 64, 2, { potion: LINGERING_ITEM.poison });
    c.radius = 2.345;
    const o = unpackEntity(JSON.parse(JSON.stringify(packEntity(c))));
    expect(o.kind).toBe('cloud');
    expect(o.potion).toBe(LINGERING_ITEM.poison);
    expect(o.radius).toBeCloseTo(2.3);
    const b = unpackEntity(packEntity(new AreaCloud(0, 70, 0, { breath: true })));
    expect(b.breath).toBe(true);
  });
  it('the floor under an impact', () => {
    const w = new MockWorld(64);
    expect(cloudFloor(w, 0, 66.5, 0)).toBe(64);
    w.set(0, 64, 0, B.STONE);
    expect(cloudFloor(w, 0, 64.5, 0)).toBe(65); // broke against the side of a block
  });
});

describe('the Void Wyrm\'s breath', () => {
  it('is a violet Instant Damage cloud that fills Glass Vials', () => {
    const c = new AreaCloud(0, 64, 0, { breath: true });
    expect(c.effects).toEqual([['instant_damage', 1, 0]]);
    expect(c.shrinkOnUse).toBe(0);
    const game = { entities: { list: [c] } };
    expect(breathCloudNear(game, 2, 64, 0)).toBe(c);
    expect(breathCloudNear(game, 9, 64, 0)).toBeNull();
    expect(ITEMS[I.HOLLOW_BREATH].name).toBe('Hollow Breath');
  });
});

describe('tipped arrows', () => {
  it('eight arrows round a lingering (or splash) elixir', () => {
    const A = { id: I.ARROW, count: 1 };
    const grid = (p) => [A, A, A, A, { id: p, count: 1 }, A, A, A, A];
    expect(craft(grid(LINGERING_ITEM.poison), 3)).toMatchObject({ id: TIPPED_ARROW.poison, count: 8 });
    expect(craft(grid(SPLASH_ITEM.poison), 3)).toMatchObject({ id: TIPPED_ARROW.poison, count: 8 });
    expect(craft(grid(LINGERING_ITEM.turtle_master), 3)).toMatchObject({ id: TIPPED_ARROW.turtle_master, count: 8 });
  });
  it('carry every effect of their elixir at an eighth of the duration', () => {
    const a = new Arrow(0, 0, 0, 1, 0, 0, null);
    a.setTip(TIPPED_ARROW.turtle_master);
    expect(a.tipEffects).toEqual([['slowness', 50, 3], ['resistance', 50, 2]]);
    expect(a.pickupId).toBe(TIPPED_ARROW.turtle_master);
  });
});

describe('Blight Rose', () => {
  it('is a pottable flower that grows on the Cinderdeep floors', () => {
    expect(BLOCKS[B.BLIGHT_ROSE].shape).toBe(SHAPE.CROSS);
    expect(POTTED).toContain(B.BLIGHT_ROSE);
    expect(ITEMS[B.BLIGHT_ROSE].key).toBe('blight_rose');
  });
  it('withers the player who walks into it', () => {
    const w = new MockWorld(64);
    w.set(0, 64, 0, B.BLIGHT_ROSE);
    const p = new Player();
    p.setPosition(0.5, 64, 0.5);
    p.tick(w, { forward: 0, strafe: 0, jump: false, sprint: false, sneak: false });
    expect(p.effects.wither).toBeTruthy();
    expect(p.effects.wither.amp).toBe(0);
  });
  it('appears in generated Cinderdeep chunks', () => {
    const gen = new CinderdeepGenerator(12345);
    let roses = 0;
    for (let cx = 0; cx < 12 && !roses; cx++) for (let cz = 0; cz < 12; cz++) {
      const { blocks } = gen.generate(cx, cz);
      for (const id of blocks) if (id === B.BLIGHT_ROSE) roses++;
    }
    expect(roses).toBeGreaterThan(0);
  });
});
