// Double chests: two chests side by side facing the same way join into one
// 54-slot chest. The pairing lives in the meta byte next to the facing (bits
// 0-1), the unrolled-loot flag (bit 3) and the loot kind (bits 4-6):
// bit 2 = paired, bit 7 = the partner sits on the + side of the chest's axis.
import { B } from './blocks.js';

export const PAIRED = 4, PARTNER_PLUS = 128;
/** Meta bits that survive rolling a chest's loot. */
export const KEEP_BITS = 3 | PAIRED | PARTNER_PLUS;

/** The axis chests pair along: across the front (x for chests facing ±z, z for ±x). */
export const chestAxis = (face) => (face & 1 ? [0, 1] : [1, 0]);

/** Position of a paired chest's other half, or null. */
export function chestPartner(world, x, y, z, meta = world.getMeta(x, y, z)) {
  if (!(meta & PAIRED)) return null;
  const [ax, az] = chestAxis(meta & 3), s = meta & PARTNER_PLUS ? 1 : -1;
  const nx = x + ax * s, nz = z + az * s;
  if (world.getBlock(nx, y, nz) !== B.CHEST) return null;
  const nm = world.getMeta(nx, y, nz);
  if (!(nm & PAIRED) || (nm & 3) !== (meta & 3) || !!(nm & PARTNER_PLUS) === !!(meta & PARTNER_PLUS)) return null;
  return { x: nx, y, z: nz };
}

/**
 * Placing a chest facing `face` at x,y,z: join a lone neighbour chest that faces
 * the same way (not when sneaking). Returns the new chest's meta and the
 * neighbour's new meta (or null).
 */
export function pairOnPlace(world, x, y, z, face, sneaking = false) {
  if (!sneaking) {
    const [ax, az] = chestAxis(face);
    for (const s of [-1, 1]) {
      const nx = x + ax * s, nz = z + az * s;
      if (world.getBlock(nx, y, nz) !== B.CHEST) continue;
      const nm = world.getMeta(nx, y, nz);
      if ((nm & 3) !== face || (nm & PAIRED)) continue;
      return {
        meta: face | PAIRED | (s > 0 ? PARTNER_PLUS : 0),
        neighbour: { x: nx, y, z: nz, meta: (nm & ~PARTNER_PLUS) | PAIRED | (s > 0 ? 0 : PARTNER_PLUS) },
      };
    }
  }
  return { meta: face, neighbour: null };
}

/** After a paired chest at x,y,z (with `meta`) is gone: the other half's new meta, or null. */
export function unpairAfterBreak(world, x, y, z, meta) {
  if (!(meta & PAIRED)) return null;
  const [ax, az] = chestAxis(meta & 3), s = meta & PARTNER_PLUS ? 1 : -1;
  const nx = x + ax * s, nz = z + az * s;
  if (world.getBlock(nx, y, nz) !== B.CHEST) return null;
  const nm = world.getMeta(nx, y, nz);
  if (!(nm & PAIRED)) return null;
  return { x: nx, y, z: nz, meta: nm & ~(PAIRED | PARTNER_PLUS) };
}

/** The half shown first (top rows): the one on the − side of the axis. */
export function doubleChestHalves(world, x, y, z) {
  const meta = world.getMeta(x, y, z), p = chestPartner(world, x, y, z, meta);
  if (!p) return null;
  const here = { x, y, z };
  return meta & PARTNER_PLUS ? [here, p] : [p, here];
}

/** A live 54-slot view over two 27-slot chests (reads and writes go to the halves). */
export function doubleChestView(a, b) {
  const target = new Array(54);
  const idx = (k) => (typeof k === 'string' && /^\d+$/.test(k) ? +k : -1);
  const slots = new Proxy(target, {
    get(t, k) {
      if (k === 'length') return 54;
      const i = idx(k);
      if (i >= 0) return i < 27 ? a.slots[i] : i < 54 ? b.slots[i - 27] : undefined;
      return Reflect.get(t, k);
    },
    has(t, k) { const i = idx(k); return i >= 0 ? i < 54 : Reflect.has(t, k); },
    set(t, k, v) {
      const i = idx(k);
      if (i >= 0 && i < 27) a.slots[i] = v; else if (i >= 27 && i < 54) b.slots[i - 27] = v;
      return true;
    },
  });
  return { x: a.x, y: a.y, z: a.z, double: true, halves: [a, b], slots };
}
