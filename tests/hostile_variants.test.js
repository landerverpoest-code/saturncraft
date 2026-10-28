import { describe, it, expect } from 'vitest';
import {
  conversionStep, newConversion, CONVERT_SUBMERGED_TICKS, CONVERT_SHAKE_TICKS,
  hexThrowChoice, hexDrinkChoice, soddenSpawnChance, HEX_ATTACK_INTERVAL, HEX_ATTACK_RANGE, HEX_DRINK_TICKS,
} from '../src/mobs/hostileVariants.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import { rollDrops } from '../src/mobs/drops.js';
import { I } from '../src/world/items.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { hutsNear, hutAt } from '../src/world/swampHuts.js';
import { BIOME } from '../src/world/biomes.js';
import { B } from '../src/world/blocks.js';
import { cidx, SEA_LEVEL } from '../src/world/constants.js';
import { rng } from './helpers.js';

describe('underwater conversion', () => {
  it('converts 600 ticks submerged + 300 ticks of shaking later (on the 901st tick)', () => {
    const s = newConversion();
    let t = 0;
    while (!conversionStep(s, true)) { t++; if (t > 5000) break; }
    expect(t + 1).toBe(CONVERT_SUBMERGED_TICKS + CONVERT_SHAKE_TICKS + 1);
    expect(CONVERT_SUBMERGED_TICKS).toBe(600);
    expect(CONVERT_SHAKE_TICKS).toBe(300);
  });
  it('surfacing resets the count; once shaking it converts even out of the water', () => {
    const s = newConversion();
    for (let i = 0; i < 599; i++) expect(conversionStep(s, true)).toBe(false);
    conversionStep(s, false);
    expect(s.inWaterTime).toBe(-1);
    for (let i = 0; i < 600; i++) conversionStep(s, true); // -1 -> 599: not yet (as in the reference)
    expect(s.converting).toBe(false);
    conversionStep(s, true);
    expect(s.converting).toBe(true);
    let n = 0;
    while (!conversionStep(s, false)) n++;
    expect(n).toBe(CONVERT_SHAKE_TICKS);
  });
  it('Shamblers become Sodden, Dune Shamblers become Shamblers; the rest never convert', () => {
    expect(MOBS.shambler.convertsTo).toBe('sodden_shambler');
    expect(MOBS.dune_shambler.convertsTo).toBe('shambler');
    expect(MOBS.sodden_shambler.convertsTo).toBeUndefined();
    expect(MOBS.rattler.convertsTo).toBeUndefined();
  });
});

describe('Hexwife', () => {
  it('has the reference stats', () => {
    expect(MOBS.hexwife).toMatchObject({ health: 26, speed: 0.25, width: 0.6, height: 1.95, role: 'witch' });
    expect(HEX_ATTACK_INTERVAL).toBe(60);
    expect(HEX_ATTACK_RANGE).toBe(10);
    expect(HEX_DRINK_TICKS).toBe(32);
  });
  it('throws Slowness at range, Poison at healthy targets, Weakness up close, else Harming', () => {
    const never = () => 0.99, always = () => 0;
    expect(hexThrowChoice({ dist: 9, health: 20, effects: {} }, never)).toBe('slowness');
    expect(hexThrowChoice({ dist: 9, health: 20, effects: { slowness: {} } }, never)).toBe('poison');
    expect(hexThrowChoice({ dist: 5, health: 20, effects: {} }, never)).toBe('poison');
    expect(hexThrowChoice({ dist: 5, health: 7, effects: {} }, never)).toBe('harming');
    expect(hexThrowChoice({ dist: 2, health: 7, effects: {} }, always)).toBe('weakness');
    expect(hexThrowChoice({ dist: 2, health: 7, effects: {} }, never)).toBe('harming');
    expect(hexThrowChoice({ dist: 2, health: 7, effects: { weakness: {} } }, always)).toBe('harming');
    expect(hexThrowChoice({ dist: 2, health: 20, effects: { poison: {} } }, always)).toBe('weakness');
  });
  it('drinks Water Breathing, Fire Resistance, Healing or Swiftness with the reference odds', () => {
    const base = { eyeInWater: false, burning: false, health: 26, maxHealth: 26, effects: {}, targetDistSq: null };
    const r = rng(5), N = 200000;
    const count = (ctx) => { let n = 0; for (let i = 0; i < N; i++) if (hexDrinkChoice(ctx, r)) n++; return n / N; };
    expect(count(base)).toBe(0);
    expect(count({ ...base, eyeInWater: true })).toBeCloseTo(0.15, 2);
    expect(count({ ...base, eyeInWater: true, effects: { water_breathing: {} } })).toBe(0);
    expect(count({ ...base, burning: true })).toBeCloseTo(0.15, 2);
    expect(count({ ...base, health: 10 })).toBeCloseTo(0.05, 2);
    expect(count({ ...base, targetDistSq: 144 })).toBeCloseTo(0.5, 2);
    expect(count({ ...base, targetDistSq: 100 })).toBe(0);
    expect(hexDrinkChoice({ ...base, eyeInWater: true }, () => 0)).toBe('water_breathing');
    expect(hexDrinkChoice({ ...base, burning: true }, () => 0)).toBe('fire_resistance');
    expect(hexDrinkChoice({ ...base, health: 3 }, () => 0)).toBe('healing');
    expect(hexDrinkChoice({ ...base, targetDistSq: 200 }, () => 0)).toBe('swiftness');
  });
  it('takes 15 % of magic damage and none from her own elixirs', () => {
    const m = { type: 'hexwife' }, other = {};
    expect(MOBS.hexwife.onHurt(m, 6, 'magic', other)).toBeCloseTo(0.9, 9);
    expect(MOBS.hexwife.onHurt(m, 6, 'magic', m)).toBe(0);
    expect(MOBS.hexwife.onHurt(m, 6, 'arrow', other)).toBe(6);
  });
  it('drops 1-3 rolls of 0-2 brewing odds and ends (sticks twice as likely)', () => {
    const r = rng(11), N = 40000;
    const allowed = new Set([I.GLASS_VIAL, I.GLOWSHARD_DUST, I.GUNPOWDER, I.CINNABAR, I.SPIDER_EYE, I.SUGAR, I.STICK]);
    const tally = {};
    let total = 0, max = 0;
    for (let i = 0; i < N; i++) {
      let n = 0;
      for (const d of rollDrops('hexwife', { killedByPlayer: true }, r)) {
        expect(allowed.has(d.id)).toBe(true);
        tally[d.id] = (tally[d.id] || 0) + d.count; n += d.count;
      }
      total += n; max = Math.max(max, n);
    }
    // E = E[rolls] (2) x E[count] (1) = 2 items per kill; at most 3 x 2
    expect(total / N).toBeCloseTo(2, 1);
    expect(max).toBeLessThanOrEqual(6);
    expect(tally[I.STICK] / tally[I.SUGAR]).toBeCloseTo(2, 0);
    expect(tally[I.GLASS_VIAL] / (total / 8)).toBeCloseTo(1, 0);
  });
});

describe('Shambler and Rattler variants', () => {
  it('Dune Shamblers do not burn, cause Hunger, need open sky', () => {
    const d = MOBS.dune_shambler;
    expect(d.burnsInSun).toBeFalsy();
    expect(d.undead).toBe(true);
    expect(d.hitEffect).toEqual(['hunger', 280, 0]);
    expect(d.needsSky).toBe(true);
    expect(d).toMatchObject({ health: 20, attack: 3, armor: 2, role: 'husk' });
  });
  it('Rime Rattlers burn and shoot 30 s Slowness arrows', () => {
    const d = MOBS.rime_rattler;
    expect(d.burnsInSun).toBe(true);
    expect(d.arrowEffect).toEqual(['slowness', 600, 0]);
    expect(d.needsSky).toBe(true);
    expect(d.drops.slice(0, MOBS.rattler.drops.length)).toEqual(MOBS.rattler.drops); // plus the tipped arrows (see companions_babies.test.js)
  });
  it('Sodden Shamblers burn, sink, and drop copper 11 % (+2 % per Plunder level) on player kills', () => {
    const d = MOBS.sodden_shambler;
    expect(d.burnsInSun).toBe(true);
    expect(d.sinks).toBe(true);
    const r = rng(3), N = 100000;
    let copper = 0, copper3 = 0, flesh = 0;
    for (let i = 0; i < N; i++) {
      for (const x of rollDrops('sodden_shambler', { killedByPlayer: true }, r)) { if (x.id === I.COPPER_INGOT) copper++; if (x.id === I.ROTTEN_FLESH) flesh += x.count; }
      for (const x of rollDrops('sodden_shambler', { killedByPlayer: true, plunder: 3 }, r)) if (x.id === I.COPPER_INGOT) copper3++;
    }
    expect(copper / N).toBeCloseTo(0.11, 2);
    expect(copper3 / N).toBeCloseTo(0.17, 2);
    expect(flesh / N).toBeCloseTo(1, 1);
    for (let i = 0; i < 2000; i++) expect(rollDrops('sodden_shambler', { killedByPlayer: false }, r).some((x) => x.id === I.COPPER_INGOT)).toBe(false);
  });
  it('drowned spawn rule: deep ocean water 1 in 40, rivers 1 in 15', () => {
    const r = rng(9), N = 120000;
    let ocean = 0, river = 0;
    for (let i = 0; i < N; i++) { if (soddenSpawnChance('ocean', SEA_LEVEL - 10, SEA_LEVEL, r)) ocean++; if (soddenSpawnChance('river', SEA_LEVEL - 1, SEA_LEVEL, r)) river++; }
    expect(ocean / N).toBeCloseTo(1 / 40, 2);
    expect(river / N).toBeCloseTo(1 / 15, 2);
    for (let i = 0; i < 2000; i++) expect(soddenSpawnChance('ocean', SEA_LEVEL - 5, SEA_LEVEL, r)).toBe(false);
  });
  it('5 % of Shambler-kin spawn as babies; skeletons, witches and illagers never (spiderlings, Fizzlets and cubs: see companions_babies.test.js)', () => {
    for (const k of ['shambler', 'dune_shambler', 'sodden_shambler']) { expect(MOBS[k].babyChance).toBe(0.05); expect(MOBS[k].shamblerKin).toBe(true); }
    for (const k of ['rattler', 'rime_rattler', 'hexwife', 'marauder', 'voidwalker']) expect(MOBS[k].babyChance).toBeUndefined();
  });
});

describe('multiplayer sync of the new mobs', () => {
  it('mob snapshots carry the type, the baby flag and the drinking / converting flag', async () => {
    const { packMob, unpackMob } = await import('../src/net/protocol.js');
    const m = { id: 5, type: 'hexwife', x: 1, y: 2, z: 3, yaw: 0, health: 26, age: -24000, special: true, body: { onGround: true } };
    const s = unpackMob(packMob(m));
    expect(s).toMatchObject({ type: 'hexwife', baby: true, special: true, onGround: true });
    expect(unpackMob(packMob({ ...m, special: false, age: 0 }))).toMatchObject({ baby: false, special: false });
  });
});

describe('swamp huts', () => {
  const gen = new TerrainGenerator(7);
  const huts = hutsNear(gen, -2500, -2500, 2500, 2500);
  it('appear in swamps every few regions', () => {
    expect(huts.length).toBeGreaterThan(5);
    for (const h of huts) {
      const col = gen.column(h.cx, h.cz);
      expect(gen.biomeFor(col, gen.surfaceAt(h.cx, h.cz, col))).toBe(BIOME.SWAMP);
      expect(h.y).toBeGreaterThan(SEA_LEVEL + 2);
      expect(hutAt(gen, h.cx, h.y, h.cz)).toEqual(h);
      expect(hutAt(gen, h.cx, h.y + 20, h.cz)).toBe(null);
    }
  });
  it('stand on stilts: a spruce floor with room to stand and a roof', () => {
    const h = huts[0];
    const c = gen.generate(Math.floor(h.cx / 16), Math.floor(h.cz / 16));
    const at = (x, y, z) => c.blocks[cidx(((x % 16) + 16) % 16, y, ((z % 16) + 16) % 16)];
    expect(at(h.cx, h.y - 1, h.cz)).toBe(B.SPRUCE_PLANKS);
    expect(at(h.cx, h.y, h.cz + 1)).toBe(B.AIR);
    expect(at(h.cx, h.y + 1, h.cz + 1)).toBe(B.AIR);
    expect(at(h.cx, h.y + 3, h.cz + 1)).toBe(B.SPRUCE_PLANKS);
  });
});
