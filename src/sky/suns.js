// Three-sun orbital model. Each sun moves on a great-circle path defined by
// its own period, starting phase, rise azimuth, orbital tilt and declination
// offset. Pure math (no three.js) so it can be unit-tested and shared by the
// renderer, the lighting uniforms and mob logic.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export const SUNS = [
  {
    key: 'hearth', name: 'Hearth', period: 24000, phase: 0.02,
    riseAzimuth: 90 * DEG, tilt: 20 * DEG, declination: 0.04,
    colorTemp: 5600, intensity: 1.0, size: 1.0, shadowStrength: 1.0,
  },
  {
    key: 'pale', name: 'Pale Warden', period: 37200, phase: 0.6,
    riseAzimuth: 62 * DEG, tilt: 38 * DEG, declination: -0.16,
    colorTemp: 11000, intensity: 0.55, size: 0.55, shadowStrength: 0.7,
  },
  {
    key: 'ember', name: 'Ember', period: 15400, phase: 0.33,
    riseAzimuth: 128 * DEG, tilt: 52 * DEG, declination: -0.08,
    colorTemp: 2700, intensity: 0.45, size: 1.6, shadowStrength: 0.6,
  },
];

/** Blackbody colour temperature (K) to linear-ish RGB in 0..1. */
export function kelvinToRGB(k) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v) => Math.max(0, Math.min(255, v)) / 255;
  return [c(r), c(g), c(b)];
}

/** Orbital angle (radians) of a sun at world time t (ticks). */
export function sunAngle(sun, t) {
  return TAU * (((t / sun.period + sun.phase) % 1 + 1) % 1);
}

/** Unit direction from the observer towards the sun. y is up, -z is north, +x is east. */
export function sunDirection(sun, t, out = [0, 0, 0]) {
  const th = sunAngle(sun, t);
  const A = sun.riseAzimuth;
  const R = [Math.sin(A), 0, -Math.cos(A)];          // rise point on horizon
  const S = [Math.cos(A), 0, Math.sin(A)];           // horizontal, perpendicular
  const ct = Math.cos(sun.tilt), st = Math.sin(sun.tilt);
  const V = [st * S[0], ct, st * S[2]];              // culmination direction
  const c = Math.cos(th), s = Math.sin(th);
  let x = c * R[0] + s * V[0];
  let y = c * R[1] + s * V[1] + sun.declination;
  let z = c * R[2] + s * V[2];
  const l = Math.hypot(x, y, z);
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return out;
}

/** Fraction of each orbit spent above the horizon. */
export function daylightFraction(sun) {
  const k = -sun.declination / Math.cos(sun.tilt);
  if (k <= -1) return 1;
  if (k >= 1) return 0;
  return 0.5 - Math.asin(k) / Math.PI;
}

/** Sunlight contribution (0..intensity) from elevation with a soft twilight band. */
export function sunlightFactor(sun, elevation) {
  const e0 = -0.1, e1 = 0.22;
  let t = (elevation - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return sun.intensity * t * t * (3 - 2 * t);
}

/**
 * Full sky state at world time t.
 * @returns {{suns: Array, aboveCount: number, phase: 'day'|'twilight'|'night', isDay: boolean,
 *   combined: number, skyDarken: number, lightColor: number[], sunlit: boolean}}
 */
export function skyState(t, suns = SUNS) {
  const list = [];
  let above = 0, dark = 1;
  const col = [0, 0, 0];
  let wsum = 0;
  for (const sun of suns) {
    const dir = sunDirection(sun, t);
    const elevation = dir[1];
    const isUp = elevation > 0;
    if (isUp) above++;
    const f = sunlightFactor(sun, elevation);
    dark *= 1 - f;
    const rgb = kelvinToRGB(sun.colorTemp);
    col[0] += rgb[0] * f; col[1] += rgb[1] * f; col[2] += rgb[2] * f;
    wsum += f;
    list.push({ sun, dir, elevation, isUp, factor: f, color: rgb });
  }
  const combined = 1 - dark;
  const lightColor = wsum > 0 ? [col[0] / wsum, col[1] / wsum, col[2] / wsum] : [0.6, 0.7, 1];
  // Same 0..11 scale as the reference game's sky darkening
  const skyDarken = Math.round(11 * (1 - Math.min(1, combined)));
  const phase = above === 0 ? 'night' : above === 1 ? 'twilight' : 'day';
  return {
    suns: list, aboveCount: above, phase, isDay: above >= 1, combined, skyDarken,
    lightColor, sunlit: skyDarken < 4,
  };
}

/** Effective sky light level (0..15) at a block with raw sky light `raw`. */
export function effectiveSkyLight(raw, skyDarken) {
  return Math.max(0, raw - skyDarken);
}

/** First time >= t0 where the phase equals `phase` (search with given step). */
export function findNextPhase(t0, phase, step = 50, limit = 2_000_000) {
  for (let t = t0; t < t0 + limit; t += step) if (skyState(t).phase === phase) return t;
  return -1;
}
