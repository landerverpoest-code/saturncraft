// Regression tests for bugs found in the second play-through QA pass (browser-driven, seed 42).
import { describe, it, expect, afterEach } from 'vitest';
import { B, BLOCKS } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import { Inventory } from '../src/player/inventory.js';
import { makeTrades, affordableTimes, canTrade, doTrade, MAX_USES } from '../src/mobs/trades.js';

/** A canvas that swallows every drawing call (the icon code only needs it not to throw). */
function stubDocument() {
  const ctx = new Proxy({}, {
    get: (t, k) => (k === 'createImageData' || k === 'getImageData' ? (...a) => { const w = a.length > 3 ? a[2] : a[0], h = a.length > 3 ? a[3] : a[1]; return { data: new Uint8ClampedArray(w * h * 4) }; } : k in t ? t[k] : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:' }) };
}

describe('inventory icons', () => {
  const saved = globalThis.document;
  afterEach(() => { globalThis.document = saved; });

  // The plate icon read `tex.all`, which def() has already expanded into top / side / bottom, so every pressure plate
  // (and weighted plate) crashed the hotbar, the inventory and the held-item overlay as soon as one was in view.
  it('draws every item and block icon without throwing', async () => {
    globalThis.document = stubDocument();
    const { itemCanvas } = await import('../src/ui/icons.js');
    const failed = [];
    for (const id of Object.keys(ITEMS).map(Number)) {
      try { itemCanvas(id); } catch (e) { failed.push(`${ITEMS[id].name}: ${e.message}`); }
    }
    expect(failed).toEqual([]);
  });

  it('draws the pressure and weighted plates from their own texture', async () => {
    globalThis.document = stubDocument();
    const { itemCanvas } = await import('../src/ui/icons.js');
    for (const id of [B.WOODEN_PRESSURE_PLATE, B.STONE_PRESSURE_PLATE, B.LIGHT_WEIGHTED_PLATE, B.HEAVY_WEIGHTED_PLATE]) {
      expect(typeof BLOCKS[id].tex.top).toBe('string');
      expect(BLOCKS[id].tex.all).toBeUndefined();
      expect(() => itemCanvas(id)).not.toThrow();
    }
  });
});

describe('guest trading', () => {
  const offer = (give, giveCount) => ({ give, giveCount, get: I.BREAD, getCount: 1, uses: 0 });
  const inv = (id, n) => { const i = new Inventory(); i.add({ id, count: n, damage: 0 }); return i; };

  // A guest's shift-click asked the host for 64 trades; the host counted every one as used (up to the 12 the offer
  // allows) while the guest could pay for only a few, so the offer sold out for goods that were never delivered.
  it('asks the host only for trades the guest can pay for', () => {
    expect(affordableTimes(offer(I.BERYL, 11), inv(I.BERYL, 21), 0, 64)).toBe(1);
    expect(affordableTimes(offer(I.BERYL, 1), inv(I.BERYL, 5), 0, 64)).toBe(5);
    expect(affordableTimes(offer(I.BERYL, 1), inv(I.BERYL, 50), 0, 64)).toBe(MAX_USES);
    expect(affordableTimes(offer(I.BERYL, 1), inv(I.BERYL, 50), 0, 1)).toBe(1);
  });

  it('is zero when nothing can be bought', () => {
    expect(affordableTimes(offer(I.BERYL, 3), inv(I.BERYL, 2), 0, 64)).toBe(0);
    expect(affordableTimes(offer(I.BERYL, 3), new Inventory(), 0, 64)).toBe(0);
    const used = offer(I.BERYL, 1); used.uses = MAX_USES;
    expect(affordableTimes(used, inv(I.BERYL, 9), 0, 64)).toBe(0);
  });

  it('counts the discount into the price and matches how many times doTrade succeeds', () => {
    for (const cut of [0, 0.3, 0.5]) {
      for (const [price, have] of [[4, 21], [10, 95], [1, 7], [2, 3]]) {
        const o = offer(I.BERYL, price), bag = inv(I.BERYL, have);
        const want = affordableTimes(o, bag, cut, 64);
        let done = 0;
        while (canTrade(o, bag, cut) && done < 64) { doTrade(o, bag, cut); done++; }
        expect(done).toBe(want);
      }
    }
  });

  it('works for every offer a cartographer or peddler can roll', () => {
    for (const prof of ['cartographer', 'peddler']) {
      for (let s = 0; s < 30; s++) {
        for (const o of makeTrades(prof, () => Math.random())) {
          const n = affordableTimes(o, inv(o.give, 64), 0, 64);
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(MAX_USES);
        }
      }
    }
  });
});
