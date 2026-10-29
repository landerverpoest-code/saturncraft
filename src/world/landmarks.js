// Landmarks on maps. A held map notes the structures it comes within sight of (SIGHT blocks
// of its holder, inside its own square) and draws a glyph for each; an Explorer Chart makes a
// map of the square round the nearest structure of one kind, pre-surveyed from the terrain
// generator, with that structure already marked as the destination. Everything here is a
// pure function of the seed and the map, so it works the same on hosts and guests.
import { BIOME } from './biomes.js';
import { B } from './blocks.js';
import { SEA_LEVEL } from './constants.js';
import { LANDMARK_BY_KEY, LANDMARK_KINDS } from './landmarkKinds.js';
import { MAP_SIZE, newMap, setPixel, blockMapColor } from './maps.js';
import { villagesNear } from './villages.js';
import { templesNear, outpostsNear } from './temples.js';
import { hutsNear } from './swampHuts.js';
import { igloosNear } from './igloos.js';
import { wrecksNear } from './shipwrecks.js';
import { monumentsNear, nearestMonument } from './monuments.js';
import { sunkenRuinsNear, nearestSunkenRuin } from './sunkenRuins.js';
import { sunTombsNear, nearestSunTomb } from './sunTombs.js';
import { skywatchesNear, nearestSkywatch } from './skywatch.js';

export const SIGHT = 40;      // how close a holder must come to a structure for the map to note it
export const MAX_MARKS = 48;  // marks one map keeps (destinations first)
export const CHART_RANGE = 3200;

/** Structure finders by kind: near(gen, x0, z0, x1, z1) -> sites with cx, cz; nearest(gen, x, z) where one exists. */
const FINDERS = {
  village: { near: villagesNear },
  temple: { near: templesNear },
  igloo: { near: igloosNear },
  outpost: { near: outpostsNear },
  hut: { near: hutsNear },
  wreck: { near: wrecksNear },
  citadel: { near: monumentsNear, nearest: nearestMonument },
  sunken: { near: sunkenRuinsNear, nearest: nearestSunkenRuin },
  tomb: { near: sunTombsNear, nearest: nearestSunTomb },
  skywatch: { near: skywatchesNear, nearest: nearestSkywatch },
};

/** Every landmark of every kind whose centre lies in the box: [{ kind, x, z }]. */
export function landmarksInBox(gen, x0, z0, x1, z1) {
  const out = [];
  for (const { key } of LANDMARK_KINDS) {
    for (const s of FINDERS[key].near(gen, x0, z0, x1, z1)) {
      if (s.cx >= x0 && s.cx <= x1 && s.cz >= z0 && s.cz <= z1) out.push({ kind: key, x: s.cx, z: s.cz });
    }
  }
  return out;
}

/**
 * The nearest structure of a kind to (x, z) as { kind, x, z, dist }, or null when none lies
 * within `range` blocks. Kinds with a ring search of their own use it; the rest search
 * growing boxes.
 */
export function nearestLandmark(gen, kind, x, z, range = CHART_RANGE) {
  const f = FINDERS[kind];
  if (!f) return null;
  const done = (s) => ({ kind, x: s.cx, z: s.cz, dist: Math.hypot(s.cx - x, s.cz - z) });
  if (f.nearest) {
    const s = f.nearest(gen, x, z);
    return s && Math.hypot(s.cx - x, s.cz - z) <= range ? done(s) : null;
  }
  for (let r = 256; ; r *= 2) {
    const rr = Math.min(r, range);
    let best = null;
    for (const s of f.near(gen, x - rr, z - rr, x + rr, z + rr)) {
      if (!best || Math.hypot(s.cx - x, s.cz - z) < Math.hypot(best.cx - x, best.cz - z)) best = s;
    }
    if (best && Math.hypot(best.cx - x, best.cz - z) <= rr) return done(best);
    if (rr >= range) return null;
  }
}

/** Add a mark (world coordinates) if it lies inside the map's square; returns true when something changed. */
export function addMark(map, kind, x, z, target = false) {
  if (!LANDMARK_BY_KEY[kind]) return false;
  x = Math.floor(x); z = Math.floor(z);
  if (x < map.x0 || z < map.z0 || x >= map.x0 + MAP_SIZE || z >= map.z0 + MAP_SIZE) return false;
  map.marks = map.marks || [];
  const old = map.marks.find((m) => m.kind === kind && m.x === x && m.z === z);
  if (old) { if (target && !old.target) { old.target = true; return true; } return false; }
  if (map.marks.length >= MAX_MARKS) {
    const i = map.marks.findIndex((m) => !m.target);
    if (i < 0) return false;
    map.marks.splice(i, 1);
  }
  map.marks.push(target ? { kind, x, z, target: true } : { kind, x, z });
  return true;
}

/** The holder walks by: note every structure of the map's square within `sight` of (px, pz). Returns the number of new marks. */
export function noteLandmarks(map, gen, px, pz, sight = SIGHT) {
  const x0 = Math.max(map.x0, Math.floor(px - sight)), x1 = Math.min(map.x0 + MAP_SIZE - 1, Math.floor(px + sight));
  const z0 = Math.max(map.z0, Math.floor(pz - sight)), z1 = Math.min(map.z0 + MAP_SIZE - 1, Math.floor(pz + sight));
  if (x0 > x1 || z0 > z1) return 0;
  let added = 0;
  for (const l of landmarksInBox(gen, x0, z0, x1, z1)) {
    if (Math.hypot(l.x - px, l.z - pz) <= sight && addMark(map, l.kind, l.x, l.z)) added++;
  }
  return added;
}

// ---- surveyed terrain for charts ---------------------------------------------------------
const SURVEY_STEP = 2;
function groundBlock(biome) {
  switch (biome) {
    case BIOME.DESERT: case BIOME.BEACH: return B.SAND;
    case BIOME.BADLANDS: return B.RED_SAND;
    case BIOME.SNOWY_PLAINS: case BIOME.SNOWY_TAIGA: case BIOME.SNOWY_PEAKS: case BIOME.FROZEN_OCEAN: case BIOME.FROZEN_RIVER: return B.SNOW_BLOCK;
    case BIOME.STONY_PEAKS: return B.STONE;
    default: return B.GRASS;
  }
}

/**
 * Draw the whole square of `map` from the terrain generator alone, in blocks of
 * SURVEY_STEP x SURVEY_STEP: grass, sand or snow by biome, water darker where it is deeper,
 * land brighter or darker where it rises or falls to the north. A real walk over the ground
 * paints over it, column by column. Returns the number of pixels set.
 */
export function surveyMap(map, gen) {
  let n = 0;
  const rows = new Map();
  const sample = (x, z) => {
    const k = x + ',' + z;
    let s = rows.get(k);
    if (!s) {
      const col = gen.column(x, z), top = gen.surfaceAt(x, z, col);
      s = { top, biome: gen.biomeFor(col, top) };
      rows.set(k, s);
    }
    return s;
  };
  for (let mz = 0; mz < MAP_SIZE; mz += SURVEY_STEP) {
    for (let mx = 0; mx < MAP_SIZE; mx += SURVEY_STEP) {
      const x = map.x0 + mx + 1, z = map.z0 + mz + 1;
      const { top, biome } = sample(x, z);
      let c, f;
      if (top < SEA_LEVEL) {
        const depth = SEA_LEVEL - top;
        c = blockMapColor(B.WATER, biome);
        f = depth < 2 ? 1.08 : depth < 5 ? 0.94 : depth < 9 ? 0.82 : 0.7;
      } else {
        c = blockMapColor(groundBlock(biome), biome);
        const north = sample(x, z - SURVEY_STEP).top;
        f = top > north ? 1.1 : top < north ? 0.8 : 0.94;
      }
      for (let dz = 0; dz < SURVEY_STEP; dz++) for (let dx = 0; dx < SURVEY_STEP; dx++) { setPixel(map, mx + dx, mz + dz, c, f); n++; }
    }
    if (rows.size > 4096) rows.clear();
  }
  return n;
}

/**
 * A chart's map: the standard square round the nearest `kind`, surveyed, with the structure
 * marked as the destination. Returns { map, site } or null when there is none in range.
 */
export function chartMap(gen, kind, x, z, id, dimension = 'overworld') {
  const site = nearestLandmark(gen, kind, x, z);
  if (!site) return null;
  const map = newMap(id, site.x, site.z, dimension);
  surveyMap(map, gen);
  addMark(map, kind, site.x, site.z, true);
  return { map, site };
}

/** A map's name from its destination mark ("Sun Tomb Map"), or null when it has none. */
export function mapTitle(map) {
  const t = map.marks && map.marks.find((m) => m.target);
  return t ? `${LANDMARK_BY_KEY[t.kind].name} Map` : null;
}
