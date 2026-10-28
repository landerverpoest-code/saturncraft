import { describe, it, expect, vi, afterEach } from 'vitest';
import { Mob } from '../src/mobs/mob.js';
import { MOBS, CATEGORY } from '../src/mobs/mobTypes.js';
import { MobSpawner } from '../src/mobs/spawner.js';
import {
  isCompanion, canTameWith, companionFoods, pickGift, nextGiftDelay, GIFTS, GIFT_DELAY, canFight, guardWants, pickFoe, mayCommand,
  companionAI, companionStrike, TAME_CHANCE, TELEPORT_DISTANCE, FOLLOW_DISTANCE, RAM_COOLDOWN,
} from '../src/mobs/companions.js';
import {
  babySpeedFactor, babyAttackFactor, babyHealth, babyExplosion, babyXp, babyLoot, hasBabyVariant, DEFAULT_BABY_SPEED, SHAMBLER_BABY_XP,
} from '../src/mobs/babies.js';
import { rollDrops } from '../src/mobs/drops.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { Interaction } from '../src/player/interaction.js';
import { I, ITEMS, TIPPED_ARROW, isArrow } from '../src/world/items.js';
import { rng } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

// ---- a small fake game -------------------------------------------------------------
function fakeGame({ list = [], player = {} } = {}) {
  const items = [];
  const g = {
    ticks: 0, time: 1000,
    entities: { list, spawnItem: vi.fn((x, y, z, st, vel) => { items.push({ x, y, z, st, vel }); }), spawnXp: vi.fn(), add: vi.fn((e) => { list.push(e); return e; }) },
    particles: { emit: vi.fn(), smoke: vi.fn() },
    audio: { play: vi.fn() },
    milestones: { event: vi.fn() },
    explode: vi.fn(),
    settings: {}, difficulty: 'normal',
    player: { x: 0, y: 64, z: 0, dead: false, creative: false, isPlayer: true, netName: undefined, stats: { kills: 0 }, body: { vx: 0, vz: 0 }, inventory: {}, ...player },
  };
  return { g, items };
}
const owner = (over = {}) => ({ x: 0, y: 64, z: 0, dead: false, isPlayer: true, ...over });
const pet = (type, x = 1, z = 0) => { const m = new Mob(type, x, 64, z); return m; };

describe('companion definitions', () => {
  it('Vixlings and Cragbucks are companions with their own taming items', () => {
    expect(isCompanion(MOBS.vixling)).toBe(true);
    expect(isCompanion(MOBS.cragbuck)).toBe(true);
    expect(isCompanion(MOBS.hopper)).toBe(false);
    expect(canTameWith(MOBS.vixling, I.SWEET_BERRIES)).toBe(true);
    expect(canTameWith(MOBS.vixling, I.GLOW_BERRIES)).toBe(true);
    expect(canTameWith(MOBS.vixling, I.APPLE)).toBe(false); // apples still only breed
    expect(canTameWith(MOBS.cragbuck, I.BREAD)).toBe(true);
    expect(canTameWith(MOBS.cragbuck, I.WHEAT)).toBe(false); // wheat still only breeds
    expect(canTameWith(MOBS.howler, I.BONE)).toBe(false); // Howlers keep their own rules
    for (const k of ['vixling', 'cragbuck']) {
      const d = MOBS[k];
      expect(d.tamedHealth).toBeGreaterThan(d.health);
      expect(d.tamedAttack).toBeGreaterThan(0);
      for (const t of d.companion.tameFood) { expect(ITEMS[t]).toBeTruthy(); expect(d.food).not.toContain(t); }
      expect(companionFoods(d)).toEqual(expect.arrayContaining([...d.food, ...d.companion.tameFood]));
    }
    expect(MOBS.vixling.companion.perk).toBe('forager');
    expect(MOBS.cragbuck.companion.perk).toBe('guard');
    expect(TAME_CHANCE).toBeCloseTo(1 / 3);
  });

  it('every gift is a real item and the table is weighted', () => {
    for (const [id, w] of GIFTS) { expect(ITEMS[id]).toBeTruthy(); expect(w).toBeGreaterThan(0); }
    expect(pickGift(() => 0)).toEqual({ id: GIFTS[0][0], count: 1 });
    expect(pickGift(() => 0.9999)).toEqual({ id: GIFTS[GIFTS.length - 1][0], count: 1 });
    const r = rng(7), seen = new Set();
    for (let i = 0; i < 400; i++) seen.add(pickGift(r).id);
    expect(seen.size).toBe(GIFTS.length);
    expect(nextGiftDelay(() => 0)).toBe(GIFT_DELAY[0]);
    expect(nextGiftDelay(() => 0.9999)).toBeLessThan(GIFT_DELAY[0] + GIFT_DELAY[1]);
  });
});

describe('who a companion fights', () => {
  const fox = pet('vixling'), goat = pet('cragbuck');
  const shambler = () => pet('shambler', 3, 0);
  it('never other pets, guards, settlers, bosses, Fizzlers, neutral or flying mobs, players or the dead', () => {
    expect(canFight(fox, shambler())).toBe(true);
    expect(canFight(fox, pet('skitterer', 2, 0))).toBe(true);
    expect(canFight(fox, pet('fizzler', 2, 0))).toBe(false);
    expect(canFight(fox, pet('voidwalker', 2, 0))).toBe(false);
    expect(canFight(fox, pet('settler', 2, 0))).toBe(false);
    expect(canFight(fox, pet('ironguard', 2, 0))).toBe(false);
    expect(canFight(fox, pet('flitter', 2, 0))).toBe(false);
    const friend = pet('howler', 2, 0); friend.tamed = true;
    expect(canFight(fox, friend)).toBe(false);
    const dead = shambler(); dead.deathTime = 3;
    expect(canFight(fox, dead)).toBe(false);
    expect(canFight(fox, owner())).toBe(false);
    expect(canFight(fox, fox)).toBe(false);
    expect(canFight(fox, null)).toBe(false);
  });
  it('the guard perk wants hostile mobs near both the owner and the goat only', () => {
    const o = owner();
    const near = pet('shambler', 5, 0), far = pet('shambler', 30, 0), cow = pet('mooxen', 3, 0);
    goat.body.setPos(2, 64, 0);
    expect(guardWants(goat, o, near)).toBe(true);
    expect(guardWants(goat, o, far)).toBe(false);
    expect(guardWants(goat, o, cow)).toBe(false); // passive
    const high = pet('shambler', 3, 0); high.body.setPos(3, 80, 0);
    expect(guardWants(goat, o, high)).toBe(false);
  });
  it('picks what hurt the owner, then what the owner hit, then (goat only) the nearest monster', () => {
    const o = owner(), a = pet('shambler', 4, 0), b = pet('skitterer', 3, 0), c = pet('shambler', 8, 0);
    goat.body.setPos(2, 64, 0); fox.body.setPos(2, 64, 0);
    expect(pickFoe(goat, { ...o, lastHurtBy: a, lastAttacked: b }, [a, b, c])).toBe(a);
    expect(pickFoe(goat, { ...o, lastHurtBy: null, lastAttacked: b }, [a, b, c])).toBe(b);
    expect(pickFoe(goat, o, [a, b, c])).toBe(b); // the nearest to the goat
    expect(pickFoe(fox, o, [a, b, c])).toBe(null); // a Vixling only fights back
    expect(pickFoe(fox, { ...o, lastAttacked: a }, [a])).toBe(a);
  });
  it('only the owner commands a pet', () => {
    expect(mayCommand({ ownerName: 'Ana' }, { netName: 'Ana' })).toBe(true);
    expect(mayCommand({ ownerName: 'Ana' }, { netName: 'Ben' })).toBe(false);
    expect(mayCommand({ ownerName: null }, { netName: 'Ben' })).toBe(true);
    expect(mayCommand({ ownerName: 'Ana' }, {})).toBe(true); // single player: no names
  });
});

describe('taming, saving and growing up', () => {
  it('tame() sits the pet down at its tame health, for the player who tamed it', () => {
    const { g } = fakeGame({ player: { netName: 'Ana' } });
    const m = pet('vixling'); m._game = g;
    m.tame(g);
    expect(m).toMatchObject({ tamed: true, sitting: true, ownerName: 'Ana', persistent: true });
    expect(m.health).toBe(MOBS.vixling.tamedHealth);
    expect(m.maxHealth).toBe(MOBS.vixling.tamedHealth);
    expect(g.milestones.event).toHaveBeenCalledWith('tame');
  });

  it('is saved and loaded with the owner, the sit state and the gift timer', () => {
    const { g } = fakeGame({ player: { netName: 'Ana' } });
    const m = pet('vixling'); m.tame(g); m.sitting = false; m.giftIn = 1234;
    const data = JSON.parse(JSON.stringify(m.saveData()));
    expect(data).toMatchObject({ tamed: true, sitting: false, ownerName: 'Ana', giftIn: 1234 });
    const back = new Mob('vixling', 0, 64, 0); back.loadData(data);
    expect(back).toMatchObject({ tamed: true, sitting: false, ownerName: 'Ana', giftIn: 1234 });
    expect(back.maxHealth).toBe(MOBS.vixling.tamedHealth);
    const goat = pet('cragbuck'); goat.tame(g);
    const gb = new Mob('cragbuck', 0, 64, 0); gb.loadData(JSON.parse(JSON.stringify(goat.saveData())));
    expect(gb).toMatchObject({ tamed: true, sitting: true, ownerName: 'Ana' });
    expect(gb.giftIn).toBeUndefined(); // only foragers keep a timer
    // a bad timer in an old or edited save is clamped, not trusted
    const odd = new Mob('vixling', 0, 64, 0); odd.loadData({ ...data, giftIn: 1e12 });
    expect(odd.giftIn).toBeLessThanOrEqual(GIFT_DELAY[0] + GIFT_DELAY[1]);
    const nan = new Mob('vixling', 0, 64, 0); nan.loadData({ ...data, giftIn: 'soon' });
    expect(nan.giftIn).toBeUndefined();
  });

  it('young of a tame pair are tame and keep the owner (also Howler pups)', () => {
    for (const type of ['vixling', 'cragbuck', 'howler']) {
      const { g } = fakeGame({ player: { netName: 'Ana' } });
      const a = pet(type, 0, 0), b = pet(type, 1, 0);
      g.spawner = { spawnMob: (t, x, y, z) => { const c = new Mob(t, x, y, z); c._game = g; g.entities.list.push(c); return c; } };
      a.tame(g); b.tame(g);
      a._game = g;
      a.breed(g, b);
      const baby = g.entities.list[g.entities.list.length - 1];
      expect(baby.baby).toBe(true);
      expect(baby).toMatchObject({ tamed: true, ownerName: 'Ana', persistent: true });
      expect(baby.health).toBe(MOBS[type].tamedHealth);
    }
  });
});

describe('right-clicking a companion', () => {
  const setup = (type, held, over = {}) => {
    const { g } = fakeGame({ player: { netName: 'Ana', creative: false, ...over } });
    const stack = held ? { id: held, count: 3, damage: 0 } : null;
    g.player.inventory = { selected: 0, get selectedStack() { return stack && stack.count > 0 ? stack : null; }, removeFromSlot(i, n) { stack.count -= n; } };
    const ia = Object.create(Interaction.prototype); ia.game = g; ia.swing = 0;
    const m = pet(type); m._game = g;
    return { g, ia, m, stack, click: () => ia.interactHowler(m, g.player.inventory.selectedStack, g.player.inventory.selectedStack && ITEMS[g.player.inventory.selectedStack.id]) };
  };

  it('taming takes the right item and succeeds 1 time in 3', () => {
    const win = setup('vixling', I.SWEET_BERRIES);
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    expect(win.click()).toBe(true);
    expect(win.m.tamed).toBe(true);
    expect(win.m.ownerName).toBe('Ana');
    expect(win.stack.count).toBe(2);

    const lose = setup('cragbuck', I.BREAD);
    Math.random.mockReturnValue(0.9);
    expect(lose.click()).toBe(true);
    expect(lose.m.tamed).toBe(false);
    expect(lose.stack.count).toBe(2);
    expect(lose.g.particles.smoke).toHaveBeenCalled();
  });

  it('the wrong item (including breeding food) and an angry or charging animal do nothing', () => {
    const apple = setup('vixling', I.APPLE);
    expect(apple.click()).toBe(false);
    expect(apple.stack.count).toBe(3);
    expect(setup('cragbuck', I.WHEAT).click()).toBe(false);
    expect(setup('vixling', null).click()).toBe(false);
    const ram = setup('cragbuck', I.BREAD); ram.m.ram = { target: 'player', ticks: 3 };
    expect(ram.click()).toBe(false);
    const chase = setup('vixling', I.SWEET_BERRIES); chase.m.target = 'player';
    expect(chase.click()).toBe(false);
  });

  it('a tame one sits and stands for its owner only, and takes its food', () => {
    const t = setup('vixling', null);
    t.m.tame(t.g); t.m.sitting = false;
    expect(t.click()).toBe(true);
    expect(t.m.sitting).toBe(true);
    expect(t.click()).toBe(true);
    expect(t.m.sitting).toBe(false);
    t.g.player.netName = 'Ben'; // somebody else
    expect(t.click()).toBe(false);
    expect(t.m.sitting).toBe(false);

    // heal with berries, then (full health) bread/wheat is no sit command
    const f = setup('cragbuck', I.WHEAT);
    f.m.tame(f.g); f.m.sitting = false; f.m.health = 10;
    expect(f.click()).toBe(true); // hurt: heals
    expect(f.m.health).toBeGreaterThan(10);
    f.m.health = f.m.maxHealth;
    expect(f.click()).toBe(true); // full: breeding food puts it in love
    expect(f.m.loveTicks).toBe(600);
    expect(f.m.sitting).toBe(false);
    expect(f.click()).toBe(false); // already in love: neither fed nor sat
    expect(f.m.sitting).toBe(false);
    expect(f.stack.count).toBe(1);
  });
});

describe('companion behaviour', () => {
  const tamed = (type, x = 1, z = 0) => {
    const { g, items } = fakeGame();
    const m = pet(type, x, z); m._game = g;
    m.tame(g); m.sitting = false;
    m.chase = vi.fn(); m.wanderAI = vi.fn(); m.steer = vi.fn(); m.teleportTo = vi.fn(() => true);
    return { g, items, m };
  };
  const run = (m, g, p) => companionAI(m, g, p, Math.hypot(p.x - m.x, p.y - m.y, p.z - m.z));

  it('sits still while told to, and drops its fight', () => {
    const { g, m } = tamed('vixling', 2, 0);
    m.sitting = true; m.enemy = pet('shambler');
    run(m, g, owner({ x: 30, z: 0 }));
    expect(m.enemy).toBe(null);
    expect(m.chase).not.toHaveBeenCalled();
    expect(m.teleportTo).not.toHaveBeenCalled();
  });

  it('follows from afar and jumps to its owner beyond 12 blocks', () => {
    const { g, m } = tamed('vixling', 8, 0);
    run(m, g, owner());
    expect(m.chase).toHaveBeenCalledTimes(1); // 8 > 6: walks
    expect(FOLLOW_DISTANCE).toBe(6);
    const far = tamed('cragbuck', 20, 0);
    run(far.m, far.g, owner());
    expect(far.m.teleportTo).toHaveBeenCalled();
    expect(far.m.chase).not.toHaveBeenCalled();
    expect(TELEPORT_DISTANCE).toBe(12);
    const near = tamed('cragbuck', 3, 0);
    run(near.m, near.g, owner());
    expect(near.m.chase).not.toHaveBeenCalled();
    expect(near.m.wanderAI).toHaveBeenCalled();
  });

  it('a Vixling bites and a Cragbuck rams what threatens the owner', () => {
    const { g, m } = tamed('vixling', 1, 0);
    const foe = pet('shambler', 1.5, 0); foe.hurt = vi.fn();
    g.entities.list.push(foe);
    g.ticks = m.id % 10; // it looks about every tenth tick
    run(m, g, owner({ lastHurtBy: foe }));
    expect(m.enemy).toBe(foe);
    expect(m.chase).toHaveBeenCalledWith(g, foe, expect.any(Number));
    expect(foe.hurt).toHaveBeenCalledWith(MOBS.vixling.tamedAttack, 'mob:Vixling', m, 0.4); // in reach: bites
  });

  it('strikes in reach with its tamed damage, half as hard as a baby, and waits between blows', () => {
    const { g, m } = tamed('cragbuck', 1, 0);
    const foe = pet('shambler', 1.6, 0); foe.hurt = vi.fn();
    expect(companionStrike(m, g, foe)).toBe(true);
    expect(foe.hurt).toHaveBeenCalledWith(MOBS.cragbuck.tamedAttack, 'mob:Cragbuck', m, expect.any(Number));
    expect(foe.hurt.mock.calls[0][3]).toBeGreaterThan(0.4); // a ram shoves harder than a bite
    expect(m.attackCooldown).toBe(RAM_COOLDOWN);
    expect(companionStrike(m, g, foe)).toBe(false);
    const far = pet('shambler', 9, 0); far.hurt = vi.fn();
    m.attackCooldown = 0;
    expect(companionStrike(m, g, far)).toBe(false);
    const fox = tamed('vixling', 1, 0);
    const prey = pet('shambler', 1.5, 0); prey.hurt = vi.fn();
    fox.m.setBaby(true);
    expect(companionStrike(fox.m, fox.g, prey)).toBe(true);
    expect(prey.hurt.mock.calls[0][0]).toBe(MOBS.vixling.tamedAttack / 2);
  });

  it('a Cragbuck guards on its own, a Vixling does not go looking for a fight', () => {
    const goat = tamed('cragbuck', 1, 0);
    const z1 = pet('shambler', 4, 0), z2 = pet('mooxen', 3, 0);
    goat.g.entities.list.push(z1, z2);
    goat.g.ticks = goat.m.id % 10; // the look happens every tenth tick
    run(goat.m, goat.g, owner());
    expect(goat.m.enemy).toBe(z1);
    expect(goat.m.chase).toHaveBeenCalledWith(goat.g, z1, expect.any(Number));
    expect(goat.m.headPitch).toBeGreaterThan(0); // head down
    const fox = tamed('vixling', 1, 0);
    fox.g.entities.list.push(pet('shambler', 4, 0));
    fox.g.ticks = fox.m.id % 10;
    run(fox.m, fox.g, owner());
    expect(fox.m.enemy).toBe(null);
  });

  it('a hurt tame companion stands up and fights back at mobs, not at its owner or other pets', () => {
    const { g, m } = tamed('vixling');
    m.sitting = true;
    const foe = pet('shambler', 2, 0);
    m.hurt(1, 'mob:Shambler', foe);
    expect(m.sitting).toBe(false);
    expect(m.enemy).toBe(foe);
    const m2 = tamed('cragbuck').m;
    m2.hurt(1, 'player', { isPlayer: true, x: 0, z: 0, kind: 'player' });
    expect(m2.enemy).toBe(null);
    const friend = pet('howler'); friend.tamed = true;
    m2.hurt(1, 'mob:Howler', friend);
    expect(m2.enemy).toBe(null);
  });

  it('a Vixling digs up a gift after its timer, near its owner, and never while sitting or far away', () => {
    const { g, items, m } = tamed('vixling', 1, 0);
    m.body.onGround = true;
    m.giftIn = 2;
    run(m, g, owner());
    expect(items.length).toBe(0);
    run(m, g, owner());
    expect(items.length).toBe(1);
    expect(items[0].st.count).toBe(1);
    expect(GIFTS.map(([id]) => id)).toContain(items[0].st.id);
    expect(items[0].vel[0]).toBeLessThan(0); // tossed towards the owner (at x = 0)
    expect(m.giftIn).toBeGreaterThanOrEqual(GIFT_DELAY[0]);
    m.giftIn = 1;
    run(m, g, owner({ x: 40 })); // too far: it runs after the owner instead
    expect(items.length).toBe(1);
    const goat = tamed('cragbuck', 1, 0);
    goat.m.body.onGround = true; goat.m.giftIn = 1;
    run(goat.m, goat.g, owner());
    expect(goat.items.length).toBe(0); // goats have no gifts
  });
});

describe('multiplayer snapshots', () => {
  it('carry tamed, sitting and baby for the new companions (host-authoritative, 24 fields as before)', () => {
    const { g } = fakeGame({ player: { netName: 'Ana' } });
    for (const type of ['vixling', 'cragbuck']) {
      const m = pet(type); m.tame(g); m.setBaby(true);
      const packed = JSON.parse(JSON.stringify(packMob(m)));
      expect(packed.length).toBe(24);
      expect(unpackMob(packed)).toMatchObject({ type, tamed: true, sitting: true, baby: true });
      m.setBaby(false); m.sitting = false;
      expect(unpackMob(JSON.parse(JSON.stringify(packMob(m))))).toMatchObject({ tamed: true, sitting: false, baby: false });
    }
  });
  it('baby hostile variants are marked as babies for guests too', () => {
    for (const type of ['skitterer', 'fizzler', 'cinder_brute']) {
      const m = pet(type); m.setBaby(true);
      expect(unpackMob(packMob(m)).baby).toBe(true);
    }
  });
});

describe('baby hostile variants', () => {
  it('spiderlings, Fizzlets and Brute cubs exist; skeletons, illagers and witches have no babies', () => {
    for (const k of ['skitterer', 'fizzler', 'cinder_brute']) {
      expect(hasBabyVariant(MOBS[k])).toBe(true);
      expect(MOBS[k].babyChance).toBeGreaterThan(0);
      expect(MOBS[k].babyChance).toBeLessThanOrEqual(0.1);
      expect(MOBS[k].category).toBe(CATEGORY.MONSTER);
    }
    for (const k of ['rattler', 'rime_rattler', 'hexwife', 'marauder', 'voidwalker', 'wobbler', 'ashwraith', 'ember_lord', 'shambler']) expect(hasBabyVariant(MOBS[k])).toBe(false);
    expect(MOBS.shambler.babyChance).toBe(0.05); // Shambler-kin unchanged
  });

  it('are half size, faster and weaker', () => {
    const adult = pet('skitterer'), baby = pet('skitterer'); baby.setBaby(true);
    expect(baby.width).toBeCloseTo(adult.width / 2);
    expect(baby.height).toBeCloseTo(adult.height / 2);
    expect(baby.speed()).toBeCloseTo(adult.speed() * 1.35);
    expect(adult.attackDamage()).toBe(2);
    expect(baby.attackDamage()).toBe(1);
    const cub = pet('cinder_brute'), brute = pet('cinder_brute'); cub.setBaby(true);
    expect(cub.speed()).toBeCloseTo(brute.speed() * 1.4);
    expect(cub.attackDamage()).toBeCloseTo(3);
    expect(brute.attackDamage()).toBe(5);
    // Shambler-kin keep half again as fast, at full strength
    const sb = pet('shambler'), sa = pet('shambler'); sb.setBaby(true);
    expect(sb.speed()).toBeCloseTo(sa.speed() * DEFAULT_BABY_SPEED);
    expect(sb.attackDamage()).toBe(sa.attackDamage());
  });

  it('spawn with less health, and heal no further than that', () => {
    expect(babyHealth(MOBS.skitterer)).toBe(8);
    expect(babyHealth(MOBS.cinder_brute)).toBe(12);
    expect(babyHealth(MOBS.fizzler)).toBe(10);
    expect(babyHealth(MOBS.shambler)).toBe(20); // no stats: unchanged
    const game = fakeGame().g;
    const sp = new MobSpawner(game);
    vi.spyOn(Math, 'random').mockReturnValue(0.001); // always under the baby chance
    const baby = sp.spawnMob('skitterer', 0, 64, 0);
    expect(baby.baby).toBe(true);
    expect(baby.health).toBe(8);
    expect(baby.maxHealth).toBe(8);
    Math.random.mockReturnValue(0.99);
    const adult = sp.spawnMob('skitterer', 0, 64, 0);
    expect(adult.baby).toBe(false);
    expect(adult.health).toBe(16);
    expect(adult.maxHealth).toBe(16);
  });

  it('a baby Fizzler goes off with half the blast radius', () => {
    expect(babyExplosion(MOBS.fizzler, true)).toBe(1.5);
    expect(babyExplosion(MOBS.fizzler, false)).toBe(3);
    for (const [baby, power] of [[true, 1.5], [false, 3]]) {
      const { g } = fakeGame();
      const m = pet('fizzler', 0, 0); m._game = g;
      if (baby) m.setBaby(true);
      m.canSee = () => true;
      m.fuse = MOBS.fizzler.fuse - 1;
      const p = { x: 1, y: 64, z: 0, dead: false, creative: false, eyeHeight: 1.6, body: { height: 1.8 } };
      m.target = 'player';
      m.fizzlerAI(g, p, 1);
      expect(g.explode).toHaveBeenCalledTimes(1);
      expect(g.explode.mock.calls[0][3]).toBe(power);
      expect(m.dead).toBe(true);
    }
  });

  it('leave less loot and less experience', () => {
    const stacks = [{ id: I.STRING, count: 2 }, { id: I.SPIDER_EYE, count: 1 }, { id: I.GUNPOWDER, count: 3 }];
    expect(babyLoot(stacks, 'half')).toEqual([{ id: I.STRING, count: 1 }, { id: I.GUNPOWDER, count: 1 }]);
    expect(babyLoot(stacks, 'none')).toEqual([]);
    expect(babyLoot(stacks, undefined)).toBe(stacks);
    expect(babyXp(MOBS.skitterer)).toBe(3);
    expect(babyXp(MOBS.cinder_brute)).toBe(4);
    expect(babyXp(MOBS.shambler)).toBe(SHAMBLER_BABY_XP);
    expect(babySpeedFactor(MOBS.fizzler)).toBe(1.4);
    expect(babyAttackFactor(MOBS.fizzler)).toBe(1);

    const run = (type, baby) => {
      const { g, items } = fakeGame();
      const m = pet(type); m._game = g;
      if (baby) m.setBaby(true);
      m.lastHurtByPlayer = 50;
      vi.spyOn(Math, 'random').mockReturnValue(0.999); // the biggest roll of every drop
      m.die(g, 'player');
      vi.restoreAllMocks();
      return items.map((i) => i.st);
    };
    const adultLoot = run('skitterer', false), babyLoot1 = run('skitterer', true);
    expect(adultLoot.find((s) => s.id === I.STRING).count).toBe(2);
    expect(babyLoot1.find((s) => s.id === I.STRING).count).toBe(1);
    expect(babyLoot1.find((s) => s.id === I.SPIDER_EYE)).toBeUndefined();
    expect(run('fizzler', true).find((s) => s.id === I.GUNPOWDER).count).toBe(1);
    expect(run('cinder_brute', false).length).toBeGreaterThan(0);
    expect(run('cinder_brute', true)).toEqual([]);
    // a Shambler baby still drops as before
    expect(run('shambler', true).find((s) => s.id === I.ROTTEN_FLESH).count).toBe(2);
  });

  it('grow no older: a loaded baby stays a baby', () => {
    const m = pet('fizzler'); m.setBaby(true);
    const back = new Mob('fizzler', 0, 64, 0); back.loadData(JSON.parse(JSON.stringify(m.saveData())));
    expect(back.baby).toBe(true);
    expect(back.width).toBeCloseTo(m.width);
  });
});

describe('tipped arrows from Rime Rattlers', () => {
  it('drop 0-1 Arrows of Slowness on a player kill, never otherwise, plain Rattlers never', () => {
    const slow = TIPPED_ARROW.slowness;
    expect(slow).toBeTruthy();
    expect(isArrow(slow)).toBe(true);
    expect(ITEMS[slow].tipped).toBe('slowness');
    const count = (type, ctx, r) => rollDrops(type, ctx, r).filter((d) => d.id === slow).reduce((a, d) => a + d.count, 0);
    expect(count('rime_rattler', { killedByPlayer: true }, () => 0.99)).toBe(1);
    expect(count('rime_rattler', { killedByPlayer: true }, () => 0)).toBe(0);
    expect(count('rime_rattler', { killedByPlayer: false }, () => 0.99)).toBe(0);
    expect(count('rattler', { killedByPlayer: true }, () => 0.99)).toBe(0);
    // plain loot is unchanged, and about half the kills give a tipped arrow
    const r = rng(11);
    let n = 0;
    for (let i = 0; i < 1000; i++) n += count('rime_rattler', { killedByPlayer: true }, r);
    expect(n / 1000).toBeGreaterThan(0.42);
    expect(n / 1000).toBeLessThan(0.58);
    expect(rollDrops('rime_rattler', { killedByPlayer: true }, () => 0.99).map((d) => d.id)).toEqual(expect.arrayContaining([I.ARROW, I.BONE]));
    expect(MOBS.rattler.drops.some((d) => d.id === slow)).toBe(false);
  });
});
