// Seasons: the calendar derived from world time, its blended numbers, and everything that listens to them
// (weather, snow, crops, animals, the suns, Veilfire, soundscapes), plus /season, the gamerule, the save and the sync.
import { describe, it, expect, afterEach } from 'vitest';
import {
  DAY_TICKS, DEFAULT_DAYS, SEASON_KEYS, SEASON_DATA, SUN_SEASONAL, climate, seasonState, offsetFor, yearTicks, cleanDays,
  seasonValues, applyValues, resetClimate, neutralClimate, seasonalChance, breedCooldownTicks, seasonalCreatureCap,
  ambienceRate, seasonBed, Seasons,
} from '../src/world/seasons.js';
import { Weather } from '../src/sky/weather.js';
import { BIOME } from '../src/world/biomes.js';
import { B } from '../src/world/blocks.js';
import { snowfall, snowThaws, seasonalCropChance, cropGrowthChance, randomTickBlock } from '../src/world/randomTicks.js';
import { SUNS, sunDeclination, daylightFraction, skyState } from '../src/sky/suns.js';
import { auroraTarget } from '../src/sky/nightSky.js';
import { bedFor, AmbientDirector, SOUNDSCAPES } from '../src/audio/ambience.js';
import { runCommand, HELP, GAME_RULES, ruleValue } from '../src/ui/commands.js';
import { WORLD_COMMANDS } from '../src/net/protocol.js';
import { ClientSession } from '../src/net/session.js';
import { MILESTONES } from '../src/player/milestones.js';
import { terrainUniforms } from '../src/render/terrainMaterial.js';
import { MockWorld, rng } from './helpers.js';

const SEASON = DEFAULT_DAYS * DAY_TICKS;
const at = (key, q = 0.5) => ({ ...seasonState(SEASON_KEYS.indexOf(key) * SEASON + Math.floor(q * SEASON)) });
/** Put the shared climate into the middle of a season. */
const setClimate = (key) => applyValues(seasonValues(at(key)));

afterEach(() => resetClimate());

describe('the calendar', () => {
  it('starts in spring, day 1, and walks through the four seasons', () => {
    const s = seasonState(0);
    expect(s).toMatchObject({ key: 'spring', index: 0, day: 1, dayOfYear: 1, year: 0, days: 8 });
    expect(seasonState(SEASON - 1)).toMatchObject({ key: 'spring', day: 8 });
    expect(seasonState(SEASON)).toMatchObject({ key: 'summer', day: 1 });
    expect(seasonState(SEASON * 2).key).toBe('autumn');
    expect(seasonState(SEASON * 3).key).toBe('winter');
    expect(seasonState(SEASON * 3 + 3 * DAY_TICKS)).toMatchObject({ key: 'winter', day: 4, dayOfYear: 8 * 3 + 4 });
    expect(seasonState(SEASON * 4)).toMatchObject({ key: 'spring', year: 1, day: 1 });
    expect(seasonState(SEASON * 9 + 5)).toMatchObject({ year: 2, key: 'summer' });
  });
  it('reports progress through the season and the year', () => {
    expect(seasonState(0).progress).toBe(0);
    expect(seasonState(SEASON / 2).progress).toBeCloseTo(0.5, 5);
    expect(seasonState(SEASON * 2).yearProgress).toBeCloseTo(0.5, 5);
  });
  it('honours the season length and survives negative times', () => {
    expect(seasonState(3 * DAY_TICKS, 3).key).toBe('summer');
    expect(yearTicks(3)).toBe(12 * DAY_TICKS);
    expect(seasonState(-1)).toMatchObject({ key: 'winter', day: 8, year: 0 });
    expect(cleanDays(0)).toBe(1);
    expect(cleanDays(9999)).toBe(120);
    expect(cleanDays('nope')).toBe(DEFAULT_DAYS);
  });
  it('shifts with an offset', () => {
    expect(seasonState(0, 8, SEASON * 2).key).toBe('autumn');
    expect(seasonState(0, 8, -1).key).toBe('winter');
  });
  it('offsetFor lands on the first day of the wanted season, whatever the time of day', () => {
    for (const t of [0, 5000, 123456, SEASON * 7 + 17000]) for (const key of SEASON_KEYS) {
      const s = seasonState(t, 8, offsetFor(key, t));
      expect(s.key).toBe(key);
      expect(s.day).toBe(1);
    }
    expect(offsetFor('monsoon', 0)).toBe(null);
  });
});

describe('the Seasons object', () => {
  it('sets a season, changes the length keeping the place in the year, and saves', () => {
    const s = new Seasons();
    expect(s.setSeason('winter', 100)).toBe(true);
    expect(s.at(100).key).toBe('winter');
    expect(s.setSeason('nope', 100)).toBe(false);
    s.setSeason('summer', 5 * DAY_TICKS + 700);
    s.setDays(4, 5 * DAY_TICKS + 700);
    expect(s.days).toBe(4);
    expect(s.at(5 * DAY_TICKS + 700)).toMatchObject({ key: 'summer', days: 4 });
    const copy = new Seasons();
    copy.load(JSON.parse(JSON.stringify(s.save())));
    expect(copy.days).toBe(4);
    expect(copy.at(5 * DAY_TICKS + 700).key).toBe('summer');
    expect(copy.at(0)).toEqual(s.at(0));
  });
  it('ignores junk in a save and has a label', () => {
    const s = new Seasons();
    s.load(null); s.load('x'); s.load({ days: 'abc', offset: 'q', on: 5 });
    expect(s.days).toBe(DEFAULT_DAYS);
    expect(s.offset).toBe(0);
    expect(s.enabled).toBe(true);
    expect(s.label(2 * DAY_TICKS)).toBe('Spring, day 3/8');
  });
  it('writes the climate when on and puts the original rules back when off', () => {
    const s = new Seasons();
    s.setSeason('winter', 0);
    s.update(4 * DAY_TICKS - 1); // mid-winter
    expect(climate.on).toBe(true);
    expect(climate.growth).toBeCloseTo(SEASON_DATA.winter.growth, 5);
    s.enabled = false;
    s.update(4 * DAY_TICKS - 1);
    expect(climate).toEqual(neutralClimate());
  });
});

describe('blending', () => {
  it('holds a season\'s own numbers in its middle', () => {
    for (const key of SEASON_KEYS) {
      const v = seasonValues(at(key, 0.5));
      expect(v.growth).toBeCloseTo(SEASON_DATA[key].growth, 6);
      expect(v.snowTemp).toBeCloseTo(SEASON_DATA[key].snowTemp, 6);
      expect(v.grass[3]).toBeCloseTo(SEASON_DATA[key].grass[3], 6);
    }
  });
  it('has no jump at a season boundary', () => {
    for (let i = 0; i < 4; i++) {
      const end = seasonValues(seasonState((i + 1) * SEASON - 1)), start = seasonValues(seasonState((i + 1) * SEASON));
      for (const k of ['growth', 'snowTemp', 'frost', 'sunDecl', 'rainClear', 'veil']) expect(Math.abs(end[k] - start[k])).toBeLessThan(0.01);
      for (let c = 0; c < 4; c++) expect(Math.abs(end.leaf[c] - start.leaf[c])).toBeLessThan(0.02);
    }
  });
  it('does not mutate the tables', () => {
    const before = JSON.stringify(SEASON_DATA);
    seasonValues(at('autumn', 0.1)); seasonValues(at('winter', 0.9));
    expect(JSON.stringify(SEASON_DATA)).toBe(before);
  });
  it('turns the leaves orange in autumn and grey-brown in winter', () => {
    expect(SEASON_DATA.autumn.leaf[0]).toBeGreaterThan(SEASON_DATA.autumn.leaf[1] * 2);
    expect(SEASON_DATA.autumn.leaf[3]).toBeGreaterThan(0.7);
    expect(SEASON_DATA.winter.frost).toBeGreaterThan(0.7);
    expect(SEASON_DATA.summer.frost).toBe(0);
    expect(SEASON_DATA.autumn.leafVar).toBe(1);
  });
});

describe('weather and snow', () => {
  it('keeps the original snow line with seasons off', () => {
    expect(Weather.precipitation(BIOME.PLAINS)).toBe('rain');
    expect(Weather.precipitation(BIOME.TAIGA)).toBe('rain'); // temp 0.25
    expect(Weather.precipitation(BIOME.SNOWY_PLAINS)).toBe('snow');
    expect(Weather.precipitation(BIOME.DESERT)).toBe(null);
  });
  it('lifts the snow line in winter: taiga and birch woods snow, plains and deserts do not', () => {
    setClimate('winter');
    expect(Weather.precipitation(BIOME.TAIGA)).toBe('snow');
    expect(Weather.precipitation(BIOME.BIRCH_FOREST)).toBe('snow');
    expect(Weather.precipitation(BIOME.HIGHLAND_MEADOW)).toBe('snow');
    expect(Weather.precipitation(BIOME.PLAINS)).toBe('rain');
    expect(Weather.precipitation(BIOME.FOREST)).toBe('rain');
    expect(Weather.precipitation(BIOME.DESERT)).toBe(null);
    setClimate('summer');
    expect(Weather.precipitation(BIOME.TAIGA)).toBe('rain');
    expect(Weather.precipitation(BIOME.SNOWY_PLAINS)).toBe('snow');
  });
  it('rains more in spring than in summer (shorter clear spells)', () => {
    const run = (season) => {
      setClimate(season);
      const w = new Weather(rng(7));
      let rainy = 0;
      const total = 2_000_000;
      for (let i = 0; i < total; i++) { w.tick(); if (w.raining) rainy++; }
      return rainy / total;
    };
    const spring = run('spring'), summer = run('summer');
    expect(spring).toBeGreaterThan(summer * 1.5);
  });
  it('leaves the spells alone with seasons off', () => {
    const a = new Weather(rng(3)), b = new Weather(rng(3));
    resetClimate();
    for (let i = 0; i < 400000; i++) { a.tick(); b.tick(); }
    expect(a.save()).toEqual(b.save());
    expect(climate.rainClear).toBe(1);
  });

  // a flat world of grass whose biome and block light we choose
  const flat = (biome) => {
    const w = new MockWorld(60);
    for (let x = -60; x <= 60; x++) for (let z = -60; z <= 60; z++) w.set(x, 60, z, B.GRASS);
    w.isLoaded = () => true;
    w.biomeAt = () => biome;
    w.heightAt = () => 60;
    w.getLight = () => 15 << 4;
    w.setBlock = (x, y, z, id, m = 0) => w.set(x, y, z, id, m);
    return w;
  };
  const layers = (w) => [...w.blocks.values()].filter((id) => id === B.SNOW_LAYER).length;
  it('snowfall dusts temperate biomes only when winter has lifted the snow line', () => {
    const w = flat(BIOME.BIRCH_FOREST);
    snowfall(w, 0, 0, rng(1), 200);
    expect(layers(w)).toBe(0);
    setClimate('winter');
    snowfall(w, 0, 0, rng(1), 200);
    expect(layers(w)).toBeGreaterThan(20);
  });
  it('only the always-cold biomes freeze water, even in winter', () => {
    setClimate('winter');
    const w = flat(BIOME.BIRCH_FOREST);
    for (let x = -60; x <= 60; x++) for (let z = -60; z <= 60; z++) w.set(x, 60, z, B.WATER);
    snowfall(w, 0, 0, rng(2), 200);
    expect([...w.blocks.values()].filter((id) => id === B.ICE).length).toBe(0);
    const cold = flat(BIOME.SNOWY_PLAINS);
    for (let x = -60; x <= 60; x++) for (let z = -60; z <= 60; z++) cold.set(x, 60, z, B.WATER);
    snowfall(cold, 0, 0, rng(2), 200);
    expect([...cold.blocks.values()].filter((id) => id === B.ICE).length).toBeGreaterThan(20);
  });
  it('winter snow melts with the thaw, but cold-biome snow and sheltered snow stay', () => {
    const w = flat(BIOME.BIRCH_FOREST);
    setClimate('winter');
    expect(snowThaws(w, 0, 61, 0, () => 0)).toBe(false); // deep winter: it stays
    setClimate('spring');
    expect(snowThaws(w, 0, 61, 0, () => 0)).toBe(true);
    expect(snowThaws(w, 0, 61, 0, () => 0.99)).toBe(false); // slowly, not all at once
    expect(snowThaws(flat(BIOME.SNOWY_PLAINS), 0, 61, 0, () => 0)).toBe(false);
    const roofed = flat(BIOME.BIRCH_FOREST); roofed.heightAt = () => 70;
    expect(snowThaws(roofed, 0, 61, 0, () => 0)).toBe(false);
    // and through the random tick itself
    const t = flat(BIOME.BIRCH_FOREST); t.set(0, 61, 0, B.SNOW_LAYER);
    randomTickBlock(t, 0, 61, 0, B.SNOW_LAYER, () => 0);
    expect(t.getBlock(0, 61, 0)).toBe(B.AIR);
  });
});

describe('farming', () => {
  it('grows crops faster in spring and slowest in winter', () => {
    const w = new MockWorld(60);
    const base = cropGrowthChance(1);
    resetClimate();
    expect(seasonalCropChance(w, 1)).toBeCloseTo(base, 9);
    setClimate('spring');
    const spring = seasonalCropChance(w, 1);
    setClimate('summer');
    const summer = seasonalCropChance(w, 1);
    setClimate('autumn');
    const autumn = seasonalCropChance(w, 1);
    setClimate('winter');
    const winter = seasonalCropChance(w, 1);
    expect(spring).toBeGreaterThan(summer);
    expect(summer).toBeCloseTo(base, 9);
    expect(autumn).toBeLessThan(summer);
    expect(winter).toBeLessThan(base / 2.5);
    expect(winter).toBeCloseTo(base * 0.35, 6);
    expect(seasonalChance(0.9)).toBeLessThanOrEqual(1); // never above certain
  });
  it('leaves other dimensions alone', () => {
    setClimate('winter');
    const w = new MockWorld(60); w.dimension = 'cinderdeep';
    expect(seasonalCropChance(w, 1)).toBe(cropGrowthChance(1));
    w.dimension = 'overworld';
    expect(seasonalCropChance(w, 1)).toBeLessThan(cropGrowthChance(1));
  });
  it('plays out in the random tick: wheat advances far more often in spring than in winter', () => {
    const grown = (season) => {
      setClimate(season);
      const w = new MockWorld(60);
      w.set(0, 59, 0, B.FARMLAND, 7);
      w.getLight = () => 15 << 4;
      w.setBlock = (x, y, z, id, m = 0) => w.set(x, y, z, id, m);
      let n = 0;
      const r = rng(11);
      for (let i = 0; i < 60000; i++) {
        w.set(0, 60, 0, B.WHEAT, 0);
        randomTickBlock(w, 0, 60, 0, B.WHEAT, r);
        if (w.getMeta(0, 60, 0) === 1) n++;
      }
      return n;
    };
    const spring = grown('spring'), winter = grown('winter');
    expect(spring).toBeGreaterThan(winter * 3);
    expect(winter).toBeGreaterThan(0);
  });
});

describe('animals', () => {
  it('breed sooner in spring and later in winter', () => {
    expect(breedCooldownTicks()).toBe(6000);
    setClimate('spring');
    expect(breedCooldownTicks()).toBe(3600);
    setClimate('winter');
    expect(breedCooldownTicks()).toBe(9600);
  });
  it('flourish in spring and thin out in winter', () => {
    expect(seasonalCreatureCap(10)).toBe(10);
    setClimate('spring');
    expect(seasonalCreatureCap(10)).toBe(12);
    setClimate('winter');
    expect(seasonalCreatureCap(10)).toBe(6);
  });
});

describe('the suns and the night sky', () => {
  const hearth = SUNS[0];
  it('are unchanged with seasons off', () => {
    resetClimate();
    expect(sunDeclination(hearth)).toBe(hearth.declination);
    expect(skyState(5000).combined).toBe(skyState(5000).combined);
  });
  it('give long summer days and short winter days', () => {
    setClimate('summer');
    const summer = daylightFraction(hearth);
    setClimate('winter');
    const winter = daylightFraction(hearth);
    resetClimate();
    const plain = daylightFraction(hearth);
    expect(summer).toBeGreaterThan(plain);
    expect(winter).toBeLessThan(plain);
    expect(summer - winter).toBeGreaterThan(0.04); // about 1000 ticks of the Hearth sun's day
  });
  it('lift the suns higher at noon in summer', () => {
    const noon = (season) => { setClimate(season); return Math.max(...SUNS.map((s) => { let m = -1; for (let t = 0; t < s.period; t += 200) m = Math.max(m, skyState(t, [s]).suns[0].elevation); return m; })); };
    expect(noon('summer')).toBeGreaterThan(noon('winter'));
    for (const k of Object.keys(SUN_SEASONAL)) expect(SUNS.some((s) => s.key === k)).toBe(true);
  });
  it('make Veilfire stronger in winter and weaker in summer', () => {
    const night = (boost) => auroraTarget(0.7, 0, 0, 50, boost);
    expect(auroraTarget(0.7, 0, 0, 50)).toBe(night(1));
    let seen = 0;
    for (let d = 0; d < 40 && !seen; d++) if (auroraTarget(0.7, 0, 0, d) > 0) seen = d + 1;
    const day = seen - 1;
    setClimate('winter');
    const w = auroraTarget(0.7, 0, 0, day, climate.veil);
    setClimate('summer');
    const s = auroraTarget(0.7, 0, 0, day, climate.veil);
    expect(w).toBeGreaterThan(s);
    expect(w).toBeLessThanOrEqual(1);
  });
});

describe('soundscapes', () => {
  it('scales the wind of the surface beds and leaves caves alone', () => {
    const winter = neutralClimate().amb; winter.wind = 1.5; winter.cricket = 0;
    expect(bedFor('cold', false, winter).wind).toBeCloseTo(SOUNDSCAPES.cold.bed.wind * 1.5, 9);
    expect(bedFor('swamp', true, winter).insects).toBe(0);
    expect(bedFor('cave', false, winter)).toEqual(SOUNDSCAPES.cave.bed);
    expect(bedFor('plains', false)).toEqual(SOUNDSCAPES.plains.bed);
    expect(seasonBed({ rumble: 1 }, winter)).toEqual({ rumble: 1 });
  });
  it('maps sounds to the season table', () => {
    const amb = { wind: 2, bird: 3, cricket: 4, howl: 5 };
    expect(ambienceRate('bird_trill', amb)).toBe(3);
    expect(ambienceRate('cricket', amb)).toBe(4);
    expect(ambienceRate('croak', amb)).toBe(4);
    expect(ambienceRate('howl', amb)).toBe(5);
    expect(ambienceRate('breeze', amb)).toBe(2);
    expect(ambienceRate('owl', amb)).toBe(1);
    expect(ambienceRate('bird_trill', null)).toBe(1);
  });
  const count = (season, scape, night, sound, seconds = 3000) => {
    if (season) setClimate(season); else resetClimate();
    const d = new AmbientDirector(rng(5));
    let n = 0;
    for (let t = 0; t < seconds; t++) for (const e of d.tick(1, scape, night, season ? climate.amb : null)) if (e.sound === sound) n++;
    return n;
  };
  it('has more birdsong in spring than in autumn and almost none in winter', () => {
    const spring = count('spring', 'plains', false, 'bird_trill'), autumn = count('autumn', 'plains', false, 'bird_trill'), winter = count('winter', 'plains', false, 'bird_trill');
    expect(spring).toBeGreaterThan(autumn);
    expect(autumn).toBeGreaterThan(winter);
    expect(winter).toBeLessThan(spring / 5);
  });
  it('has crickets in summer and none in winter; wolves howl most in winter', () => {
    expect(count('summer', 'plains', true, 'cricket')).toBeGreaterThan(count('spring', 'plains', true, 'cricket'));
    expect(count('winter', 'plains', true, 'cricket')).toBe(0);
    expect(count('winter', 'cold', true, 'howl', 20000)).toBeGreaterThan(count('summer', 'cold', true, 'howl', 20000));
  });
  it('is unchanged with no season table', () => {
    const a = new AmbientDirector(rng(9)), b = new AmbientDirector(rng(9));
    const run = (d, extra) => { const out = []; for (let t = 0; t < 600; t++) out.push(...(extra ? d.tick(1, 'forest', false, extra) : d.tick(1, 'forest', false))); return out; };
    expect(run(a, null)).toEqual(run(b));
  });
});

describe('/season, the gamerule and the HUD', () => {
  const fake = (time = 0, settings = {}) => {
    const g = { settings: { ...settings }, time, seasons: new Seasons(), updated: 0, player: {} };
    Object.defineProperty(g, 'seasonsOn', { get() { return this.settings.seasons !== false; } });
    g.setSetting = (k, v) => { g.settings[k] = v; };
    g.updateSeasons = () => { g.updated++; g.seasons.update(g.time); };
    return g;
  };
  it('is listed in /help and the gamerule list', () => {
    expect(HELP.some((l) => l.includes('/season set'))).toBe(true);
    expect(HELP.some((l) => l.includes('doSeasons'))).toBe(true);
    expect(GAME_RULES.doSeasons).toBe('seasons');
  });
  it('queries the date', () => {
    const g = fake(2 * DAY_TICKS);
    expect(runCommand(g, '/season')).toMatch(/It is Spring, day 3 of 8 \(year 1\); Summer comes in 6 days/);
    expect(runCommand(g, '/season query')).toMatch(/Spring/);
  });
  it('sets the season by name or abbreviation', () => {
    const g = fake(100);
    expect(runCommand(g, '/season set winter')).toBe('Set the season to Winter');
    expect(g.seasons.at(g.time).key).toBe('winter');
    expect(g.updated).toBe(1);
    expect(climate.on).toBe(true);
    runCommand(g, '/season set au');
    expect(g.seasons.at(g.time).key).toBe('autumn');
    expect(runCommand(g, '/season set monsoon')).toMatch(/Usage/);
    expect(runCommand(g, '/season set')).toMatch(/Usage/);
    expect(runCommand(g, '/season nonsense')).toMatch(/Usage/);
  });
  it('sets the season length and rejects bad numbers', () => {
    const g = fake(0);
    expect(runCommand(g, '/season length 3')).toBe('Each season now lasts 3 days');
    expect(g.seasons.days).toBe(3);
    expect(runCommand(g, '/season length 1')).toBe('Each season now lasts 1 day');
    for (const bad of ['0', '121', 'x', '2.5', '']) expect(runCommand(g, `/season length ${bad}`)).toMatch(/Usage/);
  });
  it('says so when the seasons are off', () => {
    const g = fake(0, { seasons: false });
    expect(runCommand(g, '/season')).toMatch(/seasons are off/);
  });
  it('switches with /gamerule doSeasons (on unless set to false)', () => {
    const g = fake(0);
    expect(runCommand(g, '/gamerule doSeasons')).toMatch(/currently set to: true/);
    expect(runCommand(g, '/gamerule doSeasons false')).toMatch(/now set to: false/);
    expect(g.settings.seasons).toBe(false);
    expect(ruleValue(g.settings, 'seasons')).toBe(false);
  });
  it('is a world command, so guests have the host run it', () => {
    expect(WORLD_COMMANDS.has('season')).toBe(true);
  });
});

describe('multiplayer and the save', () => {
  it('a guest takes the host calendar from the optional se field', () => {
    const host = new Seasons(); host.setSeason('autumn', 5000); host.setDays(5, 5000);
    const game = { seasons: new Seasons(), settings: {}, get seasonsOn() { return this.settings.seasons !== false; } };
    ClientSession.prototype.applySeasons.call({ game }, JSON.parse(JSON.stringify({ ...host.save(), on: false })));
    expect(game.seasons.days).toBe(5);
    expect(game.seasons.at(5000)).toEqual(host.at(5000));
    expect(game.settings.seasons).toBe(false);
    expect(game.seasons.enabled).toBe(false);
  });
  it('an older host sends no se field and nothing changes', () => {
    const game = { seasons: new Seasons(), settings: {}, get seasonsOn() { return true; } };
    game.seasons.setDays(6, 0);
    const before = JSON.stringify(game.seasons.save());
    ClientSession.prototype.applySeasons.call({ game }, undefined);
    ClientSession.prototype.applySeasons.call({ game }, 'junk');
    expect(JSON.stringify(game.seasons.save())).toBe(before);
  });
  it('both ends compute the same season from the synced time', () => {
    const a = new Seasons(), b = new Seasons();
    a.setSeason('summer', 1234); b.load(a.save());
    for (const t of [1234, 99999, 400000]) expect(b.at(t)).toEqual(a.at(t));
  });
});

describe('milestone and shader hooks', () => {
  it('has a milestone for a full year', () => {
    const m = MILESTONES.find((x) => x.id === 'year');
    expect(m).toBeTruthy();
    const g = { seasons: new Seasons(), time: 0, seasonsOn: true };
    expect(m.tick(g)).toBe(false);
    g.time = yearTicks() + 5;
    expect(m.tick(g)).toBe(true);
    g.seasonsOn = false;
    expect(m.tick(g)).toBe(false);
    // /season set cannot fast-forward the year
    g.seasonsOn = true; g.time = 100; g.seasons.setSeason('winter', g.time);
    expect(m.tick(g)).toBe(false);
  });
  it('tints through terrain uniforms, so nothing is remeshed', () => {
    for (const k of ['uSeasonOn', 'uSeasonGrass', 'uSeasonLeaf', 'uSeasonFrost', 'uSeasonVar']) expect(terrainUniforms[k]).toBeTruthy();
    expect(terrainUniforms.uSeasonOn.value).toBe(0); // off until the game turns it on
    expect(terrainUniforms.uSeasonGrass.value.w).toBe(0);
  });
  it('is performance neutral: the blend is a few dozen numbers', () => {
    const t0 = performance.now();
    const s = new Seasons();
    for (let i = 0; i < 20000; i++) s.update(i * 20);
    expect(performance.now() - t0).toBeLessThan(1500); // 20000 updates; the game does one per second
  });
});
