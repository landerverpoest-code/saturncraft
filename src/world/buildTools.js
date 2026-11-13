// Creative building tools, the pure part: block patterns and masks, edit lists, brush shapes, the clipboard
// with rotation and mirroring, the bounded undo history and the blueprint text format. Nothing here touches
// the game: the command layer (ui/buildCommands.js) feeds it a world-like object (getBlock, getMeta,
// isChunkLoaded) and applies the edit lists it makes through world.setBlock, a slice per tick.
import { B, BLOCKS, BLOCK_LIMIT, SHAPE, isBlockId, isBox } from './blocks.js';
import { cleanContents } from './enchantments.js';
import { cleanPotFaces } from './archaeology.js';
import { PAIRED, PARTNER_PLUS } from './chests.js';
import { SLAB_TOP, SLAB_DOUBLE, STAIRS_UPSIDE, TRAPDOOR_TOP } from './shapes.js';
import { MIN_Y, MAX_Y } from './constants.js';

// ---- limits (a griefer's first tools are volume and time, so everything is bounded) ----
export const DEFAULT_MAX_VOLUME = 262144;   // blocks one command may touch (gamerule maxBuildVolume)
export const MAX_VOLUME_CAP = 16777216;     // the highest the gamerule can be set to
export const HISTORY_MAX_OPS = 20;          // undo steps kept per player
export const HISTORY_MAX_CELLS = 600000;    // changed blocks kept across a player's undo and redo steps
export const BLUEPRINT_MAX_DIM = 128;       // longest side of a blueprint
export const BLUEPRINT_MAX_VOLUME = 65536;  // cells of a blueprint (before run-length coding)
export const BLUEPRINT_MAX_COUNT = 24;      // blueprints in one player's save
export const BLUEPRINT_MAX_TEXT = 180000;   // characters of one blueprint's text
export const BLUEPRINT_TOTAL_TEXT = 600000; // characters of all one player's blueprints
export const BLUEPRINT_NAME_MAX = 24;
export const BLUEPRINT_PREFIX = 'SCBP1:';
const MAX_TILES = 512, MAX_TILE_JSON = 65536, MAX_PALETTE = 4096;

// ---- block names, patterns and masks --------------------------------------------------
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
let NAME_MAP = null;
function nameMap() {
  if (NAME_MAP) return NAME_MAP;
  NAME_MAP = new Map();
  for (let id = 0; id < BLOCK_LIMIT; id++) {
    if (id !== 0 && !isBlockId(id)) continue;
    const b = BLOCKS[id];
    if (!b) continue;
    const k = norm(b.name);
    if (k && !NAME_MAP.has(k)) NAME_MAP.set(k, id);
  }
  NAME_MAP.set('air', 0);
  return NAME_MAP;
}
/**
 * The key a block is known by in commands and in blueprints ("oak_planks"). Some blocks share a display name (a lit and
 * an unlit furnace, a wall sign and a standing one): the first keeps the plain name and the others get "@<id>" after it,
 * which stays valid because block ids never change.
 */
export function blockKey(id) {
  if (id === 0) return 'air';
  const b = BLOCKS[id];
  if (!b) return '';
  const k = norm(b.name);
  return nameMap().get(k) === id ? k : `${k}@${id}`;
}
/** The block id for a name (as blockKey makes it), or -1. */
export function blockIdByName(name) {
  const id = nameMap().get(norm(name));
  if (id !== undefined) return id;
  const m = /^([a-z0-9_ -]+)@(\d{1,4})$/.exec(String(name).trim().toLowerCase());
  if (!m) return -1;
  const n = Number(m[2]);
  return n < BLOCK_LIMIT && isBlockId(n) && norm(BLOCKS[n].name) === norm(m[1]) ? n : -1;
}

/** "stone", "oak_stairs:2", "air" -> { id, meta } or { error }. */
export function parseBlockSpec(text) {
  const m = /^([a-z0-9_@ -]+?)(?::(\d{1,3}))?$/i.exec(String(text).trim());
  if (!m) return { error: `Bad block '${text}'` };
  const id = blockIdByName(m[1]);
  if (id < 0) return { error: `Unknown block '${m[1]}'` };
  const meta = m[2] === undefined ? 0 : Number(m[2]);
  if (meta > 255) return { error: `Bad block data '${m[2]}'` };
  return { id, meta, hasMeta: m[2] !== undefined };
}

/** A deterministic [0,1) from a position (so a pattern fills the same way twice, and in a test). */
export function hash01(x, y, z, salt = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(salt | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * "stone", "50%stone,30%dirt,gravel" -> { pick(x, y, z) -> [id, meta], single } or { error }.
 * Entries without a percentage share what the others leave equally.
 */
export function parsePattern(text) {
  const parts = String(text || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { error: 'Give a block name' };
  if (parts.length > 16) return { error: 'A pattern can have at most 16 blocks' };
  const entries = [];
  let fixed = 0, free = 0;
  for (const part of parts) {
    const m = /^(?:(\d+(?:\.\d+)?)%)?(.+)$/.exec(part);
    const spec = parseBlockSpec(m[2]);
    if (spec.error) return spec;
    const w = m[1] === undefined ? null : Number(m[1]);
    if (w !== null) fixed += w; else free++;
    entries.push({ id: spec.id, meta: spec.meta, w });
  }
  const rest = Math.max(0, 100 - fixed), each = free ? rest / free : 0;
  let total = 0;
  for (const e of entries) { e.w = e.w === null ? each : e.w; total += e.w; }
  if (!(total > 0)) return { error: 'The percentages add up to nothing' };
  if (entries.length === 1) { const e = entries[0], v = [e.id, e.meta]; return { pick: () => v, single: v, entries }; }
  let acc = 0;
  const cum = entries.map((e) => (acc += e.w / total));
  return {
    entries,
    pick(x, y, z) {
      const r = hash01(x, y, z);
      for (let i = 0; i < cum.length; i++) if (r < cum[i]) return [entries[i].id, entries[i].meta];
      const e = entries[entries.length - 1];
      return [e.id, e.meta];
    },
  };
}

/** "stone,dirt", "!air", "oak_stairs:2", "*" -> { test(id, meta) } or { error }. */
export function parseMask(text) {
  const parts = String(text || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { error: 'Give a block name or *' };
  if (parts.length > 32) return { error: 'A mask can have at most 32 blocks' };
  const pos = [], neg = [];
  let any = false;
  for (let p of parts) {
    if (p === '*' || p === 'any') { any = true; continue; }
    const negate = p[0] === '!' || p[0] === '^';
    if (negate) p = p.slice(1);
    const s = parseBlockSpec(p);
    if (s.error) return s;
    (negate ? neg : pos).push(s);
  }
  const hit = (list, id, meta) => list.some((s) => s.id === id && (!s.hasMeta || s.meta === meta));
  if (any && !neg.length) return { test: () => true, any: true };
  return {
    any: false,
    test(id, meta) {
      if (neg.length && hit(neg, id, meta)) return false;
      if (any || (!pos.length && neg.length)) return true;
      return hit(pos, id, meta);
    },
  };
}

// ---- boxes ------------------------------------------------------------------------------
/** The box between two corners, clamped to the world's height. */
export function boxOf(a, b) {
  return {
    x0: Math.min(a.x, b.x), y0: Math.max(MIN_Y, Math.min(a.y, b.y)), z0: Math.min(a.z, b.z),
    x1: Math.max(a.x, b.x), y1: Math.min(MAX_Y, Math.max(a.y, b.y)), z1: Math.max(a.z, b.z),
  };
}
export const boxSize = (b) => [b.x1 - b.x0 + 1, b.y1 - b.y0 + 1, b.z1 - b.z0 + 1];
export function boxVolume(b) { const [w, h, l] = boxSize(b); return w > 0 && h > 0 && l > 0 ? w * h * l : 0; }

/**
 * Visit every cell of a box one chunk column at a time (so a run of edits touches few chunks and the
 * mesher and lighting see them together). Chunks that are not loaded are skipped; returns how many cells were.
 */
export function eachChunkMajor(box, loaded, fn) {
  let skipped = 0;
  for (let cx = box.x0 >> 4; cx <= box.x1 >> 4; cx++) {
    for (let cz = box.z0 >> 4; cz <= box.z1 >> 4; cz++) {
      const x0 = Math.max(box.x0, cx * 16), x1 = Math.min(box.x1, cx * 16 + 15);
      const z0 = Math.max(box.z0, cz * 16), z1 = Math.min(box.z1, cz * 16 + 15);
      if (loaded && !loaded(cx, cz)) { skipped += (x1 - x0 + 1) * (z1 - z0 + 1) * (box.y1 - box.y0 + 1); continue; }
      for (let y = box.y0; y <= box.y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) fn(x, y, z);
    }
  }
  return skipped;
}

// ---- edit lists --------------------------------------------------------------------------
/** A growable list of block changes (x, y, z, id, meta) plus the block entity data some carry. */
export class EditSet {
  constructor(cap = 256) {
    this.cap = cap; this.n = 0;
    this.x = new Int32Array(cap); this.y = new Int32Array(cap); this.z = new Int32Array(cap);
    this.id = new Uint16Array(cap); this.meta = new Uint8Array(cap);
    this.tiles = new Map(); // index -> tile (see readTile in ui/buildCommands.js)
  }
  grow() {
    const cap = this.cap * 2;
    const g = (a, T) => { const b = new T(cap); b.set(a); return b; };
    this.x = g(this.x, Int32Array); this.y = g(this.y, Int32Array); this.z = g(this.z, Int32Array);
    this.id = g(this.id, Uint16Array); this.meta = g(this.meta, Uint8Array);
    this.cap = cap;
  }
  add(x, y, z, id, meta = 0, tile = null) {
    if (this.n === this.cap) this.grow();
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.id[i] = id; this.meta[i] = meta;
    if (tile) this.tiles.set(i, tile);
    return i;
  }
  get length() { return this.n; }
  /** Rough bytes held (for the history budget). */
  get bytes() { return this.n * 15 + this.tiles.size * 200; }
}

// ---- brush shapes -----------------------------------------------------------------------
/** The box a sphere of radius r around (cx, cy, cz) fits in. */
export function sphereBox(cx, cy, cz, r) { const n = Math.ceil(r); return boxOf({ x: cx - n, y: cy - n, z: cz - n }, { x: cx + n, y: cy + n, z: cz + n }); }
/** Is the cell inside a sphere / the disc of a cylinder (radius r, centred on the cell centres)? */
export const inSphere = (dx, dy, dz, r) => dx * dx + dy * dy + dz * dz <= (r + 0.5) * (r + 0.5);
export const inDisc = (dx, dz, r) => dx * dx + dz * dz <= (r + 0.5) * (r + 0.5);

/** Cells (as [x, y, z]) of the 3D line from a to b; every cell touches the next by a face, an edge or a corner. */
export function lineCells(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, n = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    const c = [Math.round(a.x + dx * t), Math.round(a.y + dy * t), Math.round(a.z + dz * t)];
    const last = out[out.length - 1];
    if (!last || last[0] !== c[0] || last[1] !== c[1] || last[2] !== c[2]) out.push(c);
  }
  return out;
}
/** Distance from a point to the segment a-b. */
export function distToSegment(px, py, pz, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy + (pz - a.z) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t), pz - (a.z + dz * t));
}

// ---- rotating and mirroring blocks that face somewhere ---------------------------------
// Side index (meta & 3 for most blocks): 0 -z, 1 +x, 2 +z, 3 -x; a quarter turn clockwise seen from above is +1.
const SIDE_TO_FACING = [2, 5, 3, 4];             // horizontal side -> FACING6 index (down, up, -z, +z, -x, +x)
const FACING_TO_SIDE = { 2: 0, 5: 1, 3: 2, 4: 3 };
let KINDS = null;
function kinds() {
  if (KINDS) return KINDS;
  KINDS = new Uint8Array(BLOCK_LIMIT);
  const K = { SIDE: 1, FACING6: 2, ATTACH: 3, TORCH: 4, CHEST: 5 };
  for (let id = 1; id < BLOCK_LIMIT; id++) {
    const b = BLOCKS[id];
    if (!b) continue;
    if ([SHAPE.DOOR, SHAPE.LADDER, SHAPE.STAIRS, SHAPE.GATE, SHAPE.TRAPDOOR, SHAPE.BED].includes(b.shape)) KINDS[id] = K.SIDE;
  }
  for (const k of ['OAK_WALL_SIGN', 'OAK_SIGN', 'ITEM_FRAME', 'COCOA', 'LECTERN', 'REPEATER', 'COMPARATOR']) if (B[k]) KINDS[B[k]] = K.SIDE;
  for (const k of ['PISTON', 'STICKY_PISTON', 'PISTON_HEAD', 'OBSERVER', 'DISPENSER', 'DROPPER', 'ASSEMBLER', 'DART_TRAP']) if (B[k]) KINDS[B[k]] = K.FACING6;
  for (const k of ['LEVER', 'STONE_BUTTON']) if (B[k]) KINDS[B[k]] = K.ATTACH;
  for (const k of ['TORCH', 'CINNABAR_TORCH', 'CINNABAR_TORCH_OFF', 'HOPPER']) if (B[k]) KINDS[B[k]] = K.TORCH;
  KINDS[B.CHEST] = K.CHEST;
  return KINDS;
}

/** The meta of block `id` after `k` quarter turns clockwise (blocks without a facing keep theirs). */
export function rotateMeta(id, meta, k) {
  k = ((k % 4) + 4) % 4;
  if (!k) return meta;
  switch (kinds()[id]) {
    case 1: return (meta & ~3) | (((meta & 3) + k) & 3);
    case 2: { const f = meta & 7, s = FACING_TO_SIDE[f]; return s === undefined ? meta : (meta & ~7) | SIDE_TO_FACING[(s + k) & 3]; }
    case 3: { const a = meta & 7; return a >= 1 && a <= 4 ? (meta & ~7) | (((a - 1 + k) & 3) + 1) : meta; }
    case 4: return meta >= 1 && meta <= 4 ? ((meta - 1 + k) & 3) + 1 : meta;
    case 5: {
      const f = meta & 3;
      let m = (meta & ~3) | ((f + k) & 3);
      if (meta & PAIRED) for (let i = 0; i < k; i++) if (((f + i) & 1) === 1) m ^= PARTNER_PLUS; // a turn from the z axis to the x axis swaps which half is which
      return m;
    }
    default: return meta;
  }
}

const flipSide = (s, axis) => (axis === 'x' ? (s & 1 ? s ^ 2 : s) : axis === 'z' ? (s & 1 ? s : s ^ 2) : s);
/** The meta of block `id` mirrored across the x, y or z axis. */
export function mirrorMeta(id, meta, axis) {
  const kind = kinds()[id], b = BLOCKS[id];
  if (axis === 'y') {
    if (b && b.shape === SHAPE.STAIRS) return meta ^ STAIRS_UPSIDE;
    if (b && b.shape === SHAPE.TRAPDOOR) return meta ^ TRAPDOOR_TOP;
    if (b && b.shape === SHAPE.SLAB && !(meta & SLAB_DOUBLE)) return meta ^ SLAB_TOP;
    if (kind === 2) { const f = meta & 7; return f === 0 ? (meta & ~7) | 1 : f === 1 ? meta & ~7 : meta; }
    if (kind === 3) { const a = meta & 7; return a === 0 ? (meta & ~7) | 5 : a === 5 ? meta & ~7 : meta; }
    return meta;
  }
  switch (kind) {
    case 1: return (meta & ~3) | flipSide(meta & 3, axis);
    case 2: { const s = FACING_TO_SIDE[meta & 7]; return s === undefined ? meta : (meta & ~7) | SIDE_TO_FACING[flipSide(s, axis)]; }
    case 3: { const a = meta & 7; return a >= 1 && a <= 4 ? (meta & ~7) | (flipSide(a - 1, axis) + 1) : meta; }
    case 4: return meta >= 1 && meta <= 4 ? flipSide(meta - 1, axis) + 1 : meta;
    case 5: {
      const f = meta & 3;
      let m = (meta & ~3) | flipSide(f, axis);
      if ((meta & PAIRED) && ((axis === 'x' && !(f & 1)) || (axis === 'z' && (f & 1)))) m ^= PARTNER_PLUS; // the pair runs along the mirrored axis
      return m;
    }
    default: return meta;
  }
}

// ---- the clipboard -----------------------------------------------------------------------
/**
 * A copied region: w x h x l cells in (y, z, x) order, whose lowest corner sits at (ox, oy, oz) from the
 * origin it was copied around (so a paste puts the structure back where it stood relative to the player).
 */
export class Clipboard {
  constructor(w, h, l, ox = 0, oy = 0, oz = 0) {
    this.w = w; this.h = h; this.l = l; this.ox = ox; this.oy = oy; this.oz = oz;
    this.ids = new Uint16Array(w * h * l);
    this.metas = new Uint8Array(w * h * l);
    this.tiles = new Map(); // cell index -> tile
  }
  get volume() { return this.w * this.h * this.l; }
  index(x, y, z) { return (y * this.l + z) * this.w + x; }
  /** Rough size in blocks that are not air. */
  get solid() { let n = 0; for (let i = 0; i < this.ids.length; i++) if (this.ids[i]) n++; return n; }
}

/** Copy a box of the world around `origin` ({x, y, z}); `tileAt(x, y, z)` reads block entity data (or null). */
export function copyRegion(world, box, origin, tileAt = null) {
  const [w, h, l] = boxSize(box);
  const cb = new Clipboard(w, h, l, box.x0 - origin.x, box.y0 - origin.y, box.z0 - origin.z);
  for (let y = 0; y < h; y++) for (let z = 0; z < l; z++) for (let x = 0; x < w; x++) {
    const wx = box.x0 + x, wy = box.y0 + y, wz = box.z0 + z, i = cb.index(x, y, z);
    cb.ids[i] = world.getBlock(wx, wy, wz); cb.metas[i] = world.getMeta(wx, wy, wz);
    if (cb.ids[i] && tileAt) { const t = tileAt(wx, wy, wz); if (t) cb.tiles.set(i, t); }
  }
  return cb;
}

/** A new clipboard with every cell moved by `map(rx, ry, rz) -> [nx, ny, nz]` (relative to the origin) and its meta fixed by `fix`. */
function remap(cb, map, fix) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const cx of [0, cb.w - 1]) for (const cy of [0, cb.h - 1]) for (const cz of [0, cb.l - 1]) {
    const [nx, ny, nz] = map(cb.ox + cx, cb.oy + cy, cb.oz + cz);
    x0 = Math.min(x0, nx); y0 = Math.min(y0, ny); z0 = Math.min(z0, nz); x1 = Math.max(x1, nx); y1 = Math.max(y1, ny); z1 = Math.max(z1, nz);
  }
  const out = new Clipboard(x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1, x0 + 0, y0 + 0, z0 + 0); // (+ 0: no negative zero)
  for (let y = 0; y < cb.h; y++) for (let z = 0; z < cb.l; z++) for (let x = 0; x < cb.w; x++) {
    const i = cb.index(x, y, z), [nx, ny, nz] = map(cb.ox + x, cb.oy + y, cb.oz + z);
    const j = out.index(nx - x0, ny - y0, nz - z0);
    out.ids[j] = cb.ids[i]; out.metas[j] = fix(cb.ids[i], cb.metas[i]);
    const t = cb.tiles.get(i);
    if (t) out.tiles.set(j, t);
  }
  return out;
}
/** The clipboard turned `quarters` times (90 degrees each, clockwise seen from above) around its origin. */
export function rotateClipboard(cb, quarters) {
  const k = ((quarters % 4) + 4) % 4;
  if (!k) return cb;
  const turn = [(x, y, z) => [x, y, z], (x, y, z) => [-z, y, x], (x, y, z) => [-x, y, -z], (x, y, z) => [z, y, -x]][k];
  return remap(cb, turn, (id, m) => rotateMeta(id, m, k));
}
/** The clipboard mirrored across the x, y or z axis through its origin. */
export function flipClipboard(cb, axis) {
  const map = axis === 'x' ? (x, y, z) => [-x, y, z] : axis === 'y' ? (x, y, z) => [x, -y, z] : (x, y, z) => [x, y, -z];
  return remap(cb, map, (id, m) => mirrorMeta(id, m, axis));
}

/** Meta for a block placed without its contents: a dungeon chest must not roll loot when opened. */
function bareMeta(id, meta) {
  if (id === B.CHEST) return meta & (3 | PAIRED | PARTNER_PLUS);
  return meta;
}
/** Is this a block that holds items (their contents are what /paste -c adds back)? */
export const isContainer = (id) => id === B.CHEST || id === B.BARREL || isBox(id);

/**
 * The edits that lay a clipboard down with its origin at `at`. `skipAir` leaves what is under the clipboard's
 * air alone; `contents` brings chest contents along (otherwise containers arrive empty). Returns { edits, skipped }.
 */
export function planPaste(cb, at, { skipAir = false, contents = false, loaded = null } = {}) {
  const box = { x0: at.x + cb.ox, y0: at.y + cb.oy, z0: at.z + cb.oz, x1: at.x + cb.ox + cb.w - 1, y1: at.y + cb.oy + cb.h - 1, z1: at.z + cb.oz + cb.l - 1 };
  const edits = new EditSet(Math.min(cb.volume, 1 << 16));
  const clip = { ...box, y0: Math.max(MIN_Y, box.y0), y1: Math.min(MAX_Y, box.y1) };
  const skipped = eachChunkMajor(clip, loaded, (x, y, z) => {
    const i = cb.index(x - box.x0, y - box.y0, z - box.z0), id = cb.ids[i];
    if (skipAir && !id) return;
    let tile = cb.tiles.get(i) || null;
    let meta = cb.metas[i];
    if (tile && tile.k === 'chest' && !contents) { tile = null; meta = bareMeta(id, meta); }
    else if (!tile && isContainer(id) && !contents) meta = bareMeta(id, meta);
    edits.add(x, y, z, id, meta, tile);
  });
  return { edits, skipped };
}

// ---- undo history -------------------------------------------------------------------------
/** Undo and redo stacks of edit sets (each holds what the blocks were before), bounded in steps and in blocks. */
export class History {
  constructor(maxOps = HISTORY_MAX_OPS, maxCells = HISTORY_MAX_CELLS) { this.maxOps = maxOps; this.maxCells = maxCells; this.undo = []; this.redo = []; }
  cells() { let n = 0; for (const s of this.undo) n += s.n; for (const s of this.redo) n += s.n; return n; }
  /** A fresh edit (clears redo). Returns false when it is too big to keep. */
  push(set) {
    this.redo.length = 0;
    if (set.n > this.maxCells) { this.undo.length = 0; return false; }
    this.undo.push(set);
    this.trim();
    return true;
  }
  trim() {
    while (this.undo.length > this.maxOps) this.undo.shift();
    while (this.cells() > this.maxCells && this.undo.length) this.undo.shift();
    while (this.cells() > this.maxCells && this.redo.length) this.redo.shift();
  }
  takeUndo() { return this.undo.pop() || null; }
  takeRedo() { return this.redo.pop() || null; }
  /** The result of an undo (what the blocks were before it) joins redo, and the other way round. */
  pushRedo(set) { this.redo.push(set); this.trim(); }
  pushUndo(set) { this.undo.push(set); this.trim(); }
}

// ---- blueprints: a clipboard as compact text ----------------------------------------------
// Layout (before base64): "SB" version flags | w h l | ox oy oz | palette | runs | tiles | checksum
//   varints throughout (offsets zigzag); palette = count, then per entry a block key (length byte + ascii) and meta;
//   runs = (palette index, length) pairs until every cell is covered; tiles (flag 1) = a length and JSON of
//   { cellIndex: tile }; checksum = FNV-1a (32 bit) of everything before it.
// The text never runs as code: it is only decoded into numbers, block names from the game's own table and
// plain data, every part of which is range checked, and anything unexpected rejects the whole blueprint.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INV = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64_INV[B64.charCodeAt(i)] = i;

export function base64Encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    s += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] + (i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=') + (i + 2 < bytes.length ? B64[c & 63] : '=');
  }
  return s;
}
export function base64Decode(text) {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('not valid base64');
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (text[i + k] === '=' ? 0 : B64_INV[text.charCodeAt(i + k)]));
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

class Writer {
  constructor() { this.b = []; }
  byte(v) { this.b.push(v & 255); }
  varint(v) { v = Math.max(0, Math.floor(v)); while (v >= 128) { this.b.push((v % 128) | 128); v = Math.floor(v / 128); } this.b.push(v); }
  zigzag(v) { this.varint(v < 0 ? -2 * v - 1 : 2 * v); }
  bytes(arr) { for (const v of arr) this.b.push(v); }
}
class Reader {
  constructor(bytes) { this.b = bytes; this.i = 0; }
  byte() { if (this.i >= this.b.length) throw new Error('the blueprint is cut short'); return this.b[this.i++]; }
  varint() {
    let v = 0, m = 1;
    for (let n = 0; n < 6; n++) { const c = this.byte(); v += (c & 127) * m; if (c < 128) return v; m *= 128; }
    throw new Error('a number is too long');
  }
  zigzag() { const v = this.varint(); return v % 2 ? -(v + 1) / 2 : v / 2; }
  take(n) { if (n < 0 || this.i + n > this.b.length) throw new Error('the blueprint is cut short'); const s = this.b.subarray(this.i, this.i + n); this.i += n; return s; }
}
export function fnv(bytes, end) { let h = 0x811c9dc5; for (let i = 0; i < end; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }

/** Sanitised block entity data (plain objects only). */
export function cleanTile(t) {
  if (!t || typeof t !== 'object') return null;
  if (t.k === 'sign' && Array.isArray(t.lines)) return { k: 'sign', lines: [0, 1, 2, 3].map((i) => String(t.lines[i] || '').slice(0, 15)) };
  if (t.k === 'chest') { const c = cleanContents(t.slots); return c ? { k: 'chest', slots: c } : null; }
  if (t.k === 'frame') { const c = cleanContents([t.st]); return c && c[0] ? { k: 'frame', st: c[0] } : null; }
  if (t.k === 'pot') { const f = cleanPotFaces(t.faces); return f ? { k: 'pot', faces: f } : null; }
  return null;
}

/** Encode a clipboard as blueprint text. `contents`: keep chest contents. Throws when it is too big. */
export function encodeBlueprint(cb, { contents = false } = {}) {
  if (cb.w > BLUEPRINT_MAX_DIM || cb.h > BLUEPRINT_MAX_DIM || cb.l > BLUEPRINT_MAX_DIM) throw new Error(`A blueprint is at most ${BLUEPRINT_MAX_DIM} blocks on a side`);
  if (cb.volume > BLUEPRINT_MAX_VOLUME) throw new Error(`A blueprint is at most ${BLUEPRINT_MAX_VOLUME} blocks (this is ${cb.volume})`);
  const w = new Writer();
  w.byte(0x53); w.byte(0x42); w.byte(1);
  const tiles = {};
  let tn = 0;
  for (const [i, t] of cb.tiles) {
    let c = cleanTile(t);
    if (c && c.k === 'chest' && !contents) c = null;
    if (c && tn < MAX_TILES) { tiles[i] = c; tn++; }
  }
  w.byte(tn ? 1 : 0);
  w.varint(cb.w); w.varint(cb.h); w.varint(cb.l);
  w.zigzag(cb.ox); w.zigzag(cb.oy); w.zigzag(cb.oz);
  const pal = new Map(), list = [];
  const idx = new Int32Array(cb.volume);
  for (let i = 0; i < cb.volume; i++) {
    let id = cb.ids[i], meta = cb.metas[i];
    if (!contents) meta = bareMeta(id, meta);
    const key = id + ':' + meta;
    let p = pal.get(key);
    if (p === undefined) { p = list.length; pal.set(key, p); list.push([id, meta]); }
    idx[i] = p;
  }
  w.varint(list.length);
  for (const [id, meta] of list) {
    const name = blockKey(id);
    w.byte(name.length); for (let c = 0; c < name.length; c++) w.byte(name.charCodeAt(c));
    w.varint(meta);
  }
  for (let i = 0; i < idx.length;) {
    let j = i + 1;
    while (j < idx.length && idx[j] === idx[i]) j++;
    w.varint(idx[i]); w.varint(j - i);
    i = j;
  }
  if (tn) {
    const json = new TextEncoder().encode(JSON.stringify(tiles));
    w.varint(json.length); w.bytes(json);
  }
  const body = Uint8Array.from(w.b), sum = fnv(body, body.length);
  const out = new Uint8Array(body.length + 4);
  out.set(body);
  out[body.length] = sum >>> 24; out[body.length + 1] = (sum >>> 16) & 255; out[body.length + 2] = (sum >>> 8) & 255; out[body.length + 3] = sum & 255;
  const text = BLUEPRINT_PREFIX + base64Encode(out);
  if (text.length > BLUEPRINT_MAX_TEXT) throw new Error('That blueprint is too detailed to store (it would be ' + text.length + ' characters)');
  return text;
}

/** Decode and validate blueprint text into a Clipboard. Throws an Error with a plain message on anything wrong. */
export function decodeBlueprint(text) {
  if (typeof text !== 'string') throw new Error('That is not a blueprint');
  const t = text.replace(/\s+/g, '');
  if (t.length > BLUEPRINT_MAX_TEXT) throw new Error('That blueprint is too long');
  if (!t.startsWith(BLUEPRINT_PREFIX)) throw new Error('That is not a Saturncraft blueprint (it should start with ' + BLUEPRINT_PREFIX + ')');
  const bytes = base64Decode(t.slice(BLUEPRINT_PREFIX.length));
  if (bytes.length < 16) throw new Error('That blueprint is cut short');
  const end = bytes.length - 4, sum = ((bytes[end] << 24) | (bytes[end + 1] << 16) | (bytes[end + 2] << 8) | bytes[end + 3]) >>> 0;
  if (fnv(bytes, end) !== sum) throw new Error('That blueprint is damaged (the check sum does not match)');
  const r = new Reader(bytes.subarray(0, end));
  if (r.byte() !== 0x53 || r.byte() !== 0x42) throw new Error('That is not a Saturncraft blueprint');
  if (r.byte() !== 1) throw new Error('That blueprint is from a newer version');
  const flags = r.byte();
  const w = r.varint(), h = r.varint(), l = r.varint();
  if (!w || !h || !l || w > BLUEPRINT_MAX_DIM || h > BLUEPRINT_MAX_DIM || l > BLUEPRINT_MAX_DIM || w * h * l > BLUEPRINT_MAX_VOLUME) throw new Error('That blueprint is too large');
  const ox = r.zigzag(), oy = r.zigzag(), oz = r.zigzag();
  if (Math.abs(ox) > 4096 || Math.abs(oy) > 4096 || Math.abs(oz) > 4096) throw new Error('That blueprint has a bad origin');
  const pn = r.varint();
  if (!pn || pn > MAX_PALETTE) throw new Error('That blueprint has a bad palette');
  const pal = [];
  for (let i = 0; i < pn; i++) {
    const n = r.byte();
    const name = String.fromCharCode(...r.take(n));
    const meta = r.varint();
    const id = /^[a-z0-9_@]+$/.test(name) ? blockIdByName(name) : -1;
    if (id < 0) throw new Error(`That blueprint uses a block this game does not know ('${name.slice(0, 24)}')`);
    if (meta > 255) throw new Error('That blueprint has a bad block value');
    pal.push([id, meta]);
  }
  const cb = new Clipboard(w, h, l, ox, oy, oz);
  let at = 0;
  while (at < cb.volume) {
    const p = r.varint(), n = r.varint();
    if (p >= pn || n < 1 || at + n > cb.volume) throw new Error('That blueprint has a damaged block list');
    cb.ids.fill(pal[p][0], at, at + n); cb.metas.fill(pal[p][1], at, at + n);
    at += n;
  }
  if (flags & 1) {
    const n = r.varint();
    if (n > MAX_TILE_JSON) throw new Error('That blueprint has too much extra data');
    let raw;
    try { raw = JSON.parse(new TextDecoder().decode(r.take(n))); } catch { throw new Error('That blueprint has damaged extra data'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('That blueprint has damaged extra data');
    let count = 0;
    for (const key of Object.keys(raw)) {
      if (++count > MAX_TILES) break;
      if (!/^\d{1,9}$/.test(key)) continue;
      const i = Number(key);
      if (i >= cb.volume || !cb.ids[i]) continue;
      const tile = cleanTile(raw[key]);
      if (tile) cb.tiles.set(i, tile);
    }
  }
  if (r.i !== end) throw new Error('That blueprint has extra bytes at the end');
  return cb;
}

/** { w, h, l } of blueprint text without decoding the blocks (for lists), or null when it is not one. */
export function peekBlueprint(text) {
  try {
    if (typeof text !== 'string' || !text.startsWith(BLUEPRINT_PREFIX)) return null;
    const head = text.slice(BLUEPRINT_PREFIX.length, BLUEPRINT_PREFIX.length + 64); // (the first 48 bytes are plenty)
    const bytes = base64Decode(head.slice(0, head.length - (head.length % 4)));
    const r = new Reader(bytes);
    if (r.byte() !== 0x53 || r.byte() !== 0x42 || r.byte() !== 1) return null;
    r.byte();
    return { w: r.varint(), h: r.varint(), l: r.varint() };
  } catch { return null; }
}

/** A blueprint name: letters, digits, dash and underscore, up to 24, lower case. */
export function cleanBlueprintName(name) {
  const n = String(name || '').trim().toLowerCase();
  return /^[a-z0-9_-]+$/.test(n) && n.length <= BLUEPRINT_NAME_MAX ? n : null;
}
/** A player's saved blueprints cleaned from untrusted data: { name: text }, within every limit. */
export function cleanBlueprints(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  let total = 0, count = 0;
  for (const [k, v] of Object.entries(obj)) {
    const name = cleanBlueprintName(k);
    if (!name || typeof v !== 'string' || !v.startsWith(BLUEPRINT_PREFIX) || v.length > BLUEPRINT_MAX_TEXT) continue;
    if (count >= BLUEPRINT_MAX_COUNT || total + v.length > BLUEPRINT_TOTAL_TEXT) break;
    out[name] = v; total += v.length; count++;
  }
  return out;
}
