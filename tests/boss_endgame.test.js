// Boss and endgame depth: the Slag Colossus (Cinderforge boss), tempering at the anvil (Forgebite, Forgeward,
// Forgegrip), Sunmend, the boss bar, the endgame elixirs, and their help, guide, sound and balance coverage.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '../src/mobs/dimensionMobs.js';
import '../src/mobs/slagColossus.js';
import {
  COLOSSUS, phaseOf, phaseFloor, clampToPhase, waveStrikes, pillarStrikes, damageFactor, forgeAt, riseSpot, summonColossus,
  colossusAI, colossusHurt, colossusDeath, colossiIn, SLAG_COLOSSUS,
} from '../src/mobs/slagColossus.js';
import { Mob } from '../src/mobs/mob.js';
import { MOBS, MOB_KEYS } from '../src/mobs/mobTypes.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { rollDrops } from '../src/mobs/drops.js';
import { I, ITEMS, POTION_ITEM, SPLASH_ITEM, LINGERING_ITEM, TIPPED_ARROW } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';
import { forgeInRegion, FORGE_HALF } from '../src/world/dimensions/cinderForge.js';
import {
  ENCHANTS, ENCH_KEYS, TEMPER_STEPS, temperKey, temperStepOf, temperCombine, anvilCombine, availableEnchants, meleeBonus,
  protectionFactor, mendFromXp, cleanEnch, canApply, compatible, enchName, tableOffers, enchantability,
} from '../src/world/enchantments.js';
import { POTIONS, brewKind, baseKind, EFFECT_INGREDIENTS } from '../src/world/potions.js';
import { bossBarInfo, barPhase } from '../src/ui/bossBar.js';
import { CAPTION_TEXT } from '../src/ui/accessibility.js';
import { RECIPES, craft } from '../src/player/crafting.js';
import { MILESTONES } from '../src/player/milestones.js';
import { entriesOf, resetGuideEntries } from '../src/player/fieldGuideEntries.js';
import { buildTopics } from '../src/ui/helpTopics.js';
import { defaultTable } from '../src/ui/bindings.js';
import { armorSets, damageAfter, bossTable } from '../scripts/balance/combat.mjs';
import { maxProtection } from '../scripts/balance/misc.mjs';
import { HUSHKEEPER } from '../src/mobs/hushkeeper.js';
import '../src/world/dimensions/register.js';

const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const K = COLOSSUS;

// ---- a minimal game for the fight ------------------------------------------------------
function fakeGame(over = {}) {
  const list = [], items = [];
  const hurts = [];
  const player = {
    x: 10, y: 64, z: 0, dead: false, creative: false, isPlayer: true, eyeHeight: 1.62, fireTicks: 0, body: { vx: 0, vy: 0, vz: 0 },
    hurt: vi.fn((amount, source, attacker) => { hurts.push({ amount, source }); return true; }),
  };
  const g = {
    ticks: 0, difficulty: 'normal', settings: {},
    world: { dimension: 'cinderdeep', dimGenerator: null, getBlock: () => 0, heightAt: () => 63, raycast: () => null },
    entities: { list, spawnItem: vi.fn((x, y, z, st) => { items.push(st); }), spawnXp: vi.fn(), add: vi.fn((e) => { list.push(e); return e; }) },
    particles: { emit: vi.fn(), smoke: vi.fn(), flame: vi.fn() },
    audio: { play: vi.fn() },
    milestones: { event: vi.fn() },
    hud: { toast: vi.fn() },
    player,
    ...over,
  };
  g.spawner = { spawnMob: (t, x, y, z) => { const c = new Mob(t, x, y, z); c._game = g; list.push(c); return c; } };
  return { g, items, hurts, player, list };
}
/** A Colossus standing in the middle of a courtyard at (0, 64, 0). */
function colossus(g, over = {}) {
  const m = new Mob('slag_colossus', 0, 64, 0);
  m._game = g;
  m.arena = { x: 0, y: 64, z: 0 };
  Object.assign(m, over);
  g.entities.list.push(m);
  return m;
}
/** One AI step the way Mob.tick does it, with the player as the nearest target. */
function step(m, g, n = 1) {
  for (let k = 0; k < n; k++) {
    g.ticks++;
    const p = g.player, pd = Math.hypot(p.x - m.x, p.y - m.y, p.z - m.z);
    colossusAI(m, g, p, pd);
    if (m.invulnerable > 0) m.invulnerable--;
  }
}

describe('append-only ids and registration', () => {
  it('the Sigil and the Core are the newest items, after everything older', () => {
    expect(I.COLOSSUS_CORE).toBe(I.SLAG_SIGIL + 1);
    expect(I.SLAG_SIGIL).toBeGreaterThan(I.THISTLE_HARNESS);
    expect(ITEMS[I.SLAG_SIGIL].stack).toBe(1);
    expect(ITEMS[I.SLAG_SIGIL].sigil).toBe('slag_colossus');
  });

  it('the endgame elixirs are late kinds whose items come after the older elixirs', () => {
    for (const k of ['haste', 'long_haste', 'strong_haste', 'ironskin', 'long_ironskin', 'strong_ironskin', 'warding', 'long_warding', 'strong_warding']) {
      expect(POTIONS[k].late, k).toBe(true);
      expect(POTION_ITEM[k], k).toBeGreaterThan(POTION_ITEM.unluck);
      expect(SPLASH_ITEM[k]).toBeTruthy();
      expect(LINGERING_ITEM[k]).toBeTruthy();
      expect(TIPPED_ARROW[k]).toBeTruthy();
    }
  });

  it('the Colossus is registered as a boss with a boss bar, and keeps the 25-field mob snapshot', () => {
    expect(MOB_KEYS).toContain('slag_colossus');
    const d = MOBS.slag_colossus;
    expect(d.boss).toBe(true);
    expect(d.bossBar.phases).toEqual(K.PHASE_AT);
    expect(d.health).toBe(K.HEALTH);
    expect(d.noDespawn && d.fireImmune && d.knockbackResist).toBe(true);
    const m = new Mob('slag_colossus', 3, 64, 4);
    m.angry = true; m.special = true;
    const wire = packMob(m);
    expect(wire).toHaveLength(25);
    const back = unpackMob(JSON.parse(JSON.stringify(wire)));
    expect(back).toMatchObject({ type: 'slag_colossus', x: 3, z: 4, health: K.HEALTH, angry: true, special: true });
  });

  it('is saved with the world and keeps its arena and phase', () => {
    const m = new Mob('slag_colossus', 0, 64, 0);
    SLAG_COLOSSUS.onSpawn(m);
    expect(m.persistent).toBe(true);
    m.arena = { x: 5.5, y: 60, z: -3.5 }; m.cphase = 2; m.health = 150;
    const data = JSON.parse(JSON.stringify(m.saveData()));
    const n = new Mob('slag_colossus', 0, 64, 0);
    n.loadData(data);
    expect(n.health).toBe(150);
    expect(n.arena).toEqual({ x: 5.5, y: 60, z: -3.5 });
    expect(n.cphase).toBe(2);
    // a hand-edited save cannot give it a nonsense arena
    n.loadData({ ...data, arena: { x: 'a', y: 1, z: 2 }, cphase: 99 });
    expect(n.arena).toEqual({ x: 5.5, y: 60, z: -3.5 });
    expect(n.cphase).toBe(3);
  });
});

describe('the rules of the fight', () => {
  it('three phases at 66 % and 33 %', () => {
    expect(phaseOf(1)).toBe(1);
    expect(phaseOf(0.67)).toBe(1);
    expect(phaseOf(0.66)).toBe(2);
    expect(phaseOf(0.34)).toBe(2);
    expect(phaseOf(0.33)).toBe(3);
    expect(phaseOf(0)).toBe(3);
  });

  it('a blow stops at the next threshold instead of skipping a phase', () => {
    expect(phaseFloor(1)).toBeCloseTo(264);
    expect(phaseFloor(2)).toBeCloseTo(132);
    expect(phaseFloor(3)).toBe(0);
    expect(clampToPhase(300, 20, 1)).toBe(20);
    expect(clampToPhase(270, 50, 1)).toBeCloseTo(6);
    expect(clampToPhase(264, 50, 1)).toBe(0);
    expect(clampToPhase(140, 500, 2)).toBeCloseTo(8);
    expect(clampToPhase(50, 500, 3)).toBe(500); // the last phase has nothing to protect
  });

  it('the shockwave only strikes feet on the floor, once it reaches them', () => {
    expect(waveStrikes(4, 3.5, 0)).toBe(true);
    expect(waveStrikes(4, 3.5, 1.3)).toBe(false); // jumped
    expect(waveStrikes(4, 9, 0)).toBe(false);      // not there yet
    expect(waveStrikes(4, 0.5, 0)).toBe(false);    // the ring has already passed
    expect(waveStrikes(K.SLAM_RADIUS + 3, K.SLAM_RADIUS + 2, 0)).toBe(false); // it dies out
  });

  it('a pillar reaches a small circle and some head room', () => {
    expect(pillarStrikes(1, 0)).toBe(true);
    expect(pillarStrikes(K.PILLAR_RADIUS + 0.1, 0)).toBe(false);
    expect(pillarStrikes(0.5, 6)).toBe(false);
  });

  it('a stunned Colossus takes half again as much', () => {
    expect(damageFactor(false)).toBe(1);
    expect(damageFactor(true)).toBe(1.5);
  });

  it('fire does not hurt it, blasts only half, and shielded it takes nothing', () => {
    const { g } = fakeGame();
    const m = colossus(g, { cphase: 1, cs: 'walk' });
    expect(colossusHurt(m, 10, 'fireball')).toBe(0);
    expect(colossusHurt(m, 10, 'lava')).toBe(0);
    expect(colossusHurt(m, 10, 'explosion')).toBe(5);
    expect(colossusHurt(m, 10, 'player')).toBe(10);
    m.cs = 'shield';
    expect(colossusHurt(m, 10, 'player')).toBe(0);
    m.cs = 'stunned';
    expect(colossusHurt(m, 10, 'player')).toBe(15);
  });
});

describe('waking it', () => {
  it('finds the forge whose courtyard holds a point', () => {
    let f = null;
    const gen = { seed: 77, bastionsNear: () => [] };
    for (let rx = 0; rx < 6 && !f; rx++) for (let rz = 0; rz < 6 && !f; rz++) f = forgeInRegion(gen, rx, rz);
    expect(f).toBeTruthy();
    expect(forgeAt(gen, f.cx, f.y + 1, f.cz)).toBe(f);
    expect(forgeAt(gen, f.cx + FORGE_HALF, f.y + 1, f.cz - FORGE_HALF)).toBe(f);
    expect(forgeAt(gen, f.cx + FORGE_HALF + 3, f.y + 1, f.cz)).toBe(null);
    expect(forgeAt(gen, f.cx, f.y + 20, f.cz)).toBe(null);
    const s = riseSpot(f);
    expect(Math.abs(s.x - f.cx)).toBeLessThanOrEqual(FORGE_HALF);
    expect(Math.abs(s.z - f.cz)).toBeLessThanOrEqual(FORGE_HALF);
    expect(s.y).toBe(f.y + 1);
    expect(forgeAt(null, 0, 0, 0)).toBe(null);
  });

  function forgeGame() {
    let f = null;
    const gen = { seed: 77, bastionsNear: () => [] };
    for (let rx = 0; rx < 6 && !f; rx++) for (let rz = 0; rz < 6 && !f; rz++) f = forgeInRegion(gen, rx, rz);
    const fg = fakeGame();
    fg.g.world.dimGenerator = gen;
    return { ...fg, f };
  }

  it('refuses outside a Cinderforge, in the wrong dimension, for guests, in peace and when one already stands', () => {
    const { g, f } = forgeGame();
    expect(summonColossus(g, f.cx + 40, f.y + 1, f.cz).ok).toBe(false);
    g.world.dimension = 'overworld';
    expect(summonColossus(g, f.cx, f.y + 1, f.cz).msg).toMatch(/Cinderforge/);
    g.world.dimension = 'cinderdeep';
    g.net = { isClient: true };
    expect(summonColossus(g, f.cx, f.y + 1, f.cz).msg).toMatch(/host/);
    g.net = null;
    g.difficulty = 'peaceful';
    expect(summonColossus(g, f.cx, f.y + 1, f.cz).ok).toBe(false);
    g.difficulty = 'normal';
    g.settings.hostileMobs = false;
    expect(summonColossus(g, f.cx, f.y + 1, f.cz).ok).toBe(false);
    expect(colossiIn(g.entities.list)).toHaveLength(0);
  });

  it('rises shielded in the courtyard, once at a time', () => {
    const { g, f } = forgeGame();
    const r = summonColossus(g, f.cx, f.y + 1, f.cz + 4);
    expect(r.ok).toBe(true);
    const m = r.mob;
    expect(m.type).toBe('slag_colossus');
    expect(m.cs).toBe('shield');
    expect(m.ct).toBe(K.INTRO);
    expect(m.arena).toEqual({ x: f.cx + 0.5, y: f.y + 1, z: f.cz + 0.5 });
    expect(g.audio.play).toHaveBeenCalledWith('colossus_roar', expect.anything(), 1);
    expect(colossusHurt(m, 20, 'player')).toBe(0); // cannot be hurt while it rises
    expect(summonColossus(g, f.cx, f.y + 1, f.cz).msg).toMatch(/already/);
    step(m, g, K.INTRO + 1);
    expect(m.cs).toBe('walk');
  });

  it('the sigil is made from Slagsteel, Ember Rods, a Dirge Crystal and Obsidian', () => {
    const r = RECIPES.find((x) => x.result === I.SLAG_SIGIL);
    expect(r).toBeTruthy();
    const s = (id) => ({ id, count: 1 });
    const grid = [s(I.EMBER_ROD), s(I.SLAGSTEEL_INGOT), s(I.EMBER_ROD), s(I.SLAGSTEEL_INGOT), s(I.DIRGE_CRYSTAL), s(I.SLAGSTEEL_INGOT), s(B.OBSIDIAN), s(I.SLAGSTEEL_INGOT), s(B.OBSIDIAN)];
    expect(craft(grid, 3)).toMatchObject({ id: I.SLAG_SIGIL, count: 1 });
  });

  it('item use is wired to the interaction code and the guest case says so', () => {
    expect(src('src/player/interaction.js')).toContain('d.sigil');
    expect(src('src/player/interaction.js')).toContain('summonColossus');
  });
});

describe('the fight, step by step', () => {
  it('phase 1: close in, rear up (arms raised: angry), then a shockwave that grounded players feel and jumpers do not', () => {
    const { g, hurts, player } = fakeGame();
    const m = colossus(g);
    player.x = 5.5; player.z = 0; // inside the slam's reach, outside its arm's
    m.cd = { slam: 0, hurl: 999, pillar: 999, charge: 999 };
    m.pillars = []; m.away = 0; m.cs = 'walk'; m.ct = 0; m.cphase = 1;
    step(m, g, 1);
    expect(m.cs).toBe('slamWind');
    step(m, g, 3);
    expect(m.angry).toBe(true); // the telegraph the guests see
    expect(hurts).toHaveLength(0);
    step(m, g, K.SLAM_WINDUP);
    expect(m.cs).toBe('recover');
    expect(m.wave).toBeTruthy();
    expect(m.cd.slam).toBeGreaterThan(K.SLAM_COOLDOWN[0] - 5); // (counting down already)
    step(m, g, 6);
    expect(hurts).toHaveLength(1);
    expect(hurts[0]).toEqual({ amount: K.SLAM_DAMAGE, source: 'mob:Slag Colossus' });
    // the same wave never hits twice
    step(m, g, 12);
    expect(hurts).toHaveLength(1);
    // recovering, it is open (flag for the dazed pose)
    expect(m.wave).toBe(null);
  });

  it('a player who jumps over the wave takes nothing', () => {
    const { g, hurts, player } = fakeGame();
    const m = colossus(g);
    player.x = 4; player.y = 65.6; // in the air all the way
    m.cd = { slam: 0, hurl: 999, pillar: 999, charge: 999 };
    m.pillars = []; m.away = 0; m.cs = 'slamWind'; m.ct = 1; m.cphase = 1;
    step(m, g, 12);
    expect(hurts).toHaveLength(0);
  });

  it('hurts every player in a shared world, not only the nearest', () => {
    const second = { x: 6.2, y: 64, z: 0, dead: false, creative: false, isPlayer: true, hurt: vi.fn(() => true), body: { vx: 0, vy: 0, vz: 0 } };
    const { g, player } = fakeGame();
    player.x = 5.5;
    g.net = { isHost: true, players: () => [{ obj: g.player }, { obj: second }] };
    const m = colossus(g);
    m.cd = { slam: 999, hurl: 999, pillar: 999, charge: 999 };
    m.pillars = []; m.away = 0; m.cs = 'walk'; m.ct = 0; m.cphase = 1;
    m.wave = { r: 1.5, hit: new Set() };
    step(m, g, 8);
    expect(player.hurt).toHaveBeenCalledTimes(1);
    expect(second.hurt).toHaveBeenCalledTimes(1);
  });

  it('moving up a phase: shielded, shoved back, company called, and the next blow cannot skip a phase', () => {
    const { g, player, list } = fakeGame();
    const m = colossus(g);
    player.x = 5;
    m.cd = { slam: 999, hurl: 999, pillar: 999, charge: 999 };
    m.pillars = []; m.away = 0; m.cs = 'walk'; m.ct = 0; m.cphase = 1;
    m.health = 270;
    expect(colossusHurt(m, 100, 'player')).toBeCloseTo(6); // stops at 264
    m.health = 264;
    step(m, g, 1);
    expect(m.cphase).toBe(2);
    expect(m.cs).toBe('shield');
    expect(m.special && m.angry).toBe(true);
    expect(player.body.vx).toBeGreaterThan(0.5); // shoved back
    expect(list.filter((e) => e.type === 'cinder_brute')).toHaveLength(K.ADDS[1]);
    expect(colossusHurt(m, 10, 'player')).toBe(0);
    step(m, g, K.SHIELD + 1);
    expect(m.cs).toBe('walk');
    // the third phase calls one more, up to three in all
    m.health = 130;
    step(m, g, 1);
    expect(m.cphase).toBe(3);
    expect(list.filter((e) => e.type === 'cinder_brute')).toHaveLength(K.ADDS[1] + K.ADDS[2]);
    expect(K.ADDS[1] + K.ADDS[2]).toBeLessThanOrEqual(K.ADDS_MAX);
  });

  it('phase 2 marks lava pillars with a warning, then they burst for damage', () => {
    const { g, hurts, player } = fakeGame();
    const m = colossus(g, { cphase: 2 });
    player.x = 6; player.z = 0;
    m.cd = { slam: 999, hurl: 999, pillar: 0, charge: 999 };
    m.pillars = []; m.away = 0; m.cs = 'walk'; m.ct = 0; m.health = 250;
    g.world.getBlock = (x, y) => (y <= 63 ? 1 : 0); // a floor to stand on
    step(m, g, 1);
    expect(m.pillars.length).toBeGreaterThanOrEqual(1);
    expect(m.pillars.length).toBeLessThanOrEqual(K.PILLARS[1]);
    expect(m.pillars[0].t).toBeLessThanOrEqual(K.PILLAR_WARN);
    expect(hurts).toHaveLength(0); // a warning first
    step(m, g, K.PILLAR_WARN + 1);
    expect(hurts.some((h) => h.amount === K.PILLAR_DAMAGE)).toBe(true); // the first pillar is under the player's feet
    expect(player.fireTicks).toBeGreaterThan(0);
    expect(m.pillars).toHaveLength(0);
    expect(m.cd.pillar).toBeGreaterThan(0);
  });

  it('phase 3 charges after a telegraph, and a wall stuns it (and the stun makes it vulnerable)', () => {
    const { g, player } = fakeGame();
    const m = colossus(g, { cphase: 3 });
    player.x = 12; player.z = 0;
    m.cd = { slam: 999, hurl: 999, pillar: 999, charge: 0 };
    m.pillars = []; m.away = 0; m.cs = 'walk'; m.ct = 0; m.health = 100;
    g.world.getBlock = (x, y) => (y <= 63 ? 1 : 0);
    m.canSee = () => true;
    step(m, g, 1);
    expect(m.cs).toBe('chargeWind');
    step(m, g, 3);
    expect(m.angry).toBe(true);
    step(m, g, K.CHARGE_WINDUP);
    expect(m.cs).toBe('charge');
    m.body.horizontalCollision = true;
    step(m, g, 6);
    expect(m.cs).toBe('stunned');
    expect(m.special).toBe(true);
    expect(colossusHurt(m, 10, 'player')).toBe(15);
    expect(m.cd.charge).toBeGreaterThan(K.CHARGE_COOLDOWN - 10); // (counting down since the stun began)
    step(m, g, K.STUN + 1);
    expect(m.cs).toBe('walk');
  });

  it('a charge that connects hurts for 14 and flings', () => {
    const { g, hurts, player } = fakeGame();
    const m = colossus(g, { cphase: 3 });
    player.x = 2; player.z = 0;
    m.cd = { slam: 999, hurl: 999, pillar: 999, charge: 999 };
    m.pillars = []; m.away = 0; m.cs = 'charge'; m.ct = K.CHARGE_TICKS; m.health = 100; m.yaw = Math.atan2(-2, 0);
    g.world.getBlock = (x, y) => (y <= 63 ? 1 : 0);
    step(m, g, 1);
    expect(hurts.map((h) => h.amount)).toEqual([K.CHARGE_DAMAGE]);
    expect(player.body.vx).toBeGreaterThan(0.5);
  });

  it('with nobody to fight it mends, then withdraws and leaves the sigil behind', () => {
    const { g, player, items } = fakeGame();
    const m = colossus(g, { cphase: 2 });
    player.dead = true;
    m.cd = { slam: 999, hurl: 999, pillar: 999, charge: 999 };
    m.pillars = []; m.away = 0; m.cs = 'walk'; m.ct = 0; m.health = 200;
    step(m, g, 100);
    expect(m.health).toBeGreaterThan(200);
    step(m, g, K.GIVE_UP);
    expect(m.removed).toBe(true);
    expect(items.some((s) => s.id === I.SLAG_SIGIL)).toBe(true);
  });

  it('never wanders far from the courtyard while chasing', () => {
    const { g, player } = fakeGame();
    const m = colossus(g);
    m.body.setPos(K.LEASH + 10, 64, 0);
    player.x = K.LEASH + 20;
    m.cd = { slam: 999, hurl: 999, pillar: 999, charge: 999 };
    m.pillars = []; m.away = 0; m.cs = 'walk'; m.ct = 0; m.cphase = 1;
    step(m, g, 14);
    expect(m.move.forward).toBeGreaterThan(0);
    // heading back towards the arena (west), not after the player (east)
    const want = Math.atan2(-(0 - m.x), -(0 - m.z));
    expect(Math.abs(Math.atan2(Math.sin(m.yaw - want), Math.cos(m.yaw - want)))).toBeLessThan(0.5);
  });

  it('hurls Slag Balls from a distance (three in phase 2)', () => {
    const { g, player, list } = fakeGame();
    const m = colossus(g, { cphase: 2 });
    player.x = 12;
    m.cd = { slam: 999, hurl: 0, pillar: 999, charge: 999 };
    m.pillars = []; m.away = 0; m.cs = 'walk'; m.ct = 0; m.health = 250;
    m.canSee = () => true;
    step(m, g, 1);
    expect(list.filter((e) => e.kind === 'fireball')).toHaveLength(3);
    expect(m.cd.hurl).toBeGreaterThan(0);
  });
});

describe('what it leaves', () => {
  it('always drops one Colossus Core (Plunder does not multiply it) plus metals for the one who killed it', () => {
    const r = () => 0.5;
    const drops = rollDrops('slag_colossus', { killedByPlayer: true, plunder: 3 }, r);
    const core = drops.find((d) => d.id === I.COLOSSUS_CORE);
    expect(core.count).toBe(1);
    for (const id of [I.SLAGSTEEL_INGOT, I.DIRGE_CRYSTAL, I.EMBER_ROD]) expect(drops.some((d) => d.id === id)).toBe(true);
    expect(rollDrops('slag_colossus', { killedByPlayer: false }, r)).toEqual([]);
    expect(MOBS.slag_colossus.xp).toBeGreaterThanOrEqual(100);
  });

  it('its death sets the milestone and sometimes drops a Sunmend book', () => {
    const { g, items } = fakeGame();
    const m = colossus(g);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    colossusDeath(m, g, true);
    rnd.mockRestore();
    expect(g.milestones.event).toHaveBeenCalledWith('colossus');
    const book = items.find((s) => s.id === I.ENCHANTED_BOOK);
    expect(book.ench).toEqual({ sunmend: 1 });
    const { g: g2, items: items2 } = fakeGame();
    const m2 = colossus(g2);
    const rnd2 = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    colossusDeath(m2, g2, true);
    rnd2.mockRestore();
    expect(items2.some((s) => s.id === I.ENCHANTED_BOOK)).toBe(false);
    const { g: g3 } = fakeGame();
    colossusDeath(colossus(g3), g3, false);
    expect(g3.milestones.event).not.toHaveBeenCalled();
  });

  it('the milestones exist and the defeat one is an event', () => {
    for (const id of ['sigil', 'colossus', 'temper']) expect(MILESTONES.some((m) => m.id === id), id).toBe(true);
    expect(MILESTONES.find((m) => m.id === 'colossus').event).toBe('colossus');
    expect(MILESTONES.find((m) => m.id === 'temper').event).toBe('temper');
    expect(src('src/ui/screens.js')).toContain("event('temper')");
  });
});

describe('tempering at the anvil', () => {
  const stack = (id, ench) => ({ id, count: 1, damage: 0, ...(ench ? { ench } : {}) });
  const mat = (key, count) => ({ id: I[key], count });

  it('every step asks for its own material, in order', () => {
    expect(TEMPER_STEPS.map((s) => s.mat)).toEqual(['SLAGSTEEL_INGOT', 'DIRGE_CRYSTAL', 'COLOSSUS_CORE']);
    expect(TEMPER_STEPS.map((s) => s.level)).toEqual([1, 2, 3]);
    expect(temperStepOf(I.COLOSSUS_CORE).level).toBe(3);
    expect(temperStepOf(I.DIAMOND)).toBe(null);
  });

  it('knows what each piece can take', () => {
    expect(temperKey(I.DIAMOND_SWORD)).toBe('forgebite');
    expect(temperKey(I.IRON_AXE)).toBe('forgebite');
    expect(temperKey(I.TIDESPEAR)).toBe('forgebite');
    expect(temperKey(I.DIAMOND_CHESTPLATE)).toBe('forgeward');
    expect(temperKey(I.DIRGESTEP_BOOTS)).toBe('forgeward');
    expect(temperKey(I.SLAGSTEEL_PICKAXE)).toBe('forgegrip');
    expect(temperKey(I.IRON_SHOVEL)).toBe('forgegrip');
    for (const id of [I.BOW, I.BOOK, I.ENCHANTED_BOOK, I.DIAMOND, B.CARVED_PUMPKIN, I.SHEARS]) expect(temperKey(id), String(id)).toBe(null);
  });

  it('raises a sword from nothing to III, one material at a time', () => {
    let sword = stack(I.DIAMOND_SWORD);
    const r1 = anvilCombine(sword, mat('SLAGSTEEL_INGOT', 5));
    expect(r1.result.ench).toEqual({ forgebite: 1 });
    expect(r1.use).toBe(3);
    expect(r1.cost).toBe(5);
    expect(r1.temper).toEqual({ key: 'forgebite', level: 1 });
    sword = r1.result;
    const r2 = anvilCombine(sword, mat('DIRGE_CRYSTAL', 2));
    expect(r2.result.ench.forgebite).toBe(2);
    expect(r2.use).toBe(2);
    expect(r2.cost).toBe(8 + 1); // + the prior-work penalty of the first step
    const r3 = anvilCombine(r2.result, mat('COLOSSUS_CORE', 1));
    expect(r3.result.ench.forgebite).toBe(3);
    expect(r3.cost).toBeGreaterThan(r2.cost);
    expect(r3.cost).toBeLessThan(40); // within the anvil's limit
    expect(r3.result.rw).toBeGreaterThan(r2.result.rw);
    // nothing past III
    expect(anvilCombine(r3.result, mat('COLOSSUS_CORE', 1))).toBe(null);
  });

  it('cannot skip a level, run short of a material or use the wrong one', () => {
    const sword = stack(I.DIAMOND_SWORD);
    expect(anvilCombine(sword, mat('DIRGE_CRYSTAL', 2))).toBe(null);
    expect(anvilCombine(sword, mat('COLOSSUS_CORE', 1))).toBe(null);
    expect(anvilCombine(sword, mat('SLAGSTEEL_INGOT', 2))).toBe(null);
    expect(anvilCombine(stack(I.BOW), mat('SLAGSTEEL_INGOT', 3))).toBe(null);
    expect(temperCombine(stack(I.DIAMOND_SWORD, { forgebite: 1 }), mat('SLAGSTEEL_INGOT', 3))).toBe(null);
  });

  it('keeps the piece\'s wear, name and other enchantments', () => {
    const sword = { id: I.DIAMOND_SWORD, count: 1, damage: 40, label: 'Old Faithful', ench: { keen: 3 } };
    const r = anvilCombine(sword, mat('SLAGSTEEL_INGOT', 3));
    expect(r.result).toMatchObject({ id: I.DIAMOND_SWORD, damage: 40, label: 'Old Faithful', ench: { keen: 3, forgebite: 1 } });
  });

  it('armour takes Forgeward and tools Forgegrip, nothing else', () => {
    expect(anvilCombine(stack(I.IRON_CHESTPLATE), mat('SLAGSTEEL_INGOT', 3)).result.ench).toEqual({ forgeward: 1 });
    expect(anvilCombine(stack(I.IRON_PICKAXE), mat('SLAGSTEEL_INGOT', 3)).result.ench).toEqual({ forgegrip: 1 });
  });

  it('a tempered twin cannot lend its temper (only the anvil and its materials raise it)', () => {
    const a = stack(I.DIAMOND_SWORD, { forgebite: 2 }), b = stack(I.DIAMOND_SWORD, { forgebite: 2, keen: 2 });
    const r = anvilCombine(a, b);
    expect(r && r.result.ench && r.result.ench.forgebite).toBe(2); // not 3
    expect(r.result.ench.keen).toBe(2);
  });

  it('never comes out of the enchanting table', () => {
    for (const id of [I.DIAMOND_SWORD, I.DIAMOND_CHESTPLATE, I.DIAMOND_PICKAXE, I.GOLD_SWORD, I.BOW, I.BOOK, I.TIDESPEAR]) {
      for (let level = 1; level <= 60; level += 3) {
        const keys = availableEnchants(id, level).map(([k]) => k);
        for (const k of ['forgebite', 'forgeward', 'forgegrip', 'sunmend']) expect(keys, `${id} at ${level}`).not.toContain(k);
      }
      for (const [k, e] of Object.entries(ENCHANTS)) if (e.treasure) expect(e.table).toEqual([]);
    }
    for (let seed = 1; seed < 80; seed++) for (const o of tableOffers(I.DIAMOND_SWORD, seed, 15)) if (o) for (const [k] of o.ench) expect(ENCHANTS[k].treasure, k).toBeFalsy();
  });

  it('is capped like the rest: levels, windows, saves', () => {
    for (const k of ['forgebite', 'forgeward', 'forgegrip']) {
      expect(ENCHANTS[k].max).toBe(3);
      expect(ENCHANTS[k].maxCost(3)).toBeGreaterThanOrEqual(ENCHANTS[k].min(3));
      expect(ENCHANTS[k].min(3)).toBeLessThanOrEqual(50);
    }
    expect(cleanEnch({ forgebite: 9, sunmend: 4, forgegrip: -1 })).toEqual({ forgebite: 3, sunmend: 1 });
    expect(enchName('forgebite', 2)).toBe('Forgebite II');
    expect(enchName('sunmend', 1)).toBe('Sunmend');
  });

  it('Forgebite adds a point of damage a level, bounded with Keen V', () => {
    expect(meleeBonus({ ench: { forgebite: 3 } }, {})).toBe(3);
    const best = meleeBonus({ ench: { keen: 5, forgebite: 3 } }, {});
    expect(best).toBe(6);
    expect(ITEMS[I.DIAMOND_SWORD].tool.damage + best).toBeLessThanOrEqual(14);
  });

  it('Forgeward turns aside heat and blasts only, and the Bulwark ceiling holds', () => {
    const piece = { ench: { forgeward: 3 } };
    const set = [piece, piece, piece, piece];
    expect(protectionFactor(set, 'lava')).toBe(12);
    expect(protectionFactor(set, 'fireball')).toBe(12);
    expect(protectionFactor(set, 'explosion')).toBe(12);
    expect(protectionFactor(set, 'mob')).toBe(0);
    expect(protectionFactor(set, 'void')).toBe(0);
    const both = { ench: { forgeward: 3, bulwark: 4 } };
    expect(protectionFactor([both, both, both, both], 'lava')).toBe(20); // capped
    expect(maxProtection()).toBe(16);
  });

  it('Forgegrip speeds mining only with the right tool', async () => {
    const { breakProgressPerTick } = await import('../src/world/mining.js');
    const tool = ITEMS[I.IRON_PICKAXE].tool;
    const plain = breakProgressPerTick(B.STONE, tool, {});
    const gripped = breakProgressPerTick(B.STONE, tool, { forgegrip: 3 });
    expect(gripped).toBeGreaterThan(plain);
    expect(gripped / plain).toBeLessThan(1.8);
    expect(breakProgressPerTick(B.DIRT, tool, { forgegrip: 3 })).toBe(breakProgressPerTick(B.DIRT, tool, {})); // dirt is not the pickaxe's block
    expect(src('src/player/interaction.js')).toContain("forgegrip: enchLevel(p.inventory.selectedStack, 'forgegrip')");
  });

  it('Sunmend mends two points of wear for each point of experience and gives back what it does not need', () => {
    const gear = { id: I.DIAMOND_SWORD, count: 1, damage: 100, ench: { sunmend: 1 } };
    expect(mendFromXp([gear], 10)).toBe(0);
    expect(gear.damage).toBe(80);
    const nearly = { id: I.DIAMOND_SWORD, count: 1, damage: 3, ench: { sunmend: 1 } };
    expect(mendFromXp([nearly], 10)).toBe(8); // 3 wear costs 2 xp
    expect(nearly.damage).toBe(0);
    expect(mendFromXp([{ id: I.DIAMOND_SWORD, count: 1, damage: 50 }, null], 7)).toBe(7); // no Sunmend: all yours
    expect(mendFromXp([{ id: I.DIAMOND_SWORD, count: 1, damage: 0, ench: { sunmend: 1 } }], 7)).toBe(7); // nothing to mend
    expect(mendFromXp([], 0)).toBe(0);
    // among several, one is picked
    const a = { id: I.IRON_HELMET, count: 1, damage: 30, ench: { sunmend: 1 } }, b = { id: I.IRON_BOOTS, count: 1, damage: 30, ench: { sunmend: 1 } };
    mendFromXp([a, b], 5, () => 0.9);
    expect([a.damage, b.damage]).toEqual([30, 20]);
    expect(src('src/entities/entities.js')).toContain('mendFromXp(worn, e.value)');
  });

  it('Sunmend refuses to share an item with Endless, and anvils accept it from a book on any gear', () => {
    expect(compatible('sunmend', 'endless')).toBe(false);
    expect(compatible('sunmend', 'keen')).toBe(true);
    const book = { id: I.ENCHANTED_BOOK, count: 1, damage: 0, ench: { sunmend: 1 } };
    for (const id of [I.DIAMOND_SWORD, I.IRON_PICKAXE, I.IRON_CHESTPLATE, I.BOW, I.TIDESPEAR, I.SHEARS]) {
      expect(canApply('sunmend', id, true), String(id)).toBe(true);
      expect(anvilCombine({ id, count: 1, damage: 5 }, book).result.ench).toEqual({ sunmend: 1 });
    }
    expect(enchantability(I.ENCHANTED_BOOK)).toBe(0);
  });
});

describe('endgame elixirs', () => {
  it('brew from their own ingredients, then lengthen and strengthen like the others', () => {
    expect(EFFECT_INGREDIENTS.glowcap_spores).toBe('haste');
    expect(EFFECT_INGREDIENTS.dirge_crystal).toBe('ironskin');
    expect(EFFECT_INGREDIENTS.gilded_apple).toBe('warding');
    for (const [ing, kind] of [['glowcap_spores', 'haste'], ['dirge_crystal', 'ironskin'], ['gilded_apple', 'warding']]) {
      expect(brewKind('murky', ing)).toBe(kind);
      expect(brewKind(kind, 'cinnabar')).toBe('long_' + kind);
      expect(brewKind(kind, 'glowshard_dust')).toBe('strong_' + kind);
      expect(brewKind('long_' + kind, 'glowshard_dust')).toBe('strong_' + kind);
      expect(baseKind('strong_' + kind)).toBe(kind);
    }
  });

  it('give the effects they are named for, with fair lengths', () => {
    expect(POTIONS.haste.effects[0][0]).toBe('haste');
    expect(POTIONS.ironskin.effects[0][0]).toBe('resistance');
    expect(POTIONS.warding.effects[0][0]).toBe('absorption');
    for (const k of Object.keys(POTIONS)) {
      if (!/haste|ironskin|warding/.test(k)) continue;
      const [, ticks, amp] = POTIONS[k].effects[0];
      expect(ticks, k).toBeGreaterThan(0);
      expect(ticks, k).toBeLessThanOrEqual(8 * 60 * 20);
      if (k.startsWith('strong_')) { expect(amp).toBe(1); expect(ticks).toBeLessThan(POTIONS[k.replace('strong_', '')].effects[0][1]); } else expect(amp).toBe(0);
    }
  });

  it('their ingredients are accepted by the Brewing Alembic', async () => {
    const { isIngredient } = await import('../src/world/brewing.js');
    for (const k of ['GLOWCAP_SPORES', 'DIRGE_CRYSTAL', 'GILDED_APPLE']) expect(isIngredient(I[k]), k).toBe(true);
  });
});

describe('the boss bar', () => {
  const mob = ({ x = 0, y = 64, z = 0, ...over } = {}) => { const m = new Mob('slag_colossus', x, y, z); Object.assign(m, over); return m; };

  it('numbers the phases from the thresholds', () => {
    expect(barPhase(1, K.PHASE_AT)).toBe(1);
    expect(barPhase(0.5, K.PHASE_AT)).toBe(2);
    expect(barPhase(0.2, K.PHASE_AT)).toBe(3);
    expect(barPhase(0.2, undefined)).toBe(1);
  });

  it('shows the nearest living boss within range, as a fraction, and nothing for plain mobs', () => {
    const near = mob({ x: 10, health: 200 }), far = mob({ x: 50 });
    const info = bossBarInfo([new Mob('shambler', 1, 64, 0), far, near], 0, 64, 0);
    expect(info).toMatchObject({ name: 'Slag Colossus', frac: 0.5, phase: 2, shielded: false });
    expect(info.phases).toEqual(K.PHASE_AT);
    expect(bossBarInfo([mob({ x: 200 })], 0, 64, 0)).toBe(null);
    expect(bossBarInfo([new Mob('shambler', 1, 64, 0)], 0, 64, 0)).toBe(null);
    expect(bossBarInfo([mob({ dead: true })], 0, 64, 0)).toBe(null);
    expect(bossBarInfo([mob({ deathTime: 3 })], 0, 64, 0)).toBe(null);
    expect(bossBarInfo([mob({ special: true })], 0, 64, 0).shielded).toBe(true);
    expect(bossBarInfo([mob({ health: -5 })], 0, 64, 0).frac).toBe(0);
  });

  it('is in the HUD, styled, and hidden behind menus', () => {
    expect(src('src/ui/hud.js')).toContain('id="bossbar"');
    expect(src('src/ui/hud.js')).toContain('bossBar(info)');
    const css = src('src/ui/style.css');
    expect(css).toContain('#bossbar');
    expect(css).toMatch(/:is\(#steps, \.milestone, #skyinfo, #raidbar, #bossbar\)/);
    expect(src('src/game.js')).toContain('bossBarInfo(this.entities.list');
  });
});

describe('sounds, guide and help', () => {
  it('each new sound is synthesised and captioned', () => {
    const audio = src('src/audio/audio.js');
    for (const s of ['colossus_roar', 'colossus_slam', 'colossus_erupt']) {
      expect(audio, s).toContain(`case '${s}':`);
      expect(CAPTION_TEXT[s], s).toBeTruthy();
    }
    expect(CAPTION_TEXT[MOBS.slag_colossus.sound]).toBeTruthy();
  });

  it('the Field Guide lists the Colossus as a boss and its finds as items of note', () => {
    resetGuideEntries();
    const c = entriesOf('creatures').find((e) => e.key === 'slag_colossus');
    expect(c.name).toBe('Slag Colossus');
    expect(c.traits).toContain('Boss');
    expect(c.habitat.join(' ')).toMatch(/Cinderforge/);
    expect(c.drops).toContain(I.COLOSSUS_CORE);
    const items = new Set(entriesOf('items').map((e) => e.id));
    for (const k of ['SLAG_SIGIL', 'COLOSSUS_CORE']) expect(items.has(I[k]), k).toBe(true);
    expect(entriesOf('structures').find((e) => e.key === 'cinderforge').text || JSON.stringify(entriesOf('structures'))).toMatch(/Slag Colossus/);
  });

  it('a Help topic explains the fight, tempering and the elixirs, with the real numbers and no stray names', () => {
    const topic = buildTopics({ table: defaultTable() }).find((t) => t.id === 'endgame');
    expect(topic).toBeTruthy();
    expect(topic.group).toBe('Systems');
    expect(topic.text).toContain(String(K.HEALTH));
    for (const w of ['sigil', 'forgebite', 'forgeward', 'forgegrip', 'sunmend', 'slagsteel ingot', 'dirge crystal', 'colossus core', 'haste', 'ironskin', 'warding', 'jump', 'pillar', 'charge']) expect(topic.text, w).toContain(w);
    expect(topic.text).not.toMatch(/minecraft|nether|redstone|\bend\b/i);
  });

  it('the sources and the README carry no forbidden names', () => {
    for (const f of ['src/mobs/slagColossus.js', 'src/ui/bossBar.js', 'src/world/enchantments.js', 'src/world/potions.js', 'README.md']) {
      expect(src(f), f).not.toMatch(/minecraft|nether|redstone/i);
    }
    expect(src('README.md')).toContain('Slag Colossus');
    expect(src('README.md')).toContain('Tempering and Sunmend');
  });
});

describe('balance', () => {
  const sets = armorSets();

  it('the Colossus is a long fight but not endless, comparable to the Hushkeeper', () => {
    const rows = Object.fromEntries(bossTable().map((r) => [r.weapon, r]));
    expect(rows['iron sword'].colossus).toBeLessThanOrEqual(100);
    expect(rows['diamond sword Keen V'].colossus).toBeGreaterThan(20);
    expect(rows['diamond sword Keen V'].colossus).toBeLessThanOrEqual(60);
    expect(rows['diamond sword'].colossus).toBeLessThan(rows['iron sword'].colossus);
    expect(rows['diamond sword Keen V'].colossus).toBeLessThan(rows['diamond sword'].colossus);
    expect(rows['bow, Strongdraw V'].colossus).toBeLessThan(rows['diamond sword Keen V'].colossus);
    expect(K.HEALTH).toBeLessThan(HUSHKEEPER.HEALTH);
  });

  it('none of its blows one-shots a player in diamond armour, even on Hard', () => {
    for (const hit of [K.MELEE, K.SLAM_DAMAGE, K.PILLAR_DAMAGE, K.CHARGE_DAMAGE, K.HURL_DAMAGE]) {
      expect(damageAfter(hit * 1.5, sets.diamond), String(hit)).toBeLessThan(20);
    }
    // in iron the biggest blow on Hard is a heavy hit but still not a kill in one go from full health
    expect(damageAfter(K.CHARGE_DAMAGE * 1.5, sets.iron)).toBeLessThan(20);
    // the slam, the charge and the pillars are not stackable into a burst: a long recovery follows each
    expect(K.SLAM_RECOVER).toBeGreaterThanOrEqual(20);
    expect(K.STUN).toBeGreaterThanOrEqual(60);
  });

  it('its warnings are long enough to react to (at least a second for the big moves)', () => {
    expect(K.SLAM_WINDUP).toBeGreaterThanOrEqual(30);
    expect(K.PILLAR_WARN).toBeGreaterThanOrEqual(30);
    expect(K.CHARGE_WINDUP).toBeGreaterThanOrEqual(25);
    expect(K.SHIELD).toBeGreaterThanOrEqual(40);
    for (let i = 1; i < 3; i++) expect(K.SLAM_COOLDOWN[i]).toBeLessThan(K.SLAM_COOLDOWN[i - 1]); // harder, not unfair
    expect(K.SLAM_COOLDOWN[2]).toBeGreaterThan(K.SLAM_WINDUP + K.SLAM_RECOVER);
  });

  it('tempering stays inside the anvil and the existing damage ceilings', () => {
    const worst = anvilCombine({ id: I.DIAMOND_SWORD, count: 1, damage: 0, ench: { forgebite: 2 }, rw: 3 }, { id: I.COLOSSUS_CORE, count: 1 });
    expect(worst.cost).toBeLessThan(40);
    expect(ENCH_KEYS.length).toBeGreaterThanOrEqual(21);
  });
});
