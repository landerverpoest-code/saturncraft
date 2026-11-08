// Regression tests for the fourth QA pass (adversarial run over quests, gear, trinkets, retrofit, the Slag Colossus and the
// content added since the third pass: browser fuzzing of random blocks, items and commands, save round trips, long walks).
import { describe, it, expect } from 'vitest';
import { ITEMS, I, DISCS } from '../src/world/items.js';
import { canApply, categories } from '../src/world/enchantments.js';
import { isDisc } from '../src/player/weapons.js';
import { wearArmor } from '../src/player/armor.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { World, chunkKey } from '../src/world/world.js';
import { packChunk } from '../src/world/save.js';
import { retrofitSaved, CURRENT_FEATURE_VERSION } from '../src/world/retrofit.js';
import { QuestLog, CHAINS, generateBounties, cleanPlayer } from '../src/player/quests.js';
import { cleanTrinkets, TRINKET_KINDS, wornKinds } from '../src/player/trinkets.js';
import { gearTotals } from '../src/player/gear.js';
import { Inventory } from '../src/player/inventory.js';
import { ItemEntity } from '../src/entities/entities.js';
import { lodestonePull } from '../src/player/magnet.js';
import { MockWorld, rng } from './helpers.js';

const st = (id, extra = {}) => ({ id, count: 1, damage: 0, ...extra });
const firstItem = (pred) => ITEMS.find((d) => d && pred(d));

describe('Music Discs and Returning Discs share a word but not a meaning', () => {
  // Item.disc is a Music Disc's tune; the thrown weapon was also flagged `disc`, so right-clicking a Music Disc threw
  // it (and crashed reading weapon.material), a Returning Disc put in a Jukebox set a NaN record, and a Music Disc could be enchanted.
  it('only the thrown weapon counts as a Returning Disc', () => {
    expect(DISCS.length).toBeGreaterThan(0);
    for (const id of DISCS) { expect(isDisc(st(id))).toBe(false); expect(typeof ITEMS[id].disc).toBe('object'); }
    for (const id of [I.IRON_DISC, I.DIAMOND_DISC]) { expect(isDisc(st(id))).toBe(true); expect(ITEMS[id].disc).toBeUndefined(); }
    expect(isDisc(null)).toBe(false);
  });
  it('a Music Disc takes no enchantments, a Returning Disc still takes Farflight', () => {
    for (const id of DISCS) { expect(categories(id)).not.toContain('disc'); expect(canApply('farflight', id, true)).toBe(false); }
    expect(canApply('farflight', I.IRON_DISC)).toBe(true);
  });
});

describe('worn armour wear', () => {
  it('skips a stack that is not armour instead of throwing (an item from another version in an armour slot)', () => {
    const armor = [st(I.STICK), null, null, null];
    expect(() => wearArmor(armor, 8)).not.toThrow();
    expect(armor[0]).not.toBe(null);
    expect(() => wearArmor([{ id: 999999, count: 1 }, null, null, null], 8)).not.toThrow();
  });
});

describe('/retrofit and the saved copy of a chunk it did not change', () => {
  // A chunk with nothing to place kept its remembered pack, which still carries the old feature version: the world
  // was saved as "up to date" while those chunks said otherwise, and every later /retrofit looked at them again.
  it('writes the current feature version for every chunk it visited', () => {
    const gen = new TerrainGenerator(777);
    const w = new World(777);
    w.gen = gen;
    const fresh = gen.generate(2, 3); // made with every pass, so nothing is left to place
    const old = { ...fresh, light: new Uint8Array(fresh.blocks.length), fv: 0, modified: true, rev: 5, packRev: 5, packCache: { stale: true, fv: 0 } };
    w.saved.set(chunkKey(2, 3), old);
    const r = retrofitSaved(w, { dryRun: false });
    expect(r.scanned).toBe(1);
    const c = w.saved.get(chunkKey(2, 3));
    expect(packChunk(c).fv).toBe(CURRENT_FEATURE_VERSION);
    expect(retrofitSaved(w, { dryRun: false }).scanned).toBe(0);
  }, 120000);
});

describe('quest records survive a save and a load, and bad data', () => {
  const key = '432,89';
  function busyLog(seed) {
    const r = rng(seed), log = new QuestLog();
    for (let day = 0; day < 3; day++) {
      for (const b of generateBounties(seed, day, key, { biome: 'plains', others: [{ key: '10,10', name: 'Far', dist: 300 }], structs: [{ kind: 'temple', dist: 200 }] })) {
        if (r() < 0.7) log.accept(r() < 0.5 ? '*' : 'wolves', b, day);
      }
    }
    for (const g of Object.keys(log.groups)) for (const e of log.groups[g].active) {
      if (r() < 0.5) log.apply(g, { type: e.kind === 'slay' ? 'kill' : e.kind, mob: e.target, id: e.target, n: 5, biome: e.target, landmark: e.target }, 'Ana');
      if (e.kind === 'deliver') log.handIn(g, e.id, 3, 'Bo');
    }
    for (const c of CHAINS) if (r() < 0.8) { log.startChain('Ana', c.id); log.storyApply('Ana', { type: 'kill', mob: 'shambler', n: 3 }); }
    return log;
  }
  const norm = (o) => JSON.stringify(o, (k, v) => (k === 'rev' ? undefined : v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

  it('saves, loads and saves the same state, for many random logs', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const a = busyLog(seed), saved = a.save(), b = new QuestLog();
      b.load(JSON.parse(JSON.stringify(saved)));
      expect(norm(b.save())).toBe(norm(saved));
    }
  });
  it('loads anything without throwing, and keeps nothing it cannot vouch for', () => {
    const junk = [null, undefined, 5, 'x', [], {}, { groups: 5, players: [] }, { groups: { '*': { active: [null, 1, { kind: 'slay' }, { kind: 'gather', id: 'a', target: 99999999 }], turned: { a: 'x', b: NaN } } }, players: { Ana: { bounties: -4, chains: { frost: { step: 99, p: -1 } }, claimed: 5 } } }];
    for (const j of junk) { const l = new QuestLog(); expect(() => l.load(j)).not.toThrow(); expect(() => l.save()).not.toThrow(); }
    const p = cleanPlayer({ bounties: 1e12, chains: Object.fromEntries(CHAINS.map((c) => [c.id, { step: 1e9, p: 1e9, ready: 'yes' }])) });
    expect(p.bounties).toBeLessThanOrEqual(1e6);
    for (const c of CHAINS) { const s = p.chains[c.id]; expect(s.step).toBeLessThan(c.steps.length); expect(s.p).toBeLessThanOrEqual(c.steps[s.step].n); }
  });
});

describe('trinkets', () => {
  const ids = () => TRINKET_KINDS.map((k) => firstItem((d) => d.trinket === k).id);
  it('a saved slot list comes back clean: two slots, trinkets only, one each', () => {
    const t = ids();
    expect(cleanTrinkets([st(t[0], { count: 40 }), st(I.STICK)])).toEqual([{ id: t[0], count: 1, damage: 0 }, null]);
    expect(cleanTrinkets(null)).toEqual([null, null]);
    expect(cleanTrinkets([null, st(t[1]), st(t[2])])).toEqual([null, { id: t[1], count: 1, damage: 0 }]);
    expect(cleanTrinkets('abc')).toEqual([null, null]);
    expect(cleanTrinkets([{ id: 'x' }, { id: NaN }])).toEqual([null, null]);
  });
  it('a kind counts once however it is worn, and the totals stay within their caps', () => {
    const t = ids();
    const a = st(t[0]);
    expect(wornKinds([a, { ...a }])).toEqual([TRINKET_KINDS[0]]);
    const all = gearTotals([null, null, null, null], t.map((id) => st(id)));
    for (const v of Object.values(all)) expect(Number.isFinite(v)).toBe(true);
    expect(all.ward).toBeLessThanOrEqual(0.5);
    expect(gearTotals([], [])).toEqual(gearTotals(null, null));
  });
  it('clearing an inventory (death) empties the trinket slots too', () => {
    const inv = new Inventory();
    inv.trinkets[0] = st(ids()[0]);
    inv.clear();
    expect(inv.trinkets).toEqual([null, null]);
  });
});

describe('the Lodestone Charm and resting items', () => {
  it('pulls a sleeping item towards the wearer', () => {
    const world = new MockWorld(64);
    const e = new ItemEntity(5.5, 64, 0.5, st(I.BERYL));
    e.pickupDelay = 0; e.rest = 100; // asleep
    const game = { player: { x: 0.5, y: 64, z: 0.5, dead: false }, net: null, entities: { list: [e] }, ticks: 0, world };
    const x0 = e.x;
    for (let t = 0; t < 40; t++) { game.ticks = t; if (t % 2 === 0) lodestonePull(game, 6); e.tick(game); }
    expect(e.x).toBeLessThan(x0);
  });
});
