// Fauna round: four new overworld mobs for the biomes that had few (module registers itself into MOBS, like the Dune Strider).
//
//  Thistlehorn (reference: deer / ibex)  a grazing, antlered herd animal of Highland Meadows and savannas. It keeps with its herd, puts
//      its head down to graze, and when one is hurt or startled the whole herd bolts. Fed beetroot or sweet berries two grown ones have
//      a fawn (the farm-animal breeding of Mob.passiveAI); the young follow the grown-ups. Drops leather and venison.
//  Dustmole (reference: meerkat / mole)  a small burrower of deserts and badlands. It lives under the sand where nothing can see or hit
//      it, and now and then digs out to look at a player who stands still nearby; walk at it, or sprint past, and it digs straight back
//      down (and tunnels off to another spot). Snapshots carry its state in the flags they already have: `special` = under the sand,
//      `emerging` / `digging` = coming up / going down (the Hushkeeper's counters), so guests see it without a layout change.
//  Gloamlynx (reference: lynx)  a shy predator of taiga and snowy lands that only comes out at dusk and at night. It stalks a player at a
//      distance, creeping closer only while nobody looks at it (it freezes, crouched, when watched), circles at about ten blocks and never
//      attacks - and it bolts from light: a torch in the hand, a lit camp, and daybreak. It hunts Hoppers and Clucklings. No taming.
//  Tarnling (reference: tadpole / axolotl bucket)  a tiny pond dweller of tarns, waterholes and quiet ponds. Right-click one with an empty
//      Bucket to scoop it up (a Bucket of Tarnling); place the bucket to pour the water out and let it go. Four colours.
//
// Natural spawns: Thistlehorn and Gloamlynx use the creature spawn tables (spawnRules.js); Dustmoles and Tarnlings are placed by
// `faunaTick` (called from MobSpawner.tick, a couple of tries a second at most). Everything here is simulated on the host.
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { I, heldLightLevel } from '../world/items.js';
import { B, SOLID, isWaterish } from '../world/blocks.js';
import { BIOMES } from '../world/biomes.js';
import { mountGear, mountDeath, mountSave, mountLoad } from './mounts.js';

// ---------------------------------------------------------------------------------------------
// Numbers

export const THISTLE = { HERD_RANGE: 20, HERD_SPREAD: 8, GRAZE_TICKS: 50, GRAZE_CHANCE: 1 / 260, ALARM_RANGE: 14, ALARM_TICKS: 90, SHY_SPRINT: 5 };
export const MOLE = { EMERGE: 24, DIG: 24, CURIOUS: 14, SHY: 2.6, SHY_SPRINT: 6, HIDE_MIN: 100, HIDE_MAX: 360, UP_MAX: 600, TUNNEL_EVERY: 200, MAX: 5 };
export const LYNX = { DAY_MIN: 0.75, DUSK_MAX: 0.5, SCARE_HELD: 8, SCARE_PLAYER: 10, SCARE_SELF: 9, STALK_MIN: 7, STALK_MAX: 28, ORBIT: 10, FLEE_TICKS: 160, WATCHED_DOT: 0.78, PREY_RANGE: 12 };
export const TARN = { HOME_RADIUS: 6, MAX: 6, DRY_TICKS: 240, SHY: 3.2 };

/** Biome keys each special-spawn mob is placed in by faunaTick (the Field Guide lists them as habitats too). */
export const SPECIAL_HABITATS = {
  dustmole: ['desert', 'badlands'],
  tarnling: ['plains', 'forest', 'birch_forest', 'taiga', 'savanna', 'highland_meadow', 'swamp', 'flower_forest', 'blossom_grove', 'dark_forest', 'mangrove_swamp'],
};
const TARN_BIOMES = new Set(SPECIAL_HABITATS.tarnling);
const MOLE_BIOMES = new Set(SPECIAL_HABITATS.dustmole);
const SANDS = new Set([B.SAND, B.RED_SAND]);

/** Tarnling colours: [back, belly]. */
export const TARN_COLORS = [['#6aa05a', '#d8e8a8'], ['#d8783a', '#f4d89a'], ['#5a7ab8', '#cfe0f0'], ['#c8b04a', '#f0e8b0']];
/** Thistlehorn coats: [body, legs]. */
export const THISTLE_COATS = [['#a98a5e', '#7a6040'], ['#8a5a3a', '#5a3a24'], ['#b6b0a0', '#8a8478']];

// ---------------------------------------------------------------------------------------------
// Pure rules (unit tested)

/** Is a spot within `dot` of the line of sight? look = unit view vector, from / to = points. */
export function watchedBy(look, from, to, dot = LYNX.WATCHED_DOT) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], d = Math.hypot(dx, dy, dz) || 1;
  return (look[0] * dx + look[1] * dy + look[2] * dz) / d > dot;
}

/** What frightens a Gloamlynx: 'day' (broad daylight), 'light' (a torch in hand, a lit camp) or null. */
export function lynxScared({ held = 0, playerLight = 0, lynxLight = 0, combined = 0 }) {
  if (combined >= LYNX.DAY_MIN) return 'day';
  if (held >= LYNX.SCARE_HELD || playerLight >= LYNX.SCARE_PLAYER || lynxLight >= LYNX.SCARE_SELF) return 'light';
  return null;
}

/** Gloamlynxes only come out when the combined sunlight is low. */
export const lynxMaySpawn = (combined) => combined < LYNX.DUSK_MAX;

/** Where a stalker heads: closer while far (only if unwatched), away if too close, round the player in between. Returns 'freeze' | 'approach' | 'retreat' | 'orbit'. */
export function stalkMove(dist, watched) {
  if (dist < LYNX.STALK_MIN) return 'retreat';
  if (watched) return 'freeze';
  return dist > LYNX.ORBIT + 4 ? 'approach' : 'orbit';
}

/** A point on a circle round the player at ORBIT blocks, a little further round than the stalker now is. */
export function orbitPoint(px, pz, mx, mz, dir) {
  const a = Math.atan2(mz - pz, mx - px) + dir * 0.3;
  return [px + Math.cos(a) * LYNX.ORBIT, pz + Math.sin(a) * LYNX.ORBIT];
}

/** Does a Dustmole come up to look: it is hidden long enough, the player is near but not rushing at it, and the dice allow. */
export function moleSurfaces({ hidden, pdist, sprinting, now, until }, rng = Math.random) {
  if (!hidden || now < until || sprinting) return false;
  if (pdist < MOLE.SHY || pdist > MOLE.CURIOUS) return false;
  return rng() < 0.04;
}

/** Does a Dustmole above ground bolt for its hole? */
export function moleSpooked({ pdist, sprinting, panic, up }) {
  return panic > 0 || pdist < MOLE.SHY || (sprinting && pdist < MOLE.SHY_SPRINT) || up > MOLE.UP_MAX;
}

/** Fraction of its body below the sand while it rises (emerging counts down) or sinks (digging counts down): 0 = fully up, 1 = hidden. */
export function moleDepth(emerging, digging, alpha = 0) {
  if (emerging > 0) return Math.max(0, Math.min(1, (emerging - alpha) / MOLE.EMERGE));
  if (digging > 0) return Math.max(0, Math.min(1, 1 - (digging - alpha) / MOLE.DIG));
  return 0;
}

/** Can a Tarnling live at this water cell? Shallow still water (depth 1-4) over something solid, in a tarn / pond biome. */
export function tarnDepth(world, x, y, z, solid = (id) => SOLID[id]) {
  if (!isWaterish(world.getBlock(x, y, z))) return 0;
  let d = 0;
  while (d <= 5 && isWaterish(world.getBlock(x, y - d, z))) d++;
  return d <= 4 && solid(world.getBlock(x, y - d, z)) ? d : 0;
}

// ---------------------------------------------------------------------------------------------
// shared helpers

const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const ageTick = (m) => { if (m.age < 0) { if (++m.age === 0) m.setBaby(false); } else if (m.age > 0) m.age--; };

function nearestKin(m, g, range = THISTLE.HERD_RANGE) {
  let best = null, bd = range * range, n = 0, cx = 0, cz = 0;
  for (const e of g.entities.list) {
    if (e === m || e.type !== m.type || e.dead || e.deathTime > 0) continue;
    const d = (e.x - m.x) ** 2 + (e.z - m.z) ** 2;
    if (d > range * range) continue;
    n++; cx += e.x; cz += e.z;
    if (e.age >= 0 && d < bd) { bd = d; best = e; }
  }
  return { nearest: best, count: n, cx: n ? cx / n : m.x, cz: n ? cz / n : m.z };
}

/** Tint the base colour of named model parts (head parts carry a second, face material). */
function tint(parts, names, col) {
  for (const k of names) {
    const grp = parts[k];
    if (!grp) continue;
    const mm = grp.children[0].material;
    for (const x of Array.isArray(mm) ? [mm[0], mm[5]] : [mm]) if (x && x.userData.base) x.userData.base.set(col);
  }
}

// ---------------------------------------------------------------------------------------------
// Thistlehorn

function thistleAI(m, g, p, pdist) {
  const b = m.body;
  if (m.panicTicks > 0 || m.loveTicks > 0 || m.tempted(g) || m.leashHolder) { m.eatTimer = 0; return m.passiveAI(g); }
  // the young keep close to a grown one
  if (m.age < 0) {
    const kin = g.ticks % 20 === m.id % 20 ? (m._parent = nearestKin(m, g).nearest) : m._parent;
    if (kin && !kin.dead) {
      const d = Math.hypot(kin.x - m.x, kin.z - m.z);
      if (d > 4) { ageTick(m); m.wander = null; m.path = null; m.steer(kin.x, kin.z, 1.1); return; }
    }
  }
  // grazing: head down, then a bite of tall grass
  if (m.eatTimer > 0) {
    ageTick(m);
    m.headPitch = 0.9; m.move = null; m.wander = null; m.path = null;
    if (--m.eatTimer === 0) {
      m.headPitch = 0;
      const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
      if (g.world.getBlock(bx, by, bz) === B.TALL_GRASS) { g.world.setBlock(bx, by, bz, B.AIR); g.audio.play('step_grass', [m.x, m.y, m.z], 0.6); }
      if (m.health < m.maxHealth) m.health++;
    }
    return;
  }
  // startled by a player running at the herd: it bolts and so do its neighbours
  if (!p.dead && !p.creative && pdist < THISTLE.SHY_SPRINT && p.sprinting) alarm(m, g);
  // herd: drift back towards the others when the herd has spread out
  if (g.ticks % 40 === m.id % 40 && !m.wander) {
    const k = nearestKin(m, g);
    if (k.count && Math.hypot(k.cx - m.x, k.cz - m.z) > THISTLE.HERD_SPREAD) {
      m.wander = { x: k.cx, y: m.y, z: k.cz, t: 160 };
      m.pathTo(g, Math.floor(k.cx), Math.floor(m.y), Math.floor(k.cz));
    }
  }
  if (b.onGround && Math.random() < (m.age < 0 ? THISTLE.GRAZE_CHANCE * 3 : THISTLE.GRAZE_CHANCE)) {
    const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
    if (g.world.getBlock(bx, by, bz) === B.TALL_GRASS || g.world.getBlock(bx, by - 1, bz) === B.GRASS) { m.eatTimer = THISTLE.GRAZE_TICKS; return; }
  }
  m.passiveAI(g);
}

/** One Thistlehorn is frightened: it and the herd within range panic. */
export function alarm(m, g) {
  for (const e of g.entities.list) {
    if (e.type !== m.type || e.dead || e.deathTime > 0) continue;
    if ((e.x - m.x) ** 2 + (e.z - m.z) ** 2 <= THISTLE.ALARM_RANGE ** 2) { e.panicTicks = Math.max(e.panicTicks, THISTLE.ALARM_TICKS); e.eatTimer = 0; }
  }
}

function thistleHurt(m, dmg) {
  if (m._game) alarm(m, m._game);
  return dmg;
}

function thistleRender(m, model) {
  const pa = model.userData.parts;
  if (!pa || !pa.antlerL) return;
  const coat = THISTLE_COATS[(m.woolColor | 0) % THISTLE_COATS.length];
  if (model.userData.coat !== m.woolColor) {
    model.userData.coat = m.woolColor;
    tint(pa, ['body', 'neck', 'head'], coat[0]);
    tint(pa, ['legFL', 'legFR', 'legBL', 'legBR'], coat[1]);
  }
  pa.neck.rotation.x = (m.headPitch || 0) * 0.55;
  for (const k of ['antlerL', 'antlerR', 'tineL', 'tineR', 'earL', 'earR', 'snout']) pa[k].rotation.x = pa.head.rotation.x;
  pa.antlerL.visible = pa.antlerR.visible = pa.tineL.visible = pa.tineR.visible = m.age >= 0; // fawns have none yet
  // tack (mobs/mounts.js): the harness is in the mount's gear (so guests see it through the snapshot's equipment ids), the saddle is a flag
  const harnessed = !!mountGear(m).harness && m.age >= 0;
  pa.harness.visible = pa.chestStrap.visible = pa.headstall.visible = harnessed;
  pa.seat.visible = harnessed && !!m.saddled;
  pa.headstall.rotation.x = pa.head.rotation.x;
}

MODELS.thistlehorn = {
  parts: [
    ['body', [8, 9, 15], [0, 17, 1], [0, 0, 0], '#a98a5e'],
    ['rump', [8.4, 5, 2.4], [0, 17, 8.4], [0, 0.4, 0], '#efe4cc'],
    ['neck', [4, 9, 4], [0, 21, -5], [0, 4, -0.5], '#a98a5e'],
    ['head', [5, 5, 7], [0, 27, -7], [0, 0, -3], '#fffffd', { face: 'thistlehorn' }],
    ['snout', [3, 2.4, 2], [0, 27, -7], [0, -0.8, -7.8], '#2a2018'],
    ['earL', [1.6, 3.2, 1], [0, 27, -7], [3.4, 2.4, -1], '#8a6a46'],
    ['earR', [1.6, 3.2, 1], [0, 27, -7], [-3.4, 2.4, -1], '#8a6a46'],
    ['antlerL', [1, 7, 1], [0, 27, -7], [1.6, 6, -1.2], '#d8c8a0'],
    ['antlerR', [1, 7, 1], [0, 27, -7], [-1.6, 6, -1.2], '#d8c8a0'],
    ['tineL', [1, 1, 4], [0, 27, -7], [1.6, 8, -3], '#d8c8a0'],
    ['tineR', [1, 1, 4], [0, 27, -7], [-1.6, 8, -3], '#d8c8a0'],
    // tack, shown by thistleRender: a leather harness round the body and chest, a headstall, and the saddle on top (hidden from the Field Guide picture)
    ['harness', [8.8, 9.6, 1.6], [0, 17, 1], [0, 0.1, -2.6], '#b0763a', { gear: true }],
    ['chestStrap', [8.6, 1.6, 4.6], [0, 21, -5], [0, 0, 0], '#b0763a', { gear: true }],
    ['headstall', [5.4, 5.4, 1.4], [0, 27, -7], [0, 0, -2.4], '#c08a48', { gear: true }],
    ['seat', [8.8, 2, 6.4], [0, 17, 1], [0, 5.4, 1.4], '#6a3a1e', { gear: true }],
    ['legFL', [3, 13, 3], [2.4, 13, -5], [0, -6.5, 0], '#7a6040', { anim: 'legA' }],
    ['legFR', [3, 13, 3], [-2.4, 13, -5], [0, -6.5, 0], '#7a6040', { anim: 'legB' }],
    ['legBL', [3, 13, 3], [2.4, 13, 7], [0, -6.5, 0], '#7a6040', { anim: 'legB' }],
    ['legBR', [3, 13, 3], [-2.4, 13, 7], [0, -6.5, 0], '#7a6040', { anim: 'legA' }],
  ],
};
// dark eyes set wide, a pale muzzle and nostrils
FACES.thistlehorn = (c) => {
  c.fillStyle = '#17110a'; c.fillRect(1, 5, 3, 3); c.fillRect(12, 5, 3, 3);
  c.fillStyle = '#e8d8b0'; c.fillRect(2, 5, 1, 1); c.fillRect(13, 5, 1, 1);
  c.fillStyle = '#3a2a1c'; c.fillRect(4, 11, 8, 4);
  c.fillStyle = '#17110a'; c.fillRect(5, 12, 2, 1); c.fillRect(9, 12, 2, 1);
};

// ---------------------------------------------------------------------------------------------
// Dustmole

const sandColour = (m, g) => (g && g.world && g.world.getBlock(Math.floor(m.x), Math.floor(m.y - 0.2), Math.floor(m.z)) === B.RED_SAND ? [0.72, 0.4, 0.22] : [0.86, 0.76, 0.5]);

/** Sand thrown up while it rises or digs (also drawn by guests, net/entityMirror.js). */
export function sandPuff(m, g) {
  const c = sandColour(m, g);
  for (let k = 0; k < 5; k++) g.particles.emit(m.x + (Math.random() - 0.5) * 0.7, m.y + 0.05, m.z + (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.08, 0.07 + Math.random() * 0.06, (Math.random() - 0.5) * 0.08, c[0], c[1], c[2], 16, 0.01);
}

function relocate(m, g) {
  const w = g.world;
  for (let tries = 0; tries < 6; tries++) {
    const a = Math.random() * TAU, r = 3 + Math.random() * 5;
    const x = Math.floor(m.x + Math.cos(a) * r), z = Math.floor(m.z + Math.sin(a) * r);
    if (!w.isLoaded(x, z)) continue;
    const y = w.heightAt(x, z);
    if (SANDS.has(w.getBlock(x, y, z)) && !w.getBlock(x, y + 1, z) && !w.getBlock(x, y + 2, z)) { m.body.setPos(x + 0.5, y + 1, z + 0.5); m.prev = [m.x, m.y, m.z]; return true; }
  }
  return false;
}

function moleAI(m, g, p, pdist) {
  const b = m.body, w = g.world;
  m.until = m.until ?? g.ticks + MOLE.HIDE_MIN;
  m.headPitch = 0;
  const onSand = SANDS.has(w.getBlock(Math.floor(m.x), Math.floor(m.y - 0.2), Math.floor(m.z)));
  if (m.emerging > 0) {
    b.vx = b.vz = 0; m.move = null;
    if (g.ticks % 3 === 0) sandPuff(m, g);
    if (--m.emerging === 0) { m.special = false; m.up = 0; g.audio.play('burrow', [m.x, m.y + 0.3, m.z], 0.7); }
    return;
  }
  if (m.digging > 0) {
    b.vx = b.vz = 0; m.move = null;
    if (g.ticks % 3 === 0) sandPuff(m, g);
    if (--m.digging === 0) { m.special = true; m.panicTicks = 0; m.until = g.ticks + MOLE.HIDE_MIN + Math.floor(Math.random() * (MOLE.HIDE_MAX - MOLE.HIDE_MIN)); relocate(m, g); }
    return;
  }
  if (m.special) {
    // under the sand: nothing to see; it comes up to look at a quiet player, tunnels about now and then
    b.vx = b.vz = 0; m.move = null;
    if (!onSand) { if (++m.lost > 20) m.special = false; return; } // its sand was dug away: it is out in the open
    m.lost = 0;
    if (moleSurfaces({ hidden: true, pdist, sprinting: p.sprinting, now: g.ticks, until: m.until }) && !p.dead) { m.emerging = MOLE.EMERGE; sandPuff(m, g); g.audio.play('burrow', [m.x, m.y + 0.3, m.z], 0.6); }
    else if (g.ticks % MOLE.TUNNEL_EVERY === m.id % MOLE.TUNNEL_EVERY && pdist > MOLE.CURIOUS) relocate(m, g);
    return;
  }
  // above ground
  m.up = (m.up || 0) + 1;
  m.lost = 0;
  if (onSand && b.onGround && moleSpooked({ pdist: p.dead ? 99 : pdist, sprinting: p.sprinting, panic: m.panicTicks, up: m.up })) {
    m.digging = MOLE.DIG; m.path = null; m.wander = null; sandPuff(m, g); g.audio.play('burrow', [m.x, m.y + 0.3, m.z], 0.7);
    return;
  }
  if (!onSand && b.onGround && ++m.stray > 900) { m.removed = true; m.dead = true; return; } // stranded off the sand for good
  if (onSand) m.stray = 0;
  // a short meander over the sand (never off it)
  if (!m.heading || g.ticks % 50 === m.id % 50) m.heading = Math.random() * TAU;
  const ax = m.x - Math.sin(m.heading) * 1.4, az = m.z - Math.cos(m.heading) * 1.4;
  if (SANDS.has(w.getBlock(Math.floor(ax), Math.floor(m.y - 0.2), Math.floor(az))) && Math.random() < 0.7) { m.yaw = m.heading; m.move = { forward: m.speed() * 0.7, jump: false, mod: 0.7 }; }
  else { m.move = null; m.heading = Math.random() * TAU; }
}

function moleHurt(m, dmg) {
  if (m.special || m.emerging > 0 || m.digging > 0) return 0; // out of reach under the sand
  return dmg;
}

function moleRender(m, model, alpha, sec) {
  const pa = model.userData.parts;
  const hidden = m.special && !(m.emerging > 0) && !(m.digging > 0);
  model.visible = !hidden;
  if (!pa || hidden) return;
  model.position.y -= moleDepth(m.emerging, m.digging, alpha) * m.height * (m.age < 0 ? 0.5 : 1);
  const dig = m.emerging > 0 || m.digging > 0;
  const swing = dig ? Math.sin(sec * 28) * 0.9 : Math.cos(m.limbSwing * 0.6662) * 0.8 * m.limbAmount;
  pa.clawL.rotation.x = swing; pa.clawR.rotation.x = -swing;
  pa.nose.rotation.x = pa.head.rotation.x;
  pa.tail.rotation.y = Math.sin(sec * 3 + m.id) * 0.3;
}

MODELS.dustmole = {
  parts: [
    ['body', [6, 5, 9], [0, 4, 1], [0, 0, 0], '#c9a96a'],
    ['back', [5, 1.4, 7], [0, 6.8, 1.2], [0, 0, 0], '#a88a4e'],
    ['head', [4.4, 4, 5], [0, 4.6, -3.6], [0, 0, -2], '#fffffc', { face: 'dustmole' }],
    ['nose', [2, 1.6, 1.4], [0, 4.6, -3.6], [0, -0.6, -5], '#d89a8a'],
    ['clawL', [2.4, 3, 3], [3.6, 3, -2.6], [0, -1, -1.4], '#5a4a3a'],
    ['clawR', [2.4, 3, 3], [-3.6, 3, -2.6], [0, -1, -1.4], '#5a4a3a'],
    ['legBL', [2, 2, 2.4], [2.4, 2, 4.4], [0, -1, 0], '#a88a4e', { anim: 'legB' }],
    ['legBR', [2, 2, 2.4], [-2.4, 2, 4.4], [0, -1, 0], '#a88a4e', { anim: 'legA' }],
    ['tail', [1.2, 1.2, 3.4], [0, 5, 5.6], [0, 0, 1.7], '#a88a4e'],
  ],
};
// tiny dark eyes high on the face and a pale muzzle
FACES.dustmole = (c) => {
  c.fillStyle = '#16100a'; c.fillRect(2, 4, 3, 3); c.fillRect(11, 4, 3, 3);
  c.fillStyle = '#e8dcc0'; c.fillRect(3, 4, 1, 1); c.fillRect(12, 4, 1, 1);
  c.fillStyle = '#e8c8a0'; c.fillRect(5, 10, 6, 4);
  c.fillStyle = '#5a3a2a'; c.fillRect(7, 12, 2, 1);
};

// ---------------------------------------------------------------------------------------------
// Gloamlynx

function lynxAway(m, p, mod) { m.steer(m.x + (m.x - p.x) * 3, m.z + (m.z - p.z) * 3, mod); }

function lynxAI(m, g, p, pdist) {
  const w = g.world;
  m.special = false;
  if (m.panicTicks > 0) return m.passiveAI(g);
  const held = p.inventory && p.inventory.selectedStack ? heldLightLevel(p.inventory.selectedStack.id) : 0;
  const px = Math.floor(p.x), py = Math.floor(p.y + 1), pz = Math.floor(p.z);
  const combined = g.sky.state.combined;
  // broad daylight: it slinks away from the player and is gone
  if (combined >= LYNX.DAY_MIN) {
    if (pdist < 30 && !p.dead) lynxAway(m, p, 0.9); else m.wanderAI(g, 0.6);
    if (pdist > 20 && Math.random() < 1 / 160) { m.removed = true; m.dead = true; }
    return;
  }
  if (m.fleeTicks > 0) { m.fleeTicks--; if (!p.dead) lynxAway(m, p, 1.5); return; }
  // prey first (Hoppers and Clucklings), unless the player is close
  if (m.enemy && (m.enemy.dead || m.enemy.deathTime > 0 || Math.hypot(m.enemy.x - m.x, m.enemy.z - m.z) > LYNX.PREY_RANGE + 4)) m.enemy = null;
  if (!m.enemy && g.ticks % 40 === m.id % 40 && pdist > 8) {
    for (const e of g.entities.list) if (e.kind === 'mob' && (e.type === 'hopper' || e.type === 'cluckling') && !e.dead && e.deathTime === 0 && Math.hypot(e.x - m.x, e.z - m.z) < LYNX.PREY_RANGE) { m.enemy = e; break; }
  }
  if (m.enemy && pdist > 8) { m.chase(g, m.enemy, 1.35); m.howlerBite(g, m.enemy); return; }
  if (p.dead || pdist > LYNX.STALK_MAX) { m.wanderAI(g, 0.6); return; }
  const scare = lynxScared({ held, playerLight: w.blockLight(px, py, pz), lynxLight: w.blockLight(Math.floor(m.x), Math.floor(m.y + 0.5), Math.floor(m.z)), combined });
  if (scare) {
    m.fleeTicks = LYNX.FLEE_TICKS; m.enemy = null;
    g.audio.play('yowl', [m.x, m.y + 0.6, m.z], 0.8);
    return;
  }
  // stalking: never closer than a few blocks, creeping nearer only while nobody is looking
  const eye = p.eyePos(), watched = watchedBy(p.lookDir(), eye, [m.x, m.y + 0.5, m.z]) && m.canSee(g, eye[0], eye[1], eye[2]);
  m.orbit = m.orbit || (Math.random() < 0.5 ? 1 : -1);
  const mv = stalkMove(pdist, watched);
  if (mv === 'retreat') lynxAway(m, p, 0.8);
  else if (mv === 'freeze') { m.special = true; m.move = null; m.yaw += wrap(Math.atan2(-(p.x - m.x), -(p.z - m.z)) - m.yaw) * 0.3; }
  else if (mv === 'approach') m.steer(p.x, p.z, 0.65);
  else { const [tx, tz] = orbitPoint(p.x, p.z, m.x, m.z, m.orbit); m.steer(tx, tz, 0.55); }
  if (Math.random() < 1 / 500) g.audio.play('yowl', [m.x, m.y + 0.6, m.z], 0.6);
}

function lynxRender(m, model, alpha, sec) {
  const pa = model.userData.parts;
  if (!pa || !pa.tail) return;
  const crouch = m.special && m.deathTime === 0;
  if (crouch) {
    model.position.y -= 0.14 * model.scale.y;
    for (const k of ['legFL', 'legFR']) pa[k].rotation.x = -0.9;
    for (const k of ['legBL', 'legBR']) pa[k].rotation.x = 0.9;
    pa.head.rotation.x = 0.35;
  }
  pa.earL.rotation.x = pa.earR.rotation.x = pa.head.rotation.x;
  pa.ruff.rotation.x = pa.head.rotation.x;
  pa.tail.rotation.x = crouch ? 0.15 : 0.7;
  pa.tail.rotation.z = Math.sin(sec * 2 + m.id) * (crouch ? 0.35 : 0.1);
}

MODELS.gloamlynx = {
  parts: [
    ['body', [5, 6, 13], [0, 11, 1], [0, 0, 0], '#9a9484'],
    ['spots', [5.4, 1.2, 9], [0, 14.2, 1], [0, 0, 0], '#4e4a42'],
    ['ruff', [7, 4, 2], [0, 12, -5.6], [0, 0, 0], '#cfc8b6'],
    ['head', [5, 5, 5], [0, 14, -6.5], [0, 0, -2], '#fffffc', { face: 'gloamlynx' }],
    ['earL', [1.6, 3.2, 1], [0, 14, -6.5], [1.8, 3.8, -1], '#7a7466'],
    ['earR', [1.6, 3.2, 1], [0, 14, -6.5], [-1.8, 3.8, -1], '#7a7466'],
    ['tuftL', [0.8, 1.8, 0.8], [0, 14, -6.5], [1.8, 6.2, -1], '#17140f'],
    ['tuftR', [0.8, 1.8, 0.8], [0, 14, -6.5], [-1.8, 6.2, -1], '#17140f'],
    ['legFL', [2.4, 9, 2.4], [1.7, 9, -4], [0, -4.5, 0], '#7a7466', { anim: 'legA' }],
    ['legFR', [2.4, 9, 2.4], [-1.7, 9, -4], [0, -4.5, 0], '#7a7466', { anim: 'legB' }],
    ['legBL', [2.6, 9, 2.6], [1.8, 9, 6], [0, -4.5, 0], '#7a7466', { anim: 'legB' }],
    ['legBR', [2.6, 9, 2.6], [-1.8, 9, 6], [0, -4.5, 0], '#7a7466', { anim: 'legA' }],
    ['tail', [2, 2, 4], [0, 12, 7.4], [0, 0, 2], '#4e4a42'],
  ],
};
// amber eyes with a slit pupil, a pink nose and a pale chin
FACES.gloamlynx = (c) => {
  c.fillStyle = '#17140f'; c.fillRect(1, 3, 5, 4); c.fillRect(10, 3, 5, 4);
  c.fillStyle = '#ffd05a'; c.fillRect(2, 4, 3, 2); c.fillRect(11, 4, 3, 2);
  c.fillStyle = '#17140f'; c.fillRect(3, 4, 1, 2); c.fillRect(12, 4, 1, 2);
  c.fillStyle = '#d88a8a'; c.fillRect(6, 9, 4, 2);
  c.fillStyle = '#e4ded0'; c.fillRect(4, 12, 8, 3);
};

// ---------------------------------------------------------------------------------------------
// Tarnling

function tarnAI(m, g, p, pdist) {
  const b = m.body, w = g.world;
  if (!m.home) m.home = { x: m.x, y: m.y, z: m.z };
  if (!b.inWater) {
    // out of the water it flops about, drying out slowly
    m.move = null;
    if (b.onGround && Math.random() < 0.1) { b.vy = 0.22; b.vx += (Math.random() - 0.5) * 0.14; b.vz += (Math.random() - 0.5) * 0.14; }
    if (++m.dry > TARN.DRY_TICKS && g.ticks % 20 === 0) m.hurt(1, 'drown');
    return;
  }
  m.dry = 0;
  if (!m.swimDir || Math.random() < 0.015 || b.horizontalCollision) {
    const a = Math.random() * TAU;
    m.swimDir = [Math.sin(a), (Math.random() - 0.5) * 0.3, Math.cos(a)];
  }
  const hx = m.home.x - m.x, hz = m.home.z - m.z, hd = Math.hypot(hx, hz);
  if (hd > TARN.HOME_RADIUS) { m.swimDir[0] = hx / hd; m.swimDir[2] = hz / hd; } // keeps to its own pond
  let k = 0.011;
  if (m.panicTicks > 0) { m.panicTicks--; k = 0.04; }
  else if (!p.dead && pdist < TARN.SHY && !p.sneaking) { // darts off from someone splashing about (still catchable if you creep up)
    const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz) || 1;
    m.swimDir = [dx / d, 0.05, dz / d]; k = 0.026;
  }
  const px = Math.floor(m.x), pz = Math.floor(m.z);
  if (!isWaterish(w.getBlock(px, Math.floor(m.y + m.height + 0.4), pz))) m.swimDir[1] = -Math.abs(m.swimDir[1]) - 0.1; // stays under the surface
  if (w.getBlock(px, Math.floor(m.y - 0.3), pz) && w.getBlock(px, Math.floor(m.y - 0.3), pz) !== B.WATER) m.swimDir[1] = Math.abs(m.swimDir[1]) + 0.1;
  b.vx += m.swimDir[0] * k; b.vy += m.swimDir[1] * k * 0.6 + 0.003; b.vz += m.swimDir[2] * k;
  m.yaw += wrap(Math.atan2(-m.swimDir[0], -m.swimDir[2]) - m.yaw) * 0.15;
  if (Math.random() < 1 / 600) g.audio.play('plip', [m.x, m.y + 0.2, m.z], 0.5);
  m.move = null;
}

function tarnRender(m, model, alpha, sec) {
  const pa = model.userData.parts;
  if (!pa || !pa.tail) return;
  const col = TARN_COLORS[(m.woolColor | 0) % TARN_COLORS.length];
  if (model.userData.coat !== m.woolColor) {
    model.userData.coat = m.woolColor;
    tint(pa, ['body', 'head', 'tail', 'legFL', 'legFR', 'legBL', 'legBR'], col[0]);
    tint(pa, ['belly', 'frillL', 'frillR'], col[1]);
  }
  const swim = m.body.inWater ? 1 : 0.3;
  pa.tail.rotation.y = Math.sin(sec * 11 * swim + m.id) * 0.5;
  pa.frillL.rotation.z = 0.3 + Math.sin(sec * 4 + m.id) * 0.15; pa.frillR.rotation.z = -pa.frillL.rotation.z;
}

MODELS.tarnling = {
  parts: [
    ['body', [3.4, 2.6, 6], [0, 2.4, 0.5], [0, 0, 0], '#6aa05a'],
    ['belly', [3, 0.8, 5], [0, 1.2, 0.5], [0, 0, 0], '#d8e8a8'],
    ['head', [3.8, 2.8, 3], [0, 2.6, -3], [0, 0, -1.2], '#fffffa', { face: 'tarnling' }],
    ['frillL', [1.8, 0.8, 1.2], [1.9, 3.6, -3.4], [0.9, 0, 0], '#d8e8a8'],
    ['frillR', [1.8, 0.8, 1.2], [-1.9, 3.6, -3.4], [-0.9, 0, 0], '#d8e8a8'],
    ['tail', [0.8, 2.6, 4.5], [0, 2.4, 3.4], [0, 0, 2.2], '#6aa05b'],
    ['legFL', [1, 1.4, 1], [1.8, 1.4, -1.6], [0, -0.7, 0], '#6aa05c', { anim: 'legA' }],
    ['legFR', [1, 1.4, 1], [-1.8, 1.4, -1.6], [0, -0.7, 0], '#6aa05c', { anim: 'legB' }],
    ['legBL', [1, 1.4, 1.4], [1.8, 1.4, 2.4], [0, -0.7, 0], '#6aa05d', { anim: 'legB' }],
    ['legBR', [1, 1.4, 1.4], [-1.8, 1.4, 2.4], [0, -0.7, 0], '#6aa05d', { anim: 'legA' }],
  ],
};
// two big dark eyes and a wide little smile
FACES.tarnling = (c) => {
  c.fillStyle = '#10140e'; c.fillRect(1, 3, 5, 5); c.fillRect(10, 3, 5, 5);
  c.fillStyle = '#f4f0d8'; c.fillRect(2, 4, 2, 2); c.fillRect(11, 4, 2, 2);
  c.fillStyle = '#2a3a22'; c.fillRect(4, 11, 8, 1); c.fillRect(3, 10, 1, 1); c.fillRect(12, 10, 1, 1);
};

// ---------------------------------------------------------------------------------------------
// definitions

export const THISTLEHORN = {
  name: 'Thistlehorn', role: 'deer', category: CATEGORY.CREATURE, sound: 'thistle', rideable: true,
  health: 14, tamedHealth: 20, speed: 0.22, width: 0.9, height: 1.6, panicSpeed: 1.7,
  drops: [{ id: I.LEATHER, min: 0, max: 2 }, { id: I.RAW_VENISON, min: 1, max: 3, cooked: I.COOKED_VENISON }],
  food: [I.BEETROOT, I.SWEET_BERRIES], tameFood: [I.BEETROOT, I.SWEET_BERRIES],
  // ridable once won over with its food (a chance each time), fitted with a Thistle Harness and a Saddle; it follows its owner, tires on
  // long rides and is fed back to strength (mobs/mounts.js)
  mount: { tack: true }, onDeath: mountDeath, saveExtra: mountSave, loadExtra: mountLoad,
  ownAI: thistleAI, onHurt: thistleHurt, customRender: thistleRender,
  onSpawn: (m) => { m.woolColor = Math.floor(Math.random() * THISTLE_COATS.length); m.saddled = false; m.temper = 0; m.fatigue = 0; m.jumpPower = 0.46 + Math.random() * 0.14; m.seatY = 0.8; },
};
export const DUSTMOLE = {
  name: 'Dustmole', role: 'meerkat', category: CATEGORY.CREATURE, sound: 'burrow', burrower: true,
  health: 6, speed: 0.16, width: 0.5, height: 0.45, panicSpeed: 1.6, noFallDamage: true,
  drops: [{ id: B.SAND, min: 1, max: 2 }, { id: I.FLINT, min: 0, max: 1 }, { id: I.CLAY_BALL, min: 0, max: 1, chance: 0.4 }],
  ownAI: moleAI, onHurt: moleHurt, customRender: moleRender, digDust: sandPuff,
  onSpawn: (m) => { m.persistent = false; m.special = false; m.emerging = 0; m.digging = 0; m.lost = 0; m.stray = 0; },
};
export const GLOAMLYNX = {
  name: 'Gloamlynx', role: 'lynx', category: CATEGORY.CREATURE, sound: 'yowl', spawnWhen: 'dusk', shy: true,
  health: 14, speed: 0.3, width: 0.7, height: 0.9, attack: 3, panicSpeed: 1.9, noFallDamage: true,
  drops: [{ id: I.LEATHER, min: 0, max: 2 }, { id: I.BONE, min: 0, max: 1 }, { id: I.RABBIT_HIDE, min: 0, max: 1 }],
  ownAI: lynxAI, customRender: lynxRender,
  onSpawn: (m) => { m.persistent = false; m.fleeTicks = 0; },
};
export const TARNLING = {
  name: 'Tarnling', role: 'tadpole', category: CATEGORY.CREATURE, sound: 'plip', bucketable: true, breathesWater: true,
  health: 3, speed: 0.1, width: 0.4, height: 0.3, noFallDamage: true,
  drops: [{ id: I.CLAY_BALL, min: 0, max: 1 }],
  ownAI: tarnAI, customRender: tarnRender,
  onSpawn: (m) => { m.persistent = false; m.dry = 0; m.woolColor = Math.floor(Math.random() * TARN_COLORS.length); },
  saveExtra: (m) => ({ pond: m.persistent ? 1 : undefined }), // one let go from a bucket stays; the wild ones come and go with the chunks
  loadExtra: (m, s) => { if (s.pond) m.persistent = true; },
};
for (const [k, d] of [['thistlehorn', THISTLEHORN], ['dustmole', DUSTMOLE], ['gloamlynx', GLOAMLYNX], ['tarnling', TARNLING]]) {
  if (!MOBS[k]) { MOBS[k] = d; MOB_KEYS.push(k); }
}

// ---------------------------------------------------------------------------------------------
// the bucket

/** The full bucket for a caught Tarnling (its colour rides in `damage`, which a one-off bucket has no other use for). */
export const tarnlingBucket = (mob) => ({ id: I.TARNLING_BUCKET, count: 1, damage: (mob.woolColor | 0) % TARN_COLORS.length });

/** Right-click a Tarnling with an empty Bucket: scoop it up. Returns true when it did. `p` is the player (or a guest's stand-in on the host). */
export function catchTarnling(g, mob, p, st, swing = () => {}) {
  if (!st || st.id !== I.BUCKET || !mob.def.bucketable || mob.deathTime > 0 || mob.removed || mob.age < 0) return false;
  const full = tarnlingBucket(mob);
  p.inventory.removeFromSlot(p.inventory.selected, 1);
  if (!p.inventory.selectedStack) p.inventory.slots[p.inventory.selected] = full;
  else {
    const left = p.isRemotePlayer ? full.count : p.inventory.add(full);
    if (left) g.entities.spawnItem(p.x, p.y + 1, p.z, full);
  }
  p.inventory.changed();
  mob.removed = true; mob.dead = true;
  g.audio.play('bucket_fill', [mob.x, mob.y + 0.3, mob.z]);
  g.audio.play('plip', [mob.x, mob.y + 0.3, mob.z], 0.8);
  swing();
  return true;
}

/** The water has been poured out of a Bucket of Tarnling at this cell: let the Tarnling go. */
export function releaseTarnling(g, x, y, z, color = 0) {
  const m = g.spawner.spawnMob('tarnling', x + 0.5, y + 0.05, z + 0.5);
  if (m) { m.woolColor = (color | 0) % TARN_COLORS.length; m.persistent = true; m.home = { x: x + 0.5, y, z: z + 0.5 }; }
  return m;
}

// ---------------------------------------------------------------------------------------------
// spawning (Dustmoles and Tarnlings; Thistlehorns and Gloamlynxes go through the spawn tables)

/** Habitat check for a Tarnling pond cell. */
export function tarnSpot(w, x, z, solid = (id) => SOLID[id]) {
  if (!w.isLoaded(x, z)) return null;
  const biome = BIOMES[w.biomeAt(x, z)];
  if (!biome || !TARN_BIOMES.has(biome.key)) return null;
  const y = w.heightAt(x, z);
  const d = tarnDepth(w, x, y, z, solid);
  return d ? { x, y: y - Math.min(d - 1, 1), z, depth: d } : null;
}

/** Habitat check for a Dustmole: sand with room above, in a desert or badlands. */
export function moleSpot(w, x, z) {
  if (!w.isLoaded(x, z)) return null;
  const biome = BIOMES[w.biomeAt(x, z)];
  if (!biome || !MOLE_BIOMES.has(biome.key)) return null;
  const y = w.heightAt(x, z);
  if (!SANDS.has(w.getBlock(x, y, z)) || w.getBlock(x, y + 1, z) || w.getBlock(x, y + 2, z)) return null;
  return { x, y: y + 1, z };
}

/** Called from MobSpawner.tick (host, overworld, spawning enabled). A few cheap tries a second at most. */
export function faunaTick(spawner, rng = Math.random) {
  const g = spawner.game, w = g.world, p = g.player;
  if (g.ticks % 60 !== 17 || p.dead || (w.dimension && w.dimension !== 'overworld')) return;
  let moles = 0, tarns = 0;
  for (const e of g.entities.list) { if (e.type === 'dustmole' && !e.dead) moles++; else if (e.type === 'tarnling' && !e.dead) tarns++; }
  const a = rng() * TAU, r = 12 + rng() * 28;
  const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
  if (moles < MOLE.MAX && rng() < 0.6) {
    const s = moleSpot(w, x, z);
    if (s && spawner.canFit('dustmole', s.x, s.y, s.z)) {
      const m = spawner.spawnMob('dustmole', s.x + 0.5, s.y, s.z + 0.5);
      if (m) { m.special = true; m.until = g.ticks + MOLE.HIDE_MIN + Math.floor(rng() * 200); }
    }
  }
  if (tarns < TARN.MAX && rng() < 0.4) {
    const s = tarnSpot(w, x, z);
    if (s) for (let i = 0, n = 1 + Math.floor(rng() * 3); i < n; i++) spawner.spawnMob('tarnling', s.x + 0.5 + (rng() - 0.5) * 0.8, s.y + 0.1, s.z + 0.5 + (rng() - 0.5) * 0.8);
  }
}
