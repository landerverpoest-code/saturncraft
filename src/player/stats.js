// Statistics (the reference game's statistics screen, with Saturncraft's own names): counters the
// player's actions add to, kept on Player.stats, saved with the world and shown from the pause menu.
// Everything here is plain arithmetic on a small object, so recording costs nothing per tick:
//  * blocks mined and placed, kills (in total and by kind of mob), deaths and trades are integers,
//  * the distances walked, swum and glided are blocks (floats) added up from the per-tick movement,
//  * play time counts the ticks the world has run under the player (20 per second).
// Pure rules are exported for the tests.
import { newGuide, loadGuide, guideOf, discover, LEVEL } from './fieldGuide.js';

export const TICKS_PER_SECOND = 20;
/** A move longer than this in one tick is a teleport, a respawn or a portal, not travel. */
export const MAX_STEP = 4;

const MAX_KINDS = 200;
const COUNTERS = ['blocksMined', 'blocksPlaced', 'kills', 'deaths', 'trades', 'walked', 'swum', 'glided', 'ticks'];

/** Fresh statistics. */
export const newStats = () => ({ blocksMined: 0, blocksPlaced: 0, kills: 0, killsBy: {}, deaths: 0, trades: 0, walked: 0, swum: 0, glided: 0, ticks: 0, guide: newGuide() });

const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

/** Statistics from saved data (anything missing or damaged becomes 0). */
export function loadStats(d) {
  const s = newStats();
  if (!d || typeof d !== 'object') return s;
  s.guide = loadGuide(d.guide); // the Field Guide's discoveries (player/fieldGuide.js)
  for (const k of COUNTERS) s[k] = num(d[k]);
  for (const k of ['blocksMined', 'blocksPlaced', 'kills', 'deaths', 'trades', 'ticks']) s[k] = Math.floor(s[k]);
  if (d.killsBy && typeof d.killsBy === 'object') {
    for (const [type, n] of Object.entries(d.killsBy).slice(0, MAX_KINDS)) if (type.length <= 40 && num(n) >= 1) s.killsBy[type] = Math.floor(n);
  }
  return s;
}

/** The data to save: a plain copy (distances rounded to a tenth of a block). */
export function saveStats(s) {
  const o = loadStats(s);
  for (const k of ['walked', 'swum', 'glided']) o[k] = Math.round(o[k] * 10) / 10;
  return o;
}

/** One kill: in total and by the kind of mob (`type` is a MOBS key). */
export function recordKill(s, type) {
  s.kills = (s.kills | 0) + 1;
  if (!type) return;
  if (!s.killsBy) s.killsBy = {};
  s.killsBy[type] = (s.killsBy[type] | 0) + 1;
  discover(guideOf(s), 'creatures', type, LEVEL.KILLED, s.ticks | 0); // a defeated creature is in the Field Guide for good
}

/**
 * Distance travelled in one tick: (dx, dz) is the horizontal move, `mode` the way it was made
 * ('walk', 'swim' or 'glide'). Teleports and anything else huge are ignored.
 */
export function recordMove(s, dx, dz, mode) {
  const d = Math.sqrt(dx * dx + dz * dz);
  if (!(d > 0) || d > MAX_STEP) return;
  if (mode === 'glide') s.glided += d; else if (mode === 'swim') s.swum += d; else s.walked += d;
}

/** The mode a move counts under for a player (null: not travel under their own power, such as riding or flying). */
export function moveMode(p) {
  if (p.riding || p.flying || p.sleeping || p.dead) return null;
  if (p.gliding) return 'glide';
  const b = p.body;
  return b.inWater || p.swimming ? 'swim' : 'walk';
}

/** "1.2 km" / "340 m": a distance in blocks (one block is a metre). */
export function formatDistance(blocks) {
  const n = Math.floor(blocks);
  return n >= 1000 ? `${(blocks / 1000).toFixed(1)} km` : `${n} m`;
}

/** "3 h 05 min" / "12 min 04 s": a duration in ticks. */
export function formatTime(ticks) {
  const total = Math.floor(ticks / TICKS_PER_SECOND);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h} h ${two(m)} min` : `${m} min ${two(sec)} s`;
}

/** The mobs killed, most first (ties by name): [{ type, name, count }]. `defs` maps a kind to its definition (MOBS) for the name. */
export function killRows(s, defs = {}) {
  return Object.entries(s.killsBy || {})
    .filter(([, n]) => n > 0)
    .map(([type, count]) => ({ type, name: (defs[type] && defs[type].name) || type, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** The rows of the statistics screen as [label, value] pairs, in order. */
export function statRows(s) {
  const n = (v) => String(Math.floor(v));
  return [
    ['Play time', formatTime(s.ticks)],
    ['Blocks mined', n(s.blocksMined)],
    ['Blocks placed', n(s.blocksPlaced)],
    ['Distance walked', formatDistance(s.walked)],
    ['Distance swum', formatDistance(s.swum)],
    ['Distance glided', formatDistance(s.glided)],
    ['Monsters and creatures defeated', n(s.kills)],
    ['Deaths', n(s.deaths)],
    ['Trades made', n(s.trades)],
  ];
}
