import { describe, it, expect } from 'vitest';
import {
  ENCHANTS, offerCost, countBookshelves, availableEnchants, weightedPick, selectEnchantments, tableOffers, rollOffer, applyOffer,
  enchantability, canStack, sameEnch, cleanEnch, durabilityLoss, bountyCount, meleeBonus, protectionFactor, protectionReduce,
  arrowDamage, anvilCombine, isEnchantable, compatible, swiftdigBonus,
} from '../src/world/enchantments.js';
import { breakTicks, blockDrops } from '../src/world/mining.js';
import { B } from '../src/world/blocks.js';
import { ITEMS, I } from '../src/world/items.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import { rollDrops } from '../src/mobs/drops.js';
import { Inventory } from '../src/player/inventory.js';
import { copyStack, sameStack, packEntity, unpackEntity } from '../src/net/protocol.js';
import { newXp, addXp, spendLevels } from '../src/player/experience.js';
import { MockWorld, rng as seeded } from './helpers.js';

const tool = (key) => ITEMS[I[key.toUpperCase()]].tool;
const fixed = (v) => () => v;

describe('enchanting table level costs', () => {
  it('follow the reference formula', () => {
    // rng 0.999: nextInt(8) = 7, nextInt(16) = 15 -> base = 8 + 7 + 15 = 30 with 15 shelves
    expect(offerCost(fixed(0.999), 0, 15)).toBe(10);
    expect(offerCost(fixed(0.999), 1, 15)).toBe(21);
    expect(offerCost(fixed(0.999), 2, 15)).toBe(30);
    // rng 0, no shelves: base 1 -> top 1, middle 1 (< 2: no offer), bottom 1 (< 3: no offer)
    expect(offerCost(fixed(0), 0, 0)).toBe(1);
    expect(offerCost(fixed(0), 1, 0)).toBe(0);
    expect(offerCost(fixed(0), 2, 0)).toBe(0);
  });
  it('max out at 30 with 15 or more bookshelves', () => {
    const r = seeded(7);
    for (let k = 0; k < 500; k++) {
      expect(offerCost(r, 2, 15)).toBe(30);
      expect(offerCost(r, 2, 40)).toBe(30); // capped at 15 shelves
      const top = offerCost(r, 0, 15);
      expect(top).toBeGreaterThanOrEqual(2); expect(top).toBeLessThanOrEqual(10);
    }
  });
  it('stay at 1..8 without bookshelves', () => {
    const r = seeded(3);
    for (let k = 0; k < 500; k++) { const c = offerCost(r, 2, 0); expect(c === 0 || (c >= 3 && c <= 8)).toBe(true); }
  });
  it('count bookshelves in the 2-block ring with air in between', () => {
    const w = new MockWorld(64);
    const get = (x, y, z) => w.getBlock(x, y, z);
    w.set(0, 64, 0, B.ENCHANTING_TABLE);
    expect(countBookshelves(get, 0, 64, 0)).toBe(0);
    // a full ring of 16 at table height and 16 one above = 32 positions
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
      w.set(dx, 64, dz, B.BOOKSHELF); w.set(dx, 65, dz, B.BOOKSHELF);
    }
    expect(countBookshelves(get, 0, 64, 0)).toBe(32);
    // a torch between the table and a shelf blocks it (and its diagonal neighbour that shares the gap)
    w.set(1, 64, 0, B.TORCH);
    expect(countBookshelves(get, 0, 64, 0)).toBe(29);
    // a shelf right next to the table does not count
    const w2 = new MockWorld(64);
    w2.set(1, 64, 0, B.BOOKSHELF);
    expect(countBookshelves((x, y, z) => w2.getBlock(x, y, z), 0, 64, 0)).toBe(0);
  });
});

describe('enchantment selection', () => {
  it('uses material enchantability', () => {
    expect(enchantability(I.GOLD_SWORD)).toBe(22);
    expect(enchantability(I.STONE_PICKAXE)).toBe(5);
    expect(enchantability(I.DIAMOND_CHESTPLATE)).toBe(10);
    expect(enchantability(I.LEATHER_BOOTS)).toBe(15);
    expect(enchantability(I.BOOK)).toBe(1);
    expect(enchantability(I.STICK)).toBe(0);
  });
  it('picks the highest level whose cost window fits', () => {
    const at = (id, lvl) => Object.fromEntries(availableEnchants(id, lvl));
    expect(at(I.DIAMOND_SWORD, 30).keen).toBe(3); // 23..43
    expect(at(I.DIAMOND_SWORD, 1).keen).toBe(1);
    expect(at(I.DIAMOND_SWORD, 1).plunder).toBeUndefined();
    expect(at(I.DIAMOND_PICKAXE, 30).swiftdig).toBe(3);
    expect(at(I.DIAMOND_PICKAXE, 30).gentle_hand).toBe(1);
    expect(at(I.DIAMOND_BOOTS, 25).featherstep).toBe(4); // 23..29 (narrow windows, as in the reference)
    expect(at(I.DIAMOND_HELMET, 25).featherstep).toBeUndefined(); // boots only
    expect(at(I.BOW, 25).endless).toBe(1);
    expect(at(I.BOOK, 30).keen).toBe(3); // books can roll anything
  });
  it('weights picks by rarity', () => {
    const r = seeded(11), n = { keen: 0, hallowed: 0, emberbrand: 0 };
    for (let k = 0; k < 17000; k++) n[weightedPick(r, [['keen', 1], ['hallowed', 1], ['emberbrand', 1]])[0]]++;
    expect(n.keen / 17000).toBeCloseTo(10 / 17, 1);
    expect(n.hallowed / 17000).toBeCloseTo(5 / 17, 1);
    expect(n.emberbrand / 17000).toBeCloseTo(2 / 17, 1);
  });
  it('never combines exclusive enchantments, and gold rolls more of them', () => {
    const r = seeded(5);
    let gold = 0, stone = 0;
    for (let k = 0; k < 3000; k++) {
      const list = selectEnchantments(r, I.GOLD_PICKAXE, 30);
      gold += list.length;
      const keys = list.map(([key]) => key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.includes('gentle_hand') && keys.includes('bounty')).toBe(false);
      for (const [key, l] of list) { expect(l).toBeGreaterThanOrEqual(1); expect(l).toBeLessThanOrEqual(ENCHANTS[key].max); }
      stone += selectEnchantments(r, I.STONE_PICKAXE, 30).length;
    }
    expect(gold).toBeGreaterThan(stone);
    expect(compatible('keen', 'hallowed')).toBe(false);
    expect(compatible('keen', 'plunder')).toBe(true);
  });
  it('gives three stable offers and turns books into enchanted books', () => {
    const a = tableOffers(I.IRON_SWORD, 1234, 15), b = tableOffers(I.IRON_SWORD, 1234, 15);
    expect(a).toEqual(b);
    expect(a[2].cost).toBe(30);
    expect(a.every((o) => o && o.ench.length > 0)).toBe(true);
    for (const o of a) expect(o.ench.some(([k, l]) => k === o.hint[0] && l === o.hint[1])).toBe(true);
    const list = rollOffer(I.BOOK, 99, 2, 30);
    expect(list.length).toBeGreaterThanOrEqual(1);
    const st = applyOffer({ id: I.BOOK, count: 1 }, list);
    expect(st.id).toBe(I.ENCHANTED_BOOK);
    expect(Object.keys(st.ench).length).toBe(list.length);
    expect(isEnchantable(st)).toBe(false);
    expect(isEnchantable({ id: I.IRON_SWORD, count: 1 })).toBe(true);
    expect(isEnchantable({ id: I.STICK, count: 1 })).toBe(false);
  });
});

describe('enchantment effects', () => {
  it('Swiftdig speeds up mining with the right tool only', () => {
    const pick = tool('diamond_pickaxe');
    expect(breakTicks(B.STONE, pick)).toBe(6);
    expect(breakTicks(B.STONE, pick, { swiftdig: 1 })).toBe(5); // speed 8 + 2
    expect(breakTicks(B.STONE, pick, { swiftdig: 5 })).toBe(2); // speed 8 + 26
    expect(swiftdigBonus(3)).toBe(10);
    // a pickaxe on logs is not the right tool: no bonus
    expect(breakTicks(B.OAK_LOG, pick, { swiftdig: 5 })).toBe(breakTicks(B.OAK_LOG, pick));
  });
  it('Keen and Hallowed add melee damage', () => {
    expect(meleeBonus({ id: I.IRON_SWORD, ench: { keen: 5 } }, null)).toBe(3);
    expect(meleeBonus({ id: I.IRON_SWORD, ench: { keen: 1 } }, null)).toBe(1);
    expect(meleeBonus({ id: I.IRON_SWORD, ench: { hallowed: 5 } }, { def: MOBS.shambler })).toBe(12.5);
    expect(meleeBonus({ id: I.IRON_SWORD, ench: { hallowed: 5 } }, { def: MOBS.fleecer })).toBe(0);
    expect(meleeBonus({ id: I.IRON_SWORD }, null)).toBe(0);
  });
  it('Steadfast spares durability with the reference chances', () => {
    const r = seeded(9), N = 20000;
    const sword = { id: I.IRON_SWORD, ench: { steadfast: 3 } }, helm = { id: I.IRON_HELMET, ench: { steadfast: 3 } };
    expect(durabilityLoss(sword, N, r) / N).toBeCloseTo(0.25, 1);
    expect(durabilityLoss(helm, N, r) / N).toBeCloseTo(0.7, 1);
    expect(durabilityLoss({ id: I.IRON_SWORD }, 7, r)).toBe(7);
    const inv = new Inventory();
    inv.slots[0] = { id: I.IRON_PICKAXE, count: 1, damage: 0, ench: { steadfast: 3 } };
    for (let k = 0; k < 400; k++) inv.damageSelected(1, r);
    expect(inv.slots[0].damage).toBeGreaterThan(60);
    expect(inv.slots[0].damage).toBeLessThan(140);
  });
  it('Bounty multiplies ore drops (Bounty III averages 2.2 diamonds)', () => {
    const r = seeded(4), pick = tool('iron_pickaxe');
    let n = 0;
    for (let k = 0; k < 10000; k++) n += blockDrops(B.DIAMOND_ORE, pick, r, 0, { bounty: 3 })[0].count;
    expect(n / 10000).toBeCloseTo(2.2, 1);
    for (let k = 0; k < 200; k++) { const c = bountyCount(1, 1, r); expect(c === 1 || c === 2).toBe(true); }
    // not for blocks that drop themselves
    expect(blockDrops(B.STONE, pick, r, 0, { bounty: 3 })).toEqual([{ id: B.COBBLESTONE, count: 1 }]);
  });
  it('Gentle Hand makes blocks drop themselves', () => {
    const pick = tool('iron_pickaxe'), shovel = tool('iron_shovel'), r = seeded(1);
    const g = { gentle_hand: 1 };
    expect(blockDrops(B.STONE, pick, r, 0, g)).toEqual([{ id: B.STONE, count: 1 }]);
    expect(blockDrops(B.DIAMOND_ORE, pick, r, 0, g)).toEqual([{ id: B.DIAMOND_ORE, count: 1 }]);
    expect(blockDrops(B.GRASS, shovel, r, 0, g)).toEqual([{ id: B.GRASS, count: 1 }]);
    expect(blockDrops(B.GLASS, pick, r, 0, g)).toEqual([{ id: B.GLASS, count: 1 }]);
    expect(blockDrops(B.BOOKSHELF, pick, r, 0, g)).toEqual([{ id: B.BOOKSHELF, count: 1 }]);
    // still needs the right harvest tier
    expect(blockDrops(B.DIAMOND_ORE, tool('stone_pickaxe'), r, 0, g)).toEqual([]);
    // crops and beds keep their normal drops
    expect(blockDrops(B.WHEAT, pick, r, 7, g).some((d) => d.id === B.WHEAT)).toBe(false);
  });
  it('Bulwark and Featherstep reduce damage, capped at 80 %', () => {
    const piece = (id, ench) => ({ id, count: 1, ench });
    const full = [piece(I.IRON_HELMET, { bulwark: 4 }), piece(I.IRON_CHESTPLATE, { bulwark: 4 }), piece(I.IRON_LEGGINGS, { bulwark: 4 }), piece(I.IRON_BOOTS, { bulwark: 4, featherstep: 4 })];
    expect(protectionFactor(full, 'mob:Shambler')).toBe(16);
    expect(protectionReduce(10, 16)).toBeCloseTo(3.6);
    expect(protectionFactor(full, 'fall')).toBe(20); // 16 + 12, capped
    expect(protectionFactor([null, null, null, piece(I.IRON_BOOTS, { featherstep: 4 })], 'fall')).toBe(12);
    expect(protectionFactor(full, 'void')).toBe(0);
  });
  it('Strongdraw adds arrow damage', () => {
    expect(arrowDamage(3, 0)).toBe(6);
    expect(arrowDamage(3, 1)).toBe(9);
    expect(arrowDamage(3, 5)).toBe(15);
  });
  it('Plunder adds mob drops', () => {
    const r = seeded(2);
    let plain = 0, looted = 0;
    for (let k = 0; k < 4000; k++) {
      plain += rollDrops('shambler', { killedByPlayer: true }, r).reduce((s, d) => s + d.count, 0);
      looted += rollDrops('shambler', { killedByPlayer: true, plunder: 3 }, r).reduce((s, d) => s + d.count, 0);
    }
    expect(looted / 4000 - plain / 4000).toBeGreaterThan(1.2);
  });
});

describe('enchanted stacks', () => {
  it('do not merge with plain or differently enchanted stacks', () => {
    expect(canStack({ id: B.STONE, count: 3 }, { id: B.STONE, count: 5 })).toBe(true);
    expect(canStack({ id: B.STONE, count: 3 }, { id: B.STONE, count: 5, ench: { keen: 1 } })).toBe(false);
    expect(canStack({ id: B.STONE, count: 3, ench: { keen: 1 } }, { id: B.STONE, count: 5, ench: { keen: 1 } })).toBe(true);
    expect(canStack({ id: B.STONE, count: 3, ench: { keen: 1 } }, { id: B.STONE, count: 5, ench: { keen: 2 } })).toBe(false);
    expect(canStack({ id: I.IRON_SWORD, count: 1 }, { id: I.IRON_SWORD, count: 1 })).toBe(false);
    expect(sameEnch(null, {})).toBe(true);
    expect(sameEnch({ keen: 1, plunder: 2 }, { plunder: 2, keen: 1 })).toBe(true);
  });
  it('keep their enchantments in the inventory', () => {
    const inv = new Inventory();
    inv.add({ id: B.STONE, count: 10 });
    inv.add({ id: B.STONE, count: 10, ench: { swiftdig: 1 } });
    expect(inv.slots[0].count).toBe(10);
    expect(inv.slots[1].ench).toEqual({ swiftdig: 1 });
    inv.add({ id: I.ENCHANTED_BOOK, count: 1, ench: { keen: 2 } });
    inv.add({ id: I.ENCHANTED_BOOK, count: 1, ench: { keen: 2 } });
    expect(inv.slots[2].ench).toEqual({ keen: 2 });
    expect(inv.slots[3].ench).toEqual({ keen: 2 });
    const taken = inv.removeFromSlot(1, 4);
    expect(taken).toMatchObject({ id: B.STONE, count: 4, ench: { swiftdig: 1 } });
  });
  it('survive the network format and drop junk', () => {
    const st = { id: I.DIAMOND_SWORD, count: 1, damage: 12, ench: { keen: 5, bogus: 3 }, rw: 3 };
    const c = copyStack(st);
    expect(c).toEqual({ id: I.DIAMOND_SWORD, count: 1, damage: 12, ench: { keen: 5 }, rw: 3 });
    expect(sameStack(c, { ...c, ench: { keen: 4 } })).toBe(false);
    expect(sameStack(c, copyStack(c))).toBe(true);
    expect(cleanEnch({ keen: '2', x: 1, plunder: 0 })).toEqual({ keen: 2 });
    const packed = packEntity({ kind: 'item', id: 5, x: 1, y: 2, z: 3, stack: st, pickupDelay: 0 });
    const back = JSON.parse(JSON.stringify(packed));
    expect(unpackEntity(back).stack).toEqual({ id: I.DIAMOND_SWORD, count: 1, damage: 12, ench: { keen: 5 } });
    const plain = unpackEntity(JSON.parse(JSON.stringify(packEntity({ kind: 'item', id: 6, x: 1, y: 2, z: 3, stack: { id: B.STONE, count: 2 }, pickupDelay: 0 }))));
    expect(plain.stack.ench).toBeUndefined();
  });
});

describe('anvil', () => {
  const dur = ITEMS[I.IRON_PICKAXE].durability; // 250
  it('combines two damaged tools with a 12 % bonus', () => {
    const r = anvilCombine({ id: I.IRON_PICKAXE, count: 1, damage: 200 }, { id: I.IRON_PICKAXE, count: 1, damage: 150 });
    // remaining 50 + 100 + 30 = 180 -> damage 70
    expect(r.result.damage).toBe(dur - 180);
    expect(r.cost).toBe(2);
    expect(r.result.rw).toBe(1);
    // prior work adds up and doubles
    const again = anvilCombine({ ...r.result, damage: 100 }, { id: I.IRON_PICKAXE, count: 1, damage: 100 });
    expect(again.cost).toBe(3);
    expect(again.result.rw).toBe(3);
  });
  it('repairs with the material, a quarter per unit', () => {
    const r = anvilCombine({ id: I.IRON_PICKAXE, count: 1, damage: 200 }, { id: I.IRON_INGOT, count: 5 });
    expect(r.use).toBe(4); // 62 per ingot: 200 -> 138 -> 76 -> 14 -> 0
    expect(r.result.damage).toBe(0);
    expect(r.cost).toBe(4);
    expect(anvilCombine({ id: I.IRON_PICKAXE, count: 1, damage: 0 }, { id: I.IRON_INGOT, count: 5 })).toBeNull();
    expect(anvilCombine({ id: I.IRON_PICKAXE, count: 1, damage: 10 }, { id: I.DIAMOND, count: 5 })).toBeNull();
  });
  it('applies enchanted books and merges equal levels', () => {
    const r = anvilCombine({ id: I.IRON_SWORD, count: 1, damage: 0, ench: { keen: 3 } }, { id: I.ENCHANTED_BOOK, count: 1, ench: { keen: 3, plunder: 1 } });
    expect(r.result.ench).toEqual({ keen: 4, plunder: 1 });
    expect(r.cost).toBe(4 * 1 + 1 * 2); // keen x1 (book), plunder x4 halved
    expect(r.result.id).toBe(I.IRON_SWORD);
    // capped at the maximum level
    expect(anvilCombine({ id: I.IRON_SWORD, count: 1, ench: { keen: 5 } }, { id: I.ENCHANTED_BOOK, count: 1, ench: { keen: 5 } }).result.ench.keen).toBe(5);
    // books combine into books
    expect(anvilCombine({ id: I.ENCHANTED_BOOK, count: 1, ench: { bounty: 2 } }, { id: I.ENCHANTED_BOOK, count: 1, ench: { bounty: 2 } }).result.ench.bounty).toBe(3);
    // keen can go on an axe via a book, not on a pickaxe
    expect(anvilCombine({ id: I.IRON_AXE, count: 1 }, { id: I.ENCHANTED_BOOK, count: 1, ench: { keen: 1 } }).result.ench.keen).toBe(1);
    expect(anvilCombine({ id: I.IRON_PICKAXE, count: 1 }, { id: I.ENCHANTED_BOOK, count: 1, ench: { keen: 1 } })).toBeNull();
    // exclusive enchantments are refused
    expect(anvilCombine({ id: I.IRON_PICKAXE, count: 1, ench: { bounty: 1 } }, { id: I.ENCHANTED_BOOK, count: 1, ench: { gentle_hand: 1 } })).toBeNull();
    // different items do not combine
    expect(anvilCombine({ id: I.IRON_PICKAXE, count: 1, damage: 5 }, { id: I.IRON_SWORD, count: 1 })).toBeNull();
  });
});

describe('levels', () => {
  it('spending levels keeps the bar within the new level', () => {
    const xp = newXp();
    addXp(xp, 1395); // level 30
    expect(xp.level).toBe(30);
    spendLevels(xp, 3);
    expect(xp.level).toBe(27);
    spendLevels(xp, 100);
    expect(xp.level).toBe(0);
    expect(xp.points).toBeLessThan(7);
  });
});
