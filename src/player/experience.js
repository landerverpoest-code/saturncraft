// Experience levels and orb values, following the reference curve.

/** Points needed to go from `level` to level + 1. */
export function xpToNextLevel(level) {
  if (level >= 31) return 9 * level - 158;
  if (level >= 16) return 5 * level - 38;
  return 2 * level + 7;
}

/** Add points to an {level, points} record (points = progress within the level). */
export function addXp(xp, amount) {
  xp.total += amount;
  xp.points += amount;
  let levelled = false;
  while (xp.points >= xpToNextLevel(xp.level)) { xp.points -= xpToNextLevel(xp.level); xp.level++; levelled = true; }
  return levelled;
}

export function newXp() { return { level: 0, points: 0, total: 0 }; }

// Orb sizes an amount is split into (largest first).
const ORB_SIZES = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
export function splitOrbs(amount) {
  const out = [];
  while (amount > 0) {
    const v = ORB_SIZES.find((s) => s <= amount);
    out.push(v); amount -= v;
  }
  return out;
}

/** Experience dropped on death: 7 per level, at most 100. */
export function deathXp(level) { return Math.min(100, 7 * level); }

/** Spend whole levels (enchanting, anvil); the progress bar is kept (clamped to the new level). */
export function spendLevels(xp, n) {
  let removed = 0;
  for (let k = 0; k < n && xp.level > 0; k++) { xp.level--; removed += xpToNextLevel(xp.level); }
  xp.points = Math.min(xp.points, xpToNextLevel(xp.level) - 1);
  xp.total = Math.max(0, xp.total - removed);
}
