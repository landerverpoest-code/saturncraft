// Mobs of the Tide Citadels (world/monuments.js), registered into MOBS with
// their own AI (Mob.ai calls def.customAI):
//  * Deepeye        (reference: guardian)       - swims the citadel's halls, charges
//    a beam at players and Inklings for 2 s and then hurts them; while it holds
//    still its spikes stand out and hurt whoever strikes it in melee
//  * Elder Deepeye  (reference: elder guardian) - three per citadel, bigger, slower;
//    every minute it lays Mining Fatigue III (5 min) on players within 50 blocks
// plus their spawning: Deepeyes in and around a citadel, the elders once when
// the citadel's chunks are first loaded.
//
// The beam is drawn from `mob.beam` (the point it aims at) and `mob.fuse` (ticks
// charged); both travel in the multiplayer mob snapshots (net/protocol.js), so
// guests see the beam too.
import * as THREE from 'three';
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { I } from '../world/items.js';
import { B } from '../world/blocks.js';
import { monumentsNear, inMonument, elderSpots } from '../world/monuments.js';
import { scaledCap, SPAWN_MIN_DIST, DESPAWN_FAR } from './spawnRules.js';

const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

export const BEAM_RANGE = 16;            // blocks (reference follow range)
export const BEAM_MIN_DIST = 3;          // targets closer than this are ignored (reference: distance² > 9)
export const THORNS_DAMAGE = 2;          // reference thorns damage on Normal
export const FATIGUE_RADIUS = 50;
export const FATIGUE_INTERVAL = 1200;    // every minute
export const FATIGUE_TICKS = 6000;       // 5 minutes
export const FATIGUE_AMP = 2;            // level III

/** Should an elder (re)apply Mining Fatigue to this player now? (reference: unless it already has level III with over a minute left) */
export function needsFatigue(effects, creative = false) {
  if (creative) return false;
  const e = effects && effects.mining_fatigue;
  return !e || e.amp < FATIGUE_AMP || e.ticks < FATIGUE_INTERVAL;
}

/** Is a beam target at squared distance d2 within reach? */
export function beamInRange(d2) { return d2 > BEAM_MIN_DIST * BEAM_MIN_DIST && d2 <= BEAM_RANGE * BEAM_RANGE; }

const isWater = (g, x, y, z) => g.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === B.WATER;

/** Pick a new spot to swim to: a water block up to 8 blocks away. */
function newSwimGoal(m, g) {
  for (let k = 0; k < 6; k++) {
    const x = m.x + (Math.random() - 0.5) * 16, y = m.y + (Math.random() - 0.5) * 6, z = m.z + (Math.random() - 0.5) * 16;
    if (isWater(g, x, y, z) && isWater(g, x, y + m.height, z)) return { x, y, z, t: 60 + Math.floor(Math.random() * 80) };
  }
  return null;
}

/** The thing a Deepeye can shoot at: the (nearest) player, else an Inkling; must be visible and 3..16 blocks away. */
function findTarget(m, g, p) {
  const eye = (e) => [e.x, e.y + (e.isPlayer ? (e.eyeHeight || 1.62) : e.height * 0.5), e.z];
  if (p && !p.dead && !p.creative && !(p.effects ? p.effects.invisibility : p.invisible)) {
    const [x, y, z] = eye(p), d2 = (x - m.x) ** 2 + (y - m.eyeY) ** 2 + (z - m.z) ** 2;
    if (beamInRange(d2) && m.canSee(g, x, y, z)) return p;
  }
  for (const e of g.entities.list) {
    if (e.kind !== 'mob' || e.type !== 'inkling' || e.deathTime > 0 || e.dead) continue;
    const [x, y, z] = eye(e), d2 = (x - m.x) ** 2 + (y - m.eyeY) ** 2 + (z - m.z) ** 2;
    if (beamInRange(d2) && m.canSee(g, x, y, z)) return e;
  }
  return null;
}

function deepeyeAI(m, g, p) {
  const b = m.body, d = m.def;
  m.spikes = m.spikes ?? 1;
  m.cooldown = m.cooldown > 0 ? m.cooldown - 1 : 0;
  if (!b.inWater) {
    // stranded: it flops about and cannot aim
    b.vy -= 0.08;
    if (b.onGround && Math.random() < 0.1) { b.vy = 0.4; b.vx += (Math.random() - 0.5) * 0.3; b.vz += (Math.random() - 0.5) * 0.3; m.yaw += (Math.random() - 0.5) * 2; }
    m.fuse = 0; m.beam = null; m.beamTarget = null;
    m.moving = true;
    m.spikes += (0.3 - m.spikes) * 0.3;
    return;
  }
  // ---- the beam -----------------------------------------------------------------
  let t = m.beamTarget;
  const alive = (e) => e && !e.dead && (e.isPlayer ? !e.creative : e.deathTime === 0);
  if (t && (!alive(t) || (t.isPlayer && t !== p))) t = null; // (multiplayer: a player stand-in changes with the nearest one)
  if (!t && m.cooldown <= 0 && g.ticks % 10 === m.id % 10) t = findTarget(m, g, p);
  if (t) {
    const ty = t.y + (t.isPlayer ? (t.eyeHeight || 1.62) : t.height * 0.5);
    const d2 = (t.x - m.x) ** 2 + (ty - m.eyeY) ** 2 + (t.z - m.z) ** 2;
    if (d2 > BEAM_RANGE * BEAM_RANGE * 1.5 || (g.ticks % 5 === 0 && !m.canSee(g, t.x, ty, t.z))) t = null;
    else {
      if (!m.fuse) g.audio.play('teleport', [m.x, m.y + 0.5, m.z], 0.5);
      m.fuse = (m.fuse || 0) + 1;
      m.beam = { x: t.x, y: ty - 0.2, z: t.z };
      m.yaw += wrap(Math.atan2(-(t.x - m.x), -(t.z - m.z)) - m.yaw) * 0.5;
      m.headPitch = Math.atan2(ty - m.eyeY, Math.hypot(t.x - m.x, t.z - m.z));
      // it holds still while it aims
      b.vx *= 0.7; b.vy *= 0.7; b.vz *= 0.7;
      if (m.fuse >= d.beamCharge) {
        if (t.isPlayer) t.hurt(d.beamDamage, 'mob:' + d.name, m);
        else t.hurt(d.beamDamage, 'mob', m, 0.2);
        g.audio.play('mob_hurt', [t.x, t.y + 1, t.z], 0.6);
        t = null; m.cooldown = 20 + Math.floor(Math.random() * 20); // then it picks a target afresh
      }
    }
  }
  if (!t) { m.fuse = 0; m.beam = null; }
  m.beamTarget = t;
  m.target = t ? 'player' : null;
  // ---- swimming -----------------------------------------------------------------
  if (!t) {
    if (!m.swim || --m.swim.t <= 0 || b.horizontalCollision || Math.hypot(m.swim.x - m.x, m.swim.y - m.y, m.swim.z - m.z) < 1) {
      m.swim = Math.random() < 0.6 ? newSwimGoal(m, g) : null; // now and then it rests a while
      if (!m.swim) m.swim = { x: m.x, y: m.y, z: m.z, t: 40 + Math.floor(Math.random() * 60), rest: true };
    }
    const s = m.swim;
    if (!s.rest) {
      const dx = s.x - m.x, dy = s.y - m.y, dz = s.z - m.z, l = Math.hypot(dx, dy, dz) || 1;
      // keep to the water: do not swim up out of it
      const up = isWater(g, m.x, m.y + m.height + 0.4, m.z) ? 1 : 0;
      b.vx += dx / l * d.swimAccel; b.vz += dz / l * d.swimAccel; b.vy += dy / l * d.swimAccel * (dy > 0 ? up : 1);
      m.yaw += wrap(Math.atan2(-dx, -dz) - m.yaw) * 0.15;
      m.headPitch *= 0.9;
    }
  }
  if (!isWater(g, m.x, m.y + m.height + 0.3, m.z) && b.vy > 0) b.vy *= 0.5;
  const speed = Math.hypot(b.vx, b.vy, b.vz);
  m.moving = speed > 0.03;
  m.spikes += ((m.moving ? 0.25 : 1) - m.spikes) * 0.2;
  m.limbAmount = Math.min(1, speed * 6);
  if (Math.random() < 0.03) g.particles.emit(m.x + (Math.random() - 0.5) * m.width, m.y + Math.random() * m.height, m.z + (Math.random() - 0.5) * m.width, 0, 0.04, 0, 0.75, 0.85, 1, 25, 0.002);
}

/** Elders: as a Deepeye, plus the Mining Fatigue curse every minute on every player within 50 blocks. */
function elderAI(m, g, p) {
  deepeyeAI(m, g, p);
  if ((g.ticks + m.id) % FATIGUE_INTERVAL !== 0 || m.deathTime > 0) return;
  const host = g.localPlayer || g.player;
  const players = [host];
  if (g.net && g.net.isHost && g.net.joined) for (const c of g.net.joined()) if (c.rp && c.rp.target) players.push(c.rp.target);
  for (const pl of players) {
    if (!pl || pl.dead || pl.creative || Math.hypot(pl.x - m.x, pl.y - m.y, pl.z - m.z) > FATIGUE_RADIUS) continue;
    if (pl.isRemotePlayer) { if (pl.addEffect) pl.addEffect('mining_fatigue', FATIGUE_TICKS, FATIGUE_AMP); continue; }
    if (!needsFatigue(pl.effects, pl.creative)) continue;
    pl.addEffect('mining_fatigue', FATIGUE_TICKS, FATIGUE_AMP);
    g.audio.play('scream', [pl.x, pl.y + 1.6, pl.z], 0.5);
    // a pale ghost of the elder's face swells out of the screen (ui/ghostFace.js) with a few wisps before the player
    if (g.hud && g.hud.showGhostFace) g.hud.showGhostFace();
    if (g.particles) {
      const lx = -Math.sin(pl.yaw || 0), lz = -Math.cos(pl.yaw || 0);
      for (let k = 0; k < 30; k++) g.particles.emit(pl.x + lx * 2 + (Math.random() - 0.5) * 1.2, pl.y + 1.6 + (Math.random() - 0.5) * 1.2, pl.z + lz * 2 + (Math.random() - 0.5) * 1.2, 0, 0.01, 0, 0.75, 0.72, 0.85, 30, 0);
    }
  }
}

/** Spikes: while it holds still, melee attackers take thorn damage. */
function deepeyeHurt(m, dmg, source, attacker) {
  if (source === 'player' && attacker && attacker.hurt && !m.moving && m.deathTime === 0) attacker.hurt(THORNS_DAMAGE, 'mob:' + m.def.name, m);
  return dmg;
}

// ---- the beam's look ------------------------------------------------------------------
const beamGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 6, 1, true);
beamGeo.translate(0, 0.5, 0);
beamGeo.rotateX(Math.PI / 2); // along +z, from 0 to 1
const UP = new THREE.Vector3(), V = new THREE.Vector3(), Q = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1);

/** Draw the beam (a glowing rod from the eye to `beam`, from violet to white as it charges) and the spikes. */
function deepeyeRender(m, root, alpha, sec) {
  if (m.def.modelScale) root.scale.multiplyScalar(m.def.modelScale);
  const parts = root.userData.parts;
  const spikes = m.spikes ?? 1;
  for (const k in parts) if (k.startsWith('spike')) parts[k].scale.setScalar(0.35 + 0.65 * spikes);
  let beam = root.userData.beam;
  if (!m.beam || !(m.fuse > 0) || m.deathTime > 0) { if (beam) beam.visible = false; return; }
  if (!beam) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    beam = new THREE.Mesh(beamGeo.clone(), mat); // its own copy: the model's dispose frees every geometry in it
    beam.frustumCulled = false;
    root.add(beam);
    root.userData.beam = beam;
    const dispose = root.userData.dispose;
    root.userData.dispose = () => { mat.dispose(); dispose(); };
  }
  beam.visible = true;
  // eye position and target in the model's local space (the root is yawed and scaled)
  root.updateMatrixWorld();
  const eye = UP.set(0, m.height * 0.5, 0);
  const inv = root.matrixWorld.clone().invert();
  const tgt = V.set(m.beam.x, m.beam.y, m.beam.z).applyMatrix4(inv);
  const eyeL = eye.clone().multiplyScalar(1 / root.scale.y);
  const dir = tgt.clone().sub(eyeL);
  const len = dir.length();
  if (len < 0.01) { beam.visible = false; return; }
  Q.setFromUnitVectors(Z, dir.normalize());
  beam.position.copy(eyeL);
  beam.quaternion.copy(Q);
  const f = Math.min(1, m.fuse / m.def.beamCharge), w = (0.6 + 0.6 * f + Math.sin(sec * 30) * 0.15 * f) / root.scale.x;
  beam.scale.set(w, w, len);
  beam.material.color.setRGB(0.55 + 0.45 * f, 0.3 + 0.7 * f * f, 0.85 + 0.15 * f);
}

export const OCEAN_MOBS = {
  deepeye: {
    name: 'Deepeye', role: 'guardian', category: CATEGORY.MONSTER, sound: 'bubble',
    health: 30, speed: 0.5, width: 0.85, height: 0.85, followRange: BEAM_RANGE, xp: 10,
    flying: true, breathesWater: true, noFallDamage: true, deepeye: true,
    beamCharge: 40, beamDamage: 6, swimAccel: 0.012,
    customAI: deepeyeAI, onHurt: deepeyeHurt, customRender: deepeyeRender,
    drops: [{ id: I.TIDE_SHARD, min: 0, max: 2 }, { oneOf: [[I.RAW_SILVERFIN, 0.4], [I.TIDE_CRYSTAL, 0.4]] }],
  },
  elder_deepeye: {
    name: 'Elder Deepeye', role: 'elder guardian', category: CATEGORY.MONSTER, sound: 'bubble',
    health: 80, speed: 0.3, width: 1.99, height: 1.99, followRange: BEAM_RANGE, xp: 10, modelScale: 1.99 / 0.85,
    flying: true, breathesWater: true, noFallDamage: true, noDespawn: true, deepeye: true,
    beamCharge: 30, beamDamage: 8, swimAccel: 0.008,
    customAI: elderAI, onHurt: deepeyeHurt, customRender: deepeyeRender,
    drops: [{ id: I.TIDE_SHARD, min: 0, max: 2 }, { id: B.WET_SOAKMOSS, min: 1, max: 1, playerOnly: true }, { id: I.CHARM_OF_UNDYING, min: 1, max: 1, playerOnly: true, chance: 0.5 }, { id: I.SUNCORE, min: 1, max: 1, playerOnly: true }, { oneOf: [[I.RAW_SILVERFIN, 0.5], [I.TIDE_CRYSTAL, 0.33]] }],
  },
};
for (const [k, d] of Object.entries(OCEAN_MOBS)) { if (!MOBS[k]) { MOBS[k] = d; MOB_KEYS.push(k); } }

// ---- spawning ---------------------------------------------------------------------
export const DEEPEYES_PER_CITADEL = 12;

/** Deepeyes spawn in packs of 2-4 in the water of a citadel near the player (every second, under the monster cap). */
export function tickMonumentSpawns(spawner, monsters, cap) {
  const g = spawner.game, w = g.world, p = g.player;
  if (g.ticks % 20 !== 7 || monsters >= cap || (w.dimension && w.dimension !== 'overworld') || !w.gen) return 0;
  let n = 0;
  for (const m of monumentsNear(w.gen, p.x - DESPAWN_FAR, p.z - DESPAWN_FAR, p.x + DESPAWN_FAR, p.z + DESPAWN_FAR)) {
    let have = 0;
    for (const e of g.entities.list) if (e.type === 'deepeye' && !e.dead && inMonument(m, e.x, e.y, e.z, 8)) have++;
    if (have >= DEEPEYES_PER_CITADEL) continue;
    const x0 = m.x0 + Math.floor(Math.random() * 58), z0 = m.z0 + Math.floor(Math.random() * 58), y0 = m.y + 1 + Math.floor(Math.random() * 20);
    const size = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < 4 && n < size; k++) {
      const x = x0 + Math.floor(Math.random() * 5) - 2, y = y0 + Math.floor(Math.random() * 3) - 1, z = z0 + Math.floor(Math.random() * 5) - 2;
      const d2 = (x + 0.5 - p.x) ** 2 + (y - p.y) ** 2 + (z + 0.5 - p.z) ** 2;
      if (d2 < SPAWN_MIN_DIST * SPAWN_MIN_DIST || d2 > DESPAWN_FAR * DESPAWN_FAR || !w.isLoaded(x, z)) continue;
      if (w.getBlock(x, y, z) !== B.WATER || w.getBlock(x, y + 1, z) !== B.WATER) continue;
      const e = spawner.spawnMob('deepeye', x + 0.5, y, z + 0.5);
      e.yaw = Math.random() * TAU;
      n++;
    }
  }
  return n;
}

/** The three Elder Deepeyes of each citadel, placed once when the chunk they wait in is first loaded. */
export function spawnElders(spawner, cx, cz) {
  const g = spawner.game, w = g.world;
  if (!w.gen) return;
  for (const m of monumentsNear(w.gen, cx * 16, cz * 16, cx * 16 + 15, cz * 16 + 15)) {
    for (const [x, y, z] of elderSpots(m)) {
      if (Math.floor(x / 16) !== cx || Math.floor(z / 16) !== cz) continue;
      const e = spawner.spawnMob('elder_deepeye', x, y - 1, z);
      e.persistent = true;
    }
  }
}

export { scaledCap };
