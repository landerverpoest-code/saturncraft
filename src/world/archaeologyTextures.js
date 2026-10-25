// Procedural pixel art for archaeology (world/archaeology.js): Suspicious Sand and Gravel in
// four brushing stages (a pocked surface, then a hollow swept ever deeper with the find showing
// through), and the Decorated Pot's clay. `h` = { hex, mix, shade } (see world/textures.js).
import { POT_CLAY } from './sherds.js';
import { hash4 } from './noise.js';

const SAND = ['#e2d39b', '#d9c88c', '#eadcab', '#cfbd80'];
const GRAVEL = ['#8c8580', '#6e6864', '#a39c96', '#5c5754', '#7d7671'];

/**
 * Grainy ground with little dimples; from stage 1 an oval hollow opens in the middle (darker,
 * with a lit rim), growing with each stage, and the find glints at its bottom from stage 2.
 */
function suspicious(c, h, palette, stage, dimple, find) {
  // one grain pattern for all four stages (the canvas's own noise is seeded by the texture's name)
  const seed = palette.length * 977, g = (x, y, k = 0) => hash4(seed, x, y, k) / 4294967296;
  const pal = palette.map(h.hex);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = g(x, y) * 0.6 + g(x >> 2, y >> 2, 1) * 0.4;
    let col = pal[Math.min(pal.length - 1, Math.floor(n * pal.length))];
    if (g(x, y, 7) < 0.07) col = h.shade(h.hex(dimple), 0.9 + g(x, y, 8) * 0.2); // the odd darker grain: something is down there
    if (stage > 0) {
      const r = 2.2 + stage * 1.7, d = Math.hypot((x - 7.5) / 1.15, y - 7.5);
      if (d < r) col = h.shade(col, 0.62 + (d / r) * 0.25);             // swept hollow, darker inwards
      else if (d < r + 1) col = h.shade(col, 1.12);                       // brushed-up rim
    }
    c.set(x, y, col);
  }
  if (stage >= 2) {
    // the find showing through: a shard edge, growing clearer
    const cells = stage === 2 ? [[7, 7], [8, 7], [8, 8]] : [[6, 6], [7, 6], [8, 6], [6, 7], [7, 7], [8, 7], [9, 7], [7, 8], [8, 8], [9, 8], [8, 9]];
    for (const [x, y] of cells) c.set(x, y, h.shade(h.hex(find), 0.85 + g(x, y, 9) * 0.3));
    if (stage === 3) { c.set(6, 6, h.hex('#f0c090')); c.set(7, 6, h.hex('#f0c090')); }
  }
}

/** Clay with a dark band near the top and the bottom. */
function potClay(c, h, y0 = 0) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const band = y === 3 + y0 || y === 14;
    c.set(x, y, h.shade(h.hex(band ? POT_CLAY.dark : POT_CLAY.body), 0.9 + c.h(x, y) * 0.12 + (y < 2 ? 0.08 : 0)));
  }
}

export const ARCH_TEX = {
  decorated_pot_side: (c, h) => potClay(c, h),
  decorated_pot_bottom: (c, h) => potClay(c, h),
  decorated_pot_top: (c, h) => {
    // the lip round a dark opening
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const inside = x >= 5 && x <= 10 && y >= 5 && y <= 10;
      c.set(x, y, inside ? h.shade(h.hex('#2a160e'), 0.8 + c.h(x, y) * 0.3) : h.shade(h.hex(POT_CLAY.light), 0.88 + c.h(x, y) * 0.12));
    }
  },
};
for (let s = 0; s < 4; s++) {
  ARCH_TEX['suspicious_sand_' + s] = (c, h) => suspicious(c, h, SAND, s, '#b8a46a', '#a85a3c');
  ARCH_TEX['suspicious_gravel_' + s] = (c, h) => suspicious(c, h, GRAVEL, s, '#4a4440', '#a85a3c');
}
