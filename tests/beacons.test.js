import { describe, it, expect } from 'vitest';
import { B, COLOR_BLOCKS } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { beaconLevel, beamColor, beaconEffects, beaconMeta, beaconRange, beaconDuration, SECONDARY } from '../src/world/beacons.js';
import { craft } from '../src/player/crafting.js';
import { MockWorld } from './helpers.js';

class World extends MockWorld { heightAt() { return 120; } }
function pyramid(w, levels, top = 70) {
  for (let k = 1; k <= levels; k++) for (let dx = -k; dx <= k; dx++) for (let dz = -k; dz <= k; dz++) w.set(dx, top - k, dz, k % 2 ? B.IRON_BLOCK : B.GOLD_BLOCK);
  w.set(0, top, 0, B.BEACON);
}

describe('beacons', () => {
  it('count the full layers of metal blocks under them', () => {
    const w = new World(0);
    pyramid(w, 3);
    expect(beaconLevel(w, 0, 70, 0)).toBe(3);
    w.set(3, 66, -3, B.DIAMOND_BLOCK); // half of a fourth layer is not a layer
    expect(beaconLevel(w, 0, 70, 0)).toBe(3);
    w.set(1, 69, 1, B.STONE);
    expect(beaconLevel(w, 0, 70, 0)).toBe(0);
  });
  it('shine only through clear blocks, tinted by stained glass', () => {
    const w = new World(0);
    expect(beamColor(w, 0, 70, 0)).toEqual([1, 1, 1]);
    w.set(0, 75, 0, COLOR_BLOCKS.glass[14]); // red
    const c = beamColor(w, 0, 70, 0);
    expect(c[0]).toBeGreaterThan(c[2]);
    w.set(0, 90, 0, B.STONE);
    expect(beamColor(w, 0, 70, 0)).toBeNull();
  });
  it('give powers allowed by their level, with the level-4 extras', () => {
    expect(beaconEffects(beaconMeta('strength'), 2)).toEqual([]);
    expect(beaconEffects(beaconMeta('strength'), 3)).toEqual([{ name: 'strength', amp: 0 }]);
    expect(beaconEffects(beaconMeta('speed', SECONDARY.BOOST), 4)).toEqual([{ name: 'speed', amp: 1 }]);
    expect(beaconEffects(beaconMeta('haste', SECONDARY.REGENERATION), 4)).toEqual([{ name: 'haste', amp: 0 }, { name: 'regeneration', amp: 0 }]);
    expect(beaconEffects(beaconMeta('haste', SECONDARY.REGENERATION), 3)).toEqual([{ name: 'haste', amp: 0 }]);
    expect(beaconRange(4)).toBe(50);
    expect(beaconDuration(1)).toBe(220);
  });
  it('are made with a Suncore between glass and obsidian', () => {
    const st = (id) => id && { id, count: 1 }, G = B.GLASS, O = B.OBSIDIAN;
    expect(craft([G, G, G, G, I.SUNCORE, G, O, O, O].map(st), 3)).toEqual({ id: B.BEACON, count: 1 });
  });
});
