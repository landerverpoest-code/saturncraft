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

import { choosePainting, placePainting, paintingIntact, ARTS } from '../src/world/paintings.js';
describe('paintings', () => {
  it('the largest picture that fits is hung, and every part checks its neighbours', () => {
    const w = new RailWorld(64);
    for (let x = -5; x <= 5; x++) for (let y = 64; y < 70; y++) w.set(x, y, -1, B.STONE); // wall north of z = 0
    const pick = choosePainting(w, 0, 0, 65, 0, () => 0);
    expect(ARTS[pick.art][1] * ARTS[pick.art][2]).toBe(12); // the 4x3 one fits
    placePainting(w, 0, pick, (x, y, z, id, m) => w.set(x, y, z, id, m));
    const cells = [...w.blocks].filter(([, id]) => id === B.PAINTING || id === B.PAINTING_B);
    expect(cells.length).toBe(12);
    const [k] = cells[5]; const [x, y, z] = k.split(',').map(Number);
    expect(paintingIntact(w, x, y, z, w.getBlock(x, y, z), w.getMeta(x, y, z))).toBe(true);
  });
});
