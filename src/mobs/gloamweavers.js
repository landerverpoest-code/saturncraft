// Gloamweaver: a hooded spellcaster of the raider faction (the module registers itself into MOBS, like pack7Mobs.js).
//
//  It keeps 8-12 blocks from its target, backs off from anything that closes in, and every 6 seconds (once a 1.2 second windup with raised
//  arms and swirling particles is through) casts one of three spells, picked by the situation:
//   Thornsnap  a line of thorn spikes erupts from the ground from the caster toward the target, one cell every 3 ticks for up to 12
//              blocks; each spike hits for 5 once, anything standing on it (raiders are spared)
//   Mantle     every raider within 8 blocks gets Resistance for 6 seconds; only cast when allies are near and hurt or in a fight
//   Haunt      2-3 short-lived (20 s) Flitters sweep at the target (the Flitter's own AI is hooked, see hookFlitter)
//  It joins raid waves from wave 3 on (taking places inside the wave, so wave sizes do not change) and sometimes marches with a patrol or
//  stands guard at a Raider Outpost. Drops: 0-2 Beryl and, 5 % of the time, a Charm of Undying.
//
// The pure rules (spell choice, spike cells, mantle targets, cooldowns, wave and patrol composition) are exported for the tests.
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { I } from '../world/items.js';
import { SOLID } from '../world/blocks.js';

// ---------------------------------------------------------------------------------------------
// Numbers

export const CAST = { WINDUP: 24, COOLDOWN: 120 };                         // 1.2 s windup, 6 s between casts
export const KEEP = { MIN: 8, MAX: 12, FLEE: 5 };                           // wanted distance band; closer than FLEE it runs
export const THORN = { MAX_LEN: 12, STEP: 3, DAMAGE: 5, REACH: 0.8, LIFE: 14 };
export const MANTLE = { RANGE: 8, TICKS: 120, HURT_BELOW: 0.75 };
export const HAUNT = { MIN: 2, MAX: 3, TICKS: 400, CAP: 3, DAMAGE: 2 };
export const SPELL_RANGE = 14;
export const FIRST_WAVE = 3;                                                // raid waves with a Gloamweaver
export const PATROL_CHANCE = 0.1;
export const OUTPOST_CHANCE = 0.2;
export const CHARM_CHANCE = 0.05;

export const SPELLS = ['thornsnap', 'mantle', 'haunt'];

// ---------------------------------------------------------------------------------------------
// Pure rules (unit tested)

const alive = (e) => !!e && !e.dead && !(e.deathTime > 0) && !e.removed;
/** Is this a raider (a Marauder, a Gloamweaver, anything saved with the raid tag)? */
export const isRaider = (e) => !!e && (!!e.raider || !!(e.def && e.def.raider) || e.type === 'gloamweaver');

/** The haunting is available when the game has a Flitter to summon. */
export const hauntAvailable = (mobs = MOBS) => !!(mobs.flitter && mobs.flitter.flying);

/** Raiders (the caster included) within the Mantle's range of `self`. */
export function mantleTargets(self, mobs, range = MANTLE.RANGE) {
  const r2 = range * range;
  return mobs.filter((e) => alive(e) && isRaider(e) && (e === self || ((e.x - self.x) ** 2 + (e.z - self.z) ** 2 <= r2 && Math.abs(e.y - self.y) <= range)));
}

/** Is this raider hurt, or in a fight (it has a target or prey)? */
export const needsMantle = (e) => alive(e) && ((e.maxHealth > 0 && e.health < e.maxHealth * MANTLE.HURT_BELOW) || !!e.target || !!e.prey);

/** Mantle is worth casting when another raider close by is hurt or engaged and has no Resistance yet. */
export function shouldMantle(self, mobs) {
  return mantleTargets(self, mobs).some((e) => e !== self && needsMantle(e) && !(e.effects && e.effects.resistance));
}

/**
 * Which spell to cast (or null: nothing now).
 * `ctx`: dist (to the target), sight (can it see the target), mantle (shouldMantle result), haunting (its summoned bats alive),
 * hauntOk (hauntAvailable). Mantle comes first when allies need it; a target that has closed in is answered with bats; otherwise thorns.
 */
export function chooseSpell({ dist, sight = true, mantle = false, haunting = 0, hauntOk = true }, rng = Math.random) {
  if (mantle) return 'mantle';
  if (!(dist <= SPELL_RANGE) || !sight) return null;
  const bats = hauntOk && haunting < HAUNT.CAP;
  if (bats && (dist <= KEEP.FLEE || rng() < 0.3)) return 'haunt';
  return 'thornsnap';
}

/** The cooldown rule: may it begin a cast now (no windup under way, cooldown over). */
export const canCast = (m) => !(m.castTicks > 0) && !(m.castCd > 0);

/**
 * One tick of the casting clock on `m` (castTicks = windup left, castSpell, castCd = cooldown left).
 * Returns 'windup' while casting, the spell's name on the tick it is released (the cooldown then starts) or null.
 */
export function castStep(m) {
  if (m.castTicks > 0) {
    if (--m.castTicks > 0) return 'windup';
    const s = m.castSpell; m.castSpell = null; m.castCd = CAST.COOLDOWN;
    return s;
  }
  if (m.castCd > 0) m.castCd--;
  return null;
}

/** Start a windup for `spell` (false when the cooldown is not over). */
export function beginCast(m, spell) {
  if (!canCast(m) || !SPELLS.includes(spell)) return false;
  m.castSpell = spell; m.castTicks = CAST.WINDUP;
  return true;
}

/**
 * The cells of a Thornsnap from `from` toward `to`: one every block along the line, starting one block out, never more than 12,
 * reaching a little past the target. Each cell is { x, z, delay } with delay = 3 ticks per cell. No direction (same spot) gives none.
 */
export function thornCells(from, to, maxLen = THORN.MAX_LEN) {
  const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz);
  if (d < 0.5) return [];
  const n = Math.min(maxLen, Math.ceil(d) + 1);
  const out = [], seen = new Set();
  for (let i = 1; i <= n; i++) {
    const x = Math.floor(from.x + (dx / d) * i), z = Math.floor(from.z + (dz / d) * i), k = x + ',' + z;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x, z, delay: out.length * THORN.STEP });
  }
  return out;
}

/** Does a spike in `cell` with its floor at `cy` hit this entity (position at its feet)? Raiders and summoned bats are spared. */
export function spikeHits(cell, cy, e) {
  if (!alive(e) || isRaider(e) || e.haunt) return false;
  return Math.abs(e.x - (cell.x + 0.5)) < THORN.REACH + 0.2 && Math.abs(e.z - (cell.z + 0.5)) < THORN.REACH + 0.2 && e.y > cy - 0.9 && e.y < cy + 1.4;
}

/** 2-3 bats. */
export const hauntCount = (rng = Math.random) => HAUNT.MIN + Math.floor(rng() * (HAUNT.MAX - HAUNT.MIN + 1));

/** Gloamweavers in raid wave `wave` (1-based) of `count` raiders: none before wave 3, then one, two from wave 5, at most a third of the wave. */
export function waveCasters(wave, count) {
  if (wave < FIRST_WAVE || count < 3) return 0;
  return Math.min(1 + Math.floor((wave - FIRST_WAVE) / 2), 2, Math.floor(count / 3));
}

/** The type of raider number `i` (0 = the Captain, always a Marauder) of a wave of `count`: the last places go to Gloamweavers. */
export function waveMemberType(i, wave, count) {
  return i > 0 && i >= count - waveCasters(wave, count) ? 'gloamweaver' : 'marauder';
}

/** The index of the patrol member (of `size`, 2-5) that is a Gloamweaver, or -1: rarely, and never in a pair. */
export function patrolCasterIndex(size, rng = Math.random) {
  return size >= 3 && rng() < PATROL_CHANCE ? size - 1 : -1;
}

/** Does an outpost chunk get an extra Gloamweaver on its parapet. */
export const outpostCaster = (rng = Math.random) => rng() < OUTPOST_CHANCE;

// ---------------------------------------------------------------------------------------------
// Game side

const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const faceTowards = (m, x, z, k = 0.4) => { m.yaw += wrap(Math.atan2(-(x - m.x), -(z - m.z)) - m.yaw) * k; };

const mobsOf = (g) => g.entities.list.filter((e) => e.kind === 'mob');
const eyeOf = (t) => (t.eyeY !== undefined ? t.eyeY : t.y + (t.eyeHeight || 1.62));

/** Who it fights: the player in range, else (in a raid) the nearest settler. Returns the entity or null. */
function pickTarget(m, g, p, pdist) {
  if (m.acquire(g, p, pdist, m.def.followRange)) return p;
  if (m.prey && (!alive(m.prey) || Math.hypot(m.prey.x - m.x, m.prey.z - m.z) > 36)) m.prey = null;
  if (!m.prey && m.raider && g.ticks % 20 === m.id % 20) {
    let best = null, bd = 28;
    for (const e of mobsOf(g)) {
      if (!e.def.villager || !alive(e)) continue;
      const d = Math.hypot(e.x - m.x, e.z - m.z);
      if (d < bd) { bd = d; best = e; }
    }
    m.prey = best;
  }
  return m.prey || null;
}

function groundY(w, x, z, refY) {
  for (let y = Math.floor(refY) + 2; y >= Math.floor(refY) - 4; y--) if (SOLID[w.getBlock(x, y - 1, z)] && !SOLID[w.getBlock(x, y, z)]) return y;
  return null;
}

function swirl(g, m, n, r, gg, b) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * TAU;
    g.particles.emit(m.x + Math.cos(a) * 0.6, m.y + 1 + Math.random() * 1.2, m.z + Math.sin(a) * 0.6, -Math.cos(a) * 0.02, 0.05, -Math.sin(a) * 0.02, r, gg, b, 16, -0.002);
  }
}

function castThornsnap(m, g, t) {
  const spikes = m.spikes || (m.spikes = []);
  for (const c of thornCells(m, t)) {
    const y = groundY(g.world, c.x, c.z, m.y);
    if (y !== null) spikes.push({ x: c.x, z: c.z, y, t: c.delay, hit: new Set(), life: THORN.LIFE });
  }
  g.audio.play('hmm', [m.x, m.y + 1.5, m.z], 0.7);
}

function tickSpikes(m, g, p) {
  if (!m.spikes || !m.spikes.length) return;
  const mobs = mobsOf(g);
  for (const s of m.spikes) {
    if (s.t-- > 0) continue;
    if (s.life === THORN.LIFE) {
      g.audio.play('clink', [s.x + 0.5, s.y, s.z + 0.5], 0.5);
      const cell = { x: s.x, z: s.z };
      if (!p.dead && !p.creative && spikeHits(cell, s.y, p)) p.hurt(THORN.DAMAGE, 'mob:' + m.def.name, m);
      for (const e of mobs) if (e !== m && spikeHits(cell, s.y, e) && !s.hit.has(e)) { s.hit.add(e); e.hurt(THORN.DAMAGE, 'magic', m, 0.3); }
    }
    s.life--;
    if (s.life % 3 === 0) for (let k = 0; k < 3; k++) g.particles.emit(s.x + Math.random(), s.y + 0.1 + Math.random() * 0.9, s.z + Math.random(), 0, 0.04, 0, 0.32, 0.46, 0.18, 14, -0.003);
  }
  m.spikes = m.spikes.filter((s) => s.life > 0);
}

function castMantle(m, g) {
  for (const e of mantleTargets(m, mobsOf(g))) {
    e.applyEffect('resistance', MANTLE.TICKS, 0, 1, m);
    for (let k = 0; k < 6; k++) g.particles.emit(e.x + (Math.random() - 0.5) * 0.8, e.y + Math.random() * 1.8, e.z + (Math.random() - 0.5) * 0.8, 0, 0.05, 0, 0.55, 0.3, 0.8, 20, -0.001);
  }
  g.audio.play('levelup', [m.x, m.y + 1.5, m.z], 0.4);
}

function castHaunt(m, g, t) {
  const n = hauntCount();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + Math.random();
    const b = g.spawner.spawnMob('flitter', m.x + Math.cos(a) * 1.5, m.y + 1.6, m.z + Math.sin(a) * 1.5, { fresh: false });
    if (!b) continue;
    b.haunt = { owner: m, target: t, ticks: HAUNT.TICKS };
    b.roosting = false;
  }
  swirl(g, m, 12, 0.4, 0.2, 0.6);
  g.audio.play('squeak', [m.x, m.y + 1.5, m.z], 0.8);
}

const hauntingCount = (m, g) => mobsOf(g).filter((e) => e.haunt && e.haunt.owner === m && alive(e)).length;

function gloamweaverAI(m, g, p, pdist) {
  if (m.raider && !m.raidCenter && g.raids) g.raids.adopt(m); // loaded from a save
  const mobs = mobsOf(g);
  m.headPitch = 0;
  tickSpikes(m, g, p);
  const t = pickTarget(m, g, p, pdist);
  const td = t ? Math.hypot(t.x - m.x, t.z - m.z) : Infinity;
  const act = castStep(m);
  if (act === 'thornsnap' && t) castThornsnap(m, g, t);
  else if (act === 'mantle') castMantle(m, g);
  else if (act === 'haunt' && t) castHaunt(m, g, t);
  if (m.castTicks > 0) { // the windup: standing still, arms raised, particles swirling
    m.move = null; m.path = null;
    if (t) faceTowards(m, t.x, t.z, 0.5);
    if (g.ticks % 2 === 0) swirl(g, m, 2, 0.5, 0.25, 0.75);
    return;
  }

  if (canCast(m) && g.ticks % 5 === m.id % 5) {
    const sight = !!t && m.canSee(g, t.x, eyeOf(t), t.z);
    const spell = chooseSpell({ dist: td, sight, mantle: shouldMantle(m, mobs), haunting: hauntingCount(m, g), hauntOk: hauntAvailable() });
    if (spell && beginCast(m, spell)) return;
  }

  if (t) {
    // keep 8-12 blocks off; run from anything that closes in
    faceTowards(m, t.x, t.z, 0.3);
    if (td < KEEP.MIN) m.steer(m.x + (m.x - t.x) * 3, m.z + (m.z - t.z) * 3, td < KEEP.FLEE ? 1.4 : 0.9);
    else if (td > KEEP.MAX) m.chase(g, t, 0.9);
    else { m.move = null; m.path = null; }
    return;
  }
  // nothing to fight: raiders march on the village, patrol members follow their leader, the rest wander
  if (m.raider && m.raidCenter) {
    const c = m.raidCenter;
    if (Math.hypot(c.x - m.x, c.z - m.z) > 6) {
      if (!m.path || g.ticks % 40 === m.id % 40) m.pathTo(g, Math.floor(c.x), Math.floor(m.y), Math.floor(c.z));
      if (!m.followPath(g, 1)) m.steer(c.x, c.z, 1);
      return;
    }
  }
  const lead = m.patrolLeader;
  if (lead && alive(lead)) {
    const d = Math.hypot(lead.x - m.x, lead.z - m.z);
    if (d > 6) { m.chase(g, lead, d > 12 ? 1.1 : 0.9); return; }
  } else if (lead) m.patrolLeader = null;
  m.wanderAI(g, 0.8);
}

/** A summoned bat: sweeps at its target for 20 seconds, then is gone. */
function hauntAI(m, g, p, pdist) {
  const h = m.haunt, b = m.body;
  if (--h.ticks <= 0 || !alive(h.owner)) { m.haunt = null; m.hurt(100, 'generic'); return; }
  if (h.target !== p && !alive(h.target)) h.target = p;
  const t = h.target;
  if (t === p && (p.dead || p.creative)) return m.flitterAI(g, p, pdist);
  const dx = t.x - m.x, dy = eyeOf(t) - 0.3 - m.y, dz = t.z - m.z, d = Math.hypot(dx, dy, dz) || 1;
  const sp = 0.12;
  b.vx += (dx / d * sp - b.vx) * 0.25; b.vy += (dy / d * sp - b.vy) * 0.25; b.vz += (dz / d * sp - b.vz) * 0.25;
  m.yaw = Math.atan2(-b.vx, -b.vz);
  if (d < 1.3 && m.attackCooldown <= 0) {
    m.attackCooldown = 20;
    if (t === p) p.hurt(HAUNT.DAMAGE, 'mob:Gloamweaver', h.owner); else t.hurt(HAUNT.DAMAGE, 'magic', h.owner, 0.2);
    g.audio.play('squeak', [m.x, m.y, m.z], 0.6);
  }
}

/** Hooks the Flitter's definition: a haunting bat follows hauntAI, every other one its usual flutter. */
function hookFlitter() {
  const d = MOBS.flitter;
  if (!d || d.hauntHooked) return;
  d.hauntHooked = true;
  const prev = d.ownAI;
  d.ownAI = (m, g, p, pdist) => {
    if (m.haunt) return hauntAI(m, g, p, pdist);
    if (prev) return prev(m, g, p, pdist);
    return m.flitterAI(g, p, pdist);
  };
}

// ---------------------------------------------------------------------------------------------
// Model

// A hooded robe: the hood frames a painted face in deep shadow; the arms rise while it casts.
MODELS.gloamweaver = {
  parts: [
    ['head', [8, 8, 8], [0, 24, 0], [0, 4, 0], '#fffffa', { face: 'gloamweaver' }],
    ['hood', [9.4, 2, 9.4], [0, 24, 0], [0, 8.6, 0.2], '#2c2444'],
    ['hoodBack', [9.4, 9, 2], [0, 24, 0], [0, 4, 4.8], '#2c2444'],
    ['hoodSideL', [1.4, 8, 8], [0, 24, 0], [4.6, 4, 0], '#2c2444'],
    ['hoodSideR', [1.4, 8, 8], [0, 24, 0], [-4.6, 4, 0], '#2c2444'],
    ['body', [8, 12, 5], [0, 18, 0], [0, 0, 0], '#3a2f5c'],
    ['sash', [8.4, 1.6, 5.4], [0, 18, 0], [0, -2, 0], '#8a6ad0', { emissive: '#3a2a6a' }],
    ['hem', [9.4, 6, 6.4], [0, 8, 0], [0, 0, 0], '#2c2444'],
    ['armL', [4, 12, 4], [6, 22, 0], [0, -4, 0], '#3a2f5c', { anim: 'armSwingB' }],
    ['armR', [4, 12, 4], [-6, 22, 0], [0, -4, 0], '#3a2f5c', { anim: 'armSwing' }],
    ['legL', [3.6, 6, 3.6], [2, 6, 0], [0, -3, 0], '#1e1830', { anim: 'legA' }],
    ['legR', [3.6, 6, 3.6], [-2, 6, 0], [0, -3, 0], '#1e1830', { anim: 'legB' }],
  ],
};
// a pale narrow face in shadow: two glowing violet eyes, a thin dark mouth, stitched cheeks
FACES.gloamweaver = (c) => {
  c.fillStyle = '#17122a'; c.fillRect(0, 0, 16, 16);
  c.fillStyle = '#c9b8a6'; c.fillRect(3, 4, 10, 10);
  c.fillStyle = '#17122a'; c.fillRect(3, 4, 10, 2);
  c.fillStyle = '#1a1030'; c.fillRect(4, 7, 3, 2); c.fillRect(9, 7, 3, 2);
  c.fillStyle = '#c488ff'; c.fillRect(5, 7, 1, 2); c.fillRect(10, 7, 1, 2);
  c.fillStyle = '#5a3a6a'; c.fillRect(6, 11, 4, 1); c.fillRect(5, 10, 1, 1); c.fillRect(10, 10, 1, 1);
  c.fillStyle = '#7a6a8a'; c.fillRect(3, 10, 1, 3); c.fillRect(12, 10, 1, 3);
};

function gloamweaverRender(m, mesh, alpha, sec) {
  const pa = mesh.userData.parts;
  if (!pa) return;
  if (m.castTicks > 0) { // both arms up, trembling
    pa.armL.rotation.x = pa.armR.rotation.x = -2.5 + Math.sin(sec * 22) * 0.06;
    pa.armL.rotation.z = 0.25; pa.armR.rotation.z = -0.25;
  } else { pa.armL.rotation.z = 0; pa.armR.rotation.z = 0; }
}

// ---------------------------------------------------------------------------------------------
// Definition

export const GLOAMWEAVER = {
  name: 'Gloamweaver', role: 'spellcaster', category: CATEGORY.MONSTER, raider: true, sound: 'hmm',
  health: 24, speed: 0.3, width: 0.6, height: 1.95, followRange: 24,
  drops: [{ id: I.BERYL, min: 0, max: 2, playerOnly: true, noPlunder: true }, { id: I.CHARM_OF_UNDYING, min: 1, max: 1, playerOnly: true, chance: CHARM_CHANCE }],
  customAI: gloamweaverAI, customRender: gloamweaverRender,
  onSpawn: (m) => { m.castTicks = 0; m.castCd = 60; m.castSpell = null; m.spikes = []; },
};

if (!MOBS.gloamweaver) { MOBS.gloamweaver = GLOAMWEAVER; MOB_KEYS.push('gloamweaver'); }
hookFlitter();
