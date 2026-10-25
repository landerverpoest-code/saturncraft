// Archaeology: Suspicious Sand and Gravel left in desert temples, desert wells, the sea floor
// around shipwrecks and Buried Ruins each hide one find. Holding use with a Brush on one
// sweeps it clean over 2.5 s through four visible stages (meta bits 0-1), then the block turns
// to plain sand or gravel and the find pops out. Let go early and the dig slowly fills back in.
// What a block holds comes from the world seed and its position (and the kind of site, meta
// bits 2-3), so nothing is saved until it is brushed. Also the rules of Decorated Pots: which
// sherd shows on which side, how a pot is crafted and what it drops.
import { B, BLOCKS } from './blocks.js';
import { I, SHERD_ITEMS } from './items.js';
import { mulberry32, hash4 } from './noise.js';

/** Kinds of dig site (meta bits 2-3 of a suspicious block), each with its own finds. */
export const SITE = { TEMPLE: 0, WELL: 1, WRECK: 2, BURIED: 3 };
/** Meta of a suspicious block of `site` at brushing `stage`. */
export const susMeta = (site, stage = 0) => ((site & 3) << 2) | (stage & 3);
export const siteOf = (meta) => (meta >> 2) & 3;
export const stageOf = (meta) => meta & 3;
export const isSuspicious = (id) => !!(BLOCKS[id] && BLOCKS[id].suspicious);

export const BRUSH_TICKS = 50;   // 2.5 s of brushing uncovers the find
export const BRUSH_STAGES = 4;
export const DECAY_DELAY = 20;   // ticks without brushing before the dig starts to fill in
export const DECAY_PER_TICK = BRUSH_TICKS / BRUSH_STAGES / 20; // then one stage a second
/** Visible stage (0-3) for brushing progress in ticks. */
export const brushStage = (progress) => Math.max(0, Math.min(BRUSH_STAGES - 1, Math.floor(progress * BRUSH_STAGES / BRUSH_TICKS)));

const S = (key) => SHERD_ITEMS[['ringed', 'three_suns', 'wyrm', 'tide', 'sprout', 'watcher', 'antler', 'ember'].indexOf(key)];
/** Finds per site: [item, min, max, weight]. Sherds are the prize; the rest is what people dropped. */
export const SITE_LOOT = {
  [SITE.TEMPLE]: [[S('ringed'), 1, 1, 3], [S('three_suns'), 1, 1, 3], [S('ember'), 1, 1, 3], [S('watcher'), 1, 1, 3], [I.BERYL, 1, 1, 3], [I.GOLD_NUGGET, 1, 3, 3], [I.GUNPOWDER, 1, 1, 2], [I.DIAMOND, 1, 1, 1]],
  [SITE.WELL]: [[S('sprout'), 1, 1, 4], [S('three_suns'), 1, 1, 3], [I.BERYL, 1, 1, 2], [I.COAL, 1, 1, 3], [I.BRICK, 1, 1, 2], [I.STICK, 1, 2, 2]],
  [SITE.WRECK]: [[S('tide'), 1, 1, 4], [S('wyrm'), 1, 1, 3], [I.COAL, 1, 2, 3], [I.GOLD_NUGGET, 1, 3, 3], [I.IRON_NUGGET, 1, 3, 2], [I.BERYL, 1, 1, 2]],
  [SITE.BURIED]: [[S('antler'), 1, 1, 3], [S('sprout'), 1, 1, 2], [S('watcher'), 1, 1, 2], [S('wyrm'), 1, 1, 2], [I.COAL, 1, 2, 3], [I.BERYL, 1, 1, 2], [I.GOLD_NUGGET, 1, 2, 2], [I.BRICK, 1, 1, 2], [I.WHEAT, 1, 3, 2]],
};

/** The find hidden in the suspicious block at (x, y, z): always the same for a seed, site and spot. */
export function archaeologyLoot(seed, x, y, z, site) {
  const table = SITE_LOOT[site & 3];
  const rng = mulberry32(hash4((seed | 0) + (site & 3) * 7919, x, y, z));
  let r = rng() * table.reduce((a, e) => a + e[3], 0);
  let e = table[table.length - 1];
  for (const t of table) { if ((r -= t[3]) < 0) { e = t; break; } }
  return { id: e[0], count: e[1] + Math.floor(rng() * (e[2] - e[1] + 1)), damage: 0 };
}

/**
 * Brushing in progress, per block: progress grows a tick at a time while someone brushes,
 * shows as the block's stage, and wears away again once nobody has brushed it for a second.
 * `world` needs getBlock / getMeta / setBlock.
 */
export class BrushSites {
  constructor() { this.sites = new Map(); }

  /**
   * One tick of brushing the block at (x, y, z) at time `now` (ticks). Returns null when it is
   * not suspicious, else { stage, done, plain, site }; when done the caller swaps the block and
   * hands out the find (archaeologyLoot).
   */
  brush(world, x, y, z, now) {
    const id = world.getBlock(x, y, z);
    if (!isSuspicious(id)) return null;
    const meta = world.getMeta(x, y, z), k = `${x},${y},${z}`;
    let s = this.sites.get(k);
    if (!s) { s = { x, y, z, progress: stageOf(meta) * BRUSH_TICKS / BRUSH_STAGES, last: now }; this.sites.set(k, s); }
    s.progress += 1; s.last = now;
    const out = { stage: brushStage(s.progress), done: s.progress >= BRUSH_TICKS, plain: BLOCKS[id].suspicious, site: siteOf(meta) };
    if (out.done) { this.sites.delete(k); return out; }
    if (out.stage !== stageOf(meta)) world.setBlock(x, y, z, id, (meta & ~3) | out.stage);
    return out;
  }

  /** Digs nobody is brushing fill back in, a stage at a time. */
  tick(world, now) {
    for (const [k, s] of this.sites) {
      if (now - s.last <= DECAY_DELAY) continue;
      const id = world.getBlock(s.x, s.y, s.z);
      if (!isSuspicious(id)) { this.sites.delete(k); continue; }
      s.progress = Math.max(0, s.progress - DECAY_PER_TICK);
      const meta = world.getMeta(s.x, s.y, s.z), stage = s.progress <= 0 ? 0 : brushStage(s.progress);
      if (stage !== stageOf(meta)) world.setBlock(s.x, s.y, s.z, id, (meta & ~3) | stage);
      if (s.progress <= 0) this.sites.delete(k);
    }
  }
}

// ---- Decorated Pots ------------------------------------------------------------------
// A pot's faces: [back, left, right, front] as laid out in the crafting grid (top, middle
// left, middle right, bottom); each 0 for a plain brick side or 1 + the sherd's index.

/** Pot face value of an item (0 = brick, 1 + k = sherd k), or -1 if it can't make a pot side. */
export function potFace(id) {
  if (id === I.BRICK) return 0;
  const k = SHERD_ITEMS.indexOf(id);
  return k >= 0 ? k + 1 : -1;
}

/** Faces of a pot crafted from a 3x3 grid of item ids (row-major), or null when every side is plain. */
export function potFacesFromGrid(cells) {
  const faces = [cells[1], cells[3], cells[5], cells[7]].map(potFace);
  if (faces.some((f) => f < 0)) return null;
  return faces.some((f) => f > 0) ? faces : null;
}

/** A cleaned copy of a pot's faces from untrusted data, or null when plain or invalid. */
export function cleanPotFaces(f) {
  if (!Array.isArray(f) || f.length !== 4) return null;
  const out = f.map((v) => { const n = v | 0; return n >= 0 && n <= SHERD_ITEMS.length ? n : 0; });
  return out.some((v) => v > 0) ? out : null;
}

// slot (back, left, right, front) -> side offset from the front side (SIDE_DIRS order)
const SLOT_OFFSET = [2, 1, 3, 0];
/** World side index (SIDE_DIRS) of a pot slot, for a pot whose front faces side `front`. */
export const potSlotSide = (slot, front) => (front + SLOT_OFFSET[slot]) & 3;

/** What a broken pot leaves: the pot itself (sherds kept) when broken with a tool, else its pieces. */
export function potDrops(faces, withTool) {
  const f = cleanPotFaces(faces);
  if (withTool) return [f ? { id: B.DECORATED_POT, count: 1, damage: 0, sherds: f } : { id: B.DECORATED_POT, count: 1, damage: 0 }];
  return (f || [0, 0, 0, 0]).map((v) => ({ id: v ? SHERD_ITEMS[v - 1] : I.BRICK, count: 1, damage: 0 }));
}
