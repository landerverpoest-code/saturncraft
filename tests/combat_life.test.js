import { describe, it, expect, vi, afterEach } from 'vitest';
import { Mob } from '../src/mobs/mob.js';
import { MOBS, MOB_KEYS, CATEGORY } from '../src/mobs/mobTypes.js';
import { Player } from '../src/player/player.js';
import { I } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';
import {
  PARRY_TICKS, DISABLE_TICKS, PARRY_STUN, newShield, shieldTick, canRaise, isParry, disableShield, attackerDisablesShield,
  shieldWear, resolveBlock, shieldGauge, KNOCK,
} from '../src/player/shield.js';
import { rollEquipment, weaponBonus, AXE_CHANCE, AXE_CHANCE_HARD } from '../src/mobs/equipment.js';
import {
  MORALE, familyOf, alarmRecipients, healthyAllies, shouldFlee, fleeGoal, isCornered, soundAlarm, moraleAI,
  ALARM_TICKS, FLEE_TICKS, COURAGE_TICKS, CORNERED_AFTER,
} from '../src/mobs/morale.js';
import {
  newArrival, arrivalRoll, campCandidate, goodCampGround, saveState, loadState, convoyOf, leaderOf, caravanOut, callDefenders,
  followMode, depart, spawnCaravan, caravanTick, DAY_TICKS, FIRST_CHANCE, CHANCE_STEP, MAX_CHANCE, MIN_DAY, STAY_TICKS, MIN_DIST, MAX_DIST,
  PACKHORNS, FOLLOW_NEAR, FOLLOW_FAR, BITE_DAMAGE,
} from '../src/mobs/peddler.js';
import { makeTrades, doTrade, canTrade } from '../src/mobs/trades.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { canLeash } from '../src/entities/leash.js';
import { rng } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

function fakeGame(list = [], over = {}) {
  return {
    ticks: 100, time: 5 * DAY_TICKS + 3000,
    entities: { list, add: vi.fn((e) => { list.push(e); return e; }) },
    particles: { emit: vi.fn(), smoke: vi.fn() },
    audio: { play: vi.fn() },
    sky: { state: { aboveCount: 2 } },
    player: { x: 0, y: 64, z: 0, dead: false, creative: false, isPlayer: true, eyeHeight: 1.62, body: { vx: 0, vz: 0, height: 1.8 }, hurt: vi.fn(), inventory: {} },
    ...over,
  };
}
const mob = (type, x = 0, z = 0, g = null) => { const m = new Mob(type, x, 64, z); if (g) { m._game = g; g.entities.list.push(m); } return m; };

describe('shield rules', () => {
  it('a block in the first moments is a parry; later ones are plain blocks', () => {
    const s = newShield();
    for (let k = 0; k < PARRY_TICKS; k++) shieldTick(s, true);
    expect(isParry(s)).toBe(true);
    shieldTick(s, true);
    expect(isParry(s)).toBe(false);
    shieldTick(s, false); // lowering it resets the window
    expect(s.age).toBe(0);
    expect(isParry(s)).toBe(true);
  });

  it('a parry costs nothing, a block wears the shield with the damage, light hits do not', () => {
    expect(shieldWear(6, true)).toBe(0);
    expect(shieldWear(6, false)).toBe(7);
    expect(shieldWear(2.9, false)).toBe(0);
    expect(shieldWear(3, false)).toBe(4);
  });

  it('axes (in a mob\'s hand or a player\'s) disable a shield; swords and bare fists do not', () => {
    expect(attackerDisablesShield({ equip: { hand: { id: I.IRON_AXE } } })).toBe(true);
    expect(attackerDisablesShield({ equip: { hand: { id: I.IRON_SWORD } } })).toBe(false);
    expect(attackerDisablesShield({ equip: { hand: null } })).toBe(false);
    expect(attackerDisablesShield({ inventory: { selectedStack: { id: I.DIAMOND_AXE } } })).toBe(true);
    expect(attackerDisablesShield({ inventory: { selectedStack: { id: I.IRON_SHOVEL } } })).toBe(false);
    expect(attackerDisablesShield({ def: { axeBlows: true } })).toBe(true);
    expect(attackerDisablesShield(null)).toBe(false);
  });

  it('an axe blow starts the cooldown, the shield cannot be raised until it has run out, and the gauge fills', () => {
    const s = newShield();
    expect(shieldGauge(s)).toBeNull();
    const r = resolveBlock(s, 7, { equip: { hand: { id: I.IRON_AXE } } });
    expect(r).toMatchObject({ disabled: true, wear: 0, stun: 0 });
    expect(s.cooldown).toBe(DISABLE_TICKS);
    expect(canRaise(s)).toBe(false);
    expect(shieldGauge(s)).toBeCloseTo(0);
    for (let k = 0; k < DISABLE_TICKS / 2; k++) shieldTick(s, true); // (holding it up does not count as age while it is down)
    expect(s.age).toBe(0);
    expect(shieldGauge(s)).toBeCloseTo(0.5);
    for (let k = 0; k < DISABLE_TICKS / 2; k++) shieldTick(s, false);
    expect(canRaise(s)).toBe(true);
    expect(shieldGauge(s)).toBeNull();
  });

  it('a parry staggers the attacker and throws it back harder', () => {
    const s = newShield();
    const parry = resolveBlock(s, 5, { equip: { hand: null } });
    expect(parry).toMatchObject({ parry: true, wear: 0, stun: PARRY_STUN, knock: KNOCK.parry });
    for (let k = 0; k < 20; k++) shieldTick(s, true);
    const block = resolveBlock(s, 5, { equip: { hand: null } });
    expect(block).toMatchObject({ parry: false, wear: 6, stun: 0, knock: KNOCK.block });
    const t = newShield();
    disableShield(t, 10); disableShield(t, 5); // the longer cooldown stays
    expect(t.cooldown).toBe(10);
  });

  it('a raised shield stops a frontal hit; once knocked down it stops nothing', () => {
    const p = new Player();
    p.blocking = true; p.yaw = 0; // looking toward -z
    const blocked = vi.fn();
    p.listeners.blocked = [blocked];
    const front = { x: 0, y: 64, z: -3, kind: 'mob' };
    expect(p.hurt(4, 'mob:Shambler', front)).toBe(false);
    expect(blocked).toHaveBeenCalledTimes(1);
    disableShield(p.shield);
    p.invulnerable = 0;
    expect(p.hurt(4, 'mob:Shambler', front)).toBe(true);
    expect(p.health).toBeLessThan(20);
    expect(blocked).toHaveBeenCalledTimes(1);
  });

  it('the player\'s tick drops the shield while it is knocked down', () => {
    const p = new Player();
    p.dead = true; // (tick returns early for the dead; the shield state is plain data)
    expect(p.shield).toEqual({ cooldown: 0, age: 0 });
  });
});

describe('mobs with axes', () => {
  it('melee mobs now and then hold an iron axe, which hits like a sword for them', () => {
    const r = rng(5), N = 40000;
    let axes = 0;
    for (let k = 0; k < N; k++) { const h = rollEquipment('shambler', 0, 'normal', r).hand; if (h && h.id === I.IRON_AXE) axes++; }
    expect(axes / N).toBeCloseTo(AXE_CHANCE, 2);
    expect(AXE_CHANCE_HARD).toBeGreaterThan(AXE_CHANCE);
    expect(weaponBonus({ id: I.IRON_AXE })).toBe(weaponBonus({ id: I.IRON_SWORD }));
    expect(weaponBonus({ id: I.DIAMOND_AXE })).toBe(5);
  });

  it('archers never roll an axe', () => {
    const r = rng(9);
    for (let k = 0; k < 2000; k++) expect(rollEquipment('rattler', 0, 'hard', r).hand.id).toBe(I.BOW);
  });
});

describe('mob morale', () => {
  it('the table names the kin that answer an alarm and who runs', () => {
    expect(familyOf('shambler')).toBe('shambler');
    expect(familyOf('dune_shambler')).toBe('shambler');
    expect(familyOf('rattler')).toBe(familyOf('rime_rattler'));
    expect(familyOf('fizzler')).toBeNull();
    expect(MORALE.shambler.flee).toBe(0);
    expect(MORALE.rattler.flee).toBeGreaterThan(0);
    for (const k of Object.keys(MORALE)) expect(MOBS[k].category).toBe(CATEGORY.MONSTER);
  });

  it('a hurt monster calls its own kind nearby, not strangers, not the far or the raiding', () => {
    const g = fakeGame();
    const hurt = mob('shambler', 0, 0, g), near = mob('dune_shambler', 6, 0, g), far = mob('shambler', 30, 0, g);
    const stranger = mob('rattler', 3, 0, g), raider = mob('shambler', 2, 2, g); raider.raider = true;
    const dead = mob('shambler', 1, 1, g); dead.dead = true;
    const rec = alarmRecipients(hurt, g.entities.list);
    expect(rec).toEqual([near]);
    expect(soundAlarm(hurt, g.entities.list)).toBe(1);
    expect(near.alarm).toBe(ALARM_TICKS);
    expect(near.target).toBe('player');
    expect(soundAlarm(hurt, g.entities.list)).toBe(0); // already alarmed
    expect(alarmRecipients(mob('fizzler'), g.entities.list)).toEqual([]);
    expect(far.alarm).toBeUndefined(); expect(stranger.alarm).toBeUndefined();
  });

  it('Mob.hurt by a player sounds the alarm', () => {
    const g = fakeGame();
    const a = mob('shambler', 0, 0, g), b = mob('shambler', 4, 0, g);
    a.hurt(1, 'player', g.player, 0);
    expect(b.alarm).toBeGreaterThan(0);
    expect(b.target).toBe('player');
  });

  it('an alarmed mob far out of sight hurries toward the player', () => {
    const g = fakeGame();
    const m = mob('shambler', 60, 0, g);
    m.alarm = 100;
    const spy = vi.spyOn(m, 'chase').mockImplementation(() => {});
    expect(moraleAI(m, g, g.player, 60)).toBe(true);
    expect(spy).toHaveBeenCalled();
    m.alarm = 0;
    expect(moraleAI(m, g, g.player, 60)).toBe(false);
  });

  it('a wounded archer fighting alone runs; with friends around, or healthy, or raiding, it stays', () => {
    const g = fakeGame();
    const a = mob('rattler', 8, 0, g);
    a.target = 'player';
    expect(shouldFlee(a, 0)).toBe(false); // full health
    a.health = 5;
    expect(shouldFlee(a, 0)).toBe(true);
    expect(shouldFlee(a, 2)).toBe(false);  // two healthy friends: brave
    expect(shouldFlee(a, 1)).toBe(true);
    a.target = null; expect(shouldFlee(a, 0)).toBe(false);
    a.target = 'player'; a.raider = true; expect(shouldFlee(a, 0)).toBe(false);
    a.raider = false; a.courage = 10; expect(shouldFlee(a, 0)).toBe(false);
    const brawler = mob('shambler', 0, 0, g); brawler.target = 'player'; brawler.health = 1;
    expect(shouldFlee(brawler, 0)).toBe(false); // Shamblers never run
  });

  it('only healthy, standing allies of the family count', () => {
    const g = fakeGame();
    const a = mob('rattler', 0, 0, g), ok = mob('rime_rattler', 5, 0, g), hurt = mob('rattler', 5, 1, g), running = mob('rattler', 5, 2, g), other = mob('shambler', 3, 0, g);
    hurt.health = 2; running.fleeing = 30;
    expect(healthyAllies(a, g.entities.list)).toEqual([ok]);
    expect(other).toBeTruthy();
  });

  it('it runs away from the player, or to a healthy ally that is farther from the player than it is', () => {
    const p = { x: 0, z: 0 };
    const m = { x: 5, z: 0 };
    const away = fleeGoal(m, p, []);
    expect(away.rally).toBe(false);
    expect(away.x).toBeGreaterThan(5); expect(Math.abs(away.z)).toBeLessThan(1e-9);
    const ally = { x: 20, z: 0 }, behind = { x: 2, z: 0 }, adjacent = { x: 6, z: 0 };
    expect(fleeGoal(m, p, [ally])).toMatchObject({ rally: true, x: 20 });
    expect(fleeGoal(m, p, [behind, adjacent]).rally).toBe(false); // closer to the player, or too close to matter
  });

  it('a fleeing mob runs for a while, then fights on and does not run again for a good while', () => {
    const g = fakeGame();
    const m = mob('rattler', 8, 0, g);
    m.target = 'player'; m.health = 4;
    expect(moraleAI(m, g, g.player, 8)).toBe(true);
    expect(m.fleeing).toBeGreaterThanOrEqual(FLEE_TICKS);
    expect(m.move).toBeFalsy(); // (the first tick only turns it; running starts on the next)
    expect(moraleAI(m, g, g.player, 8)).toBe(true);
    expect(m.move.forward).toBeGreaterThan(0);
    // away from the player: the steering target lies beyond the mob, on the far side
    let ticks = 0;
    while (m.fleeing > 0 && ticks < 500) { m.body.x += 0.3; ticks++; moraleAI(m, g, g.player, 8); }
    expect(m.fleeing).toBe(0);
    expect(m.courage).toBeGreaterThan(COURAGE_TICKS - 5);
    m.health = 1;
    expect(shouldFlee(m, 0)).toBe(false);
  });

  it('a cornered mob (no headway) stops running and fights', () => {
    const g = fakeGame();
    const m = mob('marauder', 8, 0, g);
    m.target = 'player'; m.health = 3;
    moraleAI(m, g, g.player, 8);
    expect(m.fleeing).toBeGreaterThan(0);
    for (let k = 0; k < CORNERED_AFTER + FLEE_TICKS && m.fleeing > 0; k++) moraleAI(m, g, g.player, 8); // never moves
    expect(m.fleeing).toBe(0);
    expect(isCornered({ x: 1, z: 1 }, { x: 1.2, z: 1 })).toBe(true);
    expect(isCornered({ x: 5, z: 1 }, { x: 1.2, z: 1 })).toBe(false);
    expect(m.courage).toBeGreaterThan(0);
  });

  it('Mob.ai routes through morale for monsters (a wounded Rattler runs instead of shooting)', () => {
    const g = fakeGame();
    const m = mob('rattler', 8, 0, g);
    m.target = 'player'; m.health = 4;
    const shoot = vi.spyOn(m, 'shoot').mockImplementation(() => {});
    m.bowCharge = 19; m.attackCooldown = 0;
    m.ai(g, g.player, 8);
    m.ai(g, g.player, 8);
    expect(shoot).not.toHaveBeenCalled();
    expect(m.fleeing).toBeGreaterThan(0);
  });

  it('a mob staggered by a parry stands still', () => {
    const g = fakeGame();
    const m = mob('shambler', 2, 0, g);
    m.stunTicks = 3;
    const melee = vi.spyOn(m, 'meleeAI').mockImplementation(() => {});
    for (let k = 0; k < 3; k++) m.ai(g, g.player, 2);
    expect(melee).not.toHaveBeenCalled();
    expect(m.stunTicks).toBe(0);
    m.ai(g, g.player, 2);
    expect(melee).toHaveBeenCalled();
  });
});

describe('the Roving Peddler\'s schedule', () => {
  it('rolls once per day-lit day, never early, never while a caravan is out', () => {
    const s = newArrival();
    expect(arrivalRoll(s, 0, true, false, () => 0)).toBe(false);           // day 0: too young
    expect(arrivalRoll(s, MIN_DAY * DAY_TICKS, false, false, () => 0)).toBe(false); // night: no roll yet
    expect(arrivalRoll(s, MIN_DAY * DAY_TICKS + 10, true, true, () => 0)).toBe(false); // busy
    expect(s.day).toBe(-1);
    expect(arrivalRoll(s, MIN_DAY * DAY_TICKS + 10, true, false, () => 0)).toBe(true);
    expect(s.pending).toBeGreaterThan(0);
    expect(arrivalRoll(s, MIN_DAY * DAY_TICKS + 20, true, false, () => 0)).toBe(false); // already rolled today
  });

  it('every miss raises the chance by a quarter up to 75 %; a visit resets it', () => {
    const s = newArrival();
    const seen = [];
    for (let d = MIN_DAY; d < MIN_DAY + 5; d++) { seen.push(s.chance); arrivalRoll(s, d * DAY_TICKS + 5, true, false, () => 0.99); }
    expect(seen).toEqual([FIRST_CHANCE, FIRST_CHANCE + CHANCE_STEP, MAX_CHANCE, MAX_CHANCE, MAX_CHANCE]);
    expect(arrivalRoll(s, 20 * DAY_TICKS, true, false, () => 0.74)).toBe(true);
    expect(s.chance).toBe(FIRST_CHANCE);
  });

  it('the schedule survives a save, and bad data is repaired', () => {
    const s = newArrival(); s.chance = 0.5; s.day = 7; s.pending = 99;
    expect(loadState(JSON.parse(JSON.stringify(saveState(s))))).toEqual({ chance: 0.5, day: 7, pending: 0 });
    expect(loadState({ chance: 'lots', day: null })).toEqual(newArrival());
    expect(loadState({ chance: 9 }).chance).toBe(MAX_CHANCE);
    expect(loadState(undefined)).toEqual(newArrival());
  });

  it('camps are 24-40 blocks out, on dry open ground', () => {
    const r = rng(3);
    for (let k = 0; k < 200; k++) {
      const c = campCandidate(100, -50, r), d = Math.hypot(c.x - 100, c.z + 50);
      expect(d).toBeGreaterThan(MIN_DIST - 1.5); expect(d).toBeLessThan(MAX_DIST + 1.5);
    }
    expect(goodCampGround(B.GRASS, B.AIR, B.AIR)).toBe(true);
    expect(goodCampGround(B.WATER, B.AIR, B.AIR)).toBe(false);
    expect(goodCampGround(B.GRASS, B.WATER, B.AIR)).toBe(false);
    expect(goodCampGround(B.GRASS, B.STONE, B.AIR)).toBe(false);
    expect(goodCampGround(B.CACTUS, B.AIR, B.AIR)).toBe(false);
    expect(goodCampGround(B.AIR, B.AIR, B.AIR)).toBe(false);
  });
});

describe('the Roving Peddler and its Packhorns', () => {
  it('are registered mobs with their own models', () => {
    expect(MOBS.peddler.trader).toBe(true);
    expect(MOBS.peddler.category).toBe(CATEGORY.CREATURE);
    expect(MOB_KEYS).toEqual(expect.arrayContaining(['peddler', 'packhorn']));
    expect(MOBS.packhorn.drops[0].id).toBe(I.LEATHER);
    expect(canLeash(new Mob('packhorn', 0, 64, 0))).toBe(true);
    expect(canLeash(new Mob('peddler', 0, 64, 0))).toBe(false);
  });

  it('a peddler is born with a stock, a stay of one day and a convoy id; its stock is fuller than a settler\'s', () => {
    const m = new Mob('peddler', 3, 64, 4);
    m.def.onSpawn && void 0;
    expect(m.profession).toBeNull(); // (onSpawn runs in the spawner)
    MOBS.peddler.onSpawn(m);
    expect(m.profession).toBe('peddler');
    expect(m.stay).toBe(STAY_TICKS);
    expect(m.convoy).toBeGreaterThanOrEqual(0);
    expect(m.camp).toEqual({ x: 3, z: 4 });
    expect(m.trades.length).toBeGreaterThanOrEqual(5);
    expect(m.trades.length).toBeLessThanOrEqual(6);
    expect(new Set(m.trades.map((t) => t.get)).size).toBe(m.trades.length);
  });

  it('peddler trades: raw goods for beryl and rare wares for beryl, usable by the ordinary trade code', () => {
    const r = rng(2);
    for (let k = 0; k < 50; k++) {
      const t = makeTrades('peddler', r);
      expect(t.filter((o) => o.give !== I.BERYL).length).toBe(1);
      expect(t.some((o) => o.give === I.BERYL)).toBe(true);
    }
    const sale = { give: I.BERYL, giveCount: 2, get: I.NAME_TAG, getCount: 1, uses: 0 };
    const inv = { count: (id) => (id === I.BERYL ? 3 : 0), slots: [{ id: I.BERYL, count: 3, damage: 0 }], changed: vi.fn() };
    expect(canTrade(sale, inv)).toBe(true);
    expect(doTrade(sale, inv)).toMatchObject({ id: I.NAME_TAG, count: 1 });
    expect(inv.slots[0].count).toBe(1);
  });

  it('the settler trades are unchanged in size (two or three offers after the buy)', () => {
    const r = rng(8);
    for (let k = 0; k < 100; k++) { const n = makeTrades('farmer', r).length; expect(n === 3 || n === 4).toBe(true); }
  });

  it('the peddler\'s trade and stay are saved, and a guest sees its trade', () => {
    const g = fakeGame();
    const m = mob('peddler', 3, 4, g);
    MOBS.peddler.onSpawn(m);
    m.stay = 1234;
    const data = JSON.parse(JSON.stringify(m.saveData()));
    const back = new Mob('peddler', 0, 64, 0); MOBS.peddler.onSpawn(back);
    back.loadData(data);
    expect(back.stay).toBe(1234);
    expect(back.convoy).toBe(m.convoy);
    expect(back.camp).toEqual(m.camp);
    expect(back.profession).toBe('peddler');
    expect(back.trades.map((t) => t.get)).toEqual(m.trades.map((t) => t.get));
    const snap = unpackMob(packMob(m));
    expect(snap.profession).toBe('peddler');
    const pack = new Mob('packhorn', 0, 64, 0); pack.convoy = 77; pack.woolColor = 3;
    const pb = new Mob('packhorn', 0, 64, 0); pb.loadData(JSON.parse(JSON.stringify(pack.saveData())));
    expect(pb.convoy).toBe(77);
    expect(pb.woolColor).toBe(3);
  });

  it('a convoy is the peddler and the beasts sharing its id; the leader is the living peddler', () => {
    const g = fakeGame();
    const p = mob('peddler', 0, 0, g); p.convoy = 5;
    const h1 = mob('packhorn', 2, 0, g), h2 = mob('packhorn', -2, 0, g), stray = mob('packhorn', 4, 0, g);
    h1.convoy = h2.convoy = 5; stray.convoy = 6;
    expect(convoyOf(g.entities.list, 5)).toEqual([p, h1, h2]);
    expect(leaderOf(g.entities.list, 5)).toBe(p);
    expect(leaderOf(g.entities.list, 6)).toBeNull();
    expect(caravanOut(g.entities.list)).toBe(true);
    p.dead = true;
    expect(leaderOf(g.entities.list, 5)).toBeNull();
    expect(caravanOut(g.entities.list)).toBe(false);
  });

  it('hurting the peddler or one Packhorn sets the others on the attacker', () => {
    const g = fakeGame();
    const p = mob('peddler', 0, 0, g); p.convoy = 5;
    const h1 = mob('packhorn', 2, 0, g), h2 = mob('packhorn', -2, 0, g);
    h1.convoy = h2.convoy = 5;
    p.hurt(1, 'player', g.player, 0);
    expect(h1.grudge).toBe(g.player); expect(h2.grudge).toBe(g.player);
    h1.grudge = h2.grudge = null; h1.grudgeTicks = 0;
    h1.hurt(1, 'player', g.player, 0);
    expect(h2.grudge).toBe(g.player);
    expect(h1.grudge).toBeFalsy(); // (it fights back through the others and its own panic)
    expect(p.panicTicks).toBeGreaterThan(0);
    expect(callDefenders(g.entities.list, null, g.player)).toBe(0);
  });

  it('a Packhorn with a grudge bites what it is after', () => {
    const g = fakeGame();
    const h = mob('packhorn', 0, 0, g); h.convoy = 5;
    const foe = mob('shambler', 1.2, 0, g);
    foe.hurt = vi.fn(() => true);
    h.grudge = foe; h.grudgeTicks = 100; h.attackCooldown = 0;
    h.ai(g, g.player, 20);
    expect(foe.hurt).toHaveBeenCalledWith(BITE_DAMAGE, 'mob', h, 0.5);
    expect(h.attackCooldown).toBeGreaterThan(0);
  });

  it('a Packhorn follows its peddler: runs when far, walks a little away, idles near', () => {
    expect(followMode(FOLLOW_NEAR - 1)).toBe('idle');
    expect(followMode(FOLLOW_NEAR + 1)).toBe('walk');
    expect(followMode(FOLLOW_FAR + 1)).toBe('run');
    const g = fakeGame([], { world: { getBlock: (x, y) => (y < 64 ? B.STONE : B.AIR), raycast: () => null } });
    const lead = mob('peddler', 20, 0, g); lead.convoy = 9;
    const h = mob('packhorn', 0, 0, g); h.convoy = 9;
    h.ai(g, g.player, 30);
    expect(h.move).toBeTruthy();
    expect(h.move.forward).toBeGreaterThan(0);
  });

  it('the peddler packs up after its stay, taking its Packhorns along', () => {
    const g = fakeGame();
    const p = mob('peddler', 0, 0, g); p.convoy = 5; p.stay = 2;
    const h = mob('packhorn', 2, 0, g); h.convoy = 5;
    const other = mob('packhorn', 4, 0, g); other.convoy = 6;
    p.ai(g, g.player, 20);
    expect(p.removed).toBe(false);
    p.ai(g, g.player, 20);
    expect(p.removed).toBe(true); expect(p.dead).toBe(true);
    expect(h.removed).toBe(true);
    expect(other.removed).toBe(false);
    expect(g.particles.smoke).toHaveBeenCalled();
  });

  it('a camp is a peddler with its Packhorns on one convoy id, placed only where they fit', () => {
    const g = fakeGame();
    const world = { getBlock: (x, y) => (y < 64 ? B.STONE : B.AIR) };
    g.world = world;
    const spawner = { game: g, canFit: () => true, spawnMob: (t, x, y, z) => { const m = new Mob(t, x, y, z); m._game = g; if (MOBS[t].onSpawn) MOBS[t].onSpawn(m); g.entities.list.push(m); return m; } };
    const p = spawnCaravan(spawner, 10, 64, 10);
    expect(p.type).toBe('peddler');
    const horns = g.entities.list.filter((e) => e.type === 'packhorn');
    expect(horns.length).toBe(PACKHORNS);
    for (const h of horns) expect(h.convoy).toBe(p.convoy);
    expect(spawnCaravan({ ...spawner, canFit: () => false }, 10, 64, 10)).toBeNull();
  });

  it('caravanTick rolls the day, then searches until a camp is placed, then stops', () => {
    const list = [];
    const g = fakeGame(list, { ticks: 40, world: { dimension: 'overworld', isLoaded: () => true, heightAt: () => 63, getBlock: (x, y) => (y < 64 ? B.GRASS : B.AIR) } });
    g.player = { ...g.player, x: 0, z: 0 };
    const spawned = [];
    const spawner = { game: g, canFit: () => true, spawnMob: (t, x, y, z) => { const m = new Mob(t, x, y, z); m._game = g; if (MOBS[t].onSpawn) MOBS[t].onSpawn(m); spawned.push(m); list.push(m); return m; } };
    const m = caravanTick(spawner, () => 0.1);
    expect(m).toBeTruthy();
    expect(m.type).toBe('peddler');
    expect(Math.hypot(m.x, m.z)).toBeGreaterThan(MIN_DIST - 3);
    expect(spawner.peddlerState.pending).toBe(0);
    expect(spawned.length).toBe(1 + PACKHORNS);
    expect(caravanTick(spawner, () => 0.1)).toBeNull(); // one caravan at a time, and the day is used
  });

  it('nothing happens in other dimensions, at night or with the player dead', () => {
    const list = [];
    const mk = (over) => {
      const g = fakeGame(list, { ticks: 40, world: { dimension: 'overworld', isLoaded: () => true, heightAt: () => 63, getBlock: (x, y) => (y < 64 ? B.GRASS : B.AIR) }, ...over });
      return { game: g, canFit: () => true, spawnMob: vi.fn() };
    };
    expect(caravanTick(mk({ world: { dimension: 'hollow' } }), () => 0)).toBeNull();
    expect(caravanTick(mk({ sky: { state: { aboveCount: 0 } } }), () => 0)).toBeNull();
    const dead = mk({}); dead.game.player.dead = true;
    expect(caravanTick(dead, () => 0)).toBeNull();
  });
});
