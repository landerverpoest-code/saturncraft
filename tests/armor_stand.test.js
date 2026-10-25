import { describe, it, expect } from 'vitest';
import { ArmorStand, standYaw, slotAt, useStand, hitStand, standDrops, standSaveData, standFromSave, standAt, BREAK_WINDOW } from '../src/entities/armorStand.js';
import { packEntity, unpackEntity } from '../src/net/protocol.js';
import { craft } from '../src/player/crafting.js';
import { B } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import { MockWorld } from './helpers.js';
import { ENCH_KEYS } from '../src/world/enchantments.js';

const one = (id) => ({ id, count: 1, damage: 0 });
const norm = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

describe('armor stand placement', () => {
  it('faces back at the player, snapped to 45 degrees', () => {
    expect(standYaw(0)).toBeCloseTo(Math.PI);
    expect(standYaw(Math.PI)).toBeCloseTo(0);
    expect(standYaw(0.5)).toBeCloseTo(Math.PI + Math.PI / 4);
    expect(standYaw(0.1)).toBeCloseTo(Math.PI);
    expect(standYaw(-Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    for (let a = -10; a < 10; a += 0.37) {
      const y = standYaw(a);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(Math.PI * 2);
      expect(Number.isInteger(Math.round(y / (Math.PI / 4) * 1e6) / 1e6)).toBe(true);
      // the stand's front (-sin, -cos) points against the player's view within 22.5 degrees
      let d = Math.abs(norm(y - a - Math.PI)); d = Math.min(d, Math.PI * 2 - d);
      expect(d).toBeLessThanOrEqual(Math.PI / 8 + 1e-9);
    }
  });
  it('knows which cells have a stand', () => {
    const s = new ArmorStand(3.5, 65, -2.5, 0);
    expect(standAt([s], 3, 65, -3)).toBe(true);
    expect(standAt([s], 3, 66, -3)).toBe(false);
    expect(standAt([s], 4, 65, -3)).toBe(false);
  });
  it('stands on the ground and falls when it goes', () => {
    const w = new MockWorld(64), s = new ArmorStand(0.5, 64, 0.5, 0);
    for (let i = 0; i < 5; i++) s.tick({ world: w });
    expect(s.y).toBeCloseTo(64);
    w.set(0, 63, 0, B.AIR); w.set(0, 62, 0, B.AIR);
    for (let i = 0; i < 40; i++) s.tick({ world: w });
    expect(s.y).toBeCloseTo(62);
  });
  it('is crafted from six sticks and a stone slab or smooth stone', () => {
    const S = I.STICK;
    for (const base of [B.SMOOTH_STONE_SLAB, B.STONE_SLAB, B.SMOOTH_STONE]) {
      expect(craft([S, S, S, null, S, null, S, one(base).id, S].map((id) => (id == null ? null : one(id))), 3)).toEqual({ id: I.ARMOR_STAND, count: 1 });
    }
    expect(craft([S, S, S, null, S, null, S, B.DIRT, S].map((id) => (id == null ? null : one(id))), 3)).toBeNull();
    expect(ITEMS[I.ARMOR_STAND].armorStand).toBe(true);
  });
});

describe('armor stand equipment', () => {
  it('maps click heights to armour slots', () => {
    expect(slotAt(1.8)).toBe(0);
    expect(slotAt(1.3)).toBe(1);
    expect(slotAt(0.7)).toBe(2);
    expect(slotAt(0.1)).toBe(3);
  });
  it('puts armour on its slot and swaps with what was there', () => {
    const s = new ArmorStand(0, 0, 0);
    let r = useStand(s, one(I.IRON_HELMET), 0.2); // the slot comes from the piece, not the click
    expect(r).toEqual({ ok: true, give: null });
    expect(s.armor[0].id).toBe(I.IRON_HELMET);
    r = useStand(s, { id: I.DIAMOND_HELMET, count: 1, damage: 12 }, 1.8);
    expect(r.give.id).toBe(I.IRON_HELMET);
    expect(s.armor[0]).toMatchObject({ id: I.DIAMOND_HELMET, damage: 12 });
    useStand(s, one(I.IRON_BOOTS), 1);
    expect(s.armor[3].id).toBe(I.IRON_BOOTS);
  });
  it('holds other items in its hand', () => {
    const s = new ArmorStand(0, 0, 0);
    expect(useStand(s, one(I.DIAMOND_SWORD), 1.2).give).toBeNull();
    expect(s.hand.id).toBe(I.DIAMOND_SWORD);
    expect(useStand(s, { id: B.TORCH, count: 5 }, 1.2).give.id).toBe(I.DIAMOND_SWORD);
    expect(s.hand).toMatchObject({ id: B.TORCH, count: 5 });
  });
  it('empty-handed takes off the clicked piece, the held item from the chest height', () => {
    const s = new ArmorStand(0, 0, 0);
    useStand(s, one(I.IRON_HELMET), 0); useStand(s, one(I.IRON_LEGGINGS), 0); useStand(s, one(I.STICK), 0);
    expect(useStand(s, null, 0.1)).toEqual({ ok: false, give: null }); // no boots
    expect(useStand(s, null, 0.7).give.id).toBe(I.IRON_LEGGINGS);
    expect(s.armor[2]).toBeNull();
    expect(useStand(s, null, 1.3).give.id).toBe(I.STICK); // no chestplate: the hand
    expect(useStand(s, null, 1.8).give.id).toBe(I.IRON_HELMET);
    expect(s.armor.every((a) => a === null) && s.hand === null).toBe(true);
  });
});

describe('breaking an armor stand', () => {
  it('needs two quick hits, or one in creative', () => {
    const s = new ArmorStand(0, 0, 0);
    expect(hitStand(s, 100)).toBe('wobble');
    expect(s.hitTime).toBeGreaterThan(0);
    expect(hitStand(s, 100 + BREAK_WINDOW + 1)).toBe('wobble'); // too slow
    expect(s.dead).toBe(false);
    expect(hitStand(s, 100 + BREAK_WINDOW + 3)).toBe('break');
    expect(s.dead).toBe(true);
    expect(hitStand(new ArmorStand(0, 0, 0), 5, true)).toBe('break');
  });
  it('drops itself, its armour and its held item', () => {
    const s = new ArmorStand(0, 0, 0);
    useStand(s, one(I.IRON_CHESTPLATE), 0); useStand(s, { id: B.TORCH, count: 3 }, 0);
    expect(standDrops(s).map((d) => [d.id, d.count])).toEqual([[I.ARMOR_STAND, 1], [I.IRON_CHESTPLATE, 1], [B.TORCH, 3]]);
    expect(standDrops(s, true).map((d) => d.id)).toEqual([I.IRON_CHESTPLATE, B.TORCH]);
  });
});

describe('armor stand persistence and sync', () => {
  it('survives a save round trip (through JSON)', () => {
    const s = new ArmorStand(10.5, 70, -4.5, standYaw(1));
    useStand(s, { id: I.DIAMOND_HELMET, count: 1, damage: 40, ench: { [ENCH_KEYS[0]]: 2 } }, 0);
    useStand(s, one(I.GOLD_BOOTS), 0);
    useStand(s, one(I.BOW), 0);
    const back = standFromSave(JSON.parse(JSON.stringify(standSaveData(s))));
    expect([back.x, back.y, back.z, back.yaw]).toEqual([s.x, s.y, s.z, s.yaw]);
    expect(back.armor).toEqual(s.armor);
    expect(back.armor[0].ench).toEqual({ [ENCH_KEYS[0]]: 2 });
    expect(back.hand).toEqual(s.hand);
    expect(back.kind).toBe('stand');
    expect(back.id).not.toBe(s.id);
  });
  it('drops broken save entries', () => {
    expect(standFromSave({ x: NaN, y: 0, z: 0 })).toBeNull();
    const s = standFromSave({ x: 0, y: 0, z: 0, armor: [one(I.IRON_BOOTS), { id: 99999, count: 1 }, null], hand: { id: I.STICK, count: 0 } });
    expect(s.armor).toEqual([null, null, null, null]); // boots are not a helmet
    expect(s.hand).toBeNull();
  });
  it('packs for multiplayer snapshots', () => {
    const s = new ArmorStand(1.234, 64, 2, Math.PI / 4);
    useStand(s, one(I.IRON_HELMET), 0); useStand(s, one(I.STICK), 0);
    s.hitTime = 7;
    const u = unpackEntity(JSON.parse(JSON.stringify(packEntity(s))));
    expect(u).toMatchObject({ kind: 'stand', id: s.id, x: 1.23, y: 64, z: 2, hitTime: 7, hand: I.STICK });
    expect(u.yaw).toBeCloseTo(Math.PI / 4, 2);
    expect(u.armor).toEqual([I.IRON_HELMET, null, null, null]);
  });
});
