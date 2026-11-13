// The shape of a saved world, independent of where it is stored: the schema version and its migrations, validation
// (corruption detection) and repair, a size estimate, and the single-file export format (a gzip-compressed container
// with a JSON header and the chunk arrays as raw bytes). Everything here is pure data work with no game or storage
// imports, so it runs in the title screen, in the tests and when importing a file a stranger sent.
//
// Safety rules for files from outside: only JSON.parse is used (never eval or Function), object keys that could reach
// a prototype are dropped, typed arrays are rebuilt from a short whitelist with bounds checks, and the file, the
// decompressed size, the chunk count and the number of list entries are all capped.
import { CHUNK_VOLUME } from './constants.js';

/** The schema version written today. 1 = the original format (no meta block); 2 adds `meta` and guarantees the list fields. */
export const CURRENT_VERSION = 2;

export const LIMITS = {
  maxFileBytes: 256 * 1024 * 1024,        // compressed file
  maxUnpackedBytes: 768 * 1024 * 1024,    // after decompression (a gzip bomb stops here)
  maxHeaderBytes: 48 * 1024 * 1024,
  maxChunks: 40000,                        // per dimension
  maxEntries: 200000,                      // list fields such as chests or savedMobs
  maxDepth: 48,
  maxNodes: 4_000_000,
  nameMax: 24,
  seedTextMax: 64,
};

/** World generators the options panel may offer. `flat` is listed so the panel can say why it is missing. */
export const WORLD_TYPES = [
  { key: 'normal', label: 'Normal', supported: true },
  { key: 'flat', label: 'Flat', supported: false }, // the terrain generator has no flat mode
];
export const GAME_MODES = ['survival', 'creative', 'adventure'];
export const DIFFICULTY_KEYS = ['peaceful', 'easy', 'normal', 'hard'];
export const SEASON_START = ['spring', 'summer', 'autumn', 'winter'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isArr = (v) => Array.isArray(v);
const isBytes = (v) => Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView));

// ---- schema migrations -----------------------------------------------------------------------------------------
/** The list fields every loader iterates without a guard. */
const LIST_FIELDS = { furnaces: () => [], generated: () => [], liveMobs: () => [], savedMobs: () => ({}), chunks: () => ({}) };

/**
 * Each entry upgrades a copy of a save from version N to N+1. They must be total functions: whatever the old save lacks,
 * the next version gets a sane default for. Add new entries at the end and bump CURRENT_VERSION.
 */
export const MIGRATIONS = {
  1: (d) => {
    for (const [k, make] of Object.entries(LIST_FIELDS)) if (d[k] === undefined || d[k] === null) d[k] = make();
    const m = isObj(d.meta) ? d.meta : {};
    d.meta = {
      createdAt: isNum(m.createdAt) ? m.createdAt : isNum(d.savedAt) ? d.savedAt : 0,
      worldType: typeof m.worldType === 'string' ? m.worldType : 'normal',
      allowCheats: m.allowCheats !== false, // worlds from before the option keep their commands
      seedText: typeof m.seedText === 'string' ? m.seedText : null,
      thumbnail: typeof m.thumbnail === 'string' ? m.thumbnail : null,
    };
    return d;
  },
};

/**
 * Bring a save up to CURRENT_VERSION. Returns { data, from, changed } with `data` a shallow copy (the input is not
 * touched), or { error } when the version is not understood (`newer`: written by a later game).
 */
export function migrateSave(raw) {
  if (!isObj(raw)) return { error: 'The save is not a world record', newer: false };
  let v = raw.version === undefined ? 1 : raw.version;
  if (!Number.isInteger(v) || v < 1) return { error: `Unknown save version ${String(v).slice(0, 20)}`, newer: false };
  if (v > CURRENT_VERSION) return { error: `This world was saved by a newer version of the game (format ${v}, this game reads up to ${CURRENT_VERSION})`, newer: true };
  const from = v;
  let data = { ...raw };
  while (v < CURRENT_VERSION) { data = MIGRATIONS[v](data) || data; v++; }
  data.version = CURRENT_VERSION;
  return { data, from, changed: from !== CURRENT_VERSION };
}

// ---- validation ------------------------------------------------------------------------------------------------
/** Sum of the run lengths of an RLE array (pairs of value, count), or -1 when it is malformed. */
function rleLength(a) {
  if (!isBytes(a) || a.length % 2 !== 0) return -1;
  let n = 0;
  for (let i = 1; i < a.length; i += 2) { const c = a[i]; if (!(c >= 1 && c <= 255)) return -1; n += c; }
  return n;
}

/** Why a packed chunk (save.js packChunk) cannot be used, or null. */
export function chunkProblem(p) {
  if (!isObj(p)) return 'not an object';
  for (const k of ['blocks', 'meta', 'light']) {
    const n = rleLength(p[k]);
    if (n < 0) return `${k} is not run-length data`;
    if (n !== CHUNK_VOLUME) return `${k} covers ${n} cells, not ${CHUNK_VOLUME}`;
  }
  if (!isBytes(p.biomes) || p.biomes.length !== 256) return 'biomes has the wrong size';
  if (!isBytes(p.heightmap) || p.heightmap.length !== 256) return 'heightmap has the wrong size';
  if (!isBytes(p.colors) || p.colors.length === 0) return 'colors is missing';
  return null;
}

function validPlayer(p) {
  return isObj(p) && isNum(p.x) && isNum(p.y) && isNum(p.z) && isArr(p.slots) && isNum(p.health) && isObj(p.spawn || {});
}

/**
 * Check a (migrated) save. Returns a list of problems { code, path, msg, fatal }. Fatal ones cannot be repaired
 * (no seed, no player and no spawn to rebuild one from); the rest can, at worst by dropping what is damaged.
 * `quick` skips the per-chunk checks (used before taking a backup).
 */
export function validateSave(d, { quick = false } = {}) {
  const out = [];
  const add = (code, path, msg, fatal = false) => out.push({ code, path, msg, fatal });
  if (!isObj(d)) { add('notObject', '', 'The save is not a world record', true); return out; }
  if (!isNum(d.seed)) add('seed', 'seed', 'The world seed is missing', true);
  if (!isNum(d.time)) add('time', 'time', 'The world time is damaged');
  if (typeof d.name !== 'string' || !d.name) add('name', 'name', 'The world name is missing');
  if (!validPlayer(d.player)) {
    const spawnOK = isObj(d.worldSpawn) && isNum(d.worldSpawn.x) && isNum(d.worldSpawn.y) && isNum(d.worldSpawn.z);
    add('player', 'player', 'The player data is damaged', !spawnOK);
  }
  for (const k of Object.keys(LIST_FIELDS)) {
    const ok = k === 'savedMobs' || k === 'chunks' ? isObj(d[k]) : isArr(d[k]);
    if (!ok) add('list', k, `${k} is missing or damaged`);
    else if ((isArr(d[k]) ? d[k].length : Object.keys(d[k]).length) > LIMITS.maxEntries) add('tooMany', k, `${k} has too many entries`);
  }
  if (quick) return out;
  const checkChunks = (chunks, path) => {
    if (!isObj(chunks)) return;
    const keys = Object.keys(chunks);
    if (keys.length > LIMITS.maxChunks) add('tooManyChunks', path, `${path} has ${keys.length} chunks`, true);
    for (const k of keys) {
      if (!Number.isInteger(+k)) { add('chunk', `${path}.${k}`, `chunk key "${k.slice(0, 20)}" is not a number`); continue; }
      const why = chunkProblem(chunks[k]);
      if (why) add('chunk', `${path}.${k}`, `chunk ${k}: ${why}`);
    }
  };
  checkChunks(d.chunks, 'chunks');
  if (d.dimensions !== undefined) {
    if (!isObj(d.dimensions)) add('dimensions', 'dimensions', 'The other dimensions are damaged');
    else for (const [dim, v] of Object.entries(d.dimensions)) {
      if (!isObj(v)) add('dimensions', `dimensions.${dim}`, `dimension ${dim} is damaged`);
      else checkChunks(v.chunks, `dimensions.${dim}.chunks`);
    }
  }
  return out;
}

/**
 * Repair what validateSave found: damaged chunks are dropped (terrain regenerates from the seed), broken lists
 * become empty, a damaged player is rebuilt at the world spawn. Returns { data, fixes: [string] }; the input is not changed.
 */
export function repairSave(d, problems = validateSave(d)) {
  const fatal = problems.find((p) => p.fatal);
  if (fatal) return { data: null, fixes: [], error: fatal.msg };
  const data = { ...d }, fixes = [];
  const drop = new Map(); // where the chunks live ('chunks' or a dimension) -> keys to remove
  const dropKey = (where, k) => { if (!drop.has(where)) drop.set(where, new Set()); drop.get(where).add(k); };
  for (const p of problems) {
    let m;
    if (p.code === 'time') { data.time = 0; fixes.push('reset the world time'); }
    else if (p.code === 'name') { data.name = 'Recovered World'; fixes.push('gave the world a name'); }
    else if (p.code === 'list' || p.code === 'tooMany') { data[p.path] = LIST_FIELDS[p.path](); fixes.push(`emptied ${p.path}`); }
    else if (p.code === 'player') {
      const s = data.worldSpawn;
      data.player = {
        x: s.x, y: s.y, z: s.z, yaw: 0, pitch: 0, health: 20, food: 20, saturation: 5, exhaustion: 0, air: 300,
        spawn: { x: s.x, y: s.y, z: s.z }, bed: null, slots: new Array(36).fill(null), armor: [null, null, null, null], selected: 0, gamemode: 'survival', flying: false,
      };
      fixes.push('rebuilt the player at the world spawn');
    } else if (p.code === 'chunk') {
      if ((m = /^chunks\.(.*)$/.exec(p.path))) dropKey('chunks', m[1]);
      else if ((m = /^dimensions\.([^.]+)\.chunks\.(.*)$/.exec(p.path))) dropKey(`dimensions.${m[1]}`, m[2]);
      fixes.push(`dropped damaged ${p.path}`);
    } else if (p.code === 'dimensions') {
      const dim = p.path.split('.')[1];
      data.dimensions = { ...(isObj(data.dimensions) ? data.dimensions : {}) };
      if (dim) delete data.dimensions[dim]; else data.dimensions = {};
      fixes.push(`dropped ${p.path}`);
    }
  }
  for (const [where, keys] of drop) {
    if (where === 'chunks') { data.chunks = { ...data.chunks }; for (const k of keys) delete data.chunks[k]; }
    else {
      const dim = where.slice('dimensions.'.length);
      if (!isObj(data.dimensions) || !isObj(data.dimensions[dim])) continue;
      data.dimensions = { ...data.dimensions };
      data.dimensions[dim] = { ...data.dimensions[dim], chunks: { ...data.dimensions[dim].chunks } };
      for (const k of keys) delete data.dimensions[dim].chunks[k];
    }
  }
  if (isArr(data.liveMobs)) {
    const ok = data.liveMobs.filter((m) => isObj(m) && isNum(m.x) && isNum(m.z));
    if (ok.length !== data.liveMobs.length) { data.liveMobs = ok; fixes.push('dropped mobs that cannot be placed'); }
  }
  const again = validateSave(data);
  if (again.length) return { data: null, fixes, error: again[0].msg };
  return { data, fixes };
}

/**
 * Look at a record from storage or a file: migrate, validate and say what can be done.
 * status: 'ok' | 'repairable' (usable after repairSave) | 'damaged' | 'newer' (needs a later game).
 */
export function inspectSave(raw) {
  const m = migrateSave(raw);
  if (m.error) return { status: m.newer ? 'newer' : 'damaged', data: null, problems: [{ code: m.newer ? 'newer' : 'version', path: 'version', msg: m.error, fatal: true }], from: null };
  const problems = validateSave(m.data);
  const status = problems.length === 0 ? 'ok' : problems.some((p) => p.fatal) ? 'damaged' : 'repairable';
  return { status, data: m.data, problems, from: m.from };
}

// ---- size ------------------------------------------------------------------------------------------------------
/**
 * A cheap estimate of a save's size in bytes: typed arrays count their bytes, strings their length, numbers 8.
 * It walks the data once without copying (about a hundred thousand nodes for a large world).
 */
export function estimateBytes(value, depth = 0) {
  if (value === null || value === undefined) return 1;
  switch (typeof value) {
    case 'number': return 8;
    case 'boolean': return 1;
    case 'string': return value.length;
    case 'object': break;
    default: return 0;
  }
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (depth > 24) return 0;
  let n = 8;
  if (Array.isArray(value)) {
    // plain arrays of numbers (RLE data that went through JSON) are sized without visiting each element
    if (value.length > 64 && typeof value[0] === 'number') return n + value.length * 8;
    for (const v of value) n += estimateBytes(v, depth + 1);
    return n;
  }
  for (const k in value) n += k.length + estimateBytes(value[k], depth + 1);
  return n;
}

export function formatBytes(n) {
  if (!isNum(n) || n < 0) return '?';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

// ---- names and the summary shown in the list ------------------------------------------------------------------
/** A name made unique among `taken` by a suffix ("World", "World (2)"); `word` ("copy") is added first when given. */
export function uniqueName(base, taken, word = '') {
  const set = new Set([...taken].map((n) => String(n).toLowerCase()));
  const cut = (s) => s.slice(0, LIMITS.nameMax);
  let stem = cleanName(base) || 'World';
  if (word) stem = cut(`${stem.slice(0, LIMITS.nameMax - word.length - 1)} ${word}`);
  if (!set.has(stem.toLowerCase())) return stem;
  for (let i = 2; i < 1000; i++) {
    const suffix = ` (${i})`;
    const c = stem.slice(0, LIMITS.nameMax - suffix.length) + suffix;
    if (!set.has(c.toLowerCase())) return c;
  }
  return stem;
}

/** A world name from user input: control characters out, trimmed, at most nameMax long. */
export function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.nameMax);
}

const THUMB_OK = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]{0,200000}$/;
/** A thumbnail data URL is only trusted when it is a short base64 image (it ends up in an <img src>). */
export const cleanThumbnail = (s) => (typeof s === 'string' && THUMB_OK.test(s) ? s : null);

/** The small record shown in the world list; made from the full save without loading anything else. */
export function worldSummary(slot, d, { size } = {}) {
  const meta = isObj(d.meta) ? d.meta : {};
  const rules = isObj(d.gameRules) ? d.gameRules : {};
  const player = isObj(d.player) ? d.player : {};
  return {
    slot,
    name: typeof d.name === 'string' && d.name ? d.name : `World ${slot}`,
    seed: d.seed,
    seedText: typeof meta.seedText === 'string' ? meta.seedText.slice(0, LIMITS.seedTextMax) : null,
    playTicks: isObj(d.stats) && isNum(d.stats.ticks) ? Math.floor(d.stats.ticks) : 0,
    savedAt: isNum(d.savedAt) ? d.savedAt : 0,
    createdAt: isNum(meta.createdAt) ? meta.createdAt : 0,
    size: isNum(size) ? size : estimateBytes(d),
    thumbnail: cleanThumbnail(meta.thumbnail),
    version: isNum(d.version) ? d.version : 1,
    gamemode: typeof player.gamemode === 'string' ? player.gamemode : 'survival',
    difficulty: DIFFICULTY_KEYS.includes(rules.difficulty) ? rules.difficulty : 'normal',
    seasons: rules.doSeasons !== false,
    worldType: typeof meta.worldType === 'string' ? meta.worldType : 'normal',
    allowCheats: meta.allowCheats !== false,
    hardcore: meta.hardcore === true, hardcoreOver: meta.hardcore === true && meta.hardcoreOver === true,
    damaged: false,
  };
}

// ---- backups ---------------------------------------------------------------------------------------------------
export const BACKUP_LIMIT = 3;                     // snapshots kept per world
export const BACKUP_INTERVAL_MS = 15 * 60 * 1000;  // a new one only when the previous is at least this much older than the save

/**
 * Should the record about to be overwritten be copied into the backup ring? `prevSavedAt` is when that record was saved,
 * `backups` the index (newest first, each { savedAt }).
 */
export function shouldBackup(prevSavedAt, backups, interval = BACKUP_INTERVAL_MS) {
  if (!isNum(prevSavedAt) || prevSavedAt <= 0) return false;
  if (!backups.length) return true;
  return prevSavedAt - backups[0].savedAt >= interval;
}

/** The index after adding `entry` (newest first) and the entries that fell off the end. */
export function pushBackup(backups, entry, limit = BACKUP_LIMIT) {
  const all = [entry, ...backups];
  return { kept: all.slice(0, Math.max(1, limit)), dropped: all.slice(Math.max(1, limit)) };
}

// ---- storage quota ---------------------------------------------------------------------------------------------
export const QUOTA_WARN = 0.8, QUOTA_CRITICAL = 0.95;
/** 'ok' | 'warn' | 'critical' for a usage / quota pair (null when the browser does not say). */
export function quotaLevel(usage, quota) {
  if (!isNum(usage) || !isNum(quota) || quota <= 0) return null;
  const r = usage / quota;
  return r >= QUOTA_CRITICAL ? 'critical' : r >= QUOTA_WARN ? 'warn' : 'ok';
}
export function isQuotaError(e) {
  return !!e && (e.quota === true || e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(String(e.message || '')));
}

// ---- the export file -------------------------------------------------------------------------------------------
const MAGIC = [0x53, 0x41, 0x54, 0x57, 0x4f, 0x52, 0x4c, 0x44]; // "SATWORLD"
export const FILE_FORMAT = 1;
export const FILE_EXTENSION = '.saturnworld';
const TYPED = { Uint8Array, Uint16Array, Int16Array, Int32Array, Float32Array };

let crcTable = null;
export function crc32(bytes) {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Replace typed arrays by references into one blob; everything else is copied as plain JSON data. */
function toHeader(value, blobs, state, depth = 0) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value !== 'object') return typeof value === 'number' && !Number.isFinite(value) ? null : value;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const name = value.constructor.name;
    if (!TYPED[name]) throw new Error(`Cannot export a ${name}`);
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    state.offset = (state.offset + 7) & ~7;
    const ref = { $ta: name, o: state.offset, n: value.length };
    blobs.push([state.offset, bytes]);
    state.offset += bytes.length;
    return ref;
  }
  if (depth > LIMITS.maxDepth) throw new Error('The world is nested too deeply to export');
  if (Array.isArray(value)) return value.map((v) => { const r = toHeader(v, blobs, state, depth + 1); return r === undefined ? null : r; });
  const out = {};
  for (const k of Object.keys(value)) {
    if (k === '__proto__') continue;
    const r = toHeader(value[k], blobs, state, depth + 1);
    if (r !== undefined) out[k] = r;
  }
  return out;
}

/** The uncompressed container for a save: magic, format, checksum, header length, JSON header, blob. */
export function encodeContainer(data, info = {}) {
  const blobs = [], state = { offset: 0 };
  const world = toHeader(data, blobs, state);
  const header = new TextEncoder().encode(JSON.stringify({ format: FILE_FORMAT, game: 'saturncraft', exportedAt: Date.now(), ...info, world }));
  const total = 20 + header.length + state.offset;
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(8, FILE_FORMAT, true);
  dv.setUint32(16, header.length, true);
  out.set(header, 20);
  for (const [o, bytes] of blobs) out.set(bytes, 20 + header.length + o);
  dv.setUint32(12, crc32(out.subarray(20)), true);
  return out;
}

/** Rebuild a value from header JSON: typed arrays from the blob (whitelisted, bounds-checked), prototype keys dropped. */
function fromHeader(value, blob, st, depth = 0) {
  if (++st.nodes > LIMITS.maxNodes) throw new Error('The file has too much data in it');
  if (value === null || typeof value !== 'object') return value;
  if (depth > LIMITS.maxDepth) throw new Error('The file is nested too deeply');
  if (Array.isArray(value)) return value.map((v) => fromHeader(v, blob, st, depth + 1));
  if (typeof value.$ta === 'string') {
    const T = TYPED[value.$ta];
    if (!T || !Number.isInteger(value.o) || !Number.isInteger(value.n) || value.o < 0 || value.n < 0) throw new Error('The file has a damaged array reference');
    const end = value.o + value.n * T.BYTES_PER_ELEMENT;
    if (end > blob.length) throw new Error('The file is cut short (an array runs past its end)');
    return new T(blob.slice(value.o, end).buffer); // slice copies, so the new array is aligned and owns its memory
  }
  const out = {};
  for (const k of Object.keys(value)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = fromHeader(value[k], blob, st, depth + 1);
  }
  return out;
}

/** Parse the uncompressed container. Throws Error with a message fit for the player. */
export function decodeContainer(bytes) {
  if (bytes.length < 20 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('This is not a Saturncraft world file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = dv.getUint32(8, true);
  if (format > FILE_FORMAT) throw new Error(`This file uses a newer export format (${format}); update the game to open it`);
  if (format < 1) throw new Error('Unknown world file format');
  const crc = dv.getUint32(12, true), hl = dv.getUint32(16, true);
  if (hl > LIMITS.maxHeaderBytes || 20 + hl > bytes.length) throw new Error('The world file is damaged (bad header size)');
  if (crc32(bytes.subarray(20)) !== crc) throw new Error('The world file is damaged (checksum mismatch)');
  let head;
  try { head = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, 20 + hl))); } catch { throw new Error('The world file is damaged (unreadable header)'); }
  if (!isObj(head) || head.game !== 'saturncraft' || !isObj(head.world)) throw new Error('This is not a Saturncraft world file');
  const blob = bytes.subarray(20 + hl);
  const world = fromHeader(head.world, blob, { nodes: 0 });
  return { world, info: { format, exportedAt: isNum(head.exportedAt) ? head.exportedAt : 0, name: typeof head.name === 'string' ? head.name.slice(0, 60) : '' } };
}

async function pipeAll(bytes, stream, cap) {
  const w = stream.writable.getWriter();
  const done = (async () => { try { await w.write(bytes); await w.close(); } catch { /* the reader sees the error */ } })();
  const reader = stream.readable.getReader(), parts = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      total += value.length;
      if (total > cap) { await reader.cancel().catch(() => {}); throw new Error('The world file is too large once unpacked'); }
      parts.push(value);
    }
  } finally { await done; }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** A save as the bytes of a downloadable file. `data` should be a valid current-format save. */
export async function exportBytes(data) {
  if (typeof CompressionStream === 'undefined') throw new Error('This browser cannot compress files');
  const raw = encodeContainer(data, { name: data.name });
  return pipeAll(raw, new CompressionStream('gzip'), LIMITS.maxUnpackedBytes * 2);
}

/** A safe file name for a world. */
export function exportFileName(name) {
  const base = String(name || 'world').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').replace(/^\.+/, '').slice(0, 40) || 'world';
  return base + FILE_EXTENSION;
}

/**
 * Read an imported file: size limit, gzip check, bounded decompression, container parse, then the usual inspection
 * (version check, migration, validation). Never throws; returns { status, data, problems, info, error }.
 * status: 'ok' | 'repairable' | 'damaged' | 'newer' | 'invalid' (not a world file at all) | 'toolarge'.
 */
export async function importBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) return { status: 'invalid', error: 'No file data', problems: [] };
  if (bytes.length > LIMITS.maxFileBytes) return { status: 'toolarge', error: `The file is larger than ${formatBytes(LIMITS.maxFileBytes)}`, problems: [] };
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return { status: 'invalid', error: 'This is not a Saturncraft world file (it is not compressed data)', problems: [] };
  if (typeof DecompressionStream === 'undefined') return { status: 'invalid', error: 'This browser cannot unpack files', problems: [] };
  let unpacked;
  try { unpacked = await pipeAll(bytes, new DecompressionStream('gzip'), LIMITS.maxUnpackedBytes); } catch (e) {
    const tooBig = /too large/.test(e.message);
    return { status: tooBig ? 'toolarge' : 'damaged', error: tooBig ? e.message : 'The world file is damaged (it does not unpack)', problems: [] };
  }
  let parsed;
  try { parsed = decodeContainer(unpacked); } catch (e) { return { status: /not a Saturncraft/.test(e.message) ? 'invalid' : 'damaged', error: e.message, problems: [] }; }
  const r = inspectSave(parsed.world);
  return { ...r, info: parsed.info, error: r.status === 'ok' || r.status === 'repairable' ? null : (r.problems[0] && r.problems[0].msg) || 'The world cannot be used' };
}
