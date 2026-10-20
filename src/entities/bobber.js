// Fishing: the rod casts a bobber that floats on water. After 5-30 s (a
// fifth faster in the rain) a fish bites: the bobber dips and splashes for
// about a second; reeling in then lands a catch from the reference loot
// split (85 % fish, 10 % junk, 5 % treasure) and 1-6 XP.
import * as THREE from 'three';
import { B, SOLID } from '../world/blocks.js';
import { I } from '../world/items.js';

let nextId = 7_000_000;

/** Weighted loot: fish (silverfin 60, redfin 25, spinefish 13, glimmerfin 2), junk and treasure. */
export function rollCatch(rng = Math.random) {
  const r = rng();
  if (r < 0.85) {
    const f = rng() * 100;
    return { id: f < 60 ? I.RAW_SILVERFIN : f < 85 ? I.RAW_REDFIN : f < 98 ? I.SPINEFISH : I.GLIMMERFIN, count: 1 };
  }
  if (r < 0.95) {
    const junk = [[I.STICK, 1], [I.BONE, 1], [I.STRING, 1], [I.BOWL, 1], [I.ROTTEN_FLESH, 1], [I.LEATHER, 1], [B.LILY_PAD ?? I.STICK, 1], [I.LEATHER_BOOTS, 1]];
    const [id, count] = junk[Math.floor(rng() * junk.length)];
    return { id, count, damage: id === I.LEATHER_BOOTS ? Math.floor(rng() * 40) : 0 };
  }
  const treasure = [[I.BOW, 1], [I.FISHING_ROD, 1], [I.DIAMOND, 1], [I.IRON_INGOT, 3], [I.BOOK, 1]];
  const [id, count] = treasure[Math.floor(rng() * treasure.length)];
  return { id, count, damage: id === I.BOW || id === I.FISHING_ROD ? Math.floor(rng() * 40) : 0 };
}

export class Bobber {
  constructor(x, y, z, vx, vy, vz, owner) {
    this.id = nextId++;
    this.kind = 'bobber';
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.prev = [x, y, z];
    this.owner = owner;
    this.inWater = false;
    this.wait = 0;      // ticks until a fish bites
    this.bite = 0;      // ticks the fish stays hooked
    this.age = 0;
    this.dead = false;
  }

  resetWait(game) {
    const rain = game.weather && game.weather.rainingAt(game.world, this.x, this.y + 1, this.z);
    this.wait = Math.floor((100 + Math.random() * 500) * (rain ? 0.8 : 1));
  }

  tick(game) {
    this.prev = [this.x, this.y, this.z];
    this.age++;
    const p = game.player, w = game.world;
    if (p.dead || Math.hypot(p.x - this.x, p.y - this.y, p.z - this.z) > 32 || !game.interaction.holdingRod()) { this.remove(game); return; }
    const water = w.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) === B.WATER;
    if (water || this.inWater) {
      if (!this.inWater) { this.inWater = true; this.resetWait(game); game.audio.play('splash', [this.x, this.y, this.z], 0.5); }
      // float on the surface of the water column
      let top = Math.floor(this.y);
      while (w.getBlock(Math.floor(this.x), top + 1, Math.floor(this.z)) === B.WATER) top++;
      const surface = top + 0.9 - (this.bite > 0 ? 0.25 : 0);
      this.vy += (surface - this.y) * 0.2; this.vy *= 0.6;
      this.vx *= 0.8; this.vz *= 0.8;
      if (w.getBlock(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z)) !== B.WATER && !water) this.inWater = false;
      if (this.bite > 0) {
        if (--this.bite === 0) this.resetWait(game); // got away
      } else if (--this.wait <= 0) {
        this.bite = 20 + Math.floor(Math.random() * 20);
        game.audio.play('splash', [this.x, this.y, this.z], 0.8);
        for (let k = 0; k < 10; k++) game.particles.emit(this.x + (Math.random() - 0.5) * 0.6, this.y + 0.1, this.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.08, 0.12, (Math.random() - 0.5) * 0.08, 0.6, 0.75, 1, 12, 0.03);
      } else if (this.wait < 40 && Math.random() < 0.3) {
        // a fish approaching: little wakes moving in
        const a = Math.random() * Math.PI * 2, d = this.wait / 40 * 2;
        game.particles.emit(this.x + Math.cos(a) * d, this.y + 0.1, this.z + Math.sin(a) * d, 0, 0.02, 0, 0.75, 0.85, 1, 8, 0);
      }
    } else {
      this.vy -= 0.04;
      this.vx *= 0.92; this.vy *= 0.92; this.vz *= 0.92;
    }
    // stop on solid ground
    const nx = this.x + this.vx, ny = this.y + this.vy, nz = this.z + this.vz;
    const b = w.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
    if (SOLID[b]) {
      this.vx = this.vy = this.vz = 0;
    } else { this.x = nx; this.y = ny; this.z = nz; }
    if (this.y < -128) this.remove(game);
  }

  /** Reel in: a hooked fish becomes a catch flying to the player. Returns the rod damage. */
  reel(game) {
    const p = game.player;
    let dmg = 0;
    if (this.bite > 0) {
      const st = rollCatch();
      const dx = p.x - this.x, dy = p.y + 1 - this.y, dz = p.z - this.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      game.entities.spawnItem(this.x, this.y + 0.3, this.z, st, [dx * 0.1, dy * 0.1 + Math.sqrt(d) * 0.08, dz * 0.1]);
      game.entities.spawnXp(p.x, p.y + 0.5, p.z, 1 + Math.floor(Math.random() * 6));
      if (game.milestones) game.milestones.event('fish');
      dmg = 1;
    }
    this.remove(game);
    return dmg;
  }

  remove(game) {
    this.dead = true;
    if (game.interaction.bobber === this) game.interaction.bobber = null;
  }

  createMesh() {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14), new THREE.MeshLambertMaterial({ color: 0xd8302a }));
    top.position.y = 0.06;
    const bot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14), new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 17), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x222222 }));
    line.frustumCulled = false;
    g.add(top, bot, line);
    g.userData.line = line;
    g.userData.mats = [top.material, bot.material];
    return g;
  }

  renderUpdate(m, px, py, pz, alpha, L) {
    m.position.set(px, py, pz);
    // fishing line: a sagging curve from the rod tip to the bobber (in the bobber's local space)
    const p = this.owner, [ex, ey, ez] = p.eyePos(), [lx, , lz] = p.lookDir();
    const tx = ex + lx * 0.6 - lz * 0.35 - px, ty = ey - 0.25 - py, tz = ez + lz * 0.6 + lx * 0.35 - pz;
    const pos = m.userData.line.geometry.attributes.position;
    for (let k = 0; k <= 16; k++) {
      const t = k / 16, sag = Math.sin(t * Math.PI) * Math.min(1.5, Math.hypot(tx, tz) * 0.12);
      pos.setXYZ(k, tx * t, ty * t - sag + 0.08 * (1 - t), tz * t);
    }
    pos.needsUpdate = true;
  }
}
