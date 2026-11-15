import { describe, it, expect } from 'vitest';
import {
  VARIANTS, variantWeights, rollVariant, inheritVariant, variantPalette, variantOverlays, paintParts, legacyVariant,
  hasVariants, MUTATION_CHANCE, FLEECER_WOOL,
} from '../src/mobs/variants.js';
import { Mob } from '../src/mobs/mob.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { BIOMES } from '../src/world/biomes.js';

const TYPES = Object.keys(VARIANTS);
const HEX = /^#[0-9a-f]{6}$/i;
const BIOME_KEYS = ['', ...BIOMES.map((b) => b.key)];

const tally = (type, biome, n = 6000) => {
  const c = new Array(VARIANTS[type].length).fill(0);
  for (let id = 1; id <= n; id++) c[rollVariant(type, id, biome)]++;
  return c;
};

describe('coat variants: spawning', () => {
  it('covers the eight animals with the listed coats', () => {
    expect(TYPES.sort()).toEqual(['bristleback', 'cluckling', 'fleecer', 'galloper', 'howler', 'mooxen', 'purrling', 'vixling']);
    expect(VARIANTS.cluckling).toHaveLength(4); expect(VARIANTS.fleecer).toHaveLength(5); expect(VARIANTS.bristleback).toHaveLength(4);
    expect(VARIANTS.mooxen).toHaveLength(3); expect(VARIANTS.purrling).toHaveLength(5); expect(VARIANTS.vixling).toHaveLength(3);
    expect(VARIANTS.howler).toHaveLength(4); expect(VARIANTS.galloper).toHaveLength(5);
    expect(hasVariants('shambler')).toBe(false);
    expect(rollVariant('shambler', 5, 'plains')).toBe(0);
  });

  it('is deterministic for a mob id and biome, and varies with the id', () => {
    for (const t of TYPES) {
      const a = [], b = [];
      for (let id = 1; id < 60; id++) { a.push(rollVariant(t, id, 'plains')); b.push(rollVariant(t, id, 'plains')); }
      expect(a).toEqual(b);
      expect(new Set(a).size).toBeGreaterThan(1);
      for (const v of a) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThan(VARIANTS[t].length);
    }
  });

  it('has positive, finite weights and never a coat from nowhere', () => {
    for (const t of TYPES) for (const biome of BIOME_KEYS) {
      const w = variantWeights(t, biome);
      expect(w).toHaveLength(VARIANTS[t].length);
      expect(w.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
      expect(w.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    }
  });

  it('snow Vixlings live only in cold biomes', () => {
    const snow = VARIANTS.vixling.indexOf('snow');
    for (const biome of ['plains', 'forest', 'desert', 'jungle', 'savanna', 'swamp', 'ocean', '']) {
      expect(variantWeights('vixling', biome)[snow]).toBe(0);
      expect(tally('vixling', biome, 1500)[snow]).toBe(0);
    }
    for (const biome of ['snowy_plains', 'snowy_taiga', 'frozen_river']) {
      const c = tally('vixling', biome, 3000);
      expect(c[snow]).toBeGreaterThan(c[0]);
    }
  });

  it('golden Clucklings are 3 % wherever they hatch', () => {
    const gold = VARIANTS.cluckling.indexOf('golden');
    for (const biome of ['plains', 'swamp', 'snowy_plains', 'desert', '']) {
      expect(variantWeights('cluckling', biome)[gold] / variantWeights('cluckling', biome).reduce((a, b) => a + b, 0)).toBeCloseTo(0.03, 6);
    }
    const share = tally('cluckling', 'plains', 20000)[gold] / 20000;
    expect(share).toBeGreaterThan(0.022); expect(share).toBeLessThan(0.038);
  });

  it('biomes shift the odds (white Mooxen in the cold, tan Howlers in the desert)', () => {
    const cold = tally('mooxen', 'snowy_plains'), warm = tally('mooxen', 'plains');
    const patched = VARIANTS.mooxen.indexOf('patched');
    expect(cold[patched]).toBeGreaterThan(warm[patched] * 2);
    const tan = VARIANTS.howler.indexOf('tan');
    expect(tally('howler', 'desert')[tan]).toBeGreaterThan(tally('howler', 'snowy_taiga')[tan] * 3);
  });
});

describe('coat variants: inheritance', () => {
  it('babies take a parent coat, and about 8 % mutate to another one', () => {
    const n = 20000;
    for (const t of TYPES) {
      const k = VARIANTS[t].length;
      let mutated = 0;
      for (let id = 1; id <= n; id++) {
        const v = inheritVariant(t, 0, k - 1, id);
        expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(k);
        if (v !== 0 && v !== k - 1) mutated++;
      }
      // a mutation lands on a coat other than the chosen parent's; counting only those outside both parents' coats underestimates it
      expect(mutated / n).toBeLessThan(MUTATION_CHANCE + 0.01);
      if (k > 3) expect(mutated / n).toBeGreaterThan(0.02);
    }
    expect(MUTATION_CHANCE).toBe(0.08);
  });

  it('two parents of one coat pass it on 92 % of the time, never as the same coat after a mutation', () => {
    const n = 20000;
    let same = 0;
    for (let id = 1; id <= n; id++) if (inheritVariant('galloper', 2, 2, id) === 2) same++;
    expect(same / n).toBeGreaterThan(0.9); expect(same / n).toBeLessThan(0.94);
    expect(inheritVariant('galloper', 2, 2, 5)).toBe(inheritVariant('galloper', 2, 2, 5));
  });

  it('a bred Fleecer / Purrling carries its parents\' coats', () => {
    const a = new Mob('purrling', 0, 64, 0), b = new Mob('purrling', 0, 64, 0);
    a.setVariant(3); b.setVariant(3);
    const seen = new Set();
    for (let k = 0; k < 40; k++) { const baby = new Mob('purrling', 0, 64, 0); baby.setVariant(inheritVariant('purrling', a.variant, b.variant, baby.id)); seen.add(baby.variant); }
    expect(seen.has(3)).toBe(true);
  });
});

describe('coat variants: palettes', () => {
  it('every colour of every variant is a valid hex and names a real part', async () => {
    const { MODELS } = await import('../src/mobs/models.js');
    for (const t of TYPES) {
      const names = new Set(MODELS[t].parts.map((p) => p[0]));
      VARIANTS[t].forEach((v, i) => {
        for (const [part, col] of Object.entries(variantPalette(t, i))) {
          expect(col, `${t}/${v}/${part}`).toMatch(HEX);
          expect(names.has(part), `${t}/${v}: no part ${part}`).toBe(true);
        }
        expect(variantPalette(t, v)).toEqual(variantPalette(t, i)); // by name or by index
        for (const [host, size, off, col] of variantOverlays(t, i)) {
          expect(names.has(host), `${t}/${v}: no host ${host}`).toBe(true);
          expect(col).toMatch(HEX);
          expect(size).toHaveLength(3); expect(off).toHaveLength(3);
          expect([...size, ...off].every(Number.isFinite)).toBe(true);
        }
      });
    }
  });

  it('looks different for every variant of a type', () => {
    for (const t of TYPES) {
      const sigs = VARIANTS[t].map((_, i) => JSON.stringify([variantPalette(t, i), variantOverlays(t, i)]));
      expect(new Set(sigs).size, t).toBe(sigs.length);
    }
  });

  it('paintParts recolours only the named parts and keeps the rest', async () => {
    const { MODELS } = await import('../src/mobs/models.js');
    const parts = MODELS.cluckling.parts, painted = paintParts(parts, 'cluckling', 'golden');
    expect(painted).toHaveLength(parts.length);
    const body = painted.find((p) => p[0] === 'body'), crest = painted.find((p) => p[0] === 'crest');
    expect(body[4]).toBe(variantPalette('cluckling', 'golden').body);
    expect(crest[4]).toBe(parts.find((p) => p[0] === 'crest')[4]);
    expect(paintParts(parts, 'shambler', 0)).toEqual(parts);
  });
});

describe('coat variants: mobs, saves and snapshots', () => {
  it('every mob of these kinds has a variant from birth', () => {
    for (const t of TYPES) {
      const m = new Mob(t, 0, 64, 0);
      expect(m.variant).toBeGreaterThanOrEqual(0); expect(m.variant).toBeLessThan(VARIANTS[t].length);
    }
    expect(new Mob('shambler', 0, 64, 0).variant).toBe(0);
  });

  it('survives a save and load, and tamed ones keep it', () => {
    for (const t of TYPES) for (let v = 0; v < VARIANTS[t].length; v++) {
      const m = new Mob(t, 1, 64, 2); m.setVariant(v); m.tamed = true; m.ownerName = 'Ada';
      const data = JSON.parse(JSON.stringify(m.saveData()));
      expect(data.variant).toBe(v);
      const back = new Mob(t, 1, 64, 2); back.setVariant((v + 1) % VARIANTS[t].length); back.loadData(data);
      expect(back.variant).toBe(v);
      expect(back.tamed).toBe(true);
    }
    expect(new Mob('shambler', 0, 64, 0).saveData().variant).toBeUndefined();
  });

  it('old saves map their Purrling and Galloper coats and Fleecer dyes', () => {
    const p = new Mob('purrling', 0, 64, 0); p.loadData({ health: 6, yaw: 0, age: 0, woolColor: 2 });
    expect(p.variant).toBe(VARIANTS.purrling.indexOf('black'));
    const g = new Mob('galloper', 0, 64, 0); g.loadData({ health: 20, yaw: 0, age: 0, coat: 2 });
    expect(g.variant).toBe(VARIANTS.galloper.indexOf('black'));
    const f = new Mob('fleecer', 0, 64, 0); f.loadData({ health: 8, yaw: 0, age: 0, woolColor: 12 });
    expect(f.variant).toBe(VARIANTS.fleecer.indexOf('brown')); expect(f.woolColor).toBe(12);
    expect(legacyVariant('howler', { woolColor: 3 })).toBeUndefined();
  });

  it('Fleecers keep dyes and shearing: undyed wool is the coat, a dye replaces it', () => {
    const f = new Mob('fleecer', 0, 64, 0);
    for (let v = 0; v < VARIANTS.fleecer.length; v++) { f.setVariant(v); expect(f.woolColor).toBe(FLEECER_WOOL[v]); }
    f.setVariant(3); f.woolColor = 5; f.sheared = true;
    const back = new Mob('fleecer', 0, 64, 0); back.loadData(JSON.parse(JSON.stringify(f.saveData())));
    expect(back.woolColor).toBe(5); expect(back.sheared).toBe(true); expect(back.variant).toBe(3);
  });

  it('rides in the snapshot without a layout change', () => {
    for (const t of TYPES) {
      const m = new Mob(t, 1, 64, 2); m.setVariant(VARIANTS[t].length - 1);
      const packed = packMob(m);
      expect(packed).toHaveLength(25);
      const u = unpackMob(JSON.parse(JSON.stringify(packed)));
      expect(u.variant).toBe(VARIANTS[t].length - 1);
      expect(u.woolColor).toBe(m.woolColor & 255);
    }
    const dyed = new Mob('fleecer', 0, 64, 0); dyed.setVariant(2); dyed.woolColor = 14;
    expect(unpackMob(packMob(dyed))).toMatchObject({ woolColor: 14, variant: 2 });
  });
});
