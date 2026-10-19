// Procedural 16x16 pixel art for every block face. All art is generated at
// runtime from seeded noise and hand-picked palettes; no external images.
import { BLOCKS, B } from './blocks.js';
import { mulberry32, hash4 } from './noise.js';

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
}
addTex('furnace_side');
addTex('water_flow');
addTex('lava_flow');
for (let i = 0; i < 10; i++) addTex('destroy_' + i);

export function texId(name) { return texIndex.get(name); }

// Face order: +x, -x, +y, -y, +z, -z
export const FACE_TILE = new Uint16Array(256 * 6);
for (const b of BLOCKS) {
  if (!b) continue;
  const t = b.tex;
  const s = addTex(t.side), top = addTex(t.top), bot = addTex(t.bottom);
  FACE_TILE.set([s, s, top, bot, s, s], b.id * 6);
}
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

function leavesTex(c, density = 0.78) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = c.h(x, y);
    if (n > density) { c.set(x, y, [0, 0, 0], 0); continue; }
    const f = 0.62 + c.h(x >> 1, y >> 1, 3) * 0.38;
    c.set(x, y, shade([250, 250, 250], f));
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
  tuff: (c) => c.noiseFill(['#5f6159', '#6c6e64', '#575951', '#787a6f'].map(hex), 0.5),
  dirt: (c) => c.noiseFill(P.dirt, 0.4),
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
  torch: (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    for (let y = 6; y < 16; y++) { c.set(7, y, hex('#7a5a32')); c.set(8, y, hex('#5f4526')); }
    c.set(7, 6, hex('#ffd85a')); c.set(8, 6, hex('#ffb02a')); c.set(7, 7, hex('#ff9a20')); c.set(8, 7, hex('#ffe680'));
  },
  obsidian: (c) => c.noiseFill(['#140f1f', '#1d1530', '#0c0814', '#2c2045', '#3a2a5a'].map(hex), 0.4),
  wool: (c) => c.noiseFill(['#e9ecec', '#dfe3e3', '#f4f6f6', '#d4d8d8'].map(hex), 0.5),
  coal_block: (c) => c.noiseFill(['#1a1a1a', '#242424', '#121212', '#2e2e2e'].map(hex), 0.2),
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

function paint(c, name) {
  if (name.startsWith('destroy_')) destroyStage(c, +name.slice(8));
  else if (GEN[name]) GEN[name](c);
  else c.noiseFill(P.stone);
}

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
