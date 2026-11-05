// Compact kit for the smaller "site" structures (Hermit's Lighthouse, Mire Shrine, Stargazer's Observatory): one site per
// region at most, planned from the seed alone (so the host and every guest agree), clear of every older structure, and
// stamped chunk by chunk from a pure `blockAt(site, u, h, v)` function. The larger siteKit.js helpers do the rotation and
// region lookups; this adds the shared planning loop and the chunk stamper that sporehall.js and rimekeep.js each spell out.
import { B } from './blocks.js';
import { cidx } from './constants.js';
import { mulberry32, hash4, hashf } from './noise.js';
import { toLocal, sitesNear, nearestSite, chunkSetter, claimedByOthers } from './siteKit.js';
import { sunkenRuinsNear } from './sunkenRuins.js';
import { sunTombsNear } from './sunTombs.js';
import { skywatchesNear } from './skywatch.js';
import { rimekeepsNear } from './rimekeep.js';
import { sporehallsNear } from './sporehall.js';

/** True when any structure older than this pack lies within the rectangle. */
export function claimedByOlder(gen, x0, z0, x1, z1) {
  return claimedByOthers(gen, x0, z0, x1, z1) || sunkenRuinsNear(gen, x0, z0, x1, z1).length > 0 || sunTombsNear(gen, x0, z0, x1, z1).length > 0 ||
    skywatchesNear(gen, x0, z0, x1, z1).length > 0 || rimekeepsNear(gen, x0, z0, x1, z1).length > 0 || sporehallsNear(gen, x0, z0, x1, z1).length > 0;
}

/**
 * A kind of site. cfg: { salt, region, reach, chance, tries, probe(gen, cx, cz, rng) -> null | { y, dir?, ...extra }, siblings: [near fns of
 * the pack's earlier kinds to keep clear of] }. Returns { inRegion, near, nearest, region, reach } like the other site kinds.
 */
export function makeSiteKind(cfg) {
  const cache = new Map();
  function inRegion(gen, rx, rz) {
    const key = `${gen.seed}:${rx},${rz}`;
    if (cache.has(key)) return cache.get(key);
    const rng = mulberry32(hash4(gen.seed, rx, rz, cfg.salt));
    let site = null;
    if (rng() < cfg.chance) {
      const R = cfg.region, M = cfg.reach + 8;
      for (let k = 0; k < cfg.tries && !site; k++) {
        const cx = rx * R + M + Math.floor(rng() * (R - 2 * M)), cz = rz * R + M + Math.floor(rng() * (R - 2 * M));
        const dir0 = Math.floor(rng() * 4), seed = Math.floor(rng() * 1e9);
        const info = cfg.probe(gen, cx, cz, rng);
        if (!info) continue;
        const box = { x0: cx - cfg.reach, z0: cz - cfg.reach, x1: cx + cfg.reach, z1: cz + cfg.reach };
        const pad = [box.x0 - 6, box.z0 - 6, box.x1 + 6, box.z1 + 6];
        if (gen.riverInBox && gen.riverInBox(box.x0, box.z0, box.x1, box.z1)) continue;
        if (claimedByOlder(gen, ...pad) || (cfg.siblings || []).some((near) => near(gen, ...pad).length)) continue;
        site = { cx, cz, dir: dir0, seed, ...box, ...info };
      }
    }
    if (cache.size > 512) cache.clear();
    cache.set(key, site);
    return site;
  }
  return {
    region: cfg.region, reach: cfg.reach, inRegion,
    near: (gen, x0, z0, x1, z1) => sitesNear(inRegion, gen, cfg.region, cfg.reach, x0, z0, x1, z1),
    nearest: (gen, x, z, maxRings = 12) => nearestSite(inRegion, gen, cfg.region, x, z, maxRings),
  };
}

/**
 * Stamp the parts of the sites of `near` that fall inside chunk (cx, cz). blockAt(site, u, h, v) -> [id, meta] | null (null leaves the
 * world alone); `half` is the footprint's half width, `below`/`clear` the lowest and highest layer asked, `foundation` how deep the
 * ground is built up where it falls away, and `fill(site, u, v, h)` the block for that build-up.
 */
export function stampKind(gen, blocks, meta, cx, cz, near, { half, below, clear, foundation, fill, blockAt }) {
  const X0 = cx * 16, Z0 = cz * 16;
  const sites = near(gen, X0, Z0, X0 + 15, Z0 + 15);
  if (!sites.length) return;
  const set = chunkSetter(blocks, meta, cx, cz);
  for (const s of sites) {
    for (let x = Math.max(X0, s.x0); x <= Math.min(X0 + 15, s.x1); x++) for (let z = Math.max(Z0, s.z0); z <= Math.min(Z0 + 15, s.z1); z++) {
      const [u, v] = toLocal(s.dir, x - s.cx, z - s.cz);
      if (Math.abs(u) > half || Math.abs(v) > half) continue;
      for (let h = -1; h >= -foundation; h--) {
        const b = blocks[cidx(x - X0, s.y + h, z - Z0)];
        if (b && b !== B.WATER) break;
        if (Math.hypot(u, v) > (s.platformR || 99)) break;
        set(x, s.y + h, z, fill(s, u, v, h));
      }
      for (let h = below; h <= clear; h++) {
        const bl = blockAt(s, u, h, v);
        if (bl) set(x, s.y + h, z, bl[0], bl[1]);
      }
    }
  }
}

/** A mortar-and-brick mix by hash: mossy, plain and cracked stone bricks. */
export function oldBrick(seed, a, b, k, mossy = 0.35) {
  const t = hashf(seed, a * 61 + 900, b * 31 + 900, k);
  return [t < mossy ? B.MOSSY_STONE_BRICKS : t < 0.8 ? B.STONE_BRICKS : t < 0.94 ? B.CRACKED_STONE_BRICKS : B.MOSSY_COBBLESTONE, 0];
}
