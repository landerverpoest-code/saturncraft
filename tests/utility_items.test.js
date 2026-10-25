import { describe, it, expect } from 'vitest';
import { I, ITEMS } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';
import { leashState, leashPull, canLeash, isFencePost, catenaryPoints, ropeLength, leashSaveData, leashTick, LeashKnot, LEAD_SLACK, LEAD_PULL, LEAD_SNAP } from '../src/entities/leash.js';
import { itemWeight, bundleWeight, bundleRoom, bundleInsert, bundleTakeLast, bundleFill, BUNDLE_CAPACITY } from '../src/world/bundles.js';
import { nameMob, canName, nameVisible, NAME_RANGE } from '../src/mobs/names.js';
import { withExtras, canStack, cleanLabel, cleanBundle } from '../src/world/enchantments.js';
import { Mob } from '../src/mobs/mob.js';
import { RECIPES } from '../src/player/crafting.js';
import { dungeonLoot, LOOT } from '../src/mobs/spawnerBlocks.js';
import { rng } from './helpers.js';

describe('lead distance rules', () => {
  it('is slack close by, follows, pulls past 6 and snaps past 12', () => {
    expect(leashState(1)).toBe('slack');
    expect(leashState(LEAD_SLACK)).toBe('slack');
    expect(leashState(4)).toBe('follow');
    expect(leashState(LEAD_PULL)).toBe('follow');
    expect(leashState(7)).toBe('pull');
    expect(leashState(LEAD_SNAP)).toBe('pull');
    expect(leashState(12.01)).toBe('snap');
  });
  it('pulls harder the further the mob strays, and not at all before 6 blocks', () => {
    expect(leashPull(3)).toBe(0);
    expect(leashPull(6)).toBe(0);
    expect(leashPull(7)).toBeGreaterThan(0);
    expect(leashPull(10)).toBeGreaterThan(leashPull(8));
    expect(leashPull(13)).toBe(0); // snapped
    expect(leashPull(11.9)).toBeLessThanOrEqual(0.3);
  });
  it('only animals take a lead; fences are posts', () => {
    expect(canLeash(new Mob('fleecer', 0, 64, 0))).toBe(true);
    expect(canLeash(new Mob('shambler', 0, 64, 0))).toBe(false);
    expect(canLeash(new Mob('settler', 0, 64, 0))).toBe(false);
    expect(isFencePost(B.OAK_FENCE)).toBe(true);
    expect(isFencePost(B.MANGROVE_FENCE)).toBe(true);
    expect(isFencePost(B.OAK_PLANKS)).toBe(false);
  });
  it('a sagging rope is a catenary that meets both ends and hangs below them', () => {
    const d = 4, pts = catenaryPoints(0, 70, 0, 4, 70, 0, ropeLength(d), 16);
    expect(pts[0]).toBeCloseTo(0); expect(pts[1]).toBeCloseTo(70); expect(pts[48]).toBeCloseTo(4); expect(pts[49]).toBeCloseTo(70);
    const mid = pts[8 * 3 + 1];
    expect(mid).toBeLessThan(70);
    // its length matches the rope length
    let len = 0;
    for (let k = 1; k <= 16; k++) len += Math.hypot(pts[k * 3] - pts[k * 3 - 3], pts[k * 3 + 1] - pts[k * 3 - 2], pts[k * 3 + 2] - pts[k * 3 - 1]);
    expect(len).toBeCloseTo(ropeLength(d), 1);
    // a stretched lead is nearly straight
    const taut = catenaryPoints(0, 70, 0, 11, 72, 0, ropeLength(11), 16);
    expect(Math.abs(taut[8 * 3 + 1] - 71)).toBeLessThan(0.5);
    // between two heights it still ends exactly
    const slope = catenaryPoints(0, 65, 0, 3, 67, 4, ropeLength(5.4), 16);
    expect(slope[16 * 3 + 1]).toBeCloseTo(67);
    expect(slope.every(Number.isFinite)).toBe(true);
  });

  function fakeGame(px, pz, fence = null) {
    const list = [], drops = [];
    const player = { x: px, y: 64, z: pz, dead: false, isPlayer: true };
    return {
      player, drops,
      world: { getBlock: (x, y, z) => (fence && x === fence[0] && y === fence[1] && z === fence[2] ? B.OAK_FENCE : B.AIR) },
      entities: { list, add(e) { list.push(e); return e; }, spawnItem(x, y, z, st) { drops.push(st); } },
      audio: { play() {} },
    };
  }
  it('saves who holds the lead and finds the holder again on load', () => {
    const g = fakeGame(2, 0);
    const m = new Mob('fleecer', 0, 64, 0);
    g.entities.list.push(m);
    m.leashHolder = g.player;
    const saved = JSON.parse(JSON.stringify(m.saveData()));
    expect(saved.leash).toEqual({ player: true });
    const back = new Mob('fleecer', saved.x, saved.y, saved.z);
    back.loadData(saved);
    expect(back.leashPending).toBeTruthy();
    leashTick(g, back);
    expect(back.leashHolder).toBe(g.player);
    expect(g.drops.length).toBe(0);
  });
  it('a lead saved far from the player snaps and drops', () => {
    const g = fakeGame(40, 0);
    const back = new Mob('fleecer', 0, 64, 0);
    back.loadData({ ...new Mob('fleecer', 0, 64, 0).saveData(), leash: { player: true } });
    leashTick(g, back);
    expect(back.leashHolder).toBe(null);
    expect(g.drops).toEqual([{ id: I.LEAD, count: 1, damage: 0 }]);
  });
  it('a mob tied to a fence knot is tied there again after loading', () => {
    const g = fakeGame(0, 0, [3, 64, 3]);
    const m = new Mob('mooxen', 2, 64, 2);
    m.leashHolder = new LeashKnot(3, 64, 3);
    expect(leashSaveData(m)).toEqual({ knot: [3, 64, 3] });
    const back = new Mob('mooxen', 2, 64, 2);
    back.loadData(JSON.parse(JSON.stringify(m.saveData())));
    g.entities.list.push(back);
    leashTick(g, back);
    expect(back.leashHolder && back.leashHolder.kind).toBe('knot');
    expect(g.entities.list.filter((e) => e.kind === 'knot').length).toBe(1);
    // the fence is broken: the knot goes and the lead drops
    g.world.getBlock = () => B.AIR;
    back.leashHolder.tick(g);
    expect(back.leashHolder).toBe(null);
    expect(g.drops.length).toBe(1);
  });
  it('snaps when dragged beyond 12 blocks', () => {
    const g = fakeGame(20, 0);
    const m = new Mob('fleecer', 0, 64, 0);
    g.entities.list.push(m);
    m.leashHolder = g.player;
    leashTick(g, m);
    expect(m.leashHolder).toBe(null);
    expect(g.drops.length).toBe(1);
  });
  it('a stretched lead walks and drags the mob toward its holder', () => {
    const g = fakeGame(8, 0);
    const m = new Mob('fleecer', 0, 64, 0);
    g.entities.list.push(m);
    m.leashHolder = g.player;
    leashTick(g, m);
    expect(m.leashHolder).toBe(g.player);
    expect(m.move && m.move.forward).toBeGreaterThan(0);
    expect(m.body.vx).toBeGreaterThan(0);
  });
});

describe('bundle weight', () => {
  it('weighs 64 / stack size per item', () => {
    expect(itemWeight({ id: I.STRING, count: 1 })).toBe(1);
    expect(itemWeight({ id: I.EGG, count: 1 })).toBe(4); // stacks to 16
    expect(itemWeight({ id: I.IRON_SWORD, count: 1 })).toBe(64);
    expect(bundleWeight([{ id: I.STRING, count: 10 }, { id: I.EGG, count: 3 }])).toBe(22);
    expect(itemWeight({ id: I.BUNDLE, count: 1, bundle: [{ id: I.STRING, count: 8 }] })).toBe(12);
  });
  it('takes mixed items up to 64 weight and gives the last one back first', () => {
    const b = { id: I.BUNDLE, count: 1, damage: 0 };
    const s = { id: I.STRING, count: 40, damage: 0 };
    expect(bundleInsert(b, s)).toBe(40);
    expect(s.count).toBe(0);
    const eggs = { id: I.EGG, count: 16, damage: 0 };
    expect(bundleRoom(b, eggs)).toBe(6); // 24 weight left / 4
    expect(bundleInsert(b, eggs)).toBe(6);
    expect(eggs.count).toBe(10);
    expect(bundleWeight(b.bundle)).toBe(BUNDLE_CAPACITY);
    expect(bundleFill(b)).toBe(1);
    expect(bundleInsert(b, { id: I.STRING, count: 1 })).toBe(0);
    const last = bundleTakeLast(b);
    expect(last).toMatchObject({ id: I.EGG, count: 6 });
    // matching stacks merge and move to the end
    bundleInsert(b, { id: I.FEATHER, count: 4, damage: 0 });
    bundleInsert(b, { id: I.STRING, count: 4, damage: 0 });
    expect(b.bundle.map((s) => [s.id, s.count])).toEqual([[I.FEATHER, 4], [I.STRING, 44]]);
    expect(bundleTakeLast(b).count).toBe(44);
    expect(bundleTakeLast(b).id).toBe(I.FEATHER);
    expect(bundleTakeLast(b)).toBe(null);
    expect(b.bundle).toBeUndefined();
  });
  it('a tool fills it alone; a bundle with contents does not go in another', () => {
    const b = { id: I.BUNDLE, count: 1 };
    expect(bundleInsert(b, { id: I.IRON_PICKAXE, count: 1, damage: 5 })).toBe(1);
    expect(bundleRoom(b, { id: I.STRING, count: 1 })).toBe(0);
    const full = { id: I.BUNDLE, count: 1, bundle: [{ id: I.STRING, count: 1 }] };
    expect(bundleRoom({ id: I.BUNDLE, count: 1 }, full)).toBe(0);
    expect(bundleRoom({ id: I.BUNDLE, count: 1 }, { id: I.BUNDLE, count: 1 })).toBe(1);
  });
  it('contents survive saving (withExtras / cleanBundle)', () => {
    const b = { id: I.BUNDLE, count: 1, damage: 0, bundle: [{ id: I.STRING, count: 5, damage: 0 }, { id: I.DIAMOND_SWORD, count: 1, damage: 7, ench: { sharpness: 2 } }] };
    const copy = withExtras({ id: b.id, count: 1, damage: 0 }, JSON.parse(JSON.stringify(b)));
    expect(copy.bundle).toEqual(b.bundle.map((s) => withExtras({ id: s.id, count: s.count, damage: s.damage }, s)));
    expect(cleanBundle([{ id: 99999, count: 1 }, null])).toBe(null);
  });
  it('is crafted from string and leather or rabbit hide', () => {
    const r = RECIPES.filter((x) => x.result === I.BUNDLE);
    expect(r.length).toBe(2);
    expect(RECIPES.find((x) => x.result === I.LEAD).key.B).toBe(I.SLIMEBALL);
    expect(ITEMS[I.BUNDLE].stack).toBe(1);
  });
});

describe('name tags', () => {
  it('a named mob keeps its name through a save and never despawns', () => {
    const m = new Mob('shambler', 0, 64, 0);
    expect(m.persistent).toBe(false);
    expect(canName(m, 'Gerald')).toBe(true);
    expect(canName(m, '   ')).toBe(false);
    expect(nameMob(m, '  Gerald  ')).toBe(true);
    expect(m.customName).toBe('Gerald');
    expect(m.persistent).toBe(true);
    const saved = JSON.parse(JSON.stringify(m.saveData()));
    expect(saved.customName).toBe('Gerald');
    const back = new Mob('shambler', 0, 64, 0);
    back.loadData(saved);
    expect(back.customName).toBe('Gerald');
    expect(back.persistent).toBe(true);
    // an unnamed one stays unnamed
    const plain = new Mob('shambler', 0, 64, 0);
    plain.loadData(JSON.parse(JSON.stringify(plain.saveData())));
    expect(plain.customName).toBeUndefined();
  });
  it('labelled tags keep their name and do not stack with blank ones', () => {
    expect(cleanLabel('x'.repeat(80)).length).toBe(32);
    expect(cleanLabel('')).toBe(null);
    const a = { id: I.NAME_TAG, count: 1, label: 'Bessie' }, b = { id: I.NAME_TAG, count: 1 };
    expect(canStack(a, b)).toBe(false);
    expect(canStack(a, { ...a })).toBe(true);
    expect(withExtras({ id: I.NAME_TAG, count: 1 }, a).label).toBe('Bessie');
  });
  it('the label shows within 8 blocks, or further off when looked at', () => {
    expect(nameVisible(5, 0, 0, 0, 0, -1)).toBe(true);
    expect(nameVisible(NAME_RANGE + 2, 0, 0, 0, 0, -1)).toBe(false);
    expect(nameVisible(20, 0, 0, 1, 0, 0)).toBe(true);
    expect(nameVisible(20, 2, 0, 1, 0, 0)).toBe(false);
    expect(nameVisible(-20, 0, 0, 1, 0, 0)).toBe(false);
    expect(nameVisible(40, 0, 0, 1, 0, 0)).toBe(false);
  });
  it('turns up in dungeon and shipwreck chests', () => {
    const has = (kind) => { const r = rng(7); for (let k = 0; k < 400; k++) if (dungeonLoot(r, kind).some((s) => s && s.id === I.NAME_TAG)) return true; return false; };
    expect(has(LOOT.DUNGEON)).toBe(true);
    expect(has(LOOT.WRECK)).toBe(true);
  });
});
