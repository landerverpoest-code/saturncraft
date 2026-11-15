// Wanderer's Broth (world/wandererBroth.js).
import { describe, it, expect } from 'vitest';
import { B } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import { craft } from '../src/player/crafting.js';
import { EFFECTS } from '../src/player/effects.js';
import { Player } from '../src/player/player.js';
import { playerSaveData } from '../src/world/save.js';
import { withExtras, canStack } from '../src/world/enchantments.js';
import { sameStack } from '../src/net/protocol.js';
import { tooltipHTML, setLearnedBroths } from '../src/ui/icons.js';
import { MILESTONES } from '../src/player/milestones.js';
import { BROTHS, BROTH_KEYS, cleanBroth, cleanBroths, brothLine, eatBroth, TASTE_GOAL } from '../src/world/wandererBroth.js';

const grid = (...cells) => { const g = new Array(9).fill(null); cells.forEach((c, i) => { g[i] = c ? { id: c, count: 1 } : null; }); return g; };

describe("Wanderer's Broth", () => {
  it('is a bowl food: 6 hunger, edible when full, leaves its bowl', () => {
    const f = ITEMS[I.WANDERERS_BROTH].food;
    expect(f.hunger).toBe(6);
    expect(f.always).toBe(true);
    expect(f.leaves).toBe('bowl');
    expect(f.saturation).toBeLessThanOrEqual(2.4 * f.hunger);
    expect(ITEMS[I.WANDERERS_BROTH].stack).toBe(1);
  });
  it('has an effect table of real effects lasting 6-12 s, one per flower', () => {
    expect(BROTH_KEYS.length).toBeGreaterThanOrEqual(8);
    const blocks = new Set();
    for (const k of BROTH_KEYS) {
      const b = BROTHS[k];
      expect(EFFECTS[b.effect]).toBeTruthy();
      expect(b.ticks).toBeGreaterThanOrEqual(120);
      expect(b.ticks).toBeLessThanOrEqual(240);
      expect(B[b.block]).toBeGreaterThan(0);
      blocks.add(b.block);
    }
    expect(blocks.size).toBe(BROTH_KEYS.length);
    expect(BROTHS.flowering_azalea.effect).toBe('night_vision');
  });
  it('is crafted from a bowl, a flower and a mushroom, the flower choosing the blend', () => {
    const r = craft(grid(I.BOWL, B.REDBLOOM, B.BROWN_MUSHROOM), 3);
    expect(r.id).toBe(I.WANDERERS_BROTH);
    expect(r.broth).toBe('redbloom');
    expect(craft(grid(null, B.SKYBELL, I.BOWL, B.RED_MUSHROOM), 2).broth).toBe('skybell');
    expect(craft(grid(I.BOWL, B.REDBLOOM), 3)).toBeFalsy();
    expect(craft(grid(I.BOWL, B.REDBLOOM, B.SKYBELL), 3) || {}).not.toHaveProperty('broth');
    // the old mushroom stew is untouched
    expect(craft(grid(I.BOWL, B.RED_MUSHROOM, B.BROWN_MUSHROOM), 3).id).toBe(I.MUSHROOM_STEW);
  });
  it('shows the effect only after the blend has been tasted', () => {
    const st = { id: I.WANDERERS_BROTH, count: 1, damage: 0, broth: 'rosette' };
    expect(brothLine(st, [])).toBe('Unknown blend');
    expect(brothLine(st, ['rosette'])).toContain('Regeneration');
    setLearnedBroths(() => []);
    expect(tooltipHTML(st)).toContain('Unknown blend');
    expect(tooltipHTML(st)).not.toContain('Regeneration');
    setLearnedBroths(() => ['rosette']);
    expect(tooltipHTML(st)).toContain('Regeneration');
    setLearnedBroths(() => []);
  });
  it('gives the effect, learns the blend once, and counts toward Taste Tester', () => {
    const p = new Player();
    const eat = (k) => eatBroth(p, { id: I.WANDERERS_BROTH, count: 1, broth: k });
    const r = eat('sunpetal');
    expect(r.isNew).toBe(true);
    expect(p.effects.speed.ticks).toBe(BROTHS.sunpetal.ticks);
    expect(eat('sunpetal').isNew).toBe(false);
    expect(p.broths).toEqual(['sunpetal']);
    const m = MILESTONES.find((x) => x.id === 'taste_tester');
    expect(m.title).toBe('Taste Tester');
    expect(m.tick({ player: p })).toBe(false);
    for (const k of ['redbloom', 'skybell', 'rosette']) eat(k);
    expect(m.tick({ player: p })).toBe(false);
    eat('azalea');
    expect(p.broths.length).toBe(TASTE_GOAL);
    expect(m.tick({ player: p })).toBe(true);
  });
  it('keeps the blend on the stack through copies, merging rules and the network check', () => {
    const a = withExtras({ id: I.WANDERERS_BROTH, count: 1, damage: 0 }, { broth: 'skybell' });
    expect(a.broth).toBe('skybell');
    expect(withExtras({ id: 1, count: 1, damage: 0 }, { broth: 'nonsense' }).broth).toBeUndefined();
    const b = { ...a, broth: 'redbloom' };
    expect(canStack(a, { ...a })).toBe(true);
    expect(canStack(a, b)).toBe(false);
    expect(sameStack(a, b)).toBe(false);
    expect(sameStack(a, { ...a })).toBe(true);
  });
  it('cleans untrusted keys and round-trips the tasted blends through the save', () => {
    expect(cleanBroth('azalea')).toBe('azalea');
    expect(cleanBroth('__proto__')).toBeNull();
    expect(cleanBroth(5)).toBeNull();
    expect(cleanBroths(['azalea', 'azalea', 'x', 3, 'redbloom'])).toEqual(['azalea', 'redbloom']);
    expect(cleanBroths(null)).toEqual([]);
    const p = new Player();
    p.broths = ['skybell', 'rosette'];
    const d = JSON.parse(JSON.stringify(playerSaveData(p)));
    expect(d.broths).toEqual(['skybell', 'rosette']);
    expect(new Player().broths).toEqual([]);
  });
});
