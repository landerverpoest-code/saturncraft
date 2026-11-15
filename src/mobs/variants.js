// Coat variants for the farm and wild animals: Clucklings, Fleecers, Bristlebacks, Mooxen, Purrlings, Vixlings, Howlers and Gallopers.
//
// A mob's `variant` is an index into VARIANTS[type]. It is rolled once at spawn from the mob's id and the biome it spawns in
// (rollVariant: deterministic, biome weighted), saved with the mob, handed to the young of a bred pair (inheritVariant: one of the two
// parents' coats, with a rare 8 % mutation to another) and sent in the snapshot's woolColor field (bits 8 and up, net/protocol.js).
// variantPalette(type, variant) gives the colour overrides by part name and variantOverlays() the thin boxes (spots, stripes, patches)
// laid over a host part; models.js applies both when it builds the model, and the Field Guide picture uses the palette too.
// This file is pure data and maths (no three.js).

export const MUTATION_CHANCE = 0.08;

export const VARIANTS = {
  cluckling: ['white', 'brown', 'speckled', 'golden'],
  fleecer: ['white', 'cream', 'grey', 'brown', 'blackfaced'],
  bristleback: ['brown', 'black', 'pink', 'spotted'],
  mooxen: ['bluegrey', 'dun', 'patched'],
  purrling: ['tabby', 'black', 'white', 'ginger', 'pointed'],
  vixling: ['red', 'snow', 'grey'],
  howler: ['grey', 'black', 'whitechest', 'tan'],
  galloper: ['chestnut', 'bay', 'grey', 'black', 'piebald'],
};

export const hasVariants = (type) => !!VARIANTS[type];
export const variantCount = (type) => (VARIANTS[type] ? VARIANTS[type].length : 0);
export const variantName = (type, v) => (VARIANTS[type] ? VARIANTS[type][v] : undefined);
/** Index of a variant by name (-1 when there is none). */
export const variantIndex = (type, name) => (VARIANTS[type] ? VARIANTS[type].indexOf(name) : -1);
/** The black Purrling of every swamp hut. */
export const HUT_CAT_VARIANT = 1;
/** The dye colour (world/colors.js index) a Fleecer's undyed wool counts as, per variant: what shearing it drops. */
export const FLEECER_WOOL = [0, 0, 8, 12, 0]; // white, cream (white), light grey, brown, black-faced (white)

const COLD = new Set(['snowy_plains', 'snowy_taiga', 'snowy_peaks', 'frozen_ocean', 'frozen_river', 'frozen_deep']);
const COOL = new Set([...COLD, 'taiga']);
const HOT = new Set(['desert', 'savanna', 'badlands']);
const WET = new Set(['swamp', 'mangrove_swamp', 'dark_forest']);
const FAIR = new Set(['plains', 'flower_forest', 'forest', 'birch_forest', 'blossom_grove', 'highland_meadow']);
const ROCKY = new Set(['stony_peaks', 'snowy_peaks', 'highland_meadow']);

/** Spawn weights per variant for a biome key ('' for none). Zero means the coat does not occur there. */
export function variantWeights(type, biome = '') {
  const cold = COLD.has(biome), cool = COOL.has(biome), hot = HOT.has(biome), wet = WET.has(biome), fair = FAIR.has(biome);
  switch (type) {
    case 'cluckling': {
      const w = [40, 40, 17];
      if (wet) w[2] *= 2;
      if (fair) w[0] *= 1.3;
      if (cold) w[0] *= 1.6;
      const s = w[0] + w[1] + w[2];
      return [...w.map((x) => (x / s) * 97), 3]; // golden ones are always 3 %
    }
    case 'fleecer': {
      const w = [50, 20, 12, 10, 8];
      if (cool) { w[0] *= 2; w[2] *= 1.5; }
      if (hot) { w[3] *= 2; w[1] *= 1.5; }
      if (ROCKY.has(biome)) { w[2] *= 2; w[3] *= 1.5; }
      return w;
    }
    case 'bristleback': {
      const w = [45, 20, 20, 15];
      if (wet || biome === 'taiga') w[1] *= 2;
      if (fair) w[2] *= 1.5;
      if (hot || biome === 'jungle') w[3] *= 1.5;
      return w;
    }
    case 'mooxen': {
      const w = [55, 30, 15];
      if (cool) { w[0] *= 0.6; w[1] *= 0.4; w[2] *= 3; }
      if (hot) { w[1] *= 2; w[2] *= 0.3; }
      return w;
    }
    case 'purrling': {
      const w = [35, 15, 15, 25, 10];
      if (cool) w[2] *= 2.5;
      if (hot) { w[4] *= 2; w[3] *= 1.5; }
      if (wet) w[1] *= 2;
      return w;
    }
    case 'vixling': // the snow white coat only belongs to the cold
      return cold ? [15, 70, 15] : biome === 'taiga' ? [55, 25, 20] : [60, 0, 40];
    case 'howler': {
      const w = [45, 15, 20, 20];
      if (cool) { w[0] *= 1.5; w[2] *= 1.5; w[3] *= 0.1; }
      if (hot) { w[3] *= 3; w[0] *= 0.6; }
      if (wet) w[1] *= 2;
      return w;
    }
    case 'galloper': {
      const w = [30, 28, 18, 14, 10];
      if (fair) { w[0] *= 1.3; w[4] *= 1.3; }
      if (hot || ROCKY.has(biome)) w[2] *= 1.5;
      if (wet) w[3] *= 1.5;
      return w;
    }
    default: return [];
  }
}

/** A deterministic random stream (mulberry32) from a seed (a mob id) and a salt. */
export function seededRng(seed, salt = 0) {
  let a = (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(salt | 0, 0xc2b2ae35) + 0x165667b1) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const typeSalt = (type) => { let s = 0; for (const ch of type) s = (s * 31 + ch.charCodeAt(0)) | 0; return s; };

/** Pick an index by weights with a uniform random number r in [0, 1). */
export function pickWeighted(weights, r) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let x = r * total;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] > 0 && x < weights[i]) return i;
    x -= weights[i];
  }
  return weights.length - 1;
}

/** The variant of a mob of `type` with this id spawning in `biome` (0 for types without variants). */
export function rollVariant(type, seed, biome = '') {
  if (!VARIANTS[type]) return 0;
  return pickWeighted(variantWeights(type, biome), seededRng(seed, typeSalt(type))());
}

/** The variant of the young of parents `a` and `b` (variant indexes): one of theirs, 8 % of the time any other coat. */
export function inheritVariant(type, a, b, seed) {
  const n = variantCount(type);
  if (!n) return 0;
  const rng = seededRng(seed, typeSalt(type) + 77);
  const from = rng() < 0.5 ? a | 0 : b | 0;
  const base = from >= 0 && from < n ? from : 0;
  if (rng() < MUTATION_CHANCE && n > 1) { const k = Math.floor(rng() * (n - 1)); return k >= base ? k + 1 : k; }
  return base;
}

/** The variant an old save's coat (Purrling woolColor, Galloper coat, Fleecer dye) comes to today, or undefined. */
export function legacyVariant(type, { woolColor, coat } = {}) {
  if (type === 'purrling' && woolColor !== undefined) return [3, 0, 1, 2, 0, 4][woolColor] ?? 0; // ginger, grey tabby, black, white, brown, cream
  if (type === 'galloper' && coat !== undefined) return [0, 2, 3, 0, 2][coat] ?? 0; // brown, white, black, chestnut, grey
  if (type === 'fleecer' && woolColor !== undefined) return { 7: 2, 8: 2, 12: 3, 15: 4 }[woolColor] ?? 0; // grey, light grey, brown, black
  return undefined;
}

// ---- palettes -------------------------------------------------------------------------

const set = (col, ...names) => Object.fromEntries(names.map((n) => [n, col]));
const legs = (col) => set(col, 'legFL', 'legFR', 'legBL', 'legBR');
const socks = (col) => set(col, 'sockFL', 'sockFR', 'sockBL', 'sockBR');
const sides = (col, ...names) => Object.fromEntries(names.flatMap((n) => [[n + 'L', col], [n + 'R', col]]));
const mix = (...o) => Object.assign({}, ...o);
const bristles = (col) => set(col, 'bristle0', 'bristle1', 'bristle2', 'bristle3');

const PALETTES = {
  cluckling: {
    white: mix(set('#efece4', 'body', 'head'), set('#f8f6f0', 'breast'), set('#d8d4c8', 'backPatch'), sides('#e0dcd0', 'wing'), sides('#bcb6a6', 'wingTip'), set('#cfc9b9', 'tailFan'), set('#b0aa98', 'tailFanB')),
    brown: mix(set('#9a6a3c', 'body', 'head'), set('#c49a68', 'breast'), set('#6e4624', 'backPatch'), sides('#84562c', 'wing'), sides('#4e3018', 'wingTip'), set('#5e3c1e', 'tailFan'), set('#3e2814', 'tailFanB')),
    speckled: mix(set('#2c2a2e', 'body', 'head'), set('#4a4650', 'breast'), set('#1c1a1e', 'backPatch'), sides('#242226', 'wing'), sides('#141216', 'wingTip'), set('#1c1a1e', 'tailFan'), set('#100e12', 'tailFanB')),
    golden: mix(set('#e8b83a', 'body', 'head'), set('#f6d878', 'breast'), set('#c08a1e', 'backPatch'), sides('#d6a22a', 'wing'), sides('#9a6a14', 'wingTip'), set('#b8841a', 'tailFan'), set('#8a5e10', 'tailFanB')),
  },
  fleecer: {
    white: mix(set('#e8e2f0', 'wool', 'tuft'), set('#8a7a80', 'head', 'earL', 'earR'), legs('#8a7a80')),
    cream: mix(set('#efe2c0', 'wool', 'tuft'), set('#a08a78', 'head', 'earL', 'earR'), legs('#a08a78'), set('#d8c4a8', 'skin', 'tail')),
    grey: mix(set('#9a9aa2', 'wool', 'tuft'), set('#4a4650', 'head', 'earL', 'earR'), legs('#4a4650'), set('#8a8a92', 'skin', 'tail')),
    brown: mix(set('#7a5236', 'wool', 'tuft'), set('#3a2a22', 'head', 'earL', 'earR'), legs('#3a2a22'), set('#6a4a34', 'skin', 'tail')),
    blackfaced: mix(set('#ebe6f2', 'wool', 'tuft'), set('#141216', 'head', 'earL', 'earR'), legs('#141216'), set('#4a4248', 'muzzle'), set('#8a7a80', 'tail')),
  },
  bristleback: {
    brown: {},
    black: mix(set('#3a3436', 'body', 'head'), set('#2c2628', 'rump', 'shoulder', 'earL', 'earR', 'tail'), set('#5a5254', 'belly'), legs('#2c2628'), set('#141012', 'ridge'), bristles('#0c0a0a'), set('#0c0a0a', 'tailTip'), sides('#201a1c', 'cheek')),
    pink: mix(set('#e0a898', 'body', 'head'), set('#d49888', 'rump', 'shoulder', 'earL', 'earR', 'tail'), set('#f0cabc', 'belly'), legs('#d49888'), set('#b88878', 'ridge'), bristles('#a87868'), set('#a87868', 'tailTip'), set('#f0b8aa', 'snout'), set('#d08a86', 'nose'), sides('#c88a7a', 'cheek')),
    spotted: mix(set('#c4a078', 'body', 'head'), set('#b08a62', 'rump', 'shoulder', 'earL', 'earR', 'tail'), set('#e0c8a8', 'belly'), legs('#a88258'), set('#5a4028', 'ridge'), bristles('#3a281a'), set('#3a281a', 'tailTip'), sides('#8a6a48', 'cheek')),
  },
  mooxen: {
    bluegrey: {},
    dun: mix(set('#a89066', 'body', 'head'), set('#c8b890', 'belly', 'muzzle'), set('#8a7450', 'mantle', 'hump', 'earL', 'earR', 'tail'), set('#6a5a3c', 'fringe', 'hump2', 'forelock'), legs('#7a6644'), socks('#d8c8a0'), set('#5a4a2e', 'tailTuft')),
    patched: socks('#e6eaee'),
  },
  purrling: {
    tabby: mix(set('#9a7a52', 'body', 'mane', 'head'), legs('#9a7a52'), set('#6a5238', 'earL', 'earR', 'tail'), set('#d8c8a8', 'snout')),
    black: mix(set('#2a2626', 'body', 'mane', 'head'), legs('#2a2626'), set('#141212', 'earL', 'earR', 'tail'), set('#3a3434', 'snout')),
    white: mix(set('#ecebe6', 'body', 'mane', 'head'), legs('#ecebe6'), set('#d8c8c4', 'earL', 'earR'), set('#c8c6c0', 'tail'), set('#f4ece4', 'snout')),
    ginger: mix(set('#c8883a', 'body', 'mane', 'head'), legs('#c8883a'), set('#a86a2a', 'earL', 'earR', 'tail'), set('#e8d8c0', 'snout')),
    pointed: mix(set('#e8dcc0', 'body', 'mane', 'head'), legs('#5a4636'), set('#5a4636', 'earL', 'earR', 'tail'), set('#6a5646', 'snout')),
  },
  vixling: {
    red: {},
    snow: mix(set('#f2f4f6', 'body', 'head', 'tail'), set('#ffffff', 'chestW', 'cheekL', 'cheekR', 'snout', 'earInL', 'earInR'), set('#dfe6ee', 'tailTip'), set('#9aa0a8', 'earL', 'earR'), legs('#8a9098')),
    grey: mix(set('#8c8c92', 'body', 'head', 'tail'), set('#e4e4e8', 'chestW', 'cheekL', 'cheekR', 'snout', 'earInL', 'earInR'), set('#f0f0f4', 'tailTip'), set('#3a3a3e', 'earL', 'earR'), legs('#2a2a2e')),
  },
  howler: {
    grey: {},
    black: mix(set('#2e2e32', 'body'), set('#3c3c42', 'mane'), set('#34343a', 'head'), sides('#46464c', 'cheek'), set('#46464c', 'snout'), set('#5a5a60', 'jaw'), set('#26262a', 'earL', 'earR'), legs('#2e2e32')),
    whitechest: {},
    tan: mix(set('#b89a68', 'body'), set('#cdb384', 'mane'), set('#c0a272', 'head'), sides('#e0d0a8', 'cheek'), set('#e0d0a8', 'snout'), set('#efe4c4', 'jaw'), set('#9a7e50', 'earL', 'earR'), legs('#a88a5a')),
  },
  galloper: {
    chestnut: mix(set('#a8602c', 'body', 'neck', 'head'), legs('#a8602c'), set('#4a2a14', 'mane', 'tail'), set('#6a4020', 'earL', 'earR')),
    bay: mix(set('#8a4a24', 'body', 'neck', 'head'), legs('#2a1c14'), set('#1c1410', 'mane', 'tail'), set('#2a1c14', 'earL', 'earR')),
    grey: mix(set('#9a9a9c', 'body', 'neck', 'head'), legs('#8a8a8e'), set('#6a6a6e', 'mane', 'tail', 'earL', 'earR')),
    black: mix(set('#242020', 'body', 'neck', 'head'), legs('#242020'), set('#100e0e', 'mane', 'tail'), set('#141212', 'earL', 'earR')),
    piebald: mix(set('#ecebe6', 'body', 'neck', 'head'), legs('#ecebe6'), set('#3a2414', 'mane', 'tail'), set('#4a2e1c', 'earL', 'earR')),
  },
};

/** Part colour overrides ({ partName: '#rrggbb' }) of a variant (an index or its name); {} for the unchanged model. */
export function variantPalette(type, variant = 0) {
  const names = VARIANTS[type];
  if (!names) return {};
  const name = typeof variant === 'string' ? variant : names[variant | 0];
  return (PALETTES[type] && PALETTES[type][name]) || {};
}

const SPOT = '#f0ece4', TAB = '#5a4630';
// [host part, size, offset from the host's centre, colour]
const OVERLAYS = {
  cluckling: {
    speckled: [
      ...[[1.5, 3.05, -2], [-1.2, 3.05, 0.5], [0.4, 3.05, 2.8], [-2, 3.05, -3], [2, 3.05, 1.6]].map(([x, y, z]) => ['body', [0.9, 0.2, 0.9], [x, y, z], SPOT]),
      ...[[3.05, -0.5, 1], [-3.05, 1, -1.5], [3.05, 1.2, -2.5], [-3.05, -1, 2], [3.05, -1.5, -1]].map(([x, y, z]) => ['body', [0.2, 0.9, 0.9], [x, y, z], SPOT]),
      ['head', [0.9, 0.9, 0.2], [0.3, 2.5, 1.55], SPOT],
    ],
  },
  bristleback: {
    spotted: [['body', [0.2, 3, 3.5], [5.32, 0.5, 5.5], '#e8d4b0'], ['body', [0.2, 2.6, 2.6], [5.32, -1, -5], '#4a2e1c'], ['body', [0.2, 3.4, 3], [-5.32, 1, 4.5], '#4a2e1c'],
      ['body', [0.2, 2.4, 2.4], [-5.32, -0.5, -5.5], '#e8d4b0'], ['body', [0.2, 2, 2], [5.32, 1.5, -0.5], '#4a2e1c'], ['head', [3, 0.2, 3], [-1.2, 4.05, -1], '#4a2e1c']],
  },
  mooxen: {
    patched: [['body', [0.2, 5, 7], [6.1, 1.5, 3], '#e6eaee'], ['body', [0.2, 6, 5], [-6.1, 0.5, 4], '#e6eaee'], ['body', [0.2, 3, 4], [6.1, -0.5, -1], '#e6eaee'],
      ['hump', [6, 0.2, 3.5], [0, 2.05, 0.5], '#e6eaee'], ['tailTuft', [3.5, 4.2, 3.5], [0, 0, 0], '#e6eaee']],
  },
  purrling: {
    tabby: [
      ...[0.2, 2.6, 4.8].map((z) => ['body', [4.3, 4.3, 0.8], [0, 0, z], TAB]),
      ...[-2, -4.5, -7].map((y) => ['tail', [1.3, 1.1, 1.3], [0, y, 0], '#3a2a1e']),
    ],
  },
  howler: {
    whitechest: [['mane', [4.4, 6.4, 0.3], [0, -0.6, -3.1], '#ece8e0'], ['body', [4, 0.3, 7], [0, -3.05, 0.5], '#ece8e0'], ['jaw', [2.8, 1.2, 3.8], [0, 0, 0], '#f4f0e8']],
  },
  galloper: {
    piebald: [['body', [0.24, 5, 8], [5.12, 1, 4], '#4a2e1c'], ['body', [0.24, 6, 7], [-5.12, 0, -3], '#4a2e1c'], ['body', [0.24, 4, 5], [5.12, 0, -6.5], '#4a2e1c'],
      ['neck', [0.24, 5, 4], [2.62, 1, 0], '#4a2e1c'], ['head', [0.24, 3, 4], [3.12, 0.5, 1], '#4a2e1c'], ['head', [0.24, 2.5, 3], [-3.12, 1, 3], '#4a2e1c']],
  },
};

/** Spot, stripe and patch boxes of a variant: [[hostPart, [w, h, d], [x, y, z] from the host's centre, colour], ...]. */
export function variantOverlays(type, variant = 0) {
  const names = VARIANTS[type];
  if (!names) return [];
  const name = typeof variant === 'string' ? variant : names[variant | 0];
  return (OVERLAYS[type] && OVERLAYS[type][name]) || [];
}

/** A copy of model `parts` with a variant's colours painted in (the part lists of models.js). */
export function paintParts(parts, type, variant) {
  const pal = variantPalette(type, variant);
  return parts.map((p) => (pal[p[0]] ? [p[0], p[1], p[2], p[3], pal[p[0]], ...p.slice(5)] : p));
}
