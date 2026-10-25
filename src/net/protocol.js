// Multiplayer wire format: JSON messages (split into fragments when large),
// typed arrays as base64, compact player / mob snapshots and room codes.
// Pure functions only, so everything here is unit-testable without a network.

import { cleanEnch, withExtras, sameEnch } from '../world/enchantments.js';

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
export const PF = { SNEAK: 1, DEAD: 2, SLEEP: 4, CREATIVE: 8, HURT: 16, RIDING: 32, INVISIBLE: 64 };
/** Compact state of a player: [x, y, z, yaw, pitch, heldItemId|-1, flags, swingSeq]. */
export function packPlayerState(p, held, swingSeq, armor = null) {
  const f = (p.sneaking ? PF.SNEAK : 0) | (p.dead ? PF.DEAD : 0) | (p.sleeping ? PF.SLEEP : 0) |
    (p.creative ? PF.CREATIVE : 0) | (p.hurtTime > 0 ? PF.HURT : 0) | (p.riding ? PF.RIDING : 0) | ((p.effects && p.effects.invisibility) || p.gamemode === 'spectator' ? PF.INVISIBLE : 0);
  const ar = armor || (p.inventory && p.inventory.armor ? p.inventory.armor.map((s) => (s ? s.id : 0)) : [0, 0, 0, 0]);
  return [r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), held == null ? -1 : held, f, swingSeq | 0, ...ar];
}
export function unpackPlayerState(a) {
  if (!Array.isArray(a) || a.length < 8 || !a.slice(0, 5).every(Number.isFinite)) return null;
  const f = a[6] | 0;
  return {
    x: a[0], y: a[1], z: a[2], yaw: a[3], pitch: a[4], held: a[5] < 0 ? null : a[5] | 0,
    sneaking: !!(f & PF.SNEAK), dead: !!(f & PF.DEAD), sleeping: !!(f & PF.SLEEP), creative: !!(f & PF.CREATIVE),
    hurt: !!(f & PF.HURT), riding: !!(f & PF.RIDING), invisible: !!(f & PF.INVISIBLE), swing: a[7] | 0,
    armor: a.length >= 12 ? [a[8] | 0, a[9] | 0, a[10] | 0, a[11] | 0].map((i) => i || null) : [null, null, null, null],
  };
}

// ---- mob snapshots --------------------------------------------------------------
export const MF = { GROUND: 1, TARGET: 2, ANGRY: 4, BABY: 8, SHEARED: 16, TAMED: 32, SITTING: 64, ENEMY: 128, SPECIAL: 256 }; // SPECIAL: a Hexwife drinking, a Shambler about to convert
/** [id, type, x, y, z, yaw, headPitch, health, hurtTime, deathTime, flags, woolColor, fuse, profession, beam [x,y,z] | 0, moving] */
export function packMob(m) {
  const f = (m.body && m.body.onGround ? MF.GROUND : 0) | (m.target ? MF.TARGET : 0) | (m.angry ? MF.ANGRY : 0) |
    (m.age < 0 ? MF.BABY : 0) | (m.sheared ? MF.SHEARED : 0) | (m.tamed ? MF.TAMED : 0) | (m.sitting ? MF.SITTING : 0) | (m.enemy ? MF.ENEMY : 0) | (m.special ? MF.SPECIAL : 0);
  return [m.id, m.type, r2(m.x), r2(m.y), r2(m.z), r2(m.yaw), r2(m.headPitch || 0), r2(m.health), m.hurtTime | 0, m.deathTime | 0, f, m.woolColor | 0, m.fuse | 0, m.profession || 0,
    m.beam ? [r2(m.beam.x), r2(m.beam.y), r2(m.beam.z)] : 0, m.moving ? 1 : 0]; // Deepeye beams (mobs/oceanMobs.js)
}
export function unpackMob(a) {
  if (!Array.isArray(a) || a.length < 13) return null;
  const f = a[10] | 0;
  return {
    id: a[0], type: a[1], x: a[2], y: a[3], z: a[4], yaw: a[5], headPitch: a[6], health: a[7], hurtTime: a[8], deathTime: a[9],
    onGround: !!(f & MF.GROUND), target: !!(f & MF.TARGET), angry: !!(f & MF.ANGRY), baby: !!(f & MF.BABY),
    sheared: !!(f & MF.SHEARED), tamed: !!(f & MF.TAMED), sitting: !!(f & MF.SITTING), enemy: !!(f & MF.ENEMY), special: !!(f & MF.SPECIAL),
    woolColor: a[11] | 0, fuse: a[12] | 0, profession: a[13] || null,
    beam: Array.isArray(a[14]) && a[14].length === 3 && a[14].every(Number.isFinite) ? { x: a[14][0], y: a[14][1], z: a[14][2] } : null, moving: !!a[15],
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

// ---- shared entities (items, orbs, arrows, boats, falling blocks, armour stands, mobs) ---
/**
 * Compact snapshot of any host entity: [kind, id, x, y, z, ...kind specific].
 * `riderOf(boat)` gives the boat rider's player id (0 = host) or -1.
 */
export function packEntity(e, riderOf = () => -1) {
  switch (e.kind) {
    case 'mob': return ['m', ...packMob(e)];
    case 'item': return ['i', e.id, r2(e.x), r2(e.y), r2(e.z), e.stack.id, e.stack.count, e.stack.damage | 0, e.pickupDelay > 0 ? 1 : 0, e.stack.ench ? cleanEnch(e.stack.ench) : 0, e.stack.contents || 0, Number.isInteger(e.stack.map) ? [e.stack.map, e.stack.mapX | 0, e.stack.mapZ | 0] : 0];
    case 'xp': return ['x', e.id, r2(e.x), r2(e.y), r2(e.z), e.value];
    case 'arrow': return ['a', e.id, r2(e.x), r2(e.y), r2(e.z), r2(e.vx), r2(e.vy), r2(e.vz), e.stuck ? 1 : 0, e.pickup ? 1 : 0, e.thrown === 'spear' ? 4 : e.thrown === 'potion' ? 3 : e.thrown === 'egg' ? 2 : e.thrown ? 1 : 0, e.potion | 0];
    case 'boat': return ['b', e.id, r2(e.x), r2(e.y), r2(e.z), r2(e.yaw), e.hitTime | 0, riderOf(e), e.cart ? 1 : 0, r2(e.pitch || 0)];
    case 'falling': return ['f', e.id, r2(e.x), r2(e.y), r2(e.z), e.blockId];
    case 'stand': return ['s', e.id, r2(e.x), r2(e.y), r2(e.z), r2(e.yaw), e.hitTime | 0, e.armor.map((st) => (st ? st.id : 0)), e.hand ? e.hand.id : 0];
    default: return null;
  }
}
const ENTITY_KINDS = { m: 'mob', i: 'item', x: 'xp', a: 'arrow', b: 'boat', f: 'falling', s: 'stand' };
export function unpackEntity(a) {
  if (!Array.isArray(a) || !ENTITY_KINDS[a[0]]) return null;
  if (a[0] === 'm') { const m = unpackMob(a.slice(1)); return m && { ...m, kind: 'mob' }; }
  const [k, id, x, y, z] = a;
  if (![x, y, z].every(Number.isFinite)) return null;
  const o = { kind: ENTITY_KINDS[k], id, x, y, z };
  if (k === 'i') Object.assign(o, { stack: withExtras({ id: a[5] | 0, count: a[6] | 0, damage: a[7] | 0 }, { ench: a[9], contents: a[10], ...(Array.isArray(a[11]) ? { map: a[11][0] | 0, mapX: a[11][1], mapZ: a[11][2] } : {}) }), delayed: !!a[8] });
  else if (k === 'x') o.value = a[5] | 0;
  else if (k === 'a') Object.assign(o, { vx: a[5], vy: a[6], vz: a[7], stuck: !!a[8], pickup: !!a[9], thrown: a[10] === 4 ? 'spear' : a[10] === 3 ? 'potion' : a[10] === 2 ? 'egg' : a[10] === 1 ? 'snowball' : null, potion: a[11] | 0 });
  else if (k === 'b') Object.assign(o, { yaw: a[5], hitTime: a[6] | 0, rider: a[7], cart: !!a[8], pitch: +a[9] || 0 });
  else if (k === 'f') o.blockId = a[5] | 0;
  else if (k === 's') {
    const ids = Array.isArray(a[7]) ? a[7] : [];
    Object.assign(o, { yaw: +a[5] || 0, hitTime: a[6] | 0, armor: [0, 1, 2, 3].map((i) => (ids[i] | 0) || null), hand: (a[8] | 0) || null });
  }
  return o;
}

// ---- containers (chests and furnaces) ---------------------------------------------
export const FURNACE_SLOTS = ['input', 'fuel', 'output'];
export function containerSlots(kind, c) {
  return kind === 'furnace' ? FURNACE_SLOTS.map((k) => c[k] || null) : c.slots.slice();
}
export function setContainerSlot(kind, c, i, st) {
  if (kind === 'furnace') c[FURNACE_SLOTS[i]] = st; else c.slots[i] = st;
}
export function sameStack(a, b) {
  if (!a || !b) return !a && !b;
  return a.id === b.id && a.count === b.count && (a.damage | 0) === (b.damage | 0) && sameEnch(a.ench, b.ench) && (a.rw | 0) === (b.rw | 0);
}
/** A clean copy of a stack (id, count, damage, enchantments and anvil prior work only). */
export const copyStack = (s) => (s ? withExtras({ id: s.id, count: s.count, damage: s.damage | 0 }, s) : null);
/** Slot changes between two snapshots: [[index, before, after], ...]. */
export function diffSlots(before, after) {
  const out = [];
  for (let i = 0; i < Math.max(before.length, after.length); i++) if (!sameStack(before[i], after[i])) out.push([i, copyStack(before[i]), copyStack(after[i])]);
  return out;
}
/**
 * Host side: apply a client's slot changes only if every slot still holds what
 * the client saw (otherwise someone else got there first). Returns true if applied.
 */
export function applySlotChanges(kind, c, changes) {
  const cur = containerSlots(kind, c), n = cur.length;
  if (!Array.isArray(changes)) return false;
  for (const ch of changes) {
    if (!Array.isArray(ch) || !Number.isInteger(ch[0]) || ch[0] < 0 || ch[0] >= n) return false;
    if (!sameStack(cur[ch[0]], ch[1])) return false;
    const st = ch[2];
    if (st && (!Number.isInteger(st.id) || !Number.isInteger(st.count) || st.count <= 0 || st.count > 64)) return false;
  }
  for (const [i, , st] of changes) setContainerSlot(kind, c, i, copyStack(st));
  return true;
}
export function containerState(kind, c) {
  if (kind === 'furnace') return { slots: containerSlots(kind, c).map(copyStack), burnTime: c.burnTime | 0, burnTotal: c.burnTotal | 0, cookTime: c.cookTime | 0 };
  if (kind === 'brewing') return { slots: c.slots.map(copyStack), fuel: c.fuel | 0, brewTime: c.brewTime | 0 };
  return { slots: c.slots.map(copyStack) };
}
/** Client side: copy a host container state into the local mirror object (keeping its identity). */
export function loadContainerState(kind, c, s) {
  if (!s || !Array.isArray(s.slots)) return;
  s.slots.forEach((st, i) => setContainerSlot(kind, c, i, copyStack(st)));
  if (kind === 'furnace') { c.burnTime = s.burnTime | 0; c.burnTotal = s.burnTotal | 0; c.cookTime = s.cookTime | 0; }
  if (kind === 'brewing') { c.fuel = s.fuel | 0; c.brewTime = s.brewTime | 0; }
}

/** How many of a stack fit into inventory slots. */
export function roomFor(slots, st, maxStackOf, stackable = true) {
  const max = maxStackOf(st.id);
  let n = 0;
  for (const s of slots) {
    if (!s) n += max;
    else if (stackable && s.id === st.id && s.count < max) n += max - s.count;
  }
  return n;
}

/** Chat commands that change the shared world: guests have the host run them. */
export const WORLD_COMMANDS = new Set(['time', 'weather', 'gamerule', 'summon', 'dimension', 'dim']);
export function commandName(text) { return (String(text).trim().replace(/^\//, '').split(/\s+/)[0] || '').toLowerCase(); }
