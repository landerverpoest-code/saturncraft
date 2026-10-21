// Gloomshell (reference: shulker): a violet box that clings to the walls of
// Hollow Cities. Closed it is armoured (20 points); now and then it peeks.
// When a player comes within 16 blocks and in sight it opens and every 1-5.5 s
// fires a Drift Spark, a slow homing orb that hits for 4 and lifts its victim
// with Levitation for 10 s. Hurt below half health it may blink to another
// spot nearby. Drops a Gloomshell Husk half of the time; two husks and a
// chest make a Gloomshell Box. Simulated on the host; guests see the lid open
// through the mob's "angry" flag.
import * as THREE from 'three';
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { I } from '../world/items.js';
import { SOLID } from '../world/blocks.js';
import { DIM_SPAWN_TABLES } from './dimensionMobs.js';

export const SPARK_DAMAGE = 4, SPARK_LEVITATION = 200;

/** Damage a Gloomshell takes: closed, its shell counts as 20 armour points (reference formula). */
export function gloomshellDamage(dmg, open) {
  if (open) return dmg;
  const f = Math.min(20, Math.max(20 / 5, 20 - dmg / 2));
  return dmg * (1 - f / 25);
}

/** Ticks until the next shot (reference: 20 + 0..9 x 10). */
export const sparkDelay = (rng = Math.random) => 20 + Math.floor(rng() * 10) * 10;

function gloomAI(m, g, p, pdist) {
  const b = m.body;
  b.vx = 0; b.vz = 0; b.vy = 0;
  m.peek = m.peek ?? 0;
  m.sparkTimer = m.sparkTimer ?? sparkDelay();
  const sees = !p.dead && !p.creative && pdist < 16 && (g.ticks % 5 === m.id % 5 ? (m._sees = m.canSee(g, p.x, p.y + (p.eyeHeight || 1.6), p.z)) : m._sees);
  let want = 0;
  if (sees) {
    want = 1;
    m.yaw = Math.atan2(-(p.x - m.x), -(p.z - m.z));
    if (--m.sparkTimer <= 0) {
      m.sparkTimer = sparkDelay();
      g.entities.add(new DriftSpark(m.x, m.y + 0.5, m.z, p, m));
      g.audio.play('warble', [m.x, m.y + 0.5, m.z], 0.4);
    }
  } else {
    // idle peeking
    if (m.peekTimer > 0) { m.peekTimer--; want = 0.3; }
    else if (Math.random() < 1 / 120) m.peekTimer = 40 + Math.floor(Math.random() * 60);
  }
  m.peek += Math.max(-0.08, Math.min(0.08, want - m.peek));
  m.angry = m.peek > 0.5;
  m.headPitch = 0;
}

function gloomHurt(m, dmg, source, attacker) {
  dmg = gloomshellDamage(dmg, (m.peek || 0) > 0.2);
  const g = m._game;
  if (g && m.health - dmg > 0 && m.health - dmg < m.def.health / 2 && Math.random() < 0.25) blink(m, g);
  return dmg;
}

/** Jump to a free spot with a floor within 8 blocks (reference: up to 5 tries). */
function blink(m, g) {
  const w = g.world;
  for (let k = 0; k < 5; k++) {
    const x = Math.floor(m.x + (Math.random() - 0.5) * 16), y = Math.floor(m.y + (Math.random() - 0.5) * 16), z = Math.floor(m.z + (Math.random() - 0.5) * 16);
    if (!w.isLoaded(x, z) || SOLID[w.getBlock(x, y, z)] || !SOLID[w.getBlock(x, y - 1, z)]) continue;
    g.particles.smoke(m.x, m.y + 0.5, m.z, 8, 0.6);
    m.body.setPos(x + 0.5, y, z + 0.5);
    m.prev = [x + 0.5, y, z + 0.5];
    g.audio.play('teleport', [x + 0.5, y + 0.5, z + 0.5], 0.6);
    return true;
  }
  return false;
}

function gloomRender(m, model, alpha, sec) {
  const parts = model.userData.parts, open = m.peek ?? (m.angry ? 1 : 0);
  // guests have no peek state: ease towards the host's open / closed flag
  if (m.peek === undefined) { m._vpeek = (m._vpeek || 0) + ((m.angry ? 1 : 0) - (m._vpeek || 0)) * 0.15; }
  const k = m.peek === undefined ? m._vpeek : open;
  parts.lid.position.y = parts.lid.userData.baseY + k * 0.5;
  parts.lid.rotation.y = k * 0.6;
  parts.head.position.y = parts.head.userData.baseY + k * 0.12;
  model.rotation.z = m.deathTime > 0 ? 0 : model.rotation.z;
}

MODELS.gloomshell = {
  parts: [
    ['base', [16, 8, 16], [0, 4, 0], [0, 0, 0], '#7a4a8a'],
    ['head', [6, 6, 6], [0, 7, 0], [0, 0, 0], '#e8d8a0', { face: 'gloomshell' }],
    ['lid', [16, 12, 16], [0, 4, 0], [0, 6, 0], '#9a64a8'],
  ],
};
FACES.gloomshell = (c) => {
  c.fillStyle = '#1a1020'; c.fillRect(3, 5, 3, 3); c.fillRect(10, 5, 3, 3);
  c.fillStyle = '#7affd0'; c.fillRect(4, 6, 1, 1); c.fillRect(11, 6, 1, 1);
  c.fillStyle = '#5a3a30'; c.fillRect(5, 11, 6, 1);
};

export const GLOOMSHELL = {
  name: 'Gloomshell', role: 'shulker', category: CATEGORY.MONSTER,
  health: 30, speed: 0, width: 1, height: 1, followRange: 16, sound: 'click',
  noFallDamage: true, // sits on a floor; it never walks
  customAI: gloomAI, onHurt: gloomHurt, customRender: gloomRender,
  drops: [{ id: I.GLOOMSHELL_HUSK, min: 0, max: 1 }],
};
if (!MOBS.gloomshell) { MOBS.gloomshell = GLOOMSHELL; MOB_KEYS.push('gloomshell'); }
// natural spawning inside Hollow Cities (dimensionMobs.js picks this table there)
DIM_SPAWN_TABLES.hollowCity = [{ type: 'gloomshell', weight: 100, min: 1, max: 1 }];

// ---- Drift Spark ------------------------------------------------------------------
let nextId = 6_000_000;
const geo = typeof THREE.BoxGeometry === 'function' ? new THREE.BoxGeometry(0.3, 0.3, 0.3) : null;

/**
 * The homing orb: flies at up to 0.25 blocks/tick, turning towards its target a little each
 * tick; burns out after 15 s or on hitting a block. On a player: 4 damage and Levitation.
 */
export class DriftSpark {
  constructor(x, y, z, target, shooter) {
    this.id = nextId++;
    this.kind = 'spark';
    this.x = x; this.y = y; this.z = z;
    this.prev = [x, y, z];
    this.target = target; this.shooter = shooter;
    this.vx = 0; this.vy = 0.15; this.vz = 0;
    this.age = 0; this.dead = false;
  }

  tick(game) {
    this.prev = [this.x, this.y, this.z];
    if (++this.age > 300) { this.burst(game); return; }
    const t = this.target;
    if (t && !t.dead) {
      const tx = t.x - this.x, ty = t.y + (t.height || 1.8) * 0.5 - this.y, tz = t.z - this.z, l = Math.hypot(tx, ty, tz) || 1;
      this.vx += (tx / l * 0.25 - this.vx) * 0.08; this.vy += (ty / l * 0.25 - this.vy) * 0.08; this.vz += (tz / l * 0.25 - this.vz) * 0.08;
      if (l < 0.6 + (t.width || 0.6) / 2) { this.hit(game, t); return; }
    } else this.vy -= 0.01;
    const nx = this.x + this.vx, ny = this.y + this.vy, nz = this.z + this.vz;
    if (SOLID[game.world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz))]) { this.burst(game); return; }
    this.x = nx; this.y = ny; this.z = nz;
    if (Math.random() < 0.5) game.particles.emit(this.x, this.y, this.z, 0, 0, 0, 0.9, 0.85, 1, 12, 0);
  }

  hit(game, t) {
    const lifted = t.hurt(SPARK_DAMAGE, 'mob:Gloomshell', this.shooter);
    if (lifted !== false) {
      if (t.addEffect) t.addEffect('levitation', SPARK_LEVITATION, 0); // the player (or a guest's stand-in)
      else if (t.applyEffect) t.applyEffect('levitation', SPARK_LEVITATION); // a mob
    }
    this.burst(game);
  }

  burst(game) {
    this.dead = true;
    for (let k = 0; k < 8; k++) game.particles.emit(this.x, this.y, this.z, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15, 0.95, 0.9, 1, 16, 0);
    game.audio.play('fizz', [this.x, this.y, this.z], 0.4);
  }

  createMesh() {
    const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xf4ecff }));
    const glow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xc890ff, transparent: true, opacity: 0.4, depthWrite: false }));
    glow.scale.setScalar(1.6);
    const g = new THREE.Group();
    g.add(core); g.add(glow);
    g.userData.dispose = () => { core.material.dispose(); glow.material.dispose(); };
    return g;
  }

  renderUpdate(m, px, py, pz, alpha, L, sec) {
    m.position.set(px, py, pz);
    m.rotation.set(sec * 4, sec * 6, 0);
  }
}
