// World events: rare, readable, optional happenings that add surprise to the days and nights.
//
//  starfall   On a Starfall night (sky/nightSky.js nightCharacter) a few meteorites land near players: a streak across
//             the sky, a boom, then a small crater with a glowing Starfall Core and a little rare ore in its floor.
//  dust       A dust storm in the desert and badlands: the fog closes in, sand streams past and travellers wade
//             slowly through it. Creatures are not troubled by it.
//  fog        Ground fog at dawn in swamps and forests: the fog simply thickens for a while after sunrise.
//  festival   The Wandering Lantern Festival: on the middle day of autumn some villages (a new set each year) hang
//             lanterns, their settlers gather at the well in the evening and trade a little cheaper. How much
//             cheaper follows the player's reputation (mobs/reputation.js); a village that refuses to trade
//             does not celebrate with that player. Staying for the festival earns a little goodwill.
//  hush       An aurora-lit Hush Night: monsters keep their voices down, the night insects and wolves fall silent,
//             and Hush Sensors hear half as far again.
//
// Everything is decided by pure functions of (world seed, world time, season), so every machine under the same sky
// agrees without being told, and the only things that need saving are the last meteorite slot handled, the craters
// made, the festival lanterns hung and who already enjoyed which festival. The host (or a single-player game) makes
// the changes to the world; guests get the same windows from the same clock and see the changes as edits. Meteorites
// that are about to land and events started with /event travel in the optional `ev` field of the env message
// (net/session.js). Nothing here costs anything while idle: tick() returns after one comparison on 19 ticks of 20,
// and the refresh every 20 ticks only reads a few numbers when no event is near.
import { B, BLOCKS, SOLID, isFluid } from './blocks.js';
import { BIOME } from './biomes.js';
import { nightCharacter } from '../sky/nightSky.js';
import { skyState } from '../sky/suns.js';
import { villagesNear, houseDoor } from './villages.js';
import { SIDE_DIRS } from './shapes.js';
import { villageKey, getRep, refusesTrade, REP } from '../mobs/reputation.js';
import { repEvent } from '../mobs/villageRep.js';

export const DAY = 24000;
export const REFRESH = 20;           // ticks between looks at the clock
export const SLOT = 300;             // ticks (15 s) per meteorite slot on a Starfall night
export const METEOR_CHANCE = 0.26;   // chance a slot lets one fall (about three on a Starfall night)
export const ANNOUNCE = 80;          // ticks between the streak and the impact
export const METEOR_RANGE = [40, 80]; // blocks from the player a meteorite lands
export const FOREVER = 1e15;

export const EVENT_KINDS = {
  starfall: { name: 'Starfall', desc: 'Meteorites fall on a Starfall night and leave craters with a Starfall Core', duration: 6000 },
  dust: { name: 'Dust Storm', desc: 'A storm of sand in deserts and badlands: thick fog, slow going', duration: 4800 },
  fog: { name: 'Ground Fog', desc: 'Morning fog in swamps and forests', duration: 4800 },
  festival: { name: 'Lantern Festival', desc: 'Villages hang lanterns, settlers gather and trade a little cheaper', duration: 6000 },
  hush: { name: 'Hush Night', desc: 'Monsters are quieter and Hush Sensors hear further', duration: 6000 },
};
export const EVENT_ORDER = Object.keys(EVENT_KINDS);

// ---- deterministic dice ----------------------------------------------------------------------------------------------

/** A number 0..1 decided by the arguments alone. */
export function h01(...ns) {
  let h = 0x811c9dc5;
  for (const n of ns) {
    h = Math.imul(h ^ (Math.floor(+n) | 0), 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
  }
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** A seed (number or text) as an integer. */
export function seedNum(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.floor(seed) | 0;
  let h = 7;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return h | 0;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
/** 0 outside [start, end], rising over `up` and falling over `down` at the edges. */
export function ramp(t, start, end, up = 600, down = up) {
  return Math.min(smooth((t - start) / up), smooth((end - t) / down));
}

// ---- dust storms ---------------------------------------------------------------------------------------------------

export const DUST_BIOMES = new Set([BIOME.DESERT, BIOME.BADLANDS]);
/** Chance of a dust storm on a day, by season (summer is the dry one). */
export const DUST_CHANCE = { spring: 0.14, summer: 0.3, autumn: 0.18, winter: 0.07 };

/** The storm of a day, or null: { start, end } in world ticks. */
export function dustStorm(seed, dayNo, season = 'spring') {
  const s = seedNum(seed);
  if (h01(s, dayNo, 101) >= (DUST_CHANCE[season] ?? 0.15)) return null;
  const start = dayNo * DAY + 1500 + Math.floor(h01(s, dayNo, 102) * 12000);
  return { start, end: start + 3600 + Math.floor(h01(s, dayNo, 103) * 4800) };
}
/** How strong the storm is at time t (0..1, anywhere; the biome decides whether it reaches the player). */
export function dustLevel(seed, t, season = 'spring') {
  const st = dustStorm(seed, Math.floor(t / DAY), season);
  return st ? ramp(t, st.start, st.end, 600) : 0;
}

// ---- ground fog -----------------------------------------------------------------------------------------------------

export const FOG_BIOMES = { [BIOME.SWAMP]: 1, [BIOME.MANGROVE_SWAMP]: 1, [BIOME.FOREST]: 0.7, [BIOME.DARK_FOREST]: 0.85, [BIOME.BIRCH_FOREST]: 0.65, [BIOME.FLOWER_FOREST]: 0.65 };
export const FOG_CHANCE = { spring: 0.4, summer: 0.15, autumn: 0.55, winter: 0.25 };
/** Where the Hearth sun is in its orbit, 0..1, with 0 at sunrise. */
export const sunFrac = (t) => ((t / DAY + 0.02) % 1 + 1) % 1;
/** The tick of the Hearth sun's rise that begins sunrise number `n`. */
export const sunrise = (n) => n * DAY - 480;

/** Fog 0..1 at time t (the dawn window lasts from before sunrise until the sun has burnt it off). */
export function fogLevel(seed, t, season = 'spring') {
  const n = Math.floor(t / DAY + 0.02);
  if (h01(seedNum(seed), n, 111) >= (FOG_CHANCE[season] ?? 0.3)) return 0;
  const r = sunrise(n);
  return ramp(t, r - 1500, r + 3000, 900, 1200);
}

// ---- Hush Nights ----------------------------------------------------------------------------------------------------

/** Is the night of this day a Hush Night? Aurora-lit nights only, and only some of those. */
export function hushNight(seed, dayNo) {
  return nightCharacter(dayNo).veil >= 0.6 && h01(seedNum(seed), dayNo, 201) < 0.3;
}
/** How dark it is, 0..1 (the same measure the sky uses for Veilfire and falling stars). */
export const darkness = (t) => clamp01(1 - skyState(t).combined * 3);
export const hushLevel = (seed, t) => (hushNight(seed, Math.floor(t / DAY)) ? darkness(t) : 0);
export const SENSOR_BOOST = 0.5; // Hush Sensors hear this much further on a Hush Night

// ---- Starfall ----------------------------------------------------------------------------------------------------------

export const starfallNight = (t) => nightCharacter(Math.floor(t / DAY)).starfall && darkness(t) > 0.5;

/** The meteorite of a slot, or null: { id, at (tick it lands), angle, dist, pick (0..1 picks a player) }. */
export function meteorSlot(seed, slot) {
  const s = seedNum(seed);
  if (h01(s, slot, 401) >= METEOR_CHANCE) return null;
  return {
    id: slot, at: slot * SLOT + Math.floor(h01(s, slot, 402) * SLOT * 0.6) + ANNOUNCE,
    angle: h01(s, slot, 403) * Math.PI * 2, dist: METEOR_RANGE[0] + h01(s, slot, 404) * (METEOR_RANGE[1] - METEOR_RANGE[0]),
    pick: h01(s, slot, 405),
  };
}

export const CORE_ORES = [[B.IRON_ORE, 0.22], [B.GOLD_ORE, 0.25], [B.AZURITE_ORE, 0.25], [B.CINNABAR_ORE, 0.18], [B.DIAMOND_ORE, 0.1]];
/** A rare ore for a roll 0..1. */
export function pickOre(r) {
  let acc = 0;
  for (const [id, p] of CORE_ORES) { acc += p; if (r < acc) return id; }
  return CORE_ORES[0][0];
}
export const CRATER_RADIUS = 3.2;
const SCORCH = [B.SMOOTH_BASALT, B.COAL_BLOCK];

/**
 * The crater of meteorite `id` landing on the ground block at (x, y, z): { clear: [[x,y,z]], set: [[x,y,z,block]] }.
 * A bowl about three blocks wide and two deep, scorched rim, the Starfall Core at the bottom and two or three rare
 * ore blocks beside it.
 */
export function craterPlan(seed, id, x, y, z) {
  const s = seedNum(seed), clear = [], set = [];
  for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
    const d = Math.hypot(dx, dz);
    if (d <= CRATER_RADIUS) {
      const depth = Math.round(2.2 * (1 - (d / CRATER_RADIUS) ** 2));
      for (let yy = y - depth + 1; yy <= y + 3; yy++) clear.push([x + dx, yy, z + dz]);
      set.push([x + dx, y - depth, z + dz, d < 0.5 ? B.STARFALL_CORE : SCORCH[h01(s, id, dx * 31 + dz, 411) < 0.7 ? 0 : 1]]);
    } else if (d <= CRATER_RADIUS + 1.3 && h01(s, id, dx * 31 + dz, 412) < 0.55) {
      set.push([x + dx, y, z + dz, SCORCH[h01(s, id, dx * 31 + dz, 413) < 0.6 ? 0 : 1]]);
    }
  }
  const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort((a, b) => h01(s, id, a[0] * 5 + a[1], 414) - h01(s, id, b[0] * 5 + b[1], 414));
  const n = 2 + (h01(s, id, 415) < 0.4 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const [dx, dz] = side[i], depth = Math.round(2.2 * (1 - (1 / CRATER_RADIUS) ** 2));
    const cell = set.find((c) => c[0] === x + dx && c[2] === z + dz && c[1] === y - depth);
    const ore = pickOre(h01(s, id, i, 416));
    if (cell) cell[3] = ore; else set.push([x + dx, y - depth, z + dz, ore]);
  }
  return { clear, set };
}

// ---- the Lantern Festival ------------------------------------------------------------------------------------------------

export const FESTIVAL_SEASON = 'autumn';
export const FESTIVAL_HOST_CHANCE = 0.6;   // a village hosts it in a given year with this chance (it wanders)
export const FESTIVAL_CUT = [0.06, 0.12];  // price cut: strangers .. a village's hero
export const FESTIVAL_GOODWILL = 2;        // reputation for staying for the festival
/** The day of autumn the festival falls on: the middle one. */
export const festivalDay = (days) => Math.max(1, Math.ceil(days / 2));
/** Is this calendar state (world/seasons.js seasonState) the festival day? */
export const isFestivalDay = (st) => !!st && st.key === FESTIVAL_SEASON && st.day === festivalDay(st.days);
/** The evening part of the day: settlers gather from dusk until late. */
export function eveningLevel(t) {
  const f = sunFrac(t);
  return Math.min(smooth((f - 0.44) / 0.04), smooth((0.8 - f) / 0.05));
}
/** Does the village of `key` hold the festival in `year`? */
export const villageHosts = (seed, key, year) => h01(seedNum(seed), seedNum(key), year, 301) < FESTIVAL_HOST_CHANCE;

/** The price cut (0..) a player with reputation `rep` gets during the festival; nothing from a village that has turned on them. */
export function festivalCut(rep) {
  if (refusesTrade(rep || 0)) return 0;
  const k = clamp01((rep || 0) / 100);
  return FESTIVAL_CUT[0] + (FESTIVAL_CUT[1] - FESTIVAL_CUT[0]) * k;
}

/**
 * Where a village hangs its festival lanterns: [{ x, y, z, hang }]. A hung lantern wants a solid block over it
 * (an eave); otherwise a standing one goes beside each doorstep and at the well's corners.
 */
export function lanternSpots(village, world, max = 22) {
  const out = [], seen = new Set();
  const free = (x, y, z) => { const id = world.getBlock(x, y, z); return !SOLID[id] && !isFluid(id); };
  const add = (x, y, z, hang) => { const k = `${x},${y},${z}`; if (!seen.has(k) && out.length < max) { seen.add(k); out.push({ x, y, z, hang }); return true; } return false; };
  const ground = (x, z, y0) => {
    for (let y = y0 + 2; y >= y0 - 3; y--) if (SOLID[world.getBlock(x, y - 1, z)] && free(x, y, z)) return y;
    return null;
  };
  for (const p of village.pieces) {
    if (p.type === 'house') {
      const [dx, dz] = houseDoor(p), [fx, , fz] = SIDE_DIRS[p.facing], ox = dx + fx, oz = dz + fz;
      const gy = ground(ox, oz, p.y);
      if (gy === null) continue;
      if (free(ox, gy + 2, oz) && SOLID[world.getBlock(ox, gy + 3, oz)]) add(ox, gy + 2, oz, true);
      else {
        const sx = ox - fz, sz = oz + fx, y2 = ground(sx, sz, gy);
        if (y2 !== null) add(sx, y2, sz, false);
      }
      const tx = ox + fz, tz = oz - fx, y3 = ground(tx, tz, gy);
      if (y3 !== null) add(tx, y3, tz, false);
    } else if (p.type === 'well') {
      for (const [x, z] of [[p.x0 - 1, p.z0 - 1], [p.x1 + 1, p.z0 - 1], [p.x0 - 1, p.z1 + 1], [p.x1 + 1, p.z1 + 1]]) {
        const y = ground(x, z, p.y);
        if (y !== null) add(x, y, z, false);
      }
    }
  }
  return out;
}

/** Where a settler of a hosting village stands for the festival: a ring round the well, a spot of its own. */
export function gatherSpot(village, id) {
  const a = h01(id, 331) * Math.PI * 2, r = 3.2 + h01(id, 332) * 2.4;
  return { x: village.cx + 0.5 + Math.cos(a) * r, y: village.y, z: village.cz + 0.5 + Math.sin(a) * r };
}

// ---- the sound of it all --------------------------------------------------------------------------------------------------

const NEUTRAL_AMB = { wind: 1, bird: 1, cricket: 1, howl: 1 };

// ---- the game's part ---------------------------------------------------------------------------------------------------

const KEYS = ['dust', 'fog', 'hush', 'star', 'fest'];
const DUST_RGB = [0.8, 0.64, 0.4], FOG_RGB = [0.82, 0.86, 0.88];

/** One per game: the live levels, the meteorites in flight and the saved scraps. */
export class WorldEvents {
  constructor(game) {
    this.game = game;
    this.lv = { dust: 0, fog: 0, hush: 0, star: 0, fest: 0 };   // what the local player experiences now (smoothed)
    this.target = { dust: 0, fog: 0, hush: 0, star: 0, fest: 0 };
    this.forced = {};            // kind -> { until (world time), key? }  (/event trigger)
    this.pending = [];           // meteorites in flight: { id, x, z, at (game tick), total, sx, sz }
    this.seen = new Set();       // meteorite ids already announced here
    this.festOn = false;         // is a festival day (or one started by hand) running?
    this.fest = new Map();       // village key -> { cx, cz, y, level }  festivals under way near the players
    this.lastSlot = -1;          // last meteorite slot decided (saved)
    this.sites = [];             // craters made: [x, y, z, day] (saved, newest last)
    this.lanterns = [];          // festival lanterns hung: [x, y, z, villageKey] (saved)
    this.attended = [];          // "villageKey:year:name" festivals already enjoyed (saved)
    this.moving = false;         // are the smoothed levels still catching up with their targets?
    this.fx = { near: 1, far: 1, k: 0, r: 1, g: 1, b: 1 }; // fog multipliers and tint for game.js
    this.amb = { ...NEUTRAL_AMB };
    this.announced = new Set();  // toasts shown for the windows now open
    this.wasOn = true;
  }

  get enabled() { return this.game.settings.worldEvents !== false; }
  get authority() { const n = this.game.net; return !n || n.isHost; }
  get seed() { return this.game.seed; }

  season(t) { const s = this.game.seasons; return s ? s.at(t).key : 'spring'; }

  // ---- per tick ----
  tick() {
    const g = this.game, on = this.enabled && g.world.dimension === 'overworld';
    if (!on) {
      if (this.wasOn) this.shutDown();
      else if (this.lanterns.length && !this.enabled && g.world.dimension === 'overworld' && g.ticks % 100 === 3) this.removeLanterns(true);
      this.wasOn = false;
      return;
    }
    this.wasOn = true;
    if (this.pending.length) this.tickPending();
    if (this.lv.dust > 0.05) this.dustParticles();
    if (this.moving) this.approach();
    if (g.ticks % REFRESH === 7) this.refresh();
  }

  /** The events are off (the rule, or the wrong dimension): let go of everything at once. */
  shutDown() {
    for (const k of KEYS) { this.target[k] = 0; this.lv[k] = 0; }
    this.moving = false; this.pending.length = 0; this.fest.clear();
    this.applyLevels();
    if (this.game.world.dimension === 'overworld') this.removeLanterns(true);
    const p = this.game.player;
    if (p) p.eventSlow = 1;
  }

  /** Look at the clock and decide what is going on around the local player. */
  refresh() {
    const g = this.game, t = g.time, w = g.world, p = g.player;
    const season = this.season(t), seed = this.seed, now = this.activeForced(t);
    const biome = w.biomeAt(Math.floor(p.x), Math.floor(p.z));
    const T = this.target;
    T.dust = Math.max(now.dust ? 1 : 0, DUST_BIOMES.has(biome) ? dustLevel(seed, t, season) : 0);
    T.fog = Math.max(now.fog ? 1 : 0, (FOG_BIOMES[biome] || 0) * fogLevel(seed, t, season));
    const dark = darkness(t);
    T.hush = Math.max(now.hush ? 1 : 0, hushLevel(seed, t) > 0 ? dark : 0);
    const star = starfallNight(t) || !!now.starfall;
    T.star = star ? 1 : 0;
    this.refreshFestival(t, now);
    T.fest = 0;
    for (const f of this.fest.values()) if (Math.hypot(f.cx - p.x, f.cz - p.z) < 70) T.fest = Math.max(T.fest, f.level);
    this.moving = KEYS.some((k) => Math.abs(this.lv[k] - T[k]) > 0.002);
    this.announce();
    this.milestones();
    if (this.authority && star) this.scheduleMeteors(t, !!now.starfall);
    if (this.authority) this.festivalWorld(t);
    if (this.attended.length && !this.fest.size && this.attended.length > 60) this.attended.splice(0, this.attended.length - 40);
    // forced events run out
    for (const k of Object.keys(this.forced)) if (this.forced[k].until <= t) delete this.forced[k];
  }

  /** The events started by hand that are still running: { kind: true }. */
  activeForced(t) {
    const out = {};
    for (const k of Object.keys(this.forced)) if (this.forced[k].until > t) out[k] = true;
    return out;
  }

  /** Smooth the levels towards the targets (about two seconds), and refresh what the renderer and the player read. */
  approach() {
    let moving = false;
    for (const k of KEYS) {
      const d = this.target[k] - this.lv[k];
      if (Math.abs(d) < 0.004) this.lv[k] = this.target[k];
      else { this.lv[k] += d * 0.06; moving = true; }
    }
    this.moving = moving;
    this.applyLevels();
  }

  applyLevels() {
    const { dust, fog, hush } = this.lv, f = this.fx;
    f.near = Math.max(0.05, 1 - 0.92 * dust - 0.7 * fog);
    f.far = Math.max(0.14, 1 - 0.72 * dust - 0.55 * fog);
    f.k = Math.min(0.85, dust * 0.8 + fog * 0.55);
    const wd = dust + fog > 0 ? dust / (dust + fog) : 0;
    f.r = DUST_RGB[0] * wd + FOG_RGB[0] * (1 - wd); f.g = DUST_RGB[1] * wd + FOG_RGB[1] * (1 - wd); f.b = DUST_RGB[2] * wd + FOG_RGB[2] * (1 - wd);
    const p = this.game.player;
    if (p) p.eventSlow = 1 - 0.22 * dust; // a dust storm slows travellers (creatures are not touched by it)
    // the soundscape: wind roars in a storm, a Hush Night silences the night's voices
    const a = this.amb;
    a.wind = (1 + 1.8 * dust) * (1 - 0.4 * hush) * (1 - 0.25 * fog);
    a.bird = (1 - 0.4 * dust) * (1 - 0.85 * hush) * (1 - 0.3 * fog);
    a.cricket = (1 - 0.85 * hush) * (1 - 0.4 * dust);
    a.howl = 1 - 0.9 * hush;
  }

  /** Fog multipliers and tint, or null while nothing is thickening the air. */
  fogState() { return this.fx.k > 0.002 ? this.fx : null; }

  /** The season's sound table with the events' changes on top (the table itself when nothing is going on). */
  ambience(base) {
    if (!this.lv.dust && !this.lv.hush && !this.lv.fog) return base;
    const b = base || NEUTRAL_AMB, a = this.amb, out = this._amb || (this._amb = {});
    out.wind = b.wind * a.wind; out.bird = b.bird * a.bird; out.cricket = b.cricket * a.cricket; out.howl = b.howl * a.howl;
    return out;
  }

  /** Monsters keep their voices down on a Hush Night: the chance (0..1) a monster's ambient sound is made. */
  monsterVoice() {
    const h = this.lv.hush;
    return h > 0.05 ? 1 - 0.8 * h : 1;
  }
  /** How much further Hush Sensors hear (a factor, 1 when nothing is going on). */
  sensorRangeMul() { return this.lv.hush > 0.05 ? 1 + SENSOR_BOOST * Math.min(1, this.lv.hush * 1.2) : 1; }

  dustParticles() {
    const g = this.game, p = g.player, pt = g.particles;
    if (!pt || p.dead || g.world.dimension !== 'overworld') return;
    const n = Math.ceil(this.lv.dust * 6);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 9;
      pt.emit(p.x + Math.cos(a) * r + 6, p.y + 0.3 + Math.random() * 3, p.z + Math.sin(a) * r, -0.5 - Math.random() * 0.3, (Math.random() - 0.5) * 0.04, 0.08 * (Math.random() - 0.5),
        0.78, 0.62, 0.38, 14 + Math.random() * 12, 0.0);
    }
  }

  // ---- announcements and milestones ----
  announce() {
    const g = this.game, hud = g.hud, T = this.target;
    const mark = (key, text, on) => {
      if (on && !this.announced.has(key)) { this.announced.add(key); if (hud && g.ticks > 40) hud.toast(text, 3500); }
      else if (!on && this.announced.has(key)) this.announced.delete(key);
    };
    mark('star', 'Starfall tonight: watch the sky', T.star > 0 && this.lv.star > 0.5);
    mark('dust', 'A dust storm rolls in', T.dust > 0.5);
    mark('fog', 'Ground fog lies thick on the land', T.fog > 0.5);
    mark('hush', 'A Hush Night: even the monsters are quiet', T.hush > 0.5);
    mark('fest', 'The Lantern Festival: the settlers have gathered', T.fest > 0.5);
  }

  milestones() {
    const m = this.game.milestones;
    if (!m) return;
    if (this.lv.dust > 0.5) m.event('dust_storm');
    if (this.lv.fog > 0.5) m.event('ground_fog');
    if (this.lv.hush > 0.5) m.event('hush_night');
    if (this.lv.fest > 0.5) m.event('lantern_fest');
  }

  // ---- meteorites ----
  /** Host: decide the slots that have passed and announce the meteorites they let fall near a player. */
  scheduleMeteors(t, forced) {
    const g = this.game, slot = Math.floor(t / SLOT);
    if (this.lastSlot < 0 || slot - this.lastSlot > 3) this.lastSlot = slot - 1; // (first look, or a long time skipped)
    while (this.lastSlot < slot) {
      this.lastSlot++;
      const m = meteorSlot(this.seed, this.lastSlot);
      if (!m) continue;
      const players = g.net && g.net.players ? g.net.players() : [{ obj: g.player }];
      const who = players[Math.min(players.length - 1, Math.floor(m.pick * players.length))];
      const pos = who && who.c && who.c.rp.state ? who.c.rp.state : g.player;
      this.announceMeteor(this.lastSlot, pos.x + Math.cos(m.angle) * m.dist, pos.z + Math.sin(m.angle) * m.dist, Math.max(20, m.at - t));
    }
  }

  /** A meteorite is on its way: `in` ticks until it lands. On the host this also tells the guests. */
  announceMeteor(id, x, z, inTicks) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    if (this.seen.size > 64) this.seen.delete(this.seen.values().next().value);
    const g = this.game, a = Math.random() * Math.PI * 2;
    this.pending.push({ id, x, z, at: g.ticks + inTicks, total: inTicks, sx: x + Math.cos(a) * 70, sz: z + Math.sin(a) * 70, host: this.authority });
    const p = g.player, sky = g.sky;
    if (sky && sky.meteors && sky.meteors.launch) sky.meteors.launch(Math.atan2(z - p.z, x - p.x), inTicks / 20);
    if (this.authority && g.net && g.net.isHost && g.net.sendEnv) g.net.sendEnv();
  }

  tickPending() {
    const g = this.game, p = g.player, pt = g.particles;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const m = this.pending[i], left = m.at - g.ticks;
      if (left <= 0) { this.pending.splice(i, 1); this.land(m); continue; }
      if (pt && Math.hypot(m.x - p.x, m.z - p.z) < 200) {
        const k = 1 - left / m.total, x = m.sx + (m.x - m.sx) * k, z = m.sz + (m.z - m.sz) * k, y = p.y + 130 * (1 - k) ** 1.5;
        for (let j = 0; j < 4; j++) pt.emit(x + (Math.random() - 0.5), y + (Math.random() - 0.5), z + (Math.random() - 0.5), 0, 0.02, 0, 1, 0.7 + Math.random() * 0.25, 0.25, 18, -0.002);
      }
    }
  }

  /** A meteorite lands: the boom everywhere, the crater where the host can see to it. */
  land(m) {
    const g = this.game, p = g.player, d = Math.hypot(m.x - p.x, m.z - p.z);
    let made = null;
    if (this.authority) made = this.crater(m);
    const y = made ? made.y : p.y;
    if (g.audio) {
      // too far to hear in this world's sound model (16 blocks): play it from the right direction, close by, a little quieter
      const k = d > 14 ? 12 / d : 1, pos = [p.x + (m.x - p.x) * k, y, p.z + (m.z - p.z) * k];
      g.audio.play('meteor_boom', pos, Math.max(0.35, 1 - d / 220));
    }
    if (g.particles && d < 120) {
      const yy = made ? made.y : y;
      g.particles.smoke(m.x, yy + 1, m.z, 50, 3);
      for (let i = 0; i < 24; i++) g.particles.emit(m.x + (Math.random() - 0.5) * 2, yy + 1, m.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 0.4, 0.2 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4, 1, 0.6 + Math.random() * 0.3, 0.2, 30, 0.03);
    }
    if (d < 160 && g.milestones) g.milestones.event('meteor');
    if (d < 40 && g.hud) g.hud.toast('A meteorite has fallen nearby', 3500);
  }

  /** Dig the crater (host/solo). Returns { x, y, z } or null when the ground is not fit (water, unloaded). */
  crater(m) {
    const g = this.game, w = g.world, x = Math.floor(m.x), z = Math.floor(m.z);
    if (!w.isLoaded(x - 5, z - 5) || !w.isLoaded(x + 5, z + 5)) return null;
    const y = this.groundY(w, x, z);
    if (y === null || (w.gen && villagesNear(w.gen, x - 12, z - 12, x + 12, z + 12).length)) return null;
    const plan = craterPlan(this.seed, m.id, x, y, z);
    for (const [bx, by, bz] of plan.clear) if (w.getBlock(bx, by, bz) !== B.AIR && BLOCKS[w.getBlock(bx, by, bz)] && BLOCKS[w.getBlock(bx, by, bz)].hardness >= 0) w.setBlock(bx, by, bz, B.AIR);
    for (const [bx, by, bz, id] of plan.set) w.setBlock(bx, by, bz, id);
    this.sites.push([x, y - 2, z, Math.floor(g.time / DAY)]);
    if (this.sites.length > 12) this.sites.shift();
    return { x, y, z };
  }

  /** The y of the ground block at (x, z), skipping trees; null over water. */
  groundY(w, x, z) {
    const top = w.heightAt(x, z) + 3;
    for (let y = top; y > top - 16; y--) {
      const id = w.getBlock(x, y, z), d = BLOCKS[id];
      if (id === B.WATER || (d && d.liquid)) return null;
      if (SOLID[id] && d && !/Leaves|Log|Wood/.test(d.name)) return y;
    }
    return null;
  }

  // ---- the festival ----
  /** Find the villages near the players that hold the festival now. */
  refreshFestival(t, now) {
    const g = this.game, w = g.world, gen = w.gen, st = g.seasons ? g.seasons.at(t) : null;
    const forced = this.forced.festival && this.forced.festival.until > t ? this.forced.festival : null;
    const day = isFestivalDay(st) && eveningLevel(t) > 0.01;
    this.festOn = !!(gen && (day || forced));
    if (!this.festOn) { if (this.fest.size) this.fest.clear(); return; }
    const next = new Map();
    const spots = this.playerSpots();
    const level = day ? eveningLevel(t) : 0;
    for (const s of spots) {
      for (const v of villagesNear(gen, s.x - 140, s.z - 140, s.x + 140, s.z + 140)) {
        const key = villageKey(v.cx, v.cz);
        const lvl = forced && forced.key === key ? Math.max(level, ramp(t, forced.until - (forced.len || 6000), forced.until, 300)) : day && villageHosts(this.seed, key, st.year) ? level : 0;
        if (lvl > 0.01) next.set(key, { cx: v.cx, cz: v.cz, y: v.y, v, level: lvl });
      }
    }
    this.fest = next;
  }

  playerSpots() {
    const g = this.game, out = [{ x: g.player.x, z: g.player.z }];
    if (this.authority && g.net && g.net.players) for (const pl of g.net.players().slice(1)) if (pl.c && pl.c.rp.state) out.push(pl.c.rp.state);
    return out;
  }

  /** Is the festival on in the village `key` right now (0..1)? Prices and settlers ask this. */
  festivalIn(key) {
    if (!this.fest.size || !key || !this.enabled) return 0;
    const f = this.fest.get(key);
    return f ? f.level : 0;
  }

  /** Where the settler `mob` should be for the festival, or null. */
  gatherPoint(mob) {
    if (!this.fest.size) return null;
    const key = mob.villageId ? mob.villageId(this.game) : mob.village;
    const f = key && this.fest.get(key);
    return f && f.level > 0.35 && mob.age >= 0 ? gatherSpot(f, mob.id) : null;
  }

  /** The price cut the player `holder` gets at the village `key` now. */
  cutFor(key, holder) {
    const lvl = this.festivalIn(key);
    return lvl > 0.5 ? festivalCut(getRep(holder, key)) : 0;
  }

  /** Host: hang the lanterns while a festival is on, take them down when it is over; goodwill for those who stay. */
  festivalWorld(t) {
    const g = this.game, w = g.world;
    for (const [key, f] of this.fest) {
      if (f.level > 0.5 && !this.lanterns.some((l) => l[3] === key) && w.isLoaded(f.cx, f.cz)) this.hangLanterns(key, f.v);
      this.goodwill(key, f);
    }
    if (this.lanterns.length) this.removeLanterns(false);
  }

  hangLanterns(key, v) {
    const w = this.game.world;
    for (const s of lanternSpots(v, w)) {
      if (w.getBlock(s.x, s.y, s.z) !== B.AIR) continue;
      w.setBlock(s.x, s.y, s.z, B.LANTERN, s.hang ? 1 : 0);
      this.lanterns.push([s.x, s.y, s.z, key]);
    }
  }

  /** Take down the lanterns of festivals that are over (`all`: every one). Only those in loaded land; the rest wait. */
  removeLanterns(all) {
    const w = this.game.world, keep = [];
    for (const l of this.lanterns) {
      const over = all || !this.festOn;
      if (!over) { keep.push(l); continue; }
      if (!w.isLoaded(l[0], l[2])) { keep.push(l); continue; }
      if (w.getBlock(l[0], l[1], l[2]) === B.LANTERN) w.setBlock(l[0], l[1], l[2], B.AIR);
    }
    this.lanterns = keep;
  }

  /** Staying for the festival earns a little goodwill, once a year per player and village. */
  goodwill(key, f) {
    const g = this.game, st = g.seasons ? g.seasons.at(g.time) : null, year = st ? st.year : 0;
    if (f.level < 0.5 || !this.authority) return;
    const players = g.net && g.net.players ? g.net.players() : [{ obj: g.player, name: 'me' }];
    for (const pl of players) {
      const pos = pl.c && pl.c.rp.state ? pl.c.rp.state : g.player;
      if (Math.hypot(pos.x - f.cx, pos.z - f.cz) > 45) continue;
      const id = `${key}:${year}:${pl.name || 'me'}`;
      if (this.attended.includes(id)) continue;
      if (refusesTrade(getRep(pl.obj, key))) continue; // a village that has turned on someone does not take them in
      this.attended.push(id);
      if (this.attended.length > 80) this.attended.shift();
      this.addGoodwill(pl.obj, key);
    }
  }
  addGoodwill(who, key) { // (kept apart so tests and the guest path share it)
    const g = this.game;
    repEvent(g, who, key, REP.festival);
  }

  // ---- commands ----
  /** /event [list|trigger <kind>|stop <kind|all>] */
  command(args) {
    const g = this.game, p = g.player, t = g.time;
    const sub = (args[0] || 'list').toLowerCase();
    const kindOf = (s) => EVENT_ORDER.find((k) => k === (s || '').toLowerCase() || EVENT_KINDS[k].name.toLowerCase().replace(/ /g, '_') === (s || '').toLowerCase() || (s && s.length >= 3 && k.startsWith(s.toLowerCase())));
    if (sub === 'list' || sub === 'status') {
      const st = g.seasons ? g.seasons.at(t) : null;
      const lines = [`World events are ${this.enabled ? 'on' : 'off  [/gamerule doWorldEvents true]'}`];
      for (const k of EVENT_ORDER) lines.push(`  ${k}: ${EVENT_KINDS[k].name} - ${this.statusOf(k, t, st)}`);
      lines.push('  /event trigger <' + EVENT_ORDER.join('|') + '>,  /event stop <kind|all>');
      return lines;
    }
    const allowed = p.creative || !g.net || g.net.isHost;
    if (sub === 'trigger' || sub === 'start') {
      if (!allowed) return 'Only creative players and the host can trigger events';
      const k = kindOf(args[1]);
      if (!k) return 'Usage: /event trigger <' + EVENT_ORDER.join('|') + '>';
      if (!this.enabled) return 'World events are off: /gamerule doWorldEvents true';
      return this.trigger(k);
    }
    if (sub === 'stop' || sub === 'end') {
      if (!allowed) return 'Only creative players and the host can end events';
      if ((args[1] || '').toLowerCase() === 'all') { this.forced = {}; this.afterForce(); return 'All forced events ended'; }
      const k = kindOf(args[1]);
      if (!k) return 'Usage: /event stop <' + EVENT_ORDER.join('|') + '|all>';
      delete this.forced[k]; this.afterForce();
      return `${EVENT_KINDS[k].name} ended (one that belongs to the calendar ends in its own time)`;
    }
    return 'Usage: /event [list],  /event trigger <' + EVENT_ORDER.join('|') + '>,  /event stop <kind|all>';
  }

  statusOf(k, t, st) {
    const g = this.game, left = (until) => `${Math.ceil((until - t) / 1200)} min`;
    if (this.forced[k] && this.forced[k].until > t) return `running (started by hand, ${left(this.forced[k].until)} left)`;
    const seed = this.seed, season = this.season(t), day = Math.floor(t / DAY);
    switch (k) {
      case 'starfall': {
        if (starfallNight(t)) return 'a Starfall night is under way';
        for (let d = day; d < day + 60; d++) if (nightCharacter(d).starfall) return d === day ? 'tonight' : `next Starfall night in ${d - day} day${d - day === 1 ? '' : 's'}`;
        return 'none in sight';
      }
      case 'dust': {
        const s = dustStorm(seed, day, season);
        return s && s.end > t ? (s.start <= t ? 'blowing now in deserts and badlands' : 'later today in deserts and badlands') : 'none today';
      }
      case 'fog': return fogLevel(seed, t, season) > 0.05 ? 'lying on swamps and forests' : 'not now';
      case 'festival': {
        if (!st) return 'no calendar';
        for (let i = 0; i < st.days * 4; i++) if (isFestivalDay(g.seasons.at(t + i * DAY))) return i === 0 ? (this.festOn ? 'under way in nearby villages' : 'today, in some villages') : `autumn day ${festivalDay(st.days)}, in ${i} day${i === 1 ? '' : 's'}`;
        return 'none in sight';
      }
      case 'hush': return hushNight(seed, day) ? (darkness(t) > 0.1 ? 'a Hush Night is under way' : 'tonight') : 'not tonight';
      default: return '';
    }
  }

  /** Start an event by hand; returns the message for the chat. */
  trigger(k) {
    const g = this.game, t = g.time, len = EVENT_KINDS[k].duration, p = g.player;
    if (k === 'festival') {
      const gen = g.world.gen, vs = gen ? villagesNear(gen, p.x - 420, p.z - 420, p.x + 420, p.z + 420) : [];
      if (!vs.length) return 'No village within reach to hold a festival';
      vs.sort((a, b) => Math.hypot(a.cx - p.x, a.cz - p.z) - Math.hypot(b.cx - p.x, b.cz - p.z));
      const v = vs[0], key = villageKey(v.cx, v.cz);
      this.forced.festival = { until: t + len, len, key };
      this.afterForce();
      return `The Lantern Festival begins in the village at ${v.cx}, ${v.cz}`;
    }
    this.forced[k] = { until: t + len, len };
    if (k === 'starfall') {
      const players = this.playerSpots();
      players.forEach((s, i) => {
        for (let j = 0; j < 3; j++) {
          const a = Math.random() * Math.PI * 2, d = METEOR_RANGE[0] + Math.random() * (METEOR_RANGE[1] - METEOR_RANGE[0]);
          this.announceMeteor(-1000 - Math.floor(Math.random() * 1e6), s.x + Math.cos(a) * d, s.z + Math.sin(a) * d, ANNOUNCE + j * 90 + i * 20);
        }
      });
    }
    this.afterForce();
    return `${EVENT_KINDS[k].name} begins`;
  }

  /** After a forced event started or stopped: look again now, and tell the guests. */
  afterForce() {
    this.refresh();
    const g = this.game;
    if (this.authority && g.net && g.net.isHost && g.net.sendEnv) g.net.sendEnv();
  }

  /** The rule changed (/gamerule doWorldEvents). */
  onRule() { if (!this.enabled) this.shutDown(); else this.refresh(); }

  // ---- multiplayer ----
  /** What goes in the env message (optional field `ev`): the rule, the events started by hand, meteorites in flight. */
  syncOut() {
    const g = this.game, out = { on: this.enabled ? 1 : 0 };
    const f = Object.keys(this.forced).filter((k) => this.forced[k].until > g.time).map((k) => [k, Math.floor(this.forced[k].until), this.forced[k].key || 0]);
    if (f.length) out.f = f;
    const m = this.pending.filter((e) => e.host && e.at - g.ticks > 4).map((e) => [e.id, Math.round(e.x), Math.round(e.z), e.at - g.ticks]);
    if (m.length) out.m = m;
    return out;
  }

  /** Guest: take in the host's `ev` (anything missing or odd is ignored). */
  syncIn(ev) {
    if (!ev || typeof ev !== 'object') return;
    const g = this.game;
    if (typeof ev.on === 'number' || typeof ev.on === 'boolean') {
      const on = !!ev.on;
      if (on !== this.enabled) { g.settings.worldEvents = on; this.onRule(); }
    }
    const forced = {};
    if (Array.isArray(ev.f)) for (const e of ev.f.slice(0, 8)) {
      if (Array.isArray(e) && EVENT_KINDS[e[0]] && Number.isFinite(e[1])) forced[e[0]] = { until: e[1], len: EVENT_KINDS[e[0]].duration, key: typeof e[2] === 'string' ? e[2] : undefined };
    }
    const before = Object.keys(this.forced).sort().join();
    this.forced = forced;
    if (Object.keys(forced).sort().join() !== before) this.refresh();
    if (Array.isArray(ev.m)) for (const e of ev.m.slice(0, 8)) {
      if (Array.isArray(e) && Number.isFinite(e[0]) && Number.isFinite(e[1]) && Number.isFinite(e[2]) && Number.isFinite(e[3]) && e[3] > 0 && e[3] < 1200) this.announceMeteor(e[0], e[1], e[2], e[3] | 0);
    }
  }

  // ---- saving ----
  save() {
    const o = {};
    if (this.lastSlot >= 0) o.slot = this.lastSlot;
    if (this.sites.length) o.sites = this.sites;
    if (this.lanterns.length) o.lan = this.lanterns.slice(-200);
    if (this.attended.length) o.att = this.attended.slice(-60);
    return Object.keys(o).length ? o : undefined;
  }

  load(d) {
    if (!d || typeof d !== 'object') return;
    const num = (a, n) => Array.isArray(a) && a.length >= n && a.slice(0, n).every(Number.isFinite);
    if (Number.isFinite(d.slot)) this.lastSlot = Math.floor(d.slot);
    if (Array.isArray(d.sites)) this.sites = d.sites.filter((s) => num(s, 4)).slice(-12).map((s) => s.slice(0, 4).map(Math.floor));
    if (Array.isArray(d.lan)) this.lanterns = d.lan.filter((l) => num(l, 3) && typeof l[3] === 'string').slice(-200).map((l) => [Math.floor(l[0]), Math.floor(l[1]), Math.floor(l[2]), l[3]]);
    if (Array.isArray(d.att)) this.attended = d.att.filter((a) => typeof a === 'string' && a.length < 80).slice(-60);
  }
}

/** The market a trade is priced in: the settler's village reputation, and the festival cut when there is one. */
export function tradeMarket(game, key, holder) {
  const m = { rep: getRep(holder, key) };
  const e = game && game.worldEvents;
  if (e && key) { const cut = e.cutFor(key, holder); if (cut > 0) m.festival = cut; }
  return m;
}
