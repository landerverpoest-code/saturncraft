// Procedural pixel art for the Proving Vaults (world/provingVaults.js):
// grey-green Ashstone (cut from Tuff) as bricks, tiles and polished slabs,
// copper-tinted Vault Bricks, Copper Grates you can see through, Copper Bulbs
// (dark and lit), the Proving Spawner's cage in its three moods and the Vault.
// `h` = { hex, mix, shade } (see world/textures.js).

const ASH = ['#6c6f64', '#757869', '#7e8172', '#666a5e', '#71756a'];
const COPPER = ['#b8673e', '#c8794a', '#a85a36', '#d68a58', '#9a5030'];

/** Grainy fill from a palette. */
function grain(c, h, pal, k = 1) {
  const p = pal.map(h.hex);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = c.h(x, y, k) * 0.6 + c.h(x >> 2, y >> 2, k + 1) * 0.4;
    c.set(x, y, p[Math.min(p.length - 1, Math.floor(n * p.length))]);
  }
}

/** Running-bond bricks: `rows` courses, mortar darkened from the base. */
function bricks(c, h, pal, mortar, rows = 4) {
  grain(c, h, pal, 3);
  const m = h.hex(mortar), rh = 16 / rows;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = Math.floor(y / rh), off = row & 1 ? 4 : 0;
    if (y % rh === rh - 1 || (x + off) % 8 === 7) c.set(x, y, m);
    else if (y % rh === 0) c.set(x, y, h.shade(c.get(x, y), 1.12)); // a lit top edge
  }
}

/** A bevelled square plate (polished stone, tiles). */
function plate(c, h, pal, size, edge) {
  grain(c, h, pal, 7);
  const e = h.hex(edge);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const lx = x % size, ly = y % size;
    if (lx === size - 1 || ly === size - 1) c.set(x, y, e);
    else if (lx === 0 || ly === 0) c.set(x, y, h.shade(c.get(x, y), 1.15));
  }
}

/** Copper framing round the edge of a 16 x 16 face. */
function copperFrame(c, h, width = 2) {
  const p = COPPER.map(h.hex);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.min(x, y, 15 - x, 15 - y);
    if (d < width) c.set(x, y, h.shade(p[Math.floor(c.h(x, y, 21) * p.length)], d === 0 ? 0.75 : 1.05));
  }
}

function cage(c, h, glow, barColor = '#7a4a2c', hiColor = '#e09a62') {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
  // a dim heart behind the bars shows the spawner's mood
  if (glow) for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 3.2) c.set(x, y, h.mix(h.hex(glow), [255, 255, 230], Math.max(0, 0.5 - d / 6)));
  }
  copperFrame(c, h, 2);
  const bar = h.hex(barColor), hi = h.hex(hiColor);
  for (let i = 2; i < 14; i++) for (const k of [5, 10]) { c.set(k, i, i % 3 ? bar : hi); c.set(i, k, i % 3 ? bar : hi); }
}

export const PROVING_TEX = {
  vault_bricks: (c, h) => bricks(c, h, COPPER, '#5a3220', 4),
  ashstone_bricks: (c, h) => bricks(c, h, ASH, '#45483f', 4),
  ashstone_tiles: (c, h) => plate(c, h, ASH, 8, '#4a4d43'),
  polished_ashstone: (c, h) => {
    plate(c, h, ['#7a7d70', '#808376', '#76796c'], 16, '#55584d');
    for (let i = 3; i < 13; i++) c.set(i, i, h.shade(c.get(i, i), 1.06)); // a faint sheen
  },
  copper_grate: (c, h) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0);
    const p = COPPER.map(h.hex);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15, bar = x % 4 === 0 || y % 4 === 0;
      if (edge || bar) c.set(x, y, h.shade(p[Math.floor(c.h(x, y, 31) * p.length)], edge ? 0.85 : (x + y) & 1 ? 1 : 1.12));
    }
  },
  copper_bulb: (c, h) => {
    copperFrame(c, h, 3);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) c.set(x, y, h.shade(h.hex('#4a3a2c'), 0.8 + c.h(x, y, 41) * 0.25));
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) c.set(x, y, h.hex('#6a5038'));
  },
  copper_bulb_lit: (c, h) => {
    copperFrame(c, h, 3);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      c.set(x, y, h.mix(h.hex('#ffe9a8'), h.hex('#f0a040'), Math.min(1, d / 6)));
    }
  },
  proving_spawner_top: (c, h) => cage(c, h, null),
  proving_spawner_side_0: (c, h) => cage(c, h, '#4a3a30'),  // waiting
  proving_spawner_side_1: (c, h) => cage(c, h, '#ff8a2a'),  // a wave under way
  proving_spawner_side_2: (c, h) => cage(c, h, '#3a6a8a'),  // cooling down
  // the ominous Proving Spawner: darker bars, a violet heart
  ominous_spawner_top: (c, h) => cage(c, h, null, '#4a3258', '#a77ad0'),
  ominous_spawner_side_0: (c, h) => cage(c, h, '#5a3a78', '#4a3258', '#a77ad0'),  // waiting
  ominous_spawner_side_1: (c, h) => cage(c, h, '#d040ff', '#4a3258', '#a77ad0'),  // a wave under way
  ominous_spawner_side_2: (c, h) => cage(c, h, '#3a4a9a', '#4a3258', '#a77ad0'),  // cooling down
  vault_top: (c, h) => {
    plate(c, h, ASH, 16, '#45483f');
    copperFrame(c, h, 2);
  },
  vault_side: (c, h) => {
    copperFrame(c, h, 2);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) c.set(x, y, (x + y) % 4 === 0 ? h.hex('#3e4038') : h.shade(h.hex('#5a5d52'), 0.9 + c.h(x, y, 51) * 0.2));
  },
  vault_front: (c, h) => {
    PROVING_TEX.vault_side(c, h);
    // a round copper lock with a keyhole
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 4.6) c.set(x, y, d > 3.6 ? h.hex('#7a4a2c') : h.mix(h.hex('#e09a62'), h.hex('#b8673e'), d / 4));
    }
    const k = h.hex('#1a120c');
    for (const [x, y] of [[7, 5], [8, 5], [7, 6], [8, 6], [7, 7], [8, 7], [7, 8], [8, 8], [7, 9], [8, 9], [6, 6], [9, 6]]) c.set(x, y, k);
  },
};
