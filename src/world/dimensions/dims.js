// Dimension registry: the overworld, the Cinderdeep (fiery underworld under a
// bedrock ceiling, 1 block there = 8 here) and the Hollow (floating islands
// in a starry void, home of the Void Wyrm). Pure data + helpers shared by the
// worker (generation), the world and the game.
import { TerrainGenerator } from '../generator.js';
import { CinderdeepGenerator } from './cinderdeep.js';
import { HollowGenerator } from './hollow.js';

export const DIM = { OVERWORLD: 'overworld', CINDERDEEP: 'cinderdeep', HOLLOW: 'hollow' };

export const DIMENSIONS = {
  overworld: { key: 'overworld', name: 'Overworld', scale: 1, minY: -64, maxY: 319 },
  cinderdeep: {
    key: 'cinderdeep', name: 'the Cinderdeep', scale: 8, minY: 0, maxY: 127,
    floorY: 0, ceilingY: 127, lavaLevel: 31,
    fog: [0.2, 0.035, 0.018], fogNear: 0.1, fogFar: 0.8, ambient: 0.18, entityLight: 0.5,
  },
  hollow: {
    key: 'hollow', name: 'the Hollow', scale: 1, minY: 0, maxY: 255,
    fog: [0.05, 0.025, 0.08], fogNear: 0.9, fogFar: 1.8, ambient: 0.05, entityLight: 0.35,
  },
};

export const DIM_KEYS = Object.keys(DIMENSIONS);

/** Resolve a user-typed dimension name (only our own names are accepted). */
export function dimensionByName(name) {
  const n = String(name || '').toLowerCase().replace(/^the[_ ]?/, '').replace(/[^a-z]/g, '');
  const aliases = { overworld: 'overworld', surface: 'overworld', world: 'overworld', cinderdeep: 'cinderdeep', cinder: 'cinderdeep', underworld: 'cinderdeep', deep: 'cinderdeep', hollow: 'hollow', void: 'hollow' };
  return aliases[n] || null;
}

const genCache = new Map();
/** Terrain generator for a dimension (one per dimension and seed). */
export function createGenerator(dimension, seed) {
  const k = `${dimension}:${seed}`;
  if (genCache.has(k)) return genCache.get(k);
  let g;
  if (dimension === DIM.CINDERDEEP) g = new CinderdeepGenerator(seed);
  else if (dimension === DIM.HOLLOW) g = new HollowGenerator(seed);
  else g = new TerrainGenerator(seed);
  if (genCache.size > 8) genCache.clear();
  genCache.set(k, g);
  return g;
}

/**
 * Horizontal coordinate of the matching spot in another dimension
 * (the Cinderdeep is 8 times smaller than the overworld).
 */
export function scaleCoord(v, from, to) {
  const a = DIMENSIONS[from].scale, b = DIMENSIONS[to].scale;
  return v * a / b;
}

/** Clamp a target y into the usable range of a dimension (for portal placement). */
export function clampPortalY(y, dimension) {
  if (dimension === DIM.CINDERDEEP) return Math.max(DIMENSIONS.cinderdeep.lavaLevel + 2, Math.min(118, Math.round(y)));
  if (dimension === DIM.OVERWORLD) return Math.max(-58, Math.min(300, Math.round(y)));
  return Math.round(y);
}
