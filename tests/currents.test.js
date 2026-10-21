import { describe, it, expect } from 'vitest';
import { B } from '../src/world/blocks.js';
import { fluidFlow } from '../src/physics/body.js';

const world = (cells) => ({
  getBlock: (x, y, z) => (cells[`${x},${y},${z}`] ? cells[`${x},${y},${z}`][0] : y < 0 ? B.STONE : 0),
  getMeta: (x, y, z) => (cells[`${x},${y},${z}`] ? cells[`${x},${y},${z}`][1] : 0),
});

describe('water currents', () => {
  it('flow from the source towards thinner water', () => {
    const w = world({ '0,0,0': [B.WATER, 0], '1,0,0': [B.WATER, 1], '2,0,0': [B.WATER, 2] });
    const out = [0, 0, 0];
    fluidFlow(w, 1, 0, 0, B.WATER, out);
    expect(out[0]).toBeGreaterThan(0.9);
  });
  it('a still lake of sources has no current', () => {
    const cells = {};
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) cells[`${x},0,${z}`] = [B.WATER, 0];
    const out = [0, 0, 0];
    fluidFlow(world(cells), 0, 0, 0, B.WATER, out);
    expect(Math.hypot(...out)).toBe(0);
  });
  it('falling water pulls down', () => {
    const out = [0, 0, 0];
    fluidFlow(world({ '0,0,0': [B.WATER, 8] }), 0, 0, 0, B.WATER, out);
    expect(out[1]).toBeLessThan(0);
  });
});
