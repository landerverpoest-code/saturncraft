// The Record Shelf: a bookshelf variant with six slots (two rows of three) that keep one book, map or sheet of paper each. The
// block's meta has one bit per slot (bit n set = slot n holds something), and the side texture draws a coloured spine for each
// held item. Right-click a slot area with a holder item to put it in, with an empty hand to take it out. A comparator behind it
// reads the number of held items spread over 1-15 (15 * n / 6, rounded up; 0 when empty). Contents drop when broken.
// Per position state lives in game.shelves ("x,y,z" -> array of six slots, each null or a one-item stack).
import { I } from './items.js';
import { copyBookFields, isBook } from './books.js';

export const SHELF_SLOTS = 6;
export const SHELF_COLS = 3;

/** May this item stack be shelved? Books, maps and paper. */
export const canShelve = (st) => !!st && (isBook(st.id) || st.id === I.BOOK || st.id === I.PAPER || st.id === I.FILLED_MAP || st.id === I.EMPTY_MAP);

/** One shelved item (always a single one) cleaned from untrusted data, or null. */
export function cleanShelved(st) {
  if (!st || typeof st !== 'object') return null;
  const id = st.id | 0;
  if (!canShelve({ id })) return null;
  const out = copyBookFields({ id, count: 1, damage: 0 }, st);
  if (id === I.FILLED_MAP) {
    if (Number.isInteger(st.map)) out.map = st.map;
    if (Number.isInteger(st.mapX)) out.mapX = st.mapX;
    if (Number.isInteger(st.mapZ)) out.mapZ = st.mapZ;
    if (typeof st.label === 'string') out.label = st.label.slice(0, 32);
  }
  return out;
}

/** A shelf's six slots cleaned from untrusted data; null when it holds nothing. */
export function cleanShelf(slots) {
  if (!Array.isArray(slots)) return null;
  const out = Array.from({ length: SHELF_SLOTS }, (_, i) => cleanShelved(slots[i]));
  return out.some(Boolean) ? out : null;
}

/** The meta of a shelf holding `slots` (bit n = slot n is filled). */
export const shelfMeta = (slots) => (slots || []).reduce((m, s, i) => (s && i < SHELF_SLOTS ? m | (1 << i) : m), 0);

/** How many items a shelf holds. */
export const shelfCount = (slots) => (slots || []).slice(0, SHELF_SLOTS).filter(Boolean).length;

/** Comparator signal: 0 when empty, else the count spread over 1-15 (six items give 15). */
export const shelfSignal = (slots) => { const n = shelfCount(slots); return n ? Math.min(15, Math.ceil(n * 15 / SHELF_SLOTS)) : 0; };

/** The slot under a click: `u` runs 0-1 across the face (left to right as seen), `v` 0-1 from the bottom. Top row = slots 3-5. */
export function slotAt(u, v) {
  const col = Math.max(0, Math.min(SHELF_COLS - 1, Math.floor(u * SHELF_COLS)));
  return (v >= 0.5 ? SHELF_COLS : 0) + col;
}

/** The slot a click hit: from the clicked face ([nx, ny, nz]) and the hit point inside the block (fractions 0-1); -1 on top or bottom faces. */
export function slotFromHit(face, fx, fy, fz) {
  if (face[1] !== 0) return -1;
  const u = face[2] === 0 ? (face[0] > 0 ? 1 - fz : fz) : (face[2] < 0 ? 1 - fx : fx);
  return slotAt(u, fy);
}

/**
 * Right-click on a slot (or -1 when the click was on the top or bottom): with an item that can be shelved, put it in the slot
 * (the first free slot when -1); with an empty hand, take the item out. Returns { slots, put, took } or null when nothing happens.
 */
export function useShelf(slots, slot, held) {
  const cur = Array.from({ length: SHELF_SLOTS }, (_, i) => (slots && slots[i]) || null);
  if (held) {
    if (!canShelve(held)) return null;
    const s = slot >= 0 && !cur[slot] ? slot : slot >= 0 ? -1 : cur.findIndex((x) => !x);
    if (s < 0 || cur[s]) return null;
    cur[s] = cleanShelved(held);
    return { slots: cur, put: s, took: null };
  }
  let s = slot;
  if (s < 0 || !cur[s]) s = slot >= 0 ? -1 : cur.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
  if (s < 0 || !cur[s]) return null;
  const took = cur[s]; cur[s] = null;
  return { slots: cur, put: null, took };
}
