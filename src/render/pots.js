// Decorated Pots: the pot itself is meshed with the terrain (world/shapes.js); the sherd
// pictures on its sides (game.pots: "x,y,z" -> faces, see world/archaeology.js) are drawn
// here as thin decals on the body, like item frames. Only pots within 48 blocks are shown.
import * as THREE from 'three';
import { B } from '../world/blocks.js';
import { SIDE_DIRS, DECO_POT_BODY } from '../world/shapes.js';
import { SHERDS, POT_CLAY } from '../world/sherds.js';
import { potSlotSide } from '../world/archaeology.js';

/** A sherd's motif, incised into a slightly lighter panel (16 x 16 canvas, pixel art). */
export function motifCanvas(k) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d');
  ctx.fillStyle = POT_CLAY.light; ctx.globalAlpha = 0.35; ctx.fillRect(2, 2, 12, 12); ctx.globalAlpha = 1;
  ctx.fillStyle = POT_CLAY.line;
  SHERDS[k].motif.forEach((row, y) => { for (let x = 0; x < 8; x++) if (row[x] === '#') ctx.fillRect(4 + x, 4 + y, 1, 1); });
  return c;
}

export class PotRenderer {
  constructor(game) {
    this.game = game;
    this.meshes = new Map(); // key -> { group, sig }
    const [x0, y0, , x1, y1] = DECO_POT_BODY;
    this.geo = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
    this.mats = [];
  }

  material(k) {
    if (!this.mats[k]) {
      const tex = new THREE.CanvasTexture(motifCanvas(k));
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
      this.mats[k] = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.1, polygonOffset: true, polygonOffsetFactor: -2 });
    }
    return this.mats[k];
  }

  update() {
    const g = this.game, p = g.player, w = g.world;
    if (!g.pots) return;
    const [, y0, , x1, y1] = DECO_POT_BODY;
    for (const [k, faces] of g.pots) {
      const [x, y, z] = k.split(',').map(Number);
      const id = w.isLoaded(x, z) ? w.getBlock(x, y, z) : -1;
      if (id >= 0 && id !== B.DECORATED_POT) { g.pots.delete(k); continue; } // the pot is gone
      const near = id > 0 && Math.abs(x - p.x) < 48 && Math.abs(z - p.z) < 48;
      const meta = id > 0 ? w.getMeta(x, y, z) : 0, sig = faces.join() + '|' + (meta & 3);
      const cur = this.meshes.get(k);
      if (!near) { if (cur) this.drop(k); continue; }
      if (cur && cur.sig === sig) continue;
      if (cur) this.drop(k);
      const group = new THREE.Group();
      faces.forEach((f, slot) => {
        if (!f) return; // a plain brick side
        const [dx, , dz] = SIDE_DIRS[potSlotSide(slot, meta & 3)];
        const m = new THREE.Mesh(this.geo, this.material(f - 1));
        m.position.set(x + 0.5 + dx * (x1 - 0.5 + 0.004), y + (y0 + y1) / 2, z + 0.5 + dz * (x1 - 0.5 + 0.004));
        m.rotation.y = Math.atan2(dx, dz);
        group.add(m);
      });
      g.scene.add(group);
      this.meshes.set(k, { group, sig });
    }
    for (const k of [...this.meshes.keys()]) if (!g.pots.has(k)) this.drop(k);
  }

  drop(k) {
    const cur = this.meshes.get(k);
    if (!cur) return;
    this.game.scene.remove(cur.group);
    this.meshes.delete(k);
  }

  clear() { for (const k of [...this.meshes.keys()]) this.drop(k); }
}
