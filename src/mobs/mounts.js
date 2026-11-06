// Mounts: the rules Gallopers, Thistlehorns and Dune Striders (and boats and carts) share. A mob type opts in with
// `mount: { armor?, tack?, tameFood?, tameChance? }` on its definition:
//   * Riding speed.   A ridden mount is steered with full input (forward 1) and a top speed of `speed x RIDE_SPEED` blocks per tick
//                     (a Galloper's 0.225 is 8.1 blocks/s, 10.5 sprinting), never over MAX_BPS. Before this the ridden push was the
//                     mob's walking push (input = speed) a second time, which crawled along at 2.2 blocks/s. In water the body's own
//                     wading model applies (about 2 blocks/s), so a mount is slowest in the water and the fastest vehicle on the road.
//   * Stamina.        Every ridden tick (more when sprinting, and more still in heavy plate) adds to `m.fatigue`. Past TIRE_AT the mount
//                     slows down (down to 55 %), past EXHAUST_AT it cannot sprint and loses a heart now and then (never the last one).
//                     Its food (or a rest, 1 per tick) brings the fatigue down again; the rider is told once, and hears it pant.
//   * Health.         A mount below 30 % health is slower (down to 70 %). Resting, fed mounts heal by themselves.
//   * Gear.           Rows of `m.equip` (the mob equipment, mobs/equipment.js, so snapshots carry it to guests in field 20 untouched):
//                     armour slot 0 is the harness (Thistlehorn), slot 1 the horse armour (Galloper). The saddle is the `saddled` flag.
//   * Following.      A tamed mount that is not told to stay (sneak + use, empty hand) trots after its owner and teleports when far.
//   * Falls.          A rider takes the fall damage of the mount that lands under them.
//   * Dismounting.    The rider is put on the nearest free ground, never inside a block (`safeDismountSpot`).
// Pure rules are exported for the tests; the host simulates mounts, guests only see the flags and the equipment ids.
import { ITEMS, I } from '../world/items.js';
import { B, SOLID } from '../world/blocks.js';
import { PHYS, fallDamage } from '../physics/constants.js';

export const MOUNT = {
  RIDE_SPEED: 1.8,       // top speed in blocks per tick = mob speed x this
  SPRINT: 1.3,           // sprint multiplier of a fresh mount
  MAX_BPS: 12,           // no mount ever goes faster than this (blocks per second)
  TIRE_AT: 4800,         // ridden ticks (4 minutes) until it tires
  EXHAUST_AT: 7800,      // ... and until it is worn out (6.5 minutes)
  TIRED_SPEED: 0.55,     // speed factor when worn out
  REST: 0.5,             // fatigue lost per tick without a rider
  FEED_RELIEF: 3000,     // fatigue lost per feed (about 2.5 minutes of rest)
  SPRINT_COST: 1.6,      // fatigue per ridden tick when sprinting (1 when walking, 0.25 when standing)
  HEALTH_SLOW: 0.3,      // below this fraction of its health a mount slows down
  WEARY_HEALTH: 2,       // exhaustion never takes a mount below this
  WEARY_EVERY: 100,      // ticks between the hits of exhaustion
  REGEN_EVERY: 200,      // a rested mount heals 1 every 10 s
  TAME_CHANCE: 0.25,     // per feed of its food, for mounts that are tamed with food (Thistlehorn)
  FOLLOW_NEAR: 6, FOLLOW_TELEPORT: 28,
};
/** Terminal speed (blocks per tick) per unit of `travel` speed on default ground: 0.98 input scale / (1 - 0.6 x 0.91 friction). */
export const GROUND_GAIN = 0.98 / (1 - PHYS.DEFAULT_SLIPPERINESS * PHYS.GROUND_FRICTION_MUL);

// ---- steering ---------------------------------------------------------------------
const NO_INPUT = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
/** Ticks a guest's last steering message stays valid (a lost one must not leave a mount running). */
export const STEER_TTL = 10;
/** The input steering a ridden mount: the host's own keys, or the last `steer` message of the guest in the saddle (zero once it goes stale). */
export function riderInput(m, g) {
  const r = m.rider;
  if (!r || !r.isRemotePlayer) return g.boatInput;
  const s = m.remoteInput;
  return s && g.ticks - s.at <= STEER_TTL ? s : NO_INPUT;
}
/** Clean a guest's steering message into an input: forward / strafe in -1..1, jump / sprint flags. */
export function cleanSteer(m, ticks) {
  const n = (v) => Math.max(-1, Math.min(1, Number.isFinite(+v) ? +v : 0));
  return { forward: n(m.f), strafe: n(m.s), jump: !!m.j, sneak: false, sprint: !!m.sp, at: ticks };
}
/**
 * A guest right-clicks a host's Galloper or Thistlehorn (a proxy: `netDriver` is who sits in front, -1 for nobody): climb into
 * the saddle when it is tacked up and tame, and the click holds nothing that means something else (food, tack, a lead...).
 */
export function guestWantsMount(mob, p, st) {
  if (!mob.def.rideable || mob.def.strider || p.riding || p.sneaking) return false;
  if (mob.netDriver != null && mob.netDriver >= 0) return false;
  if (mob.deathTime > 0 || mob.age < 0 || !mob.tamed || !mountReady(mob)) return false;
  const d = st && ITEMS[st.id];
  if (d && (d.food || d.saddle || d.horseArmor || d.harness || d.lead || d.nameTag || d.dye || d.shears)) return false;
  return true;
}

/** Is a mount ready to take a guest as its driver? (grown, alive, tamed, saddled, free) -> null, or the reason why not. */
export function driverRefusal(m) {
  if (!m || m.kind !== 'mob' || !m.def || !m.def.rideable) return 'not rideable';
  if (m.deathTime > 0 || m.removed || m.age < 0) return 'cannot be ridden now';
  if (m.rider) return 'taken';
  if (!m.tamed) return 'wild';
  if (!mountReady(m)) return 'needs tack';
  return null;
}

/** Rows of mob equipment (equip.armor[i]) a mount uses. */
export const MOUNT_SLOT = { harness: 0, armor: 1 };

export const horseArmorOf = (st) => (st && ITEMS[st.id] && ITEMS[st.id].horseArmor) || null;
export const harnessOf = (st) => (st && ITEMS[st.id] && ITEMS[st.id].harness) || null;

// ---- gear -----------------------------------------------------------------------
/** A mount's gear: the harness and the horse armour (stacks or null). */
export function mountGear(m) {
  const a = m.equip && m.equip.armor ? m.equip.armor : [];
  return { harness: harnessOf(a[MOUNT_SLOT.harness]) ? a[MOUNT_SLOT.harness] : null, armor: horseArmorOf(a[MOUNT_SLOT.armor]) ? a[MOUNT_SLOT.armor] : null };
}

/** Put a stack (or null) in a gear slot ('harness' / 'armor'); returns what was there. Always drops when the mount dies (equipPicked bit). */
export function setMountGear(m, which, st) {
  if (!m.equip) m.equip = { hand: null, armor: [null, null, null, null] };
  const i = MOUNT_SLOT[which];
  const old = m.equip.armor[i] || null;
  m.equip.armor[i] = st ? { id: st.id, count: 1, damage: 0 } : null;
  // equipment slot numbers count the hand first: armour index i is slot i + 1
  if (st) m.equipPicked = (m.equipPicked | 0) | (1 << (i + 1)); else m.equipPicked = (m.equipPicked | 0) & ~(1 << (i + 1));
  return old;
}

/** Is the mount fully tacked up to be ridden (saddle, and the harness where its kind needs one)? */
export function mountReady(m) {
  if (!m.saddled) return false;
  const cfg = m.def && m.def.mount;
  return !(cfg && cfg.tack) || !!mountGear(m).harness;
}

// ---- stamina and health -----------------------------------------------------------
export function fatigueState(f) {
  return f >= MOUNT.EXHAUST_AT ? 'exhausted' : f >= MOUNT.TIRE_AT ? 'tired' : 'fresh';
}
/** Speed factor of a tiring mount: 1 until it tires, then down to TIRED_SPEED when worn out. */
export function fatigueFactor(f) {
  if (f < MOUNT.TIRE_AT) return 1;
  if (f >= MOUNT.EXHAUST_AT) return MOUNT.TIRED_SPEED;
  return 1 - (1 - MOUNT.TIRED_SPEED) * (f - MOUNT.TIRE_AT) / (MOUNT.EXHAUST_AT - MOUNT.TIRE_AT);
}
/** Speed factor of a hurt mount: 1 above 30 % health, down to 0.7 at none. */
export function healthFactor(health, max) {
  const f = max > 0 ? health / max : 1;
  return f >= MOUNT.HEALTH_SLOW ? 1 : 0.7 + 0.3 * Math.max(0, f) / MOUNT.HEALTH_SLOW;
}
/** How much heavier plate tires its wearer (1 with none). */
export function tiringFactor(m) { const a = mountGear(m).armor; return a ? horseArmorOf(a).tiring : 1; }
/** Fatigue added in one ridden tick. */
export function tireStep(m, moving, sprint) {
  return (moving ? (sprint ? MOUNT.SPRINT_COST : 1) : 0.25) * tiringFactor(m);
}

/** Top speed (blocks per tick) of a ridden mob right now. */
export function mountTopSpeed(m, { sprint = false } = {}) {
  const exhausted = fatigueState(m.fatigue || 0) === 'exhausted';
  const v = m.speed() * MOUNT.RIDE_SPEED * (sprint && !exhausted ? MOUNT.SPRINT : 1) * fatigueFactor(m.fatigue || 0) * healthFactor(m.health, m.maxHealth);
  return Math.min(v, MOUNT.MAX_BPS / 20);
}

/** The `move` of a ridden mount for the steering input { forward, strafe, sprint }: full input, a `mod` that sets the top speed. */
export function rideMove(m, input) {
  const sprint = !!input.sprint && input.forward > 0;
  const top = mountTopSpeed(m, { sprint }), base = m.speed();
  const mod = base > 0 ? top / (GROUND_GAIN * base) : 0;
  return { forward: input.forward > 0 ? 1 : input.forward < 0 ? -0.25 : 0, strafe: (input.strafe || 0) * 0.5, jump: false, mod };
}

/** Jump strength of a ridden mount (a tired one jumps lower). */
export const rideJump = (m) => (m.jumpPower || 0.5) * (fatigueState(m.fatigue || 0) === 'fresh' ? 1 : 0.85);

/** Eating relieves fatigue (and heals): returns the new fatigue. */
export function relieve(m, amount = MOUNT.FEED_RELIEF) {
  m.fatigue = Math.max(0, (m.fatigue || 0) - amount);
  return m.fatigue;
}

const TIRED_TEXT = { tired: 'Your mount is tired: let it rest or feed it', exhausted: 'Your mount is worn out and needs food and rest' };
/** One tick of a mount's stamina (called for every Mob with `def.mount`, host side). */
export function mountTick(m, g) {
  if (m.fatigue === undefined) m.fatigue = 0;
  const before = fatigueState(m.fatigue);
  if (m.rider) {
    const b = m.body, input = riderInput(m, g);
    const moving = Math.hypot(b.vx, b.vz) > 0.05;
    m.fatigue += tireStep(m, moving, !!(input && input.sprint && input.forward > 0));
    // worn out: it weakens, but exhaustion never kills
    if (fatigueState(m.fatigue) === 'exhausted' && g.ticks % MOUNT.WEARY_EVERY === m.id % MOUNT.WEARY_EVERY && m.health > MOUNT.WEARY_HEALTH) m.health = Math.max(MOUNT.WEARY_HEALTH, m.health - 1);
  } else {
    if (m.fatigue > 0) m.fatigue = Math.max(0, m.fatigue - MOUNT.REST);
    if (m.tamed && m.health < m.maxHealth && m.fatigue < MOUNT.TIRE_AT / 2 && g.ticks % MOUNT.REGEN_EVERY === m.id % MOUNT.REGEN_EVERY) m.health = Math.min(m.maxHealth, m.health + 1);
  }
  const after = fatigueState(m.fatigue);
  if (after !== before && m.rider && after !== 'fresh' && m.rider === g.player) {
    if (g.hud && g.hud.toast) g.hud.toast(TIRED_TEXT[after], 3500);
    if (g.audio) g.audio.play('mount_pant', [m.x, m.y + 1, m.z]);
  }
}

/** The gauge shown while riding: 1 = fresh, 0 = worn out. */
export function staminaGauge(m) {
  const f = m && m.fatigue ? m.fatigue : 0;
  return { stamina: Math.max(0, 1 - f / MOUNT.EXHAUST_AT), state: fatigueState(f) };
}

// ---- falls --------------------------------------------------------------------------
/** The fall damage a rider takes when the mount under them lands after `distance` blocks. */
export function riderFallDamage(distance, def) {
  if (def && def.noFallDamage) return 0;
  return fallDamage(distance);
}

// ---- following ----------------------------------------------------------------------
/** Does this player own the mount (a mount of the single-player game answers to everyone)? */
export const ownedBy = (m, p) => !(m.ownerName && p.netName && m.ownerName !== p.netName);

/**
 * A tamed mount trots after its owner (teleporting when far behind). Returns true when it took over the tick.
 * Not while it sits (told to stay), is ridden, young, scared, in love or on a lead.
 */
export function mountFollowStep(m, g, p, pdist) {
  if (!m.def.mount || !m.tamed || m.sitting || m.rider || m.age < 0 || m.panicTicks > 0 || m.loveTicks > 0 || m.leashHolder || m.leashPending) return false;
  if (!p || p.dead || !ownedBy(m, p)) return false;
  if (pdist > MOUNT.FOLLOW_TELEPORT) {
    if (g.ticks % 20 === m.id % 20 && m.teleportTo && m.teleportTo(g, p.x + (Math.random() - 0.5) * 3, p.z + (Math.random() - 0.5) * 3, p.y + 1)) return true;
    return false;
  }
  if (pdist > MOUNT.FOLLOW_NEAR) { m.eatTimer = 0; m.chase(g, p, 1.2); return true; }
  return false;
}

// ---- right-click ----------------------------------------------------------------------
/**
 * Right-click on a mount (the host's / single player's; guests ask the host). Handles horse armour, the harness and saddle of
 * Thistlehorns, feeding (taming, healing, relieving fatigue) and the stay command. Returns true when something happened;
 * false leaves the click to the rest of Mob interaction (saddling and bucking of Gallopers, breeding...).
 */
export function interactMount(g, mob, p, st, use) {
  const cfg = mob.def.mount;
  if (!cfg || mob.deathTime > 0 || mob.age < 0) return false;
  const id = st ? st.id : 0, d = id ? ITEMS[id] : null;
  const say = (t) => { if (g.hud && g.hud.toast) g.hud.toast(t, 2500); };
  const gear = mountGear(mob);
  const give = (old) => { if (old && !p.creative && p.inventory.add(old)) g.entities.spawnItem(p.x, p.y + 1, p.z, old); };
  const tame = () => { mob.tamed = true; mob.persistent = true; mob.ownerName = p.netName || null; mob.hearts(g, 7); };
  // horse armour: a tame mount of a kind that wears it, one piece at a time (a worse one is swapped out)
  if (d && d.horseArmor) {
    if (!cfg.armor) return false;
    if (!mob.tamed) { say('It has to trust you before it wears armour'); return true; }
    if (gear.armor && gear.armor.id === id) return true;
    give(setMountGear(mob, 'armor', st));
    use(); g.audio.play('equip', [mob.x, mob.y + 1, mob.z]);
    return true;
  }
  if (cfg.tack) {
    // harness first, then the saddle: a Thistlehorn is tamed with its food (a chance each time)
    if (d && d.harness === mob.type) {
      if (!mob.tamed) { say('It has to trust you before it takes a harness'); return true; }
      if (gear.harness) return true;
      setMountGear(mob, 'harness', st);
      use(); g.audio.play('harness', [mob.x, mob.y + 1, mob.z]);
      return true;
    }
    if (d && d.saddle) {
      if (!mob.tamed) { say('It has to trust you before it takes a saddle'); return true; }
      if (!gear.harness) { say('It needs a Thistle Harness before a saddle'); return true; }
      if (mob.saddled) return true;
      mob.saddled = true; mob.sitting = false;
      use(); g.audio.play('equip', [mob.x, mob.y + 1, mob.z]);
      return true;
    }
  }
  const food = d && mob.def.food && mob.def.food.includes(id);
  if (food && cfg.tack && !mob.tamed) {
    use();
    mob.temper = Math.min(100, (mob.temper || 0) + 5);
    if (Math.random() < (cfg.tameChance ?? MOUNT.TAME_CHANCE) + (mob.temper || 0) / 400) { tame(); say('The Thistlehorn trusts you now'); } else g.particles.smoke(mob.x, mob.y + mob.height, mob.z, 7, 0.4);
    g.audio.play('eat', [mob.x, mob.y + 1, mob.z]);
    return true;
  }
  // a tired tamed mount is fed back to strength before anything else (breeding food still breeds a rested one)
  if (food && mob.tamed && fatigueState(mob.fatigue || 0) !== 'fresh') {
    feedMount(g, mob, mob.health < mob.maxHealth ? 2 : 0);
    use();
    return true;
  }
  if (cfg.tack && mob.tamed) {
    if (food) {
      if (mob.health < mob.maxHealth) { feedMount(g, mob, 2); use(); return true; }
      if (mob.feed(g)) { use(); g.audio.play('eat', [mob.x, mob.y + 1, mob.z]); return true; }
      return false;
    }
    if (!st || !d || !d.food) {
      if (p.sneaking) { if (!ownedBy(mob, p)) return false; mob.sitting = !mob.sitting; mob.path = null; mob.wander = null; mob.hearts(g, 1, true); return true; }
      if (mountReady(mob) && !mob.rider && !p.riding && !p.isRemotePlayer) { mob.sitting = false; g.mount(mob); return true; }
      if (!mountReady(mob)) { say(mob.saddled ? 'It needs a Thistle Harness' : gear.harness ? 'It needs a Saddle' : 'It needs a Thistle Harness and a Saddle'); return true; }
    }
    return false;
  }
  // Gallopers and the like: sneak with an empty hand to tell a tamed one to stay or follow
  if (mob.tamed && !st && p.sneaking && ownedBy(mob, p)) { mob.sitting = !mob.sitting; mob.path = null; mob.wander = null; mob.hearts(g, 1, true); return true; }
  return false;
}

/** Feed a mount: it eats, heals `heal`, and its fatigue comes down. */
export function feedMount(g, mob, heal = 2) {
  mob.health = Math.min(mob.maxHealth, mob.health + heal);
  relieve(mob);
  g.audio.play('eat', [mob.x, mob.y + 1, mob.z]);
  mob.hearts(g, 2, true);
}

/** Colours of the plate by tier. */
export const HORSE_ARMOR_COLORS = { iron: '#c4c8d0', gold: '#e8c43a', diamond: '#4fd8d0' };
/** Model hook of a Galloper: show the Horse Armour it wears (also on guests' copies, from the equipment ids of the snapshot), tinted by tier. */
export function mountGearRender(m, model) {
  const pa = model.userData.parts;
  if (!pa || !pa.bardingBody) return;
  const a = mountGear(m).armor, h = a ? horseArmorOf(a) : null;
  for (const k of ['bardingBody', 'bardingNeck', 'bardingHead']) pa[k].visible = !!h;
  if (!h) return;
  if (model.userData.bardTier !== h.tier) {
    model.userData.bardTier = h.tier;
    const mm = pa.bardingBody.children[0].material;
    (Array.isArray(mm) ? mm[0] : mm).userData.base.set(HORSE_ARMOR_COLORS[h.tier] || '#c4c8d0'); // (the three plates share one material)
  }
  pa.bardingNeck.rotation.x = pa.neck.rotation.x;
  pa.bardingHead.rotation.x = pa.head.rotation.x;
}

/** What a dying mount drops besides its gear (which the equipment drop covers): its saddle. */
export function mountDeath(m, g) {
  if (m.saddled) g.entities.spawnItem(m.x, m.y + 1, m.z, { id: I.SADDLE, count: 1 });
}

/** Extra state a mount keeps in its save (Gallopers also keep theirs the old way). */
export const mountSave = (m) => ({ saddled: !!m.saddled, temper: m.temper | 0, fatigue: Math.round(m.fatigue || 0), jumpPower: m.jumpPower });
export function mountLoad(m, s) {
  m.saddled = !!s.saddled; m.temper = s.temper | 0;
  if (Number.isFinite(s.fatigue)) m.fatigue = Math.max(0, Math.min(MOUNT.EXHAUST_AT * 2, s.fatigue));
  if (Number.isFinite(s.jumpPower)) m.jumpPower = Math.max(0.3, Math.min(1, s.jumpPower));
}

// ---- boats and carts: seats ---------------------------------------------------------
/** How far ahead of the middle of a boat each seat sits (negative: behind). The driver is in front, the second seat at the back. */
export const BOAT_SEAT_ALONG = [0.2, -0.55];
export const SEAT_HEIGHT = -0.3;
/** Offset [dx, dz] of seat `i` of a boat facing `yaw` (the forward direction is (-sin yaw, -cos yaw)). */
export function boatSeatOffset(yaw, i) {
  const along = BOAT_SEAT_ALONG[i] ?? 0;
  return [-Math.sin(yaw) * along, -Math.cos(yaw) * along];
}
/** Seats of a vehicle: a boat holds two, a Chest Boat one (the chest takes the other), a Minecart one, the cargo and furnace carts none. */
export function seatCountOf(cart, variant) {
  if (cart) return variant ? 0 : 1;
  return variant ? 1 : 2;
}
/** Which seat a new rider gets: the wanted one if free, else the first free one, else -1. `taken[i]` tells whether seat i is occupied. */
export function pickSeat(count, taken, want = -1) {
  if (want >= 0 && want < count && !taken[want]) return want;
  for (let i = 0; i < count; i++) if (!taken[i]) return i;
  return -1;
}
/** May this mob go aboard as a boat's second passenger? Small, calm, land creatures only. */
export function canSeatMob(m) {
  const d = m && m.def;
  if (!d || m.kind !== 'mob' || m.deathTime > 0 || m.removed || m.rider || m.mount || m.passenger || m.boatSeat) return false;
  if (d.category === 'monster' || d.boss || d.flying || d.aquatic || d.fish || d.rideable || d.villager || d.guard) return false;
  return d.height <= 1.3 && d.width <= 1.0;
}

// ---- cargo -----------------------------------------------------------------------------
export const CARGO_SLOTS = 27;
export const newCargo = () => ({ slots: new Array(CARGO_SLOTS).fill(null) });
/** A cargo from saved data, validated: 27 slots of known items. */
export function cargoFromSave(s) {
  const out = newCargo();
  if (s && Array.isArray(s.slots)) {
    for (let i = 0; i < CARGO_SLOTS; i++) {
      const x = s.slots[i];
      if (x && Number.isInteger(x.id) && ITEMS[x.id] && Number.isInteger(x.count) && x.count > 0) out.slots[i] = { ...x, count: Math.min(x.count, ITEMS[x.id].stack || 64) };
    }
  }
  return out;
}
export const cargoItems = (c) => (c ? c.slots.filter(Boolean) : []);

// ---- furnace cart ------------------------------------------------------------------------
export const FURNACE_CART = { MAX_FUEL: 6400, ACCEL: 0.02, TOP: 0.2, PUSH_RANGE: 1.25, FUEL_FACTOR: 1.5, MIN_PUSH: 0.05 };
/** Fuel ticks one item adds (its burn time, a little longer in a cart's firebox), or 0 for a non-fuel. */
export function cartFuelTicks(id) {
  const f = ITEMS[id] && ITEMS[id].fuel;
  return f ? Math.round(f * FURNACE_CART.FUEL_FACTOR) : 0;
}
/** Which way along its track a furnace cart pushes: the way it already rolls, else the way it was fuelled (`along`, the heading's part on the track). */
export const furnaceWant = (s, along) => (Math.abs(s) > 0.02 ? Math.sign(s) : Math.sign(along) || 1);
/** Speed along the track (signed) of a burning furnace cart: it pulls `want` (+1 / -1) up to TOP, and never slows a faster cart down. */
export function furnaceSpeed(s, fuel, want = 1) {
  if (fuel <= 0 || s * want >= FURNACE_CART.TOP) return s;
  return s + want * FURNACE_CART.ACCEL;
}
/** The push a furnace cart (velocity vx, vz) gives a cart `other` ahead of it: the velocity to add so it keeps up, or null. */
export function cartPush(vx, vz, other) {
  const sv = Math.hypot(vx, vz);
  if (sv < FURNACE_CART.MIN_PUSH) return null;
  const ux = vx / sv, uz = vz / sv, along = other.vx * ux + other.vz * uz;
  return along < sv ? [ux * (sv - along), uz * (sv - along)] : null;
}

// ---- dismounting ---------------------------------------------------------------------------
const HAZARD = new Set([B.LAVA, B.FIRE, B.CACTUS, B.COBWEB]);
const free = (id) => !SOLID[id] && !HAZARD.has(id) && id !== B.LAVA;
/**
 * A spot (feet position) where a rider can step off: solid, harmless ground with two free cells above it, dry if possible, the nearest
 * to (x, y, z). Never inside a block: when nothing is near, the column is climbed to the first free cells.
 */
export function safeDismountSpot(world, x, y, z, radius = 2) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const ok = (cx, cy, cz, wet) => {
    const floor = world.getBlock(cx, cy - 1, cz), feet = world.getBlock(cx, cy, cz), head = world.getBlock(cx, cy + 1, cz);
    if (!SOLID[floor] || HAZARD.has(floor) || !free(feet) || !free(head)) return false;
    return wet || (feet !== B.WATER && head !== B.WATER);
  };
  for (const wet of [false, true]) {
    let best = null, bd = Infinity;
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (const dy of [0, 1, -1, 2, -2]) {
      const d = dx * dx + dz * dz + dy * dy * 0.5;
      if (d >= bd || !ok(bx + dx, by + dy, bz + dz, wet)) continue;
      bd = d; best = { x: bx + dx + 0.5, y: by + dy, z: bz + dz + 0.5 };
    }
    if (best) return best;
  }
  // a boat over deep water or a ledge: stay over the same column, up out of any block
  for (let dy = 0; dy < 12; dy++) {
    if (free(world.getBlock(bx, by + dy, bz)) && free(world.getBlock(bx, by + dy + 1, bz))) return { x: bx + 0.5, y: by + dy, z: bz + 0.5 };
  }
  return { x: bx + 0.5, y: by + 12, z: bz + 0.5 };
}
