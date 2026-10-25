// Hushkeeper (reference: warden): the blind guardian of the Deep Hush. Called
// up out of the ground when a player's warning level reaches 4 (see
// world/hushSystem.js), it cannot see: it hears vibrations (footsteps,
// landings, blocks placed and broken: the recent noises the Deep Hush keeps)
// and now and then sniffs the air for the nearest player. Each noise a player
// makes nearby angers it; past ANGRY it knows where that player is and hunts
// them, hitting very hard in melee, and when it cannot reach them it charges
// a sonic boom that passes through walls and armour. With nothing to disturb
// it for a minute it digs back down and is gone. Simulated on the host.
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { I } from '../world/items.js';
import { B } from '../world/blocks.js';

export const HUSHKEEPER = {
  HEALTH: 500, MELEE: 30, BOOM: 10, BOOM_RANGE_H: 15, BOOM_RANGE_V: 20, BOOM_CHARGE: 34, BOOM_COOLDOWN: 60,
  HEARING: 16, SNIFF_RANGE: 24, SNIFF_EVERY: 100, ANGRY: 80, ANGER_MAX: 150, NOISE_ANGER: 35, SNIFF_ANGER: 20, HIT_ANGER: 100,
  EMERGE: 134, DIG: 100, CALM_TICKS: 1200,
};
const K = HUSHKEEPER;

/** Anger after hearing a noise (capped); pure, unit tested. */
export function angerAfter(anger, kind) {
  const add = kind === 'hit' ? K.HIT_ANGER : kind === 'sniff' ? K.SNIFF_ANGER : K.NOISE_ANGER;
  return Math.min(K.ANGER_MAX, anger + add);
}
/** Can the sonic boom reach a target this far away (horizontal / vertical blocks)? */
export const boomReaches = (dh, dv) => dh <= K.BOOM_RANGE_H && Math.abs(dv) <= K.BOOM_RANGE_V;
/** Should it dig back down (nothing has disturbed it for a minute and it is not hunting)? */
export const shouldDig = (now, lastDisturb, anger) => anger < K.ANGRY && now - lastDisturb >= K.CALM_TICKS;

function keeperAI(m, g, p, pdist) {
  const b = m.body;
  m.anger = m.anger ?? 0;
  m.lastDisturb = m.lastDisturb ?? g.ticks;
  m.lastHeard = m.lastHeard ?? g.ticks;
  m.boomCooldown = Math.max(0, (m.boomCooldown ?? 0) - 1);
  m.headPitch = 0;
  // coming up out of the ground / digging back down: it does nothing else
  if (m.emerging > 0) {
    m.emerging--; b.vx = 0; b.vz = 0;
    if (g.ticks % 4 === 0) dirt(m, g);
    if (m.emerging === 0) g.audio.play('hush_growl', [m.x, m.y + 2, m.z], 1);
    return;
  }
  if (m.digging > 0) {
    b.vx = 0; b.vz = 0;
    if (g.ticks % 4 === 0) dirt(m, g);
    if (--m.digging <= 0) { m.removed = true; m.dead = true; }
    return;
  }
  // anger cools by one a second
  if (g.ticks % 20 === 0 && m.anger > 0) m.anger--;
  const hunting = !p.dead && !p.creative && !p.spectator;
  // hearing: the latest noises within 16 blocks
  const hush = g.hush;
  if (hush) {
    for (const n of hush.noises) {
      if (n.t <= m.lastHeard) continue;
      if (Math.hypot(n.x - m.x, n.y - m.y, n.z - m.z) > K.HEARING) continue;
      m.investigate = [n.x, n.y, n.z];
      m.lastDisturb = g.ticks;
      if (n.player && hunting) m.anger = angerAfter(m.anger, 'noise');
      if (g.ticks - (m.lastGrowl || 0) > 40) { m.lastGrowl = g.ticks; g.audio.play('hush_growl', [m.x, m.y + 2, m.z], 0.7); }
    }
    m.lastHeard = hush.noises.length ? Math.max(m.lastHeard, hush.noises[hush.noises.length - 1].t) : m.lastHeard;
  }
  // smell: every 5 s it sniffs for the nearest player
  if (g.ticks % K.SNIFF_EVERY === m.id % K.SNIFF_EVERY) {
    g.audio.play('hush_sniff', [m.x, m.y + 2.5, m.z], 0.6);
    if (hunting && pdist <= K.SNIFF_RANGE) {
      m.anger = angerAfter(m.anger, 'sniff');
      m.investigate = [p.x, p.y, p.z];
      if (m.anger >= K.ANGRY) m.lastDisturb = g.ticks;
    }
  }
  m.angry = m.anger >= K.ANGRY && hunting;
  if (m.angry) {
    m.lastDisturb = g.ticks;
    const dh = Math.hypot(p.x - m.x, p.z - m.z), dv = p.y - m.y;
    if (m.boomCharge > 0) {
      // standing still, the chest swelling with the sound
      b.vx *= 0.5; b.vz *= 0.5;
      m.yaw = Math.atan2(-(p.x - m.x), -(p.z - m.z));
      if (--m.boomCharge === 0) sonicBoom(m, g, p);
      return;
    }
    m.chase(g, p, 1.3);
    const reach = (m.width / 2 + 1.4) ** 2;
    if (dh * dh <= reach && Math.abs(dv) < m.height && m.attackCooldown <= 0) {
      m.attackCooldown = 18; m.swingTime = 10;
      if (p.hurt(K.MELEE, 'mob:' + m.def.name, m)) { p.body.vx += (p.x - m.x) / (dh || 1) * 0.6; p.body.vz += (p.z - m.z) / (dh || 1) * 0.6; p.body.vy = Math.max(p.body.vy, 0.35); }
    } else if (dh > 4 && m.boomCooldown === 0 && boomReaches(dh, dv) && (!m.path || !m.path.length || g.ticks % 40 === 0)) {
      m.boomCharge = K.BOOM_CHARGE;
      g.audio.play('sonic_charge', [m.x, m.y + 1.8, m.z], 1);
    }
    return;
  }
  m.boomCharge = 0;
  if (m.investigate) {
    const [tx, ty, tz] = m.investigate;
    if (Math.hypot(tx - m.x, tz - m.z) < 1.5) m.investigate = null;
    else {
      if (--m.pathTimer <= 0 || !m.path) { m.pathTimer = 20; m.pathTo(g, tx, ty, tz); }
      if (!m.followPath(g, 0.9)) m.steer(tx, tz, 0.9);
    }
  } else m.wanderAI(g, 0.5);
  if (shouldDig(g.ticks, m.lastDisturb, m.anger)) {
    m.digging = K.DIG;
    g.audio.play('emerge', [m.x, m.y + 1, m.z], 1);
  }
}

/** The sonic boom: a ring of sound flying to the target; it ignores walls and armour. */
function sonicBoom(m, g, p) {
  m.boomCooldown = K.BOOM_COOLDOWN;
  const sx = m.x, sy = m.y + 1.8, sz = m.z, ex = p.x, ey = p.y + 1, ez = p.z;
  const d = Math.hypot(ex - sx, ey - sy, ez - sz) || 1, n = Math.ceil(d * 1.5);
  for (let k = 1; k <= n; k++) {
    const f = k / n;
    for (let j = 0; j < 4; j++) {
      const a = j * Math.PI / 2 + k;
      g.particles.emit(sx + (ex - sx) * f + Math.cos(a) * 0.3, sy + (ey - sy) * f + Math.sin(a) * 0.3, sz + (ez - sz) * f, 0, 0, 0, 0.45, 0.95, 0.95, 14, 0);
    }
  }
  g.audio.play('sonic_boom', [m.x, m.y + 1.8, m.z], 1.5);
  if (p.hurt(K.BOOM, 'sonic', m)) {
    p.body.vx += (ex - sx) / d * 1.2; p.body.vz += (ez - sz) / d * 1.2; p.body.vy = Math.max(p.body.vy, 0.4);
  }
}

function dirt(m, g) {
  for (let k = 0; k < 6; k++) g.particles.emit(m.x + (Math.random() - 0.5) * 1.6, m.y + 0.1, m.z + (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.15, 0.15 + Math.random() * 0.1, (Math.random() - 0.5) * 0.15, 0.08, 0.2, 0.22, 20, 0.02);
}

function keeperHurt(m, dmg, source, attacker) {
  if (m.emerging > 0 || m.digging > 0) return 0; // out of reach while it rises or sinks
  if (attacker && (attacker.isPlayer || attacker === (m._game && m._game.player))) { m.anger = angerAfter(m.anger || 0, 'hit'); m.lastDisturb = m._game ? m._game.ticks : 0; }
  if (source === 'fire' || source === 'lava') return dmg * 0.5;
  return dmg;
}

function keeperRender(m, model, alpha, sec) {
  const parts = model.userData.parts;
  // rising out of / sinking into the ground
  const em = m.emerging > 0 ? (m.emerging - alpha) / K.EMERGE : m.digging > 0 ? 1 - (m.digging - alpha) / K.DIG : 0;
  model.position.y -= Math.max(0, em) * m.height;
  // the heart beats faster the angrier it is; the head tendrils quiver
  const rate = 1 + Math.min(1, (m.anger || 0) / K.ANGRY) * 2.5 + (m.boomCharge > 0 ? 3 : 0);
  const beat = Math.pow(Math.max(0, Math.sin(sec * rate * Math.PI)), 6);
  const heart = parts.heart && parts.heart.children[0].material;
  if (heart && heart.emissive) heart.emissive.setRGB(0.1 + beat * 0.9, 0.6 + beat * 0.4, 0.55 + beat * 0.45);
  if (parts.heart) parts.heart.scale.setScalar(1 + beat * 0.15 + (m.boomCharge > 0 ? 0.3 : 0));
  for (const [k, s] of [['tendrilL', 1], ['tendrilR', -1]]) if (parts[k]) parts[k].rotation.z = s * (0.35 + Math.sin(sec * 7 + m.id) * 0.12 * (1 + beat));
  if (m.swingTime > 0 && parts.armL) parts.armL.rotation.x = parts.armR.rotation.x = -1.8 * Math.sin(m.swingTime / 10 * Math.PI);
  if (m.boomCharge > 0 && parts.armL) { parts.armL.rotation.x = parts.armR.rotation.x = -0.6; parts.head.rotation.x = -0.3; }
}

MODELS.hushkeeper = {
  parts: [
    ['legL', [6, 13, 6], [4, 13, 0], [0, -6.5, 0], '#0e2e34', { anim: 'legA' }],
    ['legR', [6, 13, 6], [-4, 13, 0], [0, -6.5, 0], '#0e2e34', { anim: 'legB' }],
    ['body', [18, 20, 11], [0, 13, 0], [0, 10, 0], '#123c44'],
    ['ribs', [14, 9, 1], [0, 13, 0], [0, 12, -5.6], '#9ab8b0'],
    ['heart', [6, 6, 1], [0, 25, -6], [0, 0, 0], '#7ffff0', { emissive: '#30e8d8' }],
    ['head', [16, 13, 10], [0, 33, 0], [0, 6.5, 0], '#123c44', { face: 'hushkeeper' }],
    ['tendrilL', [8, 9, 1], [8, 42, 0], [4, 1, 0], '#4ae8dc', { emissive: '#126a66' }],
    ['tendrilR', [8, 9, 1], [-8, 42, 0], [-4, 1, 0], '#4ae8dc', { emissive: '#126a66' }],
    ['armL', [7, 26, 7], [12.5, 32, 0], [0, -12, 0], '#103840', { anim: 'armSwing' }],
    ['armR', [7, 26, 7], [-12.5, 32, 0], [0, -12, 0], '#103840', { anim: 'armSwingB' }],
  ],
};
// blind: no eyes, only a wide dark jaw and a scatter of glowing specks
FACES.hushkeeper = (c) => {
  c.fillStyle = '#04161a'; c.fillRect(3, 10, 10, 3);
  c.fillStyle = '#c8e0d8'; for (const x of [4, 6, 9, 11]) c.fillRect(x, 10, 1, 1);
  c.fillStyle = '#4ef0e2'; for (const [x, y] of [[2, 3], [7, 2], [12, 4], [4, 6], [10, 7], [13, 1]]) c.fillRect(x, y, 1, 1);
};

export const HUSHKEEPER_DEF = {
  name: 'Hushkeeper', role: 'warden', category: CATEGORY.MONSTER,
  health: K.HEALTH, speed: 0.3, width: 0.9, height: 2.9, attack: K.MELEE, followRange: 24, sound: 'hush_growl',
  noFallDamage: true, noDespawn: true, knockbackResist: true, fireImmune: false, xp: 5,
  customAI: keeperAI, onHurt: keeperHurt, customRender: keeperRender,
  drops: [{ id: B.HUSH_CATALYST, min: 1, max: 1 }, { id: I.HUSH_SHARD, min: 1, max: 2 }],
};
if (!MOBS.hushkeeper) { MOBS.hushkeeper = HUSHKEEPER_DEF; MOB_KEYS.push('hushkeeper'); }
