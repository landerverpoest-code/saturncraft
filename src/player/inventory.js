// Slot-based inventory. Stacks are {id, count, damage?}.
import { maxStack, ITEMS } from '../world/items.js';

export function stack(id, count = 1, damage = 0) { return { id, count, damage }; }
export function sameItem(a, b) { return a && b && a.id === b.id && !(ITEMS[a.id] && ITEMS[a.id].durability); }

export class Inventory {
  constructor(size = 36) {
    this.slots = new Array(size).fill(null);
    this.armor = [null, null, null, null]; // helmet, chestplate, leggings, boots
    this.selected = 0;
    this.listeners = [];
  }
  changed() { for (const f of this.listeners) f(); }

  get selectedStack() { return this.slots[this.selected]; }

  /** Add a stack; returns the number of items that did not fit. */
  add(st) {
    let left = st.count;
    const max = maxStack(st.id);
    if (!ITEMS[st.id] || !ITEMS[st.id].durability) {
      for (let i = 0; i < this.slots.length && left > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === st.id && s.count < max) {
          const n = Math.min(left, max - s.count);
          s.count += n; left -= n;
        }
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, max);
        this.slots[i] = { id: st.id, count: n, damage: st.damage || 0 };
        left -= n;
      }
    }
    if (left !== st.count) this.changed();
    return left;
  }

  count(id) { let n = 0; for (const s of this.slots) if (s && s.id === id) n += s.count; return n; }

  removeFromSlot(i, n = 1) {
    const s = this.slots[i];
    if (!s) return null;
    const taken = { id: s.id, count: Math.min(n, s.count), damage: s.damage };
    s.count -= taken.count;
    if (s.count <= 0) this.slots[i] = null;
    this.changed();
    return taken;
  }

  /** Damage the tool in the selected slot; returns true if it broke. */
  damageSelected(amount = 1) {
    const s = this.selectedStack;
    if (!s) return false;
    const d = ITEMS[s.id];
    if (!d || !d.durability) return false;
    s.damage = (s.damage || 0) + amount;
    if (s.damage >= d.durability) { this.slots[this.selected] = null; this.changed(); return true; }
    this.changed();
    return false;
  }

  clear() { this.slots.fill(null); this.armor.fill(null); this.changed(); }
}
