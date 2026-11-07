// Non-mob entities: dropped items, falling blocks and arrows, plus the
// manager that ticks and renders every entity (mobs included).
import * as THREE from 'three';
import { Body } from '../physics/body.js';
import { B, BLOCKS, SOLID, SHAPE, isFluid, isBlockId } from '../world/blocks.js';
import { stalactiteDamage, crystalTex, FACING_DOWN } from '../world/caves.js';
import { ITEMS, I, maxStack } from '../world/items.js';
import { POTIONS } from '../world/potions.js';
import { itemCanvas } from '../ui/icons.js';
import { texturePixels } from '../world/textures.js';
import { MIN_Y } from '../world/constants.js';
import { addXp, splitOrbs } from '../player/experience.js';
import { RAIL_EXITS, RAIL_UP, RAIL_ON, railHeight, railShapeOf, isRail } from '../world/rails.js';
import { railSpeed } from '../world/automation.js';
import { withExtras, canStack, isGlinting, arrowDamage, mendFromXp } from '../world/enchantments.js';
import { splashPotion } from './splash.js';
import { ArmorStand, STAND_WIDTH, STAND_HEIGHT } from './armorStand.js';
import { tickSpear } from './tidespear.js';
import { buildSpearModel, lightSpear } from '../render/spearModel.js';
import { seatCountOf, pickSeat, boatSeatOffset, newCargo, cargoItems, riderFallDamage, safeDismountSpot, FURNACE_CART, furnaceWant, furnaceSpeed, cartPush } from '../mobs/mounts.js';

let nextEntityId = 1;
export const ENTITY_RENDER_DIST = 64;
const SHADOW_CAST_DIST = 24;
const texCache = new Map();
function iconTexture(id, glint = false) {
  const key = glint ? id + ':g' : id;
  if (texCache.has(key)) return texCache.get(key);
  const c = itemCanvas(id, glint);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}
const blockTexCache = new Map();
export function blockFaceTexture(name) {
  if (blockTexCache.has(name)) return blockTexCache.get(name);
  const px = texturePixels(name);
  const t = new THREE.DataTexture(new Uint8Array(px), 16, 16, THREE.RGBAFormat);
  t.flipY = true;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  blockTexCache.set(name, t);
  return t;
}

/** Is this item drawn as a little 3-D cube when dropped (full-block shapes only)? */
function droppedCube(id) {
  const d = isBlockId(id) ? BLOCKS[id] : null;
  return !!(d && d.tex && d.tex.side && (d.shape === SHAPE.CUBE || d.shape === SHAPE.CACTUS) && !d.flatIcon);
}

/** Brightness multiplier for entity rendering from the light at a position. */
export function lightAt(game, x, y, z) {
  const w = game.world;
  const l = w.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
  const sky = Math.max(0, (l >> 4) - game.sky.state.skyDarken * 0) / 15;
  let blk = (l & 15) / 15;
  if (game.handLight > 0 && game.player) { const p = game.player, d = Math.hypot(x - p.x, y - p.y - 1.5, z - p.z); blk = Math.max(blk, Math.max(0, game.handLight - d * 1.1) / 15); }
  for (const s of game.remoteLights || []) blk = Math.max(blk, Math.max(0, s.level - Math.hypot(x - s.x, y - s.y, z - s.z) * 1.1) / 15);
  const curve = (f) => { const b = f / (4 - 3 * f); return b * 0.45 + (1 - Math.pow(1 - b, 4)) * 0.55; };
  return Math.max(curve(sky), curve(blk) * 0.95, game.minEntityLight || 0.06, (game.nightVision || 0) * 0.8);
}

export class ItemEntity {
  constructor(x, y, z, st) {
    this.id = nextEntityId++;
    this.kind = 'item';
    this.body = new Body(0.25, 0.25);
    this.body.stepHeight = 0;
    this.body.setPos(x, y, z);
    this.stack = withExtras({ id: st.id, count: st.count, damage: st.damage || 0 }, st); // keeps enchantments
    this.age = 0;
    this.pickupDelay = 10;
    this.dead = false;
    this.prev = [x, y, z];
    this.bob = Math.random() * Math.PI * 2;
    this.rest = 0; // consecutive ticks spent lying still on the ground (a resting item only runs its physics every 4th tick)
  }
  get x() { return this.body.x; } get y() { return this.body.y; } get z() { return this.body.z; }

  tick(game) {
    const b = this.body;
    if (this.rest >= ITEM_SLEEP_AFTER && this.pickupDelay === 0 && (this.age & 3) !== 3) {
      // asleep: nothing moves, so only count the age (the 4th tick below looks at the floor again, so a mined block still drops it)
      const sv = this.prev; sv[0] = b.x; sv[1] = b.y; sv[2] = b.z;
      if (++this.age >= 6000) this.dead = true;
      return;
    }
    const pv = this.prev; pv[0] = b.x; pv[1] = b.y; pv[2] = b.z;
    if (this.pickupDelay > 0) this.pickupDelay--;
    b.updateFluidState(game.world, 0.1);
    if (b.inWater) { b.vy += 0.0005; b.vy = Math.min(b.vy * 0.95 + 0.01, 0.06); }
    else b.vy -= 0.04;
    b.move(game.world, b.vx, b.vy, b.vz);
    let f = 0.98;
    if (b.onGround) f = b.groundSlipperiness(game.world) * 0.98;
    b.vx *= f; b.vz *= f; b.vy *= 0.98;
    if (b.onGround) b.vy *= -0.5;
    if (b.inLava) { this.dead = true; return; }
    if (++this.age >= 6000 || b.y < MIN_Y - 64) this.dead = true;
    // lying still on a floor (not in a fluid): after a few such ticks the item goes to sleep
    this.rest = b.onGround && !b.inWater && Math.abs(b.vx) < 0.004 && Math.abs(b.vz) < 0.004 && Math.abs(b.vy) < 0.06 ? this.rest + 1 : 0;
  }
}

/** Ticks an item lies still before it sleeps, and the most loose items kept in loaded chunks (the oldest ones vanish beyond it). */
export const ITEM_SLEEP_AFTER = 8;
export const MAX_LOOSE_ITEMS = 800;

// Experience orb: drifts towards a player within 8 blocks and is absorbed on contact.
let orbTexture = null;
function xpOrbTexture() {
  if (orbTexture) return orbTexture;
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const px = ['......', '..oo..', '.oHho.', '.ohho.', '..oo..', '......'];
  const col = { o: '#3d8a14', h: '#b8f03a', H: '#f4ffb0' };
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) { const ch = px[y][x]; if (ch !== '.') { ctx.fillStyle = col[ch]; ctx.fillRect(2 + x * 2, 2 + y * 2, 2, 2); } }
  orbTexture = new THREE.CanvasTexture(c);
  orbTexture.magFilter = THREE.NearestFilter; orbTexture.minFilter = THREE.NearestFilter; orbTexture.colorSpace = THREE.SRGBColorSpace;
  return orbTexture;
}

export class XPOrb {
  constructor(x, y, z, value) {
    this.id = nextEntityId++;
    this.kind = 'xp';
    this.value = value;
    this.body = new Body(0.5, 0.5);
    this.body.stepHeight = 0;
    this.body.setPos(x, y, z);
    this.body.vx = (Math.random() * 0.2 - 0.1) * 2; this.body.vy = Math.random() * 0.2 * 2; this.body.vz = (Math.random() * 0.2 - 0.1) * 2;
    this.age = 0;
    this.dead = false;
    this.prev = [x, y, z];
    this.phase = Math.random() * 6.28;
  }
  get x() { return this.body.x; } get y() { return this.body.y; } get z() { return this.body.z; }

  tick(game) {
    const b = this.body, p = game.player;
    this.prev = [b.x, b.y, b.z];
    b.vy -= 0.03;
    // follow the player (reference: within 8 blocks, pull scales with (1 - d/8)^2)
    if (!p.dead) {
      const dx = p.x - b.x, dy = p.y + p.eyeHeight / 2 - b.y, dz = p.z - b.z;
      const d = Math.hypot(dx, dy, dz) / 8;
      if (d < 1) {
        const f = (1 - d) * (1 - d) * 0.1;
        b.vx += dx / (d * 8 || 1) * f; b.vy += dy / (d * 8 || 1) * f; b.vz += dz / (d * 8 || 1) * f;
      }
    }
    b.move(game.world, b.vx, b.vy, b.vz);
    let f = 0.98;
    if (b.onGround) f = b.groundSlipperiness(game.world) * 0.98;
    b.vx *= f; b.vz *= f; b.vy *= 0.98;
    if (b.onGround) b.vy *= -0.9;
    if (++this.age >= 6000 || b.y < MIN_Y - 64) this.dead = true;
  }
}

// Boat: floats on water, steered by its rider (W/S thrust, A/D turn). A boat seats two (the driver in front, a passenger behind: a second
// player, or a calm creature led aboard); a Chest Boat has one seat and a 27-slot chest at the back. Variants (`variant`: 'chest') and their
// seats live in mobs/mounts.js.
export class Boat {
  constructor(x, y, z, yaw = 0, variant = null) {
    this.id = nextEntityId++;
    this.kind = 'boat';
    this.body = new Body(1.375, 0.5625);
    this.body.stepHeight = 0;
    this.body.setPos(x, y, z);
    this.yaw = yaw; this.prevYaw = yaw;
    this.variant = variant === 'chest' || variant === 'furnace' ? variant : null;
    this.rider = null;                  // the local player in seat 0 (the driver)
    this.rider2 = null;                 // the local player in seat 1
    this.remoteRider = null; this.remoteRider2 = null; // guests (ids) in seats 0 / 1 (multiplayer)
    this.mobPassenger = null;           // a creature led aboard (seat 1)
    this.cargo = this.variant === 'chest' ? newCargo() : null;
    this.dropId = this.variant === 'chest' ? I.OAK_CHEST_BOAT : I.OAK_BOAT;
    this.hits = 0; this.hitTime = 0;
    this.dead = false;
    this.prev = [x, y, z];
  }
  get x() { return this.body.x; } get y() { return this.body.y; } get z() { return this.body.z; }
  get width() { return 1.375; } get height() { return 0.5625; }
  get hasCargo() { return !!this.cargo; }
  get furnace() { return this.variant === 'furnace'; }
  get seatCount() { return seatCountOf(!!this.cart, this.variant); }
  /** Is seat i taken (by us, a guest, or a creature)? On a guest's copy `seatSeen` carries what the host's snapshot said. */
  seatTaken(i) {
    if (i === 0) return !!(this.rider || this.remoteRider != null);
    return !!(this.rider2 || this.remoteRider2 != null || this.mobPassenger || this.mobSeen);
  }
  /** The seat a new rider would get (`want` first if free), or -1. */
  freeSeat(want = -1) { return pickSeat(this.seatCount, [this.seatTaken(0), this.seatTaken(1)], want); }
  /** Is a player (local or a guest) in seat 0 or 1? */
  hasPlayers() { return !!(this.rider || this.rider2 || this.remoteRider != null || this.remoteRider2 != null); }

  /** A creature goes aboard as the second passenger (it sits still until let off or the boat breaks). */
  boardMob(m) {
    this.mobPassenger = m; m.boatSeat = this;
    m.path = null; m.wander = null; m.target = null; m.persistent = true;
    this.seatMob(m);
  }
  seatMob(m) {
    const [dx, dz] = boatSeatOffset(this.yaw, 1), b = m.body;
    m.prev = [b.x, b.y, b.z];
    b.setPos(this.x + dx, this.y + 0.1, this.z + dz);
    b.vx = b.vy = b.vz = 0; b.fallDistance = 0;
    m.yaw = this.yaw;
  }
  /** Let the creature off on the nearest free ground. */
  unloadMob(game) {
    const m = this.mobPassenger;
    if (!m) return;
    this.mobPassenger = null; m.boatSeat = null;
    const spot = safeDismountSpot(game.world, this.x, this.y, this.z, 2);
    m.body.setPos(spot.x, spot.y, spot.z);
    m.prev = [spot.x, spot.y, spot.z];
  }

  /** Height of the water surface under the boat, or null on land. */
  waterLevel(world) {
    const b = this.body, x = Math.floor(b.x), z = Math.floor(b.z);
    for (let y = Math.floor(b.y + 0.6); y >= Math.floor(b.y - 0.6); y--) {
      if (world.getBlock(x, y, z) === B.WATER) return y + (world.getBlock(x, y + 1, z) === B.WATER ? 1 : 0.89);
    }
    return null;
  }

  tick(game, input) {
    const b = this.body, w = game.world;
    this.prev = [b.x, b.y, b.z];
    this.prevYaw = this.yaw;
    if (this.hitTime > 0 && --this.hitTime === 0) this.hits = 0;
    let thrust = 0;
    if (this.rider && input) {
      // reference speeds: 0.04 forward, 0.005 backward, about 1 degree of turn per tick while moving
      this.yaw -= (input.strafe || 0) * 0.05;
      thrust = input.forward > 0 ? 0.04 : input.forward < 0 ? -0.005 : 0;
      b.vx += -Math.sin(this.yaw) * thrust; b.vz += -Math.cos(this.yaw) * thrust;
    }
    const level = this.waterLevel(w);
    if (level !== null) {
      b.vy += (level - 0.12 - b.y) * 0.25; // bob up to the surface
      b.vy *= 0.65;
      b.vx *= 0.9; b.vz *= 0.9;
      b.fallDistance = 0;
      if (thrust > 0 && game.ticks % 14 === 0 && game.audio) game.audio.play('paddle', [b.x, b.y, b.z], 0.45);
    } else {
      b.vy -= 0.04;
      const slip = b.onGround ? b.groundSlipperiness(w) : 0.98;
      const f = slip >= 0.9 ? 0.9 : 0.5; // on land a boat barely moves (ice excepted)
      b.vx *= f; b.vz *= f;
    }
    b.move(w, b.vx, b.vy, b.vz);
    // a boat that comes down on land shakes whoever sits in it (as the mount under a rider does)
    if (b.onGround && b.fallDistance > 0) {
      const dmg = level === null ? riderFallDamage(b.fallDistance) : 0;
      if (dmg > 0) for (const r of [this.rider, this.rider2]) if (r && !r.dead && r.hurt) r.hurt(dmg, 'fall');
      b.fallDistance = 0;
    }
    if (this.mobPassenger) {
      const m = this.mobPassenger;
      if (m.dead || m.removed || m.deathTime > 0 || m.boatSeat !== this) { if (m.boatSeat === this) m.boatSeat = null; this.mobPassenger = null; } else this.seatMob(m);
    }
    if (b.y < MIN_Y - 64) this.dead = true;
  }
}

/**
 * Minecarts ride like boats (same mounting, hits and multiplayer sync) but
 * follow rails: the velocity is projected on the track between the rail's two
 * exits, slopes pull them down (1/128 per tick), drag is 0.997 ridden / 0.96
 * empty, top speed 0.4 blocks per tick; off the rails they slide to a stop.
 */
export class Minecart extends Boat {
  constructor(x, y, z, yaw = 0, variant = null) {
    super(x, y, z, yaw, variant === 'furnace' ? 'furnace' : variant === 'chest' ? 'chest' : null);
    this.cart = true;
    this.body = new Body(0.98, 0.7);
    this.body.stepHeight = 0;
    this.body.setPos(x, y, z);
    this.seatY = 0.1;
    this.dropId = this.variant === 'chest' ? I.MINECART_CHEST : this.variant === 'furnace' ? I.MINECART_FURNACE : I.MINECART;
    this.pitch = 0; this.prevPitch = 0;
    this.fuel = 0; this.heading = [0, 0]; // a Minecart with Furnace: ticks of fuel left and the way it was pushed off
  }
  get width() { return 0.98; } get height() { return 0.7; }
  /** Is the furnace alight? (Guests see it from the snapshot: `fuel` is 1 there.) */
  get lit() { return this.fuel > 0; }
  /** Stoke the furnace with `ticks` of fuel; it pushes off the way `yaw` looks. False when it is full. */
  addFuel(ticks, yaw) {
    if (!this.furnace || this.fuel >= FURNACE_CART.MAX_FUEL) return false;
    this.fuel = Math.min(FURNACE_CART.MAX_FUEL, this.fuel + Math.max(0, ticks));
    this.heading = [-Math.sin(yaw), -Math.cos(yaw)];
    return true;
  }
  /** Guest copies: the fire's smoke, drawn from the lit flag of the snapshot. */
  proxyTick(game) { if (this.fuel > 0 && game.ticks % 5 === 0 && game.particles) game.particles.smoke(this.x, this.y + 0.95, this.z, 1, 0.15); }

  railAt(w, x, y, z) {
    for (const dy of [0, -1, 1]) if (isRail(w.getBlock(x, y + dy, z))) return y + dy;
    return null;
  }

  tick(game, input) {
    const b = this.body, w = game.world;
    this.prev = [b.x, b.y, b.z];
    this.prevYaw = this.yaw; this.prevPitch = this.pitch;
    if (this.hitTime > 0 && --this.hitTime === 0) this.hits = 0;
    const bx = Math.floor(b.x), bz = Math.floor(b.z), ry = this.railAt(w, bx, Math.floor(b.y + 0.1), bz);
    if (ry === null) {
      // derailed: plain physics
      b.vy -= 0.04;
      if (b.onGround) { b.vx *= 0.5; b.vz *= 0.5; } else { b.vx *= 0.95; b.vz *= 0.95; }
      b.move(w, b.vx, b.vy, b.vz);
      this.pitch *= 0.8;
      if (b.y < MIN_Y - 64) this.dead = true;
      return;
    }
    const railId = w.getBlock(bx, ry, bz), railMeta = w.getMeta(bx, ry, bz), m = railShapeOf(railId, railMeta);
    const [[ax, az], [cx, cz]] = RAIL_EXITS[m];
    // an Activator Rail that is on throws the rider out
    if (railId === B.ACTIVATOR_RAIL && railMeta & RAIL_ON && this.rider) { if (game.player.riding === this) game.dismount(); else this.rider = null; }
    // track: from the middle of edge a to the middle of edge b (curves cut the corner, as in the reference)
    let dx = cx - ax, dz = cz - az; const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
    let s = b.vx * dx + b.vz * dz;
    const up = RAIL_UP[m];
    if (up) s -= (up[0] * dx + up[1] * dz) * 0.0078125; // gravity along the slope
    if (this.rider && input && input.forward) {
      const lx = -Math.sin(this.rider.yaw), lz = -Math.cos(this.rider.yaw);
      s += Math.sign(lx * dx + lz * dz) * 0.006 * input.forward;
    }
    s *= this.rider ? 0.997 : 0.96;
    s = Math.max(-0.4, Math.min(0.4, s));
    // a Minecart with Furnace pulls itself along while the fire burns (mobs/mounts.js): it pushes off the way it was fuelled and keeps going that way
    if (this.furnace && this.fuel > 0) {
      this.fuel--;
      s = furnaceSpeed(s, this.fuel, furnaceWant(s, this.heading[0] * dx + this.heading[1] * dz));
      if (game.ticks % 5 === 0 && game.particles) game.particles.smoke(b.x, b.y + 0.95, b.z, 1, 0.15);
    }
    // a Powered Rail speeds the cart up while it is on and holds it back while it is off (world/automation.js)
    if (railId === B.POWERED_RAIL) {
      const wall = (ex, ez) => !!SOLID[w.getBlock(bx + ex, ry, bz + ez)] || (!!up && up[0] === ex && up[1] === ez && !!SOLID[w.getBlock(bx + ex, ry + 1, bz + ez)]);
      s = Math.max(-0.4, Math.min(0.4, railSpeed(railId, !!(railMeta & RAIL_ON), s, [wall(ax, az), wall(cx, cz)])));
    }
    // snap onto the track line
    const ox = bx + 0.5 + ax * 0.5, oz = bz + 0.5 + az * 0.5;
    const t = (b.x - ox) * dx + (b.z - oz) * dz;
    let nx = ox + dx * t + dx * s, nz = oz + dz * t + dz * s;
    // blocked by a wall ahead
    const fx = Math.floor(nx + Math.sign(dx * s) * 0.49), fz = Math.floor(nz + Math.sign(dz * s) * 0.49);
    if (SOLID[w.getBlock(fx, ry, fz)] && (fx !== bx || fz !== bz) && !(up && isRail(w.getBlock(fx, ry + 1, fz)))) { s = 0; nx = ox + dx * t; nz = oz + dz * t; }
    const nbx = Math.floor(nx), nbz = Math.floor(nz);
    const nry = this.railAt(w, nbx, ry, nbz);
    let ny;
    if (nry !== null) ny = nry + railHeight(railShapeOf(w.getBlock(nbx, nry, nbz), w.getMeta(nbx, nry, nbz)), nx - nbx, nz - nbz);
    else ny = ry + railHeight(m, Math.max(0, Math.min(1, nx - bx)), Math.max(0, Math.min(1, nz - bz)));
    b.vx = dx * s; b.vz = dz * s; b.vy = 0;
    b.setPos(nx, ny, nz);
    b.onGround = true; b.fallDistance = 0;
    if (Math.abs(s) > 0.001) {
      const yaw = Math.atan2(-dx * Math.sign(s), -dz * Math.sign(s));
      let d = yaw - this.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      // a cart has no front: turn the short way
      if (Math.abs(d) > Math.PI / 2) d += d > 0 ? -Math.PI : Math.PI;
      this.yaw += d;
    }
    this.pitch = up ? Math.atan2(1, 1) * Math.sign(-(up[0] * Math.sin(this.yaw) + up[1] * Math.cos(this.yaw))) : 0;
    if (Math.abs(s) > 0.1 && game.ticks % 6 === 0) game.audio.play('rail', [nx, ny, nz], Math.min(1, Math.abs(s) * 2.5));
    if (this.furnace && Math.abs(s) > 0.02) this.pushCarts(game);
  }

  /** A burning furnace cart shoves the carts right ahead of it along at its own speed. */
  pushCarts(game) {
    const b = this.body, sv = Math.hypot(b.vx, b.vz);
    if (sv < FURNACE_CART.MIN_PUSH) return;
    const ux = b.vx / sv, uz = b.vz / sv;
    for (const e of game.entities.list) {
      if (e === this || e.kind !== 'boat' || !e.cart || e.dead || e.netProxy) continue;
      const rx = e.x - b.x, rz = e.z - b.z, ahead = rx * ux + rz * uz, side = Math.abs(rx * uz - rz * ux);
      if (ahead <= 0 || ahead > FURNACE_CART.PUSH_RANGE || side > 0.8 || Math.abs(e.y - b.y) > 1) continue;
      const push = cartPush(b.vx, b.vz, e.body);
      if (push) { e.body.vx += push[0]; e.body.vz += push[1]; }
    }
  }
}

export class FallingBlock {
  constructor(x, y, z, blockId) {
    this.id = nextEntityId++;
    this.kind = 'falling';
    this.body = new Body(0.98, 0.98);
    this.body.stepHeight = 0;
    this.body.setPos(x + 0.5, y, z + 0.5);
    this.blockId = blockId;
    this.dead = false;
    this.age = 0;
    this.prev = [x + 0.5, y, z + 0.5];
    this.meta = 0;
    this.startY = y;
    this.hurtLength = 0;   // a falling Seepstone spike tip: hurts what it falls on (length of the spike)
    this.shatters = false; // breaks into its item when it lands
  }
  get x() { return this.body.x; } get y() { return this.body.y; } get z() { return this.body.z; }
  tick(game) {
    const b = this.body;
    this.prev = [b.x, b.y, b.z];
    b.vy -= 0.04;
    b.move(game.world, 0, b.vy, 0);
    b.vy *= 0.98;
    this.age++;
    if (this.hurtLength) this.hurtBelow(game);
    if (this.shatters && (b.onGround || this.age > 600)) {
      game.entities.spawnItem(b.x, b.y + 0.3, b.z, { id: this.blockId, count: 1 });
      game.audio.play('break_stone', [b.x, b.y, b.z]);
      this.dead = true;
      return;
    }
    if (b.onGround || this.age > 600) {
      const w = game.world;
      const bx = Math.floor(b.x), by = Math.round(b.y), bz = Math.floor(b.z);
      const cur = w.getBlock(bx, by, bz);
      if (!cur || BLOCKS[cur].replaceable) {
        if (cur && !isFluid(cur)) w.breakBlock(bx, by, bz, true);
        w.setBlock(bx, by, bz, this.blockId);
      } else game.entities.spawnItem(b.x, b.y + 0.5, b.z, { id: this.blockId, count: 1 });
      this.dead = true;
    }
  }
  /** A falling stalactite hits each creature under it once (reference: per block fallen, at most max(length, 6)). */
  hurtBelow(game) {
    const b = this.body, hit = this.hitIds || (this.hitIds = new Set());
    const over = (e, w, h) => Math.abs(e.x - b.x) < 0.49 + w / 2 && Math.abs(e.z - b.z) < 0.49 + w / 2 && b.y < e.y + h && b.y + 0.98 > e.y;
    const dmg = stalactiteDamage(this.startY - b.y, this.hurtLength);
    if (dmg <= 0) return;
    const p = game.player;
    if (!p.dead && !p.creative && !hit.has('player') && over(p, 0.6, 1.8)) { hit.add('player'); p.hurt(dmg, 'stalactite'); }
    for (const e of game.entities.list) {
      if (e.kind !== 'mob' || e.deathTime !== 0 || hit.has(e.id) || !over(e, e.body ? e.body.width : 0.6, e.body ? e.body.height : 1.8)) continue;
      hit.add(e.id); e.hurt(dmg, 'stalactite', null, 0);
    }
  }
}

export class Arrow {
  constructor(x, y, z, vx, vy, vz, shooter, crit = false, thrown = null, potion = 0) {
    this.id = nextEntityId++;
    this.kind = 'arrow';
    this.thrown = thrown; // 'snowball' / 'egg' / 'potion': breaks on impact instead of sticking
    this.potion = potion; // the splash elixir's item id when thrown === 'potion'
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.shooter = shooter;
    this.crit = crit;
    this.stuck = false;
    this.age = 0;
    this.dead = false;
    this.prev = [x, y, z];
    this.pickup = !thrown && shooter && shooter.isPlayer;
    this.item = null; // a thrown Tidespear: the stack it is (null for a Sodden Shambler's)
    this.creativeThrow = false; // thrown in creative: the thrower kept it, so it never turns into an item
    this.pickupId = I.ARROW; // a tipped arrow is picked back up as itself
  }

  /** Make this a tipped arrow (item id): its hit lays an eighth of the elixir's effect. */
  setTip(id) {
    const d = ITEMS[id], fx = d && d.tipped && POTIONS[d.tipped].effects;
    if (!fx || !fx.length) return;
    this.pickupId = id;
    this.tipEffects = fx.map(([type, ticks, amp]) => [type, Math.max(1, Math.floor(ticks / 8)), amp]); // every effect (the Shellback elixir has two)
    this.effect = this.tipEffects[0];
  }

  /** A thrown Tidespear turns into a dropped item here (the host shares it like any drop). */
  land(game) {
    this.dead = true;
    if (this.item && !this.creativeThrow && (!game.net || !game.net.isClient)) game.entities.spawnItem(this.x - this.vx * 0.1, this.y + 0.1, this.z - this.vz * 0.1, this.item, [0, 0.05, 0]);
    game.audio.play('arrow_hit', [this.x, this.y, this.z]);
  }

  /** A snowball or egg hits something: puff, and an egg may hatch Clucklings (1/8, of which 1/32 four). */
  shatter(game, direct = null) {
    this.dead = true;
    if (this.thrown === 'potion') { splashPotion(game, this.x, this.y, this.z, this.potion, direct, this.shooter); return; }
    const col = this.thrown === 'egg' ? [0.95, 0.9, 0.78] : [0.95, 0.97, 1];
    for (let k = 0; k < 8; k++) game.particles.emit(this.x, this.y, this.z, (Math.random() - 0.5) * 0.12, Math.random() * 0.1, (Math.random() - 0.5) * 0.12, col[0], col[1], col[2], 14, -0.004);
    if (this.thrown === 'egg' && (!game.net || game.net.isHost) && Math.random() < 1 / 8) {
      const n = Math.random() < 1 / 32 ? 4 : 1;
      for (let k = 0; k < n; k++) { const c = game.spawner.spawnMob('cluckling', this.x, this.y, this.z); if (c) c.setBaby(true); }
    }
  }
  tick(game) {
    this.prev = [this.x, this.y, this.z];
    this.age++;
    if (this.thrown === 'spear') { tickSpear(this, game); return; } // tidespear.js
    if (this.stuck) {
      if (this.age > 1200) this.dead = true;
      const p = game.player;
      if (this.pickup && !p.dead && Math.abs(p.x - this.x) < 1.2 && Math.abs(p.z - this.z) < 1.2 && this.y > p.y - 0.5 && this.y < p.y + 2.3) {
        if (p.inventory.add({ id: this.pickupId || I.ARROW, count: 1 }) === 0) { this.dead = true; game.audio.play('pop'); }
      }
      return;
    }
    const w = game.world;
    const speed = Math.hypot(this.vx, this.vy, this.vz);
    // block collision via raycast along the step
    const hit = w.raycast(this.x, this.y, this.z, this.vx / speed, this.vy / speed, this.vz / speed, speed);
    let endT = hit ? hit.dist : speed;
    // entity collision
    const target = game.entities.sweepHit(this, this.x, this.y, this.z, this.vx / speed, this.vy / speed, this.vz / speed, endT);
    if (target && this.thrown) {
      // no damage, just a knock (snowballs and eggs); an elixir breaks on whoever it hits
      if (this.thrown === 'potion') { const t = rayAABBDist(this, target); this.x += this.vx / speed * t; this.y += this.vy / speed * t; this.z += this.vz / speed * t; }
      else target.hurt(0.0001, 'thrown', this.shooter, 0.35, this);
      this.shatter(game, target);
      return;
    }
    if (target) {
      let dmg = arrowDamage(speed, this.power | 0);
      if (this.crit) dmg += Math.floor(Math.random() * (dmg / 2 + 2));
      const ok = target.hurt(dmg, 'arrow', this.shooter, 0.6, this);
      // tipped arrows (Rime Rattlers shoot Slowness)
      if (ok && target.applyEffect) for (const fx of this.tipEffects || (this.effect ? [this.effect] : [])) target.applyEffect(fx[0], fx[1], fx[2], 1, this.shooter);
      if (ok) { this.dead = true; return; }
      // deflected
      this.vx *= -0.1; this.vy *= -0.1; this.vz *= -0.1;
      return;
    }
    if (hit && this.thrown) { this.x += this.vx / speed * hit.dist; this.y += this.vy / speed * hit.dist; this.z += this.vz / speed * hit.dist; if (game.onProjectileHit) game.onProjectileHit(hit, this.x, this.y, this.z, this.thrown); this.shatter(game); return; }
    if (hit) {
      this.x += this.vx / speed * hit.dist; this.y += this.vy / speed * hit.dist; this.z += this.vz / speed * hit.dist;
      this.stuck = true; this.age = 0;
      game.audio.play('arrow_hit', [this.x, this.y, this.z]);
      if (game.onProjectileHit) game.onProjectileHit(hit, this.x, this.y, this.z, 'arrow'); // a target block answers
      return;
    }
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    const inWater = w.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) === B.WATER;
    const drag = inWater ? 0.6 : 0.99;
    this.vx *= drag; this.vy *= drag; this.vz *= drag;
    this.vy -= this.thrown && this.thrown !== 'potion' ? 0.03 : 0.05;
    if (this.y < MIN_Y - 64 || this.age > 1200) this.dead = true;
  }
}

const tmpBox = new THREE.Box3();

/** Most items, orbs and arrows kept frozen in unloaded chunks (see EntityManager.trimFrozen). */
export const MAX_FROZEN = 192;

/** A chest or a furnace box on a boat or cart: textured like the blocks, its front towards -z. The materials join the model's (`userData.mats`) so they are lit and freed with it. */
function addCargoBox(g, variant, w, h, d, x, y, z) {
  const tex = (n) => new THREE.MeshLambertMaterial({ map: blockFaceTexture(n) });
  const side = tex(variant === 'chest' ? 'chest_side' : 'furnace_side'), top = tex(variant === 'chest' ? 'chest_top' : 'furnace_top');
  const front = tex(variant === 'chest' ? 'chest_front' : 'furnace_front');
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, top, side, front]);
  m.position.set(x, y, z); m.castShadow = true;
  g.add(m);
  g.userData.mats.push(side, top, front);
  if (variant === 'furnace') g.userData.front = front;
}

/**
 * Merge item stacks lying within half a block of each other (the same pairs, in the same order, as comparing every item with
 * every other one, but only items in neighbouring 1-block cells are compared, so a big pile costs about its size and not its
 * square), then, if more than `cap` items remain, let the oldest vanish. `items` are live ItemEntities in list order.
 * Returns the number removed by the cap.
 */
export function mergeItems(items, cap = MAX_LOOSE_ITEMS) {
  const n = items.length;
  if (n > 1) {
    const cells = new Map();
    const cellKey = (cx, cy, cz) => (cx + 2048) * 4194304 + (cz + 2048) * 1024 + ((cy + 512) & 1023);
    for (let i = 0; i < n; i++) {
      const a = items[i], k = cellKey(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z));
      const c = cells.get(k);
      if (c) c.push(i); else cells.set(k, [i]);
    }
    const cand = [];
    for (let i = 0; i < n; i++) {
      const a = items[i];
      if (a.dead) continue;
      const fx = Math.floor(a.x), fy = Math.floor(a.y), fz = Math.floor(a.z);
      cand.length = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) {
        const c = cells.get(cellKey(fx + dx, fy + dy, fz + dz));
        if (c) for (const j of c) if (j > i) cand.push(j);
      }
      if (!cand.length) continue;
      cand.sort((p, q) => p - q);
      for (const j of cand) {
        const b = items[j];
        // (the cheap distance test first: canStack compares enchantments and fireworks)
        if (a.dead || b.dead || a.recycled !== b.recycled || Math.abs(a.x - b.x) >= 0.5 || Math.abs(a.y - b.y) >= 0.5 || Math.abs(a.z - b.z) >= 0.5 || !canStack(a.stack, b.stack)) continue;
        if (a.stack.count + b.stack.count <= maxStack(a.stack.id)) { a.stack.count += b.stack.count; b.dead = true; }
      }
    }
  }
  let alive = 0;
  for (const e of items) if (!e.dead) alive++;
  if (alive <= cap) return 0;
  const old = items.filter((e) => !e.dead).sort((p, q) => q.age - p.age);
  let cut = 0;
  for (let i = 0; i < alive - cap; i++) { old[i].dead = true; cut++; }
  return cut;
}

export class EntityManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.scene = game.scene;
    this.meshes = new Map();
    this.cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    this.arrowGeo = new THREE.BoxGeometry(0.06, 0.06, 0.6);
  }

  get mobs() { return this.list.filter((e) => e.kind === 'mob'); }

  add(e) { this.list.push(e); return e; }

  spawnItem(x, y, z, st, vel = null) {
    if (!st || st.count <= 0) return null;
    if (this.netSpawn('item', { x, y, z, st, v: vel, pd: vel ? 40 : 10 })) return null;
    const e = new ItemEntity(x, y, z, st);
    if (this.spilling) e.recycled = true; // (spilled from a broken chest or frame: not a find for the bounties)
    if (vel) { e.body.vx = vel[0]; e.body.vy = vel[1]; e.body.vz = vel[2]; }
    else { e.body.vx = (Math.random() - 0.5) * 0.2; e.body.vy = 0.2; e.body.vz = (Math.random() - 0.5) * 0.2; }
    return this.add(e);
  }
  /** Drop experience as one or more orbs. */
  spawnXp(x, y, z, amount) {
    if (this.netSpawn('xp', { x, y, z, n: Math.round(amount) })) return;
    for (const v of splitOrbs(Math.round(amount))) this.add(new XPOrb(x, y, z, v));
  }
  spawnBoat(x, y, z, yaw, cart = false, variant = null) { return this.netSpawn('boat', { x, y, z, yaw, cart, variant }) ? null : this.add(cart ? new Minecart(x, y, z, yaw, variant) : new Boat(x, y, z, yaw, variant)); }
  /** Break a boat or cart (host / single player): everybody aboard is let off, the cargo spills and the boat itself drops (not in creative). */
  breakBoat(boat, drop = true) {
    const g = this.game;
    boat.dead = true;
    if (g.player.riding === boat) g.dismount();
    boat.rider = boat.rider2 = null; boat.remoteRider = boat.remoteRider2 = null;
    if (boat.mobPassenger) boat.unloadMob(g);
    for (const st of cargoItems(boat.cargo)) this.spawnItem(boat.x, boat.y + 0.5, boat.z, st);
    if (boat.cargo) boat.cargo.slots.fill(null);
    if (drop) this.spawnItem(boat.x, boat.y + 0.5, boat.z, { id: boat.dropId || I.OAK_BOAT, count: 1 });
  }
  /** An armour stand (entities/armorStand.js) facing `yaw`; a guest asks the host for it. */
  spawnStand(x, y, z, yaw) { return this.netSpawn('stand', { x, y, z, yaw }) ? null : this.add(new ArmorStand(x, y, z, yaw)); }
  spawnFallingBlock(x, y, z, id) { return this.netSpawn('falling', {}) ? null : this.add(new FallingBlock(x, y, z, id)); }
  spawnArrow(x, y, z, vx, vy, vz, shooter, crit, thrown = null, power = 0, potion = 0, item = null) {
    if (this.netSpawn('arrow', { x, y, z, v: [vx, vy, vz], crit, thrown, power: power || undefined, potion: potion || undefined, item: item || undefined })) return null;
    const a = this.add(new Arrow(x, y, z, vx, vy, vz, shooter, crit, thrown, potion));
    a.power = power | 0; // Strongdraw level of the bow
    a.item = item;
    if (this.game.hush) this.game.hush.vibrate(x, y, z, 'shoot', null); // (world/vibrations.js; the host's world)
    if (item && !thrown) a.setTip(item.id);
    if (thrown === 'spear') { a.pickup = !!item; a.creativeThrow = !!(item && shooter && shooter.creative); }
    return a;
  }

  /** Multiplayer guest: dropped items, orbs, arrows and boats are made (and shared) by the host. */
  netSpawn(kind, data) {
    const n = this.game.net;
    if (!n || !n.isClient || n.applyingRemote) return false;
    n.requestSpawn(kind, data);
    return true;
  }

  blockOccupied(x, y, z) {
    for (const e of this.list) {
      if (e.kind !== 'mob' || e.dead) continue;
      const hw = e.width / 2;
      if (e.x - hw < x + 1 && e.x + hw > x && e.y < y + 1 && e.y + e.height > y && e.z - hw < z + 1 && e.z + hw > z) return true;
    }
    return false;
  }

  /** First boat hit by a ray. */
  raycastBoat(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null;
    for (const e of this.list) {
      if (e.kind !== 'boat' || e.dead) continue;
      const t = rayAABB(ox, oy, oz, dx, dy, dz, e.x - 0.7, e.y, e.z - 0.7, e.x + 0.7, e.y + 0.6, e.z + 0.7);
      if (t !== null && t <= maxDist && (!best || t < best.dist)) best = { boat: e, dist: t };
    }
    return best;
  }

  /** First armour stand hit by a ray: { stand, dist, relY } (relY: height of the hit above its feet). */
  raycastStand(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null;
    const hw = STAND_WIDTH / 2;
    for (const e of this.list) {
      if (e.kind !== 'stand' || e.dead) continue;
      const t = rayAABB(ox, oy, oz, dx, dy, dz, e.x - hw, e.y, e.z - hw, e.x + hw, e.y + STAND_HEIGHT, e.z + hw);
      if (t !== null && t <= maxDist && (!best || t < best.dist)) best = { stand: e, dist: t, relY: oy + dy * t - e.y };
    }
    return best;
  }

  /** First mob hit by a ray (player attacks). */
  raycastMob(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null;
    for (const e of this.list) {
      if (e.kind !== 'mob' || e.dead || e.deathTime > 0 || (e.special && e.def.burrower)) continue; // (a Dustmole under the sand cannot be aimed at)
      const hw = e.width / 2;
      const t = rayAABB(ox, oy, oz, dx, dy, dz, e.x - hw, e.y, e.z - hw, e.x + hw, e.y + e.height, e.z + hw);
      if (t !== null && t <= maxDist && (!best || t < best.dist)) best = { mob: e, dist: t };
    }
    return best;
  }

  /** Projectile sweep against mobs and the player. */
  sweepHit(proj, ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null, bestT = Infinity;
    const p = this.game.player;
    const cands = this.list.filter((e) => e.kind === 'mob' && !e.dead && e.deathTime === 0 && !(e.special && e.def.burrower));
    if (!p.dead) cands.push(p.asTarget || (p.asTarget = makePlayerTarget(this.game)));
    if (this.game.net) cands.push(...this.game.net.remoteTargets(proj));
    for (const e of cands) {
      if (e === proj.shooter || (proj.shooter && proj.shooter.isPlayer && e.isPlayer && proj.age < 5)) continue;
      if (this.game.net && proj.shooter && proj.shooter.isPlayer && e.isPlayer && (!this.game.net.pvp || this.game.net.blocksPvp(proj.shooter, e))) continue; // PvP off, or team mates with friendly fire off (net/social.js)
      const hw = e.width / 2 + 0.3;
      const t = rayAABB(ox, oy, oz, dx, dy, dz, e.x - hw, e.y - 0.3, e.z - hw, e.x + hw, e.y + e.height + 0.3, e.z + hw);
      if (t !== null && t <= maxDist && t < bestT) { best = e; bestT = t; }
    }
    return best;
  }

  tick() {
    const g = this.game, p = g.player;
    for (const e of this.list) {
      if (e.dead || this.frozen(e)) continue;
      if (e.netProxy) { e.netTick(); continue; }          // multiplayer guest: an entity simulated by the host
      if (e.kind === 'boat') { if (!e.remoteRider) e.tick(g, e.rider ? g.boatInput : null); continue; } // a guest steers its own boat
      if (g.net && (e.kind === 'mob' || e.kind === 'xp')) g.net.tickNear(e); else e.tick(g);
      if (e.kind === 'xp' && !e.dead && !p.dead && p.xpDelay === 0) {
        const b = p.body.box();
        if (e.x > b[0] - 0.5 && e.x < b[3] + 0.5 && e.y > b[1] - 0.5 && e.y < b[4] + 0.5 && e.z > b[2] - 0.5 && e.z < b[5] + 0.5) {
          p.xpDelay = 2;
          // Sunmend gear on you (worn, or in the held slot) is mended first; what it does not take is yours
          const inv = p.inventory, worn = inv.armor.concat([inv.selectedStack]);
          const left = mendFromXp(worn, e.value);
          if (left < e.value) inv.changed();
          const levelled = left > 0 ? addXp(p.xp, left) : false;
          g.audio.play(levelled && p.xp.level % 5 === 0 ? 'levelup' : 'orb');
          e.dead = true;
        }
      }
      if (e.kind === 'item' && !e.dead && e.pickupDelay === 0 && !p.dead) {
        const b = p.body.box();
        if (e.x > b[0] - 1 && e.x < b[3] + 1 && e.y > b[1] - 0.5 && e.y < b[4] + 0.5 && e.z > b[2] - 1 && e.z < b[5] + 1) {
          const had = e.stack.count, left = p.inventory.add(e.stack);
          if (left < had) { g.audio.play('pop'); if (!e.recycled && g.quests) g.quests.emit('pickup', { id: e.stack.id, n: had - left }, p); }
          if (left === 0) e.dead = true; else e.stack.count = left;
        }
      }
    }
    if (g.ticks % 200 === 0) this.trimFrozen();
    // merge nearby identical item stacks, and keep the pile within MAX_LOOSE_ITEMS
    if (g.ticks % 10 === 0) mergeItems(this.list.filter((e) => e.kind === 'item' && !e.dead));
    // remove dead
    // (in place: no new arrays every tick) dead non-mobs and removed mobs leave the list; a dead mob stays for its death animation
    const list = this.list;
    let w = 0;
    for (let r = 0; r < list.length; r++) {
      const e = list[r];
      if (e.kind === 'mob' ? e.removed : e.dead) { this.removeMesh(e); continue; }
      list[w++] = e;
    }
    list.length = w;
  }

  /**
   * Items, orbs and arrows left in chunks that are no longer loaded wait there frozen (they are not saved, and a player who
   * wanders far - mining, exploring - leaves more behind all the time). Only the newest MAX_FROZEN are kept; the rest
   * vanish, oldest first, so the list (which every tick and every ray walks) cannot grow without end.
   */
  trimFrozen() {
    const frozen = [];
    for (const e of this.list) if ((e.kind === 'item' || e.kind === 'xp' || e.kind === 'arrow') && !e.dead && !e.netProxy && this.frozen(e)) frozen.push(e);
    for (let i = 0; i < frozen.length - MAX_FROZEN; i++) frozen[i].dead = true;
    return Math.max(0, frozen.length - MAX_FROZEN);
  }

  removeMesh(e) {
    const m = this.meshes.get(e.id);
    if (m) { this.scene.remove(m); this.meshes.delete(e.id); if (m.userData.dispose) m.userData.dispose(); }
  }

  /** Remove entities in an unloaded chunk (mobs are despawned, items are kept frozen). */
  frozen(e) {
    return !e.noFreeze && !this.game.world.isLoaded(Math.floor(e.x), Math.floor(e.z));
  }

  render(alpha, timeSec) {
    const g = this.game;
    const cam = g.camera.position;
    for (const e of this.list) {
      const dist2 = (e.x - cam.x) ** 2 + (e.y - cam.y) ** 2 + (e.z - cam.z) ** 2;
      let m = this.meshes.get(e.id);
      // entity render distance (64 blocks for mobs, 32 for small entities)
      const maxD = e.kind === 'mob' ? (e.def.boss ? 320 : ENTITY_RENDER_DIST) : ENTITY_RENDER_DIST / 2;
      // hidden models also skip the per-frame matrix update of all their parts
      if (dist2 > maxD * maxD) { if (m) m.visible = m.matrixWorldAutoUpdate = false; continue; }
      if (!m) { m = this.createMesh(e); if (!m) continue; this.meshes.set(e.id, m); this.scene.add(m); }
      m.visible = m.matrixWorldAutoUpdate = true;
      if (e.kind === 'mob') {
        const shadow = dist2 < SHADOW_CAST_DIST * SHADOW_CAST_DIST;
        if (m.userData.castShadow !== shadow) { m.userData.castShadow = shadow; m.traverse((o) => { if (o.isMesh) o.castShadow = shadow; }); }
      }
      const px = e.prev[0] + (e.x - e.prev[0]) * alpha;
      const py = e.prev[1] + (e.y - e.prev[1]) * alpha;
      const pz = e.prev[2] + (e.z - e.prev[2]) * alpha;
      const L = lightAt(g, e.x, e.y + 0.5, e.z);
      if (e.kind === 'item') {
        m.position.set(px, py + 0.15 + Math.sin(timeSec * 2.5 + e.bob) * 0.05, pz);
        if (m.userData.cube) {
          m.rotation.y = timeSec * 1.1 + e.bob;
          for (const mat of m.userData.mats) mat.color.set(mat.userData.tint).multiplyScalar(L);
        } else m.material.color.setScalar(L);
      } else if (e.kind === 'boat') {
        m.position.set(px, py, pz);
        let dy = e.yaw - e.prevYaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
        m.rotation.set(e.cart ? (e.prevPitch + (e.pitch - e.prevPitch) * alpha) : 0, e.prevYaw + dy * alpha, e.hitTime > 0 ? Math.sin(e.hitTime) * 0.1 : 0, 'YXZ');
        for (const mt of m.userData.mats) mt.color.setScalar(L);
        if (e.furnace && m.userData.front && m.userData.lit !== e.lit) { // the firebox glows while it burns
          m.userData.lit = e.lit;
          m.userData.front.map = blockFaceTexture(e.lit ? 'furnace_front_lit' : 'furnace_front');
        }
      } else if (e.kind === 'xp') {
        m.position.set(px, py + 0.2, pz);
        const k = 0.5 + 0.5 * Math.sin(timeSec * 6 + e.phase);
        m.material.color.setRGB(0.8 + 0.2 * k, 1, 0.55 + 0.45 * k); // pulses from green to pale yellow; orbs glow
      } else if (e.kind === 'falling') {
        m.position.set(px, py + 0.5, pz);
        for (const mat of m.material) mat.color.setScalar(L);
      } else if (e.kind === 'arrow') {
        m.position.set(px, py, pz);
        if (!e.stuck && (!e.thrown || e.thrown === 'spear') && (e.vx || e.vy || e.vz)) m.lookAt(px + e.vx, py + e.vy, pz + e.vz);
        if (e.thrown === 'spear') lightSpear(m, L, isGlinting(e.item), timeSec); else m.material.color.setScalar(L);
      } else if (e.renderUpdate) {
        e.renderUpdate(m, px, py, pz, alpha, L, timeSec); // mobs and custom entities (fireballs, thrown eyes)
      }
    }
  }

  createMesh(e) {
    if (e.kind === 'item' && droppedCube(e.stack.id)) {
      // a dropped block: a small turning cube (two or three for bigger stacks)
      const d = BLOCKS[e.stack.id];
      const tint = d.tint === 'grass' ? 0x6eb446 : d.tint === 'foliage' ? 0x50962f : 0xffffff;
      const side = new THREE.MeshLambertMaterial({ map: blockFaceTexture(d.tex.side), transparent: true, alphaTest: 0.3 });
      const top = new THREE.MeshLambertMaterial({ map: blockFaceTexture(d.tex.top), transparent: true, alphaTest: 0.3 });
      const bottom = new THREE.MeshLambertMaterial({ map: blockFaceTexture(d.tex.bottom || d.tex.top), transparent: true, alphaTest: 0.3 });
      const mats = [side, side, top, bottom, side, side];
      top.userData.tint = d.tint ? tint : 0xffffff; side.userData.tint = d.tint === 'foliage' ? tint : 0xffffff; bottom.userData.tint = 0xffffff;
      const g = new THREE.Group();
      const n = e.stack.count > 16 ? 3 : e.stack.count > 1 ? 2 : 1;
      const geo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
      for (let k = 0; k < n; k++) { const c = new THREE.Mesh(geo, mats); c.position.set(k * 0.06 - 0.03 * (n - 1), k * 0.05, (k % 2) * 0.05); c.castShadow = true; g.add(c); }
      g.userData.cube = true; g.userData.mats = [side, top, bottom]; g.userData.count = n;
      g.userData.dispose = () => { geo.dispose(); for (const mt of [side, top, bottom]) mt.dispose(); };
      return g;
    }
    if (e.kind === 'item') {
      const mat = new THREE.SpriteMaterial({ map: iconTexture(e.stack.id, isGlinting(e.stack)), alphaTest: 0.3 });
      const s = new THREE.Sprite(mat);
      s.scale.setScalar(0.38);
      return s;
    }
    if (e.kind === 'boat' && e.cart) {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ map: blockFaceTexture('iron_block'), color: 0x9a9aa0 });
      const box = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); };
      box(0.9, 0.08, 1.2, 0, 0.12, 0);                                        // floor
      box(0.08, 0.5, 1.2, -0.45, 0.4, 0); box(0.08, 0.5, 1.2, 0.45, 0.4, 0); // sides
      box(0.9, 0.5, 0.08, 0, 0.4, -0.6); box(0.9, 0.5, 0.08, 0, 0.4, 0.6);   // ends
      const wheel = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
      for (const [wx, wz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) { const wm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.16), wheel); wm.position.set(wx, 0.08, wz); g.add(wm); }
      g.userData.mats = [mat];
      // a chest or a furnace sits in the cart (the front is -z, towards the way it rolls)
      if (e.variant) addCargoBox(g, e.variant, 0.7, 0.56, 0.7, 0, 0.5, 0);
      g.userData.dispose = () => { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); mat.dispose(); wheel.dispose(); for (const m of g.userData.mats) m.dispose(); };
      return g;
    }
    if (e.kind === 'boat') {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ map: blockFaceTexture('oak_planks') });
      const box = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); };
      box(1.25, 0.1, 1.9, 0, 0.05, 0);            // bottom
      box(0.1, 0.4, 1.9, -0.62, 0.3, 0); box(0.1, 0.4, 1.9, 0.62, 0.3, 0); // sides
      box(1.25, 0.4, 0.1, 0, 0.3, -0.95); box(1.25, 0.4, 0.1, 0, 0.3, 0.95); // ends
      box(1.2, 0.08, 0.3, 0, 0.32, -0.2);         // the driver's bench
      g.userData.mats = [mat];
      if (e.variant === 'chest') addCargoBox(g, 'chest', 0.8, 0.5, 0.6, 0, 0.55, 0.52); // a chest where the second seat would be
      else box(1.2, 0.08, 0.3, 0, 0.32, 0.5);     // the second seat
      g.userData.dispose = () => { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const m of g.userData.mats) m.dispose(); };
      return g;
    }
    if (e.kind === 'xp') {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: xpOrbTexture(), alphaTest: 0.3 }));
      s.scale.setScalar(0.18 + Math.min(0.2, Math.log2(e.value + 1) * 0.03));
      return s;
    }
    if (e.kind === 'falling' && BLOCKS[e.blockId].shape === SHAPE.CRYSTAL) {
      // a spike: two crossed sprites, turned over when it hung from the ceiling
      const mat = new THREE.MeshLambertMaterial({ map: blockFaceTexture(crystalTex(e.blockId, e.meta)), alphaTest: 0.5, side: THREE.DoubleSide });
      const g = new THREE.BufferGeometry(), h = 0.5;
      g.setAttribute('position', new THREE.Float32BufferAttribute([-h, -h, -h, h, -h, h, h, h, h, -h, h, -h, -h, -h, h, h, -h, -h, h, h, -h, -h, h, h], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(Array(8).fill([0, 1, 0]).flat(), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
      g.addGroup(0, 12, 0);
      const m = new THREE.Mesh(g, [mat]);
      if ((e.meta & 7) === FACING_DOWN) m.rotation.x = Math.PI;
      m.userData.dispose = () => { g.dispose(); mat.dispose(); };
      return m;
    }
    if (e.kind === 'falling') {
      const d = BLOCKS[e.blockId];
      const side = new THREE.MeshLambertMaterial({ map: blockFaceTexture(d.tex.side) });
      const top = new THREE.MeshLambertMaterial({ map: blockFaceTexture(d.tex.top) });
      const m = new THREE.Mesh(this.cubeGeo, [side, side, top, top, side, side]);
      m.castShadow = true;
      return m;
    }
    if (e.kind === 'arrow' && e.thrown === 'potion') {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(e.potion, false), alphaTest: 0.3 }));
      s.scale.setScalar(0.32);
      return s;
    }
    if (e.kind === 'arrow' && e.thrown === 'spear') {
      // shaft, crossbar and three prongs, pointing along the flight (render/spearModel.js)
      return buildSpearModel();
    }
    if (e.kind === 'arrow' && e.thrown) {
      const m = new THREE.Mesh(this.cubeGeo, new THREE.MeshLambertMaterial({ color: e.thrown === 'egg' ? 0xefe3c8 : 0xf4f8ff }));
      m.scale.setScalar(0.22);
      return m;
    }
    if (e.kind === 'arrow') {
      const m = new THREE.Mesh(this.arrowGeo, new THREE.MeshLambertMaterial({ color: 0xbbaa88 }));
      return m;
    }
    if (e.createMesh) return e.createMesh(this.game);
    return null;
  }
}

function makePlayerTarget(game) {
  const p = game.player;
  return {
    isPlayer: true,
    get x() { return p.x; }, get y() { return p.y; }, get z() { return p.z; },
    get width() { return 0.6; }, get height() { return p.body.height; },
    hurt(dmg, src, attacker) { return p.hurt(dmg, src, attacker); },
    applyEffect(type, ticks, amp, factor) { return p.applyEffect(type, ticks, amp, factor); }, // tipped arrows
  };
}

/** How far along its step a projectile meets an entity's (padded) box. */
function rayAABBDist(proj, e) {
  const sp = Math.hypot(proj.vx, proj.vy, proj.vz) || 1, hw = e.width / 2 + 0.3;
  const t = rayAABB(proj.x, proj.y, proj.z, proj.vx / sp, proj.vy / sp, proj.vz / sp, e.x - hw, e.y - 0.3, e.z - hw, e.x + hw, e.y + e.height + 0.3, e.z + hw);
  return t === null ? 0 : Math.min(t, sp);
}

export function rayAABB(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], mn = [x0, y0, z0], mx = [x1, y1, z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < mn[a] || o[a] > mx[a]) return null; continue; }
    let t1 = (mn[a] - o[a]) / d[a], t2 = (mx[a] - o[a]) / d[a];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

export { tmpBox, SOLID };
