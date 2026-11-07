// The ocean depths and the cloud isles get three mobs (this module registers itself into MOBS, like mobs/fauna.js):
//
//  Lanternfin (reference: anglerfish)  a small deep-sea fish with a glowing lure. Schools drift over the Deep Ocean floor and in
//      trenches and their lures are the only light there. Drops Raw Lanternfin (a little night vision) and, half the time, a Lantern
//      Gland, the heart of a Diver's Lamp and a Diver's Helm.
//  Trenchmaw (reference: moray eel / deep-sea predator)  a long, dark eel that lurks in trenches and Abyssal Grottos. It hangs about its
//      den, notices a swimmer in the dark and lunges: a quick dash, a bite, then a pause. A bright light frightens it off: a Diver's Lamp
//      held up (a lit lantern too) keeps it ten blocks away, the lamp of a Diver's Helm five.
//  Skyray (reference: manta ray / phantom, but gentle)  a broad, pale glider that circles the Cloud Isles high above the land. It never
//      attacks. Drops Drift Membrane and feathers.
//
// Natural spawns: `oceanSkyTick` (called from MobSpawner.tick; a cheap try every couple of seconds) places Lanternfins over the deep
// floor, Trenchmaws in dark trenches and Skyrays near isles; `oceanSkyChunkSpawn` places the grotto Trenchmaws and the isle Skyrays
// once when their chunks are made. Everything is simulated on the host; guests see the mobs through the ordinary snapshots.
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { I } from '../world/items.js';
import { lampLevel } from '../player/diving.js';
import { B, SOLID, isWaterish } from '../world/blocks.js';
import { BIOME } from '../world/biomes.js';
import { SEA_LEVEL } from '../world/constants.js';
import { grottosNear, grottoGuardSpots, DEEP_TOP } from '../world/deepSea.js';
import { isleNear, isleRaySpots, nearestIsle } from '../world/skyIsles.js';

const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

export const MAW = { DETECT: 16, LUNGE_RANGE: 6, BITE_REACH: 1.7, DAMAGE: 4, COOLDOWN: 50, HOME: 12, DASH: 0.42, MAX: 4 };
export const RAY = { ORBIT_MIN: 11, ORBIT_MAX: 19, CLIMB: 9, MAX: 4, NEAR: 90 };
export const FIN = { MAX: 10, SCHOOL: 5 };

/** Light level (0-15) a player carries underwater: the held item, or the brow lamp of a Diver's Helm. */
export const playerLamp = (p) => lampLevel(p && p.inventory);

/** How far a Trenchmaw keeps from a swimmer carrying this much light (0 = not frightened). */
export function lampScareRange(level) { return level >= 13 ? 10 : level >= 10 ? 5 : 0; }

/** May a Trenchmaw lunge at a target `d` blocks away carrying `lamp` light? */
export function mawMayLunge(d, lamp, cooldown) { return cooldown <= 0 && d <= MAW.LUNGE_RANGE && d > lampScareRange(lamp); }

// ---------------------------------------------------------------------------------------------
// Trenchmaw

function inWaterAt(w, x, y, z) { return isWaterish(w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))); }

function mawAI(m, g, p) {
  const b = m.body, w = g.world;
  m.cooldown = m.cooldown > 0 ? m.cooldown - 1 : 0;
  if (!m.home) m.home = { x: m.x, y: m.y, z: m.z };
  if (!b.inWater) {
    // stranded: it thrashes about and suffocates slowly
    m.move = null;
    if (b.onGround && Math.random() < 0.1) { b.vy = 0.3; b.vx += (Math.random() - 0.5) * 0.3; b.vz += (Math.random() - 0.5) * 0.3; }
    if (g.ticks % 20 === 0) m.hurt(1, 'drown');
    return;
  }
  b.vy += 0.005; // (neutral buoyancy)
  const swimmer = !p.dead && !p.creative && !(p.effects && p.effects.invisibility) && (p.body.inWater || p.body.eyeInWater);
  const dx = p.x - m.x, dy = p.y + 0.9 - (m.y + m.height * 0.5), dz = p.z - m.z, d = Math.hypot(dx, dy, dz);
  const lamp = playerLamp(p);
  const scare = lampScareRange(lamp);
  let tx = m.home.x, ty = m.home.y, tz = m.home.z, k = 0.012;
  if (swimmer && d < MAW.DETECT && m.canSee(g, p.x, p.y + 0.9, p.z)) {
    m.target = 'player';
    if (d <= scare) { // the light frightens it: it backs off into the dark
      tx = m.x - dx; ty = m.y - dy * 0.3; tz = m.z - dz; k = 0.03;
    } else if (m.dash > 0) {
      m.dash--;
      tx = p.x; ty = p.y + 0.9; tz = p.z; k = MAW.DASH * 0.25;
      if (d < MAW.BITE_REACH && m.cooldown <= 0) {
        if (p.hurt(MAW.DAMAGE, 'mob:' + m.def.name, m)) g.audio.play('maw', [m.x, m.y, m.z], 0.8);
        m.cooldown = MAW.COOLDOWN; m.dash = 0; m.retreat = 24;
      }
    } else if (m.retreat > 0) {
      m.retreat--;
      tx = m.x - dx; ty = m.y; tz = m.z - dz; k = 0.02;
    } else if (mawMayLunge(d, lamp, m.cooldown)) {
      m.dash = 14; g.audio.play('maw', [m.x, m.y, m.z], 0.6);
    } else {
      tx = p.x; ty = p.y + 0.5; tz = p.z; k = 0.016; // creeps closer
    }
  } else {
    m.target = null;
    // lurking: it drifts about its den
    if (!m.swim || --m.swim.t <= 0 || b.horizontalCollision) {
      const a = Math.random() * TAU, r = Math.random() * MAW.HOME;
      m.swim = { x: m.home.x + Math.cos(a) * r, y: m.home.y + (Math.random() - 0.5) * 3, z: m.home.z + Math.sin(a) * r, t: 60 + Math.floor(Math.random() * 80) };
    }
    tx = m.swim.x; ty = m.swim.y; tz = m.swim.z; k = 0.007;
  }
  const ex = tx - m.x, ey = ty - m.y, ez = tz - m.z, l = Math.hypot(ex, ey, ez) || 1;
  b.vx += ex / l * k; b.vy += ey / l * k * 0.7; b.vz += ez / l * k;
  // keep to the water
  if (!inWaterAt(w, m.x, m.y + m.height + 0.3, m.z) && b.vy > 0) b.vy *= 0.2;
  m.yaw += wrap(Math.atan2(-ex, -ez) - m.yaw) * 0.12;
  m.headPitch = 0;
  m.move = null;
}

function mawRender(m, mesh, alpha, sec) {
  const pa = mesh.userData.parts; if (!pa || !pa.tail) return;
  const sp = m.target ? 9 : 4, ph = sec * sp + m.id;
  pa.body2.rotation.y = Math.sin(ph) * 0.25;
  pa.body3.rotation.y = Math.sin(ph - 0.8) * 0.4;
  pa.tail.rotation.y = Math.sin(ph - 1.6) * 0.55;
  pa.jaw.rotation.x = m.target ? 0.5 + Math.sin(sec * 10 + m.id) * 0.1 : 0.12 + Math.sin(sec * 2 + m.id) * 0.06;
}

MODELS.trenchmaw = {
  parts: [
    ['head', [6, 5, 7], [0, 5, -11], [0, 0, 0], '#2c2f45', { face: 'trenchmaw' }],
    ['jaw', [5, 1.6, 6], [0, 3.2, -9], [0, 0, -3], '#3a3d58'],
    ['body', [6, 6, 10], [0, 5, -4], [0, 0, 0], '#2c2f45'],
    ['body2', [5, 5, 10], [0, 5, 3], [0, 0, 5], '#2a2c40'],
    ['body3', [4, 4, 9], [0, 5, 13], [0, 0, 4], '#26283a'],
    ['tail', [1.6, 5, 8], [0, 5, 22], [0, 0, 4], '#26283a'],
    ['fin', [1, 3, 14], [0, 9, -2], [0, 0, 0], '#4a4e72'],
    ['belly', [5, 1, 9], [0, 2.2, -4], [0, 0, 0], '#8a8aa8'],
  ],
};
// small cold yellow eyes, a wide mouth full of teeth
FACES.trenchmaw = (c) => {
  c.fillStyle = '#ffd84a'; c.fillRect(2, 3, 3, 3); c.fillRect(11, 3, 3, 3);
  c.fillStyle = '#100c0c'; c.fillRect(3, 4, 1, 2); c.fillRect(12, 4, 1, 2);
  c.fillStyle = '#100c0c'; c.fillRect(2, 9, 12, 4);
  c.fillStyle = '#f0ecd8'; for (let x = 2; x < 14; x += 2) { c.fillRect(x, 9, 1, 2); c.fillRect(x + 1, 11, 1, 2); }
};

// ---------------------------------------------------------------------------------------------
// Lanternfin

/** A school of Lanternfins: the ordinary fish AI, kept down near the floor (1 to 8 blocks over it) instead of drifting up to the surface. */
function finAI(m, g, p, pdist) {
  m.fishAI(g, p, pdist);
  const b = m.body, w = g.world;
  if (!b.inWater) return;
  const x = Math.floor(m.x), z = Math.floor(m.z);
  let y = Math.floor(m.y), k = 0;
  while (k++ < 16 && isWaterish(w.getBlock(x, y - 1, z))) y--;
  const h = m.y - y;
  b.vy += h > 8 ? -0.015 : h < 1.2 ? 0.015 : 0;
}

function finRender(m, mesh, alpha, sec) {
  const pa = mesh.userData.parts; if (!pa || !pa.tail) return;
  pa.tail.rotation.y = Math.sin(sec * 10 + m.id) * 0.5;
  pa.stalk.rotation.x = -0.5 + Math.sin(sec * 3 + m.id) * 0.12;
}

MODELS.lanternfin = {
  parts: [
    ['body', [5, 5, 8], [0, 4, 0], [0, 0, 0], '#27405a'],
    ['head', [5, 5, 4], [0, 4, -4], [0, 0, -2], '#2d4a68', { face: 'lanternfin' }],
    ['stalk', [0.8, 0.8, 5], [0, 7, -5], [0, 1, -2.5], '#1c2e42'],
    ['bulb', [2.2, 2.2, 2.2], [0, 7, -5], [0, 1.5, -6], '#ffe27a', { emissive: '#ffd24a' }],
    ['tail', [1, 4, 4], [0, 4, 4], [0, 0, 2], '#27405a'],
    ['finL', [3, 1, 2], [2.5, 3, 0], [1.5, 0, 0], '#3a5c7e'],
    ['finR', [3, 1, 2], [-2.5, 3, 0], [-1.5, 0, 0], '#3a5c7e'],
  ],
};
FACES.lanternfin = (c) => {
  c.fillStyle = '#f4f0d0'; c.fillRect(2, 4, 3, 3); c.fillRect(11, 4, 3, 3);
  c.fillStyle = '#0a0e14'; c.fillRect(3, 5, 1, 2); c.fillRect(12, 5, 1, 2);
  c.fillStyle = '#0a0e14'; c.fillRect(3, 10, 10, 2);
  c.fillStyle = '#e8e8dc'; for (let x = 3; x < 13; x += 2) c.fillRect(x, 10, 1, 1);
};

// ---------------------------------------------------------------------------------------------
// Skyray

/** Where a Skyray at angle `a` round `home` wants to be: a ring that rises and falls. */
export function rayRingPoint(home, a, radius, sec = 0) {
  return { x: home.x + Math.cos(a) * radius, y: home.y + RAY.CLIMB + Math.sin(a * 2 + sec * 0.3) * 3, z: home.z + Math.sin(a) * radius };
}

function rayAI(m, g, p) {
  const b = m.body, w = g.world;
  if (!m.home) m.home = { x: m.x, y: m.y - RAY.CLIMB, z: m.z };
  if (m.ringR === undefined) { m.ringR = RAY.ORBIT_MIN + Math.random() * (RAY.ORBIT_MAX - RAY.ORBIT_MIN); m.ringA = Math.random() * TAU; m.ringDir = Math.random() < 0.5 ? 1 : -1; }
  m.ringA += m.ringDir * 0.012;
  let pt = rayRingPoint(m.home, m.ringA, m.ringR, g.ticks / 20);
  let k = 0.014;
  if (m.panicTicks > 0) { m.panicTicks--; pt = { x: m.x + (m.x - p.x) * 3, y: m.y + 6, z: m.z + (m.z - p.z) * 3 }; k = 0.03; }
  const dx = pt.x - m.x, dy = pt.y - m.y, dz = pt.z - m.z, l = Math.hypot(dx, dy, dz) || 1;
  b.vx += dx / l * k; b.vy += dy / l * k * 0.6; b.vz += dz / l * k;
  if (b.horizontalCollision) b.vy += 0.04;
  if (SOLID[w.getBlock(Math.floor(m.x), Math.floor(m.y - 0.6), Math.floor(m.z))]) b.vy += 0.03;
  const sp = Math.hypot(b.vx, b.vz);
  if (sp > 0.02) m.yaw += wrap(Math.atan2(-b.vx, -b.vz) - m.yaw) * 0.1;
  m.headPitch = 0;
  m.move = null;
  if (Math.random() < 1 / 900) g.audio.play('skyray', [m.x, m.y, m.z], 0.5);
}

function rayRender(m, mesh, alpha, sec) {
  const pa = mesh.userData.parts; if (!pa || !pa.wingL) return;
  const f = Math.sin(sec * 2.2 + m.id) * 0.35;
  pa.wingL.rotation.z = f; pa.wingR.rotation.z = -f;
  pa.tail.rotation.y = Math.sin(sec * 1.6 + m.id) * 0.3;
  mesh.rotation.z = Math.max(-0.4, Math.min(0.4, (m.ringDir || 0) * -0.25)); // banks into its turn
}

MODELS.skyray = {
  parts: [
    ['body', [8, 2.5, 12], [0, 4, 0], [0, 0, 0], '#e6ecf8'],
    ['belly', [6, 0.6, 10], [0, 2.8, 0], [0, 0, 0], '#9fb4d8'],
    ['head', [5, 2.5, 4], [0, 4, -7], [0, 0, -1], '#f4f6fc', { face: 'skyray' }],
    ['wingL', [12, 0.9, 14], [4, 4, 0], [6, 0, 1], '#d4def2'],
    ['wingR', [12, 0.9, 14], [-4, 4, 0], [-6, 0, 1], '#d4def2'],
    ['tail', [1, 1, 14], [0, 4, 6], [0, 0, 7], '#c4d0ea'],
  ],
};
FACES.skyray = (c) => {
  c.fillStyle = '#1a2238'; c.fillRect(2, 5, 3, 3); c.fillRect(11, 5, 3, 3);
  c.fillStyle = '#ffffff'; c.fillRect(2, 5, 1, 1); c.fillRect(11, 5, 1, 1);
  c.fillStyle = '#9fb4d8'; c.fillRect(6, 11, 4, 1);
};

// ---------------------------------------------------------------------------------------------
// definitions

export const LANTERNFIN = {
  name: 'Lanternfin', role: 'anglerfish', category: CATEGORY.AMBIENT, fish: true, aquatic: true, deepSea: true, sound: 'lumen', noFallDamage: true,
  health: 6, speed: 0.1, width: 0.6, height: 0.5, sinks: true, // (sinks: no automatic swimming up; finAI holds the depth)
  drops: [{ id: I.RAW_LANTERNFIN, min: 1, max: 1, cooked: I.COOKED_LANTERNFIN }, { id: I.LANTERN_GLAND, min: 0, max: 1, chance: 0.5 }],
  ownAI: finAI, customRender: finRender,
};
export const TRENCHMAW = {
  name: 'Trenchmaw', role: 'moray eel', category: CATEGORY.MONSTER, deepSea: true, breathesWater: true, sound: 'maw', noFallDamage: true,
  health: 24, speed: 0.14, width: 1.1, height: 0.6, attack: MAW.DAMAGE, sinks: true,
  drops: [{ id: I.BONE, min: 0, max: 2 }, { id: I.LANTERN_GLAND, min: 0, max: 1, chance: 0.2 }, { id: I.TIDE_SHARD, min: 0, max: 1, chance: 0.3 }],
  ownAI: mawAI, customRender: mawRender,
  onSpawn: (m) => { m.persistent = false; m.dash = 0; m.retreat = 0; m.cooldown = 0; },
};
export const SKYRAY = {
  name: 'Skyray', role: 'manta ray', category: CATEGORY.AMBIENT, flying: true, glider: true, sound: 'skyray', noFallDamage: true,
  health: 14, speed: 0.12, width: 1.6, height: 0.5,
  drops: [{ id: I.DRIFT_MEMBRANE, min: 0, max: 2 }, { id: I.FEATHER, min: 1, max: 3 }],
  ownAI: rayAI, customRender: rayRender,
  onSpawn: (m) => { m.persistent = false; m.panicTicks = 0; },
};
for (const [k, d] of [['lanternfin', LANTERNFIN], ['trenchmaw', TRENCHMAW], ['skyray', SKYRAY]]) {
  if (!MOBS[k]) { MOBS[k] = d; MOB_KEYS.push(k); }
}

/** Biome keys each mob is placed in (the Field Guide lists them as habitats). */
export const OCEAN_SKY_HABITATS = {
  lanternfin: ['deep_ocean'],
  trenchmaw: ['deep_ocean'],
};

// ---------------------------------------------------------------------------------------------
// spawning

const countOf = (g, type) => { let n = 0; for (const e of g.entities.list) if (e.type === type && !e.dead) n++; return n; };

/** A water cell at (x, floor + 1 .. floor + dy) with three clear water blocks above the floor, or null. */
function waterSpot(w, x, z, dyMax = 4) {
  if (!w.isLoaded(x, z)) return null;
  let floor = w.heightAt(x, z); // (the height map counts the water, so walk down to the sea floor)
  for (let k = 0; k < 80 && isWaterish(w.getBlock(x, floor, z)); k++) floor--;
  const y = floor + 1 + Math.floor(Math.random() * dyMax);
  for (let k = 0; k < 3; k++) if (w.getBlock(x, y + k, z) !== B.WATER) return null;
  return { x, y, z, floor };
}

/** Called from MobSpawner.tick (host, overworld). A cheap try now and then. */
export function oceanSkyTick(spawner, rng = Math.random) {
  const g = spawner.game, w = g.world, p = g.player;
  if (p.dead || (w.dimension && w.dimension !== 'overworld')) return;
  if (g.ticks % 50 === 11) {
    const a = rng() * TAU, r = 14 + rng() * 26;
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    const biome = w.isLoaded(x, z) ? w.biomeAt(x, z) : -1;
    if (biome === BIOME.DEEP_OCEAN) {
      const s = waterSpot(w, x, z, 5);
      if (s) {
        if (countOf(g, 'lanternfin') < FIN.MAX && rng() < 0.7) for (let i = 0, n = 3 + Math.floor(rng() * 3); i < n; i++) spawner.spawnMob('lanternfin', s.x + 0.5 + (rng() - 0.5) * 2, s.y, s.z + 0.5 + (rng() - 0.5) * 2);
        // trench floors (and the deepest basins) are dark enough for a Trenchmaw
        else if (s.floor <= DEEP_TOP - 14 && spawner.hostileEnabled() && countOf(g, 'trenchmaw') < MAW.MAX && rng() < 0.3 && w.skyLight(s.x, s.y, s.z) <= 4 && w.blockLight(s.x, s.y, s.z) <= 5) {
          const m = spawner.spawnMob('trenchmaw', s.x + 0.5, s.floor + 1.2, s.z + 0.5);
          if (m) m.home = { x: s.x + 0.5, y: s.floor + 2, z: s.z + 0.5 };
        }
      }
    }
  }
  if (g.ticks % 120 === 47 && p.y > 90 && countOf(g, 'skyray') < RAY.MAX) {
    const isle = nearestIsle(w.gen, p.x, p.z, 1);
    if (isle && Math.hypot(isle.cx - p.x, isle.cz - p.z) < RAY.NEAR) {
      const spots = isleRaySpots(isle), sp = spots[Math.floor(rng() * spots.length)];
      if (w.isLoaded(Math.floor(sp.x), Math.floor(sp.z))) {
        const m = spawner.spawnMob('skyray', sp.x, sp.y, sp.z);
        if (m) m.home = { x: isle.cx, y: isle.y, z: isle.cz };
      }
    }
  }
}

/** Once, when chunk (cx, cz) is made: the Trenchmaws of Abyssal Grottos and the first Skyrays of Cloud Isles. */
export function oceanSkyChunkSpawn(spawner, cx, cz) {
  const gen = spawner.game.world.gen, X0 = cx * 16, Z0 = cz * 16;
  const inChunk = (x, z) => Math.floor(x / 16) === cx && Math.floor(z / 16) === cz;
  if (spawner.hostileEnabled()) {
    for (const gr of grottosNear(gen, X0, Z0, X0 + 15, Z0 + 15)) for (const [x, y, z] of grottoGuardSpots(gr)) {
      if (!inChunk(x, z)) continue;
      const m = spawner.spawnMob('trenchmaw', x + 0.5, y, z + 0.5);
      if (m) { m.persistent = true; m.home = { x: gr.cx + 0.5, y: gr.y + 3, z: gr.cz + 0.5 }; }
    }
  }
  for (const s of isleNear(gen, X0, Z0, X0 + 15, Z0 + 15)) for (const sp of isleRaySpots(s)) {
    if (!inChunk(sp.x, sp.z)) continue;
    const m = spawner.spawnMob('skyray', sp.x, sp.y, sp.z);
    if (m) m.home = { x: s.cx, y: s.y, z: s.cz };
  }
}
