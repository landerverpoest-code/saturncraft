// Procedural pixel art for the cinnabar automation blocks (see world/textures.js: each entry paints a 16x16 canvas;
// `h` = { hex, mix, shade }): the three switched rails, each in an off and an on look, and the Slime and Honey Blocks.
// The rails run along the texture's v axis like the plain Rail's.

const clear = (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0); };

/** Wooden sleepers under two rails; the rails' colours and what lies between them differ per kind. */
function track(c, h, rail, railLight, between) {
  clear(c);
  const wood = h.hex('#6a4a2a'), woodD = h.hex('#4a321c');
  for (let y = 1; y < 16; y += 3) for (let x = 1; x < 15; x++) { c.set(x, y, x % 4 ? wood : woodD); c.set(x, y + 1, woodD); }
  for (let y = 0; y < 16; y++) { c.set(3, y, h.hex(rail)); c.set(4, y, h.hex(railLight)); c.set(11, y, h.hex(rail)); c.set(12, y, h.hex(railLight)); }
  if (between) between(c, h);
}

/** Powered Rail: golden rails with a rod between them (dull when off, glowing red when on). */
function poweredRail(c, h, on) {
  track(c, h, '#c8a02a', '#f0d060', (cc) => {
    const rod = on ? ['#ff5a3a', '#e02a18'] : ['#6a4a3a', '#4a3028'];
    for (let y = 0; y < 16; y += 4) for (let x = 6; x < 10; x++) { cc.set(x, y, h.hex(rod[0])); cc.set(x, y + 1, h.hex(rod[1])); }
  });
}
/** Detector Rail: iron rails with a pressure pad in the middle (it glows when a cart is on it). */
function detectorRail(c, h, on) {
  track(c, h, '#a8a8ac', '#d8d8dc', (cc) => {
    for (let y = 4; y < 12; y++) for (let x = 5; x < 11; x++) {
      const edge = y === 4 || y === 11 || x === 5 || x === 10;
      cc.set(x, y, on ? h.shade(h.hex(edge ? '#a82a1a' : '#e8452a'), 0.9 + cc.h(x, y) * 0.2) : h.shade(h.hex(edge ? '#4a4a4e' : '#6a6a70'), 0.9 + cc.h(x, y) * 0.2));
    }
  });
}
/** Activator Rail: iron rails with a pair of cinnabar studs (dark when off, bright when on). */
function activatorRail(c, h, on) {
  track(c, h, '#8a8a90', '#b8b8c0', (cc) => {
    const stud = on ? ['#ff6a4a', '#d02a18'] : ['#5a2a24', '#3a1a16'];
    for (const y of [3, 10]) for (let dy = 0; dy < 3; dy++) for (let x = 6; x < 10; x++) cc.set(x, y + dy, h.hex(dy === 2 ? stud[1] : stud[0]));
  });
}

export const AUTOMATION_TEX = {
  powered_rail: (c, h) => poweredRail(c, h, false),
  powered_rail_on: (c, h) => poweredRail(c, h, true),
  detector_rail: (c, h) => detectorRail(c, h, false),
  detector_rail_on: (c, h) => detectorRail(c, h, true),
  activator_rail: (c, h) => activatorRail(c, h, false),
  activator_rail_on: (c, h) => activatorRail(c, h, true),
  // a glassy green cube: a darker rim round a paler core with a few bubbles
  slime_block: (c, h) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const rim = x < 2 || y < 2 || x > 13 || y > 13;
      const col = rim ? h.shade(h.mix(h.hex('#4aa83a'), h.hex('#5ac048'), c.h(x, y, 2)), 0.9) : h.mix(h.hex('#7ad45a'), h.hex('#9ae878'), c.h(x >> 1, y >> 1, 4));
      c.set(x, y, col, rim ? 235 : 175);
    }
    for (const [x, y] of [[5, 5], [6, 5], [10, 9], [9, 10], [4, 11]]) c.set(x, y, h.hex('#d8ffc0'), 210);
  },
  // amber and ribbed like a honeycomb seen through glass
  honey_block: (c, h) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const rim = x < 2 || y < 2 || x > 13 || y > 13;
      const cell = ((x + (y >> 2 & 1) * 2) % 4 === 0) || y % 4 === 0;
      const col = rim ? h.shade(h.hex('#d88a12'), 0.9 + c.h(x, y) * 0.2) : cell ? h.mix(h.hex('#e8a020'), h.hex('#f0b030'), c.h(x, y)) : h.mix(h.hex('#f8c040'), h.hex('#ffd860'), c.h(x >> 1, y >> 1, 3));
      c.set(x, y, col, rim ? 240 : 205);
    }
  },
};
