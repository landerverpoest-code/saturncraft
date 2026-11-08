// Procedural textures of content pack 6: Packed Ice (the floes and icebergs of the Frozen Deep, world/frozenDeep.js) and the
// Cartographer's Table (player/cartographer.js). Merged into textures.js like the other texture modules; each painter gets
// (canvas, { hex, mix, shade }).

export const PACK6_TEX = {
  // Packed Ice: dense pale-blue ice with faint white veins and a few bubbles
  packed_ice: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const vein = Math.abs(((x + y * 2 + Math.floor(c.h(0, 0, 91) * 8)) % 11) - 5) === 0 && c.h(x, y, 92) > 0.35;
      let col = shade(hex('#8fb6e8'), 0.9 + c.h(x >> 1, y >> 1, 93) * 0.22);
      if (vein) col = shade(hex('#d6e8fb'), 0.92 + c.h(x, y, 94) * 0.1);
      if (c.h(x, y, 95) > 0.96) col = hex('#e9f4ff');
      c.set(x, y, col);
    }
  },

  // Cartographer's Table: birch boards with a leather-edged sheet of parchment; the sheet shows contour lines and a hand-drawn coast
  cartographers_table_top: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#a8885a'), 0.9 + c.h(x, y, 96) * 0.16));
    for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
      const edge = x === 1 || x === 14 || y === 1 || y === 14;
      c.set(x, y, edge ? hex('#5a3a22') : shade(hex('#eadbb0'), 0.94 + c.h(x, y, 97) * 0.1));
    }
    // contour lines round a hill, and a wavy coast
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
      const d = Math.hypot(x - 6.5, y - 7.5);
      if (Math.abs(d - 2.2) < 0.45 || Math.abs(d - 4.1) < 0.4) c.set(x, y, hex('#8a6a3a'));
    }
    for (let x = 2; x < 14; x++) c.set(x, 11 + Math.round(Math.sin(x * 0.9) * 1.1), hex('#3a5a9a'));
    c.set(11, 4, hex('#b02828')); c.set(11, 5, hex('#b02828')); c.set(10, 5, hex('#b02828')); c.set(12, 5, hex('#b02828')); // an X marks the spot
  },
  cartographers_table_side: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const board = y >> 2, seam = y % 4 === 3;
      c.set(x, y, shade(hex(seam ? '#6e5430' : board & 1 ? '#c9a878' : '#d2b284'), 0.94 + c.h(x, y, 98) * 0.12));
    }
    for (let x = 0; x < 16; x++) { c.set(x, 0, hex('#5a3a22')); c.set(x, 1, hex('#7a5a36')); }
    for (let y = 0; y < 16; y++) { c.set(0, y, hex('#5a3a22')); c.set(15, y, hex('#5a3a22')); }
    // a rolled chart sticking out of a pigeonhole, tied with red cord
    for (let y = 6; y < 12; y++) for (let x = 5; x < 11; x++) c.set(x, y, hex('#3a2a18'));
    for (let x = 5; x < 12; x++) { c.set(x, 8, hex('#efe3bd')); c.set(x, 9, hex('#d8c892')); }
    c.set(8, 8, hex('#b02828')); c.set(8, 9, hex('#b02828'));
  },
};
