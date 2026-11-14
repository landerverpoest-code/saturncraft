// Armour Inlays: a cosmetic pattern laid into a piece of armour in a chosen material. It changes only how the piece looks
// (worn model, armour stands, other players, icon, tooltip), never its stats. Pure code (unit tested).
//
// The inlay is a stack extra: `stack.inlay = { p: <pattern key>, m: <material key> }`. A stencil is not used up by laying
// it; the material is. Laying a new inlay replaces the old one.
import { I, ITEMS } from '../world/items.js';

/** Patterns: key, display name and the stencil item's `I` key. */
export const INLAY_PATTERNS = {
  ringed: { name: 'Ringed', stencil: 'INLAY_STENCIL_RINGED' },
  three_suns: { name: 'Three Suns', stencil: 'INLAY_STENCIL_THREE_SUNS' },
  tidal: { name: 'Tidal', stencil: 'INLAY_STENCIL_TIDAL' },
  thorn: { name: 'Thorn', stencil: 'INLAY_STENCIL_THORN' },
  ember: { name: 'Ember', stencil: 'INLAY_STENCIL_EMBER' },
  hollow: { name: 'Hollow', stencil: 'INLAY_STENCIL_HOLLOW' },
};
/** Materials: key, display name, the item that supplies it (`I` key) and the colour it paints. */
export const INLAY_MATERIALS = {
  iron: { name: 'Iron', item: 'IRON_INGOT', color: '#d8d8d8' },
  gold: { name: 'Gold', item: 'GOLD_INGOT', color: '#f4c830' },
  copper: { name: 'Copper', item: 'COPPER_INGOT', color: '#d0804a' },
  diamond: { name: 'Diamond', item: 'DIAMOND', color: '#5ae8e0' },
  beryl: { name: 'Beryl', item: 'BERYL', color: '#58d890' },
  azurite: { name: 'Azurite', item: 'AZURITE', color: '#3a6ae0' },
  cinnabar: { name: 'Cinnabar', item: 'CINNABAR', color: '#d83a3a' },
  violite: { name: 'Violite', item: 'VIOLITE_SHARD', color: '#a070f0' },
  ember_quartz: { name: 'Ember Quartz', item: 'EMBER_QUARTZ', color: '#f8e0d0' },
  slagsteel: { name: 'Slagsteel', item: 'SLAGSTEEL_INGOT', color: '#8a7a96' },
};
export const PATTERN_KEYS = Object.keys(INLAY_PATTERNS);
export const MATERIAL_KEYS = Object.keys(INLAY_MATERIALS);

/** Stencil item id -> pattern key, and material item id -> material key. */
export const STENCIL_PATTERN = new Map(PATTERN_KEYS.map((k) => [I[INLAY_PATTERNS[k].stencil], k]));
export const MATERIAL_OF_ITEM = new Map(MATERIAL_KEYS.map((k) => [I[INLAY_MATERIALS[k].item], k]));
export const STENCIL_IDS = [...STENCIL_PATTERN.keys()];

/** A cleaned inlay from untrusted data (network, saves): { p, m } with known keys only, else null. */
export function cleanInlay(x) {
  if (!x || typeof x !== 'object') return null;
  if (typeof x.p !== 'string' || typeof x.m !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(INLAY_PATTERNS, x.p) || !Object.prototype.hasOwnProperty.call(INLAY_MATERIALS, x.m)) return null;
  return { p: x.p, m: x.m };
}
export const sameInlay = (a, b) => {
  const x = cleanInlay(a), y = cleanInlay(b);
  return !x && !y ? true : !!x && !!y && x.p === y.p && x.m === y.m;
};

/** Can this item carry an inlay? Armour that is drawn as shells on the model (not wings or a pumpkin). */
export function canInlay(id) {
  const a = ITEMS[id] && ITEMS[id].armor;
  return !!a && !a.glider && !a.pumpkin;
}

/**
 * The inlay recipe for a crafting grid: exactly one armour piece, one stencil and one material.
 * Returns { result, keep } (`keep` = grid index of the stencil, which is not used up) or null.
 * The result is the same piece (damage, enchantments, name...) with the new inlay.
 */
export function inlayRecipe(grid) {
  let piece = -1, stencil = -1, mat = -1;
  for (let i = 0; i < grid.length; i++) {
    const s = grid[i];
    if (!s) continue;
    if (STENCIL_PATTERN.has(s.id)) { if (stencil >= 0) return null; stencil = i; }
    else if (MATERIAL_OF_ITEM.has(s.id)) { if (mat >= 0) return null; mat = i; }
    else if (canInlay(s.id)) { if (piece >= 0) return null; piece = i; }
    else return null;
  }
  if (piece < 0 || stencil < 0 || mat < 0) return null;
  const src = grid[piece];
  const result = { ...src, count: 1, damage: src.damage | 0 };
  if (src.ench) result.ench = { ...src.ench };
  result.inlay = { p: STENCIL_PATTERN.get(grid[stencil].id), m: MATERIAL_OF_ITEM.get(grid[mat].id) };
  return { result, keep: stencil };
}

/** Tooltip line of a stack ("Three Suns inlay in Beryl"), or null. */
export function inlayLine(st) {
  const n = st && cleanInlay(st.inlay);
  return n ? `${INLAY_PATTERNS[n.p].name} inlay in ${INLAY_MATERIALS[n.m].name}` : null;
}

/** Colour (css hex) an inlay paints in, or null. */
export const inlayColor = (inlay) => { const n = cleanInlay(inlay); return n ? INLAY_MATERIALS[n.m].color : null; };

// ---- wire form: one small integer per piece (0 = none) -------------------------------------
/** An inlay as a small integer for the network (0 = none). */
export function inlayCode(inlay) {
  const n = cleanInlay(inlay);
  return n ? PATTERN_KEYS.indexOf(n.p) * 16 + MATERIAL_KEYS.indexOf(n.m) + 1 : 0;
}
/** The inlay a code stands for, or null. */
export function inlayFromCode(code) {
  const c = (code | 0) - 1;
  if (c < 0) return null;
  const p = PATTERN_KEYS[c >> 4], m = MATERIAL_KEYS[c & 15];
  return p && m ? { p, m } : null;
}
/** Four codes for four armour stacks (or 0 when none has an inlay, to keep snapshots short). */
export function inlayCodes(armor) {
  const codes = [0, 1, 2, 3].map((i) => (armor && armor[i] ? inlayCode(armor[i].inlay) : 0));
  return codes.some(Boolean) ? codes : 0;
}
/** Four inlays (or null) from four wire codes. */
export const inlaysFromCodes = (codes) => [0, 1, 2, 3].map((i) => (Array.isArray(codes) ? inlayFromCode(codes[i]) : null));

// ---- looks ---------------------------------------------------------------------------------
const rings = (x, y, lo, hi) => { const d = Math.hypot(x - 7.5, y - 7.5); return d >= lo && d <= hi; };
const sun = (x, y, cx, cy) => (x === cx && Math.abs(y - cy) <= 1) || (y === cy && Math.abs(x - cx) <= 1);
/** 16x16 masks (1 = painted) per pattern, for the armour texture and the icon. Edge pixels stay plain. */
const MASK_FN = {
  ringed: (x, y) => rings(x, y, 3.4, 4.9),
  three_suns: (x, y) => sun(x, y, 4, 4) || sun(x, y, 11, 4) || sun(x, y, 8, 11),
  tidal: (x, y) => (y === 6 + Math.round(1.6 * Math.sin(x * Math.PI / 3.5)) || y === 10 + Math.round(1.6 * Math.sin(x * Math.PI / 3.5))) && x >= 2 && x <= 13,
  thorn: (x, y) => y >= 2 && y <= 13 && x >= 2 && x <= 13 && (y + Math.abs(x - 8)) % 4 === 0,
  ember: (x, y) => Math.abs(x - 7.5) + Math.abs(y - 7.5) <= 3.6 && !(Math.abs(x - 7.5) + Math.abs(y - 7.5) < 1.2),
  hollow: (x, y) => Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) > 3.9 && Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) < 5.1,
};
const maskCache = {};
/** The 16x16 mask of a pattern: an array of 256 zeros and ones (row-major), or null for an unknown pattern. */
export function inlayMask(p) {
  if (!MASK_FN[p]) return null;
  if (maskCache[p]) return maskCache[p];
  const m = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) m.push(x > 0 && y > 0 && x < 15 && y < 15 && MASK_FN[p](x, y) ? 1 : 0);
  return (maskCache[p] = m);
}
