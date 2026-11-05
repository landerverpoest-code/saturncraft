// Procedural textures for the Cooking Pot, the new crops (Frostroots, Dewberry Bramble, Sungourd) and tired farmland.
// Merged into textures.js like the other texture modules; each painter gets (canvas, { hex, mix, shade }).
// (world/cookingPot.js, world/farming.js)

const clear = (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, [0, 0, 0], 0); };

/** Frostroots stage 0..3: a tuft of frosted blue-green leaves; the ripe stage shows a lavender root in the soil. */
function frostroot(c, { hex, shade }, stage) {
  clear(c);
  const leaf = hex('#5fa89a'), dark = hex('#3a7a74'), rime = hex('#d8f0ec'), root = hex('#b9a4e4');
  const h = 3 + stage * 3.5;
  for (const sx of [3, 8, 12]) {
    for (let k = 0; k < h; k++) {
      const y = 15 - k, w = k > h * 0.45 ? 2 : 1;
      for (let dx = -w; dx <= w; dx++) {
        if (c.h(sx + dx, y, 61) > 0.78) continue;
        const frost = k > h * 0.6 && c.h(sx + dx, y, 62) < 0.3;
        c.set(sx + dx, y, frost ? rime : dx === 0 ? dark : shade(leaf, 0.8 + c.h(dx, k, 63) * 0.35));
      }
    }
  }
  if (stage === 3) for (const sx of [3, 8, 12]) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) c.set(sx - 1 + dx, 15 - dy, shade(root, 0.85 + c.h(dx, dy, 64) * 0.3));
}

/** Dewberry Bramble stage 0..3: thorny canes that grow taller; green berries at 2, indigo ripe ones at 3. */
function bramble(c, { hex, shade }, age) {
  clear(c);
  const top = [12, 8, 5, 3][age], cane = hex('#4a3a2e'), leaf = hex('#2f6a3a');
  for (const sx of [4, 8, 11]) for (let y = top + (sx % 3); y < 16; y++) {
    const x = sx + Math.round(Math.sin(y * 0.8 + sx) * 1.2);
    c.set(x, y, shade(cane, 0.85 + c.h(x, y, 65) * 0.3));
  }
  for (let y = top; y < 16; y++) for (let x = 1; x < 15; x++) {
    const w = (16 - y) / (16 - top);
    if (Math.abs(x - 7.5) > 7 * Math.min(1, 0.35 + w) || c.h(x, y, 66) > 0.5) continue;
    c.set(x, y, shade(leaf, 0.75 + c.h(x, y, 67) * 0.45));
  }
  if (age >= 2) for (let k = 0; k < (age === 3 ? 10 : 5); k++) {
    const x = 2 + Math.floor(c.h(k, 0, 68) * 11), y = top + 1 + Math.floor(c.h(k, 1, 69) * (13 - top));
    const col = age === 3 ? hex('#3a3fa8') : hex('#8aa84a');
    c.set(x, y, col); c.set(x + 1, y, shade(col, 0.8)); c.set(x, y + 1, shade(col, 0.7));
    if (age === 3) c.set(x, y, hex('#6a70e0'));
  }
}

export const COOKING_TEX = {
  // Cooking Pot: black iron with a rim and two rivets; the top is a dark ring round an empty bowl
  cooking_pot_side: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#33343a'), 0.9 + c.h(x, y, 71) * 0.18));
    for (let x = 0; x < 16; x++) { c.set(x, 0, hex('#4a4b54')); c.set(x, 1, hex('#5a5b66')); c.set(x, 15, hex('#222328')); }
    for (const x of [3, 12]) { c.set(x, 4, hex('#6a6b76')); c.set(x + 1, 4, hex('#2a2b30')); }
  },
  cooking_pot_bottom: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#26272c'), 0.9 + c.h(x, y, 72) * 0.15));
  },
  cooking_pot_top: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const e = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      c.set(x, y, e > 5.8 ? shade(hex('#5a5b66'), 0.95 + c.h(x, y, 73) * 0.1) : shade(hex('#18191d'), 0.9 + c.h(x, y, 74) * 0.2));
    }
  },
  // what is in the pot: watery stock while it waits for a fire, a thick brown stew while it cooks and when it is ready
  cooking_pot_stock: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, shade(hex('#8a9a62'), 0.88 + c.h(x, y, 75) * 0.2 + (((x + y) & 3) === 0 ? 0.06 : 0)));
  },
  cooking_pot_stew: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const bit = c.h(x, y, 76);
      c.set(x, y, bit < 0.12 ? hex('#d8a24a') : bit < 0.2 ? hex('#6a8a3a') : shade(hex('#9a5a2c'), 0.88 + c.h(x >> 1, y >> 1, 77) * 0.2));
    }
  },
  // Sungourd: a ribbed, warm gold gourd with a woody stem scar on top
  sungourd_side: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const rib = (x % 4) === 3 ? 0.78 : (x % 4) === 0 ? 1.1 : 1;
      c.set(x, y, shade(hex('#e0a42a'), rib * (0.92 + c.h(x, y, 78) * 0.12)));
    }
  },
  sungourd_top: (c, { hex, shade }) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      c.set(x, y, r < 2.2 ? hex('#6a5a2a') : shade(hex('#d89a22'), r % 4 < 1.4 ? 0.82 : 1 + c.h(x, y, 79) * 0.08));
    }
  },
  // tired farmland: paler, dusty soil with fine cracks (a crop of the same kind was just taken from it)
  farmland_tired: (c, { hex, shade }) => {
    c.noiseFill(['#8a7556', '#97805e', '#7d6a4e', '#a28a66'].map(hex), 0.3);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (y % 4 === 3) c.set(x, y, shade(c.get(x, y), 0.78));
      if (c.h(x, y, 80) < 0.07) c.set(x, y, shade(c.get(x, y), 0.6));
    }
  },
  farmland_tired_moist: (c, { hex, shade }) => {
    c.noiseFill(['#4f3f2b', '#5a4730', '#463826', '#62502f'].map(hex), 0.3);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (y % 4 === 3) c.set(x, y, shade(c.get(x, y), 0.78));
      if (c.h(x, y, 81) < 0.06) c.set(x, y, shade(c.get(x, y), 0.65));
    }
  },
};
for (let i = 0; i < 4; i++) {
  COOKING_TEX['frostroots_' + i] = (c, h) => frostroot(c, h, i);
  COOKING_TEX['dewberry_bramble_' + i] = (c, h) => bramble(c, h, i);
}
