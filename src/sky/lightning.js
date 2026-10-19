// Lightning bolts: a jagged, branching strip of glowing quads from the clouds
// to the ground that flickers for a few ticks, plus a sky flash level that the
// sky and terrain lighting add on top of everything else.
import * as THREE from 'three';

const LIFE = 10; // ticks a bolt stays (it flickers on and off a couple of times)

function boltSegments(x, y, z, rng = Math.random) {
  const segs = [];
  const top = y + 110;
  const walk = (sx, sy, sz, ey, spread, depth) => {
    let px = sx, py = sy, pz = sz;
    while (py > ey) {
      const ny = Math.max(ey, py - 3 - rng() * 5);
      const nx = px + (rng() - 0.5) * spread, nz = pz + (rng() - 0.5) * spread;
      segs.push([px, py, pz, nx, ny, nz, depth]);
      if (depth < 2 && rng() < 0.12) walk(nx, ny, nz, Math.max(ey, ny - 15 - rng() * 25), spread * 1.3, depth + 1);
      px = nx; py = ny; pz = nz;
    }
    return [px, pz];
  };
  // the main channel drifts towards the strike point on the way down
  let px = x + (rng() - 0.5) * 20, pz = z + (rng() - 0.5) * 20, py = top;
  while (py > y) {
    const ny = Math.max(y, py - 3 - rng() * 5);
    const k = (py - ny) / (py - y);
    const nx = ny === y ? x : px + (x - px) * k + (rng() - 0.5) * 3.5;
    const nz = ny === y ? z : pz + (z - pz) * k + (rng() - 0.5) * 3.5;
    segs.push([px, py, pz, nx, ny, nz, 0]);
    if (rng() < 0.12) walk(nx, ny, nz, Math.max(y, ny - 10 - rng() * 30), 6, 1);
    px = nx; py = ny; pz = nz;
  }
  return segs;
}

function buildGeometry(segs) {
  const pos = [], col = [];
  for (const [ax, ay, az, bx, by, bz, depth] of segs) {
    for (const [w, a] of [[0.9 / (depth + 1), 0.25], [0.28 / (depth + 1), 1]]) {
      // two crossed quads per segment so it reads from every side
      for (const [ox, oz] of [[w, 0], [0, w]]) {
        const v = [[ax - ox, ay, az - oz], [ax + ox, ay, az + oz], [bx + ox, by, bz + oz], [bx - ox, by, bz - oz]];
        for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...v[i]); col.push(0.75 * a, 0.8 * a, 1.0 * a); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export class Lightning {
  constructor(scene) {
    this.scene = scene;
    this.bolts = [];
    this.flash = 0;
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  }

  strike(x, y, z) {
    const mesh = new THREE.Mesh(buildGeometry(boltSegments(x, y, z)), this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    this.bolts.push({ mesh, age: 0 });
    this.flash = 1;
  }

  tick() {
    for (const b of this.bolts) {
      b.age++;
      // the reference bolt flashes 2-3 times before it fades
      b.mesh.visible = b.age < 3 || (b.age > 4 && b.age < 7) || b.age === 8;
    }
    for (const b of this.bolts.filter((b) => b.age >= LIFE)) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); }
    this.bolts = this.bolts.filter((b) => b.age < LIFE);
    const on = this.bolts.some((b) => b.mesh.visible);
    this.flash = on ? 1 : this.flash * 0.6;
  }
}
