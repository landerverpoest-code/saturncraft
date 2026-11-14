// Armour Inlays: cosmetic patterns laid into armour (player/inlays.js).
import { describe, it, expect } from 'vitest';
import { I, ITEMS } from '../src/world/items.js';
import { craft, consumeCraft, RECIPES } from '../src/player/crafting.js';
import { B } from '../src/world/blocks.js';
import {
  cleanInlay, inlayRecipe, inlayLine, inlayCode, inlayFromCode, inlayCodes, inlayMask, canInlay,
  PATTERN_KEYS, MATERIAL_KEYS, INLAY_PATTERNS, INLAY_MATERIALS,
} from '../src/player/inlays.js';
import { canStack, withExtras } from '../src/world/enchantments.js';
import { copyStack, sameStack, packEntity, unpackEntity, packPlayerState, unpackPlayerState } from '../src/net/protocol.js';
import { standSaveData, standFromSave, ArmorStand } from '../src/entities/armorStand.js';
import { tooltipHTML } from '../src/ui/icons.js';
import { STRUCTURE_LOOT } from '../src/mobs/spawnerBlocks.js';

const st = (id, extra = {}) => ({ id, count: 1, damage: 0, ...extra });
const grid = (...cells) => { const g = new Array(9).fill(null); cells.forEach((c, i) => { g[i] = c; }); return g; };

describe('stencil items', () => {
  it('exist, at the very end, and no earlier id shifted', () => {
    const keys = PATTERN_KEYS.map((k) => INLAY_PATTERNS[k].stencil);
    expect(keys).toHaveLength(6);
    for (const k of keys) expect(ITEMS[I[k]].name).toMatch(/^Inlay Stencil: /);
    const ids = keys.map((k) => I[k]);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids[0]).toBe(I.HOWLER_BARDING + 1);
    expect(ids[5]).toBe(I.HOWLER_BARDING + 6);
    expect(I.HOWLER_BARDING).toBe(ITEMS.findIndex((it) => it && it.key === 'howler_barding'));
    expect(I.DAWNFERN_SEEDS).toBe(I.HOWLER_BARDING - 2);
  });
  it('every material names an item that exists', () => {
    for (const k of MATERIAL_KEYS) expect(ITEMS[I[INLAY_MATERIALS[k].item]], k).toBeTruthy();
    expect(MATERIAL_KEYS).toHaveLength(10);
  });
  it('are found in structure chests, rarely', () => {
    const found = new Set();
    for (const t of Object.values(STRUCTURE_LOOT)) {
      const total = t[0].reduce((a, e) => a + (e[3] || 0), 0);
      for (const e of t[0]) if (PATTERN_KEYS.some((k) => I[INLAY_PATTERNS[k].stencil] === e[0])) { found.add(e[0]); expect(e[3] / total).toBeLessThan(0.05); }
    }
    expect(found.size).toBe(6);
  });
});

describe('applying an inlay', () => {
  const stencil = () => st(I.INLAY_STENCIL_THREE_SUNS);
  it('gives the same piece with the inlay, keeps the stencil, uses the material', () => {
    const g = grid(st(I.IRON_CHESTPLATE, { damage: 30, ench: { protection: 2 } }), stencil(), st(I.BERYL, { count: 3 }));
    const r = craft(g, 3);
    expect(r).toMatchObject({ id: I.IRON_CHESTPLATE, count: 1, damage: 30, ench: { protection: 2 }, inlay: { p: 'three_suns', m: 'beryl' } });
    consumeCraft(g);
    expect(g[1]).toMatchObject({ id: I.INLAY_STENCIL_THREE_SUNS, count: 1 });
    expect(g[2].count).toBe(2);
    expect(g[0]).toBeNull();
  });
  it('works in a 2x2 grid and in any cell order', () => {
    const r = craft([st(I.BERYL), st(I.IRON_BOOTS), null, stencil()], 2);
    expect(r).toMatchObject({ id: I.IRON_BOOTS, inlay: { p: 'three_suns', m: 'beryl' } });
  });
  it('replaces an old inlay', () => {
    const g = grid(st(I.DIAMOND_HELMET, { inlay: { p: 'ringed', m: 'iron' } }), st(I.INLAY_STENCIL_HOLLOW), st(I.CINNABAR));
    expect(craft(g, 3).inlay).toEqual({ p: 'hollow', m: 'cinnabar' });
  });
  it('does not change stats', () => {
    const g = grid(st(I.IRON_HELMET), stencil(), st(I.GOLD_INGOT));
    const r = craft(g, 3);
    expect(ITEMS[r.id].armor.defense).toBe(ITEMS[I.IRON_HELMET].armor.defense);
  });
  it('refuses non-armour, missing parts and extras', () => {
    expect(craft(grid(st(I.IRON_SWORD), stencil(), st(I.BERYL)), 3)).toBeNull();
    expect(craft(grid(st(I.IRON_HELMET), st(I.BERYL)), 3)).toBeNull();
    expect(craft(grid(st(I.IRON_HELMET), stencil()), 3)).toBeNull();
    expect(craft(grid(st(I.IRON_HELMET), stencil(), st(I.BERYL), st(I.STICK)), 3)).toBeNull();
    expect(craft(grid(st(I.IRON_HELMET), st(I.IRON_CHESTPLATE), stencil(), st(I.BERYL)), 3)).toBeNull();
    expect(craft(grid(st(I.IRON_HELMET), st(I.INLAY_STENCIL_TIDAL), stencil(), st(I.BERYL)), 3)).toBeNull();
    expect(canInlay(I.IRON_SWORD)).toBe(false);
    expect(canInlay(I.VOIDWING)).toBe(false);
    expect(canInlay(I.IRON_BOOTS)).toBe(true);
    expect(inlayRecipe(grid(st(I.BERYL), st(I.BERYL), stencil()))).toBeNull();
  });
  it('every pattern and material combination works', () => {
    for (const p of PATTERN_KEYS) for (const m of MATERIAL_KEYS) {
      const r = craft(grid(st(I.LEATHER_BOOTS), st(I[INLAY_PATTERNS[p].stencil]), st(I[INLAY_MATERIALS[m].item])), 3);
      expect(r.inlay).toEqual({ p, m });
    }
  });
});

describe('copying a stencil', () => {
  it('stencil in the middle, four Paper and four planks make two', () => {
    for (const id of [I.INLAY_STENCIL_TIDAL, I.INLAY_STENCIL_THORN]) {
      const P = B.OAK_PLANKS, Q = I.PAPER;
      const r = craft(grid(st(P), st(Q), st(P), st(Q), st(id), st(Q), st(P), st(Q), st(P)), 3);
      expect(r).toMatchObject({ id, count: 2 });
    }
    expect(RECIPES.filter((r) => r.result === I.INLAY_STENCIL_EMBER && r.count === 2)).toHaveLength(1);
  });
});

describe('cleanInlay', () => {
  it('keeps known keys, rejects junk', () => {
    expect(cleanInlay({ p: 'tidal', m: 'azurite', extra: 1 })).toEqual({ p: 'tidal', m: 'azurite' });
    for (const bad of [null, undefined, 3, 'tidal', {}, { p: 'tidal' }, { m: 'gold' }, { p: 'nope', m: 'gold' }, { p: 'tidal', m: 'mud' }, { p: '__proto__', m: 'gold' }, { p: 'toString', m: 'gold' }, { p: ['tidal'], m: 'gold' }]) expect(cleanInlay(bad), JSON.stringify(bad)).toBeNull();
  });
  it('codes round trip', () => {
    for (const p of PATTERN_KEYS) for (const m of MATERIAL_KEYS) expect(inlayFromCode(inlayCode({ p, m }))).toEqual({ p, m });
    expect(inlayCode(null)).toBe(0);
    expect(inlayFromCode(0)).toBeNull();
    expect(inlayFromCode(9999)).toBeNull();
    expect(inlayCodes([null, null, null, null])).toBe(0);
  });
  it('patterns have distinct, non-empty masks', () => {
    const seen = new Set();
    for (const p of PATTERN_KEYS) { const m = inlayMask(p); expect(m.reduce((a, b) => a + b, 0), p).toBeGreaterThan(6); seen.add(m.join('')); }
    expect(seen.size).toBe(6);
  });
});

describe('inlay as a stack extra', () => {
  const piece = () => st(I.IRON_HELMET, { damage: 5, inlay: { p: 'thorn', m: 'gold' } });
  it('survives copyStack and withExtras, and is cleaned', () => {
    expect(copyStack(piece()).inlay).toEqual({ p: 'thorn', m: 'gold' });
    expect(withExtras({ id: I.IRON_HELMET, count: 1, damage: 0 }, piece()).inlay).toEqual({ p: 'thorn', m: 'gold' });
    expect(copyStack(st(I.IRON_HELMET, { inlay: { p: 'x', m: 'gold' } })).inlay).toBeUndefined();
  });
  it('is kept in a Gloomshell Box / bundle cleaning', () => {
    const c = withExtras({ id: B.CHEST, count: 1, damage: 0 }, { contents: [piece()] });
    expect(c.contents[0].inlay).toEqual({ p: 'thorn', m: 'gold' });
  });
  it('survives the wire (dropped item) and a save round trip', () => {
    const e = { kind: 'item', id: 7, x: 1, y: 2, z: 3, stack: piece(), pickupDelay: 0 };
    const back = unpackEntity(JSON.parse(JSON.stringify(packEntity(e))));
    expect(back.stack.inlay).toEqual({ p: 'thorn', m: 'gold' });
    const plain = unpackEntity(JSON.parse(JSON.stringify(packEntity({ ...e, stack: st(I.IRON_HELMET) }))));
    expect(plain.stack.inlay).toBeUndefined();
    const saved = JSON.parse(JSON.stringify({ slots: [piece()] }));
    expect(sameStack(copyStack(saved.slots[0]), piece())).toBe(true);
    const stand = new ArmorStand(1, 2, 3, 0);
    stand.armor[0] = piece();
    const s2 = standFromSave(JSON.parse(JSON.stringify(standSaveData(stand))));
    expect(s2.armor[0].inlay).toEqual({ p: 'thorn', m: 'gold' });
  });
  it('is shown to other players and on stands', () => {
    const p = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, inventory: { armor: [piece(), null, null, st(I.IRON_BOOTS, { inlay: { p: 'hollow', m: 'azurite' } })] } };
    const back = unpackPlayerState(JSON.parse(JSON.stringify(packPlayerState(p, null, 0))));
    expect(back.inlays).toEqual([{ p: 'thorn', m: 'gold' }, null, null, { p: 'hollow', m: 'azurite' }]);
    expect(back.armor[0]).toBe(I.IRON_HELMET);
    const stand = new ArmorStand(1, 2, 3, 0);
    stand.armor[1] = st(I.IRON_CHESTPLATE, { inlay: { p: 'ember', m: 'copper' } });
    const sb = unpackEntity(JSON.parse(JSON.stringify(packEntity(stand))));
    expect(sb.inlays[1]).toEqual({ p: 'ember', m: 'copper' });
  });
  it('makes pieces with different inlays different stacks', () => {
    const a = st(I.IRON_HELMET, { inlay: { p: 'thorn', m: 'gold' } }), b = st(I.IRON_HELMET, { inlay: { p: 'tidal', m: 'gold' } }), c = st(I.IRON_HELMET);
    expect(sameStack(a, b)).toBe(false);
    expect(sameStack(a, c)).toBe(false);
    expect(sameStack(a, { ...a })).toBe(true);
    const x = { id: I.STICK, count: 1, damage: 0 };
    expect(canStack(x, { ...x, inlay: { p: 'thorn', m: 'gold' } })).toBe(false);
  });
});

describe('tooltip', () => {
  it('names the pattern and material', () => {
    const t = st(I.IRON_HELMET, { inlay: { p: 'three_suns', m: 'beryl' } });
    expect(inlayLine(t)).toBe('Three Suns inlay in Beryl');
    expect(tooltipHTML(t)).toContain('Three Suns inlay in Beryl');
    expect(tooltipHTML(st(I.IRON_HELMET))).not.toContain('inlay');
    expect(tooltipHTML(st(I.IRON_HELMET, { inlay: { p: 'bad', m: 'beryl' } }))).not.toContain('inlay');
  });
});
