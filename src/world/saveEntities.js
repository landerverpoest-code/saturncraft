// Dropped items and nearby hostile mobs in a saved world (optional `items` and `hostiles` lists; older saves have neither).
// Persistent mobs (animals, settlers, raiders, bosses, named or tamed creatures) keep their own path through `liveMobs` and the
// chunk lists, so only the ordinary despawnable monsters are written here. A guest saves none: they are the host's.
import { MOBS, CATEGORY } from '../mobs/mobTypes.js';
import { ITEMS, maxStack } from './items.js';
import { MIN_Y, MAX_Y } from './constants.js';
import { copyStack } from '../net/protocol.js';
import { chunkKey } from './world.js';

export const MAX_SAVED_ITEMS = 400;
export const MAX_SAVED_HOSTILES = 80;
export const HOSTILE_SAVE_RANGE = 64;
const ITEM_LIFETIME = 6000; // ticks an item lives (ItemEntity.tick)
const COORD = 3e7;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r3 = (v) => Math.round(v * 1000) / 1000;
const isGuest = (game) => !!(game.net && game.net.isClient);
const dist2 = (e, p) => (e.x - p.x) ** 2 + (e.y - p.y) ** 2 + (e.z - p.z) ** 2;

/** The live dropped items of this dimension, nearest to the player first (at most MAX_SAVED_ITEMS). */
export function saveItems(game) {
  if (isGuest(game)) return [];
  const p = game.player;
  return game.entities.list
    .filter((e) => e.kind === 'item' && !e.dead && !e.netProxy && e.stack && e.stack.count > 0)
    .sort((a, b) => dist2(a, p) - dist2(b, p))
    .slice(0, MAX_SAVED_ITEMS)
    .map((e) => ({ x: r3(e.x), y: r3(e.y), z: r3(e.z), v: [r3(e.body.vx), r3(e.body.vy), r3(e.body.vz)], age: e.age | 0, pd: e.pickupDelay | 0, st: copyStack(e.stack) }));
}

/** One saved item checked: a clean record, or null for junk. */
export function cleanItem(s) {
  if (!s || typeof s !== 'object' || !s.st || typeof s.st !== 'object') return null;
  if (![s.x, s.y, s.z].every(num) || Math.abs(s.x) > COORD || Math.abs(s.z) > COORD || s.y < MIN_Y - 64 || s.y > MAX_Y + 64) return null;
  const id = s.st.id;
  if (!Number.isInteger(id) || !ITEMS[id] || !Number.isInteger(s.st.count) || s.st.count < 1 || s.st.count > Math.max(64, maxStack(id))) return null;
  const v = Array.isArray(s.v) && s.v.length === 3 && s.v.every(num) ? s.v.map((n) => Math.max(-4, Math.min(4, n))) : [0, 0, 0];
  return { x: s.x, y: s.y, z: s.z, v, age: Math.max(0, Math.min(ITEM_LIFETIME - 1, num(s.age) ? Math.floor(s.age) : 0)), pd: Math.max(0, Math.min(40, num(s.pd) ? Math.floor(s.pd) : 0)), st: copyStack(s.st) };
}

/** Put saved items back (no-op without a list); returns how many came back. */
export function loadItems(game, list) {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  for (const raw of list.slice(0, MAX_SAVED_ITEMS)) {
    const s = cleanItem(raw);
    if (!s) continue;
    const e = game.entities.spawnItem(s.x, s.y, s.z, s.st, s.v);
    if (!e) continue;
    e.age = s.age; e.pickupDelay = s.pd; // (it carries on with the lifetime it had left)
    n++;
  }
  return n;
}

/** Despawnable monsters within HOSTILE_SAVE_RANGE of the player, nearest first (at most MAX_SAVED_HOSTILES). */
export function saveHostiles(game) {
  if (isGuest(game)) return [];
  const p = game.player, r2 = HOSTILE_SAVE_RANGE * HOSTILE_SAVE_RANGE;
  return game.entities.list
    .filter((e) => e.kind === 'mob' && !e.dead && !e.removed && e.deathTime === 0 && !e.netProxy && e.def && e.def.category === CATEGORY.MONSTER
      && !e.def.boss && !e.persistent && !e.noFreeze && !e.raider && !e.captain && dist2(e, p) <= r2)
    .sort((a, b) => dist2(a, p) - dist2(b, p))
    .slice(0, MAX_SAVED_HOSTILES)
    .map((e) => e.saveData());
}

/** One saved monster checked: the record, or null for junk. */
export function cleanHostile(m) {
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return null;
  const def = MOBS[m.type];
  if (!def || def.category !== CATEGORY.MONSTER || def.boss || m.raider || m.captain) return null;
  if (![m.x, m.y, m.z].every(num) || Math.abs(m.x) > COORD || Math.abs(m.z) > COORD || m.y < MIN_Y - 64 || m.y > MAX_Y + 64) return null;
  if (!num(m.health) || m.health <= 0 || m.health > 10000) return null;
  return { ...m, yaw: num(m.yaw) ? m.yaw : 0 };
}

/** Queue saved monsters into their chunks' mob lists (they appear when the chunk loads). Nothing comes back when hostile
 *  spawning is off or the difficulty is peaceful. Returns how many were queued. */
export function loadHostiles(game, list) {
  const s = game.settings || {};
  if (!Array.isArray(list) || s.hostileMobs === false || (game.difficulty || s.difficulty) === 'peaceful') return 0;
  let n = 0;
  for (const raw of list.slice(0, MAX_SAVED_HOSTILES)) {
    const m = cleanHostile(raw);
    if (!m) continue;
    const k = chunkKey(Math.floor(m.x / 16), Math.floor(m.z / 16));
    const l = game.spawner.savedMobs.get(k) || [];
    l.push(m);
    game.spawner.savedMobs.set(k, l);
    n++;
  }
  return n;
}
