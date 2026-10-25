// Bundles (reference: bundle): a pouch holding up to 64 "weight" of mixed items in
// stack.bundle (a list, the last one put in at the end). An item weighs 64 / its
// stack size, so a bundle holds one full stack of anything, or 16 Void Pearls,
// or a single tool; a bundle inside a bundle weighs 4 plus what it carries.
import { ITEMS, maxStack } from './items.js';
import { canStack } from './enchantments.js';

export const BUNDLE_CAPACITY = 64;

/** Weight of one item of this stack. */
export function itemWeight(st) {
  if (!st) return 0;
  const d = ITEMS[st.id];
  if (d && d.bundle) return 4 + bundleWeight(st.bundle);
  return BUNDLE_CAPACITY / Math.max(1, maxStack(st.id));
}

/** Total weight of a bundle's contents. */
export function bundleWeight(list) {
  let w = 0;
  if (Array.isArray(list)) for (const s of list) if (s) w += itemWeight(s) * s.count;
  return w;
}

/** How many items of `st` still fit in the bundle stack `bundle`. */
export function bundleRoom(bundle, st) {
  if (!st || !bundle || !ITEMS[bundle.id] || !ITEMS[bundle.id].bundle) return 0;
  if (st === bundle) return 0;
  // an empty bundle may go in; a full one (or the bundle itself) never
  const d = ITEMS[st.id];
  if (d && d.bundle && Array.isArray(st.bundle) && st.bundle.length) return 0;
  const per = itemWeight(st);
  const free = BUNDLE_CAPACITY - bundleWeight(bundle.bundle);
  return Math.max(0, Math.min(st.count, Math.floor(free / per + 1e-9)));
}

/**
 * Put as much of `st` as fits into `bundle` (both stacks are changed in place).
 * Matching contents grow (and move to the end, so they come out first). Returns how many went in.
 */
export function bundleInsert(bundle, st) {
  const n = bundleRoom(bundle, st);
  if (n <= 0) return 0;
  const list = bundle.bundle || (bundle.bundle = []);
  const i = list.findIndex((s) => canStack(s, st) && s.count < maxStack(s.id));
  let left = n;
  if (i >= 0) {
    const s = list[i], k = Math.min(left, maxStack(s.id) - s.count);
    s.count += k; left -= k;
    list.splice(i, 1); list.push(s);
  }
  if (left > 0) list.push({ ...st, count: left });
  st.count -= n;
  return n;
}

/** Take the last stack put into the bundle out (null when empty). */
export function bundleTakeLast(bundle) {
  const list = bundle && bundle.bundle;
  if (!Array.isArray(list) || !list.length) return null;
  const s = list.pop();
  if (!list.length) delete bundle.bundle;
  return s;
}

/** How full a bundle is, 0..1 (for the bar on its slot). */
export const bundleFill = (bundle) => Math.min(1, bundleWeight(bundle && bundle.bundle) / BUNDLE_CAPACITY);
