// A light item ledger for what a guest puts into the shared world. Pure (no network, no DOM), so it is unit-tested.
//
// A guest keeps its own inventory (it saves it itself and mines, crafts and trades on its own machine), so the host can
// not prove that a stack is real. What it can do is notice a guest that gives the world far more of one kind than it
// could plausibly have in hand: the guest's last inventory copy (`ps`, every 5 s) plus what the host handed it since
// (pickups, things taken out of containers) plus an allowance for what it made on its own side in the meantime (mining,
// crafting, trading, smelting). The numbers are generous on purpose: a person who empties a whole inventory onto the
// ground, or mines for a minute and throws the lot away, stays far below them; a loop that drops the same stack over
// and over, or a box that "unpacks" a chest full of diamonds nobody carried, does not.
//
// "Putting into the world" means: a dropped stack, an item laid on a frame or campfire, the contents of a Gloomshell Box
// that is set down. A failed check is simply not carried out (the guest is told once). Creative-mode guests are never
// checked: they can produce any item. Stacks inside boxes and bundles count (a box in the inventory holds its items).
import { ITEMS, maxStack } from '../world/items.js';

export const LEDGER_WINDOW_MS = 6000;   // drops and grants older than this stop counting (a little over the 5 s inventory copy)
export const ALLOW_PER_KIND = 192;      // items of one kind a guest may have made on its side within a window (three stacks)
export const ALLOW_SMALL = 8;           // the same for single items laid on a frame or campfire
export const ALLOW_TOTAL = 4608;        // items of all kinds put into the world within a window (two full inventories)
export const MAX_DROP = 64;             // no stack is ever bigger than this

/** Is this a stack that can exist at all? Count within the item's stack limit, tools single, wear within the durability. */
export function plausibleStack(st) {
  if (!st || !Number.isInteger(st.id) || !ITEMS[st.id]) return false;
  const d = ITEMS[st.id];
  if (!Number.isInteger(st.count) || st.count < 1 || st.count > Math.min(MAX_DROP, maxStack(st.id))) return false;
  if (st.damage !== undefined && (!Number.isFinite(st.damage) || st.damage < 0 || (d.durability && st.damage > d.durability))) return false;
  return true;
}

/** Item id -> how many of it the stacks hold, the contents of boxes inside them included (three levels deep at most). */
export function tally(stacks, into = new Map(), depth = 0) {
  if (!Array.isArray(stacks) || depth > 2) return into;
  for (const s of stacks) {
    if (!s || !Number.isInteger(s.id) || !(s.count > 0)) continue;
    into.set(s.id, (into.get(s.id) || 0) + Math.floor(s.count));
    if (Array.isArray(s.contents)) tally(s.contents, into, depth + 1);
  }
  return into;
}

/** How many of item `id` a list of inventory slots holds (boxes' contents included). */
export const countIn = (slots, id) => tally(slots).get(id) || 0;

export class GuestLedger {
  constructor() {
    this.held = new Map();   // item id -> count in the last inventory copy
    this.events = [];        // [time, id, n, kind] kind: 'drop' | 'grant'
    this.denied = 0;         // checks failed so far
    this.warned = false;
  }

  /** The guest's inventory copy (the `ps` message's slots). */
  setHeld(slots) { this.held = tally(slots); }

  prune(now) {
    const keep = now - LEDGER_WINDOW_MS;
    let i = 0;
    while (i < this.events.length && this.events[i][0] < keep) i++;
    if (i) this.events.splice(0, i);
  }

  /** The host handed the guest `n` of `id` (a pickup, something taken out of a chest...). */
  grant(id, n, now) {
    if (!(n > 0)) return;
    this.events.push([now, id, Math.floor(n), 'grant']);
    this.prune(now);
  }

  /** The host handed the guest this stack (and, for a box, what is inside it). */
  grantStack(st, now) { for (const [id, n] of tally([st])) this.grant(id, n, now); }

  sum(id, kind) {
    let n = 0;
    for (const e of this.events) if (e[3] === kind && (id === null || e[1] === id)) n += e[2];
    return n;
  }

  /**
   * May the guest put these stacks into the world now? All or nothing: records them when they pass. `creative` guests
   * always may. `allow` is the slack per kind for what the guest made since its last inventory copy.
   */
  allowMany(stacks, now, creative = false, allow = ALLOW_PER_KIND) {
    this.prune(now);
    const want = tally(stacks);
    let total = this.sum(null, 'drop');
    for (const [, n] of want) total += n;
    if (!creative) {
      let ok = total <= ALLOW_TOTAL;
      for (const [id, n] of want) {
        if (this.sum(id, 'drop') + n > (this.held.get(id) || 0) + this.sum(id, 'grant') + allow) ok = false;
      }
      if (!ok) { this.denied++; return false; }
    }
    for (const [id, n] of want) this.events.push([now, id, n, 'drop']);
    return true;
  }

  /** One stack: a dropped item. */
  allowDrop(id, count, now, creative = false, allow = ALLOW_PER_KIND) { return this.allowMany([{ id, count }], now, creative, allow); }
}
