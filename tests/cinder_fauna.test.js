// Cinderdeep fauna: the Smokeray (a drifting ray that swells and spits a Slag Glob) and the Slagboar (a charging, Glowshard-fearing
// beast), with their items (mobs/cinderFauna.js).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { Mob } from '../src/mobs/mob.js';
import { MOBS, MOB_KEYS, CATEGORY } from '../src/mobs/mobTypes.js';
import {
  SMOKE, BOAR, HABITATS, hasOpenAir, canSpawnSmokeray, shardNear, boarFears, fleePoint, smokeStep, swellFraction, newCharge, chargeStep,
  boarSave, boarLoad,
} from '../src/mobs/cinderFauna.js';
import { DIM_SPAWN_TABLES, attemptDimensionSpawn } from '../src/mobs/dimensionMobs.js';
import { MODELS, FACES } from '../src/mobs/models.js';
import { rollDrops } from '../src/mobs/drops.js';
import { Fireball } from '../src/entities/fireball.js';
import { B } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import { SMELTING, fastCook } from '../src/player/crafting.js';
import { brewKind } from '../src/world/potions.js';
import { isIngredient } from '../src/world/brewing.js';
import { canCampCook, campCooked } from '../src/world/campfireCooking.js';
import { kindOfItem } from '../src/world/cooking.js';
import { entriesOf, resetGuideEntries } from '../src/player/fieldGuideEntries.js';
import { eggCatalog, eggMob } from '../src/mobs/creatureEggs.js';
import { CAPTION_TEXT } from '../src/ui/accessibility.js';
import { MockWorld } from './helpers.js';

const noop = () => {};
const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

function fakeGame(world = new MockWorld(60)) {
  const played = [];
  const g = {
    ticks: 100, played, world,
    audio: { play: (n) => played.push(n) },
    particles: { emit: noop, smoke: noop, flame: noop },
    entities: { list: [], add: (e) => { g.entities.list.push(e); return e; }, spawnItem: noop, spawnXp: noop },
  };
  world.dimension = 'cinderdeep';
  return g;
}
function fakePlayer(over = {}) {
  const hurts = [];
  return { x: 0, y: 64, z: 0, dead: false, creative: false, eyeHeight: 1.6, body: { vx: 0, vy: 0, vz: 0, height: 1.8 }, hurts, hurt(d, s, a) { hurts.push([d, s, a]); return true; }, ...over };
}
const put = (g, type, x = 0, y = 64, z = 0) => {
  const m = new Mob(type, x, y, z); m._game = g; m.canSee = () => true; if (m.def.onSpawn) m.def.onSpawn(m); g.entities.list.push(m); return m;
};
const dist = (m, p) => Math.hypot(p.x - m.x, p.z - m.z);
const ai = (m, g, p, n = 1) => { g.player = p; for (let k = 0; k < n; k++) { g.ticks++; (m.def.customAI || m.def.ownAI)(m, g, p, dist(m, p)); } };

describe('items and ids', () => {
  it('appends the new items at the very end and leaves earlier ids alone', () => {
    expect(I.INLAY_STENCIL_HOLLOW).toBe(I.INLAY_STENCIL_RINGED + 5);
    expect(I.CREATURE_EGG).toBe(821);
    expect(I.HOWLER_BARDING).toBe(I.CREATURE_EGG + 3);
    expect(I.SMOKE_GLAND).toBe(I.INLAY_STENCIL_HOLLOW + 1);
    expect(I.RAW_SLAGBOAR_CHOP).toBe(I.INLAY_STENCIL_HOLLOW + 2);
    expect(I.SEARED_SLAGBOAR_CHOP).toBe(I.INLAY_STENCIL_HOLLOW + 3);
  });
  it('the chops are food, the seared one better', () => {
    expect(ITEMS[I.RAW_SLAGBOAR_CHOP].food.hunger).toBeLessThan(ITEMS[I.SEARED_SLAGBOAR_CHOP].food.hunger);
    expect(ITEMS[I.SEARED_SLAGBOAR_CHOP].food.hunger).toBe(8);
    expect(ITEMS[I.SMOKE_GLAND].name).toBe('Smoke Gland');
  });
  it('uses no forbidden names', () => {
    const text = ['src/mobs/cinderFauna.js', 'tests/cinder_fauna.test.js'].map(src).join('\n').toLowerCase();
    for (const w of ['mine' + 'craft', 'net' + 'her', 'red' + 'stone', 'trip' + 'wire']) expect(text).not.toContain(w);
  });
});

describe('definitions', () => {
  it('registers both hostile creatures with models, voices and drops', () => {
    for (const k of ['smokeray', 'slagboar']) {
      const d = MOBS[k];
      expect(d, k).toBeTruthy();
      expect(MOB_KEYS).toContain(k);
      expect(d.category).toBe(CATEGORY.MONSTER);
      expect(d.fireImmune).toBe(true);
      expect(MODELS[k].parts.length).toBeGreaterThan(8);
      for (const [, , , , , o] of MODELS[k].parts) if (o && o.face) expect(typeof FACES[o.face]).toBe('function');
      expect(src('src/audio/audio.js')).toContain(`case '${d.sound}':`);
      expect(CAPTION_TEXT[d.sound]).toBeTruthy();
      for (const dr of d.drops) expect(ITEMS[dr.id], `${k} drop`).toBeTruthy();
    }
    for (const s of ['billow', 'glob_spit', 'boar_snort', 'boar_charge']) { expect(src('src/audio/audio.js')).toContain(`case '${s}':`); expect(CAPTION_TEXT[s]).toBeTruthy(); }
  });
  it('Smokeray: about 4 x 1 x 4 blocks, 10 health, flying', () => {
    const d = MOBS.smokeray;
    expect([d.width, d.height, d.health]).toEqual([4, 1, 10]);
    expect(d.flying).toBe(true);
    expect(d.followRange).toBe(48);
  });
  it('Slagboar: 1.4 x 1.4 blocks, 30 health, breeds with Cinderroot', () => {
    const d = MOBS.slagboar;
    expect([d.width, d.height, d.health]).toEqual([1.4, 1.4, 30]);
    expect(d.food).toEqual([I.CINDERROOT]);
  });
  it('are placed by the Cinderdeep spawn tables, Slagboars in herds of 2-4 and Smokerays singly and rarely', () => {
    for (const t of HABITATS.slagboar) {
      const e = DIM_SPAWN_TABLES[t].find((x) => x.type === 'slagboar');
      expect(e, t).toBeTruthy();
      expect([e.min, e.max]).toEqual([2, 4]);
    }
    for (const t of HABITATS.smokeray) {
      const e = DIM_SPAWN_TABLES[t].find((x) => x.type === 'smokeray');
      expect(e, t).toBeTruthy();
      expect([e.min, e.max]).toEqual([1, 1]);
      const total = DIM_SPAWN_TABLES[t].reduce((s, x) => s + x.weight, 0);
      expect(e.weight / total).toBeLessThan(0.05);
    }
    for (const t of ['hollow', 'bastion', 'cinderForge']) expect(DIM_SPAWN_TABLES[t].some((x) => x.type === 'smokeray' || x.type === 'slagboar')).toBe(false);
  });
  it('appear in the Field Guide with the Cinderdeep as habitat, and as Creature Eggs and /summon names', () => {
    resetGuideEntries();
    for (const k of ['smokeray', 'slagboar']) {
      const e = entriesOf('creatures').find((x) => x.key === k);
      expect(e, k).toBeTruthy();
      expect(JSON.stringify(e.habitat)).toMatch(/Cinderdeep/);
      expect(eggCatalog().map((x) => x.key)).toContain(k);
      expect(eggMob({ id: I.CREATURE_EGG, label: MOBS[k].name })).toBe(k);
    }
    const items = entriesOf('items').map((e) => e.id);
    for (const id of [I.SMOKE_GLAND, I.RAW_SLAGBOAR_CHOP, I.SEARED_SLAGBOAR_CHOP]) expect(items).toContain(id);
    expect(src('src/ui/commands.js')).toContain('MOB_KEYS');
  });
  it('has a help sentence for each', () => {
    const help = src('src/ui/helpTopics.js');
    expect(help).toContain('Smokerays'); expect(help).toContain('Slagboars');
  });
});

describe('Smokeray spawning', () => {
  const air = () => B.AIR;
  it('needs a 5 x 5 x 5 pocket of air', () => {
    expect(hasOpenAir(air, 0, 60, 0)).toBe(true);
    const wall = (x, y, z) => (x === 2 && y === 60 && z === 2 ? B.STONE : B.AIR);
    expect(hasOpenAir(wall, 0, 60, 0)).toBe(false); // a block in the corner of the box
    expect(hasOpenAir(wall, 0, 60, 0, 3)).toBe(true); // ...but a 3-box would not reach it
    const lava = (x, y, z) => (y === 58 ? B.LAVA : B.AIR);
    expect(hasOpenAir(lava, 0, 60, 0)).toBe(false); // fluid is not air
    expect(hasOpenAir((x, y, z) => (y === 57 ? B.STONE : B.AIR), 0, 60, 0)).toBe(true); // just below the box
  });
  it('only in the Cinderdeep, and fewer than two near the player', () => {
    const base = { getBlock: air, x: 0, y: 60, z: 0 };
    expect(canSpawnSmokeray({ ...base, dim: 'cinderdeep', near: 0 })).toBe(true);
    expect(canSpawnSmokeray({ ...base, dim: 'cinderdeep', near: 1 })).toBe(true);
    expect(canSpawnSmokeray({ ...base, dim: 'cinderdeep', near: 2 })).toBe(false);
    for (const dim of ['overworld', 'hollow', undefined]) expect(canSpawnSmokeray({ ...base, dim, near: 0 }), String(dim)).toBe(false);
  });
  it('the spawn condition of the definition counts Smokerays near the player and reads the dimension', () => {
    const g = fakeGame(); g.player = fakePlayer();
    const sp = { game: g };
    expect(MOBS.smokeray.spawnCheck(sp, 0, 70, 0)).toBe(true);
    put(g, 'smokeray', 10, 70, 10); put(g, 'smokeray', -10, 70, 10);
    expect(MOBS.smokeray.spawnCheck(sp, 0, 70, 0)).toBe(false);
    g.entities.list.forEach((e) => { e.dead = true; });
    g.world.dimension = 'overworld';
    expect(MOBS.smokeray.spawnCheck(sp, 0, 70, 0)).toBe(false);
  });
  it('an attempt in a cramped cave never places one', () => {
    const g = fakeGame(new MockWorld(300)); // solid up to y 300: no air anywhere in the spawn band
    g.player = fakePlayer({ x: 500, z: 500 });
    const spawned = [];
    const sp = { game: g, canFit: () => true, spawnMob: (t, x, y, z) => { spawned.push(t); return { yaw: 0 }; } };
    // (force the table to pick the Smokeray alone)
    const saved = DIM_SPAWN_TABLES.cinderdeep.slice();
    DIM_SPAWN_TABLES.cinderdeep.length = 0; DIM_SPAWN_TABLES.cinderdeep.push({ type: 'smokeray', weight: 1, min: 1, max: 1 });
    try { for (let k = 0; k < 40; k++) attemptDimensionSpawn(sp, 40 + k, 40, CATEGORY.MONSTER); } finally { DIM_SPAWN_TABLES.cinderdeep.length = 0; DIM_SPAWN_TABLES.cinderdeep.push(...saved); }
    expect(spawned).toEqual([]);
  });
});

describe('Smokeray swell and spit', () => {
  it('swells for one second after sighting a player, then spits, then waits', () => {
    const m = { swell: 0, cool: 0 };
    expect(smokeStep(m, true, 30)).toBe('start');
    for (let k = 1; k < SMOKE.SWELL; k++) expect(smokeStep(m, true, 30)).toBe('swelling');
    expect(smokeStep(m, true, 30)).toBe('spit'); // the 21st tick: a full second (20 ticks) of swelling first
    expect(m.swell).toBe(0);
    expect(m.cool).toBe(SMOKE.COOLDOWN);
    expect(smokeStep(m, true, 30)).toBe(null);
  });
  it('does nothing out of range or out of sight, and aborts when sight is lost', () => {
    expect(smokeStep({ swell: 0, cool: 0 }, false, 10)).toBe(null);
    expect(smokeStep({ swell: 0, cool: 0 }, true, 60)).toBe(null);
    const m = { swell: 0, cool: 0 };
    smokeStep(m, true, 20); smokeStep(m, true, 20);
    expect(smokeStep(m, false, 20)).toBe('abort');
    expect(m.swell).toBe(0);
  });
  it('the swell is a 0 to 1 fraction for the body pulse and glowing mouth', () => {
    expect(swellFraction({ swell: 0 })).toBe(0);
    expect(swellFraction({ swell: 10 })).toBe(0.5);
    expect(swellFraction({ swell: 99 })).toBe(1);
  });
  it('the AI hovers while swelling, then fires one slow Fireball of power 1 at the player', () => {
    const g = fakeGame(), p = fakePlayer({ x: 20, y: 64, z: 0 });
    const m = put(g, 'smokeray', 0, 64, 0); m.cool = 0;
    ai(m, g, p, 1);
    expect(m.swell).toBe(1);
    expect(m.angry).toBe(true);
    expect(g.played).toContain('billow');
    let shots = 0;
    for (let k = 0; k < SMOKE.SWELL; k++) { ai(m, g, p, 1); shots = g.entities.list.filter((e) => e instanceof Fireball).length; if (k < SMOKE.SWELL - 1) expect(shots).toBe(0); }
    expect(shots).toBe(1);
    const glob = g.entities.list.find((e) => e instanceof Fireball);
    expect(glob.power).toBe(1);
    expect(glob.shooter).toBe(m);
    expect(Math.hypot(glob.vx, glob.vy, glob.vz)).toBeCloseTo(SMOKE.GLOB_SPEED, 5);
    expect(glob.vx).toBeGreaterThan(0.2); // towards the player
    expect(g.played).toContain('glob_spit');
    expect(m.swell).toBe(0);
    expect(m.headPitch).toBe(0);
  });
  it('the glob bursts on impact through game.explode (which honours mobGriefing)', () => {
    const g = fakeGame(); const calls = [];
    g.explode = (x, y, z, power, who) => calls.push([power, who]);
    g.world.raycast = () => null; g.world.isLoaded = () => true;
    g.entities.sweepHit = () => null;
    const glob = new Fireball(0, 64, 0, 0.3, 0, 0, null, { power: 1, size: SMOKE.GLOB_SIZE });
    glob.impact(g, 5, 64, 0, null);
    expect(calls).toEqual([[1, null]]);
    expect(glob.dead).toBe(true);
  });
  it('drifts slowly when it sees nobody, and does not swell at a creative or dead player', () => {
    const g = fakeGame(), p = fakePlayer({ x: 100, z: 0 });
    const m = put(g, 'smokeray', 0, 64, 0);
    ai(m, g, p, 1);
    expect(m.swell).toBe(0);
    expect(Math.hypot(m.body.vx, m.body.vy, m.body.vz)).toBeLessThan(0.02); // (a push of 0.006 a tick)
    ai(m, g, p, 20);
    expect(m.swell).toBe(0);
    const near = fakePlayer({ x: 10, creative: true });
    m.cool = 0; ai(m, g, near, 5);
    expect(m.swell).toBe(0);
  });
  it('drops 0-1 Blast Powder and 0-1 Smoke Gland', () => {
    const r = (n) => () => n;
    expect(rollDrops('smokeray', { killedByPlayer: true }, r(0.99)).map((d) => [d.id, d.count]).sort()).toEqual([[I.GUNPOWDER, 1], [I.SMOKE_GLAND, 1]].sort());
    expect(rollDrops('smokeray', {}, r(0))).toEqual([]);
  });
  it('Smoke Gland brews Slow Falling on a Murky Elixir, like a Feather (Feather still does)', () => {
    expect(brewKind('murky', 'smoke_gland')).toBe('slow_falling');
    expect(brewKind('murky', 'feather')).toBe('slow_falling');
    expect(brewKind('water', 'smoke_gland')).toBe('bland');
    expect(isIngredient(I.SMOKE_GLAND)).toBe(true);
    expect(isIngredient(I.FEATHER)).toBe(true);
  });
});

describe('Glowshard fear', () => {
  const world = (...blocks) => { const w = new MockWorld(60); for (const [x, y, z] of blocks) w.set(x, y, z, B.GLOWSHARD); return (x, y, z) => w.getBlock(x, y, z); };
  it('finds a Glowshard within 6 blocks and not beyond', () => {
    expect(shardNear(world([3, 64, 0]), 0.5, 64, 0.5, 6)).toMatchObject({ x: 3.5, y: 64.5, z: 0.5 });
    expect(boarFears(world([5, 64, 0]), 0.5, 64, 0.5)).toBe(true);
    expect(boarFears(world([7, 64, 0]), 0.5, 64, 0.5)).toBe(false);
    expect(boarFears(world(), 0.5, 64, 0.5)).toBe(false);
    expect(boarFears(world([0, 64, 0], [0, 70, 0]), 20, 64, 20)).toBe(false);
  });
  it('picks the nearest of several, and a block of another kind does not count', () => {
    const w = new MockWorld(60); w.set(4, 64, 0, B.GLOWSHARD); w.set(1, 64, 0, B.GLOWSHARD); w.set(2, 64, 2, B.STONE);
    expect(shardNear((x, y, z) => w.getBlock(x, y, z), 0.5, 64, 0.5, 6).x).toBe(1.5);
  });
  it('flees straight away from the shard', () => {
    const f = fleePoint(0, 0, { x: 3, z: 0 }, 8);
    expect(f.x).toBeCloseTo(-8, 5); expect(f.z).toBeCloseTo(0, 5);
  });
  it('a herd member near a Glowshard runs from it and never charges', () => {
    const g = fakeGame(); g.world.set(3, 64, 0, B.GLOWSHARD);
    const p = fakePlayer({ x: 6, z: 0 });
    const m = put(g, 'slagboar', 0.5, 64, 0.5);
    ai(m, g, p, 5);
    expect(m.charge.state).toBe('idle');
    expect(m.angry).toBe(false);
    expect(m.move && m.move.forward > 0).toBe(true);
  });
  it('will not charge a player who stands within 6 blocks of a Glowshard', () => {
    const g = fakeGame(); g.world.set(8, 64, 0, B.GLOWSHARD);
    const p = fakePlayer({ x: 7, z: 0 }), m = put(g, 'slagboar', 0.5, 64, 0.5);
    const far = new MockWorld(60); far.set(40, 64, 0, B.GLOWSHARD); // (the shard is out of the boar's own reach: 7.5 away)
    ai(m, g, p, 30);
    expect(m.charge.state).toBe('idle');
  });
  it('does not spawn within 6 blocks of one, nor outside the Cinderdeep', () => {
    const g = fakeGame(); g.world.set(3, 64, 0, B.GLOWSHARD);
    const sp = { game: g };
    expect(MOBS.slagboar.spawnCheck(sp, 0, 64, 0)).toBe(false);
    expect(MOBS.slagboar.spawnCheck(sp, 30, 64, 30)).toBe(true);
    g.world.dimension = 'overworld';
    expect(MOBS.slagboar.spawnCheck(sp, 30, 64, 30)).toBe(false);
  });
});

describe('Slagboar charge', () => {
  const sees = { sees: true, x: 0, z: 0, px: 8, pz: 0, blocked: false, hit: false, afraid: false };
  it('winds up for 0.6 s, dashes in a locked straight line, then rests 3 s', () => {
    expect(BOAR.WINDUP).toBe(12); expect(BOAR.REST).toBe(60);
    const c = newCharge();
    expect(chargeStep(c, sees)).toBe('windup');
    for (let k = 1; k < BOAR.WINDUP; k++) expect(chargeStep(c, sees), `tick ${k}`).toBe(null);
    expect(chargeStep(c, { ...sees, px: 0, pz: 8 })).toBe('dash'); // the direction is read at the end of the wind-up
    expect([c.dx, c.dz]).toEqual([0, 1]);
    // the player steps aside: the dash keeps its line
    for (let k = 1; k < BOAR.DASH_MAX; k++) expect(chargeStep(c, { ...sees, px: 50, pz: -50 })).toBe(null);
    expect(chargeStep(c, sees)).toBe('stop');
    expect(c.state).toBe('rest');
    for (let k = 1; k < BOAR.REST; k++) expect(chargeStep(c, { ...sees, sees: true })).toBe(null);
    expect(chargeStep(c, sees)).toBe('rested');
    expect(c.state).toBe('idle');
    expect(chargeStep(c, sees)).toBe('windup'); // and again
  });
  it('a hit or a crash ends the dash in a rest', () => {
    for (const [flag, ev] of [['hit', 'hit'], ['blocked', 'crash']]) {
      const c = newCharge(); chargeStep(c, sees);
      for (let k = 0; k < BOAR.WINDUP; k++) chargeStep(c, sees);
      expect(c.state).toBe('dash');
      expect(chargeStep(c, { ...sees, [flag]: true })).toBe(ev);
      expect(c.state).toBe('rest'); expect(c.t).toBe(BOAR.REST);
    }
  });
  it('does not start without sight, and fear cancels a wind-up or a dash', () => {
    const c = newCharge();
    expect(chargeStep(c, { ...sees, sees: false })).toBe(null);
    expect(chargeStep(c, { ...sees, afraid: true })).toBe(null);
    chargeStep(c, sees);
    expect(chargeStep(c, { ...sees, afraid: true })).toBe('stop');
    expect(c.state).toBe('idle');
    chargeStep(c, sees); for (let k = 0; k < BOAR.WINDUP; k++) chargeStep(c, sees);
    expect(chargeStep(c, { ...sees, afraid: true })).toBe('stop');
    expect(c.state).toBe('rest');
  });
  it('the AI stands still to wind up, dashes fast, hits for 6 and throws the player up, then rests', () => {
    const g = fakeGame(), p = fakePlayer({ x: 6, y: 64, z: 0 });
    const m = put(g, 'slagboar', 0, 64, 0);
    ai(m, g, p, 1);
    expect(m.charge.state).toBe('windup');
    expect(m.angry).toBe(true);
    expect(g.played).toContain('boar_snort');
    const x0 = m.x;
    ai(m, g, p, BOAR.WINDUP - 2);
    expect(m.x).toBe(x0); // standing still, pawing
    expect(m.headPitch).toBeGreaterThan(0.3);
    ai(m, g, p, 2);
    expect(m.charge.state).toBe('dash');
    expect(g.played).toContain('boar_charge');
    expect(Math.hypot(m.body.vx, m.body.vz)).toBeCloseTo(BOAR.DASH_SPEED, 5);
    expect(m.body.vx).toBeGreaterThan(0); // towards +x, where the player was
    // it arrives: put the player in reach
    p.x = m.x + 1;
    ai(m, g, p, 1);
    expect(p.hurts).toHaveLength(1);
    expect(p.hurts[0][0]).toBe(6);
    expect(p.body.vy).toBeGreaterThanOrEqual(BOAR.LAUNCH);
    expect(m.charge.state).toBe('rest');
    // resting: no second hit for three seconds, even in reach
    ai(m, g, p, BOAR.REST - 2);
    expect(p.hurts).toHaveLength(1);
    expect(m.charge.state).toBe('rest');
    ai(m, g, p, 3);
    expect(['idle', 'windup']).toContain(m.charge.state);
  });
  it('ignores a player further than 10 blocks, one in creative, and a dead one', () => {
    const g = fakeGame();
    const m = put(g, 'slagboar', 0, 64, 0);
    ai(m, g, fakePlayer({ x: 11 }), 20);
    expect(m.charge.state).toBe('idle');
    ai(m, g, fakePlayer({ x: 5, creative: true }), 20);
    expect(m.charge.state).toBe('idle');
    ai(m, g, fakePlayer({ x: 5, dead: true }), 20);
    expect(m.charge.state).toBe('idle');
    expect(BOAR.SIGHT).toBe(10);
  });
});

describe('Slagboar drops and cooking', () => {
  it('drops 2-4 Raw Chops (seared when it dies burning) and 0-1 Leather', () => {
    const r = (n) => () => n;
    const hi = rollDrops('slagboar', { killedByPlayer: true }, r(0.99)), lo = rollDrops('slagboar', { killedByPlayer: true }, r(0));
    expect(hi.find((d) => d.id === I.RAW_SLAGBOAR_CHOP).count).toBe(4);
    expect(lo.find((d) => d.id === I.RAW_SLAGBOAR_CHOP).count).toBe(2);
    expect(hi.find((d) => d.id === I.LEATHER).count).toBe(1);
    expect(lo.find((d) => d.id === I.LEATHER)).toBeUndefined();
    expect(rollDrops('slagboar', { onFire: true }, r(0.5)).map((d) => d.id)).toContain(I.SEARED_SLAGBOAR_CHOP);
  });
  it('cooks in the furnace, the smoker (fast) and the campfire, and goes in the Cooking Pot', () => {
    expect(SMELTING[I.RAW_SLAGBOAR_CHOP]).toBe(I.SEARED_SLAGBOAR_CHOP);
    expect(fastCook('food', I.RAW_SLAGBOAR_CHOP)).toBe(true); // smoker
    expect(fastCook('ore', I.RAW_SLAGBOAR_CHOP)).toBe(false); // (not the blast furnace)
    expect(canCampCook(I.RAW_SLAGBOAR_CHOP)).toBe(true);
    expect(campCooked(I.RAW_SLAGBOAR_CHOP)).toBe(I.SEARED_SLAGBOAR_CHOP);
    expect(canCampCook(I.SEARED_SLAGBOAR_CHOP)).toBe(false);
    expect(kindOfItem(I.RAW_SLAGBOAR_CHOP)).toBe('meat');
    expect(SMELTING[I.SEARED_SLAGBOAR_CHOP]).toBeUndefined();
  });
});

describe('Slagboar breeding and calm', () => {
  const lovers = (g) => {
    const a = put(g, 'slagboar', 0, 64, 0), b = put(g, 'slagboar', 1, 64, 0);
    const spawned = [];
    g.spawner = { spawnMob: (t, x, y, z) => { const baby = put(g, t, x, y, z); spawned.push(baby); return baby; } };
    return { a, b, spawned };
  };
  it('is fed Cinderroot, finds a mate and bears a young one that is calm', () => {
    const g = fakeGame(); const p = fakePlayer({ x: 40 });
    const { a, b, spawned } = lovers(g);
    expect(a.feed(g)).toBe(true); expect(b.feed(g)).toBe(true);
    ai(a, g, p, 2); ai(b, g, p, 2);
    const first = a.id < b.id ? a : b;
    for (let k = 0; k < 80; k++) { ai(a, g, p, 1); ai(b, g, p, 1); if (spawned.length) break; }
    expect(spawned).toHaveLength(1);
    const baby = spawned[0];
    expect(baby.age).toBeLessThan(0);
    expect(baby.calm).toBe(true);
    expect(first.age).toBeGreaterThan(0);
    expect(a.calm).toBeUndefined(); // the parents are still wild
  });
  it('a wild one is not calm; a calm one never charges, even next to the player', () => {
    const g = fakeGame(), p = fakePlayer({ x: 4 });
    const wild = put(g, 'slagboar', 0, 64, 0), tame = put(g, 'slagboar', 0, 64, 1);
    tame.calm = true;
    ai(wild, g, p, 3); ai(tame, g, p, 40);
    expect(wild.charge.state).not.toBe('idle');
    expect(tame.charge === undefined || tame.charge.state === 'idle').toBe(true);
    expect(p.hurts.every((h) => h[2] !== tame)).toBe(true);
  });
  it('a young one grows up after its time and a parent waits out the cooldown', () => {
    const g = fakeGame(), p = fakePlayer({ x: 40 });
    const baby = put(g, 'slagboar'); baby.setBaby(true); baby.calm = true;
    baby.age = -3;
    ai(baby, g, p, 3);
    expect(baby.age).toBe(0);
    expect(baby.width).toBeCloseTo(1.4, 5);
    const parent = put(g, 'slagboar'); parent.age = 2;
    ai(parent, g, p, 5);
    expect(parent.age).toBe(0);
  });
  it('the calm flag is saved with the mob and restored; a wild one saves nothing extra', () => {
    const g = fakeGame();
    const m = put(g, 'slagboar'); m.calm = true;
    const data = JSON.parse(JSON.stringify(m.saveData()));
    expect(data.calm).toBe(true);
    const back = new Mob('slagboar', 0, 64, 0); back.loadData(data);
    expect(back.calm).toBe(true);
    const wild = put(g, 'slagboar');
    const wdata = JSON.parse(JSON.stringify(wild.saveData()));
    expect(wdata.calm).toBeUndefined();
    const back2 = new Mob('slagboar', 0, 64, 0); back2.loadData(wdata);
    expect(back2.calm).toBeFalsy();
    expect(boarSave(m)).toEqual({ calm: true }); expect(boarSave(wild)).toEqual({});
    const x = {}; boarLoad(x, { calm: true }); expect(x.calm).toBe(true);
  });
  it('a baby calm from birth stays calm after growing up and reloading', () => {
    const g = fakeGame(), p = fakePlayer({ x: 3 });
    const baby = put(g, 'slagboar'); baby.setBaby(true); baby.calm = true; baby.age = -1;
    ai(baby, g, p, 2);
    expect(baby.age).toBe(0);
    const back = new Mob('slagboar', 0, 64, 0); back.loadData(JSON.parse(JSON.stringify(baby.saveData()))); back._game = g; back.canSee = () => true;
    ai(back, g, p, 60);
    expect(back.calm).toBe(true);
    expect(p.hurts).toHaveLength(0);
  });
});
