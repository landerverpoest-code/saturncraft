// Sign text: each sign with text gets a small plane with its four lines
// drawn on a canvas, in front of the board. Rebuilt when the text changes;
// only signs within 48 blocks are shown.
import * as THREE from 'three';
import { B } from '../world/blocks.js';
import { SIDE_DIRS } from '../world/shapes.js';

/** Where a sign's text faces: [board centre x, y, z offsets inside the block, front normal]. */
export function signFace(id, meta) {
  if (id === B.OAK_WALL_SIGN) {
    const [dx, , dz] = SIDE_DIRS[meta & 3];
    return { cx: 0.5 + dx * (0.5 - 2 / 16) - dx * 0.011, cy: 8.5 / 16, cz: 0.5 + dz * (0.5 - 2 / 16) - dz * 0.011, nx: -dx, nz: -dz };
  }
  const [dx, , dz] = SIDE_DIRS[meta & 3];
  return { cx: 0.5 + dx * (1 / 16 + 0.011), cy: 12 / 16, cz: 0.5 + dz * (1 / 16 + 0.011), nx: dx, nz: dz };
}

function textTexture(lines) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a120a';
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l || '', 128, 18 + i * 30));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class SignRenderer {
  constructor(game) {
    this.game = game;
    this.meshes = new Map(); // key -> { mesh, text }
    this.geo = new THREE.PlaneGeometry(14 / 16, 7 / 16);
  }

  update() {
    const g = this.game, p = g.player, w = g.world;
    for (const [k, lines] of g.signs) {
      const [x, y, z] = k.split(',').map(Number);
      const id = w.isLoaded(x, z) ? w.getBlock(x, y, z) : -1;
      if (id >= 0 && id !== B.OAK_SIGN && id !== B.OAK_WALL_SIGN) { g.signs.delete(k); continue; } // the sign is gone
      const near = id > 0 && Math.abs(x - p.x) < 48 && Math.abs(z - p.z) < 48 && lines.some(Boolean);
      const cur = this.meshes.get(k), text = lines.join('\n') + '|' + id + '|' + (id > 0 ? w.getMeta(x, y, z) : 0);
      if (!near) { if (cur) this.drop(k); continue; }
      if (cur && cur.text === text) continue;
      if (cur) this.drop(k);
      const f = signFace(id, w.getMeta(x, y, z));
      const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ map: textTexture(lines), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      mesh.position.set(x + f.cx, y + f.cy, z + f.cz);
      mesh.rotation.y = Math.atan2(f.nx, f.nz);
      g.scene.add(mesh);
      this.meshes.set(k, { mesh, text });
    }
    for (const k of [...this.meshes.keys()]) if (!g.signs.has(k)) this.drop(k);
  }

  drop(k) {
    const cur = this.meshes.get(k);
    if (!cur) return;
    this.game.scene.remove(cur.mesh);
    cur.mesh.material.map.dispose(); cur.mesh.material.dispose();
    this.meshes.delete(k);
  }

  clear() { for (const k of [...this.meshes.keys()]) this.drop(k); }
}
