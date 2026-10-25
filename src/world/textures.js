// Procedural 16x16 pixel art for every block face. All art is generated at
// runtime from seeded noise and hand-picked palettes; no external images.
import { BLOCKS, B, BLOCK_LIMIT } from './blocks.js';
import { COLORS } from './colors.js';
import { ARTS, paintingPart } from './paintings.js';
import { mulberry32, hash4 } from './noise.js';
import { DIM_TEX } from './dimensions/dimTextures.js';
import { CIRCUIT_TEX } from './circuitTextures.js';
import { MONUMENT_TEX } from './monumentTextures.js';
import { CAVE_TEX } from './caveTextures.js';
import { HUSH_TEX } from './hushTextures.js';

export const TEX_SIZE = 16;

// Texture names in layer order. Derived from block definitions plus extras.
export const TEX_NAMES = [];
const texIndex = new Map();
function addTex(name) {
  if (!texIndex.has(name)) { texIndex.set(name, TEX_NAMES.length); TEX_NAMES.push(name); }
  return texIndex.get(name);
}
for (const b of BLOCKS) {
  if (!b || b.id === B.AIR) continue;
  addTex(b.tex.top); addTex(b.tex.bottom); addTex(b.tex.side);
  if (b.tex.front) addTex(b.tex.front);
}
addTex('furnace_side');
addTex('farmland_moist');
addTex('door_upper');
for (const b of BLOCKS) if (b && b.doorTex) for (const n of b.doorTex) addTex(n);
addTex('pumpkin_face');
for (let r = 0; r < 4; r++) { addTex('bed_head_top_' + r); addTex('bed_foot_top_' + r); }
for (let i = 0; i < 8; i++) addTex('wheat_' + i);
for (let i = 0; i < 4; i++) addTex('carrots_' + i);
for (let i = 0; i < 4; i++) { addTex('potatoes_' + i); addTex('beetroots_' + i); addTex('cinderroot_' + i); }
for (let i = 0; i < 8; i++) addTex('stem_' + i);
addTex('water_flow');
addTex('rail_corner');
addTex('nest_front_honey'); addTex('hive_front_honey');
addTex('chest_front_l'); addTex('chest_front_r'); // the halves of a double chest
for (const n of Object.keys(CIRCUIT_TEX)) addTex(n); // circuit parts (world/circuitTextures.js)
for (const n of Object.keys(CAVE_TEX)) addTex(n); // caves content (world/caveTextures.js)
for (const n of Object.keys(HUSH_TEX)) addTex(n); // the Deep Hush (world/hushTextures.js)
ARTS.forEach(([, w, h], art) => { for (let p = 0; p < w * h; p++) addTex(`painting_${art}_${p}`); });
for (let i = 0; i < 8; i++) addTex('fire_' + i);
addTex('lava_flow');
addTex('compost'); addTex('compost_ready');
addTex('candle_wick'); addTex('candle_flame');
addTex('grindstone_face'); addTex('grindstone_leg'); addTex('grindstone_pivot');
addTex('stonecutter_blank'); addTex('stonecutter_saw'); for (let i = 0; i < 4; i++) addTex('stonecutter_saw_' + i); // the blade's frames (animated in terrainMaterial)
for (let i = 0; i < 4; i++) addTex('sweet_berry_bush_' + i);
for (let i = 0; i < 10; i++) addTex('destroy_' + i);
addTex('mangrove_propagule_hanging');

export function texId(name) { return texIndex.get(name); }

// Face order: +x, -x, +y, -y, +z, -z
export const FACE_TILE = new Uint16Array(BLOCK_LIMIT * 6);
for (const b of BLOCKS) {
  if (!b) continue;
  const t = b.tex;
  const s = addTex(t.side), top = addTex(t.top), bot = addTex(t.bottom);
  FACE_TILE.set([s, s, top, bot, s, s], b.id * 6);
}
// Blocks with a front texture show it on the side they were placed facing.
export const FRONT_TILE = new Int16Array(BLOCK_LIMIT).fill(-1);
for (const b of BLOCKS) if (b && b.tex.front) FRONT_TILE[b.id] = addTex(b.tex.front);
// Furnaces show their front only on one side; the others use a plain side.
for (const id of [B.FURNACE, B.FURNACE_LIT]) {
  const side = texId('furnace_side');
  FACE_TILE[id * 6 + 0] = side; FACE_TILE[id * 6 + 1] = side; FACE_TILE[id * 6 + 4] = side;
}

// ---------------------------------------------------------------------------
// Pixel generation

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function shade(c, f) { return [c[0] * f, c[1] * f, c[2] * f]; }

class Canvas16 {
  constructor(name) {
    this.data = new Uint8ClampedArray(TEX_SIZE * TEX_SIZE * 4);
    let seed = 0;
    for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) | 0;
    this.seed = seed;
    this.rng = mulberry32(seed);
  }
  set(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= 16 || y >= 16) return;
    const i = (y * 16 + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = a;
  }
  get(x, y) { const i = (y * 16 + x) * 4; return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]]; }
  h(x, y, k = 0) { return hash4(this.seed, x, y, k) / 4294967296; }
  // Fill with palette chosen by per-pixel noise (value + smooth blotches)
  noiseFill(palette, blotch = 0.5) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = this.h(x, y) * (1 - blotch) + this.h(x >> 2, y >> 2, 1) * blotch * 0.6 + this.h(x >> 1, y >> 1, 2) * blotch * 0.4;
      const idx = Math.min(palette.length - 1, Math.floor(n * palette.length));
      this.set(x, y, palette[idx]);
    }
  }
}

const P = {
  stone: ['#6f6f72', '#7a7a7d', '#848487', '#8d8d90', '#76767a'].map(hex),
  deep: ['#3d3d45', '#45454e', '#4d4d56', '#363640'].map(hex),
  dirt: ['#7a5536', '#6b4a2f', '#86603e', '#5f4129', '#8f6844'].map(hex),
  sand: ['#e2d39b', '#d9c88c', '#eadcab', '#cfbd80'].map(hex),
  gravel: ['#8c8580', '#6e6864', '#a39c96', '#5c5754', '#7d7671'].map(hex),
  grassGray: ['#d2d2d2', '#dedede', '#ebebeb', '#c4c4c4', '#f4f4f4'].map(hex),
};

function oreTex(c, base, colors, pattern) {
  base(c);
  // Blob layout from seeded RNG; each ore gets a distinct cluster shape
  const n = 4 + Math.floor(c.rng() * 2);
  for (let k = 0; k < n; k++) {
    const cx = 2 + Math.floor(c.rng() * 12), cy = 2 + Math.floor(c.rng() * 12);
    const cells = pattern === 'gem' ? [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]] : [[0, 0], [1, 0], [0, 1], [1, 1]];
    for (const [dx, dy] of cells) {
      const col = colors[(dx + dy + 2 + k) % colors.length];
      c.set(cx + dx, cy + dy, col);
    }
    c.set(cx - 1, cy + 1, shade(colors[0], 0.55));
  }
}
const stoneBase = (c) => c.noiseFill(P.stone, 0.6);
const deepBase = (c) => {
  c.noiseFill(P.deep, 0.4);
  for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x++) if (c.h(x, y, 9) < 0.5) c.set(x, y, shade(P.deep[0], 0.85));
};

function planks(c, base) {
  const b = hex(base);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = y >> 2;
    let f = 0.9 + c.h(x, row, 3) * 0.08 + (c.h(x >> 1, y, 4) - 0.5) * 0.12;
    if (y % 4 === 3) f = 0.62;
    const seam = (row % 2 === 0 ? 5 : 12);
    if (x === seam) f *= 0.72;
    c.set(x, y, shade(b, f));
  }
}

function logSide(c, bark, dark, stripes) {
  const b = hex(bark), d = hex(dark);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const groove = c.h(x, 0, 5) < 0.35;
    let col = groove ? d : b;
    col = shade(col, 0.88 + c.h(x, y, 6) * 0.2);
    if (stripes && c.h(x >> 1, y >> 1, 7) < 0.12) col = hex('#2a2a26');
    c.set(x, y, col);
  }
}

function logTop(c, bark, inner) {
  const b = hex(bark), w = hex(inner);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = x - 7.5, dy = y - 7.5;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (x === 0 || y === 0 || x === 15 || y === 15) { c.set(x, y, shade(b, 0.9 + c.h(x, y) * 0.15)); continue; }
    const ring = Math.floor(r + c.h(x, y, 2) * 0.6) % 3 === 0;
    c.set(x, y, shade(w, ring ? 0.8 : 0.98 + c.h(x, y) * 0.06));
  }
}

/** Sweet berry bush at age 0-3: a low sprig growing into a leafy bush with green, then red berries. */
function berryBush(c, age) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
  const top = [11, 6, 3, 2][age];
  for (let y = top; y < 16; y++) for (let x = 1; x < 15; x++) {
    const w = (16 - y) / (16 - top);
    if (Math.abs(x - 7.5) > 7 * Math.min(1, 0.4 + w) || c.h(x, y, 21) > 0.62) continue;
    c.set(x, y, shade(hex('#2f5a2a'), 0.75 + c.h(x, y, 22) * 0.45));
  }
  if (age >= 2) for (let k = 0; k < (age === 3 ? 9 : 5); k++) {
    const x = 2 + Math.floor(c.h(k, 0, 23) * 12), y = top + 1 + Math.floor(c.h(k, 1, 24) * (13 - top));
    const col = age === 3 ? hex('#c8202e') : hex('#7aa83a');
    c.set(x, y, col); c.set(x + 1, y, shade(col, 0.8)); c.set(x, y + 1, shade(col, 0.7));
  }
}

/** A round leafy bush on a short stem; the flowering one has pink blossoms. */
function azaleaTex(c, flowers) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
  for (let y = 2; y < 12; y++) for (let x = 2; x < 14; x++) {
    if (Math.hypot(x - 7.5, (y - 7) * 1.2) > 6 || c.h(x, y, 43) > 0.85) continue;
    c.set(x, y, shade(hex('#5a8a2a'), 0.75 + c.h(x, y, 44) * 0.35));
    if (flowers && c.h(x, y, 45) < 0.14) c.set(x, y, hex('#e88ac8'));
  }
  for (let y = 12; y < 16; y++) { c.set(7, y, hex('#6a4a2a')); c.set(8, y, hex('#5a3e22')); }
}
/** A hanging vine; the lit one carries glowing orange berries. */
function caveVine(c, lit) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
  for (let y = 0; y < 16; y++) {
    const x = 7 + Math.round(Math.sin(y * 0.7) * 1.5);
    c.set(x, y, hex('#4a7a2a')); c.set(x + 1, y, hex('#3a6a1e'));
    if (y % 4 === 1) { c.set(x - 1, y, hex('#5a8a32')); c.set(x + 2, y + 1, hex('#5a8a32')); }
  }
  if (lit) for (const [x, y] of [[5, 4], [10, 9], [6, 13]]) { c.set(x, y, hex('#ffb030')); c.set(x + 1, y, hex('#ffd060')); c.set(x, y + 1, hex('#e88a1a')); c.set(x + 1, y + 1, hex('#ffb030')); }
}

/** Cut and polished stone: a smooth face with a faint frame. */
function polished(c, base) {
  const b = hex(base);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    c.set(x, y, shade(b, edge ? (x === 15 || y === 15 ? 0.78 : 1.08) : 0.94 + c.h(x, y) * 0.08 + (c.h(x >> 2, y >> 2, 4) - 0.5) * 0.05));
  }
}

function leavesTex(c, density = 0.78) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = c.h(x, y);
    if (n > density) { c.set(x, y, [0, 0, 0], 0); continue; }
    const f = 0.62 + c.h(x >> 1, y >> 1, 3) * 0.38;
    c.set(x, y, shade([250, 250, 250], f));
  }
}

// Fired clay: a flat matte colour with faint grain.
function terracotta(c, base) {
  const b = hex(base);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(b, 0.93 + c.h(x, y) * 0.07 + (c.h(x >> 2, y >> 2, 1) - 0.5) * 0.05));
}

// Tilled soil: furrows across the face, darker when moist.
function farmland(c, moist) {
  const pal = moist ? ['#3f2a19', '#4a321e', '#36241a', '#52381f'] : ['#6e4c2e', '#7d5836', '#634329', '#8a633e'];
  c.noiseFill(pal.map(hex), 0.3);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (y % 4 === 3) c.set(x, y, shade(c.get(x, y), 0.7));
    else if (y % 4 === 0) c.set(x, y, shade(c.get(x, y), 1.12));
  }
}

// Wheat crop stage 0..7: taller stalks, turning from green to gold, ears at the end.
function wheat(c, stage) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
  const h = 3 + Math.round(stage * 12 / 7);
  const green = hex('#3e8a24'), gold = hex('#c9a640'), col = mix(green, gold, Math.max(0, (stage - 3) / 4));
  for (const sx of [1, 4, 7, 10, 13]) {
    const lean = c.h(sx, stage, 9) < 0.5 ? 0 : 1;
    const hh = h - Math.floor(c.h(sx, 1, 5) * 3);
    for (let k = 0; k < hh; k++) c.set(sx + (k > hh * 0.6 ? lean : 0), 15 - k, shade(col, 0.85 + c.h(sx, k) * 0.25));
    if (stage >= 5) for (let k = 0; k < 3; k++) {
      const ey = 15 - hh + k;
      c.set(sx + lean - 1, ey, shade(hex(stage === 7 ? '#b98a2a' : '#8fa040'), 0.9 + c.h(sx, ey) * 0.2));
      c.set(sx + lean + 1, ey + 1, shade(hex(stage === 7 ? '#d6ac44' : '#a4b048'), 0.9));
    }
  }
}

// Bed tops: pattern drawn with the head end at row 0, rotated so it points
// towards side r (0 -z, 1 +x, 2 +z, 3 -x) when mapped onto the top face.
function bedTop(c, head, r) {
  const red = hex('#b02a2a'), redD = hex('#8a1e1e'), white = hex('#e8e6e0'), whiteD = hex('#c8c6c0'), wood = hex('#7a5530');
  const pattern = (px, py) => {
    if (px === 0 || px === 15) return wood;
    if (head) {
      if (py === 0) return wood;
      if (py >= 2 && py <= 5 && px >= 2 && px <= 13) return (py === 5 || px === 13) ? whiteD : white;
      if (py <= 6) return shade(white, 0.92);
      if (py === 7) return redD;
    } else if (py === 15) return wood;
    return shade(red, 0.9 + c.h(px, py) * 0.15);
  };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let px = x, py = y;
    if (r === 2) { px = 15 - x; py = 15 - y; } else if (r === 1) { px = y; py = 15 - x; } else if (r === 3) { px = 15 - y; py = x; }
    c.set(x, y, pattern(px, py));
  }
}

// Carrot crop stage 0..3: leafy tufts, orange tops showing when ripe.
function carrots(c, stage) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
  const leaf = hex('#3f9a2a'), leafD = hex('#2a7a1e'), orange = hex('#e8862a');
  const h = 3 + stage * 2;
  for (const sx of [2, 6, 10, 13]) {
    for (let k = 0; k < h; k++) {
      const y = 15 - k;
      c.set(sx, y, shade(leaf, 0.85 + c.h(sx, k) * 0.3));
      if (k > 1 && k % 2 === 0) { c.set(sx - 1, y, leafD); c.set(sx + 1, y - 1, leaf); }
    }
    if (stage === 3) { c.set(sx, 15, orange); c.set(sx + 1, 15, shade(orange, 0.85)); c.set(sx, 14, shade(orange, 1.1)); }
  }
}

// Cinderroot stage 0..3: knobbly crimson stalks that swell into bulbs.
function cinderroot(c, stage) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
  const stem = hex('#7a1820'), dark = hex('#4a0c12'), bulb = hex('#c0283a'), glow = hex('#ff7040');
  const h = 3 + stage * 3;
  for (const [sx, lean] of [[3, 1], [7, 0], [11, -1], [13, 0]]) {
    let x = sx;
    for (let k = 0; k < h; k++) {
      const y = 15 - k;
      if (k > 2 && k % 3 === 0) x += lean;
      c.set(x, y, shade(stem, 0.8 + c.h(x, y) * 0.4));
      if (k % 2 === 1) c.set(x + (k % 4 === 1 ? 1 : -1), y, dark);
    }
    const top = 15 - h;
    if (stage >= 2) {
      const r = stage === 3 ? 1 : 0;
      for (let dy = -r; dy <= r + 1; dy++) for (let dx = -r; dx <= r; dx++) c.set(x + dx, top + dy, shade(bulb, 0.85 + c.h(dx, dy, 3) * 0.3));
      if (stage === 3) c.set(x, top, glow);
    }
  }
}

// Potatoes / beetroots: bushy leaves (beetroot leaves have red veins), with the
// crop showing at the bottom when ripe.
function rootCrop(c, stage, leaf, vein, crop, size) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
  const l = hex(leaf), v = hex(vein), cr = hex(crop);
  const h = 3 + stage * 2.5;
  for (const sx of [3, 8, 12]) {
    for (let k = 0; k < h; k++) {
      const y = 15 - k, w = k > h * 0.4 ? 2 : 1;
      for (let dx = -w; dx <= w; dx++) if (c.h(sx + dx, y) < 0.75) c.set(sx + dx, y, dx === 0 ? v : shade(l, 0.8 + c.h(dx, k) * 0.35));
    }
  }
  if (stage === 3) for (const sx of [3, 8, 12]) for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) c.set(sx - 1 + dx, 15 - dy, shade(cr, 0.85 + c.h(dx, dy, 5) * 0.3));
}

function sapling(c, leaf, dark, stem, conifer) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
  const s = hex(stem), l = hex(leaf), d = hex(dark);
  for (let y = 9; y < 16; y++) c.set(7 + (y > 12 ? 0 : (y & 1) * 0), y, s);
  if (conifer) {
    // stacked triangles
    for (let tier = 0; tier < 3; tier++) {
      const top = 1 + tier * 4, w = 2 + tier * 2;
      for (let y = 0; y < 5; y++) for (let x = -w; x <= w; x++) {
        if (Math.abs(x) > (y * w) / 4 + 0.5) continue;
        c.set(7 + x, top + y, c.h(x, y, tier) < 0.35 ? d : l);
      }
    }
    return;
  }
  // a leafy bush: a few overlapping blobs
  for (const [cx, cy, r] of [[7, 5, 4.2], [4, 8, 3], [10.5, 7.5, 3.2], [7.5, 2.5, 2.5]]) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      if (c.h(x, y, 3) < 0.18) continue;
      c.set(x, y, c.h(x, y) < 0.3 ? d : l);
    }
  }
  for (let y = 7; y < 12; y++) c.set(7, y, s);
  c.set(6, 9, s); c.set(8, 8, s);
}

// Rails: wooden sleepers under two iron rails (straight along the texture's v axis, or a curve joining the bottom and right edges)
function railTex(c, corner) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
  const wood = hex('#6a4a2a'), woodD = hex('#4a321c'), iron = hex('#a8a8ac'), ironL = hex('#d8d8dc');
  if (!corner) {
    for (let y = 1; y < 16; y += 3) for (let x = 1; x < 15; x++) c.set(x, y, x % 4 ? wood : woodD), c.set(x, y + 1, woodD);
    for (let y = 0; y < 16; y++) { c.set(3, y, iron); c.set(4, y, ironL); c.set(11, y, iron); c.set(12, y, ironL); }
    return;
  }
  // sleepers fanning around the corner at (16,16)
  for (let a = 0; a < 6; a++) {
    const ang = (a + 0.5) / 6 * Math.PI / 2;
    for (let r = 2; r < 15; r += 0.5) { const x = Math.round(16 - Math.cos(ang) * r), y = Math.round(16 - Math.sin(ang) * r); c.set(x, y, wood); }
  }
  for (let t = 0; t <= 64; t++) {
    const ang = t / 64 * Math.PI / 2;
    for (const [r, col] of [[12.5, iron], [11.5, ironL], [4.5, iron], [3.5, ironL]]) c.set(Math.round(16 - Math.cos(ang) * r), Math.round(16 - Math.sin(ang) * r), col);
  }
}

function crossPlant(c, stem, petals, center) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
  const s = hex(stem);
  for (let y = 8; y < 16; y++) c.set(7 + (y > 12 ? 0 : (y & 1)), y, s);
  c.set(6, 12, s); c.set(5, 11, s); c.set(9, 11, s); c.set(10, 10, s);
  if (petals) {
    const p = hex(petals), ce = hex(center);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]]) c.set(7 + dx, 6 + dy, shade(p, 0.85 + c.h(dx, dy) * 0.3));
    c.set(7, 4, p); c.set(9, 6, p); c.set(5, 6, p); c.set(7, 8, shade(p, 0.8));
    c.set(7, 6, ce);
  }
}

const GEN = {
  stone: stoneBase,
  granite: (c) => c.noiseFill(['#9a6b58', '#a87763', '#8c5f4e', '#b88672', '#7d5244'].map(hex), 0.3),
  diorite: (c) => c.noiseFill(['#c9c9c9', '#e0e0e0', '#a9a9ab', '#f0f0f0', '#8f8f92'].map(hex), 0.2),
  andesite: (c) => c.noiseFill(['#848486', '#8f8f91', '#7a7a7c', '#9a9a9c'].map(hex), 0.3),
  polished_granite: (c) => polished(c, '#a5735e'),
  polished_diorite: (c) => polished(c, '#d4d4d6'),
  polished_andesite: (c) => polished(c, '#8a8c8c'),
  smooth_stone: (c) => { polished(c, '#a2a2a2'); for (let i = 0; i < 16; i++) { c.set(i, 0, hex('#7a7a7a')); c.set(i, 15, hex('#7a7a7a')); } },
  tuff: (c) => c.noiseFill(['#5f6159', '#6c6e64', '#575951', '#787a6f'].map(hex), 0.5),
  dirt: (c) => c.noiseFill(P.dirt, 0.4),
  farmland: (c) => farmland(c, false),
  pumpkin_side: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const rib = x % 4 === 0 ? 0.72 : x % 4 === 1 || x % 4 === 3 ? 0.92 : 1.04;
      c.set(x, y, shade(hex('#d8801e'), rib * (0.95 + c.h(x, y) * 0.1)));
    }
  },
  pumpkin_top: (c) => {
    GEN.pumpkin_side(c);
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) c.set(x, y, shade(hex('#6a7a2a'), 0.9 + c.h(x, y) * 0.2));
  },
  pumpkin_face: (c) => {
    GEN.pumpkin_side(c);
    const d = hex('#3a1e06');
    for (const [x0, y0] of [[3, 4], [10, 4]]) for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x0 + 3; x++) if (y - y0 >= Math.abs(x - x0 - 1)) c.set(x, y, d);
    for (let x = 3; x < 13; x++) { c.set(x, 10, d); if (x % 3 !== 0) c.set(x, 11, d); }
    c.set(4, 9, d); c.set(11, 9, d);
  },
  pumpkin_lantern: (c) => {
    GEN.pumpkin_face(c);
    const glow = hex('#ffd860');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const p = c.get(x, y); if (p[0] < 80) c.set(x, y, shade(glow, 0.9 + c.h(x, y) * 0.15)); }
  },
  melon_side: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const stripe = (x + Math.floor(c.h(0, y, 5) * 2)) % 4 < 2;
      c.set(x, y, shade(hex(stripe ? '#5a9a2a' : '#2f6e1a'), 0.92 + c.h(x, y) * 0.12));
    }
  },
  melon_top: (c) => { GEN.melon_side(c); for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) c.set(x, y, hex('#7a6a2a')); },
  dirt_path: (c) => c.noiseFill(['#9a7a48', '#8a6c3e', '#a8865a', '#7e6238'].map(hex), 0.35),
  dirt_path_side: (c) => {
    c.noiseFill(P.dirt, 0.4);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#9a7a48'), 0.9 + c.h(x, y) * 0.2));
  },
  farmland_moist: (c) => farmland(c, true),
  grass_top: (c) => c.noiseFill(P.grassGray, 0.3),
  grass_side: (c) => {
    c.noiseFill(P.dirt, 0.4);
    const g = ['#5d9a3a', '#6aaa43', '#4f8a31'].map(hex);
    for (let x = 0; x < 16; x++) {
      const depth = 3 + Math.floor(c.h(x, 0, 11) * 2.5);
      for (let y = 0; y < depth; y++) c.set(x, y, g[Math.floor(c.h(x, y, 12) * 3)]);
    }
  },
  snowy_grass_side: (c) => {
    c.noiseFill(P.dirt, 0.4);
    for (let x = 0; x < 16; x++) {
      const depth = 3 + Math.floor(c.h(x, 0, 11) * 3);
      for (let y = 0; y < depth; y++) c.set(x, y, shade([240, 246, 252], 0.92 + c.h(x, y) * 0.08));
    }
  },
  snow_block: (c) => c.noiseFill(['#f2f6fb', '#e8eef5', '#ffffff', '#dfe7f0'].map(hex), 0.2),
  cobblestone: (c) => {
    const pal = ['#7b7b7e', '#8d8d90', '#a0a0a3', '#6a6a6d'].map(hex);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      // Voronoi-like cells for the rounded stones
      let best = 9, second = 9, id = 0;
      for (let k = 0; k < 9; k++) {
        const px = c.h(k, 0, 20) * 16, py = c.h(k, 1, 20) * 16;
        let dx = Math.abs(x - px); dx = Math.min(dx, 16 - dx);
        let dy = Math.abs(y - py); dy = Math.min(dy, 16 - dy);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) { second = best; best = d; id = k; } else if (d < second) second = d;
      }
      if (second - best < 0.9) c.set(x, y, hex('#4b4b4e'));
      else c.set(x, y, shade(pal[id % pal.length], 0.92 + c.h(x, y) * 0.12));
    }
  },
  cobbled_deepstone: (c) => {
    GEN.cobblestone(c);
    for (let i = 0; i < c.data.length; i += 4) { c.data[i] *= 0.55; c.data[i + 1] *= 0.55; c.data[i + 2] *= 0.62; }
  },
  deepstone: deepBase,
  deepstone_top: (c) => c.noiseFill(P.deep, 0.7),
  bedrock: (c) => c.noiseFill(['#2a2a2a', '#555555', '#3d3d3d', '#7a7a7a', '#1c1c1c'].map(hex), 0.1),
  sand: (c) => c.noiseFill(P.sand, 0.2),
  gravel: (c) => c.noiseFill(P.gravel, 0.25),
  clay: (c) => c.noiseFill(['#a0a6b4', '#99a0ae', '#a8aebb', '#9298a6'].map(hex), 0.5),
  sandstone: (c) => {
    c.noiseFill(P.sand, 0.3);
    for (let x = 0; x < 16; x++) { c.set(x, 3, shade(P.sand[3], 0.9)); c.set(x, 11, shade(P.sand[3], 0.88)); }
  },
  sandstone_top: (c) => c.noiseFill(P.sand.slice(0, 3), 0.6),
  sandstone_bottom: (c) => c.noiseFill(P.sand, 0.6),
  water: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const w = Math.sin((x + y * 0.5) * 0.8 + Math.sin(y * 0.7) * 1.5) * 0.5 + 0.5;
      c.set(x, y, mix(hex('#173a8c'), hex('#2a5cbc'), w * 0.45 + c.h(x >> 1, y >> 1) * 0.35), 150);
    }
  },
  water_flow: (c) => GEN.water(c),
  lava: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = c.h(x >> 1, y >> 1) * 0.6 + c.h(x, y) * 0.4;
      c.set(x, y, mix(hex('#c8380c'), hex('#ffb23a'), n));
    }
  },
  lava_flow: (c) => GEN.lava(c),
  oak_log: (c) => logSide(c, '#6b4f2e', '#4f3920', false),
  oak_log_top: (c) => logTop(c, '#6b4f2e', '#b08a54'),
  birch_log: (c) => logSide(c, '#e8e4d8', '#d2cdbd', true),
  birch_log_top: (c) => logTop(c, '#e8e4d8', '#c9b07c'),
  spruce_log: (c) => logSide(c, '#4a3420', '#38261a', false),
  spruce_log_top: (c) => logTop(c, '#4a3420', '#8c6a3f'),
  jungle_log: (c) => {
    logSide(c, '#5a4424', '#3f2f17', false);
    // mossy flecks on the bark
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (c.h(x >> 1, y, 21) < 0.13) c.set(x, y, shade(hex('#5e6a2a'), 0.85 + c.h(x, y) * 0.2));
  },
  jungle_log_top: (c) => logTop(c, '#5a4424', '#a77a50'),
  jungle_planks: (c) => planks(c, '#a07350'),
  jungle_leaves: (c) => leavesTex(c, 0.9),
  jungle_sapling: (c) => sapling(c, '#3f9a2a', '#2a6a1a', '#5a4424', false),
  acacia_log: (c) => logSide(c, '#6a645a', '#4f4a42', false),
  acacia_log_top: (c) => logTop(c, '#6a645a', '#b0603a'),
  acacia_planks: (c) => planks(c, '#b0603a'),
  acacia_leaves: (c) => leavesTex(c, 0.74),
  acacia_sapling: (c) => sapling(c, '#8a9a2a', '#5f6a1a', '#6a645a', false),
  blossom_log: (c) => logSide(c, '#3e2a34', '#2a1c24', false),
  blossom_log_top: (c) => logTop(c, '#3e2a34', '#d8a49a'),
  blossom_planks: (c) => planks(c, '#e2b2a6'),
  blossom_leaves: (c) => {
    // pink petals with a few paler blooms and gaps
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = c.h(x, y);
      if (n > 0.8) { c.set(x, y, [0, 0, 0], 0); continue; }
      const f = 0.78 + c.h(x >> 1, y >> 1, 3) * 0.24;
      c.set(x, y, c.h(x, y, 9) < 0.12 ? hex('#fde6ee') : shade(hex('#f0a2c0'), f));
    }
  },
  blossom_sapling: (c) => sapling(c, '#f0a2c0', '#c87898', '#3e2a34', false),
  dark_oak_log: (c) => logSide(c, '#3e2d18', '#2a1e10', false),
  dark_oak_log_top: (c) => logTop(c, '#3e2d18', '#5c4329'),
  dark_oak_planks: (c) => planks(c, '#4f3720'),
  dark_oak_leaves: (c) => leavesTex(c, 0.9),
  dark_oak_sapling: (c) => sapling(c, '#2f6a1a', '#1f4a12', '#3e2d18', false),
  red_sand: (c) => c.noiseFill(['#bf6a2a', '#b05f22', '#c97632', '#a8571e'].map(hex), 0.2),
  terracotta: (c) => terracotta(c, '#985e43'),
  orange_terracotta: (c) => terracotta(c, '#a1532a'),
  yellow_terracotta: (c) => terracotta(c, '#b8862a'),
  white_terracotta: (c) => terracotta(c, '#d1b2a1'),
  brown_terracotta: (c) => terracotta(c, '#4d3324'),
  red_terracotta: (c) => terracotta(c, '#8f3d2e'),
  light_gray_terracotta: (c) => terracotta(c, '#876a61'),
  vines: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    // a few wavy strands with leaves branching off them
    for (const sx of [2, 6, 10, 13]) {
      for (let y = 0; y < 16; y++) {
        const x = sx + Math.round(Math.sin(y * 0.6 + sx) * 1.2);
        c.set(x, y, shade([235, 235, 235], 0.6 + c.h(x, y) * 0.25));
        if (c.h(sx, y, 3) < 0.4) { c.set(x + 1, y, shade([245, 245, 245], 0.8 + c.h(x, y, 4) * 0.2)); c.set(x - 1, y + 1, shade([245, 245, 245], 0.75)); }
      }
    }
  },
  lily_pad: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5, r = Math.sqrt(dx * dx + dy * dy);
      const notch = dy < 0 && Math.abs(dx) < -dy * 0.35;
      if (r > 7.2 || notch) { c.set(x, y, [0, 0, 0], 0); continue; }
      const vein = Math.abs(Math.atan2(dy, dx) * 4 / Math.PI % 1) < 0.12 && r > 1.5;
      c.set(x, y, shade(hex('#2f7d25'), vein ? 0.75 : 0.9 + c.h(x, y) * 0.2 - r * 0.015));
    }
  },
  brown_mushroom: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    for (let y = 10; y < 15; y++) { c.set(7, y, hex('#d8ccb4')); c.set(8, y, hex('#c4b89e')); }
    for (let y = 7; y < 10; y++) for (let x = 4 - (y - 7); x <= 11 + (y - 7); x++) c.set(x, y, shade(hex('#9a6e4c'), 0.9 + c.h(x, y) * 0.2));
  },
  red_mushroom: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    for (let y = 10; y < 15; y++) { c.set(7, y, hex('#e0d8c8')); c.set(8, y, hex('#cbc2b0')); }
    for (let y = 5; y < 10; y++) for (let x = 5 - Math.min(2, y - 5); x <= 10 + Math.min(2, y - 5); x++) c.set(x, y, shade(hex('#c42a22'), 0.9 + c.h(x, y) * 0.15));
    for (const [x, y] of [[6, 6], [9, 7], [4, 8], [11, 8], [7, 8]]) c.set(x, y, hex('#f0ece0'));
  },
  brown_mushroom_block: (c) => c.noiseFill(['#8d6a4a', '#957252', '#83603f', '#9c7a58'].map(hex), 0.4),
  red_mushroom_block: (c) => {
    c.noiseFill(['#b8241e', '#c42a22', '#ac1f1a'].map(hex), 0.4);
    for (let k = 0; k < 6; k++) {
      const x = Math.floor(c.h(k, 0, 9) * 14), y = Math.floor(c.h(k, 1, 9) * 14);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) c.set(x + dx, y + dy, shade(hex('#f2eee4'), 0.92 + c.h(x + dx, y + dy) * 0.08));
    }
  },
  mushroom_stem: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#d6d0c0'), 0.88 + c.h(x, y >> 2, 5) * 0.12));
  },
  mushroom_stem_top: (c) => c.noiseFill(['#c8bea6', '#bfb49b', '#d0c7b0'].map(hex), 0.5),
  mycelium_top: (c) => c.noiseFill(['#6f6370', '#7a6b7c', '#655966', '#86778a', '#5f5560'].map(hex), 0.35),
  mycelium_side: (c) => {
    c.noiseFill(P.dirt, 0.4);
    const g = ['#6f6370', '#7a6b7c', '#655966'].map(hex);
    for (let x = 0; x < 16; x++) {
      const depth = 2 + Math.floor(c.h(x, 0, 11) * 3);
      for (let y = 0; y < depth; y++) c.set(x, y, g[Math.floor(c.h(x, y, 12) * 3)]);
    }
  },
  skybell: (c) => crossPlant(c, '#3f8a2a', '#4a7ae8', '#d8e0ff'),
  rosette: (c) => crossPlant(c, '#3f8a2a', '#f08ab8', '#fff0a0'),
  oak_planks: (c) => planks(c, '#a7834e'),
  spruce_planks: (c) => planks(c, '#6f4f2f'),
  birch_planks: (c) => planks(c, '#cdb987'),
  oak_leaves: (c) => leavesTex(c, 0.8),
  birch_leaves: (c) => leavesTex(c, 0.82),
  spruce_leaves: (c) => leavesTex(c, 0.86),
  glass: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      const glint = (x - y === 3 || x - y === 4) && x > 4 && x < 12;
      if (edge) c.set(x, y, hex('#d8eef2'));
      else if (glint) c.set(x, y, hex('#ffffff'), 200);
      else c.set(x, y, [0, 0, 0], 0);
    }
  },
  coal_ore: (c) => oreTex(c, stoneBase, ['#262626', '#3a3a3a', '#1a1a1a'].map(hex)),
  iron_ore: (c) => oreTex(c, stoneBase, ['#d8af93', '#c49678', '#e6c3a8'].map(hex)),
  copper_ore: (c) => oreTex(c, stoneBase, ['#e07a4f', '#4fa88a', '#c4643c'].map(hex)),
  gold_ore: (c) => oreTex(c, stoneBase, ['#f7d74a', '#e0b52a', '#fff08a'].map(hex)),
  cinnabar_ore: (c) => oreTex(c, stoneBase, ['#c4182c', '#e83a3a', '#8f0f1d'].map(hex), 'gem'),
  azurite_ore: (c) => oreTex(c, stoneBase, ['#1f45b8', '#2f60e0', '#173a8f'].map(hex)),
  diamond_ore: (c) => oreTex(c, stoneBase, ['#6ff0e6', '#b8fff8', '#3fc9bf'].map(hex), 'gem'),
  beryl_ore: (c) => oreTex(c, stoneBase, ['#2ecf5a', '#7af59a', '#1a9a3e'].map(hex), 'gem'),
  deep_coal_ore: (c) => oreTex(c, deepBase, ['#151515', '#2a2a2a'].map(hex)),
  deep_iron_ore: (c) => oreTex(c, deepBase, ['#d8af93', '#c49678'].map(hex)),
  deep_copper_ore: (c) => oreTex(c, deepBase, ['#e07a4f', '#4fa88a'].map(hex)),
  deep_gold_ore: (c) => oreTex(c, deepBase, ['#f7d74a', '#e0b52a'].map(hex)),
  deep_cinnabar_ore: (c) => oreTex(c, deepBase, ['#c4182c', '#e83a3a'].map(hex), 'gem'),
  deep_azurite_ore: (c) => oreTex(c, deepBase, ['#1f45b8', '#2f60e0'].map(hex)),
  deep_diamond_ore: (c) => oreTex(c, deepBase, ['#6ff0e6', '#b8fff8'].map(hex), 'gem'),
  ice: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const crack = c.h(x + y, 0, 3) < 0.08 || c.h(x - y + 16, 1, 3) < 0.06;
      c.set(x, y, crack ? hex('#e8f4ff') : mix(hex('#8ab4f0'), hex('#a8c8f8'), c.h(x, y)), 190);
    }
  },
  cactus_side: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (x === 0 || x === 15) { c.set(x, y, [0, 0, 0], 0); continue; }
      let col = mix(hex('#2f7a2a'), hex('#4a9a3a'), c.h(x, y) * 0.6);
      if (x % 4 === 1) col = shade(col, 0.8);
      if ((x % 4 === 3) && (y % 5 === 2)) col = hex('#e8e0b0');
      c.set(x, y, col);
    }
  },
  cactus_top: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const inside = x > 0 && x < 15 && y > 0 && y < 15;
      if (!inside) { c.set(x, y, [0, 0, 0], 0); continue; }
      const r = Math.abs(x - 7.5) + Math.abs(y - 7.5);
      c.set(x, y, mix(hex('#3f8f35'), hex('#6ab04f'), (r % 4) / 4));
    }
  },
  cactus_bottom: (c) => GEN.cactus_top(c),
  tall_grass: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    for (let k = 0; k < 7; k++) {
      const x0 = 1 + Math.floor(c.rng() * 14), hgt = 6 + Math.floor(c.rng() * 9);
      for (let y = 0; y < hgt; y++) {
        const x = x0 + Math.round(Math.sin(y * 0.4 + k) * (y / hgt) * 1.5);
        c.set(x, 15 - y, shade([235, 235, 235], 0.65 + (y / hgt) * 0.35));
      }
    }
  },
  tnt_side: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = y >= 5 && y <= 10;
      c.set(x, y, band ? (y === 5 || y === 10 ? hex('#c8c8c0') : hex('#ece8dc')) : shade(hex(x % 4 === 0 ? '#9a2a1e' : '#c8382a'), 0.9 + c.h(x, y) * 0.15));
    }
    // a blocky word-mark on the white band
    for (const [x0, w] of [[2, 3], [6, 4], [11, 3]]) for (let x = x0; x < x0 + w; x++) c.set(x, 7, hex('#2a2a2a'));
    for (const x of [3, 7, 9, 12]) for (let y = 7; y <= 9; y++) c.set(x, y, hex('#2a2a2a'));
  },
  tnt_top: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#c8382a'), 0.85 + c.h(x, y) * 0.2)); for (let k = 6; k < 10; k++) for (let j = 6; j < 10; j++) c.set(k, j, hex('#3a2a20')); c.set(7, 7, hex('#d8d0c0')); },
  tnt_bottom: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#b8302a'), 0.85 + c.h(x, y) * 0.2)); },
  cobweb: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    const col = [236, 236, 240];
    for (let k = 0; k < 16; k++) { c.set(k, k, col); c.set(15 - k, k, col); c.set(7, k, col); c.set(k, 8, col); }
    for (const r of [3, 6]) for (let a = 0; a < 32; a++) { const t = a / 32 * Math.PI * 2; c.set(Math.round(7.5 + Math.cos(t) * r), Math.round(7.5 + Math.sin(t) * r), col, 200); }
  },
  lantern: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const frame = x < 2 || x > 13 || y < 2 || y > 13;
      c.set(x, y, frame ? shade(hex('#3a3a42'), 0.9 + c.h(x, y) * 0.2) : mix(hex('#ffd060'), hex('#ff9a20'), Math.abs(x - 7.5) / 8 + c.h(x, y) * 0.2));
    }
  },
  lantern_top: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#3a3a42'), 0.85 + c.h(x, y) * 0.25)); },
  painting_back: (c) => planks(c, '#8a6a42'),
  hay_side: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const band = y === 3 || y === 12; c.set(x, y, band ? hex('#7a4a1e') : shade(hex(x % 3 ? '#d8b03a' : '#c89a2a'), 0.85 + c.h(x, y) * 0.3)); } },
  hay_top: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const r = Math.hypot(x - 7.5, y - 7.5); c.set(x, y, shade(hex(Math.floor(r) % 2 ? '#d8b03a' : '#b88a24'), 0.85 + c.h(x, y) * 0.3)); } },
  cocoa: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex(y % 4 === 0 ? '#8a5226' : '#a8682e'), 0.85 + c.h(x, y) * 0.3)); },
  cocoa_top: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#9a5e2a'), 0.85 + c.h(x, y) * 0.25)); },
  item_frame: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const edge = x < 2 || y < 2 || x > 13 || y > 13; c.set(x, y, edge ? shade(hex('#8a6034'), 0.85 + c.h(x, y) * 0.3) : shade(hex('#9a7a5a'), 0.9 + c.h(x, y) * 0.15)); } },
  rail: (c) => railTex(c, false),
  rail_corner: (c) => railTex(c, true),
  oak_trapdoor: (c, base = '#a7834e', dark = '#6a4a28') => {
    // a plank frame with four square openings
    planks(c, base);
    const d = hex(dark);
    for (let i = 0; i < 16; i++) { c.set(i, 0, d); c.set(i, 15, d); c.set(0, i, d); c.set(15, i, d); }
    for (const [ox, oy] of [[3, 3], [9, 3], [3, 9], [9, 9]]) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) c.set(ox + x, oy + y, [0, 0, 0], 0);
  },
  oak_sapling: (c) => sapling(c, '#4f9a2a', '#2f6a1a', '#6a4a2a', false),
  birch_sapling: (c) => sapling(c, '#7aae4a', '#4a7a2a', '#d8d8cc', false),
  spruce_sapling: (c) => sapling(c, '#3f6a3a', '#24452a', '#4a3420', true),
  sunpetal: (c) => crossPlant(c, '#3f8a2a', '#ffd23a', '#e08a10'),
  redbloom: (c) => crossPlant(c, '#3f8a2a', '#d42a2a', '#2a1a10'),
  dead_bush: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    const col = hex('#8a6a3a');
    for (let y = 6; y < 16; y++) c.set(7 + ((y >> 2) & 1), y, col);
    for (let i = 0; i < 5; i++) { c.set(8 + i, 9 - i, col); c.set(6 - i, 10 - i, col); c.set(9 + (i >> 1), 6 - i, col); }
  },
  workbench_top: (c) => {
    planks(c, '#a7834e');
    const d = hex('#5a3f22');
    for (let i = 0; i < 16; i++) { c.set(i, 0, d); c.set(i, 15, d); c.set(0, i, d); c.set(15, i, d); }
    for (let i = 2; i < 14; i++) { c.set(i, 7, shade(d, 1.3)); c.set(7, i, shade(d, 1.3)); }
  },
  workbench_side: (c) => {
    planks(c, '#8e6c3d');
    const d = hex('#4a321c');
    for (let x = 0; x < 16; x++) { c.set(x, 0, d); c.set(x, 1, shade(d, 1.4)); }
    // a saw and a hammer silhouette
    for (let x = 3; x < 8; x++) c.set(x, 5, hex('#bfbfbf'));
    for (let y = 5; y < 11; y++) c.set(5, y, hex('#6b4a2a'));
    for (let y = 4; y < 12; y++) c.set(11, y, hex('#6b4a2a'));
    c.set(10, 4, hex('#9a9a9a')); c.set(12, 4, hex('#9a9a9a')); c.set(11, 3, hex('#9a9a9a'));
  },
  hopper: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      c.set(x, y, shade(hex('#4a4a50'), edge ? 0.7 : 0.9 + ((x * 7 + y * 3) % 5) * 0.04));
    }
    for (let i = 3; i < 13; i++) { c.set(i, 3, hex('#2a2a2e')); c.set(i, 12, hex('#5e5e66')); }
  },
  turtle_egg: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const spot = ((x * 7 + y * 11) % 13) < 2;
      c.set(x, y, spot ? hex('#6aa84a') : shade(hex('#f0ecd8'), 0.95 + ((x + y) % 3) * 0.03));
    }
  },
  nest_side: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = ((y + (x >> 2)) >> 2) & 1, n = ((x * 13 + y * 7) % 5) * 0.03;
      c.set(x, y, shade(hex(band ? '#d8a840' : '#c89030'), 0.94 + n));
    }
    for (let x = 0; x < 16; x++) { c.set(x, 0, hex('#8a6020')); c.set(x, 15, hex('#8a6020')); }
  },
  nest_top: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      c.set(x, y, shade(hex('#c89030'), r % 3 < 1 ? 0.8 : 1));
    }
  },
  nest_front: (c) => {
    GEN.nest_side(c);
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) c.set(x, y, hex('#3a2410')); // the entrance
  },
  nest_front_honey: (c) => {
    GEN.nest_front(c);
    for (const [x, y0, l] of [[2, 1, 4], [5, 1, 2], [11, 1, 5], [13, 1, 3], [7, 10, 3]]) for (let y = y0; y < y0 + l; y++) c.set(x, y, hex(y === y0 + l - 1 ? '#ffb020' : '#f0a018'));
  },
  hive_side: (c) => {
    planks(c, '#b8904e');
    for (let x = 0; x < 16; x++) { c.set(x, 3, hex('#8a6430')); c.set(x, 4, hex('#a07a40')); }
  },
  hive_top: (c) => {
    planks(c, '#c49a58');
    const d = hex('#8a6430');
    for (let i = 0; i < 16; i++) { c.set(i, 0, d); c.set(i, 15, d); c.set(0, i, d); c.set(15, i, d); }
  },
  hive_front: (c) => {
    GEN.hive_side(c);
    for (let y = 8; y < 11; y++) for (let x = 5; x < 11; x++) c.set(x, y, hex('#2a1a0a'));
  },
  hive_front_honey: (c) => {
    GEN.hive_front(c);
    for (const [x, y0, l] of [[3, 5, 4], [6, 5, 2], [12, 5, 5], [9, 11, 3]]) for (let y = y0; y < y0 + l; y++) c.set(x, y, hex(y === y0 + l - 1 ? '#ffb020' : '#f0a018'));
  },
  composter_side: (c) => {
    planks(c, '#8a6236');
    for (let y = 0; y < 16; y++) { c.set(0, y, hex('#5a3d1e')); c.set(15, y, hex('#5a3d1e')); }
    for (let x = 0; x < 16; x++) { c.set(x, 0, hex('#5a3d1e')); c.set(x, 15, hex('#4a3218')); }
  },
  composter_top: (c) => {
    planks(c, '#8a6236');
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) c.set(x, y, shade(hex('#3a2a18'), 0.9 + ((x * 5 + y * 3) % 4) * 0.04)); // the open top
  },
  composter_bottom: (c) => planks(c, '#7a5530'),
  compost: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = c.h(x, y, 21);
      c.set(x, y, n < 0.18 ? hex('#5a7a2a') : shade(hex('#4a3a20'), 0.8 + n * 0.4));
    }
  },
  compost_ready: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = c.h(x, y, 23);
      c.set(x, y, n < 0.3 ? shade(hex('#ecebe4'), 0.9 + n) : shade(hex('#5a4a2a'), 0.8 + n * 0.4));
    }
  },
  barrel_side: (c) => {
    // vertical staves with two iron hoops
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const stave = x % 4, base = hex('#8a6236');
      let col = shade(base, stave === 0 ? 0.72 : 1 + ((x * 7 + (y >> 2) * 3) % 5 - 2) * 0.03);
      if (y === 2 || y === 3 || y === 12 || y === 13) col = y === 2 || y === 12 ? hex('#7a7a80') : hex('#55555a');
      c.set(x, y, col);
    }
  },
  barrel_top: (c) => {
    planks(c, '#9a7040');
    const d = hex('#55555a'), m = hex('#7a7a80');
    for (let i = 0; i < 16; i++) { c.set(i, 0, d); c.set(i, 15, d); c.set(0, i, d); c.set(15, i, d); c.set(i, 1, m); c.set(1, i, m); c.set(i, 14, m); c.set(14, i, m); }
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) c.set(x, y, hex('#3a2a18')); // the bung hole
  },
  barrel_bottom: (c) => {
    planks(c, '#9a7040');
    const d = hex('#55555a');
    for (let i = 0; i < 16; i++) { c.set(i, 0, d); c.set(i, 15, d); c.set(0, i, d); c.set(15, i, d); }
  },
  chest_top: (c) => {
    planks(c, '#a2773f');
    const d = hex('#4e3416');
    for (let i = 0; i < 16; i++) { c.set(i, 0, d); c.set(i, 15, d); c.set(0, i, d); c.set(15, i, d); }
  },
  chest_side: (c) => {
    planks(c, '#9a6e38');
    const d = hex('#4e3416');
    for (let i = 0; i < 16; i++) { c.set(i, 0, d); c.set(i, 15, d); c.set(0, i, d); c.set(15, i, d); c.set(i, 5, d); c.set(i, 6, shade(d, 1.5)); }
  },
  chest_front: (c) => {
    GEN.chest_side(c);
    const m = hex('#c9c9c9'), md = hex('#6d6d6d');
    for (let y = 3; y < 9; y++) for (let x = 6; x < 10; x++) c.set(x, y, (x === 6 || y === 8) ? md : m);
    c.set(7, 6, md); c.set(8, 6, md);
  },
  // double chest halves: half a latch at the seam (on the left or right edge as seen from the front)
  chest_front_l: (c) => {
    GEN.chest_side(c);
    const m = hex('#c9c9c9'), md = hex('#6d6d6d');
    for (let y = 3; y < 9; y++) for (let x = 0; x < 2; x++) c.set(x, y, y === 8 ? md : m);
    c.set(0, 6, md);
  },
  chest_front_r: (c) => {
    GEN.chest_side(c);
    const m = hex('#c9c9c9'), md = hex('#6d6d6d');
    for (let y = 3; y < 9; y++) for (let x = 14; x < 16; x++) c.set(x, y, (x === 14 || y === 8) ? md : m);
    c.set(15, 6, md);
  },
  door_lower: (c, base = '#9c7444', dark = '#5a3d1e') => {
    planks(c, base);
    const d = hex(dark);
    for (let i = 0; i < 16; i++) { c.set(0, i, d); c.set(15, i, d); c.set(i, 15, d); }
    for (let y = 2; y < 13; y++) { c.set(3, y, shade(d, 1.3)); c.set(12, y, shade(d, 1.3)); }
    for (let x = 3; x < 13; x++) { c.set(x, 2, shade(d, 1.3)); c.set(x, 12, shade(d, 1.3)); }
    c.set(12, 1, hex('#8a8a8a')); c.set(13, 1, hex('#5a5a5a')); // handle
  },
  door_upper: (c, base = '#9c7444', dark = '#5a3d1e') => {
    planks(c, base);
    const d = hex(dark);
    for (let i = 0; i < 16; i++) { c.set(0, i, d); c.set(15, i, d); c.set(i, 0, d); }
    // two window panes
    for (let y = 3; y < 10; y++) for (const x0 of [3, 9]) for (let x = x0; x < x0 + 4; x++) c.set(x, y, [0, 0, 0], 0);
    for (let y = 2; y < 11; y++) { c.set(2, y, d); c.set(7, y, d); c.set(8, y, d); c.set(13, y, d); }
    for (let x = 2; x < 14; x++) { c.set(x, 2, d); c.set(x, 10, d); }
    c.set(12, 14, hex('#8a8a8a')); c.set(13, 14, hex('#5a5a5a'));
  },
  bed_side: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    const red = hex('#a02626'), wood = hex('#7a5530');
    for (let y = 7; y < 12; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(red, y === 7 ? 1.1 : 0.9 + c.h(x, y) * 0.12));
    for (let x = 0; x < 16; x++) c.set(x, 12, wood);
    for (let y = 13; y < 16; y++) for (const x of [0, 1, 2, 13, 14, 15]) c.set(x, y, shade(wood, 0.85));
  },
  ladder: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    const w = hex('#8a6438');
    for (let y = 0; y < 16; y++) { c.set(2, y, w); c.set(3, y, shade(w, 0.8)); c.set(12, y, w); c.set(13, y, shade(w, 0.8)); }
    for (const ry of [1, 5, 9, 13]) for (let x = 4; x < 12; x++) { c.set(x, ry, shade(w, 1.1)); c.set(x, ry + 1, shade(w, 0.75)); }
  },
  mossy_cobblestone: (c) => {
    GEN.cobblestone(c);
    const moss = ['#4f7a2e', '#5f8f36', '#3f6a26'].map(hex);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = c.h(x >> 1, y >> 1, 31) * 0.6 + c.h(x, y, 32) * 0.4;
      if (n > 0.58) c.set(x, y, moss[Math.floor(c.h(x, y, 33) * 3)]);
    }
  },
  monster_spawner: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    const bar = hex('#2a3038'), hi = hex('#4a5560');
    for (let i = 0; i < 16; i++) {
      for (const k of [0, 15]) { c.set(i, k, bar); c.set(k, i, bar); }
      for (const k of [4, 8, 11]) { c.set(k, i, i % 3 ? bar : hi); c.set(i, k, i % 3 ? bar : hi); }
    }
  },
  kelp: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    const g = hex('#3a7a2a'), d = hex('#2a5a1e');
    for (let y = 0; y < 16; y++) { const sw = Math.round(Math.sin(y * 0.6) * 1.5); c.set(7 + sw, y, g); c.set(8 + sw, y, d); }
    for (let k = 0; k < 4; k++) { const y = 2 + k * 4, s = k & 1 ? 1 : -1; for (let i = 1; i < 5; i++) c.set(7 + s * i + (s > 0 ? 1 : 0), y + (i >> 1), shade(g, 0.9 + i * 0.05)); }
  },
  seagrass: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    for (const [x0, h] of [[3, 9], [6, 14], [9, 11], [12, 7]]) for (let k = 0; k < h; k++) c.set(x0 + Math.round(Math.sin(k * 0.5) * 0.8), 15 - k, shade(hex('#4a9a3a'), 0.8 + (k / h) * 0.4));
  },
  dried_kelp_side: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#3a4a2a'), (y % 4 === 0 ? 0.7 : 0.9) + c.h(x, y) * 0.15)); },
  dried_kelp_top: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const r = Math.hypot(x - 7.5, y - 7.5); c.set(x, y, shade(hex('#3a4a2a'), (Math.floor(r) % 2 ? 0.8 : 1) + c.h(x, y) * 0.1)); } },
  bamboo: (c) => {
    // one thick green stalk with joints and a leaf or two
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    const g = hex('#6a9a2a'), d = hex('#4a7a1a'), j = hex('#a8c870');
    for (let y = 0; y < 16; y++) { const joint = y % 8 === 0; c.set(6, y, joint ? j : d); c.set(7, y, joint ? j : g); c.set(8, y, joint ? j : g); c.set(9, y, joint ? j : d); }
    for (let k = 0; k < 4; k++) { c.set(10 + k, 3 - (k >> 1), g); c.set(5 - k, 11 - (k >> 1), g); }
  },
  // scaffolding: a bamboo frame (box UVs: the posts sit in the side's outer columns, the plate in its top rows)
  scaffolding_side: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const post = x < 2 || x > 13, plate = y < 2, tie = (y === 2 || y === 13) && post;
      c.set(x, y, shade(hex(tie ? '#8a6a2a' : '#c8b04a'), (plate ? (x % 4 === 0 ? 0.8 : 0.95) : x % 2 ? 0.85 : 1) + c.h(x, y) * 0.08));
    }
  },
  scaffolding_top: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const rim = x < 2 || x > 13 || y < 2 || y > 13, slat = !rim && (y % 3 === 0);
      c.set(x, y, shade(hex(rim ? '#c8b04a' : '#b89a3a'), (slat ? 0.7 : rim && (x + y) % 4 === 0 ? 0.85 : 0.95) + c.h(x, y) * 0.08));
    }
  },
  beryl_block: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15, facet = (x + y) % 6 === 0 || (x - y + 16) % 6 === 0;
      c.set(x, y, shade(hex('#2ecf5a'), edge ? 0.7 : facet ? 1.2 : 0.95 + c.h(x, y) * 0.08));
    }
  },
  beacon: (c) => {
    // a glass shell round a glowing core on a dark obsidian floor
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15, core = x >= 4 && x <= 11 && y >= 4 && y <= 11, floor = y >= 13;
      if (core) c.set(x, y, shade(hex('#bff8f0'), 0.9 + c.h(x, y) * 0.15));
      else if (floor) c.set(x, y, shade(hex('#1e1630'), 0.9 + c.h(x, y) * 0.2));
      else c.set(x, y, edge ? hex('#e8f4f8') : hex('#a8d0dc'), edge ? 255 : 90);
    }
  },
  // Grindstone: a sandy-grey wheel (face with rings round the axle) on dark wooden legs
  grindstone_round: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#9a968c'), 0.88 + c.h(x, y) * 0.12 + (c.h(x, y >> 1, 2) < 0.15 ? -0.12 : 0)));
  },
  grindstone_face: (c) => {
    // the wheel's face as the box shows it: centred on (7.5, 5.5)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 5.5);
      const f = d < 1.3 ? 0.45 : d > 5.4 ? 0.78 : Math.abs(d - 3.4) < 0.5 ? 0.86 : 0.98;
      c.set(x, y, shade(hex('#a8a498'), f + c.h(x, y) * 0.08));
    }
  },
  grindstone_leg: (c) => planks(c, '#4e3420'),
  grindstone_pivot: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#5e4028'), (y % 6 === 0 ? 0.75 : 0.95) + c.h(x, y) * 0.1)); },
  // Stonecutter: a polished stone base banded with iron, a round plate under the blade
  stonecutter_top: (c) => {
    polished(c, '#8c8c90');
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) if (Math.hypot(x - 7.5, y - 7.5) < 4) c.set(x, y, shade(hex('#5c5e66'), 0.9 + c.h(x, y) * 0.15));
  },
  stonecutter_side: (c) => {
    polished(c, '#8c8c90');
    for (let x = 0; x < 16; x++) { c.set(x, 7, shade(hex('#6a6c74'), 1.1)); c.set(x, 8, hex('#4a4c54')); c.set(x, 15, shade(hex('#5a5a5e'), 0.9)); }
    for (const x of [2, 13]) for (let y = 9; y < 15; y++) c.set(x, y, shade(hex('#6a6c74'), 0.95));
  },
  stonecutter_bottom: (c) => polished(c, '#7a7a7e'),
  stonecutter_blank: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0); }, // the blade's edges and top are not drawn
  flower_pot: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#9a5a3a'), (y === 10 ? 1.15 : 0.9) + c.h(x, y) * 0.12)); },
  flower_pot_top: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const rim = x < 6 || x > 9 || y < 6 || y > 9;
      c.set(x, y, rim ? shade(hex('#9a5a3a'), 1.05 + c.h(x, y) * 0.1) : shade(hex('#5a3a22'), 0.8 + c.h(x, y) * 0.3));
    }
  },
  chain: (c) => {
    // links down the middle columns (box UVs put the chain's sides there); the rest stays clear
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    for (let y = 0; y < 16; y++) {
      const ring = y % 8 < 5, edge = y % 8 === 0 || y % 8 === 4;
      if (ring) { for (const x of [6, 9]) c.set(x, y, shade(hex('#4a5058'), 0.9)); if (edge) for (const x of [7, 8]) c.set(x, y, shade(hex('#6a7078'), 1)); }
      else for (const x of [7, 8]) c.set(x, y, shade(hex('#5a6068'), 1.05));
    }
  },
  bamboo_planks: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const seam = x % 4 === 3, node = y % 8 === 0;
      c.set(x, y, shade(hex('#c8b84a'), seam ? 0.7 : node ? 0.85 : 0.95 + c.h(x, y) * 0.08));
    }
  },
  sugar_cane: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    const g = hex('#8ac85a'), d = hex('#5f9a3a'), j = hex('#c8e8a0');
    for (const sx of [3, 8, 12]) for (let y = 0; y < 16; y++) {
      const joint = (y + sx) % 6 === 0;
      c.set(sx, y, joint ? j : g); c.set(sx + 1, y, joint ? j : d);
    }
    c.set(5, 4, g); c.set(6, 3, g); c.set(10, 9, g); c.set(11, 8, d);
  },
  moss_block: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#5a7a2a'), 0.75 + c.h(x, y, 41) * 0.25 + (c.h(x >> 2, y >> 2, 42) - 0.5) * 0.2)); },
  azalea: (c) => azaleaTex(c, false),
  flowering_azalea: (c) => azaleaTex(c, true),
  cave_vines: (c) => caveVine(c, false),
  cave_vines_lit: (c) => caveVine(c, true),
  bone_block_side: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#e4ddc4'), (x % 5 === 0 ? 0.85 : 1) * (0.94 + c.h(x, y) * 0.08))); },
  bone_block_top: (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const r = Math.hypot(x - 7.5, y - 7.5); c.set(x, y, shade(hex('#e4ddc4'), r < 3 ? 0.75 : r > 7 ? 0.85 : 0.97 + c.h(x, y) * 0.05)); } },
  jukebox_side: (c) => {
    planks(c, '#6a4a30');
    for (let i = 0; i < 16; i++) { c.set(i, 0, hex('#3a2818')); c.set(i, 15, hex('#3a2818')); c.set(0, i, hex('#3a2818')); c.set(15, i, hex('#3a2818')); }
    for (let x = 3; x < 13; x++) c.set(x, 7, hex('#4a3420'));
  },
  jukebox_top: (c) => {
    GEN.jukebox_side(c);
    for (let y = 5; y < 11; y++) for (let x = 2; x < 14; x++) c.set(x, y, hex('#1e1612')); // the disc slot
    for (let x = 3; x < 13; x++) c.set(x, 8, hex('#3a2a20'));
  },
  bookshelf: (c) => {
    planks(c, '#a7834e');
    const cols = ['#8a2a2a', '#2a4a8a', '#2a6a3a', '#8a6a2a', '#5a2a6a', '#3a3a3a'].map(hex);
    for (const [y0, y1] of [[1, 7], [9, 15]]) {
      for (let x = 1; x < 15;) {
        const w = 1 + Math.floor(c.h(x, y0, 61) * 2), col = cols[Math.floor(c.h(x, y0, 62) * cols.length)];
        const top = y0 + Math.floor(c.h(x, y0, 63) * 2);
        for (let xx = x; xx < Math.min(15, x + w); xx++) for (let y = top; y < y1; y++) c.set(xx, y, shade(col, y === top ? 1.25 : 0.9 + c.h(xx, y) * 0.15));
        x += w + (c.h(x, y0, 64) < 0.2 ? 1 : 0);
      }
    }
  },
  bricks: (c) => {
    const b = hex('#9a4a3a'), m = hex('#c8bcb0');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const row = y >> 2, off = row % 2 ? 4 : 0;
      const mortar = y % 4 === 3 || (x + off) % 8 === 7;
      c.set(x, y, mortar ? shade(m, 0.9 + c.h(x, y) * 0.1) : shade(b, 0.85 + c.h(x >> 1, y >> 1, 3) * 0.3));
    }
  },
  furnace_top: (c) => c.noiseFill(['#6e6e70', '#7c7c7e', '#626264'].map(hex), 0.3),
  furnace_side: (c) => {
    c.noiseFill(['#6e6e70', '#7c7c7e', '#626264'].map(hex), 0.3);
    for (let x = 0; x < 16; x++) c.set(x, 0, hex('#58585a'));
  },
  furnace_front: (c) => {
    GEN.furnace_side(c);
    for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) c.set(x, y, hex('#1e1e1e'));
    for (let x = 3; x < 13; x++) c.set(x, 7, hex('#4a4a4c'));
  },
  furnace_front_lit: (c) => {
    GEN.furnace_front(c);
    for (let y = 10; y < 14; y++) for (let x = 4; x < 12; x++) c.set(x, y, mix(hex('#ff7a1a'), hex('#ffe066'), c.h(x, y)));
  },
  // Smoker: a stone oven in a dark wooden frame
  smoker_top: (c) => { c.noiseFill(['#5e5a56', '#6a6460', '#524e4a'].map(hex), 0.3); for (let i = 0; i < 16; i++) for (const j of [0, 15]) { c.set(i, j, hex('#4a3420')); c.set(j, i, hex('#4a3420')); } },
  smoker_side: (c) => { planks(c, '#5a4028'); for (let y = 5; y < 11; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#6a6662'), 0.9 + c.h(x, y) * 0.15)); },
  smoker_front: (c) => { GEN.smoker_side(c); for (let y = 6; y < 11; y++) for (let x = 4; x < 12; x++) c.set(x, y, hex('#1a1714')); },
  smoker_front_lit: (c) => { GEN.smoker_front(c); for (let y = 8; y < 11; y++) for (let x = 4; x < 12; x++) c.set(x, y, mix(hex('#ff7a1a'), hex('#ffd060'), c.h(x, y))); },
  // Blast Furnace: smooth dark stone bound with iron
  blast_furnace_top: (c) => { c.noiseFill(['#5a5a5e', '#646468', '#4e4e52'].map(hex), 0.2); for (let i = 3; i < 13; i++) for (let j = 3; j < 13; j++) c.set(i, j, hex('#3a3a3e')); },
  blast_furnace_side: (c) => { c.noiseFill(['#5a5a5e', '#646468', '#4e4e52'].map(hex), 0.2); for (let x = 0; x < 16; x++) { c.set(x, 0, hex('#9a9aa0')); c.set(x, 15, hex('#9a9aa0')); c.set(x, 7, hex('#8a8a90')); } },
  blast_furnace_front: (c) => { GEN.blast_furnace_side(c); for (let y = 9; y < 14; y++) for (let x = 3; x < 13; x++) c.set(x, y, (x & 1) ? hex('#2a2a2e') : hex('#141416')); },
  blast_furnace_front_lit: (c) => { GEN.blast_furnace_front(c); for (let y = 9; y < 14; y++) for (let x = 3; x < 13; x += 2) c.set(x, y, mix(hex('#ff7a1a'), hex('#fff0a0'), c.h(x, y))); },
  // Dispenser and Dropper: a stone block with a face; the Dispenser gapes with a round mouth, the Dropper has a slot
  dispenser_top: (c) => {
    c.noiseFill(['#6e6e70', '#7c7c7e', '#626264'].map(hex), 0.3);
    for (let i = 2; i < 14; i++) for (const j of [2, 13]) { c.set(i, j, hex('#58585a')); c.set(j, i, hex('#58585a')); }
  },
  dispenser_front: (c) => {
    GEN.furnace_side(c);
    for (let i = 1; i < 15; i++) for (const j of [1, 14]) { c.set(i, j, hex('#5e5e60')); c.set(j, i, hex('#5e5e60')); }
    // eyes under a heavy brow
    for (let x = 3; x < 13; x++) if (x < 7 || x > 8) c.set(x, 3, hex('#4a4a4c'));
    for (const ex of [4, 10]) for (let y = 4; y < 6; y++) for (let x = ex; x < ex + 2; x++) c.set(x, y, hex('#141416'));
    // a round open mouth with a dark throat
    const R = [[6, 10], [5, 11], [5, 11], [5, 11], [6, 10]];
    R.forEach(([a, b], k) => { for (let x = a - 1; x <= b; x++) c.set(x, 8 + k, hex('#3e3e40')); });
    R.forEach(([a, b], k) => { if (k === 0 || k === 4) return; for (let x = a; x < b; x++) c.set(x, 8 + k, mix(hex('#0c0c0e'), hex('#1e1e22'), c.h(x, k))); });
    for (let x = 6; x < 10; x++) c.set(x, 8, hex('#0c0c0e'));
  },
  dropper_front: (c) => {
    GEN.furnace_side(c);
    for (let i = 1; i < 15; i++) for (const j of [1, 14]) { c.set(i, j, hex('#5e5e60')); c.set(j, i, hex('#5e5e60')); }
    // small eyes and a wide, flat slot of a mouth
    for (const ex of [4, 10]) for (let y = 4; y < 6; y++) for (let x = ex; x < ex + 2; x++) c.set(x, y, hex('#141416'));
    for (let x = 3; x < 13; x++) { c.set(x, 9, hex('#3e3e40')); c.set(x, 12, hex('#3e3e40')); }
    for (let y = 10; y < 12; y++) for (let x = 3; x < 13; x++) c.set(x, y, hex('#0c0c0e'));
  },
  torch: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    for (let y = 6; y < 16; y++) { c.set(7, y, hex('#7a5a32')); c.set(8, y, hex('#5f4526')); }
    c.set(7, 6, hex('#ffd85a')); c.set(8, 6, hex('#ffb02a')); c.set(7, 7, hex('#ff9a20')); c.set(8, 7, hex('#ffe680'));
  },
  obsidian: (c) => c.noiseFill(['#140f1f', '#1d1530', '#0c0814', '#2c2045', '#3a2a5a'].map(hex), 0.4),
  wool: (c) => c.noiseFill(['#e9ecec', '#dfe3e3', '#f4f6f6', '#d4d8d8'].map(hex), 0.5),
  coal_block: (c) => c.noiseFill(['#1a1a1a', '#242424', '#121212', '#2e2e2e'].map(hex), 0.2),
  // enchanting table: crimson cloth top with a gold-trimmed rune square, obsidian-and-diamond sides
  enchanting_table_top: (c) => {
    const red = ['#7a1a26', '#8c2230', '#6a1420', '#9a2a38'].map(hex), gold = hex('#d8b040'), dark = hex('#2a1018');
    c.noiseFill(red, 0.4);
    for (let i = 0; i < 16; i++) { c.set(i, 0, dark); c.set(i, 15, dark); c.set(0, i, dark); c.set(15, i, dark); }
    for (let i = 3; i < 13; i++) { c.set(i, 3, gold); c.set(i, 12, gold); c.set(3, i, gold); c.set(12, i, gold); }
    // a little rune in the middle
    for (const [x, y] of [[7, 5], [8, 5], [6, 6], [9, 6], [7, 7], [8, 8], [6, 9], [9, 9], [7, 10], [8, 10], [5, 7], [10, 8]]) c.set(x, y, shade(gold, 0.85 + c.h(x, y) * 0.3));
    for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) c.set(x, y, hex('#5fe6dc'));
  },
  enchanting_table_side: (c) => {
    GEN.obsidian(c);
    const red = hex('#8c2230'), gold = hex('#d8b040');
    // the cloth hangs over the top edge (rows 4..7 of the 3/4-high side)
    for (let x = 0; x < 16; x++) for (let y = 4; y < 8; y++) {
      const hang = y < 6 || (y === 6 && x % 4 !== 0) || (y === 7 && x % 4 === 2);
      if (hang) c.set(x, y, shade(red, 0.85 + c.h(x, y) * 0.3));
    }
    for (let x = 0; x < 16; x++) if (x % 4 !== 0) c.set(x, 5, gold);
    // diamond corner studs
    for (const x of [1, 14]) for (const y of [10, 13]) c.set(x, y, hex('#5fe6dc'));
  },
  // Brewing Alembic: cobblestone base, a glowing ember rod and a dark iron cross-arm
  brewing_stand_base: (c) => GEN.cobblestone(c),
  brewing_stand_top: (c) => {
    GEN.cobblestone(c);
    const iron = hex('#3a3236'), rod = hex('#ffb030');
    for (let i = 3; i < 13; i++) { c.set(i, 7, iron); c.set(i, 8, shade(iron, 0.8)); c.set(7, i, iron); c.set(8, i, shade(iron, 0.8)); }
    for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]]) c.set(x, y, rod);
  },
  brewing_stand_side: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    const cob = new Canvas16('cobblestone'); GEN.cobblestone(cob);
    for (let y = 14; y < 16; y++) for (let x = 0; x < 16; x++) { const i = (y * 16 + x) * 4; c.set(x, y, [cob.data[i], cob.data[i + 1], cob.data[i + 2]]); }
    const iron = hex('#3a3236');
    for (let x = 3; x < 13; x++) { c.set(x, 4, shade(iron, 1.2)); c.set(x, 5, iron); }
    for (let y = 2; y < 14; y++) {
      const t = (y - 2) / 12;
      c.set(7, y, mix(hex('#ffe080'), hex('#d8601a'), t)); c.set(8, y, mix(hex('#ffc040'), hex('#a8400e'), t));
    }
  },
  anvil_side: (c) => {
    const p = ['#3e3e42', '#46464a', '#38383c', '#4e4e52'].map(hex);
    c.noiseFill(p, 0.35);
    for (let x = 0; x < 16; x++) { c.set(x, 0, hex('#5a5a60')); c.set(x, 15, hex('#2a2a2e')); }
  },
  anvil_top: (c) => {
    const p = ['#4a4a4e', '#525256', '#44444a'].map(hex);
    c.noiseFill(p, 0.3);
    // a worn, polished striking face
    for (let y = 5; y < 11; y++) for (let x = 2; x < 14; x++) c.set(x, y, shade(hex('#6a6a70'), 0.92 + c.h(x, y) * 0.16));
    for (let x = 2; x < 14; x++) { c.set(x, 5, hex('#7a7a80')); c.set(x, 10, hex('#3a3a3e')); }
  },
  iron_block: (c) => metalBlock(c, '#d8d8d8'),
  gold_block: (c) => metalBlock(c, '#f5cd3a'),
  diamond_block: (c) => metalBlock(c, '#5fe6dc'),
  stone_bricks: (c) => {
    stoneBase(c);
    const m = hex('#555558');
    for (let x = 0; x < 16; x++) { c.set(x, 7, m); c.set(x, 15, m); }
    for (let y = 0; y < 7; y++) { c.set(7, y, m); }
    for (let y = 8; y < 15; y++) { c.set(15, y, m); }
  },
  mossy_stone_bricks: (c) => {
    GEN.stone_bricks(c);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (c.h(x >> 1, y >> 1, 11) < 0.3 + (y > 10 ? 0.2 : 0)) c.set(x, y, shade(hex('#5a7a3a'), 0.8 + c.h(x, y) * 0.3));
  },
  cracked_stone_bricks: (c) => {
    GEN.stone_bricks(c);
    const d = hex('#3e3e42');
    let x = 3, y = 0;
    for (let k = 0; k < 16; k++) { c.set(x, y, d); y++; if (c.h(k, 0, 12) < 0.5) x++; else if (x > 1) x--; }
    x = 11; y = 8;
    for (let k = 0; k < 8; k++) { c.set(x, y, d); y++; x += c.h(k, 1, 13) < 0.5 ? 1 : -1; }
  },
  chiseled_stone_bricks: (c) => {
    stoneBase(c);
    const m = hex('#555558'), l = hex('#a8a8ac');
    for (let i = 0; i < 16; i++) { c.set(i, 0, m); c.set(i, 15, m); c.set(0, i, m); c.set(15, i, m); c.set(i, 1, l); c.set(1, i, l); }
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) if (x === 4 || x === 11 || y === 4 || y === 11 || (x === y) || (x + y === 15)) c.set(x, y, m);
  },
};

function metalBlock(c, base) {
  const b = hex(base);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const hl = x + y < 10 ? 1.1 : 0.95;
    c.set(x, y, shade(b, (edge ? 0.75 : hl) * (0.96 + c.h(x, y) * 0.06)));
  }
}

// Break-progress cracks. One fixed crack pattern grows from the middle of the
// face; stage n draws a longer prefix of it than stage n-1, so the cracks
// spread continuously while a block is mined.
const CRACK_PATH = (() => {
  const rng = mulberry32(99), seen = new Set(), path = [], walkers = [];
  for (let k = 0; k < 5; k++) walkers.push({ x: 7.5 + (rng() - 0.5), y: 7.5 + (rng() - 0.5), a: (k / 5) * Math.PI * 2 + rng() * 0.6 });
  for (let step = 0; step < 500 && walkers.length; step++) {
    const w = walkers[step % walkers.length];
    w.a += (rng() - 0.5) * 0.6;
    w.x += Math.cos(w.a) * 0.8; w.y += Math.sin(w.a) * 0.8;
    const px = Math.round(w.x), py = Math.round(w.y);
    if (px < 0 || py < 0 || px > 15 || py > 15) { walkers.splice(walkers.indexOf(w), 1); continue; }
    const key = px + py * 16;
    if (!seen.has(key)) { seen.add(key); path.push(key); }
    if (rng() < 0.05 && walkers.length < 10) walkers.push({ x: w.x, y: w.y, a: w.a + (rng() < 0.5 ? 1 : -1) * (0.7 + rng() * 0.5) });
  }
  return path;
})();

// Encoded for multiply blending (result = 2 * crack * block): 128 grey leaves
// the block unchanged, darker values cut cracks into it, lighter ones chip it.
function destroyStage(c, stage) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [128, 128, 128], 0);
  const n = Math.round(CRACK_PATH.length * Math.pow((stage + 1) / 10, 1.25));
  for (let i = 0; i < n; i++) {
    const x = CRACK_PATH[i] & 15, y = CRACK_PATH[i] >> 4;
    c.set(x, y, [30, 30, 30], 255);
    // a lighter chipped edge below/right of each crack pixel
    for (const [dx, dy] of [[1, 0], [0, 1]]) if (x + dx < 16 && y + dy < 16 && c.get(x + dx, y + dy)[3] === 0 && c.h(x, y, dx) < 0.45) c.set(x + dx, y + dy, [158, 158, 158], 255);
  }
}

// Fire: 8 looping frames of rising flame tongues. Each column has its own
// height that wobbles over time; colour runs from white-yellow at the base to
// deep orange at the tips. Frames tile vertically so the loop is seamless.
function fire(c, frame) {
  const cols = [];
  for (let x = 0; x < 16; x++) {
    const ph = c.h(x, 0, 7) * Math.PI * 2, base = 0.45 + c.h(x, 1, 8) * 0.4;
    const edge = Math.min(x, 15 - x) < 2 ? 0.55 : 1;
    cols.push(16 * edge * (base + 0.18 * Math.sin(ph + frame * Math.PI / 4)));
  }
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const h = (cols[x] + (cols[(x + 1) & 15] + cols[(x + 15) & 15]) * 0.5) / 2;
    const up = 15 - y; // height above the bottom
    const flick = hash4(c.seed, x, (y + frame * 2) & 15, 9) / 4294967296;
    if (up > h + flick * 2 - 1) { c.set(x, y, [0, 0, 0], 0); continue; }
    const t = Math.min(1, up / Math.max(1, h));
    const col = t < 0.35 ? mix(hex('#fff3b0'), hex('#ffc93a'), t / 0.35) : mix(hex('#ffb12a'), hex('#d8420e'), (t - 0.35) / 0.65);
    c.set(x, y, shade(col, 0.9 + flick * 0.15));
  }
}

// Stonecutter blade: the top half of a steel disc (rows 0-6 are what the blade box shows),
// its teeth stepping round over 4 frames so the saw seems to spin.
function sawBlade(c, frame) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = x - 7.5, dy = y - 7.5, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 7.6) { c.set(x, y, [0, 0, 0], 0); continue; }
    const ang = Math.atan2(dy, dx), tooth = Math.floor((ang / (Math.PI * 2) + 1) * 16 + frame * 0.5) & 1;
    if (d > 6.4) { if (tooth) c.set(x, y, shade(hex('#e8e8f0'), 0.95 + c.h(x, y) * 0.05)); else c.set(x, y, [0, 0, 0], 0); continue; }
    const hub = d < 2.2, ring = Math.abs(d - 4.4) < 0.5;
    const streak = Math.floor((ang / (Math.PI * 2) + 1) * 8 + frame * 0.5) & 1; // a sheen that turns with the blade
    c.set(x, y, shade(hex(hub ? '#5a5a62' : '#b4b6c0'), hub ? 1 : ring ? 0.8 : streak ? 1.08 : 0.94));
  }
}

function paint(c, name) {
  if (name.startsWith('destroy_')) destroyStage(c, +name.slice(8));
  else if (name.startsWith('painting_') && name !== 'painting_back') { const [, a, p] = name.split('_'); c.data.set(paintingPart(+a, +p)); }
  else if (name === 'fire') fire(c, 0);
  else if (name.startsWith('fire_')) fire(c, +name.slice(5));
  else if (name === 'stonecutter_saw') sawBlade(c, 0);
  else if (name.startsWith('stonecutter_saw_')) sawBlade(c, +name.slice(16));
  else if (name.startsWith('wheat_')) wheat(c, +name.slice(6));
  else if (name.startsWith('carrots_')) carrots(c, +name.slice(8));
  else if (name.startsWith('stem_')) {
    // a stalk that grows taller and turns from green to brown-orange when it can bear fruit
    const st = +name.slice(5), h = 2 + st * 1.7;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    const col = st === 7 ? hex('#a8782a') : mix(hex('#4a9a2a'), hex('#8aa02a'), st / 7);
    for (let k = 0; k < h; k++) { const x = 7 + Math.round(Math.sin(k * 0.7) * 1.2); c.set(x, 15 - k, shade(col, 0.85 + c.h(x, k) * 0.3)); if (k > 3 && k % 3 === 0) { c.set(x + 1, 15 - k, col); c.set(x - 1, 14 - k, col); } }
  }
  else if (name.startsWith('sweet_berry_bush_')) berryBush(c, +name.slice(17));
  else if (name.startsWith('potatoes_')) rootCrop(c, +name.slice(9), '#4a9a34', '#2f7424', '#c8a25a', 3);
  else if (name.startsWith('cinderroot_')) cinderroot(c, +name.slice(11));
  else if (name.startsWith('beetroots_')) rootCrop(c, +name.slice(10), '#3f8a2a', '#9a2a3a', '#8a1e2e', 2);
  else if (name.startsWith('bed_head_top_') || name.startsWith('bed_foot_top_')) bedTop(c, name.startsWith('bed_head'), +name.slice(-1));
  else if (GEN[name]) GEN[name](c);
  else if (COLOR_TEX[name]) COLOR_TEX[name](c);
  else if (DIM_TEX[name]) DIM_TEX[name](c, { hex, mix, shade });
  else if (MONUMENT_TEX[name]) MONUMENT_TEX[name](c, { hex, mix, shade });
  else if (CIRCUIT_TEX[name]) CIRCUIT_TEX[name](c, { hex, mix, shade, gen: GEN, planks });
  else if (CAVE_TEX[name]) CAVE_TEX[name](c, { hex, mix, shade });
  else if (HUSH_TEX[name]) HUSH_TEX[name](c, { hex, mix, shade });
  else c.noiseFill(P.stone);
}

// coral blocks and corals
for (const [key, base, hi] of [['tube', '#3050c8', '#6a8af0'], ['brain', '#d0508a', '#f08ab8'], ['bubble', '#a030b0', '#d070e0'], ['fire', '#c82a2a', '#f06a4a'], ['horn', '#d0b020', '#f0d860']]) {
  GEN[key + '_coral_block'] = (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const n = c.h(x, y, 31); c.set(x, y, n < 0.2 ? hex(hi) : shade(hex(base), 0.8 + c.h(x >> 1, y >> 1, 32) * 0.35)); } };
  GEN[key + '_coral'] = (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    // a few branching fingers from the base
    for (const [x0, lean] of [[4, -1], [8, 0], [11, 1]]) {
      let x = x0;
      for (let y = 15; y > 3 + (x0 % 3); y--) { c.set(x, y, shade(hex(base), 0.85 + c.h(x, y, 33) * 0.3)); if (y % 4 === 0) { x += lean; c.set(x + lean, y - 1, hex(hi)); } }
      c.set(x, 3 + (x0 % 3), hex(hi));
    }
  };
}

// doors and trapdoors of the other woods, in their planks' colours
for (const [key, base] of [['spruce', '#6f4f2f'], ['birch', '#cdb987'], ['jungle', '#a07350'], ['acacia', '#b0603a'], ['dark_oak', '#4f3720'], ['blossom', '#e2b2a6'], ['mangrove', '#7a3530']]) {
  const dark = '#' + hex(base).map((v) => Math.round(v * 0.55).toString(16).padStart(2, '0')).join('');
  GEN[key + '_door_lower'] = (c) => GEN.door_lower(c, base, dark);
  GEN[key + '_door_upper'] = (c) => GEN.door_upper(c, base, dark);
  GEN[key + '_trapdoor'] = (c) => GEN.oak_trapdoor(c, base, dark);
}

// stained glass, concrete and terracotta in the sixteen dye colours
const TERRACOTTA_RGB = { magenta: '#95586c', light_blue: '#706c8a', lime: '#677535', pink: '#a14e4e', gray: '#392a23', cyan: '#575b5b', purple: '#764656', blue: '#4a3b5b', green: '#4c532a', black: '#251610' };
const COLOR_TEX = {};
for (const [key, , rgb] of COLORS) {
  COLOR_TEX[key + '_stained_glass'] = (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15, glint = (x - y === 3 || x - y === 4) && x > 4 && x < 12;
      c.set(x, y, shade(rgb, edge ? 0.8 : glint ? 1.25 : 1), edge ? 220 : glint ? 170 : 120);
    }
  };
  COLOR_TEX[key + '_concrete'] = (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(rgb, 0.95 + c.h(x, y) * 0.06)); };
  if (TERRACOTTA_RGB[key]) COLOR_TEX[key + '_terracotta'] = (c) => terracotta(c, TERRACOTTA_RGB[key]);
  COLOR_TEX[key + '_carpet'] = (c) => { GEN.wool(c); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const p = c.get(x, y); c.set(x, y, [p[0] * rgb[0] / 255, p[1] * rgb[1] / 255, p[2] * rgb[2] / 255]); } };
}

// candles: soft wax with a lighter rim of melted wax at the top and a drip or two down the sides
function candleTex(c, rgb) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const drip = (x % 5 === 1 && y > 9 && y < 12 + (x % 3)) || y >= 10 && y <= 11;
    c.set(x, y, shade(rgb, drip ? 1.12 : 0.9 + c.h(x, y) * 0.08 - (x % 2) * 0.04));
  }
}
GEN.candle = (c) => candleTex(c, hex('#e8d8b0'));
for (const [key, , rgb] of COLORS) COLOR_TEX[key + '_candle'] = (c) => candleTex(c, rgb);
GEN.candle_wick = (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#2a2420'), 0.9 + c.h(x, y) * 0.2)); };
GEN.candle_flame = (c) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, y < 6 ? hex('#fff4c0') : y < 11 ? hex('#ffc040') : hex('#ff8020'));
};

// croaklights: a glowing core under a ribbed rind (amber, pearl, moss)
for (const [key, core, rind] of [['amber', '#ffe090', '#d89a3a'], ['pearl', '#fff0f8', '#d8b0d8'], ['moss', '#f0ffd0', '#8ab060']]) {
  GEN[key + '_croaklight_side'] = (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const rib = y % 5 === 0 || x === 0 || x === 15;
      c.set(x, y, shade(hex(rib ? rind : core), rib ? 0.9 + c.h(x, y) * 0.1 : 0.92 + c.h(x >> 1, y >> 1) * 0.12));
    }
  };
  GEN[key + '_croaklight_top'] = (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      c.set(x, y, shade(hex(r > 6 ? rind : core), r > 6 ? 0.9 : 1 - r * 0.02 + c.h(x, y) * 0.06));
    }
  };
}

// Mangrove swamps: mud and its bricks, the red mangrove wood, tangled roots and propagules
function mudTex(c) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = c.h(x >> 1, y >> 1, 1) * 0.6 + c.h(x, y) * 0.4;
    c.set(x, y, n > 0.9 ? hex('#5a524c') : shade(hex('#3d3532'), 0.86 + n * 0.28)); // wet glints
  }
}
/** Thin, wavy root strands over whatever is already drawn (a transparent canvas for the roots block). */
function rootStrands(c, col, dark) {
  const a = hex(col), d = hex(dark);
  const put = (x, y, k) => c.set(((x % 16) + 16) % 16, ((y % 16) + 16) % 16, shade(c.h(x, y, k) < 0.3 ? d : a, 0.85 + c.h(x, y, k + 1) * 0.3));
  for (const [x0, ph] of [[1, 0], [6, 2], [11, 4]]) for (let y = 0; y < 16; y++) put(x0 + Math.round(Math.sin((y + ph) * 0.55) * 1.2), y, 3);
  for (const [y0, sl] of [[2, 1], [9, -1]]) for (let x = 0; x < 16; x++) put(x, y0 + Math.round(x * sl * 0.45), 5);
}
GEN.mud = mudTex;
GEN.packed_mud = (c) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const straw = c.h(x, y, 7) < 0.08;
    c.set(x, y, straw ? hex('#c8a860') : shade(hex('#8c6a50'), 0.88 + c.h(x >> 1, y >> 1, 2) * 0.12 + c.h(x, y) * 0.06));
  }
};
GEN.mud_bricks = (c) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = y >> 2, off = row % 2 ? 4 : 0, mortar = y % 4 === 3 || (x + off) % 8 === 7;
    c.set(x, y, mortar ? shade(hex('#a88a6c'), 0.95 + c.h(x, y) * 0.08) : shade(hex('#86644c'), 0.88 + c.h(x, y, 3) * 0.12 + c.h((x + off) >> 3, row, 4) * 0.08));
  }
};
GEN.mangrove_log = (c) => logSide(c, '#5a3a2c', '#3e281e', false);
GEN.mangrove_log_top = (c) => logTop(c, '#5a3a2c', '#8a3c34');
GEN.mangrove_planks = (c) => planks(c, '#7a3530');
GEN.mangrove_leaves = (c) => {
  // glossy olive-green leaves, yellower at the tips
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = c.h(x, y);
    if (n > 0.8) { c.set(x, y, [0, 0, 0], 0); continue; }
    c.set(x, y, c.h(x, y, 9) < 0.1 ? hex('#a6c050') : shade(hex('#5a8a34'), 0.7 + c.h(x >> 1, y >> 1, 3) * 0.4));
  }
};
GEN.mangrove_roots = (c) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
  rootStrands(c, '#5e4632', '#3e2c1e');
};
GEN.muddy_mangrove_roots = (c) => { mudTex(c); rootStrands(c, '#6a5038', '#4a3424'); };
GEN.muddy_mangrove_roots_top = (c) => { mudTex(c); for (let k = 0; k < 6; k++) { const x = Math.floor(c.h(k, 0, 8) * 14) + 1, y = Math.floor(c.h(k, 1, 8) * 14) + 1; c.set(x, y, hex('#6a5038')); c.set(x + 1, y, hex('#4a3424')); } };
GEN.mangrove_propagule = (c) => {
  // planted: a green pod standing in the mud with two small leaves at its top
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
  for (let y = 6; y < 16; y++) { c.set(7, y, shade(hex('#6a8a2a'), 0.85 + c.h(7, y) * 0.3)); c.set(8, y, shade(hex('#4e6e20'), 0.9 + c.h(8, y) * 0.2)); }
  for (const [x, y] of [[5, 4], [6, 4], [6, 5], [4, 3], [9, 4], [10, 4], [9, 5], [11, 3], [7, 5], [8, 5]]) c.set(x, y, hex('#5a9a34'));
};
GEN.mangrove_propagule_hanging = (c) => {
  // hanging: a brown cap at the top, a long pod tapering to a point
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
  for (let x = 6; x <= 9; x++) for (let y = 0; y < 3; y++) c.set(x, y, shade(hex('#6a4a2a'), 0.85 + c.h(x, y) * 0.3));
  for (let y = 3; y < 14; y++) { c.set(7, y, shade(hex('#7a9a34'), 0.85 + c.h(7, y) * 0.3)); c.set(8, y, shade(hex('#5a7a26'), 0.9 + c.h(8, y) * 0.2)); }
  c.set(7, 14, hex('#5a7a26'));
};

/** Pixel data for all layers: Uint8Array(16*16*4*N) */
export function generateTextureData() {
  const n = TEX_NAMES.length;
  const out = new Uint8Array(TEX_SIZE * TEX_SIZE * 4 * n);
  TEX_NAMES.forEach((name, i) => {
    const c = new Canvas16(name);
    paint(c, name);
    out.set(c.data, i * 256 * 4);
  });
  return out;
}

export function texturePixels(name) {
  const c = new Canvas16(name);
  paint(c, name);
  return c.data;
}

// Biome tint helpers (shared with generator): continuous grass/foliage colours.
export function grassColor(temp, humid) {
  const t = Math.max(0, Math.min(1, temp)), h = Math.max(0, Math.min(1, humid)) * t;
  const dry = [191, 183, 85], lush = [71, 205, 51], cold = [128, 180, 151];
  const a = mix(dry, lush, h);
  return mix(cold, a, Math.min(1, t * 1.4));
}
export function foliageColor(temp, humid) {
  const t = Math.max(0, Math.min(1, temp)), h = Math.max(0, Math.min(1, humid)) * t;
  const dry = [174, 164, 42], lush = [48, 160, 30], cold = [96, 161, 123];
  return mix(cold, mix(dry, lush, h), Math.min(1, t * 1.4));
}
