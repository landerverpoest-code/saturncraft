// Mobs of the Cinderdeep's sub-biomes (world/dimensions/cinderBiomes.js), built from the behaviours the
// game already has and registered into MOBS like the other dimension mobs:
//  * Capwalker    (neutral)  - a glowing toadstool-folk of the Glowcap Thicket. It grazes among the
//    stalks and ignores you until you hurt one; then it and its kin within 12 blocks chase you and
//    their bite carries poison (the melee chase of the Cinder Brute with a grudge timer, as the
//    Voidwalker's "neutral until provoked"). Drops Glowcap Spores.
//  * Dirge Wailer (hostile)  - a pale shroud that drifts through the Dirgevale (the flight of the
//    Ashwraith and Ember Lord). Within 32 blocks it keeps its distance, rears up and wails: a ring
//    of sound that hurts and slows everyone within 7 blocks in its sight. Drops bones, Wraith Tears
//    and, now and then, a Dirge Crystal.
// Both bring their own box models, faces, voices (captioned) and spawn tables (dimensionMobs.js).
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { decorate, followDecor } from './modelKit.js';
import { I } from '../world/items.js';
import { SPAWNER_TYPES } from './spawnerBlocks.js';
import { flyTowards, faceTowards, wrap } from './dimensionMobs.js';

export const CAPWALKER_GRUDGE = 600;   // ticks a provoked Capwalker stays angry (30 s)
export const CAPWALKER_ALARM = 12;     // blocks within which its kin join in
export const WAIL_RANGE = 7, WAIL_DAMAGE = 4, WAIL_SLOW = 80, WAIL_WINDUP = 20, WAIL_COOLDOWN = 60;

const TAU = Math.PI * 2;

// ---- Capwalker -------------------------------------------------------------------------
function capwalkerAI(m, g, p, pdist) {
  const mad = m.provoked > 0 && !p.dead && !p.creative;
  if (m.provoked > 0) m.provoked--;
  m.angry = mad;
  if (mad) {
    m.target = 'player';
    m.chase(g, p, 1.15);
    m.tryMelee(g, p);
    if (g.ticks % 8 === m.id % 8) g.particles.emit(m.x + (Math.random() - 0.5) * 0.8, m.y + 1.4, m.z + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.04, 0.03, (Math.random() - 0.5) * 0.04, 0.5, 0.95, 0.6, 24, 0);
  } else {
    m.target = null;
    m.wanderAI(g, 0.6);
    if (Math.random() < 0.06) g.particles.emit(m.x + (Math.random() - 0.5) * 0.9, m.y + 1.5 + Math.random() * 0.3, m.z + (Math.random() - 0.5) * 0.9, 0, 0.012, 0, 0.35, 1, 0.8, 40, 0);
    if (Math.random() < 1 / 900) g.audio.play('spore_puff', [m.x, m.y + 1, m.z], 0.3);
  }
}

/** Hurting a Capwalker angers it and its kin nearby. */
function capwalkerHurt(m, dmg, source, attacker) {
  const g = m._game;
  if (attacker && attacker !== m && source !== 'fire' && source !== 'lava') {
    m.provoked = CAPWALKER_GRUDGE;
    if (g) for (const e of g.entities.list) {
      if (e.type === 'capwalker' && e !== m && !e.dead && Math.hypot(e.x - m.x, e.z - m.z) < CAPWALKER_ALARM) e.provoked = Math.max(e.provoked || 0, CAPWALKER_GRUDGE * 0.7);
    }
    if (g) g.audio.play('spore_puff', [m.x, m.y + 1, m.z], 0.6);
  }
  return dmg;
}

MODELS.capwalker = {
  parts: decorate([
    ['legL', [3, 6, 3], [2, 6, 0], [0, -3, 0], '#cfc7ac', { anim: 'legA' }],
    ['legR', [3, 6, 3], [-2, 6, 0], [0, -3, 0], '#cfc7ac', { anim: 'legB' }],
    ['body', [7, 8, 5], [0, 10, 0], [0, 0, 0], '#ded7bd'],
    ['head', [8, 6, 8], [0, 14, 0], [0, 3, 0], '#e8e1c8', { face: 'capwalker' }],
    ['cap', [17, 4, 17], [0, 20, 0], [0, 2, 0], '#23a890', { emissive: '#0e6a58' }],
    ['capTop', [11, 3, 11], [0, 24, 0], [0, 1.5, 0], '#58e8c4', { emissive: '#1f9a80' }],
    ['spotA', [3, 1, 3], [-3, 27, 2], [0, 0.5, 0], '#d8fff0', { emissive: '#7ae0c0' }],
    ['spotB', [2, 1, 2], [3, 27, -2], [0, 0.5, 0], '#d8fff0', { emissive: '#7ae0c0' }],
  ], {
    cap: [
      ['gills', [14, 1.6, 14], [0, -1.8, 0], '#127a68'],
      ['capRim', [17.8, 1.2, 17.8], [0, -1.2, 0], '#1b8f7a'],
      ['spotC', [3.4, 1.2, 3.4], [-4.5, 2.1, 3.5], '#d8fff0', { emissive: '#7ae0c0' }],
      ['spotD', [2.4, 1.2, 2.4], [4.5, 2.1, 3.5], '#b8f6e0', { emissive: '#5ac8a8' }],
      ['spotE', [2.6, 1.2, 2.6], [-2, 2.1, -5], '#d8fff0', { emissive: '#7ae0c0' }],
      ['spotF', [3.4, 1, 3.4], [8.7, -0.2, 0], '#9ae8d0', { emissive: '#3ab090' }],
      ['spotG', [3.4, 1, 3.4], [-8.7, 0.4, -2], '#9ae8d0', { emissive: '#3ab090' }],
    ],
    body: [
      ['neckBand', [8, 1.6, 6], [0, 3.8, 0], '#b9b095'],
      ['bellyPatch', [4.6, 5, 0.6], [0, -0.6, -2.6], '#f4eed8'],
      ['stemBand', [7.4, 1, 5.4], [0, -2.2, 0], '#c4bca0'],
    ],
    'leg@': [['foot@', [3.8, 1.6, 5], [0, -2.6, -1], '#b9b095']],
    '*': [
      ['armL', [2, 6, 2], [4.5, 13, 0], [0, -2.6, 0], '#d6cfb4', { anim: 'armSwing' }],
      ['armR', [2, 6, 2], [-4.5, 13, 0], [0, -2.6, 0], '#d6cfb4', { anim: 'armSwingB' }],
    ],
  }),
};
FACES.capwalker = (c) => {
  c.fillStyle = '#16231f'; c.fillRect(3, 4, 3, 5); c.fillRect(10, 4, 3, 5);
  c.fillStyle = '#7affd0'; c.fillRect(4, 5, 2, 3); c.fillRect(11, 5, 2, 3);
  c.fillStyle = '#e8fff8'; c.fillRect(4, 5, 1, 1); c.fillRect(11, 5, 1, 1);
  c.fillStyle = '#16231f'; c.fillRect(3, 3, 3, 1); c.fillRect(10, 3, 3, 1);
  c.fillStyle = '#6a5a48'; c.fillRect(6, 11, 4, 1); c.fillRect(5, 10, 1, 1); c.fillRect(10, 10, 1, 1);
  c.fillStyle = '#e8a8a0'; c.fillRect(1, 9, 2, 2); c.fillRect(13, 9, 2, 2);
};

export const CAPWALKER = {
  name: 'Capwalker', role: 'mooshroom', category: CATEGORY.MONSTER, neutral: true,
  health: 14, speed: 0.2, width: 0.7, height: 1.55, attack: 3, fireImmune: true, followRange: 24, sound: 'spore_puff',
  hitEffect: ['poison', 100, 0], customAI: capwalkerAI, onHurt: capwalkerHurt,
  drops: [{ id: I.GLOWCAP_SPORES, min: 1, max: 3 }],
};

// ---- Dirge Wailer ----------------------------------------------------------------------
function wailerAI(m, g, p, pdist) {
  const b = m.body;
  const has = m.acquire(g, p, pdist, 32);
  m.charge = m.charge || 0;
  if (!m.fly || m.flyTimer-- <= 0 || b.horizontalCollision || Math.hypot(m.fly.x - m.x, m.fly.y - m.y, m.fly.z - m.z) < 1.5) {
    m.flyTimer = 60 + Math.floor(Math.random() * 100);
    m.fly = { x: m.x + (Math.random() - 0.5) * 20, y: Math.max(34, Math.min(110, m.y + (Math.random() - 0.5) * 6)), z: m.z + (Math.random() - 0.5) * 20 };
  }
  if (has) {
    faceTowards(m, p.x, p.z, 0.3);
    const dx = p.x - m.x, dz = p.z - m.z, d = Math.hypot(dx, dz) || 1;
    if (d > 8) { b.vx += dx / d * 0.014; b.vz += dz / d * 0.014; } else if (d < 4.5) { b.vx -= dx / d * 0.014; b.vz -= dz / d * 0.014; }
    b.vy += (p.y + 1.4 - m.y) * 0.015 - b.vy * 0.05;
    m.charge++;
    m.angry = m.charge >= 30; // rears up for the last stretch before the wail
    if (m.charge === 30) g.audio.play('dirge_wail', [m.x, m.y + 1, m.z], 0.7);
    if (m.charge >= 30 + WAIL_WINDUP) { wail(m, g, p); m.charge = -WAIL_COOLDOWN; m.angry = false; }
  } else {
    m.angry = false;
    if (m.charge > 0) m.charge--; else if (m.charge < 0) m.charge++;
    flyTowards(m, m.fly.x, m.fly.y, m.fly.z, 0.006);
    if (Math.hypot(b.vx, b.vz) > 0.01) m.yaw += wrap(Math.atan2(-b.vx, -b.vz) - m.yaw) * 0.1;
  }
  if (Math.random() < 1 / 260) g.audio.play('dirge_wail', [m.x, m.y + 1, m.z], 0.3);
  if (Math.random() < 0.25) g.particles.emit(m.x + (Math.random() - 0.5) * 0.8, m.y + 0.4 + Math.random() * 1.4, m.z + (Math.random() - 0.5) * 0.8, 0, 0.015, 0, 0.55, 0.75, 1, 30, 0);
}

/** The wail: a ring of sound that hurts and slows whoever it reaches in sight. */
function wail(m, g, p) {
  g.audio.play('dirge_wail', [m.x, m.y + 1, m.z], 1);
  for (let k = 0; k < 36; k++) {
    const a = k / 36 * TAU;
    g.particles.emit(m.x, m.y + 1, m.z, Math.cos(a) * 0.35, 0.01, Math.sin(a) * 0.35, 0.6, 0.8, 1, 18, 0);
  }
  if (p.dead || p.creative || Math.hypot(p.x - m.x, p.z - m.z, (p.y - m.y) * 0.5) > WAIL_RANGE) return;
  if (!m.canSee(g, p.x, p.y + (p.eyeHeight || 1.6), p.z)) return;
  if (p.hurt(WAIL_DAMAGE, 'mob:Dirge Wailer', m) !== false) {
    if (p.addEffect) p.addEffect('slowness', WAIL_SLOW, 1); else if (p.applyEffect) p.applyEffect('slowness', WAIL_SLOW, 1);
  }
}

MODELS.dirge_wailer = {
  parts: decorate([
    ...[-1, 0, 1].map((i) => [`rag${i + 1}`, [3, 14, 3], [i * 3.5, 12, 0], [0, -7, 0], '#8ea3bd', { anim: 'tendril', idx: i + 1 }]),
    ['body', [10, 14, 6], [0, 19, 0], [0, 0, 0], '#b4c4d8', { emissive: '#2a3a52' }],
    ['head', [9, 9, 9], [0, 29, 0], [0, 0, 0], '#d6e0ec', { face: 'dirge_wailer', emissive: '#364a68' }],
    ['armL', [3, 14, 3], [6.5, 26, 0], [0, -7, 0], '#9db0c8', { anim: 'armSwing' }],
    ['armR', [3, 14, 3], [-6.5, 26, 0], [0, -7, 0], '#9db0c8', { anim: 'armSwingB' }],
  ], {
    body: [
      ['rib0', [10.8, 1, 6.6], [0, 5, 0], '#e3ebf5'],
      ['rib1', [10.8, 1, 6.6], [0, 2.5, 0], '#e3ebf5'],
      ['rib2', [10.8, 1, 6.6], [0, 0, 0], '#e3ebf5'],
      ['shroudHem', [11, 2, 6.8], [0, -6, 0], '#8ea3bd'],
      ['neckRuff', [12, 2, 8], [0, 7, 0], '#6f84a2'],
    ],
    head: [
      ['veil', [9.8, 2.4, 9.8], [0, 3.4, 0], '#aebdd2'],
      ['spike@', [1.6, 5, 1.6], [3, 6.5, 0], '#eef4fa'],
      ['spikeTip@', [1, 3, 1], [3.2, 9.5, 0], '#ffffff'],
      ['jaw', [6, 2, 0.8], [0, -3.2, -4.6], '#2a3a52'],
    ],
    'arm@': [
      ['sleeve@', [3.6, 5, 3.6], [0, 4.5, 0], '#7488a4'],
      ['claw@', [3.6, 3.5, 3.6], [0, -7.2, 0], '#eef4fa'],
    ],
    rag0: [['tip0', [3.8, 3, 3.8], [0, -5.8, 0], '#6f8098']],
    rag1: [['tip1', [3.8, 3, 3.8], [0, -5.8, 0], '#6f8098']],
    rag2: [['tip2', [3.8, 3, 3.8], [0, -5.8, 0], '#6f8098']],
  }),
};
FACES.dirge_wailer = (c) => {
  c.fillStyle = '#0c1220'; c.fillRect(2, 3, 5, 6); c.fillRect(9, 3, 5, 6);
  c.fillStyle = '#7ac8f0'; c.fillRect(3, 5, 3, 3); c.fillRect(10, 5, 3, 3);
  c.fillStyle = '#e8fbff'; c.fillRect(4, 5, 1, 1); c.fillRect(11, 5, 1, 1);
  c.fillStyle = '#0c1220'; c.fillRect(6, 10, 4, 5); c.fillRect(7, 15, 2, 1);
  c.fillStyle = '#2a3a52'; c.fillRect(1, 2, 6, 1); c.fillRect(9, 2, 6, 1);
  c.fillStyle = '#e3ebf5'; c.fillRect(6, 10, 1, 1); c.fillRect(9, 10, 1, 1);
};

export const DIRGE_WAILER = {
  name: 'Dirge Wailer', role: 'phantom', category: CATEGORY.MONSTER,
  health: 16, speed: 0.12, width: 0.8, height: 1.9, followRange: 32, sound: 'dirge_wail',
  flying: true, noFallDamage: true, customAI: wailerAI,
  drops: [{ id: I.BONE, min: 0, max: 2 }, { id: I.WRAITH_TEAR, min: 0, max: 1, playerOnly: true }, { id: I.DIRGE_CRYSTAL, min: 0, max: 1, playerOnly: true }],
};

for (const [k, d] of Object.entries({ capwalker: CAPWALKER, dirge_wailer: DIRGE_WAILER })) { if (!MOBS[k]) { MOBS[k] = d; MOB_KEYS.push(k); } }
// Cinder Brute spawners stand in Cinderforges (world/dimensions/cinderForge.js, spawner meta CINDER_BRUTE_SPAWNER_META)
if (!SPAWNER_TYPES.includes('cinder_brute')) SPAWNER_TYPES.push('cinder_brute');

// detail boxes follow their host parts (head pitch, claws...)
followDecor(CAPWALKER, 'capwalker');
followDecor(DIRGE_WAILER, 'dirge_wailer');
