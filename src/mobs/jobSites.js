// Job-site blocks: a settler without a trade claims the nearest free job-site
// block within 48 blocks and takes up the trade that goes with it (a small
// green burst shows it). Each block serves one settler. Breaking a claimed
// block costs the settler its trade only if nobody has traded with it yet;
// otherwise it keeps the trade and looks for another block of the same kind.
// The claim (mob.jobSite) and whether it has traded (mob.traded) are saved
// with the settler. The host runs all of this; guests see the robe colour
// through the mob snapshot's profession field.
import { B, BLOCK_LIMIT } from '../world/blocks.js';
import { MIN_Y, MAX_Y, cidx } from '../world/constants.js';
import { makeTrades } from './trades.js';

/** Trade -> its job-site blocks (the first is the one villages build). */
export const JOB_SITES = {
  farmer: [B.COMPOSTER],
  librarian: [B.LECTERN],
  smith: [B.BLAST_FURNACE, B.BLAST_FURNACE_LIT],
  shepherd: [B.LOOM],
  butcher: [B.SMOKER, B.SMOKER_LIT],
  fletcher: [B.FLETCHING_TABLE],
  cleric: [B.BREWING_STAND],
  cartographer: [B.CARTOGRAPHY_DESK], // (last: the order numbers the trades)
};
const TRADES = Object.keys(JOB_SITES);
/** Block id -> 1 + index of its trade in TRADES (0: not a job site). */
const SITE_TRADE = new Uint8Array(BLOCK_LIMIT);
TRADES.forEach((t, k) => { for (const id of JOB_SITES[t]) SITE_TRADE[id] = k + 1; });

export const isJobSite = (id) => SITE_TRADE[id] > 0;
/** The trade a block is the job site of, or null. */
export const jobSiteProfession = (id) => (SITE_TRADE[id] ? TRADES[SITE_TRADE[id] - 1] : null);
/** The block a village builds for a trade. */
export const jobSiteBlock = (profession) => (JOB_SITES[profession] ? JOB_SITES[profession][0] : 0);

export const CLAIM_RADIUS = 48;
/** How far above and below a settler it looks for a block. */
export const CLAIM_DY = 12;
/** Ticks between a settler's looks round for a block / checks on its own. */
export const SEARCH_TICKS = 100, CHECK_TICKS = 20;

export const siteKey = (s) => `${s.x},${s.y},${s.z}`;

/** Keys of every job site held by a settler in `mobs` (other than `except`). */
export function claimedSites(mobs, except = null) {
  const out = new Set();
  for (const m of mobs) if (m !== except && m.jobSite && !m.dead && !(m.deathTime > 0)) out.add(siteKey(m.jobSite));
  return out;
}

/**
 * The nearest unclaimed job-site block within `radius` of (x, y, z) in the
 * loaded chunks of `world` (anything with getChunk(cx, cz) -> { blocks }),
 * only of `profession` when given. Returns { x, y, z, profession } or null.
 */
export function findJobSite(world, x, y, z, claimed = new Set(), { radius = CLAIM_RADIUS, dy = CLAIM_DY, profession = null } = {}) {
  const want = profession ? TRADES.indexOf(profession) + 1 : 0;
  if (profession && !want) return null;
  const fy = Math.floor(y), y0 = Math.max(MIN_Y, fy - dy), y1 = Math.min(MAX_Y, fy + dy);
  const r2 = radius * radius;
  let best = null, bd = Infinity;
  for (let cx = Math.floor((x - radius) / 16); cx <= Math.floor((x + radius) / 16); cx++) {
    for (let cz = Math.floor((z - radius) / 16); cz <= Math.floor((z + radius) / 16); cz++) {
      const c = world.getChunk(cx, cz);
      if (!c) continue;
      const blocks = c.blocks, end = cidx(15, y1, 15);
      for (let i = cidx(0, y0, 0); i <= end; i++) {
        const t = SITE_TRADE[blocks[i]];
        if (!t || (want && t !== want)) continue;
        const bx = cx * 16 + (i & 15), bz = cz * 16 + ((i >> 4) & 15), by = (i >> 8) + MIN_Y;
        const d = (bx + 0.5 - x) ** 2 + (by + 0.5 - y) ** 2 + (bz + 0.5 - z) ** 2;
        if (d > r2 || d >= bd) continue;
        const s = { x: bx, y: by, z: bz, profession: TRADES[t - 1] };
        if (claimed.has(siteKey(s))) continue;
        best = s; bd = d;
      }
    }
  }
  return best;
}

/**
 * Claim a site for a settler. A settler without a trade takes up the site's
 * (fresh offers): returns true then - the caller shows the green burst.
 */
export function takeJobSite(mob, site, time = 0) {
  mob.jobSite = { x: site.x, y: site.y, z: site.z };
  if (mob.profession === site.profession) return false;
  mob.profession = site.profession;
  mob.trades = makeTrades(site.profession);
  mob.lastRestock = time;
  mob.traded = false;
  return true;
}

/**
 * The settler's site is gone: it lets go of the claim, and loses its trade
 * (and offers) unless it has already traded. Returns 'lost' or 'kept'.
 */
export function releaseJobSite(mob) {
  mob.jobSite = null;
  if (mob.traded) return 'kept';
  mob.profession = null; mob.trades = [];
  return 'lost';
}

/**
 * Is the settler's claimed block still there? Returns null when it is (or its
 * chunk is not loaded, so nobody can tell), else what releaseJobSite did.
 */
export function checkJobSite(mob, world) {
  const s = mob.jobSite;
  if (!s) return null;
  if (!world.getChunk(s.x >> 4, s.z >> 4)) return null;
  if (jobSiteProfession(world.getBlock(s.x, s.y, s.z)) === mob.profession) return null;
  return releaseJobSite(mob);
}

/** A saved claim, checked: { x, y, z } of integers or null. */
export function cleanJobSite(s) {
  if (!s || typeof s !== 'object') return null;
  const { x, y, z } = s;
  return [x, y, z].every((v) => Number.isInteger(v) && Math.abs(v) < 3e7) ? { x, y, z } : null;
}
