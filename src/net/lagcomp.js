// Lag compensation basics for the host (pure: no network, no DOM, unit-tested in tests/multiplayer_round6.test.js).
//
// A guest aims at what its screen shows, which is the host's world a little in the past (its ping plus the smoothing delay).
// So the host checks a guest's blows and arrows against where the mobs WERE: it keeps a short history of mob positions and
// rewinds them by the attacker's measured ping, never by more than REWIND_MAX_MS (a guest with a bad link cannot reach
// back further, so shooting round a corner stays impossible).

export const REWIND_MAX_MS = 200;
export const HISTORY_MS = 500;       // samples older than this are forgotten
export const MELEE_SLACK = 1.5;      // blocks of grace on top of the weapon's reach (feet, hitbox width, a position that lags a little)
export const MELEE_BASE_REACH = 3.0;

/** How far back to look for an attacker with this ping: 0 when unknown, at most REWIND_MAX_MS. */
export function rewindMs(ping) {
  const p = Number(ping);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return Math.min(REWIND_MAX_MS, Math.round(p));
}

/** Recent positions of entities by id: record() once per tick, at() asks where one was `backMs` ago. */
export class PositionHistory {
  constructor(spanMs = HISTORY_MS) { this.span = spanMs; this.map = new Map(); }

  /** `list`: [{ id, x, y, z }] as they are at `now` (ms). */
  record(now, list) {
    const seen = new Set();
    for (const e of list) {
      seen.add(e.id);
      let a = this.map.get(e.id);
      if (!a) { a = []; this.map.set(e.id, a); }
      const last = a[a.length - 1];
      if (last && last.t === now) { last.x = e.x; last.y = e.y; last.z = e.z; } else a.push({ t: now, x: e.x, y: e.y, z: e.z });
      const keep = now - this.span;
      let i = 0;
      while (i < a.length - 1 && a[i + 1].t < keep) i++;
      if (i) a.splice(0, i);
    }
    for (const id of this.map.keys()) if (!seen.has(id)) this.map.delete(id); // gone from the world
  }

  /** Where entity `id` was `backMs` before `now` (interpolated), or null when there is no record. */
  at(id, now, backMs) {
    const a = this.map.get(id);
    if (!a || !a.length) return null;
    const t = now - Math.max(0, Math.min(this.span, backMs));
    if (t >= a[a.length - 1].t) return { x: a[a.length - 1].x, y: a[a.length - 1].y, z: a[a.length - 1].z };
    if (t <= a[0].t) return { x: a[0].x, y: a[0].y, z: a[0].z };
    for (let i = a.length - 1; i > 0; i--) {
      if (a[i - 1].t <= t) {
        const p = a[i - 1], q = a[i], k = (t - p.t) / Math.max(1e-6, q.t - p.t);
        return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, z: p.z + (q.z - p.z) * k };
      }
    }
    return null;
  }

  get size() { return this.map.size; }
  clear() { this.map.clear(); }
}

/** Shortest distance from point (px, py, pz) to the box of a mob standing at (x, y, z) with this width and height. */
export function distToMobBox(px, py, pz, x, y, z, width = 0.6, height = 1.8) {
  const hw = width / 2;
  const dx = Math.max(x - hw - px, 0, px - (x + hw)), dy = Math.max(y - py, 0, py - (y + height)), dz = Math.max(z - hw - pz, 0, pz - (z + hw));
  return Math.hypot(dx, dy, dz);
}

/**
 * May this melee blow land? The attacker's eye must have been within the weapon's reach (plus MELEE_SLACK) of the mob's box
 * either where the mob is now or where it was `rewind` ms ago (the guest hit what it saw, so either place is fair).
 * `mob`: { x, y, z, width, height }; `past`: its rewound position or null.
 */
export function meleeHitOk(eye, mob, past, reach = MELEE_BASE_REACH) {
  const lim = reach + MELEE_SLACK;
  if (distToMobBox(eye[0], eye[1], eye[2], mob.x, mob.y, mob.z, mob.width, mob.height) <= lim) return true;
  return !!past && distToMobBox(eye[0], eye[1], eye[2], past.x, past.y, past.z, mob.width, mob.height) <= lim;
}
