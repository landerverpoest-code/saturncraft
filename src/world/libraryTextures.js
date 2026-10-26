// Procedural textures of the Lectern, the Target block, the Cake and the sixteen
// dyed Gloomshell Boxes. Merged into textures.js like the other texture modules;
// each painter gets (canvas, { hex, mix, shade, planks }).
import { COLORS } from './colors.js';

export const LIBRARY_TEX = {
  // Lectern: oak boards with a darker trim; the desk top has a raised lip at the bottom edge
  lectern_side: (c, h) => {
    h.planks(c, '#a7834e');
    for (let i = 0; i < 16; i++) { c.set(i, 0, h.hex('#6e4a26')); c.set(i, 15, h.hex('#6e4a26')); }
  },
  lectern_top: (c, h) => {
    h.planks(c, '#b08c58');
    for (let i = 0; i < 16; i++) { c.set(i, 15, h.hex('#6e4a26')); c.set(i, 14, h.hex('#8a6034')); c.set(0, i, h.hex('#6e4a26')); c.set(15, i, h.hex('#6e4a26')); }
  },
  lectern_base: (c, h) => {
    h.planks(c, '#94703e');
    for (let i = 0; i < 16; i++) { c.set(i, 0, h.hex('#5e3e1e')); c.set(i, 15, h.hex('#5e3e1e')); c.set(0, i, h.hex('#5e3e1e')); c.set(15, i, h.hex('#5e3e1e')); }
  },
  lectern_post: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const groove = x % 4 === 0;
      c.set(x, y, groove ? hex('#6e4a26') : shade(hex('#a07a45'), 0.88 + c.h(x, y >> 2) * 0.16));
    }
  },
  // the open book: two pages with lines of writing and a spine down the middle
  lectern_book: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = y === 0 || y === 15 || x === 0 || x === 15, spine = x === 7 || x === 8;
      const line = !edge && !spine && y > 2 && y < 14 && y % 2 === 1 && x > 1 && x < 14 && c.h(x >> 1, y, 5) > 0.25;
      c.set(x, y, edge ? hex('#6a3a20') : spine ? hex('#c8b898') : line ? hex('#5a5048') : shade(hex('#f0e8d4'), 0.95 + c.h(x, y) * 0.05));
    }
  },
  lectern_book_side: (c, { hex }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, y % 3 === 0 ? hex('#d8ccb0') : hex('#f0e8d4'));
  },
  // Target: red and white rings on straw
  target_top: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const red = r < 1.5 || (r >= 3.5 && r < 5.5);
      c.set(x, y, shade(hex(red ? '#c8302a' : '#ece4d2'), 0.92 + c.h(x, y) * 0.1));
    }
  },
  target_side: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const red = r < 1.5 || (r >= 3.5 && r < 5.5), straw = r >= 6.5;
      c.set(x, y, straw ? shade(hex('#c8a84a'), 0.82 + c.h(x, y >> 1, 9) * 0.25) : shade(hex(red ? '#c8302a' : '#ece4d2'), 0.92 + c.h(x, y) * 0.1));
    }
  },
  // Cake: white icing with red berries on a sponge, a drip of icing down the sides
  cake_top: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#f4f0ec'), 0.94 + c.h(x, y) * 0.06));
    for (const [x, y] of [[3, 4], [8, 3], [12, 6], [5, 10], [10, 11], [7, 7]]) c.set(x, y, hex('#d0283a'));
  },
  cake_side: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const icing = y < 4 + (x % 5 === 2 ? 2 : 0), jam = y === 9;
      c.set(x, y, icing ? shade(hex('#f4f0ec'), 0.95 + c.h(x, y) * 0.05) : jam ? hex('#c03040') : shade(hex('#c8884a'), 0.88 + c.h(x, y, 4) * 0.16));
    }
  },
  cake_inner: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const icing = y < 3, jam = y === 9;
      c.set(x, y, icing ? hex('#f4f0ec') : jam ? hex('#c03040') : shade(hex('#e0b070'), 0.86 + c.h(x, y, 6) * 0.2));
    }
  },
  cake_bottom: (c, { hex, shade }) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#b07840'), 0.9 + c.h(x, y) * 0.1)); },
};

// dyed Gloomshell Boxes: the shell's plates and lid band in each dye colour
for (const [key, , rgb] of COLORS) {
  const tone = (f) => [rgb[0] * f, rgb[1] * f, rgb[2] * f].map((v) => Math.max(0, Math.min(255, v)));
  const lift = (f) => rgb.map((v) => Math.min(255, v + (255 - v) * f));
  LIBRARY_TEX[key + '_gloomshell_box_side'] = (c, { shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = y === 6 || y === 7, edge = x === 0 || x === 15 || y === 0 || y === 15;
      const v = 0.9 + c.h(x >> 1, y >> 1) * 0.16;
      c.set(x, y, band ? tone(0.45) : edge ? tone(0.7) : shade(y < 6 ? tone(1) : tone(0.88), v));
    }
  };
  LIBRARY_TEX[key + '_gloomshell_box_top'] = (c, { shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || x === 15 || y === 0 || y === 15, r = Math.hypot(x - 7.5, y - 7.5);
      c.set(x, y, edge ? tone(0.7) : r < 3 ? lift(0.3) : shade(tone(1), 0.9 + c.h(x, y) * 0.14));
    }
  };
}
