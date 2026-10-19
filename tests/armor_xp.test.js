import { describe, it, expect } from 'vitest';
import { armorReduce, armorTotals, wearArmor } from '../src/player/armor.js';
import { xpToNextLevel, addXp, newXp, splitOrbs, deathXp } from '../src/player/experience.js';
import { ITEMS, I } from '../src/world/items.js';
import { craft } from '../src/player/crafting.js';
import { Player } from '../src/player/player.js';

const st = (id) => ({ id, count: 1, damage: 0 });

describe('armour', () => {
  it('defence points and durability per piece', () => {
    const full = (m) => [`${m}_helmet`, `${m}_chestplate`, `${m}_leggings`, `${m}_boots`].map((k) => st(I[k.toUpperCase()]));
    expect(armorTotals(full('leather')).points).toBe(7);
    expect(armorTotals(full('gold')).points).toBe(11);
    expect(armorTotals(full('iron')).points).toBe(15);
    expect(armorTotals(full('diamond'))).toEqual({ points: 20, toughness: 8 });
    expect(ITEMS[I.IRON_CHESTPLATE].durability).toBe(240);
    expect(ITEMS[I.DIAMOND_BOOTS].durability).toBe(429);
    expect(ITEMS[I.LEATHER_HELMET].durability).toBe(55);
  });

  it('damage reduction formula', () => {
    expect(armorReduce(10, 0)).toBe(10);
    // full iron (15): min(20, max(3, 15 - 40/8 = 10)) = 10 -> 60 %
    expect(armorReduce(10, 15)).toBeCloseTo(6);
    // full diamond, toughness 8: 20 - 40/16 = 17.5 -> 30 %
    expect(armorReduce(10, 20, 8)).toBeCloseTo(3);
    // never more than 80 % reduction
    expect(armorReduce(1, 30, 12)).toBeCloseTo(0.2);
  });

  it('wears max(1, damage/4) per piece and breaks', () => {
    const a = [st(I.LEATHER_HELMET), null, null, st(I.IRON_BOOTS)];
    wearArmor(a, 3);
    expect(a[0].damage).toBe(1);
    wearArmor(a, 9);
    expect(a[3].damage).toBe(3);
    a[0].damage = 54;
    expect(wearArmor(a, 1)).toEqual([0]);
    expect(a[0]).toBe(null);
  });

  it('applies to mob hits but not to falls', () => {
    const p = new Player();
    p.inventory.armor = [st(I.IRON_HELMET), st(I.IRON_CHESTPLATE), st(I.IRON_LEGGINGS), st(I.IRON_BOOTS)];
    p.hurt(10, 'mob:Shambler');
    expect(p.health).toBeCloseTo(14);
    p.invulnerable = 0;
    p.hurt(4, 'fall');
    expect(p.health).toBeCloseTo(10);
  });

  it('recipes', () => {
    const L = I.LEATHER, _ = null;
    expect(craft([L, L, L, L, _, L, _, _, _].map((x) => x && st(x)), 3)).toEqual({ id: I.LEATHER_HELMET, count: 1 });
    const D = I.DIAMOND;
    expect(craft([D, _, D, D, D, D, D, D, D].map((x) => x && st(x)), 3)).toEqual({ id: I.DIAMOND_CHESTPLATE, count: 1 });
  });
});

describe('experience', () => {
  it('level curve', () => {
    expect(xpToNextLevel(0)).toBe(7);
    expect(xpToNextLevel(15)).toBe(37);
    expect(xpToNextLevel(16)).toBe(42);
    expect(xpToNextLevel(30)).toBe(112);
    expect(xpToNextLevel(31)).toBe(121);
    // 1395 points reach level 30
    const xp = newXp();
    addXp(xp, 1395);
    expect(xp.level).toBe(30);
    expect(xp.points).toBe(0);
  });

  it('orb splitting and death drop', () => {
    expect(splitOrbs(5)).toEqual([3, 1, 1]);
    expect(splitOrbs(20)).toEqual([17, 3]);
    expect(splitOrbs(0)).toEqual([]);
    expect(deathXp(3)).toBe(21);
    expect(deathXp(30)).toBe(100);
  });
});
