// The Roving Peddler (reference: wandering trader and trader llamas) and its
// Packhorns (reference: llamas). Some mornings a peddler walks out of the
// wilds with two Packhorns on its heels, camps 24-40 blocks from the player
// for one day and sells odd goods for beryl that no village stocks (saplings
// of far-off trees, dyes, berries, Name Tags, Leads, Void Pearls...) - then
// packs up and vanishes with its beasts. A day without a visit raises the
// chance of one the next morning (25 %, +25 % a day up to 75 %; back to 25 %
// after a visit). Only one caravan at a time, never in the first two days.
//
// The Packhorns stay close to their peddler (a convoy id ties them together
// and is saved) and, when the peddler or one of them is hurt, the others bite
// whoever did it. They can be led on a Lead like any animal. Pure rules (the
// arrival schedule, placement, the convoy) are exported for the tests; the
// mob definitions are registered here.
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { I } from '../world/items.js';
import { B, SOLID, isFluid } from '../world/blocks.js';
import { makeTrades } from './trades.js';

export const DAY_TICKS = 24000;
export const STAY_TICKS = 24000;          // a caravan stays one day
export const FIRST_CHANCE = 0.25, CHANCE_STEP = 0.25, MAX_CHANCE = 0.75;
export const MIN_DAY = 2;                 // not before the world is two days old
export const SEARCH_TICKS = 1200;         // after the roll succeeds, keep looking for a camp spot this long
export const MIN_DIST = 24, MAX_DIST = 40;
export const CAMP_RADIUS = 14;            // the peddler wanders no farther than this from its camp
export const PACKHORNS = 2;
export const FOLLOW_NEAR = 4, FOLLOW_FAR = 8; // a Packhorn closes in beyond FOLLOW_NEAR and runs beyond FOLLOW_FAR
export const BITE_DAMAGE = 3;
export const GRUDGE_TICKS = 300;

/** The caravan schedule: the chance for the next roll and the day of the last one; `pending` ticks of camp search left. */
export const newArrival = () => ({ chance: FIRST_CHANCE, day: -1, pending: 0 });

/**
 * Once each (day-lit) day the caravan may arrive. Returns true when the
 * roll succeeded this call (a camp should now be searched for) and updates
 * the state; `busy` (a caravan is already out there) skips the roll without
 * using the day up.
 */
export function arrivalRoll(state, time, daylight, busy, rng = Math.random) {
  const day = Math.floor(time / DAY_TICKS);
  if (state.day === day || !daylight || busy || day < MIN_DAY) return false;
  state.day = day;
  if (rng() < state.chance) { state.chance = FIRST_CHANCE; state.pending = SEARCH_TICKS; return true; }
  state.chance = Math.min(MAX_CHANCE, state.chance + CHANCE_STEP);
  return false;
}

/** A spot at a random angle 24-40 blocks from (px, pz). */
export function campCandidate(px, pz, rng = Math.random) {
  const a = rng() * Math.PI * 2, r = MIN_DIST + rng() * (MAX_DIST - MIN_DIST);
  return { x: Math.floor(px + Math.cos(a) * r), z: Math.floor(pz + Math.sin(a) * r) };
}

/** Offsets (blocks) tried, in order, for the Packhorns around the peddler. */
export const PACK_OFFSETS = [[-1.8, 1.2], [1.8, 1.2], [0, 2.6], [-2.8, -0.4], [2.8, -0.4], [-3, 2.5], [3, 2.5], [0, -2.8]];

/** Rough cleanness of the spot for a camp: dry solid ground below, open air above. */
export function goodCampGround(below, at, above) {
  return !!SOLID[below] && !isFluid(below) && !isFluid(at) && !SOLID[at] && !SOLID[above] && below !== B.CACTUS && below !== B.ICE;
}

export const saveState = (s) => ({ chance: s.chance, day: s.day });
export function loadState(d) {
  const s = newArrival();
  if (d && Number.isFinite(d.chance)) s.chance = Math.max(FIRST_CHANCE, Math.min(MAX_CHANCE, d.chance));
  if (d && Number.isFinite(d.day)) s.day = d.day | 0;
  return s;
}

const alive = (e) => e && e.kind === 'mob' && !e.dead && e.deathTime === 0 && !e.removed;

/** All living members of a convoy. */
export const convoyOf = (list, id) => list.filter((e) => alive(e) && e.convoy != null && e.convoy === id);

/** The living peddler a convoy follows (or null once it has gone). */
export const leaderOf = (list, id) => list.find((e) => alive(e) && e.type === 'peddler' && e.convoy === id) || null;

/** Does a caravan exist (any living peddler)? */
export const caravanOut = (list) => list.some((e) => alive(e) && e.type === 'peddler');

/** Mark every member of the convoy (but `except`) as wanting a word with `foe`. */
export function callDefenders(list, convoy, foe, except = null) {
  let n = 0;
  if (convoy == null || !foe) return 0;
  for (const e of convoyOf(list, convoy)) {
    if (e === except || e === foe || e.type !== 'packhorn') continue;
    e.grudge = foe; e.grudgeTicks = GRUDGE_TICKS; n++;
  }
  return n;
}

/** Packhorn movement: 'run' toward the leader when far, 'walk' when it is a little away, 'idle' close by. */
export function followMode(dist) {
  if (dist > FOLLOW_FAR) return 'run';
  if (dist > FOLLOW_NEAR) return 'walk';
  return 'idle';
}

/** The peddler and its beasts pack up: smoke, and all gone. */
export function depart(m, g) {
  for (const e of convoyOf(g.entities.list, m.convoy).concat([m])) {
    if (e.removed) continue;
    if (g.particles) g.particles.smoke(e.x, e.y + e.height / 2, e.z, 16, e.width + 0.4);
    e.removed = true; e.dead = true;
  }
  if (g.audio) g.audio.play('hmm', [m.x, m.y + 1.5, m.z], 0.6);
}

function peddlerAI(m, g, p, pdist) {
  if (m.stay > 0 && --m.stay <= 0) return depart(m, g);
  if (m.panicTicks > 0) return m.passiveAI(g);
  // flee Shamblers within 8 blocks, as settlers do
  for (const e of g.entities.list) {
    if (e.kind !== 'mob' || !e.def.shamblerKin || e.dead) continue;
    const dx = m.x - e.x, dz = m.z - e.z;
    if (dx * dx + dz * dz < 64) { m.steer(m.x + dx * 4, m.z + dz * 4, m.def.panicSpeed); return; }
  }
  const c = m.camp || (m.camp = { x: m.x, z: m.z });
  const dc = Math.hypot(c.x - m.x, c.z - m.z);
  if (dc > CAMP_RADIUS) {
    if (!m.path || g.ticks % 40 === 0) m.pathTo(g, Math.floor(c.x), Math.floor(m.y), Math.floor(c.z));
    if (!m.followPath(g, 0.9)) m.steer(c.x, c.z, 0.9);
    return;
  }
  if (g.sky.state.aboveCount === 0) { m.headPitch = 0; return; } // resting by the fire at night
  if (pdist < 4 && !p.dead) {
    m.yaw = Math.atan2(-(p.x - m.x), -(p.z - m.z));
    m.headPitch = Math.atan2(p.y + p.eyeHeight - m.eyeY, Math.max(0.5, pdist)) * 0.8;
    return;
  }
  m.headPitch = 0;
  m.wanderAI(g, 0.7);
}

function packhornAI(m, g, p, pdist) {
  if (m.leashHolder) return m.passiveAI(g); // on a Lead it follows its holder instead
  if (m.grudgeTicks > 0) m.grudgeTicks--;
  const foe = m.grudge;
  if (foe && (foe.dead || foe.deathTime > 0 || m.grudgeTicks <= 0 || (foe.isPlayer && (p.dead || p.creative)))) m.grudge = null;
  if (m.grudge) {
    const f = m.grudge, d = Math.hypot(f.x - m.x, f.z - m.z);
    if (d < 24) {
      m.chase(g, f, 1.2);
      if (d < 1.9 && Math.abs(f.y - m.y) < 1.6 && m.attackCooldown <= 0) {
        m.attackCooldown = 20; m.swingTime = 10;
        f.hurt(BITE_DAMAGE, f.isPlayer ? 'mob:Packhorn' : 'mob', m, 0.5);
      }
      return;
    }
    m.grudge = null;
  }
  if (m.panicTicks > 0) return m.passiveAI(g);
  if (m.age < 0) return m.passiveAI(g);
  if (g.ticks % 20 === m.id % 20 || m._lead === undefined) m._lead = leaderOf(g.entities.list, m.convoy);
  const lead = m._lead;
  if (lead && !lead.removed) {
    const d = Math.hypot(lead.x - m.x, lead.z - m.z), mode = followMode(d);
    if (mode !== 'idle') {
      if (!m.path || g.ticks % 30 === m.id % 30) m.pathTo(g, Math.floor(lead.x), Math.floor(lead.y), Math.floor(lead.z));
      if (!m.followPath(g, mode === 'run' ? 1.4 : 0.9)) m.steer(lead.x, lead.z, mode === 'run' ? 1.4 : 0.9);
      return;
    }
    if (Math.random() < 0.01) m.yaw += (Math.random() - 0.5) * 1.5;
    return;
  }
  m.passiveAI(g);
}

const CLOAKS = ['#2a5a7a', '#7a3a2a', '#3a6a3a', '#6a4a7a', '#8a6a2a'];
const BLANKETS = ['#b04a3a', '#3a6aa8', '#c8a838', '#4a8a5a', '#8a4a9a', '#e8e0d0'];

function peddlerRender(m, mesh) {
  const pa = mesh.userData.parts;
  if (!pa || !pa.cloak) return;
  const col = CLOAKS[(m.id | 0) % CLOAKS.length];
  if (mesh.userData.cloakCol !== col) { mesh.userData.cloakCol = col; pa.cloak.children[0].material.userData.base.set(col); }
}

function packhornRender(m, mesh, alpha, sec) {
  const pa = mesh.userData.parts;
  if (!pa || !pa.blanket) return;
  const col = BLANKETS[(m.woolColor | 0) % BLANKETS.length];
  if (mesh.userData.blanketCol !== col) { mesh.userData.blanketCol = col; pa.blanket.children[0].material.userData.base.set(col); }
  if (pa.neck) pa.neck.rotation.x = Math.sin(m.limbSwing * 0.3) * 0.1 * m.limbAmount + (m.swingTime > 0 ? -0.6 : 0);
  if (pa.tail) pa.tail.rotation.z = Math.sin(sec * 2 + m.id) * 0.2;
}

MODELS.peddler = {
  parts: [
    ['head', [8, 10, 8], [0, 24, 0], [0, 5, 0], '#b8835a', { face: 'peddler' }],
    ['hood', [9, 4, 9], [0, 24, 0], [0, 10.5, 0.4], '#2a5a7e'],
    ['nose', [2, 4, 2], [0, 24, 0], [0, 2, -5], '#a87350'],
    ['cloak', [9, 15, 7], [0, 17.5, 0], [0, 0, 0.3], '#2a5a7a'],
    ['pack', [8, 9, 4], [0, 19, 0], [0, 1, 5], '#8a5a2a'],
    ['bedroll', [10, 3, 3], [0, 25, 0], [0, 0, 5], '#c8b898'],
    ['arms', [8, 4, 4], [0, 20, -1], [0, -1, -3.5], '#244e6a'],
    ['legR', [4, 11, 4], [2, 11, 0], [0, -5.5, 0], '#4a3220', { anim: 'legB' }],
    ['legL', [4, 11, 4], [-2, 11, 0], [0, -5.5, 0], '#4a3220', { anim: 'legA' }],
  ],
};
FACES.peddler = (c) => {
  c.fillStyle = '#3a2a1a'; c.fillRect(1, 3, 14, 1);
  c.fillStyle = '#ffffff'; c.fillRect(3, 5, 3, 2); c.fillRect(10, 5, 3, 2);
  c.fillStyle = '#7a4a1a'; c.fillRect(4, 5, 2, 2); c.fillRect(11, 5, 2, 2);
  c.fillStyle = '#5a4a3a'; c.fillRect(4, 11, 8, 2); c.fillRect(5, 13, 6, 1); // a bristly chin
};

MODELS.packhorn = {
  parts: [
    ['body', [10, 10, 18], [0, 19, 2], [0, 0, 0], '#d8cdb4'],
    ['blanket', [11, 2, 9], [0, 19, 2], [0, 5.5, -1], '#b04a3a'],
    ['neck', [4, 14, 4], [0, 22, -6], [0, 6, -1], '#d8cdb4'],
    ['head', [5, 5, 8], [0, 36, -7], [0, 0, -3], '#d8cdb4', { face: 'packhorn' }],
    ['earL', [1.5, 3, 1.5], [0, 36, -7], [1.8, 3.5, 0], '#b8a888'],
    ['earR', [1.5, 3, 1.5], [0, 36, -7], [-1.8, 3.5, 0], '#b8a888'],
    ['legFL', [3, 13, 3], [3, 13, -5], [0, -6.5, 0], '#b8a888', { anim: 'legA' }],
    ['legFR', [3, 13, 3], [-3, 13, -5], [0, -6.5, 0], '#b8a888', { anim: 'legB' }],
    ['legBL', [3, 13, 3], [3, 13, 9], [0, -6.5, 0], '#b8a888', { anim: 'legB' }],
    ['legBR', [3, 13, 3], [-3, 13, 9], [0, -6.5, 0], '#b8a888', { anim: 'legA' }],
    ['tail', [2, 5, 2], [0, 22, 11], [0, -2, 0], '#b8a888'],
  ],
};
FACES.packhorn = (c) => {
  c.fillStyle = '#141210'; c.fillRect(1, 5, 2, 2); c.fillRect(13, 5, 2, 2);
  c.fillStyle = '#6a5a48'; c.fillRect(5, 11, 6, 3); c.fillStyle = '#2a2018'; c.fillRect(6, 12, 1, 1); c.fillRect(9, 12, 1, 1);
};

export const PEDDLER = {
  name: 'Roving Peddler', role: 'wandering trader', category: CATEGORY.CREATURE, trader: true, sound: 'hmm',
  health: 20, speed: 0.3, width: 0.6, height: 1.95, panicSpeed: 1.6, drops: [],
  ownAI: peddlerAI, customRender: peddlerRender,
  onSpawn: (m) => {
    m.profession = 'peddler'; m.trades = makeTrades('peddler'); m.lastRestock = 0; // (only settlers restock: its stock does not refill)
    m.stay = STAY_TICKS; m.camp = { x: m.x, z: m.z }; m.convoy = Math.floor(Math.random() * 0x7fffffff);
  },
  onHurt: (m, dmg, source, attacker) => {
    const g = m._game;
    if (g && attacker && attacker !== m) callDefenders(g.entities.list, m.convoy, attacker);
    return dmg;
  },
  saveExtra: (m) => ({ stay: m.stay, camp: m.camp, convoy: m.convoy }),
  loadExtra: (m, s) => {
    m.stay = Number.isFinite(s.stay) ? s.stay : STAY_TICKS;
    m.camp = s.camp && Number.isFinite(s.camp.x) && Number.isFinite(s.camp.z) ? { x: s.camp.x, z: s.camp.z } : { x: m.x, z: m.z };
    m.convoy = s.convoy != null ? s.convoy : m.convoy;
  },
};

export const PACKHORN = {
  name: 'Packhorn', role: 'llama', category: CATEGORY.CREATURE, sound: 'neigh', noFallDamage: true,
  health: 22, speed: 0.22, width: 0.9, height: 1.87, panicSpeed: 1.5,
  drops: [{ id: I.LEATHER, min: 0, max: 2 }], food: [],
  ownAI: packhornAI, customRender: packhornRender,
  onSpawn: (m) => { m.convoy = null; m.woolColor = Math.floor(Math.random() * BLANKETS.length); },
  onHurt: (m, dmg, source, attacker) => {
    const g = m._game;
    if (g && attacker && attacker !== m && attacker.kind !== 'item') {
      callDefenders(g.entities.list, m.convoy, attacker, m);
      const lead = leaderOf(g.entities.list, m.convoy);
      if (lead) lead.panicTicks = 60;
    }
    return dmg;
  },
  saveExtra: (m) => ({ convoy: m.convoy }),
  loadExtra: (m, s) => { m.convoy = s.convoy != null ? s.convoy : null; },
};

if (!MOBS.peddler) { MOBS.peddler = PEDDLER; MOB_KEYS.push('peddler'); }
if (!MOBS.packhorn) { MOBS.packhorn = PACKHORN; MOB_KEYS.push('packhorn'); }

/**
 * Put a caravan down near (x, z): the peddler and its Packhorns, all on one convoy id.
 * Returns the peddler, or null when the peddler itself does not fit there.
 */
export function spawnCaravan(spawner, x, y, z) {
  if (!spawner.canFit('peddler', x, y, z)) return null;
  const peddler = spawner.spawnMob('peddler', x + 0.5, y, z + 0.5);
  const w = spawner.game.world;
  const taken = [];
  for (const [dx, dz] of PACK_OFFSETS) {
    if (taken.length >= PACKHORNS) break;
    const bx = Math.floor(x + dx), bz = Math.floor(z + dz);
    let by = y + 1;
    for (let k = 0; k < 5 && !SOLID[w.getBlock(bx, by - 1, bz)]; k++) by--; // down to the ground
    if (!SOLID[w.getBlock(bx, by - 1, bz)] || !spawner.canFit('packhorn', bx, by, bz)) continue;
    const h = spawner.spawnMob('packhorn', bx + 0.5, by, bz + 0.5);
    h.convoy = peddler.convoy;
    taken.push(h);
  }
  return peddler;
}

/**
 * The caravan schedule, called from the spawner every tick on the host: rolls once a
 * day-lit day, then looks for a camp spot every second until it finds one (or gives up).
 * Returns the peddler when one was placed.
 */
export function caravanTick(spawner, rng = Math.random) {
  const g = spawner.game, w = g.world, p = g.player;
  if (!spawner.peddlerState) spawner.peddlerState = newArrival();
  const st = spawner.peddlerState;
  if (!p || p.dead || (w.dimension && w.dimension !== 'overworld')) return null;
  const list = g.entities.list;
  arrivalRoll(st, g.time || 0, g.sky.state.aboveCount > 0, caravanOut(list), rng); // (a success starts the camp search)
  if (st.pending > 0 && g.ticks % 20 === 0) {
    st.pending = Math.max(0, st.pending - 20);
    for (let tries = 0; tries < 6; tries++) {
      const c = campCandidate(p.x, p.z, rng);
      if (!w.isLoaded(c.x, c.z)) continue;
      const y = w.heightAt(c.x, c.z) + 1;
      if (!goodCampGround(w.getBlock(c.x, y - 1, c.z), w.getBlock(c.x, y, c.z), w.getBlock(c.x, y + 1, c.z))) continue;
      const m = spawnCaravan(spawner, c.x, y, c.z);
      if (m) { st.pending = 0; return m; }
    }
  }
  return null;
}
