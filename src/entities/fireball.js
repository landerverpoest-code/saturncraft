// Fireballs shot by Ashwraiths (large: explode, power 1, and start fires) and
// Ember Lords (small: 5 damage, set the target alight, start a fire where they
// land). They fly straight, leave a flame trail and burn out after 10 s.
import * as THREE from 'three';
import { B, BLOCKS } from '../world/blocks.js';
import { canLight, FIRE_DELAY } from '../world/fire.js';

let nextId = 5_000_000;
const geoCache = new Map();

export class Fireball {
  constructor(x, y, z, vx, vy, vz, shooter, opts = {}) {
    this.id = nextId++;
    this.kind = 'fireball';
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.prev = [x, y, z];
    this.shooter = shooter;
    this.power = opts.power ?? 0;      // explosion power (0 = none)
    this.damage = opts.damage ?? 5;
    this.size = opts.size ?? 0.35;
    this.age = 0;
    this.dead = false;
  }

  tick(game) {
    this.prev = [this.x, this.y, this.z];
    if (++this.age > 200) { this.dead = true; return; }
    const w = game.world;
    const speed = Math.hypot(this.vx, this.vy, this.vz) || 1e-6;
    const dx = this.vx / speed, dy = this.vy / speed, dz = this.vz / speed;
    const hit = w.raycast(this.x, this.y, this.z, dx, dy, dz, speed, true);
    const end = hit ? hit.dist : speed;
    const target = game.entities.sweepHit(this, this.x, this.y, this.z, dx, dy, dz, end);
    if (target) {
      if (target.def && target.def.fireImmune && !this.power) { this.dead = true; return; }
      this.impact(game, this.x + dx * end, this.y + dy * end, this.z + dz * end, target);
      return;
    }
    if (hit && !(BLOCKS[hit.id].fluid === 'lava') && hit.id !== B.FIRE && hit.id !== B.RIFT) {
      this.impact(game, this.x + dx * hit.dist - dx * 0.2, this.y + dy * hit.dist - dy * 0.2, this.z + dz * hit.dist - dz * 0.2, null);
      return;
    }
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    if (Math.random() < 0.8) game.particles.flame(this.x, this.y, this.z);
    if (this.power && Math.random() < 0.5) game.particles.smoke(this.x, this.y, this.z, 1, this.size);
  }

  impact(game, x, y, z, target) {
    this.dead = true;
    const w = game.world;
    if (this.power > 0) {
      game.explode(x, y, z, this.power, this.shooter);
    } else if (target) {
      if (target.isPlayer) { game.player.hurt(this.damage, 'fireball', this.shooter); game.player.fireTicks = Math.max(game.player.fireTicks, 100); }
      else { target.hurt(this.damage, 'fireball', this.shooter, 0.2, this); target.fireTicks = Math.max(target.fireTicks || 0, 100); }
    }
    // start fires around the impact
    const n = this.power > 0 ? 6 : 1;
    for (let k = 0; k < n; k++) {
      const fx = Math.floor(x + (k ? (Math.random() - 0.5) * 3 : 0)), fy = Math.floor(y + (k ? (Math.random() - 0.5) * 2 : 0)), fz = Math.floor(z + (k ? (Math.random() - 0.5) * 3 : 0));
      if (w.isLoaded(fx, fz) && canLight(w, fx, fy, fz)) { w.setBlockUrgent(fx, fy, fz, B.FIRE); w.scheduleTick(fx, fy, fz, FIRE_DELAY); }
    }
    game.particles.smoke(x, y, z, this.power ? 20 : 6, 1);
    game.audio.play(this.power ? 'explode' : 'fizz', [x, y, z]);
  }

  createMesh() {
    const s = this.size;
    if (!geoCache.has(s)) geoCache.set(s, new THREE.BoxGeometry(s * 2, s * 2, s * 2));
    const core = new THREE.Mesh(geoCache.get(s), new THREE.MeshBasicMaterial({ color: this.power ? 0xff7a1a : 0xffb030 }));
    const glow = new THREE.Mesh(geoCache.get(s), new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0.45, depthWrite: false }));
    glow.scale.setScalar(1.35);
    const g = new THREE.Group();
    g.add(core); g.add(glow);
    g.userData.dispose = () => { core.material.dispose(); glow.material.dispose(); };
    return g;
  }

  renderUpdate(m, px, py, pz, alpha, L, sec) {
    m.position.set(px, py, pz);
    m.rotation.set(sec * 5, sec * 7, sec * 3);
  }
}
