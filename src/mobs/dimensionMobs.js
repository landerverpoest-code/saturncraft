// Mobs of the Cinderdeep and the Hollow, registered into MOBS with their own
// AI (Mob.ai calls def.customAI):
//  * Ashwraith  (ghast-like)  - huge drifting shroud that spits exploding fireballs
//  * Cinder Brute (fire-immune melee brute)
//  * Ember Lord (blaze-like)  - hovers and fires volleys of small fireballs; drops Ember Rods
//  * Mending Crystal          - sits on the Hollow's pillars and heals the Void Wyrm
//  * Void Wyrm (the boss, see voidWyrm.js)
// plus the natural spawn tables of both dimensions.
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { I } from '../world/items.js';
import { B, SOLID, OPAQUE, isFluid } from '../world/blocks.js';
import { SPAWNER_TYPES } from './spawnerBlocks.js';
import { Fireball } from '../entities/fireball.js';
import { weightedPick, scaledCap, SPAWN_MIN_DIST, DESPAWN_FAR } from './spawnRules.js';
import { wyrmAI, wyrmRender, wyrmDeath, wyrmHurt } from './voidWyrm.js';

const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const faceTowards = (m, x, z, k = 0.3) => { m.yaw += wrap(Math.atan2(-(x - m.x), -(z - m.z)) - m.yaw) * k; };

/** Shoot a fireball from (x, y, z) towards the player's body. */
function fireAt(g, m, x, y, z, speed, opts, spread = 0) {
  const p = g.player;
  const tx = p.x + (Math.random() - 0.5) * spread, ty = p.y + p.body.height * 0.5, tz = p.z + (Math.random() - 0.5) * spread;
  const dx = tx - x, dy = ty - y, dz = tz - z, l = Math.hypot(dx, dy, dz) || 1;
  g.entities.add(new Fireball(x, y, z, dx / l * speed, dy / l * speed, dz / l * speed, m, opts));
}

/** Drift a flying mob towards a point with the given acceleration (velocity is damped by flyMove). */
function flyTowards(m, x, y, z, accel) {
  const b = m.body, dx = x - m.x, dy = y - m.y, dz = z - m.z, l = Math.hypot(dx, dy, dz);
  if (l < 0.5) return true;
  b.vx += dx / l * accel; b.vy += dy / l * accel; b.vz += dz / l * accel;
  return false;
}

function groundBelow(g, x, y, z, max = 24) {
  for (let k = 0; k < max; k++) if (SOLID[g.world.getBlock(Math.floor(x), Math.floor(y) - k, Math.floor(z))]) return Math.floor(y) - k + 1;
  return null;
}

function ashwraithAI(m, g, p, pdist) {
  const b = m.body;
  if (!m.fly || m.flyTimer-- <= 0 || b.horizontalCollision || Math.hypot(m.fly.x - m.x, m.fly.y - m.y, m.fly.z - m.z) < 1.5) {
    m.flyTimer = 60 + Math.floor(Math.random() * 120);
    m.fly = { x: m.x + (Math.random() - 0.5) * 32, y: Math.max(36, Math.min(110, m.y + (Math.random() - 0.5) * 14)), z: m.z + (Math.random() - 0.5) * 32 };
  }
  flyTowards(m, m.fly.x, m.fly.y, m.fly.z, 0.012);
  m.charge = m.charge || 0;
  const sees = !p.dead && !p.creative && pdist < 64 && g.ticks % 2 === 0 ? m.canSee(g, p.x, p.y + p.eyeHeight, p.z) : m._sees;
  m._sees = sees;
  if (sees && !p.dead && !p.creative && pdist < 64) {
    faceTowards(m, p.x, p.z, 0.4);
    m.charge++;
    m.angry = m.charge > 10;
    if (m.charge === 10) g.audio.play('scream', [m.x, m.y + 2, m.z], 0.8);
    if (m.charge >= 20) {
      const [lx, , lz] = [-Math.sin(m.yaw), 0, -Math.cos(m.yaw)];
      fireAt(g, m, m.x + lx * 2.4, m.y + 2.2, m.z + lz * 2.4, 0.9, { power: 1, size: 0.5 });
      m.charge = -40;
    }
  } else {
    m.angry = false;
    if (m.charge > 0) m.charge--;
    if (Math.hypot(b.vx, b.vz) > 0.01) m.yaw = Math.atan2(-b.vx, -b.vz);
  }
  if (Math.random() < 1 / 300) g.audio.play('scream', [m.x, m.y + 2, m.z], 0.35);
}

function emberLordAI(m, g, p, pdist) {
  const b = m.body;
  const ground = groundBelow(g, m.x, m.y, m.z) ?? m.y - 10;
  let hoverY = ground + 1.5 + Math.sin((g.ticks + m.id) * 0.05) * 0.8;
  const has = m.acquire(g, p, pdist, 48);
  if (has) {
    hoverY = Math.max(hoverY, p.y + 1.5);
    faceTowards(m, p.x, p.z, 0.5);
    const d = Math.hypot(p.x - m.x, p.z - m.z);
    if (d > 9) { const l = d || 1; b.vx += (p.x - m.x) / l * 0.02; b.vz += (p.z - m.z) / l * 0.02; }
    else if (d < 4) { b.vx -= (p.x - m.x) / d * 0.015; b.vz -= (p.z - m.z) / d * 0.015; }
    m.tryMelee(g, p);
    // volleys: 3 fireballs 6 ticks apart, every 5 s
    m.volley = (m.volley ?? 60) - 1;
    if (m.volley <= 0 && m.canSee(g, p.x, p.y + 1, p.z)) {
      const k = -m.volley;
      if (k === 0 || k === 6 || k === 12) {
        fireAt(g, m, m.x, m.y + 1.4, m.z, 0.75, { power: 0, damage: 5, size: 0.2 }, Math.min(3, d / 6));
        g.audio.play('ignite', [m.x, m.y + 1, m.z], 0.7);
      }
      m.angry = true;
      if (k >= 12) { m.volley = 100; m.angry = false; }
    }
  } else if (Math.random() < 1 / 80) {
    b.vx += (Math.random() - 0.5) * 0.2; b.vz += (Math.random() - 0.5) * 0.2;
  }
  b.vy += (hoverY - m.y) * 0.02 - b.vy * 0.05;
  if (Math.random() < 0.4) g.particles.flame(m.x + (Math.random() - 0.5) * 0.8, m.y + Math.random() * 1.6, m.z + (Math.random() - 0.5) * 0.8);
}

function crystalAI(m, g) {
  const b = m.body;
  b.vx = b.vy = b.vz = 0;
  if (Math.random() < 0.08) g.particles.emit(m.x + (Math.random() - 0.5), m.y + 0.5 + Math.random(), m.z + (Math.random() - 0.5), 0, 0.02, 0, 1, 0.6, 1, 20, -0.001);
}

function crystalDeath(m, g) {
  m.removed = true; m.dead = true; // shatters at once
  g.explode(m.x, m.y + 0.5, m.z, 4, m);
  if (g.dims) g.dims.onCrystalDestroyed(m);
}

export const DIMENSION_MOBS = {
  ashwraith: {
    name: 'Ashwraith', role: 'ghast', category: CATEGORY.MONSTER,
    health: 10, speed: 0.1, width: 4, height: 4, followRange: 64, sound: 'warble',
    flying: true, fireImmune: true, noFallDamage: true, customAI: ashwraithAI,
    drops: [{ id: I.GUNPOWDER, min: 0, max: 2 }, { id: I.WRAITH_TEAR, min: 0, max: 1 }],
  },
  cinder_brute: {
    name: 'Cinder Brute', role: 'piglin brute', category: CATEGORY.MONSTER,
    health: 24, speed: 0.24, width: 0.8, height: 2.1, attack: 5, followRange: 24, armor: 4, sound: 'grunt',
    fireImmune: true, customAI: (m, g, p, pd) => m.meleeAI(g, p, pd),
    drops: [{ id: I.GOLD_INGOT, min: 0, max: 1 }, { id: I.ROTTEN_FLESH, min: 0, max: 1 }],
  },
  ember_lord: {
    name: 'Ember Lord', role: 'blaze', category: CATEGORY.MONSTER,
    health: 20, speed: 0.23, width: 0.6, height: 1.8, attack: 6, followRange: 48, sound: 'fire',
    flying: true, fireImmune: true, noFallDamage: true, customAI: emberLordAI,
    drops: [{ id: I.EMBER_ROD, min: 0, max: 1, playerOnly: true }],
  },
  void_crystal: {
    name: 'Mending Crystal', role: 'end crystal', category: CATEGORY.MONSTER,
    health: 1, speed: 0, width: 1.2, height: 1.6, sound: 'click',
    flying: true, noclip: true, fireImmune: true, noFallDamage: true, noDespawn: true, customAI: crystalAI, onDeath: crystalDeath,
    drops: [],
  },
  void_wyrm: {
    name: 'Void Wyrm', role: 'ender dragon', category: CATEGORY.MONSTER, boss: true,
    health: 200, speed: 0.6, width: 3.2, height: 2.2, attack: 10, followRange: 160, sound: 'scream',
    flying: true, noclip: true, fireImmune: true, noFallDamage: true, noDespawn: true,
    customAI: wyrmAI, customRender: wyrmRender, onDeath: wyrmDeath, onHurt: wyrmHurt,
    drops: [],
  },
};
for (const [k, d] of Object.entries(DIMENSION_MOBS)) { if (!MOBS[k]) { MOBS[k] = d; MOB_KEYS.push(k); } }
// Ember Lord spawners stand on Ember Bastions (spawner meta 3)
if (!SPAWNER_TYPES.includes('ember_lord')) SPAWNER_TYPES.push('ember_lord');

// ---- natural spawning ----------------------------------------------------------
export const DIM_SPAWN_TABLES = {
  cinderdeep: [
    { type: 'cinder_brute', weight: 100, min: 2, max: 4 },
    { type: 'ashwraith', weight: 40, min: 1, max: 1 },
    { type: 'ember_lord', weight: 6, min: 1, max: 2 },
  ],
  bastion: [
    { type: 'ember_lord', weight: 60, min: 2, max: 3 },
    { type: 'cinder_brute', weight: 40, min: 1, max: 3 },
  ],
  hollow: [{ type: 'voidwalker', weight: 100, min: 1, max: 4 }],
};
const DIM_Y = { cinderdeep: [32, 120], hollow: [20, 120] };
const NO_FLOOR = new Set([B.BEDROCK, B.OBSIDIAN, B.GLOWSHARD]);

/** One natural spawn attempt in chunk (cx, cz) of a non-overworld dimension. */
export function attemptDimensionSpawn(spawner, cx, cz, category) {
  const g = spawner.game, w = g.world, p = g.player, dim = w.dimension;
  if (category !== CATEGORY.MONSTER || !DIM_SPAWN_TABLES[dim]) return 0;
  const [y0, y1] = DIM_Y[dim];
  let x = cx * 16 + Math.floor(Math.random() * 16), z = cz * 16 + Math.floor(Math.random() * 16);
  const y = y0 + Math.floor(Math.random() * (y1 - y0));
  if (SOLID[w.getBlock(x, y, z)] || isFluid(w.getBlock(x, y, z))) return 0;
  const bastion = dim === 'cinderdeep' && w.dimGenerator && w.dimGenerator.inBastion && w.dimGenerator.inBastion(x, y, z);
  // Hollow Cities: Gloomshells (mobs/gloomshell.js) on the city's floors, a few per city
  const city = dim === 'hollow' && DIM_SPAWN_TABLES.hollowCity && w.dimGenerator.cityAt && w.dimGenerator.cityAt(x, y, z);
  if (city) {
    let near = 0;
    for (const e of g.entities.list) if (e.type === 'gloomshell' && !e.dead && Math.abs(e.x - city.x) < 40 && Math.abs(e.z - city.z) < 40) near++;
    if (near >= 6) return 0;
  }
  const table = bastion ? DIM_SPAWN_TABLES.bastion : city ? DIM_SPAWN_TABLES.hollowCity : DIM_SPAWN_TABLES[dim];
  const entry = weightedPick(table);
  if (!entry) return 0;
  const def = MOBS[entry.type];
  const size = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
  let n = 0;
  for (let k = 0; k < 4 && n < size; k++) {
    x += Math.floor(Math.random() * 6) - Math.floor(Math.random() * 6);
    z += Math.floor(Math.random() * 6) - Math.floor(Math.random() * 6);
    const d2 = (x + 0.5 - p.x) ** 2 + (y - p.y) ** 2 + (z + 0.5 - p.z) ** 2;
    if (d2 < SPAWN_MIN_DIST * SPAWN_MIN_DIST || d2 > DESPAWN_FAR * DESPAWN_FAR || !w.isLoaded(x, z)) continue;
    if (!def.flying) {
      const below = w.getBlock(x, y - 1, z);
      if (!SOLID[below] || !OPAQUE[below] || NO_FLOOR.has(below)) continue;
    }
    if (!spawner.canFit(entry.type, x, y, z)) continue;
    const m = spawner.spawnMob(entry.type, x + 0.5, y, z + 0.5);
    m.yaw = Math.random() * TAU;
    n++;
  }
  return n;
}

export { scaledCap };
