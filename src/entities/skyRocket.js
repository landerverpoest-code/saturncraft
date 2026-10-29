// Sky Rockets (reference: firework rockets). Launched from a block they climb
// faster and faster (x1.15 sideways, +0.04 up per tick) for 20-31 ticks and
// burst into a ball of coloured sparks (a plain rocket: one random colour,
// decoration only). A Star Rocket (made with a Firework Star, world/items.js)
// bursts in its star's colour and hurts the mobs within STAR_RANGE blocks of
// the burst; only the host (or a single player) deals that damage.
// Used while gliding they ride along with the player and push the Voidwing
// (Player.boostTicks, see player/glider.js rocketBoost), trailing sparks.
import * as THREE from 'three';
import { SOLID } from '../world/blocks.js';
import { rocketLifetime } from '../player/glider.js';
import { COLORS } from '../world/colors.js';

/** Mobs within this many blocks of a Star Rocket's burst take STAR_DAMAGE (reference: 5 blocks, 5 + 2 per star). */
export const STAR_RANGE = 5, STAR_DAMAGE = 7;
/** Damage a Star Rocket's burst deals at distance `dist` blocks. */
export const starDamage = (dist) => (dist <= STAR_RANGE ? STAR_DAMAGE : 0);
/** Spark colour (0-1 rgb) of a Firework Star colour index. */
export const starColor = (c) => (COLORS[c] ? COLORS[c][2].map((v) => v / 255) : null);

let nextId = 7_000_000;
const PALETTES = [[1, 0.35, 0.3], [0.4, 0.8, 1], [1, 0.85, 0.3], [0.7, 0.45, 1], [0.45, 1, 0.55], [1, 0.55, 0.9]];

export class SkyRocket {
  /** `rider`: the gliding player it pushes (or null for a free rocket); `star`: a Firework Star colour index (a Star Rocket). */
  constructor(x, y, z, rider = null, rng = Math.random, star = null) {
    this.id = nextId++;
    this.kind = 'rocket';
    this.x = x; this.y = y; this.z = z;
    this.prev = [x, y, z];
    this.rider = rider;
    this.vx = (rng() - 0.5) * 0.023; this.vz = (rng() - 0.5) * 0.023; this.vy = 0.05;
    this.life = rocketLifetime(1, rng);
    this.age = 0; this.dead = false;
    this.star = star;
    this.color = starColor(star) || PALETTES[Math.floor(rng() * PALETTES.length)];
  }

  tick(game) {
    this.prev = [this.x, this.y, this.z];
    const r = this.rider;
    if (r) {
      // riding along: sparks behind the glider
      this.x = r.x; this.y = r.y + 0.3; this.z = r.z;
      game.particles.emit(this.x, this.y, this.z, -r.body.vx * 0.3, -r.body.vy * 0.3, -r.body.vz * 0.3, 1, 0.8, 0.5, 14, 0);
      if (++this.age >= this.life || r.dead || !r.gliding) this.dead = true;
      return;
    }
    this.vx *= 1.15; this.vz *= 1.15; this.vy += 0.04;
    const nx = this.x + this.vx, ny = this.y + this.vy, nz = this.z + this.vz;
    if (SOLID[game.world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz))]) { this.burst(game); return; }
    this.x = nx; this.y = ny; this.z = nz;
    game.particles.emit(this.x, this.y - 0.2, this.z, (Math.random() - 0.5) * 0.03, -0.05, (Math.random() - 0.5) * 0.03, 1, 0.75, 0.4, 12, 0.01);
    if (++this.age >= this.life) this.burst(game);
  }

  /** A ball of sparks in the rocket's colour, slowly falling. */
  burst(game) {
    this.dead = true;
    const [cr, cg, cb] = this.color;
    for (let k = 0; k < 70; k++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u), sp = 0.25 + Math.random() * 0.1;
      const w = 0.7 + Math.random() * 0.3;
      game.particles.emit(this.x, this.y, this.z, Math.cos(a) * s * sp, u * sp, Math.sin(a) * s * sp, cr * w, cg * w, cb * w, 30 + Math.random() * 15, 0.004);
    }
    game.audio.play('rocket_burst', [this.x, this.y, this.z]);
    if (this.star != null) this.hurtNearby(game);
  }

  /** A Star Rocket's burst hurts the mobs close to it (only where the mobs are simulated: single player and the host). */
  hurtNearby(game) {
    if (game.net && game.net.isClient) return 0;
    let n = 0;
    for (const e of game.entities.list) {
      if (e.kind !== 'mob' || e.dead || e.deathTime > 0) continue;
      const dmg = starDamage(Math.hypot(e.x - this.x, e.y + e.height / 2 - this.y, e.z - this.z));
      if (dmg > 0 && e.hurt(dmg, 'firework', null, 0)) n++;
    }
    return n;
  }

  createMesh() {
    if (this.rider) return new THREE.Group(); // its sparks are enough
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.12), new THREE.MeshBasicMaterial({ color: 0xc8303a }));
    const g = new THREE.Group();
    g.add(body);
    g.userData.dispose = () => { body.geometry.dispose(); body.material.dispose(); };
    return g;
  }

  renderUpdate(m, px, py, pz) { m.position.set(px, py, pz); }
}

/**
 * Use a Sky Rocket: while gliding it boosts the glider; aimed at a block it
 * launches from that face. Returns true if one was used.
 */
export function useSkyRocket(game, target, star = null) {
  const p = game.player;
  if (p.gliding) {
    const r = game.entities.add(new SkyRocket(p.x, p.y, p.z, p));
    p.boostTicks = r.life;
    game.audio.play('rocket', [p.x, p.y, p.z]);
    return true;
  }
  if (!target) return false;
  const x = target.x + 0.5 + target.face[0] * 0.6, y = target.y + 0.5 + target.face[1] * 0.6, z = target.z + 0.5 + target.face[2] * 0.6;
  game.entities.add(new SkyRocket(x, y, z, null, Math.random, star));
  game.audio.play('rocket', [x, y, z]);
  return true;
}
