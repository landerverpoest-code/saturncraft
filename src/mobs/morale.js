// Mob morale: wounded monsters lose their nerve and a hurt one calls its kin.
//  * Alarm: when a player hurts a Shambler, Rattler, Marauder or Hexwife, its
//    own kind within ALARM_RANGE blocks turn on that player and keep coming for
//    ALARM_TICKS even from beyond their usual sight range.
//  * Retreat: archers, Marauders (not those raiding a village) and Hexwives
//    that are down to a third of their health and fighting alone (fewer than
//    BRAVE_ALLIES healthy allies close by) turn and run for FLEE_TICKS - toward
//    the nearest healthy ally if there is one, otherwise straight away from the
//    player. A mob that is cornered (it stops making headway) turns to fight,
//    and one that has run once does not run again for COURAGE_TICKS.
// Melee brawlers (Shamblers, Skitterers) never run; Fizzlers, bosses and the
// other dimensions' mobs are not in the table. The decisions are pure
// functions (tested); moraleAI() ties them to a Mob.
export const ALARM_RANGE = 12;
export const ALARM_TICKS = 240;
export const FLEE_TICKS = 100;
export const FLEE_JITTER = 60;
export const COURAGE_TICKS = 500;
export const BRAVE_ALLIES = 2;
export const ALLY_RANGE = 12;
export const RALLY_RANGE = 24;
export const CORNERED_AFTER = 24;     // ticks of fleeing between checks for headway
export const CORNERED_PROGRESS = 0.6; // blocks it has to cover in those ticks

/** Per type: the family that answers its alarm, and the health fraction below which it runs (0: never). */
export const MORALE = {
  shambler: { family: 'shambler', alarm: true, flee: 0 },
  dune_shambler: { family: 'shambler', alarm: true, flee: 0 },
  rattler: { family: 'archer', alarm: true, flee: 1 / 3 },
  rime_rattler: { family: 'archer', alarm: true, flee: 1 / 3 },
  marauder: { family: 'marauder', alarm: true, flee: 1 / 3 },
  hexwife: { family: 'hexwife', alarm: false, flee: 0.3 },
};

export const familyOf = (type) => (MORALE[type] ? MORALE[type].family : null);

const alive = (e) => e && e.kind === 'mob' && !e.dead && e.deathTime === 0;

/** Which of `list` answer the alarm of `src`: same family, alive, within range, not raiding and not already alarmed. */
export function alarmRecipients(src, list, range = ALARM_RANGE) {
  const cfg = MORALE[src.type];
  if (!cfg || !cfg.alarm) return [];
  return list.filter((e) => e !== src && alive(e) && familyOf(e.type) === cfg.family && !e.raider &&
    (e.x - src.x) ** 2 + (e.z - src.z) ** 2 <= range * range && !(e.alarm > 0));
}

/** Healthy allies of the same family around `m`, not counting any that are running themselves. */
export function healthyAllies(m, list, range = ALLY_RANGE) {
  const fam = familyOf(m.type);
  return list.filter((e) => e !== m && alive(e) && familyOf(e.type) === fam && !(e.fleeing > 0) &&
    e.health > (e.maxHealth || e.def.health) * 0.5 && (e.x - m.x) ** 2 + (e.z - m.z) ** 2 <= range * range);
}

/** Should `m` turn and run now? `allies` is the number of healthy allies near it. */
export function shouldFlee(m, allies) {
  const cfg = MORALE[m.type];
  if (!cfg || !cfg.flee || m.raider || m.fleeing > 0 || m.courage > 0) return false;
  if (m.target !== 'player') return false;
  const max = m.maxHealth || m.def.health;
  if (!(m.health > 0) || m.health / max > cfg.flee) return false;
  return allies < BRAVE_ALLIES;
}

/** Where a fleeing mob heads: the nearest healthy ally that is farther from the player than it is, else straight away from the player. */
export function fleeGoal(m, player, allies) {
  let best = null, bd = RALLY_RANGE * RALLY_RANGE;
  const pm = (m.x - player.x) ** 2 + (m.z - player.z) ** 2;
  for (const a of allies) {
    const d = (a.x - m.x) ** 2 + (a.z - m.z) ** 2;
    const pa = (a.x - player.x) ** 2 + (a.z - player.z) ** 2;
    if (d > 16 && d < bd && pa > pm) { bd = d; best = a; }
  }
  if (best) return { x: best.x, z: best.z, rally: true };
  const dx = m.x - player.x, dz = m.z - player.z, l = Math.hypot(dx, dz) || 1;
  return { x: m.x + dx / l * 12, z: m.z + dz / l * 12, rally: false };
}

/** Has a running mob failed to make headway since `from` (where it was at the last check)? */
export function isCornered(m, from) {
  return Math.hypot(m.x - from.x, m.z - from.z) < CORNERED_PROGRESS;
}

/** Sound the alarm for a mob a player has just hurt (the recipients are marked and aimed at the player). Returns how many answered. */
export function soundAlarm(src, list, range = ALARM_RANGE) {
  const rec = alarmRecipients(src, list, range);
  for (const e of rec) { e.alarm = ALARM_TICKS; e.target = 'player'; }
  return rec.length;
}

/**
 * One tick of morale for a monster; returns true when it handled the mob's movement this tick
 * (running, or hurrying toward the player from outside its sight range).
 */
export function moraleAI(m, g, p, pdist) {
  const cfg = MORALE[m.type];
  if (!cfg) return false;
  if (m.courage > 0) m.courage--;
  if (m.alarm > 0) m.alarm--;
  const list = g.entities.list;
  if (m.fleeing > 0) {
    m.fleeing--;
    if (m.fleeing > 0 && m.fleeing % CORNERED_AFTER === 0 && m.fleeFrom) {
      if (isCornered(m, m.fleeFrom)) { m.fleeing = 0; m.courage = COURAGE_TICKS; m.fleeFrom = null; return false; } // cornered: it fights on
      m.fleeFrom = { x: m.x, z: m.z };
    }
    if (m.fleeing <= 0) { m.courage = COURAGE_TICKS; m.fleeFrom = null; m.path = null; return false; }
    if (p.dead || p.creative) { m.fleeing = 0; return false; }
    const goal = fleeGoal(m, p, healthyAllies(m, list, RALLY_RANGE));
    m.bowCharge = 0;
    m.path = null;
    m.steer(goal.x, goal.z, 1.2);
    return true;
  }
  if (!cfg.flee && !(m.alarm > 0)) return false;
  if (cfg.flee && (m._allies === undefined || g.ticks % 10 === m.id % 10)) m._allies = healthyAllies(m, list).length;
  if (shouldFlee(m, m._allies)) {
    m.fleeing = FLEE_TICKS + Math.floor(Math.random() * FLEE_JITTER);
    m.fleeFrom = { x: m.x, z: m.z };
    m.path = null; m.wander = null;
    if (g.particles) g.particles.emit(m.x, m.y + m.height + 0.2, m.z, 0, 0.05, 0, 0.9, 0.9, 0.9, 16, 0); // a pale puff over its head
    return true;
  }
  // called to arms: keeps coming for the player even beyond its usual sight range
  if (m.alarm > 0 && !p.dead && !p.creative && pdist > (m.def.followRange || 16) * 1.4) {
    m.target = 'player';
    m.chase(g, p, 1);
    m.tryMelee(g, p);
    return true;
  }
  return false;
}
