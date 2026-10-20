import { describe, it, expect } from 'vitest';
import { B } from '../src/world/blocks.js';
import { cidx } from '../src/world/constants.js';
import { MockWorld } from './helpers.js';
import {
  findRiftFrame, fillRift, riftCanStay, ringCells, findHollowRing, fillHollowGate, buildRiftPortal, findPortalSite, nearestRift,
} from '../src/world/dimensions/portal.js';
import { scaleCoord, clampPortalY, dimensionByName, createGenerator, DIMENSIONS } from '../src/world/dimensions/dims.js';
import { CinderdeepGenerator, CINDER_LAVA } from '../src/world/dimensions/cinderdeep.js';
import { HollowGenerator } from '../src/world/dimensions/hollow.js';
import { sanctumInRegion, nearestSanctum, stampSanctums, SANCTUM_REGION } from '../src/world/dimensions/sanctum.js';
import { TerrainGenerator } from '../src/world/generator.js';

/** MockWorld with setBlock (as the game's World). */
class TestWorld extends MockWorld {
  setBlock(x, y, z, id, meta = 0) { this.set(x, y, z, id, meta); return true; }
}

/** Obsidian frame in the x (axis 0) or z (axis 1) plane: outer w+2 by h+2, interior lower corner at (x, y, z). */
function frame(w, x, y, z, iw, ih, axis = 0, corners = true) {
  const [ax, az] = axis ? [0, 1] : [1, 0];
  for (let i = -1; i <= iw; i++) for (let j = -1; j <= ih; j++) {
    const edge = i === -1 || i === iw || j === -1 || j === ih;
    const corner = (i === -1 || i === iw) && (j === -1 || j === ih);
    if (corner && !corners) w.set(x + ax * i, y + j, z + az * i, B.AIR);
    else w.set(x + ax * i, y + j, z + az * i, edge ? B.OBSIDIAN : B.AIR);
  }
}

describe('Rift portal frames', () => {
  it('finds a minimal 4x5 frame from any interior cell, in both planes', () => {
    const w = new TestWorld(0);
    frame(w, 10, 70, 5, 2, 3, 0);
    for (const [x, y] of [[10, 70], [11, 70], [11, 72], [10, 71]]) {
      expect(findRiftFrame(w, x, y, 5)).toEqual({ axis: 0, x: 10, y: 70, z: 5, w: 2, h: 3 });
    }
    const w2 = new TestWorld(0);
    frame(w2, 3, 64, -8, 2, 3, 1);
    expect(findRiftFrame(w2, 3, 64, -7)).toEqual({ axis: 1, x: 3, y: 64, z: -8, w: 2, h: 3 });
  });

  it('accepts frames without corners and larger frames', () => {
    const w = new TestWorld(0);
    frame(w, 0, 70, 0, 2, 3, 0, false);
    expect(findRiftFrame(w, 0, 70, 0)).toMatchObject({ w: 2, h: 3 });
    const w2 = new TestWorld(0);
    frame(w2, 0, 70, 0, 6, 8, 0);
    expect(findRiftFrame(w2, 3, 74, 0)).toMatchObject({ x: 0, y: 70, w: 6, h: 8 });
  });

  it('rejects incomplete, blocked or too small frames', () => {
    const w = new TestWorld(0);
    frame(w, 0, 70, 0, 2, 3, 0);
    w.set(-1, 71, 0, B.STONE); // a side block is not obsidian
    expect(findRiftFrame(w, 0, 70, 0)).toBeNull();
    const w2 = new TestWorld(0);
    frame(w2, 0, 70, 0, 2, 3, 0);
    w2.set(1, 71, 0, B.DIRT); // something inside
    expect(findRiftFrame(w2, 0, 70, 0)).toBeNull();
    const w3 = new TestWorld(0);
    frame(w3, 0, 70, 0, 1, 3, 0); // 1 wide
    expect(findRiftFrame(w3, 0, 70, 0)).toBeNull();
    const w4 = new TestWorld(0);
    frame(w4, 0, 70, 0, 2, 2, 0); // 2 high
    expect(findRiftFrame(w4, 0, 70, 0)).toBeNull();
    expect(findRiftFrame(new TestWorld(0), 0, 70, 0)).toBeNull(); // no frame at all
  });

  it('fills the frame with Rift blocks that collapse with the frame', () => {
    const w = new TestWorld(0);
    frame(w, 0, 70, 0, 2, 3, 1);
    const f = findRiftFrame(w, 0, 70, 1);
    fillRift(w, f);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
      expect(w.getBlock(0, 70 + j, i)).toBe(B.RIFT);
      expect(w.getMeta(0, 70 + j, i)).toBe(1);
      expect(riftCanStay(w, 0, 70 + j, i)).toBe(true);
    }
    w.set(0, 69, 0, B.AIR); // break the bottom of the frame
    expect(riftCanStay(w, 0, 70, 0)).toBe(false);
    expect(riftCanStay(w, 0, 72, 1)).toBe(true);
  });

  it('builds a working portal and finds a site on flat ground', () => {
    const w = new TestWorld(64);
    const site = findPortalSite(w, 5, 64, 5, 6, 40, 90);
    expect(site).not.toBeNull();
    expect(site.y).toBe(64);
    const f = buildRiftPortal(w, site.x, site.y, site.z, site.axis, false);
    expect(f).toMatchObject({ w: 2, h: 3, y: 64 });
    expect(w.getBlock(f.x, f.y, f.z)).toBe(B.RIFT);
    w.set(f.x, f.y, f.z, B.AIR); // re-detect the built frame
    expect(findRiftFrame(w, f.x, f.y, f.z)).toMatchObject({ axis: f.axis, w: 2, h: 3 });
  });

  it('finds the nearest existing Rift in chunk data', () => {
    const blocks = new Uint8Array(16 * 16 * 384);
    for (let y = 40; y < 43; y++) blocks[cidx(4, y, 9)] = B.RIFT;
    const r = nearestRift([{ cx: 2, cz: -1, blocks }], cidx, 30, 45, -10, 16, 1, 126);
    expect(r).toEqual({ x: 36, y: 40, z: -7 });
    expect(nearestRift([{ cx: 9, cz: 9, blocks }], cidx, 30, 45, -10, 16, 1, 126)).toBeNull();
  });
});

describe('Hollow gate rings', () => {
  it('opens only when all twelve frames hold an eye', () => {
    const w = new TestWorld(0);
    const cells = ringCells(20, 30, -4);
    expect(cells.length).toBe(12);
    for (const [x, y, z] of cells) w.set(x, y, z, B.HOLLOW_FRAME_EYE);
    w.set(cells[5][0], 30, cells[5][2], B.HOLLOW_FRAME);
    expect(findHollowRing(w, cells[0][0], 30, cells[0][2])).toBeNull();
    w.set(cells[5][0], 30, cells[5][2], B.HOLLOW_FRAME_EYE);
    const c = findHollowRing(w, cells[5][0], 30, cells[5][2]);
    expect(c).toEqual({ x: 20, y: 30, z: -4 });
    fillHollowGate(w, c);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) expect(w.getBlock(20 + dx, 30, -4 + dz)).toBe(B.HOLLOW_GATE);
  });
});

describe('Coordinate scaling', () => {
  it('maps the Cinderdeep 1:8 to the overworld', () => {
    expect(scaleCoord(800, 'overworld', 'cinderdeep')).toBe(100);
    expect(scaleCoord(-12.5, 'cinderdeep', 'overworld')).toBe(-100);
    expect(scaleCoord(scaleCoord(1234, 'overworld', 'cinderdeep'), 'cinderdeep', 'overworld')).toBeCloseTo(1234);
    expect(scaleCoord(55, 'overworld', 'hollow')).toBe(55);
  });
  it('keeps portals above the lava sea and below the ceiling', () => {
    expect(clampPortalY(5, 'cinderdeep')).toBe(CINDER_LAVA + 2);
    expect(clampPortalY(200, 'cinderdeep')).toBe(118);
    expect(clampPortalY(70.4, 'overworld')).toBe(70);
  });
  it('resolves dimension names', () => {
    expect(dimensionByName('the_cinderdeep')).toBe('cinderdeep');
    expect(dimensionByName('Hollow')).toBe('hollow');
    expect(dimensionByName('overworld')).toBe('overworld');
    expect(dimensionByName('mars')).toBeNull();
    expect(Object.keys(DIMENSIONS)).toEqual(['overworld', 'cinderdeep', 'hollow']);
  });
});

describe('Cinderdeep generator', () => {
  const g = new CinderdeepGenerator(4242);
  it('is deterministic per seed', () => {
    const a = g.generate(3, -2), b = new CinderdeepGenerator(4242).generate(3, -2), c = new CinderdeepGenerator(4243).generate(3, -2);
    expect(Buffer.from(a.blocks).equals(Buffer.from(b.blocks))).toBe(true);
    expect(Buffer.from(a.blocks).equals(Buffer.from(c.blocks))).toBe(false);
  });
  it('has a bedrock floor at y 0 and a bedrock ceiling at y 127, nothing above', () => {
    for (const [cx, cz] of [[0, 0], [-5, 7]]) {
      const c = g.generate(cx, cz);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        expect(c.blocks[cidx(x, 0, z)]).toBe(B.BEDROCK);
        expect(c.blocks[cidx(x, 127, z)]).toBe(B.BEDROCK);
        expect(c.blocks[cidx(x, 128, z)]).toBe(B.AIR);
        expect(c.blocks[cidx(x, -1, z)]).toBe(B.AIR);
      }
    }
  });
  it('has open caverns, a lava sea and its own blocks', () => {
    const count = {};
    for (let cx = 0; cx < 4; cx++) for (let cz = 0; cz < 4; cz++) {
      const c = g.generate(cx, cz);
      for (let y = 1; y < 127; y++) for (let i = 0; i < 256; i++) { const id = c.blocks[(y - (-64)) * 256 + i]; count[id] = (count[id] || 0) + 1; }
      for (let y = CINDER_LAVA + 1; y < 127; y++) for (let i = 0; i < 256; i++) if (c.blocks[(y + 64) * 256 + i] === B.LAVA) count.lavaAbove = (count.lavaAbove || 0) + 1;
    }
    expect(count.lavaAbove || 0).toBe(0);
    expect(count[B.AIR]).toBeGreaterThan(20000);
    expect(count[B.LAVA]).toBeGreaterThan(1000);
    expect(count[B.CINDERSTONE]).toBeGreaterThan(count[B.AIR] * 0.5);
    for (const id of [B.EMBERQUARTZ_ORE, B.GLOWSHARD, B.MOURNSAND]) expect(count[id] || 0).toBeGreaterThan(0);
  });
  it('places deterministic Ember Bastions with a spawner', () => {
    const list = g.bastionsNear(-1024, -1024, 1024, 1024);
    expect(list.length).toBeGreaterThan(3);
    const b = list[0];
    const c = g.generate(Math.floor(b.cx / 16), Math.floor(b.cz / 16));
    expect(c.blocks[cidx(((b.cx % 16) + 16) % 16, b.y, ((b.cz % 16) + 16) % 16)]).toBe(B.SCORCHED_BRICKS);
    expect(c.blocks[cidx(((b.cx % 16) + 16) % 16, b.y + 1, ((b.cz % 16) + 16) % 16)]).toBe(B.SPAWNER);
  });
});

describe('Hollow generator', () => {
  const g = new HollowGenerator(99);
  it('is deterministic and builds a central island over the void', () => {
    const a = g.generate(0, 0), b = new HollowGenerator(99).generate(0, 0);
    expect(Buffer.from(a.blocks).equals(Buffer.from(b.blocks))).toBe(true);
    let stone = 0;
    for (const id of a.blocks) if (id === B.HOLLOWSTONE) stone++;
    expect(stone).toBeGreaterThan(5000);
    // nothing at all over the void just outside the main island
    const far = g.generate(12, 0); // x 192..207
    expect(far.blocks.every((id) => id === B.AIR)).toBe(true);
  });
  it('raises ten obsidian pillars and the bedrock fountain', () => {
    const pillars = g.pillars();
    expect(pillars.length).toBe(10);
    for (const p of pillars) {
      const c = g.generate(Math.floor(p.x / 16), Math.floor(p.z / 16));
      const lx = ((p.x % 16) + 16) % 16, lz = ((p.z % 16) + 16) % 16;
      expect(c.blocks[cidx(lx, p.h, lz)]).toBe(B.OBSIDIAN);
      expect(c.blocks[cidx(lx, p.h + 1, lz)]).toBe(B.BEDROCK);
    }
    const fy = g.fountainY(), c = g.generate(0, 0);
    expect(c.blocks[cidx(0, fy - 1, 0)]).toBe(B.BEDROCK);
    expect(c.blocks[cidx(0, fy + 3, 0)]).toBe(B.BEDROCK);
    for (const [x, y, z] of g.gateCells()) if (x >= 0 && z >= 0) expect(c.blocks[cidx(x, y, z)]).toBe(B.AIR);
    expect(g.gateCells().length).toBe(20);
  });
  it('createGenerator returns the right generator per dimension', () => {
    expect(createGenerator('cinderdeep', 1)).toBeInstanceOf(CinderdeepGenerator);
    expect(createGenerator('hollow', 1)).toBeInstanceOf(HollowGenerator);
    expect(createGenerator('overworld', 1)).toBeInstanceOf(TerrainGenerator);
  });
});

describe('Hollow Sanctums', () => {
  it('are deterministic and hold a ring of twelve frames around a lava pool', () => {
    let s = null;
    for (let r = 0; !s && r < 10; r++) s = sanctumInRegion(7, r, 0);
    expect(s).not.toBeNull();
    expect(sanctumInRegion(7, Math.floor(s.x / SANCTUM_REGION), 0)).toEqual(s);
    const gen = { seed: 7 };
    let frames = 0, lava = 0;
    for (let cx = Math.floor(s.x0 / 16); cx <= Math.floor(s.x1 / 16); cx++) for (let cz = Math.floor(s.z0 / 16); cz <= Math.floor(s.z1 / 16); cz++) {
      const blocks = new Uint8Array(16 * 16 * 384), meta = new Uint8Array(16 * 16 * 384);
      stampSanctums(gen, blocks, meta, cx, cz);
      for (const id of blocks) { if (id === B.HOLLOW_FRAME || id === B.HOLLOW_FRAME_EYE) frames++; if (id === B.LAVA) lava++; }
    }
    expect(frames).toBe(12);
    expect(lava).toBe(9);
    const n = nearestSanctum(7, s.x + 10, s.z - 10);
    expect(Math.hypot(n.x - s.x - 10, n.z - s.z + 10)).toBeLessThanOrEqual(Math.hypot(10, 10) + 1e-9);
  });
  it('are stamped by the overworld generator', () => {
    const tg = new TerrainGenerator(12345);
    const s = nearestSanctum(12345, 0, 0);
    const c = tg.generate(Math.floor(s.x / 16), Math.floor(s.z / 16));
    expect(c.blocks[cidx(((s.x % 16) + 16) % 16, s.y, ((s.z % 16) + 16) % 16)]).toBe(B.LAVA);
  });
});
