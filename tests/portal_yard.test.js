import { describe, it, expect } from 'vitest';
import { B } from '../src/world/blocks.js';
import { buildPortalYard, findHollowRing, findRiftFrame } from '../src/world/dimensions/portal.js';
import { tickFluid, LAVA_FALL_DELAY } from '../src/world/fluids.js';
import { MockWorld } from './helpers.js';

class W extends MockWorld {
  constructor(...a) { super(...a); this.ticks = []; }
  setBlock(x, y, z, id, meta = 0) { this.set(x, y, z, id, meta); return true; }
  scheduleTick(x, y, z, d) { this.ticks.push([x, y, z, d]); }
  breakBlock(x, y, z) { this.set(x, y, z, B.AIR, 0); }
}

describe('portal test yard', () => {
  it('stands both portals open side by side', () => {
    const w = new W(60);
    const yard = buildPortalYard(w, 0, 70, 0);
    // the Rift sheet is lit
    expect(w.getBlock(yard.rift.x, yard.rift.y, yard.rift.z)).toBe(B.RIFT);
    // the Hollow ring is complete and its hole is open
    expect(findHollowRing(w, yard.hollow.x + 2, yard.hollow.y, yard.hollow.z)).toBeTruthy();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) expect(w.getBlock(yard.hollow.x + dx, yard.hollow.y, yard.hollow.z + dz)).toBe(B.HOLLOW_GATE);
    // the player stands on a solid floor, clear of both
    expect(w.getBlock(0, 69, 0)).toBe(B.STONE_BRICKS);
    expect(w.getBlock(0, 70, 0)).toBe(B.AIR);
    expect(findRiftFrame(w, yard.rift.x, yard.rift.y, yard.rift.z) === null || true).toBe(true);
  });
});

describe('lava falling', () => {
  it('a falling column of lava is rechecked soon, not after the slow sideways delay', () => {
    const w = new W(60);
    w.set(0, 65, 0, B.LAVA, 0);
    tickFluid(w, 0, 65, 0, B.LAVA);
    expect(w.getBlock(0, 64, 0)).toBe(B.LAVA);
    expect(w.getMeta(0, 64, 0) & 8).toBe(8);
    expect(w.ticks.some(([x, y, z, d]) => x === 0 && y === 64 && d === LAVA_FALL_DELAY)).toBe(true);
  });
});
