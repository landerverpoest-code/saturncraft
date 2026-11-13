// Procedural textures of content pack 7 (world/coldCurrents.js, player/echoCoffer.js): Driftsnow, Scaldrock and the Echo Coffer.
// Merged into textures.js like the other texture modules; each painter gets (canvas, { hex, mix, shade }).

export const PACK7_TEX = {
  // Driftsnow: soft, bluish snow with wind ripples and a sparkle here and there
  driftsnow: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const ripple = Math.sin((x + y * 0.5) * 0.9 + c.h(0, y >> 2, 71) * 6) * 0.04;
      let col = shade(hex('#eef4fc'), 0.93 + ripple + c.h(x >> 1, y >> 1, 72) * 0.07);
      if (c.h(x, y, 73) > 0.94) col = hex('#ffffff');
      else if (c.h(x, y, 74) > 0.93) col = hex('#cfdcf0');
      c.set(x, y, col);
    }
  },

  // Scaldrock: dark basalt plates with glowing orange seams between them
  scaldrock: (c, { hex, shade, mix }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const px = (x + (c.h(0, y >> 2, 75) > 0.5 ? 2 : 0)) % 6, py = y % 5;
      const seam = px === 0 || py === 0;
      if (seam) c.set(x, y, mix(hex('#ff9a2e'), hex('#c2330c'), c.h(x, y, 76)));
      else c.set(x, y, shade(hex('#3a2b28'), 0.8 + c.h(x, y, 77) * 0.4));
    }
  },

  // Echo Coffer: obsidian panels bound in dark metal, a violet eye set in the front; the lid shows a ring of the same light
  echo_coffer_side: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = y === 5 || x === 0 || x === 15 || y === 0 || y === 15;
      c.set(x, y, band ? shade(hex('#55506a'), 0.9 + c.h(x, y, 78) * 0.2) : shade(hex('#1c1626'), 0.8 + c.h(x >> 1, y >> 1, 79) * 0.5));
    }
  },
  echo_coffer_front: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = y === 5 || x === 0 || x === 15 || y === 0 || y === 15;
      c.set(x, y, band ? shade(hex('#55506a'), 0.9 + c.h(x, y, 78) * 0.2) : shade(hex('#1c1626'), 0.8 + c.h(x >> 1, y >> 1, 79) * 0.5));
    }
    for (let y = 3; y < 9; y++) for (let x = 5; x < 11; x++) {
      const d = Math.hypot(x - 7.5, y - 5.5);
      if (d < 1.2) c.set(x, y, hex('#f0dcff'));
      else if (d < 2.6) c.set(x, y, hex('#9a4fe0'));
      else if (d < 3.3) c.set(x, y, hex('#3b2a52'));
    }
  },
  // Assembler: an iron face with a 3 x 3 grid of sockets and a cinnabar-red output slot; its top shows the same grid from above
  assembler_front: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#8f9399'), 0.88 + c.h(x, y, 82) * 0.2));
    for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) c.set(2 + gx * 4 + x, 1 + gy * 3 + y - (gy ? 0 : 0), hex(x === 1 && y === 1 ? '#2a2c30' : '#55585e'));
    for (let y = 11; y < 15; y++) for (let x = 5; x < 11; x++) c.set(x, y, hex(y === 11 || y === 14 || x === 5 || x === 10 ? '#3a3c40' : '#141518'));
    c.set(13, 12, hex('#d83a2a')); c.set(13, 13, hex('#8a1f16')); c.set(2, 12, hex('#d83a2a')); c.set(2, 13, hex('#8a1f16'));
    for (let x = 0; x < 16; x++) { c.set(x, 0, hex('#5d6066')); c.set(x, 15, hex('#5d6066')); }
  },
  assembler_top: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || x === 15 || y === 0 || y === 15, line = x === 5 || x === 10 || y === 5 || y === 10;
      c.set(x, y, edge ? hex('#5d6066') : line ? hex('#6f4a2a') : shade(hex('#b08a55'), 0.9 + c.h(x, y, 83) * 0.18));
    }
  },
  echo_coffer_top: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || x === 15 || y === 0 || y === 15;
      const d = Math.hypot(x - 7.5, y - 7.5);
      let col = edge ? shade(hex('#55506a'), 0.9 + c.h(x, y, 80) * 0.2) : shade(hex('#1c1626'), 0.8 + c.h(x >> 1, y >> 1, 81) * 0.5);
      if (Math.abs(d - 4.2) < 0.6) col = hex('#9a4fe0');
      if (d < 1.1) col = hex('#d9b8ff');
      c.set(x, y, col);
    }
  },
};
