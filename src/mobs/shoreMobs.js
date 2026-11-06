// Shore round: two new mobs for the lands round the new structures (module registers itself into MOBS, like fauna.js).
//
//  Brinecrab (reference: crab)  a sideways-walking scavenger of beaches, mangrove mud and swamp banks. It scuttles about with its body turned across
//      its heading, holds its claws up (the snapshot's `special` flag) and backs away from anyone who comes within five blocks, and when it is
//      hurt it keeps a grudge: for fifteen seconds it chases whoever struck it and pinches. Three shell colours (`woolColor`). Drops Raw Crab,
//      which a campfire or furnace roasts. Spawns on sand, mud and gravel (spawnOn), not only on grass.
//  Wickling (reference: a will-o'-the-wisp / candle ghoul)  a stooped monster with a burning candle for a head that comes out at night in swamps, dark
//      forests and mangrove mud and guards the Mire Shrine, the Observatory and the Hermit's cellar. It chases players, and its touch sets
//      them alight; rain and water snuff it (it takes damage in either). Its flame flares (`angry`) when it has found someone. Drops Tallow
//      (a slow fuel, and half a candle) and string.
//
// Both use only flags the mob snapshot already carries (special, angry, woolColor), so the 25-field layout is unchanged and a guest
// builds them from the type alone (net/entityMirror.js). Everything here is simulated on the host.
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { I } from '../world/items.js';
import { B } from '../world/blocks.js';

export const CRAB = { WARY: 5, FLEE: 2.6, GRUDGE: 300 };
export const WICK = { IGNITE: 80, RAIN_HURT: 40, WATER_HURT: 10 };
/** Shell colours of a Brinecrab: [shell, shell light]. */
export const CRAB_SHELLS = [['#d8602e', '#ec8650'], ['#c8a878', '#e2cc9c'], ['#3a7e92', '#62aabc']];
/** Ground a Brinecrab settles on (spawner.js validSpawn / chunk placement). */
export const CRAB_GROUND = new Set([B.SAND, B.RED_SAND, B.MUD, B.GRAVEL, B.MUDDY_MANGROVE_ROOTS, B.CLAY]);

const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const tint = (parts, names, col) => {
  for (const k of names) {
    const grp = parts[k];
    if (!grp) continue;
    const mm = grp.children[0].material;
    for (const x of Array.isArray(mm) ? [mm[0], mm[5]] : [mm]) if (x && x.userData.base) x.userData.base.set(col);
  }
};

// ---------------------------------------------------------------------------------------------
// Pure rules (unit tested)

/** What a Brinecrab does about a player at this distance: 'grudge' (pinching), 'back' (scuttles off), 'wary' (claws up, holds still) or 'idle'. */
export function crabStance({ grudge = 0, pdist = 99, sneaking = false }) {
  if (grudge > 0) return 'grudge';
  if (pdist < CRAB.FLEE && !sneaking) return 'back';
  if (pdist < CRAB.WARY && !sneaking) return 'wary';
  return 'idle';
}

/** Does something snuff a Wickling this tick: 'water' (in it), 'rain' (rained on under open sky) or null. */
export function wicklingSnuffed({ inWater = false, raining = false, openSky = false }) {
  if (inWater) return 'water';
  return raining && openSky ? 'rain' : null;
}

/** May a Brinecrab spawn on this ground? */
export const crabGround = (id) => CRAB_GROUND.has(id);

// ---------------------------------------------------------------------------------------------
// Brinecrab

function crabAI(m, g, p, pdist) {
  m.special = false;
  if (m.grudge > 0) {
    m.grudge--;
    m.angry = m.grudge > 0;
    if (!p.dead && !p.creative && m.grudge > 0) { m.target = 'player'; m.chase(g, p, 1.25); m.tryMelee(g, p); return; }
  }
  m.angry = false; m.target = null;
  if (m.panicTicks > 0 || m.loveTicks > 0 || m.tempted(g) || m.leashHolder) return m.passiveAI(g);
  const stance = p.dead ? 'idle' : crabStance({ pdist, sneaking: p.sneaking });
  if (stance === 'back') {
    m.special = true;
    m.steer(m.x + (m.x - p.x) * 3, m.z + (m.z - p.z) * 3, 1.3);
    return;
  }
  if (stance === 'wary') {
    m.special = true; m.move = null; m.path = null; m.wander = null;
    m.yaw += wrap(Math.atan2(-(p.x - m.x), -(p.z - m.z)) - Math.PI / 2 - m.yaw) * 0.1; // turns side-on to you, claws towards you (the model is drawn a quarter turn off its heading)
    if (Math.random() < 1 / 260) g.audio.play('clack', [m.x, m.y + 0.2, m.z], 0.5);
    return;
  }
  m.passiveAI(g);
  if (Math.random() < 1 / 700) g.audio.play('clack', [m.x, m.y + 0.2, m.z], 0.35);
}

/** A struck Brinecrab pinches back. */
function crabHurt(m, dmg, source, attacker) {
  if (attacker && attacker !== m && source !== 'fire' && source !== 'lava' && source !== 'drown') m.grudge = CRAB.GRUDGE;
  return dmg;
}

function crabRender(m, model, alpha, sec) {
  const pa = model.userData.parts;
  if (!pa || !pa.clawL) return;
  const shell = CRAB_SHELLS[(m.woolColor | 0) % CRAB_SHELLS.length];
  if (model.userData.coat !== m.woolColor) {
    model.userData.coat = m.woolColor;
    tint(pa, ['body', 'clawL', 'clawR', 'legL1', 'legL2', 'legL3', 'legR1', 'legR2', 'legR3'], shell[0]);
    tint(pa, ['shell', 'pinchL', 'pinchR'], shell[1]);
  }
  model.rotation.y += Math.PI / 2; // walks sideways: its heading is across its body
  const up = m.special || m.angry;
  const snap = m.angry ? Math.sin(sec * 14 + m.id) * 0.35 : 0;
  pa.clawL.rotation.x = up ? -1.0 + snap : Math.sin(sec * 1.2 + m.id) * 0.06;
  pa.clawR.rotation.x = up ? -1.0 - snap : Math.sin(sec * 1.1 + m.id) * 0.06;
  pa.pinchL.rotation.x = pa.clawL.rotation.x; pa.pinchR.rotation.x = pa.clawR.rotation.x;
}

MODELS.brinecrab = {
  parts: [
    ['body', [10, 3.6, 8], [0, 3.6, 0], [0, 0, 0], '#d8602e'],
    ['shell', [8.4, 1.4, 6.4], [0, 5.9, 0.2], [0, 0, 0], '#ec8650'],
    ['face', [6, 2.6, 1], [0, 5.2, -4.4], [0, 0, 0], '#fffffa', { face: 'brinecrab' }],
    ['clawL', [2.4, 2, 4], [4.6, 4.6, -3.6], [0.6, 0, -1.6], '#d8602e'],
    ['clawR', [2.4, 2, 4], [-4.6, 4.6, -3.6], [-0.6, 0, -1.6], '#d8602e'],
    ['pinchL', [3, 1.6, 2.4], [4.6, 4.6, -3.6], [0.9, 0, -4.4], '#ec8650'],
    ['pinchR', [3, 1.6, 2.4], [-4.6, 4.6, -3.6], [-0.9, 0, -4.4], '#ec8650'],
    ...[[1, -2.2, 'legA'], [2, 0.4, 'legB'], [3, 2.8, 'legA']].flatMap(([n, z, a]) => [
      [`legL${n}`, [3.4, 1, 1], [6, 2.6, z], [1.2, -1, 0], '#d8602e', { anim: a }],
      [`legR${n}`, [3.4, 1, 1], [-6, 2.6, z], [-1.2, -1, 0], '#d8602e', { anim: a === 'legA' ? 'legB' : 'legA' }],
    ]),
  ],
};
// two black stalk eyes with a glint, a small mouth
FACES.brinecrab = (c) => {
  c.fillStyle = '#17110a'; c.fillRect(2, 2, 4, 5); c.fillRect(10, 2, 4, 5);
  c.fillStyle = '#fff4d8'; c.fillRect(3, 3, 1, 1); c.fillRect(11, 3, 1, 1);
  c.fillStyle = '#7a2a16'; c.fillRect(6, 10, 4, 2);
};

// ---------------------------------------------------------------------------------------------
// Wickling

function wicklingAI(m, g, p, pdist) {
  const b = m.body, w = g.world;
  // snuffed by water and by rain under open sky
  const bx = Math.floor(m.x), by = Math.floor(m.y + m.height + 0.2), bz = Math.floor(m.z);
  const snuff = wicklingSnuffed({ inWater: b.inWater, raining: !!(w.rainingAt && w.rainingAt(bx, by, bz)), openSky: w.heightAt(bx, bz) <= by });
  if (snuff && g.ticks % (snuff === 'water' ? WICK.WATER_HURT : WICK.RAIN_HURT) === m.id % (snuff === 'water' ? WICK.WATER_HURT : WICK.RAIN_HURT)) {
    m.hurt(snuff === 'water' ? 2 : 1, snuff);
    g.particles.smoke(m.x, m.y + m.height, m.z, 5, 0.3);
    g.audio.play('fizz', [m.x, m.y + m.height, m.z], 0.35);
  }
  const has = !snuff && m.acquire(g, p, pdist, m.def.followRange);
  m.angry = has;
  if (has) {
    m.chase(g, p, 1.05);
    const ready = m.attackCooldown <= 0;
    m.tryMelee(g, p);
    if (ready && m.attackCooldown > 0 && !p.dead && !p.creative && typeof p.fireTicks === 'number') p.fireTicks = Math.max(p.fireTicks, WICK.IGNITE); // its touch sets you alight
    m.headPitch = 0;
  } else m.wanderAI(g, 0.8);
  if (Math.random() < (has ? 0.5 : 0.22)) g.particles.flame(m.x + (Math.random() - 0.5) * 0.3, m.y + m.height + 0.05, m.z + (Math.random() - 0.5) * 0.3);
  if (Math.random() < 1 / 320) g.audio.play('sputter', [m.x, m.y + 1, m.z], 0.45);
}

function wicklingRender(m, model, alpha, sec) {
  const pa = model.userData.parts;
  if (!pa || !pa.flame) return;
  const flare = m.angry ? 1.35 : 1;
  const f = 1 + Math.sin(sec * 17 + m.id) * 0.14 + Math.sin(sec * 29 + m.id * 3) * 0.08;
  pa.flame.scale.set(flare, f * flare, flare);
  pa.flameCore.scale.set(flare, f * flare * 1.1, flare);
  pa.head.rotation.z = Math.sin(sec * 1.7 + m.id) * 0.05; // the stoop sways
}

MODELS.wickling = {
  parts: [
    ['legL', [3, 7, 3], [2, 7, 0], [0, -3.5, 0], '#5e4e3a', { anim: 'legA' }],
    ['legR', [3, 7, 3], [-2, 7, 0], [0, -3.5, 0], '#5e4e3a', { anim: 'legB' }],
    ['body', [7, 8, 4], [0, 11, 0], [0, 0, 0], '#7a6850'],
    ['drip', [7.4, 3, 4.4], [0, 8.2, 0], [0, 0, 0], '#c9bd96'], // wax dripped down the robe
    ['armL', [2.5, 8, 2.5], [5, 15, 0], [0, -4, 0], '#6a5a44', { anim: 'armSwing' }],
    ['armR', [2.5, 8, 2.5], [-5, 15, 0], [0, -4, 0], '#6a5a44', { anim: 'armSwingB' }],
    ['head', [6, 6, 6], [0, 15, 0], [0, 3, 0], '#e8dcb0', { face: 'wickling' }],
    ['wick', [1, 2, 1], [0, 20.6, 0], [0, 1, 0], '#2a2420'], // stands on the crown of the head (the head spans 15 to 21)
    ['flame', [3.4, 4.6, 3.4], [0, 21.4, 0], [0, 2.3, 0], '#ffb030', { emissive: '#ff8a20' }],
    ['flameCore', [1.6, 3, 1.6], [0, 21.8, 0], [0, 1.5, 0], '#fff0a0', { emissive: '#fff0a0' }],
  ],
};
// two hollow, glowing eyes and a gaping mouth sagging in the wax
FACES.wickling = (c) => {
  c.fillStyle = '#2a2014'; c.fillRect(3, 5, 3, 4); c.fillRect(10, 5, 3, 4);
  c.fillStyle = '#ffd24a'; c.fillRect(4, 6, 1, 2); c.fillRect(11, 6, 1, 2);
  c.fillStyle = '#2a2014'; c.fillRect(6, 11, 4, 3);
};

// ---------------------------------------------------------------------------------------------
// definitions

export const BRINECRAB = {
  name: 'Brinecrab', role: 'crab', category: CATEGORY.CREATURE, sound: 'clack', spawnOn: CRAB_GROUND,
  health: 8, speed: 0.14, width: 0.7, height: 0.5, attack: 2, panicSpeed: 1.5, noFallDamage: true,
  drops: [{ id: I.RAW_CRAB, min: 1, max: 2, cooked: I.COOKED_CRAB }, { id: I.CLAY_BALL, min: 0, max: 1, chance: 0.25 }],
  food: [I.RAW_SILVERFIN],
  ownAI: crabAI, onHurt: crabHurt, customRender: crabRender,
  onSpawn: (m) => { m.persistent = false; m.grudge = 0; m.woolColor = Math.floor(Math.random() * CRAB_SHELLS.length); },
};
export const WICKLING = {
  name: 'Wickling', role: 'candle ghoul', category: CATEGORY.MONSTER, sound: 'sputter',
  health: 14, speed: 0.24, width: 0.6, height: 1.6, attack: 2, followRange: 24, armor: 0,
  drops: [{ id: I.TALLOW, min: 0, max: 2 }, { id: I.STRING, min: 0, max: 1 }, { id: I.COAL, min: 0, max: 1, playerOnly: true }],
  customAI: wicklingAI, customRender: wicklingRender,
};
for (const [k, d] of [['brinecrab', BRINECRAB], ['wickling', WICKLING]]) {
  if (!MOBS[k]) { MOBS[k] = d; MOB_KEYS.push(k); }
}
