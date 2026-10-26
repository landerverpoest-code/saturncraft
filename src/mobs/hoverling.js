// Hoverling (reference: allay): a small blue spirit that flies about on
// glassy wings. Hand it an item (right-click) and it looks for dropped items
// of the same kind within 32 blocks, gathers them up to a full stack and
// brings them to whoever gave it the item - or to a Chime Block it heard ring
// within the last 30 seconds, where it drops them. Right-click it with an
// empty hand to take the item back (with anything it carries). Near a
// playing jukebox it bobs and twirls in a dance. Found caged beside every
// Marauder outpost, rarely in forests and drifting through Hollow Cities.
// Simulated on the host; guests see the held item and the dance through the
// mob snapshot.
import * as THREE from 'three';
import { MOBS, MOB_KEYS, CATEGORY } from './mobTypes.js';
import { MODELS, FACES } from './models.js';
import { ITEMS, maxStack } from '../world/items.js';
import { B, SOLID, isFluid } from '../world/blocks.js';
import { BIOMES } from '../world/biomes.js';
import { withExtras } from '../world/enchantments.js';
import { itemCanvas } from '../ui/icons.js';
import { CHIME_POWERED } from '../world/circuitShapes.js';
import { OUTPOST_CAGE } from '../world/temples.js';

export const COLLECT_RANGE = 32;          // blocks it looks for matching items
export const CHIME_MEMORY = 600;          // ticks (30 s) a heard Chime Block stays its drop-off
export const HEAR_RANGE = 16;             // blocks within which it hears a Chime Block ring
export const DANCE_RANGE = 8;             // blocks from a playing jukebox
export const PICKUP_COOLDOWN = 60;        // ticks after a delivery before it gathers again
export const DELIVER_REACH = { player: 2.2, chime: 1.6 };

const copyStack = (st, count = st.count) => withExtras({ id: st.id, count, damage: st.damage | 0 }, st);

/** Does a dropped stack match the item the Hoverling holds? (the same item; enchantments and wear don't matter) */
export function matchesHeld(held, stack) {
  return !!held && !!stack && stack.count > 0 && stack.id === held.id;
}

/** How many more it can carry of what it gathers (a full stack of that item). */
export function roomLeft(held, carried) {
  if (!held) return 0;
  return maxStack(held.id) - (carried ? carried.count : 0);
}

/**
 * The nearest dropped item it wants: a match for its held item, within range,
 * not one it threw itself, not already gone. `items` are item entities.
 */
export function findWanted(m, items, range = COLLECT_RANGE) {
  if (!m.held || roomLeft(m.held, m.carried) <= 0) return null;
  let best = null, bd = range * range;
  for (const e of items) {
    if (e.kind !== 'item' || e.dead || e.thrownBy === m.id || !matchesHeld(m.held, e.stack)) continue;
    const d = (e.x - m.x) ** 2 + (e.y - m.y) ** 2 + (e.z - m.z) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Take what fits of an item entity into the carried stack. Returns how many were taken. */
export function absorb(m, e) {
  const n = Math.min(e.stack.count, roomLeft(m.held, m.carried));
  if (n <= 0) return 0;
  if (m.carried) m.carried.count += n; else m.carried = copyStack(e.stack, n);
  e.stack.count -= n;
  if (e.stack.count <= 0) e.dead = true;
  return n;
}

/**
 * Where it takes what it carries: a Chime Block heard within the last 30 s,
 * otherwise the player who gave it its item (if around), otherwise nowhere.
 */
export function deliveryTarget(m, now, giver) {
  const c = m.chime;
  if (c && now - c.t <= CHIME_MEMORY) return { kind: 'chime', x: c.x + 0.5, y: c.y + 1.3, z: c.z + 0.5 };
  if (giver && !giver.dead) return { kind: 'player', x: giver.x, y: giver.y + 1.2, z: giver.z };
  return null;
}

/** Did a Chime Block's meta change mean it rang? (a new pitch, or it was just powered) */
export function chimeRang(prevMeta, meta) {
  if (prevMeta === undefined) return true;
  return (meta & 31) !== (prevMeta & 31) || (!!(meta & CHIME_POWERED) && !(prevMeta & CHIME_POWERED));
}

/** Every Hoverling within earshot remembers the Chime Block at (x, y, z) rang at tick `t`. */
export function hearChime(mobs, x, y, z, t) {
  let n = 0;
  for (const m of mobs) {
    if (m.type !== 'hoverling' || m.dead || m.netProxy) continue;
    if ((m.x - x - 0.5) ** 2 + (m.y - y - 0.5) ** 2 + (m.z - z - 0.5) ** 2 > HEAR_RANGE * HEAR_RANGE) continue;
    m.chime = { x, y, z, t }; n++;
  }
  return n;
}

/** Game hook (world blockChanged): a Chime Block changed; if it rang, nearby Hoverlings hear it. */
export function onChimeChanged(g, x, y, z) {
  const metas = g._chimeMetas || (g._chimeMetas = new Map());
  const k = `${x},${y},${z}`, meta = g.world.getMeta(x, y, z);
  const rang = chimeRang(metas.get(k), meta);
  metas.set(k, meta);
  if (metas.size > 256) metas.delete(metas.keys().next().value);
  if (rang) hearChime(g.entities.list, x, y, z, g.ticks);
}

/** A playing jukebox (meta > 0) within `r` blocks, or null. */
export function findJukebox(w, x, y, z, r = DANCE_RANGE) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  for (let dy = -4; dy <= 4; dy++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (w.getBlock(bx + dx, by + dy, bz + dz) === B.JUKEBOX && w.getMeta(bx + dx, by + dy, bz + dz) > 0) return { x: bx + dx, y: by + dy, z: bz + dz };
  }
  return null;
}

// ---- flight ---------------------------------------------------------------------
/** Accelerate towards a point; over obstacles it rises, and it keeps a little above the ground. */
function hoverTo(m, g, x, y, z, accel = 0.025) {
  const b = m.body, dx = x - m.x, dy = y - m.y, dz = z - m.z, l = Math.hypot(dx, dy, dz);
  if (l > 0.05) { b.vx += dx / l * accel; b.vy += dy / l * accel; b.vz += dz / l * accel; }
  if (b.horizontalCollision) b.vy += 0.04; // climb over what is in the way
  const w = g.world, fx = Math.floor(m.x), fz = Math.floor(m.z);
  if (SOLID[w.getBlock(fx, Math.floor(m.y - 0.4), fz)] && dy > -1) b.vy += 0.01; // don't scrape the floor
  if (l > 0.3) m.yaw += Math.max(-0.3, Math.min(0.3, wrapA(Math.atan2(-dx, -dz) - m.yaw)));
  return l;
}
const TAU = Math.PI * 2;
function wrapA(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }

function groundY(g, x, y, z) {
  for (let k = 0; k < 12; k++) {
    const id = g.world.getBlock(Math.floor(x), Math.floor(y) - k, Math.floor(z));
    if (SOLID[id] || isFluid(id)) return Math.floor(y) - k + 1;
  }
  return Math.floor(y) - 12;
}

/** Idle: drift to a random spot a little above the ground nearby (or near `around`). */
function idleHover(m, g, around = null) {
  const c = around || m;
  if (!m.drift || --m.drift.t <= 0 || Math.hypot(m.drift.x - m.x, m.drift.y - m.y, m.drift.z - m.z) < 0.6) {
    const a = Math.random() * TAU, r = around ? 1.5 + Math.random() * 2.5 : Math.random() * 6;
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    const y = groundY(g, x, c.y + 2, z) + 1 + Math.random() * 1.5;
    m.drift = { x, y, z, t: 60 + Math.floor(Math.random() * 80) };
  }
  hoverTo(m, g, m.drift.x, m.drift.y, m.drift.z, 0.012);
}

function hoverlingAI(m, g, p) {
  const b = m.body;
  b.vy *= 0.95;
  m.headPitch = 0;
  if (m.pickupCooldown > 0) m.pickupCooldown--;
  // the one it works for: the player who gave it the item (in multiplayer the host ticks it with that player)
  const giver = m.held && !p.dead && (!m.giverName || !p.netName || p.netName === m.giverName) ? p : null;
  // a playing jukebox nearby: dance on the spot
  if (g.ticks % 20 === m.id % 20) m.jukebox = findJukebox(g.world, m.x, m.y, m.z);
  m.dancing = !!m.jukebox && !m.carried;
  if (m.dancing) { b.vx *= 0.8; b.vz *= 0.8; b.vy += (Math.sin(g.ticks * 0.3 + m.id) * 0.02); return; }
  if (!m.held) { idleHover(m, g); return; }
  // carrying something: deliver it when full, when nothing else is left to gather, or after a while
  if (m.carried) {
    m.carryTicks = (m.carryTicks || 0) + 1;
    const more = m.carryTicks < 600 && roomLeft(m.held, m.carried) > 0 && (g.ticks % 10 === m.id % 10 ? (m._want = findWanted(m, g.entities.list)) : m._want);
    if (!more || more.dead) {
      const t = deliveryTarget(m, g.ticks, giver);
      if (!t) { idleHover(m, g); return; }
      const l = hoverTo(m, g, t.x, t.y, t.z, 0.03);
      if (l < DELIVER_REACH[t.kind]) deliver(m, g, t);
      return;
    }
  }
  if (m.pickupCooldown <= 0) {
    const want = g.ticks % 10 === m.id % 10 || !m._want || m._want.dead ? (m._want = findWanted(m, g.entities.list)) : m._want;
    if (want && !want.dead) {
      const l = hoverTo(m, g, want.x, want.y + 0.3, want.z, 0.03);
      if (l < 1.1 && absorb(m, want) > 0) { g.audio.play('hoverling', [m.x, m.y, m.z], 0.5); m._want = null; }
      return;
    }
  }
  // nothing to gather: keep near the giver
  if (giver) {
    const d = Math.hypot(giver.x - m.x, giver.z - m.z);
    if (d > 16) { hoverTo(m, g, giver.x, giver.y + 2, giver.z, 0.03); return; }
    idleHover(m, g, giver);
    return;
  }
  idleHover(m, g);
}

/** Drop the carried stack at the target: thrown towards the player, or let fall on the Chime Block. */
function deliver(m, g, t) {
  const st = m.carried;
  m.carried = null; m.carryTicks = 0; m._want = null;
  m.pickupCooldown = PICKUP_COOLDOWN;
  if (!st) return;
  const dx = t.x - m.x, dz = t.z - m.z, l = Math.hypot(dx, dz) || 1;
  const v = t.kind === 'player' ? [dx / l * 0.2, 0.15, dz / l * 0.2] : [0, 0.05, 0];
  const e = g.entities.spawnItem(m.x, m.y + 0.2, m.z, st, v);
  if (e) e.thrownBy = m.id; // it never gathers up what it brought
  g.audio.play('hoverling', [m.x, m.y, m.z], 0.7);
}

/**
 * Right-click (host / single player; a guest's click is played here by the host
 * with the guest standing in): give it the held item (one of it), or with an
 * empty hand take it back. Returns true when something happened.
 */
export function interactHoverling(g, mob, p, st, use) {
  if (mob.deathTime > 0) return false;
  if (mob.held) {
    if (st) return false;
    const back = [mob.held, mob.carried].filter(Boolean);
    mob.held = null; mob.carried = null; mob.giverName = null; mob.carryTicks = 0; mob._want = null;
    for (const s of back) {
      const left = p.isRemotePlayer ? s.count : p.inventory.add(s);
      if (left > 0) g.entities.spawnItem(p.x, p.y + 1, p.z, { ...s, count: left }, [0, 0.1, 0]);
    }
    if (!p.isRemotePlayer) p.inventory.changed();
    g.audio.play('hoverling', [mob.x, mob.y, mob.z]);
    return true;
  }
  if (!st || !ITEMS[st.id]) return false;
  mob.held = copyStack(st, 1);
  mob.giverName = p.netName || null;
  mob.persistent = true;
  use();
  g.audio.play('hoverling', [mob.x, mob.y, mob.z]);
  mob.hearts(g, 3, true);
  return true;
}

function hoverlingDeath(m, g) {
  // what it holds and carries falls where it was (it drops nothing of its own)
  for (const s of [m.held, m.carried]) if (s) g.entities.spawnItem(m.x, m.y + 0.3, m.z, s);
  m.held = m.carried = null;
}

// ---- model ------------------------------------------------------------------------
const heldTex = new Map();
function heldSprite(id) {
  let t = heldTex.get(id);
  if (!t) {
    t = new THREE.CanvasTexture(itemCanvas(id));
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    heldTex.set(id, t);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, alphaTest: 0.3 }));
  s.scale.setScalar(0.28);
  return s;
}

function hoverlingRender(m, model, alpha, sec) {
  const pa = model.userData.parts;
  if (!pa || !pa.wingL) return;
  const flap = Math.sin(sec * 18 + m.id) * 0.45;
  pa.wingL.rotation.y = -0.35 - flap; pa.wingR.rotation.y = 0.35 + flap;
  const bob = Math.sin(sec * 3 + m.id) * 0.05;
  model.position.y += bob;
  const holding = m.held ? m.held.id : m.heldItemId || 0;
  pa.armL.rotation.x = pa.armR.rotation.x = holding ? -1.1 : Math.sin(sec * 2 + m.id) * 0.15;
  if (m.dancing && m.deathTime === 0) {
    model.rotation.y += sec * 5;
    model.position.y += Math.abs(Math.sin(sec * 6)) * 0.18;
    pa.head.rotation.z = Math.sin(sec * 6) * 0.3;
    pa.armL.rotation.z = -1.2 - Math.sin(sec * 6) * 0.4; pa.armR.rotation.z = 1.2 + Math.sin(sec * 6) * 0.4;
  } else { pa.head.rotation.z = 0; pa.armL.rotation.z = pa.armR.rotation.z = 0; }
  // the held item, carried in front of it
  if (model.userData.hoverHeldId !== holding) {
    if (model.userData.hoverHeld) { model.remove(model.userData.hoverHeld); model.userData.hoverHeld.material.dispose(); model.userData.hoverHeld = null; }
    model.userData.hoverHeldId = holding;
    if (holding && ITEMS[holding] && typeof document !== 'undefined') {
      const s = heldSprite(holding);
      s.position.set(0, 3.5 / 16, -4 / 16);
      model.add(s);
      model.userData.hoverHeld = s;
    }
  }
}

MODELS.hoverling = {
  parts: [
    ['body', [4, 5, 3], [0, 3.5, 0], [0, 0, 0], '#4ab4f0', { emissive: '#103a5a' }],
    ['head', [5, 5, 5], [0, 6, 0], [0, 2.5, 0], '#7ad4ff', { face: 'hoverling' }],
    ['armL', [1, 4, 1], [2.5, 5.5, 0], [0, -2, 0], '#4ab4f0'],
    ['armR', [1, 4, 1], [-2.5, 5.5, 0], [0, -2, 0], '#4ab4f0'],
    ['wingL', [0.5, 5, 7], [1, 6, 1.5], [0, -0.5, 3.5], '#dff6ff', { alpha: 0.55 }],
    ['wingR', [0.5, 5, 7], [-1, 6, 1.5], [0, -0.5, 3.5], '#dff6ff', { alpha: 0.55 }],
  ],
};
FACES.hoverling = (c) => {
  c.fillStyle = '#0a2a4a'; c.fillRect(3, 6, 3, 3); c.fillRect(10, 6, 3, 3);
  c.fillStyle = '#ffffff'; c.fillRect(4, 6, 1, 1); c.fillRect(11, 6, 1, 1);
  c.fillStyle = '#3a8ac8'; c.fillRect(6, 11, 4, 1);
};

export const HOVERLING = {
  name: 'Hoverling', role: 'allay', category: CATEGORY.CREATURE, flying: true, noFallDamage: true, hoverling: true, sound: 'hoverling',
  health: 20, speed: 0.1, width: 0.35, height: 0.6, drops: [],
  ownAI: hoverlingAI, onDeath: hoverlingDeath, customRender: hoverlingRender,
  saveExtra: (m) => ({ held: m.held || undefined, carried: m.carried || undefined, giverName: m.giverName || undefined }),
  loadExtra: (m, s) => {
    const ok = (st) => st && ITEMS[st.id] && Number.isInteger(st.count) && st.count > 0;
    m.held = ok(s.held) ? copyStack(s.held, 1) : null;
    m.carried = m.held && ok(s.carried) ? copyStack(s.carried, Math.min(s.carried.count, maxStack(s.carried.id))) : null;
    m.giverName = typeof s.giverName === 'string' ? s.giverName : null;
  },
};
if (!MOBS.hoverling) { MOBS.hoverling = HOVERLING; MOB_KEYS.push('hoverling'); }

// ---- where they are found -------------------------------------------------------------
/** The cage beside each Marauder outpost: its inner cell relative to the tower's centre and base. */
export const CAGE = OUTPOST_CAGE;

/** Forests: now and then a Hoverling when a chunk is first made (rare). */
export const FOREST_CHUNK_CHANCE = 0.006;
export function forestChunkSpawn(spawner, cx, cz, rng = Math.random) {
  if (rng() >= FOREST_CHUNK_CHANCE) return 0;
  const w = spawner.game.world;
  const x = cx * 16 + Math.floor(rng() * 16), z = cz * 16 + Math.floor(rng() * 16);
  const key = BIOMES[w.biomeAt(x, z)] && BIOMES[w.biomeAt(x, z)].key;
  if (key !== 'forest' && key !== 'dark_forest' && key !== 'birch_forest') return 0;
  const y = w.heightAt(x, z) + 1;
  if (!spawner.canFit('hoverling', x, y, z)) return 0;
  spawner.spawnMob('hoverling', x + 0.5, y + 0.5, z + 0.5);
  return 1;
}

/** The Hollow: every so often a Hoverling drifts in a Hollow City near the player (at most 2 around). */
export function hollowSpawnTick(spawner) {
  const g = spawner.game, w = g.world, p = g.player;
  if (w.dimension !== 'hollow' || g.ticks % 600 !== 300 || !w.dimGenerator || !w.dimGenerator.cityAt) return 0;
  let near = 0;
  for (const e of g.entities.list) if (e.type === 'hoverling' && !e.dead && Math.hypot(e.x - p.x, e.z - p.z) < 64) near++;
  if (near >= 2 || Math.random() > 0.35) return 0;
  const a = Math.random() * TAU, r = 24 + Math.random() * 24;
  const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r), y = Math.floor(p.y + (Math.random() - 0.5) * 12);
  if (!w.isLoaded(x, z) || !w.dimGenerator.cityAt(x, y, z) || SOLID[w.getBlock(x, y, z)] || SOLID[w.getBlock(x, y + 1, z)]) return 0;
  spawner.spawnMob('hoverling', x + 0.5, y, z + 0.5);
  return 1;
}
