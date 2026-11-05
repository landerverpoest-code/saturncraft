// Pictures for the Field Guide, drawn on small 2D canvases (no WebGL, nothing per frame):
//  * a creature's side (or, for upright ones, front) view, painted from the same box model the game renders (mobs/models.js)
//  * a structure's map glyph in its map colour (world/landmarkKinds.js)
// Undiscovered entries are shown as silhouettes by the stylesheet (a brightness filter on the image).
import { MODELS } from '../mobs/models.js';

const SIZE = 56;

/**
 * The boxes of a model seen from the side (facing left), scaled to fit a unit square:
 * [{ x, y, w, h, color, alpha }] with y down. `spec` is a MODELS entry ({ parts }); returns [] for none.
 */
export function modelRects(spec) {
  const parts = spec && spec.parts ? spec.parts : [];
  if (!parts.length) return [];
  // side view (along z, facing left) for long animals; front view (along x) for upright ones whose sides are wider than they are long
  const span = (axis) => {
    const lo = Math.min(...parts.map(([, sz, pv, of]) => pv[axis] + of[axis] - sz[axis] / 2)), hi = Math.max(...parts.map(([, sz, pv, of]) => pv[axis] + of[axis] + sz[axis] / 2));
    return hi - lo;
  };
  const axis = span(0) > span(2) ? 0 : 2;
  const boxes = parts.map(([, size, pivot, offset, color, opts = {}]) => {
    const cz = pivot[axis] + offset[axis], cy = pivot[1] + offset[1];
    return { x0: cz - size[axis] / 2, x1: cz + size[axis] / 2, y0: cy - size[1] / 2, y1: cy + size[1] / 2, color, alpha: opts.gear ? 0 : opts.alpha || 1 }; // (tack and armour parts only show on a wearer: invisible in the picture)
  });
  const minX = Math.min(...boxes.map((b) => b.x0)), maxX = Math.max(...boxes.map((b) => b.x1));
  const minY = Math.min(...boxes.map((b) => b.y0)), maxY = Math.max(...boxes.map((b) => b.y1));
  const big = Math.max(maxX - minX, maxY - minY, 1);
  const ox = (big - (maxX - minX)) / 2, oy = (big - (maxY - minY)) / 2; // centred
  return boxes.map((b) => ({ x: (b.x0 - minX + ox) / big, y: (maxY - b.y1 + oy) / big, w: (b.x1 - b.x0) / big, h: (b.y1 - b.y0) / big, color: b.color, alpha: b.alpha }));
}

const cache = new Map();
function canvasUrl(key, draw) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  draw(c.getContext('2d'));
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

/** Data URL of a creature's picture (a model drawn from the side; a plain box of its size when it has no model). */
export function creatureIcon(type, def) {
  return canvasUrl('mob:' + type, (ctx) => {
    const pad = 4, area = SIZE - pad * 2;
    let rects = modelRects(MODELS[type]);
    if (!rects.length) {
      const w = (def && def.width) || 0.8, h = (def && def.height) || 0.8, m = Math.max(w, h);
      rects = [{ x: (1 - w / m) / 2, y: 1 - h / m, w: w / m, h: h / m, color: '#8a8a8a', alpha: 1 }];
    }
    for (const r of rects) {
      ctx.globalAlpha = r.alpha;
      ctx.fillStyle = r.color;
      ctx.fillRect(Math.round(pad + r.x * area), Math.round(pad + r.y * area), Math.max(1, Math.round(r.w * area)), Math.max(1, Math.round(r.h * area)));
    }
    ctx.globalAlpha = 1;
  });
}

/** Data URL of a structure's glyph (`shape` as in LANDMARK_KINDS) in its colour, on a dark disc. */
export function structureIcon(shape, color) {
  return canvasUrl(`lm:${shape}:${color}`, (ctx) => {
    const s = SIZE;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color; ctx.strokeStyle = '#1c1c1c'; ctx.lineWidth = 2;
    const poly = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); ctx.stroke(); };
    const c = s / 2;
    if (shape === 'house') poly([[12, 30], [c, 12], [44, 30], [40, 30], [40, 44], [16, 44], [16, 30]]);
    else if (shape === 'diamond') poly([[c, 8], [46, c], [c, 48], [10, c]]);
    else if (shape === 'dome') { ctx.beginPath(); ctx.arc(c, 40, 18, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else if (shape === 'tower') poly([[20, 46], [20, 20], [16, 20], [16, 10], [22, 10], [22, 14], [27, 14], [27, 10], [33, 10], [33, 14], [38, 14], [38, 20], [34, 20], [34, 46]]);
    else if (shape === 'boat') poly([[8, 34], [48, 34], [40, 46], [16, 46]]);
    else if (shape === 'star') {
      const pts = [];
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 9 : 20; pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r]); }
      poly(pts);
    } else if (shape === 'pyramid') poly([[c, 8], [48, 44], [8, 44]]);
    else poly([[14, 14], [42, 14], [42, 42], [14, 42]]);
  });
}
