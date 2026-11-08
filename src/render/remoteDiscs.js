// Other players' thrown Returning Discs (entities/disc.js): a disc is flown by its thrower's own game, which sends its position
// ten times a second (`disc` messages); here it is drawn as a spinning disc gliding between those positions. A disc that has
// not been heard of for DISC_STALE_MS is gone (the throw ended or the link is slow).
import * as THREE from 'three';
import { MATERIALS } from '../world/items.js';

export const DISC_STALE_MS = 700;
const BODY = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 14);
const HOLE = new THREE.CylinderGeometry(0.09, 0.09, 0.07, 10);
const HOLE_MAT = new THREE.MeshLambertMaterial({ color: 0x20202a });

/** Pure: should a remote disc still be drawn? (`now` and `seen` in ms) */
export const discAlive = (seen, now) => now - seen < DISC_STALE_MS;

export class RemoteDiscs {
  constructor(scene) { this.scene = scene; this.map = new Map(); } // owner id -> { mesh, x, y, z, seen, tier }

  /** A position from player `id`'s disc (`on` false: the flight is over). */
  set(id, on, x, y, z, tier, now = performance.now()) {
    if (!on) { this.drop(id); return; }
    let e = this.map.get(id);
    if (!e) {
      const color = new THREE.Color((MATERIALS[tier] || MATERIALS.iron).color);
      const mat = new THREE.MeshLambertMaterial({ color });
      const mesh = new THREE.Mesh(BODY, mat);
      mesh.add(new THREE.Mesh(HOLE, HOLE_MAT));
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      e = { mesh, mat, x, y, z, seen: now, tier, spin: 0 };
      this.map.set(id, e);
    }
    e.x = x; e.y = y; e.z = z; e.seen = now;
  }

  update(sec, now = performance.now()) {
    for (const [id, e] of [...this.map]) {
      if (!discAlive(e.seen, now)) { this.drop(id); continue; }
      const k = Math.min(1, sec * 14);
      e.mesh.position.x += (e.x - e.mesh.position.x) * k; e.mesh.position.y += (e.y - e.mesh.position.y) * k; e.mesh.position.z += (e.z - e.mesh.position.z) * k;
      e.spin += sec * 54;
      e.mesh.rotation.set(0.35, e.spin, 0);
    }
  }

  drop(id) {
    const e = this.map.get(id);
    if (!e) return;
    this.scene.remove(e.mesh); e.mat.dispose();
    this.map.delete(id);
  }

  dispose() { for (const id of [...this.map.keys()]) this.drop(id); }
}
