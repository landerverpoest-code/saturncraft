// Multiplayer wire format: JSON messages (split into fragments when large),
// typed arrays as base64, compact player / mob snapshots and room codes.
// Pure functions only, so everything here is unit-testable without a network.

export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 8;
export const PEER_PREFIX = 'saturncraft-';
export const FRAGMENT_SIZE = 48000; // characters per data-channel message (well under SCTP limits)

// ---- room codes & names ---------------------------------------------------------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
export function makeRoomCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}
/** Accepts "abc123", " saturncraft-ABC123 " or a join link; returns "ABC123" or null. */
export function normalizeRoomCode(input) {
  if (!input) return null;
  let s = String(input).trim();
  const m = s.match(/[?&]join=([^&#]+)/);
  if (m) s = decodeURIComponent(m[1]);
  s = s.toUpperCase().replace(/^SATURNCRAFT-/, '').replace(/[^A-Z0-9]/g, '');
  return s.length >= 4 && s.length <= 12 ? s : null;
}
export function peerIdFor(code) { return PEER_PREFIX + code; }
export function defaultPlayerName(rand = Math.random) {
  return 'Player-' + String(Math.floor(rand() * 10000)).padStart(4, '0');
}
export function cleanName(name) {
  const s = String(name || '').replace(/[^\w\- .]/g, '').trim().slice(0, 16);
  return s || 'Player';
}

// ---- typed arrays <-> base64 ---------------------------------------------------
const TYPED = { Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array };
function bytesToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function encodeTyped(ta) {
  const ty = ta.constructor.name;
  if (!TYPED[ty]) throw new Error('unsupported array type ' + ty);
  return { ty, b: bytesToB64(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength)) };
}
export function decodeTyped(o) {
  const C = TYPED[o.ty];
  if (!C) throw new Error('unsupported array type ' + o.ty);
  const bytes = b64ToBytes(o.b);
  return new C(bytes.buffer, 0, bytes.byteLength / C.BYTES_PER_ELEMENT);
}

/** A packed chunk (see save.js packChunk) as plain JSON. */
export function encodePackedChunk(p) {
  const out = {};
  for (const k of Object.keys(p)) out[k] = ArrayBuffer.isView(p[k]) ? encodeTyped(p[k]) : p[k];
  return out;
}
export function decodePackedChunk(o) {
  const out = {};
  for (const k of Object.keys(o)) out[k] = o[k] && o[k].ty && o[k].b !== undefined ? decodeTyped(o[k]) : o[k];
  return out;
}

// ---- framing ------------------------------------------------------------------
let fragSeq = 1;
/** One message -> one or more strings for the data channel. */
export function encodeMessage(msg, size = FRAGMENT_SIZE) {
  const json = JSON.stringify(msg);
  if (json.length <= size) return [json];
  const id = fragSeq++;
  const n = Math.ceil(json.length / size);
  const out = [];
  for (let i = 0; i < n; i++) out.push(`~${id},${i},${n}|` + json.slice(i * size, (i + 1) * size));
  return out;
}

/** Rebuilds messages from data-channel strings (fragments arrive in order on a reliable channel). */
export class Reassembler {
  constructor() { this.parts = new Map(); }
  push(str) {
    if (typeof str !== 'string') return null;
    if (str[0] !== '~') { try { return JSON.parse(str); } catch { return null; } }
    const bar = str.indexOf('|');
    const [id, i, n] = str.slice(1, bar).split(',').map(Number);
    let e = this.parts.get(id);
    if (!e) { e = { n, got: 0, chunks: new Array(n) }; this.parts.set(id, e); }
    if (e.chunks[i] === undefined) { e.chunks[i] = str.slice(bar + 1); e.got++; }
    if (e.got < e.n) return null;
    this.parts.delete(id);
    try { return JSON.parse(e.chunks.join('')); } catch { return null; }
  }
}

// ---- block edits ----------------------------------------------------------------
/** Collects block edits, last write per position wins; flat [x,y,z,id,meta, ...]. */
export class EditBuffer {
  constructor() { this.map = new Map(); }
  add(x, y, z, id, meta) { this.map.set(`${x},${y},${z}`, [x, y, z, id, meta]); }
  get size() { return this.map.size; }
  take() {
    const out = [];
    for (const e of this.map.values()) out.push(e[0], e[1], e[2], e[3], e[4]);
    this.map.clear();
    return out;
  }
}
export function* iterEdits(flat) {
  if (!Array.isArray(flat)) return;
  for (let i = 0; i + 4 < flat.length; i += 5) yield [flat[i], flat[i + 1], flat[i + 2], flat[i + 3], flat[i + 4]];
}

// ---- player state ----------------------------------------------------------------
const r2 = (v) => Math.round(v * 100) / 100;
export const PF = { SNEAK: 1, DEAD: 2, SLEEP: 4, CREATIVE: 8, HURT: 16, RIDING: 32 };
/** Compact state of a player: [x, y, z, yaw, pitch, heldItemId|-1, flags, swingSeq]. */
export function packPlayerState(p, held, swingSeq) {
  const f = (p.sneaking ? PF.SNEAK : 0) | (p.dead ? PF.DEAD : 0) | (p.sleeping ? PF.SLEEP : 0) |
    (p.creative ? PF.CREATIVE : 0) | (p.hurtTime > 0 ? PF.HURT : 0) | (p.riding ? PF.RIDING : 0);
  return [r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), held == null ? -1 : held, f, swingSeq | 0];
}
export function unpackPlayerState(a) {
  if (!Array.isArray(a) || a.length < 8 || !a.slice(0, 5).every(Number.isFinite)) return null;
  const f = a[6] | 0;
  return {
    x: a[0], y: a[1], z: a[2], yaw: a[3], pitch: a[4], held: a[5] < 0 ? null : a[5] | 0,
    sneaking: !!(f & PF.SNEAK), dead: !!(f & PF.DEAD), sleeping: !!(f & PF.SLEEP), creative: !!(f & PF.CREATIVE),
    hurt: !!(f & PF.HURT), riding: !!(f & PF.RIDING), swing: a[7] | 0,
  };
}

// ---- mob snapshots --------------------------------------------------------------
export const MF = { GROUND: 1, TARGET: 2, ANGRY: 4, BABY: 8, SHEARED: 16, TAMED: 32, SITTING: 64, ENEMY: 128 };
/** [id, type, x, y, z, yaw, headPitch, health, hurtTime, deathTime, flags, woolColor, fuse, profession] */
export function packMob(m) {
  const f = (m.body && m.body.onGround ? MF.GROUND : 0) | (m.target ? MF.TARGET : 0) | (m.angry ? MF.ANGRY : 0) |
    (m.age < 0 ? MF.BABY : 0) | (m.sheared ? MF.SHEARED : 0) | (m.tamed ? MF.TAMED : 0) | (m.sitting ? MF.SITTING : 0) | (m.enemy ? MF.ENEMY : 0);
  return [m.id, m.type, r2(m.x), r2(m.y), r2(m.z), r2(m.yaw), r2(m.headPitch || 0), r2(m.health), m.hurtTime | 0, m.deathTime | 0, f, m.woolColor | 0, m.fuse | 0, m.profession || 0];
}
export function unpackMob(a) {
  if (!Array.isArray(a) || a.length < 13) return null;
  const f = a[10] | 0;
  return {
    id: a[0], type: a[1], x: a[2], y: a[3], z: a[4], yaw: a[5], headPitch: a[6], health: a[7], hurtTime: a[8], deathTime: a[9],
    onGround: !!(f & MF.GROUND), target: !!(f & MF.TARGET), angry: !!(f & MF.ANGRY), baby: !!(f & MF.BABY),
    sheared: !!(f & MF.SHEARED), tamed: !!(f & MF.TAMED), sitting: !!(f & MF.SITTING), enemy: !!(f & MF.ENEMY),
    woolColor: a[11] | 0, fuse: a[12] | 0, profession: a[13] || null,
  };
}

// ---- the player's name (title screen field, kept in localStorage) ---------------------
const NAME_KEY = 'saturncraft.name';
export function loadPlayerName() {
  let n = null;
  try { n = localStorage.getItem(NAME_KEY); } catch { /* storage unavailable */ }
  if (!n) { n = defaultPlayerName(); savePlayerName(n); }
  return cleanName(n);
}
export function savePlayerName(name) {
  try { localStorage.setItem(NAME_KEY, cleanName(name)); } catch { /* storage unavailable */ }
}
