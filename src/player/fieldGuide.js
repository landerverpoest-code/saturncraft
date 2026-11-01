// Field Guide discovery state (pure, no game data): what this player has seen, found or picked up.
// The guide lives on Player.stats.guide, so it is saved and loaded with the statistics (player/stats.js).
// Four tabs, each a table of key -> { l: level, t: play-time ticks of the first discovery }:
//  * creatures:  key = MOBS key; level 1 seen, 2 defeated
//  * biomes:     key = biome key; level 1 visited
//  * structures: key = landmark kind; level 1 located (an Explorer Chart marked it), 2 visited (x, z note where)
//  * items:      key = item id; level 1 obtained
// The entries a tab *could* show are generated from the game's data tables (player/fieldGuideEntries.js).
export const TABS = ['creatures', 'biomes', 'structures', 'items'];
export const LEVEL = { SEEN: 1, KILLED: 2, VISITED: 1, LOCATED: 1, FOUND: 2, OBTAINED: 1 };

const MAX_KEYS = 400;
const MAX_KEY_LEN = 40;
const GUEST_KEY = 'saturncraft.fieldGuide.guest';

export const newGuide = () => ({ creatures: {}, biomes: {}, structures: {}, items: {} });

const int = (v, max = 1e9) => (Number.isFinite(v) && v >= 0 ? Math.min(max, Math.floor(v)) : 0);

/** A guide from saved data (anything missing or damaged is dropped). */
export function loadGuide(d) {
  const g = newGuide();
  if (!d || typeof d !== 'object') return g;
  for (const tab of TABS) {
    const src = d[tab];
    if (!src || typeof src !== 'object') continue;
    for (const [key, r] of Object.entries(src).slice(0, MAX_KEYS)) {
      if (key.length === 0 || key.length > MAX_KEY_LEN || !r || typeof r !== 'object') continue;
      const l = int(r.l, 9);
      if (l < 1) continue;
      const rec = { l, t: int(r.t) };
      if (Number.isFinite(r.x) && Number.isFinite(r.z)) { rec.x = Math.round(r.x); rec.z = Math.round(r.z); }
      g[tab][key] = rec;
    }
  }
  return g;
}

/** The data to save: a plain copy. */
export const saveGuide = (g) => loadGuide(g);

/** The guide on a statistics object (made when an old or partial object lacks one). */
export function guideOf(stats) {
  if (!stats.guide || typeof stats.guide !== 'object') stats.guide = newGuide();
  for (const tab of TABS) if (!stats.guide[tab] || typeof stats.guide[tab] !== 'object') stats.guide[tab] = {};
  return stats.guide;
}

let listener = null;
/** One function is told of every new discovery: (guide, tab, key, level). The game uses it for the toast. */
export function onDiscover(fn) { listener = fn; }

/**
 * Note a discovery. Returns true when the entry is new or its level went up (a creature seen, then
 * defeated), false when nothing changed. `at` is the play time in ticks, `site` an optional { x, z }.
 */
export function discover(guide, tab, key, level = 1, at = 0, site = null) {
  if (!guide || !guide[tab] || typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LEN) return false;
  const have = guide[tab][key];
  if (have && have.l >= level) return false;
  if (!have && Object.keys(guide[tab]).length >= MAX_KEYS) return false;
  const rec = { l: level, t: have ? have.t : int(at) };
  const s = site || (have && Number.isFinite(have.x) ? have : null);
  if (s) { rec.x = Math.round(s.x); rec.z = Math.round(s.z); }
  guide[tab][key] = rec;
  if (listener) listener(guide, tab, key, level);
  return true;
}

/** The record of one entry, or null. */
export const recordOf = (guide, tab, key) => (guide && guide[tab] && guide[tab][key]) || null;

/** How many entries of a tab are discovered, among the keys it can show (`keys`: all of its entries). */
export function countFound(guide, tab, keys) {
  if (!guide || !guide[tab]) return 0;
  let n = 0;
  for (const k of keys) if (guide[tab][k]) n++;
  return n;
}

/** Kept on a guest's own machine (a guest's character is not saved by the host). Best effort. */
export function saveGuestGuide(guide, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { if (storage) storage.setItem(GUEST_KEY, JSON.stringify(saveGuide(guide))); return !!storage; } catch { return false; }
}

export function loadGuestGuide(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { const s = storage && storage.getItem(GUEST_KEY); return loadGuide(s ? JSON.parse(s) : null); } catch { return newGuide(); }
}
