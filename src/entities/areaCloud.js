// Area-effect clouds (reference: area effect cloud). A lingering elixir that
// breaks leaves one on the ground: a translucent disc of drifting coloured
// specks, 3 blocks across at first, that waits half a second and then for
// 30 s lays its effects (a quarter of each duration, half of an instant one;
// see effects.js lingerFactor) on every creature standing in it, each at most
// once a second. The radius shrinks steadily (to nothing over the 30 s) and by
// half a block every time it touches someone. The Void Wyrm breathes clouds of
// its own (violet, Instant Damage, 10 s) that fill Glass Vials with Hollow Breath.
// In multiplayer the host runs the cloud and guests see a copy (net/protocol.js
// kind 'cloud'); a guest standing in it gets the effects sent like a splash.
import * as THREE from 'three';
import { ITEMS } from '../world/items.js';
import { POTIONS, potionColor } from '../world/potions.js';
import { SOLID } from '../world/blocks.js';
import { lingerFactor } from '../player/effects.js';

let nextId = 8_000_000;
/** Reference numbers: radius 3, 600 ticks, 10 ticks' wait, reapplied every 20 ticks, -0.5 radius per use. */
export const CLOUD = { radius: 3, duration: 600, wait: 10, reapply: 20, shrinkOnUse: 0.5, minRadius: 0.5, check: 5 };
export const BREATH = { radius: 3, duration: 200, color: '#a04ad8', effects: [['instant_damage', 1, 0]] };

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

export class AreaCloud {
  /**
   * opts: potion (lingering item id), or breath: true for the Wyrm's breath; radius, duration,
   * effects, colour, shrinkPerTick, shrinkOnUse, wait and owner (who threw it) override the defaults.
   */
  constructor(x, y, z, opts = {}) {
    this.id = nextId++;
    this.kind = 'cloud';
    this.x = x; this.y = y; this.z = z;
    this.prev = [x, y, z];
    this.potion = opts.potion | 0;
    this.breath = !!opts.breath;
    const d = ITEMS[this.potion], kind = d && d.potion ? d.potion.kind : null;
    this.water = kind === 'water';
    this.effects = opts.effects || (this.breath ? BREATH.effects : kind ? POTIONS[kind].effects : []);
    this.color = opts.color || (this.breath ? BREATH.color : kind ? potionColor(kind) : '#ffffff');
    this.duration = opts.duration ?? (this.breath ? BREATH.duration : CLOUD.duration);
    this.radius = opts.radius ?? (this.breath ? BREATH.radius : CLOUD.radius);
    this.shrinkPerTick = opts.shrinkPerTick ?? (this.breath ? 0 : this.radius / this.duration); // 3 / 600 = 0.005
    this.shrinkOnUse = opts.shrinkOnUse ?? (this.breath ? 0 : CLOUD.shrinkOnUse);
    this.wait = opts.wait ?? CLOUD.wait;
    this.owner = opts.owner || null;
    this.age = 0;
    this.dead = false;
    this.hits = new Map(); // target -> age when last affected
  }

  /** Is a creature standing in the cloud (feet or body within the flat disc)? */
  contains(t) {
    const h = t.height ?? (t.body && t.body.height) ?? 1.8;
    if (t.y > this.y + 1 || t.y + h < this.y - 0.5) return false;
    const dx = t.x - this.x, dz = t.z - this.z;
    return dx * dx + dz * dz <= this.radius * this.radius;
  }

  /**
   * One tick of the cloud's life (pure; host and single player). Returns the creatures
   * among `targets` it reaches this tick.
   */
  step(targets) {
    this.age++;
    if (this.age <= this.wait) return [];
    this.radius -= this.shrinkPerTick;
    if (this.age > this.wait + this.duration || this.radius < CLOUD.minRadius) { this.dead = true; return []; }
    if ((this.age - this.wait) % CLOUD.check !== 0) return [];
    const out = [];
    for (const t of targets) {
      if (!t || t.dead || t.deathTime > 0) continue;
      const last = this.hits.get(t);
      if (last !== undefined && this.age - last < CLOUD.reapply) continue;
      if (!this.contains(t)) continue;
      this.hits.set(t, this.age);
      out.push(t);
      if (this.shrinkOnUse) {
        this.radius -= this.shrinkOnUse;
        if (this.radius < CLOUD.minRadius) { this.dead = true; break; }
      }
    }
    return out;
  }

  /** Lay the cloud's effects on one creature (the local player, a mob or a guest's stand-in). */
  affect(game, t) {
    if (this.water) {
      if (t.isRemotePlayer) { if (game.net && game.net.splashRemote) game.net.splashRemote(t, this.potion, 1); return; }
      t.fireTicks = 0;
      if (t.type === 'voidwalker') t.hurt(1, 'water');
      return;
    }
    for (const [type, ticks, amp] of this.effects) {
      if (t.kind === 'mob') t.applyEffect(type, ticks, amp, lingerFactor(type), this.owner);
      else t.applyEffect(type, ticks, amp, lingerFactor(type)); // the player; a guest's game applies its own
    }
  }

  tick(game) {
    this.prev = [this.x, this.y, this.z];
    this.specks(game);
    const targets = [];
    const p = game.player;
    if (p && !p.dead) targets.push(p);
    for (const e of game.entities.list) if (e.kind === 'mob' && !e.netProxy && !e.dead) targets.push(e);
    if (game.net && game.net.isHost) targets.push(...game.net.remoteTargets(null));
    for (const t of this.step(targets)) this.affect(game, t);
  }

  /** A guest's copy: only the specks (the host's cloud does the work). */
  proxyTick(game) { this.age++; this.specks(game); }

  /** Drifting specks spread over the disc, more for a bigger cloud. */
  specks(game) {
    const P = game.particles;
    if (!P || this.radius <= 0) return;
    const [r, g, b] = rgb(this.color);
    const n = Math.max(1, Math.round(this.radius * this.radius * 0.7));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * this.radius, w = 0.75 + Math.random() * 0.35;
      P.emit(this.x + Math.cos(a) * d, this.y + 0.05 + Math.random() * 0.4, this.z + Math.sin(a) * d,
        (Math.random() - 0.5) * 0.01, 0.006 + Math.random() * 0.01, (Math.random() - 0.5) * 0.01, r * w, g * w, b * w, 14 + Math.random() * 12, -0.0004);
    }
  }

  createMesh() {
    const geo = new THREE.CircleGeometry(1, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.color), transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 2;
    m.userData.base = new THREE.Color(this.color);
    m.userData.dispose = () => { geo.dispose(); mat.dispose(); };
    return m;
  }

  renderUpdate(m, px, py, pz, alpha, L, sec) {
    const r = Math.max(0.01, this.radius);
    m.position.set(px, py + 0.03, pz);
    m.scale.set(r, 1, r);
    m.material.opacity = Math.min(1, r / 1.5) * (0.24 + 0.06 * Math.sin(sec * 3 + this.id));
    m.material.color.copy(m.userData.base).multiplyScalar(Math.max(0.45, L));
  }
}

/** The height a cloud settles at below an impact point: on top of the first solid block within 5 below. */
export function cloudFloor(world, x, y, z) {
  const bx = Math.floor(x), bz = Math.floor(z);
  let yy = Math.floor(y);
  for (let k = 0; k < 2 && SOLID[world.getBlock(bx, yy, bz)]; k++) yy++; // broke on the side of a block
  for (let k = 0; k < 5; k++, yy--) if (SOLID[world.getBlock(bx, yy - 1, bz)]) return yy;
  return y;
}

/** A Wyrm breath cloud near (x, y, z) that a Glass Vial can be filled from, or null. */
export function breathCloudNear(game, x, y, z) {
  for (const e of game.entities.list) {
    if (e.kind !== 'cloud' || !e.breath || e.dead) continue;
    if (Math.abs(y - e.y) < 3 && Math.hypot(x - e.x, z - e.z) <= e.radius + 2) return e;
  }
  return null;
}
