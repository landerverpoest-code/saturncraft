// Signal maths of the Comparator and the Daylight Sensor (the simulation lives
// in world/circuits.js; this module holds the pure rules and reads containers).
//
// * Comparator: rear = the power behind it, or the fullness of a container
//   behind it (also through one solid block); side = the strongest of the two
//   sides (wire, repeaters, comparators and cinnabar blocks only). Compare mode
//   passes the rear on while it is at least the side; subtract mode outputs
//   rear - side.
// * Container fullness (reference formula): 0 when empty, otherwise
//   floor(1 + 14 * (sum of count / max stack) / slots).
// * Other blocks a comparator reads: a composter (its level), a jukebox (the
//   disc), a cake (2 x the slices left), a lectern (the open page, world/books.js),
//   an item frame (1 + the item's rotation; world/signalBlocks.js) and a pulsing
//   Hush Sensor (the frequency of the vibration it heard; world/vibrations.js).
// * Daylight Sensor: sky light at the sensor times the brightness of the three
//   suns (sky/suns.js skyState().combined); inverted mode gives 15 minus that.
import { B, isFurnace, isBox } from './blocks.js';
import { maxStack } from './items.js';
import { doubleChestHalves } from './chests.js';
import { lecternSignal } from './books.js';
import { cakeSignal, frameSignal } from './signalBlocks.js';
import { sensorFrequency } from './vibrations.js';

/** Comparator output for a rear and side level (subtract = subtract mode). */
export function comparatorOutput(rear, side, subtract) {
  if (subtract) return Math.max(0, rear - side);
  return rear >= side ? rear : 0;
}

/** Fullness signal (0-15) of a list of slots (nulls or { id, count }). */
export function fullness(slots, n = slots.length) {
  if (!n) return 0;
  let sum = 0, any = false;
  for (const st of slots) {
    if (!st || !st.count) continue;
    any = true;
    sum += st.count / maxStack(st.id);
  }
  return any ? Math.floor(1 + (sum / n) * 14) : 0;
}

/** Daylight Sensor level from raw sky light (0-15) and sun brightness (0-1). */
export function daylightLevel(sky, brightness, inverted = false) {
  const b = brightness < 0 ? 0 : brightness > 1 ? 1 : brightness;
  const l = Math.max(0, Math.min(15, Math.round(sky * b)));
  return inverted ? 15 - l : l;
}

/** Blocks a comparator reads as a container. */
export function isReadable(id) {
  return id === B.CHEST || id === B.BARREL || isBox(id) || id === B.HOPPER || id === B.DISPENSER || id === B.DROPPER
    || id === B.BREWING_STAND || id === B.COMPOSTER || id === B.JUKEBOX || isFurnace(id)
    || id === B.CAKE || id === B.LECTERN || id === B.ITEM_FRAME || id === B.HUSH_SENSOR || id === B.CALIBRATED_HUSH_SENSOR;
}

// look the state up without creating it (getChest would roll a dungeon chest's loot)
const peek = (map, getter, x, y, z) => (map ? map.get(`${x},${y},${z}`) : getter ? getter(x, y, z) : null);

/**
 * Signal the container at x,y,z gives a comparator, or -1 when it is not one.
 * `game` holds the container maps (chests, hoppers, dispensers, furnaces, brewingStands).
 */
export function containerSignal(game, x, y, z) {
  const w = game.world, id = w.getBlock(x, y, z);
  if (!isReadable(id)) return -1;
  if (id === B.COMPOSTER) return Math.min(8, w.getMeta(x, y, z) & 15);
  if (id === B.JUKEBOX) return Math.min(15, w.getMeta(x, y, z)); // meta = 1 + the disc's index while one plays
  if (id === B.CAKE) return cakeSignal(w.getMeta(x, y, z) & 7);
  if (id === B.HUSH_SENSOR || id === B.CALIBRATED_HUSH_SENSOR) return sensorFrequency(w.getMeta(x, y, z));
  if (id === B.LECTERN) { const l = game.lecterns && game.lecterns.get(`${x},${y},${z}`); return l ? lecternSignal(l.book, l.page) : 0; }
  if (id === B.ITEM_FRAME) return frameSignal(w.getMeta(x, y, z), !!(game.frames && game.frames.get(`${x},${y},${z}`)));
  const chestAt = (a, b, c) => peek(game.chests, game.getChest && ((p, q, r) => game.getChest(p, q, r)), a, b, c);
  if (id === B.CHEST) {
    const halves = doubleChestHalves(w, x, y, z);
    if (halves) {
      const slots = [];
      for (const h of halves) { const c = chestAt(h.x, h.y, h.z); slots.push(...(c ? c.slots : new Array(27).fill(null))); }
      return fullness(slots, 54);
    }
  }
  if (id === B.CHEST || id === B.BARREL || isBox(id)) { const c = chestAt(x, y, z); return c ? fullness(c.slots, 27) : 0; }
  if (id === B.HOPPER) { const h = peek(game.hoppers, game.getHopper && ((a, b, c) => game.getHopper(a, b, c)), x, y, z); return h ? fullness(h.slots) : 0; }
  if (id === B.DISPENSER || id === B.DROPPER) { const d = peek(game.dispensers, game.getDispenser && ((a, b, c) => game.getDispenser(a, b, c)), x, y, z); return d ? fullness(d.slots) : 0; }
  if (id === B.BREWING_STAND) { const s = peek(game.brewingStands, null, x, y, z); return s ? fullness(s.slots) : 0; }
  const f = peek(game.furnaces, null, x, y, z);
  return f ? fullness([f.input, f.fuel, f.output], 3) : 0;
}
