// Pack 7 creatures: two passive overworld animals (the module registers itself into MOBS, like fauna.js).
//
//  Rootsnout  a big, slow, gentle mossy beast of forests and flower forests. Every 2-4 minutes, standing on grass or dirt, it stops, roots
//      in the ground for three seconds (head down, dirt flying) and leaves one Dawnfern Seeds. Bred with those same seeds. Dawnfern is a crop
//      (world/blocks.js): a ripe fern is cut for a glowing, placeable Dawnfern Plant.
//  Plateback  a small armoured burrower of savannas and badlands. A sprinting player within 6 blocks, or a hit, makes it curl into a ball for
//      4 seconds: it stands still and takes 70 % less damage. Right-click it with a Brush for a Plate Scale (5 minutes between brushings per
//      animal); it sheds one on its own every 5-10 minutes. Six scales make Howler Barding.
//  Howler Barding  worn by a tamed Howler (use it on one; Shears take it off): the Howler takes half damage until the barding has soaked
//      up 64, then it breaks. It is stored on the mob (`barding`, saved with it) and drawn as a plate over its back.
//
// Visuals: the Rootsnout dips its head (the head pitch is in the multiplayer snapshot, so guests see it); a curled Plateback hides its head
// and legs (the host marks it with a head pitch of CURL_PITCH, which guests read). A guest does not see a Howler's barding plate: the worn
// state is not in the snapshot (the damage rule runs on the host and applies to everyone regardless).
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { decorate, followDecor } from './modelKit.js';
import { I, ITEMS } from '../world/items.js';
import { B } from '../world/blocks.js';

// ---------------------------------------------------------------------------------------------
// Numbers

export const ROOT = { MIN_DELAY: 2400, SPREAD: 2401, TICKS: 60, SOILS: [B.GRASS, B.DIRT] };      // 2-4 minutes between, 3 seconds down
export const CURL = { TICKS: 80, RANGE: 6, REDUCTION: 0.7, PITCH: 3 };                          // 4 seconds, 70 % less damage
export const SCALE = { COOLDOWN: 6000, MIN_DELAY: 6000, SPREAD: 6001 };                         // brush: 5 minutes per animal; sheds every 5-10
export const BARDING = { REDUCTION: 0.5, CAPACITY: 64 };

/** Biome keys the two are placed in by the spawn tables (spawnRules.js). */
export const HABITATS = { rootsnout: ['forest', 'flower_forest'], plateback: ['savanna', 'badlands'] };

// ---------------------------------------------------------------------------------------------
// Pure rules (unit tested)

/** Ticks until a Rootsnout roots again: 2 to 4 minutes. */
export const rootDelay = (rng = Math.random) => ROOT.MIN_DELAY + Math.floor(rng() * ROOT.SPREAD);

/** May a Rootsnout root here: grass or dirt under its feet. */
export const canRoot = (below) => ROOT.SOILS.includes(below);

/**
 * One tick of a Rootsnout's rooting clock (`m.rootTimer` counts down, `m.rooting` is the ticks left with the head down).
 * Returns 'start' (it just put its head down), 'rooting', 'drop' (the seeds come now) or null.
 */
export function rootStep(m, onSoil, rng = Math.random) {
  if (m.rooting > 0) {
    if (--m.rooting > 0) return 'rooting';
    m.rootTimer = rootDelay(rng);
    return 'drop';
  }
  if (m.rootTimer === undefined) m.rootTimer = rootDelay(rng);
  if (m.rootTimer > 0) m.rootTimer--;
  if (m.rootTimer <= 0 && onSoil) { m.rooting = ROOT.TICKS; return 'start'; }
  return null;
}

/** Should a Plateback curl: a sprinting player within range, or it has just been hurt. */
export const shouldCurl = ({ pdist = Infinity, sprinting = false, hurt = false }) => !!hurt || (!!sprinting && pdist <= CURL.RANGE);

/** The damage a Plateback takes: 70 % less while curled. */
export const curlDamage = (dmg, curled) => (curled ? dmg * (1 - CURL.REDUCTION) : dmg);

/** May this brushing yield a scale: the brush in hand, a grown animal, and its 5 minutes are up. `now` and `last` are game ticks. */
export const canBrush = (mob, now) => !!mob && mob.age >= 0 && !mob.dead && mob.deathTime === 0 && !(now - (mob.lastBrush ?? -Infinity) < SCALE.COOLDOWN);

/** Ticks until a Plateback sheds a scale by itself: 5 to 10 minutes. */
export const shedDelay = (rng = Math.random) => SCALE.MIN_DELAY + Math.floor(rng() * SCALE.SPREAD);

/**
 * A hit on a Howler wearing barding. `worn` is `{ absorbed }` (damage soaked up so far). Half of the hit is stopped, but never more than the
 * barding has left. Returns the damage that gets through, the new wear (null once broken) and whether it just broke.
 */
export function bardingAbsorb(worn, dmg) {
  if (!worn || !(dmg > 0)) return { dmg, worn: worn || null, broke: false };
  const left = BARDING.CAPACITY - (worn.absorbed || 0);
  const stopped = Math.min(dmg * BARDING.REDUCTION, left);
  const absorbed = (worn.absorbed || 0) + stopped;
  const broke = absorbed >= BARDING.CAPACITY - 1e-9;
  return { dmg: dmg - stopped, worn: broke ? null : { absorbed }, broke };
}

/** Can this animal wear barding: a tamed Howler that has none yet. */
export const canWearBarding = (mob) => !!mob && mob.type === 'howler' && !!mob.tamed && !mob.barding && mob.deathTime === 0 && !mob.dead;

// ---------------------------------------------------------------------------------------------
// Rootsnout

const rootBelow = (m, g) => g.world.getBlock(Math.floor(m.x), Math.floor(m.y - 0.2), Math.floor(m.z));

function dirtSpray(m, g, n = 2) {
  for (let k = 0; k < n; k++) g.particles.emit(m.x + Math.sin(m.yaw + Math.PI) * 0.9 + (Math.random() - 0.5) * 0.5, m.y + 0.1, m.z + Math.cos(m.yaw + Math.PI) * 0.9 + (Math.random() - 0.5) * 0.5,
    (Math.random() - 0.5) * 0.08, 0.1 + Math.random() * 0.08, (Math.random() - 0.5) * 0.08, 0.42, 0.3, 0.18, 18, -0.012);
}

function rootsnoutAI(m, g, p, pdist) {
  if (m.panicTicks > 0 || m.age < 0 || m.loveTicks > 0) { m.rooting = 0; return m.passiveAI(g); }
  const was = m.rooting > 0;
  const act = rootStep(m, was || ROOT.SOILS.includes(rootBelow(m, g)));
  if (act === 'start') { m.move = null; m.path = null; m.wander = null; g.audio.play('snuffle', [m.x, m.y + 0.5, m.z], 0.7); }
  if (m.rooting > 0 || act === 'drop') {
    m.move = null; m.path = null; m.wander = null; m.headPitch = 1.15;
    if (g.ticks % 4 === 0) dirtSpray(m, g);
    if (act === 'drop') {
      m.headPitch = 0;
      g.entities.spawnItem(m.x - Math.sin(m.yaw) * 0.8, m.y + 0.4, m.z - Math.cos(m.yaw) * 0.8, { id: I.DAWNFERN_SEEDS, count: 1 });
      dirtSpray(m, g, 6);
    }
    return;
  }
  m.passiveAI(g);
}

/** A hit breaks off the rooting (it tries again a little later). */
function rootsnoutHurt(m, dmg) {
  if (m.rooting > 0) { m.rooting = 0; m.rootTimer = Math.max(m.rootTimer || 0, 400); }
  return dmg;
}

function rootsnoutRender(m, model) {
  const pa = model.userData.parts;
  if (!pa) return;
  const down = m.headPitch || 0;
  pa.head.rotation.x = down * 0.9;
  pa.snout.rotation.x = pa.head.rotation.x;
  pa.mossL.rotation.x = pa.mossR.rotation.x = down * 0.15;
}

MODELS.rootsnout = {
  parts: decorate([
    ['body', [12, 10, 18], [0, 16, 0], [0, 0, 0], '#6a5a3e'],
    ['moss', [11, 2.4, 15], [0, 21.4, 0.5], [0, 0, 0], '#5a8a46'],
    ['mossL', [3, 2, 6], [4.5, 22.8, 2], [0, 0, 0], '#7ab35c'],
    ['mossR', [3, 2, 6], [-4.5, 22.6, -1], [0, 0, 0], '#7ab35c'],
    ['head', [8, 8, 8], [0, 19, -9], [0, 0, -3.5], '#fffffb', { face: 'rootsnout' }],
    ['snout', [5, 4, 3], [0, 19, -9], [0, -1.6, -8.6], '#4a3c28'],
    ['earL', [2, 3, 1.5], [0, 19, -9], [4.2, 3.8, -2], '#5a8a46'],
    ['earR', [2, 3, 1.5], [0, 19, -9], [-4.2, 3.8, -2], '#5a8a46'],
    ['legFL', [4, 11, 4], [4, 11, -6], [0, -5.5, 0], '#4e4230', { anim: 'legA' }],
    ['legFR', [4, 11, 4], [-4, 11, -6], [0, -5.5, 0], '#4e4230', { anim: 'legB' }],
    ['legBL', [4, 11, 4], [4, 11, 6], [0, -5.5, 0], '#4e4230', { anim: 'legB' }],
    ['legBR', [4, 11, 4], [-4, 11, 6], [0, -5.5, 0], '#4e4230', { anim: 'legA' }],
  ], {
    body: [
      ['belly', [10, 2, 16], [0, -4.2, 0], '#8a7a58'],
      ['stripeL', [0.6, 4, 12], [6.1, -1, 0], '#5a4a2e'], ['stripeR', [0.6, 4, 12], [-6.1, -1, 0], '#5a4a2e'],
      ['shroomStem', [1.2, 2.4, 1.2], [3, 6.8, 5], '#e8e0c8'], ['shroomCap', [3.4, 1.4, 3.4], [3, 8.4, 5], '#c8402a'], ['shroomDot', [1, 0.4, 1], [3.4, 9.2, 5.2], '#fff0d8'],
      ['fern', [1, 3, 1], [-3, 6.8, 6], '#7ab35c'], ['fern2', [1, 2.2, 1], [-4, 6.4, 5], '#8ac86a'],
    ],
    moss: [['mossC', [4, 1.6, 4], [-2, 1, -5], '#8ac86a']],
    head: [
      ['mossBrow', [8.4, 1.4, 8.4], [0, 4.1, 0], '#5a8a46'],
      ['tusk@', [1, 2.4, 1], [2.8, -3.4, -4.4], '#efe4c8'],
      ['cheek@', [0.8, 3, 4], [4.2, -1.2, -1], '#4a3c28'],
    ],
    'legF@': [['hoof@', [4.4, 1.6, 4.4], [0, -5.3, 0], '#2a2218'], ['mossLeg@', [4.4, 2, 4.4], [0, 3.5, 0], '#5a8a46']],
    'legB@': [['hoof@', [4.4, 1.6, 4.4], [0, -5.3, 0], '#2a2218'], ['mossLeg@', [4.4, 2, 4.4], [0, 3.5, 0], '#5a8a46']],
    '*': [
      ['tail', [3, 3, 4], [0, 18, 9], [0, 0, 2], '#4e4230'],
      ['tailTuft', [3.4, 3.4, 1.6], [0, 18, 9], [0, 0, 4.6], '#5a8a46'],
    ],
  }),
};
// small, gentle eyes under a mossy brow, and a broad dark snout
FACES.rootsnout = (c) => {
  c.fillStyle = '#4a3c28'; c.fillRect(0, 7, 2, 4); c.fillRect(14, 7, 2, 4);
  c.fillStyle = '#1a140c'; c.fillRect(2, 6, 3, 3); c.fillRect(11, 6, 3, 3);
  c.fillStyle = '#e8e0b8'; c.fillRect(3, 6, 1, 1); c.fillRect(12, 6, 1, 1);
  c.fillStyle = '#6a9a4e'; c.fillRect(1, 3, 5, 2); c.fillRect(10, 3, 5, 2); c.fillRect(6, 2, 4, 2);
  c.fillStyle = '#3a2e1c'; c.fillRect(5, 11, 6, 3);
  c.fillStyle = '#1a140c'; c.fillRect(6, 12, 1, 1); c.fillRect(9, 12, 1, 1);
};

// ---------------------------------------------------------------------------------------------
// Plateback

function platebackAI(m, g, p, pdist) {
  if (m.curl > 0) {
    m.curl--; m.move = null; m.path = null; m.wander = null; m.panicTicks = 0; m.headPitch = CURL.PITCH;
    return;
  }
  if (m.headPitch >= CURL.PITCH - 0.01) m.headPitch = 0;
  if (m.age >= 0) {
    if (shouldCurl({ pdist, sprinting: !p.dead && p.sprinting })) { m.curl = CURL.TICKS; g.audio.play('clink', [m.x, m.y + 0.3, m.z], 0.6); return; }
    if (m.shedTimer === undefined) m.shedTimer = shedDelay();
    if (--m.shedTimer <= 0) { m.shedTimer = shedDelay(); shedScale(g, m); }
  }
  m.passiveAI(g);
}

/** The Plateback takes damage with its plates up when curled; any hit curls it. */
function platebackHurt(m, dmg) {
  const out = curlDamage(dmg, m.curl > 0);
  m.curl = CURL.TICKS; m.panicTicks = 0;
  return out;
}

function shedScale(g, m) {
  g.entities.spawnItem(m.x, m.y + 0.3, m.z, { id: I.PLATE_SCALE, count: 1 });
  g.audio.play('clink', [m.x, m.y + 0.3, m.z], 0.5);
}

/**
 * Right-click a Plateback with a Brush: a Plate Scale falls out and the Brush wears one point. Returns true when it did (false when the
 * animal is not ready, which leaves the click to the usual feeding). `now` is the game tick.
 */
export function brushPlateback(g, mob, p, st, now = g.ticks, swing = () => {}) {
  if (!st || st.id !== I.BRUSH || mob.type !== 'plateback' || !canBrush(mob, now)) return false;
  mob.lastBrush = now;
  g.entities.spawnItem(mob.x, mob.y + 0.4, mob.z, { id: I.PLATE_SCALE, count: 1 });
  if (!p.creative && p.inventory.damageSelected) p.inventory.damageSelected(1);
  g.audio.play('clink', [mob.x, mob.y + 0.3, mob.z], 0.7);
  swing();
  return true;
}

function platebackRender(m, model) {
  const pa = model.userData.parts;
  if (!pa) return;
  const curled = m.curl > 0 || (m.headPitch || 0) >= CURL.PITCH - 0.01; // (a guest sees the host's marker in the head pitch)
  for (const k of ['head', 'snout', 'legFL', 'legFR', 'legBL', 'legBR', 'tail']) pa[k].visible = !curled;
  pa.body.scale.set(curled ? 1.05 : 1, curled ? 1.5 : 1, curled ? 0.9 : 1);
  pa.shell.scale.copy(pa.body.scale);
  pa.shell.position.y = (curled ? 7.2 : 6.4) / 16;
  if (!curled) pa.head.rotation.x = 0;
}

MODELS.plateback = {
  parts: decorate([
    ['body', [7, 5, 10], [0, 5.5, 1], [0, 0, 0], '#a88a5a'],
    ['shell', [8, 3, 10.6], [0, 6.4, 1], [0, 0, 0], '#8a6a42'],
    ['head', [4.6, 4, 5], [0, 5.4, -4], [0, 0, -2.2], '#fffffa', { face: 'plateback' }],
    ['snout', [2.4, 2, 2.4], [0, 5.4, -4], [0, -0.8, -5.2], '#c8a47a'],
    ['legFL', [2, 3, 2], [2.6, 3, -2.4], [0, -1.5, 0], '#6a5030', { anim: 'legA' }],
    ['legFR', [2, 3, 2], [-2.6, 3, -2.4], [0, -1.5, 0], '#6a5030', { anim: 'legB' }],
    ['legBL', [2, 3, 2], [2.6, 3, 4.4], [0, -1.5, 0], '#6a5030', { anim: 'legB' }],
    ['legBR', [2, 3, 2], [-2.6, 3, 4.4], [0, -1.5, 0], '#6a5030', { anim: 'legA' }],
    ['tail', [1.6, 1.6, 4], [0, 5, 6.4], [0, 0, 2], '#8a6a42'],
  ], {
    body: [['belly', [6, 1, 8], [0, -2.6, 0], '#d8c49a'], ['flank@', [0.6, 3, 6], [3.6, -0.4, 0], '#c8ae80']],
    shell: [
      ['band0', [8.6, 3.5, 1], [0, 0, -3.8], '#6e5232'],
      ['band1', [8.6, 3.5, 1], [0, 0, -1.2], '#6e5232'],
      ['band2', [8.6, 3.5, 1], [0, 0, 1.4], '#6e5232'],
      ['band3', [8.6, 3.5, 1], [0, 0, 4], '#6e5232'],
      ['rim', [9, 0.8, 11], [0, -1.6, 0], '#5a4228'],
      ['crest', [3, 1, 8], [0, 1.8, 0], '#b89a68'],
    ],
    head: [['ear@', [1.2, 2, 0.8], [1.9, 2.6, 0.8], '#8a6a42'], ['headPlate', [4.8, 1, 5.2], [0, 2.1, 0], '#8a6a42'], ['cheek@', [0.6, 2, 2.4], [2.4, -0.8, -0.8], '#c8a47a']],
    'legF@': [['claw@', [2.2, 0.6, 2.6], [0, -1.7, -0.6], '#e8dcc0']],
    'legB@': [['claw@', [2.2, 0.6, 2.6], [0, -1.7, -0.6], '#e8dcc0']],
    tail: [['tailPlate', [2, 0.8, 4.4], [0, 1, 0], '#8a6a42'], ['tailTip', [1.2, 1.2, 1.6], [0, 0, 2.2], '#6a5030']],
  }),
};
// small bright eyes, a pale snout
FACES.plateback = (c) => {
  c.fillStyle = '#6a5030'; c.fillRect(1, 3, 5, 1); c.fillRect(10, 3, 5, 1);
  c.fillStyle = '#14100a'; c.fillRect(2, 4, 3, 3); c.fillRect(11, 4, 3, 3);
  c.fillStyle = '#f0e4c0'; c.fillRect(2, 4, 1, 1); c.fillRect(11, 4, 1, 1);
  c.fillStyle = '#d8c49a'; c.fillRect(4, 9, 8, 5);
  c.fillStyle = '#3a2a1a'; c.fillRect(6, 10, 1, 1); c.fillRect(9, 10, 1, 1); c.fillRect(6, 12, 4, 1);
};

// ---------------------------------------------------------------------------------------------
// Howler Barding (worn by the existing tame Howler)

/** The saved form of a Howler's barding: the damage it has soaked up. */
export const bardingSave = (m) => (m.barding ? { barding: Math.round(m.barding.absorbed * 100) / 100 } : {});
export const bardingLoad = (m, s) => { if (Number.isFinite(s.barding) && s.barding >= 0 && s.barding < BARDING.CAPACITY) m.barding = { absorbed: s.barding }; };

/** Put barding from a stack on a tamed Howler (the stack's `damage` is its wear). Returns true when it went on. */
export function equipBarding(g, mob, p, st, swing = () => {}) {
  if (!st || st.id !== I.HOWLER_BARDING || !canWearBarding(mob)) return false;
  mob.barding = { absorbed: Math.min(BARDING.CAPACITY - 1, st.damage || 0) };
  if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
  g.audio.play('equip', [mob.x, mob.y + 0.6, mob.z]);
  swing();
  return true;
}

/** Shears take the barding off again: it drops with its wear. Returns true when they did. */
export function removeBarding(g, mob, p, st, swing = () => {}) {
  if (!st || !(ITEMS[st.id] && ITEMS[st.id].shears) || mob.type !== 'howler' || !mob.barding) return false;
  g.entities.spawnItem(mob.x, mob.y + 0.6, mob.z, { id: I.HOWLER_BARDING, count: 1, damage: Math.min(BARDING.CAPACITY - 1, Math.ceil(mob.barding.absorbed)) });
  mob.barding = null;
  if (!p.creative && p.inventory.damageSelected) p.inventory.damageSelected(1);
  g.audio.play('shear', [mob.x, mob.y + 0.6, mob.z]);
  swing();
  return true;
}

/** Howler's onHurt: half the damage, until the barding is spent. */
function howlerBardingHurt(m, dmg) {
  if (!m.barding) return dmg;
  const r = bardingAbsorb(m.barding, dmg);
  m.barding = r.worn;
  if (r.broke && m._game) {
    const g = m._game;
    g.audio.play('shield_break', [m.x, m.y + 0.6, m.z], 0.7);
    for (let k = 0; k < 8; k++) g.particles.emit(m.x + (Math.random() - 0.5) * 0.6, m.y + 0.6, m.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.1, 0.08, (Math.random() - 0.5) * 0.1, 0.6, 0.5, 0.34, 20, -0.01);
  }
  return r.dmg;
}

function howlerRender(m, model) {
  const pa = model.userData.parts;
  if (pa && pa.bardingPlate) pa.bardingPlate.visible = !!m.barding;
}

/** Hooks the Howler's definition (mobTypes.js) with the barding, chaining anything already there. */
function hookHowler() {
  const d = MOBS.howler;
  if (!d || d.bardingHooked) return;
  d.bardingHooked = true;
  const hurt = d.onHurt, save = d.saveExtra, load = d.loadExtra, render = d.customRender;
  d.onHurt = (m, dmg, src, att) => { if (hurt) { dmg = hurt(m, dmg, src, att); if (dmg <= 0) return dmg; } return howlerBardingHurt(m, dmg); };
  d.saveExtra = (m) => ({ ...(save ? save(m) : {}), ...bardingSave(m) });
  d.loadExtra = (m, s) => { if (load) load(m, s); bardingLoad(m, s); };
  d.customRender = (m, model, a, sec) => { if (render) render(m, model, a, sec); howlerRender(m, model); };
  if (!MODELS.howler.parts.some((q) => q[0] === 'bardingPlate')) MODELS.howler.parts.push(['bardingPlate', [7, 1.4, 8], [0, 10, 2], [0, 3.6, 0.4], '#9a7a4a', { gear: true }]);
}

// ---------------------------------------------------------------------------------------------
// definitions

export const ROOTSNOUT = {
  name: 'Rootsnout', role: 'mossy beast', category: CATEGORY.CREATURE, sound: 'snuffle',
  health: 14, speed: 0.12, width: 1.3, height: 1.4, panicSpeed: 1.5,
  drops: [{ id: I.LEATHER, min: 0, max: 1 }, { id: B.MOSS_BLOCK, min: 0, max: 2 }],
  food: [I.DAWNFERN_SEEDS],
  ownAI: rootsnoutAI, onHurt: rootsnoutHurt, customRender: rootsnoutRender,
  onSpawn: (m) => { m.rooting = 0; m.rootTimer = rootDelay(); },
};
export const PLATEBACK = {
  name: 'Plateback', role: 'armoured burrower', category: CATEGORY.CREATURE, sound: 'clink',
  health: 12, speed: 0.15, width: 0.7, height: 0.5, panicSpeed: 1.4, noFallDamage: true,
  drops: [{ id: I.PLATE_SCALE, min: 0, max: 1, chance: 0.5 }],
  food: [I.SWEET_BERRIES],
  ownAI: platebackAI, onHurt: platebackHurt, customRender: platebackRender,
  onSpawn: (m) => { m.curl = 0; m.shedTimer = shedDelay(); },
};
for (const [k, d] of [['rootsnout', ROOTSNOUT], ['plateback', PLATEBACK]]) {
  if (!MOBS[k]) { MOBS[k] = d; MOB_KEYS.push(k); }
}
hookHowler();

// detail boxes follow their host parts (head pitch, claws...)
followDecor(ROOTSNOUT, 'rootsnout');
followDecor(PLATEBACK, 'plateback');
