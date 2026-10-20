// The open book that floats above every enchanting table near the player:
// it bobs, turns towards the player and opens wider as they come close.
import * as THREE from 'three';
import { B } from '../world/blocks.js';
import { lightAt } from '../entities/entities.js';

const SCAN_RADIUS = 10, SCAN_EVERY = 1; // seconds

function pageTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2e8cc'; ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#8a7a9a';
  for (let y = 3; y < 14; y += 2) ctx.fillRect(2, y, 6 + ((y * 7) % 6), 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class EnchantBooks {
  constructor(scene) {
    this.scene = scene;
    this.books = new Map(); // "x,y,z" -> {group, left, right, x, y, z, open}
    this.lastScan = -Infinity;
    this.coverMat = new THREE.MeshBasicMaterial({ color: 0x7a3a22 });
    this.pageMat = new THREE.MeshBasicMaterial({ map: pageTexture() });
    this.coverGeo = new THREE.BoxGeometry(0.2, 0.02, 0.32);
    this.pageGeo = new THREE.BoxGeometry(0.18, 0.035, 0.29);
  }

  makeBook(x, y, z) {
    const group = new THREE.Group();
    const half = (side) => {
      const h = new THREE.Group(); // hinged at the spine (local origin)
      const cover = new THREE.Mesh(this.coverGeo, this.coverMat);
      cover.position.x = side * 0.1;
      const pages = new THREE.Mesh(this.pageGeo, this.pageMat);
      pages.position.set(side * 0.095, 0.026, 0);
      h.add(cover, pages);
      return h;
    };
    const left = half(-1), right = half(1);
    group.add(left, right);
    group.scale.setScalar(1.35);
    this.scene.add(group);
    return { group, left, right, x, y, z, open: 0, phase: (x * 7 + z * 13) % 6 };
  }

  scan(game) {
    const w = game.world, p = game.player;
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    const seen = new Set();
    for (let x = px - SCAN_RADIUS; x <= px + SCAN_RADIUS; x++) for (let z = pz - SCAN_RADIUS; z <= pz + SCAN_RADIUS; z++) {
      for (let y = py - 5; y <= py + 5; y++) {
        if (w.getBlock(x, y, z) !== B.ENCHANTING_TABLE) continue;
        const k = `${x},${y},${z}`;
        seen.add(k);
        if (!this.books.has(k)) this.books.set(k, this.makeBook(x, y, z));
      }
    }
    for (const [k, b] of this.books) if (!seen.has(k)) { this.scene.remove(b.group); this.books.delete(k); }
  }

  update(game, sec) {
    if (Math.abs(sec - this.lastScan) >= SCAN_EVERY) { this.lastScan = sec; this.scan(game); }
    if (!this.books.size) return;
    const p = game.player;
    for (const b of this.books.values()) {
      const cx = b.x + 0.5, cz = b.z + 0.5;
      const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      // open up while a player is within 3 blocks
      const want = d < 3 ? 1 : 0;
      b.open += (want - b.open) * 0.06;
      const flutter = Math.sin(sec * 2.2 + b.phase) * 0.12;
      const a = 0.12 + b.open * (1.05 + flutter);
      b.left.rotation.z = a; b.right.rotation.z = -a;
      const g = b.group;
      g.position.set(cx, b.y + 1.05 + Math.sin(sec * 1.6 + b.phase) * 0.06, cz);
      // spine faces the player; tilt the open book up a little
      g.rotation.set(0, Math.atan2(dx, dz), 0);
      g.rotateX(0.35 + 0.65 * b.open); // pages turn up towards the reader
      const L = lightAt(game, cx, b.y + 1, cz) * (0.4 + 0.6 * Math.min(1, game.sky.state.combined + 0.25));
      this.coverMat.color.setRGB(0.48 * L, 0.23 * L, 0.13 * L);
      this.pageMat.color.setRGB(L, L, L);
    }
  }

  clear() { for (const b of this.books.values()) this.scene.remove(b.group); this.books.clear(); }
}
