// Wyrm Ribs: the bleached ribcage of some long-dead Void Wyrm, half sunk in the grass of an outer island
// of the Hollow. A row of Wyrmbone vertebrae runs along the ground to a Wyrm Head skull; five pairs of
// arched ribs (the middle ones tallest) rise over it, and a chest lies in the shelter of the spine.
// About two in five outer islands of radius 12 or more that carry no city have one. Planned from the
// seed and the island alone (like the cities) and stamped chunk by chunk through the island's Plan.
import { B } from '../blocks.js';
import { mulberry32, hash4 } from '../noise.js';
import { lootChestMeta, LOOT_CITY } from './hollowCity.js';

export const RIBS_CHANCE = 0.4, RIBS_MIN_RADIUS = 12;
export const RIB_SPAN = [3, 5, 6, 5, 3];      // half width of each rib pair
export const RIB_HEIGHT = [3, 5, 6, 5, 3];    // how high each pair arches
export const RIB_U = [-8, -4, 0, 4, 8];       // where along the spine the pairs stand
export const RIBS_LOOT = LOOT_CITY;           // chest kind (mobs/spawnerBlocks.js reuses the Hollow City table)

/**
 * Plan the ribs of outer island `o` (cell ci, cj) into the Plan `P`, or return null when it has none.
 * `ground(x, z)` gives the island's top block or null over the void. Returns { cx, cz, y, axis, x0, z0, x1, z1 }.
 */
export function planRibs(seed, ci, cj, o, ground, P) {
  if (o.r < RIBS_MIN_RADIUS) return null;
  const rng = mulberry32(hash4(seed, ci, cj, 7077));
  if (rng() >= RIBS_CHANCE) return null;
  const axis = rng() < 0.5 ? 'x' : 'z', flip = rng() < 0.5 ? 1 : -1;
  const cx = Math.round(o.x), cz = Math.round(o.z);
  // (u along the spine, v across it) -> world
  const at = (u, v) => (axis === 'x' ? [cx + u * flip, cz + v] : [cx + v, cz + u * flip]);
  const g0 = ground(cx, cz);
  if (g0 === null) return null;
  // clear what grew there (Hushvine), then lay the spine, the skull and the ribs
  for (let u = -10; u <= 12; u++) for (let v = -7; v <= 7; v++) {
    const [x, z] = at(u, v), g = ground(x, z);
    if (g === null) continue;
    for (let y = g + 1; y <= g + 9; y++) P.set(x, y, z, B.AIR);
  }
  const bone = (u, v, y) => { const [x, z] = at(u, v); if (ground(x, z) !== null) P.set(x, y, z, B.WYRMBONE); };
  for (let u = -10; u <= 10; u++) {
    const [x, z] = at(u, 0), g = ground(x, z);
    if (g !== null) P.set(x, g + 1, z, B.WYRMBONE);
  }
  { // the skull at the head end, looking along the spine
    const [x, z] = at(12, 0), g = ground(x, z);
    if (g !== null) P.set(x, g + 1, z, B.WYRM_HEAD, axis === 'x' ? (flip > 0 ? 1 : 3) : (flip > 0 ? 2 : 0));
  }
  RIB_U.forEach((u, k) => {
    const R = RIB_SPAN[k], H = RIB_HEIGHT[k], [px, pz] = at(u, 0), g = ground(px, pz) ?? g0;
    for (let a = 0; a <= 16; a++) {
      const th = a / 16 * Math.PI / 2, v = Math.round(R * Math.cos(th)), dy = 1 + Math.round(H * Math.sin(th));
      const [lx, lz] = at(u, v), gl = ground(lx, lz);
      const [rx, rz] = at(u, -v), gr = ground(rx, rz);
      if (gl !== null) P.set(lx, (gl ?? g) + dy, lz, B.WYRMBONE);
      if (gr !== null) P.set(rx, (gr ?? g) + dy, rz, B.WYRMBONE);
    }
  });
  // the chest in the shelter of the spine
  const [chx, chz] = at(-2, 1), gc = ground(chx, chz);
  if (gc !== null) P.set(chx, gc + 1, chz, B.CHEST, lootChestMeta(RIBS_LOOT, 0));
  const [ax, az] = at(-10, -7), [bx, bz] = at(12, 7);
  return { cx, cz, y: g0, axis, x0: Math.min(ax, bx) - 1, z0: Math.min(az, bz) - 1, x1: Math.max(ax, bx) + 1, z1: Math.max(az, bz) + 1 };
}

const CELL = 112;
/** Every ribcage of the Hollow whose box meets the rectangle: [{ cx, cz, y, ... }]. */
export function wyrmRibsNear(gen, x0, z0, x1, z1) {
  const out = [];
  if (!gen || !gen.islandPlan) return out;
  for (let ci = Math.floor((x0 - 40) / CELL); ci <= Math.floor((x1 + 40) / CELL); ci++) for (let cj = Math.floor((z0 - 40) / CELL); cj <= Math.floor((z1 + 40) / CELL); cj++) {
    const p = gen.outerIsland(ci, cj) && gen.islandPlan(ci, cj), r = p && p.ribs;
    if (r && r.x1 >= x0 && r.x0 <= x1 && r.z1 >= z0 && r.z0 <= z1) out.push(r);
  }
  return out;
}

/** The nearest ribcage to (x, z), searching rings of 112-block cells outwards (one ring past the first find). */
export function nearestWyrmRibs(gen, x, z, rings = 12) {
  if (!gen || !gen.islandPlan) return null;
  const ci0 = Math.floor(x / CELL), cj0 = Math.floor(z / CELL);
  let best = null, bd = Infinity, stop = rings;
  for (let r = 0; r <= stop; r++) {
    for (let i = ci0 - r; i <= ci0 + r; i++) for (let j = cj0 - r; j <= cj0 + r; j++) {
      if (Math.max(Math.abs(i - ci0), Math.abs(j - cj0)) !== r) continue;
      const p = gen.outerIsland(i, j) && gen.islandPlan(i, j), s = p && p.ribs;
      if (s && Math.hypot(s.cx - x, s.cz - z) < bd) { bd = Math.hypot(s.cx - x, s.cz - z); best = s; stop = Math.min(stop, r + 1); }
    }
  }
  return best;
}
