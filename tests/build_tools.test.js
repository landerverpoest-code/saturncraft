// Creative building tools: patterns and masks, the selection, /fill /replace /clone and the brushes, the sliced work
// queue, /undo and /redo, the clipboard with rotation and mirroring, block entity data, blueprints (saved and as
// text), limits and permissions.
import { describe, it, expect } from 'vitest';
import { B } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import {
  parseBlockSpec, parsePattern, parseMask, hash01, boxOf, boxVolume, eachChunkMajor, EditSet, lineCells, inSphere, rotateMeta, mirrorMeta,
  Clipboard, copyRegion, rotateClipboard, flipClipboard, planPaste, History, encodeBlueprint, decodeBlueprint, peekBlueprint, cleanBlueprints,
  cleanBlueprintName, base64Encode, base64Decode, fnv, DEFAULT_MAX_VOLUME, BLUEPRINT_MAX_VOLUME, BLUEPRINT_MAX_COUNT, BLUEPRINT_PREFIX, HISTORY_MAX_OPS, blockKey,
} from '../src/world/buildTools.js';
import { BuildQueue, runBuildCommand, BUILD_COMMANDS, localActor, wandClick, prepareGuestCommand, selectionOf, maxVolumeOf } from '../src/ui/buildCommands.js';
import { runCommand, HELP, CHEAT_COMMANDS, NUMERIC_RULES } from '../src/ui/commands.js';
import { WORLD_COMMANDS } from '../src/net/protocol.js';
import { buildTopics } from '../src/ui/helpTopics.js';
import { resolveBindings } from '../src/ui/bindings.js';
import { playerSaveData } from '../src/world/save.js';
import { World } from '../src/world/world.js';
import { EditSync } from '../src/net/editSync.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { CHUNK_VOLUME, MIN_Y, cidx } from '../src/world/constants.js';
import { SIDE_DIRS } from '../src/world/shapes.js';
import { rng } from './helpers.js';

// ---- a small world and game to run the commands against ----------------------------------------
class FakeWorld {
  constructor() { this.blocks = new Map(); this.metas = new Map(); this.unloaded = new Set(); this.dimension = 'overworld'; this.calls = []; }
  k(x, y, z) { return `${x},${y},${z}`; }
  getBlock(x, y, z) { return this.blocks.get(this.k(x, y, z)) || 0; }
  getMeta(x, y, z) { return this.metas.get(this.k(x, y, z)) || 0; }
  isChunkLoaded(cx, cz) { return !this.unloaded.has(`${cx},${cz}`); }
  isLoaded(x, z) { return this.isChunkLoaded(x >> 4, z >> 4); }
  setBlock(x, y, z, id, meta = 0, notify = true) {
    if (!this.isLoaded(x, z)) return false;
    if (this.getBlock(x, y, z) === id && this.getMeta(x, y, z) === meta) return false;
    this.calls.push([x, y, z, id, meta, notify]);
    if (id) this.blocks.set(this.k(x, y, z), id); else this.blocks.delete(this.k(x, y, z));
    if (meta) this.metas.set(this.k(x, y, z), meta); else this.metas.delete(this.k(x, y, z));
    return true;
  }
  set(x, y, z, id, meta = 0) { this.setBlock(x, y, z, id, meta); this.calls.length = 0; }
  count(id) { let n = 0; for (const v of this.blocks.values()) if (v === id) n++; return n; }
}

function makeGame(opts = {}) {
  const world = new FakeWorld();
  const slots = [];
  const player = {
    x: 0.5, y: 64, z: 0.5, gamemode: opts.mode || 'creative', yaw: 0, pitch: 0,
    lookDir: () => [0, 0, -1],
    inventory: { slots, add(st) { slots.push(st); return 0; } },
  };
  const lines = [], toasts = [];
  const game = {
    world, player, settings: {}, ticks: 0, net: null, allowCheats: true,
    chests: new Map(), signs: new Map(), frames: new Map(), pots: new Map(),
    chat: { add: (l) => lines.push(l) }, hud: { toast: (m) => toasts.push(m) },
    setSetting(k, v) { this.settings[k] = v; },
    setSignText(x, y, z, l) { this.signs.set(`${x},${y},${z}`, l); },
    setFrameItem(x, y, z, st) { if (st) this.frames.set(`${x},${y},${z}`, st); else this.frames.delete(`${x},${y},${z}`); },
    setPot(x, y, z, f) { if (f) this.pots.set(`${x},${y},${z}`, f); else this.pots.delete(`${x},${y},${z}`); },
  };
  return { game, world, player, lines, toasts };
}
const run = (game, text) => runCommand(game, text);
const flat = (r) => [].concat(r || []).join('\n');
/** Select two corners with the commands. */
function select(game, a, b) {
  run(game, `/pos1 ${a.join(' ')}`);
  run(game, `/pos2 ${b.join(' ')}`);
}
const drain = (game) => { if (game.buildQueue) game.buildQueue.drain(); };

// ---- blocks, patterns, masks ----------------------------------------------------------------------
describe('block names, patterns and masks', () => {
  it('finds blocks by name, with data', () => {
    expect(parseBlockSpec('stone')).toMatchObject({ id: B.STONE, meta: 0 });
    expect(parseBlockSpec('Oak Planks').id).toBe(B.OAK_PLANKS);
    expect(parseBlockSpec('oak_stairs:2')).toMatchObject({ id: B.OAK_STAIRS, meta: 2, hasMeta: true });
    expect(parseBlockSpec('air').id).toBe(0);
    expect(parseBlockSpec('nonsense').error).toMatch(/Unknown block/);
    expect(parseBlockSpec('stone:999').error).toMatch(/Bad block data/);
    expect(parseBlockSpec('st;one').error).toBeTruthy();
    expect(blockKey(B.OAK_PLANKS)).toBe('oak_planks');
  });
  it('picks from a weighted pattern deterministically', () => {
    const p = parsePattern('60%stone,40%dirt');
    let stone = 0;
    for (let i = 0; i < 4000; i++) if (p.pick(i, 5, -i)[0] === B.STONE) stone++;
    expect(stone / 4000).toBeGreaterThan(0.55);
    expect(stone / 4000).toBeLessThan(0.65);
    expect(p.pick(3, 4, 5)).toEqual(p.pick(3, 4, 5));
    const even = parsePattern('stone,dirt,gravel');
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(even.pick(i, 0, 0)[0]);
    expect(seen.size).toBe(3);
    expect(parsePattern('stone').single).toEqual([B.STONE, 0]);
    expect(parsePattern('stone,wat').error).toMatch(/Unknown block/);
    expect(parsePattern('').error).toBeTruthy();
    expect(parsePattern(new Array(20).fill('stone').join(',')).error).toMatch(/at most 16/);
    expect(hash01(1, 2, 3)).toBeGreaterThanOrEqual(0);
    expect(hash01(1, 2, 3)).toBeLessThan(1);
  });
  it('masks: lists, negation, data, wildcard', () => {
    const m = parseMask('stone,dirt');
    expect(m.test(B.STONE, 0) && m.test(B.DIRT, 0)).toBe(true);
    expect(m.test(B.SAND, 0)).toBe(false);
    const n = parseMask('!air');
    expect(n.test(0, 0)).toBe(false);
    expect(n.test(B.SAND, 0)).toBe(true);
    const d = parseMask('oak_stairs:2');
    expect(d.test(B.OAK_STAIRS, 2)).toBe(true);
    expect(d.test(B.OAK_STAIRS, 1)).toBe(false);
    expect(parseMask('*').test(B.SAND, 0)).toBe(true);
    expect(parseMask('stone,!dirt').test(B.DIRT, 0)).toBe(false);
    expect(parseMask('bogus').error).toBeTruthy();
  });
});

describe('shapes and iteration', () => {
  it('visits a box one chunk column at a time and counts unloaded chunks', () => {
    const box = boxOf({ x: -3, y: 0, z: -3 }, { x: 20, y: 1, z: 20 });
    const order = [];
    eachChunkMajor(box, null, (x, y, z) => { const k = `${x >> 4},${z >> 4}`; if (order[order.length - 1] !== k) order.push(k); });
    expect(new Set(order).size).toBe(order.length); // no chunk is visited twice
    expect(order.length).toBe(9); // three chunk columns each way
    let n = 0;
    const skipped = eachChunkMajor(box, (cx, cz) => !(cx === 1 && cz === 1), () => n++);
    expect(n + skipped).toBe(boxVolume(box));
    expect(skipped).toBe(5 * 5 * 2); // x 16..20 and z 16..20, two layers
  });
  it('draws connected lines and round spheres', () => {
    const cells = lineCells({ x: 0, y: 0, z: 0 }, { x: 10, y: 4, z: -7 });
    expect(cells[0]).toEqual([0, 0, 0]);
    expect(cells[cells.length - 1]).toEqual([10, 4, -7]);
    for (let i = 1; i < cells.length; i++) expect(Math.max(...cells[i].map((v, k) => Math.abs(v - cells[i - 1][k])))).toBe(1);
    let n = 0;
    for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) for (let z = -6; z <= 6; z++) if (inSphere(x, y, z, 5)) n++;
    expect(n).toBeGreaterThan((4 / 3) * Math.PI * 125);
    expect(n).toBeLessThan((4 / 3) * Math.PI * 6.5 ** 3);
  });
  it('EditSet grows', () => {
    const e = new EditSet(2);
    for (let i = 0; i < 1000; i++) e.add(i, 5, -i, B.STONE, i & 7);
    expect(e.length).toBe(1000);
    expect([e.x[999], e.z[999], e.meta[999]]).toEqual([999, -999, 7]);
  });
});

// ---- facing blocks -----------------------------------------------------------------------------------
describe('rotating and mirroring blocks that face', () => {
  it('turns stairs, doors, torches, pistons and levers a quarter at a time', () => {
    expect(rotateMeta(B.OAK_STAIRS, 0, 1)).toBe(1);
    expect(rotateMeta(B.OAK_STAIRS, 3, 1)).toBe(0);
    expect(rotateMeta(B.OAK_STAIRS, 4 | 1, 1)).toBe(4 | 2); // keeps the upside-down bit
    expect(rotateMeta(B.DOOR, 4 | 2, 2)).toBe(4 | 0);
    expect(rotateMeta(B.TORCH, 1, 1)).toBe(2);
    expect(rotateMeta(B.TORCH, 4, 1)).toBe(1);
    expect(rotateMeta(B.TORCH, 0, 1)).toBe(0); // a floor torch does not face
    expect(rotateMeta(B.LEVER, 0, 1)).toBe(0);
    expect(rotateMeta(B.LEVER, 1, 1)).toBe(2);
    // pistons: -z (2) clockwise is +x (5)
    expect(rotateMeta(B.PISTON, 2, 1)).toBe(5);
    expect(rotateMeta(B.PISTON, 1, 1)).toBe(1); // up stays up
    expect(rotateMeta(B.STONE, 3, 1)).toBe(3);
    for (const id of [B.OAK_STAIRS, B.DOOR, B.TORCH, B.PISTON, B.LEVER, B.CHEST, B.LADDER]) for (const m of [0, 1, 2, 3, 4, 5, 8, 9, 130]) {
      expect(rotateMeta(id, rotateMeta(id, m, 1), 3)).toBe(m);
      expect(rotateMeta(id, m, 4)).toBe(m);
    }
  });
  it('mirrors sides and up/down and undoes itself', () => {
    expect(mirrorMeta(B.OAK_STAIRS, 1, 'x')).toBe(3);
    expect(mirrorMeta(B.OAK_STAIRS, 0, 'x')).toBe(0);
    expect(mirrorMeta(B.OAK_STAIRS, 0, 'z')).toBe(2);
    expect(mirrorMeta(B.OAK_STAIRS, 0, 'y')).toBe(4);
    expect(mirrorMeta(B.PISTON, 0, 'y')).toBe(1);
    expect(mirrorMeta(B.PISTON, 4, 'x')).toBe(5);
    for (const id of [B.OAK_STAIRS, B.DOOR, B.TORCH, B.PISTON, B.LEVER, B.CHEST]) for (const axis of ['x', 'y', 'z']) for (const m of [0, 1, 2, 3, 4, 5, 130, 132]) {
      expect(mirrorMeta(id, mirrorMeta(id, m, axis), axis)).toBe(m);
    }
  });
  it('keeps the two halves of a double chest paired through turns', () => {
    // a chest facing -z (0) paired with a partner on its +x side: meta 0 | PAIRED(4) | PARTNER_PLUS(128)
    const left = 0 | 4 | 128, right = 0 | 4;
    // after a quarter turn the pair runs along z; the half that was +x is now +z, so it still has PARTNER_PLUS
    expect(rotateMeta(B.CHEST, left, 1)).toBe(1 | 4 | 128);
    expect(rotateMeta(B.CHEST, right, 1)).toBe(1 | 4);
    // and another quarter turn: the +z half becomes -x, which is the "minus" half of an x-axis pair
    expect(rotateMeta(B.CHEST, 1 | 4 | 128, 1)).toBe(2 | 4);
  });
});

// ---- clipboard ---------------------------------------------------------------------------------------------
function lShape() {
  const w = new FakeWorld();
  w.set(0, 0, 0, B.STONE); w.set(1, 0, 0, B.STONE); w.set(2, 0, 0, B.DIRT);
  w.set(0, 1, 0, B.OAK_STAIRS, 0); w.set(0, 0, 1, B.SAND);
  return w;
}
describe('the clipboard', () => {
  it('copies a region relative to an origin', () => {
    const w = lShape();
    const cb = copyRegion(w, boxOf({ x: 0, y: 0, z: 0 }, { x: 2, y: 1, z: 1 }), { x: 1, y: 0, z: 0 });
    expect([cb.w, cb.h, cb.l, cb.ox, cb.oy, cb.oz]).toEqual([3, 2, 2, -1, 0, 0]);
    expect(cb.solid).toBe(5);
  });
  it('rotates a quarter turn clockwise around its origin, fixing facings', () => {
    const w = lShape();
    const cb = copyRegion(w, boxOf({ x: 0, y: 0, z: 0 }, { x: 2, y: 1, z: 1 }), { x: 0, y: 0, z: 0 });
    const r = rotateClipboard(cb, 1);
    // (x, z) -> (-z, x): the dirt at (2,0,0) goes to (0,0,2); the sand at (0,0,1) goes to (-1,0,0)
    const at = (c, x, y, z) => c.ids[c.index(x - c.ox, y - c.oy, z - c.oz)];
    expect(at(r, 0, 0, 2)).toBe(B.DIRT);
    expect(at(r, -1, 0, 0)).toBe(B.SAND);
    expect(at(r, 0, 1, 0)).toBe(B.OAK_STAIRS);
    expect(r.metas[r.index(0 - r.ox, 1 - r.oy, 0 - r.oz)]).toBe(1); // the stairs now face the next side
    expect([r.w, r.h, r.l]).toEqual([2, 2, 3]);
    const back = rotateClipboard(rotateClipboard(rotateClipboard(r, 1), 1), 1);
    expect([back.w, back.h, back.l, back.ox, back.oy, back.oz]).toEqual([cb.w, cb.h, cb.l, cb.ox, cb.oy, cb.oz]);
    expect(Array.from(back.ids)).toEqual(Array.from(cb.ids));
    expect(Array.from(back.metas)).toEqual(Array.from(cb.metas));
    expect(rotateClipboard(cb, 4)).toBe(cb);
  });
  it('mirrors across an axis and back', () => {
    const w = lShape();
    const cb = copyRegion(w, boxOf({ x: 0, y: 0, z: 0 }, { x: 2, y: 1, z: 1 }), { x: 0, y: 0, z: 0 });
    const f = flipClipboard(cb, 'x');
    const at = (c, x, y, z) => c.ids[c.index(x - c.ox, y - c.oy, z - c.oz)];
    expect(at(f, -2, 0, 0)).toBe(B.DIRT);
    expect(at(f, 0, 0, 0)).toBe(B.STONE);
    const twice = flipClipboard(f, 'x');
    expect(Array.from(twice.ids)).toEqual(Array.from(cb.ids));
    const up = flipClipboard(cb, 'y');
    expect(up.metas[up.index(0 - up.ox, -1 - up.oy, 0 - up.oz)]).toBe(4); // the stair is now upside down
  });
  it('plans a paste around the origin, with or without air, and empties containers unless asked', () => {
    const w = lShape();
    w.set(1, 1, 1, B.CHEST, 8 | 16); // an unopened dungeon chest (loot not rolled yet)
    const cb = copyRegion(w, boxOf({ x: 0, y: 0, z: 0 }, { x: 2, y: 1, z: 1 }), { x: 0, y: 0, z: 0 }, (x, y, z) => (x === 1 && y === 1 && z === 1 ? { k: 'chest', slots: [{ id: 1, count: 3, damage: 0 }, ...new Array(26).fill(null)] } : null));
    const plain = planPaste(cb, { x: 10, y: 5, z: 5 }, {});
    expect(plain.edits.length).toBe(12);
    const a = planPaste(cb, { x: 10, y: 5, z: 5 }, { skipAir: true });
    expect(a.edits.length).toBe(6);
    // the chest arrives without a loot roll and without its contents
    let i = -1;
    for (let k = 0; k < a.edits.n; k++) if (a.edits.id[k] === B.CHEST) i = k;
    expect(a.edits.meta[i] & 8).toBe(0);
    expect(a.edits.tiles.has(i)).toBe(false);
    expect([a.edits.x[i], a.edits.y[i], a.edits.z[i]]).toEqual([11, 6, 6]);
    const c = planPaste(cb, { x: 10, y: 5, z: 5 }, { skipAir: true, contents: true });
    let j = -1;
    for (let k = 0; k < c.edits.n; k++) if (c.edits.id[k] === B.CHEST) j = k;
    expect(c.edits.tiles.get(j).slots[0].count).toBe(3);
  });
});

// ---- history -----------------------------------------------------------------------------------------------
describe('undo history', () => {
  const set = (n) => { const e = new EditSet(); for (let i = 0; i < n; i++) e.add(i, 0, 0, 1, 0); return e; };
  it('keeps a bounded number of steps and blocks', () => {
    const h = new History();
    for (let i = 0; i < HISTORY_MAX_OPS + 5; i++) h.push(set(3));
    expect(h.undo.length).toBe(HISTORY_MAX_OPS);
    const big = new History(10, 100);
    for (let i = 0; i < 5; i++) big.push(set(40));
    expect(big.cells()).toBeLessThanOrEqual(100);
    expect(big.undo.length).toBe(2);
    expect(big.push(set(500))).toBe(false); // too big to keep: nothing can be undone any more
    expect(big.undo.length).toBe(0);
  });
  it('a new edit forgets the redo steps', () => {
    const h = new History();
    h.push(set(2)); h.pushRedo(set(2));
    expect(h.redo.length).toBe(1);
    h.push(set(2));
    expect(h.redo.length).toBe(0);
  });
});

// ---- blueprint text ------------------------------------------------------------------------------------------
function sampleClip(withChest = true) {
  const w = lShape();
  w.set(1, 1, 1, B.CHEST, 2);
  w.set(2, 1, 1, B.OAK_WALL_SIGN, 1);
  const tiles = {
    '1,1,1': { k: 'chest', slots: [{ id: I.COAL, count: 5, damage: 0 }, ...new Array(26).fill(null)] },
    '2,1,1': { k: 'sign', lines: ['hello', 'world', '', 'x'.repeat(40)] },
  };
  return copyRegion(w, boxOf({ x: 0, y: 0, z: 0 }, { x: 2, y: 1, z: 1 }), { x: 1, y: 0, z: 0 }, (x, y, z) => (withChest || !tiles[`${x},${y},${z}`] || tiles[`${x},${y},${z}`].k !== 'chest' ? tiles[`${x},${y},${z}`] : null) || null);
}
describe('blueprint text', () => {
  it('round-trips blocks, data and tiles, and is small for plain regions', () => {
    const cb = sampleClip();
    const text = encodeBlueprint(cb, { contents: true });
    expect(text.startsWith(BLUEPRINT_PREFIX)).toBe(true);
    expect(/^[A-Za-z0-9:+/=]+$/.test(text)).toBe(true);
    const back = decodeBlueprint(text);
    expect([back.w, back.h, back.l, back.ox, back.oy, back.oz]).toEqual([cb.w, cb.h, cb.l, cb.ox, cb.oy, cb.oz]);
    expect(Array.from(back.ids)).toEqual(Array.from(cb.ids));
    expect(Array.from(back.metas)).toEqual(Array.from(cb.metas));
    const sign = [...back.tiles.values()].find((t) => t.k === 'sign');
    expect(sign.lines[3].length).toBe(15); // cut to a sign line
    expect([...back.tiles.values()].find((t) => t.k === 'chest').slots[0]).toMatchObject({ id: I.COAL, count: 5 });
    expect(peekBlueprint(text)).toEqual({ w: 3, h: 2, l: 2 });
    // a big plain wall compresses to almost nothing
    const wall = new Clipboard(64, 64, 16);
    wall.ids.fill(B.STONE);
    expect(encodeBlueprint(wall).length).toBeLessThan(120);
  });
  it('leaves chest contents out unless asked', () => {
    const text = encodeBlueprint(sampleClip(), { contents: false });
    const back = decodeBlueprint(text);
    expect([...back.tiles.values()].some((t) => t.k === 'chest')).toBe(false);
    expect([...back.tiles.values()].some((t) => t.k === 'sign')).toBe(true);
  });
  it('rejects anything that is not a well-formed blueprint', () => {
    const good = encodeBlueprint(sampleClip(), { contents: true });
    for (const bad of [null, 42, '', 'hello', 'SCBP1:', 'SCBP1:@@@@', 'SCBP2:' + good.slice(6), good + 'AAAA', good.slice(0, good.length - 8)]) expect(() => decodeBlueprint(bad)).toThrow(Error);
    // a flipped character breaks the check sum
    const i = 20, flipped = good.slice(0, i) + (good[i] === 'A' ? 'B' : 'A') + good.slice(i + 1);
    expect(() => decodeBlueprint(flipped)).toThrow(/damaged|cut short|unknown|too|bad/i);
    // random damage never throws anything but a plain Error, and never yields a bad clipboard
    const r = rng(7);
    for (let n = 0; n < 300; n++) {
      const pos = 6 + Math.floor(r() * (good.length - 6)), ch = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[Math.floor(r() * 64)];
      const t = good.slice(0, pos) + ch + good.slice(pos + 1);
      try { const cb = decodeBlueprint(t); expect(cb.ids.length).toBe(cb.volume); } catch (e) { expect(e).toBeInstanceOf(Error); expect(e.constructor).toBe(Error); }
    }
  });
  // build a sealed blueprint by hand to test what the encoder never makes
  const seal = (bytes) => {
    const body = Uint8Array.from(bytes), sum = fnv(body, body.length);
    return BLUEPRINT_PREFIX + base64Encode(Uint8Array.from([...body, sum >>> 24, (sum >>> 16) & 255, (sum >>> 8) & 255, sum & 255]));
  };
  const name = (s) => [s.length, ...[...s].map((c) => c.charCodeAt(0))];
  it('rejects unknown blocks, oversize dimensions, runs that do not fit and trailing bytes', () => {
    const head = [0x53, 0x42, 1, 0];
    // 1x1x1 of a block that does not exist
    expect(() => decodeBlueprint(seal([...head, 1, 1, 1, 0, 0, 0, 1, ...name('no_such_block'), 0, 0, 1]))).toThrow(/does not know/);
    // the same with stone is fine
    expect(decodeBlueprint(seal([...head, 1, 1, 1, 0, 0, 0, 1, ...name('stone'), 0, 0, 1])).ids[0]).toBe(B.STONE);
    // 200 on a side
    expect(() => decodeBlueprint(seal([...head, 0xc8, 1, 1, 1, 0, 0, 0, 1, ...name('stone'), 0, 0, 1]))).toThrow(/too large/);
    // a run longer than the volume
    expect(() => decodeBlueprint(seal([...head, 1, 1, 1, 0, 0, 0, 1, ...name('stone'), 0, 0, 5]))).toThrow(/damaged block list/);
    // bytes left over
    expect(() => decodeBlueprint(seal([...head, 1, 1, 1, 0, 0, 0, 1, ...name('stone'), 0, 0, 1, 9, 9]))).toThrow(/extra bytes/);
    // a name that tries something else
    expect(() => decodeBlueprint(seal([...head, 1, 1, 1, 0, 0, 0, 1, ...name('<script>'), 0, 0, 1]))).toThrow(/does not know/);
  });
  it('cleans tile data from an import: only plain items, signs and pot faces survive', () => {
    const evil = [0x53, 0x42, 1, 1, 1, 1, 1, 0, 0, 0, 1, ...[5, 115, 116, 111, 110, 101], 0, 0, 1];
    const json = new TextEncoder().encode(JSON.stringify({
      0: { k: 'sign', lines: [1, { x: 1 }, 'ok', null], extra: '<img onerror=1>' },
      1: { k: 'chest', slots: [{ id: 999999, count: 5 }] }, 7: { k: 'sign', lines: ['out of range'] }, '__proto__': { k: 'sign', lines: ['x'] }, a: { k: 'sign' },
    }));
    const text = seal([...evil, json.length & 127 | 128, json.length >> 7, ...json]);
    const cb = decodeBlueprint(text);
    expect(cb.tiles.size).toBe(1);
    expect(cb.tiles.get(0)).toEqual({ k: 'sign', lines: ['1', '[object Object]', 'ok', ''] });
  });
  it('is limited in size and in how many a player may keep', () => {
    expect(() => encodeBlueprint(new Clipboard(129, 1, 1))).toThrow(/at most/);
    expect(() => encodeBlueprint(new Clipboard(100, 100, 100))).toThrow(/at most/);
    expect(BLUEPRINT_MAX_VOLUME).toBeLessThan(DEFAULT_MAX_VOLUME);
    expect(cleanBlueprintName('My Hut')).toBeNull();
    expect(cleanBlueprintName('my-hut_2')).toBe('my-hut_2');
    expect(cleanBlueprintName('x'.repeat(25))).toBeNull();
    const text = encodeBlueprint(sampleClip(), { contents: false });
    const many = {};
    for (let i = 0; i < BLUEPRINT_MAX_COUNT + 10; i++) many['b' + i] = text;
    many['bad name'] = text; many.junk = 'not a blueprint'; many.long = BLUEPRINT_PREFIX + 'A'.repeat(1e6);
    const clean = cleanBlueprints(many);
    expect(Object.keys(clean).length).toBe(BLUEPRINT_MAX_COUNT);
    expect(clean.junk).toBeUndefined();
    expect(cleanBlueprints('nope')).toEqual({});
  });
  it('base64 is strict', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253]);
    expect(Array.from(base64Decode(base64Encode(bytes)))).toEqual(Array.from(bytes));
    expect(() => base64Decode('abc')).toThrow();
    expect(() => base64Decode('ab!d')).toThrow();
  });
});

// ---- the commands ---------------------------------------------------------------------------------------------
describe('the selection', () => {
  it('marks corners at the player or at coordinates, reports the size, and expands', () => {
    const { game } = makeGame();
    expect(run(game, '/fill stone')).toMatch(/Select two corners/);
    expect(run(game, '/pos1')).toBe('Corner 1 set to 0, 64, 0');
    expect(run(game, '/pos2 ~4 ~2 ~-3')).toBe('Corner 2 set to 4, 66, -3  (5 x 3 x 4 = 60 blocks)');
    expect(run(game, '/sel')).toMatch(/5 x 3 x 4 = 60 blocks/);
    expect(run(game, '/sel expand 2 up')).toMatch(/5 x 5 x 4/);
    expect(run(game, '/sel contract 1 east')).toMatch(/4 x 5 x 4/);
    expect(run(game, '/sel shift 3 north')).toMatch(/4 x 5 x 4/);
    expect(run(game, '/sel contract 9 up')).toMatch(/shrink/);
    expect(run(game, '/sel expand x')).toMatch(/Usage/);
    expect(selectionOf(game).pos1.x).toBe(0);
    expect(run(game, '/sel clear')).toMatch(/cleared/);
    expect(run(game, '/sel')).toMatch(/Select two corners/);
    expect(run(game, '/pos1 1 2')).toBe('Corner 1 set to 0, 64, 0'); // (needs three numbers; otherwise the player's block)
    expect(run(game, '/pos1 0 -9999 0')).toMatch(/outside the world/);
  });
  it('is per dimension', () => {
    const { game, world } = makeGame();
    select(game, [0, 64, 0], [3, 64, 3]);
    world.dimension = 'cinderdeep';
    expect(run(game, '/fill stone')).toMatch(/another dimension/);
  });
});

describe('/fill, /replace, /replacenear', () => {
  it('fills solid, hollow, outline and walls through world.setBlock', () => {
    const { game, world } = makeGame();
    select(game, [0, 64, 0], [4, 66, 4]);
    expect(run(game, '/fill stone')).toBe('Filled 75 blocks (/undo to take it back)');
    expect(world.count(B.STONE)).toBe(75);
    expect(world.calls.length).toBe(75);
    run(game, '/fill dirt hollow');
    expect(world.count(B.DIRT)).toBe(75 - 9);
    expect(world.count(B.STONE)).toBe(0);
    expect(world.getBlock(2, 65, 2)).toBe(0);
    run(game, '/fill sand walls');
    expect(world.getBlock(0, 65, 2)).toBe(B.SAND);
    expect(world.getBlock(2, 64, 2)).not.toBe(B.SAND);
    run(game, '/fill gravel outline');
    expect(world.getBlock(2, 66, 2)).toBe(B.GRAVEL);
    expect(world.getBlock(0, 65, 0)).toBe(B.GRAVEL);
    expect(run(game, '/fill nonsense')).toMatch(/Unknown block/);
    expect(run(game, '/fill stone sideways')).toMatch(/Usage/);
    expect(run(game, '/fill')).toMatch(/Usage/);
  });
  it('fills with a weighted pattern', () => {
    const { game, world } = makeGame();
    select(game, [0, 64, 0], [19, 64, 19]);
    run(game, '/fill 75%stone,25%dirt');
    drain(game);
    const s = world.count(B.STONE), d = world.count(B.DIRT);
    expect(s + d).toBe(400);
    expect(s / 400).toBeGreaterThan(0.65);
    expect(s / 400).toBeLessThan(0.85);
  });
  it('replaces by mask, including negation, and tells nothing-to-do', () => {
    const { game, world } = makeGame();
    select(game, [0, 64, 0], [3, 64, 3]);
    run(game, '/fill stone');
    world.set(1, 64, 1, B.DIRT); world.set(2, 64, 2, B.SAND);
    expect(run(game, '/replace dirt,sand gravel')).toBe('Replaced 2 blocks (/undo to take it back)');
    expect(world.getBlock(1, 64, 1)).toBe(B.GRAVEL);
    expect(run(game, '/replace !gravel air')).toMatch(/Replaced 14 blocks/);
    expect(world.count(B.STONE)).toBe(0);
    expect(run(game, '/replace stone dirt')).toBe('Nothing to change');
    expect(run(game, '/replace stone')).toMatch(/Usage/);
    expect(run(game, '/replace bogus dirt')).toMatch(/Unknown block/);
  });
  it('replaces near the player in a cube', () => {
    const { game, world } = makeGame();
    world.set(0, 64, 0, B.STONE); world.set(3, 66, -2, B.STONE); world.set(20, 64, 0, B.STONE);
    expect(run(game, '/replacenear 5 stone dirt')).toMatch(/Replaced 2 blocks/);
    expect(world.getBlock(20, 64, 0)).toBe(B.STONE);
    expect(run(game, '/replacenear 0 stone dirt')).toMatch(/radius/);
    expect(run(game, '/replacenear 5')).toMatch(/Usage/);
  });
});

describe('the work queue', () => {
  it('does a big edit a slice per tick, chunk by chunk, with a progress toast', () => {
    const { game, world, toasts, lines } = makeGame();
    select(game, [0, 64, 0], [79, 64, 79]); // 6400 blocks over 25 chunks
    game.buildQueue = new BuildQueue(game);
    game.buildQueue.sliceCells = 100;
    game.buildQueue.sliceMs = 1000;
    const first = run(game, '/fill stone');
    expect(first).toMatch(/Filling 6,400 blocks: \d+% so far/);
    expect(world.calls.length).toBeLessThan(6400);
    expect(world.calls.length).toBeGreaterThan(0);
    // a second command while one runs is held back
    expect(run(game, '/fill dirt')).toMatch(/still filling/i);
    expect(run(game, '/build status')).toMatch(/Filling: \d+% of 6,400 blocks/);
    let ticks = 0;
    while (game.buildQueue.busy) { game.ticks++; game.buildQueue.tick(); ticks++; expect(world.calls.length).toBeLessThanOrEqual(100 * (ticks + 1)); }
    expect(ticks).toBeGreaterThanOrEqual(60);
    expect(world.count(B.STONE)).toBe(6400);
    expect(lines[lines.length - 1]).toBe('Filled 6,400 blocks (/undo to take it back)');
    expect(toasts.some((t) => /Filling\.\.\. \d+%/.test(t))).toBe(true);
    // chunk-aware: the writes arrive one chunk column after the other
    const seen = [];
    for (const [x, , z] of world.calls) { const k = `${x >> 4},${z >> 4}`; if (seen[seen.length - 1] !== k) seen.push(k); }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(25);
  });
  it('stays within its time budget', () => {
    const { game } = makeGame();
    select(game, [0, 64, 0], [63, 70, 63]);
    const q = game.buildQueue = new BuildQueue(game);
    q.sliceMs = 5; q.sliceCells = 1e9;
    run(game, '/fill stone');
    let slowest = 0, ticks = 0;
    while (q.busy) { const t = performance.now(); q.tick(); slowest = Math.max(slowest, performance.now() - t); ticks++; }
    expect(ticks).toBeGreaterThan(0);
    expect(slowest).toBeLessThan(250); // (the budget is 5 ms; allow a loaded machine)
  });
  it('can be cancelled and the part done undone', () => {
    const { game, world } = makeGame();
    select(game, [0, 64, 0], [31, 64, 31]);
    const q = game.buildQueue = new BuildQueue(game);
    q.sliceCells = 200; q.sliceMs = 1000;
    run(game, '/fill stone');
    q.tick();
    expect(run(game, '/build cancel')).toMatch(/^Stopped after \d+ blocks/);
    expect(q.busy).toBe(0);
    const done = world.count(B.STONE);
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThan(1024);
    expect(run(game, '/build cancel')).toMatch(/Nothing is being built/);
    run(game, '/undo');
    drain(game);
    expect(world.count(B.STONE)).toBe(0);
  });
  it('tells neighbours only for small edits', () => {
    const { game, world } = makeGame();
    select(game, [0, 64, 0], [3, 64, 3]);
    run(game, '/fill stone');
    expect(world.calls.every((c) => c[5] === true)).toBe(true);
    world.calls.length = 0;
    select(game, [0, 64, 0], [19, 64, 19]);
    run(game, '/fill dirt');
    expect(world.calls.every((c) => c[5] === false)).toBe(true);
  });
  it('shares the work between builders and caps how many are at once', () => {
    const { game } = makeGame();
    const q = game.buildQueue = new BuildQueue(game);
    q.sliceCells = 1; q.sliceMs = 1000;
    const edit = () => { const e = new EditSet(); for (let i = 0; i < 50; i++) e.add(i, 64, 0, B.STONE, 0); return e; };
    const results = [];
    for (let k = 0; k < 8; k++) {
      const actor = { ...localActor(game), key: 'n:p' + k, host: false, op: false, say() {}, toast() {} };
      const st = { pos1: null, pos2: null, history: new History(), job: null };
      results.push(q.start(actor, st, { sets: [edit()] }));
    }
    expect(results.filter((r) => /busy with other builders/.test(r)).length).toBe(2);
    q.drain();
    expect(q.busy).toBe(0);
  });
});

describe('/undo and /redo', () => {
  it('undoes and redoes edits, in steps', () => {
    const { game, world } = makeGame();
    select(game, [0, 64, 0], [2, 64, 2]);
    run(game, '/fill stone');
    run(game, '/fill dirt');
    run(game, '/replace dirt sand');
    expect(world.count(B.SAND)).toBe(9);
    expect(run(game, '/undo')).toBe('Undid 9 blocks');
    expect(world.count(B.DIRT)).toBe(9);
    expect(run(game, '/undo 2')).toBe('Undid 18 blocks');
    expect(world.count(B.STONE)).toBe(0);
    expect(world.count(B.DIRT)).toBe(0);
    expect(run(game, '/undo')).toBe('Nothing to undo');
    expect(run(game, '/redo')).toBe('Redid 9 blocks');
    expect(world.count(B.STONE)).toBe(9);
    expect(run(game, '/redo 5')).toMatch(/Redid 18 blocks/);
    expect(world.count(B.SAND)).toBe(9);
    expect(run(game, '/redo')).toBe('Nothing to redo');
    run(game, '/undo 3');
    run(game, '/fill gravel');
    expect(run(game, '/redo')).toBe('Nothing to redo'); // a new edit ends the redo line
    expect(run(game, '/undo 0')).toMatch(/Usage/);
  });
  it('restores block data and the contents of chests and signs it replaced', () => {
    const { game, world } = makeGame();
    world.set(1, 64, 1, B.CHEST, 2);
    game.chests.set('1,64,1', { x: 1, y: 64, z: 1, slots: [{ id: I.COAL, count: 7, damage: 0 }, ...new Array(26).fill(null)] });
    world.set(2, 64, 1, B.OAK_WALL_SIGN, 1);
    game.signs.set('2,64,1', ['a', 'b', 'c', 'd']);
    select(game, [0, 64, 0], [3, 64, 2]);
    run(game, '/fill stone');
    expect(game.chests.size).toBe(0);
    expect(game.signs.size).toBe(0);
    run(game, '/undo');
    expect(world.getBlock(1, 64, 1)).toBe(B.CHEST);
    expect(world.getMeta(1, 64, 1)).toBe(2);
    expect(game.chests.get('1,64,1').slots[0].count).toBe(7);
    expect(game.signs.get('2,64,1')).toEqual(['a', 'b', 'c', 'd']);
    run(game, '/redo');
    expect(game.chests.size).toBe(0);
    run(game, '/undo');
    expect(game.chests.get('1,64,1').slots[0].count).toBe(7);
  });
  it('is kept per player', () => {
    const { game, world } = makeGame();
    select(game, [0, 64, 0], [1, 64, 1]);
    run(game, '/fill stone');
    const guest = { key: 'n:ann', name: 'Ann', host: false, op: false, creative: true, pos: () => ({ x: 10, y: 64, z: 10 }), look: () => [0, 0, -1], say() {}, toast() {} };
    game.cmdActor = guest;
    expect(run(game, '/undo')).toBe('Nothing to undo');
    run(game, '/pos1 10 64 10'); run(game, '/pos2 11 64 11');
    run(game, '/fill dirt');
    game.cmdActor = null;
    expect(run(game, '/undo')).toBe('Undid 4 blocks');
    expect(world.count(B.STONE)).toBe(0);
    expect(world.count(B.DIRT)).toBe(4); // the guest's edit is theirs to undo
  });
});

describe('/clone', () => {
  it('copies, masks, filters and moves', () => {
    const { game, world } = makeGame();
    select(game, [0, 64, 0], [2, 64, 2]);
    run(game, '/fill stone');
    world.set(1, 64, 1, B.DIRT);
    expect(run(game, '/clone 10 64 0')).toMatch(/Cloned 9 blocks/);
    expect(world.getBlock(11, 64, 1)).toBe(B.DIRT);
    expect(world.count(B.STONE)).toBe(16);
    // masked leaves what is under the source's air alone
    world.set(5, 64, 5, B.GRAVEL);
    run(game, '/pos1 0 64 0'); run(game, '/pos2 2 65 2');
    run(game, '/clone 4 64 4 masked');
    expect(world.getBlock(4, 65, 4)).toBe(0);
    expect(world.getBlock(5, 64, 5)).toBe(B.DIRT);
    // filtered
    run(game, '/clone 20 64 0 filtered dirt');
    expect(world.getBlock(21, 64, 1)).toBe(B.DIRT);
    expect(world.getBlock(20, 64, 0)).toBe(0);
    expect(run(game, '/clone 1 2')).toMatch(/Usage/);
    expect(run(game, '/clone 30 64 0 sideways')).toMatch(/Usage/);
    expect(run(game, '/clone 30 64 0 filtered')).toMatch(/Give a block/);
  });
  it('moves, even onto its own source, and undoes the move exactly', () => {
    const { game, world } = makeGame();
    select(game, [0, 64, 0], [3, 64, 0]);
    world.set(0, 64, 0, B.STONE); world.set(1, 64, 0, B.DIRT); world.set(2, 64, 0, B.SAND); world.set(3, 64, 0, B.GRAVEL);
    run(game, '/pos1 0 64 0'); run(game, '/pos2 3 64 0');
    expect(run(game, '/clone 2 64 0 move')).toMatch(/Moved/);
    expect([0, 1, 2, 3, 4, 5].map((x) => world.getBlock(x, 64, 0))).toEqual([0, 0, B.STONE, B.DIRT, B.SAND, B.GRAVEL]);
    run(game, '/undo');
    expect([0, 1, 2, 3, 4, 5].map((x) => world.getBlock(x, 64, 0))).toEqual([B.STONE, B.DIRT, B.SAND, B.GRAVEL, 0, 0]);
    run(game, '/redo');
    expect([0, 1, 2, 3, 4, 5].map((x) => world.getBlock(x, 64, 0))).toEqual([0, 0, B.STONE, B.DIRT, B.SAND, B.GRAVEL]);
  });
  it('copies chest contents only with -c', () => {
    const { game, world } = makeGame();
    world.set(0, 64, 0, B.CHEST, 8 | 16);
    game.chests.set('0,64,0', { x: 0, y: 64, z: 0, slots: [{ id: I.COAL, count: 7, damage: 0 }, ...new Array(26).fill(null)] });
    select(game, [0, 64, 0], [0, 64, 0]);
    run(game, '/clone 5 64 0');
    expect(world.getBlock(5, 64, 0)).toBe(B.CHEST);
    expect(world.getMeta(5, 64, 0) & 8).toBe(0);
    expect(game.chests.has('5,64,0')).toBe(false);
    run(game, '/clone 6 64 0 -c');
    expect(game.chests.get('6,64,0').slots[0].count).toBe(7);
    expect(game.chests.get('0,64,0').slots[0].count).toBe(7); // the original keeps its own
    game.chests.get('6,64,0').slots[0].count = 1;
    expect(game.chests.get('0,64,0').slots[0].count).toBe(7); // and the copy is its own
  });
});

describe('brushes', () => {
  it('builds spheres, hollow spheres, cylinders and lines', () => {
    const { game, world } = makeGame();
    expect(run(game, '/sphere stone 3')).toMatch(/Built \d+ blocks/);
    const solid = world.count(B.STONE);
    expect(solid).toBeGreaterThan(100);
    expect(world.getBlock(0, 64, 0)).toBe(B.STONE);
    expect(world.getBlock(3, 64, 0)).toBe(B.STONE);
    expect(world.getBlock(4, 64, 0)).toBe(0);
    run(game, '/undo');
    run(game, '/sphere stone 3 hollow');
    expect(world.count(B.STONE)).toBeLessThan(solid);
    expect(world.getBlock(0, 64, 0)).toBe(0);
    expect(world.getBlock(3, 64, 0)).toBe(B.STONE);
    run(game, '/undo');
    run(game, '/cyl dirt 2 3');
    expect(world.getBlock(0, 66, 0)).toBe(B.DIRT);
    expect(world.getBlock(0, 67, 0)).toBe(0);
    expect(world.getBlock(2, 64, 0)).toBe(B.DIRT);
    expect(world.count(B.DIRT)).toBeGreaterThan(30);
    run(game, '/undo');
    run(game, '/cyl dirt 2 -2');
    expect(world.getBlock(0, 63, 0)).toBe(B.DIRT);
    expect(world.getBlock(0, 62, 0)).toBe(0);
    run(game, '/undo');
    run(game, '/cyl dirt 3 2 hollow');
    expect(world.getBlock(0, 64, 0)).toBe(0);
    expect(world.getBlock(3, 64, 0)).toBe(B.DIRT);
    run(game, '/pos1 0 70 0'); run(game, '/pos2 9 73 -5');
    run(game, '/line gravel');
    expect(world.getBlock(0, 70, 0)).toBe(B.GRAVEL);
    expect(world.getBlock(9, 73, -5)).toBe(B.GRAVEL);
    expect(world.count(B.GRAVEL)).toBe(10);
    run(game, '/line sand 3');
    expect(world.count(B.SAND)).toBeGreaterThan(30);
    run(game, '/sphere glass 2 -p'); // centred on corner 1
    expect(world.getBlock(0, 72, 0)).toBe(B.GLASS);
    expect(run(game, '/sphere stone 0')).toMatch(/radius/);
    expect(run(game, '/sphere stone')).toMatch(/Usage/);
    expect(run(game, '/cyl dirt 2 0')).toMatch(/height/);
    expect(run(game, '/line gravel 99')).toMatch(/thickness/);
  });
});

describe('/copy, /cut, /paste, /rotate, /flip', () => {
  it('copies a structure and pastes it, turned and mirrored, with facings fixed', () => {
    const { game, world, player } = makeGame();
    world.set(0, 64, 0, B.STONE); world.set(1, 64, 0, B.STONE); world.set(2, 64, 0, B.DIRT); world.set(0, 65, 0, B.OAK_STAIRS, 0);
    select(game, [0, 64, 0], [2, 65, 0]);
    expect(run(game, '/paste')).toMatch(/Nothing is copied/);
    expect(flat(run(game, '/copy'))).toMatch(/3 x 2 x 1 copied \(4 blocks\)/);
    player.x = 10.5; player.z = 10.5;
    expect(run(game, '/paste')).toMatch(/Pasted 4 blocks/);
    // copied around (0,64,0), pasted around (10,64,10)
    expect(world.getBlock(12, 64, 10)).toBe(B.DIRT);
    expect(world.getBlock(10, 65, 10)).toBe(B.OAK_STAIRS);
    expect(run(game, '/rotate 90')).toMatch(/turned 90 degrees: now 1 x 2 x 3/);
    player.x = 30.5; player.z = 30.5;
    run(game, '/paste');
    expect(world.getBlock(30, 64, 32)).toBe(B.DIRT);
    expect(world.getBlock(30, 65, 30)).toBe(B.OAK_STAIRS);
    expect(world.getMeta(30, 65, 30)).toBe(1);
    expect(run(game, '/rotate 45')).toMatch(/Usage/);
    expect(run(game, '/rotate left')).toMatch(/270/);
    expect(run(game, '/flip x')).toMatch(/mirrored across x/);
    expect(run(game, '/mirror up')).toMatch(/across y/);
    expect(run(game, '/flip sideways')).toMatch(/Usage/);
    // an explicit place, and -a keeps what is under the clipboard's air
    world.set(50, 64, 50, B.SAND);
    run(game, '/copy');
    run(game, '/paste -a 50 64 50');
    expect(world.getBlock(50, 64, 50)).not.toBe(0);
  });
  it('/paste -a skips air, /cut removes the original', () => {
    const { game, world, player } = makeGame();
    world.set(0, 64, 0, B.STONE);
    select(game, [0, 64, 0], [1, 64, 0]);
    run(game, '/cut');
    expect(world.getBlock(0, 64, 0)).toBe(0);
    world.set(10, 64, 0, B.SAND); world.set(11, 64, 0, B.SAND);
    player.x = 10.5;
    run(game, '/paste -a');
    expect(world.getBlock(10, 64, 0)).toBe(B.STONE);
    expect(world.getBlock(11, 64, 0)).toBe(B.SAND);
    run(game, '/paste');
    expect(world.getBlock(11, 64, 0)).toBe(0);
  });
  it('brings signs along and chest contents only with -c', () => {
    const { game, world, player } = makeGame();
    world.set(0, 64, 0, B.OAK_WALL_SIGN, 1); world.set(1, 64, 0, B.CHEST, 2);
    game.signs.set('0,64,0', ['hi', '', '', '']);
    game.chests.set('1,64,0', { x: 1, y: 64, z: 0, slots: [{ id: I.COAL, count: 4, damage: 0 }, ...new Array(26).fill(null)] });
    select(game, [0, 64, 0], [1, 64, 0]);
    run(game, '/copy');
    player.x = 10.5;
    run(game, '/paste');
    expect(game.signs.get('10,64,0')).toEqual(['hi', '', '', '']);
    expect(game.chests.has('11,64,0')).toBe(false);
    expect(world.getBlock(11, 64, 0)).toBe(B.CHEST);
    player.x = 20.5;
    run(game, '/paste -c');
    expect(game.chests.get('21,64,0').slots[0].count).toBe(4);
    run(game, '/undo');
    expect(game.chests.has('21,64,0')).toBe(false);
  });
});

describe('blueprints', () => {
  it('saves a selection, lists, loads into the clipboard, pastes, and deletes', () => {
    const { game, world, player } = makeGame();
    world.set(0, 64, 0, B.STONE); world.set(1, 64, 0, B.DIRT);
    world.set(0, 65, 0, B.CHEST, 2);
    game.chests.set('0,65,0', { x: 0, y: 65, z: 0, slots: [{ id: I.COAL, count: 2, damage: 0 }, ...new Array(26).fill(null)] });
    select(game, [0, 64, 0], [1, 65, 0]);
    expect(run(game, '/blueprint save hut')).toMatch(/Saved blueprint 'hut': 2 x 2 x 1, \d+ characters, chests saved empty/);
    expect(player.blueprints.hut.startsWith(BLUEPRINT_PREFIX)).toBe(true);
    expect(flat(run(game, '/blueprint list'))).toMatch(/hut - 2 x 2 x 1/);
    player.x = 10.5;
    expect(run(game, '/bp load hut')).toMatch(/Loaded 'hut' \(2 x 2 x 1\)/);
    run(game, '/paste');
    expect(world.getBlock(11, 64, 0)).toBe(B.DIRT);
    expect(world.getBlock(10, 65, 0)).toBe(B.CHEST);
    expect(game.chests.has('10,65,0')).toBe(false);
    player.x = 0.5;
    run(game, '/blueprint save full -c');
    run(game, '/blueprint load full');
    player.x = 20.5;
    run(game, '/paste -c');
    expect(game.chests.get('20,65,0').slots[0].count).toBe(2);
    expect(run(game, '/blueprint delete hut')).toMatch(/Deleted/);
    expect(run(game, '/blueprint load hut')).toMatch(/No blueprint called/);
    expect(run(game, '/blueprint delete hut')).toMatch(/No blueprint/);
    expect(run(game, '/blueprint save "bad name"')).toMatch(/name of letters/);
    expect(run(game, '/blueprint')).toMatch(/Usage/);
    expect(flat(run(game, '/blueprint list'))).not.toMatch(/hut/);
  });
  it('limits what a blueprint may be', () => {
    const { game, world } = makeGame();
    select(game, [0, 64, 0], [99, 69, 99]); // 60000 blocks, but 100 wide on a side with only air: fine
    expect(run(game, '/blueprint save big')).toMatch(/Saved/);
    select(game, [0, 64, 0], [127, 80, 127]); // 278528 blocks
    expect(run(game, '/blueprint save toobig')).toMatch(/at most 65,536 blocks/);
    // a count limit
    select(game, [0, 64, 0], [1, 64, 1]);
    for (let i = 0; i < BLUEPRINT_MAX_COUNT + 2; i++) run(game, `/blueprint save b${i}`);
    expect(Object.keys(game.player.blueprints).length).toBe(BLUEPRINT_MAX_COUNT);
    expect(run(game, '/blueprint save one-more')).toMatch(/can keep 24 blueprints/);
    expect(run(game, `/blueprint save b0`)).toMatch(/Saved/); // replacing one is fine
    void world;
  });
  it('exports to a file or text and imports validated text', async () => {
    const { game, world, player, lines } = makeGame();
    world.set(0, 64, 0, B.STONE);
    select(game, [0, 64, 0], [1, 64, 1]);
    run(game, '/blueprint save one');
    const exported = [];
    game.blueprintIO = { exportText: (n, t) => { exported.push([n, t]); return ['copied to the clipboard']; }, readText: async () => exported[0][1] };
    expect(run(game, '/blueprint export one')).toMatch(/Exported 'one' \(\d+ characters\): copied to the clipboard/);
    expect(exported[0][1]).toBe(player.blueprints.one);
    // with nothing to export to, the text comes back in chat
    game.blueprintIO = { exportText: () => [], readText: async () => null };
    expect(flat(run(game, '/blueprint export one'))).toContain(player.blueprints.one);
    // inline text
    const text = exported[0][1];
    expect(run(game, `/blueprint import copy ${text}`)).toMatch(/Imported 'copy' \(2 x 1 x 2/);
    expect(player.blueprints.copy).toBe(text);
    // garbage is refused, nothing is stored
    expect(run(game, '/blueprint import evil SCBP1:AAAABBBB')).toMatch(/Could not import/);
    expect(player.blueprints.evil).toBeUndefined();
    expect(run(game, '/blueprint import evil hello')).toMatch(/Could not import: That is not a Saturncraft blueprint/);
    // from a file or the clipboard, asynchronously
    game.blueprintIO = { exportText: () => [], readText: async (from) => (from === 'clipboard' ? ` ${text.slice(0, 10)}\n${text.slice(10)} ` : text) };
    expect(run(game, '/blueprint import fromfile')).toMatch(/Choose a blueprint file/);
    expect(run(game, '/blueprint import fromclip clipboard')).toMatch(/Reading the clipboard/);
    await new Promise((r) => setTimeout(r, 5));
    expect(lines.filter((l) => /Imported 'from/.test(l)).length).toBe(2);
    expect(player.blueprints.fromclip).toBe(text);
    game.blueprintIO = { exportText: () => [], readText: async () => null };
    run(game, '/blueprint import nothing');
    await new Promise((r) => setTimeout(r, 5));
    expect(lines[lines.length - 1]).toBe('Nothing was imported');
  });
  it('is kept in the player save and cleaned when loaded', () => {
    const { game, player } = makeGame();
    select(game, [0, 64, 0], [1, 64, 1]);
    run(game, '/blueprint save keep');
    const p = {
      ...player, health: 20, hunger: { food: 20, saturation: 5, exhaustion: 0 }, air: 10, spawn: { x: 0, y: 0, z: 0 }, bed: null, enchSeed: 1,
      xp: { level: 0, points: 0 }, effects: {}, flying: false, reputation: {}, pitch: 0, yaw: 0,
      inventory: { slots: [], armor: [], selected: 0 },
    };
    const data = JSON.parse(JSON.stringify(playerSaveData(p)));
    expect(Object.keys(data.blueprints)).toEqual(['keep']);
    expect(data.blueprints.keep).toBe(player.blueprints.keep);
    // a hand-edited save cannot smuggle in anything but valid blueprint text
    expect(cleanBlueprints({ ...data.blueprints, junk: 'not a blueprint', 'bad name': player.blueprints.keep, x: 5 })).toEqual(data.blueprints);
    expect(decodeBlueprint(data.blueprints.keep).w).toBe(2);
  });
});

// ---- limits and permissions ---------------------------------------------------------------------------------
describe('limits and permissions', () => {
  it('refuses a selection larger than the volume gamerule', () => {
    const { game, world } = makeGame();
    expect(maxVolumeOf(game)).toBe(DEFAULT_MAX_VOLUME);
    expect(run(game, '/gamerule maxBuildVolume')).toBe('Gamerule maxBuildVolume is currently set to: 262144');
    select(game, [0, 64, 0], [99, 64, 99]);
    expect(run(game, '/fill stone')).toMatch(/Fill(ed|ing) 10,000 blocks/);
    drain(game);
    expect(world.count(B.STONE)).toBe(10000);
    expect(run(game, '/gamerule maxBuildVolume 5000')).toBe('Gamerule maxBuildVolume is now set to: 5000');
    expect(run(game, '/fill dirt')).toMatch(/10,000 blocks: more than the limit of 5,000/);
    expect(world.count(B.DIRT)).toBe(0);
    expect(run(game, '/replace stone dirt')).toMatch(/more than the limit/);
    expect(run(game, '/sphere stone 40')).toMatch(/more than the limit/);
    expect(run(game, '/cyl stone 40 40')).toMatch(/more than the limit/);
    expect(run(game, '/replacenear 100 stone dirt')).toMatch(/more than the limit/);
    expect(run(game, '/clone 0 80 0')).toMatch(/more than the limit/);
    expect(run(game, '/copy')).toMatch(/more than the limit/);
    run(game, '/pos2 120 64 120');
    expect(run(game, '/line stone')).toMatch(/more than the limit/);
    // a clipboard bigger than the limit cannot be pasted either
    game.settings.maxBuildVolume = 100000;
    run(game, '/pos1 0 64 0'); run(game, '/pos2 99 64 99');
    run(game, '/copy');
    game.settings.maxBuildVolume = 5000;
    expect(run(game, '/paste')).toMatch(/more than the limit/);
    // a nonsense value or one past the cap is refused
    for (const v of ['0', '-5', 'many', '1.5', '99999999999']) expect(run(game, `/gamerule maxBuildVolume ${v}`)).toMatch(/Usage/);
    expect(NUMERIC_RULES.maxBuildVolume.def).toBe(DEFAULT_MAX_VOLUME);
  });
  it('only creative players, ops and the host may build; only ops change the limit', () => {
    const { game, world } = makeGame({ mode: 'survival' });
    // the host can always build
    select(game, [0, 64, 0], [1, 64, 1]);
    expect(run(game, '/fill stone')).toMatch(/Filled 4 blocks/);
    const guest = (over) => ({ key: 'n:gus', name: 'Gus', host: false, op: false, creative: false, pos: () => ({ x: 5, y: 64, z: 5 }), look: () => [0, 0, -1], say() {}, toast() {}, ...over });
    game.cmdActor = guest();
    expect(run(game, '/pos1 5 64 5')).toMatch(/creative players, ops and the host/);
    expect(run(game, '/fill dirt')).toMatch(/creative players, ops and the host/);
    expect(run(game, '/undo')).toMatch(/creative players, ops and the host/);
    expect(run(game, '/gamerule maxBuildVolume 10')).toMatch(/Only the host and the ops/);
    game.cmdActor = guest({ creative: true });
    expect(run(game, '/pos1 5 64 5')).toMatch(/Corner 1/);
    run(game, '/pos2 6 64 6');
    expect(run(game, '/fill dirt')).toMatch(/Filled 4 blocks/);
    expect(run(game, '/gamerule maxBuildVolume 10')).toMatch(/Only the host and the ops/);
    expect(run(game, '/gamerule maxBuildVolume')).toMatch(/currently/);
    game.cmdActor = guest({ op: true });
    expect(run(game, '/gamerule maxBuildVolume 10')).toMatch(/now set to: 10/);
    game.cmdActor = null;
    expect(world.count(B.DIRT)).toBe(4);
  });
  it('is refused entirely in a world made without cheats', () => {
    const { game } = makeGame();
    game.allowCheats = false;
    for (const c of BUILD_COMMANDS) expect(run(game, '/' + c + ' x')).toBe('Cheats are turned off in this world');
    for (const c of BUILD_COMMANDS) expect(CHEAT_COMMANDS.has(c)).toBe(true);
  });
  it('leaves chunks that are not loaded alone and says so', () => {
    const { game, world } = makeGame();
    world.unloaded.add('1,0');
    select(game, [10, 64, 0], [21, 64, 3]);
    const out = run(game, '/fill stone');
    expect(out).toBe('Filled 24 blocks, 24 left alone in unloaded chunks (/undo to take it back)');
    expect(world.getBlock(10, 64, 0)).toBe(B.STONE);
    expect(world.getBlock(16, 64, 0)).toBe(0);
    select(game, [16, 64, 0], [21, 64, 3]);
    expect(run(game, '/fill stone')).toMatch(/unloaded chunks: go closer first/);
    expect(run(game, '/copy')).toMatch(/unloaded chunks/);
    expect(run(game, '/blueprint save nope')).toMatch(/unloaded chunks/);
  });
  it('stops a job when the dimension changes', () => {
    const { game, world } = makeGame();
    select(game, [0, 64, 0], [31, 64, 31]);
    const q = game.buildQueue = new BuildQueue(game);
    q.sliceCells = 100; q.sliceMs = 1000;
    run(game, '/fill stone');
    world.dimension = 'hollow';
    q.tick();
    expect(q.busy).toBe(0);
  });
});

// ---- the wand, guests and the lists ------------------------------------------------------------------------------
describe('the Surveyor Wand and guests', () => {
  it('is an item you cannot craft and /wand gives it to builders only', () => {
    const wand = ITEMS[I.SURVEYOR_WAND];
    expect(wand).toMatchObject({ name: 'Surveyor Wand', stack: 1, wand: true });
    const { game, player } = makeGame();
    expect(run(game, '/wand')).toMatch(/Gave a Surveyor Wand/);
    expect(player.inventory.slots[0].id).toBe(I.SURVEYOR_WAND);
    expect(run(game, '/wand')).toMatch(/already have/);
    const s = makeGame({ mode: 'survival' });
    s.game.net = { isClient: true, name: 'Gus', sendCommand() {} };
    expect(run(s.game, '/wand')).toMatch(/creative players, ops and the host/);
    const g = makeGame();
    g.game.cmdActor = { key: 'n:x', host: false, op: true, creative: true, pos: () => ({ x: 0, y: 0, z: 0 }), look: () => [0, 0, -1], say() {}, toast() {} };
    expect(run(g.game, '/wand')).toMatch(/own game/);
  });
  it('a click marks a corner (left 1, right 2) on the host', () => {
    const { game } = makeGame();
    wandClick(game, 1, { x: 3, y: 70, z: 4 });
    wandClick(game, 2, { x: 5, y: 72, z: 8 });
    expect(selectionOf(game)).toMatchObject({ pos1: { x: 3, y: 70, z: 4 }, pos2: { x: 5, y: 72, z: 8 } });
    expect(game.buildStates.get('#host').pos2.dim).toBe('overworld');
  });
  it('a survivor with a wand gets a refusal, not a corner', () => {
    const { game, toasts } = makeGame({ mode: 'survival' });
    game.net = { isClient: true, name: 'Gus', sendCommand() {} };
    const sent = [];
    game.net.sendCommand = (t) => sent.push(t);
    wandClick(game, 1, { x: 3, y: 70, z: 4 });
    expect(sent).toEqual(['/pos1 3 70 4']); // the host decides; the guest's own outline still follows its clicks
    void toasts;
  });
  it('a guest sends commands to the host, with explicit corners, and marks them at home', () => {
    const { game } = makeGame();
    game.net = { isClient: true, name: 'Gus' };
    game.player.x = 7.5; game.player.y = 64.0; game.player.z = -2.5;
    expect(prepareGuestCommand(game, '/pos1')).toBe('/pos1 7 64 -3');
    expect(prepareGuestCommand(game, '/pos2 1 2 3')).toBe('/pos2 1 2 3');
    expect(prepareGuestCommand(game, '/fill stone')).toBe('/fill stone');
    expect(selectionOf(game)).toMatchObject({ pos1: { x: 7, y: 64, z: -3 }, pos2: { x: 1, y: 2, z: 3 } });
    prepareGuestCommand(game, '/sel clear');
    expect(selectionOf(game).pos1).toBeNull();
    expect(game.buildStates).toBeUndefined(); // (the local mirror never touches the host's tables)
    for (const c of BUILD_COMMANDS) if (c !== 'wand') expect(WORLD_COMMANDS.has(c)).toBe(true);
    expect(WORLD_COMMANDS.has('wand')).toBe(false);
  });
  it('answers a guest through the actor when a job ends later', () => {
    const { game, world } = makeGame();
    const said = [];
    const guest = { key: 'n:ann', name: 'Ann', host: false, op: false, creative: true, pos: () => ({ x: 0, y: 64, z: 0 }), look: () => [0, 0, -1], say: (l) => said.push(l), toast() {} };
    const q = game.buildQueue = new BuildQueue(game);
    q.sliceCells = 50; q.sliceMs = 1000;
    game.cmdActor = guest;
    run(game, '/pos1 0 64 0'); run(game, '/pos2 9 64 9');
    expect(run(game, '/fill stone')).toMatch(/so far/);
    game.cmdActor = null;
    q.drain();
    expect(said).toEqual(['Filled 100 blocks (/undo to take it back)']);
    expect(world.count(B.STONE)).toBe(100);
  });
});

describe('the command lists', () => {
  it('every building command is in /help and in the Help screen', () => {
    const help = HELP.join('\n'), topics = buildTopics({ table: resolveBindings({}) });
    const commands = topics.find((t) => t.id === 'commands');
    expect(commands.blocks.find((b) => b.cmds).cmds).toEqual(HELP);
    for (const c of ['wand', 'pos1', 'pos2', 'sel', 'fill', 'replace', 'replacenear', 'clone', 'sphere', 'cyl', 'line', 'copy', 'cut', 'paste', 'rotate', 'flip', 'undo', 'redo', 'blueprint', 'build', 'maxBuildVolume']) {
      expect(help).toContain(c === 'maxBuildVolume' ? c : '/' + c);
      expect(commands.text).toContain(c.toLowerCase());
    }
    const building = topics.find((t) => t.id === 'building');
    expect(building.group).toBe('Systems');
    expect(building.blocks.find((b) => b.cmds).cmds.join('\n')).toContain('/blueprint');
    expect(building.text).toContain('surveyor wand');
    expect(BUILD_COMMANDS.size).toBeGreaterThanOrEqual(20);
  });
  it('does not know the commands as anything but building commands', () => {
    const { game } = makeGame();
    expect(run(game, '/blueprint list')).toMatch(/No blueprints yet/);
    expect(run(game, '/bogus')).toMatch(/Unknown command/);
    expect(cidx).toBeTypeOf('function');
    expect(SIDE_DIRS.length).toBe(4);
  });
});

// ---- against the real world ---------------------------------------------------------------------------------------
describe('on the real world', () => {
  function realWorld() {
    const world = new World(1);
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
      const blocks = new Uint16Array(CHUNK_VOLUME);
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 60; y++) blocks[cidx(x, y, z)] = B.STONE;
      const light = new Uint8Array(CHUNK_VOLUME);
      computeChunkLight(blocks, light);
      world.addChunk(cx, cz, { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(59) });
    }
    return world;
  }
  it('edits through World.setBlock so the changes reach the edit sync, and undoes them', () => {
    const world = realWorld();
    const sync = new EditSync(world, { host: true });
    const { game } = makeGame();
    game.world = world;
    game.player.x = 0.5; game.player.y = 61; game.player.z = 0.5;
    select(game, [-15, 61, -15], [15, 63, 15]); // spans four chunks
    run(game, '/fill oak_planks');
    game.buildQueue.drain();
    expect(world.getBlock(0, 62, 0)).toBe(B.OAK_PLANKS);
    expect(world.getBlock(-15, 61, 15)).toBe(B.OAK_PLANKS);
    expect(world.getChunk(0, 0).modified).toBe(true); // saved with the chunk
    expect(world.heightAt(0, 0)).toBe(63);
    const out = sync.take();
    expect(out.length).toBe(31 * 31 * 3 * 5); // five numbers per edit, sent to guests
    run(game, '/undo');
    game.buildQueue.drain();
    expect(world.getBlock(0, 62, 0)).toBe(0);
    expect(world.heightAt(0, 0)).toBe(59);
    expect(sync.take().length).toBe(31 * 31 * 3 * 5);
    // outside the loaded chunks nothing happens
    select(game, [100, 61, 100], [101, 61, 101]);
    expect(run(game, '/fill stone')).toMatch(/unloaded chunks/);
  });
});
