// Hand-authored 16x16 pixel art for tools, weapons and a few gear items.
// Pure (no DOM): returns a 16x16 grid of [r,g,b] (or null) so it can be
// rendered onto a canvas by icons.js or inspected in tests.
//
// Template alphabet (each char = a palette group + a shading mode):
//   head group (material):  h auto  H light  m mid  d shadow  x outline  e extra-bright glint
//   handle group (wood):    # auto  w light  s shadow  k outline
//   accent group:           a auto  A light  b shadow
//   string group:           q auto  Q light
// "auto" picks the highlight on pixels whose top/left neighbour is empty, the
// shadow on pixels whose bottom/right neighbour is empty, and mid otherwise.
// Afterwards every empty pixel touching a filled one gets that group's dark
// outline colour, so each shape reads with a crisp 1px border.

const CH = {
  h: ['head', 'auto'], H: ['head', 'hi'], m: ['head', 'mid'], d: ['head', 'lo'], x: ['head', 'out'], e: ['head', 'glint'],
  '#': ['wood', 'auto'], w: ['wood', 'hi'], s: ['wood', 'lo'], k: ['wood', 'out'],
  a: ['acc', 'auto'], A: ['acc', 'hi'], b: ['acc', 'lo'],
  q: ['str', 'auto'], Q: ['str', 'hi'],
};
// outline priority when an empty pixel touches several groups
const OUTLINE_ORDER = ['head', 'acc', 'wood']; // the bow string stays unoutlined

export const TOOL_TEMPLATES = {
  pickaxe: [
    '................',
    '.....hhhhh......',
    '...hhhhhhhhh....',
    '..hhh.....hhh...',
    '..hh......aahh..',
    '.........#aahh..',
    '.........##..hh.',
    '........##...hh.',
    '.......##....hh.',
    '......##.....hh.',
    '.....##......hh.',
    '....##......hh..',
    '...##......hhh..',
    '..##.......hh...',
    '.##.............',
    '................',
  ],
  axe: [
    '................',
    '...eh...........',
    '...ehhh......##.',
    '...ehhhhhhhh##..',
    '...ehhhhhhhh#...',
    '...ehhhhhhh#....',
    '...ehhh..##.....',
    '...eh...##......',
    '.......##.......',
    '......##........',
    '.....##.........',
    '....##..........',
    '...##...........',
    '..##............',
    '.##.............',
    '................',
  ],
  shovel: [
    '................',
    '...........hhh..',
    '..........hhhhh.',
    '.........hhhhhh.',
    '........hhhhhh..',
    '........hhhhh...',
    '.........aa.....',
    '........##......',
    '.......##.......',
    '......##........',
    '.....##.........',
    '....##..........',
    '...##...........',
    '..##............',
    '.##.............',
    '................',
  ],
  hoe: [
    '................',
    '.......hhhhh....',
    '......hhhhhhh...',
    '.....hhh...aahh.',
    '.....hh...#aahh.',
    '.........##.....',
    '........##......',
    '.......##.......',
    '......##........',
    '.....##.........',
    '....##..........',
    '...##...........',
    '..##............',
    '.##.............',
    '................',
    '................',
  ],
  sword: [
    '................',
    '.............hh.',
    '...........hhhh.',
    '..........hhhh..',
    '.........hhh....',
    '........hhh.....',
    '.......hhh......',
    '......hhh.......',
    '...a.hhh........',
    '...aahh.........',
    '....aaa.........',
    '...##aa.........',
    '..##..a.........',
    '.aa.............',
    '.aa.............',
    '................',
  ],
};

export const GEAR_TEMPLATES = {
  bow: [
    '................',
    '........####w...',
    '......###...q...',
    '....aa#....q....',
    '...#aa....q.....',
    '...##....q......',
    '..##....q.......',
    '..#....q........',
    '.##...q.........',
    '.#...q..........',
    '.#..q...........',
    '.#.q............',
    '.wq.............',
    '................',
    '................',
    '................',
  ],
  shears: [
    '................',
    '................',
    '...........h....',
    '..........hh..h.',
    '.........hh..hh.',
    '........hh.hhh..',
    '.......hhhhhh...',
    '......hhhhh.....',
    '..aaaahh........',
    '.a...ab.........',
    '.a..a.aaa.......',
    '..aa.a...a......',
    '.....a...a......',
    '......aaa.......',
    '................',
    '................',
  ],
  igniter: [
    '................',
    '................',
    '..hhhhh.........',
    '.hhhhhhh........',
    '.hh...hh........',
    '.hh.............',
    '.hh...hh........',
    '..hhhhh.........',
    '..........aa....',
    '........aaaaa...',
    '.......aaaaaa...',
    '......aaaaaaaa..',
    '.......aaaaaa...',
    '........aaaa....',
    '................',
    '................',
  ],
  arrow: [
    '................',
    '..........hhhh..',
    '...........hhh..',
    '...........#hh..',
    '..........#..h..',
    '.........#......',
    '........#.......',
    '.......#........',
    '......#.........',
    '...aa#..........',
    '..aa#a..........',
    '.aa#aa..........',
    '..#aa...........',
    '.#..............',
    '................',
    '................',
  ],
};

// ---- colour helpers --------------------------------------------------------
export function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a, b, t) => a.map((v, i) => clamp(v + (b[i] - v) * t));
const mul = (a, f) => a.map((v) => clamp(v * f));

/** Highlight / mid / shadow / outline ramp derived from one base colour.
 *  Shadows drift toward a cool purple-brown and highlights toward warm white,
 *  which keeps the ramp lively instead of a flat brightness scale. */
export function ramp(hex, opts = {}) {
  const c = hexRgb(hex);
  const hi = mix(c, [255, 252, 240], opts.hiMix ?? 0.45);
  const lo = mix(mul(c, 0.72), [40, 30, 60], 0.08);
  const out = mix(mul(c, 0.32), [24, 14, 28], 0.35);
  return { hi, mid: c, lo, out, glint: mix(c, [255, 255, 255], 0.8), speckle: !!opts.speckle };
}

export const WOOD_HANDLE = { hi: hexRgb('#a97f4a'), mid: hexRgb('#8b6535'), lo: hexRgb('#654520'), out: hexRgb('#2c1c0c'), glint: hexRgb('#c9a06a') };

// per-material head ramps; derived from the material colour with small tweaks
export function materialRamp(name, hex) {
  if (name === 'wood') return ramp('#b48a52', { hiMix: 0.35 });
  if (name === 'stone') return ramp(hex, { hiMix: 0.4, speckle: true });
  if (name === 'iron') return { ...ramp('#c8c8c8', { hiMix: 0.7 }), lo: hexRgb('#8e8e94') };
  if (name === 'gold') {
    const r = ramp(hex, { hiMix: 0.6 });
    return { ...r, lo: hexRgb('#c8901e'), out: hexRgb('#5a3608') };
  }
  if (name === 'diamond') {
    const r = ramp('#4fd8d0', { hiMix: 0.65 });
    return { ...r, lo: hexRgb('#1f9c9a'), out: hexRgb('#0a3438') };
  }
  return ramp(hex);
}

/**
 * Paint a template into a 16x16 grid of colours.
 * @param {string[]} tpl 16 strings of 16 chars
 * @param {{head?:object, wood?:object, acc?:object, str?:object}} pal ramps per group
 */
export function paintTemplate(tpl, pal) {
  const W = 16;
  const grp = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= W) return null;
    const c = CH[tpl[y][x]];
    return c ? c[0] : null;
  };
  const filled = (x, y) => grp(x, y) !== null;
  const grid = [];
  for (let y = 0; y < W; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      const c = CH[tpl[y][x]];
      if (!c) { row.push(null); continue; }
      const [g, mode] = c;
      const p = pal[g] || WOOD_HANDLE;
      let tone = mode;
      if (mode === 'auto') {
        if (!filled(x, y - 1) || !filled(x - 1, y)) tone = 'hi';
        else if (!filled(x, y + 1) || !filled(x + 1, y)) tone = 'lo';
        else tone = 'mid';
      }
      let col = { hi: p.hi, mid: p.mid, lo: p.lo, out: p.out, glint: p.glint }[tone];
      if (p.speckle && tone !== 'out') {
        // deterministic stone speckle: darken some pixels, lighten a few
        const n = (x * 7 + y * 13 + x * y) % 7;
        if (n === 0) col = tone === 'lo' ? p.out : p.lo;
        else if (n === 3 && tone !== 'hi') col = mix(p.mid, p.hi, 0.5);
      }
      row.push(col);
    }
    grid.push(row);
  }
  // 1px outline around every shape
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    if (grid[y][x]) continue;
    const gs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => grp(x + dx, y + dy)).filter(Boolean);
    if (!gs.length) continue;
    const g = OUTLINE_ORDER.find((o) => gs.includes(o));
    grid[y][x] = (pal[g] || WOOD_HANDLE).out;
  }
  return grid;
}
