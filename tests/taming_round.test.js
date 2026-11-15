import { describe, it, expect, vi, afterEach } from 'vitest';
import { Mob } from '../src/mobs/mob.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import '../src/mobs/fauna.js';
import { isCompanion, canTameWith, companionAI, companionSave, companionLoad, pickFoe, TAME_CHANCE } from '../src/mobs/companions.js';
import {
  DIG_DELAY, DIG_FINDS, nextDigDelay, pickDig, digReady, isCollectable, pickCollectTarget, COLLECT_RANGE, KEEP_OFF_OWNER,
  pickPest, findBedNear, isNightLight, lynxLuredBy,
} from '../src/mobs/tamingRound.js';
import { guestWantsMount, driverRefusal, mountReady } from '../src/mobs/mounts.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { I } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';
import { entriesOf } from '../src/player/fieldGuideEntries.js';

afterEach(() => vi.restoreAllMocks());

function fakeGame({ list = [] } = {}) {
  const items = [];
  const g = {
    ticks: 0,
    entities: { list, spawnItem: vi.fn((x, y, z, st, vel) => { const e = { kind: 'item', x, y, z, stack: st, vel }; items.push(e); return e; }) },
    particles: { emit: vi.fn(), smoke: vi.fn() },
    audio: { play: vi.fn() },
    milestones: { event: vi.fn() },
    sky: { state: { combined: 0.2 } },
    world: { getBlock: () => 0 },
    player: { x: 0, y: 64, z: 0, dead: false, isPlayer: true, netName: undefined, inventory: { selectedStack: null } },
  };
  return { g, items };
}
const pet = (type, x = 1, z = 0) => { const m = new Mob(type, x, 64, z); return m; };

describe('taming round: definitions', () => {
  it('Gloamlynx, Dustmole and Tarnling are companions won over by their own food', () => {
    for (const [k, perk, food] of [['gloamlynx', 'pouncer', I.RAW_REDFIN], ['dustmole', 'digger', I.CARROT], ['tarnling', 'collector', I.IRON_NUGGET]]) {
      const d = MOBS[k];
      expect(isCompanion(d)).toBe(true);
      expect(d.companion.perk).toBe(perk);
      expect(canTameWith(d, food)).toBe(true);
      expect(d.tamedHealth).toBeGreaterThan(d.health);
    }
    expect(canTameWith(MOBS.gloamlynx, I.RAW_SILVERFIN)).toBe(true);
    expect(canTameWith(MOBS.gloamlynx, I.BREAD)).toBe(false);
    expect(canTameWith(MOBS.dustmole, I.BEETROOT)).toBe(true);
    expect(canTameWith(MOBS.tarnling, I.GOLD_NUGGET)).toBe(true);
    expect(canTameWith(MOBS.tarnling, I.IRON_INGOT)).toBe(false);
    expect(TAME_CHANCE).toBeCloseTo(1 / 3);
    expect(MOBS.gloamlynx.tamedAttack).toBe(3);
  });

  it('the Thistlehorn is tamed with wheat on top of its old food, and wheat does not breed it', () => {
    const d = MOBS.thistlehorn;
    expect(d.mount.tameFood).toContain(I.WHEAT);
    expect(d.food).not.toContain(I.WHEAT);
    expect(d.food).toContain(I.BEETROOT);
  });

  it('a tame Thistlehorn needs a harness and a saddle before it takes a rider', () => {
    const m = pet('thistlehorn');
    expect(driverRefusal(m)).toBe('wild');
    m.tamed = true;
    expect(driverRefusal(m)).toBe('needs tack');
    expect(guestWantsMount(m, { riding: null, sneaking: false }, null)).toBe(false);
    m.saddled = true;
    expect(mountReady(m)).toBe(false); // no harness yet
    m.equip = { hand: null, armor: [{ id: I.THISTLE_HARNESS, count: 1, damage: 0 }, null, null, null] };
    expect(mountReady(m)).toBe(true);
    expect(driverRefusal(m)).toBe(null);
    expect(guestWantsMount(m, { riding: null, sneaking: false }, null)).toBe(true);
  });
});

describe('taming round: Dustmole dig timer', () => {
  it('the delay is 4 to 6 minutes', () => {
    expect(DIG_DELAY[0]).toBe(4 * 60 * 20);
    expect(DIG_DELAY[0] + DIG_DELAY[1]).toBe(6 * 60 * 20);
    expect(nextDigDelay(() => 0)).toBe(4800);
    expect(nextDigDelay(() => 0.999)).toBeLessThanOrEqual(7200);
  });
  it('a find needs the timer run out, the owner near, the mole on the ground and grown', () => {
    const ok = { ownerDist: 3, onGround: true, baby: false };
    expect(digReady(0, ok)).toBe(true);
    expect(digReady(5, ok)).toBe(false);
    expect(digReady(0, { ...ok, ownerDist: 20 })).toBe(false);
    expect(digReady(0, { ...ok, onGround: false })).toBe(false);
    expect(digReady(0, { ...ok, baby: true })).toBe(false);
  });
  it('finds are dirt-class drops or a rare seed', () => {
    const ids = new Set(DIG_FINDS.map(([id]) => id));
    expect(ids.has(B.DIRT) && ids.has(B.SAND) && ids.has(B.GRAVEL)).toBe(true);
    expect(pickDig(() => 0).id).toBe(B.DIRT);
    for (let i = 0; i < 50; i++) expect(ids.has(pickDig(Math.random).id)).toBe(true);
  });
  it('a tame mole near its owner digs once the timer runs out and tosses the find out', () => {
    const { g, items } = fakeGame();
    const m = pet('dustmole'); m.tamed = true; m.sitting = false; m.digIn = 2; m.body.onGround = true;
    const p = { x: 0, y: 64, z: 0, dead: false, isPlayer: true };
    for (let i = 0; i < 3; i++) companionAI(m, g, p, 1);
    expect(items.length).toBe(1);
    expect(m.digIn).toBeGreaterThanOrEqual(DIG_DELAY[0]);
    companionAI(m, g, p, 1);
    expect(items.length).toBe(1);
  });
  it('a sitting mole does not dig', () => {
    const { g, items } = fakeGame();
    const m = pet('dustmole'); m.tamed = true; m.sitting = true; m.digIn = 0; m.body.onGround = true;
    companionAI(m, g, { x: 0, y: 64, z: 0, dead: false, isPlayer: true }, 1);
    expect(items.length).toBe(0);
  });
});

describe('taming round: Tarnling collect rule', () => {
  const item = (id, x, z, over = {}) => ({ kind: 'item', x, y: 64, z, dead: false, stack: { id, count: 2 }, ...over });
  const owner = { x: 0, y: 64, z: 0 };
  it('only metal and ore kinds are collectable', () => {
    for (const id of [I.RAW_IRON, I.IRON_NUGGET, I.GOLD_INGOT, I.COAL, I.DIAMOND]) expect(isCollectable(id)).toBe(true);
    for (const id of [I.APPLE, B.DIRT, I.FLINT, I.BONE]) expect(isCollectable(id)).toBe(false);
  });
  it('picks the nearest collectable item within 8 blocks, leaving what is beside the owner', () => {
    const self = { x: 10, y: 64, z: 0 };
    const near = item(I.RAW_GOLD, 14, 0), far = item(I.RAW_IRON, 10 + COLLECT_RANGE + 1, 0), junk = item(I.APPLE, 11, 0), beside = item(I.IRON_NUGGET, 1, 1);
    expect(beside.x).toBeLessThan(KEEP_OFF_OWNER);
    expect(pickCollectTarget(self, owner, [far, junk, beside, near])).toBe(near);
    expect(pickCollectTarget(self, owner, [far, junk, beside])).toBe(null);
    expect(pickCollectTarget(self, owner, [item(I.COAL, 12, 0, { dead: true })])).toBe(null);
    expect(pickCollectTarget(self, owner, [item(I.COAL, 12, 0, { noFetch: true })])).toBe(null); // its own delivery
  });
  it('a Tarnling picks the item up, carries it to its owner and drops it there', () => {
    const t = item(I.IRON_INGOT, 5, 0);
    const { g, items } = fakeGame({ list: [t] });
    const m = pet('tarnling', 4, 0); m.tamed = true; m.sitting = false;
    m.chase = vi.fn();
    const p = { x: 0, y: 64, z: 0, dead: false, isPlayer: true };
    g.ticks = m.id % 10; // the scan tick
    companionAI(m, g, p, 4);
    expect(m.fetch).toBe(t);
    companionAI(m, g, p, 4); // within reach: it picks the stack up
    expect(t.dead).toBe(true);
    expect(m.carry).toMatchObject({ id: I.IRON_INGOT, count: 2 });
    m.body.setPos(1, 64, 0);
    companionAI(m, g, p, 1); // beside the owner: it drops it
    expect(m.carry).toBe(null);
    expect(items.length).toBe(1);
    expect(items[0].stack.id).toBe(I.IRON_INGOT);
    expect(items[0].noFetch).toBe(true);
  });
});

describe('taming round: Gloamlynx rules', () => {
  it('goes for the nearest Stone Mite, otherwise for nothing but what hurt its owner', () => {
    const lynx = pet('gloamlynx', 0, 0); lynx.tamed = true;
    const mite = (x) => { const e = pet('stone_mite', x, 0); e.kind = 'mob'; return e; };
    const a = mite(6), b = mite(3), far = mite(40);
    expect(pickPest(lynx, [a, far, b])).toBe(b);
    expect(pickPest(lynx, [far])).toBe(null);
    const owner = { x: 0, y: 64, z: 0, isPlayer: true, lastHurtBy: null, lastAttacked: null };
    expect(pickFoe(lynx, owner, [a, b], () => true)).toBe(b);
    expect(pickFoe(lynx, owner, [], () => true)).toBe(null);
    const zomb = pet('shambler', 2, 0); // an ordinary monster is no pest, but is fought when it hurts the owner
    expect(pickFoe(lynx, owner, [zomb], () => true)).toBe(null);
    owner.lastHurtBy = zomb;
    expect(pickFoe(lynx, owner, [zomb], () => true)).toBe(zomb);
  });
  it('knows night, a bed beside its owner, and what lures a wild one', () => {
    expect(isNightLight(0.2)).toBe(true);
    expect(isNightLight(0.9)).toBe(false);
    const bed = findBedNear((x, y, z) => (x === 3 && y === 64 && z === -2 ? B.BED : 0), { x: 0.5, y: 64, z: 0.5 });
    expect(bed).toMatchObject({ x: 3.5, z: -1.5 });
    expect(findBedNear(() => 0, { x: 0, y: 64, z: 0 })).toBe(null);
    expect(lynxLuredBy(I.RAW_SILVERFIN)).toBe(true);
    expect(lynxLuredBy(I.TORCH)).toBe(false);
  });
  it('a tame Gloamlynx at night walks to the bed of its owner and rests there', () => {
    const { g } = fakeGame();
    g.world.getBlock = (x, y, z) => (x === 2 && y === 64 && z === 0 ? B.BED : 0);
    const m = pet('gloamlynx', 5, 0); m.tamed = true; m.sitting = false; m.steer = vi.fn();
    companionAI(m, g, { x: 0, y: 64, z: 0, dead: false, isPlayer: true }, 5);
    expect(m.steer).toHaveBeenCalled();
    m.steer.mockClear(); m.body.setPos(2.5, 64, 0.5);
    companionAI(m, g, { x: 0, y: 64, z: 0, dead: false, isPlayer: true }, 2.5);
    expect(m.steer).not.toHaveBeenCalled(); // settled
  });
});

describe('taming round: save, snapshot and field guide', () => {
  it('owner, sit state, the dig timer and a carried stack survive a save', () => {
    for (const type of ['gloamlynx', 'dustmole', 'tarnling']) {
      const m = pet(type); m.tamed = true; m.sitting = true; m.ownerName = 'Ana';
      if (type === 'dustmole') m.digIn = 1234;
      if (type === 'tarnling') m.carry = { id: I.GOLD_NUGGET, count: 5, damage: 0 };
      const s = JSON.parse(JSON.stringify(m.saveData()));
      expect(s).toMatchObject({ type, tamed: true, sitting: true, ownerName: 'Ana' });
      const r = pet(type); r.loadData(s);
      expect(r.tamed).toBe(true); expect(r.sitting).toBe(true); expect(r.ownerName).toBe('Ana');
      if (type === 'dustmole') expect(r.digIn).toBe(1234);
      if (type === 'tarnling') expect(r.carry).toEqual({ id: I.GOLD_NUGGET, count: 5, damage: 0 });
    }
  });
  it('a corrupt timer or stack loads clamped or ignored', () => {
    const m = pet('dustmole');
    companionLoad(m, { digIn: 9e9 }); expect(m.digIn).toBeLessThanOrEqual(7200);
    const t = pet('tarnling');
    companionLoad(t, { carry: { id: 'x', count: 3 } }); expect(t.carry).toBeFalsy();
    expect(companionSave(pet('dustmole'))).toEqual({});
  });
  it('the tamed and sitting flags travel in the mob snapshot', () => {
    for (const type of ['gloamlynx', 'dustmole', 'tarnling', 'thistlehorn']) {
      const m = pet(type); m.tamed = true; m.sitting = true;
      expect(unpackMob(JSON.parse(JSON.stringify(packMob(m))))).toMatchObject({ type, tamed: true, sitting: true });
    }
  });
  it('the Field Guide lists what tames them', () => {
    const list = entriesOf('creatures');
    for (const k of ['gloamlynx', 'dustmole', 'tarnling', 'thistlehorn']) {
      const e = list.find((x) => x.key === k);
      expect(e && e.tames.length).toBeGreaterThan(0);
    }
    expect(list.find((x) => x.key === 'thistlehorn').tames.length).toBe(3);
  });
});
