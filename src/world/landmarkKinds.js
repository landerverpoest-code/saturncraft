// The kinds of landmark a map can show (no imports, so saves and the overlay can use it).
// A map marks a structure once its holder has walked within sight of it (world/landmarks.js),
// and an Explorer Chart marks its destination at once. `shape` is the glyph the map draws.
export const LANDMARK_KINDS = [
  { key: 'village', name: 'Village', color: '#f0c040', shape: 'house' },
  { key: 'temple', name: 'Temple', color: '#e8a050', shape: 'diamond' },
  { key: 'igloo', name: 'Igloo', color: '#bfe8ff', shape: 'dome' },
  { key: 'outpost', name: 'Raider Outpost', color: '#c03030', shape: 'tower' },
  { key: 'hut', name: 'Swamp Hut', color: '#6a8a3a', shape: 'house' },
  { key: 'wreck', name: 'Shipwreck', color: '#8a6038', shape: 'boat' },
  { key: 'citadel', name: 'Tide Citadel', color: '#30c0b0', shape: 'star' },
  { key: 'sunken', name: 'Sunken Ruins', color: '#3a7ae0', shape: 'diamond' },
  { key: 'tomb', name: 'Sun Tomb', color: '#ffd040', shape: 'pyramid' },
  { key: 'skywatch', name: 'Skywatch Tower', color: '#e0e0f0', shape: 'tower' },
];
export const LANDMARK_BY_KEY = Object.fromEntries(LANDMARK_KINDS.map((k) => [k.key, k]));
export const isLandmarkKind = (k) => typeof k === 'string' && Object.hasOwn(LANDMARK_BY_KEY, k);
