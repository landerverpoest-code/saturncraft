// The thrown Returning Disc: flies out along the throw, hitting every mob it passes once, turns at the end of its
// range (or the first block), flies back to the thrower and is caught. The item never leaves the inventory (the disc
// in the air is a copy of the stack's numbers), so a disc cannot be lost or duplicated: when the thrower is dead,
// far away or the flight runs too long it simply ends. A clean catch starts a streak: each adds a point to the next
// throw (up to CATCH_STREAK_MAX), and the streak is lost when a flight ends any other way.
// The disc is local to its thrower (like fireballs it is not shared): its hits reach the host as the usual arrow
// hits of a guest, so damage and kills are the host's to count; other players see the hits, not the flight.
import * as THREE from 'three';
import { MATERIALS, ITEMS } from '../world/items.js';
import * as W from '../world/weaponStats.js';
import { discDamage, discRange } from '../player/weapons.js';
import { gearBonuses } from '../player/gear.js';
import { durabilityLoss } from '../world/enchantments.js';

export const CATCH_STREAK_MAX = 3;
export const DISC_COOLDOWN = 12; // ticks after a catch before the next throw (a fumble costs 3 x)
let nextId = 7_000_000;

/**
 * One tick of the flight, pure. `s`: { x, y, z, vx, vy, vz, phase: 'out' | 'back', travelled, range }; `owner`: { x, y, z } (chest height
 * of the thrower); `blocked`: the way ahead is solid. Returns 'caught' | 'fumbled' | null and moves `s`.
 */
export function stepDisc(s, owner, blocked = false) {
  s.age = (s.age | 0) + 1;
  if (s.phase === 'out') {
    const step = Math.hypot(s.vx, s.vy, s.vz);
    if (blocked || s.travelled + step >= s.range) { s.phase = 'back'; s.turned = s.age; return null; }
    s.x += s.vx; s.y += s.vy; s.z += s.vz;
    s.travelled += step;
    return null;
  }
  const dx = owner.x - s.x, dy = owner.y - s.y, dz = owner.z - s.z, d = Math.hypot(dx, dy, dz) || 1;
  if (d < W.DISC_CATCH_DIST) return 'caught';
  if (s.age >= W.DISC_MAX_TICKS || s.age - s.turned > 80) return 'fumbled';
  const sp = W.DISC_SPEED * 1.15, k = 0.22; // steer towards the thrower, a curve rather than a straight line
  s.vx += (dx / d * sp - s.vx) * k; s.vy += (dy / d * sp - s.vy) * k; s.vz += (dz / d * sp - s.vz) * k;
  const v = Math.hypot(s.vx, s.vy, s.vz) || 1, step = Math.min(v, d);
  s.x += s.vx / v * step; s.y += s.vy / v * step; s.z += s.vz / v * step;
  return null;
}

export class ReturningDisc {
  /** `stack`: the thrown stack (it stays in the inventory); `streak`: clean catches in a row before this throw. */
  constructor(game, owner, stack, streak = 0) {
    const [ex, ey, ez] = owner.eyePos(), [dx, dy, dz] = owner.lookDir();
    this.id = nextId++;
    this.kind = 'disc';
    this.owner = owner;
    this.stack = stack;
    this.streak = streak;
    this.x = ex + dx * 0.5; this.y = ey - 0.2 + dy * 0.5; this.z = ez + dz * 0.5;
    this.prev = [this.x, this.y, this.z];
    this.s = { x: this.x, y: this.y, z: this.z, vx: dx * W.DISC_SPEED, vy: dy * W.DISC_SPEED, vz: dz * W.DISC_SPEED, phase: 'out', travelled: 0, range: discRange(stack), age: 0 };
    this.hit = new Set(); // mobs struck on this leg
    this.dead = false;
    this.noFreeze = true;
    this.spin = 0;
    this.tier = ITEMS[stack.id].weapon.material;
  }

  /** Damage of this throw: the tier's, +1 for each clean catch before it. */
  get damage() { return discDamage(this.stack) + this.streak; }

  tick(game) {
    const o = this.owner, s = this.s;
    this.prev = [this.x, this.y, this.z];
    this.spin += 0.9;
    if (o.dead || game.player !== o) { this.end(game, 'fumbled'); return; }
    const phase = s.phase;
    const nx = s.vx, ny = s.vy, nz = s.vz, sp = Math.hypot(nx, ny, nz) || 1;
    const blocked = phase === 'out' && !!game.world.raycast(s.x, s.y, s.z, nx / sp, ny / sp, nz / sp, sp + 0.3);
    const res = stepDisc(s, { x: o.x, y: o.y + 1.0, z: o.z }, blocked);
    if (blocked) game.audio.play('disc_clack', [s.x, s.y, s.z]);
    if (s.phase !== phase) this.hit.clear(); // a fresh leg: everything can be struck again
    this.x = s.x; this.y = s.y; this.z = s.z;
    if (res) { this.end(game, res); return; }
    this.strike(game);
    if (game.ticks % 3 === 0) game.audio.play('disc_whirr', [this.x, this.y, this.z], 0.35);
    if (game.particles && game.ticks % 2 === 0) game.particles.emit(this.x, this.y, this.z, 0, 0, 0, 0.8, 0.9, 1, 8, 0);
  }

  /** Hit the mobs in reach, each once per leg. */
  strike(game) {
    const o = this.owner, dmg = this.damage;
    for (const e of game.entities.list) {
      if (e.kind !== 'mob' || e.dead || e.deathTime > 0 || this.hit.has(e) || (e.special && e.def && e.def.burrower)) continue;
      const hw = e.width / 2 + W.DISC_HIT_RADIUS * 0.5;
      if (Math.abs(e.x - this.x) > hw || Math.abs(e.z - this.z) > hw || this.y < e.y - 0.4 || this.y > e.y + e.height + 0.3) continue;
      this.hit.add(e);
      o.lastAttacked = e;
      if (e.kind === 'mob') e.plunder = 0;
      if (e.hurt(dmg, 'arrow', o, 0.45, this)) {
        game.audio.play('arrow_hit', [e.x, e.y + 1, e.z]);
        if (game.particles && game.particles.crit) game.particles.crit(e.x, e.y + e.height * 0.6, e.z);
        wearDisc(game, this.stack);
      }
    }
  }

  end(game, how) {
    this.dead = true;
    const it = game.interaction;
    if (!it) return;
    if (how === 'caught') {
      it.discStreak = Math.min(CATCH_STREAK_MAX, this.streak + 1);
      it.discReady = game.ticks + DISC_COOLDOWN;
      game.audio.play('disc_catch', [this.owner.x, this.owner.y + 1, this.owner.z]);
      if (game.milestones) game.milestones.event('disc_catch');
    } else {
      it.discStreak = 0;
      it.discReady = game.ticks + DISC_COOLDOWN * 3;
      game.audio.play('disc_clack', [this.x, this.y, this.z]);
    }
    it.disc = null;
  }

  createMesh() {
    const color = new THREE.Color((MATERIALS[this.tier] || MATERIALS.iron).color);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 14), new THREE.MeshLambertMaterial({ color }));
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 10), new THREE.MeshLambertMaterial({ color: 0x20202a }));
    m.add(hole);
    m.castShadow = true;
    m.userData.dispose = () => { m.geometry.dispose(); m.material.dispose(); hole.geometry.dispose(); hole.material.dispose(); };
    return m;
  }

  renderUpdate(m, px, py, pz) {
    m.position.set(px, py, pz);
    m.rotation.set(0.35, this.spin, 0);
  }
}

/** The thrown disc wears a point on a hit; a worn-out one leaves the inventory. */
export function wearDisc(game, stack) {
  const p = game.player, inv = p.inventory;
  if (p.creative || !stack) return;
  const d = ITEMS[stack.id];
  const loss = Math.random() < gearBonuses(inv).wearSave ? 0 : durabilityLoss(stack, 1, Math.random); // Steadfast and the Gilded set spare some wear
  stack.damage = (stack.damage || 0) + loss;
  if (stack.damage >= d.durability) {
    const i = inv.slots.indexOf(stack);
    if (i >= 0) inv.slots[i] = null;
    for (const f of inv.breakListeners) f(d);
  }
  inv.changed();
}
