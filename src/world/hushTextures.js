// Procedural pixel art for the Deep Hush (world/deepHush.js): near-black teal
// Hushmoss with bright cyan specks (the terrain shader makes the specks pulse,
// see render/terrainMaterial.js PULSE), veins, sensors, shriekers and the
// catalyst. `h` = { hex, mix, shade } (see world/textures.js).

const BASE = '#0b2a32', DEEP = '#061a20', SPECK = '#3ef2e4', SPECK_LO = '#1fa8a8';

/** Dark mossy ground with a scatter of glowing specks (about one pixel in nine). */
function moss(c, h, speckRate = 0.11) {
  const base = h.hex(BASE), deep = h.hex(DEEP), sp = h.hex(SPECK), lo = h.hex(SPECK_LO);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = c.h(x >> 2, y >> 2, 51) * 0.5 + c.h(x >> 1, y >> 1, 52) * 0.3 + c.h(x, y, 53) * 0.2;
    let col = h.shade(h.mix(deep, base, n), 0.85 + c.h(x, y, 54) * 0.3);
    const s = c.h(x, y, 55);
    if (s < speckRate * 0.45) col = sp;
    else if (s < speckRate) col = h.mix(lo, base, 0.3);
    c.set(x, y, col);
  }
}

/** Bone-white with grey cracks (shrieker jaws, the catalyst's frame). */
function bone(c, h, x, y) {
  const crack = c.h(x, y, 61) < 0.08 || (x + y * 3) % 11 === 0;
  return h.shade(h.hex(crack ? '#9a9688' : '#ddd8c4'), 0.9 + c.h(x, y, 62) * 0.12);
}

export const HUSH_TEX = {
  hushmoss: (c, h) => moss(c, h),
  // a thin, lacy film of moss with holes in it
  hush_vein: (c, h) => {
    moss(c, h, 0.16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = c.h(x >> 1, y >> 1, 56) * 0.6 + c.h(x, y, 57) * 0.4;
      if (n > 0.62) c.set(x, y, [0, 0, 0], 0);
    }
  },
  // sensor: a mossy slab whose top shows a ring of specks round a darker heart
  hush_sensor_top: (c, h) => {
    moss(c, h, 0.05);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      if (r < 2.5) c.set(x, y, h.hex('#03100f'));
      else if (r < 4.2 && c.h(x, y, 58) < 0.5) c.set(x, y, h.hex(SPECK));
    }
  },
  // calibrated sensor: the same top with four violet tuning studs at its corners and a bright rim on the ring
  calibrated_sensor_top: (c, h) => {
    HUSH_TEX.hush_sensor_top(c, h);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const stud = (x < 4 || x > 11) && (y < 4 || y > 11) && Math.hypot((x < 8 ? 1.5 : 14.5) - x, (y < 8 ? 1.5 : 14.5) - y) < 2.1;
      if (stud) c.set(x, y, h.shade(h.hex('#b27aff'), 0.85 + c.h(x, y, 66) * 0.3));
      else if (Math.abs(Math.hypot(x - 7.5, y - 7.5) - 5.2) < 0.55) c.set(x, y, h.hex('#7a4fc8'));
    }
  },
  hush_sensor_side: (c, h) => {
    moss(c, h, 0.06);
    for (let x = 0; x < 16; x++) { c.set(x, 8, h.hex('#14424a')); if (x % 3 === 1) c.set(x, 9, h.hex(SPECK_LO)); }
  },
  // the tendrils: pale stalks with a glowing tip, brighter cinnabar-red while the sensor pulses
  hush_tendril: (c, h) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, y < 4 ? h.hex(SPECK) : h.shade(h.hex('#1e5a62'), 0.85 + c.h(x, y, 59) * 0.25)); },
  hush_tendril_active: (c, h) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, y < 4 ? h.hex('#ff5a3a') : h.shade(h.hex('#e8f8ff'), 0.85 + c.h(x, y, 59) * 0.2)); },
  // shrieker: a mossy base under a jaw of bone; the open top shows a dark throat with specks
  hush_shrieker_top: (c, h) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      c.set(x, y, r > 6 ? bone(c, h, x, y) : c.h(x, y, 63) < 0.08 ? h.hex(SPECK) : h.shade(h.hex('#020a0c'), 0.8 + c.h(x, y, 64) * 0.4));
    }
  },
  hush_shrieker_side: (c, h) => { moss(c, h, 0.07); for (let x = 0; x < 16; x++) c.set(x, 8, h.hex('#14424a')); },
  hush_shrieker_bone: (c, h) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, bone(c, h, x, y)); },
  // catalyst: a cage of bone round a glowing teal heart, moss creeping up from below
  hush_catalyst_side: (c, h) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const frame = x < 2 || x > 13 || y < 2 || y % 5 === 2;
      const core = Math.hypot(x - 7.5, y - 8.5) < 3.2;
      let col = frame ? bone(c, h, x, y) : core ? h.mix(h.hex('#9afff4'), h.hex(SPECK), Math.hypot(x - 7.5, y - 8.5) / 3.2) : h.hex(DEEP);
      if (y > 12 && c.h(x, y, 65) < (y - 12) / 4) col = h.hex(BASE);
      c.set(x, y, col);
    }
  },
  hush_catalyst_top: (c, h) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      c.set(x, y, r < 3 ? h.mix(h.hex('#c8fff8'), h.hex(SPECK), r / 3) : (x + y) % 4 === 0 || r > 6.5 ? bone(c, h, x, y) : h.hex(DEEP));
    }
  },
  hush_catalyst_bottom: (c, h) => moss(c, h, 0.04),
};

/** Tiles whose bright specks pulse in the terrain shader. */
export const HUSH_PULSE = ['hushmoss', 'hush_vein', 'hush_sensor_top', 'calibrated_sensor_top', 'hush_sensor_side', 'hush_shrieker_side', 'hush_shrieker_top', 'hush_tendril', 'hush_catalyst_side', 'hush_catalyst_top', 'hush_catalyst_bottom'];
