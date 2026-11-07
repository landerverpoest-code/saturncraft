// Procedural textures for the ocean and sky round: Cirrusstone, the Beanstalk and Gleamkelp.
// Merged into textures.js like the other texture modules; each painter gets (canvas, { hex, mix, shade }).
// (world/skyIsles.js, world/deepSea.js)

const clear = (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0); };

export const OCEANSKY_TEX = {
  // pale, faintly blue-white rock with soft banding and the odd lilac fleck
  cirrusstone: (c, { hex, mix }) => {
    const a = hex('#e4e8f0'), b = hex('#c2cada'), fleck = hex('#b4a8d8');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = Math.sin((y + c.h(x >> 2, 0, 21) * 6) * 0.9) * 0.5 + 0.5;
      const n = c.h(x, y, 22) * 0.35 + band * 0.45 + c.h(x >> 1, y >> 1, 23) * 0.2;
      c.set(x, y, c.h(x, y, 24) > 0.94 ? fleck : mix(b, a, n));
    }
  },
  // a thick green stalk twisting up, knotted with a leaf now and then; transparent either side
  beanstalk: (c, { hex, shade }) => {
    clear(c);
    const g = hex('#58a838'), d = hex('#3a7a28'), hi = hex('#8ad058'), leaf = hex('#4a9a30');
    for (let y = 0; y < 16; y++) {
      const sw = Math.round(Math.sin(y * 0.55) * 1);
      for (let x = 5; x <= 10; x++) c.set(x + sw, y, x === 5 || x === 10 ? d : x === 6 || x === 7 ? hi : shade(g, 0.9 + c.h(x, y, 31) * 0.2));
    }
    for (const [y, s] of [[3, 1], [9, -1], [13, 1]]) for (let i = 0; i < 4; i++) { c.set(s > 0 ? 11 + i : 4 - i, y + (i >> 1), leaf); c.set(s > 0 ? 11 + i : 4 - i, y + 1 + (i >> 1), d); }
  },
  // kelp that glows from within: pale gold bladders along the stalk
  gleamkelp: (c, { hex }) => {
    clear(c);
    const g = hex('#3a8a5a'), d = hex('#256a44'), glow = hex('#ffe27a'), halo = hex('#cfe98a');
    for (let y = 0; y < 16; y++) { const sw = Math.round(Math.sin(y * 0.6) * 1.5); c.set(7 + sw, y, g); c.set(8 + sw, y, d); }
    for (let k = 0; k < 3; k++) {
      const y = 2 + k * 5, x = 7 + Math.round(Math.sin(y * 0.6) * 1.5) + (k & 1 ? 3 : -3);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) c.set(x + dx, y + dy, glow);
      for (const [dx, dy] of [[-1, 0], [2, 0], [0, -1], [1, -1], [0, 2], [1, 2], [-1, 1], [2, 1]]) c.set(x + dx, y + dy, halo);
      c.set(x + (k & 1 ? -1 : 2), y + 1, g); c.set(x + (k & 1 ? -2 : 3), y + 1, d);
    }
  },
};
