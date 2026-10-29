import { describe, it, expect } from 'vitest';
import {
  rollEquipment, spawnGear, enchantEquipment, enchantStack, gearEnchantLevel, hasEnchantedGear, gearXp, bowPower,
  mobDamageTaken, weaponBonus, equipmentDrops, equipIds, equipFromIds, equipFromSave, GLINT_BIT,
  ENCHANT_ARMOR_CHANCE, ENCHANT_WEAPON_CHANCE, EQUIP_DROP_CHANCE,
} from '../src/mobs/equipment.js';
import { ENCHANTS, canApply, hasEnch, enchLevel } from '../src/world/enchantments.js';
import { armorReduce } from '../src/player/armor.js';
import { I, ITEMS } from '../src/world/items.js';
import { Mob } from '../src/mobs/mob.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { rng } from './helpers.js';

const st = (id, damage = 0, ench = null) => ({ id, count: 1, damage, ...(ench ? { ench } : {}) });
const ironSet = (ench = null) => ({ hand: null, armor: [I.IRON_HELMET, I.IRON_CHESTPLATE, I.IRON_LEGGINGS, I.IRON_BOOTS].map((id) => st(id, 0, ench)) });
const N = 20000;

describe('rolling enchantments onto mob gear', () => {
  it('the level is 5 + rnd(18 x clamped difficulty)', () => {
    const r = rng(1);
    let lo = 99, hi = 0;
    for (let k = 0; k < 4000; k++) { const l = gearEnchantLevel(1, r); lo = Math.min(lo, l); hi = Math.max(hi, l); }
    expect([lo, hi]).toEqual([5, 22]);
    for (let k = 0; k < 500; k++) expect(gearEnchantLevel(0.5, r)).toBeLessThanOrEqual(13);
    expect(gearEnchantLevel(0, r)).toBe(5);
  });

  it('nothing is enchanted at clamped difficulty 0, for mobs without gear, or when nothing is worn', () => {
    const r = rng(2);
    for (let k = 0; k < 500; k++) expect(hasEnchantedGear(spawnGear('shambler', 0, 'normal', r))).toBe(false);
    expect(spawnGear('fizzler', 1, 'normal', r)).toBe(null);
    expect(enchantEquipment(null, 1, r)).toBe(null);
    const bare = { hand: null, armor: [null, null, null, null] };
    expect(hasEnchantedGear(enchantEquipment(bare, 1, r))).toBe(false);
  });

  it('each worn piece has a 50 % x clamped chance, a held weapon or bow 25 % x clamped', () => {
    const r = rng(3);
    let worn = 0, pieces = 0, held = 0;
    for (let k = 0; k < N; k++) {
      const eq = { hand: st(I.IRON_SWORD), armor: [st(I.DIAMOND_HELMET), st(I.DIAMOND_CHESTPLATE), st(I.DIAMOND_LEGGINGS), st(I.DIAMOND_BOOTS)] };
      enchantEquipment(eq, 1, r);
      for (const a of eq.armor) { pieces++; if (hasEnch(a)) worn++; }
      if (hasEnch(eq.hand)) held++;
    }
    expect(ENCHANT_ARMOR_CHANCE).toBe(0.5); expect(ENCHANT_WEAPON_CHANCE).toBe(0.25);
    // diamond armour (enchantability 10) always finds something to roll at level 5+
    expect(worn / pieces).toBeCloseTo(0.5, 1);
    expect(held / N).toBeCloseTo(0.25, 1);
    // at half the clamped difficulty, half as often
    let half = 0;
    for (let k = 0; k < N; k++) { const eq = ironSet(); enchantEquipment(eq, 0.5, r); half += eq.armor.filter(hasEnch).length; }
    expect(half / (N * 4)).toBeCloseTo(0.25, 1);
  });

  it('only rolls enchantments that fit the item, and never more than one of an exclusive kind', () => {
    const r = rng(4);
    for (let k = 0; k < 2000; k++) {
      const eq = { hand: st(k % 2 ? I.IRON_SWORD : I.BOW), armor: [st(I.IRON_HELMET), st(I.GOLD_CHESTPLATE), st(I.LEATHER_LEGGINGS), st(I.DIAMOND_BOOTS)] };
      enchantEquipment(eq, 1, r);
      for (const s of [eq.hand, ...eq.armor]) {
        if (!hasEnch(s)) continue;
        for (const [key, level] of Object.entries(s.ench)) {
          expect(canApply(key, s.id)).toBe(true);
          expect(level).toBeGreaterThanOrEqual(1);
          expect(level).toBeLessThanOrEqual(ENCHANTS[key].max);
        }
        expect(s.ench.keen && s.ench.hallowed).toBeFalsy(); // one damage enchantment
      }
    }
  });

  it('a spawned Shambler or Rattler comes with enchanted gear now and then (armour first, then a weapon)', () => {
    const r = rng(5);
    let armoured = 0, enchanted = 0, swords = 0, enchSwords = 0, bows = 0, enchBows = 0;
    for (let k = 0; k < 60000; k++) {
      const eq = spawnGear('shambler', 1, 'hard', r);
      if (eq.armor.some(Boolean)) { armoured++; if (eq.armor.some(hasEnch)) enchanted++; }
      if (eq.hand) { swords++; if (hasEnch(eq.hand)) enchSwords++; }
    }
    expect(armoured / 60000).toBeCloseTo(0.15, 1);
    expect(enchanted / armoured).toBeGreaterThan(0.5); // 1 - 0.5^pieces of a set of 1-4 pieces
    expect(enchanted / armoured).toBeLessThan(0.95);
    expect(enchSwords / swords).toBeCloseTo(0.25, 1);
    for (let k = 0; k < 4000; k++) {
      const eq = spawnGear('rattler', 1, 'normal', r);
      expect(eq.hand.id).toBe(I.BOW);
      bows++;
      if (hasEnch(eq.hand)) { enchBows++; for (const key of Object.keys(eq.hand.ench)) expect(['strongdraw', 'endless', 'steadfast']).toContain(key); }
    }
    expect(enchBows / bows).toBeGreaterThan(0.15);
  });

  it('rollEquipment alone is unchanged: no enchantments, the same stream of rolls', () => {
    const a = rollEquipment('shambler', 1, 'normal', rng(9)), b = rollEquipment('shambler', 1, 'normal', rng(9));
    expect(a).toEqual(b);
    for (const s of [a.hand, ...a.armor]) expect(hasEnch(s)).toBe(false);
    // an ominous spawner raises the armour chance
    const r = rng(10);
    let n = 0;
    for (let k = 0; k < 4000; k++) if (rollEquipment('shambler', 1, 'normal', r, { armorChance: 0.65 }).armor.some(Boolean)) n++;
    expect(n / 4000).toBeCloseTo(0.65, 1);
  });

  it('enchantStack leaves a stack alone when nothing fits', () => {
    const s = enchantStack(st(I.APPLE), 20, rng(1));
    expect(hasEnch(s)).toBe(false);
  });
});

describe('enchanted gear in a fight', () => {
  it('Bulwark on worn pieces cuts the damage a mob takes, like the player\'s', () => {
    const plain = ironSet(), bulwark = ironSet({ bulwark: 4 }); // 4 pieces x level IV = 16 protection points
    const base = mobDamageTaken(10, 0, plain, 'player');
    expect(base).toBeCloseTo(armorReduce(10, 15));
    expect(mobDamageTaken(10, 0, bulwark, 'player')).toBeCloseTo(base * (1 - 16 / 25));
    // it works against fire, which armour alone does not stop; never against the void
    expect(mobDamageTaken(10, 0, bulwark, 'fire')).toBeCloseTo(10 * (1 - 16 / 25));
    expect(mobDamageTaken(10, 0, bulwark, 'void')).toBe(10);
    // capped at 20 points
    const huge = ironSet({ bulwark: 10 });
    expect(mobDamageTaken(10, 0, huge, 'fire')).toBeCloseTo(10 * (1 - 20 / 25));
  });

  it('an enchanted Shambler takes less from the same hit', () => {
    const a = new Mob('shambler', 0, 64, 0), b = new Mob('shambler', 0, 64, 0);
    a.equip = ironSet(); b.equip = ironSet({ bulwark: 3 });
    a.hurt(8, 'player'); b.hurt(8, 'player');
    expect(b.health).toBeGreaterThan(a.health);
    expect(20 - b.health).toBeCloseTo((20 - a.health) * (1 - 12 / 25));
  });

  it('Keen on a held blade adds to the mob\'s blows; Strongdraw to an archer\'s arrows', () => {
    expect(weaponBonus(st(I.IRON_SWORD))).toBe(5);
    expect(weaponBonus(st(I.IRON_SWORD, 0, { keen: 3 }))).toBe(5 + 2);
    expect(weaponBonus(st(I.IRON_SHOVEL, 0, { keen: 1 }))).toBeCloseTo(3.5 + 1);
    expect(weaponBonus(st(I.BOW, 0, { strongdraw: 4 }))).toBe(0); // a bow does not hit harder in melee
    const m = new Mob('shambler', 0, 64, 0);
    m.equip = { hand: st(I.IRON_SWORD, 0, { keen: 5 }), armor: [null, null, null, null] };
    expect(m.attackDamage()).toBe(3 + 5 + 3);
    expect(bowPower(null)).toBe(0);
    expect(bowPower({ hand: st(I.BOW), armor: [] })).toBe(0);
    expect(bowPower({ hand: st(I.BOW, 0, { strongdraw: 4 }), armor: [] })).toBe(4);
    const arrows = [];
    const r = new Mob('rattler', 0, 64, 0);
    r.equip = { hand: st(I.BOW, 0, { strongdraw: 3 }), armor: [null, null, null, null] };
    const g = { audio: { play() {} }, entities: { spawnArrow: (...a) => { arrows.push(a); return {}; } } };
    r.shoot(g, { x: 5, y: 64, z: 0, body: { height: 1.8 } });
    expect(arrows[0][9]).toBe(3); // spawnArrow(x, y, z, vx, vy, vz, shooter, crit, thrown, power)
  });
});

describe('drops and experience scale with the gear', () => {
  it('a dropped enchanted piece keeps its enchantments (worn, never better than it was)', () => {
    const eq = { hand: st(I.IRON_SWORD, 0, { keen: 2 }), armor: [null, st(I.IRON_CHESTPLATE, 0, { bulwark: 3, steadfast: 1 }), null, null] };
    const always = () => 0; // every drop roll succeeds
    const out = equipmentDrops(eq, { killedByPlayer: true }, always);
    expect(out.length).toBe(2);
    expect(out.find((s) => s.id === I.IRON_SWORD).ench).toEqual({ keen: 2 });
    expect(out.find((s) => s.id === I.IRON_CHESTPLATE).ench).toEqual({ bulwark: 3, steadfast: 1 });
    // picked-up enchanted gear always drops, undamaged
    const picked = equipmentDrops({ hand: null, armor: [st(I.DIAMOND_HELMET, 5, { bulwark: 4 }), null, null, null] }, { killedByPlayer: false, picked: 1 << 1 }, () => 0.99);
    expect(picked).toEqual([{ id: I.DIAMOND_HELMET, count: 1, damage: 5, ench: { bulwark: 4 } }]);
    // no player kill: only the picked-up ones
    expect(equipmentDrops(eq, { killedByPlayer: false }, always)).toEqual([]);
    expect(EQUIP_DROP_CHANCE).toBe(0.085);
  });

  it('experience grows with every piece and more for enchanted ones', () => {
    const r = rng(7);
    expect(gearXp(null)).toBe(0);
    expect(gearXp({ hand: null, armor: [null, null, null, null] })).toBe(0);
    let plain = 0, ench = 0, loP = 99, hiP = 0, loE = 99, hiE = 0;
    for (let k = 0; k < 3000; k++) {
      const a = gearXp({ hand: null, armor: [st(I.IRON_HELMET), null, null, null] }, r);
      const b = gearXp({ hand: null, armor: [st(I.IRON_HELMET, 0, { bulwark: 1 }), null, null, null] }, r);
      plain += a; ench += b; loP = Math.min(loP, a); hiP = Math.max(hiP, a); loE = Math.min(loE, b); hiE = Math.max(hiE, b);
    }
    expect([loP, hiP]).toEqual([1, 3]);
    expect([loE, hiE]).toEqual([3, 7]);
    expect(ench).toBeGreaterThan(plain * 2);
    // a full set with a sword adds up
    const full = gearXp({ hand: st(I.IRON_SWORD, 0, { keen: 1 }), armor: [st(I.IRON_HELMET), st(I.IRON_CHESTPLATE), st(I.IRON_LEGGINGS), st(I.IRON_BOOTS)] }, () => 0);
    expect(full).toBe(3 + 4 * 1);
  });

  it('a kill by a player drops an orb worth the base experience plus the gear\'s', () => {
    const m = new Mob('shambler', 0, 64, 0);
    m.equip = { hand: null, armor: [st(I.IRON_HELMET, 0, { bulwark: 2 }), null, null, null] };
    m.killedByPlayer = true; m.deathTime = 19;
    const xp = [];
    const g = {
      world: { getBlock: () => 0, getMeta: () => 0 }, hush: null,
      entities: { spawnXp: (x, y, z, n) => xp.push(n), spawnItem() {} },
      particles: { smoke() {} }, audio: { play() {} }, sky: { state: {} },
    };
    m._game = g;
    m.tick(g);
    expect(xp.length).toBe(1);
    expect(xp[0]).toBeGreaterThanOrEqual(5 + 3);
    expect(xp[0]).toBeLessThanOrEqual(5 + 7);
  });
});

describe('saving and multiplayer', () => {
  it('enchanted gear is kept with a saved mob and cleaned on loading', () => {
    const m = new Mob('shambler', 0, 64, 0);
    m.equip = { hand: st(I.IRON_SWORD, 12, { keen: 2 }), armor: [st(I.GOLD_HELMET, 0, { bulwark: 4, steadfast: 2 }), null, null, st(I.IRON_BOOTS)] };
    const back = new Mob('shambler', 0, 64, 0);
    back.loadData(JSON.parse(JSON.stringify(m.saveData())));
    expect(back.equip).toEqual(m.equip);
    expect(enchLevel(back.equip.armor[0], 'bulwark')).toBe(4);
    const bad = equipFromSave({ hand: { id: I.IRON_SWORD, ench: { keen: 99, bogus: 3, hallowed: -2 } }, armor: [{ id: I.IRON_HELMET, ench: 'x' }, null, null, null] });
    expect(bad.hand.ench).toEqual({ keen: 10 });
    expect(bad.armor[0].ench).toBeUndefined();
  });

  it('snapshots flag enchanted pieces so guests show the glint, without touching other fields', () => {
    const eq = { hand: st(I.IRON_SWORD, 0, { keen: 1 }), armor: [null, st(I.DIAMOND_CHESTPLATE, 0, { bulwark: 2 }), st(I.IRON_LEGGINGS), null] };
    const ids = equipIds(eq);
    expect(ids).toEqual([I.IRON_SWORD | GLINT_BIT, 0, I.DIAMOND_CHESTPLATE | GLINT_BIT, I.IRON_LEGGINGS, 0]);
    expect(equipIds({ hand: null, armor: [st(I.IRON_HELMET), null, null, null] })).toEqual([0, I.IRON_HELMET, 0, 0, 0]); // plain gear: the same ids as before
    const m = { id: 4, type: 'shambler', x: 1, y: 2, z: 3, yaw: 0, health: 20, age: 0, equip: eq, body: { onGround: true } };
    const packed = JSON.parse(JSON.stringify(packMob(m)));
    expect(packed.length).toBe(25);
    expect(packed[20]).toEqual(ids);
    const shown = equipFromIds(unpackMob(packed).equip);
    expect(shown.hand.id).toBe(I.IRON_SWORD);
    expect(hasEnch(shown.hand)).toBe(true);
    expect(shown.armor[1].id).toBe(I.DIAMOND_CHESTPLATE);
    expect(hasEnch(shown.armor[1])).toBe(true);
    expect(shown.armor[2]).toMatchObject({ id: I.IRON_LEGGINGS });
    expect(hasEnch(shown.armor[2])).toBe(false);
    expect(ITEMS[shown.armor[1].id]).toBeTruthy();
    expect(equipFromIds([GLINT_BIT | 999999, 0, 0, 0, 0]).hand).toBe(null);
  });
});
