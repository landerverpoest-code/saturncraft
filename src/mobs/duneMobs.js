// Dune, bog and canyon round: three new mobs for the dry and wet corners of the map (this module registers itself into MOBS, like mobs/fauna.js).
//
//  Sandsnapper (reference: antlion)  a hostile ambusher that lives buried in desert and badlands sand. Buried it cannot be seen, aimed at or hurt;
//      it creeps about under the sand towards a player (a little ridge of sand and a puff now and then give it away) and when one comes within
//      a few blocks (sneaking halves that) it bursts out, snaps and holds on (Slowness), then lets go and digs back in once it has had its bite or
//      its prey has run. Snapshots carry its state in the flags they already have: `special` = buried, `emerging` / `digging` = coming up / going
//      down, `angry` = up and hunting. Drops Sand, Bone and Snapper Fang.
//  Peat Lurker (reference: bog crocodile)  a hostile that lies submerged in swamp and mangrove water with only its eyes showing. It lets a player
//      walk the bank (sneaking, closer than a couple of blocks only) and then surges out, bites hard and drags at the legs (Slowness); on land it
//      is slow and dries out, so it goes home to the water. Drops Peat Clot, the dark first step of the hag's potion chain (world/hagCauldron.js).
//  Cliffkite (reference: hawk / condor)  a broad-winged glider that rides the updrafts of badlands and Slot Canyons, circling high and slow. It
//      keeps clear of people, and when struck it stoops on its attacker for a quarter of a minute. Drops feathers, bones and a drumstick.
//
// Natural spawns: `duneTick` (called from MobSpawner.tick; a cheap try now and then) places all three. Everything is simulated on the host; a guest
// sees them through the ordinary mob snapshots, whose 25 fields are unchanged.
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { I } from '../world/items.js';
import { B, SOLID, isWaterish } from '../world/blocks.js';
import { BIOMES } from '../world/biomes.js';
import { sandPuff, moleDepth } from './fauna.js';
import { canyonsNear } from '../world/mesaPack.js';

export const SNAP = { AMBUSH: 3.4, AMBUSH_SNEAK: 1.7, EMERGE: 10, DIG: 14, BITE_SLOW: 50, UP_MAX: 140, GIVE_UP: 9, CREEP: 12, COOLDOWN: 120, MAX: 4 };
export const LURK = { NOTICE: 6, NOTICE_SNEAK: 2.4, GIVE_UP: 14, BITE_SLOW: 60, DRY_TICKS: 400, MAX: 4 };
export const KITE = { ORBIT_MIN: 10, ORBIT_MAX: 17, CLIMB: 14, GRUDGE: 300, MAX: 3 };
export const SAND_GROUND = new Set([B.SAND, B.RED_SAND]);

/** Biome keys each mob is placed in by duneTick (the Field Guide lists them as habitats). */
export const DUNE_HABITATS = {
  sandsnapper: ['desert', 'badlands'],
  peat_lurker: ['swamp', 'mangrove_swamp'],
  cliffkite: ['badlands'],
};

const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

// ---------------------------------------------------------------------------------------------
// Pure rules (unit tested)

/** Does a buried Sandsnapper burst out: the player is within reach (a sneaker must be nearly on top of it), and it has rested. */
export function snapperAmbushes({ pdist, sneaking = false, cooldown = 0, buried = true }) {
  if (!buried || cooldown > 0) return false;
  return pdist < (sneaking ? SNAP.AMBUSH_SNEAK : SNAP.AMBUSH);
}
/** Does a Sandsnapper above ground dig back in: it has bitten, it has been up long enough or its prey is far. */
export function snapperRetreats({ pdist, up, bitten }) {
  return bitten || up > SNAP.UP_MAX || pdist > SNAP.GIVE_UP;
}
/** How far a Peat Lurker notices a player standing at its water's edge. */
export const lurkerNotice = (sneaking) => (sneaking ? LURK.NOTICE_SNEAK : LURK.NOTICE);
/** Does a Peat Lurker lunge: the player is in range, and it is not wounded into fleeing. */
export function lurkerLunges({ pdist, sneaking = false, submerged = true }) {
  return submerged && pdist < lurkerNotice(sneaking);
}
/** Where a Cliffkite at ring angle `a` round `home` wants to be: a ring that rises and falls on the updraft. */
export function kiteRingPoint(home, a, radius, sec = 0) {
  return { x: home.x + Math.cos(a) * radius, y: home.y + KITE.CLIMB + Math.sin(a * 2 + sec * 0.25) * 3, z: home.z + Math.sin(a) * radius };
}
/** May a Sandsnapper be placed on this ground? Sand with two blocks of air over it. */
export const snapperGround = (below, air1, air2) => SAND_GROUND.has(below) && !air1 && !air2;

// ---------------------------------------------------------------------------------------------
// Sandsnapper

const sandBelow = (w, m) => SAND_GROUND.has(w.getBlock(Math.floor(m.x), Math.floor(m.y - 0.2), Math.floor(m.z)));

function snapperAI(m, g, p, pdist) {
  const b = m.body, w = g.world;
  m.headPitch = 0;
  if (m.cooldown > 0) m.cooldown--;
  const live = !p.dead && !p.creative && !(p.effects && p.effects.invisibility);
  const onSand = sandBelow(w, m);
  if (m.emerging > 0) { // coming up: still, sand flying
    b.vx = b.vz = 0; m.move = null;
    if (g.ticks % 2 === 0) sandPuff(m, g);
    if (--m.emerging === 0) { m.special = false; m.angry = true; m.up = 0; m.bitten = false; g.audio.play('snap', [m.x, m.y + 0.3, m.z], 0.9); }
    return;
  }
  if (m.digging > 0) {
    b.vx = b.vz = 0; m.move = null; m.angry = false;
    if (g.ticks % 3 === 0) sandPuff(m, g);
    if (--m.digging === 0) { m.special = true; m.cooldown = SNAP.COOLDOWN; m.path = null; m.target = null; }
    return;
  }
  if (m.special) {
    // buried: it creeps under the sand towards a player who is near, throwing up a little sand now and then
    m.angry = false; m.target = null;
    if (!onSand) { if (++m.lost > 30) m.special = false; b.vx = b.vz = 0; m.move = null; return; } // its sand was dug away: it is out in the open
    m.lost = 0;
    if (live && snapperAmbushes({ pdist, sneaking: p.sneaking, cooldown: m.cooldown, buried: true })) {
      m.emerging = SNAP.EMERGE; m.yaw = Math.atan2(-(p.x - m.x), -(p.z - m.z)); sandPuff(m, g); g.audio.play('snap', [m.x, m.y + 0.3, m.z], 0.6);
      return;
    }
    if (live && pdist < 22 && pdist > SNAP.AMBUSH && !p.sneaking && g.ticks % 2 === 0) {
      const dx = p.x - m.x, dz = p.z - m.z, d = Math.hypot(dx, dz) || 1, step = 0.07;
      const nx = m.x + dx / d * step * 2, nz = m.z + dz / d * step * 2;
      if (SAND_GROUND.has(w.getBlock(Math.floor(nx), Math.floor(m.y - 0.2), Math.floor(nz))) && !SOLID[w.getBlock(Math.floor(nx), Math.floor(m.y + 0.3), Math.floor(nz))]) b.setPos(nx, m.y, nz);
      m.yaw = Math.atan2(-dx, -dz);
      if (g.ticks % 12 === m.id % 12) { const c = g.particles; if (c && c.emit) c.emit(m.x, m.y + 0.05, m.z, 0, 0.03, 0, 0.8, 0.7, 0.45, 14, 0.01); }
    }
    m.move = null; b.vx = b.vz = 0;
    return;
  }
  // up and hunting
  m.up = (m.up || 0) + 1;
  m.angry = true;
  m.target = live ? 'player' : null;
  if (!live || snapperRetreats({ pdist, up: m.up, bitten: m.bitten }) && onSand && b.onGround) {
    m.digging = SNAP.DIG; m.path = null; m.angry = false; sandPuff(m, g); g.audio.play('snap', [m.x, m.y + 0.3, m.z], 0.5);
    return;
  }
  if (!onSand && b.onGround && ++m.stray > 600) { m.removed = true; m.dead = true; return; } // stranded off the sand for good
  if (onSand) m.stray = 0;
  m.chase(g, p, 1.2);
  const ready = m.attackCooldown <= 0;
  m.tryMelee(g, p);
  if (ready && m.attackCooldown > 0 && p.applyEffect) { // it holds on: Slowness, then it lets go and burrows
    p.applyEffect('slowness', SNAP.BITE_SLOW, 1);
    m.bitten = true;
  }
}

function snapperHurt(m, dmg) {
  if (m.special || m.emerging > 0 || m.digging > 0) return 0; // out of reach under the sand
  return dmg;
}

function snapperRender(m, model, alpha, sec) {
  const pa = model.userData.parts;
  const hidden = m.special && !(m.emerging > 0) && !(m.digging > 0);
  model.visible = !hidden;
  if (!pa || hidden) return;
  model.position.y -= moleDepth(m.emerging > 0 ? m.emerging * 2.4 : 0, m.digging > 0 ? m.digging * 1.7 : 0, alpha) * m.height * 0.9;
  const open = m.angry ? 0.5 + Math.sin(sec * 16 + m.id) * 0.3 : 0.1;
  pa.jawL.rotation.y = -open; pa.jawR.rotation.y = open;
  pa.tail.rotation.x = -0.5 + Math.sin(sec * 3 + m.id) * 0.12;
}

MODELS.sandsnapper = {
  parts: [
    ['body', [8, 4, 10], [0, 3, 1], [0, 0, 0], '#b88a4a'],
    ['plates', [7, 1.4, 8], [0, 5.4, 1], [0, 0, 0], '#8a6232'],
    ['head', [6, 4, 5], [0, 3.2, -5], [0, 0, -2], '#fffffc', { face: 'sandsnapper' }],
    ['jawL', [1.6, 1.6, 6], [2.6, 2.8, -7], [0.6, 0, -2.6], '#e6d8b8'],
    ['jawR', [1.6, 1.6, 6], [-2.6, 2.8, -7], [-0.6, 0, -2.6], '#e6d8b8'],
    ['tail', [2, 2, 7], [0, 5, 6.5], [0, 0.6, 3.4], '#8a6232'],
    ...[[-1, 'legA'], [0.2, 'legB'], [2.6, 'legA']].flatMap(([z, a], k) => [
      [`legL${k}`, [1.4, 3, 1.4], [4.4, 3, z], [0, -1.5, 0], '#7a5628', { anim: a }],
      [`legR${k}`, [1.4, 3, 1.4], [-4.4, 3, z], [0, -1.5, 0], '#7a5628', { anim: a === 'legA' ? 'legB' : 'legA' }],
    ]),
  ],
};
// two small yellow eyes on stalks' bases, a dark mouth ringed with teeth
FACES.sandsnapper = (c) => {
  c.fillStyle = '#17110a'; c.fillRect(2, 3, 3, 3); c.fillRect(11, 3, 3, 3);
  c.fillStyle = '#ffd24a'; c.fillRect(3, 4, 1, 1); c.fillRect(12, 4, 1, 1);
  c.fillStyle = '#2a1608'; c.fillRect(4, 9, 8, 5);
  c.fillStyle = '#f4ecd8'; for (let x = 4; x < 12; x += 2) { c.fillRect(x, 9, 1, 2); c.fillRect(x + 1, 12, 1, 2); }
};

// ---------------------------------------------------------------------------------------------
// Peat Lurker

function lurkerAI(m, g, p, pdist) {
  const b = m.body, w = g.world;
  if (!m.home) m.home = { x: m.x, y: m.y, z: m.z };
  const live = !p.dead && !p.creative && !(p.effects && p.effects.invisibility);
  const inW = b.inWater;
  if (!inW) {
    // out of the water it is slow and dries out, with nowhere to hide
    m.special = false;
    if (b.onGround && ++m.dry > LURK.DRY_TICKS && g.ticks % 20 === 0) m.hurt(1, 'drown');
  } else m.dry = 0;
  if (m.angry) {
    // surged: chase, bite, drag; it gives up when the player is far or gone
    if (!live || pdist > LURK.GIVE_UP) { m.angry = false; m.target = null; m.path = null; return; }
    m.target = 'player';
    m.chase(g, p, inW ? 1.5 : 0.55);
    const ready = m.attackCooldown <= 0;
    m.tryMelee(g, p);
    if (ready && m.attackCooldown > 0 && p.applyEffect) p.applyEffect('slowness', LURK.BITE_SLOW, 1);
    if (Math.random() < 1 / 160) g.audio.play('gurgle', [m.x, m.y + 0.3, m.z], 0.7);
    return;
  }
  // lying in wait: submerged and still, or on its way home
  m.target = null;
  const homeD = Math.hypot(m.home.x - m.x, m.home.z - m.z);
  if (homeD > 3 && !m.wander) { m.steer(m.home.x, m.home.z, inW ? 0.8 : 0.5); m.special = false; }
  else { m.special = inW; m.move = null; if (inW) { b.vx *= 0.8; b.vz *= 0.8; b.vy += 0.004; } }
  if (live && lurkerLunges({ pdist, sneaking: p.sneaking, submerged: true }) && Math.abs(p.y - m.y) < 3.5 && m.canSee(g, p.x, p.y + p.eyeHeight, p.z)) {
    m.angry = true; m.special = false; m.cooldown = 0;
    g.audio.play('gurgle', [m.x, m.y + 0.3, m.z], 1);
    for (let k = 0; k < 8; k++) g.particles.emit(m.x + (Math.random() - 0.5) * 0.8, m.y + 0.5, m.z + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.1, 0.14, (Math.random() - 0.5) * 0.1, 0.6, 0.75, 1, 12, 0.03);
  }
}

function lurkerRender(m, model, alpha, sec) {
  const pa = model.userData.parts;
  if (!pa || !pa.jaw) return;
  const hide = m.special && !m.angry; // submerged: only the eyes and a ridge of the back
  for (const k of Object.keys(pa)) pa[k].visible = !hide || k === 'eyeL' || k === 'eyeR' || k === 'ridge';
  pa.jaw.rotation.x = m.angry ? 0.5 + Math.sin(sec * 12 + m.id) * 0.25 : 0.04;
  pa.tail.rotation.y = Math.sin(sec * 2.4 + m.id) * 0.4;
  if (hide) model.position.y -= 0.12;
}

MODELS.peat_lurker = {
  parts: [
    ['body', [7, 4, 14], [0, 3, 1], [0, 0, 0], '#4a5a2e'],
    ['ridge', [3, 1.4, 11], [0, 5.4, 1], [0, 0, 0], '#2e3a1e'],
    ['head', [6, 3.4, 6], [0, 3.4, -7], [0, 0, -2.4], '#fffffc', { face: 'peat_lurker' }],
    ['jaw', [5, 1.4, 5.4], [0, 2.2, -7], [0, -0.7, -2.6], '#3a4624'],
    ['eyeL', [1.8, 1.8, 1.8], [2.2, 5.6, -7], [0, 0, 0], '#e8d84a', { emissive: '#8a8a1a' }],
    ['eyeR', [1.8, 1.8, 1.8], [-2.2, 5.6, -7], [0, 0, 0], '#e8d84a', { emissive: '#8a8a1a' }],
    ['tail', [4, 3, 9], [0, 3, 8], [0, 0, 4.2], '#3e4c26'],
    ...[[4.2, -4, 'legA'], [4.2, 5, 'legB']].flatMap(([x, z, a], k) => [
      [`legL${k}`, [2, 2.6, 2.4], [x, 2.6, z], [0, -1.3, 0], '#34401e', { anim: a }],
      [`legR${k}`, [2, 2.6, 2.4], [-x, 2.6, z], [0, -1.3, 0], '#34401e', { anim: a === 'legA' ? 'legB' : 'legA' }],
    ]),
  ],
};
// a long dark snout: nostrils on top, a line of teeth under the jaw
FACES.peat_lurker = (c) => {
  c.fillStyle = '#1c2610'; c.fillRect(0, 0, 16, 5);
  c.fillStyle = '#d8cc40'; c.fillRect(2, 5, 3, 2); c.fillRect(11, 5, 3, 2);
  c.fillStyle = '#10140a'; c.fillRect(3, 5, 1, 2); c.fillRect(12, 5, 1, 2);
  c.fillStyle = '#10140a'; c.fillRect(7, 3, 2, 1);
  c.fillStyle = '#e8e0c4'; for (let x = 2; x < 14; x += 2) c.fillRect(x, 11, 1, 2);
};

// ---------------------------------------------------------------------------------------------
// Cliffkite

function kiteAI(m, g, p) {
  const b = m.body, w = g.world;
  if (!m.home) m.home = { x: m.x, y: m.y - KITE.CLIMB, z: m.z };
  if (m.ringR === undefined) { m.ringR = KITE.ORBIT_MIN + Math.random() * (KITE.ORBIT_MAX - KITE.ORBIT_MIN); m.ringA = Math.random() * TAU; m.ringDir = Math.random() < 0.5 ? 1 : -1; }
  m.headPitch = 0; m.move = null;
  let pt, k = 0.016;
  if (m.grudge > 0) {
    // a struck kite stoops on whoever hit it
    m.grudge--;
    m.angry = m.grudge > 0;
    if (!p.dead && !p.creative && m.grudge > 0) {
      pt = { x: p.x, y: p.y + 1.2, z: p.z }; k = 0.05;
      const dx = p.x - m.x, dy = p.y + 1 - m.y, dz = p.z - m.z;
      if (dx * dx + dy * dy + dz * dz < 2.2) { const r = m.attackCooldown <= 0; m.tryMelee(g, p); if (r) m.grudge = Math.min(m.grudge, 40); }
    }
  } else m.angry = false;
  if (!pt) {
    m.ringA += m.ringDir * 0.01;
    pt = kiteRingPoint(m.home, m.ringA, m.ringR, g.ticks / 20);
    if (!p.dead && Math.hypot(p.x - m.x, p.z - m.z) < 7 && p.y > m.y - 6) { pt = { x: m.x + (m.x - p.x) * 2, y: m.y + 5, z: m.z + (m.z - p.z) * 2 }; k = 0.03; } // keeps clear of people
  }
  if (m.panicTicks > 0) { m.panicTicks--; pt = { x: m.x + (m.x - p.x) * 3, y: m.y + 8, z: m.z + (m.z - p.z) * 3 }; k = 0.04; }
  const dx = pt.x - m.x, dy = pt.y - m.y, dz = pt.z - m.z, l = Math.hypot(dx, dy, dz) || 1;
  b.vx += dx / l * k; b.vy += dy / l * k * 0.6; b.vz += dz / l * k;
  if (b.horizontalCollision) b.vy += 0.05;
  const gy = w.heightAt(Math.floor(m.x), Math.floor(m.z));
  if (m.y < gy + 3 && !m.angry) b.vy += 0.03; // stays over the ground
  const sp = Math.hypot(b.vx, b.vz);
  if (sp > 0.02) m.yaw += wrap(Math.atan2(-b.vx, -b.vz) - m.yaw) * 0.12;
  if (Math.random() < 1 / 1000) g.audio.play('kite', [m.x, m.y, m.z], 0.5);
}

function kiteHurt(m, dmg, source, attacker) {
  if (attacker && attacker !== m && source !== 'fire' && source !== 'lava' && source !== 'drown' && source !== 'fall') m.grudge = KITE.GRUDGE;
  return dmg;
}

function kiteRender(m, model, alpha, sec) {
  const pa = model.userData.parts; if (!pa || !pa.wingL) return;
  const glide = m.angry ? Math.sin(sec * 9 + m.id) * 0.5 : Math.sin(sec * 1.4 + m.id) * 0.06;
  pa.wingL.rotation.z = glide; pa.wingR.rotation.z = -glide;
  pa.tail.rotation.x = 0.1 + Math.sin(sec * 1.8 + m.id) * 0.08;
  model.rotation.z = Math.max(-0.45, Math.min(0.45, (m.ringDir || 0) * -0.3)); // banks into its turn
  if (m.angry) model.rotation.x = 0.5;
}

MODELS.cliffkite = {
  parts: [
    ['body', [4, 3, 9], [0, 4, 0], [0, 0, 0], '#8a4a2a'],
    ['chest', [3.2, 1.6, 6], [0, 2.8, -0.5], [0, 0, 0], '#e8d8b8'],
    ['head', [3.6, 3.2, 3.6], [0, 4.4, -5.4], [0, 0, -1.2], '#fffffc', { face: 'cliffkite' }],
    ['beak', [1.4, 1.6, 2.6], [0, 4, -7.8], [0, -0.4, -0.8], '#e0b030'],
    ['wingL', [14, 0.8, 6], [2.2, 4.8, -0.5], [7, 0, 0], '#7a3e22'],
    ['wingR', [14, 0.8, 6], [-2.2, 4.8, -0.5], [-7, 0, 0], '#7a3e22'],
    ['tipL', [4, 0.8, 4.4], [16, 4.8, -0.5], [2, 0, 0.4], '#2e2018'],
    ['tipR', [4, 0.8, 4.4], [-16, 4.8, -0.5], [-2, 0, 0.4], '#2e2018'],
    ['tail', [3.6, 0.6, 6], [0, 4.4, 4.6], [0, 0, 3], '#c8662e'],
  ],
};
// a fierce yellow eye with a dark brow, a pale cheek
FACES.cliffkite = (c) => {
  c.fillStyle = '#e8d8b8'; c.fillRect(0, 8, 16, 8);
  c.fillStyle = '#2e2018'; c.fillRect(1, 3, 5, 2); c.fillRect(10, 3, 5, 2);
  c.fillStyle = '#f0c030'; c.fillRect(2, 5, 3, 3); c.fillRect(11, 5, 3, 3);
  c.fillStyle = '#17110a'; c.fillRect(3, 6, 1, 1); c.fillRect(12, 6, 1, 1);
};

// ---------------------------------------------------------------------------------------------
// definitions

export const SANDSNAPPER = {
  name: 'Sandsnapper', role: 'antlion', category: CATEGORY.MONSTER, sound: 'snap', burrower: true, ownCap: true, noFallDamage: true,
  health: 18, speed: 0.26, width: 0.8, height: 0.7, attack: 3, followRange: 12, panicSpeed: 1.2,
  drops: [{ id: B.SAND, min: 1, max: 2 }, { id: I.BONE, min: 0, max: 2 }, { id: I.SNAPPER_FANG, min: 0, max: 1, chance: 0.6 }],
  ownAI: snapperAI, onHurt: snapperHurt, customRender: snapperRender, digDust: sandPuff,
  onSpawn: (m) => { m.persistent = false; m.special = true; m.emerging = 0; m.digging = 0; m.lost = 0; m.stray = 0; m.cooldown = 0; m.up = 0; m.bitten = false; },
};
export const PEAT_LURKER = {
  name: 'Peat Lurker', role: 'bog crocodile', category: CATEGORY.MONSTER, sound: 'gurgle', ownCap: true, breathesWater: true, noFallDamage: true,
  health: 22, speed: 0.17, width: 0.9, height: 0.7, attack: 4, followRange: 12,
  drops: [{ id: I.PEAT_CLOT, min: 1, max: 2 }, { id: I.BONE, min: 0, max: 1 }, { id: I.CLAY_BALL, min: 0, max: 2 }],
  ownAI: lurkerAI, customRender: lurkerRender,
  onSpawn: (m) => { m.persistent = false; m.special = true; m.angry = false; m.dry = 0; m.cooldown = 0; },
};
export const CLIFFKITE = {
  name: 'Cliffkite', role: 'hawk', category: CATEGORY.CREATURE, flying: true, glider: true, sound: 'kite', noFallDamage: true,
  health: 10, speed: 0.14, width: 1.2, height: 0.5, attack: 2, panicSpeed: 1.4,
  drops: [{ id: I.FEATHER, min: 1, max: 3 }, { id: I.BONE, min: 0, max: 1 }, { id: I.RAW_CHICKEN, min: 0, max: 1, cooked: I.COOKED_CHICKEN }],
  ownAI: kiteAI, onHurt: kiteHurt, customRender: kiteRender,
  onSpawn: (m) => { m.persistent = false; m.grudge = 0; m.panicTicks = 0; },
};
for (const [k, d] of [['sandsnapper', SANDSNAPPER], ['peat_lurker', PEAT_LURKER], ['cliffkite', CLIFFKITE]]) {
  if (!MOBS[k]) { MOBS[k] = d; MOB_KEYS.push(k); }
}

// ---------------------------------------------------------------------------------------------
// spawning

const countOf = (g, type) => { let n = 0; for (const e of g.entities.list) if (e.type === type && !e.dead) n++; return n; };
const biomeKey = (w, x, z) => { const b = BIOMES[w.biomeAt(x, z)]; return b ? b.key : ''; };

/** A spot for a buried Sandsnapper: sand with two air blocks over it, in a desert or badlands. */
export function snapperSpot(w, x, z) {
  if (!w.isLoaded(x, z) || !DUNE_HABITATS.sandsnapper.includes(biomeKey(w, x, z))) return null;
  const y = w.heightAt(x, z);
  return snapperGround(w.getBlock(x, y, z), w.getBlock(x, y + 1, z), w.getBlock(x, y + 2, z)) ? { x, y: y + 1, z } : null;
}
/** A spot for a Peat Lurker: still water two or three deep in a swamp. */
export function lurkerSpot(w, x, z) {
  if (!w.isLoaded(x, z) || !DUNE_HABITATS.peat_lurker.includes(biomeKey(w, x, z))) return null;
  const top = w.heightAt(x, z);
  if (!isWaterish(w.getBlock(x, top, z))) return null;
  let d = 0;
  while (d < 6 && isWaterish(w.getBlock(x, top - d, z))) d++;
  return d >= 2 && d <= 5 && SOLID[w.getBlock(x, top - d, z)] ? { x, y: top - Math.min(d - 1, 1), z, depth: d } : null;
}

/** Called from MobSpawner.tick (host, overworld). A few cheap tries now and then. */
export function duneTick(spawner, rng = Math.random) {
  const g = spawner.game, w = g.world, p = g.player;
  if (p.dead || (w.dimension && w.dimension !== 'overworld')) return;
  if (g.ticks % 60 === 23) {
    const a = rng() * TAU, r = 12 + rng() * 26;
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    if (spawner.hostileEnabled()) {
      const s = snapperSpot(w, x, z);
      if (s && countOf(g, 'sandsnapper') < SNAP.MAX && rng() < 0.5 && spawner.canFit('sandsnapper', s.x, s.y, s.z)) spawner.spawnMob('sandsnapper', s.x + 0.5, s.y, s.z + 0.5);
      const l = lurkerSpot(w, x, z);
      if (l && countOf(g, 'peat_lurker') < LURK.MAX && rng() < 0.45) {
        const m = spawner.spawnMob('peat_lurker', l.x + 0.5, l.y, l.z + 0.5);
        if (m) m.home = { x: l.x + 0.5, y: l.y, z: l.z + 0.5 };
      }
    }
  }
  if (g.ticks % 100 === 71 && countOf(g, 'cliffkite') < KITE.MAX) {
    const a = rng() * TAU, r = 18 + rng() * 30;
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    if (w.isLoaded(x, z) && biomeKey(w, x, z) === 'badlands' && rng() < 0.6) {
      const y = w.heightAt(x, z) + 9 + Math.floor(rng() * 5);
      const m = spawner.spawnMob('cliffkite', x + 0.5, y, z + 0.5);
      if (m) m.home = { x: x + 0.5, y: y - KITE.CLIMB, z: z + 0.5 };
    }
  }
}

/** Once, when chunk (cx, cz) is made: a pair of Cliffkites over each Slot Canyon whose centre lies in it. */
export function duneChunkSpawn(spawner, cx, cz) {
  const gen = spawner.game.world.gen;
  if (!gen || !gen.column) return;
  for (const s of canyonsNear(gen, cx * 16, cz * 16, cx * 16 + 15, cz * 16 + 15)) {
    if (Math.floor(s.cx / 16) !== cx || Math.floor(s.cz / 16) !== cz) continue;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * TAU, x = s.cx + 0.5 + Math.cos(a) * 8, z = s.cz + 0.5 + Math.sin(a) * 8, y = s.y + 8 + Math.random() * 4;
      const m = spawner.spawnMob('cliffkite', x, y, z);
      if (m) m.home = { x: s.cx + 0.5, y: s.y + 8 - KITE.CLIMB, z: s.cz + 0.5 };
    }
  }
}
