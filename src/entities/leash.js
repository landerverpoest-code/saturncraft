// Leads (reference: lead): right-clicking an animal with a Lead leashes it to the
// player. A leashed animal walks after its holder once the rope is longer than
// 3 blocks, is pulled ever harder past 6 and the lead snaps (dropping it) past 12.
// Right-clicking a fence with animals in tow ties them to a Fence Knot on that
// post; right-clicking the post again takes them back. Mobs save who holds
// them (the player, or the fence post) and find their holder again on load.
// Multiplayer: the host runs leads for everyone (a guest's lead is held by its
// stand-in, net/remotePlayer.js); guests see the ropes and knots from the
// mob snapshots and ask the host to leash, tie and untie (net/session.js).
import * as THREE from 'three';
import { BLOCKS, SHAPE } from '../world/blocks.js';
import { I } from '../world/items.js';

/** Rope lengths (blocks): slack up to LEAD_SLACK, walks after the holder within LEAD_FOLLOW,
 *  pulled past LEAD_PULL, snaps past LEAD_SNAP. */
export const LEAD_SLACK = 3, LEAD_PULL = 6, LEAD_FOLLOW = 10, LEAD_SNAP = 12;

/** What the lead does at distance `d`: 'slack', 'follow' (the mob walks after its holder), 'pull' or 'snap'. */
export function leashState(d) {
  if (d > LEAD_SNAP) return 'snap';
  if (d > LEAD_PULL) return 'pull';
  if (d > LEAD_SLACK) return 'follow';
  return 'slack';
}

/** Extra speed (blocks/tick) the rope drags the mob toward its holder with at distance `d`. */
export function leashPull(d) {
  if (d <= LEAD_PULL || d > LEAD_SNAP) return 0;
  return Math.min(0.3, (d - LEAD_PULL) * 0.05);
}

/** Can this mob be put on a lead? Animals only (not settlers, not monsters, not the ridden or dying). */
export function canLeash(mob) {
  return !!(mob && mob.kind === 'mob' && mob.def && mob.def.category === 'creature' && !mob.def.villager && !mob.def.aquatic && mob.deathTime === 0 && !mob.dead);
}

/** Is block `id` a fence post a lead can be tied to? */
export const isFencePost = (id) => !!(BLOCKS[id] && BLOCKS[id].shape === SHAPE.FENCE);

/** Rope length drawn between two ends `d` apart: a good sag when close, nearly taut at the snapping point. */
export function ropeLength(d) {
  return d + Math.max(0.04, 1.1 - d * 0.09);
}

/**
 * Points of a hanging rope (a catenary) of length `len` from A to B, n + 1 points as a flat
 * [x, y, z, ...] array. When the rope is shorter than the span it is drawn straight.
 */
export function catenaryPoints(ax, ay, az, bx, by, bz, len, n = 16) {
  const out = new Float32Array((n + 1) * 3);
  const hx = bx - ax, hz = bz - az, h = Math.hypot(hx, hz), v = by - ay;
  const chord = Math.hypot(h, v);
  const straight = (k) => { const t = k / n; out[k * 3] = ax + hx * t; out[k * 3 + 1] = ay + v * t; out[k * 3 + 2] = az + hz * t; };
  if (h < 1e-3) {
    // hanging straight down: the slack folds below the lower end
    const low = Math.min(ay, by) - Math.max(0, (len - chord) / 2);
    for (let k = 0; k <= n; k++) {
      const t = k / n, y = t < 0.5 ? ay + (low - ay) * t * 2 : low + (by - low) * (t - 0.5) * 2;
      out[k * 3] = ax; out[k * 3 + 1] = y; out[k * 3 + 2] = az;
    }
    return out;
  }
  if (!(len > chord * 1.0005)) { for (let k = 0; k <= n; k++) straight(k); return out; }
  // solve 2a sinh(h / 2a) = sqrt(len² - v²) for the catenary parameter a (bisection on a log scale)
  const target = Math.sqrt(len * len - v * v);
  let lo = Math.log(1e-4), hi = Math.log(1e5);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2, a = Math.exp(mid);
    const f = 2 * a * Math.sinh(h / (2 * a));
    if (!(f <= target)) lo = mid; else hi = mid; // too long (or overflow): a bigger a flattens the curve
  }
  const a = Math.exp((lo + hi) / 2);
  const x0 = h / 2 - a * Math.asinh(v / (2 * a * Math.sinh(h / (2 * a))));
  const c = ay - a * Math.cosh(-x0 / a);
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = h * t;
    out[k * 3] = ax + hx * t;
    out[k * 3 + 1] = a * Math.cosh((x - x0) / a) + c;
    out[k * 3 + 2] = az + hz * t;
  }
  out[n * 3 + 1] = by; // exact end
  return out;
}

let nextKnotId = 8_000_000;

/** The knot of rope a lead makes round a fence post (holds the mobs tied to it). */
export class LeashKnot {
  constructor(bx, by, bz) {
    this.id = nextKnotId++;
    this.kind = 'knot';
    this.bx = bx; this.by = by; this.bz = bz;
    this.x = bx + 0.5; this.y = by + 0.62; this.z = bz + 0.5;
    this.prev = [this.x, this.y, this.z];
    this.dead = false;
  }

  /** Mobs tied to this knot. */
  tied(game) { return game.entities.list.filter((e) => e.kind === 'mob' && e.leashHolder === this && !e.removed); }

  tick(game) {
    const tied = this.tied(game);
    if (this.mirrored) { if (!tied.length) this.dead = true; return; } // a guest's copy: the host decides about the post

    if (!isFencePost(game.world.getBlock(this.bx, this.by, this.bz))) {
      // the post is gone: every lead comes loose and drops
      for (const m of tied) unleash(game, m, true);
      this.dead = true;
      return;
    }
    if (!tied.length) this.dead = true;
  }

  createMesh() {
    const mat = new THREE.MeshLambertMaterial({ color: 0xb08a5a });
    const g = new THREE.Group();
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.34), mat);
    const loop = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1), mat);
    loop.position.set(0.2, -0.1, 0);
    g.add(band, loop);
    g.userData.mats = [mat];
    return g;
  }

  renderUpdate(m, px, py, pz, alpha, L) {
    m.position.set(px, py, pz);
    m.userData.mats[0].color.setRGB(0.69 * L, 0.54 * L, 0.35 * L);
  }
}

/** The knot on the fence post at bx,by,bz (made when missing and `create`). */
export function knotAt(game, bx, by, bz, create = false) {
  let k = game.entities.list.find((e) => e.kind === 'knot' && !e.dead && e.bx === bx && e.by === by && e.bz === bz);
  if (!k && create) k = game.entities.add(new LeashKnot(bx, by, bz));
  return k || null;
}

/** Take a mob off its lead; `drop` leaves the Lead item where it was. */
export function unleash(game, mob, drop) {
  if (!mob.leashHolder && !mob.leashPending) return;
  mob.leashHolder = null; mob.leashPending = null;
  if (drop) game.entities.spawnItem(mob.x, mob.y + 0.5, mob.z, { id: I.LEAD, count: 1, damage: 0 });
}

/** Put a mob on a lead held by `holder` (the player or a LeashKnot). */
export function leash(mob, holder) {
  mob.leashHolder = holder; mob.leashPending = null;
  mob.persistent = true;
  mob.wander = null; mob.path = null;
}

/**
 * Is `p` the player holding this lead? On the host a guest's interaction runs with a stand-in
 * derived from that guest's target object, so the same guest counts as the same holder.
 */
export const isHolder = (h, p) => !!h && !!p && (h === p || (!!p.remote && h.remote === p.remote));

/** Mobs held by the player. */
export const heldBy = (game, holder) => game.entities.list.filter((e) => e.kind === 'mob' && e.leashHolder === holder && !e.dead);

/** Tie every mob the player leads to the fence post at bx,by,bz. Returns how many were tied. */
export function tieToFence(game, bx, by, bz, holder = game.localPlayer || game.player) {
  const mobs = heldBy(game, holder);
  if (!mobs.length) return 0;
  const k = knotAt(game, bx, by, bz, true);
  for (const m of mobs) leash(m, k);
  return mobs.length;
}

/** Take the mobs tied at the post bx,by,bz back on the player's (or `holder`'s) leads. Returns how many. */
export function untieFromFence(game, bx, by, bz, holder = game.localPlayer || game.player) {
  const k = knotAt(game, bx, by, bz);
  if (!k) return 0;
  const mobs = k.tied(game);
  for (const m of mobs) leash(m, holder);
  k.dead = true;
  return mobs.length;
}

/** What a mob's save keeps of its lead. */
export function leashSaveData(mob) {
  const h = mob.leashHolder;
  if (h && h.kind === 'knot') return { knot: [h.bx, h.by, h.bz] };
  if (h) return { player: true };
  return mob.leashPending || undefined;
}

/**
 * A mob's lead each tick (before it moves): find a saved holder again, snap when too far,
 * walk after the holder and get dragged when the rope is stretched.
 */
export function leashTick(game, mob) {
  if (mob.leashPending) {
    const s = mob.leashPending;
    mob.leashPending = null;
    if (Array.isArray(s.knot)) {
      const [bx, by, bz] = s.knot.map((v) => v | 0);
      if (isFencePost(game.world.getBlock(bx, by, bz))) leash(mob, knotAt(game, bx, by, bz, true));
      else { mob.leashPending = s; unleash(game, mob, true); }
    } else if (s.player) {
      const p = game.localPlayer || game.player;
      mob.leashHolder = p; mob.leashPending = s; // reattached below unless too far
      if (p.dead || Math.hypot(p.x - mob.x, p.y - mob.y, p.z - mob.z) > LEAD_SNAP) unleash(game, mob, true);
      else leash(mob, p);
    }
  }
  const h = mob.leashHolder;
  if (!h) return;
  if (mob.deathTime > 0 || mob.dead || h.dead || (h.kind === 'knot' && !game.entities.list.includes(h))) { unleash(game, mob, true); return; }
  const hy = h.kind === 'knot' ? h.y : h.y + 1;
  const dx = h.x - mob.x, dy = hy - (mob.y + mob.height * 0.7), dz = h.z - mob.z;
  const d = Math.hypot(dx, dy, dz);
  const state = leashState(d);
  if (state === 'snap') { unleash(game, mob, true); game.audio && game.audio.play('break_wood', [mob.x, mob.y + 1, mob.z], 0.5); return; }
  if (state === 'slack' || mob.rider) return;
  mob.wander = null; mob.path = null;
  mob.steer(h.x, h.z, d > LEAD_FOLLOW ? 1.6 : d > LEAD_PULL ? 1.35 : 1.1);
  const k = leashPull(d), b = mob.body, hd = Math.hypot(dx, dz) || 1;
  if (k > 0) {
    b.vx += (dx / hd) * k; b.vz += (dz / hd) * k;
    if (dy > 1 && b.onGround) b.vy = Math.max(b.vy, 0.3); // hauled up a step or ledge
  }
}
