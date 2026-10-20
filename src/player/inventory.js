// Slot-based inventory. Stacks are {id, count, damage?, ench?, rw?} (see world/enchantments.js).
import { maxStack, ITEMS } from '../world/items.js';
import { canStack, durabilityLoss } from '../world/enchantments.js';

export function stack(id, count = 1, damage = 0) { return { id, count, damage }; }
/** Can these two stacks merge? (same item, no durability, same enchantments) */
export const sameItem = canStack;

export class Inventory {
  constructor(size = 36) {
    this.slots = new Array(size).fill(null);
    this.armor = [null, null, null, null]; // helmet, chestplate, leggings, boots
    this.creative = false;                 // creative: using items never consumes or wears them
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
        if (canStack(s, st) && s.count < max) {
          const n = Math.min(left, max - s.count);
          s.count += n; left -= n;
        }
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, max);
        this.slots[i] = { ...st, count: n, damage: st.damage || 0 };
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
    if (this.creative) return { ...s, count: Math.min(n, s.count) };
    const taken = { ...s, count: Math.min(n, s.count) };
    s.count -= taken.count;
    if (s.count <= 0) this.slots[i] = null;
    this.changed();
    return taken;
  }

  /** Damage the tool in the selected slot; returns true if it broke. */
  damageSelected(amount = 1, rng = Math.random) {
    const s = this.selectedStack;
    if (this.creative) return false;
    if (!s) return false;
    const d = ITEMS[s.id];
    if (!d || !d.durability) return false;
    amount = durabilityLoss(s, amount, rng); // Steadfast may spare it
    if (!amount) return false;
    s.damage = (s.damage || 0) + amount;
    if (s.damage >= d.durability) { this.slots[this.selected] = null; this.changed(); return true; }
    this.changed();
    return false;
  }

  clear() { this.slots.fill(null); this.armor.fill(null); this.changed(); }
}
