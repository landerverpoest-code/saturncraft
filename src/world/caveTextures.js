// Procedural pixel art for the caves content (copper, Violite geodes, Seepstone).
// Each entry paints a 16x16 canvas; `h` = { hex, mix, shade } (see world/textures.js).

const clear = (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0); };

// Copper plates: four riveted panels whose patina spreads with the stage
const COPPER = [
  { base: '#d47a4c', hi: '#f0a070', lo: '#a85a36', patina: 0 },
  { base: '#b88466', hi: '#d4a084', lo: '#8a6048', patina: 0.25 },
  { base: '#7c9a78', hi: '#9cbc94', lo: '#5a7a5c', patina: 0.6 },
  { base: '#4fa88e', hi: '#72c8aa', lo: '#3a8670', patina: 1 },
];
function copper(c, h, stage) {
  const s = COPPER[stage], base = h.hex(s.base), hi = h.hex(s.hi), lo = h.hex(s.lo);
  const green = h.hex('#52b394'), greenLo = h.hex('#3a8e74');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const px = x & 7, py = y & 7;
    let col = base;
    if (px === 0 || py === 0) col = h.shade(lo, 0.9);
    else if (px === 1 || py === 1) col = hi;
    else if (px === 7 || py === 7) col = lo;
    col = h.shade(col, 0.93 + c.h(x, y) * 0.12);
    // patina blotches: big soft patches plus speckles
    const n = c.h(x >> 2, y >> 2, 5) * 0.55 + c.h(x >> 1, y >> 1, 6) * 0.3 + c.h(x, y, 7) * 0.15;
    if (s.patina && n < s.patina * 0.85) col = h.mix(col, c.h(x, y, 8) < 0.5 ? green : greenLo, stage === 3 ? 0.55 : 0.75);
    c.set(x, y, col);
  }
  if (stage < 3) for (const [x, y] of [[3, 3], [11, 3], [3, 11], [11, 11]]) c.set(x, y, h.shade(lo, 0.8));
}

// Storm Rod: copper sprite (pixels outside the rod keep its colour but are transparent,
// so the boxes it is drawn with stay solid copper while the item icon shows the rod)
function stormRod(c, h) {
  const body = h.hex('#d47a4c'), hi = h.hex('#f2a676'), lo = h.hex('#9a5232');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const knob = y < 4 && x >= 6 && x <= 9, rod = y >= 4 && (x === 7 || x === 8);
    const col = x <= 6 || (y < 4 && x === 7) ? hi : x >= 9 || (y >= 4 && x === 8) ? lo : body;
    c.set(x, y, h.shade(col, 0.95 + c.h(x, y) * 0.1), knob || rod ? 255 : 0);
  }
}

function violite(c, h, budding) {
  const pal = ['#7a4cc0', '#9466dc', '#6a3eaa', '#b48af0', '#5a3298'].map(h.hex);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    // facets: bands along both diagonals
    const f = (Math.floor((x + y + c.h(x >> 2, y >> 2, 3) * 4) / 4) + Math.floor((x - y + 16) / 5)) % pal.length;
    let col = h.shade(pal[f], 0.92 + c.h(x, y) * 0.16);
    if ((x + 2 * y) % 9 === 0 && c.h(x, y, 2) < 0.5) col = h.hex('#d8c0ff');
    c.set(x, y, col);
  }
  if (budding) {
    for (let k = 0; k < 7; k++) {
      const x = 1 + Math.floor(c.rng() * 14), y = 1 + Math.floor(c.rng() * 14);
      c.set(x, y, h.hex('#3a1e66')); c.set(x + 1, y, h.hex('#e8d4ff')); c.set(x, y - 1, h.hex('#c8a4ff'));
    }
  }
}

/** Upward crystal shards standing on the bottom row: [centre x, height, half width at the base]. */
function shards(c, h, list) {
  clear(c);
  const lo = h.hex('#6a3eaa'), mid = h.hex('#9a6ae0'), hi = h.hex('#d4b8ff');
  for (const [cx, ht, hw] of list) {
    for (let k = 0; k < ht; k++) {
      const y = 15 - k, w = Math.max(0, Math.round(hw * (1 - k / ht)));
      for (let x = cx - w; x <= cx + w; x++) c.set(x, y, x < cx ? hi : x === cx ? mid : lo);
    }
  }
}

const SEEP = ['#b09070', '#c2a482', '#9c7e60', '#cdb293', '#856a50'];
function spike(c, h, wBottom, wTop) {
  clear(c);
  const pal = SEEP.map(h.hex);
  for (let y = 0; y < 16; y++) {
    const t = y / 15, half = (wTop + (wBottom - wTop) * t) / 2;
    for (let x = 0; x < 16; x++) {
      const d = Math.abs(x + 0.5 - 8);
      if (d > half) continue;
      const band = pal[(Math.floor(x / 2) + (y >> 3)) % pal.length];
      c.set(x, y, h.shade(band, (x < 8 ? 1.08 : 0.9) * (0.94 + c.h(x, y) * 0.12)));
    }
  }
}

export const CAVE_TEX = {
  copper_block: (c, h) => copper(c, h, 0),
  dulled_copper: (c, h) => copper(c, h, 1),
  tarnished_copper: (c, h) => copper(c, h, 2),
  verdigris_copper: (c, h) => copper(c, h, 3),
  storm_rod: stormRod,
  violite_block: (c, h) => violite(c, h, false),
  budding_violite: (c, h) => violite(c, h, true),
  small_violite_bud: (c, h) => shards(c, h, [[8, 3, 1]]),
  medium_violite_bud: (c, h) => shards(c, h, [[7, 4, 1], [10, 3, 1]]),
  large_violite_bud: (c, h) => shards(c, h, [[8, 5, 2], [5, 3, 1], [11, 4, 1]]),
  violite_cluster: (c, h) => shards(c, h, [[8, 9, 2], [4, 6, 1], [12, 7, 1], [6, 4, 1], [10, 5, 1]]),
  chalkstone: (c) => c.noiseFill([[228, 226, 218], [216, 214, 206], [239, 238, 232], [207, 205, 196], [222, 220, 210]], 0.35),
  smooth_basalt: (c) => c.noiseFill([[74, 74, 80], [83, 83, 89], [67, 67, 74], [90, 90, 96]], 0.15),
  shaded_glass: (c, h) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      c.set(x, y, edge ? h.hex('#5a4672') : h.shade(h.hex('#2e2440'), 0.9 + c.h(x, y) * 0.2), edge ? 235 : 200);
    }
    for (let k = 0; k < 4; k++) c.set(3 + k, 6 - k, h.hex('#6e5a88'), 220);
  },
  seepstone: (c, h) => {
    // tan rock with soft horizontal bands and darker vertical drip streaks
    const pal = SEEP.map(h.hex);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = Math.floor((y + Math.sin(x * 0.7 + c.h(0, y, 4) * 3) * 1.2) / 3);
      let col = h.shade(pal[((band % 4) + 4) % 4], 0.94 + c.h(x, y) * 0.1);
      if (c.h(x, 0, 9) < 0.3 && c.h(x, y >> 2, 10) < 0.7) col = h.shade(col, 0.82);
      c.set(x, y, col);
    }
  },
  // spikes by thickness (row 15 = the end fixed to the block, row 0 = towards the point)
  seepstone_spike_0: (c, h) => spike(c, h, 8, 0.6),
  seepstone_spike_1: (c, h) => spike(c, h, 10, 7),
  seepstone_spike_2: (c, h) => spike(c, h, 11, 10),
  seepstone_spike_3: (c, h) => spike(c, h, 14, 11),
};
