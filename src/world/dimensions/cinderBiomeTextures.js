// Procedural textures of the Cinderdeep sub-biomes (Glowcap Thicket, Slagfall Delta, Dirgevale) and the
// Hollow's Wyrmbone. Merged into DIM_TEX (dimTextures.js); called from textures.js paint() with the shared
// 16x16 canvas and the colour helpers.
export const CINDER_BIOME_TEX = {
  // dark, damp soil threaded with pale spore mats
  spore_loam: (c, { hex }) => {
    c.noiseFill(['#2e2a26', '#37322c', '#27231f', '#403a33', '#2c2824'].map(hex), 0.4);
    for (let k = 0; k < 9; k++) {
      const x = Math.floor(c.rng() * 15), y = Math.floor(c.rng() * 15);
      c.set(x, y, hex('#5ac8aa')); if (c.rng() < 0.5) c.set(x + 1, y, hex('#3a9a82'));
    }
  },
  // pale, ringed fungus stalk
  glowcap_stalk: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const stripe = (x % 4 === 0) ? 0.82 : 1;
      c.set(x, y, shade(hex('#d9d2b8'), stripe * (0.9 + c.h(x, y) * 0.16)));
    }
    for (const y of [3, 9, 14]) for (let x = 0; x < 16; x++) c.set(x, y, hex('#a89f84'));
  },
  glowcap_stalk_top: (c, { hex }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      c.set(x, y, r < 3 ? hex('#b8ae90') : r < 6 ? hex('#cfc7ac') : hex('#e6dfc8'));
    }
  },
  // luminous teal cap, freckled with brighter spots
  glowcap_cap: (c, { hex, mix }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, mix(hex('#1f9c86'), hex('#58e8c4'), c.h(x >> 1, y >> 1) * 0.7 + c.h(x, y) * 0.3));
    for (let k = 0; k < 5; k++) {
      const x = 1 + Math.floor(c.rng() * 12), y = 1 + Math.floor(c.rng() * 12);
      c.set(x, y, hex('#d8fff0')); c.set(x + 1, y, hex('#a8f8e0')); c.set(x, y + 1, hex('#a8f8e0'));
    }
  },
  // black-brown volcanic rock with fine hexagonal cracks
  slagstone: (c, { hex }) => {
    c.noiseFill(['#2b2a2e', '#323036', '#242327', '#3a383e', '#28272b'].map(hex), 0.5);
    for (let x = 0; x < 16; x += 5) for (let y = 0; y < 16; y++) if (c.rng() < 0.7) c.set(x + (y & 1), y, hex('#161518'));
    for (let k = 0; k < 6; k++) c.set(Math.floor(c.rng() * 16), Math.floor(c.rng() * 16), hex('#6a4a3a'));
  },
  slag_ore: (c, { hex }) => {
    CINDER_BIOME_TEX.slagstone(c, { hex });
    for (let k = 0; k < 5; k++) {
      const x = 1 + Math.floor(c.rng() * 12), y = 1 + Math.floor(c.rng() * 12);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) c.set(x + dx, y + dy, (dx + dy) % 2 ? hex('#ff9a2a') : hex('#d4561a'));
      c.set(x, y, hex('#ffd070'));
    }
  },
  // cold blue-grey stone, streaked like a lament
  dirge_stone: (c, { hex }) => {
    c.noiseFill(['#4a5468', '#525c72', '#424b5c', '#5a647a', '#464f62'].map(hex), 0.45);
    for (let x = 1; x < 16; x += 4) for (let y = 0; y < 16; y++) if (c.rng() < 0.5) c.set(x, y, hex('#343c4c'));
  },
  dirge_crystal_ore: (c, { hex }) => {
    CINDER_BIOME_TEX.dirge_stone(c, { hex });
    for (let k = 0; k < 6; k++) {
      const x = 1 + Math.floor(c.rng() * 13), y = 1 + Math.floor(c.rng() * 12);
      for (let j = 0; j < 3; j++) c.set(x, y + j, j === 1 ? hex('#e8f8ff') : hex('#7ac8f0'));
      c.set(x + 1, y + 1, hex('#4a8ad0'));
    }
  },
  // vertebra-like pillar of grey bone
  wraithbone: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const knob = (y % 8 < 2) ? 1.12 : 1;
      c.set(x, y, shade(hex('#cfd4d8'), knob * (0.88 + c.h(x, y) * 0.18)));
    }
    for (const y of [2, 10]) for (let x = 0; x < 16; x++) c.set(x, y, hex('#8a9096'));
  },
  wraithbone_top: (c, { hex }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      c.set(x, y, r < 2.5 ? hex('#5a6066') : r < 6.5 ? hex('#c0c6ca') : hex('#9aa0a6'));
    }
  },
  // a spore-filled glass lantern in a dark frame
  spore_lantern: (c, { hex, mix }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x < 2 || y < 2 || x > 13 || y > 13 || x === 7 || x === 8;
      c.set(x, y, edge ? hex('#2a2622') : mix(hex('#3fd8b0'), hex('#d8fff0'), c.h(x >> 1, y >> 1) * 0.8));
    }
    for (let k = 0; k < 6; k++) c.set(2 + Math.floor(c.rng() * 12), 2 + Math.floor(c.rng() * 12), hex('#ffffff'));
  },
  // bleached, ridged bone of the Void Wyrm
  wyrmbone: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const ridge = (x % 5 === 0) ? 0.86 : 1;
      c.set(x, y, shade(hex('#e4dff0'), ridge * (0.9 + c.h(x, y) * 0.14)));
    }
    for (let k = 0; k < 6; k++) c.set(Math.floor(c.rng() * 16), Math.floor(c.rng() * 16), hex('#a89cc4'));
  },
  wyrmbone_top: (c, { hex }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      c.set(x, y, r < 3 ? hex('#8a7eaa') : r < 6.5 ? hex('#d8d2e8') : hex('#b8b0d0'));
    }
  },
};
