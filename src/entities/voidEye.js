// A thrown Eye of the Void: rises and drifts about 12 blocks towards the
// nearest Hollow Sanctum, hovers, then drops back as an item (or shatters,
// one time in five).
import * as THREE from 'three';
import { I } from '../world/items.js';

let nextId = 6_000_000;

export class VoidEye {
  constructor(x, y, z, tx, tz) {
    this.id = nextId++;
    this.kind = 'void_eye';
    this.x = x; this.y = y; this.z = z;
    this.prev = [x, y, z];
    const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz) || 1;
    const reach = Math.min(12, d);
    this.tx = x + dx / d * reach; this.tz = z + dz / d * reach; this.ty = y + (d > 12 ? 8 : -1);
    this.age = 0;
    this.dead = false;
  }

  tick(game) {
    this.prev = [this.x, this.y, this.z];
    this.age++;
    if (this.age < 40) {
      this.x += (this.tx - this.x) * 0.08; this.z += (this.tz - this.z) * 0.08; this.y += (this.ty - this.y) * 0.08;
    }
    game.particles.emit(this.x, this.y, this.z, (Math.random() - 0.5) * 0.04, -0.01, (Math.random() - 0.5) * 0.04, 0.4, 1, 0.6, 18, 0);
    if (this.age >= 70) {
      this.dead = true;
      if (Math.random() < 0.8) game.entities.spawnItem(this.x, this.y, this.z, { id: I.EYE_OF_THE_VOID, count: 1 });
      else { game.particles.smoke(this.x, this.y, this.z, 16, 0.6); game.audio.play('break_glass', [this.x, this.y, this.z]); }
    }
  }

  createMesh() {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), new THREE.MeshBasicMaterial({ color: 0x5fe0a0 }));
    m.userData.dispose = () => { m.geometry.dispose(); m.material.dispose(); };
    return m;
  }

  renderUpdate(m, px, py, pz, alpha, L, sec) {
    m.position.set(px, py + Math.sin(sec * 6) * 0.05, pz);
    m.rotation.set(sec * 2, sec * 3, 0);
  }
}
