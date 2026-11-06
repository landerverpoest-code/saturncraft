// The Slag Colossus: the Cinderdeep's set-piece boss, an abandoned smith's guardian of Scorched Bricks and
// Slagsteel that wakes in a Cinderforge courtyard when a Slagheart Sigil is used inside it (right-click; the
// sigil is made from Slagsteel Ingots, Ember Rods, a Dirge Crystal and Obsidian). The courtyard is the arena.
//
// Three phases, by health (the boss bar shows the thresholds):
//  1 (above 66 %)  - walks you down and hits hard in melee. SLAM: it rears up (arms overhead, a warning ring
//                    spreads on the floor), then a shockwave runs out across the floor: jump it. It throws a
//                    Slag Ball when you keep your distance. After a slam it needs a moment to recover: hit it then.
//  2 (66 % - 33 %) - the furnace in its chest flares and it calls two Cinder Brutes. Faster, throws three Slag
//                    Balls, and LAVA PILLARS: spots marked on the floor (a ring of flame) burst after a second.
//  3 (below 33 %)  - enraged. Everything comes quicker, five pillars, and it CHARGES: it plants itself, paws the
//                    ground (a telegraph), then rushes the way it faced. Dodge aside and it runs into a wall and is
//                    stunned (takes half again as much damage); otherwise it barrels through you for a hit.
// Moving to the next phase it cannot be hurt for a moment (a blow cannot carry it past a threshold either).
// A wounded Colossus nobody is fighting cools off and withdraws after a minute, leaving the sigil behind.
// Host-simulated like every mob: guests see the usual 10 Hz mob copy, and its poses (arms up = `angry`, stunned or
// shielded = `special`) are drawn from those flags on every screen (customRender), including the warning flames.
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { I } from '../world/items.js';
import { Fireball } from '../entities/fireball.js';
import { faceTowards, groundBelow } from './dimensionMobs.js';
import { forgesNear, nearestForge, FORGE_HALF } from '../world/dimensions/cinderForge.js';
import { toWorld } from '../world/siteKit.js';

export const COLOSSUS = {
  HEALTH: 400, ARMOR: 6, MELEE: 12, SPEED: 0.2,
  PHASE_AT: [0.66, 0.33],
  AGGRO: 48,
  // slam: windup, the spreading wave, what a hit costs, how long it is left open, and the gap between slams per phase
  SLAM_WINDUP: 34, SLAM_RADIUS: 7, SLAM_SPEED: 0.9, SLAM_DAMAGE: 14, SLAM_CLEAR: 1.0, SLAM_RECOVER: 26, SLAM_COOLDOWN: [150, 115, 80],
  // slag balls
  HURL_DAMAGE: 7, HURL_COOLDOWN: [120, 95, 70], HURL_MIN_RANGE: 6,
  // lava pillars (phase 2 and 3)
  PILLARS: [0, 3, 5], PILLAR_WARN: 36, PILLAR_RADIUS: 1.7, PILLAR_DAMAGE: 9, PILLAR_COOLDOWN: [0, 220, 150],
  // charge (phase 3)
  CHARGE_WINDUP: 30, CHARGE_TICKS: 24, CHARGE_SPEED: 3.4, CHARGE_DAMAGE: 14, CHARGE_COOLDOWN: 190, STUN: 80, STUN_VULNERABLE: 1.5,
  SHIELD: 50, INTRO: 70, ADDS: [0, 2, 1], ADDS_MAX: 3,
  LEASH: 22, GIVE_UP: 1200, REGEN: 0.1,
  CHASE: [1, 1.15, 1.3],
};
const K = COLOSSUS;
const TAU = Math.PI * 2;

// ---- pure rules (unit tested) ---------------------------------------------------------
/** Phase 1, 2 or 3 for a health fraction. */
export const phaseOf = (frac) => (frac > K.PHASE_AT[0] ? 1 : frac > K.PHASE_AT[1] ? 2 : 3);
/** Health the Colossus cannot be hurt below until it has moved to the next phase (0 in the last one). */
export const phaseFloor = (phase, max = K.HEALTH) => (phase >= 3 ? 0 : K.PHASE_AT[phase - 1] * max);
/** A blow's damage clamped so it stops at the phase threshold; the next AI step then starts the transition. */
export function clampToPhase(health, dmg, phase, max = K.HEALTH) {
  const floor = phaseFloor(phase, max);
  return floor > 0 && health - dmg < floor ? Math.max(0, health - floor) : dmg;
}
/** Does the shockwave, now at radius `r` (it was at `r - K.SLAM_SPEED` a tick ago), strike a player `dh` away horizontally and `dy` above the floor? Jumping over it works. */
export const waveStrikes = (r, dh, dy) => dh <= r && dh > r - K.SLAM_SPEED - 1.2 && dy < K.SLAM_CLEAR && r <= K.SLAM_RADIUS + 1;
/** Does a bursting lava pillar reach a player `dh` from its centre, `dy` above the floor there? */
export const pillarStrikes = (dh, dy) => dh <= K.PILLAR_RADIUS && dy > -1 && dy < 4;
/** Damage multiplier on the Colossus: stunned, it takes half again as much. */
export const damageFactor = (stunned) => (stunned ? K.STUN_VULNERABLE : 1);

/** The forge whose courtyard (and some head room above it) holds this point, or null. */
export function forgeAt(gen, x, y, z) {
  if (!gen) return null;
  for (const f of forgesNear(gen, x, z, x, z)) {
    if (Math.abs(x - f.cx) <= FORGE_HALF && Math.abs(z - f.cz) <= FORGE_HALF && y > f.y - 1 && y < f.y + 8) return f;
  }
  return null;
}
/** Where the Colossus rises: between the lava pit and the back wall (local 0, -6), on the floor. */
export function riseSpot(f) {
  const [dx, dz] = toWorld(f.dir, 0, -6);
  return { x: f.cx + dx + 0.5, y: f.y + 1, z: f.cz + dz + 0.5 };
}

const alive = (e) => e && e.kind === 'mob' && !e.dead && e.deathTime === 0 && !e.removed;
/** The Colossi standing in this world (there is one at a time). */
export const colossiIn = (list) => list.filter((e) => e.type === 'slag_colossus' && alive(e));

/**
 * Use a Slagheart Sigil: wakes the Colossus if the player stands in a Cinderforge courtyard and none is up.
 * Returns { ok, msg, mob }. The caller removes the sigil when ok.
 */
export function summonColossus(g, x, y, z) {
  if (g.world.dimension !== 'cinderdeep') return { ok: false, msg: 'The sigil is cold. It only answers in a Cinderforge of the Cinderdeep' };
  if (g.net && g.net.isClient) return { ok: false, msg: 'Only the host can wake the Colossus' };
  if (g.difficulty === 'peaceful' || (g.settings && g.settings.hostileMobs === false)) return { ok: false, msg: 'The embers stay dark while hostile mobs are off' };
  const f = forgeAt(g.world.dimGenerator, x, y, z);
  if (!f) return { ok: false, msg: 'The sigil flickers. Stand in a Cinderforge courtyard to wake the Colossus' };
  if (colossiIn(g.entities.list).length) return { ok: false, msg: 'The Colossus already stands' };
  const s = riseSpot(f);
  const m = g.spawner.spawnMob('slag_colossus', s.x, s.y, s.z);
  m.arena = { x: f.cx + 0.5, y: f.y + 1, z: f.cz + 0.5 };
  m.cs = 'shield'; m.ct = K.INTRO; m.cphase = 1; m.intro = true;
  m.yaw = Math.atan2(-(x - s.x), -(z - s.z));
  g.audio.play('colossus_roar', [s.x, s.y + 2, s.z], 1);
  g.audio.play('colossus_slam', [s.x, s.y, s.z], 1);
  for (let k = 0; k < 60; k++) g.particles.emit(s.x + (Math.random() - 0.5) * 3, s.y + Math.random() * 5, s.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 0.2, 0.1 + Math.random() * 0.15, (Math.random() - 0.5) * 0.2, 1, 0.55, 0.15, 40, -0.004);
  return { ok: true, msg: 'The Slag Colossus rises from the coals', mob: m };
}

// ---- the fight ------------------------------------------------------------------------
/** Every living, targetable player this host knows (the guests' too, in a shared world). */
function targetsOf(g, p) {
  const list = g.net && g.net.isHost && g.net.players ? g.net.players().map((pl) => pl.obj) : [p];
  return list.filter((t) => t && !t.dead && !t.creative);
}

function init(m, g) {
  m.cs = m.cs || 'walk'; m.ct = m.ct || 0; m.cphase = m.cphase || 1;
  m.cd = { slam: 90, hurl: 80, pillar: 160, charge: 120 };
  m.pillars = []; m.wave = null; m.away = 0; m.hitCharge = false;
  if (!m.arena) {
    const gen = g.world && g.world.dimGenerator;
    const f = gen && forgesNear(gen, m.x, m.z, m.x, m.z)[0] || (gen && nearestForge(gen, m.x, m.z, 2));
    m.arena = f ? { x: f.cx + 0.5, y: f.y + 1, z: f.cz + 0.5 } : { x: m.x, y: m.y, z: m.z };
  }
}

const ring = (g, x, y, z, r, n, vy = 0.02, rgb = [1, 0.5, 0.12]) => {
  for (let k = 0; k < n; k++) {
    const a = k / n * TAU;
    g.particles.emit(x + Math.cos(a) * r, y + 0.15, z + Math.sin(a) * r, 0, vy, 0, rgb[0], rgb[1], rgb[2], 14, 0);
  }
};

function hurlSlag(m, g, t, phase) {
  const n = phase >= 2 ? 3 : 1;
  const fx = m.x - Math.sin(m.yaw) * 1.8, fy = m.y + 3.7, fz = m.z - Math.cos(m.yaw) * 1.8;
  for (let k = 0; k < n; k++) {
    const tx = t.x + (k - (n - 1) / 2) * 2.2, ty = t.y + 1, tz = t.z + (k - (n - 1) / 2) * 1.2;
    const dx = tx - fx, dy = ty - fy, dz = tz - fz, l = Math.hypot(dx, dy, dz) || 1;
    g.entities.add(new Fireball(fx, fy, fz, dx / l * 0.8, dy / l * 0.8, dz / l * 0.8, m, { power: 0, damage: K.HURL_DAMAGE, size: 0.5 }));
  }
  g.audio.play('ignite', [m.x, m.y + 3, m.z], 0.9);
}

function spawnAdds(m, g, n) {
  const near = g.entities.list.filter((e) => e.type === 'cinder_brute' && alive(e) && Math.hypot(e.x - m.arena.x, e.z - m.arena.z) < 30).length;
  for (let k = 0; k < n && near + k < K.ADDS_MAX; k++) {
    const a = Math.random() * TAU, x = m.arena.x + Math.cos(a) * 8, z = m.arena.z + Math.sin(a) * 8;
    const brute = g.spawner.spawnMob('cinder_brute', x, m.arena.y, z);
    if (brute) brute.yaw = Math.random() * TAU;
    for (let q = 0; q < 14; q++) g.particles.emit(x, m.arena.y + Math.random() * 2, z, 0, 0.08, 0, 1, 0.5, 0.1, 24, 0);
  }
}

function markPillars(m, g, t, phase) {
  const n = K.PILLARS[phase - 1];
  for (let k = 0; k < n; k++) {
    const off = k === 0 ? [0, 0] : [(Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9];
    const x = t.x + off[0], z = t.z + off[1];
    // only inside the courtyard, on the floor
    if (Math.abs(x - m.arena.x) > FORGE_HALF - 1 || Math.abs(z - m.arena.z) > FORGE_HALF - 1) continue;
    const y = groundBelow(g, x, m.arena.y + 3, z, 10);
    if (y === null) continue;
    m.pillars.push({ x, y, z, t: K.PILLAR_WARN });
  }
  g.audio.play('colossus_roar', [m.x, m.y + 3, m.z], 0.6);
}

function tickPillars(m, g, players) {
  for (const pl of m.pillars) {
    pl.t--;
    if (pl.t > 0) {
      if (pl.t % 3 === 0) ring(g, pl.x, pl.y, pl.z, K.PILLAR_RADIUS * (0.6 + 0.4 * (1 - pl.t / K.PILLAR_WARN)), 10, 0.015);
      continue;
    }
    for (let q = 0; q < 28; q++) g.particles.emit(pl.x + (Math.random() - 0.5) * 1.6, pl.y + Math.random() * 3, pl.z + (Math.random() - 0.5) * 1.6, 0, 0.18 + Math.random() * 0.2, 0, 1, 0.5 + Math.random() * 0.3, 0.1, 30, -0.004);
    g.audio.play('colossus_erupt', [pl.x, pl.y, pl.z], 0.9);
    for (const t of players) {
      if (!pillarStrikes(Math.hypot(t.x - pl.x, t.z - pl.z), t.y - pl.y)) continue;
      if (t.hurt(K.PILLAR_DAMAGE, 'mob:Slag Colossus', m) !== false) { if (t.fireTicks !== undefined) t.fireTicks = Math.max(t.fireTicks, 80); t.body && (t.body.vy = Math.max(t.body.vy, 0.6)); }
    }
  }
  m.pillars = m.pillars.filter((pl) => pl.t > 0);
}

function tickWave(m, g, players) {
  const w = m.wave;
  if (!w) return;
  w.r += K.SLAM_SPEED;
  ring(g, m.x, m.y, m.z, w.r, Math.max(12, Math.round(w.r * 5)), 0.03);
  for (const t of players) {
    if (w.hit.has(t)) continue;
    if (!waveStrikes(w.r, Math.hypot(t.x - m.x, t.z - m.z), t.y - m.y)) continue;
    w.hit.add(t);
    if (t.hurt(K.SLAM_DAMAGE, 'mob:Slag Colossus', m) !== false && t.body) {
      const kx = t.x - m.x, kz = t.z - m.z, kl = Math.hypot(kx, kz) || 1;
      t.body.vx += kx / kl * 0.9; t.body.vz += kz / kl * 0.9; t.body.vy = 0.5;
    }
  }
  if (w.r > K.SLAM_RADIUS + 1) m.wave = null;
}

function setState(m, cs, ticks) { m.cs = cs; m.ct = ticks; m.path = null; }

export function colossusAI(m, g, p, pdist) {
  if (m.cd === undefined) init(m, g);
  const b = m.body, phase = m.cphase, players = targetsOf(g, p);
  for (const k in m.cd) if (m.cd[k] > 0) m.cd[k]--;
  m.angry = false; m.special = false;
  tickPillars(m, g, players);
  tickWave(m, g, players);

  const sees = !p.dead && !p.creative && pdist < K.AGGRO;
  m.target = sees ? 'player' : null;
  m.away = sees ? 0 : m.away + 1;
  // nobody to fight: it cools off and mends, and after a minute withdraws, leaving the sigil where it stood
  if (!sees && m.cs === 'walk') {
    m.health = Math.min(K.HEALTH, m.health + K.REGEN);
    if (m.away > K.GIVE_UP && !m.intro) {
      g.entities.spawnItem(m.arena.x, m.arena.y + 0.5, m.arena.z, { id: I.SLAG_SIGIL, count: 1 });
      m.removed = m.dead = true;
      return;
    }
  }

  // moving up a phase: a moment of shielding, a shove to make room, and company
  const want = phaseOf(m.health / K.HEALTH);
  if (want > m.cphase && m.cs !== 'shield') {
    m.cphase = m.cphase + 1;
    setState(m, 'shield', K.SHIELD);
    m.wave = null;
    g.audio.play('colossus_roar', [m.x, m.y + 3, m.z], 1);
    for (const t of players) if (Math.hypot(t.x - m.x, t.z - m.z) < 8 && t.body) {
      const kx = t.x - m.x, kz = t.z - m.z, kl = Math.hypot(kx, kz) || 1;
      t.body.vx += kx / kl * 1.2; t.body.vz += kz / kl * 1.2; t.body.vy = Math.max(t.body.vy, 0.45);
    }
    spawnAdds(m, g, K.ADDS[m.cphase - 1]);
  }

  if (m.cs === 'shield') {
    m.angry = true; m.special = true; m.move = null; m.path = null;
    if (g.ticks % 2 === 0) ring(g, m.x, m.y, m.z, 1.4 + (m.ct % 10) * 0.25, 8, 0.05, [1, 0.7, 0.2]);
    if (--m.ct <= 0) { m.intro = false; setState(m, 'walk', 0); }
    return;
  }

  const dx = p.x - m.x, dz = p.z - m.z, dh = Math.hypot(dx, dz);
  const ci = Math.min(2, m.cphase - 1);
  // keep to the arena: past the leash it turns back to the middle instead of following you out
  const home = Math.hypot(m.x - m.arena.x, m.z - m.arena.z);

  switch (m.cs) {
    case 'slamWind': {
      m.angry = true; m.move = null;
      faceTowards(m, p.x, p.z, 0.15);
      if (m.ct % 4 === 0) ring(g, m.x, m.y, m.z, K.SLAM_RADIUS * (1 - m.ct / K.SLAM_WINDUP), 14, 0.01, [1, 0.35, 0.1]); // the warning ring creeps out
      if (--m.ct <= 0) {
        m.wave = { r: 1.5, hit: new Set() };
        g.audio.play('colossus_slam', [m.x, m.y, m.z], 1);
        setState(m, 'recover', K.SLAM_RECOVER);
        m.cd.slam = K.SLAM_COOLDOWN[ci];
      }
      return;
    }
    case 'recover': {
      m.move = null; m.special = true; // open to a hit: the head hangs
      if (--m.ct <= 0) setState(m, 'walk', 0);
      return;
    }
    case 'chargeWind': {
      m.angry = true; m.move = null;
      if (m.ct > 8) faceTowards(m, p.x, p.z, 0.25); else if (!m.lock) m.lock = m.yaw;
      if (g.ticks % 2 === 0) g.particles.emit(m.x + (Math.random() - 0.5) * 2, m.y + 0.2, m.z + (Math.random() - 0.5) * 2, 0, 0.05, 0, 1, 0.45, 0.1, 18, 0); // paws the ground
      if (--m.ct <= 0) { m.yaw = m.lock; m.lock = null; m.hitCharge = false; setState(m, 'charge', K.CHARGE_TICKS); g.audio.play('colossus_roar', [m.x, m.y + 3, m.z], 1); }
      return;
    }
    case 'charge': {
      m.angry = true;
      const ax = -Math.sin(m.yaw), az = -Math.cos(m.yaw);
      m.steer(m.x + ax * 10, m.z + az * 10, K.CHARGE_SPEED);
      m.yaw = Math.atan2(-ax, -az);
      if (g.ticks % 2 === 0) g.particles.emit(m.x, m.y + 0.3, m.z, 0, 0.06, 0, 1, 0.45, 0.1, 18, 0);
      for (const t of players) {
        if (m.hitCharge) break;
        if (Math.hypot(t.x - m.x, t.z - m.z) < 2.8 && Math.abs(t.y - m.y) < 3.5) {
          m.hitCharge = true;
          if (t.hurt(K.CHARGE_DAMAGE, 'mob:Slag Colossus', m) !== false && t.body) { t.body.vx += ax * 1.6; t.body.vz += az * 1.6; t.body.vy = 0.6; }
        }
      }
      if (b.horizontalCollision && m.ct < K.CHARGE_TICKS - 4) {
        // into a wall: stunned
        g.audio.play('colossus_slam', [m.x, m.y, m.z], 1);
        for (let q = 0; q < 24; q++) g.particles.emit(m.x + ax * 1.5 + (Math.random() - 0.5) * 2, m.y + Math.random() * 3, m.z + az * 1.5 + (Math.random() - 0.5) * 2, 0, 0.08, 0, 0.6, 0.55, 0.5, 26, -0.003);
        m.stunned = true; setState(m, 'stunned', K.STUN); m.cd.charge = K.CHARGE_COOLDOWN; b.vx = b.vz = 0;
      } else if (--m.ct <= 0) { setState(m, 'recover', 20); m.cd.charge = K.CHARGE_COOLDOWN; }
      return;
    }
    case 'stunned': {
      m.move = null; m.special = true; b.vx *= 0.5; b.vz *= 0.5;
      if (g.ticks % 3 === 0) g.particles.emit(m.x + (Math.random() - 0.5) * 1.5, m.y + 5.4, m.z + (Math.random() - 0.5) * 1.5, 0, 0.02, 0, 1, 0.9, 0.3, 20, 0); // sparks over the dazed head
      if (--m.ct <= 0) { m.stunned = false; setState(m, 'walk', 0); }
      return;
    }
  }

  // walking: chase, strike, and pick the next move
  m.stunned = false;
  if (!sees || home > K.LEASH + 6) {
    m.steer(m.arena.x, m.arena.z, 0.8);
    faceTowards(m, m.arena.x, m.arena.z, 0.15);
    return;
  }
  faceTowards(m, p.x, p.z, 0.2);
  if (home > K.LEASH && dh > 3) m.steer(m.arena.x, m.arena.z, 0.8); else if (dh > 2.6) m.steer(p.x, p.z, K.CHASE[ci]); else m.move = null;
  m.tryMelee(g, p);

  const seen = m.canSee(g, p.x, p.y + 1, p.z);
  if (m.cd.slam <= 0 && dh < 6) { setState(m, 'slamWind', K.SLAM_WINDUP); g.audio.play('colossus_roar', [m.x, m.y + 3, m.z], 0.8); return; }
  if (m.cphase >= 3 && m.cd.charge <= 0 && dh > 7 && dh < 22 && seen) { setState(m, 'chargeWind', K.CHARGE_WINDUP); m.lock = null; g.audio.play('colossus_roar', [m.x, m.y + 3, m.z], 1); return; }
  if (m.cphase >= 2 && m.cd.pillar <= 0 && seen) { markPillars(m, g, p, m.cphase); m.cd.pillar = K.PILLAR_COOLDOWN[ci]; return; }
  if (m.cd.hurl <= 0 && dh > K.HURL_MIN_RANGE && seen) { hurlSlag(m, g, p, m.cphase); m.cd.hurl = K.HURL_COOLDOWN[ci]; }
}

/** Shielded, it cannot be hurt; a blow stops at the phase threshold; stunned, it takes half again as much. */
export function colossusHurt(m, dmg, source, attacker) {
  if (m.cs === 'shield') { const g = m._game; if (g) g.audio.play('clank', [m.x, m.y + 2, m.z], 0.6); return 0; }
  if (source === 'fire' || source === 'lava' || source === 'fireball') return 0;
  if (source === 'explosion') dmg *= 0.5;
  dmg *= damageFactor(m.cs === 'stunned');
  dmg = clampToPhase(m.health, dmg, m.cphase || phaseOf(m.health / K.HEALTH));
  return dmg > 0.01 ? dmg : 0;
}

export function colossusDeath(m, g, killedByPlayer) {
  for (let k = 0; k < 110; k++) {
    g.particles.emit(m.x + (Math.random() - 0.5) * 4, m.y + Math.random() * 5, m.z + (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 0.3, Math.random() * 0.3, (Math.random() - 0.5) * 0.3, 1, 0.4 + Math.random() * 0.3, 0.1, 40, -0.004);
  }
  g.audio.play('colossus_slam', [m.x, m.y, m.z], 1);
  g.audio.play('colossus_roar', [m.x, m.y + 3, m.z], 0.8);
  m.pillars = []; m.wave = null;
  if (g.hud) g.hud.toast('The Slag Colossus crumbles into slag', 3500);
  if (killedByPlayer && g.milestones) g.milestones.event('colossus');
  // a Sunmend book now and then (the Core and the metals are in its drop table)
  if ((!g.net || g.net.isHost) && killedByPlayer && Math.random() < 0.35) g.entities.spawnItem(m.x, m.y + 1, m.z, { id: I.ENCHANTED_BOOK, count: 1, damage: 0, ench: { sunmend: 1 } });
}

// ---- looks ----------------------------------------------------------------------------
MODELS.slag_colossus = {
  parts: [
    ['legL', [12, 28, 12], [8, 28, 0], [0, -14, 0], '#3a2c30', { anim: 'legA' }],
    ['legR', [12, 28, 12], [-8, 28, 0], [0, -14, 0], '#3a2c30', { anim: 'legB' }],
    ['hips', [24, 8, 15], [0, 32, 0], [0, 0, 0], '#4a3a40'],
    ['body', [32, 28, 19], [0, 50, 0], [0, 0, 0], '#52424a'],
    ['furnace', [16, 14, 2], [0, 50, -10], [0, 0, 0], '#ffb43a', { emissive: '#e8741a' }],
    ['ventL', [5, 8, 5], [-9, 67, 3], [0, 0, 0], '#8a4a1c', { emissive: '#c8641c' }],
    ['ventR', [5, 8, 5], [9, 67, 3], [0, 0, 0], '#8a4a1c', { emissive: '#c8641c' }],
    ['head', [16, 15, 15], [0, 74, -1], [0, 0, 0], '#5e4a52', { face: 'slag_colossus' }],
    ['hornL', [3, 9, 3], [-6, 85, -1], [0, 0, 0], '#2e2428'],
    ['hornR', [3, 9, 3], [6, 85, -1], [0, 0, 0], '#2e2428'],
    ['armL', [12, 40, 12], [22, 66, 0], [0, -17, 0], '#4a3a40', { anim: 'armSwing' }],
    ['armR', [12, 40, 12], [-22, 66, 0], [0, -17, 0], '#4a3a40', { anim: 'armSwingB' }],
  ],
};
FACES.slag_colossus = (c) => {
  c.fillStyle = '#1c1416'; c.fillRect(2, 4, 12, 5);
  c.fillStyle = '#ffb43a'; c.fillRect(3, 5, 3, 3); c.fillRect(10, 5, 3, 3);
  c.fillStyle = '#fff0b0'; c.fillRect(4, 6, 1, 1); c.fillRect(11, 6, 1, 1);
  c.fillStyle = '#1c1416'; c.fillRect(4, 11, 8, 3);
  c.fillStyle = '#c8641c'; c.fillRect(5, 12, 6, 1);
};

/** Poses from the mirrored flags, so every screen sees them: arms up while it winds up, a drooping head when stunned. */
export function colossusRender(m, model, alpha, sec) {
  const parts = model.userData && model.userData.parts;
  if (!parts) return;
  if (m.angry && m.deathTime === 0) {
    const up = -2.5 + Math.sin(sec * 18) * 0.06;
    parts.armL.rotation.x = up; parts.armR.rotation.x = up;
    const g = m._game;
    if (g && g.particles && Math.random() < 0.35) g.particles.emit(m.x + (Math.random() - 0.5) * 2.4, m.y + 0.2, m.z + (Math.random() - 0.5) * 2.4, 0, 0.04, 0, 1, 0.5, 0.12, 16, 0);
  }
  if (m.special && !m.angry && m.deathTime === 0) parts.head.rotation.x = 0.55; // dazed or recovering
  if (parts.furnace) parts.furnace.visible = true;
}

export const SLAG_COLOSSUS = {
  name: 'Slag Colossus', role: 'wither', category: CATEGORY.MONSTER, boss: true, bossBar: { phases: K.PHASE_AT },
  health: K.HEALTH, speed: K.SPEED, width: 2.4, height: 5.4, attack: K.MELEE, armor: K.ARMOR, followRange: K.AGGRO, sound: 'colossus_roar', xp: 120,
  fireImmune: true, noFallDamage: true, noDespawn: true, knockbackResist: true,
  customAI: colossusAI, customRender: colossusRender, onHurt: colossusHurt, onDeath: colossusDeath,
  onSpawn: (m) => { m.persistent = true; }, // saved with the world: quitting mid-fight does not lose the sigil
  saveExtra: (m) => ({ arena: m.arena, cphase: m.cphase }),
  loadExtra: (m, s) => { if (s.arena && Number.isFinite(s.arena.x) && Number.isFinite(s.arena.y) && Number.isFinite(s.arena.z)) m.arena = { x: s.arena.x, y: s.arena.y, z: s.arena.z }; m.cphase = Math.max(1, Math.min(3, s.cphase | 0)) || phaseOf(m.health / K.HEALTH); },
  drops: [
    { id: I.COLOSSUS_CORE, min: 1, max: 1, playerOnly: true, noPlunder: true },
    { id: I.SLAGSTEEL_INGOT, min: 4, max: 6, playerOnly: true },
    { id: I.DIRGE_CRYSTAL, min: 1, max: 3, playerOnly: true },
    { id: I.EMBER_ROD, min: 2, max: 4, playerOnly: true },
  ],
};
if (!MOBS.slag_colossus) { MOBS.slag_colossus = SLAG_COLOSSUS; MOB_KEYS.push('slag_colossus'); }
