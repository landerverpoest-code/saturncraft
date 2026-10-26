import { describe, it, expect } from 'vitest';
import { World } from '../src/world/world.js';
import { B, BLOCKS, BOX_IDS, BOX_COLORS, isBox, SHAPE } from '../src/world/blocks.js';
import { I, ITEMS, DYES, maxStack } from '../src/world/items.js';
import { COLOR } from '../src/world/colors.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { CHUNK_VOLUME, cidx, MIN_Y } from '../src/world/constants.js';
import { comparatorLevel } from '../src/world/circuitShapes.js';
import { containerSignal, isReadable } from '../src/world/comparators.js';
import { craft } from '../src/player/crafting.js';
import { canStack, withExtras, cleanContents } from '../src/world/enchantments.js';
import { sameStack, copyStack, packEntity, unpackEntity } from '../src/net/protocol.js';
import { blockBoxes, collisionBoxes } from '../src/world/shapes.js';
import { TEX_NAMES } from '../src/world/textures.js';
import {
  cleanPage, cleanPages, cleanTitle, signBook, sameBook, bookPages, lecternSignal, cleanLectern, lecternMeta,
  BOOK_MAX_PAGES, PAGE_MAX, LECTERN_HAS_BOOK, LECTERN_POWERED, LECTERN_PULSE_TICKS,
} from '../src/world/books.js';
import { targetPower, targetTicks, projectileHit, cakeSignal, frameSignal, CAKE_SLICES, TARGET_TICKS_STUCK, TARGET_TICKS_THROWN } from '../src/world/signalBlocks.js';
import { Arrow } from '../src/entities/entities.js';
import { Interaction } from '../src/player/interaction.js';

function flatChunk() {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 64; y++) blocks[cidx(x, y, z)] = B.STONE;
  const light = new Uint8Array(CHUNK_VOLUME);
  computeChunkLight(blocks, light);
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) };
}
const Y = 64, EAST = 1; // comparator meta: output towards +x, so it reads the block at -x
function setup() {
  const world = new World(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.addChunk(cx, cz, flatChunk());
  world.tick();
  const g = { world, chests: new Map(), hoppers: new Map(), dispensers: new Map(), furnaces: new Map(), brewingStands: new Map(), lecterns: new Map(), frames: new Map() };
  world.circuits.containerSignal = (x, y, z) => containerSignal(g, x, y, z);
  return g;
}
const run = (w, n = 1) => { for (let i = 0; i < n; i++) w.tick(); };
const grid3 = (cells) => cells.map((id) => (id == null ? null : { id, count: 1 }));

describe('writable and written books', () => {
  it('clean pages, titles and authors from untrusted data', () => {
    expect(cleanPage('a\u0000b\r\nc\td')).toBe('ab\ncd');
    expect(cleanPage('x'.repeat(400)).length).toBe(PAGE_MAX);
    expect(cleanPage(42)).toBe('');
    const many = cleanPages(Array.from({ length: 80 }, (_, i) => 'p' + i));
    expect(many.length).toBe(BOOK_MAX_PAGES);
    expect(cleanPages(['one', '', 'three', '', ''])).toEqual(['one', '', 'three']); // blank pages at the end go
    expect(cleanPages(['', ''])).toBe(null);
    expect(cleanPages('nope')).toBe(null);
    expect(cleanTitle('  My\u0007 Diary  ')).toBe('My Diary');
    expect(cleanTitle('t'.repeat(50)).length).toBe(32);
    expect(cleanTitle('   ')).toBe(null);
  });

  it('are crafted from a book, ink and a feather, and only written copies stack', () => {
    expect(craft(grid3([I.BOOK, I.INK_SAC, I.FEATHER]), 3)).toEqual({ id: I.WRITABLE_BOOK, count: 1 });
    expect(craft(grid3([I.FEATHER, DYES[COLOR.BLACK], I.BOOK]), 3).id).toBe(I.WRITABLE_BOOK);
    expect(maxStack(I.WRITABLE_BOOK)).toBe(1);
    expect(maxStack(I.WRITTEN_BOOK)).toBe(16);
    const a = { id: I.WRITTEN_BOOK, count: 1, pages: ['hi'], title: 'T', author: 'Ann' };
    expect(canStack(a, { ...a, pages: ['hi'] })).toBe(true);
    expect(canStack(a, { ...a, pages: ['ho'] })).toBe(false);
    expect(canStack(a, { ...a, title: 'U' })).toBe(false);
    expect(canStack(a, { ...a, author: 'Bob' })).toBe(false);
    expect(sameBook(a, { ...a })).toBe(true);
    expect(sameStack(a, { ...a, pages: ['hi', 'more'] })).toBe(false);
  });

  it('sign into a read-only Written Book with a title and the author', () => {
    const w = { id: I.WRITABLE_BOOK, count: 1, damage: 0, pages: ['Dear diary', 'Page two'] };
    expect(signBook(w, '   ', 'Ann')).toBe(null); // a title is needed
    expect(signBook({ id: I.BOOK, count: 1 }, 'T', 'Ann')).toBe(null);
    const s = signBook(w, ' Notes ', 'Ann');
    expect(s).toEqual({ id: I.WRITTEN_BOOK, count: 1, damage: 0, title: 'Notes', author: 'Ann', pages: ['Dear diary', 'Page two'] });
    expect(signBook({ id: I.WRITABLE_BOOK, count: 1 }, 'Empty', '').author).toBe('Unknown');
    expect(bookPages({ id: I.WRITABLE_BOOK })).toEqual(['']);
  });

  it('keep their text through stack copies, boxes, bundles and the network', () => {
    const st = { id: I.WRITTEN_BOOK, count: 2, damage: 0, pages: ['a', 'b\nc'], title: 'Tale', author: 'Ann' };
    expect(copyStack(st)).toEqual(st);
    expect(withExtras({ id: I.WRITTEN_BOOK, count: 1 }, { pages: ['x\u0001'], title: 5 })).toEqual({ id: I.WRITTEN_BOOK, count: 1, pages: ['x'] });
    expect(cleanContents([st])[0].pages).toEqual(['a', 'b\nc']);
    const packed = packEntity({ kind: 'item', id: 7, x: 1, y: 2, z: 3, stack: st, pickupDelay: 0 });
    const back = unpackEntity(JSON.parse(JSON.stringify(packed)));
    expect(back.stack).toEqual(st);
  });
});

describe('lecterns', () => {
  it('give the reference comparator signal for the open page', () => {
    const book = { id: I.WRITTEN_BOOK, pages: ['1', '2', '3', '4', '5'] };
    expect(lecternSignal(null, 0)).toBe(0);
    expect(lecternSignal(book, 0)).toBe(1);
    expect(lecternSignal(book, 2)).toBe(8); // floor(14 * 2 / 4) + 1
    expect(lecternSignal(book, 4)).toBe(15);
    expect(lecternSignal({ id: I.WRITABLE_BOOK }, 0)).toBe(15); // a one-page book
    expect(lecternSignal(book, 99)).toBe(15); // clamped to the last page
  });

  it('clean their state and keep the book bit and the page pulse in the meta', () => {
    expect(cleanLectern(null)).toBe(null);
    expect(cleanLectern({ book: { id: I.BOOK }, page: 0 })).toBe(null); // only books you write in
    expect(cleanLectern({ book: { id: I.WRITTEN_BOOK, pages: ['a', 'b'], title: 'T' }, page: 7 })).toEqual({ book: { id: I.WRITTEN_BOOK, count: 1, damage: 0, pages: ['a', 'b'], title: 'T' }, page: 1 });
    const s0 = { book: { id: I.WRITTEN_BOOK, pages: ['a', 'b'] }, page: 0 }, s1 = { ...s0, page: 1 };
    expect(lecternMeta(2, null, s0)).toBe(2 | LECTERN_HAS_BOOK);
    expect(lecternMeta(2 | LECTERN_HAS_BOOK, s0, s1)).toBe(2 | LECTERN_HAS_BOOK | LECTERN_POWERED);
    expect(lecternMeta(2 | LECTERN_HAS_BOOK, s0, s0)).toBe(2 | LECTERN_HAS_BOOK);
    expect(lecternMeta(2 | LECTERN_HAS_BOOK | LECTERN_POWERED, s1, null)).toBe(2);
  });

  it('are crafted from wooden slabs and a bookshelf and draw the book on the desk', () => {
    const S = B.OAK_SLAB;
    expect(craft(grid3([S, S, S, null, B.BOOKSHELF, null, null, S, null]), 3)).toEqual({ id: B.LECTERN, count: 1 });
    expect(BLOCKS[B.LECTERN].shape).toBe(SHAPE.BOXES);
    expect(blockBoxes(B.LECTERN, LECTERN_HAS_BOOK).length).toBe(blockBoxes(B.LECTERN, 0).length + 1);
    // the desk turns with the side the reader stands on
    const deskZ = blockBoxes(B.LECTERN, 0)[3], deskX = blockBoxes(B.LECTERN, 1)[3];
    expect(deskZ[2]).toBeCloseTo(0.5); expect(deskX[0]).toBeCloseTo(1 / 16);
    expect(collisionBoxes(B.LECTERN, 0)).toBeTruthy();
    for (const t of ['lectern_top', 'lectern_side', 'lectern_book', 'lectern_post', 'target_top', 'cake_inner']) expect(TEX_NAMES).toContain(t);
  });

  it('pulse when a page is turned and are read by a comparator', () => {
    const g = setup(), { world } = g;
    // the pulse: a lamp beside the lectern lights for a moment
    world.setBlock(3, Y, 3, B.LECTERN, LECTERN_HAS_BOOK);
    world.setBlock(4, Y, 3, B.CINNABAR_LAMP);
    run(world, 2);
    expect(world.getBlock(4, Y, 3)).toBe(B.CINNABAR_LAMP);
    world.setBlock(3, Y, 3, B.LECTERN, LECTERN_HAS_BOOK | LECTERN_POWERED);
    run(world, 1);
    expect(world.getBlock(4, Y, 3)).toBe(B.CINNABAR_LAMP_ON);
    run(world, LECTERN_PULSE_TICKS + 1);
    expect(world.getMeta(3, Y, 3) & LECTERN_POWERED).toBe(0);
    run(world, 6);
    expect(world.getBlock(4, Y, 3)).toBe(B.CINNABAR_LAMP);
    // a comparator behind it reads the page
    world.setBlock(-1, Y, 0, B.LECTERN, LECTERN_HAS_BOOK);
    g.lecterns.set(`-1,${Y},0`, { book: { id: I.WRITTEN_BOOK, pages: ['a', 'b', 'c'] }, page: 1 });
    world.setBlock(0, Y, 0, B.COMPARATOR, EAST);
    run(world, 6);
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(8);
    g.lecterns.get(`-1,${Y},0`).page = 2;
    run(world, 6);
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(15);
    g.lecterns.delete(`-1,${Y},0`);
    run(world, 6);
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(0);
  });

  it('take a held book and open it on a right-click', () => {
    const lecterns = new Map(), opened = [];
    const slots = new Array(36).fill(null);
    slots[0] = { id: I.WRITTEN_BOOK, count: 1, damage: 0, pages: ['hello'], title: 'T', author: 'A' };
    const p = { creative: false, inventory: { slots, selected: 0, removeFromSlot(i, n) { slots[i].count -= n; if (slots[i].count <= 0) slots[i] = null; } } };
    const game = {
      player: p, lecterns, audio: { play() {} }, ui: { openLectern: (x, y, z) => opened.push([x, y, z]) },
      setLectern(x, y, z, s) { lecterns.set(`${x},${y},${z}`, cleanLectern(s)); },
    };
    const it2 = Object.create(Interaction.prototype);
    it2.game = game;
    const t = { x: 1, y: Y, z: 2, id: B.LECTERN };
    expect(it2.useLectern(t, null)).toBe(false); // nothing to put down, nothing to read
    expect(it2.useLectern(t, slots[0])).toBe(true);
    expect(slots[0]).toBe(null);
    expect(lecterns.get(`1,${Y},2`).book.pages).toEqual(['hello']);
    expect(it2.useLectern(t, null)).toBe(true);
    expect(opened).toEqual([[1, Y, 2]]);
  });
});

describe('comparators reading other blocks', () => {
  it('read cakes, item frames and dyed boxes', () => {
    const g = setup(), { world } = g;
    const at = (x, z) => containerSignal(g, x, Y, z);
    world.setBlock(0, Y, 5, B.CAKE, 0);
    world.setBlock(1, Y, 5, B.CAKE, 5);
    // item frames hang on a wall (meta side 1: the wall is at +x)
    world.setBlock(3, Y, 8, B.STONE); world.setBlock(3, Y, 9, B.STONE);
    world.setBlock(2, Y, 8, B.ITEM_FRAME, 1 | (3 << 2));
    world.setBlock(2, Y, 9, B.ITEM_FRAME, 1);
    g.frames.set(`2,${Y},8`, { id: I.ARROW, count: 1 });
    world.setBlock(4, Y, 5, BOX_COLORS[COLOR.RED]);
    g.chests.set(`4,${Y},5`, { slots: Array.from({ length: 27 }, () => ({ id: B.COBBLESTONE, count: 64 })) });
    world.setBlock(5, Y, 5, B.LECTERN, 0);
    expect(at(0, 5)).toBe(14);
    expect(at(1, 5)).toBe(4);
    expect(at(2, 8)).toBe(4); // rotation 3 -> 1 + 3
    expect(at(2, 9)).toBe(0); // an empty frame
    expect(at(4, 5)).toBe(15);
    expect(at(5, 5)).toBe(0); // a lectern without a book
    expect(cakeSignal(CAKE_SLICES)).toBe(0);
    expect(frameSignal(7 << 2, true)).toBe(8);
    for (const id of [B.CAKE, B.LECTERN, B.ITEM_FRAME, ...BOX_IDS]) expect(isReadable(id)).toBe(true);
  });

  it('follow a cake as it is eaten, slice by slice', () => {
    const g = setup(), { world } = g;
    world.setBlock(-1, Y, 0, B.CAKE, 0);
    world.setBlock(0, Y, 0, B.COMPARATOR, EAST);
    run(world, 6);
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(14);
    // eating: an Interaction with just enough of a game around it
    const food = [];
    const p = { creative: false, hunger: { canEat: () => true, eat: (h, s) => food.push([h, s]) } };
    const it2 = Object.create(Interaction.prototype);
    it2.game = { player: p, world: { getMeta: (x, y, z) => world.getMeta(x, y, z), setBlockUrgent: (x, y, z, id, m) => world.setBlock(x, y, z, id, m) }, audio: { play() {} } };
    const t = { x: -1, y: Y, z: 0, id: B.CAKE };
    expect(it2.eatCake(t)).toBe(true);
    expect(food).toEqual([[2, 0.4]]);
    run(world, 6);
    expect(comparatorLevel(world.getMeta(0, Y, 0))).toBe(12);
    for (let k = 1; k < CAKE_SLICES; k++) it2.eatCake(t);
    expect(world.getBlock(-1, Y, 0)).toBe(B.AIR); // the last slice takes the cake away
    p.hunger.canEat = () => false;
    world.setBlock(-1, Y, 0, B.CAKE, 0);
    expect(it2.eatCake(t)).toBe(false); // not when full
  });

  it('cakes are baked from milk, sugar, an egg and wheat, leaving the buckets', () => {
    const M = I.MILK_BUCKET, S = I.SUGAR, W = I.WHEAT;
    expect(craft(grid3([M, M, M, S, I.EGG, S, W, W, W]), 3)).toEqual({ id: B.CAKE, count: 1 });
    expect(ITEMS[M].craftRemainder).toBe(I.BUCKET);
    expect(maxStack(B.CAKE)).toBe(1);
    expect(blockBoxes(B.CAKE, 0)[0][0]).toBeCloseTo(1 / 16);
    expect(blockBoxes(B.CAKE, 3)[0][0]).toBeCloseTo(7 / 16);
  });
});

describe('target blocks', () => {
  it('give more power the closer the hit is to the middle of the face', () => {
    expect(targetPower(10.5, 65.5, 4, [0, 0, -1])).toBe(15);
    expect(targetPower(10.99, 65.5, 4, [0, 0, -1])).toBe(1);
    expect(targetPower(10.75, 65.5, 4, [0, 0, -1])).toBe(8); // ceil(15 * 0.5)
    expect(targetPower(10.5, 66, 4.6, [0, 1, 0])).toBe(12); // on the top face: x and z count
    expect(targetPower(3, 65.5, 4.5, [1, 0, 0])).toBe(15);
    expect(targetTicks('arrow')).toBe(TARGET_TICKS_STUCK);
    expect(targetTicks('spear')).toBe(TARGET_TICKS_STUCK);
    expect(targetTicks('snowball')).toBe(TARGET_TICKS_THROWN);
    expect(craft(grid3([null, I.CINNABAR, null, I.CINNABAR, B.HAY_BALE, I.CINNABAR, null, I.CINNABAR, null]), 3)).toEqual({ id: B.TARGET, count: 1 });
  });

  it('send a signal for 8 or 20 ticks when struck, powering wire beside them', () => {
    const { world } = setup();
    world.setBlock(0, Y, 0, B.TARGET);
    world.setBlock(1, Y, 0, B.CINNABAR_WIRE);
    const hit = { x: 0, y: Y, z: 0, id: B.TARGET, face: [-1, 0, 0] };
    expect(projectileHit(world, { ...hit, id: B.STONE }, 0, Y + 0.5, 0.5, 'arrow')).toBe(false);
    expect(projectileHit(world, hit, 0, Y + 0.5, 0.5, 'snowball')).toBe(true);
    run(world, 1);
    expect(world.getMeta(0, Y, 0) & 15).toBe(15);
    expect(world.getMeta(1, Y, 0) & 15).toBe(15);
    run(world, TARGET_TICKS_THROWN);
    expect(world.getMeta(0, Y, 0) & 15).toBe(0);
    expect(world.getMeta(1, Y, 0) & 15).toBe(0);
    // an arrow off-centre: weaker, and longer; a second hit keeps it going
    projectileHit(world, hit, 0, Y + 0.9, 0.5, 'arrow');
    run(world, 1);
    const p = world.getMeta(0, Y, 0) & 15;
    expect(p).toBe(targetPower(0, Y + 0.9, 0.5, [-1, 0, 0]));
    expect(p).toBeLessThan(15);
    run(world, 10);
    projectileHit(world, hit, 0, Y + 0.5, 0.5, 'arrow');
    run(world, 15);
    expect(world.getMeta(0, Y, 0) & 15).toBe(15); // 25 ticks after the first hit, still on
    run(world, 10);
    expect(world.getMeta(0, Y, 0) & 15).toBe(0);
  });

  it('answer an arrow that sticks in them', () => {
    const { world } = setup();
    world.setBlock(0, Y, 0, B.TARGET);
    const calls = [];
    const game = {
      world, audio: { play() {} }, particles: { emit() {} },
      entities: { sweepHit: () => null },
      onProjectileHit: (hit, x, y, z, kind) => { calls.push(kind); projectileHit(world, hit, x, y, z, kind); },
    };
    const a = new Arrow(-2, Y + 0.5, 0.5, 1.5, 0, 0, null);
    for (let k = 0; k < 3 && !a.stuck; k++) a.tick(game);
    expect(a.stuck).toBe(true);
    expect(calls).toEqual(['arrow']);
    run(world, 1);
    expect(world.getMeta(0, Y, 0) & 15).toBeGreaterThanOrEqual(14);
  });
});

describe('dyed Gloomshell Boxes', () => {
  it('come in sixteen colours that are boxes like the plain one', () => {
    expect(BOX_COLORS.length).toBe(16);
    expect(BOX_IDS[0]).toBe(B.GLOOMSHELL_BOX);
    for (const id of BOX_COLORS) {
      expect(isBox(id)).toBe(true);
      expect(BLOCKS[id].container).toBe(true);
      expect(BLOCKS[id].drops).toBe(null);
      expect(maxStack(id)).toBe(1);
      expect(TEX_NAMES).toContain(BLOCKS[id].tex.side);
    }
    expect(BLOCKS[BOX_COLORS[COLOR.RED]].name).toBe('Red Gloomshell Box');
    expect(isBox(B.CHEST)).toBe(false);
  });

  it('keep their contents and name when dyed (or re-dyed)', () => {
    const contents = new Array(27).fill(null); contents[3] = { id: B.COBBLESTONE, count: 12, damage: 0 };
    const box = { id: B.GLOOMSHELL_BOX, count: 1, damage: 0, contents, label: 'Loot' };
    const red = craft([box, { id: DYES[COLOR.RED], count: 1 }, null, null], 2);
    expect(red.id).toBe(BOX_COLORS[COLOR.RED]);
    expect(red.contents[3]).toEqual({ id: B.COBBLESTONE, count: 12, damage: 0 });
    expect(red.label).toBe('Loot');
    const white = craft([null, { id: I.BONE_MEAL, count: 1 }, red, null], 2);
    expect(white.id).toBe(BOX_COLORS[COLOR.WHITE]);
    expect(white.contents[3].count).toBe(12);
    expect(craft([{ id: B.GLOOMSHELL_BOX, count: 1 }, { id: DYES[COLOR.BLUE], count: 1 }, null, null], 2)).toEqual({ id: BOX_COLORS[COLOR.BLUE], count: 1 });
  });
});
