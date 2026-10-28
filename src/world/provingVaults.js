// The Proving Vaults (reference: trial chambers): large halls cut deep into
// the rock (floors between y -52 and -8), built of copper-tinted Vault Bricks,
// Ashstone bricks, tiles and polished Ashstone, with Copper Grates and glowing
// Copper Bulbs. A tall central atrium with a grated balcony ring, two
// staircases and a pair of Vaults opens onto corridors (some climbing or
// falling a few blocks on stairs, some leaving from the balcony) that lead to
// 6-10 rooms chosen from a small set of templates: spawner arenas, two-level
// galleries, vault rooms, store rooms full of Decorated Pots and small
// crossings. Proving Spawners guard them; chests hold supplies and Proving
// Keys.
//
// Like mineshafts and villages the plan comes from the seed alone (one try per
// 320 x 320-block region) and each chunk stamps its own part, so a structure
// is the same whichever chunk is generated first. This module also holds the
// pure run-time rules (unit tested) used by world/provingSystem.js: the
// Proving Spawner's wave state machine and the ledger of who opened which
// Vault.
import { B } from './blocks.js';
import { MIN_Y, cidx } from './constants.js';
import { mulberry32, hash4 } from './noise.js';

export const VAULTS_REGION = 320;
const CHANCE = 0.45, MARGIN = 110, EDGE = 8;
/** Floor heights (first air layer) every room keeps between. */
export const VAULTS_MIN_FLOOR = -52, VAULTS_MAX_FLOOR = -8;
/** Chest loot kind of the store rooms and galleries (chest meta bits 4-7, see mobs/spawnerBlocks.js). */
export const VAULTS_LOOT = 11;
/** Mob kinds a Proving Spawner can be set to (its meta bits 0-3 index this list). */
export const PROVING_MOBS = ['shambler', 'rattler', 'skitterer', 'wobbler', 'dune_shambler', 'rime_rattler'];
/** Proving Spawner meta: bits 0-3 mob kind, bits 4-5 the state it shows (SPAWNER_STATE). */
export const spawnerMeta = (kind, state = 0) => (kind & 15) | ((state & 3) << 4);
export const spawnerKind = (meta) => PROVING_MOBS[(meta & 15) % PROVING_MOBS.length];
export const spawnerShown = (meta) => (meta >> 4) & 3;

// SIDE_DIRS order (-z, +x, +z, -x): also the facing metas of chests, vaults and stairs
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Room templates: interior size (x, z), interior air height, weight, at most this many per structure. */
export const ROOM_TEMPLATES = {
  arena: { w: 11, d: 11, h: 6, weight: 3, max: 4 },
  gallery: { w: 13, d: 13, h: 9, weight: 2, max: 2 },
  vaultroom: { w: 9, d: 9, h: 5, weight: 1, max: 2 },
  store: { w: 9, d: 9, h: 5, weight: 2, max: 3 },
  crossing: { w: 7, d: 7, h: 5, weight: 2, max: 3 },
};
const ATRIUM = { w: 21, d: 21, h: 13, balcony: 6 };
const CORRIDOR_HALF = 2, CORRIDOR_AIR = 5; // 3 wide inside, 5 high

const cache = new Map();
export function vaultsInRegion(seed, rx, rz) {
  const key = `${seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  const v = planVaults(seed, rx, rz);
  if (cache.size > 64) cache.clear();
  cache.set(key, v);
  return v;
}

export function vaultsNear(seed, x0, z0, x1, z1) {
  const out = [], R = VAULTS_REGION;
  for (let rx = Math.floor(x0 / R); rx <= Math.floor(x1 / R); rx++) for (let rz = Math.floor(z0 / R); rz <= Math.floor(z1 / R); rz++) {
    const v = vaultsInRegion(seed, rx, rz);
    if (v) out.push(v);
  }
  return out;
}

/** Do two boxes ({x0,y0,z0,x1,y1,z1}, inclusive) share a block? */
export const boxesOverlap = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;

/** Floor height (first air layer) of a corridor at step k: flat, then one block per step, then flat. */
export function corridorFloor(c, k) {
  const dy = c.yB - c.yA, n = Math.abs(dy);
  if (k <= c.pre) return c.yA;
  if (k >= c.pre + n) return c.yB;
  return c.yA + Math.sign(dy) * (k - c.pre);
}

/** A room (or the atrium) whose interior is centred on (cx, cz) with its floor's first air layer at f. */
function roomPiece(kind, tpl, cx, f, cz) {
  const hx = (tpl.w - 1) / 2, hz = (tpl.d - 1) / 2;
  return { kind, cx, cz, f, hx, hz, h: tpl.h, x0: cx - hx - 1, x1: cx + hx + 1, z0: cz - hz - 1, z1: cz + hz + 1, y0: f - 1, y1: f + tpl.h, decor: [] };
}

/** The doorway of a room wall at floor level (or `dy` higher), `off` blocks along the wall: the first cell outside. */
function exitOf(p, dir, dy = 0, off = 0) {
  const [dx, dz] = DIRS[dir], sx = -dz, sz = dx;
  const x = dx > 0 ? p.x1 + 1 : dx < 0 ? p.x0 - 1 : p.cx + sx * off;
  const z = dz > 0 ? p.z1 + 1 : dz < 0 ? p.z0 - 1 : p.cz + sz * off;
  return { x, z, y: p.f + dy, dir };
}

function pickTemplate(rng, counts) {
  const keys = Object.keys(ROOM_TEMPLATES).filter((k) => (counts[k] || 0) < ROOM_TEMPLATES[k].max);
  let total = 0;
  for (const k of keys) total += ROOM_TEMPLATES[k].weight;
  let r = rng() * total;
  for (const k of keys) { if ((r -= ROOM_TEMPLATES[k].weight) < 0) return k; }
  return keys[keys.length - 1];
}

export function planVaults(seed, rx, rz) {
  const rng = mulberry32(hash4(seed, rx, rz, 4471));
  if (rng() > CHANCE) return null;
  const R = VAULTS_REGION;
  const bounds = { x0: rx * R + EDGE, x1: rx * R + R - EDGE - 1, z0: rz * R + EDGE, z1: rz * R + R - EDGE - 1 };
  const cx = rx * R + MARGIN + Math.floor(rng() * (R - 2 * MARGIN)), cz = rz * R + MARGIN + Math.floor(rng() * (R - 2 * MARGIN));
  const y = -40 + Math.floor(rng() * 16); // the atrium's floor: -40..-25
  const atrium = roomPiece('atrium', ATRIUM, cx, y, cz);
  decorateAtrium(atrium, rng);
  const pieces = [atrium], rooms = [], counts = {};
  const target = 6 + Math.floor(rng() * 5);
  // the atrium's doors: one in the middle of each wall at the floor, two more off the balcony
  const exits = [0, 1, 2, 3].map((d) => exitOf(atrium, d));
  const up = Math.floor(rng() * 4);
  exits.push(exitOf(atrium, up, ATRIUM.balcony, 5), exitOf(atrium, (up + 2) & 3, ATRIUM.balcony, -5));
  const inside = (b) => b.x0 >= bounds.x0 && b.x1 <= bounds.x1 && b.z0 >= bounds.z0 && b.z1 <= bounds.z1;
  const free = (b) => inside(b) && pieces.every((p) => !boxesOverlap(p, b));
  while (exits.length && rooms.length < target) {
    const e = exits.splice(Math.floor(rng() * exits.length), 1)[0];
    for (let attempt = 0; attempt < 3; attempt++) {
      const tplKey = pickTemplate(rng, counts), tpl = ROOM_TEMPLATES[tplKey];
      let dy = rng() < 0.4 ? (rng() < 0.5 ? -1 : 1) * (2 + Math.floor(rng() * 3)) : 0;
      if (e.y + dy < VAULTS_MIN_FLOOR || e.y + dy > VAULTS_MAX_FLOOR) dy = -dy;
      const len = Math.max(Math.abs(dy) + 4, 4 + Math.floor(rng() * 9));
      const [dx, dz] = DIRS[e.dir], sx = -dz, sz = dx;
      const yA = e.y, yB = e.y + dy;
      // the corridor: cells k = 0..len-1 from the doorway outwards, 5 wide with its shell
      const ex = e.x + dx * (len - 1), ez = e.z + dz * (len - 1);
      const cor = {
        kind: 'corridor', dir: e.dir, x: e.x, z: e.z, len, yA, yB, pre: Math.floor((len - Math.abs(dy)) / 2), decor: [],
        x0: Math.min(e.x, ex) - CORRIDOR_HALF * Math.abs(sx), x1: Math.max(e.x, ex) + CORRIDOR_HALF * Math.abs(sx),
        z0: Math.min(e.z, ez) - CORRIDOR_HALF * Math.abs(sz), z1: Math.max(e.z, ez) + CORRIDOR_HALF * Math.abs(sz),
        y0: Math.min(yA, yB) - 1, y1: Math.max(yA, yB) + CORRIDOR_AIR,
      };
      // the room beyond it: its entry wall is the next cell, its middle on the corridor's axis
      const along = ((dx ? tpl.w : tpl.d) + 1) / 2;
      const room = roomPiece(tplKey, tpl, e.x + dx * (len + along), yB, e.z + dz * (len + along));
      room.entry = (e.dir + 2) & 3; // the side its door is on
      if (yB < VAULTS_MIN_FLOOR || yB > VAULTS_MAX_FLOOR || !free(cor) || !free(room) || boxesOverlap(cor, room)) continue;
      decorateCorridor(cor);
      decorateRoom(room, rng);
      pieces.push(cor, room);
      rooms.push(room);
      counts[tplKey] = (counts[tplKey] || 0) + 1;
      // onwards from its other walls (crossings always, other rooms most of the time)
      for (let d = 0; d < 4; d++) if (d !== room.entry && (tplKey === 'crossing' || rng() < 0.7)) exits.push(exitOf(room, d));
      break;
    }
  }
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pieces) { x0 = Math.min(x0, p.x0); x1 = Math.max(x1, p.x1); z0 = Math.min(z0, p.z0); z1 = Math.max(z1, p.z1); y0 = Math.min(y0, p.y0); y1 = Math.max(y1, p.y1); }
  return { cx, cz, y, pieces, rooms, x0, x1, z0, z1, y0, y1 };
}

// ---- decoration (decided at plan time, so every chunk agrees) ---------------------------------

const put = (p, x, y, z, id, meta = 0) => p.decor.push([x, y, z, id, meta]);
const chestMeta = (facing) => (facing & 3) | 8 | (VAULTS_LOOT << 4);
/** Facing (SIDE_DIRS index) from (dx, dz) towards the middle of a room. */
const faceIn = (dx, dz) => (Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 3 : 1) : (dz > 0 ? 0 : 2));
const spawnerAt = (p, x, y, z, rng) => put(p, x, y, z, B.PROVING_SPAWNER, spawnerMeta(Math.floor(rng() * PROVING_MOBS.length)));

/** A solid flight of stairs from the floor (y = f) rising `n` blocks along `dir`, starting at (x, z). */
function stairs(p, x, z, f, n, dir, width = 1) {
  const [dx, dz] = DIRS[dir], sx = -dz, sz = dx;
  for (let k = 0; k < n; k++) for (let s = 0; s < width; s++) {
    const bx = x + dx * k + sx * s, bz = z + dz * k + sz * s;
    for (let yy = f; yy < f + k; yy++) put(p, bx, yy, bz, B.ASHSTONE_BRICKS);
    put(p, bx, f + k, bz, B.ASHSTONE_BRICK_STAIRS, dir);
  }
}

function decorateAtrium(p, rng) {
  const { cx, cz, f } = p, top = f + ATRIUM.h - 1, bal = f + ATRIUM.balcony - 1;
  // the floor: polished Ashstone with a Vault Brick cross and border
  for (let dz = -p.hz; dz <= p.hz; dz++) for (let dx = -p.hx; dx <= p.hx; dx++) {
    const ring = Math.max(Math.abs(dx), Math.abs(dz));
    const id = dx === 0 || dz === 0 || ring === p.hx || ring === 4 ? B.VAULT_BRICKS : (dx + dz) & 1 ? B.POLISHED_ASHSTONE : B.ASHSTONE_TILES;
    put(p, cx + dx, f - 1, cz + dz, id);
    // the balcony round the walls, three wide, edged with Copper Grates
    if (ring >= p.hx - 2) put(p, cx + dx, bal, cz + dz, ring === p.hx - 2 ? B.COPPER_GRATE : B.ASHSTONE_TILES);
  }
  // the central column: Vault Bricks with bulbs on its faces and grates near the top
  for (let yy = f; yy <= top; yy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const face = (dx === 0) !== (dz === 0);
    let id = yy === f || yy === top ? B.POLISHED_ASHSTONE : B.VAULT_BRICKS;
    if (face && (yy === f + 3 || yy === f + 9)) id = B.COPPER_BULB_LIT;
    else if (face && yy >= top - 2) id = B.COPPER_GRATE;
    put(p, cx + dx, yy, cz + dz, id);
  }
  // two Vaults at the column's foot, looking out to the north and south doors
  put(p, cx, f, cz - 2, B.VAULT, 0);
  put(p, cx, f, cz + 2, B.VAULT, 2);
  // staircases up to the balcony along the north and south walls
  stairs(p, cx - 7, cz - 7, f, ATRIUM.balcony, 1, 1);
  stairs(p, cx + 7, cz + 7, f, ATRIUM.balcony, 3, 1);
  // spawners on the diagonals, bulbs in the ceiling, pots and a chest in the corners
  spawnerAt(p, cx - 5, f, cz + 5, rng);
  spawnerAt(p, cx + 5, f, cz - 5, rng);
  for (const [dx, dz] of [[-5, -5], [5, 5], [-5, 5], [5, -5], [0, -8], [0, 8], [-8, 0], [8, 0]]) put(p, cx + dx, p.y1, cz + dz, B.COPPER_BULB_LIT);
  for (const [dx, dz] of [[-9, -9], [9, 9], [-9, 9], [9, -9], [-9, -8], [8, 9]]) if (rng() < 0.7) put(p, cx + dx, f, cz + dz, B.DECORATED_POT, faceIn(dx, dz));
  put(p, cx + 9, f, cz - 9, B.CHEST, chestMeta(faceIn(9, -9)));
  put(p, cx - 9, bal + 1, cz + 9, B.CHEST, chestMeta(faceIn(-9, 9)));
}

function decorateCorridor(c) {
  const [dx, dz] = DIRS[c.dir];
  // a bulb in the ceiling every six steps
  for (let k = 3; k < c.len - 1; k += 6) put(c, c.x + dx * k, corridorFloor(c, k) + CORRIDOR_AIR, c.z + dz * k, B.COPPER_BULB_LIT);
}

function decorateRoom(p, rng) {
  const { cx, cz, f, hx, hz } = p, ceil = p.y1;
  const at = (dx, y, dz, id, meta = 0) => put(p, cx + dx, y, cz + dz, id, meta);
  // a tiled floor with a Vault Brick ring round the middle
  for (let dz = -hz; dz <= hz; dz++) for (let dx = -hx; dx <= hx; dx++) {
    const ring = Math.max(Math.abs(dx), Math.abs(dz));
    at(dx, f - 1, dz, ring === 2 ? B.VAULT_BRICKS : ((dx >> 1) + (dz >> 1)) & 1 ? B.POLISHED_ASHSTONE : B.ASHSTONE_TILES);
  }
  const pots = (cells, chance) => { for (const [dx, dz] of cells) if (rng() < chance) at(dx, f, dz, B.DECORATED_POT, faceIn(dx, dz)); };
  switch (p.kind) {
    case 'arena': {
      spawnerAt(p, cx, f, cz, rng);
      for (const sx of [-4, 4]) for (const sz of [-4, 4]) for (let yy = f; yy < ceil; yy++) at(sx, yy, sz, yy === f + 3 ? B.COPPER_BULB_LIT : B.POLISHED_ASHSTONE);
      at(3, f, -4, B.CHEST, chestMeta(2));
      pots([[-3, 4], [4, -3], [-4, 3], [3, 4]], 0.6);
      break;
    }
    case 'gallery': {
      // a balcony two wide round the walls (grated on its inner edge), stairs up on two sides
      const bal = f + 3;
      for (let dz = -hz; dz <= hz; dz++) for (let dx = -hx; dx <= hx; dx++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        if (ring >= hx - 1) at(dx, bal, dz, ring === hx - 1 ? B.COPPER_GRATE : B.ASHSTONE_TILES);
      }
      stairs(p, cx - 2, cz - 4, f, 4, 3);
      stairs(p, cx + 2, cz + 4, f, 4, 1);
      spawnerAt(p, cx, f, cz, rng);
      spawnerAt(p, cx + hx, bal + 1, cz + hz, rng);
      at(-hx, bal + 1, hz, B.CHEST, chestMeta(1));
      at(hx, bal + 1, -hz, B.CHEST, chestMeta(3));
      for (const [dx, dz] of [[-4, -4], [4, 4], [-4, 4], [4, -4]]) at(dx, ceil, dz, B.COPPER_BULB_LIT);
      pots([[3, -3], [-3, 3]], 0.7);
      break;
    }
    case 'vaultroom': {
      at(0, f, 0, B.VAULT, p.entry);
      at(0, f - 1, 0, B.VAULT_BRICKS);
      for (const [dx, dz] of [[-3, -3], [3, 3], [-3, 3], [3, -3]]) { at(dx, f, dz, B.DECORATED_POT, faceIn(dx, dz)); at(dx, ceil, dz, B.COPPER_BULB_LIT); }
      if (rng() < 0.5) spawnerAt(p, cx + 2, f, cz + 2, rng);
      break;
    }
    case 'store': {
      const cells = [];
      for (let dz = -hz + 1; dz <= hz - 1; dz++) for (let dx = -hx + 1; dx <= hx - 1; dx++) if (Math.abs(dx) >= 2 && Math.abs(dz) >= 2 && Math.max(Math.abs(dx), Math.abs(dz)) === hx - 1) cells.push([dx, dz]);
      const chest = Math.floor(rng() * cells.length);
      cells.forEach(([dx, dz], i) => { if (i === chest) at(dx, f, dz, B.CHEST, chestMeta(faceIn(dx, dz))); });
      pots(cells.filter((_, i) => i !== chest), 0.65);
      at(0, ceil, 0, B.COPPER_BULB_LIT);
      if (rng() < 0.6) spawnerAt(p, cx, f, cz, rng);
      break;
    }
    default: { // crossing
      at(0, ceil, 0, B.COPPER_BULB_LIT);
      pots([[-2, -2], [2, 2], [-2, 2], [2, -2]], 0.5);
    }
  }
}

// ---- stamping -----------------------------------------------------------------------------

/** Shell material of a piece at (x, y, z): floors, walls with Vault Brick courses, ceilings. */
function shellBlock(p, x, y, z) {
  if (y === p.y0) return p.kind === 'corridor' ? B.POLISHED_ASHSTONE : B.ASHSTONE_TILES;
  if (y === p.y1) return p.kind === 'corridor' ? B.ASHSTONE_TILES : B.ASHSTONE_BRICKS;
  const rel = y - p.y0;
  if (rel === 1 || (p.kind !== 'corridor' && rel % 5 === 0)) return B.VAULT_BRICKS;
  return B.ASHSTONE_BRICKS;
}

/** Each corridor cell's interior: { x, z, f } for k = -1..len (the ends cut the doorways). */
function corridorCells(c, k) {
  const [dx, dz] = DIRS[c.dir];
  const f = k < 0 ? c.yA : k >= c.len ? c.yB : corridorFloor(c, k);
  return { x: c.x + dx * k, z: c.z + dz * k, f };
}

/** Carve the parts of nearby Proving Vaults that fall inside chunk (cx, cz). */
export function stampProvingVaults(seed, blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16, X1 = X0 + 15, Z1 = Z0 + 15;
  let any = false;
  for (const v of vaultsNear(seed, X0, Z0, X1, Z1)) {
    if (v.x1 < X0 || v.x0 > X1 || v.z1 < Z0 || v.z0 > Z1) continue;
    const touches = (p) => !(p.x1 < X0 - 1 || p.x0 > X1 + 1 || p.z1 < Z0 - 1 || p.z0 > Z1 + 1);
    const pieces = v.pieces.filter(touches);
    if (!pieces.length) continue;
    any = true;
    const inChunk = (x, z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
    const set = (x, y, z, id, mt = 0) => {
      if (!inChunk(x, z) || y <= MIN_Y + 5) return;
      const i = cidx(x - X0, y, z - Z0);
      if (blocks[i] === B.BEDROCK) return;
      blocks[i] = id; meta[i] = mt;
    };
    // 1. every piece's shell (the whole box, solid)
    for (const p of pieces) {
      for (let x = Math.max(p.x0, X0); x <= Math.min(p.x1, X1); x++) for (let z = Math.max(p.z0, Z0); z <= Math.min(p.z1, Z1); z++)
        for (let y = p.y0; y <= p.y1; y++) set(x, y, z, shellBlock(p, x, y, z));
    }
    // 2. the hollows: room interiors, then corridors (whose ends cut the doorways through the walls)
    for (const p of pieces) {
      if (p.kind === 'corridor') continue;
      for (let x = Math.max(p.x0 + 1, X0); x <= Math.min(p.x1 - 1, X1); x++) for (let z = Math.max(p.z0 + 1, Z0); z <= Math.min(p.z1 - 1, Z1); z++)
        for (let y = p.y0 + 1; y < p.y1; y++) set(x, y, z, B.AIR);
    }
    for (const c of pieces) {
      if (c.kind !== 'corridor') continue;
      const [dx, dz] = DIRS[c.dir], sx = -dz, sz = dx;
      for (let k = -1; k <= c.len; k++) {
        const { x, z, f } = corridorCells(c, k);
        for (let s = -1; s <= 1; s++) {
          const bx = x + sx * s, bz = z + sz * s;
          if (!inChunk(bx, bz)) continue;
          for (let y = f; y < f + CORRIDOR_AIR; y++) set(bx, y, bz, B.AIR);
          if (k >= 0 && k < c.len) set(bx, f - 1, bz, s === 0 ? B.VAULT_BRICKS : B.POLISHED_ASHSTONE);
        }
        // a step: stairs in the lower cell, the raised half towards the higher one
        if (k >= 0 && k < c.len - 1) {
          const n = corridorCells(c, k + 1);
          if (n.f !== f) {
            const lower = n.f > f ? { x, z, f } : n, facing = n.f > f ? c.dir : (c.dir + 2) & 3;
            for (let s = -1; s <= 1; s++) set(lower.x + sx * s, lower.f, lower.z + sz * s, B.ASHSTONE_BRICK_STAIRS, facing);
          }
        }
      }
    }
    // 3. the furnishings
    for (const p of pieces) for (const [x, y, z, id, mt] of p.decor) set(x, y, z, id, mt);
  }
  return any;
}

// ---- run-time rules (pure, unit tested) ------------------------------------------------------

/** Proving Spawner states (the visible ones are kept in meta bits 4-5). */
export const SPAWNER_STATE = { IDLE: 0, ACTIVE: 1, COOLDOWN: 2 };
/** Players within this many blocks wake a spawner. */
export const PROVING_RANGE = 14;
/** A wave: 6 mobs for one player, 2 more for each other player near; at most 3 about at once. */
export const WAVE_BASE = 6, WAVE_PER_PLAYER = 2, MAX_ALIVE = 3;
/** Ticks between spawns while a wave runs; 30 minutes of rest after it is beaten. */
export const SPAWN_INTERVAL = 40, COOLDOWN_TICKS = 30 * 60 * 20;
/** With nobody near for this long a running wave is called off (the spawner waits again). */
export const GIVE_UP_TICKS = 600;

export const waveSize = (players) => WAVE_BASE + WAVE_PER_PLAYER * Math.max(0, players - 1);
export const newSpawnerState = () => ({ state: SPAWNER_STATE.IDLE, total: 0, spawned: 0, delay: 0, cooldown: 0, away: 0, players: 0 });

/**
 * One tick of a Proving Spawner's state `s` with `players` players in range and `alive` of its
 * mobs still about. Returns { spawn, eject, changed }: spawn = try to call one mob now (report
 * success with spawnerSpawned), eject = the wave was beaten (throw out one reward roll per player
 * who took part), changed = the visible state changed.
 */
export function spawnerStep(s, players, alive) {
  const out = { spawn: false, eject: 0, changed: false };
  switch (s.state) {
    case SPAWNER_STATE.COOLDOWN:
      if (--s.cooldown <= 0) { s.state = SPAWNER_STATE.IDLE; s.cooldown = 0; out.changed = true; }
      break;
    case SPAWNER_STATE.IDLE:
      if (players > 0) {
        Object.assign(s, { state: SPAWNER_STATE.ACTIVE, total: waveSize(players), spawned: 0, delay: SPAWN_INTERVAL / 2, away: 0, players });
        out.changed = true;
      }
      break;
    case SPAWNER_STATE.ACTIVE:
      if (players === 0) {
        if (++s.away >= GIVE_UP_TICKS && alive === 0) { Object.assign(s, newSpawnerState()); out.changed = true; }
        break;
      }
      s.away = 0;
      // more players joining grows the wave
      if (players > s.players) { s.players = players; s.total = Math.max(s.total, waveSize(players)); }
      if (s.spawned >= s.total && alive === 0) {
        out.eject = s.players;
        Object.assign(s, newSpawnerState(), { state: SPAWNER_STATE.COOLDOWN, cooldown: COOLDOWN_TICKS });
        out.changed = true;
        break;
      }
      if (s.spawned < s.total && alive < MAX_ALIVE && --s.delay <= 0) { out.spawn = true; s.delay = SPAWN_INTERVAL; }
      break;
  }
  return out;
}
/** A mob of the wave appeared. */
export function spawnerSpawned(s) { s.spawned++; }

/** What a spawner's state looks like in its saved form ([key, state, cooldown] for cooling ones). */
export function saveSpawnerStates(map) {
  const out = [];
  for (const [k, s] of map) if (s.state === SPAWNER_STATE.COOLDOWN && s.cooldown > 0) out.push([k, s.state, s.cooldown]);
  return out;
}
export function loadSpawnerStates(list) {
  const map = new Map();
  if (!Array.isArray(list)) return map;
  for (const e of list) {
    if (!Array.isArray(e) || typeof e[0] !== 'string' || !/^-?\d+,-?\d+,-?\d+$/.test(e[0])) continue;
    const cd = Math.max(0, Math.min(COOLDOWN_TICKS, e[2] | 0));
    if (cd > 0) map.set(e[0], { ...newSpawnerState(), state: SPAWNER_STATE.COOLDOWN, cooldown: cd });
  }
  return map;
}

/** Most names a Vault remembers. */
export const VAULT_MAX_NAMES = 64;
const cleanName = (n) => (typeof n === 'string' ? n.slice(0, 32) : '');

/** Who has opened which Vault ("x,y,z" -> player names): each player opens a Vault once. */
export class VaultLedger {
  constructor() { this.map = new Map(); }
  has(k, name) { const l = this.map.get(k); return !!l && l.includes(cleanName(name)); }
  /** Record that `name` opened the Vault at k; false if they already had (or the name is empty). */
  unlock(k, name) {
    const n = cleanName(name);
    if (!n) return false;
    const l = this.map.get(k) || [];
    if (l.includes(n)) return false;
    l.push(n);
    if (l.length > VAULT_MAX_NAMES) l.shift();
    this.map.set(k, l);
    return true;
  }
  names(k) { return [...(this.map.get(k) || [])]; }
  set(k, names) {
    const l = Array.isArray(names) ? [...new Set(names.map(cleanName).filter(Boolean))].slice(-VAULT_MAX_NAMES) : [];
    if (l.length) this.map.set(k, l); else this.map.delete(k);
  }
  remove(k) { this.map.delete(k); }
  save() { return [...this.map].map(([k, l]) => [k, [...l]]); }
  load(list) {
    this.map.clear();
    if (!Array.isArray(list)) return;
    for (const e of list) if (Array.isArray(e) && typeof e[0] === 'string' && /^-?\d+,-?\d+,-?\d+$/.test(e[0])) this.set(e[0], e[1]);
  }
}
