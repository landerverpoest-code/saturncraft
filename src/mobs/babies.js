// Baby variants of hostile mobs (spiderlings, Fizzlets, Brute cubs; Shambler-kin keep their own
// rules in hostileVariants.js). A mob type opts in with `babyChance` (the share that spawn as
// babies) and `babyStats` on its definition:
//   speed     - walking speed factor            (Shambler-kin babies: 1.5)
//   attack    - melee damage factor
//   health    - health factor (rounded, at least 1)
//   explosion - blast radius factor (Fizzlers)
//   loot      - 'half' (every stack halved, rounded down) | 'none'; unset keeps the full loot
//   xp        - experience for a player kill (adults give 5, Shambler-kin babies 12)
// Babies are half size (Mob.setBaby), never grow up and are drawn at half scale.

export const DEFAULT_BABY_SPEED = 1.5;
export const ADULT_MONSTER_XP = 5;
export const SHAMBLER_BABY_XP = 12;

const stats = (def) => (def && def.babyStats) || null;

/** Walking speed factor of a baby of this definition (1 for adults is the caller's business). */
export const babySpeedFactor = (def) => (stats(def) && stats(def).speed) || (def && def.babyChance ? DEFAULT_BABY_SPEED : 1);

/** Melee damage factor of a baby. */
export const babyAttackFactor = (def) => (stats(def) && stats(def).attack) || 1;

/** Health of a baby of this definition at spawn. */
export const babyHealth = (def) => (stats(def) && stats(def).health ? Math.max(1, Math.round(def.health * stats(def).health)) : def.health);

/** Blast radius of a Fizzler: babies go off with a smaller bang. */
export const babyExplosion = (def, baby) => (baby && stats(def) && stats(def).explosion ? def.explosionPower * stats(def).explosion : def.explosionPower);

/** Experience for killing a baby monster. */
export const babyXp = (def) => (stats(def) && stats(def).xp !== undefined ? stats(def).xp : SHAMBLER_BABY_XP);

/**
 * The drops of a dead baby: the adult roll made smaller. `mode` is 'half' (each stack halved,
 * rounded down; stacks that reach 0 vanish), 'none' or anything else for the full roll.
 */
export function babyLoot(drops, mode) {
  if (mode === 'none') return [];
  if (mode !== 'half') return drops;
  const out = [];
  for (const d of drops) {
    const n = Math.floor(d.count / 2);
    if (n > 0) out.push({ ...d, count: n });
  }
  return out;
}

/** Does this definition have baby variants of its own (not Shambler-kin)? */
export const hasBabyVariant = (def) => !!(def && def.babyChance && stats(def));
