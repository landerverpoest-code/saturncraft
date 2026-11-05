// The building selection (ui/buildCommands.js): a wireframe box around the two marked corners, drawn through
// walls faintly so you can see what you have selected from inside it, plus a small marker on each corner
// (corner 1 teal, corner 2 amber).
import * as THREE from 'three';
import { selectionOf } from '../ui/buildCommands.js';

const EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

export class SelectionBox {
  constructor(scene) {
    const line = (opacity, depthTest) => {
      const m = new THREE.LineSegments(EDGES, new THREE.LineBasicMaterial({ color: 0x40e0d0, transparent: true, opacity, depthTest, depthWrite: false }));
      m.visible = false; m.renderOrder = 20; m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.front = line(0.95, true);
    this.ghost = line(0.28, false); // the same box seen through blocks
    const marker = (color) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.03, 1.03, 1.03), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false }));
      m.visible = false; m.renderOrder = 19;
      scene.add(m);
      return m;
    };
    this.m1 = marker(0x40e0d0);
    this.m2 = marker(0xffb030);
    this.key = '';
  }

  /** Follow the player's selection (cheap: nothing changes unless a corner moved). */
  update(game) {
    const sel = selectionOf(game), dim = game.world.dimension;
    const a = sel && sel.pos1 && sel.pos1.dim === dim ? sel.pos1 : null, b = sel && sel.pos2 && sel.pos2.dim === dim ? sel.pos2 : null;
    const key = `${a ? [a.x, a.y, a.z] : ''}|${b ? [b.x, b.y, b.z] : ''}`;
    if (key === this.key) return;
    this.key = key;
    this.m1.visible = !!a; this.m2.visible = !!b;
    if (a) this.m1.position.set(a.x + 0.5, a.y + 0.5, a.z + 0.5);
    if (b) this.m2.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
    const both = a && b;
    this.front.visible = this.ghost.visible = !!both;
    if (!both) return;
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), z0 = Math.min(a.z, b.z);
    const sx = Math.abs(a.x - b.x) + 1, sy = Math.abs(a.y - b.y) + 1, sz = Math.abs(a.z - b.z) + 1;
    for (const m of [this.front, this.ghost]) {
      m.scale.set(sx + 0.01, sy + 0.01, sz + 0.01);
      m.position.set(x0 + sx / 2, y0 + sy / 2, z0 + sz / 2);
    }
  }
}
