// Procedural textures of the Loom, the Fletching Table, the Cartography Desk, the Masonry Bench, the Whetstone Stand and the
// Armorer's Rack (job-site blocks, see
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
  // Cartography Desk: dark spruce boards; the top holds a sheet of parchment with a compass rose and a dotted route
  cartography_desk_top: (c, { hex, shade, planks }) => {
    planks(c, '#6e5232');
    frame(c, hex, '#3e2c18');
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) c.set(x, y, shade(hex('#e6d8a8'), 0.93 + c.h(x, y) * 0.1));
    for (let i = -4; i <= 4; i++) { c.set(8 + i, 8, hex('#7a3a2a')); c.set(8, 8 + i, hex('#7a3a2a')); } // the rose: north-south and east-west
    c.set(8, 3, hex('#b02828')); c.set(8, 4, hex('#b02828')); // its north point
    for (const [x, y] of [[3, 12], [4, 11], [5, 12], [6, 11], [10, 4], [11, 5], [12, 4]]) c.set(x, y, hex('#3a4a8a')); // a dotted route
    c.set(12, 12, hex('#b02828')); c.set(11, 11, hex('#b02828')); c.set(13, 11, hex('#b02828')); c.set(11, 13, hex('#b02828')); c.set(13, 13, hex('#b02828')); // and a cross
  },
  cartography_desk_side: (c, { hex, shade, planks }) => {
    planks(c, '#6e5232');
    for (let x = 0; x < 16; x++) { c.set(x, 0, hex('#3e2c18')); c.set(x, 1, hex('#5a4226')); }
    for (let y = 0; y < 16; y++) { c.set(0, y, shade(hex('#3e2c18'), 1)); c.set(15, y, shade(hex('#3e2c18'), 1)); }
  },
  // the front: a pigeonhole shelf of rolled charts tied with coloured cord, over a drawer
  cartography_desk_front: (c, { hex, shade, planks }) => {
    JOBSITE_TEX.cartography_desk_side(c, { hex, shade, planks });
    for (let x = 2; x < 14; x++) { c.set(x, 2, hex('#3e2c18')); c.set(x, 8, hex('#3e2c18')); }
    [['#e6d8a8', '#b02828'], ['#dccc98', '#3a4a8a'], ['#ece0b8', '#2a7a4a']].forEach(([paper, cord], k) => {
      const x0 = 3 + k * 4;
      for (let y = 3; y < 8; y++) for (let x = x0; x < x0 + 3; x++) c.set(x, y, shade(hex(paper), 0.9 + c.h(x, y) * 0.1));
      for (let x = x0; x < x0 + 3; x++) c.set(x, 5, hex(cord));
    });
    for (let y = 10; y < 14; y++) for (let x = 3; x < 13; x++) c.set(x, y, shade(hex('#7a5c38'), 0.95 + c.h(x, y) * 0.1));
    c.set(7, 12, hex('#d8c070')); c.set(8, 12, hex('#d8c070'));
  },
  // Masonry Bench: a stout spruce bench; the top holds a dressed block of stone, a mallet and a chisel
  masonry_bench_top: (c, { hex, shade, planks }) => {
    planks(c, '#6f4f2f');
    frame(c, hex, '#463018');
    for (let y = 3; y < 12; y++) for (let x = 3; x < 12; x++) c.set(x, y, shade(hex('#9a9a9a'), 0.88 + c.h(x, y) * 0.16)); // the stone
    for (let x = 3; x < 12; x++) { c.set(x, 3, hex('#c4c4c4')); c.set(x, 11, hex('#6e6e6e')); }
    for (let y = 3; y < 12; y++) { c.set(3, y, hex('#b0b0b0')); c.set(11, y, hex('#767676')); }
    for (const [x, y] of [[13, 3], [13, 4], [13, 5], [12, 6], [13, 6], [14, 6]]) c.set(x, y, hex('#3a3a40')); // the mallet head
    for (let y = 7; y < 13; y++) c.set(13, y, hex('#8a6a3a')); // its handle
    for (let k = 0; k < 4; k++) c.set(5 + k, 14, hex('#a8a8b0')); // the chisel
  },
  masonry_bench_side: (c, { hex, shade, planks }) => {
    planks(c, '#6f4f2f');
    for (let x = 0; x < 16; x++) { c.set(x, 0, hex('#463018')); c.set(x, 1, hex('#5a4026')); c.set(x, 15, shade(hex('#7a7a7a'), 0.95)); c.set(x, 14, shade(hex('#9a9a9a'), 0.95)); }
    for (let y = 0; y < 16; y++) { c.set(0, y, hex('#463018')); c.set(15, y, hex('#463018')); }
  },
  // the front: rough blocks and finished bricks stacked on a low shelf over a chisel rack
  masonry_bench_front: (c, { hex, shade, planks }) => {
    JOBSITE_TEX.masonry_bench_side(c, { hex, shade, planks });
    for (let x = 2; x < 14; x++) { c.set(x, 7, hex('#463018')); c.set(x, 8, hex('#5a4026')); }
    for (let row = 0; row < 3; row++) for (let k = 0; k < 3; k++) {
      const x0 = 2 + k * 4 + (row % 2 ? 2 : 0), y0 = 2 + row * 2;
      for (let x = x0; x < Math.min(x0 + 4, 14); x++) { c.set(x, y0, shade(hex('#a89a8a'), 1.05)); c.set(x, y0 + 1, shade(hex('#8a7c6c'), 0.9 + c.h(x, y0) * 0.1)); }
    }
    for (const x of [4, 7, 10]) { for (let y = 10; y < 13; y++) c.set(x, y, hex('#8a6a3a')); c.set(x, 13, hex('#a8a8b0')); c.set(x, 12, hex('#6e6e76')); }
  },
  // Whetstone Stand: dark oak uprights; the top holds a round grindstone disc with a ring of wet sheen
  whetstone_stand_top: (c, { hex, shade, planks }) => {
    planks(c, '#4f3720');
    frame(c, hex, '#2e2010');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 5.5) c.set(x, y, shade(hex(d < 1.6 ? '#3a3a40' : d > 4.3 ? '#8a8a92' : '#a8a8b0'), 0.92 + c.h(x, y) * 0.14));
    }
    for (let x = 6; x < 10; x++) c.set(x, 14, hex('#3a6aa0')); // a trough of water
  },
  whetstone_stand_side: (c, { hex, shade, planks }) => {
    planks(c, '#4f3720');
    for (let y = 0; y < 16; y++) for (const x of [0, 1, 14, 15]) c.set(x, y, shade(hex('#2e2010'), 0.95 + c.h(x, y) * 0.1));
    for (let x = 0; x < 16; x++) { c.set(x, 0, hex('#2e2010')); c.set(x, 1, hex('#3e2c18')); }
  },
  // the front: a pickaxe, an axe and a spade hung on pegs over the stone
  whetstone_stand_front: (c, { hex, shade, planks }) => {
    JOBSITE_TEX.whetstone_stand_side(c, { hex, shade, planks });
    for (const x of [4, 8, 12]) { for (let y = 4; y < 12; y++) c.set(x, y, hex('#8a6a3a')); c.set(x, 3, hex('#2e2010')); }
    for (let x = 2; x < 7; x++) c.set(x, 4, hex('#c4c4cc')); c.set(2, 5, hex('#c4c4cc')); c.set(6, 5, hex('#c4c4cc')); // the pickaxe head
    for (const [x, y] of [[8, 4], [9, 4], [9, 5], [10, 5], [9, 6], [10, 6], [8, 5]]) c.set(x, y, hex('#c4c4cc')); // the axe head
    for (let y = 4; y < 7; y++) { c.set(11, y, hex('#a8a8b0')); c.set(12, y, hex('#a8a8b0')); c.set(13, y, hex('#a8a8b0')); } // the spade blade
    for (let x = 2; x < 14; x++) c.set(x, 13, shade(hex('#6e6e76'), 1)); // the stone below
    for (let x = 3; x < 13; x++) c.set(x, 14, shade(hex('#8a8a92'), 0.9));
  },
  // Armorer's Rack: spruce frame; the top holds folded leather and a few iron rings
  armor_rack_top: (c, { hex, shade, planks }) => {
    planks(c, '#6f4f2f');
    frame(c, hex, '#463018');
    for (let y = 3; y < 13; y++) for (let x = 2; x < 10; x++) c.set(x, y, shade(hex('#8a4e2a'), 0.85 + c.h(x, y) * 0.2)); // a folded hide
    for (let x = 2; x < 10; x++) c.set(x, 8, hex('#6a3a1e'));
    for (const [cx, cy] of [[12, 4], [12, 10]]) for (let a = 0; a < 8; a++) c.set(cx + Math.round(Math.cos(a * 0.785) * 1.8), cy + Math.round(Math.sin(a * 0.785) * 1.8), hex('#b8b8c0')); // iron rings
  },
  armor_rack_side: (c, { hex, shade, planks }) => {
    planks(c, '#6f4f2f');
    for (let y = 0; y < 16; y++) for (const x of [0, 15]) c.set(x, y, shade(hex('#463018'), 0.95 + c.h(x, y) * 0.1));
    for (let x = 0; x < 16; x++) { c.set(x, 0, hex('#463018')); c.set(x, 15, hex('#463018')); }
    for (let x = 0; x < 16; x++) c.set(x, 8, hex('#5a4026'));
  },
  // the front: an iron helm above a breastplate on a wooden stand
  armor_rack_front: (c, { hex, shade, planks }) => {
    JOBSITE_TEX.armor_rack_side(c, { hex, shade, planks });
    for (let y = 2; y < 7; y++) for (let x = 5; x < 11; x++) c.set(x, y, shade(hex('#b8b8c0'), 0.88 + c.h(x, y) * 0.16)); // the helm
    for (let x = 6; x < 10; x++) c.set(x, 5, hex('#2a2a30')); // its visor slit
    for (let y = 9; y < 14; y++) for (let x = 4; x < 12; x++) c.set(x, y, shade(hex('#a8a8b0'), 0.88 + c.h(x, y) * 0.16)); // the breastplate
    for (let y = 9; y < 11; y++) { c.set(4, y, hex('#e4e4ea')); c.set(11, y, hex('#e4e4ea')); } c.set(7, 11, hex('#7a7a82')); c.set(8, 11, hex('#7a7a82'));
  },
};
