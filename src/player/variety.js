// Food variety: eating something different from your last few meals gives a small saturation bonus. Looking back over
// the last VARIETY_WINDOW - 1 meals (most recent first) up to the first repeat, each distinct food eaten since this one
// last turned up adds VARIETY_STEP saturation, at most VARIETY_MAX; the same food twice in a row gives none. Foods with
// a drawback (rotten flesh, poison) neither give nor count.
export const VARIETY_WINDOW = 4;
export const VARIETY_STEP = 0.5;
export const VARIETY_MAX = 1.5;

/** Does a food (the item's `food` table) take part in the variety streak? */
export const countsForVariety = (food) => !!food && !food.effect;

/** The saturation bonus for eating `id` after the meals `recent` (oldest first, most recent last). */
export function varietyBonus(recent, id) {
  const list = Array.isArray(recent) ? recent : [];
  const seen = new Set();
  for (let k = list.length - 1; k >= 0 && seen.size < VARIETY_WINDOW - 1; k--) {
    if (list[k] === id || seen.has(list[k])) break; // a repeat ends the streak
    seen.add(list[k]);
  }
  if (list.length && list[list.length - 1] === id) return 0;
  return Math.min(VARIETY_MAX, seen.size * VARIETY_STEP);
}

/** The meal list after eating `id` (the last VARIETY_WINDOW meals are kept). */
export function recordMeal(recent, id) {
  const list = Array.isArray(recent) ? recent.slice() : [];
  list.push(id);
  return list.slice(-VARIETY_WINDOW);
}
