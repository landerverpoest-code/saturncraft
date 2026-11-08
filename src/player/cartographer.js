// The Cartographer's Table: a map of the ground you have already been over.
//  * The world remembers which chunks the player has been near (`Explored`, ticked from game.js, saved with the world): every
//    chunk within CHART_RADIUS of the player that is loaded counts as seen.
//  * At the table, a Paper and a Compass (the compass is kept: it is the instrument) draw a map of the 128-block square the table
//    stands in, but ONLY where you have been: the chunks still loaded are drawn exactly as a walked map would draw them, the
//    explored chunks that have since unloaded are charted from the terrain generator (world/landmarks.js surveyMap: coarser, and
//    natural terrain only), and everything else stays blank parchment. Structures in explored chunks are marked.
//  * A held map and a Paper make a copy of that map (the copy shares its picture, so what one fills in the other shows).
// Logic only: the screen is in ui/tableScreens.js.
import { I } from '../world/items.js';
import { newMap, drawColumn, MAP_SIZE, mapOrigin } from '../world/maps.js';
import { surveyMap, landmarksInBox, addMark } from '../world/landmarks.js';

export const CHART_RADIUS = 3;       // chunks round the player that count as seen
export const MAX_CHUNKS = 40000;     // chunks remembered per dimension
export const TABLE_PAPER = 1;        // Paper one map or one copy costs
export const SQUARE_CHUNKS = MAP_SIZE / 16; // a map is 8 x 8 chunks

const ckey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

/** The chunks the player has been near, by dimension. */
export class Explored {
  constructor() { this.dims = new Map(); }
  set(dim) { let s = this.dims.get(dim); if (!s) this.dims.set(dim, s = new Set()); return s; }
  has(dim, cx, cz) { const s = this.dims.get(dim); return !!s && s.has(ckey(cx, cz)); }
  count(dim) { const s = this.dims.get(dim); return s ? s.size : 0; }
  /** Remember one chunk; returns true when it was new. */
  note(dim, cx, cz) {
    if (!Number.isInteger(cx) || !Number.isInteger(cz) || Math.abs(cx) > 32000 || Math.abs(cz) > 32000) return false;
    const s = this.set(dim);
    if (s.size >= MAX_CHUNKS) return false;
    const k = ckey(cx, cz);
    if (s.has(k)) return false;
    s.add(k);
    return true;
  }
  /** The player stands at world (px, pz): note every loaded chunk within `radius`. Returns how many are new. */
  track(dim, px, pz, isLoaded, radius = CHART_RADIUS) {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    let n = 0;
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (dx * dx + dz * dz > radius * radius + 1) continue;
      const cx = pcx + dx, cz = pcz + dz;
      if (this.has(dim, cx, cz) || !isLoaded(cx, cz)) continue;
      if (this.note(dim, cx, cz)) n++;
    }
    return n;
  }
  /** How many of the 64 chunks of the map square at (x0, z0) are explored. */
  countIn(dim, x0, z0) {
    let n = 0;
    for (let i = 0; i < SQUARE_CHUNKS; i++) for (let j = 0; j < SQUARE_CHUNKS; j++) if (this.has(dim, (x0 >> 4) + i, (z0 >> 4) + j)) n++;
    return n;
  }
  save() {
    const out = {};
    for (const [dim, s] of this.dims) {
      const a = [];
      for (const k of s) a.push(Math.floor(k / 65536) - 32768, (k % 65536) - 32768);
      if (a.length) out[dim] = a;
    }
    return out;
  }
  load(data) {
    this.dims.clear();
    if (!data || typeof data !== 'object') return;
    for (const [dim, a] of Object.entries(data)) {
      if (typeof dim !== 'string' || dim.length > 24 || !Array.isArray(a)) continue;
      for (let i = 0; i + 1 < a.length && this.count(dim) < MAX_CHUNKS; i += 2) this.note(dim, a[i], a[i + 1]);
    }
  }
}

/** Remove `n` of item `id` from the bag (all or nothing); true when done. */
export function takeItems(inv, id, n) {
  if (inv.count(id) < n) return false;
  let left = n;
  for (let i = 0; i < inv.slots.length && left > 0; i++) {
    const s = inv.slots[i];
    if (!s || s.id !== id) continue;
    const t = Math.min(left, s.count);
    s.count -= t; left -= t;
    if (s.count <= 0) inv.slots[i] = null;
  }
  inv.changed();
  return true;
}

/**
 * Draw the explored part of the map square into `map`: chunks that are loaded exactly, the others from the generator (overworld
 * only), and a mark for every structure whose chunk is explored. Returns { chunks: explored chunks of the 64, marks }.
 */
export function drawExplored(map, explored, world) {
  const dim = map.dimension, cx0 = map.x0 >> 4, cz0 = map.z0 >> 4;
  const gen = dim === 'overworld' && world.dimension === 'overworld' ? world.gen : null;
  const seen = (mx, mz) => explored.has(dim, cx0 + (mx >> 4), cz0 + (mz >> 4));
  let chunks = 0, marks = 0;
  const loaded = [];
  for (let i = 0; i < SQUARE_CHUNKS; i++) for (let j = 0; j < SQUARE_CHUNKS; j++) {
    if (!explored.has(dim, cx0 + i, cz0 + j)) continue;
    chunks++;
    if (world.getChunk && world.getChunk(cx0 + i, cz0 + j)) loaded.push([i, j]);
  }
  const isLoaded = new Set(loaded.map(([i, j]) => i * 16 + j));
  if (gen) surveyMap(map, gen, (mx, mz) => seen(mx, mz) && !isLoaded.has((mx >> 4) * 16 + (mz >> 4)));
  for (const [i, j] of loaded) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) drawColumn(map, world, i * 16 + x, j * 16 + z);
  if (gen) {
    for (const l of landmarksInBox(gen, map.x0, map.z0, map.x0 + MAP_SIZE - 1, map.z0 + MAP_SIZE - 1)) {
      if (explored.has(dim, l.x >> 4, l.z >> 4) && addMark(map, l.kind, l.x, l.z)) marks++;
    }
  }
  map.dirty = true;
  return { chunks, marks };
}

/** What the table offers right now: { survey: reason | null, copy: reason | null, chunks, here: { x0, z0 } }. null = possible. */
export function tableOffers(game, x, z) {
  const p = game.player, inv = p.inventory, dim = game.world.dimension;
  const here = { x0: mapOrigin(Math.floor(x)), z0: mapOrigin(Math.floor(z)) };
  const chunks = game.explored ? game.explored.countIn(dim, here.x0, here.z0) : 0;
  let survey = null;
  if (!p.creative && inv.count(I.PAPER) < TABLE_PAPER) survey = 'Needs a Paper';
  else if (inv.count(I.COMPASS) < 1 && !p.creative) survey = 'Needs a Compass in your bag';
  else if (!chunks) survey = 'You have not explored this square yet';
  const held = inv.selectedStack;
  let copy = null;
  if (!held || held.id !== I.FILLED_MAP || !Number.isInteger(held.map)) copy = 'Hold a map to copy it';
  else if (!p.creative && inv.count(I.PAPER) < TABLE_PAPER) copy = 'Needs a Paper';
  return { survey, copy, chunks, here };
}

/** Hand a finished map to the player (or drop it at their feet when the bag is full). */
function give(game, stack) {
  const p = game.player;
  if (p.inventory.add(stack)) game.entities.spawnItem(p.x, p.y + 1, p.z, stack);
  p.inventory.changed();
}

/** Draw a map of the explored part of the square the table at (x, z) stands in, for a Paper. Returns { ok, msg, map }. */
export function surveyAtTable(game, x, z) {
  const offer = tableOffers(game, x, z);
  if (offer.survey) return { ok: false, msg: offer.survey };
  const p = game.player;
  if (!p.creative) takeItems(p.inventory, I.PAPER, TABLE_PAPER);
  let id;
  do id = 1 + Math.floor(Math.random() * 0x7ffffffe); while (game.maps.has(id));
  const map = newMap(id, offer.here.x0 + 1, offer.here.z0 + 1, game.world.dimension);
  game.maps.set(id, map);
  const r = drawExplored(map, game.explored, game.world);
  give(game, { id: I.FILLED_MAP, count: 1, damage: 0, map: id, mapX: Math.floor(map.x0 / MAP_SIZE), mapZ: Math.floor(map.z0 / MAP_SIZE), label: 'Survey Map' });
  if (game.audio) game.audio.play('page', [p.x, p.y + 1, p.z]);
  return { ok: true, msg: `Drew ${r.chunks} of ${SQUARE_CHUNKS * SQUARE_CHUNKS} chunks${r.marks ? ` and ${r.marks} landmark${r.marks === 1 ? '' : 's'}` : ''}`, map, ...r };
}

/** A copy of the held map, for a Paper: the same picture (one map id), so the copies fill in together. */
export function copyHeldMap(game, x, z) {
  const offer = tableOffers(game, x, z);
  if (offer.copy) return { ok: false, msg: offer.copy };
  const p = game.player, held = p.inventory.selectedStack;
  if (!p.creative) takeItems(p.inventory, I.PAPER, TABLE_PAPER);
  const copy = { id: held.id, count: 1, damage: 0, map: held.map, mapX: held.mapX | 0, mapZ: held.mapZ | 0 };
  if (held.label) copy.label = held.label;
  give(game, copy);
  if (game.audio) game.audio.play('page', [p.x, p.y + 1, p.z]);
  return { ok: true, msg: 'Copied the map' };
}
