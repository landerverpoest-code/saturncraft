// Biome table. Temperatures/humidity drive tint colours; spawn tables are
// defined in mobs/spawnTables.js keyed by biome key.
export const BIOME = {
  OCEAN: 0, FROZEN_OCEAN: 1, BEACH: 2, PLAINS: 3, FOREST: 4, BIRCH_FOREST: 5,
  TAIGA: 6, SNOWY_PLAINS: 7, DESERT: 8, STONY_PEAKS: 9, SNOWY_PEAKS: 10,
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
  { id: 8, key: 'desert', name: 'Desert', temp: 2.0, humid: 0.0 },
  { id: 9, key: 'stony_peaks', name: 'Stony Peaks', temp: 1.0, humid: 0.3 },
  { id: 10, key: 'snowy_peaks', name: 'Snowy Peaks', temp: -0.7, humid: 0.9 },
];

export function biomeName(id) { return BIOMES[id] ? BIOMES[id].name : '?'; }
