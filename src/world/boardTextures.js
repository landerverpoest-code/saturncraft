// Procedural textures of the Bounty Board (world/shapes.js draws it as a roofed notice board on two posts, so these are
// the front view of its boxes and double as its icon). Merged into textures.js; each painter gets (canvas, { hex, mix, shade }).

const clear = (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0); };

export const BOARD_TEX = {
  // front view: shingled roof, a plank board with three pinned notices, two posts down to the ground
  bounty_board: (c, { hex, shade }) => {
    clear(c);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex(y ? '#5a3a1e' : '#7a4e2a'), 0.9 + c.h(x, y, 41) * 0.2)); // the roof's edge
    for (let y = 2; y < 4; y++) for (let x = 1; x < 15; x++) c.set(x, y, shade(hex('#4a2e16'), 0.85 + c.h(x, y, 42) * 0.2)); // its shadow
    for (let y = 4; y < 13; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex(y % 3 === 0 ? '#8a6034' : '#a07a45'), 0.92 + c.h(x, y, 43) * 0.14)); // planks
    for (let x = 0; x < 16; x++) { c.set(x, 4, hex('#5e4022')); c.set(x, 12, hex('#5e4022')); } // the frame
    for (let y = 4; y < 13; y++) { c.set(0, y, hex('#5e4022')); c.set(15, y, hex('#5e4022')); }
    for (const [x0, w, y0, h, tilt] of [[2, 4, 5, 5, 0], [7, 3, 6, 4, 1], [11, 3, 5, 6, 0]]) {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) c.set(x, y, shade(hex('#ece0bc'), 0.92 + c.h(x, y, 44) * 0.12)); // a parchment
      for (let y = y0 + 1; y < y0 + h - 1; y += 2) for (let x = x0 + 1; x < x0 + w - 1; x++) if (c.h(x, y, 45) < 0.7) c.set(x, y, hex('#4a3a2a')); // scribbled lines
      c.set(x0 + (tilt ? 0 : 1), y0, hex('#c8321e')); // the pin
    }
    for (let y = 13; y < 16; y++) for (const x of [1, 2, 13, 14]) c.set(x, y, shade(hex('#6e4a26'), (x % 2 ? 1.1 : 0.9) + c.h(x, y, 46) * 0.1)); // the posts
  },
  bounty_board_top: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex(y % 4 === 0 ? '#5a3a1e' : '#6e4626'), 0.9 + c.h(x, y, 47) * 0.2)); // roof shingles
  },
};
