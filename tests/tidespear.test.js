import { describe, it, expect } from 'vitest';
import { I } from '../src/world/items.js';
import {
  ENCHANTS, categories, enchantability, canApply, compatible, availableEnchants, anvilCombine, meleeBonus,
  isWaterMob, harpoonBonus, canSurge, surgeVelocity,
} from '../src/world/enchantments.js';
import { Arrow } from '../src/entities/entities.js';
import {
  spearDamage, canPickUpSpear, shouldReturn, returnStep, stormcallStrikes, SPEAR_DAMAGE, SPEAR_STUCK_TICKS,
} from '../src/entities/tidespear.js';
import { MIN_Y } from '../src/world/constants.js';
import { Interaction } from '../src/player/interaction.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import { spearDropChance, soddenSpawnChance } from '../src/mobs/hostileVariants.js';
import { SPAWN_TABLES } from '../src/mobs/spawnRules.js';
import { SEA_LEVEL } from '../src/world/constants.js';
import { rng } from './helpers.js';

const spear = (ench) => ({ id: I.TIDESPEAR, count: 1, damage: 0, ...(ench ? { ench } : {}) });
const fish = { def: MOBS.silverfin }, shambler = { def: MOBS.shambler };

/** A tiny world: solid below y 60, nothing in the way above. */
function fakeGame({ player = null, thundering = false, mobs = [] } = {}) {
  const drops = [], bolts = [];
  const world = {
    raycast(x, y, z, dx, dy, dz, len) {
      if (dy >= 0) return null;
      const t = (y - 60) / -dy;
      return t <= len ? { dist: t } : null;
    },
    getBlock: () => 0,
    heightAt: () => 59,
  };
  const game = {
    world, net: null, audio: { play() {} }, player, drops, bolts,
    weather: { thundering, level: thundering ? 1 : 0 },
    strikeLightning: (x, y, z) => bolts.push([x, y, z]),
    entities: {
      sweepHit: () => mobs.shift() || null,
      spawnItem: (x, y, z, st) => drops.push(st),
    },
  };
  return game;
}

function fakePlayer(creative = false) {
  const slots = new Array(36).fill(null);
  return {
    isPlayer: true, dead: false, creative, x: 0, y: 64, z: 0, eyeHeight: 1.62,
    inventory: { slots, add(st) { const i = slots.indexOf(null); if (i < 0) return st.count; slots[i] = st; return 0; }, changed() {} },
  };
}

describe('Tidespear enchantments', () => {
  it('are table enchantments for spears only (books aside), with the reference weights and level windows', () => {
    expect(categories(I.TIDESPEAR)).toEqual(['spear']);
    expect(enchantability(I.TIDESPEAR)).toBe(1);
    for (const k of ['homing_tide', 'tidal_surge', 'harpoon', 'stormcall']) {
      expect(canApply(k, I.TIDESPEAR)).toBe(true);
      expect(canApply(k, I.DIAMOND_SWORD)).toBe(false);
      expect(canApply(k, I.BOOK)).toBe(true);
    }
    expect(canApply('keen', I.TIDESPEAR)).toBe(false);
    expect(canApply('steadfast', I.TIDESPEAR)).toBe(true);
    expect([ENCHANTS.homing_tide.max, ENCHANTS.tidal_surge.max, ENCHANTS.harpoon.max, ENCHANTS.stormcall.max]).toEqual([3, 3, 5, 1]);
    expect(ENCHANTS.homing_tide.min(3)).toBe(26);
    expect(ENCHANTS.homing_tide.maxCost(1)).toBe(50);
    expect(ENCHANTS.harpoon.maxCost(5)).toBe(53);
    expect(ENCHANTS.stormcall.min(1)).toBe(25);
  });
  it('Tidal Surge excludes Homing Tide and Stormcall, which go together', () => {
    expect(compatible('tidal_surge', 'homing_tide')).toBe(false);
    expect(compatible('homing_tide', 'tidal_surge')).toBe(false);
    expect(compatible('stormcall', 'tidal_surge')).toBe(false);
    expect(compatible('homing_tide', 'stormcall')).toBe(true);
    expect(compatible('harpoon', 'tidal_surge')).toBe(true);
    // the anvil refuses a Tidal Surge book on a Homing Tide spear
    const r = anvilCombine(spear({ homing_tide: 2 }), { id: I.ENCHANTED_BOOK, count: 1, ench: { tidal_surge: 1 } });
    expect(r && r.result.ench.tidal_surge).toBeFalsy();
    const ok = anvilCombine(spear({ homing_tide: 2 }), { id: I.ENCHANTED_BOOK, count: 1, ench: { stormcall: 1 } });
    expect(ok.result.ench).toEqual({ homing_tide: 2, stormcall: 1 });
  });
  it('the table offers them at the right levels', () => {
    const keys = (lvl) => availableEnchants(I.TIDESPEAR, lvl).map(([k]) => k).sort();
    expect(keys(5)).toEqual(['harpoon', 'steadfast']);
    expect(keys(30)).toEqual(['harpoon', 'homing_tide', 'steadfast', 'stormcall', 'tidal_surge']);
    expect(availableEnchants(I.TIDESPEAR, 30).find(([k]) => k === 'homing_tide')[1]).toBe(3);
  });
  it('Harpoon adds 2.5 per level against water mobs only, in melee and when thrown', () => {
    expect(isWaterMob(fish)).toBe(true);
    expect(isWaterMob({ def: MOBS.inkling })).toBe(true);
    expect(isWaterMob(shambler)).toBe(false);
    expect(harpoonBonus(spear({ harpoon: 4 }), fish)).toBe(10);
    expect(harpoonBonus(spear({ harpoon: 4 }), shambler)).toBe(0);
    expect(meleeBonus(spear({ harpoon: 2 }), fish)).toBe(5);
    expect(spearDamage(spear({ harpoon: 5 }), fish)).toBe(SPEAR_DAMAGE + 12.5);
    expect(spearDamage(null, shambler)).toBe(8);
  });
  it('Tidal Surge needs water or rain and launches harder with each level', () => {
    expect(canSurge(1, { inWater: false, inRain: false })).toBe(false);
    expect(canSurge(1, { inWater: true })).toBe(true);
    expect(canSurge(3, { inRain: true })).toBe(true);
    expect(canSurge(0, { inWater: true })).toBe(false);
    expect(surgeVelocity(1, [0, 0, -2])).toEqual([0, 0, -1.5]);
    expect(Math.hypot(...surgeVelocity(3, [1, 1, 0]))).toBeCloseTo(3);
  });
  it('Stormcall strikes only in a thunderstorm under open sky', () => {
    expect(stormcallStrikes(1, true, true)).toBe(true);
    expect(stormcallStrikes(1, false, true)).toBe(false);
    expect(stormcallStrikes(1, true, false)).toBe(false);
    expect(stormcallStrikes(0, true, true)).toBe(false);
  });
});

describe('thrown Tidespear', () => {
  it('sticks into the block it hits and only its thrower can pull it out', () => {
    const p = fakePlayer(), other = fakePlayer();
    const game = fakeGame({ player: other });
    const a = new Arrow(0, 61, 0, 0, -2, 0, p, false, 'spear');
    a.item = spear({ harpoon: 1 }); a.pickup = true;
    a.tick(game);
    expect(a.stuck).toBe(true);
    expect(a.dead).toBe(false);
    expect(a.y).toBeCloseTo(60);
    expect(canPickUpSpear(a, other)).toBe(false);
    expect(canPickUpSpear(a, p)).toBe(true);
    // another player standing on it gets nothing
    other.y = 59.5;
    a.tick(game);
    expect(a.dead).toBe(false);
    expect(other.inventory.slots.every((s) => !s)).toBe(true);
    // the thrower does, with its enchantments
    game.player = p; p.y = 59.5;
    a.tick(game);
    expect(a.dead).toBe(true);
    expect(p.inventory.slots[0]).toMatchObject({ id: I.TIDESPEAR, ench: { harpoon: 1 } });
  });
  it('a creative thrower kept theirs: pulling it out gives nothing, and it never drops', () => {
    const p = fakePlayer(true);
    const game = fakeGame({ player: p });
    const a = new Arrow(5, 61, 5, 0, -2, 0, p, false, 'spear');
    a.item = spear(); a.creativeThrow = true;
    a.tick(game);
    for (let i = 0; i <= SPEAR_STUCK_TICKS; i++) a.tick(game);
    expect(a.dead).toBe(true);
    expect(game.drops).toEqual([]);
  });
  it('left stuck for a minute it pops out as a dropped item', () => {
    const p = fakePlayer();
    const game = fakeGame({ player: fakePlayer() });
    const a = new Arrow(5, 61, 5, 0, -2, 0, p, false, 'spear');
    a.item = spear();
    for (let i = 0; i < SPEAR_STUCK_TICKS + 2 && !a.dead; i++) a.tick(game);
    expect(a.dead).toBe(true);
    expect(game.drops).toEqual([spear()]);
  });
  it('hits a mob once for 8 (+ Harpoon), then glances off and falls', () => {
    const hits = [];
    const mob = { kind: 'mob', def: MOBS.silverfin, x: 0, y: 70, z: 0, hurt: (d) => { hits.push(d); return true; } };
    const game = fakeGame({ player: fakePlayer(), mobs: [mob, mob] });
    const a = new Arrow(0, 71, 0, 0, 0, -2.5, fakePlayer(), false, 'spear');
    a.item = spear({ harpoon: 2 });
    a.tick(game);
    expect(hits).toEqual([13]);
    expect(a.dealtDamage).toBe(true);
    expect(Math.abs(a.vz)).toBeLessThan(0.1);
    a.tick(game);
    expect(hits.length).toBe(1);
  });
  it('a Sodden Shambler\'s spear vanishes on a hit and never turns into an item', () => {
    const mob = { kind: 'mob', def: MOBS.shambler, x: 0, y: 70, z: 0, hurt: () => true };
    const game = fakeGame({ player: fakePlayer(), mobs: [mob] });
    const a = new Arrow(0, 71, 0, 0, 0, -2.5, { kind: 'mob' }, false, 'spear');
    a.tick(game);
    expect(a.dead).toBe(true);
    const b = new Arrow(0, 61, 0, 0, -2, 0, { kind: 'mob' }, false, 'spear');
    for (let i = 0; i < 100; i++) b.tick(game);
    expect(b.dead).toBe(true);
    expect(game.drops).toEqual([]);
  });
  it('Stormcall calls lightning on the mob it hits in a thunderstorm', () => {
    const mob = { kind: 'mob', def: MOBS.shambler, x: 3.5, y: 64, z: 3.5, hurt: () => true };
    const game = fakeGame({ player: fakePlayer(), thundering: true, mobs: [mob] });
    const a = new Arrow(3.5, 65, 0, 0, 0, 2.5, fakePlayer(), false, 'spear');
    a.item = spear({ stormcall: 1 });
    a.tick(game);
    expect(game.bolts).toEqual([[3, 64, 3]]);
    const calm = fakeGame({ player: fakePlayer(), thundering: false, mobs: [mob] });
    const b = new Arrow(3.5, 65, 0, 0, 0, 2.5, fakePlayer(), false, 'spear');
    b.item = spear({ stormcall: 1 });
    b.tick(calm);
    expect(calm.bolts).toEqual([]);
  });
});

describe('Homing Tide', () => {
  it('turns back after sticking, flies home through anything and lands in the thrower\'s inventory', () => {
    const p = fakePlayer();
    p.x = 0; p.y = 60; p.z = 20;
    const game = fakeGame({ player: p });
    const a = new Arrow(0, 61, 0, 0, -2, 0, p, false, 'spear');
    a.item = spear({ homing_tide: 3 });
    a.tick(game);
    expect(a.stuck).toBe(true);
    expect(shouldReturn(a)).toBe(true);
    let n = 0;
    while (!a.dead && n < 400) { a.tick(game); n++; }
    expect(a.dead).toBe(true);
    expect(n).toBeLessThan(80);
    expect(p.inventory.slots[0]).toMatchObject({ id: I.TIDESPEAR, ench: { homing_tide: 3 } });
  });
  it('higher levels come back faster; no return without the enchantment, to a dead thrower, or a mob', () => {
    const steps = (lvl) => { const s = { x: 0, y: 60, z: 0, vx: 0, vy: 0, vz: 0 }; let n = 0; while (Math.hypot(s.x, s.y - 61.5, s.z - 30) > 1.4 && n < 1000) { returnStep(s, 0, 61.5, 30, lvl); n++; } return n; };
    expect(steps(3)).toBeLessThan(steps(1));
    const p = fakePlayer();
    expect(shouldReturn({ item: spear(), shooter: p, stuck: true })).toBe(false);
    expect(shouldReturn({ item: spear({ homing_tide: 1 }), shooter: { ...p, dead: true }, stuck: true })).toBe(false);
    expect(shouldReturn({ item: spear({ homing_tide: 1 }), shooter: { kind: 'mob' }, stuck: true })).toBe(false);
    expect(shouldReturn({ item: spear({ homing_tide: 1 }), shooter: p, stuck: false, y: 64 })).toBe(false);
    expect(shouldReturn({ item: spear({ homing_tide: 1 }), shooter: p, stuck: false, y: MIN_Y - 1 })).toBe(true);
    expect(shouldReturn({ item: spear({ homing_tide: 1 }), shooter: p, dealtDamage: true, y: 64 })).toBe(true);
  });
  it('a thrower who died meanwhile gets it dropped where it is', () => {
    const p = fakePlayer();
    const game = fakeGame({ player: p });
    const a = new Arrow(0, 61, 0, 0, -2, 0, p, false, 'spear');
    a.item = spear({ homing_tide: 1 });
    a.tick(game); a.tick(game);
    expect(a.returning).toBe(true);
    p.dead = true;
    a.tick(game);
    expect(a.dead).toBe(true);
    expect(game.drops.length).toBe(1);
  });
});

describe('throwing and surging', () => {
  function interaction(stack, { inWater = false, creative = false } = {}) {
    const arrows = [];
    const slots = [stack];
    const inv = { slots, selected: 0, get selectedStack() { return slots[0]; }, damageSelected(n) { slots[0].damage = (slots[0].damage | 0) + n; }, changed() {} };
    const body = { vx: 0, vy: 0, vz: 0, onGround: true, inWater, fallDistance: 3 };
    const player = { inventory: inv, creative, body, x: 0, y: 64, z: 0, eyePos: () => [0, 65.6, 0], lookDir: () => [0, 0, -1] };
    const game = { player, world: { rainingAt: () => false }, audio: { play() {} }, entities: { list: [], spawnArrow: (...a) => { arrows.push(a); return {}; } } };
    const it = Object.create(Interaction.prototype);
    it.game = game; it.bowDraw = 0;
    const st = () => ({ right: false, rightPressed: false, left: false, leftPressed: false });
    return { it, game, arrows, st };
  }
  it('Tidal Surge launches the player instead of throwing (in water) and keeps the spear', () => {
    const { it, game, arrows } = interaction(spear({ tidal_surge: 3 }), { inWater: true });
    expect(canSurge(3, it.surgeConditions())).toBe(true);
    it.surge(3);
    expect(arrows.length).toBe(0);
    expect(game.player.body.vz).toBeCloseTo(-3);
    expect(game.player.body.vy).toBeGreaterThan(0);
    expect(game.player.body.fallDistance).toBe(0);
    expect(game.player.inventory.slots[0]).toMatchObject({ id: I.TIDESPEAR, damage: 1 });
    expect(it.surgeTicks).toBe(20);
  });
  it('the surge spin hits mobs in its path once and bounces the player back', () => {
    const { it, game } = interaction(spear({ tidal_surge: 1, harpoon: 1 }), { inWater: true });
    it.surge(1);
    const hits = [];
    game.entities.list.push({ kind: 'mob', deathTime: 0, def: MOBS.silverfin, x: 0.3, y: 64, z: 0, body: { width: 0.5, height: 0.3 }, hurt: (d) => { hits.push(d); return true; } });
    const vz = game.player.body.vz;
    it.tickSurge();
    expect(hits).toEqual([10.5]);
    expect(game.player.body.vz).toBeCloseTo(-0.2 * vz);
    expect(it.surgeTicks).toBe(0);
  });
  it('out of water and rain a Tidal Surge spear cannot be used', () => {
    const { it } = interaction(spear({ tidal_surge: 1 }));
    expect(canSurge(1, it.surgeConditions())).toBe(false);
  });
});

describe('Sodden Shambler and its Tidespear', () => {
  it('drops a carried Tidespear very rarely: 8.5 % + 1 % per Plunder level', () => {
    expect(spearDropChance(0)).toBeCloseTo(0.085);
    expect(spearDropChance(3)).toBeCloseTo(0.115);
    const d = MOBS.sodden_shambler, drops = [];
    const g = { entities: { spawnItem: (x, y, z, st) => drops.push(st) } };
    const r = rng(9), orig = Math.random;
    Math.random = r;
    try { for (let i = 0; i < 4000; i++) d.onDeath({ special: true, x: 0, y: 0, z: 0, plunder: 0 }, g, true); } finally { Math.random = orig; }
    expect(drops.length / 4000).toBeGreaterThan(0.065);
    expect(drops.length / 4000).toBeLessThan(0.105);
    expect(drops[0].id).toBe(I.TIDESPEAR);
  });
  it('spawns in rivers (1 attempt in 15) as well as deep ocean water', () => {
    expect(SPAWN_TABLES.monster.river.some((e) => e.type === 'sodden_shambler')).toBe(true);
    const r = rng(4);
    let n = 0;
    for (let i = 0; i < 30000; i++) if (soddenSpawnChance('frozen_river', SEA_LEVEL - 1, SEA_LEVEL, r)) n++;
    expect(n / 30000).toBeCloseTo(1 / 15, 2);
  });
});
