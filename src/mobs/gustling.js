// Gustling (reference: breeze): a small, wind-wrapped spirit that haunts the Proving Vaults (a Proving
// Spawner can be set to call them). It hovers around its target at a few blocks' distance, circling and
// bobbing, and every second or so winds up (its rods whirl faster) and hurls a Gust: a fast ball of wind
// that does 1 damage but flings whoever it hits away, up and back. A Gust that strikes a wall bursts and
// shoves everything within 2.5 blocks. Arrows, spears and fireballs are turned aside without harm; only
// melee, thrown elixirs and the like hurt it. Drops 1-2 Gale Rods (right-click one to burst upwards).
// Simulated on the host; guests see the windup through the mob's "angry" flag.
// Pure rules (impulses, deflection, timing) are exported for the tests.
import * as THREE from 'three';
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { I } from '../world/items.js';
import { BLOCKS } from '../world/blocks.js';

/** Damage of a Gust, the distance it is thrown from, how fast it flies, the burst radius. */
export const GUST_DAMAGE = 1, GUST_RANGE = 16, GUST_SPEED = 0.9, GUST_RADIUS = 2.5;
/** Ticks the windup takes, and the pause between two Gusts (45 to 69 ticks). */
export const WINDUP_TICKS = 12;
export const gustCooldown = (rng = Math.random) => 45 + Math.floor(rng() * 25);
/** Damage sources it turns aside (arrows, spears, fireballs). */
export const DEFLECTED = new Set(['arrow', 'spear', 'fireball']);
export const deflects = (source) => DEFLECTED.has(source);

/**
 * The shove a Gust gives something `dist` blocks from its centre (`dx`, `dz` the horizontal offset from
 * the centre to the victim): up to 1.1 blocks/tick away along the ground, 0.4 to 0.7 up, nothing beyond
 * the radius. A `direct` hit (the ball itself struck) throws at full strength along its flight.
 */
export function gustImpulse(dx, dz, dist, radius = GUST_RADIUS, direct = false) {
  const f = direct ? 1 : Math.max(0, 1 - dist / radius);
  if (f <= 0) return [0, 0, 0];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l * 1.1 * f, 0.4 + 0.3 * f, dz / l * 1.1 * f];
}

/** Give a body (a player's, a mob's) a gust impulse. */
function shove(body, imp) {
  if (!body) return;
  body.vx += imp[0]; body.vz += imp[2];
  body.vy = Math.max(body.vy, imp[1]);
  if (body.onGround !== undefined) body.onGround = false;
  body.fallDistance = 0;
}

/** The physics body of something a Gust hit: the local player's, a mob's; none for a guest's stand-in. */
function bodyOf(game, t) {
  if (t.isPlayer) return t.remote ? null : game.player.body;
  return t.body || null;
}

/** Burst at (x, y, z): shove everything near (not Gustlings, nor `skip`, which the ball itself already threw), puff, whoosh. */
export function gustBurst(game, x, y, z, skip = null) {
  const p = game.player, cands = [];
  if (!p.dead && !p.creative && !(skip && skip.isPlayer)) cands.push({ isPlayer: true, x: p.x, y: p.y, z: p.z, height: p.body.height });
  for (const e of game.entities.list) if (e.kind === 'mob' && !e.dead && e.deathTime === 0 && e.type !== 'gustling' && e !== skip) cands.push(e);
  for (const t of cands) {
    const dx = t.x - x, dy = t.y + (t.height || 1) * 0.5 - y, dz = t.z - z, d = Math.hypot(dx, dy, dz);
    if (d > GUST_RADIUS) continue;
    shove(bodyOf(game, t), gustImpulse(dx, dz, d));
  }
  for (let k = 0; k < 10; k++) game.particles.emit(x, y, z, (Math.random() - 0.5) * 0.3, 0.05 + Math.random() * 0.1, (Math.random() - 0.5) * 0.3, 0.92, 0.97, 1, 16, 0);
  game.audio.play('gust', [x, y, z], 0.8);
}

// ---- the Gust ---------------------------------------------------------------------------
let nextId = 7_000_000;
const geo = typeof THREE.BoxGeometry === 'function' ? new THREE.BoxGeometry(0.34, 0.34, 0.34) : null;

/** A ball of wind: flies straight and fast; a body it hits is hurt a little and thrown, a wall makes it burst. */
export class Gust {
  constructor(x, y, z, vx, vy, vz, shooter) {
    this.id = nextId++;
    this.kind = 'gust';
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.prev = [x, y, z];
    this.shooter = shooter;
    this.age = 0; this.dead = false;
  }

  tick(game) {
    this.prev = [this.x, this.y, this.z];
    if (++this.age > 100) { this.dead = true; return; }
    const speed = Math.hypot(this.vx, this.vy, this.vz) || 1e-6;
    const dx = this.vx / speed, dy = this.vy / speed, dz = this.vz / speed;
    const hit = game.world.raycast(this.x, this.y, this.z, dx, dy, dz, speed, true);
    const end = hit ? hit.dist : speed;
    const target = game.entities.sweepHit(this, this.x, this.y, this.z, dx, dy, dz, end);
    if (target && target.type !== 'gustling') {
      this.x += dx * end; this.y += dy * end; this.z += dz * end;
      this.strike(game, target, dx, dz);
      return;
    }
    if (hit && !(BLOCKS[hit.id] && BLOCKS[hit.id].fluid)) {
      this.dead = true;
      gustBurst(game, this.x + dx * hit.dist - dx * 0.3, this.y + dy * hit.dist - dy * 0.3, this.z + dz * hit.dist - dz * 0.3);
      return;
    }
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    game.particles.emit(this.x, this.y, this.z, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04, 0.92, 0.97, 1, 10, 0);
  }

  /** The ball struck something: a point of damage, and it is flung along the flight. */
  strike(game, t, dx, dz) {
    this.dead = true;
    const hurt = t.hurt(GUST_DAMAGE, 'mob:Gustling', this.shooter, 1.2, this);
    if (hurt !== false) shove(bodyOf(game, t), gustImpulse(dx, dz, 0, GUST_RADIUS, true));
    gustBurst(game, this.x, this.y, this.z, t);
  }

  createMesh() {
    const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xf2fbff }));
    const glow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xa8e0ff, transparent: true, opacity: 0.4, depthWrite: false }));
    glow.scale.setScalar(1.7);
    const g = new THREE.Group();
    g.add(core); g.add(glow);
    g.userData.dispose = () => { core.material.dispose(); glow.material.dispose(); };
    return g;
  }

  renderUpdate(m, px, py, pz, alpha, L, sec) {
    m.position.set(px, py, pz);
    m.rotation.set(sec * 7, sec * 9, sec * 5);
  }
}

// ---- AI ---------------------------------------------------------------------------------
const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

function floorBelow(g, x, y, z, max = 12) {
  for (let k = 0; k < max; k++) {
    const id = g.world.getBlock(Math.floor(x), Math.floor(y) - k, Math.floor(z));
    if (BLOCKS[id] && BLOCKS[id].solid) return Math.floor(y) - k + 1;
  }
  return null;
}

function gustlingAI(m, g, p, pdist) {
  const b = m.body;
  m.headPitch = 0;
  const has = m.acquire(g, p, pdist, m.def.followRange);
  if (!has) {
    // idle: drift a block or two over the floor, bobbing
    m.angry = false; m.windup = 0;
    const floor = floorBelow(g, m.x, m.y, m.z);
    const hoverY = (floor === null ? m.y : floor + 1.4) + Math.sin((g.ticks + m.id * 7) * 0.08) * 0.5; // no floor within reach: hold its height
    b.vy += (hoverY - m.y) * 0.03 - b.vy * 0.06;
    if (Math.random() < 1 / 50) { b.vx += (Math.random() - 0.5) * 0.12; b.vz += (Math.random() - 0.5) * 0.12; }
    if (b.horizontalCollision) { b.vx *= -0.5; b.vz *= -0.5; }
    if (Math.hypot(b.vx, b.vz) > 0.02) m.yaw += wrap(Math.atan2(-b.vx, -b.vz) - m.yaw) * 0.2;
    return;
  }
  // in sight of a player: circle it a few blocks away, level with its head, then hurl a Gust
  const dx = p.x - m.x, dz = p.z - m.z, d = Math.hypot(dx, dz) || 1;
  m.yaw += wrap(Math.atan2(-dx, -dz) - m.yaw) * 0.4;
  if (m.orbitDir === undefined) m.orbitDir = Math.random() < 0.5 ? 1 : -1;
  if (Math.random() < 0.012 || b.horizontalCollision) m.orbitDir *= -1;
  const radial = (d - 5) * 0.012, tang = m.orbitDir * 0.02;
  b.vx += dx / d * radial + (-dz / d) * tang;
  b.vz += dz / d * radial + (dx / d) * tang;
  const hoverY = p.y + 1.6 + Math.sin((g.ticks + m.id * 5) * 0.1) * 0.6;
  b.vy += (hoverY - m.y) * 0.04 - b.vy * 0.06;
  if (b.horizontalCollision) b.vy += 0.03;
  m.gustTimer = m.gustTimer ?? gustCooldown();
  if (m.gustTimer > 0) m.gustTimer--;
  const sees = m._sees === undefined || g.ticks % 2 === m.id % 2 ? (m._sees = m.canSee(g, p.x, p.y + p.eyeHeight, p.z)) : m._sees;
  if (m.gustTimer <= 0 && sees && pdist <= GUST_RANGE) {
    m.windup = (m.windup || 0) + 1;
    m.angry = true;
    if (m.windup === 1) g.audio.play('gust', [m.x, m.y + 0.6, m.z], 0.4);
    if (m.windup >= WINDUP_TICKS) { hurl(m, g, p); m.windup = 0; m.angry = false; m.gustTimer = gustCooldown(); }
  } else { m.windup = 0; m.angry = false; }
}

/** Throw a Gust at the player's chest, with a little spread. */
function hurl(m, g, p) {
  const sx = m.x, sy = m.y + m.height * 0.6, sz = m.z;
  const tx = p.x + (Math.random() - 0.5) * 0.6, ty = p.y + (p.body ? p.body.height : 1.8) * 0.5, tz = p.z + (Math.random() - 0.5) * 0.6;
  const dx = tx - sx, dy = ty - sy, dz = tz - sz, l = Math.hypot(dx, dy, dz) || 1;
  g.entities.add(new Gust(sx, sy, sz, dx / l * GUST_SPEED, dy / l * GUST_SPEED, dz / l * GUST_SPEED, m));
  g.audio.play('gust', [sx, sy, sz], 0.9);
}

/** Arrows and the like glance off (with a puff); everything else counts. */
function gustlingHurt(m, dmg, source) {
  if (!deflects(source)) return dmg;
  const g = m._game;
  if (g && g.particles) for (let k = 0; k < 4; k++) g.particles.emit(m.x, m.y + 0.5, m.z, (Math.random() - 0.5) * 0.2, Math.random() * 0.1, (Math.random() - 0.5) * 0.2, 0.92, 0.97, 1, 12, 0);
  if (g && g.audio) g.audio.play('shield', [m.x, m.y + 0.5, m.z], 0.4);
  return 0;
}

/** The rods whirl three times as fast during the windup. */
function gustlingRender(m, model) {
  if (!m.angry) return;
  for (const [name, part] of Object.entries(model.userData.parts)) if (name.startsWith('whirl')) part.rotation.y *= 3;
}

// ---- the model --------------------------------------------------------------------------
MODELS.gustling = {
  parts: [
    ['head', [6, 6, 6], [0, 11, 0], [0, 0, 0], '#d6edf4', { face: 'gustling' }],
    ['core', [4, 6, 4], [0, 5, 0], [0, 0, 0], '#9cc4d6'],
    ...[0, 1, 2].map((i) => [`whirlA${i}`, [2, 5, 2], [0, 8, 0], [5, 0, 0], '#eef9fc', { anim: 'orbit', idx: i, emissive: '#6a8a98' }]),
    ...[0, 1, 2].map((i) => [`whirlB${i}`, [2, 3, 2], [0, 3, 0], [4, 0, 0], '#cfe6ee', { anim: 'orbitB', idx: i }]),
    ['wisp', [3, 4, 3], [0, 0, 0], [0, 1, 0], '#b6d8e4', { anim: 'tendril', idx: 0 }],
  ],
};
FACES.gustling = (c) => {
  c.fillStyle = '#243a46'; c.fillRect(3, 6, 3, 2); c.fillRect(10, 6, 3, 2);
  c.fillStyle = '#e8fbff'; c.fillRect(4, 6, 1, 1); c.fillRect(11, 6, 1, 1);
  c.fillStyle = '#5a8294'; c.fillRect(6, 11, 4, 1);
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, 16, 2); // a swept-back crest of wind
};

export const GUSTLING = {
  name: 'Gustling', role: 'breeze', category: CATEGORY.MONSTER,
  health: 20, speed: 0.25, width: 0.5, height: 0.9, attack: 0, followRange: 24, sound: 'gust',
  flying: true, noFallDamage: true, customAI: gustlingAI, onHurt: gustlingHurt, customRender: gustlingRender,
  xp: 10,
  drops: [{ id: I.GALE_ROD, min: 1, max: 2, playerOnly: true }],
};
if (!MOBS.gustling) { MOBS.gustling = GUSTLING; MOB_KEYS.push('gustling'); }

// ---- the Gale Rod -------------------------------------------------------------------------
/** Right-click with a Gale Rod: burst upwards (about 7 blocks), with a soft landing. */
export function galeLeap(game) {
  const p = game.player;
  p.body.vy = Math.max(p.body.vy, 1.0);
  p.body.onGround = false;
  p.body.fallDistance = 0;
  if (p.addEffect) p.addEffect('slow_falling', 100, 0);
  for (let k = 0; k < 16; k++) game.particles.emit(p.x + (Math.random() - 0.5) * 0.8, p.y + 0.1, p.z + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.1, -0.05 - Math.random() * 0.1, (Math.random() - 0.5) * 0.1, 0.92, 0.97, 1, 16, 0);
  game.audio.play('gust', [p.x, p.y, p.z], 0.9);
}
