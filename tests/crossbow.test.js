import { describe, it, expect } from 'vitest';
import { craft } from '../src/player/crafting.js';
import { I, ITEMS } from '../src/world/items.js';
import { categories } from '../src/world/enchantments.js';
import { Interaction } from '../src/player/interaction.js';

const s = (id) => (id == null ? null : { id, count: 1 });

function fakeGame(slots) {
  const arrows = [];
  const inv = {
    slots, selected: 0,
    get selectedStack() { return this.slots[this.selected]; },
    removeFromSlot(i, n) { this.slots[i].count -= n; if (this.slots[i].count <= 0) this.slots[i] = null; },
    damageSelected(n) { this.slots[this.selected].damage = (this.slots[this.selected].damage | 0) + n; },
    changed() {},
  };
  const player = { inventory: inv, creative: false, x: 0, y: 64, z: 0, eyePos: () => [0, 65.6, 0], lookDir: () => [0, 0, -1] };
  return {
    arrows,
    game: { player, audio: { play() {} }, entities: { spawnArrow: (...a) => { const e = { args: a }; arrows.push(e); return e; } } },
  };
}

describe('crossbow', () => {
  it('is crafted from sticks, an iron ingot, string and flint', () => {
    const T = I.STICK, R = I.IRON_INGOT, S = I.STRING, F = I.FLINT;
    expect(craft([T, R, T, S, F, S, null, T, null].map(s), 3)).toEqual({ id: I.CROSSBOW, count: 1 });
  });
  it('takes bow enchantments', () => {
    expect(categories(I.CROSSBOW)).toEqual(['bow']);
    expect(ITEMS[I.CROSSBOW_LOADED].durability).toBe(ITEMS[I.CROSSBOW].durability);
  });
  it('loads an arrow, then fires a fast critical one and wears', () => {
    const { game, arrows } = fakeGame([{ id: I.CROSSBOW, count: 1, damage: 0 }, { id: I.ARROW, count: 3 }]);
    const it = Object.create(Interaction.prototype);
    it.game = game;
    it.loadCrossbow();
    expect(game.player.inventory.slots[0].id).toBe(I.CROSSBOW_LOADED);
    expect(game.player.inventory.slots[1].count).toBe(2);
    it.fireCrossbow();
    expect(arrows.length).toBe(1);
    expect(arrows[0].args[5]).toBeCloseTo(-3.15); // vz
    expect(arrows[0].args[7]).toBe(true); // critical
    expect(game.player.inventory.slots[0]).toMatchObject({ id: I.CROSSBOW, damage: 1 });
  });
  it('does not load without arrows', () => {
    const { game } = fakeGame([{ id: I.CROSSBOW, count: 1, damage: 0 }]);
    const it = Object.create(Interaction.prototype);
    it.game = game;
    it.loadCrossbow();
    expect(game.player.inventory.slots[0].id).toBe(I.CROSSBOW);
  });
});

describe('tidespear', () => {
  it('hits hard in melee and is thrown with its wear', async () => {
    const { toolOf } = await import('../src/world/items.js');
    expect(toolOf({ id: I.TIDESPEAR, count: 1 }).damage).toBe(9);
    const { game, arrows } = fakeGame([{ id: I.TIDESPEAR, count: 1, damage: 3 }]);
    const it = Object.create(Interaction.prototype);
    it.game = game;
    it.throwSpear();
    expect(game.player.inventory.slots[0]).toBe(null);
    expect(arrows[0].args[8]).toBe('spear');
    expect(arrows[0].args[11]).toMatchObject({ id: I.TIDESPEAR, damage: 4 });
  });
  it('lands as an item where it hits', async () => {
    const { Arrow } = await import('../src/entities/entities.js');
    const drops = [];
    const world = { raycast: () => ({ dist: 0.5 }), getBlock: () => 0 };
    const game = { world, net: null, audio: { play() {} }, entities: { sweepHit: () => null, spawnItem: (x, y, z, st) => drops.push(st) } };
    const a = new Arrow(0, 70, 0, 0, -1, 0, null, false, 'spear');
    a.item = { id: I.TIDESPEAR, count: 1, damage: 4 };
    a.tick(game);
    expect(a.dead).toBe(true);
    expect(drops).toEqual([{ id: I.TIDESPEAR, count: 1, damage: 4 }]);
  });
});

describe('tipped arrows', () => {
  it('eight arrows round a splash elixir make eight tipped arrows', async () => {
    const { TIPPED_ARROW, SPLASH_ITEM } = await import('../src/world/items.js');
    const A = { id: I.ARROW, count: 1 }, P = { id: SPLASH_ITEM.poison, count: 1 };
    expect(craft([A, A, A, A, P, A, A, A, A], 3)).toEqual({ id: TIPPED_ARROW.poison, count: 8 });
    expect(ITEMS[TIPPED_ARROW.poison].name).toBe('Arrow of Poison');
  });
  it('a tipped arrow carries an eighth of the effect and is picked up as itself', async () => {
    const { TIPPED_ARROW } = await import('../src/world/items.js');
    const { Arrow } = await import('../src/entities/entities.js');
    const a = new Arrow(0, 0, 0, 0, 0, 0, null);
    a.setTip(TIPPED_ARROW.long_slowness);
    expect(a.effect[0]).toBe('slowness');
    expect(a.effect[1]).toBe(Math.floor(4 * 60 * 20 / 8));
    expect(a.pickupId).toBe(TIPPED_ARROW.long_slowness);
  });
});
