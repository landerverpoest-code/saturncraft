// Dispensers and Droppers: nine slots and a face. On a rising edge of
// cinnabar power (world/circuits.js) they fire once, after a short delay:
// a random filled slot gives up one item. A Dropper drops it out of its face
// (or puts it into a container in front); a Dispenser uses it when it can:
// arrows fly, fire charges shoot a small fireball, buckets pour or scoop up
// fluid, flint and steel lights fires and TNT, TNT goes out primed, bone meal
// makes plants grow and armour goes onto a player standing in front. Anything
// else is dropped like a Dropper does.
// Meta: bits 0-2 = facing (FACING6 index: down, up, -z, +z, -x, +x), bit 3 = triggered.
import { B, BLOCKS, isFluid } from './blocks.js';
import { ITEMS, I, isArrow } from './items.js';
import { FACING6, SIDE_TO_FACING, DISPENSER_TRIGGERED } from './circuitShapes.js';
import { canLight, FIRE_DELAY } from './fire.js';
import { containerAccess, insertOne } from './hoppers.js';

export const DISPENSER_SLOTS = 9;
export const TRIGGERED = DISPENSER_TRIGGERED;
export { DISPENSE_DELAY } from './circuits.js';
export const isDispenser = (id) => id === B.DISPENSER || id === B.DROPPER;
export const newDispenser = (x, y, z) => ({ x, y, z, slots: new Array(DISPENSER_SLOTS).fill(null) });
export const facingDir = (meta) => FACING6[meta & 7] || FACING6[2];

/** Meta for a dispenser placed by a player looking along `look`: the face points back at the player (up or down when looking steeply). */
export function dispenserPlaceMeta(look) {
  const [lx, ly, lz] = look;
  if (Math.abs(ly) > 0.75) return ly < 0 ? 1 : 0;
  const sideLook = Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? 1 : 3) : (lz > 0 ? 2 : 0);
  return SIDE_TO_FACING[(sideLook + 2) & 3];
}

/** Index of a random filled slot (each filled slot equally likely), or -1 when empty. */
export function pickSlot(slots, rng = Math.random) {
  const filled = [];
  for (let i = 0; i < slots.length; i++) if (slots[i] && slots[i].count > 0) filled.push(i);
  return filled.length ? filled[Math.floor(rng() * filled.length) % filled.length] : -1;
}

function takeOne(slots, i) {
  const st = slots[i];
  if (st.count <= 1) slots[i] = null; else slots[i] = { ...st, count: st.count - 1 };
}

/** Put a stack into the first free slot of the dispenser; false when there is no room. */
function stash(slots, st) {
  for (let i = 0; i < slots.length; i++) if (!slots[i]) { slots[i] = st; return true; }
  return false;
}

/** Throw one item of `st` out of the face of the block at x,y,z facing `dir`. */
export function ejectItem(game, x, y, z, dir, st, rng = Math.random) {
  const [dx, dy, dz] = dir;
  const sp = 0.1 + rng() * 0.1, j = () => (rng() - 0.5) * 0.04;
  const ex = x + 0.5 + dx * 0.7, ey = y + 0.5 + dy * 0.7 - (dy ? 0.125 : 0.15), ez = z + 0.5 + dz * 0.7;
  game.entities.spawnItem(ex, ey, ez, { ...st, count: 1 }, [dx * sp + j(), dy ? dy * sp : 0.2 + j(), dz * sp + j()]);
}

/** Is the player standing in the block at x,y,z? */
function playerIn(p, x, y, z) {
  if (!p || p.dead) return false;
  const hw = 0.3, h = (p.body && p.body.height) || 1.8;
  return p.x + hw > x && p.x - hw < x + 1 && p.z + hw > z && p.z - hw < z + 1 && p.y + h > y && p.y < y + 1;
}

/**
 * Fire the dispenser or dropper at x,y,z once. `game` provides the world,
 * getDispenser, entities (spawnItem / spawnArrow), the player, interaction
 * (boneMeal), primeTNT and shootFireball. Returns what happened: 'empty',
 * 'drop', 'insert', 'arrow', 'fireball', 'pour', 'scoop', 'ignite', 'tnt',
 * 'grow', 'equip' or 'fail'.
 */
export function dispense(game, x, y, z, rng = Math.random) {
  const w = game.world, id = w.getBlock(x, y, z);
  if (!isDispenser(id)) return 'fail';
  const d = game.getDispenser(x, y, z), slots = d.slots;
  const i = pickSlot(slots, rng);
  const sound = (s) => { if (game.audio) game.audio.play(s, [x + 0.5, y + 0.5, z + 0.5]); };
  if (i < 0) { sound('click'); return 'empty'; }
  const st = slots[i], dir = facingDir(w.getMeta(x, y, z)), [dx, dy, dz] = dir;
  const fx = x + dx, fy = y + dy, fz = z + dz, front = w.getBlock(fx, fy, fz);
  const drop = () => { ejectItem(game, x, y, z, dir, st, rng); takeOne(slots, i); sound('pop'); return 'drop'; };

  if (id === B.DROPPER) {
    // into a container in front, else out onto the ground
    const target = containerAccess(game, fx, fy, fz);
    if (target) {
      if (!insertOne(target.insert(dy < 0), st)) { sound('click'); return 'fail'; }
      takeOne(slots, i); sound('pop');
      return 'insert';
    }
    return drop();
  }

  const def = ITEMS[st.id] || {};
  const ox = x + 0.5 + dx * 0.7, oy = y + 0.5 + dy * 0.7, oz = z + 0.5 + dz * 0.7;
  const free = !front || (BLOCKS[front] && BLOCKS[front].replaceable);
  if (isArrow(st.id)) {
    const sp = 1.1, j = () => (rng() - 0.5) * 0.06;
    game.entities.spawnArrow(ox, oy, oz, dx * sp + j(), dy * sp + 0.1 + j(), dz * sp + j(), null, false, null, 0, 0, st.id !== I.ARROW ? { id: st.id, count: 1 } : null);
    takeOne(slots, i); sound('bow');
    return 'arrow';
  }
  if (st.id === I.FIRE_CHARGE) {
    if (!game.shootFireball) return drop();
    const j = () => (rng() - 0.5) * 0.1;
    game.shootFireball(ox, oy, oz, dx * 0.6 + j(), dy * 0.6 + j(), dz * 0.6 + j());
    takeOne(slots, i); sound('fizz');
    return 'fireball';
  }
  if (st.id === I.WATER_BUCKET || st.id === I.LAVA_BUCKET) {
    const fluid = st.id === I.WATER_BUCKET ? B.WATER : B.LAVA;
    const flowing = isFluid(front) && w.getMeta(fx, fy, fz) !== 0;
    if (!(free || flowing) || (isFluid(front) && !flowing)) return drop();
    if (!(fluid === B.WATER && w.dimension === 'cinderdeep')) { // water boils away in the Cinderdeep
      w.setBlock(fx, fy, fz, fluid, 0);
      w.scheduleTick(fx, fy, fz, 5);
    } else sound('fizz');
    slots[i] = { id: I.BUCKET, count: 1, damage: 0 };
    sound('splash');
    return 'pour';
  }
  if (st.id === I.BUCKET) {
    if (!isFluid(front) || w.getMeta(fx, fy, fz) !== 0) return drop();
    const full = { id: front === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET, count: 1, damage: 0 };
    w.setBlock(fx, fy, fz, B.AIR);
    if (st.count <= 1) slots[i] = full;
    else { takeOne(slots, i); if (!stash(slots, full)) ejectItem(game, x, y, z, dir, full, rng); }
    sound('bucket_fill');
    return 'scoop';
  }
  if (def.igniter) {
    if (front === B.TNT && w.onTNT) w.onTNT(fx, fy, fz);
    else if (canLight(w, fx, fy, fz)) { w.setBlock(fx, fy, fz, B.FIRE, 0); w.scheduleTick(fx, fy, fz, FIRE_DELAY + Math.floor(rng() * 10)); }
    else { sound('click'); return 'fail'; }
    if (def.durability) {
      const dmg = (st.damage || 0) + 1;
      slots[i] = dmg >= def.durability ? null : { ...st, damage: dmg };
    } else takeOne(slots, i);
    sound('ignite');
    return 'ignite';
  }
  if (st.id === B.TNT) {
    if (!game.primeTNT) return drop();
    game.primeTNT(fx + 0.5, fy, fz + 0.5);
    takeOne(slots, i);
    return 'tnt';
  }
  if (def.boneMeal) {
    if (!front || !game.interaction || !game.interaction.boneMeal({ x: fx, y: fy, z: fz, id: front, face: [-dx, -dy, -dz] })) { sound('click'); return 'fail'; }
    takeOne(slots, i);
    return 'grow';
  }
  if (def.armor) {
    const p = game.player, inv = p && p.inventory, slot = def.armor.slot;
    if (inv && inv.armor && !inv.armor[slot] && playerIn(p, fx, fy, fz)) {
      inv.armor[slot] = { ...st, count: 1 };
      takeOne(slots, i);
      if (inv.changed) inv.changed();
      sound('equip');
      return 'equip';
    }
  }
  return drop();
}
