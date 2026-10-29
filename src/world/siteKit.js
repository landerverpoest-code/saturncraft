// Shared helpers of the large "site" structures (Sunken Ruins, Sun Tombs, Skywatch Towers):
// rotation of a plan's local frame, region lookups, the per-chunk block setter, the claim
// test against every older structure and a nearest-site search for /locate. Everything is a
// pure function of the seed and the coordinates, so the host and every guest agree.
import { MIN_Y, WORLD_HEIGHT, cidx } from './constants.js';
import { SIDE_DIRS } from './shapes.js';
import { villagesNear } from './villages.js';
import { templesNear, outpostsNear } from './temples.js';
import { hutsNear } from './swampHuts.js';
import { monumentsNear } from './monuments.js';
import { ruinsNear } from './ruinedPortals.js';
import { igloosNear } from './igloos.js';
import { buriedRuinsNear } from './buriedRuins.js';
import { wrecksNear } from './shipwrecks.js';

/** Local (u, v) -> world offset (dx, dz) for heading `dir` (0..3, proper rotations). */
export function toWorld(dir, u, v) {
  switch (dir & 3) {
    case 0: return [u, v];
    case 1: return [-v, u];
    case 2: return [-u, -v];
    default: return [v, -u];
  }
}
/** World offset (dx, dz) -> local (u, v); the inverse of toWorld. */
export function toLocal(dir, dx, dz) {
  switch (dir & 3) {
    case 0: return [dx, dz];
    case 1: return [dz, -dx];
    case 2: return [-dx, -dz];
    default: return [-dz, dx];
  }
}
/** Side index (SIDE_DIRS) a local unit vector (fu, fv) points to under heading `dir`. */
export function sideOfLocal(dir, fu, fv) {
  const [dx, dz] = toWorld(dir, fu, fv);
  return SIDE_DIRS.findIndex((s) => s[0] === Math.sign(dx) && s[2] === Math.sign(dz));
}

/** Every site of a region-based kind whose box (reach blocks round its centre) meets the rectangle. */
export function sitesNear(inRegion, gen, R, reach, x0, z0, x1, z1) {
  const out = [];
  for (let rx = Math.floor((x0 - reach) / R); rx <= Math.floor((x1 + reach) / R); rx++) for (let rz = Math.floor((z0 - reach) / R); rz <= Math.floor((z1 + reach) / R); rz++) {
    const s = inRegion(gen, rx, rz);
    if (s && s.x1 >= x0 && s.x0 <= x1 && s.z1 >= z0 && s.z0 <= z1) out.push(s);
  }
  return out;
}

/** The nearest site to (px, pz), searching rings of regions outwards (one ring past the first find). */
export function nearestSite(inRegion, gen, R, px, pz, maxRings = 12) {
  const prx = Math.floor(px / R), prz = Math.floor(pz / R);
  let best = null, stopAt = maxRings;
  for (let r = 0; r <= stopAt; r++) for (let rx = prx - r; rx <= prx + r; rx++) for (let rz = prz - r; rz <= prz + r; rz++) {
    if (Math.max(Math.abs(rx - prx), Math.abs(rz - prz)) !== r) continue;
    const s = inRegion(gen, rx, rz);
    if (s && (!best || Math.hypot(s.cx - px, s.cz - pz) < Math.hypot(best.cx - px, best.cz - pz))) { best = s; stopAt = Math.min(stopAt, r + 1); }
  }
  return best;
}

/** Setter writing into one chunk's arrays; blocks outside the chunk or the world are skipped. */
export function chunkSetter(blocks, meta, cx, cz) {
  const X0 = cx * 16, Z0 = cz * 16;
  return (x, y, z, id, m = 0) => {
    if (x < X0 || x >= X0 + 16 || z < Z0 || z >= Z0 + 16 || y <= MIN_Y || y >= MIN_Y + WORLD_HEIGHT) return;
    const i = cidx(x - X0, y, z - Z0);
    blocks[i] = id; meta[i] = m;
  };
}

/** True when an older structure (village, temple, outpost, hut, citadel, rift, igloo, ruin or wreck) lies within the rectangle. */
export function claimedByOthers(gen, x0, z0, x1, z1) {
  return villagesNear(gen, x0, z0, x1, z1).length > 0 || templesNear(gen, x0, z0, x1, z1).length > 0 ||
    outpostsNear(gen, x0, z0, x1, z1).length > 0 || hutsNear(gen, x0, z0, x1, z1).length > 0 ||
    monumentsNear(gen, x0, z0, x1, z1).length > 0 || ruinsNear(gen, x0, z0, x1, z1).length > 0 ||
    igloosNear(gen, x0, z0, x1, z1).length > 0 || buriedRuinsNear(gen, x0, z0, x1, z1).length > 0 ||
    wrecksNear(gen, x0, z0, x1, z1).length > 0;
}

/** Do two {x0,z0,x1,z1} rectangles overlap (padded by `pad`)? */
export const boxesOverlap = (a, b, pad = 0) => a.x0 - pad <= b.x1 && a.x1 + pad >= b.x0 && a.z0 - pad <= b.z1 && a.z1 + pad >= b.z0;
