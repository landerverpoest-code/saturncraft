// Creature Eggs (mobs/creatureEggs.js).
import { describe, it, expect } from 'vitest';
import { I, ITEMS } from '../src/world/items.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import { eggCatalog, eggMob, useEgg, NO_EGG } from '../src/mobs/creatureEggs.js';
import { canStack } from '../src/world/enchantments.js';
import { tooltipHTML } from '../src/ui/icons.js';
import '../src/world/dimensions/register.js';

describe('Creature Eggs', () => {
  it('are one item, labelled with the creature', () => {
    expect(ITEMS[I.CREATURE_EGG].creatureEgg).toBe(true);
    const cat = eggCatalog();
    expect(cat.length).toBeGreaterThan(30);
    expect(new Set(cat.map((e) => e.name)).size).toBe(cat.length);
    for (const e of cat) {
      expect(e.stack.id).toBe(I.CREATURE_EGG);
      expect(eggMob(e.stack)).toBe(e.key);
      expect(NO_EGG.has(e.key)).toBe(false);
    }
    expect(cat.find((e) => e.key === 'mooxen').name).toBe('Mooxen Egg');
    expect(cat.find((e) => e.key === 'void_wyrm')).toBeUndefined();
  });

  it('of different creatures do not stack, and say what they hold', () => {
    const a = { id: I.CREATURE_EGG, count: 1, label: 'Mooxen' }, b = { id: I.CREATURE_EGG, count: 1, label: 'Fleecer' };
    expect(canStack(a, { ...a })).toBe(true);
    expect(canStack(a, b)).toBe(false);
    expect(tooltipHTML(a)).toContain('Mooxen');
  });

  it('read their creature from the label, by name or key, and never a boss', () => {
    expect(eggMob({ id: I.CREATURE_EGG, count: 1, label: ' mooxen ' })).toBe('mooxen');
    expect(eggMob({ id: I.CREATURE_EGG, count: 1, label: MOBS.shambler.name.toUpperCase() })).toBe('shambler');
    expect(eggMob({ id: I.CREATURE_EGG, count: 1 })).toBe(null);
    expect(eggMob({ id: I.CREATURE_EGG, count: 1, label: 'Unicorn' })).toBe(null);
    expect(eggMob({ id: I.CREATURE_EGG, count: 1, label: 'void_wyrm' })).toBe(null);
    expect(eggMob({ id: I.EGG, count: 1, label: 'Mooxen' })).toBe(null);
  });

  it('hatch in front of the face they are used on; a guest asks the host', () => {
    const spawned = [], sent = [];
    const game = { spawner: { spawnMob: (k, x, y, z) => spawned.push([k, x, y, z]) }, net: null };
    const st = { id: I.CREATURE_EGG, count: 1, label: 'Mooxen' };
    expect(useEgg(game, st, { x: 4, y: 70, z: -3, face: [0, 1, 0] })).toBe('mooxen');
    expect(spawned).toEqual([['mooxen', 4.5, 71, -2.5]]);
    useEgg(game, st, { x: 4, y: 70, z: -3, face: [1, 0, 0] });
    expect(spawned[1]).toEqual(['mooxen', 5.5, 70, -2.5]);
    expect(useEgg(game, { id: I.CREATURE_EGG, count: 1, label: '?' }, { x: 0, y: 0, z: 0, face: [0, 1, 0] })).toBe(null);
    const guest = { spawner: { spawnMob() { throw new Error('the host spawns'); } }, net: { isClient: true, sendCommand: (t) => sent.push(t) } };
    useEgg(guest, st, { x: 4, y: 70, z: -3, face: [0, 1, 0] });
    expect(sent).toEqual(['/summon mooxen 4.50 71.00 -2.50']);
  });
});
