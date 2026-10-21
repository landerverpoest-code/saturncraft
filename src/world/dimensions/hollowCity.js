// Hollow Cities (reference: the void-island cities) on the Hollow's outer islands, and
// their loot. A city is planned from the seed and its island alone, so every
// chunk stamps its own share (like villages and sanctums):
//   * a Hollowbrick house on a Hollowstone-brick footing (door towards -z),
//   * a tower rising 12-19 blocks out of its roof, crowned with a wide top
//     room holding two loot chests, Wisp Rods on the roof corners,
//   * often (70 %) a railed bridge from the roof to a second, slimmer tower
//     with its own top room and chest,
//   * sometimes (50 %) a floating ship moored at roof height (a walkway leads
//     to it) with a purple sail, a Wyrm Head on the bow and two chests in the
//     hold, one of them always holding a Voidwing.
// Ladders run up through the towers. Gloomshells haunt the city (natural
// spawning inside its bounds, see mobs/gloomshell.js).
import { B } from '../blocks.js';
import { I, ITEMS } from '../items.js';
import { COLOR } from '../colors.js';
import { mulberry32, hash4 } from '../noise.js';
import { selectEnchantments } from '../enchantments.js';

// Chest loot kinds (chest meta bits 4-7; see mobs/spawnerBlocks.js LOOT)
export const LOOT_CITY = 13, LOOT_SHIP = 14;
export const lootChestMeta = (kind, facing = 0) => (facing & 3) | 8 | (kind << 4);

/** A block plan bucketed by chunk: "cx,cz" -> flat [x, y, z, id, meta, ...] (world coordinates). */
export class Plan {
  constructor() { this.chunks = new Map(); this.cells = new Map(); }
  set(x, y, z, id, meta = 0) {
    if (y < 1 || y > 254) return;
    const k = `${x},${y},${z}`;
    this.cells.set(k, [x, y, z, id, meta]);
  }
  get(x, y, z) { const c = this.cells.get(`${x},${y},${z}`); return c ? c[3] : null; }
  box(x0, y0, z0, x1, y1, z1, id, meta = 0) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.set(x, y, z, id, meta);
  }
  /** Freeze the cells into per-chunk lists (call once when done). */
  finish() {
    for (const c of this.cells.values()) {
      const k = `${c[0] >> 4},${c[2] >> 4}`;
      let a = this.chunks.get(k);
      if (!a) this.chunks.set(k, (a = []));
      a.push(...c);
    }
    this.cells = null;
    return this;
  }
  /** Stamp the part inside chunk (cx, cz). */
  stamp(blocks, meta, cx, cz, cidx) {
    const a = this.chunks.get(`${cx},${cz}`);
    if (!a) return;
    for (let i = 0; i < a.length; i += 5) {
      const j = cidx(a[i] - cx * 16, a[i + 1], a[i + 2] - cz * 16);
      blocks[j] = a[i + 3]; meta[j] = a[i + 4];
    }
  }
}

/**
 * A room: Hollowbrick walls with pillar corners around (cx, cz), floor at y - 1,
 * `h` blocks of air inside, a flat roof at y + h. `door` is a side (0 -z, 1 +x,
 * 2 +z, 3 -x) or -1; `windows` cuts holes in the other walls.
 */
function room(P, cx, y, cz, half, h, { door = -1, windows = false } = {}) {
  for (let x = cx - half; x <= cx + half; x++) for (let z = cz - half; z <= cz + half; z++) {
    const ex = x === cx - half || x === cx + half, ez = z === cz - half || z === cz + half;
    P.set(x, y - 1, z, B.HOLLOWBRICK);
    P.set(x, y + h, z, B.HOLLOWBRICK);
    for (let yy = y; yy < y + h; yy++) {
      if (ex && ez) P.set(x, yy, z, B.HOLLOWBRICK_PILLAR);
      else if (ex || ez) P.set(x, yy, z, B.HOLLOWBRICK);
      else P.set(x, yy, z, B.AIR);
    }
  }
  const sides = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  sides.forEach(([dx, dz], s) => {
    const wx = cx + dx * half, wz = cz + dz * half;
    if (s === door) for (let o = -1; o <= 1; o++) for (let yy = y; yy < y + 3; yy++) P.set(wx + (dz ? o : 0), yy, wz + (dx ? o : 0), B.AIR);
    else if (windows && half >= 3) for (const o of [-2, 2]) for (let yy = y + 1; yy < y + 3; yy++) P.set(wx + (dz ? o : 0), yy, wz + (dx ? o : 0), B.AIR);
  });
}

/** Foundation: fill (x, z) from y downwards to the ground (or 6 blocks over the void). */
function footing(P, groundAt, x0, z0, x1, z1, y) {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const g = groundAt(x, z);
    const stop = g === null ? y - 6 : g + 1;
    for (let yy = y; yy >= stop; yy--) P.set(x, yy, z, B.HOLLOWSTONE_BRICKS);
  }
}

/** A ladder column at (x, z) from y0 to y1 leaning on the wall towards side s. */
function ladder(P, x, y0, y1, z, s) { for (let y = y0; y <= y1; y++) P.set(x, y, z, B.LADDER, s); }

/**
 * Plan a city on outer island `o` ({x, z, y, r}). `groundAt(x, z)` gives the
 * island's top block at a column or null over the void. Returns
 * { plan, x, y, z, bounds, ship } (deterministic for a seed and island).
 */
export function planCity(seed, o, groundAt) {
  const rng = mulberry32(hash4(seed, Math.floor(o.x), Math.floor(o.z), 6262));
  const P = new Plan();
  const ox = Math.floor(o.x), oz = Math.floor(o.z);
  const gy = (groundAt(ox, oz) ?? Math.floor(o.y + 2)) + 1; // the house floor stands on the ground
  const city = { x: ox, y: gy, z: oz, ship: null, towers: [] };
  // 1. the house: 11 x 11, 6 high, door to -z
  footing(P, groundAt, ox - 5, oz - 5, ox + 5, oz + 5, gy - 2);
  room(P, ox, gy, oz, 5, 6, { door: 0, windows: true });
  P.box(ox + 3, gy, oz, ox + 3, gy + 5, oz, B.HOLLOWBRICK_PILLAR); // the ladder's pillar
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) P.set(ox + dx, gy, oz + dz, B.WISP_ROD);
  // 2. the main tower out of the roof (7 x 7) with a door onto the roof at -x
  const H = 12 + Math.floor(rng() * 8);
  const ty = gy + 7 + H; // top room floor at ty - 1
  for (let y = gy + 7; y <= ty - 2; y++) for (let x = ox - 3; x <= ox + 3; x++) for (let z = oz - 3; z <= oz + 3; z++) {
    const ex = x === ox - 3 || x === ox + 3, ez = z === oz - 3 || z === oz + 3;
    const win = (y - gy) % 5 === 2 && ez && x === ox; // windows in the -z / +z walls
    P.set(x, y, z, ex && ez ? B.HOLLOWBRICK_PILLAR : (ex || ez) && !win ? B.HOLLOWBRICK : B.AIR);
  }
  for (let y = gy + 7; y < gy + 10; y++) P.set(ox - 3, y, oz, B.AIR); // out onto the roof
  // 3. the top room (11 x 11) with two loot chests
  room(P, ox, ty, oz, 5, 5, { windows: true });
  P.set(ox - 4, ty, oz - 4, B.CHEST, lootChestMeta(LOOT_CITY, 2));
  P.set(ox - 4, ty, oz + 4, B.CHEST, lootChestMeta(LOOT_CITY, 0));
  P.set(ox + 4, ty, oz - 4, B.WISP_ROD); P.set(ox + 4, ty, oz + 4, B.WISP_ROD);
  for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) { P.set(ox + dx, ty + 6, oz + dz, B.WISP_ROD); }
  for (let k = -4; k <= 4; k++) for (const [x, z] of [[ox + k, oz - 5], [ox + k, oz + 5], [ox - 5, oz + k], [ox + 5, oz + k]]) P.set(x, ty + 6, z, B.HOLLOWBRICK_SLAB);
  // the ladder from the house floor to the top room, on the +x pillar / tower wall
  P.set(ox + 2, gy + 6, oz, B.AIR); P.set(ox + 2, ty - 1, oz, B.AIR);
  ladder(P, ox + 2, gy, ty - 1, oz, 1);
  city.towers.push({ x: ox, z: oz, top: ty + 6 });
  let x0 = ox - 6, x1 = ox + 6, z0 = oz - 6, z1 = oz + 6, y1 = ty + 7;
  // 4. a bridge from the roof towards -x to a second tower
  if (rng() < 0.7) {
    const L = 6 + Math.floor(rng() * 5), by = gy + 6;
    for (let x = ox - 6; x >= ox - 5 - L; x--) {
      for (let z = oz - 1; z <= oz + 1; z++) { P.set(x, by, z, B.HOLLOWBRICK); P.set(x, by + 1, z, B.AIR); P.set(x, by + 2, z, B.AIR); P.set(x, by + 3, z, B.AIR); }
      P.set(x, by, oz - 2, B.HOLLOWBRICK); P.set(x, by, oz + 2, B.HOLLOWBRICK);
      P.set(x, by + 1, oz - 2, B.HOLLOWBRICK_SLAB); P.set(x, by + 1, oz + 2, B.HOLLOWBRICK_SLAB);
    }
    const tx = ox - 5 - L - 3, H2 = 6 + Math.floor(rng() * 6), t2 = by + 1 + H2;
    footing(P, groundAt, tx - 3, oz - 3, tx + 3, oz + 3, gy - 2);
    for (let y = gy - 1; y <= t2 - 2; y++) for (let x = tx - 3; x <= tx + 3; x++) for (let z = oz - 3; z <= oz + 3; z++) {
      const ex = x === tx - 3 || x === tx + 3, ez = z === oz - 3 || z === oz + 3;
      P.set(x, y, z, y === gy - 1 ? B.HOLLOWBRICK : ex && ez ? B.HOLLOWBRICK_PILLAR : ex || ez ? B.HOLLOWBRICK : B.AIR);
    }
    for (let y = by + 1; y < by + 4; y++) P.set(tx + 3, y, oz, B.AIR); // the bridge comes in here
    P.set(tx - 3, gy, oz, B.AIR); P.set(tx - 3, gy + 1, oz, B.AIR); // and a door at the foot
    room(P, tx, t2, oz, 4, 5, { windows: true });
    P.set(tx + 3, t2, oz + 3, B.CHEST, lootChestMeta(LOOT_CITY, 1));
    P.set(tx - 3, t2, oz - 3, B.WISP_ROD);
    P.set(tx - 2, t2 - 1, oz, B.AIR);
    P.box(tx - 1, gy, oz, tx - 1, t2 - 2, oz, B.HOLLOWBRICK_PILLAR);
    ladder(P, tx - 2, gy, t2 - 1, oz, 1);
    for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) P.set(tx + dx, t2 + 6, oz + dz, B.WISP_ROD);
    city.towers.push({ x: tx, z: oz, top: t2 + 6 });
    x0 = Math.min(x0, tx - 5); y1 = Math.max(y1, t2 + 7);
  }
  // 5. a ship moored at roof height off the +z side, reached by a walkway
  if (rng() < 0.5) {
    const dy = gy + 6, sx = ox, sz = oz + 15;
    for (let z = oz + 6; z <= sz - 4; z++) for (let x = ox - 1; x <= ox + 1; x++) { P.set(x, dy, z, B.HOLLOWBRICK); P.set(x, dy + 1, z, B.AIR); P.set(x, dy + 2, z, B.AIR); }
    const halfW = (x) => { const a = Math.abs(x); return a <= 6 ? 3 : a <= 8 ? 2 : a <= 10 ? 1 : 0; };
    for (let x = -11; x <= 11; x++) {
      const w = halfW(x);
      for (let y = dy - 4; y <= dy; y++) {
        const ww = Math.max(0, w - Math.max(0, dy - 2 - y)); // narrower towards the keel
        for (let z = -ww; z <= ww; z++) {
          const shell = y === dy - 4 || Math.abs(z) === ww || Math.abs(x) === 11 || halfW(x + Math.sign(x || 1)) < Math.abs(z) || y === dy;
          P.set(sx + x, y, sz + z, shell ? B.HOLLOWBRICK : B.AIR);
        }
        if (y === dy && w > 0) for (const z of [-w, w]) if (!(z === -w && x >= -1 && x <= 1)) P.set(sx + x, dy + 1, sz + z, B.HOLLOWBRICK_SLAB);
      }
      if (w === 0) P.set(sx + x, dy + 1, sz, B.HOLLOWBRICK_SLAB);
    }
    // mast and sail
    for (let y = dy + 1; y <= dy + 11; y++) P.set(sx - 2, y, sz, B.HOLLOWBRICK_PILLAR);
    for (let y = dy + 4; y <= dy + 10; y++) for (let z = -3; z <= 3; z++) if (z) P.set(sx - 1, y, sz + z, B.WOOL, COLOR.PURPLE ?? 10);
    P.set(sx - 2, dy + 12, sz, B.WISP_ROD);
    // the trophy on the bow, facing +x
    P.set(sx + 10, dy + 1, sz, B.WYRM_HEAD, 1);
    // the hold: a hatch, a ladder and two chests (one always with a Voidwing)
    P.set(sx, dy, sz - 1, B.AIR);
    ladder(P, sx, dy - 3, dy, sz - 1, 0);
    P.set(sx, dy - 2, sz - 2, B.HOLLOWBRICK); P.set(sx, dy - 1, sz - 2, B.HOLLOWBRICK); // the ladder's backing
    P.set(sx - 4, dy - 3, sz, B.CHEST, lootChestMeta(LOOT_SHIP, 1));
    P.set(sx + 4, dy - 3, sz, B.CHEST, lootChestMeta(LOOT_CITY, 3));
    P.set(sx, dy - 3, sz + 1, B.WISP_ROD);
    city.ship = { x: sx, y: dy, z: sz };
    z1 = Math.max(z1, sz + 4);
    x1 = Math.max(x1, sx + 12); x0 = Math.min(x0, sx - 12);
  }
  city.bounds = { x0, x1, y0: gy - 6, y1, z0, z1 };
  city.plan = P;
  return city;
}

// ---- loot ------------------------------------------------------------------------
// [id, min, max, weight] (reference city table: 2-6 rolls; enchanted gear at level 20-39)
const CITY_LOOT = () => [
  [I.DIAMOND, 2, 7, 5], [I.IRON_INGOT, 4, 8, 10], [I.GOLD_INGOT, 2, 7, 15], [I.BERYL, 2, 6, 2],
  [I.BEETROOT_SEEDS, 1, 10, 5], [I.SADDLE, 1, 1, 3], [I.DRIFT_MEMBRANE, 1, 3, 4], [I.SKY_ROCKET, 2, 6, 3],
  ...[I.DIAMOND_SWORD, I.DIAMOND_BOOTS, I.DIAMOND_CHESTPLATE, I.DIAMOND_LEGGINGS, I.DIAMOND_HELMET, I.DIAMOND_PICKAXE, I.DIAMOND_SHOVEL,
    I.IRON_SWORD, I.IRON_BOOTS, I.IRON_CHESTPLATE, I.IRON_LEGGINGS, I.IRON_HELMET, I.IRON_PICKAXE, I.IRON_SHOVEL].map((id) => [id, 1, 1, 3, true]),
];

function pick(table, rng) {
  let total = 0;
  for (const e of table) total += e[3];
  let r = rng() * total;
  for (const e of table) if ((r -= e[3]) < 0) return e;
  return table[table.length - 1];
}

/** One stack of city loot (gear comes enchanted at level 20-39). */
export function cityLootStack(rng, e) {
  const [id, min, max, , ench] = e;
  const st = { id, count: min + Math.floor(rng() * (max - min + 1)), damage: 0 };
  if (ench) {
    const list = selectEnchantments(rng, id, 20 + Math.floor(rng() * 20));
    if (list.length) { st.ench = {}; for (const [k, l] of list) st.ench[k] = l; }
  }
  return st;
}

/**
 * 27 chest slots of Hollow City loot; `ship` chests also hold a Voidwing
 * (reference: the elytra in the ship's item frame).
 */
export function hollowCityLoot(rng = Math.random, ship = false) {
  const table = CITY_LOOT().filter((e) => e[0] !== undefined && ITEMS[e[0]]);
  const stacks = [];
  for (let k = 0, n = 2 + Math.floor(rng() * 5); k < n; k++) stacks.push(cityLootStack(rng, pick(table, rng)));
  if (ship) stacks.push({ id: I.VOIDWING, count: 1, damage: 0 });
  const slots = new Array(27).fill(null);
  for (const st of stacks) {
    let s;
    do s = Math.floor(rng() * 27); while (slots[s]);
    slots[s] = st;
  }
  return slots;
}
