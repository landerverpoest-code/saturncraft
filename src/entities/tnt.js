// Primed TNT: a block-sized entity that falls and slides like a dropped
// block, flashes white, and explodes with power 4 after an 80-tick fuse
// (10-30 ticks when set off by another explosion, as in the reference).
import * as THREE from 'three';
import { Body } from '../physics/body.js';
import { B } from '../world/blocks.js';
import { blockFaceTexture } from './entities.js';

let nextId = 8_000_000;

export class PrimedTNT {
  constructor(x, y, z, fuse = 80) {
    this.id = nextId++;
    this.kind = 'tnt';
    this.body = new Body(0.98, 0.98);
    this.body.setPos(x, y, z);
    // a little hop in a random direction when lit
    const a = Math.random() * Math.PI * 2;
    this.body.vx = -Math.sin(a) * 0.02; this.body.vz = -Math.cos(a) * 0.02; this.body.vy = 0.2;
    this.fuse = fuse;
    this.prev = [x, y, z];
    this.dead = false;
    this.noFreeze = true;
  }
  get x() { return this.body.x; } get y() { return this.body.y; } get z() { return this.body.z; }
  get width() { return 0.98; } get height() { return 0.98; }

  tick(game) {
    const b = this.body;
    this.prev = [b.x, b.y, b.z];
    b.vy -= 0.04;
    b.move(game.world, b.vx, b.vy, b.vz);
    b.vx *= 0.98; b.vy *= 0.98; b.vz *= 0.98;
    if (b.onGround) { b.vx *= 0.7; b.vz *= 0.7; }
    if (Math.random() < 0.5) game.particles.smoke(b.x, b.y + 1, b.z, 1, 0.2);
    if (--this.fuse <= 0) {
      this.dead = true;
      if (!game.net || game.net.isHost) game.explode(b.x, b.y + 0.49, b.z, 4, this);
    }
  }

  createMesh() {
    const side = new THREE.MeshLambertMaterial({ map: blockFaceTexture('tnt_side') });
    const top = new THREE.MeshLambertMaterial({ map: blockFaceTexture('tnt_top') });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [side, side, top, top, side, side]);
    m.userData.mats = [side, top];
    m.castShadow = true;
    return m;
  }

  renderUpdate(m, px, py, pz, alpha, L) {
    m.position.set(px, py + 0.5, pz);
    // swells and flashes white every 5 ticks near the end
    const f = Math.max(0, 1 - this.fuse / 10);
    m.scale.setScalar(1 + f * f * 0.3);
    const flash = (this.fuse / 5 | 0) % 2 === 0;
    for (const mat of m.userData.mats) { mat.color.setScalar(L); mat.emissive.setScalar(flash ? 0.6 : 0); }
  }
}

/** Light a TNT block at x,y,z: it turns into a primed TNT entity. */
export function igniteTNT(game, x, y, z, fuse = 80) {
  const w = game.world;
  if (w.getBlock(x, y, z) !== B.TNT) return null;
  // a multiplayer guest asks the host, which lights it for everyone
  if (game.net && game.net.isClient && !game.net.applyingRemote) { game.net.requestSpawn('tnt', { x, y, z }); return null; }
  w.setBlockUrgent(x, y, z, B.AIR);
  const e = game.entities.add(new PrimedTNT(x + 0.5, y, z + 0.5, fuse));
  game.audio.play('fuse', [x + 0.5, y + 0.5, z + 0.5]);
  return e;
}
