import { describe, it, expect } from 'vitest';
import {
  localDifficulty, clampedDifficulty, rollArmorTier, rollEquipment, rollCanPickUp, mobDamageTaken, weaponBonus,
  equipmentDrops, dropDamage, slotFor, isBetter, jockeyRoll, equipIds, equipFromIds, equipFromSave, armorItem, EQUIP_DROP_CHANCE, helmetShadesSun,
} from '../src/mobs/equipment.js';
import { armorReduce } from '../src/player/armor.js';
import { I, ITEMS } from '../src/world/items.js';
import { Mob } from '../src/mobs/mob.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { rng } from './helpers.js';

const st = (id, damage = 0) => ({ id, count: 1, damage });
const N = 40000;

describe('local difficulty', () => {
  it('follows the reference formula', () => {
    expect(localDifficulty({ difficulty: 'peaceful', worldTicks: 1e9 })).toBe(0);
    expect(localDifficulty({ difficulty: 'normal', worldTicks: 0 })).toBeCloseTo(1.5);
    expect(localDifficulty({ difficulty: 'hard', worldTicks: 0 })).toBeCloseTo(2.25);
    expect(localDifficulty({ difficulty: 'easy', worldTicks: 0 })).toBeCloseTo(0.75);
    // a world 21 days old (fully aged), 50 hours spent in the chunk, a full "moon"
    expect(localDifficulty({ difficulty: 'normal', worldTicks: 1512000, inhabitedTicks: 3600000, moon: 1 })).toBeCloseTo(4);
    expect(localDifficulty({ difficulty: 'hard', worldTicks: 1512000, inhabitedTicks: 3600000, moon: 1 })).toBeCloseTo(6.75);
    // grows with the world's age
    const a = localDifficulty({ worldTicks: 100000 }), b = localDifficulty({ worldTicks: 800000 });
    expect(b).toBeGreaterThan(a);
  });
  it('the clamped multiplier is 0 below 2, 1 above 4, linear between', () => {
    expect(clampedDifficulty(1.5)).toBe(0);
    expect(clampedDifficulty(3)).toBeCloseTo(0.5);
    expect(clampedDifficulty(4.5)).toBe(1);
  });
});

describe('equipment rolls', () => {
  it('armour tier: 0 or 1 plus three 9.5 % upgrades', () => {
    const r = rng(3);
    let sum = 0, diamond = 0;
    for (let k = 0; k < N; k++) { const t = rollArmorTier(r); sum += t; if (t === 4) diamond++; expect(t).toBeGreaterThanOrEqual(0); expect(t).toBeLessThanOrEqual(4); }
    expect(sum / N).toBeCloseTo(0.5 + 3 * 0.095, 1);
    expect(diamond / N).toBeCloseTo(0.5 * 0.095 ** 3, 3);
    expect(ITEMS[armorItem(4, 0)].armor).toMatchObject({ material: 'diamond', piece: 'helmet' });
    expect(ITEMS[armorItem(0, 3)].armor).toMatchObject({ material: 'leather', piece: 'boots' });
  });

  it('nothing for mobs without gear; archers always hold a bow', () => {
    for (const t of ['sodden_shambler', 'hexwife', 'fizzler', 'cluckling']) expect(rollEquipment(t, 1, 'normal', rng(1))).toBe(null);
    const r = rng(5);
    for (let k = 0; k < 200; k++) {
      expect(rollEquipment('rattler', 0, 'normal', r).hand.id).toBe(I.BOW);
      expect(rollEquipment('rime_rattler', 0, 'normal', r).hand.id).toBe(I.BOW);
    }
  });

  it('no armour at clamped difficulty 0; 15 % at 1, from the boots up', () => {
    const r = rng(7);
    for (let k = 0; k < 2000; k++) expect(rollEquipment('shambler', 0, 'normal', r).armor.every((a) => !a)).toBe(true);
    let armoured = 0, helmets = 0;
    for (let k = 0; k < N; k++) {
      const eq = rollEquipment('shambler', 1, 'normal', r);
      const worn = eq.armor.map(Boolean);
      if (!worn.some(Boolean)) continue;
      armoured++;
      expect(worn[3]).toBe(true); // boots always first
      const first = worn.indexOf(true);
      expect(worn.slice(first).every(Boolean)).toBe(true); // then upwards without gaps
      if (worn[0]) helmets++;
      const mats = new Set(eq.armor.filter(Boolean).map((a) => ITEMS[a.id].armor.material));
      expect(mats.size).toBe(1); // one material for the whole set
    }
    expect(armoured / N).toBeCloseTo(0.15, 1);
    expect(helmets / armoured).toBeCloseTo(0.75 ** 3, 1);
  });

  it('melee mobs: 1 % a weapon on Normal, 5 % on Hard, one in three a sword', () => {
    const r = rng(11);
    let normal = 0, hard = 0, swords = 0;
    for (let k = 0; k < N; k++) {
      const a = rollEquipment('shambler', 0, 'normal', r).hand;
      if (a && a.id !== I.IRON_AXE) normal++; // (the rare axe is rolled on top, see the axe test)
      const b = rollEquipment('dune_shambler', 0, 'hard', r).hand;
      if (b && b.id !== I.IRON_AXE) { hard++; if (b.id === I.IRON_SWORD) swords++; else expect(b.id).toBe(I.IRON_SHOVEL); }
    }
    expect(normal / N).toBeCloseTo(0.01, 2);
    expect(hard / N).toBeCloseTo(0.05, 2);
    expect(swords / hard).toBeCloseTo(1 / 3, 1);
  });

  it('loot pick-up is allowed with chance 0.55 x clamped difficulty', () => {
    const r = rng(13);
    let n = 0;
    for (let k = 0; k < N; k++) if (rollCanPickUp(0.5, r)) n++;
    expect(n / N).toBeCloseTo(0.275, 1);
    expect(rollCanPickUp(0, r)).toBe(false);
  });
});

describe('armour and weapons in a fight', () => {
  const ironSet = { hand: null, armor: [st(I.IRON_HELMET), st(I.IRON_CHESTPLATE), st(I.IRON_LEGGINGS), st(I.IRON_BOOTS)] };
  it('worn armour reduces damage with the player formula, on top of natural armour', () => {
    expect(mobDamageTaken(6, 0, null)).toBe(6);
    expect(mobDamageTaken(6, 2, null)).toBeCloseTo(6 * (1 - Math.max(2 / 5, 2 - 3) / 25)); // the old natural-armour rule
    expect(mobDamageTaken(6, 0, ironSet, 'player')).toBeCloseTo(armorReduce(6, 15));
    expect(mobDamageTaken(6, 2, ironSet, 'arrow')).toBeCloseTo(armorReduce(6, 17));
    const dia = { hand: null, armor: [st(I.DIAMOND_HELMET), st(I.DIAMOND_CHESTPLATE), st(I.DIAMOND_LEGGINGS), st(I.DIAMOND_BOOTS)] };
    expect(mobDamageTaken(10, 0, dia)).toBeCloseTo(armorReduce(10, 20, 8));
    // fire, falls and magic go through worn armour (natural armour still counts, as before)
    expect(mobDamageTaken(6, 0, ironSet, 'fire')).toBe(6);
    expect(mobDamageTaken(6, 2, ironSet, 'magic')).toBeCloseTo(mobDamageTaken(6, 2, null, 'magic'));
  });

  it('an armoured Shambler takes less from the same hit', () => {
    const a = new Mob('shambler', 0, 64, 0), b = new Mob('shambler', 0, 64, 0);
    b.equip = ironSet;
    a.hurt(8, 'player'); b.hurt(8, 'player');
    expect(20 - a.health).toBeCloseTo(mobDamageTaken(8, 2, null));
    expect(20 - b.health).toBeCloseTo(armorReduce(8, 17));
    expect(b.health).toBeGreaterThan(a.health);
  });

  it('a helmet keeps the sun off an undead mob until it wears out', () => {
    expect(helmetShadesSun(null)).toBe(false);
    expect(helmetShadesSun({ hand: null, armor: [null, st(I.IRON_CHESTPLATE), null, null] })).toBe(false);
    const eq = { hand: null, armor: [st(I.LEATHER_HELMET), null, null, null] };
    const r = rng(29);
    let checks = 0;
    while (helmetShadesSun(eq, r)) checks++;
    expect(eq.armor[0]).toBe(null);
    expect(checks).toBeGreaterThan(ITEMS[I.LEATHER_HELMET].durability); // about two checks per point of wear
  });

  it('a held weapon adds its bonus to the mob\'s attack', () => {
    expect(weaponBonus(st(I.IRON_SWORD))).toBe(5);
    expect(weaponBonus(st(I.IRON_SHOVEL))).toBe(3.5);
    expect(weaponBonus(st(I.BOW))).toBe(0);
    expect(weaponBonus(null)).toBe(0);
    const m = new Mob('shambler', 0, 64, 0);
    expect(m.attackDamage()).toBe(3);
    m.equip = { hand: st(I.IRON_SWORD), armor: [null, null, null, null] };
    expect(m.attackDamage()).toBe(8);
  });
});

describe('equipment drops', () => {
  const eq = { hand: st(I.IRON_SWORD), armor: [st(I.GOLD_HELMET), null, null, st(I.LEATHER_BOOTS)] };
  it('8.5 % per piece on a player kill (+1 % per Plunder level), never otherwise', () => {
    const r = rng(17);
    for (let k = 0; k < 2000; k++) expect(equipmentDrops(eq, { killedByPlayer: false }, r)).toEqual([]);
    let n = 0, p3 = 0;
    for (let k = 0; k < N; k++) {
      n += equipmentDrops(eq, { killedByPlayer: true }, r).length;
      p3 += equipmentDrops(eq, { killedByPlayer: true, plunder: 3 }, r).length;
    }
    expect(n / (3 * N)).toBeCloseTo(EQUIP_DROP_CHANCE, 2);
    expect(p3 / (3 * N)).toBeCloseTo(0.115, 2);
  });
  it('dropped pieces come worn; picked-up ones drop always and as they were', () => {
    const r = rng(19);
    for (let k = 0; k < 500; k++) {
      const d = dropDamage(I.IRON_SWORD, r), max = ITEMS[I.IRON_SWORD].durability;
      expect(d).toBeGreaterThanOrEqual(3); expect(d).toBeLessThan(max);
    }
    const out = equipmentDrops(eq, { killedByPlayer: false, picked: 1 }, r); // only the hand was picked up
    expect(out).toEqual([{ id: I.IRON_SWORD, count: 1, damage: 0 }]);
  });
  it('a dying mob drops them where it falls', () => {
    const items = [];
    const g = { player: { stats: { kills: 0 } }, entities: { spawnItem: (x, y, z, s) => items.push(s) }, audio: { play() {} } };
    const m = new Mob('shambler', 0, 64, 0);
    m.equip = { hand: st(I.IRON_SHOVEL), armor: [null, null, null, null] };
    m.equipPicked = 1;
    m._game = g;
    m.hurt(100, 'fall');
    expect(items.some((s) => s.id === I.IRON_SHOVEL)).toBe(true);
  });
});

describe('picking up gear', () => {
  it('only armour and (for melee mobs) tools fit, into the right slot', () => {
    expect(slotFor('shambler', I.IRON_HELMET)).toBe(1);
    expect(slotFor('shambler', I.DIAMOND_BOOTS)).toBe(4);
    expect(slotFor('shambler', I.STONE_SWORD)).toBe(0);
    expect(slotFor('rattler', I.STONE_SWORD)).toBe(-1);
    expect(slotFor('rattler', I.GOLD_CHESTPLATE)).toBe(2);
    expect(slotFor('shambler', I.ROTTEN_FLESH)).toBe(-1);
    expect(slotFor('fizzler', I.IRON_HELMET)).toBe(-1);
  });
  it('better means more defence, a sword over other tools, more damage, or less wear', () => {
    expect(isBetter(1, st(I.IRON_HELMET), null)).toBe(true);
    expect(isBetter(1, st(I.DIAMOND_HELMET), st(I.IRON_HELMET))).toBe(true);
    expect(isBetter(1, st(I.LEATHER_HELMET), st(I.IRON_HELMET))).toBe(false);
    expect(isBetter(1, st(I.IRON_HELMET), st(I.IRON_HELMET, 40))).toBe(true);
    expect(isBetter(0, st(I.STONE_SWORD), st(I.IRON_SHOVEL))).toBe(true);
    expect(isBetter(0, st(I.DIAMOND_SHOVEL), st(I.WOOD_SWORD))).toBe(false);
    expect(isBetter(0, st(I.DIAMOND_SWORD), st(I.IRON_SWORD))).toBe(true);
    expect(isBetter(0, st(I.IRON_SWORD), st(I.BOW))).toBe(false); // an archer keeps its bow
  });
});

describe('chicken jockeys', () => {
  it('5 % climb on a free Cluckling nearby, otherwise 5 % bring their own', () => {
    const r = rng(23);
    let ex = 0, nw = 0, none = 0;
    for (let k = 0; k < N; k++) {
      const a = jockeyRoll(true, r); if (a === 'existing') ex++; else if (a === 'new') nw++;
      if (jockeyRoll(false, r) === 'new') none++;
    }
    expect(ex / N).toBeCloseTo(0.05, 2);
    expect(nw / N).toBeCloseTo(0.95 * 0.05, 2);
    expect(none / N).toBeCloseTo(0.95 * 0.05, 2);
  });
  it('the rider sits on its mount and both let go when one of them goes', () => {
    const baby = new Mob('shambler', 3, 70, 3), hen = new Mob('cluckling', 0, 64, 0);
    baby.setBaby(true);
    baby.mountOn(hen);
    expect(baby.mount).toBe(hen); expect(hen.passenger).toBe(baby); expect(hen.jockey).toBe(true);
    expect(hen.persistent).toBe(false);
    expect(baby.x).toBe(0); expect(baby.y).toBeCloseTo(64 + hen.jockeySeat);
    hen.body.setPos(2, 65, 1);
    hen.placePassenger();
    expect([baby.x, baby.z]).toEqual([2, 1]);
    baby.dismount();
    expect(baby.mount).toBe(null); expect(hen.passenger).toBe(null);
    // a loaded mob is never left riding a fresh jockey's mount
    const h2 = new Mob('cluckling', 0, 64, 0), b2 = new Mob('shambler', 0, 64, 0);
    b2.mountOn(h2);
    b2.loadData({ ...b2.saveData(), age: 0 });
    expect(b2.mount).toBe(null); expect(h2.removed).toBe(true);
  });
});

describe('saving and multiplayer', () => {
  it('gear is kept with a saved mob', () => {
    const m = new Mob('shambler', 0, 64, 0);
    m.equip = { hand: st(I.IRON_SWORD, 12), armor: [st(I.GOLD_HELMET), null, st(I.IRON_LEGGINGS, 4), st(I.IRON_BOOTS)] };
    m.equipPicked = 1; m.canPickUp = true;
    const back = new Mob('shambler', 0, 64, 0);
    back.loadData(JSON.parse(JSON.stringify(m.saveData())));
    expect(back.equip).toEqual(m.equip);
    expect(back.equipPicked).toBe(1); expect(back.canPickUp).toBe(true);
    const plain = new Mob('shambler', 0, 64, 0);
    plain.loadData(new Mob('shambler', 0, 64, 0).saveData());
    expect(plain.equip).toBe(null);
    expect(equipFromSave({ hand: { id: 999999 }, armor: 'x' })).toEqual({ hand: null, armor: [null, null, null, null] });
  });
  it('mob snapshots carry the gear and the riding flag', () => {
    const eq = { hand: st(I.IRON_SHOVEL), armor: [null, st(I.DIAMOND_CHESTPLATE), null, st(I.LEATHER_BOOTS)] };
    const m = { id: 9, type: 'shambler', x: 1, y: 2, z: 3, yaw: 0, health: 20, age: -24000, equip: eq, mount: {}, body: { onGround: true } };
    const s = unpackMob(packMob(m));
    expect(s.riding).toBe(true);
    expect(s.equip).toEqual(equipIds(eq));
    expect(equipFromIds(s.equip)).toEqual({ hand: st(I.IRON_SHOVEL), armor: [null, st(I.DIAMOND_CHESTPLATE), null, st(I.LEATHER_BOOTS)] });
    const bare = unpackMob(packMob({ ...m, equip: null, mount: null }));
    expect(bare.equip).toBe(null); expect(bare.riding).toBe(false);
    expect(unpackMob(packMob(m).slice(0, 16)).equip).toBe(null); // older hosts send no gear
  });
});
