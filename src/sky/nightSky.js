// Night sky extras: Veilfire (aurora curtains in the north that grow stronger
// and more frequent the colder the biome) and falling stars (a streak now and
// then, and a dense Starfall on a few nights). All the decisions live here as
// pure functions so they are testable; the sky dome shader (skyShader.js) only
// draws what these hand it, and only when it is non-zero, so clear daytime
// frames cost nothing extra.

export const DAY_TICKS = 24000;

function hash(n) {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** How cold a biome is for the sky's purposes: 1 at or below 0 degrees, 0 from 0.7 up. */
export function coldness(temp) { return Math.min(1, Math.max(0, (0.7 - temp) / 0.7)); }

/**
 * What kind of night this is, decided from the day number alone (so everybody under the same sky
 * agrees and nothing needs saving): `veil` 0..1 is how lively the aurora is (0 on a third of the
 * nights), `starfall` marks the rare night of dense falling stars.
 */
export function nightCharacter(day) {
  const a = hash(day * 2 + 11), b = hash(day * 2 + 12), c = hash(day * 3 + 5);
  return { veil: a < 0.35 ? 0 : 0.4 + 0.6 * b, great: b > 0.9, starfall: c > 0.93 };
}

/**
 * Target aurora brightness 0..1 for a place and a moment. `temp` is the biome temperature,
 * `combined` the blended sunlight (0 at night), `rain` 0..1. Cold biomes see it most nights;
 * warm ones only on the great nights, and faintly.
 */
export function auroraTarget(temp, combined, rain, day) {
  const dark = Math.min(1, Math.max(0, 1 - combined * 3));
  if (dark <= 0 || rain >= 1) return 0;
  const n = nightCharacter(day);
  const base = 0.06 + 0.94 * coldness(temp);
  const v = Math.min(1, base * n.veil * (n.great ? 1.8 : 1));
  return v * dark * (1 - rain);
}

/** Seconds between falling stars on an ordinary night / a Starfall night. */
export const METEOR_GAP = [18, 55];
export const STARFALL_GAP = [1.2, 4];

/**
 * Schedules falling stars. update() returns the active streak (or null) as
 * { head: [x,y,z], tail: [x,y,z], glow 0..1 } on the unit sphere, y up, for the shader.
 */
export class Meteors {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.wait = METEOR_GAP[0] + rng() * (METEOR_GAP[1] - METEOR_GAP[0]);
    this.cur = null;
  }

  /** dt seconds, `dark` 0..1 (how night it is), `starfall` the night is a Starfall, `clear` 0..1 (no overcast). */
  update(dt, dark, starfall, clear) {
    const r = this.rng;
    if (this.cur) {
      this.cur.age += dt;
      if (this.cur.age >= this.cur.life) this.cur = null;
    } else if (dark > 0.5 && clear > 0.4) {
      this.wait -= dt;
      if (this.wait <= 0) {
        const gap = starfall ? STARFALL_GAP : METEOR_GAP;
        this.wait = gap[0] + r() * (gap[1] - gap[0]);
        const az = r() * Math.PI * 2, el = 0.35 + r() * 0.9;            // start high in the sky
        const dir = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
        const heading = r() * Math.PI * 2, len = 0.25 + r() * 0.35;       // radians of arc travelled
        this.cur = { age: 0, life: 0.7 + r() * 0.6, from: dir, az, el, heading, len };
      }
    } else if (!this.cur) this.wait = Math.max(this.wait, 2);
    if (!this.cur) return null;
    const c = this.cur, k = c.age / c.life;
    // head slides along the heading; the tail trails behind it
    const at = (t) => {
      const az = c.az + Math.cos(c.heading) * c.len * t, el = Math.max(0.02, c.el - Math.abs(Math.sin(c.heading)) * c.len * 0.8 * t);
      return [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
    };
    const head = at(k), tail = at(Math.max(0, k - 0.28));
    const glow = Math.sin(Math.PI * Math.min(1, k)) * dark;
    return { head, tail, glow };
  }
}
