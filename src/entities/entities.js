// Non-mob entities: dropped items, falling blocks and arrows, plus the
// manager that ticks and renders every entity (mobs included).
import * as THREE from 'three';
import { Body } from '../physics/body.js';
import { B, BLOCKS, SOLID, isFluid } from '../world/blocks.js';
import { ITEMS, I, maxStack } from '../world/items.js';
import { itemCanvas } from '../ui/icons.js';
import { texturePixels } from '../world/textures.js';
import { MIN_Y } from '../world/constants.js';

let nextEntityId = 1;
export const ENTITY_RENDER_DIST = 64;
const SHADOW_CAST_DIST = 24;
const texCache = new Map();
function iconTexture(id) {
  if (texCache.has(id)) return texCache.get(id);
  const c = itemCanvas(id);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(id, t);
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

/** Brightness multiplier for entity rendering from the light at a position. */
export function lightAt(game, x, y, z) {
  const w = game.world;
  const l = w.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
  const sky = Math.max(0, (l >> 4) - game.sky.state.skyDarken * 0) / 15;
  const blk = (l & 15) / 15;
  const curve = (f) => { const b = f / (4 - 3 * f); return b * 0.45 + (1 - Math.pow(1 - b, 4)) * 0.55; };
  return Math.max(curve(sky), curve(blk) * 0.95, 0.06);
}

export class ItemEntity {
  constructor(x, y, z, st) {
    this.id = nextEntityId++;
    this.kind = 'item';
    this.body = new Body(0.25, 0.25);
    this.body.stepHeight = 0;
    this.body.setPos(x, y, z);
    this.stack = { id: st.id, count: st.count, damage: st.damage || 0 };
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
  }
  get x() { return this.body.x; } get y() { return this.body.y; } get z() { return this.body.z; }
  tick(game) {
    const b = this.body;
    this.prev = [b.x, b.y, b.z];
    b.vy -= 0.04;
    b.move(game.world, 0, b.vy, 0);
    b.vy *= 0.98;
    this.age++;
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
}

export class Arrow {
  constructor(x, y, z, vx, vy, vz, shooter, crit = false) {
    this.id = nextEntityId++;
    this.kind = 'arrow';
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.shooter = shooter;
    this.crit = crit;
    this.stuck = false;
    this.age = 0;
    this.dead = false;
    this.prev = [x, y, z];
    this.pickup = shooter && shooter.isPlayer;
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
    if (target) {
      let dmg = Math.ceil(speed * 2);
      if (this.crit) dmg += Math.floor(Math.random() * (dmg / 2 + 2));
      const ok = target.hurt(dmg, 'arrow', this.shooter, 0.6, this);
      if (ok) { this.dead = true; return; }
      // deflected
      this.vx *= -0.1; this.vy *= -0.1; this.vz *= -0.1;
      return;
    }
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
    this.vy -= 0.05;
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
    const e = new ItemEntity(x, y, z, st);
    if (vel) { e.body.vx = vel[0]; e.body.vy = vel[1]; e.body.vz = vel[2]; }
    else { e.body.vx = (Math.random() - 0.5) * 0.2; e.body.vy = 0.2; e.body.vz = (Math.random() - 0.5) * 0.2; }
    return this.add(e);
  }
  spawnFallingBlock(x, y, z, id) { return this.add(new FallingBlock(x, y, z, id)); }
  spawnArrow(x, y, z, vx, vy, vz, shooter, crit) { return this.add(new Arrow(x, y, z, vx, vy, vz, shooter, crit)); }

  blockOccupied(x, y, z) {
    for (const e of this.list) {
      if (e.kind !== 'mob' || e.dead) continue;
      const hw = e.width / 2;
      if (e.x - hw < x + 1 && e.x + hw > x && e.y < y + 1 && e.y + e.height > y && e.z - hw < z + 1 && e.z + hw > z) return true;
    }
    return false;
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
    for (const e of cands) {
      if (e === proj.shooter || (proj.shooter && proj.shooter.isPlayer && e.isPlayer && proj.age < 5)) continue;
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
      e.tick(g);
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
        if (a.dead || b.dead || a.stack.id !== b.stack.id || ITEMS[a.stack.id].durability) continue;
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
    return !this.game.world.isLoaded(Math.floor(e.x), Math.floor(e.z));
  }

  render(alpha, timeSec) {
    const g = this.game;
    const cam = g.camera.position;
    for (const e of this.list) {
      const dist2 = (e.x - cam.x) ** 2 + (e.y - cam.y) ** 2 + (e.z - cam.z) ** 2;
      let m = this.meshes.get(e.id);
      // entity render distance (64 blocks for mobs, 32 for small entities)
      const maxD = e.kind === 'mob' ? ENTITY_RENDER_DIST : ENTITY_RENDER_DIST / 2;
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
        m.material.color.setScalar(L);
      } else if (e.kind === 'falling') {
        m.position.set(px, py + 0.5, pz);
        for (const mat of m.material) mat.color.setScalar(L);
      } else if (e.kind === 'arrow') {
        m.position.set(px, py, pz);
        if (!e.stuck) m.lookAt(px + e.vx, py + e.vy, pz + e.vz);
        m.material.color.setScalar(L);
      } else if (e.kind === 'mob') {
        e.renderUpdate(m, px, py, pz, alpha, L, timeSec);
      }
    }
  }

  createMesh(e) {
    if (e.kind === 'item') {
      const mat = new THREE.SpriteMaterial({ map: iconTexture(e.stack.id), alphaTest: 0.3 });
      const s = new THREE.Sprite(mat);
      s.scale.setScalar(0.38);
      return s;
    }
    if (e.kind === 'falling') {
      const d = BLOCKS[e.blockId];
      const side = new THREE.MeshLambertMaterial({ map: blockFaceTexture(d.tex.side) });
      const top = new THREE.MeshLambertMaterial({ map: blockFaceTexture(d.tex.top) });
      const m = new THREE.Mesh(this.cubeGeo, [side, side, top, top, side, side]);
      m.castShadow = true;
      return m;
    }
    if (e.kind === 'arrow') {
      const m = new THREE.Mesh(this.arrowGeo, new THREE.MeshLambertMaterial({ color: 0xbbaa88 }));
      return m;
    }
    if (e.kind === 'mob') return e.createMesh(this.game);
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
  };
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
