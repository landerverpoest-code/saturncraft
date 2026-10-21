// Paintings: original, procedurally painted pictures hung on walls. Each one
// is a group of PAINTING blocks (id PAINTING for arts 0-3, PAINTING_B for
// 4-7): meta bits 0-1 the wall side, 2-5 the part (row-major from the top
// left as seen from the front), 6-7 the art's low bits. Breaking any part
// takes the whole painting down; only part 0 drops the item.
import { B, SOLID, OPAQUE } from './blocks.js';
import { SIDE_DIRS } from './shapes.js';

// [key, width, height] in blocks
export const ARTS = [
  ['three_suns', 1, 1], ['ringed_moon', 1, 1], ['dunes', 2, 1], ['harbour', 2, 1],
  ['peaks', 2, 2], ['forest', 2, 2], ['shoreline', 4, 2], ['sky_city', 4, 3],
];
export const artOf = (id, meta) => (id === B.PAINTING_B ? 4 : 0) + ((meta >> 6) & 3);
export const partOf = (meta) => (meta >> 2) & 15;
export const isPainting = (id) => id === B.PAINTING || id === B.PAINTING_B;
const blockFor = (art) => (art >= 4 ? B.PAINTING_B : B.PAINTING);
const metaFor = (art, part, side) => ((art & 3) << 6) | (part << 2) | side;

/** Viewer's right along a wall at `side` (looking at the wall). */
export function rightOf(side) { const [dx, , dz] = SIDE_DIRS[side]; return [-dz, dx]; }

/** Cells of a painting: [{x,y,z,part}] given the cell of part 0's ... anchor (bottom-left) cell. */
export function paintingCells(art, side, x, y, z) {
  const [, w, h] = ARTS[art], [rx, rz] = rightOf(side), out = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push({ x: x + rx * i, y: y + j, z: z + rz * i, part: (h - 1 - j) * w + i });
  return out;
}

/** Find a place for a painting hung on the wall at `side` behind cell x,y,z: the largest art that fits, at random among equals. */
export function choosePainting(world, side, x, y, z, rng = Math.random) {
  const [dx, , dz] = SIDE_DIRS[side], [rx, rz] = rightOf(side);
  const fits = [];
  ARTS.forEach(([, w, h], art) => {
    // the clicked cell sits in the lower middle of the picture
    const ai = Math.floor((w - 1) / 2), aj = Math.floor((h - 1) / 2);
    const bx = x - rx * ai, by = y - aj, bz = z - rz * ai;
    const ok = paintingCells(art, side, bx, by, bz).every((c) => {
      const here = world.getBlock(c.x, c.y, c.z), wall = world.getBlock(c.x + dx, c.y, c.z + dz);
      return here === B.AIR && SOLID[wall] && OPAQUE[wall];
    });
    if (ok) fits.push({ art, x: bx, y: by, z: bz, area: w * h });
  });
  if (!fits.length) return null;
  const best = Math.max(...fits.map((f) => f.area));
  const top = fits.filter((f) => f.area === best);
  return top[Math.floor(rng() * top.length)];
}

/** Hang a painting (from choosePainting). */
export function placePainting(world, side, p, setBlock) {
  for (const c of paintingCells(p.art, side, p.x, p.y, p.z)) setBlock(c.x, c.y, c.z, blockFor(p.art), metaFor(p.art, c.part, side));
}

/** Is this painting part still whole: wall behind it and every neighbouring part in place? */
export function paintingIntact(world, x, y, z, id, meta) {
  const side = meta & 3, art = artOf(id, meta), part = partOf(meta);
  const [, w, h] = ARTS[art], [dx, , dz] = SIDE_DIRS[side], [rx, rz] = rightOf(side);
  const wall = world.getBlock(x + dx, y, z + dz);
  if (!(SOLID[wall] && OPAQUE[wall])) return false;
  const i = part % w, row = Math.floor(part / w); // row 0 is the top
  const check = (ni, nrow) => {
    if (ni < 0 || ni >= w || nrow < 0 || nrow >= h) return true;
    const nx = x + rx * (ni - i), ny = y + (row - nrow), nz = z + rz * (ni - i);
    const nid = world.getBlock(nx, ny, nz), nm = world.getMeta(nx, ny, nz);
    return isPainting(nid) && artOf(nid, nm) === art && (nm & 3) === side && partOf(nm) === nrow * w + ni;
  };
  return check(i - 1, row) && check(i + 1, row) && check(i, row - 1) && check(i, row + 1);
}

// ---- the pictures (original procedural art) -------------------------------------
const hex = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => a.map((v, k) => Math.round(v + (b[k] - v) * t));
function rnd(seed) { let s = seed | 0; return () => { s = (s * 1103515245 + 12345) | 0; return ((s >>> 16) & 0x7fff) / 0x7fff; }; }

/** RGBA pixels (16 per block) of a whole picture with a dark wooden frame. */
export function paintArt(art) {
  const [key, w, h] = ARTS[art], W = w * 16, H = h * 16;
  const px = new Uint8ClampedArray(W * H * 4), r = rnd(art * 7919 + 13);
  const set = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
  const sky = (top, bot) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, mix(hex(top), hex(bot), y / H)); };
  const disc = (cx, cy, rad, c) => { for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) set(x, y, c); };
  const ridge = (base, amp, freq, c, ph = 0) => { for (let x = 0; x < W; x++) { const top = Math.round(base + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 2.7 + ph * 2) * amp * 0.4); for (let y = top; y < H; y++) set(x, y, mix(hex(c), [0, 0, 0], ((y - top) / H) * 0.4)); } };
  switch (key) {
    case 'three_suns': sky('#2a1a4a', '#e8804a'); disc(4, 9, 2, hex('#ffe08a')); disc(9, 7, 1.5, hex('#ffb070')); disc(12, 10, 1, hex('#ff8a8a')); ridge(12, 1, 0.5, '#2a1a2a'); break;
    case 'ringed_moon': sky('#06081a', '#1a2050'); disc(8, 8, 4, hex('#d8c8a0')); for (let x = 1; x < 15; x++) set(x, 8 + Math.round((x - 8) * 0.25), hex('#f0e6c8')); for (let k = 0; k < 8; k++) set(Math.floor(r() * 16), Math.floor(r() * 16), hex('#ffffff')); break;
    case 'dunes': sky('#6ab0e8', '#f0d8a0'); disc(26, 4, 2.5, hex('#fff2b0')); ridge(9, 2, 0.2, '#e0b060'); ridge(12, 1.5, 0.3, '#c8904a', 2); break;
    case 'harbour': sky('#8ac8f0', '#d8eef8'); for (let y = 9; y < 16; y++) for (let x = 0; x < W; x++) set(x, y, mix(hex('#2a6ab0'), hex('#1a3a7a'), (y - 9) / 7)); for (let k = 0; k < 4; k++) { const bx = 3 + k * 7; for (let x = bx; x < bx + 4; x++) set(x, 9, hex('#6a4a2a')); for (let y = 4; y < 9; y++) set(bx + 2, y, hex('#e8e8e0')); set(bx + 1, 6, hex('#e8e8e0')); set(bx + 3, 6, hex('#e8e8e0')); } break;
    case 'peaks': sky('#7ab8e8', '#e8f0f8'); ridge(10, 6, 0.25, '#6a7080'); for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { const i = (y * W + x) * 4; if (px[i] === 106 && y < 12) set(x, y, hex('#f4f8ff')); } ridge(22, 2, 0.4, '#3a7a3a', 1); break;
    case 'forest': sky('#a8d8f0', '#e0f0d8'); ridge(24, 1, 0.3, '#3a6a2a'); for (let k = 0; k < 9; k++) { const tx = 2 + k * 3.5 + r() * 2, th = 8 + r() * 10; for (let y = 0; y < th; y++) { const wdt = Math.max(0, (y / th) * 3); for (let x = -wdt; x <= wdt; x++) set(Math.round(tx + x), Math.round(24 - th + y), mix(hex('#1e5a2a'), hex('#2e8a3a'), r())); } for (let y = 24; y < 28; y++) set(Math.round(tx), y, hex('#5a3a1e')); } break;
    case 'shoreline': sky('#f0a070', '#f8d8a8'); disc(44, 12, 5, hex('#fff0c0')); for (let y = 16; y < H; y++) for (let x = 0; x < W; x++) set(x, y, mix(hex('#3a7ab0'), hex('#1a3a6a'), (y - 16) / 16)); ridge(22, 3, 0.12, '#e8d090'); ridge(27, 2, 0.15, '#c8a860', 3); break;
    default: sky('#1a1040', '#8a5aa8'); disc(48, 10, 6, hex('#e8e0ff')); for (let k = 0; k < 10; k++) { const bx = Math.floor(k * 6.4), bh = 10 + Math.floor(r() * 22); for (let y = H - bh; y < H; y++) for (let x = bx; x < bx + 5; x++) set(x, y, (y + x) % 4 === 0 && r() < 0.5 ? hex('#ffd870') : hex('#2a2048')); } break;
  }
  // frame
  for (let x = 0; x < W; x++) { set(x, 0, hex('#4a2e16')); set(x, H - 1, hex('#3a2410')); }
  for (let y = 0; y < H; y++) { set(0, y, hex('#4a2e16')); set(W - 1, y, hex('#3a2410')); }
  return { px, W, H };
}

const artCache = new Map();
/** RGBA of one 16x16 part of a picture. */
export function paintingPart(art, part) {
  if (!artCache.has(art)) artCache.set(art, paintArt(art));
  const { px, W } = artCache.get(art), w = ARTS[art][1];
  const ox = (part % w) * 16, oy = Math.floor(part / w) * 16, out = new Uint8ClampedArray(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) for (let k = 0; k < 4; k++) out[(y * 16 + x) * 4 + k] = px[((oy + y) * W + ox + x) * 4 + k];
  return out;
}

export { blockFor as paintingBlock };
