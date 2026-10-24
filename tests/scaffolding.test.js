import { describe, it, expect } from 'vitest';
import { PHYS } from '../src/physics/constants.js';
import { Body } from '../src/physics/body.js';
import { B } from '../src/world/blocks.js';
import { scaffoldDistance, scaffoldTick, scaffoldColumnTop, SCAFFOLD_MAX } from '../src/world/scaffolding.js';
import { craft } from '../src/player/crafting.js';
import { I } from '../src/world/items.js';
import { MockWorld } from './helpers.js';

class World extends MockWorld {
  setBlock(x, y, z, id, meta = 0) { this.set(x, y, z, id, meta); }
  breakBlock(x, y, z) { this.set(x, y, z, B.AIR); }
}
/** A tower of scaffolding at x=0,z=0 from y=64 up `h` blocks. */
function tower(w, h) { for (let k = 0; k < h; k++) w.set(0, 64 + k, 0, B.SCAFFOLDING, 0); }

describe('scaffolding', () => {
  it('is crafted from bamboo and string, six at a time', () => {
    const st = (id) => id && { id, count: 1 }, b = B.BAMBOO, s = I.STRING;
    expect(craft([b, s, b, b, null, b, b, null, b].map(st), 3)).toEqual({ id: B.SCAFFOLDING, count: 6 });
  });
  it('counts its distance from a supported column and gives up past six', () => {
    const w = new World();
    tower(w, 3);
    expect(scaffoldDistance(w, 0, 64, 0)).toBe(0);
    expect(scaffoldDistance(w, 0, 66, 0)).toBe(0); // on the column
    for (let k = 1; k <= 7; k++) { const d = scaffoldDistance(w, k, 66, 0); expect(d).toBe(Math.min(k, SCAFFOLD_MAX + 1)); if (d <= SCAFFOLD_MAX) w.set(k, 66, 0, B.SCAFFOLDING, d); }
    expect(scaffoldColumnTop(w, 0, 64, 0)).toEqual([0, 67, 0]);
  });
  it('comes down when its footing goes', () => {
    const w = new World();
    tower(w, 3);
    w.set(0, 64, 0, B.AIR);
    scaffoldTick(w, 0, 65, 0);
    expect(w.getBlock(0, 65, 0)).toBe(B.AIR);
  });
  it('holds up whoever stands on top, lets a sneaker sink through and is climbed from inside', () => {
    const w = new World();
    tower(w, 3);
    const b = new Body(PHYS.PLAYER_WIDTH, PHYS.PLAYER_HEIGHT);
    b.setPos(0.5, 67.5, 0.5);
    for (let i = 0; i < 20; i++) b.travel(w, {});
    expect(b.y).toBeCloseTo(67, 3); // standing on the top plate
    for (let i = 0; i < 20; i++) b.travel(w, { sneak: true });
    expect(b.y).toBeLessThan(66.5); // sinking inside
    const y0 = b.y;
    for (let i = 0; i < 10; i++) b.travel(w, { jump: true });
    expect(b.y).toBeGreaterThan(y0 + 1); // climbing
  });
});
