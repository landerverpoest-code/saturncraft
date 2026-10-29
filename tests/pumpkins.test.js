import { describe, it, expect } from 'vitest';
import {
  carveFacing, isHarvestSeason, pumpkinHeadChance, addPumpkinHead, isPumpkinHead, wearsPumpkin, gazeProvokes, pumpkinStack,
  PUMPKIN_HEAD_CHANCE, HARVEST_PUMPKIN_CHANCE, CARVE_SEEDS,
} from '../src/mobs/pumpkins.js';
import { B, BLOCKS, EXT_BASE, NUM_BLOCKS } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import { RECIPES } from '../src/player/crafting.js';
import { wearArmor, armorTotals } from '../src/player/armor.js';
import { categories, enchantability } from '../src/world/enchantments.js';
import { helmetShadesSun, equipIds, equipFromIds, rollEquipment, equipFromSave } from '../src/mobs/equipment.js';
import { Mob } from '../src/mobs/mob.js';
import { packPlayerState, unpackPlayerState } from '../src/net/protocol.js';
import { rng } from './helpers.js';

const N = 30000;
const eqEmpty = () => ({ hand: null, armor: [null, null, null, null] });

describe('the Carved Pumpkin block and item', () => {
  it('is appended after every other extended block', () => {
    expect(B.CARVED_PUMPKIN).toBeGreaterThanOrEqual(EXT_BASE);
    expect(B.CARVED_PUMPKIN).toBe(Math.max(...Object.values(B).filter((v) => v >= EXT_BASE)));
    expect(BLOCKS[B.CARVED_PUMPKIN].name).toBe('Carved Pumpkin');
    expect(NUM_BLOCKS).toBe(B.CARVED_PUMPKIN + 1);
    expect(BLOCKS[B.CARVED_PUMPKIN].tex.front).toBe('pumpkin_face'); // the face turns towards the player when placed
  });
  it('is a helmet without defence, wear or enchantments', () => {
    const d = ITEMS[B.CARVED_PUMPKIN];
    expect(d.armor.slot).toBe(0);
    expect(d.armor.pumpkin).toBe(true);
    expect(d.block).toBe(B.CARVED_PUMPKIN);
    expect(armorTotals([{ id: B.CARVED_PUMPKIN, count: 1 }, null, null, null])).toEqual({ points: 0, toughness: 0 });
    expect(categories(B.CARVED_PUMPKIN)).toEqual([]);
    expect(enchantability(B.CARVED_PUMPKIN)).toBe(0);
    const worn = [{ id: B.CARVED_PUMPKIN, count: 1, damage: 0 }, null, null, null];
    expect(wearArmor(worn, 40)).toEqual([]);
    expect(worn[0]).not.toBe(null);
    expect(worn[0].damage).toBe(0);
  });
  it('lights up as a Pumpkin Lantern with a torch', () => {
    const r = RECIPES.find((x) => x.type === 'shapeless' && x.ings.includes(B.CARVED_PUMPKIN));
    expect(r.result).toBe(B.JACK_O_LANTERN);
    expect(r.ings).toContain(B.TORCH);
  });
  it('shears leave 4 seeds and turn the face towards the player', () => {
    expect(CARVE_SEEDS).toBe(4);
    expect(I.PUMPKIN_SEEDS).toBeGreaterThan(0);
    expect(carveFacing(0, -3)).toBe(0);
    expect(carveFacing(3, 0)).toBe(1);
    expect(carveFacing(0, 3)).toBe(2);
    expect(carveFacing(-3, 1)).toBe(3);
  });
});

describe('pumpkin heads on mobs', () => {
  it('a harvest week from 20 October to 1 November', () => {
    expect(isHarvestSeason(new Date(2026, 9, 20))).toBe(true);
    expect(isHarvestSeason(new Date(2026, 9, 31))).toBe(true);
    expect(isHarvestSeason(new Date(2026, 10, 1))).toBe(true);
    expect(isHarvestSeason(new Date(2026, 9, 19))).toBe(false);
    expect(isHarvestSeason(new Date(2026, 10, 2))).toBe(false);
    expect(isHarvestSeason(new Date(2026, 5, 15))).toBe(false);
    expect(pumpkinHeadChance(new Date(2026, 9, 29))).toBe(HARVEST_PUMPKIN_CHANCE);
    expect(pumpkinHeadChance(new Date(2026, 2, 1))).toBe(PUMPKIN_HEAD_CHANCE);
  });
  it('1 % of the time normally, 25 % in the harvest week', () => {
    const r = rng(11);
    let plain = 0, harvest = 0;
    for (let k = 0; k < N; k++) {
      if (addPumpkinHead(eqEmpty(), new Date(2026, 2, 1), r).armor[0]) plain++;
      if (addPumpkinHead(eqEmpty(), new Date(2026, 9, 29), r).armor[0]) harvest++;
    }
    expect(plain / N).toBeCloseTo(0.01, 2);
    expect(harvest / N).toBeCloseTo(0.25, 1);
  });
  it('never replaces a helmet, and mobs that wear nothing stay bare', () => {
    const eq = eqEmpty();
    eq.armor[0] = { id: I.IRON_HELMET, count: 1, damage: 0 };
    expect(addPumpkinHead(eq, new Date(2026, 9, 29), () => 0).armor[0].id).toBe(I.IRON_HELMET);
    expect(addPumpkinHead(null, new Date(2026, 9, 29), () => 0)).toBe(null);
  });
  it('a pumpkin head does not shade the sun', () => {
    const eq = eqEmpty();
    eq.armor[0] = pumpkinStack();
    expect(helmetShadesSun(eq, () => 0)).toBe(false);
    expect(eq.armor[0]).not.toBe(null);
    const iron = eqEmpty();
    iron.armor[0] = { id: I.IRON_HELMET, count: 1, damage: 0 };
    expect(helmetShadesSun(iron, () => 0)).toBe(true);
  });
  it('shows on guests and survives a save', () => {
    const eq = rollEquipment('shambler', 0, 'normal', () => 0.99);
    eq.armor[0] = pumpkinStack();
    const ids = equipIds(eq);
    expect(ids[1]).toBe(B.CARVED_PUMPKIN);
    expect(equipFromIds(JSON.parse(JSON.stringify(ids))).armor[0].id).toBe(B.CARVED_PUMPKIN);
    expect(equipFromSave(JSON.parse(JSON.stringify(eq))).armor[0].id).toBe(B.CARVED_PUMPKIN);
  });
});

describe('Voidwalkers and the gaze', () => {
  const player = (helmet) => ({ dead: false, x: 0, y: 64, z: 0, eyePos: () => [0, 66.5, 0], lookDir: () => [0, 0, -1], inventory: { armor: [helmet, null, null, null] } });
  function stare(p, ticks = 20) {
    const m = new Mob('voidwalker', 0, 64, -6);
    const g = { sky: { state: { sunlit: false } }, ticks: 1, audio: { play() {} } };
    m.canSee = () => true; m.wanderAI = () => {}; m.chase = () => {}; m.tryMelee = () => {};
    for (let k = 0; k < ticks; k++) m.voidwalkerAI(g, p, 6);
    return m;
  }
  it('a bare face stared at makes it angry', () => {
    const m = new Mob('voidwalker', 0, 64, -6);
    const p = player(null);
    p.eyePos = () => [0, m.eyeY, 0];
    expect(stare(p).angry).toBe(true);
  });
  it('a pumpkin on the head keeps it calm', () => {
    const m = new Mob('voidwalker', 0, 64, -6);
    const p = player(pumpkinStack());
    p.eyePos = () => [0, m.eyeY, 0];
    const v = stare(p, 60);
    expect(v.angry).toBe(false);
    expect(v.stare).toBe(0);
  });
  it('another helmet does not help', () => {
    const m = new Mob('voidwalker', 0, 64, -6);
    const p = player({ id: I.IRON_HELMET, count: 1, damage: 0 });
    p.eyePos = () => [0, m.eyeY, 0];
    expect(stare(p).angry).toBe(true);
  });
  it('the helper agrees', () => {
    expect(wearsPumpkin(player(pumpkinStack()))).toBe(true);
    expect(wearsPumpkin(player(null))).toBe(false);
    expect(wearsPumpkin(null)).toBe(false);
    expect(gazeProvokes(player(pumpkinStack()))).toBe(false);
    expect(gazeProvokes(player(null))).toBe(true);
    expect(isPumpkinHead({ id: B.JACK_O_LANTERN })).toBe(false);
  });
  it('the other players see the pumpkin through the armour ids', () => {
    const p = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, inventory: { armor: [pumpkinStack(), null, null, null] } };
    expect(unpackPlayerState(JSON.parse(JSON.stringify(packPlayerState(p, null, 0)))).armor[0]).toBe(B.CARVED_PUMPKIN);
  });
});
