import { describe, it, expect } from 'vitest';
import { B, BLOCKS } from '../src/world/blocks.js';
import { I, ITEMS, SHERD_ITEMS } from '../src/world/items.js';
import { SHERDS } from '../src/world/sherds.js';
import {
  BrushSites, BRUSH_TICKS, DECAY_DELAY, SITE, SITE_LOOT, susMeta, siteOf, stageOf, brushStage, archaeologyLoot,
  potFace, potFacesFromGrid, potDrops, potSlotSide, cleanPotFaces,
} from '../src/world/archaeology.js';
import { craft } from '../src/player/crafting.js';
import { canStack, withExtras } from '../src/world/enchantments.js';
import { blockDrops } from '../src/world/mining.js';
import { HAND } from '../src/world/items.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { buriedRuinsNear, buriedRuinPlan, BURIED_BIOMES } from '../src/world/buriedRuins.js';
import { templeDigSpots, templesNear } from '../src/world/temples.js';
import { cidx } from '../src/world/constants.js';

class World {
  constructor() { this.b = new Map(); this.m = new Map(); this.edits = 0; }
  getBlock(x, y, z) { return this.b.get(`${x},${y},${z}`) || 0; }
  getMeta(x, y, z) { return this.m.get(`${x},${y},${z}`) || 0; }
  setBlock(x, y, z, id, meta = 0) { this.b.set(`${x},${y},${z}`, id); this.m.set(`${x},${y},${z}`, meta); this.edits++; }
}

describe('suspicious blocks and the brush', () => {
  it('registers the blocks, items and recipe', () => {
    expect(BLOCKS[B.SUSPICIOUS_SAND].suspicious).toBe(B.SAND);
    expect(BLOCKS[B.SUSPICIOUS_GRAVEL].suspicious).toBe(B.GRAVEL);
    expect(BLOCKS[B.SUSPICIOUS_SAND].gravity).toBe(true);
    expect(ITEMS[I.BRUSH].durability).toBe(64);
    expect(SHERD_ITEMS).toHaveLength(8);
    expect(new Set(SHERDS.map((s) => s.name)).size).toBe(8);
    for (const s of SHERDS) { expect(s.motif).toHaveLength(8); for (const r of s.motif) expect(r).toHaveLength(8); }
    const g = [null, I.FEATHER, null, null, I.COPPER_INGOT, null, null, I.STICK, null];
    expect(craft(g.map((id) => (id ? { id, count: 1 } : null)), 3)).toEqual({ id: I.BRUSH, count: 1 });
  });

  it('mined suspicious blocks drop nothing', () => {
    expect(blockDrops(B.SUSPICIOUS_SAND, HAND, Math.random, 0)).toEqual([]);
    expect(blockDrops(B.SUSPICIOUS_GRAVEL, HAND, Math.random, 0)).toEqual([]);
  });

  it('meta packs the site and the stage', () => {
    const m = susMeta(SITE.WRECK, 2);
    expect(siteOf(m)).toBe(SITE.WRECK);
    expect(stageOf(m)).toBe(2);
    expect(brushStage(0)).toBe(0);
    expect(brushStage(BRUSH_TICKS - 1)).toBe(3);
  });

  it('brushing goes through four stages and finishes after 2.5 s', () => {
    const w = new World(), s = new BrushSites();
    w.setBlock(1, 2, 3, B.SUSPICIOUS_SAND, susMeta(SITE.TEMPLE));
    const stages = new Set();
    let r, t = 0;
    for (; t < 200; t++) { r = s.brush(w, 1, 2, 3, t); stages.add(stageOf(w.getMeta(1, 2, 3))); if (r.done) break; }
    expect(t + 1).toBe(BRUSH_TICKS);
    expect([...stages].sort()).toEqual([0, 1, 2, 3]);
    expect(r).toMatchObject({ done: true, plain: B.SAND, site: SITE.TEMPLE });
    expect(s.sites.size).toBe(0);
  });

  it('a dig left alone slowly fills back in, and resumes from its stage', () => {
    const w = new World(), s = new BrushSites();
    w.setBlock(0, 0, 0, B.SUSPICIOUS_GRAVEL, susMeta(SITE.BURIED));
    for (let t = 0; t < 40; t++) s.brush(w, 0, 0, 0, t);
    expect(stageOf(w.getMeta(0, 0, 0))).toBe(3);
    // not yet: the delay
    for (let t = 40; t < 40 + DECAY_DELAY; t++) s.tick(w, t);
    expect(stageOf(w.getMeta(0, 0, 0))).toBe(3);
    let t = 40 + DECAY_DELAY, seen = [];
    for (; t < 400 && s.sites.size; t++) { s.tick(w, t); seen.push(stageOf(w.getMeta(0, 0, 0))); }
    expect(stageOf(w.getMeta(0, 0, 0))).toBe(0);
    expect(seen).toContain(2); expect(seen).toContain(1);
    expect(t - 40 - DECAY_DELAY).toBeGreaterThan(40); // slow: about a second per stage
    expect(siteOf(w.getMeta(0, 0, 0))).toBe(SITE.BURIED); // the site survives
    // brushing again picks up where the stage shows
    w.setBlock(0, 0, 0, B.SUSPICIOUS_GRAVEL, susMeta(SITE.BURIED, 2));
    const s2 = new BrushSites();
    let n = 0;
    while (!s2.brush(w, 0, 0, 0, n).done) n++;
    expect(n + 1).toBe(BRUSH_TICKS / 2);
  });

  it('ignores blocks that are not suspicious', () => {
    const w = new World(), s = new BrushSites();
    w.setBlock(0, 0, 0, B.SAND);
    expect(s.brush(w, 0, 0, 0, 0)).toBeNull();
    expect(w.edits).toBe(1);
  });
});

describe('deterministic finds', () => {
  it('the same seed, spot and site always give the same find', () => {
    for (let k = 0; k < 50; k++) {
      const a = archaeologyLoot(42, k * 7, 64, -k, k & 3), b = archaeologyLoot(42, k * 7, 64, -k, k & 3);
      expect(a).toEqual(b);
      expect(SITE_LOOT[k & 3].some((e) => e[0] === a.id && a.count >= e[1] && a.count <= e[2])).toBe(true);
    }
  });

  it('finds vary with the spot and the seed, and sherds turn up at every site', () => {
    for (const site of Object.values(SITE)) {
      const ids = new Set();
      for (let x = 0; x < 300; x++) ids.add(archaeologyLoot(7, x, 60, 3, site).id);
      expect(ids.size).toBeGreaterThan(3);
      expect([...ids].some((id) => SHERD_ITEMS.includes(id))).toBe(true);
    }
    let differ = 0;
    for (let x = 0; x < 50; x++) if (archaeologyLoot(1, x, 60, 0, 0).id !== archaeologyLoot(2, x, 60, 0, 0).id) differ++;
    expect(differ).toBeGreaterThan(10);
  });
});

describe('decorated pots', () => {
  const grid = (back, left, right, front) => [null, back, null, left, null, right, null, front, null].map((id) => (id ? { id, count: 1 } : null));

  it('four bricks make a plain pot', () => {
    expect(craft(grid(I.BRICK, I.BRICK, I.BRICK, I.BRICK), 3)).toEqual({ id: B.DECORATED_POT, count: 1 });
  });

  it('sherds are remembered on the side they were laid', () => {
    const r = craft(grid(SHERD_ITEMS[0], I.BRICK, SHERD_ITEMS[7], SHERD_ITEMS[3]), 3);
    expect(r).toEqual({ id: B.DECORATED_POT, count: 1, sherds: [1, 0, 8, 4] });
    expect(craft(grid(I.BRICK, I.BRICK, I.STICK, I.BRICK), 3)).toBeNull();
    expect(potFace(I.BRICK)).toBe(0);
    expect(potFace(SHERD_ITEMS[2])).toBe(3);
    expect(potFace(I.STICK)).toBe(-1);
    expect(potFacesFromGrid([0, I.BRICK, 0, I.BRICK, 0, I.BRICK, 0, I.BRICK, 0])).toBeNull();
  });

  it('pots with different sherds do not stack, and keep sherds through copies', () => {
    const a = { id: B.DECORATED_POT, count: 1, sherds: [1, 0, 0, 0] }, b = { id: B.DECORATED_POT, count: 1, sherds: [2, 0, 0, 0] };
    expect(canStack(a, b)).toBe(false);
    expect(canStack(a, { ...a })).toBe(true);
    expect(withExtras({ id: a.id, count: 1, damage: 0 }, a).sherds).toEqual([1, 0, 0, 0]);
    expect(cleanPotFaces([99, -3, 'x', 2])).toEqual([0, 0, 0, 2]);
    expect(cleanPotFaces([0, 0, 0, 0])).toBeNull();
  });

  it('a tool keeps the pot whole, a hand shatters it into its sides', () => {
    expect(potDrops([1, 0, 8, 4], true)).toEqual([{ id: B.DECORATED_POT, count: 1, damage: 0, sherds: [1, 0, 8, 4] }]);
    expect(potDrops([1, 0, 8, 4], false).map((s) => s.id)).toEqual([SHERD_ITEMS[0], I.BRICK, SHERD_ITEMS[7], SHERD_ITEMS[3]]);
    expect(potDrops(null, false).map((s) => s.id)).toEqual([I.BRICK, I.BRICK, I.BRICK, I.BRICK]);
  });

  it('maps slots to world sides from the front', () => {
    // front facing -z (side 0): back is +z, the viewer's left +x, right -x
    expect([0, 1, 2, 3].map((s) => potSlotSide(s, 0))).toEqual([2, 1, 3, 0]);
    expect(potSlotSide(3, 2)).toBe(2);
  });
});

describe('generation', () => {
  const gen = new TerrainGenerator(12345);
  it('Buried Ruins stand in plains or taiga with Suspicious Gravel', () => {
    const list = buriedRuinsNear(gen, -2500, -2500, 2500, 2500);
    expect(list.length).toBeGreaterThan(3);
    for (const r of list.slice(0, 5)) {
      expect(BURIED_BIOMES).toContain(gen.biomeFor(gen.column(r.cx, r.cz), r.y));
      const plan = buriedRuinPlan(r);
      expect(plan.some(([, , , id]) => id === B.SUSPICIOUS_GRAVEL)).toBe(true);
      expect(plan.every(([, , , id, m]) => id !== B.SUSPICIOUS_GRAVEL || siteOf(m) === SITE.BURIED)).toBe(true);
    }
    // stamped into its chunk, gravel under it (it can't fall)
    const r = list[0], c = gen.generate(Math.floor(r.cx / 16), Math.floor(r.cz / 16));
    const lx = r.cx - Math.floor(r.cx / 16) * 16, lz = r.cz - Math.floor(r.cz / 16) * 16;
    const ids = [r.y - 3, r.y - 2, r.y - 1, r.y].map((y) => c.blocks[cidx(lx, y, lz)]);
    expect(ids[0]).toBe(B.PACKED_MUD);
    expect([B.GRAVEL, B.SUSPICIOUS_GRAVEL]).toContain(ids[1]);
  });

  it('desert temples hold Suspicious Sand on solid footing', () => {
    const list = templesNear(gen, -4000, -4000, 4000, 4000).filter((t) => t.kind === 'desert');
    expect(list.length).toBeGreaterThan(0);
    const t = list[0], spots = templeDigSpots(gen.seed, t);
    expect(spots).toHaveLength(6);
    for (const [dx, dz] of spots) { expect(Math.abs(dx)).toBeLessThanOrEqual(9); expect(Math.abs(dz)).toBeLessThanOrEqual(9); expect(Math.max(Math.abs(dx), Math.abs(dz))).toBeGreaterThan(1); }
    const [dx, dz, y] = spots[0], x = t.cx + dx, z = t.cz + dz;
    const c = gen.generate(Math.floor(x / 16), Math.floor(z / 16)), lx = x - Math.floor(x / 16) * 16, lz = z - Math.floor(z / 16) * 16;
    expect(c.blocks[cidx(lx, y, lz)]).toBe(B.SUSPICIOUS_SAND);
    expect(c.blocks[cidx(lx, y - 1, lz)]).toBe(B.SANDSTONE);
  });
});
