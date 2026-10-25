// Hoppers: five slots and a spout. Every 8 ticks a hopper that is not
// powered passes one item out through its spout into the container it points
// at, then takes one item from the container above it (or picks up an item
// lying in its bowl). Furnaces take items from above into the input and from
// the side into the fuel slot and give up their output; Brewing Alembics take
// ingredients from above and vials or Ember Powder from the side. Dispensers
// and Droppers fill and empty like chests.
// Meta: 0 = spout down, 1-4 = spout towards SIDE_DIRS[meta - 1].
import { B, isFurnace } from './blocks.js';
import { ITEMS, I, maxStack } from './items.js';
import { SIDE_DIRS } from './shapes.js';
import { canStack } from './enchantments.js';
import { isIngredient, isVial, VIAL_SLOTS, INGREDIENT_SLOT, FUEL_SLOT } from './brewing.js';

export const HOPPER_SLOTS = 5;
export const HOPPER_COOLDOWN = 8;
export const spoutDir = (meta) => ((meta & 7) === 0 ? [0, -1, 0] : [SIDE_DIRS[(meta & 7) - 1][0], 0, SIDE_DIRS[(meta & 7) - 1][2]]);
export const newHopper = (x, y, z) => ({ x, y, z, slots: new Array(HOPPER_SLOTS).fill(null), cooldown: 0 });

/** Meta for a hopper placed against `face` (the clicked face's normal): the spout points into that block. */
export function hopperPlaceMeta(face) {
  if (!face || face[1] !== 0) return 0;
  const i = SIDE_DIRS.findIndex(([dx, , dz]) => dx === -face[0] && dz === -face[2]);
  return i < 0 ? 0 : i + 1;
}

/** Slot accessors of a container: [{ get, set, accepts }] for putting in from `fromAbove` (or the side), and for taking out. */
const arraySlot = (arr, i, accepts = () => true) => ({ get: () => arr[i], set: (v) => { arr[i] = v; }, accepts });
const keySlot = (obj, k, accepts = () => true) => ({ get: () => obj[k], set: (v) => { obj[k] = v; }, accepts });

/**
 * The accessible slots of the container at x,y,z, or null. `game` provides
 * getChest / getHopper / getFurnace / getBrewingStand and the world.
 */
export function containerAccess(game, x, y, z) {
  const id = game.world.getBlock(x, y, z);
  if (id === B.CHEST || id === B.BARREL || id === B.GLOOMSHELL_BOX || id === B.HOPPER) {
    const c = id === B.HOPPER ? game.getHopper(x, y, z) : game.getChest(x, y, z);
    const all = c.slots.map((_, i) => arraySlot(c.slots, i, id === B.GLOOMSHELL_BOX ? (st) => st.id !== B.GLOOMSHELL_BOX : undefined));
    return { insert: () => all, extract: all };
  }
  if ((id === B.DISPENSER || id === B.DROPPER) && game.getDispenser) {
    const all = game.getDispenser(x, y, z).slots.map((_, i, arr) => arraySlot(arr, i));
    return { insert: () => all, extract: all };
  }
  if (isFurnace(id)) {
    const f = game.getFurnace(x, y, z);
    const input = keySlot(f, 'input'), fuel = keySlot(f, 'fuel', (st) => !!(ITEMS[st.id] && ITEMS[st.id].fuel));
    return { insert: (fromAbove) => [fromAbove ? input : fuel], extract: [keySlot(f, 'output')] };
  }
  if (id === B.BREWING_STAND && game.getBrewingStand) {
    const s = game.getBrewingStand(x, y, z);
    const ing = arraySlot(s.slots, INGREDIENT_SLOT, (st) => isIngredient(st.id));
    const vials = VIAL_SLOTS.map((i) => arraySlot(s.slots, i, (st) => isVial(st.id)));
    const fuel = arraySlot(s.slots, FUEL_SLOT, (st) => st.id === I.EMBER_POWDER);
    return { insert: (fromAbove) => (fromAbove ? [ing] : [fuel, ...vials]), extract: vials };
  }
  return null;
}

/** Put one item of `st` into the first slot that takes it; true if it went in. */
export function insertOne(slots, st) {
  for (const s of slots) {
    const cur = s.get();
    if (cur && canStack(cur, st) && cur.count < maxStack(cur.id) && s.accepts(st)) { cur.count++; s.set(cur); return true; }
  }
  for (const s of slots) if (!s.get() && s.accepts(st)) { s.set({ ...st, count: 1 }); return true; }
  return false;
}

/** Move one item from `from` slots into `to` slots (first item that fits); true if something moved. */
export function moveOne(from, to) {
  for (const s of from) {
    const st = s.get();
    if (!st || st.count <= 0) continue;
    if (!insertOne(to, st)) continue;
    if (st.count <= 1) s.set(null); else { st.count--; s.set(st); }
    return true;
  }
  return false;
}

/** One hopper step: push through the spout, then pull from above. Returns true if anything moved. */
export function hopperStep(game, h, powered, items = []) {
  if (powered) return false;
  const w = game.world, meta = w.getMeta(h.x, h.y, h.z);
  const own = h.slots.map((_, i) => arraySlot(h.slots, i));
  let moved = false;
  const [dx, dy, dz] = spoutDir(meta);
  const target = containerAccess(game, h.x + dx, h.y + dy, h.z + dz);
  if (target && moveOne(own, target.insert(dy < 0))) moved = true;
  const above = containerAccess(game, h.x, h.y + 1, h.z);
  if (above) { if (moveOne(above.extract, own)) moved = true; }
  else {
    // pick up an item lying in the bowl
    for (const e of items) {
      if (e.dead || !e.stack || e.stack.count <= 0) continue;
      if (e.x < h.x || e.x >= h.x + 1 || e.z < h.z || e.z >= h.z + 1 || e.y < h.y + 0.5 || e.y > h.y + 1.8) continue;
      if (insertOne(own, e.stack)) { e.stack.count--; if (e.stack.count <= 0) e.dead = true; moved = true; break; }
    }
  }
  return moved;
}
