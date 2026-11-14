// Procedural textures of the Glazed Tiles (world/blocks.js, COLOR_BLOCKS.glazed): one 16x16 tile per dye colour.
// Every tile is symmetric under mirroring and quarter turns, so the top face can be turned by the facing without a seam.
// Four motifs, picked by colour index, keep the colours from looking alike. Merged into textures.js like the other texture
// modules; each painter gets (canvas, { hex, mix, shade }).
import { COLORS } from './colors.js';

const toHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// Each motif returns its ink: 0 = the dye, 1 = a lighter mix of it, 2 = white, 3 = the dark outline.
// ax / ay are the distances to the nearest edge (0 on the border, 7 in the middle), so the shapes repeat around the centre.
const MOTIFS = [
  // a quarter-circle fan in every corner, with a white boss in the corner
  (x, y, ax, ay) => {
    const d = Math.hypot(ax + 0.5, ay + 0.5);
    if (d < 1.6) return 2;
    if (d < 4.6) return 1;
    if (d < 5.6) return 3;
    return 0;
  },
  // a solid diamond in the centre with a white heart
  (x, y) => {
    const m = Math.abs(x - 7.5) + Math.abs(y - 7.5);
    if (m < 1.6) return 2;
    if (m < 5) return 1;
    if (m < 6) return 3;
    return 0;
  },
  // square rings, outlined and lit in turn
  (x, y, ax, ay) => {
    const r = Math.max(ax, ay) % 4;
    if (r === 2) return 3;
    if (r === 3) return 1;
    return 0;
  },
  // bands of diamonds: white, light, outline and dye in turn
  (x, y) => {
    const m = (Math.abs(x - 7.5) + Math.abs(y - 7.5)) % 4;
    if (m === 1) return 2;
    if (m === 2) return 1;
    if (m === 3) return 3;
    return 0;
  },
];

const painterFor = (index) => {
  const [, , rgb] = COLORS[index];
  const motif = MOTIFS[index % MOTIFS.length];
  return (c, { hex, mix, shade }) => {
    const dye = hex(toHex(rgb));
    const light = mix(dye, hex('#ffffff'), 0.45);
    const white = hex('#f4f4f0');
    const dark = shade(dye, 0.4);
    const inks = [dye, light, white, dark];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const ax = Math.min(x, 15 - x), ay = Math.min(y, 15 - y);
      const ink = ax === 0 || ay === 0 ? 3 : motif(x, y, ax, ay);
      // a faint glaze mottling on the coloured inks, none on the white
      const n = ink === 2 ? 1 : 0.95 + c.h(x >> 1, y >> 1, 90 + index) * 0.1;
      c.set(x, y, shade(inks[ink], n));
    }
  };
};

// one painter per dye colour, named like the block's texture: white_glazed_tiles, light_blue_glazed_tiles, ...
export const GLAZED_TEX = Object.fromEntries(COLORS.map(([key], i) => [key + '_glazed_tiles', painterFor(i)]));
