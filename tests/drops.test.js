import { describe, it, expect } from 'vitest';
import { rollDrops, expectedCount } from '../src/mobs/drops.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import { I } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';
import { blockDrops } from '../src/world/mining.js';
import { rng } from './helpers.js';

function stats(type, ctx, id, N = 60000, seed = 9) {
  const r = rng(seed);
  const hist = new Map();
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const d = rollDrops(type, ctx, r).find((x) => x.id === id);
    const n = d ? d.count : 0;
    sum += n;
    hist.set(n, (hist.get(n) || 0) + 1);
  }
  return { mean: sum / N, min: Math.min(...hist.keys()), max: Math.max(...hist.keys()), p: (k) => (hist.get(k) || 0) / N };
}

describe('mob drop tables', () => {
  it('fizzler: blast powder 0-2, uniform', () => {
    const s = stats('fizzler', {}, I.GUNPOWDER);
    expect([s.min, s.max]).toEqual([0, 2]);
    expect(s.mean).toBeCloseTo(1, 1);
    for (const k of [0, 1, 2]) expect(s.p(k)).toBeCloseTo(1 / 3, 1);
  });
  it('rattler: bones 0-2 and arrows 0-2', () => {
    for (const id of [I.BONE, I.ARROW]) {
      const s = stats('rattler', {}, id);
      expect([s.min, s.max]).toEqual([0, 2]);
      expect(s.mean).toBeCloseTo(1, 1);
    }
  });
  it('shambler: rotten flesh 0-2; rare ingot only for player kills', () => {
    const s = stats('shambler', {}, I.ROTTEN_FLESH);
    expect([s.min, s.max]).toEqual([0, 2]);
    expect(stats('shambler', {}, I.IRON_INGOT).max).toBe(0);
    const rare = stats('shambler', { killedByPlayer: true }, I.IRON_INGOT, 300000);
    expect(rare.mean).toBeCloseTo(0.025 / 3, 3);
  });
  it('skitterer: string 0-2, eye with 1/3 chance only when killed by the player', () => {
    expect(stats('skitterer', {}, I.STRING).mean).toBeCloseTo(1, 1);
    expect(stats('skitterer', {}, I.SPIDER_EYE).max).toBe(0);
    const eye = stats('skitterer', { killedByPlayer: true }, I.SPIDER_EYE);
    expect(eye.max).toBe(1);
    expect(eye.mean).toBeCloseTo(1 / 3, 1);
  });
  it('voidwalker: pearl 0-1', () => {
    const s = stats('voidwalker', {}, I.VOID_PEARL);
    expect([s.min, s.max]).toEqual([0, 1]);
    expect(s.mean).toBeCloseTo(0.5, 1);
  });
  it('animals: meat ranges and cooked meat when burning', () => {
    expect(stats('bristleback', {}, I.RAW_PORK)).toMatchObject({ min: 1, max: 3 });
    expect(stats('mooxen', {}, I.RAW_BEEF)).toMatchObject({ min: 1, max: 3 });
    expect(stats('mooxen', {}, I.LEATHER)).toMatchObject({ min: 0, max: 2 });
    expect(stats('fleecer', {}, I.RAW_MUTTON)).toMatchObject({ min: 1, max: 2 });
    expect(stats('fleecer', {}, B.WOOL)).toMatchObject({ min: 1, max: 1 });
    expect(stats('cluckling', {}, I.FEATHER)).toMatchObject({ min: 0, max: 2 });
    expect(stats('cluckling', {}, I.RAW_CHICKEN)).toMatchObject({ min: 1, max: 1 });
    expect(stats('bristleback', { onFire: true }, I.COOKED_PORK).mean).toBeCloseTo(2, 1);
    expect(stats('bristleback', { onFire: true }, I.RAW_PORK).max).toBe(0);
  });
  it('expectedCount helper', () => {
    expect(expectedCount(0, 2)).toBe(1);
    expect(expectedCount(-1, 1)).toBeCloseTo(1 / 3, 9);
  });
  it('mob health values', () => {
    expect(MOBS.shambler.health).toBe(20);
    expect(MOBS.voidwalker.health).toBe(40);
    expect(MOBS.skitterer.health).toBe(16);
    expect(MOBS.cluckling.health).toBe(4);
    expect(MOBS.fleecer.health).toBe(8);
    expect(MOBS.bristleback.health).toBe(10);
  });
});

describe('block drops', () => {
  const pick = (tier) => ({ type: 'pickaxe', tier, speed: 2 });
  it('ores need the right tier', () => {
    expect(blockDrops(B.IRON_ORE, pick(0))).toEqual([]);
    expect(blockDrops(B.IRON_ORE, pick(1))).toEqual([{ id: I.RAW_IRON, count: 1 }]);
    expect(blockDrops(B.DIAMOND_ORE, pick(1))).toEqual([]);
    expect(blockDrops(B.DIAMOND_ORE, pick(2))).toEqual([{ id: I.DIAMOND, count: 1 }]);
    expect(blockDrops(B.STONE)).toEqual([]);
    expect(blockDrops(B.STONE, pick(0))).toEqual([{ id: B.COBBLESTONE, count: 1 }]);
    expect(blockDrops(B.DIRT)).toEqual([{ id: B.DIRT, count: 1 }]);
  });
  it('variable ore counts', () => {
    const r = rng(5);
    const range = (id, tier) => { let lo = 99, hi = 0; for (let i = 0; i < 5000; i++) { const c = blockDrops(id, pick(tier), r)[0].count; lo = Math.min(lo, c); hi = Math.max(hi, c); } return [lo, hi]; };
    expect(range(B.COPPER_ORE, 1)).toEqual([2, 5]);
    expect(range(B.AZURITE_ORE, 1)).toEqual([4, 9]);
    expect(range(B.CINNABAR_ORE, 2)).toEqual([4, 5]);
  });
  it('gravel drops flint 10% of the time', () => {
    const r = rng(11); let f = 0; const N = 100000;
    for (let i = 0; i < N; i++) if (blockDrops(B.GRAVEL, undefined, r)[0].id === I.FLINT) f++;
    expect(f / N).toBeCloseTo(0.1, 2);
  });
});
