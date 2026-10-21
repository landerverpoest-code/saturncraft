// Procedural textures of the Hollow's outer islands: Hollowbrick (violet
// city bricks), its pillar, Hollowstone Bricks, the Wisp Rod, the Far Gate,
// the Gloomshell Box, the Wyrm Head trophy and the Hushvine. Merged into
// DIM_TEX (dimTextures.js), so textures.js paints them like the others.

const clear = (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0); };

export const HOLLOW_TEX = {
  // pale violet blocks set in a 2x2 grid of tiles with dark seams
  hollowbrick: (c, { hex, shade }) => {
    const pal = ['#a87cb0', '#b388ba', '#9d70a6', '#bb93c2'].map(hex);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const seam = (x & 7) === 7 || (y & 7) === 7, hi = (x & 7) === 0 || (y & 7) === 0;
      const base = pal[Math.floor(c.h(x >> 1, y >> 1) * pal.length)];
      c.set(x, y, seam ? hex('#6a4572') : shade(base, hi ? 1.1 : 0.94 + c.h(x, y) * 0.1));
    }
  },
  hollowbrick_pillar: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const groove = x === 3 || x === 12, rim = y === 0 || y === 15;
      const v = 0.92 + c.h(x, y >> 2) * 0.12 + (x > 4 && x < 11 ? 0.06 : 0);
      c.set(x, y, rim ? hex('#7a5282') : groove ? hex('#82588a') : shade(hex('#ae84b6'), v));
    }
  },
  hollowbrick_pillar_top: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const ring = r > 6.5 || (r > 3.5 && r < 4.5);
      c.set(x, y, ring ? hex('#7a5282') : shade(hex('#b48aba'), 0.92 + c.h(x, y) * 0.12));
    }
  },
  // pale stone in small offset bricks
  hollowstone_bricks: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const row = y >> 2, off = row & 1 ? 4 : 0;
      if ((y & 3) === 3 || ((x + off) & 7) === 7) { c.set(x, y, hex('#a8a472')); continue; }
      c.set(x, y, shade(hex('#e0dcae'), 0.9 + c.h(x, y) * 0.16));
    }
  },
  // a slim glowing white rod on a violet foot (torch-shaped: columns 7-8, rows 6-15)
  wisp_rod: (c, { hex }) => {
    clear(c);
    for (let y = 6; y < 16; y++) { c.set(7, y, hex('#f8f4ff')); c.set(8, y, hex('#d8d0f0')); }
    c.set(7, 6, hex('#ffffff')); c.set(8, 6, hex('#fff6ff'));
    c.set(7, 15, hex('#8a5a96')); c.set(8, 15, hex('#6a4072')); c.set(7, 14, hex('#8a5a96')); c.set(8, 14, hex('#6a4072'));
  },
  // a sheet of deep space with a bright cyan-white beam glimmer
  far_gate: (c, { hex, mix }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = c.h(x >> 2, y >> 2, 3) * 0.6 + c.h(x, y, 4) * 0.4;
      const beam = Math.max(0, 1 - Math.abs(x - 7.5) / 3);
      c.set(x, y, mix(mix(hex('#030612'), hex('#102a40'), n * n), hex('#9af6ff'), beam * 0.35));
    }
    for (let k = 0; k < 10; k++) c.set(Math.floor(c.rng() * 16), Math.floor(c.rng() * 16), k % 2 ? hex('#e8fbff') : hex('#7affd0'));
  },
  // the Gloomshell Box: violet shell plates with a darker band where the lid closes
  gloomshell_box_side: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = y === 6 || y === 7, edge = x === 0 || x === 15 || y === 0 || y === 15;
      const v = 0.9 + c.h(x >> 1, y >> 1) * 0.16;
      c.set(x, y, band ? hex('#3e2448') : edge ? hex('#6a3e78') : shade(hex(y < 6 ? '#9a64a8' : '#8a5898'), v));
    }
  },
  gloomshell_box_top: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || x === 15 || y === 0 || y === 15;
      const r = Math.hypot(x - 7.5, y - 7.5);
      c.set(x, y, edge ? hex('#6a3e78') : r < 3 ? hex('#b886c4') : shade(hex('#9a64a8'), 0.9 + c.h(x, y) * 0.14));
    }
  },
  // Wyrm Head: dark scales, a pale horned brow and glowing violet eyes on the face
  wyrm_head_side: (c, { hex }) => c.noiseFill(['#3a2e52', '#45375e', '#2e2442', '#52436e'].map(hex), 0.45),
  wyrm_head_top: (c, { hex }) => {
    c.noiseFill(['#3a2e52', '#45375e', '#2e2442'].map(hex), 0.45);
    for (const x of [4, 11]) for (let y = 3; y < 13; y++) c.set(x, y, hex('#ece6ff'));
  },
  wyrm_head_face: (c, { hex }) => {
    c.noiseFill(['#3a2e52', '#45375e', '#2e2442', '#52436e'].map(hex), 0.45);
    for (const x of [5, 10]) { c.set(x, 8, hex('#e070ff')); c.set(x + (x < 8 ? 1 : -1), 8, hex('#b040e0')); }
    for (let x = 4; x < 12; x++) c.set(x, 12, hex('#1a1028'));
    for (const x of [5, 7, 9, 11]) c.set(x, 13, hex('#ece6ff'));
  },
  // Hushvine: knotty purple stalks (see-through between the knots)
  hushvine: (c, { hex, shade }) => {
    clear(c);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const core = Math.abs(x - 7.5) < 4 || Math.abs(y - 7.5) < 4;
      const knot = Math.hypot(x - 7.5, y - 7.5) < 6;
      if (!core && !knot) continue;
      if (c.h(x, y, 5) < 0.12) continue;
      c.set(x, y, shade(hex(knot ? '#6a4a7a' : '#5a3c68'), 0.85 + c.h(x, y) * 0.3));
    }
  },
  hushvine_flower: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const petal = (Math.abs(x - 7.5) < 3 || Math.abs(y - 7.5) < 3) && !(x > 5 && x < 10 && y > 5 && y < 10);
      c.set(x, y, petal ? shade(hex('#e0c8ec'), 0.9 + c.h(x, y) * 0.15) : shade(hex('#9a74a8'), 0.85 + c.h(x, y) * 0.2));
    }
  },
};
