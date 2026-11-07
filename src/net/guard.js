// Host-side sanity for what guests send, and the bandwidth rules. Pure (no network, no DOM), so it is unit-tested.
//
// A guest's own game is trusted for its inventory (it saves it itself), so the host cannot prove an item is real;
// what it can do is refuse floods: edits, drops, pickups, hits, chat and clicks are metered per guest with token
// buckets sized well above what a human does, and a guest that keeps hitting the limits is told off (and kicked
// at the extreme). Reach checks for each action live in session.js (`near`).

/** A bucket that refills `rate` tokens a second up to `burst`. */
export class TokenBucket {
  constructor(rate, burst, now = 0) { this.rate = rate; this.burst = burst; this.tokens = burst; this.at = now; }
  /** Take `n` tokens: true if they were there. */
  take(n = 1, now = this.at) {
    const dt = Math.max(0, now - this.at);
    this.at = now;
    this.tokens = Math.min(this.burst, this.tokens + dt * this.rate / 1000);
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/** Per-kind limits: [tokens per second, burst]. Generous for people, tight for scripts. */
export const LIMITS = {
  ed: [80, 400],      // block edits (placing / breaking; a fast creative builder does about 20 a second)
  spawn: [8, 40],     // drops, throws, arrows
  take: [40, 80],     // pickup requests
  hit: [16, 24],      // melee and arrow hits
  pvp: [10, 12],
  chat: [2, 6],       // chat lines (also commands)
  cset: [40, 80],     // container clicks
  mi: [10, 20],       // interactions with mobs
  trade: [8, 16],
  steer: [60, 120],   // reins of a mount
  boat: [40, 80],     // a driven boat's position
  misc: [20, 60],     // signs, frames, pots, lecterns, campfires, notes, ropes...
};
/** Message type -> limit kind. Anything not listed is `misc` (and only metered when it changes the world). */
export const KIND_OF = {
  ed: 'ed', spawn: 'spawn', take: 'take', hit: 'hit', pvp: 'pvp', chat: 'chat', cmd: 'chat', scmd: 'chat', cset: 'cset', mi: 'mi', trade: 'trade', gift: 'trade',
  steer: 'steer', boat: 'boat', sign: 'misc', frame: 'misc', pot: 'misc', lectern: 'misc', camp: 'misc', note: 'misc', vault: 'misc', fence: 'misc', fuel: 'misc', boxput: 'misc', boom: 'misc', sthit: 'misc', stuse: 'misc', bhit: 'misc',
};
export const STRIKES_WARN = 40;   // dropped messages (within STRIKE_WINDOW_MS) before the host is told
export const STRIKES_KICK = 4000; // ... and before the guest is removed
export const STRIKE_WINDOW_MS = 10000;

/** The meters of one guest. */
export class GuestMeter {
  constructor(now = 0) {
    this.buckets = {};
    for (const k of Object.keys(LIMITS)) this.buckets[k] = new TokenBucket(LIMITS[k][0], LIMITS[k][1], now);
    this.strikes = 0; this.strikeAt = now; this.warned = false; this.dropped = 0;
  }
  /** May this message go through? `n` = how much it costs (an edit batch counts one per block). */
  allow(type, now, n = 1) {
    const kind = KIND_OF[type];
    if (!kind) return true;
    if (now - this.strikeAt > STRIKE_WINDOW_MS) { this.strikes = 0; this.strikeAt = now; this.warned = false; } // the count is per window
    if (this.buckets[kind].take(n, now)) return true;
    this.dropped++;
    this.strikes++;
    return false;
  }
  /** 'ok', 'warn' (tell the host once) or 'kick'. */
  verdict() { return this.strikes >= STRIKES_KICK ? 'kick' : this.strikes >= STRIKES_WARN && !this.warned ? 'warn' : 'ok'; }
}

/** How many edits of a batch may pass: the bucket decides edit by edit (so a legal prefix still lands). */
export function allowedEdits(meter, count, now) {
  let ok = 0;
  while (ok < count && meter.allow('ed', now)) ok++;
  return ok;
}

// ---- how often far things are resent ------------------------------------------------------
export const RATE_NEAR = 32;   // blocks: everything closer is sent with every snapshot
export const RATE_MID = 56;    // up to here every 2nd snapshot (5 Hz), beyond every 4th (2.5 Hz)
/**
 * Snapshots between two sends of an entity at `dist` blocks. Mobs, items and orbs thin out with distance; fast
 * little things (arrows), boats and falling blocks stay at full rate while in range. `pressure` (0, 1 or 2: a guest
 * whose connection is backing up) pulls the rings in.
 */
export function updateEvery(kind, dist, pressure = 0) {
  if (kind === 'arrow' || kind === 'boat' || kind === 'falling' || kind === 'cloud') return 1;
  const k = pressure ? 1 / (1 + pressure) : 1;
  if (dist < RATE_NEAR * k) return 1;
  if (dist < RATE_MID * k) return 2;
  return 4;
}
/** Does entity `id` go out in snapshot number `n`? (the phase differs per entity, so the far ones do not all come at once) */
export const sendsNow = (every, id, n) => every <= 1 || ((n + (id | 0)) % every === 0);

/** "1.2 KB/s" for a rate in characters (about bytes) per second. */
export const rateText = (bps) => (bps >= 1024 ? `${(bps / 1024).toFixed(bps >= 10240 ? 0 : 1)} KB/s` : `${Math.round(bps || 0)} B/s`);

/** Bytes per second, smoothed. */
export class Rate {
  constructor() { this.bytes = 0; this.bps = 0; this.at = 0; }
  add(n) { this.bytes += n; }
  tick(now) {
    if (!this.at) { this.at = now; return this.bps; }
    const dt = now - this.at;
    if (dt >= 1000) { this.bps = Math.round(this.bps * 0.5 + (this.bytes * 1000 / dt) * 0.5); this.bytes = 0; this.at = now; }
    return this.bps;
  }
}
