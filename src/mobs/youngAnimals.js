// Young of the remaining animals: Buzzlings (flowers), Packhorns (wheat or hay), Gillnewts (glimmerfin),
// Dolphins (raw fish) and Frostbears (raw silverfin) breed like the farm animals do. Feed two grown ones
// their food and they walk (fly, swim) to each other and a baby appears: half size, no drops, a
// 5-minute cooldown for the parents, grown up after 20 minutes (feeding a baby speeds that up 10 %).
// Babies of a tame pair are tame and keep the owner. The mob snapshot already carries a baby flag
// (net/protocol.js MF.BABY), so guests see the small ones without a layout change.
// The farm animals do all of this inside Mob.passiveAI; the animals with an AI of their own call
// these helpers from it.

export const YOUNG_TYPES = ['buzzling', 'packhorn', 'gillnewt', 'dolphin', 'frostbear'];
export const GROW_UP_TICKS = 24000;     // a baby's age at birth (Mob.setBaby)
export const BREED_COOLDOWN = 6000;     // adults wait this long after a baby
export const LOVE_TICKS = 600;          // how long a fed adult stays in the mood
export const MATE_RANGE = 8;            // the partner must be this close (Mob.findMate)
export const BREED_TIME = 60;           // ticks spent close together before the baby arrives

/** Can this kind be bred by feeding it? Only animals with a breeding food of their own. */
export const canBreed = (def) => !!(def && def.food && def.food.length && !def.villager);

/** Is this mob a baby of one of the animals covered here? */
export const isYoung = (m) => !!m && m.age < 0 && YOUNG_TYPES.includes(m.type);

/** Advance a baby's growth (true on the tick it grows up) or an adult's breeding cooldown. */
export function growStep(m) {
  if (m.age < 0) {
    if (++m.age === 0) { m.setBaby(false); return true; }
  } else if (m.age > 0) m.age--;
  return false;
}

/** Move towards a point the way this animal moves: flying and swimming ones by velocity, the others on foot. */
export function approach(m, tx, ty, tz, speed = 1) {
  const free = m.def.flying || (m.body.inWater && (m.def.aquatic || m.def.dolphin || m.def.newt));
  const dx = tx - m.x, dz = tz - m.z;
  if (!free) { m.steer(tx, tz, speed); return; }
  const dy = ty - m.y, d = Math.hypot(dx, dy, dz) || 1, k = m.def.flying ? 0.06 : 0.03;
  m.body.vx += (dx / d) * k; m.body.vy += (dy / d) * k; m.body.vz += (dz / d) * k;
  m.yaw = Math.atan2(-dx, -dz);
}

/**
 * The mood and the mating of a fed adult. Returns true while it is busy with a partner (the caller
 * skips the rest of its AI that tick). Mirrors the breeding block of Mob.passiveAI.
 */
export function breedStep(m, g) {
  if (m.loveTicks <= 0) return false;
  m.loveTicks--;
  if (g.ticks % 10 === 0) m.hearts(g, 1);
  const mate = m.findMate(g);
  if (!mate) return false;
  const d = Math.hypot(mate.x - m.x, mate.z - m.z);
  if (d > 1.2) approach(m, mate.x, mate.y, mate.z, 1);
  if (d < 3 && ++m.breedTime >= BREED_TIME && m.id < mate.id) m.breed(g, mate);
  return true;
}
