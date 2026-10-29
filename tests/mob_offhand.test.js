import { describe, it, expect } from 'vitest';
import {
  rollOffhand, shieldBlocks, shieldIgnores, disablesShield, wearShield, charmHealth, charmIgnores, offhandDrops, offhandId, offhandFromId,
  offhandFromSave, captainOffhand, STOLEN_ITEMS, SHIELD_BLOCK_CHANCE, VIXLING_LOOT_CHANCE, isShield, isCharm,
} from '../src/mobs/offhand.js';
import { I, ITEMS } from '../src/world/items.js';
import { Mob } from '../src/mobs/mob.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { rng } from './helpers.js';

const st = (id, damage = 0) => ({ id, count: 1, damage });
const N = 30000;

/** A game just big enough for a mob to be hurt and to drop things. */
function fakeGame() {
  const drops = [], sounds = [];
  return {
    drops, sounds,
    audio: { play: (n) => sounds.push(n) },
    particles: { emit() {}, smoke() {} },
    entities: { spawnItem: (x, y, z, s) => drops.push(s), list: [] },
    player: { stats: { kills: 0 } },
  };
}

describe('off-hand rolls', () => {
  it('only Marauders and Vixlings hold anything', () => {
    for (const t of ['shambler', 'rattler', 'cluckling', 'voidwalker']) expect(rollOffhand(t, 1, {}, () => 0)).toBe(null);
  });
  it('Marauders: a shield (10 % + 15 % x difficulty, Captains +15 %), else a rare charm', () => {
    const r = rng(7);
    let shield = 0, charm = 0, shieldHard = 0, shieldCap = 0, charmCap = 0;
    for (let k = 0; k < N; k++) {
      const a = rollOffhand('marauder', 0, {}, r); if (isShield(a)) shield++; if (isCharm(a)) charm++;
      if (isShield(rollOffhand('marauder', 1, {}, r))) shieldHard++;
      const c = rollOffhand('marauder', 0, { captain: true }, r); if (isShield(c)) shieldCap++; if (isCharm(c)) charmCap++;
    }
    expect(shield / N).toBeCloseTo(0.1, 1);
    expect(charm / N).toBeCloseTo(0.9 * 0.02, 1);
    expect(shieldHard / N).toBeCloseTo(0.25, 1);
    expect(shieldCap / N).toBeCloseTo(0.25, 1);
    expect(charmCap / N).toBeCloseTo(0.75 * 0.12, 1);
  });
  it('Vixlings carry loot in 8 % of cases, never a tame one', () => {
    const r = rng(3);
    let loot = 0; const seen = new Set();
    for (let k = 0; k < N; k++) { const s = rollOffhand('vixling', 0, {}, r); if (s) { loot++; seen.add(s.id); expect(STOLEN_ITEMS.some(([id]) => id === s.id)).toBe(true); } }
    expect(loot / N).toBeCloseTo(VIXLING_LOOT_CHANCE, 1);
    expect(seen.size).toBe(STOLEN_ITEMS.length);
    expect(rollOffhand('vixling', 0, { tamed: true }, () => 0)).toBe(null);
  });
  it('a new Captain keeps what it holds, else gets the Captain chances', () => {
    const sh = st(I.SHIELD);
    expect(captainOffhand(sh, () => 0)).toBe(sh);
    expect(isShield(captainOffhand(null, () => 0))).toBe(true);
    expect(captainOffhand(null, () => 0.99)).toBe(null);
  });
});

describe('shields', () => {
  const mob = { x: 0, z: 0, yaw: 0 }; // looks along -z
  it('stop hits from the front, not from behind or the side', () => {
    const shield = st(I.SHIELD);
    expect(shieldBlocks(shield, mob, { x: 0, z: -5 }, 'player', 0)).toBe(true);
    expect(shieldBlocks(shield, mob, { x: 2, z: -3 }, 'player', 0)).toBe(true);
    expect(shieldBlocks(shield, mob, { x: 5, z: 0 }, 'player', 0)).toBe(false);
    expect(shieldBlocks(shield, mob, { x: 0, z: 5 }, 'player', 0)).toBe(false);
    // turned half way round it covers the other side
    expect(shieldBlocks(shield, { x: 0, z: 0, yaw: Math.PI }, { x: 0, z: 5 }, 'player', 0)).toBe(true);
  });
  it('only a part of the hits (75 %), and not fire, falls or blasts', () => {
    const shield = st(I.SHIELD), front = { x: 0, z: -4 };
    expect(shieldBlocks(shield, mob, front, 'player', SHIELD_BLOCK_CHANCE - 0.01)).toBe(true);
    expect(shieldBlocks(shield, mob, front, 'player', SHIELD_BLOCK_CHANCE + 0.01)).toBe(false);
    for (const src of ['fire', 'fall', 'drown', 'explosion', 'lava', 'void']) { expect(shieldIgnores(src)).toBe(true); expect(shieldBlocks(shield, mob, front, src, 0)).toBe(false); }
    expect(shieldBlocks(st(I.IRON_SWORD), mob, front, 'player', 0)).toBe(false);
    expect(shieldBlocks(null, mob, front, 'player', 0)).toBe(false);
  });
  it('an axe splinters it, other tools do not', () => {
    expect(disablesShield(st(I.IRON_AXE))).toBe(true);
    expect(disablesShield(st(I.IRON_SWORD))).toBe(false);
    expect(disablesShield(null)).toBe(false);
  });
  it('wear with the damage stopped and break at the end of their durability', () => {
    const s = st(I.SHIELD);
    expect(wearShield(s, 0.2)).toBe(false); expect(s.damage).toBe(1);
    expect(wearShield(s, 6.5)).toBe(false); expect(s.damage).toBe(8);
    s.damage = ITEMS[I.SHIELD].durability - 2;
    expect(wearShield(s, 2)).toBe(true);
  });
});

describe('charm and drops', () => {
  it('a charm leaves 1-6 health and ignores the void and the kill command', () => {
    expect(charmHealth(1)).toBe(1); expect(charmHealth(24)).toBe(6); expect(charmHealth(4)).toBe(4); expect(charmHealth(0)).toBe(1);
    expect(charmIgnores('void')).toBe(true); expect(charmIgnores('kill')).toBe(true); expect(charmIgnores('player')).toBe(false);
  });
  it('loot always drops, a charm only after a player kill, a shield sometimes and worn', () => {
    expect(offhandDrops(null)).toEqual([]);
    expect(offhandDrops(st(I.BONE), { killedByPlayer: false }, () => 0.99)).toEqual([st(I.BONE)]);
    expect(offhandDrops(st(I.CHARM_OF_UNDYING), { killedByPlayer: false })).toEqual([]);
    expect(offhandDrops(st(I.CHARM_OF_UNDYING), { killedByPlayer: true })).toHaveLength(1);
    expect(offhandDrops(st(I.SHIELD), { killedByPlayer: false }, () => 0)).toEqual([]);
    expect(offhandDrops(st(I.SHIELD), { killedByPlayer: true }, () => 0.99)).toEqual([]);
    const d = offhandDrops(st(I.SHIELD, 100), { killedByPlayer: true }, () => 0);
    expect(d).toHaveLength(1);
    expect(d[0].damage).toBeGreaterThanOrEqual(100);
    expect(d[0].damage).toBeLessThan(ITEMS[I.SHIELD].durability);
  });
});

describe('saving and the network', () => {
  it('ids and saves are validated', () => {
    expect(offhandId(st(I.SHIELD))).toBe(I.SHIELD);
    expect(offhandId(null)).toBe(0);
    expect(offhandFromId(I.SHIELD)).toEqual(st(I.SHIELD));
    expect(offhandFromId(0)).toBe(null);
    expect(offhandFromId(-3)).toBe(null);
    expect(offhandFromId(999999)).toBe(null);
    expect(offhandFromSave({ id: I.SHIELD, damage: 12.7, count: 9 })).toEqual({ id: I.SHIELD, count: 1, damage: 12 });
    expect(offhandFromSave({ id: 999999 })).toBe(null);
    expect(offhandFromSave('x')).toBe(null);
    expect(offhandFromSave(null)).toBe(null);
  });
  it('a mob saves and loads its off-hand item', () => {
    const m = new Mob('marauder', 0, 64, 0);
    m.offhand = st(I.SHIELD, 30);
    const copy = new Mob('marauder', 0, 64, 0);
    copy.loadData(JSON.parse(JSON.stringify(m.saveData())));
    expect(copy.offhand).toEqual(st(I.SHIELD, 30));
    expect(new Mob('marauder', 0, 64, 0).saveData().offhand).toBeUndefined();
  });
  it('is snapshot field 24, and the older fields stay where they were', () => {
    const m = new Mob('vixling', 1, 64, 2);
    m.offhand = st(I.FEATHER);
    const packed = JSON.parse(JSON.stringify(packMob(m)));
    expect(packed.length).toBe(25);
    expect(packed[24]).toBe(I.FEATHER);
    expect(packed[23]).toBe(0); // held item of a Hoverling
    expect(packed[22]).toBe(-1);
    const un = unpackMob(packed);
    expect(un.offhand).toBe(I.FEATHER);
    expect(offhandFromId(un.offhand)).toEqual(st(I.FEATHER));
    expect(unpackMob(packed.slice(0, 24)).offhand).toBe(0); // an older host sends none
    expect(packMob(new Mob('vixling', 0, 64, 0))[24]).toBe(0);
  });
});

describe('Marauders with shields in a fight', () => {
  function marauder(shield = st(I.SHIELD)) {
    const m = new Mob('marauder', 0, 64, 0);
    m._game = fakeGame();
    m.offhand = shield;
    m.yaw = 0; // looks along -z
    return m;
  }
  const player = (x, z, held = null) => ({ isPlayer: true, x, y: 64, z, inventory: { selectedStack: held } });
  const lowRoll = (f) => { const real = Math.random; Math.random = () => 0; try { return f(); } finally { Math.random = real; } };

  it('turn a blow from the front and wear down', () => {
    const m = marauder(), hp = m.health;
    expect(lowRoll(() => m.hurt(5, 'player', player(0, -2)))).toBe(false);
    expect(m.health).toBe(hp);
    expect(m.offhand.damage).toBe(5);
    expect(m._game.sounds).toContain('shield');
  });
  it('take a blow from behind', () => {
    const m = marauder(), hp = m.health;
    expect(lowRoll(() => m.hurt(5, 'player', player(0, 3)))).toBe(true);
    expect(m.health).toBeLessThan(hp);
    expect(m.offhand.damage).toBe(0);
  });
  it('are splintered by an axe, and the blow lands', () => {
    const m = marauder(), hp = m.health;
    expect(lowRoll(() => m.hurt(5, 'player', player(0, -2, st(I.IRON_AXE))))).toBe(true);
    expect(m.offhand).toBe(null);
    expect(m.health).toBeLessThan(hp);
  });
  it('break when worn out', () => {
    const m = marauder(st(I.SHIELD, ITEMS[I.SHIELD].durability - 2));
    lowRoll(() => m.hurt(4, 'player', player(0, -2)));
    expect(m.offhand).toBe(null);
  });
  it('do not help against fire', () => {
    const m = marauder(), hp = m.health;
    expect(lowRoll(() => m.hurt(2, 'fire'))).toBe(true);
    expect(m.health).toBeLessThan(hp);
  });
});

describe('the Charm of Undying in a mob hand', () => {
  it('keeps it alive once, then it dies', () => {
    const m = new Mob('marauder', 0, 64, 0);
    m._game = fakeGame();
    m.offhand = st(I.CHARM_OF_UNDYING);
    m.hurt(500, 'player');
    expect(m.health).toBeGreaterThan(0);
    expect(m.health).toBeLessThanOrEqual(6);
    expect(m.offhand).toBe(null);
    expect(m.deathTime).toBe(0);
    m.invulnerable = 0;
    m.hurt(500, 'player');
    expect(m.health).toBeLessThanOrEqual(0);
    expect(m.deathTime).toBeGreaterThan(0);
  });
  it('does not stop the void', () => {
    const m = new Mob('marauder', 0, 64, 0);
    m._game = fakeGame();
    m.offhand = st(I.CHARM_OF_UNDYING);
    m.hurt(500, 'void');
    expect(m.deathTime).toBeGreaterThan(0);
  });
});

describe('Vixling loot', () => {
  it('is spat out when the Vixling is hurt', () => {
    const m = new Mob('vixling', 0, 64, 0);
    m._game = fakeGame();
    m.offhand = st(I.BONE);
    m.hurt(1, 'player');
    expect(m.offhand).toBe(null);
    expect(m._game.drops).toEqual([st(I.BONE)]);
  });
  it('is dropped when it dies', () => {
    const m = new Mob('vixling', 0, 64, 0);
    m._game = fakeGame();
    m.offhand = st(I.EGG);
    m.hurt(500, 'fall');
    expect(m._game.drops.map((d) => d.id)).toContain(I.EGG);
  });
  it('a tame one keeps what it holds', () => {
    const m = new Mob('vixling', 0, 64, 0);
    m._game = fakeGame();
    m.tamed = true; m.offhand = st(I.BONE);
    m.hurt(1, 'player');
    expect(m.offhand).toEqual(st(I.BONE));
  });
});
