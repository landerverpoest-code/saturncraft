import { describe, it, expect } from 'vitest';
import { sectionVisibility, floodVisible, connects, ALL_OPEN } from '../src/world/visibility.js';
import { pidx, PAD_VOL, meshSection } from '../src/world/mesher.js';
import { B } from '../src/world/blocks.js';

function section(fill) {
  const blocks = new Uint8Array(PAD_VOL);
  for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[pidx(x, y, z)] = fill(x, y, z);
  return blocks;
}

describe('section visibility', () => {
  it('air connects every face, solid rock none', () => {
    expect(sectionVisibility(section(() => 0))).toBe(ALL_OPEN);
    expect(sectionVisibility(section(() => B.STONE))).toBe(0);
  });

  it('a straight tunnel connects only its two ends', () => {
    const vis = sectionVisibility(section((x, y, z) => (y === 8 && z === 8 ? 0 : B.STONE)));
    expect(connects(vis, 0, 1)).toBe(true);   // -x <-> +x
    expect(connects(vis, 1, 0)).toBe(true);
    expect(connects(vis, 0, 3)).toBe(false);  // not up
    expect(connects(vis, 2, 3)).toBe(false);
    expect(connects(vis, 4, 5)).toBe(false);
  });

  it('leaves and glass do not block sight, a sealed pocket connects nothing', () => {
    expect(sectionVisibility(section(() => B.OAK_LEAVES))).toBe(ALL_OPEN);
    const pocket = sectionVisibility(section((x, y, z) => (x > 4 && x < 10 && y > 4 && y < 10 && z > 4 && z < 10 ? 0 : B.STONE)));
    expect(pocket).toBe(0);
  });

  it('a horizontal slab of stone separates top from bottom', () => {
    const vis = sectionVisibility(section((x, y) => (y === 7 ? B.STONE : 0)));
    expect(connects(vis, 2, 3)).toBe(false);
    expect(connects(vis, 3, 0)).toBe(true);  // top half reaches the sides
    expect(connects(vis, 2, 5)).toBe(true);  // and so does the bottom half
  });

  it('cut-out blocks are meshed into their own layer', () => {
    const r = meshSection({ blocks: section((x, y, z) => (x === 3 && y === 3 && z === 3 ? B.OAK_LEAVES : x === 8 && y === 3 && z === 3 ? B.STONE : 0)), light: new Uint8Array(PAD_VOL).fill(0xf0), meta: new Uint8Array(PAD_VOL), colors: new Uint8Array(256 * 6) });
    expect(r.opaque.idx.length).toBe(36);
    expect(r.cutout.idx.length).toBe(36);
    expect(r.trans).toBe(null);
  });
});

describe('camera flood fill', () => {
  // a 3x3 chunk world: open air above section 10, solid rock below, and one
  // sealed cave section at (1, 3, 1)
  const getVis = (cx, sy, cz) => (Math.abs(cx) > 1 || Math.abs(cz) > 1 ? -1 : sy >= 10 ? ALL_OPEN : 0);
  const reached = (cx, sy, cz) => { const s = new Set(); floodVisible(cx, sy, cz, 1, getVis, (x, y, z) => s.add(`${x},${y},${z}`)); return s; };

  it('from the surface sees the sky and the surface layer but not the rock below it', () => {
    const s = reached(0, 12, 0);
    expect(s.has('1,23,-1')).toBe(true);
    expect(s.has('-1,10,1')).toBe(true);
    expect(s.has('0,9,0')).toBe(true);   // the rock section bordering the air is visible
    expect(s.has('0,8,0')).toBe(false);  // but not what lies beneath it
    expect(s.has('1,3,1')).toBe(false);
  });

  it('from inside a sealed cave sees only its neighbours', () => {
    const s = reached(1, 3, 1);
    expect(s.size).toBe(1 + 4); // itself + -x, -z, up, down (+x and +z are unloaded)
    expect(s.has('0,12,0')).toBe(false);
  });

  it('stops at unloaded chunks', () => {
    const s = new Set();
    floodVisible(0, 12, 0, 3, getVis, (x, y, z) => s.add(`${x},${y},${z}`));
    expect([...s].some((k) => Math.abs(+k.split(',')[0]) > 1)).toBe(false);
  });
});
