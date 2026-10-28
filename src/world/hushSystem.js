// The Deep Hush at run time (rules in world/deepHush.js): players make
// vibrations (walking without sneaking, landing, placing and breaking
// blocks, opening doors and chests, flipping levers, eating, tossing items),
// and so do creatures walking about, arrows landing, explosions and deaths
// (world/vibrations.js lists the kinds and their frequencies). A Hush Sensor
// within 8 blocks hears one unless wool blocks the line, sends a cinnabar
// pulse (power 15 close by down to 1 at the edge) for 30 ticks, then rests 10;
// a comparator reads the vibration's frequency while it pulses. When a
// player's vibration sets a sensor off, Hush Shriekers near it shriek; a
// world-grown one raises that player's warning level and pulses Darkness over
// everyone within 40 blocks (a stepped-on shrieker shrieks too). At warning 4
// a Hushkeeper (mobs/hushkeeper.js) digs up out of the ground nearby. A Hush
// Catalyst drinks in the experience of creatures dying within 8 blocks and
// spreads Hushmoss from where they fell. The recent noises are kept for the
// Hushkeeper, which hunts by sound. Simulated on the host (or in single
// player): guests' footsteps and landings are worked out from the positions
// they send (remoteVibration), the blocks they place and break come with
// their edits, the rest (eating, doors, levers, chests, dropped items) as a
// 'vib' message (net/session.js); each player has a warning level of their
// own, and a shriek's Darkness reaches guests as an effect message. Guests see
// the block changes and the mob (rising / sinking included).
import { B, SOLID } from './blocks.js';
import { HUSHKEEPER } from '../mobs/hushkeeper.js';
import {
  VIBRATION_RANGE, SENSOR_PULSE, SENSOR_REST, WARNING_MAX, DARKNESS_TICKS, DARKNESS_RANGE, SHRIEKER_CAN_SUMMON,
  WarningLevels, sensorPower, sensorHears, quietStep, deathCharge, spreadHushmoss, findEmergeSpot, findNear,
} from './deepHush.js';
import { vibrationFrequency, sensorMeta, occluded, findListeners, GUEST_KINDS } from './vibrations.js';

const LISTENERS = new Set([B.HUSH_SENSOR, B.HUSH_SHRIEKER]);
const CATALYSTS = new Set([B.HUSH_CATALYST]);
export const NOISE_MEMORY = 60, SHRIEK_REST = 90, KEEPER_RANGE = 48;
/** Creatures walking about shake the ground too: one step per MOB_STEP_EVERY ticks at most each. */
export const MOB_STEP_EVERY = 10;
/** A guest's step: at least this far (blocks) between two of their states, at most every REMOTE_STEP_EVERY ticks. */
export const REMOTE_STEP_MOVE = 0.1, REMOTE_STEP_EVERY = 8;

/**
 * Footsteps and landings of a player we only know from the states it sends (a guest on the host).
 * `t` keeps what the last states were ({} to start); `s` is the new state ({ x, y, z, sneaking,
 * riding, dead }), `now` the tick and `below` the block under its feet. Returns 'land', 'step' or null.
 */
export function remoteVibration(t, s, now, below) {
  const prev = t.last;
  t.last = { x: s.x, y: s.y, z: s.z };
  if (!prev || s.dead) { t.peak = null; return null; }
  if (s.riding) { t.peak = null; return null; }
  const dy = s.y - prev.y;
  if (dy < -0.05) { t.peak = Math.max(t.peak ?? prev.y, prev.y); return null; } // falling
  if (t.peak != null) {
    const fell = t.peak - s.y;
    t.peak = null;
    if (fell > 0.5 && SOLID[below]) return 'land';
  }
  if (dy > 0.05) return null; // going up: a jump (or climbing, flying)
  const moved = Math.hypot(s.x - prev.x, s.z - prev.z);
  if (moved < REMOTE_STEP_MOVE || !SOLID[below] || now - (t.lastStep ?? -1e9) < REMOTE_STEP_EVERY || quietStep(s.sneaking, below)) return null;
  t.lastStep = now;
  return 'step';
}

export class HushSystem {
  constructor(game) {
    this.game = game;
    this.noises = [];              // recent vibrations: { x, y, z, t, kind, player }
    this.warnings = new WarningLevels();
    this.rest = new Map();         // "x,y,z" -> tick a sensor / shrieker can hear again
    this.lastStep = 0;
    this.remote = new Map();       // guest name -> what remoteVibration keeps of them (multiplayer host)
  }

  get now() { return this.game.ticks; }
  playerName(p) { return (p && p.netName) || 'player'; }

  /** Once a tick, after the player has moved (before landedFrom is cleared). */
  tick() {
    const g = this.game, p = g.player, now = this.now;
    if (this.noises.length && now - this.noises[0].t > NOISE_MEMORY) this.noises = this.noises.filter((n) => now - n.t <= NOISE_MEMORY);
    if (now % 20 === 0) this.warnings.decay(now);
    if (g.net && g.net.isHost) this.tickRemote();
    if (g.net && g.net.isClient) return;
    this.tickMobs();
    if (!p || p.dead || p.spectator) return;
    const b = p.body;
    const below = g.world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.2), Math.floor(b.z));
    if (p.landedFrom > 0.5) this.vibrate(b.x, b.y, b.z, 'land', p);
    else if (b.onGround && Math.hypot(b.vx, b.vz) > 0.05 && !p.riding && now - this.lastStep >= (p.sprinting ? 6 : 10) && !quietStep(p.sneaking, below)) {
      this.lastStep = now;
      this.vibrate(b.x, b.y, b.z, 'step', p, below === B.HUSH_SHRIEKER ? [Math.floor(b.x), Math.floor(b.y - 0.2), Math.floor(b.z)] : null);
    }
  }

  /** Footsteps of creatures walking on the ground (not the Hushkeeper's own: it treads softly). */
  tickMobs() {
    const g = this.game, w = g.world, now = this.now, list = g.entities ? g.entities.list : [];
    for (const e of list) {
      if (e.kind !== 'mob' || e.dead || e.deathTime || e.type === 'hushkeeper' || ((now + e.id) % MOB_STEP_EVERY) !== 0) continue;
      const b = e.body;
      if (!b || !b.onGround || Math.hypot(b.vx, b.vz) < 0.03 || e.mount) continue;
      if (quietStep(!!e.sneaking, w.getBlock(Math.floor(b.x), Math.floor(b.y - 0.2), Math.floor(b.z)))) continue;
      this.vibrate(b.x, b.y, b.z, 'step', null);
    }
  }

  /**
   * Something a player did shakes the ground (eating, a door, a lever, a dropped item...). On a
   * multiplayer guest it goes to the host as a 'vib' message (only the host's sensors listen).
   */
  emit(kind, x, y, z, player = this.game.player) {
    const g = this.game;
    if (g.net && g.net.isClient) {
      if (player === g.player && GUEST_KINDS.has(kind) && g.net.sendVibration) g.net.sendVibration(kind, x, y, z);
      return null;
    }
    return this.vibrate(x, y, z, kind, player);
  }

  /** Multiplayer host: the guests' footsteps and landings, from each new state they sent. */
  tickRemote() {
    const g = this.game, w = g.world, seen = new Set();
    for (const pl of g.net.players().slice(1)) {
      const rp = pl.c && pl.c.rp, s = rp && rp.state;
      if (!s) continue;
      seen.add(pl.name);
      let t = this.remote.get(pl.name);
      if (!t) { t = {}; this.remote.set(pl.name, t); }
      if (t.state === s) continue; // nothing new from them since the last tick
      t.state = s;
      const bx = Math.floor(s.x), by = Math.floor(s.y - 0.2), bz = Math.floor(s.z), below = w.getBlock(bx, by, bz);
      const kind = remoteVibration(t, s, this.now, below);
      if (kind) this.vibrate(s.x, s.y, s.z, kind, pl.obj, kind === 'step' && below === B.HUSH_SHRIEKER ? [bx, by, bz] : null);
    }
    for (const k of this.remote.keys()) if (!seen.has(k)) this.remote.delete(k);
  }

  /**
   * A vibration of `kind` at (x, y, z) made by `player` (null for other sources). Returns what reacted:
   * { sensors: [...], shrieked: [...], level } (level = the player's warning level after it, -1 if unchanged).
   */
  vibrate(x, y, z, kind, player = null, steppedOn = null) {
    const g = this.game, w = g.world, now = this.now;
    this.noises.push({ x, y, z, t: now, kind, player: !!player });
    if (this.noises.length > 48) this.noises.shift();
    const out = { sensors: [], shrieked: [], level: -1 };
    if (g.net && g.net.isClient) return out;
    const near = findListeners(w, x, y, z, VIBRATION_RANGE, LISTENERS);
    if (!near.length) return out;
    const freq = vibrationFrequency(kind), getBlock = (a, b, c) => w.getBlock(a, b, c);
    for (const s of near) {
      if (s.id !== B.HUSH_SENSOR) continue;
      const k = `${s.x},${s.y},${s.z}`;
      if (!sensorHears(s.d, w.getMeta(s.x, s.y, s.z), this.rest.get(k) || 0, now)) continue;
      if (occluded(getBlock, x, y, z, s.x + 0.5, s.y + 0.5, s.z + 0.5)) continue; // wool in the way
      this.rest.set(k, now + SENSOR_PULSE + SENSOR_REST);
      w.setBlock(s.x, s.y, s.z, B.HUSH_SENSOR, sensorMeta(sensorPower(s.d), freq));
      if (w.scheduleTick) w.scheduleTick(s.x, s.y, s.z, SENSOR_PULSE);
      out.sensors.push(s);
      this.pulseFx(x, y, z, s);
    }
    if (!player) return out;
    // shriekers: the one stepped on, or those near a sensor the player set off
    const stepped = (s) => !!steppedOn && s.x === steppedOn[0] && s.y === steppedOn[1] && s.z === steppedOn[2];
    const shriekers = near.filter((s) => s.id === B.HUSH_SHRIEKER && (out.sensors.length || stepped(s)) && (this.rest.get(`${s.x},${s.y},${s.z}`) || 0) <= now);
    if (!shriekers.length) return out;
    // only a world-grown shrieker raises the warning (a placed one only shrieks)
    const summons = (s) => (w.getMeta(s.x, s.y, s.z) & SHRIEKER_CAN_SUMMON) !== 0;
    if (shriekers.some(summons)) out.level = this.warnings.raise(this.playerName(player), now);
    let calledOut = false;
    for (const s of shriekers) {
      const can = summons(s);
      if (can && (out.level < 0 || calledOut)) continue;
      this.rest.set(`${s.x},${s.y},${s.z}`, now + SHRIEK_REST);
      this.shriek(s, player, can);
      out.shrieked.push(s);
      if (can) calledOut = true;
    }
    if (out.level >= WARNING_MAX) this.summon(player);
    return out;
  }

  /** Cinnabar-red specks running from the sound to the sensor that heard it, and a click. */
  pulseFx(x, y, z, s) {
    const g = this.game;
    if (g.audio) g.audio.play('hush_sensor', [s.x + 0.5, s.y + 0.5, s.z + 0.5]);
    if (!g.particles) return;
    const tx = s.x + 0.5, ty = s.y + 0.8, tz = s.z + 0.5, d = Math.hypot(tx - x, ty - y, tz - z) || 1, sp = 0.45;
    for (let k = 0; k < 3; k++) g.particles.emit(x, y + 0.3, z, (tx - x) / d * sp, (ty - y - 0.3) / d * sp, (tz - z) / d * sp, 0.95, 0.28, 0.16, Math.ceil(d / sp) - k * 2, 0);
    for (let k = 0; k < 6; k++) g.particles.emit(tx, ty, tz, (Math.random() - 0.5) * 0.1, 0.05 + Math.random() * 0.05, (Math.random() - 0.5) * 0.1, 0.95, 0.3, 0.2, 16, 0);
  }

  /** A shriek: a dreadful sound, rising rings, and for a world-grown shrieker Darkness over the players near it. */
  shriek(s, player, summons) {
    const g = this.game, x = s.x + 0.5, y = s.y + 1, z = s.z + 0.5;
    if (g.audio) {
      const p = g.player, d = p ? Math.hypot(p.x - x, p.y - y, p.z - z) : 0;
      if (d < 16) g.audio.play('shriek', [x, y, z], 1.4); else if (d < DARKNESS_RANGE) g.audio.play('shriek', null, 0.35 * (1 - d / DARKNESS_RANGE));
    }
    if (g.particles) for (let ring = 0; ring < 3; ring++) for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      g.particles.emit(x, y + ring * 0.4, z, Math.cos(a) * 0.08, 0.12 + ring * 0.03, Math.sin(a) * 0.08, 0.35, 0.95, 0.9, 30, 0);
    }
    if (!summons) return;
    const p = g.player;
    if (p && !p.dead && Math.hypot(p.x - x, p.y - y, p.z - z) <= DARKNESS_RANGE && p.addEffect) p.addEffect('darkness', DARKNESS_TICKS, 0);
    // guests near it too: their stand-in passes the effect on to their own game (an 'eff' message)
    if (g.net && g.net.isHost) for (const pl of g.net.players().slice(1)) {
      const o = pl.obj;
      if (o && !o.dead && Math.hypot(o.x - x, o.y - y, o.z - z) <= DARKNESS_RANGE && o.addEffect) o.addEffect('darkness', DARKNESS_TICKS, 0);
    }
    // a Hushkeeper already about comes to look
    for (const e of this.keepers(x, y, z)) { e.investigate = [x, y, z]; e.lastDisturb = this.now; }
  }

  keepers(x, y, z, r = KEEPER_RANGE) {
    const list = this.game.entities ? this.game.entities.list : [];
    return list.filter((e) => e.type === 'hushkeeper' && !e.dead && e.deathTime === 0 && !(e.digging > 0) && Math.hypot(e.x - x, e.y - y, e.z - z) <= r);
  }

  /** Warning level 4: a Hushkeeper digs up out of the ground near the player (unless one is already close). */
  summon(player) {
    const g = this.game, now = this.now;
    const near = this.keepers(player.x, player.y, player.z);
    if (near.length) {
      for (const e of near) { e.investigate = [player.x, player.y, player.z]; e.anger = Math.min(HUSHKEEPER.ANGER_MAX, (e.anger || 0) + HUSHKEEPER.NOISE_ANGER); e.lastDisturb = now; }
      return near[0];
    }
    const at = findEmergeSpot(g.world, player.x, player.y, player.z);
    if (!at || !g.spawner) return null;
    const m = g.spawner.spawnMob('hushkeeper', at[0], at[1], at[2]);
    if (!m) return null;
    m.emerging = HUSHKEEPER.EMERGE;
    m.lastDisturb = now;
    m.yaw = Math.atan2(-(player.x - m.x), -(player.z - m.z));
    if (g.audio) g.audio.play('emerge', [m.x, m.y + 1, m.z], 1.5);
    return m;
  }

  /** A creature died: a catalyst within 8 blocks takes its experience. Returns true when the orbs were absorbed. */
  onMobDeath(mob) {
    const g = this.game;
    if (g.net && g.net.isClient) return false;
    this.vibrate(mob.x, mob.y + 0.5, mob.z, 'death', null);
    const charge = deathCharge(mob.def, mob.age < 0);
    if (!charge) return false;
    const cats = findNear(g.world, mob.x, mob.y + 0.5, mob.z, 8, CATALYSTS);
    if (!cats.length) return false;
    const c = cats[0];
    spreadHushmoss(g.world, mob.x, mob.y, mob.z, charge, Math.random, [c.x, c.y, c.z]);
    if (g.audio) g.audio.play('catalyst', [c.x + 0.5, c.y + 1, c.z + 0.5]);
    if (g.particles) for (let k = 0; k < 14; k++) g.particles.emit(c.x + 0.5 + (Math.random() - 0.5), c.y + 1.05, c.z + 0.5 + (Math.random() - 0.5), 0, 0.04 + Math.random() * 0.05, 0, 0.3, 0.95, 0.88, 24, 0);
    return !!mob.killedByPlayer;
  }

  /** Placing or breaking a block shakes the ground (interaction.js). */
  blockEvent(x, y, z, kind, player) { return this.vibrate(x + 0.5, y + 0.5, z + 0.5, kind, player); }
}
