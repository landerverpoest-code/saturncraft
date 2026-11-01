// Procedural pixel art for the world events (world/events.js): the Starfall Core, the glowing heart a fallen
// meteorite leaves in its crater. `h` = { hex, mix, shade } (see world/textures.js).

export const EVENT_TEX = {
  // a crust of near-black stone with cracks that run white-hot towards a bright middle
  starfall_core: (c, h) => {
    const crust = h.hex('#241f2e'), crust2 = h.hex('#3a3148'), hot = h.hex('#ffe9a0'), glow = h.hex('#ff9a3a');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5) / 10.6;
      const n = c.h(x >> 1, y >> 1, 301) * 0.6 + c.h(x, y, 302) * 0.4;
      const crack = (Math.abs(((x * 3 + y * 5) % 11) - 5) < 1 && c.h(x, y, 303) < 0.8) || (x + y * 2) % 9 === 0;
      let col = h.shade(h.mix(crust, crust2, n), 0.85 + c.h(x, y, 304) * 0.3);
      const heat = Math.max(0, 1 - r * 1.15);
      if (crack) col = h.mix(h.mix(glow, hot, heat), col, 0.15 + r * 0.35);
      if (heat > 0.62) col = h.mix(col, hot, (heat - 0.62) / 0.38);
      c.set(x, y, col);
    }
  },
};
