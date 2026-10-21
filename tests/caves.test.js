import { describe, it, expect } from 'vitest';
import { B, BLOCKS } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { MockWorld, rng } from './helpers.js';
import {
  COPPER_STAGES, WAXED_STAGES, OXIDATION_TICK_CHANCE, oxidationChance, tickCopper, waxCopper, scrapeCopper, copperStage,
  lightningCleanCopper, findStormRod, BUD_STAGES, BUD_GROW_CHANCE, nextBud, tickBudding, geodeLayer, geodeIn, GEODE_CHANCE,
  GEODE_MIN_Y, GEODE_MAX_Y, spikeThickness, SPIKE_TIP, SPIKE_FRUSTUM, SPIKE_MIDDLE, SPIKE_BASE, stalactiteDamage,
  stalagmiteFallDamage, spikeMeta, FACING_DOWN, FACING_UP, updateSpike, crystalBox, cavePlaceMeta, isStalagmiteTip,
} from '../src/world/caves.js';
import { stampGeode } from '../src/world/caveGen.js';
import { ORE_FEATURES, sampleOreHeight, TerrainGenerator } from '../src/world/generator.js';
import { blockDrops } from '../src/world/mining.js';
import { craft, SMELTING } from '../src/player/crafting.js';
import { CHUNK_VOLUME, cidx } from '../src/world/constants.js';

class World extends MockWorld {
  constructor() { super(0); this.changes = []; }
  setBlock(x, y, z, id, meta = 0) { this.set(x, y, z, id, meta); this.changes.push([x, y, z, id]); return true; }
  breakBlock(x, y, z) { this.setBlock(x, y, z, B.AIR); }
}
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

describe('copper weathering', () => {
  it('ages with the reference odds', () => {
    expect(OXIDATION_TICK_CHANCE).toBeCloseTo(1 / 17.58, 3);
    expect(oxidationChance(0, [])).toBe(0.75);
    expect(oxidationChance(1, [])).toBe(1);
    expect(oxidationChance(3, [])).toBe(0);
    expect(oxidationChance(1, [0])).toBe(0); // a fresher neighbour holds it back
    expect(oxidationChance(1, [1, 1, 1])).toBeCloseTo(1 / 16);
    expect(oxidationChance(1, [2, 1])).toBeCloseTo((2 / 3) ** 2);
    expect(oxidationChance(0, [3, 3, 3])).toBeCloseTo(0.75);
  });
  it('a lone block steps through the four stages on random ticks', () => {
    const w = new World(), r = rng(3);
    w.setBlock(0, 10, 0, B.COPPER_BLOCK);
    let ticks = 0;
    while (w.getBlock(0, 10, 0) !== B.VERDIGRIS_COPPER && ticks < 1e6) { tickCopper(w, 0, 10, 0, w.getBlock(0, 10, 0), r); ticks++; }
    expect(w.getBlock(0, 10, 0)).toBe(B.VERDIGRIS_COPPER);
    // expected 1/(p*0.75) + 2/p ticks ~ 58.6 per stage on average
    expect(ticks).toBeGreaterThan(20);
    expect(ticks).toBeLessThan(2000);
    expect(tickCopper(w, 0, 10, 0, B.VERDIGRIS_COPPER, () => 0)).toBe(false);
  });
  it('sealed copper never ages; neighbours slow it down', () => {
    const w = new World();
    w.setBlock(0, 10, 0, B.WAXED_COPPER_BLOCK);
    expect(tickCopper(w, 0, 10, 0, B.WAXED_COPPER_BLOCK, () => 0)).toBe(false);
    w.setBlock(5, 10, 0, B.DULLED_COPPER); w.setBlock(6, 10, 0, B.COPPER_BLOCK);
    expect(tickCopper(w, 5, 10, 0, B.DULLED_COPPER, seq(0, 0.99))).toBe(false); // the fresh neighbour blocks it
  });
  it('honeycomb seals, an axe removes the seal then scrapes', () => {
    COPPER_STAGES.forEach((id, k) => { expect(waxCopper(id)).toBe(WAXED_STAGES[k]); expect(copperStage(WAXED_STAGES[k])).toBe(k); });
    expect(waxCopper(B.WAXED_COPPER_BLOCK)).toBe(null);
    expect(scrapeCopper(B.WAXED_TARNISHED_COPPER)).toBe(B.TARNISHED_COPPER);
    expect(scrapeCopper(B.VERDIGRIS_COPPER)).toBe(B.TARNISHED_COPPER);
    expect(scrapeCopper(B.DULLED_COPPER)).toBe(B.COPPER_BLOCK);
    expect(scrapeCopper(B.COPPER_BLOCK)).toBe(null);
  });
  it('lightning cleans the copper under a Storm Rod', () => {
    const w = new World();
    for (let x = -2; x <= 2; x++) w.setBlock(x, 10, 0, B.VERDIGRIS_COPPER);
    w.setBlock(0, 11, 0, B.STORM_ROD, 0);
    expect(lightningCleanCopper(w, 0, 11, 0, rng(5))).toBeGreaterThan(0);
    expect(w.getBlock(0, 10, 0)).toBe(B.COPPER_BLOCK);
    const sealed = new World(); sealed.setBlock(0, 10, 0, B.WAXED_VERDIGRIS_COPPER);
    expect(lightningCleanCopper(sealed, 0, 10, 0, rng(5))).toBe(0);
  });
  it('Storm Rods draw bolts within 128 blocks when they see the sky', () => {
    const chunk = (cx, cz) => ({ cx, cz, blocks: new Uint8Array(CHUNK_VOLUME) });
    const c = chunk(6, 0); c.blocks[cidx(4, 80, 4)] = B.STORM_ROD;
    const w = { getChunk: (cx, cz) => (cx === 6 && cz === 0 ? c : null), heightAt: (x, z) => (x === 100 && z === 4 ? 80 : 60) };
    expect(findStormRod(w, 0, 0)).toEqual([100, 80, 4]);
    expect(findStormRod(w, -40, 0)).toBe(null); // 140 blocks away
    const roofed = { ...w, heightAt: () => 90 };
    expect(findStormRod(roofed, 0, 0)).toBe(null);
    expect(craft([I.COPPER_INGOT, null, null, I.COPPER_INGOT, null, null, I.COPPER_INGOT, null, null].map((id) => id && { id, count: 1 }), 3)).toEqual({ id: B.STORM_ROD, count: 1 });
  });
  it('copper recipes and smelting', () => {
    const nine = Array(9).fill({ id: I.COPPER_INGOT, count: 1 });
    expect(craft(nine, 3)).toEqual({ id: B.COPPER_BLOCK, count: 1 });
    expect(craft([{ id: B.COPPER_BLOCK, count: 1 }, null, null, null], 2)).toEqual({ id: I.COPPER_INGOT, count: 9 });
    expect(craft([{ id: B.DULLED_COPPER, count: 1 }, { id: I.HONEYCOMB, count: 1 }, null, null], 2)).toEqual({ id: B.WAXED_DULLED_COPPER, count: 1 });
    expect(SMELTING[I.RAW_COPPER]).toBe(I.COPPER_INGOT);
  });
});

describe('copper ore', () => {
  it('uses the reference distribution', () => {
    const f = ORE_FEATURES.find((o) => o.block === B.COPPER_ORE);
    expect(f).toMatchObject({ count: 16, dist: 'triangle', min: -16, max: 112, size: 10 });
    const r = rng(9), hist = new Map();
    for (let k = 0; k < 20000; k++) {
      const y = sampleOreHeight(f, r);
      expect(y).toBeGreaterThanOrEqual(-16); expect(y).toBeLessThanOrEqual(112);
      hist.set(y >> 4, (hist.get(y >> 4) || 0) + 1);
    }
    expect(hist.get(3)).toBeGreaterThan(hist.get(-1) * 3); // peaks around y 48
  });
  it('drops 2-5 raw copper', () => {
    const tool = { type: 'pickaxe', tier: 1, speed: 4 };
    for (let k = 0; k < 50; k++) { const [d] = blockDrops(B.COPPER_ORE, tool); expect(d.id).toBe(I.RAW_COPPER); expect(d.count).toBeGreaterThanOrEqual(2); expect(d.count).toBeLessThanOrEqual(5); }
  });
});

describe('Violite geodes and buds', () => {
  it('buds grow small -> medium -> large -> cluster only along their facing', () => {
    expect(BUD_GROW_CHANCE).toBe(0.2);
    expect(nextBud(B.AIR, 0, 3)).toBe(B.SMALL_VIOLITE_BUD);
    expect(nextBud(B.WATER, 0, 3)).toBe(B.SMALL_VIOLITE_BUD);
    expect(nextBud(B.WATER, 2, 3)).toBe(null); // flowing water
    expect(nextBud(B.SMALL_VIOLITE_BUD, 3, 3)).toBe(B.MEDIUM_VIOLITE_BUD);
    expect(nextBud(B.LARGE_VIOLITE_BUD, 3, 3)).toBe(B.VIOLITE_CLUSTER);
    expect(nextBud(B.SMALL_VIOLITE_BUD, 2, 3)).toBe(null);
    expect(nextBud(B.VIOLITE_CLUSTER, 3, 3)).toBe(null);
    expect(nextBud(B.STONE, 0, 3)).toBe(null);
  });
  it('a budding block in the open grows a full cluster', () => {
    const w = new World(), r = rng(11);
    w.setBlock(0, 20, 0, B.BUDDING_VIOLITE);
    let n = 0;
    while (!BUD_STAGES.slice(3).includes(w.getBlock(0, 21, 0)) && n < 1e5) { tickBudding(w, 0, 20, 0, r); n++; }
    expect(w.getBlock(0, 21, 0)).toBe(B.VIOLITE_CLUSTER);
    expect(w.getMeta(0, 21, 0)).toBe(FACING_UP);
    expect(n).toBeGreaterThan(20); // 4 stages, 1/5 x 1/6 each: about 120 ticks
  });
  it('clusters drop 4 shards with a pickaxe, 2 otherwise; buds nothing', () => {
    expect(blockDrops(B.VIOLITE_CLUSTER, { type: 'pickaxe', tier: 0, speed: 2 })).toEqual([{ id: I.VIOLITE_SHARD, count: 4 }]);
    expect(blockDrops(B.VIOLITE_CLUSTER)).toEqual([{ id: I.VIOLITE_SHARD, count: 2 }]);
    expect(blockDrops(B.LARGE_VIOLITE_BUD, { type: 'pickaxe', tier: 3, speed: 8 })).toEqual([]);
    expect(blockDrops(B.BUDDING_VIOLITE, { type: 'pickaxe', tier: 3, speed: 8 }, Math.random, 0, { gentle_hand: 1 })).toEqual([]);
  });
  it('bud shapes grow and turn with their facing', () => {
    const h = (id) => crystalBox(id, FACING_UP)[4];
    expect(h(B.SMALL_VIOLITE_BUD)).toBeLessThan(h(B.MEDIUM_VIOLITE_BUD));
    expect(h(B.LARGE_VIOLITE_BUD)).toBeLessThan(h(B.VIOLITE_CLUSTER));
    expect(crystalBox(B.VIOLITE_CLUSTER, FACING_DOWN)[1]).toBeCloseTo(1 - 7 / 16);
    expect(crystalBox(B.VIOLITE_CLUSTER, 5)[3]).toBeCloseTo(7 / 16); // pointing +x from the -x wall
    expect(cavePlaceMeta(new World(), 0, 5, 0, B.SMALL_VIOLITE_BUD, [-1, 0, 0])).toBe(4);
  });
  it('geodes: about 1 in 24 chunks, between y -58 and 30', () => {
    let n = 0;
    for (let cx = 0; cx < 120; cx++) for (let cz = 0; cz < 120; cz++) {
      const g = geodeIn(42, cx, cz);
      if (!g) continue;
      n++;
      expect(g.y).toBeGreaterThanOrEqual(GEODE_MIN_Y); expect(g.y).toBeLessThanOrEqual(GEODE_MAX_Y);
      expect(g.x >> 4).toBe(cx); expect(g.z >> 4).toBe(cz);
    }
    expect(n / 14400).toBeCloseTo(GEODE_CHANCE, 2);
  });
  it('geode layers: hollow, violite lining, chalkstone, smooth basalt', () => {
    const order = [0, 2, 3.5, 4.5, 5.5, 6, 7].map(geodeLayer);
    expect(order).toEqual([4, 4, 3, 2, 1, 1, 0]);
    const blocks = new Uint8Array(CHUNK_VOLUME).fill(B.STONE), meta = new Uint8Array(CHUNK_VOLUME);
    const g = { x: 8, y: 0, z: 8, scale: 1 };
    stampGeode(7, blocks, meta, 0, 0, g);
    expect(blocks[cidx(8, 0, 8)]).toBe(B.AIR);
    const count = {};
    for (let i = 0; i < CHUNK_VOLUME; i++) count[blocks[i]] = (count[blocks[i]] || 0) + 1;
    expect(count[B.SMOOTH_BASALT]).toBeGreaterThan(count[B.CHALKSTONE]);
    expect(count[B.CHALKSTONE]).toBeGreaterThan(count[B.VIOLITE_BLOCK]);
    const lining = count[B.VIOLITE_BLOCK] + count[B.BUDDING_VIOLITE];
    expect(count[B.BUDDING_VIOLITE] / lining).toBeGreaterThan(0.03);
    expect(count[B.BUDDING_VIOLITE] / lining).toBeLessThan(0.16);
    // walking out from the centre the layers never go back inwards
    const rank = { [B.AIR]: 4, [B.VIOLITE_BLOCK]: 3, [B.BUDDING_VIOLITE]: 3, [B.CHALKSTONE]: 2, [B.SMOOTH_BASALT]: 1, [B.STONE]: 0 };
    let last = 5;
    for (let x = 8; x < 16; x++) { const b = blocks[cidx(x, 0, 8)]; const rk = BUD_STAGES.includes(b) ? 4 : rank[b]; expect(rk).toBeLessThanOrEqual(last); last = rk; }
    // buds sit in the hollow, pointing away from a budding block
    let buds = 0;
    for (let i = 0; i < CHUNK_VOLUME; i++) if (BUD_STAGES.includes(blocks[i])) buds++;
    expect(buds).toBeGreaterThan(0);
  });
  it('a world chunk with a geode contains it (deterministic)', () => {
    const seed = 7;
    let found = null;
    for (let cx = -20; cx < 20 && !found; cx++) for (let cz = -20; cz < 20 && !found; cz++) {
      const g = geodeIn(seed, cx, cz);
      if (g && g.y < -10) found = [cx, cz];
    }
    expect(found).not.toBe(null);
    const a = new TerrainGenerator(seed).generate(...found), b = new TerrainGenerator(seed).generate(...found);
    expect(a.blocks).toEqual(b.blocks);
    expect(a.blocks.includes(B.VIOLITE_BLOCK) || a.blocks.includes(B.BUDDING_VIOLITE)).toBe(true);
  });
  it('shaded glass blocks light; Farglass recipe', () => {
    expect(BLOCKS[B.SHADED_GLASS].opacity).toBe(15);
    const S = I.VIOLITE_SHARD, C = I.COPPER_INGOT;
    expect(craft([S, null, null, C, null, null, C, null, null].map((id) => id && { id, count: 1 }), 3)).toEqual({ id: I.FARGLASS, count: 1 });
    expect(craft([null, S, null, S, B.GLASS, S, null, S, null].map((id) => id && { id, count: 1 }), 3)).toEqual({ id: B.SHADED_GLASS, count: 2 });
  });
});

describe('Seepstone spikes', () => {
  it('thickness from the neighbours', () => {
    expect(spikeThickness(false, false, true)).toBe(SPIKE_TIP);
    expect(spikeThickness(true, false, true)).toBe(SPIKE_FRUSTUM);
    expect(spikeThickness(true, true, true)).toBe(SPIKE_MIDDLE);
    expect(spikeThickness(true, true, false)).toBe(SPIKE_BASE);
  });
  it('falling and landing damage', () => {
    expect(stalactiteDamage(0.5, 2)).toBe(0);
    expect(stalactiteDamage(1.5, 2)).toBe(6);
    expect(stalactiteDamage(10, 2)).toBe(6);
    expect(stalactiteDamage(10, 9)).toBe(9);
    expect(stalagmiteFallDamage(0)).toBe(0);
    expect(stalagmiteFallDamage(1.2)).toBe(2);
    expect(stalagmiteFallDamage(5)).toBe(8);
  });
  it('a hanging spike falls as a whole when its ceiling goes', () => {
    const w = new World();
    w.setBlock(0, 30, 0, B.STONE);
    for (let k = 1; k <= 3; k++) w.setBlock(0, 30 - k, 0, B.SEEPSTONE_SPIKE, spikeMeta(FACING_DOWN, 0));
    let fell = null;
    w.onStalactiteFall = (parts) => { fell = parts; };
    updateSpike(w, 0, 29, 0);
    expect(fell).toBe(null); // still supported: thickness refreshed
    expect((w.getMeta(0, 29, 0) >> 3) & 3).toBe(SPIKE_BASE);
    w.setBlock(0, 30, 0, B.AIR);
    updateSpike(w, 0, 29, 0);
    expect(fell.length).toBe(3);
    expect(w.getBlock(0, 27, 0)).toBe(B.AIR);
  });
  it('standing spikes need a floor; only the point is a stalagmite tip', () => {
    const w = new World();
    w.setBlock(0, 1, 0, B.SEEPSTONE_SPIKE, spikeMeta(FACING_UP, SPIKE_FRUSTUM));
    w.setBlock(0, 2, 0, B.SEEPSTONE_SPIKE, spikeMeta(FACING_UP, SPIKE_TIP));
    expect(isStalagmiteTip(w, 0, 2, 0)).toBe(true);
    expect(isStalagmiteTip(w, 0, 1, 0)).toBe(false);
    expect(cavePlaceMeta(w, 0, 3, 0, B.SEEPSTONE_SPIKE, [0, 1, 0])).toBe(spikeMeta(FACING_UP, SPIKE_TIP));
    expect(cavePlaceMeta(w, 5, 3, 0, B.SEEPSTONE_SPIKE, [1, 0, 0])).toBe(-1);
  });
});
