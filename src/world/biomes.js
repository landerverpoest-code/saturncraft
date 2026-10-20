// Biome table. Temperatures/humidity drive tint colours and precipitation;
// spawn tables are defined in mobs/spawnRules.js keyed by biome key.
// `grass` / `foliage` override the climate-derived tints where a biome has
// its own colour (murky swamps, dry savannas, lush jungles...).
export const BIOME = {
  OCEAN: 0, FROZEN_OCEAN: 1, BEACH: 2, PLAINS: 3, FOREST: 4, BIRCH_FOREST: 5,
  TAIGA: 6, SNOWY_PLAINS: 7, DESERT: 8, STONY_PEAKS: 9, SNOWY_PEAKS: 10,
  SWAMP: 11, JUNGLE: 12, SAVANNA: 13, BADLANDS: 14, DARK_FOREST: 15,
  MUSHROOM_FIELDS: 16, SNOWY_TAIGA: 17, FLOWER_FOREST: 18,
};

export const BIOMES = [
  { id: 0, key: 'ocean', name: 'Ocean', temp: 0.5, humid: 0.5 },
  { id: 1, key: 'frozen_ocean', name: 'Frozen Ocean', temp: 0.0, humid: 0.5 },
  { id: 2, key: 'beach', name: 'Beach', temp: 0.8, humid: 0.4 },
  { id: 3, key: 'plains', name: 'Plains', temp: 0.8, humid: 0.4 },
  { id: 4, key: 'forest', name: 'Forest', temp: 0.7, humid: 0.8 },
  { id: 5, key: 'birch_forest', name: 'Birch Forest', temp: 0.6, humid: 0.6 },
  { id: 6, key: 'taiga', name: 'Taiga', temp: 0.25, humid: 0.8 },
  { id: 7, key: 'snowy_plains', name: 'Snowy Plains', temp: 0.0, humid: 0.5 },
  { id: 8, key: 'desert', name: 'Desert', temp: 2.0, humid: 0.0, dry: true },
  { id: 9, key: 'stony_peaks', name: 'Stony Peaks', temp: 1.0, humid: 0.3 },
  { id: 10, key: 'snowy_peaks', name: 'Snowy Peaks', temp: -0.7, humid: 0.9 },
  { id: 11, key: 'swamp', name: 'Swamp', temp: 0.8, humid: 0.9, grass: [106, 112, 57], foliage: [96, 108, 48] },
  { id: 12, key: 'jungle', name: 'Jungle', temp: 0.95, humid: 0.9, grass: [89, 201, 60], foliage: [48, 187, 11] },
  { id: 13, key: 'savanna', name: 'Savanna', temp: 2.0, humid: 0.0, dry: true, grass: [191, 183, 85], foliage: [174, 164, 42] },
  { id: 14, key: 'badlands', name: 'Badlands', temp: 2.0, humid: 0.0, dry: true, grass: [144, 129, 77], foliage: [158, 129, 77] },
  { id: 15, key: 'dark_forest', name: 'Dark Forest', temp: 0.7, humid: 0.8, grass: [80, 122, 50], foliage: [58, 116, 34] },
  { id: 16, key: 'mushroom_fields', name: 'Mushroom Fields', temp: 0.9, humid: 1.0, grass: [85, 201, 63], foliage: [43, 187, 15] },
  { id: 17, key: 'snowy_taiga', name: 'Snowy Taiga', temp: -0.5, humid: 0.4 },
  { id: 18, key: 'flower_forest', name: 'Flower Forest', temp: 0.7, humid: 0.8 },
];

export function biomeName(id) { return BIOMES[id] ? BIOMES[id].name : '?'; }
