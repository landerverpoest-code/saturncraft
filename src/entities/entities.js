// Non-mob entities: dropped items, falling blocks and arrows, plus the
// manager that ticks and renders every entity (mobs included).
import * as THREE from 'three';
import { Body } from '../physics/body.js';
import { B, BLOCKS, SOLID, SHAPE, isFluid } from '../world/blocks.js';
import { stalactiteDamage, crystalTex, FACING_DOWN } from '../world/caves.js';
import { ITEMS, I, maxStack } from '../world/items.js';
import { itemCanvas } from '../ui/icons.js';
import { texturePixels } from '../world/textures.js';
import { MIN_Y } from '../world/constants.js';
import { addXp, splitOrbs } from '../player/experience.js';
import { RAIL_EXITS, RAIL_UP, railHeight } from '../world/rails.js';
import { withExtras, canStack, isGlinting, arrowDamage } from '../world/enchantments.js';
import { splashPotion } from './splash.js';

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
  const d = id > 0 && id < 256 ? BLOCKS[id] : null;
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
  }
  get x() { return this.body.x; } get y() { return this.body.y; } get z() { return this.body.z; }

  tick(game) {
    const b = this.body;
    this.prev = [b.x, b.y, b.z];
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
  }
}

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

// Boat: floats on water, steered by its rider (W/S thrust, A/D turn).
export class Boat {
  constructor(x, y, z, yaw = 0) {
    this.id = nextEntityId++;
    this.kind = 'boat';
    this.body = new Body(1.375, 0.5625);
    this.body.stepHeight = 0;
    this.body.setPos(x, y, z);
    this.yaw = yaw; this.prevYaw = yaw;
    this.rider = null;
    this.hits = 0; this.hitTime = 0;
    this.dead = false;
    this.prev = [x, y, z];
  }
  get x() { return this.body.x; } get y() { return this.body.y; } get z() { return this.body.z; }
  get width() { return 1.375; } get height() { return 0.5625; }

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
    if (this.rider && input) {
      // reference speeds: 0.04 forward, 0.005 backward, about 1 degree of turn per tick while moving
      this.yaw -= (input.strafe || 0) * 0.05;
      const thrust = input.forward > 0 ? 0.04 : input.forward < 0 ? -0.005 : 0;
      b.vx += -Math.sin(this.yaw) * thrust; b.vz += -Math.cos(this.yaw) * thrust;
    }
    const level = this.waterLevel(w);
    if (level !== null) {
      b.vy += (level - 0.12 - b.y) * 0.25; // bob up to the surface
      b.vy *= 0.65;
      b.vx *= 0.9; b.vz *= 0.9;
    } else {
      b.vy -= 0.04;
      const slip = b.onGround ? b.groundSlipperiness(w) : 0.98;
      const f = slip >= 0.9 ? 0.9 : 0.5; // on land a boat barely moves (ice excepted)
      b.vx *= f; b.vz *= f;
    }
    b.move(w, b.vx, b.vy, b.vz);
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
  constructor(x, y, z, yaw = 0) {
    super(x, y, z, yaw);
    this.cart = true;
    this.body = new Body(0.98, 0.7);
    this.body.stepHeight = 0;
    this.body.setPos(x, y, z);
    this.seatY = 0.1;
    this.dropId = I.MINECART;
    this.pitch = 0; this.prevPitch = 0;
  }
  get width() { return 0.98; } get height() { return 0.7; }

  railAt(w, x, y, z) {
    for (const dy of [0, -1, 1]) if (w.getBlock(x, y + dy, z) === B.RAIL) return y + dy;
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
    const m = w.getMeta(bx, ry, bz) % 10;
    const [[ax, az], [cx, cz]] = RAIL_EXITS[m];
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
    // snap onto the track line
    const ox = bx + 0.5 + ax * 0.5, oz = bz + 0.5 + az * 0.5;
    const t = (b.x - ox) * dx + (b.z - oz) * dz;
    let nx = ox + dx * t + dx * s, nz = oz + dz * t + dz * s;
    // blocked by a wall ahead
    const fx = Math.floor(nx + Math.sign(dx * s) * 0.49), fz = Math.floor(nz + Math.sign(dz * s) * 0.49);
    if (SOLID[w.getBlock(fx, ry, fz)] && (fx !== bx || fz !== bz) && !(up && w.getBlock(fx, ry + 1, fz) === B.RAIL)) { s = 0; nx = ox + dx * t; nz = oz + dz * t; }
    const nbx = Math.floor(nx), nbz = Math.floor(nz);
    const nry = this.railAt(w, nbx, ry, nbz);
    let ny;
    if (nry !== null) ny = nry + railHeight(w.getMeta(nbx, nry, nbz) % 10, nx - nbx, nz - nbz);
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
    if (this.stuck) {
      if (this.age > 1200) this.dead = true;
      const p = game.player;
      if (this.pickup && !p.dead && Math.abs(p.x - this.x) < 1.2 && Math.abs(p.z - this.z) < 1.2 && this.y > p.y - 0.5 && this.y < p.y + 2.3) {
        if (p.inventory.add({ id: I.ARROW, count: 1 }) === 0) { this.dead = true; game.audio.play('pop'); }
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
      if (ok && this.effect && target.applyEffect) target.applyEffect(this.effect[0], this.effect[1], this.effect[2], 1, this.shooter);
      if (ok) { this.dead = true; return; }
      // deflected
      this.vx *= -0.1; this.vy *= -0.1; this.vz *= -0.1;
      return;
    }
    if (hit && this.thrown) { this.x += this.vx / speed * hit.dist; this.y += this.vy / speed * hit.dist; this.z += this.vz / speed * hit.dist; this.shatter(game); return; }
    if (hit) {
      this.x += this.vx / speed * hit.dist; this.y += this.vy / speed * hit.dist; this.z += this.vz / speed * hit.dist;
      this.stuck = true; this.age = 0;
      game.audio.play('arrow_hit', [this.x, this.y, this.z]);
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
    if (vel) { e.body.vx = vel[0]; e.body.vy = vel[1]; e.body.vz = vel[2]; }
    else { e.body.vx = (Math.random() - 0.5) * 0.2; e.body.vy = 0.2; e.body.vz = (Math.random() - 0.5) * 0.2; }
    return this.add(e);
  }
  /** Drop experience as one or more orbs. */
  spawnXp(x, y, z, amount) {
    if (this.netSpawn('xp', { x, y, z, n: Math.round(amount) })) return;
    for (const v of splitOrbs(Math.round(amount))) this.add(new XPOrb(x, y, z, v));
  }
  spawnBoat(x, y, z, yaw, cart = false) { return this.netSpawn('boat', { x, y, z, yaw, cart }) ? null : this.add(cart ? new Minecart(x, y, z, yaw) : new Boat(x, y, z, yaw)); }
  spawnFallingBlock(x, y, z, id) { return this.netSpawn('falling', {}) ? null : this.add(new FallingBlock(x, y, z, id)); }
  spawnArrow(x, y, z, vx, vy, vz, shooter, crit, thrown = null, power = 0, potion = 0) {
    if (this.netSpawn('arrow', { x, y, z, v: [vx, vy, vz], crit, thrown, power: power || undefined, potion: potion || undefined })) return null;
    const a = this.add(new Arrow(x, y, z, vx, vy, vz, shooter, crit, thrown, potion));
    a.power = power | 0; // Strongdraw level of the bow
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

  /** First mob hit by a ray (player attacks). */
  raycastMob(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null;
    for (const e of this.list) {
      if (e.kind !== 'mob' || e.dead || e.deathTime > 0) continue;
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
    const cands = this.list.filter((e) => e.kind === 'mob' && !e.dead && e.deathTime === 0);
    if (!p.dead) cands.push(p.asTarget || (p.asTarget = makePlayerTarget(this.game)));
    if (this.game.net) cands.push(...this.game.net.remoteTargets(proj));
    for (const e of cands) {
      if (e === proj.shooter || (proj.shooter && proj.shooter.isPlayer && e.isPlayer && proj.age < 5)) continue;
      if (this.game.net && !this.game.net.pvp && proj.shooter && proj.shooter.isPlayer && e.isPlayer) continue; // PvP off
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
          const levelled = addXp(p.xp, e.value);
          g.audio.play(levelled && p.xp.level % 5 === 0 ? 'levelup' : 'orb');
          e.dead = true;
        }
      }
      if (e.kind === 'item' && !e.dead && e.pickupDelay === 0 && !p.dead) {
        const b = p.body.box();
        if (e.x > b[0] - 1 && e.x < b[3] + 1 && e.y > b[1] - 0.5 && e.y < b[4] + 0.5 && e.z > b[2] - 1 && e.z < b[5] + 1) {
          const left = p.inventory.add(e.stack);
          if (left < e.stack.count) g.audio.play('pop');
          if (left === 0) e.dead = true; else e.stack.count = left;
        }
      }
    }
    // merge nearby identical item stacks
    if (g.ticks % 10 === 0) {
      const items = this.list.filter((e) => e.kind === 'item' && !e.dead);
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.dead || b.dead || !canStack(a.stack, b.stack)) continue;
        if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.z - b.z) < 0.5 && a.stack.count + b.stack.count <= maxStack(a.stack.id)) {
          a.stack.count += b.stack.count; b.dead = true;
        }
      }
    }
    // remove dead
    for (const e of this.list) if (e.dead && e.kind !== 'mob') this.removeMesh(e);
    this.list = this.list.filter((e) => !e.dead || (e.kind === 'mob' && !e.removed));
    for (const e of this.list) if (e.kind === 'mob' && e.removed) this.removeMesh(e);
    this.list = this.list.filter((e) => !(e.kind === 'mob' && e.removed));
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
      if (dist2 > maxD * maxD) { if (m) m.visible = false; continue; }
      if (!m) { m = this.createMesh(e); if (!m) continue; this.meshes.set(e.id, m); this.scene.add(m); }
      m.visible = true;
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
        m.userData.mats[0].color.setScalar(L);
      } else if (e.kind === 'xp') {
        m.position.set(px, py + 0.2, pz);
        const k = 0.5 + 0.5 * Math.sin(timeSec * 6 + e.phase);
        m.material.color.setRGB(0.8 + 0.2 * k, 1, 0.55 + 0.45 * k); // pulses from green to pale yellow; orbs glow
      } else if (e.kind === 'falling') {
        m.position.set(px, py + 0.5, pz);
        for (const mat of m.material) mat.color.setScalar(L);
      } else if (e.kind === 'arrow') {
        m.position.set(px, py, pz);
        if (!e.stuck && !e.thrown) m.lookAt(px + e.vx, py + e.vy, pz + e.vz);
        m.material.color.setScalar(L);
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
      g.userData.dispose = () => { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); mat.dispose(); wheel.dispose(); };
      return g;
    }
    if (e.kind === 'boat') {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ map: blockFaceTexture('oak_planks') });
      const box = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); };
      box(1.25, 0.1, 1.9, 0, 0.05, 0);            // bottom
      box(0.1, 0.4, 1.9, -0.62, 0.3, 0); box(0.1, 0.4, 1.9, 0.62, 0.3, 0); // sides
      box(1.25, 0.4, 0.1, 0, 0.3, -0.95); box(1.25, 0.4, 0.1, 0, 0.3, 0.95); // ends
      box(1.2, 0.08, 0.3, 0, 0.32, 0.2);          // seat
      g.userData.mats = [mat];
      g.userData.dispose = () => { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); mat.dispose(); };
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
