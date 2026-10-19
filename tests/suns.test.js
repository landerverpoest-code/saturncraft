import { describe, it, expect } from 'vitest';
import { SUNS, sunDirection, sunAngle, skyState, daylightFraction, kelvinToRGB, effectiveSkyLight, findNextPhase, sunlightFactor } from '../src/sky/suns.js';

describe('three suns configuration', () => {
  it('has exactly three suns', () => expect(SUNS).toHaveLength(3));
  it('each sun has a distinct period, phase, azimuth, tilt, colour temperature and intensity', () => {
    for (const k of ['period', 'phase', 'riseAzimuth', 'tilt', 'colorTemp', 'intensity']) {
      expect(new Set(SUNS.map((s) => s[k])).size, k).toBe(3);
    }
  });
  it('directions are unit vectors and periodic in each sun\'s own period', () => {
    for (const s of SUNS) {
      for (const t of [0, 1234, 99999]) {
        const a = sunDirection(s, t), b = sunDirection(s, t + s.period);
        expect(Math.hypot(...a)).toBeCloseTo(1, 9);
        for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 6);
      }
    }
  });
  it('suns are not periodic with each other\'s periods', () => {
    const s = SUNS[1];
    const a = sunDirection(s, 1000), b = sunDirection(s, 1000 + SUNS[0].period);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(0.1);
  });
  it('rises at its rise azimuth (on the horizon at angle 0)', () => {
    for (const s of SUNS) {
      const t = ((-s.phase % 1 + 1) % 1) * s.period; // angle 0
      expect(sunAngle(s, t)).toBeCloseTo(0, 6);
      const d = sunDirection(s, t);
      const az = Math.atan2(d[0], -d[2]);
      expect(Math.abs(Math.sin(az - s.riseAzimuth))).toBeLessThan(0.15);
    }
  });
  it('time above the horizon matches the analytic daylight fraction', () => {
    for (const s of SUNS) {
      let up = 0; const N = 4000;
      for (let i = 0; i < N; i++) if (sunDirection(s, (i / N) * s.period)[1] > 0) up++;
      expect(up / N).toBeCloseTo(daylightFraction(s), 2);
    }
  });
});

describe('day / twilight / night', () => {
  it('classifies phases by the number of suns above the horizon', () => {
    for (let t = 0; t < 400000; t += 997) {
      const st = skyState(t);
      const n = st.suns.filter((s) => s.elevation > 0).length;
      expect(st.aboveCount).toBe(n);
      expect(st.isDay).toBe(n >= 1);
      expect(st.phase).toBe(n === 0 ? 'night' : n === 1 ? 'twilight' : 'day');
    }
  });
  it('all three phases occur and nights are a minority of time', () => {
    const c = { day: 0, twilight: 0, night: 0 };
    for (let t = 0; t < 2_000_000; t += 100) c[skyState(t).phase]++;
    const total = c.day + c.twilight + c.night;
    expect(c.night / total).toBeGreaterThan(0.05);
    expect(c.night / total).toBeLessThan(0.3);
    expect(c.twilight).toBeGreaterThan(0);
    expect(c.day).toBeGreaterThan(c.night);
  });
  it('the world starts in daytime', () => expect(skyState(0).isDay).toBe(true));
  it('night has full sky darkening (light 4) and noon has none', () => {
    const n = findNextPhase(0, 'night');
    expect(n).toBeGreaterThan(0);
    const st = skyState(n + 400);
    expect(st.phase).toBe('night');
    expect(st.skyDarken).toBe(11);
    expect(effectiveSkyLight(15, st.skyDarken)).toBe(4);
    // Find a time where the brightest sun is high
    let best = 0, bt = 0;
    for (let t = 0; t < 40000; t += 50) { const c = skyState(t).combined; if (c > best) { best = c; bt = t; } }
    expect(skyState(bt).skyDarken).toBe(0);
  });
  it('combined sunlight sums contributions of every sun above the horizon', () => {
    for (let t = 0; t < 200000; t += 1511) {
      const st = skyState(t);
      const expected = 1 - st.suns.reduce((p, s) => p * (1 - sunlightFactor(s.sun, s.elevation)), 1);
      expect(st.combined).toBeCloseTo(expected, 9);
      // more combined light never means more darkening
      expect(st.skyDarken).toBe(Math.round(11 * (1 - Math.min(1, st.combined))));
    }
  });
  it('a single dim sun cannot make full daylight', () => {
    const dim = SUNS.find((s) => s.key === 'pale');
    expect(sunlightFactor(dim, 1)).toBeLessThan(0.6);
  });
  it('blended light colour is a weighted mix of visible suns', () => {
    for (let t = 0; t < 100000; t += 2003) {
      const st = skyState(t);
      if (st.combined === 0) continue;
      const lit = st.suns.filter((s) => s.factor > 0);
      for (let c = 0; c < 3; c++) {
        const lo = Math.min(...lit.map((s) => s.color[c])), hi = Math.max(...lit.map((s) => s.color[c]));
        expect(st.lightColor[c]).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(st.lightColor[c]).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });
});

describe('colour temperature', () => {
  it('cool suns are bluer than warm suns', () => {
    const warm = kelvinToRGB(2700), cool = kelvinToRGB(11000);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(cool[2]).toBeGreaterThan(cool[0]);
  });
});
