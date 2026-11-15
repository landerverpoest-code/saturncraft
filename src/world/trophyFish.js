// The weight of a Trophy fish: `stack.trophy` (kilograms, tenths). A stack extra like stack.broth: kept by withExtras, canStack, the network's
// item and slot copies and the saves. Imports nothing, so enchantments, protocol and the UI can all use it.

/** The lightest and heaviest weight a stack may claim (untrusted data is clamped into this). */
export const TROPHY_MIN = 3, TROPHY_MAX = 12;
/** A valid weight (tenths of a kilogram) from untrusted data, or 0. */
export function cleanTrophy(w) {
  if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) return 0;
  return Math.round(Math.max(TROPHY_MIN, Math.min(TROPHY_MAX, w)) * 10) / 10;
}
export const sameTrophy = (a, b) => (cleanTrophy(a) || 0) === (cleanTrophy(b) || 0);
/** Tooltip line, e.g. "Trophy, 4.2 kg". */
export const trophyLine = (st) => { const w = cleanTrophy(st && st.trophy); return w ? `Trophy, ${w.toFixed(1)} kg` : ''; };
