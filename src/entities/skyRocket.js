// Sky Rockets (reference: firework rockets). Launched from a block they climb
// faster and faster (x1.15 sideways, +0.04 up per tick) for 20-31 ticks (more with a longer flight, 1-3 blast
// powder) and burst into coloured sparks (a plain rocket: a ball in one random colour, decoration only).
// A Star Rocket (made with Firework Stars, world/items.js and world/fireworks.js) carries up to 7 stars, each
// bursting in its own colours and shape (ball, large ball, star, burst, Fizzler face) with its own trail and
// twinkle, and hurts the mobs within STAR_RANGE blocks of the burst (5 + 2 per star); only the host (or a
// single player) deals that damage.
// Used while gliding they ride along with the player and push the Voidwing
// (Player.boostTicks, see player/glider.js rocketBoost), trailing sparks.
import * as THREE from 'three';
import { SOLID } from '../world/blocks.js';
import { rocketLifetime } from '../player/glider.js';
import { COLORS } from '../world/colors.js';
import { rocketOfStack, burstVelocities, burstDamage } from '../world/fireworks.js';

/** Mobs within this many blocks of a Star Rocket's burst take 5 + 2 per star (STAR_DAMAGE for a one-star rocket). */
export const STAR_RANGE = 5, STAR_DAMAGE = 7;
/** Damage a Star Rocket's burst deals at distance `dist` blocks (`stars` aboard). */
export const starDamage = (dist, stars = 1) => (dist <= STAR_RANGE ? burstDamage(stars) : 0);
/** Spark colour (0-1 rgb) of a Firework Star colour index. */
export const starColor = (c) => (COLORS[c] ? COLORS[c][2].map((v) => v / 255) : null);
/** Sparks followed after a burst: at most this many per star with a trail / a twinkle, the trail for this many ticks. */
const TRAIL_HEADS = 16, TWINKLE_HEADS = 12, TRAIL_TICKS = 18;

let nextId = 7_000_000;
const PALETTES = [[1, 0.35, 0.3], [0.4, 0.8, 1], [1, 0.85, 0.3], [0.7, 0.45, 1], [0.45, 1, 0.55], [1, 0.55, 0.9]];

export class SkyRocket {
  /**
   * `rider`: the gliding player it pushes (or null for a free rocket); `star`: a Firework Star colour index (a Star Rocket
   * of the original per-colour items); `stack`: the Sky / Star Rocket stack it was made from (flight and stars, world/fireworks.js).
   */
  constructor(x, y, z, rider = null, rng = Math.random, star = null, stack = null) {
    this.id = nextId++;
    this.kind = 'rocket';
    this.x = x; this.y = y; this.z = z;
    this.prev = [x, y, z];
    this.rider = rider;
    this.vx = (rng() - 0.5) * 0.023; this.vz = (rng() - 0.5) * 0.023; this.vy = 0.05;
    const r = rocketOfStack(stack);
    this.flight = r.flight;
    this.stars = r.stars.length ? r.stars : star != null && COLORS[star] ? [{ c: [star], s: 0, t: 0, w: 0 }] : [];
    this.life = rocketLifetime(this.flight, rng);
    this.age = 0; this.dead = false;
    this.star = this.stars.length ? this.stars[0].c[0] : null;
    this.color = starColor(this.star) || PALETTES[Math.floor(rng() * PALETTES.length)];
    this.exploded = false;
    this.heads = []; // sparks still followed after the burst (trails, twinkles)
    this.fxAge = 0; this.twinkled = false;
  }

  tick(game) {
    if (this.exploded) { this.tickSparks(game); return; }
    this.prev = [this.x, this.y, this.z];
    const r = this.rider;
    if (r) {
      // riding along: sparks behind the glider
      this.x = r.x; this.y = r.y + 0.3; this.z = r.z;
      game.particles.emit(this.x, this.y, this.z, -r.body.vx * 0.3, -r.body.vy * 0.3, -r.body.vz * 0.3, 1, 0.8, 0.5, 14, 0);
      if (++this.age >= this.life || r.dead || !r.gliding) this.dead = true;
      return;
    }
    if (this.age < 31) { this.vx *= 1.15; this.vz *= 1.15; } // (a longer flight climbs on, but does not veer further)
    this.vy = Math.min(1.3, this.vy + 0.04);
    const nx = this.x + this.vx, ny = this.y + this.vy, nz = this.z + this.vz;
    if (SOLID[game.world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz))]) { this.burst(game); return; }
    this.x = nx; this.y = ny; this.z = nz;
    game.particles.emit(this.x, this.y - 0.2, this.z, (Math.random() - 0.5) * 0.03, -0.05, (Math.random() - 0.5) * 0.03, 1, 0.75, 0.4, 12, 0.01);
    if (++this.age >= this.life) this.burst(game);
  }

  /**
   * The burst: every star on board puts out its own shape of sparks in its colours (a plain rocket: a small ball in
   * its random colour). Stars with a trail or twinkle leave a few sparks to follow (tickSparks).
   */
  burst(game, rng = Math.random) {
    this.exploded = true;
    const stars = this.stars.length ? this.stars : [{ c: null, s: 0, t: 0, w: 0 }];
    for (const star of stars) {
      const cols = star.c ? star.c.map(starColor) : [this.color];
      const vels = burstVelocities(star.s, rng);
      const headStride = star.t || star.w ? Math.ceil(vels.length / (star.t ? TRAIL_HEADS : TWINKLE_HEADS)) : 0;
      vels.forEach(([vx, vy, vz], k) => {
        const [cr, cg, cb] = cols[Math.floor(rng() * cols.length)], w = 0.7 + rng() * 0.3;
        game.particles.emit(this.x, this.y, this.z, vx, vy, vz, cr * w, cg * w, cb * w, 30 + rng() * 15, 0.004);
        if (headStride && k % headStride === 0) {
          this.heads.push({ x: this.x, y: this.y, z: this.z, vx, vy, vz, rgb: [cr, cg, cb], trail: star.t, twinkleAt: star.w ? 14 + Math.floor(rng() * 14) : -1 });
        }
      });
    }
    // bigger bursts (large balls, stars, several stars at once) boom
    const big = stars.length >= 3 || stars.some((s) => s.s === 1 || s.s === 2);
    game.audio.play(big ? 'rocket_blast' : 'rocket_burst', [this.x, this.y, this.z]);
    if (this.stars.length) this.hurtNearby(game, this.stars.length);
    this.dead = this.heads.length === 0;
  }

  /** After the burst: trails drawn behind the followed sparks, and twinkles that crackle white when their time comes. */
  tickSparks(game) {
    this.fxAge++;
    for (let i = this.heads.length - 1; i >= 0; i--) {
      const h = this.heads[i];
      h.vy -= 0.004; // (the same motion as the sparks themselves, render/particles.js)
      h.x += h.vx; h.y += h.vy; h.z += h.vz;
      h.vx *= 0.94; h.vy *= 0.94; h.vz *= 0.94;
      if (h.trail && this.fxAge <= TRAIL_TICKS) game.particles.emit(h.x, h.y, h.z, 0, 0, 0, h.rgb[0] * 0.8, h.rgb[1] * 0.8, h.rgb[2] * 0.8, 7, 0);
      if (h.twinkleAt === this.fxAge) {
        for (let k = 0; k < 4; k++) game.particles.emit(h.x, h.y, h.z, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08, 1, 1, 0.9, 6 + Math.random() * 4, 0);
        if (!this.twinkled) { this.twinkled = true; game.audio.play('rocket_twinkle', [h.x, h.y, h.z]); }
      }
      if (this.fxAge >= Math.max(h.trail ? TRAIL_TICKS : 0, h.twinkleAt + 1)) this.heads.splice(i, 1);
    }
    if (!this.heads.length) this.dead = true;
  }

  /** A Star Rocket's burst hurts the mobs close to it (only where the mobs are simulated: single player and the host). */
  hurtNearby(game, stars = 1) {
    if (game.net && game.net.isClient) return 0;
    let n = 0;
    for (const e of game.entities.list) {
      if (e.kind !== 'mob' || e.dead || e.deathTime > 0) continue;
      const dmg = starDamage(Math.hypot(e.x - this.x, e.y + e.height / 2 - this.y, e.z - this.z), stars);
      if (dmg > 0 && e.hurt(dmg, 'firework', null, 0)) n++;
    }
    return n;
  }

  createMesh() {
    if (this.rider) return new THREE.Group(); // its sparks are enough
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.12), new THREE.MeshBasicMaterial({ color: this.star == null ? 0xc8303a : new THREE.Color(...this.color) }));
    const g = new THREE.Group();
    g.add(body);
    g.userData.dispose = () => { body.geometry.dispose(); body.material.dispose(); };
    return g;
  }

  renderUpdate(m, px, py, pz) { m.position.set(px, py, pz); m.visible = !this.exploded; }
}

/**
 * Use a Sky Rocket: while gliding it boosts the glider; aimed at a block it
 * launches from that face. `stack` is the rocket's stack (its flight and stars).
 * Returns true if one was used.
 */
export function useSkyRocket(game, target, star = null, stack = null) {
  const p = game.player;
  if (p.gliding) {
    const r = game.entities.add(new SkyRocket(p.x, p.y, p.z, p, Math.random, null, stack));
    p.boostTicks = r.life;
    game.audio.play('rocket', [p.x, p.y, p.z]);
    return true;
  }
  if (!target) return false;
  const x = target.x + 0.5 + target.face[0] * 0.6, y = target.y + 0.5 + target.face[1] * 0.6, z = target.z + 0.5 + target.face[2] * 0.6;
  game.entities.add(new SkyRocket(x, y, z, null, Math.random, star, stack));
  game.audio.play('rocket', [x, y, z]);
  return true;
}
