// Cinderdeep fauna: two more creatures for the fiery underworld (registered into MOBS and the Cinderdeep spawn tables).
//
//  Smokeray  a huge, slow ray of smoke and cinders (about 4 x 1 x 4 blocks, 10 health) that drifts through the open caverns. Rare, and only
//      where there is a 5 x 5 x 5 pocket of air; at most two near a player. Sighting a player within 48 blocks it stops and hovers, swells
//      for a second (its body pulses and its mouth glows: the tell) and spits a slow Slag Glob, which bursts on impact as an explosion of
//      power 1 (game.explode, so the mobGriefing rule applies). The glob is the ordinary Fireball entity, which has no deflection, so none
//      is built. Drops 0-1 Blast Powder and 0-1 Smoke Gland (a Slow Falling ingredient, like a Feather: it goes on a Murky Elixir).
//  Slagboar  a stocky tusked beast with a cracked, glowing hide (1.4 x 1.4 blocks, 30 health, fire-immune) in herds of 2-4 on Cinderdeep
//      ground. A player within 10 blocks is charged: a 0.6 s wind-up (it paws the ground), a fast straight dash (a hit deals 6 and throws
//      the player up), then 3 s of rest. It fears Glowshard: it will not charge a player standing within 6 blocks of one, and flees from
//      one near itself. Drops 2-4 Raw Slagboar Chops (Seared when it dies burning) and 0-1 Leather. Bred with Cinderroot; the young of
//      a bred pair are calm toward players for their whole life (`calm`, saved with the mob).
//
// Visuals: the Smokeray's swell fraction travels in the head pitch (and `angry`), which the multiplayer snapshot carries, so guests see the
// tell; the Slagboar lowers its head to wind up and dash (also the head pitch).
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { I } from '../world/items.js';
import { B, SOLID, isFluid } from '../world/blocks.js';
import { Fireball } from '../entities/fireball.js';
import { DIM_SPAWN_TABLES, flyTowards, faceTowards } from './dimensionMobs.js';
import { growStep, breedStep } from './youngAnimals.js';

// ---------------------------------------------------------------------------------------------
// Numbers

export const SMOKE = { RANGE: 48, SWELL: 20, COOLDOWN: 100, GLOB_SPEED: 0.3, GLOB_SIZE: 0.45, OPEN: 5, MAX_NEAR: 2, NEAR_RADIUS: 96, DRIFT: 0.006 };
export const BOAR = { SIGHT: 10, WINDUP: 12, DASH_MAX: 24, DASH_SPEED: 0.5, REST: 60, DAMAGE: 6, LAUNCH: 0.9, FEAR: 6, REACH: 1.5 };
/** Where they are placed: the Cinderdeep's tables (the open Cinderdeep and the Slagfall Delta). */
export const HABITATS = { smokeray: ['cinderdeep', 'cinderDelta'], slagboar: ['cinderdeep', 'cinderDelta'] };

// ---------------------------------------------------------------------------------------------
// Pure rules (unit tested)

/** Is the n x n x n box centred on (x, y, z) all air (nothing solid, nothing fluid)? `getBlock(x, y, z)` reads the world. */
export function hasOpenAir(getBlock, x, y, z, n = SMOKE.OPEN) {
  const lo = -Math.floor(n / 2), hi = lo + n - 1;
  for (let dx = lo; dx <= hi; dx++) for (let dy = lo; dy <= hi; dy++) for (let dz = lo; dz <= hi; dz++) {
    const id = getBlock(x + dx, y + dy, z + dz);
    if (SOLID[id] || isFluid(id)) return false;
  }
  return true;
}

/** May a Smokeray appear here: in the Cinderdeep, in a 5 x 5 x 5 pocket of air, with fewer than two already near the player. */
export function canSpawnSmokeray({ dim, getBlock, x, y, z, near = 0 }) {
  return dim === 'cinderdeep' && near < SMOKE.MAX_NEAR && hasOpenAir(getBlock, x, y, z);
}

/** The nearest Glowshard block within `r` of (x, y, z) as { x, y, z, dist }, or null. */
export function shardNear(getBlock, x, y, z, r = BOAR.FEAR) {
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z), ri = Math.ceil(r);
  let best = null, bd = r * r;
  for (let dx = -ri; dx <= ri; dx++) for (let dy = -ri; dy <= ri; dy++) for (let dz = -ri; dz <= ri; dz++) {
    const d2 = (cx + dx + 0.5 - x) ** 2 + (cy + dy + 0.5 - y) ** 2 + (cz + dz + 0.5 - z) ** 2;
    if (d2 > bd || (best && d2 >= bd)) continue;
    if (getBlock(cx + dx, cy + dy, cz + dz) === B.GLOWSHARD) { bd = d2; best = { x: cx + dx + 0.5, y: cy + dy + 0.5, z: cz + dz + 0.5, dist: Math.sqrt(d2) }; }
  }
  return best;
}

/** The Slagboar's fear rule: a Glowshard within 6 blocks of the point. Both where it would walk and where its target stands count. */
export const boarFears = (getBlock, x, y, z) => !!shardNear(getBlock, x, y, z, BOAR.FEAR);

/** The point a frightened Slagboar runs for: straight away from the shard, `far` blocks off. */
export function fleePoint(x, z, shard, far = 8) {
  const dx = x - shard.x, dz = z - shard.z, l = Math.hypot(dx, dz) || 1;
  return { x: x + dx / l * far, z: z + dz / l * far };
}

/**
 * One tick of a Smokeray's spit. `m.swell` counts the ticks swelled (0: not swelling), `m.cool` the ticks before it may swell again.
 * Returns 'start' (it begins to swell), 'swelling', 'spit' (the glob leaves now), 'abort' (it lost sight of the player) or null.
 */
export function smokeStep(m, sees, pdist) {
  if (m.cool > 0) m.cool--;
  if (m.swell > 0) {
    if (!sees) { m.swell = 0; m.cool = 20; return 'abort'; }
    if (++m.swell > SMOKE.SWELL) { m.swell = 0; m.cool = SMOKE.COOLDOWN; return 'spit'; }
    return 'swelling';
  }
  if (!(m.cool > 0) && sees && pdist <= SMOKE.RANGE) { m.swell = 1; return 'start'; }
  return null;
}

/** The swell as 0 to 1 (the pulse of the body and the glow of the mouth). */
export const swellFraction = (m) => Math.min(1, Math.max(0, (m.swell || 0) / SMOKE.SWELL));

/** A fresh charge record: `state` is 'idle' | 'windup' | 'dash' | 'rest', `t` its ticks left, (`dx`, `dz`) the locked dash direction. */
export const newCharge = () => ({ state: 'idle', t: 0, dx: 0, dz: 0 });

/**
 * One tick of the Slagboar's charge. `o` = { sees (the player is in sight, in range and not guarded by a Glowshard), x, z, px, pz,
 * blocked (it ran into something), hit (it reached the player), afraid (a Glowshard is near it) }.
 * Returns 'windup' (it starts pawing), 'dash' (it runs: the direction is locked now), 'hit', 'crash', 'stop' (the dash ran out or
 * fear cut it short), 'rested' or null.
 */
export function chargeStep(c, o) {
  switch (c.state) {
    case 'idle':
      if (o.sees && !o.afraid) { c.state = 'windup'; c.t = BOAR.WINDUP; return 'windup'; }
      return null;
    case 'windup':
      if (o.afraid || !o.sees) { c.state = 'idle'; c.t = 0; return 'stop'; } // (fear or lost sight before the dash)
      if (--c.t <= 0) {
        const dx = o.px - o.x, dz = o.pz - o.z, l = Math.hypot(dx, dz) || 1;
        c.dx = dx / l; c.dz = dz / l; c.state = 'dash'; c.t = BOAR.DASH_MAX;
        return 'dash';
      }
      return null;
    case 'dash': {
      const ev = o.hit ? 'hit' : o.blocked ? 'crash' : o.afraid || --c.t <= 0 ? 'stop' : null;
      if (ev) { c.state = 'rest'; c.t = BOAR.REST; }
      return ev;
    }
    case 'rest':
      if (--c.t <= 0) { c.state = 'idle'; c.t = 0; return 'rested'; }
      return null;
    default: c.state = 'idle'; return null;
  }
}

/** The saved form of a Slagboar: the calm of one born to a bred pair. */
export const boarSave = (m) => (m.calm ? { calm: true } : {});
export const boarLoad = (m, s) => { if (s.calm) m.calm = true; };

// ---------------------------------------------------------------------------------------------
// Smokeray

function spitGlob(g, m, p) {
  const lx = -Math.sin(m.yaw), lz = -Math.cos(m.yaw);
  const x = m.x + lx * 2.2, y = m.y + 0.4, z = m.z + lz * 2.2;
  const dx = p.x - x, dy = p.y + p.body.height * 0.5 - y, dz = p.z - z, l = Math.hypot(dx, dy, dz) || 1;
  const v = SMOKE.GLOB_SPEED;
  g.entities.add(new Fireball(x, y, z, dx / l * v, dy / l * v, dz / l * v, m, { power: 1, size: SMOKE.GLOB_SIZE }));
  g.audio.play('glob_spit', [x, y, z], 0.9);
}

function smokerayAI(m, g, p, pdist) {
  const b = m.body;
  if (m.swell === undefined) m.swell = 0;
  if (m.cool === undefined) m.cool = 40;
  const live = !p.dead && !p.creative;
  if (live && pdist < SMOKE.RANGE) { if (g.ticks % 2 === m.id % 2 || m._sees === undefined) m._sees = m.canSee(g, p.x, p.y + p.eyeHeight, p.z); } else m._sees = false;
  const sees = live && !!m._sees;
  const act = smokeStep(m, sees, pdist);
  if (act === 'start') g.audio.play('billow', [m.x, m.y + 0.5, m.z], 0.9);
  if (act === 'spit') spitGlob(g, m, p);
  if (sees || m.swell > 0) {
    // hovers where it is, facing the player
    b.vx *= 0.85; b.vy *= 0.85; b.vz *= 0.85;
    faceTowards(m, p.x, p.z, 0.4);
  } else {
    if (!m.fly || m.flyTimer-- <= 0 || b.horizontalCollision || Math.hypot(m.fly.x - m.x, m.fly.y - m.y, m.fly.z - m.z) < 2) {
      m.flyTimer = 100 + Math.floor(Math.random() * 160);
      m.fly = { x: m.x + (Math.random() - 0.5) * 40, y: Math.max(36, Math.min(110, m.y + (Math.random() - 0.5) * 10)), z: m.z + (Math.random() - 0.5) * 40 };
    }
    flyTowards(m, m.fly.x, m.fly.y, m.fly.z, SMOKE.DRIFT);
    if (Math.hypot(b.vx, b.vz) > 0.01) m.yaw = Math.atan2(-b.vx, -b.vz);
  }
  m.angry = m.swell > 0;
  m.headPitch = swellFraction(m); // (the tell, as the snapshot carries it)
  if (g.ticks % 6 === 0) g.particles.smoke(m.x + (Math.random() - 0.5) * 3, m.y + 0.2, m.z + (Math.random() - 0.5) * 3, 1, 0.8);
  if (Math.random() < 1 / 400) g.audio.play('billow', [m.x, m.y + 0.5, m.z], 0.3);
}

function smokerayRender(m, model) {
  const pa = model.userData.parts;
  if (!pa) return;
  const f = swellFraction(m), t = (m.id % 7) + (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
  const s = 1 + f * 0.3 + Math.sin(f * Math.PI * 6) * f * 0.04;
  pa.body.scale.set(s, 1 + f * 0.5, s);
  pa.mouth.scale.set(1 + f * 1.4, 1 + f * 2.2, 1 + f * 1.4);
  pa.glow.scale.setScalar(0.6 + f * 1.4);
  pa.wingL.rotation.z = Math.sin(t * 1.4) * 0.12 + 0.05;
  pa.wingR.rotation.z = -Math.sin(t * 1.4) * 0.12 - 0.05;
  pa.tail.rotation.y = Math.sin(t * 1.1) * 0.25;
}

// Smokeray: a broad flat ray of dark smoke, a pale belly, glowing embers, a mouth that lights up when it swells.
MODELS.smokeray = {
  parts: [
    ['body', [30, 9, 30], [0, 8, 0], [0, 0, 0], '#4a4652'],
    ['belly', [26, 3, 26], [0, 4, 0], [0, 0, 0], '#8a8494'],
    ['wingL', [17, 3, 28], [15, 8, 0], [8.5, 0, 1], '#5a5662'],
    ['wingR', [17, 3, 28], [-15, 8, 0], [-8.5, 0, 1], '#5a5662'],
    ['wingTipL', [8, 2, 20], [32, 8, 0], [4, 0, 3], '#6a6672'],
    ['wingTipR', [8, 2, 20], [-32, 8, 0], [-4, 0, 3], '#6a6672'],
    ['face', [14, 7, 8], [0, 8, -17], [0, 0, -1], '#fffffb', { face: 'smokeray' }],
    ['mouth', [6, 2, 3], [0, 5.4, -22], [0, 0, 0], '#ff8a1a', { emissive: '#d85a10' }],
    ['glow', [10, 4, 4], [0, 5.4, -22.5], [0, 0, 0], '#ffd070', { emissive: '#e89030' }],
    ['tail', [4, 3, 26], [0, 8, 15], [0, 0, 13], '#3a3642'],
    ['ember1', [3, 1, 3], [-6, 13, 2], [0, 0, 0], '#ff9a30', { emissive: '#c85a10' }],
    ['ember2', [2, 1, 2], [7, 13, -5], [0, 0, 0], '#ffb050', { emissive: '#c86a18' }],
    ['ember3', [2, 1, 3], [3, 13, 8], [0, 0, 0], '#ff8420', { emissive: '#b84a0c' }],
  ],
};
// two small, sleepy eyes under a heavy brow
FACES.smokeray = (c) => {
  c.fillStyle = '#1a1620'; c.fillRect(1, 4, 14, 2);
  c.fillStyle = '#ffb040'; c.fillRect(3, 7, 3, 2); c.fillRect(10, 7, 3, 2);
  c.fillStyle = '#fff0c0'; c.fillRect(4, 7, 1, 1); c.fillRect(11, 7, 1, 1);
};

// ---------------------------------------------------------------------------------------------
// Slagboar

function boarDust(g, m, n = 2) {
  for (let k = 0; k < n; k++) g.particles.emit(m.x - Math.sin(m.yaw) * 0.9 + (Math.random() - 0.5) * 0.8, m.y + 0.1, m.z - Math.cos(m.yaw) * 0.9 + (Math.random() - 0.5) * 0.8,
    (Math.random() - 0.5) * 0.06, 0.07 + Math.random() * 0.06, (Math.random() - 0.5) * 0.06, 1, 0.45, 0.1, 18, -0.01);
}

function slagboarAI(m, g, p, pdist) {
  const b = m.body, w = g.world;
  growStep(m); // babies grow up, parents wait out their cooldown
  const getBlock = (x, y, z) => w.getBlock(x, y, z);
  if (m.fearTick === undefined || g.ticks % 10 === m.id % 10) { m.fearTick = 1; m.shard = shardNear(getBlock, m.x, m.y, m.z, BOAR.FEAR); }
  const calm = !!m.calm || m.age < 0;
  if (breedStep(m, g)) { m.headPitch = 0; m.angry = false; return; } // (a fed adult in the mood thinks of nothing else)
  const c = m.charge || (m.charge = newCharge());
  // afraid of Glowshard: it runs from it and will not charge
  if (m.shard) {
    if (c.state === 'windup' || c.state === 'dash') { c.state = 'rest'; c.t = 20; }
    m.angry = false; m.headPitch = 0; m.target = null;
    const f = fleePoint(m.x, m.z, m.shard);
    m.steer(f.x, f.z, 1.4);
    return;
  }
  const live = !p.dead && !p.creative && !calm;
  if (!live) { c.state = 'idle'; m.angry = false; m.headPitch = 0; m.target = null; return m.wanderAI(g, 0.7); }
  // sight and the player's own Glowshard guard, both refreshed a few times a second
  if (g.ticks % 5 === m.id % 5 || m._sees === undefined) {
    m._sees = pdist < BOAR.SIGHT && m.canSee(g, p.x, p.y + p.eyeHeight * 0.5, p.z);
    m._guarded = m._sees && boarFears(getBlock, p.x, p.y, p.z);
  }
  const seesNow = !!m._sees && !m._guarded;
  const reach = m.width / 2 + BOAR.REACH;
  const dashing = c.state === 'dash';
  const hit = dashing && Math.hypot(p.x - m.x, p.z - m.z) < reach && Math.abs(p.y - m.y) < m.height + 0.6;
  const ev = chargeStep(c, { sees: seesNow, x: m.x, z: m.z, px: p.x, pz: p.z, blocked: dashing && b.horizontalCollision && Math.hypot(b.vx, b.vz) < BOAR.DASH_SPEED * 0.4, hit, afraid: false });
  if (ev === 'windup') { g.audio.play('boar_snort', [m.x, m.y + 0.7, m.z], 0.9); m.target = 'player'; }
  if (ev === 'dash') g.audio.play('boar_charge', [m.x, m.y + 0.7, m.z], 1);
  if (ev === 'hit') {
    p.hurt(BOAR.DAMAGE, 'mob:' + m.def.name, m);
    p.body.vy = Math.max(p.body.vy, BOAR.LAUNCH);
    p.body.vx += c.dx * 0.7; p.body.vz += c.dz * 0.7;
    g.audio.play('boar_snort', [m.x, m.y + 0.7, m.z], 0.8);
  }
  if (ev === 'crash') g.audio.play('boar_snort', [m.x, m.y + 0.7, m.z], 0.5);
  m.move = null; m.path = null; m.wander = null;
  m.angry = c.state === 'windup' || c.state === 'dash';
  if (c.state === 'windup') {
    m.headPitch = 0.45; faceTowards(m, p.x, p.z, 0.5);
    if (g.ticks % 3 === 0) boarDust(g, m);
  } else if (c.state === 'dash') {
    m.headPitch = 0.85; m.yaw = Math.atan2(-c.dx, -c.dz);
    b.vx = c.dx * BOAR.DASH_SPEED; b.vz = c.dz * BOAR.DASH_SPEED;
    if (g.ticks % 2 === 0) boarDust(g, m, 1);
  } else {
    m.headPitch = c.state === 'rest' ? 0.2 : 0;
    if (c.state === 'idle' && !m._sees) { m.target = null; m.wanderAI(g, 0.7); }
    else if (c.state === 'idle' && m._guarded) m.wanderAI(g, 0.5);
  }
  if (Math.random() < 1 / 500) g.audio.play('boar_snort', [m.x, m.y + 0.7, m.z], 0.3);
}

/** A Slagboar born to a bred pair is calm for its whole life. */
function slagboarBred(baby) { baby.calm = true; }

MODELS.slagboar = {
  parts: [
    ['body', [22, 15, 26], [0, 15, 1], [0, 0, 0], '#4a2a22'],
    ['hump', [16, 4, 14], [0, 24, -2], [0, 0, 0], '#5a3228'],
    ['crack1', [3, 1, 20], [-4, 22.6, 2], [0, 0, 0], '#ff8a20', { emissive: '#d85a10' }],
    ['crack2', [3, 1, 12], [5, 22.6, 4], [0, 0, 0], '#ffb040', { emissive: '#d86a18' }],
    ['crackSide', [1, 8, 3], [11.2, 15, 4], [0, 0, 0], '#ff7a1a', { emissive: '#c85010' }],
    ['head', [13, 11, 12], [0, 15, -13], [0, 0, -4], '#fffffb', { face: 'slagboar' }],
    ['snout', [8, 6, 5], [0, 15, -13], [0, -2.4, -10.5], '#3a1e18'],
    ['tuskL', [2, 2, 7], [0, 15, -13], [4.6, -3.4, -9], '#efe2c0'],
    ['tuskR', [2, 2, 7], [0, 15, -13], [-4.6, -3.4, -9], '#efe2c0'],
    ['earL', [3, 4, 2], [0, 15, -13], [5.4, 6.4, -1], '#3a1e18'],
    ['earR', [3, 4, 2], [0, 15, -13], [-5.4, 6.4, -1], '#3a1e18'],
    ['legFL', [6, 9, 6], [7, 9, -8], [0, -4.5, 0], '#341a14', { anim: 'legA' }],
    ['legFR', [6, 9, 6], [-7, 9, -8], [0, -4.5, 0], '#341a14', { anim: 'legB' }],
    ['legBL', [6, 9, 6], [7, 9, 9], [0, -4.5, 0], '#341a14', { anim: 'legB' }],
    ['legBR', [6, 9, 6], [-7, 9, 9], [0, -4.5, 0], '#341a14', { anim: 'legA' }],
  ],
};
// small, glaring eyes burning under a heavy brow, and a dark broad snout
FACES.slagboar = (c) => {
  c.fillStyle = '#1a0c08'; c.fillRect(2, 4, 4, 2); c.fillRect(10, 4, 4, 2);
  c.fillStyle = '#ff9a20'; c.fillRect(3, 6, 2, 2); c.fillRect(11, 6, 2, 2);
  c.fillStyle = '#ffe080'; c.fillRect(3, 6, 1, 1); c.fillRect(11, 6, 1, 1);
  c.fillStyle = '#ff7a1a'; c.fillRect(7, 1, 2, 2); c.fillRect(1, 10, 1, 3); c.fillRect(14, 10, 1, 3);
  c.fillStyle = '#2a120c'; c.fillRect(5, 11, 6, 3);
};

// ---------------------------------------------------------------------------------------------
// definitions and spawning

export const SMOKERAY = {
  name: 'Smokeray', role: 'drifting ray', category: CATEGORY.MONSTER,
  health: 10, speed: 0.1, width: 4, height: 1, followRange: SMOKE.RANGE, sound: 'billow',
  flying: true, fireImmune: true, noFallDamage: true, customAI: smokerayAI, customRender: smokerayRender,
  spawnCheck: (spawner, x, y, z) => {
    const g = spawner.game, p = g.player;
    let near = 0;
    for (const e of g.entities.list) if (e.type === 'smokeray' && !e.dead && Math.hypot(e.x - p.x, e.z - p.z) < SMOKE.NEAR_RADIUS) near++;
    return canSpawnSmokeray({ dim: g.world.dimension, getBlock: (a, b, c) => g.world.getBlock(a, b, c), x, y, z, near });
  },
  drops: [{ id: I.GUNPOWDER, min: 0, max: 1 }, { id: I.SMOKE_GLAND, min: 0, max: 1 }],
};
export const SLAGBOAR = {
  name: 'Slagboar', role: 'tusked beast', category: CATEGORY.MONSTER,
  health: 30, speed: 0.2, width: 1.4, height: 1.4, followRange: BOAR.SIGHT, sound: 'boar_snort',
  fireImmune: true, ownAI: slagboarAI, onBreed: slagboarBred, saveExtra: boarSave, loadExtra: boarLoad,
  food: [I.CINDERROOT],
  spawnCheck: (spawner, x, y, z) => spawner.game.world.dimension === 'cinderdeep' && !boarFears((a, b, c) => spawner.game.world.getBlock(a, b, c), x + 0.5, y, z + 0.5),
  drops: [{ id: I.RAW_SLAGBOAR_CHOP, min: 2, max: 4, cooked: I.SEARED_SLAGBOAR_CHOP }, { id: I.LEATHER, min: 0, max: 1 }],
};
for (const [k, d] of [['smokeray', SMOKERAY], ['slagboar', SLAGBOAR]]) {
  if (!MOBS[k]) { MOBS[k] = d; MOB_KEYS.push(k); }
}
// the Cinderdeep's spawn tables (dimensionMobs.js): Smokerays rarely, herds of Slagboars on the ground
const addSpawns = (table, entry) => { const list = DIM_SPAWN_TABLES[table]; if (list && !list.some((e) => e.type === entry.type)) list.push(entry); };
addSpawns('cinderdeep', { type: 'smokeray', weight: 3, min: 1, max: 1 });
addSpawns('cinderDelta', { type: 'smokeray', weight: 4, min: 1, max: 1 });
addSpawns('cinderdeep', { type: 'slagboar', weight: 28, min: 2, max: 4 });
addSpawns('cinderDelta', { type: 'slagboar', weight: 20, min: 2, max: 4 });
// Howlers eat the meat too (as they do venison)
if (MOBS.howler && MOBS.howler.food && !MOBS.howler.food.includes(I.RAW_SLAGBOAR_CHOP)) MOBS.howler.food.push(I.RAW_SLAGBOAR_CHOP, I.SEARED_SLAGBOAR_CHOP);
