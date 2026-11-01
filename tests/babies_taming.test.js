import { describe, it, expect, vi, afterEach } from 'vitest';
import { Mob } from '../src/mobs/mob.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import {
  isCompanion, canTameWith, companionFoods, companionAI, giftTable, pickGift, GIFT_TABLES, GIFTS, GIFT_DELAY,
} from '../src/mobs/companions.js';
import { YOUNG_TYPES, canBreed, growStep, breedStep, approach, isYoung, BREED_TIME } from '../src/mobs/youngAnimals.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { Interaction } from '../src/player/interaction.js';
import { I, ITEMS } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';
import { MODELS } from '../src/mobs/models.js';
import { rng } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

function fakeGame({ list = [], player = {} } = {}) {
  const items = [];
  const g = {
    ticks: 0, time: 1000,
    entities: { list, spawnItem: vi.fn((x, y, z, st, vel) => { items.push({ x, y, z, st, vel }); }), spawnXp: vi.fn(), add: vi.fn((e) => { list.push(e); return e; }) },
    particles: { emit: vi.fn(), smoke: vi.fn() },
    audio: { play: vi.fn() },
    milestones: { event: vi.fn() },
    settings: {}, difficulty: 'normal',
    player: { x: 0, y: 64, z: 0, dead: false, creative: false, isPlayer: true, netName: undefined, body: { vx: 0, vz: 0 }, inventory: {}, stats: { kills: 0 }, ...player },
  };
  g.spawner = { spawnMob: (t, x, y, z) => { const c = new Mob(t, x, y, z); c._game = g; g.entities.list.push(c); return c; } };
  return { g, items };
}
const owner = (over = {}) => ({ x: 0, y: 64, z: 0, dead: false, isPlayer: true, ...over });
const pet = (type, x = 1, z = 0) => new Mob(type, x, 64, z);
const NEW_COMPANIONS = ['hopper', 'bristleback', 'frostbear'];

describe('further companions: definitions', () => {
  it('Hoppers, Bristlebacks and Frostbears are companions with taming food that is not their breeding food', () => {
    for (const k of NEW_COMPANIONS) {
      const d = MOBS[k];
      expect(isCompanion(d)).toBe(true);
      expect(d.tamedHealth).toBeGreaterThan(d.health);
      expect(d.tamedAttack).toBeGreaterThan(0);
      expect(d.companion.tameFood.length).toBeGreaterThan(0);
      for (const t of d.companion.tameFood) { expect(ITEMS[t]).toBeTruthy(); expect(d.food || []).not.toContain(t); }
      expect(companionFoods(d)).toEqual(expect.arrayContaining([...(d.food || []), ...d.companion.tameFood]));
      expect(d.companion.sitDrop).toBeGreaterThan(0);
    }
    expect(canTameWith(MOBS.hopper, I.GILDED_CARROT)).toBe(true);
    expect(canTameWith(MOBS.hopper, I.CARROT)).toBe(false); // carrots still only breed
    expect(canTameWith(MOBS.bristleback, I.BAKED_POTATO)).toBe(true);
    expect(canTameWith(MOBS.bristleback, I.POTATO)).toBe(false);
    expect(canTameWith(MOBS.frostbear, I.RAW_REDFIN)).toBe(true);
    expect(canTameWith(MOBS.frostbear, I.RAW_SILVERFIN)).toBe(false);
    expect(MOBS.hopper.companion.perk).toBe('forager');
    expect(MOBS.bristleback.companion.perk).toBe('forager');
    expect(MOBS.frostbear.companion.perk).toBe('guard');
    // the earlier companions are untouched, other animals are still wild
    expect(isCompanion(MOBS.vixling)).toBe(true);
    for (const k of ['cluckling', 'mooxen', 'fleecer', 'buzzling', 'packhorn', 'dune_strider', 'croaker']) expect(isCompanion(MOBS[k])).toBe(false);
  });

  it('each tame model has a band to show, and the gift tables are weighted real items', () => {
    for (const k of NEW_COMPANIONS) expect(MODELS[k].parts.some((p) => p[0] === 'band')).toBe(true);
    for (const [name, table] of Object.entries(GIFT_TABLES)) {
      for (const [id, w] of table) { expect(ITEMS[id], name).toBeTruthy(); expect(w).toBeGreaterThan(0); }
    }
    expect(giftTable(MOBS.hopper)).toBe(GIFT_TABLES.burrow);
    expect(giftTable(MOBS.bristleback)).toBe(GIFT_TABLES.truffler);
    expect(giftTable(MOBS.vixling)).toBe(GIFTS);
    expect(giftTable(MOBS.cragbuck)).toBe(GIFTS);
    const r = rng(3), seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(pickGift(r, GIFT_TABLES.truffler).id);
    expect(seen.size).toBe(GIFT_TABLES.truffler.length);
    expect(pickGift(() => 0, GIFT_TABLES.burrow).id).toBe(GIFT_TABLES.burrow[0][0]);
    expect(pickGift(() => 0.9999, GIFT_TABLES.burrow).id).toBe(GIFT_TABLES.burrow[GIFT_TABLES.burrow.length - 1][0]);
  });
});

describe('further companions: taming, hearts, owner, saving', () => {
  it('tame() gives hearts, sits it down at its tame health for the player and keeps it around', () => {
    for (const k of NEW_COMPANIONS) {
      const { g } = fakeGame({ player: { netName: 'Ana' } });
      const m = pet(k); m._game = g;
      m.persistent = false;
      m.tame(g);
      expect(m).toMatchObject({ tamed: true, sitting: true, ownerName: 'Ana', persistent: true });
      expect(m.health).toBe(MOBS[k].tamedHealth);
      expect(m.maxHealth).toBe(MOBS[k].tamedHealth);
      expect(g.particles.emit).toHaveBeenCalledTimes(7); // seven hearts
      expect(g.milestones.event).toHaveBeenCalledWith('tame');
    }
  });

  it('owner, sit state and gift timer survive a save; a wild one stays wild', () => {
    for (const k of NEW_COMPANIONS) {
      const { g } = fakeGame({ player: { netName: 'Ana' } });
      const m = pet(k); m.tame(g); m.sitting = false; if (MOBS[k].companion.perk === 'forager') m.giftIn = 777;
      const data = JSON.parse(JSON.stringify(m.saveData()));
      expect(data).toMatchObject({ tamed: true, sitting: false, ownerName: 'Ana' });
      const back = new Mob(k, 0, 64, 0); back.loadData(data);
      expect(back).toMatchObject({ tamed: true, sitting: false, ownerName: 'Ana' });
      expect(back.maxHealth).toBe(MOBS[k].tamedHealth);
      if (MOBS[k].companion.perk === 'forager') expect(back.giftIn).toBe(777); else expect(back.giftIn).toBeUndefined();
      const wild = new Mob(k, 0, 64, 0); wild.loadData(JSON.parse(JSON.stringify(pet(k).saveData())));
      expect(wild.tamed).toBe(false);
    }
  });

  it('the young of a tame pair are tame, keep the owner and stay', () => {
    for (const k of ['hopper', 'bristleback', 'frostbear']) {
      const { g } = fakeGame({ player: { netName: 'Ana' } });
      const a = pet(k, 0, 0), b = pet(k, 1, 0); a._game = g;
      a.tame(g); b.tame(g);
      a.breed(g, b);
      const baby = g.entities.list[g.entities.list.length - 1];
      expect(baby.baby).toBe(true);
      expect(baby).toMatchObject({ tamed: true, ownerName: 'Ana', persistent: true });
      expect(baby.health).toBe(MOBS[k].tamedHealth);
    }
  });

  const setup = (type, held, over = {}) => {
    const { g } = fakeGame({ player: { netName: 'Ana', creative: false, ...over } });
    const stack = held ? { id: held, count: 3, damage: 0 } : null;
    g.player.inventory = { selected: 0, get selectedStack() { return stack && stack.count > 0 ? stack : null; }, removeFromSlot(i, n) { stack.count -= n; } };
    const ia = Object.create(Interaction.prototype); ia.game = g; ia.swing = 0;
    const m = pet(type); m._game = g;
    return { g, ia, m, stack, click: () => ia.interactHowler(m, g.player.inventory.selectedStack, g.player.inventory.selectedStack && ITEMS[g.player.inventory.selectedStack.id]) };
  };

  it('offering the taming food tames 1 time in 3; the breeding food and an angry bear do not', () => {
    const cases = [['hopper', I.GILDED_CARROT, I.CARROT], ['bristleback', I.BAKED_POTATO, I.POTATO], ['frostbear', I.RAW_REDFIN, I.RAW_SILVERFIN]];
    for (const [type, tameItem, breedItem] of cases) {
      const win = setup(type, tameItem);
      vi.spyOn(Math, 'random').mockReturnValue(0.1);
      expect(win.click()).toBe(true);
      expect(win.m.tamed).toBe(true);
      expect(win.m.ownerName).toBe('Ana');
      expect(win.stack.count).toBe(2);
      Math.random.mockReturnValue(0.9);
      const lose = setup(type, tameItem);
      expect(lose.click()).toBe(true);
      expect(lose.m.tamed).toBe(false);
      expect(lose.stack.count).toBe(2);
      expect(lose.g.particles.smoke).toHaveBeenCalled();
      const breed = setup(type, breedItem);
      expect(breed.click()).toBe(false); // left to the ordinary feeding code
      expect(breed.stack.count).toBe(3);
      vi.restoreAllMocks();
    }
    const angry = setup('frostbear', I.RAW_REDFIN); angry.m.enemy = 'player';
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    expect(angry.click()).toBe(false);
    expect(angry.m.tamed).toBe(false);
    expect(angry.stack.count).toBe(3);
  });

  it('a tame one sits and stands for its owner only', () => {
    const t = setup('bristleback', null);
    t.m.tame(t.g); t.m.sitting = false;
    expect(t.click()).toBe(true);
    expect(t.m.sitting).toBe(true);
    expect(t.click()).toBe(true);
    expect(t.m.sitting).toBe(false);
    t.g.player.netName = 'Ben';
    expect(t.click()).toBe(false);
  });
});

describe('further companions: behaviour', () => {
  const tamed = (type, x = 1, z = 0) => {
    const { g, items } = fakeGame();
    const m = pet(type, x, z); m._game = g;
    m.tame(g); m.sitting = false;
    m.chase = vi.fn(); m.wanderAI = vi.fn(); m.steer = vi.fn(); m.teleportTo = vi.fn(() => true);
    return { g, items, m };
  };
  const run = (m, g, p) => companionAI(m, g, p, Math.hypot(p.x - m.x, p.y - m.y, p.z - m.z));

  it('they follow their owner and teleport when far behind', () => {
    for (const k of NEW_COMPANIONS) {
      const a = tamed(k, 8, 0);
      run(a.m, a.g, owner());
      expect(a.m.chase).toHaveBeenCalledTimes(1);
      const far = tamed(k, 20, 0);
      run(far.m, far.g, owner());
      expect(far.m.teleportTo).toHaveBeenCalled();
    }
  });

  it('a sitting one stays put', () => {
    const { g, m } = tamed('hopper', 2, 0);
    m.sitting = true;
    run(m, g, owner({ x: 30 }));
    expect(m.chase).not.toHaveBeenCalled();
    expect(m.teleportTo).not.toHaveBeenCalled();
  });

  it('Hoppers and Bristlebacks dig up gifts from their own tables; Frostbears do not', () => {
    for (const [k, table] of [['hopper', GIFT_TABLES.burrow], ['bristleback', GIFT_TABLES.truffler]]) {
      const { g, items, m } = tamed(k, 1, 0);
      m.body.onGround = true; m.giftIn = 1;
      run(m, g, owner());
      expect(items.length).toBe(1);
      expect(table.map(([id]) => id)).toContain(items[0].st.id);
      expect(m.giftIn).toBeGreaterThanOrEqual(GIFT_DELAY[0]);
    }
    const bear = tamed('frostbear', 1, 0);
    bear.m.body.onGround = true; bear.m.giftIn = 1;
    run(bear.m, bear.g, owner());
    expect(bear.items.length).toBe(0);
  });

  it('a tame Frostbear guards: it goes for monsters near its owner, not for the owner or other pets', () => {
    const { g, m } = tamed('frostbear', 1, 0);
    const z = pet('shambler', 4, 0); g.entities.list.push(z);
    g.ticks = m.id % 10;
    run(m, g, owner());
    expect(m.enemy).toBe(z);
    expect(m.chase).toHaveBeenCalledWith(g, z, expect.any(Number));
  });

  it('a hurt tame Frostbear fights back at mobs and no longer calls the wild bears on its owner', () => {
    const { g, m } = tamed('frostbear', 1, 0);
    const wild = pet('frostbear', 3, 0); wild._game = g; g.entities.list.push(wild);
    const foe = pet('shambler', 2, 0);
    m.sitting = true;
    m.hurt(1, 'mob:Shambler', foe);
    expect(m.sitting).toBe(false);
    expect(m.enemy).toBe(foe);
    expect(wild.enemy).not.toBe(foe); // a tame bear does not rally the wild ones
    const tame2 = tamed('frostbear').m;
    tame2.hurt(1, 'player', { isPlayer: true, x: 0, z: 0, kind: 'player' });
    expect(tame2.enemy).toBe(null); // never at its owner
  });

  it('a wild Frostbear still rallies its kin when hurt', () => {
    const { g } = fakeGame();
    const a = pet('frostbear', 0, 0), b = pet('frostbear', 3, 0);
    a._game = g; g.entities.list.push(a, b);
    a.hurt(1, 'player', { isPlayer: true, x: 0, z: 5, kind: 'player' });
    expect(b.enemy).toBe('player');
  });
});

describe('baby variants for more animals', () => {
  it('Buzzlings, Packhorns, Gillnewts, Dolphins and Frostbears have a breeding food', () => {
    expect(YOUNG_TYPES).toEqual(['buzzling', 'packhorn', 'gillnewt', 'dolphin', 'frostbear']);
    for (const k of YOUNG_TYPES) {
      expect(canBreed(MOBS[k]), k).toBe(true);
      for (const f of MOBS[k].food) expect(ITEMS[f], k).toBeTruthy();
    }
    expect(MOBS.buzzling.food).toEqual(expect.arrayContaining([B.SUNPETAL, B.REDBLOOM]));
    expect(MOBS.packhorn.food).toEqual(expect.arrayContaining([I.WHEAT, B.HAY_BALE]));
    expect(MOBS.gillnewt.food).toEqual([I.GLIMMERFIN]);
    expect(canBreed(MOBS.settler)).toBe(false);
    expect(canBreed(MOBS.silverfin)).toBe(false);
    expect(canBreed(null)).toBe(false);
  });

  it('a baby is half size, drops nothing, and grows up after 20 minutes', () => {
    for (const k of YOUNG_TYPES) {
      const { g } = fakeGame();
      const m = pet(k); m._game = g;
      const w = m.width, h = m.height;
      m.setBaby(true);
      expect(isYoung(m)).toBe(true);
      expect(m.baby).toBe(true);
      expect(m.age).toBe(-24000);
      expect(m.width).toBeCloseTo(w / 2); expect(m.height).toBeCloseTo(h / 2);
      m.lastHurtByPlayer = 100;
      m.die(g, 'player');
      expect(g.entities.spawnItem).not.toHaveBeenCalled();
      if (MOBS[k].drops.length) { // the adult would have dropped something
        const adult = pet(k); adult._game = g; adult.lastHurtByPlayer = 100;
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        adult.die(g, 'player');
        const dropped = g.entities.spawnItem.mock.calls.length;
        vi.restoreAllMocks();
        expect(dropped, k).toBeGreaterThan(0);
      }
      m.deathTime = 0; m.setBaby(true);
      m.age = -2;
      expect(growStep(m)).toBe(false);
      expect(growStep(m)).toBe(true);
      expect(m.baby).toBe(false);
      expect(m.width).toBeCloseTo(w); expect(m.height).toBeCloseTo(h);
      expect(isYoung(m)).toBe(false);
    }
  });

  it('growStep counts a parent cooldown down and never below zero', () => {
    const m = pet('dolphin'); m.age = 2;
    growStep(m); growStep(m); growStep(m);
    expect(m.age).toBe(0);
  });

  it('feeding puts an adult in love, feeding a baby speeds growing up (as for the farm animals)', () => {
    for (const k of YOUNG_TYPES) {
      const { g } = fakeGame();
      const m = pet(k); m._game = g;
      expect(m.feed(g)).toBe(true);
      expect(m.loveTicks).toBe(600);
      expect(m.feed(g)).toBe(false); // already in love
      const baby = pet(k); baby._game = g; baby.setBaby(true);
      expect(baby.feed(g)).toBe(true);
      expect(baby.age).toBe(-21600);
    }
  });

  it('two fed adults meet and have a baby that stays, the parents wait', () => {
    for (const k of YOUNG_TYPES) {
      const { g } = fakeGame();
      const a = pet(k, 0, 0), b = pet(k, 1, 0);
      a._game = b._game = g; g.entities.list.push(a, b);
      a.id = 1; b.id = 2;
      a.steer = vi.fn(); b.steer = vi.fn();
      a.feed(g); b.feed(g);
      let busy = 0;
      for (let t = 0; t < BREED_TIME + 5; t++) { g.ticks = t; if (breedStep(a, g)) busy++; breedStep(b, g); }
      expect(busy).toBeGreaterThan(BREED_TIME - 1);
      const baby = g.entities.list.find((e) => e !== a && e !== b);
      expect(baby, k).toBeTruthy();
      expect(baby.type).toBe(k);
      expect(baby.baby).toBe(true);
      expect(baby.persistent).toBe(true); // even the ambient kinds are kept
      expect(a.age).toBe(6000); expect(b.age).toBe(6000);
      expect(a.loveTicks).toBe(0);
      expect(g.entities.spawnXp).toHaveBeenCalled();
      expect(g.milestones.event).toHaveBeenCalledWith('breed');
    }
  });

  it('a lone fed animal waits without being busy and love runs out', () => {
    const { g } = fakeGame();
    const m = pet('buzzling'); m._game = g; g.entities.list.push(m);
    expect(breedStep(m, g)).toBe(false); // not in love
    m.feed(g);
    expect(breedStep(m, g)).toBe(false); // no partner
    expect(m.loveTicks).toBe(599);
  });

  it('flyers and swimmers close in by velocity, walkers steer', () => {
    const { g } = fakeGame();
    const bee = pet('buzzling', 0, 0); bee.steer = vi.fn();
    approach(bee, 3, 66, 0);
    expect(bee.body.vx).toBeGreaterThan(0); expect(bee.body.vy).toBeGreaterThan(0);
    expect(bee.steer).not.toHaveBeenCalled();
    const dolphin = pet('dolphin', 0, 0); dolphin.steer = vi.fn(); dolphin.body.inWater = true;
    approach(dolphin, 0, 64, -3);
    expect(dolphin.body.vz).toBeLessThan(0);
    expect(dolphin.steer).not.toHaveBeenCalled();
    const newtOnLand = pet('gillnewt', 0, 0); newtOnLand.steer = vi.fn(); newtOnLand.body.inWater = false;
    approach(newtOnLand, 3, 64, 0, 0.5);
    expect(newtOnLand.steer).toHaveBeenCalledWith(3, 0, 0.5);
    const horn = pet('packhorn', 0, 0); horn.steer = vi.fn();
    approach(horn, 0, 64, 4);
    expect(horn.steer).toHaveBeenCalled();
    expect(g).toBeTruthy();
  });

  it('their AIs run the growing and the mating', () => {
    const { g } = fakeGame();
    g.sky = { state: { aboveCount: 3 } };
    g.world = { getBlock: () => 0, getMeta: () => 0, heightAt: () => 64, biomeAt: () => 0, isLoaded: () => true, rainingAt: () => false, dimension: 'overworld' };
    const p = g.player;
    const bee = pet('buzzling'); bee._game = g; bee.setBaby(true); bee.age = -2;
    bee.beeAI(g, p, 3); bee.beeAI(g, p, 3);
    expect(bee.baby).toBe(false);
    const dol = pet('dolphin'); dol._game = g; dol.body.inWater = true; dol.setBaby(true); dol.age = -1;
    dol.dolphinAI(g, p, 3);
    expect(dol.baby).toBe(false);
    const dry = pet('dolphin'); dry._game = g; dry.setBaby(true); dry.age = -1;
    dry.dolphinAI(g, p, 3); // out of the water nothing grows
    expect(dry.baby).toBe(true);
    const newt = pet('gillnewt'); newt._game = g; newt.setBaby(true); newt.age = -1;
    newt.newtAI(g, p, 3);
    expect(newt.baby).toBe(false);
    const cub = pet('frostbear'); cub._game = g; cub.setBaby(true); cub.age = -1;
    cub.bearAI(g, p, 3);
    expect(cub.baby).toBe(false);
    // a fed bear cub-maker is busy with the partner instead of wandering
    const a = pet('frostbear', 0, 0), b = pet('frostbear', 2, 0);
    a._game = b._game = g; g.entities.list.push(a, b); a.steer = vi.fn(); a.wanderAI = vi.fn();
    a.feed(g); b.feed(g);
    a.bearAI(g, p, 3);
    expect(a.wanderAI).not.toHaveBeenCalled();
    expect(a.steer).toHaveBeenCalled();
  });
});

describe('baby and tame flags in the multiplayer snapshot', () => {
  it('babies of the new species and the new companions survive pack and unpack (layout unchanged)', () => {
    const { g } = fakeGame({ player: { netName: 'Ana' } });
    const baseLen = packMob(pet('mooxen')).length;
    for (const k of YOUNG_TYPES) {
      const m = pet(k); m.setBaby(true);
      const packed = JSON.parse(JSON.stringify(packMob(m)));
      expect(packed.length).toBe(baseLen);
      expect(packed.length).toBe(25);
      expect(unpackMob(packed)).toMatchObject({ type: k, baby: true, tamed: false });
      m.setBaby(false);
      expect(unpackMob(packMob(m)).baby).toBe(false);
    }
    for (const k of NEW_COMPANIONS) {
      const m = pet(k); m.tame(g); m.setBaby(true);
      expect(unpackMob(JSON.parse(JSON.stringify(packMob(m))))).toMatchObject({ type: k, tamed: true, sitting: true, baby: true });
      m.sitting = false;
      expect(unpackMob(packMob(m))).toMatchObject({ tamed: true, sitting: false });
    }
  });

  it('a baby is saved and loaded with its age', () => {
    for (const k of YOUNG_TYPES) {
      const m = pet(k); m.setBaby(true); m.age = -5000;
      const back = new Mob(k, 0, 64, 0); back.loadData(JSON.parse(JSON.stringify(m.saveData())));
      expect(back.baby).toBe(true);
      expect(back.age).toBe(-5000);
    }
  });
});
