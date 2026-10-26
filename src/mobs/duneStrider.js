// Dune Strider (reference: camel): a tall, humped desert beast. One lives in
// every desert village and a few roam the open desert. Saddled (no taming
// needed) it carries two: the one who climbs on first steers it, a second
// player in multiplayer sits behind. It steps up 1.5 blocks, and holding the
// jump key charges a dash: on release it leaps far ahead, then needs 2.75 s
// to recover (shown in the HUD). Riders sit too high for Shamblers to reach.
// Left alone it sits down now and then; it breeds with cactus, and its young
// keep close to the grown-ups.
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { I } from '../world/items.js';
import { B, SOLID } from '../world/blocks.js';
import { BIOMES } from '../world/biomes.js';

export const STRIDER_STEP = 1.5;            // blocks it walks straight up
export const DASH_COOLDOWN = 55;            // ticks (2.75 s) after a dash
export const DASH_MAX_CHARGE = 20;          // ticks of holding jump for a full dash
export const DASH_MIN_CHARGE = 3;           // a tap is too short to dash
export const SEAT = { y: 1.45, front: 0.25, back: -0.6, passengerY: 1.4 };
/** Melee mobs no taller than this cannot reach someone up on a Strider. */
export const REACH_LIFT_MAX_ATTACKER = 2.2;

/** A fresh dash state: charge ticks and cooldown ticks. */
export const newDash = () => ({ charge: 0, cooldown: 0 });

/** Forward and upward speed of a dash charged for `charge` ticks (0 if too short). */
export function dashPower(charge) {
  if (charge < DASH_MIN_CHARGE) return null;
  const f = Math.min(1, charge / DASH_MAX_CHARGE);
  return { forward: 0.55 + 0.75 * f, up: 0.32 + 0.12 * f };
}

/**
 * One tick of the dash: while the jump key is held on the ground the dash
 * charges; letting go releases it (returns the dash's power) and starts the
 * cooldown, during which holding jump does nothing. Returns null otherwise.
 */
export function dashStep(s, jumpHeld, onGround) {
  if (s.cooldown > 0) { s.cooldown--; s.charge = 0; return null; }
  if (jumpHeld) {
    if (onGround) s.charge = Math.min(DASH_MAX_CHARGE, s.charge + 1);
    return null;
  }
  if (s.charge <= 0) return null;
  const p = dashPower(s.charge);
  s.charge = 0;
  if (!p) return null;
  s.cooldown = DASH_COOLDOWN;
  return p;
}

/** What the HUD shows: the charge (0..1) while charging, else how far the cooldown has come (1 = ready). */
export function dashGauge(s) {
  if (!s) return { charging: false, ready: 1, charge: 0 };
  return { charging: s.charge > 0, charge: Math.min(1, s.charge / DASH_MAX_CHARGE), ready: 1 - s.cooldown / DASH_COOLDOWN };
}

/** Where a rider sits, relative to the Strider's feet: [dx, dy, dz]. The passenger sits behind. */
export function seatOffset(m, passenger) {
  const k = m.age < 0 ? 0.5 : 1;
  const along = passenger ? SEAT.back : SEAT.front, y = passenger ? SEAT.passengerY : SEAT.y;
  return [-Math.sin(m.yaw) * along * k, y * k, -Math.cos(m.yaw) * along * k];
}

/** Is this target sitting up on a tall mount, out of reach of a short melee mob below it? */
export function outOfMeleeReach(attackerHeight, dy, riding) {
  return !!riding && attackerHeight <= REACH_LIFT_MAX_ATTACKER && dy >= SEAT.passengerY - 0.2;
}

/**
 * The second seat (multiplayer): a guest asks to sit behind (on) or to get off.
 * Only a grown, saddled Strider has one, and only one guest fits.
 */
export function claimSeat(m, guestId, on) {
  if (!on) { if (m.passengerId === guestId) m.passengerId = null; return true; }
  if (!m.def || !m.def.strider || !m.saddled || m.age < 0 || m.deathTime > 0) return false;
  if (m.passengerId != null && m.passengerId !== guestId) return false;
  m.passengerId = guestId;
  m.sitting = false;
  return true;
}

function ageTick(m) {
  if (m.age < 0) { if (++m.age === 0) m.setBaby(false); } else if (m.age > 0) m.age--;
}

/** Nearest grown Strider within 16 blocks (a youngster keeps close to it). */
function nearestParent(m, g) {
  let best = null, bd = 256;
  for (const e of g.entities.list) {
    if (e === m || e.type !== m.type || e.age < 0 || e.dead || e.deathTime > 0) continue;
    const d = (e.x - m.x) ** 2 + (e.z - m.z) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function striderAI(m, g, p, pdist) {
  const b = m.body;
  b.stepHeight = STRIDER_STEP;
  if (!m.dash) m.dash = newDash();
  if (m.dash.cooldown > 0) m.dash.cooldown--;
  m.passengerId = m.passengerId ?? null;
  // panic, love and being tempted with cactus get it up on its feet
  if (m.panicTicks > 0 || m.loveTicks > 0 || m.tempted(g) || m.leashHolder) { m.sitting = false; m.passiveAI(g); return; }
  if (m.sitting) {
    ageTick(m);
    m.move = null; m.path = null; m.wander = null; m.headPitch = 0.2;
    if (--m.sitTicks <= 0 || b.inWater) m.sitting = false;
    return;
  }
  if (b.onGround && !b.inWater && Math.random() < 1 / 1200) {
    m.sitting = true; m.sitTicks = 400 + Math.floor(Math.random() * 800);
    m.path = null; m.wander = null; m.move = null;
    return;
  }
  if (m.age < 0) {
    const pa = g.ticks % 20 === m.id % 20 ? (m._parent = nearestParent(m, g)) : m._parent;
    if (pa && !pa.dead) {
      const d = Math.hypot(pa.x - m.x, pa.z - m.z);
      if (d > 4) { ageTick(m); m.wander = null; m.path = null; m.steer(pa.x, pa.z, 1.1); return; }
    }
  }
  m.headPitch = 0;
  m.passiveAI(g);
}

/** Ridden by the player who climbed on first: WASD, sprint, and a charged dash on the jump key. */
function striderRidden(m, g) {
  const input = g.boatInput, b = m.body;
  b.stepHeight = STRIDER_STEP;
  m.sitting = false;
  if (!m.dash) m.dash = newDash();
  if (!m.saddled || !input) { m.move = null; if (m.dash.cooldown > 0) m.dash.cooldown--; return; }
  m.yaw = m.rider.yaw;
  const sp = m.speed() * (input.sprint ? 1.35 : 1);
  m.move = { forward: input.forward > 0 ? sp : input.forward < 0 ? -sp * 0.3 : 0, strafe: (input.strafe || 0) * sp * 0.4, jump: false, mod: 1 };
  const dash = dashStep(m.dash, !!input.jump, b.onGround);
  if (dash) {
    b.vx += -Math.sin(m.yaw) * dash.forward; b.vz += -Math.cos(m.yaw) * dash.forward;
    b.vy = dash.up;
    m.dashing = 14;
    g.audio.play('strider', [m.x, m.y + 2, m.z], 0.8);
    g.particles.smoke(m.x, m.y + 0.2, m.z, 8, 1.2);
  }
  if (m.dashing > 0) m.dashing--;
}

function striderDeath(m, g) {
  if (m.saddled) g.entities.spawnItem(m.x, m.y + 1, m.z, { id: I.SADDLE, count: 1 });
}

/**
 * Right-click (host / single player): saddle a grown one, feed it cactus (heals,
 * then love or growing up) or climb into the front seat once it has a saddle.
 * Returns true when something happened.
 */
export function interactStrider(g, mob, p, st, use) {
  if (mob.deathTime > 0) return false;
  const d = st && st.id != null ? st.id : null;
  if (d === I.SADDLE && !mob.saddled && mob.age >= 0) { mob.saddled = true; mob.sitting = false; use(); g.audio.play('equip', [mob.x, mob.y + 1.5, mob.z]); return true; }
  if (d === B.CACTUS) {
    if (mob.health < mob.maxHealth) { mob.health = Math.min(mob.maxHealth, mob.health + 2); use(); g.audio.play('eat', [mob.x, mob.y + 2, mob.z]); mob.hearts(g, 2, true); return true; }
    if (mob.feed(g)) { use(); g.audio.play('eat', [mob.x, mob.y + 2, mob.z]); return true; }
    return false;
  }
  if (mob.saddled && mob.age >= 0 && !mob.rider && !p.riding && !p.sneaking && !p.isRemotePlayer) {
    mob.sitting = false;
    g.mount(mob);
    return true;
  }
  return false;
}

/** A guest right-clicks a host's Strider: take the back seat (the host decides through a `ride` message). */
export function guestWantsSeat(mob, p, st) {
  if (!mob.def.strider || !mob.saddled || mob.baby || mob.deathTime > 0 || p.riding || p.sneaking) return false;
  if (st && (st.id === I.SADDLE || st.id === B.CACTUS)) return false;
  return mob.passengerId == null;
}

function striderRender(m, model, alpha, sec) {
  const pa = model.userData.parts;
  if (!pa || !pa.hump) return;
  pa.saddle.visible = pa.seat2.visible = !!m.saddled;
  pa.tail.rotation.z = Math.sin(sec * 2.2 + m.id) * 0.25;
  pa.neck.rotation.x = Math.sin(m.limbSwing * 0.33) * 0.12 * m.limbAmount;
  const sit = m.sitting && m.deathTime === 0;
  if (sit) {
    // folded legs, belly on the sand, neck held up
    model.position.y -= 0.95 * model.scale.y;
    for (const k of ['legFL', 'legFR']) pa[k].rotation.x = -1.5;
    for (const k of ['legBL', 'legBR']) pa[k].rotation.x = 1.5;
    pa.neck.rotation.x = -0.15;
  } else if (m.dashing > 0 || (!m.body.onGround && m.rider)) {
    // the leap: front legs reach out, hind legs push off
    for (const k of ['legFL', 'legFR']) pa[k].rotation.x = -0.9;
    for (const k of ['legBL', 'legBR']) pa[k].rotation.x = 0.9;
  }
}

MODELS.dune_strider = {
  parts: [
    ['body', [12, 10, 26], [0, 23, 0], [0, 0, 0], '#c9a467'],
    ['belly', [10, 2, 20], [0, 17.5, 0], [0, 0, 0], '#b28d54'],
    ['hump', [9, 6, 10], [0, 28, 1], [0, 3, 0], '#b8915a'],
    ['saddle', [12.6, 2.5, 8], [0, 28, -6], [0, 0.8, 0], '#7a3a1e'],
    ['seat2', [12.6, 2.5, 7], [0, 28, 9], [0, 0.8, 0], '#a8682e'],
    ['neck', [5, 15, 6], [0, 24, -12], [0, 6.5, -1.5], '#c9a467'],
    ['head', [6, 6, 11], [0, 37, -14], [0, 1, -4], '#c9a467', { face: 'dune_strider' }],
    ['earL', [1, 2, 1], [0, 37, -14], [2.5, 5, 0.5], '#8e6a3e'],
    ['earR', [1, 2, 1], [0, 37, -14], [-2.5, 5, 0.5], '#8e6a3e'],
    ['legFL', [4, 18, 4], [4, 18, -9], [0, -9, 0], '#b8935a', { anim: 'legA' }],
    ['legFR', [4, 18, 4], [-4, 18, -9], [0, -9, 0], '#b8935a', { anim: 'legB' }],
    ['legBL', [4, 18, 4], [4, 18, 9], [0, -9, 0], '#b8935a', { anim: 'legB' }],
    ['legBR', [4, 18, 4], [-4, 18, 9], [0, -9, 0], '#b8935a', { anim: 'legA' }],
    ['tail', [2, 9, 2], [0, 26, 13], [0, -4.5, 0.5], '#8e6a3e'],
  ],
};
// long lashes over dark eyes, nostril slits and a split lip
FACES.dune_strider = (c) => {
  c.fillStyle = '#3a2614'; c.fillRect(0, 4, 3, 1); c.fillRect(13, 4, 3, 1);
  c.fillStyle = '#141008'; c.fillRect(0, 5, 2, 2); c.fillRect(14, 5, 2, 2);
  c.fillStyle = '#5a3e22'; c.fillRect(5, 9, 2, 1); c.fillRect(9, 9, 2, 1); c.fillRect(7, 12, 2, 3);
  c.fillStyle = '#a07c48'; c.fillRect(3, 13, 10, 1);
};

export const DUNE_STRIDER = {
  name: 'Dune Strider', role: 'camel', category: CATEGORY.CREATURE, strider: true, rideable: true, sound: 'strider',
  health: 32, speed: 0.18, width: 1.7, height: 2.4, panicSpeed: 1.6,
  drops: [{ id: I.LEATHER, min: 0, max: 2 }], food: [B.CACTUS],
  ownAI: striderAI, riddenAI: striderRidden, onDeath: striderDeath, customRender: striderRender,
  seatOffset, onSpawn: (m) => { m.body.stepHeight = STRIDER_STEP; m.saddled = false; m.passengerId = null; m.dash = newDash(); },
  saveExtra: (m) => ({ saddled: !!m.saddled }),
  loadExtra: (m, s) => { m.saddled = !!s.saddled; },
};
if (!MOBS.dune_strider) { MOBS.dune_strider = DUNE_STRIDER; MOB_KEYS.push('dune_strider'); }

/** Up to 4 good spots by a desert village's well for its Strider (tried in order). */
export const VILLAGE_SPOTS = [[-5, 5], [5, -5], [-6, -4], [6, 5]];

/** Place the village Strider: the first spot by the well where it fits on solid ground. */
export function spawnVillageStrider(spawner, v) {
  const w = spawner.game.world;
  for (const [dx, dz] of VILLAGE_SPOTS) {
    const x = v.cx + dx, z = v.cz + dz, y = w.heightAt(x, z) + 1;
    if (!SOLID[w.getBlock(x, y - 1, z)] || !spawner.canFit('dune_strider', x, y, z)) continue;
    return spawner.spawnMob('dune_strider', x + 0.5, y, z + 0.5);
  }
  return null;
}

/** Desert chunks: now and then a lone Strider (or a pair) when the chunk is first made. */
export const DESERT_CHUNK_CHANCE = 0.012;
export function desertChunkSpawn(spawner, cx, cz, rng = Math.random) {
  if (rng() >= DESERT_CHUNK_CHANCE) return 0;
  const w = spawner.game.world;
  const x = cx * 16 + 4 + Math.floor(rng() * 8), z = cz * 16 + 4 + Math.floor(rng() * 8);
  if (!BIOMES[w.biomeAt(x, z)] || BIOMES[w.biomeAt(x, z)].key !== 'desert') return 0;
  const y = w.heightAt(x, z) + 1;
  if (w.getBlock(x, y - 1, z) !== B.SAND || !spawner.canFit('dune_strider', x, y, z)) return 0;
  const n = rng() < 0.3 ? 2 : 1;
  for (let k = 0; k < n; k++) spawner.spawnMob('dune_strider', x + 0.5 + k * 2, y, z + 0.5);
  return n;
}
