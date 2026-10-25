import { describe, it, expect } from 'vitest';
import {
  PATROL_MIN_TIME, PATROL_INTERVAL, PATROL_CHANCE, PATROL_MIN_DIST, PATROL_MAX_DIST, OMEN_TICKS, CHAMPION_TICKS, RAID_TIME_LIMIT, WAVE_DELAY,
  nextPatrolDelay, patrolAllowed, patrolRoll, patrolSize, patrolSpot, validPatrolGround, omenAfterCaptainKill, championDiscount,
  raidWaves, waveSize, RaidState, RAID, Raids,
} from '../src/mobs/raids.js';
import { offerPrice, canTrade, doTrade } from '../src/mobs/trades.js';
import { addEffect, EFFECTS, effectLevel, cleanEffects } from '../src/player/effects.js';
import { MILESTONES } from '../src/player/milestones.js';
import { Inventory } from '../src/player/inventory.js';
import { B } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { rng } from './helpers.js';

describe('patrol spawn rules', () => {
  const ok = { time: PATROL_MIN_TIME, dimension: 'overworld', hostile: true, nearVillage: false };
  it('only come after the first few days, in the overworld, with hostile mobs on and away from villages', () => {
    expect(patrolAllowed(ok)).toBe(true);
    expect(patrolAllowed({ ...ok, time: PATROL_MIN_TIME - 1 })).toBe(false);
    expect(patrolAllowed({ ...ok, time: 0 })).toBe(false);
    expect(patrolAllowed({ ...ok, dimension: 'cinderdeep' })).toBe(false);
    expect(patrolAllowed({ ...ok, hostile: false })).toBe(false);
    expect(patrolAllowed({ ...ok, nearVillage: true })).toBe(false);
    expect(patrolAllowed({ ...ok, playerDead: true })).toBe(false);
    expect(PATROL_MIN_TIME).toBeGreaterThanOrEqual(2 * 24000);
  });
  it('a check every 10-15 minutes succeeds about one time in five', () => {
    const r = rng(7);
    for (let i = 0; i < 200; i++) {
      const d = nextPatrolDelay(r);
      expect(d).toBeGreaterThanOrEqual(PATROL_INTERVAL);
      expect(d).toBeLessThan(PATROL_INTERVAL * 1.5);
    }
    expect(PATROL_INTERVAL).toBe(12000); // ten minutes of ticks
    let hits = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) if (patrolRoll(ok, r)) hits++;
    expect(hits / n).toBeGreaterThan(PATROL_CHANCE - 0.03);
    expect(hits / n).toBeLessThan(PATROL_CHANCE + 0.03);
    for (let i = 0; i < 100; i++) expect(patrolRoll({ ...ok, time: 10 }, r)).toBe(false);
  });
  it('bands of 2 to 5 appear 24-48 blocks from the player', () => {
    const r = rng(3);
    const sizes = new Set();
    for (let i = 0; i < 500; i++) {
      const s = patrolSize(r);
      expect(s).toBeGreaterThanOrEqual(2); expect(s).toBeLessThanOrEqual(5);
      sizes.add(s);
      const p = patrolSpot(100, -50, r);
      const d = Math.hypot(p.x - 100, p.z + 50);
      expect(d).toBeGreaterThanOrEqual(PATROL_MIN_DIST - 1.5);
      expect(d).toBeLessThanOrEqual(PATROL_MAX_DIST + 1.5);
    }
    expect(sizes.size).toBe(4);
  });
  it('stand on open, solid ground', () => {
    expect(validPatrolGround(B.GRASS, B.AIR, B.AIR, 15)).toBe(true);
    expect(validPatrolGround(B.WATER, B.AIR, B.AIR, 15)).toBe(false);
    expect(validPatrolGround(B.GRASS, B.WATER, B.AIR, 15)).toBe(false);
    expect(validPatrolGround(B.GRASS, B.STONE, B.AIR, 15)).toBe(false);
    expect(validPatrolGround(B.GRASS, B.AIR, B.STONE, 15)).toBe(false);
    expect(validPatrolGround(B.STONE, B.AIR, B.AIR, 0)).toBe(false); // a cave is not the surface
    expect(validPatrolGround(B.GLASS, B.AIR, B.AIR, 15)).toBe(false);
  });
});

describe('Dark Omen and Village Champion', () => {
  it('are status effects with their own badges', () => {
    expect(EFFECTS.dark_omen.name).toBe('Dark Omen');
    expect(EFFECTS.dark_omen.good).toBe(false);
    expect(EFFECTS.village_champion.good).toBe(true);
    expect(EFFECTS.dark_omen.glyph).toBeTruthy();
    expect(OMEN_TICKS).toBe(100 * 60 * 20);
    expect(CHAMPION_TICKS).toBe(40 * 60 * 20);
    expect(cleanEffects({ dark_omen: { ticks: 500, amp: 1 } }).dark_omen.amp).toBe(1); // saved with the player
  });
  it('each Captain raises the omen by one level, up to V', () => {
    expect(omenAfterCaptainKill(0)).toBe(0);
    expect(omenAfterCaptainKill(1)).toBe(1);
    expect(omenAfterCaptainKill(4)).toBe(4);
    expect(omenAfterCaptainKill(5)).toBe(4);
  });
  it('champions get cheaper trades (at least one less, never below one)', () => {
    const fx = {};
    expect(championDiscount(fx)).toBe(0);
    addEffect(fx, 'village_champion', 1000, 0);
    expect(championDiscount(fx)).toBeCloseTo(0.3);
    const o = { give: I.BERYL, giveCount: 9, get: B.BOOKSHELF, getCount: 1, uses: 0 };
    expect(offerPrice(o, 0)).toBe(9);
    expect(offerPrice(o, 0.3)).toBe(7);
    expect(offerPrice({ ...o, giveCount: 20 }, 0.3)).toBe(14);
    expect(offerPrice({ ...o, giveCount: 2 }, 0.3)).toBe(1);
    expect(offerPrice({ ...o, giveCount: 1 }, 0.3)).toBe(1);
    const inv = new Inventory();
    inv.add({ id: I.BERYL, count: 7, damage: 0 });
    expect(canTrade(o, inv)).toBe(false);
    expect(canTrade(o, inv, 0.3)).toBe(true);
    expect(doTrade(o, inv, 0.3)).toEqual({ id: B.BOOKSHELF, count: 1, damage: 0 });
    expect(inv.count(I.BERYL)).toBe(0);
  });
  it('winning a raid is a milestone', () => {
    expect(MILESTONES.find((m) => m.event === 'raid')).toBeTruthy();
  });
});

describe('raid state machine', () => {
  it('3-5 waves that grow with the wave and the omen level', () => {
    expect(raidWaves(1)).toBe(3); expect(raidWaves(2)).toBe(4); expect(raidWaves(3)).toBe(5); expect(raidWaves(5)).toBe(5);
    expect(waveSize(2, 1)).toBeGreaterThan(waveSize(1, 1));
    expect(waveSize(1, 3)).toBeGreaterThan(waveSize(1, 1));
    expect(waveSize(5, 5)).toBeLessThanOrEqual(12);
  });

  /** Drive a raid: kill every raider as soon as a wave is out. */
  function run(r, { settlers = 3, kill = true, maxTicks = RAID_TIME_LIMIT + 100 } = {}) {
    const events = [];
    let alive = 0;
    for (let t = 0; t < maxTicks && !r.done; t += 20) {
      for (const e of r.step(20, { raiders: alive, settlers })) {
        events.push(e);
        if (e.type === 'wave') alive = e.count;
      }
      if (kill && r.state === RAID.WAVE) alive = Math.max(0, alive - 1);
    }
    return events;
  }

  it('waits, sends each wave, and is won after the last one', () => {
    const r = new RaidState({ cx: 10, cz: 20, omenLevel: 1 });
    expect(r.state).toBe(RAID.WAITING);
    expect(r.step(WAVE_DELAY - 20, { raiders: 0, settlers: 4 })).toEqual([]);
    const first = r.step(20, { raiders: 0, settlers: 4 });
    expect(first).toEqual([{ type: 'wave', wave: 1, count: waveSize(1, 1) }]);
    expect(r.state).toBe(RAID.WAVE);
    expect(r.progress()).toBe(1);
    // the wave stays on while raiders live
    expect(r.step(20, { raiders: 2, settlers: 4 })).toEqual([]);
    expect(r.progress()).toBeCloseTo(2 / waveSize(1, 1));
    expect(r.label()).toContain('Wave 1/3');
    // all dead: a pause before wave 2
    expect(r.step(20, { raiders: 0, settlers: 4 })).toEqual([]);
    expect(r.state).toBe(RAID.WAITING);
    expect(r.label()).toContain('Wave 2/3');
    const events = run(r);
    expect(events.filter((e) => e.type === 'wave').map((e) => e.wave)).toEqual([2, 3]);
    expect(events[events.length - 1]).toEqual({ type: 'won' });
    expect(r.state).toBe(RAID.WON);
    expect(r.done).toBe(true);
    expect(r.step(20, { raiders: 0, settlers: 4 })).toEqual([]); // over is over
  });

  it('a stronger omen means more waves', () => {
    const r = new RaidState({ omenLevel: 3 });
    const events = run(r);
    expect(events.filter((e) => e.type === 'wave').length).toBe(5);
    expect(r.state).toBe(RAID.WON);
  });

  it('is lost when every settler is dead', () => {
    const r = new RaidState({ omenLevel: 1 });
    r.step(WAVE_DELAY, { raiders: 0, settlers: 2 });
    expect(r.step(20, { raiders: 3, settlers: 0 })).toEqual([{ type: 'lost', reason: 'settlers' }]);
    expect(r.state).toBe(RAID.LOST);
    expect(r.label()).toContain('Defeat');
  });

  it('is lost when the time runs out', () => {
    const r = new RaidState({ omenLevel: 2 });
    const events = run(r, { kill: false });
    expect(events[events.length - 1]).toEqual({ type: 'lost', reason: 'time' });
    expect(r.elapsed).toBeGreaterThanOrEqual(RAID_TIME_LIMIT);
  });

  it('saves and loads the raid under way (finished ones are dropped)', () => {
    const r = new RaidState({ cx: -40, cz: 70, omenLevel: 2 });
    r.step(WAVE_DELAY, { raiders: 0, settlers: 2 });
    r.step(20, { raiders: 4, settlers: 2 });
    const back = RaidState.load(JSON.parse(JSON.stringify(r.save())));
    expect(back).toMatchObject({ id: r.id, cx: -40, cz: 70, omenLevel: 2, state: RAID.WAVE, wave: 1, alive: 4, totalWaves: 4 });
    const lost = new RaidState(); lost.lose('time');
    expect(RaidState.load(lost.save())).toBe(null);
    expect(RaidState.load(null)).toBe(null);
    expect(RaidState.load({ cx: 'x' })).toBe(null);
  });
});

describe('Raids on the game', () => {
  function fakeGame() {
    const p = { x: 0, y: 70, z: 0, effects: {}, dead: false, listeners: { effect: [] } };
    p.addEffect = (t, ticks, amp) => addEffect(p.effects, t, ticks, amp);
    return { player: p, localPlayer: p, entities: { list: [] }, world: {}, ticks: 0, time: 0 };
  }
  it('killing a patrol Captain brings Dark Omen; raid Captains and other kills do not', () => {
    const g = fakeGame(), r = new Raids(g);
    r.onCaptainKilled({ captain: true }, false);
    expect(g.player.effects.dark_omen).toBeUndefined();
    r.onCaptainKilled({ captain: true, raider: true }, true);
    expect(g.player.effects.dark_omen).toBeUndefined();
    r.onCaptainKilled({ captain: true }, true);
    expect(g.player.effects.dark_omen).toMatchObject({ amp: 0, ticks: OMEN_TICKS });
    r.onCaptainKilled({ captain: true }, true);
    expect(effectLevel(g.player.effects, 'dark_omen')).toBe(2);
  });
  it('starting a raid uses up the omen and remembers its level', () => {
    const g = fakeGame(), r = new Raids(g);
    addEffect(g.player.effects, 'dark_omen', OMEN_TICKS, 1);
    const raid = r.start(5, 6, effectLevel(g.player.effects, 'dark_omen'));
    expect(g.player.effects.dark_omen).toBeUndefined();
    expect(raid.omenLevel).toBe(2);
    expect(r.activeNear(10, 10)).toBe(true);
    expect(r.activeNear(500, 10)).toBe(false);
    const saved = JSON.parse(JSON.stringify(r.save()));
    const r2 = new Raids(fakeGame());
    r2.load(saved);
    expect(r2.raid.id).toBe(raid.id);
    // a raider from the save re-joins; one from an old raid becomes an ordinary Marauder
    const a = { raider: true, raidId: raid.id }, b = { raider: true, raidId: 'old' };
    r2.adopt(a); r2.adopt(b);
    expect(a.raidCenter).toEqual({ x: 5, z: 6 });
    expect(b.raider).toBe(false);
  });
});
