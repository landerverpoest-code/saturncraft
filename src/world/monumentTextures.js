// Procedural block textures for the Tide Citadel (ocean monument) blocks.
// Called from textures.js paint() with the shared 16x16 canvas and colour helpers.

import { hashf } from './noise.js';

/** Frames of the animated tidestone texture (tidestone_f0..): a slow shimmer that loops. */
export const TIDE_FRAMES = 8;
const th = (x, y, k) => hashf(7001, x, y, k); // (a fixed seed, so every frame has the same mottling and veins)
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * One frame of the tidestone: the same mottled sea-green stone in every frame, with a slow shimmer drifting over it
 * (each 2x2 patch brightens and dims out of step with its neighbours) and pale veins that glint. The terrain shader
 * swaps the frames on a timer (render/terrainMaterial.js), so no chunk is ever remeshed for it.
 */
export function tidestoneFrame(c, frame, { hex, mix }) {
  const a = hex('#4f8f86'), b = hex('#6fb3a2'), d = hex('#3b6f6c'), pale = hex('#9fd6c4'), glint = hex('#d4f4ea');
  const ph = (frame / TIDE_FRAMES) * Math.PI * 2;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const base = th(x >> 2, y >> 2, 1) * 0.55 + th(x >> 1, y >> 1, 2) * 0.3 + th(x, y, 0) * 0.15;
    const n = clamp01(base + Math.sin(ph + th(x >> 1, y >> 1, 3) * Math.PI * 2) * 0.17);
    c.set(x, y, n < 0.4 ? mix(d, a, n / 0.4) : mix(a, b, (n - 0.4) / 0.6));
  }
  for (let k = 0; k < 3; k++) {
    let x = Math.floor(th(k, 0, 9) * 16), y = Math.floor(th(k, 1, 9) * 16);
    for (let s = 0; s < 6; s++) {
      const glow = 0.5 + 0.5 * Math.sin(ph * 2 - s * 0.9 + k * 2);
      c.set(x & 15, y & 15, mix(pale, glint, glow * 0.7));
      x += th(k, s, 10) < 0.5 ? 1 : 0; y += 1;
    }
  }
}

/**
 * @param {object} c   Canvas16 (set, get, h, rng, noiseFill)
 * @param {{hex: Function, mix: Function, shade: Function}} u colour helpers
 */
export const MONUMENT_TEX = {
  // mottled sea-green stone with lighter veins (frame 0 of the animation, see tidestoneFrame)
  tidestone: (c, u) => tidestoneFrame(c, 0, u),
  // tidy blocks of light tidestone with deep teal grout
  tidestone_bricks: (c, { hex, shade }) => {
    const grout = hex('#2f5f5c');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const row = y >> 3, off = row & 1 ? 4 : 0;
      if ((y & 7) === 7 || ((x + off) & 7) === 7) { c.set(x, y, grout); continue; }
      const edge = (y & 7) === 0 || ((x + off) & 7) === 0;
      c.set(x, y, shade(hex('#73b8a8'), (edge ? 1.12 : 0.92) + c.h(x, y) * 0.12));
    }
  },
  // near-black green slabs, framed, with a darker inset
  dark_tidestone: (c, { hex, shade }) => {
    const base = hex('#2d4f45'), line = hex('#1a3029');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const border = x === 0 || y === 0 || x === 15 || y === 15;
      const inset = (x === 3 || x === 12) && y >= 3 && y <= 12 || (y === 3 || y === 12) && x >= 3 && x <= 12;
      c.set(x, y, border || inset ? line : shade(base, 0.9 + c.h(x, y) * 0.2));
    }
    for (let x = 1; x < 15; x++) c.set(x, 1, shade(base, 1.25));
  },
  // a pale glowing lantern: frosted panes around a bright core
  tide_lantern: (c, { hex, mix }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const t = Math.min(1, r / 7.5);
      let col = mix(hex('#fbfff8'), hex('#a8d8cc'), t * t);
      if (r > 7) col = hex('#8fbfb2');
      else if ((x === 7 || x === 8 || y === 7 || y === 8) && r > 2) col = mix(col, hex('#c8eee0'), 0.6);
      c.set(x, y, mix(col, hex('#ffffff'), c.h(x, y) * 0.12));
    }
  },
  // dry, porous yellow moss block full of holes
  soakmoss: (c, { hex, shade }) => {
    c.noiseFill(['#d6c24a', '#c9b33e', '#e0cf5c', '#bca836'].map(hex), 0.4);
    for (let k = 0; k < 12; k++) {
      const x = Math.floor(c.rng() * 15), y = Math.floor(c.rng() * 15);
      c.set(x, y, shade(hex('#8a7a22'), 0.8)); if (c.rng() < 0.5) c.set(x + 1, y, hex('#9a8a2a'));
    }
  },
  // the same, soaked dark and greenish
  wet_soakmoss: (c, { hex, shade }) => {
    c.noiseFill(['#a8a23a', '#9a9632', '#b2ac44', '#8e8a2c'].map(hex), 0.4);
    for (let k = 0; k < 12; k++) {
      const x = Math.floor(c.rng() * 15), y = Math.floor(c.rng() * 15);
      c.set(x, y, shade(hex('#4a5a2a'), 0.8)); if (c.rng() < 0.5) c.set(x, y + 1, hex('#5a6a32'));
    }
    for (let x = 0; x < 16; x += 3) c.set(x, 15, hex('#6a8a8a')); // a drip line
  },
};
// the frames the shader swaps between (world/textures.js lists them as layers)
for (let i = 0; i < TIDE_FRAMES; i++) MONUMENT_TEX['tidestone_f' + i] = (c, u) => tidestoneFrame(c, i, u);
