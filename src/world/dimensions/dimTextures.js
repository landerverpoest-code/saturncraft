// Procedural block textures for the Cinderdeep and the Hollow. Called from
// textures.js paint() with the shared 16x16 canvas and colour helpers.
import { HOLLOW_TEX } from './hollowTextures.js';

/**
 * @param {object} c   Canvas16 (set, get, h, rng, noiseFill)
 * @param {{hex: Function, mix: Function, shade: Function}} u colour helpers
 */
export const DIM_TEX = {
  // soft, porous red stone
  cinderstone: (c, { hex, mix }) => {
    const pal = ['#6e1e1e', '#7d2422', '#5c1717', '#8a2c27', '#682020'].map(hex);
    c.noiseFill(pal, 0.55);
    for (let k = 0; k < 14; k++) {
      const x = Math.floor(c.rng() * 16), y = Math.floor(c.rng() * 16);
      c.set(x, y, hex('#3e0e10'));
      if (c.rng() < 0.5) c.set(x + 1, y, mix(hex('#3e0e10'), pal[0], 0.5));
    }
  },
  // glowing yellow-white crystal cluster
  glowshard: (c, { hex, mix }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = c.h(x >> 1, y >> 1) * 0.65 + c.h(x, y) * 0.35;
      c.set(x, y, mix(hex('#b8741e'), hex('#fff0a0'), n));
    }
    for (let k = 0; k < 6; k++) {
      const x = Math.floor(c.rng() * 14), y = Math.floor(c.rng() * 14);
      c.set(x, y, hex('#ffffff')); c.set(x + 1, y + 1, hex('#fff8d0'));
    }
  },
  // dark sand with faint face-like hollows
  mournsand: (c, { hex }) => {
    c.noiseFill(['#4a3628', '#55402f', '#3e2c20', '#5e4836', '#463224'].map(hex), 0.35);
    for (let k = 0; k < 3; k++) {
      const x = 2 + Math.floor(c.rng() * 11), y = 2 + Math.floor(c.rng() * 10);
      c.set(x, y, hex('#22160e')); c.set(x + 2, y, hex('#22160e'));
      c.set(x, y + 2, hex('#2a1c12')); c.set(x + 1, y + 2, hex('#22160e')); c.set(x + 2, y + 2, hex('#2a1c12'));
    }
  },
  emberquartz_ore: (c, { hex }) => {
    DIM_TEX.cinderstone(c, { hex, mix: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] });
    for (let k = 0; k < 6; k++) {
      const x = 1 + Math.floor(c.rng() * 13), y = 1 + Math.floor(c.rng() * 13);
      const horiz = c.rng() < 0.5;
      for (let j = 0; j < 3; j++) c.set(x + (horiz ? j : 0), y + (horiz ? 0 : j), j === 1 ? hex('#fff6ee') : hex('#e6cfc0'));
    }
  },
  scorched_bricks: (c, { hex, shade }) => {
    const mortar = hex('#1c0a0c');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const row = y >> 2, off = row & 1 ? 4 : 0;
      if ((y & 3) === 3 || ((x + off) & 7) === 7) { c.set(x, y, mortar); continue; }
      const v = 0.8 + c.h(x, y) * 0.3;
      c.set(x, y, shade(hex('#3c1418'), v));
    }
  },
  // swirling violet portal sheet (semi-transparent; scrolls in the water material)
  rift: (c, { hex, mix }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const a = Math.atan2(y - 7.5, x - 7.5), r = Math.hypot(x - 7.5, y - 7.5);
      const swirl = 0.5 + 0.5 * Math.sin(a * 3 + r * 0.9);
      const n = swirl * 0.7 + c.h(x, y) * 0.3;
      c.set(x, y, mix(hex('#3a0a7a'), hex('#c070ff'), n), 150 + Math.floor(n * 70));
    }
  },
  // pale yellow-white stone of the Hollow
  hollowstone: (c, { hex }) => {
    c.noiseFill(['#dcd9a8', '#e6e3b6', '#cfcb98', '#eeebc4', '#c8c48e'].map(hex), 0.45);
    for (let k = 0; k < 10; k++) c.set(Math.floor(c.rng() * 16), Math.floor(c.rng() * 16), hex('#b8b47e'));
  },
  hollow_frame_side: (c, { hex }) => {
    DIM_TEX.hollowstone(c, { hex });
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) c.set(x, y, (x + y) & 1 ? hex('#2e6a5e') : hex('#3c8070'));
    for (let x = 2; x < 14; x += 4) { c.set(x, 4, hex('#1e4a40')); c.set(x + 1, 4, hex('#1e4a40')); }
  },
  hollow_frame_top: (c, { hex }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x < 2 || y < 2 || x > 13 || y > 13;
      c.set(x, y, edge ? ((x + y) & 1 ? hex('#2e6a5e') : hex('#3c8070')) : hex('#1a3a34'));
    }
    for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) c.set(x, y, hex('#0e201c'));
  },
  hollow_frame_eye: (c, { hex }) => {
    DIM_TEX.hollow_frame_top(c, { hex });
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      if (r < 4) c.set(x, y, r < 1.6 ? hex('#0a1a10') : r < 2.6 ? hex('#7ae06a') : hex('#2a9a7a'));
    }
  },
  // black void sprinkled with stars
  hollow_gate: (c, { hex, mix }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = c.h(x >> 2, y >> 2, 3) * 0.6 + c.h(x, y, 4) * 0.4;
      c.set(x, y, mix(hex('#04030a'), hex('#1a1040'), n * n));
    }
    for (let k = 0; k < 9; k++) {
      const x = Math.floor(c.rng() * 16), y = Math.floor(c.rng() * 16);
      c.set(x, y, k % 3 ? hex('#c8f0ff') : hex('#7affd0'));
    }
  },
  wyrm_egg: (c, { hex }) => {
    c.noiseFill(['#120a1c', '#1c1030', '#0c0614', '#26163e'].map(hex), 0.5);
    for (let k = 0; k < 8; k++) c.set(Math.floor(c.rng() * 16), Math.floor(c.rng() * 16), hex('#7a3ad0'));
  },
  wyrm_egg_top: (c, { hex }) => c.noiseFill(['#1c1030', '#26163e', '#120a1c'].map(hex), 0.5),
};

Object.assign(DIM_TEX, HOLLOW_TEX); // the outer islands (hollowTextures.js)
