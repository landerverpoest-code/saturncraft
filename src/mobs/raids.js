// Marauder Patrols and village Raids (the reference game's pillager patrols,
// Bad Omen and raids, under Saturncraft's own names).
//
// * Patrols: once the world is a few days old, roughly every 10 minutes there
//   is a chance that a band of 2-5 Marauders turns up 24-48 blocks from the
//   player on the open surface. Its leader, the Captain, carries a banner on
//   its back; the others follow it. A player who kills a Captain (outside a
//   raid) gets Dark Omen for 100 minutes (a further Captain raises its level).
// * Raids: walking into a village (near its settlers) with Dark Omen uses the
//   omen up and starts a raid: 3-5 waves of Marauders (more with a stronger
//   omen) come in from the village edge and go for the settlers, who hide in
//   their houses. A wave ends when all its raiders are dead; after the last
//   wave the raid is won (Village Champion: cheaper trades) — it is lost when
//   every settler is dead or the time limit runs out.
//
// The pure parts (timing, sizes, the RaidState machine) are unit tested; the
// Raids class ties them to the game. Saving: the patrol timer and the raid's
// state machine are saved with the world; raiders are saved with their
// chunks like any persistent mob and keep their raid tag, so a reloaded raid
// carries on from the wave it was in (a raid whose raiders were lost counts
// that wave as cleared). Only the single player world or the multiplayer host
// runs patrols and raids; guests see the raiders but not the raid bar.
import { villagesNear } from '../world/villages.js';
import { SOLID, OPAQUE, isFluid } from '../world/blocks.js';
import { effectLevel } from '../player/effects.js';

export const DAY_TICKS = 24000;
/** Patrols only come once the world is three days old. */
export const PATROL_MIN_TIME = 3 * DAY_TICKS;
/** About ten minutes between patrol checks (plus up to five more at random). */
export const PATROL_INTERVAL = 12000;
export const PATROL_CHANCE = 0.2;
export const PATROL_MIN_DIST = 24;
export const PATROL_MAX_DIST = 48;
/** Dark Omen lasts 100 minutes; Village Champion 40. */
export const OMEN_TICKS = 100 * 60 * 20;
export const CHAMPION_TICKS = 40 * 60 * 20;
export const MAX_OMEN_LEVEL = 5;
/** A raid must be over within 40 minutes. */
export const RAID_TIME_LIMIT = 40 * 60 * 20;
/** Pause before each wave (15 s). */
export const WAVE_DELAY = 300;
/** How close to a village's centre the player has to come (with settlers around) to start a raid. */
export const RAID_TRIGGER_DIST = 40;
/** Settlers and raiders this close to the centre belong to the raid. */
export const RAID_RADIUS = 72;
/** Raiders arrive this far from the village centre. */
export const RAID_EDGE = 44;

// ---- patrols ---------------------------------------------------------------------

/** Ticks until the next patrol check: 10-15 minutes. */
export function nextPatrolDelay(rng = Math.random) { return PATROL_INTERVAL + Math.floor(rng() * PATROL_INTERVAL / 2); }

/**
 * May a patrol come now? `time` is the world time in ticks; patrols keep away
 * from villages, need hostile mobs on and only roam the overworld.
 */
export function patrolAllowed({ time, dimension = 'overworld', hostile = true, nearVillage = false, playerDead = false }) {
  return time >= PATROL_MIN_TIME && dimension === 'overworld' && hostile && !nearVillage && !playerDead;
}

/** One patrol check: allowed and the 20 % chance comes up. */
export function patrolRoll(env, rng = Math.random) { return patrolAllowed(env) && rng() < PATROL_CHANCE; }

/** 2-5 Marauders (the Captain included). */
export function patrolSize(rng = Math.random) { return 2 + Math.floor(rng() * 4); }

/** A spot 24-48 blocks from (px, pz) in a random direction. */
export function patrolSpot(px, pz, rng = Math.random) {
  const a = rng() * Math.PI * 2, r = PATROL_MIN_DIST + rng() * (PATROL_MAX_DIST - PATROL_MIN_DIST);
  return { x: Math.floor(px + Math.cos(a) * r), z: Math.floor(pz + Math.sin(a) * r) };
}

/** Can a patrol member stand here: on solid opaque ground, feet and head free of blocks and fluids, open sky. */
export function validPatrolGround(below, feet, head, skyLight) {
  return !!SOLID[below] && !!OPAQUE[below] && !isFluid(below) && !SOLID[feet] && !isFluid(feet) && !SOLID[head] && !isFluid(head) && skyLight >= 8;
}

// ---- omen and champion -------------------------------------------------------------

/** The Dark Omen amplifier after killing a Captain: one level more than now (0 = none), at most V. */
export function omenAfterCaptainKill(currentLevel) { return Math.min(MAX_OMEN_LEVEL, currentLevel + 1) - 1; }

/** Price cut from Village Champion: 30 % + 6.25 % per level above I (reference), none without it. */
export function championDiscount(effects) {
  const lvl = effectLevel(effects, 'village_champion');
  return lvl ? Math.min(0.6, 0.3 + 0.0625 * (lvl - 1)) : 0;
}

// ---- raid state machine ------------------------------------------------------------

/** Number of waves for an omen level: I = 3, II = 4, III+ = 5. */
export function raidWaves(omenLevel) { return Math.max(3, Math.min(5, 2 + omenLevel)); }

/** Raiders in wave `wave` (1-based): more each wave and with the omen level, at most 12. */
export function waveSize(wave, omenLevel) { return Math.min(12, 1 + wave + omenLevel); }

export const RAID = { WAITING: 'waiting', WAVE: 'wave', WON: 'won', LOST: 'lost' };

let nextRaidId = 1;

export class RaidState {
  constructor({ cx = 0, cz = 0, omenLevel = 1, id = null } = {}) {
    this.id = id || `r${Date.now().toString(36)}${nextRaidId++}`;
    this.cx = cx; this.cz = cz;
    this.omenLevel = Math.max(1, Math.min(MAX_OMEN_LEVEL, omenLevel | 0));
    this.totalWaves = raidWaves(this.omenLevel);
    this.state = RAID.WAITING;
    this.wave = 0;           // waves started so far
    this.waveCount = 0;      // raiders sent in the current wave
    this.alive = 0;          // raiders of the current wave still alive
    this.countdown = WAVE_DELAY;
    this.elapsed = 0;
    this.reason = null;      // why a lost raid was lost: 'settlers' | 'time'
  }

  get done() { return this.state === RAID.WON || this.state === RAID.LOST; }

  /**
   * Advance by `dt` ticks with the current counts: `raiders` alive in the raid,
   * `settlers` alive in the village. Returns events for the game to act on:
   * { type: 'wave', wave, count } (send that many raiders), { type: 'won' },
   * { type: 'lost', reason }.
   */
  step(dt, { raiders = 0, settlers = 1 } = {}) {
    if (this.done) return [];
    this.elapsed += dt;
    if (settlers <= 0) return this.lose('settlers');
    if (this.elapsed >= RAID_TIME_LIMIT) return this.lose('time');
    if (this.state === RAID.WAITING) {
      this.countdown -= dt;
      if (this.countdown > 0) return [];
      this.wave++;
      this.state = RAID.WAVE;
      this.waveCount = this.alive = waveSize(this.wave, this.omenLevel);
      return [{ type: 'wave', wave: this.wave, count: this.waveCount }];
    }
    // a wave is under way
    this.alive = Math.max(0, raiders);
    if (this.alive > 0) return [];
    if (this.wave >= this.totalWaves) { this.state = RAID.WON; return [{ type: 'won' }]; }
    this.state = RAID.WAITING;
    this.countdown = WAVE_DELAY;
    return [];
  }

  lose(reason) { this.state = RAID.LOST; this.reason = reason; return [{ type: 'lost', reason }]; }

  /** Raid bar fill 0..1: the share of the wave still alive, or filling up before the next wave. */
  progress() {
    if (this.state === RAID.WAVE) return this.waveCount ? Math.min(1, this.alive / this.waveCount) : 0;
    if (this.state === RAID.WAITING) return Math.max(0, Math.min(1, 1 - this.countdown / WAVE_DELAY));
    return this.state === RAID.WON ? 1 : 0; // a full green bar for a victory, an empty one for a defeat
  }

  /** The raid bar's caption. */
  label() {
    if (this.state === RAID.WON) return 'Raid - Victory';
    if (this.state === RAID.LOST) return 'Raid - Defeat';
    if (this.state === RAID.WAVE) return `Raid - Wave ${this.wave}/${this.totalWaves} - ${this.alive} raider${this.alive === 1 ? '' : 's'} left`;
    return this.wave ? `Raid - Wave ${this.wave + 1}/${this.totalWaves} approaching` : 'Raid';
  }

  save() {
    const { id, cx, cz, omenLevel, state, wave, waveCount, alive, countdown, elapsed } = this;
    return { id, cx, cz, omenLevel, state, wave, waveCount, alive, countdown, elapsed };
  }

  /** A raid from saved data (null for anything unusable or already over). */
  static load(d) {
    if (!d || typeof d !== 'object' || !Number.isFinite(d.cx) || !Number.isFinite(d.cz)) return null;
    if (d.state !== RAID.WAITING && d.state !== RAID.WAVE) return null;
    const r = new RaidState({ cx: d.cx, cz: d.cz, omenLevel: d.omenLevel, id: typeof d.id === 'string' ? d.id : null });
    r.state = d.state;
    r.wave = Math.max(0, Math.min(r.totalWaves, d.wave | 0));
    r.waveCount = Math.max(0, d.waveCount | 0);
    r.alive = Math.max(0, d.alive | 0);
    r.countdown = Number.isFinite(d.countdown) ? d.countdown : WAVE_DELAY;
    r.elapsed = Number.isFinite(d.elapsed) ? Math.max(0, d.elapsed) : 0;
    if (r.state === RAID.WAVE && r.wave === 0) r.state = RAID.WAITING;
    return r;
  }
}

// ---- marauder behaviour ------------------------------------------------------------

/**
 * Marauder AI: a player in sight is always fought (strafing archery); raiders
 * otherwise hunt the village's settlers or march on its centre; patrol members
 * keep close to their Captain, who leads them across the land.
 */
export function marauderAI(m, g, p, pdist) {
  if (m.raider && !m.raidCenter && g.raids) g.raids.adopt(m); // loaded from a save
  if (m.acquire(g, p, pdist, m.def.followRange)) return m.rangedAI(g, p, pdist);
  if (m.raider && m.raidCenter) return raiderAI(m, g);
  const lead = m.patrolLeader;
  if (lead && (lead.dead || lead.deathTime > 0)) m.patrolLeader = null;
  else if (lead) {
    const d = Math.hypot(lead.x - m.x, lead.z - m.z);
    if (d > 5) { m.chase(g, lead, d > 12 ? 1.1 : 0.9); return; }
  }
  if (m.captain && m.patrolGoal) {
    const d = Math.hypot(m.patrolGoal.x - m.x, m.patrolGoal.z - m.z);
    if (d < 3 || --m.patrolGoal.t <= 0) m.patrolGoal = null;
    else {
      if (!m.path || g.ticks % 60 === m.id % 60) m.pathTo(g, m.patrolGoal.x, m.y, m.patrolGoal.z);
      if (!m.followPath(g, 0.8)) m.steer(m.patrolGoal.x, m.patrolGoal.z, 0.8);
      return;
    }
  }
  if (m.captain && !m.patrolGoal && Math.random() < 1 / 200) {
    const a = Math.random() * Math.PI * 2;
    m.patrolGoal = { x: Math.floor(m.x + Math.cos(a) * 24), z: Math.floor(m.z + Math.sin(a) * 24), t: 1200 };
  }
  m.rangedAI(g, p, pdist);
}

function raiderAI(m, g) {
  const c = m.raidCenter;
  const prey = m.prey;
  if (prey && (prey.dead || prey.deathTime > 0 || Math.hypot(prey.x - m.x, prey.z - m.z) > 48)) m.prey = null;
  if (!m.prey && g.ticks % 20 === m.id % 20) {
    let best = null, bd = 48;
    for (const e of g.entities.list) {
      if (e.kind !== 'mob' || !e.def.villager || e.dead || e.deathTime > 0) continue;
      const d = Math.hypot(e.x - m.x, e.z - m.z);
      if (d < bd && Math.hypot(e.x - c.x, e.z - c.z) < RAID_RADIUS) { bd = d; best = e; }
    }
    m.prey = best;
  }
  const t = m.prey;
  if (t) {
    const d = Math.hypot(t.x - m.x, t.z - m.z);
    const see = d < 14 && m.canSee(g, t.x, t.eyeY, t.z);
    if (see) {
      // stand and shoot
      m.path = null;
      m.target = 'raid'; // raises the crossbow arm (animation only; never the player)
      m.yaw += ((Math.atan2(-(t.x - m.x), -(t.z - m.z)) - m.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * 0.5;
      if (d > 6) m.chase(g, t, 0.6);
      if (++m.bowCharge >= 20 && m.attackCooldown <= 0) { m.shoot(g, t); m.bowCharge = 0; m.attackCooldown = 40; }
      return;
    }
    if (m.target === 'raid') m.target = null;
    m.bowCharge = 0;
    m.chase(g, t, 1);
    return;
  }
  if (m.target === 'raid') m.target = null;
  const dc = Math.hypot(c.x - m.x, c.z - m.z);
  if (dc > 6) {
    if (!m.path || g.ticks % 40 === m.id % 40) m.pathTo(g, Math.floor(c.x), Math.floor(m.y), Math.floor(c.z));
    if (!m.followPath(g, 1)) m.steer(c.x, c.z, 1);
  } else m.wanderAI(g, 1);
}

// ---- the game side -----------------------------------------------------------------

export class Raids {
  constructor(game) {
    this.game = game;
    this.patrolTimer = nextPatrolDelay();
    this.raid = null;
    this.endShown = 0;   // ticks the finished raid's bar stays up
  }

  /** The local player (the one whose omen and rewards these are). */
  get player() { return this.game.localPlayer || this.game.player; }

  hostile() { return this.game.spawner ? this.game.spawner.hostileEnabled() : true; }

  /** Is there a raid going on close to (x, z)? Settlers hide indoors then. */
  activeNear(x, z) {
    const r = this.raid;
    return !!r && !r.done && Math.hypot(x - r.cx, z - r.cz) < RAID_RADIUS;
  }

  villageAt(x, z, dist) {
    const g = this.game;
    if (!g.world.gen) return null;
    return villagesNear(g.world.gen, x - dist, z - dist, x + dist, z + dist).find((v) => Math.hypot(v.cx - x, v.cz - z) < dist) || null;
  }

  /** Every 20 ticks on the host. */
  tick() {
    const g = this.game, p = this.player;
    if (!g.world || g.ticks % 20 !== 0) return;
    const overworld = !g.world.dimension || g.world.dimension === 'overworld';
    // patrols
    if (overworld && (this.patrolTimer -= 20) <= 0) {
      this.patrolTimer = nextPatrolDelay();
      if (patrolRoll({ time: g.time, hostile: this.hostile(), nearVillage: !!this.villageAt(p.x, p.z, 96), playerDead: p.dead })) this.spawnPatrol();
    }
    // an omen carried into a village starts a raid
    if (!this.raid && overworld && p.effects && p.effects.dark_omen && !p.dead && this.hostile()) {
      const v = this.villageAt(p.x, p.z, RAID_TRIGGER_DIST);
      if (v && this.settlersNear(v.cx, v.cz, RAID_RADIUS) > 0 && this.settlersNear(p.x, p.z, 32) > 0) this.start(v.cx, v.cz, effectLevel(p.effects, 'dark_omen'));
    }
    const r = this.raid;
    if (!r) { this.showBar(null); return; }
    if (r.done) {
      if ((this.endShown -= 20) <= 0) { this.raid = null; this.showBar(null); }
      return;
    }
    if (!overworld) return; // the raid waits while the player is away in another dimension
    const events = r.step(20, { raiders: this.raidersAlive(r), settlers: this.settlersNear(r.cx, r.cz, RAID_RADIUS) });
    for (const e of events) {
      if (e.type === 'wave') this.spawnWave(r, e.count);
      else if (e.type === 'won') this.won(r);
      else if (e.type === 'lost') this.lost(r);
    }
    this.showBar(r);
  }

  showBar(r) {
    const hud = this.game.hud;
    if (hud && hud.raidBar) hud.raidBar(r ? { label: r.label(), progress: r.progress(), state: r.state } : null);
  }

  settlersNear(x, z, dist) {
    let n = 0;
    for (const e of this.game.entities.list) if (e.kind === 'mob' && e.def.villager && !e.dead && e.deathTime === 0 && Math.hypot(e.x - x, e.z - z) < dist) n++;
    return n;
  }

  raidersAlive(r) {
    let n = 0;
    for (const e of this.game.entities.list) if (e.kind === 'mob' && e.raider && e.raidId === r.id && !e.dead && e.deathTime === 0) n++;
    return n;
  }

  /** Start a raid on the village at (cx, cz); the omen is used up. */
  start(cx, cz, omenLevel = 1) {
    const g = this.game, p = this.player;
    if (p.effects && p.effects.dark_omen) {
      delete p.effects.dark_omen;
      for (const f of (p.listeners && p.listeners.effect) || []) f(null);
    }
    this.raid = new RaidState({ cx, cz, omenLevel });
    if (g.hud) g.hud.toast('A raid is coming! Defend the village');
    if (g.audio) g.audio.play('hmm', [cx, p.y, cz]);
    return this.raid;
  }

  stop() { this.raid = null; this.showBar(null); }

  /** Raiders arrive together at one point on the village edge. */
  spawnWave(r, count) {
    const g = this.game, w = g.world;
    for (let tries = 0; tries < 16; tries++) {
      const a = Math.random() * Math.PI * 2;
      const x = Math.floor(r.cx + Math.cos(a) * RAID_EDGE), z = Math.floor(r.cz + Math.sin(a) * RAID_EDGE);
      if (!w.isLoaded(x, z)) continue;
      const y = w.heightAt(x, z) + 1;
      if (isFluid(w.getBlock(x, y - 1, z)) || isFluid(w.getBlock(x, y, z))) continue;
      for (let i = 0; i < count; i++) {
        const sx = x + (Math.random() - 0.5) * 4, sz = z + (Math.random() - 0.5) * 4;
        const m = g.spawner.spawnMob('marauder', sx, w.heightAt(Math.floor(sx), Math.floor(sz)) + 1, sz);
        if (!m) continue;
        m.raider = true; m.raidId = r.id; m.raidCenter = { x: r.cx, z: r.cz }; m.persistent = true;
        if (i === 0) m.captain = true; // each wave marches behind a banner (no omen from these)
      }
      return true;
    }
    return false;
  }

  won(r) {
    const g = this.game, p = this.player;
    this.endShown = 100;
    if (p.addEffect) p.addEffect('village_champion', CHAMPION_TICKS, r.omenLevel - 1);
    if (g.hud) g.hud.toast('Victory! The village is saved', 4000);
    if (g.milestones) g.milestones.event('raid');
    if (g.audio) g.audio.play('levelup');
    if (g.entities.spawnXp) g.entities.spawnXp(p.x, p.y + 1, p.z, 20 * r.omenLevel);
  }

  lost(r) {
    const g = this.game;
    this.endShown = 100;
    if (g.hud) g.hud.toast(r.reason === 'time' ? 'The raiders outlasted you - raid lost' : 'The village has fallen - raid lost', 4000);
  }

  /** A band of 2-5 Marauders led by a Captain, 24-48 blocks away on the surface. Returns the members. */
  spawnPatrol() {
    const g = this.game, w = g.world, p = this.player;
    for (let tries = 0; tries < 8; tries++) {
      const s = patrolSpot(p.x, p.z);
      if (!w.isLoaded(s.x, s.z)) continue;
      const y = w.heightAt(s.x, s.z) + 1;
      if (!validPatrolGround(w.getBlock(s.x, y - 1, s.z), w.getBlock(s.x, y, s.z), w.getBlock(s.x, y + 1, s.z), w.skyLight(s.x, y, s.z))) continue;
      const n = patrolSize();
      const out = [];
      for (let i = 0; i < n; i++) {
        const x = s.x + (i ? Math.floor(Math.random() * 5) - 2 : 0), z = s.z + (i ? Math.floor(Math.random() * 5) - 2 : 0);
        const yy = w.heightAt(x, z) + 1;
        if (i && !validPatrolGround(w.getBlock(x, yy - 1, z), w.getBlock(x, yy, z), w.getBlock(x, yy + 1, z), 15)) continue;
        const m = g.spawner.spawnMob('marauder', x + 0.5, yy, z + 0.5);
        if (!m) continue;
        m.persistent = true; // patrols roam by day too
        if (!out.length) m.captain = true; else m.patrolLeader = out[0];
        out.push(m);
      }
      return out;
    }
    return [];
  }

  /** A Marauder died: a Captain killed by the player (outside a raid) brings Dark Omen. */
  onCaptainKilled(mob, killedByPlayer) {
    if (!mob.captain || mob.raider || !killedByPlayer) return;
    const p = this.player;
    if (!p.addEffect || p.dead) return;
    const amp = omenAfterCaptainKill(effectLevel(p.effects, 'dark_omen'));
    if (p.effects.dark_omen && p.effects.dark_omen.amp < amp) delete p.effects.dark_omen; // a higher level replaces it outright
    p.addEffect('dark_omen', OMEN_TICKS, amp);
    if (this.game.hud) this.game.hud.toast('A dark omen falls upon you...');
  }

  save() { return { patrolTimer: this.patrolTimer, raid: this.raid && !this.raid.done ? this.raid.save() : null }; }

  load(d) {
    if (!d || typeof d !== 'object') return;
    if (Number.isFinite(d.patrolTimer)) this.patrolTimer = Math.max(20, Math.min(PATROL_INTERVAL * 2, d.patrolTimer));
    this.raid = RaidState.load(d.raid);
  }

  /** Raiders loaded from a save re-join the raid they belong to. */
  adopt(mob) {
    if (!mob.raider) return;
    const r = this.raid;
    if (r && mob.raidId === r.id) mob.raidCenter = { x: r.cx, z: r.cz };
    else { mob.raider = false; mob.raidId = null; } // its raid is over: an ordinary Marauder now
  }
}
