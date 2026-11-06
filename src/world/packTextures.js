// Procedural textures of the lighthouse / shrine / observatory pack: the two mosaics, leaded glass, the rose window, the
// lighthouse lens, the chandelier, the iron brazier and the rope ladder (blocks appended at the end of world/blocks.js).
// Merged into textures.js like the other texture modules; each painter gets (canvas, { hex, mix, shade }).
// The chandelier and brazier are drawn as the front view of their boxes (world/shapes.js), so the same picture is their icon.

const clear = (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0); };

/** A mosaic of 3 x 3 pixel tiles with a pixel of grout, coloured by the ring each tile lies on round the middle. */
function mosaic(c, { hex, shade }, rings, grout) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (x % 4 === 3 || y % 4 === 3) { c.set(x, y, shade(hex(grout), 0.94 + c.h(x, y, 3) * 0.1)); continue; }
    const i = x >> 2, j = y >> 2, ring = Math.min(rings.length - 1, Math.round(Math.abs(i - 1.5) + Math.abs(j - 1.5)) - 1);
    const lit = (x % 4 === 0 || y % 4 === 0) ? 1.12 : 1;
    c.set(x, y, shade(hex(rings[ring]), lit * (0.93 + c.h(i, j, 5) * 0.14 + c.h(x, y, 6) * 0.05)));
  }
}

/** Leaded lattice: grey lead came round the edge and along both diagonals, glass between (alpha as stained glass). */
function leaded(c, { hex, shade }, tintOf) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const came = edge || Math.abs(x - 7.5) + Math.abs(y - 7.5) === 7.5 || Math.abs(x - 7.5) + Math.abs(y - 7.5) === 3.5 || x === 7 || x === 8 || y === 7 || y === 8;
    if (came) c.set(x, y, shade(hex('#4b4f58'), 0.9 + c.h(x, y, 9) * 0.2), 255);
    else {
      const glint = (x - y === 2 || x - y === 3) && x > 2 && x < 8;
      c.set(x, y, tintOf(x, y, glint), glint ? 170 : 110);
    }
  }
}

export const PACK_TEX = {
  azure_mosaic: (c, k) => mosaic(c, k, ['#e8f2f4', '#3aa0cc', '#244f9a'], '#a8bcc8'),
  sunburst_mosaic: (c, k) => mosaic(c, k, ['#f6d868', '#e08a30', '#a8442a'], '#cdb894'),

  leaded_glass: (c, k) => leaded(c, k, (x, y, glint) => (glint ? k.hex('#ffffff') : k.hex('#cfe9f0'))),

  // a rose window: four petals of red, blue, yellow and green round a white heart, in a lead ring
  rose_window: (c, { hex, shade }) => {
    const cols = ['#d83a3a', '#3a6ad8', '#e8c83a', '#3aa85a'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5, d = Math.hypot(dx, dy);
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      if (edge || Math.abs(d - 5.6) < 0.6 || (d < 6 && (Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.6 || Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6))) {
        c.set(x, y, shade(hex('#44474f'), 0.9 + c.h(x, y, 11) * 0.2), 255);
      } else if (d < 2.4) c.set(x, y, hex('#fff6dc'), 200);
      else if (d < 6) { const q = (dx > 0 ? 1 : 0) + (dy > 0 ? 2 : 0); c.set(x, y, shade(hex(cols[q]), 0.95 + c.h(x, y, 12) * 0.1), 150); }
      else c.set(x, y, shade(hex(cols[(Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 2)) + 2) % 4]), 0.8), 130);
    }
  },

  // the lens of a lighthouse: brass rings round a bright core, warm glass between them
  lighthouse_lens: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5), edge = x === 0 || y === 0 || x === 15 || y === 15;
      if (edge) c.set(x, y, shade(hex('#b8923a'), 0.9 + c.h(x, y, 13) * 0.2), 255);
      else if (d < 2.2) c.set(x, y, hex('#fffbe0'), 235);
      else if (Math.abs(d - 4.2) < 0.55 || Math.abs(d - 6.6) < 0.55) c.set(x, y, shade(hex('#d8b24a'), 0.95 + c.h(x, y, 14) * 0.15), 255);
      else c.set(x, y, shade(hex('#ffe9a0'), 0.9 + c.h(x, y, 15) * 0.2), d < 5.4 ? 190 : 150);
    }
  },

  // chandelier, front view: a chain from the top, a ring and cross of iron, four candles with flames
  chandelier: (c, { hex, shade }) => {
    clear(c);
    for (let y = 0; y < 5; y++) for (let x = 7; x <= 8; x++) c.set(x, y, shade(hex('#3a3a40'), y % 2 ? 0.85 : 1.1)); // chain links
    for (let y = 5; y < 8; y++) for (let x = 6; x <= 9; x++) c.set(x, y, shade(hex('#4a4a52'), 0.9 + c.h(x, y, 16) * 0.2)); // hub
    for (let x = 2; x < 14; x++) for (let y = 7; y < 9; y++) c.set(x, y, shade(hex('#3c3c44'), y === 7 ? 1.15 : 0.9)); // the ring and arms
    for (const x0 of [2, 12]) for (let x = x0; x < x0 + 2; x++) {
      for (let y = 4; y < 7; y++) c.set(x, y, shade(hex('#efe3c0'), 0.9 + c.h(x, y, 17) * 0.1)); // wax
      c.set(x, 3, hex('#ffd24a')); c.set(x, 2, x === x0 ? hex('#ff9a2a') : hex('#fff0a0')); // flame
    }
  },
  chandelier_top: (c, { hex, shade }) => {
    clear(c);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
      const ring = x < 4 || x > 11 || y < 4 || y > 11, cross = (x >= 7 && x <= 8) || (y >= 7 && y <= 8);
      if (ring || cross) c.set(x, y, shade(hex('#3c3c44'), 0.95 + c.h(x, y, 18) * 0.12));
    }
    for (const [x0, y0] of [[2, 2], [12, 2], [2, 12], [12, 12]]) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) c.set(x0 + dx, y0 + dy, hex(dx === dy ? '#ffd24a' : '#fff0a0')); // the flames
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) c.set(x, y, shade(hex('#4a4a52'), 1)); // the hub and chain
  },

  // iron brazier, front view: a bowl on a stand, a bright fire heaped above the rim
  iron_brazier: (c, { hex, shade }) => {
    clear(c);
    for (let y = 1; y < 6; y++) for (let x = 4; x < 12; x++) {
      const t = c.h(x, y, 19);
      if (y < 2 + (x % 3 === 0 ? 1 : 0) && t < 0.5) continue; // ragged tongues at the top
      c.set(x, y, y < 3 ? hex(t < 0.5 ? '#fff0a0' : '#ffd24a') : y < 5 ? hex(t < 0.5 ? '#ffa030' : '#ff7a20') : hex('#e04a1a'));
    }
    for (let y = 6; y < 9; y++) for (let x = 2; x < 14; x++) c.set(x, y, shade(hex('#34343c'), (y === 6 ? 1.25 : y === 8 ? 0.75 : 1) + c.h(x, y, 20) * 0.1)); // bowl
    for (let y = 9; y < 14; y++) for (let x = 6; x < 10; x++) c.set(x, y, shade(hex('#3c3c44'), (x === 6 ? 1.15 : 0.9) + c.h(x, y, 21) * 0.1)); // stand
    for (let y = 14; y < 16; y++) for (let x = 4; x < 12; x++) c.set(x, y, shade(hex('#34343c'), y === 14 ? 1.2 : 0.8)); // foot
  },
  iron_brazier_top: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (x >= 4 && x < 12 && y >= 4 && y < 12) c.set(x, y, hex(c.h(x, y, 22) < 0.5 ? '#ffc040' : '#ff8a2a'));
      else if (x >= 2 && x < 14 && y >= 2 && y < 14) c.set(x, y, shade(hex('#2c2c34'), 0.9 + c.h(x, y, 23) * 0.2));
      else c.set(x, y, shade(hex('#34343c'), 0.85 + c.h(x, y, 24) * 0.2), 0);
    }
  },

  // rope ladder: two ropes with rungs of wood (drawn like the ladder, over the whole face)
  rope_ladder: (c, { hex, shade }) => {
    clear(c);
    for (let y = 0; y < 16; y++) for (const x of [2, 3, 12, 13]) c.set(x, y, shade(hex((x + (y >> 1)) % 2 ? '#b89a62' : '#9a7c46'), 0.9 + c.h(x, y, 25) * 0.15));
    for (const y of [1, 5, 9, 13]) for (let x = 4; x < 12; x++) c.set(x, y, shade(hex('#7a5a30'), (x % 3 ? 1 : 0.85) + c.h(x, y, 26) * 0.1));
  },
};
