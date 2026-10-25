// Things drawn over mobs: the sagging rope of a lead (a catenary from the
// animal's neck to the player's hand or a fence knot) and the floating label of
// a mob named with a Name Tag.
import * as THREE from 'three';
import { catenaryPoints, ropeLength } from '../entities/leash.js';
import { nameVisible } from '../mobs/names.js';
import { lightAt } from '../entities/entities.js';

const SEGMENTS = 20;

function labelTexture(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = 'bold 28px monospace';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  c.width = w; c.height = 40;
  ctx.font = font;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, w, 40);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 8, 21);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  return { tex: t, aspect: w / 40 };
}

export class MobOverlays {
  constructor(scene) {
    this.scene = scene;
    this.ropes = new Map();  // mob id -> THREE.Line
    this.labels = new Map(); // mob id -> THREE.Sprite
  }

  update(game, alpha) {
    const p = game.player, seenR = new Set(), seenL = new Set();
    const [ex, ey, ez] = p.eyePos(), [lx, ly, lz] = p.lookDir();
    const firstPerson = game.perspective === 0;
    for (const e of game.entities.list) {
      if (e.kind !== 'mob' || e.removed) continue;
      const mx = e.prev[0] + (e.x - e.prev[0]) * alpha, my = e.prev[1] + (e.y - e.prev[1]) * alpha, mz = e.prev[2] + (e.z - e.prev[2]) * alpha;
      // the lead
      const h = e.leashHolder;
      if (h && !e.dead) {
        seenR.add(e.id);
        let line = this.ropes.get(e.id);
        if (!line) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3));
          line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x8a6a42 }));
          line.frustumCulled = false;
          this.scene.add(line);
          this.ropes.set(e.id, line);
        }
        // from the neck (front of the body, near the top) ...
        const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw), r = e.width * 0.45;
        const ax = mx + fx * r, ay = my + e.height * 0.78, az = mz + fz * r;
        // ... to the player's hand, or the knot on the fence post
        let bx, by, bz;
        if (h.kind === 'knot') { bx = h.x; by = h.y; bz = h.z; }
        else if (h === p && firstPerson) { bx = ex + lx * 0.5 - lz * 0.35; by = ey - 0.45; bz = ez + lz * 0.5 + lx * 0.35; }
        else { bx = h.x - Math.cos(h.yaw || 0) * 0.35; by = h.y + 0.9; bz = h.z + Math.sin(h.yaw || 0) * 0.35; }
        const d = Math.hypot(bx - ax, by - ay, bz - az);
        const pts = catenaryPoints(ax, ay, az, bx, by, bz, ropeLength(d), SEGMENTS);
        const pos = line.geometry.attributes.position;
        pos.array.set(pts);
        pos.needsUpdate = true;
        line.material.color.setRGB(0.54, 0.42, 0.26).multiplyScalar(lightAt(game, e.x, e.y + 0.5, e.z));
        line.visible = true;
      }
      // the name label
      if (e.customName && e.deathTime === 0) {
        const cy = my + e.height * 0.5;
        if (!nameVisible(mx - ex, cy - ey, mz - ez, lx, ly, lz, Math.max(e.width, e.height) * 0.6)) continue;
        seenL.add(e.id);
        let sp = this.labels.get(e.id);
        if (!sp || sp.userData.text !== e.customName) {
          if (sp) { this.scene.remove(sp); sp.material.map.dispose(); sp.material.dispose(); }
          const { tex, aspect } = labelTexture(e.customName);
          sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
          sp.userData.text = e.customName;
          sp.scale.set(0.32 * aspect, 0.32, 1);
          sp.renderOrder = 10;
          this.scene.add(sp);
          this.labels.set(e.id, sp);
        }
        sp.position.set(mx, my + e.height + 0.45, mz);
        sp.visible = true;
      }
    }
    for (const [id, line] of this.ropes) if (!seenR.has(id)) { this.scene.remove(line); line.geometry.dispose(); line.material.dispose(); this.ropes.delete(id); }
    for (const [id, sp] of this.labels) if (!seenL.has(id)) { this.scene.remove(sp); sp.material.map.dispose(); sp.material.dispose(); this.labels.delete(id); }
  }
}
