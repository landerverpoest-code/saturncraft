// Feature versions and the conservative retrofit of saved chunks.
//
// Only chunks a player changed are written to a save; every other chunk is made again from the seed when it loads, so it
// already gets every feature pass the generator has today. A saved (edited) chunk, though, is frozen at the state it was
// saved in: features that came later (wild crops, the deep sea, Cloud Isles, the shore structures...) never appear in it.
//
//  * FEATURES lists those later passes, each with the feature version it arrived in (CURRENT_FEATURE_VERSION is the newest).
//    A chunk carries `fv`, the version it was made or last retrofitted at (a save from before this existed reads as 0); a
//    world carries `featureVersion` (what its saved chunks have all been brought to, 0 for an old save). A new chunk is made at
//    the current version, so there is never anything to retrofit in it. Nothing is retrofitted unless the host runs /retrofit.
//  * The planner asks the generator what each newer pass changes in the chunk (TerrainGenerator.passHook), then groups the
//    changed cells of a pass into units (cells close together: one plant, one grotto, one isle). A unit is only placed when
//    EVERY one of its cells is, in the saved chunk, exactly what the generator makes without the pass (so no player edit has
//    touched it: the "edit diff" is the saved chunk against the regenerated one, nothing extra is stored), that cell is air or
//    water, and it lies above the ground of its column. Anything else is left alone and counted by reason, so a half-built
//    structure never appears, a player's block is never replaced and nothing is carved out of the terrain.
//  * Units that need the ground changed (a foundation, a trench, a farmland plot) are skipped for that reason; they still appear in
//    every chunk that has not been edited. Sea biomes painted by the deep-sea pass are updated where the saved biome is still the
//    one the generator started from (nobody edits biomes).
import { B, SOLID } from './blocks.js';
import { CHUNK_VOLUME, MIN_Y, WORLD_HEIGHT, cidx } from './constants.js';
import { computeChunkLight } from './lighting.js';
import { LEAVES } from './trees.js';

/**
 * The passes that were added after the first release of the generator, in the order the generator runs them. `since` is
 * the feature version that introduced it (add new passes last, with the next number and raise CURRENT_FEATURE_VERSION),
 * `link` how far apart (in blocks) two changed cells may be and still belong to the same unit.
 */
export const FEATURES = [
  { key: 'wildCrops', since: 3, label: 'wild crops', link: 1 },
  { key: 'strata', since: 6, label: 'Painted Mesa strata', link: 3 },
  { key: 'deepSea', since: 1, label: 'deep sea kelp and grottos', link: 2 },
  { key: 'sunkenRuins', since: 1, label: 'Sunken Ruins', link: 3 },
  { key: 'sunTombs', since: 1, label: 'Sun Tombs', link: 3 },
  { key: 'skywatch', since: 1, label: 'Skywatch Towers', link: 3 },
  { key: 'rimekeep', since: 2, label: 'Rimekeeps', link: 3 },
  { key: 'sporehall', since: 2, label: 'Sporehalls', link: 3 },
  { key: 'lighthouse', since: 4, label: "Hermit's Lighthouses", link: 3 },
  { key: 'mireShrine', since: 4, label: 'Mire Shrines', link: 3 },
  { key: 'observatory', since: 4, label: "Stargazer's Observatories", link: 3 },
  { key: 'sandvault', since: 6, label: 'Sandvaults', link: 3 },
  { key: 'canyons', since: 6, label: 'Slot Canyons', link: 3 },
  { key: 'hagHut', since: 6, label: 'Hag Huts', link: 3 },
  { key: 'skyIsles', since: 5, label: 'Cloud Isles', link: 3 },
];
export const CURRENT_FEATURE_VERSION = Math.max(...FEATURES.map((f) => f.since));
export const FEATURE_KEYS = FEATURES.map((f) => f.key);

/** The version number to keep from stored data: a whole number from 0 to the current version, else `fallback`. */
export function cleanFeatureVersion(v, fallback = 0) {
  return Number.isInteger(v) && v >= 0 ? Math.min(v, CURRENT_FEATURE_VERSION) : fallback;
}

/** The passes a chunk of feature version `fv` has not seen. */
export function featuresSince(fv) { return FEATURES.filter((f) => f.since > fv); }

/** Why a unit was not placed (the first reason that applies). */
export const STATUS = {
  apply: 'placed',
  present: 'already there',
  edited: 'blocked by edited blocks',
  terrain: 'needs the ground changed',
  underground: 'below the surface',
  overlap: 'overlaps a skipped feature',
};

// ---- recording what a pass changes -----------------------------------------------------------------------------
function makeRecorder(wanted) {
  const snapB = new Uint16Array(CHUNK_VOLUME), snapM = new Uint8Array(CHUNK_VOLUME), snapBio = new Uint8Array(256);
  const passes = [];
  let live = false;
  return {
    passes,
    before(name, blocks, meta, biomes) {
      live = wanted.has(name);
      if (!live) return;
      snapB.set(blocks); snapM.set(meta); snapBio.set(biomes);
    },
    after(name, blocks, meta, biomes) {
      if (!live) return;
      live = false;
      const idx = [], ob = [], om = [], nb = [], nm = [];
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        if (blocks[i] === snapB[i] && meta[i] === snapM[i]) continue;
        idx.push(i); ob.push(snapB[i]); om.push(snapM[i]); nb.push(blocks[i]); nm.push(meta[i]);
      }
      const bio = [];
      for (let c = 0; c < 256; c++) if (biomes[c] !== snapBio[c]) bio.push([c, snapBio[c], biomes[c]]);
      passes.push({ key: name, idx, ob, om, nb, nm, bio });
    },
  };
}

/** Group the changed cells of a pass into units: cells within `link` blocks (each axis) of one another. Returns arrays of positions into idx. */
export function groupCells(idx, link) {
  const n = idx.length, parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const at = new Map();
  for (let i = 0; i < n; i++) at.set(idx[i], i);
  // half of the neighbourhood is enough: every pair is met once from its first member
  const offs = [];
  for (let dy = 0; dy <= link; dy++) for (let dz = -link; dz <= link; dz++) for (let dx = -link; dx <= link; dx++) {
    if (dy === 0 && (dz < 0 || (dz === 0 && dx <= 0))) continue;
    offs.push([dx, dy, dz]);
  }
  for (let i = 0; i < n; i++) {
    const c = idx[i], x = c & 15, z = (c >> 4) & 15, y = c >> 8;
    for (const [dx, dy, dz] of offs) {
      const nx = x + dx, nz = z + dz, ny = y + dy;
      if (nx < 0 || nx > 15 || nz < 0 || nz > 15 || ny < 0 || ny >= WORLD_HEIGHT) continue;
      const j = at.get(nx | (nz << 4) | (ny << 8));
      if (j === undefined) continue;
      const a = find(i), b = find(j);
      if (a !== b) parent[a] = b;
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); let g = groups.get(r); if (!g) groups.set(r, g = []); g.push(i); }
  return [...groups.values()];
}

/**
 * Highest solid block of every column of a chunk's blocks (MIN_Y - 1 when there is none). Natural tree leaves (still as the
 * generator made them: `fresh` is its output) do not count, so a bramble in a forest is not "underground"; a roof a player
 * built does.
 */
function groundLevels(blocks, fresh) {
  const out = new Int16Array(256).fill(MIN_Y - 1);
  for (let c = 0; c < 256; c++) {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const i = c | (y << 8), b = blocks[i];
      if (SOLID[b] && !(LEAVES.has(b) && b === fresh[i])) { out[c] = y + MIN_Y; break; }
    }
  }
  return out;
}

const free = (b) => b === B.AIR || b === B.WATER;

/**
 * Plan the retrofit of one saved chunk. `chunk` is { blocks, meta, biomes, fv? } as stored (unpackChunk's shape); nothing in it
 * is modified. `gen` is the world's overworld TerrainGenerator.
 * Returns { cx, cz, from, units: [{ pass, status, cells }], placed (cells), biomes (columns), result }, where `result` (only
 * when `materialize` and something changes) holds the new { blocks, meta, biomes, heightmap, light }.
 */
export function planChunkRetrofit(gen, cx, cz, chunk, { materialize = false } = {}) {
  const from = cleanFeatureVersion(chunk.fv, 0);
  const wanted = new Set(featuresSince(from).map((f) => f.key));
  const out = { cx, cz, from, units: [], placed: 0, biomes: 0, result: null };
  if (!wanted.size) return out;
  const rec = makeRecorder(wanted);
  const prev = gen.passHook;
  gen.passHook = rec;
  let fresh;
  try { fresh = gen.generate(cx, cz).blocks; } finally { gen.passHook = prev; }
  // what the saved chunk would hold without any of the newer passes: the first value each changed cell had
  const base = new Map();
  for (const p of rec.passes) for (let k = 0; k < p.idx.length; k++) if (!base.has(p.idx[k])) base.set(p.idx[k], (p.ob[k]) | (p.om[k] << 16));
  const sb = chunk.blocks, sm = chunk.meta, ground = groundLevels(sb, fresh);
  const blockedCells = new Set();
  const writes = []; // [pass, positions] of the units to place
  for (const p of rec.passes) {
    const f = FEATURES.find((x) => x.key === p.key);
    for (const group of groupCells(p.idx, f.link)) {
      let present = 0, edited = false, terrain = false, under = false, overlap = false;
      for (const k of group) {
        const i = p.idx[k];
        if (blockedCells.has(i)) overlap = true;
        const isNew = sb[i] === p.nb[k] && sm[i] === p.nm[k];
        const bv = base.get(i), bb = bv & 0xffff, bm = bv >> 16;
        if (isNew) { present++; continue; }
        if (sb[i] !== bb || sm[i] !== bm) { edited = true; continue; }
        if (!free(bb)) terrain = true;
        if ((i >> 8) + MIN_Y <= ground[i & 255]) under = true;
      }
      let status;
      if (present === group.length) status = 'present';
      else if (present > 0 || edited) status = 'edited';
      else if (overlap) status = 'overlap';
      else if (terrain) status = 'terrain';
      else if (under) status = 'underground';
      else status = 'apply';
      if (status !== 'apply' && status !== 'present') for (const k of group) blockedCells.add(p.idx[k]);
      out.units.push({ pass: p.key, status, cells: group.length, first: p.idx[group[0]] }); // (`first`: one cell of the unit, as an index into the chunk arrays)
      if (status === 'apply') { out.placed += group.length; writes.push([p, group]); }
    }
  }
  // sea biomes painted by the deep-sea pass: only where the saved biome is still the generator's starting one
  const bioWrites = [];
  for (const p of rec.passes) for (const [c, o, n] of p.bio) if (chunk.biomes[c] === o) bioWrites.push([c, n]);
  out.biomes = bioWrites.length;
  if (materialize && (writes.length || bioWrites.length)) {
    const blocks = new Uint16Array(sb), meta = new Uint8Array(sm), biomes = new Uint8Array(chunk.biomes);
    for (const [p, group] of writes) for (const k of group) { blocks[p.idx[k]] = p.nb[k]; meta[p.idx[k]] = p.nm[k]; }
    for (const [c, n] of bioWrites) biomes[c] = n;
    const heightmap = new Int16Array(256);
    for (let c = 0; c < 256; c++) { let y = WORLD_HEIGHT - 1; for (; y > 0; y--) if (blocks[c | (y << 8)]) break; heightmap[c] = y + MIN_Y; }
    let light = chunk.light;
    if (writes.length) { light = new Uint8Array(CHUNK_VOLUME); computeChunkLight(blocks, light); }
    out.result = { blocks, meta, biomes, heightmap, light };
  }
  return out;
}

// ---- the whole saved world ------------------------------------------------------------------------------------
/** Chunk coordinates of a world.js chunkKey. */
export function unkey(k) { return [Math.floor(k / 65536) - 32768, (k % 65536) - 32768]; }

/** A fresh, empty report. */
export function emptyReport() {
  return { scanned: 0, current: 0, changedChunks: 0, cells: 0, biomeColumns: 0, remaining: 0, byFeature: {}, byStatus: {}, loadedSkipped: 0 };
}

/**
 * Walk the saved (unloaded, edited) chunks of an overworld `world` that are older than the current feature version, at most `limit`
 * of them. With `dryRun` (the default) nothing is changed and the report says what would be. Otherwise every chunk visited is
 * brought to the current version, and those with a placeable unit are replaced by the retrofitted copy.
 * Loaded chunks are never touched (walk away from them and run it again). Returns the report (see emptyReport):
 * `byFeature[key]` = { placed, present, skipped, cells }, `byStatus[status]` = units.
 */
export function retrofitSaved(world, { dryRun = true, limit = 150 } = {}) {
  const report = emptyReport();
  report.dryRun = dryRun;
  const gen = world.gen;
  for (const k of world.chunks.keys()) { const c = world.chunks.get(k); if (c.modified && cleanFeatureVersion(c.fv, CURRENT_FEATURE_VERSION) < CURRENT_FEATURE_VERSION) report.loadedSkipped++; }
  const todo = [];
  for (const [k, c] of world.saved) {
    if (cleanFeatureVersion(c.fv, 0) >= CURRENT_FEATURE_VERSION) report.current++;
    else todo.push(k);
  }
  todo.sort((a, b) => a - b); // a fixed order, so a dry run and the real run visit the same chunks
  report.remaining = Math.max(0, todo.length - limit);
  for (const k of todo.slice(0, limit)) {
    const c = world.saved.get(k), [cx, cz] = unkey(k);
    const plan = planChunkRetrofit(gen, cx, cz, c, { materialize: !dryRun });
    report.scanned++;
    for (const u of plan.units) {
      const f = (report.byFeature[u.pass] ||= { placed: 0, present: 0, skipped: 0, cells: 0 });
      if (u.status === 'apply') { f.placed++; f.cells += u.cells; } else if (u.status === 'present') f.present++; else f.skipped++;
      report.byStatus[u.status] = (report.byStatus[u.status] || 0) + 1;
    }
    report.cells += plan.placed; report.biomeColumns += plan.biomes;
    if (plan.placed || plan.biomes) report.changedChunks++;
    if (dryRun) continue;
    const next = { ...c, fv: CURRENT_FEATURE_VERSION, modified: true };
    if (plan.result) {
      Object.assign(next, plan.result);
      next.rev = (c.rev || 0) + 1; next.packCache = null; next.packRev = -1; // so the next save writes the new copy
    }
    world.saved.set(k, next);
  }
  return report;
}

/** The text lines /retrofit prints for a report. */
export function describeReport(r) {
  const lines = [];
  const names = Object.fromEntries(FEATURES.map((f) => [f.key, f.label]));
  lines.push(`${r.dryRun ? 'Dry run: ' : ''}looked at ${r.scanned} saved chunk${r.scanned === 1 ? '' : 's'}; ${r.dryRun ? 'would change' : 'changed'} ${r.changedChunks} (${r.cells} blocks${r.biomeColumns ? `, ${r.biomeColumns} sea biome columns` : ''}).`);
  const rows = Object.entries(r.byFeature).filter(([, f]) => f.placed || f.skipped).map(([key, f]) => `  ${names[key] || key}: ${f.placed} ${r.dryRun ? 'to place' : 'placed'}${f.skipped ? `, ${f.skipped} left alone` : ''}${f.present ? `, ${f.present} already there` : ''}`);
  lines.push(...rows);
  const why = Object.entries(r.byStatus).filter(([s, n]) => s !== 'apply' && s !== 'present' && n).map(([s, n]) => `${n} ${STATUS[s] || s}`);
  if (why.length) lines.push('Left alone: ' + why.join(', ') + '.');
  if (r.remaining) lines.push(`${r.remaining} more saved chunk${r.remaining === 1 ? '' : 's'} to go: run the command again.`);
  if (r.loadedSkipped) lines.push(`${r.loadedSkipped} chunk${r.loadedSkipped === 1 ? ' is' : 's are'} loaded right now and were skipped: walk away from them and run it again.`);
  if (r.dryRun && r.changedChunks) lines.push('Nothing was changed. Run /retrofit apply to place them.');
  return lines;
}
