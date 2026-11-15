// Slagsteel gear set: sword, axe, shovel, hoe, four armour pieces, the fire ward and the Ember-forged anvil upgrade.
import { describe, it, expect } from 'vitest';
import { I, ITEMS, ARMOR_MATERIALS } from '../src/world/items.js';
import { RECIPES, craft } from '../src/player/crafting.js';
import { gearTotals } from '../src/player/gear.js';
import { fireWard, FIRE_WARD_PER_PIECE, forgeCombine, canForge, forgedDamage, forgedSpeed, forgedIgnite, forgedLines } from '../src/player/slagsteelGear.js';
import { anvilCombine, withExtras, meleeBonus, repairMaterial, enchantability, categories } from '../src/world/enchantments.js';
import { copyStack, sameStack, packEntity, unpackEntity } from '../src/net/protocol.js';
import { tooltipHTML } from '../src/ui/icons.js';
import { ruleGear } from '../src/ui/nameRules.js';

const st = (id, extra = {}) => ({ id, count: 1, damage: 0, ...extra });
const TYPES = ['sword', 'axe', 'shovel', 'hoe'];

describe('Slagsteel tools', () => {
  it('sit between iron and diamond', () => {
    for (const t of [...TYPES, 'pickaxe']) {
      const s = ITEMS[I[`SLAGSTEEL_${t.toUpperCase()}`]], i = ITEMS[I[`IRON_${t.toUpperCase()}`]], d = ITEMS[I[`DIAMOND_${t.toUpperCase()}`]];
      expect(s.durability, t).toBeGreaterThan(i.durability);
      expect(s.durability, t).toBeLessThan(d.durability);
      expect(s.tool.damage, t).toBeGreaterThanOrEqual(i.tool.damage);
      expect(s.tool.damage, t).toBeLessThanOrEqual(d.tool.damage);
      if (t !== 'sword' && t !== 'hoe') expect(s.tool.speed, t).toBeGreaterThan(i.tool.speed);
    }
    expect(ITEMS[I.SLAGSTEEL_SWORD].tool.damage).toBeGreaterThan(ITEMS[I.IRON_SWORD].tool.damage);
    expect(ITEMS[I.SLAGSTEEL_SWORD].durability).toBe(480);
  });
  it('mend with ingots and take enchantments', () => {
    for (const t of TYPES) {
      expect(repairMaterial(I[`SLAGSTEEL_${t.toUpperCase()}`])).toBe(I.SLAGSTEEL_INGOT);
      expect(enchantability(I[`SLAGSTEEL_${t.toUpperCase()}`])).toBeGreaterThan(0);
    }
    expect(categories(I.SLAGSTEEL_SWORD)).toContain('sword');
  });
  it('have crafting recipes from Slagsteel Ingots', () => {
    for (const t of [...TYPES, 'boots']) expect(RECIPES.some((r) => r.result === I[`SLAGSTEEL_${t.toUpperCase()}`]), t).toBe(true);
    const X = st(I.SLAGSTEEL_INGOT, { count: 8 }), S = st(I.STICK, { count: 4 });
    const r = craft([X, null, null, X, null, null, S, null, null], 3);
    expect(r && r.id).toBe(I.SLAGSTEEL_SWORD);
  });
  it('names translate with the gear rules', () => {
    expect(ruleGear('Slagsteel Sword')).toBe('Slagstalen zwaard');
    expect(ruleGear('Slagsteel Boots')).toBe('Slagstalen laarzen');
    expect(ruleGear('Slagsteel Hoe')).toBe('Slagstalen schoffel');
  });
});

describe('Slagsteel armour and its fire ward', () => {
  const four = () => ['HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS'].map((p) => st(I['SLAGSTEEL_' + p]));
  it('defends 2/6/5/2, a little tougher than iron', () => {
    expect(four().map((s) => ITEMS[s.id].armor.defense)).toEqual([2, 6, 5, 2]);
    expect(four().map((s) => ITEMS[s.id].armor.slot)).toEqual([0, 1, 2, 3]);
    expect(ARMOR_MATERIALS.slagsteel.durability).toBeGreaterThan(ARMOR_MATERIALS.iron.durability);
    expect(ARMOR_MATERIALS.slagsteel.toughness).toBeGreaterThan(ARMOR_MATERIALS.iron.toughness);
    expect(ARMOR_MATERIALS.slagsteel.toughness).toBeLessThan(ARMOR_MATERIALS.diamond.toughness);
    expect(ARMOR_MATERIALS.slagsteel.accent).toBeTruthy();
  });
  it('wards 15% a piece, 60% in all', () => {
    expect(FIRE_WARD_PER_PIECE).toBe(0.15);
    expect(fireWard([])).toBe(0);
    for (let n = 1; n <= 4; n++) expect(fireWard(four().slice(0, n))).toBeCloseTo(0.15 * n);
    expect(gearTotals(four(), []).fireResist).toBeCloseTo(0.6);
    expect(fireWard([st(I.IRON_HELMET), null, st(I.SLAGSTEEL_HELMET)])).toBeCloseTo(0.15);
  });
  it('has a recipe for the boots', () => {
    const X = st(I.SLAGSTEEL_INGOT, { count: 8 });
    const r = craft([X, null, X, X, null, X, null, null, null], 3);
    expect(r && r.id).toBe(I.SLAGSTEEL_BOOTS);
  });
});

describe('Ember-forged upgrade', () => {
  it('the anvil forges a Slagsteel tool with an Ember Rod, once', () => {
    const r = anvilCombine(st(I.SLAGSTEEL_SWORD), st(I.EMBER_ROD));
    expect(r.result.forged).toBe(true);
    expect(r.cost).toBeGreaterThan(0);
    expect(r.use).toBe(1);
    expect(anvilCombine(r.result, st(I.EMBER_ROD))).toBeNull();
    expect(anvilCombine(st(I.IRON_SWORD), st(I.EMBER_ROD))).toBeNull();
    expect(canForge(st(I.SLAGSTEEL_PICKAXE))).toBe(true);
    expect(forgeCombine(st(I.SLAGSTEEL_HOE), st(I.STICK))).toBeNull();
  });
  it('adds damage, ignite or speed by tool kind', () => {
    const f = (id) => st(id, { forged: true });
    expect(forgedDamage(f(I.SLAGSTEEL_SWORD))).toBe(1);
    expect(meleeBonus(f(I.SLAGSTEEL_AXE), null)).toBe(1);
    expect(meleeBonus(st(I.SLAGSTEEL_AXE), null)).toBe(0);
    expect(forgedIgnite(f(I.SLAGSTEEL_SWORD))).toBeGreaterThan(0);
    expect(forgedIgnite(f(I.SLAGSTEEL_AXE))).toBe(0);
    expect(forgedSpeed(f(I.SLAGSTEEL_PICKAXE))).toBe(1);
    expect(forgedSpeed(f(I.SLAGSTEEL_SWORD))).toBe(0);
    expect(forgedSpeed(f(I.IRON_PICKAXE))).toBe(0); // only Slagsteel tools take it
    expect(forgedLines(f(I.SLAGSTEEL_SWORD))[0]).toContain('Ember-forged');
  });
  it('is kept by stack copies, the network, saves and the tooltip', () => {
    const a = st(I.SLAGSTEEL_SHOVEL, { forged: true, damage: 3 });
    const c = copyStack(a);
    expect(c.forged).toBe(true);
    expect(sameStack(a, c)).toBe(true);
    expect(sameStack(a, st(I.SLAGSTEEL_SHOVEL, { damage: 3 }))).toBe(false);
    expect(withExtras({ id: 1, count: 1, damage: 0 }, { forged: 'yes' }).forged).toBeUndefined(); // untrusted junk is dropped
    expect(JSON.parse(JSON.stringify(a)).forged).toBe(true); // saves store the stack as is
    expect(tooltipHTML(a)).toContain('Ember-forged');
    expect(tooltipHTML(st(I.SLAGSTEEL_SHOVEL))).not.toContain('Ember-forged');
  });
  it('rides an item entity over the wire', () => {
    const e = { kind: 'item', id: 7, x: 1, y: 2, z: 3, pickupDelay: 0, stack: st(I.SLAGSTEEL_SWORD, { forged: true }) };
    const back = unpackEntity(JSON.parse(JSON.stringify(packEntity(e))));
    expect(back.stack.forged).toBe(true);
  });
});
