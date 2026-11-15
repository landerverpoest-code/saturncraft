// Stone Mites and Mite-Riddled stone (the module registers itself into MOBS, like pack7Mobs.js).
//
//  Mite-Riddled Stone / Cobblestone / Stone Bricks (world/blocks.js)  look like the plain blocks, crumble at once, drop nothing and, when broken
//      by a player or a blast, let a Stone Mite out (Gentle Hand brings the block home whole and releases nothing).
//  Stone Mite  a tiny grey-brown scurrier: 4 health, fast, bites for 1. When one is hurt, every mite within 10 blocks turns on the player and
//      every Riddled block within 6 blocks of it bursts and lets its mite out. A mite that has had no target for about ten seconds and stands
//      beside plain stone, cobblestone or stone bricks burrows back in: that block becomes its Riddled twin and the mite is gone.
//  Placement: stone in the mountain biomes is seeded with small clusters of Riddled Stone below the surface (world/stoneMiteGen.js), and a
//      twelfth of the Hollow Sanctums' stone bricks are Riddled. Mites are never in the open-world spawn tables.
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { B } from '../world/blocks.js';

// ---------------------------------------------------------------------------------------------
// Numbers

export const MITE = { ALERT_RADIUS: 10, BURST_RADIUS: 6, BURROW_TICKS: 200, HEALTH: 4, BITE: 1 }; // 10 seconds without a target before it burrows

/** Plain block -> its Riddled twin, and back. */
export const RIDDLED_OF = { [B.STONE]: B.MITE_STONE, [B.COBBLESTONE]: B.MITE_COBBLE, [B.STONE_BRICKS]: B.MITE_BRICKS };
export const PLAIN_OF = { [B.MITE_STONE]: B.STONE, [B.MITE_COBBLE]: B.COBBLESTONE, [B.MITE_BRICKS]: B.STONE_BRICKS };

// ---------------------------------------------------------------------------------------------
// Pure rules (unit tested)

export const isRiddled = (id) => id in PLAIN_OF;

/** Mites that hear a hurt mite: every other live mite within the alert radius. */
export function alertedMites(mites, src, radius = MITE.ALERT_RADIUS) {
  return mites.filter((o) => o !== src && !o.dead && !o.removed && Math.hypot(o.x - src.x, o.y - src.y, o.z - src.z) <= radius);
}

/** The Riddled blocks within `radius` of a point, as [x, y, z, id] (`get(x, y, z)` reads the world). */
export function riddledNear(get, x, y, z, radius = MITE.BURST_RADIUS) {
  const out = [], bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z), r = Math.ceil(radius);
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
    if (Math.hypot(dx + 0.5 - (x - bx), dy + 0.5 - (y - by), dz + 0.5 - (z - bz)) > radius) continue;
    const id = get(bx + dx, by + dy, bz + dz);
    if (isRiddled(id)) out.push([bx + dx, by + dy, bz + dz, id]);
  }
  return out;
}

const SIDES = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];

/** The plain stone, cobblestone or stone brick block a mite beside it can burrow into: [x, y, z, riddledId], or null. */
export function burrowSpot(get, x, y, z) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  for (const [dx, dy, dz] of SIDES) {
    const id = get(bx + dx, by + dy, bz + dz);
    if (RIDDLED_OF[id] !== undefined) return [bx + dx, by + dy, bz + dz, RIDDLED_OF[id]];
  }
  return null;
}

/** May the mite burrow now: no target for the whole wait and a plain block beside it. */
export const burrowReady = (idleTicks, spot) => idleTicks >= MITE.BURROW_TICKS && !!spot;

// ---------------------------------------------------------------------------------------------
// In the game

const isMite = (e) => e.kind === 'mob' && e.type === 'stone_mite';
const onHost = (g) => !(g.net && g.net.isClient);
const put = (w, x, y, z, id) => (w.setBlockUrgent ? w.setBlockUrgent(x, y, z, id) : w.setBlock(x, y, z, id));

function crumble(g, x, y, z, id) {
  if (g.particles && g.particles.blockBreak) g.particles.blockBreak(x, y, z, PLAIN_OF[id] || id, 1);
  if (g.audio) g.audio.play('hiss', [x + 0.5, y + 0.5, z + 0.5], 0.5);
}

/** A Riddled block at (x, y, z) has just been broken (and is already gone): its mite comes out, already on the player's heels. Host only. */
export function releaseMite(g, x, y, z) {
  if (!onHost(g) || !g.spawner || (g.spawner.hostileEnabled && !g.spawner.hostileEnabled())) return null;
  const m = g.spawner.spawnMob('stone_mite', x + 0.5, y, z + 0.5, { fresh: false });
  m.target = 'player'; m.idle = 0;
  return m;
}

/** A mite was hurt: the others within 10 blocks come for the player and every Riddled block within 6 blocks bursts. */
export function raiseAlarm(g, m) {
  if (!onHost(g) || !g.world) return;
  for (const o of alertedMites(g.entities.list.filter(isMite), m)) { o.target = 'player'; o.idle = 0; }
  const w = g.world;
  for (const [x, y, z, id] of riddledNear((a, b, c) => w.getBlock(a, b, c), m.x, m.y + m.height / 2, m.z)) {
    put(w, x, y, z, B.AIR);
    crumble(g, x, y, z, id);
    releaseMite(g, x, y, z);
  }
}

function miteAI(m, g, p, pdist) {
  const has = m.acquire(g, p, pdist, m.def.followRange);
  m.angry = has;
  if (has) {
    m.idle = 0;
    m.chase(g, p, 1.1);
    m.tryMelee(g, p);
    return;
  }
  m.wanderAI(g, 0.9);
  m.idle = (m.idle || 0) + 1;
  if (m.idle >= MITE.BURROW_TICKS && onHost(g)) {
    const w = g.world, spot = burrowSpot((a, b, c) => w.getBlock(a, b, c), m.x, m.y + 0.1, m.z);
    if (burrowReady(m.idle, spot)) {
      put(w, spot[0], spot[1], spot[2], spot[3]);
      g.audio.play('hiss', [m.x, m.y + 0.2, m.z], 0.3);
      m.removed = true; m.dead = true;
    }
  }
}

function miteHurt(m, dmg) {
  if (m._game && m.deathTime === 0) raiseAlarm(m._game, m);
  return dmg;
}

MODELS.stone_mite = {
  parts: [
    ['body', [4, 3, 6], [0, 2.5, 0.5], [0, 0, 0], '#7a6a58'],
    ['plate', [4.4, 1, 4], [0, 4.4, 1], [0, 0, 0], '#5e5246'],
    ['head', [3.4, 3, 3], [0, 2.6, -2.6], [0, 0, -1.2], '#fffffb', { face: 'stone_mite' }],
    ['legFL', [1, 2, 1], [1.6, 2, -1.4], [0, -1, 0], '#4a4036', { anim: 'legA' }],
    ['legFR', [1, 2, 1], [-1.6, 2, -1.4], [0, -1, 0], '#4a4036', { anim: 'legB' }],
    ['legBL', [1, 2, 1], [1.6, 2, 2.4], [0, -1, 0], '#4a4036', { anim: 'legB' }],
    ['legBR', [1, 2, 1], [-1.6, 2, 2.4], [0, -1, 0], '#4a4036', { anim: 'legA' }],
  ],
};
// two tiny bright eyes and a pair of pincers
FACES.stone_mite = (c) => {
  c.fillStyle = '#16120e'; c.fillRect(2, 4, 3, 3); c.fillRect(11, 4, 3, 3);
  c.fillStyle = '#ffd890'; c.fillRect(3, 4, 1, 1); c.fillRect(12, 4, 1, 1);
  c.fillStyle = '#2a1e14'; c.fillRect(4, 10, 2, 3); c.fillRect(10, 10, 2, 3);
};

export const STONE_MITE = {
  name: 'Stone Mite', role: 'rock mite', category: CATEGORY.MONSTER, sound: 'hiss',
  health: MITE.HEALTH, speed: 0.32, width: 0.4, height: 0.3, attack: MITE.BITE, followRange: 16, noFallDamage: true,
  drops: [],
  customAI: miteAI, onHurt: miteHurt,
  onSpawn: (m) => { m.idle = 0; },
};
if (!MOBS.stone_mite) { MOBS.stone_mite = STONE_MITE; MOB_KEYS.push('stone_mite'); }
