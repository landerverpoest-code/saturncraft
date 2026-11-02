// Ping beacons in the world (net/social.js PingBoard): a thin glowing column and a spinning
// diamond at the spot a friend pointed out, in their team's colour, fading over the last seconds.
import * as THREE from 'three';

const COLUMN = new THREE.BoxGeometry(0.12, 1, 0.12).translate(0, 0.5, 0);
const GEM = new THREE.OctahedronGeometry(0.32);
const HEIGHT = 40;

export class PingBeacons {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map(); // sender name -> { group, mats }
  }

  /** Show exactly these beacons (PingBoard.active): [{ from, x, y, z, color, life }]. */
  set(list, now, sec = 0) {
    const keep = new Set();
    for (const b of list) {
      keep.add(b.from);
      let e = this.map.get(b.from);
      if (!e) {
        const group = new THREE.Group();
        const mk = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff });
        const column = new THREE.Mesh(COLUMN, mk()), gem = new THREE.Mesh(GEM, mk());
        column.scale.y = HEIGHT; column.frustumCulled = false; gem.frustumCulled = false;
        gem.position.y = 1.1;
        group.add(column, gem);
        this.scene.add(group);
        e = { group, column, gem };
        this.map.set(b.from, e);
      }
      e.group.position.set(b.x, b.y, b.z);
      e.gem.rotation.y = now / 400;
      e.gem.position.y = 1.1 + Math.sin(now / 300) * 0.12;
      const fade = b.life < 0.15 ? b.life / 0.15 : 1; // the last 3 s fade out
      e.column.material.color.set(b.color); e.gem.material.color.set(b.color);
      e.column.material.opacity = 0.35 * fade; e.gem.material.opacity = 0.9 * fade;
    }
    for (const [k, e] of this.map) if (!keep.has(k)) { this.drop(e); this.map.delete(k); }
  }

  drop(e) {
    this.scene.remove(e.group);
    e.column.material.dispose(); e.gem.material.dispose();
  }

  dispose() { for (const e of this.map.values()) this.drop(e); this.map.clear(); }
}
