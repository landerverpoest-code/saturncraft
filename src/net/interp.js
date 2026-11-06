// Smoothing of remote movement. Snapshots arrive about every 100 ms with jitter; showing the newest one at once
// makes things stutter, so each thing is shown a little in the past (the render delay), between the two snapshots
// that bracket that moment, and carried on a short way by its own speed when the next one is late. Pure.

const lerp = (a, b, f) => a + (b - a) * f;
function lerpAngle(a, b, f) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

export const EXTRAPOLATE_MAX_MS = 200; // how long a late snapshot is covered by dead reckoning
export const DELAY_MIN = 90, DELAY_MAX = 400;

/** Arrival statistics -> the render delay (about two snapshot intervals plus the jitter seen). */
export class JitterEstimator {
  constructor() { this.interval = 100; this.jitter = 0; this.last = 0; }
  push(now) {
    if (this.last) {
      const dt = now - this.last;
      if (dt > 0 && dt < 2000) {
        this.interval += (dt - this.interval) * 0.1;
        this.jitter += (Math.abs(dt - this.interval) - this.jitter) * 0.1;
      }
    }
    this.last = now;
  }
  get delay() { return Math.max(DELAY_MIN, Math.min(DELAY_MAX, this.interval * 1.6 + this.jitter * 2)); }
}

/** Buffered snapshots of one player: { t (arrival ms), x, y, z, yaw, pitch }. */
export class SnapshotBuffer {
  constructor() { this.snaps = []; this.est = new JitterEstimator(); }
  push(s, now) {
    this.est.push(now);
    const last = this.snaps[this.snaps.length - 1];
    // a jump (teleport, respawn, a new dimension) must not be glided through
    const jump = last && Math.hypot(s.x - last.x, s.y - last.y, s.z - last.z) > 12;
    if (jump) this.snaps.length = 0;
    this.snaps.push({ t: now, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch });
    if (this.snaps.length > 12) this.snaps.shift();
  }
  get delay() { return this.est.delay; }
  /** Where to show the thing at time `now`: { x, y, z, yaw, pitch, extrapolated } or null with no data. */
  sample(now) {
    const a = this.snaps;
    if (!a.length) return null;
    const rt = now - this.delay;
    if (rt <= a[0].t) return { ...a[0], extrapolated: false };
    for (let i = a.length - 1; i > 0; i--) {
      if (a[i - 1].t <= rt && rt <= a[i].t) {
        const p = a[i - 1], q = a[i], f = (rt - p.t) / Math.max(1, q.t - p.t);
        return { x: lerp(p.x, q.x, f), y: lerp(p.y, q.y, f), z: lerp(p.z, q.z, f), yaw: lerpAngle(p.yaw, q.yaw, f), pitch: lerp(p.pitch, q.pitch, f), extrapolated: false };
      }
    }
    // later than the newest snapshot: carry on with the last velocity, for a short while
    const q = a[a.length - 1], p = a.length > 1 ? a[a.length - 2] : null;
    if (!p) return { ...q, extrapolated: false };
    const dt = Math.max(1, q.t - p.t), ahead = Math.min(rt - q.t, EXTRAPOLATE_MAX_MS);
    const vx = (q.x - p.x) / dt, vz = (q.z - p.z) / dt;
    return { x: q.x + vx * ahead, y: q.y, z: q.z + vz * ahead, yaw: q.yaw, pitch: q.pitch, extrapolated: true };
  }
}

/**
 * Mobs and other host entities: the snapshot position `s` plus its speed (blocks per ms, from the last two
 * snapshots) carried on `age` ms, capped. Returns [x, y, z].
 */
export function deadReckon(s, vel, ageMs) {
  if (!vel) return [s.x, s.y, s.z];
  const a = Math.max(0, Math.min(ageMs, EXTRAPOLATE_MAX_MS));
  return [s.x + vel.x * a, s.y, s.z + vel.z * a];
}
/** Speed between two snapshots `dtMs` apart (null for a jump or a tiny interval). */
export function velocityBetween(prev, cur, dtMs) {
  if (!prev || dtMs < 30 || dtMs > 1500) return null;
  const dx = cur.x - prev.x, dz = cur.z - prev.z;
  if (Math.hypot(dx, dz) > 8) return null;
  return { x: dx / dtMs, z: dz / dtMs };
}
