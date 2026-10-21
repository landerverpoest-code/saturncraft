import { describe, it, expect } from 'vitest';
import {
  addEffect, tickEffects, effectLevel, speedFactor, jumpBonus, meleeWithEffects, splashFactor, instantAmount,
  periodicActions, cleanEffects, visibilityFactor, formatTicks, effectLabel, fallDamageWithEffects,
} from '../src/player/effects.js';
import { POTIONS, POTION_KEYS, brewKind } from '../src/world/potions.js';
import { newStand, tickStand, brewItem, canBrew, BREW_TICKS, BREWS_PER_POWDER, isIngredient } from '../src/world/brewing.js';
import { ITEMS, I, POTION_ITEM, SPLASH_ITEM } from '../src/world/items.js';
import { craft } from '../src/player/crafting.js';
import { breakProgressPerTick } from '../src/world/mining.js';
import { B } from '../src/world/blocks.js';
import { blockDrops } from '../src/world/mining.js';
import { Player } from '../src/player/player.js';
import { splashPotion } from '../src/entities/splash.js';
import { containerState, loadContainerState, packPlayerState, unpackPlayerState, packEntity, unpackEntity } from '../src/net/protocol.js';
import { Arrow } from '../src/entities/entities.js';

describe('status effect timing and stacking', () => {
  it('counts down and expires', () => {
    const m = {};
    addEffect(m, 'speed', 3);
    tickEffects(m); tickEffects(m);
    expect(m.speed.ticks).toBe(1);
    tickEffects(m);
    expect(m.speed).toBeUndefined();
  });
  it('same level only extends', () => {
    const m = {};
    addEffect(m, 'speed', 100);
    expect(addEffect(m, 'speed', 50)).toBe(false);
    expect(m.speed.ticks).toBe(100);
    expect(addEffect(m, 'speed', 300)).toBe(true);
    expect(m.speed.ticks).toBe(300);
  });
  it('a stronger effect replaces and the longer weaker one resumes afterwards', () => {
    const m = {};
    addEffect(m, 'speed', 1000, 0);
    addEffect(m, 'speed', 10, 1);
    expect(effectLevel(m, 'speed')).toBe(2);
    for (let i = 0; i < 10; i++) tickEffects(m);
    expect(effectLevel(m, 'speed')).toBe(1);
    expect(m.speed.ticks).toBe(990); // the hidden one kept counting
  });
  it('a weaker but longer effect waits underneath', () => {
    const m = {};
    addEffect(m, 'poison', 20, 1);
    addEffect(m, 'poison', 100, 0);
    expect(effectLevel(m, 'poison')).toBe(2);
    for (let i = 0; i < 20; i++) tickEffects(m);
    expect(effectLevel(m, 'poison')).toBe(1);
    expect(m.poison.ticks).toBe(80);
  });
  it('weaker and shorter effects are ignored', () => {
    const m = {};
    addEffect(m, 'strength', 100, 1);
    expect(addEffect(m, 'strength', 50, 0)).toBe(false);
    expect(m.strength.hidden).toBeNull();
  });
  it('modifiers follow the reference numbers', () => {
    expect(speedFactor({ speed: { amp: 1, ticks: 1 } })).toBeCloseTo(1.4);
    expect(speedFactor({ slowness: { amp: 3, ticks: 1 } })).toBeCloseTo(0.4);
    expect(jumpBonus({ jump_boost: { amp: 0, ticks: 1 } })).toBeCloseTo(0.1);
    expect(meleeWithEffects(7, { strength: { amp: 1, ticks: 1 } })).toBe(13);
    expect(meleeWithEffects(1, { weakness: { amp: 0, ticks: 1 } })).toBe(0);
    expect(fallDamageWithEffects(3, { jump_boost: { amp: 1, ticks: 1 } })).toBe(1);
    expect(instantAmount('instant_health', 0)).toBe(4);
    expect(instantAmount('instant_health', 1)).toBe(8);
    expect(instantAmount('instant_damage', 1)).toBe(12);
    expect(instantAmount('instant_damage', 0, 0.5)).toBe(3);
    expect(visibilityFactor({ invisibility: { amp: 0, ticks: 1 } }, 0)).toBeCloseTo(0.07);
    expect(visibilityFactor({}, 0)).toBe(1);
  });
  it('poison pulses every 25 ticks (12 at level II) but never kills; regeneration every 50', () => {
    let hurts = 0;
    const m = {};
    addEffect(m, 'poison', 100);
    for (let t = 0; t < 100; t++) { hurts += periodicActions(m, { health: 10 }).length; tickEffects(m); }
    expect(hurts).toBe(4);
    expect(periodicActions({ poison: { amp: 0, ticks: 25 } }, { health: 1 })).toEqual([]);
    expect(periodicActions({ poison: { amp: 1, ticks: 24 } }, { health: 5 })).toHaveLength(1);
    expect(periodicActions({ regeneration: { amp: 0, ticks: 50 } }, { health: 5 })[0].type).toBe('heal');
    expect(periodicActions({ regeneration: { amp: 0, ticks: 50 } }, { health: 5, undead: true })).toEqual([]);
  });
  it('labels, times and save cleaning', () => {
    expect(effectLabel('speed', 1)).toBe('Speed II');
    expect(formatTicks(3600)).toBe('3:00');
    expect(formatTicks(20 * 65)).toBe('1:05');
    const c = cleanEffects({ speed: { amp: 1, ticks: 40, hidden: { amp: 0, ticks: 90 } }, bogus: { ticks: 5 }, hunger: 30, poison: { ticks: -1 } });
    expect(Object.keys(c).sort()).toEqual(['hunger', 'speed']);
    expect(c.hunger).toEqual({ amp: 0, ticks: 30, hidden: null });
    expect(c.speed.hidden.ticks).toBe(90);
  });
});

describe('the brewing tree', () => {
  const brew = (from, ing) => { const id = brewItem(POTION_ITEM[from], I[ing.toUpperCase()]); return id === null ? null : ITEMS[id].potion.kind; };
  it('water + Cinderroot = Murky; other ingredients make Bland / Thick', () => {
    expect(brew('water', 'cinderroot')).toBe('murky');
    expect(brew('water', 'sugar')).toBe('bland');
    expect(brew('water', 'glowshard_dust')).toBe('thick');
    expect(brew('water', 'fermented_spider_eye')).toBe('weakness');
  });
  it('Murky + ingredient = the elixir', () => {
    expect(brew('murky', 'sugar')).toBe('swiftness');
    expect(brew('murky', 'gilded_melon_slice')).toBe('healing');
    expect(brew('murky', 'spider_eye')).toBe('poison');
    expect(brew('murky', 'ember_cream')).toBe('fire_resistance');
    expect(brew('murky', 'gilded_carrot')).toBe('night_vision');
    expect(brew('murky', 'spinefish')).toBe('water_breathing');
    expect(brew('murky', 'ember_powder')).toBe('strength');
    expect(brew('murky', 'wraith_tear')).toBe('regeneration');
    expect(brew('murky', 'slimeball')).toBe('leaping');
    expect(brew('murky', 'feather')).toBe('slow_falling');
    expect(brew('bland', 'sugar')).toBeNull();
  });
  it('Cinnabar extends, Glowshard Dust strengthens, a fermented eye corrupts', () => {
    expect(brew('swiftness', 'cinnabar')).toBe('long_swiftness');
    expect(brew('strong_swiftness', 'cinnabar')).toBe('long_swiftness');
    expect(brew('long_swiftness', 'glowshard_dust')).toBe('strong_swiftness');
    expect(brew('healing', 'cinnabar')).toBeNull();
    expect(brew('fire_resistance', 'glowshard_dust')).toBeNull();
    expect(brew('slowness', 'glowshard_dust')).toBe('strong_slowness');
    expect(brew('swiftness', 'fermented_spider_eye')).toBe('slowness');
    expect(brew('long_leaping', 'fermented_spider_eye')).toBe('long_slowness');
    expect(brew('healing', 'fermented_spider_eye')).toBe('harming');
    expect(brew('strong_poison', 'fermented_spider_eye')).toBe('strong_harming');
    expect(brew('night_vision', 'fermented_spider_eye')).toBe('invisibility');
  });
  it('Blast Powder makes any elixir a splash one, and splash ones brew on as splash', () => {
    expect(brewItem(POTION_ITEM.healing, I.GUNPOWDER)).toBe(SPLASH_ITEM.healing);
    expect(brewItem(SPLASH_ITEM.healing, I.GUNPOWDER)).toBeNull();
    expect(brewItem(SPLASH_ITEM.healing, I.GLOWSHARD_DUST)).toBe(SPLASH_ITEM.strong_healing);
  });
  it('every brew result is a registered kind with reference durations', () => {
    for (const k of POTION_KEYS) for (const ing of ['cinderroot', 'cinnabar', 'glowshard_dust', 'fermented_spider_eye', 'sugar']) {
      const r = brewKind(k, ing);
      if (r) expect(POTIONS[r]).toBeDefined();
    }
    expect(POTIONS.swiftness.effects[0]).toEqual(['speed', 3600, 0]);
    expect(POTIONS.long_swiftness.effects[0][1]).toBe(9600);
    expect(POTIONS.strong_poison.effects[0]).toEqual(['poison', 432, 1]);
    expect(POTIONS.strong_slowness.effects[0]).toEqual(['slowness', 400, 3]);
  });
  it('ingredients and the alembic are craftable', () => {
    const g = (rows) => rows.flat().map((id) => (id ? { id, count: 1 } : null));
    const N = I.GOLD_NUGGET, _ = null;
    expect(craft(g([[B.GLASS, _, B.GLASS], [_, B.GLASS, _], [_, _, _]]), 3)).toEqual({ id: I.GLASS_VIAL, count: 3 });
    expect(craft(g([[_, I.EMBER_ROD, _], [B.COBBLESTONE, B.COBBLESTONE, B.COBBLESTONE], [_, _, _]]), 3).id).toBe(B.BREWING_STAND);
    expect(craft(g([[N, N, N], [N, I.MELON_SLICE, N], [N, N, N]]), 3).id).toBe(I.GILDED_MELON_SLICE);
    expect(craft(g([[N, N, N], [N, I.CARROT, N], [N, N, N]]), 3).id).toBe(I.GILDED_CARROT);
    expect(craft(g([[I.GOLD_INGOT, _], [_, _]]), 2)).toEqual({ id: N, count: 9 });
    expect(craft(g([[I.SLIMEBALL, I.EMBER_POWDER], [_, _]]), 2).id).toBe(I.EMBER_CREAM);
    expect(craft(g([[I.SPIDER_EYE, B.BROWN_MUSHROOM], [I.SUGAR, _]]), 2).id).toBe(I.FERMENTED_SPIDER_EYE);
    expect(craft(g([[B.SUGAR_CANE, _], [_, _]]), 2).id).toBe(I.SUGAR);
  });
});

describe('Brewing Alembic', () => {
  const vial = (kind) => ({ id: POTION_ITEM[kind], count: 1, damage: 0 });
  it('takes 400 ticks, spends one fuel per brew and 20 brews per Ember Powder', () => {
    const s = newStand(0, 0, 0);
    s.slots = [vial('water'), null, vial('water'), { id: I.CINDERROOT, count: 2 }, { id: I.EMBER_POWDER, count: 1 }];
    expect(canBrew(s)).toBe(true);
    let done = 0, t = 0;
    while (!done && t < 1000) { if (tickStand(s) === 'done') done = t + 1; t++; }
    expect(done).toBe(BREW_TICKS + 1); // start tick + 400 brewing ticks
    expect(s.slots[0].id).toBe(POTION_ITEM.murky);
    expect(s.slots[1]).toBeNull();
    expect(s.slots[2].id).toBe(POTION_ITEM.murky);
    expect(s.slots[3].count).toBe(1);
    expect(s.slots[4]).toBeNull();
    expect(s.fuel).toBe(BREWS_PER_POWDER - 1);
  });
  it('stops when the ingredient is taken away and does not start without fuel', () => {
    const s = newStand(0, 0, 0);
    s.slots = [vial('murky'), null, null, { id: I.SUGAR, count: 1 }, null];
    tickStand(s);
    expect(s.brewTime).toBe(0);
    s.fuel = 1;
    tickStand(s);
    expect(s.brewTime).toBe(BREW_TICKS);
    s.slots[3] = null;
    tickStand(s);
    expect(s.brewTime).toBe(0);
    expect(s.slots[0].id).toBe(POTION_ITEM.murky);
  });
  it('ignores ingredients that change nothing', () => {
    const s = newStand(0, 0, 0);
    s.fuel = 5;
    s.slots = [vial('bland'), null, null, { id: I.SUGAR, count: 1 }, null];
    tickStand(s);
    expect(s.brewTime).toBe(0);
    expect(isIngredient(I.DIAMOND)).toBe(false);
  });
  it('syncs as a host container', () => {
    const s = newStand(1, 2, 3);
    s.slots[0] = vial('water'); s.fuel = 7; s.brewTime = 123;
    const copy = newStand(1, 2, 3);
    loadContainerState('brewing', copy, JSON.parse(JSON.stringify(containerState('brewing', s))));
    expect(copy.slots[0].id).toBe(POTION_ITEM.water);
    expect(copy.fuel).toBe(7); expect(copy.brewTime).toBe(123);
  });
});

describe('splash elixirs', () => {
  it('fall off linearly over 4 blocks; a direct hit is full strength', () => {
    expect(splashFactor(0)).toBe(1);
    expect(splashFactor(2)).toBe(0.5);
    expect(splashFactor(3.9)).toBeCloseTo(0.025);
    expect(splashFactor(4)).toBe(0);
    expect(splashFactor(10, true)).toBe(1);
  });
  it('reach the player and mobs scaled by distance; undead are hurt by healing', () => {
    const p = new Player();
    p.setPosition(0, 64, 0);
    const mob = (x, undead) => ({ kind: 'mob', x, y: 64, z: 0, deathTime: 0, applied: [], def: {}, undead,
      applyEffect(type, ticks, amp, f) { this.applied.push([type, ticks, amp, f]); } });
    const near = mob(1), far = mob(6);
    const game = { player: p, entities: { list: [near, far] }, net: null, particles: null, audio: null };
    const reached = splashPotion(game, 0, 64, 0, SPLASH_ITEM.swiftness);
    expect(reached.length).toBe(2);
    expect(p.effects.speed.ticks).toBe(3600);
    expect(near.applied[0][3]).toBeCloseTo(0.75);
    expect(far.applied.length).toBe(0);
    // healing at 2 blocks: 4 * 0.5 = 2 health
    p.health = 10;
    splashPotion(game, 2, 64, 0, SPLASH_ITEM.healing);
    expect(p.health).toBe(12);
  });
  it('travel as thrown entities with their elixir id', () => {
    const a = new Arrow(1, 2, 3, 0.1, 0.2, 0.3, null, false, 'potion', SPLASH_ITEM.poison);
    const o = unpackEntity(JSON.parse(JSON.stringify(packEntity(a))));
    expect(o.thrown).toBe('potion');
    expect(o.potion).toBe(SPLASH_ITEM.poison);
  });
});

describe('effects on the player', () => {
  it('drinking-style application, instant effects and milk-style clearing', () => {
    const p = new Player();
    p.health = 10;
    p.applyEffect('instant_health', 1, 1);
    expect(p.health).toBe(18);
    p.applyEffect('instant_damage', 1, 0);
    expect(p.health).toBe(12);
    p.applyEffect('regeneration', 900, 0);
    expect(p.effectLevel('regeneration')).toBe(1);
    p.clearEffects();
    expect(Object.keys(p.effects)).toHaveLength(0);
  });
  it('fire resistance blocks fire and lava damage', () => {
    const p = new Player();
    p.addEffect('fire_resistance', 100);
    expect(p.hurt(4, 'lava')).toBe(false);
    expect(p.hurt(2, 'fall')).toBe(true);
  });
  it('haste speeds up mining by 20 % per level', () => {
    const base = breakProgressPerTick(B.STONE, undefined, {});
    expect(breakProgressPerTick(B.STONE, undefined, { haste: 2 }) / base).toBeCloseTo(1.4);
  });
  it('invisibility is sent to other players', () => {
    const p = new Player();
    p.addEffect('invisibility', 100);
    expect(unpackPlayerState(packPlayerState(p, null, 0)).invisible).toBe(true);
  });
});

describe('Cinderroot', () => {
  it('drops itself, more when ripe', () => {
    expect(blockDrops(B.CINDERROOT, undefined, () => 0, 1)).toEqual([{ id: I.CINDERROOT, count: 1 }]);
    expect(blockDrops(B.CINDERROOT, undefined, () => 0.99, 3)[0].count).toBe(4);
    expect(ITEMS[I.CINDERROOT].places).toBe(B.CINDERROOT);
  });
});
