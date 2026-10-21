// Item frames: the item inside each frame (game.frames) is drawn as a flat
// icon in front of the frame's board, turned in 45-degree steps (meta bits
// 2-4). Only frames within 48 blocks are shown.
import * as THREE from 'three';
import { B } from '../world/blocks.js';
import { SIDE_DIRS } from '../world/shapes.js';
import { itemCanvas } from '../ui/icons.js';

export const FRAME_ROT = (meta) => (meta >> 2) & 7;

export class FrameRenderer {
  constructor(game) {
    this.game = game;
    this.meshes = new Map();
    this.geo = new THREE.PlaneGeometry(0.5, 0.5);
  }

  update() {
    const g = this.game, p = g.player, w = g.world;
    for (const [k, st] of g.frames) {
      const [x, y, z] = k.split(',').map(Number);
      const id = w.isLoaded(x, z) ? w.getBlock(x, y, z) : -1;
      if (id >= 0 && id !== B.ITEM_FRAME) { g.frames.delete(k); continue; } // the frame is gone
      const near = id > 0 && st && Math.abs(x - p.x) < 48 && Math.abs(z - p.z) < 48;
      const meta = id > 0 ? w.getMeta(x, y, z) : 0, sig = st ? `${st.id}|${meta}` : '';
      const cur = this.meshes.get(k);
      if (!near) { if (cur) this.drop(k); continue; }
      if (cur && cur.sig === sig) continue;
      if (cur) this.drop(k);
      const tex = new THREE.CanvasTexture(itemCanvas(st.id));
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(this.geo, new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.3 }));
      const [dx, , dz] = SIDE_DIRS[meta & 3];
      mesh.position.set(x + 0.5 + dx * (0.5 - 1.6 / 16), y + 0.5, z + 0.5 + dz * (0.5 - 1.6 / 16));
      mesh.rotation.set(0, Math.atan2(-dx, -dz), 0, 'YXZ');
      mesh.rotateZ(-FRAME_ROT(meta) * Math.PI / 4);
      g.scene.add(mesh);
      this.meshes.set(k, { mesh, sig });
    }
    for (const k of [...this.meshes.keys()]) if (!g.frames.has(k)) this.drop(k);
  }

  drop(k) {
    const cur = this.meshes.get(k);
    if (!cur) return;
    this.game.scene.remove(cur.mesh);
    cur.mesh.material.map.dispose(); cur.mesh.material.dispose();
    this.meshes.delete(k);
  }
}
