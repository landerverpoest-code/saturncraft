// Procedural pixel art for the Cinnabar circuit parts (see world/textures.js:
// each entry paints a 16x16 canvas; `h` = { hex, mix, shade, gen, planks }).
// Wire textures are greyscale: the mesher tints them by power level.

const clear = (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0); };
const grey = (v) => [v, v, v];

/** A soft 3-px wide line of wire along the v axis between rows y0..y1. */
function wireLine(c, y0, y1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = 6; x <= 9; x++) {
      const edge = x === 6 || x === 9;
      if (edge && c.h(x, y, 7) < 0.45) continue;
      c.set(x, y, grey(edge ? 170 : 225 + Math.floor(c.h(x, y) * 30)));
    }
  }
}
function wireDot(c, r) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d > r + c.h(x, y, 3) * 0.8) continue;
    c.set(x, y, grey(d > r - 1 ? 175 : 230 + Math.floor(c.h(x, y) * 25)));
  }
}

function torch(c, h, head, glow) {
  clear(c);
  for (let y = 6; y < 16; y++) { c.set(7, y, h.hex('#7a5a32')); c.set(8, y, h.hex('#5f4526')); }
  c.set(7, 6, h.hex(head[0])); c.set(8, 6, h.hex(head[1])); c.set(7, 7, h.hex(head[2])); c.set(8, 7, h.hex(head[1]));
  if (glow) for (const [x, y] of [[6, 6], [9, 6], [7, 5], [8, 5]]) c.set(x, y, h.hex(glow), 200);
}

function lamp(c, h, on) {
  const frame = on ? h.hex('#7a3a1a') : h.hex('#4a2a1a');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    const cell = (x % 5 === 0 || y % 5 === 0);
    let col;
    if (border) col = h.shade(frame, 0.8 + c.h(x, y) * 0.3);
    else if (cell) col = on ? h.mix(h.hex('#ffd890'), h.hex('#ffb050'), c.h(x, y)) : h.shade(h.hex('#6a4a3a'), 0.85 + c.h(x, y) * 0.2);
    else col = on ? h.mix(h.hex('#fff0c0'), h.hex('#ffc070'), c.h(x >> 1, y >> 1, 2)) : h.mix(h.hex('#7a3a32'), h.hex('#a0584a'), c.h(x >> 1, y >> 1, 2));
    c.set(x, y, col);
  }
}

function smoothStone(c, h) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    c.set(x, y, h.shade(h.hex('#a2a2a4'), (edge ? 0.82 : 0.95) + c.h(x, y) * 0.08));
  }
}

function repeater(c, h, on) {
  smoothStone(c, h);
  const wire = on ? h.hex('#ff3a20') : h.hex('#7a1a14'), dark = h.shade(h.hex('#a2a2a4'), 0.7);
  // a groove with the wire running from the input (bottom) to the output (top)
  for (let y = 1; y < 15; y++) { c.set(6, y, dark); c.set(9, y, dark); c.set(7, y, wire); c.set(8, y, h.shade(wire, 0.85)); }
  // a solid chevron near the output
  for (let k = 0; k < 4; k++) for (const x of [7 - k, 8 + k]) { c.set(x, 4 + k, wire); c.set(x, 5 + k, h.shade(wire, 0.8)); }
}

function pistonSide(c, h) {
  // a plank band at the top (towards the front), cobbled body below
  h.gen.cobblestone(c);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) c.set(x, y, h.shade(h.hex('#a7834e'), y === 3 ? 0.62 : 0.9 + c.h(x, y, 3) * 0.1));
  for (let y = 4; y < 16; y++) { c.set(0, y, h.shade(h.hex('#6a6a6c'), 0.8)); c.set(15, y, h.shade(h.hex('#6a6a6c'), 0.8)); }
}

export const CIRCUIT_TEX = {
  cinnabar_wire: (c) => { clear(c); wireLine(c, 0, 15); for (let y = 6; y <= 9; y++) for (let x = 0; x < 16; x++) c.set(x, y, grey(220)); wireDot(c, 3); },
  cinnabar_wire_dot: (c) => { clear(c); wireDot(c, 3.2); },
  cinnabar_wire_line: (c) => { clear(c); wireLine(c, 0, 15); },
  cinnabar_wire_half: (c) => { clear(c); wireLine(c, 0, 8); },
  // the handle: a stick over the full height (the mesher samples rows 0-10 for its sides and 6-7 for its tip)
  lever: (c, h) => { clear(c); for (let y = 0; y < 16; y++) { c.set(7, y, h.hex('#8a6a3a')); c.set(8, y, h.hex('#6a4e2a')); } for (const y of [6, 7]) { c.set(7, y, h.hex('#a8845a')); c.set(8, y, h.hex('#8a6a3a')); } },
  cinnabar_torch: (c, h) => torch(c, h, ['#ff5030', '#e02a18', '#ff8a5a'], null),
  cinnabar_torch_off: (c, h) => torch(c, h, ['#5a1a14', '#4a1410', '#6a2418'], null),
  cinnabar_lamp: (c, h) => lamp(c, h, false),
  cinnabar_lamp_on: (c, h) => lamp(c, h, true),
  smooth_stone: (c, h) => smoothStone(c, h),
  repeater: (c, h) => repeater(c, h, false),
  repeater_on: (c, h) => repeater(c, h, true),
  piston_top: (c, h) => { h.planks(c, '#b08a52'); for (let i = 0; i < 16; i++) { c.set(i, 0, h.hex('#6a4a28')); c.set(i, 15, h.hex('#6a4a28')); c.set(0, i, h.hex('#6a4a28')); c.set(15, i, h.hex('#6a4a28')); } },
  piston_top_sticky: (c, h) => {
    CIRCUIT_TEX.piston_top(c, h);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) if (c.h(x >> 1, y >> 1, 9) < 0.85) c.set(x, y, h.mix(h.hex('#6ab840'), h.hex('#8ad860'), c.h(x, y)));
  },
  piston_side: (c, h) => pistonSide(c, h),
  piston_bottom: (c, h) => { h.gen.cobblestone(c); for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) c.set(x, y, h.shade(h.hex('#5a5a5c'), 0.9)); },
  piston_inner: (c, h) => { h.gen.cobblestone(c); for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) c.set(x, y, h.shade(h.hex('#2a2a2c'), 1 + c.h(x, y) * 0.3)); },
  piston_rod: (c, h) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, h.shade(h.hex('#a7834e'), 0.85 + c.h(x, y >> 2) * 0.15)); },
  chime_block: (c, h) => {
    h.planks(c, '#7a5232');
    // three little brass chimes
    for (const x of [4, 8, 12]) for (let y = 3; y < 13 - (x >> 2); y++) { c.set(x, y, h.hex('#e0b850')); c.set(x - 1, y, h.hex('#a08030')); }
  },
  chime_block_top: (c, h) => { h.planks(c, '#7a5232'); for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) if (Math.hypot(x - 7.5, y - 7.5) < 3) c.set(x, y, h.hex('#2a1a10')); },
  cinnabar_block: (c, h) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      c.set(x, y, h.shade(h.mix(h.hex('#c0201a'), h.hex('#e8402a'), c.h(x >> 1, y >> 1, 1)), edge ? 0.7 : 0.9 + c.h(x, y) * 0.2));
    }
    for (const [x, y] of [[4, 4], [11, 5], [6, 11], [12, 12], [8, 8]]) c.set(x, y, h.hex('#ff8a6a'));
  },
};
