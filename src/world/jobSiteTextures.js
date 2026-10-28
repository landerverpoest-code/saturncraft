// Procedural textures of the Loom and the Fletching Table (job-site blocks, see
// mobs/jobSites.js). Merged into textures.js like the other texture modules;
// each painter gets (canvas, { hex, mix, shade, planks }).

const frame = (c, hex, col) => { for (let i = 0; i < 16; i++) { c.set(i, 0, hex(col)); c.set(i, 15, hex(col)); c.set(0, i, hex(col)); c.set(15, i, hex(col)); } };

export const JOBSITE_TEX = {
  // Loom: an oak bench; the top holds the warp (pale threads) with a band of woven red and blue cloth
  loom_top: (c, { hex, shade, planks }) => {
    planks(c, '#9c7646');
    frame(c, hex, '#5e4022');
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
      const woven = y >= 8 && y < 12;
      if (woven) c.set(x, y, shade(hex((x + y) % 2 ? '#b03a34' : '#3a5aa0'), 0.9 + c.h(x, y) * 0.15));
      else if (x % 2 === 0) c.set(x, y, shade(hex('#ece4d0'), 0.92 + c.h(x, y) * 0.08));
    }
    for (let x = 1; x < 15; x++) { c.set(x, 7, hex('#6e4a26')); c.set(x, 12, hex('#6e4a26')); } // the beater and the cloth beam
  },
  loom_bottom: (c, { hex, planks }) => { planks(c, '#8a6638'); frame(c, hex, '#5e4022'); },
  loom_side: (c, { hex, shade, planks }) => {
    planks(c, '#9c7646');
    for (let y = 0; y < 16; y++) for (const x of [0, 1, 14, 15]) c.set(x, y, shade(hex('#5e4022'), 0.9 + c.h(x, y) * 0.15)); // the posts
    for (let x = 0; x < 16; x++) { c.set(x, 0, hex('#5e4022')); c.set(x, 5, hex('#6e4a26')); }
  },
  // the front: threads stretched down the frame over a hanging length of cloth, a ball of yarn in the corner
  loom_front: (c, { hex, shade, planks }) => {
    planks(c, '#9c7646');
    for (let y = 0; y < 16; y++) for (const x of [0, 1, 14, 15]) c.set(x, y, shade(hex('#5e4022'), 0.9 + c.h(x, y) * 0.15));
    for (let x = 0; x < 16; x++) { c.set(x, 0, hex('#5e4022')); c.set(x, 1, hex('#6e4a26')); }
    for (let y = 2; y < 11; y++) for (let x = 3; x < 13; x += 2) c.set(x, y, shade(hex('#ece4d0'), 0.9 + c.h(x, y) * 0.1));
    for (let y = 6; y < 11; y++) for (let x = 3; x < 13; x++) c.set(x, y, shade(hex('#d8d0bc'), 0.85 + ((x + y) % 2) * 0.12));
    for (let x = 2; x < 14; x++) c.set(x, 11, hex('#6e4a26'));
    for (let y = 12; y < 15; y++) for (let x = 10; x < 13; x++) c.set(x, y, shade(hex('#c03a3a'), y === 12 || x === 10 ? 1.1 : 0.85));
  },
  // Fletching Table: pale birch boards; the top has feathers and a flint head laid out on a grid of guide lines
  fletching_table_top: (c, { hex, shade, planks }) => {
    planks(c, '#d6c494');
    frame(c, hex, '#9a8458');
    for (let i = 1; i < 15; i++) { c.set(i, 5, shade(hex('#b8a474'), 1)); c.set(i, 10, shade(hex('#b8a474'), 1)); c.set(5, i, shade(hex('#b8a474'), 1)); c.set(10, i, shade(hex('#b8a474'), 1)); }
    for (let k = 2; k < 13; k++) c.set(k, 14 - k, hex('#6e4a26')); // an arrow shaft across the top
    for (const [x, y] of [[12, 2], [13, 2], [13, 3], [11, 2], [13, 1]]) c.set(x, y, hex('#3a3a40')); // its flint head
    for (const [x, y] of [[2, 11], [3, 12], [1, 12], [2, 13], [3, 11], [1, 11]]) c.set(x, y, hex('#f4f0e8')); // the fletching
  },
  fletching_table_side: (c, { hex, shade, planks }) => {
    planks(c, '#d6c494');
    for (let x = 0; x < 16; x++) { c.set(x, 0, hex('#9a8458')); c.set(x, 1, hex('#b8a474')); }
    for (let y = 0; y < 16; y++) { c.set(0, y, shade(hex('#7a5a34'), 0.95)); c.set(15, y, shade(hex('#7a5a34'), 0.95)); }
  },
  // the front: a rack of arrows and a bundle of feathers hung on two pegs
  fletching_table_front: (c, { hex, shade, planks }) => {
    JOBSITE_TEX.fletching_table_side(c, { hex, shade, planks });
    for (const x of [4, 7, 10]) {
      for (let y = 4; y < 14; y++) c.set(x, y, hex('#6e4a26'));
      c.set(x, 3, hex('#3a3a40')); c.set(x, 2, hex('#55555c'));
      c.set(x - 1, 12, hex('#f4f0e8')); c.set(x + 1, 12, hex('#f4f0e8')); c.set(x - 1, 13, hex('#e0dcd0')); c.set(x + 1, 13, hex('#e0dcd0'));
    }
    for (let x = 2; x < 14; x++) c.set(x, 8, shade(hex('#7a5a34'), 1));
  },
};
