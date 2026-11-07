// Trinkets: charms worn in two slots beside the armour (inventory screen). Each kind works once however many are
// worn, and only while it sits in a slot. The effects are passive numbers that player/gear.js adds up with the armour
// set bonuses; the places that use them (speed, item pull, damage, mining, light) read them from there.
// A guest's trinkets are part of its own player data, so its effects run in its own game; what touches the host's
// world (the pull on dropped items) goes through the usual `take` request, which the host checks.
import { ITEMS } from '../world/items.js';

export const TRINKET_SLOTS = 2;

/** kind -> { name, desc, bonus }  (bonus keys are the ones player/gear.js knows) */
export const TRINKETS = {
  fleet_anklet:    { name: 'Fleet Anklet',    desc: 'Walk and run 12% faster.', bonus: { speed: 0.12 } },
  lodestone_charm: { name: 'Lodestone Charm', desc: 'Pulls dropped items and experience towards you from 6 blocks.', bonus: { pull: 6 } },
  warding_amulet:  { name: 'Warding Amulet',  desc: 'Takes 15% off damage from creatures, arrows, blasts and magic.', bonus: { ward: 0.15 } },
  miners_loupe:    { name: "Miner's Loupe",   desc: 'Ores break 25% faster and give 20% more experience.', bonus: { mineOre: 0.25, oreXp: 0.2 } },
  lantern_charm:   { name: 'Lantern Charm',   desc: 'A soft light follows you, as from a torch in the hand.', bonus: { light: 12 } },
  ember_band:      { name: 'Ember Band',      desc: 'Fire, lava and burning hurt 45% less.', bonus: { fireResist: 0.45 } },
};
export const TRINKET_KINDS = Object.keys(TRINKETS);

/** The trinket kind of a stack, or null. */
export function trinketKind(st) {
  const d = st && ITEMS[st.id];
  return d && d.trinket && TRINKETS[d.trinket] ? d.trinket : null;
}
export const isTrinket = (st) => trinketKind(st) !== null;

/** The distinct kinds in a list of trinket slots (two of a kind count once). */
export function wornKinds(list) {
  const out = [];
  for (const st of list || []) { const k = trinketKind(st); if (k && !out.includes(k)) out.push(k); }
  return out;
}

/** A clean slot list from saved or networked data: TRINKET_SLOTS entries, each a trinket stack or null (missing = no trinkets). */
export function cleanTrinkets(raw) {
  const out = new Array(TRINKET_SLOTS).fill(null);
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < TRINKET_SLOTS; i++) {
    const st = raw[i];
    if (st && Number.isInteger(st.id) && trinketKind(st)) out[i] = { id: st.id, count: 1, damage: 0 };
  }
  return out;
}

/** Tooltip lines of a trinket stack. */
export function trinketLines(st) {
  const k = trinketKind(st);
  return k ? [TRINKETS[k].desc, 'Worn in a trinket slot.'] : [];
}
