// Hanging Signs (world/hangingSigns.js) and the Record Shelf (world/recordShelf.js).
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { World } from '../src/world/world.js';
import { B, BLOCKS, SHAPE, SOLID } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { TEX_NAMES } from '../src/world/textures.js';
import { CHUNK_VOLUME, cidx, MIN_Y } from '../src/world/constants.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { blockBoxes, SIDE_DIRS } from '../src/world/shapes.js';
import { containerSignal, isReadable } from '../src/world/comparators.js';
import { craft } from '../src/player/crafting.js';
import { blockDrops } from '../src/world/mining.js';
import { MemoryStorage, setStorage } from '../src/world/storage.js';
import { saveGame, applySave } from '../src/world/save.js';
import { mockGame } from './fixtures/mockGame.js';
import { Game } from '../src/game.js';
import {
  hangingBoxes, hangingFaces, hangingPlaceMeta, hangingSupported, hangingText, HANGING_WALL,
} from '../src/world/hangingSigns.js';
import {
  canShelve, cleanShelf, shelfMeta, shelfCount, shelfSignal, slotFromHit, useShelf, SHELF_SLOTS,
} from '../src/world/recordShelf.js';

const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const grid = (...cells) => { const g = new Array(9).fill(null); cells.forEach((c, i) => { g[i] = c ? { id: c, count: 1 } : null; }); return g; };

function flatChunk() {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 64; y++) blocks[cidx(x, y, z)] = B.STONE;
  const light = new Uint8Array(CHUNK_VOLUME);
  computeChunkLight(blocks, light);
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) };
}
function setup() {
  const world = new World(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.addChunk(cx, cz, flatChunk());
  world.tick();
  const drops = [];
  world.on('dropItems', (x, y, z, id) => drops.push([x, y, z, id]));
  return { world, drops };
}
const Y = 70;

describe('Hanging Sign: block and recipe', () => {
  it('is a wooden, support-needing sign with a texture and no collision', () => {
    const d = BLOCKS[B.HANGING_SIGN];
    expect(d.name).toBe('Hanging Sign');
    expect(d.needsSupport).toBe(true);
    expect(d.shape).toBe(SHAPE.BOXES);
    expect(SOLID[B.HANGING_SIGN]).toBeFalsy();
    expect(TEX_NAMES).toContain('oak_planks');
  });
  it('is crafted from planks and sticks (two stick chains and six planks make six)', () => {
    const P = B.OAK_PLANKS, S = I.STICK;
    const r = craft(grid(S, null, S, P, P, P, P, P, P), 3);
    expect(r && r.id).toBe(B.HANGING_SIGN);
    expect(r.count).toBe(6);
    expect(craft(grid(S, null, S, P, P, P, null, P, P), 3)).toBeFalsy();
  });
  it('drops itself', () => {
    expect(blockDrops(B.HANGING_SIGN, { type: 'hand' }, Math.random, 0).map((s) => s.id)).toEqual([B.HANGING_SIGN]);
  });
});

describe('Hanging Sign: placement rules', () => {
  it('cannot go on top of a block; under a block it hangs, on a wall it takes a bracket', () => {
    expect(hangingPlaceMeta([0, 1, 0], 0, -1)).toBe(-1);
    expect(hangingPlaceMeta([0, -1, 0], 0, -1) & HANGING_WALL).toBe(0);
    expect(hangingPlaceMeta([0, -1, 0], 1, 0)).toBe(1); // facing a player who looks along x
    expect(hangingPlaceMeta([0, -1, 0], 0, 1)).toBe(0);
    for (let s = 0; s < 4; s++) {
      const [dx, , dz] = SIDE_DIRS[s]; // the wall lies on side s, so the clicked face points the other way
      const m = hangingPlaceMeta([-dx, 0, -dz], 0, 0);
      expect(m & HANGING_WALL).toBe(HANGING_WALL);
      expect(m & 3).toBe(s);
    }
  });
  it('needs a solid block above (ceiling) or on its wall side (bracket)', () => {
    const at = (cells) => (x, y, z) => cells[`${x},${y},${z}`] || 0;
    expect(hangingSupported(at({ '0,5,0': B.STONE }), 0, 4, 0, 0)).toBe(true);
    expect(hangingSupported(at({}), 0, 4, 0, 0)).toBe(false);
    expect(hangingSupported(at({ '0,3,0': B.STONE }), 0, 4, 0, 0)).toBe(false); // not from below
    for (let s = 0; s < 4; s++) {
      const [dx, , dz] = SIDE_DIRS[s];
      expect(hangingSupported(at({ [`${dx},4,${dz}`]: B.STONE }), 0, 4, 0, HANGING_WALL | s)).toBe(true);
      expect(hangingSupported(at({ [`${-dx},4,${-dz}`]: B.STONE }), 0, 4, 0, HANGING_WALL | s)).toBe(false);
    }
  });
  it('the world agrees about support', () => {
    const { world } = setup();
    world.setBlock(2, Y + 1, 2, B.STONE);
    expect(world.hasSupport(2, Y, 2, B.HANGING_SIGN, 0)).toBe(true);
    expect(world.hasSupport(5, Y, 5, B.HANGING_SIGN, 0)).toBe(false);
    expect(world.hasSupport(5, Y, 5, B.HANGING_SIGN, HANGING_WALL | 1)).toBe(false);
  });
  it('drops (as an item) when the block it hangs from is removed, ceiling and wall alike', () => {
    const { world, drops } = setup();
    world.setBlock(2, Y + 1, 2, B.STONE);
    world.setBlock(2, Y, 2, B.HANGING_SIGN, 1);
    world.setBlock(8, Y, 8, B.STONE); // a wall block east of the sign
    world.setBlock(7, Y, 8, B.HANGING_SIGN, HANGING_WALL | 1);
    expect(world.getBlock(2, Y, 2)).toBe(B.HANGING_SIGN);
    expect(world.getBlock(7, Y, 8)).toBe(B.HANGING_SIGN);
    world.setBlock(2, Y + 1, 2, B.AIR);
    world.setBlock(8, Y, 8, B.AIR);
    for (let i = 0; i < 4; i++) world.tick();
    expect(world.getBlock(2, Y, 2)).toBe(B.AIR);
    expect(world.getBlock(7, Y, 8)).toBe(B.AIR);
    expect(drops.filter((d) => d[3] === B.HANGING_SIGN).length).toBe(2);
  });
});

describe('Hanging Sign: shape, text and flow', () => {
  it('has boxes for every variant that stay inside the block and touch their anchor', () => {
    for (let m = 0; m < 8; m++) {
      const boxes = blockBoxes(B.HANGING_SIGN, m);
      expect(boxes).toBe(hangingBoxes(m));
      expect(boxes.length).toBeGreaterThan(2);
      for (const b of boxes) for (let i = 0; i < 6; i++) { expect(b[i]).toBeGreaterThanOrEqual(0); expect(b[i]).toBeLessThanOrEqual(1); }
      if (m & HANGING_WALL) {
        const [dx, , dz] = SIDE_DIRS[m & 3];
        const touches = boxes.some((b) => (dx > 0 && b[3] === 1) || (dx < 0 && b[0] === 0) || (dz > 0 && b[5] === 1) || (dz < 0 && b[2] === 0));
        expect(touches).toBe(true);
      } else expect(boxes.some((b) => b[4] === 1)).toBe(true); // a chain reaches the ceiling
    }
  });
  it('shows its two lines on both faces, facing opposite ways', () => {
    for (let m = 0; m < 8; m++) {
      const [a, b] = hangingFaces(m);
      expect(Math.abs(a.nx + b.nx)).toBe(0);
      expect(Math.abs(a.nz + b.nz)).toBe(0);
      expect(Math.abs(a.nx) + Math.abs(a.nz)).toBe(1);
      if (m & HANGING_WALL) { const [dx, , dz] = SIDE_DIRS[m & 3]; expect(a.nx * dx + a.nz * dz).toBe(-1); } // the first face looks away from the wall
    }
  });
  it('keeps two clean lines of at most 15 characters', () => {
    expect(hangingText(['a'.repeat(40), 'b', 'c', 'd'])).toEqual(['a'.repeat(15), 'b']);
    expect(hangingText(null)).toEqual(['', '']);
  });
  it('is wired into the sign flow (editor, renderer, support, placement) without banned words', () => {
    expect(src('src/player/interaction.js')).toContain('B.HANGING_SIGN');
    expect(src('src/render/signs.js')).toContain('HANGING_SIGN');
    expect(src('src/ui/screens.js')).toContain('HANGING_SIGN');
    expect(src('src/world/world.js')).toContain('hangingSupported');
    for (const f of ['src/world/hangingSigns.js', 'src/world/recordShelf.js']) expect(src(f)).not.toMatch(/minecraft|nether|redstone|tripwire/i);
  });
  it('Game.setSignText keeps two lines on a hanging sign and four on a plain one', () => {
    const g = { signs: new Map(), net: null, world: { getBlock: (x) => (x === 1 ? B.HANGING_SIGN : B.OAK_SIGN) } };
    Game.prototype.setSignText.call(g, 1, 5, 5, ['a', 'b', 'c', 'd']);
    Game.prototype.setSignText.call(g, 2, 5, 5, ['a', 'b', 'c', 'd']);
    expect(g.signs.get('1,5,5')).toEqual(['a', 'b']);
    expect(g.signs.get('2,5,5')).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('Record Shelf', () => {
  const book = { id: I.BOOK, count: 1, damage: 0 };
  it('is a wooden block with 64 spine textures and a recipe', () => {
    expect(BLOCKS[B.RECORD_SHELF].name).toBe('Record Shelf');
    expect(isReadable(B.RECORD_SHELF)).toBe(true);
    for (let i = 0; i < 64; i++) expect(TEX_NAMES).toContain('record_shelf_' + i);
    const P = B.OAK_PLANKS, K = I.BOOK;
    expect(craft(grid(P, P, P, K, null, K, P, P, P), 3)?.id).toBe(B.RECORD_SHELF);
    expect(craft(grid(P, P, P, K, K, K, P, P, P), 3)?.id).toBe(B.BOOKSHELF); // the bookshelf stays itself
  });
  it('takes books, maps and paper only', () => {
    for (const id of [I.BOOK, I.PAPER, I.WRITABLE_BOOK, I.WRITTEN_BOOK, I.TATTERED_BOOK, I.FILLED_MAP, I.EMPTY_MAP]) expect(canShelve({ id })).toBe(true);
    for (const id of [I.STICK, B.STONE, I.DIAMOND]) expect(canShelve({ id })).toBe(false);
    expect(useShelf(null, 0, { id: I.STICK, count: 1 })).toBe(null);
  });
  it('puts in the aimed slot, refuses a full one, takes out with an empty hand', () => {
    let r = useShelf(null, 4, book);
    expect(r.put).toBe(4);
    expect(shelfMeta(r.slots)).toBe(1 << 4);
    expect(useShelf(r.slots, 4, book)).toBe(null); // the slot is taken
    r = useShelf(r.slots, 0, { id: I.PAPER, count: 5 });
    expect(r.slots[0]).toEqual({ id: I.PAPER, count: 1, damage: 0 }); // one sheet goes in
    expect(shelfMeta(r.slots)).toBe(0b010001);
    const out = useShelf(r.slots, 4, null);
    expect(out.took.id).toBe(I.BOOK);
    expect(shelfMeta(out.slots)).toBe(1);
    expect(useShelf(out.slots, 2, null)).toBe(null); // an empty slot gives nothing
  });
  it('a click on the top or bottom uses the first free slot / the last held item', () => {
    let s = null;
    for (let i = 0; i < SHELF_SLOTS; i++) s = useShelf(s, -1, book).slots;
    expect(shelfCount(s)).toBe(6);
    expect(useShelf(s, -1, book)).toBe(null); // full
    expect(useShelf(s, -1, null).took).toBeTruthy();
  });
  it('maps a click on a face to a slot: two rows of three', () => {
    // the +z face: left to right is +x; the top row is slots 3-5
    expect(slotFromHit([0, 0, 1], 0.1, 0.2, 1)).toBe(0);
    expect(slotFromHit([0, 0, 1], 0.9, 0.2, 1)).toBe(2);
    expect(slotFromHit([0, 0, 1], 0.5, 0.8, 1)).toBe(4);
    expect(slotFromHit([0, 0, -1], 0.9, 0.8, 0)).toBe(3); // seen from the other side, +x is on the left
    expect(slotFromHit([1, 0, 0], 1, 0.2, 0.1)).toBe(2); // the +x face: right is -z
    expect(slotFromHit([-1, 0, 0], 0, 0.2, 0.1)).toBe(0);
    expect(slotFromHit([0, 1, 0], 0.5, 1, 0.5)).toBe(-1);
  });
  it('gives a comparator the number of held items (0-15)', () => {
    expect(shelfSignal(null)).toBe(0);
    const sig = [];
    let s = null;
    for (let i = 0; i < 6; i++) { s = useShelf(s, i, book).slots; sig.push(shelfSignal(s)); }
    expect(sig).toEqual([3, 5, 8, 10, 13, 15]);
    const { world } = setup();
    const g = { world, shelves: new Map([[`3,${Y},3`, s]]) };
    world.setBlock(3, Y, 3, B.RECORD_SHELF, shelfMeta(s));
    expect(containerSignal(g, 3, Y, 3)).toBe(15);
    g.shelves.set(`3,${Y},3`, useShelf(s, 0, null).slots);
    expect(containerSignal(g, 3, Y, 3)).toBe(13);
    g.shelves.clear();
    expect(containerSignal(g, 3, Y, 3)).toBe(0);
  });
  it('cleans untrusted data and keeps book text and map links', () => {
    expect(cleanShelf(null)).toBe(null);
    expect(cleanShelf([null, { id: I.STICK }])).toBe(null);
    const c = cleanShelf([{ id: I.WRITTEN_BOOK, count: 9, title: 'Log', author: 'Ann', pages: ['hi'] }, { id: I.FILLED_MAP, map: 7, mapX: 1, mapZ: -2, label: 'Survey' }, 'junk']);
    expect(c.length).toBe(6);
    expect(c[0]).toMatchObject({ id: I.WRITTEN_BOOK, count: 1, title: 'Log', author: 'Ann', pages: ['hi'] });
    expect(c[1]).toMatchObject({ id: I.FILLED_MAP, map: 7, mapX: 1, mapZ: -2, label: 'Survey' });
    expect(c[2]).toBe(null);
  });
  it('Game.setShelf keeps the block spines in step (host) and sends on', () => {
    const sent = [];
    const { world } = setup();
    world.setBlock(3, Y, 3, B.RECORD_SHELF, 0);
    const g = { shelves: new Map(), world, net: { sendShelf: (...a) => sent.push(a) } };
    const slots = useShelf(null, 1, book).slots;
    Game.prototype.setShelf.call(g, 3, Y, 3, slots);
    expect(world.getMeta(3, Y, 3)).toBe(2);
    expect(sent.length).toBe(1);
    Game.prototype.setShelf.call(g, 3, Y, 3, null, true); // from the network: no echo
    expect(g.shelves.size).toBe(0);
    expect(world.getMeta(3, Y, 3)).toBe(0);
    expect(sent.length).toBe(1);
  });
});

describe('save round trip', () => {
  beforeEach(() => setStorage(new MemoryStorage()));
  it('keeps hanging sign text and shelf contents', async () => {
    const g = mockGame();
    g.shelves = new Map([['5,62,5', cleanShelf([{ id: I.BOOK }, null, { id: I.WRITTEN_BOOK, title: 'T', author: 'A', pages: ['x'] }, null, null, { id: I.PAPER }])]]);
    g.signs.set('6,62,6', ['Open', 'Late']);
    const data = JSON.parse(JSON.stringify(await saveGame(g), (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));
    const g2 = mockGame();
    g2.shelves = new Map();
    g2.weather.load = () => {}; g2.milestones.load = () => {};
    g2.entities = { list: [], spawnItem() {} }; g2.maps = new Map(); g2.explored = null; g2.game = g2;
    applySave(g2, data);
    expect(g2.signs.get('6,62,6')).toEqual(['Open', 'Late']);
    const s = g2.shelves.get('5,62,5');
    expect(shelfMeta(s)).toBe(0b100101);
    expect(s[2]).toMatchObject({ id: I.WRITTEN_BOOK, title: 'T', pages: ['x'] });
  });
  it('travels in the multiplayer welcome and as shelf messages', () => {
    const net = src('src/net/session.js');
    expect(net).toContain("t: 'shelf'");
    expect(net).toContain('shelves: [...(g.shelves || [])]');
    expect(net).toContain('sendShelf');
    expect(src('src/net/guard.js')).toContain("shelf: 'misc'");
  });
});
