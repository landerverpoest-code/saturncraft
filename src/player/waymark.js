// The Waymark Compass: a compass whose needle points at the last Bounty Board you opened or the last waypoint you marked, instead of at the
// world's spawn. The waymark belongs to the player (it is saved with them, and a guest keeps their own); opening any Bounty Board replaces it,
// as does `/waymark here`, and `/wp add` in a shared world. Pure functions here; game.js stores it, render/overlays.js turns the needle.

export const WAYMARK_KINDS = ['board', 'waypoint', 'place'];
const COMPASS_POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** A cleaned waymark from untrusted data (a save), or null: { x, z, dim, kind, label }. */
export function cleanWaymark(w) {
  if (!w || typeof w !== 'object' || !Number.isFinite(w.x) || !Number.isFinite(w.z)) return null;
  if (Math.abs(w.x) > 3e7 || Math.abs(w.z) > 3e7) return null;
  return {
    x: Math.round(w.x * 10) / 10, z: Math.round(w.z * 10) / 10,
    dim: typeof w.dim === 'string' ? w.dim.slice(0, 24) : 'overworld',
    kind: WAYMARK_KINDS.includes(w.kind) ? w.kind : 'place',
    label: typeof w.label === 'string' ? w.label.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'Waymark' : 'Waymark',
  };
}

/**
 * The needle angle (radians, 0 = straight up the compass face) for a player at (px, pz) facing `yaw` in dimension `dim`, or null when there is
 * nothing to point at here (no waymark, or it lies in another dimension: the needle then spins like the Compass's).
 */
export function waymarkNeedle(wm, px, pz, yaw, dim = 'overworld') {
  if (!wm || wm.dim !== dim) return null;
  if (Math.hypot(wm.x - px, wm.z - pz) < 1.5) return null; // standing on it: the needle idles
  return -(Math.atan2(-(wm.x - px), -(wm.z - pz)) - yaw);
}

/** Distance in blocks to the waymark in the same dimension, or null. */
export function waymarkDistance(wm, px, pz, dim = 'overworld') {
  return wm && wm.dim === dim ? Math.hypot(wm.x - px, wm.z - pz) : null;
}

/** The compass point (name) the waymark lies in, seen from (px, pz); +z is south, +x east. */
export function waymarkBearing(wm, px, pz) {
  const a = Math.atan2(wm.x - px, -(wm.z - pz)); // 0 = north (-z), clockwise
  return COMPASS_POINTS[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}

/** A line for a toast or tooltip: "Oakhaven Bounty Board, 214 m south-east". */
export function describeWaymark(wm, px, pz, dim = 'overworld') {
  if (!wm) return 'No waymark yet: open a Bounty Board, or mark a place with /waymark here';
  const d = waymarkDistance(wm, px, pz, dim);
  if (d === null) return `${wm.label} (in another dimension)`;
  return d < 1.5 ? `${wm.label}, right here` : `${wm.label}, ${Math.round(d)} m ${waymarkBearing(wm, px, pz)}`;
}
