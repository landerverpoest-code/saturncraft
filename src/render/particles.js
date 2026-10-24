// Lightweight CPU particle system rendered as one THREE.Points cloud.
import * as THREE from 'three';
import { texturePixels } from '../world/textures.js';
import { BLOCKS } from '../world/blocks.js';

const MAX = 2000;
const lin = (c) => Math.pow(c / 255, 2.2); // texture colours are sRGB

export class Particles {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.n = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.12, vertexColors: true, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, r, gcol, b, life, grav = 0.04) {
    let i = this.n < MAX ? this.n++ : Math.floor(Math.random() * MAX);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = gcol; this.col[i * 3 + 2] = b;
    this.life[i] = life; this.grav[i] = grav;
  }

  blockBreak(x, y, z, id, light = 1) {
    const d = BLOCKS[id];
    if (!d || !d.tex) return;
    const px = texturePixels(d.tex.side);
    for (let k = 0; k < 24; k++) {
      const pi = Math.floor(Math.random() * 256) * 4;
      if (px[pi + 3] < 100) continue;
      this.emit(x + Math.random(), y + Math.random(), z + Math.random(),
        (Math.random() - 0.5) * 0.15, Math.random() * 0.15, (Math.random() - 0.5) * 0.15,
        lin(px[pi]) * light, lin(px[pi + 1]) * light, lin(px[pi + 2]) * light, 15 + Math.random() * 15);
    }
  }

  /** Small chips flying off the face of a block that is being mined. */
  blockHit(x, y, z, id, face, light = 1) {
    const d = BLOCKS[id];
    if (!d || !d.tex) return;
    const px = texturePixels(d.tex.side);
    for (let k = 0; k < 3; k++) {
      const pi = Math.floor(Math.random() * 256) * 4;
      if (px[pi + 3] < 100) continue;
      // a random point on the hit face, nudged just outside it
      const p = [x + Math.random(), y + Math.random(), z + Math.random()];
      for (let a = 0; a < 3; a++) if (face[a]) p[a] = (a === 0 ? x : a === 1 ? y : z) + (face[a] > 0 ? 1.05 : -0.05);
      this.emit(p[0], p[1], p[2],
        face[0] * 0.05 + (Math.random() - 0.5) * 0.06, face[1] * 0.05 + Math.random() * 0.06, face[2] * 0.05 + (Math.random() - 0.5) * 0.06,
        lin(px[pi]) * light, lin(px[pi + 1]) * light, lin(px[pi + 2]) * light, 8 + Math.random() * 8);
    }
  }

  /** A puff of the ground's colour at the feet (sprinting). */
  footDust(x, y, z, id, light = 1) {
    const px = texturePixels(BLOCKS[id].tex.top);
    const pi = Math.floor(Math.random() * 256) * 4;
    if (px[pi + 3] < 100) return;
    this.emit(x + (Math.random() - 0.5) * 0.4, y + 0.05, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.05, 0.05 + Math.random() * 0.04, (Math.random() - 0.5) * 0.05,
      lin(px[pi]) * light, lin(px[pi + 1]) * light, lin(px[pi + 2]) * light, 10 + Math.random() * 6, 0.02);
  }

  /** Spray of water drops (a leaping dolphin, a splash). */
  splashAt(x, y, z, n = 12) {
    for (let k = 0; k < n; k++) this.emit(x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.2, 0.1 + Math.random() * 0.2, (Math.random() - 0.5) * 0.2, 0.7, 0.8, 1, 18, 0.03);
  }

  crit(x, y, z) {
    for (let k = 0; k < 12; k++) this.emit(x, y, z, (Math.random() - 0.5) * 0.4, Math.random() * 0.3, (Math.random() - 0.5) * 0.4, 1, 0.9, 0.5, 12, 0.02);
  }

  smoke(x, y, z, n = 30, spread = 2) {
    for (let k = 0; k < n; k++) {
      const v = 0.6 + Math.random() * 0.3;
      this.emit(x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread, z + (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * 0.2, Math.random() * 0.1, (Math.random() - 0.5) * 0.2, v, v, v, 20 + Math.random() * 20, -0.005);
    }
  }

  flame(x, y, z) { this.emit(x, y, z, (Math.random() - 0.5) * 0.02, 0.03, (Math.random() - 0.5) * 0.02, 1, 0.6, 0.15, 10, -0.002); }

  tick() {
    let i = 0;
    while (i < this.n) {
      this.life[i]--;
      if (this.life[i] <= 0) {
        const last = --this.n;
        for (let k = 0; k < 3; k++) {
          this.pos[i * 3 + k] = this.pos[last * 3 + k]; this.vel[i * 3 + k] = this.vel[last * 3 + k]; this.col[i * 3 + k] = this.col[last * 3 + k];
        }
        this.life[i] = this.life[last]; this.grav[i] = this.grav[last];
        continue;
      }
      this.vel[i * 3 + 1] -= this.grav[i];
      for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] += this.vel[i * 3 + k]; this.vel[i * 3 + k] *= 0.94; }
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
