// Armour set bonuses: wearing two, three or four pieces of one set adds a bonus (shown in the tooltip of every piece
// of the set and on the inventory screen). Bonuses are cumulative: the four-piece set also has the two-piece bonus.
// The Dirgestep Boots count as the fourth piece of the Slagsteel set. Bonus keys are added up by player/gear.js.
import { ITEMS } from '../world/items.js';

export const SETS = {
  leather: { name: 'Wayfarer', tiers: [
    { n: 2, text: 'Walk 4% faster', b: { speed: 0.04 } },
    { n: 4, text: 'Sprinting costs 35% less hunger and you walk 4% faster again', b: { speed: 0.04, sprintSave: 0.35 } },
  ] },
  gold: { name: 'Gilded', tiers: [
    { n: 2, text: 'Tools, weapons and discs wear 20% less', b: { wearSave: 0.2 } },
    { n: 4, text: 'Plunder I on every weapon you swing', b: { plunder: 1 } },
  ] },
  iron: { name: 'Ironclad', tiers: [
    { n: 2, text: 'Knockback you take is cut by 35%', b: { knockResist: 0.35 } },
    { n: 3, text: '+1 protection against everything', b: { protect: 1 } },
    { n: 4, text: '+1 protection and knockback cut by 60% in all', b: { protect: 1, knockResist: 0.25 } },
  ] },
  diamond: { name: 'Gemguard', tiers: [
    { n: 2, text: '+1 protection against everything', b: { protect: 1 } },
    { n: 3, text: '+1 protection', b: { protect: 1 } },
    { n: 4, text: '+2 protection (4 in all)', b: { protect: 2 } },
  ] },
  slagsteel: { name: 'Forgewalker', tiers: [
    { n: 2, text: 'Fire, lava and burning hurt 35% less', b: { fireResist: 0.35 } },
    { n: 4, text: 'Fire, lava and burning hurt 80% less in all', b: { fireResist: 0.45 } },
  ] },
};
export const SET_KEYS = Object.keys(SETS);
/** Armour material -> set id */
export const MATERIAL_SET = { leather: 'leather', gold: 'gold', iron: 'iron', diamond: 'diamond', slagsteel: 'slagsteel', dirge: 'slagsteel' };
export const SET_PIECES = 4;

/** The set an armour item belongs to, or null. */
export function setOfItem(id) {
  const d = ITEMS[id];
  return d && d.armor ? MATERIAL_SET[d.armor.material] || null : null;
}

/** How many pieces of each set are worn: { setId: count } (only sets with at least one piece). */
export function countPieces(armor) {
  const n = {};
  for (const st of armor || []) { const s = st && setOfItem(st.id); if (s) n[s] = (n[s] || 0) + 1; }
  return n;
}

/** Bonus totals of the tiers a count has reached: { key: sum }. */
export function bonusFor(setId, count) {
  const out = {};
  const set = SETS[setId];
  if (set) for (const t of set.tiers) if (count >= t.n) for (const [k, v] of Object.entries(t.b)) out[k] = (out[k] || 0) + v;
  return out;
}

/** Worn sets as rows for the UI: [{ id, name, count, tiers: [{ n, text, active }] }], those with a piece worn. */
export function wornSets(armor) {
  const counts = countPieces(armor);
  return SET_KEYS.filter((k) => counts[k]).map((k) => ({ id: k, name: SETS[k].name, count: counts[k], tiers: SETS[k].tiers.map((t) => ({ n: t.n, text: t.text, active: counts[k] >= t.n })) }));
}

/** Tooltip lines of an armour piece's set: a header "Ironclad (2/4)" and one line per tier, marked when reached. */
export function setLines(id, armor = []) {
  const s = setOfItem(id);
  if (!s) return [];
  const set = SETS[s], count = countPieces(armor)[s] || 0;
  return [{ text: `${set.name} set (${count}/${SET_PIECES})`, head: true }, ...set.tiers.map((t) => ({ text: `(${t.n}) ${t.text}`, active: count >= t.n }))];
}
