// Vibrations (reference: game events and the frequencies a sensor tells them
// apart by). Things that happen in the world - a footstep, a landing, a block
// placed or broken, a door or chest opened or shut, a lever flipped, food
// eaten, an item tossed, an arrow landing, an explosion, a death - shake the
// ground; a Hush Sensor (world/hushSystem.js) within 8 blocks picks the
// shaking up unless a block of wool sits on the straight line between them.
//
// * Each kind of vibration has a frequency 1-15. A comparator reading a
//   pulsing sensor gets that frequency (stored in bits 4-7 of the sensor's
//   meta, bits 0-3 being its power), so contraptions can tell a door from a
//   footstep.
// * Listening blocks (sensors and shriekers) are indexed per chunk
//   (Chunk.listeners, kept by World.setBlock) so a vibration only looks at the
//   few listeners of at most four chunks instead of scanning 17^3 blocks.
// * Vibrations take time to travel: one that reaches a sensor `d` blocks away arrives
//   ceil(d) ticks later (TRAVEL_TICKS_PER_BLOCK; VibrationQueue below holds the ones in flight and
//   world/hushSystem.js hands each over when it is due). Whether a sensor is idle, and for a calibrated
//   one which frequency it is tuned to, is decided on arrival.
// * A Calibrated Hush Sensor (HushSystem.tuning reads its signal; crafted from a Hush Sensor and three Hush Shards) is tuned by the cinnabar
//   signal fed into it from any side: it only hears vibrations whose frequency equals that signal
//   (no signal: everything), and it hears up to 16 blocks away instead of 8.
import { B, BLOCK_LIMIT } from './blocks.js';
import { MIN_Y } from './constants.js';
import { findNear, VIBRATION_RANGE } from './deepHush.js';

/** Ticks a vibration needs per block of distance before a sensor hears it (0 = instantly). */
export const TRAVEL_TICKS_PER_BLOCK = 1;
/** How far a Calibrated Hush Sensor hears (blocks). */
export const CALIBRATED_RANGE = 16;
/** Ticks until a vibration `dist` blocks away arrives. */
export function travelTicks(dist, perBlock = TRAVEL_TICKS_PER_BLOCK) {
  return perBlock > 0 ? Math.max(0, Math.ceil(dist * perBlock - 1e-9)) : 0;
}
/** How far the sensor block `id` hears. */
export const sensorRange = (id) => (id === B.CALIBRATED_HUSH_SENSOR ? CALIBRATED_RANGE : VIBRATION_RANGE);
/** Does a calibrated sensor tuned to `tuning` hear a vibration of frequency `freq`? An untuned one hears them all. */
export function calibratedHears(freq, tuning) { return !tuning || freq === tuning; }

/** Vibrations in flight: { due, ... } entries kept ordered by the tick they arrive. */
export class VibrationQueue {
  constructor(max = 512) { this.items = []; this.max = max; }
  get size() { return this.items.length; }
  /** Schedule `item` (any object) to arrive at tick `due`. The oldest are dropped past `max` entries. */
  add(due, item) {
    const e = { due, item }, a = this.items;
    let i = a.length;
    while (i > 0 && a[i - 1].due > due) i--;
    a.splice(i, 0, e);
    if (a.length > this.max) a.shift();
    return e;
  }
  /** Remove and return (in arrival order) the items due at or before tick `now`. */
  take(now) {
    const a = this.items;
    let n = 0;
    while (n < a.length && a[n].due <= now) n++;
    return n ? a.splice(0, n).map((e) => e.item) : [];
  }
  clear() { this.items.length = 0; }
}

/** Frequency of each kind of vibration (after the reference's grouping: movement low, destruction and death high). */
export const FREQUENCY = Object.freeze({
  step: 1, swim: 1,
  land: 2, projectile: 2, splash: 2,
  shoot: 3,
  drop: 4,
  dismount: 5, equip: 5,
  mount: 6, shear: 6,
  damage: 7,
  eat: 8, drink: 8,
  close: 9, deactivate: 9,
  open: 10, activate: 10, prime: 10,
  change: 11,
  break: 12,
  place: 13,
  teleport: 14, lightning: 14,
  explode: 15, death: 15,
});

/** Frequency (1-15) of a kind of vibration (unknown kinds count as the lowest). */
export function vibrationFrequency(kind) { return FREQUENCY[kind] || 1; }

/** Kinds a guest may report to the host (the rest the host sees for itself). */
export const GUEST_KINDS = new Set(['eat', 'drink', 'drop', 'open', 'close', 'activate', 'deactivate', 'shoot', 'equip']);

/** Hush Sensor meta: power in bits 0-3, the frequency of what it heard in bits 4-7. */
export function sensorMeta(power, freq) { return (Math.max(0, Math.min(15, power | 0))) | (Math.max(0, Math.min(15, freq | 0)) << 4); }
/** Comparator signal of a Hush Sensor: the frequency of the vibration while it pulses, 0 at rest. */
export function sensorFrequency(meta) { return (meta & 15) ? (meta >> 4) & 15 : 0; }

/** Blocks that listen for vibrations (indexed per chunk). */
export const LISTENS = new Uint8Array(BLOCK_LIMIT);
LISTENS[B.HUSH_SENSOR] = 1;
LISTENS[B.CALIBRATED_HUSH_SENSOR] = 1;
LISTENS[B.HUSH_SHRIEKER] = 1;

/** Blocks a vibration cannot pass through (wool, whatever its colour). */
export const OCCLUDES = new Uint8Array(BLOCK_LIMIT);
OCCLUDES[B.WOOL] = 1;

/**
 * Is the straight line from (x0, y0, z0) to (x1, y1, z1) blocked by a vibration-occluding block?
 * The cells holding the two ends do not count (a sensor on wool still hears; a step on wool is
 * already silent). `getBlock(x, y, z)` gives block ids. A voxel walk visits every cell the line crosses.
 */
export function occluded(getBlock, x0, y0, z0, x1, y1, z1) {
  let cx = Math.floor(x0), cy = Math.floor(y0), cz = Math.floor(z0);
  const ex = Math.floor(x1), ey = Math.floor(y1), ez = Math.floor(z1);
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = sx ? Math.abs(1 / dx) : Infinity, tdy = sy ? Math.abs(1 / dy) : Infinity, tdz = sz ? Math.abs(1 / dz) : Infinity;
  let tx = sx ? (sx > 0 ? cx + 1 - x0 : x0 - cx) * tdx : Infinity;
  let ty = sy ? (sy > 0 ? cy + 1 - y0 : y0 - cy) * tdy : Infinity;
  let tz = sz ? (sz > 0 ? cz + 1 - z0 : z0 - cz) * tdz : Infinity;
  for (let guard = 0; guard < 64; guard++) {
    if (tx <= ty && tx <= tz) { if (tx > 1) break; cx += sx; tx += tdx; }
    else if (ty <= tz) { if (ty > 1) break; cy += sy; ty += tdy; }
    else { if (tz > 1) break; cz += sz; tz += tdz; }
    if (cx === ex && cy === ey && cz === ez) break;
    if (OCCLUDES[getBlock(cx, cy, cz)]) return true;
  }
  return false;
}

/**
 * Listening blocks with an id in `ids` within `r` blocks of (x, y, z), nearest first, as
 * { x, y, z, id, d }. Uses the per-chunk listener index when the world has one (World), and
 * otherwise scans the cube around the point (deepHush.findNear; test worlds).
 */
export function findListeners(w, x, y, z, r, ids) {
  if (!w.getChunk) return findNear(w, x, y, z, r, ids);
  const out = [];
  const c0x = Math.floor(x - r) >> 4, c1x = Math.floor(x + r) >> 4, c0z = Math.floor(z - r) >> 4, c1z = Math.floor(z + r) >> 4;
  for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
    const c = w.getChunk(cx, cz);
    if (!c || !c.listeners || !c.listeners.size) continue;
    for (const i of c.listeners) {
      const id = c.blocks[i];
      if (!ids.has(id)) continue;
      const bx = cx * 16 + (i & 15), by = MIN_Y + (i >> 8), bz = cz * 16 + ((i >> 4) & 15);
      const d = Math.hypot(bx + 0.5 - x, by + 0.5 - y, bz + 0.5 - z);
      if (d <= r) out.push({ x: bx, y: by, z: bz, id, d });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}
