// Hostile variants and the elixir-throwing Hexwife, registered into MOBS with
// their own AI (Mob.ai calls def.customAI), as dimensionMobs.js does:
//  * Hexwife         (witch)   - throws splash elixirs, drinks her own when hurt, burning or underwater
//  * Dune Shambler   (husk)    - desert Shambler: no sun burn, its hits cause Hunger
//  * Sodden Shambler (drowned) - a Shambler that stayed underwater; swims after its prey
//  * Rime Rattler    (stray)   - snowy Rattler whose arrows cause Slowness
// Shambler-kin come as babies 5 % of the time (smaller, 50 % faster, never grow up).
// The pure rules (elixir choice, drink choice, the underwater conversion timer)
// are exported for the tests. Numbers follow the reference game.
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { I, SPLASH_ITEM } from '../world/items.js';
import { POTIONS } from '../world/potions.js';

const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const faceTowards = (m, x, z, k = 0.5) => { m.yaw += wrap(Math.atan2(-(x - m.x), -(z - m.z)) - m.yaw) * k; };
const has = (effects, name) => !!(effects && effects[name]);
function gaussian() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }

// ---- the underwater conversion (Shambler -> Sodden, Dune -> Shambler) ------------------
export const CONVERT_SUBMERGED_TICKS = 600; // 30 s with the eyes under water ...
export const CONVERT_SHAKE_TICKS = 300;     // ... then 15 s of shaking, even if it climbs out

export const newConversion = () => ({ inWaterTime: 0, conversionTime: -1, converting: false });

/** One tick of the reference conversion timer. Returns true on the tick the mob converts. */
export function conversionStep(s, eyeInWater) {
  if (s.converting) return --s.conversionTime < 0;
  if (eyeInWater) {
    if (++s.inWaterTime >= CONVERT_SUBMERGED_TICKS) { s.converting = true; s.conversionTime = CONVERT_SHAKE_TICKS; }
  } else s.inWaterTime = -1;
  return false;
}

// ---- the Hexwife's elixirs -------------------------------------------------------------
export const HEX_ATTACK_INTERVAL = 60; // ticks between throws
export const HEX_ATTACK_RANGE = 10;    // blocks
export const HEX_DRINK_TICKS = 32;     // drinking takes as long as for players

/**
 * Which splash elixir she throws at a target `dist` blocks away (horizontal):
 * Slowness at range, Poison while it is healthy, sometimes Weakness up close, otherwise Harming.
 */
export function hexThrowChoice({ dist, health = 20, effects = {} }, rng = Math.random) {
  if (dist >= 8 && !has(effects, 'slowness')) return 'slowness';
  if (health >= 8 && !has(effects, 'poison')) return 'poison';
  if (dist <= 3 && !has(effects, 'weakness') && rng() < 0.25) return 'weakness';
  return 'harming';
}

/**
 * What she drinks this tick (or null): Water Breathing when her eyes are under
 * water (15 %), Fire Resistance when burning (15 %), Healing when hurt (5 %),
 * Swiftness when her target is more than 11 blocks away (50 %).
 */
export function hexDrinkChoice({ eyeInWater, burning, health, maxHealth, effects = {}, targetDistSq = null }, rng = Math.random) {
  if (rng() < 0.15 && eyeInWater && !has(effects, 'water_breathing')) return 'water_breathing';
  if (rng() < 0.15 && burning && !has(effects, 'fire_resistance')) return 'fire_resistance';
  if (rng() < 0.05 && health < maxHealth) return 'healing';
  if (rng() < 0.5 && targetDistSq !== null && !has(effects, 'speed') && targetDistSq > 121) return 'swiftness';
  return null;
}

const FIRE_SOURCES = new Set(['fire', 'lava', 'fireball']);

function hexwifeAI(m, g, p, pdist) {
  m.headPitch = 0;
  if (m.drinkTicks > 0) {
    m.move = null; m.path = null; m.special = true;  // drinking stops her in her tracks
    if (m.target === 'player') faceTowards(m, p.x, p.z, 0.2);
    if (m.drinkTicks % 4 === 0) g.audio.play('drink', [m.x, m.y + 1.6, m.z], 0.6);
    if (--m.drinkTicks === 0) {
      for (const [type, ticks, amp] of POTIONS[m.drinkKind].effects) m.applyEffect(type, ticks, amp, 1, m);
      m.drinkKind = null; m.special = false;
    }
    return;
  }
  const target = m.acquire(g, p, pdist, m.def.followRange);
  const drink = hexDrinkChoice({
    eyeInWater: m.body.eyeInWater, burning: m.fireTicks > 0 || FIRE_SOURCES.has(m.lastSource),
    health: m.health, maxHealth: m.maxHealth, effects: m.effects, targetDistSq: target ? pdist * pdist : null,
  });
  if (drink) { m.drinkKind = drink; m.drinkTicks = HEX_DRINK_TICKS; m.special = true; m.move = null; return; }
  if (!target) { m.wanderAI(g, 1); return; }
  // ranged attack goal: close in until 10 blocks and seen for a second, then stand and throw
  const see = m.canSee(g, p.x, p.y + p.eyeHeight, p.z);
  m.seeTime = see ? Math.max(0, m.seeTime) + 1 : Math.min(0, m.seeTime) - 1;
  faceTowards(m, p.x, p.z, 0.5);
  if (pdist <= HEX_ATTACK_RANGE && m.seeTime >= 20) { m.path = null; m.move = null; }
  else m.chase(g, p, 1);
  if (see && pdist <= HEX_ATTACK_RANGE && m.attackCooldown <= 0) {
    m.attackCooldown = HEX_ATTACK_INTERVAL;
    hexThrow(m, g, p);
  }
}

/** Throw a splash elixir at the target (aimed at where it is heading, lobbed 20 degrees up). */
function hexThrow(m, g, p) {
  const v = p.body || {};
  const dx = p.x + (v.vx || 0) - m.x, dz = p.z + (v.vz || 0) - m.z;
  const dy = p.y + (p.eyeHeight || 1.62) - 1.1 - m.y;
  const dist = Math.hypot(dx, dz);
  const kind = hexThrowChoice({ dist, health: p.health ?? 20, effects: p.effects || {} });
  const ay = dy + dist * 0.2, l = Math.hypot(dx, ay, dz) || 1;
  const inacc = 0.0075 * 8;
  let vx = dx / l + gaussian() * inacc, vy = ay / l + gaussian() * inacc, vz = dz / l + gaussian() * inacc;
  const vl = Math.hypot(vx, vy, vz) / 0.75;
  vx /= vl; vy /= vl; vz /= vl;
  g.entities.spawnArrow(m.x, m.eyeY - 0.1, m.z, vx, vy, vz, m, false, 'potion', 0, SPLASH_ITEM[kind]);
  g.audio.play('hmm', [m.x, m.y + 1.6, m.z], 0.6);
}

/** Magic hurts her only 15 %, her own elixirs not at all. */
function hexwifeHurt(m, dmg, source, attacker) {
  if (source === 'magic') return attacker === m ? 0 : dmg * 0.15;
  return dmg;
}

/** Hexwife model extras: shake the vial while she drinks. */
function hexwifeRender(m, mesh, alpha, sec) {
  const parts = mesh.userData.parts;
  if (!parts || !parts.vial) return;
  parts.vial.visible = !!m.special;
  const tip = m.special ? -0.35 : m.headPitch || 0;
  for (const k of ['head', 'nose', 'wart', 'brim', 'hat1', 'band', 'hat2', 'hat3']) parts[k].rotation.x = tip;
  if (m.special) parts.armR.rotation.x = -2.1 + Math.sin(sec * 18) * 0.08; // the vial at her lips
  parts.vial.rotation.x = parts.armR.rotation.x;
}

// ---- Sodden Shamblers: swim after targets in the water ---------------------------------
/** The reference drowned only goes for targets at night or when they are in the water. */
function soddenOkTarget(g, p) {
  return !g.sky.state.sunlit || !!(p.body && p.body.inWater) || !!p.inWater;
}

function soddenAI(m, g, p, pdist) {
  const b = m.body;
  let target = m.acquire(g, p, pdist, m.def.followRange);
  if (target && !soddenOkTarget(g, p) && m.lastHurtByPlayer === 0) { m.target = null; target = false; }
  // one with a Tidespear throws it at targets 4-20 blocks away it can see (every 3 s)
  if (target && m.special) {
    const d = Math.hypot(p.x - m.x, p.y - m.y, p.z - m.z);
    if (d > 4 && d < 20 && m.canSee(g, p.x, p.y + 1.5, p.z)) {
      if (++m.bowCharge >= 30 && m.attackCooldown <= 0) { throwSpear(m, g, p); m.bowCharge = 0; m.attackCooldown = 60; }
    } else m.bowCharge = 0;
  }
  if (target && b.inWater) {
    // swim straight at it, in three dimensions
    const dx = p.x - m.x, dy = p.y + 0.5 - m.y, dz = p.z - m.z, d = Math.hypot(dx, dy, dz) || 1;
    faceTowards(m, p.x, p.z, 0.4);
    m.path = null;
    const sp = m.speed() * 0.13;
    b.vx += dx / d * sp; b.vz += dz / d * sp;
    b.vy += dy / d * sp + 0.005;
    m.move = { forward: 0, jump: dy > 1 && b.horizontalCollision, mod: 1 };
    m.tryMelee(g, p);
    return;
  }
  if (target) { m.chase(g, p, 1); m.tryMelee(g, p); return; }
  m.wanderAI(g, 1);
}

/** A Sodden Shambler hurls its Tidespear (it vanishes where it lands; the mob keeps its own). */
function throwSpear(m, g, p) {
  const sx = m.x, sy = m.eyeY - 0.1, sz = m.z;
  const dx = p.x - sx, dz = p.z - sz, dy = p.y + 1 - sy + Math.hypot(dx, dz) * 0.12, l = Math.hypot(dx, dy, dz) || 1;
  g.entities.spawnArrow(sx, sy, sz, dx / l * 1.6, dy / l * 1.6, dz / l * 1.6, m, false, 'spear');
  g.audio.play('bow', [sx, sy, sz], 0.6);
}

function soddenRender(m, mesh) {
  const parts = mesh.userData.parts;
  if (!parts || !parts.spear) return;
  parts.spear.visible = parts.spearHead.visible = !!m.special;
  parts.spear.rotation.x = parts.spearHead.rotation.x = parts.armR.rotation.x;
}

// ---- registration ----------------------------------------------------------------------
const SHAMBLER = MOBS.shambler;
const shamblerish = { shamblerKin: true, babyChance: 0.05, undead: true };

export const VARIANT_MOBS = {
  hexwife: {
    name: 'Hexwife', role: 'witch', category: CATEGORY.MONSTER,
    health: 26, speed: 0.25, width: 0.6, height: 1.95, followRange: 16, sound: 'hmm',
    customAI: hexwifeAI, onHurt: hexwifeHurt, customRender: hexwifeRender,
    drops: [],
    // 1-3 rolls, each 0-2 of one of these (sticks twice as likely)
    loot: {
      rolls: [1, 3], count: [0, 2], entries: [
        { id: I.GLASS_VIAL, weight: 1 }, { id: I.GLOWSHARD_DUST, weight: 1 }, { id: I.GUNPOWDER, weight: 1 },
        { id: I.CINNABAR, weight: 1 }, { id: I.SPIDER_EYE, weight: 1 }, { id: I.SUGAR, weight: 1 }, { id: I.STICK, weight: 2 },
      ],
    },
  },
  dune_shambler: {
    ...shamblerish,
    name: 'Dune Shambler', role: 'husk', category: CATEGORY.MONSTER,
    health: 20, speed: 0.23, width: 0.6, height: 1.95, attack: 3, followRange: 35, armor: 2, sound: 'grunt',
    needsSky: true, convertsTo: 'shambler',
    hitEffect: ['hunger', 140 * 2, 0], // 7 s x the (Normal) regional difficulty
    customAI: (m, g, p, pd) => m.meleeAI(g, p, pd),
    drops: SHAMBLER.drops, rare: SHAMBLER.rare,
  },
  sodden_shambler: {
    ...shamblerish,
    name: 'Sodden Shambler', role: 'drowned', category: CATEGORY.MONSTER,
    health: 20, speed: 0.23, width: 0.6, height: 1.95, attack: 3, followRange: 35, armor: 2, sound: 'grunt',
    burnsInSun: true, sinks: true, aquaticSpawn: true,
    customAI: soddenAI, customRender: soddenRender,
    onSpawn: (m) => { m.special = Math.random() < 0.0625; }, // 1 in 16 carries a Tidespear
    onDeath: (m, g, byPlayer) => { // and very rarely drops it (worn) when a player kills it
      if (m.special && byPlayer && Math.random() < spearDropChance(m.plunder | 0)) g.entities.spawnItem(m.x, m.y + 0.5, m.z, { id: I.TIDESPEAR, count: 1, damage: 50 + Math.floor(Math.random() * 150) });
    },
    drops: [SHAMBLER.drops[0], { id: I.COPPER_INGOT, min: 1, max: 1, playerOnly: true, chance: 0.11, plunderChance: 0.02 }],
  },
  rime_rattler: {
    name: 'Rime Rattler', role: 'stray', category: CATEGORY.MONSTER,
    health: 20, speed: 0.25, width: 0.6, height: 1.99, followRange: 16, ranged: true,
    burnsInSun: true, sound: 'rattle', needsSky: true,
    arrowEffect: ['slowness', 600, 0], // 30 s of Slowness per hit
    customAI: (m, g, p, pd) => m.rangedAI(g, p, pd),
    drops: MOBS.rattler.drops,
  },
};

// the plain Shambler: kin, sometimes a baby, and turns into a Sodden Shambler under water
Object.assign(SHAMBLER, shamblerish, { convertsTo: 'sodden_shambler' });

for (const [k, d] of Object.entries(VARIANT_MOBS)) { if (!MOBS[k]) { MOBS[k] = d; MOB_KEYS.push(k); } }

/** Chance that a Sodden Shambler carrying a Tidespear drops it on a player kill: 8.5 % + 1 % per Plunder level. */
export const spearDropChance = (plunder = 0) => 0.085 + 0.01 * plunder;

/** Is the reference drowned allowed to spawn here (beyond the light test)? */
export function soddenSpawnChance(biomeKey, y, seaLevel, rng = Math.random) {
  if (biomeKey === 'river' || biomeKey === 'frozen_river') return Math.floor(rng() * 15) === 0;
  return Math.floor(rng() * 40) === 0 && y < seaLevel - 5;
}

