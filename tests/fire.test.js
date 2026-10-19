import { describe, it, expect } from 'vitest';
import { tickFire, fireCanStay, canLight, isFlammable } from '../src/world/fire.js';
import { B } from '../src/world/blocks.js';
import { craft } from '../src/player/crafting.js';
import { I } from '../src/world/items.js';
import { MockWorld, rng } from './helpers.js';

class FireWorld extends MockWorld {
  constructor() { super(64); this.queue = []; }
  setBlock(x, y, z, id, meta = 0) { this.set(x, y, z, id, meta); return true; }
  scheduleTick(x, y, z) { this.queue.push([x, y, z]); }
  /** Run queued fire ticks for n rounds. */
  run(n, r) {
    for (let k = 0; k < n; k++) {
      const q = this.queue; this.queue = [];
      for (const [x, y, z] of q) if (this.getBlock(x, y, z) === B.FIRE) tickFire(this, x, y, z, r);
    }
  }
  count(id) { let n = 0; for (const v of this.blocks.values()) if (v === id) n++; return n; }
}

describe('fire', () => {
  it('can be lit on solid ground or next to fuel, not in mid-air', () => {
    const w = new FireWorld();
    expect(canLight(w, 0, 64, 0)).toBe(true);
    expect(canLight(w, 0, 70, 0)).toBe(false);
    w.set(1, 70, 0, B.OAK_PLANKS);
    expect(fireCanStay(w, 0, 70, 0)).toBe(true);
    expect(isFlammable(B.OAK_LEAVES)).toBe(true);
    expect(isFlammable(B.COBBLESTONE)).toBe(false);
  });

  it('burns out on stone without fuel', () => {
    const w = new FireWorld();
    w.set(0, 64, 0, B.FIRE, 0); w.queue.push([0, 64, 0]);
    w.run(40, rng(3));
    expect(w.getBlock(0, 64, 0)).toBe(B.AIR);
  });

  it('spreads over a plank floor, burns some of it and finally goes out', () => {
    const w = new FireWorld();
    for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) w.set(x, 64, z, B.OAK_PLANKS);
    w.set(0, 65, 0, B.FIRE, 0); w.queue.push([0, 65, 0]);
    w.run(1500, rng(7));
    expect(w.count(B.OAK_PLANKS)).toBeLessThan(30);
    expect(w.count(B.FIRE)).toBe(0);
  });

  it('flint and steel is crafted from iron and flint', () => {
    const grid = [I.IRON_INGOT, I.FLINT, 0, 0].map((id) => (id ? { id, count: 1 } : null));
    expect(craft(grid, 2)?.id).toBe(I.FLINT_AND_STEEL);
  });
});
