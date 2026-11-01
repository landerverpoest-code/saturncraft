// Firework Stars and Star Rockets (reference: firework stars and rockets). Pure data and maths, unit tested;
// entities/skyRocket.js flies the rocket and draws the burst.
//
// The 32 item ids of world/items.js (a Firework Star and a Star Rocket per colour) stay as they were: a plain
// stack of one is still "a ball of that colour". Everything richer travels in one extra stack field, `fw`
// (kept by withExtras, canStack and the network's item/slot copies, and saved with the inventory):
//   * on a Firework Star:  { c: [dye colour indexes, 1-8], s: shape 0-4, t: trail 0/1, w: twinkle 0/1, f: [fade colours, 1-8] }
//     (`f` only when the star fades: the sparks turn from their colours to these; older games just ignore it)
//   * on a Star Rocket:    { f: flight 1-3, st: [up to 7 of those star objects] }
//   * on a plain Sky Rocket: { f: flight 1-3 }
//   * on a loaded Crossbow (CROSSBOW_LOADED): the rocket it holds, in the same form as a Star Rocket's
// The item id of a crafted star / rocket is the one of its first colour, so name and icon still fit.
import { I, DYES, FIREWORK_STARS, STAR_ROCKETS } from './items.js';
import { B } from './blocks.js';
import { COLORS } from './colors.js';

/** Burst shapes in `s` order. */
export const SHAPES = ['ball', 'large', 'star', 'burst', 'face'];
export const SHAPE_NAMES = ['Small Ball', 'Large Ball', 'Star-shaped', 'Burst', 'Fizzler Face'];
export const MAX_COLORS = 8, MAX_STARS = 7, MAX_FLIGHT = 3;
/** What turns a star's shape (one at most), and gives it the trail and twinkle effects. */
export const SHAPE_INGREDIENTS = { [I.FIRE_CHARGE]: 1, [I.GOLD_NUGGET]: 2, [I.FEATHER]: 3, [B.CARVED_PUMPKIN]: 4 };
export const TRAIL_INGREDIENT = I.DIAMOND, TWINKLE_INGREDIENT = I.GLOWSHARD_DUST;
/**
 * The fade marker: in a Firework Star's ingredients (read in the grid's reading order) the dyes after an Ink Sac are
 * the colours the sparks fade to, the dyes before it the colours they burst in.
 */
export const FADE_MARKER = I.INK_SAC;

const DYE_COLOR = new Map(DYES.map((d, c) => [d, c]));
DYE_COLOR.set(I.BONE_MEAL, 0); // white
const STAR_COLOR = new Map(FIREWORK_STARS.map((id, c) => [id, c]));
const ROCKET_COLOR = new Map(STAR_ROCKETS.map((id, c) => [id, c]));

/** Dye colour index of a dye (or bone meal) item, or -1. */
export const dyeColor = (id) => (DYE_COLOR.has(id) ? DYE_COLOR.get(id) : -1);
export const isStarItem = (id) => STAR_COLOR.has(id);

const colorOk = (c) => Number.isInteger(c) && c >= 0 && c < COLORS.length;

/** A cleaned copy of one star object (from untrusted data), or null. */
export function cleanStar(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.c)) return null;
  const c = [];
  for (const v of s.c.slice(0, MAX_COLORS)) if (colorOk(v) && !c.includes(v)) c.push(v);
  if (!c.length) return null;
  const shape = s.s | 0;
  const out = { c, s: shape >= 0 && shape < SHAPES.length ? shape : 0, t: s.t ? 1 : 0, w: s.w ? 1 : 0 };
  if (Array.isArray(s.f)) {
    const f = [];
    for (const v of s.f.slice(0, MAX_COLORS)) if (colorOk(v) && !f.includes(v)) f.push(v);
    if (f.length) out.f = f;
  }
  return out;
}

/** The fw field of a stack from untrusted data (network, saves): a star object, or a rocket's flight and stars; null if empty. */
export function cleanFw(fw) {
  if (!fw || typeof fw !== 'object') return null;
  if (Array.isArray(fw.c)) return cleanStar(fw);
  const out = {};
  const f = Math.min(MAX_FLIGHT, fw.f | 0);
  if (f > 1) out.f = f;
  if (Array.isArray(fw.st)) {
    const st = fw.st.slice(0, MAX_STARS).map(cleanStar).filter(Boolean);
    if (st.length) out.st = st;
  }
  return out.f || out.st ? out : null;
}

/** Same firework data? (stack merging and sync) */
export const sameFw = (a, b) => (!a && !b) || JSON.stringify(a ? cleanFw(a) : null) === JSON.stringify(b ? cleanFw(b) : null);

/** Is this star the plain single-colour ball of the original items (needs no fw data)? */
const isPlainStar = (s) => s.c.length === 1 && s.s === 0 && !s.t && !s.w && !(s.f && s.f.length);

/** The star a stack of a Firework Star is: its fw, or a plain ball in its item's colour. */
export function starOfStack(st) {
  if (!st || !isStarItem(st.id)) return null;
  return cleanStar(st.fw) || { c: [STAR_COLOR.get(st.id)], s: 0, t: 0, w: 0 };
}

/** The rocket a stack of a Sky Rocket / Star Rocket is: { flight, stars: [...] } (stars empty for a plain rocket). */
export function rocketOfStack(st) {
  if (!st) return { flight: 1, stars: [] };
  const fw = cleanFw(st.fw) || {};
  let stars = fw.st || [];
  if (!stars.length && ROCKET_COLOR.has(st.id)) stars = [{ c: [ROCKET_COLOR.get(st.id)], s: 0, t: 0, w: 0 }];
  return { flight: fw.f || 1, stars };
}

/**
 * The star crafted from these ingredient ids in grid order (blast powder, 1-8 dyes, at most one shape item, optionally
 * a diamond for the trail and glowshard dust for the twinkle, and optionally one Ink Sac with 1-8 more dyes after it
 * for the colours the sparks fade to), or null.
 */
export function craftStar(ids) {
  let powder = 0, shape = 0, shapes = 0, trail = 0, twinkle = 0, markers = 0;
  const colors = [], fade = [];
  for (const id of ids) {
    if (id === I.GUNPOWDER) powder++;
    else if (id === FADE_MARKER) markers++;
    else if (dyeColor(id) >= 0) { const c = dyeColor(id), list = markers ? fade : colors; if (!list.includes(c)) list.push(c); }
    else if (SHAPE_INGREDIENTS[id]) { shape = SHAPE_INGREDIENTS[id]; shapes++; }
    else if (id === TRAIL_INGREDIENT) trail++;
    else if (id === TWINKLE_INGREDIENT) twinkle++;
    else return null;
  }
  if (powder !== 1 || shapes > 1 || trail > 1 || twinkle > 1 || markers > 1 || !colors.length || colors.length > MAX_COLORS || fade.length > MAX_COLORS) return null;
  if (markers && !fade.length) return null; // a marker needs fade colours after it
  const star = { c: colors, s: shape, t: trail, w: twinkle };
  if (fade.length) star.f = fade;
  return star;
}

/** The stack a star makes: the original per-colour item for a plain ball, otherwise the first colour's item with its fw. */
export function starStack(star, count = 1) {
  const out = { id: FIREWORK_STARS[star.c[0]], count };
  if (!isPlainStar(star)) out.fw = star;
  return out;
}

/** The rocket stack made from a paper, 1-3 blast powder and up to 7 stars (their stacks), or null. Makes 3. */
export function craftRocket(stacks) {
  let paper = 0, powder = 0;
  const stars = [];
  for (const s of stacks) {
    if (s.id === I.PAPER) paper++;
    else if (s.id === I.GUNPOWDER) powder++;
    else if (isStarItem(s.id)) stars.push(starOfStack(s));
    else return null;
  }
  if (paper !== 1 || powder < 1 || powder > MAX_FLIGHT || stars.length > MAX_STARS) return null;
  if (!stars.length && powder === 1) return null; // the plain Sky Rocket recipe
  return rocketStack(powder, stars, 3);
}

/** A rocket stack with this flight and stars (plain items where nothing extra needs remembering). */
export function rocketStack(flight, stars, count = 1) {
  if (!stars.length) {
    const out = { id: I.SKY_ROCKET, count };
    if (flight > 1) out.fw = { f: flight };
    return out;
  }
  const out = { id: STAR_ROCKETS[stars[0].c[0]], count };
  if (flight > 1 || stars.length > 1 || !isPlainStar(stars[0])) out.fw = flight > 1 ? { f: flight, st: stars } : { st: stars };
  return out;
}

/** Crafting hook (player/crafting.js): the firework result of a grid's non-empty stacks, or null. */
export function fireworkRecipe(stacks) {
  if (stacks.some((s) => s.id === I.PAPER)) return craftRocket(stacks);
  if (stacks.some((s) => isStarItem(s.id))) return null;
  const star = craftStar(stacks.map((s) => s.id));
  return star ? starStack(star, 1) : null;
}

/** The fw data a crossbow stores for a Star Rocket stack it is loaded with, or null if that rocket carries no stars (a plain Sky Rocket cannot be loaded). */
export function crossbowLoad(st) {
  if (!st || !(ROCKET_COLOR.has(st.id) || st.id === I.SKY_ROCKET)) return null;
  const r = rocketOfStack(st);
  if (!r.stars.length) return null;
  return cleanFw(r.flight > 1 ? { f: r.flight, st: r.stars } : { st: r.stars });
}

/** The rocket a loaded crossbow holds ({ flight, stars }), or null. */
export function loadedRocket(bow) {
  const fw = bow && bow.id === I.CROSSBOW_LOADED ? cleanFw(bow.fw) : null;
  if (!fw || Array.isArray(fw.c) || !fw.st) return null;
  return { flight: fw.f || 1, stars: fw.st };
}

/** Tooltip lines of a stack's firework data. */
export function fwLines(st) {
  const lines = [];
  const starLines = (s, prefix = '') => {
    lines.push(prefix + SHAPE_NAMES[s.s]);
    lines.push(prefix + s.c.map((c) => COLORS[c][1]).join(', '));
    if (s.t) lines.push(prefix + 'Trail');
    if (s.w) lines.push(prefix + 'Twinkle');
    if (s.f && s.f.length) lines.push(prefix + 'Fades to ' + s.f.map((c) => COLORS[c][1]).join(', '));
  };
  if (!st) return lines;
  if (isStarItem(st.id)) {
    if (st.fw) starLines(cleanStar(st.fw) || starOfStack({ id: st.id }));
    return lines;
  }
  if (st.id === I.CROSSBOW_LOADED) {
    const r = loadedRocket(st);
    if (r) {
      lines.push(`Loaded: Star Rocket (${r.stars.length} ${r.stars.length === 1 ? 'star' : 'stars'}, Flight ${r.flight})`);
      for (const s of r.stars) starLines(s, '  ');
    }
    return lines;
  }
  if (ROCKET_COLOR.has(st.id) || st.id === I.SKY_ROCKET) {
    const r = rocketOfStack(st);
    lines.push(`Flight Duration: ${r.flight}`);
    for (const s of r.stars) if (r.stars.length > 1 || s.s || s.t || s.w || s.c.length > 1) starLines(s, '  ');
  }
  return lines;
}

// ---- bursts -----------------------------------------------------------------------------------------

const TAU = Math.PI * 2;
/** A random unit vector. */
function sphere(rng) {
  const u = rng() * 2 - 1, a = rng() * TAU, s = Math.sqrt(1 - u * u);
  return [Math.cos(a) * s, u, Math.sin(a) * s];
}

/** The five-pointed star's outline as 2D points (outer radius 1, inner 0.4), `per` points on each of its 10 edges. */
export function starOutline(per = 8) {
  const v = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 0.4 : 1, a = Math.PI / 2 + (k * TAU) / 10;
    v.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const [ax, ay] = v[k], [bx, by] = v[(k + 1) % 10];
    for (let j = 0; j < per; j++) pts.push([ax + ((bx - ax) * j) / per, ay + ((by - ay) * j) / per]);
  }
  return pts;
}

/** The Fizzler's face on an 8x8 grid (# = dark patch). */
export const FACE_ROWS = ['........', '........', '.##..##.', '.##..##.', '...##...', '..####..', '..####..', '..#..#..'];
/** The face as 2D points (-1..1, y up), two sparks per patch. */
export function faceOutline() {
  const pts = [];
  FACE_ROWS.forEach((row, r) => { for (let c = 0; c < 8; c++) if (row[c] === '#') for (const [dx, dy] of [[-0.2, 0.2], [0.2, -0.2]]) pts.push([((c - 3.5 + dx) / 3.5), -((r - 3.5 + dy) / 3.5)]); });
  return pts;
}

/**
 * Spark velocities (blocks/tick) of one burst shape. Flat shapes (star, face) lie in a vertical plane facing a
 * random direction (`yaw`), with a little tilt; the balls are filled spheres, the burst a ragged spray.
 */
export function burstVelocities(shape, rng = Math.random, yaw = rng() * TAU) {
  const out = [];
  switch (shape) {
    case 1: // large ball: more sparks, faster
      for (let k = 0; k < 110; k++) { const d = sphere(rng), sp = 0.42 + rng() * 0.12; out.push([d[0] * sp, d[1] * sp, d[2] * sp]); }
      break;
    case 3: // burst: a spray of sparks of very different speeds
      for (let k = 0; k < 90; k++) { const d = sphere(rng), sp = 0.06 + rng() * rng() * 0.5; out.push([d[0] * sp, d[1] * sp, d[2] * sp]); }
      break;
    case 2: case 4: {
      const pts = shape === 2 ? starOutline() : faceOutline();
      const sp = shape === 2 ? 0.36 : 0.32, cos = Math.cos(yaw), sin = Math.sin(yaw);
      for (const [px, py] of pts) {
        // x runs along the plane's horizontal axis, z (a hair of it) out of the plane
        const jitter = (rng() - 0.5) * 0.02;
        out.push([px * sp * cos - jitter * sin, py * sp, px * sp * sin + jitter * cos]);
      }
      break;
    }
    default: // small ball
      for (let k = 0; k < 70; k++) { const d = sphere(rng), sp = 0.25 + rng() * 0.1; out.push([d[0] * sp, d[1] * sp, d[2] * sp]); }
  }
  return out;
}

/** How far a fading spark has turned to its fade colour (0-1) `age` ticks into a `life`-tick life: the first third keeps its burst colour. */
export function fadeAmount(age, life) {
  if (!(life > 0)) return 0;
  const t = age / life;
  return t <= 1 / 3 ? 0 : Math.min(1, (t - 1 / 3) * 1.5);
}

/** A colour (0-1 rgb) mixed `k` of the way from `a` to `b`. */
export const mixRgb = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** Damage a Star Rocket's burst deals within its range (reference: 5 + 2 per star). */
export const burstDamage = (stars) => 5 + 2 * Math.max(1, stars);
