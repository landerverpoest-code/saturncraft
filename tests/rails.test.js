import { describe, it, expect } from 'vitest';
import { railShape, updateRails, railHeight } from '../src/world/rails.js';
import { B } from '../src/world/blocks.js';
import { MockWorld } from './helpers.js';

class RailWorld extends MockWorld {
  setBlock(x, y, z, id, meta = 0) { this.set(x, y, z, id, meta); return true; }
}
const place = (w, x, y, z) => { w.set(x, y, z, B.RAIL, 0); updateRails(w, x, y, z); };

describe('rails', () => {
  it('a line of rails runs straight, a turn makes a curve', () => {
    const w = new RailWorld(64);
    place(w, 0, 64, 0); place(w, 1, 64, 0); place(w, 2, 64, 0);
    expect(w.getMeta(1, 64, 0)).toBe(1); // east-west
    place(w, 2, 64, 1); // turn south at the end
    expect(w.getMeta(2, 64, 0)).toBe(7); // curve joining +z and -x
  });
  it('a rail next to a higher rail ascends towards it', () => {
    const w = new RailWorld(64);
    w.set(1, 64, 0, B.STONE);
    place(w, 1, 65, 0); place(w, 0, 64, 0);
    expect(w.getMeta(0, 64, 0)).toBe(2); // ascending +x
    expect(railHeight(2, 1, 0.5)).toBeCloseTo(1 + 1 / 16);
  });
  it('shape from neighbours without placement', () => {
    const w = new RailWorld(64);
    w.set(0, 64, -1, B.RAIL); w.set(0, 64, 1, B.RAIL);
    expect(railShape(w, 0, 64, 0)).toBe(0);
  });
});
