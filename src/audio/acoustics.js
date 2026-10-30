// Room acoustics and rain on roofs (pure logic, no Web Audio).
//  - measureRoom() fires a fixed fan of rays from the listener's head and
//    reports how enclosed the space is and how far away the walls are; the
//    audio engine maps that to a reverb send (a closet barely echoes, a cave
//    rings, a Great Rift booms) and a damping filter (stone bright, wood and
//    wool dull).
//  - roofMaterial() finds what is over the player's head so rain drums on it
//    with the right voice: glass pings, wood knocks, stone ticks, leaves hush.
// One call costs about 14 rays x up to 24 steps and runs once a second.

export const RAY_RANGE = 24;
const FLOOR_RAY = -0.35;  // rays pointing more steeply down than this are not measured

// 14 directions spread over the sphere (golden-angle spiral), with the first one straight up
export const ROOM_RAYS = (() => {
  const n = 14, out = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * 2.399963;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  out[0] = [0, 1, 0];
  return out;
})();

/** Materials that soak sound up. */
const SOFT = new Set(['wood', 'wool', 'grass', 'snow', 'sand', 'mud', 'gravel']);

/**
 * `matAt(x, y, z)` returns the sound material of a solid block ('stone', 'wood'...) or null when
 * the cell lets sound through. Returns { openness 0..1, meanDist, soft 0..1 }: openness is the
 * share of rays that left the room without hitting anything inside RAY_RANGE.
 */
export function measureRoom(matAt, x, y, z, range = RAY_RANGE) {
  let open = 0, hits = 0, sum = 0, soft = 0, n = 0;
  for (const [dx, dy, dz] of ROOM_RAYS) {
    if (dy < FLOOR_RAY) continue; // the ground is always there: only the ceiling and walls decide how enclosed a spot is
    n++;
    let hit = null, d = 0.5;
    for (; d <= range; d += 1) {
      const m = matAt(Math.floor(x + dx * d), Math.floor(y + dy * d), Math.floor(z + dz * d));
      if (m) { hit = m; break; }
    }
    if (hit) { hits++; sum += d; if (SOFT.has(hit)) soft++; } else open++;
  }
  return { openness: open / n, meanDist: hits ? sum / hits : range, soft: hits ? soft / hits : 0 };
}

/** Reverb tails (seconds) the engine keeps impulse responses for. */
export const REVERB_DECAYS = [0.5, 1.1, 2.2, 3.6];

/**
 * Reverb settings for a measured room: `wet` is the send level (0 in the open), `bucket` indexes
 * REVERB_DECAYS (small room, cave, hall, chasm) and `damp` is the lowpass (Hz) on the reverb return.
 */
export function reverbFor(room) {
  const enclosed = 1 - room.openness;
  if (enclosed < 0.25) return { wet: 0, bucket: 0, damp: 9000 };
  const size = Math.min(1, room.meanDist / 16);
  const bucket = room.meanDist < 3.5 ? 0 : room.meanDist < 8 ? 1 : room.meanDist < 15 ? 2 : 3;
  // a small closet adds a touch of body; a big enclosed cavern gets the full wash
  const wet = Math.min(0.7, Math.pow(enclosed, 1.4) * (0.14 + 0.5 * size));
  const damp = 9000 - room.soft * 5800;
  return { wet, bucket, damp };
}

// How rain sounds on what is overhead: a bandpassed hiss for the steady wash plus droplet ticks.
export const ROOF_VOICES = {
  stone: { freq: 650, q: 0.9, gain: 0.13, tick: { freq: 1400, q: 3, gain: 0.07, rate: 7 } },
  wood: { freq: 900, q: 0.9, gain: 0.15, tick: { freq: 520, q: 4, gain: 0.1, rate: 9 } },
  glass: { freq: 2400, q: 1.2, gain: 0.2, tick: { freq: 3800, q: 6, gain: 0.08, rate: 11 } },
  metal: { freq: 1900, q: 1.1, gain: 0.2, tick: { freq: 2600, q: 8, gain: 0.09, rate: 12 } },
  grass: { freq: 1500, q: 0.5, gain: 0.1, tick: { freq: 1900, q: 1.5, gain: 0.03, rate: 14 } }, // leaves and thatch: a soft hush
  wool: { freq: 380, q: 0.7, gain: 0.07, tick: { freq: 420, q: 1.2, gain: 0.02, rate: 5 } },
  snow: { freq: 320, q: 0.6, gain: 0.05, tick: { freq: 380, q: 1, gain: 0.01, rate: 3 } },
  sand: { freq: 700, q: 0.7, gain: 0.1, tick: { freq: 1200, q: 2, gain: 0.04, rate: 6 } },
  gravel: { freq: 800, q: 0.8, gain: 0.11, tick: { freq: 1300, q: 2, gain: 0.05, rate: 7 } },
  mud: { freq: 380, q: 0.7, gain: 0.07, tick: { freq: 420, q: 1.2, gain: 0.02, rate: 4 } },
};

/** The voice for a material name (anything unknown drums like stone). */
export function roofVoice(mat) { return (mat && ROOF_VOICES[mat]) || ROOF_VOICES.stone; }

/**
 * The first solid material above (x, y, z) within `up` blocks and how many blocks above the head it
 * is, or null when the sky is open. `matAt` is as for measureRoom.
 */
export function roofMaterial(matAt, x, y, z, up = 40) {
  for (let d = 1; d <= up; d++) {
    const m = matAt(x, y + d, z);
    if (m) return { mat: m, depth: d };
  }
  return null;
}

/**
 * Overall rain loudness for a listener under a roof: full under a thin roof, fading to nothing
 * once the rock overhead is deep enough (~24 blocks).
 */
export function rainUnderCover(roof) {
  if (!roof) return 1;
  const t = Math.min(1, Math.max(0, (roof.depth - 4) / 20));
  return 1 - t * t * (3 - 2 * t);
}
