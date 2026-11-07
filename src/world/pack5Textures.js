// Procedural textures of the desert / badlands / swamp pack (blocks appended at the end of world/blocks.js): seven Strata (banded clay),
// Sandvault Bricks and the Sun Glyph, the Dart Trap, Bog Planks and the Hag's Cauldron. Merged into textures.js like the other texture
// modules; each painter gets (canvas, { hex, mix, shade }).

/** Strata: wavy horizontal bands of three tones of one clay, with a thin dark seam between the bands. */
function strata(c, { hex, shade }, tones) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const wob = Math.round(Math.sin((x + c.h(0, 0, 41) * 6) * 0.55) * 0.9 + (c.h(x >> 1, y, 42) - 0.5) * 0.9);
    const band = Math.floor(((y + wob + 16) % 16) / 5.4) % 3; // 0, 1, 2
    const seam = (y + wob + 16) % 16 === 5 || (y + wob + 16) % 16 === 11;
    const base = hex(tones[band]);
    c.set(x, y, shade(base, seam ? 0.78 : 0.93 + c.h(x, y, 43) * 0.12));
  }
}

const STRATA = {
  strata_rose: ['#d9a99a', '#cc9484', '#e4bbac'],
  strata_rust: ['#b5532c', '#a14624', '#c8683a'],
  strata_crimson: ['#8f2e2a', '#7b2522', '#a43c34'],
  strata_saffron: ['#e3a93a', '#d4962c', '#f0bf58'],
  strata_bone: ['#e6dcc6', '#d6c9ae', '#f2ead8'],
  strata_umber: ['#6a4630', '#573823', '#7c5640'],
  strata_ash: ['#a4a09a', '#8f8b85', '#b8b4ae'],
};

/** Square sandstone bricks in courses, a thin gold seam, and a few worn tiles. */
function vaultBricks(c, { hex, shade }) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = y >> 2, off = (row & 1) * 4, bx = (x + off) % 8;
    const mortar = y % 4 === 3 || bx === 7;
    if (mortar) { c.set(x, y, shade(hex('#b08a4a'), 0.85 + c.h(x, y, 44) * 0.2)); continue; }
    const tile = c.h((x + off) >> 3, row, 45);
    c.set(x, y, shade(hex(tile < 0.25 ? '#d0b078' : '#dcc088'), 0.94 + c.h(x, y, 46) * 0.12));
  }
}

export const PACK5_TEX = {
  ...Object.fromEntries(Object.entries(STRATA).map(([k, tones]) => [k, (c, kit) => strata(c, kit, tones)])),
  sandvault_bricks: (c, k) => vaultBricks(c, k),

  // the Sun Glyph: sandvault brick carved with a golden sun (a disc, eight rays)
  sun_glyph: (c, k) => {
    vaultBricks(c, k);
    const { hex, shade } = k;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const ray = d > 3.2 && d < 7 && Math.abs(((a / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.38;
      if (d < 3.1) c.set(x, y, shade(hex('#f2c63a'), 0.92 + c.h(x, y, 47) * 0.16));
      else if (ray) c.set(x, y, shade(hex('#d89a22'), 0.9 + c.h(x, y, 48) * 0.2));
    }
  },

  // Dart Trap: a plain sandstone-grey block; the front has a dark slit with the tip of a dart in it
  dart_trap_top: (c, { hex, shade }) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#a89a7a'), (x === 0 || y === 0 || x === 15 || y === 15 ? 0.8 : 0.95) + c.h(x, y, 49) * 0.1)); },
  dart_trap_side: (c, { hex, shade }) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#b8a888'), (x === 0 || x === 15 ? 0.82 : 0.96) + c.h(x, y, 50) * 0.1)); },
  dart_trap_front: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#b8a888'), (x === 0 || x === 15 || y === 0 || y === 15 ? 0.8 : 0.96) + c.h(x, y, 51) * 0.1));
    for (let y = 6; y <= 9; y++) for (let x = 4; x <= 11; x++) c.set(x, y, shade(hex('#1c1812'), 0.9 + c.h(x, y, 52) * 0.2));
    for (let x = 7; x <= 9; x++) { c.set(x, 7, hex('#c8c0b0')); c.set(x, 8, hex('#7a3a2a')); }
    c.set(10, 7, hex('#e8e4dc')); c.set(10, 8, hex('#e8e4dc'));
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) c.set(x, y, hex('#6a5e48')); // rivets
  },

  // Bog Planks: dark, soaked boards with green moss in the seams
  bog_planks: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const board = y >> 2, seam = y % 4 === 3, grain = c.h(x >> 2, board, 53);
      let col = shade(hex(grain < 0.5 ? '#4a3a26' : '#54422c'), 0.9 + c.h(x, y, 54) * 0.2);
      if (seam) col = shade(hex('#2a2218'), 0.9 + c.h(x, y, 55) * 0.2);
      if ((seam || c.h(x, y, 56) > 0.9) && c.h(x, y, 57) > 0.45) col = shade(hex('#4f6a2a'), 0.85 + c.h(x, y, 58) * 0.3);
      c.set(x, y, col);
    }
  },

  // Hag's Cauldron: sooty iron sides with rivet bands; the top is the iron rim round a bubbling green brew
  hag_cauldron_side: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = y === 3 || y === 12;
      c.set(x, y, shade(hex(band ? '#5a5a62' : '#34343a'), 0.9 + c.h(x, y, 59) * 0.2));
      if (band && x % 4 === 1) c.set(x, y, shade(hex('#8a8a92'), 0.9 + c.h(x, y, 60) * 0.1));
    }
    for (let x = 0; x < 16; x++) if (c.h(x, 15, 61) > 0.5) c.set(x, 14, shade(hex('#1c1c20'), 0.9)); // soot at the foot
  },
  hag_cauldron_top: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 6.6) c.set(x, y, shade(hex('#44444c'), 0.9 + c.h(x, y, 62) * 0.2));
      else if (d > 5.6) c.set(x, y, shade(hex('#6a6a72'), 0.95 + c.h(x, y, 63) * 0.1));
      else {
        const bub = c.h(x, y, 64) > 0.86;
        c.set(x, y, bub ? hex('#c8f08a') : shade(hex('#58862a'), 0.85 + c.h(x >> 1, y >> 1, 65) * 0.35));
      }
    }
  },
};
